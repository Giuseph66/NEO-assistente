import React, { useState, useEffect, useRef } from 'react';
import { useSttMicAnalyser } from '../../store/sttMicStore';
import { ApiSection } from './SettingsSections/ApiSection';
import { AudioSection } from './SettingsSections/AudioSection';
import { NotificationsSection } from './SettingsSections/NotificationsSection';
import { FeaturesSection } from './SettingsSections/FeaturesSection';
import { ShortcutsSection } from './SettingsSections/ShortcutsSection';
import { AIPromptsSection } from './SettingsSections/AIPromptsSection';
import { DashboardSection } from './SettingsSections/DashboardSection';
import { StorageSection } from './SettingsSections/StorageSection';
import { HelpSection } from './SettingsSections/HelpSection';
import { AutomationSettings } from '../../pages/Settings/AutomationSettings';
import './SettingsModal.css';
import { getFeaturePermission } from '../../utils/featurePermissions';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsSection =
    | 'api'
    | 'audio'
    | 'notifications'
    | 'features'
    | 'shortcuts'
    | 'ai-prompts'
    | 'dashboard'
    | 'automation'
    | 'storage'
    | 'help';

const OPENAI_ANALYSIS_LABEL_TO_ID: Record<string, string> = {
    'GPT-5.2 Standard': 'gpt-5',
    'GPT-5.2 Mini': 'gpt-5-mini',
    'GPT-4.1 Standard': 'gpt-4.1',
    'GPT-4o': 'gpt-4o',
    'o1': 'o1',
};

const OPENAI_ANALYSIS_ID_TO_LABEL: Record<string, string> = {
    'gpt-5': 'GPT-5.2 Standard',
    'gpt-5-mini': 'GPT-5.2 Mini',
    'gpt-4.1': 'GPT-4.1 Standard',
    'gpt-4o': 'GPT-4o',
    'o1': 'o1',
};

const GEMINI_ANALYSIS_LABEL_TO_ID: Record<string, string> = {
    'Gemini 3 Pro': 'gemini-3-flash',
    'Gemini 3 Flash': 'gemini-3-flash',
    'Gemini 2.5 Pro': 'gemini-2.5-flash',
    'Gemini 2.5 Flash': 'gemini-2.5-flash',
    'Gemini 2.5 Flash-Lite': 'gemini-2.5-flash-lite',
};

function resolveAnalysisModelId(
    provider: 'google' | 'openai' | 'local' | 'vosk',
    labelOrId: string
): string {
    if (provider === 'openai') {
        return OPENAI_ANALYSIS_LABEL_TO_ID[labelOrId] || labelOrId || 'gpt-5';
    }
    if (provider === 'google') {
        return GEMINI_ANALYSIS_LABEL_TO_ID[labelOrId] || labelOrId || 'gemini-2.5-flash';
    }
    return labelOrId;
}

function resolveAnalysisModelLabel(
    providerId: string | undefined,
    modelId: string | undefined,
    fallback: string
): string {
    if (!modelId) return fallback;
    if (providerId === 'openai' || providerId === 'openai-codex') {
        return OPENAI_ANALYSIS_ID_TO_LABEL[modelId] || modelId;
    }
    return modelId;
}


export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [activeSection, setActiveSection] = useState<SettingsSection>('api');
    const [performance, setPerformance] = useState('personalizado');
    const [apiProvider, setApiProvider] = useState<'google' | 'openai' | 'local' | 'vosk'>('google');
    const [toast, setToast] = useState<string | null>(null);

    const [isSidebarMinimized, setIsSidebarMinimized] = useState(() => {
        return localStorage.getItem('ricky:settings-sidebar-minimized') === 'true';
    });

    // Model selection states
    const [analysisModel, setAnalysisModel] = useState(() => {
        return localStorage.getItem('ricky:analysis-model:google') || 'Gemini 3 Pro';
    });
    const [liveModel, setLiveModel] = useState(() => {
        return localStorage.getItem('ricky:live-model:google') || 'Gemini Live';
    });

    // API Key states
    const [geminiKey, setGeminiKey] = useState('');
    const [openaiKey, setOpenaiKey] = useState('');
    const [isKeyLoaded, setIsKeyLoaded] = useState(false);
    const [savedProvider, setSavedProvider] = useState<string | null>(null);

    // Audio states
    const [selectedMic, setSelectedMic] = useState('Microfone Padrão');
    const [selectedSystemAudio, setSelectedSystemAudio] = useState('__default__');
    const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>([]);
    const [systemAudioSources, setSystemAudioSources] = useState<{ id: string; name: string; isMonitor?: boolean; isDefaultCandidate?: boolean }[]>([]);
    const sttMicAnalyser = useSttMicAnalyser();
    const [localAnalyser, setLocalAnalyser] = useState<AnalyserNode | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const localContextRef = useRef<AudioContext | null>(null);
    const systemLevelRef = useRef(0);

    // Fetch keys and config on mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch keys
                const keys = await (globalThis as any).ai.listKeys();
                if (keys && Array.isArray(keys)) {
                    const gKey = keys.find((k: { providerId: string; last4: string }) => k.providerId === 'gemini');
                    const oKey = keys.find((k: { providerId: string; last4: string }) => k.providerId === 'openai');

                    if (gKey) setGeminiKey(`•••• •••• •••• ${gKey.last4}`);
                    if (oKey) setOpenaiKey(`•••• •••• •••• ${oKey.last4}`);
                }

                // Fetch active config
                const config = await (globalThis as any).ai.getConfig();
                if (config && config.providerId) {
                    setSavedProvider(config.providerId);
                    // Sincroniza a aba atual com o provedor salvo no primeiro carregamento
                    setApiProvider(
                        config.providerId === 'gemini'
                            ? 'google'
                            : (config.providerId === 'openai' || config.providerId === 'openai-codex')
                                ? 'openai'
                                : 'local'
                    );
                    const fallbackAnalysisLabel =
                        (config.providerId === 'openai' || config.providerId === 'openai-codex')
                            ? (localStorage.getItem('ricky:analysis-model:openai') || 'GPT-5.2 Standard')
                            : (localStorage.getItem('ricky:analysis-model:google') || 'Gemini 3 Pro');
                    const resolvedLabel = resolveAnalysisModelLabel(config.providerId, config.modelName, fallbackAnalysisLabel);
                    setAnalysisModel(resolvedLabel);
                }

                setIsKeyLoaded(true);

                // Fetch STT config
                try {
                    const sttConfig = await window.stt?.getConfig?.();
                    if (sttConfig?.provider) {
                        if (sttConfig.provider === 'openai_realtime_transcribe') {
                            setLiveModel(
                                localStorage.getItem('ricky:live-model:openai') ||
                                'OpenAI Realtime Transcription (gpt-4o-transcribe)'
                            );
                        } else if (sttConfig.provider === 'gemini_live') {
                            setLiveModel(
                                localStorage.getItem('ricky:live-model:google') || 'Gemini Live'
                            );
                        }
                    }

                    const isLocalSttEnabled = localStorage.getItem('ricky:use-local-stt') === 'true';
                    if (!isLocalSttEnabled && config?.providerId && window.stt?.updateConfig) {
                        const desiredProvider =
                            config.providerId === 'gemini'
                                ? 'gemini_live'
                                : (config.providerId === 'openai' || config.providerId === 'openai-codex')
                                    ? 'openai_realtime_transcribe'
                                    : null;
                        if (desiredProvider && desiredProvider !== sttConfig?.provider) {
                            await window.stt.updateConfig({ provider: desiredProvider });
                            localStorage.setItem('ricky:live-stt-provider', desiredProvider);
                        }
                    }
                } catch {
                    // ignore config load errors
                }

                // Fetch audio devices
                const devices = await navigator.mediaDevices.enumerateDevices();
                const mics = devices
                    .filter((d: MediaDeviceInfo) => d.kind === 'audioinput')
                    .map((d: MediaDeviceInfo) => ({
                        id: d.deviceId,
                        label: d.deviceId === 'default' ? 'Padrão' : (d.label || `Microfone ${d.deviceId.slice(0, 5)}`)
                    }))
                    .sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : 0)); // Ensure Padrão is first

                setMicDevices(mics);
                if (mics.length > 0) {
                    // Prefer 'Padrão' if available, otherwise first
                    const defaultMic = mics.find(m => m.id === 'default') || mics[0];
                    setSelectedMic(defaultMic.label);
                }

                // Fetch system audio sources
                const sources = await (globalThis as any).window.electron.ipcRenderer.invoke('systemAudio.listSources');
                if (sources && Array.isArray(sources)) {
                    setSystemAudioSources(sources);
                    setSelectedSystemAudio('__default__');
                }
            } catch (error) {
                console.error('Failed to fetch settings data:', error);
            }
        };
        fetchData();
    }, []);

    const handleSaveKey = async () => {
        const currentKey = apiProvider === 'google' ? geminiKey : openaiKey;
        const providerId = apiProvider === 'google' ? 'gemini' : 'openai';

        try {
            // Se a chave não começar com os pontos, salva a nova chave
            if (!currentKey.startsWith('••••')) {
                if (!currentKey.trim()) {
                    showToast('Por favor, insira uma chave de API válida.');
                    return;
                }
                await (globalThis as any).ai.addKey(providerId, currentKey, `Key ${apiProvider.toUpperCase()}`);

                // Atualiza o estado com a versão mascarada após salvar
                const last4 = currentKey.slice(-4);
                if (apiProvider === 'google') setGeminiKey(`•••• •••• •••• ${last4}`);
                else setOpenaiKey(`•••• •••• •••• ${last4}`);
            }

            // Salva a configuração como ativa
            const providerKey = apiProvider === 'google' ? 'google' : apiProvider === 'openai' ? 'openai' : apiProvider;
            const modelName = resolveAnalysisModelId(providerKey, analysisModel);
            await (globalThis as any).ai.saveConfig({ providerId, modelName });
            setSavedProvider(providerId);
            showToast(`Configurações de ${apiProvider.toUpperCase()} aplicadas e ativadas!`);

            const isLocalSttEnabled = localStorage.getItem('ricky:use-local-stt') === 'true';
            if (!isLocalSttEnabled && window.stt?.updateConfig) {
                const sttProvider =
                    providerId === 'gemini'
                        ? 'gemini_live'
                        : providerId === 'openai'
                            ? 'openai_realtime_transcribe'
                            : null;
                if (sttProvider) {
                    await window.stt.updateConfig({ provider: sttProvider });
                    localStorage.setItem('ricky:live-stt-provider', sttProvider);
                }
            }
        } catch (error) {
            showToast('Erro ao salvar as configurações.');
            console.error(error);
        }
    };

    useEffect(() => {
        if (apiProvider === 'google') {
            setAnalysisModel(
                localStorage.getItem('ricky:analysis-model:google') || 'Gemini 3 Pro'
            );
            setLiveModel(
                localStorage.getItem('ricky:live-model:google') || 'Gemini Live'
            );
        } else if (apiProvider === 'openai') {
            setAnalysisModel(
                localStorage.getItem('ricky:analysis-model:openai') || 'GPT-5.2 Standard'
            );
            setLiveModel(
                localStorage.getItem('ricky:live-model:openai') ||
                'OpenAI Realtime Transcription (gpt-4o-transcribe)'
            );
        }
    }, [apiProvider]);

    useEffect(() => {
        if (isOpen && activeSection === 'audio') {
            const startLocalMic = async () => {
                try {
                    // Respeita permissão interna do app
                    if (!getFeaturePermission('microphone')) {
                        setToast('Permissão do microfone está negada no app');
                        return;
                    }
                    const mic = micDevices.find((d: { label: string }) => d.label === selectedMic);
                    const constraints = mic ? { audio: { deviceId: { exact: mic.id } } } : { audio: true };
                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    const context = new AudioContext();
                    const source = context.createMediaStreamSource(stream);
                    const analyser = context.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);

                    localStreamRef.current = stream;
                    localContextRef.current = context;
                    setLocalAnalyser(analyser);
                } catch (err) {
                    console.error('Error capturing local mic:', err);
                }
            };

            startLocalMic();
        } else {
            // Cleanup Mic
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
                localStreamRef.current = null;
            }
            if (localContextRef.current) {
                localContextRef.current.close();
                localContextRef.current = null;
            }
            setLocalAnalyser(null);
        }
    }, [isOpen, activeSection, selectedMic, micDevices]);

    // System Audio Preview Effect
    useEffect(() => {
        if (!isOpen || activeSection !== 'audio' || !(globalThis as any).window.systemAudio) {
            return;
        }

        let isMounted = true;
        let offLevel: (() => void) | undefined;

        // Registrar listener primeiro para garantir que não perdemos eventos
        offLevel = (globalThis as any).window.systemAudio?.onLevel((payload: { level: number }) => {
            if (isMounted) {
                systemLevelRef.current = payload.level;
            }
        });

        const startPreview = async () => {
            try {
                if (!isMounted) return;

                const monitorSources = systemAudioSources.filter((s) => s.isMonitor);
                let source = monitorSources.find((s) => s.id === selectedSystemAudio);
                if (selectedSystemAudio === '__default__' || selectedSystemAudio === 'Padrão') {
                    source = monitorSources.find((s) => s.isDefaultCandidate) || monitorSources[0];
                }

                if (!source?.id) {
                    console.warn('No system monitor audio source selected');
                    return;
                }

                await (globalThis as any).window.systemAudio.startPreview(source.id);
            } catch (err) {
                console.error('Failed to start system audio preview:', err);
                systemLevelRef.current = 0;
            }
        };

        // Aguardar que as fontes estejam disponíveis antes de iniciar
        if (systemAudioSources.length > 0) {
            startPreview();
        }

        return () => {
            isMounted = false;
            if (offLevel) {
                offLevel();
            }
            (globalThis as any).window.systemAudio?.stopPreview().catch(() => {
                // Ignorar erros ao parar preview
            });
            systemLevelRef.current = 0;
        };
    }, [isOpen, activeSection, selectedSystemAudio, systemAudioSources]);

    const showToast = (message: string) => {
        setToast(message);
        setTimeout(() => setToast(null), 3000);
    };

    const toggleSidebar = () => {
        const newState = !isSidebarMinimized;
        setIsSidebarMinimized(newState);
        localStorage.setItem('ricky:settings-sidebar-minimized', String(newState));
    };

    if (!isOpen) return null;

    const renderContent = () => {
        switch (activeSection) {
            case 'api':
                return (
                    <ApiSection
                        apiProvider={apiProvider}
                        setApiProvider={setApiProvider}
                        savedProvider={savedProvider}
                        geminiKey={geminiKey}
                        openaiKey={openaiKey}
                        setGeminiKey={setGeminiKey}
                        setOpenaiKey={setOpenaiKey}
                        handleSaveKey={handleSaveKey}
                        setSavedProvider={setSavedProvider}
                        performance={performance}
                        setPerformance={setPerformance}
                        analysisModel={analysisModel}
                        setAnalysisModel={setAnalysisModel}
                        liveModel={liveModel}
                        setLiveModel={setLiveModel}
                        showToast={showToast}
                    />
                );
            case 'audio':
                return (
                    <AudioSection
                        selectedMic={selectedMic}
                        setSelectedMic={setSelectedMic}
                        selectedSystemAudio={selectedSystemAudio}
                        setSelectedSystemAudio={setSelectedSystemAudio}
                        micDevices={micDevices}
                        systemAudioSources={systemAudioSources}
                        localAnalyser={localAnalyser}
                        sttMicAnalyser={sttMicAnalyser}
                        systemLevelRef={systemLevelRef}
                        showToast={showToast}
                    />
                );
            case 'notifications':
                return <NotificationsSection showToast={showToast} />;
            case 'help':
                return <HelpSection />;
            case 'features':
                return (
                    <FeaturesSection
                        performance={performance}
                        setPerformance={setPerformance}
                        showToast={showToast}
                    />
                );
            case 'shortcuts':
                return <ShortcutsSection />;
            case 'ai-prompts':
                return <AIPromptsSection showToast={showToast} />;
            case 'dashboard':
                return <DashboardSection />;
            case 'storage':
                return <StorageSection showToast={showToast} />;
            case 'automation':
                return <AutomationSettings />;
        }
    };

    return (
        <div className="modal-window" onClick={e => e.stopPropagation()}>
            {/* Toast Notification */}
            {toast && (
                <div className="settings-toast">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    <span>{toast}</span>
                </div>
            )}

            {/* Header */}
            <div className="modal-header">
                <span className="header-title">Configurações</span>
                <button className="close-btn-red" onClick={onClose}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="modal-main">
                {/* Sidebar */}
                <div className={`modal-sidebar ${isSidebarMinimized ? 'sidebar-minimized' : ''}`}>
                    <nav className="sidebar-nav">
                        <button className={`sidebar-item ${activeSection === 'api' ? 'active' : ''}`} onClick={() => setActiveSection('api')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                            <span>API e Modelos</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'audio' ? 'active' : ''}`} onClick={() => setActiveSection('audio')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                            <span>Áudio e Tela</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'notifications' ? 'active' : ''}`} onClick={() => setActiveSection('notifications')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0" /></svg>
                            <span>Notificações</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'features' ? 'active' : ''}`} onClick={() => setActiveSection('features')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="2" y1="14" x2="6" y2="14" /><line x1="10" y1="8" x2="14" y2="8" /><line x1="18" y1="16" x2="22" y2="16" /></svg>
                            <span>Recursos</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'shortcuts' ? 'active' : ''}`} onClick={() => setActiveSection('shortcuts')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2" /><line x1="6" y1="8" x2="6" y2="8" /><line x1="10" y1="8" x2="10" y2="8" /><line x1="14" y1="8" x2="14" y2="8" /><line x1="18" y1="8" x2="18" y2="8" /><line x1="6" y1="12" x2="6" y2="12" /><line x1="10" y1="12" x2="10" y2="12" /><line x1="14" y1="12" x2="14" y2="12" /><line x1="18" y1="12" x2="18" y2="12" /><line x1="7" y1="16" x2="17" y2="16" /></svg>
                            <span>Atalhos</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'ai-prompts' ? 'active' : ''}`} onClick={() => setActiveSection('ai-prompts')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                            <span>Personalidades IA</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveSection('dashboard')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
                            <span>Dashboard</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'automation' ? 'active' : ''}`} onClick={() => setActiveSection('automation')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                            <span>Automação</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'storage' ? 'active' : ''}`} onClick={() => setActiveSection('storage')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                            <span>Armazenamento</span>
                        </button>
                        <button className={`sidebar-item ${activeSection === 'help' ? 'active' : ''}`} onClick={() => setActiveSection('help')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12" y2="17" /></svg>
                            <span>Ajuda</span>
                        </button>
                    </nav>

                    <div className="sidebar-footer">
                        <button className="sidebar-toggle-btn" onClick={toggleSidebar} title={isSidebarMinimized ? "Expandir" : "Minimizar"}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isSidebarMinimized ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
                                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="modal-content">
                    {renderContent()}
                </div>
            </div>

            {/* Footer */}
            <div className="modal-footer">
                <div className="modal-footer-buttons">
                    <button className="power-btn" onClick={() => (globalThis as any).window.electron.ipcRenderer.send('app:quit')}
                        title="Sair do App"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                            <line x1="12" y1="2" x2="12" y2="12" />
                        </svg>
                    </button>
                    <button
                        className="power-btn minimize-btn"
                        onClick={() => {
                            (globalThis as any).window.electron.ipcRenderer.send('window:enter-mini-mode');
                            onClose();
                        }}
                        title="Minimizar para Mini HUD"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="8" y1="12" x2="16" y2="12" />
                        </svg>
                    </button>
                </div>
                <button className="btn-save" onClick={onClose}>Salvar</button>
            </div>
        </div>
    );
};
