/**
 * Helpers for the ChatGPT ("Sign in with ChatGPT" / Codex) OAuth tokens.
 *
 * The ChatGPT backend identifies the workspace through the `ChatGPT-Account-Id`
 * header. Its value is the `chatgpt_account_id` claim that OpenAI puts inside
 * the `https://api.openai.com/auth` namespace of both the id_token and the
 * access_token. It is NOT the JWT `sub` (user id) nor the email.
 */

const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';

export function decodeJwtPayload(token: string | undefined | null): Record<string, any> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    // Node's base64 decoder also accepts the base64url alphabet and missing padding.
    const json = Buffer.from(parts[1], 'base64').toString('utf-8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export function extractChatGptAccountId(token: string | undefined | null): string | undefined {
  const payload = decodeJwtPayload(token);
  const claims = payload?.[OPENAI_AUTH_CLAIM];
  const accountId = claims?.chatgpt_account_id;
  return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
}

/**
 * Resolves the account id for a request: the access token is the source of truth
 * (it is always current, also after a refresh); the stored profile value is a
 * fallback for tokens that do not carry the claim.
 */
export function resolveChatGptAccountId(
  accessToken: string,
  storedAccountId?: string
): string | undefined {
  return extractChatGptAccountId(accessToken) || storedAccountId || undefined;
}
