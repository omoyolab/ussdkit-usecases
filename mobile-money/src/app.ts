// The menu. Everything a customer sees is in this file.
import { createHash } from "node:crypto";

import { createApp, lines, menu, paginate, prompt } from "@omoyolab/ussdkit";
import type { App, Context, Next, Screen } from "@omoyolab/ussdkit";

import { LedgerError, MAX_TXN } from "./ledger.js";
import type { Ledger, LedgerErrorCode, Txn } from "./ledger.js";
import { kes, local, parseAmount, parsePhone } from "./validate.js";

/** What a session remembers between screens. */
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
type Ctx = Context<Flow>;

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

export function buildApp({ ledger, onWarning }: BuildOptions): App<Flow> {
  /**
   * The PIN step every money movement ends with. It is transient, so Back never returns to it.
   * Each flow still registers its own copy: ussdkit has no way to share a step between flows.
   */
  function pinScreen(onCorrect: (ctx: Ctx) => Next<Flow>): Screen<Flow> {
    return prompt<Flow>(
      "Enter your Wallet PIN",
      (input, ctx) => {
        // Not four digits is a typing slip, not a wrong PIN. It does not use up an attempt.
        if (!/^\d{4}$/.test(input)) return { retry: "A PIN is 4 digits." };
        if (ctx.replaying) {
          // This PIN was checked once already, in a request before the session was lost.
          // Follow the same path without counting a wrong attempt a second time.
          if (!ledger.isPin(ctx.phone, input)) return { retry: "Wrong PIN." };
        } else {
          const result = ledger.verifyPin(ctx.phone, input);
          if (!result.ok) {
            if (result.locked) return { end: LOCKED };
            return { retry: `Wrong PIN. ${result.left} ${result.left === 1 ? "attempt" : "attempts"} left.` };
          }
        }
        try {
          return onCorrect(ctx);
        } catch (error) {
          if (error instanceof LedgerError) return { end: FAILURES[error.code] };
          throw error;
        }
      },
      { transient: true },
    );
  }

  const receipt = (txn: Txn, what: string): string =>
    `${txn.id} Confirmed. ${what}${txn.fee ? ` Fee ${kes(txn.fee)}.` : ""} New balance ${kes(txn.balance)}.`;

  const amountPrompt = (title: string, min: number, max: number, next: string, extra?: (amount: number) => Partial<Flow>): Screen<Flow> =>
    prompt<Flow>(title, (input) => {
      const amount = parseAmount(input, min, max);
      if (amount === null) return { retry: `Enter an amount from ${kes(min)} to ${kes(max)}, in figures.` };
      return { goto: next, data: { amount, ...extra?.(amount) } };
    });

  const app = createApp<Flow>({
    ttl: 120,
    backHint: "0. Back",
    ...(onWarning ? { onWarning } : {}),
    // A number that is not registered, or whose PIN is locked, never reaches the menu.
    onStart: ({ phone }) => {
      const account = ledger.find(phone);
      if (!account) return { end: NOT_REGISTERED };
      if (account.locked) return { end: LOCKED };
    },
  })
    .screen(
      "home",
      menu("Wallet", [
        ["Send money", "send.to"],
        ["Withdraw cash", "withdraw.agent"],
        ["Buy airtime", "airtime"],
        ["Pay bill", "bill.business"],
        ["Buy goods", "goods.till"],
        ["My account", "account"],
      ]),
    )

    // ---------- Send money: who, how much, confirm, PIN ----------
    .screen(
      "send.to",
      prompt(lines("Send money", "Enter phone number"), (input, ctx) => {
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
          const f = ctx.data;
          return lines(`Send ${kes(f.amount!)} to ${f.toName} ${local(f.to!)}?`, `Fee ${kes(f.fee!)}`);
        },
        [
          ["Confirm", "send.pin"],
          ["Cancel", () => ({ end: "Cancelled. No money was sent." })],
        ],
      ),
    )
    .screen(
      "send.pin",
      pinScreen((ctx) => {
        const f = ctx.data;
        const txn = ledger.send(ctx.phone, f.to!, f.amount!);
        return { end: receipt(txn, `${kes(txn.amount)} sent to ${f.toName} ${local(f.to!)}.`) };
      }),
    )

    // ---------- Withdraw cash: agent, how much, confirm, PIN ----------
    .screen(
      "withdraw.agent",
      prompt(lines("Withdraw cash", "Enter agent number"), (input) => {
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
          const f = ctx.data;
          return lines(`Withdraw ${kes(f.amount!)} from ${f.agentName}?`, `Fee ${kes(f.fee!)}`);
        },
        [
          ["Confirm", "withdraw.pin"],
          ["Cancel", () => ({ end: "Cancelled. No money was withdrawn." })],
        ],
      ),
    )
    .screen(
      "withdraw.pin",
      pinScreen((ctx) => {
        const f = ctx.data;
        const txn = ledger.withdraw(ctx.phone, f.agent!, f.amount!);
        return { end: receipt(txn, `Take ${kes(txn.amount)} from ${f.agentName}.`) };
      }),
    )

    // ---------- Buy airtime: whose phone, how much, PIN ----------
    .screen(
      "airtime",
      menu("Buy airtime", [
        ["My phone", (ctx) => ({ goto: "airtime.amount", data: { airtimeFor: ctx.phone } })],
        ["Another phone", "airtime.phone"],
      ]),
    )
    .screen(
      "airtime.phone",
      prompt("Enter phone number", (input) => {
        const airtimeFor = parsePhone(input);
        if (!airtimeFor) return { retry: "Enter a mobile number like 0712345678." };
        return { goto: "airtime.amount", data: { airtimeFor } };
      }),
    )
    .screen("airtime.amount", amountPrompt("Enter airtime amount in KES", 5, 10_000, "airtime.pin"))
    .screen(
      "airtime.pin",
      pinScreen((ctx) => {
        const f = ctx.data;
        const txn = ledger.airtime(ctx.phone, f.airtimeFor!, f.amount!);
        const who = f.airtimeFor === ctx.phone ? "your phone" : local(f.airtimeFor!);
        return { end: receipt(txn, `${kes(txn.amount)} airtime bought for ${who}.`) };
      }),
    )

    // ---------- Pay bill: business, account, how much, confirm, PIN ----------
    .screen(
      "bill.business",
      prompt(lines("Pay bill", "Enter business number"), (input) => {
        const businessName = ledger.paybills.get(input);
        if (!businessName) return { retry: "We do not know that business number." };
        return { goto: "bill.account", data: { business: input, businessName } };
      }),
    )
    .screen(
      "bill.account",
      prompt("Enter account number", (input) => {
        if (!/^[A-Za-z0-9-]{1,20}$/.test(input)) return { retry: "Enter the account number on your bill." };
        return { goto: "bill.amount", data: { billAccount: input.toUpperCase() } };
      }),
    )
    .screen("bill.amount", amountPrompt("Enter amount in KES", 1, MAX_TXN, "bill.confirm"))
    .screen(
      "bill.confirm",
      menu(
        (ctx) => {
          const f = ctx.data;
          return `Pay ${kes(f.amount!)} to ${f.businessName}, account ${f.billAccount}?`;
        },
        [
          ["Confirm", "bill.pin"],
          ["Cancel", () => ({ end: "Cancelled. Nothing was paid." })],
        ],
      ),
    )
    .screen(
      "bill.pin",
      pinScreen((ctx) => {
        const f = ctx.data;
        const txn = ledger.payBill(ctx.phone, f.business!, f.billAccount!, f.amount!);
        return { end: receipt(txn, `${kes(txn.amount)} paid to ${f.businessName} for account ${f.billAccount}.`) };
      }),
    )

    // ---------- Buy goods: till, how much, confirm, PIN ----------
    .screen(
      "goods.till",
      prompt(lines("Buy goods", "Enter till number"), (input) => {
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
          const f = ctx.data;
          return `Pay ${kes(f.amount!)} to ${f.tillName}?`;
        },
        [
          ["Confirm", "goods.pin"],
          ["Cancel", () => ({ end: "Cancelled. Nothing was paid." })],
        ],
      ),
    )
    .screen(
      "goods.pin",
      pinScreen((ctx) => {
        const f = ctx.data;
        const txn = ledger.buyGoods(ctx.phone, f.till!, f.amount!);
        return { end: receipt(txn, `${kes(txn.amount)} paid to ${f.tillName}.`) };
      }),
    )

    // ---------- My account: balance, statement, change PIN ----------
    .screen(
      "account",
      menu("My account", [
        ["Balance", "account.balance.pin"],
        ["Mini statement", "account.statement.pin"],
        ["Change PIN", "account.pin.old"],
      ]),
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
        const rows = statementRows(ledger.find(ctx.phone)!.txns);
        if (rows.length === 0) return lines("Mini statement", "No transactions yet.");
        return lines("Mini statement", paginate(rows, { page: ctx.data.page ?? 0, perPage: 3, numbered: false }).text);
      },
      handle: (ctx) => {
        const page = paginate(statementRows(ledger.find(ctx.phone)!.txns), { page: ctx.data.page ?? 0, perPage: 3, numbered: false });
        if (page.isNext(ctx.input)) {
          ctx.data.page = page.page + 1;
          return { retry: "" };
        }
        if (page.isPrev(ctx.input)) {
          ctx.data.page = page.page - 1;
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
      prompt("Enter a new 4-digit PIN", (input) => {
        if (!/^\d{4}$/.test(input)) return { retry: "A PIN is 4 digits." };
        if (/^(\d)\1{3}$/.test(input)) return { retry: "Choose a PIN that is not one digit repeated." };
        // The session may be stored in Redis. Keep a digest there, never the PIN itself.
        return { goto: "account.pin.repeat", data: { newPinHash: digest(input) } };
      }),
    )
    .screen(
      "account.pin.repeat",
      prompt("Enter the new PIN again", (input, ctx) => {
        if (digest(input) !== ctx.data.newPinHash) return { retry: "The two PINs do not match." };
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
