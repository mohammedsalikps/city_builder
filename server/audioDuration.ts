/**
 * How long a recording is, read from the file itself without decoding any
 * audio, so /api/transcribe can refuse clips longer than the app ever
 * records (src/creative/ai/VoiceInput.ts stops at 20 s). The format is
 * recognised from the bytes, never from the media type the browser claims.
 *
 * Best effort and deliberately pessimistic: when a file offers several
 * answers (its declared duration, its timestamps, the Opus packets it
 * really contains) the LONGEST one is returned. Returns null when the
 * format is not recognised or the file does not say - the caller then
 * relies on its byte budget. A crafted file can still understate its
 * length in ways this cannot see (for example a non-Opus codec with false
 * timestamps); the byte budget bounds those.
 *
 *   WAV (PCM)     data bytes / byte rate
 *   WebM (EBML)   Opus packets counted from their TOC bytes, block timestamps, declared Duration
 *   Ogg           Opus packets counted from their TOC bytes, last granule position
 *   MP4 / M4A     mvhd / mdhd durations, fragment (trun) sample durations
 */
export function audioSeconds(bytes: Uint8Array): number | null {
  try {
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return wavSeconds(bytes);
    if (u32be(bytes, 0) === 0x1a45dfa3) return webmSeconds(bytes);
    if (ascii(bytes, 0, 4) === 'OggS') return oggSeconds(bytes);
    if (ascii(bytes, 4, 4) === 'ftyp') return mp4Seconds(bytes);
  } catch {
    // A truncated or malformed header: the length is unknown.
  }
  return null;
}

// --------------------------------------------------------------------- WAV

function wavSeconds(bytes: Uint8Array): number | null {
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = u16le(bytes, body);
      const channels = u16le(bytes, body + 2);
      const sampleRate = u32le(bytes, body + 4);
      const rate = u32le(bytes, body + 8);
      const blockAlign = u16le(bytes, body + 12);
      const bits = u16le(bytes, body + 14);
      // Only uncompressed audio, and only a header that agrees with itself (a made-up byte rate could hide the length).
      const pcm = format === 1 || format === 3 || format === 0xfffe;
      if (!pcm || channels === 0 || blockAlign !== (channels * bits) / 8 || rate !== sampleRate * blockAlign || rate === 0) return null;
      byteRate = rate;
    } else if (id === 'data') {
      // Everything after the data header counts, whatever size the header declares.
      return byteRate ? (bytes.length - body) / byteRate : null;
    }
    offset = body + size + (size % 2);
  }
  return null;
}

// -------------------------------------------------------------------- WebM

const EBML = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  codecId: 0x86,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  blockGroup: 0xa0,
  block: 0xa1,
  simpleBlock: 0xa3,
};
/** Elements read into rather than skipped (their size may be "unknown" in a live recording). */
const EBML_CONTAINERS = new Set([EBML.segment, EBML.info, EBML.tracks, EBML.trackEntry, EBML.cluster, EBML.blockGroup]);

function webmSeconds(bytes: Uint8Array): number | null {
  let offset = 0;
  let scale = 1_000_000; // ns per timestamp tick
  let declared = 0;
  let opus = false;
  let cluster = 0;
  let lastTick = 0;
  let opusSamples = 0;
  let lastBlockSamples = 0;
  while (offset < bytes.length) {
    const id = vint(bytes, offset, true);
    if (!id) break;
    const size = vint(bytes, offset + id.length, false);
    if (!size) break;
    const body = offset + id.length + size.length;
    if (EBML_CONTAINERS.has(id.value)) {
      offset = body;
      continue;
    }
    if (size.unknown) break;
    const end = Math.min(bytes.length, body + size.value);
    if (id.value === EBML.timecodeScale) scale = uint(bytes, body, end) || scale;
    else if (id.value === EBML.duration) declared = float(bytes, body, end);
    else if (id.value === EBML.codecId) opus ||= ascii(bytes, body, end - body).replace(/\0+$/, '') === 'A_OPUS';
    else if (id.value === EBML.timecode) cluster = uint(bytes, body, end);
    else if (id.value === EBML.simpleBlock || id.value === EBML.block) {
      const track = vint(bytes, body, false);
      if (track && body + track.length + 3 <= end) {
        const at = body + track.length;
        const relative = (bytes[at] << 24) >> 16 | bytes[at + 1]; // signed 16-bit
        lastTick = Math.max(lastTick, cluster + relative);
        const laced = (bytes[at + 2] & 0x06) !== 0;
        lastBlockSamples = opus && !laced ? opusPacketSamples(bytes, at + 3, end) : 0;
        opusSamples += lastBlockSamples;
      }
    }
    offset = body + size.value;
  }
  const fromTimestamps = (lastTick * scale) / 1e9 + lastBlockSamples / 48_000;
  const seconds = Math.max(fromTimestamps, (declared * scale) / 1e9, opusSamples / 48_000);
  return seconds > 0 ? seconds : null;
}

/** An EBML variable-length integer: ids keep their length marker, sizes do not ("all ones" = unknown size). */
function vint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i];
    allOnes &&= bytes[offset + i] === 0xff;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

// --------------------------------------------------------------------- Ogg

function oggSeconds(bytes: Uint8Array): number | null {
  let offset = 0;
  let granule = 0;
  let rate = 0;
  let preSkip = 0;
  let opus = false;
  let opusSamples = 0;
  let packetStart = true;
  while (offset + 27 <= bytes.length && ascii(bytes, offset, 4) === 'OggS') {
    const continued = (bytes[offset + 5] & 0x01) !== 0;
    const position = u32le(bytes, offset + 6) + u32le(bytes, offset + 10) * 2 ** 32;
    // -1 (all ones) means "no packet ends on this page".
    if (u32le(bytes, offset + 6) !== 0xffffffff || u32le(bytes, offset + 10) !== 0xffffffff) granule = Math.max(granule, position);
    const segments = bytes[offset + 26];
    let data = offset + 27 + segments;
    packetStart = !continued;
    for (let i = 0; i < segments; i++) {
      const length = bytes[offset + 27 + i];
      if (packetStart && length > 0) {
        if (ascii(bytes, data, 8) === 'OpusHead') {
          opus = true;
          rate = 48_000;
          preSkip = u16le(bytes, data + 10);
        } else if (ascii(bytes, data, 7) === '\u0001vorbis') {
          rate = u32le(bytes, data + 12);
        } else if (opus && ascii(bytes, data, 8) !== 'OpusTags') {
          opusSamples += opusPacketSamples(bytes, data, data + length);
        }
      }
      data += length;
      packetStart = length < 255;
    }
    offset = data;
  }
  if (!rate) return null;
  const seconds = Math.max((granule - preSkip) / rate, opusSamples / 48_000);
  return seconds > 0 ? seconds : null;
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716, section 3.1). */
function opusPacketSamples(bytes: Uint8Array, offset: number, end: number): number {
  if (offset >= end) return 0;
  const toc = bytes[offset];
  const config = toc >> 3;
  const frameMs = config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code < 3 ? 2 : offset + 1 < end ? bytes[offset + 1] & 0x3f : 0;
  return frameMs * 48 * frames;
}

// --------------------------------------------------------------------- MP4

const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'mvex', 'moof', 'traf']);

function mp4Seconds(bytes: Uint8Array): number | null {
  let movie = 0;
  let media = 0;
  let mediaScale = 0;
  let movieScale = 0;
  let trexDuration = 0;
  let fragmentTicks = 0;
  let defaultDuration = 0;
  const walk = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = u32be(bytes, offset);
      const type = ascii(bytes, offset + 4, 4);
      let header = 8;
      if (size === 1) {
        size = u32be(bytes, offset + 8) * 2 ** 32 + u32be(bytes, offset + 12);
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header) return;
      const body = offset + header;
      const boxEnd = Math.min(end, offset + size);
      if (MP4_CONTAINERS.has(type)) {
        if (type === 'traf') defaultDuration = trexDuration;
        walk(body, boxEnd);
      } else if (type === 'mvhd' || type === 'mdhd') {
        const v1 = bytes[body] === 1;
        const scale = u32be(bytes, body + (v1 ? 20 : 12));
        const duration = v1 ? u32be(bytes, body + 24) * 2 ** 32 + u32be(bytes, body + 28) : u32be(bytes, body + 16);
        if (type === 'mvhd') {
          movieScale = scale;
          movie = scale ? duration / scale : 0;
        } else {
          mediaScale ||= scale;
          media = Math.max(media, scale ? duration / scale : 0);
        }
      } else if (type === 'trex') {
        trexDuration = u32be(bytes, body + 12);
      } else if (type === 'tfhd') {
        const flags = u32be(bytes, body) & 0xffffff;
        let at = body + 8;
        if (flags & 0x01) at += 8;
        if (flags & 0x02) at += 4;
        if (flags & 0x08) defaultDuration = u32be(bytes, at);
      } else if (type === 'trun') {
        const flags = u32be(bytes, body) & 0xffffff;
        const count = u32be(bytes, body + 4);
        let at = body + 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0);
        const stride = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length * 4;
        if (!(flags & 0x100)) fragmentTicks += count * defaultDuration;
        else for (let i = 0; i < count && at + 4 <= boxEnd; i++, at += stride) fragmentTicks += u32be(bytes, at);
      }
      offset = offset + size;
    }
  };
  walk(0, bytes.length);
  const scale = mediaScale || movieScale;
  const seconds = Math.max(movie, media, scale ? fragmentTicks / scale : 0);
  return seconds > 0 ? seconds : null;
}

// ----------------------------------------------------------------- reading

/** A short ASCII tag ('' when out of range or longer than any tag read here). */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length > 64 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function u16le(bytes: Uint8Array, offset: number): number {
  inRange(bytes, offset, 2);
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function u32le(bytes: Uint8Array, offset: number): number {
  inRange(bytes, offset, 4);
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000;
}

function u32be(bytes: Uint8Array, offset: number): number {
  inRange(bytes, offset, 4);
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

/** An unsigned big-endian integer filling [start, end) (EBML), at most 7 bytes. */
function uint(bytes: Uint8Array, start: number, end: number): number {
  if (end - start > 7) return 0;
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  return value;
}

/** An EBML float: 4 or 8 bytes, big-endian. */
function float(bytes: Uint8Array, start: number, end: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  const value = end - start === 4 ? view.getFloat32(0) : end - start === 8 ? view.getFloat64(0) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Throws when a read would run past the end (a truncated header). */
function inRange(bytes: Uint8Array, offset: number, length: number): void {
  if (offset < 0 || offset + length > bytes.length) throw new RangeError('truncated');
}
