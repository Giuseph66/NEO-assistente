/**
 * OpenAI OAuth Login Component
 * Displayed inside AIAgentSettings when OpenAI provider is selected.
 * Handles: connect, waiting, manual fallback, profiles, disconnect.
 */
import { useEffect, useState, useCallback } from 'react';
import './OpenAIAuth.css';

interface AuthProfile {
    profileId: string;
    label: string;
    provider: string;
    expiresAt: number;
    accountId?: string;
    isActive: boolean;
    isExpired: boolean;
    isEnabled: boolean;
}

interface AuthStatus {
    connected: boolean;
    profileId: string | null;
    expiresAt?: number;
    accountId?: string;
    flowStatus: 'idle' | 'awaiting_callback' | 'exchanging_code' | 'connected' | 'error';
}

interface AuthConfig {
    clientId: string;
    scopes: string[];
    authorizeUrl: string;
    redirectUri: string;
}

type FlowState = 'idle' | 'awaiting_callback' | 'exchanging_code' | 'connected' | 'error';

interface OpenAIAuthProps {
    embedded?: boolean;
    onProviderActivated?: (providerId: string) => void;
}

export const OpenAIAuth: React.FC<OpenAIAuthProps> = ({ embedded = false, onProviderActivated }) => {
    const [profiles, setProfiles] = useState<AuthProfile[]>([]);
    const [status, setStatus] = useState<AuthStatus | null>(null);
    const [config, setConfig] = useState<AuthConfig | null>(null);
    const [flowState, setFlowState] = useState<FlowState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [showNewProfile, setShowNewProfile] = useState(false);
    const [newProfileId, setNewProfileId] = useState('');
    const [newProfileLabel, setNewProfileLabel] = useState('');

    const [selectedProfileId, setSelectedProfileId] = useState<string>('default');

    const loadData = useCallback(async () => {
        try {
            const [profilesData, statusData, configData] = await Promise.all([
                window.auth.getProfiles(),
                window.auth.getStatus(),
                window.auth.getConfig(),
            ]);
            setProfiles(profilesData || []);
            setStatus(statusData);
            setConfig(configData);


            if (statusData?.connected) {
                setFlowState('connected');
            } else {
                setFlowState(statusData?.flowStatus || 'idle');
            }

            if (statusData?.profileId) {
                setSelectedProfileId(statusData.profileId);
            }
        } catch (err: any) {
            console.error('Failed to load auth data:', err);
        }
    }, []);

    useEffect(() => {
        loadData();

        // Listen for status changes from main process
        const unsubscribe = window.auth.onStatusChanged((event) => {
            setFlowState(event.status);
            if (event.error) {
                setError(event.error);
            }
            // Reload profiles after any state change
            loadData();
        });

        return () => {
            unsubscribe();
        };
    }, [loadData]);

    const handleConnect = async () => {
        setError(null);
        setSuccess(null);

        setFlowState('awaiting_callback');

        const result = await window.auth.loginOpenAI(selectedProfileId, getProfileLabel());

        if (result.success) {
            setSuccess('Conectado com sucesso ao OpenAI!');
            setFlowState('connected');
            setTimeout(() => setSuccess(null), 5000);
            await loadData();
            // Automatically make OpenAI the globally active provider
            await (globalThis as any).ai?.saveConfig?.({ providerId: 'openai-codex' });
            if (onProviderActivated) {
                onProviderActivated('openai-codex');
            }
        } else if (result.error === 'PORT_UNAVAILABLE') {
            // Server couldn't start — show manual mode
            setShowManualInput(true);
            setError('Não foi possível iniciar servidor local. Use o modo manual abaixo.');
        } else if (result.error) {
            // Check for scope warnings (success=true but with error message)
            if (result.error.includes('Scopes insuficientes')) {
                setSuccess('Conectado, porém com aviso:');
                setError(result.error);
                setFlowState('connected');
            } else {
                setError(result.error);
                setFlowState('error');
            }
        }
    };

    const handleManualFinish = async () => {
        if (!manualCode.trim()) {
            setError('Cole a URL de redirect ou o código de autorização.');
            return;
        }

        setError(null);
        setFlowState('exchanging_code');

        const result = await window.auth.finishLoginManual(
            selectedProfileId,
            manualCode.trim(),
            getProfileLabel()
        );

        if (result.success) {
            setSuccess('Conectado com sucesso!');
            setFlowState('connected');
            setShowManualInput(false);
            setManualCode('');
            setTimeout(() => setSuccess(null), 5000);
            await loadData();
            // Automatically make OpenAI the globally active provider
            await (globalThis as any).ai?.saveConfig?.({ providerId: 'openai-codex' });
            if (onProviderActivated) {
                onProviderActivated('openai-codex');
            }
        } else {
            setError(result.error || 'Falha no login manual.');
            setFlowState('error');
        }
    };

    const handleDisconnect = async (profileId: string) => {
        const result = await window.auth.logout(profileId);
        if (result.success) {
            setSuccess('Desconectado.');
            setFlowState('idle');
            setTimeout(() => setSuccess(null), 3000);
            await loadData();
        } else {
            setError(result.error || 'Falha ao desconectar.');
        }
    };

    const handleCancelLogin = async () => {
        await window.auth.cancelLogin(selectedProfileId);
        // Await manual disconnect, which will also trigger an event and reload state
        await window.auth.logout(selectedProfileId);
    };

    const handleToggleEnabled = async (profileId: string, currentEnabled: boolean) => {
        setError(null);
        const result = await window.auth.setProfileEnabled(profileId, !currentEnabled);
        if (result.success) {
            await loadData(); // Reload profiles to get the new state

            // If we just enabled it, also set it as the globally active AI provider
            if (!currentEnabled) {
                await (globalThis as any).ai?.saveConfig?.({ providerId: 'openai-codex' });
                if (onProviderActivated) {
                    onProviderActivated('openai-codex');
                }
            }
        } else {
            setError(result.error || 'Falha ao alterar status do perfil.');
        }
    };

    const handleSetActiveProfile = async (profileId: string) => {
        const result = await window.auth.setActiveProfile(profileId);
        if (result.success) {
            setSelectedProfileId(profileId);
            await loadData();
        } else {
            setError(result.error || 'Falha ao trocar perfil.');
        }
    };

    const handleAddProfile = () => {
        if (!newProfileId.trim() || !newProfileLabel.trim()) {
            setError('Preencha o ID e o nome do perfil.');
            return;
        }
        setSelectedProfileId(newProfileId.trim());
        setShowNewProfile(false);
        setNewProfileId('');
        setNewProfileLabel('');
    };



    const getProfileLabel = (): string => {
        const existing = profiles.find((p) => p.profileId === selectedProfileId);
        if (existing) return existing.label;
        if (newProfileLabel) return newProfileLabel;
        return selectedProfileId === 'default' ? 'Personal' : selectedProfileId;
    };

    const formatExpiry = (timestamp: number): string => {
        const remaining = timestamp - Date.now();
        if (remaining <= 0) return 'Expirado';
        const minutes = Math.floor(remaining / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return `${hours}h ${minutes % 60}min restantes`;
        return `${minutes}min restantes`;
    };

    const activeProfile = profiles.find((p) => p.profileId === selectedProfileId);
    const isConnected = activeProfile && !activeProfile.isExpired;

    return (
        <div className={`oauth-container ${embedded ? 'embedded' : ''}`}>
            {!embedded && (
                <div className="oauth-header">
                    <div className="oauth-header-left">
                        <div className="oauth-icon">🔗</div>
                        <div>
                            <h4>Conectar com ChatGPT</h4>
                            <p className="oauth-subtitle">
                                Use sua assinatura ChatGPT Plus/Pro
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Alerts */}
            {error && (
                <div className="oauth-alert oauth-alert-error">
                    <span>⚠️</span> {error}
                    <button className="oauth-alert-close" onClick={() => setError(null)}>✕</button>
                </div>
            )}
            {success && (
                <div className="oauth-alert oauth-alert-success">
                    <span>✅</span> {success}
                </div>
            )}


                <div className="oauth-profile-tabs">
                    {profiles.map((p) => (
                        p.isExpired ? (
                            <span key={p.profileId} className="oauth-expired-badge">
                                expirado
                            </span>
                        ) : null
                    ))}
                </div>

            {/* Main Action Area */}
            <div className="oauth-action-area">
                {/* IDLE — Show connect button */}
                {(flowState === 'idle' || flowState === 'error') && !isConnected && (
                    <div className="oauth-connect-section">
                        <button
                            className="oauth-connect-btn"
                            onClick={handleConnect}
                        >
                            <span className="oauth-connect-icon">🚀</span>
                            Conectar com ChatGPT
                        </button>
                        <p className="oauth-hint">
                            Requer assinatura ChatGPT Plus ou Pro
                        </p>
                    </div>
                )}

                {/* AWAITING CALLBACK — Spinner + manual fallback */}
                {flowState === 'awaiting_callback' && (
                    <div className="oauth-waiting-section">
                        <div className="oauth-spinner-container">
                            <div className="oauth-spinner"></div>
                            <div>
                                <p className="oauth-waiting-text">Aguardando callback do navegador…</p>
                                <p className="oauth-waiting-hint">Autentique-se no navegador que foi aberto</p>
                            </div>
                        </div>

                        <div className="oauth-waiting-actions">
                            <button className="btn btn-sm btn-secondary" onClick={handleCancelLogin}>
                                ✕ Cancelar
                            </button>
                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => setShowManualInput(!showManualInput)}
                            >
                                📋 {showManualInput ? 'Esconder modo manual' : 'Não conseguiu abrir? / Estou remoto'}
                            </button>
                        </div>

                        {showManualInput && (
                            <div className="oauth-manual-section">
                                <h5>Modo Manual</h5>
                                <p className="oauth-manual-hint">
                                    Cole a URL de redirect completa ou apenas o código de autorização:
                                </p>
                                <div className="oauth-manual-input-row">
                                    <input
                                        type="text"
                                        value={manualCode}
                                        onChange={(e) => setManualCode(e.target.value)}
                                        placeholder="http://127.0.0.1:1455/auth/callback?code=... ou apenas o code"
                                        className="oauth-input"
                                    />
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleManualFinish}
                                        disabled={!manualCode.trim()}
                                    >
                                        Enviar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* EXCHANGING CODE — Loading */}
                {flowState === 'exchanging_code' && (
                    <div className="oauth-waiting-section">
                        <div className="oauth-spinner-container">
                            <div className="oauth-spinner"></div>
                            <p className="oauth-waiting-text">Trocando código por tokens…</p>
                        </div>
                    </div>
                )}

                {/* CONNECTED — Show profile info */}
                {(flowState === 'connected' || isConnected) && activeProfile && (
                    <div className="oauth-connected-section">
                        <div className="oauth-connected-badge">
                            <span className="oauth-connected-dot"></span>
                            Conectado
                        </div>
                        <div className="oauth-connected-details">
                            <div className="oauth-detail-row">
                                <span className="oauth-detail-label">Expira:</span>
                                <span className={`oauth-detail-value ${activeProfile.isExpired ? 'oauth-expired' : ''}`}>
                                    {formatExpiry(activeProfile.expiresAt)}
                                </span>
                            </div>
                            <div className="oauth-detail-row">
                                <span className="oauth-detail-label">Perfil:</span>
                                <span className="oauth-detail-value">{activeProfile.label}</span>
                            </div>
                            <div className="oauth-detail-row oauth-detail-toggle-row">
                                <span className="oauth-detail-label">Status:</span>
                                <label className="oauth-toggle-switch">
                                    <input
                                        type="checkbox"
                                        checked={activeProfile.isEnabled}
                                        onChange={() => handleToggleEnabled(activeProfile.profileId, activeProfile.isEnabled)}
                                    />
                                    <span className="oauth-toggle-slider"></span>
                                    <span className="oauth-toggle-label">
                                        {activeProfile.isEnabled ? 'Ativo (Pronto para uso)' : 'Desativado'}
                                    </span>
                                </label>
                            </div>
                        </div>
                        <div className="oauth-connected-actions">
                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={handleConnect}
                                title="Re-autenticar para renovar scopes"
                            >
                                🔄 Re-autenticar
                            </button>
                            <button
                                className="btn btn-sm btn-danger"
                                onClick={() => handleDisconnect(activeProfile.profileId)}
                            >
                                🔌 Desconectar
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Info box */}
            {
                !embedded && (
                    <div className="oauth-info-box">
                        <h5>ℹ️ Sobre a conexão OAuth</h5>
                        <ul>
                            <li>A autenticação usa <strong>PKCE</strong> — sem segredos armazenados no app</li>
                            <li>Os tokens são criptografados com <strong>safeStorage</strong> do sistema</li>
                            <li>O refresh é <strong>automático</strong> — o token é renovado antes de expirar</li>
                            <li>Se o provedor negar os scopes, use a <strong>API key manual</strong> acima</li>
                        </ul>
                    </div>
                )
            }
        </div >
    );
}
