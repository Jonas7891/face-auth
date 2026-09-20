/**
 * TokenStorage seguro (JS puro).
 *
 * - Usa expo-secure-store (Keychain/Keystore) cuando está disponible.
 * - Fallback en memoria (nunca AsyncStorage plano para refresh tokens).
 * - Nunca loguea valores completos: solo huella `abcd…wxyz`.
 */

let SecureStore = null;
try {
  SecureStore = require("expo-secure-store");
} catch (e) {
  SecureStore = null; // no instalado: fallback en memoria (ver README de seguridad)
}

const KEYS = { ACCESS: "fa_access", REFRESH: "fa_refresh", SESSION: "fa_session" };
const memory = { access: null, refresh: null, sessionId: null };

function fingerprint(token) {
  if (!token || token.length < 8) return "none";
  return token.slice(0, 4) + "…" + token.slice(-4);
}

async function setItem(key, value) {
  if (SecureStore) {
    if (value == null) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, String(value));
    }
    return;
  }
  const slot = key === KEYS.ACCESS ? "access" : key === KEYS.REFRESH ? "refresh" : "sessionId";
  memory[slot] = value == null ? null : String(value);
}

async function getItem(key) {
  if (SecureStore) return SecureStore.getItemAsync(key);
  const slot = key === KEYS.ACCESS ? "access" : key === KEYS.REFRESH ? "refresh" : "sessionId";
  return memory[slot];
}

async function saveSession({ accessToken, refreshToken, sessionId }) {
  await setItem(KEYS.ACCESS, accessToken || null);
  await setItem(KEYS.REFRESH, refreshToken || null);
  await setItem(KEYS.SESSION, sessionId || null);
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[Auth] tokens guardados: access=" + fingerprint(accessToken), "refresh=" + fingerprint(refreshToken));
  }
}

async function getAccessToken() {
  return getItem(KEYS.ACCESS);
}

async function getRefreshToken() {
  return getItem(KEYS.REFRESH);
}

async function getSessionId() {
  return getItem(KEYS.SESSION);
}

async function clear() {
  await setItem(KEYS.ACCESS, null);
  await setItem(KEYS.REFRESH, null);
  await setItem(KEYS.SESSION, null);
}

module.exports = { saveSession, getAccessToken, getRefreshToken, getSessionId, clear, fingerprint, _memory: memory };
