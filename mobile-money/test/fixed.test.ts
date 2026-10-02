// What ussdkit 0.1.0 got wrong for this menu, now right in 0.2.0. One test per finding in FINDINGS.md.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp, menu, paginate, prompt, testPhone } from "@omoyolab/ussdkit";

import { buildApp } from "../src/app.js";
import { demoLedger } from "../src/ledger.js";

const AMINA = "+254712345678";

test("finding 4: a number that should not get the menu is ended on the first screen", async () => {
  const phone = testPhone(buildApp({ ledger: demoLedger() }), { phone: "+254700000001" });
  assert.match(await phone.dial(), /not registered/);
  assert.equal(phone.ended, true);
});

test("finding 5: Back from the statement skips the PIN the customer already passed", async () => {
  const phone = testPhone(buildApp({ ledger: demoLedger() }), { phone: AMINA });
  await phone.dial();
  await phone.type("6", "2", "1234");
  assert.match(await phone.send("0"), /^My account/);
});

test("finding 6: turning back a page does not leave the list", async () => {
  const items = ["A", "B", "C", "D", "E", "F"];
  const app = createApp<{ page: number }>()
    .screen("home", menu("Home", [["List", "list"]]))
    .screen("list", {
      render: ({ data }) => paginate(items, { page: data.page ?? 0, perPage: 3 }).text,
      handle: ({ input, data }) => {
        const page = paginate(items, { page: data.page ?? 0, perPage: 3 });
        if (page.isNext(input)) data.page = page.page + 1;
        if (page.isPrev(input)) data.page = page.page - 1;
        return { retry: "" };
      },
    });
  const phone = testPhone(app);
  await phone.dial();
  await phone.type("1", "9");
  assert.match(phone.screen, /8\. Previous/);
  assert.match(await phone.send("8"), /^1\. A/);
});

test("finding 8: a lost session does not count wrong PINs twice, and the right PIN still works", async () => {
  const ledger = demoLedger();
  const phone = testPhone(buildApp({ ledger }), { phone: AMINA });
  await phone.dial();
  await phone.type("6", "1", "0000", "1111"); // two wrong PINs, one attempt left
  assert.equal(ledger.find(AMINA)!.failedPins, 2);

  await phone.loseSession(); // the server restarts; the gateway will resend everything typed so far

  assert.equal(await phone.send("1234"), "Your Wallet balance is KES 12,500.");
  assert.equal(ledger.find(AMINA)!.locked, false);
  assert.equal(ledger.find(AMINA)!.failedPins, 0);
});

test("finding 8: money still moves exactly once when the session is lost before the PIN", async () => {
  const ledger = demoLedger();
  const phone = testPhone(buildApp({ ledger }), { phone: AMINA });
  await phone.dial();
  await phone.type("1", "0722000111", "500", "1");
  await phone.loseSession();
  assert.match(await phone.send("1234"), /Confirmed\. KES 500 sent to JOHN KAMAU/);
  assert.equal(ledger.find(AMINA)!.balance, 11_993);
  assert.equal(ledger.find(AMINA)!.txns.length, 1);
});

test("finding 9: a prompt that needs 0 as an answer can have it", async () => {
  const app = createApp()
    .screen("home", menu("Home", [["Dependants", "dependants"]]))
    .screen(
      "dependants",
      prompt("How many dependants?", (input) => ({ end: `Recorded ${input}.` }), { back: false }),
    );
  const phone = testPhone(app);
  await phone.dial();
  assert.equal(await phone.type("1", "0"), "Recorded 0.");
});

test("finding 10: a test can print the session as a transcript for the docs", async () => {
  const phone = testPhone(buildApp({ ledger: demoLedger() }), { phone: AMINA });
  await phone.dial();
  await phone.type("6", "1", "1234");
  const transcript = phone.transcript();
  assert.match(transcript, /> 6\n/);
  assert.match(transcript, /│ Your Wallet balance is KES 12,500\. │/);
});
