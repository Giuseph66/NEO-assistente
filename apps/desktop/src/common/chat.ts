/**
 * Pure helpers for chat conversations, shared by the main process (titles, error
 * messages stored in the database) and the renderer (what the chat shows).
 */

const TITLE_MAX = 60;

/**
 * Conversation subject derived from the first user message: whitespace collapsed,
 * cut at a word boundary. No model call, so it works offline and costs no quota.
 * (Migration 008 backfills old conversations with the same rule.)
 */
export function deriveConversationTitle(firstMessage: string | null | undefined): string | null {
  const clean = String(firstMessage ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export type ChatErrorKind =
  | 'rate_limited'
  | 'not_logged_in'
  | 'not_installed'
  | 'refusal'
  | 'timeout'
  | 'model_unavailable'
  | 'network'
  | 'unknown';

export type ChatErrorInfo = {
  kind: ChatErrorKind;
  /** One sentence a person can act on. */
  title: string;
  /** Extra detail (when the limit resets, the raw provider message…), if any. */
  detail?: string;
  /** Whether sending the same message again can help. */
  retryable: boolean;
};

/** "resets 7:10pm" / "try again at 5:23 PM" → "7:10pm" — providers say when the limit is lifted. */
function extractResetTime(message: string): string | undefined {
  const match =
    /(?:resets?|try again at|volta(?: às)?|reset at)\s*(?:at\s*)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM|h)?)/i.exec(message);
  return match?.[1]?.trim();
}

/** Turns a provider error (code + raw message) into something the chat can show. */
export function describeChatError(code: string | undefined, message: string | undefined): ChatErrorInfo {
  const raw = (message || '').trim();
  const text = `${code ?? ''} ${raw}`.toLowerCase();

  if (code === 'rate_limited' || /usage limit|session limit|rate.?limit|limit reached|too many requests|429|quota|insufficient_quota/.test(text)) {
    const reset = extractResetTime(raw);
    return {
      kind: 'rate_limited',
      title: reset ? `Limite de uso atingido — volta às ${reset}.` : 'Limite de uso atingido.',
      detail: raw || undefined,
      retryable: true,
    };
  }
  if (code === 'not_logged_in' || /not logged in|\/login|unauthorized|invalid api key|authentication|sem login|\b401\b/.test(text)) {
    return {
      kind: 'not_logged_in',
      title: 'Login expirado ou ausente. Entre de novo em Configurações > API e Modelos.',
      detail: raw || undefined,
      retryable: false,
    };
  }
  if (code === 'not_installed' || /não encontrado|not found.*(claude|codex)|nao instalado|not installed/.test(text)) {
    return { kind: 'not_installed', title: 'O CLI necessário não está instalado neste computador.', detail: raw || undefined, retryable: false };
  }
  if (code === 'refusal' || /recusou|refus/.test(text)) {
    return { kind: 'refusal', title: 'O modelo recusou esta solicitação.', detail: raw || undefined, retryable: false };
  }
  if (code === 'timeout' || /timeout|timed out|demorou demais/.test(text)) {
    return { kind: 'timeout', title: 'O modelo demorou demais para responder.', detail: raw || undefined, retryable: true };
  }
  if (/model.*(not supported|not found|does not exist|unavailable)|modelo.*(não|nao)/.test(text)) {
    return { kind: 'model_unavailable', title: 'Este modelo não está disponível para a sua conta. Escolha outro em Configurações.', detail: raw || undefined, retryable: false };
  }
  if (/econn|enotfound|network|fetch failed|socket|rede/.test(text)) {
    return { kind: 'network', title: 'Falha de conexão com o provedor.', detail: raw || undefined, retryable: true };
  }
  return { kind: 'unknown', title: 'Não foi possível obter a resposta.', detail: raw || undefined, retryable: true };
}

/** Short display name: `gpt-6.1-sol` → `GPT-6.1 Sol`, `claude-opus-5-5` → `Claude Opus 5.5`. */
export function prettyModelName(id: string | null | undefined): string {
  if (!id) return '';
  const parts = id
    .replace(/(?<!\d)(\d)-(\d)(?!\d)/g, '$1.$2')
    .split('-')
    .filter(Boolean);
  const cap = (word: string) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word);
  if (parts[0] === 'gpt') {
    return ['GPT', [parts[1], ...parts.slice(2).map(cap)].filter(Boolean).join(' ')].filter(Boolean).join('-');
  }
  return parts.map(cap).join(' ');
}

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  'openai-codex': 'ChatGPT (Codex)',
  'codex-cli': 'ChatGPT (assinatura)',
  anthropic: 'Claude (API)',
  'claude-code': 'Claude (assinatura)',
  ollama: 'Ollama',
};

export function providerLabel(providerId: string | null | undefined): string {
  if (!providerId) return '';
  return PROVIDER_LABELS[providerId] ?? providerId;
}

/** `4,2 s` / `850 ms` / `1 min 5 s`. */
export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0).replace('.', ',')} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

/** `1,2 mil` / `850`. */
export function formatTokens(count: number | null | undefined): string {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return '';
  if (count < 1000) return String(Math.round(count));
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace('.', ',')} mil`;
}
