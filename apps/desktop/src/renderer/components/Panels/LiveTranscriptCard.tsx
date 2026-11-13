import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveEntry,
  LiveSource,
  SOURCE_LABEL,
  formatEntries,
  formatEntryTime,
} from '../../store/liveTranscriptStore';

type Filter = 'all' | LiveSource;

type Props = {
  entries: LiveEntry[];
  partials: Record<LiveSource, string>;
  micActive: boolean;
  systemActive: boolean;
  onInsert: (text: string) => void;
  onClear: () => void;
};

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'mic', label: 'Você' },
  { id: 'system', label: 'Sistema' },
];

/**
 * What you say (microphone) and what the computer plays (system audio), kept apart:
 * system on the left, you on the right, each with its own colour and filter.
 */
export function LiveTranscriptCard({ entries, partials, micActive, systemActive, onInsert, onClear }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const visible = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.source === filter)),
    [entries, filter]
  );
  const counts = useMemo(
    () => ({
      all: entries.length,
      mic: entries.filter((e) => e.source === 'mic').length,
      system: entries.filter((e) => e.source === 'system').length,
    }),
    [entries]
  );

  const live: Array<{ source: LiveSource; text: string }> = [];
  if (systemActive && partials.system && filter !== 'mic') live.push({ source: 'system', text: partials.system });
  if (micActive && partials.mic && filter !== 'system') live.push({ source: 'mic', text: partials.mic });

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, partials.mic, partials.system, collapsed, filter]);

  const copy = async () => {
    const text = formatEntries(visible);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable: nothing to do
    }
  };

  return (
    <section className={`live-transcript ${collapsed ? 'collapsed' : ''}`} aria-label="Transcrição ao vivo">
      <header className="live-transcript-header">
        <button
          type="button"
          className="live-transcript-toggle"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          title={collapsed ? 'Mostrar transcrição' : 'Recolher transcrição'}
        >
          <span className="live-transcript-title">Transcrição ao vivo</span>
          <span className={`live-chip source-mic ${micActive ? 'live' : ''}`}>
            <span className="live-dot" />Você
          </span>
          <span className={`live-chip source-system ${systemActive ? 'live' : ''}`}>
            <span className="live-dot" />Sistema
          </span>
          <svg className="live-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 15 12 9 18 15" />
          </svg>
        </button>
        {!collapsed && (
          <div className="live-transcript-actions">
            <button type="button" onClick={() => onInsert(formatEntries(visible))} disabled={visible.length === 0} title="Colocar no campo de mensagem para perguntar à IA">
              Inserir no campo
            </button>
            <button type="button" onClick={copy} disabled={visible.length === 0}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={entries.length === 0}
              title="Limpa só esta visualização: a transcrição continua salva na sessão e entra no resumo"
            >
              Limpar
            </button>
          </div>
        )}
      </header>

      {!collapsed && (
        <>
          <div className="live-filter" role="tablist" aria-label="Filtrar por fonte">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`live-filter-tab ${filter === item.id ? 'selected' : ''} filter-${item.id}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className="live-filter-count">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div
            className="live-transcript-list"
            ref={listRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {visible.length === 0 && live.length === 0 && (
              <div className="live-empty">
                {systemActive || micActive ? 'Ouvindo… as falas aparecem aqui.' : 'Nenhuma transcrição nesta conversa.'}
              </div>
            )}
            {visible.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={`live-line source-${entry.source}`}
                onClick={() => onInsert(`${SOURCE_LABEL[entry.source]}: ${entry.text}`)}
                title="Clique para inserir no campo"
              >
                <span className="live-line-meta">
                  <span className="live-line-speaker">{SOURCE_LABEL[entry.source]}</span>
                  <span className="live-line-time">{formatEntryTime(entry.ts)}</span>
                </span>
                <span className="live-line-text">{entry.text}</span>
              </button>
            ))}
            {live.map((item) => (
              <div key={`live-${item.source}`} className={`live-line pending source-${item.source}`}>
                <span className="live-line-meta">
                  <span className="live-line-speaker">{SOURCE_LABEL[item.source]}</span>
                  <span className="live-line-time">agora</span>
                </span>
                <span className="live-line-text">{item.text === '…' ? 'transcrevendo…' : item.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
