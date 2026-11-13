import Anthropic from '@anthropic-ai/sdk';
import {
  AIProviderId,
  ChatRequest,
  ModelInfo,
  ReasoningEffort,
  VisionRequest,
  VisionResponse,
} from '@neo/shared';
import { getLogger } from '@neo/logger';
import { BaseVisionProvider } from './BaseProvider';
import { getModelsForProvider } from '../modelCatalog';
import { ANTHROPIC_MODELS, ANTHROPIC_DEFAULT_MAX_TOKENS } from '../anthropicModels';

export { ANTHROPIC_MODELS };

const logger = getLogger();

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_MAX_TOKENS = ANTHROPIC_DEFAULT_MAX_TOKENS;
const DEFAULT_EFFORT: ReasoningEffort = 'medium';
/** Thinking models at high effort can take minutes; streaming keeps the HTTP request alive. */
const ANTHROPIC_TIMEOUT_MS = 300_000;

/**
 * On a safety refusal these models can be re-run server-side on a fallback model
 * (`fallbacks: "default"` routes by refusal category). Claude Haiku 5.5 has no
 * server-side fallback, so it is not listed.
 */
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MODELS_WITH_SERVER_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);


type AnthropicMessagesClient = Pick<Anthropic, 'beta'>;
export type AnthropicClientFactory = (apiKey: string) => AnthropicMessagesClient;

const defaultClientFactory: AnthropicClientFactory = (apiKey) =>
  new Anthropic({ apiKey, timeout: ANTHROPIC_TIMEOUT_MS });

type ProviderError = Error & { statusCode?: number; code?: string };

/**
 * Claude through the official Anthropic API (API key from console.anthropic.com).
 * Text and vision; thinking depth is controlled with `output_config.effort`.
 */
export class AnthropicProvider extends BaseVisionProvider {
  id: AIProviderId = 'anthropic';
  private readonly createClient: AnthropicClientFactory;

  constructor(createClient: AnthropicClientFactory = defaultClientFactory) {
    super();
    this.createClient = createClient;
  }

  async listModels(): Promise<ModelInfo[]> {
    return getModelsForProvider('anthropic', ANTHROPIC_MODELS);
  }

  protected minTimeoutMsFor(): number {
    return ANTHROPIC_TIMEOUT_MS;
  }

  protected async analyzeImageInternal(req: VisionRequest, apiKey: string): Promise<VisionResponse> {
    const data = req.image.base64Raw || req.image.base64;
    if (!data) {
      throw new Error('Image base64 required');
    }
    const mediaType = IMAGE_MEDIA_TYPES.has(req.image.mimeType) ? req.image.mimeType : 'image/png';
    const image: Anthropic.Beta.BetaImageBlockParam = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType as Anthropic.Beta.BetaBase64ImageSource['media_type'],
        data,
      },
    };
    return this.send(req, apiKey, image);
  }

  protected async analyzeTextInternal(req: ChatRequest, apiKey: string): Promise<VisionResponse> {
    return this.send(req, apiKey);
  }

  private async send(
    req: ChatRequest,
    apiKey: string,
    image?: Anthropic.Beta.BetaImageBlockParam
  ): Promise<VisionResponse> {
    const model = (req.options?.modelName || ANTHROPIC_DEFAULT_MODEL).trim().toLowerCase();
    const { system, messages } = toAnthropicMessages(req.messages, image);
    const useFallback = MODELS_WITH_SERVER_FALLBACK.has(model);

    // Thinking is adaptive (on by default) on every listed model, so `thinking` is
    // omitted and depth is set through effort. `temperature` is not sent: current
    // Claude models reject sampling parameters.
    const params = {
      model,
      max_tokens: normalizeMaxTokens(req.options?.maxTokens),
      ...(system ? { system } : {}),
      messages,
      output_config: { effort: req.options?.reasoningEffort || DEFAULT_EFFORT },
      ...(useFallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };

    let message: Anthropic.Beta.BetaMessage;
    try {
      logger.debug({ model, effort: params.output_config.effort, fallback: useFallback }, 'Calling Anthropic API');
      message = await this.createClient(apiKey).beta.messages.stream(params).finalMessage();
    } catch (error) {
      throw toProviderError(error);
    }

    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category;
      const error: ProviderError = new Error(
        `Claude recusou a solicitação${category ? ` (${category})` : ''}.`
      );
      error.statusCode = 400;
      error.code = 'refusal';
      (error as ProviderError & { nonRetryable?: boolean }).nonRetryable = true;
      throw error;
    }
    if (message.stop_reason === 'max_tokens') {
      logger.warn({ model }, 'Anthropic response hit max_tokens (output truncated)');
    }

    const answerText = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return {
      answerText,
      raw: message,
      usage: {
        tokensIn: message.usage.input_tokens,
        tokensOut: message.usage.output_tokens,
      },
      // With a server-side fallback the answering model can differ from the requested one.
      modelUsed: message.model || model,
      providerUsed: 'anthropic',
    };
  }
}

function normalizeMaxTokens(maxTokens?: number): number {
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    return Math.floor(maxTokens);
  }
  return DEFAULT_MAX_TOKENS;
}

/**
 * Converts the app's message list to the Messages API shape: system messages go
 * to the top-level `system`, the conversation must start with a user turn, and the
 * image (if any) is attached to the last user turn, before its text.
 */
export function toAnthropicMessages(
  input: ChatRequest['messages'],
  image?: Anthropic.Beta.BetaImageBlockParam
): { system?: string; messages: Anthropic.Beta.BetaMessageParam[] } {
  const system = input
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');

  const turns = input.filter((m) => m.role !== 'system');
  while (turns.length > 0 && turns[0].role !== 'user') {
    turns.shift();
  }

  let lastUserIndex = -1;
  turns.forEach((m, index) => {
    if (m.role === 'user') lastUserIndex = index;
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((m, index) => {
    if (image && index === lastUserIndex) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [image];
      if (m.content.trim()) content.push({ type: 'text', text: m.content });
      return { role: 'user', content };
    }
    return { role: m.role as 'user' | 'assistant', content: m.content };
  });

  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: image ? [image, { type: 'text', text: 'Analise esta imagem.' }] : '',
    });
  }

  return { system: system || undefined, messages };
}

/** Maps SDK errors to the `statusCode`/`code` contract used by ApiKeyPool and AIService. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIError) {
    const wrapped: ProviderError = new Error(`Anthropic API error: ${error.status ?? 'network'} - ${error.message}`);
    wrapped.statusCode = error.status;
    const isCreditError = error.status === 400 && /credit balance/i.test(error.message);
    wrapped.code = isCreditError ? 'insufficient_quota' : error.type || 'API_ERROR';
    return wrapped;
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Lists model ids available to this key (used by the settings UI and key test). */
export async function listAnthropicModelIds(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey, timeout: 15_000, maxRetries: 1 });
  const ids: string[] = [];
  for await (const model of client.models.list()) {
    ids.push(model.id);
  }
  return ids;
}
