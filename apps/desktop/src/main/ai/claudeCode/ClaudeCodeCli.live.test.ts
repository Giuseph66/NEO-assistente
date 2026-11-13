import { describe, expect, it } from 'vitest';
import { ClaudeCodeCli } from './ClaudeCodeCli';

// Real call through the user's Claude Code login (uses subscription quota).
// Run with: NEO_LIVE_CLAUDE=1 pnpm --filter neo-desktop test ClaudeCodeCli.live
describe.runIf(process.env.NEO_LIVE_CLAUDE === '1')('Claude Code CLI (live)', () => {
  it('answers through the subscription login', async () => {
    const cli = new ClaudeCodeCli();
    const status = await cli.getAuthStatus();
    expect(status).toMatchObject({ installed: true, loggedIn: true });
    const result = await cli.run({ prompt: 'Quanto é 17 + 25? Responda só o número.', model: 'claude-haiku-5-5', effort: 'low' });
    expect(result.text).toContain('42');
  }, 120_000);
});
