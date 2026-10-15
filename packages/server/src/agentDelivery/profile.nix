# One profile of the Agents setting, built for one host — what kolu-server's
# delivery runs (`./profiles.ts`) as
#
#   nix build --impure --expr "import ./profile.nix { … }"
#
# with agent-distro's own builder, `lib.mkProfile`, from the agent-distro
# revision the host's package was published at (`agentDistro`, a locked flake
# reference): the same nixpkgs, and the same runtime reading the plugins, as the
# launcher that reads the profile there — so a launch fetches, evaluates and
# compiles nothing. `profile` is the profile's tree: a store path kolu-server
# locked a reference to, or a path on this machine, used as it is. Impure for
# two reasons: `getFlake` on that reference, and mkProfile locking a plugin
# named by a flake reference.
#
# A host of another system than this machine's: a profile is built for this
# machine instead — its plugins, `env` and `settings` mean the same on any
# system, and its `reader` then simply differs from the host's, so a launch
# reads the plugins itself — PROVIDED its `packages` are empty on the host's
# system, since this machine cannot build those. A profile with packages there
# is refused, naming the profile and both systems: there is no fallback that
# drops them.
{ agentDistro, profile, hostSystem }:
let
  distro = builtins.getFlake agentDistro;
  buildSystem = builtins.currentSystem;
  at = /. + profile;
  file = if builtins.pathExists (at + "/agent-distro.nix") then at + "/agent-distro.nix" else at;
  attrs = import file;
  hostPackages = (attrs.packages or (_: [ ])) (import distro.inputs.nixpkgs {
    system = hostSystem;
    config.allowUnfree = true;
  });
in
if hostSystem == buildSystem then
  distro.lib.mkProfile { system = hostSystem; profile = file; }
else if hostPackages != [ ] then
  throw "the ${attrs.name} profile has packages for ${hostSystem}, which this ${buildSystem} machine cannot build"
else
  distro.lib.mkProfile {
    system = buildSystem;
    profile = attrs // { packages = _: [ ]; };
  }
