import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ModelInfo, AIProviderId } from '@neo/shared';
import { ANTHROPIC_MODELS } from './anthropicModels';
import { CODEX_CLI_MODELS } from './codexCliModels';
import { OPENAI_CURRENT_MODELS } from './openaiModels';

type ProviderCatalog = {
  models: Array<Omit<ModelInfo, 'provider'>>;
};

type ModelCatalog = {
  version: number;
  providers: Record<string, ProviderCatalog>;
};

/**
 * Catalog version. When it is higher than the version of the catalog stored in userData,
 * the seed replaces the stored lists (see mergeCatalog), so stale model ids do not linger.
 */
const CATALOG_VERSION = 3;

const DEFAULT_CATALOG: ModelCatalog = {
  version: CATALOG_VERSION,
  providers: {
    gemini: {
      models: [
        {
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: false,
          metadata: {
            category: 'Modelos de saida de texto',
          },
        },
        {
          id: 'gemini-2.5-flash-lite',
          name: 'Gemini 2.5 Flash Lite',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: false,
          metadata: {
            category: 'Modelos de saida de texto',
          },
        },
        {
          id: 'gemini-2.5-flash-tts',
          name: 'Gemini 2.5 Flash TTS',
          supportsVision: true,
          supportsStreaming: false,
          metadata: {
            category: 'Modelos generativos multimodais',
          },
        },
        {
          id: 'gemini-3-flash',
          name: 'Gemini 3 Flash',
          supportsVision: true,
          supportsStreaming: false,
          metadata: {
            category: 'Modelos de saida de texto',
          },
        },
        {
          id: 'gemini-robotics-er-1.5-preview',
          name: 'Gemini Robotics ER 1.5 Preview',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'Outros modelos',
          },
        },
        {
          id: 'gemma-3-12b',
          name: 'Gemma 3 12B',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'Outros modelos',
          },
        },
        {
          id: 'gemma-3-1b',
          name: 'Gemma 3 1B',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'Outros modelos',
          },
        },
        {
          id: 'gemma-3-27b',
          name: 'Gemma 3 27B',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'Outros modelos',
          },
        },
        {
          id: 'gemma-3-2b',
          name: 'Gemma 3 2B',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'Outros modelos',
          },
        },
        {
          id: 'gemma-3-4b',
          name: 'Gemma 3 4B',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'Outros modelos',
          },
        },
        {
          id: 'gemini-2.5-flash-native-audio-dialog',
          name: 'Gemini 2.5 Flash Native Audio Dialog',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'API Live',
          },
        },
        {
          id: 'gemini-2.5-flash-native-audio-preview-12-2025',
          name: 'Gemini 2.5 Flash Native Audio Preview 12-2025',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'API Live (preview)',
          },
        },
        {
          id: 'gemini-live-2.5-flash-preview',
          name: 'Gemini Live 2.5 Flash Preview',
          supportsVision: false,
          supportsStreaming: false,
          metadata: {
            category: 'API Live (preview)',
          },
        },
      ],
    },
    openai: {
      models: OPENAI_CURRENT_MODELS,
    },
    'openai-codex': {
      models: OPENAI_CURRENT_MODELS,
    },
    anthropic: {
      models: ANTHROPIC_MODELS.map(({ provider: _provider, ...model }) => model),
    },
    'claude-code': {
      models: ANTHROPIC_MODELS.map(({ provider: _provider, ...model }) => model),
    },
    'codex-cli': {
      models: CODEX_CLI_MODELS.map(({ provider: _provider, ...model }) => model),
    },
  },
};

export function mergeCatalog(seed: ModelCatalog, existing: ModelCatalog): { catalog: ModelCatalog; updated: boolean } {
  let updated = false;
  // A newer seed is authoritative: the stored catalog only ever *added* models, so lists
  // written by older versions would otherwise keep retired ids (gpt-4o, GPT-5.x…) forever.
  const seedIsNewer = (existing.version || 1) < (seed.version || 1);
  const merged: ModelCatalog = {
    version: Math.max(existing.version || 1, seed.version || 1),
    providers: { ...existing.providers },
  };
  if (merged.version !== (existing.version || 1)) updated = true;

  Object.entries(seed.providers || {}).forEach(([providerId, seedProvider]) => {
    const existingProvider = merged.providers?.[providerId];
    if (seedIsNewer || !existingProvider || !Array.isArray(existingProvider.models)) {
      merged.providers[providerId] = { models: [...seedProvider.models] };
      updated = true;
      return;
    }
    const existingIds = new Set(existingProvider.models.map((model) => model.id));
    seedProvider.models.forEach((model) => {
      if (!existingIds.has(model.id)) {
        existingProvider.models.push(model);
        existingIds.add(model.id);
        updated = true;
      }
    });
  });

  return { catalog: merged, updated };
}

export function getModelCatalogPath(): string | null {
  if (!app.isReady()) {
    return null;
  }
  return join(app.getPath('userData'), 'ai-models.json');
}

export function normalizeModels(
  providerId: AIProviderId,
  models: Array<Omit<ModelInfo, 'provider'>>
): ModelInfo[] {
  // Older catalogs stored ids like `GPT-5.4`; the APIs use lowercase ids. Keep one
  // entry per id (case-insensitive), preferring the lowercase spelling.
  const byId = new Map<string, Omit<ModelInfo, 'provider'>>();
  for (const model of models) {
    const key = model.id.toLowerCase();
    const existing = byId.get(key);
    if (!existing || (existing.id !== key && model.id === key)) {
      byId.set(key, existing ? { ...existing, ...model } : model);
    }
  }
  return Array.from(byId.values()).map((model) => ({
    ...model,
    provider: providerId,
  }));
}

export function loadModelCatalog(): ModelCatalog {
  // Sempre tenta carregar o arquivo padrão (mesmo se app não estiver pronto)
  const defaultCatalogPath = app.isPackaged
    ? join(__dirname, 'modelCatalog.default.json')
    : join(process.cwd(), 'src', 'main', 'ai', 'modelCatalog.default.json');

  let seedCatalog = DEFAULT_CATALOG;
  if (existsSync(defaultCatalogPath)) {
    try {
      const rawDefault = readFileSync(defaultCatalogPath, 'utf-8');
      const parsedDefault = JSON.parse(rawDefault);
      if (parsedDefault && typeof parsedDefault === 'object' && parsedDefault.providers) {
        // JSON seed entries come first (their order defines the default model);
        // providers/models that exist only in DEFAULT_CATALOG are appended.
        seedCatalog = mergeCatalog(DEFAULT_CATALOG, parsedDefault as ModelCatalog).catalog;
      }
    } catch {
      seedCatalog = DEFAULT_CATALOG;
    }
  }

  // Só tenta acessar userData se o app estiver pronto
  const catalogPath = getModelCatalogPath();
  if (!catalogPath) {
    return seedCatalog;
  }

  if (!existsSync(catalogPath)) {
    try {
      writeFileSync(catalogPath, JSON.stringify(seedCatalog, null, 2));
    } catch {
      return seedCatalog;
    }
  }

  try {
    const raw = readFileSync(catalogPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.providers) {
      const { catalog, updated } = mergeCatalog(seedCatalog, parsed as ModelCatalog);
      if (updated) {
        try {
          writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
        } catch {
          // ignore write failures
        }
      }
      return catalog;
    }
  } catch {
    return seedCatalog;
  }

  return seedCatalog;
}

export function getModelsForProvider(
  providerId: AIProviderId,
  fallback: ModelInfo[]
): ModelInfo[] {
  const catalog = loadModelCatalog();
  const provider = catalog.providers?.[providerId];
  if (!provider || !Array.isArray(provider.models)) {
    return fallback;
  }
  return normalizeModels(providerId, provider.models);
}
