import { vi } from 'vitest';

// Main-process modules import Electron and the file logger at load time; unit tests
// run in plain Node, so both are replaced with inert stand-ins.
vi.mock('electron', () => ({
  app: {
    isReady: () => false,
    isPackaged: false,
    getPath: () => '/tmp/neo-desktop-test',
    getAppPath: () => process.cwd(),
  },
  shell: { openExternal: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('@neo/logger', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: () => logger };
});
