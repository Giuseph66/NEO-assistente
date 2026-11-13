import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

const captures: Array<EventEmitter & { stopped: boolean }> = [];
const providers: Array<EventEmitter & { stopped: number; pushed: number }> = [];

vi.mock('../storage/configStore', () => ({
  getConfigStore: () => ({
    getConfig: () => ({ provider: 'codex_transcribe', modelId: '', sampleRate: 16000, enablePartial: true, partialDebounceMs: 200, maxSegmentSeconds: 15 }),
  }),
}));
vi.mock('./models/ModelManager', () => ({ ModelManager: class {} }));
vi.mock('../ai/ApiKeyPool', () => ({ ApiKeyPool: class {} }));
vi.mock('../ai/AIServiceManager', () => ({ getKeyStorage: () => null }));
vi.mock('../auth/openaiOAuth', () => ({ getOAuthController: () => null }));
vi.mock('../database', () => ({ DatabaseManager: class {} }));
vi.mock('../audio/system/SystemAudioHub', () => ({
  getSystemAudioHub: () => ({
    createCapture: () => {
      const c = Object.assign(new EventEmitter(), { stopped: false }) as any;
      c.start = async () => undefined;
      c.stop = async () => {
        c.stopped = true;
      };
      c.onData = (cb: any) => (c.on('data', cb), () => c.off('data', cb));
      c.onError = (cb: any) => (c.on('error', cb), () => c.off('error', cb));
      captures.push(c);
      return c;
    },
  }),
}));
vi.mock('./providers/LiveProviderRegistry', () => ({
  normalizeLiveProviderId: (id: string) => id,
  createLiveTranscriptionProvider: () => {
    const p = Object.assign(new EventEmitter(), { stopped: 0, pushed: 0 }) as any;
    const on = (n: string) => (cb: any) => (p.on(n, cb), () => p.off(n, cb));
    Object.assign(p, {
      start: async () => p.emit('status', { state: 'listening', providerId: 'codex_transcribe' }),
      pushAudio: () => (p.pushed += 1),
      stop: async () => {
        p.stopped += 1;
        p.emit('status', { state: 'idle' });
      },
      dispose: async () => undefined,
      onPartial: on('partial'),
      onFinal: on('final'),
      onStatus: on('status'),
      onError: on('error'),
      onDebug: on('debug'),
    });
    providers.push(p);
    return p;
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SystemSttController error handling', () => {
  it('tears down when the capture dies, keeps the error visible, and restarts cleanly', async () => {
    const { SystemSttController } = await import('./SystemSttController');
    const ctrl = new SystemSttController({} as any);
    ctrl.onError(() => undefined); // registerSystemSttIpc always listens
    await ctrl.start({ sourceId: 'm' });
    expect(ctrl.getStatus().state).toBe('listening');

    captures[0].emit('error', new Error('parec morreu'));
    await flush();
    expect(ctrl.getStatus()).toMatchObject({ state: 'error', message: 'parec morreu' });
    expect(captures[0].stopped).toBe(true);
    expect(providers[0].stopped).toBe(1);

    await ctrl.start({ sourceId: 'm' });
    expect(ctrl.getStatus().state).toBe('listening');
    expect(captures).toHaveLength(2);
    expect(providers[0].stopped).toBe(1); // not stopped twice

    await ctrl.stop();
    expect(ctrl.getStatus().state).toBe('idle');
    expect(captures[1].stopped).toBe(true);
  });

  it('keeps running after a non-fatal provider error, and stop() still releases everything', async () => {
    captures.length = 0;
    providers.length = 0;
    const { SystemSttController } = await import('./SystemSttController');
    const ctrl = new SystemSttController({} as any);
    ctrl.onError(() => undefined); // registerSystemSttIpc always listens
    await ctrl.start({ sourceId: 'm' });
    providers[0].emit('error', { message: 'server hiccup', providerId: 'openai_realtime_transcribe' });
    await flush();
    expect(ctrl.getStatus().state).toBe('error');
    expect(captures[0].stopped).toBe(false);
    captures[0].emit('data', Buffer.alloc(320));
    expect(providers[0].pushed).toBe(1);

    await ctrl.stop();
    expect(ctrl.getStatus().state).toBe('idle');
    expect(captures[0].stopped).toBe(true);
    expect(providers[0].stopped).toBe(1);
  });

  it('tears down on a fatal provider error (login/permission)', async () => {
    captures.length = 0;
    providers.length = 0;
    const { SystemSttController } = await import('./SystemSttController');
    const ctrl = new SystemSttController({} as any);
    ctrl.onError(() => undefined); // registerSystemSttIpc always listens
    await ctrl.start({ sourceId: 'm' });
    providers[0].emit('error', { message: 'recusado', code: 'forbidden', providerId: 'codex_transcribe' });
    await flush();
    expect(ctrl.getStatus()).toMatchObject({ state: 'error', message: 'recusado' });
    expect(captures[0].stopped).toBe(true);
    expect(providers[0].stopped).toBe(1);
  });
});
