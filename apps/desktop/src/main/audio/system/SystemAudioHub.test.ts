import { EventEmitter } from 'events';
import { spawnSync } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { SystemAudioHub } from './SystemAudioHub';
import type { CaptureOptions, SystemAudioCaptureLike } from './SystemAudioCapture';

class FakeCapture implements SystemAudioCaptureLike {
  static created: FakeCapture[] = [];
  emitter = new EventEmitter();
  started: CaptureOptions | null = null;
  stopped = false;
  constructor(private failStart = false) {
    FakeCapture.created.push(this);
  }
  async start(options: CaptureOptions) {
    await new Promise((r) => setTimeout(r, 5));
    if (this.failStart) throw new Error('no device');
    this.started = options;
  }
  async stop() {
    this.stopped = true;
  }
  onData(cb: (chunk: Buffer) => void) {
    this.emitter.on('data', cb);
    return () => this.emitter.off('data', cb);
  }
  onError(cb: (error: Error) => void) {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }
  push(chunk: Buffer) {
    this.emitter.emit('data', chunk);
  }
}

const opts = { sourceId: 'sink.monitor', sampleRate: 16000 };

describe('SystemAudioHub', () => {
  it('shares one capture between consumers and stops it when the last one leaves', async () => {
    FakeCapture.created = [];
    const hub = new SystemAudioHub(() => new FakeCapture());
    const recorder = hub.createCapture();
    const stt = hub.createCapture();
    const gotRecorder: number[] = [];
    const gotStt: number[] = [];
    recorder.onData((c) => gotRecorder.push(c.length));
    stt.onData((c) => gotStt.push(c.length));

    await Promise.all([recorder.start(opts), stt.start(opts)]);
    expect(FakeCapture.created).toHaveLength(1);
    FakeCapture.created[0].push(Buffer.alloc(3200));
    expect(gotRecorder).toEqual([3200]);
    expect(gotStt).toEqual([3200]);

    await recorder.stop();
    expect(FakeCapture.created[0].stopped).toBe(false);
    FakeCapture.created[0].push(Buffer.alloc(320));
    expect(gotRecorder).toEqual([3200]);
    expect(gotStt).toEqual([3200, 320]);

    await stt.stop();
    expect(FakeCapture.created[0].stopped).toBe(true);
    expect(hub.activeStreams()).toBe(0);
  });

  it('uses separate captures for different sources or rates', async () => {
    FakeCapture.created = [];
    const hub = new SystemAudioHub(() => new FakeCapture());
    const a = hub.createCapture();
    const b = hub.createCapture();
    await a.start(opts);
    await b.start({ ...opts, sampleRate: 24000 });
    expect(FakeCapture.created).toHaveLength(2);
    await a.stop();
    await b.stop();
  });

  it('reports a dead capture to every consumer and reopens on the next start', async () => {
    FakeCapture.created = [];
    const hub = new SystemAudioHub(() => new FakeCapture());
    const a = hub.createCapture();
    const b = hub.createCapture();
    const errors: string[] = [];
    a.onError((e) => errors.push(`a:${e.message}`));
    b.onError((e) => errors.push(`b:${e.message}`));
    await a.start(opts);
    await b.start(opts);
    FakeCapture.created[0].emitter.emit('error', new Error('died'));
    expect(errors).toEqual(['a:died', 'b:died']);
    expect(hub.activeStreams()).toBe(0);

    await a.start(opts);
    expect(FakeCapture.created).toHaveLength(2);
    await a.stop();
  });

  it('propagates start failures and does not keep a broken stream', async () => {
    const hub = new SystemAudioHub(() => new FakeCapture(true));
    await expect(hub.createCapture().start(opts)).rejects.toThrow('no device');
    expect(hub.activeStreams()).toBe(0);
  });
});

// Real PipeWire/PulseAudio: one parec feeding two consumers at once.
// Opt-in: NEO_LIVE_AUDIO=1 pnpm --filter neo-desktop test SystemAudioHub
const monitor = (() => {
  if (process.env.NEO_LIVE_AUDIO !== '1') return null;
  const r = spawnSync('pactl', ['get-default-sink'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? `${r.stdout.trim()}.monitor` : null;
})();

describe.skipIf(!monitor)('SystemAudioHub with real parec', () => {
  it('streams low-latency audio to recorder and transcriber simultaneously', async () => {
    vi.useRealTimers();
    const hub = new SystemAudioHub();
    const recorder = hub.createCapture();
    const stt = hub.createCapture();
    let recBytes = 0;
    let sttBytes = 0;
    let firstChunkAt = 0;
    const t0 = Date.now();
    recorder.onData((c) => {
      recBytes += c.length;
      if (!firstChunkAt) firstChunkAt = Date.now() - t0;
    });
    stt.onData((c) => (sttBytes += c.length));
    await recorder.start({ sourceId: monitor!, sampleRate: 16000 });
    await stt.start({ sourceId: monitor!, sampleRate: 16000 });
    await new Promise((r) => setTimeout(r, 1500));
    await recorder.stop();
    await stt.stop();
    expect(hub.activeStreams()).toBe(0);
    expect(firstChunkAt).toBeGreaterThan(0);
    expect(firstChunkAt).toBeLessThan(800);
    expect(recBytes).toBeGreaterThan(16000); // > 0.5 s of 16 kHz PCM16
    expect(sttBytes).toBeGreaterThan(16000);
  }, 10_000);
});
