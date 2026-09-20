import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendor = resolve(root, "public", "vendor");
await mkdir(vendor, { recursive: true });
await copyFile(resolve(root, "node_modules", "@digitalpersona", "websdk", "dist", "websdk.client.ui.js"), resolve(vendor, "websdk.client.ui.js"));
await copyFile(resolve(root, "node_modules", "@digitalpersona", "fingerprint", "dist", "fingerprint.sdk.js"), resolve(vendor, "fingerprint.sdk.js"));
