import { AIConfig, AIProviderId } from '@neo/shared';
import { getModelsForProvider } from '../modelCatalog';
import { OPENAI_DEFAULT_MODEL } from '../openaiModels';

const FALLBACK_DEFAULT_MODEL: Partial<Record<AIProviderId, string>> = {
  gemini: 'gemini-2.5-flash',
  openai: OPENAI_DEFAULT_MODEL,
  'openai-codex': OPENAI_DEFAULT_MODEL,
  anthropic: 'claude-opus-5-5',
  'claude-code': 'claude-opus-5-5',
  'codex-cli': 'gpt-6.1-sol',
};

function getKnownModelIds(providerId: AIProviderId): string[] {
  // fallback vazio => se não existir no catálogo, retorna lista vazia.
  const models = getModelsForProvider(providerId, []);
  return models.map((m) => m.id);
}

export function getPreferredModelNameForProvider(providerId: AIProviderId): string | null {
  const knownIds = getKnownModelIds(providerId);
  if (knownIds.length > 0) {
    return knownIds[0];
  }
  return FALLBACK_DEFAULT_MODEL[providerId] ?? null;
}

export function isModelKnownForProvider(
  providerId: AIProviderId,
  modelName: string | null | undefined
): boolean {
  if (!modelName) return false;
  // The Codex CLI's model list depends on the account and changes often (the UI reads it
  // from the CLI), so any id is accepted instead of being reset to the first catalog entry.
  if (providerId === 'codex-cli') return true;
  const knownIds = getKnownModelIds(providerId).map((id) => id.toLowerCase());
  return knownIds.includes(modelName.toLowerCase());
}

export function normalizeAIConfigPatch(
  current: AIConfig,
  patch: Partial<AIConfig>
): {
  normalizedPatch: Partial<AIConfig>;
  nextConfig: AIConfig;
  didChangeModel: boolean;
} {
  const providerChanged =
    patch.providerId !== undefined && patch.providerId !== current.providerId;
  const modelTouched = patch.modelName !== undefined;

  // Importante: só valida/ajusta modelo quando o provider mudou OU o modelo foi explicitamente alterado.
  // Isso evita “resetar” o modelo em saves que só mexem em timeout/retries/etc.
  if (!providerChanged && !modelTouched) {
    return {
      normalizedPatch: patch,
      nextConfig: { ...current, ...patch },
      didChangeModel: false,
    };
  }

  const nextProviderId = (patch.providerId ?? current.providerId) as AIProviderId;
  const candidateModelName = patch.modelName ?? current.modelName;

  if (isModelKnownForProvider(nextProviderId, candidateModelName)) {
    return {
      normalizedPatch: patch,
      nextConfig: { ...current, ...patch },
      didChangeModel: false,
    };
  }

  const preferred = getPreferredModelNameForProvider(nextProviderId);
  if (!preferred) {
    return {
      normalizedPatch: patch,
      nextConfig: { ...current, ...patch },
      didChangeModel: false,
    };
  }

  const normalizedPatch: Partial<AIConfig> = { ...patch, modelName: preferred };
  return {
    normalizedPatch,
    nextConfig: { ...current, ...normalizedPatch },
    didChangeModel: true,
  };
}

