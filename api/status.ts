import { aiSwitches, describeConfiguration } from '../server/aiProviders.js';
import { isAllowedOrigin, json, withinRateLimit } from '../server/http.js';

/**
 * GET /api/status -> { ai, voice }: whether the AI builder and voice can be
 * used right now (a provider is configured and its kill switch is not off).
 * It is public, so it says nothing more - which providers and models are
 * configured is for the team to see in the hosting settings, not for
 * visitors. Other websites are refused and calls are rate-limited like the
 * other endpoints (browsers leave Origin out of a same-site GET, so a
 * missing Origin is allowed here).
 */
export function GET(request: Request): Response {
  if (!isAllowedOrigin(request, { allowMissing: true })) return json(403, { error: 'forbidden' });
  if (!withinRateLimit(request, 30)) return json(429, { error: 'rate-limited' });
  const { llm, stt } = describeConfiguration();
  const switches = aiSwitches();
  return json(200, { ai: switches.build && llm !== null, voice: switches.voice && stt !== null });
}
