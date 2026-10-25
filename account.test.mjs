// account.test.mjs: the account a key works in. Run: node --test account.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { accountFor } from "./index.mjs";

test("the account id the sign-in answered names the account", () => {
  const a = accountFor({ key: "tok", metadata: { accountId: "f14d88531a144167d91b1be6fb789b3f" } });
  assert.equal(a.token, "tok");
  assert.equal(a.named, "f14d88531a144167d91b1be6fb789b3f");
});

test("a key pasted as '<account id>:<token>' names it too", () => {
  const a = accountFor({ key: "f14d88531a144167d91b1be6fb789b3f:tok" });
  assert.equal(a.token, "tok");
  assert.equal(a.named, "f14d88531a144167d91b1be6fb789b3f");
});

test("the answer wins over the key's own account id", () => {
  const a = accountFor({ key: "old:tok", metadata: { accountId: "new" } });
  assert.equal(a.token, "tok");
  assert.equal(a.named, "new");
});

test("a token alone names no account: the token is asked for it", () => {
  const a = accountFor({ key: "tok" });
  assert.equal(a.token, "tok");
  assert.equal(a.named, "");
});

test("an empty answer leaves the token's own account id", () => {
  const a = accountFor({ key: "old:tok", metadata: { accountId: "" } });
  assert.equal(a.named, "old");
  assert.equal(a.token, "tok");
});

test("no sign-in at all is no token and no account", () => {
  const a = accountFor(undefined);
  assert.equal(a.token, "");
  assert.equal(a.named, "");
});
