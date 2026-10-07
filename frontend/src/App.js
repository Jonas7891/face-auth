import React, { useEffect, useRef, useState } from "react";

const h = React.createElement;
const API_BASE = import.meta.env.VITE_API_URL || "";
const ACTION_LABELS = { blink: "Parpadea una vez", turn: "Gira lentamente la cabeza", open_mouth: "Abre y cierra la boca" };

async function api(path, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE.replace(/\/+$/, "")}${path}`;
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = Array.isArray(data.detail) ? data.detail.map((item) => `${item.loc?.join(".") || "campo"}: ${item.msg}`).join("; ") : data.detail;
        throw new Error(detail || `Error ${response.status}`);
    }
    return data;
}

const get = (path) => api(path);
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function Button({ children, onClick, variant = "ghost", disabled = false }) {
    return h("button", { className: `button button-${variant}`, disabled, onClick, type: "button" }, children);
}

function UserList({ title, users, active }) {
    return h("section", { className: "panel user-list" },
        h("div", { className: "panel-heading" },
            h("div", null, h("span", { className: "label" }, active ? "SESIONES ACTUALES" : "DIRECTORIO"), h("h2", null, title)),
            h("strong", { className: "count" }, users.length)
        ),
        users.length
            ? users.map((user) => h("div", { className: "user-row", key: user.username }, h("span", null, user.username), h("b", null, active ? "●" : "✓")))
            : h("p", { className: "empty" }, active ? "Nadie ha iniciado sesion." : "Aun no hay personas registradas.")
    );
}

export default function App() {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const [username, setUsername] = useState("");
    const [method, setMethod] = useState("face");
    const [sideView, setSideView] = useState("active");
    const [cameraReady, setCameraReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("Pulsa el boton para permitir el acceso a la camara.");
    const [tone, setTone] = useState("info");
    const [health, setHealth] = useState("Comprobando API...");
    const [livenessAction, setLivenessAction] = useState("");
    const [livenessProgress, setLivenessProgress] = useState(null);
    const [users, setUsers] = useState([]);
    const [activeUsers, setActiveUsers] = useState([]);
    const [readerState, setReaderState] = useState("Comprobando lector...");
    const [readerChecking, setReaderChecking] = useState(false);
    const [readerError, setReaderError] = useState(false);
    const [fingerprintCapturing, setFingerprintCapturing] = useState(false);
    const [fingerprintSampleReady, setFingerprintSampleReady] = useState(false);
    const fingerprintRef = useRef({ api: null, channel: null, device: null, capturing: false, stopping: false, sample: null, quality: null, checking: false, pollTimer: null });

    const setStatus = (text, toneOrError = "info") => { setMessage(text); setTone(toneOrError === true ? "error" : toneOrError); };

    const loadUsers = async () => {
        try {
            const [all, active] = await Promise.all([get("/api/users"), get("/api/users/active")]);
            setUsers(all.filter((user) => user.has_face));
            setActiveUsers(active);
        } catch (requestError) { setStatus(requestError.message, true); }
    };

    useEffect(() => {
        let active = true;
        const start = async () => {
            try { const data = await get("/api/health"); if (active) setHealth(data.status === "ok" ? "API conectada" : "API sin conexion"); }
            catch (_) { if (active) setHealth("API sin conexion"); }
            if (active) await loadUsers();
        };
        start();
        refreshReader();
        return () => {
            active = false;
            clearInterval(fingerprintRef.current.pollTimer);
            streamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    const startCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) { setStatus("Este navegador no permite acceder a la camara.", true); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" }, audio: false });
            streamRef.current = stream;
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setCameraReady(true);
            setStatus("Camara lista. Ya puedes registrar o verificar tu rostro.");
        } catch (cameraError) {
            const reason = cameraError.name === "NotAllowedError"
                ? "El permiso de la camara fue denegado. Activalo en la configuracion del navegador y vuelve a intentarlo."
                : cameraError.name === "NotFoundError"
                    ? "No se encontro ninguna camara disponible."
                    : cameraError.name === "NotReadableError"
                        ? "La camara esta siendo usada por otra aplicacion."
                        : `No se pudo acceder a la camara: ${cameraError.message}`;
            setStatus(reason, true);
        }
    };

    const captureFrame = () => {
        if (!videoRef.current?.videoWidth) throw new Error("La camara aun no esta lista");
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / videoRef.current.videoWidth);
        canvas.width = Math.round(videoRef.current.videoWidth * scale);
        canvas.height = Math.round(videoRef.current.videoHeight * scale);
        canvas.getContext("2d").drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.82);
    };

    const captureLiveness = async (gestureCount = 3) => {
        const challenge = await get(`/api/face/liveness-challenge?actions=${gestureCount}`);
        let token = challenge.challenge_token;
        const frames = [];
        for (let actionIndex = 0; actionIndex < challenge.actions.length; actionIndex += 1) {
            const action = challenge.actions[actionIndex];
            let complete = false;
            for (let attempt = 0; attempt < 2 && !complete; attempt += 1) {
                setLivenessAction(`${ACTION_LABELS[action] || "Sigue la instruccion"}${attempt ? " (repite el gesto)" : ""}`);
                setLivenessProgress({ done: actionIndex, total: challenge.actions.length });
                await wait(350);
                const actionFrames = [];
                for (let frame = 0; frame < 6; frame += 1) { actionFrames.push(captureFrame()); if (frame < 5) await wait(280); }
                try {
                    const result = await post("/api/face/liveness-step", { challenge_token: token, action_index: actionIndex, images: actionFrames });
                    frames.push(...actionFrames); token = result.challenge_token; complete = true;
                    setLivenessProgress({ done: actionIndex + 1, total: challenge.actions.length });
                } catch (requestError) { if (attempt === 1) throw requestError; setStatus(`${requestError.message}. Repite el mismo gesto.`, true); }
            }
        }
        setLivenessAction("");
        setLivenessProgress(null);
        return { challengeToken: token, image: frames[Math.floor(frames.length / 2)] };
    };

    const run = async (operation) => {
        if (busy) return;
        setBusy(true);
        try { await operation(); } catch (runError) { setStatus(runError.message, true); }
        finally { setBusy(false); setLivenessAction(""); setLivenessProgress(null); }
    };

    const registerFace = () => run(async () => {
        const name = username.trim(); if (!name) throw new Error("Escribe un usuario.");
        setStatus("Te pediremos 3 gestos para registrar tu rostro.", "info"); const liveness = await captureLiveness(3); setStatus("Registrando rostro...");
        const data = await post("/api/register/face", { username: name, image: liveness.image, challenge_token: liveness.challengeToken });
        setStatus(data.message || "Rostro registrado", "ok"); await loadUsers();
    });

    const loginFace = () => run(async () => {
        setStatus("Te pediremos 2 gestos para entrar.", "info"); const liveness = await captureLiveness(2); setStatus("Verificando rostro...");
        const data = await post("/api/login/face", { image: liveness.image, challenge_token: liveness.challengeToken });
        setStatus(`Login OK: ${data.username} (distancia: ${Number(data.distance).toFixed(3)})`, "ok");
        await loadUsers();
    });

    const checkUser = () => run(async () => {
        const name = username.trim(); if (!name) throw new Error("Escribe un usuario."); setStatus("Consultando usuario...");
        const data = await get(`/api/users/${encodeURIComponent(name)}/exists`);
        setStatus(!data.exists ? `"${name}" no esta registrado todavia.` : `"${name}" existe - rostro: ${data.has_face ? "si" : "no"}, huella: ${data.has_fingerprint ? "si" : "no"}`);
    });

    const normalizeSample = (value) => {
        let encoded = decodeURIComponent(String(value)).trim();
        if (!encoded.startsWith("[")) return encoded;
        try { const chunks = JSON.parse(encoded.replace(/]\s*\[/g, ",")); return chunks.join(""); } catch (_) { return encoded; }
    };

    const refreshReader = async (silent = false) => {
        const state = fingerprintRef.current;
        if (state.checking) return;
        state.checking = true;
        if (!silent) {
            setReaderChecking(true);
            setReaderError(false);
            setReaderState("Conectando con el runtime DigitalPersona de este equipo...");
        }
        try {
            let { api: fingerprintApi, channel } = state;
            if (!fingerprintApi) {
                const webSdk = window.WebSdk;
                const fingerprintSdk = window.Fingerprint;
                if (!webSdk || !fingerprintSdk) throw new Error("No se cargaron los SDK web de DigitalPersona.");
                channel = new webSdk.WebChannelClient(new webSdk.WebChannelOptions({}));
                fingerprintApi = new fingerprintSdk.WebApi(channel);
                await channel.connect();
                fingerprintRef.current = { ...fingerprintRef.current, api: fingerprintApi, channel };
            }
            const devices = await fingerprintApi.enumerateDevices();
            const device = devices?.[0] || null;
            const previousDevice = fingerprintRef.current.device;
            const key = (value) => value && (typeof value === "string" ? value : value.deviceId || value.id || value.name || String(value));
            const changed = key(previousDevice) !== key(device);
            fingerprintRef.current = {
                ...fingerprintRef.current,
                api: fingerprintApi,
                channel,
                device,
                sample: changed ? null : fingerprintRef.current.sample,
            };
            setReaderError(false);
            if (!silent || changed) {
                setReaderState(device
                    ? "Lector DigitalPersona conectado."
                    : "Runtime conectado; esperando un lector DigitalPersona.");
            }
        } catch (error) {
            fingerprintRef.current = { ...fingerprintRef.current, api: null, channel: null, device: null, sample: null };
            setReaderError(true);
            setReaderState(`No se pudo conectar con el runtime DigitalPersona: ${error.message}`);
        } finally {
            fingerprintRef.current.checking = false;
            if (!fingerprintRef.current.pollTimer) {
                fingerprintRef.current.pollTimer = setInterval(() => { void refreshReader(true); }, 3000);
            }
            if (!silent) setReaderChecking(false);
        }
    };

    const startFingerprint = async () => {
        const state = fingerprintRef.current;
        if (!state.api || !state.device) { setReaderState("Detecta un lector DigitalPersona antes de capturar."); return; }
        if (state.capturing) return;
        state.sample = null;
        state.stopping = false;
        setFingerprintSampleReady(false);
        state.api.onQualityReported = (quality) => { state.quality = quality?.code ?? quality?.qualityCode ?? quality?.value ?? quality; };
        state.api.onSamplesAcquired = async (event) => {
            if (state.sample || state.stopping) return;
            const sampleData = normalizeSample(event.samples);
            if (!sampleData) {
                setReaderState("El lector no devolvio una muestra valida. Intenta capturar de nuevo.");
                return;
            }
            state.sample = { format: event.sampleFormat ?? null, data: sampleData, quality: state.quality };
            setFingerprintSampleReady(true);
            setReaderState("Huella capturada. Retira el dedo; ya puedes guardar o iniciar sesion.");
            state.stopping = true;
            try {
                await state.api.stopAcquisition(event.deviceUid || state.device);
                state.capturing = false;
                setFingerprintCapturing(false);
            } catch (error) {
                setReaderState(`Huella capturada, pero no se pudo detener el lector: ${error.message}. Puedes guardar la muestra.`);
            } finally {
                state.stopping = false;
            }
        };
        state.api.onAcquisitionStarted = () => {
            state.capturing = true;
            setFingerprintCapturing(true);
            setReaderState("Coloca el dedo en el lector...");
        };
        state.api.onAcquisitionStopped = () => {
            state.capturing = false;
            setFingerprintCapturing(false);
        };
        state.capturing = true;
        setFingerprintCapturing(true);
        setReaderState("Iniciando captura. Coloca el dedo en el lector...");
        try {
            try {
                await state.api.startAcquisition(window.Fingerprint.SampleFormat.PngImage, state.device);
            } catch (_) {
                await state.api.startAcquisition(window.Fingerprint.SampleFormat.PngImage);
            }
        } catch (error) {
            state.capturing = false;
            setFingerprintCapturing(false);
            setReaderState(`No se pudo iniciar la captura: ${error.message}`);
        }
    };

    const stopFingerprint = async () => {
        const state = fingerprintRef.current;
        if (!state.api || !state.capturing) return;
        try {
            await state.api.stopAcquisition(state.device);
            state.capturing = false;
            setFingerprintCapturing(false);
            setReaderState(state.sample
                ? "Lector detenido. La huella capturada esta lista para guardar."
                : "Captura detenida. Puedes iniciar una nueva captura.");
        } catch (error) {
            setReaderState(`No se pudo detener el lector: ${error.message}`);
        }
    };

    const saveFingerprint = () => run(async () => {
        const name = username.trim(); const sample = fingerprintRef.current.sample;
        if (!name) throw new Error("Escribe un usuario para asociar la huella."); if (!sample) throw new Error("Captura una huella primero.");
        const data = await post("/api/register/fingerprint-sample", { username: name, sample_format: sample.format, data_base64: sample.data, quality: sample.quality });
        fingerprintRef.current.sample = null;
        setFingerprintSampleReady(false);
        setStatus(data.message, "ok"); setReaderState("Muestra guardada en el servidor."); await loadUsers();
    });

    const loginFingerprint = () => run(async () => {
        const sample = fingerprintRef.current.sample; if (!sample) throw new Error("Captura una huella primero.");
        const data = await post("/api/login/fingerprint-sample", { sample_format: sample.format, data_base64: sample.data, quality: sample.quality });
        fingerprintRef.current.sample = null;
        setFingerprintSampleReady(false);
        setStatus(`Login OK: ${data.username}`, "ok"); await loadUsers();
    });

    const header = h("header", null,
        h("span", { className: "eyebrow" }, "FACE AUTH / WEB CONSOLE"),
        h("h1", null, "Registro / Login Facial"),
        h("p", { className: "subtitle" }, "Autenticacion biometrica con una prueba de vida activa."),
        h("p", { className: "health" }, h("i", { className: health === "API conectada" ? "ok" : "fail" }), health)
    );
    const identity = h("section", { className: "section" }, h("span", { className: "label" }, "IDENTIDAD"), h("input", { value: username, onChange: (event) => setUsername(event.target.value), placeholder: "Usuario", autoComplete: "off" }), h("button", { className: "text-button", onClick: checkUser, disabled: busy, type: "button" }, "⌕ Verificar disponibilidad"));
    const methodBar = h("div", { className: "method-bar" }, h("b", null, method === "face" ? "ROSTRO" : "HUELLA"), h(Button, { onClick: () => setMethod(method === "face" ? "fingerprint" : "face") }, `Cambiar a ${method === "face" ? "huella" : "rostro"}`));
    const facePanel = h("section", { className: "section" },
        h("span", { className: "label" }, "ROSTRO"),
        h("div", { className: "viewfinder" },
            h("video", { ref: videoRef, autoPlay: true, playsInline: true, muted: true }),
            h("span", { className: "face-oval" }),
            h("span", { className: "corner top-left" }), h("span", { className: "corner top-right" }),
            h("span", { className: "corner bottom-left" }), h("span", { className: "corner bottom-right" }),
            h("span", { className: "frame-tag" }, livenessProgress ? `Gesto ${Math.min(livenessProgress.done + 1, livenessProgress.total)} de ${livenessProgress.total}` : "FACE 01"),
            !cameraReady && h("div", { className: "camera-permission" },
                h("strong", null, "Acceso a la camara"),
                h("span", null, "El navegador te preguntara si permites usarla."),
                h(Button, { variant: "cyan", disabled: busy, onClick: startCamera }, "Dar acceso a la camara")
            )
        ),
        livenessProgress && h("div", { className: "progress" },
            h("div", { className: "dots" }, livenessProgress && Array.from({ length: livenessProgress.total }, (_, index) => h("span", { key: index, className: `dot${index < livenessProgress.done ? " dot-done" : ""}` }))),
            h("div", { className: "progress-bar" }, h("span", { style: { width: `${(livenessProgress.done / livenessProgress.total) * 100}%` } }))
        ),
        h("div", { className: "actions" }, h(Button, { variant: "amber", disabled: !cameraReady || busy, onClick: registerFace }, busy ? "Trabajando..." : "Registrar rostro (3 gestos)"), h(Button, { variant: "cyan", disabled: !cameraReady || busy, onClick: loginFace }, busy ? "Trabajando..." : "Login rostro (2 gestos)")),
        livenessAction && h("p", { className: "instruction" }, livenessAction)
    );
    const fingerprintPanel = h("section", { className: "section" },
        h("span", { className: "label" }, "HUELLA / DIGITALPERSONA 4500"),
        h("p", { className: "reader-state", role: "status", "aria-live": "polite" }, readerState),
        readerError && h("p", { className: "reader-help" }, "Instala e inicia el runtime oficial de DigitalPersona en este mismo equipo, además del driver. La web no puede acceder al lector usando solo el driver. Si abres la web desde otro equipo, instala allí también el runtime y conecta allí el lector."),
        h("div", { className: "actions" },
            h(Button, { onClick: refreshReader, disabled: readerChecking }, readerChecking ? "Buscando..." : "Detectar lector"),
            h(Button, { variant: "amber", disabled: busy || fingerprintCapturing || !fingerprintRef.current.device, onClick: startFingerprint }, fingerprintSampleReady ? "Capturar otra vez" : "Iniciar captura"),
            fingerprintCapturing && h(Button, { variant: "ghost", disabled: busy, onClick: stopFingerprint }, "Detener lector")
        ),
        h("div", { className: "actions" },
            h(Button, { variant: "amber", disabled: busy || !fingerprintSampleReady, onClick: saveFingerprint }, "Guardar muestra"),
            h(Button, { variant: "cyan", disabled: busy || !fingerprintSampleReady, onClick: loginFingerprint }, "Iniciar sesion")
        )
    );
    const status = h("section", { className: "section" }, h("span", { className: "label" }, "ESTADO"), h("p", { className: `status status-${tone}` }, `${tone === "ok" ? "✓ " : tone === "error" ? "✕ " : ""}${message}`));
    const sideHeader = h("div", { className: "method-bar" }, h("div", null, h("span", { className: "label" }, "VISTA ACTIVA"), h("b", null, sideView === "active" ? "LOGEADOS" : "DIRECTORIO")), h(Button, { onClick: () => setSideView(sideView === "active" ? "directory" : "active") }, `Ver ${sideView === "active" ? "directorio" : "logeados"}`));
    const instruction = h("div", { className: "side-instruction", role: "status", "aria-live": "polite" }, h("span", { className: "label" }, "INSTRUCCION ACTUAL"), h("strong", null, livenessAction || message));
    const sidePanel = h("aside", { className: "side-card" }, sideHeader, sideView === "active" ? h(UserList, { active: true, title: "Personas logeadas", users: activeUsers }) : h(UserList, { title: "Personas registradas", users }), h(Button, { onClick: loadUsers }, "Actualizar listas"), instruction);
    return h("div", { className: "app-shell" }, h("main", { className: "main-card" }, header, identity, methodBar, method === "face" ? facePanel : fingerprintPanel, status), sidePanel);
}
