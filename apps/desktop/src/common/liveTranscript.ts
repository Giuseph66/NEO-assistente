import type { STTFinalEvent, STTPartialEvent, STTStatus } from '@neo/shared';

/**
 * Routing of live transcription, shared by the renderer (display) and the main
 * process (persistence into the active session).
 *
 * - Microphone alone = dictation: finals go into the chat input.
 * - As soon as system audio is on, it is a "conversation": what you say (mic) and
 *   what the computer plays (system) are kept apart as labelled entries.
 *
 * Conversation mode is latched: it starts when system STT becomes active and ends
 * only when both pipelines are idle, so a clip flushed on stop still lands in the
 * transcript instead of leaking into the input.
 */

export type LiveSource = 'mic' | 'system';

export type LiveEntry = {
  id: string;
  source: LiveSource;
  text: string;
  /** When the utterance was spoken (ms epoch). */
  ts: number;
};

export type LiveTranscriptState = {
  mic: STTStatus;
  system: STTStatus;
  conversation: boolean;
  entries: LiveEntry[];
  partials: Record<LiveSource, string>;
};

export const ENTRY_LIMIT = 300;
const IDLE: STTStatus = { state: 'idle' };

export const initialLiveState = (): LiveTranscriptState => ({
  mic: IDLE,
  system: IDLE,
  conversation: false,
  entries: [],
  partials: { mic: '', system: '' },
});

export const isActiveStatus = (status: STTStatus): boolean =>
  status.state === 'running' || status.state === 'listening' || status.state === 'starting';

/** Still producing output (a stopping provider can flush one last clip). */
const isBusyStatus = (status: STTStatus): boolean =>
  isActiveStatus(status) || status.state === 'finalizing' || status.state === 'stopping';

/** Removes recognizer tokens and the "…" placeholder clip-based providers emit. */
export const cleanTranscriptText = (text: string | undefined): string => {
  const cleaned = (text || '')
    .replace(/<(unk|noise|silence)>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^[.,!?:;…]+$/.test(cleaned)) return '';
  return cleaned;
};

// ---- pure transitions (unit tested) ----

export function applyStatus(
  state: LiveTranscriptState,
  source: LiveSource,
  status: STTStatus
): LiveTranscriptState {
  const next: LiveTranscriptState = { ...state, [source]: status };
  if (source === 'system' && isActiveStatus(status)) {
    next.conversation = true;
  } else if (next.conversation && !isBusyStatus(next.mic) && !isBusyStatus(next.system)) {
    next.conversation = false;
  }
  if (!isBusyStatus(status)) {
    next.partials = { ...state.partials, [source]: '' };
  }
  return next;
}

export function applyPartial(
  state: LiveTranscriptState,
  source: LiveSource,
  event: STTPartialEvent
): LiveTranscriptState {
  const raw = (event.text || '').trim();
  // "…" = a clip is being transcribed: keep it, the UI shows it as "transcrevendo".
  const text = raw === '…' ? '…' : cleanTranscriptText(raw);
  if (text === state.partials[source]) return state;
  return { ...state, partials: { ...state.partials, [source]: text } };
}

export type FinalRouting = { state: LiveTranscriptState; dictation: string | null };

/** System finals always go to the transcript; mic finals only in conversation mode. */
export function applyFinal(
  state: LiveTranscriptState,
  source: LiveSource,
  event: STTFinalEvent,
  id: string
): FinalRouting {
  const text = cleanTranscriptText(event.text);
  const partials = { ...state.partials, [source]: '' };
  if (!text) return { state: { ...state, partials }, dictation: null };
  if (source === 'mic' && !state.conversation) {
    return { state: { ...state, partials }, dictation: text };
  }
  const entry: LiveEntry = { id, source, text, ts: event.ts || Date.now() };
  const entries = [...state.entries, entry];
  // Mic and system arrive independently; keep speaking order.
  entries.sort((a, b) => a.ts - b.ts);
  return {
    state: {
      ...state,
      partials,
      entries: entries.length > ENTRY_LIMIT ? entries.slice(entries.length - ENTRY_LIMIT) : entries,
    },
    dictation: null,
  };
}

export const formatEntryTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const SOURCE_LABEL: Record<LiveSource, string> = { mic: 'Você', system: 'Sistema' };

export const formatEntries = (entries: LiveEntry[]): string =>
  entries.map((entry) => `${SOURCE_LABEL[entry.source]}: ${entry.text}`).join('\n');
