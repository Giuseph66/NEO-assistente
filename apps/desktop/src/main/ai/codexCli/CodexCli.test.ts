import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { existsSync, readdirSync, readFileSync, mkdtempSync, writeFileSync, symlinkSync, lstatSync, readlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { CodexCli, buildRunArgs, parseLoginStatus, parseModelCatalog, parseRunOutput } from './CodexCli';

type Captured = { command: string; args: string[]; cwd?: string; env: NodeJS.ProcessEnv; stdin: string; files: Record<string, string> };

function fakeSpawn(reply: (c: Captured) => { stdout?: string; stderr?: string; code?: number; lastMessage?: string }) {
  const calls: Captured[] = [];
  const spawn = vi.fn((command: string, args: string[], options: any) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    const files: Record<string, string> = {};
    if (options.cwd && existsSync(options.cwd)) {
      for (const name of readdirSync(options.cwd)) files[name] = readFileSync(join(options.cwd, name), 'utf8').slice(0, 200);
    }
    const captured: Captured = { command, args, cwd: options.cwd, env: options.env, stdin: '', files };
    calls.push(captured);
    const stdin = new PassThrough();
    stdin.on('data', (d) => (captured.stdin += d.toString()));
    stdin.on('finish', () => {
      const out = reply(captured);
      const oIndex = args.indexOf('-o');
      if (out.lastMessage !== undefined && oIndex >= 0) writeFileSync(args[oIndex + 1], out.lastMessage);
      setImmediate(() => {
        if (out.stdout) child.stdout.write(out.stdout);
        if (out.stderr) child.stderr.write(out.stderr);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', out.code ?? 0);
      });
    });
    child.stdin = stdin;
    return child;
  });
  return { spawn: spawn as any, calls };
}

const events = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
const okEvents = (text: string) =>
  events(
    { type: 'thread.started', thread_id: 't' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } },
    { type: 'turn.completed', usage: { input_tokens: 11, cached_input_tokens: 5, cache_write_input_tokens: 0, output_tokens: 3 } }
  );

function homes() {
  const base = mkdtempSync(join(tmpdir(), 'neo-codex-test-'));
  return { realHome: join(base, 'real'), privateHome: join(base, 'private'), workRoot: base };
}

describe('buildRunArgs', () => {
  const base = { cwd: '/tmp/c', instructionsFile: '/tmp/c/instructions.md', lastMessageFile: '/tmp/c/last.txt' };

  it('is read-only, ephemeral and replaces the coding-agent prompt', () => {
    const args = buildRunArgs({ ...base, model: 'gpt-6.1-sol', effort: 'high' });
    expect(args[0]).toBe('exec');
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--skip-git-repo-check', '--ignore-rules', '--json']));
    expect(args[args.indexOf('-s') + 1]).toBe('read-only');
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain('model_instructions_file="/tmp/c/instructions.md"');
    expect(args).toContain('skills.include_instructions=false');
    expect(args).toContain('project_doc_max_bytes=0');
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6.1-sol');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain('-i');
  });

  it('puts the image flag last so it cannot swallow other options', () => {
    const args = buildRunArgs({ ...base, imagePath: '/tmp/c/image.png' });
    expect(args.slice(-2)).toEqual(['-i', '/tmp/c/image.png']);
  });

  it('escapes paths for TOML', () => {
    const args = buildRunArgs({ ...base, instructionsFile: '/tmp/a "b"/i.md' });
    expect(args).toContain('model_instructions_file="/tmp/a \\"b\\"/i.md"');
  });
});

describe('parsers', () => {
  it('parses login status', () => {
    expect(parseLoginStatus('Logged in using ChatGPT\n')).toEqual({ loggedIn: true, authMethod: 'chatgpt' });
    expect(parseLoginStatus('Logged in using an API key - sk-***')).toMatchObject({ loggedIn: true, authMethod: 'api-key' });
    expect(parseLoginStatus('Not logged in')).toEqual({ loggedIn: false });
  });

  it('lists only visible models, with vision and efforts', () => {
    const models = parseModelCatalog(
      JSON.stringify({
        models: [
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
          { slug: 'codex-auto-review', visibility: 'hide' },
        ],
      })
    );
    expect(models).toEqual([{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', supportsVision: true, efforts: ['low', 'high'] }]);
  });

  it('reads the answer from the last-message file and usage from events', () => {
    expect(parseRunOutput(okEvents('de eventos'), '', 0, ' do arquivo ', 5)).toEqual({
      text: 'do arquivo',
      inputTokens: 16,
      outputTokens: 3,
      durationMs: 5,
    });
    expect(parseRunOutput(okEvents('de eventos'), '', 0, '').text).toBe('de eventos');
  });

  it('maps the real usage-limit error', () => {
    const msg = 'You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:23 PM.';
    const out = events({ type: 'thread.started' }, { type: 'turn.started' }, { type: 'error', message: msg }, { type: 'turn.failed', error: { message: msg } });
    expect(() => parseRunOutput(out, '', 1, '')).toThrow(expect.objectContaining({ code: 'rate_limited', statusCode: 429 }));
  });

  it('maps login problems and unknown failures', () => {
    const failed = (message: string) => events({ type: 'turn.failed', error: { message } });
    expect(() => parseRunOutput(failed('Not logged in. Run codex login'), '', 1, '')).toThrow(expect.objectContaining({ code: 'not_logged_in', statusCode: 401 }));
    expect(() => parseRunOutput(failed('Your access token could not be refreshed: refresh token expired'), '', 1, '')).toThrow(expect.objectContaining({ code: 'not_logged_in' }));
    expect(() => parseRunOutput(failed('model not found'), '', 1, '')).toThrow(expect.objectContaining({ code: 'api_error' }));
    expect(() => parseRunOutput('', 'boom', 2, '')).toThrow(expect.objectContaining({ code: 'api_error' }));
    expect(() => parseRunOutput(events({ type: 'turn.completed', usage: {} }), '', 0, '')).toThrow(expect.objectContaining({ code: 'invalid_output' }));
  });
});

describe('CodexCli.run', () => {
  it('uses a private CODEX_HOME that only links the login, with a clean environment', async () => {
    process.env.OPENAI_API_KEY = 'sk-should-not-leak';
    process.env.CODEX_HOME = '/home/user/.codex';
    const h = homes();
    const { spawn, calls } = fakeSpawn(() => ({ stdout: okEvents('ok'), lastMessage: '42' }));
    const cli = new CodexCli({ spawn, binaryPath: '/opt/nvm/bin/codex', ...h });
    const result = await cli.run({ prompt: 'quanto é 17+25?', systemPrompt: 'seja breve', model: 'gpt-6-luna', effort: 'low' });
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_HOME;

    expect(result.text).toBe('42');
    const call = calls[0];
    expect(call.command).toBe('/opt/nvm/bin/codex');
    expect(call.stdin).toBe('quanto é 17+25?');
    expect(call.env.OPENAI_API_KEY).toBeUndefined(); // would bill the API instead of the subscription
    expect(call.env.CODEX_HOME).toBe(h.privateHome);
    expect(call.env.PATH!.startsWith('/opt/nvm/bin')).toBe(true); // the wrapper needs its own node
    expect(call.files['instructions.md']).toBe('seja breve');
    expect(call.cwd).toMatch(/neo-codex-/);
    expect(existsSync(call.cwd!)).toBe(false); // cleaned up

    const link = join(h.privateHome, 'auth.json');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(h.realHome, 'auth.json'));
    expect(readdirSync(h.privateHome)).toEqual(['auth.json']); // nothing else is shared
  });

  it('writes the image into the call dir and attaches it with -i', async () => {
    const h = homes();
    const { spawn, calls } = fakeSpawn((c) => ({ stdout: okEvents('um gato'), lastMessage: 'um gato' }));
    await new CodexCli({ spawn, binaryPath: '/x/codex', ...h }).run({ prompt: 'descreva', image: { data: Buffer.from('PNG'), extension: 'png' } });
    expect(calls[0].files['image.png']).toBe('PNG');
    expect(calls[0].args.slice(-2)[0]).toBe('-i');
  });

  it('surfaces the usage limit as a rate_limited error', async () => {
    const h = homes();
    const msg = 'You’ve hit your usage limit. try again at 5:23 PM.';
    const { spawn } = fakeSpawn(() => ({ stdout: events({ type: 'turn.failed', error: { message: msg } }), code: 1 }));
    await expect(new CodexCli({ spawn, binaryPath: '/x/codex', ...h }).run({ prompt: 'x' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('times out and kills the process group', async () => {
    const h = homes();
    const spawn = vi.fn(() => {
      const child: any = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = vi.fn();
      return child;
    });
    await expect(new CodexCli({ spawn: spawn as any, binaryPath: '/x/codex', ...h }).run({ prompt: 'x', timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a missing install', async () => {
    const cli = new CodexCli({ spawn: vi.fn() as any, ...homes() });
    vi.spyOn(cli, 'resolveBinary').mockReturnValue(null);
    await expect(cli.run({ prompt: 'x' })).rejects.toMatchObject({ code: 'not_installed' });
    expect(await cli.getAuthStatus()).toEqual({ installed: false, loggedIn: false });
  });

  it('checks login with `codex login status` against the real home', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stdout: 'Logged in using ChatGPT\n' }));
    const status = await new CodexCli({ spawn, binaryPath: '/x/codex', ...homes() }).getAuthStatus();
    expect(status).toEqual({ installed: true, loggedIn: true, authMethod: 'chatgpt' });
    expect(calls[0].args).toEqual(['login', 'status']);
    expect(calls[0].env.CODEX_HOME).toBeUndefined();
  });
});

describe('CodexCli.reconcileAuth', () => {
  it('moves refreshed tokens back to the real login when Codex replaced the link', async () => {
    const h = homes();
    const cli = new CodexCli({ spawn: vi.fn() as any, binaryPath: '/x/codex', ...h });
    await cli.prepareHome();
    const { mkdirSync, unlinkSync, writeFileSync: w, readFileSync: r, statSync } = await import('fs');
    mkdirSync(h.realHome, { recursive: true });
    w(join(h.realHome, 'auth.json'), 'OLD');
    // an atomic write after a token refresh swaps the symlink for a regular file
    unlinkSync(join(h.privateHome, 'auth.json'));
    w(join(h.privateHome, 'auth.json'), 'NEW-TOKENS');

    expect(await cli.reconcileAuth()).toBe(true);
    expect(r(join(h.realHome, 'auth.json'), 'utf8')).toBe('NEW-TOKENS');
    expect((statSync(join(h.realHome, 'auth.json')).mode & 0o777).toString(8)).toBe('600');
    expect(existsSync(join(h.privateHome, 'auth.json'))).toBe(false);

    await cli.prepareHome(); // the link is restored for the next call
    expect(lstatSync(join(h.privateHome, 'auth.json')).isSymbolicLink()).toBe(true);
  });

  it('leaves a healthy symlink alone', async () => {
    const h = homes();
    const cli = new CodexCli({ spawn: vi.fn() as any, binaryPath: '/x/codex', ...h });
    await cli.prepareHome();
    expect(await cli.reconcileAuth()).toBe(false);
  });
});
