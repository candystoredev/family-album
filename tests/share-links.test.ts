import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isShareLinkUsable } from "../src/lib/shareLinks";

/**
 * Phase 11e — share-link revocation. Run: npx tsx --test tests/share-links.test.ts
 */

describe("isShareLinkUsable", () => {
  const now = Date.now();
  const future = new Date(now + 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();

  it("is usable when not revoked and has no expiry", () => {
    assert.equal(isShareLinkUsable({ revoked: 0, expires_at: null }, now), true);
  });

  it("is not usable when revoked", () => {
    assert.equal(isShareLinkUsable({ revoked: 1, expires_at: null }, now), false);
  });

  it("is not usable when revoked even with a future expiry", () => {
    assert.equal(isShareLinkUsable({ revoked: 1, expires_at: future }, now), false);
  });

  it("is not usable when not revoked but expiry is in the past", () => {
    assert.equal(isShareLinkUsable({ revoked: 0, expires_at: past }, now), false);
  });

  it("is usable when not revoked and expiry is in the future", () => {
    assert.equal(isShareLinkUsable({ revoked: 0, expires_at: future }, now), true);
  });

  it("treats null/undefined expires_at as no-expiry", () => {
    assert.equal(isShareLinkUsable({ revoked: false, expires_at: null }, now), true);
    assert.equal(isShareLinkUsable({ revoked: false, expires_at: undefined }, now), true);
    assert.equal(isShareLinkUsable({ revoked: false }, now), true);
  });

  it("treats a boolean revoked value the same as truthy/falsy integers", () => {
    assert.equal(isShareLinkUsable({ revoked: true, expires_at: null }, now), false);
    assert.equal(isShareLinkUsable({ revoked: false, expires_at: null }, now), true);
  });
});
