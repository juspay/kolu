/**
 * Hello-world chrome, rendered from surface-app's headless model.
 *
 * The library ships NO styled components — this rail/badge/prompt is the app's
 * own CSS, built from `useSurfaceApp()`. The same model drives kolu's tailwind
 * chrome and drishti's; only the pixels differ.
 */

import {
  type ConnectionStatus,
  SurfaceAppProvider,
  surfaceAppProbe,
  useSurfaceApp,
} from "@kolu/surface-app/solid";
import { createSignal, Show } from "solid-js";
import { buildInfo, type ExampleBuildInfo } from "../common/surface";
import { clients, ws } from "./wire";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  live: "live",
  reconnecting: "reconnecting…",
  restarted: "server restarted",
  down: "down",
};

function Shell() {
  const pwa = useSurfaceApp<ExampleBuildInfo>();
  // app-specific cell — a SIBLING surface (`app`) over the same wire as
  // surface-app's buildInfo. The server pushes it live; Solid re-renders on
  // each delta.
  const stats = clients.app.cells.serverStats.use({
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
        <span class={`dot ${pwa.status() === "live" ? "ok" : "warn"}`} />
        <span class="muted">{STATUS_LABEL[pwa.status()]}</span>
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
            cell on the sibling <code>app</code> surface (the server pushes it
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
      clientCommit={__SURFACE_APP_COMMIT__}
      buildInfo={buildInfo}
      ws={ws}
      // The probe rides the SCOPED `surfaceApp` client: its `.rpc` is the
      // `{ surface: link.surface.surfaceApp }` slice, so `surface.identity.info`
      // resolves at the wire path `/surface/surfaceApp/identity/info`. The key
      // is consumed by the scope and does NOT reappear in the path. `.rpc` is
      // typed `unknown` (the dynamic combined link can't be expanded per-key),
      // so the caller pins the probe call shape here.
      probe={() => surfaceAppProbe(clients.surfaceApp)}
      // Turnkey `{ ws, probe }` mode: `onError` covers BOTH the buildInfo
      // stream and a failed identity probe (a broken probe would otherwise
      // leave the connection status stuck silently).
      onError={(err) => console.error("surface-app error:", err)}
    >
      <Shell />
    </SurfaceAppProvider>
  );
}
