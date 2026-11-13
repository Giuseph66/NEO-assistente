import { app } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { SubtitleExportFormat, SubtitleSegment } from '@neo/shared';
import { segmentsToSrt, segmentsToVtt } from './subtitleFormats';

/** Writes `<userData>/subtitles/<baseName>.vtt|.srt` for the requested formats. */
export async function writeSubtitleFiles(
  baseName: string,
  segments: SubtitleSegment[],
  exportFormat: SubtitleExportFormat = 'both'
): Promise<{ vttPath?: string; srtPath?: string }> {
  const outputDir = join(app.getPath('userData'), 'subtitles');
  await mkdir(outputDir, { recursive: true });

  let vttPath: string | undefined;
  let srtPath: string | undefined;
  if (exportFormat === 'both' || exportFormat === 'vtt') {
    vttPath = join(outputDir, `${baseName}.vtt`);
    await writeFile(vttPath, segmentsToVtt(segments), 'utf8');
  }
  if (exportFormat === 'both' || exportFormat === 'srt') {
    srtPath = join(outputDir, `${baseName}.srt`);
    await writeFile(srtPath, segmentsToSrt(segments), 'utf8');
  }
  return { vttPath, srtPath };
}
