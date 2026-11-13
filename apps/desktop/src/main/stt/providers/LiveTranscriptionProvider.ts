import type {
  LiveTranscriptionProviderId,
  STTConfig,
  STTFinalEvent,
  STTPartialEvent,
  STTStatus,
} from '@neo/shared';

/**
 * How clip-based providers cut the stream into utterances. Mic speech has clear
 * pauses; system audio (videos, calls, music beds) rarely does, so it needs a
 * shorter pause and a shorter cap to keep latency low.
 */
export type SegmentationProfile = {
  silenceMs?: number;
  maxSegmentMs?: number;
  minSpeechMs?: number;
};

export const SYSTEM_AUDIO_SEGMENTATION: SegmentationProfile = {
  silenceMs: 400,
  maxSegmentMs: 7000,
};

export type LiveTranscriptionProviderConfig = STTConfig & {
  apiKey?: string;
  modelName?: string;
  modelPath?: string;
  segmentation?: SegmentationProfile;
};

export type LiveTranscriptionError = {
  message: string;
  debug?: string;
  code?: string;
  providerId?: LiveTranscriptionProviderId;
};

export interface LiveTranscriptionProvider {
  id: LiveTranscriptionProviderId;
  start(config: LiveTranscriptionProviderConfig): Promise<void>;
  pushAudio(chunk: Buffer): void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  onPartial(cb: (event: STTPartialEvent) => void): () => void;
  onFinal(cb: (event: STTFinalEvent) => void): () => void;
  onStatus(cb: (status: STTStatus) => void): () => void;
  onError(cb: (error: LiveTranscriptionError) => void): () => void;
  onDebug?(cb: (message: string) => void): () => void;
}
