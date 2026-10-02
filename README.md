# ussdkit use cases

Real USSD services built end to end on [ussdkit](https://github.com/omoyolab/ussdkit), to find out what breaks when the library meets a real menu. Every gap goes back into ussdkit as a fix or an issue; each folder has its findings.

| Use case | Folder | Screens | Tests | Findings |
| --- | --- | ---: | ---: | ---: |
| A mobile money menu: send, withdraw, airtime, pay bill, buy goods, account | [`mobile-money/`](mobile-money/) | 27 | 28 | 12 |

Each use case installs ussdkit from npm the way a team would, and is written in TypeScript so the library's types are tested too.

The services are made up. They are not affiliated with any operator, bank or government.
