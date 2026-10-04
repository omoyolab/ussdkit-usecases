// The same app over HTTP, in Africa's Talking's format:  npm start
// Then, in another terminal:  npx @omoyolab/ussdkit dial http://localhost:3000/ussd --phone +2348030000000
import { createServer } from "node:http";

import { createNodeHandler } from "@omoyolab/ussdkit";

import { buildApp } from "./app.js";
import { chooseSource } from "./source.js";

const { source, mode } = chooseSource();
const port = Number(process.env.PORT ?? 3000);
createServer(createNodeHandler(buildApp({ source }))).listen(port, () => {
  console.log(`Know your lawmakers on http://localhost:${port}/ussd (${mode})`);
});
