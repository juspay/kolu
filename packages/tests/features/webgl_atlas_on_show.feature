Feature: WebGL glyph atlas rebuild on tile show
  A terminal tile hidden via display:none — a non-active split sub-tab, or an
  off-screen tile in maximized mode — can return with a STALE glyph atlas: while
  hidden it misses the resize/DPR events that rebuild it, and on show a
  same-geometry fit() is a cols/rows no-op that fires no handleResize, so nothing
  rebuilds — every glyph then draws from a wrong atlas slot (whole-tile garble that
  clears only on a real resize or a reload). The kit must force an atlas rebuild on
  the per-tile VISIBLE transition regardless of a cols/rows change — the per-tile
  twin of refitOnTabVisible's whole-tab clearTextureAtlas.

  Real GPU atlas corruption can't be reproduced in a headless (software-GL) browser,
  so this asserts the RECOVERY MECHANISM fires: on a same-geometry show (a sub-tab
  switch — cols/rows unchanged, the exact escape hatch), the WebGL renderer's texture
  atlas is rebuilt. Red on the unfixed path (no rebuild on the per-tile show → the
  probe never fires), green with the fix.

  Background:
    Given the terminal is ready

  Scenario: Switching back to a hidden sub-terminal rebuilds its glyph atlas
    When I click the settings button
    Then the settings popover should be visible
    When I click the "webgl" renderer button
    Then the terminal renderer should be "webgl"
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    When I arm the WebGL atlas-rebuild probe
    And I click sub-panel tab 1
    Then the shown sub-terminal's WebGL atlas is rebuilt

  # The rebuild must run only AFTER layout has flushed. A rebuild forced while the tile
  # still measures 0×0 (a single rAF that beat the display:none→visible reflow) is a
  # NO-OP — clearTextureAtlas re-warms nothing at zero size, so the whole tile stays
  # stale until streaming heals it top-down. The guard retries per frame until
  # offsetWidth/Height > 0, THEN rebuilds. This forces the 0×0 window deterministically
  # (pin the pane to zero size across the switch) and proves the rebuild is deferred
  # until real size returns. RED on the guardless path (the single rAF fires at 0×0 →
  # the probe trips while zero-sized), GREEN with the guard (deferred to real size).
  Scenario: The on-show atlas rebuild waits until the tile has real size
    When I click the settings button
    Then the settings popover should be visible
    When I click the "webgl" renderer button
    Then the terminal renderer should be "webgl"
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    When I arm the WebGL atlas-rebuild probe
    And I force sub-terminals to zero size
    And I click sub-panel tab 1
    Then the WebGL atlas is not rebuilt while the tile is zero size
    When I restore sub-terminal size
    Then the shown sub-terminal's WebGL atlas is rebuilt
