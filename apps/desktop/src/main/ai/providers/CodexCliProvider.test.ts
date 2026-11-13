import { describe, expect, it, vi } from 'vitest';
import { CodexCliProvider } from './CodexCliProvider';
import { CodexCli, CodexCliError } from '../codexCli/CodexCli';

function fakeCli(impl: CodexCli['run']) {
  return { run: vi.fn(impl) } as unknown as CodexCli & { run: ReturnType<typeof vi.fn> };
}

describe('CodexCliProvider', () => {
  it('runs the CLI with model, effort and the conversation, ignoring the placeholder key', async () => {
    const cli = fakeCli(async () => ({ text: 'Ana', inputTokens: 10, outputTokens: 2 }));
    const res = await new CodexCliProvider(cli).analyzeText(
      {
        messages: [
          { role: 'system', content: 'Seja breve.' },
          { role: 'user', content: 'Meu nome é Ana.' },
          { role: 'assistant', content: 'Olá!' },
          { role: 'user', content: 'Qual é meu nome?' },
        ],
        options: { modelName: 'GPT-6-Luna', reasoningEffort: 'high', timeoutMs: 30_000 },
      },
      'codex-cli'
    );
    const call = (cli.run as any).mock.calls[0][0];
    expect(call).toMatchObject({ model: 'gpt-6-luna', effort: 'high', systemPrompt: 'Seja breve.', timeoutMs: 300_000 });
    expect(call.prompt).toContain('Usuário: Meu nome é Ana.');
    expect(res).toMatchObject({ answerText: 'Ana', providerUsed: 'codex-cli', modelUsed: 'gpt-6-luna' });
  });

  it('passes screenshots as image attachments', async () => {
    const cli = fakeCli(async () => ({ text: 'ok' }));
    await new CodexCliProvider(cli).analyzeImage(
      { image: { base64Raw: Buffer.from('JPG').toString('base64'), mimeType: 'image/jpeg' }, messages: [{ role: 'user', content: 'descreva' }] },
      'codex-cli'
    );
    const call = (cli.run as any).mock.calls[0][0];
    expect(call.image.extension).toBe('jpg');
    expect(call.image.data.toString()).toBe('JPG');
  });

  it.each([
    ['not_logged_in', 401],
    ['rate_limited', 429],
    ['not_installed', 401],
  ] as const)('does not retry %s (login, quota and install problems)', async (code, status) => {
    const cli = fakeCli(async () => {
      throw new CodexCliError(code, 'x', code === 'not_installed' ? undefined : status);
    });
    await expect(new CodexCliProvider(cli).analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'k')).rejects.toMatchObject({
      code,
      statusCode: status,
      nonRetryable: true,
    });
    expect(cli.run).toHaveBeenCalledTimes(1); // BaseProvider's retry loop gave up at once
  });

  it('keeps retrying transient failures', async () => {
    vi.useFakeTimers();
    const cli = fakeCli(async () => {
      throw new CodexCliError('api_error', 'boom');
    });
    const promise = new CodexCliProvider(cli).analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'k');
    const assertion = expect(promise).rejects.toMatchObject({ code: 'api_error' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(cli.run).toHaveBeenCalledTimes(3); // 1 + 2 retries
    vi.useRealTimers();
  });
});
