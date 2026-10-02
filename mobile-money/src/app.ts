// The menu. Everything a customer sees is in this file.
import { createHash } from "node:crypto";

import { createApp, lines, menu, paginate, prompt } from "@omoyolab/ussdkit";
import type { App, Context, Next, Screen } from "@omoyolab/ussdkit";

import { LedgerError, MAX_TXN } from "./ledger.js";
import type { Ledger, LedgerErrorCode, Txn } from "./ledger.js";
import { kes, local, parseAmount, parsePhone } from "./validate.js";

/**
 * What a session remembers between screens.
 * Finding 1: ctx.data is Record<string, unknown>, so every read needs this cast.
 */
interface Flow {
  to?: string;
  toName?: string;
  amount?: number;
  fee?: number;
  agent?: string;
  agentName?: string;
  airtimeFor?: string;
  business?: string;
  businessName?: string;
  billAccount?: string;
  till?: string;
  tillName?: string;
  newPinHash?: string;
  page?: number;
}
const flow = (ctx: Context): Flow => ctx.data as Flow;

/** Finding 2: nothing tells the user which key goes back. Every screen adds this line itself. */
const BACK = "0. Back";

const NOT_REGISTERED = "This number is not registered for Wallet. Visit an agent with your ID.";
const LOCKED = "Your PIN is locked after 3 wrong attempts. Visit an agent with your ID to reset it.";

const FAILURES: Record<LedgerErrorCode, string> = {
  insufficient: "Failed. You do not have enough money in your Wallet for this and its fee.",
  limit: `Failed. The most you can move at once is ${kes(MAX_TXN)}.`,
  "same-account": "Failed. You cannot send money to your own number.",
  unknown: "Failed. We could not find that account. No money has moved.",
};

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface BuildOptions {
  ledger: Ledger;
  onWarning?: (message: string) => void;
}

export function buildApp({ ledger, onWarning }: BuildOptions): App {
  /**
   * The PIN step every money movement ends with.
   * Finding 3: there is no way to share a step between flows, so each flow registers its own
   * copy of this screen under its own id.
   */
  function pinScreen(onCorrect: (ctx: Context) => Next): Screen {
    return prompt(lines("Enter your Wallet PIN", BACK), (input, ctx) => {
      // Not four digits is a typing slip, not a wrong PIN. It does not use up an attempt.
      if (!/^\d{4}$/.test(input)) return { retry: "A PIN is 4 digits." };
      const result = ledger.verifyPin(ctx.phone, input);
      if (!result.ok) {
        if (result.locked) return { end: LOCKED };
        return { retry: `Wrong PIN. ${result.left} ${result.left === 1 ? "attempt" : "attempts"} left.` };
      }
      try {
        return onCorrect(ctx);
      } catch (error) {
        if (error instanceof LedgerError) return { end: FAILURES[error.code] };
        throw error;
      }
    });
  }

  const receipt = (txn: Txn, what: string): string =>
    `${txn.id} Confirmed. ${what}${txn.fee ? ` Fee ${kes(txn.fee)}.` : ""} New balance ${kes(txn.balance)}.`;

  const amountPrompt = (title: string, min: number, max: number, next: string, extra?: (amount: number) => Flow): Screen =>
    prompt(lines(title, BACK), (input) => {
      const amount = parseAmount(input, min, max);
      if (amount === null) return { retry: `Enter an amount from ${kes(min)} to ${kes(max)}, in figures.` };
      return { goto: next, data: { amount, ...extra?.(amount) } };
    });

  const mainMenu = menu(
    lines("Wallet", "1. Send money", "2. Withdraw cash", "3. Buy airtime", "4. Pay bill", "5. Buy goods", "6. My account"),
    { "1": "send.to", "2": "withdraw.agent", "3": "airtime", "4": "bill.business", "5": "goods.till", "6": "account" },
  );

  const app = createApp({ ttl: 120, ...(onWarning ? { onWarning } : {}) })
    .screen("home", {
      /**
       * Finding 4: a screen cannot end the session when it is first shown. An unregistered or
       * locked customer sees the message, but the session stays open until they press a key.
       */
      render: (ctx) => {
        const account = ledger.find(ctx.phone);
        if (!account) return NOT_REGISTERED;
        if (account.locked) return LOCKED;
        return (mainMenu.render as string);
      },
      handle: (ctx) => {
        const account = ledger.find(ctx.phone);
        if (!account) return { end: NOT_REGISTERED };
        if (account.locked) return { end: LOCKED };
        return mainMenu.handle!(ctx);
      },
    })

    // ---------- Send money: who, how much, confirm, PIN ----------
    .screen(
      "send.to",
      prompt(lines("Send money", "Enter phone number", BACK), (input, ctx) => {
        const to = parsePhone(input);
        if (!to) return { retry: "Enter a mobile number like 0712345678." };
        if (to === ctx.phone) return { retry: "That is your own number." };
        const recipient = ledger.find(to);
        if (!recipient) return { retry: "That number is not registered for Wallet." };
        return { goto: "send.amount", data: { to, toName: recipient.name } };
      }),
    )
    .screen(
      "send.amount",
      amountPrompt("Enter amount in KES", 1, MAX_TXN, "send.confirm", (amount) => ({ fee: ledger.sendFee(amount) })),
    )
    .screen(
      "send.confirm",
      menu(
        (ctx) => {
          const f = flow(ctx);
          return lines(`Send ${kes(f.amount!)} to ${f.toName} ${local(f.to!)}?`, `Fee ${kes(f.fee!)}`, "1. Confirm", "2. Cancel", BACK);
        },
        { "1": "send.pin", "2": () => ({ end: "Cancelled. No money was sent." }) },
      ),
    )
    .screen(
      "send.pin",
      pinScreen((ctx) => {
        const f = flow(ctx);
        const txn = ledger.send(ctx.phone, f.to!, f.amount!);
        return { end: receipt(txn, `${kes(txn.amount)} sent to ${f.toName} ${local(f.to!)}.`) };
      }),
    )

    // ---------- Withdraw cash: agent, how much, confirm, PIN ----------
    .screen(
      "withdraw.agent",
      prompt(lines("Withdraw cash", "Enter agent number", BACK), (input) => {
        const agentName = ledger.agents.get(input);
        if (!agentName) return { retry: "We do not know that agent number. Check the number on the agent's poster." };
        return { goto: "withdraw.amount", data: { agent: input, agentName } };
      }),
    )
    .screen(
      "withdraw.amount",
      amountPrompt("Enter amount in KES", 50, MAX_TXN, "withdraw.confirm", (amount) => ({ fee: ledger.withdrawFee(amount) })),
    )
    .screen(
      "withdraw.confirm",
      menu(
        (ctx) => {
          const f = flow(ctx);
          return lines(`Withdraw ${kes(f.amount!)} from ${f.agentName}?`, `Fee ${kes(f.fee!)}`, "1. Confirm", "2. Cancel", BACK);
        },
        { "1": "withdraw.pin", "2": () => ({ end: "Cancelled. No money was withdrawn." }) },
      ),
    )
    .screen(
      "withdraw.pin",
      pinScreen((ctx) => {
        const f = flow(ctx);
        const txn = ledger.withdraw(ctx.phone, f.agent!, f.amount!);
        return { end: receipt(txn, `Take ${kes(txn.amount)} from ${f.agentName}.`) };
      }),
    )

    // ---------- Buy airtime: whose phone, how much, PIN ----------
    .screen(
      "airtime",
      menu(lines("Buy airtime", "1. My phone", "2. Another phone", BACK), {
        "1": (ctx) => ({ goto: "airtime.amount", data: { airtimeFor: ctx.phone } }),
        "2": "airtime.phone",
      }),
    )
    .screen(
      "airtime.phone",
      prompt(lines("Enter phone number", BACK), (input) => {
        const airtimeFor = parsePhone(input);
        if (!airtimeFor) return { retry: "Enter a mobile number like 0712345678." };
        return { goto: "airtime.amount", data: { airtimeFor } };
      }),
    )
    .screen("airtime.amount", amountPrompt("Enter airtime amount in KES", 5, 10_000, "airtime.pin"))
    .screen(
      "airtime.pin",
      pinScreen((ctx) => {
        const f = flow(ctx);
        const txn = ledger.airtime(ctx.phone, f.airtimeFor!, f.amount!);
        const who = f.airtimeFor === ctx.phone ? "your phone" : local(f.airtimeFor!);
        return { end: receipt(txn, `${kes(txn.amount)} airtime bought for ${who}.`) };
      }),
    )

    // ---------- Pay bill: business, account, how much, confirm, PIN ----------
    .screen(
      "bill.business",
      prompt(lines("Pay bill", "Enter business number", BACK), (input) => {
        const businessName = ledger.paybills.get(input);
        if (!businessName) return { retry: "We do not know that business number." };
        return { goto: "bill.account", data: { business: input, businessName } };
      }),
    )
    .screen(
      "bill.account",
      prompt(lines("Enter account number", BACK), (input) => {
        if (!/^[A-Za-z0-9-]{1,20}$/.test(input)) return { retry: "Enter the account number on your bill." };
        return { goto: "bill.amount", data: { billAccount: input.toUpperCase() } };
      }),
    )
    .screen("bill.amount", amountPrompt("Enter amount in KES", 1, MAX_TXN, "bill.confirm"))
    .screen(
      "bill.confirm",
      menu(
        (ctx) => {
          const f = flow(ctx);
          return lines(`Pay ${kes(f.amount!)} to ${f.businessName}, account ${f.billAccount}?`, "1. Confirm", "2. Cancel", BACK);
        },
        { "1": "bill.pin", "2": () => ({ end: "Cancelled. Nothing was paid." }) },
      ),
    )
    .screen(
      "bill.pin",
      pinScreen((ctx) => {
        const f = flow(ctx);
        const txn = ledger.payBill(ctx.phone, f.business!, f.billAccount!, f.amount!);
        return { end: receipt(txn, `${kes(txn.amount)} paid to ${f.businessName} for account ${f.billAccount}.`) };
      }),
    )

    // ---------- Buy goods: till, how much, confirm, PIN ----------
    .screen(
      "goods.till",
      prompt(lines("Buy goods", "Enter till number", BACK), (input) => {
        const tillName = ledger.tills.get(input);
        if (!tillName) return { retry: "We do not know that till number. Check the number at the counter." };
        return { goto: "goods.amount", data: { till: input, tillName } };
      }),
    )
    .screen("goods.amount", amountPrompt("Enter amount in KES", 1, MAX_TXN, "goods.confirm"))
    .screen(
      "goods.confirm",
      menu(
        (ctx) => {
          const f = flow(ctx);
          return lines(`Pay ${kes(f.amount!)} to ${f.tillName}?`, "1. Confirm", "2. Cancel", BACK);
        },
        { "1": "goods.pin", "2": () => ({ end: "Cancelled. Nothing was paid." }) },
      ),
    )
    .screen(
      "goods.pin",
      pinScreen((ctx) => {
        const f = flow(ctx);
        const txn = ledger.buyGoods(ctx.phone, f.till!, f.amount!);
        return { end: receipt(txn, `${kes(txn.amount)} paid to ${f.tillName}.`) };
      }),
    )

    // ---------- My account: balance, statement, change PIN ----------
    .screen(
      "account",
      menu(lines("My account", "1. Balance", "2. Mini statement", "3. Change PIN", BACK), {
        "1": "account.balance.pin",
        "2": "account.statement.pin",
        "3": "account.pin.old",
      }),
    )
    .screen(
      "account.balance.pin",
      pinScreen((ctx) => ({ end: `Your Wallet balance is ${kes(ledger.find(ctx.phone)!.balance)}.` })),
    )
    .screen(
      "account.statement.pin",
      pinScreen(() => ({ goto: "account.statement", data: { page: 0 } })),
    )
    .screen("account.statement", {
      render: (ctx) => {
        /**
         * Finding 5: Back returns to whatever screen came before, even a PIN prompt. Pressing 0 on
         * the statement would ask for the PIN again. The history is edited here to skip it.
         */
        ctx.session.history = ctx.session.history.filter((id) => !id.endsWith(".pin"));
        const rows = statementRows(ledger.find(ctx.phone)!.txns);
        if (rows.length === 0) return lines("Mini statement", "No transactions yet.", BACK);
        /**
         * Finding 6: paginate() uses 0 for the previous page by default, which is also the app's
         * Back key, so 0 leaves the list instead of turning the page. Another key is set here.
         * Finding 7: paginate() always numbers its rows, even for a list nobody picks from.
         */
        const page = paginate(rows, { page: flow(ctx).page ?? 0, perPage: 3, nextKey: "9", prevKey: "8", prevLabel: "Previous" });
        return lines("Mini statement", page.text, BACK);
      },
      handle: (ctx) => {
        const rows = statementRows(ledger.find(ctx.phone)!.txns);
        const page = paginate(rows, { page: flow(ctx).page ?? 0, perPage: 3, nextKey: "9", prevKey: "8" });
        if (page.isNext(ctx.input)) {
          flow(ctx).page = page.page + 1;
          return { retry: "" };
        }
        if (page.isPrev(ctx.input)) {
          flow(ctx).page = page.page - 1;
          return { retry: "" };
        }
        return { retry: "Press 9 for more, 8 for previous, or 0 to go back." };
      },
    })
    .screen(
      "account.pin.old",
      pinScreen(() => ({ goto: "account.pin.new" })),
    )
    .screen(
      "account.pin.new",
      prompt(lines("Enter a new 4-digit PIN", BACK), (input) => {
        if (!/^\d{4}$/.test(input)) return { retry: "A PIN is 4 digits." };
        if (/^(\d)\1{3}$/.test(input)) return { retry: "Choose a PIN that is not one digit repeated." };
        // The session may be stored in Redis. Keep a digest there, never the PIN itself.
        return { goto: "account.pin.repeat", data: { newPinHash: digest(input) } };
      }),
    )
    .screen(
      "account.pin.repeat",
      prompt(lines("Enter the new PIN again", BACK), (input, ctx) => {
        if (digest(input) !== flow(ctx).newPinHash) return { retry: "The two PINs do not match." };
        ledger.changePin(ctx.phone, input);
        return { end: "Your Wallet PIN has been changed." };
      }),
    );

  return app;
}

const VERB: Record<Txn["type"], string> = {
  send: "Sent",
  receive: "Received",
  withdraw: "Withdrew",
  airtime: "Airtime",
  paybill: "Paid bill",
  goods: "Paid",
};

/** One short line per transaction, newest first. */
function statementRows(txns: Txn[]): string[] {
  return txns.slice(0, 9).map((txn) => {
    const day = `${txn.at.getUTCDate()}/${txn.at.getUTCMonth() + 1}`;
    return `${day} ${VERB[txn.type]} ${kes(txn.amount)}`;
  });
}
