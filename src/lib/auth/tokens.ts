import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { newId } from "../db/ids";
import { authTokens } from "../db/schema";

type Purpose = "verify_email" | "reset_password" | "change_email";

const TTL: Record<Purpose, number> = {
  verify_email: 7 * 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
  change_email: 24 * 60 * 60 * 1000,
};

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Erzeugt ein Einmal-Token und gibt den Klartext zurück (nur für den Versand). */
export async function issueToken(userId: string, purpose: Purpose): Promise<string> {
  // Ältere, noch offene Token desselben Zwecks entwerten
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));

  const token = randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({
    id: newId("tok"),
    userId,
    purpose,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + TTL[purpose]),
  });
  return token;
}

/** Löst ein Token ein. Gibt die userId zurück oder null, wenn ungültig. */
export async function consumeToken(token: string, purpose: Purpose): Promise<string | null> {
  const rows = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hash(token)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Einlösen ist bedingt: nur wenn usedAt noch leer ist, damit ein doppelter
  // Klick nicht zweimal zählt.
  const updated = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, row.id), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id });

  return updated.length ? row.userId : null;
}
