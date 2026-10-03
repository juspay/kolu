# @kolu/solid-pierre

SolidJS adapters for Pierre's file tree and code/diff renderer. The vanilla
Pierre classes own their DOM; the adapters update them in place and dispose them
with their Solid owner.

`FileTree` accepts reactive `paths`, `gitStatus`, and `selectedPath`. Keep it
mounted while loading: paths and selection may arrive in either order. A
standing selection is applied when its path becomes available.

`initialExpansion` sets the expansion policy for new folders (`"closed"`,
`"open"`, or a directory depth). A policy change also opens existing folders
covered by the new policy. Ordinary inventory changes preserve the user's
expansion choices for surviving folders. `expandPaths` additionally reveals
search matches and other host-selected ancestors.

The `CodeView` adapter updates file content without replacing its mounted
renderer. Consumers should pass reactive file props rather than reconstructing
the view after a save.
