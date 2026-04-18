import { EventEmitter } from 'events';
import { createServer as createHttpsServer, Server as HttpsServer } from 'https';
import { networkInterfaces } from 'os';
import { AddressInfo } from 'net';
import { getLogger } from '@neo/logger';
import { renderPhoneMicPage } from './PhoneMicPage';

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

export type PhoneMicStatus = {
  running: boolean;
  port: number;
  localUrl: string | null;
  clients: number;
  bytesReceived: number;
  chunksReceived: number;
  lastChunkAt: number | null;
  level: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8790;

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

export class PhoneMicServer extends EventEmitter {
  private httpsServer: HttpsServer | null = null;
  private wss: any | null = null;
  private port = DEFAULT_PORT;
  private bytesReceived = 0;
  private chunksReceived = 0;
  private lastChunkAt: number | null = null;
  private level = 0;
  private clients = new Set<any>();

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

  // ─── Status ────────────────────────────────────────────────────────────────

  getStatus(): PhoneMicStatus {
    const port = this.httpsServer
      ? (this.httpsServer.address() as AddressInfo).port
      : this.port;
    const address = getLanAddress();

    return {
      running: Boolean(this.httpsServer),
      port,
      localUrl: this.httpsServer ? `https://${address}:${port}` : null,
      clients: this.clients.size,
      bytesReceived: this.bytesReceived,
      chunksReceived: this.chunksReceived,
      lastChunkAt: this.lastChunkAt,
      level: this.level
    };
  }

  // ─── Connection handling ────────────────────────────────────────────────────

  private handleNewConnection(ws: any, _req: any): void {
    if (this.clients.size >= 1) {
      logger.info('PhoneMicServer: connection rejected, only 1 client allowed');
      try { ws.close(1008, 'Server is full'); } catch { /* ignore */ }
      return;
    }

    try { ws.send(JSON.stringify({ type: 'approved' })); } catch { /* ignore */ }
    this.setupApprovedClient(ws);
    logger.info('PhoneMicServer: client connected automatically');
    this.emitStatus();
  }

  private setupApprovedClient(ws: any): void {
    this.clients.add(ws);

    ws.on('message', (data: any, isBinary: boolean) => this.handleMessage(data, isBinary));

    ws.on('close', () => {
      this.clients.delete(ws);
      this.emitStatus();
      logger.info('PhoneMicServer: client disconnected');
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
