# Plan: Server-side user preferences

Move user preferences from client-side localStorage to server-side persistent state via `conf` (issue #214, "User preferences" row only).

## What changes

### Server (`server/src/state.ts`)
- Add `UserPreferences` type with: colorScheme, randomTheme, scrollLock, activityAlerts, startupTips, seenTips, defaultFontSize
- Add `preferences` field to `StateSchema` with sensible defaults
- Bump `SCHEMA_VERSION`, add migration
- Export `getPreferences()` and `setPreferences(partial)` (merge semantics)

### Contract (`common/src/contract.ts`)
- Add `preferences.get` and `preferences.set` endpoints with Zod schemas

### Server router (`server/src/router.ts`)
- Wire `preferences.get` → `getPreferences()`, `preferences.set` → `setPreferences(input)`

### Client (`client/src/usePreferences.ts`)
- Replace `makePersisted` signals with TanStack Query (fetch from server, mutate via RPC)
- Provide same reactive API to consumers so App.tsx/SettingsPopover changes are minimal

### Client (`client/src/useColorScheme.ts`)
- Read colorScheme from server-backed preferences instead of localStorage

### Client (`client/src/useTips.ts`)
- Read startupTips and seenTips from server-backed preferences instead of localStorage

### Client (`client/src/zoom.ts`)
- Read defaultFontSize from server preferences as the base (per-terminal zoom stays client-side localStorage)

## What stays the same
- Per-terminal font size zoom (Ctrl+/-) remains in localStorage
- Active terminal ID remains in localStorage (view state, not a preference)
- SettingsPopover UI — just rewired to new setters
