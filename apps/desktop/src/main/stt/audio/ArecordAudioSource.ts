import { spawn, spawnSync, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { AudioSource } from './AudioSource';
import { getLogger } from '@neo/logger';

const logger = getLogger();

export class ArecordAudioSource implements AudioSource {
  private process: ChildProcess | null = null;
  private emitter = new EventEmitter();
  private bufferCache = Buffer.alloc(0);
  private chunkBytes = 3200;
  private deviceName: string = 'default';

  async start(opts: { sampleRate: number }): Promise<void> {
    if (this.process) {
      return;
    }

    const device = this.resolveDevice();
    this.deviceName = device || 'default';
    const args = [
      ...(device ? ['-D', device] : []),
      '-f',
      'S16_LE',
      '-c',
      '1',
      '-r',
      String(opts.sampleRate),
      '-t',
      'raw',
      '-q',
    ];
    logger.info({ device: this.deviceName, sampleRate: opts.sampleRate }, 'Starting arecord');

    const child = spawn('arecord', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = child;
    this.chunkBytes = Math.max(320, Math.floor(opts.sampleRate * 0.1) * 2);

    child.stdout.on('data', (chunk: Buffer) => {
      this.bufferCache = Buffer.concat([this.bufferCache, chunk]);
      while (this.bufferCache.length >= this.chunkBytes) {
        const slice = this.bufferCache.subarray(0, this.chunkBytes);
        this.bufferCache = this.bufferCache.subarray(this.chunkBytes);
        this.emitter.emit('data', slice);
      }
    });

    let stderrTail = '';
    let spawned = false;
    child.stderr.on('data', (data: Buffer) => {
      // arecord prints warnings (e.g. overruns) while still capturing: log, don't fail.
      const message = data.toString().trim();
      if (!message) return;
      stderrTail = (stderrTail + '\n' + message).slice(-600);
      logger.warn({ message }, 'arecord stderr');
    });

    child.on('error', (error) => {
      // Before 'spawn', start() rejects with this error instead.
      if (spawned && this.process === child) this.emitter.emit('error', error);
    });

    child.on('exit', (code, signal) => {
      if (this.process !== child) return; // stopped on purpose
      this.process = null;
      const reason = code !== null ? `codigo ${code}` : `sinal ${signal}`;
      const detail = stderrTail.trim();
      this.emitter.emit('error', new Error(`Captura do microfone encerrou (${reason})${detail ? `: ${detail}` : ''}`));
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => {
        spawned = true;
        resolve();
      });
      child.once('error', (error) => {
        if (spawned) return;
        if (this.process === child) this.process = null;
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }
    this.process.kill('SIGTERM');
    this.process = null;
    this.bufferCache = Buffer.alloc(0);
  }

  onData(cb: (chunk: Buffer) => void): () => void {
    this.emitter.on('data', cb);
    return () => this.emitter.off('data', cb);
  }

  onError(cb: (err: Error) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }

  getDeviceName(): string {
    return this.deviceName;
  }

  private resolveDevice(): string | null {
    const envDevice = process.env.RICKY_STT_DEVICE;
    if (envDevice) {
      return envDevice;
    }

    const preferred = this.resolvePreferredDevice();
    if (preferred) {
      return preferred;
    }

    const hardware = this.resolveHardwareDevice();
    if (hardware) {
      return hardware;
    }

    return null;
  }

  private resolvePreferredDevice(): string | null {
    try {
      const result = spawnSync('arecord', ['-L'], { encoding: 'utf8' });
      if (result.error) {
        return null;
      }
      const output = result.stdout || '';
      const hasDevice = (name: string) => new RegExp(`^${name}$`, 'm').test(output);
      if (hasDevice('pipewire')) {
        return 'pipewire';
      }
      if (hasDevice('pulse')) {
        return 'pulse';
      }
    } catch {
      return null;
    }
    return null;
  }

  private resolveHardwareDevice(): string | null {
    try {
      const result = spawnSync('arecord', ['-l'], { encoding: 'utf8' });
      if (result.error) {
        return null;
      }
      const output = result.stdout || '';
      const match = output.match(/card\s+(\d+):.*?device\s+(\d+):/i);
      if (!match) {
        return null;
      }
      const card = match[1];
      const device = match[2];
      return `plughw:${card},${device}`;
    } catch {
      return null;
    }
  }
}
