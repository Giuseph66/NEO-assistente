import { useSyncExternalStore } from 'react';
import type { STTFinalEvent, STTStatus } from '@neo/shared';
import {
  applyFinal,
  applyPartial,
  applyStatus,
  initialLiveState,
  type LiveEntry,
  type LiveSource,
  type LiveTranscriptState,
} from '../../common/liveTranscript';

export * from '../../common/liveTranscript';

/** Module-level state: survives tab switches and remounts within a window. */

const IDLE: STTStatus = { state: 'idle' };

// ---- store ----

let state = initialLiveState();
let initialized = false;
let seq = 0;
const listeners = new Set<() => void>();
const dictationListeners = new Set<(text: string, event: STTFinalEvent) => void>();

const set = (next: LiveTranscriptState) => {
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener());
};

const handleFinal = (source: LiveSource, event: STTFinalEvent) => {
  seq += 1;
  const routed = applyFinal(state, source, event, `${source}-${event.ts}-${seq}`);
  set(routed.state);
  if (routed.dictation) {
    dictationListeners.forEach((listener) => listener(routed.dictation!, event));
  }
};

export const initLiveTranscriptStore = (): void => {
  if (initialized || typeof window === 'undefined') return;
  if (!window.stt || !window.systemStt) {
    setTimeout(initLiveTranscriptStore, 250);
    return;
  }
  initialized = true;

  window.stt.getStatus().then((status) => set(applyStatus(state, 'mic', status || IDLE)));
  window.systemStt.getStatus().then((status) => set(applyStatus(state, 'system', status || IDLE)));

  window.stt.onStatus((status) => set(applyStatus(state, 'mic', status)));
  window.stt.onPartial((event) => set(applyPartial(state, 'mic', event)));
  window.stt.onFinal((event) => handleFinal('mic', event));

  window.systemStt.onStatus((status) => set(applyStatus(state, 'system', status)));
  window.systemStt.onPartial((event) => set(applyPartial(state, 'system', event)));
  window.systemStt.onFinal((event) => handleFinal('system', event));
};

export const getLiveTranscriptState = (): LiveTranscriptState => {
  initLiveTranscriptStore();
  return state;
};

export const subscribeLiveTranscript = (listener: () => void): (() => void) => {
  initLiveTranscriptStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLiveTranscript = (): LiveTranscriptState =>
  useSyncExternalStore(subscribeLiveTranscript, getLiveTranscriptState, getLiveTranscriptState);

/** Mic finals while not in conversation mode: text meant for the chat input. */
export const onDictation = (listener: (text: string, event: STTFinalEvent) => void): (() => void) => {
  initLiveTranscriptStore();
  dictationListeners.add(listener);
  return () => dictationListeners.delete(listener);
};

export const clearLiveEntries = (): void => {
  set({ ...state, entries: [] });
};

export const removeLiveEntry = (id: string): void => {
  set({ ...state, entries: state.entries.filter((entry) => entry.id !== id) });
};

/** Shows the transcript stored for a session (on session switch or load). */
export const replaceLiveEntries = (entries: LiveEntry[]): void => {
  set({ ...state, entries: [...entries].sort((a, b) => a.ts - b.ts) });
};
