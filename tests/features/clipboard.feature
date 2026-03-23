Feature: Clipboard image paste
  Verify that the server-side clipboard shims serve browser-uploaded images
  so Claude Code's Ctrl+V image paste works through the web terminal.

  Background:
    Given the terminal is ready

  Scenario: xclip shim reports image after pasteImage RPC
    When I upload a test image to the active terminal
    And I run "xclip -selection clipboard -t TARGETS -o"
    Then the screen state should contain "image/png"

  Scenario: xclip shim serves image data after pasteImage RPC
    When I upload a test image to the active terminal
    And I run "xclip -selection clipboard -t image/png -o | wc -c"
    Then the screen state should contain "4"

  Scenario: wl-paste shim lists image type after pasteImage RPC
    When I upload a test image to the active terminal
    And I run "wl-paste -l"
    Then the screen state should contain "image/png"

  Scenario: wl-paste shim serves image data after pasteImage RPC
    When I upload a test image to the active terminal
    And I run "wl-paste --type image/png | wc -c"
    Then the screen state should contain "4"

  Scenario: xclip shim exits non-zero with no image
    And I run "xclip -selection clipboard -t TARGETS -o; echo exit:$?"
    Then the screen state should contain "exit:1"

  Scenario: wl-paste shim exits non-zero with no image
    And I run "wl-paste -l; echo exit:$?"
    Then the screen state should contain "exit:1"
