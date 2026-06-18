Feature: Canvas terminal text selection under zoom
  Mouse text selection must land on the cell under the pointer even when the
  canvas tile is zoomed. Canvas tiles render xterm inside a CSS scale(zoom)
  transform; xterm hit-tests selection with a transform-inclusive bounding
  rect but an *untransformed* cell size, so a zoomed tile offsets the
  selection by the zoom factor — in both axes, and growing with distance from
  the tile origin (#1400).

  The marker is a tall block of rows, each 30 "L" cells then 30 "R" cells. We
  zoom in, then drag-select a span that *visually* sits entirely in the "L"
  half (pixels derived from the post-transform .xterm-screen rect — the same
  transform-correct mapping a user perceives and that kolu's own touch
  hit-testing uses). With correct hit-testing the selection is all "L"; with
  the zoom offset those same pixels resolve to "R" columns (one row down,
  still inside the block).

  Background:
    Given the terminal is ready

  Scenario: Drag-selecting in a zoomed canvas tile selects the cells under the pointer
    When I print a marker block in the terminal
    And I zoom the canvas in toward the marker block
    And I drag-select a visual span in the left half of the marker block
    Then the terminal selection should contain only left-half characters
    And there should be no page errors
