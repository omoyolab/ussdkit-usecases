// Picks the data: the live API when a key is set in .env, otherwise the saved snapshot.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { liveSource, snapshotSource } from "./civic.js";
import type { CivicSource, Snapshot } from "./civic.js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export function chooseSource(): { source: CivicSource; mode: string } {
  const envFile = here("../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const apiKey = process.env.PLUS234FEED_API_KEY?.trim();
  if (apiKey) {
    return {
      source: liveSource({ apiKey, ...(process.env.PLUS234FEED_API_URL ? { baseUrl: process.env.PLUS234FEED_API_URL } : {}) }),
      mode: "live plus234feed intel API",
    };
  }
  const snapshot = JSON.parse(readFileSync(here("../data/snapshot.json"), "utf8")) as Snapshot;
  return { source: snapshotSource(snapshot), mode: `saved data from ${snapshot.savedAt}, ${Object.keys(snapshot.states).join(", ")} only` };
}
