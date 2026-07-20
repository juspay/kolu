import { encodeHostKey, type HostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeStorage } from "../testing/fakeStorage.ts";
import { activeHostPref } from "./activeHostPref.ts";
import {
  activeHostStorage,
  activeHostStorageForLaunch,
} from "./activeHostStorage.ts";

const zest: HostKey = { kind: "remote", target: "zest" };

/** `activeHostStorage` — the storage-backend decision: an installed launch context → the
 *  survive-relaunch backend (localStorage), a regular tab → per-tab (sessionStorage). We
 *  pin only that mapping, over the install verdict as a boolean. Whether a given launch IS
 *  installed (display-mode / iOS `navigator.standalone`) is surface-app's
 *  `isInstalledFromEnv`, tested in its own `install.test.ts`; we do not re-test it here. */
describe("activeHostStorage — pick the backend from the launch context", () => {
  const local = fakeStorage();
  const session = fakeStorage();

  it("installed selects localStorage (survives relaunch)", () => {
    expect(activeHostStorage(true, { local, session })).toBe(local);
  });

  it("regular tab context selects sessionStorage (per-tab isolation)", () => {
    expect(activeHostStorage(false, { local, session })).toBe(session);
  });
});

/** `activeHostStorageForLaunch` — the LIVE-DOM path wire.ts calls at boot. It reads the
 *  real `window.matchMedia` / `navigator.standalone` into an `InstallEnv`, runs surface-app's
 *  `isInstalledFromEnv`, and picks the backend. Pinning it here guards the thin DOM reader
 *  (`readInstallEnv`) end-to-end — a typo in the display-mode queries or the iOS cast would
 *  otherwise break PWA memory while the boolean tests above stayed green. Runs under the
 *  client's happy-dom env, with `matchMedia` / `navigator.standalone` stubbed per case. */
describe("activeHostStorageForLaunch — read the live install env, then pick", () => {
  const realMatchMedia = window.matchMedia;
  const hadStandalone = "standalone" in navigator;

  afterEach(() => {
    window.matchMedia = realMatchMedia;
    if (!hadStandalone)
      delete (navigator as Navigator & { standalone?: boolean }).standalone;
    vi.restoreAllMocks();
  });

  /** Stub `window.matchMedia` so exactly `matches` display-mode queries report installed. */
  function stubDisplayModes(matching: string[]): void {
    const set = new Set(matching);
    window.matchMedia = vi.fn(
      (query: string) => ({ matches: set.has(query) }) as MediaQueryList,
    );
  }
  function stubIosStandalone(value: boolean): void {
    Object.defineProperty(navigator, "standalone", {
      value,
      configurable: true,
    });
  }

  const backends = { local: fakeStorage(), session: fakeStorage() };

  // The reader matches ALL of surface-app's installed display-modes. Pin EACH arm
  // independently, so a typo in (or removal of) any single query fails its own case —
  // not just the standalone one.
  it.each([
    "(display-mode: standalone)",
    "(display-mode: minimal-ui)",
    "(display-mode: fullscreen)",
  ])("installed display-mode %s → localStorage", (query) => {
    stubDisplayModes([query]);
    stubIosStandalone(false);
    expect(activeHostStorageForLaunch(backends)).toBe(backends.local);
  });

  it("legacy iOS navigator.standalone → localStorage", () => {
    stubDisplayModes([]);
    stubIosStandalone(true);
    expect(activeHostStorageForLaunch(backends)).toBe(backends.local);
  });

  it("regular tab (no signal) → sessionStorage", () => {
    stubDisplayModes([]);
    stubIosStandalone(false);
    expect(activeHostStorageForLaunch(backends)).toBe(backends.session);
  });
});

/** The whole point: in a standalone relaunch — a FRESH (empty) sessionStorage but a
 *  populated localStorage — the active-host pref must boot on the REMEMBERED host, not
 *  silently revert to LOCAL_HOST. Wires the REAL pref (`activeHostPref` — the same
 *  contract production uses) over the backend `activeHostStorage` chooses, so a drift in
 *  the parser/serializer would fail this test rather than hide behind a copied contract. */
describe("active-host pref survives a standalone relaunch", () => {
  it("installed boot with empty sessionStorage + remembered localStorage → remembered host", () => {
    // A prior standalone session left the encoded remote host in localStorage; the
    // relaunch handed the window a brand-new, empty sessionStorage.
    const local = fakeStorage({ "kolu-active-host": encodeHostKey(zest) });
    const session = fakeStorage();
    const [activeHost] = activeHostPref(
      activeHostStorage(true, { local, session }),
    );

    // Booted on the remembered host — NOT the LOCAL_HOST fallback (the amnesia bug).
    expect(activeHost()).toEqual(zest);
  });

  it("regular-tab boot ignores localStorage and starts from the per-tab default", () => {
    // Same populated localStorage, but a plain tab reads the (empty) sessionStorage and
    // so starts at the local default — per-tab isolation is unchanged.
    const local = fakeStorage({ "kolu-active-host": encodeHostKey(zest) });
    const session = fakeStorage();
    const [activeHost] = activeHostPref(
      activeHostStorage(false, { local, session }),
    );

    expect(activeHost()).toEqual(LOCAL_HOST);
  });
});
