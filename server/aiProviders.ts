/**
 * Server-only, provider-independent access to the two AI services EAVARA
 * uses: a chat model that turns a child's request into a construction
 * intent (strict JSON schema), and a speech-to-text model for tap-to-talk.
 * Never imported by the browser bundle.
 *
 * Configuration - server environment only, never sent to the browser:
 *
 *   ANTHROPIC_API_KEY     Claude API key - construction reasoning (preferred)
 *   GROQ_API_KEY          GroqCloud API key - speech-to-text (Whisper)
 *   EAVARA_LLM_PROVIDER   anthropic | groq | cloudflare | openai-compatible
 *                         (default: anthropic when ANTHROPIC_API_KEY is set, else groq,
 *                         else cloudflare when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN are set)
 *   EAVARA_LLM_MODEL      model id, or several separated by commas (tried in order);
 *                         Claude default: claude-opus-5-5
 *   EAVARA_LLM_EFFORT     Claude effort: low (default) | medium | high | xhigh | max
 *   EAVARA_LLM_BASE_URL   override the provider's base URL
 *   EAVARA_LLM_API_KEY    key for "openai-compatible" (or to override the provider key)
 *   EAVARA_STT_PROVIDER   groq | cloudflare | openai-compatible
 *                         (default: groq when GROQ_API_KEY is set, else cloudflare)
 *   EAVARA_STT_MODEL, EAVARA_STT_BASE_URL, EAVARA_STT_API_KEY   the same for speech-to-text
 *   EAVARA_STT_LANGUAGE   optional ISO-639-1 hint for speech-to-text (e.g. "en")
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN   Cloudflare Workers AI
 *   EAVARA_AI_ENABLED     kill switch: "false" (or 0 / off / no) turns the AI builder AND voice off
 *   EAVARA_VOICE_ENABLED  kill switch: "false" turns only voice (speech-to-text) off
 *                         (both default to on; on Vercel a changed variable applies after a redeploy)
 *
 * Children's data: requests carry only the child's words (or one short
 * recording) and the current house plan - no names, ids or user fields -
 * and nothing here logs request content or credentials.
 */
import Anthropic from '@anthropic-ai/sdk';

export type ProviderId = 'anthropic' | 'groq' | 'cloudflare' | 'openai-compatible';
export const PROVIDERS: readonly ProviderId[] = ['anthropic', 'groq', 'cloudflare', 'openai-compatible'];
/** Providers that can turn speech into text (Claude does not transcribe audio). */
const STT_PROVIDERS: readonly ProviderId[] = ['groq', 'cloudflare', 'openai-compatible'];

const CHAT_TIMEOUT_MS = 20_000;
const CLAUDE_TIMEOUT_MS = 25_000;
const TRANSCRIBE_TIMEOUT_MS = 25_000;
/**
 * Claude always thinks before it answers (claude-opus-5-5 cannot switch
 * thinking off; effort is the only control) and max_tokens covers the
 * thinking AND the answer - running out ends the request with no answer. So
 * the answer's own budget gets an allowance for thinking that grows with the
 * effort, under a hard ceiling for any one request.
 */
const CLAUDE_THINKING_ALLOWANCE: Record<Effort, number> = { low: 2_500, medium: 4_500, high: 6_500, xhigh: 6_500, max: 6_500 };
const CLAUDE_MAX_TOKENS = 8_000;

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const cloudflareBase = (account: string) => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai`;

/** Models used when none are configured. */
const DEFAULT_MODELS: Record<ProviderId, { llm: string[]; stt: string[] }> = {
  anthropic: { llm: ['claude-opus-5-5'], stt: [] },
  groq: { llm: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'], stt: ['whisper-large-v3-turbo', 'whisper-large-v3'] },
  cloudflare: { llm: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'], stt: ['@cf/openai/whisper-large-v3-turbo'] },
  'openai-compatible': { llm: [], stt: [] },
};

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

export type AiErrorCode =
  | 'not-configured'
  | 'unauthorized'
  | 'payment-required'
  | 'rate-limited'
  | 'too-large'
  | 'refused'
  | 'unavailable'
  | 'bad-response'
  | 'timeout';

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code: AiErrorCode,
    readonly status = 502,
    /** Seconds to wait before retrying, when the provider said (rate limits). */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export interface ProviderSettings {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** Cloudflare only: the account id (speech-to-text uses its native endpoint). */
  account?: string;
  /** Claude only: how much effort (thinking) to spend. */
  effort?: Effort;
}

type Env = Record<string, string | undefined>;

/** The chat model configuration, or null when no provider is configured. */
export function llmSettings(env: Env = process.env): ProviderSettings | null {
  const explicit = env.EAVARA_LLM_PROVIDER?.trim().toLowerCase();
  const provider = explicit
    ? asProvider(explicit, PROVIDERS)
    : env.ANTHROPIC_API_KEY
      ? 'anthropic'
      : env.GROQ_API_KEY
        ? 'groq'
        : env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN
          ? 'cloudflare'
          : null;
  return provider ? resolve('LLM', provider, env) : null;
}

/** The speech-to-text configuration, or null. Never Claude: it does not transcribe audio. */
export function sttSettings(env: Env = process.env): ProviderSettings | null {
  const explicit = env.EAVARA_STT_PROVIDER?.trim().toLowerCase();
  const llm = env.EAVARA_LLM_PROVIDER?.trim().toLowerCase();
  const provider = explicit
    ? asProvider(explicit, STT_PROVIDERS)
    : env.GROQ_API_KEY
      ? 'groq'
      : env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN
        ? 'cloudflare'
        : llm
          ? asProvider(llm, STT_PROVIDERS)
          : null;
  return provider ? resolve('STT', provider, env) : null;
}

function asProvider(name: string, allowed: readonly ProviderId[]): ProviderId | null {
  return (allowed as readonly string[]).includes(name) ? (name as ProviderId) : null;
}

/**
 * The kill switches (EAVARA_AI_ENABLED, EAVARA_VOICE_ENABLED): whether the
 * AI builder and voice may be used at all. On unless switched off; turning
 * the AI off turns voice off too.
 */
export function aiSwitches(env: Env = process.env): { build: boolean; voice: boolean } {
  const off = (value: string | undefined) => ['false', '0', 'off', 'no'].includes(value?.trim().toLowerCase() ?? '');
  const build = !off(env.EAVARA_AI_ENABLED);
  return { build, voice: build && !off(env.EAVARA_VOICE_ENABLED) };
}

/** max_tokens for one Claude request: the answer's budget plus room to think at this effort, never above the ceiling. */
export function claudeMaxTokens(answerTokens: number, effort: Effort | undefined): number {
  return Math.min(CLAUDE_MAX_TOKENS, Math.max(1, Math.floor(answerTokens)) + CLAUDE_THINKING_ALLOWANCE[effort ?? 'medium']);
}

/** What is configured, safe to report: provider and model names, never keys. */
export function describeConfiguration(env: Env = process.env): {
  llm: { provider: ProviderId; model: string } | null;
  stt: { provider: ProviderId; model: string } | null;
} {
  const llm = llmSettings(env);
  const stt = sttSettings(env);
  return {
    llm: llm ? { provider: llm.provider, model: llm.models[0] } : null,
    stt: stt ? { provider: stt.provider, model: stt.models[0] } : null,
  };
}

function resolve(kind: 'LLM' | 'STT', provider: ProviderId, env: Env): ProviderSettings | null {
  const configuredModels = (env[`EAVARA_${kind}_MODEL`] ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  const models = configuredModels.length ? configuredModels : DEFAULT_MODELS[provider][kind === 'LLM' ? 'llm' : 'stt'];
  const overrideKey = env[`EAVARA_${kind}_API_KEY`] || (kind === 'STT' ? env.EAVARA_LLM_API_KEY : undefined);
  const overrideBase = env[`EAVARA_${kind}_BASE_URL`] || (kind === 'STT' && provider === 'openai-compatible' ? env.EAVARA_LLM_BASE_URL : undefined);

  let baseUrl = '';
  let apiKey = '';
  let account: string | undefined;
  let effort: Effort | undefined;
  if (provider === 'anthropic') {
    baseUrl = overrideBase || ANTHROPIC_BASE_URL;
    apiKey = overrideKey || env.ANTHROPIC_API_KEY || '';
    const requested = env.EAVARA_LLM_EFFORT?.trim().toLowerCase();
    effort = (EFFORTS as readonly string[]).includes(requested ?? '') ? (requested as Effort) : 'low';
  } else if (provider === 'groq') {
    baseUrl = overrideBase || GROQ_BASE_URL;
    apiKey = overrideKey || env.GROQ_API_KEY || '';
  } else if (provider === 'cloudflare') {
    account = env.CLOUDFLARE_ACCOUNT_ID;
    baseUrl = overrideBase || (account ? `${cloudflareBase(account)}/v1` : '');
    apiKey = overrideKey || env.CLOUDFLARE_API_TOKEN || '';
  } else {
    baseUrl = overrideBase || '';
    apiKey = overrideKey || '';
  }
  if (!baseUrl || !apiKey || models.length === 0 || !/^https:\/\//.test(baseUrl)) return null;
  return { provider, baseUrl: baseUrl.replace(/\/$/, ''), apiKey, models, account, ...(effort ? { effort } : {}) };
}

// ------------------------------------------------------------------ chat

export interface ChatJsonRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Output budget for the answer itself (Claude gets extra room for its thinking - see claudeMaxTokens). */
  maxTokens: number;
}

/** One chat completion with a strict JSON-schema answer, parsed. Models are tried in order while unavailable. */
export async function chatJson(settings: ProviderSettings, request: ChatJsonRequest): Promise<{ data: unknown; model: string }> {
  if (settings.provider === 'anthropic') return claudeJson(settings, request);
  let lastError: AiProviderError | null = null;
  for (const model of settings.models) {
    const response = await send(`${settings.baseUrl}/chat/completions`, settings.apiKey, CHAT_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody(settings.provider, model, request)),
    });
    if (await modelUnavailable(response)) {
      lastError = new AiProviderError(`Model ${model} is not available`, 'unavailable');
      continue;
    }
    await throwForStatus(response);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> };
    const message = body.choices?.[0]?.message;
    if (!message?.content) throw new AiProviderError(message?.refusal ? 'The model refused the request' : 'Empty model response', 'bad-response');
    try {
      return { data: JSON.parse(stripFence(message.content)), model };
    } catch {
      throw new AiProviderError('The model did not return JSON', 'bad-response');
    }
  }
  throw lastError ?? new AiProviderError('No model configured', 'not-configured', 503);
}

function chatBody(provider: ProviderId, model: string, request: ChatJsonRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
    temperature: 0.2,
  };
  if (provider === 'groq') {
    body.max_completion_tokens = request.maxTokens;
    // Reasoning models think before answering; a construction intent needs only a little.
    if (/gpt-oss|qwen/i.test(model)) body.reasoning_effort = 'low';
  } else {
    body.max_tokens = request.maxTokens;
  }
  return body;
}

// ---------------------------------------------------------------- Claude

/**
 * Claude via the Anthropic Messages API (official SDK): JSON constrained by
 * `output_config.format` (structured outputs), effort from the settings, and
 * Anthropic's server-side refusal fallback where the model supports it.
 * The key and base URL are always passed explicitly, so ANTHROPIC_* variables
 * meant for other tools on the machine can never redirect these requests.
 */
async function claudeJson(settings: ProviderSettings, request: ChatJsonRequest): Promise<{ data: unknown; model: string }> {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    authToken: null,
    baseURL: settings.baseUrl,
    timeout: CLAUDE_TIMEOUT_MS,
    maxRetries: 1,
  });
  let lastError: AiProviderError | null = null;
  for (const model of settings.models) {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages.create({
        model,
        max_tokens: claudeMaxTokens(request.maxTokens, settings.effort),
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: { ...(settings.effort ? { effort: settings.effort } : {}), format: { type: 'json_schema', schema: request.schema } },
        // Re-run a declined request on Anthropic's recommended model (Claude API only; not Haiku).
        ...(serverFallback(settings, model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) {
        lastError = new AiProviderError(`Model ${model} is not available`, 'unavailable');
        continue;
      }
      throw claudeError(error);
    }
    if (message.stop_reason === 'refusal') throw new AiProviderError('Claude declined the request', 'refused', 422);
    if (message.stop_reason === 'max_tokens') throw new AiProviderError('Claude ran out of output tokens', 'bad-response');
    const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    try {
      return { data: JSON.parse(stripFence(text)), model: message.model };
    } catch {
      throw new AiProviderError('Claude did not return JSON', 'bad-response');
    }
  }
  throw lastError ?? new AiProviderError('No model configured', 'not-configured', 503);
}

function serverFallback(settings: ProviderSettings, model: string): boolean {
  return settings.baseUrl === ANTHROPIC_BASE_URL && /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

/** Map the SDK's typed errors (most specific first) onto EAVARA's error codes. */
function claudeError(error: unknown): AiProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('Claude took too long', 'timeout');
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError('Could not reach Claude', 'unavailable');
  if (error instanceof Anthropic.RateLimitError) {
    const retry = Number(error.headers?.get('retry-after'));
    return new AiProviderError(`Claude rate limit: ${error.message.slice(0, 200)}`, 'rate-limited', 429, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError(`Claude rejected the credentials (${error.status})`, 'unauthorized');
  }
  if (error instanceof Anthropic.APIError) {
    const detail = error.message.slice(0, 200);
    if (error.status === 402 || /credit balance|billing|payment/i.test(detail)) return new AiProviderError(`Claude billing: ${detail}`, 'payment-required', 402);
    if (error.status === 413) return new AiProviderError(`Claude: ${detail}`, 'too-large', 400);
    return new AiProviderError(`Claude error ${error.status ?? ''}: ${detail}`, 'unavailable');
  }
  return new AiProviderError('Claude request failed', 'unavailable');
}

/** Some models wrap JSON in a markdown fence even in JSON mode. */
function stripFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

// ---------------------------------------------------------- speech to text

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/** Transcribe one short recording. */
export async function transcribe(
  settings: ProviderSettings,
  audio: Uint8Array<ArrayBuffer>,
  mediaType: string,
  language?: string,
  prompt?: string,
): Promise<{ text: string; model: string }> {
  let lastError: AiProviderError | null = null;
  for (const model of settings.models) {
    const response =
      settings.provider === 'cloudflare' && settings.account
        ? // Workers AI's own endpoint takes the audio as base64 JSON.
          await send(`${cloudflareBase(settings.account)}/run/${model}`, settings.apiKey, TRANSCRIBE_TIMEOUT_MS, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audio: Buffer.from(audio).toString('base64'), ...(language ? { language } : {}), ...(prompt ? { initial_prompt: prompt } : {}) }),
          })
        : await send(`${settings.baseUrl}/audio/transcriptions`, settings.apiKey, TRANSCRIBE_TIMEOUT_MS, {
            method: 'POST',
            body: transcriptionForm(model, audio, mediaType, language, prompt),
          });
    if (await modelUnavailable(response)) {
      lastError = new AiProviderError(`Transcription model ${model} is not available`, 'unavailable');
      continue;
    }
    await throwForStatus(response);
    const body = (await response.json()) as { text?: unknown; result?: { text?: unknown } };
    const text = typeof body.text === 'string' ? body.text : body.result?.text;
    if (typeof text !== 'string') throw new AiProviderError('Transcription returned no text', 'bad-response');
    return { text, model };
  }
  throw lastError ?? new AiProviderError('No transcription model configured', 'not-configured', 503);
}

function transcriptionForm(model: string, audio: Uint8Array<ArrayBuffer>, mediaType: string, language?: string, prompt?: string): FormData {
  const form = new FormData();
  // The file name's extension tells OpenAI-compatible servers the audio format.
  form.append('file', new Blob([audio], { type: mediaType }), `speech.${EXTENSIONS[mediaType] ?? 'webm'}`);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  return form;
}

// ------------------------------------------------------------------ http

async function send(url: string, apiKey: string, timeoutMs: number, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new AiProviderError(timedOut ? 'The AI service took too long' : 'Could not reach the AI service', timedOut ? 'timeout' : 'unavailable');
  }
}

/** A 404, or a 400 that names the model: try the next configured model. */
async function modelUnavailable(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const detail = await errorDetail(response.clone());
  return /model/i.test(detail) && /(not found|not exist|decommission|does not support|unsupported|unknown|invalid model)/i.test(detail);
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string; errors?: Array<{ message?: string }> };
    if (typeof body.error === 'string') return body.error;
    return body.error?.message ?? body.errors?.[0]?.message ?? '';
  } catch {
    return '';
  }
}

async function throwForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  const detail = await errorDetail(response);
  const message = `AI service error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
  if (response.status === 429) {
    const retry = Number(response.headers.get('retry-after'));
    throw new AiProviderError(message, 'rate-limited', 429, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  if (response.status === 402 || /credit card|payment method|billing|upgrade your plan/i.test(detail)) {
    throw new AiProviderError(message, 'payment-required', 402);
  }
  if (response.status === 401 || response.status === 403) throw new AiProviderError(message, 'unauthorized');
  if (response.status === 413) throw new AiProviderError(message, 'too-large', 400);
  throw new AiProviderError(message, 'unavailable');
}
