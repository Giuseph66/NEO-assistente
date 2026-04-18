import { BaseVisionProvider } from './BaseProvider';
import { VisionRequest, VisionResponse, ChatRequest, ModelInfo, AIProviderId } from '@neo/shared';
import { getLogger } from '@neo/logger';
import { getModelsForProvider } from '../modelCatalog';
import { getOAuthController } from '../../auth/openaiOAuth';

const logger = getLogger();

/**
 * Provider para OpenAI Vision API
 */
export class OpenAIProvider extends BaseVisionProvider {
  id: AIProviderId;
  private transport: 'api' | 'codex';
  private baseUrl = 'https://api.openai.com/v1';
  private codexBaseUrl = 'https://chatgpt.com/backend-api/codex';

  constructor(options?: { id?: AIProviderId; transport?: 'api' | 'codex' }) {
    super();
    this.id = options?.id || 'openai';
    this.transport = options?.transport || 'api';
  }

  async listModels(): Promise<ModelInfo[]> {
    const fallback: ModelInfo[] = this.transport === 'codex'
      ? [
        {
          id: 'GPT-5.3-Codex',
          name: 'GPT-5.3-Codex',
          provider: this.id,
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
      ]
      : [
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          provider: this.id,
          supportsVision: true,
          maxTokens: 4096,
          supportsStreaming: false,
        },
      ];

    return getModelsForProvider(this.id, fallback);
  }

  protected async analyzeImageInternal(
    req: VisionRequest,
    apiKey: string
  ): Promise<VisionResponse> {
    if (this.transport === 'codex') {
      if (!this.isLikelyOAuthToken(apiKey)) {
        throw this.createProviderMismatchError(
          'OpenAI Codex requer login OAuth. Selecione OpenAI API Key para usar chave manual.'
        );
      }
      return this.analyzeImageWithCodexBackend(req, apiKey);
    }
    if (this.isLikelyOAuthToken(apiKey)) {
      throw this.createProviderMismatchError(
        'Token OAuth detectado no provider OpenAI API Key. Selecione OpenAI OAuth (Codex).'
      );
    }

    const modelName = req.options?.modelName || 'gpt-4o';
    
    // Converte imagem para base64 se necessário
    let imageUrl: string;
    if (req.image.base64DataUrl) {
      imageUrl = req.image.base64DataUrl;
    } else if (req.image.base64Raw || req.image.base64) {
      const raw = req.image.base64Raw || req.image.base64;
      imageUrl = `data:${req.image.mimeType};base64,${raw}`;
    } else {
      throw new Error('Image base64 required');
    }

    // Constrói mensagens no formato OpenAI
    const messages: any[] = [];

    // System message (se houver)
    const systemMessage = req.messages.find((m) => m.role === 'system')?.content;
    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }

    const userMessages = req.messages.filter((m) => m.role === 'user');
    const lastUser = userMessages[userMessages.length - 1];
    const otherMessages = req.messages.filter((m) => m.role !== 'system');
    otherMessages.forEach((message) => {
      if (message.role === 'user' && message === lastUser) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
            {
              type: 'text',
              text: lastUser?.content || '',
            },
          ],
        });
      } else {
        messages.push({
          role: message.role,
          content: message.content,
        });
      }
    });

    const maxTokens = this.normalizeMaxTokens(req.options?.maxTokens);
    const requestBody: any = {
      model: modelName,
      messages,
      temperature: req.options?.temperature ?? 0.7,
    };
    if (typeof maxTokens === 'number') {
      requestBody.max_tokens = maxTokens;
    }

    const url = `${this.baseUrl}/chat/completions`;

    logger.debug({ model: modelName }, 'Calling OpenAI API');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      const errorMessage = errorData.error?.message || 'Unknown error';
      
      logger.error(
        { status: response.status, error: errorMessage },
        'OpenAI API error'
      );
      
      // Mapeia códigos de erro
      const error: any = new Error(`OpenAI API error: ${response.status} - ${this.sanitizeError({ message: errorMessage })}`);
      error.statusCode = response.status;
      error.code = errorData.error?.code || 'API_ERROR';
      throw error;
    }

    const data = await response.json();

    // Extrai resposta do OpenAI
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    const content = choice.message?.content || '';
    
    // OpenAI não retorna texto reconhecido separadamente, mas pode estar na resposta
    const recognizedText = this.extractRecognizedText(content);

    return {
      recognizedText,
      answerText: content,
      raw: data,
      usage: {
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: data.usage?.completion_tokens,
      },
      modelUsed: modelName,
      providerUsed: this.id,
    };
  }

  protected async analyzeTextInternal(
    req: ChatRequest,
    apiKey: string
  ): Promise<VisionResponse> {
    if (this.transport === 'codex') {
      if (!this.isLikelyOAuthToken(apiKey)) {
        throw this.createProviderMismatchError(
          'OpenAI Codex requer login OAuth. Selecione OpenAI API Key para usar chave manual.'
        );
      }
      return this.analyzeTextWithCodexBackend(req, apiKey);
    }
    if (this.isLikelyOAuthToken(apiKey)) {
      throw this.createProviderMismatchError(
        'Token OAuth detectado no provider OpenAI API Key. Selecione OpenAI OAuth (Codex).'
      );
    }

    const modelName = req.options?.modelName || 'gpt-4o';

    const messages: any[] = [];
    const systemMessage = req.messages.find((m) => m.role === 'system')?.content;
    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }

    req.messages
      .filter((m) => m.role !== 'system')
      .forEach((message) => {
        messages.push({
          role: message.role,
          content: message.content,
        });
      });

    const maxTokens = this.normalizeMaxTokens(req.options?.maxTokens);
    const requestBody: any = {
      model: modelName,
      messages,
      temperature: req.options?.temperature ?? 0.7,
    };
    if (typeof maxTokens === 'number') {
      requestBody.max_tokens = maxTokens;
    }

    const url = `${this.baseUrl}/chat/completions`;

    logger.debug({ model: modelName }, 'Calling OpenAI API (text)');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      const errorMessage = errorData.error?.message || 'Unknown error';

      logger.error(
        { status: response.status, error: errorMessage },
        'OpenAI API error'
      );

      const error: any = new Error(`OpenAI API error: ${response.status} - ${this.sanitizeError({ message: errorMessage })}`);
      error.statusCode = response.status;
      error.code = errorData.error?.code || 'API_ERROR';
      throw error;
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    const content = choice.message?.content || '';
    const recognizedText = this.extractRecognizedText(content);

    return {
      recognizedText,
      answerText: content,
      raw: data,
      usage: {
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: data.usage?.completion_tokens,
      },
      modelUsed: modelName,
      providerUsed: this.id,
    };
  }

  /**
   * Tenta extrair texto reconhecido da resposta (OCR)
   */
  private extractRecognizedText(content: string): string | undefined {
    // Se a resposta começa com algo como "Texto extraído:" ou similar, podemos tentar extrair
    // Por enquanto, retornamos undefined e deixamos o modelo fazer OCR
    return undefined;
  }

  private normalizeMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
      return Math.floor(maxTokens);
    }
    return undefined;
  }

  private isLikelyOAuthToken(token: string): boolean {
    if (!token) return false;
    const trimmed = token.trim();
    if (!trimmed) return false;
    // OpenAI API keys start with sk-; OAuth bearer tokens are JWT-like.
    if (trimmed.startsWith('sk-')) return false;
    return trimmed.split('.').length >= 3;
  }

  private createProviderMismatchError(message: string): Error & { statusCode: number; code: string } {
    const error: any = new Error(message);
    error.statusCode = 400;
    error.code = 'PROVIDER_MISMATCH';
    return error;
  }

  private getChatGptAccountId(): string | undefined {
    try {
      const controller = getOAuthController();
      const store = controller.getTokenStore();
      const activeProfileId = store.getActiveProfileId();
      if (!activeProfileId) return undefined;
      const profile = store.getProfile(activeProfileId);
      return profile?.accountId || undefined;
    } catch {
      return undefined;
    }
  }

  private resolveCodexModel(modelName?: string): string {
    const candidate = (modelName || '').trim();
    if (!candidate) return 'GPT-5.3-Codex';
    return candidate;
  }

  private isCodexUnsupportedModelError(status: number, errorMessage: string, errorType: string): boolean {
    if (status !== 400) return false;
    const message = (errorMessage || '').toLowerCase();
    const type = (errorType || '').toLowerCase();
    return (
      type.includes('unsupported') ||
      message.includes('model is not supported') ||
      message.includes('not supported when using codex')
    );
  }

  private extractResponseText(data: any): string {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text;
    }

    const chunks: string[] = [];
    const output = Array.isArray(data?.output) ? data.output : [];
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const block of content) {
        const text = typeof block?.text === 'string' ? block.text : '';
        if (text) chunks.push(text);
      }
    }

    return chunks.join('\n').trim();
  }

  private buildCodexInputFromMessages(messages: Array<{ role: string; content: string }>): string {
    return messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');
  }

  private resolveCodexInstructions(
    systemMessage: string,
    mode: 'text' | 'vision'
  ): string {
    const trimmed = (systemMessage || '').trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    if (mode === 'vision') {
      return 'You are an assistant that analyzes images and responds clearly in plain text.';
    }

    return 'You are a helpful assistant. Respond clearly and directly.';
  }

  private applyCodexMaxTokens(body: any, maxTokens?: number): void {
    if (typeof maxTokens !== 'number') {
      return;
    }
    body.max_tokens = maxTokens;
  }

  private getUnsupportedCodexParameter(errorMessage: string): string | undefined {
    const match = /unsupported parameter:\s*([a-zA-Z0-9_.-]+)/i.exec(errorMessage || '');
    return match?.[1];
  }

  private buildCodexHeaders(accessToken: string, includeAccountId: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    if (includeAccountId) {
      const accountId = this.getChatGptAccountId();
      if (accountId) {
        headers['chatgpt-account-id'] = accountId;
      }
    }
    return headers;
  }

  private async readCodexError(response: Response): Promise<{ status: number; message: string; type: string }> {
    const status = response.status;
    let raw = '';
    let payload: any = null;

    try {
      raw = await response.text();
      if (raw) {
        payload = JSON.parse(raw);
      }
    } catch {
      payload = null;
    }

    const detailValue = payload?.detail;
    const detailMessage = Array.isArray(detailValue)
      ? detailValue.map((entry) => entry?.msg || JSON.stringify(entry)).join('; ')
      : typeof detailValue === 'string'
        ? detailValue
        : '';

    const message =
      payload?.error?.message ||
      payload?.message ||
      detailMessage ||
      (raw && raw.trim().length > 0 ? raw.slice(0, 300) : '') ||
      'Unknown error';
    const type = payload?.error?.type || payload?.error?.code || payload?.code || 'API_ERROR';

    return {
      status,
      message,
      type,
    };
  }

  private isLikelySsePayload(raw: string): boolean {
    const trimmed = (raw || '').trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) return true;
    return /\n\s*(data:|event:)/.test(trimmed);
  }

  private parseCodexSseText(raw: string): any {
    const textChunks: string[] = [];
    let lastPayload: any = null;
    let responseSnapshot: any = null;

    const pushText = (value: unknown) => {
      if (typeof value === 'string' && value.length > 0) {
        textChunks.push(value);
      }
    };

    const consumePayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;

      lastPayload = payload;
      if (payload.response && typeof payload.response === 'object') {
        responseSnapshot = payload.response;
      }

      pushText(payload.delta);
      pushText(payload.text);
      pushText(payload.output_text);
      pushText(payload.response?.output_text);

      const output = Array.isArray(payload.output) ? payload.output : [];
      for (const item of output) {
        const content = Array.isArray(item?.content) ? item.content : [];
        for (const block of content) {
          pushText(block?.text);
          pushText(block?.delta);
        }
      }
    };

    const lines = raw.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('event:')) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          consumePayload(JSON.parse(data));
        } catch {
          pushText(data);
        }
        continue;
      }
      try {
        consumePayload(JSON.parse(line));
      } catch {
        // Ignore non-JSON lines.
      }
    }

    const finalData = responseSnapshot || lastPayload || {};
    if (!finalData.output_text && textChunks.length > 0) {
      finalData.output_text = textChunks.join('');
    }
    if (!finalData.usage && lastPayload?.usage) {
      finalData.usage = lastPayload.usage;
    }

    return finalData;
  }

  private parseCodexSuccessPayload(raw: string): any {
    const trimmed = (raw || '').trim();
    if (!trimmed) {
      return {};
    }

    if (this.isLikelySsePayload(trimmed)) {
      return this.parseCodexSseText(trimmed);
    }

    try {
      return JSON.parse(trimmed);
    } catch (error: any) {
      if (trimmed.includes('event:') || trimmed.includes('data:')) {
        return this.parseCodexSseText(trimmed);
      }
      const message = this.sanitizeError({ message: error?.message || 'Invalid response payload' });
      throw new Error(`OpenAI Codex OAuth error: 502 - Invalid response payload (${message})`);
    }
  }

  private async readCodexSuccess(response: Response): Promise<any> {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/event-stream')) {
      const raw = await response.text();
      return this.parseCodexSuccessPayload(raw);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const raw = await response.text();
      return this.parseCodexSuccessPayload(raw);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let streamText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      streamText += decoder.decode(value, { stream: true });
    }

    streamText += decoder.decode();
    return this.parseCodexSuccessPayload(streamText);
  }

  private async requestCodexResponses(
    buildBodies: (model: string) => any[],
    accessToken: string,
    initialModel: string,
    requestedModel: string | undefined,
    mode: 'text' | 'vision'
  ): Promise<{ data: any; modelUsed: string }> {
    let modelToUse = initialModel;
    let didModelFallback = false;
    let lastError: { status: number; message: string; type: string } = {
      status: 400,
      message: 'Unknown error',
      type: 'API_ERROR',
    };

    while (true) {
      let shouldRetryWithFallbackModel = false;

      for (const rawBody of buildBodies(modelToUse)) {
        const body: any = { ...rawBody };
        // Defensive normalization: Codex backend expects `input` to always be a list.
        if (!Array.isArray(body.input)) {
          if (typeof body.input === 'string') {
            body.input = [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: body.input,
                  },
                ],
              },
            ];
          } else if (body.input == null) {
            body.input = [];
          } else {
            body.input = [body.input];
          }
        }
        // Codex backend (ChatGPT account flow) requires stream=true.
        body.stream = true;

        const headerVariants = [
          this.buildCodexHeaders(accessToken, true),
          this.buildCodexHeaders(accessToken, false),
        ];

        // Dedup simples caso não exista account-id.
        const uniqueVariants = Array.from(
          new Map(headerVariants.map((headers) => [JSON.stringify(headers), headers])).values()
        );

        for (const headers of uniqueVariants) {
          const requestBody: any = { ...body };
          const removedUnsupported = new Set<string>();

          while (true) {
            const response = await fetch(`${this.codexBaseUrl}/responses`, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
            });

            if (response.ok) {
              return {
                data: await this.readCodexSuccess(response),
                modelUsed: modelToUse,
              };
            }

            const errorInfo = await this.readCodexError(response);
            lastError = errorInfo;

            const unsupportedParam = this.getUnsupportedCodexParameter(errorInfo.message);
            if (
              errorInfo.status === 400 &&
              unsupportedParam &&
              Object.prototype.hasOwnProperty.call(requestBody, unsupportedParam) &&
              !removedUnsupported.has(unsupportedParam)
            ) {
              removedUnsupported.add(unsupportedParam);
              delete requestBody[unsupportedParam];
              logger.warn(
                { unsupportedParam, mode, model: modelToUse },
                'Codex backend rejected unsupported parameter, retrying without it'
              );
              continue;
            }

            if (
              !didModelFallback &&
              this.isCodexUnsupportedModelError(errorInfo.status, errorInfo.message, errorInfo.type) &&
              modelToUse !== 'GPT-5.3-Codex'
            ) {
              didModelFallback = true;
              shouldRetryWithFallbackModel = true;
              modelToUse = 'GPT-5.3-Codex';
              logger.warn(
                { requestedModel, fallbackModel: modelToUse, mode, status: errorInfo.status, errorType: errorInfo.type },
                'Codex backend rejected selected model, retrying with GPT-5.3-Codex'
              );
              break;
            }

            break;
          }

          if (shouldRetryWithFallbackModel) {
            break;
          }
        }

        if (shouldRetryWithFallbackModel) {
          break;
        }
      }

      if (shouldRetryWithFallbackModel) {
        continue;
      }

      break;
    }

    const error: any = new Error(
      `OpenAI Codex OAuth error: ${lastError.status} - ${this.sanitizeError({ message: lastError.message })}`
    );
    error.statusCode = lastError.status;
    error.code = lastError.type;
    throw error;
  }

  private async analyzeTextWithCodexBackend(
    req: ChatRequest,
    accessToken: string
  ): Promise<VisionResponse> {
    const modelName = this.resolveCodexModel(req.options?.modelName);
    const systemMessage = req.messages.find((m) => m.role === 'system')?.content || '';
    const instructions = this.resolveCodexInstructions(systemMessage, 'text');
    const transcript = this.buildCodexInputFromMessages(
      req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }))
    );

    const maxTokens = this.normalizeMaxTokens(req.options?.maxTokens);
    const inputText = transcript || req.messages.map((m) => m.content).join('\n\n');

    const { data, modelUsed } = await this.requestCodexResponses(
      (currentModel) => {
        const primaryBody: any = {
          model: currentModel,
          store: false,
          instructions,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: inputText,
                },
              ],
            },
          ],
        };
        const fallbackBody: any = {
          model: currentModel,
          store: false,
          instructions,
          input: [
            {
              type: 'input_text',
              text: inputText,
            },
          ],
        };
        this.applyCodexMaxTokens(primaryBody, maxTokens);
        this.applyCodexMaxTokens(fallbackBody, maxTokens);
        return [primaryBody, fallbackBody];
      },
      accessToken,
      modelName,
      req.options?.modelName,
      'text'
    );

    const content = this.extractResponseText(data);
    if (!content) {
      throw new Error('No response from OpenAI Codex backend');
    }

    return {
      recognizedText: undefined,
      answerText: content,
      raw: data,
      usage: {
        tokensIn: data?.usage?.input_tokens,
        tokensOut: data?.usage?.output_tokens,
      },
      modelUsed,
      providerUsed: this.id,
    };
  }

  private async analyzeImageWithCodexBackend(
    req: VisionRequest,
    accessToken: string
  ): Promise<VisionResponse> {
    const modelName = this.resolveCodexModel(req.options?.modelName);
    const systemMessage = req.messages.find((m) => m.role === 'system')?.content || '';
    const instructions = this.resolveCodexInstructions(systemMessage, 'vision');
    const userPrompt = req.messages.find((m) => m.role === 'user')?.content || 'Analise esta imagem.';

    let imageUrl = req.image.base64DataUrl || '';
    if (!imageUrl && (req.image.base64Raw || req.image.base64)) {
      const raw = req.image.base64Raw || req.image.base64;
      imageUrl = `data:${req.image.mimeType};base64,${raw}`;
    }
    if (!imageUrl) {
      throw new Error('Image base64 required');
    }

    const maxTokens = this.normalizeMaxTokens(req.options?.maxTokens);

    const { data, modelUsed } = await this.requestCodexResponses(
      (currentModel) => {
        const primaryBody: any = {
          model: currentModel,
          store: false,
          instructions,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: userPrompt,
                },
                {
                  type: 'input_image',
                  image_url: imageUrl,
                },
              ],
            },
          ],
        };
        const fallbackBody: any = {
          model: currentModel,
          store: false,
          instructions,
          input: [
            {
              type: 'input_text',
              text: userPrompt,
            },
            {
              type: 'input_image',
              image_url: imageUrl,
            },
          ],
        };
        this.applyCodexMaxTokens(primaryBody, maxTokens);
        this.applyCodexMaxTokens(fallbackBody, maxTokens);
        return [primaryBody, fallbackBody];
      },
      accessToken,
      modelName,
      req.options?.modelName,
      'vision'
    );
    const content = this.extractResponseText(data);
    if (!content) {
      throw new Error('No response from OpenAI Codex backend');
    }

    return {
      recognizedText: this.extractRecognizedText(content),
      answerText: content,
      raw: data,
      usage: {
        tokensIn: data?.usage?.input_tokens,
        tokensOut: data?.usage?.output_tokens,
      },
      modelUsed,
      providerUsed: this.id,
    };
  }
}
