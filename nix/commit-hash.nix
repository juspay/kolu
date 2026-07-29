# Serialize a flake's source identity for @kolu/surface's BuildCommit boundary.
# A Nix-built daemon always receives a build id, so its commit is the other half
# of the same fact and must be knowable. Raw/off-Nix processes represent honest
# unknown by omitting BOTH runtime env fields; a non-Git flake must not mint the
# contradictory build-known/commit-unknown pair.
self:
self.shortRev or self.dirtyShortRev or (throw
  "kolu: a Nix build requires a Git revision; build from a Git flake or pass commitHash explicitly")
