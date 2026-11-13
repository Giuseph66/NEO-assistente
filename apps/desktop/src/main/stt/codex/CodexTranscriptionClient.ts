import type { CodexCredentials } from '../../auth/codexCredentials';

/**
 * Client for the transcription endpoint that backs voice input in OpenAI Codex,
 * authenticated with the user's own ChatGPT login (the same OAuth session the app
 * already uses for the `openai-codex` model provider).
 *
 * The endpoint is NOT a documented public API: OpenAI can change or restrict it at
 * any time. The app identifies itself honestly (it does not pose as a Codex client);
 * if the backend refuses non-Codex clients, the request fails with
 * `CodexTranscriptionError` code `forbidden` instead of being worked around.
 *
 * Contract (from public MIT-licensed clients): multipart POST with field `file`
 * (audio) and optional `language`; `Authorization: Bearer <access token>`;
 * `ChatGPT-Account-Id`; JSON response `{ "text": "..." }`; 413 when the clip is too
 * large.
 */
export const CODEX_TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe';

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 90_000;

export type CodexTranscriptionErrorCode =
  | 'not_connected'
  | 'unauthorized'
  | 'forbidden'
  | 'payload_too_large'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'invalid_response'
  | 'http_error'
  | 'aborted';

export class CodexTranscriptionError extends Error {
  constructor(
    readonly code: CodexTranscriptionErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'CodexTranscriptionError';
  }

  /** Errors that will not go away by retrying the next clip. */
  get fatal(): boolean {
    return this.code === 'not_connected' || this.code === 'unauthorized' || this.code === 'forbidden';
  }
}

export type CodexTranscribeInput = {
  audio: Buffer;
  filename?: string;
  mimeType?: string;
  /** ISO-639-1 code (`pt`, `en`); omitted = auto-detect. */
  language?: string;
  signal?: AbortSignal;
};

export type CodexTranscriptionClientOptions = {
  getCredentials: () => Promise<CodexCredentials>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clientName?: string;
  endpoint?: string;
};

export class CodexTranscriptionClient {
  private readonly getCredentials: () => Promise<CodexCredentials>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clientName: string;
  private readonly endpoint: string;

  constructor(options: CodexTranscriptionClientOptions) {
    this.getCredentials = options.getCredentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.clientName = options.clientName ?? 'neo-desktop';
    this.endpoint = options.endpoint ?? CODEX_TRANSCRIBE_URL;
  }

  /** Throws `not_connected` when there is no usable ChatGPT login. */
  async checkCredentials(): Promise<void> {
    try {
      await this.getCredentials();
    } catch (error) {
      throw new CodexTranscriptionError(
        'not_connected',
        error instanceof Error ? error.message : 'Login ChatGPT (Codex) não conectado'
      );
    }
  }

  async transcribe(input: CodexTranscribeInput): Promise<string> {
    let retries = 0;
    let refreshedAfter401 = false;
    let previousToken: string | null = null;

    while (true) {
      if (input.signal?.aborted) {
        throw new CodexTranscriptionError('aborted', 'Transcrição cancelada');
      }

      let credentials: CodexCredentials;
      try {
        credentials = await this.getCredentials();
      } catch (error) {
        throw new CodexTranscriptionError(
          'not_connected',
          error instanceof Error ? error.message : 'Login ChatGPT (Codex) não conectado'
        );
      }

      let response: Response;
      try {
        response = await this.post(credentials, input);
      } catch (error) {
        if (input.signal?.aborted) {
          throw new CodexTranscriptionError('aborted', 'Transcrição cancelada');
        }
        if (retries < MAX_RETRIES) {
          await this.sleep(backoffMs(retries));
          retries += 1;
          continue;
        }
        throw new CodexTranscriptionError(
          'network',
          `Falha de rede ao transcrever: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (response.ok) {
        return parseTranscript(await readText(response));
      }

      const status = response.status;
      const detail = redact(await readText(response), credentials.accessToken).slice(0, 300);

      if (status === 401) {
        // The token may have been refreshed by another request meanwhile: retry once
        // with whatever getCredentials() returns now.
        if (!refreshedAfter401 && previousToken !== credentials.accessToken) {
          refreshedAfter401 = true;
          previousToken = credentials.accessToken;
          continue;
        }
        throw new CodexTranscriptionError(
          'unauthorized',
          'Sessão ChatGPT expirada ou inválida. Faça login novamente em Configurações > API e Modelos > OpenAI.',
          status
        );
      }
      if (status === 403) {
        throw new CodexTranscriptionError(
          'forbidden',
          'O ChatGPT recusou a transcrição para este app (endpoint interno do Codex, sem acesso público). ' +
            'Use a transcrição local (Vosk) ou uma chave da API OpenAI.' +
            (detail ? ` Detalhe: ${detail}` : ''),
          status
        );
      }
      if (status === 413) {
        throw new CodexTranscriptionError('payload_too_large', 'Trecho de áudio grande demais para o Codex', status);
      }
      if ((status === 408 || status === 429 || status >= 500) && retries < MAX_RETRIES) {
        await this.sleep(retryAfterMs(response) ?? backoffMs(retries));
        retries += 1;
        continue;
      }
      if (status === 429) {
        throw new CodexTranscriptionError('rate_limited', 'Limite de uso do ChatGPT atingido. Tente mais tarde.', status);
      }
      if (status >= 500) {
        throw new CodexTranscriptionError('server_error', `Erro no servidor do ChatGPT (HTTP ${status})`, status);
      }
      throw new CodexTranscriptionError('http_error', `HTTP ${status}${detail ? `: ${detail}` : ''}`, status);
    }
  }

  private async post(credentials: CodexCredentials, input: CodexTranscribeInput): Promise<Response> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.audio)], { type: input.mimeType ?? 'audio/wav' });
    form.append('file', blob, input.filename ?? 'audio.wav');
    if (input.language) {
      form.append('language', input.language);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
      originator: this.clientName,
      'User-Agent': this.clientName,
    };
    if (credentials.accountId) {
      headers['ChatGPT-Account-Id'] = credentials.accountId;
    }

    // Electron 28 ships Node 18, which has no AbortSignal.any(): combine by hand.
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: form,
        // Never let the bearer token follow a redirect to another host.
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    }
  }
}

function parseTranscript(body: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new CodexTranscriptionError('invalid_response', 'Resposta da transcrição não é JSON');
  }
  const text = (payload as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') {
    throw new CodexTranscriptionError('invalid_response', 'Resposta da transcrição sem campo "text"');
  }
  return text.trim();
}

async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, 60) * 1000;
}

function backoffMs(attempt: number): number {
  return [1000, 3000, 8000][Math.min(attempt, 2)];
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text;
}

/** `pt-BR` → `pt`; empty/unknown → undefined (auto-detect). */
export function toIsoLanguage(language?: string | null): string | undefined {
  const code = (language || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : undefined;
}
