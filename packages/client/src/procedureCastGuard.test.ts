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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_SRC = dirname(fileURLToPath(import.meta.url)); // packages/client/src

/** Every non-test `.ts`/`.tsx` source file under a directory. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(full) || /\.test(-d)?\.tsx?$/.test(full)) continue;
    out.push(full);
  }
  return out;
}

/** A cast of a `.rpc` field — `foo.rpc as Bar` (optionally through a whitespace
 *  break). Casting the raw procedure client is the "reach a declared procedure
 *  through `.rpc`" move the bound `procedures` face replaces. A bare `.rpc` read
 *  (reserved procs, the link-root escape hatch) carries no `as`, so it is allowed. */
const RPC_CAST_RE = /\.rpc\s+as\s+\w/;

/** ANY contract-wide client-shape copy — `ContractRouterClient<typeof …>`.
 *  Minting the oRPC client type for a concrete contract copies its whole callable
 *  shape (procedures included), which is exactly what the bound `procedures` /
 *  `entry.procedures` face makes unnecessary — so re-minting one here is the defect,
 *  whether it names a `…Surface.contract` or a bare `…Contract`. The full combined
 *  link (`client`/`link`) is typed via `connectSurfaces`' generics, not a hand-rolled
 *  `ContractRouterClient<typeof …>` alias, so nothing legitimate trips this. */
const CONTRACT_CLIENT_COPY_RE = /ContractRouterClient<\s*typeof\s/;

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(CLIENT_SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const rel = `${file.replace(`${CLIENT_SRC}/`, "")}:${i + 1}`;
      if (RPC_CAST_RE.test(line))
        violations.push(`${rel} — .rpc cast: ${line.trim()}`);
      if (CONTRACT_CLIENT_COPY_RE.test(line))
        violations.push(`${rel} — copied procedure shape: ${line.trim()}`);
    }
  }
  return violations;
}

describe("procedure cast guard — no declared Surface procedure is reached by casting `.rpc` or copied as a client-shape alias (SRT-PR2)", () => {
  it("packages/client/src has no `.rpc as <T>` cast and no `ContractRouterClient<typeof …Surface.contract>` alias — declared procedures ride the bound `procedures` face; bare `.rpc` (reserved/link-root) stays fine", () => {
    expect(findViolations()).toEqual([]);
  });
});
