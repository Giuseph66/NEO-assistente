import React from 'react';
import { SessionReportView } from '../Session/SessionReportView';
import { formatSessionDuration, useSessionDetails } from '../../hooks/useSessionDetails';
import '../Session/SessionReport.css';

interface SessionSummaryProps {
    sessionId: number;
}

/**
 * "Resumo" tab: the session report. Ending the session generates it; it can be
 * regenerated at any time (e.g. after more notes or transcript).
 */
export const SessionSummary: React.FC<SessionSummaryProps> = ({ sessionId }) => {
    const { details, loading, generating, reportError, generateReport, endSession } = useSessionDetails(sessionId);

    if (loading && !details) {
        return <div className="summary-state">Carregando…</div>;
    }
    if (!details) {
        return <div className="summary-state">Sessão não encontrada.</div>;
    }

    const ended = !!details.endedAt;
    const duration = formatSessionDuration(details.createdAt, details.endedAt);
    const counts = {
        transcript: details.transcript.length,
        messages: details.messages.filter((m) => m.role !== 'system').length,
        notes: !!details.notes.trim(),
    };
    const empty = !counts.transcript && !counts.messages && !counts.notes;

    return (
        <div className="session-summary-view">
            <div className="summary-toolbar">
                <div className="summary-status">
                    <span className={`status-pill ${ended ? 'ended' : 'live'}`}>{ended ? 'Encerrada' : 'Em andamento'}</span>
                    <span className="summary-facts">
                        {new Date(details.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {duration ? ` · ${duration}` : ''}
                        {` · ${counts.transcript} falas · ${counts.messages} mensagens${counts.notes ? ' · notas' : ''}`}
                    </span>
                </div>
                <div className="summary-actions">
                    {!ended && (
                        <button
                            type="button"
                            className="summary-btn primary"
                            onClick={() => void endSession()}
                            disabled={generating || empty}
                            title="Para a transcrição, encerra a sessão e gera o relatório"
                        >
                            Encerrar e gerar relatório
                        </button>
                    )}
                    <button
                        type="button"
                        className={`summary-btn ${ended ? 'primary' : ''}`}
                        onClick={() => void generateReport()}
                        disabled={generating || empty}
                    >
                        {details.report ? 'Atualizar relatório' : 'Gerar relatório'}
                    </button>
                </div>
            </div>

            {generating && (
                <div className="summary-generating" role="status">
                    <span className="spinner" aria-hidden="true" />
                    Lendo a sessão e escrevendo o relatório… pode levar até um minuto.
                </div>
            )}
            {reportError && !generating && (
                <div className="summary-error" role="alert">
                    {reportError}
                    {details.report ? ' O relatório anterior foi mantido.' : ''}
                </div>
            )}

            {details.report ? (
                <SessionReportView report={details.report} sessionTitle={details.title} />
            ) : !generating ? (
                <div className="summary-empty">
                    <h3>Nenhum relatório ainda</h3>
                    <p>
                        {empty
                            ? 'Converse com a IA, transcreva áudio (segure o botão do microfone para escolher o áudio do sistema) ou escreva notas. Depois é só encerrar a sessão.'
                            : 'Ao encerrar a sessão, o NEO resume tudo: pontos principais, decisões, próximos passos e pontuações.'}
                    </p>
                </div>
            ) : null}
        </div>
    );
};
