import React from 'react';

type AudioRecordingProgressProps = {
    elapsedMs: number;
    durationMs: number;
};

const formatSeconds = (ms: number): string => `${Math.ceil(ms / 1000)}s`;

export const AudioRecordingProgress: React.FC<AudioRecordingProgressProps> = ({
    elapsedMs,
    durationMs,
}) => {
    const clampedElapsed = Math.max(0, Math.min(durationMs, elapsedMs));
    const remainingMs = Math.max(0, durationMs - clampedElapsed);
    const progress = durationMs > 0 ? (clampedElapsed / durationMs) * 100 : 0;

    return (
        <div className="audio-recording-progress">
            <div className="audio-recording-progress-topline">
                <span>Gravando amostra de {formatSeconds(durationMs)}</span>
                <span>{formatSeconds(clampedElapsed)} / {formatSeconds(durationMs)}</span>
            </div>
            <div className="audio-recording-progress-track" aria-hidden>
                <div
                    className="audio-recording-progress-fill"
                    style={{ width: `${progress}%` }}
                />
            </div>
            <div className="audio-recording-progress-footer">
                <span>Restam {formatSeconds(remainingMs)}</span>
            </div>
        </div>
    );
};
