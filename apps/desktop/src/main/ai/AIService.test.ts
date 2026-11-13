import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '@neo/shared';

// --- in-memory stand-in for DatabaseManager (only what AIService touches) -------------------
type Msg = { id: number; session_id: number; role: string; content: string; created_at: number; provider_id?: string | null; model_name?: string | null; duration_ms?: number | null; tokens_in?: number | null; tokens_out?: number | null };
class FakeDb {
  sessions = new Map<number, any>();
  messages: Msg[] = [];
  runs: any[] = [];
  private seq = 0;
  saveAIProvider() {}
  getAIApiKeys() { return []; }
  getScreenshotById() { return { id: 3, file_path: '/shot.png' }; }
  getAISessionById(id: number) { return this.sessions.get(id) ?? null; }
  getAISessions() { return []; }
  saveAISession(s: any) { const id = ++this.seq; this.sessions.set(id, { id, createdAt: Date.now(), title: null, ...s, screenshotId: s.screenshotId ?? null }); return id; }
  setAISessionTitleIfEmpty(id: number, title: string) { const s = this.sessions.get(id); if (s && !s.title) s.title = title; }
  getAIMessages(sessionId: number) { return this.messages.filter((m) => m.session_id === sessionId); }
  saveAIMessage(m: any) { const row = { ...m, id: ++this.seq, created_at: Date.now() }; this.messages.push(row); return row.id; }
  saveAIRun(r: any) { this.runs.push(r); return this.runs.length; }
}

const providerCalls: Array<{ messages: any[]; options: any }> = [];
let providerImpl: (req: any) => Promise<any> = async () => ({ answerText: 'ok', modelUsed: 'm', providerUsed: 'claude-code' });
let imageImpl: (req: any) => Promise<any> = async () => ({ answerText: 'uma tela', modelUsed: 'm', providerUsed: 'claude-code' });
const fakeProvider = { id: 'x', listModels: async () => [], analyzeImage: vi.fn(async (req: any) => imageImpl(req)), analyzeText: vi.fn(async (req: any) => { providerCalls.push(req); return providerImpl(req); }) };

vi.mock('./AIProviderManager', () => ({ getAIProviderManager: () => ({ getProvider: () => fakeProvider }) }));
vi.mock('fs', async (original) => ({ ...(await original<typeof import('fs')>()), existsSync: () => true }));
vi.mock('./utils/imagePreprocessor', () => ({
  preprocessImage: async () => ({ base64Raw: 'QUJD', base64DataUrl: 'data:image/png;base64,QUJD', mimeType: 'image/png', sourcePath: '/shot.png' }),
}));
vi.mock('../auth/openaiOAuth', () => ({ getOAuthController: () => ({ getTokenStore: () => ({ listProfiles: () => [] }) }) }));

import { AIService } from './AIService';

const baseConfig: Partial<AIConfig> = { providerId: 'claude-code', modelName: 'claude-sonnet-5-5', fallbackMaxAttempts: 1 };
const make = (config: Partial<AIConfig> = baseConfig) => {
  const db = new FakeDb();
  return { db, service: new AIService(db as any, {} as any, config) };
};
const rateLimit = () => Object.assign(new Error("Limite de uso da assinatura Claude atingido: You've hit your session limit · resets 7:10pm"), { code: 'rate_limited', statusCode: 429, nonRetryable: true });

beforeEach(() => {
  providerCalls.length = 0;
  providerImpl = async () => ({ answerText: 'ok', modelUsed: 'm', providerUsed: 'claude-code' });
});

describe('AIService.analyzeText', () => {
  it('stores the answer with the model that produced it, its time and tokens, and titles the conversation', async () => {
    providerImpl = async () => ({ answerText: 'Use .backup', modelUsed: 'claude-opus-5-5', providerUsed: 'claude-code', usage: { tokensIn: 30, tokensOut: 12 } });
    const { db, service } = make();

    const result = await service.analyzeText({ prompt: '  Como faço um backup do banco?  ' });

    expect(result.success).toBe(true);
    const sessionId = result.sessionId!;
    const answer = db.messages.find((m) => m.role === 'assistant')!;
    expect(answer).toMatchObject({ session_id: sessionId, content: 'Use .backup', provider_id: 'claude-code', model_name: 'claude-opus-5-5', tokens_in: 30, tokens_out: 12 });
    expect(answer.duration_ms).toBeGreaterThanOrEqual(0);
    expect(db.getAISessionById(sessionId).title).toBe('Como faço um backup do banco?');
    // the run describes what answered, not what was configured
    expect(db.runs[0]).toMatchObject({ status: 'success', provider_id: 'claude-code', model_name: 'claude-opus-5-5' });
  });

  it('keeps the first title when the conversation continues', async () => {
    const { db, service } = make();
    const first = await service.analyzeText({ prompt: 'primeiro assunto' });
    await service.analyzeText({ prompt: 'outra coisa', sessionId: first.sessionId });
    expect(db.getAISessionById(first.sessionId!).title).toBe('primeiro assunto');
  });

  it('on failure returns the conversation id and the error code, and keeps the user message (the bug: both were lost)', async () => {
    providerImpl = async () => { throw rateLimit(); };
    const { db, service } = make();

    const result = await service.analyzeText({ prompt: 'oi' });

    expect(result.success).toBe(false);
    expect(result.sessionId).toBeTypeOf('number');
    expect(result.errorCode).toBe('rate_limited');
    expect(result.error).toContain('7:10pm');
    expect(db.getAIMessages(result.sessionId!).map((m) => [m.role, m.content])).toEqual([['user', 'oi']]);
    expect(db.runs[0]).toMatchObject({ status: 'error', error_code: 'rate_limited', session_id: result.sessionId });
  });

  it('regenerate answers the last user message again without adding a new one', async () => {
    providerImpl = async () => { throw rateLimit(); };
    const { db, service } = make();
    const failed = await service.analyzeText({ prompt: 'oi' });

    providerImpl = async () => ({ answerText: 'Olá!', modelUsed: 'claude-sonnet-5-5', providerUsed: 'claude-code' });
    const retry = await service.analyzeText({ prompt: '', regenerate: true, sessionId: failed.sessionId });

    expect(retry.success).toBe(true);
    expect(retry.sessionId).toBe(failed.sessionId);
    const roles = db.getAIMessages(failed.sessionId!).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant']); // not ['user', 'user', 'assistant'] as the old retries produced
    expect(providerCalls.at(-1)!.messages.map((m) => m.content)).toEqual(['oi']);
  });

  it('regenerate refuses when there is nothing unanswered', async () => {
    const { service } = make();
    const done = await service.analyzeText({ prompt: 'oi' });
    const again = await service.analyzeText({ prompt: '', regenerate: true, sessionId: done.sessionId });
    expect(again).toMatchObject({ success: false, errorCode: 'nothing_to_retry', sessionId: done.sessionId });

    const none = await service.analyzeText({ prompt: '', regenerate: true });
    expect(none.success).toBe(false);
  });

  it('rejects an empty message', async () => {
    const { service } = make();
    expect(await service.analyzeText({ prompt: '   ' })).toMatchObject({ success: false, error: 'Mensagem vazia' });
  });

  it('records a failure under the provider/model it started with, even if the user switches meanwhile', async () => {
    let release!: () => void;
    providerImpl = () => new Promise((_, reject) => { release = () => reject(rateLimit()); });
    const { db, service } = make();

    const pending = service.analyzeText({ prompt: 'demora' });
    await vi.waitFor(() => expect(providerCalls.length).toBe(1));
    // the user switches provider while the request is still running; the carried-over
    // Claude model must be replaced (Codex would answer "model not supported")
    service.updateConfig({ providerId: 'codex-cli' });
    expect(service.getConfig()).toMatchObject({ providerId: 'codex-cli', modelName: 'gpt-6.1-sol' });
    release();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(db.runs[0]).toMatchObject({ provider_id: 'claude-code', model_name: 'claude-sonnet-5-5' });
  });
});

describe('AIService.analyzeScreenshot', () => {
  it('stores the answer with its model and titles the conversation', async () => {
    imageImpl = async () => ({ answerText: 'Uma janela de terminal', modelUsed: 'claude-opus-5-5', providerUsed: 'claude-code', usage: { tokensOut: 7 } });
    const { db, service } = make();
    const result = await service.analyzeScreenshot({ screenshotId: 3, prompt: 'O que é isso?' });
    expect(result.success).toBe(true);
    expect(db.messages.find((m) => m.role === 'assistant')).toMatchObject({ model_name: 'claude-opus-5-5', provider_id: 'claude-code', tokens_out: 7 });
    expect(db.getAISessionById(result.sessionId!).title).toBe('O que é isso?');
  });

  it('on failure still says which conversation it belongs to (the chat needs it to show the error)', async () => {
    imageImpl = async () => { throw rateLimit(); };
    const { db, service } = make();
    const result = await service.analyzeScreenshot({ screenshotId: 3, prompt: 'O que é isso?' });
    expect(result).toMatchObject({ success: false, errorCode: 'rate_limited' });
    expect(result.sessionId).toBeTypeOf('number');
    expect(db.runs[0]).toMatchObject({ status: 'error', session_id: result.sessionId });
  });
});
