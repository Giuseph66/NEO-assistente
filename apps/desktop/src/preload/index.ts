import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

const sttApi = {
    start: (config?: any) => ipcRenderer.invoke('stt.start', config),
    stop: () => ipcRenderer.invoke('stt.stop'),
    getStatus: () => ipcRenderer.invoke('stt.getStatus'),
    getConfig: () => ipcRenderer.invoke('stt.getConfig'),
    updateConfig: (config: any) => ipcRenderer.invoke('stt.updateConfig', config),
    sendAudio: (chunk: ArrayBuffer) => ipcRenderer.send('stt.audio', { chunk }),
    onPartial: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('stt.partial', listener)
        return () => ipcRenderer.removeListener('stt.partial', listener)
    },
    onLevel: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('stt.level', listener)
        return () => ipcRenderer.removeListener('stt.level', listener)
    },
    onFinal: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('stt.final', listener)
        return () => ipcRenderer.removeListener('stt.final', listener)
    },
    onStatus: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('stt.status', listener)
        return () => ipcRenderer.removeListener('stt.status', listener)
    },
    onError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('stt.error', listener)
        return () => ipcRenderer.removeListener('stt.error', listener)
    },
    onDebug: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('stt.debug', listener)
        return () => ipcRenderer.removeListener('stt.debug', listener)
    },
}

const modelApi = {
    listInstalled: () => ipcRenderer.invoke('models.listInstalled'),
    listCatalog: () => ipcRenderer.invoke('models.listCatalog'),
    install: (modelId: string) => ipcRenderer.invoke('models.install', modelId),
    remove: (modelId: string) => ipcRenderer.invoke('models.remove', modelId),
    import: (path: string, options?: { language?: string; label?: string }) =>
        ipcRenderer.invoke('models.import', { path, ...options }),
    setActive: (modelId: string) => ipcRenderer.invoke('models.setActive', modelId),
    getActive: () => ipcRenderer.invoke('models.getActive'),
    onInstallProgress: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('model.install.progress', listener)
        return () => ipcRenderer.removeListener('model.install.progress', listener)
    },
    onInstallDone: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('model.install.done', listener)
        return () => ipcRenderer.removeListener('model.install.done', listener)
    },
    onInstallError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('model.install.error', listener)
        return () => ipcRenderer.removeListener('model.install.error', listener)
    },
}

const systemAudioApi = {
    listSources: () => ipcRenderer.invoke('systemAudio.listSources'),
    detectDefaultMonitor: () => ipcRenderer.invoke('systemAudio.detectDefaultMonitor'),
    startPreview: (sourceId: string) => ipcRenderer.invoke('systemAudio.startPreview', sourceId),
    stopPreview: () => ipcRenderer.invoke('systemAudio.stopPreview'),
    onLevel: (cb: (payload: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemAudio.level', listener)
        return () => ipcRenderer.removeListener('systemAudio.level', listener)
    },
}

const recorderApi = {
    start: (options: any) => ipcRenderer.invoke('recorder.start', options),
    stop: () => ipcRenderer.invoke('recorder.stop'),
    getStatus: () => ipcRenderer.invoke('recorder.getStatus'),
    listRecent: (limit?: number) => ipcRenderer.invoke('recorder.listRecent', limit),
    delete: (path: string) => ipcRenderer.invoke('recorder.delete', path),
    getFileUrl: (path: string) => ipcRenderer.invoke('recorder.getFileUrl', path),
    openFolder: () => ipcRenderer.invoke('recorder.openFolder'),
    open: (path: string) => ipcRenderer.invoke('recorder.open', path),
    onStatus: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('recorder.status', listener)
        return () => ipcRenderer.removeListener('recorder.status', listener)
    },
    onError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('recorder.error', listener)
        return () => ipcRenderer.removeListener('recorder.error', listener)
    },
    onLevel: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('recorder.level', listener)
        return () => ipcRenderer.removeListener('recorder.level', listener)
    },
}

const transcribeFileApi = {
    start: (payload: any) => ipcRenderer.invoke('transcribeFile.start', payload),
    saveSegments: (payload: any) => ipcRenderer.invoke('transcribeFile.saveSegments', payload),
    onProgress: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('transcribe.progress', listener)
        return () => ipcRenderer.removeListener('transcribe.progress', listener)
    },
    onDone: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('transcribe.done', listener)
        return () => ipcRenderer.removeListener('transcribe.done', listener)
    },
    onError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('transcribe.error', listener)
        return () => ipcRenderer.removeListener('transcribe.error', listener)
    },
}

const systemSttApi = {
    start: (options: any) => ipcRenderer.invoke('systemStt.start', options),
    stop: () => ipcRenderer.invoke('systemStt.stop'),
    getStatus: () => ipcRenderer.invoke('systemStt.getStatus'),
    onPartial: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemStt.partial', listener)
        return () => ipcRenderer.removeListener('systemStt.partial', listener)
    },
    onFinal: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemStt.final', listener)
        return () => ipcRenderer.removeListener('systemStt.final', listener)
    },
    onStatus: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemStt.status', listener)
        return () => ipcRenderer.removeListener('systemStt.status', listener)
    },
    onError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemStt.error', listener)
        return () => ipcRenderer.removeListener('systemStt.error', listener)
    },
    onDebug: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemStt.debug', listener)
        return () => ipcRenderer.removeListener('systemStt.debug', listener)
    },
    onLevel: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('systemStt.level', listener)
        return () => ipcRenderer.removeListener('systemStt.level', listener)
    },
}

const overlayApi = {
    setContentProtection: (enabled: boolean) => ipcRenderer.invoke('overlay:setContentProtection', enabled),
    getContentProtection: () => ipcRenderer.invoke('overlay:getContentProtection'),
    getDisplayCount: () => ipcRenderer.invoke('overlay:getDisplayCount'),
    moveToNextMonitor: () => ipcRenderer.invoke('overlay:moveToNextMonitor'),
}

const translationApi = {
    start: (options: any) => ipcRenderer.invoke('translation.start', options),
    prepareSelection: (options: any) => ipcRenderer.invoke('translation.prepareSelection', options),
    cancelSelection: () => ipcRenderer.invoke('translation.cancelSelection'),
    stop: () => ipcRenderer.invoke('translation.stop'),
    refresh: () => ipcRenderer.invoke('translation.refresh'),
    getStatus: () => ipcRenderer.invoke('translation.getStatus'),
    getOptions: () => ipcRenderer.invoke('translation.getOptions'),
    setOverlayVisible: (visible: boolean) => ipcRenderer.invoke('translation.setOverlayVisible', { visible }),
    onStatus: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('translation.status', listener)
        return () => ipcRenderer.removeListener('translation.status', listener)
    },
    onResult: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('translation.result', listener)
        return () => ipcRenderer.removeListener('translation.result', listener)
    },
    onError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('translation.error', listener)
        return () => ipcRenderer.removeListener('translation.error', listener)
    },
    onSelectRegion: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('translation.selectRegion', listener)
        return () => ipcRenderer.removeListener('translation.selectRegion', listener)
    },
    onOptions: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('translation.options', listener)
        return () => ipcRenderer.removeListener('translation.options', listener)
    },
}

const textHighlightApi = {
    onBoxes: (cb: (payload: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('text-highlight:setBoxes', listener)
        return () => ipcRenderer.removeListener('text-highlight:setBoxes', listener)
    },
    onClear: (cb: () => void) => {
        const listener = () => cb()
        ipcRenderer.on('text-highlight:clear', listener)
        return () => ipcRenderer.removeListener('text-highlight:clear', listener)
    },
    onLoading: (cb: (payload: { loading: boolean }) => void) => {
        const listener = (_event: any, payload: { loading: boolean }) => cb(payload)
        ipcRenderer.on('text-highlight:loading', listener)
        return () => ipcRenderer.removeListener('text-highlight:loading', listener)
    },
    onTranscription: (cb: (payload: { text: string; mode: 'local' | 'ai'; createdAt: number }) => void) => {
        const listener = (_event: any, payload: { text: string; mode: 'local' | 'ai'; createdAt: number }) => cb(payload)
        ipcRenderer.on('text-highlight:transcription', listener)
        return () => ipcRenderer.removeListener('text-highlight:transcription', listener)
    },
    getLastTranscription: () => ipcRenderer.invoke('text-highlight:getLastTranscription'),
    getMode: () => ipcRenderer.invoke('text-highlight:getMode'),
    setMode: (mode: 'local' | 'ai') => ipcRenderer.invoke('text-highlight:setMode', mode),
    getCaptureMode: () => ipcRenderer.invoke('text-highlight:getCaptureMode'),
    setCaptureMode: (mode: 'fullscreen' | 'area') => ipcRenderer.invoke('text-highlight:setCaptureMode', mode),
}

const aiApi = {
    getConfig: () => ipcRenderer.invoke('ai.getConfig'),
    saveConfig: (config: any) => ipcRenderer.invoke('ai.saveConfig', config),
    listProviders: () => ipcRenderer.invoke('ai.listProviders'),
    listModels: (providerId: string) => ipcRenderer.invoke('ai.listModels', providerId),
    addKey: (providerId: string, key: string, alias: string) => ipcRenderer.invoke('ai.addKey', { providerId, key, alias }),
    removeKey: (keyId: number) => ipcRenderer.invoke('ai.removeKey', keyId),
    updateKeyStatus: (keyId: number, status: 'active' | 'cooldown' | 'disabled') => ipcRenderer.invoke('ai.updateKeyStatus', { keyId, status }),
    listKeys: (providerId?: string) => ipcRenderer.invoke('ai.listKeys', providerId),
    testKey: (keyId: number, providerId: string) => ipcRenderer.invoke('ai.testKey', { keyId, providerId }),
    analyzeScreenshot: (request: any) => ipcRenderer.invoke('ai.analyzeScreenshot', request),
    analyzeText: (request: any) => ipcRenderer.invoke('ai.analyzeText', request),
    extractText: (screenshotId: number) => ipcRenderer.invoke('ai.extractText', screenshotId),
    getSessions: (screenshotId: number) => ipcRenderer.invoke('ai.getSessions', screenshotId),
    getMessages: (sessionId: number) => ipcRenderer.invoke('ai.getMessages', sessionId),
    createSession: (screenshotId: number) => ipcRenderer.invoke('ai.createSession', screenshotId),
    savePromptTemplate: (template: any) => ipcRenderer.invoke('ai.savePromptTemplate', template),
    getPromptTemplates: (category?: string) => ipcRenderer.invoke('ai.getPromptTemplates', category),
    deletePromptTemplate: (id: number) => ipcRenderer.invoke('ai.deletePromptTemplate', id),
    setActivePersonality: (promptId: number | null) => ipcRenderer.invoke('ai.setActivePersonality', promptId),
    getActivePersonality: () => ipcRenderer.invoke('ai.getActivePersonality'),
    onAnalysisStarted: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('ai.analysis.started', listener)
        return () => ipcRenderer.removeListener('ai.analysis.started', listener)
    },
    onAnalysisCompleted: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('ai.analysis.completed', listener)
        return () => ipcRenderer.removeListener('ai.analysis.completed', listener)
    },
    onAnalysisError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('ai.analysis.error', listener)
        return () => ipcRenderer.removeListener('ai.analysis.error', listener)
    },
}

const permissionsApi = {
    checkMicrophone: () => ipcRenderer.invoke('permissions:checkMicrophone'),
    requestMicrophone: () => ipcRenderer.invoke('permissions:requestMicrophone'),
    openSystemSettings: () => ipcRenderer.invoke('permissions:openSystemSettings'),
}

const notificationsApi = {
    list: (filters?: any) => ipcRenderer.invoke('notifications:list', filters || {}),
    get: (id: string) => ipcRenderer.invoke('notifications:get', id),
    clear: (payload?: { days?: number; from?: number; to?: number }) => ipcRenderer.invoke('notifications:clear', payload || {}),
    delete: (id: string) => ipcRenderer.invoke('notifications:delete', id),
    export: (format: 'json' | 'csv', filters?: any) => ipcRenderer.invoke('notifications:export', { format, filters: filters || {} }),
    getSettings: () => ipcRenderer.invoke('notifications:settings:get'),
    setSettings: (patch: any) => ipcRenderer.invoke('notifications:settings:set', patch || {}),
    notify: (payload: any) => ipcRenderer.invoke('notifications:notify', payload || {}),
    onUpdated: (cb: (payload: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('notifications:updated', listener)
        return () => ipcRenderer.removeListener('notifications:updated', listener)
    },
    onSettingsUpdated: (cb: (payload: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('notifications:settings:updated', listener)
        return () => ipcRenderer.removeListener('notifications:settings:updated', listener)
    },
}

const automationApi = {
    getConfig: () => ipcRenderer.invoke('automation.getConfig'),
    saveConfig: (config: any) => ipcRenderer.invoke('automation.saveConfig', config),
    startMappingMode: () => ipcRenderer.invoke('automation.startMappingMode'),
    stopMappingMode: () => ipcRenderer.invoke('automation.stopMappingMode'),
    isMappingMode: () => ipcRenderer.invoke('automation.isMappingMode'),
    recordClick: (x: number, y: number, name: string, type?: string) => ipcRenderer.invoke('automation.recordClick', { x, y, name, type }),
    captureTemplate: (name: string, region?: any) => ipcRenderer.invoke('automation.captureTemplate', { name, region }),
    captureTemplateInteractive: () => ipcRenderer.invoke('automation.captureTemplateInteractive'),
    listMappings: () => ipcRenderer.invoke('automation.listMappings'),
    getMappingPoint: (id: string) => ipcRenderer.invoke('automation.getMappingPoint', id),
    updateMappingPoint: (id: string, updates: any) => ipcRenderer.invoke('automation.updateMappingPoint', { id, updates }),
    deleteMapping: (id: string, type: 'point' | 'template') => ipcRenderer.invoke('automation.deleteMapping', { id, type }),
    getImageTemplate: (id: string) => ipcRenderer.invoke('automation.getImageTemplate', id),
    importImageTemplate: (name: string, dataUrl: string) => ipcRenderer.invoke('automation.importImageTemplate', { name, dataUrl }),
    updateImageTemplate: (id: string, updates: any) => ipcRenderer.invoke('automation.updateImageTemplate', { id, updates }),
    resizeImageTemplate: (id: string, size: { width?: number; height?: number; keepAspect?: boolean }) => ipcRenderer.invoke('automation.resizeImageTemplate', { id, ...size }),
    replaceImageTemplate: (id: string, dataUrl: string) => ipcRenderer.invoke('automation.replaceImageTemplate', { id, dataUrl }),
    cropImageTemplate: (id: string, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('automation.cropImageTemplate', { id, rect }),
    findTemplateOnScreen: (templateName: string, confidence?: number, timeout?: number) => ipcRenderer.invoke('automation.findTemplateOnScreen', { templateName, confidence, timeout }),
    createWorkflow: (workflow: any) => ipcRenderer.invoke('automation.createWorkflow', workflow),
    updateWorkflow: (id: string, workflow: any) => ipcRenderer.invoke('automation.updateWorkflow', { id, workflow }),
    deleteWorkflow: (id: string) => ipcRenderer.invoke('automation.deleteWorkflow', id),
    listWorkflows: () => ipcRenderer.invoke('automation.listWorkflows'),
    getWorkflow: (id: string) => ipcRenderer.invoke('automation.getWorkflow', id),
    executeWorkflow: (workflowId: string) => ipcRenderer.invoke('automation.executeWorkflow', workflowId),
    pauseExecution: () => ipcRenderer.invoke('automation.pauseExecution'),
    resumeExecution: () => ipcRenderer.invoke('automation.resumeExecution'),
    stopExecution: () => ipcRenderer.invoke('automation.stopExecution'),
    getExecutionStatus: () => ipcRenderer.invoke('automation.getExecutionStatus'),
    testAction: (action: any) => ipcRenderer.invoke('automation.testAction', action),
    getMousePosition: () => ipcRenderer.invoke('automation.getMousePosition'),
    getScreenSize: () => ipcRenderer.invoke('automation.getScreenSize'),
    onExecutionStarted: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.execution.started', listener)
        return () => ipcRenderer.removeListener('automation.execution.started', listener)
    },
    onExecutionCompleted: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.execution.completed', listener)
        return () => ipcRenderer.removeListener('automation.execution.completed', listener)
    },
    onExecutionError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.execution.error', listener)
        return () => ipcRenderer.removeListener('automation.execution.error', listener)
    },
    onExecutionProgress: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.execution.progress', listener)
        return () => ipcRenderer.removeListener('automation.execution.progress', listener)
    },
    onExecutionStatus: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.execution.status', listener)
        return () => ipcRenderer.removeListener('automation.execution.status', listener)
    },
    onMappingModeChanged: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.modeChanged', listener)
        return () => ipcRenderer.removeListener('automation.mapping.modeChanged', listener)
    },
    onMappingPointAdded: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.pointAdded', listener)
        return () => ipcRenderer.removeListener('automation.mapping.pointAdded', listener)
    },
    onTemplateAdded: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.templateAdded', listener)
        return () => ipcRenderer.removeListener('automation.mapping.templateAdded', listener)
    },
    onTemplateUpdated: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.templateUpdated', listener)
        return () => ipcRenderer.removeListener('automation.mapping.templateUpdated', listener)
    },
    onTemplateDeleted: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.templateDeleted', listener)
        return () => ipcRenderer.removeListener('automation.mapping.templateDeleted', listener)
    },
    onPointCaptured: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.pointCaptured', listener)
        return () => ipcRenderer.removeListener('automation.mapping.pointCaptured', listener)
    },
    onTemplateCaptured: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.templateCaptured', listener)
        return () => ipcRenderer.removeListener('automation.mapping.templateCaptured', listener)
    },
    onMappingError: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.mapping.error', listener)
        return () => ipcRenderer.removeListener('automation.mapping.error', listener)
    },
    recordPointFromHotkey: (x: number, y: number, name: string, type?: string) => ipcRenderer.invoke('automation.recordPointFromHotkey', { x, y, name, type }),
    recordTemplateFromHotkey: (name: string, region: any, screenshotPath?: string) => ipcRenderer.invoke('automation.recordTemplateFromHotkey', { name, region, screenshotPath }),
    onWorkflowCreated: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('automation.workflow.created', listener)
        return () => ipcRenderer.removeListener('automation.workflow.created', listener)
    },
    flow: {
        listWorkflows: () => ipcRenderer.invoke('automation.flow.listWorkflows'),
        getWorkflow: (id: string) => ipcRenderer.invoke('automation.flow.getWorkflow', id),
        saveWorkflow: (graph: any) => ipcRenderer.invoke('automation.flow.saveWorkflow', graph),
        deleteWorkflow: (id: string) => ipcRenderer.invoke('automation.flow.deleteWorkflow', id),
        validateWorkflow: (graph: any) => ipcRenderer.invoke('automation.flow.validateWorkflow', graph),
        runWorkflow: (id: string) => ipcRenderer.invoke('automation.flow.runWorkflow', id),
        pause: () => ipcRenderer.invoke('automation.flow.pause'),
        resume: () => ipcRenderer.invoke('automation.flow.resume'),
        stop: () => ipcRenderer.invoke('automation.flow.stop'),
        getExecutionStatus: () => ipcRenderer.invoke('automation.flow.getExecutionStatus'),
        onStatus: (cb: (status: any) => void) => {
            const listener = (_event: any, payload: any) => cb(payload)
            ipcRenderer.on('automation.flow.execution.status', listener)
            return () => ipcRenderer.removeListener('automation.flow.execution.status', listener)
        },
        onNodeStarted: (cb: (data: any) => void) => {
            const listener = (_event: any, payload: any) => cb(payload)
            ipcRenderer.on('automation.flow.execution.node.started', listener)
            return () => ipcRenderer.removeListener('automation.flow.execution.node.started', listener)
        },
        onNodeFinished: (cb: (data: any) => void) => {
            const listener = (_event: any, payload: any) => cb(payload)
            ipcRenderer.on('automation.flow.execution.node.finished', listener)
            return () => ipcRenderer.removeListener('automation.flow.execution.node.finished', listener)
        },
    },
}

const authApi = {
    loginOpenAI: (profileId?: string, label?: string) => ipcRenderer.invoke('auth:login-openai', profileId, label),
    finishLoginManual: (profileId: string, codeOrUrl: string, label?: string) => ipcRenderer.invoke('auth:finish-login-manual', profileId, codeOrUrl, label),
    cancelLogin: (profileId: string) => ipcRenderer.invoke('auth:cancel-login', profileId),
    logout: (profileId: string) => ipcRenderer.invoke('auth:logout', profileId),
    getAccessToken: (profileId?: string) => ipcRenderer.invoke('auth:get-access-token', profileId),
    getProfiles: () => ipcRenderer.invoke('auth:get-profiles'),
    setActiveProfile: (profileId: string) => ipcRenderer.invoke('auth:set-active-profile', profileId),
    setProfileEnabled: (profileId: string, isEnabled: boolean) => ipcRenderer.invoke('auth:set-profile-enabled', profileId, isEnabled),
    getStatus: (profileId?: string) => ipcRenderer.invoke('auth:get-status', profileId),
    getConfig: () => ipcRenderer.invoke('auth:get-config'),
    updateConfig: (patch: any) => ipcRenderer.invoke('auth:update-config', patch),
    onStatusChanged: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('auth:status-changed', listener)
        return () => ipcRenderer.removeListener('auth:status-changed', listener)
    },
}

const storageApi = {
    getStats: () => ipcRenderer.invoke('storage:getStats'),
    openFolder: (type: string) => ipcRenderer.invoke('storage:openFolder', type),
    clearCache: () => ipcRenderer.invoke('storage:clearCache'),
    deleteFolderContents: (type: string) => ipcRenderer.invoke('storage:deleteFolderContents', type),
    listFiles: (type: string) => ipcRenderer.invoke('storage:listFiles', type),
    deleteFile: (filePath: string) => ipcRenderer.invoke('storage:deleteFile', filePath),
}

const phoneMicApi = {
    start: (port?: number) => ipcRenderer.invoke('phoneMic.start', port),
    stop: () => ipcRenderer.invoke('phoneMic.stop'),
    getStatus: () => ipcRenderer.invoke('phoneMic.getStatus'),
    testRecord: (durationMs?: number) => ipcRenderer.invoke('phoneMic.testRecord', durationMs ?? 5000),
    approveRequest: (requestId: string) => ipcRenderer.invoke('phoneMic.approveRequest', requestId),
    denyRequest: (requestId: string) => ipcRenderer.invoke('phoneMic.denyRequest', requestId),
    revokeDevice: (deviceId: string) => ipcRenderer.invoke('phoneMic.revokeDevice', deviceId),
    listDevices: () => ipcRenderer.invoke('phoneMic.listDevices'),
    // ─── Virtual system microphone ──────────────────────────────────────────
    enableVirtualDevice: () => ipcRenderer.invoke('phoneMic.enableVirtualDevice'),
    disableVirtualDevice: () => ipcRenderer.invoke('phoneMic.disableVirtualDevice'),
    setVirtualDeviceAsDefault: (enable: boolean) => ipcRenderer.invoke('phoneMic.setVirtualDeviceAsDefault', enable),
    getVirtualDeviceStatus: () => ipcRenderer.invoke('phoneMic.getVirtualDeviceStatus'),
    checkVirtualDeviceAvailability: () => ipcRenderer.invoke('phoneMic.checkVirtualDeviceAvailability'),
    // ─── Event listeners ────────────────────────────────────────────────────
    onStatus: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('phoneMic.status', listener)
        return () => ipcRenderer.removeListener('phoneMic.status', listener)
    },
    onLevel: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('phoneMic.level', listener)
        return () => ipcRenderer.removeListener('phoneMic.level', listener)
    },
    onAudio: (cb: (event: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('phoneMic.audio', listener)
        return () => ipcRenderer.removeListener('phoneMic.audio', listener)
    },
    onIsDefault: (cb: (isDefault: boolean) => void) => {
        const listener = (_event: any, payload: boolean) => cb(payload)
        ipcRenderer.on('phoneMic.isDefault', listener)
        return () => ipcRenderer.removeListener('phoneMic.isDefault', listener)
    },
    onApprovalRequest: (cb: (request: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('phoneMic.approvalRequest', listener)
        return () => ipcRenderer.removeListener('phoneMic.approvalRequest', listener)
    },
    onVirtualDeviceStatus: (cb: (status: any) => void) => {
        const listener = (_event: any, payload: any) => cb(payload)
        ipcRenderer.on('phoneMic.virtualDeviceStatus', listener)
        return () => ipcRenderer.removeListener('phoneMic.virtualDeviceStatus', listener)
    },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
        contextBridge.exposeInMainWorld('stt', sttApi)
        contextBridge.exposeInMainWorld('models', modelApi)
        contextBridge.exposeInMainWorld('systemAudio', systemAudioApi)
        contextBridge.exposeInMainWorld('recorder', recorderApi)
        contextBridge.exposeInMainWorld('transcribeFile', transcribeFileApi)
        contextBridge.exposeInMainWorld('systemStt', systemSttApi)
        contextBridge.exposeInMainWorld('overlay', overlayApi)
        contextBridge.exposeInMainWorld('translation', translationApi)
        contextBridge.exposeInMainWorld('textHighlightAPI', textHighlightApi)
        contextBridge.exposeInMainWorld('ai', aiApi)
        contextBridge.exposeInMainWorld('permissions', permissionsApi)
        contextBridge.exposeInMainWorld('notifications', notificationsApi)
        contextBridge.exposeInMainWorld('automation', automationApi)
        contextBridge.exposeInMainWorld('auth', authApi)
        contextBridge.exposeInMainWorld('storage', storageApi)
        contextBridge.exposeInMainWorld('phoneMic', phoneMicApi)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI
    // @ts-ignore (define in dts)
    window.api = api
    // @ts-ignore (define in dts)
    window.stt = sttApi
    // @ts-ignore (define in dts)
    window.models = modelApi
    // @ts-ignore (define in dts)
    window.systemAudio = systemAudioApi
    // @ts-ignore (define in dts)
    window.recorder = recorderApi
    // @ts-ignore (define in dts)
    window.transcribeFile = transcribeFileApi
    // @ts-ignore (define in dts)
    window.systemStt = systemSttApi
    // @ts-ignore (define in dts)
    window.overlay = overlayApi
    // @ts-ignore (define in dts)
    window.translation = translationApi
    // @ts-ignore (define in dts)
    window.textHighlightAPI = textHighlightApi
    // @ts-ignore (define in dts)
    window.ai = aiApi
    // @ts-ignore (define in dts)
    window.permissions = permissionsApi
    // @ts-ignore (define in dts)
    window.notifications = notificationsApi
    // @ts-ignore (define in dts)
    window.automation = automationApi
    // @ts-ignore (define in dts)
    window.auth = authApi
    // @ts-ignore (define in dts)
    window.storage = storageApi
    // @ts-ignore (define in dts)
    window.phoneMic = phoneMicApi
}
