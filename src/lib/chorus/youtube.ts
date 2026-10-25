const VIDEO_ID = /^[\w-]{11}$/;
const PLAYLIST_ID = /^[\w-]{12,90}$/;

export type YouTubeLink = { videoId: string | null; playlistId: string | null };

export function parseYouTubeLink(input: string): YouTubeLink {
  const raw = input.trim();
  if (VIDEO_ID.test(raw)) return { videoId: raw, playlistId: null };
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    const list = url.searchParams.get("list");
    const playlistId = list && PLAYLIST_ID.test(list) ? list : null;
    let videoId: string | null = null;
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      if (VIDEO_ID.test(id)) videoId = id;
    } else if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const v = url.searchParams.get("v");
      if (v && VIDEO_ID.test(v)) videoId = v;
      else {
        const parts = url.pathname.split("/").filter(Boolean);
        const marker = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live" || p === "v");
        const id = marker >= 0 ? (parts[marker + 1] ?? "") : "";
        if (VIDEO_ID.test(id)) videoId = id;
      }
    } else {
      return { videoId: null, playlistId: null };
    }
    return { videoId, playlistId };
  } catch {
    return { videoId: null, playlistId: null };
  }
}

export function parseYouTubeId(input: string): string | null {
  return parseYouTubeLink(input).videoId;
}

export type YouTubeMeta = { title: string; author: string; thumb: string };

export type PlaylistItem = { id: string; title: string; author: string };

export type PlaylistMeta = { title: string; items: PlaylistItem[] };

export async function fetchYouTubeMeta(id: string): Promise<YouTubeMeta | null> {
  try {
    const res = await fetch(`/api/youtube-meta?v=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<YouTubeMeta>;
    if (!data.title) return null;
    return {
      title: data.title,
      author: data.author ?? "",
      thumb: data.thumb ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

export async function fetchYouTubePlaylist(id: string): Promise<PlaylistMeta | null> {
  try {
    const res = await fetch(`/api/youtube-meta?list=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PlaylistMeta>;
    if (!data.items?.length) return null;
    const items = data.items
      .filter((item) => item?.id && VIDEO_ID.test(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title || "YouTube",
        author: item.author || "",
      }));
    if (!items.length) return null;
    return { title: data.title || "Playlist", items };
  } catch {
    return null;
  }
}

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
  mute: () => void;
  unMute: () => void;
  setVolume: (volume: number) => void;
  setPlaybackQuality: (quality: string) => void;
  getPlayerState: () => number;
  cueVideoById: (id: string) => void;
  loadVideoById: (id: string) => void;
};

type YTPlayerEvent = { target: YTPlayer; data: number };

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          width?: string;
          height?: string;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: YTPlayerEvent) => void;
            onStateChange?: (event: YTPlayerEvent) => void;
            onError?: (event: YTPlayerEvent) => void;
          };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type { YTPlayer };

let apiPromise: Promise<void> | null = null;

export function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      const timer = window.setTimeout(() => reject(new Error("YouTube didn't load")), 12_000);
      window.onYouTubeIframeAPIReady = () => {
        window.clearTimeout(timer);
        previous?.();
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("YouTube didn't load"));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise.then(
    () => undefined,
    (error: unknown) => {
      apiPromise = null;
      throw error;
    },
  );
}

export function createYouTubePlayer(
  element: HTMLElement,
  videoId: string,
  handlers: {
    onReady: (player: YTPlayer) => void;
    onState: (state: number) => void;
    onError: () => void;
  },
): YTPlayer {
  if (!window.YT?.Player) throw new Error("YouTube isn't ready");
  return new window.YT.Player(element, {
    width: "160",
    height: "90",
    videoId,
    playerVars: {
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      origin: window.location.origin,
    },
    events: {
      onReady: (event) => handlers.onReady(event.target),
      onStateChange: (event) => handlers.onState(event.data),
      onError: () => handlers.onError(),
    },
  });
}
