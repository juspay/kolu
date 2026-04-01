# Summary

**Task:** Move user preferences (theme, font size, tips) from localStorage to server-side persistent state via `conf`, per issue #214.

### sync (visit 1/1)
Already up to date with remote.
→ edge: default

### understand (visit 1/1)
Researched state.ts (conf store with migrations), usePreferences.ts, useColorScheme.ts, useTips.ts, zoom.ts, contract.ts, router.ts, SettingsPopover.tsx. All preferences currently in localStorage via makePersisted. Server state already has recentRepos + session domains.
→ edge: default

### hickey (visit 1/1)
Evaluated for structural simplicity. Key decision: single `preferences` object with two RPC endpoints (get/set) instead of per-field endpoints. Keep per-terminal zoom in localStorage separate from global defaultFontSize preference. No multi-tab sync needed.
→ edge: default
