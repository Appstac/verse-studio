import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./paths";

const here = path.dirname(fileURLToPath(import.meta.url));
// Settings can live next to the code (apps/worker/.env) or in ~/.verse-studio/.env
dotenv.config({ path: path.join(here, "..", ".env"), quiet: true });
dotenv.config({ path: path.join(dataDir(), ".env"), quiet: true });

export function loadCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing. Put them in apps/worker/.env (see docs/SETUP.md, step 2).",
    );
  }
  return { clientId, clientSecret };
}

const tokenPath = () => path.join(dataDir(), "google-token.json");

export interface StoredToken {
  refresh_token?: string | null;
  access_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
}

export function loadToken(): StoredToken | null {
  try {
    return JSON.parse(fs.readFileSync(tokenPath(), "utf8"));
  } catch {
    return null;
  }
}

export function saveToken(t: StoredToken) {
  const prev = loadToken() ?? {};
  const merged = { ...prev, ...t, refresh_token: t.refresh_token ?? prev.refresh_token };
  fs.writeFileSync(tokenPath(), JSON.stringify(merged, null, 2), { mode: 0o600 });
}

export const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}`;
export const VERSION = "0.1.0";
