import { describe, expect, it, vi } from 'vitest';
import type { STTFinalEvent, STTStatus } from '@neo/shared';
import { CodexTranscriptionProvider } from './CodexTranscriptionProvider';
import { CodexTranscriptionClient, CodexTranscriptionError } from '../codex/CodexTranscriptionClient';
import { decodeWav } from '../audio/wav';
import { silence, tone } from '../../testing/fixtures';

vi.mock('../../auth/codexCredentials', () => ({
  getCodexCredentials: vi.fn(async () => ({ accessToken: 't' })),
}));

const config = {
  provider: 'codex_transcribe' as const,
  modelId: 'vosk-pt-br-small-0.3',
  sampleRate: 16000,
  enablePartial: true,
  partialDebounceMs: 200,
  maxSegmentSeconds: 15,
};

function fakeClient(impl: (audio: Buffer) => Promise<string>) {
  const transcribe = vi.fn(async (input: { audio: Buffer; language?: string }) => impl(input.audio));
  const client = { transcribe, checkCredentials: vi.fn(async () => {}) } as unknown as CodexTranscriptionClient;
  return { client, transcribe };
}

function collect(provider: CodexTranscriptionProvider) {
  const finals: STTFinalEvent[] = [];
  const statuses: STTStatus[] = [];
  const errors: string[] = [];
  provider.onFinal((e) => finals.push(e));
  provider.onStatus((s) => statuses.push(s));
  provider.onError((e) => errors.push(e.message));
  return { finals, statuses, errors };
}

describe('CodexTranscriptionProvider', () => {
  it('sends one WAV clip per utterance and emits finals in speaking order', async () => {
    let n = 0;
    // the first clip resolves slower than the second: order must still be kept
    const { client, transcribe } = fakeClient(async () => {
      const id = ++n;
      await new Promise((r) => setTimeout(r, id === 1 ? 30 : 1));
      return `frase ${id}`;
    });
    const provider = new CodexTranscriptionProvider({ client });
    const { finals, statuses } = collect(provider);

    await provider.start(config);
    expect(statuses.at(-1)).toMatchObject({ state: 'listening', providerId: 'codex_transcribe' });
    provider.pushAudio(Buffer.concat([silence(300), tone(900), silence(900), tone(700)]));
    await provider.stop(); // flushes the second utterance

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(finals.map((f) => f.text)).toEqual(['frase 1', 'frase 2']);
    const firstInput = transcribe.mock.calls[0][0] as { audio: Buffer; language?: string };
    expect(decodeWav(firstInput.audio)).toMatchObject({ sampleRate: 16000, channels: 1 });
    expect(firstInput.language).toBe('pt');
    expect(statuses.at(-1)).toEqual({ state: 'idle' });
  });

  it('skips empty transcripts and keeps listening after a transient failure', async () => {
    const results: Array<() => Promise<string>> = [
      async () => {
        throw new CodexTranscriptionError('rate_limited', 'limite');
      },
      async () => '',
      async () => 'depois',
    ];
    const { client } = fakeClient(() => results.shift()!());
    const provider = new CodexTranscriptionProvider({ client });
    const { finals, errors } = collect(provider);

    await provider.start(config);
    provider.pushAudio(Buffer.concat([tone(600), silence(900), tone(600), silence(900), tone(600), silence(900)]));
    await provider.stop();

    expect(errors).toEqual([]);
    expect(finals.map((f) => f.text)).toEqual(['depois']);
  });

  it('stops sending after a fatal error and reports it once', async () => {
    const { client, transcribe } = fakeClient(async () => {
      throw new CodexTranscriptionError('forbidden', 'recusado');
    });
    const provider = new CodexTranscriptionProvider({ client });
    const { errors, statuses } = collect(provider);

    await provider.start(config);
    provider.pushAudio(Buffer.concat([tone(600), silence(900), tone(600), silence(900)]));
    await provider.stop();
    provider.pushAudio(tone(600));

    expect(errors).toEqual(['recusado']);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(statuses.some((s) => s.state === 'error')).toBe(true);
  });

  it('fails start() when there is no ChatGPT login', async () => {
    const { client } = fakeClient(async () => 'x');
    (client.checkCredentials as any).mockRejectedValueOnce(new CodexTranscriptionError('not_connected', 'sem login'));
    const provider = new CodexTranscriptionProvider({ client });
    const { errors } = collect(provider);
    await expect(provider.start(config)).rejects.toThrow('sem login');
    expect(errors).toEqual(['sem login']);
  });
});
