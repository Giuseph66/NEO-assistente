import { useEffect, useRef } from 'react';

const clampLevel = (value: number): number => Math.max(0, Math.min(1, value));

interface AudioVisualizerProps {
    analyser: AnalyserNode | null;
    level?: number | null;
    levelRef?: { current: number };
    width?: number;
    height?: number;
}

export function AudioVisualizer({ analyser, level, levelRef, width = 360, height = 64 }: AudioVisualizerProps): JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const smoothedHeightsRef = useRef<number[]>([]);
    const levelHistoryRef = useRef<number[]>([]);
    const lastHistoryPushAtRef = useRef(0);
    const internalLevelRef = useRef(0);
    const externalLevelRef = levelRef;

    useEffect(() => {
        if (typeof level === 'number') {
            internalLevelRef.current = clampLevel(level);
        }
    }, [level]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const bufferLength = analyser ? analyser.frequencyBinCount : 0;
        const dataArray = analyser ? new Uint8Array(bufferLength) : null;

        // Number of bars to show (one side)
        const barCount = 32;
        if (smoothedHeightsRef.current.length !== barCount) {
            smoothedHeightsRef.current = new Array(barCount).fill(0);
        }
        if (levelHistoryRef.current.length !== barCount) {
            levelHistoryRef.current = new Array(barCount).fill(0);
        }

        const draw = () => {
            if (analyser && dataArray) {
                analyser.getByteFrequencyData(dataArray);
            }

            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const barWidth = (w / (barCount * 2)) * 0.7;
            const barGap = (w / (barCount * 2)) * 0.3;
            const centerY = h / 2;
            const centerX = w / 2;

            // External levels already come smoothed from the main process.
            const smoothing = analyser ? 0.15 : 0.55;
            const fallbackLevel = clampLevel(
                externalLevelRef ? externalLevelRef.current : internalLevelRef.current
            );
            if (!analyser) {
                const now = performance.now();
                if (now - lastHistoryPushAtRef.current >= 34) {
                    lastHistoryPushAtRef.current = now;
                    const shapedLevel = Math.pow(fallbackLevel, 0.58);
                    levelHistoryRef.current = [
                        shapedLevel,
                        ...levelHistoryRef.current.slice(0, barCount - 1).map((value) => value * 0.96),
                    ];
                }
            }

            for (let i = 0; i < barCount; i++) {
                // Sample frequency data with averaging for better representation
                let rawValue = 0;
                if (analyser && dataArray) {
                    // We focus on the lower to mid frequency range where voice is most active
                    // Using a non-linear mapping to give more space to lower frequencies
                    const binRange = Math.floor(bufferLength * 0.6); // Focus on first 60% of bins
                    const binStart = Math.floor((i / barCount) * binRange);
                    const binEnd = Math.floor(((i + 1) / barCount) * binRange);

                    let sum = 0;
                    let count = 0;
                    for (let j = binStart; j < binEnd; j++) {
                        sum += dataArray[j];
                        count++;
                    }
                    rawValue = count > 0 ? (sum / count) / 255 : 0;
                } else {
                    const historyValue = levelHistoryRef.current[i] || 0;
                    const curve = 0.42 + 0.58 * Math.sin((1 - i / barCount) * Math.PI * 0.75);
                    const ripple = 0.88 + 0.12 * Math.sin((performance.now() / 80) + i * 0.9);
                    rawValue = historyValue * curve * ripple;
                }

                // Apply smoothing
                smoothedHeightsRef.current[i] = smoothedHeightsRef.current[i] * (1 - smoothing) + rawValue * smoothing;
                const value = smoothedHeightsRef.current[i];

                const barHeight = Math.max(4, value * h * 0.9);
                const y = centerY - barHeight / 2;

                // Draw symmetrical bars from center
                // Right side
                const xRight = centerX + i * (barWidth + barGap);
                // Left side
                const xLeft = centerX - (i + 1) * (barWidth + barGap);

                // Create Gradient
                const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
                gradient.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0.4)');

                ctx.fillStyle = gradient;

                // Add Glow
                ctx.shadowBlur = 10;
                ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';

                const radius = barWidth / 2;

                // Draw Right
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(xRight, y, barWidth, barHeight, radius);
                } else {
                    ctx.rect(xRight, y, barWidth, barHeight);
                }
                ctx.fill();

                // Draw Left
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(xLeft, y, barWidth, barHeight, radius);
                } else {
                    ctx.rect(xLeft, y, barWidth, barHeight);
                }
                ctx.fill();
            }

            animationFrameRef.current = requestAnimationFrame(draw);
        };

        animationFrameRef.current = requestAnimationFrame(draw);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [analyser, levelRef]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{ display: 'block', margin: '0 auto', filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.2))' }}
        />
    );
}
