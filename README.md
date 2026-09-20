# Face Auth

Servicio de autenticacion facial y de huella con FastAPI, PostgreSQL, MongoDB y una app React web.

## Ejecutar con Docker

1. Copia `.env.example` a `.env` y cambia las credenciales.
2. Ejecuta `docker compose up -d --build`.
3. Comprueba `http://localhost:8000/api/health` y `http://localhost:8000/api/ready`.
4. Abre `http://localhost:8080`.

## App web

La interfaz web se construye automáticamente dentro de Docker:

```powershell
docker compose up -d --build
```

El frontend usa React, Vite y los SDK web de DigitalPersona. El proxy nginx envia `/api/` al backend, por lo que no hace falta configurar una URL distinta en el navegador.

## App móvil con Expo Go

La app móvil está en `frontend/mobile` y permite probar la cámara, el registro facial y el login facial desde un teléfono. Expo Go no puede acceder al lector USB DigitalPersona; ese flujo continúa disponible en la app web.

Conecta el teléfono y el computador a la misma Wi-Fi, copia `frontend/mobile/.env.example` a `frontend/mobile/.env` y cambia `EXPO_PUBLIC_API_URL` por la IPv4 del computador. Luego ejecuta:

```powershell
Push-Location frontend/mobile
npm install
npx expo start
Pop-Location
```

Escanea el QR con Expo Go. Si la red local bloquea la conexión, usa `npx expo start --tunnel`. El backend debe estar iniciado con `docker compose up -d` y el firewall debe permitir el puerto `8000` en redes privadas.

PostgreSQL es la fuente de identidad (`person` y `app_user`). MongoDB solo guarda biometria en `face_samples`, `fingerprint_samples` y `counters`; no guarda nombres de usuario ni credenciales.

Para una instalacion anterior, respalda Mongo y ejecuta una vez la limpieza de la coleccion legacy:

```powershell
docker compose exec backend python scripts/purge_legacy_mongo_users.py
```

## Tests del backend

Desde la raiz:

```powershell
Push-Location backend
python -m pytest -q
Pop-Location
```

## Cargar datos de prueba en MongoDB

Para insertar 100.000 usuarios sin hacer 100.000 peticiones HTTP, ejecuta el cargador dentro del contenedor del backend:

```powershell
docker compose exec backend python scripts/seed_users.py --count 100000
```

Usa el prefijo `loadtest-user` por defecto; volver a ejecutar el comando no duplica esos usuarios. Para probar otra cantidad o separar pruebas, cambia `--count` y `--prefix`:

```powershell
docker compose exec backend python scripts/seed_users.py --count 100000 --prefix prueba-1
```

Los usuarios se crean sin rostro (`face_encoding: null`), por lo que sirven para medir consultas, listados y existencia de usuario, pero no para login facial. El script imprime el tiempo y la velocidad de inserción; mide el tiempo de respuesta de la API con una herramienta de carga como k6 o ApacheBench después de llenar la base.

Los endpoints de registro, consulta y login no requieren claves administrativas. El `JWT_SECRET` se usa para firmar los tokens devueltos después de una autenticación biométrica.

## Prueba de vida facial

El registro y el login facial requieren cinco fotogramas capturados desde la cámara en aproximadamente un segundo. La interfaz solicita un parpadeo y el backend comprueba que todos los fotogramas contienen un solo rostro y que la apertura de los ojos cambia. Una imagen única ya no es válida para estas rutas.

El reto ahora incluye tres acciones en orden aleatorio: parpadear, girar la cabeza y abrir la boca. El orden se firma en el backend y caduca en dos minutos; cada acción se valida contra sus propios fotogramas, por lo que un vídeo con una secuencia fija no debería superar el reto.

Esta comprobación sigue siendo una defensa básica. No sustituye un sistema anti-spoofing certificado: para un entorno de alto riesgo se debe integrar un proveedor especializado con detección de presentación (por ejemplo, ataques con pantalla, vídeo o máscara), además de usar HTTPS, límites de intentos y auditoría.
