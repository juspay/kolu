declare module "@pagefind/default-ui" {
  export interface PagefindResult {
    meta?: { section?: string; title?: string };
  }

  export interface PagefindUIOptions {
    element: string | HTMLElement;
    baseUrl?: string;
    bundlePath?: string;
    filters?: Record<string, string>;
    processResult?: (result: PagefindResult) => PagefindResult;
    showImages?: boolean;
    showSubResults?: boolean;
  }

  export class PagefindUI {
    constructor(options: PagefindUIOptions);
  }
}
