export interface KoluBootFlags {
  readonly bind: string;
  readonly port: number;
  readonly tls: boolean;
  readonly tlsCert: string | undefined;
  readonly tlsKey: string | undefined;
  readonly verbose: boolean;
  readonly allowNixShellWithEnvWhitelist: string | undefined;
}
