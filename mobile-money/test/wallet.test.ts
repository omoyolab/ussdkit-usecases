import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { testPhone } from "@omoyolab/ussdkit";

import { buildApp } from "../src/app.js";
import { demoLedger } from "../src/ledger.js";

const AMINA = "+254712345678"; // KES 12,500, PIN 1234
const JOHN = "+254722000111"; // KES 800, PIN 4321
const CODE = "*384*100#";

let warnings: string[] = [];

function setup(phone = AMINA) {
  let n = 0;
  warnings = [];
  const ledger = demoLedger({
    nextId: () => `TK${String(++n).padStart(4, "0")}`,
    now: () => new Date("2026-10-02T09:00:00Z"),
  });
  const app = buildApp({ ledger, onWarning: (message) => warnings.push(message) });
  return { ledger, app, phone: testPhone(app, { phone, serviceCode: CODE }) };
}

// Every screen any test shows must fit on a phone.
afterEach(() => {
  assert.deepEqual(warnings, [], "a screen was longer than 182 characters");
});

describe("home", () => {
  test("shows the six things a customer can do", async () => {
    const { phone } = setup();
    assert.equal(
      await phone.dial(),
      "Wallet\n1. Send money\n2. Withdraw cash\n3. Buy airtime\n4. Pay bill\n5. Buy goods\n6. My account",
    );
  });

  test("an unknown choice says so and shows the menu again", async () => {
    const { phone } = setup();
    await phone.dial();
    assert.match(await phone.send("7"), /^Invalid choice\.\nWallet\n1\. Send money/);
  });
});

describe("send money", () => {
  test("moves the money, charges the fee and gives a receipt", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    assert.match(await phone.send("1"), /Enter phone number/);
    assert.match(await phone.send("0722000111"), /Enter amount/);
    assert.equal(await phone.send("500"), "Send KES 500 to JOHN KAMAU 0722000111?\nFee KES 7\n1. Confirm\n2. Cancel\n0. Back");
    assert.match(await phone.send("1"), /Enter your Wallet PIN/);
    assert.equal(
      await phone.send("1234"),
      "TK0001 Confirmed. KES 500 sent to JOHN KAMAU 0722000111. Fee KES 7. New balance KES 11,993.",
    );
    assert.equal(phone.ended, true);
    assert.equal(ledger.find(AMINA)!.balance, 11_993);
    assert.equal(ledger.find(JOHN)!.balance, 1_300);
  });

  test("accepts the number in any of the ways people write it", async () => {
    for (const written of ["0722000111", "+254722000111", "254722000111", "0722 000 111"]) {
      const { phone } = setup();
      await phone.dial();
      assert.match(await phone.type("1", written), /Enter amount/, written);
    }
  });

  test("turns away a number that is not registered, and the sender's own", async () => {
    const { phone } = setup();
    await phone.dial();
    await phone.send("1");
    assert.match(await phone.send("0799999999"), /^That number is not registered for Wallet\./);
    assert.match(await phone.send("0712345678"), /^That is your own number\./);
    assert.match(await phone.send("12345"), /^Enter a mobile number like 0712345678\./);
  });

  test("turns away an amount in words, with decimals, or out of range", async () => {
    const { phone } = setup();
    await phone.dial();
    await phone.type("1", "0722000111");
    for (const bad of ["five hundred", "500.50", "200000", "-5"]) {
      assert.match(await phone.send(bad), /^Enter an amount from KES 1 to KES 150,000/, bad);
    }
    assert.match(await phone.send("1,500"), /^Send KES 1,500 to JOHN KAMAU/);
  });

  test("cancel moves nothing", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    assert.equal(await phone.type("1", "0722000111", "500", "2"), "Cancelled. No money was sent.");
    assert.equal(phone.ended, true);
    assert.equal(ledger.find(AMINA)!.balance, 12_500);
  });

  test("not enough money is only said after the PIN, and moves nothing", async () => {
    const { phone, ledger } = setup(JOHN);
    await phone.dial();
    assert.equal(
      await phone.type("1", "0712345678", "5000", "1", "4321"),
      "Failed. You do not have enough money in your Wallet for this and its fee.",
    );
    assert.equal(ledger.find(JOHN)!.balance, 800);
    assert.equal(ledger.find(AMINA)!.balance, 12_500);
  });

  test("the fee counts towards what the sender needs", async () => {
    const { phone, ledger } = setup(JOHN);
    await phone.dial();
    // KES 800 in the wallet, sending 800 costs 813.
    assert.match(await phone.type("1", "0712345678", "800", "1", "4321"), /^Failed\./);
    assert.equal(ledger.find(JOHN)!.balance, 800);
  });
});

describe("PIN", () => {
  test("three wrong PINs lock the account, and it stays locked on the next dial", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    await phone.type("1", "0722000111", "500", "1");
    assert.match(await phone.send("0000"), /^Wrong PIN\. 2 attempts left\./);
    assert.match(await phone.send("1111"), /^Wrong PIN\. 1 attempt left\./);
    assert.match(await phone.send("2222"), /^Your PIN is locked after 3 wrong attempts/);
    assert.equal(phone.ended, true);
    assert.equal(ledger.find(AMINA)!.balance, 12_500);
    assert.match(await phone.dial(), /^Your PIN is locked/);
  });

  test("a slip that is not four digits does not use up an attempt", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    await phone.type("1", "0722000111", "500", "1");
    assert.match(await phone.send("12"), /^A PIN is 4 digits\./);
    assert.match(await phone.send("abcd"), /^A PIN is 4 digits\./);
    assert.equal(ledger.find(AMINA)!.failedPins, 0);
  });

  test("a correct PIN clears earlier wrong attempts", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    await phone.type("6", "1", "0000", "1234");
    assert.equal(ledger.find(AMINA)!.failedPins, 0);
    assert.equal(phone.screen, "Your Wallet balance is KES 12,500.");
  });
});

describe("getting around", () => {
  test("0 goes back one screen and keeps what was entered", async () => {
    const { phone } = setup();
    await phone.dial();
    await phone.type("1", "0722000111", "500");
    assert.match(await phone.send("0"), /^Enter amount in KES/);
    assert.match(await phone.send("750"), /^Send KES 750 to JOHN KAMAU/);
  });

  test("00 goes home from anywhere", async () => {
    const { phone } = setup();
    await phone.dial();
    await phone.type("4", "888880", "A-1002");
    assert.match(await phone.send("00"), /^Wallet\n1\. Send money/);
  });
});

describe("withdraw cash", () => {
  test("names the agent, charges the withdrawal fee and gives a receipt", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    await phone.send("2");
    assert.match(await phone.send("999999"), /^We do not know that agent number/);
    assert.match(await phone.send("123456"), /^Enter amount in KES/);
    assert.equal(await phone.send("2000"), "Withdraw KES 2,000 from Mama Njeri Shop?\nFee KES 29\n1. Confirm\n2. Cancel\n0. Back");
    assert.equal(
      await phone.type("1", "1234"),
      "TK0001 Confirmed. Take KES 2,000 from Mama Njeri Shop. Fee KES 29. New balance KES 10,471.",
    );
    assert.equal(ledger.find(AMINA)!.balance, 10_471);
  });
});

describe("buy airtime", () => {
  test("for my phone", async () => {
    const { phone } = setup();
    await phone.dial();
    assert.equal(
      await phone.type("3", "1", "100", "1234"),
      "TK0001 Confirmed. KES 100 airtime bought for your phone. New balance KES 12,400.",
    );
  });

  test("for another phone", async () => {
    const { phone } = setup();
    await phone.dial();
    assert.equal(
      await phone.type("3", "2", "0733222333", "50", "1234"),
      "TK0001 Confirmed. KES 50 airtime bought for 0733222333. New balance KES 12,450.",
    );
  });
});

describe("pay bill and buy goods", () => {
  test("pay bill asks for the business, the account and the amount", async () => {
    const { phone } = setup();
    await phone.dial();
    await phone.send("4");
    assert.match(await phone.send("111111"), /^We do not know that business number\./);
    await phone.type("888880", "a-1002");
    assert.equal(await phone.send("3400"), "Pay KES 3,400 to City Power, account A-1002?\n1. Confirm\n2. Cancel\n0. Back");
    assert.equal(
      await phone.type("1", "1234"),
      "TK0001 Confirmed. KES 3,400 paid to City Power for account A-1002. New balance KES 9,100.",
    );
  });

  test("buy goods pays a till", async () => {
    const { phone } = setup();
    await phone.dial();
    assert.equal(
      await phone.type("5", "510001", "650", "1", "1234"),
      "TK0001 Confirmed. KES 650 paid to Mwangi Groceries. New balance KES 11,850.",
    );
  });
});

describe("my account", () => {
  test("the statement lists the newest first, pages, and 0 returns to the account menu", async () => {
    const { phone } = setup();
    for (const amount of ["100", "200", "300", "400"]) {
      await phone.dial();
      await phone.type("3", "1", amount, "1234");
    }
    await phone.dial();
    assert.equal(
      await phone.type("6", "2", "1234"),
      "Mini statement\n1. 2/10 Airtime KES 400\n2. 2/10 Airtime KES 300\n3. 2/10 Airtime KES 200\n9. More\n0. Back",
    );
    assert.equal(await phone.send("9"), "Mini statement\n1. 2/10 Airtime KES 100\n8. Previous\n0. Back");
    assert.match(await phone.send("8"), /Airtime KES 400/);
    // Back skips the PIN prompt the customer has already passed.
    assert.match(await phone.send("0"), /^My account\n1\. Balance/);
  });

  test("an empty statement says so", async () => {
    const { phone } = setup();
    await phone.dial();
    assert.equal(await phone.type("6", "2", "1234"), "Mini statement\nNo transactions yet.\n0. Back");
  });

  test("changing the PIN makes the old one wrong and the new one right", async () => {
    const { phone, ledger } = setup();
    await phone.dial();
    await phone.type("6", "3", "1234");
    assert.match(await phone.send("7777"), /^Choose a PIN that is not one digit repeated\./);
    assert.match(await phone.send("5823"), /^Enter the new PIN again/);
    assert.match(await phone.send("5832"), /^The two PINs do not match\./);
    assert.equal(await phone.send("5823"), "Your Wallet PIN has been changed.");
    assert.equal(ledger.verifyPin(AMINA, "1234").ok, false);
    assert.equal(ledger.verifyPin(AMINA, "5823").ok, true);
  });

  test("the new PIN is never kept in the session", async () => {
    const { phone, app } = setup();
    await phone.dial();
    await phone.type("6", "3", "1234", "5823");
    const session = await app.options.store.get(phone.sessionId);
    assert.ok(session);
    assert.equal(JSON.stringify(session.data).includes("5823"), false);
  });
});

describe("a number that is not registered", () => {
  test("is told so", async () => {
    const { phone } = setup("+254700000001");
    assert.equal(await phone.dial(), "This number is not registered for Wallet. Visit an agent with your ID.");
  });
});
