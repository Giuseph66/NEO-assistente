import { spawn as nodeSpawn, SpawnOptions, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, unlink, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { delimiter, dirname, join } from 'path';

/**
 * Runs prompts through the user's own Codex CLI (`codex exec`).
 *
 * This is how the app uses a ChatGPT subscription (Plus/Pro) for reasoning models:
 * the request is made by Codex itself, with the login the user did in Codex. The app
 * never reads, parses, stores or forwards the ChatGPT token, and does not imitate Codex.
 *
 * Isolation. `codex exec` is a coding agent: left alone it would load the user's
 * ~/.codex (global AGENTS.md, skills, hooks, MCP servers, config) into every request —
 * verified by capturing what the real CLI sends. So each call runs with:
 *  - its own CODEX_HOME holding only a symlink to the user's `auth.json` (the login is
 *    shared, nothing else is) — see `prepareHome()` / `reconcileAuth()`;
 *  - `model_instructions_file` replacing Codex's coding-agent prompt with the app's own
 *    system prompt, skills/environment sections off, project docs off;
 *  - `-s read-only` + `approval_policy=never`: no writes, no network, nobody to approve;
 *  - `--ephemeral`: nothing is added to the user's Codex session history;
 *  - a fresh temp directory as cwd.
 */

export type CodexEffort = 'low' | 'medium' | 'high';

export type CodexCliRunOptions = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  effort?: CodexEffort;
  image?: { data: Buffer; extension: string };
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CodexCliResult = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
};

export type CodexAuthStatus = {
  installed: boolean;
  loggedIn: boolean;
  /** `chatgpt` = subscription login; `api-key` bills the OpenAI API instead. */
  authMethod?: 'chatgpt' | 'api-key' | string;
  error?: string;
};

export type CodexCliModel = {
  id: string;
  name: string;
  supportsVision: boolean;
  efforts: string[];
};

export type CodexCliErrorCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'rate_limited'
  | 'api_error'
  | 'timeout'
  | 'aborted'
  | 'invalid_output'
  | 'process_error';

export class CodexCliError extends Error {
  constructor(
    readonly code: CodexCliErrorCode,
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'CodexCliError';
  }
}

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type CodexCliOptions = {
  spawn?: SpawnFn;
  /** Explicit binary; otherwise NEO_CODEX_PATH, PATH, nvm and the usual install dirs. */
  binaryPath?: string;
  /** Private CODEX_HOME used for model calls. */
  privateHome?: string;
  /** The user's real CODEX_HOME (default: $CODEX_HOME or ~/.codex). */
  realHome?: string;
  /** Parent dir for per-call working directories. */
  workRoot?: string;
  /** Extra `-c key=value` overrides (tests: point the CLI at a local fake model server). */
  extraConfig?: string[];
};

/** Key-pool placeholder: Codex keeps its own login, the app holds no secret. */
export const CODEX_CLI_VIRTUAL_KEY = 'codex-cli';

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_SYSTEM_PROMPT = 'Você é um assistente útil. Responda de forma clara e direta.';

/** Variables that would switch Codex to API-key billing, redirect it, or break the child. */
const STRIPPED_ENV = [
  'ELECTRON_RUN_AS_NODE',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'CODEX_HOME',
];

export class CodexCli {
  private readonly spawnFn: SpawnFn;
  private readonly explicitBinary?: string;
  private readonly privateHome: string;
  private readonly realHome: string;
  private readonly workRoot: string;
  private readonly extraConfig: string[];

  constructor(options: CodexCliOptions = {}) {
    this.spawnFn = options.spawn ?? (nodeSpawn as SpawnFn);
    this.explicitBinary = options.binaryPath;
    this.realHome = options.realHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
    this.privateHome = options.privateHome ?? join(tmpdir(), 'neo-codex-home');
    this.workRoot = options.workRoot ?? tmpdir();
    this.extraConfig = options.extraConfig ?? [];
  }

  resolveBinary(): string | null {
    if (this.explicitBinary) return this.explicitBinary;
    const fromEnv = process.env.NEO_CODEX_PATH;
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    const names = process.platform === 'win32' ? ['codex.cmd', 'codex.exe'] : ['codex'];
    const dirs = [
      ...(process.env.PATH || '').split(delimiter),
      ...nvmBinDirs(),
      join(homedir(), '.local', 'bin'),
      join(homedir(), '.npm-global', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ];
    for (const dir of dirs) {
      for (const name of names) {
        const candidate = join(dir, name);
        if (dir && existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  async getAuthStatus(): Promise<CodexAuthStatus> {
    const binary = this.resolveBinary();
    if (!binary) return { installed: false, loggedIn: false };
    try {
      const { stdout, stderr } = await this.exec(binary, ['login', 'status'], { timeoutMs: 30_000, home: 'real' });
      return { installed: true, ...parseLoginStatus(`${stdout}\n${stderr}`) };
    } catch (error) {
      return { installed: true, loggedIn: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Opens Codex's own browser login (writes the login into the user's real Codex home). */
  async login(): Promise<CodexAuthStatus> {
    await this.exec(this.requireBinary(), ['login'], { timeoutMs: 8 * 60_000, home: 'real' });
    return this.getAuthStatus();
  }

  async logout(): Promise<CodexAuthStatus> {
    await this.exec(this.requireBinary(), ['logout'], { timeoutMs: 60_000, home: 'real' });
    return this.getAuthStatus();
  }

  /** Models available to the signed-in account (`codex debug models`). */
  async listModels(): Promise<CodexCliModel[]> {
    const binary = this.requireBinary();
    const { stdout } = await this.exec(binary, ['debug', 'models'], { timeoutMs: 30_000, home: 'real' });
    return parseModelCatalog(stdout);
  }

  async run(options: CodexCliRunOptions): Promise<CodexCliResult> {
    const binary = this.requireBinary();
    await this.prepareHome();
    const cwd = await mkdtemp(join(this.workRoot, 'neo-codex-'));
    try {
      const instructionsFile = join(cwd, 'instructions.md');
      const lastMessageFile = join(cwd, 'last-message.txt');
      await writeFile(instructionsFile, options.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT);

      let imagePath: string | undefined;
      if (options.image) {
        imagePath = join(cwd, `image.${options.image.extension}`);
        await writeFile(imagePath, options.image.data);
      }

      const args = buildRunArgs({
        cwd,
        instructionsFile,
        lastMessageFile,
        model: options.model,
        effort: options.effort,
        imagePath,
        extraConfig: this.extraConfig,
      });

      const startedAt = Date.now();
      const { stdout, stderr, code } = await this.exec(binary, args, {
        cwd,
        input: options.prompt,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
        home: 'private',
      });

      const lastMessage = await readFile(lastMessageFile, 'utf8').catch(() => '');
      return parseRunOutput(stdout, stderr, code, lastMessage, Date.now() - startedAt);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      await this.reconcileAuth().catch(() => undefined);
    }
  }

  /** Private CODEX_HOME that shares only the user's login with the real one. */
  async prepareHome(): Promise<void> {
    await this.reconcileAuth();
    await mkdir(this.privateHome, { recursive: true, mode: 0o700 });
    const link = join(this.privateHome, 'auth.json');
    const target = join(this.realHome, 'auth.json');
    const current = await lstat(link).catch(() => null);
    if (current?.isSymbolicLink() && (await readlink(link)) === target) return;
    if (current) await unlink(link);
    await symlink(target, link);
  }

  /**
   * If Codex replaced the private `auth.json` link with a regular file (an atomic
   * write after a token refresh), that file holds the newest tokens. Move it back to
   * the real login so the user's own Codex is not left with an outdated, rotated-out
   * refresh token. The file is copied as is — never opened or parsed.
   */
  async reconcileAuth(): Promise<boolean> {
    const link = join(this.privateHome, 'auth.json');
    const current = await lstat(link).catch(() => null);
    if (!current || !current.isFile()) return false;
    const target = join(this.realHome, 'auth.json');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(link, target);
    await chmod(target, 0o600);
    await unlink(link);
    return true;
  }

  private requireBinary(): string {
    const binary = this.resolveBinary();
    if (!binary) {
      throw new CodexCliError(
        'not_installed',
        'Codex CLI não encontrado. Instale com `npm i -g @openai/codex` ou defina NEO_CODEX_PATH.'
      );
    }
    return binary;
  }

  private exec(
    binary: string,
    args: string[],
    opts: { cwd?: string; input?: string; timeoutMs: number; signal?: AbortSignal; home: 'real' | 'private' }
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const key of STRIPPED_ENV) delete env[key];
      // The CLI is a Node script (`#!/usr/bin/env node`): make sure its own node is reachable.
      env.PATH = [dirname(binary), env.PATH].filter(Boolean).join(delimiter);
      if (opts.home === 'private') env.CODEX_HOME = this.privateHome;
      else if (process.env.CODEX_HOME) env.CODEX_HOME = process.env.CODEX_HOME;

      let child: ChildProcess;
      try {
        child = this.spawnFn(binary, args, {
          cwd: opts.cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          detached: process.platform !== 'win32',
        });
      } catch (error) {
        reject(new CodexCliError('process_error', `Falha ao iniciar o Codex: ${String(error)}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const timer = setTimeout(() => {
        killTree(child);
        finish(() => reject(new CodexCliError('timeout', 'O Codex demorou demais para responder.')));
      }, opts.timeoutMs);
      const onAbort = () => {
        killTree(child);
        finish(() => reject(new CodexCliError('aborted', 'Solicitação cancelada.')));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
      child.on('error', (error) =>
        finish(() => reject(new CodexCliError('process_error', `Falha ao executar o Codex: ${error.message}`)))
      );
      child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })));

      child.stdin?.on('error', () => undefined);
      child.stdin?.end(opts.input ?? '');
    });
  }
}

export type RunArgsInput = {
  cwd: string;
  instructionsFile: string;
  lastMessageFile: string;
  model?: string;
  effort?: CodexEffort;
  imagePath?: string;
  extraConfig?: string[];
};

/** TOML basic strings use the same escapes as JSON. */
const toml = (value: string) => JSON.stringify(value);

export function buildRunArgs(input: RunArgsInput): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '-s',
    'read-only',
    '--color',
    'never',
    '--json',
    '-C',
    input.cwd,
    '-o',
    input.lastMessageFile,
    '-c',
    'approval_policy="never"',
    '-c',
    `model_instructions_file=${toml(input.instructionsFile)}`,
    '-c',
    'skills.include_instructions=false',
    '-c',
    'include_environment_context=false',
    '-c',
    'project_doc_max_bytes=0',
  ];
  if (input.model) args.push('-m', input.model);
  if (input.effort) args.push('-c', `model_reasoning_effort=${toml(input.effort)}`);
  for (const override of input.extraConfig ?? []) args.push('-c', override);
  // Last: `-i` takes a list, the prompt itself arrives on stdin.
  if (input.imagePath) args.push('-i', input.imagePath);
  return args;
}

export function parseLoginStatus(text: string): Pick<CodexAuthStatus, 'loggedIn' | 'authMethod' | 'error'> {
  const logged = /logged in using (.+)/i.exec(text);
  if (logged) {
    const method = logged[1].trim();
    return { loggedIn: true, authMethod: /chatgpt/i.test(method) ? 'chatgpt' : /api key/i.test(method) ? 'api-key' : method };
  }
  return { loggedIn: false };
}

export function parseModelCatalog(stdout: string): CodexCliModel[] {
  let payload: any;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new CodexCliError('invalid_output', 'Catálogo de modelos do Codex inválido.');
  }
  const models: any[] = Array.isArray(payload) ? payload : Array.isArray(payload?.models) ? payload.models : [];
  return models
    .filter((m) => m && typeof m.slug === 'string' && m.visibility === 'list')
    .map((m) => ({
      id: m.slug,
      name: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug,
      supportsVision: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : true,
      efforts: Array.isArray(m.supported_reasoning_levels)
        ? m.supported_reasoning_levels.map((l: any) => (typeof l === 'string' ? l : l?.effort)).filter(Boolean)
        : [],
    }));
}

type CodexEvent = { type?: string; message?: string; item?: { type?: string; text?: string }; usage?: any; error?: { message?: string } };

export function parseRunOutput(
  stdout: string,
  stderr: string,
  code: number | null,
  lastMessage: string,
  durationMs?: number
): CodexCliResult {
  const events: CodexEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // not an event line
    }
  }

  const failure = [...events].reverse().find((e) => e.type === 'turn.failed' || e.type === 'error');
  const failureMessage = failure?.error?.message || failure?.message;
  if (failure || (code !== 0 && !lastMessage.trim())) {
    const message = (failureMessage || stderr.trim().split('\n').slice(-3).join(' ') || `Codex terminou com código ${code}`).trim();
    if (/usage limit|hit your usage|rate.?limit|try again at|too many requests/i.test(message)) {
      throw new CodexCliError('rate_limited', `Limite de uso da assinatura ChatGPT atingido: ${message}`, 429);
    }
    if (/not logged in|log ?in|sign in|unauthorized|\b401\b|token.*(expired|invalid|revoked)|refresh token/i.test(message)) {
      throw new CodexCliError('not_logged_in', `Codex sem login válido: ${message}`, 401);
    }
    throw new CodexCliError('api_error', message);
  }

  const agentMessage = [...events]
    .reverse()
    .find((e) => e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string');
  const text = (lastMessage.trim() || agentMessage?.item?.text || '').trim();
  if (!text) {
    throw new CodexCliError('invalid_output', 'O Codex terminou sem resposta.');
  }

  const usage = [...events].reverse().find((e) => e.type === 'turn.completed')?.usage;
  const cached = typeof usage?.cached_input_tokens === 'number' ? usage.cached_input_tokens : 0;
  return {
    text,
    inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens + cached : undefined,
    outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined,
    durationMs,
  };
}

function killTree(child: ChildProcess): void {
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM'); // the CLI is a node wrapper around a native binary
      return;
    }
  } catch {
    // fall through to a plain kill
  }
  child.kill('SIGTERM');
}

function nvmBinDirs(): string[] {
  const root = join(homedir(), '.nvm', 'versions', 'node');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readdirSync } = require('fs') as typeof import('fs');
    return readdirSync(root).map((version) => join(root, version, 'bin'));
  } catch {
    return [];
  }
}

let sharedCli: CodexCli | null = null;
export function getCodexCli(): CodexCli {
  if (!sharedCli) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    sharedCli = new CodexCli({ privateHome: join(app.getPath('userData'), 'codex-home') });
  }
  return sharedCli;
}
