/**
 * Mic + system audio at the same time, against the real audio stack
 * (parec on the default sink monitor, arecord on the default mic).
 * Transcription itself is faked: this checks capture, routing and lifecycle.
 *
 * Opens the real microphone, so it is opt-in:
 *   NEO_LIVE_AUDIO=1 pnpm --filter neo-desktop test liveCapture.live
 */
import { EventEmitter } from 'events';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';

type FakeProvider = EventEmitter & { bytes: number; tag: string; config?: any };
const providers: FakeProvider[] = [];

vi.mock('../storage/configStore', () => ({
  getConfigStore: () => ({
    getConfig: () => ({
      provider: 'codex_transcribe',
      modelId: 'vosk-pt-br-small-0.3',
      sampleRate: 16000,
      enablePartial: true,
      partialDebounceMs: 200,
      maxSegmentSeconds: 15,
    }),
    setConfig: (c: any) => c,
  }),
}));
vi.mock('./models/ModelManager', () => ({ ModelManager: class {} }));
vi.mock('../ai/ApiKeyPool', () => ({ ApiKeyPool: class {} }));
vi.mock('../ai/AIServiceManager', () => ({ getKeyStorage: () => null }));
vi.mock('../auth/openaiOAuth', () => ({ getOAuthController: () => null }));
vi.mock('../database', () => ({ DatabaseManager: class {} }));
vi.mock('./providers/LiveProviderRegistry', () => ({
  normalizeLiveProviderId: (id: string) => id,
  createLiveTranscriptionProvider: () => {
    const p = new EventEmitter() as FakeProvider;
    p.bytes = 0;
    p.tag = `p${providers.length}`;
    const on = (name: string) => (cb: any) => {
      p.on(name, cb);
      return () => p.off(name, cb);
    };
    Object.assign(p, {
      id: 'codex_transcribe',
      start: async (config: any) => {
        p.config = config;
        p.emit('status', { state: 'listening', providerId: 'codex_transcribe' });
      },
      pushAudio: (chunk: Buffer) => {
        p.bytes += chunk.length;
      },
      stop: async () => {
        p.emit('final', { text: `${p.tag}:${p.bytes}`, ts: Date.now() });
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

const has = (cmd: string) => spawnSync('which', [cmd]).status === 0;
const monitor = (() => {
  if (process.env.NEO_LIVE_AUDIO !== '1' || !has('parec') || !has('arecord')) return null;
  const r = spawnSync('pactl', ['get-default-sink'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? `${r.stdout.trim()}.monitor` : null;
})();

// Only children of this test process: other test files may run parec in parallel.
const countParec = () =>
  (spawnSync('pgrep', ['-c', '-P', String(process.pid), 'parec'], { encoding: 'utf8' }).stdout || '0').trim();

describe.skipIf(!monitor)('mic + system audio live capture (real devices)', () => {
  it('records and transcribes system audio while transcribing the mic, then releases everything', async () => {
    const { STTController } = await import('./STTController');
    const { SystemSttController } = await import('./SystemSttController');
    const { RecorderService } = await import('../audio/recording/RecorderService');
    const { getSystemAudioHub } = await import('../audio/system/SystemAudioHub');

    const saved: any[] = [];
    const db = { saveRecording: (r: any) => saved.push(r) } as any;
    const mic = new STTController({} as any, db);
    const system = new SystemSttController({} as any, db);
    const recorder = new RecorderService(db);
    const finals: string[] = [];
    mic.onFinal((e) => finals.push(`mic ${e.text}`));
    system.onFinal((e) => finals.push(`system ${e.text}`));
    const errors: string[] = [];
    mic.onError((e) => errors.push(`mic ${e.message}`));
    system.onError((e) => errors.push(`system ${e.message}`));

    const wavPath = '/tmp/neo-desktop-test/recordings/integration.wav';
    rmSync(wavPath, { force: true });

    await Promise.all([
      mic.start(),
      system.start({ sourceId: monitor! }),
      recorder.start({ sourceId: monitor!, name: 'integration' }),
    ]);
    expect(mic.getStatus().state).toBe('listening');
    expect(system.getStatus().state).toBe('listening');
    expect(recorder.getStatus().state).toBe('recording');
    // system STT and recorder share a single parec process
    expect(getSystemAudioHub().activeStreams()).toBe(1);
    expect(countParec()).toBe('1');

    await new Promise((r) => setTimeout(r, 2000));

    const [micProvider, systemProvider] = providers;
    expect(systemProvider.config.segmentation).toEqual({ silenceMs: 400, maxSegmentMs: 7000 });
    expect(micProvider.config.segmentation).toBeUndefined();
    // ~2 s of 16 kHz PCM16 each (≥ 1.2 s allowing for device start-up)
    expect(micProvider.bytes).toBeGreaterThan(38_000);
    expect(systemProvider.bytes).toBeGreaterThan(38_000);

    await Promise.all([mic.stop(), system.stop(), recorder.stop()]);
    expect(errors).toEqual([]);
    expect(mic.getStatus().state).toBe('idle');
    expect(system.getStatus().state).toBe('idle');
    expect(recorder.getStatus().state).toBe('idle');
    expect(finals.some((f) => f.startsWith('mic p0:'))).toBe(true);
    expect(finals.some((f) => f.startsWith('system p1:'))).toBe(true);

    // WAV was finalized with a correct header and the same audio the transcriber got
    expect(existsSync(wavPath)).toBe(true);
    const wav = readFileSync(wavPath);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(saved).toHaveLength(1);
    expect(Math.abs(saved[0].bytes - systemProvider.bytes)).toBeLessThan(16_000);

    rmSync(wavPath, { force: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(getSystemAudioHub().activeStreams()).toBe(0);
    expect(countParec()).toBe('0');
  }, 20_000);
});
