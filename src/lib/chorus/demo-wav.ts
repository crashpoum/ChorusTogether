/** Original 8-second loop used so a room can be tried with nothing on the phone. */

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
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
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export function makeDemoWav(): ArrayBuffer {
  const sampleRate = 22050;
  const duration = 8;
  const n = sampleRate * duration;
  const out = new Float32Array(n);
  const beat = 0.5;
  const bass = [110, 110, 130.81, 110, 98, 98, 110, 146.83];

  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    let s = 0;
    const bt = t % beat;
    if (bt < 0.42) {
      const kickEnv = Math.exp(-bt * 10);
      const kickF = 150 * Math.exp(-bt * 12) + 48;
      s += Math.sin(2 * Math.PI * kickF * bt) * kickEnv * 0.55;
    }
    const ht = (t + beat / 2) % beat;
    if (ht < 0.03) {
      const noise = Math.sin(2 * Math.PI * 6000 * t) * Math.sin(2 * Math.PI * 7300 * t);
      s += noise * (1 - ht / 0.03) * 0.07;
    }
    const note = bass[Math.floor(t) % bass.length] ?? 110;
    const nt = t % 1;
    const bassEnv = Math.exp(-nt * 2.2) * (nt < 0.015 ? nt / 0.015 : 1);
    s += Math.sin(2 * Math.PI * note * t) * bassEnv * 0.28;
    s += Math.sin(2 * Math.PI * note * 2 * t) * bassEnv * 0.06;
    const stab = t % 2;
    if (stab < 1.1) {
      const env = Math.exp(-stab * 3.2) * (stab < 0.012 ? stab / 0.012 : 1);
      for (const f of [220, 261.63, 329.63]) s += Math.sin(2 * Math.PI * f * t) * env * 0.055;
    }
    out[i] = Math.tanh(s * 1.25) * 0.88;
  }

  const fade = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < fade; i += 1) {
    const g = i / fade;
    out[i] = (out[i] ?? 0) * g;
    out[n - fade + i] = (out[n - fade + i] ?? 0) * (1 - g);
  }
  return encodeWav(out, sampleRate);
}
