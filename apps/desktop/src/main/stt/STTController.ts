import { EventEmitter } from 'events';
import { LiveTranscriptionProviderId, STTConfig, STTFinalEvent, STTPartialEvent, STTStatus } from '@neo/shared';
import { getLogger } from '@neo/logger';
import { AudioSource } from './audio/AudioSource';
import { ArecordAudioSource } from './audio/ArecordAudioSource';
import { RendererAudioSource } from './audio/RendererAudioSource';
import { PhoneMicAudioSource } from './audio/PhoneMicAudioSource';
import { ModelManager } from './models/ModelManager';
import { getConfigStore } from '../storage/configStore';
import { createLiveTranscriptionProvider, normalizeLiveProviderId } from './providers/LiveProviderRegistry';
import type { LiveTranscriptionError, LiveTranscriptionProvider } from './providers/LiveTranscriptionProvider';
import { DatabaseManager } from '../database';
import { ApiKeyPool } from '../ai/ApiKeyPool';
import { getKeyStorage } from '../ai/AIServiceManager';
import { getOAuthController } from '../auth/openaiOAuth';

const logger = getLogger();

export class STTController {
  private status: STTStatus = { state: 'idle' };
  private provider: LiveTranscriptionProvider | null = null;
  private audioSource: AudioSource | null = null;
  private audioSourceOverride: AudioSource | null = null; // PhoneMic override
  private emitter = new EventEmitter();
  private modelManager: ModelManager;
  private configStore = getConfigStore();
  private db: DatabaseManager | null = null;
  private audioBytes = 0;
  private lastAudioAt = 0;
  private audioTimer: NodeJS.Timeout | null = null;
  private level = 0;
  private lastLevelAt = 0;

  constructor(modelManager: ModelManager, db?: DatabaseManager) {
    this.modelManager = modelManager;
    this.db = db || null;
  }

  getStatus(): STTStatus {
    return this.status;
  }

  getConfig(): STTConfig {
    return this.configStore.getConfig();
  }

  updateConfig(partial: Partial<STTConfig>): STTConfig {
    return this.configStore.setConfig(partial);
  }

  async start(configOverride?: STTConfig): Promise<void> {
    if (
      this.status.state === 'running' ||
      this.status.state === 'listening' ||
      this.status.state === 'starting'
    ) {
      return;
    }

    const storedConfig = configOverride || this.getConfig();
    let effectiveConfig = storedConfig;
    const providerId = normalizeLiveProviderId(storedConfig.provider);
    let modelPath: string | undefined;
    let modelName: string | undefined;

    if (providerId === 'vox') {
      const model = this.modelManager.listInstalled().find((item) => item.id === storedConfig.modelId);
      if (!model) {
        const message = 'Nenhum modelo Vosk instalado ou selecionado';
        this.setStatus({ state: 'error', message, providerId });
        throw new Error(message);
      }
      const targetSampleRate = model.defaultSampleRate || storedConfig.sampleRate;
      if (targetSampleRate !== storedConfig.sampleRate) {
        effectiveConfig = { ...storedConfig, sampleRate: targetSampleRate };
      }
      modelPath = model.installPath;
      modelName = model.id;
      this.emitDebug(`starting model=${model.id} path=${model.installPath}`);
    } else if (providerId === 'openai_realtime_transcribe') {
      modelName = 'gpt-4o-transcribe';
      if (storedConfig.sampleRate !== 16000) {
        effectiveConfig = { ...storedConfig, sampleRate: 16000 };
      }
    } else if (providerId === 'gemini_live') {
      modelName = 'gemini-2.5-flash-native-audio-preview-12-2025';
      if (storedConfig.sampleRate !== 16000) {
        effectiveConfig = { ...storedConfig, sampleRate: 16000 };
      }
    }

    this.setStatus({ state: 'starting', providerId });
    this.emitDebug(`sampleRate=${effectiveConfig.sampleRate}`);

    try {
      const provider = createLiveTranscriptionProvider(providerId);
      this.provider = provider;
      provider.onPartial((event) => this.emitter.emit('partial', event));
      provider.onFinal((event) => this.emitter.emit('final', event));
      provider.onStatus((status) => this.setStatus(status));
      provider.onError((error) => this.handleError(error));
      provider.onDebug?.((message) => this.emitDebug(message));

      const apiKey =
        providerId === 'openai_realtime_transcribe'
          ? await this.resolveApiKey('openai')
          : providerId === 'gemini_live'
            ? await this.resolveApiKey('gemini')
            : undefined;

      if ((providerId === 'openai_realtime_transcribe' || providerId === 'gemini_live') && !apiKey) {
        const hint =
          providerId === 'openai_realtime_transcribe'
            ? this.getApiKeyUnavailableReason('openai')
            : providerId === 'gemini_live'
              ? this.getApiKeyUnavailableReason('gemini')
              : null;
        const message =
          hint ||
          `Chave de API nao configurada para ${providerId === 'gemini_live' ? 'Gemini' : 'OpenAI'}`;
        this.setStatus({ state: 'error', message, providerId });
        throw new Error(message);
      }

      await provider.start({
        ...effectiveConfig,
        provider: providerId,
        modelPath,
        modelName,
        apiKey: apiKey?.key,
      });
      this.emitDebug('provider ready');

      const sourceType = process.env.RICKY_STT_SOURCE || 'arecord';
      // Se houver um override (ex: PhoneMicAudioSource), usa ele
      this.audioSource = this.audioSourceOverride
        ? this.audioSourceOverride
        : sourceType === 'arecord'
        ? new ArecordAudioSource()
        : new RendererAudioSource();
      this.audioBytes = 0;
      this.lastAudioAt = Date.now();
      this.audioSource.onData((chunk) => {
        this.audioBytes += chunk.length;
        this.lastAudioAt = Date.now();
        this.updateLevel(chunk);
        this.provider?.pushAudio(chunk);
      });
      this.audioSource.onError((error) => this.handleError(error.message));
      await this.audioSource.start({ sampleRate: effectiveConfig.sampleRate });
      if (this.audioSource instanceof ArecordAudioSource) {
        const deviceName = this.audioSource.getDeviceName();
        this.emitDebug(`arecord started device=${deviceName}`);
      } else {
        this.emitDebug('renderer audio source ativo');
      }
      this.startAudioMonitor();

      if (providerId === 'vox' && modelName) {
        this.setStatus({ state: 'listening', modelId: modelName, providerId });
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error.message : 'Falha ao iniciar STT');
      await this.cleanup();
    }
  }

  async stop(): Promise<void> {
    if (this.status.state === 'idle' || this.status.state === 'stopping' || this.status.state === 'finalizing') {
      return;
    }

    this.setStatus({ state: 'finalizing', providerId: this.status.providerId });

    await this.cleanup();

    if (this.status.state !== 'error') {
      this.setStatus({ state: 'idle' });
    }
  }

  onPartial(cb: (event: STTPartialEvent) => void): () => void {
    this.emitter.on('partial', cb);
    return () => this.emitter.off('partial', cb);
  }

  onFinal(cb: (event: STTFinalEvent) => void): () => void {
    this.emitter.on('final', cb);
    return () => this.emitter.off('final', cb);
  }

  onStatus(cb: (status: STTStatus) => void): () => void {
    this.emitter.on('status', cb);
    return () => this.emitter.off('status', cb);
  }

  onError(cb: (payload: { message: string; debug?: string; providerId?: LiveTranscriptionProviderId }) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }

  onDebug(cb: (message: string) => void): () => void {
    this.emitter.on('debug', cb);
    return () => this.emitter.off('debug', cb);
  }

  onLevel(cb: (payload: { level: number; rms: number; ts: number }) => void): () => void {
    this.emitter.on('level', cb);
    return () => this.emitter.off('level', cb);
  }

  /** Retorna true se o STT está ativo (running ou listening) */
  isRunning(): boolean {
    return this.status.state === 'running' || this.status.state === 'listening';
  }

  /** Retorna o tipo da fonte de áudio atual */
  getAudioSourceType(): 'phoneMic' | 'default' {
    return this.audioSourceOverride instanceof PhoneMicAudioSource ? 'phoneMic' : 'default';
  }

  /**
   * Define (ou limpa) um override de AudioSource.
   * Se o STT já estiver rodando, faz hot-swap: para a fonte atual e inicia a nova.
   */
  async setAudioSourceOverride(source: AudioSource | null): Promise<void> {
    this.audioSourceOverride = source;

    if (!this.isRunning()) return; // STT parado: o override será usado no próximo start()

    // Hot-swap: substitui a fonte sem parar o provider/transcrição
    logger.info(
      source ? 'STTController: hot-swapping audio source → PhoneMic' : 'STTController: hot-swapping audio source → default',
    );

    try {
      await this.audioSource?.stop();
    } catch {
      // ignore
    }

    const newSource = source ?? (
      process.env.RICKY_STT_SOURCE === 'renderer' ? new RendererAudioSource() : new ArecordAudioSource()
    );
    this.audioSource = newSource;

    const config = this.getConfig();
    newSource.onData((chunk) => {
      this.audioBytes += chunk.length;
      this.lastAudioAt = Date.now();
      this.updateLevel(chunk);
      this.provider?.pushAudio(chunk);
    });
    newSource.onError((error) => this.handleError(error.message));
    await newSource.start({ sampleRate: config.sampleRate || 16000 });

    logger.info('STTController: audio source hot-swap complete');
  }

  private setStatus(status: STTStatus): void {
    this.status = status;
    this.emitter.emit('status', status);
  }

  private emitDebug(message: string): void {
    this.emitter.emit('debug', message);
  }

  private startAudioMonitor(): void {
    if (this.audioTimer) return;
    this.audioTimer = setInterval(() => {
      const now = Date.now();
      const since = now - this.lastAudioAt;
      const kb = (this.audioBytes / 1024).toFixed(1);
      this.emitDebug(`audio ${kb} KB/s, ultimo ${since}ms`);
      this.audioBytes = 0;
    }, 1000);
  }

  private stopAudioMonitor(): void {
    if (this.audioTimer) {
      clearInterval(this.audioTimer);
      this.audioTimer = null;
    }
  }

  private updateLevel(chunk: Buffer): void {
    const now = Date.now();
    if (chunk.length < 2) return;
    let sumSquares = 0;
    const sampleCount = Math.floor(chunk.length / 2);
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = chunk.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    const target = Math.min(1, rms / 4000);
    this.level = this.level * 0.8 + target * 0.2;

    if (now - this.lastLevelAt >= 50) {
      this.lastLevelAt = now;
      this.emitter.emit('level', { level: this.level, rms, ts: now });
    }
  }

  private handleError(error: LiveTranscriptionError | string): void {
    const payload =
      typeof error === 'string'
        ? { message: error }
        : { message: error.message, debug: error.debug, providerId: error.providerId };
    logger.error({ message: payload.message, debug: payload.debug, providerId: payload.providerId }, 'STT error');
    this.emitter.emit('error', payload);
    this.setStatus({ state: 'error', message: payload.message, providerId: payload.providerId, debug: payload.debug });
  }

  private async cleanup(): Promise<void> {
    try {
      await this.audioSource?.stop();
    } catch (error) {
      logger.error({ err: error }, 'Failed to stop audio source');
    }

    try {
      await this.provider?.stop();
    } catch (error) {
      logger.error({ err: error }, 'Failed to stop STT provider');
    }

    this.stopAudioMonitor();
    this.level = 0;
    this.lastLevelAt = 0;
    this.emitter.emit('level', { level: 0, rms: 0, ts: Date.now() });
    this.audioSource = null;
    this.provider = null;
  }

  private async resolveApiKey(providerId: 'openai' | 'gemini'): Promise<{ key: string; keyId?: number } | null> {
    if (!this.db) return null;
    const keyPool = new ApiKeyPool(this.db, getKeyStorage());
    const apiKey = await keyPool.getNextKeyAsync(providerId, {
      // STT OpenAI tenta primeiro chave manual.
      skipOAuth: providerId === 'openai',
    });
    if (apiKey?.key) {
      return { key: apiKey.key, keyId: apiKey.id > 0 ? apiKey.id : undefined };
    }

    if (providerId === 'openai') {
      const oauthKey = await keyPool.getNextKeyAsync('openai-codex');
      if (oauthKey?.key) {
        logger.warn('STT OpenAI: using OAuth token fallback (openai-codex) because no manual API key is available');
        return { key: oauthKey.key, keyId: oauthKey.id > 0 ? oauthKey.id : undefined };
      }
    }

    return null;
  }

  private getApiKeyUnavailableReason(providerId: 'openai' | 'gemini'): string | null {
    if (!this.db) return null;
    const keys = this.db.getAIApiKeys(providerId);
    if (providerId === 'openai') {
      try {
        const controller = getOAuthController();
        const hasOAuth = controller
          .getTokenStore()
          .listProfiles()
          .some((profile) => profile.isActive && profile.isEnabled && !profile.isExpired);
        if (hasOAuth) {
          return 'OpenAI OAuth conectado, mas o áudio em tempo real não encontrou credencial válida para este endpoint. Tente adicionar uma API key manual da OpenAI.';
        }
      } catch {
        // ignore
      }
    }
    if (!keys || keys.length === 0) return null;
    const lastError = keys.map((k) => k.last_error_code).find(Boolean);
    const hasInsufficientQuota = keys.some((k) => k.last_error_code === 'insufficient_quota');
    const hasCooldown = keys.some((k) => k.status === 'cooldown');
    const hasDisabled = keys.some((k) => k.status === 'disabled');

    if (hasInsufficientQuota) {
      return 'Chave OpenAI sem quota (insufficient_quota). Verifique billing/créditos no painel da OpenAI.';
    }
    if (hasCooldown) {
      return 'Nenhuma chave disponível (todas em cooldown). Aguarde o cooldown ou reative uma chave.';
    }
    if (hasDisabled) {
      return `Nenhuma chave disponível (todas desabilitadas). Último erro: ${lastError || 'desconhecido'}`;
    }
    return lastError ? `Nenhuma chave disponível. Último erro: ${lastError}` : 'Nenhuma chave disponível.';
  }
}
