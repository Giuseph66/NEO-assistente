import { getOAuthController } from './openaiOAuth';
import { resolveChatGptAccountId } from './chatgptAccount';

export type CodexCredentials = {
  accessToken: string;
  accountId?: string;
};

export class CodexNotConnectedError extends Error {
  readonly code = 'CODEX_NOT_CONNECTED';
  readonly statusCode = 401;
  constructor() {
    super('Login ChatGPT (OAuth Codex) não conectado. Faça login em Configurações > API e Modelos > OpenAI.');
  }
}

/**
 * Returns a valid (auto-refreshed) access token of the active ChatGPT/Codex profile
 * plus its ChatGPT account id.
 */
export async function getCodexCredentials(): Promise<CodexCredentials> {
  const controller = getOAuthController();
  const store = controller.getTokenStore();
  const active = store
    .listProfiles()
    .find((profile) => profile.isActive && profile.isEnabled && !profile.isExpired);
  const profileId = active?.profileId || store.getActiveProfileId();
  if (!profileId) {
    throw new CodexNotConnectedError();
  }

  let accessToken: string;
  try {
    accessToken = await controller.getAccessToken(profileId);
  } catch {
    throw new CodexNotConnectedError();
  }
  if (!accessToken) {
    throw new CodexNotConnectedError();
  }

  const profile = store.getProfile(profileId);
  return {
    accessToken,
    accountId: resolveChatGptAccountId(accessToken, profile?.accountId),
  };
}
