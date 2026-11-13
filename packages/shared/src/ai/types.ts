/**
 * Tipos compartilhados para sistema de análise de IA
 */

export type AIProviderId =
  | 'gemini'
  | 'openai'
  | 'openai-codex'
  | 'anthropic'
  /** Claude via the user's Claude.ai subscription, through the Claude Code CLI. */
  | 'claude-code'
  /** ChatGPT subscription through the Codex CLI (`codex exec`). */
  | 'codex-cli'
  | 'ollama'
  | 'custom';

/**
 * Reasoning depth for models that think before answering
 * (OpenAI reasoning models / Codex, Claude). Providers map it to their own knob.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ModelInfo {
  id: string;
  name: string;
  provider: AIProviderId;
  supportsVision: boolean;
  maxTokens?: number;
  supportsStreaming?: boolean;
  metadata?: Record<string, any>;
}

export interface VisionRequest {
  image: {
    base64Raw?: string;
    base64DataUrl?: string;
    mimeType: string;
    path?: string;
    base64?: string;
    originalPath?: string;
  };
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    stream?: boolean;
    modelName?: string;
    reasoningEffort?: ReasoningEffort;
  };
}

export interface ChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    stream?: boolean;
    modelName?: string;
    reasoningEffort?: ReasoningEffort;
  };
}

export interface VisionRequestImage {
  base64Raw: string;
  base64DataUrl: string;
  mimeType: string;
  originalPath?: string;
}

export interface VisionRequestLegacy {
  image: {
    path?: string;
    base64?: string;
    mimeType: string;
  };
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    stream?: boolean;
    modelName?: string;
    reasoningEffort?: ReasoningEffort;
  };
}

export interface VisionResponse {
  recognizedText?: string;
  answerText: string;
  raw?: any;
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
  };
  modelUsed: string;
  providerUsed: AIProviderId;
  apiKeyIdUsed?: number;
}

export interface AIConfig {
  providerId: AIProviderId;
  modelName: string;
  timeoutMs: number;
  retries: number;
  streaming: boolean;
  saveHistory: boolean;
  maxImageDimension: number;
  maxImageBytes: number;
  imageQuality: number;
  enableImageOptimization: boolean;
  fallbackMaxAttempts: number;
  fallbackCooldownMinutes: number;
  reasoningEffort?: ReasoningEffort;
}

export interface ApiKeyInfo {
  id: number;
  providerId: AIProviderId;
  alias: string;
  last4: string;
  status: 'active' | 'cooldown' | 'disabled';
  cooldownUntil?: number;
  successCount: number;
  failureCount: number;
  lastErrorCode?: string;
  lastUsedAt?: number;
}

export interface AISession {
  id: number;
  screenshotId: number | null;
  providerId: AIProviderId;
  modelName: string;
  summary?: string | null;
  createdAt: number;
}

export interface AIMessage {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

export interface AIRun {
  id: number;
  sessionId: number;
  providerId: AIProviderId;
  modelName: string;
  apiKeyId?: number;
  status: 'success' | 'error';
  durationMs?: number;
  errorCode?: string;
  errorMessageRedacted?: string;
  createdAt: number;
}

export interface PromptTemplate {
  id: number;
  name: string;
  promptText: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnalyzeScreenshotRequest {
  screenshotId: number;
  prompt: string;
  mode?: 'analyze' | 'extract_text';
  sessionId?: number;
  context?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export interface AnalyzeScreenshotResponse {
  success: boolean;
  sessionId?: number;
  response?: VisionResponse;
  error?: string;
}

export interface AnalyzeChatRequest {
  prompt: string;
  sessionId?: number;
  context?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export interface AnalyzeChatResponse {
  success: boolean;
  sessionId?: number;
  response?: VisionResponse;
  error?: string;
}
