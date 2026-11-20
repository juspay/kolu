Feature: Mobile code browse — unified right-panel drawer
  On mobile the right panel hosts itself as a bottom drawer (Corvu
  `Drawer side="bottom"`) instead of the desktop's side-resizable
  split — same `RightPanel` → `CodeTab` subtree inside, same
  `useRightPanel` selection slot, same `BrowseFileDispatcher`
  text/iframe dispatch. The chrome sheet's inspector toggle opens
  the drawer.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Inspector toggle in the chrome sheet opens the right panel as a drawer
    When I tap the mobile pull handle
    And I tap the mobile inspector toggle
    Then the right panel should be visible
    And there should be no page errors
