import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { newId } from "../db/ids";
import { authTokens } from "../db/schema";
import { hashToken as hash } from "./token-hash";

type Purpose = "verify_email" | "reset_password" | "change_email";

const TTL: Record<Purpose, number> = {
  verify_email: 7 * 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
  change_email: 24 * 60 * 60 * 1000,
};

/*
 * Dieselbe Ableitung wie bei den Sitzungen — und deshalb aus derselben Quelle.
 * Vorher stand die Funktion hier ein zweites Mal Zeichen für Zeichen; wer die
 * Ableitung einmal ändert (ein Pfeffer, ein anderes Verfahren), hätte sie
 * sonst für Sitzungen geändert und für Token nicht.
 */

/**
 * Erzeugt ein Einmal-Token und gibt den Klartext zurück (nur für den Versand).
 *
 * `target` hält fest, wofür das Token gilt — beim Adresswechsel die angefragte
 * Adresse. Beim Einlösen zählt dann diese und nicht, was inzwischen in der
 * Kontozeile steht.
 */
export async function issueToken(
  userId: string,
  purpose: Purpose,
  target?: string,
): Promise<string> {
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
    target: target ?? null,
    expiresAt: new Date(Date.now() + TTL[purpose]),
  });
  return token;
}

export interface EingeloestesToken {
  userId: string;
  /** Wofür es galt — beim Adresswechsel die angefragte Adresse. */
  target: string | null;
}

/**
 * Löst ein Token ein. Gibt Konto und Ziel zurück oder null, wenn ungültig.
 */
export async function consumeToken(
  token: string,
  purpose: Purpose,
): Promise<EingeloestesToken | null> {
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

  return updated.length ? { userId: row.userId, target: row.target } : null;
}
