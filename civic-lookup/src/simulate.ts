// A phone in the terminal:  npm run simulate
// With a key in .env it asks the live API; without one it uses the saved data.
import { simulate } from "@omoyolab/ussdkit";

import { buildApp } from "./app.js";
import { chooseSource } from "./source.js";

const { source, mode } = chooseSource();
console.log(`Data: ${mode}`);
await simulate(buildApp({ source }), { phone: "+2348030000000", serviceCode: "*384*234#" });
