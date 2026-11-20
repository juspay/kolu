import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface LogicalViewport {
  width: number;
  height: number;
}

export interface PhysicalSize {
  width: number;
  height: number;
}

export function physicalSize(opts: {
  viewport: LogicalViewport;
  scale: number;
}): PhysicalSize {
  return {
    width: opts.viewport.width * opts.scale,
    height: opts.viewport.height * opts.scale,
  };
}

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

export function captureWindowArgs(opts: {
  scale: number;
  viewport: LogicalViewport;
}): string[] {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    `--force-device-scale-factor=${opts.scale}`,
    "--window-position=0,0",
    `--window-size=${opts.viewport.width},${opts.viewport.height}`,
    "--hide-scrollbars",
  ];
}

export function appModeArgs(opts: {
  url: string;
  scale: number;
  viewport: LogicalViewport;
}): string[] {
  return [...captureWindowArgs(opts), `--app=${opts.url}`];
}

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
      "ultrafast",
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
  await Promise.all([
    runFfmpeg([
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
    ]),
    // webm: VP9 (CRF ~32 ≈ x264 crf 18 — NOT 18), served first where supported.
    runFfmpeg([
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
    ]),
  ]);
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
