/**
 * The stamped cache's three load-bearing behaviours: it does not re-read an
 * unmoved file, it DOES re-read a moved one, and it never remembers an absent
 * one (which would make "the agent has not started yet" a permanent verdict).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stampedCache } from "./stamped-read.ts";

const roots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "stamped-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

it("re-derives only when (mtimeMs, size) moves", () => {
  const file = join(scratch(), "f");
  writeFileSync(file, "one");
  const cache = stampedCache<string>(8);
  let derivations = 0;
  const read = () =>
    cache.read(file, () => {
      derivations += 1;
      return `v${derivations}`;
    });

  expect(read()).toBe("v1");
  expect(read()).toBe("v1");
  expect(read()).toBe("v1");
  expect(derivations).toBe(1);

  // A different LENGTH, so the stamp moves even inside one millisecond.
  writeFileSync(file, "another value");
  expect(read()).toBe("v2");
  expect(derivations).toBe(2);
});

it("never caches an absent file, and hands the reader no stat for it", () => {
  const dir = scratch();
  const file = join(dir, "later");
  const cache = stampedCache<string>(8);
  const seen: boolean[] = [];
  const read = () =>
    cache.read(file, (stat) => {
      seen.push(stat !== undefined);
      return stat === undefined ? "absent" : "present";
    });

  expect(read()).toBe("absent");
  expect(read()).toBe("absent");
  expect(cache.size).toBe(0); // nothing held — absence is not a cacheable fact

  writeFileSync(file, "now here");
  expect(read()).toBe("present");
  expect(seen).toEqual([false, false, true]);

  // And a file that goes away stops answering from the cache.
  rmSync(file);
  expect(read()).toBe("absent");
  expect(cache.size).toBe(0);
});

it("stays within its bound, evicting the least recently used", () => {
  const dir = scratch();
  const cache = stampedCache<string>(2);
  const files = ["a", "b", "c"].map((n) => {
    const f = join(dir, n);
    writeFileSync(f, n);
    return f;
  });
  let derivations = 0;
  const read = (f: string) =>
    cache.read(f, () => {
      derivations += 1;
      return f;
    });

  read(files[0]!);
  read(files[1]!);
  read(files[0]!); // `a` is now the most recently used, `b` the least
  expect(derivations).toBe(2);

  read(files[2]!); // evicts `b`
  expect(cache.size).toBe(2);
  read(files[0]!); // still held
  expect(derivations).toBe(3);
  read(files[1]!); // was evicted — re-derived
  expect(derivations).toBe(4);
});
