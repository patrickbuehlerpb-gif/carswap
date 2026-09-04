import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Fotos gehen direkt vom Browser zu Vercel Blob. Diese Route stellt nur das
 * kurzlebige Upload-Token aus — so umgeht der Upload die 1-MB-Grenze von
 * Server Actions und belastet die Anwendung nicht mit Dateiinhalten.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Fotouploads sind nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt)." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const user = await getSessionUser();
        if (!user) throw new Error("Nicht angemeldet.");
        // Ohne Begrenzung könnte ein angemeldetes Konto den Blob-Speicher
        // beliebig vollschreiben — die Kosten trägt der Betreiber.
        const limit = await checkRateLimit(`upload:${user.id}`, 60, 24 * 60 * 60);
        if (!limit.ok) {
          throw new Error("Zu viele Uploads in den letzten 24 Stunden. Bitte morgen weitermachen.");
        }
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Nur protokollieren — die Zuordnung zum Fahrzeug passiert beim
        // Speichern des Inserats, damit verwaiste Uploads nichts verändern.
        console.info("[blob] Upload fertig", blob.pathname, tokenPayload);
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
