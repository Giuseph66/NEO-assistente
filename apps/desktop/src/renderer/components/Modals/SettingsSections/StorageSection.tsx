import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AudioSamplePlayer } from './AudioSamplePlayer';
import { AudioVisualizer } from '../../Panels/AudioVisualizer';

// --- Icons (Lucide-inspired SVGs) ---

const MicIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
    </svg>
);

const CameraIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>
    </svg>
);

const FileTextIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>
    </svg>
);

const DatabaseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>
    </svg>
);

const CpuIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" x2="9" y1="1" y2="4"/><line x1="15" x2="15" y1="1" y2="4"/><line x1="9" x2="9" y1="20" y2="23"/><line x1="15" x2="15" y1="20" y2="23"/><line x1="20" x2="23" y1="9" y2="9"/><line x1="20" x2="23" y1="15" y2="15"/><line x1="1" x2="4" y1="9" y2="9"/><line x1="1" x2="4" y1="15" y2="15"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>
    </svg>
);

const FolderOpenIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
    </svg>
);

const ChevronLeftIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6"/>
    </svg>
);

const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
    </svg>
);

const PlayIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const StopIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" />
    </svg>
);

interface StorageFile {
    name: string;
    path: string;
    fileUrl?: string;
    size: number;
    createdAt: number;
    extension: string;
}

interface StorageStats {
    media: {
        recordings: number;
        screenshots: number;
        subtitles: number;
    };
    automation: number;
    databases: {
        main: number;
        notifications: number;
    };
    models: number;
    logs: number;
}

interface StorageSectionProps {
    showToast: (message: string) => void;
}

export const StorageSection: React.FC<StorageSectionProps> = ({ showToast }) => {
    const [stats, setStats] = useState<StorageStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'files' | 'db' | 'models'>('files');
    const [detailType, setDetailType] = useState<string | null>(null);
    const [fileList, setFileList] = useState<StorageFile[]>([]);
    const [listingFiles, setListingFiles] = useState(false);
    const [playingFile, setPlayingFile] = useState<string | null>(null);

    const fetchStats = async () => {
        try {
            const data = await (window as any).storage.getStats();
            setStats(data);
        } catch (err) {
            console.error('Failed to fetch storage stats:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, []);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleString();
    };

    const handleClearCache = async () => {
        await (window as any).storage.clearCache();
        showToast('Cache limpo com sucesso!');
    };

    const handleDeleteContents = async (type: string, label: string) => {
        if (confirm(`Tem certeza que deseja apagar todos os arquivos de ${label}? Esta ação não pode ser desfeita.`)) {
            const success = await (window as any).storage.deleteFolderContents(type);
            if (success) {
                showToast(`${label} limpo com sucesso!`);
                fetchStats();
                if (detailType === type) fetchFiles(type);
            }
        }
    };

    const handleDeleteSingleFile = async (file: StorageFile) => {
        const success = await (window as any).storage.deleteFile(file.path);
        if (success) {
            showToast('Arquivo removido.');
            fetchFiles(detailType!);
            fetchStats();
        } else {
            showToast('Erro ao remover arquivo.');
        }
    };

    const fetchFiles = async (type: string) => {
        setListingFiles(true);
        try {
            const files = await (window as any).storage.listFiles(type);
            setFileList(files);
        } catch (err) {
            console.error(`Failed to list files for ${type}:`, err);
        } finally {
            setListingFiles(false);
        }
    };

    const openDetail = (type: string) => {
        setDetailType(type);
        fetchFiles(type);
    };

    const closeDetail = () => {
        setDetailType(null);
        setFileList([]);
    };

    const openFolder = (type: string) => {
        (window as any).storage.openFolder(type);
    };

    if (loading) {
        return (
            <div className="settings-content-inner premium-storage">
                <div className="loading-container">
                    <div className="premium-spinner"></div>
                    <span>Analisando armazenamento...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="settings-content-inner premium-storage">
            {detailType ? (
                <div className="storage-detail-view anim-fade-in">
                    <div className="detail-header">
                        <button className="back-btn" onClick={closeDetail}>
                            <ChevronLeftIcon />
                            <span>Voltar</span>
                        </button>
                        <div className="detail-title-group">
                            <h3>Gestão de {detailType.charAt(0).toUpperCase() + detailType.slice(1)}</h3>
                            <p>{fileList.length} arquivos encontrados</p>
                        </div>
                        <div className="detail-header-actions">
                            <button className="btn-action-outline" onClick={() => openFolder(detailType)}>
                                <FolderOpenIcon /> Abrir Pasta
                            </button>
                            <button className="btn-action-outline danger" onClick={() => handleDeleteContents(detailType, detailType)}>
                                <TrashIcon /> Limpar Tudo
                            </button>
                        </div>
                    </div>

                    <div className="file-list-container">
                        {listingFiles ? (
                            <div className="list-loading">Carregando lista...</div>
                        ) : (
                            <table className="premium-file-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '45%' }}>Nome</th>
                                        <th style={{ width: '25%' }}>Data</th>
                                        <th style={{ width: '15%' }}>Tamanho</th>
                                        <th style={{ width: '15%', textAlign: 'right' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                        {fileList.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="empty-row">Nenhum arquivo nesta categoria.</td>
                                        </tr>
                                    ) : (
                                        fileList.map((file, idx) => (
                                            <React.Fragment key={idx}>
                                                <tr className={`file-row ${playingFile === file.path ? 'highlight' : ''}`}>
                                                    <td className="col-name" title={file.path}>
                                                    <span className="file-ext">{file.extension.replace('.', '')}</span>
                                                    <span className="file-name-text">{file.name}</span>
                                                </td>
                                                <td className="col-date">{formatDate(file.createdAt)}</td>
                                                <td className="col-size">{formatSize(file.size)}</td>
                                                <td className="col-actions">
                                                    <button 
                                                        className={`row-action-btn ${playingFile === file.path ? 'active' : ''}`}
                                                        onClick={() => setPlayingFile(playingFile === file.path ? null : file.path)}
                                                        title="Ouvir gravação"
                                                    >
                                                        {playingFile === file.path ? <StopIcon /> : <PlayIcon />}
                                                    </button>
                                                    <button 
                                                        className="row-delete-btn" 
                                                        onClick={() => handleDeleteSingleFile(file)}
                                                        title="Excluir arquivo"
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </td>
                                            </tr>
                                            {playingFile === file.path && file.fileUrl && (
                                                <tr className="player-row anim-fade-in">
                                                    <td colSpan={4}>
                                                        <div className="inline-player-container premium-glass">
                                                            <PremiumAudioPlayer 
                                                                src={file.fileUrl} 
                                                                name={file.name} 
                                                                onClose={() => setPlayingFile(null)}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        ) : (
                <>
                    <div className="content-header">
                        <h3>Armazenamento Premium</h3>
                        <p className="header-desc">Visão detalhada e gestão granular de dados locais.</p>
                    </div>

                    <div className="storage-tabs-premium">
                        <button 
                            className={`storage-tab-btn-p ${activeTab === 'files' ? 'active' : ''}`}
                            onClick={() => setActiveTab('files')}
                        >
                            Arquivos & Mídia
                        </button>
                        <button 
                            className={`storage-tab-btn-p ${activeTab === 'db' ? 'active' : ''}`}
                            onClick={() => setActiveTab('db')}
                        >
                            Bancos & Logs
                        </button>
                        <button 
                            className={`storage-tab-btn-p ${activeTab === 'models' ? 'active' : ''}`}
                            onClick={() => setActiveTab('models')}
                        >
                            IA & Modelos
                        </button>
                    </div>

                    <div className="settings-body-premium anim-fade-in" key={activeTab}>
                        {activeTab === 'files' && (
                            <div className="storage-cards-grid">
                                <CategoryCard 
                                    title="Gravações" 
                                    size={stats?.media.recordings || 0} 
                                    icon={<MicIcon />} 
                                    color="blue"
                                    onClick={() => openDetail('recordings')}
                                />
                                <CategoryCard 
                                    title="Screenshots" 
                                    size={stats?.media.screenshots || 0} 
                                    icon={<CameraIcon />} 
                                    color="purple"
                                    onClick={() => openDetail('screenshots')}
                                />
                                <CategoryCard 
                                    title="Legendas" 
                                    size={stats?.media.subtitles || 0} 
                                    icon={<FileTextIcon />} 
                                    color="cyan"
                                    onClick={() => openDetail('subtitles')}
                                />
                                <CategoryCard 
                                    title="Templates" 
                                    size={stats?.automation || 0} 
                                    icon={<CpuIcon />} 
                                    color="orange"
                                    onClick={() => openDetail('automation')}
                                />
                            </div>
                        )}

                        {activeTab === 'db' && (
                            <div className="storage-cards-grid">
                                <div className="db-card premium-glass">
                                    <div className="card-top">
                                        <div className="icon-wrap blue"><DatabaseIcon /></div>
                                        <div className="text-wrap">
                                            <h4>Banco de Dados Central</h4>
                                            <p className="db-filename">ricky.db</p>
                                        </div>
                                        <div className="size-badge">{formatSize(stats?.databases.main || 0)}</div>
                                    </div>
                                    <div className="card-desc">Contém suas notas, histórico de chat e configurações.</div>
                                </div>
                                <div className="db-card premium-glass">
                                    <div className="card-top">
                                        <div className="icon-wrap purple"><DatabaseIcon /></div>
                                        <div className="text-wrap">
                                            <h4>Histórico de Notificações</h4>
                                            <p className="db-filename">notifications.sqlite</p>
                                        </div>
                                        <div className="size-badge">{formatSize(stats?.databases.notifications || 0)}</div>
                                    </div>
                                    <div className="card-desc">Registro de todos os alertas processados pelo sistema.</div>
                                </div>
                                <div className="db-card premium-glass">
                                    <div className="card-top">
                                        <div className="icon-wrap orange"><FileTextIcon /></div>
                                        <div className="text-wrap">
                                            <h4>Logs de Execução</h4>
                                            <p className="db-filename">{formatSize(stats?.logs || 0)}</p>
                                        </div>
                                        <button className="manage-btn" onClick={() => openDetail('logs')}>Gerenciar</button>
                                    </div>
                                    <div className="card-desc">Arquivos de depuração e rastro de processos rodando em background.</div>
                                </div>
                                <div className="cache-cleaner premium-glass">
                                    <div className="cleaner-info">
                                        <h4>Cache de Interface</h4>
                                        <p>Dados temporários, shaders e cache v8.</p>
                                    </div>
                                    <button className="clean-btn" onClick={handleClearCache}>
                                        <RefreshIcon /> Limpar Cache do App
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'models' && (
                            <div className="storage-cards-grid">
                                <div className="model-card-hero premium-glass">
                                    <div className="hero-icon"><CpuIcon /></div>
                                    <div className="hero-content">
                                        <h4>Modelos de Fala (Vosk)</h4>
                                        <div className="hero-stats">
                                            <div className="stat-item">
                                                <span className="label">Espaço Ocupado</span>
                                                <span className="value">{formatSize(stats?.models || 0)}</span>
                                            </div>
                                            <div className="stat-item">
                                                <span className="label">Localização</span>
                                                <span className="value">~/.local/share/ricky</span>
                                            </div>
                                        </div>
                                        <p className="hero-desc">Estes modelos são pacotes de dados binários baixados para permitir que o reconhecimento de voz (STT) funcione 100% offline, respeitando sua privacidade.</p>
                                        <button className="hero-action-btn" onClick={() => openFolder('models')}>
                                            <FolderOpenIcon /> Abrir pasta de modelos
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            <style>{`
                .premium-storage {
                    --bg-card: rgba(255, 255, 255, 0.05);
                    --bg-card-hover: rgba(255, 255, 255, 0.08);
                    --border-premium: rgba(255, 255, 255, 0.1);
                    --accent-blue: #3b82f6;
                    --accent-purple: #8b5cf6;
                    --accent-orange: #f59e0b;
                    --accent-cyan: #06b6d4;
                }

                .loading-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 80px 0;
                    gap: 15px;
                    color: rgba(255,255,255,0.5);
                }

                .premium-spinner {
                    width: 32px;
                    height: 32px;
                    border: 3px solid rgba(255,255,255,0.1);
                    border-top-color: var(--accent-blue);
                    border-radius: 50%;
                    animation: spin 1s infinite linear;
                }

                @keyframes spin { to { transform: rotate(360deg); } }

                .storage-tabs-premium {
                    display: flex;
                    gap: 8px;
                    padding: 0 24px;
                    margin-bottom: 24px;
                }

                .storage-tab-btn-p {
                    padding: 10px 20px;
                    border-radius: 12px;
                    background: transparent;
                    border: 1px solid var(--border-premium);
                    color: rgba(255,255,255,0.5);
                    cursor: pointer;
                    font-weight: 500;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    font-size: 13px;
                }

                .storage-tab-btn-p:hover {
                    background: rgba(255,255,255,0.03);
                    color: rgba(255,255,255,0.8);
                }

                .storage-tab-btn-p.active {
                    background: var(--accent-blue);
                    color: white;
                    border-color: var(--accent-blue);
                    box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
                }

                .storage-cards-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    padding: 0 24px 24px;
                }

                .premium-glass {
                    background: var(--bg-card);
                    border: 1px solid var(--border-premium);
                    border-radius: 16px;
                    backdrop-filter: blur(10px);
                    transition: transform 0.3s, background 0.3s, border-color 0.3s;
                }

                .cat-card {
                    padding: 24px;
                    cursor: pointer;
                }

                .cat-card:hover {
                    background: var(--bg-card-hover);
                    border-color: rgba(255,255,255,0.2);
                    transform: translateY(-2px);
                }

                .cat-card .card-content {
                    display: flex;
                    align-items: center;
                    gap: 18px;
                }

                .icon-box {
                    width: 48px;
                    height: 48px;
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .icon-box.blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
                .icon-box.purple { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
                .icon-box.cyan { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
                .icon-box.orange { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

                .card-meta h4 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 500;
                    color: rgba(255,255,255,0.6);
                }

                .card-meta .size-text {
                    margin: 4px 0 0;
                    font-size: 22px;
                    font-weight: 700;
                    color: white;
                }

                /* DB CARD */
                .db-card {
                    padding: 20px;
                    grid-column: span 2;
                }

                .card-top {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }

                .icon-wrap {
                    width: 36px;
                    height: 36px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .icon-wrap.blue { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
                .icon-wrap.purple { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; }
                .icon-wrap.orange { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }

                .text-wrap h4 { margin: 0; font-size: 15px; font-weight: 600; }
                .db-filename { margin: 2px 0 0; font-size: 12px; color: rgba(255,255,255,0.4); font-family: monospace; }
                
                .size-badge {
                    margin-left: auto;
                    padding: 4px 10px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--accent-blue);
                }

                .card-desc {
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid rgba(255,255,255,0.05);
                    font-size: 13px;
                    color: rgba(255,255,255,0.5);
                    line-height: 1.5;
                }

                .manage-btn {
                    margin-left: auto;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid var(--border-premium);
                    color: white;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 12px;
                    cursor: pointer;
                }

                .manage-btn:hover { background: rgba(255,255,255,0.1); }

                /* CACHE CLEANER */
                .cache-cleaner {
                    grid-column: span 2;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 20px;
                    background: linear-gradient(90deg, rgba(59, 130, 246, 0.05), transparent);
                }

                .cleaner-info h4 { margin: 0; font-size: 14px; }
                .cleaner-info p { margin: 4px 0 0; font-size: 12px; color: rgba(255,255,255,0.4); }

                .clean-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid var(--border-premium);
                    color: #60a5fa;
                    padding: 10px 18px;
                    border-radius: 12px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: all 0.2s;
                }
                .clean-btn:hover { background: rgba(255,255,255,0.08); color: white; border-color: #3b82f6; }

                /* MODELS HERO */
                .model-card-hero {
                    grid-column: span 2;
                    display: flex;
                    padding: 30px;
                    gap: 25px;
                }

                .hero-icon {
                    width: 80px;
                    height: 80px;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid var(--border-premium);
                    border-radius: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 40px;
                    color: var(--accent-orange);
                    flex-shrink: 0;
                }

                .hero-content h4 { margin: 0 0 15px; font-size: 18px; }
                .hero-stats { display: flex; gap: 30px; margin-bottom: 20px; }
                .stat-item { display: flex; flex-direction: column; gap: 4px; }
                .stat-item .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.4); }
                .stat-item .value { font-size: 16px; font-weight: 700; color: var(--accent-orange); }

                .hero-desc { font-size: 13px; color: rgba(255,255,255,0.4); line-height: 1.6; margin-bottom: 20px; }
                
                .hero-action-btn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(245, 158, 11, 0.1);
                    border: 1px solid rgba(245, 158, 11, 0.2);
                    color: #fbbf24;
                    padding: 12px 20px;
                    border-radius: 12px;
                    cursor: pointer;
                    font-weight: 600;
                }

                /* DETAIL VIEW */
                .storage-detail-view {
                    padding: 0 24px 24px;
                }

                .detail-header {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    margin-bottom: 24px;
                }

                .back-btn {
                    background: var(--bg-card);
                    border: 1px solid var(--border-premium);
                    border-radius: 10px;
                    padding: 8px 12px;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    color: white;
                    cursor: pointer;
                }

                .detail-title-group h3 { margin: 0; font-size: 18px; }
                .detail-title-group p { margin: 2px 0 0; font-size: 12px; color: rgba(255,255,255,0.4); }

                .detail-header-actions { margin-left: auto; display: flex; gap: 10px; }
                .btn-action-outline {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: transparent;
                    border: 1px solid var(--border-premium);
                    border-radius: 8px;
                    padding: 8px 14px;
                    color: white;
                    font-size: 13px;
                    cursor: pointer;
                }
                .btn-action-outline:hover { background: var(--bg-card); }
                .btn-action-outline.danger:hover { color: #ef4444; border-color: #ef4444; background: rgba(239, 68, 68, 0.05); }

                .file-list-container {
                    background: rgba(0,0,0,0.2);
                    border: 1px solid var(--border-premium);
                    border-radius: 16px;
                    overflow: hidden;
                }

                .premium-file-table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                }

                .premium-file-table th {
                    text-align: left;
                    padding: 12px 20px;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    background: rgba(255,255,255,0.02);
                    color: rgba(255,255,255,0.4);
                    font-weight: 600;
                    border-bottom: 1px solid var(--border-premium);
                }

                .file-row {
                    border-bottom: 1px solid rgba(255,255,255,0.03);
                    transition: background 0.2s;
                }
                .file-row:hover { background: rgba(255,255,255,0.02); }

                .file-row td { padding: 14px 20px; font-size: 13px; color: rgba(255,255,255,0.8); }

                .col-name { display: flex; align-items: center; gap: 12px; }
                .file-ext {
                    padding: 2px 6px;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid var(--border-premium);
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: var(--accent-blue);
                }
                .file-name-text {
                    max-width: 250px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .col-date { color: rgba(255,255,255,0.4); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
                .col-size { font-weight: 500; }
                .col-actions { text-align: right; white-space: nowrap; }

                .row-delete-btn {
                    background: transparent;
                    border: none;
                    color: rgba(255,255,255,0.2);
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 6px;
                    transition: all 0.2s;
                }
                .row-delete-btn:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

                .row-action-btn {
                    background: transparent;
                    border: none;
                    color: var(--accent-blue);
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 6px;
                    transition: all 0.2s;
                    margin-right: 4px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                .row-action-btn:hover { background: rgba(59, 130, 246, 0.2); transform: scale(1.1); }
                .row-action-btn.active { background: var(--accent-blue); color: white; }

                .file-row.highlight {
                    background: rgba(59, 130, 246, 0.05);
                }

                .inline-player-container {
                    padding: 0;
                    background: rgba(0,0,0,0.3);
                    border-bottom: 1px solid var(--border-premium);
                    position: relative;
                    overflow: hidden;
                }

                .premium-player-wrapper {
                    position: relative;
                    padding: 20px;
                }

                .visualizer-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 0;
                    opacity: 0.4;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    mask-image: linear-gradient(to bottom, transparent, black, transparent);
                }

                .player-controls-wrap {
                    position: relative;
                    z-index: 2;
                }

                /* Personalização do AudioSamplePlayer dentro da Storage */
                .player-controls-wrap .audio-sample-player {
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    padding: 16px;
                    border-radius: 12px;
                    backdrop-filter: blur(5px);
                }

                .empty-row { padding: 40px !important; text-align: center; color: rgba(255,255,255,0.3); font-style: italic; }

                .anim-fade-in {
                    animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .list-loading { padding: 40px; text-align: center; color: rgba(255,255,255,0.4); }
            `}</style>
        </div>
    );
};

// --- Sub-Components ---

const PremiumAudioPlayer = ({ src, name, onClose }: { src: string; name: string; onClose: () => void }) => {
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const initAudioEngine = (audioElement: HTMLAudioElement) => {
        if (audioContextRef.current) return;

        try {
            const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
            const context = new AudioContextClass();
            const analyserNode = context.createAnalyser();
            analyserNode.fftSize = 256;

            const source = context.createMediaElementSource(audioElement);
            source.connect(analyserNode);
            analyserNode.connect(context.destination);

            audioContextRef.current = context;
            sourceNodeRef.current = source;
            setAnalyser(analyserNode);
        } catch (err) {
            console.error('Failed to initialize premium audio engine:', err);
        }
    };

    const handlePlay = (audio: HTMLAudioElement) => {
        if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume();
        }
        initAudioEngine(audio);
    };

    useEffect(() => {
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(console.error);
            }
        };
    }, []);

    return (
        <div className="premium-player-wrapper">
            <div className="visualizer-overlay">
                <AudioVisualizer analyser={analyser} height={80} width={600} />
            </div>
            <div className="player-controls-wrap">
                <AudioSamplePlayer 
                    ref={audioRef}
                    src={src} 
                    label={name} 
                    onPlay={handlePlay}
                />
            </div>
        </div>
    );
};

const CategoryCard = ({ title, size, icon, color, onClick }: any) => {
    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="cat-card premium-glass" onClick={onClick}>
            <div className="card-content">
                <div className={`icon-box ${color}`}>{icon}</div>
                <div className="card-meta">
                    <h4>{title}</h4>
                    <p className="size-text">{formatSize(size)}</p>
                </div>
            </div>
        </div>
    );
};
