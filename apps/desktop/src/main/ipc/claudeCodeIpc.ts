import { ipcMain } from 'electron';
import { getLogger } from '@neo/logger';
import { getClaudeCodeCli } from '../ai/claudeCode/ClaudeCodeCli';

const logger = getLogger();

/** Status/login/logout of the Claude Code CLI (Claude.ai subscription). */
export function registerClaudeCodeIpc(): void {
  const cli = getClaudeCodeCli();

  ipcMain.handle('claudeCode.status', async () => cli.getAuthStatus());

  ipcMain.handle('claudeCode.login', async () => {
    try {
      return await cli.login();
    } catch (error: any) {
      logger.warn({ err: error }, 'Claude Code login failed');
      return { ...(await cli.getAuthStatus()), error: error?.message || 'Falha no login do Claude Code' };
    }
  });

  ipcMain.handle('claudeCode.logout', async () => {
    try {
      return await cli.logout();
    } catch (error: any) {
      return { ...(await cli.getAuthStatus()), error: error?.message || 'Falha ao sair do Claude Code' };
    }
  });
}
