Feature: Clipboard image paste
  Verify the full browser-to-PTY image paste flow: an image placed in the
  browser clipboard, Ctrl+V in the terminal, and the server-side shim
  scripts (xclip, wl-paste) serving the uploaded image data.

  Background:
    Given the terminal is ready

  Scenario: Ctrl+V with clipboard image uploads to shim and xclip reads it
    When I place an image in the browser clipboard
    And I press Ctrl+V in the terminal
    And I run "xclip -selection clipboard -t TARGETS -o"
    Then the screen state should contain "image/png"

  Scenario: Ctrl+V with clipboard image makes xclip serve the image bytes
    When I place an image in the browser clipboard
    And I press Ctrl+V in the terminal
    And I run "test $(xclip -selection clipboard -t image/png -o | wc -c) -gt 0 && echo ok"
    Then the screen state should contain "ok"

  Scenario: Ctrl+V with clipboard image uploads to shim and wl-paste reads it
    When I place an image in the browser clipboard
    And I press Ctrl+V in the terminal
    And I run "wl-paste -l"
    Then the screen state should contain "image/png"

  Scenario: Ctrl+V with clipboard image makes wl-paste serve the image bytes
    When I place an image in the browser clipboard
    And I press Ctrl+V in the terminal
    And I run "test $(wl-paste --type image/png | wc -c) -gt 0 && echo ok"
    Then the screen state should contain "ok"

  Scenario: xclip shim exits non-zero with no image
    When I run "xclip -selection clipboard -t TARGETS -o; echo exit:$?"
    Then the screen state should contain "exit:1"

  Scenario: wl-paste shim exits non-zero with no image
    When I run "wl-paste -l; echo exit:$?"
    Then the screen state should contain "exit:1"
