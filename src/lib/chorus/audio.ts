const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

let audioEl: HTMLAudioElement | null = null;
let gestured = false;

export function sharedAudio(): HTMLAudioElement {
  if (!audioEl) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audioEl = audio;
  }
  return audioEl;
}

/** Call inside a tap so later play() calls from the network are allowed. */
export function markGesture(): void {
  gestured = true;
  const audio = sharedAudio();
  const idle = !audio.src || audio.dataset.silent === "1";
  if (idle) {
    audio.dataset.silent = "1";
    audio.src = SILENT_WAV;
  }
  void audio
    .play()
    .then(() => {
      if (audio.dataset.silent === "1") {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        delete audio.dataset.silent;
      }
    })
    .catch(() => {});
}

export function hasGesture(): boolean {
  return gestured;
}
