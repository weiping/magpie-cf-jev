// smoke.mjs: calls the plugin's fetch the way magpie's host does, against
// the real Cloudflare account, and checks the answer has answers at the top.
// Run: node smoke.mjs   (the token comes from magpie's own providers.json)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { CfJevPlugin } from "./index.mjs";

const providers = JSON.parse(readFileSync(`${homedir()}/.config/magpie/providers.json`, "utf8"));
const cf = (providers.providers ?? providers)?.find?.((p) => p.id === "cloudflare-jev");
if (!cf?.key) throw new Error("no cloudflare-jev provider in providers.json");
const account = (cf.decide.match(/accounts\/([^/]+)/) ?? [])[1];
if (!account) throw new Error("no account id in the provider's decide address");

const plugin = await CfJevPlugin({});
const auth = plugin.auth;
const options = await auth.loader(async () => ({ type: "api", key: `${account}:${cf.key}` }));

const question = {
  model: "typesafe/jev",
  state: { message: "fix a typo in a comment", agent: "main" },
  questions: {
    tier: {
      type: "choice",
      instructions: "Which tier can most cheaply handle it well?",
      criteria: { fast: "little", balanced: "some", performance: "much" },
    },
    dissatisfied: { type: "noul", instructions: "was the last result wrong?" },
  },
};

for (const model of ["typesafe/jev", "@cf/cloudflare/clef", "@cf/cloudflare/clef-flash"]) {
  const t0 = Date.now();
  const res = await options.fetch("plugin://cf-jev/v1/systemone", {
    method: "POST",
    body: JSON.stringify({ ...question, model }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    console.log(`${model}: ${res.status} not json in ${ms}ms: ${text.slice(0, 120)}`);
    continue;
  }
  const answers = out.answers ? Object.keys(out.answers).join(",") : "(none)";
  const tier = out.answers?.tier?.choice ?? "-";
  console.log(
    `${res.status === 200 && out.answers ? "OK  " : "FAIL"} ${model.padEnd(28)} ${ms
      .toString()
      .padStart(5)}ms  answers=${answers}  tier=${tier}  model=${out.model ?? "-"}` +
      (out.answers ? "" : `  body=${text.slice(0, 160)}`),
  );
}
