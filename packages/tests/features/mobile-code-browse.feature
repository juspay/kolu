Feature: Mobile code browse — unified right-panel drawer
  On mobile the right panel hosts itself as a bottom drawer (Corvu
  `Drawer side="bottom"`) instead of the desktop's side-resizable
  split — same `RightPanel` → `CodeTab` subtree inside, same
  `useRightPanel` selection slot, same `BrowseFileDispatcher`
  text/iframe dispatch. The chrome sheet's inspector toggle opens
  the drawer.

  # NOTE: Deeper drawer-interaction scenarios (clicking files inside,
  # dismiss via backdrop or chevron) are gated by a test-env quirk:
  # `hooks.ts:244` injects `* { transition-duration: 0s !important }`
  # to make Corvu dialogs settle instantly, but Corvu's drawer reads
  # the computed `transitionDuration` and — when it sees 0s — bypasses
  # the normal close path via `closeDrawer()`, causing the drawer to
  # dismiss immediately after opening in test runs. The feature works
  # in real browsers (manual verification). The follow-up is to scope
  # the transition-disable to exclude `[data-corvu-drawer-content]`,
  # at which point scenarios for file selection / dismissal can land.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Inspector toggle in the chrome sheet opens the right panel as a drawer
    When I tap the mobile pull handle
    And I tap the mobile inspector toggle
    Then the right panel should be visible
    And there should be no page errors
