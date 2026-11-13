import type { AnalyzeChatResponse, AnalyzeScreenshotResponse } from '@neo/shared';

export type AnalysisEvent = {
  channel: 'ai.analysis.completed' | 'ai.analysis.error';
  payload: Record<string, unknown>;
};

type Result = AnalyzeChatResponse | AnalyzeScreenshotResponse;

/**
 * The event the windows get when a request ends. AIService reports failures as a result
 * (it does not throw), so a result with `success: false` must become an *error* event that
 * carries the conversation id and the reason — otherwise the chat has nothing to show and a
 * failed answer looks like "nothing happened".
 */
export function analysisOutcomeEvent(
  mode: 'chat' | 'screenshot',
  request: { sessionId?: number; screenshotId?: number },
  result: Result
): AnalysisEvent {
  const base = mode === 'screenshot' ? { mode, screenshotId: request.screenshotId } : { mode };
  if (result.success) {
    return {
      channel: 'ai.analysis.completed',
      payload: {
        ...base,
        sessionId: result.sessionId,
        success: true,
        usage: result.response?.usage,
        model: result.response?.modelUsed,
        provider: result.response?.providerUsed,
      },
    };
  }
  return {
    channel: 'ai.analysis.error',
    payload: {
      ...base,
      sessionId: result.sessionId ?? request.sessionId,
      error: result.error || 'Unknown error',
      errorCode: result.errorCode,
    },
  };
}
