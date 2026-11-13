import { VisionProvider } from './providers/VisionProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OpenAICodexProvider } from './providers/OpenAICodexProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider';
import { CodexCliProvider } from './providers/CodexCliProvider';
import { AIProviderId } from '@neo/shared';
import { getLogger } from '@neo/logger';

const logger = getLogger();

/**
 * Gerenciador de providers de IA
 * Registra e fornece acesso aos providers disponíveis
 */
export class AIProviderManager {
  private providers: Map<AIProviderId, VisionProvider> = new Map();

  constructor() {
    this.registerDefaultProviders();
  }

  /**
   * Registra os providers padrão
   */
  private registerDefaultProviders(): void {
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new OpenAICodexProvider());
    this.registerProvider(new AnthropicProvider());
    this.registerProvider(new ClaudeCodeProvider());
    this.registerProvider(new CodexCliProvider());
    logger.info('Registered default AI providers');
  }

  /**
   * Registra um novo provider
   */
  registerProvider(provider: VisionProvider): void {
    this.providers.set(provider.id, provider);
    logger.debug({ providerId: provider.id }, 'Registered AI provider');
  }

  /**
   * Obtém um provider por ID
   */
  getProvider(providerId: AIProviderId): VisionProvider | null {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.warn({ providerId }, 'Provider not found');
    }
    return provider || null;
  }

  /**
   * Lista todos os providers registrados
   */
  listProviders(): VisionProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Verifica se um provider está disponível
   */
  hasProvider(providerId: AIProviderId): boolean {
    return this.providers.has(providerId);
  }
}

// Singleton
let providerManager: AIProviderManager | null = null;

export function getAIProviderManager(): AIProviderManager {
  if (!providerManager) {
    providerManager = new AIProviderManager();
  }
  return providerManager;
}

