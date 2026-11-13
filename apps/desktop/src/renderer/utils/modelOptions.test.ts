import { describe, expect, it } from 'vitest';
import { buildModelOptions, isModelId, pickStoredModel, prettyModelName } from './modelOptions';

describe('modelOptions', () => {
  it('formats ids as readable names', () => {
    expect(prettyModelName('gpt-6.1-sol')).toBe('GPT-6.1 Sol');
    expect(prettyModelName('gpt-5.6-luna')).toBe('GPT-5.6 Luna');
    expect(prettyModelName('gpt-4o')).toBe('GPT-4o');
    expect(prettyModelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(prettyModelName('gemini-2.5-flash-lite')).toBe('Gemini 2.5 Flash Lite');
    expect(prettyModelName('gemma-3-12b')).toBe('Gemma 3 12b'); // "3-12b" is not a version dot
    expect(prettyModelName('gemini-2.5-flash-native-audio-preview-12-2025')).toContain('12 2025');
  });

  it('tells ids from legacy display labels', () => {
    expect(isModelId('gpt-6.1-sol')).toBe(true);
    expect(isModelId('GPT-5.2 Standard')).toBe(false);
    expect(isModelId('Gemini 3 Pro')).toBe(false);
    expect(isModelId('')).toBe(false);
    expect(pickStoredModel('GPT-5.2 Standard', 'gpt-6.1-sol')).toBe('gpt-6.1-sol');
    expect(pickStoredModel(null, 'gpt-6.1-sol')).toBe('gpt-6.1-sol');
    expect(pickStoredModel('gpt-6-luna', 'gpt-6.1-sol')).toBe('gpt-6-luna');
  });

  it('builds options with id as value and the catalog name as label', () => {
    const options = buildModelOptions(['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-luna'], { 'gpt-6.1-sol': 'GPT-6.1 Sol' });
    expect(options).toEqual([
      { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ]);
  });

  it('keeps the current selection visible even when the list does not include it', () => {
    const options = buildModelOptions(['gpt-6.1-sol'], {}, 'gpt-5.2-codex');
    expect(options[0]).toEqual({ value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' });
    // a legacy label is never injected as an option
    expect(buildModelOptions(['gpt-6.1-sol'], {}, 'GPT-5.2 Standard')).toHaveLength(1);
  });
});
