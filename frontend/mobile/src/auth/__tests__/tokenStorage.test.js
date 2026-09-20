/** Tests de tokenStorage: nunca expone valores completos en logs. */
"use strict";

process.env.NODE_ENV = "test";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const storage = require("../tokenStorage");

describe("tokenStorage", () => {
  it("guarda y lee sin SecureStore (fallback memoria)", async () => {
    await storage.saveSession({ accessToken: "acc-123", refreshToken: "ref-456", sessionId: "sid" });
    assert.equal(await storage.getAccessToken(), "acc-123");
    assert.equal(await storage.getRefreshToken(), "ref-456");
    assert.equal(await storage.getSessionId(), "sid");
    await storage.clear();
    assert.equal(await storage.getAccessToken(), null);
  });

  it("fingerprint no expone el token", () => {
    const fp = storage.fingerprint("super-secreto-largo");
    assert.ok(!fp.includes("super-secreto-largo"));
    assert.ok(fp.includes("…"));
    assert.equal(storage.fingerprint(null), "none");
  });
});
