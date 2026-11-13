import { spawn as nodeSpawn, SpawnOptions, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { delimiter, join } from 'path';

/**
 * Runs prompts through the user's own Claude Code CLI (`claude -p`).
 *
 * This is how the app uses a Claude.ai subscription (Pro/Max): the request is made
 * by Claude Code itself, with the login the user did in Claude Code. The app never
 * reads, stores or forwards the OAuth token, and does not imitate Claude Code.
 *
 * Isolation for each call:
 *  - `--restricted` + `--tools ""` (or only `Read` for images): no shell, no file
 *    writes, user/project settings (hooks) ignored;
 *  - `--strict-mcp-config` with no config: no MCP servers;
 *  - `--system-prompt`: replaces Claude Code's coding-agent prompt;
 *  - `--no-session-persistence`: nothing is added to the user's session history;
 *  - a fresh temp directory as cwd: no project CLAUDE.md is picked up.
 */

export type ClaudeCodeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ClaudeCodeRunOptions = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  effort?: ClaudeCodeEffort;
  /** Image made readable to the model (written into the call's temp dir). */
  image?: { data: Buffer; extension: string };
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ClaudeCodeResult = {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
};

export type ClaudeCodeAuthStatus = {
  installed: boolean;
  loggedIn: boolean;
  /** `claude.ai` = subscription login; anything else (API key, cloud) is reported as is. */
  authMethod?: string;
  subscriptionType?: string;
  error?: string;
};

export type ClaudeCodeErrorCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'rate_limited'
  | 'api_error'
  | 'timeout'
  | 'aborted'
  | 'invalid_output'
  | 'process_error';

export class ClaudeCodeError extends Error {
  constructor(
    readonly code: ClaudeCodeErrorCode,
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ClaudeCodeError';
  }
}

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type ClaudeCodeCliOptions = {
  spawn?: SpawnFn;
  /** Explicit binary; otherwise NEO_CLAUDE_PATH, PATH and the usual install dirs. */
  binaryPath?: string;
  /** Parent dir for per-call working directories. */
  workRoot?: string;
};

/** Key-pool placeholder: Claude Code keeps its own login, the app holds no secret. */
export const CLAUDE_CODE_VIRTUAL_KEY = 'claude-code-cli';

const DEFAULT_TIMEOUT_MS = 300_000;
const IMAGE_FILE = 'image';

/** Variables that would redirect Claude Code away from the subscription login or break the child. */
const STRIPPED_ENV = [
  'ELECTRON_RUN_AS_NODE',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_SIMPLE',
];

export class ClaudeCodeCli {
  private readonly spawnFn: SpawnFn;
  private readonly explicitBinary?: string;
  private readonly workRoot: string;

  constructor(options: ClaudeCodeCliOptions = {}) {
    this.spawnFn = options.spawn ?? (nodeSpawn as SpawnFn);
    this.explicitBinary = options.binaryPath;
    this.workRoot = options.workRoot ?? tmpdir();
  }

  resolveBinary(): string | null {
    if (this.explicitBinary) return this.explicitBinary;
    const fromEnv = process.env.NEO_CLAUDE_PATH;
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
    const dirs = [
      ...(process.env.PATH || '').split(delimiter),
      join(homedir(), '.local', 'bin'),
      join(homedir(), '.claude', 'local'),
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

  async getAuthStatus(): Promise<ClaudeCodeAuthStatus> {
    const binary = this.resolveBinary();
    if (!binary) return { installed: false, loggedIn: false };
    try {
      const { stdout, code } = await this.exec(binary, ['auth', 'status', '--json'], { timeoutMs: 30_000 });
      const status = safeJson(stdout);
      if (!status) {
        return { installed: true, loggedIn: false, error: code === 0 ? 'Resposta inválida do Claude Code' : stdout.trim() };
      }
      return {
        installed: true,
        loggedIn: status.loggedIn === true,
        authMethod: typeof status.authMethod === 'string' ? status.authMethod : undefined,
        subscriptionType: typeof status.subscriptionType === 'string' ? status.subscriptionType : undefined,
      };
    } catch (error) {
      return { installed: true, loggedIn: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Opens Claude Code's own browser login. */
  async login(): Promise<ClaudeCodeAuthStatus> {
    const binary = this.requireBinary();
    await this.exec(binary, ['auth', 'login'], { timeoutMs: 8 * 60_000 });
    return this.getAuthStatus();
  }

  async logout(): Promise<ClaudeCodeAuthStatus> {
    const binary = this.requireBinary();
    await this.exec(binary, ['auth', 'logout'], { timeoutMs: 60_000 });
    return this.getAuthStatus();
  }

  async run(options: ClaudeCodeRunOptions): Promise<ClaudeCodeResult> {
    const binary = this.requireBinary();
    const cwd = await mkdtemp(join(this.workRoot, 'neo-claude-'));
    try {
      let prompt = options.prompt;
      if (options.image) {
        const file = `${IMAGE_FILE}.${options.image.extension}`;
        await writeFile(join(cwd, file), options.image.data);
        prompt = `A imagem anexada está no arquivo ./${file} — leia esse arquivo para analisá-la.\n\n${prompt}`;
      }

      const { stdout, stderr, code } = await this.exec(binary, buildRunArgs(options), {
        cwd,
        input: prompt,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
      });
      return parseRunOutput(stdout, stderr, code);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private requireBinary(): string {
    const binary = this.resolveBinary();
    if (!binary) {
      throw new ClaudeCodeError(
        'not_installed',
        'Claude Code não encontrado. Instale em https://claude.com/claude-code ou defina NEO_CLAUDE_PATH.'
      );
    }
    return binary;
  }

  private exec(
    binary: string,
    args: string[],
    opts: { cwd?: string; input?: string; timeoutMs: number; signal?: AbortSignal }
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const key of STRIPPED_ENV) delete env[key];

      let child: ChildProcess;
      try {
        child = this.spawnFn(binary, args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      } catch (error) {
        reject(new ClaudeCodeError('process_error', `Falha ao iniciar o Claude Code: ${String(error)}`));
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
        child.kill('SIGTERM');
        finish(() => reject(new ClaudeCodeError('timeout', 'O Claude Code demorou demais para responder.')));
      }, opts.timeoutMs);
      const onAbort = () => {
        child.kill('SIGTERM');
        finish(() => reject(new ClaudeCodeError('aborted', 'Solicitação cancelada.')));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
      child.on('error', (error) =>
        finish(() => reject(new ClaudeCodeError('process_error', `Falha ao executar o Claude Code: ${error.message}`)))
      );
      child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })));

      child.stdin?.on('error', () => undefined);
      child.stdin?.end(opts.input ?? '');
    });
  }
}

export function buildRunArgs(options: ClaudeCodeRunOptions): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--restricted',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--tools',
    options.image ? 'Read' : '',
  ];
  if (options.image) {
    // Nobody can answer a permission prompt in headless mode; reading the image needs none.
    args.push('--permission-prompts', 'none');
  }
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--effort', options.effort);
  args.push('--system-prompt', options.systemPrompt?.trim() || 'Você é um assistente útil. Responda de forma clara e direta.');
  return args;
}

export function parseRunOutput(stdout: string, stderr: string, code: number | null): ClaudeCodeResult {
  const payload = safeJson(lastJsonLine(stdout));
  if (!payload) {
    const detail = (stderr || stdout).trim().slice(0, 400);
    if (/not logged in|please run .*login|invalid api key|\/login/i.test(detail)) {
      throw new ClaudeCodeError('not_logged_in', 'Claude Code sem login. Faça login em Configurações > API e Modelos > Anthropic.', 401);
    }
    throw new ClaudeCodeError(
      code === 0 ? 'invalid_output' : 'process_error',
      `Claude Code terminou sem resposta válida${detail ? `: ${detail}` : ''}`
    );
  }

  if (payload.is_error || (payload.subtype && payload.subtype !== 'success')) {
    const message = typeof payload.result === 'string' && payload.result.trim() ? payload.result.trim() : `Erro do Claude Code (${payload.subtype ?? 'desconhecido'})`;
    const status = typeof payload.api_error_status === 'number' ? payload.api_error_status : undefined;
    if (status === 401 || /not logged in|\/login|authentication/i.test(message)) {
      throw new ClaudeCodeError('not_logged_in', `Claude Code sem login válido: ${message}`, 401);
    }
    if (status === 429 || /usage limit|rate limit|limit reached/i.test(message)) {
      throw new ClaudeCodeError('rate_limited', `Limite de uso da assinatura Claude atingido: ${message}`, 429);
    }
    throw new ClaudeCodeError('api_error', message, status);
  }

  const usage = payload.usage ?? {};
  const models = payload.modelUsage && typeof payload.modelUsage === 'object' ? Object.keys(payload.modelUsage) : [];
  return {
    text: typeof payload.result === 'string' ? payload.result.trim() : '',
    model: models[0],
    inputTokens: sumDefined(usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens),
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
    durationMs: typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined,
  };
}

function lastJsonLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().startsWith('{'));
  return lines[lines.length - 1] ?? '';
}

function safeJson(text: string): any | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function sumDefined(...values: unknown[]): number | undefined {
  const numbers = values.filter((v): v is number => typeof v === 'number');
  return numbers.length ? numbers.reduce((a, b) => a + b, 0) : undefined;
}

let sharedCli: ClaudeCodeCli | null = null;
export function getClaudeCodeCli(): ClaudeCodeCli {
  if (!sharedCli) sharedCli = new ClaudeCodeCli();
  return sharedCli;
}
