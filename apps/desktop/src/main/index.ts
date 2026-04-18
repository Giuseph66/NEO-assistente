import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { mkdir, writeFile, readdir, stat, readFile, unlink } from 'fs/promises'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import { extname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupErrorHandlers, setShuttingDown } from './error-handler'
import { getOverlayManager } from './overlay'
import { getTextHighlightOverlayManager } from './text-highlight-overlay'
import {
    runTextHighlight,
    getTextHighlightMode,
    setTextHighlightMode,
    getTextHighlightCaptureMode,
    setTextHighlightCaptureMode,
    getLastTextHighlightTranscription
} from './text-highlight-controller'
import { getHotkeysManager } from './hotkeys'
import { getConfigManager } from '@neo/config'
import { getLogger } from '@neo/logger'
import { DatabaseManager } from './database'
import { Gateway } from './gateway'
import { getEngineManager } from './engine-manager'
import { captureAreaInteractiveConfirmed, captureScreenshot } from './screenshot'
import { registerSttIpc } from './ipc/sttIpc'
import { registerModelIpc } from './ipc/modelIpc'
import { registerSystemAudioIpc } from './ipc/systemAudioIpc'
import { registerRecorderIpc } from './ipc/recorderIpc'
import { registerTranscribeFileIpc } from './ipc/transcribeFileIpc'
import { registerAIIpc } from './ipc/aiIpc'
import { registerSystemSttIpc } from './ipc/systemSttIpc'
import { registerScreenshotIpc } from './ipc/screenshotIpc'
import { registerTranslationIpc } from './ipc/translationIpc'
import { registerSessionIpc } from './ipc/sessionIpc'
import { registerAutomationIpc } from './ipc/automationIpc'
import { registerAutomationFlowIpc } from './ipc/automationFlowIpc'
import { registerAuthIpc } from './ipc/authIpc'
import { registerStorageIpc } from './ipc/storageIpc'
import { registerPhoneMicIpc } from './ipc/phoneMicIpc'
import { NotificationStore } from './notifications/notification-store'
import { NotificationCenter } from './notifications/notification-center'
import { registerNotificationsIpc } from './notifications/notifications-ipc'
import { getModelManager, getSttController } from './stt/sttService'
import { SystemAudioSourceManager } from './audio/system/SystemAudioSourceManager'
import { RecorderService } from './audio/recording/RecorderService'
import { SystemSttController } from './stt/SystemSttController'
import { ScreenTranslateService } from './services/translation/ScreenTranslateService'
import { SystemAudioPreviewService } from './audio/system/SystemAudioPreviewService'
import { getPhoneMicServer } from './audio/phone/PhoneMicServer'
import { setSharedSttText, getSharedSttText, clearSharedSttText } from './storage/sharedInputStore'

function createWindow(): void {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 900,
        height: 670,
        show: false,
        autoHideMenuBar: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        hasShadow: false,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
        // Ativa content protection para tornar a janela invisível no compartilhamento de tela
        // Isso previne que a janela seja capturada por Google Meet, Zoom, etc.
        try {
            mainWindow.setContentProtection(true);
            logger.info('Content protection enabled for main window (invisible in screen sharing)');
        } catch (error) {
            logger.warn({ err: error }, 'Failed to set content protection for main window (may not be supported on this system)');
        }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// Setup error handlers
setupErrorHandlers();

// Initialize logger
const logger = getLogger();
let db: DatabaseManager;
let notificationStore: NotificationStore | null = null;
let notificationCenter: NotificationCenter | null = null;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.ricky.assistant')

    // Initialize config
    const config = getConfigManager();
    logger.info('Configuration loaded');

    // Initialize database
    db = new DatabaseManager();
    logger.info('Database initialized');

    // Initialize notification center persistence/service
    notificationStore = new NotificationStore();
    notificationCenter = new NotificationCenter(notificationStore);
    await notificationCenter.start();
    logger.info({ path: notificationStore.getPath() }, 'Notification center initialized');

    // Initialize WebSocket gateway
    const gateway = new Gateway(8788);
    gateway.setDatabase(db);
    logger.info('Gateway initialized');

    // Start engine process (async, não bloqueia)
    const engineManager = getEngineManager();
    engineManager.start().catch((error) => {
        logger.error({ err: error }, 'Failed to start engine (continuing without STT)');
    });

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    // Create overlay window
    const overlayManager = getOverlayManager();
    // (TextHighlightOverlayManager already initialized above)

    // Text Highlight Overlay Manager (OCR) initialization
    const thManager = getTextHighlightOverlayManager();
    await thManager.initialize();

    ipcMain.handle('text-highlight:getMode', async () => {
        return { mode: getTextHighlightMode() };
    });

    ipcMain.handle('text-highlight:setMode', async (_event, mode: 'local' | 'ai') => {
        const nextMode = setTextHighlightMode(mode);
        return { mode: nextMode };
    });

    ipcMain.handle('text-highlight:getLastTranscription', async () => {
        return getLastTextHighlightTranscription();
    });

    ipcMain.handle('text-highlight:getCaptureMode', async () => {
        return { mode: getTextHighlightCaptureMode() };
    });

    ipcMain.handle('text-highlight:setCaptureMode', async (_event, mode: 'fullscreen' | 'area') => {
        const nextMode = setTextHighlightCaptureMode(mode);
        return { mode: nextMode };
    });

    // Listen for HUD trigger to start OCR overlay
    ipcMain.on('hud:trigger-text-highlight', async () => {
        logger.info('HUD: trigger-text-highlight received');
        try {
            await runTextHighlight();
        } catch (err) {
            logger.error({ err }, 'TextHighlightOverlay: failed to highlight from HUD');
        }
    });

    // Register overlay IPC handlers BEFORE creating window to ensure they're available
    // IPC handlers for overlay
    ipcMain.on('overlay:minimize', () => {
        const window = overlayManager.getWindow();
        if (window && !window.isDestroyed()) {
            if (window.isMinimizable()) {
                window.minimize();
            } else {
                window.hide();
            }
        }
    });

    ipcMain.on('overlay:close', () => {
        const window = overlayManager.getWindow();
        if (window && !window.isDestroyed()) {
            window.close();
        }
    });

    // IPC handlers for content protection
    ipcMain.handle('overlay:setContentProtection', async (_event, enabled: boolean) => {
        try {
            overlayManager.setContentProtection(enabled);
            return { success: true };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to set content protection via IPC');
            return { success: false, error: error?.message || 'Unknown error' };
        }
    });

    ipcMain.handle('overlay:getContentProtection', async () => {
        try {
            const overlayManager = getOverlayManager();
            const currentState = overlayManager.getCurrentContentProtection();
            const platformInfo = overlayManager.getPlatformInfo();

            // Retorna estado interno se disponível, senão usa config como fallback
            const enabled = currentState !== null ? currentState : true;

            return {
                enabled,
                platform: platformInfo.platform,
                supportsContentProtection: platformInfo.supportsContentProtection,
                usingWorkarounds: !platformInfo.supportsContentProtection
            };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to get content protection via IPC');
            return {
                enabled: true,
                platform: process.platform,
                supportsContentProtection: false,
                usingWorkarounds: true
            };
        }
    });

    // Handler para obter número de monitores
    ipcMain.handle('overlay:getDisplayCount', async () => {
        try {
            const overlayManager = getOverlayManager();
            const count = overlayManager.getDisplayCount();
            return { count };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to get display count via IPC');
            return { count: 1 };
        }
    });

    // Handler para mover janela para próximo monitor
    ipcMain.handle('overlay:moveToNextMonitor', async () => {
        try {
            const overlayManager = getOverlayManager();
            const success = overlayManager.moveToNextMonitor();
            return { success };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to move to next monitor via IPC');
            return { success: false, error: error?.message || 'Unknown error' };
        }
    });

    // IPC handlers for panic button (apenas altera content protection, mantém janela visível)
    ipcMain.on('overlay:panic', (_event, { hide }: { hide: boolean }) => {
        try {
            if (hide) {
                // Desabilitar content protection: janela fica visível para você, mas invisível no compartilhamento
                overlayManager.setContentProtection(false);
                // Garante que a janela está visível (caso tenha sido escondida antes)
                overlayManager.show();
                logger.info('Panic mode: content protection disabled (window remains visible to you)');
            } else {
                // Habilitar content protection: janela fica protegida do compartilhamento
                overlayManager.setContentProtection(true);
                // Garante que a janela está visível
                overlayManager.show();
                logger.info('Panic mode: content protection enabled (window invisible in screen sharing)');
            }
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to toggle panic mode');
        }
    });

    // IPC handler to open external URLs in default browser
    ipcMain.on('app:open-url', (_event, url: string) => {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            shell.openExternal(url).catch((err) => {
                logger.error({ err, url }, 'Failed to open external URL');
            });
        }
    });

    // Window Management IPCs
    ipcMain.on('window:open-settings', () => {
        overlayManager.createSettingsWindow();
    });

    ipcMain.on('window:open-history', () => {
        overlayManager.createHistoryWindow();
    });

    ipcMain.on('window:open-hud', () => {
        overlayManager.createHUDWindow();
    });

    ipcMain.on('window:open-command-bar', () => {
        overlayManager.createCommandBarWindow();
    });

    ipcMain.on('window:open-workflow-editor', (_event, workflowId?: string) => {
        overlayManager.createWorkflowEditorWindow(workflowId);
    });

    // HUD Dropdown handlers
    ipcMain.handle('hud-dropdown:show', async (event, { x, y, data }: { x: number; y: number; data?: any }) => {
        const hudWindow = overlayManager.getHUDWindow();
        if (hudWindow && !hudWindow.isDestroyed()) {
            const [winX, winY] = hudWindow.getPosition();
            // Converte coordenadas locais do clique para coordenadas globais da tela
            overlayManager.showHUDDropdown(winX + x, winY + y, data);
        } else {
            // Fallback para o ponto do cursor se a janela do HUD não for encontrada
            const { screen } = require('electron');
            const point = screen.getCursorScreenPoint();
            overlayManager.showHUDDropdown(point.x, point.y, data);
        }
        return { success: true };
    });

    ipcMain.on('hud-dropdown:hide', () => {
        overlayManager.hideHUDDropdown();
    });

    // Shared STT Input handlers - para o atalho de colar texto STT em apps externos
    ipcMain.on('stt-input:update', (_event, text: string) => {
        setSharedSttText(text);
    });

    ipcMain.on('stt-input:clear', () => {
        clearSharedSttText();
    });

    ipcMain.handle('stt-input:get', () => {
        return getSharedSttText();
    });

    ipcMain.handle('hud-dropdown:isVisible', async () => {
        return { visible: overlayManager.isHUDDropdownVisible() };
    });

    ipcMain.on('hud:select-personality', (_event, { personalityId }: { personalityId: number }) => {
        // Notifica o HUD principal sobre a seleção
        const hudWindow = overlayManager.getHUDWindow();
        if (hudWindow && !hudWindow.isDestroyed()) {
            hudWindow.webContents.send('hud:personality-selected', { personalityId });
        }
    });

    // Vintage Window Management
    ipcMain.on('window:vintage-show', (_event, { x, y }: { x: number; y: number }) => {
        overlayManager.showVintageWindow(x, y);
    });

    ipcMain.on('window:vintage-move', (_event, { x, y }: { x: number; y: number }) => {
        overlayManager.moveVintageWindow(x, y);
    });

    ipcMain.on('window:vintage-hide', () => {
        overlayManager.hideVintageWindow();
    });

    ipcMain.on('window:get-pos', (event) => {
        event.returnValue = overlayManager.getWindowPosition();
    });

    ipcMain.on('window:minimize-hud', () => {
        overlayManager.minimizeHUD();
    });

    ipcMain.on('window:check-hud-over-vintage', () => {
        overlayManager.checkHUDOverVintage();
    });

    ipcMain.on('window:hud-right-click', () => {
        overlayManager.handleHUDRightClick();
    });

    ipcMain.on('window:enter-mini-mode', () => {
        logger.info('Enter mini mode requested from settings');
        overlayManager.enterMiniMode();
    });

    ipcMain.on('window:mini-hud-right-click', () => {
        logger.info('Mini HUD right click received via IPC');
        overlayManager.exitMiniMode();
    });

    ipcMain.on('window:mini-hud-quit', () => {
        logger.info('Mini HUD quit requested');
        app.quit();
    });

    ipcMain.on('window:mini-hud-drag', (_event, data: { deltaX: number; deltaY: number }) => {
        overlayManager.dragMiniHUD(data.deltaX, data.deltaY);
    });

    ipcMain.on('window:open-session', () => {
        const window = overlayManager.getWindow();
        if (window && !window.isDestroyed()) {
            window.show();
            window.focus();
        } else {
            overlayManager.createWindow();
        }
    });

    // Permissions IPC handlers
    ipcMain.handle('permissions:checkMicrophone', async () => {
        try {
            // Tenta acessar o microfone para verificar permissão
            // No Linux, isso geralmente funciona se o usuário já concedeu permissão antes
            // ou se o sistema não requer permissão explícita
            const { systemPreferences } = require('electron');
            if (systemPreferences && systemPreferences.getMediaAccessStatus) {
                const status = systemPreferences.getMediaAccessStatus('microphone');
                return {
                    granted: status === 'granted',
                    status: status || 'unknown'
                };
            }
            // Fallback: assumir que está disponível se não houver API de verificação
            return { granted: true, status: 'not-checked' };
        } catch (error: any) {
            logger.warn({ err: error }, 'Failed to check microphone permission');
            return { granted: false, status: 'error', error: error?.message };
        }
    });

    ipcMain.handle('permissions:requestMicrophone', async () => {
        try {
            const { systemPreferences } = require('electron');
            if (systemPreferences && systemPreferences.askForMediaAccess) {
                const granted = await systemPreferences.askForMediaAccess('microphone');
                return { granted, status: granted ? 'granted' : 'denied' };
            }
            // Se não houver API de solicitação, retornar como disponível
            return { granted: true, status: 'not-required' };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to request microphone permission');
            return { granted: false, status: 'error', error: error?.message };
        }
    });

    ipcMain.handle('permissions:openSystemSettings', async () => {
        try {
            const platform = process.platform;

            if (platform === 'linux') {
                // Tenta abrir configurações de privacidade/permissões no Linux
                // Diferentes distribuições têm diferentes ferramentas
                const commands = [
                    { cmd: 'gnome-control-center', args: ['privacy'] },  // GNOME - abre diretamente privacidade
                    { cmd: 'gnome-control-center', args: [] },           // GNOME - abre painel geral
                    { cmd: 'systemsettings', args: [] },                  // KDE Plasma
                    { cmd: 'kcmshell5', args: ['privacy'] },             // KDE - módulo de privacidade
                    { cmd: 'xfce4-settings-manager', args: [] },         // XFCE
                    { cmd: 'gnome-settings', args: [] },                 // GNOME alternativo
                ];

                // Tenta executar o primeiro comando disponível
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);

                for (const { cmd, args } of commands) {
                    try {
                        await execAsync(`which ${cmd}`);
                        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
                        child.unref(); // Permite que o processo pai termine sem esperar
                        logger.info({ command: cmd, args }, 'Opened system settings');
                        return { success: true, command: cmd };
                    } catch {
                        continue;
                    }
                }

                // Fallback: tenta abrir via xdg-open (padrão Linux)
                try {
                    spawn('xdg-open', ['settings://privacy'], { detached: true, stdio: 'ignore' }).unref();
                    return { success: true, command: 'xdg-open' };
                } catch {
                    // Último fallback: abre o gerenciador de arquivos na pasta home
                    shell.openPath(app.getPath('home'));
                    return { success: true, command: 'fallback' };
                }
            } else if (platform === 'darwin') {
                // macOS - abre diretamente nas configurações de privacidade do microfone
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
                return { success: true };
            } else if (platform === 'win32') {
                // Windows - abre diretamente nas configurações de privacidade do microfone
                shell.openExternal('ms-settings:privacy-microphone');
                return { success: true };
            }

            return { success: false, error: 'Unsupported platform' };
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to open system settings');
            return { success: false, error: error?.message };
        }
    });

    ipcMain.on('window:minimize', (event) => {
        if (event.sender.isDestroyed()) return;
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.minimize();
    });

    ipcMain.on('window:minimize-all', () => {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
                win.minimize();
            }
        });
    });

    ipcMain.on('window:maximize', (event) => {
        if (event.sender.isDestroyed()) return;
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win?.isMaximized()) {
            win.unmaximize();
        } else {
            win?.maximize();
        }
    });

    ipcMain.on('window:close', (event) => {
        if (event.sender.isDestroyed()) return;
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.close();
    });

    ipcMain.on('app:quit', () => {
        app.quit();
    });

    registerScreenshotIpc();

    // Initial view: HUD
    overlayManager.createHUDWindow();

    // Dev helper: optionally open Settings automatically to make development visible
    if (is.dev && process.env.NEO_DEV_OPEN_SETTINGS === '1') {
        setTimeout(() => {
            overlayManager.createSettingsWindow();
        }, 250);
    }

    // Initialize STT pipeline + IPC
    const modelManager = getModelManager();
    const sttController = getSttController(db);
    registerModelIpc(modelManager);
    registerSttIpc(sttController);
    const systemAudioManager = new SystemAudioSourceManager();
    const systemAudioPreview = new SystemAudioPreviewService();
    const recorderService = new RecorderService(db);
    registerSystemAudioIpc(systemAudioManager, systemAudioPreview);
    registerRecorderIpc(recorderService);
    registerTranscribeFileIpc(db, modelManager);
    const systemSttController = new SystemSttController(modelManager, db);
    registerSystemSttIpc(systemSttController);

    const translationService = new ScreenTranslateService();
    registerTranslationIpc(translationService);

    // Initialize AI IPC
    registerAIIpc(db);

    // Initialize Session IPC
    registerSessionIpc(db);

    // Initialize Automation IPC
    registerAutomationIpc();
    registerAutomationFlowIpc(db);

    // Initialize Auth IPC (OAuth PKCE)
    registerAuthIpc();

    // Initialize Storage IPC
    registerStorageIpc();

    // Initialize Phone Mic server IPC
    registerPhoneMicIpc(getPhoneMicServer());

    // Initialize Notifications IPC
    if (notificationStore && notificationCenter) {
        registerNotificationsIpc(notificationStore, notificationCenter);
    }

    // Initialize default AI providers in database
    try {
        db.saveAIProvider({ id: 'gemini', display_name: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com' });
        db.saveAIProvider({ id: 'openai', display_name: 'OpenAI (API Key)', base_url: 'https://api.openai.com' });
        db.saveAIProvider({ id: 'openai-codex', display_name: 'OpenAI (OAuth Codex)', base_url: 'https://chatgpt.com/backend-api/codex' });
        logger.info('Default AI providers initialized');
    } catch (error) {
        logger.warn({ err: error }, 'Failed to initialize default AI providers (may already exist)');
    }

    const runInteractiveCapture = async () => {
        overlayManager.hide();
        try {
            const captureResult = await captureAreaInteractiveConfirmed(db);
            if (captureResult.success) {
                const screenshots = db.getScreenshots(1);
                if (screenshots.length > 0) {
                    gateway.broadcast({
                        type: 'screenshot.captured',
                        payload: { screenshot: screenshots[0] },
                    });
                }
            }
            return captureResult;
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to capture screenshot');
            return {
                success: false,
                error: error?.message || 'Unknown error',
            };
        } finally {
            overlayManager.show();
        }
    };

    const runFullscreenCapture = async () => {
        // Esconde overlay e janela de tradução (se estiver visível)
        overlayManager.hide();
        overlayManager.hideTranslationWindow();
        // Aguarda um pouco para garantir que animações de minimizar/restaurar/fullscreen terminem
        // antes de capturar o screenshot (evita que animações apareçam na captura)
        // 500ms é suficiente para a maioria das animações do sistema
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
            const captureResult = await captureScreenshot({ mode: 'fullscreen' }, db);
            if (captureResult.success) {
                const screenshots = db.getScreenshots(1);
                if (screenshots.length > 0) {
                    gateway.broadcast({
                        type: 'screenshot.captured',
                        payload: { screenshot: screenshots[0] },
                    });
                }
            }
            return captureResult;
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to capture fullscreen screenshot');
            return {
                success: false,
                error: error?.message || 'Unknown error',
            };
        } finally {
            overlayManager.show();
        }
    };

    // Configure screenshot capture callbacks for gateway
    logger.info('Configuring screenshot callbacks');
    gateway.setScreenshotCallbacks(
        async () => {
            logger.debug('Screenshot startCapture callback called');
            const result = await runInteractiveCapture();
            if (!result.success && result.error && result.error !== 'Selecao cancelada') {
                throw new Error(result.error);
            }
        },
        async () => {
            // Cancel capture: interactive tools handle cancel internally
            logger.debug('Screenshot cancel requested (interactive)');
            overlayManager.show();
        }
    );

    // IPC handler direto para iniciar captura (alternativa ao WebSocket)
    ipcMain.on('screenshot:startCapture', () => {
        logger.info('IPC screenshot:startCapture received');
        runInteractiveCapture();
    });

    ipcMain.handle('screenshot:captureFullscreen', async () => {
        logger.info('IPC screenshot:captureFullscreen received');
        const result = await runFullscreenCapture();
        if (result.success) {
            const screenshots = db.getScreenshots(1);
            if (screenshots.length > 0) {
                return { ...result, screenshotId: screenshots[0].id };
            }
        }
        return result;
    });

    ipcMain.handle('screenshot:capture-area-interactive', async () => {
        logger.info('IPC screenshot:capture-area-interactive received');
        const result = await runInteractiveCapture();
        if (result.success) {
            const screenshots = db.getScreenshots(1);
            if (screenshots.length > 0) {
                return { ...result, screenshotId: screenshots[0].id };
            }
        }
        return result;
    });

    // Register global hotkeys
    const hotkeysManager = getHotkeysManager();
    hotkeysManager.registerAll();

    const convertToWav = async (inputPath: string, outputPath: string): Promise<void> => {
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y',
                '-i',
                inputPath,
                '-ac',
                '1',
                '-ar',
                '44100',
                outputPath,
            ]);

            ffmpeg.on('error', (error) => reject(error));
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`ffmpeg exited with code ${code}`));
                }
            });
        });
    };

    ipcMain.handle('audio:save', async (_, { buffer, mimeType }) => {
        const recordingsDir = join(app.getPath('userData'), 'recordings');
        await mkdir(recordingsDir, { recursive: true });

        const safeType = typeof mimeType === 'string' ? mimeType : 'audio/webm';
        const filenameBase = `recording-${Date.now()}`;

        if (safeType.includes('wav')) {
            const filePath = join(recordingsDir, `${filenameBase}.wav`);
            const data = Buffer.from(buffer as ArrayBuffer);
            await writeFile(filePath, data);
            return { filePath, fileUrl: pathToFileURL(filePath).toString() };
        }

        const tempPath = join(app.getPath('temp'), `${filenameBase}.webm`);
        const outputPath = join(recordingsDir, `${filenameBase}.wav`);
        const data = Buffer.from(buffer as ArrayBuffer);
        await writeFile(tempPath, data);
        try {
            await convertToWav(tempPath, outputPath);
        } finally {
            await unlink(tempPath).catch(() => undefined);
        }
        return { filePath: outputPath, fileUrl: pathToFileURL(outputPath).toString() };
    });

    ipcMain.handle('audio:list', async () => {
        const recordingsDir = join(app.getPath('userData'), 'recordings');
        await mkdir(recordingsDir, { recursive: true });
        const entries = await readdir(recordingsDir, { withFileTypes: true });

        const files = await Promise.all(
            entries
                .filter((entry) => entry.isFile())
                .map(async (entry) => {
                    const filePath = join(recordingsDir, entry.name);
                    const info = await stat(filePath);
                    return {
                        filePath,
                        fileUrl: pathToFileURL(filePath).toString(),
                        fileName: entry.name,
                        size: info.size,
                        createdAt: info.mtimeMs,
                    };
                })
        );

        return files
            .filter((file) => /\.(webm|ogg|wav)$/i.test(file.fileName))
            .sort((a, b) => b.createdAt - a.createdAt);
    });

    ipcMain.handle('audio:read', async (_, { filePath }) => {
        const data = await readFile(filePath as string);
        const ext = extname(filePath as string).toLowerCase();
        const mimeType =
            ext === '.wav'
                ? 'audio/wav'
                : ext === '.ogg'
                    ? 'audio/ogg'
                    : 'audio/webm';
        return { buffer: data, mimeType };
    });

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            overlayManager.createWindow();
        }
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Cleanup on quit
app.on('will-quit', async (event) => {
    // Marcar que estamos em processo de shutdown
    // Isso permite filtrar erros esperados de workers durante o encerramento
    setShuttingDown(true);

    const hotkeysManager = getHotkeysManager();
    hotkeysManager.unregisterAll();

    // Aguardar encerramento dos serviços com timeout para evitar travamento
    const shutdownPromises: Promise<void>[] = [];

    const engineManager = getEngineManager();
    shutdownPromises.push(
        Promise.resolve().then(() => {
            engineManager.stop();
        })
    );

    const sttController = getSttController(db);
    shutdownPromises.push(
        sttController.stop().catch((error) => {
            // Logar mas não bloquear o shutdown
            logger.warn({ err: error }, 'Error stopping STT controller during shutdown');
        })
    );

    if (notificationCenter) {
        shutdownPromises.push(
            notificationCenter.stop().catch((error) => {
                logger.warn({ err: error }, 'Error stopping notification center during shutdown');
            })
        );
    }

    try {
        // Aguardar até 5 segundos para o encerramento dos serviços
        await Promise.race([
            Promise.all(shutdownPromises),
            new Promise<void>((resolve) => {
                setTimeout(() => {
                    logger.warn('Shutdown timeout reached, forcing exit');
                    resolve();
                }, 5000);
            })
        ]);
    } catch (error) {
        // Logar mas não bloquear o shutdown
        logger.warn({ err: error }, 'Error during shutdown cleanup');
    }

    logger.info('Application quitting');

    if (notificationStore) {
        try {
            notificationStore.close();
        } catch (error) {
            logger.warn({ err: error }, 'Error closing notifications database');
        } finally {
            notificationStore = null;
            notificationCenter = null;
        }
    }
})
