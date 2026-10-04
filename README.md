# ussdkit use cases

Real USSD services built end to end on [ussdkit](https://github.com/omoyolab/ussdkit), to find out what breaks when the library meets a real menu. Every gap goes back into ussdkit as a fix or an issue; each folder has its findings.

| Use case | Folder | Screens | Tests | Findings |
| --- | --- | ---: | ---: | ---: |
| A mobile money menu: send, withdraw, airtime, pay bill, buy goods, account | [`mobile-money/`](mobile-money/) | 27 | 31 | 12 found, 10 fixed in ussdkit 0.2.0 |
| Know your lawmakers: your senator and House member, and who is running in 2027, on live data | [`civic-lookup/`](civic-lookup/) | 8 | 20 | 12 found, 6 for ussdkit |

Each use case installs ussdkit from npm the way a team would, and is written in TypeScript so the library's types are tested too.

The mobile money service is made up. Know your lawmakers uses real public records through the plus234feed API and is not a government or INEC service. Neither is affiliated with any operator, bank or government.
