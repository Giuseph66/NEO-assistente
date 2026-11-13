import { useEffect, useState } from 'react';
import './TextHighlightOutput.css';
import { GeminiIcon, OpenAIIcon, OllamaIcon, ClaudeIcon } from '../Icons';

type TextHighlightTranscription = {
  text: string;
  mode: 'local' | 'ai';
  createdAt: number;
  providerId?: string;
};

const formatDate = (timestamp: number): string => {
  try {
    return new Date(timestamp).toLocaleString('pt-BR');
  } catch {
    return '';
  }
};

export function TextHighlightOutput(): JSX.Element {
  const [payload, setPayload] = useState<TextHighlightTranscription | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timeout: number | null = null;
    const offTranscription = window.textHighlightAPI?.onTranscription((next) => {
      setPayload(next);
      setCopied(false);
    });

    window.textHighlightAPI?.getLastTranscription?.().then((last) => {
      if (last) {
        setPayload(last);
      }
    }).catch(() => undefined);

    return () => {
      offTranscription?.();
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!payload?.text) return;
    try {
      await navigator.clipboard.writeText(payload.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  const getProviderIcon = (providerId?: string) => {
  switch (providerId) {
      case 'gemini':
        return <GeminiIcon size={18} />;
      case 'openai':
      case 'openai-codex':
      case 'codex-cli':
        return <OpenAIIcon size={18} />;
      case 'anthropic':
      case 'claude-code':
        return <ClaudeIcon size={18} />;
      case 'ollama':
        return <OllamaIcon size={18} />;
      default:
        return null;
    }
  };

  return (
    <div className="text-highlight-output">
      <header className="text-highlight-output__header">
        <div className="text-highlight-output__title">
          <h2>Transcrição da Tela{payload?.providerId ? <span className="text-highlight-output__provider-icon">{getProviderIcon(payload?.providerId)}</span> : null}</h2>
          <span className="text-highlight-output__meta">
            {payload ? (
              payload.mode === 'ai' ? (
                <>
                  {' IA • '}{formatDate(payload.createdAt)}
                </>
              ) : (
                <>Local • {formatDate(payload.createdAt)}</>
              )
            ) : 'Sem resultados'}
          </span>
        </div>
        <div className="text-highlight-output__actions">
          <button className="text-highlight-output__btn" onClick={handleCopy} disabled={!payload?.text}>
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button
            className="text-highlight-output__btn ghost"
            onClick={() => window.electron.ipcRenderer.send('window:close')}
          >
            Fechar
          </button>
        </div>
      </header>

      <main className="text-highlight-output__body">
        {payload?.text ? (
          <pre className="text-highlight-output__text">{payload.text}</pre>
        ) : (
          <div className="text-highlight-output__empty">
            Nenhuma transcrição disponível ainda.
          </div>
        )}
      </main>
    </div>
  );
}
