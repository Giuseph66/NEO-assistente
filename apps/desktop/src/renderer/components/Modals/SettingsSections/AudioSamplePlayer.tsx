import React, { useEffect, useRef, useState } from 'react';

type AudioSamplePlayerProps = {
    src: string;
    label: string;
    onPlay?: (audio: HTMLAudioElement) => void;
    onPause?: () => void;
};

const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
};

export const AudioSamplePlayer = React.forwardRef<HTMLAudioElement, AudioSamplePlayerProps>(({ src, label, onPlay, onPause }, ref) => {
    const internalRef = useRef<HTMLAudioElement | null>(null);
    const audioRef = (ref as React.MutableRefObject<HTMLAudioElement | null>) || internalRef;
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const displayedDuration = duration > 0 ? duration : Math.max(currentTime, 1);
    const rangeValue = Math.min(currentTime, displayedDuration);

    const syncDuration = (audio: HTMLAudioElement) => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setDuration(audio.duration);
        }
    };

    useEffect(() => {
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, [src]);

    const togglePlayback = async () => {
        const audio = audioRef.current;
        if (!audio) return;
        try {
            if (audio.paused) {
                await audio.play();
                setIsPlaying(true);
                onPlay?.(audio);
                return;
            }
            audio.pause();
            setIsPlaying(false);
            onPause?.();
        } catch (err) {
            console.error('Playback failed:', err);
        }
    };

    const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
        const audio = audioRef.current;
        if (!audio) return;
        const nextTime = Number(event.target.value);
        audio.currentTime = nextTime;
        setCurrentTime(nextTime);
    };

    return (
        <div className="audio-sample-player">
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
                onDurationChange={(event) => syncDuration(event.currentTarget)}
                onTimeUpdate={(event) => {
                    const audio = event.currentTarget;
                    setCurrentTime(audio.currentTime);
                    syncDuration(audio);
                }}
                onPlay={(e) => {
                    setIsPlaying(true);
                    onPlay?.(e.currentTarget);
                }}
                onPause={() => {
                    setIsPlaying(false);
                    onPause?.();
                }}
                onEnded={(event) => {
                    const audio = event.currentTarget;
                    setIsPlaying(false);
                    onPause?.();
                    setCurrentTime(audio.currentTime);
                    if (duration <= 0 && audio.currentTime > 0) {
                        setDuration(audio.currentTime);
                    }
                }}
            />
            <button className="audio-sample-play" type="button" onClick={togglePlayback} title={isPlaying ? 'Pausar' : 'Reproduzir'}>
                {isPlaying ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                    </svg>
                ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </button>
            <div className="audio-sample-body">
                <div className="audio-sample-topline">
                    <span>{label}</span>
                    <span>{formatTime(currentTime)} / {formatTime(duration || currentTime)}</span>
                </div>
                <input
                    className="audio-sample-range"
                    type="range"
                    min="0"
                    max={displayedDuration}
                    step="0.01"
                    value={rangeValue}
                    onChange={handleSeek}
                    aria-label={`Progresso de ${label}`}
                />
            </div>
        </div>
    );
});

AudioSamplePlayer.displayName = 'AudioSamplePlayer';
