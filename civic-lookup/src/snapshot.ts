// Saves a few states from the live API to data/snapshot.json, so anyone can try the menu without a key:
//   npm run snapshot -- Lagos FCT Kano
// Uses about 3 calls per state plus one per seat and one for the presidential list.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { liveSource } from "./civic.js";
import type { Snapshot } from "./civic.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
try {
  process.loadEnvFile(envFile);
} catch {
  // No .env: the key may already be in the environment.
}
const apiKey = process.env.PLUS234FEED_API_KEY?.trim();
if (!apiKey) {
  console.error("Set PLUS234FEED_API_KEY in .env first. See README.md, Get a key.");
  process.exit(2);
}
const states = process.argv.slice(2);
if (states.length === 0) {
  console.error("Name the states to save, such as: npm run snapshot -- Lagos FCT Kano");
  process.exit(2);
}

const live = liveSource({ apiKey, timeoutMs: 30000, ...(process.env.PLUS234FEED_API_URL ? { baseUrl: process.env.PLUS234FEED_API_URL } : {}) });
const snapshot: Snapshot = {
  savedAt: new Date().toISOString().slice(0, 10),
  credit: "INEC and NASS records, via plus234feed",
  states: {},
  candidates: {},
  presidential: await live.presidential(),
};
for (const state of states) {
  const [lgas, seats] = await Promise.all([live.lgas(state), live.seats(state)]);
  snapshot.states[state] = { lgas, seats };
  for (const seat of seats) snapshot.candidates[seat.code] = await live.candidates(seat.code);
  console.log(`${state}: ${lgas.length} LGAs, ${seats.length} seats`);
}
writeFileSync(fileURLToPath(new URL("../data/snapshot.json", import.meta.url)), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved ${states.length} states in ${live.calls()} calls.`);
