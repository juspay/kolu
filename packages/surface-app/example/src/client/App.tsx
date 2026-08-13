/**
 * Hello-world chrome, rendered from surface-app's headless model.
 *
 * The library ships NO styled components — this rail/badge/prompt is the app's
 * own CSS, built from `useSurfaceApp()`. The same model drives kolu's tailwind
 * chrome and drishti's; only the pixels differ.
 */

import { reloadForUpdate, shellCommit } from "@kolu/surface-app/lifecycle";
import { SurfaceAppProvider, useSurfaceApp } from "@kolu/surface-app/solid";
import { probeSurfaceIdentity } from "@kolu/surface/identity";
import type { SurfaceReadoutStatus } from "@kolu/surface/solid";
import { createSignal, Show } from "solid-js";
import { buildInfo, type ExampleBuildInfo } from "../common/surface";
import { clients, conn } from "./wire";

/** The wording, which is the APP's — the framework decides which of the five
 *  states is true, never what it is called. A `Record`, so a state with no
 *  sentence of its own is a type error here rather than a silent fallback. */
const STATUS_LABEL: Record<SurfaceReadoutStatus, string> = {
  connecting: "connecting…",
  live: "live",
  degraded: "partly live",
  reconnecting: "reconnecting…",
  retired: "server restarted",
};

/** This app's green claim, spelled out: `live` means the cells on this page are
 *  arriving, not that a socket is open. When they aren't, the readout says WHICH
 *  ones — a non-empty list by type, so this sentence can't come out with a hole
 *  in it. */
const statusDetail = (): string => {
  const now = conn.readout();
  return now.status === "degraded"
    ? `connected, but nothing is arriving on ${now.stopped.join(", ")}`
    : STATUS_LABEL[now.status];
};

function Shell() {
  const pwa = useSurfaceApp<ExampleBuildInfo>();
  // app-specific cell — a SIBLING surface (`demo`) over the same wire as
  // surface-app's buildInfo. The server pushes it live; Solid re-renders on
  // each delta.
  const stats = clients.demo.cells.serverStats.use({
    authority: "server",
    onError: (err) => console.error("serverStats subscription error:", err),
  });
  const uptime = () => {
    const s = stats.value();
    return s?.startedAt ? `${Math.floor((s.now - s.startedAt) / 1000)}s` : "…";
  };
  const clock = () => {
    const s = stats.value();
    return s?.now ? new Date(s.now).toLocaleTimeString() : "…";
  };
  const [count, setCount] = createSignal(0);
  const ping = () => {
    const n = count() + 1;
    setCount(n);
    pwa.setAttention(n);
  };

  return (
    <>
      <header class="rail">
        {/* The dot reads the READOUT, not the transport: `connectSurfaces` folds
            the wire's state together with every sibling's subscription health, so
            green here is a claim about what reaches THIS PAGE. Painting it from a
            transport status alone is how a stopped `serverStats` would render as
            a frozen panel under a green light. */}
        <span
          class={`dot ${conn.readout().status === "live" ? "ok" : "warn"}`}
        />
        <span class="muted" title={statusDetail()}>
          {STATUS_LABEL[conn.readout().status]}
        </span>
        <span class="sep">·</span>
        <span>
          SRV <b class="srv">{pwa.server()?.commit || "…"}</b>
        </span>
        <span class="sep">·</span>
        <span>
          {/* the async boot-time axis — empty until the fragment's async source
              settles and `connect` republishes it over the wire */}
          BOOT <b class="srv">{pwa.server()?.bootId || "…"}</b>
        </span>
        <span class="sep">·</span>
        <span>
          CLIENT <b class="cli">{pwa.clientCommit}</b>
        </span>
        <Show when={pwa.stale()}>
          <span class="chip">≠ srv</span>
          <button type="button" class="reload" onClick={pwa.reload}>
            ⟳ Reload
          </button>
        </Show>
      </header>

      <main class="body">
        <h1>@kolu/surface-app</h1>
        <p class="lead">
          The app shell for surface apps. This client is bound to a server over
          the live wire; its build identity rides a <code>buildInfo</code>{" "}
          surface cell, and the rail above is rendered from the headless{" "}
          <code>useSurfaceApp()</code> model.
        </p>

        <Show
          when={pwa.stale()}
          fallback={<p class="ok-text">✓ In step with the server.</p>}
        >
          <p class="warn-text">
            This tab is running an <b>older build</b> than the server — the rail
            shows <code>≠ srv</code> and a one-tap <b>Reload</b>. (Server{" "}
            <code>{pwa.server()?.commit}</code> ≠ client{" "}
            <code>{pwa.clientCommit}</code>.)
          </p>
        </Show>

        <section class="stats">
          <div class="stats-h">
            <span class="livedot" /> Live from the server
          </div>
          <div class="statgrid">
            <div>
              <span class="sk">uptime</span>
              <span class="sv">{uptime()}</span>
            </div>
            <div>
              <span class="sk">clients</span>
              <span class="sv">{stats.value()?.connections ?? 0}</span>
            </div>
            <div>
              <span class="sk">server clock</span>
              <span class="sv">{clock()}</span>
            </div>
          </div>
          <p class="muted small">
            This panel reads an <b>app-specific</b> <code>serverStats</code>{" "}
            cell on the sibling <code>demo</code> surface (the server pushes it
            live); the rail above reads surface-app's <code>buildInfo</code> on
            the sibling <code>surfaceApp</code> surface. Two independent
            surfaces, one wire. Open a second tab — the <b>clients</b> count
            rises in both.
          </p>
        </section>

        <button type="button" class="ping" onClick={ping}>
          Ping → setAttention({count() + 1})
        </button>
        <p class="muted small">
          <code>setAttention()</code> sets the OS app badge (installed Chromium)
          and the document title — watch the tab title change.
        </p>
      </main>
    </>
  );
}

export default function App() {
  return (
    <SurfaceAppProvider<ExampleBuildInfo>
      controlPlane={clients.surfaceApp}
      clientCommit={shellCommit()}
      buildInfo={buildInfo}
      wire={conn.link.wire}
      // `wire.ts`'s `createLiveSignal` already wires the half-open watchdog over
      // this wire (minting the branded `{ live }` the clients require), so
      // the lifecycle opts ITS watchdog out — one watchdog on the wire, not two.
      // (The lifecycle mints no brand, so this is ownership coordination only.)
      heartbeat={false}
      // The FRAMEWORK-RESERVED identity round-trip — no app-declared member. It
      // rides the SCOPED `surfaceApp` client, whose dispatch splices the sibling
      // key into every tag, so it resolves at `surface/surfaceApp/system/identity`.
      // It hands back an `Effect` — the provider runs it at its own edge, so an app
      // never opens one. Its `processId` is the same id the stale-tab gate compares
      // against, because both read `surfaceProcessId()`.
      probe={() => probeSurfaceIdentity(clients.surfaceApp.rpc)}
      // Turnkey `{ ws, probe }` mode: `onError` covers BOTH the buildInfo
      // stream and a failed identity probe (a broken probe would otherwise
      // leave the connection status stuck silently).
      onError={(err) => console.error("surface-app error:", err)}
      // What an uncaught render throw looks like — REQUIRED, like `retired` on
      // the connect seam: the provider wraps the shell in
      // `SurfaceFaultBoundary`, which catches/records/prints; the app supplies
      // only this markup, handed the printed text verbatim.
      fault={(text) => (
        <main class="body">
          <h1>This page broke</h1>
          <p class="lead">
            The client itself threw while drawing — the text below is what a bug
            report is made of.
          </p>
          <pre>{text}</pre>
          <button type="button" class="reload" onClick={reloadForUpdate}>
            Reload
          </button>
        </main>
      )}
    >
      <Shell />
    </SurfaceAppProvider>
  );
}
