import { describe, expect, it } from 'vitest';
import { SpeechSegmenter } from './SpeechSegmenter';
import { silence, tone } from '../../testing/fixtures';

const SR = 16000;

function run(segmenter: SpeechSegmenter, chunks: Buffer[]) {
  const out = chunks.flatMap((chunk) => segmenter.push(chunk));
  const last = segmenter.flush();
  if (last) out.push(last);
  return out;
}

describe('SpeechSegmenter', () => {
  it('cuts utterances at pauses and reports their position', () => {
    const segmenter = new SpeechSegmenter({ sampleRate: SR, silenceMs: 600 });
    const segments = run(segmenter, [silence(500), tone(1000), silence(900), tone(800), silence(900)]);
    expect(segments).toHaveLength(2);
    // starts include the pre-roll padding (~240 ms) before the first voiced frame
    expect(segments[0].startMs).toBeGreaterThanOrEqual(200);
    expect(segments[0].startMs).toBeLessThanOrEqual(500);
    expect(segments[1].startMs).toBeGreaterThan(segments[0].endMs - 1);
    expect(segments[1].startMs).toBeLessThan(2500);
    for (const segment of segments) {
      expect(segment.pcm.length).toBe(((segment.endMs - segment.startMs) / 1000) * SR * 2);
    }
  });

  it('works with arbitrary chunk sizes', () => {
    const audio = Buffer.concat([silence(300), tone(700), silence(1000)]);
    const chunks: Buffer[] = [];
    for (let i = 0; i < audio.length; i += 1234) chunks.push(audio.subarray(i, i + 1234));
    const segments = run(new SpeechSegmenter({ sampleRate: SR }), chunks);
    expect(segments).toHaveLength(1);
  });

  it('drops blips shorter than minSpeechMs', () => {
    const segments = run(new SpeechSegmenter({ sampleRate: SR, minSpeechMs: 250 }), [
      silence(500),
      tone(90),
      silence(1000),
    ]);
    expect(segments).toHaveLength(0);
  });

  it('splits continuous speech (no pause long enough) at maxSegmentMs', () => {
    // syllable-like bursts with short dips, never a 700 ms pause
    const talk: Buffer[] = [];
    for (let i = 0; i < 22; i += 1) talk.push(tone(400), silence(150));
    const segments = run(new SpeechSegmenter({ sampleRate: SR, maxSegmentMs: 5000 }), talk);
    expect(segments.length).toBe(3);
    expect(segments.every((s) => s.endMs - s.startMs <= 5000)).toBe(true);
    const covered = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
    expect(covered).toBeGreaterThan(11_000);
  });

  it('closes the open utterance on flush', () => {
    const segmenter = new SpeechSegmenter({ sampleRate: SR });
    expect(segmenter.push(tone(800))).toHaveLength(0);
    const last = segmenter.flush();
    expect(last).not.toBeNull();
    expect(last!.endMs).toBeGreaterThanOrEqual(780);
  });

  it('adapts to steady background noise', () => {
    // constant noise well above the minimum threshold must not be treated as endless speech
    const noise = tone(3000, SR, 600, 3000);
    const speech = tone(800, SR, 9000);
    const segments = run(new SpeechSegmenter({ sampleRate: SR, minThreshold: 300 }), [
      noise,
      Buffer.concat([speech]),
      tone(1500, SR, 600, 3000),
    ]);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const longest = Math.max(...segments.map((s) => s.endMs - s.startMs));
    expect(longest).toBeLessThan(3000);
  });
});
