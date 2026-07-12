/** The ALPHA "remote hosts is an early feature" notice — the badge, heading,
 *  and doc link that lead the add-host affordance. Extracted so the desktop `+`
 *  popover (`AddHostAffordance`) and the mobile in-sheet add section
 *  (`MobileHostRow`) render the SAME warning verbatim: an add-host on mobile is
 *  exactly as unfinished as on desktop, and a single component makes that hold
 *  by construction rather than by two copies staying in sync. Only the
 *  container around it (anchored popover vs. full-width sheet section) differs
 *  per surface; this notice does not. */

import type { Component } from "solid-js";

/** kolu.dev doc the alpha "+ add a host" affordance links to. */
export const REMOTE_HOSTS_DOC = "https://kolu.dev/remote-hosts/";

export const RemoteHostsAlphaNotice: Component = () => (
  <>
    <div class="mb-1.5 flex items-center gap-1.5">
      <span class="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 text-[9px] font-semibold uppercase leading-4 tracking-wide text-amber-600 dark:text-amber-400">
        Alpha
      </span>
      <span class="text-xs font-semibold text-fg">Remote hosts</span>
    </div>
    <p class="mb-2.5 text-[11px] leading-4 text-fg-2">
      Connecting other machines over ssh is an early feature.{" "}
      <a
        href={REMOTE_HOSTS_DOC}
        target="_blank"
        rel="noopener noreferrer"
        class="text-accent hover:underline"
      >
        Learn more →
      </a>
    </p>
  </>
);
