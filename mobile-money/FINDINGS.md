# Findings

What got in the way, what was missing, and what was wrong when ussdkit 0.1.0 met a real menu. Each entry says what the menu needed, what ussdkit offered, and what was done here. Findings that are bugs or gaps in ussdkit get a test in `test/findings.test.ts` that pins the behaviour down, and an issue or a fix in ussdkit.

| # | Where | Needed | ussdkit 0.1.0 had | Done here | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Every screen | To read what earlier screens stored: the recipient, the amount, the fee | `ctx.data` typed as `Record<string, unknown>` | A `Flow` type and a cast on every read | Open |
| 2 | Every screen | To tell the customer which key goes back, and to keep a menu's numbers and its choices in step | Nothing for the hint. `menu()` takes the text and the choices separately, so "3. Buy airtime" and `"3": "airtime"` are typed twice | "0. Back" written on every screen by hand. Numbers kept in step by eye | Open |
| 3 | Six flows | One PIN step shared by send, withdraw, airtime, pay bill, buy goods and the account screens | No way to share a step between flows | A function that returns a new PIN screen. Seven screens registered from it under seven ids | Open |
| 4 | Home | To end the session at once for a number that is not registered, or whose PIN is locked | A screen ends the session only if it has no handler. One screen cannot be a menu for some people and an ending for others | The message is shown, but the session stays open until the customer presses a key. Reusing `menu()` inside a custom screen needed `menu.render as string` and `menu.handle!` | Open, test |
| 5 | Mini statement | Back from the statement to go to the account menu | Back returns to the previous screen, which is the PIN prompt the customer just passed | The statement edits `ctx.session.history` to remove the PIN screen | Open |
| 6 | Mini statement | A previous-page key | `paginate()` uses `0` by default, which is also the app's Back key. The app takes it first, so `0` leaves the list. The bundled bank example has this bug | A different key set by hand | Open, test |
| 7 | Mini statement | A list to read, not to pick from | `paginate()` always numbers its rows | The statement is shown numbered | Open |
| 8 | PIN | A wrong PIN to count once | When a session is lost, ussdkit rebuilds it by running every handler again with the inputs the gateway resends. Handlers with side effects run twice. Two wrong PINs, a server restart, then the right PIN: the replay counts the two wrong ones again and locks the account | Nothing. It cannot be worked around from the app without knowing a replay is happening | Open, test. The most serious finding |
| 9 | Amount, account number | `0` as something a customer may type | The Back key is taken before the screen sees it. `0` can never be an answer, and an amount of 0 cannot be refused with a message | Nothing | Open, test |
| 10 | README | A transcript of the menu for the documentation | A scripted simulator run shows the screens but not what was typed. `testPhone` keeps the inputs but not the screens | The transcript in the README was put together by hand | Open |
| 11 | PIN, new PIN | To keep a PIN out of logs and stores | Nothing marks an input as secret. The gateway resends it with every request, which no library can change, but the simulator and any logging show it too | The new PIN is kept in the session as a digest, never as itself. A test checks that | Open |
| 12 | Tests | To simulate a session lost mid-way | `testPhone` cannot drop its session | The test for finding 8 calls `app.handle` directly | Open |

## What worked

- **Tests with no server.** `testPhone` drove 24 journeys in under a quarter of a second. Nothing was mocked.
- **The length warning.** Every test collects the warnings and fails if any screen is over 182 characters. It caught two receipts while they were being written.
- **Back and home keys.** One line of configuration, and entered values survived going back.
- **`prompt()` with retry.** Validation with a message and the same screen again covered every input in the menu.
- **Replay.** Rebuilding a lost session is the right idea and worked for navigation. Finding 8 is about what else runs during it.
