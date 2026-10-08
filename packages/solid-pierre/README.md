# @kolu/solid-pierre

SolidJS adapters for Pierre's file tree and code/diff renderer. The vanilla
Pierre classes own their DOM; the adapters update them in place and dispose them
with their Solid owner.

`FileTree` accepts reactive `paths`, `gitStatus`, and `selectedPath`. Keep it
mounted while loading: paths and selection may arrive in either order. A
standing selection is applied when its path becomes available.

`initialExpansion` sets folder expansion when the tree is constructed
(`"closed"`, `"open"`, or a directory depth). Retain a separate tree for each
mode with a different inventory or expansion policy: swapping inventories removes
folders and their local expansion state. `expandPaths` reveals search matches
and other host-selected ancestors each time `paths` or `expandPaths` is a new
array, so a folder the user collapsed stays collapsed until the inventory or
the search answer changes. Pass a new array for a changed inventory, never one
mutated in place.

The `CodeView` adapter updates file content without replacing its mounted
renderer. Consumers should pass reactive file props rather than reconstructing
the view after a save.
