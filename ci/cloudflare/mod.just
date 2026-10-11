# Cloudflare Container CI lane — see README.md in this directory.
#
# Recipes run from this directory (where wrangler.jsonc lives). The client
# recipes need KOLU_CI_URL (the deployed Worker's URL) and KOLU_CI_TOKEN (the
# CI_TOKEN secret); they fail fast when either is missing.

# wrangler from kolu's npins-pinned nixpkgs, not a global install.
wrangler := 'nix shell --impure --expr "(import ../../nix/nixpkgs.nix {}).wrangler" -c wrangler'
curl := 'curl -sSN --fail-with-body --max-time 7200 -H "Authorization: Bearer ${KOLU_CI_TOKEN:?set KOLU_CI_TOKEN}"'
url := '${KOLU_CI_URL:?set KOLU_CI_URL}'

# Deploy (or update) the Worker + container application. Needs `wrangler login`
# and a Workers Paid account. Deploying does not restart running containers.
deploy:
    {{ wrangler }} deploy

# Generate a fresh bearer token, store it as the CI_TOKEN Worker secret, and
# print it once. Keep it somewhere private (e.g. a password manager).
token:
    #!/usr/bin/env bash
    set -euo pipefail
    t=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)
    printf '%s' "$t" | {{ wrangler }} secret put CI_TOKEN
    echo "CI_TOKEN=$t"

# Print container facts (kernel, CPUs, /dev/kvm, disk).
probe instance='main':
    {{ curl }} "{{ url }}/probe?instance={{ instance }}"

# Run the home-manager NixOS VM test (kvm) against `rev` of this repo.
# `rebuild=1` re-runs it on a warm store.
vm-test rev='master' rebuild='0' instance='main':
    {{ curl }} -G "{{ url }}/nix-build" \
      --data-urlencode "instance={{ instance }}" \
      --data-urlencode "installable=git+https://github.com/juspay/kolu?dir=nix/home/example&ref={{ rev }}#checks.x86_64-linux.vm-test" \
      --data-urlencode "override=kolu=git+https://github.com/juspay/kolu?ref={{ rev }}" \
      --data-urlencode "rebuild={{ rebuild }}"

# Run `just <recipe>` inside `nix develop` on one instance, at `rev`
# (a commit SHA or origin/<branch>).
just recipe rev='origin/master' instance='main':
    {{ curl }} -G "{{ url }}/just" \
      --data-urlencode "instance={{ instance }}" \
      --data-urlencode "rev={{ rev }}" \
      --data-urlencode "recipe={{ recipe }}"

# Cucumber e2e fanned out over `shards` containers, one shard each
# (CUCUMBER_SHARD=i/N). Ends with a per-shard summary and an overall EXIT line.
e2e rev='origin/master' shards='8':
    {{ curl }} -G "{{ url }}/e2e" \
      --data-urlencode "shards={{ shards }}" \
      --data-urlencode "rev={{ rev }}" \
      --data-urlencode "env=CUCUMBER_RETRY=1"

# Destroy an instance's container (next job cold-starts with an empty store).
restart instance='main':
    {{ curl }} "{{ url }}/restart?instance={{ instance }}"

# Destroy the e2e shard containers.
restart-shards shards='8':
    {{ curl }} "{{ url }}/restart-shards?shards={{ shards }}"

# Remove the Worker, its Durable Objects and the container application.
teardown:
    {{ wrangler }} delete
