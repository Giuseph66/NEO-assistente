import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { CodexCli } from './CodexCli';

// Real call through the user's Codex login (uses subscription quota).
// Run with: NEO_LIVE_CODEX=1 pnpm --filter neo-desktop test CodexCli.live
const authHash = () =>
  createHash('sha256').update(readFileSync(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json'))).digest('hex');

describe.runIf(process.env.NEO_LIVE_CODEX === '1')('Codex CLI (live)', () => {
  it('lists models and answers through the subscription login without touching the login file', async () => {
    const cli = new CodexCli({ privateHome: join(tmpdir(), 'neo-codex-live-home') });
    const before = authHash();

    const status = await cli.getAuthStatus();
    expect(status).toMatchObject({ installed: true, loggedIn: true, authMethod: 'chatgpt' });

    const models = await cli.listModels();
    expect(models.length).toBeGreaterThan(0);
    const model = models.find((m) => /luna/.test(m.id))?.id ?? models[0].id;

    // Either an answer or — when the account is out of quota — a clear rate_limited error.
    const outcome = await cli
      .run({ prompt: 'Quanto é 17 + 25? Responda só o número.', model, effort: 'low' })
      .then((r) => ({ ok: true as const, text: r.text }))
      .catch((e) => ({ ok: false as const, code: e.code as string }));
    if (outcome.ok) expect(outcome.text).toContain('42');
    else expect(['rate_limited']).toContain(outcome.code);

    expect(authHash()).toBe(before);
  }, 180_000);
});
