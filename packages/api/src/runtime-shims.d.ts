// Local runtime shims so editor/typecheck can understand Bun + process globals
// in this package without requiring extra dependency installation.

declare module "bun" {
  export class SQL {
    constructor(connectionString: string);
    unsafe(query: string, params?: Array<unknown>): Promise<Array<Record<string, unknown>>>;
  }
}

declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

declare const Bun: {
  serve(options: {
    hostname?: string;
    port?: number;
    fetch: (request: Request) => Response | Promise<Response>;
    error?: (error: Error) => Response;
  }): { port: number; hostname?: string };
  file(path: string): Blob;
  write(path: string, data: string | Blob | Uint8Array): Promise<number>;
};
