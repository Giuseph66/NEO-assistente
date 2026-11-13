import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { existsSync } from 'fs';
import { join, parse } from 'path';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';
import { SubtitleSegment, TranscribeProgress } from '@neo/shared';
import { getLogger } from '@neo/logger';
import { segmentWords } from './SubtitleSegmenter';
import { writeSubtitleFiles } from './subtitleFiles';

const logger = getLogger();

type TranscribeRequest = {
  wavPath: string;
  modelPath: string;
  exportFormat?: 'vtt' | 'srt' | 'both';
};

type TranscribeResult = {
  segments: SubtitleSegment[];
  vttPath?: string;
  srtPath?: string;
};

export class FileTranscriber {
  private emitter = new EventEmitter();

  onProgress(cb: (progress: TranscribeProgress) => void): () => void {
    this.emitter.on('progress', cb);
    return () => this.emitter.off('progress', cb);
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    const workerPath = this.resolveWorkerPath();
    const worker = new Worker(workerPath);

    const result = await new Promise<{ words: { word: string; start: number; end: number }[] }>(
      (resolve, reject) => {
        const handleMessage = (message: any) => {
          if (message.type === 'progress') {
            this.emitter.emit('progress', message.payload as TranscribeProgress);
          }
          if (message.type === 'error') {
            worker.off('message', handleMessage);
            worker.terminate();
            reject(new Error(message.payload?.message || 'Erro ao transcrever'));
          }
          if (message.type === 'done') {
            worker.off('message', handleMessage);
            worker.terminate();
            resolve({ words: message.payload?.words || [] });
          }
        };
        worker.on('message', handleMessage);
        worker.on('error', (error) => reject(error));
        worker.postMessage({ type: 'start', payload: request });
      }
    );

    const segments = segmentWords(result.words);
    const { vttPath, srtPath } = await writeSubtitleFiles(
      parse(request.wavPath).name,
      segments,
      request.exportFormat || 'both'
    );

    return { segments, vttPath, srtPath };
  }

  private resolveWorkerPath(): string {
    let workerPath = join(__dirname, 'stt/workers/fileTranscriberWorker.js');

    if (!existsSync(workerPath) && is.dev) {
      const appPath = app.getAppPath();
      const devPath = join(appPath, 'dist/main/stt/workers/fileTranscriberWorker.js');
      if (existsSync(devPath)) {
        workerPath = devPath;
      }
    }

    if (!existsSync(workerPath) && !is.dev) {
      const appPath = app.getAppPath();
      workerPath = join(appPath, 'dist/main/stt/workers/fileTranscriberWorker.js');
    }

    if (!existsSync(workerPath)) {
      logger.error({ workerPath }, 'File transcriber worker not found');
      throw new Error(`Worker file not found: ${workerPath}`);
    }

    return workerPath;
  }
}
