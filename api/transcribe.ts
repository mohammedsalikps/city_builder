import { AiProviderError, aiSwitches, sttSettings, transcribe } from '../server/aiProviders.js';
import { audioSeconds } from '../server/audioDuration.js';
import { isAllowedOrigin, json, readJson, withinRateLimit } from '../server/http.js';

/**
 * POST /api/transcribe  { audio: base64, mediaType }  ->  { text, model, provider }
 *
 * Turns one short tap-to-record clip into text with the configured
 * speech-to-text model. The audio is passed straight to the provider and
 * never stored or logged here.
 */
/** The app stops recording at 20 s (src/creative/ai/VoiceInput.ts); a second of slack for the recorder stopping. */
const MAX_SECONDS = 21;
/**
 * 20 s at up to 256 kbit/s plus room for the container - several times what
 * the app's compressed speech needs. Also the limit for clips whose length
 * cannot be read from the file (see server/audioDuration.ts).
 */
const MAX_AUDIO_BYTES = 720_000;
/** The JSON body: the largest allowed clip as base64, plus a little for the field names. */
const MAX_BODY_BYTES = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 1_000;
/** Spelling hint for speech-to-text: the words children use when they describe a building. */
const VOCABULARY = 'A child is describing something to build in a game: a house, bedrooms, a kitchen, a living room, a bathroom, a garden, a driveway, a balcony, a roof, a park, the lake, wider, longer, metres.';
const MEDIA_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'];

export async function POST(request: Request): Promise<Response> {
  if (!aiSwitches().voice) return json(503, { error: 'disabled' });
  if (!isAllowedOrigin(request)) return json(403, { error: 'forbidden' });
  if (!withinRateLimit(request, 15)) return json(429, { error: 'rate-limited' });
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return json(read.error === 'too-large' ? 413 : 400, { error: read.error });
  const body = read.value as { audio?: unknown; mediaType?: unknown } | null;
  const mediaType = typeof body?.mediaType === 'string' ? body.mediaType.split(';')[0].trim().toLowerCase() : '';
  if (!body || typeof body.audio !== 'string' || body.audio.length < 100 || !MEDIA_TYPES.includes(mediaType) || !/^[A-Za-z0-9+/=]+$/.test(body.audio)) {
    return json(400, { error: 'bad-request' });
  }
  const audio = new Uint8Array(Buffer.from(body.audio, 'base64'));
  if (audio.byteLength > MAX_AUDIO_BYTES) return json(413, { error: 'too-large' });
  // Longer than the app ever records: refused before it reaches (and is billed by) the provider.
  const seconds = audioSeconds(audio);
  if (seconds !== null && seconds > MAX_SECONDS) return json(413, { error: 'too-long' });

  const settings = sttSettings();
  if (!settings) return json(503, { error: 'not-configured' });
  try {
    // English by default (the only language tested so far); EAVARA_STT_LANGUAGE=auto lets Whisper detect it.
    const configured = process.env.EAVARA_STT_LANGUAGE?.trim().toLowerCase() || 'en';
    const language = configured === 'auto' ? undefined : configured;
    const { text, model } = await transcribe(settings, audio, mediaType, language, VOCABULARY);
    return json(200, { text: text.trim().slice(0, 400), model, provider: settings.provider });
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.warn(`[api/transcribe] ${settings.provider} ${error.code}: ${error.message}`);
      return json(error.status, { error: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
    console.error('[api/transcribe] unexpected failure', error instanceof Error ? error.name : 'unknown');
    return json(500, { error: 'failed' });
  }
}
