import type { ModelInfo } from '@neo/shared';

/**
 * Claude models offered in the app (Anthropic API). Kept free of imports from the
 * catalog/provider modules so both can depend on it without an import cycle.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 32_000;

export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    provider: 'anthropic',
    supportsVision: true,
    maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    supportsStreaming: true,
    metadata: { category: 'Raciocínio (padrão)' },
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    provider: 'anthropic',
    supportsVision: true,
    maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    supportsStreaming: true,
    metadata: { category: 'Raciocínio rápido' },
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    provider: 'anthropic',
    supportsVision: true,
    maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    supportsStreaming: true,
    metadata: { category: 'Rápido e barato' },
  },
  {
    id: 'claude-fable-5-2',
    name: 'Claude Fable 5.2',
    provider: 'anthropic',
    supportsVision: true,
    maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    supportsStreaming: true,
    metadata: { category: 'Mais capaz' },
  },
];
