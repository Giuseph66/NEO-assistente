import { ipcMain, app, shell } from 'electron';
import { join, extname } from 'path';
import { readdir, stat, unlink, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

async function getFolderSize(path: string): Promise<number> {
    if (!existsSync(path)) return 0;
    
    let totalSize = 0;
    const files = await readdir(path, { withFileTypes: true });
    
    for (const file of files) {
        const fullPath = join(path, file.name);
        if (file.isDirectory()) {
            totalSize += await getFolderSize(fullPath);
        } else {
            const fileStat = await stat(fullPath);
            totalSize += fileStat.size;
        }
    }
    
    return totalSize;
}

export function registerStorageIpc() {
    ipcMain.handle('storage:getStats', async () => {
        const userData = app.getPath('userData');
        const homeDir = app.getPath('home');
        const rickyShare = join(homeDir, '.local', 'share', 'ricky');

        const paths = {
            recordings: join(userData, 'recordings'),
            screenshots: join(userData, 'screenshots'),
            subtitles: join(userData, 'subtitles'),
            automation: join(userData, 'automation', 'templates'),
            db: join(userData, 'ricky.db'),
            notificationsDb: join(userData, 'notifications.sqlite'),
            models: join(rickyShare, 'vosk-models'),
            logs: join(rickyShare, 'logs')
        };

        const stats = {
            media: {
                recordings: await getFolderSize(paths.recordings),
                screenshots: await getFolderSize(paths.screenshots),
                subtitles: await getFolderSize(paths.subtitles),
            },
            automation: await getFolderSize(paths.automation),
            databases: {
                main: existsSync(paths.db) ? (await stat(paths.db)).size : 0,
                notifications: existsSync(paths.notificationsDb) ? (await stat(paths.notificationsDb)).size : 0,
            },
            models: await getFolderSize(paths.models),
            logs: await getFolderSize(paths.logs),
        };

        return stats;
    });

    ipcMain.handle('storage:openFolder', async (_event, type: string) => {
        const userData = app.getPath('userData');
        const homeDir = app.getPath('home');
        
        let targetPath = userData;
        if (type === 'recordings') targetPath = join(userData, 'recordings');
        if (type === 'screenshots') targetPath = join(userData, 'screenshots');
        if (type === 'models') targetPath = join(homeDir, '.local', 'share', 'ricky', 'vosk-models');
        if (type === 'logs') targetPath = join(homeDir, '.local', 'share', 'ricky', 'logs');

        if (existsSync(targetPath)) {
            shell.openPath(targetPath);
        }
    });

    ipcMain.handle('storage:clearCache', async () => {
        const ses = app.getAppMetrics(); // Just to do something or use session
        // Clear electron cache
        const { session } = require('electron');
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData({
            storages: ['shadercache', 'codecache']
        });
        return true;
    });

    ipcMain.handle('storage:deleteFolderContents', async (_event, type: string) => {
        const userData = app.getPath('userData');
        let targetPath = '';
        
        if (type === 'recordings') targetPath = join(userData, 'recordings');
        if (type === 'screenshots') targetPath = join(userData, 'screenshots');
        if (type === 'subtitles') targetPath = join(userData, 'subtitles');
        if (type === 'logs') targetPath = join(app.getPath('home'), '.local', 'share', 'ricky', 'logs');

        if (targetPath && existsSync(targetPath)) {
            const files = await readdir(targetPath);
            for (const file of files) {
                await rm(join(targetPath, file), { recursive: true, force: true });
            }
            return true;
        }
        return false;
    });

    ipcMain.handle('storage:listFiles', async (_event, type: string) => {
        const userData = app.getPath('userData');
        const homeDir = app.getPath('home');
        let targetPath = '';

        if (type === 'recordings') targetPath = join(userData, 'recordings');
        else if (type === 'screenshots') targetPath = join(userData, 'screenshots');
        else if (type === 'subtitles') targetPath = join(userData, 'subtitles');
        else if (type === 'logs') targetPath = join(homeDir, '.local', 'share', 'ricky', 'logs');
        else if (type === 'automation') targetPath = join(userData, 'automation', 'templates');

        if (!targetPath || !existsSync(targetPath)) return [];

        try {
            const files = await readdir(targetPath, { withFileTypes: true });
            const result = [];

            for (const file of files) {
                if (file.isFile()) {
                    const fullPath = join(targetPath, file.name);
                    const fileStat = await stat(fullPath);
                    result.push({
                        name: file.name,
                        path: fullPath,
                        fileUrl: pathToFileURL(fullPath).toString(),
                        size: fileStat.size,
                        createdAt: fileStat.birthtimeMs || fileStat.mtimeMs,
                        extension: extname(file.name).toLowerCase()
                    });
                }
            }

            // Sort by newest first
            return result.sort((a, b) => b.createdAt - a.createdAt);
        } catch (err) {
            console.error(`Failed to list files for ${type}:`, err);
            return [];
        }
    });

    ipcMain.handle('storage:deleteFile', async (_event, filePath: string) => {
        try {
            if (existsSync(filePath)) {
                await unlink(filePath);
                return true;
            }
        } catch (err) {
            console.error(`Failed to delete file at ${filePath}:`, err);
        }
        return false;
    });
}
