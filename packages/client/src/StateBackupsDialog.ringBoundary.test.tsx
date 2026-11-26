// @vitest-environment happy-dom
/** A PICK IS DRAWN AT ONCE, NOT HELD.
 *
 *  Picking a ring commits in the press's own frame: the chosen ring's title
 *  and its "← Stores" affordance are on screen while the first listing is
 *  still in the air, with a plain "Loading…" where the rows will be. A
 *  remote padi ring answers in seconds, and a frame held that long is a
 *  frozen screen. Nothing falls back over a boundary, so there is no flash.
 *  A second listing of the SAME ring keeps the rows it has (dimmed) until
 *  the new ones land; a swap to ANOTHER ring drops them. */

import { Effect } from "effect";
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  /** Resolvers for the listings that have been asked for and not answered. */
  pending: [] as Array<(terminals: number) => void>,
  /** A signal the padi entry reads, so the test can make the SAME store list
   *  again without changing the subject. The test installs it. */
  revision: (() => 0) as () => number,
  answer(terminals: number) {
    const settle = fixture.pending.shift();
    if (!settle) throw new Error("no listing is pending");
    settle(terminals);
  },
  /** Resolvers for the restores asked for and not answered. */
  restores: [] as Array<() => void>,
  restored() {
    const land = fixture.restores.shift();
    if (!land) throw new Error("no restore is pending");
    land();
  },
}));

function listing(): Promise<{
  backups: Array<{
    file: string;
    savedAtMs: number;
    sizeBytes: number;
    summary: { kind: "session"; terminals: number };
  }>;
}> {
  const asked = Promise.withResolvers<{
    backups: Array<{
      file: string;
      savedAtMs: number;
      sizeBytes: number;
      summary: { kind: "session"; terminals: number };
    }>;
  }>();
  fixture.pending.push((terminals) =>
    asked.resolve({
      backups: [
        {
          file: `snap-${terminals}`,
          savedAtMs: 1,
          sizeBytes: 10,
          summary: { kind: "session", terminals },
        },
      ],
    }),
  );
  return asked.promise;
}

vi.mock("./wire", () => ({
  client: {
    server: {
      backups: {
        list: () => Effect.promise(() => Promise.resolve({ backups: [] })),
      },
    },
  },
  hostKeys: () => ["h1"],
  padiMap: {
    entry: () => {
      fixture.revision();
      return {
        state: () => ({ kind: "connected" }),
        clock: { toLocal: (ms: number) => ms },
        procedures: {
          backups: {
            list: () => Effect.promise(listing),
            restore: () =>
              Effect.promise(() => {
                const asked = Promise.withResolvers<void>();
                fixture.restores.push(() => asked.resolve());
                return asked.promise;
              }),
          },
        },
      };
    },
  },
}));
vi.mock("./ui/ModalDialog", () => ({
  default: (props: { open: boolean; children: JSX.Element }) => (
    <div>{props.open ? props.children : null}</div>
  ),
}));
vi.mock("@corvu-next/dialog", () => ({
  default: {
    Content: (props: { children: JSX.Element }) => <div>{props.children}</div>,
  },
}));
vi.mock("solid-sonner", () => ({
  toast: {
    loading: () => 1,
    success: () => {},
    error: () => {},
    warning: () => {},
  },
}));
vi.mock("./host/hostChipTone", () => ({ hostLabel: (host: string) => host }));

import StateBackupsDialog, { stateBackupsDialog } from "./StateBackupsDialog";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  stateBackupsDialog.close();
  flush();
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
  fixture.pending.length = 0;
  fixture.restores.length = 0;
});

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

function body(): string {
  if (!host) throw new Error("not mounted");
  return host.textContent ?? "";
}

function press(label: string): void {
  if (!host) throw new Error("not mounted");
  const button = [...host.querySelectorAll("button")].find((one) =>
    (one.textContent ?? "").includes(label),
  );
  if (!button) throw new Error(`no button reading ${label}`);
  button.click();
  flush();
}

/** Is the rows container dimmed? `null` when no rows are drawn. */
function rowsDimmed(): boolean | null {
  if (!host) throw new Error("not mounted");
  const containers = [...host.querySelectorAll("div")].filter(
    (one) =>
      one.className.includes("space-y-1.5") &&
      (one.textContent ?? "").includes("terminals"),
  );
  const rows = containers.at(-1);
  return rows ? rows.className.includes("opacity-60") : null;
}

it("draws the picked ring at once with Loading…, then its rows", async () => {
  const [revision, setRevision] = createSignal(0);
  fixture.revision = revision;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <StateBackupsDialog />, host);
  stateBackupsDialog.openDialog();
  flush();

  press("h1");
  // THE DESTINATION IS THE SCREEN IN THE PRESS'S OWN FRAME: its title, the
  // way back, and "Loading…" where the rows will be. The picker is gone —
  // nothing waits on the listing.
  // The dialog's own title stays put across the pick.
  expect(body()).toContain("State backups");
  expect(body()).toContain("padi — h1");
  expect(body()).toContain("← Stores");
  expect(body()).toContain("Loading…");
  expect(body()).not.toContain("Listing snapshots…");
  expect(body()).not.toContain("preferences · hosts");

  await settle();
  // Still waiting, still the same frame — nothing fell back over it.
  expect(body()).toContain("Loading…");
  expect(body()).toContain("← Stores");

  fixture.answer(3);
  await settle();
  expect(body()).toContain("3 terminals");
  expect(body()).not.toContain("Loading…");
  expect(rowsDimmed()).toBe(false);

  // THE SAME RING, listed again: the rows on screen are this ring's own, so
  // they stay up, dimmed, while the new ones are read.
  setRevision(1);
  await settle();
  expect(body()).toContain("3 terminals");
  expect(body()).not.toContain("Loading…");
  expect(rowsDimmed()).toBe(true);

  fixture.answer(5);
  await settle();
  expect(body()).toContain("5 terminals");
  expect(rowsDimmed()).toBe(false);

  // ANOTHER RING: the padi ring's snapshots are gone from under the
  // kolu-server title the moment it is picked.
  press("← Stores");
  press("kolu-server");
  expect(body()).not.toContain("5 terminals");
  expect(body()).toContain("Loading…");
});

/** Click a `data-testid`, then flush. */
function pressTestid(testid: string): void {
  if (!host) throw new Error("not mounted");
  const button = host.querySelector<HTMLButtonElement>(
    `[data-testid="${testid}"]`,
  );
  if (!button) throw new Error(`no element at ${testid}`);
  button.click();
  flush();
}

it("re-lists a restored ring ONCE, and leaves the rows undimmed while the restore runs", async () => {
  const [revision] = createSignal(0);
  fixture.revision = revision;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <StateBackupsDialog />, host);
  stateBackupsDialog.openDialog();
  flush();

  press("h1");
  fixture.answer(3);
  await settle();
  expect(body()).toContain("3 terminals");

  // THE RESTORE IS NOT A RE-LIST. It writes the view twice — in flight, then
  // back to the list — with the SAME ring both times, and neither write is a
  // new subject for the listing: nothing is asked for, and the rows the user
  // is looking at stay as they are (master listed once, at the end, too).
  pressTestid("state-backup-restore-snap-3");
  pressTestid("state-backup-restore-snap-3-confirm");
  await settle();
  expect(body()).toContain("Restoring…");
  expect(fixture.pending.length).toBe(0);
  expect(rowsDimmed()).toBe(false);

  // IT LANDS: exactly ONE listing is asked for, and the rows dim until it
  // answers.
  fixture.restored();
  await settle();
  expect(fixture.pending.length).toBe(1);
  expect(rowsDimmed()).toBe(true);

  fixture.answer(7);
  await settle();
  expect(body()).toContain("7 terminals");
  expect(fixture.pending.length).toBe(0);
  expect(rowsDimmed()).toBe(false);
});
