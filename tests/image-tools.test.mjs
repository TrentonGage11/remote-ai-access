import test from "node:test";
import assert from "node:assert/strict";

import { extractGeneratedImage, normalizeImageRequest, parseWikimediaImageResults } from "../src/image-tools.js";

test("normalizes bounded workspace image requests", () => {
  assert.deepEqual(normalizeImageRequest({ provider: "XAI", prompt: " nebula ", outputPath: "art/nebula.webp" }), {
    provider: "xai", prompt: "nebula", outputPath: "art/nebula.webp", model: "", size: "1024x1024", quality: "auto"
  });
  assert.throws(() => normalizeImageRequest({ prompt: "x", outputPath: "../escape.png" }), /workspace-relative/);
});

test("parses Wikimedia metadata and provider image payloads", () => {
  const results = parseWikimediaImageResults({ query: { pages: { 1: { title: "File:Sky.jpg", imageinfo: [{ thumburl: "https://img/sky.jpg", descriptionurl: "https://commons/sky", mime: "image/jpeg", thumbwidth: 320, thumbheight: 200, extmetadata: { LicenseShortName: { value: "CC BY" } } }] } } } });
  assert.equal(results[0].title, "Sky.jpg");
  assert.equal(results[0].license, "CC BY");
  assert.equal(extractGeneratedImage({ data: [{ b64_json: "aGVsbG8=" }] }).base64, "aGVsbG8=");
  assert.equal(extractGeneratedImage({ candidates: [{ content: { parts: [{ inlineData: { data: "aW1hZ2U=" } }] } }] }).base64, "aW1hZ2U=");
});