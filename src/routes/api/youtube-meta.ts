import { createFileRoute } from "@tanstack/react-router";

const ID = /^[\w-]{11}$/;
const LIST = /^[\w-]{12,90}$/;
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const MAX_ITEMS = 200;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export const Route = createFileRoute("/api/youtube-meta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const list = url.searchParams.get("list") ?? "";
        if (list) {
          if (!LIST.test(list)) return Response.json({ error: "bad playlist" }, { status: 400 });
          try {
            const playlist = await loadPlaylist(list);
            if (!playlist.items.length) return Response.json({ error: "not found" }, { status: 404 });
            return Response.json(playlist);
          } catch {
            return Response.json({ error: "lookup failed" }, { status: 502 });
          }
        }
        const id = url.searchParams.get("v") ?? "";
        if (!ID.test(id)) {
          return Response.json({ error: "bad id" }, { status: 400 });
        }
        try {
          const upstream = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
            { headers: { accept: "application/json" } },
          );
          if (!upstream.ok) {
            return Response.json({ error: "not found" }, { status: 404 });
          }
          const data = (await upstream.json()) as { title?: string; author_name?: string };
          return Response.json({
            title: data.title ?? "YouTube",
            author: data.author_name ?? "",
            thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          });
        } catch {
          return Response.json({ error: "lookup failed" }, { status: 502 });
        }
      },
    },
  },
});

async function browse(body: Record<string, unknown>): Promise<Json> {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${WEB_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" } },
      ...body,
    }),
  });
  if (!res.ok) throw new Error("browse failed");
  return (await res.json()) as Json;
}

function loadPlaylist(list: string) {
  return collect(list);
}

async function collect(list: string) {
  const items: { id: string; title: string; author: string }[] = [];
  const seen = new Set<string>();
  let title = "Playlist";
  let token: string | null = null;
  let first = true;
  for (let page = 0; page < 4 && items.length < MAX_ITEMS; page++) {
    const data = first
      ? await browse({ browseId: list.startsWith("VL") ? list : `VL${list}` })
      : await browse({ continuation: token });
    first = false;
    const meta = findRecord(data, "playlistMetadataRenderer");
    if (typeof meta?.title === "string" && meta.title) title = meta.title;
    for (const item of lockups(data)) {
      if (seen.has(item.id) || items.length >= MAX_ITEMS) continue;
      seen.add(item.id);
      items.push(item);
    }
    token = continuation(data);
    if (!token) break;
  }
  return { title, items };
}

function lockups(node: Json): { id: string; title: string; author: string }[] {
  const out: { id: string; title: string; author: string }[] = [];
  walk(node, (record) => {
    const vm = record.lockupViewModel;
    if (!vm || typeof vm !== "object" || Array.isArray(vm)) return;
    const id = (vm as Record<string, unknown>).contentId;
    if (typeof id !== "string" || !ID.test(id)) return;
    const metadata = nested(nested(vm, "metadata"), "lockupMetadataViewModel");
    const title = typeof nested(metadata, "title")?.content === "string" ? String(nested(metadata, "title")?.content) : "YouTube";
    const author = firstAuthor(metadata);
    out.push({ id, title, author });
  });
  return out;
}

function continuation(node: Json): string | null {
  let token: string | null = null;
  walk(node, (record) => {
    const cmd = record.continuationCommand;
    if (!cmd || typeof cmd !== "object" || Array.isArray(cmd)) return;
    const next = (cmd as Record<string, unknown>).token;
    if (typeof next === "string" && next.length > (token?.length ?? 0)) token = next;
  });
  return token;
}

function firstAuthor(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  const texts: string[] = [];
  walk(metadata.metadata as Json, (record) => {
    if (typeof record.content === "string") texts.push(record.content);
  });
  return texts.find((text) => text && !/views|ago|watching/i.test(text)) ?? "";
}

function nested(node: unknown, key: string): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const value = (node as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function findRecord(node: Json, key: string): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  walk(node, (record) => {
    const value = record[key];
    if (!found && value && typeof value === "object" && !Array.isArray(value)) found = value as Record<string, unknown>;
  });
  return found;
}

function walk(node: Json, visit: (record: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item as Json, visit);
    return;
  }
  visit(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walk(value as Json, visit);
  }
}
