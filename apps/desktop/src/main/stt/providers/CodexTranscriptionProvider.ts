import { EventEmitter } from 'events';
import type { STTFinalEvent, STTPartialEvent, STTStatus } from '@neo/shared';
import { getLogger } from '@neo/logger';
import type {
  LiveTranscriptionError,
  LiveTranscriptionProvider,
  LiveTranscriptionProviderConfig,
} from './LiveTranscriptionProvider';
import { SpeechSegmenter, SpeechSegment } from '../audio/SpeechSegmenter';
import { encodeWavPcm16 } from '../audio/wav';
import {
  CodexTranscriptionClient,
  CodexTranscriptionError,
  toIsoLanguage,
} from '../codex/CodexTranscriptionClient';
import { getCodexCredentials } from '../../auth/codexCredentials';

const logger = getLogger();

/** Max wait for clips still in flight when the user stops. */
const STOP_DRAIN_TIMEOUT_MS = 20_000;
/** Shown while an utterance is being transcribed (the endpoint has no partial results). */
const PENDING_PARTIAL_TEXT = '…';
/**
 * Clips transcribed at the same time. Finals are still emitted in speaking order;
 * overlap only stops a slow request from delaying every clip behind it.
 */
const MAX_PARALLEL_REQUESTS = 2;

export type CodexProviderDeps = {
  client?: CodexTranscriptionClient;
};

/**
 * Live transcription through the ChatGPT/Codex transcription endpoint.
 *
 * The endpoint transcribes finished clips, not a stream, so audio is cut into
 * utterances at pauses (SpeechSegmenter) and each one is sent as a WAV clip.
 * Results arrive one utterance at a time as final events, in speaking order.
 */
export class CodexTranscriptionProvider implements LiveTranscriptionProvider {
  id = 'codex_transcribe' as const;
  private readonly emitter = new EventEmitter();
  private readonly client: CodexTranscriptionClient;
  private segmenter: SpeechSegmenter | null = null;
  private config: LiveTranscriptionProviderConfig | null = null;
  private queue: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private abort: AbortController | null = null;
  private failed = false;
  private running = 0;
  private waiting: Array<() => void> = [];
  /** Bumped on start(): slots held by clips of a previous run are not counted again. */
  private generation = 0;
  /** Requests run one at a time until one succeeds, so a bad login fails exactly once. */
  private verified = false;
  private fatalReported = false;

  constructor(deps: CodexProviderDeps = {}) {
    this.client = deps.client ?? new CodexTranscriptionClient({ getCredentials: getCodexCredentials });
  }

  async start(config: LiveTranscriptionProviderConfig): Promise<void> {
    if (this.segmenter) return;
    this.emitStatus({ state: 'starting', providerId: this.id });

    // Fail fast when there is no ChatGPT login instead of failing on the first clip.
    try {
      await this.client.checkCredentials();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login ChatGPT (Codex) não conectado';
      this.emitError({ message, code: 'not_connected', providerId: this.id });
      throw error;
    }

    this.config = config;
    this.failed = false;
    this.abort = new AbortController();
    this.queue = Promise.resolve();
    this.generation += 1;
    this.running = 0;
    // Clips of a previous run still waiting for a slot run with their (aborted) signal.
    const stale = this.waiting;
    this.waiting = [];
    stale.forEach((resume) => resume());
    this.verified = false;
    this.fatalReported = false;
    const configuredMaxMs = Math.min(Math.max(config.maxSegmentSeconds || 15, 5), 30) * 1000;
    const profile = config.segmentation ?? {};
    this.segmenter = new SpeechSegmenter({
      sampleRate: config.sampleRate,
      maxSegmentMs: profile.maxSegmentMs ? Math.min(profile.maxSegmentMs, configuredMaxMs) : configuredMaxMs,
      silenceMs: profile.silenceMs,
      minSpeechMs: profile.minSpeechMs,
    });
    this.emitStatus({ state: 'listening', providerId: this.id, modelId: 'codex' });
  }

  pushAudio(chunk: Buffer): void {
    if (!this.segmenter || this.failed) return;
    for (const segment of this.segmenter.push(chunk)) {
      this.enqueue(segment);
    }
  }

  async stop(): Promise<void> {
    if (!this.segmenter) return;
    this.emitStatus({ state: 'finalizing', providerId: this.id });
    const last = this.segmenter.flush();
    if (last) this.enqueue(last);
    this.segmenter = null;

    const drained = await Promise.race([
      this.queue.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STOP_DRAIN_TIMEOUT_MS)),
    ]);
    if (!drained) {
      logger.warn('Codex STT: stop timed out with clips still in flight; cancelling');
      this.abort?.abort();
    }
    this.abort = null;
    this.emitStatus({ state: 'idle' });
  }

  async dispose(): Promise<void> {
    this.abort?.abort();
    await this.stop();
  }

  onPartial(cb: (event: STTPartialEvent) => void): () => void {
    this.emitter.on('partial', cb);
    return () => this.emitter.off('partial', cb);
  }

  onFinal(cb: (event: STTFinalEvent) => void): () => void {
    this.emitter.on('final', cb);
    return () => this.emitter.off('final', cb);
  }

  onStatus(cb: (status: STTStatus) => void): () => void {
    this.emitter.on('status', cb);
    return () => this.emitter.off('status', cb);
  }

  onError(cb: (error: LiveTranscriptionError) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }

  onDebug(cb: (message: string) => void): () => void {
    this.emitter.on('debug', cb);
    return () => this.emitter.off('debug', cb);
  }

  /**
   * Requests start as soon as a slot is free (up to MAX_PARALLEL_REQUESTS); results
   * are chained so finals keep the speaking order.
   */
  private enqueue(segment: SpeechSegment): void {
    const config = this.config;
    if (!config) return;
    const signal = this.abort?.signal;
    this.inFlight += 1;
    this.emitPartial(PENDING_PARTIAL_TEXT);
    const startedAt = Date.now();
    // Wall-clock time the utterance began (the segment just closed, live): finals carry
    // speaking time, not response time, so mic and system transcripts interleave correctly.
    const spokenAt = startedAt - Math.round(segment.endMs - segment.startMs);
    const result: Promise<{ text: string } | { error: unknown }> = this.withSlot(async () => {
      if (this.failed) return '';
      try {
        return await this.client.transcribe({
          audio: encodeWavPcm16(segment.pcm, config.sampleRate),
          filename: 'utterance.wav',
          mimeType: 'audio/wav',
          language: toIsoLanguage(this.languageHint(config)),
          signal,
        });
      } catch (error) {
        // Flag it before the slot is handed to the next clip, so that clip is not sent.
        if (error instanceof CodexTranscriptionError && error.fatal) this.failed = true;
        throw error;
      }
    }).then(
      (text) => {
        this.markVerified();
        return { text };
      },
      (error: unknown) => ({ error })
    );
    this.queue = this.queue.then(async () => {
      try {
        const outcome = await result;
        if ('error' in outcome) {
          this.handleClipError(outcome.error);
          return;
        }
        if (this.failed) return;
        this.emitDebug(
          `codex:segment ${Math.round(segment.endMs - segment.startMs)}ms -> ${outcome.text.length} chars in ${Date.now() - startedAt}ms`
        );
        if (outcome.text) this.emitFinal(outcome.text, spokenAt);
      } finally {
        this.inFlight -= 1;
        if (this.inFlight === 0) this.emitPartial('');
      }
    });
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    if (this.running >= this.parallelLimit()) {
      // The finishing task hands its slot over directly (running stays the same).
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await task();
    } finally {
      if (generation === this.generation) {
        const next = this.waiting.shift();
        if (next) next();
        else this.running -= 1;
      }
    }
  }

  private parallelLimit(): number {
    return this.verified ? MAX_PARALLEL_REQUESTS : 1;
  }

  private markVerified(): void {
    if (this.verified) return;
    this.verified = true;
    while (this.running < MAX_PARALLEL_REQUESTS && this.waiting.length > 0) {
      this.running += 1;
      this.waiting.shift()!();
    }
  }

  private handleClipError(error: unknown): void {
    if (error instanceof CodexTranscriptionError) {
      if (error.code === 'aborted') return;
      if (error.fatal) {
        if (this.fatalReported) return;
        this.fatalReported = true;
        this.failed = true;
        this.emitError({ message: error.message, code: error.code, providerId: this.id });
        return;
      }
      // Transient (rate limit / network / too large): drop this clip, keep listening.
      logger.warn({ code: error.code, status: error.status }, 'Codex STT: clip failed');
      this.emitDebug(`codex:clip_failed code=${error.code}`);
      return;
    }
    logger.warn({ err: error }, 'Codex STT: unexpected clip error');
    this.emitDebug(`codex:clip_failed ${error instanceof Error ? error.message : String(error)}`);
  }

  /** The STT config has no language field; the Vosk model id carries one (`vosk-pt-br-...`). */
  private languageHint(config: LiveTranscriptionProviderConfig): string | undefined {
    const match = /(?:^|[-_])(pt|en|es|fr|de|it)(?:[-_]|$)/i.exec(config.modelId || '');
    return match?.[1];
  }

  private emitPartial(text: string): void {
    this.emitter.emit('partial', { text, ts: Date.now(), meta: { providerId: this.id } } satisfies STTPartialEvent);
  }

  private emitFinal(text: string, ts = Date.now()): void {
    this.emitter.emit('final', { text, ts, meta: { providerId: this.id } } satisfies STTFinalEvent);
  }

  private emitStatus(status: STTStatus): void {
    this.emitter.emit('status', status);
  }

  private emitError(error: LiveTranscriptionError): void {
    this.emitter.emit('error', error);
    this.emitStatus({ state: 'error', message: error.message, providerId: this.id });
  }

  private emitDebug(message: string): void {
    this.emitter.emit('debug', message);
  }
}
