/**
 * Session report: what the model is asked for, how its answer is parsed, and how a
 * report is turned into text (copy/export). Pure, shared by main and renderer.
 */

export type ReportScore = {
  /** e.g. "Clareza", "Foco", "Encaminhamentos" */
  label: string;
  /** 0–10 */
  value: number;
  reason: string;
};

export type ReportAction = {
  task: string;
  owner: string | null;
  due: string | null;
};

export type SessionReport = {
  title: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ReportAction[];
  openQuestions: string[];
  scores: ReportScore[];
  /** The session had transcript/notes/chat enough to say anything (false = generic). */
  basedOn: { messages: number; transcriptLines: number; hasNotes: boolean };
  generatedAt: number;
  model?: string | null;
};

export type ReportSourceMessage = { role: 'user' | 'assistant' | 'system'; content: string; createdAt: number };
export type ReportSourceTranscript = { source: 'mic' | 'system'; text: string; spokenAt: number };

export type ReportSource = {
  sessionId: number;
  title?: string | null;
  createdAt: number;
  endedAt?: number | null;
  messages: ReportSourceMessage[];
  transcript: ReportSourceTranscript[];
  notes?: string | null;
};

/** Upper bound for the material sent to the model (the Claude CLI also caps argv/stdin sizes). */
export const REPORT_MAX_CHARS = 60_000;

/** Short on purpose: some providers pass it as a command-line argument. */
export const REPORT_SYSTEM_PROMPT =
  'Você analisa sessões de trabalho (conversa com a IA, transcrição de áudio e notas) e escreve relatórios objetivos em português do Brasil. ' +
  'Responda somente com um objeto JSON válido, sem texto antes ou depois e sem bloco de código.';

const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const SPEAKER = { mic: 'Você', system: 'Sistema' } as const;

/** Keeps the start and the end when the material is too long (the middle is summarized as cut). */
export function clampMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${text.slice(0, head)}\n[… trecho do meio omitido por tamanho …]\n${text.slice(text.length - tail)}`;
}

export function hasReportMaterial(source: ReportSource): boolean {
  return (
    source.transcript.length > 0 ||
    !!source.notes?.trim() ||
    source.messages.some((m) => m.role !== 'system' && m.content.trim())
  );
}

/** The user message given to the model: all the session material, labelled. */
export function buildReportPrompt(source: ReportSource): string {
  const parts: string[] = [];
  const started = new Date(source.createdAt).toLocaleString('pt-BR');
  const durationMin =
    source.endedAt && source.endedAt > source.createdAt
      ? Math.max(1, Math.round((source.endedAt - source.createdAt) / 60_000))
      : null;
  parts.push(
    `Sessão #${source.sessionId}${source.title ? ` — "${source.title}"` : ''}. Início: ${started}${
      durationMin ? `. Duração: ~${durationMin} min` : ''
    }.`
  );

  const transcript = source.transcript
    .map((t) => `[${clock(t.spokenAt)}] ${SPEAKER[t.source]}: ${t.text}`)
    .join('\n');
  const chat = source.messages
    .filter((m) => m.role !== 'system' && m.content.trim())
    .map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content.trim()}`)
    .join('\n\n');
  const notes = source.notes?.trim() || '';

  // Budget: transcript gets most of it, then chat, then notes.
  const budget = REPORT_MAX_CHARS;
  const notesPart = clampMiddle(notes, Math.floor(budget * 0.15));
  const chatPart = clampMiddle(chat, Math.floor(budget * 0.35));
  const transcriptPart = clampMiddle(transcript, budget - notesPart.length - chatPart.length);

  parts.push(
    transcriptPart
      ? `## Transcrição de áudio ("Você" = microfone do usuário; "Sistema" = áudio do computador, como reunião ou vídeo)\n${transcriptPart}`
      : '## Transcrição de áudio\n(nenhuma)'
  );
  parts.push(chatPart ? `## Conversa com a IA\n${chatPart}` : '## Conversa com a IA\n(nenhuma)');
  parts.push(notesPart ? `## Notas do usuário\n${notesPart}` : '## Notas do usuário\n(nenhuma)');

  parts.push(`## O que fazer
Escreva o relatório desta sessão. Use só o que está no material; não invente nomes, datas ou fatos.
Responda com este JSON (listas podem ficar vazias quando não houver nada):
{
  "titulo": "assunto da sessão em até 8 palavras",
  "resumo": "3 a 6 frases: do que se tratou e a que se chegou",
  "pontosPrincipais": ["fatos, ideias e informações mais importantes, um por item"],
  "decisoes": ["o que foi decidido ou combinado"],
  "proximosPassos": [{"tarefa": "ação concreta", "responsavel": "Você, outra pessoa citada, ou null", "prazo": "prazo citado ou null"}],
  "perguntasEmAberto": ["dúvidas ou pendências sem resposta"],
  "pontuacoes": [
    {"criterio": "Clareza", "nota": 0, "motivo": "uma frase"},
    {"criterio": "Foco", "nota": 0, "motivo": "uma frase"},
    {"criterio": "Encaminhamentos", "nota": 0, "motivo": "uma frase"}
  ]
}
As notas vão de 0 a 10: Clareza = quão bem as ideias foram expostas; Foco = quanto a sessão ficou no assunto; Encaminhamentos = quanto saiu de decisão e próximo passo.`);

  return parts.join('\n\n');
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asList = (value: unknown, max = 15): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : asText((item as any)?.texto ?? (item as any)?.text)))
        .filter(Boolean)
        .slice(0, max)
    : [];

const nullable = (value: unknown): string | null => {
  const text = asText(value);
  return text && text.toLowerCase() !== 'null' ? text : null;
};

/** Finds the JSON object in a model answer (tolerates code fences and stray text). */
export function extractJsonObject(raw: string): unknown | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseReport(
  raw: string,
  meta: { basedOn: SessionReport['basedOn']; generatedAt: number; model?: string | null }
): SessionReport {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') {
    // Not JSON: keep the answer as the overview rather than losing it.
    return {
      title: '',
      overview: raw.trim(),
      keyPoints: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
      scores: [],
      ...meta,
    };
  }

  const actionItems: ReportAction[] = Array.isArray(data.proximosPassos)
    ? (data.proximosPassos as unknown[])
        .map((item): ReportAction | null => {
          if (typeof item === 'string') return item.trim() ? { task: item.trim(), owner: null, due: null } : null;
          const obj = item as Record<string, unknown>;
          const task = asText(obj?.tarefa ?? obj?.task);
          return task ? { task, owner: nullable(obj.responsavel ?? obj.owner), due: nullable(obj.prazo ?? obj.due) } : null;
        })
        .filter((item): item is ReportAction => !!item)
        .slice(0, 15)
    : [];

  const scores: ReportScore[] = Array.isArray(data.pontuacoes)
    ? (data.pontuacoes as unknown[])
        .map((item): ReportScore | null => {
          const obj = item as Record<string, unknown>;
          const label = asText(obj?.criterio ?? obj?.label);
          const value = Number(obj?.nota ?? obj?.value);
          if (!label || !Number.isFinite(value)) return null;
          return { label, value: Math.max(0, Math.min(10, Math.round(value * 10) / 10)), reason: asText(obj.motivo ?? obj.reason) };
        })
        .filter((item): item is ReportScore => !!item)
        .slice(0, 6)
    : [];

  return {
    title: asText(data.titulo ?? data.title).slice(0, 120),
    overview: asText(data.resumo ?? data.overview),
    keyPoints: asList(data.pontosPrincipais ?? data.keyPoints),
    decisions: asList(data.decisoes ?? data.decisions),
    actionItems,
    openQuestions: asList(data.perguntasEmAberto ?? data.openQuestions),
    scores,
    ...meta,
  };
}

export function averageScore(report: SessionReport): number | null {
  if (!report.scores.length) return null;
  const sum = report.scores.reduce((acc, s) => acc + s.value, 0);
  return Math.round((sum / report.scores.length) * 10) / 10;
}

/** Plain-text/Markdown version (copy to clipboard, paste anywhere). */
export function reportToMarkdown(report: SessionReport, sessionTitle?: string | null): string {
  const lines: string[] = [];
  lines.push(`# ${report.title || sessionTitle || 'Relatório da sessão'}`);
  if (report.overview) lines.push('', report.overview);
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push('', `## ${title}`, ...items.map((item) => `- ${item}`));
  };
  section('Pontos principais', report.keyPoints);
  section('Decisões', report.decisions);
  section(
    'Próximos passos',
    report.actionItems.map(
      (a) => `${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (prazo: ${a.due})` : ''}`
    )
  );
  section('Perguntas em aberto', report.openQuestions);
  section(
    'Pontuações',
    report.scores.map((s) => `${s.label}: ${s.value}/10${s.reason ? ` — ${s.reason}` : ''}`)
  );
  return lines.join('\n');
}
