import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";

const expoHost = Constants.expoConfig?.hostUri?.split(":")[0];
const API_BASE = (process.env.EXPO_PUBLIC_API_URL || (expoHost ? `http://${expoHost}:8000` : "http://172.20.10.2:8000")).replace(/\/$/, "");
const ACTION_LABELS = {
  blink: "Parpadea una vez",
  turn: "Gira lentamente la cabeza",
  open_mouth: "Abre y cierra la boca",
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => `${item.loc?.join(".") || "campo"}: ${item.msg}`).join("; ")
      : data.detail;
    throw new Error(detail || `Error ${response.status}`);
  }
  return data;
}

function ActionButton({ children, onPress, disabled, accent = "teal" }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        accent === "amber" ? styles.buttonAmber : styles.buttonTeal,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

export default function App() {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Comprueba la conexión y concede permiso de cámara.");
  const [statusError, setStatusError] = useState(false);
  const [health, setHealth] = useState("Comprobando API...");
  const [instruction, setInstruction] = useState("");
  const [users, setUsers] = useState([]);

  const setMessage = (message, isError = false) => {
    setStatus(message);
    setStatusError(isError);
  };

  const loadUsers = async () => {
    try {
      const data = await api("/api/users");
      setUsers(data.filter((user) => user.has_face));
    } catch (error) {
      setMessage(error.message, true);
    }
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([api("/api/health"), api("/api/users")])
      .then(([healthData, userData]) => {
        if (!mounted) return;
        setHealth(healthData.status === "ok" ? "API conectada" : "API sin conexión");
        setUsers(userData.filter((user) => user.has_face));
        setMessage("Cámara lista para registrar o verificar tu rostro.");
      })
      .catch((error) => {
        if (mounted) {
          setHealth("API sin conexión");
          setMessage(`${error.message}. API: ${API_BASE}. Verifica que el teléfono y el PC estén en la misma Wi-Fi.`, true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const captureFrame = async () => {
    if (!cameraRef.current) throw new Error("La cámara aún no está lista.");
    const picture = await cameraRef.current.takePictureAsync({
      base64: true,
      quality: 0.82,
      skipProcessing: true,
    });
    if (!picture?.base64) throw new Error("No se pudo capturar la imagen.");
    return `data:image/jpeg;base64,${picture.base64}`;
  };

  const captureLiveness = async () => {
    const challenge = await api("/api/face/liveness-challenge");
    let token = challenge.challenge_token;
    const frames = [];

    for (let actionIndex = 0; actionIndex < challenge.actions.length; actionIndex += 1) {
      const action = challenge.actions[actionIndex];
      let completed = false;
      for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
        setInstruction(`${ACTION_LABELS[action] || "Sigue la instrucción"}${attempt ? " (repite)" : ""}`);
        await wait(350);
        const actionFrames = [];
        for (let frame = 0; frame < 6; frame += 1) {
          actionFrames.push(await captureFrame());
          if (frame < 5) await wait(280);
        }
        try {
          const result = await api("/api/face/liveness-step", {
            method: "POST",
            body: JSON.stringify({ challenge_token: token, action_index: actionIndex, images: actionFrames }),
          });
          frames.push(...actionFrames);
          token = result.challenge_token;
          completed = true;
        } catch (error) {
          if (attempt === 1) throw error;
          setMessage(`${error.message}. Repite el gesto.`, true);
        }
      }
    }

    setInstruction("");
    return { challengeToken: token, image: frames[Math.floor(frames.length / 2)] };
  };

  const runFaceAction = async (action) => {
    if (busy) return;
    const name = username.trim();
    if (action === "register" && !name) {
      setMessage("Escribe un usuario para registrar el rostro.", true);
      return;
    }
    setBusy(true);
    try {
      setMessage("Preparando prueba de vida...");
      const liveness = await captureLiveness();
      setMessage(action === "register" ? "Registrando rostro..." : "Verificando rostro...");
      const path = action === "register" ? "/api/register/face" : "/api/login/face";
      const payload = action === "register"
        ? { username: name, image: liveness.image, challenge_token: liveness.challengeToken }
        : { image: liveness.image, challenge_token: liveness.challengeToken };
      const result = await api(path, { method: "POST", body: JSON.stringify(payload) });
      setMessage(result.message || `Login OK: ${result.username}`);
      await loadUsers();
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      setBusy(false);
      setInstruction("");
    }
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color="#53e0c7" /></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar style="light" />
        <Text style={styles.eyebrow}>FACE AUTH / EXPO GO</Text>
        <Text style={styles.title}>Necesitamos la cámara</Text>
        <Text style={styles.subtitle}>Se usa para capturar los gestos de la prueba de vida.</Text>
        <ActionButton onPress={requestPermission}>Conceder permiso</ActionButton>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <FlatList
        contentContainerStyle={styles.content}
        data={users}
        keyExtractor={(item) => item.username}
        ListHeaderComponent={(
          <View>
            <Text style={styles.eyebrow}>FACE AUTH / EXPO GO</Text>
            <Text style={styles.title}>Registro facial</Text>
            <Text style={styles.subtitle}>Prueba de vida desde tu teléfono.</Text>
            <Text style={[styles.health, health === "API conectada" ? styles.ok : styles.fail]}>● {health}</Text>
            <View style={styles.cameraFrame}>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              <Text style={styles.cameraTag}>{instruction || "FACE 01"}</Text>
            </View>
            <Text style={styles.sectionLabel}>IDENTIDAD</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setUsername}
              placeholder="Usuario"
              placeholderTextColor="#718096"
              style={styles.input}
              value={username}
            />
            <View style={styles.actions}>
              <ActionButton accent="amber" disabled={busy} onPress={() => runFaceAction("register")}>Registrar rostro</ActionButton>
              <ActionButton disabled={busy} onPress={() => runFaceAction("login")}>Login rostro</ActionButton>
            </View>
            {instruction ? <Text style={styles.instruction}>{instruction}</Text> : null}
            <Text style={styles.sectionLabel}>ESTADO</Text>
            <Text style={[styles.status, statusError ? styles.statusError : styles.statusOk]}>{status}</Text>
            <Text style={styles.sectionLabel}>DIRECTORIO CON ROSTRO ({users.length})</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.userRow}>
            <Text style={styles.userName}>{item.username}</Text>
            <Text style={styles.userCheck}>OK</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aún no hay rostros registrados.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0e14" },
  content: { padding: 22, paddingBottom: 42 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 28, backgroundColor: "#0a0e14" },
  eyebrow: { color: "#53e0c7", fontSize: 12, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: "#e8edf3", fontSize: 32, fontWeight: "800", marginTop: 12 },
  subtitle: { color: "#8d9aae", fontSize: 15, lineHeight: 22, marginTop: 6 },
  health: { fontSize: 13, marginTop: 16, marginBottom: 18 },
  ok: { color: "#53e0c7" },
  fail: { color: "#ff8177" },
  cameraFrame: { aspectRatio: 0.78, overflow: "hidden", backgroundColor: "#030507", borderColor: "#344255", borderRadius: 14, borderWidth: 1, position: "relative" },
  corner: { borderColor: "#53e0c7", borderWidth: 2, height: 28, position: "absolute", width: 28 },
  cornerTopLeft: { left: 14, top: 14, borderBottomWidth: 0, borderRightWidth: 0 },
  cornerTopRight: { right: 14, top: 14, borderBottomWidth: 0, borderLeftWidth: 0 },
  cornerBottomLeft: { bottom: 14, left: 14, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBottomRight: { bottom: 14, right: 14, borderLeftWidth: 0, borderTopWidth: 0 },
  cameraTag: { alignSelf: "center", backgroundColor: "#0a0e14cc", borderColor: "#53e0c780", borderRadius: 14, borderWidth: 1, bottom: 14, color: "#53e0c7", fontSize: 11, paddingHorizontal: 10, paddingVertical: 5, position: "absolute" },
  sectionLabel: { color: "#718096", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginBottom: 9, marginTop: 22 },
  input: { backgroundColor: "#161d27", borderColor: "#344255", borderRadius: 8, borderWidth: 1, color: "#e8edf3", fontSize: 16, paddingHorizontal: 14, paddingVertical: 13 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  button: { alignItems: "center", borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 12 },
  buttonTeal: { backgroundColor: "#53e0c7", borderColor: "#53e0c7" },
  buttonAmber: { backgroundColor: "#161d27", borderColor: "#e8a948" },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#071914", fontSize: 12, fontWeight: "800", textAlign: "center" },
  instruction: { color: "#e8a948", fontSize: 15, fontWeight: "700", paddingVertical: 12, textAlign: "center" },
  status: { borderRadius: 8, fontSize: 14, lineHeight: 20, padding: 14 },
  statusOk: { backgroundColor: "#e8ffe8", color: "#10151d" },
  statusError: { backgroundColor: "#3a1f25", color: "#ffb2ad" },
  userRow: { borderBottomColor: "#263140", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 13 },
  userName: { color: "#d6dee8", fontSize: 14 },
  userCheck: { color: "#53e0c7", fontSize: 12, fontWeight: "800" },
  empty: { color: "#718096", paddingVertical: 14, textAlign: "center" },
});
