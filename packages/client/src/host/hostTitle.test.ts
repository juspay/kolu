/**
 * `hostTitle` — the tab-identity pin (F5): the browser tab title reflects the ACTIVE host,
 * never the raw env string. Plain "Kolu" on the local default; "Kolu [<host>]" on a remote.
 */

import { LOCAL_HOST } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { hostTitle } from "./hostTitle";

describe("hostTitle — tab identity binds to the active host", () => {
  it("plain 'Kolu' on the local default (no host qualifier)", () => {
    expect(hostTitle(LOCAL_HOST)).toBe("Kolu");
  });

  it("'Kolu [<host>]' when a remote host is active", () => {
    expect(hostTitle({ kind: "remote", target: "srid@zest" })).toBe(
      "Kolu [srid@zest]",
    );
    expect(hostTitle({ kind: "remote", target: "pu-42" })).toBe("Kolu [pu-42]");
  });

  it("never emits a comma-seed list — it is one active host, not the env", () => {
    // A HostKey is one host, so the title can only ever name that one — a raw
    // `KOLU_PADI_HOST="local,zest,pu"` env value can't reach the title (it's not a HostKey).
    const active = { kind: "remote" as const, target: "zest" };
    expect(hostTitle(active)).toBe("Kolu [zest]");
    expect(hostTitle(active)).not.toContain(",");
  });
});
