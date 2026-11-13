import { describe, expect, it, vi } from 'vitest';
import { CodexFileTranscriber, splitIntoClips, spreadWords } from './CodexFileTranscriber';
import { CodexTranscriptionClient } from '../codex/CodexTranscriptionClient';
import { encodeWavPcm16 } from '../audio/wav';
import { silence, tone } from '../../testing/fixtures';

describe('CodexFileTranscriber', () => {
  it('spreads words over the clip window proportionally to their length', () => {
    const words = spreadWords('a bbb', 1000, 2000);
    expect(words).toHaveLength(2);
    expect(words[0].start).toBe(1);
    expect(words[1].end).toBeCloseTo(2, 5);
    expect(words[1].end - words[1].start).toBeGreaterThan(words[0].end - words[0].start);
    expect(spreadWords('   ', 0, 1000)).toEqual([]);
  });

  it('transcribes each clip and returns timed subtitle segments', async () => {
    const texts = ['primeira frase falada', 'segunda frase'];
    const transcribe = vi.fn(async () => texts.shift()!);
    const client = { transcribe } as unknown as CodexTranscriptionClient;
    const transcriber = new CodexFileTranscriber(client);
    const progress: number[] = [];
    transcriber.onProgress((p) => progress.push(p.percent));

    // stereo 16-bit file: both channels carry the same signal
    const mono = Buffer.concat([silence(500), tone(1500), silence(1500), tone(1200), silence(500)]);
    const stereo = Buffer.alloc(mono.length * 2);
    for (let i = 0; i < mono.length / 2; i += 1) {
      const sample = mono.readInt16LE(i * 2);
      stereo.writeInt16LE(sample, i * 4);
      stereo.writeInt16LE(sample, i * 4 + 2);
    }
    const segments = await transcriber.transcribeWav(encodeWavPcm16(stereo, 16000, 2), 'pt-BR');

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect((transcribe.mock.calls[0] as any)[0].language).toBe('pt');
    expect(progress).toEqual([50, 100]);
    expect(segments.map((s) => s.text.replace(/\n/g, ' '))).toEqual(['primeira frase falada', 'segunda frase']);
    // second utterance starts after the 1.5 s pause
    expect(segments[1].startMs).toBeGreaterThan(3000);
    expect(segments[0].startMs).toBeLessThan(600);
  });

  it('caps clips at 30 s for long continuous speech', () => {
    const talk: Buffer[] = [];
    for (let i = 0; i < 120; i += 1) talk.push(tone(400), silence(150));
    const clips = splitIntoClips(Buffer.concat(talk), 16000);
    expect(clips.length).toBeGreaterThanOrEqual(3);
    expect(clips.every((c) => c.endMs - c.startMs <= 30_000)).toBe(true);
  });

  it('rejects non-16-bit audio', async () => {
    const wav = encodeWavPcm16(tone(100), 16000);
    wav.writeUInt16LE(8, 34);
    const transcriber = new CodexFileTranscriber({ transcribe: vi.fn() } as unknown as CodexTranscriptionClient);
    await expect(transcriber.transcribeWav(wav)).rejects.toThrow(/16-bit/);
  });
});
