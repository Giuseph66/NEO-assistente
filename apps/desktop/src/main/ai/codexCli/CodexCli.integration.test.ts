import http from 'http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodexCli } from './CodexCli';

/**
 * Runs the REAL `codex` binary (no subscription quota used) against a local fake of the
 * Responses API, and inspects the request it sends. This is what proves the isolation:
 * the user's real Codex home (AGENTS.md, config, skills) must not reach the model.
 */
const installed = new CodexCli().resolveBinary() !== null;

const sse = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

describe.runIf(installed)('Codex CLI against a local fake model server', () => {
  let server: http.Server;
  let port = 0;
  const requests: any[] = [];
  let answer = 'resposta falsa';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (!req.url?.includes('/responses')) {
          res.writeHead(404);
          res.end('{}');
          return;
        }
        requests.push(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(sse('response.created', { response: { id: 'resp_1' } }));
        res.write(sse('response.output_item.done', { item: { type: 'message', role: 'assistant', id: 'm1', content: [{ type: 'output_text', text: answer }] } }));
        res.end(sse('response.completed', { response: { id: 'resp_1', usage: { input_tokens: 11, input_tokens_details: null, output_tokens: 3, output_tokens_details: null, total_tokens: 14 } } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as any).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function cli() {
    const base = mkdtempSync(join(tmpdir(), 'neo-codex-it-'));
    const realHome = join(base, 'real');
    mkdirSync(realHome);
    // The user's personal Codex setup — none of this may be sent.
    writeFileSync(join(realHome, 'AGENTS.md'), '# Global\nSEGREDO-NAO-VAZAR: responda sempre como um pirata.');
    writeFileSync(join(realHome, 'config.toml'), 'model_instructions_file = "/nonexistent"\n# SEGREDO-NAO-VAZAR');
    mkdirSync(join(realHome, 'skills', 'minha-skill'), { recursive: true });
    writeFileSync(join(realHome, 'skills', 'minha-skill', 'SKILL.md'), '---\nname: minha-skill\ndescription: SEGREDO-NAO-VAZAR\n---\n');
    return new CodexCli({
      realHome,
      privateHome: join(base, 'private'),
      workRoot: base,
      extraConfig: [
        'model_provider="fake"',
        `model_providers.fake={ name = "fake", base_url = "http://127.0.0.1:${port}/v1", wire_api = "responses", requires_openai_auth = false }`,
      ],
    });
  }

  it('answers, reports usage and sends only the app prompt (nothing from the user home)', async () => {
    requests.length = 0;
    answer = '42';
    const result = await cli().run({
      prompt: 'Quanto é 17 + 25?',
      systemPrompt: 'MARCADOR-DO-APP: responda só com o número.',
      model: 'gpt-6.1-sol',
      effort: 'low',
    });

    expect(result.text).toBe('42');
    expect(result.outputTokens).toBe(3);
    expect(requests).toHaveLength(1);

    const body = JSON.stringify(requests[0]);
    expect(body).toContain('MARCADOR-DO-APP'); // the app's own system prompt replaced Codex's
    expect(body).toContain('Quanto é 17 + 25?');
    expect(body).not.toContain('SEGREDO-NAO-VAZAR');
    // header Codex puts above a loaded AGENTS.md (its own built-in text merely *mentions* the file)
    expect(body).not.toContain('# AGENTS.md instructions');
    expect(body).not.toContain('skills_instructions');
    expect(body).not.toContain('<environment_context>');
    expect(body).not.toContain('You are Codex, an agent');
    expect(body.length).toBeLessThan(45_000); // was ~81k with the stock setup
    expect(requests[0].model).toBe('gpt-6.1-sol');
    expect(requests[0].reasoning?.effort).toBe('low');
  }, 60_000);

  it('attaches an image to the request', async () => {
    requests.length = 0;
    answer = 'um pixel';
    // 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const result = await cli().run({ prompt: 'descreva', image: { data: png, extension: 'png' } });
    expect(result.text).toBe('um pixel');
    expect(JSON.stringify(requests[0])).toContain('data:image/png;base64');
  }, 60_000);
});
