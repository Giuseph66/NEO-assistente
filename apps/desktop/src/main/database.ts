import Database from 'better-sqlite3';
import { join } from 'path';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';
import {
  Note,
  TranscriptionSession,
  TranscriptionSegment,
  Screenshot,
  RecordingEntry,
  AIProvider,
  AIModel,
  AIApiKey,
  AIRun,
  PromptTemplate,
} from '@neo/shared';
import { Migrator } from './database/migrator';

export interface AISessionRecord {
  id: number;
  screenshotId: number | null;
  providerId: string;
  modelName: string;
  summary?: string | null;
  /** Conversation subject (derived from the first user message, renamable). */
  title?: string | null;
  createdAt: number;
}

/** A row of `ai_messages`. Provider/model/timing are set on assistant answers. */
export interface AIMessageRow {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  recognized_text?: string | null;
  created_at: number;
  provider_id?: string | null;
  model_name?: string | null;
  duration_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
}

export type NewAIMessage = Omit<AIMessageRow, 'id' | 'created_at'>;

export interface NewAIRun {
  session_id: number;
  provider_id: string;
  model_name: string;
  api_key_id?: number | null;
  status: 'success' | 'error';
  duration_ms?: number | null;
  error_code?: string | null;
  error_message_redacted?: string | null;
}

/** A row of `ai_runs` (one model call), as returned by `getLastAIRun`. */
export interface AIRunRow {
  id: number;
  session_id: number;
  provider_id: string;
  model_name: string;
  status: 'success' | 'error';
  duration_ms: number | null;
  error_code: string | null;
  error_message_redacted: string | null;
  created_at: number;
}

/**
 * Gerenciador de banco de dados SQLite com migrations
 */
export class DatabaseManager {
  private db: Database.Database;
  private migrator: Migrator;

  constructor() {
    const dbPath = join(app.getPath('userData'), 'ricky.db');
    this.db = new Database(dbPath);
    // Em dev, usa o diretório fonte para evitar depender do build do main
    const migrationsDir = is.dev
      ? join(process.cwd(), 'src', 'main', 'database', 'migrations')
      : join(__dirname, 'database', 'migrations');
    this.migrator = new Migrator(this.db, migrationsDir);
    this.init();
  }

  /**
   * Inicializa o banco de dados e executa migrations
   */
  private init(): void {
    try {
      this.migrator.migrate();
    } catch (error) {
      console.error('Failed to migrate database:', error);
      throw error;
    }
  }

  /**
   * Obtém notas recentes
   */
  getNotes(limit: number = 10): Note[] {
    return this.db
      .prepare('SELECT * FROM notes ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Note[];
  }

  /**
   * Salva uma nova nota
   */
  saveNote(content: string, panelType: string = 'notes'): number {
    const now = Date.now();
    const result = this.db
      .prepare(
        `
      INSERT INTO notes (content, created_at, updated_at, panel_type)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(content, now, now, panelType);
    return result.lastInsertRowid as number;
  }

  /**
   * Atualiza uma nota existente
   */
  updateNote(id: number, content: string): void {
    this.db
      .prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, Date.now(), id);
  }

  /**
   * Deleta uma nota
   */
  deleteNote(id: number): void {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  }

  /**
   * Cria uma nova sessão de transcrição
   */
  createTranscriptionSession(language: 'en' | 'pt' = 'en'): number {
    const result = this.db
      .prepare(
        'INSERT INTO transcription_sessions (started_at, language) VALUES (?, ?)'
      )
      .run(Date.now(), language);
    return result.lastInsertRowid as number;
  }

  /**
   * Finaliza uma sessão de transcrição
   */
  endTranscriptionSession(sessionId: number): void {
    this.db
      .prepare('UPDATE transcription_sessions SET ended_at = ? WHERE id = ?')
      .run(Date.now(), sessionId);
  }

  /**
   * Adiciona um segmento de transcrição
   */
  addTranscriptionSegment(
    sessionId: number,
    text: string,
    confidence: number,
    translatedText?: string
  ): number {
    const result = this.db
      .prepare(
        `
      INSERT INTO transcription_segments 
      (session_id, text, translated_text, confidence, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(sessionId, text, translatedText || null, confidence, Date.now());

    // Atualiza contador de segmentos na sessão
    this.db
      .prepare(
        'UPDATE transcription_sessions SET total_segments = total_segments + 1 WHERE id = ?'
      )
      .run(sessionId);

    return result.lastInsertRowid as number;
  }

  /**
   * Obtém sessões de transcrição
   */
  getTranscriptionSessions(limit: number = 10): TranscriptionSession[] {
    return this.db
      .prepare(
        'SELECT * FROM transcription_sessions ORDER BY started_at DESC LIMIT ?'
      )
      .all(limit) as TranscriptionSession[];
  }

  /**
   * Obtém segmentos de uma sessão
   */
  getSessionSegments(sessionId: number): TranscriptionSegment[] {
    return this.db
      .prepare(
        'SELECT * FROM transcription_segments WHERE session_id = ? ORDER BY timestamp'
      )
      .all(sessionId) as TranscriptionSegment[];
  }

  /**
   * Salva uma captura de tela
   */
  saveScreenshot(screenshot: Omit<Screenshot, 'id'>): number {
    const result = this.db
      .prepare(
        `
      INSERT INTO screenshots 
      (file_path, file_size, width, height, mode, source_app, monitor_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        screenshot.file_path,
        screenshot.file_size,
        screenshot.width,
        screenshot.height,
        screenshot.mode,
        screenshot.source_app || null,
        screenshot.monitor_index || null,
        screenshot.created_at
      );
    return result.lastInsertRowid as number;
  }

  /**
   * Obtém screenshots recentes
   */
  getScreenshots(limit: number = 20): Screenshot[] {
    return this.db
      .prepare('SELECT * FROM screenshots ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Screenshot[];
  }

  /**
   * Obtém um screenshot por ID
   */
  getScreenshotById(id: number): Screenshot | null {
    const row = this.db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id);
    return (row as Screenshot) || null;
  }

  /**
   * Deleta um screenshot
   */
  deleteScreenshot(id: number): void {
    this.db.prepare('DELETE FROM screenshots WHERE id = ?').run(id);
  }

  /**
   * Salva metadata de gravacao de audio
   */
  saveRecording(entry: Omit<RecordingEntry, 'id'>): number {
    const result = this.db
      .prepare(
        `
        INSERT INTO recordings
        (path, source_type, source_id, created_at, sample_rate, channels, bytes, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        entry.path,
        entry.sourceType,
        entry.sourceId || null,
        entry.createdAt,
        entry.sampleRate,
        entry.channels,
        entry.bytes,
        entry.durationMs ?? null
      );
    return result.lastInsertRowid as number;
  }

  /**
   * Lista gravacoes recentes
   */
  listRecordings(limit: number = 20, sourceType?: string): RecordingEntry[] {
    const rows = sourceType
      ? this.db
        .prepare(
          'SELECT * FROM recordings WHERE source_type = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(sourceType, limit)
      : this.db
        .prepare('SELECT * FROM recordings ORDER BY created_at DESC LIMIT ?')
        .all(limit);
    return rows.map((row: any) => ({
      id: row.id,
      path: row.path,
      sourceType: row.source_type,
      sourceId: row.source_id,
      createdAt: row.created_at,
      sampleRate: row.sample_rate,
      channels: row.channels,
      bytes: row.bytes,
      durationMs: row.duration_ms,
    })) as RecordingEntry[];
  }

  /**
   * Busca gravacao por caminho
   */
  getRecordingByPath(path: string): RecordingEntry | null {
    const row = this.db
      .prepare('SELECT * FROM recordings WHERE path = ? LIMIT 1')
      .get(path);
    if (!row) return null;
    const record = row as any;
    return {
      id: record.id,
      path: record.path,
      sourceType: record.source_type,
      sourceId: record.source_id,
      createdAt: record.created_at,
      sampleRate: record.sample_rate,
      channels: record.channels,
      bytes: record.bytes,
      durationMs: record.duration_ms,
    } as RecordingEntry;
  }

  /**
   * Deleta gravacao e referencias
   */
  deleteRecording(id: number): void {
    this.db.prepare('DELETE FROM recording_subtitles WHERE recording_id = ?').run(id);
    this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  }

  /**
   * Salva caminhos de legendas para uma gravacao
   */
  saveRecordingSubtitles(
    recordingId: number,
    vttPath: string | null,
    srtPath: string | null,
    language?: string
  ): void {
    this.db
      .prepare(
        `
        INSERT INTO recording_subtitles
        (recording_id, vtt_path, srt_path, created_at, language)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(recordingId, vttPath, srtPath, Date.now(), language || null);
  }

  /**
   * Obtém legendas associadas a uma gravacao
   */
  getRecordingSubtitles(recordingId: number): { vtt_path?: string; srt_path?: string } | null {
    const row = this.db
      .prepare(
        'SELECT vtt_path, srt_path FROM recording_subtitles WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(recordingId);
    if (!row) return null;
    return row as { vtt_path?: string; srt_path?: string };
  }

  /**
   * Registra um evento do sistema
   */
  logSystemEvent(eventType: string, payload?: any): void {
    this.db
      .prepare(
        'INSERT INTO system_events (event_type, payload, created_at) VALUES (?, ?, ?)'
      )
      .run(eventType, payload ? JSON.stringify(payload) : null, Date.now());
  }

  // ========== AI Provider Methods ==========

  /**
   * Salva ou atualiza um provider de IA
   */
  saveAIProvider(provider: Omit<AIProvider, 'created_at' | 'updated_at'>): void {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT id FROM ai_providers WHERE id = ?')
      .get(provider.id);

    if (existing) {
      this.db
        .prepare('UPDATE ai_providers SET display_name = ?, base_url = ?, updated_at = ? WHERE id = ?')
        .run(provider.display_name, provider.base_url || null, now, provider.id);
    } else {
      this.db
        .prepare('INSERT INTO ai_providers (id, display_name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(provider.id, provider.display_name, provider.base_url || null, now, now);
    }
  }

  /**
   * Lista todos os providers
   */
  getAIProviders(): AIProvider[] {
    return this.db.prepare('SELECT * FROM ai_providers ORDER BY display_name').all() as AIProvider[];
  }

  /**
   * Salva ou atualiza um modelo de IA
   */
  saveAIModel(model: Omit<AIModel, 'id' | 'created_at'>): number {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT id FROM ai_models WHERE provider_id = ? AND model_name = ?')
      .get(model.provider_id, model.model_name);

    if (existing) {
      this.db
        .prepare('UPDATE ai_models SET enabled = ?, metadata_json = ? WHERE provider_id = ? AND model_name = ?')
        .run(model.enabled, model.metadata_json || null, model.provider_id, model.model_name);
      return (existing as any).id;
    } else {
      const result = this.db
        .prepare('INSERT INTO ai_models (provider_id, model_name, enabled, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(model.provider_id, model.model_name, model.enabled, model.metadata_json || null, now);
      return result.lastInsertRowid as number;
    }
  }

  /**
   * Lista modelos de um provider
   */
  getAIModels(providerId: string): AIModel[] {
    return this.db
      .prepare('SELECT * FROM ai_models WHERE provider_id = ? ORDER BY model_name')
      .all(providerId) as AIModel[];
  }

  // ========== API Keys Methods ==========

  /**
   * Salva uma API key (criptografada)
   */
  saveAIApiKey(key: Omit<AIApiKey, 'id' | 'created_at' | 'updated_at'>): number {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO ai_api_keys 
        (provider_id, alias, encrypted_key, last4, status, cooldown_until, success_count, failure_count, last_error_code, last_used_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        key.provider_id,
        key.alias,
        key.encrypted_key,
        key.last4,
        key.status,
        key.cooldown_until || null,
        key.success_count,
        key.failure_count,
        key.last_error_code || null,
        key.last_used_at || null,
        now,
        now
      );
    return result.lastInsertRowid as number;
  }

  /**
   * Atualiza uma API key
   */
  updateAIApiKey(id: number, updates: Partial<Omit<AIApiKey, 'id' | 'created_at'>>): void {
    const now = Date.now();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.cooldown_until !== undefined) {
      fields.push('cooldown_until = ?');
      values.push(updates.cooldown_until || null);
    }
    if (updates.success_count !== undefined) {
      fields.push('success_count = ?');
      values.push(updates.success_count);
    }
    if (updates.failure_count !== undefined) {
      fields.push('failure_count = ?');
      values.push(updates.failure_count);
    }
    if (updates.last_error_code !== undefined) {
      fields.push('last_error_code = ?');
      values.push(updates.last_error_code || null);
    }
    if (updates.last_used_at !== undefined) {
      fields.push('last_used_at = ?');
      values.push(updates.last_used_at || null);
    }
    if (updates.alias !== undefined) {
      fields.push('alias = ?');
      values.push(updates.alias);
    }
    if (updates.encrypted_key !== undefined) {
      fields.push('encrypted_key = ?');
      values.push(updates.encrypted_key);
    }
    if (updates.last4 !== undefined) {
      fields.push('last4 = ?');
      values.push(updates.last4);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db
      .prepare(`UPDATE ai_api_keys SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  /**
   * Lista API keys de um provider
   */
  getAIApiKeys(providerId: string): AIApiKey[] {
    return this.db
      .prepare('SELECT * FROM ai_api_keys WHERE provider_id = ? ORDER BY created_at DESC')
      .all(providerId) as AIApiKey[];
  }

  /**
   * Obtém uma API key por ID
   */
  getAIApiKeyById(id: number): AIApiKey | null {
    const row = this.db.prepare('SELECT * FROM ai_api_keys WHERE id = ?').get(id);
    return (row as AIApiKey) || null;
  }

  /**
   * Remove uma API key
   */
  deleteAIApiKey(id: number): void {
    this.db.prepare('DELETE FROM ai_api_keys WHERE id = ?').run(id);
  }

  // ========== AI Session Methods ==========

  /**
   * Cria uma nova sessão de análise
   */
  saveAISession(session: Omit<AISessionRecord, 'id' | 'createdAt'>): number {
    const result = this.db
      .prepare('INSERT INTO ai_sessions (screenshot_id, provider_id, model_name, summary, title, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        session.screenshotId ?? null,
        session.providerId,
        session.modelName,
        session.summary ?? null,
        session.title ?? null,
        Date.now()
      );
    return result.lastInsertRowid as number;
  }

  /** Sets the conversation title (empty clears it). */
  updateAISessionTitle(id: number, title: string | null): void {
    this.db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(title?.trim() || null, id);
  }

  /** Sets the title only if the conversation has none yet (auto-title from the first message). */
  setAISessionTitleIfEmpty(id: number, title: string): void {
    this.db.prepare("UPDATE ai_sessions SET title = ? WHERE id = ? AND (title IS NULL OR title = '')").run(title, id);
  }

  /** The most recent model call of a conversation (used to show a failure the panel missed). */
  getLastAIRun(sessionId: number): AIRunRow | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, provider_id, model_name, status, duration_ms, error_code, error_message_redacted, created_at
         FROM ai_runs WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(sessionId);
    return (row as AIRunRow | undefined) ?? null;
  }

  /**
   * Obtém sessões de um screenshot
   */
  getAISessions(screenshotId: number): AISessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM ai_sessions WHERE screenshot_id = ? ORDER BY created_at DESC')
      .all(screenshotId);
    return (rows as any[]).map((s) => ({
      id: s.id,
      screenshotId: s.screenshot_id,
      providerId: s.provider_id,
      modelName: s.model_name,
      summary: s.summary,
      title: s.title,
      createdAt: s.created_at,
    }));
  }

  /**
   * Obtém sessões por data (timestamp start/end)
   */
  getAISessionsByDate(start: number, end: number, searchQuery?: string): AISessionRecord[] {
    let rows;
    if (searchQuery) {
      const search = `%${searchQuery}%`;
      rows = this.db
        .prepare(`
          SELECT DISTINCT s.* FROM ai_sessions s
          LEFT JOIN ai_messages m ON m.session_id = s.id
          WHERE (s.created_at >= ? AND s.created_at <= ?)
          AND (
            s.summary LIKE ? OR 
            s.title LIKE ? OR 
            s.model_name LIKE ? OR 
            s.provider_id LIKE ? OR 
            m.content LIKE ? OR
            m.recognized_text LIKE ?
          )
          ORDER BY s.created_at DESC
        `)
        .all(start, end, search, search, search, search, search, search);
    } else {
      rows = this.db
        .prepare('SELECT * FROM ai_sessions WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC')
        .all(start, end);
    }

    return (rows as any[]).map((s) => ({
      id: s.id,
      screenshotId: s.screenshot_id,
      providerId: s.provider_id,
      modelName: s.model_name,
      summary: s.summary,
      title: s.title,
      createdAt: s.created_at,
    }));
  }

  /**
   * Obtém uma sessão por ID
   */
  getAISessionById(id: number): AISessionRecord | null {
    const row = this.db.prepare('SELECT * FROM ai_sessions WHERE id = ?').get(id);
    if (!row) return null;
    const s = row as any;
    return {
      id: s.id,
      screenshotId: s.screenshot_id,
      providerId: s.provider_id,
      modelName: s.model_name,
      summary: s.summary,
      title: s.title,
      createdAt: s.created_at
    } as AISessionRecord;
  }

  /**
   * Atualiza o resumo de uma sessão
   */
  updateAISessionSummary(id: number, summary: string): void {
    this.db.prepare('UPDATE ai_sessions SET summary = ? WHERE id = ?').run(summary, id);
  }

  /**
   * Deleta uma sessão e suas mensagens
   */
  deleteAISession(id: number): void {
    const deleteMessages = this.db.prepare('DELETE FROM ai_messages WHERE session_id = ?');
    const deleteRuns = this.db.prepare('DELETE FROM ai_runs WHERE session_id = ?');
    const deleteSession = this.db.prepare('DELETE FROM ai_sessions WHERE id = ?');

    // Executa em transação para garantir integridade
    this.db.transaction(() => {
      deleteMessages.run(id);
      deleteRuns.run(id);
      deleteSession.run(id);
    })();
  }

  // ========== AI Message Methods ==========

  /**
   * Salva uma mensagem de chat
   */
  saveAIMessage(message: NewAIMessage): number {
    const result = this.db
      .prepare(
        `INSERT INTO ai_messages
         (session_id, role, content, recognized_text, provider_id, model_name, duration_ms, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.session_id,
        message.role,
        message.content,
        message.recognized_text || null,
        message.provider_id ?? null,
        message.model_name ?? null,
        message.duration_ms ?? null,
        message.tokens_in ?? null,
        message.tokens_out ?? null,
        Date.now()
      );
    return result.lastInsertRowid as number;
  }

  /**
   * Obtém mensagens de uma sessão
   */
  getAIMessages(sessionId: number): AIMessageRow[] {
    return this.db
      .prepare('SELECT * FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
      .all(sessionId) as AIMessageRow[];
  }

  // ========== AI Run Methods ==========

  /**
   * Salva um registro de execução (run)
   */
  saveAIRun(run: NewAIRun): number {
    const result = this.db
      .prepare(
        `INSERT INTO ai_runs 
        (session_id, provider_id, model_name, api_key_id, status, duration_ms, error_code, error_message_redacted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.session_id,
        run.provider_id,
        run.model_name,
        run.api_key_id || null,
        run.status,
        run.duration_ms || null,
        run.error_code || null,
        run.error_message_redacted || null,
        Date.now()
      );
    return result.lastInsertRowid as number;
  }

  /**
   * Obtém runs de uma sessão
   */
  getAIRuns(sessionId: number): AIRun[] {
    return this.db
      .prepare('SELECT * FROM ai_runs WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as AIRun[];
  }

  // ========== Prompt Template Methods ==========

  /**
   * Salva um template de prompt
   */
  savePromptTemplate(template: Omit<PromptTemplate, 'id' | 'created_at' | 'updated_at'>): number {
    const now = Date.now();
    const result = this.db
      .prepare('INSERT INTO ai_prompt_templates (name, prompt_text, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(template.name, template.prompt_text, template.category || null, now, now);
    return result.lastInsertRowid as number;
  }

  /**
   * Atualiza um template de prompt
   */
  updatePromptTemplate(id: number, updates: Partial<Omit<PromptTemplate, 'id' | 'created_at'>>): void {
    const now = Date.now();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.prompt_text !== undefined) {
      fields.push('prompt_text = ?');
      values.push(updates.prompt_text);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category || null);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db
      .prepare(`UPDATE ai_prompt_templates SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  /**
   * Lista todos os templates
   */
  getPromptTemplates(category?: string): PromptTemplate[] {
    if (category) {
      return this.db
        .prepare('SELECT * FROM ai_prompt_templates WHERE category = ? ORDER BY name')
        .all(category) as PromptTemplate[];
    }
    return this.db
      .prepare('SELECT * FROM ai_prompt_templates ORDER BY name')
      .all() as PromptTemplate[];
  }

  /**
   * Remove um template
   */
  deletePromptTemplate(id: number): void {
    this.db.prepare('DELETE FROM ai_prompt_templates WHERE id = ?').run(id);
  }

  /**
   * Fecha a conexão com o banco
   */
  close(): void {
    this.db.close();
  }
}
