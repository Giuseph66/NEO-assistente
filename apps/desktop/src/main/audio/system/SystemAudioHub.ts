import { getLogger } from '@neo/logger';
import { CaptureOptions, SystemAudioCapture, SystemAudioCaptureLike } from './SystemAudioCapture';

const logger = getLogger();

type Subscriber = {
  onData: (chunk: Buffer) => void;
  onError: (error: Error) => void;
};

type Entry = {
  key: string;
  capture: SystemAudioCaptureLike;
  subscribers: Set<Subscriber>;
  ready: Promise<void>;
};

/**
 * Shares one capture process per (source, sample rate) between every consumer:
 * recording, live transcription and the level preview all read the same stream,
 * so recording and transcribing system audio at the same time costs one `parec`.
 */
export class SystemAudioHub {
  private entries = new Map<string, Entry>();

  constructor(private readonly createDirect: () => SystemAudioCaptureLike = () => new SystemAudioCapture()) {}

  /** A capture with the same API as SystemAudioCapture, backed by the shared stream. */
  createCapture(): SystemAudioCaptureLike {
    return new SharedSystemAudioCapture(this);
  }

  /** Number of live shared streams (for diagnostics/tests). */
  activeStreams(): number {
    return this.entries.size;
  }

  async subscribe(options: CaptureOptions, subscriber: Subscriber): Promise<() => Promise<void>> {
    const key = `${options.sourceId}@${options.sampleRate}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.open(key, options);
    }
    entry.subscribers.add(subscriber);
    try {
      await entry.ready;
    } catch (error) {
      entry.subscribers.delete(subscriber);
      throw error;
    }

    const current = entry;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      current.subscribers.delete(subscriber);
      if (current.subscribers.size === 0 && this.entries.get(key) === current) {
        this.entries.delete(key);
        logger.info({ key }, 'System audio hub: last consumer left, stopping capture');
        await current.capture.stop().catch((error) => {
          logger.warn({ err: error, key }, 'System audio hub: failed to stop capture');
        });
      }
    };
  }

  private open(key: string, options: CaptureOptions): Entry {
    const capture = this.createDirect();
    const subscribers = new Set<Subscriber>();
    const entry: Entry = { key, capture, subscribers, ready: Promise.resolve() };

    capture.onData((chunk) => {
      for (const subscriber of subscribers) subscriber.onData(chunk);
    });
    capture.onError((error) => {
      // The process is gone: drop the entry so the next consumer starts a fresh one.
      if (this.entries.get(key) === entry) this.entries.delete(key);
      for (const subscriber of [...subscribers]) subscriber.onError(error);
    });

    entry.ready = capture.start(options).catch((error) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    logger.info({ key }, 'System audio hub: opened shared capture');
    return entry;
  }
}

class SharedSystemAudioCapture implements SystemAudioCaptureLike {
  private listeners = { data: new Set<(chunk: Buffer) => void>(), error: new Set<(error: Error) => void>() };
  private release: (() => Promise<void>) | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly hub: SystemAudioHub) {}

  async start(options: CaptureOptions): Promise<void> {
    if (this.release) return;
    if (this.starting) return this.starting;
    this.starting = this.hub
      .subscribe(options, {
        onData: (chunk) => {
          for (const cb of this.listeners.data) cb(chunk);
        },
        onError: (error) => {
          this.release = null;
          for (const cb of this.listeners.error) cb(error);
        },
      })
      .then((release) => {
        this.release = release;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  async stop(): Promise<void> {
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
    const release = this.release;
    this.release = null;
    await release?.();
  }

  onData(cb: (chunk: Buffer) => void): () => void {
    this.listeners.data.add(cb);
    return () => this.listeners.data.delete(cb);
  }

  onError(cb: (error: Error) => void): () => void {
    this.listeners.error.add(cb);
    return () => this.listeners.error.delete(cb);
  }
}

let hub: SystemAudioHub | null = null;

export function getSystemAudioHub(): SystemAudioHub {
  if (!hub) hub = new SystemAudioHub();
  return hub;
}
