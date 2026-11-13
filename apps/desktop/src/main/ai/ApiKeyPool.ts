import { DatabaseManager } from '../database';
import { KeyStorage } from './storage/KeyStorage';
import { getLogger } from '@neo/logger';
import { AIApiKey, AIProviderId } from '@neo/shared';
import { getOAuthController } from '../auth/openaiOAuth';
import { CLAUDE_CODE_VIRTUAL_KEY } from './claudeCode/ClaudeCodeCli';
import { CODEX_CLI_VIRTUAL_KEY } from './codexCli/CodexCli';

const logger = getLogger();

export interface ApiKey {
  id: number;
  providerId: AIProviderId;
  key: string; // descriptografada
  alias: string;
  last4: string;
  status: 'active' | 'cooldown' | 'disabled';
  cooldownUntil?: number;
  successCount: number;
  failureCount: number;
  lastErrorCode?: string;
  lastUsedAt?: number;
  source?: 'oauth' | 'manual';
}

export interface ApiError {
  code: string;
  statusCode?: number;
  message: string;
}

function isInsufficientQuota(error: ApiError): boolean {
  return error.code === 'insufficient_quota';
}

/**
 * Pool de API keys com rotação e fallback automático
 */
export class ApiKeyPool {
  private db: DatabaseManager;
  private keyStorage: KeyStorage;
  private roundRobinIndex: Map<string, number> = new Map();
  private cooldownMinutes: number;

  constructor(db: DatabaseManager, keyStorage: KeyStorage, cooldownMinutes: number = 10) {
    this.db = db;
    this.keyStorage = keyStorage;
    this.cooldownMinutes = cooldownMinutes;
  }

  /**
   * Obtém a próxima key disponível para um provider (round-robin)
   */
  getNextKey(providerId: string): ApiKey | null {
    const availableKeys = this.getAvailableKeys(providerId);

    if (availableKeys.length === 0) {
      logger.warn({ providerId }, 'No available keys for provider');
      return null;
    }

    // Round-robin
    const currentIndex = this.roundRobinIndex.get(providerId) || 0;
    const selectedKey = availableKeys[currentIndex % availableKeys.length];
    this.roundRobinIndex.set(providerId, (currentIndex + 1) % availableKeys.length);

    logger.debug({ providerId, keyId: selectedKey.id, alias: selectedKey.alias }, 'Selected API key');
    return selectedKey;
  }

  /**
   * Obtém a próxima key disponível para um provider, com suporte automático
   * a tokens OAuth para providers suportados (ex: OpenAI).
   */
  async getNextKeyAsync(
    providerId: string,
    options?: { skipOAuth?: boolean }
  ): Promise<ApiKey | null> {
    const skipOAuth = options?.skipOAuth === true;

    if (providerId === 'openai-codex' && !skipOAuth) {
      try {
        const controller = getOAuthController();
        const profiles = controller.getTokenStore().listProfiles();
        const activeProfile = profiles.find(p => p.isActive && p.isEnabled && !p.isExpired);

        if (activeProfile) {
          const accessToken = await controller.getAccessToken(activeProfile.profileId);
          if (accessToken) {
            logger.debug({ providerId, profileId: activeProfile.profileId }, 'Selected OAuth access token');
            // Return a virtual ApiKey wrapper around the OAuth token
            return {
              id: -1, // Virtual ID
              providerId: providerId as AIProviderId,
              key: accessToken,
              alias: `OAuth: ${activeProfile.label}`,
              last4: accessToken.substring(accessToken.length - 4),
              status: 'active',
              successCount: 1,
              failureCount: 0,
              source: 'oauth',
            };
          }
        }
      } catch (err: any) {
        logger.warn({ err }, 'Failed to fetch OAuth token');
      }
    }

    if (providerId === 'openai-codex') {
      return null;
    }

    if (providerId === 'codex-cli') {
      // Codex keeps its own login; the provider reports a missing login itself.
      return {
        id: -3,
        providerId: 'codex-cli',
        key: CODEX_CLI_VIRTUAL_KEY,
        alias: 'Codex CLI (assinatura ChatGPT)',
        last4: 'cli',
        status: 'active',
        successCount: 0,
        failureCount: 0,
        source: 'oauth',
      };
    }

    if (providerId === 'claude-code') {
      // Claude Code keeps its own login; the provider reports a missing login itself.
      return {
        id: -2,
        providerId: 'claude-code',
        key: CLAUDE_CODE_VIRTUAL_KEY,
        alias: 'Claude Code (assinatura)',
        last4: 'cli',
        status: 'active',
        successCount: 0,
        failureCount: 0,
        source: 'oauth',
      };
    }

    // Fallback normal para chaves manuais (banco de dados)
    const manualKey = this.getNextKey(providerId);
    if (manualKey) {
      return { ...manualKey, source: 'manual' };
    }
    return null;
  }

  /**
   * Obtém todas as keys disponíveis (active e fora de cooldown)
   */
  getAvailableKeys(providerId: string): ApiKey[] {
    const now = Date.now();
    const dbKeys = this.db.getAIApiKeys(providerId);

    const available: ApiKey[] = [];

    for (const dbKey of dbKeys) {
      // Pula keys desabilitadas
      if (dbKey.status === 'disabled') {
        continue;
      }

      // Verifica cooldown
      if (dbKey.status === 'cooldown' && dbKey.cooldown_until) {
        if (dbKey.cooldown_until > now) {
          continue; // Ainda em cooldown
        } else {
          // Cooldown expirado, reativar
          this.db.updateAIApiKey(dbKey.id, { status: 'active', cooldown_until: undefined });
          dbKey.status = 'active';
        }
      }

      // Descriptografa a key
      try {
        const decryptedKey = this.keyStorage.decrypt(dbKey.encrypted_key);
        available.push({
          id: dbKey.id,
          providerId: dbKey.provider_id as AIProviderId,
          key: decryptedKey,
          alias: dbKey.alias,
          last4: dbKey.last4,
          status: dbKey.status as 'active' | 'cooldown' | 'disabled',
          cooldownUntil: dbKey.cooldown_until,
          successCount: dbKey.success_count,
          failureCount: dbKey.failure_count,
          lastErrorCode: dbKey.last_error_code,
          lastUsedAt: dbKey.last_used_at,
        });
      } catch (error) {
        logger.error({ err: error, keyId: dbKey.id }, 'Failed to decrypt API key');
        // Marca como desabilitada se não conseguir descriptografar
        this.db.updateAIApiKey(dbKey.id, { status: 'disabled' });
      }
    }

    // Ordena por taxa de sucesso (mais sucesso primeiro)
    available.sort((a, b) => {
      const aRate = a.successCount / (a.successCount + a.failureCount || 1);
      const bRate = b.successCount / (b.successCount + b.failureCount || 1);
      return bRate - aRate;
    });

    return available;
  }

  /**
   * Marca uma key como sucesso
   */
  markSuccess(keyId: number): void {
    const dbKey = this.db.getAIApiKeyById(keyId);
    if (!dbKey) {
      logger.warn({ keyId }, 'Key not found for markSuccess');
      return;
    }

    this.db.updateAIApiKey(keyId, {
      success_count: dbKey.success_count + 1,
      last_used_at: Date.now(),
      status: 'active', // Remove cooldown se estava em cooldown
      cooldown_until: undefined,
    });

    logger.debug({ keyId, alias: dbKey.alias }, 'Marked API key as success');
  }

  /**
   * Marca uma key como falha e aplica cooldown se necessário
   */
  markFailure(keyId: number, error: ApiError): void {
    const dbKey = this.db.getAIApiKeyById(keyId);
    if (!dbKey) {
      logger.warn({ keyId }, 'Key not found for markFailure');
      return;
    }

    // Para quota insuficiente (ex.: OpenAI 429 insufficient_quota), cooldown não ajuda.
    // Melhor desabilitar e deixar explícito no UI via last_error_code.
    if (isInsufficientQuota(error)) {
      this.db.updateAIApiKey(keyId, {
        failure_count: dbKey.failure_count + 1,
        last_error_code: error.code,
        status: 'disabled',
        cooldown_until: undefined,
      });
      logger.warn(
        { keyId, alias: dbKey.alias, errorCode: error.code, statusCode: error.statusCode },
        'Disabled API key due to insufficient quota'
      );
      return;
    }

    const shouldCooldown = this.shouldTriggerCooldown(error);
    const cooldownUntil = shouldCooldown
      ? Date.now() + this.cooldownMinutes * 60 * 1000
      : undefined;

    const newStatus: 'active' | 'cooldown' | 'disabled' = shouldCooldown
      ? 'cooldown'
      : error.statusCode === 401 || error.statusCode === 403
        ? 'disabled' // Keys inválidas são desabilitadas permanentemente
        : dbKey.status;

    this.db.updateAIApiKey(keyId, {
      failure_count: dbKey.failure_count + 1,
      last_error_code: error.code,
      status: newStatus,
      cooldown_until: cooldownUntil,
    });

    logger.warn(
      { keyId, alias: dbKey.alias, errorCode: error.code, statusCode: error.statusCode },
      'Marked API key as failure'
    );
  }

  /**
   * Verifica se um erro deve disparar cooldown
   */
  private shouldTriggerCooldown(error: ApiError): boolean {
    // Rate limit (429)
    if (error.statusCode === 429) {
      return true;
    }

    // Timeout ou erro 5xx
    if (error.statusCode && error.statusCode >= 500) {
      return true;
    }

    // Erros de timeout (sem status code mas com código de erro específico)
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
      return true;
    }

    return false;
  }

  /**
   * Adiciona uma nova key ao pool
   */
  addKey(providerId: string, key: string, alias: string): number {
    const encrypted = this.keyStorage.encrypt(key);
    const last4 = this.keyStorage.getLast4(key);

    return this.db.saveAIApiKey({
      provider_id: providerId,
      alias,
      encrypted_key: encrypted,
      last4,
      status: 'active',
      success_count: 0,
      failure_count: 0,
    });
  }

  /**
   * Remove uma key do pool
   */
  removeKey(keyId: number): void {
    this.db.deleteAIApiKey(keyId);
    logger.info({ keyId }, 'Removed API key from pool');
  }

  /**
   * Atualiza o status de uma key
   */
  updateKeyStatus(keyId: number, status: 'active' | 'cooldown' | 'disabled'): void {
    this.db.updateAIApiKey(keyId, { status });
    logger.debug({ keyId, status }, 'Updated API key status');
  }

  /**
   * Testa uma key (sem vazar o valor completo)
   */
  async testKey(keyId: number, testFn: (key: string) => Promise<boolean>): Promise<{ success: boolean; error?: string }> {
    const dbKey = this.db.getAIApiKeyById(keyId);
    if (!dbKey) {
      return { success: false, error: 'Key not found' };
    }

    try {
      const decryptedKey = this.keyStorage.decrypt(dbKey.encrypted_key);
      const success = await testFn(decryptedKey);

      if (success) {
        this.markSuccess(keyId);
      } else {
        this.markFailure(keyId, { code: 'TEST_FAILED', message: 'Test failed' });
      }

      return { success };
    } catch (error: any) {
      logger.error({ err: error, keyId }, 'Failed to test API key');
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
}
