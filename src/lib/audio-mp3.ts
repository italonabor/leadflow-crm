// Converte qualquer gravação do MediaRecorder (webm/ogg/mp4) em MP3 (audio/mpeg),
// que é um dos formatos aceitos pela WhatsApp Cloud API.
import { Mp3Encoder } from "@breezystack/lamejs";

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function blobToMp3(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }

  const channels = Math.min(decoded.numberOfChannels, 2);
  const sampleRate = decoded.sampleRate;
  const encoder = new Mp3Encoder(channels, sampleRate, 128);

  const left = floatToInt16(decoded.getChannelData(0));
  const right = channels > 1 ? floatToInt16(decoded.getChannelData(1)) : null;

  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right ? right.subarray(i, i + blockSize) : undefined;
    const buf = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));

  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}
