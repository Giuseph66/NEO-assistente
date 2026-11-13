import React, { useState, useEffect, useRef } from 'react';
import './AIChatPanel.css';
import {
  STTStatus,
  STTPartialEvent,
  STTFinalEvent,
  SystemAudioSourceInfo,
} from '@neo/shared';
import { GeminiIcon, OpenAIIcon, OllamaIcon, ProviderIcon, ClaudeIcon } from '../Icons';
import { useSharedInputValue } from '../../store/sharedInputStore';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imagePath?: string;
  imageBase64?: string;
  screenshotId?: number;
}

interface AIChatPanelProps {
  sessionId?: number | null;
}

const defaultStatus: STTStatus = { state: 'idle' };

export const AIChatPanel: React.FC<AIChatPanelProps> = ({ sessionId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useSharedInputValue();
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // STT States
  const [systemSttStatus, setSystemSttStatus] = useState<STTStatus>(defaultStatus);
  const [micSttStatus, setMicSttStatus] = useState<STTStatus>(defaultStatus);
  const [systemSttPartial, setSystemSttPartial] = useState<string | null>(null);
  const [micSttPartial, setMicSttPartial] = useState<string | null>(null);
  const [systemSources, setSystemSources] = useState<SystemAudioSourceInfo[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [sttError, setSttError] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<{ path: string; base64: string; screenshotId?: number } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // AI Chat States
  const [activePersonality, setActivePersonality] = useState<any | null>(null);
  const [currentProviderId, setCurrentProviderId] = useState<string>('gemini');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(sessionId || null);
  const currentSessionIdRef = useRef<number | null>(sessionId || null);
  const suppressStartedRef = useRef<{ prompt: string; sessionId: number | null } | null>(null);
  const partialStateRef = useRef({ mic: '', micAt: 0, system: '', systemAt: 0 });
  const inputResizeRef = useRef<number | null>(null);

  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  // Close action menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setIsActionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const mapMessages = (rows: any[]): Message[] =>
    rows
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        id: String(msg.id ?? `${msg.role}-${msg.createdAt}`),
        role: msg.role,
        content: msg.content || '',
        timestamp: msg.createdAt || Date.now(),
      }));

  const loadSessionMessages = async (targetSessionId: number, attempt: number = 0) => {
    if (!window.ai?.getMessages) return;
    try {
      const rows = await window.ai.getMessages(targetSessionId);
      const mapped = mapMessages(Array.isArray(rows) ? rows : []);
      setMessages(mapped);
      if (mapped.length === 0 && attempt < 3) {
        setTimeout(() => loadSessionMessages(targetSessionId, attempt + 1), 200);
      }
    } catch (error) {
      console.error('Failed to load session messages:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 200;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (inputResizeRef.current) {
      window.cancelAnimationFrame(inputResizeRef.current);
    }
    inputResizeRef.current = window.requestAnimationFrame(() => {
      resizeInput();
    });
    return () => {
      if (inputResizeRef.current) {
        window.cancelAnimationFrame(inputResizeRef.current);
        inputResizeRef.current = null;
      }
    };
  }, [inputValue, systemSttPartial, micSttPartial]);

  // Load initial messages or mock data
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (sessionId) {
      setCurrentSessionId(sessionId);
      loadSessionMessages(sessionId);
      return;
    }
    setCurrentSessionId(null);
    setMessages([
      { id: '1', role: 'assistant', content: 'Olá! Como posso ajudar você hoje?', timestamp: Date.now() }
    ]);
  }, [sessionId]);

  // Load configurations (personality and API config)
  useEffect(() => {
    loadConfigurations();
  }, []);

  // Poll for AI config changes to update provider icon in real-time
  useEffect(() => {
    const updateProvider = async () => {
      if (window.ai) {
        try {
          const config = await window.ai.getConfig();
          if (config?.providerId && config.providerId !== currentProviderId) {
            setCurrentProviderId(config.providerId);
          }
        } catch (error) {
          console.error('Failed to update provider:', error);
        }
      }
    };

    // Update immediately
    updateProvider();

    // Poll every 2 seconds to catch real-time changes
    const interval = setInterval(updateProvider, 2000);

    return () => clearInterval(interval);
  }, [currentProviderId]);

  const loadConfigurations = async () => {
    try {
      if (window.ai) {
        // Load active personality
        const personalityResult = await window.ai.getActivePersonality();
        if (personalityResult?.promptId) {
          const templates = await window.ai.getPromptTemplates('personality');
          const active = templates.find((t: any) => t.id === personalityResult.promptId);
          setActivePersonality(active || null);
        }
        
        // Load current AI provider
        const config = await window.ai.getConfig();
        if (config?.providerId) {
          setCurrentProviderId(config.providerId);
        }
      }
    } catch (error) {
      console.error('Failed to load configurations:', error);
    }
  };

  // Helper function to get the correct icon based on provider
  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case 'gemini':
        return <GeminiIcon size={18} />;
      case 'openai':
      case 'openai-codex':
      case 'codex-cli':
        return (
          <ProviderIcon size={18} viewBox="0 0 24 24">
            <defs>
              <linearGradient id="openai-gradient-white" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>
            <path
              d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
              fill="url(#openai-gradient-white)"
            />
          </ProviderIcon>
        );
      case 'anthropic':
      case 'claude-code':
        return <ClaudeIcon size={18} />;
      case 'ollama':
      case 'local':
        return <OllamaIcon size={18} />;
      default:
        return <GeminiIcon size={18} />;
    }
  };

  // AI Analysis Event Listeners for Progress
  useEffect(() => {
    if (!window.ai) return;

    const offStarted = window.ai.onAnalysisStarted((event: any) => {
      setIsLoading(true);
      setProgress(20);
      if (event?.mode !== 'chat') return;

      const eventSessionId = typeof event.sessionId === 'number' ? event.sessionId : null;
      if (eventSessionId && !currentSessionIdRef.current) {
        setCurrentSessionId(eventSessionId);
      }

      const suppress = suppressStartedRef.current;
      if (suppress && suppress.prompt === event.prompt && suppress.sessionId === eventSessionId) {
        suppressStartedRef.current = null;
        return;
      }

      if (typeof event.prompt === 'string' && event.prompt.trim()) {
        const pendingMessage: Message = {
          id: `pending-${Date.now()}`,
          role: 'user',
          content: event.prompt,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, pendingMessage]);
      }

      setIsTyping(true);
    });

    const offCompleted = window.ai.onAnalysisCompleted((event: any) => {
      setProgress(100);
      setTimeout(() => {
        setIsLoading(false);
        setProgress(0);
      }, 300);
      setIsTyping(false);
      if (event?.mode === 'chat' && event.sessionId) {
        if (!currentSessionIdRef.current) {
          setCurrentSessionId(event.sessionId);
        }
        if (!currentSessionIdRef.current || event.sessionId === currentSessionIdRef.current) {
          loadSessionMessages(event.sessionId);
        }
      }
    });

    const offError = window.ai.onAnalysisError((event: any) => {
      setIsLoading(false);
      setProgress(0);
      setIsTyping(false);
      setSttError(event.error || 'Erro ao processar mensagem');
    });

    return () => {
      offStarted();
      offCompleted();
      offError();
    };
  }, []);

  // Load system audio sources
  const loadSystemSources = async () => {
    if (!window.systemAudio) return;
    try {
      const sources = await window.systemAudio.listSources();
      const nextSources = Array.isArray(sources) ? sources : [];
      setSystemSources(nextSources);
      const defaultSource = nextSources.find((source) => source.isDefaultCandidate)?.id;
      if (defaultSource && defaultSource !== selectedSourceId) {
        setSelectedSourceId(defaultSource);
      } else if (!selectedSourceId && nextSources.length > 0) {
        setSelectedSourceId(nextSources[0]?.id || '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao listar dispositivos de audio';
      setSttError(message);
    }
  };

  const detectDefaultSource = async (): Promise<string | null> => {
    if (!window.systemAudio) return null;
    try {
      const sourceId = await window.systemAudio.detectDefaultMonitor();
      if (sourceId) {
        setSelectedSourceId(sourceId);
      }
      return sourceId || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao detectar monitor padrao';
      setSttError(message);
    }
    return null;
  };

  // Initialize system audio sources
  useEffect(() => {
    loadSystemSources();
  }, []);

  // Clean STT text - remove UNK tokens and normalize
  const cleanSttText = (text: string): string => {
    if (!text) return '';
    // Remove <UNK>, <unk>, <UNK>, etc. (case insensitive) and surrounding spaces
    let cleaned = text.replace(/<UNK>/gi, '');
    cleaned = cleaned.replace(/<noise>/gi, '');
    cleaned = cleaned.replace(/<silence>/gi, '');
    // Remove multiple spaces and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (/^[\.\,\!\?\:\;]+$/.test(cleaned)) {
      return '';
    }
    return cleaned;
  };

  const longestCommonPrefixLength = (a: string, b: string): number => {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i += 1;
    return i;
  };

  const getStablePartial = (source: 'mic' | 'system', nextText: string): string => {
    const state = partialStateRef.current;
    const prevText = source === 'mic' ? state.mic : state.system;
    const prevAt = source === 'mic' ? state.micAt : state.systemAt;
    const now = Date.now();

    if (!nextText) {
      if (source === 'mic') {
        state.mic = '';
        state.micAt = now;
      } else {
        state.system = '';
        state.systemAt = now;
      }
      return '';
    }

    if (!prevText) {
      if (source === 'mic') {
        state.mic = nextText;
        state.micAt = now;
      } else {
        state.system = nextText;
        state.systemAt = now;
      }
      return nextText;
    }

    if (nextText === prevText) {
      return prevText;
    }

    if (nextText.startsWith(prevText)) {
      if (source === 'mic') {
        state.mic = nextText;
        state.micAt = now;
      } else {
        state.system = nextText;
        state.systemAt = now;
      }
      return nextText;
    }

    if (prevText.startsWith(nextText)) {
      return prevText;
    }

    const prefixLen = longestCommonPrefixLength(prevText, nextText);
    const prefixRatio = prefixLen / Math.max(prevText.length, nextText.length);
    if (prefixLen >= 6 && prefixRatio >= 0.6) {
      const merged = prevText.slice(0, prefixLen) + nextText.slice(prefixLen);
      if (source === 'mic') {
        state.mic = merged;
        state.micAt = now;
      } else {
        state.system = merged;
        state.systemAt = now;
      }
      return merged;
    }

    if (now - prevAt > 900) {
      if (source === 'mic') {
        state.mic = nextText;
        state.micAt = now;
      } else {
        state.system = nextText;
        state.systemAt = now;
      }
      return nextText;
    }

    return prevText;
  };

  const clearPartialCache = (source: 'mic' | 'system') => {
    if (source === 'mic') {
      partialStateRef.current.mic = '';
      partialStateRef.current.micAt = 0;
    } else {
      partialStateRef.current.system = '';
      partialStateRef.current.systemAt = 0;
    }
  };

  const mergeFinalText = (currentText: string, nextText: string): string => {
    const base = currentText.trim();
    const next = nextText.trim();
    if (!base) return next;
    if (!next) return base;

    const baseLower = base.toLowerCase();
    const nextLower = next.toLowerCase();
    const maxOverlap = Math.min(40, Math.min(baseLower.length, nextLower.length));
    let overlap = 0;
    for (let i = maxOverlap; i > 0; i -= 1) {
      if (baseLower.endsWith(nextLower.slice(0, i))) {
        overlap = i;
        break;
      }
    }
    const suffix = next.slice(overlap).trimStart();
    if (!suffix) return base;
    return `${base}${base.endsWith(' ') ? '' : ' '}${suffix}`;
  };

  // STT Microphone listeners
  useEffect(() => {
    if (!window.stt) return;
    window.stt.getStatus().then((status) => setMicSttStatus(status || defaultStatus));
    const offStatus = window.stt.onStatus((status) => {
      setMicSttStatus(status);
      if (status.state === 'idle' || status.state === 'error') {
        clearPartialCache('mic');
        setMicSttPartial(null);
      }
    });
    const offPartial = window.stt.onPartial((event: STTPartialEvent) => {
      const cleanedText = cleanSttText(event.text);
      const stableText = getStablePartial('mic', cleanedText);
      setMicSttPartial(stableText || null);
      setSttError(null);
    });
    const offFinal = window.stt.onFinal((event: STTFinalEvent) => {
      const cleanedText = cleanSttText(event.text);
      if (cleanedText.trim()) {
        const newText = mergeFinalText(inputValue, cleanedText);
        setInputValue(newText);
        setMicSttPartial(null);
        clearPartialCache('mic');
        // Focus input and move cursor to end
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(newText.length, newText.length);
          }
        }, 0);
      } else {
        setMicSttPartial(null);
      }
      setSttError(null);
    });
    const offError = window.stt.onError((payload) => {
      setSttError(payload.message);
      setMicSttPartial(null);
    });
    return () => {
      offStatus();
      offPartial();
      offFinal();
      offError();
    };
  }, [inputValue]);

  // STT System listeners
  useEffect(() => {
    if (!window.systemStt) return;
    window.systemStt.getStatus().then((status) => setSystemSttStatus(status || defaultStatus));
    const offStatus = window.systemStt.onStatus((status) => {
      setSystemSttStatus(status);
      if (status.state === 'idle') {
        setSystemSttPartial(null);
        clearPartialCache('system');
      }
      if (status.state === 'error') {
        setSystemSttPartial(null);
        clearPartialCache('system');
      }
    });
    const offPartial = window.systemStt.onPartial((event: STTPartialEvent) => {
      const cleanedText = cleanSttText(event.text);
      const stableText = getStablePartial('system', cleanedText);
      setSystemSttPartial(stableText || null);
      setSttError(null);
    });
    const offFinal = window.systemStt.onFinal((event: STTFinalEvent) => {
      const cleanedText = cleanSttText(event.text);
      if (cleanedText.trim()) {
        const newText = mergeFinalText(inputValue, cleanedText);
        setInputValue(newText);
        setSystemSttPartial(null);
        clearPartialCache('system');
        // Focus input and move cursor to end
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(newText.length, newText.length);
          }
        }, 0);
      } else {
        setSystemSttPartial(null);
      }
      setSttError(null);
    });
    const offError = window.systemStt.onError((payload) => {
      setSttError(payload.message);
      setSystemSttPartial(null);
    });
    return () => {
      offStatus();
      offPartial();
      offFinal();
      offError();
    };
  }, [inputValue]);

  // Update cursor position when preview changes
  useEffect(() => {
    const hasPreview = !!(systemSttPartial || micSttPartial);
    if (!inputRef.current || !hasPreview) return;
    const activePartial = systemSttPartial || micSttPartial;
    const displayValue = inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + (activePartial || '');
    // Move cursor to end of preview
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(displayValue.length, displayValue.length);
      }
    }, 0);
  }, [systemSttPartial, micSttPartial, inputValue]);

  // STT Control Functions
  const toggleSystemStt = async () => {
    if (!window.systemStt) return;
    setSttError(null);

    const isRunning =
      systemSttStatus.state === 'running' ||
      systemSttStatus.state === 'listening' ||
      systemSttStatus.state === 'starting';
    if (isRunning) {
      await window.systemStt.stop();
      setSystemSttPartial(null);
      return;
    }

    const resolvedSourceId = selectedSourceId || (await detectDefaultSource());
    if (!resolvedSourceId) {
      setSttError('Selecione um dispositivo de audio do sistema');
      return;
    }

    try {
      await window.systemStt.start({ sourceId: resolvedSourceId });
      setSystemSttPartial(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao iniciar STT do sistema';
      setSttError(message);
    }
  };

  const toggleMicStt = async () => {
    if (!window.stt) return;
    setSttError(null);

    const isRunning =
      micSttStatus.state === 'running' ||
      micSttStatus.state === 'listening' ||
      micSttStatus.state === 'starting';
    if (isRunning) {
      await window.stt.stop();
      setMicSttPartial(null);
      return;
    }

    try {
      await window.stt.start();
      setMicSttPartial(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao iniciar STT do microfone';
      setSttError(message);
    }
  };

  const isSystemSttActive =
    systemSttStatus.state === 'running' ||
    systemSttStatus.state === 'listening' ||
    systemSttStatus.state === 'starting';
  const isMicSttActive =
    micSttStatus.state === 'running' ||
    micSttStatus.state === 'listening' ||
    micSttStatus.state === 'starting';

  // Get display value for input (show preview if available)
  const getInputDisplayValue = () => {
    const activePartial = systemSttPartial || micSttPartial;
    if (activePartial) {
      // Show committed text + preview
      return inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + activePartial;
    }
    return inputValue;
  };

  const hasPreview = !!(systemSttPartial || micSttPartial);

  // Sincroniza o texto completo (incluindo parciais do STT) com o main process para o atalho de colar
  // SEM debounce (para testar instantâneo)
  useEffect(() => {
    const activePartial = systemSttPartial || micSttPartial;
    const fullText = activePartial
      ? inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + activePartial
      : inputValue;

    if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer) {
      (window as any).electron.ipcRenderer.send('stt-input:update', fullText);
    }
  }, [inputValue, systemSttPartial, micSttPartial]);

  // Minimize all windows
  const minimizeAllWindows = async () => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('window:minimize-all');
    }
  };

  // Convert image to base64
  const imageToBase64 = async (filePath: string): Promise<string> => {
    try {
      if (window.electron?.ipcRenderer) {
        const result = await window.electron.ipcRenderer.invoke('screenshot:read', { filePath });
        if (result.base64) {
          const mimeType = result.mimeType || 'image/png';
          return `data:${mimeType};base64,${result.base64}`;
        }
      }
      throw new Error('Failed to read image');
    } catch (error) {
      console.error('Error converting image to base64:', error);
      throw error;
    }
  };

  // Handle area screenshot (Imagem button)
  const handleAreaScreenshot = async () => {
    setIsCapturing(true);
    try {
      // Minimize all windows
      await minimizeAllWindows();

      // Wait a bit for windows to minimize
      await new Promise(resolve => setTimeout(resolve, 300));

      // Capture area interactively
      if (window.electron?.ipcRenderer) {
        const result = await window.electron.ipcRenderer.invoke('screenshot:capture-area-interactive');

        if (result.success && result.path) {
          const base64 = await imageToBase64(result.path);
          setAttachedImage({
            path: result.path,
            base64,
            screenshotId: result.screenshotId
          });
        } else if (result.error && result.error !== 'Selecao cancelada') {
          setSttError(result.error || 'Falha ao capturar screenshot');
        }
      }
    } catch (error: any) {
      setSttError(error.message || 'Falha ao capturar screenshot');
    } finally {
      setIsCapturing(false);
    }
  };

  // Handle fullscreen screenshot (Captura button)
  const handleFullscreenScreenshot = async () => {
    setIsCapturing(true);
    try {
      // Minimize all windows
      await minimizeAllWindows();

      // Wait a bit for windows to minimize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Capture fullscreen
      if (window.electron?.ipcRenderer) {
        const result = await window.electron.ipcRenderer.invoke('screenshot:captureFullscreen');

        if (result.success && result.path) {
          const base64 = await imageToBase64(result.path);
          setAttachedImage({
            path: result.path,
            base64,
            screenshotId: result.screenshotId
          });
        } else {
          setSttError(result.error || 'Falha ao capturar screenshot');
        }
      }
    } catch (error: any) {
      setSttError(error.message || 'Falha ao capturar screenshot');
    } finally {
      setIsCapturing(false);
    }
  };

  const compressImage = async (base64DataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          // Create canvas
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Calculate new dimensions (max 1280px)
          const maxDimension = 1280;
          let width = img.width;
          let height = img.height;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = (height / width) * maxDimension;
              width = maxDimension;
            } else {
              width = (width / height) * maxDimension;
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          // Draw and compress
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.8);
          resolve(compressed);
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = base64DataUrl;
      } catch (error) {
        reject(error);
      }
    });
  };

  const handleSendMessage = async () => {
    // Clear any preview before sending
    const textToSend = inputValue.trim();
    if (!textToSend && !attachedImage) return;

    // Clear previews
    setSystemSttPartial(null);
    setMicSttPartial(null);

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend || '',
      timestamp: Date.now(),
      ...(attachedImage && {
        imagePath: attachedImage.path,
        imageBase64: attachedImage.base64,
        screenshotId: attachedImage.screenshotId
      })
    };

    setMessages(prev => [...prev, newMessage]);
    setInputValue('');
    const imageToSend = attachedImage;
    setAttachedImage(null);
    setIsTyping(true);
    setProgress(10);

    try {
      // Get personality context
      const context = activePersonality?.promptText || undefined;

      let result;
      if (imageToSend && imageToSend.screenshotId) {
        // Chat with screenshot
        setProgress(30);

        result = await window.ai.analyzeScreenshot({
          screenshotId: imageToSend.screenshotId,
          prompt: textToSend || 'Analise esta imagem',
          sessionId: currentSessionId || undefined,
          context
        });
      } else {
        // Text-only chat
        setProgress(30);

        suppressStartedRef.current = { prompt: textToSend, sessionId: currentSessionId || null };
        result = await window.ai.analyzeText({
          prompt: textToSend,
          sessionId: currentSessionId || undefined,
          context
        });
      }

      if (result.success && result.response) {
        // Update session ID if new
        if (result.sessionId && !currentSessionId) {
          setCurrentSessionId(result.sessionId);
        }

        const responseText = result.response.answerText || 'Processado com sucesso.';
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: responseText,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, aiResponse]);
      } else {
        throw new Error(result.error || 'Falha ao processar mensagem');
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ Erro: ${error.message || 'Erro desconhecido ao processar mensagem'}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorResponse]);
      setSttError(error.message || 'Erro ao enviar mensagem');
    } finally {
      setIsTyping(false);
      setProgress(100);
      setTimeout(() => setProgress(0), 300);
      suppressStartedRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="ai-chat-panel">
      <div className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id} className={`message-row ${msg.role}`}>
            <div className="message-bubble">
              {msg.role === 'assistant' && (
                <div className="avatar">
                  {getProviderIcon(currentProviderId)}
                </div>
              )}
              <div className="message-content">
                {msg.imageBase64 && (
                  <div className="message-image">
                    <img src={msg.imageBase64} alt="Screenshot" />
                  </div>
                )}
                {msg.content && <div>{msg.content}</div>}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="message-row assistant">
            <div className="message-bubble typing">
              <div className="avatar">
                {getProviderIcon(currentProviderId)}
              </div>
              <div className="typing-dots">
                <span>.</span><span>.</span><span>.</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area-wrapper">
        <div className="input-container-outer">
          {attachedImage && (
            <div className="attached-image-preview">
              <img src={attachedImage.base64} alt="Screenshot anexado" />
              <button
                className="remove-image-btn"
                onClick={() => setAttachedImage(null)}
                title="Remover imagem"
              >
                ✕
              </button>
            </div>
          )}

          <div className="input-island">
            <div className="input-actions-left" ref={actionMenuRef}>
              <button
                className={`icon-btn action-trigger ${isActionMenuOpen ? 'active' : ''}`}
                onClick={() => setIsActionMenuOpen(!isActionMenuOpen)}
                title="Ações e Ferramentas"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>

              {isActionMenuOpen && (
                <div className="action-menu-popover">
                  <button
                    className={`menu-item ${isCapturing ? 'loading' : ''}`}
                    onClick={() => { handleAreaScreenshot(); setIsActionMenuOpen(false); }}
                    disabled={isCapturing}
                  >
                    <span className="menu-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
                        <path d="M16 19h6" />
                        <path d="M19 16v6" />
                      </svg>
                    </span>
                    <div className="menu-text">
                      <span className="menu-title">Capturar Área</span>
                      <span className="menu-desc">Selecione uma parte da tela</span>
                    </div>
                  </button>

                  <button
                    className={`menu-item ${isCapturing ? 'loading' : ''}`}
                    onClick={() => { handleFullscreenScreenshot(); setIsActionMenuOpen(false); }}
                    disabled={isCapturing}
                  >
                    <span className="menu-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </span>
                    <div className="menu-text">
                      <span className="menu-title">Tela Inteira</span>
                      <span className="menu-desc">Captura todo o monitor</span>
                    </div>
                  </button>

                  <div className="menu-divider"></div>

                  <button
                    className={`menu-item ${isSystemSttActive ? 'active' : ''}`}
                    onClick={() => { toggleSystemStt(); setIsActionMenuOpen(false); }}
                  >
                    <span className="menu-icon">
                      {isSystemSttActive ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                    </span>
                    <div className="menu-text">
                      <span className="menu-title">Áudio do Sistema</span>
                      <span className="menu-desc">{isSystemSttActive ? 'Parar transcrição' : 'Transcrever áudio interno'}</span>
                    </div>
                  </button>

                  <button
                    className={`menu-item ${isMicSttActive ? 'active' : ''}`}
                    onClick={() => { toggleMicStt(); setIsActionMenuOpen(false); }}
                  >
                    <span className="menu-icon">
                      {isMicSttActive ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                          <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                      )}
                    </span>
                    <div className="menu-text">
                      <span className="menu-title">Microfone</span>
                      <span className="menu-desc">{isMicSttActive ? 'Parar transcrição' : 'Transcrever sua voz'}</span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={inputRef}
              value={getInputDisplayValue()}
              onChange={(e) => {
                const newValue = e.target.value;
                const activePartial = systemSttPartial || micSttPartial;

                if (activePartial) {
                  setSystemSttPartial(null);
                  setMicSttPartial(null);
                  setInputValue(newValue);
                } else {
                  setInputValue(newValue);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem..."
              rows={1}
              className={`chat-input ${hasPreview ? 'has-preview' : ''}`}
            />

            <div className="input-actions-right">
              <button
                className={`icon-btn mic-btn ${isMicSttActive || isSystemSttActive ? 'active' : ''}`}
                onClick={isSystemSttActive ? toggleSystemStt : toggleMicStt}
                title={isMicSttActive || isSystemSttActive ? 'Parar Transcrição' : 'Iniciar Microfone'}
              >
                {isSystemSttActive ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                )}
              </button>

              <button
                className="send-btn"
                onClick={handleSendMessage}
                disabled={!inputValue.trim() && !attachedImage}
                title="Enviar mensagem"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>
        {sttError && (
          <div className="stt-error-message">{sttError}</div>
        )}
      </div>

      {/* Progress Bar */}
      {isLoading && (
        <div className="progress-bar-container">
          <div
            className={`progress-bar ${progress < 30 ? 'indeterminate' : ''}`}
            style={{ width: progress >= 30 ? `${progress}%` : undefined }}
          />
        </div>
      )}
    </div>
  );
};
