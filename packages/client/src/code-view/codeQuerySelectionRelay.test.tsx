// @vitest-environment happy-dom
/**
 * A CODE-TAB QUERY AGAINST THE SELECTION THAT KEYS IT.
 *
 * The Code tab's reads are keyed on where focus stands: the repo, the pane's
 * mode and the selected file (`codeQueries.ts`). So ONE write of the root the
 * selection lives in — `perTerminal.selectedFileByMode` — re-keys a query, and
 * what that query publishes is what the split's panels are then written with.
 *
 * The victim here is an ELEMENT SPREAD: corvu's `Resizable.Panel` applies all
 * of its props in one effect, so recording what one prop is built from
 * records one application of the panel. That prop carries BOTH facts the
 * Code tab's tree panel carries — the selected path it highlights, and what
 * the query answers FOR that path — which is what puts the panel on the
 * selection write's own frame and makes a relayed reset visible: a query that
 * RESET itself from its poll effect's apply arm wrote the panel twice, once
 * with the NEW selection beside the PREVIOUS file's content, and again after
 * the reset landed (`EFFECT_RELAY_TEAR`, root `perTerminal.selectedFileByMode`,
 * wrote `createPolledQuery`'s published answer). Deriving the query's faces
 * against the key that answer is stamped with makes it one: a panel written
 * with the new selection and the loading line that honestly answers it.
 *
 * A reader that took ONLY the query would not catch this — the reset is the
 * only thing that wakes it, so it applies once either way. The tear is a
 * SECOND application of a reader the root already woke, which is why the
 * panel must read the selection too, exactly as the product's does.
 *
 * The query is the real `createPolledQuery` over a hand-driven pulse: the
 * stamp, the landing and the faces are the product's, not a replica's.
 */

import Resizable from "@corvu-next/resizable";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { StreamingProcedure } from "@kolu/surface/solid";
import { render } from "@solidjs/web";
import { Effect } from "effect";
import { createMemo, createSignal, createStore, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { controlledSizes } from "../ui/corvuResizable";
import { createPolledQuery } from "./createPolledQuery";

const pulseCtl = vi.hoisted(() => ({
  latest: null as null | {
    emit: (e: { frame: true } | { err: Error }) => void;
  },
}));
// The pulse is an UNENROLLED stream; the fixture pushes a frame by hand, which
// is one requery. (The factory runs before this file's imports are bound, so
// the shared mock is reached through a dynamic import.)
vi.mock("@kolu/surface/client", async () => {
  const { makeControllableStream } = await import("./streamMock.testlib");
  return {
    unenrolledStreamCall: () => {
      const { stream, push } = makeControllableStream();
      pulseCtl.latest = { emit: push };
      return stream;
    },
  };
});

async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** Every finding this test's own work raised, as `code message` pairs. */
const raised = () =>
  takeSolidDiagnostics().map((event) => `${event.code} ${event.message}`);

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  pulseCtl.latest = null;
});

it("writes the split's panel once per selection write, over the real file query", async () => {
  // The root: the per-terminal record the Code tab's selection lives in.
  const [perTerminal, setPerTerminal] = createStore(
    { selectedFileByMode: { browse: "a.ts" } },
    { name: "perTerminal" },
  );
  const [repoPath] = createSignal("/srv/code/kestrel");
  let reads = 0;

  const pulseProc: () => StreamingProcedure<
    { repoPath: string },
    { seq: number }
  > = () =>
    null as unknown as StreamingProcedure<
      { repoPath: string },
      { seq: number }
    >;

  /** What the panel was written with, in order. */
  const applied: string[] = [];

  host = document.createElement("div");
  document.body.append(host);

  dispose = render(() => {
    // The product's file-content read: keyed on the repo AND the selected
    // file, so a selection write re-keys it.
    const fileContent = createPolledQuery({
      input: () => ({
        repoPath: repoPath(),
        filePath: perTerminal.selectedFileByMode.browse,
      }),
      live: () => true,
      pulseProc,
      pulseInput: (i) => ({ repoPath: i.repoPath }),
      query: (i) =>
        Effect.sync(() => {
          reads += 1;
          return `${i.filePath}#${reads}`;
        }),
    });
    // What the panel SHOWS, derived from the query the way the Code tab's own
    // readers are (`treeInventory`, `treeGitStatus`, `browseFile`): a memo
    // over the query's VALUE, so the frame below carries the answer
    // `createPolledQuery` published — the write review 44 read off the
    // dev-lane log. No answer for the standing key yet is the panel's loading
    // line.
    const shown = createMemo(() => fileContent() ?? "loading", {
      name: "shownFileContent",
    });
    const sizes = controlledSizes(() => [0.5, 0.5]);
    return (
      <Resizable orientation="vertical" sizes={sizes()}>
        <Resizable.Panel
          as="div"
          data-testid="diff-file-list"
          minSize={0.1}
          // THE FRAME THE PANEL IS WRITTEN WITH — the selection it highlights
          // beside what the query answers FOR that selection, which is what
          // the Code tab's tree panel carries (the selected path and the
          // listing keyed on it). Both are read inside corvu's one spread, so
          // the recorded string IS one application of the element's props,
          // and the selection write wakes the spread on its own.
          aria-label={(() => {
            const frame = `${perTerminal.selectedFileByMode.browse}|${shown()}`;
            applied.push(frame);
            return frame;
          })()}
        />
        <Resizable.Handle as="button" startIntersection={false} />
        <Resizable.Panel as="div" data-testid="diff-content" minSize={0.1} />
      </Resizable>
    );
  }, host);
  flush();
  // The first read lands, so the panel carries an answer before the drive.
  pulseCtl.latest?.emit({ frame: true });
  await settle();
  flush();
  expect(applied.at(-1)).toBe("a.ts|a.ts#1");

  // FIVE selection writes, each followed by the landing of its own read. Five,
  // because a relay tear escalates to `warn` on the third sighting and a drive
  // that stopped at the threshold could be silenced by dropping one write.
  const perWrite: Array<{
    path: string;
    onWrite: string[];
    onLanding: string[];
  }> = [];
  for (const path of ["b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]) {
    applied.length = 0;
    setPerTerminal((draft) => {
      draft.selectedFileByMode.browse = path;
    });
    flush();
    const onWrite = [...applied];
    // The new key's own answer arrives on the next pulse frame.
    applied.length = 0;
    pulseCtl.latest?.emit({ frame: true });
    await settle();
    flush();
    perWrite.push({ path, onWrite, onLanding: [...applied] });
  }

  // ONE WRITE OF THE PANEL PER WRITE OF THE SELECTION, carrying the new key's
  // own state — `loading`, never the file the user just navigated away from —
  // and one more for the landing that answers it.
  expect(perWrite).toEqual([
    { path: "b.ts", onWrite: ["b.ts|loading"], onLanding: ["b.ts|b.ts#2"] },
    { path: "c.ts", onWrite: ["c.ts|loading"], onLanding: ["c.ts|c.ts#3"] },
    { path: "d.ts", onWrite: ["d.ts|loading"], onLanding: ["d.ts|d.ts#4"] },
    { path: "e.ts", onWrite: ["e.ts|loading"], onLanding: ["e.ts|e.ts#5"] },
    { path: "f.ts", onWrite: ["f.ts|loading"], onLanding: ["f.ts|f.ts#6"] },
  ]);
  expect(raised()).toEqual([]);
});
