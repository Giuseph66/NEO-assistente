import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { deriveConversationTitle, describeChatError, formatDuration, formatTokens, prettyModelName, providerLabel } from './chat';

const migration = createRequire(import.meta.url)('../main/database/migrations/008_ai_message_metadata_and_titles.js');

describe('deriveConversationTitle', () => {
  it('uses the first message, whitespace collapsed', () => {
    expect(deriveConversationTitle('  Como   faço\num\tbackup?  ')).toBe('Como faço um backup?');
    expect(deriveConversationTitle('')).toBeNull();
    expect(deriveConversationTitle(undefined)).toBeNull();
  });

  it('cuts long messages at a word boundary with an ellipsis', () => {
    const title = deriveConversationTitle('Explique detalhadamente como funciona a recuperação de desastres em bancos de dados distribuídos')!;
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toMatch(/\s…$/);
    expect(title.startsWith('Explique detalhadamente como funciona')).toBe(true);
  });

  it('is identical to the rule migration 008 applies to old conversations', () => {
    for (const text of ['oi', '  espaços   e\nquebras ', 'x'.repeat(200), 'palavra '.repeat(30), 'a'.repeat(59) + ' ' + 'b'.repeat(30), '']) {
      expect(migration.titleFrom(text)).toBe(deriveConversationTitle(text));
    }
  });
});

describe('describeChatError', () => {
  it('turns the real rate-limit messages from the database into something actionable', () => {
    const claude = describeChatError('rate_limited', "Limite de uso da assinatura Claude atingido: You've hit your session limit · resets 7:10pm");
    expect(claude).toMatchObject({ kind: 'rate_limited', retryable: true });
    expect(claude.title).toContain('7:10pm');

    const chatgpt = describeChatError('rate_limited', 'Limite de uso da assinatura ChatGPT atingido: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:23 PM.');
    expect(chatgpt.kind).toBe('rate_limited');
    expect(chatgpt.title).toContain('5:23 PM');
  });

  it('classifies login, model, refusal, timeout and network problems', () => {
    expect(describeChatError('not_logged_in', 'Claude Code sem login').kind).toBe('not_logged_in');
    expect(describeChatError(undefined, "The 'claude-opus-5-5' model is not supported when using Codex with a ChatGPT account.").kind).toBe('model_unavailable');
    expect(describeChatError('refusal', 'Claude recusou a solicitação').retryable).toBe(false);
    expect(describeChatError('timeout', 'O Codex demorou demais').kind).toBe('timeout');
    expect(describeChatError('ECONNRESET', 'fetch failed').kind).toBe('network');
    expect(describeChatError(undefined, 'algo estranho')).toMatchObject({ kind: 'unknown', retryable: true });
    expect(describeChatError(undefined, undefined).title).toBeTruthy();
  });

  it('never marks a login or install problem as retryable', () => {
    expect(describeChatError('not_installed', 'Codex CLI não encontrado').retryable).toBe(false);
    expect(describeChatError('not_logged_in', 'x').retryable).toBe(false);
  });
});

describe('display helpers', () => {
  it('names models and providers', () => {
    expect(prettyModelName('gpt-6.1-sol')).toBe('GPT-6.1 Sol');
    expect(prettyModelName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(prettyModelName(null)).toBe('');
    expect(providerLabel('claude-code')).toBe('Claude (assinatura)');
    expect(providerLabel('algo-novo')).toBe('algo-novo');
  });

  it('formats durations and token counts', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(4200)).toBe('4,2 s');
    expect(formatDuration(12_400)).toBe('12 s');
    expect(formatDuration(65_000)).toBe('1 min 5 s');
    expect(formatDuration(undefined)).toBe('');
    expect(formatTokens(850)).toBe('850');
    expect(formatTokens(1234)).toBe('1,2 mil');
    expect(formatTokens(25_000)).toBe('25 mil');
  });
});
