import { useState } from 'react';
import { averageScore, reportToMarkdown, type SessionReport } from '../../../common/sessionReport';
import './SessionReport.css';

type Props = {
  report: SessionReport;
  sessionTitle?: string | null;
  /** Compact = history side panel. */
  compact?: boolean;
};

const scoreTone = (value: number) => (value >= 7.5 ? 'good' : value >= 5 ? 'mid' : 'low');

function Section({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const List = ordered ? 'ol' : 'ul';
  return (
    <section className="report-section">
      <h3>{title}</h3>
      <List>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </List>
    </section>
  );
}

export function SessionReportView({ report, sessionTitle, compact }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const average = averageScore(report);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report, sessionTitle));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable
    }
  };

  const sources = [
    report.basedOn.transcriptLines ? `${report.basedOn.transcriptLines} falas transcritas` : null,
    report.basedOn.messages ? `${report.basedOn.messages} mensagens` : null,
    report.basedOn.hasNotes ? 'notas' : null,
  ].filter(Boolean);

  return (
    <article className={`session-report ${compact ? 'compact' : ''}`}>
      <header className="report-header">
        <div className="report-heading">
          <h2>{report.title || sessionTitle || 'Relatório da sessão'}</h2>
          <div className="report-meta">
            Gerado {new Date(report.generatedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {sources.length ? ` · a partir de ${sources.join(', ')}` : ''}
          </div>
        </div>
        <button type="button" className="report-copy" onClick={copy}>
          {copied ? 'Copiado' : 'Copiar relatório'}
        </button>
      </header>

      {report.overview && <p className="report-overview">{report.overview}</p>}

      {report.scores.length > 0 && (
        <section className="report-scores" aria-label="Pontuações">
          {average !== null && (
            <div className={`score-average tone-${scoreTone(average)}`}>
              <span className="score-average-value">{average.toFixed(1)}</span>
              <span className="score-average-label">média</span>
            </div>
          )}
          <div className="score-list">
            {report.scores.map((score) => (
              <div key={score.label} className="score-row" title={score.reason}>
                <div className="score-row-top">
                  <span className="score-label">{score.label}</span>
                  <span className="score-value">{score.value}/10</span>
                </div>
                <div className="score-bar">
                  <span className={`score-fill tone-${scoreTone(score.value)}`} style={{ width: `${score.value * 10}%` }} />
                </div>
                {score.reason && !compact && <div className="score-reason">{score.reason}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <Section title="Pontos principais" items={report.keyPoints} />
      <Section title="Decisões" items={report.decisions} />

      {report.actionItems.length > 0 && (
        <section className="report-section">
          <h3>Próximos passos</h3>
          <ul className="report-actions">
            {report.actionItems.map((item, i) => (
              <li key={i}>
                <span className="action-box" aria-hidden="true" />
                <span className="action-task">{item.task}</span>
                {(item.owner || item.due) && (
                  <span className="action-meta">
                    {item.owner}
                    {item.owner && item.due ? ' · ' : ''}
                    {item.due}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section title="Perguntas em aberto" items={report.openQuestions} />
    </article>
  );
}
