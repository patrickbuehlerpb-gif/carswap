import "server-only";
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/** promisify() trifft bei scrypt die falsche Überladung, deshalb von Hand. */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    );
  });
}

/** Kostenparameter — bewusst so gewählt, dass ein Hash rund 100 ms braucht. */
const N = 32_768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Passwort-Hash im Format `scrypt$N$r$p$salt$hash` (beides base64url).
 * scrypt kommt aus node:crypto — keine nativen Abhängigkeiten, die beim
 * Deployment brechen können.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Prüft ein Passwort gegen einen gespeicherten Hash, in konstanter Zeit. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }

  let key: Buffer;
  try {
    key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }

  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * Mindestanforderungen an ein Passwort. Länge schlägt Zeichenklassen —
 * deshalb 10 Zeichen statt Sonderzeichenzwang.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Das Passwort muss mindestens 10 Zeichen haben.";
  if (password.length > 200) return "Das Passwort darf höchstens 200 Zeichen haben.";
  if (/^\s|\s$/.test(password)) return "Das Passwort darf nicht mit einem Leerzeichen beginnen oder enden.";
  const common = ["passwort123", "12345678910", "carswap123", "qwertzuiop"];
  if (common.includes(password.toLowerCase())) return "Dieses Passwort ist zu leicht zu erraten.";
  return null;
}
