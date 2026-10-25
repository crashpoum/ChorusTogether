import { CHUNK_BYTES } from "./protocol";

export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + stride));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function b64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function sliceB64(buffer: ArrayBuffer, index: number): string {
  const start = index * CHUNK_BYTES;
  const end = Math.min(buffer.byteLength, start + CHUNK_BYTES);
  return bytesToB64(new Uint8Array(buffer, start, end - start));
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? toArrayBuffer(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readDuration(buffer: ArrayBuffer, mime: string): Promise<number> {
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const audio = new Audio();
  audio.preload = "metadata";
  return new Promise((resolve) => {
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4)$/i;

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  if (file.type.startsWith("video/")) return false;
  return AUDIO_EXT.test(file.name);
}

export function mimeFor(file: File): string {
  if (file.type.startsWith("audio/")) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
    case "aac":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "webm":
      return "audio/webm";
    default:
      return "audio/mpeg";
  }
}
