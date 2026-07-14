Feature: WebGL context-loss recovery
  Chrome caps live WebGL contexts per tab (~16); a busy split + maximized workspace
  overflows it and Chrome evicts a LIVE tile's context. The eviction takes the
  glyph-atlas GPU texture with it, but xterm's WebglRenderer keeps drawing to the
  now-stale atlas coordinates — BOTCHED GLYPHS that clear only on re-rasterization
  (selecting text, or a reload). This is a longstanding latent gap (Linux always
  showed it sporadically; macOS clustered under load), NOT introduced by the
  #1795/#1808 xterm-kit graduation, which was behavior-neutral here.

  A headless browser can't reproduce a real GPU eviction, so this drives the exact
  browser signals one produces — webglcontextlost then webglcontextrestored, via the
  WEBGL_lose_context extension — on the focused WebGL terminal, and verifies the kit
  re-initializes the renderer against a fresh, live context (so glyphs re-rasterize
  into a new atlas) instead of leaving the corrupted one on screen.

  Background:
    Given the terminal is ready

  Scenario: A restored WebGL context re-initializes the renderer onto a fresh context
    When I click the settings button
    Then the settings popover should be visible
    When I click the "webgl" renderer button
    Then the terminal renderer should be "webgl"
    When the focused terminal's WebGL context is lost and restored
    Then the focused terminal re-initializes its WebGL renderer on a fresh, live context
    And there should be no page errors
