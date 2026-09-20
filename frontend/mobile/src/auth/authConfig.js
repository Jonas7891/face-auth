/**
 * Config central del Auth móvil (JS puro, sin TypeScript).
 *
 * - EXPO_PUBLIC_API_URL: base del backend FastAPI (nunca Metro/8081).
 * - EXPO_PUBLIC_AUTH_MODE: "biometric" (defecto) | "legacy" (fallback controlado).
 * - EXPO_PUBLIC_SESSION_V2: "1" (defecto) | "0" para no enviar/usar refresh.
 *
 * Nada aquí contiene secretos. Los tokens viven en tokenStorage.js.
 */

function readEnv(name, fallback) {
  const value = typeof process.env[name] !== "undefined" ? String(process.env[name]) : "";
  return value.trim() !== "" ? value.trim() : fallback;
}

function baseApiUrl() {
  const raw = readEnv("EXPO_PUBLIC_API_URL", "http://192.168.1.100:8000").replace(/\/$/, "");
  return raw;
}

function isMetroUrl(url) {
  return /:8081(\/|$)/.test(url || "");
}

const API_URL = baseApiUrl();
const AUTH_MODE = readEnv("EXPO_PUBLIC_AUTH_MODE", "biometric");
const SESSION_V2 = readEnv("EXPO_PUBLIC_SESSION_V2", "1") !== "0";
const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";

if (IS_DEV && isMetroUrl(API_URL)) {
  // eslint-disable-next-line no-console
  console.warn("[Auth] EXPO_PUBLIC_API_URL apunta a :8081 (Metro). Debe ser el backend :8000.");
}

if (IS_DEV) {
  // eslint-disable-next-line no-console
  console.log("[Auth] modo activo:", AUTH_MODE, "| session_v2:", SESSION_V2 ? "on" : "off");
}

module.exports = { API_URL, AUTH_MODE, SESSION_V2, isMetroUrl };
