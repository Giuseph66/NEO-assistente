import { useEffect, useRef, useState } from 'react';
import { useLongPress } from '../../hooks/useLongPress';

type Props = {
  micActive: boolean;
  systemActive: boolean;
  busy?: boolean;
  /** Tap: start the microphone when idle, stop everything when anything runs. */
  onTap: () => void;
  onToggleMic: () => void;
  onToggleSystem: () => void;
  onStopAll: () => void;
};

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const SpeakerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

/**
 * Microphone button of the session input.
 * Tap = microphone on/off. Hold (or right-click, or ArrowUp) = choose sources:
 * microphone and/or system audio, each an independent switch.
 */
export function MicModeButton({
  micActive,
  systemActive,
  busy,
  onTap,
  onToggleMic,
  onToggleSystem,
  onStopAll,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const anyActive = micActive || systemActive;

  const press = useLongPress({
    onTap: () => {
      if (open) {
        setOpen(false);
        return;
      }
      onTap();
    },
    onLongPress: () => setOpen(true),
    onHoldChange: setHolding,
  });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const mode = micActive && systemActive ? 'both' : systemActive ? 'system' : micActive ? 'mic' : 'idle';
  const label =
    mode === 'both'
      ? 'Transcrevendo você e o sistema'
      : mode === 'system'
        ? 'Transcrevendo o áudio do sistema'
        : mode === 'mic'
          ? 'Transcrevendo o microfone'
          : 'Microfone';

  return (
    <div className="mic-mode" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn mic-btn mode-${mode} ${holding ? 'holding' : ''} ${open ? 'open' : ''}`}
        title={`${label} · clique: ${anyActive ? 'parar' : 'ligar microfone'} · segure: escolher fontes`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        {...press}
      >
        <span className="mic-hold-ring" aria-hidden="true" />
        {mode === 'system' ? <SpeakerIcon /> : <MicIcon />}
        {mode === 'both' && <span className="mic-mode-badge" aria-hidden="true" />}
      </button>

      {open && (
        <div className="mic-mode-popover" role="menu" aria-label="Fontes de transcrição">
          <div className="mic-mode-heading">Fontes de transcrição</div>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitemcheckbox"
            aria-checked={micActive}
            className={`mic-mode-item source-mic ${micActive ? 'on' : ''}`}
            onClick={onToggleMic}
          >
            <span className="mic-mode-icon"><MicIcon /></span>
            <span className="mic-mode-text">
              <span className="mic-mode-title">Microfone</span>
              <span className="mic-mode-desc">O que você fala</span>
            </span>
            <span className="mic-mode-switch" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={systemActive}
            className={`mic-mode-item source-system ${systemActive ? 'on' : ''}`}
            onClick={onToggleSystem}
          >
            <span className="mic-mode-icon"><SpeakerIcon /></span>
            <span className="mic-mode-text">
              <span className="mic-mode-title">Áudio do sistema</span>
              <span className="mic-mode-desc">O que toca no computador</span>
            </span>
            <span className="mic-mode-switch" aria-hidden="true" />
          </button>
          <div className="mic-mode-hint">
            {systemActive
              ? 'Você e o sistema aparecem separados na transcrição ao vivo.'
              : 'Só microfone: o que você fala vai direto para o campo de texto.'}
          </div>
          {anyActive && (
            <button type="button" role="menuitem" className="mic-mode-stop" onClick={() => { onStopAll(); setOpen(false); }}>
              Parar tudo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
