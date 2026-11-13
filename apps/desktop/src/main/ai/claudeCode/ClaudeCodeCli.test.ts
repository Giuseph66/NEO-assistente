import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeCli, ClaudeCodeError, buildRunArgs, parseRunOutput } from './ClaudeCodeCli';

type Captured = { command: string; args: string[]; cwd?: string; env: NodeJS.ProcessEnv; stdin: string; filesInCwd: string[] };

function fakeSpawn(reply: (c: Captured) => { stdout?: string; stderr?: string; code?: number }) {
  const calls: Captured[] = [];
  const spawn = vi.fn((command: string, args: string[], options: any) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    const captured: Captured = {
      command,
      args,
      cwd: options.cwd,
      env: options.env,
      stdin: '',
      filesInCwd: options.cwd && existsSync(options.cwd) ? readdirSync(options.cwd) : [],
    };
    calls.push(captured);
    const stdin = new PassThrough();
    stdin.on('data', (d) => (captured.stdin += d.toString()));
    stdin.on('finish', () => {
      const out = reply(captured);
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

const success = (result: string) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    duration_ms: 900,
    usage: { input_tokens: 2, cache_creation_input_tokens: 600, cache_read_input_tokens: 10, output_tokens: 4 },
    modelUsage: { 'claude-opus-5-5': {} },
  });

describe('buildRunArgs', () => {
  it('runs headless, isolated and without tools for text', () => {
    const args = buildRunArgs({ prompt: 'x', model: 'claude-opus-5-5', effort: 'high', systemPrompt: 'seja breve' });
    expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(args).toEqual(expect.arrayContaining(['--restricted', '--strict-mcp-config', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('seja breve');
    expect(args).not.toContain('--bare'); // --bare would ignore the subscription login
  });

  it('enables only Read (no prompts) when an image is attached', () => {
    const args = buildRunArgs({ prompt: 'x', image: { data: Buffer.from('i'), extension: 'png' } });
    expect(args[args.indexOf('--tools') + 1]).toBe('Read');
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none');
  });
});

describe('parseRunOutput', () => {
  it('returns text, model and token usage', () => {
    expect(parseRunOutput(success(' 4 '), '', 0)).toEqual({
      text: '4',
      model: 'claude-opus-5-5',
      inputTokens: 612,
      outputTokens: 4,
      durationMs: 900,
    });
  });

  it('maps login and usage-limit errors', () => {
    const notLogged = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', api_error_status: null });
    expect(() => parseRunOutput(notLogged, '', 1)).toThrow(expect.objectContaining({ code: 'not_logged_in', statusCode: 401 }));
    const limit = JSON.stringify({ type: 'result', is_error: true, result: 'Claude usage limit reached', api_error_status: 429 });
    expect(() => parseRunOutput(limit, '', 1)).toThrow(expect.objectContaining({ code: 'rate_limited', statusCode: 429 }));
    expect(() => parseRunOutput('', 'Invalid API key · Please run /login', 1)).toThrow(expect.objectContaining({ code: 'not_logged_in' }));
    expect(() => parseRunOutput('garbage', '', 0)).toThrow(expect.objectContaining({ code: 'invalid_output' }));
  });
});

describe('ClaudeCodeCli.run', () => {
  it('sends the prompt over stdin from a throwaway dir with a clean environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    const { spawn, calls } = fakeSpawn(() => ({ stdout: success('olá') }));
    const cli = new ClaudeCodeCli({ spawn, binaryPath: '/usr/bin/claude' });
    const result = await cli.run({ prompt: 'diga olá' });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ELECTRON_RUN_AS_NODE;

    expect(result.text).toBe('olá');
    const call = calls[0];
    expect(call.command).toBe('/usr/bin/claude');
    expect(call.stdin).toBe('diga olá');
    expect(call.env.ANTHROPIC_API_KEY).toBeUndefined(); // must not override the subscription login
    expect(call.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(call.cwd).toMatch(/neo-claude-/);
    expect(existsSync(call.cwd!)).toBe(false); // cleaned up
  });

  it('writes the image next to the call and tells the model where it is', async () => {
    let imageBytes = '';
    const { spawn, calls } = fakeSpawn((c) => {
      imageBytes = readFileSync(join(c.cwd!, 'image.jpg'), 'utf8');
      return { stdout: success('um gato') };
    });
    const cli = new ClaudeCodeCli({ spawn, binaryPath: '/usr/bin/claude' });
    await cli.run({ prompt: 'descreva', image: { data: Buffer.from('JPEGDATA'), extension: 'jpg' } });
    expect(imageBytes).toBe('JPEGDATA');
    expect(calls[0].stdin).toContain('./image.jpg');
    expect(calls[0].stdin).toContain('descreva');
  });

  it('times out and kills the process', async () => {
    const spawn = vi.fn(() => {
      const child: any = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = vi.fn();
      return child;
    });
    const cli = new ClaudeCodeCli({ spawn: spawn as any, binaryPath: '/usr/bin/claude' });
    await expect(cli.run({ prompt: 'x', timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a missing install', async () => {
    const cli = new ClaudeCodeCli({ binaryPath: undefined, spawn: vi.fn() as any });
    vi.spyOn(cli, 'resolveBinary').mockReturnValue(null);
    await expect(cli.run({ prompt: 'x' })).rejects.toBeInstanceOf(ClaudeCodeError);
    expect(await cli.getAuthStatus()).toEqual({ installed: false, loggedIn: false });
  });

  it('parses auth status', async () => {
    const { spawn } = fakeSpawn(() => ({
      stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', email: 'x@y' }),
    }));
    const cli = new ClaudeCodeCli({ spawn, binaryPath: '/usr/bin/claude' });
    expect(await cli.getAuthStatus()).toEqual({ installed: true, loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' });
  });
});
