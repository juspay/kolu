// @vitest-environment happy-dom

/** THE ATTENTION MIRROR AT A FLEET'S SIZE — one host's partition over 250
 *  terminals, and the live set beside it.
 *
 *  Two feeds arrive per host and both carry ID LISTS: the `urgency` cell's four
 *  class lists and the `activity` stream's live set. A subscription hands its
 *  value back as a STORE, so those lists are store arrays — and a mirror that
 *  copied them with a spread subscribed itself to one leaf per terminal, which
 *  Solid's development build judges `WIDE_SCOPE_DEPS` past 200 sources: about
 *  190 terminals on one host, which is one busy workstation.
 *
 *  The feeds here are the REAL subscription stores (`createSubscription` over
 *  the hand-driven source in `hostScope/hostWireMirror.testlib.ts`), because
 *  the proxy array is exactly what a mock would flatten away.
 *
 *  What is pinned is the mirror's published reading: every terminal's class and
 *  live flag, before and after one agent answers while another starts working
 *  and the bytes move elsewhere. */

import type { PadiUrgency } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ entry: (() => undefined) as () => unknown }));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
}));

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useAttentionFacts } from "./useAttentionFacts";

const TERMINALS = 250;
const ENC = "local";
const idAt = (at: number) => `t${at}` as TerminalId;
const ids = Array.from({ length: TERMINALS }, (_, at) => idAt(at));

/** The partition padi reports: every terminal in exactly one class, by index,
 *  with the tail left unmentioned — `idle` is the ABSENCE of a mention. */
const asking = ids.filter((_, at) => at % 5 === 0);
const working = ids.filter((_, at) => at % 5 === 1);
const linger = ids.filter((_, at) => at % 5 === 2);
const finished = ids.filter((_, at) => at % 5 === 3);
const idle = ids.filter((_, at) => at % 5 === 4);
/** Bytes are moving in all but a fifth of them — a build storm, whatever class
 *  each terminal is in. */
const live = ids.filter((_, at) => at % 5 !== 0);

const urgencyOf = (over: {
  asking?: readonly TerminalId[];
  working?: readonly TerminalId[];
  linger?: readonly TerminalId[];
  finished?: readonly TerminalId[];
  settled?: boolean;
}): PadiUrgency =>
  ({
    awaitingIds: over.asking ?? [],
    workingIds: over.working ?? [],
    lingerIds: over.linger ?? [],
    finishedIds: over.finished ?? [],
    settled: over.settled ?? true,
  }) as unknown as PadiUrgency;

/** The one that answers, and the one that picks up work. */
const ANSWERED = asking[2];
const STARTED = idle[5];

/** The two readers under test, named rather than inferred off the hook. */
type Facts = {
  classOf: (encHost: string, id: TerminalId) => AttentionClass;
};

const classed = (facts: Facts, klass: AttentionClass): TerminalId[] =>
  ids.filter((id) => facts.classOf(ENC, id) === klass);

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("mirrors one host's 250-terminal partition with no wide scope", async () => {
  if (ANSWERED === undefined || STARTED === undefined)
    throw new Error("fixture");
  const mirror = hostWireMirror();
  held.entry = () => mirror.entry;
  takeSolidDiagnostics();
  const facts = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return useAttentionFacts();
  });

  mirror.pushUrgency(urgencyOf({ asking, working, linger, finished }));
  mirror.pushActivity(live);
  await settle();
  flush();

  // EVERY TERMINAL'S CLASS, and the live flag beside it — the two independent
  // feeds, joined only at the per-terminal reader.
  expect(classed(facts, "asking")).toEqual(asking);
  expect(classed(facts, "working")).toEqual(working);
  expect(classed(facts, "linger")).toEqual(linger);
  expect(classed(facts, "finished")).toEqual(finished);
  expect(classed(facts, "idle")).toEqual(idle);
  expect(ids.filter((id) => facts.attentionOf(ENC, id).live)).toEqual(live);
  // One terminal's whole reading: the two feeds meet here and nowhere else —
  // this one is blocked on you and its bytes are NOT moving.
  expect(facts.attentionOf(ENC, asking[0] as TerminalId)).toEqual({
    klass: "asking",
    live: false,
  });
  // And one whose bytes ARE moving, in a different class.
  expect(facts.attentionOf(ENC, working[0] as TerminalId)).toEqual({
    klass: "working",
    live: true,
  });
  expect(diagnostics()).toEqual([]);

  // ONE AGENT ANSWERS and another starts working, while the bytes move in one
  // more terminal. Both feeds land; the reading follows both.
  const nextAsking = asking.filter((id) => id !== ANSWERED);
  const nextWorking = [...working, STARTED];
  const nextLive = [...live, STARTED];
  mirror.pushUrgency(
    urgencyOf({
      asking: nextAsking,
      working: nextWorking,
      linger,
      finished: [...finished, ANSWERED],
    }),
  );
  mirror.pushActivity(nextLive);
  await settle();
  flush();

  expect(classed(facts, "asking")).toEqual(nextAsking);
  expect(classed(facts, "working")).toEqual(
    ids.filter((id) => nextWorking.includes(id)),
  );
  expect(classed(facts, "finished")).toEqual(
    ids.filter((id) => id === ANSWERED || finished.includes(id)),
  );
  expect(ids.filter((id) => facts.attentionOf(ENC, id).live)).toEqual(
    ids.filter((id) => nextLive.includes(id)),
  );
  expect(diagnostics()).toEqual([]);

  // AN UNSETTLED FRAME IS NO NEWS: padi saying it has not looked yet must not
  // blink the whole host to idle.
  mirror.pushUrgency(urgencyOf({ settled: false }));
  await settle();
  flush();

  expect(classed(facts, "asking")).toEqual(nextAsking);
  expect(diagnostics()).toEqual([]);
});
