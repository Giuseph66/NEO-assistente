/**
 * Energy-based voice activity segmentation for mono PCM16 audio.
 *
 * Used by request/response transcription backends (like the Codex `/transcribe`
 * endpoint) that take a finished audio clip instead of a live stream: the audio is
 * cut into utterances at pauses, and each utterance is sent as one clip.
 */

export type SpeechSegment = {
  pcm: Buffer;
  /** Position of the segment in the input stream. */
  startMs: number;
  endMs: number;
};

export type SpeechSegmenterOptions = {
  sampleRate: number;
  /** Analysis frame length. */
  frameMs?: number;
  /** Silence after speech that closes a segment. */
  silenceMs?: number;
  /** Segments with less voiced audio than this are dropped (clicks, breaths). */
  minSpeechMs?: number;
  /** A segment is cut at this length even without a pause. */
  maxSegmentMs?: number;
  /** Audio kept before the first voiced frame, so word onsets are not clipped. */
  prePaddingMs?: number;
  /** Lowest RMS (int16 scale) that counts as speech. */
  minThreshold?: number;
  /** Speech must exceed the tracked noise floor by this factor. */
  noiseFactor?: number;
  /** Window for the noise floor (minimum frame RMS seen in it). */
  noiseWindowMs?: number;
};

export class SpeechSegmenter {
  private readonly sampleRate: number;
  private readonly frameBytes: number;
  private readonly frameMs: number;
  private readonly silenceMs: number;
  private readonly minSpeechMs: number;
  private readonly maxSegmentMs: number;
  private readonly preFrames: number;
  private readonly minThreshold: number;
  private readonly noiseFactor: number;
  private readonly noiseWindowFrames: number;
  private readonly noiseWarmupFrames: number;

  private pending: Buffer = Buffer.alloc(0);
  private positionMs = 0;
  private readonly initialNoiseFloor: number;
  private rmsWindow: number[] = [];
  private preRoll: Buffer[] = [];

  private inSpeech = false;
  private segmentFrames: Buffer[] = [];
  private segmentStartMs = 0;
  private voicedMs = 0;
  private silenceRunMs = 0;

  constructor(options: SpeechSegmenterOptions) {
    this.sampleRate = options.sampleRate;
    this.frameMs = options.frameMs ?? 30;
    this.frameBytes = Math.max(2, Math.round((this.sampleRate * this.frameMs) / 1000) * 2);
    this.silenceMs = options.silenceMs ?? 700;
    this.minSpeechMs = options.minSpeechMs ?? 250;
    this.maxSegmentMs = options.maxSegmentMs ?? 15_000;
    this.preFrames = Math.ceil((options.prePaddingMs ?? 240) / this.frameMs);
    this.minThreshold = options.minThreshold ?? 350;
    this.noiseFactor = options.noiseFactor ?? 3;
    this.initialNoiseFloor = this.minThreshold / this.noiseFactor;
    this.noiseWindowFrames = Math.max(1, Math.round((options.noiseWindowMs ?? 3000) / this.frameMs));
    this.noiseWarmupFrames = Math.max(1, Math.round(this.noiseWindowFrames / 3));
  }

  /** Feeds audio; returns the segments that were completed by it. */
  push(chunk: Buffer): SpeechSegment[] {
    const completed: SpeechSegment[] = [];
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (this.pending.length >= this.frameBytes) {
      const frame = Buffer.from(this.pending.subarray(0, this.frameBytes));
      this.pending = this.pending.subarray(this.frameBytes);
      const segment = this.processFrame(frame);
      if (segment) completed.push(segment);
    }
    return completed;
  }

  /** Closes the open segment (end of stream). */
  flush(): SpeechSegment | null {
    if (this.pending.length >= 2 && this.inSpeech) {
      const tail = this.pending.subarray(0, this.pending.length - (this.pending.length % 2));
      this.segmentFrames.push(Buffer.from(tail));
      this.positionMs += (tail.length / 2 / this.sampleRate) * 1000;
    }
    this.pending = Buffer.alloc(0);
    return this.inSpeech ? this.closeSegment() : null;
  }

  private processFrame(frame: Buffer): SpeechSegment | null {
    const frameStartMs = this.positionMs;
    this.positionMs += this.frameMs;
    const rms = frameRms(frame);
    const threshold = Math.max(this.minThreshold, this.trackNoiseFloor(rms) * this.noiseFactor);
    const voiced = rms >= threshold;

    if (!this.inSpeech) {
      if (!voiced) {
        this.preRoll.push(frame);
        if (this.preRoll.length > this.preFrames) this.preRoll.shift();
        return null;
      }
      this.inSpeech = true;
      this.segmentStartMs = frameStartMs - this.preRoll.length * this.frameMs;
      this.segmentFrames = [...this.preRoll, frame];
      this.preRoll = [];
      this.voicedMs = this.frameMs;
      this.silenceRunMs = 0;
      return null;
    }

    this.segmentFrames.push(frame);
    if (voiced) {
      this.voicedMs += this.frameMs;
      this.silenceRunMs = 0;
    } else {
      this.silenceRunMs += this.frameMs;
    }

    // Close before the next frame would push the clip past maxSegmentMs.
    const lengthMs = this.positionMs - this.segmentStartMs;
    if (this.silenceRunMs >= this.silenceMs || lengthMs + this.frameMs > this.maxSegmentMs) {
      return this.closeSegment();
    }
    return null;
  }

  /**
   * Minimum-statistics noise floor: the quietest frame of the last few seconds.
   * Speech always has dips between words, so the minimum follows the background
   * level (fan, hum, room tone) whether or not someone is talking.
   */
  private trackNoiseFloor(rms: number): number {
    this.rmsWindow.push(rms);
    if (this.rmsWindow.length > this.noiseWindowFrames) this.rmsWindow.shift();
    if (this.rmsWindow.length < this.noiseWarmupFrames) return this.initialNoiseFloor;
    let min = Infinity;
    for (const value of this.rmsWindow) if (value < min) min = value;
    return min;
  }

  private closeSegment(): SpeechSegment | null {
    const frames = this.segmentFrames;
    const voicedMs = this.voicedMs;
    const startMs = Math.max(0, this.segmentStartMs);
    const endMs = this.positionMs;
    this.inSpeech = false;
    this.segmentFrames = [];
    this.voicedMs = 0;
    this.silenceRunMs = 0;
    if (voicedMs < this.minSpeechMs || frames.length === 0) {
      return null;
    }
    return { pcm: Buffer.concat(frames), startMs, endMs };
  }
}

export function frameRms(frame: Buffer): number {
  const samples = Math.floor(frame.length / 2);
  if (samples === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples; i += 1) {
    const sample = frame.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples);
}
