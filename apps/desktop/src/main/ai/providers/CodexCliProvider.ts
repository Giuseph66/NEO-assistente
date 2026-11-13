import { AIProviderId, ChatRequest, ModelInfo, VisionRequest, VisionResponse } from '@neo/shared';
import { BaseVisionProvider } from './BaseProvider';
import { getModelsForProvider } from '../modelCatalog';
import { CODEX_CLI_MODELS } from '../codexCliModels';
import { CodexCli, CodexCliError, getCodexCli } from '../codexCli/CodexCli';
import { buildClaudeCodePrompt } from './ClaudeCodeProvider';

export { CODEX_CLI_VIRTUAL_KEY } from '../codexCli/CodexCli';
const CODEX_CLI_TIMEOUT_MS = 300_000;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * ChatGPT through the user's subscription, via the official Codex CLI (`codex exec`).
 * Login/logout happen in Codex (`codex login`). Replaces nothing: the older
 * `openai-codex` provider (the app's own OAuth login) stays available.
 */
export class CodexCliProvider extends BaseVisionProvider {
  id: AIProviderId = 'codex-cli';
  private readonly cli: CodexCli;

  constructor(cli: CodexCli = getCodexCli()) {
    super();
    this.cli = cli;
  }

  async listModels(): Promise<ModelInfo[]> {
    return getModelsForProvider('codex-cli', CODEX_CLI_MODELS);
  }

  protected minTimeoutMsFor(): number {
    return CODEX_CLI_TIMEOUT_MS;
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
        timeoutMs: Math.max(req.options?.timeoutMs ?? 0, CODEX_CLI_TIMEOUT_MS),
      });
      return {
        answerText: result.text,
        usage: { tokensIn: result.inputTokens, tokensOut: result.outputTokens },
        modelUsed: model || 'codex',
        providerUsed: 'codex-cli',
      };
    } catch (error) {
      if (error instanceof CodexCliError) {
        const wrapped = new Error(error.message) as Error & { statusCode?: number; code?: string; nonRetryable?: boolean };
        wrapped.code = error.code;
        wrapped.statusCode =
          error.statusCode ?? (error.code === 'not_installed' || error.code === 'not_logged_in' ? 401 : undefined);
        // Login, quota and install problems do not go away by calling the CLI again.
        wrapped.nonRetryable = ['not_installed', 'not_logged_in', 'rate_limited', 'aborted'].includes(error.code);
        throw wrapped;
      }
      throw error;
    }
  }
}
