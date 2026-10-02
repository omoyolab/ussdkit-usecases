// The wallet behind the menu: accounts, PINs, balances, fees and a statement.
// In memory and made up. A real one is a core banking system; the menu would call it the same way.
import { createHash } from "node:crypto";

export type TxnType = "send" | "receive" | "withdraw" | "airtime" | "paybill" | "goods";

export interface Txn {
  id: string;
  at: Date;
  type: TxnType;
  /** Whole shillings. */
  amount: number;
  fee: number;
  /** Who it went to or came from, as shown on a statement. */
  party: string;
  balance: number;
}

export interface Account {
  phone: string;
  name: string;
  balance: number;
  pinHash: string;
  failedPins: number;
  locked: boolean;
  txns: Txn[];
}

export type LedgerErrorCode = "insufficient" | "limit" | "same-account" | "unknown";

export class LedgerError extends Error {
  constructor(public readonly code: LedgerErrorCode) {
    super(code);
  }
}

export type PinResult = { ok: true } | { ok: false; locked: boolean; left: number };

export const MAX_PIN_ATTEMPTS = 3;
export const MAX_TXN = 150_000;

/** [upper bound, fee]. The last band covers everything above. */
const SEND_FEES: Array<[number, number]> = [
  [100, 0],
  [500, 7],
  [1000, 13],
  [1500, 23],
  [2500, 33],
  [3500, 53],
  [5000, 57],
  [7500, 78],
  [10_000, 90],
  [15_000, 100],
  [MAX_TXN, 108],
];
const WITHDRAW_FEES: Array<[number, number]> = [
  [100, 11],
  [2500, 29],
  [3500, 52],
  [5000, 69],
  [7500, 87],
  [10_000, 115],
  [15_000, 167],
  [20_000, 185],
  [35_000, 197],
  [50_000, 278],
  [MAX_TXN, 309],
];

function band(table: Array<[number, number]>, amount: number): number {
  for (const [upTo, fee] of table) if (amount <= upTo) return fee;
  return table[table.length - 1]![1];
}

export interface LedgerOptions {
  /** Transaction ids, for repeatable tests. */
  nextId?: () => string;
  now?: () => Date;
}

export class Ledger {
  readonly accounts = new Map<string, Account>();
  readonly agents = new Map<string, string>();
  readonly paybills = new Map<string, string>();
  readonly tills = new Map<string, string>();
  private readonly nextId: () => string;
  private readonly now: () => Date;
  private counter = 0;

  constructor(options: LedgerOptions = {}) {
    this.nextId =
      options.nextId ??
      (() => {
        this.counter += 1;
        return `TK${this.counter.toString(36).toUpperCase().padStart(8, "0")}`;
      });
    this.now = options.now ?? (() => new Date());
  }

  private hash(phone: string, pin: string): string {
    // A demo. A real wallet never sees the PIN in the menu layer; an HSM checks it.
    return createHash("sha256").update(`${phone}:${pin}`).digest("hex");
  }

  open(phone: string, name: string, balance: number, pin: string): Account {
    const account: Account = {
      phone,
      name,
      balance,
      pinHash: this.hash(phone, pin),
      failedPins: 0,
      locked: false,
      txns: [],
    };
    this.accounts.set(phone, account);
    return account;
  }

  find(phone: string): Account | undefined {
    return this.accounts.get(phone);
  }

  private must(phone: string): Account {
    const account = this.accounts.get(phone);
    if (!account) throw new LedgerError("unknown");
    return account;
  }

  verifyPin(phone: string, pin: string): PinResult {
    const account = this.must(phone);
    if (account.locked) return { ok: false, locked: true, left: 0 };
    if (account.pinHash === this.hash(phone, pin)) {
      account.failedPins = 0;
      return { ok: true };
    }
    account.failedPins += 1;
    account.locked = account.failedPins >= MAX_PIN_ATTEMPTS;
    return { ok: false, locked: account.locked, left: MAX_PIN_ATTEMPTS - account.failedPins };
  }

  changePin(phone: string, pin: string): void {
    const account = this.must(phone);
    account.pinHash = this.hash(phone, pin);
  }

  sendFee(amount: number): number {
    return band(SEND_FEES, amount);
  }

  withdrawFee(amount: number): number {
    return band(WITHDRAW_FEES, amount);
  }

  private debit(phone: string, type: TxnType, amount: number, fee: number, party: string): Txn {
    const account = this.must(phone);
    if (amount > MAX_TXN) throw new LedgerError("limit");
    if (account.balance < amount + fee) throw new LedgerError("insufficient");
    account.balance -= amount + fee;
    const txn: Txn = { id: this.nextId(), at: this.now(), type, amount, fee, party, balance: account.balance };
    account.txns.unshift(txn);
    return txn;
  }

  send(from: string, to: string, amount: number): Txn {
    if (from === to) throw new LedgerError("same-account");
    const recipient = this.must(to);
    const txn = this.debit(from, "send", amount, this.sendFee(amount), `${recipient.name} ${to}`);
    recipient.balance += amount;
    recipient.txns.unshift({
      id: txn.id,
      at: txn.at,
      type: "receive",
      amount,
      fee: 0,
      party: `${this.must(from).name} ${from}`,
      balance: recipient.balance,
    });
    return txn;
  }

  withdraw(phone: string, agent: string, amount: number): Txn {
    const name = this.agents.get(agent);
    if (!name) throw new LedgerError("unknown");
    return this.debit(phone, "withdraw", amount, this.withdrawFee(amount), `${name} agent ${agent}`);
  }

  airtime(phone: string, forPhone: string, amount: number): Txn {
    return this.debit(phone, "airtime", amount, 0, forPhone === phone ? "own phone" : forPhone);
  }

  payBill(phone: string, business: string, account: string, amount: number): Txn {
    const name = this.paybills.get(business);
    if (!name) throw new LedgerError("unknown");
    return this.debit(phone, "paybill", amount, 0, `${name} acc ${account}`);
  }

  buyGoods(phone: string, till: string, amount: number): Txn {
    const name = this.tills.get(till);
    if (!name) throw new LedgerError("unknown");
    return this.debit(phone, "goods", amount, 0, name);
  }
}

/** Three customers, two agents, two bill accounts and two shops to try the menu with. */
export function demoLedger(options: LedgerOptions = {}): Ledger {
  const ledger = new Ledger(options);
  ledger.open("+254712345678", "AMINA OTIENO", 12_500, "1234");
  ledger.open("+254722000111", "JOHN KAMAU", 800, "4321");
  ledger.open("+254733222333", "GRACE WANJIRU", 56_000, "2468");
  ledger.agents.set("123456", "Mama Njeri Shop");
  ledger.agents.set("654321", "Kilimani Cyber");
  ledger.paybills.set("888880", "City Power");
  ledger.paybills.set("222111", "County Water");
  ledger.tills.set("510001", "Mwangi Groceries");
  ledger.tills.set("510002", "Sunrise Pharmacy");
  return ledger;
}
