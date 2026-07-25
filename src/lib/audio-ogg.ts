// Converte a gravação do MediaRecorder (WebM/Opus) em OGG/Opus **sem recodificar**.
// OGG Opus é o formato nativo de nota de voz do WhatsApp: enviado com type=audio +
// voice=true, ele aparece no celular como áudio de voz (waveform), não como arquivo.

/* ---------------- EBML (WebM) demux mínimo p/ faixa Opus ---------------- */

type Demuxed = { header: Uint8Array | null; packets: Uint8Array[] };

function readVint(buf: Uint8Array, pos: number, keepMarker: boolean) {
  const first = buf[pos];
  if (first === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 8) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = !keepMarker && (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    const byte = buf[pos + i];
    if (byte === undefined) return null;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

const MASTERS = new Set([
  0x18538067, // Segment
  0x1f43b675, // Cluster
  0x1654ae6b, // Tracks
  0xae, // TrackEntry
  0xa0, // BlockGroup
]);

function demuxWebmOpus(data: Uint8Array): Demuxed {
  const out: Demuxed = { header: null, packets: [] };

  const walk = (start: number, end: number) => {
    let pos = start;
    while (pos < end) {
      const id = readVint(data, pos, true);
      if (!id) return;
      let p = pos + id.length;
      const size = readVint(data, p, false);
      if (!size) return;
      p += size.length;
      const contentEnd = size.unknown ? end : Math.min(end, p + size.value);

      if (MASTERS.has(id.value)) {
        walk(p, contentEnd);
      } else if (id.value === 0x63a2) {
        // CodecPrivate = OpusHead
        if (!out.header) out.header = data.subarray(p, contentEnd);
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        // (Simple)Block: track vint + int16 timecode + flags + frame
        const track = readVint(data, p, false);
        if (track) {
          const frameStart = p + track.length + 3;
          if (frameStart < contentEnd) out.packets.push(data.subarray(frameStart, contentEnd));
        }
      }
      pos = contentEnd;
      if (size.unknown && !MASTERS.has(id.value)) return;
    }
  };

  walk(0, data.length);
  return out;
}

/* ---------------- duração do pacote Opus (TOC) ---------------- */

function opusSamples(packet: Uint8Array): number {
  if (!packet.length) return 960;
  const toc = packet[0];
  const config = toc >> 3;
  let ms: number;
  if (config < 12) ms = [10, 20, 40, 60][config % 4];
  else if (config < 16) ms = [10, 20][config % 2];
  else ms = [2.5, 5, 10, 20][config % 4];
  let frames = 1;
  const code = toc & 0x03;
  if (code === 1 || code === 2) frames = 2;
  else if (code === 3) frames = packet.length > 1 ? packet[1] & 0x3f : 1;
  return Math.round(ms * 48 * frames); // 48 kHz
}

/* ---------------- Ogg muxer ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(page: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ page[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

function buildPage(
  packets: Uint8Array[],
  serial: number,
  seq: number,
  granule: number,
  headerType: number,
): Uint8Array {
  const segments: number[] = [];
  for (const pkt of packets) {
    let len = pkt.length;
    while (len >= 255) {
      segments.push(255);
      len -= 255;
    }
    segments.push(len);
  }
  const bodyLen = packets.reduce((a, p) => a + p.length, 0);
  const page = new Uint8Array(27 + segments.length + bodyLen);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0;
  page[5] = headerType;
  // granule position (64-bit LE)
  view.setUint32(6, granule >>> 0, true);
  view.setUint32(10, Math.floor(granule / 4294967296), true);
  view.setUint32(14, serial >>> 0, true);
  view.setUint32(18, seq >>> 0, true);
  view.setUint32(22, 0, true); // CRC placeholder
  page[26] = segments.length;
  page.set(segments, 27);
  let off = 27 + segments.length;
  for (const pkt of packets) {
    page.set(pkt, off);
    off += pkt.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("prospecta-crm");
  const buf = new Uint8Array(8 + 4 + vendor.length + 4);
  buf.set(new TextEncoder().encode("OpusTags"), 0);
  new DataView(buf.buffer).setUint32(8, vendor.length, true);
  buf.set(vendor, 12);
  return buf;
}

function defaultOpusHead(channels = 1): Uint8Array {
  const b = new Uint8Array(19);
  b.set(new TextEncoder().encode("OpusHead"), 0);
  b[8] = 1; // version
  b[9] = channels;
  new DataView(b.buffer).setUint16(10, 3840, true); // pre-skip
  new DataView(b.buffer).setUint32(12, 48000, true); // input sample rate
  return b;
}

/** Remuxa WebM/Opus → OGG/Opus (sem perda). Lança se a gravação não for Opus. */
export async function webmOpusToOgg(blob: Blob): Promise<Blob> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const { header, packets } = demuxWebmOpus(data);
  if (packets.length === 0) throw new Error("Gravação sem quadros de áudio Opus");

  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages: Uint8Array[] = [];
  let seq = 0;
  pages.push(buildPage([header ?? defaultOpusHead()], serial, seq++, 0, 0x02)); // BOS
  pages.push(buildPage([opusTags()], serial, seq++, 0, 0x00));

  let granule = 0;
  const MAX_PER_PAGE = 50;
  for (let i = 0; i < packets.length; i += MAX_PER_PAGE) {
    const group = packets.slice(i, i + MAX_PER_PAGE);
    for (const p of group) granule += opusSamples(p);
    const last = i + MAX_PER_PAGE >= packets.length;
    pages.push(buildPage(group, serial, seq++, granule, last ? 0x04 : 0x00));
  }

  return new Blob(pages as BlobPart[], { type: "audio/ogg" });
}
