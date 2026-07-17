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
 * SK4/SK5 add the third arm: `incompatible` — a PROVEN contract skew. Its card
 * states BOTH versions from the typed status fields and offers the ONE recovery
 * that can work — "Update &amp; restart kaval" (`hosts.renewDaemon`, the binder's
 * drain → re-realise pipeline) — and deliberately NO Restart verb: by the arm's
 * construction a respawn from the host's current closure has already been tried
 * and skewed, so offering Restart would be the dead-end loop this fix removes.
 * The affordance is a total function of the state sum.
 */

import { type Component, createMemo, type JSX, Show } from "solid-js";
import { WarningIcon } from "../ui/Icons";
import { activeHost } from "../wire";
import type { DaemonDownState } from "./daemonPresentation";
import { skewRenewVerdict } from "./renewVerdict";
import RestartKavalButton from "./RestartKavalButton";
import UpdateKavalButton from "./UpdateKavalButton";
import {
  renewInFlight,
  renewSettledUnconverged,
  restartDaemon,
} from "./useDaemonRestart";
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
 *  and the renew action. No Restart verb, by construction.
 *
 *  Two copies, one card: the FIRST-time skew offers the update with its ordinary
 *  copy; once a renew for this host has SETTLED and the card is STILL here
 *  (`renewSettledUnconverged`), the renew did NOT converge — so the card says so
 *  honestly and names the real cause (another kolu install/instance on the host
 *  is still respawning the old kaval), instead of looping the same hopeful
 *  promise the user just watched fail. The verdict is a total function of the two
 *  per-host renew markers ({@link skewRenewVerdict}). */
const IncompatibleCard: Component<{
  daemonVersion: string;
  requiredVersion: string;
}> = (props) => {
  // A `createMemo` (not a plain accessor): three reactive scopes read it — the
  // heading ternary, the `Show`, and the `data-nonconvergence` attr — and
  // solidjs.md calls for a memo when 2+ contexts read the same derived value, so
  // the `activeHost`/marker reads run once per change, not once per read site.
  const didNotConverge = createMemo(
    () =>
      skewRenewVerdict(
        renewSettledUnconverged(activeHost()),
        renewInFlight(activeHost()),
      ) === "did-not-converge",
  );
  return (
    <DangerCard
      heading={
        didNotConverge()
          ? "Update didn’t converge — kaval is still incompatible"
          : "kaval is incompatible with this kolu"
      }
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
      <Show
        when={didNotConverge()}
        fallback={
          <p class="mt-2 text-sm leading-relaxed text-fg-2">
            Restarting can’t fix this — the host’s kaval binary is from an older
            kolu install, and a respawn brings back the same version. Updating
            re-provisions the current build on the host and starts a
            correct-version kaval.
          </p>
        }
      >
        <p class="mt-2 text-sm leading-relaxed text-fg-2">
          The update ran but the host came back on the same old kaval —
          something else on this host is still running it. Most often another
          kolu install or session on this host owns a kaval from an older build
          and keeps respawning it. Close those, or update the host’s kolu, then
          try again.
        </p>
      </Show>
      <p
        class="mt-2 text-xs leading-relaxed text-fg-3"
        data-testid="kaval-skew-nonconvergence"
        data-nonconvergence={didNotConverge() ? "true" : "false"}
      >
        Your saved session is preserved and offered for restore on the fresh
        daemon.
      </p>
    </DangerCard>
  );
};

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
