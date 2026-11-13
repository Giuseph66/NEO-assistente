import React, { useState, useEffect } from 'react';
import { SessionSidebar } from '../Panels/SessionSidebar';
import { SessionSummary } from '../Panels/SessionSummary';
import { NotesPanel } from '../Panels/NotesPanel';
import { useSessionDetails } from '../../hooks/useSessionDetails';
import './SessionLayout.css';

export interface SessionLayoutProps {
    children?: React.ReactNode;
    activePanel?: string;
    onPanelChange?: (panel: string) => void;
    activeSessionId?: number | null;
}

export const SessionLayout: React.FC<SessionLayoutProps> = ({
    children,
    activePanel,
    onPanelChange,
    activeSessionId
}) => {
    const [activeView, setActiveView] = useState<'session' | 'notes' | 'summary'>('session');
    const [ending, setEnding] = useState(false);
    const { details, generating, endSession } = useSessionDetails(activeSessionId);
    const ended = !!details?.endedAt;

    // Show the conversation when the user opens a session (HUD, history). Sessions
    // created in the background (transcript, notes) keep the tab the user is on.
    useEffect(() => {
        const bridge = (window as any).electron?.ipcRenderer;
        if (!bridge) return;
        const onActivated = (_e: unknown, payload: { sessionId: number | null; reason?: string }) => {
            if (payload?.sessionId && payload.reason !== 'auto') setActiveView('session');
        };
        bridge.on('session:activated', onActivated);
        return () => bridge.removeListener('session:activated', onActivated);
    }, []);

    const handleEndSession = async () => {
        if (!activeSessionId || ending) return;
        setEnding(true);
        setActiveView('summary');
        try {
            await endSession();
        } finally {
            setEnding(false);
        }
    };

    const handleNewSession = () => {
        (window as any).electron?.ipcRenderer.send('session:activate', null);
        setActiveView('session');
    };

    const handleMinimize = () => {
        (window as any).electron.ipcRenderer.send('window:minimize');
    };

    const handleClose = () => {
        (window as any).electron.ipcRenderer.send('window:close');
    };

    return (
        <div className="session-layout">
            {/* Minimal Window Header */}
            <header className="window-header">
                {/* Left: View Switcher */}
                <div className="header-left">
                    <div className="view-switcher">
                        <button
                            className={`view-tab ${activeView === 'session' ? 'active' : ''}`}
                            onClick={() => setActiveView('session')}
                        >
                            Sessão
                        </button>
                        <button
                            className={`view-tab ${activeView === 'notes' ? 'active' : ''}`}
                            onClick={() => setActiveView('notes')}
                        >
                            Notas
                        </button>
                        <button
                            className={`view-tab ${activeView === 'summary' ? 'active' : ''}`}
                            onClick={() => setActiveView('summary')}
                        >
                            Resumo
                        </button>
                    </div>
                </div>

                {/* Center: Session Badge */}
                <div className="header-center">
                    {activeSessionId && (
                        <span className={`session-badge ${ended ? 'ended' : ''}`} title={details?.title || undefined}>
                            #{activeSessionId}{ended ? ' · encerrada' : ''}
                        </span>
                    )}
                    {activeSessionId && !ended && (
                        <button
                            type="button"
                            className="session-action end"
                            onClick={handleEndSession}
                            disabled={ending || generating}
                            title="Para a transcrição, encerra a sessão e gera o relatório"
                        >
                            {ending ? 'Encerrando…' : 'Encerrar'}
                        </button>
                    )}
                    {activeSessionId && ended && (
                        <button type="button" className="session-action" onClick={handleNewSession} title="Começar uma nova sessão">
                            Nova sessão
                        </button>
                    )}
                </div>

                {/* Right: Window Actions */}
                <div className="header-right">
                    <div className="window-actions">
                        <button className="icon-btn minimize-btn" onClick={handleMinimize} title="Minimizar">
                            ─
                        </button>
                        <button className="icon-btn close-btn" onClick={handleClose} title="Fechar">
                            ✕
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="main-content">
                {activeView === 'session' && (
                    <SessionSidebar
                        isOpen={true}
                        onClose={() => { }}
                        sessionId={activeSessionId}
                    />
                )}
                {activeView === 'notes' && (
                    <div className="summary-container-wrapper">
                        <NotesPanel sessionId={activeSessionId} />
                    </div>
                )}
                {activeView === 'summary' && (
                    <div className="summary-container-wrapper">
                        {activeSessionId ? (
                            <SessionSummary sessionId={activeSessionId} />
                        ) : (
                            <div className="empty-state">
                                Nenhuma sessão ativa. Converse, transcreva ou escreva notas para começar uma.
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};
