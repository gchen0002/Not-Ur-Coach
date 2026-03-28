import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(projectRoot, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const targetDir = path.join(projectRoot, "public", "mediapipe", "wasm");

if (!existsSync(sourceDir)) {
  throw new Error(`MediaPipe source directory not found: ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });

process.stdout.write(`Synced MediaPipe WASM assets to ${targetDir}\n`);
