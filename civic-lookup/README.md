# Know your lawmakers: a ussdkit use case

A USSD menu that answers two questions from any phone, without data or a smartphone:

- **Who represents me?** Your senator and your member of the House of Representatives, with their parties.
- **Who is running in 2027?** The candidates for your Senate and House seats, and for president.

You choose your state and your local government area (LGA), and the menu finds the seats that cover it. The answers come from the [plus234feed](https://www.plus234feed.com/developers) intel API, which joins INEC's register of constituencies, the National Assembly's roster and INEC's final lists of candidates.

This is a use case for [ussdkit](https://github.com/omoyolab/ussdkit), built to find out what breaks when the library meets a menu that waits on a real API. It is not a government or INEC service, and it does not tell anyone how to vote.

## Try it

```sh
npm install
npm run simulate
```

Without a key it runs on saved data for Lagos and Rivers. Dial, then:

| Type | You see |
| --- | --- |
| `1` | Choose your state |
| `1` | The LGAs, six to a page. `9` for more, or type the first letters, such as `ike` |
| a number | Your senator and House member |
| `1` | The seats for your LGA and how many are running for each |
| `1` | The candidates, four to a page, in party order |

`0` goes back, `00` goes home.

## With the live API

1. **Get a key.** A free key allows 100 requests a day:

   ```sh
   curl -X POST https://intel-api.plus234feed.com/v1/keys/register \
     -H "Content-Type: application/json" \
     -d '{"name": "ussdkit civic lookup", "owner_email": "you@example.com"}'
   ```

   The key is shown once. Keep it.

2. **Put it in `.env`**, which git ignores:

   ```sh
   cp .env.example .env
   # then set PLUS234FEED_API_KEY=pfi_...
   ```

3. `npm run simulate` now covers all 37 states. `npm start` serves the same menu over HTTP in Africa's Talking's format.

To refresh the saved data: `npm run snapshot -- Lagos Rivers`.

## How it is built

| File | What it does |
| --- | --- |
| `src/app.ts` | The menu: every screen a caller sees |
| `src/civic.ts` | The data: the live API client with its cache and timeout, the saved-data source, and LGA matching |
| `src/source.ts` | Uses the live API when a key is set, the saved data when not |
| `src/snapshot.ts` | Saves a few states from the live API to `data/snapshot.json` |
| `test/` | The tests, on a made-up state, so they never call the API or state anything about real people |

### Rules it follows

- **Answer within the network's deadline.** A network gives a USSD reply a few seconds. Each API call times out after 4 seconds, and the caller is told the records could not be reached rather than left with an error.
- **Ask once.** Each state's LGAs and seats, each seat's candidates and the presidential list are kept in memory for six hours. A free key's 100 requests a day serve many callers.
- **Load before moving.** Data is loaded when the caller makes a choice, before the next screen. A screen only draws what is already loaded.
- **Neutral order.** Candidates are listed by party, then name, the same for every seat. The sitting member is marked with `*`, not moved to the top.
- **Say what is not known.** A vacant seat says "No sitting member on record". A party with no presidential candidate says "not yet named". An LGA split between two House seats names both.
- **Name the source** at the foot of every list.

## Findings

See [FINDINGS.md](FINDINGS.md): what ussdkit made easy, and what this menu had to work around.
