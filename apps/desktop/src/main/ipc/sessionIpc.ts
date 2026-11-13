import { BrowserWindow, ipcMain } from 'electron';
import { getLogger } from '@neo/logger';
import { DatabaseManager, type AISessionRecord } from '../database';
import { getAIService } from '../ai/AIServiceManager';
import { SessionTranscriptRecorder } from '../sessions/SessionTranscriptRecorder';
import { SessionReportService, type ReportStatus } from '../sessions/SessionReportService';
import type { ReportSource, SessionReport } from '../../common/sessionReport';
import type { STTFinalEvent, STTStatus } from '@neo/shared';

const logger = getLogger();

type SttLike = {
    onStatus(cb: (status: STTStatus) => void): () => void;
    onFinal(cb: (event: STTFinalEvent) => void): () => void;
    stop(): Promise<void>;
};

export type SessionIpcDeps = {
    mic?: SttLike;
    system?: SttLike;
};

const parseReportJson = (json?: string | null): SessionReport | null => {
    if (!json) return null;
    try {
        return JSON.parse(json) as SessionReport;
    } catch {
        return null;
    }
};

/** What the renderer gets for a session in lists and details. */
const sessionSummaryDto = (s: AISessionRecord, transcriptCount?: number) => ({
    id: s.id,
    createdAt: s.createdAt,
    modelName: s.modelName,
    providerId: s.providerId,
    screenshotId: s.screenshotId,
    title: s.title || null,
    endedAt: s.endedAt ?? null,
    hasReport: !!s.reportJson,
    hasNotes: !!s.notes?.trim(),
    transcriptCount: transcriptCount ?? undefined,
    summary: s.summary ?? null,
});

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

export function registerSessionIpc(db: DatabaseManager, deps: SessionIpcDeps = {}): void {
    let currentTranscriptionSessionId: number | null = null;
    let activeChatSessionId: number | null = null;

    /** `auto` = created in the background (transcript, notes): windows keep their current tab. */
    const activate = (sessionId: number | null, reason: 'user' | 'auto' = 'user') => {
        activeChatSessionId = sessionId;
        broadcast('session:activated', { sessionId, reason });
    };

    const createChatSession = (): number => {
        const { providerId, modelName } = getAIService(db).getConfig();
        return db.saveAISession({ screenshotId: null, providerId, modelName });
    };

    /** The active session if it is still open; otherwise a new one becomes active. */
    const ensureOpenSession = (): number => {
        const current = activeChatSessionId ? db.getAISessionById(activeChatSessionId) : null;
        if (current && !current.endedAt) return current.id;
        const id = createChatSession();
        activate(id, 'auto');
        broadcast('session:updated', { sessionId: id });
        return id;
    };

    const loadReportSource = (sessionId: number): ReportSource | null => {
        const session = db.getAISessionById(sessionId);
        if (!session) return null;
        return {
            sessionId,
            title: session.title,
            createdAt: session.createdAt,
            endedAt: session.endedAt,
            notes: session.notes,
            messages: db.getAIMessages(sessionId).map((m) => ({
                role: m.role,
                content: m.content,
                createdAt: m.created_at,
            })),
            transcript: db.getSessionTranscript(sessionId).map((t) => ({
                source: t.source,
                text: t.text,
                spokenAt: t.spokenAt,
            })),
        };
    };

    const reports = new SessionReportService({
        loadSource: loadReportSource,
        complete: async (messages) => {
            const result = await getAIService(db).complete(messages, { temperature: 0.2, maxTokens: 3000 });
            return { text: result.text, modelName: result.modelName };
        },
        save: (sessionId, report) => {
            db.saveAISessionReport(sessionId, JSON.stringify(report), report.overview || report.title, report.generatedAt);
            if (report.title) db.setAISessionTitleIfEmpty(sessionId, report.title);
            broadcast('session:updated', { sessionId, title: db.getAISessionById(sessionId)?.title ?? null });
        },
        onStatus: (status: ReportStatus) => broadcast('session:report-status', status),
    });

    if (deps.mic && deps.system) {
        const recorder = new SessionTranscriptRecorder({
            mic: deps.mic,
            system: deps.system,
            ensureOpenSession,
            save: (entry) => db.addSessionTranscript(entry),
            onSaved: (entry) => broadcast('session:transcript-added', entry),
            onError: (error) => logger.error({ err: error }, 'Failed to store session transcript line'),
        });
        recorder.start();
    }

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
            return sessions.map((s) => sessionSummaryDto(s));
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
            const { reportJson: _reportJson, ...rest } = session;
            return {
                ...rest,
                summary: session.summary,
                notes: session.notes ?? '',
                endedAt: session.endedAt ?? null,
                report: parseReportJson(session.reportJson),
                reportGeneratedAt: session.reportGeneratedAt ?? null,
                reportGenerating: reports.isGenerating(sessionId),
                transcript: db.getSessionTranscript(sessionId).map((t) => ({
                    id: t.id,
                    source: t.source,
                    text: t.text,
                    spokenAt: t.spokenAt,
                })),
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

    ipcMain.on('session:activate', (_event, sessionId: number | null, reason?: 'user' | 'auto') => {
        activate(typeof sessionId === 'number' && sessionId > 0 ? sessionId : null, reason === 'auto' ? 'auto' : 'user');
    });

    /** Active open session, creating one when there is none (e.g. typing notes first). */
    ipcMain.handle('session:ensure', async () => {
        try {
            return { sessionId: ensureOpenSession() };
        } catch (error) {
            logger.error({ err: error }, 'Failed to ensure session');
            return { sessionId: null, error: (error as Error).message };
        }
    });

    ipcMain.handle('session:list-recent', async (_event, { limit, search }: { limit?: number; search?: string } = {}) => {
        try {
            return db
                .listRecentAISessions(limit ?? 100, search?.trim() || undefined)
                .map((s) => sessionSummaryDto(s, db.countSessionTranscript(s.id)));
        } catch (error) {
            logger.error({ err: error }, 'Failed to list recent sessions');
            return [];
        }
    });

    ipcMain.handle('session:transcript', async (_event, sessionId: number) => {
        try {
            return db.getSessionTranscript(sessionId).map((t) => ({
                id: t.id,
                source: t.source,
                text: t.text,
                spokenAt: t.spokenAt,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to load session transcript');
            return [];
        }
    });

    ipcMain.handle('session:notes-save', async (_event, { sessionId, notes }: { sessionId: number; notes: string }) => {
        try {
            if (!db.getAISessionById(sessionId)) return { success: false, error: 'Sessão não encontrada' };
            db.updateAISessionNotes(sessionId, String(notes ?? '').slice(0, 200_000));
            broadcast('session:notes-updated', { sessionId });
            return { success: true, savedAt: Date.now() };
        } catch (error) {
            logger.error({ err: error }, 'Failed to save notes');
            return { success: false, error: (error as Error).message };
        }
    });

    /**
     * Closes a session: stops live transcription first (its last clip still lands in
     * this session), then marks it ended and starts the report in the background.
     */
    ipcMain.handle('session:end', async (_event, { sessionId, generateReport = true }: { sessionId: number; generateReport?: boolean }) => {
        try {
            if (!db.getAISessionById(sessionId)) return { success: false, error: 'Sessão não encontrada' };
            if (activeChatSessionId === sessionId || activeChatSessionId === null) {
                await Promise.allSettled([deps.mic?.stop(), deps.system?.stop()]);
            }
            db.endAISession(sessionId);
            const endedAt = db.getAISessionById(sessionId)?.endedAt ?? Date.now();
            // Start the report before announcing the change, so a reload already sees it running.
            if (generateReport) {
                reports.generate(sessionId).catch((error) => {
                    logger.warn({ err: error, sessionId }, 'Session report failed after ending session');
                });
            }
            broadcast('session:updated', { sessionId, endedAt });
            return { success: true, endedAt };
        } catch (error) {
            logger.error({ err: error }, 'Failed to end session');
            return { success: false, error: (error as Error).message };
        }
    });

    ipcMain.handle('session:report-generate', async (_event, sessionId: number) => {
        try {
            const report = await reports.generate(sessionId);
            return { success: true, report };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    });

    ipcMain.handle('session:report-status', async (_event, sessionId: number) => ({
        generating: reports.isGenerating(sessionId),
    }));

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
