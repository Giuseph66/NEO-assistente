/**
 * Minimal PCM16 WAV helpers (no I/O): build a WAV file around raw samples and
 * read the samples back out of one.
 */

const HEADER_BYTES = 44;

export function encodeWavPcm16(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  const blockAlign = channels * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export type DecodedWav = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Raw little-endian samples, interleaved when channels > 1. */
  pcm: Buffer;
};

/** Parses a RIFF/WAVE file, walking the chunks (does not assume a 44-byte header). */
export function decodeWav(file: Buffer): DecodedWav {
  if (file.length < 12 || file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Arquivo não é um WAV válido');
  }

  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: Buffer | null = null;

  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = Math.min(bodyStart + size, file.length);
    if (id === 'fmt ') {
      format = {
        audioFormat: file.readUInt16LE(bodyStart),
        channels: file.readUInt16LE(bodyStart + 2),
        sampleRate: file.readUInt32LE(bodyStart + 4),
        bitsPerSample: file.readUInt16LE(bodyStart + 14),
      };
    } else if (id === 'data') {
      data = file.subarray(bodyStart, bodyEnd);
    }
    offset = bodyStart + size + (size % 2); // chunks are word-aligned
  }

  if (!format || !data) {
    throw new Error('WAV sem cabeçalho fmt/data');
  }
  if (format.audioFormat !== 1) {
    throw new Error('WAV precisa ser PCM (sem compressão)');
  }
  return { sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample, pcm: data };
}

/** Averages interleaved PCM16 channels into one. */
export function downmixPcm16ToMono(pcm: Buffer, channels: number): Buffer {
  if (channels <= 1) return pcm;
  const frames = Math.floor(pcm.length / (2 * channels));
  const out = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      sum += pcm.readInt16LE((frame * channels + ch) * 2);
    }
    out.writeInt16LE(Math.round(sum / channels), frame * 2);
  }
  return out;
}

export function pcm16DurationMs(byteLength: number, sampleRate: number): number {
  return (byteLength / 2 / sampleRate) * 1000;
}
