# Minimal, scoped grant for the #1399 precursor probe.
#
# Import this from configuration.nix (or paste the body in), `nixos-rebuild
# switch`, run the test, then REMOVE it and rebuild. It grants exactly ONE new
# capability: reading the kernel ring buffer as a non-root user, so the safety
# monitor can detect an amdgpu fault and kill the browser instantly. Everything
# else in the test is already unprivileged (CDP, world-readable /sys/class/drm,
# the per-user journal).
{ ... }:
{
  # PRIMARY (least escalation): allow non-root kernel-log reads. This is the
  # whole "particular stuff" — NO sudo rights are handed out.
  boot.kernel.sysctl."kernel.dmesg_restrict" = 0;

  # ALTERNATIVE (keep dmesg_restrict=1): a narrowly-scoped, password-less sudo
  # for ONLY the read-only fault-watch binary. Use this OR the sysctl, not both.
  # Verify the path first with `readlink -f $(command -v dmesg)`.
  # security.sudo.extraRules = [{
  #   users = [ "srid" ];
  #   commands = [
  #     { command = "/run/current-system/sw/bin/dmesg"; options = [ "NOPASSWD" ]; }
  #   ];
  # }];

  # DELIBERATELY NOT GRANTED (and must never be): any write access to amdgpu
  # reset / debugfs controls (e.g. /sys/kernel/debug/dri/*/amdgpu_gpu_recover).
  # The probe never touches them.
}
