import { type ModelReading, namedExactly } from "@kolu/acp/engine";

const CONTEXT_HINT = /(?:\[(\d+m)\]|-(\d+m))$/i;

const withoutLane = (id: string): string =>
  id.trim().toLowerCase().replace(CONTEXT_HINT, "");

const laneOf = (id: string): string | null => {
  const found = CONTEXT_HINT.exec(id.trim().toLowerCase());
  return found?.[1] ?? found?.[2] ?? null;
};

const rowFor = (
  labels: ReadonlyMap<string, string>,
  id: string,
): string | null => {
  if (namedExactly(labels, id) !== null) return id;

  const wanted = withoutLane(id);
  if (wanted === "") return null;

  const only = (keep: (value: string) => boolean): string | null => {
    const hits = [...labels.keys()].filter(
      (value) => value !== "default" && keep(value),
    );
    return hits.length === 1 ? (hits[0] ?? null) : null;
  };

  const lane = only((value) => withoutLane(value) === wanted);
  if (lane !== null) return lane;

  const words = wanted.split("-");
  const [family, ...version] = words[0] === "claude" ? words.slice(1) : words;
  if (family === undefined || !version.every((part) => /^\d{1,2}$/.test(part)))
    return null;
  const lanes = laneOf(id);
  return only(
    (value) => withoutLane(value) === family && laneOf(value) === lanes,
  );
};

/** What the agent calls the model with this id: the label of the row above, or
 *  `null` for an id no row answers for. */
export const modelNameIn = (
  labels: ReadonlyMap<string, string>,
  id: string,
): string | null => {
  const row = rowFor(labels, id);
  return row === null ? null : (labels.get(row) ?? null);
};

/** ... and how big that model's context is, in tokens, off the SAME row: the
 *  lane the row opted into, {@link STANDARD} for a row that opted into none,
 *  and `null` both for an id the picker does not name and for a row pinned to
 *  a lane this file has never heard of — the number here is read to decide
 *  whether to compact, and a wrong one is worse than none. */
export const modelWindowIn = (
  labels: ReadonlyMap<string, string>,
  id: string,
): number | null => {
  const row = rowFor(labels, id);
  if (row === null) return null;
  const lane = laneOf(row);
  return lane === null ? STANDARD : (LANES[lane] ?? null);
};

const STANDARD = 200_000;

const LANES: Readonly<Record<string, number>> = { "1m": 1_000_000 };

export const MODELS: ModelReading = {
  config: "model",
  nameIn: modelNameIn,
  windowIn: modelWindowIn,
};
