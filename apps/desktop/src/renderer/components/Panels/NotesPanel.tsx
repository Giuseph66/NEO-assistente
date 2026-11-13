import { useEffect, useRef, useState } from 'react';
import '../Session/SessionReport.css';

type Props = {
  sessionId?: number | null;
};

const ipc = () => (window as any).electron?.ipcRenderer;
const SAVE_DELAY_MS = 800;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Notes of the active session. Saved automatically (debounced) to the session they
 * were typed in; typing with no session open creates one. Pending text is flushed
 * when the session changes or the panel closes, so switching tabs never loses notes.
 */
export function NotesPanel({ sessionId }: Props): JSX.Element {
  const [content, setContent] = useState('');
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pendingRef = useRef<{ sessionId: number | null; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensuringRef = useRef<Promise<number | null> | null>(null);

  const persist = async (target: { sessionId: number | null; text: string }) => {
    let id = target.sessionId;
    if (!id) {
      ensuringRef.current ??= ipc()
        ?.invoke('session:ensure')
        .then((r: { sessionId: number | null }) => r?.sessionId ?? null)
        .finally(() => {
          ensuringRef.current = null;
        });
      id = (await ensuringRef.current) ?? null;
    }
    if (!id) {
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    const result = await ipc()?.invoke('session:notes-save', { sessionId: id, notes: target.text });
    setSaveState(result?.success ? 'saved' : 'error');
  };

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void persist(pending);
  };

  // Load the notes of the session (flushing what was typed for the previous one).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) {
        setContent('');
        setLoadedFor(null);
        return;
      }
      const details = await ipc()?.invoke('session:get', sessionId);
      if (cancelled) return;
      // Keep text typed before the session existed (it is being saved into this one).
      setContent((prev) => (loadedFor === null && prev && !details?.notes ? prev : details?.notes || ''));
      setLoadedFor(sessionId);
      setSaveState('idle');
    })();
    return () => {
      cancelled = true;
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => () => flush(), []);

  const onChange = (text: string) => {
    setContent(text);
    pendingRef.current = { sessionId: sessionId ?? null, text };
    setSaveState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const status =
    saveState === 'saving' || saveState === 'pending'
      ? 'Salvando…'
      : saveState === 'saved'
        ? 'Salvo'
        : saveState === 'error'
          ? 'Não foi possível salvar'
          : '';

  return (
    <div className="notes-view">
      <div className="notes-header">
        <div>
          <h3>Notas</h3>
          <p>{sessionId ? `Sessão #${sessionId} · entram no relatório ao encerrar` : 'Comece a escrever: uma sessão é criada automaticamente'}</p>
        </div>
        <span className={`notes-status ${saveState}`}>{status}</span>
      </div>
      <textarea
        className="notes-textarea"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
        placeholder={'Ideias, decisões, nomes, números…\nTudo aqui entra no resumo da sessão.'}
        spellCheck
      />
    </div>
  );
}
