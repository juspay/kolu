// @vitest-environment happy-dom
/**
 * THE SIGN-IN ROW, and which doors it draws for whom.
 *
 * The restart is the whole remedy for a signature that changed under a running
 * agent: the adapter read its credential at `initialize` and nothing else
 * reaches it. It used to be drawn only on a row a PERSON asked for — so when
 * the AGENT asked (ACP's `-32000`) and the person went and signed in from
 * their own shell, the only button on screen started a second login and the
 * one that would have fixed it did not exist.
 *
 * `Not now` stays the person's alone: the agent's offer stands on a refusal
 * that still stands, and the host leaves that row exactly where it is.
 */

import {
  type ConductorState,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConductorSignIn from "./ConductorSignIn";

const verbs = vi.hoisted(() => ({
  signIn: vi.fn(),
  signInCancel: vi.fn(),
  signInInput: vi.fn(),
  reloadAgent: vi.fn(),
}));
vi.mock("./useConductor", () => ({ useConductor: () => verbs }));

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  for (const verb of Object.values(verbs)) verb.mockClear();
});

const METHOD = {
  id: "console-login",
  name: "Anthropic Console",
  description: null,
  runs: "client",
} as const;
type SignInRow = NonNullable<ConductorState["signIn"]>;

const row = (over: Partial<SignInRow> = {}): SignInRow => ({
  cause: {
    kind: "person",
    said: "the signature is read from /home/me/.claude",
  },
  methods: [METHOD],
  attempt: null,
  ...over,
});

function mount(signIn: SignInRow): {
  at: (testid: string) => HTMLElement | undefined;
} {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <ConductorSignIn signIn={signIn} />, root);
  return {
    at: (testid) =>
      document.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ??
      undefined,
  };
}

describe("a row the AGENT put up", () => {
  it("offers the restart — the remedy for a sign-in made in their own shell", () => {
    const { at } = mount(
      row({ cause: { kind: "agent", why: "Authentication required" } }),
    );
    const restart = at("conductor-signin-reload");
    expect(restart?.textContent).toBe(
      "Signed in elsewhere — restart the agent",
    );
    restart?.click();
    expect(verbs.reloadAgent).toHaveBeenCalledTimes(1);
  });

  it("offers no `Not now`: the refusal behind it still stands", () => {
    const { at } = mount(
      row({ cause: { kind: "agent", why: "Authentication required" } }),
    );
    expect(at("conductor-signin-close")).toBeUndefined();
  });
});

describe("a row a PERSON asked for", () => {
  it("offers both the restart and closing it again", () => {
    const { at } = mount(row());
    at("conductor-signin-reload")?.click();
    expect(verbs.reloadAgent).toHaveBeenCalledTimes(1);
    at("conductor-signin-close")?.click();
    expect(verbs.signInCancel).toHaveBeenCalledTimes(1);
  });
});

describe("a method already running", () => {
  it("draws neither door — the row belongs to the attempt", () => {
    const { at } = mount(
      row({
        attempt: {
          method: METHOD.id,
          state: "running",
          output: "visit https://example.invalid/oauth",
          link: null,
        },
      }),
    );
    expect(at("conductor-signin-reload")).toBeUndefined();
    expect(at("conductor-signin-close")).toBeUndefined();
    // ... and the attempt's own cancel is the one that is there.
    at("conductor-signin-cancel")?.click();
    expect(verbs.signInCancel).toHaveBeenCalledTimes(1);
  });
});

/** The default state carries no sign-in at all — the pane draws this row only
 *  when there is one, which is the fact this file depends on. */
it("is drawn only when the conversation has a sign-in", () => {
  expect(DEFAULT_CONDUCTOR_STATE.signIn).toBeNull();
});
