export type ModelOption = { label: string; value: string };

/** Real model ids are lowercase with no spaces (`gpt-6.1-sol`); legacy labels ("GPT-5.2 Standard") are not. */
export const isModelId = (value: string | null | undefined): value is string =>
    !!value && /^[a-z0-9][a-z0-9._:-]*$/.test(value);

/** A stored selection, ignoring leftovers from older versions that saved display labels. */
export const pickStoredModel = (stored: string | null | undefined, fallbackId: string): string =>
    isModelId(stored) ? stored : fallbackId;

/** `gpt-6.1-sol` → `GPT-6.1 Sol`, `claude-opus-5-5` → `Claude Opus 5.5`, `gemini-2.5-flash` → `Gemini 2.5 Flash`. */
export function prettyModelName(id: string): string {
    const parts = id
        .replace(/(?<!\d)(\d)-(\d)(?!\d)/g, '$1.$2')
        .split('-')
        .filter(Boolean);
    const cap = (word: string) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word);
    if (parts[0] === 'gpt') {
        return ['GPT', [parts[1], ...parts.slice(2).map(cap)].filter(Boolean).join(' ')].filter(Boolean).join('-');
    }
    return parts.map(cap).join(' ');
}

/**
 * Dropdown options for a list of model ids: the id is the value, the catalog name (or a
 * formatted id) is the label. The current selection is kept even if the list lacks it.
 */
export function buildModelOptions(
    ids: string[],
    names: Record<string, string> = {},
    selected?: string
): ModelOption[] {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (selected && isModelId(selected) && !unique.includes(selected)) unique.unshift(selected);
    return unique.map((id) => ({ value: id, label: names[id] || prettyModelName(id) }));
}
