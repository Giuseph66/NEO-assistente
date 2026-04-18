import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { getLogger } from '@neo/logger';
import { SystemAudioCapture } from './SystemAudioCapture';

const logger = getLogger();

export class SystemAudioPreviewService {
    private capture: SystemAudioCapture | null = null;
    private emitter = new EventEmitter();
    private level = 0;
    private lastLevelAt = 0;
    private readonly sampleRate = 16000;

    async start(sourceId: string): Promise<void> {
        if (this.capture) {
            await this.stop();
        }

        this.capture = new SystemAudioCapture();
        this.level = 0;
        this.lastLevelAt = 0;

        this.capture.onData((chunk) => {
            this.updateLevel(chunk);
        });

        this.capture.onError((error) => {
            logger.error({ err: error }, 'System audio preview error');
            this.stop();
        });

        await this.capture.start({ sourceId, sampleRate: this.sampleRate });
        logger.info({ sourceId }, 'Started system audio preview');
    }

    async stop(): Promise<void> {
        if (!this.capture) return;

        const cap = this.capture;
        this.capture = null;
        await cap.stop();

        this.level = 0;
        this.lastLevelAt = 0;
        this.broadcastLevel(0);
        logger.info('Stopped system audio preview');
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
            this.broadcastLevel(this.level);
        }
    }

    private broadcastLevel(level: number): void {
        const payload = { level, ts: Date.now() };
        BrowserWindow.getAllWindows().forEach((win) => {
            if (win.isDestroyed()) return;
            try {
                const contents = win.webContents;
                if (!contents.isDestroyed() && !contents.isCrashed()) {
                    contents.send('systemAudio.level', payload);
                }
            } catch (error) {
                // Ignore errors when sending to destroyed windows
            }
        });
    }
}
