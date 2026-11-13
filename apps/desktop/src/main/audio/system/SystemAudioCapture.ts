import { EventEmitter } from 'events';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { getLogger } from '@neo/logger';

const logger = getLogger();

type CaptureBackend = 'parec' | 'pw-cat' | 'pw-record';

export type CaptureOptions = {
  sourceId: string;
  sampleRate: number;
};

/** Common surface of a direct capture and a shared (hub) capture. */
export interface SystemAudioCaptureLike {
  start(options: CaptureOptions): Promise<void>;
  stop(): Promise<void>;
  onData(cb: (chunk: Buffer) => void): () => void;
  onError(cb: (error: Error) => void): () => void;
}

const STDERR_TAIL_CHARS = 600;
const KILL_GRACE_MS = 800;

const commandExists = (cmd: string): boolean => {
  const result = spawnSync('which', [cmd], { encoding: 'utf8' });
  return result.status === 0;
};

/**
 * Captures a PulseAudio/PipeWire source (usually a sink monitor) as raw PCM16 mono.
 *
 * stderr output alone is not treated as a failure (parec/pw-record print warnings
 * while capture keeps working); an error is reported only when the process fails
 * to start or exits while it was supposed to be running.
 */
export class SystemAudioCapture implements SystemAudioCaptureLike {
  private process: ChildProcess | null = null;
  private emitter = new EventEmitter();
  private backend: CaptureBackend | null = null;
  private sourceId: string | null = null;
  private stopping = false;
  private stderrTail = '';

  async start(options: CaptureOptions): Promise<void> {
    if (this.process) return;

    this.stopping = false;
    this.stderrTail = '';
    const backend = this.pickBackend();
    if (!backend) {
      throw new Error('parec/pw-cat/pw-record nao encontrados. Instale pipewire-pulse ou pipewire-utils.');
    }

    this.backend = backend;
    this.sourceId = options.sourceId;

    const args = this.buildArgs(backend, options);
    logger.info({ backend, args }, 'Starting system audio capture');

    const child = spawn(backend, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!child.stdout || !child.stderr) {
      throw new Error('Falha ao abrir stream de audio do sistema');
    }

    this.process = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.emitter.emit('data', chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (!message) return;
      this.stderrTail = (this.stderrTail + '\n' + message).slice(-STDERR_TAIL_CHARS);
      if (!this.stopping) {
        logger.warn({ backend, message }, 'System audio capture stderr');
      }
    });

    child.on('close', (code, signal) => {
      if (this.process === child) {
        this.process = null;
        this.backend = null;
      }
      if (this.stopping) return;
      const detail = this.stderrTail.trim();
      const reason = code !== null ? `codigo ${code}` : `sinal ${signal}`;
      this.emitter.emit(
        'error',
        new Error(`Captura do audio do sistema encerrou (${reason})${detail ? `: ${detail}` : ''}`)
      );
    });

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError);
        child.on('error', (error) => {
          if (!this.stopping) this.emitter.emit('error', error);
        });
        resolve();
      };
      const onError = (error: Error) => {
        child.off('spawn', onSpawn);
        this.process = null;
        this.backend = null;
        this.stopping = true; // suppress the close handler: start() reports this failure
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    const proc = this.process;
    this.stopping = true;
    this.process = null;
    this.backend = null;

    proc.stdout?.removeAllListeners('data');

    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGKILL');
        }
        resolve();
      }, KILL_GRACE_MS);
      proc.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill('SIGINT');
    });
  }

  onData(cb: (chunk: Buffer) => void): () => void {
    this.emitter.on('data', cb);
    return () => this.emitter.off('data', cb);
  }

  onError(cb: (error: Error) => void): () => void {
    this.emitter.on('error', cb);
    return () => this.emitter.off('error', cb);
  }

  getBackend(): CaptureBackend | null {
    return this.backend;
  }

  getSourceId(): string | null {
    return this.sourceId;
  }

  private pickBackend(): CaptureBackend | null {
    if (commandExists('parec')) return 'parec';
    if (commandExists('pw-cat')) return 'pw-cat';
    if (commandExists('pw-record')) return 'pw-record';
    return null;
  }

  private buildArgs(backend: CaptureBackend, options: CaptureOptions): string[] {
    const sampleRate = String(options.sampleRate);
    if (backend === 'parec') {
      return [
        `--device=${options.sourceId}`,
        '--raw',
        '--format=s16le',
        `--rate=${sampleRate}`,
        '--channels=1',
        // Small fragments keep latency low for live transcription (default is ~2 s).
        '--latency-msec=100',
      ];
    }
    if (backend === 'pw-cat') {
      return [
        '--record',
        '--target',
        options.sourceId,
        '--format',
        's16',
        '--rate',
        sampleRate,
        '--channels',
        '1',
        '-',
      ];
    }

    return [
      '--target',
      options.sourceId,
      '--format',
      's16',
      '--rate',
      sampleRate,
      '--channels',
      '1',
      '-',
    ];
  }
}
