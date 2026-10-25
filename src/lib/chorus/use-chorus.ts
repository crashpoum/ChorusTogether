import { useEffect, useRef, useState } from "react";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import { hasGesture, markGesture, sharedAudio } from "./audio";
import { b64ToBytes, concatBytes, isAudioFile, mimeFor, readDuration, sha256, sliceB64, toArrayBuffer } from "./codec";
import { makeDemoWav } from "./demo-wav";
import {
  CHUNK_BYTES,
  MAX_BYTES,
  isWire,
  type TrackMeta,
  type Transport,
  type Wire,
} from "./protocol";
import { bestOffset, clockSample, driftCommand, pushSample, targetPosition, type ClockSample } from "./sync";
import { createYouTubePlayer, fetchYouTubeMeta, fetchYouTubePlaylist, loadYouTubeApi, parseYouTubeLink, type PlaylistItem, type YTPlayer } from "./youtube";

const STALL = "Still looking for the room. Phones need a moment of data — a hotspot with mobile data is enough.";
const WINDOW = 3;

export type Speaker = {
  id: string;
  name: string;
  state: string;
  detail: string;
  progress: number | null;
};

export type ChorusView = {
  signaling: boolean;
  hostGone: boolean;
  track: TrackMeta | null;
  playing: boolean;
  duration: number;
  position: number;
  transfer: number | null;
  syncMs: number | null;
  clockReady: boolean;
  needsTap: boolean;
  error: string | null;
  speakers: Speaker[];
  volume: number;
  trim: number;
};

type Job = {
  id: string;
  n: number;
  next: number;
  inflight: Map<number, number>;
  acked: Set<number>;
  done: boolean;
};

type Incoming = { id: string; n: number; parts: Map<number, Uint8Array> };

type Model = {
  dead: boolean;
  role: "host" | "guest";
  name: string;
  p2p: P2PRoom | null;
  peers: PeerInfo[];
  names: Map<string, string>;
  readyPeers: Set<string>;
  hostId: string | null;
  sawHost: boolean;
  welcomed: boolean;
  signaling: boolean;
  hostGone: boolean;
  track: TrackMeta | null;
  buffer: ArrayBuffer | null;
  blobUrl: string | null;
  have: Set<string>;
  jobs: Map<string, Job>;
  incoming: Incoming | null;
  playing: boolean;
  seq: number;
  lastSeq: number;
  anchor: Transport | null;
  samples: ClockSample[];
  offset: number;
  clockReady: boolean;
  clkN: number;
  volume: number;
  trim: number;
  scrubbing: boolean;
  syncMs: number | null;
  needsTap: boolean;
  error: string | null;
  yt: YTPlayer | null;
  ytEl: HTMLDivElement | null;
  ytReady: boolean;
  ytCreating: boolean;
  videoReady: string | null;
  pendingPlay: boolean;
  lastYtSeek: number;
  finishing: boolean;
  queue: PlaylistItem[] | null;
  queueIndex: number;
  queueTitle: string;
  skipEndUntil: number;
};

function stored(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  } catch {
    return fallback;
  }
}

function pathDetail(peer: PeerInfo): string {
  if (peer.connectionState === "connected") {
    if (peer.candidateType === "host") return "On this network";
    if (peer.candidateType === "relay") return "Relayed";
    return "Connected";
  }
  if (peer.connectionState === "failed") return "Can't reach — same Wi-Fi?";
  if (peer.connectionState === "disconnected") return "Reconnecting";
  return "Connecting";
}

export function useChorus(opts: { role: "host" | "guest"; room: string; name: string; selfId: string }) {
  const modelRef = useRef<Model | null>(null);
  if (!modelRef.current) {
    modelRef.current = {
      dead: false,
      role: opts.role,
      name: opts.name,
      p2p: null,
      peers: [],
      names: new Map(),
      readyPeers: new Set(),
      hostId: null,
      sawHost: false,
      welcomed: false,
      signaling: false,
      hostGone: false,
      track: null,
      buffer: null,
      blobUrl: null,
      have: new Set(),
      jobs: new Map(),
      incoming: null,
      playing: false,
      seq: 0,
      lastSeq: 0,
      anchor: null,
      samples: [],
      offset: 0,
      clockReady: false,
      clkN: 0,
      volume: stored("chorus-volume", 0.9, 0, 1),
      trim: stored("chorus-trim", 0, -0.15, 0.15),
      scrubbing: false,
      syncMs: null,
      needsTap: false,
      error: null,
      yt: null,
      ytEl: null,
      ytReady: false,
      ytCreating: false,
      videoReady: null,
      pendingPlay: false,
      lastYtSeek: 0,
      finishing: false,
      queue: null,
      queueIndex: 0,
      queueTitle: "",
      skipEndUntil: 0,
    };
  }
  const model = modelRef.current;
  model.role = opts.role;
  model.name = opts.name;

  const [view, setView] = useState<ChorusView>(() => ({
    signaling: false,
    hostGone: false,
    track: null,
    playing: false,
    duration: 0,
    position: 0,
    transfer: null,
    syncMs: null,
    clockReady: false,
    needsTap: false,
    error: null,
    speakers: [],
    volume: model.volume,
    trim: model.trim,
  }));

  const viewRef = useRef(view);
  viewRef.current = view;

  function guestProgress(): number | null {
    const track = model.track;
    if (!track || track.source === "youtube") return null;
    if (model.have.has(track.id)) return 1;
    const incoming = model.incoming;
    if (!incoming || incoming.id !== track.id || incoming.n === 0) return 0;
    return incoming.parts.size / incoming.n;
  }

  function jobProgress(id: string): number | null {
    const job = model.jobs.get(id);
    if (!job || job.id !== model.track?.id) return model.track?.source === "youtube" ? null : null;
    if (job.done || job.n === 0) return 1;
    return job.acked.size / job.n;
  }

  function buildSpeakers(): Speaker[] {
    return model.peers.map((peer) => ({
      id: peer.id,
      name: model.names.get(peer.id) || peer.name || "Phone",
      state: peer.connectionState,
      detail: pathDetail(peer),
      progress: model.role === "host" ? jobProgress(peer.id) : null,
    }));
  }

  function commit(patch: Partial<ChorusView>) {
    if (model.dead) return;
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next;
    setView(next);
  }

  function publish() {
    commit({
      signaling: model.signaling,
      hostGone: model.hostGone,
      track: model.track,
      playing: model.playing,
      duration: currentDuration(),
      position: model.scrubbing ? viewRef.current.position : readPosition(),
      transfer: model.role === "guest" ? guestProgress() : null,
      syncMs: model.syncMs,
      clockReady: model.role === "host" || model.clockReady,
      needsTap: model.needsTap,
      error: model.error,
      speakers: buildSpeakers(),
      volume: model.volume,
      trim: model.trim,
    });
  }

  function readPosition(): number {
    if (model.track?.source === "youtube" && model.yt && model.ytReady) {
      try {
        return model.yt.getCurrentTime() || 0;
      } catch {
        return 0;
      }
    }
    const audio = sharedAudio();
    return Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  }

  function currentDuration(): number {
    if (model.track?.source === "youtube" && model.yt && model.ytReady) {
      try {
        const d = model.yt.getDuration();
        if (d > 0) return d;
      } catch {
        /* player not ready */
      }
    }
    const fromTag = sharedAudio().duration;
    if (model.track?.source !== "youtube" && Number.isFinite(fromTag) && fromTag > 0) return fromTag;
    return model.track?.duration ?? 0;
  }

  function snapshot(playing = model.playing, position?: number): Transport {
    const transport: Transport = {
      seq: ++model.seq,
      trackId: model.track?.id ?? null,
      playing,
      position: position ?? readPosition(),
      hostTime: performance.now(),
    };
    return transport;
  }

  function emit(transport: Transport) {
    const msg: Wire = { t: "state", transport, track: model.track };
    model.p2p?.send(msg);
    model.p2p?.broadcast(msg);
  }

  function noteHost(from: string): boolean {
    if (!model.hostId) model.hostId = from;
    return from === model.hostId;
  }

  function stopElement() {
    const audio = sharedAudio();
    audio.pause();
    try {
      model.yt?.pauseVideo();
    } catch {
      /* not ready */
    }
  }

  function kickYouTube(player: YTPlayer) {
    try {
      player.unMute();
      player.setVolume(Math.round(model.volume * 100));
      player.playVideo();
    } catch {
      model.needsTap = true;
      model.playing = false;
      model.pendingPlay = false;
      publish();
      return;
    }
    window.setTimeout(() => {
      if (model.dead || model.track?.source !== "youtube" || !model.pendingPlay) return;
      let state = -1;
      let at = 0;
      try {
        state = player.getPlayerState();
        at = player.getCurrentTime() || 0;
      } catch {
        state = -1;
      }
      if ((state === 1 || state === 3) && at > 0.2) {
        model.needsTap = false;
        publish();
        return;
      }
      model.playing = false;
      model.pendingPlay = false;
      model.needsTap = true;
      emit(snapshot(false));
      publish();
    }, 1500);
  }

  function finishYouTube() {
    model.playing = false;
    model.pendingPlay = false;
    emit(snapshot(false));
    publish();
  }

  function youtubeTrack(item: PlaylistItem, index: number, count: number, playlistTitle: string): TrackMeta {
    const track: TrackMeta = {
      id: `yt-${item.id}`,
      name: item.title || "YouTube",
      mime: "",
      bytes: 0,
      duration: 0,
      hash: item.id,
      source: "youtube",
      videoId: item.id,
      author: item.author,
      thumb: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    };
    if (count > 1) {
      track.playlistTitle = playlistTitle;
      track.playlistIndex = index;
      track.playlistCount = count;
    }
    return track;
  }

  function advanceQueue(): boolean {
    const queue = model.queue;
    if (!queue || model.queueIndex + 1 >= queue.length) return false;
    model.queueIndex += 1;
    const item = queue[model.queueIndex];
    if (!item) return false;
    model.track = youtubeTrack(item, model.queueIndex, queue.length, model.queueTitle);
    model.playing = true;
    model.pendingPlay = true;
    model.error = null;
    model.skipEndUntil = performance.now() + 1600;
    void ensurePlayer(item.id);
    emit(snapshot(true, 0));
    publish();
    return true;
  }

  async function ensurePlayer(videoId: string) {
    model.videoReady = videoId;
    if (model.ytEl) model.ytEl.style.display = "block";
    try {
      await loadYouTubeApi();
    } catch {
      model.error = "YouTube didn't load. Check the connection and try the link again.";
      publish();
      return;
    }
    if (model.dead) return;
    if (!model.ytEl) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    if (model.dead || !model.ytEl) return;
    if (model.yt && model.ytReady) {
      try {
        model.skipEndUntil = performance.now() + 1200;
        if (model.pendingPlay && model.role === "host") {
          model.yt.loadVideoById(videoId);
          model.yt.setPlaybackQuality("small");
          kickYouTube(model.yt);
        } else {
          model.yt.cueVideoById(videoId);
          model.yt.setPlaybackQuality("small");
        }
      } catch {
        model.error = "Couldn't open that video.";
        publish();
      }
      return;
    }
    if (model.ytCreating) return;
    model.ytCreating = true;
    try {
      model.yt = createYouTubePlayer(model.ytEl, videoId, {
        onReady: (player) => {
          model.yt = player;
          model.ytReady = true;
          try {
            player.setPlaybackQuality("small");
            player.setVolume(Math.round(model.volume * 100));
          } catch {
            /* ignore */
          }
          if (model.role === "host" && model.pendingPlay) {
            try {
              const wanted = model.videoReady;
              if (wanted && wanted !== videoId) player.loadVideoById(wanted);
              kickYouTube(player);
            } catch {
              model.needsTap = true;
              model.playing = false;
              model.pendingPlay = false;
            }
          } else if (hasGesture()) {
            primePlayer(player);
          }
          publish();
        },
        onState: (state) => {
          if (model.role !== "host" || model.track?.source !== "youtube") return;
          if (state === 1) {
            model.playing = true;
            model.pendingPlay = true;
            model.needsTap = false;
            publish();
            return;
          }
          if (state !== 0) return;
          try {
            const at = model.yt?.getCurrentTime() ?? 0;
            const length = model.yt?.getDuration() ?? 0;
            if (length > 1 && at < 1) return;
          } catch {
            return;
          }
          const wait = model.skipEndUntil - performance.now();
          if (wait > 0) {
            window.setTimeout(() => {
              if (model.dead || model.track?.source !== "youtube") return;
              let ended = false;
              try {
                ended = model.yt?.getPlayerState() === 0 && (model.yt.getCurrentTime() ?? 0) > 1;
              } catch {
                ended = false;
              }
              if (!ended) return;
              if (!advanceQueue()) finishYouTube();
            }, wait + 40);
            return;
          }
          if (!advanceQueue()) finishYouTube();
        },
        onError: () => {
          if (performance.now() < model.skipEndUntil) return;
          if (model.role === "host" && model.queue && advanceQueue()) return;
          model.playing = false;
          model.pendingPlay = false;
          model.error = "YouTube won't play that one here. Try another link, or a file from this phone.";
          publish();
        },
      });
    } catch {
      model.error = "YouTube didn't start.";
      publish();
    } finally {
      model.ytCreating = false;
    }
  }

  function primePlayer(player: YTPlayer) {
    try {
      player.mute();
      player.playVideo();
    } catch {
      return;
    }
    window.setTimeout(() => {
      if (model.dead) return;
      try {
        player.unMute();
        player.setVolume(Math.round(model.volume * 100));
        if (model.role === "host" && model.playing) return;
        if (model.anchor?.playing) {
          player.playVideo();
          return;
        }
        player.pauseVideo();
      } catch {
        /* player replaced */
      }
    }, 280);
  }

  function startJob(peerId: string) {
    const track = model.track;
    const buffer = model.buffer;
    if (!track || !buffer || track.source === "youtube") return;
    const n = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_BYTES));
    const job: Job = { id: track.id, n, next: 0, inflight: new Map(), acked: new Set(), done: false };
    model.jobs.set(peerId, job);
    model.p2p?.send({ t: "begin", track, chunks: n }, peerId);
    pump(peerId);
  }

  function pump(peerId: string) {
    const job = model.jobs.get(peerId);
    const buffer = model.buffer;
    const p2p = model.p2p;
    if (!job || !buffer || !p2p || job.done || model.track?.id !== job.id) return;
    while (job.inflight.size < WINDOW && job.next < job.n) {
      const i = job.next;
      job.next += 1;
      p2p.send({ t: "chunk", id: job.id, i, n: job.n, d: sliceB64(buffer, i) }, peerId);
      job.inflight.set(i, performance.now());
    }
  }

  function retransmit() {
    const buffer = model.buffer;
    const p2p = model.p2p;
    if (!buffer || !p2p) return;
    const now = performance.now();
    for (const [peerId, job] of model.jobs) {
      if (job.done || model.track?.id !== job.id) continue;
      for (const [i, sent] of job.inflight) {
        if (now - sent < 900) continue;
        p2p.send({ t: "chunk", id: job.id, i, n: job.n, d: sliceB64(buffer, i) }, peerId);
        job.inflight.set(i, now);
      }
      pump(peerId);
    }
  }

  async function finishIncoming() {
    const incoming = model.incoming;
    const track = model.track;
    if (!incoming || !track || incoming.id !== track.id || model.finishing) return;
    if (incoming.parts.size < incoming.n) return;
    model.finishing = true;
    const parts: Uint8Array[] = [];
    for (let i = 0; i < incoming.n; i += 1) {
      const part = incoming.parts.get(i);
      if (!part) {
        model.finishing = false;
        return;
      }
      parts.push(part);
    }
    const bytes = concatBytes(parts);
    const hash = await sha256(bytes);
    if (model.dead || model.track?.id !== track.id) {
      model.finishing = false;
      return;
    }
    if (hash !== track.hash) {
      model.incoming = null;
      model.finishing = false;
      model.error = "The song arrived damaged. Ask the host to play it again.";
      model.p2p?.send({ t: "need", id: track.id }, model.hostId ?? undefined);
      publish();
      return;
    }
    model.have.add(track.id);
    model.incoming = null;
    model.finishing = false;
    await attachLocal(toArrayBuffer(bytes), track, false);
    model.p2p?.send({ t: "have", id: track.id }, model.hostId ?? undefined);
    publish();
  }

  async function attachLocal(buffer: ArrayBuffer, track: TrackMeta, playNow: boolean) {
    if (model.blobUrl) URL.revokeObjectURL(model.blobUrl);
    const url = URL.createObjectURL(new Blob([buffer], { type: track.mime || "audio/mpeg" }));
    model.blobUrl = url;
    model.buffer = buffer;
    model.track = track;
    const audio = sharedAudio();
    audio.volume = model.volume;
    audio.loop = track.source === "demo";
    audio.src = url;
    try {
      model.yt?.pauseVideo();
    } catch {
      /* ignore */
    }
    if (playNow) {
      model.playing = true;
      try {
        await audio.play();
        model.needsTap = false;
      } catch {
        model.playing = false;
        model.needsTap = true;
      }
    }
  }

  function adoptTrack(track: TrackMeta) {
    const same = model.track?.id === track.id;
    model.track = track;
    if (same) return;
    model.syncMs = null;
    if (track.source === "youtube" && track.videoId) {
      model.buffer = null;
      model.incoming = null;
      stopElement();
      void ensurePlayer(track.videoId);
      return;
    }
    if (!model.have.has(track.id)) {
      stopElement();
      if (model.incoming?.id !== track.id) model.incoming = null;
    }
  }

  function onAck(from: string, id: string, index: number) {
    const job = model.jobs.get(from);
    if (!job || job.id !== id) return;
    job.inflight.delete(index);
    job.acked.add(index);
    if (job.acked.size >= job.n) job.done = true;
    else pump(from);
  }

  function onMessage(from: string, data: unknown) {
    if (!isWire(data) || model.dead) return;
    const msg = data;
    if (model.role === "host") {
      if (msg.t === "hello") {
        model.readyPeers.add(from);
        if (msg.name) model.names.set(from, msg.name);
        model.p2p?.send({ t: "welcome" }, from);
        model.p2p?.send({ t: "state", transport: snapshot(model.playing), track: model.track }, from);
        const track = model.track;
        if (track && track.source !== "youtube" && model.buffer) {
          if (msg.have === track.id) {
            const job = model.jobs.get(from);
            if (job && job.id === track.id) job.done = true;
            else model.jobs.set(from, { id: track.id, n: 1, next: 1, inflight: new Map(), acked: new Set([0]), done: true });
          } else if (model.jobs.get(from)?.id !== track.id) {
            startJob(from);
          }
        }
        publish();
        return;
      }
      if (msg.t === "ack") {
        onAck(from, msg.id, msg.i);
        publish();
        return;
      }
      if (msg.t === "have" && msg.id === model.track?.id) {
        const job = model.jobs.get(from);
        if (job && job.id === msg.id) job.done = true;
        publish();
        return;
      }
      if (msg.t === "need" && msg.id === model.track?.id) {
        startJob(from);
        publish();
        return;
      }
      if (msg.t === "clk" && msg.tH === undefined) {
        model.p2p?.send({ t: "clk", n: msg.n, t1: msg.t1, tH: performance.now() }, from);
      }
      return;
    }

    if (msg.t === "welcome") {
      if (!noteHost(from)) return;
      model.welcomed = true;
      publish();
      return;
    }
    if (!noteHost(from) && msg.t !== "state" && msg.t !== "begin") return;
    if ((msg.t === "state" || msg.t === "begin" || msg.t === "chunk" || msg.t === "clk") && !noteHost(from)) return;

    if (msg.t === "state") {
      if (!msg.transport || typeof msg.transport.seq !== "number") return;
      if (msg.transport.seq <= model.lastSeq) return;
      model.lastSeq = msg.transport.seq;
      model.anchor = msg.transport;
      model.playing = msg.transport.playing;
      if (msg.track && typeof msg.track.id === "string") adoptTrack(msg.track);
      publish();
      return;
    }
    if (msg.t === "begin") {
      if (!msg.track || typeof msg.track.id !== "string" || !msg.chunks) return;
      adoptTrack(msg.track);
      if (model.have.has(msg.track.id)) {
        model.p2p?.send({ t: "have", id: msg.track.id }, from);
        publish();
        return;
      }
      model.incoming = { id: msg.track.id, n: msg.chunks, parts: new Map() };
      model.finishing = false;
      publish();
      return;
    }
    if (msg.t === "chunk") {
      const incoming = model.incoming;
      if (!incoming || incoming.id !== msg.id || msg.n !== incoming.n || typeof msg.d !== "string") return;
      if (msg.i < 0 || msg.i >= incoming.n) return;
      if (!incoming.parts.has(msg.i)) {
        try {
          incoming.parts.set(msg.i, b64ToBytes(msg.d));
        } catch {
          return;
        }
      }
      model.p2p?.send({ t: "ack", id: msg.id, i: msg.i }, from);
      if (incoming.parts.size >= incoming.n) void finishIncoming();
      else publish();
      return;
    }
    if (msg.t === "clk" && typeof msg.tH === "number") {
      const sample = clockSample(msg.t1, msg.tH, performance.now());
      if (!sample) return;
      model.samples = pushSample(model.samples, sample);
      const offset = bestOffset(model.samples);
      if (offset !== null) {
        model.offset = offset;
        model.clockReady = true;
      }
    }
  }

  function applyAudio(target: number, playing: boolean) {
    const audio = sharedAudio();
    if (!audio.src || audio.dataset.silent === "1") return;
    const cmd = driftCommand(audio.currentTime || 0, target, playing);
    model.syncMs = cmd.errorMs;
    audio.volume = model.volume;
    audio.playbackRate = cmd.rate;
    if (cmd.seek !== null) {
      try {
        audio.currentTime = cmd.seek;
      } catch {
        /* metadata not in yet */
      }
    }
    if (cmd.play) {
      if (audio.paused) {
        void audio.play().catch(() => {
          model.needsTap = true;
        });
      }
    } else if (!audio.paused) audio.pause();
    model.needsTap = cmd.play && audio.paused;
    model.playing = playing;
  }

  function applyYouTube(target: number, playing: boolean) {
    const player = model.yt;
    if (!player || !model.ytReady) {
      model.needsTap = playing;
      return;
    }
    let current = 0;
    try {
      current = player.getCurrentTime() || 0;
    } catch {
      return;
    }
    const cmd = driftCommand(current, target, playing);
    model.syncMs = cmd.errorMs;
    try {
      player.setVolume(Math.round(model.volume * 100));
    } catch {
      /* ignore */
    }
    const now = performance.now();
    if (cmd.seek !== null && (Math.abs(cmd.seek - current) > 1.2 || now - model.lastYtSeek > 4000)) {
      try {
        player.seekTo(Math.max(0, cmd.seek), true);
        model.lastYtSeek = now;
      } catch {
        /* ignore */
      }
    }
    try {
      const state = player.getPlayerState();
      if (cmd.play) {
        if (state !== 1 && state !== 3) player.playVideo();
      } else if (state === 1 || state === 3) player.pauseVideo();
      const after = player.getPlayerState();
      model.needsTap = cmd.play && after !== 1 && after !== 3;
    } catch {
      model.needsTap = playing;
    }
    model.playing = playing;
  }

  function tickGuest() {
    const anchor = model.anchor;
    if (!anchor || !model.clockReady || model.hostGone) return;
    const track = model.track;
    if (!track || (anchor.trackId && anchor.trackId !== track.id)) return;
    const target = targetPosition(
      anchor.position,
      anchor.hostTime,
      anchor.playing,
      performance.now(),
      model.offset,
      model.trim,
    );
    if (track.source === "youtube") applyYouTube(target, anchor.playing);
    else if (model.have.has(track.id)) applyAudio(target, anchor.playing);
  }

  useEffect(() => {
    model.dead = false;
    const audio = sharedAudio();
    audio.volume = model.volume;
    audio.onended = () => {
      if (model.dead || model.role !== "host" || model.track?.source === "youtube") return;
      model.playing = false;
      emit(snapshot(false));
      publish();
    };
    const slot = document.createElement("div");
    slot.style.cssText =
      "position:fixed;left:1rem;right:1rem;top:4.5rem;height:11rem;z-index:20;display:none;overflow:hidden;border-radius:1rem;background:#000;opacity:1;";
    document.body.appendChild(slot);
    model.ytEl = slot;

    const p2p = new P2PRoom({
      room: opts.room,
      selfId: opts.selfId,
      name: opts.name,
      onConnected: () => {
        model.signaling = true;
        if (model.error === STALL) model.error = null;
        publish();
      },
      onPeersChanged: (peers) => {
        model.peers = peers;
        if (model.role === "guest" && model.hostId) {
          if (peers.some((peer) => peer.id === model.hostId)) model.sawHost = true;
          else if (model.sawHost && !model.hostGone) {
            model.hostGone = true;
            model.playing = false;
            stopElement();
          }
        }
        publish();
      },
      onMessage: (from, data) => onMessage(from, data),
    });
    model.p2p = p2p;
    void p2p.join();

    const hello = window.setInterval(() => {
      if (model.dead) return;
      if (model.role === "guest" && !model.welcomed) {
        const haveId = model.track && model.have.has(model.track.id) ? model.track.id : null;
        p2p.send({ t: "hello", name: model.name, have: haveId });
      }
      if (model.role === "guest" && model.welcomed && model.hostId) {
        const n = ++model.clkN;
        p2p.send({ t: "clk", n, t1: performance.now() }, model.hostId);
      }
      if (model.role === "host") retransmit();
    }, 700);

    const beat = window.setInterval(() => {
      if (model.dead) return;
      if (model.role === "host") {
        if (model.track && !model.scrubbing) {
          p2p.broadcast({ t: "state", transport: snapshot(model.playing), track: model.track });
        }
      } else tickGuest();
      publish();
    }, 400);

    const stall = window.setTimeout(() => {
      if (!model.signaling && !model.dead) {
        model.error = STALL;
        publish();
      }
    }, 8000);

    return () => {
      model.dead = true;
      window.clearInterval(hello);
      window.clearInterval(beat);
      window.clearTimeout(stall);
      p2p.close();
      model.p2p = null;
      audio.pause();
      audio.onended = null;
      try {
        model.yt?.destroy();
      } catch {
        /* already gone */
      }
      model.yt = null;
      model.ytReady = false;
      slot.remove();
      model.ytEl = null;
      if (model.blobUrl) URL.revokeObjectURL(model.blobUrl);
      model.blobUrl = null;
    };
    // Room identity is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.room, opts.selfId]);

  async function loadBuffer(buffer: ArrayBuffer, partial: Omit<TrackMeta, "id" | "hash" | "bytes">) {
    model.error = null;
    if (buffer.byteLength > MAX_BYTES) {
      model.error = "That file is over 18 MB. Export a smaller one and try again.";
      publish();
      return;
    }
    const hash = await sha256(buffer);
    if (model.dead) return;
    let duration = partial.duration;
    if (!duration) duration = await readDuration(buffer, partial.mime);
    const track: TrackMeta = { ...partial, duration, hash, id: hash, bytes: buffer.byteLength };
    model.queue = null;
    if (model.ytEl) model.ytEl.style.display = "none";
    model.jobs.clear();
    model.have.add(track.id);
    await attachLocal(buffer, track, true);
    for (const peerId of model.readyPeers) startJob(peerId);
    emit(snapshot(model.playing));
    publish();
  }

  return {
    view,
    setScrubbing(value: boolean) {
      model.scrubbing = value;
    },
    toggle() {
      markGesture();
      if (model.role !== "host" || !model.track) return;
      model.playing = !model.playing;
      model.pendingPlay = model.playing;
      if (model.track.source === "youtube") {
        if (model.yt && model.ytReady) {
          try {
            if (model.playing) {
              model.yt.unMute();
              model.yt.setVolume(Math.round(model.volume * 100));
              model.yt.playVideo();
              model.needsTap = false;
            } else model.yt.pauseVideo();
          } catch {
            model.needsTap = model.playing;
          }
        }
      } else {
        const audio = sharedAudio();
        if (model.playing) {
          void audio.play().catch(() => {
            model.playing = false;
            model.needsTap = true;
            emit(snapshot(false));
            publish();
          });
        } else audio.pause();
      }
      emit(snapshot(model.playing));
      publish();
    },
    resume() {
      markGesture();
      model.needsTap = false;
      if (model.track?.source === "youtube" && model.yt && model.ytReady) {
        try {
          model.yt.unMute();
          model.yt.setVolume(Math.round(model.volume * 100));
          model.yt.playVideo();
          if (model.role === "host") {
            model.playing = true;
            model.pendingPlay = true;
            emit(snapshot(true));
          }
        } catch {
          model.needsTap = true;
        }
        publish();
        return;
      }
      const audio = sharedAudio();
      if (!audio.src || audio.dataset.silent === "1") {
        model.needsTap = true;
        publish();
        return;
      }
      void audio
        .play()
        .then(() => {
          model.needsTap = false;
          if (model.role === "host" && model.track) {
            model.playing = true;
            emit(snapshot(true));
          }
          publish();
        })
        .catch(() => {
          model.needsTap = true;
          if (model.role === "host") {
            model.playing = false;
            emit(snapshot(false));
          }
          publish();
        });
    },
    seek(seconds: number) {
      if (model.role !== "host") return;
      const t = Math.max(0, seconds);
      if (model.track?.source === "youtube" && model.yt && model.ytReady) {
        try {
          model.yt.seekTo(t, true);
        } catch {
          /* ignore */
        }
      } else {
        try {
          sharedAudio().currentTime = t;
        } catch {
          /* ignore */
        }
      }
      emit(snapshot(model.playing));
      commit({ position: t });
    },
    setVolume(value: number) {
      model.volume = Math.min(1, Math.max(0, value));
      sharedAudio().volume = model.volume;
      try {
        localStorage.setItem("chorus-volume", String(model.volume));
      } catch {
        /* ignore */
      }
      if (model.yt && model.ytReady) {
        try {
          model.yt.setVolume(Math.round(model.volume * 100));
        } catch {
          /* ignore */
        }
      }
      commit({ volume: model.volume });
    },
    setTrim(value: number) {
      model.trim = Math.min(0.15, Math.max(-0.15, value));
      try {
        localStorage.setItem("chorus-trim", String(model.trim));
      } catch {
        /* ignore */
      }
      commit({ trim: model.trim });
    },
    async loadFile(file: File) {
      markGesture();
      if (file.type.startsWith("video/")) {
        model.error = "Pick an audio file. Video isn't sent to the other phones.";
        publish();
        return;
      }
      if (!isAudioFile(file)) {
        model.error = "Use an audio file — MP3, M4A, AAC, WAV, or OGG.";
        publish();
        return;
      }
      if (file.size > MAX_BYTES) {
        model.error = "That file is over 18 MB. Export a smaller one and try again.";
        publish();
        return;
      }
      model.error = null;
      publish();
      const buffer = await file.arrayBuffer();
      await loadBuffer(buffer, {
        name: file.name.replace(/\.[^.]+$/, "") || "Song",
        mime: mimeFor(file),
        duration: 0,
        source: "file",
      });
    },
    async loadDemo() {
      markGesture();
      model.error = null;
      const buffer = makeDemoWav();
      await loadBuffer(buffer, {
        name: "ChorusTogether demo",
        mime: "audio/wav",
        duration: 8,
        source: "demo",
      });
    },
    async loadYouTube(raw: string) {
      markGesture();
      const link = parseYouTubeLink(raw);
      if (!link.videoId && !link.playlistId) {
        model.error = "Paste a YouTube link, a playlist, or a video id.";
        publish();
        return;
      }
      model.error = null;
      publish();
      let items: PlaylistItem[] | null = null;
      let playlistTitle = "";
      if (link.playlistId) {
        const playlist = await fetchYouTubePlaylist(link.playlistId);
        if (model.dead) return;
        if (playlist?.items.length) {
          items = playlist.items;
          playlistTitle = playlist.title;
        } else if (!link.videoId) {
          model.error = "Couldn't open that playlist. It may be private — try a single video.";
          publish();
          return;
        }
      }
      if (items && link.videoId && !items.some((item) => item.id === link.videoId)) {
        const meta = await fetchYouTubeMeta(link.videoId);
        if (model.dead) return;
        items = [{ id: link.videoId, title: meta?.title || "YouTube", author: meta?.author || "" }, ...items];
      }
      const index = items ? Math.max(0, items.findIndex((item) => item.id === (link.videoId ?? items[0]?.id))) : 0;
      const start = items?.[index];
      const id = start?.id ?? link.videoId;
      if (!id) {
        model.error = "Couldn't open that playlist. It may be private — try a single video.";
        publish();
        return;
      }
      let title = start?.title;
      let author = start?.author ?? "";
      if (!title) {
        const meta = await fetchYouTubeMeta(id);
        if (model.dead) return;
        title = meta?.title || "YouTube";
        author = meta?.author || "";
      }
      const count = items?.length ?? 0;
      model.queue = count > 1 ? items : null;
      model.queueIndex = index;
      model.queueTitle = playlistTitle;
      const track = youtubeTrack({ id, title: title || "YouTube", author }, index, count, playlistTitle);
      model.buffer = null;
      model.jobs.clear();
      sharedAudio().pause();
      model.track = track;
      model.playing = true;
      model.pendingPlay = true;
      await ensurePlayer(id);
      emit(snapshot(true, 0));
      publish();
    },
  };
}
