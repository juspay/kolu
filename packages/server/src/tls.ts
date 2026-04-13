import { readFileSync } from "node:fs";
import { log } from "./log.ts";

export interface TlsOptions {
  key: string | Buffer;
  cert: string;
}

/**
 * Resolve TLS options from CLI flags.
 * Returns null when TLS is not requested.
 */
export async function resolveTlsOptions(flags: {
  tls: boolean;
  tlsCert?: string;
  tlsKey?: string;
}): Promise<TlsOptions | null> {
  if ((flags.tlsCert && !flags.tlsKey) || (!flags.tlsCert && flags.tlsKey)) {
    log.fatal("--tls-cert and --tls-key must be used together");
    process.exit(1);
  }

  if (flags.tlsCert && flags.tlsKey) {
    log.info(
      { cert: flags.tlsCert, key: flags.tlsKey },
      "using provided TLS certificate",
    );
    try {
      return {
        key: readFileSync(flags.tlsKey),
        cert: readFileSync(flags.tlsCert, "utf-8"),
      };
    } catch (err) {
      log.fatal({ err }, "failed to read TLS certificate/key files");
      process.exit(1);
    }
  }

  if (flags.tls) {
    log.info("generating self-signed certificate");
    const { generate } = await import("selfsigned");
    const pems = await generate([{ name: "commonName", value: "localhost" }], {
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
            { type: 7, ip: "::1" },
          ],
        },
      ],
    });
    return { key: pems.private, cert: pems.cert };
  }

  return null;
}
