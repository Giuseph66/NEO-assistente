import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getLogger } from '@neo/logger';

const logger = getLogger();

export interface ApprovedDevice {
  deviceId: string;
  deviceName: string;
  userAgent: string;
  approvedAt: number;
  lastSeenAt: number;
}

export class PhoneMicDeviceStore {
  private devices: Map<string, ApprovedDevice> = new Map();
  private filePath: string;

  constructor() {
    const userData = app.getPath('userData');
    this.filePath = join(userData, 'phone-mic-devices.json');
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8');
        const data: ApprovedDevice[] = JSON.parse(raw);
        for (const device of data) {
          this.devices.set(device.deviceId, device);
        }
        logger.info({ count: this.devices.size }, 'PhoneMicDeviceStore: loaded');
      }
    } catch (err) {
      logger.warn({ err }, 'PhoneMicDeviceStore: failed to load');
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify([...this.devices.values()], null, 2), 'utf8');
    } catch (err) {
      logger.warn({ err }, 'PhoneMicDeviceStore: failed to save');
    }
  }

  isApproved(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }

  get(deviceId: string): ApprovedDevice | undefined {
    return this.devices.get(deviceId);
  }

  approve(deviceId: string, deviceName: string, userAgent: string): ApprovedDevice {
    const existing = this.devices.get(deviceId);
    const device: ApprovedDevice = {
      deviceId,
      deviceName: deviceName || existing?.deviceName || 'Celular',
      userAgent: userAgent || existing?.userAgent || '',
      approvedAt: existing?.approvedAt ?? Date.now(),
      lastSeenAt: Date.now(),
    };
    this.devices.set(deviceId, device);
    this.save();
    return device;
  }

  revoke(deviceId: string): boolean {
    const had = this.devices.delete(deviceId);
    if (had) this.save();
    return had;
  }

  updateLastSeen(deviceId: string): void {
    const d = this.devices.get(deviceId);
    if (d) {
      d.lastSeenAt = Date.now();
      this.save();
    }
  }

  list(): ApprovedDevice[] {
    return [...this.devices.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }
}

let _store: PhoneMicDeviceStore | null = null;

export function getPhoneMicDeviceStore(): PhoneMicDeviceStore {
  if (!_store) _store = new PhoneMicDeviceStore();
  return _store;
}
