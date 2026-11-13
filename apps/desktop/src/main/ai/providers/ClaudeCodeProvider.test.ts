import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider, buildClaudeCodePrompt } from './ClaudeCodeProvider';
import { ClaudeCodeCli, ClaudeCodeError } from '../claudeCode/ClaudeCodeCli';

function fakeCli(impl: ClaudeCodeCli['run']) {
  return { run: vi.fn(impl) } as unknown as ClaudeCodeCli & { run: ReturnType<typeof vi.fn> };
}

describe('buildClaudeCodePrompt', () => {
  it('uses system messages as system prompt and replays history before the latest message', () => {
    const { systemPrompt, prompt } = buildClaudeCodePrompt([
      { role: 'system', content: 'Seja breve.' },
      { role: 'user', content: 'Meu nome é Ana.' },
      { role: 'assistant', content: 'Olá, Ana!' },
      { role: 'user', content: 'Qual é meu nome?' },
    ]);
    expect(systemPrompt).toBe('Seja breve.');
    expect(prompt).toContain('Usuário: Meu nome é Ana.');
    expect(prompt).toContain('Assistente: Olá, Ana!');
    expect(prompt.trim().endsWith('Qual é meu nome?')).toBe(true);
  });

  it('sends a single message as is', () => {
    expect(buildClaudeCodePrompt([{ role: 'user', content: 'oi' }])).toEqual({ systemPrompt: undefined, prompt: 'oi' });
  });
});

describe('ClaudeCodeProvider', () => {
  it('runs the CLI with model and effort, ignoring the placeholder key', async () => {
    const cli = fakeCli(async () => ({ text: 'Ana', model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 2 }));
    const res = await new ClaudeCodeProvider(cli).analyzeText(
      { messages: [{ role: 'user', content: 'x' }], options: { modelName: 'Claude-Sonnet-5-5', reasoningEffort: 'high', timeoutMs: 30_000 } },
      'claude-code-cli'
    );
    expect(cli.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'x', model: 'claude-sonnet-5-5', effort: 'high', timeoutMs: 300_000 })
    );
    expect(res).toMatchObject({ answerText: 'Ana', modelUsed: 'claude-sonnet-5-5', providerUsed: 'claude-code' });
  });

  it('passes screenshots as image files', async () => {
    const cli = fakeCli(async () => ({ text: 'ok' }));
    await new ClaudeCodeProvider(cli).analyzeImage(
      { image: { base64Raw: Buffer.from('PNGDATA').toString('base64'), mimeType: 'image/png' }, messages: [{ role: 'user', content: 'descreva' }] },
      'claude-code-cli'
    );
    const call = (cli.run as any).mock.calls[0][0];
    expect(call.image.extension).toBe('png');
    expect(call.image.data.toString()).toBe('PNGDATA');
  });

  it('turns a missing login into a non-retryable 401', async () => {
    const cli = fakeCli(async () => {
      throw new ClaudeCodeError('not_logged_in', 'sem login', 401);
    });
    await expect(
      new ClaudeCodeProvider(cli).analyzeText({ messages: [{ role: 'user', content: 'x' }] }, 'claude-code-cli')
    ).rejects.toMatchObject({ statusCode: 401, code: 'not_logged_in' });
    expect(cli.run).toHaveBeenCalledTimes(1);
  });
});
