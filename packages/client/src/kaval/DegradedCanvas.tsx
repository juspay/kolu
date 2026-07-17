/**
 * DegradedCanvas — the honest "the terminal daemon is down" surface.
 *
 * B2's empty-canvas-lie fix: when kaval (the pty-host daemon) is `dead` (never
 * came up at boot) or `degraded` (died mid-session), the canvas must say so —
 * NOT show the same "you have no terminals" welcome that a healthy, empty kolu
 * shows. #1034's worst lie was a respawn-timeout leaving a user staring at an
 * empty canvas indistinguishable from a fresh start, their 20-terminal session
 * seemingly gone. This surface is visibly distinct: a warning-toned card naming
 * the real problem.
 *
 * B3.2 makes it self-healing: a one-click "Restart kaval" recovers the daemon
 * (recycle → fresh) and offers the preserved session for restore on the empty
 * canvas. Here we name what happened and give the user that single button.
 *
 * SK4/SK5 add the third arm: `incompatible` — a PROVEN contract skew. The host's
 * kaval is a leftover from an older kolu install; padi itself is HEALTHY and
 * already realises the current closure (a padi-level skew rides the surface
 * connection cell, never this card). Its card states BOTH versions from the typed
 * status fields and offers the ONE recovery that works — RESTART the kaval (the
 * session-preserving recycle): it stops the stale kaval and spawns a correct-
 * version one from padi's current closure, which takes over the rendezvous socket
 * from the orphaned survivor. The affordance is a total function of the state sum.
 */

import { type Component, type JSX, Show } from "solid-js";
import { WarningIcon } from "../ui/Icons";
import type { DaemonDownState } from "./daemonPresentation";
import RestartKavalButton from "./RestartKavalButton";
import UpdateKavalButton from "./UpdateKavalButton";
import { restartDaemon } from "./useDaemonRestart";
import { localDaemonStatus } from "./useDaemonStatus";

/** The restartable down card — `dead` (never came up) / `degraded` (died
 *  mid-session). `downState()` in useDaemonStatus.ts is the single source that
 *  narrows the full `DaemonState` to the down union (a `restarting` daemon is
 *  coming back, not down, so it never renders here). */
/** The shared danger-card shell — the identical border/icon/heading chrome
 *  both down cards wear. Only the copy and the recovery action differ per arm,
 *  so the shell lives once (the twin of the button-side `InlineConfirmButton`
 *  extraction: one frame, per-arm content). */
const DangerCard: Component<{
  heading: string;
  versions?: JSX.Element;
  children: JSX.Element;
  action: JSX.Element;
}> = (props) => (
  <div class="mx-6 max-w-md rounded-xl border border-danger/50 bg-danger/5 px-6 py-5">
    <div class="flex items-start gap-3">
      <WarningIcon class="mt-0.5 h-6 w-6 shrink-0 text-danger" />
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-fg">{props.heading}</h2>
        {props.versions}
        {props.children}
        <div class="mt-3">{props.action}</div>
      </div>
    </div>
  </div>
);

const RestartableCard: Component<{ state: "dead" | "degraded" }> = (props) => {
  const isDead = () => props.state === "dead";
  return (
    <DangerCard
      heading={
        isDead()
          ? "kaval didn’t start"
          : "kaval — your terminal daemon — stopped"
      }
      action={
        <RestartKavalButton
          status={localDaemonStatus()}
          tone="danger"
          onConfirm={() => void restartDaemon()}
        />
      }
    >
      <p class="mt-1.5 text-sm leading-relaxed text-fg-2">
        <span class="font-mono text-fg">kaval</span> is the process that owns
        your shells.{" "}
        <Show
          when={isDead()}
          fallback="It went away, so the terminals it was running ended."
        >
          It couldn’t be started, so no terminals can run yet.
        </Show>{" "}
        This isn’t an empty workspace — it’s a daemon that needs to come back.
      </p>
      <p class="mt-2 text-xs leading-relaxed text-fg-3">
        Your saved session is preserved. Restart kaval to bring it back — your
        terminals are offered for restore on the fresh daemon.
      </p>
    </DangerCard>
  );
};

/** The contract-skew card (SK5) — both versions from the TYPED status fields,
 *  and the RESTART (recycle) action. The host's padi is healthy and already
 *  realises the current closure; only its kaval is a skewed survivor, so
 *  restarting the kaval spawns a correct-version one from that closure. */
const IncompatibleCard: Component<{
  daemonVersion: string;
  requiredVersion: string;
}> = (props) => (
  <DangerCard
    heading="kaval is incompatible with this kolu"
    versions={
      <p
        class="mt-1.5 font-mono text-xs text-fg-2"
        data-testid="kaval-skew-versions"
      >
        this host’s kaval speaks{" "}
        <span class="font-semibold text-danger">{props.daemonVersion}</span> ·
        your kolu needs{" "}
        <span class="font-semibold text-ok">{props.requiredVersion}</span>
      </p>
    }
    action={<UpdateKavalButton tone="danger" />}
  >
    <p class="mt-2 text-sm leading-relaxed text-fg-2">
      This host’s kaval is a leftover from an older kolu install. Restarting
      stops it and starts a correct-version kaval from the host’s current build
      — taking over from the stale one.
    </p>
    <p class="mt-2 text-xs leading-relaxed text-fg-3">
      Your saved session is preserved and offered for restore on the fresh
      daemon.
    </p>
  </DangerCard>
);

const DegradedCanvas: Component<{ down: DaemonDownState }> = (props) => {
  // Discriminate ONCE — each accessor narrows the union, so neither card ever
  // needs a cast and the affordance stays a total function of the sum.
  const skew = () =>
    props.down.state === "incompatible" ? props.down : undefined;
  const restartable = () =>
    props.down.state === "incompatible" ? undefined : props.down;
  return (
    <div
      data-testid="degraded-canvas"
      data-daemon-state={props.down.state}
      class="relative flex-1 min-h-0 flex items-center justify-center canvas-grid-bg"
    >
      <Show when={restartable()}>
        {(d) => <RestartableCard state={d().state} />}
      </Show>
      <Show when={skew()}>
        {(d) => (
          <IncompatibleCard
            daemonVersion={d().daemonVersion}
            requiredVersion={d().requiredVersion}
          />
        )}
      </Show>
    </div>
  );
};

export default DegradedCanvas;
