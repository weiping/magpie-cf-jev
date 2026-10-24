// cf-jev: Cloudflare Workers AI as a magpie decision provider.
//
// magpie can serve a plugin's decision API (its config hook's `decide`, a
// model's `decides`), asked at the provider's own base /systemone through
// the plugin's fetch. That fetch is where this plugin belongs: Workers AI
// answers a Jev in two envelopes — Cloudflare's own {"result": …} and the
// Jev's {"state": …,"result": …} — and magpie unwraps one of them
// (provider.DecideAnswer), so a Jev asked directly comes back with no
// answers at the top and every System One client refuses it (magpie's own
// classifier included). Here the envelopes are peeled before the answer
// leaves the plugin, so magpie and its clients see the System One answer
// as TypeSafe's own API and a Clef give it: `answers` at the top.
//
// The upstream fix (peel while another envelope is there) has been sent
// to yetone/magpie; until it ships, this plugin is the way to route a
// group's classifier through Workers AI.

const PROVIDER = "cf-jev";
const API = "https://api.cloudflare.com/client/v4";

// MODELS are the decision models Workers AI serves, and how each is asked:
// a Jev is a run of typesafe/jev whose question is the run's input, while
// a Clef is asked as it is, at its own path, naming itself.
const MODELS = [
  { id: "typesafe/jev", name: "Jev (Workers AI)", clef: "" },
  { id: "@cf/cloudflare/clef", name: "Clef", clef: "clef" },
  { id: "@cf/cloudflare/clef-flash", name: "Clef Flash", clef: "clef-flash" },
];

// modelOf is the model a System One question names. A probe asks with no
// model, or with the Jev's own name (jev-latest, jev-preview, as
// TypeSafe's API calls it): that is the Jev Workers AI runs.
const modelOf = (id) => {
  const said = String(id ?? "").trim();
  const hit = MODELS.find((m) => m.id === said);
  if (hit) return hit;
  return /^(|(typesafe\/)?jev(-latest|-preview)?)$/.test(said) ? MODELS[0] : undefined;
};

// peel is an answer out of whatever envelopes it came in: Cloudflare's own
// {"result": …}, the Jev's {"state": …,"result": …}, or neither. It stops
// as soon as the body has answers of its own, so a failure's errors and an
// already-flat answer are left as they came.
export function peel(body) {
  let cur = body;
  for (let i = 0; i < 4; i++) {
    if (!cur || typeof cur !== "object") return cur;
    if (cur.answers) return cur;
    if (!cur.result || typeof cur.result !== "object") return cur;
    cur = cur.result;
  }
  return cur;
}

// account is the Cloudflare account the token works in: the one the key
// names (a key pasted as "<account id>:<token>" says so), else the first
// the token can list, as magpie's built-in provider looks it up.
const accounts = new Map();
async function account(token, named) {
  if (named) return named;
  if (accounts.has(token)) return accounts.get(token);
  const res = await fetch(`${API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.result) || !body.result[0]?.id) {
    const why = body?.errors?.[0]?.message ?? `${res.status} ${res.statusText}`;
    throw new Error(
      `Cloudflare listed no account for this token: ${why}. ` +
        `A token made for Workers AI alone may not list accounts — sign in with "<account id>:<token>" then.`,
    );
  }
  accounts.set(token, body.result[0].id);
  return body.result[0].id;
}

// ask posts a System One question to Workers AI the way it takes it, and
// gives back the answer as System One gives it: answers at the top.
export async function ask({ token, named, model, question, signal }) {
  // magpie probes a decision API while it lists the provider, before anyone
  // has signed in: told so plainly rather than as a failed account lookup
  if (!token) return { status: 401, body: "cf-jev is not signed in: magpie plugin login cf-jev" };
  const m = modelOf(model);
  if (!m) throw new Error(`${PROVIDER} does not serve ${model}`);  const acct = await account(token, named);
  const url = m.clef
    ? `${API}/accounts/${acct}/ai/run/${m.id}`
    : `${API}/accounts/${acct}/ai/run`;
  const body = m.clef
    ? { model: m.clef, state: question.state, questions: question.questions }
    : { model: m.id, input: { state: question.state, questions: question.questions } };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 502, body: raw || `${res.status} ${res.statusText}` };
  }
  if (!res.ok || parsed.success === false) {
    const why =
      parsed?.errors?.map?.((e) => e?.message).filter(Boolean).join("; ") ||
      `${res.status} ${res.statusText}`;
    return { status: res.ok ? 502 : res.status, body: why };
  }
  return { status: 200, body: JSON.stringify(peel(parsed)) };
}

export async function CfJevPlugin() {
  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      const was = cfg.provider[PROVIDER] ?? {};
      cfg.provider[PROVIDER] = {
        name: "Cloudflare Workers AI · Jev (cf-jev)",
        ...was,
        // magpie's own field: this provider serves a decision API
        // (System One), asked at its base /systemone through this fetch
        decide: true,
        models: {
          ...Object.fromEntries(MODELS.map((m) => [m.id, { name: m.name, decides: true }])),
          ...(was.models ?? {}),
        },
      };
    },
    auth: {
      provider: PROVIDER,
      methods: [
        {
          type: "api",
          label: "Cloudflare API token (Workers AI)",
          placeholder: "token, or <account id>:<token>",
        },
      ],
      async loader(getAuth) {
        const auth = (await getAuth()) ?? {};
        const raw = String(auth.key ?? auth.apiKey ?? "").trim();
        // a key pasted as "<account id>:<token>" names the account itself,
        // which a token made for Workers AI alone can't be asked for
        const cut = raw.indexOf(":");
        const named = cut > 0 ? raw.slice(0, cut).trim() : "";
        const token = cut > 0 ? raw.slice(cut + 1).trim() : raw;
        return {
          apiKey: token,
          // where magpie thinks the provider's requests go: this fetch is
          // what answers them, so it is told a Cloudflare-shaped base and
          // never asked to reach it
          baseURL: API,
          async fetch(input, init) {
            const url = typeof input === "string" ? input : (input?.url ?? String(input));
            const path = (() => {
              try {
                return new URL(url).pathname;
              } catch {
                return url;
              }
            })();
            if (!path.endsWith("/systemone")) {
              return new Response(`cf-jev serves System One only: ${path}`, { status: 404 });
            }
            let question;
            try {
              question = JSON.parse(String(init?.body ?? "{}"));
            } catch {
              return new Response("cf-jev got no System One question", { status: 400 });
            }
            const out = await ask({
              token,
              named,
              model: question.model,
              question,
              signal: init?.signal,
            });
            if (out.status !== 200) return new Response(out.body, { status: out.status });
            return new Response(out.body, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          },
        };
      },
    },
  };
}
