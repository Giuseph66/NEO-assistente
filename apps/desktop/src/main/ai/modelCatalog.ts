import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ModelInfo, AIProviderId } from '@neo/shared';

type ProviderCatalog = {
  models: Array<Omit<ModelInfo, 'provider'>>;
};

type ModelCatalog = {
  version: number;
  providers: Record<string, ProviderCatalog>;
};

const DEFAULT_CATALOG: ModelCatalog = {
  version: 1,
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
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-5.4-mini',
          name: 'GPT-5.4-Mini',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3-Codex',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-5.2-codex',
          name: 'GPT-5.2-Codex',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          supportsVision: true,
          maxTokens: 4096,
          supportsStreaming: true,
        },
      ],
    },
    'openai-codex': {
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-5.4-mini',
          name: 'GPT-5.4-Mini',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3-Codex',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
        {
          id: 'gpt-5.2-codex',
          name: 'GPT-5.2-Codex',
          supportsVision: true,
          maxTokens: 8192,
          supportsStreaming: true,
        },
      ],
    },
  },
};

function mergeCatalog(seed: ModelCatalog, existing: ModelCatalog): { catalog: ModelCatalog; updated: boolean } {
  let updated = false;
  const merged: ModelCatalog = {
    version: Math.max(existing.version || 1, seed.version || 1),
    providers: { ...existing.providers },
  };

  Object.entries(seed.providers || {}).forEach(([providerId, seedProvider]) => {
    const existingProvider = merged.providers?.[providerId];
    if (!existingProvider || !Array.isArray(existingProvider.models)) {
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

function normalizeModels(
  providerId: AIProviderId,
  models: Array<Omit<ModelInfo, 'provider'>>
): ModelInfo[] {
  return models.map((model) => ({
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
        seedCatalog = parsedDefault as ModelCatalog;
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
