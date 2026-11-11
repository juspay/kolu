/** The way in, when the agent says nobody is signed in.
 *
 *  The methods are the AGENT'S — kolu offers no API-key box, because an agent
 *  that wants a key has its own way of asking for one and a box here would be a
 *  second credential path nobody audits. A `client`-run method is a command line
 *  the adapter handed over: kolu spawns it and streams its output into this row,
 *  which is why the output needs clickable URLs and the device code pulled out
 *  where a person can read it off the screen. An `agent`-run method is a page to
 *  visit and nothing to type.
 *
 *  A second press on a running method ATTACHES to the attempt already going
 *  rather than starting a second process — the host owns that rule; this row
 *  just keeps the button pressable so attaching is possible at all. */

import type { OrchestratorState } from "@kolu/padi-client/orchestrator";
import { type Component, createMemo, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { useOrchestrator } from "./useOrchestrator";

/** URLs, split out of the streamed output so they can be pressed. A sign-in
 *  that prints a link a person cannot click is a sign-in that asks them to
 *  retype it. */
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

/** The device code vendors print for you to paste at the page they sent you to
 *  — `ABCD-1234`, the shape the OAuth device flow standardised on. Pulled from
 *  the TAIL of the output because a long sign-in prints it last, and shown on
 *  its own so it is not something to hunt for in a wall of log lines. Nothing is
 *  invented: an output with no such token renders no box. */
function deviceCodeIn(output: string): string | undefined {
  const matches = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g);
  return matches?.[matches.length - 1];
}

const OrchestratorSignIn: Component<{
  signIn: NonNullable<OrchestratorState["signIn"]>;
}> = (props) => {
  const orch = useOrchestrator();
  const attempt = () => props.signIn.attempt;
  const code = createMemo(() => {
    const running = attempt();
    return running === null ? undefined : deviceCodeIn(running.output);
  });

  return (
    <section
      data-testid="orchestrator-signin"
      class="mx-3.5 mb-2 rounded-lg border border-attention/55 bg-attention/[0.08] px-3 py-2 text-xs"
    >
      <p class="text-attention font-semibold mb-1">{props.signIn.why}</p>
      <div class="flex flex-wrap gap-2">
        <For each={props.signIn.methods}>
          {(method) => (
            <button
              type="button"
              data-testid="orchestrator-signin-method"
              data-method={method.id}
              data-runs={method.runs}
              title={method.description ?? undefined}
              class="rounded-md border border-edge-bright bg-surface-2 hover:bg-surface-3 px-2.5 py-1 text-fg cursor-pointer"
              onClick={() => orch.signIn(method.id)}
            >
              {method.name}
            </button>
          )}
        </For>
      </div>
      <Show when={attempt()}>
        {(running) => (
          <div class="mt-2 space-y-2">
            <Show when={running().link}>
              {(link) => (
                <a
                  href={link().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="orchestrator-signin-link"
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
                  data-testid="orchestrator-signin-code"
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
              data-testid="orchestrator-signin-output"
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
            {/* A spawned command can ask something back (a vendor prompt, a
                confirmation). The box is the only way to answer it, and it
                exists only while an attempt is actually running. */}
            <Show when={running().state === "running"}>
              <input
                type="text"
                data-testid="orchestrator-signin-input"
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
                  data-testid="orchestrator-signin-retry"
                  class="rounded-md border border-edge-bright bg-surface-2 hover:bg-surface-3 px-2.5 py-1 cursor-pointer"
                  onClick={() => orch.signIn(running().method)}
                >
                  Try again
                </button>
              </Show>
              <button
                type="button"
                data-testid="orchestrator-signin-cancel"
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

export default OrchestratorSignIn;
