import { useState, useEffect, useRef } from 'react';
import './TranscriptionPanel.css';
import { AudioVisualizer } from './AudioVisualizer';
import { CaptionsPanel } from '../CaptionsPanel';
import { StatusBadge } from '../StatusBadge';
import { getFeaturePermission } from '../../utils/featurePermissions';
import {
  RecordingEntry,
  RecorderStatus,
  STTFinalEvent,
  STTPartialEvent,
  STTStatus,
  SubtitleSegment,
  SystemAudioSourceInfo,
  TranscribeProgress,
} from '@neo/shared';
import { useSttMicAnalyser } from '../../store/sttMicStore';
import { SystemAudioControls } from '../../TranscriptionTab/SystemAudioControls';
import { RecordingsList } from '../../TranscriptionTab/RecordingsList';
import { SubtitleEditor } from '../../TranscriptionTab/SubtitleEditor';

const defaultStatus: STTStatus = { state: 'idle' };

export function TranscriptionPanel(): JSX.Element {
  const [sttStatus, setSttStatus] = useState<STTStatus>(defaultStatus);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [systemSources, setSystemSources] = useState<SystemAudioSourceInfo[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>({
    state: 'idle',
    bytesWritten: 0,
  });
  const [systemStatus, setSystemStatus] = useState<STTStatus>(defaultStatus);
  const [systemPartial, setSystemPartial] = useState<STTPartialEvent | null>(null);
  const [systemFinals, setSystemFinals] = useState<STTFinalEvent[]>([]);
  const [systemSttLevel, setSystemSttLevel] = useState(0);
  const [systemRecordingLevel, setSystemRecordingLevel] = useState(0);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<
    (TranscribeProgress & { wavPath?: string }) | null
  >(null);
  const [subtitleState, setSubtitleState] = useState<{
    wavPath: string;
    audioUrl: string;
    segments: SubtitleSegment[];
    vttPath?: string;
    srtPath?: string;
  } | null>(null);
  const sttMicAnalyser = useSttMicAnalyser();
  const showDebug =
    typeof window !== 'undefined' &&
    (window as any).electron?.process?.env?.RICKY_SHOW_STT_DEBUG === '1';

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const shouldSaveRef = useRef(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const ensureMicAllowed = () => {
    if (!getFeaturePermission('microphone')) {
      throw new Error('Permissão do microfone está negada no app');
    }
  };

  const loadSystemSources = async () => {
    if (!window.systemAudio) return;
    try {
      const sources = await window.systemAudio.listSources();
      const nextSources = Array.isArray(sources) ? sources : [];
      setSystemSources(nextSources);
      const defaultSource = nextSources.find((source) => source.isDefaultCandidate)?.id;
      const hasSelected =
        selectedSourceId && nextSources.some((source) => source.id === selectedSourceId);
      if (defaultSource && defaultSource !== selectedSourceId) {
        setSelectedSourceId(defaultSource);
        return;
      }
      if (!hasSelected) {
        const fallback = nextSources[0]?.id || '';
        if (fallback) {
          setSelectedSourceId(fallback);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao listar dispositivos de audio';
      setSystemError(message);
    }
  };

  const loadRecordings = async () => {
    if (!window.recorder) return;
    setRecordingsLoading(true);
    try {
      const result = await window.recorder.listRecent(10);
      setRecordings(Array.isArray(result) ? result : []);
    } finally {
      setRecordingsLoading(false);
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
      setSystemError(message);
    }
    return null;
  };

  useEffect(() => {
    window.stt.getStatus().then((status) => setSttStatus(status || defaultStatus));
    const offStatus = window.stt.onStatus((status) => setSttStatus(status));
    return () => offStatus();
  }, []);

  useEffect(() => {
    if (!window.stt) return;

    const pushDebug = (label: string, detail?: string) => {
      const timestamp = new Date().toLocaleTimeString('pt-BR');
      const line = detail ? `${timestamp} ${label}: ${detail}` : `${timestamp} ${label}`;
      setDebugEvents((prev) => [line, ...prev].slice(0, 20));
    };

    pushDebug('STT debug iniciado');

    const offStatus = window.stt.onStatus((status) =>
      pushDebug('status', `${status.state}${'message' in status ? ` - ${status.message}` : ''}`)
    );
    const offPartial = window.stt.onPartial((event) => pushDebug('partial', event.text || '(vazio)'));
    const offFinal = window.stt.onFinal((event) => pushDebug('final', event.text || '(vazio)'));
    const offError = window.stt.onError((payload) => pushDebug('error', payload.message));
    const offDebug = window.stt.onDebug((payload) => pushDebug('debug', payload.message));

    return () => {
      offStatus();
      offPartial();
      offFinal();
      offError();
      offDebug();
    };
  }, []);

  useEffect(() => {
    if (!window.systemStt) return;
    window.systemStt.getStatus().then((status) => setSystemStatus(status || defaultStatus));
    const offStatus = window.systemStt.onStatus((status) => {
      setSystemStatus(status);
      if (status.state === 'starting') {
        setSystemPartial(null);
        setSystemFinals([]);
      }
      if (status.state === 'idle') {
        setSystemPartial(null);
        setSystemSttLevel(0);
      }
      if (status.state === 'error') {
        setSystemSttLevel(0);
      }
    });
    const offPartial = window.systemStt.onPartial((event) => setSystemPartial(event));
    const offFinal = window.systemStt.onFinal((event) =>
      setSystemFinals((prev) => [event, ...prev].slice(0, 20))
    );
    const offError = window.systemStt.onError((payload) => setSystemError(payload.message));
    const offLevel = window.systemStt.onLevel((payload) => setSystemSttLevel(payload.level));
    return () => {
      offStatus();
      offPartial();
      offFinal();
      offError();
      offLevel();
    };
  }, []);

  useEffect(() => {
    loadSystemSources();
  }, []);

  useEffect(() => {
    if (!window.recorder) return;
    window.recorder.getStatus().then((status) => setRecorderStatus(status));
    const offStatus = window.recorder.onStatus((status) => {
      setRecorderStatus(status);
      if (status.state !== 'recording') {
        setSystemRecordingLevel(0);
      }
    });
    const offError = window.recorder.onError((payload) => setSystemError(payload.message));
    const offLevel = window.recorder.onLevel((payload) => setSystemRecordingLevel(payload.level));
    return () => {
      offStatus();
      offError();
      offLevel();
    };
  }, []);

  useEffect(() => {
    if (!window.transcribeFile) return;
    const offProgress = window.transcribeFile.onProgress((payload) =>
      setTranscribeProgress(payload)
    );
    const offDone = window.transcribeFile.onDone((payload) => {
      setTranscribeProgress(null);
      if (payload.wavPath) {
        loadRecordings();
      }
    });
    const offError = window.transcribeFile.onError((payload) =>
      setTranscribeError(payload.message)
    );
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    loadRecordings();
  }, []);

  useEffect(() => {
    if (recorderStatus.state === 'idle' && recorderStatus.path) {
      loadRecordings();
    }
  }, [recorderStatus.state, recorderStatus.path]);

  useEffect(() => {
    return () => {
      if (lastAudioUrl) {
        URL.revokeObjectURL(lastAudioUrl);
      }
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      cleanupAudioNodes();
    };
  }, [lastAudioUrl]);

  const cleanupAudioNodes = () => {
    analyserRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
  };

  const startRecording = async () => {
    setRecordError(null);
    setLastSavedPath(null);
    if (lastAudioUrl) {
      URL.revokeObjectURL(lastAudioUrl);
      setLastAudioUrl(null);
    }
    recordedChunksRef.current = [];
    shouldSaveRef.current = true;

    try {
      ensureMicAllowed();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;

      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        if (!shouldSaveRef.current) {
          recordedChunksRef.current = [];
          shouldSaveRef.current = true;
          cleanupAudioNodes();
          return;
        }
        setIsSaving(true);
        try {
          const blob = new Blob(recordedChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });
          const audioUrl = URL.createObjectURL(blob);
          setLastAudioUrl(audioUrl);
          const buffer = await blob.arrayBuffer();
          const result = await window.electron?.ipcRenderer.invoke('audio:save', {
            buffer,
            mimeType: blob.type,
          });
          setLastSavedPath(result?.filePath || null);
        } catch (error) {
          setRecordError('Falha ao salvar o audio');
        } finally {
          setIsSaving(false);
          recordedChunksRef.current = [];
          cleanupAudioNodes();
        }
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (error) {
      setRecordError('Permissao de microfone negada ou indisponivel');
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const stopRecording = (save: boolean) => {
    shouldSaveRef.current = save;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupAudioNodes();
      if (!save) {
        recordedChunksRef.current = [];
        shouldSaveRef.current = true;
      }
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setIsRecording(false);
  };

  const startSystemRecording = async () => {
    setSystemError(null);
    if (!window.recorder) return;
    const resolvedSourceId = selectedSourceId || (await detectDefaultSource());
    if (!resolvedSourceId) {
      setSystemError('Selecione um dispositivo de audio');
      return;
    }
    try {
      const result = await window.recorder.start({
        sourceId: resolvedSourceId,
        wav: true,
      });
      setRecorderStatus(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao iniciar gravacao do sistema';
      setSystemError(message);
    }
  };

  const stopSystemRecording = async () => {
    if (!window.recorder) return;
    try {
      const result = await window.recorder.stop();
      setRecorderStatus(result);
    } catch (error) {
      setSystemError('Falha ao parar gravacao do sistema');
    }
  };

  const toggleSystemStt = async () => {
    if (!window.systemStt) return;
    if (
      systemStatus.state === 'running' ||
      systemStatus.state === 'listening' ||
      systemStatus.state === 'starting'
    ) {
      await window.systemStt.stop();
      return;
    }
    setSystemError(null);
    const resolvedSourceId = selectedSourceId || (await detectDefaultSource());
    if (!resolvedSourceId) {
      setSystemError('Selecione um dispositivo de audio');
      return;
    }
    try {
      await window.systemStt.start({ sourceId: resolvedSourceId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao iniciar STT do sistema';
      setSystemError(message);
    }
  };

  const handleDeleteRecording = async (recording: RecordingEntry) => {
    if (!window.recorder) return;
    await window.recorder.delete(recording.path);
    loadRecordings();
  };

  const handleOpenRecording = async (recording: RecordingEntry) => {
    if (!window.recorder) return;
    await window.recorder.open(recording.path);
  };

  const handleTranscribe = async (recording: RecordingEntry) => {
    if (!window.transcribeFile || !window.recorder) return;
    setTranscribeError(null);
    setTranscribeProgress({ percent: 0, currentTimeMs: 0, wavPath: recording.path });
    try {
      const result = await window.transcribeFile.start({
        wavPath: recording.path,
        exportFormat: 'both',
      });
      const audioUrl = await window.recorder.getFileUrl(recording.path);
      setSubtitleState({
        wavPath: recording.path,
        audioUrl,
        segments: result.segments,
        vttPath: result.vttPath,
        srtPath: result.srtPath,
      });
    } catch (error) {
      setTranscribeError('Falha ao transcrever gravacao');
    } finally {
      setTranscribeProgress(null);
    }
  };

  const handleSaveSegments = async (segments: SubtitleSegment[]) => {
    if (!subtitleState || !window.transcribeFile) return;
    const result = await window.transcribeFile.saveSegments({
      wavPath: subtitleState.wavPath,
      segments,
    });
    setSubtitleState((prev) =>
      prev
        ? { ...prev, segments, vttPath: result.vttPath, srtPath: result.srtPath }
        : prev
    );
  };

  const isSttRunning =
    sttStatus.state === 'running' || sttStatus.state === 'listening' || sttStatus.state === 'starting';
  const isSystemRecording = recorderStatus.state === 'recording';
  const isSystemSttRunning =
    systemStatus.state === 'running' ||
    systemStatus.state === 'listening' ||
    systemStatus.state === 'starting';
  const systemLevel = isSystemSttRunning
    ? systemSttLevel
    : isSystemRecording
      ? systemRecordingLevel
      : 0;
  const handleCopyDebug = async () => {
    const text = debugEvents.join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Copiado');
      return;
    } catch {
      // fallback para ambientes sem permissao do clipboard
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopyStatus(ok ? 'Copiado' : 'Falha ao copiar');
    } catch {
      setCopyStatus('Falha ao copiar');
    }
  };

  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(null), 1200);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  return (
    <div className="transcription-panel">
      <div className="panel-header">
        <div className="panel-title">
          <h3>Transcricao</h3>
          <StatusBadge status={sttStatus} />
        </div>
      </div>
      <div className="transcription-content">
        <div className="transcription-columns">
          <div className="transcription-column">
            <SystemAudioControls
              sources={systemSources}
              selectedSourceId={selectedSourceId}
              onSelectSourceId={setSelectedSourceId}
              onDetectDefault={detectDefaultSource}
              onRefreshSources={loadSystemSources}
              isRecording={isSystemRecording}
              isSttRunning={isSystemSttRunning}
              onRecordToggle={() =>
                isSystemRecording ? stopSystemRecording() : startSystemRecording()
              }
              onSttToggle={toggleSystemStt}
              onOpenFolder={() => window.recorder?.openFolder()}
            />
            {systemError && <div className="error-banner">{systemError}</div>}
            <CaptionsPanel
              partial={systemPartial}
              finals={systemFinals}
              emptyLabel="Nenhuma transcricao do sistema ainda."
            />
            {(isSystemRecording || isSystemSttRunning) && (
              <div className="waveform-container">
                <AudioVisualizer analyser={null} level={systemLevel} />
                <div
                  className="waveform-label"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <span className="record-indicator" aria-hidden>
                    <span className="record-dot" />
                    <span className="record-pulse" />
                  </span>
                  {isSystemRecording
                    ? 'Gravando audio do sistema...'
                    : 'Transcrevendo audio do sistema...'}
                </div>
              </div>
            )}
            {/*
            {recordingsLoading && <p className="panel-hint">Carregando gravacoes...</p>}
            <RecordingsList
              recordings={recordings}
              onRefresh={loadRecordings}
              onDelete={handleDeleteRecording}
              onOpen={handleOpenRecording}
              onTranscribe={handleTranscribe}
              transcribeProgress={transcribeProgress}
            />
            {transcribeError && <div className="error-banner">{transcribeError}</div>}
             */}
          </div>
          <div className="transcription-column">
            <div className="microphone-block">
              <div className="system-audio-header">
                <div>
                  <div className="section-title">Microfone</div>
                  <div className="section-subtitle">Entrada do microfone local</div>
                </div>
              </div>
              <div className="transcribe-actions">
                <button
                  className={`transcribe-button ${isRecording ? 'active' : ''}`}
                  onClick={() => (isRecording ? stopRecording(true) : startRecording())}
                  disabled={isSaving}
                >
                  {isRecording ? 'Parar e salvar' : 'Gravar microfone'}
                </button>
                {isRecording && (
                  <button
                    className="transcribe-button secondary"
                    onClick={() => stopRecording(false)}
                    disabled={isSaving}
                  >
                    Cancelar
                  </button>
                )}
                <button
                  className={`transcribe-button secondary ${isSttRunning ? 'active' : ''}`}
                  onClick={() => (isSttRunning ? window.stt.stop() : window.stt.start())}
                  disabled={isSaving}
                >
                  {isSttRunning ? 'Parar STT' : 'Iniciar STT'}
                </button>
                {isRecording && (
                  <div className="record-indicator" aria-label="Gravando">
                    <span className="record-dot" />
                    <span className="record-pulse" />
                  </div>
                )}
              </div>
              {sttStatus.state === 'error' && (
                <p style={{ color: '#ffb3b3', fontStyle: 'italic' }}>
                  {sttStatus.message}
                </p>
              )}
              {isRecording && (
                <div className="waveform-container">
                  <AudioVisualizer analyser={analyserRef.current} />
                  <div className="waveform-label">Gravando audio...</div>
                </div>
              )}
              {!isRecording &&
                (sttStatus.state === 'running' ||
                  sttStatus.state === 'listening' ||
                  sttStatus.state === 'starting') && (
                <div className="waveform-container">
                  <AudioVisualizer analyser={sttMicAnalyser} />
                  <div className="waveform-label">Monitorando microfone (STT)...</div>
                </div>
              )}
              {isSaving && (
                <p style={{ color: '#999', fontStyle: 'italic' }}>Salvando audio...</p>
              )}
              {recordError && (
                <p style={{ color: '#ff8a8a', fontStyle: 'italic' }}>{recordError}</p>
              )}
              <CaptionsPanel />
            </div>
          </div>
        </div>
        {subtitleState && (
          <SubtitleEditor
            wavPath={subtitleState.wavPath}
            audioUrl={subtitleState.audioUrl}
            segments={subtitleState.segments}
            onSave={handleSaveSegments}
            onClose={() => setSubtitleState(null)}
          />
        )}
        {showDebug && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px dashed rgba(255, 255, 255, 0.12)',
              fontFamily: 'monospace',
              fontSize: '12px',
              color: '#cfcfcf',
            }}
          >
            <div
              style={{
                marginBottom: '6px',
                color: '#9aa0a6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span>Debug STT (temporario)</span>
              <button
                type="button"
                onClick={handleCopyDebug}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#d8d8d8',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {copyStatus ? copyStatus : 'Copiar'}
              </button>
            </div>
            {debugEvents.length === 0 ? (
              <div>Nenhum evento ainda.</div>
            ) : (
              debugEvents.map((event, index) => <div key={`${event}-${index}`}>{event}</div>)
            )}
          </div>
        )}
        {lastSavedPath && (
          <p style={{ color: '#9fd6a1', fontStyle: 'italic' }}>
            Audio salvo em: {lastSavedPath}
          </p>
        )}
        {lastAudioUrl && (
          <div style={{ marginTop: '10px' }}>
            <audio controls src={lastAudioUrl} style={{ width: '100%' }}>
              Seu navegador nao suporta o player de audio.
            </audio>
          </div>
        )}
      </div>
    </div>
  );
}
