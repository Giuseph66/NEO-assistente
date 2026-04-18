import { BrowserWindow, ipcMain } from 'electron';
import { PhoneMicServer, PhoneMicStatus, PendingApprovalRequest } from '../audio/phone/PhoneMicServer';
import { PhoneMicAudioSource } from '../stt/audio/PhoneMicAudioSource';
import { getSttController } from '../stt/sttService';
import { getPhoneMicVirtualDevice } from '../audio/phone/PhoneMicVirtualDevice';
import { getLogger } from '@neo/logger';

const logger = getLogger();

const broadcast = (channel: string, payload: any) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.isDestroyed()) return;
    const contents = win.webContents;
    if (contents.isDestroyed() || contents.isCrashed()) return;
    try { contents.send(channel, payload); } catch { /* ignore */ }
  });
};

export function registerPhoneMicIpc(server: PhoneMicServer): void {
  // ─── Core server control ─────────────────────────────────────────────────
  ipcMain.handle('phoneMic.start', async (_event, port?: number) => {
    const status = await server.start(port);
    try {
      const vd = getPhoneMicVirtualDevice();
      if (!vd.active) {
        await vd.enable();
        broadcast('phoneMic.virtualDeviceStatus', vd.getStatus());
      }
    } catch (err) {
      logger.error({ err }, 'PhoneMicIpc: falha ao auto-ativar virtual device na inicialização');
    }
    return status;
  });
  ipcMain.handle('phoneMic.stop', async () => {
    // Disable virtual device on server stop
    const vd = getPhoneMicVirtualDevice();
    if (vd.active) {
        await vd.disable().catch(() => undefined);
        broadcast('phoneMic.virtualDeviceStatus', vd.getStatus());
    }
    return server.stop();
  });
  ipcMain.handle('phoneMic.getStatus', async () => server.getStatus());

  // ─── Device approval / management ────────────────────────────────────────
  ipcMain.handle('phoneMic.approveRequest', async (_event, requestId: string) => {
    server.resolveApproval(requestId, true);
  });
  ipcMain.handle('phoneMic.denyRequest', async (_event, requestId: string) => {
    server.resolveApproval(requestId, false);
  });
  ipcMain.handle('phoneMic.revokeDevice', async (_event, deviceId: string) => {
    return server.revokeDevice(deviceId);
  });
  ipcMain.handle('phoneMic.listDevices', async () => {
    return server.getStatus().approvedDevices;
  });

  // ─── Virtual system microphone ────────────────────────────────────────────
  ipcMain.handle('phoneMic.enableVirtualDevice', async () => {
    const vd = getPhoneMicVirtualDevice();
    await vd.enable();
    broadcast('phoneMic.virtualDeviceStatus', vd.getStatus());
    return vd.getStatus();
  });

  ipcMain.handle('phoneMic.disableVirtualDevice', async () => {
    const vd = getPhoneMicVirtualDevice();
    await vd.disable();
    broadcast('phoneMic.virtualDeviceStatus', vd.getStatus());
    return vd.getStatus();
  });

  ipcMain.handle('phoneMic.setVirtualDeviceAsDefault', async (_event, enable: boolean) => {
    const vd = getPhoneMicVirtualDevice();
    await vd.setAsSystemDefault(enable);
    broadcast('phoneMic.virtualDeviceStatus', vd.getStatus());
    return vd.getStatus();
  });

  ipcMain.handle('phoneMic.getVirtualDeviceStatus', async () => {
    return getPhoneMicVirtualDevice().getStatus();
  });

  ipcMain.handle('phoneMic.checkVirtualDeviceAvailability', async () => {
    return { ...getPhoneMicVirtualDevice().constructor.checkAvailability?.() 
      ?? (await import('../audio/phone/PhoneMicVirtualDevice')).PhoneMicVirtualDevice.checkAvailability() };
  });

  // ─── Forward phone audio to virtual device when active ───────────────────
  server.on('audio', ({ chunk }: { chunk: Buffer }) => {
    const vd = getPhoneMicVirtualDevice();
    if (vd.active) vd.pushAudio(chunk);
  });

  // ─── Test recording: capture N ms of PCM and return as base64 WAV ────────
  ipcMain.handle(
    'phoneMic.testRecord',
    (_event, durationMs: number = 5000): Promise<{ base64: string; mimeType: string } | null> => {
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const deadline = Date.now() + durationMs;

        const audioHandler = ({ chunk }: { chunk: Buffer }) => {
          chunks.push(chunk);
          if (Date.now() >= deadline) finish();
        };
        server.on('audio', audioHandler);

        const timeout = setTimeout(finish, durationMs + 500);

        function finish() {
          clearTimeout(timeout);
          server.off('audio', audioHandler);
          if (chunks.length === 0) { resolve(null); return; }
          const pcm = Buffer.concat(chunks);
          const wav = buildWav(pcm, 16000, 1, 16);
          resolve({ base64: wav.toString('base64'), mimeType: 'audio/wav' });
        }
      });
    }
  );

  // ─── Status / level / audio broadcasts ───────────────────────────────────
  server.on('status', (status: PhoneMicStatus) => broadcast('phoneMic.status', status));
  server.on('level', (payload) => broadcast('phoneMic.level', payload));
  server.on('audio', (payload) => broadcast('phoneMic.audio', { bytes: payload.chunk?.length || 0, ts: payload.ts }));

  // ─── New approval request → notify UI ────────────────────────────────────
  server.on('approvalRequest', (request: PendingApprovalRequest) => {
    broadcast('phoneMic.approvalRequest', request);
  });

  // ─── Auto-set phone mic as default STT source on first client connection ──
  let phoneMicSource: PhoneMicAudioSource | null = null;

  server.on('status', async (status: PhoneMicStatus) => {
    try {
      const stt = getSttController();
      const hasClients = status.clients > 0;
      const currentType = stt.getAudioSourceType();

      if (hasClients && currentType !== 'phoneMic') {
        logger.info('PhoneMicIpc: client connected → switching STT to phone mic');
        phoneMicSource = new PhoneMicAudioSource(server);
        await stt.setAudioSourceOverride(phoneMicSource);
        broadcast('phoneMic.isDefault', true);
      } else if (!hasClients && currentType === 'phoneMic') {
        logger.info('PhoneMicIpc: no clients → restoring default STT source');
        await stt.setAudioSourceOverride(null);
        phoneMicSource = null;
        broadcast('phoneMic.isDefault', false);
      }
    } catch (error) {
      logger.error({ err: error }, 'PhoneMicIpc: error switching audio source');
    }
  });
}

// ─── WAV builder ──────────────────────────────────────────────────────────────
function buildWav(pcm: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
