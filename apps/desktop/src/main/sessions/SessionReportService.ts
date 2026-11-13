import {
  REPORT_SYSTEM_PROMPT,
  buildReportPrompt,
  hasReportMaterial,
  parseReport,
  type ReportSource,
  type SessionReport,
} from '../../common/sessionReport';

export type ReportStatus =
  | { sessionId: number; state: 'generating' }
  | { sessionId: number; state: 'done'; report: SessionReport }
  | { sessionId: number; state: 'error'; error: string };

export type ReportServiceDeps = {
  loadSource(sessionId: number): ReportSource | null;
  complete(
    messages: Array<{ role: 'system' | 'user'; content: string }>
  ): Promise<{ text: string; modelName?: string | null }>;
  save(sessionId: number, report: SessionReport): void;
  onStatus?(status: ReportStatus): void;
  now?(): number;
};

export class EmptySessionError extends Error {
  constructor() {
    super('Nada para resumir ainda: converse, transcreva áudio ou escreva notas nesta sessão.');
    this.name = 'EmptySessionError';
  }
}

/**
 * Generates and stores session reports. One generation per session at a time:
 * asking again while one runs returns the same promise. A failure keeps the
 * previous report untouched.
 */
export class SessionReportService {
  private inflight = new Map<number, Promise<SessionReport>>();

  constructor(private readonly deps: ReportServiceDeps) {}

  isGenerating(sessionId: number): boolean {
    return this.inflight.has(sessionId);
  }

  generate(sessionId: number): Promise<SessionReport> {
    const running = this.inflight.get(sessionId);
    if (running) return running;
    const task = this.run(sessionId).finally(() => this.inflight.delete(sessionId));
    this.inflight.set(sessionId, task);
    return task;
  }

  private async run(sessionId: number): Promise<SessionReport> {
    const { deps } = this;
    deps.onStatus?.({ sessionId, state: 'generating' });
    try {
      const source = deps.loadSource(sessionId);
      if (!source) throw new Error(`Sessão #${sessionId} não encontrada`);
      if (!hasReportMaterial(source)) throw new EmptySessionError();

      const answer = await deps.complete([
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: buildReportPrompt(source) },
      ]);
      if (!answer.text.trim()) throw new Error('O modelo não devolveu texto para o relatório.');

      const report = parseReport(answer.text, {
        basedOn: {
          messages: source.messages.filter((m) => m.role !== 'system').length,
          transcriptLines: source.transcript.length,
          hasNotes: !!source.notes?.trim(),
        },
        generatedAt: (deps.now ?? Date.now)(),
        model: answer.modelName ?? null,
      });
      deps.save(sessionId, report);
      deps.onStatus?.({ sessionId, state: 'done', report });
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.onStatus?.({ sessionId, state: 'error', error: message });
      throw error;
    }
  }
}
