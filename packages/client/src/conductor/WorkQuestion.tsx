import { Option } from "effect";
import {
  type AnsweredFromFace,
  type Asked,
  hostOf,
  isAsked,
  isKoluChoice,
  isSettled,
  type Offered,
  type Recalled,
  type SentAnswer,
  setupMemory,
  type Work,
  type WorkId,
} from "kolu-work";
import { type Component, createMemo, For, Show } from "solid-js";
import { useShown } from "../ui/shown";
import AskOptions, { askOption } from "./AskOptions";
import {
  forgetAskFields,
  pickOnly,
  type Seeding,
  seededChips,
  typedKey,
  typeOnly,
} from "./askForm";
import { askDraft, forgetAskDraft, setAskDraft } from "./drafts";
import { askOnScreenKey, trackOnScreen } from "./onScreen";
import { openReader } from "./reader/useReader";
import { useConductor } from "./useConductor";
import { useWorkMap } from "./useWorks";
import WorkChip from "./WorkChip";
import WorkChipFace from "./WorkChipFace";
import WorkChoiceQuestion from "./WorkChoiceQuestion";
import { workFileName } from "./workFile";
import { answerWords, decisionLabel } from "./workReadings";

const readWords = (path: string): string => {
  const name = workFileName(path);
  return name === "plan.md" ? "Read the plan" : `Read ${name}`;
};

const takesSeveral = (decision: Offered): boolean =>
  decision.topic === "work" && decision.multiple;

const WorkQuestion: Component<{
  work: Work;
  id: WorkId;
  ask: string;
  from: AnsweredFromFace;
  attach?: { count: number; text: () => string };
}> = (props) => {
  const orch = useConductor();
  const track = trackOnScreen(() => askOnScreenKey(props.ask), useShown());
  const questions = createMemo(() =>
    props.work.decisions.filter(
      (one) =>
        one.ask === props.ask &&
        !(
          isSettled(one) &&
          one.answer.how !== "dropped" &&
          one.answer.from === "request"
        ),
    ),
  );
  const open = createMemo(() => questions().filter((one) => isAsked(one)));
  const recorded = createMemo(() =>
    questions().filter((one) => isSettled(one)),
  );
  const settled = () => open().length === 0;

  const works = useWorkMap();
  const memory = createMemo(() =>
    setupMemory([...works().values()], hostOf(props.work)),
  );

  const picked = (decision: string, value: string): boolean =>
    askDraft(props.ask, decision).includes(value);

  const pick = (decision: Offered, value: string): void => {
    const current = askDraft(props.ask, decision.id);
    if (takesSeveral(decision)) {
      setAskDraft(
        props.ask,
        decision.id,
        current.includes(value)
          ? current.filter((one) => one !== value)
          : [...current, value],
      );
      return;
    }
    pickOnly(props.ask, decision.id, value);
  };

  const type = (decision: Offered, text: string): void => {
    if (!takesSeveral(decision)) {
      typeOnly(props.ask, decision.id, text);
      return;
    }
    setAskDraft(props.ask, typedKey(decision.id), text === "" ? [] : [text]);
  };

  const OfferedQuestion: Component<{ decision: Offered }> = (one) => {
    const standing = (): Option.Option<Recalled> => {
      const decision = one.decision;
      if (decision.topic !== "setup") return Option.none();
      return Option.filter(memory().last(decision.key, Option.none()), (want) =>
        (decision.options as ReadonlyArray<string>).includes(want.value),
      );
    };
    const chips = seededChips(
      props.ask,
      one.decision.id,
      (): Seeding => {
        const options = one.decision.options.map(askOption);
        return one.decision.topic === "setup"
          ? { kind: "seeded", context: "offered", options }
          : { kind: "unseeded", options };
      },
      standing,
    );
    return (
      <>
        <AskOptions
          field={one.decision.id}
          options={chips()}
          usedBefore={Option.match(standing(), {
            onSome: (last) => [last.value],
            onNone: () => [],
          })}
          picked={(value) => picked(one.decision.id, value)}
          onPick={(value) => pick(one.decision, value)}
          searchLabel="options"
        />
        <Show when={one.decision.topic === "work"}>
          <input
            type="text"
            data-testid="conductor-ask-other"
            data-field={one.decision.id}
            placeholder="or say it in your own words"
            value={askDraft(props.ask, typedKey(one.decision.id))[0] ?? ""}
            class="mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent"
            onInput={(event) => type(one.decision, event.currentTarget.value)}
          />
        </Show>
      </>
    );
  };

  const sentSetupAnswer = (
    decision: Extract<Asked, { topic: "setup" }>,
  ): Option.Option<SentAnswer> => {
    const typed = askDraft(props.ask, typedKey(decision.id))[0] ?? "";
    if (isKoluChoice(decision) && typed.trim() !== "")
      return Option.some({ typed: typed.trim() });
    const one = askDraft(props.ask, decision.id)[0];
    return one === undefined || one === "" ? Option.none() : Option.some([one]);
  };

  const sentWorkAnswer = (
    decision: Extract<Asked, { topic: "work" }>,
    rider: string,
  ): Option.Option<SentAnswer> => {
    const typed = askDraft(props.ask, typedKey(decision.id))[0] ?? "";
    const words = [typed, rider].filter((part) => part !== "").join("\n\n");
    const values = [
      ...askDraft(props.ask, decision.id),
      ...(words === "" ? [] : [words]),
    ];
    return values.length === 0 ? Option.none() : Option.some(values);
  };

  const sentOf = (
    decision: Asked,
    rider: string,
  ): Option.Option<SentAnswer> => {
    switch (decision.topic) {
      case "setup":
        return sentSetupAnswer(decision);
      case "work":
        return sentWorkAnswer(decision, rider);
      default:
        return decision satisfies never;
    }
  };

  const answers = createMemo((): Record<string, SentAnswer> => {
    const sending: Record<string, SentAnswer> = {};
    const rider = props.attach?.text() ?? "";
    for (const decision of open()) {
      const sent = sentOf(decision, rider);
      if (Option.isSome(sent)) sending[decision.id] = sent.value;
    }
    return sending;
  });

  const filled = () => Object.keys(answers()).length > 0;

  const send = (values: Record<string, SentAnswer>): void => {
    const sent = Object.keys(values);
    orch.answerWork(props.id, props.ask, values, props.from, (outcome) => {
      switch (outcome.kind) {
        case "answered":
        case "declined":
          forgetAskDraft(props.ask);
          return;
        case "part":
          forgetAskFields(
            props.ask,
            sent.filter((id) => !outcome.open.includes(id)),
          );
          return;
        case "nothing-open":
          return;
        default:
          return outcome satisfies never;
      }
    });
  };

  const decline = (): void => {
    orch.answerWork(props.id, props.ask, null, props.from);
    forgetAskDraft(props.ask);
  };

  return (
    <section
      ref={track}
      data-testid="work-question"
      data-ask={props.ask}
      data-from={props.from}
      data-settled={settled() ? "" : undefined}
      class="rounded-xl border border-alert/55 bg-alert/[0.08] px-3 py-2.5 text-xs"
    >
      <header class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
        <span class="text-alert text-base leading-none">✱</span>
        <b class="text-[0.78rem]">Conductor asks you</b>
        <Show when={props.from !== "card"}>
          <span data-testid="work-question-work" class="min-w-0">
            <Show
              when={props.from === "chat"}
              fallback={<WorkChipFace work={props.work} />}
            >
              <WorkChip id={props.id} work={props.work} />
            </Show>
          </span>
        </Show>
      </header>

      <Show when={recorded().length > 0}>
        <ul class="mt-2 list-none m-0 p-0 flex flex-col gap-0.5">
          <For each={recorded()}>
            {(decision) => (
              <li
                data-testid="conductor-ask-answer"
                data-field={decision.id}
                class="text-fg-2"
              >
                <span class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                  {decisionLabel(decision)}
                </span>
                <span class="text-fg"> — {answerWords(decision)}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={!settled()}>
        <For each={open()}>
          {(decision) => (
            <fieldset class="mt-2" data-decision={decision.id}>
              <legend class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                {decision.question}
              </legend>
              {isKoluChoice(decision) ? (
                <WorkChoiceQuestion
                  work={props.work}
                  ask={props.ask}
                  decision={decision}
                  memory={memory()}
                />
              ) : (
                <OfferedQuestion decision={decision} />
              )}
              <Show
                when={
                  decision.topic === "work" &&
                  decision.file.kind === "file" &&
                  (props.from === "card" || props.from === "chat")
                    ? decision.file.path
                    : undefined
                }
              >
                {(path) => (
                  <button
                    type="button"
                    data-testid="work-question-read"
                    data-path={path()}
                    class="mt-1.5 rounded-md border border-edge-bright px-2.5 py-1 text-fg-2 hover:text-fg cursor-pointer"
                    onClick={() => openReader({ work: props.id, path: path() })}
                  >
                    {readWords(path())}
                  </button>
                )}
              </Show>
            </fieldset>
          )}
        </For>

        <Show when={(props.attach?.count ?? 0) > 0}>
          <p
            data-testid="work-question-attach"
            class="mt-2 m-0 font-mono text-[0.62rem] text-fg-3"
          >
            {props.attach?.count === 1
              ? "1 comment goes with your answer"
              : `${props.attach?.count} comments go with your answer`}
          </p>
        </Show>

        <div class="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="conductor-ask-submit"
            disabled={!filled()}
            class="rounded-md bg-accent px-3 py-1 font-semibold text-surface-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => send(answers())}
          >
            Answer
          </button>
          <button
            type="button"
            data-testid="conductor-ask-dismiss"
            class="rounded-md border border-edge-bright px-3 py-1 text-fg-2 hover:text-fg cursor-pointer"
            onClick={decline}
          >
            I'd rather not say
          </button>
        </div>
      </Show>
    </section>
  );
};

export default WorkQuestion;
export { WorkQuestion };
