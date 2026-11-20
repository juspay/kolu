import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  type AskOption,
  askOption,
  defaultFirst,
  OPTION_SEARCH_FROM,
  optionsShown,
} from "./AskOptions";

const MODELS: ReadonlyArray<AskOption> = Array.from({ length: 90 }, (_, n) =>
  askOption(`provider/model-${String(n).padStart(2, "0")}`),
);
const LAST = "provider/model-42";
const BEFORE = "provider/model-07";

const values = (list: ReadonlyArray<AskOption>) => list.map((one) => one.value);

const chips = defaultFirst(MODELS, Option.some(LAST));

const atRest = (picked: ReadonlyArray<string>, usedBefore = [LAST, BEFORE]) =>
  optionsShown({
    options: chips,
    usedBefore,
    picked: (value) => picked.includes(value),
    search: "",
    unfolded: false,
  });

describe("what a long option list draws", () => {
  it("rests on what was used before, the last one chosen first", () => {
    const view = atRest([LAST]);
    expect(values(view.shown)).toEqual([LAST, BEFORE]);
    expect(view.hidden).toBe(88);
  });

  it("searches the WHOLE list, not the few at rest", () => {
    const view = optionsShown({
      options: chips,
      usedBefore: [LAST],
      picked: () => false,
      search: "MODEL-6",
      unfolded: false,
    });
    expect(values(view.shown)).toEqual(
      Array.from({ length: 10 }, (_, n) => `provider/model-6${n}`),
    );
  });

  it("draws nothing at rest when nothing was used before", () => {
    const view = atRest([], []);
    expect(view.shown).toEqual([]);
    expect(view.hidden).toBe(90);
  });

  it("keeps a model picked from a search drawn once the box is cleared", () => {
    const view = atRest(["provider/model-63"]);
    expect(values(view.shown)).toEqual([LAST, BEFORE, "provider/model-63"]);
  });

  it("unfolds to the whole list", () => {
    const view = optionsShown({
      options: chips,
      usedBefore: [],
      picked: () => false,
      search: "",
      unfolded: true,
    });
    expect(view.shown).toBe(chips);
    expect(view.hidden).toBe(0);
  });

  it("draws a short list whole, used before or not", () => {
    const short = MODELS.slice(0, OPTION_SEARCH_FROM);
    const view = optionsShown({
      options: short,
      usedBefore: [],
      picked: () => false,
      search: "",
      unfolded: false,
    });
    expect(view.shown).toBe(short);
    expect(view.hidden).toBe(0);
  });
});
