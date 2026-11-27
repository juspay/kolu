// @vitest-environment happy-dom
/** THE RESTORE CARD OVER A 250-TERMINAL SAVED SESSION.
 *
 *  The saved session is a CELL frame: `createSubscription` holds it in a
 *  `createStore`, so `session.terminals` is a store-proxy array and every field
 *  of every saved record is its own store leaf. The card's grouping walked that
 *  list — the index, `terminalKey`'s `cwd`/`git` leaves and `canvasLayout.x` per
 *  record, about six sources each — and its resumable set walked the stamped id
 *  array, so a session of a few dozen terminals already put both memos past
 *  Solid's 200-source `WIDE_SCOPE_DEPS` judge.
 *
 *  THE STORE IS THE REAL ONE, built the way `createHostWire` builds the session
 *  cell: `createSubscription(source, { arrayKey: "id" })`, the member's own
 *  declared identity (`packages/padi-client/src/surface.ts`'s `session` cell),
 *  so a re-serve recycles each record exactly as it does in the browser.
 *
 *  The session spans three repos with their records INTERLEAVED and their
 *  canvas x's out of order, so the published grouping and its left-to-right
 *  sort are both non-trivial. */

import type { SavedSession, SavedTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createSubscription } from "@kolu/surface/solid";
import { controllableStream, settle } from "@kolu/surface/solid/testlib";
import { render } from "@solidjs/web";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./WelcomeMoments", () => ({ default: () => null }));
vi.mock("./ForfeitSessionButton", () => ({ default: () => null }));

import EmptyState from "./EmptyState";

const TERMINALS = 250;
/** Three repos, interleaved: terminal `n` belongs to repo `n % 3`. */
const REPOS = 3;

const repoOf = (n: number): string => `repo${n % REPOS}`;
/** Canvas x, descending with the index — so repo 2 (whose first member is the
 *  LAST of the opening trio) is NOT the rightmost, and the card's sort has
 *  something to decide. */
const xOf = (n: number): number => TERMINALS - n;

const savedTerminal = (
  n: number,
  over: { cwd?: string; x?: number } = {},
): SavedTerminal =>
  ({
    id: `t${n}`,
    state: "active",
    cwd: over.cwd ?? `/w/${repoOf(n)}`,
    // Outside a repo, so `terminalKey` groups on the cwd's basename — which is
    // what makes the repo in the path the group heading below.
    git: { kind: "none" },
    canvasLayout: { x: over.x ?? xOf(n), y: 0, w: 10, h: 10 },
    restoreTarget: {
      kind: "exact",
      agent: {
        kind: "claude-code",
        resumeRef: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      },
      argv: [],
    },
  }) as unknown as SavedTerminal;
/** Every third terminal resumes an agent — the stamped membership. */
const RESUMABLE = Array.from({ length: TERMINALS }, (_, n) => n)
  .filter((n) => n % 3 === 0)
  .map((n) => `t${n}`);

const session = (
  over: { at?: number; cwd?: string; x?: number } = {},
): SavedSession =>
  ({
    terminals: Array.from({ length: TERMINALS }, (_, n) =>
      n === over.at ? savedTerminal(n, over) : savedTerminal(n),
    ),
    activeTerminalId: null,
    savedAt: 0,
    resumableIds: RESUMABLE,
  }) as unknown as SavedSession;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let disposeStore: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  disposeStore?.();
  host?.remove();
  dispose = undefined;
  disposeStore = undefined;
  host = undefined;
});

/** The card mounted over the real session cell. */
async function card() {
  const stream = controllableStream<SavedSession | null>();
  takeSolidDiagnostics();
  const saved = createRoot((disposeRoot) => {
    disposeStore = disposeRoot;
    // The member's own declared identity — see `session` in the padi surface.
    return createSubscription(stream.source, { arrayKey: "id" });
  });
  stream.push(session());
  await settle();
  flush();

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <EmptyState install={{} as never} savedSession={saved() ?? undefined} />
    ),
    host,
  );
  flush();
  return { stream };
}

/** Each repo heading in rendered order, with the ids beneath it. */
const painted = (): { key: string; ids: string[] }[] =>
  [
    ...(host as HTMLElement).querySelectorAll<HTMLElement>(
      '[data-testid="repo-group"]',
    ),
  ].map((group) => ({
    key: group.dataset.repoName as string,
    ids: [
      ...group.querySelectorAll<HTMLElement>(
        '[data-testid="restore-terminal-row"]',
      ),
    ].map((row) => row.dataset.terminalId as string),
  }));

/** The groups the card should paint: repo order by leftmost member (x descends
 *  with the index, so the LAST trio is leftmost), each holding its own members
 *  in saved order. */
const expectedGroups = (): { key: string; ids: string[] }[] => {
  const byRepo = new Map<string, string[]>();
  for (let n = 0; n < TERMINALS; n++) {
    const held = byRepo.get(repoOf(n));
    if (held) held.push(`t${n}`);
    else byRepo.set(repoOf(n), [`t${n}`]);
  }
  return [...byRepo.entries()]
    .map(([key, ids]) => ({ key, ids }))
    .sort(
      (a, b) =>
        Math.min(...a.ids.map((id) => xOf(Number(id.slice(1))))) -
        Math.min(...b.ids.map((id) => xOf(Number(id.slice(1))))),
    );
};

it("groups a 250-terminal saved session with no wide memo", async () => {
  const { stream } = await card();

  expect(painted()).toEqual(expectedGroups());
  // Every third row carries its resume line — the stamped membership, read
  // through the copied id set. In the order the card paints them: group by
  // group, not the saved session's own order.
  const resumable = new Set(RESUMABLE);
  expect(
    [
      ...(host as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-testid="resume-command"]',
      ),
    ].map((row) => row.dataset.terminalId),
  ).toEqual(
    expectedGroups().flatMap((group) =>
      group.ids.filter((id) => resumable.has(id)),
    ),
  );
  expect(diagnostics()).toEqual([]);

  // One terminal moves to a repo of its own, at the leftmost place on the
  // saved canvas: a fourth group appears, and it leads.
  stream.push(session({ at: 100, cwd: "/w/solo", x: -1 }));
  await settle();
  flush();
  const after = painted();
  expect(after[0]).toEqual({ key: "solo", ids: ["t100"] });
  expect(after.slice(1)).toEqual(
    expectedGroups().map((group) => ({
      key: group.key,
      ids: group.ids.filter((id) => id !== "t100"),
    })),
  );
  expect(diagnostics()).toEqual([]);
});
