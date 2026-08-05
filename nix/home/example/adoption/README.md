# B3.3 / B3.4 kaval-adoption VM tests

End-to-end coverage for terminal **adoption** (#1344): terminals — shells,
scrollback, running agents — survive a kolu-server redeploy when the daemons that
own them outlive it.

> **W2.2 cutover.** kolu-server no longer talks to kaval directly. It binds a
> separate **padi** process (its own `systemd-run --user` transient unit) that
> owns/supervises **kaval** (a further transient unit beneath it). So adoption is
> now TWO-LEVEL, and the rendezvous is **digest-keyed**, not per-port:
> `$XDG_RUNTIME_DIR/padi-<digest>/padi.pid` and `kaval-<digest>/kaval.pid`, both
> keyed by a sha256 digest of padi's state-root (`packages/padi/src/stateRoot.ts`).
> - **kolu-server ↔ padi** — `adopt-or-spawn-or-refuse`: a surface skew is REFUSED
>   (padi left standing + degraded), NEVER a kill-9. A server restart ADOPTS the
>   surviving padi (padi + kaval gates unchanged).
> - **padi ↔ kaval** — `adopt-or-ensure`: a kaval contract skew IS recycled (kill +
>   fresh spawn); a build-only difference is adopted.
> A kaval-level skew/currency is only exercised once a freshly-built padi meets the
> surviving kaval — reached by DRAINing the adopted padi via the frozen control core
> (`daemon.restart`), which respawns padi from the running binder's own closure.

These tests exist because this is the **one path the Playwright e2e harness
can't reach** — it has no systemd, runs one server per worker, and forces the
non-survivable detached spawn. A NixOS VM has *real* systemd, so the production
`systemd-run --user` survival path (the #1031 cgroup-v2 lesson) actually works.

## What's here

| File | Role |
| --- | --- |
| `lib.nix` | The shared scaffold — `mkAdoptionTest` + the survival VM node, boot polls, `machinectl`+result-file run/assert helpers, the jq/curl bindings, and the runtime-layout literals. **One** domain concept (a VM adoption probe); both tests are it with two outcomes. |
| `adopt.nix` | **Positive** path → check `adoption-adopt` (also asserts NO update-pending — the #1034 no-op-deploy-no-nudge proof). |
| `skew.nix` | **Contract-skew negative** path → check `adoption-skew`. |
| `currency.nix` | **Build-skew** path (B3.4) → check `adoption-currency`. |
| `upgrade.nix` | **W2.2 upgrade-migration** path → TWO checks. `adoption-upgrade`: a legacy PORT-keyed kaval (`kaval-<port>`) is ADOPTED — not leaked — when the digest-keyed W2.2 padi first boots (ARM 1), and a Restart-kaval recycle CONVERGES the daemon under `kaval-<digest>` (ARM 2). `adoption-upgrade-reboot`: from that adopted state, a HOST REBOOT proves the legacy residue is BOUNDED (ARM 3) — kaval is mortal (its process + its `$XDG_RUNTIME_DIR`-tmpfs gate die), so padi spawns DIGEST-keyed and the saved session (on the persistent state-root) takes the degraded-restore path. Its flow INVERTS the others' — it stands up the legacy daemon + a matching pre-W2.2 `config.json` BEFORE kolu starts. |
| `padi-upgrade.nix` | **padi build-skew convergence** (#1670) → check `adoption-padi-upgrade`. A redeploy that changes padi's *build* but not its wire contract used to leave the freshly-booted binder ADOPTING the old-build padi forever. Asserts the binder drains the survivor at boot **on its own** (padi gate pid CHANGES, kaval gate UNCHANGED, session warm) — no manual drain, unlike `currency.nix`. |
| `offline-provision.nix` | **I1 offline remote provisioning** (juspay/kolu#2101) → check `offline-provision`. The only **two-node** member: a binder plus a bare sshd+nix remote, both with `nix.settings.substituters` forced empty (asserted, not inherited). A `hosts/add` dial must SHIP the agent closure out of the deployed generation's own store and converge — with neither incident string from `packages/surface-remote/src/nixCopy.ts` in the journal. Falsified by reverting the module's agent attachment: the same fixture then narrates `no local copy of the agent to ship`. |
| `default.nix` | Aggregator — pins the `port` + `kavalTui` + `kavalBin` once, imports `lib.nix`, returns the seven checks. |

`../flake.nix` spreads all seven into `checks.x86_64-linux` — alongside the
service `vm-test` and the VM-free `agent-closure-containment` proof it also
defines — so they ride the Linux arm of `ci::home-manager` (see
[Running](#running)).

## The paths

### `adoption-adopt` — the running padi is adopted (positive)

1. boot kolu as a systemd **user service** (with **linger** — the survival
   precondition);
2. open a terminal over the **oRPC HTTP API** (`/rpc/surface/padi/lifecycle/create`, no browser);
3. run a command in it (`echo <nonce>`) whose unique output we record;
4. **`systemctl --user restart kolu`** — the *server* only; padi + kaval live in
   their own transient cgroups and survive;
5. assert the **same padi** (gate pid), the **same kaval** (gate pid), the **same
   PTY** (id + pid), the command's **output still in the scrollback**, *and*
   kolu-server's own **"adopted a surviving daemon"** log all survived → adoption
   of the running padi, not a fresh respawn.

### `adoption-skew` — a contract-skewed kaval is recycled (negative)

When a redeploy **changes kaval's wire** (a `PTY_HOST_CONTRACT_VERSION` bump),
the surviving kaval is incompatible and must be **recycled, not adopted** — but
the saved session (padi's, under its state-root) is left untouched so a restore is
still offered. Post-cutover this is padi's `adoptOrEnsure` recycling its kaval.

There's no env seam for the contract version (a source constant), so the "newer
kolu" is a **second build** via the test-only **`contractVersionOverride`** arg in
the root `default.nix`. The test seeds a terminal + saved session on the old
(contract 5.0) stack, stops the old server, starts the bumped (9.0) server (which
merely ADOPTS the surviving old padi — its `padiSurface` is unchanged), then
**drains** that padi so kolu-new's own contract-9.0 padi comes up, meets the
surviving kaval, skews, and **recycles** it. Asserts the **kaval** gate pid
*changed*, the **`pty-host contract skew`** was logged (in padi's own transient
unit), *and* the session is **preserved**.

### `adoption-currency` — a build-behind kaval is adopted + nudged (B3.4)

When a redeploy changes kaval's **build** (its source closure) but *not* its wire
contract, the surviving kaval is still **compatible** — so kolu-new's respawned
padi **adopts** it across the drain (kaval gate *unchanged*), the deliberate
opposite of `adoption-skew`'s recycle. `KAVAL_BUILD_ID` is a **nix-injected value**,
so the "newer kolu" is a second build via **`kavalBuildIdOverride`** (only the
wrapper `--set` changes, so `koluNew` **shares the kolu closure** — the *cheap*
skew). The test asserts the kaval gate *unchanged* (adopted), the session intact,
AND the adopt-time currency breadcrumb `kaval currency on adopt: running=<X>
expected=<Y>` with `running != expected` and `expected == the override` — i.e. the
build-id reached padi's `expectedKaval` and the build-skew is detected (the "update
available" nudge fires). The breadcrumb is emitted in padi's OWN transient unit, so
it is read via `journalctl --user` broadly, not `-u kolu`.

> The nudge reads padi's own baked `KAVAL_BUILD_ID`. That the padi wrapper bakes it
> (and `daemonEnv` forwards it for the from-source path) is the product fix in
> 56e0431a9 — earlier in the cutover padi carried no expected-kaval id, so this
> assertion had been briefly deferred.

### `offline-provision` — a connect ships, it never fetches or compiles (I1)

The one check here with **two nodes**. `machine` is the deployed generation;
`agenthost` is a bare NixOS box with sshd, nix and a writable store. Both force
`nix.settings.substituters = []`, and the script reads the *effective* value back
before it dials — a VM test is offline anyway, and inheriting a property is not
the same as asserting it.

After introducing the two boxes over ssh at runtime (a home-manager-managed
private key would be a world-readable store symlink, which ssh refuses), the test
calls `hosts/add` and asserts three things: the journal says **`agent closure
shipped`**, a terminal really opens on the remote host's own map key, and
**neither** incident string from `packages/surface-remote/src/nixCopy.ts`
(`no declared cache had the agent closure …` / `no local copy of the agent to
ship …`) ever appears.

That works because a NixOS VM registers each node's nix db from its **system
closure**: post-fix `padi-agent` is in the generation, so the binder's
`nix-store --check-validity` says valid and `stageAgentClosure` ships; pre-fix the
bits sit unregistered on the shared host store, which is exactly production's
"not valid locally". Evaluation is scaffolded identically on both arms — I1
guarantees the closure, not the drv resolution, which stays lazy per F6.

## Running

Linux-only (NixOS VM tests). A **KVM-capable** host runs them in ~seconds; a
host without KVM falls back to qemu TCG (~10× slower — the polls carry 180s
headroom for it).

```sh
# from this directory's parent (nix/home/example/), build kolu from the repo root:
nix build .#checks.x86_64-linux.adoption-adopt \
          .#checks.x86_64-linux.adoption-skew \
          .#checks.x86_64-linux.adoption-currency \
  --override-input kolu /path/to/kolu/repo -L
```

In CI this is automatic: `ci::home-manager` directly builds this example's
outputs with kolu overridden to the checkout and nixpkgs fixed by the example's
committed lock. That realizes every `checks.x86_64-linux.*`, so the service smoke
and all adoption VM tests build and run on the Linux lane after `ci::nix`.

> `adoption-skew` forces a **second full kolu build** (the contract-bumped
> `koluNew` `postPatch`-seds a source constant), so it is the slow check. That
> cost is inherent — there is no cheaper way to produce a genuinely skewed wire.
> `adoption-currency` is the *cheap* skew: `kavalBuildIdOverride` only rewrites the
> wrapper's `--set`, so `koluNew` shares the `kolu` closure.
>
> `offline-provision` is slow for a different reason: it boots **two** VMs and
> genuinely transfers the agent closure between their stores over ssh. That
> transfer *is* the thing under test, so it cannot be shortened — but it is a
> copy, never a build, which is the whole point.

## Why the scaffold looks the way it does

These are not stylistic choices — each guards a way the test would otherwise
*silently pass when it should fail*. Don't "simplify" them away:

- **Result file asserted as root.** `machinectl shell <script>` returns 0 once
  the session opens, **swallowing the script's own exit code**. So each
  seed/verify script (run as *alice*, for her `XDG_RUNTIME_DIR` / DBUS / journal)
  writes `OK`/`FAIL` to a result file, and the testScript asserts that file **as
  root** — whose exit the test driver *does* see. Without this, every assertion
  is ignored and the test can never fail.
- **Poll until *all* conditions hold at once.** A single-shot check races a slow
  recycle/adopt and passes on a transient state. Each verify loops until the full
  AND-chain holds; the wrong outcome never satisfies it and times out red.
- **`</dev/null` on every `machinectl`.** The driver's stdin pipe never EOFs, so
  without the redirect `machinectl` hangs even after the inner command exits — and
  a hung attempt stalls the whole lane. The in-guest `timeout` is the belt.
- **`linger = true`.** Without it, alice's user manager (and the kaval transient
  unit it owns) dies with `systemctl --user restart kolu`, so the test would
  silently exercise a *fresh spawn*, not adoption.
- **Runtime-layout discovery is pinned to source** (`lib.nix`): the digest-keyed
  `padi-<digest>/padi.pid` and `kaval-<digest>/kaval.pid` gates (discovered by GLOB
  — one padi + one kaval per user — not by recomputing the sha256 digest in shell),
  and `.local/state/padi/config.json` (padi's persisted session under its default
  state-root). If one drifts from what the daemons actually write, the poll just
  times out and is mis-diagnosed.

## Verification

The pre-cutover tests were re-checked on a KVM box (same PTY + scrollback survive;
`adoption-skew` green with `gate 1284→1528`, red under an `isContractVersionCompatible
→ true` mutation with `gate 1289→1289`). See #1349 and PR #1350.

The **W2.2 cutover** rewired these tests for the two-level padi ↔ kaval topology
(digest-keyed gates, padi-emitted journal lines, the `daemon.restart` drain reach).
That rewrite has NOT yet been re-run on a KVM box — it can only run on the Linux
`ci::home-manager` Linux lane. Re-confirm each is green on correct code AND red under a
mutation before trusting the bite.
