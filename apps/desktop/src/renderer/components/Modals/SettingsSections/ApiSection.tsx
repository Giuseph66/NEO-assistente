import React from 'react';
import { CustomSelect } from './CustomSelect';
import { VoskOfflineSection } from './VoskOfflineSection';
import { GeminiIcon, OpenAIIcon, OllamaIcon, ClaudeIcon } from '../../Icons';
import { OpenAIAuth } from '../../Auth/OpenAIAuth';
import { buildModelOptions, isModelId } from '../../../utils/modelOptions';

export type ApiProviderTab = 'google' | 'openai' | 'anthropic' | 'local' | 'vosk';

export const OPENAI_REALTIME_LABEL = 'OpenAI Realtime Transcription (gpt-4o-transcribe)';
export const CODEX_LIVE_LABEL = 'Codex (login ChatGPT, experimental)';

const CLAUDE_MODEL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];

// Shown only until the app answers (or outside Electron); the real lists come from the main process.
const FALLBACK_OPENAI_MODEL_IDS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const FALLBACK_GEMINI_MODEL_IDS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash'];

type CliAuthStatus = { installed: boolean; loggedIn: boolean; authMethod?: string; subscriptionType?: string; error?: string };

type CliSubscriptionAuthProps = {
    /** Shown in the status line, e.g. "Claude Code". */
    cliName: string;
    installUrl: string;
    loginLabel: string;
    /** Describes what the logged-in state means (and whether it is the subscription). */
    describeLoggedIn: (status: CliAuthStatus) => { text: string; isSubscription: boolean };
    api: { status: () => Promise<CliAuthStatus>; login: () => Promise<CliAuthStatus>; logout: () => Promise<CliAuthStatus> } | null;
    isActive: boolean;
    onActivate: () => void;
    showToast: (m: string) => void;
};

/** Subscription through the user's own CLI (Claude Code / Codex): login is done by that CLI itself. */
const CliSubscriptionAuth: React.FC<CliSubscriptionAuthProps> = ({
    cliName,
    installUrl,
    loginLabel,
    describeLoggedIn,
    api,
    isActive,
    onActivate,
    showToast,
}) => {
    const [status, setStatus] = React.useState<CliAuthStatus | null>(null);
    const [busy, setBusy] = React.useState<string | null>(null);

    const run = React.useCallback(async (label: string, fn: () => Promise<CliAuthStatus>) => {
        setBusy(label);
        try {
            const next = await fn();
            setStatus(next);
            if (next?.error) showToast(next.error);
        } catch (error) {
            showToast(`Falha: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(null);
        }
    }, [showToast]);

    React.useEffect(() => {
        if (api) void run('status', () => api.status());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loggedIn = status?.loggedIn ? describeLoggedIn(status) : null;
    const statusText = !status
        ? `Verificando ${cliName}...`
        : !status.installed
            ? `${cliName} não instalado neste computador.`
            : !status.loggedIn
                ? `${cliName} instalado, sem login.`
                : loggedIn!.text;

    return (
        <div className="cli-subscription-auth">
            <p className="card-description">
                {statusText} As respostas são geradas pelo próprio {cliName} com o seu login; o app não lê nem guarda o token.
            </p>
            <div className="cli-subscription-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {status && !status.installed ? (
                    <button
                        className="btn-get-key-premium"
                        onClick={() => (globalThis as any).electron.ipcRenderer.send('app:open-url', installUrl)}
                    >
                        Instalar {cliName}
                    </button>
                ) : (
                    <>
                        {!status?.loggedIn && (
                            <button className="btn-activate-premium" disabled={!!busy || !api} onClick={() => api && run('login', () => api.login())}>
                                {busy === 'login' ? 'Aguardando login no navegador...' : loginLabel}
                            </button>
                        )}
                        {status?.loggedIn && (
                            <button
                                className={`btn-activate-premium ${isActive ? 'active' : ''}`}
                                disabled={!!busy}
                                onClick={onActivate}
                            >
                                {isActive ? <><span className="check-circle">✓</span> Assinatura ativa</> : 'Usar assinatura'}
                            </button>
                        )}
                        <button className="btn-get-key-premium" disabled={!!busy || !api} onClick={() => api && run('status', () => api.status())}>
                            {busy === 'status' ? 'Verificando...' : 'Verificar'}
                        </button>
                        {status?.loggedIn && (
                            <button className="btn-get-key-premium" disabled={!!busy || !api} onClick={() => api && run('logout', () => api.logout())}>
                                Sair
                            </button>
                        )}
                    </>
                )}
            </div>
            {loggedIn && !loggedIn.isSubscription && (
                <p className="card-description" style={{ marginTop: 8 }}>
                    Atenção: esse login não é de assinatura, então o uso pode ser cobrado pela API.
                </p>
            )}
        </div>
    );
};

const describeClaudeLogin = (status: CliAuthStatus) => {
    const isSubscription = status.authMethod === 'claude.ai';
    return {
        isSubscription,
        text: isSubscription
            ? `Conectado à assinatura Claude${status.subscriptionType ? ` (${status.subscriptionType})` : ''}.`
            : `Claude Code logado via ${status.authMethod ?? 'outro método'}.`,
    };
};

const describeCodexLogin = (status: CliAuthStatus) => {
    const isSubscription = status.authMethod === 'chatgpt';
    return {
        isSubscription,
        text: isSubscription ? 'Conectado à assinatura ChatGPT.' : `Codex logado via ${status.authMethod ?? 'outro método'}.`,
    };
};

const ClaudeSubscriptionAuth: React.FC<{ isActive: boolean; onActivate: () => void; showToast: (m: string) => void }> = (props) => {
    const auth = (globalThis as any).auth;
    return (
        <CliSubscriptionAuth
            {...props}
            cliName="Claude Code"
            installUrl="https://claude.com/claude-code"
            loginLabel="Entrar com conta Claude"
            describeLoggedIn={describeClaudeLogin}
            api={auth?.claudeCodeStatus ? { status: () => auth.claudeCodeStatus(), login: () => auth.claudeCodeLogin(), logout: () => auth.claudeCodeLogout() } : null}
        />
    );
};

const CodexSubscriptionAuth: React.FC<{ isActive: boolean; onActivate: () => void; showToast: (m: string) => void }> = (props) => {
    const auth = (globalThis as any).auth;
    return (
        <CliSubscriptionAuth
            {...props}
            cliName="Codex"
            installUrl="https://github.com/openai/codex"
            loginLabel="Entrar com conta ChatGPT"
            describeLoggedIn={describeCodexLogin}
            api={auth?.codexCliStatus ? { status: () => auth.codexCliStatus(), login: () => auth.codexCliLogin(), logout: () => auth.codexCliLogout() } : null}
        />
    );
};

interface ApiSectionProps {
    apiProvider: ApiProviderTab;
    setApiProvider: (provider: ApiProviderTab) => void;
    savedProvider: string | null;
    geminiKey: string;
    openaiKey: string;
    anthropicKey: string;
    setGeminiKey: (key: string) => void;
    setOpenaiKey: (key: string) => void;
    setAnthropicKey: (key: string) => void;
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
    anthropicKey,
    setGeminiKey,
    setOpenaiKey,
    setAnthropicKey,
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
    const isOpenAIProviderSaved =
        savedProvider === 'openai' || savedProvider === 'openai-codex' || savedProvider === 'codex-cli';
    const isTabProviderActive =
        apiProvider === 'google'
            ? savedProvider === 'gemini'
            : apiProvider === 'anthropic'
                ? savedProvider === 'anthropic' || savedProvider === 'claude-code'
                : isOpenAIProviderSaved;

    const resolveOpenAIProviderIdForSave = (): 'openai' | 'openai-codex' | 'codex-cli' => {
        if (savedProvider === 'codex-cli' || savedProvider === 'openai-codex') return savedProvider;
        return 'openai';
    };

    /** The dropdown holds real model ids already; this only normalises the case (OpenAI ids are lowercase). */
    const mapAnalysisLabelToModelId = (provider: ApiProviderTab, value: string): string => {
        if (provider === 'openai') return (value || 'gpt-6.1-sol').toLowerCase();
        if (provider === 'anthropic') return value || 'claude-opus-5-5';
        if (provider === 'google') return value || 'gemini-2.5-flash';
        return value;
    };

    const syncAnalysisModelToMain = async (
        provider: ApiProviderTab,
        selectedLabelOrId: string
    ) => {
        if (provider !== 'google' && provider !== 'openai' && provider !== 'anthropic') return;
        const providerId =
            provider === 'google'
                ? 'gemini'
                : provider === 'anthropic'
                    ? (savedProvider === 'claude-code' ? 'claude-code' : 'anthropic')
                    : resolveOpenAIProviderIdForSave();
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

    const resolveLiveProvider = (
        label: string
    ): 'openai_realtime_transcribe' | 'gemini_live' | 'codex_transcribe' | 'vox' | null => {
        if (label === CODEX_LIVE_LABEL) return 'codex_transcribe';
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

    const [fetchedOpenAIModels, setFetchedOpenAIModels] = React.useState<string[]>(FALLBACK_OPENAI_MODEL_IDS);
    const [fetchedClaudeModels, setFetchedClaudeModels] = React.useState<string[]>(CLAUDE_MODEL_IDS);
    const [fetchedGeminiModels, setFetchedGeminiModels] = React.useState<string[]>(FALLBACK_GEMINI_MODEL_IDS);
    // id → display name from the app's catalog (live lists only carry ids)
    const [modelNames, setModelNames] = React.useState<Record<string, string>>({});

    React.useEffect(() => {
        let isMounted = true;
        const fetchModels = async () => {
            const ipc = (globalThis as any).electron?.ipcRenderer;
            if (!ipc) return;
            try {
                const targetProvider =
                    apiProvider === 'openai'
                        ? (savedProvider === 'openai-codex' || savedProvider === 'codex-cli' ? savedProvider : 'openai')
                        : apiProvider === 'anthropic'
                            ? (savedProvider === 'claude-code' ? 'claude-code' : 'anthropic')
                            : apiProvider === 'google'
                                ? 'gemini'
                                : null;
                if (!targetProvider) return;

                const [ids, infos] = await Promise.all([
                    ipc.invoke('ai.fetchOnlineModels', targetProvider) as Promise<string[]>,
                    ipc.invoke('ai.listModels', targetProvider).catch(() => []) as Promise<Array<{ id: string; name: string }>>,
                ]);
                if (!isMounted) return;
                const names: Record<string, string> = {};
                for (const info of infos || []) if (info?.id && info?.name) names[info.id] = info.name;
                setModelNames((previous) => ({ ...previous, ...names }));

                const list = (ids || []).filter(isModelId);
                if (apiProvider === 'openai' && list.length > 0) setFetchedOpenAIModels(list);
                else if (apiProvider === 'anthropic') setFetchedClaudeModels(list.filter((m) => m.startsWith('claude-')).length ? list.filter((m) => m.startsWith('claude-')) : CLAUDE_MODEL_IDS);
                else if (apiProvider === 'google' && list.length > 0) setFetchedGeminiModels(list);
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
                            className={`provider-tab ${apiProvider === 'anthropic' ? 'active' : ''}`}
                            onClick={() => setApiProvider('anthropic')}
                        >
                            Anthropic Claude {(savedProvider === 'anthropic' || savedProvider === 'claude-code') && <span className="check-icon">✓</span>}
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
                                        ) : apiProvider === 'anthropic' ? (
                                            <ClaudeIcon size={24} />
                                        ) : (
                                            <OllamaIcon size={24} />
                                        )}
                                    </div>
                                    <div className="provider-text-details">
                                        <div className="provider-title-row">
                                            <h4>{apiProvider === 'google' ? 'Google Gemini API' : apiProvider === 'anthropic' ? 'Anthropic Claude API' : 'OpenAI API'}</h4>
                                            <span className={`status-badge-premium ${isTabProviderActive ? 'active' : ''}`}>
                                                {isTabProviderActive ? 'Conectado' : 'Pendente'}
                                            </span>
                                        </div>
                                        <p>
                                            {apiProvider === 'google'
                                                ? 'Modelos Pro e Flash de última geração'
                                                : apiProvider === 'anthropic'
                                                    ? 'Modelos Claude com raciocínio: assinatura Claude (via Claude Code) ou chave de API.'
                                                    : 'Use chave manual (API) ou assinatura ChatGPT (OAuth Codex).'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    className="btn-get-key-premium"
                                    onClick={() => {
                                        const url = apiProvider === 'google'
                                            ? 'https://aistudio.google.com/api-keys'
                                            : apiProvider === 'anthropic'
                                                ? 'https://console.anthropic.com/settings/keys'
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
                                                <h5>Assinatura ChatGPT (Plus/Pro) via Codex</h5>
                                                <p>Usa o login do Codex instalado neste computador — sem chave de API.</p>
                                            </div>
                                        </div>
                                        <CodexSubscriptionAuth
                                            isActive={savedProvider === 'codex-cli'}
                                            showToast={showToast}
                                            onActivate={async () => {
                                                const modelName = mapAnalysisLabelToModelId('openai', analysisModel);
                                                try {
                                                    await (globalThis as any).ai?.saveConfig?.({ providerId: 'codex-cli', modelName });
                                                    setSavedProvider('codex-cli');
                                                    showToast('Assinatura ChatGPT ativada (via Codex).');
                                                } catch (error) {
                                                    showToast('Erro ao ativar a assinatura ChatGPT.');
                                                }
                                            }}
                                        />

                                        <div className="auth-separator">
                                            <span>OU LOGIN DIRETO NO APP (EXPERIMENTAL)</span>
                                        </div>
                                        <div className="auth-method-tab-header">
                                            <div className="recommended-method">
                                                <h5>Login ChatGPT direto no app</h5>
                                                <p>O app faz o login e guarda o token por conta própria (método antigo).</p>
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
                                ) : apiProvider === 'anthropic' ? (
                                    <div className="openai-auth-flow">
                                        <div className="auth-method-tab-header">
                                            <div className="recommended-method">
                                                <span className="recommended-tag">Recomendado</span>
                                                <h5>Assinatura Claude (Pro/Max) via Claude Code</h5>
                                                <p>Usa o login do Claude Code instalado neste computador — sem chave de API.</p>
                                            </div>
                                        </div>
                                        <ClaudeSubscriptionAuth
                                            isActive={savedProvider === 'claude-code'}
                                            showToast={showToast}
                                            onActivate={async () => {
                                                const modelName = mapAnalysisLabelToModelId('anthropic', analysisModel);
                                                try {
                                                    await (globalThis as any).ai?.saveConfig?.({ providerId: 'claude-code', modelName });
                                                    setSavedProvider('claude-code');
                                                    showToast('Assinatura Claude ativada (via Claude Code).');
                                                } catch (error) {
                                                    showToast('Erro ao ativar a assinatura Claude.');
                                                }
                                            }}
                                        />
                                        <div className="auth-separator">
                                            <span>OU USE CHAVE DE API</span>
                                        </div>
                                    <div className="api-key-input-section-premium">
                                        <div className="input-with-label-premium">
                                            <label>Chave da API Anthropic</label>
                                            <div className="premium-input-wrapper">
                                                <input
                                                    type="password"
                                                    placeholder="sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx"
                                                    className="premium-api-input"
                                                    value={anthropicKey}
                                                    onChange={(e) => setAnthropicKey((e.target as any).value)}
                                                />
                                                <div className="input-glow"></div>
                                            </div>
                                        </div>

                                        <button
                                            className={`btn-activate-premium ${savedProvider === 'anthropic' ? 'active' : ''}`}
                                            onClick={handleSaveKey}
                                        >
                                            {savedProvider === 'anthropic' ? (
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
                                                    : apiProvider === 'anthropic'
                                                        ? 'ricky:analysis-model:anthropic'
                                                        : 'ricky:analysis-model:openai';
                                            localStorage.setItem(storageKey, val);
                                            void syncAnalysisModelToMain(apiProvider, val);
                                        }}
                                        options={buildModelOptions(
                                            apiProvider === 'google'
                                                ? fetchedGeminiModels
                                                : apiProvider === 'anthropic'
                                                    ? fetchedClaudeModels
                                                    : fetchedOpenAIModels,
                                            modelNames,
                                            analysisModel
                                        )}
                                    />
                                </div>

                                {apiProvider === 'anthropic' ? (
                                <div className="model-selector-card-premium is-disabled">
                                    <div className="card-header-with-desc">
                                        <div className="card-title-row">
                                            <label>Modelo de Transcrição Live</label>
                                        </div>
                                        <p className="card-description">
                                            A Anthropic não oferece API de transcrição. A transcrição continua usando o motor
                                            configurado (Vosk local, Gemini, OpenAI ou Codex).
                                        </p>
                                    </div>
                                </div>
                                ) : (
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
                                            : [OPENAI_REALTIME_LABEL, CODEX_LIVE_LABEL]
                                        }
                                    />
                                    {isLocalSttActive && (
                                        <div className="local-stt-active-warning">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                            A transcrição local está ativada nas configurações. O modelo online foi desabilitado para economizar recursos.
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
