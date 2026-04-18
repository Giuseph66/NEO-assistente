import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'fs';
import { getLogger } from '@neo/logger';
import { getOverlayManager } from './overlay';
import { DatabaseManager } from './database';

const logger = getLogger();

/**
 * Gateway WebSocket local para comunicação entre renderer e main process
 * 
 * Nota: O engine STT tem seu próprio WebSocket server em services/engine.
 * Este gateway é para comunicação local do Electron.
 */
export class Gateway {
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private db: DatabaseManager | null = null;
    private startCaptureCallback: (() => Promise<void>) | null = null;
    private cancelCaptureCallback: (() => Promise<void>) | null = null;

    constructor(port: number = 8788) {
        // Usa porta diferente do engine (8787 vs 8788)
        try {
            this.wss = new WebSocketServer({ port, host: '127.0.0.1' });
            this.setupHandlers();
            logger.info({ port }, 'Gateway started');
        } catch (error) {
            logger.error({ err: error, port }, 'Failed to start gateway (possibly already in use, continuing without overlay websocket)');
        }
    }

    /**
     * Define callbacks para captura de screenshot
     */
    setScreenshotCallbacks(
        startCapture: () => Promise<void>,
        cancelCapture: () => Promise<void>
    ): void {
        this.startCaptureCallback = startCapture;
        this.cancelCaptureCallback = cancelCapture;
    }

    /**
     * Define instância do database
     */
    setDatabase(db: DatabaseManager): void {
        this.db = db;
    }

    private setupHandlers() {
        if (!this.wss) return;

        this.wss.on('error', (error) => {
            logger.error({ err: error }, 'Gateway WebSocketServer critical error (EADDRINUSE, etc)');
        });

        this.wss.on('connection', (ws) => {
            logger.info('Client connected to gateway');
            this.clients.add(ws);

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    this.handleMessage(ws, data);
                } catch (error) {
                    logger.error({ err: error }, 'Failed to parse message');
                }
            });

            ws.on('close', () => {
                logger.info('Client disconnected from gateway');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                logger.error({ err: error }, 'Gateway WebSocket error');
                this.clients.delete(ws);
            });
        });
    }

    private async handleMessage(ws: WebSocket, data: any) {
        logger.debug({ type: data.type }, 'Gateway message received');

        switch (data.type) {
            case 'overlay.toggle':
                const overlayManager = getOverlayManager();
                overlayManager.toggle();
                this.sendResponse(ws, data.id, {
                    type: 'overlay.toggle.response',
                    payload: { visible: overlayManager.isOverlayVisible() },
                });
                break;

            case 'screenshot.startCapture':
                logger.debug('screenshot.startCapture handler called');
                if (this.startCaptureCallback) {
                    logger.debug('Calling startCaptureCallback');
                    try {
                        await this.startCaptureCallback();
                        logger.debug('startCaptureCallback completed successfully');
                        this.sendResponse(ws, data.id, {
                            type: 'screenshot.startCapture.response',
                            payload: { success: true },
                        });
                    } catch (error: any) {
                        logger.error({ err: error }, 'Failed to start capture');
                        this.sendResponse(ws, data.id, {
                            type: 'screenshot.startCapture.response',
                            payload: { success: false, error: error.message },
                        });
                    }
                } else {
                    logger.warn('startCaptureCallback not set');
                    this.sendResponse(ws, data.id, {
                        type: 'screenshot.startCapture.response',
                        payload: { success: false, error: 'Capture callback not set' },
                    });
                }
                break;

            case 'screenshot.cancelCapture':
                if (this.cancelCaptureCallback) {
                    try {
                        await this.cancelCaptureCallback();
                        this.sendResponse(ws, data.id, {
                            type: 'screenshot.cancelCapture.response',
                            payload: { success: true },
                        });
                    } catch (error: any) {
                        logger.error({ err: error }, 'Failed to cancel capture');
                        this.sendResponse(ws, data.id, {
                            type: 'screenshot.cancelCapture.response',
                            payload: { success: false, error: error.message },
                        });
                    }
                } else {
                    this.sendResponse(ws, data.id, {
                        type: 'screenshot.cancelCapture.response',
                        payload: { success: false, error: 'Cancel callback not set' },
                    });
                }
                break;

            case 'screenshot.list':
                if (this.db) {
                    try {
                        const limit = data.payload?.limit || 50;
                        const screenshots = this.db.getScreenshots(limit);
                        const validScreenshots = screenshots.filter((screenshot) => {
                            const exists = existsSync(screenshot.file_path);
                            if (!exists) {
                                this.db?.deleteScreenshot(screenshot.id);
                            }
                            return exists;
                        });
                        this.sendResponse(ws, data.id, {
                            type: 'screenshot.list.response',
                            payload: { screenshots: validScreenshots },
                        });
                    } catch (error: any) {
                        logger.error({ err: error }, 'Failed to list screenshots');
                        this.sendResponse(ws, data.id, {
                            type: 'screenshot.list.response',
                            payload: { screenshots: [], error: error.message },
                        });
                    }
                } else {
                    this.sendResponse(ws, data.id, {
                        type: 'screenshot.list.response',
                        payload: { screenshots: [], error: 'Database not set' },
                    });
                }
                break;

            default:
                logger.warn({ type: data.type }, 'Unknown message type in gateway');
        }
    }

    /**
     * Broadcast eventos de AI (chamado pelo AIService via IPC)
     * Os eventos são enviados para todos os clientes conectados
     */
    broadcastAIEvent(event: {
        type: 'ai.analysis.started' | 'ai.analysis.completed' | 'ai.analysis.error' | 'ai.session.created' | 'ai.message.added';
        payload: any;
    }): void {
        this.broadcast(event);
    }

    private sendResponse(ws: WebSocket, id: string | undefined, response: any) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                ...response,
                id,
                timestamp: Date.now(),
            }));
        }
    }

    /**
     * Envia evento para todos os clientes conectados
     */
    broadcast(event: { type: string; payload?: any }): void {
        const message = JSON.stringify({
            ...event,
            timestamp: Date.now(),
        });

        this.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    /**
     * Fecha o gateway
     */
    close(): void {
        if (this.wss) {
            this.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.close();
                }
            });
            this.clients.clear();
            this.wss.close();
            this.wss = null;
            logger.info('Gateway closed');
        }
    }
}
