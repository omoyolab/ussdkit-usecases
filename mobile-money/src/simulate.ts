// A phone in the terminal. Dial as Amina, PIN 1234:  npm run simulate
import { simulate } from "@omoyolab/ussdkit";

import { buildApp } from "./app.js";
import { demoLedger } from "./ledger.js";

await simulate(buildApp({ ledger: demoLedger() }), { phone: "+254712345678", serviceCode: "*384*100#" });
