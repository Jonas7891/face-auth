import React, { useEffect, useRef, useState } from "react";

const h = React.createElement;
const API_BASE = import.meta.env.VITE_API_URL || "";
const ACTION_LABELS = { blink: "Parpadea una vez", turn: "Gira lentamente la cabeza", open_mouth: "Abre y cierra la boca" };

async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
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
    const [error, setError] = useState(false);
    const [health, setHealth] = useState("Comprobando API...");
    const [livenessAction, setLivenessAction] = useState("");
    const [users, setUsers] = useState([]);
    const [activeUsers, setActiveUsers] = useState([]);
    const [readerState, setReaderState] = useState("Comprobando lector...");
    const fingerprintRef = useRef({ api: null, channel: null, device: null, capturing: false, sample: null, quality: null });

    const setStatus = (text, isError = false) => { setMessage(text); setError(isError); };

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
        return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
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

    const captureLiveness = async () => {
        const challenge = await get("/api/face/liveness-challenge");
        let token = challenge.challenge_token;
        const frames = [];
        for (let actionIndex = 0; actionIndex < challenge.actions.length; actionIndex += 1) {
            const action = challenge.actions[actionIndex];
            let complete = false;
            for (let attempt = 0; attempt < 2 && !complete; attempt += 1) {
                setLivenessAction(`${ACTION_LABELS[action] || "Sigue la instruccion"}${attempt ? " (repite)" : ""}`);
                await wait(350);
                const actionFrames = [];
                for (let frame = 0; frame < 6; frame += 1) { actionFrames.push(captureFrame()); if (frame < 5) await wait(280); }
                try {
                    const result = await post("/api/face/liveness-step", { challenge_token: token, action_index: actionIndex, images: actionFrames });
                    frames.push(...actionFrames); token = result.challenge_token; complete = true;
                } catch (requestError) { if (attempt === 1) throw requestError; setStatus(`${requestError.message}. Repite el mismo gesto.`, true); }
            }
        }
        setLivenessAction("");
        return { challengeToken: token, image: frames[Math.floor(frames.length / 2)] };
    };

    const run = async (operation) => {
        if (busy) return;
        setBusy(true);
        try { await operation(); } catch (runError) { setStatus(runError.message, true); }
        finally { setBusy(false); setLivenessAction(""); }
    };

    const registerFace = () => run(async () => {
        const name = username.trim(); if (!name) throw new Error("Escribe un usuario.");
        setStatus("Preparando prueba de vida..."); const liveness = await captureLiveness(); setStatus("Registrando rostro...");
        const data = await post("/api/register/face", { username: name, image: liveness.image, challenge_token: liveness.challengeToken });
        setStatus(data.message || "Rostro registrado"); await loadUsers();
    });

    const loginFace = () => run(async () => {
        setStatus("Preparando prueba de vida..."); const liveness = await captureLiveness(); setStatus("Verificando rostro...");
        const data = await post("/api/login/face", { image: liveness.image, challenge_token: liveness.challengeToken });
        setStatus(`Login OK: ${data.username} (distancia: ${Number(data.distance).toFixed(3)})`);
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

    const refreshReader = async () => {
        const webSdk = window.WebSdk; const fingerprintSdk = window.Fingerprint;
        if (!webSdk || !fingerprintSdk) { setReaderState("SDK DigitalPersona no cargado"); return; }
        try {
            const channel = new webSdk.WebChannelClient(new webSdk.WebChannelOptions({}));
            const fingerprintApi = new fingerprintSdk.WebApi(channel);
            await channel.connect(); const devices = await fingerprintApi.enumerateDevices();
            fingerprintRef.current = { ...fingerprintRef.current, api: fingerprintApi, channel, device: devices?.[0] || null };
            setReaderState(devices?.length ? "Lector conectado" : "Sin lector conectado");
        } catch (readerError) { setReaderState(`Servicio DigitalPersona no disponible: ${readerError.message}`); }
    };

    const startFingerprint = async () => {
        const state = fingerprintRef.current;
        if (!state.api || !state.device) { setReaderState("Detecta un lector DigitalPersona antes de capturar."); return; }
        state.api.onQualityReported = (quality) => { state.quality = quality?.code ?? quality?.qualityCode ?? quality?.value ?? quality; };
        state.api.onSamplesAcquired = (event) => { state.sample = { format: event.sampleFormat ?? null, data: normalizeSample(event.samples), quality: state.quality }; setReaderState("Huella capturada."); };
        state.api.onAcquisitionStarted = () => { state.capturing = true; setReaderState("Coloca el dedo en el lector..."); };
        state.api.onAcquisitionStopped = () => { state.capturing = false; };
        try { await state.api.startAcquisition(window.Fingerprint.SampleFormat.PngImage, state.device); }
        catch (_) { await state.api.startAcquisition(window.Fingerprint.SampleFormat.PngImage); }
    };

    const saveFingerprint = () => run(async () => {
        const name = username.trim(); const sample = fingerprintRef.current.sample;
        if (!name) throw new Error("Escribe un usuario para asociar la huella."); if (!sample) throw new Error("Captura una huella primero.");
        const data = await post("/api/register/fingerprint-sample", { username: name, sample_format: sample.format, data_base64: sample.data, quality: sample.quality });
        setStatus(data.message); setReaderState("Muestra guardada."); await loadUsers();
    });

    const loginFingerprint = () => run(async () => {
        const sample = fingerprintRef.current.sample; if (!sample) throw new Error("Captura una huella primero.");
        const data = await post("/api/login/fingerprint-sample", { sample_format: sample.format, data_base64: sample.data, quality: sample.quality });
        setStatus(`Login OK: ${data.username}`); await loadUsers();
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
            h("span", { className: "corner top-left" }), h("span", { className: "corner top-right" }),
            h("span", { className: "corner bottom-left" }), h("span", { className: "corner bottom-right" }),
            h("span", { className: "frame-tag" }, livenessAction || "FACE 01"),
            !cameraReady && h("div", { className: "camera-permission" },
                h("strong", null, "Acceso a la camara"),
                h("span", null, "El navegador te preguntara si permites usarla."),
                h(Button, { variant: "cyan", disabled: busy, onClick: startCamera }, "Dar acceso a la camara")
            )
        ),
        h("div", { className: "actions" }, h(Button, { variant: "amber", disabled: !cameraReady || busy, onClick: registerFace }, "Registrar rostro"), h(Button, { variant: "cyan", disabled: !cameraReady || busy, onClick: loginFace }, "Login rostro")),
        livenessAction && h("p", { className: "instruction" }, livenessAction)
    );
    const fingerprintPanel = h("section", { className: "section" }, h("span", { className: "label" }, "HUELLA / DIGITALPERSONA 4500"), h("p", { className: "reader-state" }, readerState), h("div", { className: "actions" }, h(Button, { onClick: refreshReader }, "Detectar lector"), h(Button, { variant: "amber", disabled: busy, onClick: startFingerprint }, "Iniciar captura")), h("div", { className: "actions" }, h(Button, { variant: "amber", disabled: busy, onClick: saveFingerprint }, "Guardar muestra"), h(Button, { variant: "cyan", disabled: busy, onClick: loginFingerprint }, "Iniciar sesion")));
    const status = h("section", { className: "section" }, h("span", { className: "label" }, "ESTADO"), h("p", { className: `status ${error ? "status-error" : "status-ok"}` }, message));
    const sideHeader = h("div", { className: "method-bar" }, h("div", null, h("span", { className: "label" }, "VISTA ACTIVA"), h("b", null, sideView === "active" ? "LOGEADOS" : "DIRECTORIO")), h(Button, { onClick: () => setSideView(sideView === "active" ? "directory" : "active") }, `Ver ${sideView === "active" ? "directorio" : "logeados"}`));
    const instruction = h("div", { className: "side-instruction", role: "status", "aria-live": "polite" }, h("span", { className: "label" }, "INSTRUCCION ACTUAL"), h("strong", null, livenessAction || message));
    const sidePanel = h("aside", { className: "side-card" }, sideHeader, sideView === "active" ? h(UserList, { active: true, title: "Personas logeadas", users: activeUsers }) : h(UserList, { title: "Personas registradas", users }), h(Button, { onClick: loadUsers }, "Actualizar listas"), instruction);
    return h("div", { className: "app-shell" }, h("main", { className: "main-card" }, header, identity, methodBar, method === "face" ? facePanel : fingerprintPanel, status), sidePanel);
}
