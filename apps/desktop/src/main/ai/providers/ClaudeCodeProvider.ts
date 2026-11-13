import { AIProviderId, ChatRequest, ModelInfo, VisionRequest, VisionResponse } from '@neo/shared';
import { BaseVisionProvider } from './BaseProvider';
import { getModelsForProvider } from '../modelCatalog';
import { ANTHROPIC_MODELS } from '../anthropicModels';
import { ClaudeCodeCli, ClaudeCodeError, getClaudeCodeCli } from '../claudeCode/ClaudeCodeCli';

export { CLAUDE_CODE_VIRTUAL_KEY } from '../claudeCode/ClaudeCodeCli';
const CLAUDE_CODE_TIMEOUT_MS = 300_000;

export const CLAUDE_CODE_MODELS: ModelInfo[] = ANTHROPIC_MODELS.map((model) => ({
  ...model,
  provider: 'claude-code',
}));

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Claude through the user's Claude.ai subscription, via the official Claude Code CLI
 * (`claude -p`). Login/logout happen in Claude Code (`claude auth login`).
 */
export class ClaudeCodeProvider extends BaseVisionProvider {
  id: AIProviderId = 'claude-code';
  private readonly cli: ClaudeCodeCli;

  constructor(cli: ClaudeCodeCli = getClaudeCodeCli()) {
    super();
    this.cli = cli;
  }

  async listModels(): Promise<ModelInfo[]> {
    return getModelsForProvider('claude-code', CLAUDE_CODE_MODELS);
  }

  protected minTimeoutMsFor(): number {
    return CLAUDE_CODE_TIMEOUT_MS;
  }

  protected async analyzeImageInternal(req: VisionRequest): Promise<VisionResponse> {
    const base64 = req.image.base64Raw || req.image.base64;
    if (!base64) {
      throw new Error('Image base64 required');
    }
    const extension = IMAGE_EXTENSIONS[req.image.mimeType] ?? 'png';
    return this.run(req, { data: Buffer.from(base64, 'base64'), extension });
  }

  protected async analyzeTextInternal(req: ChatRequest): Promise<VisionResponse> {
    return this.run(req);
  }

  private async run(req: ChatRequest, image?: { data: Buffer; extension: string }): Promise<VisionResponse> {
    const model = (req.options?.modelName || '').trim().toLowerCase() || undefined;
    const { systemPrompt, prompt } = buildClaudeCodePrompt(req.messages);
    try {
      const result = await this.cli.run({
        prompt,
        systemPrompt,
        model,
        effort: req.options?.reasoningEffort,
        image,
        timeoutMs: Math.max(req.options?.timeoutMs ?? 0, CLAUDE_CODE_TIMEOUT_MS),
      });
      return {
        answerText: result.text,
        usage: { tokensIn: result.inputTokens, tokensOut: result.outputTokens },
        modelUsed: result.model || model || 'claude-code',
        providerUsed: 'claude-code',
      };
    } catch (error) {
      if (error instanceof ClaudeCodeError) {
        // statusCode/code feed AIService's retry decisions (401/403 are never retried).
        const wrapped = new Error(error.message) as Error & { statusCode?: number; code?: string; nonRetryable?: boolean };
        wrapped.code = error.code;
        wrapped.nonRetryable = ['not_installed', 'not_logged_in', 'rate_limited', 'aborted'].includes(error.code);
        wrapped.statusCode =
          error.statusCode ?? (error.code === 'not_installed' || error.code === 'not_logged_in' ? 401 : undefined);
        throw wrapped;
      }
      throw error;
    }
  }
}

/**
 * `claude -p` takes one prompt: system messages become the system prompt and earlier
 * turns are replayed as a transcript before the latest user message.
 */
export function buildClaudeCodePrompt(messages: ChatRequest['messages']): { systemPrompt?: string; prompt: string } {
  const systemPrompt = messages
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');

  let lastUser = -1;
  turns.forEach((m, index) => {
    if (m.role === 'user') lastUser = index;
  });
  const current = lastUser >= 0 ? turns[lastUser].content : '';
  const history = turns.slice(0, lastUser >= 0 ? lastUser : turns.length);

  const prompt = history.length
    ? [
        'Histórico da conversa até agora:',
        ...history.map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`),
        '',
        'Nova mensagem do usuário:',
        current || '(sem texto)',
      ].join('\n')
    : current || 'Analise a imagem.';

  return { systemPrompt: systemPrompt || undefined, prompt };
}
