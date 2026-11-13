/**
 * OAuth Flow Controller for OpenAI.
 * Orchestrates: PKCE generation → authorize URL → loopback server → token exchange → storage.
 * Supports both automatic (browser) and manual (paste code) modes.
 */
import { shell } from 'electron';
import { getLogger } from '@neo/logger';
import { generatePKCE, PKCEPair } from './pkce';
import { startOAuthCallbackServer, extractCodeFromUrl } from './oauthServer';
import { TokenStore, AuthProfile, maskToken } from './tokenStore';
import { TokenRefresher } from './tokenRefresher';
import { getOAuthConfig, REQUIRED_MODEL_SCOPES } from './authConfig';
import { extractChatGptAccountId } from './chatgptAccount';

const logger = getLogger();

export type AuthFlowStatus =
    | 'idle'
    | 'awaiting_callback'
    | 'exchanging_code'
    | 'connected'
    | 'error';

export interface AuthFlowState {
    status: AuthFlowStatus;
    profileId?: string;
    error?: string;
    authorizeUrl?: string;
}

export class OpenAIOAuthController {
    private tokenStore: TokenStore;
    private tokenRefresher: TokenRefresher;

    /** Pending PKCE per profile (needed for code exchange) */
    private pendingPKCE: Map<string, PKCEPair> = new Map();
    /** Cancel functions for active loopback servers */
    private activeServers: Map<string, () => void> = new Map();
    /** Current flow status per profile */
    private flowStates: Map<string, AuthFlowState> = new Map();

    private statusListeners: Array<(state: AuthFlowState) => void> = [];

    constructor(tokenStore?: TokenStore, tokenRefresher?: TokenRefresher) {
        this.tokenStore = tokenStore || new TokenStore();
        this.tokenRefresher = tokenRefresher || new TokenRefresher(this.tokenStore);
    }

    getTokenStore(): TokenStore {
        return this.tokenStore;
    }

    getTokenRefresher(): TokenRefresher {
        return this.tokenRefresher;
    }

    onStatusChanged(cb: (state: AuthFlowState) => void): () => void {
        this.statusListeners.push(cb);
        return () => {
            this.statusListeners = this.statusListeners.filter((l) => l !== cb);
        };
    }

    private emit(state: AuthFlowState): void {
        const profileId = state.profileId || 'default';
        this.flowStates.set(profileId, state);
        for (const cb of this.statusListeners) {
            try { cb(state); } catch { /* ignore listener errors */ }
        }
    }

    getFlowState(profileId: string): AuthFlowState {
        return this.flowStates.get(profileId) || { status: 'idle', profileId };
    }

    /** Build the full authorize URL with PKCE params (codex_cli compatible) */
    private buildAuthorizeUrl(pkce: PKCEPair): string {
        const config = getOAuthConfig();
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            scope: config.scopes.join(' '),
            state: pkce.state,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: 'S256',
            audience: config.audience,
            // codex_cli specific params — enables simplified ChatGPT login flow
            codex_cli_simplified_flow: 'true',
            originator: 'codex_cli_rs',
            id_token_add_organizations: 'true',
        });
        return `${config.authorizeUrl}?${params.toString()}`;
    }

    /**
     * Start the OAuth login flow:
     * 1) Generate PKCE pair
     * 2) Start loopback server
     * 3) Open browser with authorize URL
     * 4) Wait for callback or timeout
     * 5) Exchange code for tokens
     * 6) Save to store
     */
    async startLogin(
        profileId: string = 'default',
        label: string = 'Personal'
    ): Promise<{ success: boolean; error?: string; authorizeUrl?: string }> {
        const config = getOAuthConfig();

        if (!config.clientId) {
            const err = 'CLIENT_ID não configurado. Defina nas configurações do OAuth.';
            this.emit({ status: 'error', profileId, error: err });
            return { success: false, error: err };
        }

        // Cancel any existing flow for this profile
        this.cancelFlow(profileId);

        const pkce = generatePKCE();
        this.pendingPKCE.set(profileId, pkce);

        const authorizeUrl = this.buildAuthorizeUrl(pkce);
        logger.info({ profileId, authorizeUrl: authorizeUrl.replace(/code_challenge=[^&]+/, 'code_challenge=***') }, 'Starting OAuth login');

        // Try to start the loopback server
        let serverResult: { promise: Promise<{ code: string; state: string }>; cancel: () => void };
        let useManualMode = false;

        try {
            serverResult = startOAuthCallbackServer({
                port: config.loopbackPort,
                timeoutMs: config.callbackTimeoutMs,
                expectedState: pkce.state,
            });
            this.activeServers.set(profileId, serverResult.cancel);
        } catch (_err) {
            logger.warn('Cannot start loopback server — falling back to manual mode');
            useManualMode = true;
            this.emit({ status: 'awaiting_callback', profileId, authorizeUrl });
            // Open browser anyway
            shell.openExternal(authorizeUrl).catch(() => { });
            return { success: false, error: 'PORT_UNAVAILABLE', authorizeUrl };
        }

        this.emit({ status: 'awaiting_callback', profileId, authorizeUrl });

        // Open browser
        shell.openExternal(authorizeUrl).catch((err) => {
            logger.warn({ err }, 'Failed to open browser — user can use manual mode');
        });

        if (useManualMode) {
            return { success: false, error: 'PORT_UNAVAILABLE', authorizeUrl };
        }

        // Wait for callback
        try {
            const { code } = await serverResult!.promise;
            return this.exchangeCodeForTokens(profileId, label, code, pkce.codeVerifier);
        } catch (err: any) {
            const msg = err?.message || 'OAuth flow failed';
            logger.error({ profileId, err }, 'OAuth flow error');
            this.emit({ status: 'error', profileId, error: msg });
            return { success: false, error: msg };
        } finally {
            this.activeServers.delete(profileId);
            this.pendingPKCE.delete(profileId);
        }
    }

    /**
     * Manual fallback: user pastes the redirect URL or bare code.
     */
    async finishLoginManual(
        profileId: string,
        codeOrUrl: string,
        label: string = 'Personal'
    ): Promise<{ success: boolean; error?: string }> {
        const code = extractCodeFromUrl(codeOrUrl);
        if (!code) {
            return { success: false, error: 'Código inválido. Cole a URL completa de redirect ou apenas o código.' };
        }

        const pkce = this.pendingPKCE.get(profileId);
        if (!pkce) {
            return { success: false, error: 'Nenhum fluxo de login pendente. Clique em "Conectar" primeiro.' };
        }

        // Cancel the loopback server if still running
        const cancel = this.activeServers.get(profileId);
        if (cancel) {
            cancel();
            this.activeServers.delete(profileId);
        }

        const result = await this.exchangeCodeForTokens(profileId, label, code, pkce.codeVerifier);
        this.pendingPKCE.delete(profileId);
        return result;
    }

    /**
     * Exchange authorization code for tokens.
     */
    private async exchangeCodeForTokens(
        profileId: string,
        label: string,
        code: string,
        codeVerifier: string
    ): Promise<{ success: boolean; error?: string }> {
        this.emit({ status: 'exchanging_code', profileId });

        const config = getOAuthConfig();

        try {
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: config.redirectUri,
                client_id: config.clientId,
                code_verifier: codeVerifier,
            });

            const response = await fetch(config.tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'unknown' }));
                const errorMsg = errorData.error_description || errorData.error || `HTTP ${response.status}`;
                logger.error({ profileId, status: response.status, error: errorMsg }, 'Token exchange failed');
                this.emit({ status: 'error', profileId, error: errorMsg });
                return { success: false, error: errorMsg };
            }

            const data = await response.json();

            // Check for required scopes
            const grantedScopes = (data.scope || '').split(' ');
            logger.info({ profileId, grantedScopes }, 'DEBUG: Received scopes from OpenAI');

            const missingScopes = REQUIRED_MODEL_SCOPES.filter((s) => !grantedScopes.includes(s));

            if (missingScopes.length > 0 && data.scope) {
                const scopeWarning = `Scopes insuficientes. Faltam: ${missingScopes.join(', ')}. As chamadas de modelo podem falhar. Tente fazer login novamente com os scopes corretos.`;
                logger.warn({ profileId, missingScopes, grantedScopes }, 'Missing required scopes');
                // Still save the token — but warn the user
            }

            const expiresIn = data.expires_in || 3600;
            const expiresAt = Date.now() + expiresIn * 1000;

            // ChatGPT workspace id (sent as `ChatGPT-Account-Id`). It is the
            // `chatgpt_account_id` claim, not the JWT `sub`/email.
            const accountId =
                extractChatGptAccountId(data.id_token) || extractChatGptAccountId(data.access_token);

            const profile: AuthProfile = {
                profileId,
                label,
                provider: 'openai-codex',
                accessToken: data.access_token,
                refreshToken: data.refresh_token || '',
                expiresAt,
                accountId,
            };

            this.tokenStore.saveProfile(profile);

            // Set as active if it's the first profile
            if (!this.tokenStore.getActiveProfileId()) {
                this.tokenStore.setActiveProfileId(profileId);
            }

            logger.info(
                { profileId, token: maskToken(data.access_token), expiresIn, accountId },
                'OAuth login successful'
            );

            this.emit({ status: 'connected', profileId });

            if (missingScopes.length > 0 && data.scope) {
                return {
                    success: true,
                    error: `Aviso: Scopes insuficientes (${missingScopes.join(', ')}). Chamadas de modelo podem falhar.`,
                };
            }

            return { success: true };
        } catch (err: any) {
            const msg = err?.message || 'Token exchange failed';
            logger.error({ profileId, err }, 'Token exchange error');
            this.emit({ status: 'error', profileId, error: msg });
            return { success: false, error: msg };
        }
    }

    /**
     * Log out: remove profile tokens.
     */
    logout(profileId: string): void {
        this.cancelFlow(profileId);
        this.tokenStore.removeProfile(profileId);
        this.emit({ status: 'idle', profileId });
        logger.info({ profileId }, 'OAuth logout');
    }

    /**
     * Cancel an in-progress flow.
     */
    cancelFlow(profileId: string): void {
        const cancel = this.activeServers.get(profileId);
        if (cancel) {
            cancel();
            this.activeServers.delete(profileId);
        }
        this.pendingPKCE.delete(profileId);
    }

    /**
     * Get a valid access token (auto-refreshes if needed).
     */
    async getAccessToken(profileId?: string): Promise<string> {
        return this.tokenRefresher.getValidAccessToken(profileId);
    }

    /**
     * Get status of a profile's auth connection.
     */
    getStatus(profileId?: string): {
        connected: boolean;
        profileId: string | null;
        expiresAt?: number;
        accountId?: string;
        flowStatus: AuthFlowStatus;
    } {
        const id = profileId || this.tokenStore.getActiveProfileId();
        if (!id) {
            return { connected: false, profileId: null, flowStatus: 'idle' };
        }

        const profile = this.tokenStore.getProfile(id);
        const flowState = this.getFlowState(id);

        if (!profile) {
            return { connected: false, profileId: id, flowStatus: flowState.status };
        }

        return {
            connected: true,
            profileId: id,
            expiresAt: profile.expiresAt,
            accountId: profile.accountId,
            flowStatus: flowState.status,
        };
    }
}

// Singleton
let _controller: OpenAIOAuthController | null = null;

export function getOAuthController(): OpenAIOAuthController {
    if (!_controller) {
        _controller = new OpenAIOAuthController();
    }
    return _controller;
}
