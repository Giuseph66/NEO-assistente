import { z } from 'zod';

export const STTConfigSchema = z.object({
  provider: z.enum(['vosk', 'vox', 'openai_realtime_transcribe', 'gemini_live', 'codex_transcribe']),
  modelId: z.string(),
  sampleRate: z.number().int().positive(),
  enablePartial: z.boolean(),
  partialDebounceMs: z.number().int().min(0),
  maxSegmentSeconds: z.number().int().min(1),
});

export const ModelDescriptorSchema = z.object({
  id: z.string().min(1),
  language: z.string().min(1),
  label: z.string().min(1),
  sizeMB: z.number().optional(),
  accuracyHint: z.string().optional(),
  source: z.enum(['bundled', 'remote', 'localPath']),
  url: z.string().url().optional(),
  sha256: z.string().optional(),
  defaultSampleRate: z.number().int().optional(),
});

export const InstalledModelSchema = ModelDescriptorSchema.extend({
  installed: z.literal(true),
  installPath: z.string().min(1),
  installedAt: z.number(),
});
