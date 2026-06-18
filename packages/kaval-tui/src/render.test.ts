import type { PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import {
  commandName,
  formatList,
  formatListJson,
  relativeTime,
  resolveTerminalId,
  SHORT_ID_LEN,
  shortId,
  tildeify,
} from "./render.ts";

const entry = (over: Partial<PtyHostListEntry>): PtyHostListEntry => ({
  id: "3f9a",
  pid: 12843,
  cwd: "/home/srid/code/kolu",
  lastActivity: 0,
  ...over,
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  it("formats seconds, minutes, hours, days", () => {
    expect(relativeTime(now, now)).toBe("0s");
    expect(relativeTime(now - 5_000, now)).toBe("5s");
    expect(relativeTime(now - 90_000, now)).toBe("1m");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2h");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3d");
  });
  it("floors clock skew at 0s (never negative)", () => {
    expect(relativeTime(now + 10_000, now)).toBe("0s");
  });
});

describe("commandName", () => {
  it("takes the basename of a process path, empty passes through", () => {
    expect(commandName("/run/current-system/sw/bin/bash")).toBe("bash");
    expect(commandName("vim")).toBe("vim");
    expect(commandName("")).toBe("");
    expect(commandName(undefined)).toBe("");
  });
});

describe("tildeify", () => {
  it("collapses $HOME to ~", () => {
    expect(tildeify("/home/srid/code/kolu", "/home/srid")).toBe("~/code/kolu");
    expect(tildeify("/home/srid", "/home/srid")).toBe("~");
  });
  it("leaves non-home paths and a missing home untouched", () => {
    expect(tildeify("/etc/nixos", "/home/srid")).toBe("/etc/nixos");
    expect(tildeify("/home/srid/x")).toBe("/home/srid/x");
    // shares a prefix but isn't actually under home — must NOT be collapsed
    expect(tildeify("/home/sridhar", "/home/srid")).toBe("/home/sridhar");
  });
});

describe("formatList", () => {
  it("renders an honest one-liner for an empty inventory", () => {
    expect(formatList([], { now: 0 })).toBe("no live terminals.");
  });

  it("renders a header + one row each, cmd from title|foreground, cwd tilde'd", () => {
    const now = 60_000;
    const out = formatList(
      [
        entry({
          id: "abc",
          pid: 100,
          cwd: "/home/srid/code/kolu",
          lastActivity: now - 5_000,
          title: "claude: implement",
          foregroundProcess: "node",
        }),
        entry({
          // A full-length uuid: the rendered id column truncates to the first
          // SHORT_ID_LEN chars (`7f3e0a91`), while ids already shorter than that
          // (`abc` above) pass through unchanged.
          id: "7f3e0a91-aaaa-bbbb-cccc-dddddddddddd",
          pid: 12,
          cwd: "/etc",
          lastActivity: now - 120_000,
          title: "",
          foregroundProcess: "vim",
        }),
      ],
      { now, home: "/home/srid" },
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^ID\s+PID\s+IDLE\s+CMD\s+CWD$/);
    // title wins when set; short id passes through unchanged (<8 chars)
    expect(lines[1]).toMatch(
      /^abc\s+100\s+5s\s+claude: implement\s+~\/code\/kolu$/,
    );
    // falls back to the foreground command when the title is empty, and the
    // long uuid is truncated to its 8-char short form
    expect(lines[2]).toMatch(/^7f3e0a91\s+12\s+2m\s+vim\s+\/etc$/);
  });

  it("shows an em-dash when a terminal has neither title nor foreground", () => {
    const out = formatList(
      [entry({ id: "x", title: "", foregroundProcess: "" })],
      { now: 0 },
    );
    expect(out.split("\n")[1]).toMatch(/—/);
  });
});

describe("formatListJson", () => {
  it("emits a top-level array (jq '.[]'-friendly) carrying the full entry", () => {
    const parsed = JSON.parse(
      formatListJson([
        entry({ id: "x", title: "zsh", foregroundProcess: "zsh" }),
      ]),
    );
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ id: "x", pid: 12843, title: "zsh" });
  });

  it("keeps the FULL id (scripts resolve against it), unlike the human table", () => {
    const id = "7f3e0a91-aaaa-bbbb-cccc-dddddddddddd";
    const parsed = JSON.parse(formatListJson([entry({ id })]));
    expect(parsed[0].id).toBe(id);
  });
});

describe("shortId", () => {
  it("takes the first SHORT_ID_LEN chars of a uuid", () => {
    expect(shortId("7f3e0a91-aaaa-bbbb-cccc-dddddddddddd")).toBe("7f3e0a91");
    expect("7f3e0a91").toHaveLength(SHORT_ID_LEN);
  });
  it("passes through ids already shorter than SHORT_ID_LEN", () => {
    expect(shortId("abc")).toBe("abc");
    expect(shortId("")).toBe("");
  });
});

describe("resolveTerminalId", () => {
  // Named (not indexed) so each is a plain `string` under
  // noUncheckedIndexedAccess. ID_A and ID_B share the `7f3e0a9` prefix.
  const ID_A = "7f3e0a91-aaaa-bbbb-cccc-dddddddddddd";
  const ID_B = "7f3e0a92-eeee-ffff-0000-111111111111";
  const ID_C = "a18c9ff0-2222-3333-4444-555555555555";
  const ids = [ID_A, ID_B, ID_C];

  it("resolves a unique short prefix to the full id", () => {
    expect(resolveTerminalId("a18c", ids)).toEqual({ kind: "found", id: ID_C });
  });

  it("resolves a single-char prefix when it's unique", () => {
    expect(resolveTerminalId("a", ids)).toEqual({ kind: "found", id: ID_C });
  });

  it("treats a full id as a prefix of itself (pasted ids keep working)", () => {
    expect(resolveTerminalId(ID_A, ids)).toEqual({ kind: "found", id: ID_A });
  });

  it("returns the exact id even when it's a prefix of a longer one", () => {
    // "7f3e0a91" exactly matches one id and prefixes no longer one, so the
    // exact-match short-circuit must win over the startsWith scan.
    const withNested = [...ids, "7f3e0a91"];
    expect(resolveTerminalId("7f3e0a91", withNested)).toEqual({
      kind: "found",
      id: "7f3e0a91",
    });
  });

  it("is case-insensitive (uuids are lowercase hex)", () => {
    expect(resolveTerminalId("A18C", ids)).toEqual({ kind: "found", id: ID_C });
  });

  it("reports an ambiguous prefix with all matching ids", () => {
    const result = resolveTerminalId("7f3e0a9", ids);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.matches).toEqual([ID_A, ID_B]);
    }
  });

  it("reports no match for a prefix nothing starts with", () => {
    expect(resolveTerminalId("zz", ids)).toEqual({ kind: "none" });
  });

  it("reports no match against an empty inventory", () => {
    expect(resolveTerminalId("anything", [])).toEqual({ kind: "none" });
  });

  it("rejects an empty query even with one live terminal (no footgun)", () => {
    // "" is a prefix of every id, so without the guard a single live terminal
    // would resolve — an accidentally-empty `$id` must fail loud instead.
    expect(resolveTerminalId("", [ID_A])).toEqual({ kind: "none" });
    expect(resolveTerminalId("", ids)).toEqual({ kind: "none" });
  });
});
