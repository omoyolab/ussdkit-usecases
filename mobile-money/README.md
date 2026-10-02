# Mobile money menu

A use case for [ussdkit](https://github.com/omoyolab/ussdkit): the kind of USSD menu tens of millions of people use every day, built end to end. Send money, withdraw cash, buy airtime, pay a bill, buy goods, check a balance, read a statement, change a PIN.

It exists to find out what breaks when ussdkit meets a real menu. It found twelve things in ussdkit 0.1.0, and ten of them are fixed in 0.2.0. The list is in [FINDINGS.md](FINDINGS.md).

"Wallet" is made up. The shape of the menu follows the mobile money menus in common use; the names, numbers, fees and limits are invented. It is not affiliated with any operator.

## Try it

```sh
npm install
npm run simulate
```

That dials as Amina, who has KES 12,500 and the PIN 1234. To send money: `1`, `0722000111`, `500`, `1`, `1234`.

```
┌──────────────────────┐
│ Wallet               │
│ 1. Send money        │
│ 2. Withdraw cash     │
│ 3. Buy airtime       │
│ 4. Pay bill          │
│ 5. Buy goods         │
│ 6. My account        │
└──────────────────────┘
> 1

┌──────────────────────┐
│ Send money           │
│ Enter phone number   │
│ 0. Back              │
└──────────────────────┘
> 0722000111

┌──────────────────────┐
│ Enter amount in KES  │
│ 0. Back              │
└──────────────────────┘
> 500

┌────────────────────────────────────────┐
│ Send KES 500 to JOHN KAMAU 0722000111? │
│ Fee KES 7                              │
│ 1. Confirm                             │
│ 2. Cancel                              │
│ 0. Back                                │
└────────────────────────────────────────┘
> 1

┌───────────────────────┐
│ Enter your Wallet PIN │
│ 0. Back               │
└───────────────────────┘
> 1234

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TK00000001 Confirmed. KES 500 sent to JOHN KAMAU 0722000111. Fee KES 7. New balance KES 11,993. │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

That is a real run: `printf '1\n0722000111\n500\n1\n1234\n' | npm run simulate`.

Over HTTP, the way a gateway would call it:

```sh
npm start
npx @omoyolab/ussdkit dial http://localhost:3000/ussd --phone +254712345678
```

## The menu

| Choice | Steps |
| --- | --- |
| 1. Send money | Phone number, amount, confirm with the name and fee, PIN |
| 2. Withdraw cash | Agent number, amount, confirm with the agent's name and fee, PIN |
| 3. Buy airtime | My phone or another, amount, PIN |
| 4. Pay bill | Business number, account number, amount, confirm, PIN |
| 5. Buy goods | Till number, amount, confirm, PIN |
| 6. My account | Balance, mini statement with pages, change PIN |

`0` goes back and `00` goes home on every screen.

## What it is made to get right

- **The PIN comes last**, after the customer has seen exactly what it authorises.
- **Three wrong PINs lock the account.** A slip that is not four digits does not count.
- **Not enough money is said only after the PIN**, so the menu never tells a stranger holding the phone what the balance is.
- **The fee is shown before confirming** and counts towards what the customer needs.
- **Numbers are accepted the way people write them**: 0722000111, +254722000111, 0722 000 111.
- **Every screen fits in 182 characters.** The tests fail if one does not.
- **A new PIN is never stored**, only its digest, because a session may live in Redis.
- **A server restart in the middle of a session costs the customer nothing.** The session is rebuilt from what they typed, a wrong PIN is not counted twice, and money moves exactly once.
- **A number that is not registered never sees the menu.** The session ends on the first screen.

## Files

| File | What it holds |
| --- | --- |
| `src/app.ts` | The whole menu: 27 screens |
| `src/ledger.ts` | The wallet behind it: accounts, PINs, fees, statement. In memory and made up |
| `src/validate.ts` | Phone numbers and amounts as people type them |
| `test/wallet.test.ts` | 24 journeys through the menu |
| `test/fixed.test.ts` | One test per finding that ussdkit 0.2.0 fixed |

```sh
npm test
npm run typecheck
```
