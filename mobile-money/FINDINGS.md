# Findings

What got in the way, what was missing, and what was wrong when ussdkit 0.1.0 met a real menu, and what became of each. The menu was first built on 0.1.0 with workarounds; the fixes shipped in ussdkit 0.2.0 and the workarounds were removed.

| # | Where | Needed | ussdkit 0.1.0 had | Status |
| --- | --- | --- | --- | --- |
| 1 | Every screen | To read what earlier screens stored: the recipient, the amount, the fee | `ctx.data` typed as `Record<string, unknown>`, so every read needed a cast | **Fixed in 0.2.0.** `createApp<Flow>()` types `ctx.data` and what `goto` may store. The casts are gone |
| 2 | Every screen | To tell the customer which key goes back, and to keep a menu's numbers and its choices in step | Nothing for the hint. `menu()` took the text and the choices separately, so "3. Buy airtime" and `"3": "airtime"` were typed twice | **Fixed in 0.2.0.** `backHint` adds the line where the back key works. `menu(title, [[label, target], ...])` numbers itself |
| 3 | Six flows | One PIN step shared by send, withdraw, airtime, pay bill, buy goods and the account screens | No way to share a step between flows | **Open.** A function still returns a new PIN screen and seven are registered from it. On the ussdkit roadmap as shared steps |
| 4 | Home | To end the session at once for a number that is not registered, or whose PIN is locked | A screen ended the session only if it had no handler, so the message showed but the session stayed open until a key was pressed | **Fixed in 0.2.0.** `onStart` can end a session before any screen |
| 5 | Mini statement | Back from the statement to go to the account menu | Back returned to the PIN prompt the customer had just passed. The use case edited the history by hand | **Fixed in 0.2.0.** The PIN screen is `transient` |
| 6 | Mini statement | A previous-page key | `paginate()` used `0`, which is also the app's back key. The app took it first, so `0` left the list. The bundled bank example had this bug | **Fixed in 0.2.0.** The previous-page key is `8` |
| 7 | Mini statement | A list to read, not to pick from | `paginate()` always numbered its rows | **Fixed in 0.2.0.** `numbered: false` |
| 8 | PIN | A wrong PIN to count once | A lost session was rebuilt by running every handler again. Two wrong PINs, a server restart, then the right PIN: the replay counted the two wrong ones again and locked the account | **Fixed in 0.2.0.** `ctx.replaying` says when an input was handled before. The PIN check does not count during a replay. The most serious finding |
| 9 | Amounts, counts | `0` as something a customer may type | The back key was taken before the screen saw it, so `0` could never be an answer | **Fixed in 0.2.0.** `{ back: false }` on a prompt. This menu keeps `0` as Back on its amount screens, since an amount of 0 is not valid anyway |
| 10 | README | A transcript of the menu for the documentation | A scripted simulator run showed the screens but not what was typed | **Fixed in 0.2.0.** The simulator shows piped input, and `testPhone` has `transcript()`. The transcript in the README is a real run |
| 11 | PIN, new PIN | To keep a PIN out of logs and stores | Nothing marks an input as secret. The gateway resends it with every request, which no library can change, but the simulator and transcripts show it too | **Open.** The new PIN is kept in the session as a digest, never as itself, and a test checks that. On the ussdkit roadmap as secret inputs |
| 12 | Tests | To simulate a session lost mid-way | `testPhone` could not drop its session | **Fixed in 0.2.0.** `phone.loseSession()` |

Ten of twelve fixed. `test/fixed.test.ts` has a test for each fix that changed behaviour.

## What worked

- **Tests with no server.** `testPhone` drove every journey in under a quarter of a second. Nothing was mocked.
- **The length warning.** Every test collects the warnings and fails if any screen is over 182 characters. It caught two receipts while they were being written.
- **Back and home keys.** One line of configuration, and entered values survived going back.
- **`prompt()` with retry.** Validation with a message and the same screen again covered every input in the menu.
- **Replay.** Rebuilding a lost session is the right idea and worked for navigation. Finding 8 is about what else runs during it.
