import type { ModelInfo } from '@neo/shared';

/**
 * Fallback list for the Codex CLI provider. The real list depends on the signed-in
 * account and changes often; the UI asks the CLI (`codex debug models`) for it.
 */
export const CODEX_CLI_DEFAULT_MAX_TOKENS = 32_000;

const model = (id: string, name: string): ModelInfo => ({
  id,
  name,
  provider: 'codex-cli',
  supportsVision: true,
  maxTokens: CODEX_CLI_DEFAULT_MAX_TOKENS,
  supportsStreaming: false,
});

export const CODEX_CLI_MODELS: ModelInfo[] = [
  model('gpt-6.1-sol', 'GPT-6.1 Sol'),
  model('gpt-6.1-terra', 'GPT-6.1 Terra'),
  model('gpt-6-sol', 'GPT-6 Sol'),
  model('gpt-6-astra', 'GPT-6 Astra'),
  model('gpt-6-luna', 'GPT-6 Luna'),
  model('gpt-5.6-sol', 'GPT-5.6 Sol'),
  model('gpt-5.6-terra', 'GPT-5.6 Terra'),
  model('gpt-5.6-luna', 'GPT-5.6 Luna'),
];
