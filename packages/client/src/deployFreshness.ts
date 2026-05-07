import { isLegacyWorkboxCacheName } from "kolu-common/legacyWorkboxCache";

/**
 * Deploy-synchronization helpers. Owns "make sure the user's next navigation
 * lands on the fresh build" so transport UI and lifecycle probing do not own
 * asset freshness policy.
 *
 * Kolu no longer registers a service worker. The service-worker calls here are
 * strictly legacy cleanup for users who already installed the old Workbox
 * app-shell worker.
 */

const RELOAD_GUARD_KEY = "kolu:build-reload";

/**
 * Drop any legacy app-shell service worker and its caches before navigating.
 * This makes the manual "Server updated" reload useful even for clients still
 * controlled by the removed Workbox worker.
 */
async function clearLegacyAppShellCache(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch (err) {
    console.warn("Legacy service-worker update before reload failed:", err);
  }

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.unregister();
  } catch (err) {
    console.warn("Legacy service-worker unregister before reload failed:", err);
  }

  try {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(isLegacyWorkboxCacheName)
          .map((cacheName) => caches.delete(cacheName)),
      );
    }
  } catch (err) {
    console.warn("Legacy cache cleanup before reload failed:", err);
  }
}

export async function reloadToFreshBuild(): Promise<void> {
  await clearLegacyAppShellCache();
  location.reload();
}

export function reloadIfServerBuildChanged(serverCommit: string): void {
  if (
    __KOLU_COMMIT__ === "dev" ||
    serverCommit === "dev" ||
    serverCommit === __KOLU_COMMIT__
  ) {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    return;
  }

  const reloadToken = `${__KOLU_COMMIT__}->${serverCommit}`;
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === reloadToken) {
    console.warn(
      `Kolu build still stale after reload: client=${__KOLU_COMMIT__} server=${serverCommit}`,
    );
    return;
  }

  sessionStorage.setItem(RELOAD_GUARD_KEY, reloadToken);
  void reloadToFreshBuild();
}
