# Serialize a flake's source identity for @kolu/surface's BuildCommit boundary.
# A clean or dirty Git flake carries a navigable revision; a non-Git source uses
# the canonical empty string that buildCommit() decodes as its named `dev` arm.
self:
self.shortRev or self.dirtyShortRev or ""
