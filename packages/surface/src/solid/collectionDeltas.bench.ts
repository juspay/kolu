/**
 * What a `deltas` frame COSTS the client — before and after the store rewrite.
 *
 * BEFORE, `useCollectionDeltas` routed every frame through `createSubscription`'s
 * generic reduce: `foldCollectionDeltas` copied the whole `byKey` dictionary and
 * returned a fresh accumulator, which `writeWrappedValue`'s `reconcile` then walked
 * in full to rediscover the keys the frame had already named. AFTER, the hook owns
 * its store and writes exactly the keys the frame names.
 *
 * Both arms are driven END TO END through the same controllable stream, so the
 * per-frame fiber and scheduling overhead is charged to both and cancels out. The
 * "before" arm IS the old hook — the real `createSubscription` (whose own store write
 * is the `writeWrappedValue` reconcile) with the deleted fold as its reducer, read
 * through the old `byKey`'s exact shape. Only `foldCollectionDeltas` is re-inlined
 * below, because it was deleted with the path it served: it lives on here as the
 * thing being measured against, and nowhere else.
 *
 * READ THE RATIO, NOT THE NUMBER. The absolute figures say more about the machine
 * than about the change, and the win is not asymptotic in every shape: it scales
 * with N/|frame|, so a collection that republishes every key every tick (drishti's
 * cpu cores) pays |frame| ≈ N and gains the second O(N) pass plus the per-frame
 * allocation churn, while one that ticks a handful of keys out of hundreds (a
 * process table, a document set) gains the whole gap. Each block below is one such
 * shape, and vitest prints the two arms' relative speed within it.
 *
 * Run: `just bench-collection-deltas`.
 */

import { Schema } from "effect";
import { createEffect, createRoot } from "solid-js";
import { bench, describe } from "vitest";
import type { CollectionDeltasMsg } from "../define";
import { collection } from "../index";
import { controllableStream } from "./controllableStream.testlib";
import { createSubscription } from "./createSubscription";
import { useCollectionDeltas } from "./useCollection";

interface Row {
  readonly cpu: number;
  readonly mem: number;
  readonly name: string;
}
type Frame = CollectionDeltasMsg<string, Row>;

const rows = collection({
  name: "rows",
  keySchema: Schema.String,
  schema: Schema.Struct({
    cpu: Schema.Number,
    mem: Schema.Number,
    name: Schema.String,
  }),
});

/** How many keys the collection holds, how many a frame names, how many rows are
 *  being read on screen, and how many frames one measured iteration pushes (so the
 *  fixed per-iteration drain cost is amortised rather than measured). */
const KEYS = 2000;
const READERS = 200;
const FRAMES_PER_ITERATION = 50;

const key = (i: number): string => `k${i}`;
const row = (i: number, tick: number): Row => ({
  cpu: (i + tick) % 100,
  mem: (i * 7 + tick) % 4096,
  name: `proc-${i}`,
});

// ── The BEFORE arm's fold, verbatim from the deleted implementation ──────────

interface DeltasFold {
  byKey: Record<string, Row>;
  order: string[];
}
const emptyDict = (): Record<string, Row> =>
  Object.create(null) as Record<string, Row>;

function foldCollectionDeltas(acc: DeltasFold, msg: Frame): DeltasFold {
  if (msg.kind === "snapshot") {
    const byKey = emptyDict();
    const order: string[] = [];
    for (const [k, v] of msg.entries) {
      byKey[String(k)] = v;
      order.push(k);
    }
    return { byKey, order };
  }
  const byKey = Object.assign(emptyDict(), acc.byKey);
  const added: string[] = [];
  for (const [k, v] of msg.upserts) {
    if (!(String(k) in acc.byKey)) added.push(k);
    byKey[String(k)] = v;
  }
  for (const k of msg.removes) delete byKey[String(k)];
  if (added.length === 0 && msg.removes.length === 0) {
    return { byKey, order: acc.order };
  }
  let order: string[];
  if (msg.removes.length > 0) {
    const removed = new Set(msg.removes);
    order = acc.order.filter((k) => !removed.has(k));
  } else {
    order = acc.order.slice();
  }
  for (const k of added) order.push(k);
  return { byKey, order };
}

// ── The two arms, each behind one `push(frame)` ─────────────────────────────

interface Arm {
  push: (frame: Frame) => void;
}

/** Let every queued frame drain. `setImmediate` runs after the microtask queue, so
 *  ONE await covers a whole iteration's worth of pushes — which is why an iteration
 *  pushes many frames: the fixed cost is amortised rather than measured. */
const drainOnce = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/** BEFORE: the generic reduce path — copy the dictionary, reconcile the copy. This
 *  IS the old hook: the real `createSubscription` (whose own store write is the
 *  `writeWrappedValue` reconcile), the deleted fold as its reducer, and the old
 *  `byKey`'s exact read shape. */
function beforeArm(): Arm {
  const { source, push } = controllableStream<Frame>();
  createRoot(() => {
    const sub = createSubscription<Frame, DeltasFold>(source, {
      initial: { byKey: emptyDict(), order: [] },
      reduce: foldCollectionDeltas,
    });
    for (let i = 0; i < READERS; i++) {
      const k = key(i);
      createEffect(() => {
        const fold = sub();
        return fold !== undefined && k in fold.byKey
          ? fold.byKey[k]
          : undefined;
      });
    }
  });
  return { push };
}

/** AFTER: the hook's own store — one named-key write per upsert. */
function afterArm(): Arm {
  const { source, push } = controllableStream<Frame>();
  createRoot(() => {
    const view = useCollectionDeltas(rows, { source });
    for (let i = 0; i < READERS; i++) {
      const k = key(i);
      createEffect(() => view.byKey(k)?.());
    }
  });
  return { push };
}

const snapshot = (): Frame => ({
  kind: "snapshot",
  entries: Array.from({ length: KEYS }, (_, i) => [key(i), row(i, 0)]),
});

/** Build both arms, seed each with the same snapshot, and hand back a runner that
 *  pushes `FRAMES_PER_ITERATION` frames of the given shape and waits for the drain. */
async function shape(
  frameAt: (tick: number) => Frame,
): Promise<{ before: () => Promise<void>; after: () => Promise<void> }> {
  const arms = { before: beforeArm(), after: afterArm() };
  for (const arm of Object.values(arms)) arm.push(snapshot());
  await drainOnce();
  let tick = 0;
  const run = (arm: Arm) => async (): Promise<void> => {
    for (let i = 0; i < FRAMES_PER_ITERATION; i++) arm.push(frameAt(++tick));
    await drainOnce();
  };
  return { before: run(arms.before), after: run(arms.after) };
}

const upserts = (count: number, tick: number): Frame => ({
  kind: "delta",
  upserts: Array.from({ length: count }, (_, i) => {
    const idx = (tick * count + i) % KEYS;
    return [key(idx), row(idx, tick)] as [string, Row];
  }),
  removes: [],
});

const ONE = await shape((tick) => upserts(1, tick));
describe(`delta naming 1 key of ${KEYS}`, () => {
  bench("before — copy the dictionary, reconcile the copy", () => ONE.before());
  bench("after — one named-key write", () => ONE.after());
});

const SOME = await shape((tick) => upserts(KEYS / 20, tick));
describe(`delta naming ${KEYS / 20} keys of ${KEYS}`, () => {
  bench("before — copy the dictionary, reconcile the copy", () =>
    SOME.before(),
  );
  bench("after — named-key writes", () => SOME.after());
});

const ALL = await shape((tick) => upserts(KEYS, tick));
describe(`delta naming every one of ${KEYS} keys`, () => {
  bench("before — copy the dictionary, reconcile the copy", () => ALL.before());
  bench("after — named-key writes", () => ALL.after());
});

// The CHURN shape: keys leaving and arriving, which is the one delta arm that does
// more than write leaves — it rebuilds the arrival-order key list, fires the store's
// key-presence notification, and pays the injectivity check. Every shape above is a
// pure value update (the early exit keeps `order` untouched), so without this one the
// ratios would be the best case only. A process table or a terminal set lives here.
const CHURN = await shape((tick) => {
  const born = 5;
  const base = KEYS + tick * born;
  return {
    kind: "delta",
    upserts: Array.from(
      { length: born },
      (_, i) => [key(base + i), row(base + i, tick)] as [string, Row],
    ),
    // Remove the keys the PREVIOUS frame added, so the collection stays at N and the
    // measurement does not drift into a different size as iterations pile up.
    removes:
      tick === 1
        ? []
        : Array.from({ length: born }, (_, i) => key(base - born + i)),
  };
});
describe(`delta with ${5} keys born and ${5} dying, of ${KEYS}`, () => {
  bench("before — copy the dictionary, reconcile the copy", () =>
    CHURN.before(),
  );
  bench("after — named-key writes, then one order rebuild", () =>
    CHURN.after(),
  );
});

// The reconnect shape: the retry fence turns a transport drop into a fresh snapshot
// carrying the same content. Both arms pay O(N) here — the frame does carry N
// entries — and what is being checked is that the after arm's value-diff has not
// turned a visual no-op into a repaint.
const RECONNECT = await shape(() => snapshot());
describe(`reconnect snapshot, ${KEYS} unchanged entries`, () => {
  bench("before — reconcile the whole dictionary", () => RECONNECT.before());
  bench("after — value-diff, no writes", () => RECONNECT.after());
});
