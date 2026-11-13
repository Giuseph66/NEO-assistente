export type STTLanguage = 'pt-BR' | 'en-US' | string;

export type LiveTranscriptionProviderId =
  | 'vox'
  | 'vosk'
  | 'openai_realtime_transcribe'
  | 'gemini_live'
  | 'codex_transcribe';

export type ModelDescriptor = {
  id: string;
  language: STTLanguage;
  label: string;
  sizeMB?: number;
  accuracyHint?: string;
  source: 'bundled' | 'remote' | 'localPath';
  url?: string;
  sha256?: string;
  defaultSampleRate?: number;
};

export type InstalledModel = ModelDescriptor & {
  installed: true;
  installPath: string;
  installedAt: number;
};

export type STTConfig = {
  provider: LiveTranscriptionProviderId;
  modelId: string;
  sampleRate: number;
  enablePartial: boolean;
  partialDebounceMs: number;
  maxSegmentSeconds: number;
};

export type STTPartialEvent = {
  text: string;
  confidence?: number;
  ts: number;
  meta?: {
    providerId?: LiveTranscriptionProviderId;
    language?: STTLanguage;
    logprobs?: number[];
    startMs?: number;
    endMs?: number;
  };
};

export type STTFinalEvent = {
  text: string;
  confidence?: number;
  ts: number;
  meta?: {
    providerId?: LiveTranscriptionProviderId;
    language?: STTLanguage;
    logprobs?: number[];
    startMs?: number;
    endMs?: number;
  };
};

export type STTStatus =
  | { state: 'idle' }
  | { state: 'starting'; providerId?: LiveTranscriptionProviderId }
  | { state: 'listening'; providerId?: LiveTranscriptionProviderId; modelId?: string; language?: STTLanguage }
  | { state: 'running'; providerId?: LiveTranscriptionProviderId; modelId?: string; language?: STTLanguage }
  | { state: 'finalizing'; providerId?: LiveTranscriptionProviderId }
  | { state: 'stopping' }
  | { state: 'error'; message: string; providerId?: LiveTranscriptionProviderId; debug?: string };
