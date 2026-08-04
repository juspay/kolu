/**
 * The `await`-on-a-member-face ban's own gate. The ban is only worth anything if
 * the SCANNER is honest in BOTH directions, so each test here is a way it could
 * lie: a violation it might miss, and — just as important — a legitimate
 * spelling it might condemn. A scanner that flagged `await Effect.runPromise(…)`
 * would be turned off within a week, and then the real ones ride back in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AwaitedFaceHit,
  findAwaitedFaceCalls,
  validateAwaitedFaceCalls,
} from "./awaitedFace";

const hits = (src: string): AwaitedFaceHit[] => findAwaitedFaceCalls(src);

test("catches a bare await on the surface face — the shape that never dispatches", () => {
  assert.equal(
    hits("const x = await client.surface.lifecycle.kill({ id });").length,
    1,
  );
});

test("catches the procedures face too", () => {
  assert.equal(hits("await app.procedures.process.kill({ pid });").length, 1);
});

test("catches it through an arbitrarily deep reference path", () => {
  assert.equal(hits("await conn.a.b.surface.system.version({});").length, 1);
});

test("catches it through a CALL in the reference path", () => {
  // `client.entry(A).procedures.…` is how the map's per-entry face is reached,
  // and a path grammar that admitted only dots could not see it.
  assert.equal(
    hits("await client.entry(A).procedures.session.ping({});").length,
    1,
  );
  assert.equal(hits("await makeClient().surface.ns.verb(x);").length, 1);
});

test("catches the ALIAS dodge — the verb bound to a name, then awaited", () => {
  const found = hits(
    ["const verb = client.surface.lifecycle.kill;", "await verb({ id });"].join(
      "\n",
    ),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 2);
  assert.match(found[0]?.text ?? "", /bound to a member face at line 1/);
});

test("catches the STORED-DESCRIPTION dodge — call now, await the Effect later", () => {
  assert.equal(
    hits(["const p = client.surface.ns.verb(x);", "await p;"].join("\n"))
      .length,
    1,
  );
});

test("catches a namespace or whole face bound out and awaited through", () => {
  assert.equal(
    hits(
      ["const ns = client.surface.lifecycle;", "await ns.kill({ id });"].join(
        "\n",
      ),
    ).length,
    1,
  );
  assert.equal(
    hits(["const s = client.surface;", "await s.ns.verb(x);"].join("\n"))
      .length,
    1,
  );
});

test("catches the destructured spellings, including the face by its own name", () => {
  assert.equal(
    hits(["const { verb } = client.surface.ns;", "await verb(x);"].join("\n"))
      .length,
    1,
  );
  assert.equal(
    hits(
      ["const { surface } = client;", "await surface.ns.verb(x);"].join("\n"),
    ).length,
    1,
  );
  assert.equal(
    hits(
      ["const { kill: k } = app.procedures.process;", "await k({ pid });"].join(
        "\n",
      ),
    ).length,
    1,
  );
});

test("does NOT flag a stored description that is RUN rather than awaited", () => {
  // The legitimate shape the stored-description rule must not condemn: hold the
  // description, then hand it to a sanctioned edge.
  assert.equal(
    hits(
      [
        "const pending = view.procedures.license.use({ seat });",
        "const result = await Effect.runPromise(pending);",
      ].join("\n"),
    ).length,
    0,
  );
  // An alias that is CALLED and composed — `surfaceAppProbe`'s real shape.
  assert.equal(
    hits(
      [
        "const info = client.rpc.surface.identity?.info as UnaryEffect;",
        "return info({});",
      ].join("\n"),
    ).length,
    0,
  );
});

test("does NOT mark a name whose initializer merely CONTAINS a face call", () => {
  // `Effect.runPromise(...)` nests its parens, so the path grammar cannot read
  // it as a reference path — the value is a Promise, and awaiting it is correct.
  assert.equal(
    hits(
      [
        "const v = Effect.runPromise(client.surface.ns.verb(x));",
        "await v;",
      ].join("\n"),
    ).length,
    0,
  );
});

test("reports the 1-based line, so the message points at the call", () => {
  const found = hits(
    ["const a = 1;", "", "await c.surface.ns.verb(x);"].join("\n"),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 3);
});

test("does NOT flag a run — the ONE legitimate await, and the reason this scan can exist", () => {
  assert.equal(
    hits("await Effect.runPromise(client.surface.ns.verb(x));").length,
    0,
  );
});

test("does NOT flag composition", () => {
  assert.equal(hits("yield* client.surface.ns.verb(x);").length, 0);
  assert.equal(
    hits("Stream.runHead(client.surface.cell.get(undefined));").length,
    0,
  );
});

test("does NOT flag the ban NAMED in prose or quoted in a message", () => {
  assert.equal(hits("// await client.surface.ns.verb(x) is banned").length, 0);
  assert.equal(hits("/* await a.surface.n.v() */").length, 0);
  assert.equal(
    hits('throw new Error("await client.surface.ns.verb(x)");').length,
    0,
  );
});

test("does NOT flag an ordinary await", () => {
  assert.equal(hits("await sleep(10);").length, 0);
  assert.equal(hits("await link.dispose();").length, 0);
});

test("validate passes on nothing and names every hit when it fails", () => {
  assert.doesNotThrow(() => validateAwaitedFaceCalls([]));
  assert.throws(
    () =>
      validateAwaitedFaceCalls([
        { path: "packages/x/src/a.ts", line: 7, text: "await c.surface.n.v(" },
      ]),
    /packages\/x\/src\/a\.ts:7/,
  );
});
