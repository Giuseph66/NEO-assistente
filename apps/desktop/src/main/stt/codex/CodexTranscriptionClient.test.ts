import { describe, expect, it, vi } from 'vitest';
import {
  CODEX_TRANSCRIBE_URL,
  CodexTranscriptionClient,
  CodexTranscriptionError,
  toIsoLanguage,
} from './CodexTranscriptionClient';
import type { CodexCredentials } from '../../auth/codexCredentials';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return next();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const creds: CodexCredentials = { accessToken: 'tok-1', accountId: 'acct-9' };
const noSleep = async () => {};

function client(
  responses: Array<() => Response>,
  getCredentials: () => Promise<CodexCredentials> = async () => creds
) {
  const fetch = fakeFetch(responses);
  return { client: new CodexTranscriptionClient({ getCredentials, fetchImpl: fetch.impl, sleep: noSleep }), ...fetch };
}

describe('CodexTranscriptionClient', () => {
  it('posts the audio as multipart with ChatGPT auth headers and returns the text', async () => {
    const { client: c, calls } = client([() => json({ text: '  olá mundo  ' })]);
    const text = await c.transcribe({ audio: Buffer.from('RIFFxxxx'), language: 'pt', filename: 'a.wav' });

    expect(text).toBe('olá mundo');
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(CODEX_TRANSCRIBE_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['ChatGPT-Account-Id']).toBe('acct-9');
    // identifies itself honestly, never as a Codex client
    expect(headers.originator).toBe('neo-desktop');
    expect(headers['User-Agent']).not.toMatch(/codex/i);

    const form = init.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('a.wav');
    expect(file.type).toBe('audio/wav');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('RIFFxxxx');
    expect(form.get('language')).toBe('pt');
  });

  it('omits language and account header when not available', async () => {
    const { client: c, calls } = client([() => json({ text: 'x' })], async () => ({ accessToken: 't' }));
    await c.transcribe({ audio: Buffer.from('a') });
    expect((calls[0].init.body as FormData).has('language')).toBe(false);
    expect((calls[0].init.headers as Record<string, string>)['ChatGPT-Account-Id']).toBeUndefined();
  });

  it('retries 429/5xx and honours Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    const fetch = fakeFetch([
      () => json({ detail: 'slow down' }, 429, { 'retry-after': '2' }),
      () => json({ detail: 'oops' }, 502),
      () => json({ text: 'ok' }),
    ]);
    const c = new CodexTranscriptionClient({ getCredentials: async () => creds, fetchImpl: fetch.impl, sleep });
    await expect(c.transcribe({ audio: Buffer.from('a') })).resolves.toBe('ok');
    expect(fetch.calls).toHaveLength(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
  });

  it('gives up after the retry budget with rate_limited', async () => {
    const { client: c } = client(Array.from({ length: 4 }, () => () => json({}, 429)));
    await expect(c.transcribe({ audio: Buffer.from('a') })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('on 401 retries once with refreshed credentials, then reports unauthorized', async () => {
    let n = 0;
    const getCredentials = async () => ({ accessToken: `tok-${++n}` });
    const { client: c, calls } = client([() => json({}, 401), () => json({ text: 'fresh' })], getCredentials);
    await expect(c.transcribe({ audio: Buffer.from('a') })).resolves.toBe('fresh');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');

    const second = client([() => json({}, 401), () => json({}, 401)]);
    const error = await second.client.transcribe({ audio: Buffer.from('a') }).catch((e) => e);
    expect(error).toBeInstanceOf(CodexTranscriptionError);
    expect(error.code).toBe('unauthorized');
    expect(error.fatal).toBe(true);
  });

  it('maps 403 to a fatal forbidden error without leaking the token', async () => {
    const { client: c } = client([() => new Response('denied for tok-1', { status: 403 })]);
    const error = await c.transcribe({ audio: Buffer.from('a') }).catch((e) => e);
    expect(error.code).toBe('forbidden');
    expect(error.fatal).toBe(true);
    expect(error.message).not.toContain('tok-1');
  });

  it('maps 413 and malformed bodies', async () => {
    await expect(client([() => json({}, 413)]).client.transcribe({ audio: Buffer.from('a') })).rejects.toMatchObject({
      code: 'payload_too_large',
    });
    await expect(client([() => new Response('<html>')]).client.transcribe({ audio: Buffer.from('a') })).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(client([() => json({ result: 'x' })]).client.transcribe({ audio: Buffer.from('a') })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('reports not_connected when there is no login', async () => {
    const { client: c, calls } = client([], async () => {
      throw new Error('sem login');
    });
    await expect(c.transcribe({ audio: Buffer.from('a') })).rejects.toMatchObject({ code: 'not_connected' });
    await expect(c.checkCredentials()).rejects.toMatchObject({ code: 'not_connected' });
    expect(calls).toHaveLength(0);
  });

  it('retries network failures, then reports network', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const c = new CodexTranscriptionClient({ getCredentials: async () => creds, fetchImpl: impl, sleep: noSleep });
    await expect(c.transcribe({ audio: Buffer.from('a') })).rejects.toMatchObject({ code: 'network' });
    expect(impl).toHaveBeenCalledTimes(4);
  });

  it('normalises language tags', () => {
    expect(toIsoLanguage('pt-BR')).toBe('pt');
    expect(toIsoLanguage('EN_us')).toBe('en');
    expect(toIsoLanguage('')).toBeUndefined();
    expect(toIsoLanguage('???')).toBeUndefined();
  });
});
