@mobile
Feature: Mobile terminal touch-scroll
  On coarse-pointer devices, swiping vertically inside the terminal
  viewport should scroll the xterm scrollback buffer. xterm.js 6.0.0
  ships type declarations for IViewport touch handling without an
  implementation, and the WebGL canvas eats touch events on the way
  to the parent scrollable div — so a hand-rolled touchstart/touchmove
  bridge calls terminal.scrollLines() based on the cell-height
  conversion of the swipe delta.

  Background:
    Given the terminal is ready

  Scenario: Touch-swiping down inside the terminal scrolls the scrollback up
    When I run "seq 1 200"
    And I note the terminal viewport scroll position
    And I swipe down inside the terminal viewport
    Then the terminal viewport scroll position should have decreased
