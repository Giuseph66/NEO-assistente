import { describe, expect, it } from 'vitest';
import type { STTStatus } from '@neo/shared';
import {
  ENTRY_LIMIT,
  applyFinal,
  applyPartial,
  applyStatus,
  cleanTranscriptText,
  formatEntries,
  initialLiveState,
  type LiveTranscriptState,
} from './liveTranscriptStore';

const listening: STTStatus = { state: 'listening', providerId: 'codex_transcribe' };
const finalizing: STTStatus = { state: 'finalizing', providerId: 'codex_transcribe' };
const idle: STTStatus = { state: 'idle' };
let n = 0;
const final = (s: LiveTranscriptState, source: 'mic' | 'system', text: string, ts = Date.now()) =>
  applyFinal(s, source, { text, ts }, `id${++n}`);

describe('live transcript routing', () => {
  it('mic alone is dictation: finals go to the input, not the transcript', () => {
    let s = applyStatus(initialLiveState(), 'mic', listening);
    expect(s.conversation).toBe(false);
    const r = final(s, 'mic', 'olá mundo');
    expect(r.dictation).toBe('olá mundo');
    expect(r.state.entries).toEqual([]);
  });

  it('system audio switches to conversation: mic and system kept apart, in speaking order', () => {
    let s = applyStatus(initialLiveState(), 'mic', listening);
    s = applyStatus(s, 'system', { state: 'starting' });
    expect(s.conversation).toBe(true);
    s = final(s, 'system', 'bem-vindo ao vídeo', 2000).state;
    const r = final(s, 'mic', 'testando os dois', 1000);
    expect(r.dictation).toBeNull();
    expect(r.state.entries.map((e) => [e.source, e.text])).toEqual([
      ['mic', 'testando os dois'],
      ['system', 'bem-vindo ao vídeo'],
    ]);
    expect(formatEntries(r.state.entries)).toBe('Você: testando os dois\nSistema: bem-vindo ao vídeo');
  });

  it('stays in conversation until both pipelines are idle (late flushed clip)', () => {
    let s = applyStatus(initialLiveState(), 'mic', listening);
    s = applyStatus(s, 'system', listening);
    s = applyStatus(s, 'system', idle); // system stopped first
    s = applyStatus(s, 'mic', finalizing); // mic is flushing its last clip
    expect(s.conversation).toBe(true);
    const r = final(s, 'mic', 'última frase');
    expect(r.dictation).toBeNull();
    expect(r.state.entries).toHaveLength(1);
    s = applyStatus(r.state, 'mic', idle);
    expect(s.conversation).toBe(false);
    // transcript is kept after stopping
    expect(s.entries).toHaveLength(1);
  });

  it('does not flip to dictation mid-session while the mic keeps running', () => {
    let s = applyStatus(initialLiveState(), 'system', listening);
    s = applyStatus(s, 'mic', listening);
    s = applyStatus(s, 'system', idle);
    // mic still busy → latched (no surprise switch mid-sentence)
    expect(s.conversation).toBe(true);
  });

  it('tracks partials per source and clears them when a source stops', () => {
    let s = applyStatus(initialLiveState(), 'system', listening);
    s = applyPartial(s, 'system', { text: '…', ts: 1 });
    expect(s.partials.system).toBe('…');
    s = applyPartial(s, 'mic', { text: 'oi <unk> tudo', ts: 1 });
    expect(s.partials.mic).toBe('oi tudo');
    s = applyStatus(s, 'system', idle);
    expect(s.partials.system).toBe('');
    expect(s.partials.mic).toBe('oi tudo');
  });

  it('drops empty/noise finals and caps the transcript', () => {
    let s = applyStatus(initialLiveState(), 'system', listening);
    expect(final(s, 'system', ' <noise> ').state.entries).toEqual([]);
    expect(cleanTranscriptText('…')).toBe('');
    for (let i = 0; i < ENTRY_LIMIT + 5; i += 1) s = final(s, 'system', `f${i}`, i + 1).state;
    expect(s.entries).toHaveLength(ENTRY_LIMIT);
    expect(s.entries[0].text).toBe('f5');
  });
});
