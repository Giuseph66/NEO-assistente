import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import type { SubtitleSegment, TranscribeProgress } from '@neo/shared';
import { SpeechSegmenter, SpeechSegment } from '../audio/SpeechSegmenter';
import { decodeWav, downmixPcm16ToMono, encodeWavPcm16, pcm16DurationMs } from '../audio/wav';
import { CodexTranscriptionClient, toIsoLanguage } from '../codex/CodexTranscriptionClient';
import { segmentWords } from './SubtitleSegmenter';

type WordInfo = { word: string; start: number; end: number };

/** Clips sent to the endpoint: cut at pauses, never longer than this. */
const MAX_CLIP_MS = 30_000;

/**
 * Transcribes a recorded WAV with the ChatGPT/Codex endpoint and returns subtitle
 * segments. The endpoint returns plain text without timestamps, so the file is cut
 * into clips at pauses (each clip has a known start/end) and the words of each clip
 * are spread over its time window proportionally to their length.
 */
export class CodexFileTranscriber {
  private readonly emitter = new EventEmitter();

  constructor(private readonly client: CodexTranscriptionClient) {}

  onProgress(cb: (progress: TranscribeProgress) => void): () => void {
    this.emitter.on('progress', cb);
    return () => this.emitter.off('progress', cb);
  }

  async transcribeFile(wavPath: string, language?: string): Promise<SubtitleSegment[]> {
    return this.transcribeWav(await readFile(wavPath), language);
  }

  async transcribeWav(file: Buffer, language?: string): Promise<SubtitleSegment[]> {
    const wav = decodeWav(file);
    if (wav.bitsPerSample !== 16) {
      throw new Error('WAV precisa ser PCM 16-bit');
    }
    const pcm = downmixPcm16ToMono(wav.pcm, wav.channels);
    const totalMs = pcm16DurationMs(pcm.length, wav.sampleRate);
    const clips = splitIntoClips(pcm, wav.sampleRate);
    const isoLanguage = toIsoLanguage(language);

    const segments: SubtitleSegment[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const text = await this.client.transcribe({
        audio: encodeWavPcm16(clip.pcm, wav.sampleRate),
        filename: `clip-${index + 1}.wav`,
        mimeType: 'audio/wav',
        language: isoLanguage,
      });
      // Subtitles never span two clips: a clip boundary is a real pause.
      segments.push(...segmentWords(spreadWords(text, clip.startMs, clip.endMs)));
      this.emitter.emit('progress', {
        percent: Math.round(((index + 1) / clips.length) * 100),
        currentTimeMs: clip.endMs,
        textPartial: text,
      } satisfies TranscribeProgress);
    }

    if (clips.length === 0) {
      this.emitter.emit('progress', { percent: 100, currentTimeMs: totalMs } satisfies TranscribeProgress);
    }
    return segments;
  }
}

export function splitIntoClips(pcm: Buffer, sampleRate: number): SpeechSegment[] {
  const segmenter = new SpeechSegmenter({ sampleRate, silenceMs: 500, maxSegmentMs: MAX_CLIP_MS });
  const clips = segmenter.push(pcm);
  const last = segmenter.flush();
  if (last) clips.push(last);
  return clips;
}

/** Assigns each word a time span inside [startMs, endMs] proportional to its length. */
export function spreadWords(text: string, startMs: number, endMs: number): WordInfo[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const totalChars = tokens.reduce((sum, token) => sum + token.length + 1, 0);
  const spanMs = Math.max(endMs - startMs, tokens.length * 50);
  const words: WordInfo[] = [];
  let cursor = startMs;
  for (const token of tokens) {
    const duration = (spanMs * (token.length + 1)) / totalChars;
    words.push({ word: token, start: cursor / 1000, end: (cursor + duration) / 1000 });
    cursor += duration;
  }
  return words;
}
