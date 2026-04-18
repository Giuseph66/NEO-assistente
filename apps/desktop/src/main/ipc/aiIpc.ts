import { ipcMain, BrowserWindow } from 'electron';
import { DatabaseManager } from '../database';
import { getAIService, getKeyStorage } from '../ai/AIServiceManager';
import { getAIProviderManager } from '../ai/AIProviderManager';
import { ApiKeyPool } from '../ai/ApiKeyPool';
import { getAIConfigStore } from '../storage/aiConfigStore';
import {
  AIConfig,
  AIProviderId,
  AnalyzeScreenshotRequest,
  AnalyzeChatRequest,
  PromptTemplate,
} from '@neo/shared';
import { getLogger } from '@neo/logger';

const logger = getLogger();
import { normalizeAIConfigPatch } from '../ai/utils/aiConfigNormalization';

/**
 * Broadcast para todas as janelas
 */
const broadcast = (channel: string, payload: any) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.isDestroyed()) return;
    const contents = win.webContents;
    if (contents.isDestroyed() || contents.isCrashed()) return;
    try {
      contents.send(channel, payload);
    } catch {
      // Ignora frames que estão sendo descartados
    }
  });
};

/**
 * Registra todos os handlers IPC para AI
 */
export function registerAIIpc(db: DatabaseManager): void {
  const keyStorage = getKeyStorage();
  const providerManager = getAIProviderManager();
  const aiConfigStore = getAIConfigStore();
  let activePersonalityId: number | null = null;

  const mapPromptTemplate = (t: any) => ({
    id: t.id,
    name: t.name,
    promptText: t.prompt_text,
    category: t.category,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  });

  const broadcastPersonalitiesUpdate = () => {
    const templates = db.getPromptTemplates('personality').map(mapPromptTemplate);
    broadcast('ai.personalities.updated', {
      personalities: templates,
      activePersonalityId,
    });
  };

  const ensureDefaultTemplates = () => {
    const existing = db.getPromptTemplates();
    if (existing.length > 0) return;
    const defaults = [
      { name: 'Extrair texto', prompt_text: 'Extraia todo o texto visível nesta imagem, mantendo quebras de linha e estrutura. Retorne apenas o texto.', category: 'ocr' },
      { name: 'Resumir', prompt_text: 'Resuma o conteúdo principal desta imagem em tópicos curtos.', category: 'summary' },
      { name: 'Explicar erro', prompt_text: 'Explique o erro mostrado na imagem e sugira como corrigir.', category: 'debug' },
      { name: 'Listar elementos', prompt_text: 'Liste os principais elementos visíveis na imagem.', category: 'analysis' },
    ];
    defaults.forEach((template) => {
      db.savePromptTemplate(template);
    });
  };
  ensureDefaultTemplates();

  const ensureDefaultProviders = () => {
    try {
      db.saveAIProvider({
        id: 'gemini',
        display_name: 'Google Gemini',
        base_url: 'https://generativelanguage.googleapis.com',
      });
      db.saveAIProvider({
        id: 'openai',
        display_name: 'OpenAI (API Key)',
        base_url: 'https://api.openai.com',
      });
      db.saveAIProvider({
        id: 'openai-codex',
        display_name: 'OpenAI (OAuth Codex)',
        base_url: 'https://chatgpt.com/backend-api/codex',
      });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to ensure default AI providers');
    }
  };
  ensureDefaultProviders();

  // ========== Config ==========

  ipcMain.handle('ai.getConfig', async () => {
    const aiService = getAIService(db);
    return aiService.getConfig();
  });

  ipcMain.handle('ai.saveConfig', async (_event, config: Partial<AIConfig>) => {
    const aiService = getAIService(db);
    const current = aiService.getConfig();
    const { normalizedPatch, didChangeModel } = normalizeAIConfigPatch(current, config);
    if (didChangeModel) {
      logger.warn(
        {
          oldProviderId: current.providerId,
          newProviderId: normalizedPatch.providerId ?? current.providerId,
          oldModelName: current.modelName,
          newModelName: normalizedPatch.modelName,
          patch: config,
        },
        'Config patch adjusted to match provider'
      );
    }
    aiService.updateConfig(normalizedPatch);
    const next = aiService.getConfig();

    // Persistir apenas a seleção essencial para restaurar a última IA (provider + modelo)
    aiConfigStore.setLastConfig({
      providerId: next.providerId,
      modelName: next.modelName,
    });

    return next;
  });

  // ========== Providers ==========

  ipcMain.handle('ai.listProviders', async () => {
    const providers = providerManager.listProviders();
    return providers.map((p) => ({
      id: p.id,
      name:
        p.id === 'gemini'
          ? 'Google Gemini'
          : p.id === 'openai'
            ? 'OpenAI (API Key)'
            : p.id === 'openai-codex'
              ? 'OpenAI (OAuth Codex)'
              : p.id,
    }));
  });

  ipcMain.handle('ai.listModels', async (_event, providerId: AIProviderId) => {
    const provider = providerManager.getProvider(providerId);
    if (!provider) {
      return [];
    }
    return provider.listModels();
  });

  ipcMain.handle('ai.fetchOnlineModels', async (_event, providerId: AIProviderId) => {
    if (providerId === 'openai-codex') {
        return await new Promise<string[]>((resolve) => {
          const WebSocket = require('ws');
          const ws = new WebSocket("ws://127.0.0.1:4500");
          const timeout = setTimeout(() => {
            ws.close();
            resolve([]);
          }, 5000);

          ws.on('open', () => {
            ws.send(JSON.stringify({
              method: "initialize",
              id: 1,
              params: {
                clientInfo: {
                  name: "neo_desktop",
                  title: "NEO Desktop",
                  version: "1.0.0"
                }
              }
            }));
            ws.send(JSON.stringify({
              method: "initialized",
              params: {}
            }));
            ws.send(JSON.stringify({
              method: "model/list",
              id: 2,
              params: {
                limit: 50,
                includeHidden: true
              }
            }));
          });

          ws.on('message', (data: any) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.id === 2) {
                clearTimeout(timeout);
                ws.close();
                if (msg.result && msg.result.data) {
                  resolve(msg.result.data.map((m: any) => m.model || m.id));
                } else {
                  resolve([]);
                }
              }
            } catch (e) {}
          });

          ws.on('error', (err: any) => {
            logger.error({ err }, "Codex server WebSocket error");
            clearTimeout(timeout);
            resolve([]);
          });
        });
      }

      const keyPool = new ApiKeyPool(db, keyStorage);
      const key = await keyPool.getNextKeyAsync(providerId);

      if (!key || !key.key) {
        const provider = providerManager.getProvider(providerId);
        return provider ? provider.listModels().then(m => m.map(x => x.name)) : [];
      }

    try {
      if (providerId === 'openai') {
        const response = await fetch("https://api.openai.com/v1/models", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${key.key}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          return (data.data || []).map((m: any) => m.id);
        }
      } else if (providerId === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key.key}`,
          { method: "GET" }
        );
        if (response.ok) {
          const data = await response.json();
          return (data.models || []).map((m: any) => m.name.replace('models/', ''));
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch online models');
    }
    
    // Fallback if network fails
    const provider = providerManager.getProvider(providerId);
    return provider ? provider.listModels().then(m => m.map(x => x.name)) : [];
  });

  // ========== API Keys ==========

  ipcMain.handle('ai.addKey', async (_event, { providerId, key, alias }: { providerId: string; key: string; alias: string }) => {
    const keyPool = new ApiKeyPool(db, keyStorage);
    const keyId = keyPool.addKey(providerId, key, alias);
    logger.info({ providerId, keyId, alias }, 'API key added');
    return { success: true, keyId };
  });

  ipcMain.handle('ai.removeKey', async (_event, keyId: number) => {
    const keyPool = new ApiKeyPool(db, keyStorage);
    keyPool.removeKey(keyId);
    logger.info({ keyId }, 'API key removed');
    return { success: true };
  });

  ipcMain.handle('ai.updateKeyStatus', async (_event, { keyId, status }: { keyId: number; status: 'active' | 'cooldown' | 'disabled' }) => {
    const keyPool = new ApiKeyPool(db, keyStorage);
    keyPool.updateKeyStatus(keyId, status);
    return { success: true };
  });

  ipcMain.handle('ai.listKeys', async (_event, providerId?: string) => {
    if (providerId) {
      const keys = db.getAIApiKeys(providerId);
      return keys.map((k) => ({
        id: k.id,
        providerId: k.provider_id,
        alias: k.alias,
        last4: k.last4,
        status: k.status,
        cooldownUntil: k.cooldown_until,
        successCount: k.success_count,
        failureCount: k.failure_count,
        lastErrorCode: k.last_error_code,
        lastUsedAt: k.last_used_at,
      }));
    }
    // Lista todas as keys de todos os providers
    const providers = db.getAIProviders();
    const allKeys: any[] = [];
    for (const provider of providers) {
      const keys = db.getAIApiKeys(provider.id);
      allKeys.push(...keys.map((k) => ({
        id: k.id,
        providerId: k.provider_id,
        alias: k.alias,
        last4: k.last4,
        status: k.status,
        cooldownUntil: k.cooldown_until,
        successCount: k.success_count,
        failureCount: k.failure_count,
        lastErrorCode: k.last_error_code,
        lastUsedAt: k.last_used_at,
      })));
    }
    return allKeys;
  });

  ipcMain.handle('ai.testKey', async (_event, { keyId, providerId }: { keyId: number; providerId: AIProviderId }) => {
    const keyPool = new ApiKeyPool(db, keyStorage);
    const provider = providerManager.getProvider(providerId);

    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const result = await keyPool.testKey(keyId, async (key: string) => {
      // Faz uma chamada de teste simples (sem imagem)
      try {
        // Para Gemini, podemos fazer uma chamada simples
        if (providerId === 'gemini') {
          const primary = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${key}`
          );
          if (primary.ok) {
            return true;
          }
          const fallback = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
          );
          return fallback.ok;
        }

        // Para OpenAI, testa listando modelos
        if (providerId === 'openai') {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
              Authorization: `Bearer ${key}`,
            },
          });
          return response.ok;
        }

        if (providerId === 'openai-codex') {
          return false;
        }

        return false;
      } catch (error) {
        logger.error({ err: error }, 'Key test failed');
        return false;
      }
    });

    return result;
  });

  // ========== Analysis ==========

  ipcMain.handle('ai.analyzeScreenshot', async (_event, request: AnalyzeScreenshotRequest) => {
    const aiService = getAIService(db);
    const config = aiService.getConfig();

    // Broadcast início
    broadcast('ai.analysis.started', {
      mode: 'screenshot',
      screenshotId: request.screenshotId,
      startedAt: Date.now(),
      timeoutMs: config.timeoutMs,
    });

    try {
      const result = await aiService.analyzeScreenshot(request);

      // Broadcast sucesso
      broadcast('ai.analysis.completed', {
        mode: 'screenshot',
        screenshotId: request.screenshotId,
        sessionId: result.sessionId,
        success: result.success,
        usage: result.response?.usage,
        model: result.response?.modelUsed,
        provider: result.response?.providerUsed,
      });

      return result;
    } catch (error: any) {
      logger.error({ err: error }, 'Analysis failed');

      // Broadcast erro
      broadcast('ai.analysis.error', {
        mode: 'screenshot',
        screenshotId: request.screenshotId,
        error: error.message || 'Unknown error',
      });

      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  });

  ipcMain.handle('ai.analyzeText', async (_event, request: AnalyzeChatRequest) => {
    const aiService = getAIService(db);
    const config = aiService.getConfig();

    broadcast('ai.analysis.started', {
      mode: 'chat',
      startedAt: Date.now(),
      timeoutMs: config.timeoutMs,
      sessionId: request.sessionId,
      prompt: request.prompt,
    });

    try {
      const result = await aiService.analyzeText(request);

      broadcast('ai.analysis.completed', {
        mode: 'chat',
        sessionId: result.sessionId,
        success: result.success,
        usage: result.response?.usage,
        model: result.response?.modelUsed,
        provider: result.response?.providerUsed,
      });

      return result;
    } catch (error: any) {
      logger.error({ err: error }, 'Chat analysis failed');

      broadcast('ai.analysis.error', {
        mode: 'chat',
        sessionId: request.sessionId,
        error: error.message || 'Unknown error',
      });

      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  });

  ipcMain.handle('ai.extractText', async (_event, screenshotId: number) => {
    const aiService = getAIService(db);

    try {
      const text = await aiService.extractText(screenshotId);
      return { success: true, text };
    } catch (error: any) {
      logger.error({ err: error }, 'Text extraction failed');
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  });

  // ========== Sessions ==========

  ipcMain.handle('ai.getSessions', async (_event, screenshotId: number) => {
    const sessions = db.getAISessions(screenshotId);
    return sessions.map((s) => ({
      id: s.id,
      screenshotId: s.screenshotId,
      providerId: s.providerId,
      modelName: s.modelName,
      createdAt: s.createdAt,
    }));
  });

  ipcMain.handle('ai.getMessages', async (_event, sessionId: number) => {
    const messages = db.getAIMessages(sessionId);
    return messages.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      recognizedText: m.recognized_text || undefined,
      createdAt: m.created_at,
    }));
  });

  ipcMain.handle('ai.createSession', async (_event, screenshotId: number) => {
    const aiService = getAIService(db);
    const sessionId = await aiService.createSession(screenshotId);
    return { sessionId };
  });

  // ========== Prompt Templates ==========

  ipcMain.handle('ai.savePromptTemplate', async (_event, template: any) => {
    // Converter de camelCase (frontend) para snake_case (database)
    // O frontend envia { name, promptText, category }
    // O database espera { name, prompt_text, category }
    const dbTemplate = {
      name: template.name,
      prompt_text: template.promptText || template.prompt_text || '',
      category: template.category || null,
    };

    if (!dbTemplate.name || !dbTemplate.prompt_text) {
      throw new Error('Nome e prompt_text são obrigatórios');
    }

    const id = db.savePromptTemplate(dbTemplate as any);
    logger.info({ id, name: dbTemplate.name }, 'Prompt template saved');
    broadcastPersonalitiesUpdate();
    return { success: true, id };
  });

  ipcMain.handle('ai.getPromptTemplates', async (_event, category?: string) => {
    const templates = db.getPromptTemplates(category);
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      promptText: t.prompt_text,
      category: t.category,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));
  });

  ipcMain.handle('ai.deletePromptTemplate', async (_event, id: number) => {
    db.deletePromptTemplate(id);
    broadcastPersonalitiesUpdate();
    return { success: true };
  });

  // ========== Active Personality ==========

  ipcMain.handle('ai.setActivePersonality', async (_event, promptId: number | null) => {
    activePersonalityId = promptId;
    logger.info({ promptId }, 'Active personality updated');
    broadcastPersonalitiesUpdate();
    return { success: true, promptId };
  });

  ipcMain.handle('ai.getActivePersonality', async () => {
    return { promptId: activePersonalityId };
  });

  logger.info('AI IPC handlers registered');
}
