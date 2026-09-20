/**
 * authClient.js — camino crítico del login en 1 llamada (+ refresh/logout/me).
 *
 * Contratos:
 * - loginFace({ image, challengeToken }): POST /api/login/face (única llamada
 *   crítica). Respuesta legacy {access_token, token_type, expires_in, username}
 *   más, con session v2, {refresh_token, session_id}. Error genérico si 401.
 * - refreshSession(): POST /api/auth/refresh con rotación (un solo reintento).
 * - logout(): POST /api/auth/logout (idempotente) + limpieza local siempre.
 * - authFetch(path, options): Bearer + auto-refresh una vez ante 401.
 * - fetchMe(): GET /api/auth/me para perfil mínimo lazy.
 *
 * Seguridad: sin enumeración (mensajes genéricos), sin logs de tokens/PII,
 * telemetría [Auth] solo con booleanos y huellas cortas.
 *
 * `fetchImpl` inyectable para tests (por defecto global fetch).
 */

const config = require("./authConfig");
const storage = require("./tokenStorage");

function safeLog(...args) {
  if (config.SESSION_V2 !== false) {
    // eslint-disable-next-line no-console
    console.log("[Auth]", ...args);
  }
}

class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function parseError(status, data) {
  // Anti-enumeración: el servidor ya responde genérico; aquí no agregamos detalle.
  if (status === 401) return new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");
  if (status === 429) return new AuthError(429, "RATE_LIMITED", "Demasiados intentos, espera un momento");
  const detail = data && typeof data.detail === "string" ? data.detail : null;
  return new AuthError(status, "AUTH_FAILED", detail || "No se pudo completar la autenticación");
}

async function request(path, { method = "GET", body, token, fetchImpl } = {}) {
  const fetchFn = fetchImpl || fetch;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const started = Date.now();
  const res = await fetchFn(config.API_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  safeLog("http", method, path, "->", res.status, Date.now() - started + "ms");
  if (!res.ok) throw parseError(res.status, data);
  return data;
}

function normalizeLogin(data) {
  const accessToken = data.accessToken || data.access_token || null;
  const refreshToken = data.refreshToken || data.refresh_token || null;
  if (!accessToken) {
    // Contrato sin token: indicador interno, NO 502 real (ver docs/auth-login-flow.md).
    throw new AuthError(502, "CONTRACT_WITHOUT_TOKEN", "Respuesta de autenticación inválida");
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: data.expiresIn || data.expires_in || 900,
    tokenType: data.tokenType || data.token_type || "Bearer",
    username: (data.user && (data.user.email || data.user.name)) || data.username || null,
    sessionId: (data.session && data.session.id) || data.session_id || data.sessionId || null,
  };
}

async function loginFace({ image, challengeToken }, { fetchImpl } = {}) {
  safeLog("inicio de login facial");
  const raw = await request("/api/login/face", {
    method: "POST",
    body: { image, challenge_token: challengeToken },
    fetchImpl,
  });
  const session = normalizeLogin(raw);
  if (config.SESSION_V2) {
    await storage.saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken, sessionId: session.sessionId });
    safeLog("token emitido: sí | refresh guardado:", session.refreshToken ? "sí" : "no", "| usuario mínimo:", session.username ? "sí" : "no");
  }
  safeLog("login exitoso");
  return session;
}

async function refreshSession({ fetchImpl } = {}) {
  const refreshToken = await storage.getRefreshToken();
  if (!refreshToken) throw new AuthError(401, "NO_SESSION", "Sin sesión local");
  const raw = await request("/api/auth/refresh", { method: "POST", body: { refresh_token: refreshToken }, fetchImpl });
  const session = normalizeLogin(raw);
  await storage.saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken, sessionId: session.sessionId });
  safeLog("refresh rotado: sí");
  return session;
}

async function logout({ fetchImpl } = {}) {
  const refreshToken = await storage.getRefreshToken().catch(() => null);
  const sessionId = await storage.getSessionId().catch(() => null);
  try {
    await request("/api/auth/logout", { method: "POST", body: { refresh_token: refreshToken, session_id: sessionId }, fetchImpl });
  } catch (e) {
    safeLog("logout servidor falló, limpieza local igual:", e.code || e.message);
  } finally {
    await storage.clear();
  }
  safeLog("logout local: sí");
  return { ok: true };
}

async function fetchMe({ fetchImpl } = {}) {
  const token = await storage.getAccessToken();
  if (!token) throw new AuthError(401, "NO_SESSION", "Sin sesión local");
  return request("/api/auth/me", { token, fetchImpl });
}

async function authFetch(path, options = {}) {
  const { fetchImpl, ...rest } = options;
  let token = await storage.getAccessToken();
  try {
    return await request(path, { ...rest, token, fetchImpl });
  } catch (e) {
    if (e instanceof AuthError && e.status === 401 && config.SESSION_V2) {
      const session = await refreshSession({ fetchImpl }).catch(() => null);
      if (session) return request(path, { ...rest, token: session.accessToken, fetchImpl });
    }
    throw e;
  }
}

module.exports = { AuthError, loginFace, refreshSession, logout, fetchMe, authFetch, normalizeLogin };
