import { VisionProvider, VisionRequest, VisionResponse, ChatRequest, ModelInfo, AIProviderId } from '@neo/shared';
import { getLogger } from '@neo/logger';

const logger = getLogger();

/**
 * Classe base abstrata para providers de visão
 * Implementa lógica comum: timeout, retries, error handling
 */
export abstract class BaseVisionProvider implements VisionProvider {
  abstract id: AIProviderId;
  protected defaultTimeout: number = 30000; // 30s
  protected defaultRetries: number = 2;

  /**
   * Lista modelos disponíveis
   */
  abstract listModels(): Promise<ModelInfo[]>;

  /**
   * Analisa uma imagem (implementação específica do provider)
   */
  protected abstract analyzeImageInternal(
    req: VisionRequest,
    apiKey: string
  ): Promise<VisionResponse>;

  /**
   * Analisa um texto (implementação específica do provider)
   */
  protected abstract analyzeTextInternal(
    req: ChatRequest,
    apiKey: string
  ): Promise<VisionResponse>;

  /**
   * Analisa uma imagem com retry e timeout
   */
  async analyzeImage(req: VisionRequest, apiKey: string): Promise<VisionResponse> {
    const timeout = this.resolveTimeoutMs(req.options);
    const retries = req.options?.maxTokens ? 0 : this.defaultRetries; // Se tem maxTokens, assume que retries já foram feitos

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          logger.debug({ provider: this.id, attempt }, 'Retrying image analysis');
          // Backoff exponencial
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }

        const response = await Promise.race([
          this.analyzeImageInternal(req, apiKey),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          ),
        ]);

        return response;
      } catch (error: any) {
        lastError = error;
        logger.warn(
          { err: error, provider: this.id, attempt },
          'Image analysis attempt failed'
        );

        // Não retry em erros de autenticação ou quota
        if (this.isNonRetryableError(error)) {
          throw error;
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Analisa texto com retry e timeout
   */
  async analyzeText(req: ChatRequest, apiKey: string): Promise<VisionResponse> {
    const timeout = this.resolveTimeoutMs(req.options);
    const retries = req.options?.maxTokens ? 0 : this.defaultRetries;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          logger.debug({ provider: this.id, attempt }, 'Retrying text analysis');
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }

        const response = await Promise.race([
          this.analyzeTextInternal(req, apiKey),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          ),
        ]);

        return response;
      } catch (error: any) {
        lastError = error;
        logger.warn(
          { err: error, provider: this.id, attempt },
          'Text analysis attempt failed'
        );

        if (this.isNonRetryableError(error)) {
          throw error;
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Reasoning models think before answering and routinely exceed the generic
   * request timeout. Providers raise the floor for those models.
   */
  protected minTimeoutMsFor(_modelName?: string): number {
    return 0;
  }

  private resolveTimeoutMs(options?: ChatRequest['options']): number {
    const requested = options?.timeoutMs || this.defaultTimeout;
    return Math.max(requested, this.minTimeoutMsFor(options?.modelName));
  }

  /**
   * Verifica se um erro não deve ser retentado
   */
  protected isNonRetryableError(error: any): boolean {
    // Providers flag errors that retrying cannot fix (login, quota, refusals).
    if (error?.nonRetryable === true) {
      return true;
    }

    // Erros de autenticação (401, 403)
    if (error.statusCode === 401 || error.statusCode === 403) {
      return true;
    }

    // Erros de formato/validação (400)
    if (error.statusCode === 400) {
      return true;
    }

    return false;
  }

  /**
   * Converte imagem para base64 se necessário
   */
  protected async imageToBase64(imagePath: string): Promise<{ base64: string; mimeType: string }> {
    const { readFileSync } = await import('fs');
    const { extname } = await import('path');

    const imageBuffer = readFileSync(imagePath);
    const ext = extname(imagePath).toLowerCase();
    
    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') {
      mimeType = 'image/jpeg';
    } else if (ext === '.webp') {
      mimeType = 'image/webp';
    }

    const base64 = imageBuffer.toString('base64');
    return { base64, mimeType };
  }

  /**
   * Sanitiza mensagens de erro (remove informações sensíveis)
   */
  protected sanitizeError(error: any): string {
    let message = error.message || String(error);
    
    // Remove possíveis vazamentos de API keys
    message = message.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***');
    message = message.replace(/AIza[0-9A-Za-z_-]{35}/g, 'AIza***');
    
    return message;
  }
}

