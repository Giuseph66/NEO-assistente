import { describe, expect, it } from 'vitest';
import { decodeWav, downmixPcm16ToMono, encodeWavPcm16, pcm16DurationMs } from './wav';
import { tone } from '../../testing/fixtures';

describe('wav', () => {
  it('round-trips PCM16 mono through encode/decode', () => {
    const pcm = tone(100);
    const file = encodeWavPcm16(pcm, 16000);
    expect(file.length).toBe(44 + pcm.length);
    expect(file.toString('ascii', 0, 4)).toBe('RIFF');
    expect(file.readUInt32LE(24)).toBe(16000);
    const decoded = decodeWav(file);
    expect(decoded).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(decoded.pcm.equals(pcm)).toBe(true);
  });

  it('skips extra chunks before data (e.g. LIST)', () => {
    const pcm = tone(20);
    const base = encodeWavPcm16(pcm, 8000);
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')]);
    const file = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)]);
    expect(decodeWav(file).pcm.equals(pcm)).toBe(true);
  });

  it('rejects non-WAV input', () => {
    expect(() => decodeWav(Buffer.from('hello world, not a wav'))).toThrow(/WAV/);
  });

  it('downmixes stereo by averaging channels', () => {
    const stereo = Buffer.alloc(8);
    stereo.writeInt16LE(1000, 0);
    stereo.writeInt16LE(3000, 2);
    stereo.writeInt16LE(-2000, 4);
    stereo.writeInt16LE(0, 6);
    const mono = downmixPcm16ToMono(stereo, 2);
    expect(mono.readInt16LE(0)).toBe(2000);
    expect(mono.readInt16LE(2)).toBe(-1000);
    expect(pcm16DurationMs(32000, 16000)).toBe(1000);
  });
});
