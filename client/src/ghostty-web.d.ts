/**
 * Ambient type declarations for ghostty-web.
 *
 * The runtime module is provided by Nix (latest git build) and aliased via
 * Vite's resolve.alias — see vite.config.ts. These declarations give
 * TypeScript the type information it needs for `tsc --noEmit`.
 */
declare module "ghostty-web" {
  export interface ITheme {
    foreground?: string;
    background?: string;
    cursor?: string;
    cursorAccent?: string;
    selectionBackground?: string;
    selectionForeground?: string;
    black?: string;
    red?: string;
    green?: string;
    yellow?: string;
    blue?: string;
    magenta?: string;
    cyan?: string;
    white?: string;
    brightBlack?: string;
    brightRed?: string;
    brightGreen?: string;
    brightYellow?: string;
    brightBlue?: string;
    brightMagenta?: string;
    brightCyan?: string;
    brightWhite?: string;
  }

  export interface ITerminalOptions {
    cols?: number;
    rows?: number;
    cursorBlink?: boolean;
    cursorStyle?: "block" | "underline" | "bar";
    theme?: ITheme;
    scrollback?: number;
    fontSize?: number;
    fontFamily?: string;
    allowTransparency?: boolean;
    convertEol?: boolean;
    disableStdin?: boolean;
    smoothScrollDuration?: number;
  }

  export interface IEvent<T> {
    (listener: (e: T) => void): { dispose(): void };
  }

  export class Terminal {
    cols: number;
    rows: number;
    element?: HTMLElement;
    textarea?: HTMLTextAreaElement;
    readonly options: Required<ITerminalOptions>;
    wasmTerm?: unknown;
    renderer?: {
      setTheme(theme: ITheme): void;
      render(
        wasmTerm: unknown,
        force: boolean,
        viewportY: number,
        terminal: Terminal,
      ): void;
    };
    viewportY: number;
    readonly onData: IEvent<string>;
    readonly onResize: IEvent<{ cols: number; rows: number }>;
    constructor(options?: ITerminalOptions);
    open(parent: HTMLElement): void;
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    reset(): void;
    dispose(): void;
  }

  export function init(): Promise<void>;
}
