# Container entrypoint (run by the image's bash; see worker.ts). Fixes the
# two things the stock Cloudflare container gets in the way of, then idles:
# every job is an `exec()` from the Durable Object.

# Cloudflare mounts a fresh /dev over the image's, hiding /dev/shm. Python
# multiprocessing (nixos-render-docs in the home-manager build) needs it.
mkdir -p /dev/shm
chmod 1777 /dev/shm

# /dev/kvm is present but root-only. Nix builds run as nixbld users, so
# without this QEMU logs "failed to initialize kvm: Permission denied" and
# falls back to TCG (the emanote VM test took 2x as long).
chmod 666 /dev/kvm

exec sleep infinity
