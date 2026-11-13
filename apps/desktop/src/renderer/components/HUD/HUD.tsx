import { describeChatError } from '../../../common/chat';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSttState } from '../../store/sttStore';
import { useSharedInputValue } from '../../store/sharedInputStore';
import './HUD.css';

interface HUDProps {
    onOpenSettings: () => void;
    onOpenHistory: () => void;
    onOpenSessionPanel: () => void;
    onStartListening: () => void;
    isListening: boolean;
    activeAssistant?: string;
    sessionId?: number | null;
    onSessionSelect?: (sessionId: number) => void;
    onTriggerTextHighlight?: () => void;
}

interface Session {
    id: number;
    createdAt: number;
    modelName: string;
    providerId: string;
    title?: string | null;
}

interface Personality {
    id: number;
    name: string;
    promptText: string;
    category?: string;
    createdAt: number;
    updatedAt: number;
}

export const HUD: React.FC<HUDProps> = ({
    onOpenSettings,
    onOpenHistory,
    onOpenSessionPanel,
    onStartListening,
    isListening,
    activeAssistant = 'My IA',
    sessionId,
    onSessionSelect,
    onTriggerTextHighlight
}) => {
    const [inputValue, setInputValue] = useSharedInputValue();
    const [hudPartial, setHudPartial] = useState('');
    const [showSessionDropdown, setShowSessionDropdown] = useState(false);
    const [showPersonalityDropdown, setShowPersonalityDropdown] = useState(false);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [personalities, setPersonalities] = useState<Personality[]>([]);
    const [activePersonality, setActivePersonality] = useState<Personality | null>(null);
    const [activeSessionId, setActiveSessionId] = useState<number | null>(sessionId ?? null);
    const [isSendingQuestion, setIsSendingQuestion] = useState(false);
    // Short failure notice shown in the input for a few seconds (the details are in the chat)
    const [hudNotice, setHudNotice] = useState<string | null>(null);
    const hudNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showHudNotice = (text: string) => {
        if (hudNoticeTimerRef.current) clearTimeout(hudNoticeTimerRef.current);
        setHudNotice(text);
        hudNoticeTimerRef.current = setTimeout(() => setHudNotice(null), 7000);
    };
    const [isTextHighlightLoading, setIsTextHighlightLoading] = useState(false);
    
    // Estado para feedback visual quando sobre a janela vintage
    const [isOverVintageWindow, setIsOverVintageWindow] = useState(false);
    const hudBarRef = useRef<HTMLDivElement>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const personalityDropdownRef = useRef<HTMLDivElement>(null);
    const sttState = useSttState();
    const isSttListening =
        sttState.status.state === 'running' ||
        sttState.status.state === 'listening' ||
        sttState.status.state === 'starting';
    const wasListeningRef = useRef(false);
    const prevListeningRef = useRef(false);
    const lastFinalTsRef = useRef<number | null>(null);
    const inputValueRef = useRef(inputValue);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowSessionDropdown(false);
            }
        };

        // Listener para quando o dropdown flutuante fechar
        const handleDropdownClosed = () => {
            setShowPersonalityDropdown(false);
        };

        // Listener para quando uma personalidade for selecionada
        const handlePersonalitySelected = (_event: any, { personalityId }: { personalityId: number }) => {
            const selected = personalities.find(p => p.id === personalityId);
            if (selected) {
                handlePersonalitySelect(selected);
            }
        };

        const handleSessionActivated = (_event: any, { sessionId: nextSessionId }: { sessionId: number }) => {
            setActiveSessionId(nextSessionId);
        };

        document.addEventListener('mousedown', handleClickOutside);
        window.electron.ipcRenderer.on('hud-dropdown:closed', handleDropdownClosed);
        window.electron.ipcRenderer.on('hud:personality-selected', handlePersonalitySelected);
        window.electron.ipcRenderer.on('session:activated', handleSessionActivated);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.electron.ipcRenderer.removeListener('hud-dropdown:closed', handleDropdownClosed);
            window.electron.ipcRenderer.removeListener('hud:personality-selected', handlePersonalitySelected);
            window.electron.ipcRenderer.removeListener('session:activated', handleSessionActivated);
        };
    }, [personalities]);

    useEffect(() => {
        // Listener para receber estado de colisão com a janela vintage (para feedback visual futuro)
        const handleVintageCollision = (_event: any, isColliding: boolean) => {
            setIsOverVintageWindow(isColliding);
        };

        window.electron.ipcRenderer.on('vintage:drop-zone-active', handleVintageCollision);

        return () => {
            window.electron.ipcRenderer.removeListener('vintage:drop-zone-active', handleVintageCollision);
        };
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            await fetchPersonalities();
            await fetchSessions();
        };
        fetchData();
    }, []);

    useEffect(() => {
        const offLoading = window.textHighlightAPI?.onLoading((payload) => {
            setIsTextHighlightLoading(Boolean(payload?.loading));
        });
        return () => {
            offLoading?.();
        };
    }, []);

    useEffect(() => {
        if (typeof sessionId === 'number') {
            setActiveSessionId(sessionId);
        }
    }, [sessionId]);

    useEffect(() => {
        inputValueRef.current = inputValue;
    }, [inputValue]);

    useEffect(() => {
        if (isSttListening) {
            wasListeningRef.current = true;
        }
    }, [isSttListening]);

    useEffect(() => {
        const partialText = sttState.partial?.text;
        if (isSttListening && partialText) {
            const cleaned = cleanSttText(partialText);
            setHudPartial(cleaned);
        } else {
            setHudPartial('');
        }
    }, [sttState.partial, isSttListening]);

    useEffect(() => {
        const latestFinal = sttState.finals[0];
        if (!latestFinal || latestFinal.ts === lastFinalTsRef.current) return;
        lastFinalTsRef.current = latestFinal.ts;
        if (wasListeningRef.current) {
            const cleaned = cleanSttText(latestFinal.text || '');
            if (cleaned) {
                const merged = mergeFinalText(inputValueRef.current, cleaned);
                setInputValue(merged);
            }
            setHudPartial('');
        }
    }, [sttState.finals]);

    useEffect(() => {
        const wasListening = prevListeningRef.current;
        const shouldAutoSend =
            wasListening && !isSttListening && sttState.status.state === 'idle' && wasListeningRef.current;
        if (shouldAutoSend) {
            const textToSend = inputValueRef.current.trim();
            if (textToSend) {
                handleHudQuestionSend();
            }
            wasListeningRef.current = false;
        }
        prevListeningRef.current = isSttListening;
    }, [isSttListening, sttState.status.state]);

    const fetchSessions = async () => {
        try {
            const result = await window.electron.ipcRenderer.invoke('session:list', { date: Date.now() });
            setSessions(result || []);
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        }
    };

    const toggleDropdown = () => {
        if (!showSessionDropdown) {
            fetchSessions();
        }
        setShowSessionDropdown(!showSessionDropdown);
    };

    const handleSessionClick = (id: number) => {
        window.electron.ipcRenderer.send('session:activate', id);
        window.electron.ipcRenderer.send('window:open-session');
        setShowSessionDropdown(false);
    };

    const createNewSession = async () => {
        try {
            // Get current config for provider/model
            const config = await window.ai.getConfig();
            const result = await window.electron.ipcRenderer.invoke('session:create', {
                providerId: config.providerId,
                modelName: config.modelName
            });
            if (result && result.sessionId) {
                window.electron.ipcRenderer.send('session:activate', result.sessionId);
                window.electron.ipcRenderer.send('window:open-session');
            }
            setShowSessionDropdown(false);
        } catch (error) {
            console.error('Failed to create session:', error);
        }
    };

    const fetchPersonalities = async () => {
        try {
            const templates = await (globalThis as any).window.ai.getPromptTemplates('personality');
            setPersonalities(templates);
            // Set first as active if none selected
            if (templates.length > 0 && !activePersonality) {
                setActivePersonality(templates[0]);
            }
        } catch (error) {
            console.error('Failed to fetch personalities:', error);
        }
    };

    const togglePersonalityDropdown = async (event: React.MouseEvent) => {
        if (showPersonalityDropdown) {
            window.electron.ipcRenderer.send('hud-dropdown:hide');
            setShowPersonalityDropdown(false);
            return;
        }

        // Busca dados se necessário
        if (personalities.length === 0) {
            await fetchPersonalities();
        }
        if (sessions.length === 0) {
            await fetchSessions();
        }

        // Obtém a posição do clique - usa múltiplas estratégias para garantir que funciona
        let x: number;
        let y: number;

        // Estratégia 1: Tentar usar getBoundingClientRect do elemento clicado
        if (event.currentTarget) {
            try {
                const rect = event.currentTarget.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    x = rect.left + rect.width / 2; // Centro do botão
                    y = rect.top; // Topo do botão
                } else {
                    throw new Error('Element has zero dimensions');
                }
            } catch (error) {
                // Se getBoundingClientRect falhar, usar posição do mouse
                x = event.clientX;
                y = event.clientY;
            }
        } 
        // Estratégia 2: Usar posição do mouse (clientX/clientY)
        else if (event.clientX !== undefined && event.clientY !== undefined) {
            x = event.clientX;
            y = event.clientY;
        }
        // Estratégia 3: Usar ref do elemento se disponível
        else if (personalityDropdownRef.current) {
            try {
                const rect = personalityDropdownRef.current.getBoundingClientRect();
                x = rect.left + rect.width / 2;
                y = rect.top;
            } catch (error) {
                // Se tudo falhar, usar posição padrão (centro da tela)
                console.warn('Could not determine dropdown position, using default');
                x = window.innerWidth / 2;
                y = 100;
            }
        }
        // Estratégia 4: Fallback para posição padrão
        else {
            console.warn('Could not determine dropdown position, using default');
            x = window.innerWidth / 2;
            y = 100;
        }

        // Prepara dados para enviar
        const dropdownData = {
            personalities,
            sessions,
            activePersonalityId: activePersonality?.id || null,
            activeSessionId: activeSessionId || null,
        };

        // Abre a janela flutuante
        await window.electron.ipcRenderer.invoke('hud-dropdown:show', { x, y, data: dropdownData });
        setShowPersonalityDropdown(true);

        // Listener para quando a janela fechar
        const handleClose = () => {
            setShowPersonalityDropdown(false);
        };
        window.electron.ipcRenderer.on('hud-dropdown:closed', handleClose);
    };

    const handlePersonalitySelect = (personality: Personality) => {
        setActivePersonality(personality);
        setShowPersonalityDropdown(false);
        // TODO: Implement actual personality context injection
        console.log('Selected personality:', personality.name, personality.promptText);
    };

    const getPersonalityInitials = (name: string) => {
        if (!name) return 'AI';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    };

    const cleanSttText = (text: string): string => {
        if (!text) return '';
        let cleaned = text.replace(/<UNK>/gi, '');
        cleaned = cleaned.replace(/<noise>/gi, '');
        cleaned = cleaned.replace(/<silence>/gi, '');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        if (/^[\.\,\!\?\:\;]+$/.test(cleaned)) {
            return '';
        }
        return cleaned;
    };

    const mergeFinalText = (currentText: string, nextText: string): string => {
        const base = currentText.trim();
        const next = nextText.trim();
        if (!base) return next;
        if (!next) return base;

        const baseLower = base.toLowerCase();
        const nextLower = next.toLowerCase();
        const maxOverlap = Math.min(40, Math.min(baseLower.length, nextLower.length));
        let overlap = 0;
        for (let i = maxOverlap; i > 0; i -= 1) {
            if (baseLower.endsWith(nextLower.slice(0, i))) {
                overlap = i;
                break;
            }
        }
        const suffix = next.slice(overlap).trimStart();
        if (!suffix) return base;
        return `${base}${base.endsWith(' ') ? '' : ' '}${suffix}`;
    };

    const handleHudQuestionSend = async () => {
        const prompt = inputValueRef.current.trim();
        if (!prompt || isSendingQuestion) return;
        setIsSendingQuestion(true);
        setInputValue('');
        inputValueRef.current = '';
        setHudPartial('');

        try {
            const config = await window.ai.getConfig();
            let targetSessionId = sessionId ?? activeSessionId ?? null;

            if (!targetSessionId) {
                const result = await window.electron.ipcRenderer.invoke('session:create', {
                    providerId: config.providerId,
                    modelName: config.modelName
                });
                targetSessionId = result?.sessionId || null;
            }

            if (targetSessionId) {
                window.electron.ipcRenderer.send('session:activate', targetSessionId);
                window.electron.ipcRenderer.send('window:open-session');
            }

            const result = await window.ai.analyzeText({
                prompt,
                sessionId: targetSessionId || undefined,
                context: activePersonality?.promptText || undefined
            });
            if (result && !result.success) {
                // The message is saved in the conversation and the chat shows the reason with a
                // retry button; the HUD only says that it failed (it used to ignore the result).
                showHudNotice(`Sem resposta: ${describeChatError(result.errorCode, result.error).title}`);
            }
        } catch (error) {
            console.error('Failed to send HUD question:', error);
            showHudNotice('Sem resposta: não foi possível enviar a mensagem.');
        } finally {
            setIsSendingQuestion(false);
        }
    };

    const handleHudInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleHudQuestionSend();
        }
    };

    const handleListeningToggle = async () => {
        if (isSttListening) {
            try {
                await window.stt.stop();
            } catch (error) {
                console.error('Falha ao parar STT:', error);
            }
            return;
        }
        onStartListening();
    };

    const hudDisplayValue =
        hudPartial && isSttListening
            ? inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + hudPartial
            : inputValue;

    // Sincroniza o texto completo (incluindo parciais do STT) com o main process para o atalho de colar
    // SEM debounce (para testar instantâneo)
    useEffect(() => {
        const fullText = hudPartial && isSttListening
            ? inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + hudPartial
            : inputValue;

        if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer) {
            (window as any).electron.ipcRenderer.send('stt-input:update', fullText);
        }
    }, [inputValue, hudPartial, isSttListening]);

    return (
        <div className="hud-container">
            <div 
                className="hud-bar" 
                ref={hudBarRef}
                onContextMenu={(e) => {
                    e.preventDefault();
                    window.electron.ipcRenderer.send('window:hud-right-click');
                }}
            >
                {/* Compact Selector - Personality + Session */}
                <div className="hud-section compact-selector" ref={personalityDropdownRef}>
                    <div
                        className="compact-trigger"
                        onClick={(e) => togglePersonalityDropdown(e)}
                        title={activePersonality?.name || 'Selecionar IA'}
                    >
                        <div className="personality-icon-indicator">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 8V4H8" />
                                <rect width="16" height="12" x="4" y="8" rx="2" />
                                <path d="M2 14h2" />
                                <path d="M20 14h2" />
                                <path d="M15 13v2" />
                                <path d="M9 13v2" />
                            </svg>
                        </div>
                        <span className="compact-name">
                            {getPersonalityInitials(activePersonality?.name || 'IA')}
                        </span>
                        {activeSessionId && <span className="session-badge-compact">#{activeSessionId}</span>}
                        <svg className="chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </div>
                </div>

                <div className="hud-divider" />

                {/* Quick Actions */}
                <div className="hud-section quick-actions">
                    <button onClick={onOpenSettings} title="Configurações" className="icon-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                        </svg>
                    </button>
                    <button onClick={onOpenHistory} title="Histórico" className="icon-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                    </button>
                    <button
                        onClick={onTriggerTextHighlight}
                        title="Marcar texto com OCR (Modo B)"
                        className={`icon-btn ${isTextHighlightLoading ? 'is-loading' : ''}`}
                        disabled={isTextHighlightLoading}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16" />
                          <path d="M4 12h16" />
                          <path d="M4 18h10" />
                          <path d="M6 4h0" />
                        </svg>
                        {isTextHighlightLoading ? <span className="icon-btn__spinner" aria-hidden="true" /> : null}
                    </button>
                    <button onClick={onOpenSessionPanel} title="Painel da Sessão" className="icon-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <polyline points="10 9 9 9 8 9" />
                        </svg>
                    </button>
                </div>

                {/* Input */}
                <div className="hud-section input-wrapper">
                    <input
                        type="text"
                        placeholder={hudNotice ?? 'Perguntar...'}
                        value={hudDisplayValue}
                        onChange={(e) => {
                            const newValue = e.target.value;
                            if (hudPartial) {
                                setHudPartial('');
                            }
                            setInputValue(newValue);
                        }}
                        onKeyDown={handleHudInputKeyDown}
                        className={`hud-input${hudNotice ? ' has-notice' : ''}`}
                        title={hudNotice ?? undefined}
                    />
                    {inputValue.trim().length > 0 && (
                        <>
                            <button
                                className="hud-clear-btn"
                                onClick={() => {
                                    setInputValue('');
                                    setHudPartial('');
                                }}
                                title="Limpar"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                            <button
                                className="hud-send-btn"
                                onClick={handleHudQuestionSend}
                                disabled={isSendingQuestion}
                                title="Enviar"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 2L11 13" />
                                    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                                </svg>
                            </button>
                        </>
                    )}
                </div>

                {/* CTA */}
                <button
                    className={`hud-cta ${isSttListening ? 'active' : ''}`}
                    onClick={handleListeningToggle}
                    title={isSttListening ? 'Parar de ouvir' : 'Começar a ouvir'}
                >
                    {isSttListening ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                    )}
                </button>

                <div className="hud-divider" />

                {/* Close App */}
                <div className="hud-section">
                    <button
                        onClick={() => (globalThis as any).window.electron.ipcRenderer.send('app:quit')}
                        title="Fechar Aplicativo"
                        className="icon-btn close-app-btn"
                        style={{ color: 'var(--status-error)' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
