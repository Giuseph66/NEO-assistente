import { BrowserWindow, ipcMain } from 'electron';
import { DatabaseManager } from '../database';

const broadcast = (channel: string, payload: any) => {
    BrowserWindow.getAllWindows().forEach((win) => {
        if (win.isDestroyed()) return;
        const contents = win.webContents;
        if (contents.isDestroyed() || contents.isCrashed()) return;
        try {
            contents.send(channel, payload);
        } catch {
            // ignore
        }
    });
};

export function registerSessionIpc(db: DatabaseManager): void {
    let currentTranscriptionSessionId: number | null = null;
    let activeChatSessionId: number | null = null;

    // --- Transcription Sessions (Legacy/Audio only) ---

    ipcMain.on('session:start-listening', async (event) => {
        try {
            // Create session in DB
            currentTranscriptionSessionId = db.createTranscriptionSession('pt'); // Default to pt for now

            // Broadcast session started
            broadcast('session:started', { sessionId: currentTranscriptionSessionId });

            console.log(`[Session] Started transcription session #${currentTranscriptionSessionId}`);
        } catch (error) {
            console.error('[Session] Failed to start session:', error);
        }
    });

    ipcMain.on('session:stop-listening', async () => {
        try {
            if (currentTranscriptionSessionId !== null) {
                db.endTranscriptionSession(currentTranscriptionSessionId);
                console.log(`[Session] Ended transcription session #${currentTranscriptionSessionId}`);
                currentTranscriptionSessionId = null;
            }

            broadcast('session:stopped', {});
        } catch (error) {
            console.error('[Session] Failed to stop session:', error);
        }
    });

    ipcMain.handle('session:getCurrentId', async () => {
        return currentTranscriptionSessionId;
    });

    // --- AI Chat Sessions (New) ---

    ipcMain.handle('session:list', async (_event, { date, search }: { date?: number, search?: string }) => {
        try {
            const targetDate = date || Date.now();
            const startOfDay = new Date(targetDate).setHours(0, 0, 0, 0);
            const endOfDay = new Date(targetDate).setHours(23, 59, 59, 999);

            const sessions = db.getAISessionsByDate(startOfDay, endOfDay, search);
            
            // O DatabaseManager já retorna os objetos mapeados para camelCase
            return sessions.map(s => ({
                id: s.id,
                createdAt: s.createdAt,
                modelName: s.modelName,
                providerId: s.providerId,
                screenshotId: s.screenshotId,
                title: s.title || null
            }));
        } catch (error) {
            console.error('[Session] Failed to list sessions:', error);
            return [];
        }
    });

    ipcMain.handle('session:get', async (_event, sessionId: number) => {
        try {
            const session = db.getAISessionById(sessionId);
            if (!session) return null;

            const messages = db.getAIMessages(sessionId);
            return {
                ...session,
                summary: session.summary,
                messages: messages.map(m => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    recognizedText: m.recognized_text,
                    createdAt: m.created_at,
                    providerId: m.provider_id,
                    modelName: m.model_name,
                    durationMs: m.duration_ms
                }))
            };
        } catch (error) {
            console.error('[Session] Failed to get session:', error);
            return null;
        }
    });

    ipcMain.handle('session:create', async (_event, { providerId, modelName }: { providerId: string, modelName: string }) => {
        try {
            const sessionId = db.saveAISession({
                providerId: providerId,
                modelName: modelName,
                screenshotId: undefined // Explicitly undefined for chat-only sessions
            });
            return { sessionId };
        } catch (error) {
            console.error('[Session] Failed to create session:', error);
            throw error;
        }
    });

    ipcMain.handle('session:rename', async (_event, { sessionId, title }: { sessionId: number; title: string }) => {
        try {
            const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
            db.updateAISessionTitle(sessionId, clean || null);
            const saved = db.getAISessionById(sessionId)?.title ?? null;
            broadcast('session:updated', { sessionId, title: saved });
            return { success: true, title: saved };
        } catch (error) {
            console.error('[Session] Failed to rename session:', error);
            return { success: false, error: (error as Error).message };
        }
    });

    ipcMain.on('session:activate', (_event, sessionId: number) => {
        activeChatSessionId = sessionId;
        broadcast('session:activated', { sessionId });
    });

    ipcMain.handle('session:getActive', async () => {
        return { sessionId: activeChatSessionId };
    });

    ipcMain.handle('session:delete', async (_event, sessionId: number) => {
        try {
            db.deleteAISession(sessionId);
            console.log(`[Session] Deleted session #${sessionId}`);
            return { success: true };
        } catch (error) {
            console.error('[Session] Failed to delete session:', error);
            return { success: false, error: (error as Error).message };
        }
    });
}
