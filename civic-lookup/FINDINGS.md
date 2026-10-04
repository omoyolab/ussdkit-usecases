# Findings

What happened when ussdkit 0.2.0 met a menu that waits on a real API. The first use case, mobile money, ran on data in memory; this one asks the plus234feed intel API for every answer, so it tests what a real service has to deal with: time, failure, long real names and lists of unknown length.

| # | Where | What happened | What the menu does | ussdkit |
| --- | --- | --- | --- | --- |
| 1 | Every screen that loads data | A screen that throws while it is drawn is not caught. A failed API call there would reach the network as an error, with nothing said to the caller | Loads data in the handler, before moving to the next screen, where a failure can end the session with a plain message. Screens only draw what is loaded | An error handler for screens, or a documented pattern for loading, [ussdkit#3](https://github.com/omoyolab/ussdkit/issues/3) |
| 2 | Every API call | ussdkit has no idea how long a reply may take. A cold call to the API took 0.7 to 2.2 seconds, a real share of the few seconds a network gives a USSD reply, and nothing warns when a handler is slow | Times each call out at 4 seconds and keeps answers for six hours. A cached state answers in about 15 ms | A warning, like the one for long screens, when a request takes longer than a set time, [ussdkit#4](https://github.com/omoyolab/ussdkit/issues/4) |
| 3 | State and LGA lists | A list to pick from, with pages and typing to narrow it, had to be built by hand on `paginate`. The mobile money statement did the same | `picker()` in `app.ts`: numbered pages of six, `9` and `8` to turn, or type the first letters of any word | A list screen built in: items, page size, select, and an optional filter, [ussdkit#5](https://github.com/omoyolab/ussdkit/issues/5) |
| 4 | Turning a page | Staying on the same screen to show the next page means returning `{ retry: "" }`, which reads as an error | Uses it, with a comment | A clear way to redraw the current screen, [ussdkit#6](https://github.com/omoyolab/ussdkit/issues/6) |
| 5 | About | A screen that only shows text but keeps Back working is a menu with no options. An end screen would close the session | `menu(text, [])` | A plain information screen, [ussdkit#7](https://github.com/omoyolab/ussdkit/issues/7) |
| 6 | My representatives, split LGAs | Four Lagos LGAs and Port Harcourt are each in two House seats. With the seat names the screen was 196 characters; without them, 183 on Mushin. The length warning only fires after the screen is built | Builds the full screen, and when it is over the room left, a compact one without seat names. A test draws the screen for every LGA in the saved data | A way to know the room left on a screen before writing it, [ussdkit#8](https://github.com/omoyolab/ussdkit/issues/8) |
| 7 | Long names | Real candidate names run to 42 characters, and INEC sometimes breaks a double-barrelled name with a space after the hyphen | `shortName()` keeps the first and last word, joins broken hyphens, and only cuts a name that is still too long | Worked around in the app. A helper is a possible addition |
| 8 | Candidates | The API puts the sitting member first | Lists every seat by party, then name, and marks the sitting member with `*` on the page where it appears | Not ussdkit's concern. A rule any civic service should keep |
| 9 | A refused request | The API refuses every FCT seat (HTTP 400): its seat-code check expects two letters at the end, and FCT codes end in three, such as `FC/359/FCT` | A refused request says the list is not available, instead of asking the caller to dial again, which would not help | Not ussdkit. Reported to plus234feed |
| 10 | Typing letters | Typing works on any phone that can send letters, and `riv` correctly offers both Cross River and Rivers | Matches the start of any word, so `isl` finds Lagos Island | Worked |
| 11 | A lost session | Reads are safe to repeat, so a replayed session lands on the same answer | Nothing extra | Worked: `ctx.replaying` was not needed |
| 12 | Tests | Tests must not call a live API or state facts about real people | A made-up state for the menu tests, a fake `fetch` for the client, and the saved data for the length check | Worked: `testPhone` drove every path |

Six are open issues in ussdkit, #3 to #8. None is fixed yet.

## What worked

- **Async screens and handlers.** Every load is one `await`. Nothing in ussdkit had to change to call an API.
- **`paginate`** carried four lists: states, LGAs, candidates and presidential tickets.
- **`testPhone`** drove every path, including the lost session, with no network.
- **The length warning** caught the split-LGA screen through a test, before any phone did.
- **Back and home** worked across eight screens with no extra code.

## Data checks on the saved states

Lagos (20 LGAs, 27 seats) and Rivers (23 LGAs, 16 seats), saved on the day of the build: every LGA matched exactly one Senate seat and at least one House seat, the five split LGAs matched two, and no seat was vacant. 407 candidates, the longest name 42 characters, up to 16 on one seat, and 18 presidential tickets.
