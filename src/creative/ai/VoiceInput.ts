import { Capacitor } from '@capacitor/core';
import { AiServiceError, requestTranscript } from './AiClient';

/**
 * Tap-to-talk for the AI builder, recorded in the browser and transcribed
 * by the backend's speech-to-text (Groq Whisper). Nothing listens until the
 * child taps the microphone - that tap is when the browser asks for
 * permission - and the microphone is released as soon as they stop, cancel
 * or hit the time limit. Recordings are never stored.
 *
 * Every way it can go wrong ends in a VoiceError with a specific code, so
 * the UI can say what happened and what to do; it never pretends to have
 * heard something. Typing always remains available.
 *
 *   idle -> asking (permission) -> recording -> processing -> words
 *                                      \-> cancel / too short / silence
 */
export const MAX_SECONDS = 20;
/** Shorter taps are almost always accidental. */
export const MIN_SECONDS = 0.7;

export type VoiceStage = 'idle' | 'asking' | 'recording' | 'processing';

export type VoiceProblem =
  | 'app'
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'no-device'
  | 'busy'
  | 'too-short'
  | 'no-speech'
  | 'offline'
  | 'timeout'
  | 'rate-limited'
  | 'not-configured'
  | 'provider'
  | 'cancelled';

export class VoiceError extends Error {
  constructor(readonly code: VoiceProblem) {
    super(`voice: ${code}`);
  }
}

/** Recorder formats in order of preference; the first the browser supports wins (Safari records mp4). */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
/** RMS level that counts as someone speaking (0..1 scale), and how many 100 ms samples of it are needed. */
const SPEECH_LEVEL = 0.018;
const SPEECH_SAMPLES = 3;

/**
 * Whether this browser can record here at all (no permission prompt). Never
 * in the Android app: it does not ask for the microphone (no RECORD_AUDIO)
 * until voice for children has been decided and tested on real devices -
 * the child types instead.
 */
export function voiceSupport(nativeApp = Capacitor.isNativePlatform()): { ok: true } | { ok: false; code: 'app' | 'insecure' | 'unsupported' } {
  if (nativeApp) return { ok: false, code: 'app' };
  if (typeof window === 'undefined' || !window.isSecureContext) return { ok: false, code: 'insecure' };
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return { ok: false, code: 'unsupported' };
  return { ok: true };
}

/** The microphone permission as far as the browser will say without prompting. */
export async function microphonePermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return status ? (status.state as 'granted' | 'denied' | 'prompt') : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Tidy a transcript and reject what speech-to-text produces from silence or
 * noise (".", "you", "Thank you.") - those must never be sent as a request.
 * Returns null when there are no real words.
 */
export function cleanTranscript(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return null;
  const bare = text.toLowerCase().replace(/[^\p{L}\s']/gu, '').replace(/\s+/g, ' ').trim();
  if (PHANTOM_TRANSCRIPTS.has(bare)) return null;
  return text.slice(0, 300);
}

const PHANTOM_TRANSCRIPTS = new Set([
  'you',
  'thank you',
  'thanks',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'bye',
  'bye bye',
  'okay',
  'ok',
  'oh',
  'uh',
  'um',
  'hmm',
  'so',
  'subtitles by the amaraorg community',
]);

export class VoiceInput {
  private stage: VoiceStage = 'idle';
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private limit: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private speechSamples = 0;
  private cancelled = false;
  private finished: ((text: string) => void) | null = null;
  private failed: ((error: VoiceError) => void) | null = null;

  /** Told whenever the stage changes. */
  onStage: ((stage: VoiceStage) => void) | null = null;
  /** About ten times a second while recording: seconds so far and the input level (0..1). */
  onTick: ((seconds: number, level: number) => void) | null = null;
  /** Told when the time limit ends a recording by itself. */
  onAutoStop: (() => void) | null = null;

  get current(): VoiceStage {
    return this.stage;
  }

  /**
   * Start listening (the browser asks for permission the first time).
   * Resolves once recording has begun; `words` resolves with the cleaned
   * transcript after `stop()`, or rejects with a VoiceError. (Wrapped,
   * because a promise cannot resolve to another promise.)
   */
  async start(): Promise<{ words: Promise<string> }> {
    if (this.stage !== 'idle') throw new VoiceError('busy');
    const support = voiceSupport();
    if (!support.ok) throw new VoiceError(support.code);
    this.cancelled = false;
    this.setStage('asking');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      this.setStage('idle');
      throw new VoiceError(microphoneProblem(error));
    }
    if (this.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      this.setStage('idle');
      throw new VoiceError('cancelled');
    }
    this.stream = stream;
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      this.release();
      this.setStage('idle');
      throw new VoiceError('unsupported');
    }
    this.recorder = recorder;
    this.chunks = [];
    this.speechSamples = 0;
    const words = new Promise<string>((resolve, reject) => {
      this.finished = resolve;
      this.failed = reject;
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => void this.finish(recorder.mimeType || mimeType || 'audio/webm');
    recorder.start(250);
    this.startedAt = performance.now();
    this.watchLevel(stream);
    this.limit = setTimeout(() => {
      this.stop();
      this.onAutoStop?.();
    }, MAX_SECONDS * 1000);
    this.setStage('recording');
    return { words };
  }

  /** Stop recording and transcribe what was said. */
  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  /** Stop and throw everything away: recording, upload or transcription in flight. */
  cancel(): void {
    this.cancelled = true;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else this.abort?.abort();
    if (this.stage === 'asking' || this.stage === 'processing') this.fail('cancelled');
  }

  private async finish(mediaType: string): Promise<void> {
    const seconds = (performance.now() - this.startedAt) / 1000;
    const heard = this.speechSamples >= SPEECH_SAMPLES;
    const blob = new Blob(this.chunks, { type: mediaType.split(';')[0] });
    this.chunks = [];
    this.release();
    if (this.cancelled) return this.fail('cancelled');
    if (seconds < MIN_SECONDS) return this.fail('too-short');
    // Silence would come back as a made-up phrase; don't even send it.
    if (!heard || blob.size < 1000) return this.fail('no-speech');
    this.setStage('processing');
    this.abort = new AbortController();
    try {
      const text = cleanTranscript(await requestTranscript(blob, this.abort.signal));
      if (this.cancelled) return this.fail('cancelled');
      if (!text) return this.fail('no-speech');
      const finished = this.finished;
      this.reset();
      finished?.(text);
    } catch (error) {
      this.fail(this.cancelled ? 'cancelled' : serviceProblem(error));
    }
  }

  private fail(code: VoiceProblem): void {
    const failed = this.failed;
    this.release();
    this.reset();
    failed?.(new VoiceError(code));
  }

  private reset(): void {
    this.finished = null;
    this.failed = null;
    this.abort = null;
    this.setStage('idle');
  }

  /** A live input level for the recording indicator, and a count of moments that sounded like speech. */
  private watchLevel(stream: MediaStream): void {
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      const audio = new Context();
      this.audio = audio;
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.meter = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        const rms = Math.sqrt(sum / samples.length);
        if (rms > SPEECH_LEVEL) this.speechSamples++;
        this.onTick?.((performance.now() - this.startedAt) / 1000, Math.min(1, rms * 12));
      }, 100);
    } catch {
      // No level meter in this browser: assume there may be speech and let the transcript decide.
      this.speechSamples = SPEECH_SAMPLES;
    }
  }

  /** Hand the microphone back: nothing keeps recording after the child is done. */
  private release(): void {
    if (this.limit) clearTimeout(this.limit);
    if (this.meter) clearInterval(this.meter);
    this.limit = null;
    this.meter = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    void this.audio?.close().catch(() => {});
    this.audio = null;
  }

  private setStage(stage: VoiceStage): void {
    if (stage === this.stage) return;
    this.stage = stage;
    this.onStage?.(stage);
  }
}

function microphoneProblem(error: unknown): VoiceProblem {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unsupported';
}

function serviceProblem(error: unknown): VoiceProblem {
  if (!(error instanceof AiServiceError)) return 'provider';
  switch (error.code) {
    case 'offline':
      return 'offline';
    case 'timeout':
      return 'timeout';
    case 'rate-limited':
      return 'rate-limited';
    case 'not-configured':
    case 'not-deployed':
    case 'disabled':
      return 'not-configured';
    default:
      return 'provider';
  }
}
