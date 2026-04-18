import { EventEmitter } from 'events';
import type { AudioSource } from './AudioSource';
import type { PhoneMicServer } from '../../audio/phone/PhoneMicServer';
import { getLogger } from '@neo/logger';

const logger = getLogger();

/**
 * AudioSource que recebe chunks PCM-16 diretamente do PhoneMicServer via WebSocket.
 * Implementa a mesma interface que ArecordAudioSource — permite plugar no STTController
 * sem nenhuma outra modificação.
 */
export class PhoneMicAudioSource implements AudioSource {
  private emitter = new EventEmitter();
  private server: PhoneMicServer;
  private removeAudioListener: (() => void) | null = null;
  private running = false;
  private targetSampleRate = 16000;
  // Buffer para reagrupar chunks pequenos em slices do tamanho certo
  private bufferCache = Buffer.alloc(0);
  private chunkBytes = 3200; // 100ms @ 16000 Hz PCM16

  constructor(server: PhoneMicServer) {
    this.server = server;
  }

  async start(opts: { sampleRate: number }): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.targetSampleRate = opts.sampleRate || 16000;
    this.chunkBytes = Math.max(320, Math.floor(this.targetSampleRate * 0.1) * 2);
    this.bufferCache = Buffer.alloc(0);

    logger.info(
      { sampleRate: this.targetSampleRate, chunkBytes: this.chunkBytes },
      'PhoneMicAudioSource: started — reading audio from phone mic WebSocket'
    );

    // O celular já envia PCM-16 @ 16 kHz — sem conversão necessária.
    // Se o sampleRate pedido for diferente, emitimos um aviso mas continue.
    if (this.targetSampleRate !== 16000) {
      logger.warn(
        { targetSampleRate: this.targetSampleRate },
        'PhoneMicAudioSource: phone mic sends PCM16@16kHz but STT wants a different rate — may affect quality'
      );
    }

    this.removeAudioListener = this.server.on('audio', ({ chunk }: { chunk: Buffer }) => {
      if (!this.running) return;
      this.bufferCache = Buffer.concat([this.bufferCache, chunk]);
      while (this.bufferCache.length >= this.chunkBytes) {
        const slice = this.bufferCache.subarray(0, this.chunkBytes);
        this.bufferCache = this.bufferCache.subarray(this.chunkBytes);
        this.emitter.emit('data', slice);
      }
    }) as unknown as () => void;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.removeAudioListener) {
      this.removeAudioListener();
      this.removeAudioListener = null;
    }
    this.bufferCache = Buffer.alloc(0);
    logger.info('PhoneMicAudioSource: stopped');
  }

  onData(cb: (chunk: Buffer) => void): () => void {
    this.emitter.on('data', cb);
    return () => this.emitter.off('data', cb);
  }

  onError(cb: (err: Error) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }
}
