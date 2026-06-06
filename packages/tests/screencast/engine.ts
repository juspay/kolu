// AGNOSTIC screencast capture engine — knows NOTHING about kolu.
//
// Records a headful browser running inside an Xvfb virtual display via
// `ffmpeg -f x11grab` — capture happens OUTSIDE Chrome on a fixed clock in
// physical pixels, so it is structurally smooth (≥30 fps, decoupled from the
// compositor) AND crisp at true 2×. Then transcodes the raw clip into crisp,
// web-embeddable assets (mp4 + webm + poster).
//
// This is a graduation candidate for `@kolu/web-screencast` (see
// docs/atlas/src/content/atlas/welcome-live-screencast.mdx). It is kept as an
// isolated module with the dependency arrow pointing OUT — nothing here may
// import kolu domain — until a real second consumer earns the package.
//
// Requires `ffmpeg-full` (the x11grab input device; plain nixpkgs `ffmpeg` is
// built --disable-xlib) and `Xvfb` on PATH — provided by `./shell.nix`, which
// the `just record` recipe layers onto the e2e shell.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface Viewport {
  /** Logical (CSS) pixels. Physical capture size is width|height × scale. */
  width: number;
  height: number;
}

/** Start an Xvfb virtual display sized to the PHYSICAL capture resolution. */
export function startXvfb(
  display: string,
  width: number,
  height: number,
): ChildProcess {
  return spawn(
    "Xvfb",
    [display, "-screen", "0", `${width}x${height}x24`, "-nolisten", "tcp"],
    { stdio: "ignore" },
  );
}

/** Chrome flags for a chromeless, retina **app-mode** window at `url` — the
 *  same frameless surface an installed PWA uses (no tabs, no address bar). */
export function appModeArgs(opts: {
  url: string;
  scale: number;
  viewport: Viewport;
}): string[] {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    `--force-device-scale-factor=${opts.scale}`,
    "--window-position=0,0",
    `--window-size=${opts.viewport.width},${opts.viewport.height}`,
    "--hide-scrollbars",
    `--app=${opts.url}`,
  ];
}

/** Begin grabbing the framebuffer to a raw, high-quality H.264 file at a fixed
 *  frame rate. Returns the ffmpeg process — stop it with `stopX11Grab`. */
export function startX11Grab(opts: {
  display: string;
  width: number;
  height: number;
  fps?: number;
  out: string;
  logFile?: string;
}): ChildProcess {
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const fps = String(opts.fps ?? 30);
  let stdio: ("ignore" | number)[] | "ignore" = "ignore";
  if (opts.logFile) {
    const fd = fs.openSync(opts.logFile, "w");
    stdio = ["ignore", fd, fd];
  }
  return spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "x11grab",
      "-draw_mouse",
      "0",
      "-thread_queue_size",
      "4096",
      "-framerate",
      fps,
      "-video_size",
      `${opts.width}x${opts.height}`,
      "-i",
      `${opts.display}.0+0,0`,
      "-c:v",
      "libx264",
      "-crf",
      "16",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-r",
      fps,
      opts.out,
    ],
    { stdio },
  );
}

/** Stop grabbing cleanly: SIGINT lets ffmpeg flush the moov atom (a SIGKILL
 *  truncates the file). Awaits exit, with a hard-kill safety net. */
export function stopX11Grab(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGINT");
    setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000).unref?.();
  });
}

/** Transcode a raw clip into crisp, web-embeddable assets, trimming
 *  `trimStart` seconds of leading blank (the pre-navigation window). Emits an
 *  H.264 mp4 (universal), a VP9 webm (smaller, served first) and a WebP poster.
 *  Returns the output paths. */
export async function transcodeToWeb(opts: {
  raw: string;
  outDir: string;
  name: string;
  trimStart?: number;
  posterAt?: number;
}): Promise<{ mp4: string; webm: string; poster: string }> {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const ss = String(opts.trimStart ?? 0);
  const mp4 = path.join(opts.outDir, `${opts.name}.mp4`);
  const webm = path.join(opts.outDir, `${opts.name}.webm`);
  const poster = path.join(opts.outDir, `${opts.name}.webp`);
  // mp4: H.264, yuv420p + faststart for universal, instant-start playback.
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    "-ss",
    ss,
    "-i",
    opts.raw,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
    mp4,
  ]);
  // webm: VP9 (CRF ~32 ≈ x264 crf 18 — NOT 18), served first where supported.
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    "-ss",
    ss,
    "-i",
    opts.raw,
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "0",
    "-crf",
    "32",
    "-row-mt",
    "1",
    "-an",
    webm,
  ]);
  // poster: a representative frame as WebP (LCP element = video frame 1-ish).
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    "-ss",
    String(opts.posterAt ?? 1.5),
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-q:v",
    "82",
    poster,
  ]);
  return { mp4, webm, poster };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "inherit" });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
    p.on("error", reject);
  });
}
