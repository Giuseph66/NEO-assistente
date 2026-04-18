/**
 * PhoneMicVirtualDevice — Creates a PulseAudio/PipeWire virtual microphone
 * that makes the phone mic appear as a real system mic to any application.
 *
 * Implementation:
 *  1. mkfifo to create a named pipe.
 *  2. pactl load-module module-pipe-source → creates a strictly Input microphone bound to the FIFO.
 *  3. writes PCM16 chunks directly to the FIFO.
 */

import { spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import { getLogger } from '@neo/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger();

const SOURCE_NAME = 'neo_phone_mic';
const SOURCE_DESCRIPTION = 'NEO Phone Mic';
const SAMPLE_RATE = 16000;
const CHANNELS = 1;

export type VirtualDeviceStatus = {
  active: boolean;
  sourceName: string;
  isSystemDefault: boolean;
  error: string | null;
};

export class PhoneMicVirtualDevice extends EventEmitter {
  private moduleId: string | null = null;
  private isSystemDefault = false;
  private prevDefaultSource: string | null = null;
  private fifoPath: string = path.join(os.tmpdir(), 'neo_phone_mic.fifo');
  private writeStream: fs.WriteStream | null = null;
  private _active = false;

  get active() {
    return this._active;
  }

  // ─── Check availability ─────────────────────────────────────────────────────

  static checkAvailability(): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    const check = (cmd: string) => {
      try { spawnSync('which', [cmd], { stdio: 'ignore' }); } catch { missing.push(cmd); }
    };
    check('pactl');
    check('mkfifo');
    return { ok: missing.length === 0, missing };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async enable(): Promise<void> {
    if (this._active) return;

    const { ok, missing } = PhoneMicVirtualDevice.checkAvailability();
    if (!ok) {
      throw new Error(`Dependências faltando: ${missing.join(', ')}`);
    }

    // Remove any existing module with same name to start clean
    this._cleanupExistingModule();

    // Create FIFO
    if (fs.existsSync(this.fifoPath)) {
      try { fs.unlinkSync(this.fifoPath); } catch { /* ignore */ }
    }
    const mkfifoResult = spawnSync('mkfifo', [this.fifoPath]);
    if (mkfifoResult.status !== 0) {
      throw new Error(`Falha ao criar FIFO: ${mkfifoResult.stderr?.toString().trim()}`);
    }

    // Create PulseAudio pipe-source
    const result = spawnSync('pactl', [
      'load-module', 'module-pipe-source',
      `source_name=${SOURCE_NAME}`,
      `file=${this.fifoPath}`,
      `format=s16le`,
      `rate=${SAMPLE_RATE}`,
      `channels=${CHANNELS}`,
      `source_properties=device.description="${SOURCE_DESCRIPTION}"`,
    ]);

    if (result.status !== 0) {
      throw new Error(`Falha ao criar microfone virtual: ${result.stderr?.toString().trim()}`);
    }

    this.moduleId = result.stdout.toString().trim();
    logger.info({ moduleId: this.moduleId }, 'PhoneMicVirtualDevice: pipe-source criado');

    // Open write stream. module-pipe-source reads from this pipe natively.
    this.writeStream = fs.createWriteStream(this.fifoPath);
    this.writeStream.on('error', (err) => logger.error({ err }, 'FIFO write error'));

    this._active = true;
    this.emitStatus();
  }

  async disable(): Promise<void> {
    if (!this._active) return;

    // Restore default source if we changed it
    if (this.isSystemDefault && this.prevDefaultSource) {
      try {
        spawnSync('pactl', ['set-default-source', this.prevDefaultSource]);
        logger.info({ source: this.prevDefaultSource }, 'PhoneMicVirtualDevice: default source restaurado');
      } catch { /* ignore */ }
    }
    this.isSystemDefault = false;
    this.prevDefaultSource = null;

    // Close Write Stream
    if (this.writeStream) {
      try { this.writeStream.destroy(); } catch { /* ignore */ }
      this.writeStream = null;
    }

    // Unload PulseAudio module
    if (this.moduleId) {
      try {
        spawnSync('pactl', ['unload-module', this.moduleId]);
        logger.info({ moduleId: this.moduleId }, 'PhoneMicVirtualDevice: módulo descarregado');
      } catch { /* ignore */ }
      this.moduleId = null;
    }

    if (fs.existsSync(this.fifoPath)) {
      try { fs.unlinkSync(this.fifoPath); } catch { /* ignore */ }
    }

    this._active = false;
    this.emitStatus();
  }

  /** Sets the virtual device as the system default microphone */
  async setAsSystemDefault(enable: boolean): Promise<void> {
    if (!this._active) throw new Error('Virtual device não está ativo');

    if (enable) {
      // Save current default source
      try {
        const r = spawnSync('pactl', ['get-default-source']);
        this.prevDefaultSource = r.stdout?.toString().trim() || null;
      } catch { /* ignore */ }

      spawnSync('pactl', ['set-default-source', SOURCE_NAME]);
      this.isSystemDefault = true;
      logger.info('PhoneMicVirtualDevice: definido como microfone padrão do sistema');
    } else {
      if (this.prevDefaultSource) {
        spawnSync('pactl', ['set-default-source', this.prevDefaultSource]);
        logger.info({ source: this.prevDefaultSource }, 'PhoneMicVirtualDevice: microfone padrão restaurado');
      }
      this.isSystemDefault = false;
    }

    this.emitStatus();
  }

  /** Push a raw PCM16 LE chunk into the virtual device via FIFO */
  pushAudio(chunk: Buffer): void {
    if (!this._active || !this.writeStream) return;
    try {
      this.writeStream.write(chunk);
    } catch { /* ignore write errors */ }
  }

  getStatus(): VirtualDeviceStatus {
    return {
      active: this._active,
      sourceName: SOURCE_NAME,
      isSystemDefault: this.isSystemDefault,
      error: null,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _cleanupExistingModule(): void {
    // Try to unload any leftover module from a previous run
    try {
      const r = spawnSync('pactl', ['list', 'modules', 'short']);
      const lines = r.stdout?.toString().split('\n') || [];
      for (const line of lines) {
        if (line.includes(SOURCE_NAME)) {
          const id = line.split('\t')[0]?.trim();
          if (id) spawnSync('pactl', ['unload-module', id]);
        }
      }
    } catch { /* ignore */ }
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: PhoneMicVirtualDevice | null = null;

export function getPhoneMicVirtualDevice(): PhoneMicVirtualDevice {
  if (!instance) instance = new PhoneMicVirtualDevice();
  return instance;
}

