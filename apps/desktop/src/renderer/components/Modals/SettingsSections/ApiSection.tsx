import React from 'react';
import { CustomSelect } from './CustomSelect';
import { VoskOfflineSection } from './VoskOfflineSection';
import { GeminiIcon, OpenAIIcon, OllamaIcon } from '../../Icons';
import { OpenAIAuth } from '../../Auth/OpenAIAuth';

interface ApiSectionProps {
    apiProvider: 'google' | 'openai' | 'local' | 'vosk';
    setApiProvider: (provider: 'google' | 'openai' | 'local' | 'vosk') => void;
    savedProvider: string | null;
    geminiKey: string;
    openaiKey: string;
    setGeminiKey: (key: string) => void;
    setOpenaiKey: (key: string) => void;
    handleSaveKey: () => void;
    setSavedProvider: (provider: string) => void;
    performance: string;
    setPerformance: (value: string) => void;
    analysisModel: string;
    setAnalysisModel: (model: string) => void;
    liveModel: string;
    setLiveModel: (model: string) => void;
    showToast: (message: string) => void;
}

export const ApiSection: React.FC<ApiSectionProps> = ({
    apiProvider,
    setApiProvider,
    savedProvider,
    geminiKey,
    openaiKey,
    setGeminiKey,
    setOpenaiKey,
    handleSaveKey,
    setSavedProvider,
    performance,
    setPerformance,
    analysisModel,
    setAnalysisModel,
    liveModel,
    setLiveModel,
    showToast
}) => {
    const isOpenAIProviderSaved = savedProvider === 'openai' || savedProvider === 'openai-codex';

    const resolveOpenAIProviderIdForSave = (): 'openai' | 'openai-codex' => {
        return savedProvider === 'openai-codex' ? 'openai-codex' : 'openai';
    };

    const mapAnalysisLabelToModelId = (
        provider: 'google' | 'openai' | 'local' | 'vosk',
        value: string
    ): string => {
        if (provider === 'openai') {
            const map: Record<string, string> = {
                'GPT-5.4': 'GPT-5.4',
                'GPT-5.4-Mini': 'GPT-5.4-Mini',
                'GPT-5.3-Codex': 'GPT-5.3-Codex',
                'GPT-5.2': 'GPT-5.2',
                'GPT-5.2-Codex': 'GPT-5.2-Codex',
                'GPT-5.1-Codex-Max': 'GPT-5.1-Codex-Max',
                'GPT-5.1-Codex-Mini': 'GPT-5.1-Codex-Mini',
            };
            return map[value] || value || 'GPT-5.3-Codex';
        }
        if (provider === 'google') {
            const map: Record<string, string> = {
                'Gemini 3 Pro': 'gemini-3-flash',
                'Gemini 3 Flash': 'gemini-3-flash',
                'Gemini 2.5 Pro': 'gemini-2.5-flash',
                'Gemini 2.5 Flash': 'gemini-2.5-flash',
                'Gemini 2.5 Flash-Lite': 'gemini-2.5-flash-lite',
            };
            return map[value] || value || 'gemini-2.5-flash';
        }
        return value;
    };

    const syncAnalysisModelToMain = async (
        provider: 'google' | 'openai' | 'local' | 'vosk',
        selectedLabelOrId: string
    ) => {
        if (provider !== 'google' && provider !== 'openai') return;
        const providerId = provider === 'google' ? 'gemini' : resolveOpenAIProviderIdForSave();
        const modelName = mapAnalysisLabelToModelId(provider, selectedLabelOrId);
        try {
            await (globalThis as any).ai?.saveConfig?.({ providerId, modelName });
        } catch (error) {
            console.error('Failed to persist analysis model selection:', error);
        }
    };

    const [isLocalSttActive, setIsLocalSttActive] = React.useState(() => {
        return localStorage.getItem('ricky:use-local-stt') === 'true';
    });

    const resolveLiveProvider = (label: string): 'openai_realtime_transcribe' | 'gemini_live' | 'vox' | null => {
        if (
            label === 'OpenAI Realtime Transcription (gpt-4o-transcribe)' ||
            label === 'OpenAI Realtime (Transcribe)'
        ) {
            return 'openai_realtime_transcribe';
        }
        if (
            label === 'Gemini Live' ||
            label === 'Gemini Live (Transcription)' ||
            label === 'Gemini 2.0 Flash (Live)'
        ) {
            return 'gemini_live';
        }
        if (label === 'Vox (Local)') return 'vox';
        return null;
    };

    React.useEffect(() => {
        const handleStorageChange = () => {
            setIsLocalSttActive(localStorage.getItem('ricky:use-local-stt') === 'true');
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const [fetchedOpenAIModels, setFetchedOpenAIModels] = React.useState<string[]>([
        'GPT-5.4',
        'GPT-5.4-Mini',
        'GPT-5.3-Codex',
        'GPT-5.2',
        'GPT-5.2-Codex',
        'GPT-5.1-Codex-Max',
        'GPT-5.1-Codex-Mini'
    ]);
    const [fetchedGeminiModels, setFetchedGeminiModels] = React.useState<string[]>(['Gemini 3 Pro', 'Gemini 3 Flash', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.5 Flash-Lite']);

    React.useEffect(() => {
        let isMounted = true;
        const fetchModels = async () => {
            try {
                if (apiProvider === 'openai') {
                    const targetProvider = savedProvider === 'openai-codex' ? 'openai-codex' : 'openai';
                    const fetchedModels = await (globalThis as any).electron.ipcRenderer.invoke('ai.fetchOnlineModels', targetProvider);
                    const fallbackModels = ['GPT-5.4', 'GPT-5.4-Mini', 'GPT-5.3-Codex', 'GPT-5.2', 'GPT-5.2-Codex', 'GPT-5.1-Codex-Max', 'GPT-5.1-Codex-Mini'];
                    const models = fetchedModels && fetchedModels.length > 0 ? fetchedModels : fallbackModels;
                    if (isMounted && models && models.length > 0) {
                        setFetchedOpenAIModels(models);
                    }
                } else if (apiProvider === 'google') {
                    const models = await (globalThis as any).electron.ipcRenderer.invoke('ai.fetchOnlineModels', 'gemini');
                    if (isMounted && models && models.length > 0) {
                        setFetchedGeminiModels(models);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch online models:', err);
            }
        };
        fetchModels();
        return () => { isMounted = false; };
    }, [apiProvider, savedProvider]);

    return (
        <div className="settings-content-inner">
            <div className="content-header">
                <div className="tabs-container-flex">
                    <div className="provider-tabs">
                        <button
                            className={`provider-tab ${apiProvider === 'google' ? 'active' : ''}`}
                            onClick={() => setApiProvider('google')}
                        >
                            Google Gemini {savedProvider === 'gemini' && <span className="check-icon">✓</span>}
                        </button>
                        <button
                            className={`provider-tab ${apiProvider === 'openai' ? 'active' : ''}`}
                            onClick={() => setApiProvider('openai')}
                        >
                            OpenAI {isOpenAIProviderSaved && <span className="check-icon">✓</span>}
                        </button>
                        <button
                            className={`provider-tab ${apiProvider === 'local' ? 'active' : ''}`}
                            onClick={() => setApiProvider('local')}
                        >
                            Local LLM (Ollama) {savedProvider === 'local' && <span className="check-icon">✓</span>}
                        </button>
                    </div>

                    <div className="tabs-divider"></div>

                    <div className="provider-tabs">
                        <button
                            className={`provider-tab ${apiProvider === 'vosk' ? 'active' : ''}`}
                            onClick={() => setApiProvider('vosk')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                            Transcrição Local
                        </button>
                    </div>
                </div>
            </div>

            <div className="settings-body">
                {apiProvider === 'vosk' ? (
                    <VoskOfflineSection showToast={showToast} />
                ) : apiProvider === 'local' ? (
                    <div className="local-llm-placeholder">
                        <div className="placeholder-icon">
                            <OllamaIcon size={48} />
                        </div>
                        <h3>Integração Local em Breve</h3>
                        <p>Estamos trabalhando para suportar Ollama, LM Studio e outras LLMs rodando localmente na sua máquina.</p>
                        <button className="btn-future" onClick={() => showToast('Esta funcionalidade será implementada em breve!')}>
                            Me avise quando estiver pronto
                        </button>
                    </div>
                ) : (
                    <div className="api-selection-content">
                        <div className="api-key-card-premium">
                            <div className="api-key-card-header">
                                <div className="provider-info-main">
                                    <div className={`provider-icon-circle ${apiProvider}`}>
                                        {apiProvider === 'google' ? (
                                            <GeminiIcon size={24} />
                                        ) : apiProvider === 'openai' ? (
                                            <OpenAIIcon size={24} />
                                        ) : (
                                            <OllamaIcon size={24} />
                                        )}
                                    </div>
                                    <div className="provider-text-details">
                                        <div className="provider-title-row">
                                            <h4>{apiProvider === 'google' ? 'Google Gemini API' : 'OpenAI API'}</h4>
                                            <span className={`status-badge-premium ${(apiProvider === 'google' ? savedProvider === 'gemini' : isOpenAIProviderSaved) ? 'active' : ''}`}>
                                                {(apiProvider === 'google' ? savedProvider === 'gemini' : isOpenAIProviderSaved) ? 'Conectado' : 'Pendente'}
                                            </span>
                                        </div>
                                        <p>{apiProvider === 'google' ? 'Modelos Pro e Flash de última geração' : 'Use chave manual (API) ou assinatura ChatGPT (OAuth Codex).'}</p>
                                    </div>
                                </div>
                                <button
                                    className="btn-get-key-premium"
                                    onClick={() => {
                                        const url = apiProvider === 'google'
                                            ? 'https://aistudio.google.com/api-keys'
                                            : 'https://platform.openai.com/api-keys';
                                        (globalThis as any).electron.ipcRenderer.send('app:open-url', url);
                                    }}
                                >
                                    Obter Chave <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" /></svg>
                                </button>
                            </div>

                            <div className="provider-config-premium">
                                {apiProvider === 'openai' ? (
                                    <div className="openai-auth-flow">
                                        <div className="auth-method-tab-header">
                                            <div className="recommended-method">
                                                <span className="recommended-tag">Recomendado</span>
                                                <h5>Acesso Direto (ChatGPT Plus/Pro)</h5>
                                                <p>Use sua assinatura ChatGPT para acessar os modelos — sem configuração manual.</p>
                                            </div>
                                        </div>

                                        <div className="oauth-embed-container">
                                            <OpenAIAuth
                                                embedded={true}
                                                onProviderActivated={(providerId) => {
                                                    setSavedProvider(providerId);
                                                    if (providerId === 'openai' || providerId === 'openai-codex') {
                                                        setApiProvider('openai');
                                                    } else if (providerId === 'gemini') {
                                                        setApiProvider('google');
                                                    }
                                                }}
                                            />
                                        </div>

                                        <div className="auth-separator">
                                            <span>OU USE CHAVE MANUAL</span>
                                        </div>

                                        <div className="api-key-manual-section">
                                            <div className="input-with-label-premium">
                                                <label>API Key Manual</label>
                                                <div className="premium-input-wrapper">
                                                    <input
                                                        type="password"
                                                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                                        className="premium-api-input"
                                                        value={openaiKey}
                                                        onChange={(e) => setOpenaiKey((e.target as any).value)}
                                                    />
                                                    <div className="input-glow"></div>
                                                </div>
                                            </div>

                                            <button
                                                className={`btn-activate-premium ${savedProvider === 'openai' ? 'active' : ''}`}
                                                onClick={handleSaveKey}
                                            >
                                                {savedProvider === 'openai' ? (
                                                    <><span className="check-circle">✓</span> Ativado</>
                                                ) : (
                                                    'Ativar com Chave'
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="api-key-input-section-premium">
                                        <div className="input-with-label-premium">
                                            <label>Sua Chave de Acesso</label>
                                            <div className="premium-input-wrapper">
                                                <input
                                                    type="password"
                                                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                                    className="premium-api-input"
                                                    value={geminiKey}
                                                    onChange={(e) => setGeminiKey((e.target as any).value)}
                                                />
                                                <div className="input-glow"></div>
                                            </div>
                                        </div>

                                        <button
                                            className={`btn-activate-premium ${savedProvider === 'gemini' ? 'active' : ''}`}
                                            onClick={handleSaveKey}
                                        >
                                            {savedProvider === 'gemini' ? (
                                                <><span className="check-circle">✓</span> Ativado</>
                                            ) : (
                                                'Ativar Modelo'
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="performance-section-title">Configurações de Desempenho</div>
                            <div className="performance-grid">
                                <button className={`perf-card ${performance === 'rapido' ? 'active' : ''}`} onClick={() => setPerformance('rapido')}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                                    <div className="perf-info">
                                        <span className="perf-title">Rápido</span>
                                        <span className="perf-desc">Respostas rápidas, respostas curtas</span>
                                    </div>
                                </button>
                                <button className={`perf-card ${performance === 'padrao' ? 'active' : ''}`} onClick={() => setPerformance('padrao')}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg>
                                    <div className="perf-info">
                                        <span className="perf-title">Padrão</span>
                                        <span className="perf-desc">Equilíbrio entre velocidade e qualidade</span>
                                    </div>
                                </button>
                                <button className={`perf-card ${performance === 'qualidade' ? 'active' : ''}`} onClick={() => setPerformance('qualidade')}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                                    <div className="perf-info">
                                        <span className="perf-title">Qualidade</span>
                                        <span className="perf-desc">Respostas completas e detalhadas</span>
                                    </div>
                                </button>
                                <button className={`perf-card ${performance === 'personalizado' ? 'active' : ''}`} onClick={() => setPerformance('personalizado')}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7h-9m3 3H5m16 6h-9m3 3H5" /></svg>
                                    <div className="perf-info">
                                        <span className="perf-title">Personalizado</span>
                                        <span className="perf-desc">Escolha seus próprios modelos</span>
                                    </div>
                                </button>
                            </div>

                            <div className="models-selection-grid">
                                <div className="model-selector-card-premium">
                                    <div className="card-header-with-desc">
                                        <div className="card-title-row">
                                            <div className="title-icon">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                            </div>
                                            <label>Modelo de Análise</label>
                                        </div>
                                        <p className="card-description">Modelo usado para interpretar imagens e manter o contexto das conversas.</p>
                                    </div>
                                    <CustomSelect
                                        value={analysisModel}
                                        onChange={(val) => {
                                            setAnalysisModel(val);
                                            showToast(`Modelo de análise alterado para ${val}`);
                                            const storageKey =
                                                apiProvider === 'google'
                                                    ? 'ricky:analysis-model:google'
                                                    : 'ricky:analysis-model:openai';
                                            localStorage.setItem(storageKey, val);
                                            void syncAnalysisModelToMain(apiProvider, val);
                                        }}
                                        options={apiProvider === 'google'
                                            ? fetchedGeminiModels
                                            : fetchedOpenAIModels
                                        }
                                    />
                                </div>

                                <div className={`model-selector-card-premium ${isLocalSttActive ? 'is-disabled' : ''}`}>
                                    <div className="card-header-with-desc">
                                        <div className="card-title-row">
                                            <div className="title-icon">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>
                                            </div>
                                            <label>Modelo de Transcrição Live</label>
                                        </div>
                                        <p className="card-description">Motor de inteligência artificial usado para transformar sua voz em texto em tempo real.</p>
                                    </div>
                                    <CustomSelect
                                        value={isLocalSttActive ? 'Usando Transcrição Local' : liveModel}
                                        onChange={(val) => {
                                            if (!isLocalSttActive) {
                                                setLiveModel(val);
                                                showToast(`Modelo de transcrição alterado para ${val}`);
                                                const storageKey =
                                                    apiProvider === 'google'
                                                        ? 'ricky:live-model:google'
                                                        : 'ricky:live-model:openai';
                                                localStorage.setItem(storageKey, val);
                                                const providerId = resolveLiveProvider(val);
                                                const isActiveProvider =
                                                    (savedProvider === 'gemini' && apiProvider === 'google') ||
                                                    ((savedProvider === 'openai' || savedProvider === 'openai-codex') && apiProvider === 'openai');
                                                if (providerId && isActiveProvider && window.stt?.updateConfig) {
                                                    window.stt.updateConfig({ provider: providerId });
                                                    if (providerId !== 'vox') {
                                                        localStorage.setItem('ricky:live-stt-provider', providerId);
                                                    }
                                                }
                                            }
                                        }}
                                        options={apiProvider === 'google'
                                            ? ['Gemini Live', 'Gemini 2.0 Flash (Live)']
                                            : ['OpenAI Realtime Transcription (gpt-4o-transcribe)']
                                        }
                                    />
                                    {isLocalSttActive && (
                                        <div className="local-stt-active-warning">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                            A transcrição local está ativada nas configurações. O modelo online foi desabilitado para economizar recursos.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
