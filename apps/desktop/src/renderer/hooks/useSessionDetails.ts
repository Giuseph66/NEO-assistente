import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionReport } from '../../common/sessionReport';

export type SessionTranscriptLine = { id: number; source: 'mic' | 'system'; text: string; spokenAt: number };

export type SessionDetails = {
  id: number;
  title: string | null;
  createdAt: number;
  endedAt: number | null;
  providerId: string;
  modelName: string;
  summary: string | null;
  notes: string;
  report: SessionReport | null;
  reportGeneratedAt: number | null;
  reportGenerating: boolean;
  transcript: SessionTranscriptLine[];
  messages: Array<{ id: number; role: 'user' | 'assistant' | 'system'; content: string; createdAt: number }>;
};

const ipc = () => (window as any).electron?.ipcRenderer;

/**
 * Loads a session (report, notes, transcript, messages) and keeps it fresh when the
 * main process reports changes. `generating`/`error` follow the report generation,
 * which runs in the main process and survives tab switches.
 */
export function useSessionDetails(sessionId: number | null | undefined) {
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const seqRef = useRef(0);
  /** Last report status event: a reload answered before it must not hide a running generation. */
  const lastStatusRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!sessionId || !ipc()) {
      setDetails(null);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const result = await ipc().invoke('session:get', sessionId);
      if (seq !== seqRef.current) return;
      setDetails(result || null);
      setGenerating(!!result?.reportGenerating || lastStatusRef.current === 'generating');
    } catch {
      if (seq === seqRef.current) setDetails(null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setReportError(null);
    setGenerating(false);
    lastStatusRef.current = null;
    void reload();
  }, [reload]);

  useEffect(() => {
    const bridge = ipc();
    if (!bridge || !sessionId) return;
    const onUpdated = (_e: unknown, payload: { sessionId?: number }) => {
      if (payload?.sessionId === sessionId) void reload();
    };
    const onStatus = (_e: unknown, payload: { sessionId: number; state: string; error?: string }) => {
      if (payload?.sessionId !== sessionId) return;
      lastStatusRef.current = payload.state;
      setGenerating(payload.state === 'generating');
      if (payload.state === 'error') setReportError(payload.error || 'Falha ao gerar o relatório');
      if (payload.state === 'generating') setReportError(null);
      if (payload.state === 'done') void reload();
    };
    bridge.on('session:updated', onUpdated);
    bridge.on('session:notes-updated', onUpdated);
    bridge.on('session:report-status', onStatus);
    return () => {
      bridge.removeListener('session:updated', onUpdated);
      bridge.removeListener('session:notes-updated', onUpdated);
      bridge.removeListener('session:report-status', onStatus);
    };
  }, [sessionId, reload]);

  const generateReport = useCallback(async () => {
    if (!sessionId || !ipc()) return;
    setReportError(null);
    setGenerating(true);
    const result = await ipc().invoke('session:report-generate', sessionId);
    if (!result?.success) {
      setReportError(result?.error || 'Falha ao gerar o relatório');
      setGenerating(false);
    }
  }, [sessionId]);

  const endSession = useCallback(async () => {
    if (!sessionId || !ipc()) return { success: false };
    setReportError(null);
    const result = await ipc().invoke('session:end', { sessionId, generateReport: true });
    if (result?.success) setGenerating(true);
    else setReportError(result?.error || 'Falha ao encerrar a sessão');
    return result;
  }, [sessionId]);

  return { details, loading, generating, reportError, reload, generateReport, endSession };
}

export const formatSessionDuration = (start: number, end?: number | null): string | null => {
  if (!end || end <= start) return null;
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};
