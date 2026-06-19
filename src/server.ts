import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createApp } from "./api.js";

const DB_PATH = process.env.DB_PATH ?? "./data/split.db";
const PORT = Number(process.env.PORT ?? 3001);

// Ensure data directory exists
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname2, "../../public");

const db = openDb(DB_PATH);
const app = createApp(db, PUBLIC_DIR);

// Only listen when run as the main entry point, not when imported in tests
const thisFile = fileURLToPath(import.meta.url);
const mainScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isMain =
  mainScript === thisFile ||
  mainScript === thisFile.replace(/\.ts$/, ".js") ||
  // handle --experimental-strip-types running the .ts directly
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js");

if (isMain) {
  app.listen(PORT, () => {
    console.log(`split server listening on http://localhost:${PORT}`);
  });
}

export { app, db };
