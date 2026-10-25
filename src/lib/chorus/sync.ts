export type ClockSample = { rtt: number; offset: number };

export function clockSample(t1: number, tHost: number, t3: number): ClockSample | null {
  const rtt = t3 - t1;
  if (!Number.isFinite(rtt) || rtt < 0 || rtt > 800) return null;
  return { rtt, offset: tHost - (t1 + rtt / 2) };
}

/** Median offset among the lowest-latency samples. */
export function bestOffset(samples: ClockSample[]): number | null {
  if (samples.length === 0) return null;
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
  const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  if (offsets.length % 2 === 1) return offsets[mid] ?? null;
  const lo = offsets[mid - 1];
  const hi = offsets[mid];
  if (lo === undefined || hi === undefined) return null;
  return (lo + hi) / 2;
}

export function pushSample(samples: ClockSample[], next: ClockSample): ClockSample[] {
  const kept = samples.length >= 8 ? samples.slice(1) : samples.slice();
  kept.push(next);
  return kept;
}

/**
 * Where this phone's playhead should be.
 * `trim` seconds: positive lags this speaker (use it if you hear yourself early).
 */
export function targetPosition(
  position: number,
  hostTime: number,
  playing: boolean,
  now: number,
  offset: number,
  trim: number,
): number {
  if (!playing) return Math.max(0, position);
  const elapsed = (now + offset - hostTime) / 1000;
  return Math.max(0, position + elapsed - trim);
}

export type DriftCommand = { seek: number | null; rate: number; play: boolean; errorMs: number };

export function driftCommand(current: number, target: number, playing: boolean): DriftCommand {
  const errorMs = Math.round((target - current) * 1000);
  if (!playing) {
    return { seek: Math.abs(target - current) > 0.05 ? target : null, rate: 1, play: false, errorMs };
  }
  const diff = target - current;
  if (Math.abs(diff) > 0.12) {
    return { seek: target, rate: 1, play: true, errorMs };
  }
  const rate = 1 + Math.max(-0.025, Math.min(0.025, diff * 0.35));
  return { seek: null, rate, play: true, errorMs };
}
