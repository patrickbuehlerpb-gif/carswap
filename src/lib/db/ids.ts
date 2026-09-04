import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-Base32 ohne i, l, o, u

/**
 * Kurze, URL-sichere, kollisionsarme IDs mit sprechendem Präfix.
 * 16 Zeichen aus 32 Symbolen entsprechen 80 Bit Entropie.
 */
export function newId(prefix: string, length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}
