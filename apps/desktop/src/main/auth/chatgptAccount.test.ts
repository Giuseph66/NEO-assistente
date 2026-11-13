import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, extractChatGptAccountId, resolveChatGptAccountId } from './chatgptAccount';
import { fakeChatGptJwt } from '../testing/fixtures';

describe('chatgptAccount', () => {
  it('reads chatgpt_account_id from the OpenAI auth claim (not sub/email)', () => {
    expect(extractChatGptAccountId(fakeChatGptJwt('acct-abc'))).toBe('acct-abc');
  });

  it('returns undefined for tokens without the claim or malformed tokens', () => {
    const noClaim = [
      Buffer.from('{}').toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url'),
      'sig',
    ].join('.');
    expect(extractChatGptAccountId(noClaim)).toBeUndefined();
    expect(extractChatGptAccountId('not-a-jwt')).toBeUndefined();
    expect(extractChatGptAccountId(undefined)).toBeUndefined();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
  });

  it('prefers the token claim over a stored (possibly stale) account id', () => {
    expect(resolveChatGptAccountId(fakeChatGptJwt('acct-new'), 'user-xyz')).toBe('acct-new');
    expect(resolveChatGptAccountId('opaque-token', 'acct-stored')).toBe('acct-stored');
  });
});
