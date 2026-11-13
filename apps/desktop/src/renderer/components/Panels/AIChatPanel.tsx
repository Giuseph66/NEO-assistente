import React, { useState, useEffect, useRef } from 'react';
import './AIChatPanel.css';
import { STTStatus, SystemAudioSourceInfo } from '@neo/shared';
import { GeminiIcon, OpenAIIcon, OllamaIcon, ProviderIcon, ClaudeIcon } from '../Icons';
import { getSharedInputValue, useSharedInputValue } from '../../store/sharedInputStore';
import {
  clearLiveEntries,
  isActiveStatus,
  onDictation,
  replaceLiveEntries,
  useLiveTranscript,
} from '../../store/liveTranscriptStore';
import { MicModeButton } from './MicModeButton';
import { LiveTranscriptCard } from './LiveTranscriptCard';
import {
  ChatErrorInfo,
  describeChatError,
  formatDuration,
  formatTokens,
  prettyModelName,
  providerLabel,
} from '../../../common/chat';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imagePath?: string;
  imageBase64?: string;
  screenshotId?: number;
  /** The built-in greeting of an empty chat: not a stored message (no time, model or copy). */
  isWelcome?: boolean;
  /** Answers: which provider/model produced it and how long it took. */
  providerId?: string;
  modelName?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
}

type ChatFailure = { code?: string; message?: string; at: number; modelName?: string };

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const dayKey = (ts: number) => new Date(ts).toDateString();

const dayLabel = (ts: number) => {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

interface AIChatPanelProps {
  sessionId?: number | null;
}


export const AIChatPanel: React.FC<AIChatPanelProps> = ({ sessionId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useSharedInputValue();
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // STT States
  // Mic/system status, routing and the separated transcript live in a shared store
  // (survives tab switches; the HUD reads the same routing).
  const live = useLiveTranscript();
  const systemSttStatus: STTStatus = live.system;
  const micSttStatus: STTStatus = live.mic;
  /** Mic preview shown inside the input: dictation only (mic alone). */
  const [micSttPartial, setMicSttPartial] = useState<string | null>(null);
  const [sttBusy, setSttBusy] = useState(false);
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
  // Conversation header, the model that will answer next, and the last failure (shown in the thread)
  const [conversationInfo, setConversationInfo] = useState<{ title: string | null; createdAt: number } | null>(null);
  const [currentModelName, setCurrentModelName] = useState<string>('');
  const [chatError, setChatError] = useState<ChatFailure | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [typingSince, setTypingSince] = useState<number | null>(null);
  const [typingElapsed, setTypingElapsed] = useState(0);
  // A slow getMessages answering after a newer one must not overwrite it (session switches, retries)
  const loadSeqRef = useRef(0);
  const loadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        providerId: msg.providerId,
        modelName: msg.modelName,
        durationMs: msg.durationMs,
        tokensIn: msg.tokensIn,
        tokensOut: msg.tokensOut,
      }));

  /**
   * Loads one consistent snapshot of the conversation (messages with model/time, title and
   * the last failure, if nothing answered it since). Only the latest call may apply its result.
   */
  const loadSessionMessages = async (targetSessionId: number, attempt: number = 0) => {
    if (!window.ai?.getMessages) return;
    if (attempt === 0) {
      if (loadRetryTimerRef.current) clearTimeout(loadRetryTimerRef.current);
      loadRetryTimerRef.current = null;
    }
    const seq = ++loadSeqRef.current;
    try {
      let rows: any[] = [];
      let info: { title: string | null; createdAt: number } | null = null;
      let failure: ChatFailure | null = null;
      const conversation = window.ai.getConversation ? await window.ai.getConversation(targetSessionId) : null;
      if (conversation) {
        rows = conversation.messages;
        info = { title: conversation.session.title, createdAt: conversation.session.createdAt };
        failure = conversation.lastError
          ? { code: conversation.lastError.code, message: conversation.lastError.message, at: conversation.lastError.at, modelName: conversation.lastError.modelName }
          : null;
      } else {
        const legacy = await window.ai.getMessages(targetSessionId);
        rows = Array.isArray(legacy) ? legacy : [];
      }
      if (seq !== loadSeqRef.current) return; // a newer load (or session switch) took over

      const mapped = mapMessages(rows);
      setMessages(mapped);
      setConversationInfo(info);
      // A failure shows only while it is the last thing that happened; a running request clears it
      setChatError((previous) => failure ?? (previous && previous.at > (mapped[mapped.length - 1]?.timestamp ?? 0) ? previous : null));
      if (mapped.length === 0 && attempt < 3) {
        loadRetryTimerRef.current = setTimeout(() => loadSessionMessages(targetSessionId, attempt + 1), 200);
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
  }, [messages, chatError, isTyping]);

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
  }, [inputValue, micSttPartial]);

  // Load initial messages or mock data
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // A conversation started here (first message) becomes the window's active session,
  // so the Notes/Summary tabs and the transcript follow it.
  useEffect(() => {
    if (currentSessionId && currentSessionId !== (sessionId || null)) {
      window.electron?.ipcRenderer.send('session:activate', currentSessionId, 'auto');
    }
  }, [currentSessionId, sessionId]);

  // The live transcript card shows what is stored for this session.
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      replaceLiveEntries([]);
      return;
    }
    (async () => {
      try {
        const rows = await window.electron?.ipcRenderer.invoke('session:transcript', sessionId);
        if (cancelled || !Array.isArray(rows)) return;
        replaceLiveEntries(
          rows.map((row: { id: number; source: 'mic' | 'system'; text: string; spokenAt: number }) => ({
            id: `db-${row.id}`,
            source: row.source,
            text: row.text,
            ts: row.spokenAt,
          }))
        );
      } catch {
        // keep what is on screen
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    // Invalidate in-flight loads of the previous conversation and update the ref right away:
    // events can arrive before React has re-rendered with the new id.
    loadSeqRef.current += 1;
    if (loadRetryTimerRef.current) clearTimeout(loadRetryTimerRef.current);
    currentSessionIdRef.current = sessionId || null;
    setChatError(null);
    setIsEditingTitle(false);
    if (sessionId) {
      setCurrentSessionId(sessionId);
      setConversationInfo(null);
      loadSessionMessages(sessionId);
      return;
    }
    setCurrentSessionId(null);
    setConversationInfo(null);
    setMessages([
      { id: 'welcome', role: 'assistant', content: 'Olá! Como posso ajudar você hoje?', timestamp: Date.now(), isWelcome: true }
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
          if (config?.modelName) {
            setCurrentModelName((previous) => (previous === config.modelName ? previous : config.modelName));
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
        if (config?.modelName) {
          setCurrentModelName(config.modelName);
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

    // Does an event about `eventSessionId` concern the conversation on screen?
    const concernsCurrent = (eventSessionId: number | null | undefined) =>
      !currentSessionIdRef.current || !eventSessionId || eventSessionId === currentSessionIdRef.current;

    const offStarted = window.ai.onAnalysisStarted((event: any) => {
      setIsLoading(true);
      setProgress(20);
      if (event?.mode !== 'chat') return;

      const eventSessionId = typeof event.sessionId === 'number' ? event.sessionId : null;
      if (eventSessionId && !currentSessionIdRef.current) {
        currentSessionIdRef.current = eventSessionId;
        setCurrentSessionId(eventSessionId);
      }
      if (concernsCurrent(eventSessionId)) {
        setChatError(null); // a new attempt replaces the previous failure
        setIsTyping(true);
      }

      const suppress = suppressStartedRef.current;
      if (suppress && suppress.prompt === event.prompt && suppress.sessionId === eventSessionId) {
        suppressStartedRef.current = null;
        return;
      }

      if (typeof event.prompt === 'string' && event.prompt.trim() && concernsCurrent(eventSessionId)) {
        const pendingMessage: Message = {
          id: `pending-${Date.now()}`,
          role: 'user',
          content: event.prompt,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, pendingMessage]);
      }
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
          currentSessionIdRef.current = event.sessionId;
          setCurrentSessionId(event.sessionId);
        }
        if (event.sessionId === currentSessionIdRef.current) {
          setChatError(null);
          loadSessionMessages(event.sessionId);
        }
      }
    });

    const offError = window.ai.onAnalysisError((event: any) => {
      setIsLoading(false);
      setProgress(0);
      setIsTyping(false);

      if (event?.mode === 'chat' || event?.mode === 'screenshot') {
        // Failures arrive with the conversation id and the reason: show them in the thread
        // (this used to be dropped, so a failed answer looked like "nothing happened").
        const eventSessionId = typeof event.sessionId === 'number' ? event.sessionId : null;
        if (event.mode === 'chat' && !currentSessionIdRef.current && eventSessionId) {
          currentSessionIdRef.current = eventSessionId;
          setCurrentSessionId(eventSessionId);
        }
        // A screenshot analysis started elsewhere only matters here if it is this conversation.
        const concerns = event.mode === 'chat' ? concernsCurrent(eventSessionId) : !!eventSessionId && eventSessionId === currentSessionIdRef.current;
        if (concerns) {
          setChatError({ code: event.errorCode, message: event.error, at: Date.now() });
          const target = eventSessionId ?? currentSessionIdRef.current;
          if (target) loadSessionMessages(target); // the user's message is stored even though the answer failed
        }
        return;
      }
      setSttError(event.error || 'Erro ao processar mensagem');
    });

    const offSessionUpdated = (() => {
      const ipc = (window as any).electron?.ipcRenderer;
      if (!ipc?.on) return () => undefined;
      const handler = (_event: any, payload: { sessionId: number; title: string | null }) => {
        if (payload?.sessionId === currentSessionIdRef.current) {
          setConversationInfo((previous) => (previous ? { ...previous, title: payload.title } : previous));
        }
      };
      ipc.on('session:updated', handler);
      return () => ipc.removeListener?.('session:updated', handler);
    })();

    return () => {
      offStarted();
      offCompleted();
      offError();
      offSessionUpdated();
      if (loadRetryTimerRef.current) clearTimeout(loadRetryTimerRef.current);
    };
  }, []);

  // "Respondendo há 12 s": the request is running, say so (CLI-based providers take a few seconds)
  useEffect(() => {
    if (!isTyping) {
      setTypingSince(null);
      setTypingElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setTypingSince(startedAt);
    const timer = setInterval(() => setTypingElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isTyping]);

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

  // Dictation (mic alone): finals go into the input. Reads the current input from the
  // store, so two finals arriving back to back never overwrite each other.
  useEffect(() => {
    const offDictation = onDictation((text) => {
      const newText = mergeFinalText(getSharedInputValue(), text);
      setInputValue(newText);
      setMicSttPartial(null);
      clearPartialCache('mic');
      setSttError(null);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newText.length, newText.length);
        }
      }, 0);
    });
    return () => {
      offDictation();
    };
  }, []);

  // Mic preview in the input only while dictating; in conversation mode it is shown
  // in the live transcript card instead.
  useEffect(() => {
    const raw = live.conversation ? '' : live.partials.mic;
    if (!raw) {
      clearPartialCache('mic');
      setMicSttPartial(null);
      return;
    }
    const stableText = getStablePartial('mic', cleanSttText(raw) || raw);
    setMicSttPartial(stableText || null);
    setSttError(null);
  }, [live.partials.mic, live.conversation]);

  useEffect(() => {
    const offMicError = window.stt?.onError((payload) => setSttError(payload.message));
    const offSystemError = window.systemStt?.onError((payload) => setSttError(payload.message));
    return () => {
      offMicError?.();
      offSystemError?.();
    };
  }, []);

  // Update cursor position when preview changes
  useEffect(() => {
    const hasPreview = !!micSttPartial;
    if (!inputRef.current || !hasPreview) return;
    const activePartial = micSttPartial;
    const displayValue = inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + (activePartial || '');
    // Move cursor to end of preview
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(displayValue.length, displayValue.length);
      }
    }, 0);
  }, [micSttPartial, inputValue]);

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
      return;
    }

    const resolvedSourceId = selectedSourceId || (await detectDefaultSource());
    if (!resolvedSourceId) {
      setSttError('Selecione um dispositivo de audio do sistema');
      return;
    }

    try {
      await window.systemStt.start({ sourceId: resolvedSourceId });
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

  const isSystemSttActive = isActiveStatus(systemSttStatus);
  const isMicSttActive = isActiveStatus(micSttStatus);

  const runSttAction = async (action: () => Promise<unknown>) => {
    if (sttBusy) return;
    setSttBusy(true);
    try {
      await action();
    } finally {
      setSttBusy(false);
    }
  };

  const stopAllStt = () =>
    runSttAction(() =>
      Promise.allSettled([
        isMicSttActive ? window.stt?.stop() : undefined,
        isSystemSttActive ? window.systemStt?.stop() : undefined,
      ])
    );

  /** Tap on the mic button: start dictation when idle, stop everything otherwise. */
  const handleMicTap = () => {
    if (isMicSttActive || isSystemSttActive) {
      void stopAllStt();
      return;
    }
    void runSttAction(toggleMicStt);
  };

  /** Appends transcript text to the message field (keeps what is already typed). */
  const insertIntoInput = (text: string) => {
    if (!text.trim()) return;
    const current = getSharedInputValue().trimEnd();
    const next = current ? `${current}\n${text}` : text;
    setInputValue(next);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(next.length, next.length);
      }
    }, 0);
  };

  const showLiveTranscript = live.conversation || live.entries.length > 0;

  // Get display value for input (show preview if available)
  const getInputDisplayValue = () => {
    const activePartial = micSttPartial;
    if (activePartial) {
      // Show committed text + preview
      return inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + activePartial;
    }
    return inputValue;
  };

  const hasPreview = !!micSttPartial;

  // Sincroniza o texto completo (incluindo parciais do STT) com o main process para o atalho de colar
  // SEM debounce (para testar instantâneo)
  useEffect(() => {
    const activePartial = micSttPartial;
    const fullText = activePartial
      ? inputValue + (inputValue && !inputValue.endsWith(' ') ? ' ' : '') + activePartial
      : inputValue;

    if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer) {
      (window as any).electron.ipcRenderer.send('stt-input:update', fullText);
    }
  }, [inputValue, micSttPartial]);

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

      const resultSessionId = result.sessionId || currentSessionIdRef.current;
      if (result.sessionId && !currentSessionIdRef.current) {
        currentSessionIdRef.current = result.sessionId;
        setCurrentSessionId(result.sessionId);
      }
      if (!result.success) {
        // The failure is shown in the thread (the user's message is already saved).
        setChatError({ code: (result as any).errorCode, message: result.error || 'Falha ao processar mensagem', at: Date.now() });
      }
      // Reload from the database so the answer carries its model, time and tokens
      if (resultSessionId) await loadSessionMessages(resultSessionId);
    } catch (error: any) {
      console.error('Error sending message:', error);
      setChatError({ message: error?.message || 'Erro desconhecido ao processar mensagem', at: Date.now() });
      setSttError(error.message || 'Erro ao enviar mensagem');
    } finally {
      setIsTyping(false);
      setProgress(100);
      setTimeout(() => setProgress(0), 300);
      suppressStartedRef.current = null;
    }
  };

  /** Ask for the answer to the last message again, without adding another user message. */
  const handleRetry = async () => {
    const target = currentSessionIdRef.current;
    if (!target || isTyping || !window.ai) return;
    setChatError(null);
    setIsTyping(true);
    try {
      const result = await window.ai.analyzeText({ prompt: '', regenerate: true, sessionId: target });
      if (!result.success) {
        setChatError({ code: (result as any).errorCode, message: result.error, at: Date.now() });
      }
      await loadSessionMessages(result.sessionId || target);
    } catch (error: any) {
      setChatError({ message: error?.message || 'Erro ao tentar novamente', at: Date.now() });
    } finally {
      setIsTyping(false);
    }
  };

  const startEditingTitle = () => {
    if (!currentSessionIdRef.current) return;
    setTitleDraft(conversationInfo?.title || '');
    setIsEditingTitle(true);
  };

  const commitTitle = async () => {
    setIsEditingTitle(false);
    const target = currentSessionIdRef.current;
    const next = titleDraft.trim();
    if (!target || next === (conversationInfo?.title || '')) return;
    try {
      const result = await (window as any).electron.ipcRenderer.invoke('session:rename', { sessionId: target, title: next });
      if (result?.success) {
        setConversationInfo((previous) => (previous ? { ...previous, title: result.title } : previous));
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  };

  const copyMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId((current) => (current === message.id ? null : current)), 1500);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const failureInfo: ChatErrorInfo | null = chatError ? describeChatError(chatError.code, chatError.message) : null;
  const realMessages = messages;
  const headerTitle = conversationInfo?.title || (currentSessionId ? `Conversa #${currentSessionId}` : 'Nova conversa');

  return (
    <div className="ai-chat-panel">
      <header className="chat-header">
        <div className="chat-header-icon">{getProviderIcon(currentProviderId)}</div>
        <div className="chat-header-text">
          {isEditingTitle ? (
            <input
              className="chat-title-input"
              autoFocus
              value={titleDraft}
              maxLength={120}
              placeholder="Assunto da conversa"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') setIsEditingTitle(false);
              }}
            />
          ) : (
            <button
              className="chat-title"
              onClick={startEditingTitle}
              disabled={!currentSessionId}
              title={currentSessionId ? 'Clique para renomear a conversa' : undefined}
            >
              {headerTitle}
              {currentSessionId && <span className="chat-title-edit" aria-hidden="true">✎</span>}
            </button>
          )}
          <div className="chat-subtitle">
            {currentSessionId && <span>#{currentSessionId}</span>}
            {conversationInfo && (
              <span>
                {new Date(conversationInfo.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} às {timeOf(conversationInfo.createdAt)}
              </span>
            )}
            {currentSessionId && <span>{messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}</span>}
          </div>
        </div>
        {currentModelName && (
          <div className="chat-model-chip" title="Modelo que responderá a próxima mensagem">
            <span className="chat-model-name">{prettyModelName(currentModelName)}</span>
            <span className="chat-model-provider">{providerLabel(currentProviderId)}</span>
          </div>
        )}
      </header>

      <div className="messages-container">
        {realMessages.map((msg, index) => {
          const previous = realMessages[index - 1];
          const newDay = !msg.isWelcome && (!previous || previous.isWelcome || dayKey(previous.timestamp) !== dayKey(msg.timestamp));
          const answeredBy = msg.role === 'assistant' ? msg.providerId || currentProviderId : currentProviderId;
          const hasMeta = msg.role === 'assistant' && (msg.modelName || msg.durationMs);
          return (
            <React.Fragment key={msg.id}>
              {newDay && <div className="day-separator"><span>{dayLabel(msg.timestamp)}</span></div>}
              <div className={`message-row ${msg.role}`}>
                <div className="message-bubble">
                  {msg.role === 'assistant' && (
                    <div className="avatar">
                      {getProviderIcon(answeredBy)}
                    </div>
                  )}
                  <div className="message-main">
                    <div className="message-content">
                      {msg.imageBase64 && (
                        <div className="message-image">
                          <img src={msg.imageBase64} alt="Screenshot" />
                        </div>
                      )}
                      {msg.content && <div>{msg.content}</div>}
                    </div>
                    {!msg.isWelcome && (
                    <div className="message-meta">
                      {msg.role === 'assistant' && msg.modelName && (
                        <span className="meta-model" title={`${providerLabel(msg.providerId)} · ${msg.modelName}`}>
                          {prettyModelName(msg.modelName)}
                        </span>
                      )}
                      <span className="meta-time" title={new Date(msg.timestamp).toLocaleString('pt-BR')}>{timeOf(msg.timestamp)}</span>
                      {hasMeta && msg.durationMs ? <span className="meta-duration">{formatDuration(msg.durationMs)}</span> : null}
                      {msg.role === 'assistant' && msg.tokensOut ? (
                        <span className="meta-tokens" title={`${msg.tokensIn ?? '?'} tokens de entrada · ${msg.tokensOut} de saída`}>
                          {formatTokens(msg.tokensOut)} tokens
                        </span>
                      ) : null}
                      {msg.role === 'assistant' && msg.content && (
                        <button className="meta-copy" onClick={() => copyMessage(msg)} title="Copiar resposta">
                          {copiedMessageId === msg.id ? 'Copiado ✓' : 'Copiar'}
                        </button>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {isTyping && (
          <div className="message-row assistant">
            <div className="message-bubble typing">
              <div className="avatar">
                {getProviderIcon(currentProviderId)}
              </div>
              <div className="typing-dots">
                <span>.</span><span>.</span><span>.</span>
              </div>
              <span className="typing-label">
                {currentModelName ? `${prettyModelName(currentModelName)} está respondendo` : 'Respondendo'}
                {typingElapsed >= 3 ? ` · ${typingElapsed} s` : ''}
              </span>
            </div>
          </div>
        )}
        {failureInfo && chatError && !isTyping && (
          <div className="message-row assistant">
            <div className={`chat-error-card ${failureInfo.kind}`} role="alert">
              <div className="chat-error-title">
                <span className="chat-error-icon" aria-hidden="true">⚠</span>
                {failureInfo.title}
              </div>
              <div className="chat-error-meta">
                {chatError.modelName ? `${prettyModelName(chatError.modelName)} · ` : ''}
                {timeOf(chatError.at)}
              </div>
              {failureInfo.detail && (
                <details className="chat-error-details">
                  <summary>Detalhes</summary>
                  <pre>{failureInfo.detail}</pre>
                </details>
              )}
              <div className="chat-error-actions">
                {failureInfo.retryable && currentSessionId && (
                  <button className="chat-error-btn primary" onClick={handleRetry}>Tentar novamente</button>
                )}
                <button className="chat-error-btn" onClick={() => setChatError(null)}>Dispensar</button>
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

          {showLiveTranscript && (
            <LiveTranscriptCard
              entries={live.entries}
              partials={live.partials}
              micActive={isMicSttActive}
              systemActive={isSystemSttActive}
              onInsert={insertIntoInput}
              onClear={clearLiveEntries}
            />
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
                if (micSttPartial) setMicSttPartial(null);
                setInputValue(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem..."
              rows={1}
              className={`chat-input ${hasPreview ? 'has-preview' : ''}`}
            />

            <div className="input-actions-right">
              <MicModeButton
                micActive={isMicSttActive}
                systemActive={isSystemSttActive}
                busy={sttBusy}
                onTap={handleMicTap}
                onToggleMic={() => void runSttAction(toggleMicStt)}
                onToggleSystem={() => void runSttAction(toggleSystemStt)}
                onStopAll={() => void stopAllStt()}
              />

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
