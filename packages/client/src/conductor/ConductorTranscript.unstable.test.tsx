// @vitest-environment happy-dom
/**
 * A CHUNK ARRIVING MUST WAKE THE ROW IT LANDS IN, AND NOTHING ELSE.
 *
 * The transcript's folds run over the WHOLE conversation on every frame
 * (`foldNoticeRuns` → `foldToolRuns` → `foldFailureRuns`), so every row's
 * item object — and the list inside a folded one — is rebuilt while a reply
 * streams. Each row's `<Match>` arm is therefore handed a new-but-equivalent
 * value per chunk unless the arm's own memo closes a gate on it, and Solid's
 * `UNSTABLE_MEMO_OUTPUT` is what says so.
 *
 * `@kolu/solid-markdown` is scripted (DOMPurify needs more platform than
 * happy-dom gives — see `ConductorProse.test.tsx`), and the app's shared
 * readings are scripted because this is about one component's arms.
 */

import type { ConductorRow, ConductorToolRow } from "kolu-common/conductor";
import type { Work, WorkId } from "kolu-work";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";

vi.mock("@kolu/solid-markdown", async () => {
  // The factory is hoisted above this file's imports, so the primitives it
  // needs are reached from inside it.
  const solid = await import("solid-js");
  return {
    Markdown: (props: { markdown: string; onRendered?: () => void }) => {
      const host = document.createElement("div");
      // A RENDER effect, as the real component's `innerHTML` binding is,
      // then the user effect that tells the caller the prose has landed.
      solid.createRenderEffect(
        () => props.markdown,
        (text) => {
          host.textContent = text;
        },
      );
      solid.createEffect(
        () => props.markdown,
        () => solid.untrack(() => props.onRendered)?.(),
      );
      return host;
    },
    decorateInlineCode: (markdown: string) => markdown,
    bindMarkdownLinks: () => () => {},
  };
});

// `@kolu/solid-pierre` reaches a Nix-backed virtual grammar module that only
// the app's Vite config aliases; the diff view is not what this test is
// about, so the two names `ConductorDiffs` imports are scripted.
vi.mock("@kolu/solid-pierre", () => ({
  CodeView: () => document.createElement("div"),
  textDiffItem: () => undefined,
}));

vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map<WorkId, Work>(),
  useWorkMembers: () => () => new Map(),
  useSeen: () => () => new Map(),
  useAgentNotes: () => () => [],
  useFileHolders: () => () => new Map(),
}));

vi.mock("./useConductor", () => ({
  useConductor: () => ({ answer: vi.fn(), send: vi.fn() }),
}));

import ConductorTranscript from "./ConductorTranscript";
import { Shown } from "../ui/shown";
import type { Turn } from "./turnWorks";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const SINCE = "2026-01-01T00:00:00.000Z";

const agent = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: SINCE,
  kind: "agent",
  text,
});

const notice = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: SINCE,
  kind: "notice",
  text,
});

/** A SETTLED tool call — one that joins the closed "Details" fold rather than
 *  keeping its place in the flow. */
const tool = (id: string, seq: number): ConductorRow =>
  ({
    id,
    seq,
    since: SINCE,
    kind: "tool",
    text: id,
    status: "completed",
  }) as ConductorToolRow;

describe("a transcript while a reply streams", () => {
  it("keeps every other row's arm across four chunks", () => {
    // The conversation: a reply that is done, two settled calls folded into
    // one "Details", a notice, and the reply still being written. Only the
    // last row's text moves.
    const settled: ReadonlyArray<ConductorRow> = [
      agent("a1", 1, "the first reply"),
      tool("t1", 2),
      tool("t2", 3),
      notice("n1", 4, "the agent exited"),
    ];
    const [rows, setRows] = createSignal<ReadonlyArray<ConductorRow>>([
      ...settled,
      agent("a2", 5, "wri"),
    ]);
    const turns: ReadonlyMap<string, Turn> = new Map(
      [...settled, agent("a2", 5, "")].map((row) => [
        row.id,
        { head: "a1", works: [] as ReadonlyArray<WorkId> },
      ]),
    );
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(
      () => (
        <Shown value={() => true}>
          <ConductorTranscript
            rows={rows()}
            turns={turns}
            pending={false}
            error={undefined}
            containerRef={() => {}}
          />
        </Shown>
      ),
      host,
    );
    const details = host.querySelector("details");
    const first = host.textContent ?? "";
    expect(first).toContain("the first reply");
    expect(details).not.toBeNull();

    // The mount's own frame is not the subject.
    takeSolidDiagnostics();

    for (const chunk of ["writ", "writi", "writin", "writing"]) {
      // A CHUNK: the reducer replaces the streaming row's object and leaves
      // every other row's alone.
      setRows([...settled, agent("a2", 5, chunk)]);
      flush();
    }

    expect(host.textContent).toContain("writing");
    expect(host.textContent).toContain("the first reply");
    // The fold is the SAME element: its run never changed.
    expect(host.querySelector("details")).toBe(details);
    // Every chunk makes the package report a rewrite from a USER effect, and
    // the transcript's follow effect reads that note: EMPTY, advisories
    // included, so a tear fails at its first sighting.
    expect(takeSolidDiagnostics()).toEqual([]);
  });
});
