// peel.test.mjs: what the answers are read out of, and what is left alone.
// Run: node --test peel.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { peel } from "./index.mjs";

// the two envelopes Workers AI puts a Jev's answer in
const jev = {
  result: {
    state: "Completed",
    result: {
      model: "jev-1.13.0",
      answers: { tier: { type: "choice", choice: "fast", confidence: 0.98 } },
      usage: { input_tokens: 330, output_tokens: 38 },
    },
  },
  success: true,
  errors: [],
  messages: [],
};

// a Clef answers as it is asked: one envelope, and its answers inside
const clef = {
  result: {
    model: "clef",
    answers: { tier: { type: "choice", choice: "balanced", confidence: 0.4 } },
    usage: { input_tokens: 143, output_tokens: 0 },
  },
  success: true,
  errors: [],
  messages: [],
};

test("a Jev's answer comes out of Cloudflare's and the Jev's own envelope", () => {
  const out = peel(jev);
  assert.equal(out.model, "jev-1.13.0");
  assert.equal(out.answers.tier.choice, "fast");
});

test("a Clef's answer comes out of Cloudflare's envelope", () => {
  const out = peel(clef);
  assert.equal(out.model, "clef");
  assert.equal(out.answers.tier.choice, "balanced");
});

test("an answer with no envelope is left as it came", () => {
  const flat = { model: "jev-1.13.0", answers: { tier: { choice: "fast" } } };
  assert.deepEqual(peel(flat), flat);
});

test("a failure is left as it came: its errors are not peeled away", () => {
  const bad = { success: false, errors: [{ code: 7003, message: "Bad input" }], messages: [] };
  assert.deepEqual(peel(bad), bad);
});

test("an answer that keeps an envelope past the fourth stops at four: never peeled forever", () => {
  let deep = { answers: { tier: { choice: "fast" } } };
  for (let i = 0; i < 6; i++) deep = { result: deep };
  const out = peel(deep);
  // four envelopes taken off, two left: the loop is bounded, not a hunt
  let depth = 0;
  for (let cur = out; cur && typeof cur === "object" && cur.result; cur = cur.result) depth++;
  assert.equal(depth, 2);
  assert.ok(out.result && out.result.result, "the fifth and sixth envelopes are still there");
});
