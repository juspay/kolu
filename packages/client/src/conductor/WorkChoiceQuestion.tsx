import { Option } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import {
  type Chosen,
  harnessForModel,
  hostOf,
  type KoluChoice,
  type ModelChoices,
  modelNotOffered,
  type Recalled,
  roleOfKey,
  type SentAnswer,
  type SetupMemory,
  unofferedWhy,
  type Work,
} from "kolu-work";
import {
  type Component,
  createMemo,
  createResource,
  Match,
  Show,
  Switch,
} from "solid-js";
import { agentDistroListing } from "../agents/useAgentDistro";
import { runActionPromise } from "../runAction";
import { padiRpcOf } from "../wire";
import AskOptions, { type AskOption } from "./AskOptions";
import {
  pickOnly,
  type Seeding,
  seededChips,
  typedKey,
  typeOnly,
} from "./askForm";
import { askDraft } from "./drafts";

interface Choice extends AskOption {
  readonly chosen: Chosen;
}

const choiceOf = (value: string, chosen: Chosen): Choice => ({
  value,
  note: "",
  chosen,
});

type OfferedOf =
  | { readonly what: "harness"; readonly listing: "listing" | "unavailable" }
  | { readonly what: "model"; readonly harness: string };

interface ChoicesOffer {
  readonly kind: "choices";
  readonly of: OfferedOf;
  readonly options: ReadonlyArray<Choice>;
  readonly offered: ModelChoices;
  readonly empty: string;
}

type Offer =
  | { readonly kind: "waiting"; readonly words: string }
  | { readonly kind: "failed"; readonly words: string }
  | ChoicesOffer;

interface TypedModelOffer {
  readonly harness: string;
  readonly offered: ModelChoices;
}

interface AskedAt {
  readonly harness: string;
  readonly cwd: string;
}

const sameOption = Option.makeEquivalence<string>((a, b) => a === b);

const sameAsk = (a: AskedAt | undefined, b: AskedAt | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.harness === b.harness &&
    a.cwd === b.cwd);

const seedContext = (of: OfferedOf): string =>
  of.what === "model" ? of.harness : of.listing;

const takesTyped = (offered: ModelChoices): boolean =>
  offered.kind !== "listed";

const typedModelOffer = (now: ChoicesOffer): TypedModelOffer | null =>
  now.of.what === "model" && takesTyped(now.offered)
    ? { harness: now.of.harness, offered: now.offered }
    : null;

const BOX_CLASS =
  "mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent";

const LINE_CLASS = "mt-1.5 m-0 text-fg-3";

const WorkChoiceQuestion: Component<{
  work: Work;
  ask: string;
  decision: KoluChoice;
  memory: SetupMemory;
}> = (props) => {
  const what = (): "harness" | "model" => roleOfKey(props.decision.key).what;

  const drafted = (): ReadonlyMap<string, SentAnswer> => {
    const values = new Map<string, SentAnswer>();
    for (const one of props.work.decisions)
      if (one.ask === props.ask)
        values.set(one.id, askDraft(props.ask, one.id));
    return values;
  };

  const harness = createMemo(
    () =>
      what() === "model"
        ? harnessForModel(props.work, props.ask, props.decision.key, drafted())
        : Option.none<string>(),
    undefined,
    { equals: sameOption },
  );

  const repo = createMemo(() =>
    props.work.key.kind === "branch"
      ? Option.some(props.work.key.repo)
      : Option.none<string>(),
  );

  const where = createMemo(
    () =>
      Option.getOrUndefined(
        Option.flatMap(harness(), (one) =>
          Option.map(repo(), (cwd) => ({ harness: one, cwd })),
        ),
      ),
    undefined,
    { equals: sameAsk },
  );

  const [models] = createResource(where, (one: AskedAt) =>
    runActionPromise(
      padiRpcOf(decodeHostKey(hostOf(props.work))).agentDistro.models(one),
    ),
  );

  const harnessOffer = (): Offer => {
    const listing = agentDistroListing();
    if (listing === undefined)
      return { kind: "waiting", words: "Reading the harnesses kolu carries…" };
    if (listing.kind === "unavailable")
      return {
        kind: "choices",
        of: { what: "harness", listing: "unavailable" },
        options: [],
        offered: { kind: "listed", ids: [] },
        empty:
          "This kolu was built without agent-distro: it carries no agent to run.",
      };
    return {
      kind: "choices",
      of: { what: "harness", listing: "listing" },
      options: listing.harnesses.map((one) => ({
        value: one.name,
        note: one.title,
        chosen: "picked",
      })),
      offered: {
        kind: "listed",
        ids: listing.harnesses.map((one) => one.name),
      },
      empty: "",
    };
  };

  const usedBefore = (harness: string): ReadonlyArray<Choice> =>
    props.memory
      .modelsUsed(harness)
      .map((one) => choiceOf(one.value, one.chosen));

  const modelOffer = (): Offer => {
    const one = Option.getOrUndefined(harness());
    if (one === undefined)
      return {
        kind: "waiting",
        words: "Choose the harness first — a model is a model of one.",
      };
    if (Option.isNone(repo()))
      return {
        kind: "failed",
        words: `This work watches a terminal, so there is no checkout to ask ${one} what it offers in.`,
      };
    if (models.loading)
      return { kind: "waiting", words: `Asking what ${one} offers here…` };
    const unread = models.error as Error | undefined;
    if (unread !== undefined)
      return {
        kind: "choices",
        of: { what: "model", harness: one },
        options: usedBefore(one),
        offered: { kind: "unavailable", why: unread.message },
        empty: `No model was run with ${one} before — type the one to run.`,
      };
    const answer = models();
    if (answer === undefined)
      return { kind: "waiting", words: `Asking what ${one} offers here…` };
    if (answer.models.kind === "unlisted")
      return {
        kind: "choices",
        of: { what: "model", harness: one },
        options: usedBefore(one),
        offered: answer.models,
        empty: `${one} cannot list its models — type the one to run.`,
      };
    return {
      kind: "choices",
      of: { what: "model", harness: one },
      options: answer.models.ids.map((id) => choiceOf(id, "picked")),
      offered: answer.models,
      empty: `${one} lists no models on this host.`,
    };
  };

  const offer = createMemo(() =>
    what() === "harness" ? harnessOffer() : modelOffer(),
  );

  const waiting = () => {
    const now = offer();
    return now.kind === "waiting" ? now : null;
  };
  const failed = () => {
    const now = offer();
    return now.kind === "failed" ? now : null;
  };
  const choices = () => {
    const now = offer();
    return now.kind === "choices" ? now : null;
  };

  const standing = (): Option.Option<Recalled> => {
    const now = choices();
    if (now === null) return Option.none();
    return Option.filter(
      props.memory.last(props.decision.key, harness()),
      (want) =>
        (want.chosen === "picked" || takesTyped(now.offered)) &&
        Option.isNone(modelNotOffered(want.value, want.chosen, now.offered)),
    );
  };

  const typedWhy = (
    model: TypedModelOffer,
    typed: string,
  ): Option.Option<string> =>
    Option.map(
      modelNotOffered(typed, "typed", model.offered),
      (why) =>
        `${JSON.stringify(typed)} ${unofferedWhy(
          {
            key: props.decision.key,
            value: typed,
            why,
            harness: model.harness,
          },
          [],
          hostOf(props.work),
        )}.`,
    );

  const chips = seededChips(
    props.ask,
    props.decision.id,
    (): Seeding => {
      const now = choices();
      return now === null
        ? { kind: "unseeded", options: [] }
        : {
            kind: "seeded",
            context: seedContext(now.of),
            options: now.options,
          };
    },
    standing,
  );

  const chosenOf = (value: string): Chosen =>
    choices()?.options.find((one) => one.value === value)?.chosen ?? "picked";

  const press = (value: string): void => {
    if (chosenOf(value) === "typed")
      typeOnly(props.ask, props.decision.id, value);
    else pickOnly(props.ask, props.decision.id, value);
  };

  const isPressed = (value: string): boolean =>
    chosenOf(value) === "typed"
      ? (askDraft(props.ask, typedKey(props.decision.id))[0] ?? "") === value
      : askDraft(props.ask, props.decision.id).includes(value);

  const usedValues = (): ReadonlyArray<string> =>
    Option.match(harness(), {
      onSome: (one) => usedBefore(one).map((model) => model.value),
      onNone: () =>
        Option.match(props.memory.last(props.decision.key, Option.none()), {
          onSome: (last) => [last.value],
          onNone: () => [],
        }),
    });

  const StaysOpen: Component = () => (
    <p
      data-testid="conductor-ask-stays-open"
      data-field={props.decision.id}
      class={LINE_CLASS}
    >
      Nothing to pick yet — this one stays open when you answer the rest.
    </p>
  );

  const Failed: Component<{ readonly words: string }> = (said) => (
    <p
      data-testid="conductor-ask-failed"
      data-field={props.decision.id}
      class="mt-1.5 m-0 rounded-md border border-alert/55 bg-alert/[0.08] px-2 py-1 text-alert"
    >
      {said.words}
    </p>
  );

  return (
    <Switch>
      <Match when={waiting()}>
        {(now) => (
          <>
            <p
              data-testid="conductor-ask-waiting"
              data-field={props.decision.id}
              class={LINE_CLASS}
            >
              {now().words}
            </p>
            <StaysOpen />
          </>
        )}
      </Match>
      <Match when={failed()}>
        {(now) => (
          <>
            <Failed words={now().words} />
            <StaysOpen />
          </>
        )}
      </Match>
      <Match when={choices()}>
        {(now) => (
          <>
            <Show
              when={(() => {
                const offered = now().offered;
                return offered.kind === "unavailable" ? offered : null;
              })()}
            >
              {(unread) => <Failed words={unread().why} />}
            </Show>
            <Show when={now().options.length > 0}>
              <AskOptions
                field={props.decision.id}
                options={chips()}
                usedBefore={usedValues()}
                picked={isPressed}
                onPick={press}
                searchLabel={what() === "model" ? "models" : "harnesses"}
              />
            </Show>
            <Show when={now().options.length === 0 && now().empty !== ""}>
              <p
                data-testid="conductor-ask-none"
                data-field={props.decision.id}
                class={LINE_CLASS}
              >
                {now().empty}
              </p>
            </Show>
            <Show when={typedModelOffer(now())}>
              {(model) => {
                const typed = () =>
                  askDraft(props.ask, typedKey(props.decision.id))[0] ?? "";
                return (
                  <>
                    <input
                      type="text"
                      data-testid="conductor-ask-other"
                      data-field={props.decision.id}
                      placeholder="or name the model yourself"
                      value={typed()}
                      class={BOX_CLASS}
                      onInput={(event) =>
                        typeOnly(
                          props.ask,
                          props.decision.id,
                          event.currentTarget.value,
                        )
                      }
                    />
                    <Show
                      when={
                        typed() === ""
                          ? undefined
                          : Option.getOrUndefined(typedWhy(model(), typed()))
                      }
                    >
                      {(why) => (
                        <p
                          data-testid="conductor-ask-invalid"
                          data-field={props.decision.id}
                          class="mt-1.5 m-0 text-alert"
                        >
                          {why()}
                        </p>
                      )}
                    </Show>
                  </>
                );
              }}
            </Show>
          </>
        )}
      </Match>
    </Switch>
  );
};

export default WorkChoiceQuestion;
export { WorkChoiceQuestion };
