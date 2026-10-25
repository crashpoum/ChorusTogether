import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeId, parseYouTubeLink } from "./youtube.ts";
import { bestOffset, clockSample, driftCommand, targetPosition } from "./sync.ts";

test("youtube ids parse from common links", () => {
  assert.equal(parseYouTubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("not a link"), null);
  const playlist = parseYouTubeLink(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
  );
  assert.equal(playlist.videoId, "dQw4w9WgXcQ");
  assert.equal(playlist.playlistId, "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI");
  assert.equal(
    parseYouTubeLink("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI").videoId,
    null,
  );
  assert.equal(parseYouTubeLink("https://example.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59al").playlistId, null);
});

test("clock offset removes one-way delay", () => {
  const sample = clockSample(1_000, 5_000, 1_040);
  assert.ok(sample);
  assert.equal(sample.rtt, 40);
  assert.equal(sample.offset, 3_980);
  assert.equal(clockSample(0, 0, 900), null);
});

test("best offset prefers the tighter samples", () => {
  const offset = bestOffset([
    { rtt: 20, offset: 10 },
    { rtt: 22, offset: 12 },
    { rtt: 24, offset: 14 },
    { rtt: 400, offset: 80 },
  ]);
  assert.equal(offset, 13);
});

test("target position follows the host clock and trim", () => {
  const at = targetPosition(10, 1_000, true, 1_200, 0, 0.05);
  assert.ok(Math.abs(at - 10.15) < 1e-9);
  assert.equal(targetPosition(4, 0, false, 999, 0, 1), 4);
});

test("drift nudges small errors and seeks large ones", () => {
  const nudge = driftCommand(10, 10.04, true);
  assert.equal(nudge.seek, null);
  assert.ok(nudge.rate > 1);
  const seek = driftCommand(10, 10.4, true);
  assert.equal(seek.seek, 10.4);
  assert.equal(seek.rate, 1);
  const hold = driftCommand(3, 3.2, false);
  assert.equal(hold.play, false);
  assert.equal(hold.seek, 3.2);
});
