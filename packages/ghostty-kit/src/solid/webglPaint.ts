/** Host WebGL paint over official Ghostty render-state cells. */

import type { RenderFrame, RenderRgb } from "../renderState.ts";

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute vec4 a_color;
uniform vec2 u_res;
varying vec2 v_uv;
varying vec4 v_color;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
varying vec4 v_color;
uniform sampler2D u_tex;
uniform float u_use_tex;
void main() {
  float a = u_use_tex > 0.5 ? texture2D(u_tex, v_uv).a : 1.0;
  gl_FragColor = vec4(v_color.rgb, v_color.a * a);
}
`;

export function obtainWebgl(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl =
    canvas.getContext("webgl2") ??
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl");
  if (!gl || typeof (gl as WebGLRenderingContext).drawArrays !== "function") {
    throw new Error("@kolu/ghostty-kit: WebGL is required to paint the tile");
  }
  return gl as WebGLRenderingContext;
}

export function contextKind(gl: WebGLRenderingContext): "webgl" | "webgl2" {
  return typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext
    ? "webgl2"
    : "webgl";
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("@kolu/ghostty-kit: createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(
      `@kolu/ghostty-kit: shader: ${gl.getShaderInfoLog(sh) ?? "compile failed"}`,
    );
  }
  return sh;
}

type Glyph = { u: number; v: number; uw: number; vh: number };

export interface WebglPainter {
  readonly kind: "webgl" | "webgl2";
  resize(cssW: number, cssH: number, dpr: number): void;
  paint(
    frame: RenderFrame,
    cell: { w: number; h: number },
    font: { size: number; family: string },
    themeFg: RenderRgb,
    themeBg: RenderRgb,
  ): void;
}

export function createWebglPainter(canvas: HTMLCanvasElement): WebglPainter {
  const gl = obtainWebgl(canvas);
  const prog = gl.createProgram();
  if (!prog) throw new Error("@kolu/ghostty-kit: createProgram failed");
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(
      `@kolu/ghostty-kit: program: ${gl.getProgramInfoLog(prog) ?? "link failed"}`,
    );
  }
  const aPos = gl.getAttribLocation(prog, "a_pos");
  const aUv = gl.getAttribLocation(prog, "a_uv");
  const aColor = gl.getAttribLocation(prog, "a_color");
  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTex = gl.getUniformLocation(prog, "u_tex");
  const uUseTex = gl.getUniformLocation(prog, "u_use_tex");

  const atlasSize = 1024;
  const atlas = document.createElement("canvas");
  atlas.width = atlasSize;
  atlas.height = atlasSize;
  const atlas2d = atlas.getContext("2d");
  if (!atlas2d) throw new Error("@kolu/ghostty-kit: atlas 2d failed");
  const tex = gl.createTexture();
  if (!tex) throw new Error("@kolu/ghostty-kit: createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

  const glyphs = new Map<string, Glyph>();
  let packX = 1;
  let packY = 1;
  let packRow = 1;

  function bake(
    ch: string,
    bold: boolean,
    italic: boolean,
    cellW: number,
    cellH: number,
    fontSize: number,
    fontFamily: string,
  ): Glyph {
    const key = `${bold ? "b" : ""}${italic ? "i" : ""}:${ch}`;
    const hit = glyphs.get(key);
    if (hit) return hit;
    const gw = Math.max(1, cellW);
    const gh = Math.max(1, cellH);
    if (packX + gw + 1 > atlasSize) {
      packX = 1;
      packY += packRow + 1;
      packRow = 1;
    }
    if (packY + gh + 1 > atlasSize) {
      atlas2d.clearRect(0, 0, atlasSize, atlasSize);
      glyphs.clear();
      packX = 1;
      packY = 1;
      packRow = 1;
    }
    const x = packX;
    const y = packY;
    atlas2d.clearRect(x, y, gw, gh);
    atlas2d.fillStyle = "#fff";
    atlas2d.textBaseline = "top";
    atlas2d.font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${fontSize}px ${fontFamily}`;
    atlas2d.fillText(ch, x, y);
    packX += gw + 1;
    packRow = Math.max(packRow, gh);
    const g: Glyph = {
      u: x / atlasSize,
      v: y / atlasSize,
      uw: gw / atlasSize,
      vh: gh / atlasSize,
    };
    glyphs.set(key, g);
    return g;
  }

  const buf = gl.createBuffer();
  if (!buf) throw new Error("@kolu/ghostty-kit: createBuffer failed");

  function drawQuads(data: Float32Array, useTex: boolean): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 16);
    gl.uniform1f(uUseTex, useTex ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
  }

  return {
    kind: contextKind(gl),
    resize(cssW, cssH, dpr) {
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    paint(frame, cell, font, themeFg, themeBg) {
      const cssW = frame.cols * cell.w;
      const cssH = frame.rows * cell.h;
      const bg = frame.background;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(bg.r / 255, bg.g / 255, bg.b / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform2f(uRes, cssW, cssH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const bgVerts: number[] = [];
      const fgVerts: number[] = [];
      for (const c of frame.cells) {
        const x0 = c.x * cell.w;
        const y0 = c.y * cell.h;
        const x1 = x0 + cell.w;
        const y1 = y0 + cell.h;
        let fg = c.fg ?? themeFg;
        let cellBg = c.bg;
        if (c.inverse) {
          const swap = fg;
          fg = cellBg ?? themeBg;
          cellBg = swap;
        }
        if (cellBg) {
          const r = cellBg.r / 255;
          const g = cellBg.g / 255;
          const b = cellBg.b / 255;
          bgVerts.push(
            x0,
            y0,
            0,
            0,
            r,
            g,
            b,
            1,
            x1,
            y0,
            0,
            0,
            r,
            g,
            b,
            1,
            x0,
            y1,
            0,
            0,
            r,
            g,
            b,
            1,
            x0,
            y1,
            0,
            0,
            r,
            g,
            b,
            1,
            x1,
            y0,
            0,
            0,
            r,
            g,
            b,
            1,
            x1,
            y1,
            0,
            0,
            r,
            g,
            b,
            1,
          );
        }
        const glyph = bake(
          c.text,
          c.bold,
          c.italic,
          cell.w,
          cell.h,
          font.size,
          font.family,
        );
        const a = c.faint ? 0.5 : 1;
        const r = fg.r / 255;
        const g = fg.g / 255;
        const b = fg.b / 255;
        fgVerts.push(
          x0,
          y0,
          glyph.u,
          glyph.v,
          r,
          g,
          b,
          a,
          x1,
          y0,
          glyph.u + glyph.uw,
          glyph.v,
          r,
          g,
          b,
          a,
          x0,
          y1,
          glyph.u,
          glyph.v + glyph.vh,
          r,
          g,
          b,
          a,
          x0,
          y1,
          glyph.u,
          glyph.v + glyph.vh,
          r,
          g,
          b,
          a,
          x1,
          y0,
          glyph.u + glyph.uw,
          glyph.v,
          r,
          g,
          b,
          a,
          x1,
          y1,
          glyph.u + glyph.uw,
          glyph.v + glyph.vh,
          r,
          g,
          b,
          a,
        );
        if (c.underline) {
          const uy0 = y1 - 1;
          bgVerts.push(
            x0,
            uy0,
            0,
            0,
            r,
            g,
            b,
            1,
            x1,
            uy0,
            0,
            0,
            r,
            g,
            b,
            1,
            x0,
            y1,
            0,
            0,
            r,
            g,
            b,
            1,
            x0,
            y1,
            0,
            0,
            r,
            g,
            b,
            1,
            x1,
            uy0,
            0,
            0,
            r,
            g,
            b,
            1,
            x1,
            y1,
            0,
            0,
            r,
            g,
            b,
            1,
          );
        }
      }
      if (frame.cursor?.visible) {
        const x0 = frame.cursor.x * cell.w;
        const y0 = frame.cursor.y * cell.h;
        const x1 = x0 + Math.max(1, Math.floor(cell.w * 0.15));
        const y1 = y0 + cell.h;
        const r = themeFg.r / 255;
        const g = themeFg.g / 255;
        const b = themeFg.b / 255;
        bgVerts.push(
          x0,
          y0,
          0,
          0,
          r,
          g,
          b,
          1,
          x1,
          y0,
          0,
          0,
          r,
          g,
          b,
          1,
          x0,
          y1,
          0,
          0,
          r,
          g,
          b,
          1,
          x0,
          y1,
          0,
          0,
          r,
          g,
          b,
          1,
          x1,
          y0,
          0,
          0,
          r,
          g,
          b,
          1,
          x1,
          y1,
          0,
          0,
          r,
          g,
          b,
          1,
        );
      }
      if (bgVerts.length > 0) {
        drawQuads(new Float32Array(bgVerts), false);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        atlas,
      );
      if (fgVerts.length > 0) {
        drawQuads(new Float32Array(fgVerts), true);
      }
    },
  };
}

export function parseCssRgb(
  css: string | undefined,
  fallback: RenderRgb,
): RenderRgb {
  if (!css) return fallback;
  const hex = css.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
