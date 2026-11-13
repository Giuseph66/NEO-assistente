import { readFileSync, rmSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { WavWriter } from './WavWriter';
import { decodeWav } from '../../stt/audio/wav';

describe('WavWriter', () => {
  it('keeps the header and every audio byte, even with un-awaited writes', async () => {
    const path = '/tmp/neo-desktop-test/wavwriter.wav';
    rmSync(path, { force: true });
    const writer = new WavWriter(path, 16000, 1);
    await writer.init();
    const chunks = [Buffer.alloc(3200, 1), Buffer.alloc(3200, 2), Buffer.alloc(1600, 3)];
    chunks.forEach((c) => void writer.write(c)); // the recorder does not await each write
    await writer.finalize();

    const file = readFileSync(path);
    expect(file.length).toBe(44 + 8000);
    const wav = decodeWav(file);
    expect(wav).toMatchObject({ sampleRate: 16000, channels: 1 });
    expect(Buffer.compare(file.subarray(44), Buffer.concat(chunks))).toBe(0);
  });
});
