import React, { useState, useEffect, useCallback } from 'react';
import './HistoryModal.css';
import { SessionReportView } from '../Session/SessionReportView';
import { formatSessionDuration } from '../../hooks/useSessionDetails';
import type { SessionReport } from '../../../common/sessionReport';

interface HistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Message {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    recognizedText?: string;
    createdAt: number;
}

interface TranscriptLine {
    id: number;
    source: 'mic' | 'system';
    text: string;
    spokenAt: number;
}

interface Session {
    id: number;
    createdAt: number;
    modelName: string;
    providerId: string;
    screenshotId?: number;
    summary?: string;
    title?: string | null;
    endedAt?: number | null;
    hasReport?: boolean;
    transcriptCount?: number;
    notes?: string;
    report?: SessionReport | null;
    transcript?: TranscriptLine[];
    messages?: Message[];
}

type HistoryTab = 'overview' | 'chat' | 'transcript' | 'notes';

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<HistoryTab>('overview');
    const [reportBusy, setReportBusy] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDetailsLoading, setIsDetailsLoading] = useState(false);

    const formatTime = (timestamp: number) => {
        if (!timestamp) return '--:--';
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '--:--';
            
            const now = new Date();
            const isToday = date.toDateString() === now.toDateString();
            
            if (isToday) {
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
                return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + 
                       date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
        } catch (e) {
            return '--:--';
        }
    };

    const isRecentSession = (createdAt: number) => {
        const oneDay = 24 * 60 * 60 * 1000;
        return (Date.now() - createdAt) < oneDay;
    };

    const loadSessions = useCallback(async (searchQuery?: string) => {
        if (!isOpen) return;
        setIsLoading(true);
        try {
            // All recent sessions (not only today's): reports must stay reachable.
            const result = await window.electron.ipcRenderer.invoke('session:list-recent', {
                limit: 200,
                search: searchQuery
            });
            setSessions(result || []);
            
            if (result && result.length > 0 && !selectedSession) {
                handleSessionSelect(result[0]);
            } else if (!result || result.length === 0) {
                setSelectedSession(null);
            }
        } catch (error) {
            console.error('Failed to load sessions:', error);
        } finally {
            setIsLoading(false);
        }
    }, [isOpen, selectedSession]);

    const handleSessionSelect = async (session: Session) => {
        setSelectedSession(session);
        setReportError(null);
        setIsDetailsLoading(true);
        try {
            const details = await window.electron.ipcRenderer.invoke('session:get', session.id);
            if (details) {
                setSelectedSession(details);
            }
        } catch (error) {
            console.error('Failed to load session details:', error);
        } finally {
            setIsDetailsLoading(false);
        }
    };

    const handleDeleteSession = async (e: React.MouseEvent, sessionId: number) => {
        e.stopPropagation();
        if (!confirm('Tem certeza que deseja apagar esta sessão?')) return;

        try {
            const result = await window.electron.ipcRenderer.invoke('session:delete', sessionId);
            if (result.success) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (selectedSession?.id === sessionId) {
                    setSelectedSession(null);
                }
            } else {
                alert('Erro ao apagar sessão: ' + result.error);
            }
        } catch (error) {
            console.error('Failed to delete session:', error);
            alert('Erro ao apagar sessão.');
        }
    };

    // Efeito para busca com debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isOpen) {
                loadSessions(searchTerm);
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [searchTerm, isOpen, loadSessions]);

    // Carregamento inicial ao abrir
    useEffect(() => {
        if (isOpen && !searchTerm) {
            loadSessions();
        }
    }, [isOpen]);

    // Keep the selected session fresh (report finished, notes saved, session ended).
    useEffect(() => {
        if (!isOpen) return;
        const bridge = window.electron?.ipcRenderer;
        const onUpdated = (_e: unknown, payload: { sessionId?: number }) => {
            if (!payload?.sessionId) return;
            if (selectedSession?.id === payload.sessionId) {
                window.electron.ipcRenderer.invoke('session:get', payload.sessionId).then((details: Session | null) => {
                    if (details) setSelectedSession(details);
                });
            }
        };
        bridge?.on('session:updated', onUpdated);
        return () => bridge?.removeListener('session:updated', onUpdated);
    }, [isOpen, selectedSession?.id]);

    if (!isOpen) return null;

    const generateReport = async (sessionId: number) => {
        setReportBusy(true);
        setReportError(null);
        try {
            const result = await window.electron.ipcRenderer.invoke('session:report-generate', sessionId);
            if (!result?.success) {
                setReportError(result?.error || 'Falha ao gerar o relatório');
                return;
            }
            const details = await window.electron.ipcRenderer.invoke('session:get', sessionId);
            if (details) setSelectedSession(details);
            setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, hasReport: true, title: details?.title ?? s.title } : s)));
        } finally {
            setReportBusy(false);
        }
    };

    const openInSessionPanel = (sessionId: number) => {
        window.electron.ipcRenderer.send('session:activate', sessionId);
        window.electron.ipcRenderer.send('window:open-session');
    };

    const sessionLabel = (session: Session) => session.title || `Sessão #${session.id}`;

    const renderMessageIcon = (role: string) => {
        if (role === 'user') {
            return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
        }
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>;
    };

    const renderContent = () => {
        if (!selectedSession) {
            return (
                <div className="history-tab-content">
                    <div className="empty-state">
                        <p>Selecione uma sessão para ver os detalhes.</p>
                    </div>
                </div>
            );
        }

        if (isDetailsLoading) {
            return (
                <div className="history-tab-content">
                    <div className="loading-state">
                        <p>Carregando detalhes da sessão...</p>
                    </div>
                </div>
            );
        }

        switch (activeTab) {
            case 'overview': {
                const duration = formatSessionDuration(selectedSession.createdAt, selectedSession.endedAt);
                const messageCount = selectedSession.messages?.filter((m) => m.role !== 'system').length || 0;
                return (
                    <div className="history-tab-content">
                        <div className="overview-stats">
                            <div className="stat-card">
                                <span className="stat-value">{selectedSession.endedAt ? 'Encerrada' : 'Em andamento'}</span>
                                <span className="stat-label">{duration ? `Duração ${duration}` : 'Status'}</span>
                            </div>
                            <div className="stat-card">
                                <span className="stat-value">{selectedSession.transcript?.length || 0}</span>
                                <span className="stat-label">Falas transcritas</span>
                            </div>
                            <div className="stat-card">
                                <span className="stat-value">{messageCount}</span>
                                <span className="stat-label">Mensagens</span>
                            </div>
                        </div>

                        <div className="history-report-actions">
                            <button className="history-action-btn" onClick={() => openInSessionPanel(selectedSession.id)}>
                                Abrir no painel
                            </button>
                            <button
                                className="history-action-btn primary"
                                onClick={() => generateReport(selectedSession.id)}
                                disabled={reportBusy}
                            >
                                {reportBusy ? 'Gerando relatório…' : selectedSession.report ? 'Atualizar relatório' : 'Gerar relatório'}
                            </button>
                        </div>
                        {reportError && <div className="history-report-error">{reportError}</div>}

                        {selectedSession.report ? (
                            <SessionReportView report={selectedSession.report} sessionTitle={selectedSession.title} compact />
                        ) : (
                            <div className="summary-card">
                                <h3>Resumo da Sessão</h3>
                                <p>
                                    {selectedSession.summary || 'Nenhum relatório ainda. Gere um para ver resumo, pontos principais, decisões, próximos passos e pontuações.'}
                                </p>
                            </div>
                        )}
                        <div style={{ marginTop: '16px', fontSize: '12px', color: '#64748b' }}>
                            ID da Sessão: #{selectedSession.id} · {selectedSession.modelName}<br />
                            Criada em: {new Date(selectedSession.createdAt).toLocaleString()}
                            {selectedSession.endedAt ? ` · Encerrada em: ${new Date(selectedSession.endedAt).toLocaleString()}` : ''}
                        </div>
                    </div>
                );
            }
            case 'transcript':
                return (
                    <div className="history-tab-content">
                        {selectedSession.transcript && selectedSession.transcript.length > 0 ? (
                            <div className="history-transcript">
                                {selectedSession.transcript.map((line) => (
                                    <div key={line.id} className={`history-transcript-line source-${line.source}`}>
                                        <span className="speaker">{line.source === 'mic' ? 'Você' : 'Sistema'}</span>
                                        <span className="time">{new Date(line.spokenAt).toLocaleTimeString('pt-BR')}</span>
                                        <span className="text">{line.text}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <p>Nenhuma transcrição de áudio nesta sessão.</p>
                            </div>
                        )}
                    </div>
                );
            case 'notes':
                return (
                    <div className="history-tab-content">
                        {selectedSession.notes?.trim() ? (
                            <div className="history-notes">{selectedSession.notes}</div>
                        ) : (
                            <div className="empty-state">
                                <p>Nenhuma nota nesta sessão.</p>
                            </div>
                        )}
                    </div>
                );
            case 'chat':
                return (
                    <div className="history-tab-content">
                        <div className="chat-history-list">
                            {selectedSession.messages && selectedSession.messages.length > 0 ? (
                                selectedSession.messages.map((msg) => (
                                    <div key={msg.id} className={`chat-message-card ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                                        <div className="message-header">
                                            <div className="user-info">
                                                {renderMessageIcon(msg.role)}
                                                <span className="user-name">{msg.role === 'user' ? 'VOCÊ' : 'ASSISTENTE'}</span>
                                            </div>
                                        </div>
                                        <div className="message-body">
                                            <p>{msg.content}</p>
                                        </div>
                                        <div className="message-footer">
                                            <span className="message-time">{new Date(msg.createdAt).toLocaleString()}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="empty-state">
                                    <p>Nenhuma mensagem nesta sessão.</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            default:
                return (
                    <div className="history-tab-content">
                        <div className="empty-state">
                            <p>Conteúdo de {activeTab} indisponível.</p>
                        </div>
                    </div>
                );
        }
    };

    return (
            <div className="modal-window history-modal" onClick={e => e.stopPropagation()}>
                <div className="history-header">
                    <div className="header-title">Histórico de Sessões</div>
                    <button className="close-btn" onClick={onClose}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                <div className="history-main-container">
                    {/* Sidebar - Session List */}
                    <div className="history-sidebar">
                        <div className="sidebar-search">
                            <div className="search-input-wrapper">
                                <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                                <input 
                                    type="text" 
                                    placeholder="Pesquisar sessões..." 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="session-list">
                            {isLoading ? (
                                <div className="loading-state">Carregando...</div>
                            ) : sessions.length > 0 ? (
                                sessions.map((session) => (
                                    <div 
                                        key={session.id} 
                                        className={`session-item ${selectedSession?.id === session.id ? 'active' : ''}`} 
                                        onClick={() => handleSessionSelect(session)}
                                    >
                                        <div className="session-item-header">
                                            <span className="provider-name session-title" title={sessionLabel(session)}>{sessionLabel(session)}</span>
                                            <div className="header-actions">
                                                {!session.endedAt && isRecentSession(session.createdAt) && (
                                                    <span className="status-badge">ABERTA</span>
                                                )}
                                                {session.hasReport && (
                                                    <span className="status-badge report">RELATÓRIO</span>
                                                )}
                                                <button 
                                                    className="delete-session-btn" 
                                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                                    title="Apagar sessão"
                                                >
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="session-item-footer">
                                            <span className="relative-time">{formatTime(session.createdAt)}</span>
                                            <span className="model-name">
                                                {session.transcriptCount ? `${session.transcriptCount} falas · ` : ''}{session.modelName}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="empty-state">
                                    {searchTerm ? 'Nenhuma sessão encontrada.' : 'Nenhuma sessão encontrada.'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="history-content">
                        <div className="content-tabs">
                            <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                                Visão Geral
                            </button>
                            <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                Chat
                            </button>
                            <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>
                                Transcrição
                            </button>
                            <button className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                Notas
                            </button>
                        </div>

                        <div className="history-scroll-area">
                            {renderContent()}
                        </div>
                    </div>
                </div>
            </div>
    );
};

