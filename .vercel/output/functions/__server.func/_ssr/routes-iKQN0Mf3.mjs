import { o as __toESM } from "../_runtime.mjs";
import { J as require_react, x as require_jsx_runtime, y as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as AudioLines, i as Pause, n as Share2, r as Play } from "../_libs/lucide-react.mjs";
import { n as Route$2 } from "./router-DLNYUfoD.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-iKQN0Mf3.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
var audioEl = null;
var gestured = false;
function sharedAudio() {
	if (!audioEl) {
		const audio = new Audio();
		audio.preload = "auto";
		audio.setAttribute("playsinline", "true");
		audioEl = audio;
	}
	return audioEl;
}
/** Call inside a tap so later play() calls from the network are allowed. */
function markGesture() {
	gestured = true;
	const audio = sharedAudio();
	if (!audio.src || audio.dataset.silent === "1") {
		audio.dataset.silent = "1";
		audio.src = SILENT_WAV;
	}
	audio.play().then(() => {
		if (audio.dataset.silent === "1") {
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			delete audio.dataset.silent;
		}
	}).catch(() => {});
}
function hasGesture() {
	return gestured;
}
var CHUNK_BYTES = 9e3;
var WIRE_TYPES = /* @__PURE__ */ new Set([
	"hello",
	"welcome",
	"state",
	"begin",
	"chunk",
	"ack",
	"have",
	"need",
	"clk"
]);
function isWire(value) {
	if (!value || typeof value !== "object") return false;
	const t = value.t;
	return typeof t === "string" && WIRE_TYPES.has(t);
}
function makePeerId() {
	const bytes = /* @__PURE__ */ new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function makeRoomCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	const bytes = /* @__PURE__ */ new Uint8Array(5);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => alphabet[b % 32]).join("");
}
function cleanName(name) {
	return name.replace(/\s+/g, " ").trim().slice(0, 24) || "Phone";
}
function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
	return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
var FAST_POLL_MS = 400;
var IDLE_POLL_MS = 2e3;
var PING_INTERVAL_MS = 2e3;
var STALL_MS = 1e4;
var MAX_RECOVERY_ATTEMPTS = 3;
var SIGNAL_RETRY_DELAYS_MS = [250, 750];
function defaultIceServers() {
	return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
}
var P2PRoom = class {
	opts;
	peers = /* @__PURE__ */ new Map();
	/** Per-remote-peer signal delivery chains (order-preserving). */
	signalQueues = /* @__PURE__ */ new Map();
	cursor = 0;
	pollTimer = null;
	pingTimer = null;
	closed = false;
	everPolled = false;
	lastPeersFingerprint = "";
	constructor(opts) {
		this.opts = opts;
	}
	/**
	* The first poll IS the join: it registers this peer and returns the
	* roster. A failed first poll (cold DB, offline tab) must not strand the
	* room: the loop and timers start regardless and the next poll retries.
	*/
	async join() {
		try {
			await this.pollOnce();
		} catch {}
		if (this.closed) return;
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
		this.pingTimer = setInterval(() => {
			this.pingAll();
			this.watchdog();
		}, PING_INTERVAL_MS);
	}
	close() {
		this.closed = true;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		if (this.pingTimer) clearInterval(this.pingTimer);
		for (const slot of this.peers.values()) slot.pc.close();
		this.peers.clear();
		fetch("/api/rtc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				op: "leave",
				room: this.opts.room,
				peer: this.opts.selfId
			}),
			keepalive: true
		}).catch(() => {});
	}
	/** Send on the unreliable game-state channel (drops stale packets). */
	broadcast(data) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		for (const slot of this.peers.values()) if (slot.state?.readyState === "open") slot.state.send(wire);
	}
	/** Send reliably (ordered) to one peer, or to all when peerId is omitted. */
	send(data, peerId) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()];
		for (const slot of targets) if (slot?.reliable?.readyState === "open") slot.reliable.send(wire);
	}
	peerList() {
		return [...this.peers.values()].map((s) => ({ ...s.info }));
	}
	schedulePoll(delay) {
		if (this.closed) return;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = setTimeout(() => void this.poll(), delay);
	}
	anyPairConnecting() {
		for (const s of this.peers.values()) {
			if (s.terminal) continue;
			if (s.info.connectionState !== "connected") return true;
		}
		return false;
	}
	async pollOnce() {
		const params = new URLSearchParams({
			room: this.opts.room,
			peer: this.opts.selfId,
			name: this.opts.name ?? "",
			since: String(this.cursor)
		});
		const res = await fetch(`/api/rtc?${params}`);
		if (this.closed) return;
		if (!res.ok) throw new Error(`signaling poll failed: ${res.status}`);
		const body = await res.json();
		if (this.closed) return;
		if (!this.everPolled) {
			this.everPolled = true;
			this.opts.onConnected?.();
		}
		this.reconcileRoster(body.peers);
		const roster = new Set(body.peers.map((p) => p.id));
		for (const sig of body.signals) {
			this.cursor = Math.max(this.cursor, sig.id);
			await this.onSignal(sig.from, sig.kind, sig.payload, roster);
			if (this.closed) return;
		}
	}
	async poll() {
		if (this.closed) return;
		try {
			await this.pollOnce();
		} catch {}
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
	}
	reconcileRoster(peers) {
		const alive = new Set(peers.map((p) => p.id));
		for (const p of peers) {
			if (p.id === this.opts.selfId) continue;
			const existing = this.peers.get(p.id);
			if (existing) existing.info.name = p.name;
			else this.connectTo(p.id, p.name, this.opts.selfId > p.id);
		}
		for (const [id, slot] of this.peers) if (!alive.has(id)) {
			slot.pc.close();
			this.peers.delete(id);
		}
		this.emitPeers();
	}
	connectTo(peerId, name, initiator) {
		if (this.closed) return null;
		const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? defaultIceServers() });
		const slot = {
			pc,
			makingOffer: false,
			ignoreOffer: false,
			pendingCandidates: [],
			lastProgressAt: Date.now(),
			recoveryAttempts: 0,
			info: {
				id: peerId,
				name,
				connectionState: pc.connectionState,
				candidateType: null,
				rttMs: null
			}
		};
		this.peers.set(peerId, slot);
		pc.onicecandidate = (e) => {
			if (e.candidate) this.sendSignal(peerId, "ice", e.candidate.toJSON());
		};
		pc.onconnectionstatechange = () => {
			slot.info.connectionState = pc.connectionState;
			if (pc.connectionState === "connecting" || pc.connectionState === "connected") slot.lastProgressAt = Date.now();
			if (pc.connectionState === "connected") {
				slot.recoveryAttempts = 0;
				slot.terminal = false;
				this.readCandidateType(slot);
			}
			this.emitPeers();
			if (pc.connectionState === "failed") pc.restartIce();
			if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.schedulePoll(FAST_POLL_MS);
		};
		pc.onnegotiationneeded = async () => {
			try {
				slot.makingOffer = true;
				await pc.setLocalDescription();
				await this.sendSignal(peerId, "offer", pc.localDescription.toJSON());
			} catch {} finally {
				slot.makingOffer = false;
			}
		};
		pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);
		if (initiator) {
			this.attachChannel(slot, pc.createDataChannel("state", {
				ordered: false,
				maxRetransmits: 0
			}));
			this.attachChannel(slot, pc.createDataChannel("reliable", { ordered: true }));
		}
		return slot;
	}
	attachChannel(slot, channel) {
		if (channel.label === "state") slot.state = channel;
		else slot.reliable = channel;
		channel.onopen = () => {
			slot.lastProgressAt = Date.now();
		};
		channel.onmessage = (e) => {
			let msg;
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg.t === "ping") {
				if (slot.state?.readyState === "open") slot.state.send(JSON.stringify({ t: "pong" }));
			} else if (msg.t === "pong") {
				if (slot.pingSentAt) {
					slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
					slot.pingSentAt = void 0;
					this.emitPeers();
				}
			} else this.opts.onMessage?.(slot.info.id, msg.d, channel.label === "state" ? "state" : "reliable");
		};
	}
	/** Apply buffered ICE candidates once a remote description is in place. */
	async flushPendingCandidates(slot) {
		while (slot.pendingCandidates.length > 0) {
			const candidate = slot.pendingCandidates.shift();
			try {
				await slot.pc.addIceCandidate(candidate);
			} catch (err) {
				if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
			}
			if (this.closed) return;
		}
	}
	async onSignal(from, kind, payload, roster) {
		if (this.closed) return;
		let slot = this.peers.get(from);
		if (!slot) {
			if (!roster.has(from)) return;
			const created = this.connectTo(from, "", false);
			if (!created) return;
			slot = created;
		}
		const polite = this.opts.selfId < from;
		try {
			if (kind === "offer" || kind === "answer") {
				const description = payload;
				const collision = kind === "offer" && (slot.makingOffer || slot.pc.signalingState !== "stable");
				slot.ignoreOffer = !polite && collision;
				if (slot.ignoreOffer) return;
				try {
					await slot.pc.setRemoteDescription(description);
				} catch (err) {
					if (kind !== "offer" || slot.recreatedForOffer) throw err;
					const attempts = slot.recoveryAttempts;
					const name = slot.info.name;
					slot.pc.close();
					this.peers.delete(from);
					const fresh = this.connectTo(from, name, false);
					if (!fresh) return;
					fresh.recoveryAttempts = attempts;
					fresh.recreatedForOffer = true;
					slot = fresh;
					await slot.pc.setRemoteDescription(description);
				}
				if (this.closed) return;
				await this.flushPendingCandidates(slot);
				if (this.closed) return;
				if (kind === "offer") {
					await slot.pc.setLocalDescription();
					if (this.closed) return;
					await this.sendSignal(from, "answer", slot.pc.localDescription.toJSON());
				}
			} else if (kind === "ice") {
				const candidate = payload;
				if (!slot.pc.remoteDescription) {
					slot.pendingCandidates.push(candidate);
					return;
				}
				try {
					await slot.pc.addIceCandidate(candidate);
				} catch (err) {
					if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
				}
			}
		} catch {}
	}
	/**
	* Signals are serialized per remote peer (a candidate must never overtake
	* its SDP into the DB) and retried on failure with short backoff.
	*/
	sendSignal(to, kind, payload) {
		const next = (this.signalQueues.get(to) ?? Promise.resolve()).then(() => this.postSignal(to, kind, payload));
		this.signalQueues.set(to, next.catch(() => {}));
		return next;
	}
	async postSignal(to, kind, payload) {
		for (let attempt = 0;; attempt++) {
			if (this.closed) return;
			try {
				const res = await fetch("/api/rtc", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						op: "signal",
						room: this.opts.room,
						from: this.opts.selfId,
						to,
						kind,
						payload
					})
				});
				if (res.ok) return;
				throw new Error(`signal POST failed: ${res.status}`);
			} catch (err) {
				if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
					console.warn(`[p2p] signal ${kind} to ${to} failed after retries`, err);
					return;
				}
				await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
			}
		}
	}
	pingAll() {
		const wire = JSON.stringify({ t: "ping" });
		for (const slot of this.peers.values()) {
			if (slot.state?.readyState !== "open") continue;
			const stale = slot.pingSentAt !== void 0 && performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
			if (slot.pingSentAt === void 0 || stale) {
				slot.pingSentAt = performance.now();
				slot.state.send(wire);
			}
		}
	}
	/**
	* Stuck-pair recovery, piggybacked on the ping interval. A pair that has
	* made no progress for STALL_MS gets rebuilt by the dialer with a FRESH
	* RTCPeerConnection (new DTLS identity — fixes the suspend/resume
	* fingerprint wedge). After MAX_RECOVERY_ATTEMPTS the pair is terminal:
	* visible to the app as its last connectionState, ignored by fast-poll.
	*/
	watchdog() {
		if (this.closed) return;
		const now = Date.now();
		for (const [peerId, slot] of this.peers) {
			const live = slot.pc.connectionState;
			if (live !== slot.info.connectionState) {
				slot.info.connectionState = live;
				if (live === "connecting" || live === "connected") slot.lastProgressAt = now;
				this.emitPeers();
			}
			if (slot.terminal || live === "connected") continue;
			if (now - slot.lastProgressAt <= STALL_MS) continue;
			if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
				slot.terminal = true;
				this.emitPeers();
				continue;
			}
			slot.recoveryAttempts += 1;
			slot.lastProgressAt = now;
			if (this.opts.selfId > peerId) {
				const { name } = slot.info;
				const attempts = slot.recoveryAttempts;
				slot.pc.close();
				this.peers.delete(peerId);
				const fresh = this.connectTo(peerId, name, true);
				if (fresh) fresh.recoveryAttempts = attempts;
				this.schedulePoll(FAST_POLL_MS);
			}
		}
	}
	async readCandidateType(slot) {
		try {
			const stats = await slot.pc.getStats();
			let selected;
			stats.forEach((s) => {
				if (s.type === "candidate-pair" && s.nominated) selected = s;
			});
			const localId = selected?.localCandidateId;
			if (localId) {
				const local = stats.get(localId);
				slot.info.candidateType = local?.candidateType ?? null;
				this.emitPeers();
			}
		} catch {}
	}
	emitPeers() {
		const list = this.peerList();
		const fingerprint = JSON.stringify(list.map((p) => [
			p.id,
			p.name,
			p.connectionState,
			p.candidateType,
			p.rttMs
		]));
		if (fingerprint === this.lastPeersFingerprint) return;
		this.lastPeersFingerprint = fingerprint;
		this.opts.onPeersChanged?.(list);
	}
};
function bytesToB64(bytes) {
	let binary = "";
	const stride = 32768;
	for (let i = 0; i < bytes.length; i += stride) {
		const slice = bytes.subarray(i, Math.min(bytes.length, i + stride));
		binary += String.fromCharCode(...slice);
	}
	return btoa(binary);
}
function b64ToBytes(data) {
	const binary = atob(data);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}
function sliceB64(buffer, index) {
	const start = index * CHUNK_BYTES;
	const end = Math.min(buffer.byteLength, start + CHUNK_BYTES);
	return bytesToB64(new Uint8Array(buffer, start, end - start));
}
function concatBytes(parts) {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
function toArrayBuffer(bytes) {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}
async function sha256(data) {
	const buffer = data instanceof Uint8Array ? toArrayBuffer(data) : data;
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function readDuration(buffer, mime) {
	const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
	const audio = new Audio();
	audio.preload = "metadata";
	return new Promise((resolve) => {
		const finish = (value) => {
			URL.revokeObjectURL(url);
			resolve(value);
		};
		audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
		audio.onerror = () => finish(0);
		audio.src = url;
	});
}
var AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4)$/i;
function isAudioFile(file) {
	if (file.type.startsWith("audio/")) return true;
	if (file.type.startsWith("video/")) return false;
	return AUDIO_EXT.test(file.name);
}
function mimeFor(file) {
	if (file.type.startsWith("audio/")) return file.type;
	switch (file.name.split(".").pop()?.toLowerCase()) {
		case "mp3": return "audio/mpeg";
		case "m4a":
		case "mp4":
		case "aac": return "audio/mp4";
		case "wav": return "audio/wav";
		case "ogg":
		case "oga":
		case "opus": return "audio/ogg";
		case "flac": return "audio/flac";
		case "webm": return "audio/webm";
		default: return "audio/mpeg";
	}
}
/** Original 8-second loop used so a room can be tried with nothing on the phone. */
function encodeWav(samples, sampleRate) {
	const buffer = /* @__PURE__ */ new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const write = (offset, text) => {
		for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
	};
	write(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	write(8, "WAVE");
	write(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	write(36, "data");
	view.setUint32(40, samples.length * 2, true);
	let offset = 44;
	for (let i = 0; i < samples.length; i += 1) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
		offset += 2;
	}
	return buffer;
}
function makeDemoWav() {
	const sampleRate = 22050;
	const n = sampleRate * 8;
	const out = new Float32Array(n);
	const beat = .5;
	const bass = [
		110,
		110,
		130.81,
		110,
		98,
		98,
		110,
		146.83
	];
	for (let i = 0; i < n; i += 1) {
		const t = i / sampleRate;
		let s = 0;
		const bt = t % beat;
		if (bt < .42) {
			const kickEnv = Math.exp(-bt * 10);
			const kickF = 150 * Math.exp(-bt * 12) + 48;
			s += Math.sin(2 * Math.PI * kickF * bt) * kickEnv * .55;
		}
		const ht = (t + beat / 2) % beat;
		if (ht < .03) {
			const noise = Math.sin(2 * Math.PI * 6e3 * t) * Math.sin(2 * Math.PI * 7300 * t);
			s += noise * (1 - ht / .03) * .07;
		}
		const note = bass[Math.floor(t) % bass.length] ?? 110;
		const nt = t % 1;
		const bassEnv = Math.exp(-nt * 2.2) * (nt < .015 ? nt / .015 : 1);
		s += Math.sin(2 * Math.PI * note * t) * bassEnv * .28;
		s += Math.sin(2 * Math.PI * note * 2 * t) * bassEnv * .06;
		const stab = t % 2;
		if (stab < 1.1) {
			const env = Math.exp(-stab * 3.2) * (stab < .012 ? stab / .012 : 1);
			for (const f of [
				220,
				261.63,
				329.63
			]) s += Math.sin(2 * Math.PI * f * t) * env * .055;
		}
		out[i] = Math.tanh(s * 1.25) * .88;
	}
	const fade = Math.floor(sampleRate * .02);
	for (let i = 0; i < fade; i += 1) {
		const g = i / fade;
		out[i] = (out[i] ?? 0) * g;
		out[175959 + i] = (out[175959 + i] ?? 0) * (1 - g);
	}
	return encodeWav(out, sampleRate);
}
function clockSample(t1, tHost, t3) {
	const rtt = t3 - t1;
	if (!Number.isFinite(rtt) || rtt < 0 || rtt > 800) return null;
	return {
		rtt,
		offset: tHost - (t1 + rtt / 2)
	};
}
/** Median offset among the lowest-latency samples. */
function bestOffset(samples) {
	if (samples.length === 0) return null;
	const offsets = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4).map((s) => s.offset).sort((a, b) => a - b);
	const mid = Math.floor(offsets.length / 2);
	if (offsets.length % 2 === 1) return offsets[mid] ?? null;
	const lo = offsets[mid - 1];
	const hi = offsets[mid];
	if (lo === void 0 || hi === void 0) return null;
	return (lo + hi) / 2;
}
function pushSample(samples, next) {
	const kept = samples.length >= 8 ? samples.slice(1) : samples.slice();
	kept.push(next);
	return kept;
}
/**
* Where this phone's playhead should be.
* `trim` seconds: positive lags this speaker (use it if you hear yourself early).
*/
function targetPosition(position, hostTime, playing, now, offset, trim) {
	if (!playing) return Math.max(0, position);
	const elapsed = (now + offset - hostTime) / 1e3;
	return Math.max(0, position + elapsed - trim);
}
function driftCommand(current, target, playing) {
	const errorMs = Math.round((target - current) * 1e3);
	if (!playing) return {
		seek: Math.abs(target - current) > .05 ? target : null,
		rate: 1,
		play: false,
		errorMs
	};
	const diff = target - current;
	if (Math.abs(diff) > .12) return {
		seek: target,
		rate: 1,
		play: true,
		errorMs
	};
	return {
		seek: null,
		rate: 1 + Math.max(-.025, Math.min(.025, diff * .35)),
		play: true,
		errorMs
	};
}
function parseYouTubeId(input) {
	const raw = input.trim();
	if (/^[\w-]{11}$/.test(raw)) return raw;
	try {
		const url = new URL(raw);
		const host = url.hostname.replace(/^www\./, "");
		if (host === "youtu.be") {
			const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
			return /^[\w-]{11}$/.test(id) ? id : null;
		}
		if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
			const v = url.searchParams.get("v");
			if (v && /^[\w-]{11}$/.test(v)) return v;
			const parts = url.pathname.split("/").filter(Boolean);
			const marker = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live" || p === "v");
			const id = marker >= 0 ? parts[marker + 1] ?? "" : "";
			return /^[\w-]{11}$/.test(id) ? id : null;
		}
	} catch {
		return null;
	}
	return null;
}
async function fetchYouTubeMeta(id) {
	try {
		const res = await fetch(`/api/youtube-meta?v=${encodeURIComponent(id)}`);
		if (!res.ok) return null;
		const data = await res.json();
		if (!data.title) return null;
		return {
			title: data.title,
			author: data.author ?? "",
			thumb: data.thumb ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
		};
	} catch {
		return null;
	}
}
var apiPromise = null;
function loadYouTubeApi() {
	if (typeof window === "undefined") return Promise.resolve();
	if (window.YT?.Player) return Promise.resolve();
	if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
		const previous = window.onYouTubeIframeAPIReady;
		const timer = window.setTimeout(() => reject(/* @__PURE__ */ new Error("YouTube didn't load")), 12e3);
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
			reject(/* @__PURE__ */ new Error("YouTube didn't load"));
		};
		document.head.appendChild(script);
	});
	return apiPromise.then(() => void 0, (error) => {
		apiPromise = null;
		throw error;
	});
}
function createYouTubePlayer(element, videoId, handlers) {
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
			origin: window.location.origin
		},
		events: {
			onReady: (event) => handlers.onReady(event.target),
			onStateChange: (event) => handlers.onState(event.data),
			onError: () => handlers.onError()
		}
	});
}
var STALL = "Still looking for the room. Phones need a moment of data — a hotspot with mobile data is enough.";
var WINDOW = 3;
function stored(key, fallback, min, max) {
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
function pathDetail(peer) {
	if (peer.connectionState === "connected") {
		if (peer.candidateType === "host") return "On this network";
		if (peer.candidateType === "relay") return "Relayed";
		return "Connected";
	}
	if (peer.connectionState === "failed") return "Can't reach — same Wi-Fi?";
	if (peer.connectionState === "disconnected") return "Reconnecting";
	return "Connecting";
}
function useChorus(opts) {
	const modelRef = (0, import_react.useRef)(null);
	if (!modelRef.current) modelRef.current = {
		dead: false,
		role: opts.role,
		name: opts.name,
		p2p: null,
		peers: [],
		names: /* @__PURE__ */ new Map(),
		readyPeers: /* @__PURE__ */ new Set(),
		hostId: null,
		sawHost: false,
		welcomed: false,
		signaling: false,
		hostGone: false,
		track: null,
		buffer: null,
		blobUrl: null,
		have: /* @__PURE__ */ new Set(),
		jobs: /* @__PURE__ */ new Map(),
		incoming: null,
		playing: false,
		seq: 0,
		lastSeq: 0,
		anchor: null,
		samples: [],
		offset: 0,
		clockReady: false,
		clkN: 0,
		volume: stored("chorus-volume", .9, 0, 1),
		trim: stored("chorus-trim", 0, -.15, .15),
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
		finishing: false
	};
	const model = modelRef.current;
	model.role = opts.role;
	model.name = opts.name;
	const [view, setView] = (0, import_react.useState)(() => ({
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
		trim: model.trim
	}));
	const viewRef = (0, import_react.useRef)(view);
	viewRef.current = view;
	function guestProgress() {
		const track = model.track;
		if (!track || track.source === "youtube") return null;
		if (model.have.has(track.id)) return 1;
		const incoming = model.incoming;
		if (!incoming || incoming.id !== track.id || incoming.n === 0) return 0;
		return incoming.parts.size / incoming.n;
	}
	function jobProgress(id) {
		const job = model.jobs.get(id);
		if (!job || job.id !== model.track?.id) return model.track?.source === "youtube" ? null : null;
		if (job.done || job.n === 0) return 1;
		return job.acked.size / job.n;
	}
	function buildSpeakers() {
		return model.peers.map((peer) => ({
			id: peer.id,
			name: model.names.get(peer.id) || peer.name || "Phone",
			state: peer.connectionState,
			detail: pathDetail(peer),
			progress: model.role === "host" ? jobProgress(peer.id) : null
		}));
	}
	function commit(patch) {
		if (model.dead) return;
		const next = {
			...viewRef.current,
			...patch
		};
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
			trim: model.trim
		});
	}
	function readPosition() {
		if (model.track?.source === "youtube" && model.yt && model.ytReady) try {
			return model.yt.getCurrentTime() || 0;
		} catch {
			return 0;
		}
		const audio = sharedAudio();
		return Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
	}
	function currentDuration() {
		if (model.track?.source === "youtube" && model.yt && model.ytReady) try {
			const d = model.yt.getDuration();
			if (d > 0) return d;
		} catch {}
		const fromTag = sharedAudio().duration;
		if (model.track?.source !== "youtube" && Number.isFinite(fromTag) && fromTag > 0) return fromTag;
		return model.track?.duration ?? 0;
	}
	function snapshot(playing = model.playing) {
		return {
			seq: ++model.seq,
			trackId: model.track?.id ?? null,
			playing,
			position: readPosition(),
			hostTime: performance.now()
		};
	}
	function emit(transport) {
		const msg = {
			t: "state",
			transport,
			track: model.track
		};
		model.p2p?.send(msg);
		model.p2p?.broadcast(msg);
	}
	function noteHost(from) {
		if (!model.hostId) model.hostId = from;
		return from === model.hostId;
	}
	function stopElement() {
		sharedAudio().pause();
		try {
			model.yt?.pauseVideo();
		} catch {}
	}
	async function ensurePlayer(videoId) {
		model.videoReady = videoId;
		try {
			await loadYouTubeApi();
		} catch {
			model.error = "YouTube didn't load. Check the connection and try the link again.";
			publish();
			return;
		}
		if (model.dead || !model.ytEl) return;
		if (model.yt && model.ytReady) {
			try {
				model.yt.cueVideoById(videoId);
				model.yt.setPlaybackQuality("small");
				if (model.pendingPlay && model.role === "host") {
					model.yt.unMute();
					model.yt.setVolume(Math.round(model.volume * 100));
					model.yt.playVideo();
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
					} catch {}
					if (model.role === "host" && model.pendingPlay) try {
						player.unMute();
						player.playVideo();
					} catch {
						model.needsTap = true;
					}
					else if (hasGesture()) primePlayer(player);
					publish();
				},
				onState: (state) => {
					if (model.role === "host" && state === 0 && model.track?.source === "youtube") {
						model.playing = false;
						model.pendingPlay = false;
						emit(snapshot(false));
						publish();
					}
				},
				onError: () => {
					model.playing = false;
					model.pendingPlay = false;
					model.error = "YouTube won't play that one here. Try another link, or a file from this phone.";
					publish();
				}
			});
		} catch {
			model.error = "YouTube didn't start.";
			publish();
		} finally {
			model.ytCreating = false;
		}
	}
	function primePlayer(player) {
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
			} catch {}
		}, 280);
	}
	function startJob(peerId) {
		const track = model.track;
		const buffer = model.buffer;
		if (!track || !buffer || track.source === "youtube") return;
		const n = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_BYTES));
		const job = {
			id: track.id,
			n,
			next: 0,
			inflight: /* @__PURE__ */ new Map(),
			acked: /* @__PURE__ */ new Set(),
			done: false
		};
		model.jobs.set(peerId, job);
		model.p2p?.send({
			t: "begin",
			track,
			chunks: n
		}, peerId);
		pump(peerId);
	}
	function pump(peerId) {
		const job = model.jobs.get(peerId);
		const buffer = model.buffer;
		const p2p = model.p2p;
		if (!job || !buffer || !p2p || job.done || model.track?.id !== job.id) return;
		while (job.inflight.size < WINDOW && job.next < job.n) {
			const i = job.next;
			job.next += 1;
			p2p.send({
				t: "chunk",
				id: job.id,
				i,
				n: job.n,
				d: sliceB64(buffer, i)
			}, peerId);
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
				p2p.send({
					t: "chunk",
					id: job.id,
					i,
					n: job.n,
					d: sliceB64(buffer, i)
				}, peerId);
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
		const parts = [];
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
			model.p2p?.send({
				t: "need",
				id: track.id
			}, model.hostId ?? void 0);
			publish();
			return;
		}
		model.have.add(track.id);
		model.incoming = null;
		model.finishing = false;
		await attachLocal(toArrayBuffer(bytes), track, false);
		model.p2p?.send({
			t: "have",
			id: track.id
		}, model.hostId ?? void 0);
		publish();
	}
	async function attachLocal(buffer, track, playNow) {
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
		} catch {}
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
	function adoptTrack(track) {
		const same = model.track?.id === track.id;
		model.track = track;
		if (same) return;
		model.syncMs = null;
		if (track.source === "youtube" && track.videoId) {
			model.buffer = null;
			model.incoming = null;
			stopElement();
			ensurePlayer(track.videoId);
			return;
		}
		if (!model.have.has(track.id)) {
			stopElement();
			if (model.incoming?.id !== track.id) model.incoming = null;
		}
	}
	function onAck(from, id, index) {
		const job = model.jobs.get(from);
		if (!job || job.id !== id) return;
		job.inflight.delete(index);
		job.acked.add(index);
		if (job.acked.size >= job.n) job.done = true;
		else pump(from);
	}
	function onMessage(from, data) {
		if (!isWire(data) || model.dead) return;
		const msg = data;
		if (model.role === "host") {
			if (msg.t === "hello") {
				model.readyPeers.add(from);
				if (msg.name) model.names.set(from, msg.name);
				model.p2p?.send({ t: "welcome" }, from);
				model.p2p?.send({
					t: "state",
					transport: snapshot(model.playing),
					track: model.track
				}, from);
				const track = model.track;
				if (track && track.source !== "youtube" && model.buffer) {
					if (msg.have === track.id) {
						const job = model.jobs.get(from);
						if (job && job.id === track.id) job.done = true;
						else model.jobs.set(from, {
							id: track.id,
							n: 1,
							next: 1,
							inflight: /* @__PURE__ */ new Map(),
							acked: /* @__PURE__ */ new Set([0]),
							done: true
						});
					} else if (model.jobs.get(from)?.id !== track.id) startJob(from);
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
			if (msg.t === "clk" && msg.tH === void 0) model.p2p?.send({
				t: "clk",
				n: msg.n,
				t1: msg.t1,
				tH: performance.now()
			}, from);
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
				model.p2p?.send({
					t: "have",
					id: msg.track.id
				}, from);
				publish();
				return;
			}
			model.incoming = {
				id: msg.track.id,
				n: msg.chunks,
				parts: /* @__PURE__ */ new Map()
			};
			model.finishing = false;
			publish();
			return;
		}
		if (msg.t === "chunk") {
			const incoming = model.incoming;
			if (!incoming || incoming.id !== msg.id || msg.n !== incoming.n || typeof msg.d !== "string") return;
			if (msg.i < 0 || msg.i >= incoming.n) return;
			if (!incoming.parts.has(msg.i)) try {
				incoming.parts.set(msg.i, b64ToBytes(msg.d));
			} catch {
				return;
			}
			model.p2p?.send({
				t: "ack",
				id: msg.id,
				i: msg.i
			}, from);
			if (incoming.parts.size >= incoming.n) finishIncoming();
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
	function applyAudio(target, playing) {
		const audio = sharedAudio();
		if (!audio.src || audio.dataset.silent === "1") return;
		const cmd = driftCommand(audio.currentTime || 0, target, playing);
		model.syncMs = cmd.errorMs;
		audio.volume = model.volume;
		audio.playbackRate = cmd.rate;
		if (cmd.seek !== null) try {
			audio.currentTime = cmd.seek;
		} catch {}
		if (cmd.play) {
			if (audio.paused) audio.play().catch(() => {
				model.needsTap = true;
			});
		} else if (!audio.paused) audio.pause();
		model.needsTap = cmd.play && audio.paused;
		model.playing = playing;
	}
	function applyYouTube(target, playing) {
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
		} catch {}
		const now = performance.now();
		if (cmd.seek !== null && (Math.abs(cmd.seek - current) > 1.2 || now - model.lastYtSeek > 4e3)) try {
			player.seekTo(Math.max(0, cmd.seek), true);
			model.lastYtSeek = now;
		} catch {}
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
		if (!track || anchor.trackId && anchor.trackId !== track.id) return;
		const target = targetPosition(anchor.position, anchor.hostTime, anchor.playing, performance.now(), model.offset, model.trim);
		if (track.source === "youtube") applyYouTube(target, anchor.playing);
		else if (model.have.has(track.id)) applyAudio(target, anchor.playing);
	}
	(0, import_react.useEffect)(() => {
		model.dead = false;
		const audio = sharedAudio();
		audio.volume = model.volume;
		audio.onended = () => {
			if (model.dead || model.role !== "host" || model.track?.source === "youtube") return;
			model.playing = false;
			emit(snapshot(false));
			publish();
		};
		const el = document.createElement("div");
		el.setAttribute("aria-hidden", "true");
		el.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.02;overflow:hidden;pointer-events:none;z-index:-1;";
		document.body.appendChild(el);
		model.ytEl = el;
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
			onMessage: (from, data) => onMessage(from, data)
		});
		model.p2p = p2p;
		p2p.join();
		const hello = window.setInterval(() => {
			if (model.dead) return;
			if (model.role === "guest" && !model.welcomed) {
				const haveId = model.track && model.have.has(model.track.id) ? model.track.id : null;
				p2p.send({
					t: "hello",
					name: model.name,
					have: haveId
				});
			}
			if (model.role === "guest" && model.welcomed && model.hostId) {
				const n = ++model.clkN;
				p2p.send({
					t: "clk",
					n,
					t1: performance.now()
				}, model.hostId);
			}
			if (model.role === "host") retransmit();
		}, 700);
		const beat = window.setInterval(() => {
			if (model.dead) return;
			if (model.role === "host") {
				if (model.track && !model.scrubbing) p2p.broadcast({
					t: "state",
					transport: snapshot(model.playing),
					track: model.track
				});
			} else tickGuest();
			publish();
		}, 400);
		const stall = window.setTimeout(() => {
			if (!model.signaling && !model.dead) {
				model.error = STALL;
				publish();
			}
		}, 8e3);
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
			} catch {}
			model.yt = null;
			model.ytReady = false;
			el.remove();
			if (model.blobUrl) URL.revokeObjectURL(model.blobUrl);
			model.blobUrl = null;
		};
	}, [opts.room, opts.selfId]);
	async function loadBuffer(buffer, partial) {
		model.error = null;
		if (buffer.byteLength > 18874368) {
			model.error = "That file is over 18 MB. Export a smaller one and try again.";
			publish();
			return;
		}
		const hash = await sha256(buffer);
		if (model.dead) return;
		let duration = partial.duration;
		if (!duration) duration = await readDuration(buffer, partial.mime);
		const track = {
			...partial,
			duration,
			hash,
			id: hash,
			bytes: buffer.byteLength
		};
		model.jobs.clear();
		model.have.add(track.id);
		await attachLocal(buffer, track, true);
		for (const peerId of model.readyPeers) startJob(peerId);
		emit(snapshot(model.playing));
		publish();
	}
	return {
		view,
		setScrubbing(value) {
			model.scrubbing = value;
		},
		toggle() {
			markGesture();
			if (model.role !== "host" || !model.track) return;
			model.playing = !model.playing;
			model.pendingPlay = model.playing;
			if (model.track.source === "youtube") {
				if (model.yt && model.ytReady) try {
					if (model.playing) {
						model.yt.unMute();
						model.yt.setVolume(Math.round(model.volume * 100));
						model.yt.playVideo();
						model.needsTap = false;
					} else model.yt.pauseVideo();
				} catch {
					model.needsTap = model.playing;
				}
			} else {
				const audio = sharedAudio();
				if (model.playing) audio.play().catch(() => {
					model.playing = false;
					model.needsTap = true;
					emit(snapshot(false));
					publish();
				});
				else audio.pause();
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
			audio.play().then(() => {
				model.needsTap = false;
				if (model.role === "host" && model.track) {
					model.playing = true;
					emit(snapshot(true));
				}
				publish();
			}).catch(() => {
				model.needsTap = true;
				if (model.role === "host") {
					model.playing = false;
					emit(snapshot(false));
				}
				publish();
			});
		},
		seek(seconds) {
			if (model.role !== "host") return;
			const t = Math.max(0, seconds);
			if (model.track?.source === "youtube" && model.yt && model.ytReady) try {
				model.yt.seekTo(t, true);
			} catch {}
			else try {
				sharedAudio().currentTime = t;
			} catch {}
			emit(snapshot(model.playing));
			commit({ position: t });
		},
		setVolume(value) {
			model.volume = Math.min(1, Math.max(0, value));
			sharedAudio().volume = model.volume;
			try {
				localStorage.setItem("chorus-volume", String(model.volume));
			} catch {}
			if (model.yt && model.ytReady) try {
				model.yt.setVolume(Math.round(model.volume * 100));
			} catch {}
			commit({ volume: model.volume });
		},
		setTrim(value) {
			model.trim = Math.min(.15, Math.max(-.15, value));
			try {
				localStorage.setItem("chorus-trim", String(model.trim));
			} catch {}
			commit({ trim: model.trim });
		},
		async loadFile(file) {
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
			if (file.size > 18874368) {
				model.error = "That file is over 18 MB. Export a smaller one and try again.";
				publish();
				return;
			}
			model.error = null;
			publish();
			await loadBuffer(await file.arrayBuffer(), {
				name: file.name.replace(/\.[^.]+$/, "") || "Song",
				mime: mimeFor(file),
				duration: 0,
				source: "file"
			});
		},
		async loadDemo() {
			markGesture();
			model.error = null;
			await loadBuffer(makeDemoWav(), {
				name: "Chorus demo",
				mime: "audio/wav",
				duration: 8,
				source: "demo"
			});
		},
		async loadYouTube(raw) {
			markGesture();
			const id = parseYouTubeId(raw);
			if (!id) {
				model.error = "Paste a YouTube link, or just the video id.";
				publish();
				return;
			}
			model.error = null;
			const meta = await fetchYouTubeMeta(id);
			if (model.dead) return;
			const track = {
				id: `yt-${id}`,
				name: meta?.title || "YouTube",
				mime: "",
				bytes: 0,
				duration: 0,
				hash: id,
				source: "youtube",
				videoId: id,
				author: meta?.author,
				thumb: meta?.thumb ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
			};
			model.buffer = null;
			model.jobs.clear();
			sharedAudio().pause();
			model.track = track;
			model.playing = true;
			model.pendingPlay = true;
			await ensurePlayer(id);
			emit(snapshot(true));
			publish();
		}
	};
}
function ChorusApp({ initialRoom, onRoom }) {
	const [name, setName] = (0, import_react.useState)("Phone");
	const [code, setCode] = (0, import_react.useState)(initialRoom);
	const [joining, setJoining] = (0, import_react.useState)(Boolean(initialRoom));
	const [session, setSession] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		const saved = localStorage.getItem("chorus-name");
		if (saved) setName(saved);
	}, []);
	function remember(next) {
		setName(next);
		try {
			localStorage.setItem("chorus-name", next);
		} catch {}
	}
	function start(role, room) {
		markGesture();
		const clean = cleanName(name);
		onRoom(room);
		setSession({
			role,
			room,
			name: clean,
			selfId: makePeerId(),
			key: 1
		});
	}
	if (session) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Room, {
		session,
		onLeave: () => {
			onRoom("");
			setSession(null);
			setJoining(false);
		},
		onRetry: () => setSession((current) => current ? {
			...current,
			selfId: makePeerId(),
			key: current.key + 1
		} : current)
	}, `${session.key}-${session.selfId}`);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium tracking-widest text-brass uppercase",
				children: "Speaker mesh"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-4 flex items-center gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "grid size-11 place-items-center rounded-full bg-brass text-bg",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AudioLines, {
						className: "size-5",
						"aria-hidden": "true"
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display text-5xl leading-none font-medium italic text-fg",
					children: "Chorus"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 max-w-xs text-lg leading-snug text-fg/80",
				children: "One song, every phone in the room."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				className: "mt-8 block text-sm text-muted",
				htmlFor: "device-name",
				children: "Name on this phone"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id: "device-name",
				className: "mt-2 min-h-12 w-full rounded-2xl bg-surface px-4 text-base text-fg ring-1 ring-fg/15 outline-none placeholder:text-muted",
				value: name,
				maxLength: 24,
				autoComplete: "nickname",
				onChange: (event) => remember(event.target.value)
			}),
			joining ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-6",
				onSubmit: (event) => {
					event.preventDefault();
					const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
					if (room.length < 4) return;
					start("guest", room);
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "text-sm text-muted",
						htmlFor: "room-code",
						children: "Room code"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						id: "room-code",
						className: "mt-2 min-h-14 w-full rounded-2xl bg-surface text-center font-display text-3xl tracking-widest text-fg uppercase ring-1 ring-fg/15 outline-none",
						value: code,
						inputMode: "text",
						autoCapitalize: "characters",
						autoCorrect: "off",
						spellCheck: false,
						maxLength: 6,
						onChange: (event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "submit",
						className: "mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg disabled:opacity-40",
						disabled: code.length < 4,
						children: "Join the room"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mt-3 min-h-11 w-full text-sm text-muted",
						onClick: () => setJoining(false),
						children: "Back"
					})
				]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-8 flex flex-col gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg",
					onClick: () => start("host", makeRoomCode()),
					children: "Host a room"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "flex min-h-12 w-full items-center justify-center rounded-full bg-surface px-5 text-base font-medium text-fg ring-1 ring-fg/15",
					onClick: () => setJoining(true),
					children: "Join with a code"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", {
				className: "mt-auto space-y-4 pt-12 text-sm leading-relaxed text-muted",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display text-base text-brass",
							children: "1"
						}), "Share a hotspot, or join the same Wi-Fi. A moment of mobile data lets the phones find each other."]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display text-base text-brass",
							children: "2"
						}), "The host picks the song. A file on their phone is sent as audio — guests never open a video."]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display text-base text-brass",
							children: "3"
						}), "Everyone else enters the code and taps once so the sound is allowed to play."]
					})
				]
			})
		]
	});
}
function Room({ session, onLeave, onRetry }) {
	const chorus = useChorus(session);
	const { view } = chorus;
	const [source, setSource] = (0, import_react.useState)("library");
	const [link, setLink] = (0, import_react.useState)("");
	const [copied, setCopied] = (0, import_react.useState)(false);
	const [scrubbing, setScrubbing] = (0, import_react.useState)(false);
	const [scrub, setScrub] = (0, import_react.useState)(0);
	const fileRef = (0, import_react.useRef)(null);
	const shown = scrubbing ? scrub : view.position;
	async function share() {
		const url = new URL(window.location.href);
		url.searchParams.set("room", session.room);
		const text = `Join my Chorus room ${session.room}`;
		try {
			if (navigator.share) {
				await navigator.share({
					title: "Chorus",
					text,
					url: url.toString()
				});
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs tracking-widest text-muted uppercase",
					children: session.role === "host" ? "Host" : "Speaker"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-display text-3xl tracking-widest text-fg",
					children: session.room
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-brass",
						onClick: () => void share(),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Share2, {
							className: "size-4",
							"aria-hidden": "true"
						}), copied ? "Copied" : "Share"]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "min-h-11 px-3 text-sm text-muted",
						onClick: onLeave,
						children: "Leave"
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6 flex flex-col items-center",
				"aria-live": "polite",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Vinyl, {
						track: view.track,
						playing: view.playing && !view.hostGone
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "mt-5 max-w-full truncate text-center font-display text-3xl text-fg",
						children: view.track?.name ?? (session.role === "host" ? "Pick a song" : "Waiting for the host")
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-center text-sm text-muted",
						children: view.track ? sourceLabel(view.track.source, view.track.author) : "Library songs stay audio-only on every phone."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-center text-sm text-brass",
						children: view.hostGone ? "The host left" : syncLabel(view, session.role)
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-5",
				children: [session.role === "host" && view.duration > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					className: "fader",
					type: "range",
					min: 0,
					max: view.duration,
					step: .01,
					value: Math.min(shown, view.duration),
					"aria-label": "Song position",
					onPointerDown: (event) => {
						event.currentTarget.setPointerCapture(event.pointerId);
						setScrub(view.position);
						setScrubbing(true);
						chorus.setScrubbing(true);
					},
					onChange: (event) => {
						const next = Number(event.target.value);
						if (scrubbing) setScrub(next);
						else chorus.seek(next);
					},
					onPointerUp: (event) => {
						const next = Number(event.currentTarget.value);
						setScrubbing(false);
						chorus.setScrubbing(false);
						chorus.seek(next);
					}
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "meter",
					role: "progressbar",
					"aria-valuemin": 0,
					"aria-valuemax": Math.round(view.duration),
					"aria-valuenow": Math.round(shown),
					"aria-label": "Song position",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: view.duration > 0 ? `${Math.min(100, shown / view.duration * 100)}%` : "0%" } })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-1 flex justify-between text-xs text-muted tabular-nums",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatTime(shown) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatTime(view.duration) })]
				})]
			}),
			session.role === "host" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "mx-auto mt-4 grid size-16 place-items-center rounded-full bg-brass text-bg disabled:opacity-40",
				"aria-label": view.playing ? "Pause" : "Play",
				disabled: !view.track,
				onClick: () => chorus.toggle(),
				children: view.playing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-7" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-7 translate-x-0.5" })
			}) : null,
			view.needsTap && !view.hostGone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg",
				onClick: () => chorus.resume(),
				children: "Tap to start sound"
			}) : null,
			view.hostGone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-surface text-fg ring-1 ring-fg/15",
				onClick: onRetry,
				children: "Try again"
			}) : null,
			view.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-center text-sm text-warn",
				children: view.error
			}) : null,
			!view.signaling && !view.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-center text-sm text-muted",
				children: "Finding the other phones…"
			}) : null,
			session.role === "host" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid grid-cols-2 gap-2 rounded-full bg-surface p-1 ring-1 ring-fg/10",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: tabClass(source === "library"),
						onClick: () => setSource("library"),
						children: "Library"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: tabClass(source === "youtube"),
						onClick: () => setSource("youtube"),
						children: "YouTube"
					})]
				}), source === "library" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-3",
					onDragOver: (event) => event.preventDefault(),
					onDrop: (event) => {
						event.preventDefault();
						const file = event.dataTransfer.files[0];
						if (file) chorus.loadFile(file);
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							ref: fileRef,
							type: "file",
							accept: "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus",
							className: "hidden",
							onChange: (event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file) chorus.loadFile(file);
							}
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg",
							onClick: () => fileRef.current?.click(),
							children: "Choose a song"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "mt-2 flex min-h-12 w-full items-center justify-center rounded-full bg-surface px-5 text-base text-fg ring-1 ring-fg/15",
							onClick: () => void chorus.loadDemo(),
							children: "Play the demo loop"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-3 text-sm leading-relaxed text-muted",
							children: "The file goes from this phone to the others. They play sound only — no video, and they don't download it again from the internet. MP3, M4A, AAC, WAV, or OGG, up to 18 MB."
						})
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "mt-3",
					onSubmit: (event) => {
						event.preventDefault();
						chorus.loadYouTube(link);
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "min-h-12 w-full rounded-2xl bg-surface px-4 text-base text-fg ring-1 ring-fg/15 outline-none placeholder:text-muted",
							placeholder: "Paste a YouTube link",
							value: link,
							inputMode: "url",
							onChange: (event) => setLink(event.target.value),
							"aria-label": "YouTube link"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: "mt-2 flex min-h-12 w-full items-center justify-center rounded-full bg-brass px-5 text-base font-semibold text-bg disabled:opacity-40",
							disabled: !link.trim(),
							children: "Play this video's audio"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-3 text-sm leading-relaxed text-muted",
							children: "The picture stays hidden. YouTube still plays on each phone, locked to you — that's the only way YouTube allows it. For true audio-only, and tighter timing on a hotspot, use a file instead."
						})
					]
				})]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-6 text-sm leading-relaxed text-muted",
				children: "The host chooses the song. Your volume stays on this phone. Nudge the echo trim if you hear a slap-back."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				className: "mt-6 text-sm text-muted",
				htmlFor: "volume",
				children: "Volume on this phone"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id: "volume",
				className: "fader",
				type: "range",
				min: 0,
				max: 1,
				step: .01,
				value: view.volume,
				"aria-label": "Volume on this phone",
				onChange: (event) => chorus.setVolume(Number(event.target.value))
			}),
			session.role === "guest" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-1 flex items-baseline justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "text-sm text-muted",
					htmlFor: "trim",
					children: "Echo trim"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-sm text-fg tabular-nums",
					children: view.trim === 0 ? "0 ms" : `${view.trim > 0 ? "+" : "−"}${Math.abs(Math.round(view.trim * 1e3))} ms`
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id: "trim",
				className: "fader",
				type: "range",
				min: -.15,
				max: .15,
				step: .005,
				value: view.trim,
				"aria-label": "Echo trim",
				onChange: (event) => chorus.setTrim(Number(event.target.value))
			})] }) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-4 mb-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-sm text-muted",
						children: "Phones"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
						className: "mt-2 divide-y divide-fg/10",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "flex items-center justify-between gap-3 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "truncate text-base text-fg",
								children: session.name
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "shrink-0 text-sm text-brass",
								children: "This phone"
							})]
						}), view.speakers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "py-3 text-sm text-muted",
							children: session.role === "host" ? "Waiting for other phones to join this code." : "No other phones yet."
						}) : view.speakers.map((speaker) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpeakerRow, { speaker }, speaker.id))]
					}),
					!view.signaling ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mt-2 min-h-11 text-sm text-brass",
						onClick: onRetry,
						children: "Retry connection"
					}) : null
				]
			})
		]
	});
}
function SpeakerRow({ speaker }) {
	const sending = speaker.progress !== null && speaker.progress < 1;
	const ready = speaker.progress === 1;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "flex items-center justify-between gap-3 py-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "min-w-0",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block truncate text-base text-fg",
				children: speaker.name || "Phone"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block text-sm text-muted",
				children: sending ? `Sending the song · ${Math.round((speaker.progress ?? 0) * 100)}%` : ready ? "Has the song" : speaker.detail
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: speaker.state === "failed" ? "text-sm text-warn" : "text-sm text-muted",
			children: speaker.state === "connected" ? "Live" : speaker.state === "failed" ? "No link" : "…"
		})]
	});
}
function Vinyl({ track, playing }) {
	const [artOk, setArtOk] = (0, import_react.useState)(true);
	(0, import_react.useEffect)(() => setArtOk(true), [track?.thumb]);
	const letter = (track?.name ?? "Chorus").trim().charAt(0).toUpperCase() || "C";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "relative",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: playing ? "vinyl is-on" : "vinyl",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "vinyl-core",
				children: track?.thumb && artOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
					src: track.thumb,
					alt: "",
					onError: () => setArtOk(false)
				}) : letter
			})
		})
	});
}
function sourceLabel(source, author) {
	if (source === "youtube") return author ? `YouTube · ${author}` : "YouTube";
	if (source === "demo") return "Built-in loop";
	return "From the host's library";
}
function syncLabel(view, role) {
	if (role === "host") {
		if (!view.track) return "Choose a file or a YouTube link";
		return view.playing ? "Leading the room" : "Paused";
	}
	if (!view.clockReady) return "Locking time…";
	if (view.track?.source !== "youtube" && view.transfer !== null && view.transfer < 1) return `Getting the song · ${Math.round(view.transfer * 100)}%`;
	if (!view.track) return "Waiting for a song";
	if (view.syncMs === null) return view.playing ? "Starting…" : "Ready";
	const gap = Math.abs(view.syncMs);
	if (gap < 45) return `In sync · ${gap} ms`;
	if (gap < 140) return `Close · ${gap} ms`;
	return "Catching up";
}
function tabClass(active) {
	return active ? "min-h-11 rounded-full bg-brass text-sm font-semibold text-bg" : "min-h-11 rounded-full text-sm text-muted";
}
function Home() {
	const { room } = Route$2.useSearch();
	const navigate = useNavigate();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChorusApp, {
		initialRoom: room,
		onRoom: (next) => {
			navigate({
				to: "/",
				search: { room: next },
				replace: true
			});
		}
	});
}
//#endregion
export { Home as component };
