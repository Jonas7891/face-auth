/** Tests del camino crítico de auth (node --test, sin dependencias). */
"use strict";

process.env.EXPO_PUBLIC_API_URL = "http://127.0.0.1:8000";
process.env.EXPO_PUBLIC_AUTH_MODE = "biometric";
process.env.EXPO_PUBLIC_SESSION_V2 = "1";
process.env.NODE_ENV = "test";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { AuthError, loginFace, refreshSession, logout, authFetch, normalizeLogin } = require("../authClient");
const storage = require("../tokenStorage");

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

describe("normalizeLogin (contrato)", () => {
  it("acepta snake_case legacy", () => {
    const s = normalizeLogin({ access_token: "a", refresh_token: "r", expires_in: 900, username: "ana" });
    assert.equal(s.accessToken, "a");
    assert.equal(s.refreshToken, "r");
    assert.equal(s.expiresIn, 900);
  });

  it("acepta camelCase", () => {
    const s = normalizeLogin({ accessToken: "a", user: { email: "ana@x.com" }, session: { id: "s1" } });
    assert.equal(s.username, "ana@x.com");
    assert.equal(s.sessionId, "s1");
  });

  it("sin token -> CONTRACT_WITHOUT_TOKEN interno (no 502 real)", () => {
    assert.throws(() => normalizeLogin({ ok: true }), (e) => e instanceof AuthError && e.code === "CONTRACT_WITHOUT_TOKEN");
  });
});

describe("loginFace (1 llamada crítica)", () => {
  it("éxito guarda sesión y devuelve mínimo", async () => {
    await storage.clear();
    let calls = 0;
    const fetchImpl = async (url, opts) => {
      calls += 1;
      assert.ok(url.endsWith("/api/login/face"));
      assert.equal(JSON.parse(opts.body).challenge_token, "ch");
      return jsonResponse(200, { access_token: "acc", refresh_token: "ref", session_id: "sid", username: "ana" });
    };
    const s = await loginFace({ image: "img", challengeToken: "ch" }, { fetchImpl });
    assert.equal(calls, 1);
    assert.equal(s.username, "ana");
    assert.equal(await storage.getAccessToken(), "acc");
    assert.equal(await storage.getRefreshToken(), "ref");
  });

  it("401 -> error genérico sin enumeración", async () => {
    await storage.clear();
    const fetchImpl = async () => jsonResponse(401, { detail: "Rostro no reconocido" });
    await assert.rejects(() => loginFace({ image: "x", challengeToken: "y" }, { fetchImpl }), (e) => e.code === "INVALID_CREDENTIALS");
  });

  it("429 -> RATE_LIMITED", async () => {
    const fetchImpl = async () => jsonResponse(429, {});
    await assert.rejects(() => loginFace({ image: "x", challengeToken: "y" }, { fetchImpl }), (e) => e.code === "RATE_LIMITED");
  });
});

describe("refresh/logout", () => {
  it("refresh rota y guarda par nuevo", async () => {
    await storage.saveSession({ accessToken: "old", refreshToken: "r1", sessionId: "s" });
    const fetchImpl = async (url, opts) => {
      assert.ok(url.endsWith("/api/auth/refresh"));
      assert.equal(JSON.parse(opts.body).refresh_token, "r1");
      return jsonResponse(200, { access_token: "new-acc", refresh_token: "r2", session_id: "s" });
    };
    const s = await refreshSession({ fetchImpl });
    assert.equal(s.accessToken, "new-acc");
    assert.equal(await storage.getRefreshToken(), "r2");
  });

  it("logout limpia local aunque el servidor falle", async () => {
    await storage.saveSession({ accessToken: "a", refreshToken: "r", sessionId: "s" });
    const fetchImpl = async () => {
      throw new Error("red caída");
    };
    const res = await logout({ fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(await storage.getAccessToken(), null);
  });
});

describe("authFetch", () => {
  it("reintenta una vez con refresh ante 401", async () => {
    await storage.saveSession({ accessToken: "old", refreshToken: "r1", sessionId: "s" });
    let n = 0;
    const fetchImpl = async (url, opts) => {
      n += 1;
      if (url.endsWith("/api/data")) {
        return (opts.headers.Authorization === "Bearer new-acc"
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, {}));
      }
      if (url.endsWith("/api/auth/refresh")) return jsonResponse(200, { access_token: "new-acc", refresh_token: "r2", session_id: "s" });
      throw new Error("ruta inesperada " + url);
    };
    const data = await authFetch("/api/data", { fetchImpl });
    assert.equal(data.ok, true);
    assert.equal(n, 3); // data 401 + refresh + data ok
  });
});
