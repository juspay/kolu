self:
self.shortRev or self.dirtyShortRev or (throw
  "kolu: a Nix build requires a Git revision; build from a Git flake or pass commitHash explicitly")
