/**
 * NEGATIVE-PROPERTY PIN (SRT-PR2 — procedures join the typed dual): no production
 * consumer CASTS a declared Surface procedure client or COPIES its callable client
 * shape. Every declared procedure now has a bound, declaration-typed face —
 * `client.procedures.<ns>.<verb>` and `entry.procedures.<ns>.<verb>` — so the
 * `PadiRpc = ContractRouterClient<typeof padiSurface.contract>` alias and its two
 * `... .rpc as PadiRpc` casts (the copied callable shape kolu used to recover from
 * the generically-`unknown` map-entry `.rpc`) are gone. This test is the residual
 * fence that keeps them gone.
 *
 * The precise line the pin draws (per the plan's boundary): a BARE `.rpc` is
 * legitimate — it reaches the RESERVED framework procedures (`system.identity` /
 * `system.live`, contract-only, never in `spec.procedures`) and the link-root
 * escape hatch (`client.server` / `client.daemon`), both already typed with no
 * cast. What is forbidden is reaching a DECLARED procedure THROUGH that raw client
 * by CASTING it — `... .rpc as SomeRpc` — or naming the copied shape with a
 * `ContractRouterClient<typeof <someSurface>.contract>` alias. Those are the
 * defect the bound `procedures` face exists to make unspellable.
 *
 * Scope: the whole `packages/client/src` tree (non-test). The type-level dual —
 * that `entry.procedures` is a real, declaration-typed callable and NOT `unknown`
 * — lives in `wire.procedures.test-d.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "./architectureGuardSources.testlib";

const CLIENT_SRC = dirname(fileURLToPath(import.meta.url)); // packages/client/src

/** A cast of a `.rpc` field — `foo.rpc as Bar` (optionally through a whitespace
 *  break, INCLUDING a newline). Casting the raw procedure client is the "reach a
 *  declared procedure through `.rpc`" move the bound `procedures` face replaces. A
 *  bare `.rpc` read (reserved procs, the link-root escape hatch) carries no `as`, so
 *  it is allowed. */
const RPC_CAST_RE = /\.rpc\s+as\s+\w/;

/** ANY contract-wide client-shape copy — `ContractRouterClient<typeof …>`.
 *  Minting the oRPC client type for a concrete contract copies its whole callable
 *  shape (procedures included), which is exactly what the bound `procedures` /
 *  `entry.procedures` face makes unnecessary — so re-minting one here is the defect,
 *  whether it names a `…Surface.contract` or a bare `…Contract`. The full combined
 *  link (`client`/`link`) is typed via `connectSurfaces`' generics, not a hand-rolled
 *  `ContractRouterClient<typeof …>` alias, so nothing legitimate trips this. */
const CONTRACT_CLIENT_COPY_RE = /ContractRouterClient<\s*typeof\s/;

/** Every match of `re` in `text`, reported as `"<label>:<line>: <snippet>"`. Scans
 *  the WHOLE file (not line-by-line), so a pattern whose `\s*`/`\s+` spans a NEWLINE
 *  — the multiline `PadiRpc = ContractRouterClient<\n  typeof …>` alias, a
 *  `.rpc\n  as X` cast — is caught, then maps the match offset back to a 1-based line
 *  number. (A line-split scan silently misses those, the exact hole the removed
 *  alias was formatted into.) */
function scan(text: string, re: RegExp, label: string): string[] {
  const g = new RegExp(re.source, `${re.flags.replace(/g/g, "")}g`);
  const hits: string[] = [];
  for (let m = g.exec(text); m !== null; m = g.exec(text)) {
    const line = text.slice(0, m.index).split("\n").length;
    const snippet = m[0].replace(/\s+/g, " ").trim();
    hits.push(`${label}:${line}: ${snippet}`);
  }
  return hits;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of listGuardSourceFiles(CLIENT_SRC)) {
    const text = readFileSync(file, "utf8");
    const rel = file.replace(`${CLIENT_SRC}/`, "");
    for (const hit of scan(text, RPC_CAST_RE, `${rel} — .rpc cast`))
      violations.push(hit);
    for (const hit of scan(
      text,
      CONTRACT_CLIENT_COPY_RE,
      `${rel} — copied procedure shape`,
    ))
      violations.push(hit);
  }
  return violations;
}

describe("procedure cast guard — no declared Surface procedure is reached by casting `.rpc` or copied as a client-shape alias (SRT-PR2)", () => {
  it("packages/client/src has no `.rpc as <T>` cast and no `ContractRouterClient<typeof …Surface.contract>` alias — declared procedures ride the bound `procedures` face; bare `.rpc` (reserved/link-root) stays fine", () => {
    expect(findViolations()).toEqual([]);
  });

  // The scanner's own MULTILINE competence — the exact formatting the removed
  // `PadiRpc` alias / a wrapped `.rpc as` cast take. A line-by-line scan would
  // return `[]` here (green while the regression is back); the full-text scan must
  // catch both across the newline.
  it("catches the multiline forms a line-split scan would miss (the removed alias / a wrapped cast)", () => {
    const multilineAlias =
      "type PadiRpc = ContractRouterClient<\n  typeof padiSurface.contract\n>;";
    expect(scan(multilineAlias, CONTRACT_CLIENT_COPY_RE, "fixture")).toEqual([
      "fixture:1: ContractRouterClient< typeof",
    ]);

    const multilineCast = "const p = entry.rpc\n  as PadiRpc;";
    expect(scan(multilineCast, RPC_CAST_RE, "fixture")).toEqual([
      "fixture:1: .rpc as P",
    ]);
  });
});
