import { EventEmitter } from 'events';
import { join, resolve } from 'path';
import { mkdir, stat, unlink } from 'fs/promises';
import { app, shell } from 'electron';
import { getLogger } from '@neo/logger';
import { RecordingEntry, RecorderStartOptions, RecorderStatus } from '@neo/shared';
import { DatabaseManager } from '../../database';
import { SystemAudioCapture } from '../system/SystemAudioCapture';
import { WavWriter } from './WavWriter';
import { pathToFileURL } from 'url';

const logger = getLogger();

const isWithinDir = (baseDir: string, targetPath: string): boolean => {
  const base = resolve(baseDir) + '/';
  const target = resolve(targetPath);
  return target.startsWith(base);
};

export class RecorderService {
  private emitter = new EventEmitter();
  private capture: SystemAudioCapture | null = null;
  private writer: WavWriter | null = null;
  private status: RecorderStatus = { state: 'idle', bytesWritten: 0 };
  private statsTimer: NodeJS.Timeout | null = null;
  private lastBytes = 0;
  private silentTicks = 0;
  private startedAt = 0;
  private currentPath: string | null = null;
  private currentSourceId: string | null = null;
  private readonly sampleRate = 16000;
  private readonly channels = 1;
  private level = 0;
  private lastLevelAt = 0;

  constructor(private db: DatabaseManager) {}

  getStatus(): RecorderStatus {
    return this.status;
  }

  onStatus(cb: (status: RecorderStatus) => void): () => void {
    this.emitter.on('status', cb);
    return () => this.emitter.off('status', cb);
  }

  onError(cb: (message: string) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }

  onAudio(cb: (chunk: Buffer) => void): () => void {
    this.emitter.on('audio', cb);
    return () => this.emitter.off('audio', cb);
  }

  onLevel(cb: (payload: { level: number; rms: number; ts: number }) => void): () => void {
    this.emitter.on('level', cb);
    return () => this.emitter.off('level', cb);
  }

  getRecordingsDir(): string {
    return join(app.getPath('userData'), 'recordings');
  }

  async start(options: RecorderStartOptions): Promise<RecorderStatus> {
    if (this.status.state === 'recording') {
      return this.status;
    }
    if (!options.sourceId) {
      throw new Error('Selecione um dispositivo de audio');
    }

    await mkdir(this.getRecordingsDir(), { recursive: true });

    const safeName = options.name
      ? options.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_')
      : '';
    const filename = safeName
      ? `${safeName}.wav`
      : `system_${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    const outputPath = options.outPath || join(this.getRecordingsDir(), filename);
    if (options.outPath && !isWithinDir(this.getRecordingsDir(), outputPath)) {
      throw new Error('Caminho invalido para gravacao');
    }

    this.capture = new SystemAudioCapture();
    this.writer = new WavWriter(outputPath, this.sampleRate, this.channels);
    await this.writer.init();

    this.startedAt = Date.now();
    this.currentPath = outputPath;
    this.currentSourceId = options.sourceId;
    this.silentTicks = 0;
    this.level = 0;
    this.lastLevelAt = 0;
    this.status = {
      state: 'recording',
      bytesWritten: 0,
      path: outputPath,
      sourceId: options.sourceId,
    };
    this.emitStatus();

    this.capture.onData((chunk) => {
      this.emitter.emit('audio', chunk);
      this.updateLevel(chunk);
      this.writer
        ?.write(chunk)
        .then(() => {
          this.status = {
            ...this.status,
            bytesWritten: this.writer?.getBytesWritten() || 0,
          };
        })
        .catch((error) => this.handleError(error));
    });

    this.capture.onError((error) => this.handleError(error));

    await this.capture.start({ sourceId: options.sourceId, sampleRate: this.sampleRate });
    this.startStatsTimer();

    return this.status;
  }

  async stop(): Promise<RecorderStatus> {
    if (this.status.state !== 'recording') {
      return this.status;
    }

    this.status = { ...this.status, state: 'stopping' };
    this.emitStatus();

    await this.capture?.stop();
    this.capture = null;
    this.stopStatsTimer();

    await this.writer?.finalize();

    const bytes = this.writer?.getBytesWritten() || 0;
    const durationMs = Math.round((bytes / (this.sampleRate * this.channels * 2)) * 1000);
    const path = this.currentPath;
    const sourceId = this.currentSourceId;

    if (path) {
      try {
        this.db.saveRecording({
          path,
          sourceType: 'system',
          sourceId: sourceId || null,
          createdAt: this.startedAt || Date.now(),
          sampleRate: this.sampleRate,
          channels: this.channels,
          bytes,
          durationMs,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to save recording metadata');
      }
    }

    this.writer = null;
    this.startedAt = 0;
    this.currentPath = null;
    this.currentSourceId = null;
    this.level = 0;
    this.lastLevelAt = 0;
    this.emitter.emit('level', { level: 0, rms: 0, ts: Date.now() });
    this.status = { state: 'idle', bytesWritten: 0, path: path || undefined };
    this.emitStatus();

    return this.status;
  }

  listRecent(limit: number = 10): RecordingEntry[] {
    return this.db.listRecordings(limit, 'system');
  }

  async deleteRecording(path: string): Promise<void> {
    const record = this.db.getRecordingByPath(path);
    if (record) {
      const subtitles = this.db.getRecordingSubtitles(record.id);
      this.db.deleteRecording(record.id);
      if (subtitles?.vtt_path) {
        await unlink(subtitles.vtt_path).catch(() => undefined);
      }
      if (subtitles?.srt_path) {
        await unlink(subtitles.srt_path).catch(() => undefined);
      }
    }
    try {
      await unlink(path);
    } catch (error) {
      logger.warn({ err: error, path }, 'Failed to delete recording file');
    }
  }

  async openFolder(): Promise<void> {
    await shell.openPath(this.getRecordingsDir());
  }

  async openFile(path: string): Promise<void> {
    await shell.openPath(path);
  }

  async getFileUrl(path: string): Promise<string> {
    if (!isWithinDir(this.getRecordingsDir(), path)) {
      throw new Error('Caminho fora da pasta de gravacoes');
    }
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error('Arquivo invalido');
    }
    return pathToFileURL(path).toString();
  }

  private emitStatus(): void {
    this.emitter.emit('status', this.status);
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Erro ao gravar';
    logger.error({ err: error }, 'Recorder error');
    this.status = { state: 'error', bytesWritten: this.status.bytesWritten || 0, message };
    this.emitter.emit('error', message);
    this.level = 0;
    this.lastLevelAt = 0;
    this.emitter.emit('level', { level: 0, rms: 0, ts: Date.now() });
    this.emitStatus();
  }

  private startStatsTimer(): void {
    if (this.statsTimer) return;
    this.lastBytes = 0;
    this.statsTimer = setInterval(() => {
      if (this.status.state !== 'recording') return;
      const bytes = this.writer?.getBytesWritten() || 0;
      const delta = bytes - this.lastBytes;
      this.lastBytes = bytes;
      this.status = { ...this.status, bytesWritten: bytes };
      this.emitter.emit('status', { ...this.status, bytesWritten: bytes });
      if (delta === 0) {
        this.silentTicks += 1;
        if (this.silentTicks === 3) {
          this.emitter.emit('error', 'Sem audio sendo capturado');
        }
      } else {
        this.silentTicks = 0;
      }
    }, 1000);
  }

  private stopStatsTimer(): void {
    if (!this.statsTimer) return;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private updateLevel(chunk: Buffer): void {
    const now = Date.now();
    if (chunk.length < 2) return;
    let sumSquares = 0;
    const sampleCount = Math.floor(chunk.length / 2);
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = chunk.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    const target = Math.min(1, rms / 3200);
    this.level = this.level * 0.35 + target * 0.65;

    if (now - this.lastLevelAt >= 33) {
      this.lastLevelAt = now;
      this.emitter.emit('level', { level: this.level, rms, ts: now });
    }
  }
}
