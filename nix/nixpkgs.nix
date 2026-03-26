# Pinned nixpkgs import.
# To update: change rev and sha256, then `rm -rf ~/.cache/kolu-shell`.
import (fetchTarball {
  url = "https://github.com/NixOS/nixpkgs/archive/fdc7b8f7b30fdbedec91b71ed82f36e1637483ed.tar.gz";
  sha256 = "sha256-a++tZ1RQsDb1I0NHrFwdGuRlR5TORvCEUksM459wKUA=";
})
