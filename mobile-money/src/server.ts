// The same app over HTTP, in Africa's Talking's format:  npm start
// Then, in another terminal:  npx @omoyolab/ussdkit dial http://localhost:3000/ussd --phone +254712345678
import { createServer } from "node:http";

import { createNodeHandler } from "@omoyolab/ussdkit";

import { buildApp } from "./app.js";
import { demoLedger } from "./ledger.js";

const port = Number(process.env.PORT ?? 3000);
createServer(createNodeHandler(buildApp({ ledger: demoLedger() }))).listen(port, () => {
  console.log(`Wallet USSD on http://localhost:${port}/ussd`);
});
