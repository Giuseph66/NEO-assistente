import { describe, expect, it } from 'vitest';
import { getModelsForProvider, mergeCatalog } from './modelCatalog';
import { filterOpenAIChatModelIds, OPENAI_CURRENT_MODELS } from './openaiModels';
import { getPreferredModelNameForProvider, isModelKnownForProvider, normalizeAIConfigPatch } from './utils/aiConfigNormalization';

const model = (id: string) => ({ id, name: id, supportsVision: true });
const catalog = (version: number, providers: Record<string, string[]>) => ({
  version,
  providers: Object.fromEntries(Object.entries(providers).map(([k, ids]) => [k, { models: ids.map(model) }])),
});

describe('mergeCatalog', () => {
  it('replaces lists written by an older catalog version (stale ids must not linger)', () => {
    const stored = catalog(1, {
      openai: ['gpt-4o', 'gpt-4.1', 'gpt-5.4', 'gpt-5.2-codex'],
      custom: ['minha-conta-gpt'],
    });
    const seed = catalog(2, { openai: ['gpt-6.1-sol', 'gpt-6-luna'] });

    const { catalog: merged, updated } = mergeCatalog(seed, stored);

    expect(updated).toBe(true);
    expect(merged.version).toBe(2);
    expect(merged.providers.openai.models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
    expect(merged.providers.custom.models.map((m) => m.id)).toEqual(['minha-conta-gpt']); // not in the seed: kept
  });

  it('on the same version keeps what the user has and only appends missing models', () => {
    const stored = catalog(2, { openai: ['gpt-6.1-sol', 'meu-modelo'] });
    const seed = catalog(2, { openai: ['gpt-6.1-sol', 'gpt-6-luna'] });
    const { catalog: merged, updated } = mergeCatalog(seed, stored);
    expect(updated).toBe(true);
    expect(merged.providers.openai.models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'meu-modelo', 'gpt-6-luna']);

    const again = mergeCatalog(seed, merged);
    expect(again.updated).toBe(false); // stable: nothing is rewritten on every start
  });
});

describe('OpenAI model lists', () => {
  it('offers the current line for both OpenAI providers and none of the retired ids', () => {
    for (const providerId of ['openai', 'openai-codex'] as const) {
      const ids = getModelsForProvider(providerId, []).map((m) => m.id);
      expect(ids).toEqual(OPENAI_CURRENT_MODELS.map((m) => m.id));
      expect(ids[0]).toBe('gpt-6.1-sol');
      for (const retired of ['gpt-4o', 'gpt-4.1', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex']) {
        expect(ids).not.toContain(retired);
      }
    }
  });

  it('defaults to the first current model', () => {
    expect(getPreferredModelNameForProvider('openai')).toBe('gpt-6.1-sol');
    expect(getPreferredModelNameForProvider('openai-codex')).toBe('gpt-6.1-sol');
    expect(isModelKnownForProvider('openai', 'GPT-6-Luna')).toBe(true); // case-insensitive
    expect(isModelKnownForProvider('openai', 'gpt-5.2-codex')).toBe(false);
  });

  it('keeps only chat models from the live /v1/models list, newest first', () => {
    const ids = filterOpenAIChatModelIds([
      'text-embedding-3-large',
      'whisper-1',
      'gpt-4o-mini-tts',
      'gpt-4o-audio-preview',
      'gpt-image-1',
      'dall-e-3',
      'gpt-6-luna',
      'gpt-6.1-sol',
      'o3',
      'gpt-5.6-sol',
      'gpt-5.6-sol-2026-01-15', // dated snapshot duplicates the alias
      'gpt-6-luna',
    ]);
    expect(ids).toEqual(['o3', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-sol']);
  });
});

describe('model normalisation when switching provider', () => {
  const current = {
    providerId: 'claude-code' as const,
    modelName: 'claude-opus-5-5',
    timeoutMs: 1, retries: 1, streaming: false, saveHistory: true, maxImageDimension: 1, maxImageBytes: 1,
    imageQuality: 1, enableImageOptimization: true, fallbackMaxAttempts: 1, fallbackCooldownMinutes: 1,
  };

  it('does not send another vendor\'s model, or a display label, to the Codex CLI', () => {
    expect(isModelKnownForProvider('codex-cli', 'gpt-6-luna')).toBe(true);
    expect(isModelKnownForProvider('codex-cli', 'o3')).toBe(true);
    expect(isModelKnownForProvider('codex-cli', 'claude-opus-5-5')).toBe(false);
    expect(isModelKnownForProvider('codex-cli', 'GPT-5.2 Standard')).toBe(false);
    expect(isModelKnownForProvider('codex-cli', 'gpt-5.2 standard')).toBe(false);
  });

  it('replaces the carried-over model with the provider default (the real session #37 case)', () => {
    const switched = normalizeAIConfigPatch(current, { providerId: 'codex-cli' });
    expect(switched.didChangeModel).toBe(true);
    expect(switched.normalizedPatch.modelName).toBe('gpt-6.1-sol');

    const keepsValid = normalizeAIConfigPatch(current, { providerId: 'codex-cli', modelName: 'gpt-6-luna' });
    expect(keepsValid.didChangeModel).toBe(false);
  });
});
