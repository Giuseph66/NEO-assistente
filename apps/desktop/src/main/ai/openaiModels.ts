import type { ModelInfo } from '@neo/shared';

/**
 * Current OpenAI model line, taken from the catalog of the signed-in account
 * (`codex debug models`, every entry has `supported_in_api: true`). With an API key the
 * settings screen lists the live `/v1/models` response instead; this is the offline list.
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-6.1-sol';
export const OPENAI_DEFAULT_MAX_TOKENS = 32_000;

const entry = (id: string, name: string, category: string): Omit<ModelInfo, 'provider'> => ({
  id,
  name,
  supportsVision: true,
  maxTokens: OPENAI_DEFAULT_MAX_TOKENS,
  supportsStreaming: true,
  metadata: { category },
});

export const OPENAI_CURRENT_MODELS: Array<Omit<ModelInfo, 'provider'>> = [
  entry('gpt-6.1-sol', 'GPT-6.1 Sol', 'GPT-6.1'),
  entry('gpt-6.1-terra', 'GPT-6.1 Terra', 'GPT-6.1'),
  entry('gpt-6-sol', 'GPT-6 Sol', 'GPT-6'),
  entry('gpt-6-astra', 'GPT-6 Astra', 'GPT-6'),
  entry('gpt-6-luna', 'GPT-6 Luna', 'GPT-6'),
  entry('gpt-5.6-sol', 'GPT-5.6 Sol', 'GPT-5.6'),
  entry('gpt-5.6-terra', 'GPT-5.6 Terra', 'GPT-5.6'),
  entry('gpt-5.6-luna', 'GPT-5.6 Luna', 'GPT-5.6'),
];

const NOT_CHAT = /embedding|whisper|tts|transcribe|realtime|audio|image|dall-e|moderation|search|computer-use|davinci|babbage|instruct|sora|codex-mini-latest/i;

/** `/v1/models` also lists embeddings, speech, image and legacy models: keep chat models, newest first. */
export function filterOpenAIChatModelIds(ids: string[]): string[] {
  const chat = Array.from(new Set(ids)).filter((id) => /^(gpt-|o\d)/i.test(id) && !NOT_CHAT.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id));
  return chat.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
