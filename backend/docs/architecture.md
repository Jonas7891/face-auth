# Arquitectura — face-auth (Python / FastAPI)

Capas (evolución del layout existente, sin rewrite):

```text
backend/
├── main.py                              # composition root: lifespan, CORS, middleware, routers
├── face_auth/
│   ├── domain/                          # puro: entidades, value_objects, policies, exceptions, ports
│   │   ├── entities/ (User, BiometricSample)
│   │   ├── value_objects.py             # BiometricModality, TemplateStatus, MatchThreshold, AuditAction
│   │   ├── policies.py                  # face_match / fingerprint_match, calidad mínima
│   │   ├── exceptions.py
│   │   └── ports/out/ (UserRepository + revoke/delete, BiometricService, AuditSink)
│   ├── application/use_cases/           # RegisterFace, LoginFace, RegisterFingerprint,
│   │                                    # LoginFingerprint, RevokeBiometricTemplate, DeleteBiometricData
│   └── infrastructure/
│       ├── config/ (settings.py, dependencies.py — lazy, sin singletons en import)
│       ├── biometrics/ (opencv_biometric_service.py, mock_biometric_service.py)
│       ├── persistence/ (postgres_user_repository, mongodb_biometric_repository,
│       │                 biometric_user_repository — orquesta dual-write PG+Mongo)
│       ├── security/ (audit.py append-only, rate_limit.py)
│       ├── observability/ (middleware.py request-id + métricas en memoria)
│       └── web/ (routers/auth_router.py, routers/lifecycle_router.py,
│                 auth.py liveness HMAC, schemas/, error_handlers.py)
└── tests/ (test_domain, test_use_cases, test_lifecycle_security, test_api_contract)
```

## Datos

- PostgreSQL = identidad (`person`, `app_user`). MongoDB = biometría
  (`face_samples`, `fingerprint_samples`, `audit_events`, `counters`).
- Separación identidad/plantilla: el encoding facial nunca va en Postgres.
- Auditoría: colección `audit_events` append-only (sin update/delete desde la app).

## Flujos

- Enrollment facial: `GET liveness-challenge` → 3× `POST liveness-step` →
  `POST /api/register/face` (challenge completo + `decode_image` + `face_encoding` +
  dedup 1:N contra `threshold` + `save`).
- Verificación 1:N: `LoginFace` recorre plantillas y elige mínima distancia ≤ umbral.
  O(N) lineal: con 100k sujetos la latencia es alta; ver Riesgos.
- Revocación: `POST /api/templates/{username}/revoke` borra encoding y deja marcador.
- Supresión: `DELETE /api/subjects/{username}` borra biométricos (Mongo) + desactiva
  identidad (soft-delete Postgres, conserva fila para FK/auditoría).
