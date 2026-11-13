import { DatabaseManager } from '../database';
import { ApiKeyPool, ApiError } from './ApiKeyPool';
import { KeyStorage } from './storage/KeyStorage';
import { getAIProviderManager } from './AIProviderManager';
import { preprocessImage } from './utils/imagePreprocessor';
import { normalizeAIConfigPatch } from './utils/aiConfigNormalization';
import { loadModelCatalog } from './modelCatalog';
import {
  VisionRequest,
  VisionResponse,
  AIConfig,
  AnalyzeScreenshotRequest,
  AnalyzeScreenshotResponse,
  AnalyzeChatRequest,
  AnalyzeChatResponse,
  AIProviderId,
} from '@neo/shared';
import { getLogger } from '@neo/logger';
import { existsSync } from 'fs';
import { getOAuthController } from '../auth/openaiOAuth';

const logger = getLogger();

/**
 * Serviço principal de análise de IA
 * Orquestra providers, keys, compressão e persistência
 */
export class AIService {
  private db: DatabaseManager;
  private keyPool: ApiKeyPool;
  private keyStorage: KeyStorage;
  private config: AIConfig;

  constructor(db: DatabaseManager, keyStorage: KeyStorage, initialConfig?: Partial<AIConfig>) {
    this.db = db;
    this.keyStorage = keyStorage;
    this.keyPool = new ApiKeyPool(db, keyStorage, initialConfig?.fallbackCooldownMinutes || 10);

    // Configuração padrão
    this.config = {
      providerId: initialConfig?.providerId || 'gemini',
      modelName: initialConfig?.modelName || 'gemini-2.5-flash',
      timeoutMs: initialConfig?.timeoutMs || 30000,
      retries: initialConfig?.retries || 2,
      streaming: initialConfig?.streaming || false,
      saveHistory: initialConfig?.saveHistory ?? true,
      maxImageDimension: initialConfig?.maxImageDimension || 1280,
      maxImageBytes: initialConfig?.maxImageBytes || 2_500_000,
      imageQuality: initialConfig?.imageQuality || 80,
      enableImageOptimization: initialConfig?.enableImageOptimization ?? true,
      fallbackMaxAttempts: initialConfig?.fallbackMaxAttempts || 3,
      fallbackCooldownMinutes: initialConfig?.fallbackCooldownMinutes || 10,
      reasoningEffort: initialConfig?.reasoningEffort || 'medium',
    };

    this.ensureProviderExists(this.config.providerId);
  }

  /**
   * Atualiza configuração
   */
  updateConfig(config: Partial<AIConfig>): void {
    const current = this.getConfig();
    const { normalizedPatch, didChangeModel } = normalizeAIConfigPatch(current, config);

    if (didChangeModel) {
      const nextProvider = (normalizedPatch.providerId ?? current.providerId) as AIProviderId;
      logger.warn(
        {
          providerId: nextProvider,
          oldModelName: current.modelName,
          newModelName: normalizedPatch.modelName,
          patch: config,
        },
        'Model adjusted to match provider'
      );
    }

    this.config = { ...this.config, ...normalizedPatch };
    this.ensureProviderExists(this.config.providerId);
    this.keyPool = new ApiKeyPool(this.db, this.keyStorage, this.config.fallbackCooldownMinutes);
  }

  /**
   * Obtém configuração atual
   */
  getConfig(): AIConfig {
    return { ...this.config };
  }

  /**
   * Analisa um screenshot
   */
  async analyzeScreenshot(
    request: AnalyzeScreenshotRequest
  ): Promise<AnalyzeScreenshotResponse> {
    const startTime = Date.now();

    try {
      // Obtém screenshot do banco
      const screenshot = this.db.getScreenshotById(request.screenshotId);
      if (!screenshot) {
        return {
          success: false,
          error: 'Screenshot not found',
        };
      }

      // Verifica se arquivo existe
      const imagePath = screenshot.optimized_path || screenshot.file_path;
      if (!existsSync(imagePath)) {
        return {
          success: false,
          error: 'Screenshot file not found',
        };
      }

      const context = request.context?.trim();

      // Prepara prompt baseado no modo
      let prompt = request.prompt?.trim() || '';
      if (request.mode === 'extract_text') {
        prompt =
          'Extraia todo o texto visível nesta imagem, mantendo quebras de linha e estrutura. Retorne apenas o texto extraído, sem explicações adicionais.';
      }

      // Cria ou obtém sessão
      let sessionId = request.sessionId || 0;
      if (sessionId) {
        const existing = this.db.getAISessionById(sessionId);
        if (!existing || existing.screenshotId !== request.screenshotId) {
          sessionId = 0;
        }
      }
      if (!sessionId) {
        const existingSessions = this.db.getAISessions(request.screenshotId);
        if (existingSessions.length > 0 && request.mode !== 'extract_text') {
          sessionId = existingSessions[0].id;
        } else {
          sessionId = this.db.saveAISession({
            screenshotId: request.screenshotId,
            providerId: this.config.providerId,
            modelName: this.config.modelName,
          });
        }
      }

      const history = this.db.getAIMessages(sessionId);
      const hasSystemMessage = history.some((message) => message.role === 'system');

      if (context && !hasSystemMessage) {
        this.db.saveAIMessage({
          session_id: sessionId,
          role: 'system',
          content: context,
        });
      }

      // Salva mensagem do usuário
      if (prompt) {
        this.db.saveAIMessage({
          session_id: sessionId,
          role: 'user',
          content: prompt,
        });
      }

      const messages = this.db.getAIMessages(sessionId).map((message) => ({
        role: message.role as 'system' | 'user' | 'assistant',
        content: message.content,
      }));

      // Prepara imagem (base64 + otimização opcional)
      const imagePayload = await preprocessImage(imagePath, {
        enableOptimization: this.config.enableImageOptimization,
        maxDimension: this.config.maxImageDimension,
        maxBytes: this.config.maxImageBytes,
        quality: this.config.imageQuality,
      });

      // Tenta análise com fallback de keys
      const response = await this.analyzeWithFallback(
        imagePayload,
        messages,
        sessionId,
        request.options
      );

      // Salva mensagem da assistente
      this.db.saveAIMessage({
        session_id: sessionId,
        role: 'assistant',
        content: response.answerText,
        recognized_text: response.recognizedText,
      });

      // Salva run no banco
      const duration = Date.now() - startTime;
      this.db.saveAIRun({
        session_id: sessionId,
        provider_id: this.config.providerId,
        model_name: this.config.modelName,
        api_key_id: this.toPersistedApiKeyId(response.apiKeyIdUsed),
        status: 'success',
        duration_ms: duration,
      });

      return {
        success: true,
        sessionId,
        response,
      };
    } catch (error: any) {
      logger.error({ err: error, request }, 'Failed to analyze screenshot');

      // Tenta salvar erro no banco se tiver sessionId
      try {
        const screenshot = this.db.getScreenshotById(request.screenshotId);
        if (screenshot) {
          const sessions = this.db.getAISessions(request.screenshotId);
          if (sessions.length > 0) {
            const sessionId = sessions[0].id;
            const duration = Date.now() - startTime;
            this.db.saveAIRun({
              session_id: sessionId,
              provider_id: this.config.providerId,
              model_name: this.config.modelName,
              status: 'error',
              duration_ms: duration,
              error_code: error.code || 'UNKNOWN',
              error_message_redacted: this.sanitizeError(error),
            });
          }
        }
      } catch (dbError) {
        logger.error({ err: dbError }, 'Failed to save error to database');
      }

      return {
        success: false,
        error: this.sanitizeError(error),
      };
    }
  }

  /**
   * Analisa uma mensagem de chat sem screenshot
   */
  async analyzeText(
    request: AnalyzeChatRequest
  ): Promise<AnalyzeChatResponse> {
    const startTime = Date.now();
    let sessionId = request.sessionId || 0;

    try {
      const prompt = request.prompt?.trim() || '';
      if (!prompt) {
        return {
          success: false,
          error: 'Mensagem vazia',
        };
      }

      const context = request.context?.trim();

      if (sessionId) {
        const existing = this.db.getAISessionById(sessionId);
        if (!existing || existing.screenshotId !== null) {
          sessionId = 0;
        }
      }

      if (!sessionId) {
        sessionId = this.db.saveAISession({
          screenshotId: null,
          providerId: this.config.providerId,
          modelName: this.config.modelName,
        });
      }

      const history = this.db.getAIMessages(sessionId);
      const hasSystemMessage = history.some((message) => message.role === 'system');

      if (context && !hasSystemMessage) {
        this.db.saveAIMessage({
          session_id: sessionId,
          role: 'system',
          content: context,
        });
      }

      this.db.saveAIMessage({
        session_id: sessionId,
        role: 'user',
        content: prompt,
      });

      const messages = this.db.getAIMessages(sessionId).map((message) => ({
        role: message.role as 'system' | 'user' | 'assistant',
        content: message.content,
      }));

      const response = await this.analyzeTextWithFallback(messages, request.options);

      this.db.saveAIMessage({
        session_id: sessionId,
        role: 'assistant',
        content: response.answerText,
        recognized_text: response.recognizedText,
      });

      const duration = Date.now() - startTime;
      this.db.saveAIRun({
        session_id: sessionId,
        provider_id: this.config.providerId,
        model_name: this.config.modelName,
        api_key_id: this.toPersistedApiKeyId(response.apiKeyIdUsed),
        status: 'success',
        duration_ms: duration,
      });

      return {
        success: true,
        sessionId,
        response,
      };
    } catch (error: any) {
      logger.error({ err: error, request }, 'Failed to analyze chat text');

      try {
        if (sessionId) {
          const duration = Date.now() - startTime;
          this.db.saveAIRun({
            session_id: sessionId,
            provider_id: this.config.providerId,
            model_name: this.config.modelName,
            status: 'error',
            duration_ms: duration,
            error_code: error.code || 'UNKNOWN',
            error_message_redacted: this.sanitizeError(error),
          });
        }
      } catch (dbError) {
        logger.error({ err: dbError }, 'Failed to save chat error to database');
      }

      return {
        success: false,
        error: this.sanitizeError(error),
      };
    }
  }

  /**
   * Analisa com fallback automático de keys
   */
  private async analyzeWithFallback(
    image: {
      base64Raw: string;
      base64DataUrl: string;
      mimeType: string;
      sourcePath: string;
    },
    messages: VisionRequest['messages'],
    sessionId: number,
    requestOptions?: AnalyzeScreenshotRequest['options']
  ): Promise<VisionResponse & { apiKeyIdUsed?: number }> {
    const providerManager = getAIProviderManager();
    const provider = providerManager.getProvider(this.config.providerId);

    if (!provider) {
      throw new Error(`Provider ${this.config.providerId} not found`);
    }

    let lastError: Error | null = null;
    const maxAttempts = this.config.fallbackMaxAttempts;
    let skipOAuth = this.shouldSkipOAuthForOpenAIModelCalls();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Obtém próxima key disponível
      const apiKey = await this.keyPool.getNextKeyAsync(this.config.providerId, {
        skipOAuth,
      });
      if (!apiKey) {
        const oauthFallback = await this.tryAnalyzeImageWithOpenAIOAuthFallback(
          providerManager,
          image,
          messages,
          requestOptions
        );
        if (oauthFallback) {
          return oauthFallback;
        }

        const providerError = this.getNoAvailableApiKeyError();
        if (providerError) throw providerError;
        const keys = this.db.getAIApiKeys(this.config.providerId);
        const hasInsufficientQuota = keys.some((k) => k.last_error_code === 'insufficient_quota');
        if (hasInsufficientQuota) {
          throw new Error(
            'Nenhuma chave disponível: conta sem quota (insufficient_quota). Verifique billing/créditos.'
          );
        }
        const hasCooldown = keys.some((k) => k.status === 'cooldown');
        if (hasCooldown) {
          throw new Error('Nenhuma chave disponível: todas estão em cooldown.');
        }
        throw new Error('No available API keys');
      }

      try {
        const resolvedMaxTokens = this.resolveMaxTokens(requestOptions?.maxTokens);
        const options: VisionRequest['options'] = {
          temperature: requestOptions?.temperature ?? 0.7,
          timeoutMs: this.config.timeoutMs,
          modelName: this.config.modelName,
          reasoningEffort: this.config.reasoningEffort,
        };
        if (typeof resolvedMaxTokens === 'number') {
          options.maxTokens = resolvedMaxTokens;
        }

        // Prepara request
        const visionRequest: VisionRequest = {
          image: {
            base64Raw: image.base64Raw,
            base64DataUrl: image.base64DataUrl,
            mimeType: image.mimeType,
            originalPath: image.sourcePath,
          },
          messages,
          options,
        };

        // Chama provider
        const response = await provider.analyzeImage(visionRequest, apiKey.key);

        // Marca sucesso
        if (apiKey.id > 0) {
          this.keyPool.markSuccess(apiKey.id);
        }

        return {
          ...response,
          apiKeyIdUsed: apiKey.id > 0 ? apiKey.id : undefined,
        };
      } catch (error: any) {
        lastError = error;

        // Mapeia erro para formato ApiError
        const apiError: ApiError = {
          code: error.code || 'UNKNOWN',
          statusCode: error.statusCode,
          message: error.message || 'Unknown error',
        };

        // Marca falha
        if (apiKey.id > 0) {
          this.keyPool.markFailure(apiKey.id, apiError);
        }

        if (this.shouldFallbackFromOAuthToManual(apiKey, error)) {
          skipOAuth = true;
          logger.warn(
            {
              providerId: this.config.providerId,
              attempt,
              statusCode: error.statusCode,
              error: this.sanitizeError(error),
            },
            'OpenAI OAuth token rejected for model calls; trying manual API key fallback'
          );
          continue;
        }

        // Se é erro não retentável, para imediatamente
        if (error.statusCode === 401 || error.statusCode === 403 || error.nonRetryable === true) {
          throw error;
        }

        logger.warn(
          { attempt, keyId: apiKey.id, error: apiError },
          'Analysis attempt failed, trying next key'
        );
      }
    }

    // Todas as tentativas falharam
    throw lastError || new Error('All analysis attempts failed');
  }

  /**
   * Analisa texto com fallback automático de keys
   */
  private async analyzeTextWithFallback(
    messages: VisionRequest['messages'],
    requestOptions?: AnalyzeChatRequest['options']
  ): Promise<VisionResponse & { apiKeyIdUsed?: number }> {
    const providerManager = getAIProviderManager();
    const provider = providerManager.getProvider(this.config.providerId);

    if (!provider) {
      throw new Error(`Provider ${this.config.providerId} not found`);
    }

    let lastError: Error | null = null;
    const maxAttempts = this.config.fallbackMaxAttempts;
    let skipOAuth = this.shouldSkipOAuthForOpenAIModelCalls();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const apiKey = await this.keyPool.getNextKeyAsync(this.config.providerId, {
        skipOAuth,
      });
      if (!apiKey) {
        const oauthFallback = await this.tryAnalyzeTextWithOpenAIOAuthFallback(
          providerManager,
          messages,
          requestOptions
        );
        if (oauthFallback) {
          return oauthFallback;
        }

        const providerError = this.getNoAvailableApiKeyError();
        if (providerError) throw providerError;
        const keys = this.db.getAIApiKeys(this.config.providerId);
        const hasInsufficientQuota = keys.some((k) => k.last_error_code === 'insufficient_quota');
        if (hasInsufficientQuota) {
          throw new Error(
            'Nenhuma chave disponível: conta sem quota (insufficient_quota). Verifique billing/créditos.'
          );
        }
        const hasCooldown = keys.some((k) => k.status === 'cooldown');
        if (hasCooldown) {
          throw new Error('Nenhuma chave disponível: todas estão em cooldown.');
        }
        throw new Error('No available API keys');
      }

      try {
        const resolvedMaxTokens = this.resolveMaxTokens(requestOptions?.maxTokens);
        const options: VisionRequest['options'] = {
          temperature: requestOptions?.temperature ?? 0.7,
          timeoutMs: this.config.timeoutMs,
          modelName: this.config.modelName,
          reasoningEffort: this.config.reasoningEffort,
        };
        if (typeof resolvedMaxTokens === 'number') {
          options.maxTokens = resolvedMaxTokens;
        }

        const chatRequest = {
          messages,
          options,
        };

        const response = await provider.analyzeText(chatRequest, apiKey.key);

        if (apiKey.id > 0) {
          this.keyPool.markSuccess(apiKey.id);
        }

        return {
          ...response,
          apiKeyIdUsed: apiKey.id > 0 ? apiKey.id : undefined,
        };
      } catch (error: any) {
        lastError = error;

        const apiError: ApiError = {
          code: error.code || 'UNKNOWN',
          statusCode: error.statusCode,
          message: error.message || 'Unknown error',
        };

        if (apiKey.id > 0) {
          this.keyPool.markFailure(apiKey.id, apiError);
        }

        if (this.shouldFallbackFromOAuthToManual(apiKey, error)) {
          skipOAuth = true;
          logger.warn(
            {
              providerId: this.config.providerId,
              attempt,
              statusCode: error.statusCode,
              error: this.sanitizeError(error),
            },
            'OpenAI OAuth token rejected for chat calls; trying manual API key fallback'
          );
          continue;
        }

        if (error.statusCode === 401 || error.statusCode === 403 || error.nonRetryable === true) {
          throw error;
        }

        logger.warn(
          { attempt, keyId: apiKey.id, error: apiError },
          'Chat attempt failed, trying next key'
        );
      }
    }

    throw lastError || new Error('All analysis attempts failed');
  }

  /**
   * Extrai texto de um screenshot (atalho para OCR)
   */
  async extractText(screenshotId: number): Promise<string> {
    const maxTokens = this.resolveMaxTokens();
    const response = await this.analyzeScreenshot({
      screenshotId,
      prompt: '',
      mode: 'extract_text',
      options: typeof maxTokens === 'number' ? { maxTokens } : undefined,
    });

    if (!response.success || !response.response) {
      throw new Error(response.error || 'Failed to extract text');
    }

    if (typeof maxTokens === 'number') {
      const tokensOut = response.response.usage?.tokensOut;
      if (typeof tokensOut === 'number' && tokensOut >= maxTokens - 16) {
        logger.warn(
          { tokensOut, maxTokens },
          'ExtractText output near token limit (may be truncated)'
        );
      }
    }

    return response.response.recognizedText || response.response.answerText;
  }

  /**
   * Cria uma nova sessão para um screenshot
   */
  async createSession(screenshotId: number): Promise<number> {
    return this.db.saveAISession({
      screenshotId,
      providerId: this.config.providerId,
      modelName: this.config.modelName,
    });
  }

  /**
   * Sanitiza mensagens de erro
   */
  private sanitizeError(error: any): string {
    let message = error.message || String(error);
    message = message.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***');
    message = message.replace(/AIza[0-9A-Za-z_-]{35}/g, 'AIza***');
    return message;
  }

  private shouldFallbackFromOAuthToManual(apiKey: { id: number; source?: 'oauth' | 'manual' }, error: any): boolean {
    if (this.config.providerId !== 'openai') {
      return false;
    }

    const isOAuthToken = apiKey.source === 'oauth' || apiKey.id < 0;
    if (!isOAuthToken) return false;

    const statusCode = Number(error?.statusCode);
    if (statusCode !== 401 && statusCode !== 403) {
      return false;
    }

    return true;
  }

  private shouldSkipOAuthForOpenAIModelCalls(): boolean {
    // OpenAI API key provider usa somente chaves manuais.
    if (this.config.providerId === 'openai') {
      return true;
    }
    return false;
  }

  private getNoAvailableApiKeyError(): Error | null {
    if (this.config.providerId === 'openai' && this.hasActiveOpenAIOAuthProfile()) {
      return new Error(
        'Nenhuma API key manual da OpenAI encontrada. OAuth já está conectado; selecione o provider OpenAI OAuth (Codex) em Configurações > API e Modelos.'
      );
    }

    if (this.config.providerId === 'openai') {
      return new Error(
        'Nenhuma API key manual da OpenAI disponível. Adicione uma chave em Configurações > API e Modelos ou conecte via OAuth.'
      );
    }

    if (this.config.providerId === 'openai-codex') {
      return new Error(
        'OpenAI OAuth nao conectado. Faça login em Configuracoes > API e Modelos > OpenAI.'
      );
    }
    return null;
  }

  private hasActiveOpenAIOAuthProfile(): boolean {
    try {
      const controller = getOAuthController();
      const profiles = controller.getTokenStore().listProfiles();
      return profiles.some((profile) => profile.isActive && profile.isEnabled && !profile.isExpired);
    } catch {
      return false;
    }
  }

  private async tryAnalyzeImageWithOpenAIOAuthFallback(
    providerManager: ReturnType<typeof getAIProviderManager>,
    image: {
      base64Raw: string;
      base64DataUrl: string;
      mimeType: string;
      sourcePath: string;
    },
    messages: VisionRequest['messages'],
    requestOptions?: AnalyzeScreenshotRequest['options']
  ): Promise<(VisionResponse & { apiKeyIdUsed?: number }) | null> {
    if (this.config.providerId !== 'openai' || !this.hasActiveOpenAIOAuthProfile()) {
      return null;
    }

    const codexProvider = providerManager.getProvider('openai-codex');
    if (!codexProvider) {
      return null;
    }

    const oauthKey = await this.keyPool.getNextKeyAsync('openai-codex');
    if (!oauthKey) {
      return null;
    }

    const resolvedMaxTokens = this.resolveMaxTokens(requestOptions?.maxTokens);
    const options: VisionRequest['options'] = {
      temperature: requestOptions?.temperature ?? 0.7,
      timeoutMs: this.config.timeoutMs,
      modelName: this.config.modelName,
      reasoningEffort: this.config.reasoningEffort,
    };
    if (typeof resolvedMaxTokens === 'number') {
      options.maxTokens = resolvedMaxTokens;
    }

    const visionRequest: VisionRequest = {
      image: {
        base64Raw: image.base64Raw,
        base64DataUrl: image.base64DataUrl,
        mimeType: image.mimeType,
        originalPath: image.sourcePath,
      },
      messages,
      options,
    };

    logger.warn(
      { providerId: this.config.providerId, fallbackProviderId: 'openai-codex' },
      'No manual OpenAI key available; using OAuth Codex fallback for image analysis'
    );

    const response = await codexProvider.analyzeImage(visionRequest, oauthKey.key);
    return {
      ...response,
      apiKeyIdUsed: oauthKey.id > 0 ? oauthKey.id : undefined,
    };
  }

  private async tryAnalyzeTextWithOpenAIOAuthFallback(
    providerManager: ReturnType<typeof getAIProviderManager>,
    messages: VisionRequest['messages'],
    requestOptions?: AnalyzeChatRequest['options']
  ): Promise<(VisionResponse & { apiKeyIdUsed?: number }) | null> {
    if (this.config.providerId !== 'openai' || !this.hasActiveOpenAIOAuthProfile()) {
      return null;
    }

    const codexProvider = providerManager.getProvider('openai-codex');
    if (!codexProvider) {
      return null;
    }

    const oauthKey = await this.keyPool.getNextKeyAsync('openai-codex');
    if (!oauthKey) {
      return null;
    }

    const resolvedMaxTokens = this.resolveMaxTokens(requestOptions?.maxTokens);
    const options: VisionRequest['options'] = {
      temperature: requestOptions?.temperature ?? 0.7,
      timeoutMs: this.config.timeoutMs,
      modelName: this.config.modelName,
      reasoningEffort: this.config.reasoningEffort,
    };
    if (typeof resolvedMaxTokens === 'number') {
      options.maxTokens = resolvedMaxTokens;
    }

    logger.warn(
      { providerId: this.config.providerId, fallbackProviderId: 'openai-codex' },
      'No manual OpenAI key available; using OAuth Codex fallback for chat analysis'
    );

    const response = await codexProvider.analyzeText({ messages, options }, oauthKey.key);
    return {
      ...response,
      apiKeyIdUsed: oauthKey.id > 0 ? oauthKey.id : undefined,
    };
  }

  private toPersistedApiKeyId(apiKeyId?: number): number | undefined {
    if (typeof apiKeyId !== 'number') return undefined;
    return apiKeyId > 0 ? apiKeyId : undefined;
  }

  private getModelMaxTokens(): number | null {
    try {
      const catalog = loadModelCatalog();
      const provider = catalog.providers?.[this.config.providerId];
      const models = provider?.models || [];
      const model = models.find((entry) => entry.id === this.config.modelName);
      return typeof model?.maxTokens === 'number' ? model.maxTokens : null;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to resolve model max tokens');
      return null;
    }
  }

  private resolveMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
      return Math.floor(maxTokens);
    }
    const modelMaxTokens = this.getModelMaxTokens();
    if (
      typeof modelMaxTokens === 'number' &&
      Number.isFinite(modelMaxTokens) &&
      modelMaxTokens > 0
    ) {
      return Math.floor(modelMaxTokens);
    }
    return undefined;
  }

  private ensureProviderExists(providerId: AIProviderId): void {
    try {
      if (providerId === 'gemini') {
        this.db.saveAIProvider({
          id: 'gemini',
          display_name: 'Google Gemini',
          base_url: 'https://generativelanguage.googleapis.com',
        });
        return;
      }

      if (providerId === 'openai') {
        this.db.saveAIProvider({
          id: 'openai',
          display_name: 'OpenAI (API Key)',
          base_url: 'https://api.openai.com',
        });
        return;
      }

      if (providerId === 'openai-codex') {
        this.db.saveAIProvider({
          id: 'openai-codex',
          display_name: 'OpenAI (OAuth Codex)',
          base_url: 'https://chatgpt.com/backend-api/codex',
        });
        return;
      }

      if (providerId === 'anthropic') {
        this.db.saveAIProvider({
          id: 'anthropic',
          display_name: 'Anthropic Claude (API Key)',
          base_url: 'https://api.anthropic.com',
        });
        return;
      }

      if (providerId === 'claude-code') {
        this.db.saveAIProvider({
          id: 'claude-code',
          display_name: 'Claude (assinatura via Claude Code)',
          base_url: 'claude-code-cli',
        });
        return;
      }

      if (providerId === 'codex-cli') {
        this.db.saveAIProvider({
          id: 'codex-cli',
          display_name: 'ChatGPT (assinatura via Codex CLI)',
          base_url: 'codex-cli',
        });
      }
    } catch (error) {
      logger.warn({ err: error, providerId }, 'Failed to ensure AI provider exists');
    }
  }
}
