import assert from "node:assert/strict";
import { test } from "node:test";
import { currentPadiBuildIdentity } from "@kolu/padi/buildId";
import { padiBuildEnv, type ServerBuild } from "./serverBuild.ts";

/** Read the identity the way the server's binder and its padi do, from the env
 *  a start gives the source wrapper. */
function identityUnder(build: ServerBuild) {
  const saved = { ...process.env };
  try {
    delete process.env.PADI_BUILD_ID;
    delete process.env.PADI_COMMIT_HASH;
    Object.assign(process.env, padiBuildEnv(build, "abc1234"));
    return currentPadiBuildIdentity();
  } finally {
    process.env = saved;
  }
}

test("a source-run server can read the padi build it is started as", () => {
  assert.deepEqual(identityUnder("base"), {
    staleKey: "e2e-base",
    navigableCommit: "abc1234",
  });
});

test("the deploy's two builds differ in their padi build id alone", () => {
  const base = identityUnder("base");
  const next = identityUnder("next");
  assert.notEqual(base.staleKey, next.staleKey);
  assert.equal(base.navigableCommit, next.navigableCommit);
});
