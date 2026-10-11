// Cloudflare Container CI lane for kolu. See ./README.md.
//
// One Durable Object (`Runner`) owns one container instance. The container
// runs nothing but `sleep infinity` after a few boot fixes; every job is an
// `exec()` from the Durable Object, streamed back as plain text. No npm
// dependencies: `cloudflare:workers` is provided by the runtime.
import { DurableObject } from "cloudflare:workers";
import boot from "./boot.sh";

interface Env {
  RUNNER: DurableObjectNamespace<Runner>;
  // `wrangler secret put CI_TOKEN`. Every command-running route requires
  // `Authorization: Bearer <CI_TOKEN>`.
  CI_TOKEN: string;
}

const REPO = "https://github.com/juspay/kolu";
const DEFAULT_INSTALLABLE = `git+${REPO}?dir=nix/home/example#checks.x86_64-linux.vm-test`;
// The image's entrypoint shell (docker.io/nixos/nix:2.35.2-amd64 `Cmd`).
const BASH =
  "/nix/store/0641h8qfqaxnwrsw2nzrz6i1wbzyx92l-bash-interactive-5.3p9/bin/bash";
// Keep the container across the gaps between jobs (e.g. a warm re-run).
const IDLE_MS = 2 * 60 * 60 * 1000;
// Cloudflare drops a proxied response that sends nothing for ~100s; nix
// evaluation and some e2e scenarios are silent for longer than that.
const HEARTBEAT_MS = 25_000;
// A container that is not running this long after start() was never placed.
const READY_MS = 10 * 60 * 1000;
// How long to keep reading output after the job process has exited.
const DRAIN_MS = 5_000;

// exec() passes only PATH from the image, so spell out what nix needs. The
// NIX_CONFIG applies to every nix call, including those inside just recipes.
const CERTS = "/nix/var/nix/profiles/default/etc/ssl/certs/ca-bundle.crt";
const BASE_ENV: Record<string, string> = {
  HOME: "/root",
  USER: "root",
  CI: "true",
  // `just test` serializes suites through a /tmp lock for shared CI hosts.
  // An instance runs one job at a time, so the lock only gets in the way.
  KOLU_E2E_LOCK: "0",
  NIX_SSL_CERT_FILE: CERTS,
  SSL_CERT_FILE: CERTS,
  GIT_SSL_CAINFO: CERTS,
  NIX_CONFIG: [
    "experimental-features = nix-command flakes",
    "accept-flake-config = true",
    // The sandbox does not work here (see README); builds run as nixbld users.
    "sandbox = false",
    // nix only schedules VM tests when `kvm` is a system feature.
    "system-features = nixos-test benchmark big-parallel kvm",
    "extra-substituters = https://cache.nixos.asia/oss",
    "extra-trusted-public-keys = oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=",
    "max-jobs = auto",
  ].join("\n"),
};

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

// Checkout shared by every job that runs repo code. `git+https` / plain git,
// never `github:` refs: api.github.com rate-limits Cloudflare's shared egress
// IPs (HTTP 403). The checkout is reused across jobs on the same instance.
const checkout = (rev: string) => `
# One job owns the instance: reap anything an earlier job left running
# (a hung cucumber, test daemons), keeping PID 1 and this shell.
for d in /proc/[0-9]*; do
  pid=\${d#/proc/}
  case "$pid" in 1|$$|$PPID) ;; *) kill -9 "$pid" 2>/dev/null || true ;; esac
done
if [ -d /work/.git ]; then git -C /work fetch -q origin; else git clone -q ${REPO} /work; fi
git -C /work checkout -q --detach ${q(rev)}
cd /work
echo "### rev $(git rev-parse HEAD)"`;

const scripts = {
  probe: () =>
    `
for c in 'uname -a' nproc 'grep -E "^Mem(Total|Available)" /proc/meminfo' 'df -h /' \\
  'ls -ld /dev/kvm /dev/shm' "grep -c -E 'vmx|svm' /proc/cpuinfo" 'nix --version'; do
  echo "\\$ $c"; bash -c "$c" 2>&1 || true
done
# Processes still alive (procps is not in the image).
echo "\\$ processes"
for d in /proc/[0-9]*; do
  echo "\${d#/proc/} $(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null | cut -c1-160)"
done`,
  // ?installable=<flake installable> (default: the home-manager VM test)
  // &override=<input>=<flakeref> (repeatable) &rebuild=1 (re-run a cached test)
  nixBuild: (p: URLSearchParams) => {
    const args = [
      p.get("installable") ?? DEFAULT_INSTALLABLE,
      "-L",
      "--no-link",
      "--print-out-paths",
    ];
    for (const o of p.getAll("override")) {
      const i = o.indexOf("=");
      args.push("--override-input", o.slice(0, i), o.slice(i + 1));
    }
    if (p.get("rebuild") === "1") args.push("--rebuild");
    return `echo "### nix build ${args.join(" ")}"\nnix build ${args.map(q).join(" ")}`;
  },
  // ?rev=<commit or origin/branch> &recipe=<just recipe> &arg=<arg> (repeatable)
  // &env=KEY=VALUE (repeatable). Runs `just` inside the repo's default devShell.
  just: (p: URLSearchParams) => {
    const recipe = p.get("recipe");
    if (!recipe) throw new Error("missing ?recipe=");
    const exports = p.getAll("env").map((kv) => {
      const i = kv.indexOf("=");
      if (i < 1) throw new Error(`bad env ${kv}`);
      return `export ${kv.slice(0, i)}=${q(kv.slice(i + 1))}`;
    });
    return `${checkout(p.get("rev") ?? "origin/master")}
${exports.join("\n")}
echo "### just ${recipe} ${p.getAll("arg").join(" ")}"
nix develop -c just ${[recipe, ...p.getAll("arg")].map(q).join(" ")}`;
  },
};

export class Runner extends DurableObject<Env> {
  private busy = false;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const container = this.ctx.container;
    if (!container) throw new Error("no container bound to Runner");
    if (url.pathname === "/restart") {
      if (container.running) await container.destroy("restart requested");
      return text(
        "### container destroyed; the next job cold-starts a fresh one\n",
      );
    }
    const make = {
      "/probe": scripts.probe,
      "/nix-build": scripts.nixBuild,
      "/just": scripts.just,
    }[url.pathname];
    if (!make) return text("not found\n", 404);
    if (this.busy)
      return text("### busy: a job is already running on this instance\n", 409);
    const script = make(url.searchParams);

    if (!container.running) {
      container.start({ entrypoint: [BASH, "-c", boot], enableInternet: true });
    }
    await container.setInactivityTimeout(IDLE_MS);
    this.busy = true;
    const t0 = Date.now();
    let proc: ExecProcess;
    try {
      proc = await withDeadline(
        execWhenReady(container, [BASH, "-c", `set -euo pipefail\n${script}`]),
        READY_MS,
        `container not ready within ${READY_MS / 60_000} min (not scheduled?)`,
      );
    } catch (e) {
      this.busy = false;
      return text(`### ERROR ${e}\n### EXIT 255 WALL ${secs(t0)}s\n`);
    }
    const stdout = proc.stdout;
    if (!stdout) throw new Error("exec returned no stdout");
    // Daemons the job leaves behind (kolu test servers, padi, …) inherit the
    // pipe and keep it open after the job exits. The job is over when its
    // process exits: then drain briefly and stop reading.
    const reader = stdout.getReader();
    // A client that goes away cancels its job (needs the
    // `enable_request_signal` compatibility flag). Kill only while running.
    let exited = false;
    const cancel = () => {
      if (!exited) proc.kill(9);
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    void proc.exitCode.then(() => {
      exited = true;
      request.signal.removeEventListener("abort", cancel);
      setTimeout(() => void reader.cancel().catch(() => {}), DRAIN_MS);
    });

    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    let last = Date.now();
    const beat = setInterval(() => {
      if (Date.now() - last >= HEARTBEAT_MS) {
        last = Date.now();
        void w.write(enc.encode(`### heartbeat ${new Date().toISOString()}\n`));
      }
    }, 5_000);
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          last = Date.now();
          await w.write(value);
        }
        const code = await proc.exitCode;
        const df = await container.exec(
          [BASH, "-c", "df -h / | tail -1; du -sh /nix/store"],
          { env: BASE_ENV },
        );
        const usage = new TextDecoder().decode((await df.output()).stdout);
        await w.write(
          enc.encode(`### disk ${usage.trim().replaceAll("\n", " | ")}\n`),
        );
        await w.write(enc.encode(`### EXIT ${code} WALL ${secs(t0)}s\n`));
      } catch (e) {
        await w.write(
          enc.encode(`### ERROR ${e}\n### EXIT 255 WALL ${secs(t0)}s\n`),
        );
      } finally {
        clearInterval(beat);
        this.busy = false;
        await w.close();
      }
    };
    this.ctx.waitUntil(pump());
    return new Response(readable, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

// exec() can reject while a freshly started container is still booting, and
// can also just wait for it; READY_MS bounds both.
async function execWhenReady(container: Container, cmd: string[]) {
  const deadline = Date.now() + READY_MS;
  for (;;) {
    try {
      return await container.exec(cmd, { env: BASE_ENV, stderr: "combined" });
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

function withDeadline<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(why)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

const secs = (t0: number) => ((Date.now() - t0) / 1000).toFixed(1);

const text = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

// Fan one request out to N instances (`shard-0` … `shard-{N-1}`), each running
// `just <recipe>` with CUCUMBER_SHARD=i/N, and interleave their output with a
// `[i/N]` prefix. Ends with one `### SHARD` summary line per shard and a
// `### EXIT` that is non-zero if any shard failed.
async function fanOut(env: Env, url: URL): Promise<Response> {
  const n = Number(url.searchParams.get("shards") ?? "4");
  if (!Number.isInteger(n) || n < 1 || n > 16)
    return text("shards must be 1..16\n", 400);
  const t0 = Date.now();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const results: string[] = [];
  const shard = async (i: number) => {
    const p = new URLSearchParams(url.searchParams);
    p.delete("shards");
    if (!p.has("recipe")) p.set("recipe", "test");
    p.append("env", `CUCUMBER_SHARD=${i + 1}/${n}`);
    const res = await env.RUNNER.getByName(`shard-${i}`).fetch(
      `http://runner/just?${p}`,
    );
    const tag = `[${i + 1}/${n}] `;
    let exit = "?";
    let buf = "";
    const dec = new TextDecoder();
    const flush = async (line: string) => {
      const m = /^### EXIT (\S+) WALL (\S+)/.exec(line);
      if (m) exit = `${m[1]} wall=${m[2]}`;
      await w.write(enc.encode(`${tag + line}\n`));
    };
    for await (const chunk of res.body ?? []) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) await flush(l);
    }
    if (buf) await flush(buf);
    results[i] = `### SHARD ${i + 1}/${n} exit=${exit}`;
  };
  const all = Promise.all(
    Array.from({ length: n }, (_, i) =>
      shard(i).catch((e) => {
        results[i] = `### SHARD ${i + 1}/${n} exit=255 error=${e}`;
      }),
    ),
  ).then(async () => {
    for (const r of results) await w.write(enc.encode(`${r}\n`));
    const ok = results.every((r) => r.includes("exit=0 "));
    await w.write(
      enc.encode(
        `### EXIT ${ok ? 0 : 1} WALL ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
      ),
    );
    await w.close();
  });
  void all;
  return new Response(readable, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.CI_TOKEN) return text("CI_TOKEN secret is not set\n", 500);
    if (request.headers.get("authorization") !== `Bearer ${env.CI_TOKEN}`) {
      return text("unauthorized\n", 401);
    }
    const url = new URL(request.url);
    if (url.pathname === "/e2e") return fanOut(env, url);
    if (url.pathname === "/restart-shards") {
      const n = Number(url.searchParams.get("shards") ?? "4");
      await Promise.all(
        Array.from({ length: n }, (_, i) =>
          env.RUNNER.getByName(`shard-${i}`).fetch("http://runner/restart"),
        ),
      );
      return text(`### destroyed shard-0..shard-${n - 1}\n`);
    }
    // Single-instance routes: /probe, /nix-build, /just, /restart.
    // ?instance= picks the Durable Object (default "main").
    const instance = url.searchParams.get("instance") ?? "main";
    return env.RUNNER.getByName(instance).fetch(
      new Request(`http://runner${url.pathname}${url.search}`),
    );
  },
};
