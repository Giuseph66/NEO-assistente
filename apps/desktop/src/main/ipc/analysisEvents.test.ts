import { describe, expect, it } from 'vitest';
import { analysisOutcomeEvent } from './analysisEvents';

describe('analysisOutcomeEvent', () => {
  it('a successful answer completes the request with its model and usage', () => {
    const event = analysisOutcomeEvent('chat', { sessionId: 5 }, {
      success: true, sessionId: 5,
      response: { answerText: 'x', modelUsed: 'gpt-6-luna', providerUsed: 'codex-cli', usage: { tokensIn: 1, tokensOut: 2 } },
    });
    expect(event).toEqual({
      channel: 'ai.analysis.completed',
      payload: { mode: 'chat', sessionId: 5, success: true, usage: { tokensIn: 1, tokensOut: 2 }, model: 'gpt-6-luna', provider: 'codex-cli' },
    });
  });

  it('a failed result is an ERROR event with the conversation and the reason (it used to be "completed" with no session)', () => {
    const event = analysisOutcomeEvent('chat', { sessionId: 5 }, { success: false, error: 'limite', errorCode: 'rate_limited' });
    expect(event.channel).toBe('ai.analysis.error');
    expect(event.payload).toEqual({ mode: 'chat', sessionId: 5, error: 'limite', errorCode: 'rate_limited' });
  });

  it('prefers the id AIService reports (a conversation created by this request) and keeps the screenshot id', () => {
    const chat = analysisOutcomeEvent('chat', {}, { success: false, sessionId: 9, error: 'x' });
    expect(chat.payload.sessionId).toBe(9);
    const shot = analysisOutcomeEvent('screenshot', { screenshotId: 3 }, { success: false, error: 'x' });
    expect(shot.payload).toMatchObject({ mode: 'screenshot', screenshotId: 3, error: 'x' });
  });

  it('never sends an empty error', () => {
    expect(analysisOutcomeEvent('chat', {}, { success: false }).payload.error).toBe('Unknown error');
  });
});
