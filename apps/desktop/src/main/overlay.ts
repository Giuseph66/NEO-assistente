import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { getConfigManager } from '@neo/config';
import { getLogger } from '@neo/logger';

const logger = getLogger();
const config = getConfigManager();

/**
 * Gerenciador da janela overlay
 */
export class OverlayManager {
  private overlayWindow: BrowserWindow | null = null;
  private isVisible: boolean = true;
  private currentContentProtection: boolean | null = null;
  private isLinux: boolean = process.platform === 'linux';
  private translationWindow: BrowserWindow | null = null;
  private translationApplyTimer: NodeJS.Timeout | null = null;

  /**
   * Verifica se a plataforma suporta content protection nativo
   * setContentProtection só funciona no Windows e macOS
   */
  private supportsContentProtection(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin';
  }

  /**
   * Entra no modo de tradução (janela cobre a tela inteira)
   */
  enterTranslationMode(): void {
    this.ensureTranslationWindow();
    if (!this.translationWindow) return;

    this.applyTranslationLayout(this.translationWindow);
    if (this.translationApplyTimer) {
      clearTimeout(this.translationApplyTimer);
    }
    this.translationApplyTimer = setTimeout(() => {
      if (this.translationWindow) {
        this.applyTranslationLayout(this.translationWindow);
      }
    }, 150);

    this.translationWindow.show();
    this.translationWindow.focus();
  }

  ensureTranslationWindow(): void {
    if (!this.translationWindow) {
      this.createTranslationWindow();
    }
  }

  /**
   * Sai do modo de tradução e restaura o tamanho anterior
   */
  exitTranslationMode(): void {
    if (this.translationApplyTimer) {
      clearTimeout(this.translationApplyTimer);
      this.translationApplyTimer = null;
    }
    if (this.translationWindow && this.translationWindow.isVisible()) {
      this.translationWindow.hide();
    }
  }

  hideTranslationWindow(): void {
    if (this.translationWindow && this.translationWindow.isVisible()) {
      this.translationWindow.hide();
    }
  }

  showTranslationWindow(): void {
    if (!this.translationWindow) {
      this.createTranslationWindow();
    }
    if (!this.translationWindow) return;
    this.applyTranslationLayout(this.translationWindow);
    this.translationWindow.show();
  }

  isTranslationWindowVisible(): boolean {
    return Boolean(this.translationWindow && this.translationWindow.isVisible());
  }

  private applyTranslationLayout(target: BrowserWindow): void {
    const reference = (this.overlayWindow && !this.overlayWindow.isDestroyed()) ? this.overlayWindow.getBounds() : screen.getPrimaryDisplay().bounds;
    const display = screen.getDisplayMatching(reference);
    target.setResizable(true);
    target.setMaximizable(true);
    target.setFullScreenable(true);
    target.setBounds(display.bounds, true);
    target.setPosition(display.bounds.x, display.bounds.y);
    target.setSize(display.bounds.width, display.bounds.height, true);
    target.setFullScreen(true);
    target.maximize();
    target.setAlwaysOnTop(true, 'screen-saver');
  }

  /**
   * Cria a janela overlay
   */
  createWindow(): void {
    if (this.overlayWindow) {
      logger.warn('Overlay window already exists');
      return;
    }

    const overlayConfig = config.getAll().overlay;
    const { position, size, opacity, alwaysOnTop, presentationMode } = overlayConfig;
    // contentProtection pode não estar no tipo ainda, mas está no schema
    const contentProtection = (overlayConfig as any).contentProtection !== false; // Default: true

    this.overlayWindow = new BrowserWindow({
      width: size.width || 1200,
      height: size.height || 800,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      alwaysOnTop: alwaysOnTop,
      skipTaskbar: true,
      resizable: true,
      movable: true,
      center: true,
      focusable: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    // Carrega o conteúdo
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#overlay`);
    } else {
      this.overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'overlay',
      });
    }

    // Aplica opacidade via CSS (mais confiável que opacity nativo)
    this.overlayWindow.webContents.on('did-finish-load', () => {
      this.setOpacity(opacity);
      if (presentationMode) {
        this.hide();
      }
    });

    // Ativa content protection para tornar a janela invisível no compartilhamento de tela
    // Isso previne que a janela seja capturada por Google Meet, Zoom, etc.
    // Usa once() para evitar múltiplas execuções e verifica estado interno antes de aplicar
    this.overlayWindow.once('ready-to-show', () => {
      // Usa estado interno se disponível, senão usa config
      const shouldProtect = this.currentContentProtection !== null
        ? this.currentContentProtection
        : (contentProtection !== false);

      // Aplica content protection (que já verifica plataforma internamente)
      this.setContentProtection(shouldProtect);
    });

    // Salva posição e tamanho quando mudados
    this.overlayWindow.on('moved', () => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        const [x, y] = this.overlayWindow.getPosition();
        config.set('overlay', 'position', { x, y });
        logger.debug({ x, y }, 'Overlay position saved');
      }
    });

    this.overlayWindow.on('resized', () => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        const [width, height] = this.overlayWindow.getSize();
        config.set('overlay', 'size', { width, height });
        logger.debug({ width, height }, 'Overlay size saved');
      }
    });

    // Permite foco para edicao; so desfoca no modo apresentacao
    this.overlayWindow.on('focus', () => {
      if (config.getAll().overlay.presentationMode && this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.blur();
      }
    });

    // Limpa a referência quando a janela é fechada
    this.overlayWindow.on('closed', () => {
      this.overlayWindow = null;
      this.isVisible = false;
      logger.debug('Overlay window closed and reference cleared');
    });

    logger.info('Overlay window created');
  }

  /**
   * Cria a janela de overlay de tradução (tela cheia)
   */
  private createTranslationWindow(): void {
    if (this.translationWindow) {
      return;
    }

    this.translationWindow = new BrowserWindow({
      width: 800,
      height: 600,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      movable: false,
      focusable: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      show: false,
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.translationWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#translation-overlay`);
    } else {
      this.translationWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'translation-overlay',
      });
    }

    this.translationWindow.on('closed', () => {
      this.translationWindow = null;
    });
  }

  /**
   * Cria a janela do Editor de Workflow
   */
  createWorkflowEditorWindow(workflowId?: string): void {
    if (this.workflowEditorWindow) {
      this.workflowEditorWindow.show();
      this.workflowEditorWindow.focus();
      // If window exists, we might want to reload with new ID or send IPC
      if (workflowId) {
        const url = is.dev && process.env['ELECTRON_RENDERER_URL']
          ? `${process.env['ELECTRON_RENDERER_URL']}#workflow-editor?id=${workflowId}`
          : `file://${join(__dirname, '../renderer/index.html')}#workflow-editor?id=${workflowId}`;
        this.workflowEditorWindow.loadURL(url);
      }
      return;
    }

    this.workflowEditorWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      show: false,
    });

    const hash = workflowId ? `workflow-editor?id=${workflowId}` : 'workflow-editor';

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.workflowEditorWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`);
    } else {
      this.workflowEditorWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: hash,
      });
    }

    this.workflowEditorWindow.once('ready-to-show', () => {
      if (this.workflowEditorWindow) {
        this.workflowEditorWindow.show();
        this.workflowEditorWindow.focus();
      }
    });

    this.workflowEditorWindow.on('maximize', () => {
      this.workflowEditorWindow?.webContents.send('window:maximized-changed', true);
    });

    this.workflowEditorWindow.on('unmaximize', () => {
      this.workflowEditorWindow?.webContents.send('window:maximized-changed', false);
    });

    this.workflowEditorWindow.on('closed', () => {
      this.workflowEditorWindow = null;
    });
  }

  /**
   * Mostra a janela overlay
   * @param enableContentProtection Se true, também habilita content protection
   */
  show(enableContentProtection: boolean = false): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      this.createWindow();
      return;
    }

    if (!this.overlayWindow.isVisible()) {
      this.overlayWindow.show();
      this.isVisible = true;

      // Se solicitado, também habilita content protection
      if (enableContentProtection) {
        this.setContentProtection(true); // Usa método que já verifica plataforma
      }

      logger.debug('Overlay shown');
    }

    if (this.screenshotPreviewWindow && !this.screenshotPreviewWindow.isDestroyed() && this.screenshotPreviewWindow.isVisible()) {
      this.screenshotPreviewWindow.setAlwaysOnTop(true, 'screen-saver');
      this.screenshotPreviewWindow.show();
      this.screenshotPreviewWindow.moveTop();
    }
  }

  /**
   * Oculta a janela overlay
   * @param disableContentProtection Se true, também desabilita content protection
   */
  hide(disableContentProtection: boolean = false): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible()) {
      this.overlayWindow.hide();
      this.isVisible = false;

      // Se solicitado, também desabilita content protection para garantir que não apareça
      if (disableContentProtection) {
        this.setContentProtection(false); // Usa método que já verifica plataforma
      }

      logger.debug('Overlay hidden');
    }
  }

  /**
   * Alterna visibilidade do overlay
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Define a opacidade do overlay (0-100)
   */
  setOpacity(opacity: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const clampedOpacity = Math.max(0, Math.min(100, opacity));
    config.set('overlay', 'opacity', clampedOpacity);

    // Aplica via CSS
    this.overlayWindow.webContents.executeJavaScript(
      `document.documentElement.style.opacity = ${clampedOpacity / 100}`
    );

    logger.debug({ opacity: clampedOpacity }, 'Overlay opacity set');
  }

  /**
   * Define o modo apresentação (oculta instantaneamente)
   */
  setPresentationMode(enabled: boolean): void {
    config.set('overlay', 'presentationMode', enabled);
    if (enabled) {
      this.hide();
    } else {
      this.show();
    }
    logger.debug({ enabled }, 'Presentation mode toggled');
  }

  /**
   * Aplica workarounds específicos para Linux (já que setContentProtection não funciona)
   * No Linux, não há como esconder completamente da captura, mas podemos tornar a janela mais discreta
   */
  private applyLinuxWorkarounds(enabled: boolean): void {
    if (!this.isLinux || !this.overlayWindow) return;

    // Workarounds já aplicados na criação da janela:
    // - skipTaskbar: true ✓
    // - alwaysOnTop: true ✓
    // - frameless: true ✓
    // - transparent: true ✓

    // Nota: Electron não expõe diretamente override_redirect ou WM hints avançados
    // As propriedades básicas já estão configuradas para tornar a janela discreta

    if (enabled) {
      logger.debug('Linux workarounds active (skipTaskbar, alwaysOnTop, frameless already set)');
      logger.warn('Content protection is limited on Linux - app may still appear in screen sharing. Consider sharing specific windows instead of entire screen.');
    } else {
      logger.debug('Linux workarounds disabled');
    }
  }

  /**
   * Define o content protection (torna janela invisível no compartilhamento de tela)
   * @param enabled true para ocultar no screen sharing, false para permitir captura
   */
  setContentProtection(enabled: boolean): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      logger.warn('Cannot set content protection: overlay window not created or destroyed');
      return;
    }

    // Atualiza estado interno
    this.currentContentProtection = enabled;
    config.set('overlay', 'contentProtection', enabled);

    if (this.supportsContentProtection()) {
      // Windows/macOS: usar API nativa
      try {
        this.overlayWindow.setContentProtection(enabled);
        logger.info({ enabled, platform: process.platform }, 'Content protection set via native API');
      } catch (error) {
        logger.warn({ err: error, enabled, platform: process.platform }, 'Failed to set content protection');
      }
    } else {
      // Linux: aplicar workarounds (setContentProtection não funciona no Linux)
      this.applyLinuxWorkarounds(enabled);
      logger.info({ enabled, platform: 'linux' }, 'Content protection workarounds applied (Linux limitation - setContentProtection not supported)');
    }
  }

  /**
   * Move a janela para uma posição específica
   */
  setPosition(x: number, y: number): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;

      // Garante que a janela fique dentro dos limites da tela
      const clampedX = Math.max(0, Math.min(x, width - 100));
      const clampedY = Math.max(0, Math.min(y, height - 100));

      this.overlayWindow.setPosition(clampedX, clampedY);
      config.set('overlay', 'position', { x: clampedX, y: clampedY });
    }
  }

  /**
   * Redimensiona a janela
   */
  setSize(width: number, height: number): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.setSize(width, height);
      config.set('overlay', 'size', { width, height });
    }
  }

  /**
   * Obtém a janela overlay
   */
  getWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }

  /**
   * Obtém a janela HUD
   */
  getHUDWindow(): BrowserWindow | null {
    return this.hudWindow;
  }

  /**
   * Verifica se o HUD está visível
   */
  isHUDWindowVisible(): boolean {
    return Boolean(this.hudWindow && !this.hudWindow.isDestroyed() && this.hudWindow.isVisible());
  }

  /**
   * Mostra/oculta o HUD principal
   */
  setHUDWindowVisible(visible: boolean): void {
    if (!this.hudWindow || this.hudWindow.isDestroyed()) return;
    if (visible) {
      if (!this.hudWindow.isVisible()) {
        this.hudWindow.show();
      }
    } else if (this.hudWindow.isVisible()) {
      this.hudWindow.hide();
    }
  }

  /**
   * Verifica se o Mini HUD está visível
   */
  isMiniHUDVisible(): boolean {
    return Boolean(this.miniHUDWindow && !this.miniHUDWindow.isDestroyed() && this.miniHUDWindow.isVisible());
  }

  /**
   * Mostra/oculta o Mini HUD
   */
  setMiniHUDVisible(visible: boolean): void {
    if (!this.miniHUDWindow || this.miniHUDWindow.isDestroyed()) return;
    if (visible) {
      if (!this.miniHUDWindow.isVisible()) {
        this.miniHUDWindow.show();
        this.miniHUDWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    } else if (this.miniHUDWindow.isVisible()) {
      this.miniHUDWindow.hide();
    }
  }

  /**
   * Obtém a posição da janela ativa ou HUD
   */
  getWindowPosition(): number[] {
    if (this.hudWindow && !this.hudWindow.isDestroyed()) {
      return this.hudWindow.getPosition();
    }
    return [0, 0];
  }

  /**
   * Verifica se o overlay está visível
   */
  isOverlayVisible(): boolean {
    return Boolean(this.isVisible && this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible());
  }

  /**
   * Obtém o estado atual do content protection
   */
  getCurrentContentProtection(): boolean | null {
    return this.currentContentProtection;
  }

  /**
   * Obtém informações sobre a plataforma e suporte a content protection
   */
  getPlatformInfo(): { platform: string; supportsContentProtection: boolean } {
    return {
      platform: process.platform,
      supportsContentProtection: this.supportsContentProtection()
    };
  }

  /**
   * Obtém o número de monitores conectados
   */
  getDisplayCount(): number {
    try {
      const displays = screen.getAllDisplays();
      return displays.length;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get display count');
      return 1; // Fallback: assume 1 monitor
    }
  }

  /**
   * Move a janela overlay para o próximo monitor disponível
   * Preserva a posição relativa dentro do workArea
   */
  moveToNextMonitor(): boolean {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      logger.warn('Cannot move to next monitor: overlay window not created or destroyed');
      return false;
    }

    try {
      const displays = screen.getAllDisplays();
      if (displays.length < 2) {
        logger.debug('Only one display available, cannot move to next monitor');
        return false; // Nada a fazer com 1 monitor
      }

      const bounds = this.overlayWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(bounds);

      const currentIndex = displays.findIndex(d => d.id === currentDisplay.id);
      if (currentIndex === -1) {
        logger.warn('Current display not found in displays list');
        return false;
      }

      const nextIndex = (currentIndex + 1) % displays.length;
      const nextDisplay = displays[nextIndex];

      // Usar workArea para respeitar barras/docks
      const wa = nextDisplay.workArea;

      // Preservar posição relativa dentro do workArea
      const relativeX = bounds.x - currentDisplay.workArea.x;
      const relativeY = bounds.y - currentDisplay.workArea.y;

      // Calcular nova posição dentro do workArea do próximo monitor
      const newX = wa.x + Math.max(0, Math.min(relativeX, wa.width - bounds.width));
      const newY = wa.y + Math.max(0, Math.min(relativeY, wa.height - bounds.height));

      this.overlayWindow.setBounds({
        x: newX,
        y: newY,
        width: bounds.width,
        height: bounds.height
      }, true);

      // Atualizar posição salva na config
      config.set('overlay', 'position', { x: newX, y: newY });

      this.overlayWindow.focus();

      logger.info({
        from: currentDisplay.id,
        to: nextDisplay.id,
        newPosition: { x: newX, y: newY }
      }, 'Overlay moved to next monitor');

      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to move overlay to next monitor');
      return false;
    }
  }

  private hudWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private historyWindow: BrowserWindow | null = null;
  private textHighlightOutputWindow: BrowserWindow | null = null;
  private screenshotSelectorWindow: BrowserWindow | null = null;
  private screenshotPreviewWindow: BrowserWindow | null = null;
  private commandBarWindow: BrowserWindow | null = null;
  private hudDropdownWindow: BrowserWindow | null = null;
  private workflowEditorWindow: BrowserWindow | null = null;
  private vintageWindow: BrowserWindow | null = null;
  private miniHUDWindow: BrowserWindow | null = null;
  private previouslyVisibleWindows: Set<string> = new Set();
  private isVintagePortalActive: boolean = false;
  private vintagePortalTimeout: NodeJS.Timeout | null = null;
  private vintageCollisionInterval: NodeJS.Timeout | null = null;
  private lastVintageMouseLogTs: number = 0;
  private mouseOverPortalStartTime: number = 0;
  private mouseOverPortalTimeout: NodeJS.Timeout | null = null;

  /**
   * Cria a janela HUD (Persistent Bottom Bar)
   */
  createHUDWindow(): void {
    if (this.hudWindow) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height: screenHeight } = primaryDisplay.workAreaSize;
    const windowWidth = 750;
    const yPosition = primaryDisplay.bounds.height - (primaryDisplay.bounds.height * 0.1);
    // Log detalhado das informações do display
    logger.info({
      display: {
        id: primaryDisplay.id,
        bounds: {
          x: primaryDisplay.bounds.x,
          y: primaryDisplay.bounds.y,
          width: primaryDisplay.bounds.width,
          height: primaryDisplay.bounds.height
        },
        workArea: {
          x: primaryDisplay.workArea.x,
          y: primaryDisplay.workArea.y,
          width: primaryDisplay.workArea.width,
          height: primaryDisplay.workArea.height
        },
        scaleFactor: primaryDisplay.scaleFactor,
        size: {
          width: primaryDisplay.size.width,
          height: primaryDisplay.size.height
        }
      },
      hudWindow: {
        windowWidth,
        windowHeight: 52,
        calculatedY: yPosition,
      },
      allDisplays: screen.getAllDisplays().map(d => ({
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor
      }))
    }, 'Display information and HUD window positioning');
    this.hudWindow = new BrowserWindow({
      width: windowWidth,
      height: 52,
      x: (width - windowWidth) / 2, // Centralizado horizontalmente
      y: yPosition, // 20% de margem do fundo
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.hudWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#hud`);
    } else {
      this.hudWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'hud' });
    }

    // Detecta quando o HUD está sendo arrastado para mostrar a janela vintage
    let isDraggingHUD = false;
    let dragTimeout: NodeJS.Timeout | null = null;

    // OBS(Linux): `will-move` pode não disparar. Mantemos, mas NÃO dependemos dele.
    this.hudWindow.on('will-move', () => {
      if (!isDraggingHUD) {
        isDraggingHUD = true;
        logger.info('HUD: drag iniciado (will-move)');
      }

      // Limpa timeout anterior se existir
      if (dragTimeout) {
        clearTimeout(dragTimeout);
        dragTimeout = null;
      }
    });

    this.hudWindow.on('moved', () => {
      if (!this.hudWindow || this.hudWindow.isDestroyed()) return;

      const hudBounds = this.hudWindow.getBounds();
      logger.info({ x: hudBounds.x, y: hudBounds.y, width: hudBounds.width, height: hudBounds.height }, 'HUD: janela movida');

      // Linux-friendly: se o HUD se moveu, consideramos que o drag começou,
      // mesmo que `will-move` não tenha disparado.
      if (!isDraggingHUD) {
        isDraggingHUD = true;
        logger.info('HUD: drag iniciado (via moved)');
      }

      // Regra: o portal NÃO pode seguir o HUD, senão nunca haverá "drop".
      // Durante o drag, apenas atualizamos a detecção de overlap e animação.
      if (this.isVintagePortalActive) {
        logger.info('Portal ativo: verificando overlap HUD vs Portal...');
        this.checkHUDOverVintage(); // envia vintage:drop-zone-active para HUD + portal
        const mousePos = screen.getCursorScreenPoint();
        this.updateVintageCollision(mousePos.x, mousePos.y);
      }

      // Detecta quando o drag termina (parou de mover por 150ms)
      if (dragTimeout) clearTimeout(dragTimeout);
      dragTimeout = setTimeout(() => {
        if (!isDraggingHUD) return;
        isDraggingHUD = false;

        logger.info('HUD: drag terminou (parou de mover por 150ms). Verificando captura...');

        // Verificação principal: HUD vs Portal
        const isOver = this.checkHUDOverVintageSync();

        // Verificação alternativa: se o mouse está sobre o portal E o HUD está próximo do mouse
        const mousePos = screen.getCursorScreenPoint();
        const hudBounds = this.hudWindow && !this.hudWindow.isDestroyed()
          ? this.hudWindow.getBounds()
          : null;
        const vintageBounds = this.vintageWindow && !this.vintageWindow.isDestroyed()
          ? this.vintageWindow.getBounds()
          : null;

        let mouseOverPortal = false;
        let hudNearMouse = false;

        if (vintageBounds && hudBounds && this.isVintagePortalActive) {
          // Mouse sobre portal?
          mouseOverPortal = (
            mousePos.x >= vintageBounds.x - 40 &&
            mousePos.x <= vintageBounds.x + vintageBounds.width + 40 &&
            mousePos.y >= vintageBounds.y - 40 &&
            mousePos.y <= vintageBounds.y + vintageBounds.height + 40
          );

          // HUD próximo do mouse? (dentro de 100px)
          const distX = Math.abs(mousePos.x - (hudBounds.x + hudBounds.width / 2));
          const distY = Math.abs(mousePos.y - (hudBounds.y + hudBounds.height / 2));
          const distance = Math.sqrt(distX * distX + distY * distY);
          hudNearMouse = distance < 100;

          logger.info({
            mouse: { x: mousePos.x, y: mousePos.y },
            hud: hudBounds ? { x: hudBounds.x, y: hudBounds.y, centerX: hudBounds.x + hudBounds.width / 2, centerY: hudBounds.y + hudBounds.height / 2 } : null,
            vintage: vintageBounds,
            mouseOverPortal,
            hudNearMouse,
            distance: distance.toFixed(1)
          }, 'Verificação alternativa: Mouse + HUD');
        }

        logger.info({
          isVintagePortalActive: this.isVintagePortalActive,
          isOver,
          mouseOverPortal,
          hudNearMouse
        }, 'Resultado da verificação de captura');

        // Captura se: (HUD sobre portal) OU (mouse sobre portal E HUD próximo do mouse)
        const shouldCapture = this.isVintagePortalActive && (isOver || (mouseOverPortal && hudNearMouse));

        if (shouldCapture) {
          logger.info('Portal Ativo: HUD capturado! Iniciando Modo Mini...');
          this.enterMiniMode();
          return;
        }

        // Se não capturou, não escondemos aqui: o portal é fechado pelo timeout do clique direito.
        logger.info({ isVintagePortalActive: this.isVintagePortalActive, isOver }, 'Fim do drag sem captura no portal');
      }, 150);
    });

    this.hudWindow.on('closed', () => {
      isDraggingHUD = false;
      this.hudWindow = null;
    });
  }

  /**
   * Cria a janela de Configurações
   */
  createSettingsWindow(): void {
    if (this.settingsWindow) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 900,
      height: 700,
      frame: false, // Frameless to avoid duplicate controls
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    // Remove menu bar
    this.settingsWindow.setMenuBarVisibility(false);

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#settings`);
    } else {
      this.settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' });
    }

    this.settingsWindow.once('ready-to-show', () => {
      if (!this.settingsWindow || this.settingsWindow.isDestroyed()) return;
      this.settingsWindow.center();
      this.settingsWindow.show();
      this.settingsWindow.focus();
      logger.info('Settings window ready and shown');
    });

    this.settingsWindow.webContents.once('did-finish-load', () => {
      logger.info('Settings window loaded');
    });

    this.settingsWindow.on('closed', () => { this.settingsWindow = null; });
  }

  /**
   * Cria a janela de Histórico
   */
  createHistoryWindow(): void {
    if (this.historyWindow) {
      this.historyWindow.show();
      this.historyWindow.focus();
      return;
    }

    this.historyWindow = new BrowserWindow({
      width: 1000,
      height: 800,
      frame: false, // Frameless
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    this.historyWindow.setMenuBarVisibility(false);

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.historyWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#history`);
    } else {
      this.historyWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'history' });
    }

    this.historyWindow.on('closed', () => { this.historyWindow = null; });
  }

  /**
   * Mostra a janela de Transcrição OCR
   */
  showTextHighlightOutputWindow(): void {
    if (this.textHighlightOutputWindow && !this.textHighlightOutputWindow.isDestroyed()) {
      this.textHighlightOutputWindow.show();
      this.textHighlightOutputWindow.focus();
      return;
    }

    this.textHighlightOutputWindow = new BrowserWindow({
      width: 820,
      height: 620,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    this.textHighlightOutputWindow.setMenuBarVisibility(false);

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.textHighlightOutputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#text-highlight-output`);
    } else {
      this.textHighlightOutputWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'text-highlight-output' });
    }

    this.textHighlightOutputWindow.on('closed', () => { this.textHighlightOutputWindow = null; });
  }

  /**
   * Obtém a janela de Transcrição OCR
   */
  getTextHighlightOutputWindow(): BrowserWindow | null {
    return this.textHighlightOutputWindow;
  }

  /**
   * Mostra a janela de selecao de area para screenshot
   */
  showScreenshotSelectorWindow(display?: Electron.Display): void {
    const targetDisplay = display || screen.getPrimaryDisplay();
    if (this.screenshotSelectorWindow && !this.screenshotSelectorWindow.isDestroyed()) {
      if (process.platform === 'linux') {
        this.screenshotSelectorWindow.hide();
        this.screenshotSelectorWindow.setBounds(targetDisplay.bounds, true);
        this.screenshotSelectorWindow.show();
      } else {
        this.screenshotSelectorWindow.setBounds(targetDisplay.bounds, true);
        this.screenshotSelectorWindow.show();
      }
      this.screenshotSelectorWindow.focus();
      return;
    }

    this.screenshotSelectorWindow = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    this.screenshotSelectorWindow.setMenuBarVisibility(false);
    this.screenshotSelectorWindow.setAlwaysOnTop(true, 'screen-saver');

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.screenshotSelectorWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#screenshot-selector`);
    } else {
      this.screenshotSelectorWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'screenshot-selector' });
    }

    this.screenshotSelectorWindow.on('closed', () => { this.screenshotSelectorWindow = null; });
  }

  /**
   * Obtém a janela de selecao de area para screenshot
   */
  getScreenshotSelectorWindow(): BrowserWindow | null {
    return this.screenshotSelectorWindow;
  }

  /**
   * Mostra a janela de preview de screenshot longo
   */
  showScreenshotPreviewWindow(display?: Electron.Display): void {
    const targetDisplay = display || screen.getPrimaryDisplay();
    const width = 320;
    const height = 220;
    const margin = 18;
    const workArea = targetDisplay.workArea;
    const x = workArea.x + workArea.width - width - margin;
    const y = workArea.y + workArea.height - height - margin;

    if (this.screenshotPreviewWindow && !this.screenshotPreviewWindow.isDestroyed()) {
      this.screenshotPreviewWindow.setBounds({ x, y, width, height }, true);
      this.screenshotPreviewWindow.show();
      this.screenshotPreviewWindow.moveTop();
      return;
    }

    this.screenshotPreviewWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      focusable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    this.screenshotPreviewWindow.setMenuBarVisibility(false);
    this.screenshotPreviewWindow.setAlwaysOnTop(true, 'screen-saver');

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.screenshotPreviewWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#screenshot-preview`);
    } else {
      this.screenshotPreviewWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'screenshot-preview' });
    }

    this.screenshotPreviewWindow.on('closed', () => { this.screenshotPreviewWindow = null; });
  }

  /**
   * Obtém a janela de preview de screenshot longo
   */
  getScreenshotPreviewWindow(): BrowserWindow | null {
    return this.screenshotPreviewWindow;
  }

  /**
   * Cria a janela Command Bar (Spotlight style)
   */
  createCommandBarWindow(): void {
    if (this.commandBarWindow) {
      this.commandBarWindow.show();
      this.commandBarWindow.focus();
      return;
    }

    const { width } = screen.getPrimaryDisplay().workAreaSize;

    this.commandBarWindow = new BrowserWindow({
      width: 800,
      height: 600, // Height for results
      x: (width - 800) / 2,
      y: 200,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.commandBarWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#command-bar`);
    } else {
      this.commandBarWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'command-bar' });
    }

    this.commandBarWindow.on('blur', () => {
      // Auto close on blur like Spotlight?
      // this.commandBarWindow?.hide();
    });

    this.commandBarWindow.on('closed', () => { this.commandBarWindow = null; });
  }

  /**
   * Cria a janela flutuante do dropdown do HUD
   */
  createHUDDropdownWindow(): void {
    if (this.hudDropdownWindow && !this.hudDropdownWindow.isDestroyed()) {
      return;
    }

    this.hudDropdownWindow = new BrowserWindow({
      width: 300,
      height: 400,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      show: false, // Não mostrar até posicionar
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.hudDropdownWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#hud-dropdown`);
    } else {
      this.hudDropdownWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'hud-dropdown' });
    }

    // Fecha ao perder foco ou clicar fora
    this.hudDropdownWindow.on('blur', () => {
      this.hideHUDDropdown();
      // Notifica o HUD principal que o dropdown foi fechado
      const hudWin = this.getHUDWindow();
      if (hudWin && !hudWin.isDestroyed()) {
        hudWin.webContents.send('hud-dropdown:closed');
      }
    });

    this.hudDropdownWindow.on('closed', () => {
      this.hudDropdownWindow = null;
    });

    // Previne fechar ao clicar na própria janela
    this.hudDropdownWindow.setIgnoreMouseEvents(false, { forward: true });
  }

  /**
   * Mostra o dropdown do HUD na posição especificada
   */
  showHUDDropdown(x: number, y: number, data?: any): void {
    if (!this.hudDropdownWindow || this.hudDropdownWindow.isDestroyed()) {
      this.createHUDDropdownWindow();
    }

    if (!this.hudDropdownWindow) return;
    // nao mudar essas constantes(margin, finalX, finalY, dropdownHeight, dropdownWidth)
    const dropdownHeight = 300;
    const dropdownWidth = 300;
    const margin = 50;
    const finalX = x - (dropdownWidth * 0.15);
    const finalY = y - dropdownHeight - margin;

    // Garante que não saia da tela
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    const clampedX = Math.max(workArea.x, Math.min(finalX, workArea.x + workArea.width - dropdownWidth));
    const clampedY = Math.max(workArea.y, Math.min(finalY, workArea.y + workArea.height - dropdownHeight));

    this.hudDropdownWindow.setPosition(Math.round(clampedX), Math.round(clampedY));
    this.hudDropdownWindow.setSize(dropdownWidth, dropdownHeight);

    // Envia dados para a janela
    if (data) {
      this.hudDropdownWindow.webContents.once('did-finish-load', () => {
        this.hudDropdownWindow?.webContents.send('hud-dropdown:data', data);
      });
    }

    this.hudDropdownWindow.show();
    this.hudDropdownWindow.focus();
  }

  /**
   * Esconde o dropdown do HUD
   */
  hideHUDDropdown(): void {
    if (this.hudDropdownWindow && !this.hudDropdownWindow.isDestroyed()) {
      this.hudDropdownWindow.hide();
    }
  }

  /**
   * Verifica se o dropdown está visível
   */
  isHUDDropdownVisible(): boolean {
    return Boolean(this.hudDropdownWindow && !this.hudDropdownWindow.isDestroyed() && this.hudDropdownWindow.isVisible());
  }

  /**
   * Fecha todas as janelas
   */
  destroy(): void {
    if (this.overlayWindow) {
      this.overlayWindow.destroy();
      this.overlayWindow = null;
      this.isVisible = false;
      logger.info('Overlay window destroyed');
    }
    if (this.translationWindow) {
      this.translationWindow.destroy();
      this.translationWindow = null;
      logger.info('Translation overlay window destroyed');
    }
    if (this.hudWindow) this.hudWindow.destroy();
    if (this.settingsWindow) this.settingsWindow.destroy();
    if (this.historyWindow) this.historyWindow.destroy();
    if (this.textHighlightOutputWindow) this.textHighlightOutputWindow.destroy();
    if (this.screenshotSelectorWindow) this.screenshotSelectorWindow.destroy();
    if (this.screenshotPreviewWindow) this.screenshotPreviewWindow.destroy();
    if (this.commandBarWindow) this.commandBarWindow.destroy();
    if (this.hudDropdownWindow) this.hudDropdownWindow.destroy();
    if (this.vintageWindow) this.vintageWindow.destroy();
  }

  /**
   * Cria a janela Vintage decorativa
   */
  createVintageWindow(): void {
    if (this.vintageWindow && !this.vintageWindow.isDestroyed()) {
      logger.debug('Vintage window: already exists, skipping creation');
      return;
    }

    logger.info('Vintage window: creating new window');
    this.vintageWindow = new BrowserWindow({
      width: 200,
      height: 180,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      show: false,
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.vintageWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#vintage-window`);
    } else {
      this.vintageWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'vintage-window' });
    }

    this.vintageWindow.setIgnoreMouseEvents(true);

    this.vintageWindow.on('show', () => {
      this.startCollisionTracking();
    });

    this.vintageWindow.on('hide', () => {
      this.stopCollisionTracking();
    });

    this.vintageWindow.on('closed', () => {
      logger.debug('Vintage window: closed');
      this.stopCollisionTracking();
      this.vintageWindow = null;
    });

    this.vintageWindow.webContents.on('did-finish-load', () => {
      logger.debug('Vintage window: content loaded');
    });

    logger.info('Vintage window: created successfully');
  }

  /**
   * Inicia o rastreamento de colisão periódico
   */
  private startCollisionTracking(): void {
    if (this.vintageCollisionInterval) return;

    this.vintageCollisionInterval = setInterval(() => {
      if (this.vintageWindow && !this.vintageWindow.isDestroyed() && this.vintageWindow.isVisible()) {
        const mousePos = screen.getCursorScreenPoint();
        // Logger das coordenadas do mouse enquanto a janela vintage estiver aberta (throttle para não poluir)
        const now = Date.now();
        if (now - this.lastVintageMouseLogTs >= 300) {
          this.lastVintageMouseLogTs = now;
          logger.info({ x: mousePos.x, y: mousePos.y }, 'Mouse (screen coords) enquanto portal vintage está aberto');
        }
        this.updateVintageCollision(mousePos.x, mousePos.y);
        this.checkHUDOverVintage();
      } else {
        this.stopCollisionTracking();
      }
    }, 100); // 10fps para detecção de colisão
  }

  /**
   * Para o rastreamento de colisão
   */
  private stopCollisionTracking(): void {
    if (this.vintageCollisionInterval) {
      clearInterval(this.vintageCollisionInterval);
      this.vintageCollisionInterval = null;
    }
    this.lastVintageMouseLogTs = 0;
  }

  /**
   * Mostra a janela vintage na posição especificada
   */
  showVintageWindow(x?: number, y?: number): void {
    logger.info({ x, y }, 'Vintage window: show requested');
    if (!this.vintageWindow || this.vintageWindow.isDestroyed()) {
      logger.debug('Vintage window: creating new window');
      this.createVintageWindow();
    }

    if (this.vintageWindow) {
      let finalX: number;
      let finalY: number;

      // Se não foram fornecidas coordenadas, gera posição aleatória
      if (x === undefined || y === undefined) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const windowWidth = 200; // largura da VintageWindow
        const windowHeight = 180; // altura da VintageWindow

        // Gera posição aleatória garantindo que a janela fique dentro da tela
        finalX = Math.floor(Math.random() * (screenWidth - windowWidth));
        finalY = Math.floor(Math.random() * (screenHeight - windowHeight));

        logger.info({ finalX, finalY, screenWidth, screenHeight }, 'Vintage window: posição aleatória gerada');
      } else {
        finalX = Math.round(x);
        finalY = Math.round(y);
      }

      this.vintageWindow.setPosition(finalX, finalY);
      this.vintageWindow.showInactive(); // show sem roubar foco
      logger.info({ x: finalX, y: finalY }, 'Vintage window: shown at position');

      // Inicia rastreamento imediatamente para garantir que funcione em todos os sistemas
      this.startCollisionTracking();

      // Verificação imediata de colisão ao mostrar
      const mousePos = screen.getCursorScreenPoint();
      this.updateVintageCollision(mousePos.x, mousePos.y);
      this.checkHUDOverVintage();
    } else {
      logger.warn('Vintage window: failed to create/show window');
    }
  }

  /**
   * Move a janela vintage
   */
  moveVintageWindow(x: number, y: number): void {
    if (this.vintageWindow && !this.vintageWindow.isDestroyed()) {
      this.vintageWindow.setPosition(Math.round(x), Math.round(y));

      // Detecção de colisão com o mouse
      const mousePos = screen.getCursorScreenPoint();
      this.updateVintageCollision(mousePos.x, mousePos.y);

      // Verifica se o HUD está sobre a janela vintage (drop zone)
      this.checkHUDOverVintage();
    }
  }

  /**
   * Oculta a janela vintage
   */
  hideVintageWindow(): void {
    if (this.vintageWindow && !this.vintageWindow.isDestroyed()) {
      this.vintageWindow.hide();
    }

    // Limpa timer de mouse sobre portal
    this.mouseOverPortalStartTime = 0;
    if (this.mouseOverPortalTimeout) {
      clearTimeout(this.mouseOverPortalTimeout);
      this.mouseOverPortalTimeout = null;
    }
  }

  /**
   * Atualiza o estado de colisão da janela vintage
   */
  private updateVintageCollision(mouseX: number, mouseY: number): void {
    if (!this.vintageWindow || this.vintageWindow.isDestroyed()) return;

    const bounds = this.vintageWindow.getBounds();
    const margin = 40; // Aumentado para facilitar a detecção

    const isColliding = (
      mouseX >= bounds.x - margin &&
      mouseX <= bounds.x + bounds.width + margin &&
      mouseY >= bounds.y - margin &&
      mouseY <= bounds.y + bounds.height + margin
    );

    // Logger detalhado comparando mouse vs janela
    const distX = mouseX < bounds.x ? bounds.x - mouseX : mouseX > (bounds.x + bounds.width) ? mouseX - (bounds.x + bounds.width) : 0;
    const distY = mouseY < bounds.y ? bounds.y - mouseY : mouseY > (bounds.y + bounds.height) ? mouseY - (bounds.y + bounds.height) : 0;
    const distance = Math.sqrt(distX * distX + distY * distY);

    // Logger apenas quando há mudança de estado ou quando está colidindo (para debug)
    if (isColliding) {
      logger.debug({
        mouse: { x: mouseX, y: mouseY },
        window: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          right: bounds.x + bounds.width,
          bottom: bounds.y + bounds.height
        },
        collision: {
          isColliding,
          margin,
          distance: distance.toFixed(1),
          insideX: mouseX >= bounds.x - margin && mouseX <= bounds.x + bounds.width + margin,
          insideY: mouseY >= bounds.y - margin && mouseY <= bounds.y + bounds.height + margin
        }
      }, 'Comparação Mouse vs Janela Vintage');
    }

    this.vintageWindow.webContents.send('vintage:collision-state', isColliding);

    // Lógica de ativação do Modo Mini baseada no mouse sobre o portal
    if (this.isVintagePortalActive && isColliding) {
      // Se o mouse acabou de entrar no portal, inicia o timer
      if (this.mouseOverPortalStartTime === 0) {
        this.mouseOverPortalStartTime = Date.now();
        logger.info('Mouse entrou no portal - iniciando timer de 1s para Modo Mini...');

        // Limpa timeout anterior se existir
        if (this.mouseOverPortalTimeout) {
          clearTimeout(this.mouseOverPortalTimeout);
        }

        // Timer de 1 segundo para ativar o Modo Mini
        this.mouseOverPortalTimeout = setTimeout(() => {
          if (this.isVintagePortalActive) {
            logger.info('Mouse sobre portal por 1s - Ativando Modo Mini!');
            this.enterMiniMode();
          }
        }, 1000);
      }
    } else {
      // Mouse saiu do portal - reseta o timer
      if (this.mouseOverPortalStartTime > 0) {
        logger.debug('Mouse saiu do portal - cancelando timer');
        this.mouseOverPortalStartTime = 0;
        if (this.mouseOverPortalTimeout) {
          clearTimeout(this.mouseOverPortalTimeout);
          this.mouseOverPortalTimeout = null;
        }
      }
    }
  }

  /**
   * Verifica se o HUD está sobre a janela vintage (drop zone)
   */
  checkHUDOverVintage(): void {
    if (!this.vintageWindow || this.vintageWindow.isDestroyed() || !this.hudWindow || this.hudWindow.isDestroyed()) {
      return;
    }

    const vintageBounds = this.vintageWindow.getBounds();
    const hudBounds = this.hudWindow.getBounds();

    // Verifica sobreposição entre HUD e janela vintage
    const isOverlapping = !(
      hudBounds.x + hudBounds.width < vintageBounds.x ||
      hudBounds.x > vintageBounds.x + vintageBounds.width ||
      hudBounds.y + hudBounds.height < vintageBounds.y ||
      hudBounds.y > vintageBounds.y + vintageBounds.height
    );

    // Envia estado para o renderer da janela vintage (feedback visual)
    this.vintageWindow.webContents.send('vintage:drop-zone-active', isOverlapping);

    // Envia estado para o HUD (para minimizar ao soltar)
    if (this.hudWindow && !this.hudWindow.isDestroyed()) {
      this.hudWindow.webContents.send('vintage:drop-zone-active', isOverlapping);
    }
  }

  /**
   * Verifica síncronamente se o HUD está sobre a janela vintage (retorna boolean)
   */
  private checkHUDOverVintageSync(): boolean {
    if (!this.vintageWindow || this.vintageWindow.isDestroyed() || !this.hudWindow || this.hudWindow.isDestroyed()) {
      return false;
    }

    const vintageBounds = this.vintageWindow.getBounds();
    const hudBounds = this.hudWindow.getBounds();
    const margin = 30; // Aumentado para 80px para ser impossível errar o portal

    // Verifica sobreposição entre HUD e janela vintage com margem de erro generosa
    const isOverlapping = !(
      hudBounds.x + hudBounds.width < vintageBounds.x - margin ||
      hudBounds.x > vintageBounds.x + vintageBounds.width + margin ||
      hudBounds.y + hudBounds.height < vintageBounds.y - margin ||
      hudBounds.y > vintageBounds.y + vintageBounds.height + margin
    );

    // Logger detalhado comparando HUD vs Janela Vintage
    const hudCenterX = hudBounds.x + hudBounds.width / 2;
    const hudCenterY = hudBounds.y + hudBounds.height / 2;
    const vintageCenterX = vintageBounds.x + vintageBounds.width / 2;
    const vintageCenterY = vintageBounds.y + vintageBounds.height / 2;
    const centerDistance = Math.sqrt(
      Math.pow(hudCenterX - vintageCenterX, 2) +
      Math.pow(hudCenterY - vintageCenterY, 2)
    );

    logger.info({
      hud: {
        x: hudBounds.x,
        y: hudBounds.y,
        width: hudBounds.width,
        height: hudBounds.height,
        right: hudBounds.x + hudBounds.width,
        bottom: hudBounds.y + hudBounds.height,
        center: { x: hudCenterX, y: hudCenterY }
      },
      vintage: {
        x: vintageBounds.x,
        y: vintageBounds.y,
        width: vintageBounds.width,
        height: vintageBounds.height,
        right: vintageBounds.x + vintageBounds.width,
        bottom: vintageBounds.y + vintageBounds.height,
        center: { x: vintageCenterX, y: vintageCenterY }
      },
      collision: {
        isOverlapping,
        margin,
        centerDistance: centerDistance.toFixed(1),
        conditions: {
          hudRightBeforeVintageLeft: hudBounds.x + hudBounds.width < vintageBounds.x - margin,
          hudLeftAfterVintageRight: hudBounds.x > vintageBounds.x + vintageBounds.width + margin,
          hudBottomBeforeVintageTop: hudBounds.y + hudBounds.height < vintageBounds.y - margin,
          hudTopAfterVintageBottom: hudBounds.y > vintageBounds.y + vintageBounds.height + margin
        }
      }
    }, 'Comparação HUD vs Janela Vintage (Drop Zone)');

    return isOverlapping;
  }

  /**
   * Minimiza a janela HUD (com verificação de portal)
   */
  minimizeHUD(): void {
    if (this.hudWindow && !this.hudWindow.isDestroyed()) {
      const isOver = this.checkHUDOverVintageSync();

      if (this.isVintagePortalActive && isOver) {
        logger.info('HUD Minimizado via Portal: Iniciando Modo Mini');
        this.enterMiniMode();
      } else {
        logger.info('HUD Minimizado normalmente');
        this.hudWindow.minimize();
      }
    }
  }

  /**
   * Clique direito no HUD entra direto no Modo Mini.
   */
  handleHUDRightClick(): void {
    logger.info('HUD: clique direito detectado, ativando Modo Mini imediatamente');

    // Garante que qualquer estado do portal antigo seja limpo.
    this.isVintagePortalActive = false;
    if (this.vintagePortalTimeout) {
      clearTimeout(this.vintagePortalTimeout);
      this.vintagePortalTimeout = null;
    }

    // Limpa timer de mouse sobre portal
    this.mouseOverPortalStartTime = 0;
    if (this.mouseOverPortalTimeout) {
      clearTimeout(this.mouseOverPortalTimeout);
      this.mouseOverPortalTimeout = null;
    }

    this.hideVintageWindow();
    this.enterMiniMode();
  }

  /**
   * Cria a janela Mini-HUD (Bolinha)
   */
  createMiniHUDWindow(): void {
    if (this.miniHUDWindow && !this.miniHUDWindow.isDestroyed()) {
      return;
    }

    this.miniHUDWindow = new BrowserWindow({
      width: 64,
      height: 64,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      show: false,
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.miniHUDWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#mini-hud`);
    } else {
      this.miniHUDWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini-hud' });
    }

    this.miniHUDWindow.on('closed', () => {
      this.miniHUDWindow = null;
    });

    this.miniHUDWindow.webContents.on('context-menu', (event) => {
      event.preventDefault();
      logger.info('MiniHUD: context-menu detectado nativamente');
      this.exitMiniMode();
    });
  }

  /**
   * Entra no Modo Mini
   */
  enterMiniMode(): void {
    logger.info('Entrando no Modo Mini');

    // Salva quais janelas do sistema estão visíveis para restaurar depois
    this.previouslyVisibleWindows.clear();

    const checkAndClose = (win: BrowserWindow | null, id: string) => {
      if (win && !win.isDestroyed() && win.isVisible()) {
        this.previouslyVisibleWindows.add(id);
        if (id === 'hud') {
          // HUD apenas esconde, não fecha
          win.hide();
        } else {
          // Outras janelas são fechadas
          win.close();
        }
      }
    };

    checkAndClose(this.hudWindow, 'hud');
    checkAndClose(this.overlayWindow, 'overlay');
    checkAndClose(this.settingsWindow, 'settings');
    checkAndClose(this.historyWindow, 'history');
    checkAndClose(this.textHighlightOutputWindow, 'text-highlight-output');
    checkAndClose(this.commandBarWindow, 'command-bar');

    this.hideVintageWindow();
    this.isVintagePortalActive = false;
    if (this.vintagePortalTimeout) {
      clearTimeout(this.vintagePortalTimeout);
    }

    // Limpa timer de mouse sobre portal
    this.mouseOverPortalStartTime = 0;
    if (this.mouseOverPortalTimeout) {
      clearTimeout(this.mouseOverPortalTimeout);
      this.mouseOverPortalTimeout = null;
    }

    // Mostra a bolinha
    this.createMiniHUDWindow();
    if (this.miniHUDWindow) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;

      const margin = height * 0.1;
      const x = Math.round((width - 64) / 2);
      const y = Math.round(margin);

      this.miniHUDWindow.setPosition(x, y);
      this.miniHUDWindow.show();
      this.miniHUDWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }

  /**
   * Sai do Modo Mini e restaura o ambiente
   */
  exitMiniMode(): void {
    logger.info('Saindo do Modo Mini, restaurando ambiente');

    if (this.miniHUDWindow && !this.miniHUDWindow.isDestroyed()) {
      this.miniHUDWindow.hide();
    }

    // Restaura/Recria janelas que estavam abertas antes do Modo Mini
    if (this.previouslyVisibleWindows.has('hud')) {
      if (this.hudWindow && !this.hudWindow.isDestroyed()) {
        this.hudWindow.show();
      }
    }

    if (this.previouslyVisibleWindows.has('overlay')) {
      if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
        this.createWindow();
      } else {
        this.overlayWindow.show();
      }
    }

    if (this.previouslyVisibleWindows.has('settings')) {
      if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
        this.createSettingsWindow();
      } else {
        this.settingsWindow.show();
      }
    }

    if (this.previouslyVisibleWindows.has('history')) {
      if (!this.historyWindow || this.historyWindow.isDestroyed()) {
        this.createHistoryWindow();
      } else {
        this.historyWindow.show();
      }
    }

    if (this.previouslyVisibleWindows.has('text-highlight-output')) {
      if (!this.textHighlightOutputWindow || this.textHighlightOutputWindow.isDestroyed()) {
        this.showTextHighlightOutputWindow();
      } else {
        this.textHighlightOutputWindow.show();
      }
    }

    if (this.previouslyVisibleWindows.has('command-bar')) {
      if (!this.commandBarWindow || this.commandBarWindow.isDestroyed()) {
        this.createCommandBarWindow();
      } else {
        this.commandBarWindow.show();
      }
    }

    this.previouslyVisibleWindows.clear();
  }

  /**
   * Move o MiniHUD durante o drag
   */
  dragMiniHUD(deltaX: number, deltaY: number): void {
    if (!this.miniHUDWindow || this.miniHUDWindow.isDestroyed()) return;

    const bounds = this.miniHUDWindow.getBounds();
    const newX = bounds.x + deltaX;
    const newY = bounds.y + deltaY;

    this.miniHUDWindow.setPosition(newX, newY);
  }
}

// Singleton
let overlayManager: OverlayManager | null = null;

/**
 * Obtém instância singleton do OverlayManager
 */
export function getOverlayManager(): OverlayManager {
  if (!overlayManager) {
    overlayManager = new OverlayManager();
  }
  return overlayManager;
}
