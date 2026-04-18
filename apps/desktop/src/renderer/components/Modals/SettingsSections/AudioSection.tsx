import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { AudioVisualizer } from '../../Panels/AudioVisualizer';
import { CustomSelect } from './CustomSelect';
import { AudioSamplePlayer } from './AudioSamplePlayer';
import { AudioRecordingProgress } from './AudioRecordingProgress';
import { getFeaturePermission, setFeaturePermission, type FeaturePermission } from '../../../utils/featurePermissions';

type AudioTestState = {
    status: 'idle' | 'recording' | 'ready' | 'error';
    url: string | null;
    message: string | null;
};

const TEST_DURATION_MS = 10000;


interface AudioSectionProps {
    selectedMic: string;
    setSelectedMic: (mic: string) => void;
    selectedSystemAudio: string;
    setSelectedSystemAudio: (audio: string) => void;
    micDevices: { id: string; label: string }[];
    systemAudioSources: { id: string; name: string; isMonitor?: boolean; isDefaultCandidate?: boolean }[];
    localAnalyser: AnalyserNode | null;
    sttMicAnalyser: AnalyserNode | null;
    systemLevelRef: React.MutableRefObject<number>;
    showToast: (message: string) => void;
}

export const AudioSection: React.FC<AudioSectionProps> = ({
    selectedMic,
    setSelectedMic,
    selectedSystemAudio,
    setSelectedSystemAudio,
    micDevices,
    systemAudioSources,
    localAnalyser,
    sttMicAnalyser,
    systemLevelRef,
    showToast
}) => {
    const [micPermissionGranted, setMicPermissionGranted] = useState<boolean | null>(null);
    const [systemAudioPermissionGranted, setSystemAudioPermissionGranted] = useState<boolean | null>(null);
    const [screenPermissionGranted, setScreenPermissionGranted] = useState<boolean | null>(null);
    const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);
    const [confirmDialog, setConfirmDialog] = useState<{ type: 'microphone' | 'systemAudio' | 'screen' | null; resourceName: string }>({ type: null, resourceName: '' });
    const [ocrMode, setOcrMode] = useState<'local' | 'ai'>('local');
    const [ocrCaptureMode, setOcrCaptureMode] = useState<'fullscreen' | 'area'>('fullscreen');
    const [micTest, setMicTest] = useState<AudioTestState>({ status: 'idle', url: null, message: null });
    const [systemTest, setSystemTest] = useState<AudioTestState>({ status: 'idle', url: null, message: null });
    const [phoneMicStatus, setPhoneMicStatus] = useState<PhoneMicStatus | null>(null);
    const [phoneMicQr, setPhoneMicQr] = useState<string | null>(null);
    const [phoneMicQrExpanded, setPhoneMicQrExpanded] = useState(false);
    const [phoneMicError, setPhoneMicError] = useState<string | null>(null);
    const [phoneMicLevel, setPhoneMicLevel] = useState(0);
    const [phoneMicIsDefault, setPhoneMicIsDefault] = useState(false);
    const [phoneMicTest, setPhoneMicTest] = useState<AudioTestState>({ status: 'idle', url: null, message: null });
    const [virtualDeviceStatus, setVirtualDeviceStatus] = useState<VirtualDeviceStatus | null>(null);
    const [virtualDeviceAvailable, setVirtualDeviceAvailable] = useState(false);
    const [micTestElapsedMs, setMicTestElapsedMs] = useState(0);
    const [systemTestElapsedMs, setSystemTestElapsedMs] = useState(0);
    const micTestUrlRef = useRef<string | null>(null);
    const systemTestUrlRef = useRef<string | null>(null);
    const micTestStreamRef = useRef<MediaStream | null>(null);
    const micTestRecorderRef = useRef<MediaRecorder | null>(null);
    const micTestTimerRef = useRef<number | null>(null);
    const micTestProgressTimerRef = useRef<number | null>(null);
    const systemTestTimerRef = useRef<number | null>(null);
    const systemTestProgressTimerRef = useRef<number | null>(null);
    const systemTestRecordingRef = useRef(false);
    const systemMonitorOptions = [
        { label: 'Padrão', value: '__default__' },
        ...systemAudioSources
            .filter((source) => source.isMonitor)
            .map((source) => ({
                label: source.isDefaultCandidate ? `${source.name} (padrão)` : source.name,
                value: source.id
            }))
    ];

    const clearObjectUrl = (ref: React.MutableRefObject<string | null>) => {
        if (ref.current) {
            URL.revokeObjectURL(ref.current);
            ref.current = null;
        }
    };

    const startProgressTimer = (
        setElapsed: React.Dispatch<React.SetStateAction<number>>,
        timerRef: React.MutableRefObject<number | null>
    ) => {
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
        }
        const startedAt = Date.now();
        setElapsed(0);
        timerRef.current = window.setInterval(() => {
            setElapsed(Math.min(TEST_DURATION_MS, Date.now() - startedAt));
        }, 100);
    };

    const stopProgressTimer = (
        setElapsed: React.Dispatch<React.SetStateAction<number>>,
        timerRef: React.MutableRefObject<number | null>,
        finalElapsedMs: number = 0
    ) => {
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setElapsed(finalElapsedMs);
    };

    const resolveSystemSourceId = (): string | null => {
        const monitorSources = systemAudioSources.filter((source) => source.isMonitor);
        if (selectedSystemAudio === '__default__' || selectedSystemAudio === 'Padrão') {
            return monitorSources.find((source) => source.isDefaultCandidate)?.id || monitorSources[0]?.id || null;
        }
        return monitorSources.find((source) => source.id === selectedSystemAudio)?.id || null;
    };

    const stopMicTestCapture = () => {
        if (micTestTimerRef.current) {
            window.clearTimeout(micTestTimerRef.current);
            micTestTimerRef.current = null;
        }
        stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);
        if (micTestRecorderRef.current?.state === 'recording') {
            micTestRecorderRef.current.stop();
        }
        micTestStreamRef.current?.getTracks().forEach((track) => track.stop());
        micTestStreamRef.current = null;
        micTestRecorderRef.current = null;
    };

    const getRecorderMimeType = (): string | undefined => {
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
        return candidates.find((type) => MediaRecorder.isTypeSupported(type));
    };

    const handleMicTest = async () => {
        if (micTest.status === 'recording') {
            stopMicTestCapture();
            return;
        }

        try {
            clearObjectUrl(micTestUrlRef);
            setMicTest({ status: 'recording', url: null, message: null });
            startProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);

            const mic = micDevices.find((device) => device.label === selectedMic);
            const constraints = mic ? { audio: { deviceId: { exact: mic.id } } } : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const chunks: BlobPart[] = [];
            const mimeType = getRecorderMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

            micTestStreamRef.current = stream;
            micTestRecorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            recorder.onerror = () => {
                stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);
                stream.getTracks().forEach((track) => track.stop());
                setMicTest({ status: 'error', url: null, message: 'Falha ao gravar amostra do microfone' });
            };

            recorder.onstop = () => {
                stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef, TEST_DURATION_MS);
                stream.getTracks().forEach((track) => track.stop());
                micTestStreamRef.current = null;
                micTestRecorderRef.current = null;
                if (chunks.length === 0) {
                    setMicTest({ status: 'error', url: null, message: 'Nenhum áudio foi capturado do microfone' });
                    return;
                }
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                const url = URL.createObjectURL(blob);
                micTestUrlRef.current = url;
                setMicTest({ status: 'ready', url, message: 'Amostra pronta' });
            };

            recorder.start(250);
            micTestTimerRef.current = window.setTimeout(() => {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }, TEST_DURATION_MS);
        } catch (error) {
            stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);
            const message = error instanceof Error ? error.message : 'Falha ao testar microfone';
            setMicTest({ status: 'error', url: null, message });
        }
    };

    const handleSystemTest = async () => {
        if (!window.recorder) {
            setSystemTest({ status: 'error', url: null, message: 'Gravador do sistema indisponível' });
            return;
        }
        if (systemTest.status === 'recording') {
            try {
                if (systemTestTimerRef.current) {
                    window.clearTimeout(systemTestTimerRef.current);
                    systemTestTimerRef.current = null;
                }
                const stopped = await window.recorder.stop();
                stopProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef);
                systemTestRecordingRef.current = false;
                if (stopped.path && window.recorder.getFileUrl) {
                    systemTestUrlRef.current = null;
                    const url = await window.recorder.getFileUrl(stopped.path);
                    systemTestUrlRef.current = url;
                    setSystemTest({ status: 'ready', url, message: 'Amostra pronta' });
                } else {
                    setSystemTest({ status: 'error', url: null, message: 'A gravação não gerou arquivo de áudio' });
                }
            } catch (error) {
                stopProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef);
                const message = error instanceof Error ? error.message : 'Falha ao parar teste do áudio do sistema';
                setSystemTest({ status: 'error', url: null, message });
            }
            return;
        }

        const sourceId = resolveSystemSourceId();
        if (!sourceId) {
            setSystemTest({ status: 'error', url: null, message: 'Nenhum monitor de saída disponível' });
            return;
        }

        try {
            systemTestUrlRef.current = null;
            setSystemTest({ status: 'recording', url: null, message: null });
            startProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef);
            await window.recorder.start({
                sourceId,
                wav: true,
                name: `teste_sistema_${Date.now()}`
            });
            systemTestRecordingRef.current = true;
            systemTestTimerRef.current = window.setTimeout(async () => {
                try {
                    systemTestTimerRef.current = null;
                    const stopped = await window.recorder?.stop();
                    stopProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef, TEST_DURATION_MS);
                    systemTestRecordingRef.current = false;
                    if (stopped?.path && window.recorder?.getFileUrl) {
                        const url = await window.recorder.getFileUrl(stopped.path);
                        systemTestUrlRef.current = url;
                        setSystemTest({ status: 'ready', url, message: 'Amostra pronta' });
                    } else {
                        setSystemTest({ status: 'error', url: null, message: 'A gravação não gerou arquivo de áudio' });
                    }
                } catch (error) {
                    stopProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef);
                    systemTestRecordingRef.current = false;
                    const message = error instanceof Error ? error.message : 'Falha ao finalizar teste do áudio do sistema';
                    setSystemTest({ status: 'error', url: null, message });
                }
            }, TEST_DURATION_MS);
        } catch (error) {
            stopProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef);
            systemTestRecordingRef.current = false;
            const message = error instanceof Error ? error.message : 'Falha ao testar áudio do sistema';
            setSystemTest({ status: 'error', url: null, message });
        }
    };

    useEffect(() => {
        checkPermissions();
    }, []);

    useEffect(() => {
        if (!window.phoneMic) return;
        window.phoneMic.getStatus().then(setPhoneMicStatus).catch(() => undefined);
        window.phoneMic.getVirtualDeviceStatus?.().then(setVirtualDeviceStatus).catch(() => undefined);
        window.phoneMic.checkVirtualDeviceAvailability?.().then(res => setVirtualDeviceAvailable(res.ok)).catch(() => undefined);
        const offStatus = window.phoneMic.onStatus((status) => {
            setPhoneMicStatus(status);
            setPhoneMicLevel(status.level || 0);
        });
        const offLevel = window.phoneMic.onLevel((payload) => setPhoneMicLevel(payload.level));
        const offIsDefault = window.phoneMic.onIsDefault?.((val) => setPhoneMicIsDefault(val));
        const offVirtual = window.phoneMic.onVirtualDeviceStatus?.((status) => setVirtualDeviceStatus(status));
        return () => {
            offStatus();
            offLevel();
            offIsDefault?.();
            offVirtual?.();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const url = phoneMicStatus?.localUrl;
        if (!url) {
            setPhoneMicQr(null);
            return;
        }
        QRCode.toDataURL(url, {
            margin: 1,
            width: 180,
            color: {
                dark: '#ffffff',
                light: '#00000000',
            },
        })
            .then((dataUrl) => {
                if (!cancelled) setPhoneMicQr(dataUrl);
            })
            .catch(() => {
                if (!cancelled) setPhoneMicQr(null);
            });
        return () => {
            cancelled = true;
        };
    }, [phoneMicStatus?.localUrl]);

    useEffect(() => {
        return () => {
            stopMicTestCapture();
            if (systemTestTimerRef.current) {
                window.clearTimeout(systemTestTimerRef.current);
                systemTestTimerRef.current = null;
            }
            stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);
            stopProgressTimer(setSystemTestElapsedMs, systemTestProgressTimerRef);
            if (systemTestRecordingRef.current) {
                window.recorder?.stop().catch(() => undefined);
                systemTestRecordingRef.current = false;
            }
            clearObjectUrl(micTestUrlRef);
            systemTestUrlRef.current = null;
        };
    }, []);

    useEffect(() => {
        const loadOcrMode = async () => {
            try {
                const result = await window.textHighlightAPI?.getMode?.();
                if (result?.mode === 'ai' || result?.mode === 'local') {
                    setOcrMode(result.mode);
                }
            } catch {
                // ignore
            }
        };
        loadOcrMode();
    }, []);

    useEffect(() => {
        const loadCaptureMode = async () => {
            try {
                const result = await window.textHighlightAPI?.getCaptureMode?.();
                if (result?.mode === 'area' || result?.mode === 'fullscreen') {
                    setOcrCaptureMode(result.mode);
                }
            } catch {
                // ignore
            }
        };
        loadCaptureMode();
    }, []);

    const checkPermissions = async () => {
        setIsCheckingPermissions(true);
        try {
            // Permissões "internas" (controle do app)
            const micAllowed = getFeaturePermission('microphone');
            const sysAllowed = getFeaturePermission('systemAudio');
            const screenAllowed = getFeaturePermission('screenCapture');

            // Microfone: se permitido no app, tenta validar com getUserMedia (senão, fica negado)
            if (!micAllowed) {
                setMicPermissionGranted(false);
            } else {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(track => track.stop());
                    setMicPermissionGranted(true);
                } catch {
                    // Se o SO/navegador negar, refletir como negado e desabilitar no app
                    setFeaturePermission('microphone', false);
                    setMicPermissionGranted(false);
                }
            }

            setSystemAudioPermissionGranted(sysAllowed);
            setScreenPermissionGranted(screenAllowed);
        } catch (error) {
            console.error('Error checking permissions:', error);
        } finally {
            setIsCheckingPermissions(false);
        }
    };

    const togglePhoneMicServer = async () => {
        if (!window.phoneMic) {
            setPhoneMicError('API do microfone do celular indisponível');
            return;
        }
        setPhoneMicError(null);
        try {
            const status = phoneMicStatus?.running
                ? await window.phoneMic.stop()
                : await window.phoneMic.start();
            setPhoneMicStatus(status);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Falha ao alternar servidor do celular';
            setPhoneMicError(message);
        }
    };

    const toggleVirtualDeviceDefault = async () => {
        if (!window.phoneMic || !virtualDeviceStatus?.active) return;
        try {
            await window.phoneMic.setVirtualDeviceAsDefault(!virtualDeviceStatus.isSystemDefault);
        } catch (error) {
            setPhoneMicError(error instanceof Error ? error.message : 'Falha ao definir como padrão do sistema');
        }
    };

    const handlePhoneMicTest = async () => {
        if (!window.phoneMic) return;

        if (phoneMicTest.status === 'recording') {
            setPhoneMicTest({ status: 'idle', url: null, message: null });
            return;
        }

        if (!phoneMicStatus?.running) {
            setPhoneMicTest({ status: 'error', url: null, message: 'Inicie o servidor antes de testar.' });
            return;
        }
        if (!phoneMicStatus?.clients || phoneMicStatus.clients === 0) {
            setPhoneMicTest({ status: 'error', url: null, message: 'Conecte o celular antes de testar.' });
            return;
        }

        setPhoneMicTest({ status: 'recording', url: null, message: null });
        startProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);
        try {
            const result = await window.phoneMic.testRecord(TEST_DURATION_MS);
            stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef, TEST_DURATION_MS);
            if (!result) {
                setPhoneMicTest({ status: 'error', url: null, message: 'Nenhum áudio recebido do celular' });
                return;
            }
            const binary = atob(result.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: result.mimeType });
            const url = URL.createObjectURL(blob);
            setPhoneMicTest({ status: 'ready', url, message: 'Amostra pronta' });
        } catch {
            stopProgressTimer(setMicTestElapsedMs, micTestProgressTimerRef);
            setPhoneMicTest({ status: 'error', url: null, message: 'Erro ao gravar amostra do celular' });
        }
    };

    const copyPhoneMicUrl = async () => {
        const url = phoneMicStatus?.localUrl;
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            showToast('URL do microfone do celular copiada');
        } catch {
            showToast('Não foi possível copiar a URL');
        }
    };

    const handleManagePermission = async (type: 'microphone' | 'systemAudio' | 'screen') => {
        const resourceNames = {
            microphone: 'Microfone',
            systemAudio: 'Áudio do Sistema',
            screen: 'Captura de Tela'
        };

        const isGranted = type === 'microphone' 
            ? micPermissionGranted 
            : type === 'systemAudio' 
            ? systemAudioPermissionGranted 
            : screenPermissionGranted;

        // Se a permissão está concedida, mostrar confirmação para negar
        if (isGranted) {
            setConfirmDialog({ type, resourceName: resourceNames[type] });
            return;
        }

        // Se não está concedida, tentar conceder dentro do app
        await enablePermission(type);
    };

    const enablePermission = async (type: 'microphone' | 'systemAudio' | 'screen') => {
        try {
            if (type === 'microphone') {
                // Solicita permissao real do microfone + marca como permitido no app
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                setFeaturePermission('microphone', true);
                setMicPermissionGranted(true);
                showToast('Permissão do microfone concedida');
                return;
            }

            const feature: FeaturePermission =
                type === 'systemAudio' ? 'systemAudio' : 'screenCapture';
            setFeaturePermission(feature, true);
            if (type === 'systemAudio') setSystemAudioPermissionGranted(true);
            if (type === 'screen') setScreenPermissionGranted(true);
            showToast(`Permissão concedida: ${type === 'systemAudio' ? 'Áudio do Sistema' : 'Captura de Tela'}`);
        } catch (error) {
            console.error('Error enabling permission:', error);
            showToast('Não foi possível conceder a permissão agora');
            if (type === 'microphone') {
                setFeaturePermission('microphone', false);
                setMicPermissionGranted(false);
            }
        }
    };

    const denyPermission = (type: 'microphone' | 'systemAudio' | 'screen') => {
        if (type === 'microphone') {
            setFeaturePermission('microphone', false);
            setMicPermissionGranted(false);
            showToast('Permissão do microfone negada no app');
            return;
        }
        if (type === 'systemAudio') {
            setFeaturePermission('systemAudio', false);
            setSystemAudioPermissionGranted(false);
            showToast('Permissão do áudio do sistema negada no app');
            return;
        }
        setFeaturePermission('screenCapture', false);
        setScreenPermissionGranted(false);
        showToast('Permissão de captura de tela negada no app');
    };

    const handleConfirmDeny = async () => {
        if (!confirmDialog.type) return;
        denyPermission(confirmDialog.type);
        setConfirmDialog({ type: null, resourceName: '' });
    };

    const handleCancelDeny = () => {
        setConfirmDialog({ type: null, resourceName: '' });
    };

    return (
        <div className="settings-content-inner">
            {/* Confirmation Dialog */}
            {confirmDialog.type && (
                <div className="permission-confirm-overlay" onClick={handleCancelDeny}>
                    <div className="permission-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="permission-confirm-header">
                            <div className="permission-confirm-icon denied">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 8v4M12 16h.01" />
                                </svg>
                            </div>
                            <h3>Negar Permissão</h3>
                        </div>
                        <div className="permission-confirm-body">
                            <p>
                                Tem certeza que deseja negar a permissão de acesso ao <strong>{confirmDialog.resourceName}</strong>?
                            </p>
                            <p className="permission-confirm-warning">
                                Isso desativa o uso desse recurso dentro do app (você pode reativar depois).
                            </p>
                        </div>
                        <div className="permission-confirm-footer">
                            <button className="permission-confirm-btn cancel" onClick={handleCancelDeny}>
                                Cancelar
                            </button>
                            <button className="permission-confirm-btn confirm" onClick={handleConfirmDeny}>
                                Negar Permissão
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="audio-settings-grid">
                <div className="audio-column">
                    <div className="audio-column-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>
                        <h3>Seu Microfone</h3>
                        <div className="audio-header-actions">
                            <button
                                className={`audio-test-btn ${micTest.status === 'recording' ? 'recording' : ''}`}
                                onClick={handleMicTest}
                                type="button"
                                title={micTest.status === 'recording' ? 'Parar teste' : 'Gravar amostra do microfone'}
                            >
                                {micTest.status === 'recording' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="7" y="7" width="10" height="10" rx="1" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                className={`permission-btn ${micPermissionGranted === null ? '' : micPermissionGranted ? 'granted' : 'denied'}`}
                                onClick={() => handleManagePermission('microphone')}
                                title={micPermissionGranted === null ? 'Verificando...' : micPermissionGranted ? 'Permissão concedida' : 'Gerenciar permissão'}
                                disabled={isCheckingPermissions}
                            >
                                {micPermissionGranted === null ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="permission-loading">
                                        <circle cx="12" cy="12" r="10" />
                                    </svg>
                                ) : micPermissionGranted ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M12 8v4M12 16h.01" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="input-group">
                        <label>Dispositivo de Entrada</label>
                        <CustomSelect
                            value={selectedMic}
                            onChange={(val) => {
                                setSelectedMic(val);
                                showToast(`Microfone alterado para ${val}`);
                            }}
                            options={micDevices.length > 0 ? micDevices.map(d => d.label) : ['Microfone Padrão']}
                        />
                    </div>
                    <div className="visualizer-container-settings">
                        <AudioVisualizer analyser={localAnalyser || sttMicAnalyser} width={220} height={60} />
                        <span className="visualizer-label">Monitorando entrada...</span>
                    </div>
                    <div className={`audio-test-result ${micTest.status}`}>
                        {micTest.status === 'recording' ? (
                            <AudioRecordingProgress elapsedMs={micTestElapsedMs} durationMs={TEST_DURATION_MS} />
                        ) : (
                            <span>{micTest.message || 'Clique em testar para gravar uma amostra.'}</span>
                        )}
                        {micTest.url && <AudioSamplePlayer src={micTest.url} label="Amostra do microfone" />}
                    </div>
                </div>

                <div className="audio-column">
                    <div className="audio-column-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="7" y="2" width="10" height="20" rx="2" />
                            <path d="M11 18h2" />
                        </svg>
                        <h3>Microfone do Celular</h3>
                        {phoneMicIsDefault && (
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.4)', marginLeft: 4, fontWeight: 600 }}>
                                MIC PADRÃO
                            </span>
                        )}
                        <div className="audio-header-actions">
                            <button
                                className={`audio-test-btn ${phoneMicTest.status === 'recording' ? 'recording' : ''}`}
                                type="button"
                                onClick={handlePhoneMicTest}
                                title={phoneMicTest.status === 'recording' ? 'Parar teste' : 'Gravar amostra do celular'}
                                disabled={!phoneMicStatus?.running}
                            >
                                {phoneMicTest.status === 'recording' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="7" y="7" width="10" height="10" rx="1" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                className={`audio-test-btn ${phoneMicStatus?.running ? 'recording' : ''}`}
                                type="button"
                                onClick={togglePhoneMicServer}
                                title={phoneMicStatus?.running ? 'Parar servidor' : 'Iniciar servidor'}
                            >
                                {phoneMicStatus?.running ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="7" y="7" width="10" height="10" rx="1" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="phone-mic-grid">
                        <div className="phone-mic-qr" title="Clique para ampliar" onClick={() => phoneMicQr && !(phoneMicStatus?.clients > 0) && setPhoneMicQrExpanded(true)} style={{ cursor: phoneMicQr && !(phoneMicStatus?.clients > 0) ? 'zoom-in' : 'default' }}>
                            {phoneMicStatus?.clients > 0 ? (
                                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--success)'}}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    <span style={{fontSize: 11, fontWeight: 700, letterSpacing: '0.05em'}}>CONECTADO</span>
                                </div>
                            ) : phoneMicQr ? (
                                <img src={phoneMicQr} alt="QR Code do microfone do celular" />
                            ) : (
                                <span>QR</span>
                            )}
                        </div>
                        <div className="phone-mic-details">
                            <div className="phone-mic-status-row">
                                <span className={`phone-mic-dot ${phoneMicStatus?.running ? 'active' : ''}`} />
                                <span>{phoneMicStatus?.running ? 'Servidor ativo' : 'Servidor parado'}</span>
                                <span>{phoneMicStatus?.clients || 0} conectado(s)</span>
                            </div>
                            <code className="phone-mic-url">
                                {phoneMicStatus?.localUrl || 'Inicie o servidor para gerar a URL'}
                            </code>
                            <div className="phone-mic-actions">
                                <button type="button" className="secondary-button" onClick={copyPhoneMicUrl} disabled={!phoneMicStatus?.localUrl}>
                                    Copiar URL
                                </button>
                                <button type="button" className="secondary-button" onClick={togglePhoneMicServer}>
                                    {phoneMicStatus?.running ? 'Parar' : 'Iniciar'}
                                </button>
                            </div>
                            <div className="phone-mic-stats">
                                <span>{phoneMicStatus?.chunksReceived || 0} chunks</span>
                                <span>{Math.round((phoneMicStatus?.bytesReceived || 0) / 1024)} KB</span>
                                <span>{phoneMicStatus?.lastChunkAt ? 'recebendo áudio' : 'aguardando áudio'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="visualizer-container-settings">
                        <AudioVisualizer analyser={null} level={phoneMicLevel} width={220} height={60} />
                        <span className="visualizer-label">Monitorando celular...</span>
                    </div>
                    <div className={`audio-test-result ${phoneMicTest.status}`}>
                        {phoneMicTest.status === 'recording' ? (
                            <AudioRecordingProgress elapsedMs={micTestElapsedMs} durationMs={TEST_DURATION_MS} />
                        ) : (
                            <span>{phoneMicTest.message || 'Conecte o celular e clique em testar.'}</span>
                        )}
                        {phoneMicTest.url && <AudioSamplePlayer src={phoneMicTest.url} label="Amostra do celular" />}
                    </div>
                    {phoneMicError && <div className="audio-test-result error">{phoneMicError}</div>}

                    {/* ── QR Code expanded modal ──────────────────────────── */}
                    {phoneMicQrExpanded && phoneMicQr && (
                        <div
                            onClick={() => setPhoneMicQrExpanded(false)}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 99999, cursor: 'zoom-out', backdropFilter: 'blur(6px)' }}
                        >
                            <div style={{ background: 'rgba(10,10,20,0.95)', padding: 28, borderRadius: 24, border: '1px solid rgba(139,92,246,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }} onClick={e => e.stopPropagation()}>
                                <img src={phoneMicQr} alt="QR Code" style={{ width: 280, height: 280 }} />
                                <code style={{ fontSize: 12, color: '#a78bfa', wordBreak: 'break-all', textAlign: 'center', maxWidth: 280 }}>
                                    {phoneMicStatus?.localUrl}
                                </code>
                                <span style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                                    Escaneie com o celular • Toque para fechar
                                </span>
                                <button type="button" className="secondary-button" onClick={() => setPhoneMicQrExpanded(false)} style={{ width: '100%' }}>
                                    Fechar
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="audio-column">
                    <div className="audio-column-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>
                        <h3>Áudio do Sistema</h3>
                        <div className="audio-header-actions">
                            <button
                                className={`audio-test-btn ${systemTest.status === 'recording' ? 'recording' : ''}`}
                                onClick={handleSystemTest}
                                type="button"
                                title={systemTest.status === 'recording' ? 'Parar teste' : 'Gravar amostra do áudio do sistema'}
                            >
                                {systemTest.status === 'recording' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="7" y="7" width="10" height="10" rx="1" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                className={`permission-btn ${systemAudioPermissionGranted ? 'granted' : ''}`}
                                onClick={() => handleManagePermission('systemAudio')}
                                title={systemAudioPermissionGranted ? 'Permissão concedida' : 'Gerenciar permissão'}
                            >
                                {systemAudioPermissionGranted ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M12 8v4M12 16h.01" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="input-group">
                        <label>Fonte de Captura</label>
                        <CustomSelect
                            value={selectedSystemAudio}
                            onChange={(val) => {
                                setSelectedSystemAudio(val);
                                const selected = systemMonitorOptions.find((option) => option.value === val);
                                showToast(`Fonte de áudio alterada para ${selected?.label || val}`);
                            }}
                            options={systemMonitorOptions}
                        />
                    </div>
                    <div className="visualizer-container-settings">
                        <AudioVisualizer analyser={null} levelRef={systemLevelRef} width={220} height={60} />
                        <span className="visualizer-label">Monitorando saída...</span>
                    </div>
                    <div className={`audio-test-result ${systemTest.status}`}>
                        {systemTest.status === 'recording' ? (
                            <AudioRecordingProgress elapsedMs={systemTestElapsedMs} durationMs={TEST_DURATION_MS} />
                        ) : (
                            <span>{systemTest.message || 'Clique em testar para gravar uma amostra.'}</span>
                        )}
                        {systemTest.url && <AudioSamplePlayer src={systemTest.url} label="Amostra do sistema" />}
                    </div>
                </div>

                <div className="audio-column">
                    <div className="audio-column-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="12" cy="12" r="3" /><path d="M12 18v-2" /><path d="M12 8V6" /><path d="M18 12h-2" /><path d="M8 12H6" /></svg>
                        <h3>Captura de Tela</h3>
                        <button 
                            className={`permission-btn ${screenPermissionGranted ? 'granted' : ''}`}
                            onClick={() => handleManagePermission('screen')}
                            title={screenPermissionGranted ? 'Permissão concedida' : 'Gerenciar permissão'}
                        >
                            {screenPermissionGranted ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M20 6L9 17l-5-5" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 8v4M12 16h.01" />
                                </svg>
                            )}
                        </button>
                    </div>
                    <div className="input-group">
                        <label>Qualidade da Captura</label>
                        <CustomSelect
                            value="Alta (1080p)"
                            onChange={(val) => showToast(`Qualidade alterada para ${val}`)}
                            options={['Baixa (480p)', 'Média (720p)', 'Alta (1080p)', 'Nativa (4K)']}
                        />
                    </div>
                    <div className="input-group">
                        <label>Frequência de Captura</label>
                        <CustomSelect
                            value="1 FPS"
                            onChange={(val) => showToast(`Frequência alterada para ${val}`)}
                            options={['0.5 FPS', '1 FPS', '2 FPS', '5 FPS']}
                        />
                    </div>
                    <div className="input-group">
                        <label>Área de Captura</label>
                        <div className="ocr-mode-toggle">
                            <button
                                className={`ocr-mode-option ${ocrCaptureMode === 'fullscreen' ? 'active' : ''}`}
                                onClick={async () => {
                                    setOcrCaptureMode('fullscreen');
                                    await window.textHighlightAPI?.setCaptureMode?.('fullscreen');
                                    showToast('OCR por tela inteira');
                                }}
                                type="button"
                            >
                                <span className="ocr-mode-dot" />
                                Tela inteira
                            </button>
                            <button
                                className={`ocr-mode-option ${ocrCaptureMode === 'area' ? 'active' : ''}`}
                                onClick={async () => {
                                    setOcrCaptureMode('area');
                                    await window.textHighlightAPI?.setCaptureMode?.('area');
                                    showToast('OCR por área específica');
                                }}
                                type="button"
                            >
                                <span className="ocr-mode-dot" />
                                Área específica
                            </button>
                        </div>
                        <span className="ocr-mode-helper">
                            Área específica abre a seleção de captura antes do OCR.
                        </span>
                    </div>
                    <div className="input-group">
                        <label>Processamento de OCR</label>
                        <div className="ocr-mode-toggle">
                            <button
                                className={`ocr-mode-option ${ocrMode === 'local' ? 'active' : ''}`}
                                onClick={async () => {
                                    setOcrMode('local');
                                    await window.textHighlightAPI?.setMode?.('local');
                                    showToast('OCR local ativado');
                                }}
                                type="button"
                            >
                                <span className="ocr-mode-dot" />
                                Processamento Local
                            </button>
                            <button
                                className={`ocr-mode-option ${ocrMode === 'ai' ? 'active' : ''}`}
                                onClick={async () => {
                                    setOcrMode('ai');
                                    await window.textHighlightAPI?.setMode?.('ai');
                                    showToast('OCR por IA ativado');
                                }}
                                type="button"
                            >
                                <span className="ocr-mode-dot" />
                                Inteligência Artificial
                            </button>
                        </div>
                        <span className="ocr-mode-helper">
                            IA usa o modelo configurado para transcrever a tela. Local usa o OCR do dispositivo.
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
