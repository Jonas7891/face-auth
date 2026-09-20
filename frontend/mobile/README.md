# Face Auth en Expo Go

Esta app móvil reutiliza el backend existente para registrar y verificar rostros desde un teléfono. La huella DigitalPersona continúa disponible en la app web, porque Expo Go no puede acceder a un lector USB mediante el SDK web.

## Preparar la prueba

1. Instala Expo Go en el teléfono.
2. Conecta el teléfono y el computador a la misma red Wi-Fi.
3. Obtén la IPv4 del computador con `ipconfig`.
4. Copia `.env.example` a `.env` y cambia `EXPO_PUBLIC_API_URL`:

```text
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
```

5. Desde esta carpeta ejecuta:

```powershell
npm install
npx expo start
```

6. Escanea el QR con Expo Go. En Android puedes usar `npx expo start --tunnel` si la red local bloquea la conexión.

El backend debe estar iniciado con `docker compose up -d`. Si Windows Firewall bloquea el puerto 8000, permite el acceso para redes privadas.

## Flujo de prueba

- Concede el permiso de cámara.
- Escribe un usuario nuevo y pulsa `Registrar rostro`.
- Realiza los gestos mostrados en pantalla.
- Repite el proceso con `Login rostro` para verificar la identidad.

La cámara y la prueba de vida funcionan en Expo Go. El lector DigitalPersona 4500 no está disponible en Expo Go y debe probarse desde la app web.
