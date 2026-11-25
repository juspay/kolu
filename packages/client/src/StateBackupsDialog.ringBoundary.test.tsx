// @vitest-environment happy-dom
/** A PICK IS HELD, NOT FLASHED.
 *
 *  The dialog's body sits in ONE boundary, born with the dialog and revealed
 *  by the store picker — nothing is in the air while a ring is being chosen.
 *  Picking one lands that ring's first listing, so the write is HELD: the
 *  picker stays on screen, the row pressed says it is listing, and the title,
 *  the "← Stores" affordance and the rows commit together. A boundary built
 *  per ring would show "Loading…" for every pick instead — a flicker for a
 *  listing that answers in milliseconds. A second listing of the SAME ring
 *  keeps the rows it has on screen (dimmed) until the new ones land. */

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
          backups: { list: () => Effect.promise(listing) },
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

it("holds the picker while a newly picked ring lists, and keeps the rows on a re-list", async () => {
  const [revision, setRevision] = createSignal(0);
  fixture.revision = revision;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <StateBackupsDialog />, host);
  stateBackupsDialog.openDialog();
  flush();

  press("h1");
  await settle();
  // The pick is HELD, not flashed: no fallback, the picker is still the
  // screen (the kolu-server row beside it is still there), and the row that
  // was pressed says what it is doing.
  expect(body()).not.toContain("Loading…");
  expect(body()).toContain("Listing snapshots…");
  expect(body()).toContain("kolu-server");
  expect(body()).toContain("State backups");
  expect(body()).not.toContain("← Stores");

  // The whole frame lands at once — chrome, title and rows together.
  fixture.answer(3);
  await settle();
  expect(body()).toContain("3 terminals");
  expect(body()).toContain("← Stores");
  expect(body()).not.toContain("Listing snapshots…");

  // THE SAME RING, listed again: the rows on screen are this ring's own, so
  // they stay up (dimmed) while the new ones are read.
  setRevision(1);
  await settle();
  expect(body()).toContain("3 terminals");
  expect(body()).not.toContain("Loading…");

  fixture.answer(5);
  await settle();
  expect(body()).toContain("5 terminals");

  // ANOTHER RING: the padi ring's snapshots are gone from under the
  // kolu-server title — the swap commits in one frame.
  press("← Stores");
  press("kolu-server");
  await settle();
  expect(body()).not.toContain("5 terminals");
});
