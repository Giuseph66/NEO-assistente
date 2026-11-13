import { EventEmitter } from 'events';
import type { STTFinalEvent, STTPartialEvent, STTStatus } from '@neo/shared';
import { getLogger } from '@neo/logger';
import type {
  LiveTranscriptionError,
  LiveTranscriptionProvider,
  LiveTranscriptionProviderConfig,
} from './LiveTranscriptionProvider';
import { SpeechSegmenter, SpeechSegment } from '../audio/SpeechSegmenter';
import { encodeWavPcm16 } from '../audio/wav';
import {
  CodexTranscriptionClient,
  CodexTranscriptionError,
  toIsoLanguage,
} from '../codex/CodexTranscriptionClient';
import { getCodexCredentials } from '../../auth/codexCredentials';

const logger = getLogger();

/** Max wait for clips still in flight when the user stops. */
const STOP_DRAIN_TIMEOUT_MS = 20_000;
/** Shown while an utterance is being transcribed (the endpoint has no partial results). */
const PENDING_PARTIAL_TEXT = '…';

export type CodexProviderDeps = {
  client?: CodexTranscriptionClient;
};

/**
 * Live transcription through the ChatGPT/Codex transcription endpoint.
 *
 * The endpoint transcribes finished clips, not a stream, so audio is cut into
 * utterances at pauses (SpeechSegmenter) and each one is sent as a WAV clip.
 * Results arrive one utterance at a time as final events, in speaking order.
 */
export class CodexTranscriptionProvider implements LiveTranscriptionProvider {
  id = 'codex_transcribe' as const;
  private readonly emitter = new EventEmitter();
  private readonly client: CodexTranscriptionClient;
  private segmenter: SpeechSegmenter | null = null;
  private config: LiveTranscriptionProviderConfig | null = null;
  private queue: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private abort: AbortController | null = null;
  private failed = false;

  constructor(deps: CodexProviderDeps = {}) {
    this.client = deps.client ?? new CodexTranscriptionClient({ getCredentials: getCodexCredentials });
  }

  async start(config: LiveTranscriptionProviderConfig): Promise<void> {
    if (this.segmenter) return;
    this.emitStatus({ state: 'starting', providerId: this.id });

    // Fail fast when there is no ChatGPT login instead of failing on the first clip.
    try {
      await this.client.checkCredentials();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login ChatGPT (Codex) não conectado';
      this.emitError({ message, code: 'not_connected', providerId: this.id });
      throw error;
    }

    this.config = config;
    this.failed = false;
    this.abort = new AbortController();
    this.queue = Promise.resolve();
    this.segmenter = new SpeechSegmenter({
      sampleRate: config.sampleRate,
      maxSegmentMs: Math.min(Math.max(config.maxSegmentSeconds || 15, 5), 30) * 1000,
    });
    this.emitStatus({ state: 'listening', providerId: this.id, modelId: 'codex' });
  }

  pushAudio(chunk: Buffer): void {
    if (!this.segmenter || this.failed) return;
    for (const segment of this.segmenter.push(chunk)) {
      this.enqueue(segment);
    }
  }

  async stop(): Promise<void> {
    if (!this.segmenter) return;
    this.emitStatus({ state: 'finalizing', providerId: this.id });
    const last = this.segmenter.flush();
    if (last) this.enqueue(last);
    this.segmenter = null;

    const drained = await Promise.race([
      this.queue.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STOP_DRAIN_TIMEOUT_MS)),
    ]);
    if (!drained) {
      logger.warn('Codex STT: stop timed out with clips still in flight; cancelling');
      this.abort?.abort();
    }
    this.abort = null;
    this.emitStatus({ state: 'idle' });
  }

  async dispose(): Promise<void> {
    this.abort?.abort();
    await this.stop();
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

  onError(cb: (error: LiveTranscriptionError) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }

  onDebug(cb: (message: string) => void): () => void {
    this.emitter.on('debug', cb);
    return () => this.emitter.off('debug', cb);
  }

  /** Clips are transcribed one at a time so finals keep the speaking order. */
  private enqueue(segment: SpeechSegment): void {
    const config = this.config;
    if (!config) return;
    const signal = this.abort?.signal;
    this.inFlight += 1;
    this.emitPartial(PENDING_PARTIAL_TEXT);
    this.queue = this.queue.then(async () => {
      try {
        if (this.failed) return;
        const startedAt = Date.now();
        const text = await this.client.transcribe({
          audio: encodeWavPcm16(segment.pcm, config.sampleRate),
          filename: 'utterance.wav',
          mimeType: 'audio/wav',
          language: toIsoLanguage(this.languageHint(config)),
          signal,
        });
        this.emitDebug(
          `codex:segment ${Math.round(segment.endMs - segment.startMs)}ms -> ${text.length} chars in ${Date.now() - startedAt}ms`
        );
        if (text) this.emitFinal(text);
      } catch (error) {
        this.handleClipError(error);
      } finally {
        this.inFlight -= 1;
        if (this.inFlight === 0) this.emitPartial('');
      }
    });
  }

  private handleClipError(error: unknown): void {
    if (error instanceof CodexTranscriptionError) {
      if (error.code === 'aborted') return;
      if (error.fatal) {
        this.failed = true;
        this.emitError({ message: error.message, code: error.code, providerId: this.id });
        return;
      }
      // Transient (rate limit / network / too large): drop this clip, keep listening.
      logger.warn({ code: error.code, status: error.status }, 'Codex STT: clip failed');
      this.emitDebug(`codex:clip_failed code=${error.code}`);
      return;
    }
    logger.warn({ err: error }, 'Codex STT: unexpected clip error');
    this.emitDebug(`codex:clip_failed ${error instanceof Error ? error.message : String(error)}`);
  }

  /** The STT config has no language field; the Vosk model id carries one (`vosk-pt-br-...`). */
  private languageHint(config: LiveTranscriptionProviderConfig): string | undefined {
    const match = /(?:^|[-_])(pt|en|es|fr|de|it)(?:[-_]|$)/i.exec(config.modelId || '');
    return match?.[1];
  }

  private emitPartial(text: string): void {
    this.emitter.emit('partial', { text, ts: Date.now(), meta: { providerId: this.id } } satisfies STTPartialEvent);
  }

  private emitFinal(text: string): void {
    this.emitter.emit('final', { text, ts: Date.now(), meta: { providerId: this.id } } satisfies STTFinalEvent);
  }

  private emitStatus(status: STTStatus): void {
    this.emitter.emit('status', status);
  }

  private emitError(error: LiveTranscriptionError): void {
    this.emitter.emit('error', error);
    this.emitStatus({ state: 'error', message: error.message, providerId: this.id });
  }

  private emitDebug(message: string): void {
    this.emitter.emit('debug', message);
  }
}
