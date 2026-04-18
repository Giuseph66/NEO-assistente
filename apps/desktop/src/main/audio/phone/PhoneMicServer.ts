import { EventEmitter } from 'events';
import { createServer as createHttpsServer, Server as HttpsServer } from 'https';
import { networkInterfaces } from 'os';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { getLogger } from '@neo/logger';
import { renderPhoneMicPage } from './PhoneMicPage';
import type { ApprovedDevice } from './PhoneMicDeviceStore';
import { getPhoneMicDeviceStore } from './PhoneMicDeviceStore';

const logger = getLogger();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WsLib = require('ws');
const WebSocketServerCtor = WsLib.WebSocketServer ?? WsLib.Server;

// Lazy-loaded selfsigned
let _tlsCredentials: { key: string; cert: string } | null = null;

async function getTlsCredentials(): Promise<{ key: string; cert: string }> {
  if (_tlsCredentials) return _tlsCredentials;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const selfsigned = require('selfsigned');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'NEO Phone Mic' }], {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }],
  });
  _tlsCredentials = { key: pems.private, cert: pems.cert };
  logger.info('PhoneMicServer: self-signed TLS certificate generated');
  return _tlsCredentials;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PendingApprovalRequest = {
  requestId: string;
  deviceId: string;
  deviceName: string;
  userAgent: string;
  requestedAt: number;
};

export type PhoneMicStatus = {
  running: boolean;
  port: number;
  localUrl: string | null;
  clients: number;
  bytesReceived: number;
  chunksReceived: number;
  lastChunkAt: number | null;
  level: number;
  pendingRequests: PendingApprovalRequest[];
  approvedDevices: ApprovedDevice[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8790;
const APPROVAL_TIMEOUT_MS = 60_000; // 60 segundos para aprovar

const getLanAddress = (): string => {
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
};

const bufferFromRawData = (data: any): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as any);
};

const calculatePcm16Level = (chunk: Buffer): { level: number; rms: number } => {
  if (chunk.length < 2) return { level: 0, rms: 0 };
  const sampleCount = Math.floor(chunk.length / 2);
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = chunk.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return { rms, level: Math.min(1, rms / 3200) };
};

// ─── PhoneMicServer ──────────────────────────────────────────────────────────

type PendingEntry = PendingApprovalRequest & {
  ws: any;
  timeout: NodeJS.Timeout;
};

export class PhoneMicServer extends EventEmitter {
  private httpsServer: HttpsServer | null = null;
  private wss: any | null = null;
  private port = DEFAULT_PORT;
  private bytesReceived = 0;
  private chunksReceived = 0;
  private lastChunkAt: number | null = null;
  private level = 0;
  private clients = new Set<any>();
  // Pending approval requests: requestId → PendingEntry
  private pendingRequests = new Map<string, PendingEntry>();

  async start(port: number = DEFAULT_PORT): Promise<PhoneMicStatus> {
    if (this.httpsServer) return this.getStatus();

    this.port = port;
    this.bytesReceived = 0;
    this.chunksReceived = 0;
    this.lastChunkAt = null;
    this.level = 0;

    const credentials = await getTlsCredentials();

    this.httpsServer = createHttpsServer(credentials, (req, res) => {
      const url = new URL(req.url || '/', `https://${req.headers.host || '127.0.0.1'}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, running: true }));
        return;
      }

      // Serve the phone mic page for any path
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPhoneMicPage());
    });

    this.wss = new WebSocketServerCtor({ server: this.httpsServer, path: '/phone-mic/ws' });
    this.wss.on('connection', (ws: any, req: any) => this.handleNewConnection(ws, req));

    await new Promise<void>((resolve, reject) => {
      if (!this.httpsServer) return reject(new Error('Server not initialized'));
      
      const onError = (err: any) => reject(err);
      this.httpsServer.once('error', onError);
      
      this.httpsServer.listen(port, '0.0.0.0', () => {
        this.httpsServer?.off('error', onError);
        this.httpsServer?.on('error', (err) => logger.error({ err }, 'PhoneMic HTTPS Server error'));
        resolve();
      });
    });

    const addr = (this.httpsServer.address() as AddressInfo).port;
    logger.info({ port: addr }, 'PhoneMicServer: HTTPS server started');
    this.emitStatus();
    return this.getStatus();
  }

  async stop(): Promise<PhoneMicStatus> {
    // Cancel all pending approval requests
    for (const [, entry] of this.pendingRequests) {
      clearTimeout(entry.timeout);
      try { entry.ws.close(1001, 'server stopped'); } catch { /* ignore */ }
    }
    this.pendingRequests.clear();

    this.clients.forEach((ws) => { try { ws.close(1001, 'server stopped'); } catch { /* ignore */ } });
    this.clients.clear();

    await new Promise<void>((resolve) => { this.wss?.close(() => resolve()); if (!this.wss) resolve(); });
    this.wss = null;

    await new Promise<void>((resolve) => { this.httpsServer?.close(() => resolve()); if (!this.httpsServer) resolve(); });
    this.httpsServer = null;
    this.level = 0;
    this.emitStatus();
    return this.getStatus();
  }

  // ─── Approval flow ─────────────────────────────────────────────────────────

  /** Called by IPC when user approves a device connection request */
  resolveApproval(requestId: string, approved: boolean): void {
    const entry = this.pendingRequests.get(requestId);
    if (!entry) return;

    clearTimeout(entry.timeout);
    this.pendingRequests.delete(requestId);

    if (approved) {
      const store = getPhoneMicDeviceStore();
      store.approve(entry.deviceId, entry.deviceName, entry.userAgent);
      try {
        entry.ws.send(JSON.stringify({ type: 'approved' }));
      } catch { /* ws might have closed */ }
      this.setupApprovedClient(entry.ws);
      logger.info({ deviceId: entry.deviceId, deviceName: entry.deviceName }, 'PhoneMicServer: device approved');
    } else {
      try { entry.ws.close(1008, 'access denied'); } catch { /* ignore */ }
      logger.info({ deviceId: entry.deviceId }, 'PhoneMicServer: device denied');
    }

    this.emitStatus();
  }

  /** Called by IPC when user revokes a previously approved device */
  revokeDevice(deviceId: string): boolean {
    const store = getPhoneMicDeviceStore();
    const revoked = store.revoke(deviceId);

    // Disconnect any active client with this deviceId
    for (const ws of this.clients) {
      if (ws._phoneMicDeviceId === deviceId) {
        try { ws.close(1008, 'access revoked'); } catch { /* ignore */ }
        this.clients.delete(ws);
      }
    }

    this.emitStatus();
    return revoked;
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  getStatus(): PhoneMicStatus {
    const port = this.httpsServer
      ? (this.httpsServer.address() as AddressInfo).port
      : this.port;
    const address = getLanAddress();
    const store = getPhoneMicDeviceStore();

    return {
      running: Boolean(this.httpsServer),
      port,
      localUrl: this.httpsServer ? `https://${address}:${port}` : null,
      clients: this.clients.size,
      bytesReceived: this.bytesReceived,
      chunksReceived: this.chunksReceived,
      lastChunkAt: this.lastChunkAt,
      level: this.level,
      pendingRequests: [...this.pendingRequests.values()].map(({ ws: _ws, timeout: _t, ...rest }) => rest),
      approvedDevices: store.list(),
    };
  }

  // ─── Connection handling ────────────────────────────────────────────────────

  private handleNewConnection(ws: any, req: any): void {
    const host = req.headers.host || '127.0.0.1';
    const url = new URL(req.url || '/', `https://${host}`);
    const deviceId = url.searchParams.get('deviceId') || '';
    const deviceName = url.searchParams.get('deviceName') || 'Celular';
    const userAgent = (req.headers['user-agent'] || '').slice(0, 300);

    if (!deviceId) {
      ws.close(1008, 'missing deviceId');
      return;
    }

    const store = getPhoneMicDeviceStore();

    if (store.isApproved(deviceId)) {
      // Device already approved → connect immediately
      store.updateLastSeen(deviceId);
      ws._phoneMicDeviceId = deviceId;
      try { ws.send(JSON.stringify({ type: 'approved' })); } catch { /* ignore */ }
      this.setupApprovedClient(ws);
      logger.info({ deviceId, deviceName }, 'PhoneMicServer: known device connected');
      this.emitStatus();
      return;
    }

    // New device → pending approval
    const requestId = randomUUID();
    const pendingReq: PendingApprovalRequest = {
      requestId,
      deviceId,
      deviceName,
      userAgent,
      requestedAt: Date.now(),
    };

    const timeout = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      try { ws.close(1008, 'approval timeout'); } catch { /* ignore */ }
      logger.info({ requestId, deviceId }, 'PhoneMicServer: approval request timed out');
      this.emitStatus();
    }, APPROVAL_TIMEOUT_MS);

    this.pendingRequests.set(requestId, { ...pendingReq, ws, timeout });

    // Tell phone to show "waiting for approval" state
    try { ws.send(JSON.stringify({ type: 'pending', requestId })); } catch { /* ignore */ }

    // Notify desktop UI of incoming approval request
    this.emit('approvalRequest', pendingReq);
    this.emitStatus();

    logger.info({ requestId, deviceId, deviceName }, 'PhoneMicServer: new device approval request');

    ws.on('close', () => {
      // If disconnects before approval, clean up
      if (this.pendingRequests.has(requestId)) {
        clearTimeout(this.pendingRequests.get(requestId)!.timeout);
        this.pendingRequests.delete(requestId);
        this.emitStatus();
      }
    });
  }

  private setupApprovedClient(ws: any): void {
    this.clients.add(ws);

    ws.on('message', (data: any, isBinary: boolean) => this.handleMessage(data, isBinary));

    ws.on('close', () => {
      this.clients.delete(ws);
      this.emitStatus();
      logger.info({ deviceId: ws._phoneMicDeviceId }, 'PhoneMicServer: client disconnected');
    });

    ws.on('error', (err: Error) => logger.warn({ err }, 'PhoneMicServer: WS error'));
  }

  private handleMessage(data: any, isBinary: boolean): void {
    if (!isBinary) {
      try {
        const payload = JSON.parse(bufferFromRawData(data).toString('utf8'));
        if (typeof payload.level === 'number') {
          this.level = Math.max(0, Math.min(1, payload.level));
          this.emit('level', { level: this.level, rms: payload.rms || 0, ts: Date.now() });
        }
      } catch { /* ignore malformed */ }
      return;
    }

    const chunk = bufferFromRawData(data);
    this.bytesReceived += chunk.length;
    this.chunksReceived += 1;
    this.lastChunkAt = Date.now();
    const { level, rms } = calculatePcm16Level(chunk);
    this.level = this.level * 0.35 + level * 0.65;
    this.emit('audio', { chunk, ts: this.lastChunkAt });
    this.emit('level', { level: this.level, rms, ts: this.lastChunkAt });
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let phoneMicServer: PhoneMicServer | null = null;

export function getPhoneMicServer(): PhoneMicServer {
  if (!phoneMicServer) phoneMicServer = new PhoneMicServer();
  return phoneMicServer;
}
