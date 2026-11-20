import type { ConductorState } from "kolu-common/conductor";
import { type Component, createMemo, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { useConductor } from "./useConductor";

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

function deviceCodeIn(output: string): string | undefined {
  const matches = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g);
  return matches?.[matches.length - 1];
}

const ConductorSignIn: Component<{
  signIn: NonNullable<ConductorState["signIn"]>;
}> = (props) => {
  const orch = useConductor();
  const attempt = () => props.signIn.attempt;
  const code = createMemo(() => {
    const running = attempt();
    return running === null ? undefined : deviceCodeIn(running.output);
  });

  return (
    <section
      data-testid="conductor-signin"
      data-cause={props.signIn.cause.kind}
      class="mx-3.5 mb-2 rounded-lg border border-attention/55 bg-attention/[0.08] px-3 py-2 text-xs"
    >
      {props.signIn.cause.kind === "agent" ? (
        <p class="text-attention font-semibold mb-1">
          {props.signIn.cause.why}
        </p>
      ) : (
        <>
          <p class="text-attention font-semibold mb-0.5">
            Sign in again — the next message runs as whoever signs in here.
          </p>
          <p class="text-fg-3 mb-1">{props.signIn.cause.said}</p>
        </>
      )}
      <div class="flex flex-wrap gap-2">
        <For each={props.signIn.methods}>
          {(method) => (
            <Show
              when={method.runs !== "hand"}
              fallback={
                <span
                  data-testid="conductor-signin-hand"
                  data-method={method.id}
                  title={method.description ?? undefined}
                  class="flex items-center gap-1.5 text-fg-2"
                >
                  {method.name}:
                  <code class="select-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg">
                    {method.command}
                  </code>
                </span>
              }
            >
              <button
                type="button"
                data-testid="conductor-signin-method"
                data-method={method.id}
                data-runs={method.runs}
                title={method.description ?? undefined}
                class="rounded-md border border-edge-bright bg-surface-2 hover:bg-surface-3 px-2.5 py-1 text-fg cursor-pointer"
                onClick={() => orch.signIn(method.id)}
              >
                {method.name}
              </button>
            </Show>
          )}
        </For>
      </div>
      <Show when={attempt() === null}>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="conductor-signin-reload"
            class="rounded-md border border-edge-bright px-2.5 py-1 text-fg-2 hover:text-fg cursor-pointer"
            onClick={() => orch.reloadAgent()}
          >
            Signed in elsewhere — restart the agent
          </button>
          <Show when={props.signIn.cause.kind === "person"}>
            <button
              type="button"
              data-testid="conductor-signin-close"
              class="rounded-md border border-edge-bright px-2.5 py-1 text-fg-2 hover:text-fg cursor-pointer"
              onClick={() => orch.signInCancel()}
            >
              Not now
            </button>
          </Show>
        </div>
      </Show>
      <Show when={attempt()}>
        {(running) => (
          <div class="mt-2 space-y-2">
            <Show when={running().link}>
              {(link) => (
                <a
                  href={link().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="conductor-signin-link"
                  class="text-accent hover:underline break-all"
                >
                  {link().url}
                  <span class="text-fg-3"> · {link().host}</span>
                </a>
              )}
            </Show>
            <Show when={code()}>
              {(value) => (
                <button
                  type="button"
                  data-testid="conductor-signin-code"
                  class="font-mono text-base tracking-[0.2em] rounded-md border border-edge-bright bg-surface-0 px-3 py-1.5 cursor-pointer"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(value())
                      .then(() => toast.success("Code copied"))
                      .catch((err: unknown) =>
                        toast.error(
                          `Could not copy the code: ${err instanceof Error ? err.message : String(err)}`,
                        ),
                      );
                  }}
                >
                  {value()}
                </button>
              )}
            </Show>
            <pre
              data-testid="conductor-signin-output"
              data-state={running().state}
              class="max-h-40 overflow-auto rounded-md bg-surface-0 px-2.5 py-2 font-mono text-[0.68rem] leading-relaxed whitespace-pre-wrap text-fg-2"
            >
              <For each={running().output.split(URL_PATTERN)}>
                {(piece) =>
                  piece.startsWith("http") ? (
                    <a
                      href={piece}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-accent hover:underline"
                    >
                      {piece}
                    </a>
                  ) : (
                    piece
                  )
                }
              </For>
            </pre>
            <Show when={running().state === "running"}>
              <input
                type="text"
                data-testid="conductor-signin-input"
                placeholder="Type a reply to the sign-in command…"
                class="w-full rounded-md border border-edge-bright bg-surface-0 px-2.5 py-1 font-mono text-[0.68rem] text-fg outline-none focus:border-accent"
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const field = event.currentTarget;
                  orch.signInInput(field.value);
                  field.value = "";
                }}
              />
            </Show>
            <div class="flex gap-2">
              <Show when={running().state === "failed"}>
                <button
                  type="button"
                  data-testid="conductor-signin-retry"
                  class="rounded-md border border-edge-bright bg-surface-2 hover:bg-surface-3 px-2.5 py-1 cursor-pointer"
                  onClick={() => orch.signIn(running().method)}
                >
                  Try again
                </button>
              </Show>
              <button
                type="button"
                data-testid="conductor-signin-cancel"
                class="rounded-md border border-edge-bright px-2.5 py-1 text-fg-2 hover:text-fg cursor-pointer"
                onClick={() => orch.signInCancel()}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
};

export default ConductorSignIn;
