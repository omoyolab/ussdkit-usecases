import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { testPhone } from "@omoyolab/ussdkit";

import { NOT_AVAILABLE, SORRY, buildApp, shortName } from "../src/app.js";
import { CivicUnavailable, liveSource, snapshotSource } from "../src/civic.js";
import type { CivicSource, Snapshot } from "../src/civic.js";
import { fixture } from "./fixture.js";

/** A phone on the fixture. Every screen over 182 characters fails the test that drew it. */
function dial(source: CivicSource = snapshotSource(fixture)) {
  const warnings: string[] = [];
  const phone = testPhone(buildApp({ source, onWarning: (m) => warnings.push(m) }), { phone: "+2348030000000" });
  return { phone, warnings };
}

test("my senator and rep: state, LGA, then both members with their parties", async () => {
  const { phone, warnings } = dial();
  assert.match(await phone.dial(), /^Know your lawmakers\n1\. My senator and rep/);
  assert.match(await phone.send("1"), /Choose your state\n1\. Lagos/);
  assert.match(await phone.send("1"), /Lagos: choose your LGA\n1\. Amber/);
  const answer = await phone.send("1");
  assert.match(answer, /^Amber, Lagos/);
  assert.match(answer, /Senator, Sample East:\nAda Okafor \(AAA\)/);
  assert.match(answer, /Rep, Amber\/Brook:\nBello Musa \(BBB\)/);
  assert.deepEqual(warnings, []);
});

test("a split LGA names both House seats", async () => {
  const { phone } = dial();
  await phone.dial();
  const answer = await phone.type("1", "1", "3");
  assert.match(answer, /^Cedar Island, Lagos/);
  assert.match(answer, /2 House seats cover it:/);
  assert.match(answer, /Chika Obi \(AAA\)/);
  // The register spells it "Cedar-Island" for the second seat; it still matches.
  assert.match(answer, /Dayo Ade \(CCC\)/);
});

test("a vacant seat says so", async () => {
  const { phone } = dial();
  await phone.dial();
  await phone.type("1", "1", "9");
  assert.match(await phone.send("1"), /Senator, Sample West:\nNo sitting member on record/);
});

test("a long name keeps the first and last word", async () => {
  assert.equal(shortName("Oluwaseyifunmi Adebayo-Williamson Ogunleye"), "Oluwaseyifunmi Ogunleye");
  assert.equal(shortName("Ada Okafor"), "Ada Okafor");
  assert.equal(shortName("Olatunbosun- Olarewaju"), "Olatunbosun-Olarewaju");
  const { phone } = dial();
  await phone.dial();
  assert.match(await phone.type("1", "1", "4"), /Oluwaseyifunmi Ogunleye \(BBB\)/);
});

test("typing letters narrows the list, and one match is chosen at once", async () => {
  const { phone } = dial();
  await phone.dial();
  await phone.type("1", "1");
  // "isl" starts a word in "Cedar Island" only.
  assert.match(await phone.send("isl"), /^Cedar Island, Lagos/);
});

test("typing letters that match several shows only those", async () => {
  const { phone } = dial();
  await phone.dial();
  await phone.type("1", "1");
  // "h" starts a word in "Delta Hill" and in "Harbour".
  const narrowed = await phone.send("h");
  assert.match(narrowed, /1\. Delta Hill\n2\. Harbour/);
  assert.doesNotMatch(narrowed, /Amber/);
  assert.match(await phone.send("zzz"), /Nothing starts with "zzz"/);
});

test("a long LGA list pages with 9 and 8", async () => {
  const { phone } = dial();
  await phone.dial();
  const first = await phone.type("1", "1");
  assert.match(first, /6\. Fern\n9\. More/);
  const second = await phone.send("9");
  assert.match(second, /1\. Grove\n2\. Harbour\n8\. Previous/);
  assert.match(await phone.send("8"), /1\. Amber/);
});

test("who is running: the LGA's seats with counts, then candidates in party order", async () => {
  const { phone, warnings } = dial();
  await phone.dial();
  const seats = await phone.type("2", "1", "1");
  assert.match(seats, /^Amber, Lagos: 2027\n1\. Senate, Sample East: 9 running\n2\. House, Amber\/Brook: 3 running/);
  const first = await phone.send("1");
  // Party order, not sitting member first. The sitting member is marked.
  assert.match(first, /^Senate, Sample East\nAAA: Ada Okafor\*\nBBB: Bayo Ojo\nEEE: Emeka Nwosu\nHHH: Halima Sani\n\*sitting member\n9\. More/);
  // The next page has no mark, so no note.
  assert.doesNotMatch(await phone.send("9"), /sitting member/);
  const last = await phone.send("9");
  assert.doesNotMatch(last, /9\. More/);
  assert.match(last, /ZZZ: Zainab Bello/);
  assert.match(last, /Source: test data/);
  assert.deepEqual(warnings, []);
});

test("from my representatives, one key goes to who is running", async () => {
  const { phone } = dial();
  await phone.dial();
  await phone.type("1", "1", "1");
  assert.match(await phone.send("1"), /^Amber, Lagos: 2027/);
});

test("presidential tickets in party order, with a party that has not named one", async () => {
  const { phone } = dial();
  await phone.dial();
  const answer = await phone.send("3");
  assert.match(answer, /^President, 2027\nAAA: Abu Example\nMMM: not yet named\nZZZ: Zara Example/);
});

test("when the records cannot be reached, the caller is told and the session ends", async () => {
  const failing: CivicSource = {
    ...snapshotSource(fixture),
    seats: async () => {
      throw new CivicUnavailable("timed out");
    },
  };
  const { phone, warnings } = dial(failing);
  await phone.dial();
  assert.equal(await phone.type("1", "1"), SORRY);
  assert.equal(phone.ended, true);
  assert.match(warnings[0] ?? "", /timed out/);
});

test("a list the API refuses says it is not available, and does not ask the caller to dial again", async () => {
  const refusing: CivicSource = {
    ...snapshotSource(fixture),
    candidates: async () => {
      throw new CivicUnavailable("/v1/elections/2027/seats/FC-359-FCT: HTTP 400", 400);
    },
  };
  const { phone } = dial(refusing);
  await phone.dial();
  assert.equal(await phone.type("2", "1", "1", "1"), NOT_AVAILABLE);
});

test("a lost session is rebuilt and lands on the same answer", async () => {
  const { phone } = dial();
  await phone.dial();
  await phone.type("2", "1", "1");
  await phone.loseSession();
  assert.match(await phone.send("2"), /^House, Amber\/Brook\nAAA: Ife Ola\nBBB: Bello Musa\*/);
});

// ---------------------------------------------------------------- the live client, on a fake network

function fakeApi(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const seen: Array<{ url: string; key: string | null }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, key: new Headers(init?.headers).get("X-API-Key") });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

test("live: sends the key, unwraps the answer, and asks for each state once", async () => {
  const api = fakeApi(() =>
    json({ seats: [{ code: "SD/001/LA", name: "Lagos East", chamber: "senate", lgas: ["Ikeja"], candidates: 4, sitting_member: { name: "A B", party: "XYZ" } }] }),
  );
  const live = liveSource({ apiKey: "test-key", fetch: api.fetch });
  const [a, b] = await Promise.all([live.seats("Lagos"), live.seats("Lagos")]);
  assert.deepEqual(a, b);
  assert.equal(api.seen.length, 1);
  assert.equal(api.seen[0]?.key, "test-key");
  assert.match(api.seen[0]?.url ?? "", /\/v1\/elections\/2027\/seats\?state=Lagos$/);
  assert.deepEqual(a[0]?.sittingMember, { name: "A B", party: "XYZ" });
  assert.equal(a[0]?.candidateCount, 4);
});

test("live: a seat code goes in the path with dashes, and a state with a space is encoded", async () => {
  const api = fakeApi((url) => (url.includes("/seats/") ? json({ candidates: [] }) : json({ lgas: [] })));
  const live = liveSource({ apiKey: "k", fetch: api.fetch });
  await live.candidates("FC/003/AB");
  await live.lgas("Akwa Ibom");
  assert.match(api.seen[0]?.url ?? "", /\/seats\/FC-003-AB$/);
  assert.match(api.seen[1]?.url ?? "", /\/states\/Akwa%20Ibom\/lgas$/);
});

test("live: an answer is kept for the TTL, then asked for again", async () => {
  let clock = 0;
  const api = fakeApi(() => json({ tickets: [] }));
  const live = liveSource({ apiKey: "k", fetch: api.fetch, ttlMs: 1000, now: () => clock });
  await live.presidential();
  clock = 999;
  await live.presidential();
  assert.equal(api.seen.length, 1);
  clock = 1000;
  await live.presidential();
  assert.equal(api.seen.length, 2);
});

test("live: an error is not kept, so the next caller tries again", async () => {
  let fail = true;
  const api = fakeApi(() => (fail ? new Response("{}", { status: 503 }) : json({ lgas: ["Ikeja"] })));
  const live = liveSource({ apiKey: "k", fetch: api.fetch });
  await assert.rejects(live.lgas("Lagos"), (error: unknown) => error instanceof CivicUnavailable && /HTTP 503/.test(error.message));
  fail = false;
  assert.deepEqual(await live.lgas("Lagos"), ["Ikeja"]);
});

test("live: a slow API fails fast, inside the time a network gives a USSD reply", async () => {
  const api = fakeApi(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  const live = liveSource({ apiKey: "k", fetch: api.fetch, timeoutMs: 50 });
  // The timeout's own timer does not hold a process open; a server does. Stand in for it.
  const hold = setTimeout(() => {}, 2000);
  const started = Date.now();
  await assert.rejects(live.presidential(), (error: unknown) => error instanceof CivicUnavailable && /timed out/.test(error.message));
  assert.ok(Date.now() - started < 1000);
  clearTimeout(hold);
});

for (const [label, data] of [
  ["the fixture", fixture],
  ["the saved Lagos and Rivers data", JSON.parse(readFileSync(new URL("../data/snapshot.json", import.meta.url), "utf8")) as Snapshot],
] as const)
test(`every screen for every LGA fits in 182 characters, on ${label}`, async () => {
  const source = snapshotSource(data);
  for (const state of source.states) {
    const lgas = await source.lgas(state);
    for (const [want, path] of [["1", []], ["2", ["1"]]] as const) {
      for (let i = 0; i < lgas.length; i++) {
        const { phone, warnings } = dial(source);
        await phone.dial();
        const position = String((i % 6) + 1);
        const turns = Math.floor(i / 6);
        await phone.type(want, String(source.states.indexOf(state) + 1), ...Array(turns).fill("9"), position, ...path);
        assert.deepEqual(warnings, [], `${state}, ${lgas[i]}`);
      }
    }
  }
});

test("deeper screens say how to go home, on the back line", async () => {
  const { phone } = dial();
  await phone.dial();
  assert.match(await phone.send("1"), /\n0\. Back$/);
  assert.match(await phone.send("1"), /\n0\. Back  00\. Home$/);
  assert.match(await phone.send("00"), /^Know your lawmakers/);
});

test("About keeps the call open, and Back returns to the menu", async () => {
  const { phone } = dial();
  await phone.dial();
  assert.match(await phone.send("4"), /^Know your lawmakers\nFind your senator/);
  assert.equal(phone.ended, false);
  assert.match(await phone.send("0"), /^Know your lawmakers\n1\. My senator and rep/);
});
