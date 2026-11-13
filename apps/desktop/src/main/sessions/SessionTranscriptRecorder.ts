import type { STTFinalEvent, STTStatus } from '@neo/shared';
import {
  applyFinal,
  applyStatus,
  cleanTranscriptText,
  initialLiveState,
  type LiveSource,
  type LiveTranscriptState,
} from '../../common/liveTranscript';

type SttLike = {
  onStatus(cb: (status: STTStatus) => void): () => void;
  onFinal(cb: (event: STTFinalEvent) => void): () => void;
};

export type TranscriptRecorderDeps = {
  mic: SttLike;
  system: SttLike;
  /** Session that receives the lines; must return an open session id (creating one if needed). */
  ensureOpenSession(): number;
  save(entry: { sessionId: number; source: LiveSource; text: string; spokenAt: number }): void;
  onSaved?(entry: { sessionId: number; source: LiveSource; text: string; spokenAt: number }): void;
  onError?(error: unknown): void;
};

/**
 * Stores the live transcript of the active session, with the same routing as the
 * panel: system audio always; the microphone only in conversation mode (with
 * system audio on). Mic-only dictation becomes chat messages, not transcript.
 */
export class SessionTranscriptRecorder {
  private state: LiveTranscriptState = initialLiveState();
  private offs: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly deps: TranscriptRecorderDeps) {}

  start(): void {
    if (this.offs.length) return;
    const { mic, system } = this.deps;
    this.offs.push(
      mic.onStatus((status) => this.status('mic', status)),
      system.onStatus((status) => this.status('system', status)),
      mic.onFinal((event) => this.final('mic', event)),
      system.onFinal((event) => this.final('system', event))
    );
  }

  stop(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  isConversation(): boolean {
    return this.state.conversation;
  }

  private status(source: LiveSource, status: STTStatus): void {
    this.state = applyStatus(this.state, source, status);
  }

  private final(source: LiveSource, event: STTFinalEvent): void {
    this.seq += 1;
    const routed = applyFinal(this.state, source, event, `${source}-${this.seq}`);
    // Main keeps no copy of the lines: the database is the record.
    this.state = { ...routed.state, entries: [] };
    const text = cleanTranscriptText(event.text);
    if (!text || routed.dictation !== null) return;
    try {
      const entry = { sessionId: this.deps.ensureOpenSession(), source, text, spokenAt: event.ts || Date.now() };
      this.deps.save(entry);
      this.deps.onSaved?.(entry);
    } catch (error) {
      this.deps.onError?.(error);
    }
  }
}
