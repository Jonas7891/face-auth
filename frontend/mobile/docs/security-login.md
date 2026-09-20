# Seguridad del login — controles anti-suplantación

> Complementa `backend/docs/security.md`. Sin asesoría legal.

## Implementado (esta iteración)

1. **Validación server-side**: la identidad sale del matching biométrico +
   `sub` firmado; el cliente nunca aporta `user_id`/`roles`.
2. **Sin passwords**: no hay credential stuffing/password-spraying posible;
   el liveness HMAC (120 s, un solo uso) es el factor de presentación.
3. **Comparación constante**: `hmac.compare_digest` en liveness y device_hash.
4. **Anti-enumeración**: 401 genérico en login/refresh/me; `normalizeLogin`
   no distingue causas; tiempos similares (sin ramas costosas por causa).
5. **Rate limiting**: `login_face`, `login_fp` y nuevo `auth_refresh` → 429.
6. **Access corto** (15 min, configurable 5-15) con iss/aud/sub/exp/iat/jti/sid/auth_time.
7. **Refresh opaco rotativo**: solo SHA-256 almacenado; cada uso rota; el reuso
   de un token ya rotado **revoca la familia completa** (anti-robo).
8. **Device binding razonable**: `device_hash` opcional; mismatch revoca familia.
9. **Session fixation**: cada login crea `sid`+familia nuevos, nunca reutiliza.
10. **Replay**: jti+exp+iat+skew de PyJWT; challenges de un solo uso.
11. **Token substitution**: `verify_access_token` exige firma+exp y, si existen,
    iss/aud; `authFetch` solo envía el access propio.
12. **Auditoría no bloqueante**: verify/refresh/logout best-effort.
13. **Storage móvil**: SecureStore si disponible; si no, memoria. Fingerprint
    `abcd…wxyz` en logs; jamás tokens/PII/biometría en logs.
14. **Logout real**: revoca familia server-side + limpieza local garantizada
    (`finally`), aunque falle la red.
15. **Secretos**: sin hardcodear; `require_jwt_secret()` (≥32 chars).

## Riesgos restantes (severidad)

- **Alto**: SecureStore no instalado → fallback en memoria pierde la sesión al
  cerrar la app (disponibilidad, no robo). Instalar `expo-secure-store` + rebuild.
- **Alto**: plantillas biométricas en claro en Mongo (ver `backend/docs/security.md`).
- **Medio**: refresh store en memoria por proceso → con `--workers>1` mover a Redis.
- **Medio**: `GET /api/users` sin auth permite enumerar usernames (preexistente).
- **Bajo**: `device_hash` aún no lo envía App.js (pendiente cablear `expo-device`/
  `expo-application` como ID estable).

## Integración en App.js (pendiente, snippet)

```js
const { loginFace, logout } = require("./src/auth/authClient");
// tras liveness: const s = await loginFace({ image, challengeToken });
// logout: await logout({});
```

No se modificó `App.js` para no romper el flujo que funciona; el cliente nuevo
es drop-in y retrocompatible (acepta `access_token` y `accessToken`).
