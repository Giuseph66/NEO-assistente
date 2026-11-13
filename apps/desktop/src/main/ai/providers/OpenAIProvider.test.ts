import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider, isOpenAIReasoningModel, normalizeOpenAIModelId } from './OpenAIProvider';
import { fakeChatGptJwt } from '../../testing/fixtures';

vi.mock('../../auth/openaiOAuth', () => ({
  getOAuthController: () => ({
    getTokenStore: () => ({
      // stored value from the old (buggy) login code: the user id, not the account id
      getActiveProfileId: () => 'p1',
      getProfile: () => ({ accountId: 'user-xyz' }),
    }),
  }),
}));

function mockFetch(handler: (url: string, body: any, init: RequestInit) => Response) {
  const calls: Array<{ url: string; body: any; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), body, init });
      return handler(String(url), body, init);
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), {
    status: 200,
  });

describe('OpenAI reasoning helpers', () => {
  it('detects reasoning models and lowercases ids', () => {
    expect(isOpenAIReasoningModel('gpt-5.4')).toBe(true);
    expect(isOpenAIReasoningModel('o3-mini')).toBe(true);
    expect(isOpenAIReasoningModel('gpt-4o')).toBe(false);
    expect(normalizeOpenAIModelId('GPT-5.3-Codex', 'x')).toBe('gpt-5.3-codex');
    expect(normalizeOpenAIModelId('', 'gpt-4o')).toBe('gpt-4o');
  });
});

describe('OpenAIProvider (API key)', () => {
  it('sends max_completion_tokens + reasoning_effort (no temperature) to reasoning models', async () => {
    const calls = mockFetch(() => chat('ok'));
    const provider = new OpenAIProvider();
    const res = await provider.analyzeText(
      {
        messages: [{ role: 'user', content: 'oi' }],
        options: { modelName: 'GPT-5.4', maxTokens: 900, temperature: 0.7, reasoningEffort: 'high' },
      },
      'sk-test'
    );
    expect(res.answerText).toBe('ok');
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].body).toMatchObject({ model: 'gpt-5.4', max_completion_tokens: 900, reasoning_effort: 'high' });
    expect(calls[0].body).not.toHaveProperty('temperature');
    expect(calls[0].body).not.toHaveProperty('max_tokens');
  });

  it('keeps temperature/max_tokens for non-reasoning models', async () => {
    const calls = mockFetch(() => chat('ok'));
    await new OpenAIProvider().analyzeText(
      { messages: [{ role: 'user', content: 'oi' }], options: { modelName: 'gpt-4o', maxTokens: 100, temperature: 0.2 } },
      'sk-test'
    );
    expect(calls[0].body).toMatchObject({ model: 'gpt-4o', max_tokens: 100, temperature: 0.2 });
  });
});

describe('OpenAIProvider (Codex / ChatGPT login)', () => {
  const sse = (text: string) =>
    new Response(
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n` +
        `data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 2 } } })}\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );

  it('calls the Codex backend with the real account id, lowercase model and reasoning effort', async () => {
    const calls = mockFetch(() => sse('resposta'));
    const provider = new OpenAIProvider({ id: 'openai-codex', transport: 'codex' });
    const token = fakeChatGptJwt('acct-real');
    const res = await provider.analyzeText(
      {
        messages: [
          { role: 'system', content: 'seja breve' },
          { role: 'user', content: 'quanto é 2+2?' },
        ],
        options: { modelName: 'GPT-5.3-Codex', reasoningEffort: 'medium' },
      },
      token
    );

    expect(res.answerText).toBe('resposta');
    expect(res.providerUsed).toBe('openai-codex');
    expect(calls[0].url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(calls[0].body).toMatchObject({
      model: 'gpt-5.3-codex',
      stream: true,
      store: false,
      instructions: 'seja breve',
      reasoning: { effort: 'medium' },
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers['chatgpt-account-id']).toBe('acct-real');
  });

  it('drops a parameter the backend rejects and retries', async () => {
    let first = true;
    const calls = mockFetch(() => {
      if (first) {
        first = false;
        return new Response(JSON.stringify({ detail: 'Unsupported parameter: max_tokens' }), { status: 400 });
      }
      return sse('ok');
    });
    const provider = new OpenAIProvider({ id: 'openai-codex', transport: 'codex' });
    const res = await provider.analyzeText(
      { messages: [{ role: 'user', content: 'x' }], options: { modelName: 'gpt-5.4', maxTokens: 500 } },
      fakeChatGptJwt()
    );
    expect(res.answerText).toBe('ok');
    expect(calls[0].body).toHaveProperty('max_tokens', 500);
    expect(calls[1].body).not.toHaveProperty('max_tokens');
  });

  it('rejects an API key on the Codex transport', async () => {
    const provider = new OpenAIProvider({ id: 'openai-codex', transport: 'codex' });
    await expect(
      provider.analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'sk-not-oauth')
    ).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
  });
});

describe('model catalog ids', () => {
  it('dedupes legacy uppercase ids, keeping the lowercase spelling and first position', async () => {
    const { normalizeModels } = await import('../modelCatalog');
    const models = normalizeModels('openai-codex', [
      { id: 'GPT-5.3-Codex', name: 'GPT-5.3-Codex', supportsVision: true },
      { id: 'gpt-5', name: 'GPT-5', supportsVision: true },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', supportsVision: true, maxTokens: 8192 },
    ]);
    expect(models.map((m) => m.id)).toEqual(['gpt-5.3-codex', 'gpt-5']);
    expect(models[0]).toMatchObject({ maxTokens: 8192, provider: 'openai-codex' });
  });
});
