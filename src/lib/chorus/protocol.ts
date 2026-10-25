export type SourceKind = "file" | "demo" | "youtube";

export type TrackMeta = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  duration: number;
  hash: string;
  source: SourceKind;
  videoId?: string;
  author?: string;
  thumb?: string;
  playlistTitle?: string;
  playlistIndex?: number;
  playlistCount?: number;
};

export type Transport = {
  seq: number;
  trackId: string | null;
  playing: boolean;
  position: number;
  hostTime: number;
};

export type Wire =
  | { t: "hello"; name: string; have: string | null }
  | { t: "welcome" }
  | { t: "state"; transport: Transport; track: TrackMeta | null }
  | { t: "begin"; track: TrackMeta; chunks: number }
  | { t: "chunk"; id: string; i: number; n: number; d: string }
  | { t: "ack"; id: string; i: number }
  | { t: "have"; id: string }
  | { t: "need"; id: string }
  | { t: "clk"; n: number; t1: number; tH?: number };

export const CHUNK_BYTES = 9_000;
export const MAX_BYTES = 18 * 1024 * 1024;

const WIRE_TYPES = new Set(["hello", "welcome", "state", "begin", "chunk", "ack", "have", "need", "clk"]);

export function isWire(value: unknown): value is Wire {
  if (!value || typeof value !== "object") return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === "string" && WIRE_TYPES.has(t);
}

export function makePeerId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, 24);
  return trimmed || "Phone";
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
