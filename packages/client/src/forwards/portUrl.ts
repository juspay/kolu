import { hostAuthority } from "@kolu/url-shape";

export function portUrl(
  hostname: string,
  port: number,
  protocol: "http:" | "https:" = "http:",
): string {
  return `${protocol}//${hostAuthority(hostname, port)}`;
}
