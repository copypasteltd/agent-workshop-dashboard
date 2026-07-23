import assert from "node:assert/strict";
import test from "node:test";
import {
  isAgentMediaAttachment,
  normalizeAgentMediaPath,
  parseAgentMessageMedia,
} from "../src/lib/agentMessageMedia.ts";

test("normalizes media paths inside the run target", () => {
  const target = "/srv/lingban/runs/run_1/target";
  assert.equal(normalizeAgentMediaPath("./output/episode.mp4", target), "output/episode.mp4");
  assert.equal(normalizeAgentMediaPath("/workspace/target/output/cover.png", target), "output/cover.png");
  assert.equal(normalizeAgentMediaPath("../outside.webm", target), null);
  assert.equal(isAgentMediaAttachment("output/trailer.mov", target), true);
});

test("parses local image and video references and keeps other attachments", () => {
  const parsed = parseAgentMessageMedia(
    "Results:\n![cover](./output/cover.png)\n[episode](./output/episode.mp4)",
    "/workspace/target",
    [
      { label: "episode duplicate", path: "output/episode.mp4" },
      { label: "report", path: "output/report.pdf" },
    ]
  );

  assert.equal(parsed.displayText, "Results:");
  assert.deepEqual(
    parsed.media.map((item) => ({ kind: item.kind, path: item.filePath })),
    [
      { kind: "image", path: "output/cover.png" },
      { kind: "video", path: "output/episode.mp4" },
    ]
  );
});

test("does not resolve remote media URLs", () => {
  const text = "[remote](https://example.com/episode.mp4)";
  const parsed = parseAgentMessageMedia(text, "/workspace/target");
  assert.equal(parsed.displayText, text);
  assert.deepEqual(parsed.media, []);
});
