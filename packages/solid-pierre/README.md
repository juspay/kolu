# @kolu/solid-pierre

SolidJS adapters for Pierre's file tree and code/diff renderer. The vanilla
Pierre classes own their DOM; the adapters update them in place and dispose them
with their Solid owner.

`FileTree` accepts reactive `paths`, `gitStatus`, and `selectedPath`. Keep it
mounted while loading: paths and selection may arrive in either order, or in
the same update. A standing selection is applied when its path becomes
available.

`initialExpansion` sets folder expansion when the tree is constructed
(`"closed"`, `"open"`, or a directory depth). Retain a separate tree for each
mode with a different inventory or expansion policy: swapping inventories removes
folders and their local expansion state. `expandPaths` reveals search matches
and other host-selected ancestors each time `paths` or `expandPaths` is a new
array, so a folder the user collapsed stays collapsed until the inventory or
the search answer changes. Pass a new array for a changed inventory, never one
mutated in place.

**Every reactive prop is read by VALUE, compared with `===`.** A host may hand
all of them through one object it rebuilds on every tick; handing the same
array, request or epoch again is not a change and does nothing. So a changed
inventory must be a new array, a repeat reveal a new request object, and a new
`lazyEpoch` a genuinely different value.

`lazyDirectories` names directory rows whose children are not in `paths`;
`onExpandLazyDirectory` fires once per collapsed → expanded transition, and the
promise it returns decides the outcome — a rejection collapses the row so the
user never faces an open, empty folder. Start a newer read for the same
directory and the older one owns nothing: its rejection neither re-reports nor
collapses, which is what lets a host abort a superseded read.

The `CodeView` adapter updates file content without replacing its mounted
renderer. Consumers should pass reactive file props rather than reconstructing
the view after a save.
