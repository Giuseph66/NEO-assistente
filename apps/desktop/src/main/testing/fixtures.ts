/** Synthetic mono PCM16 audio for tests: tones stand in for speech, zeros for silence. */
export function tone(ms: number, sampleRate = 16000, amplitude = 8000, hz = 220): Buffer {
  const samples = Math.round((sampleRate * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate)), i * 2);
  }
  return buf;
}

export function silence(ms: number, sampleRate = 16000): Buffer {
  return Buffer.alloc(Math.round((sampleRate * ms) / 1000) * 2);
}

/** Fake JWT carrying the ChatGPT account claim (signature is irrelevant client-side). */
export function fakeChatGptJwt(accountId = 'acct-123', extra: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({ sub: 'user-xyz', email: 'u@example.com', 'https://api.openai.com/auth': { chatgpt_account_id: accountId }, ...extra }),
    'signature',
  ].join('.');
}
