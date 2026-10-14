import { AiProviderError, aiSwitches, chatJson, llmSettings } from '../server/aiProviders.js';
import { BUILD_INTENT_SCHEMA, MAX_PROMPT_CHARS, readBuildRequest, SYSTEM_PROMPT, userMessage } from '../server/buildIntent.js';
import { isAllowedOrigin, json, readJson, withinRateLimit } from '../server/http.js';

/**
 * POST /api/build  { text, current }  ->  { intent, model, provider }
 *
 * Interprets one child request into a construction intent with the
 * configured chat model (strict JSON schema; see server/aiProviders.ts).
 * The browser validates the intent again before previewing anything; this
 * endpoint never builds by itself.
 */
const MAX_BODY_BYTES = 8_000;
/** Output budget for the answer: a few hundred tokens of JSON (Claude also gets room to think - see claudeMaxTokens). */
const ANSWER_TOKENS = 1_500;

export async function POST(request: Request): Promise<Response> {
  if (!aiSwitches().build) return json(503, { error: 'disabled' });
  if (!isAllowedOrigin(request)) return json(403, { error: 'forbidden' });
  if (!withinRateLimit(request, 20)) return json(429, { error: 'rate-limited' });
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return json(read.error === 'too-large' ? 413 : 400, { error: read.error });
  const body = readBuildRequest(read.value);
  if (!body) return json(400, { error: 'bad-request' });
  const user = userMessage(body);
  if (user.length > MAX_PROMPT_CHARS) return json(413, { error: 'too-large' });

  const settings = llmSettings();
  if (!settings) return json(503, { error: 'not-configured' });
  try {
    const { data, model } = await chatJson(settings, {
      system: SYSTEM_PROMPT,
      user,
      schemaName: 'construction_intent',
      schema: BUILD_INTENT_SCHEMA,
      maxTokens: ANSWER_TOKENS,
    });
    return json(200, { intent: data, model, provider: settings.provider });
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.warn(`[api/build] ${settings.provider} ${error.code}: ${error.message}`);
      return json(error.status, { error: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
    console.error('[api/build] unexpected failure', error instanceof Error ? error.name : 'unknown');
    return json(500, { error: 'failed' });
  }
}
