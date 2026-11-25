// @vitest-environment happy-dom
/** The snapshot list's boundary is KEYED ON THE STORE BEING BROWSED.
 *
 *  Picking another ring changes what the list is of: the boundary is built
 *  again with the new store, so it has shown nothing yet and holds that
 *  store's first listing — "Loading…" comes back, while the dialog's own
 *  chrome keeps drawing. A second listing of the SAME store is not a new
 *  subject: the boundary is the same one, it has already shown rows, and they
 *  stay on screen (dimmed) until the new ones land. */

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

it("holds a newly picked ring in its own boundary and keeps the rows on a re-list", async () => {
  const [revision, setRevision] = createSignal(0);
  fixture.revision = revision;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <StateBackupsDialog />, host);
  stateBackupsDialog.openDialog();
  flush();

  press("h1");
  await settle();
  // The first listing of this ring is held by the boundary born with it — and
  // the dialog's own chrome draws beside it.
  expect(body()).toContain("Loading…");
  expect(body()).toContain("State backups");
  expect(body()).toContain("← Stores");

  fixture.answer(3);
  await settle();
  expect(body()).toContain("3 terminals");

  // THE SAME RING, listed again: the boundary has already shown rows, so they
  // stay up while the new ones are read.
  setRevision(1);
  await settle();
  expect(body()).toContain("3 terminals");
  expect(body()).not.toContain("Loading…");

  fixture.answer(5);
  await settle();
  expect(body()).toContain("5 terminals");

  // ANOTHER RING: a new subject, so the waiting line comes back and the padi
  // ring's snapshots are gone from under the kolu-server title.
  press("← Stores");
  press("kolu-server");
  await settle();
  expect(body()).not.toContain("5 terminals");
});
