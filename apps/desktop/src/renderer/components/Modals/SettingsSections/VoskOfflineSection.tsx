import React, { useMemo } from 'react';
import { useVoskSettings } from '../../../pages/Settings/useVoskSettings';
import { ModelInstaller } from '../../../pages/Settings/ModelInstaller';
import { CustomSelect } from './CustomSelect';
import './VoskOfflineSection.css';

interface VoskOfflineSectionProps {
  showToast: (message: string) => void;
}

export const VoskOfflineSection: React.FC<VoskOfflineSectionProps> = ({ showToast }) => {
  const [languageFilter, setLanguageFilter] = React.useState('all');
  const [isLocalSttEnabled, setIsLocalSttEnabled] = React.useState(() => {
    return localStorage.getItem('ricky:use-local-stt') === 'true';
  });

  const {
    status,
    config,
    installed,
    catalog,
    activeModelId,
    progress,
    error,
    handleConfigChange,
    handleInstall,
    handleRemove,
    handleSetActive,
  } = useVoskSettings();

  React.useEffect(() => {
    if (!window.stt) return;
    if (isLocalSttEnabled) {
      window.stt.updateConfig({ provider: 'vox' }).catch(() => undefined);
    }
  }, [isLocalSttEnabled]);

  const toggleLocalStt = async () => {
    const newValue = !isLocalSttEnabled;
    setIsLocalSttEnabled(newValue);
    localStorage.setItem('ricky:use-local-stt', String(newValue));
    showToast(`Transcrição Local ${newValue ? 'Ativada' : 'Desativada'}`);
    // Dispatch event to notify other components (like ApiSection)
    window.dispatchEvent(new Event('storage'));
    try {
      if (!window.stt) return;
      if (newValue) {
        const current = await window.stt.getConfig();
        if (current?.provider && current.provider !== 'vox' && current.provider !== 'vosk') {
          localStorage.setItem('ricky:live-stt-provider', current.provider);
        }
        await window.stt.updateConfig({ provider: 'vox' });
      } else {
        let nextProvider: string | null = null;
        try {
          const aiConfig = await window.ai?.getConfig?.();
          if (aiConfig?.providerId === 'gemini') {
            nextProvider = 'gemini_live';
          } else if (aiConfig?.providerId === 'openai') {
            nextProvider = 'openai_realtime_transcribe';
          } else if (aiConfig?.providerId === 'openai-codex') {
            // ChatGPT login: Codex transcription needs no API key.
            nextProvider = 'codex_transcribe';
          }
        } catch {
          nextProvider = null;
        }

        if (!nextProvider) {
          nextProvider = localStorage.getItem('ricky:live-stt-provider');
        }

        if (nextProvider) {
          await window.stt.updateConfig({ provider: nextProvider as any });
          localStorage.setItem('ricky:live-stt-provider', nextProvider);
        }
      }
    } catch {
      // ignore stt config errors
    }
  };

  const activeModel = installed.find((m) => m.id === activeModelId);

  const languageOptions = useMemo(() => {
    const languages = new Set(catalog.map((model) => model.language));
    return Array.from(languages);
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    if (languageFilter === 'all') return catalog;
    return catalog.filter((model) => model.language === languageFilter);
  }, [catalog, languageFilter]);

  const installedModelLabels = installed.map(m => m.label);

  return (
    <div className="vosk-offline-content">
      {/* Master Toggle */}
      <div className={`vosk-master-toggle ${isLocalSttEnabled ? 'active' : ''}`} onClick={toggleLocalStt}>
        <div className="toggle-main-info">
          <div className="toggle-icon-circle">
            {isLocalSttEnabled ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
            )}
          </div>
          <div className="toggle-text">
            <h3>{isLocalSttEnabled ? 'Transcrição Offline Ativada' : 'Transcrição Offline Desativada'}</h3>
            <p>{isLocalSttEnabled ? 'O sistema usará modelos locais para maior privacidade e velocidade.' : 'Ative para usar o motor Vosk sem depender de internet.'}</p>
          </div>
        </div>
        <div className="toggle-switch-ui">
          <div className={`switch-knob ${isLocalSttEnabled ? 'on' : 'off'}`}></div>
        </div>
      </div>

      {error && <div className="vosk-error-banner">{error}</div>}
      {status.state === 'error' && status.message && (
        <div className="vosk-error-banner">{status.message}</div>
      )}

      {/* Modelo Ativo */}
      <div className={`vosk-subsection ${!isLocalSttEnabled ? 'disabled-section' : ''}`}>
        <label className="vosk-label">Modelo de Transcrição Local</label>
        <div className="vosk-select-row">
          <CustomSelect
            options={installedModelLabels.length > 0 ? installedModelLabels : ['Nenhum modelo instalado']}
            value={activeModel?.label || 'Selecione um modelo'}
            onChange={(label) => {
              if (!isLocalSttEnabled) return;
              const model = installed.find(m => m.label === label);
              if (model) {
                handleSetActive(model.id);
                showToast(`Modelo ativo alterado para ${label}`);
              }
            }}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>}
          />
        </div>
      </div>

      {/* Catálogo */}
      <div className={`vosk-subsection ${!isLocalSttEnabled ? 'disabled-section' : ''}`}>
        <h4>Catálogo de Idiomas</h4>
        <div className="vosk-filter-row">
          <label className="vosk-filter-label">
            <span>Filtrar Idioma</span>
            <select
              className="vosk-select-small"
              value={languageFilter}
              disabled={!isLocalSttEnabled}
              onChange={(e) => setLanguageFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              {languageOptions.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ModelInstaller
          catalog={filteredCatalog}
          installed={installed}
          activeModelId={activeModelId}
          progress={progress}
          onInstall={(id) => isLocalSttEnabled && handleInstall(id)}
          onRemove={(id) => isLocalSttEnabled && handleRemove(id)}
          onSetActive={(id) => isLocalSttEnabled && handleSetActive(id)}
        />
      </div>

      {/* Configurações Avançadas */}
      <div className={`vosk-subsection ${!isLocalSttEnabled ? 'disabled-section' : ''}`}>
        <h4>Configurações Avançadas</h4>
        <div className="vosk-advanced-grid">
          <label className="vosk-advanced-label">
            <span>Partial (parcial)</span>
            <input
              type="checkbox"
              disabled={!isLocalSttEnabled}
              checked={config?.enablePartial ?? true}
              onChange={(e) => handleConfigChange({ enablePartial: e.target.checked })}
            />
          </label>
          <label className="vosk-advanced-label">
            <span>Debounce parcial (ms)</span>
            <input
              type="number"
              disabled={!isLocalSttEnabled}
              className="vosk-input-number"
              value={config?.partialDebounceMs ?? 200}
              onChange={(e) =>
                handleConfigChange({ partialDebounceMs: Number(e.target.value || 0) })
              }
            />
          </label>
          <label className="vosk-advanced-label">
            <span>Segmento max (s)</span>
            <input
              type="number"
              disabled={!isLocalSttEnabled}
              className="vosk-input-number"
              value={config?.maxSegmentSeconds ?? 15}
              onChange={(e) =>
                handleConfigChange({ maxSegmentSeconds: Number(e.target.value || 1) })
              }
            />
          </label>
          <label className="vosk-advanced-label">
            <span>Sample rate</span>
            <input
              type="number"
              disabled={!isLocalSttEnabled}
              className="vosk-input-number"
              value={config?.sampleRate ?? 16000}
              onChange={(e) =>
                handleConfigChange({ sampleRate: Number(e.target.value || 16000) })
              }
            />
          </label>
        </div>
        {languageOptions.length > 0 && (
          <div className="vosk-hint">
            Modelos recomendados: {languageOptions.join(' / ')}
          </div>
        )}
      </div>
    </div>
  );
};
