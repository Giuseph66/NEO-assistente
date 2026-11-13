import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider, toAnthropicMessages, toProviderError } from './AnthropicProvider';

function fakeClient(message: Partial<Anthropic.Beta.BetaMessage> | Error) {
  const stream = vi.fn((_params: any) => ({
    finalMessage: async () => {
      if (message instanceof Error) throw message;
      return {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        stop_details: null,
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [],
        ...message,
      } as Anthropic.Beta.BetaMessage;
    },
  }));
  const factory = vi.fn((_key: string) => ({ beta: { messages: { stream } } }) as any);
  return { factory, stream };
}

describe('toAnthropicMessages', () => {
  it('moves system text to `system`, drops leading assistant turns and attaches the image to the last user turn', () => {
    const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AAA' } };
    const { system, messages } = toAnthropicMessages(
      [
        { role: 'system', content: 'Você é útil.' },
        { role: 'assistant', content: 'olá' },
        { role: 'user', content: 'primeira' },
        { role: 'assistant', content: 'resposta' },
        { role: 'user', content: 'o que há na imagem?' },
      ],
      image
    );
    expect(system).toBe('Você é útil.');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2].content).toEqual([image, { type: 'text', text: 'o que há na imagem?' }]);
  });
});

describe('AnthropicProvider', () => {
  it('streams with adaptive thinking via effort, no temperature, and server-side fallback', async () => {
    const { factory, stream } = fakeClient({ content: [{ type: 'thinking', thinking: '', signature: 's' } as any, { type: 'text', text: '4' } as any] });
    const provider = new AnthropicProvider(factory);
    const res = await provider.analyzeText(
      {
        messages: [
          { role: 'system', content: 'seja breve' },
          { role: 'user', content: '2+2?' },
        ],
        options: { modelName: 'claude-opus-5-5', temperature: 0.7, maxTokens: 4000, reasoningEffort: 'high' },
      },
      'sk-ant-test'
    );

    expect(factory).toHaveBeenCalledWith('sk-ant-test');
    const params = stream.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      system: 'seja breve',
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(res).toMatchObject({ answerText: '4', providerUsed: 'anthropic', modelUsed: 'claude-opus-5-5' });
    expect(res.usage).toEqual({ tokensIn: 10, tokensOut: 5 });
  });

  it('defaults to Claude Opus 5.5 at medium effort; Haiku gets no fallback', async () => {
    const { factory, stream } = fakeClient({ content: [{ type: 'text', text: 'ok' } as any] });
    const provider = new AnthropicProvider(factory);
    await provider.analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'k');
    expect(stream.mock.calls[0][0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'medium' } });

    await provider.analyzeText({ messages: [{ role: 'user', content: 'x' }], options: { modelName: 'claude-haiku-5-5' } }, 'k');
    expect(stream.mock.calls[1][0]).not.toHaveProperty('fallbacks');
  });

  it('sends images as base64 blocks', async () => {
    const { factory, stream } = fakeClient({ content: [{ type: 'text', text: 'um gato' } as any] });
    await new AnthropicProvider(factory).analyzeImage(
      { image: { base64Raw: 'QUJD', mimeType: 'image/jpeg' }, messages: [{ role: 'user', content: 'descreva' }] },
      'k'
    );
    const content = stream.mock.calls[0][0].messages[0].content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  });

  it('turns a refusal into a non-retryable error', async () => {
    const { factory } = fakeClient({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } as any });
    await expect(
      new AnthropicProvider(factory).analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'k')
    ).rejects.toMatchObject({ code: 'refusal', statusCode: 400 });
  });

  it('maps SDK errors to the key-pool contract', () => {
    const rate = toProviderError(
      Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }, undefined, new Headers())
    );
    expect(rate).toMatchObject({ statusCode: 429, code: 'rate_limit_error' });

    const auth = toProviderError(
      Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, undefined, new Headers())
    );
    expect(auth).toMatchObject({ statusCode: 401 });

    const credit = toProviderError(
      Anthropic.APIError.generate(
        400,
        { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
        undefined,
        new Headers()
      )
    );
    expect(credit).toMatchObject({ statusCode: 400, code: 'insufficient_quota' });
  });

  it('does not retry auth errors inside the provider', async () => {
    const error = Anthropic.APIError.generate(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
      undefined,
      new Headers()
    );
    const { factory, stream } = fakeClient(error);
    await expect(
      new AnthropicProvider(factory).analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'k')
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
