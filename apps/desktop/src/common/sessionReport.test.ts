import { describe, expect, it } from 'vitest';
import { REPORT_MAX_CHARS, buildReportPrompt, parseReport, reportToMarkdown, averageScore } from './sessionReport';

const meta = { basedOn: { messages: 1, transcriptLines: 2, hasNotes: true }, generatedAt: 1 };

describe('session report', () => {
  it('labels speakers, includes chat and notes, and stays under the size cap', () => {
    const long = Array.from({ length: 4000 }, (_, i) => ({ source: (i % 2 ? 'mic' : 'system') as 'mic' | 'system', text: `frase número ${i} com algum conteúdo`, spokenAt: i * 1000 }));
    const prompt = buildReportPrompt({
      sessionId: 3,
      title: 'Reunião',
      createdAt: 0,
      endedAt: 30 * 60_000,
      messages: [{ role: 'user', content: 'o que ele disse?', createdAt: 1 }, { role: 'system', content: 'persona', createdAt: 0 }],
      transcript: long,
      notes: 'ligar para o cliente',
    });
    expect(prompt).toContain('Sistema: frase número 0');
    expect(prompt).toContain('Você: frase número 3999'); // the end is kept
    expect(prompt).toContain('trecho do meio omitido');
    expect(prompt).toContain('Usuário: o que ele disse?');
    expect(prompt).not.toContain('persona');
    expect(prompt).toContain('ligar para o cliente');
    expect(prompt).toContain('~30 min');
    expect(prompt.length).toBeLessThan(REPORT_MAX_CHARS + 3000);
  });

  it('parses the JSON report tolerantly and renders markdown', () => {
    const r = parseReport(
      'Aqui está: {"titulo":"Plano","resumo":"Ok.","pontosPrincipais":["A", "", 3],"proximosPassos":["Enviar proposta",{"tarefa":"Revisar","responsavel":"Você","prazo":"null"}],"perguntasEmAberto":[],"pontuacoes":[{"criterio":"Clareza","nota":"7.5","motivo":"bom"},{"criterio":"","nota":3}]} fim',
      meta
    );
    expect(r.title).toBe('Plano');
    expect(r.keyPoints).toEqual(['A']);
    expect(r.actionItems).toEqual([
      { task: 'Enviar proposta', owner: null, due: null },
      { task: 'Revisar', owner: 'Você', due: null },
    ]);
    expect(r.scores).toEqual([{ label: 'Clareza', value: 7.5, reason: 'bom' }]);
    expect(averageScore(r)).toBe(7.5);
    const md = reportToMarkdown(r);
    expect(md).toContain('# Plano');
    expect(md).toContain('- Revisar — Você');
    expect(md).toContain('Clareza: 7.5/10 — bom');
  });

  it('keeps a non-JSON answer as the overview', () => {
    const r = parseReport('Resumo em texto livre.', meta);
    expect(r.overview).toBe('Resumo em texto livre.');
    expect(r.keyPoints).toEqual([]);
  });
});
