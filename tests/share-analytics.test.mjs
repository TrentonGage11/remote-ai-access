import test from "node:test";
import assert from "node:assert/strict";

import {
  extendShareExpiration,
  publicShareAnalytics,
  recordShareActivity
} from "../src/share-analytics.js";

test("normalizes legacy share analytics and expiry warnings", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  assert.deepEqual(publicShareAnalytics({ expiresAt: "2026-08-27T12:00:00.000Z" }, nowMs), {
    viewCount: 0,
    downloadCount: 0,
    accessCount: 0,
    lastAccessedAt: null,
    expiresInMs: 12 * 60 * 60 * 1000,
    expiryStatus: "urgent"
  });
  assert.equal(publicShareAnalytics({ expiresAt: "2026-08-30T00:00:00.000Z" }, nowMs).expiryStatus, "warning");
  assert.equal(publicShareAnalytics({ expiresAt: "2026-09-30T00:00:00.000Z" }, nowMs).expiryStatus, "active");
});

test("records views and downloads independently", () => {
  const share = { viewCount: 2, downloadCount: 3 };
  recordShareActivity(share, "view", Date.parse("2026-08-27T01:00:00.000Z"));
  recordShareActivity(share, "download", Date.parse("2026-08-27T02:00:00.000Z"));
  assert.equal(share.viewCount, 3);
  assert.equal(share.downloadCount, 4);
  assert.equal(share.lastAccessedAt, "2026-08-27T02:00:00.000Z");
});

test("extends from the later of now or current expiry within one year", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  assert.equal(extendShareExpiration("2026-08-28T00:00:00.000Z", 24, nowMs), "2026-08-29T00:00:00.000Z");
  assert.equal(extendShareExpiration("2026-08-01T00:00:00.000Z", 24, nowMs), "2026-08-28T00:00:00.000Z");
  assert.throws(() => extendShareExpiration("2026-08-28T00:00:00.000Z", 8760, nowMs), /one year/);
  assert.throws(() => extendShareExpiration("", 0, nowMs), /between 1 and 8760/);
});