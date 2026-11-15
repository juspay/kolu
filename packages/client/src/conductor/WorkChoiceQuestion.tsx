/** THE TWO SETUP QUESTIONS KOLU DRAWS THE OPTIONS FOR — which harness a role
 *  runs, and which model that harness runs — as the form draws them.
 *
 *  The asker cannot offer these ({@link KOLU_CHOICE_KEYS}: their decisions
 *  have nowhere to put options), and for one reason: the answers are facts
 *  about THIS kolu and THIS work's host, not about the conversation that
 *  opened the work. So:
 *
 *   - A HARNESS is one of the harnesses this kolu's build carries — the
 *     agent-distro listing, named with the title people know it by. A kolu
 *     built without agent-distro carries none, and says so rather than
 *     offering a box to type into: there is nothing it could start.
 *
 *   - A MODEL is a model OF a harness, so the question waits for one, and
 *     then ASKS THE HOST, live, through its own padi
 *     (`agentDistro.models`) — never a list kolu stored, which would be a
 *     list that goes stale the day that machine's agents update. The answer
 *     is one of three, and all three are kept apart on screen: the ids the
 *     harness listed, `unlisted` (a harness with no way to list them — the
 *     model is whatever the person names, and what they have named before is
 *     offered), or a failure, which is shown IN THE HOST'S OWN WORDS. A
 *     failure is never an empty menu: "this harness offers nothing" and "we
 *     could not ask" are different things to a person deciding what to run.
 *
 *  The read is owned by this component, so a question that goes off screen
 *  takes its in-flight call with it, and a harness changed in the same form
 *  re-asks for that harness's models ({@link harnessForModel} is what reads
 *  the pair out of the draft).
 */

import { Option } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import {
  harnessForModel,
  hostOf,
  type KoluChoice,
  type ModelChoices,
  modelNotOffered,
  roleOfKey,
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
import AskOptions, { type AskOption, askOption } from "./AskOptions";
import { pickOnly, seededChips, typedKey, typeOnly } from "./askForm";
import { askDraft } from "./drafts";

/** WHAT THERE IS TO PICK, as this question stands. One sum, because the three
 *  states a person must tell apart — we are still finding out, we could not
 *  find out, here is the list — are three different things to be told, and a
 *  nullable list would say the first two the same way (nothing). */
type Offer =
  | { readonly kind: "waiting"; readonly words: string }
  | { readonly kind: "failed"; readonly words: string }
  | {
      readonly kind: "choices";
      /** What this list is OF — the harness, for a model. The draft's default
       *  is seeded once per context ({@link seededChips}). */
      readonly context: string;
      readonly options: ReadonlyArray<AskOption>;
      /** What the list is the offer OF, as the rule that judges an answer
       *  reads it ({@link modelNotOffered}): a harness question offers the
       *  harnesses by name, and `unlisted` is the harness that cannot list
       *  its models — so any model id may be typed instead. */
      readonly offered: ModelChoices;
      /** What to say when the list is empty — the host answered, and the
       *  answer was nothing. */
      readonly empty: string;
    };

const BOX_CLASS =
  "mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent";

const LINE_CLASS = "mt-1.5 m-0 text-fg-3";

const WorkChoiceQuestion: Component<{
  work: Work;
  /** The ask this question is part of — the form the harness beside it is
   *  being answered in. */
  ask: string;
  decision: KoluChoice;
  /** What this person chose before, read off the saved works by whoever drew
   *  the form — one reading for every question in it. */
  memory: SetupMemory;
}> = (props) => {
  /** Which half of a role's setup this is — every kolu-choice key names a
   *  role and one of its two. */
  const what = (): "harness" | "model" => roleOfKey(props.decision.key).what;

  /** This form's picks so far, as {@link harnessForModel} reads them: the
   *  harness answered beside this question counts before it is sent. */
  const drafted = (): ReadonlyMap<string, ReadonlyArray<string>> => {
    const values = new Map<string, ReadonlyArray<string>>();
    for (const one of props.work.decisions)
      if (one.ask === props.ask)
        values.set(one.id, askDraft(props.ask, one.id));
    return values;
  };

  /** The harness this model is for — read by the host call, by the memory
   *  lookup and by the words on screen. None for a harness question, which
   *  is not of anything, and for a model nobody has named a harness for. */
  const harness = createMemo(
    () =>
      what() === "model"
        ? harnessForModel(props.work, props.ask, props.decision.key, drafted())
        : Option.none<string>(),
    undefined,
    // BY VALUE: every keystroke in the form re-reads the draft, and a fresh
    // `Option` of the same harness is not news — re-asking the host for it
    // would drop the list back to loading under the person typing.
    { equals: Option.makeEquivalence((a: string, b: string) => a === b) },
  );

  /** WHERE KOLU ASKS FROM — the work's own repository. A watch has none: it
   *  is a terminal somebody pointed kolu at rather than a branch, so there is
   *  no checkout to ask a harness what it offers in. */
  const repo = createMemo(() =>
    props.work.key.kind === "branch"
      ? Option.some(props.work.key.repo)
      : Option.none<string>(),
  );

  /** WHERE AND WHAT TO ASK — the harness and the checkout — compared by value
   *  for the same reason as {@link harness}. */
  const where = createMemo(
    () =>
      Option.getOrUndefined(
        Option.flatMap(harness(), (one) =>
          Option.map(repo(), (cwd) => ({ harness: one, cwd })),
        ),
      ),
    undefined,
    {
      equals: (a, b) =>
        a === b ||
        (a !== undefined &&
          b !== undefined &&
          a.harness === b.harness &&
          a.cwd === b.cwd),
    },
  );

  /** What the host says that harness offers. The source is the harness and
   *  the place to ask from, so a change in the same form re-asks and a
   *  question with no harness yet asks nothing at all. */
  const [models] = createResource(
    where,
    (one: { harness: string; cwd: string }) =>
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
        context: "unavailable",
        options: [],
        offered: { kind: "listed", ids: [] },
        empty:
          "This kolu was built without agent-distro: it carries no agent to run.",
      };
    const names = listing.harnesses.map((one) => one.name);
    return {
      kind: "choices",
      context: "listing",
      options: listing.harnesses.map((one) => ({
        value: one.name,
        note: one.title,
      })),
      offered: { kind: "listed", ids: names },
      empty: "",
    };
  };

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
    const failed = models.error as Error | undefined;
    if (failed !== undefined) return { kind: "failed", words: failed.message };
    const answer = models();
    if (answer === undefined)
      return { kind: "waiting", words: `Asking what ${one} offers here…` };
    if (answer.models.kind === "unlisted")
      return {
        kind: "choices",
        context: one,
        options: props.memory.modelsUsed(one).map(askOption),
        offered: answer.models,
        empty: `${one} cannot list its models — type the one to run.`,
      };
    return {
      kind: "choices",
      context: one,
      options: answer.models.ids.map(askOption),
      offered: answer.models,
      empty: `${one} lists no models on this host.`,
    };
  };

  /** Read by the three branches below and by the seeding, so it is a memo. */
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

  /** What this person answered last, if it is still something they can answer
   *  here: an option that is drawn, or — for a harness that takes a typed
   *  model — a model id kolu would record (words saved as a model before kolu
   *  drew these options are not put back under their hands). */
  const standing = (): Option.Option<string> => {
    const now = choices();
    if (now === null) return Option.none();
    return Option.filter(
      props.memory.last(props.decision.key, harness()),
      (want) =>
        now.options.some((one) => one.value === want) ||
        Option.isNone(modelNotOffered(want, now.offered)),
    );
  };

  /** WHY THE MODEL TYPED IN THE BOX IS NOT ONE KOLU WOULD RECORD — the rule
   *  the answer is checked by where it is recorded, said as it is typed, so a
   *  refusal is never the first a person hears of it. None while the box is
   *  empty or holds a model id — and for a question with no list yet, which
   *  draws no box at all. */
  const typedWhy = (): Option.Option<string> => {
    const now = choices();
    const typed = askDraft(props.ask, typedKey(props.decision.id))[0] ?? "";
    if (now === null || typed === "") return Option.none();
    return Option.map(
      modelNotOffered(typed, now.offered),
      (why) =>
        // The box is only ever drawn for a harness that cannot list its
        // models, so the list's own context IS that harness.
        `${JSON.stringify(typed)} ${unofferedWhy(
          { key: props.decision.key, value: typed, why, harness: now.context },
          [],
          hostOf(props.work),
        )}.`,
    );
  };

  /** The options as they are drawn — the default first, and that default in
   *  the draft once the list it belongs to is known. */
  const chips = seededChips(
    props.ask,
    props.decision.id,
    () => Option.fromNullishOr(choices()?.context),
    () => choices()?.options ?? [],
    standing,
  );

  /** THE ONE THING A PERSON MUST BE TOLD about a question they cannot answer
   *  yet: pressing Answer does not answer it, and it will still be there
   *  afterwards. Said ON the question — the form does not invite a blank it
   *  then reads back as an answer. */
  const StaysOpen: Component = () => (
    <p
      data-testid="conductor-ask-stays-open"
      data-field={props.decision.id}
      class={LINE_CLASS}
    >
      Nothing to pick yet — this one stays open when you answer the rest.
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
          // THE HOST'S OWN WORDS. Not "no models": a question that could not
          // be asked is answered by saying so.
          <>
            <p
              data-testid="conductor-ask-failed"
              data-field={props.decision.id}
              class="mt-1.5 m-0 rounded-md border border-alert/55 bg-alert/[0.08] px-2 py-1 text-alert"
            >
              {now().words}
            </p>
            <StaysOpen />
          </>
        )}
      </Match>
      <Match when={choices()}>
        {(now) => (
          <>
            <Show when={now().options.length > 0}>
              <AskOptions
                field={props.decision.id}
                options={chips()}
                picked={(value) =>
                  askDraft(props.ask, props.decision.id).includes(value)
                }
                onPick={(value) =>
                  pickOnly(props.ask, props.decision.id, value)
                }
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
            <Show when={now().offered.kind === "unlisted"}>
              <input
                type="text"
                data-testid="conductor-ask-other"
                data-field={props.decision.id}
                placeholder="or name the model yourself"
                value={
                  askDraft(props.ask, typedKey(props.decision.id))[0] ?? ""
                }
                class={BOX_CLASS}
                onInput={(event) =>
                  typeOnly(
                    props.ask,
                    props.decision.id,
                    event.currentTarget.value,
                  )
                }
              />
              <Show when={Option.getOrUndefined(typedWhy())}>
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
            </Show>
          </>
        )}
      </Match>
    </Switch>
  );
};

export default WorkChoiceQuestion;
export { WorkChoiceQuestion };
