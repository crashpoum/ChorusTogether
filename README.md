# ChorusTogether

One song, every phone in the room.

The host picks a track. Everyone else enters the room code and plays along, locked to the host. It works on the same Wi-Fi or a shared hotspot.

## Play together

1. One person taps **Host a room** and shares the code.
2. Everyone else taps **Join with a code** and enters it.
3. The host chooses the music:
   - **Library** sends a file from that phone (MP3, M4A, AAC, WAV, or OGG, up to 18 MB). Guests hear audio only.
   - **YouTube** takes a video link or a playlist link. The video stays on screen, because YouTube will not play sound from a hidden player. A playlist moves to the next song on its own.
4. If a phone stays quiet, tap **Tap to start sound**. That tap is what lets the browser play audio.

Leave the room from the room screen. Reopening the same browser tab returns you to the room until you leave.

## Develop

```bash
npm install
npm run dev
```

The app is served at `http://127.0.0.1:8080`.
