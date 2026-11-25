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
 *     offered), or `unavailable`: the host could not list them just now, and
 *     says so IN ITS OWN WORDS — and beside those words the person gets what
 *     an unlisted harness gets, the models used before and a box to type
 *     one, so they can still choose, knowing the list was not read. A
 *     failure is never an empty menu: "this harness offers nothing" and "we
 *     could not ask" are different things to a person deciding what to run.
 *
 *  EACH ANSWER SAYS HOW IT WAS CHOSEN. A chip from the host's list is a
 *  pick; a model in the box is typed, and is sent as typed; a model used
 *  before comes back as it was chosen then — a typed one into the box.
 *
 *  The read is owned by this component, so a question that goes off screen
 *  takes its in-flight call with it, and a harness changed in the same form
 *  re-asks for that harness's models ({@link harnessForModel} is what reads
 *  the pair out of the draft).
 */

import { toError } from "@kolu/surface/run-stream";
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
  Errored,
  Loading,
  Match,
  Show,
  Switch,
} from "solid-js";
import { agentDistroListing } from "../agents/useAgentDistro";
import { runActionPromise } from "../runAction";
import { padiRpcOf } from "../wire";
import AskOptions, { type AskOption } from "./AskOptions";
import { pickOnly, seededChips, typedKey, typeOnly } from "./askForm";
import { askDraft } from "./drafts";

/** One option as this question draws it — and how answering with it is
 *  chosen: a pick, or a model typed before, which goes back in the box. */
interface Choice extends AskOption {
  readonly chosen: Chosen;
}

/** A choice that is its own name. */
const choiceOf = (value: string, chosen: Chosen): Choice => ({
  value,
  note: "",
  chosen,
});

/** WHAT THERE IS TO PICK, as this question stands. One sum, because the three
 *  states a person must tell apart — we are still finding out, there is
 *  nothing to ask, here is what you can answer with — are three different
 *  things to be told, and a nullable list would say the first two the same
 *  way (nothing). */
type Offer =
  | { readonly kind: "waiting"; readonly words: string }
  | { readonly kind: "failed"; readonly words: string }
  | {
      readonly kind: "choices";
      /** What this list is OF — the harness, for a model. The draft's default
       *  is seeded once per context ({@link seededChips}). */
      readonly context: string;
      readonly options: ReadonlyArray<Choice>;
      /** What the list is the offer OF, as the rule that judges an answer
       *  reads it ({@link modelNotOffered}): a harness question offers the
       *  harnesses by name; `unlisted` is the harness that cannot list its
       *  models and `unavailable` the host that could not list them just
       *  now — for both, any model id may be typed instead. */
      readonly offered: ModelChoices;
      /** What to say when the list is empty — the host answered, and the
       *  answer was nothing. */
      readonly empty: string;
    };

/** WHERE AND WHAT A MODEL QUESTION IS ASKED OF — the harness it is a model
 *  of, and the checkout to ask it in. */
interface Where {
  readonly harness: string;
  readonly cwd: string;
}

/** ... and that, or nothing to ask of: a harness question, which is not a
 *  question OF anything, and a model question nobody has named a harness
 *  for. */
type Subject =
  | { readonly kind: "unasked" }
  | { readonly kind: "asked"; readonly where: Where };

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
  const drafted = (): ReadonlyMap<string, SentAnswer> => {
    const values = new Map<string, SentAnswer>();
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

  /** WHAT THIS QUESTION IS BEING ASKED OF — the harness and the checkout, or
   *  nothing to ask of (a harness question, which is not of anything, and a
   *  model question nobody has named a harness for). Compared by value for
   *  the same reason as {@link harness}, and ONE value rather than a
   *  nullable because the boundary below is keyed by it. */
  const subject = createMemo<Subject>(
    () =>
      Option.match(
        Option.flatMap(harness(), (one) =>
          Option.map(repo(), (cwd): Where => ({ harness: one, cwd })),
        ),
        {
          onNone: (): Subject => ({ kind: "unasked" }),
          onSome: (where): Subject => ({ kind: "asked", where }),
        },
      ),
    {
      equals: (a, b) =>
        a.kind === b.kind &&
        (a.kind === "unasked" ||
          (b.kind === "asked" &&
            a.where.harness === b.where.harness &&
            a.where.cwd === b.where.cwd)),
    },
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
    return {
      kind: "choices",
      context: "listing",
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

  /** The models this person ran `harness` on before, each as it was chosen
   *  then — what a question with no list to pick from offers. */
  const usedBefore = (harness: string): ReadonlyArray<Choice> =>
    props.memory
      .modelsUsed(harness)
      .map((one) => choiceOf(one.value, one.chosen));

  /** WHAT A QUESTION STILL BEING ASKED SAYS — the `Loading` fallback's offer.
   *  A harness question never asks a host, so the only read that can be in
   *  flight under that boundary is the model list. */
  const asking = (): Offer => ({
    kind: "waiting",
    words: `Asking what ${Option.getOrUndefined(harness()) ?? "this harness"} offers here…`,
  });

  /** THE HOST COULD NOT LIST — said in its own words, beside what a harness
   *  with no list gets: the models used before and a box to type one. This is
   *  the `Errored` fallback's offer: the read throws the host's own failure,
   *  and a question that could not be asked is still answerable. */
  const unread = (why: string): Offer => {
    const one = Option.getOrUndefined(harness());
    if (one === undefined) return { kind: "failed", words: why };
    return {
      kind: "choices",
      context: one,
      options: usedBefore(one),
      offered: { kind: "unavailable", why },
      empty: `No model was run with ${one} before — type the one to run.`,
    };
  };

  /** Whether this question takes a model typed into a box: a harness that
   *  cannot list, or a host that could not list just now. */
  const takesTyped = (offered: ModelChoices): boolean =>
    offered.kind !== "listed";

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

  /** THE HOST'S OWN WORDS when a list could not be read — drawn alone when
   *  there is nothing to pick, and above the chips when something can still
   *  be chosen. One paragraph either way. */
  const Failed: Component<{ readonly words: string }> = (said) => (
    <p
      data-testid="conductor-ask-failed"
      data-field={props.decision.id}
      class="mt-1.5 m-0 rounded-md border border-alert/55 bg-alert/[0.08] px-2 py-1 text-alert"
    >
      {said.words}
    </p>
  );

  /** THE QUESTION AS IT IS DRAWN, for ONE offer — the three states a person
   *  must tell apart, each with its own face. The offer is a prop because the
   *  boundaries' own offers are drawn by the same face: what is still being
   *  asked (the `Loading` fallback) and what could not be asked (the
   *  `Errored` one) are offers like any other, and the chips, the box and the
   *  seeding behave the same under each. */
  const Offered: Component<{ readonly offer: Offer }> = (shown) => {
    const waiting = () => (shown.offer.kind === "waiting" ? shown.offer : null);
    const failed = () => (shown.offer.kind === "failed" ? shown.offer : null);
    const choices = () => (shown.offer.kind === "choices" ? shown.offer : null);

    /** What this person answered last, if it is still something they can
     *  answer here, as it was chosen: a pick that is still drawn (or, with no
     *  list to hold it to, still a model id), or a typed model where there is
     *  a box to put it back in (words saved as a model before kolu drew these
     *  options are not put back under their hands). */
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

    /** WHY THE MODEL TYPED IN THE BOX IS NOT ONE KOLU WOULD RECORD — the rule
     *  the answer is checked by where it is recorded, said as it is typed, so
     *  a refusal is never the first a person hears of it. None while the box
     *  is empty or holds a model id — and for a question with no box. */
    const typedWhy = (): Option.Option<string> => {
      const now = choices();
      const typed = askDraft(props.ask, typedKey(props.decision.id))[0] ?? "";
      if (now === null || typed === "") return Option.none();
      return Option.map(
        modelNotOffered(typed, "typed", now.offered),
        (why) =>
          // The box is only ever drawn for a model question, so the list's own
          // context IS its harness.
          `${JSON.stringify(typed)} ${unofferedWhy(
            {
              key: props.decision.key,
              value: typed,
              why,
              harness: now.context,
            },
            [],
            hostOf(props.work),
          )}.`,
      );
    };

    /** The options as they are drawn — the default first, and that default in
     *  the draft once the list it belongs to is known. */
    const chips = seededChips(
      () => props.ask,
      () => props.decision.id,
      () => Option.fromNullishOr(choices()?.context),
      () => choices()?.options ?? [],
      standing,
    );

    /** How answering with `value` is chosen — a pick, unless it is a model
     *  this person typed before, which goes back in the box as typed. */
    const chosenOf = (value: string): Chosen =>
      choices()?.options.find((one) => one.value === value)?.chosen ?? "picked";

    /** A chip pressed: a pick goes in as the pick; a model typed before goes
     *  back in the box, so it is sent as typed again. */
    const press = (value: string): void => {
      if (chosenOf(value) === "typed")
        typeOnly(props.ask, props.decision.id, value);
      else pickOnly(props.ask, props.decision.id, value);
    };

    /** Whether a chip reads as the answer: the pick, or the words in the
     *  box. */
    const isPressed = (value: string): boolean =>
      chosenOf(value) === "typed"
        ? (askDraft(props.ask, typedKey(props.decision.id))[0] ?? "") === value
        : askDraft(props.ask, props.decision.id).includes(value);

    /** WHAT THIS PERSON ANSWERED THIS BEFORE, most recent first — what a long
     *  list rests on: every model they ran this harness on, or the harness
     *  they last chose for this role. */
    const usedValues = (): ReadonlyArray<string> =>
      Option.match(harness(), {
        onSome: (one) => usedBefore(one).map((model) => model.value),
        onNone: () =>
          Option.match(props.memory.last(props.decision.key, Option.none()), {
            onSome: (last) => [last.value],
            onNone: () => [],
          }),
      });

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
              <Failed words={now().words} />
              <StaysOpen />
            </>
          )}
        </Match>
        <Match when={choices()}>
          {(now) => (
            <>
              {/* THE HOST COULD NOT LIST: its own words, ABOVE what can still
                  be chosen — a person answering this does so knowing the list
                  was not read. */}
              <Show
                when={(() => {
                  const offered = now().offered;
                  return offered.kind === "unavailable" ? offered : null;
                })()}
              >
                {(why) => <Failed words={why().why} />}
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
              <Show when={takesTyped(now().offered)}>
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

  /** THE QUESTION AS THE HOST ANSWERS IT — drawn under the boundary that
   *  holds the asking, and the reason this is a component rather than a memo
   *  in the body: the read is CREATED here, inside the `Loading`, so a read
   *  that goes pending after the question has already been drawn (the
   *  harness seeded a frame after the form opens) is the boundary's to hold.
   *  A read created outside it reaches the root first and the page waits on
   *  it instead, with nothing on the question to say so. */
  const Asked: Component<{ readonly subject: Subject }> = (shown) => {
    /** What the host says that harness offers. A question with no harness
     *  named yet asks nothing at all. The read is held by the `Loading`
     *  boundary over it and a failure thrown at the `Errored` one beside it
     *  — the two faces of "still asking" and "could not ask" are drawn
     *  there, each as its own offer. */
    const models = createMemo(() => {
      const one = shown.subject;
      return one.kind === "unasked"
        ? undefined
        : runActionPromise(
            padiRpcOf(decodeHostKey(hostOf(props.work))).agentDistro.models(
              one.where,
            ),
          );
    });

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
      const answer = models();
      if (answer === undefined) return asking();
      if (answer.models.kind === "unlisted")
        return {
          kind: "choices",
          context: one,
          options: usedBefore(one),
          offered: answer.models,
          empty: `${one} cannot list its models — type the one to run.`,
        };
      return {
        kind: "choices",
        context: one,
        options: answer.models.ids.map((id) => choiceOf(id, "picked")),
        offered: answer.models,
        empty: `${one} lists no models on this host.`,
      };
    };

    /** Read by the branches below and by the seeding, so it is a memo. */
    const offer = createMemo(() =>
      what() === "harness" ? harnessOffer() : modelOffer(),
    );

    return <Offered offer={offer()} />;
  };

  return (
    // THE HOST'S FAILURE IS AN OFFER, not a dead question: the model read
    // throws it here, and the question is drawn again around what can still
    // be chosen.
    <Errored
      fallback={(why) => <Offered offer={unread(toError(why()).message)} />}
    >
      {/* A NEW SUBJECT IS A NEW QUESTION: the harness picked in the same
          form changes what this question is OF, so the models of the harness
          they left must never sit under the new one's name. The host read
          lives in `Asked`, under this boundary: a read of the same data
          outside it would hold the whole frame, so the fallback could never
          show (Solid warns LOADING_ON_OUTSIDE_HOLD).

          KEYED on the subject rather than `<Loading on={subject()}>`, because
          of a Solid defect: solidjs/solid#5203. The seeding of what this
          person chose last time writes the subject from an effect in the
          mount's own flush, and the question's content reads the signals the
          subject is derived from, one hop closer to that write than `on`. Its
          read goes pending before `on` re-arms the boundary and is forwarded
          to the root (ASYNC_OUTSIDE_LOADING_BOUNDARY), so the whole page
          would wait on the host. `WorkQuestion.test.tsx` fails 2 of 13 with
          `on`. A boundary born with its subject has shown nothing, so it holds
          that read. Switch to `on` once a Solid release fixes #5203.

          The rest of the form stays unheld — the harness chip reads as
          pressed at once, rather than after a host answers. */}
      <Show when={subject()} keyed>
        {(one) => (
          <Loading fallback={<Offered offer={asking()} />}>
            <Asked subject={one} />
          </Loading>
        )}
      </Show>
    </Errored>
  );
};

export default WorkChoiceQuestion;
export { WorkChoiceQuestion };
