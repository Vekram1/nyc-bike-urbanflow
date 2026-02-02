import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { SvAlgo } from "./types";

export function base64UrlEncode(input: Uint8Array): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const withPad = padded + "=".repeat(padLength);
  return new Uint8Array(Buffer.from(withPad, "base64"));
}

export function jsonToBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  return base64UrlEncode(new TextEncoder().encode(json));
}

export function base64UrlToJson<T>(value: string): T {
  const bytes = base64UrlDecode(value);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

export function algoToHash(algo: SvAlgo): "sha256" | "sha512" {
  return algo === "HS512" ? "sha512" : "sha256";
}

export function hmacSign(algo: SvAlgo, secret: Uint8Array, data: string): string {
  const hash = algoToHash(algo);
  const hmac = createHmac(hash, Buffer.from(secret));
  hmac.update(data);
  return base64UrlEncode(hmac.digest());
}

export function hmacVerify(
  algo: SvAlgo,
  secret: Uint8Array,
  data: string,
  signatureB64: string
): boolean {
  const expected = hmacSign(algo, secret, data);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signatureB64);
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, actualBytes);
}

export function sha256Hex(data: string): string {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}
