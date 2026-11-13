import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { SessionTranscriptRecorder } from './SessionTranscriptRecorder';
import { EmptySessionError, SessionReportService } from './SessionReportService';
import type { ReportSource } from '../../common/sessionReport';

const fakeStt = () => {
  const e = new EventEmitter();
  return {
    e,
    onStatus: (cb: any) => (e.on('status', cb), () => e.off('status', cb)),
    onFinal: (cb: any) => (e.on('final', cb), () => e.off('final', cb)),
  };
};

describe('SessionTranscriptRecorder', () => {
  it('stores system lines and mic lines only in conversation mode, including the clip flushed on stop', () => {
    const mic = fakeStt();
    const system = fakeStt();
    const saved: Array<[number, string, string]> = [];
    let sessions = 0;
    let open: number | null = null;
    const rec = new SessionTranscriptRecorder({
      mic,
      system,
      ensureOpenSession: () => (open ??= ++sessions),
      save: (e) => saved.push([e.sessionId, e.source, e.text]),
    });
    rec.start();

    mic.e.emit('status', { state: 'listening' });
    mic.e.emit('final', { text: 'ditado para o chat', ts: 1 });
    expect(saved).toEqual([]); // dictation is not transcript
    expect(sessions).toBe(0); // and creates no session

    system.e.emit('status', { state: 'listening' });
    system.e.emit('final', { text: 'fala do vídeo', ts: 2 });
    mic.e.emit('final', { text: 'minha fala', ts: 3 });
    system.e.emit('status', { state: 'idle' });
    mic.e.emit('status', { state: 'finalizing' });
    mic.e.emit('final', { text: 'último trecho', ts: 4 });
    mic.e.emit('status', { state: 'idle' });
    mic.e.emit('status', { state: 'listening' });
    mic.e.emit('final', { text: 'ditado de novo', ts: 5 });

    expect(saved).toEqual([
      [1, 'system', 'fala do vídeo'],
      [1, 'mic', 'minha fala'],
      [1, 'mic', 'último trecho'],
    ]);
    rec.stop();
    system.e.emit('final', { text: 'depois de parar', ts: 6 });
    expect(saved).toHaveLength(3);
  });
});

const source = (over: Partial<ReportSource> = {}): ReportSource => ({
  sessionId: 7,
  createdAt: 0,
  messages: [],
  transcript: [{ source: 'system', text: 'Vamos lançar na sexta.', spokenAt: 1000 }],
  notes: '',
  ...over,
});

describe('SessionReportService', () => {
  it('generates once per session at a time, saves and reports status', async () => {
    let release!: () => void;
    const complete = vi.fn(
      () =>
        new Promise<{ text: string }>((r) => {
          release = () =>
            r({ text: '```json\n{"titulo":"Lançamento","resumo":"Decidiram lançar.","decisoes":["Lançar sexta"],"pontuacoes":[{"criterio":"Foco","nota":12,"motivo":"x"}]}\n```' });
        })
    );
    const saved: any[] = [];
    const statuses: string[] = [];
    const service = new SessionReportService({
      loadSource: () => source(),
      complete,
      save: (_id, r) => saved.push(r),
      onStatus: (s) => statuses.push(s.state),
      now: () => 42,
    });
    const a = service.generate(7);
    const b = service.generate(7);
    expect(a).toBe(b);
    expect(service.isGenerating(7)).toBe(true);
    await Promise.resolve();
    release();
    const report = await a;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ title: 'Lançamento', decisions: ['Lançar sexta'], generatedAt: 42 });
    expect(report.scores[0].value).toBe(10); // clamped
    expect(report.basedOn).toEqual({ messages: 0, transcriptLines: 1, hasNotes: false });
    expect(saved).toHaveLength(1);
    expect(statuses).toEqual(['generating', 'done']);
    expect(service.isGenerating(7)).toBe(false);
  });

  it('refuses an empty session and keeps the previous report on failure', async () => {
    const save = vi.fn();
    const statuses: string[] = [];
    const empty = new SessionReportService({
      loadSource: () => source({ transcript: [] }),
      complete: vi.fn(),
      save,
      onStatus: (s) => statuses.push(s.state),
    });
    await expect(empty.generate(7)).rejects.toBeInstanceOf(EmptySessionError);

    const failing = new SessionReportService({
      loadSource: () => source(),
      complete: async () => {
        throw new Error('limite de uso');
      },
      save,
    });
    await expect(failing.generate(7)).rejects.toThrow('limite de uso');
    expect(save).not.toHaveBeenCalled();
    expect(statuses).toEqual(['generating', 'error']);
  });
});
