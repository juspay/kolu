# Cloudflare Container CI lane

An experimental CI lane that runs kolu jobs (the home-manager NixOS VM test, any `just` recipe, and the Cucumber e2e suite split into shards) in [Cloudflare Containers](https://developers.cloudflare.com/containers/). Every container is a fresh `standard-4` microVM: 4 vCPU, 12 GiB RAM, 20 GB disk, and `/dev/kvm`.

It isn't wired into odu yet. Today you run it by hand with `just cloudflare::…`. Wiring it in means adding an odu venue that calls these endpoints.

## How it works

- `wrangler.jsonc` deploys one Worker (`kolu-ci`) and one container application (`kolu-ci-runner`). The container image is the public `docker.io/nixos/nix` image; Cloudflare pulls it directly, so you don't need docker locally.
- `worker.ts` defines a `Runner` Durable Object. Each Durable Object name (`main`, `shard-0`, …) owns one container instance. The container's entrypoint (`boot.sh`) applies two fixes, then runs `sleep infinity`. Each job is a `ctx.container.exec()` from the Durable Object, and its combined output streams back as plain text.
- The output ends with a `### disk …` line and a `### EXIT <code> WALL <seconds>s` line. When the job prints nothing for 25s, the Worker emits a `### heartbeat` line, because Cloudflare drops proxied responses that stay silent for about 100s.
- One instance runs one job at a time; a second request gets a 409 response. The repo checkout (`/work`) and the nix store survive between jobs, so a re-run on the same instance starts warm. After 2 idle hours the container stops, and the next job cold-starts with an empty store.
- Every route requires `Authorization: Bearer <CI_TOKEN>`.

| Route | What it runs |
| --- | --- |
| `/probe?instance=` | Kernel, CPU count, memory, `/dev/kvm`, disk |
| `/nix-build?installable=&override=&rebuild=1&instance=` | `nix build -L <installable>`; defaults to the home-manager VM test |
| `/just?recipe=&arg=&rev=&env=K=V&instance=` | Checks out `rev`, then runs `nix develop -c just <recipe> <args>` |
| `/e2e?shards=N&rev=&env=K=V` | Fans out to `shard-0..N-1`, each running `just test` with `CUCUMBER_SHARD=i/N`, interleaves the output with `[i/N]` prefixes, and ends with one `### SHARD` line per shard plus an overall `### EXIT` |
| `/restart?instance=`, `/restart-shards?shards=N` | Destroys the container(s) |

Sharding uses Cucumber's native `shard` option, which `packages/tests/cucumber.js` reads from `CUCUMBER_SHARD`, the same knob olai uses. Cucumber deals scenarios round-robin, so the shards stay balanced as features move.

## Container quirks the lane works around

- **GitHub API rate limit.** `github:` flake refs resolve through api.github.com, which returns 403 from Cloudflare's shared egress IPs. Use `git+https://github.com/...` for anything that resolves a branch; locked inputs download archive tarballs and are fine.
- **`/dev/shm` is missing,** because Cloudflare mounts a fresh `/dev`. Python multiprocessing then fails with a `SemLock` error, for example in the home-manager manual build. `boot.sh` recreates the directory with mode 1777.
- **`/dev/kvm` is root-only,** and nix builds run as `nixbld` users, so QEMU falls back to TCG. `boot.sh` runs `chmod 666 /dev/kvm`.
- **The nix sandbox doesn't work here** (the build failed with the same `SemLock` error inside the sandbox), so builds run with `sandbox = false`. The container is single-use, which limits the damage.

## Usage

You need `wrangler login` on a Workers Paid account (Containers require it).

```sh
just cloudflare::deploy          # Worker + container application
just cloudflare::token           # sets the CI_TOKEN secret; prints it once
export KOLU_CI_URL=https://kolu-ci.<subdomain>.workers.dev KOLU_CI_TOKEN=...

just cloudflare::probe
just cloudflare::vm-test master            # cold on a fresh instance
just cloudflare::vm-test master 1          # warm re-run (--rebuild)
just cloudflare::just check origin/master  # any recipe, in nix develop
just cloudflare::e2e origin/master 8       # 8 shards, 8 containers
```

To see container stdout, open the dashboard (Workers & Pages → Containers → `kolu-ci-runner` → Logs) or run `wrangler tail` from this directory.

## Limits and cost

- **Per instance:** 4 vCPU, 12 GiB RAM, 20 GB disk (18G usable); nothing larger is available. The account-wide limit on concurrent instances is far above what the lane uses; `max_instances` caps it at 10.
- **Ephemeral store:** the nix store and `/work` vanish when the container stops, so the first job on an instance pays the full substitution cost. Billing covers running time only. An idle instance costs until its inactivity timeout (2h) stops it, so restart it when you're done.
- **Deploys don't restart running containers.** Use `restart` / `restart-shards` after changing `boot.sh`.
- **Teardown:** `just cloudflare::teardown` (`wrangler delete`) removes the Worker, its Durable Objects and the container application. No image is pushed to Cloudflare's registry, so there's nothing else to clean up.
