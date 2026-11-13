import { ipcMain } from 'electron';
import { getLogger } from '@neo/logger';
import { getCodexCli } from '../ai/codexCli/CodexCli';

const logger = getLogger();

/** Status/login/logout of the Codex CLI (ChatGPT subscription). */
export function registerCodexCliIpc(): void {
  const cli = getCodexCli();

  ipcMain.handle('codexCli.status', async () => cli.getAuthStatus());

  ipcMain.handle('codexCli.login', async () => {
    try {
      return await cli.login();
    } catch (error: any) {
      logger.warn({ err: error }, 'Codex CLI login failed');
      return { ...(await cli.getAuthStatus()), error: error?.message || 'Falha no login do Codex' };
    }
  });

  ipcMain.handle('codexCli.logout', async () => {
    try {
      return await cli.logout();
    } catch (error: any) {
      return { ...(await cli.getAuthStatus()), error: error?.message || 'Falha ao sair do Codex' };
    }
  });
}
