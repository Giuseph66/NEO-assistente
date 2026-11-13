import type { LiveTranscriptionProviderId } from '@neo/shared';
import type { LiveTranscriptionProvider } from './LiveTranscriptionProvider';
import { VoskLiveProvider } from './VoskLiveProvider';
import { OpenAIRealtimeTranscriptionProvider } from './OpenAIRealtimeTranscriptionProvider';
import { GeminiLiveTranscriptionProvider } from './GeminiLiveTranscriptionProvider';
import { CodexTranscriptionProvider } from './CodexTranscriptionProvider';

export const normalizeLiveProviderId = (
  providerId: LiveTranscriptionProviderId
): LiveTranscriptionProviderId => {
  if (providerId === 'vosk') return 'vox';
  return providerId;
};

export const createLiveTranscriptionProvider = (
  providerId: LiveTranscriptionProviderId
): LiveTranscriptionProvider => {
  const normalized = normalizeLiveProviderId(providerId);
  switch (normalized) {
    case 'openai_realtime_transcribe':
      return new OpenAIRealtimeTranscriptionProvider();
    case 'gemini_live':
      return new GeminiLiveTranscriptionProvider();
    case 'codex_transcribe':
      return new CodexTranscriptionProvider();
    case 'vox':
    default:
      return new VoskLiveProvider();
  }
};
