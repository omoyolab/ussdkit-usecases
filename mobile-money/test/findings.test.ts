// These tests pin down behaviour in ussdkit 0.1.0 that the use case had to work around or could not.
// Each one names its finding in FINDINGS.md. When ussdkit fixes one, its test here is rewritten.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp, end, lines, menu, paginate, testPhone } from "@omoyolab/ussdkit";

import { buildApp } from "../src/app.js";
import { demoLedger } from "../src/ledger.js";

const AMINA = "+254712345678";

test("finding 4: a session cannot end on the screen it opens with", async () => {
  const app = buildApp({ ledger: demoLedger() });
  const phone = testPhone(app, { phone: "+254700000001" });
  assert.match(await phone.dial(), /not registered/);
  // The customer has been told to visit an agent, yet the gateway is asked to keep the session open.
  assert.equal(phone.ended, false);
});

test("finding 6: paginate's previous-page key is the app's back key, so 0 leaves the list", async () => {
  const items = ["A", "B", "C", "D", "E", "F"];
  const app = createApp()
    .screen("home", menu(lines("Home", "1. List"), { "1": "list" }))
    .screen("list", {
      render: ({ data }) => paginate(items, { page: (data.page as number) ?? 0, perPage: 3 }).text,
      handle: ({ input, data }) => {
        const page = paginate(items, { page: (data.page as number) ?? 0, perPage: 3 });
        if (page.isNext(input)) data.page = page.page + 1;
        if (page.isPrev(input)) data.page = page.page - 1;
        return { retry: "" };
      },
    });
  const phone = testPhone(app);
  await phone.dial();
  await phone.type("1", "9");
  assert.match(phone.screen, /0\. Back/); // the list offers 0 for the previous page
  await phone.send("0");
  assert.match(phone.screen, /^Home/); // and 0 took the customer out of the list instead
});

test("finding 8: a lost session replays handlers with side effects, and locks out a customer who typed the right PIN", async () => {
  const ledger = demoLedger();
  const first = buildApp({ ledger });
  const sessionId = "session-1";
  const inputs: string[] = [];
  const say = (app: ReturnType<typeof buildApp>, input: string) => {
    if (input !== "") inputs.push(input);
    return app.handle({ sessionId, phone: AMINA, serviceCode: "*384*100#", input, inputs: [...inputs] });
  };

  await say(first, "");
  for (const input of ["6", "1"]) await say(first, input);
  await say(first, "0000"); // wrong, 2 attempts left
  await say(first, "1111"); // wrong, 1 attempt left
  assert.equal(ledger.find(AMINA)!.failedPins, 2);

  // The server restarts and the in-memory session is gone. The gateway resends everything typed so far.
  const restarted = buildApp({ ledger });
  const response = await say(restarted, "1234"); // the right PIN, on the third try

  // ussdkit rebuilt the session by running every handler again, including the two wrong PINs.
  assert.match(response.text, /^Your PIN is locked/);
  assert.equal(ledger.find(AMINA)!.locked, true);
});

test("finding 9: 0 typed as an answer is taken as Back, so it can never be entered", async () => {
  const app = buildApp({ ledger: demoLedger() });
  const phone = testPhone(app, { phone: AMINA });
  await phone.dial();
  await phone.type("1", "0722000111");
  assert.match(phone.screen, /^Enter amount in KES/);
  // The customer types 0. The app never sees it and cannot say "enter an amount from KES 1".
  await phone.send("0");
  assert.match(phone.screen, /^Send money\nEnter phone number/);
});
