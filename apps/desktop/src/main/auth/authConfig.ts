/**
 * OAuth Configuration for OpenAI
 * All values configurable — no hardcoded secrets.
 * Electron is a public OAuth client → PKCE only, never client_secret.
 */

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  clientId: string;
  audience: string;
  scopes: string[];
  loopbackPort: number;
  callbackTimeoutMs: number;
}

/**
 * Public client_id from codex_cli — used by OpenClaw, open-hax/codex, etc.
 * Allows ChatGPT Plus/Pro subscribers to authenticate directly.
 */
const CODEX_CLI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const DEFAULT_CONFIG: OAuthConfig = {
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectUri: 'http://localhost:1455/auth/callback',
  clientId: CODEX_CLI_CLIENT_ID,
  audience: 'https://api.openai.com/v1',
  scopes: [
    'openid',
    'profile',
    'email',
    'offline_access',
  ],
  loopbackPort: 1455,
  callbackTimeoutMs: 5 * 60 * 1000, // 5 minutes
};

let _config: OAuthConfig = { ...DEFAULT_CONFIG };

const ALLOWED_SCOPES = new Set([
  'openid',
  'profile',
  'email',
  'offline_access',
]);

function normalizeScopes(scopes: string[] | undefined): string[] {
  const source = Array.isArray(scopes) ? scopes : DEFAULT_CONFIG.scopes;
  const cleaned = Array.from(
    new Set(
      source
        .map((scope) => String(scope || '').trim())
        .filter((scope) => scope.length > 0 && ALLOWED_SCOPES.has(scope))
    )
  );

  // Garantimos o mínimo necessário para chamadas de modelo.
  for (const required of REQUIRED_MODEL_SCOPES) {
    if (!cleaned.includes(required)) {
      cleaned.push(required);
    }
  }

  return cleaned;
}

export function getOAuthConfig(): OAuthConfig {
  return { ..._config, scopes: normalizeScopes(_config.scopes) };
}

export function updateOAuthConfig(patch: Partial<OAuthConfig>): OAuthConfig {
  _config = {
    ...DEFAULT_CONFIG,
    ..._config,
    ...patch,
    scopes: normalizeScopes(patch.scopes ?? _config.scopes),
  };
  return { ..._config };
}

export function resetOAuthConfig(): OAuthConfig {
  _config = { ...DEFAULT_CONFIG, scopes: normalizeScopes(DEFAULT_CONFIG.scopes) };
  return { ..._config };
}

/** Scopes that codex_cli requires for model access */
export const REQUIRED_MODEL_SCOPES = ['openid', 'offline_access'];
