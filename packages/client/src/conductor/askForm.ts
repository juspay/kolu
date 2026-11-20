import { Option } from "effect";
import type { Recalled } from "kolu-work";
import { type Accessor, batch, createEffect, createMemo } from "solid-js";
import { type AskOption, defaultFirst } from "./AskOptions";
import { askDraft, dropAskFields, setAskDraft } from "./drafts";

export const typedKey = (decision: string): string => `${decision}~typed`;

const seededKey = (decision: string): string => `${decision}~seeded`;

export function pickOnly(ask: string, field: string, value: string): void {
  batch(() => {
    setAskDraft(ask, field, [value]);
    setAskDraft(ask, typedKey(field), []);
  });
}

export function typeOnly(ask: string, field: string, text: string): void {
  batch(() => {
    setAskDraft(ask, typedKey(field), text === "" ? [] : [text]);
    if (text !== "") setAskDraft(ask, field, []);
  });
}

function seedAskDefault(
  ask: string,
  field: string,
  context: string,
  value: Option.Option<Recalled>,
): void {
  if (askDraft(ask, seededKey(field))[0] === context) return;
  const as = (chosen: Recalled["chosen"]) =>
    Option.toArray(
      Option.map(
        Option.filter(value, (one) => one.chosen === chosen),
        (one) => one.value,
      ),
    );
  batch(() => {
    setAskDraft(ask, seededKey(field), [context]);
    setAskDraft(ask, field, as("picked"));
    setAskDraft(ask, typedKey(field), as("typed"));
  });
}

export type Seeding =
  | { readonly kind: "unseeded"; readonly options: ReadonlyArray<AskOption> }
  | {
      readonly kind: "seeded";
      readonly context: string;
      readonly options: ReadonlyArray<AskOption>;
    };

export function seededChips(
  ask: string,
  field: string,
  seeding: () => Seeding,
  standing: () => Option.Option<Recalled>,
): Accessor<ReadonlyArray<AskOption>> {
  createEffect(() => {
    const now = seeding();
    if (now.kind === "seeded")
      seedAskDefault(ask, field, now.context, standing());
  });
  return createMemo(() =>
    defaultFirst(
      seeding().options,
      Option.map(standing(), (one) => one.value),
    ),
  );
}

export function forgetAskFields(
  ask: string,
  fields: ReadonlyArray<string>,
): void {
  dropAskFields(
    ask,
    fields.flatMap((field) => [field, typedKey(field), seededKey(field)]),
  );
}
