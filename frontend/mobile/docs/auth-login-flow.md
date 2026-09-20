# Flujo de login — face-auth móvil + backend

## Supuesto explícito

El repo **no** contiene `db.json`, JSON Server, `AUTH_BASE_URL`, `authService`,
`apiClient` ni login email/password. El login real es **biométrico contra
FastAPI**. Por eso no se reproduce aquí el log `502 CONTRACT_WITHOUT_TOKEN`:
`CONTRACT_WITHOUT_TOKEN` vive solo como código interno en
`frontend/mobile/src/auth/authClient.js` (`normalizeLogin`) y **nunca** es un
502 del servidor. No existe flujo legacy de 5 llamadas que reemplazar; el
camino crítico ya es de 1 llamada y se conserva.

## Camino crítico (1 llamada)

```text
App (liveness local: challenge + 3 steps)
  └─► POST /api/login/face {image, challenge_token}   ← ÚNICA llamada crítica
        ├── 200 {access_token, token_type, expires_in, username, distance,
        │         refresh_token*, session_id*}   (* solo con SESSION_V2_ENABLED=1)
        ├── 401 genérico (sin enumerar) → mensaje "Credenciales inválidas"
        └── 429 rate-limit → "Demasiados intentos"
  └─► lazy: GET /api/auth/me (Bearer) para perfil mínimo, en paralelo con la UI
```

Registro: `POST /api/register/face`. Sesión: `POST /api/auth/refresh`
(rotación), `POST /api/auth/logout` (idempotente), `GET /api/auth/me`.

## Antes / después

| Métrica | Antes | Después |
|---|---|---|
| Llamadas HTTP críticas login | 1 (`/api/login/face`) | 1 (sin cambios) |
| Claims access token | sub, exp | + iss, aud, jti, sid, iat, auth_time (tokens viejos siguen válidos) |
| Refresh rotativo | no existía | sí, con detección de reuso (revoca familia) |
| Logout server-side | no existía | `POST /api/auth/logout` idempotente |
| Perfil mínimo lazy | `GET /api/users` completo | `GET /api/auth/me` (sub+sid) |
| Storage móvil | sin módulo (App.js en memoria) | `tokenStorage.js` (SecureStore si disponible, si no memoria; jamás AsyncStorage plano) |
| Rate-limit refresh | n/a | `auth_refresh` con 429 |
| Auditoría | verify_success/failure | + token_refresh, token_refresh_failure, logout |

p50/p95 local pendientes de medir con backend en Docker (ver runbook);
el diseño no añade I/O al camino feliz: la auditoría ya era best-effort y la
emisión de sesión es HMAC+random local (<1 ms).

## Rollback

- Servidor: `SESSION_V2_ENABLED=0` → respuesta login idéntica a la legacy
  (sin `refresh_token`/`session_id`); endpoints `/api/auth/*` quedan inertes
  pero registrados (sin tráfico si el cliente no los llama).
- Cliente: `EXPO_PUBLIC_SESSION_V2=0` → no guarda ni usa refresh; `authFetch`
  no reintenta. `EXPO_PUBLIC_AUTH_MODE=legacy` reserva el modo anterior.
- Ambos flags son de entorno, sin deploy de código para revertir.
