import { useEffect, useRef } from 'react';
import { useSttState } from '../store/sttStore';
import { setSttMicAnalyser } from '../store/sttMicStore';
import { getFeaturePermission } from '../utils/featurePermissions';

const DEFAULT_SAMPLE_RATE = 16000;

const downsampleBuffer = (buffer: Float32Array, inRate: number, outRate: number) => {
  if (outRate === inRate) return buffer;
  const ratio = inRate / outRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offset = 0;
  for (let i = 0; i < newLength; i++) {
    const nextOffset = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = offset; j < nextOffset && j < buffer.length; j++) {
      sum += buffer[j];
      count += 1;
    }
    result[i] = count > 0 ? sum / count : 0;
    offset = nextOffset;
  }
  return result;
};

const floatTo16BitPCM = (buffer: Float32Array) => {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};

export function SttMicBridge(): null {
  const { status } = useSttState();
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const activeRef = useRef(false);
  const startTimerRef = useRef<number | null>(null);

  const stop = () => {
    analyserRef.current = null;
    setSttMicAnalyser(null);
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    gainRef.current?.disconnect();
    gainRef.current = null;
    contextRef.current?.close();
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const start = async () => {
    if (streamRef.current) return;
    try {
      if (!window.stt || typeof window.stt.sendAudio !== 'function') return;
      if (!getFeaturePermission('microphone')) {
        // permissão negada dentro do app
        setSttMicAnalyser(null);
        return;
      }
      const config = await window.stt.getConfig().catch(() => null);
      const providerId = config?.provider;
      const targetRate =
        providerId === 'openai_realtime_transcribe' ||
        providerId === 'gemini_live' ||
        providerId === 'codex_transcribe'
          ? DEFAULT_SAMPLE_RATE
          : config?.sampleRate && Number.isFinite(config.sampleRate) && config.sampleRate > 0
          ? config.sampleRate
          : DEFAULT_SAMPLE_RATE;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const sourceType = window.electron?.process?.env?.RICKY_STT_SOURCE || 'arecord';
      const shouldSendAudio = sourceType === 'renderer';
      let processor: ScriptProcessorNode | null = null;
      let gain: GainNode | null = null;
      if (shouldSendAudio) {
        processor = context.createScriptProcessor(4096, 1, 1);
        gain = context.createGain();
        gain.gain.value = 0;
        processor.onaudioprocess = (event) => {
          if (!activeRef.current) return;
          const input = event.inputBuffer.getChannelData(0);
          const downsampled = downsampleBuffer(input, context.sampleRate, targetRate);
          const pcm = floatTo16BitPCM(downsampled);
          try {
            window.stt.sendAudio(pcm.buffer);
          } catch {
            // evita crash caso IPC esteja indisponivel
          }
        };
        source.connect(processor);
        processor.connect(gain);
        gain.connect(context.destination);
      }

      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      analyserRef.current = analyser;
      processorRef.current = processor;
      gainRef.current = gain;
      setSttMicAnalyser(analyser);
    } catch (error) {
      setSttMicAnalyser(null);
    }
  };

  useEffect(() => {
    const active = status.state === 'running' || status.state === 'listening';
    activeRef.current = active;
    if (active) {
      if (startTimerRef.current) {
        window.clearTimeout(startTimerRef.current);
      }
      startTimerRef.current = window.setTimeout(() => {
        void start();
      }, 200);
      return;
    }
    if (startTimerRef.current) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    stop();
  }, [status.state]);

  useEffect(
    () => () => {
      if (startTimerRef.current) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      stop();
    },
    []
  );

  return null;
}
