export type SubtitleSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type SubtitleExportFormat = 'vtt' | 'srt' | 'both';

/** `vosk`: offline (default). `codex`: ChatGPT/Codex login, sent to OpenAI. */
export type TranscribeFileEngine = 'vosk' | 'codex';

export type TranscribeFileRequest = {
  wavPath: string;
  language?: string;
  exportFormat?: SubtitleExportFormat;
  engine?: TranscribeFileEngine;
};

export type TranscribeProgress = {
  percent: number;
  currentTimeMs: number;
  textPartial?: string;
};

export type TranscribeDone = {
  vttPath?: string;
  srtPath?: string;
  segmentsCount: number;
};
