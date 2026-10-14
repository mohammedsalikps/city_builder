import { withHiddenName, type ModelPlan } from './BuildIntent';

/**
 * The browser side of EAVARA's AI endpoints (api/*.ts). It only ever talks
 * to our own backend - never to an AI provider - so no credential exists in
 * the browser bundle. VITE_EAVARA_API_BASE (a public URL, not a secret) lets
 * a packaged app reach the hosted backend; the web app uses its own origin.
 */
const API_BASE = String(import.meta.env.VITE_EAVARA_API_BASE ?? '').replace(/\/$/, '');
/** Claude thinks before answering; the server allows ~25 s plus one retry. */
const INTERPRET_TIMEOUT_MS = 55_000;
const TRANSCRIBE_TIMEOUT_MS = 30_000;

export class AiServiceError extends Error {
  constructor(
    /** 'not-configured', 'unauthorized', 'unavailable', 'rate-limited', 'timeout', 'offline', 'bad-response'... */
    readonly code: string,
  ) {
    super(`AI service: ${code}`);
  }
}

export interface InterpretResponse {
  intent: unknown;
  model: string;
}

/** What else the helper should know: only whether the child has built a house (for "a garden behind it"). */
export interface InterpretContext {
  hasHouse: boolean;
}

export type Interpreter = (text: string, current: ModelPlan | null, context?: InterpretContext) => Promise<InterpretResponse>;

/**
 * Ask the backend what a child's request means (the answer is validated by
 * the caller). The creation's name stays on the device: the AI only sees
 * HIDDEN_NAME, and BuildAssistant puts the real name back.
 */
export const requestIntent: Interpreter = async (text, current, context) => {
  const body = await post('/api/build', { text, current: current ? withHiddenName(current) : null, hasHouse: context?.hasHouse === true }, INTERPRET_TIMEOUT_MS);
  return { intent: (body as { intent?: unknown }).intent, model: String((body as { model?: unknown }).model ?? '') };
};

/** Turn one recorded clip into text with the backend's speech-to-text. `signal` cancels it. */
export async function requestTranscript(audio: Blob, signal?: AbortSignal): Promise<string> {
  const body = await post('/api/transcribe', { audio: await toBase64(audio), mediaType: audio.type || 'audio/webm' }, TRANSCRIBE_TIMEOUT_MS, signal);
  const text = (body as { text?: unknown }).text;
  if (typeof text !== 'string') throw new AiServiceError('bad-response');
  return text;
}

async function post(path: string, payload: unknown, timeoutMs: number, cancel?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = cancel && typeof AbortSignal.any === 'function' ? AbortSignal.any([cancel, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (cancel?.aborted) throw new AiServiceError('cancelled');
    const name = error instanceof Error ? error.name : '';
    throw new AiServiceError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'offline');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON (e.g. a static host without the API)
  }
  if (!response.ok) {
    const code = (body as { error?: unknown } | null)?.error;
    throw new AiServiceError(typeof code === 'string' ? code : response.status === 404 ? 'not-deployed' : `http-${response.status}`);
  }
  if (body === null) throw new AiServiceError('bad-response');
  return body;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new AiServiceError('bad-audio'));
    reader.readAsDataURL(blob);
  });
}
