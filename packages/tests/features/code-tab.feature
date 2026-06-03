Feature: Code tab (review + browse)
  The Code tab is one Pierre file tree with three modes:
    - All (browse)   — full repo, file content on selection
    - Local          — working tree vs HEAD, diff on selection
    - Branch         — working tree vs merge-base(origin/<default>), diff on selection
  The tree, diff viewer, and file viewer are all owned by `@pierre/trees`
  and `@pierre/diffs` (PR #708). This feature exercises the data flow,
  selection, mode transitions, and the right-click affordances the Pierre
  wrappers expose to copy paths and line refs.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  # ── Tab presence + chrome ──

  Scenario: Code tab is present and switchable
    When I click the Code tab
    Then the Code tab should be active

  Scenario: Shows "not a git repo" message outside a repo
    When I run "cd /tmp"
    And I click the Code tab
    Then the Code tab should indicate no git repository

  Scenario: Shows "no changes" when the repo is clean
    When I run "git init /tmp/kolu-review-clean && cd /tmp/kolu-review-clean"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    Then the Code tab should show the empty-changes message

  # ── Mode picker ──

  Scenario: Mode toggle defaults to Local
    When I run "git init /tmp/kolu-review-toggle && cd /tmp/kolu-review-toggle"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    Then the Code tab mode should be "local"

  Scenario: Code tab mode survives panel close and reopen
    When I run "git init /tmp/kolu-review-mode-persist && cd /tmp/kolu-review-mode-persist"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the Code tab mode should be "browse"

  # ── Regression suites for #817/#818 ──
  # Each invariant runs in all three Code-tab modes (local, branch,
  # browse) via `Scenario Outline` + an `Examples` row per mode. The
  # mode-parameterized harness lives in `code_tab_steps.ts` (search for
  # "Mode-parameterized helpers"):
  #
  #   Given a Code tab in "<mode>" mode showing file "..." with content "..."
  #   When  I open file "..." in the Code tab
  #   Then  the selected file should show content "..."
  #   Then  the Code tab should [not] show file "..."
  #
  # The shell setup, mode-chip click, and view-vs-diff dispatch are all
  # hidden behind these polymorphic steps. Adding a fourth Code-tab
  # regression test means writing one Outline plus three Examples rows;
  # the per-mode coverage is automatic. Don't fall back to hand-written
  # `[local]` / `[branch]` / `[browse]` scenarios — that's how the
  # `view()` `"local"` fallback bug shipped past the first round of
  # tests.

  # Regression for #818: collapsing and reopening the right panel used
  # to unmount RightPanel via `<Show when={!collapsed()}>`, discarding
  # CodeTab's selectedPath signal. Resizable already shrinks the panel
  # to zero width on collapse — keeping it mounted preserves selection.
  Scenario Outline: Selected file survives panel collapse and reopen [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # Regression for #818: switching to Inspector and back used to unmount
  # CodeTab via `match(activeTab())`, discarding selectedPath. Both tabs
  # are now always rendered with `display:none` toggling visibility.
  Scenario Outline: Selected file survives Inspector tab switch [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I click the right panel tab "inspector"
    And I click the right panel tab "code"
    Then the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # Regression for #919's per-slot design under multi-terminal switching.
  # Each terminal carries its own `repoRoot` via `props.meta?.git`; the
  # `selectedFilesByKey` record is keyed by (repoRoot, view) and shared
  # across terminals through localStorage, so switching the active
  # terminal reactively rebinds `slotKey` and surfaces the right slot's
  # pick without one terminal clobbering the other.
  Scenario Outline: Selected file survives switching to another terminal and back [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I create a terminal
    And I run "rm -rf /tmp/kolu-codetab-otherdir && mkdir -p /tmp/kolu-codetab-otherdir && cd /tmp/kolu-codetab-otherdir"
    And I select workspace switcher entry 1
    Then the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # Same-filename variant: both terminals are in valid git repos, and both
  # have a file at the same relative path selected. The outer
  # `<Show when={repoPath()}>` therefore stays in the truthy branch and
  # cannot mask staleness via remount — the preview must follow
  # `props.meta` reactively, so the displayed content has to flip between
  # "from-A" and "from-B" as the active terminal changes.
  Scenario: Browse preview follows the active terminal when two repos pick the same filename
    Given a Code tab in "browse" mode showing file "shared.txt" with content "from-A"
    When I open file "shared.txt" in the Code tab
    Then the selected file should show content "from-A"
    When I create a terminal
    Given a Code tab in "browse" mode showing file "shared.txt" with content "from-B"
    When I open file "shared.txt" in the Code tab
    Then the selected file should show content "from-B"
    When I select workspace switcher entry 1
    Then the selected file should show content "from-A"
    When I select workspace switcher entry 2
    Then the selected file should show content "from-B"

  # Regression: with two terminals in different repos and DIFFERENT
  # filenames selected in browse mode, switching back and forth used to
  # silently delete the original slot from `selectedFilesByKey`
  # mid-transition. Root cause: the "selected file no longer in tree"
  # effect read `treePaths()` from the shared `fsListAll` store before
  # the slot change had propagated through `createReactiveSubscription`'s
  # reset, so the new slot's selection was checked against the previous
  # slot's paths. Same-filename selections accidentally masked the bug
  # because the membership check still succeeded against the stale tree.
  # The bug is a reactive race so the round-trip is exercised three times
  # to make the test consistently red without the fix.
  Scenario: Browse preview survives terminal switch when filenames differ across repos
    Given a Code tab in "browse" mode showing file "file-a.txt" with content "AAAA"
    When I open file "file-a.txt" in the Code tab
    Then the selected file should show content "AAAA"
    When I create a terminal
    Given a Code tab in "browse" mode showing file "file-b.txt" with content "BBBB"
    When I open file "file-b.txt" in the Code tab
    Then the selected file should show content "BBBB"
    When I select workspace switcher entry 1
    Then the selected file should show content "AAAA"
    When I select workspace switcher entry 2
    Then the selected file should show content "BBBB"
    When I select workspace switcher entry 1
    Then the selected file should show content "AAAA"
    When I select workspace switcher entry 2
    Then the selected file should show content "BBBB"
    When I select workspace switcher entry 1
    Then the selected file should show content "AAAA"

  # Regression: opening a file in the Code tab and refreshing the browser
  # used to lose the preview because `selectedPath` lived in a local
  # `createSignal` that died with the component. Selection is now backed
  # by `makePersisted` keyed per (repoRoot, view) so each slot's pick
  # survives a full reload AND switching modes/repos surfaces the right
  # slot without clobbering siblings.
  Scenario Outline: Selected file survives page refresh [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I wait for the session auto-save
    And I reload the page and wait for ready
    Then the right panel should be visible
    And the Code tab mode should be "<mode>"
    And the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # ── Local mode: file list + diff rendering ──

  Scenario: Lists changed files and opens a diff on click
    When I run "git init /tmp/kolu-review-dirty && cd /tmp/kolu-review-dirty"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\n' > note.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Code tab
    Then the Code tab should render a diff view

  # Regression for #817: Pierre's row-click handler unconditionally calls
  # `controller.closeSearch()` after firing selection (verified at
  # @pierre/trees/dist/render/FileTreeView.js around the row-click plan,
  # where `closeSearch: isSearchOpen` is hardcoded). The solid-pierre
  # wrapper re-applies the host's `searchQuery` on the next microtask so
  # the host-controlled filter survives clicks. Re-click step covers
  # Pierre's selectionVersion gate that suppresses `onSelectionChange`
  # but still runs `closeSearch()`.
  Scenario Outline: Filter survives clicking a filtered result [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path      | content |
      | alpha.txt | a       |
      | beta.txt  | b       |
      | gamma.txt | g       |
    Then the Code tab should show file "alpha.txt"
    And the Code tab should show file "beta.txt"
    When I type "alp" into the Code tab filter
    Then the Code tab should show file "alpha.txt"
    And the Code tab should not show file "beta.txt"
    And the Code tab should not show file "gamma.txt"
    When I open file "alpha.txt" in the Code tab
    Then the selected file should show content "a"
    And the Code tab filter input should contain "alp"
    And the Code tab should show file "alpha.txt"
    And the Code tab should not show file "beta.txt"
    And the Code tab should not show file "gamma.txt"
    When I open file "alpha.txt" in the Code tab
    Then the Code tab filter input should contain "alp"
    And the Code tab should show file "alpha.txt"
    And the Code tab should not show file "beta.txt"
    And the Code tab should not show file "gamma.txt"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # Regression: folder-chevron clicks did nothing while a filter was
  # active because Pierre's `hide-non-matches` controller re-expands
  # every match ancestor on each store event. Fix: filter on Kolu's side
  # (`fileSearch.ts`) so Pierre never sees the query, and ask the
  # wrapper to ensure match ancestors are expanded via `expandPaths`.
  # The user can now collapse a folder freely, and the filter stays
  # active until they explicitly change it.
  Scenario Outline: Folder collapse during active filter persists the filter [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path              | content |
      | src/alpha-one.txt | a1      |
      | src/alpha-two.txt | a2      |
      | other.txt         | o       |
    When I type "alpha" into the Code tab filter
    Then the Code tab should show file "src/alpha-one.txt"
    And the Code tab should show file "src/alpha-two.txt"
    And the Code tab should not show file "other.txt"
    When I click the directory node "src" in the Code tab
    Then the Code tab should not show file "src/alpha-one.txt"
    And the Code tab should not show file "src/alpha-two.txt"
    And the Code tab filter input should contain "alpha"
    And the Code tab should not show file "other.txt"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario Outline: Filter matches files by path tokens [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path                          | content |
      | common/src/index.tsx          | common  |
      | common/src/components/App.tsx | app     |
      | packages/client/src/index.tsx | client  |
    When I type "common index.ts" into the Code tab filter
    Then the Code tab should show file "common/src/index.tsx"
    And the Code tab should not show file "common/src/components/App.tsx"
    And the Code tab should not show file "packages/client/src/index.tsx"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # Regression: Pierre's `remove` promotes an emptied directory to an
  # "explicit empty folder", so a directory whose files were all filtered
  # out kept a hollow, result-less row in the tree. The fix
  # (`directoryRemovalOps` in solid-pierre's `pathReconcile.ts`, applied in
  # `FileTree.tsx`) prunes any directory that is no longer an ancestor of a
  # matching file. After filtering, a directory that still contains a match
  # stays; a directory whose only files were excluded disappears.
  Scenario Outline: Filter prunes directories with no matching files [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path                | content |
      | docs/keep.md        | keep    |
      | docs/plans/note.md  | note    |
      | widgets/list/a.ts   | a       |
      | widgets/forms/b.ts  | b       |
    When I type "docs keep" into the Code tab filter
    Then the Code tab should show file "docs/keep.md"
    And the Code tab should show a directory node "docs"
    And the Code tab should not show file "widgets/list/a.ts"
    And the Code tab should not show a directory node "widgets"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario: Untracked files appear alongside modified tracked files
    When I run "git init /tmp/kolu-review-untracked && cd /tmp/kolu-review-untracked"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'initial\n' > tracked.txt && git add tracked.txt && git commit -m 'add tracked'"
    And I run "printf 'modified\n' > tracked.txt"
    And I run "printf 'new\n' > untracked.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "tracked.txt"
    And the Code tab should list a changed file "untracked.txt"

  # ── Pierre tree behaviour: directory grouping + collapse ──

  Scenario: Groups files into a directory tree
    When I run "git init /tmp/kolu-review-tree && cd /tmp/kolu-review-tree"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/components && printf 'a\n' > src/index.ts && printf 'b\n' > src/components/Button.tsx"
    And I click the Code tab
    Then the Code tab should show a directory node "src"
    And the Code tab should list a changed file "src/index.ts"
    And the Code tab should list a changed file "src/components/Button.tsx"

  Scenario: Collapsing a directory hides its children
    When I run "git init /tmp/kolu-review-collapse && cd /tmp/kolu-review-collapse"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p pkg && printf 'x\n' > pkg/a.ts && printf 'y\n' > pkg/b.ts"
    And I click the Code tab
    Then the Code tab should list a changed file "pkg/a.ts"
    When I click the directory node "pkg" in the Code tab
    Then the Code tab should not list a changed file "pkg/a.ts"
    When I click the directory node "pkg" in the Code tab
    Then the Code tab should list a changed file "pkg/a.ts"

  # ── Pierre tree right-click menu (Copy path) ──

  Scenario: Right-click on a changed file copies its path
    When I run "git init /tmp/kolu-tree-ctx && cd /tmp/kolu-tree-ctx"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p api && printf 'q\n' > api/handler.ts"
    And I click the Code tab
    Then the Code tab should list a changed file "api/handler.ts"
    When I right-click the changed file "api/handler.ts" in the Code tab
    And I click the context menu item "Copy path"
    Then the clipboard should contain "api/handler.ts"

  # ── Browse mode: file tree + content viewer ──

  Scenario: File browser shows the repo file tree
    When I run "git init /tmp/kolu-browse-tree && cd /tmp/kolu-browse-tree"
    And I run "mkdir -p src && printf 'a\n' > README.md && printf 'b\n' > src/index.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    And the file browser should show a directory "src"
    And the file browser should show a file "README.md"

  Scenario: File browser shows file content on click
    When I run "git init /tmp/kolu-browse-content && cd /tmp/kolu-browse-content"
    And I run "printf 'hello world\n' > greeting.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "greeting.txt" in the file browser
    Then the file content should contain "hello world"

  Scenario: File browser wraps long lines by default
    When I run "git init /tmp/kolu-browse-wrap && cd /tmp/kolu-browse-wrap"
    And I run "printf 'prefix-' > long.txt && printf '%*s' 240 '' | tr ' ' x >> long.txt && printf '\n' >> long.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "long.txt" in the file browser
    Then the file content should contain "prefix-"
    And the file content should wrap long lines

  # ── Browse mode: route-served preview for .html / .svg / .pdf / images ──
  # Files whose extension matches `isBinaryPreviewable` (see
  # `kolu-git/previewable`) render in `BrowsePreviewView` from the per-terminal
  # file route instead of Pierre's syntax-highlighted `FileView`. The wire kind
  # (`FsReadFileOutput.kind`) only says "binary"; the client then renders raster
  # images (`isRasterImage`) with a plain `<img>` and documents in a sandboxed
  # `<iframe>`.

  Scenario: HTML file renders in an iframe instead of as code
    When I run "rm -rf /tmp/kolu-iframe-html && git init /tmp/kolu-iframe-html && cd /tmp/kolu-iframe-html"
    And I run "printf '<!doctype html><h1>preview</h1>\n' > page.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "page.html" in the file browser
    Then the file preview iframe should be visible

  Scenario: SVG file renders in the iframe preview
    When I run "rm -rf /tmp/kolu-iframe-svg && git init /tmp/kolu-iframe-svg && cd /tmp/kolu-iframe-svg"
    And I run "printf '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>\n' > logo.svg"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "logo.svg" in the file browser
    Then the file preview iframe should be visible

  Scenario: PNG image renders as an <img> preview, not an iframe
    When I run "rm -rf /tmp/kolu-img-png && git init /tmp/kolu-img-png && cd /tmp/kolu-img-png"
    And I run "printf 'PNG\0fake\1\2\3\4' > icon.png"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "icon.png" in the file browser
    Then the file preview image should be visible
    And the file preview iframe should not be visible

  Scenario: Plain text file still renders as syntax-highlighted code (no iframe)
    When I run "rm -rf /tmp/kolu-iframe-text && git init /tmp/kolu-iframe-text && cd /tmp/kolu-iframe-text"
    And I run "printf 'hello\n' > note.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "note.txt" in the file browser
    Then the file content should contain "hello"
    And the file preview iframe should not be visible

  # ── Browse mode: Markdown renders client-side with a Source ⇄ Rendered toggle ──
  # Unlike .html/.svg/.pdf (route-served, kind:"binary"), a .md file stays
  # kind:"text" on the wire — the client renders it from `content` via
  # `@kolu/solid-markdown`. Because it carries *both* a source and a rendered
  # form, FileView shows the Source ⇄ Rendered toggle, defaulting to rendered.

  Scenario: Markdown renders as a document by default, with a Source/Rendered toggle
    When I run "rm -rf /tmp/kolu-md-doc && git init /tmp/kolu-md-doc && cd /tmp/kolu-md-doc"
    And I run "printf '# Hello Doc\n\nRendered body text.\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Hello Doc"
    And the file view toggle should be visible
    And the file preview iframe should not be visible

  # Regression: a >1 MB .md file is read back truncated (first 1 MB only). It
  # still defaults to the rendered view, so the rendered appliance must carry
  # the same "File truncated" banner the source view shows — otherwise a partial
  # document renders silently with no warning. The marker sits in the first
  # bytes so it survives the 1 MB cut and proves content rendered.
  Scenario: Truncated Markdown still warns in the rendered view
    When I run "rm -rf /tmp/kolu-md-trunc && git init /tmp/kolu-md-trunc && cd /tmp/kolu-md-trunc"
    And I run "printf '# Truncated Doc\n\nbody marker\n\n' > big.md && head -c 1100000 /dev/zero | tr '\0' 'x' >> big.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "big.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Truncated Doc"
    And the markdown preview should show the truncation warning

  Scenario: Markdown source toggle reveals the raw markdown
    When I run "rm -rf /tmp/kolu-md-src && git init /tmp/kolu-md-src && cd /tmp/kolu-md-src"
    And I run "printf '# Heading One\n\nbody text\n' > notes.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "notes.md" in the file browser
    Then the markdown preview should be visible
    When I switch the file view to "source"
    Then the file content should contain "# Heading One"
    And the markdown preview should not be visible

  # ── Rendered Markdown: GFM + inline HTML + sanitization ──
  # The rendered view is a marked(GFM) → DOMPurify pipeline
  # (@kolu/solid-markdown), so it must produce real GitHub-Flavored structure —
  # headings, tables, task lists — plus the inline HTML a README leans on
  # (<kbd>, alignment wrappers), while stripping anything script-capable. The
  # `printf` fixtures avoid inner single quotes (the `I run` step has no escape
  # for them); `<script>`/`align=center`/`javascript:` carry none.

  Scenario: Markdown preview renders GFM tables, task lists, and inline HTML
    When I run "rm -rf /tmp/kolu-md-gfm && git init /tmp/kolu-md-gfm && cd /tmp/kolu-md-gfm"
    And I run "printf '# Doc Title\n\n| Col A | Col B |\n|:------|------:|\n| 1 | 2 |\n\n- [x] shipped\n- [ ] pending\n\nPress <kbd>Ctrl</kbd> to go.\n\n<p align=center>centered note</p>\n\n<img src=docs/logo.png alt=brand-logo />\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "h1" element
    And the markdown preview should contain "Doc Title"
    And the markdown preview should render a "table" element
    And the markdown preview should contain "Col A"
    And the markdown preview should render a "input[type=checkbox]" element
    And the markdown preview should render a "kbd" element
    And the markdown preview should render a "[align=center]" element
    And the markdown preview should contain "centered note"
    # A repo-relative image can't load here, so it degrades to a labelled
    # chip (its alt text) rather than a broken-image icon — markdown `![]()`
    # and inline `<img>` alike.
    And the markdown preview should not render a "img" element
    And the markdown preview should contain "brand-logo"

  Scenario: Markdown preview strips script-capable HTML and links
    When I run "rm -rf /tmp/kolu-md-xss && git init /tmp/kolu-md-xss && cd /tmp/kolu-md-xss"
    And I run "printf '# Safe Render\n\nintro paragraph here\n\n<script>window.__xss=1</script>\n\n[evil link](javascript:window.__xss=2)\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Safe Render"
    And the markdown preview should contain "evil link"
    And the markdown preview should not render a "script" element
    And the markdown preview should not render a "a[href^=javascript]" element

  # The sanitizer is a tight allowlist, not DOMPurify's broad defaults: inline
  # `style`/`class`, SVG, and non-checkbox form controls must all be dropped so
  # an untrusted README can't restyle, frame, or plant focusable controls in
  # the app. (`printf` fixtures avoid inner single quotes — see note above.)
  Scenario: Markdown preview drops style, class, SVG, and form controls
    When I run "rm -rf /tmp/kolu-md-tight && git init /tmp/kolu-md-tight && cd /tmp/kolu-md-tight"
    And I run "printf '# Tight Allowlist\n\n<p style=color:red class=takeover>styled para</p>\n\n<svg width=10 height=10><rect width=10 height=10 /></svg>\n\n<button>press me</button>\n\n<input type=text value=injected />\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "styled para"
    # The text survives but its presentational + structural escape hatches don't.
    And the markdown preview should not render a "[style]" element
    And the markdown preview should not render a ".takeover" element
    And the markdown preview should not render a "svg" element
    And the markdown preview should not render a "button" element
    And the markdown preview should not render a "input[type=text]" element

  # The renderer only stamps the anchors it mints; a raw inline `<a>` from the
  # README must still pick up the link policy in the sanitize pass — a safe
  # relative href survives but is forced to open in a new tab (so it can't
  # navigate the Kolu tab itself), and an unsafe scheme is unwrapped to text.
  Scenario: Markdown preview applies the link policy to raw inline anchors
    When I run "rm -rf /tmp/kolu-md-rawa && git init /tmp/kolu-md-rawa && cd /tmp/kolu-md-rawa"
    And I run "printf '# Raw Anchors\n\n<a href=docs/guide.md>relative doc</a>\n\n<a href=javascript:1>raw evil</a>\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "relative doc"
    And the markdown preview should contain "raw evil"
    # Safe relative anchor kept, but forced to a new tab with a severed opener.
    And the markdown preview should render a "a[target=_blank]" element
    And the markdown preview should render a "a[rel~=noopener]" element
    # The unsafe-scheme anchor is gone; its text remains.
    And the markdown preview should not render a "a[href^=javascript]" element

  # ── Tree/content vertical split is draggable ──
  # The tree pane used to be a fixed `h-[35%]`; it's now a Corvu Resizable
  # panel keyed off `preferences.rightPanel.codeTabTreeSize`. The handle
  # presence is the wiring proof — persistence rides on the same
  # `updatePreferences` infra the horizontal split already covers in
  # `right-panel.feature`.

  Scenario: Tree/content split has a draggable handle
    When I run "rm -rf /tmp/kolu-tree-resize && git init /tmp/kolu-tree-resize && cd /tmp/kolu-tree-resize"
    And I run "printf 'hello\n' > note.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab tree pane split handle should be visible

  Scenario: File browser expands directories lazily
    When I run "git init /tmp/kolu-browse-expand && cd /tmp/kolu-browse-expand"
    And I run "mkdir -p lib && printf 'x\n' > lib/util.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the file browser should show a directory "lib"
    When I click the directory "lib" in the file browser
    Then the file browser should show a file "lib/util.ts"

  # Regression: expanding several directories and then clicking a file to
  # preview it used to collapse every directory that wasn't an ancestor of
  # the clicked file. Selection drove a full `resetPaths` in the Pierre
  # wrapper, rebuilding the tree with only the search-projected and
  # selected-ancestor directories open — so manually-expanded siblings lost
  # their state. Selection now expands the picked file's ancestors
  # imperatively and leaves every other open directory untouched.
  Scenario: File browser preserves sibling expansion when previewing a file
    When I run "git init /tmp/kolu-browse-keep && cd /tmp/kolu-browse-keep"
    And I run "mkdir -p alpha beta && printf 'a1\n' > alpha/a1.txt && printf 'a2\n' > alpha/a2.txt && printf 'b1\n' > beta/b1.txt && printf 'b2\n' > beta/b2.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "alpha" in the file browser
    Then the file browser should show a file "alpha/a1.txt"
    When I click the directory "beta" in the file browser
    Then the file browser should show a file "beta/b1.txt"
    When I click the file "beta/b1.txt" in the file browser
    Then the file "beta/b1.txt" should be selected in the file browser
    And the file browser should show a file "alpha/a1.txt"

  # Regression: applying then clearing the filter rebuilds the tree via
  # `resetPaths`, which reopens only the directories it's handed. Clearing the
  # filter hands it no ancestors (the query is empty), so without carrying the
  # prior expansion forward the rebuild collapses every folder the user opened
  # by hand. The wrapper now snapshots the open directories before each rebuild
  # and re-applies them, so a folder that stays in view across the filter dance
  # keeps its expansion. (A folder filtered entirely out of view — `beta` here —
  # legitimately folds away; Pierre drops it from the projection.)
  Scenario: File browser keeps a folder expanded across a filter and clear
    When I run "git init /tmp/kolu-browse-filter && cd /tmp/kolu-browse-filter"
    And I run "mkdir -p alpha beta && printf 'a1\n' > alpha/a1.txt && printf 'a2\n' > alpha/a2.txt && printf 'b1\n' > beta/b1.txt && printf 'b2\n' > beta/b2.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "alpha" in the file browser
    Then the file browser should show a file "alpha/a1.txt"
    When I click the directory "beta" in the file browser
    Then the file browser should show a file "beta/b1.txt"
    When I type "a1" into the Code tab filter
    Then the file browser should show a file "alpha/a1.txt"
    And the file browser should not show a file "beta/b1.txt"
    When I type "" into the Code tab filter
    Then the file browser should show a file "alpha/a1.txt"
    And the file browser should show a file "alpha/a2.txt"

  # ── Pierre file/diff viewer right-click menu (Copy path:line) ──

  Scenario: Right-click on a file content line copies "path:line"
    When I run "git init /tmp/kolu-browse-ctx && cd /tmp/kolu-browse-ctx"
    And I run "printf 'alpha\nbeta\ngamma\n' > letters.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "letters.txt" in the file browser
    Then the file content should contain "beta"
    When I right-click line 2 in the file content
    And I click the context menu item "Copy letters.txt:2"
    Then the clipboard should contain "letters.txt:2"

  # Regression: switching diff files used to break the "Copy path:line"
  # context-menu entry. Two interleaved causes — first, a `<Match>` callback
  # in CodeTab captured `selectedPath()` to a `const`, freezing the path
  # prop fed into `<PierreDiffView>`. Second, even after the path was made
  # reactive, Pierre's `FileDiff.render(newFileDiff)` reuses the same
  # instance and its line-selection handlers don't re-bind to the fresh
  # gutter elements — so right-clicks on the second file's lines yielded a
  # menu with no "Copy path:line" entry at all (range stayed null because
  # no `onLineSelected` ever fired). Fix: key the diff/browse subtree on
  # path so each file gets a fresh `FileDiff` and a clean
  # `useLineSelection` range.
  Scenario: Switching diff files keeps the "Copy path:line" entry in sync
    When I run "git init /tmp/kolu-diff-multifile && cd /tmp/kolu-diff-multifile"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'a-one\na-two\na-three\n' > file-a.txt"
    And I run "printf 'b-one\nb-two\nb-three\n' > file-b.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "file-a.txt"
    And the Code tab should list a changed file "file-b.txt"
    When I click the changed file "file-a.txt" in the Code tab
    Then the diff view should contain "a-one"
    When I right-click line 1 in the diff view
    And I click the context menu item "Copy file-a.txt:1"
    Then the clipboard should contain "file-a.txt:1"
    When I click the changed file "file-b.txt" in the Code tab
    Then the diff view should contain "b-one"
    When I right-click line 1 in the diff view
    Then the context menu items should be "Copy path | Copy file-b.txt:1 | Open file-b.txt:1"
    When I click the context menu item "Copy file-b.txt:1"
    Then the clipboard should contain "file-b.txt:1"
    And the clipboard should not contain "file-a.txt"

  # ── Right-click "Open" jumps from diff to full file (#881 phase 0) ──
  # Reviewing a diff and wanting full-file context at the same line was
  # previously two manual steps: copy `path:N`, switch to browse mode,
  # paste-navigate. The "Open path:N" context-menu entry dispatches via
  # the same `openInCodeTab` front door the terminal-link click uses.
  Scenario: Right-click "Open path:N" in diff view jumps to browse at that line
    When I run "git init /tmp/kolu-open-from-diff && cd /tmp/kolu-open-from-diff"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p docs && printf 'first\nsecond\nthird\n' > docs/notes.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "docs/notes.txt"
    When I click the changed file "docs/notes.txt" in the Code tab
    Then the diff view should contain "second"
    When I right-click line 2 in the diff view
    And I click the context menu item "Open docs/notes.txt:2"
    Then the Code tab mode should be "browse"
    And the selected file should show content "second"
    And line 2 should be selected in the file content
    And the file browser should show a file "docs/notes.txt"
    And the file "docs/notes.txt" should be selected in the file browser

  # ── Live updates: filesystem changes propagate without manual refresh ──
  # The Code view subscribes to a watcher that observes four axes (HEAD,
  # reflog, index, working tree) and pushes snapshot updates whenever any
  # changes. These two scenarios open the tab on a selected file, mutate
  # the file from the shell, and assert the new content reaches the diff
  # body and the browse body — no click on a refresh button (it's gone).
  #
  # The post-tab `I click the terminal canvas` is required: clicking the
  # right-panel tab moves focus off the terminal, so subsequent keystrokes
  # would land in the panel instead of the PTY.

  # ── Binary file diffs (#810) ──
  # git classifies a file as binary when it sees NUL bytes in the first
  # ~8KB and emits `Binary files a/x and b/x differ` instead of @@ hunks.
  # Without a placeholder the diff pane is empty and indistinguishable
  # from "no file selected". The server now sets `binary: true` on the
  # diff response so the client renders a "Binary file — not displayable"
  # panel. Scenarios cover three distinct user-visible paths: binary
  # file selected, text file selected, and the binary→text streaming
  # flip from #786.

  Scenario: Binary file shows the "not displayable" placeholder
    When I run "rm -rf /tmp/kolu-binary-diff && git init /tmp/kolu-binary-diff && cd /tmp/kolu-binary-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'PNG\0fake\1\2' > image.png"
    And I click the Code tab
    Then the Code tab should list a changed file "image.png"
    When I click the changed file "image.png" in the Code tab
    Then the Code tab should show the binary placeholder

  Scenario: Text file does not show the binary placeholder
    When I run "rm -rf /tmp/kolu-text-diff && git init /tmp/kolu-text-diff && cd /tmp/kolu-text-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\nworld\n' > note.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Code tab
    Then the Code tab should render a diff view
    And the Code tab should not show the binary placeholder

  # Regression: binary + rename satisfies both predicates. Rationale for
  # picking binary over rename lives at the `renamedDiff` memo guard.
  # Needs an actual content edit on the renamed file — git only emits the
  # `Binary files ... differ` marker when there's a content delta; a pure
  # rename of binary content (similarity 100%) emits only the rename
  # header, with nothing for the regex to match against.
  Scenario: Binary rename with content change shows the binary placeholder
    When I run "rm -rf /tmp/kolu-binary-rename && git init /tmp/kolu-binary-rename && cd /tmp/kolu-binary-rename"
    And I run "printf 'PNG\0fake\1\2\3\4\5\6\7\10\11\12\13\14\15\16\17' > old.png"
    And I run "git add old.png && git commit -m 'add binary'"
    And I run "git mv old.png new.png"
    And I run "printf 'PNG\0fake\1\2\3\4\5\6\7\10\11\12\13\14\15\16\17modified' > new.png"
    And I click the Code tab
    Then the Code tab should list a changed file "new.png"
    When I click the changed file "new.png" in the Code tab
    Then the Code tab should show the binary placeholder

  # Regression for #810 + #786: a file transitioning from binary to text
  # via live updates must flip the placeholder off (and vice versa). The
  # streaming endpoint re-emits `binary` on every diff change; without it
  # in `gitDiffOutputEqual`, the snapshot dedupe would suppress the flip.
  Scenario: Binary placeholder flips off when the file becomes text
    When I run "rm -rf /tmp/kolu-binary-flip && git init /tmp/kolu-binary-flip && cd /tmp/kolu-binary-flip"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'PNG\0fake\1\2' > note.txt"
    And I click the Code tab
    And I click the changed file "note.txt" in the Code tab
    Then the Code tab should show the binary placeholder
    When I click the terminal canvas
    And I run "printf 'now text\n' > note.txt"
    Then the diff view should contain "now text"
    And the Code tab should not show the binary placeholder

  Scenario: Editing a file updates the diff view live
    When I run "git init /tmp/kolu-live-diff && cd /tmp/kolu-live-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'before\n' > note.txt"
    And I click the Code tab
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "before"
    When I click the terminal canvas
    And I run "printf 'after\n' > note.txt"
    Then the diff view should contain "after"

  Scenario: Editing a file updates browse-mode content live
    When I run "git init /tmp/kolu-live-browse && cd /tmp/kolu-live-browse"
    And I run "printf 'first version\n' > letters.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "letters.txt" in the file browser
    Then the file content should contain "first version"
    When I click the terminal canvas
    And I run "printf 'second version\n' > letters.txt"
    Then the file content should contain "second version"

  # Live-update for the iframe-previewed kinds (.html/.svg/.pdf): editing the
  # previewed file must refresh the iframe with no manual reload. Unlike the
  # text path above (new content arrives on the `fsReadFile` stream and re-feeds
  # Pierre), the binary path carries only a `url`. The refresh hinges on the
  # server bumping `?v=<mtime>` on every save (`buildIframePreviewUrl`): the new
  # URL breaks `fsReadFileOutputEqual` (binary equality is `a.url === b.url`), so
  # a fresh snapshot pushes, the `binaryFile` memo identity flips, and FileView
  # re-points the iframe `src`. This reads the rendered content *inside* the
  # frame — proof the new bytes actually reached the preview, not merely that
  # the src attribute moved.
  Scenario: Editing an HTML file refreshes the iframe preview live
    When I run "rm -rf /tmp/kolu-live-html && git init /tmp/kolu-live-html && cd /tmp/kolu-live-html"
    And I run "printf '<!doctype html><h1>preview version one</h1>\n' > page.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "page.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "preview version one"
    When I click the terminal canvas
    And I run "printf '<!doctype html><h1>preview version two</h1>\n' > page.html"
    Then the file preview iframe should contain "preview version two"

  # In-iframe navigation must move the tree selection. The preview iframe is
  # sandboxed at an opaque origin (`allow-scripts`, no `allow-same-origin`), so
  # the parent can't read `contentWindow.location` after a same-frame link
  # click — the new path has to be reported out by the in-iframe artifact-sdk
  # (`ReadyMsg.pathname`, posted on every document boot). Without that report
  # the page renders the linked file but the tree stays stuck on the first
  # file, so the user loses their place. Unquoted `href` keeps the fixture
  # free of inner quotes (the `I run "…"` step has no escape for them).
  Scenario: Clicking an in-page link moves the file tree selection
    When I run "rm -rf /tmp/kolu-html-nav && git init /tmp/kolu-html-nav && cd /tmp/kolu-html-nav"
    And I run "printf '<!doctype html><h1>first page</h1><a href=second.html>go to second</a>\n' > first.html"
    And I run "printf '<!doctype html><h1>second page</h1>\n' > second.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "first.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "first page"
    And the file "first.html" should be selected in the file browser
    When I click the link "go to second" in the file preview iframe
    Then the file preview iframe should contain "second page"
    And the file "second.html" should be selected in the file browser

  # Regression (CONFIRMED live on the Atlas docs): reaching a file via an
  # IN-IFRAME LINK CLICK (not a tree click) desyncs the live-reload watch from
  # the displayed file. Mirrors the real case: an index.html in a nested dist/
  # dir links (relative href) to a sibling page; the inner document navigates
  # browser-side, the tree highlight + iframe `src` follow via the artifact-sdk
  # `ReadyMsg.pathname` report — but the `fsReadFile` WATCH does not re-arm on
  # the navigated-to file, so a later edit fires events nobody listens for and
  # the preview freezes on the navigated content. (Re-selecting the file via a
  # tree click repairs it.) The nested dist/ layout matches the live repro;
  # a flat repo did NOT trip the bug.
  Scenario: Editing a file reached via an in-iframe link still refreshes the preview live
    When I run "rm -rf /tmp/kolu-nav-edit && git init /tmp/kolu-nav-edit && cd /tmp/kolu-nav-edit"
    And I run "mkdir dist"
    And I run "printf '<!doctype html><h1>first page</h1><a href=second.html>go to second</a>\n' > dist/index.html"
    And I run "printf '<!doctype html><h1>second page ALPHA</h1>\n' > dist/second.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "dist" in the file browser
    And I click the file "dist/index.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "first page"
    When I click the link "go to second" in the file preview iframe
    Then the file preview iframe should contain "second page ALPHA"
    And the file "dist/second.html" should be selected in the file browser
    When I click the terminal canvas
    And I run "printf '<!doctype html><h1>second page BETA</h1>\n' > dist/second.html"
    Then the file preview iframe should contain "second page BETA"

  Scenario: Committing the selected local diff clears the stale content pane
    When I run "rm -rf /tmp/kolu-clear-selected-local && git init /tmp/kolu-clear-selected-local && cd /tmp/kolu-clear-selected-local"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'before\n' > note.txt"
    And I click the Code tab
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "before"
    When I click the terminal canvas
    And I run "git add note.txt && git commit -m 'save note'"
    Then the Code tab should show the empty-changes message
    And the Code tab content should show the select hint "Select a file to view its diff"

  Scenario: Deleting the selected browse file clears the stale content pane
    When I run "rm -rf /tmp/kolu-clear-selected-browse && git init /tmp/kolu-clear-selected-browse && cd /tmp/kolu-clear-selected-browse"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'old content\n' > obsolete.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "obsolete.txt" in the file browser
    Then the file content should contain "old content"
    When I click the terminal canvas
    And I run "rm obsolete.txt"
    Then the file browser should not show a file "obsolete.txt"
    And the Code tab content should show the select hint "Select a file to view its content"

  # Regression: creating a new file inside a hand-expanded folder in browse
  # mode used to leave the tree stale — the new row never appeared until a
  # mode switch or reload. The `fsListAll` value lands in a reconciled store
  # whose `paths` array is mutated in place, so a `treePaths()` memo that
  # returned the array proxy without reading its contents never re-ran on an
  # in-place add, and even when it did the stable reference defeated the
  # downstream reference-equality memos/effects feeding Pierre. Copying the
  # paths out (`[...]`) tracks the contents and mints a fresh reference, so
  # the in-place add propagates and Pierre's `batch` reveals the file.
  Scenario: New file in an expanded folder appears in the browse tree live
    When I run "rm -rf /tmp/kolu-browse-newfile && git init /tmp/kolu-browse-newfile && cd /tmp/kolu-browse-newfile"
    And I run "mkdir -p lib && printf 'x\n' > lib/util.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "lib" in the file browser
    Then the file browser should show a file "lib/util.ts"
    When I click the terminal canvas
    And I run "printf 'y\n' > lib/added.ts"
    Then the file browser should show a file "lib/added.ts"

  # ── Comments on files (#881) ──
  #
  # End-to-end coverage of the select → pill → composer → tray → copy
  # flow. Selection is driven by walking Pierre's shadow DOM to find
  # the target text node, then calling `Selection.addRange` directly
  # (Chromium fires `selectionchange` on the document for shadow-DOM
  # selections, which the `useTextSelection` adapter listens to).
  # Pure-logic coverage of the underlying anchoring + clipboard payload
  # algorithms lives in `packages/artifact-sdk/src/core/findQuote.test.ts`,
  # `packages/artifact-sdk/src/server/inject.test.ts`, and
  # `packages/client/src/comments/formatMarkdown.test.ts`.

  Scenario: Comments tray is hidden when the queue is empty
    When I run "rm -rf /tmp/kolu-comments-empty && git init /tmp/kolu-comments-empty && cd /tmp/kolu-comments-empty"
    And I run "printf 'hello\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the comments tray should not be visible

  Scenario: Selecting text in a file shows the floating comment pill
    When I run "rm -rf /tmp/kolu-comments-pill && git init /tmp/kolu-comments-pill && cd /tmp/kolu-comments-pill"
    And I run "printf 'unique-pill-marker line one\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    Then the file content should contain "unique-pill-marker"
    When I select text "unique-pill-marker" in the file content
    Then the comment pill should be visible

  Scenario: Clicking the pill opens the composer; Save adds the comment to the tray
    When I run "rm -rf /tmp/kolu-comments-save && git init /tmp/kolu-comments-save && cd /tmp/kolu-comments-save"
    And I run "printf 'save-flow-marker here\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    Then the comments tray should not be visible
    When I select text "save-flow-marker" in the file content
    And I click the comment pill
    Then the comment composer should be visible
    When I type "agent should reword this" into the comment composer
    And I click the composer "Save" button
    Then the comment composer should not be visible
    And the comments tray should be visible
    And the comments tray should contain "agent should reword this"
    And the comments tray should have 1 comments

  Scenario: Cancel button dismisses the composer without saving
    When I run "rm -rf /tmp/kolu-comments-cancel && git init /tmp/kolu-comments-cancel && cd /tmp/kolu-comments-cancel"
    And I run "printf 'cancel-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "cancel-flow-marker" in the file content
    And I click the comment pill
    And I type "draft that should be discarded" into the comment composer
    And I click the composer "Cancel" button
    Then the comment composer should not be visible
    And the comments tray should not be visible

  Scenario: Escape key dismisses the composer
    When I run "rm -rf /tmp/kolu-comments-escape && git init /tmp/kolu-comments-escape && cd /tmp/kolu-comments-escape"
    And I run "printf 'escape-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "escape-flow-marker" in the file content
    And I click the comment pill
    Then the comment composer should be visible
    When I press Escape in the composer
    Then the comment composer should not be visible

  Scenario: Comments accumulate across multiple files in the same worktree
    When I run "rm -rf /tmp/kolu-comments-multi && git init /tmp/kolu-comments-multi && cd /tmp/kolu-comments-multi"
    And I run "printf 'multi-A-marker\n' > a.txt && printf 'multi-B-marker\n' > b.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "multi-A-marker" in the file content
    And I click the comment pill
    And I type "first note on A" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should have 1 comments
    When I click the file "b.txt" in the file browser
    And I select text "multi-B-marker" in the file content
    And I click the comment pill
    And I type "second note on B" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should have 2 comments
    And the comments tray should contain "first note on A"
    And the comments tray should contain "second note on B"

  Scenario: Per-comment × button removes just that one comment
    When I run "rm -rf /tmp/kolu-comments-remove && git init /tmp/kolu-comments-remove && cd /tmp/kolu-comments-remove"
    And I run "printf 'remove-X-marker\nremove-Y-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "remove-X-marker" in the file content
    And I click the comment pill
    And I type "note about alpha" into the comment composer
    And I click the composer "Save" button
    And I select text "remove-Y-marker" in the file content
    And I click the comment pill
    And I type "note about beta" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should have 2 comments
    When I remove the tray comment containing "note about alpha"
    Then the comments tray should have 1 comments
    And the comments tray should contain "note about beta"
    And the comments tray should not contain "note about alpha"

  Scenario: Discard all empties the queue and hides the tray
    When I run "rm -rf /tmp/kolu-comments-discard && git init /tmp/kolu-comments-discard && cd /tmp/kolu-comments-discard"
    And I run "printf 'discard-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "discard-flow-marker" in the file content
    And I click the comment pill
    And I type "temporary note" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should be visible
    When I click the comments tray "Discard all" button
    Then the comments tray should not be visible

  Scenario: Tray and queued comments persist across a page reload
    When I run "rm -rf /tmp/kolu-comments-persist && git init /tmp/kolu-comments-persist && cd /tmp/kolu-comments-persist"
    And I run "printf 'persist-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "persist-flow-marker" in the file content
    And I click the comment pill
    And I type "should survive reload" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should contain "should survive reload"
    When I reload the page
    And I click the Code tab
    Then the comments tray should contain "should survive reload"

  # A .md file opens rendered, where there's no selectable source surface to
  # anchor a comment to — so comments on Markdown live in the source view
  # (plan phase-3 v1 decision: rendered Markdown is read-only). Flipping the
  # toggle to source brings back Pierre's CommentTextSurface and the pill.
  Scenario: Comments on a Markdown file work in the source view
    When I run "rm -rf /tmp/kolu-comments-md && git init /tmp/kolu-comments-md && cd /tmp/kolu-comments-md"
    And I run "printf '# Doc\n\nmd-source-comment-marker line\n' > notes.md && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "notes.md" in the file browser
    Then the markdown preview should be visible
    When I switch the file view to "source"
    And I select text "md-source-comment-marker" in the file content
    Then the comment pill should be visible

  # Regression for #1026: Pierre's virtualizer defaults its row-height metric
  # to 20px, but Kolu renders rows at 16px (--diffs-line-height). The mismatch
  # made the virtualizer's render window come up short, so the last few lines
  # of any scrollable file/diff were unreachable — clipped at the bottom of
  # the preview. Verified across the file viewer (browse) and the diff viewer
  # (local), since both go through the same `<CodeView>` wrapper.
  Scenario: Browse preview can scroll all the way to the last line
    When I run "rm -rf /tmp/kolu-tail-browse && git init /tmp/kolu-tail-browse && cd /tmp/kolu-tail-browse"
    And I run "for i in $(seq 1 199); do echo \"const line_$i = $i;\"; done > long.ts && echo 'const LAST_LINE_MARKER = 200;' >> long.ts && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "long.ts" in the file browser
    And I scroll the file preview to the bottom
    Then the file content should contain "LAST_LINE_MARKER"

  Scenario: Diff preview can scroll all the way to the last line
    When I run "rm -rf /tmp/kolu-tail-local && git init /tmp/kolu-tail-local && cd /tmp/kolu-tail-local"
    And I run "git commit --allow-empty -m init"
    And I run "for i in $(seq 1 199); do echo \"const line_$i = $i;\"; done > long.ts && echo 'const LAST_LINE_MARKER = 200;' >> long.ts"
    And I click the Code tab
    And I click the changed file "long.ts" in the Code tab
    And I scroll the file preview to the bottom
    Then the diff view should contain "LAST_LINE_MARKER"
