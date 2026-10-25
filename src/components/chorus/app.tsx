import { useEffect, useRef, useState, type FormEvent } from "react";
import { AudioLines, Pause, Play, Share2 } from "lucide-react";
import { markGesture } from "@/lib/chorus/audio";
import { cleanName, formatTime, makePeerId, makeRoomCode } from "@/lib/chorus/protocol";
import { useChorus, type ChorusView, type Speaker } from "@/lib/chorus/use-chorus";

type Session = {
  role: "host" | "guest";
  room: string;
  name: string;
  selfId: string;
  key: number;
};

const SESSION_KEY = "chorus-session";

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Session>;
    if (!data || (data.role !== "host" && data.role !== "guest")) return null;
    if (!data.room || !data.selfId || !data.name) return null;
    return {
      role: data.role,
      room: data.room,
      name: data.name,
      selfId: data.selfId,
      key: data.key || 1,
    };
  } catch {
    return null;
  }
}

function writeSession(next: Session | null) {
  try {
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode */
  }
}

export function ChorusApp({
  initialRoom,
  onRoom,
}: {
  initialRoom: string;
  onRoom: (room: string) => void;
}) {
  const [name, setName] = useState("Phone");
  const [code, setCode] = useState(initialRoom);
  const [joining, setJoining] = useState(Boolean(initialRoom));
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const savedName = localStorage.getItem("chorus-name");
    if (savedName) setName(savedName);
    const saved = readSession();
    if (saved) setSession(saved);
  }, []);

  function remember(next: string) {
    setName(next);
    try {
      localStorage.setItem("chorus-name", next);
    } catch {
      /* ignore */
    }
  }

  function start(role: "host" | "guest", room: string) {
    markGesture();
    const next: Session = { role, room, name: cleanName(name), selfId: makePeerId(), key: 1 };
    writeSession(next);
    setSession(next);
    onRoom(room);
  }

  if (session) {
    return (
      <Room
        key={`${session.key}-${session.selfId}`}
        session={session}
        onLeave={() => {
          writeSession(null);
          onRoom("");
          setSession(null);
          setJoining(false);
        }}
        onRetry={() =>
          setSession((current) => {
            if (!current) return current;
            const next = { ...current, selfId: makePeerId(), key: current.key + 1 };
            writeSession(next);
            return next;
          })
        }
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <p className="text-xs font-medium tracking-widest text-brass uppercase">Speaker mesh</p>
      <div className="mt-4 flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-brass text-bg">
          <AudioLines className="size-5" aria-hidden="true" />
        </span>
        <h1 className="font-display text-4xl leading-none font-medium italic text-fg">ChorusTogether</h1>
      </div>
      <p className="mt-4 max-w-xs text-lg leading-snug text-fg/80">One song, every phone in the room.</p>

      <label className="mt-8 block text-sm text-muted" htmlFor="device-name">
        Name on this phone
      </label>
      <input
        id="device-name"
        className="mt-2 min-h-12 w-full rounded-2xl bg-surface px-4 text-base text-fg ring-1 ring-fg/15 outline-none placeholder:text-muted"
        value={name}
        maxLength={24}
        autoComplete="nickname"
        onChange={(event) => remember(event.target.value)}
      />

      {joining ? (
        <form
          className="mt-6"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
            if (room.length < 4) return;
            start("guest", room);
          }}
        >
          <label className="text-sm text-muted" htmlFor="room-code">
            Room code
          </label>
          <input
            id="room-code"
            className="mt-2 min-h-14 w-full rounded-2xl bg-surface text-center font-display text-3xl tracking-widest text-fg uppercase ring-1 ring-fg/15 outline-none"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          />
          <button
            type="submit"
            className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg disabled:opacity-40"
            disabled={code.length < 4}
          >
            Join the room
          </button>
          <button type="button" className="mt-3 min-h-11 w-full text-sm text-muted" onClick={() => setJoining(false)}>
            Back
          </button>
        </form>
      ) : (
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg"
            onClick={() => start("host", makeRoomCode())}
          >
            Host a room
          </button>
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-surface px-5 text-base font-medium text-fg ring-1 ring-fg/15"
            onClick={() => setJoining(true)}
          >
            Join with a code
          </button>
        </div>
      )}

      <ol className="mt-auto space-y-4 pt-12 text-sm leading-relaxed text-muted">
        <li className="flex gap-3">
          <span className="font-display text-base text-brass">1</span>
          Share a hotspot, or join the same Wi-Fi. A moment of mobile data lets the phones find each other.
        </li>
        <li className="flex gap-3">
          <span className="font-display text-base text-brass">2</span>
          The host picks the song. A file on their phone is sent as audio — guests never open a video.
        </li>
        <li className="flex gap-3">
          <span className="font-display text-base text-brass">3</span>
          Everyone else enters the code and taps once so the sound is allowed to play.
        </li>
      </ol>
    </main>
  );
}

function Room({ session, onLeave, onRetry }: { session: Session; onLeave: () => void; onRetry: () => void }) {
  const chorus = useChorus(session);
  const { view } = chorus;
  const [source, setSource] = useState<"library" | "youtube">("library");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrub, setScrub] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = scrubbing ? scrub : view.position;

  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", session.room);
    const text = `Join my ChorusTogether room ${session.room}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "ChorusTogether", text, url: url.toString() });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">{session.role === "host" ? "Host" : "Speaker"}</p>
          <p className="font-display text-3xl tracking-widest text-fg">{session.room}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-brass"
            onClick={() => void share()}
          >
            <Share2 className="size-4" aria-hidden="true" />
            {copied ? "Copied" : "Share"}
          </button>
          <button type="button" className="min-h-11 px-3 text-sm text-muted" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <section className={view.track?.source === "youtube" ? "mt-48 flex flex-col items-center" : "mt-6 flex flex-col items-center"} aria-live="polite">
        <Vinyl track={view.track} playing={view.playing && !view.hostGone} />
        <h1 className="mt-5 max-w-full truncate text-center font-display text-3xl text-fg">
          {view.track?.name ?? (session.role === "host" ? "Pick a song" : "Waiting for the host")}
        </h1>
        <p className="mt-1 text-center text-sm text-muted">
          {view.track ? sourceLabel(view.track) : "Library songs stay audio-only on every phone."}
        </p>
        <p className="mt-2 text-center text-sm text-brass">{view.hostGone ? "The host left" : syncLabel(view, session.role)}</p>
      </section>

      <div className="mt-5">
        {session.role === "host" && view.duration > 0 ? (
          <input
            className="fader"
            type="range"
            min={0}
            max={view.duration}
            step={0.01}
            value={Math.min(shown, view.duration)}
            aria-label="Song position"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setScrub(view.position);
              setScrubbing(true);
              chorus.setScrubbing(true);
            }}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (scrubbing) setScrub(next);
              else chorus.seek(next);
            }}
            onPointerUp={(event) => {
              const next = Number(event.currentTarget.value);
              setScrubbing(false);
              chorus.setScrubbing(false);
              chorus.seek(next);
            }}
          />
        ) : (
          <div
            className="meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(view.duration)}
            aria-valuenow={Math.round(shown)}
            aria-label="Song position"
          >
            <span style={{ width: view.duration > 0 ? `${Math.min(100, (shown / view.duration) * 100)}%` : "0%" }} />
          </div>
        )}
        <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
          <span>{formatTime(shown)}</span>
          <span>{formatTime(view.duration)}</span>
        </div>
      </div>

      {session.role === "host" ? (
        <button
          type="button"
          className="mx-auto mt-4 grid size-16 place-items-center rounded-full bg-brass text-bg disabled:opacity-40"
          aria-label={view.playing ? "Pause" : "Play"}
          disabled={!view.track}
          onClick={() => chorus.toggle()}
        >
          {view.playing ? <Pause className="size-7" /> : <Play className="size-7 translate-x-0.5" />}
        </button>
      ) : null}

      {view.needsTap && !view.hostGone ? (
        <button
          type="button"
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg"
          onClick={() => chorus.resume()}
        >
          Tap to start sound
        </button>
      ) : null}

      {view.hostGone ? (
        <button
          type="button"
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-surface text-fg ring-1 ring-fg/15"
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}

      {view.error ? <p className="mt-4 text-center text-sm text-warn">{view.error}</p> : null}
      {!view.signaling && !view.error ? <p className="mt-4 text-center text-sm text-muted">Finding the other phones…</p> : null}

      {session.role === "host" ? (
        <section className="mt-6">
          <div className="grid grid-cols-2 gap-2 rounded-full bg-surface p-1 ring-1 ring-fg/10">
            <button
              type="button"
              className={tabClass(source === "library")}
              onClick={() => setSource("library")}
            >
              Library
            </button>
            <button
              type="button"
              className={tabClass(source === "youtube")}
              onClick={() => setSource("youtube")}
            >
              YouTube
            </button>
          </div>
          {source === "library" ? (
            <div
              className="mt-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void chorus.loadFile(file);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void chorus.loadFile(file);
                }}
              />
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg"
                onClick={() => fileRef.current?.click()}
              >
                Choose a song
              </button>
              <button
                type="button"
                className="mt-2 flex min-h-12 w-full items-center justify-center rounded-full bg-surface px-5 text-base text-fg ring-1 ring-fg/15"
                onClick={() => void chorus.loadDemo()}
              >
                Play the demo loop
              </button>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                The file goes from this phone to the others. They play sound only — no video, and they don't download it again from the internet. MP3, M4A, AAC, WAV, or OGG, up to 18 MB.
              </p>
            </div>
          ) : (
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void chorus.loadYouTube(link);
              }}
            >
              <input
                className="min-h-12 w-full rounded-2xl bg-surface px-4 text-base text-fg ring-1 ring-fg/15 outline-none placeholder:text-muted"
                placeholder="Paste a YouTube link or playlist"
                value={link}
                inputMode="url"
                onChange={(event) => setLink(event.target.value)}
                aria-label="YouTube link"
              />
              <button
                type="submit"
                className="mt-2 flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg disabled:opacity-40"
                disabled={!link.trim()}
              >
                Play this link
              </button>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                A video or a playlist both work. The picture stays on screen because YouTube will not play sound from a hidden player. Everyone stays locked to you, and a playlist moves on by itself.
              </p>
            </form>
          )}
        </section>
      ) : (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          The host chooses the song. Your volume stays on this phone. Nudge the echo trim if you hear a slap-back.
        </p>
      )}

      <label className="mt-6 text-sm text-muted" htmlFor="volume">
        Volume on this phone
      </label>
      <input
        id="volume"
        className="fader"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={view.volume}
        aria-label="Volume on this phone"
        onChange={(event) => chorus.setVolume(Number(event.target.value))}
      />

      {session.role === "guest" ? (
        <>
          <div className="mt-1 flex items-baseline justify-between">
            <label className="text-sm text-muted" htmlFor="trim">
              Echo trim
            </label>
            <span className="text-sm text-fg tabular-nums">
              {view.trim === 0 ? "0 ms" : `${view.trim > 0 ? "+" : "−"}${Math.abs(Math.round(view.trim * 1000))} ms`}
            </span>
          </div>
          <input
            id="trim"
            className="fader"
            type="range"
            min={-0.15}
            max={0.15}
            step={0.005}
            value={view.trim}
            aria-label="Echo trim"
            onChange={(event) => chorus.setTrim(Number(event.target.value))}
          />
        </>
      ) : null}

      <section className="mt-4 mb-2">
        <h2 className="text-sm text-muted">Phones</h2>
        <ul className="mt-2 divide-y divide-fg/10">
          <li className="flex items-center justify-between gap-3 py-3">
            <span className="truncate text-base text-fg">{session.name}</span>
            <span className="shrink-0 text-sm text-brass">This phone</span>
          </li>
          {view.speakers.length === 0 ? (
            <li className="py-3 text-sm text-muted">
              {session.role === "host" ? "Waiting for other phones to join this code." : "No other phones yet."}
            </li>
          ) : (
            view.speakers.map((speaker) => <SpeakerRow key={speaker.id} speaker={speaker} />)
          )}
        </ul>
        {!view.signaling ? (
          <button type="button" className="mt-2 min-h-11 text-sm text-brass" onClick={onRetry}>
            Retry connection
          </button>
        ) : null}
      </section>
    </main>
  );
}

function SpeakerRow({ speaker }: { speaker: Speaker }) {
  const sending = speaker.progress !== null && speaker.progress < 1;
  const ready = speaker.progress === 1;
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block truncate text-base text-fg">{speaker.name || "Phone"}</span>
        <span className="block text-sm text-muted">
          {sending ? `Sending the song · ${Math.round((speaker.progress ?? 0) * 100)}%` : ready ? "Has the song" : speaker.detail}
        </span>
      </span>
      <span className={speaker.state === "failed" ? "text-sm text-warn" : "text-sm text-muted"}>
        {speaker.state === "connected" ? "Live" : speaker.state === "failed" ? "No link" : "…"}
      </span>
    </li>
  );
}

function Vinyl({ track, playing }: { track: ChorusView["track"]; playing: boolean }) {
  const [artOk, setArtOk] = useState(true);
  useEffect(() => setArtOk(true), [track?.thumb]);
  const letter = (track?.name ?? "ChorusTogether").trim().charAt(0).toUpperCase() || "C";
  return (
    <div className="relative">
      <div className={playing ? "vinyl is-on" : "vinyl"}>
        <div className="vinyl-core">
          {track?.thumb && artOk ? <img src={track.thumb} alt="" onError={() => setArtOk(false)} /> : letter}
        </div>
      </div>
    </div>
  );
}

function sourceLabel(track: NonNullable<ChorusView["track"]>): string {
  if (track.source === "youtube") {
    const place =
      track.playlistCount && track.playlistCount > 1 && track.playlistIndex !== undefined
        ? `${track.playlistIndex + 1} of ${track.playlistCount}`
        : "";
    const who = track.author ? `YouTube · ${track.author}` : "YouTube";
    return place ? `${who} · ${place}` : who;
  }
  if (track.source === "demo") return "Built-in loop";
  return "From the host's library";
}

function syncLabel(view: ChorusView, role: "host" | "guest"): string {
  if (role === "host") {
    if (!view.track) return "Choose a file or a YouTube link or playlist";
    return view.playing ? "Leading the room" : "Paused";
  }
  if (!view.clockReady) return "Locking time…";
  if (view.track?.source !== "youtube" && view.transfer !== null && view.transfer < 1) {
    return `Getting the song · ${Math.round(view.transfer * 100)}%`;
  }
  if (!view.track) return "Waiting for a song";
  if (view.syncMs === null) return view.playing ? "Starting…" : "Ready";
  const gap = Math.abs(view.syncMs);
  if (gap < 45) return `In sync · ${gap} ms`;
  if (gap < 140) return `Close · ${gap} ms`;
  return "Catching up";
}

function tabClass(active: boolean): string {
  return active
    ? "min-h-11 rounded-full bg-brass text-sm font-semibold text-bg"
    : "min-h-11 rounded-full text-sm text-muted";
}
