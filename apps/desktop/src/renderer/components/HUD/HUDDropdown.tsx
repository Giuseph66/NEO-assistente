import React, { useState, useEffect } from 'react';
import './HUDDropdown.css';

interface Personality {
    id: number;
    name: string;
    promptText: string;
    category?: string;
    createdAt: number;
    updatedAt: number;
}

interface Session {
    id: number;
    createdAt: number;
    modelName: string;
    providerId: string;
    title?: string | null;
}

interface HUDDropdownProps {
    personalities: Personality[];
    sessions: Session[];
    activePersonalityId?: number | null;
    activeSessionId?: number | null;
    onPersonalitySelect: (personality: Personality) => void;
    onSessionSelect: (sessionId: number) => void;
    onCreateSession: () => void;
}

export const HUDDropdown: React.FC<HUDDropdownProps> = ({
    personalities: initialPersonalities,
    sessions: initialSessions,
    activePersonalityId: initialActivePersonalityId,
    activeSessionId: initialActiveSessionId,
    onPersonalitySelect,
    onSessionSelect,
    onCreateSession
}) => {
    const [activeTab, setActiveTab] = useState<'personalities' | 'sessions'>('personalities');
    const [personalities, setPersonalities] = useState<Personality[]>(initialPersonalities);
    const [sessions, setSessions] = useState<Session[]>(initialSessions);
    const [activePersonalityId, setActivePersonalityId] = useState<number | null | undefined>(initialActivePersonalityId);
    const [activeSessionId, setActiveSessionId] = useState<number | null | undefined>(initialActiveSessionId);

    const refreshData = async () => {
        try {
            const [templates, recentSessions] = await Promise.all([
                (globalThis as any).window.ai.getPromptTemplates('personality'),
                window.electron.ipcRenderer.invoke('session:list', { date: Date.now() })
            ]);
            setPersonalities(templates || []);
            setSessions(recentSessions || []);
        } catch (error) {
            console.error('Failed to refresh dropdown data:', error);
        }
    };

    useEffect(() => {
        refreshData();

        const handleData = (_event: any, data: any) => {
            if (data) {
                setPersonalities(data.personalities || []);
                setSessions(data.sessions || []);
                setActivePersonalityId(data.activePersonalityId);
                setActiveSessionId(data.activeSessionId);
            }
        };

        window.electron.ipcRenderer.on('hud-dropdown:data', handleData);
        // Escuta por atualizações globais (ex: quando criar nova personalidade em Settings)
        window.electron.ipcRenderer.on('hud-dropdown:refresh', refreshData);

        return () => {
            window.electron.ipcRenderer.removeListener('hud-dropdown:data', handleData);
            window.electron.ipcRenderer.removeListener('hud-dropdown:refresh', refreshData);
        };
    }, []);

    const handlePersonalityClick = async (personality: Personality) => {
        window.electron.ipcRenderer.send('hud:select-personality', { personalityId: personality.id });
        window.electron.ipcRenderer.send('hud-dropdown:hide');
    };

    const handleSessionClick = (sessionId: number) => {
        window.electron.ipcRenderer.send('session:activate', sessionId);
        window.electron.ipcRenderer.send('window:open-session');
        window.electron.ipcRenderer.send('hud-dropdown:hide');
    };

    const handleCreateSession = async () => {
        try {
            const config = await window.ai.getConfig();
            const result = await window.electron.ipcRenderer.invoke('session:create', {
                providerId: config.providerId,
                modelName: config.modelName
            });
            if (result && result.sessionId) {
                window.electron.ipcRenderer.send('session:activate', result.sessionId);
                window.electron.ipcRenderer.send('window:open-session');
            }
        } catch (error) {
            console.error('Failed to create session:', error);
        }
        window.electron.ipcRenderer.send('hud-dropdown:hide');
    };

    const formatTime = (timestamp: number) => {
        if (!timestamp) return '--:--';
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '--:--';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '--:--';
        }
    };

    const SparklesIcon = () => (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, marginRight: '6px' }}>
            <path d="m12 3 1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
        </svg>
    );

    const HistoryIcon = () => (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, marginRight: '6px' }}>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
        </svg>
    );

    return (
        <div className="hud-dropdown-container">
            {/* Tab Selector */}
            <div className="dropdown-tabs">
                <button 
                    className={`tab-btn ${activeTab === 'personalities' ? 'active' : ''}`}
                    onClick={() => setActiveTab('personalities')}
                >
                    <SparklesIcon />
                    Personalidades
                </button>
                <button 
                    className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('sessions')}
                >
                    <HistoryIcon />
                    Sessões
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'personalities' ? (
                    <div className="dropdown-list scrollable">
                        {personalities.length === 0 ? (
                            <div className="empty-item">Configure em Settings</div>
                        ) : (
                            personalities.map(personality => (
                                <div
                                    key={personality.id}
                                    className={`dropdown-item ${activePersonalityId === personality.id ? 'active' : ''}`}
                                    onClick={() => handlePersonalityClick(personality)}
                                >
                                    <div className="item-info">
                                        <span className="item-name">{personality.name}</span>
                                        <span className="item-preview">{personality.promptText.slice(0, 50)}...</span>
                                    </div>
                                    {activePersonalityId === personality.id && <span className="check">✓</span>}
                                </div>
                            ))
                        )}
                    </div>
                ) : (
                    <div className="dropdown-list scrollable">
                        {sessions.length === 0 ? (
                            <div className="empty-item">Nenhuma sessão hoje</div>
                        ) : (
                            sessions.map(session => (
                                <div
                                    key={session.id}
                                    className={`dropdown-item ${activeSessionId === session.id ? 'active' : ''}`}
                                    onClick={() => handleSessionClick(session.id)}
                                >
                                    <div className="item-info">
                                        <span className="item-name">{session.title || `Conversa #${session.id}`}</span>
                                        <span className="item-model">#{session.id}</span>
                                    </div>
                                    <span className="item-time">
                                        {formatTime(session.createdAt)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

