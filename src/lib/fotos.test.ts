import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Woher ein Foto stammt, entscheidet nicht mehr ein geratener Hostname.
 *
 * Der schnelle Weg bleibt der Vergleich mit dem abgeleiteten Namen — er
 * kostet nichts und trifft im Normalfall zu. Stimmt er nicht, wird der
 * Speicher gefragt statt abgewiesen: Eine falsche Ableitung würde sonst jedes
 * Foto zurückweisen, und seit ein Inserat drei Fotos braucht, entstünde
 * überhaupt kein Inserat mehr.
 */

const kopfAufrufe: string[] = [];
let eigeneAdressen = new Set<string>();

vi.mock("@vercel/blob", () => ({
  head: async (url: string) => {
    kopfAufrufe.push(url);
    if (!eigeneAdressen.has(url)) throw new Error("Vercel Blob: The requested blob does not exist");
    return { url, size: 1234 };
  },
}));

const { fremdeFotoAdressen } = await import("@/lib/fotos");

const TOKEN = "vercel_blob_rw_pruefspeicher_ABCDEFGHIJKLMNOP";
const EIGEN = "https://pruefspeicher.public.blob.vercel-storage.com";
const FREMD = "https://jemandanders.public.blob.vercel-storage.com";

let vorher: Record<string, string | undefined> = {};

beforeEach(() => {
  kopfAufrufe.length = 0;
  eigeneAdressen = new Set();
  vorher = {
    token: process.env.BLOB_READ_WRITE_TOKEN,
    host: process.env.BLOB_PUBLIC_HOST,
  };
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
  delete process.env.BLOB_PUBLIC_HOST;
});

afterEach(() => {
  // `process.env.X = undefined` schriebe die Zeichenkette "undefined" hinein,
  // und alle Testdateien teilen sich einen Prozess.
  for (const [name, wert] of [
    ["BLOB_READ_WRITE_TOKEN", vorher.token],
    ["BLOB_PUBLIC_HOST", vorher.host],
  ] as const) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }
});

describe("Herkunft der Fotos", () => {
  it("winkt Adressen des eigenen Speichers ohne Rückfrage durch", async () => {
    const urls = [`${EIGEN}/a.webp`, `${EIGEN}/b.webp`, `${EIGEN}/c.webp`];
    expect(await fremdeFotoAdressen(urls)).toEqual([]);
    // Der schnelle Weg: kein einziger Netzaufruf beim Speichern eines Inserats.
    expect(kopfAufrufe).toEqual([]);
  });

  it("weist eine Adresse aus einem fremden Speicher ab", async () => {
    // Sie sieht richtig aus und besteht die Formprüfung des Schemas — nur
    // liegt sie in einem anderen Konto. Ohne diese Prüfung hinge ein fremdes
    // Bild im Inserat.
    const fremd = `${FREMD}/geklaut.webp`;
    expect(await fremdeFotoAdressen([`${EIGEN}/a.webp`, fremd])).toEqual([fremd]);
    expect(kopfAufrufe).toEqual([fremd]);
  });

  it("nimmt ein eigenes Foto auch dann an, wenn der Hostname anders lautet", async () => {
    // Der Fall, für den es die Rückfrage gibt: die Ableitung aus der
    // Store-Kennung liegt daneben. Vorher wäre hier jedes Foto abgewiesen
    // worden — und damit jedes Inserat.
    const anders = "https://echterspeicher.public.blob.vercel-storage.com/a.webp";
    eigeneAdressen.add(anders);
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await fremdeFotoAdressen([anders])).toEqual([]);
    expect(kopfAufrufe).toEqual([anders]);
    // Und es bleibt nicht unbemerkt: im Protokoll steht, wie es sich beheben lässt.
    expect(fehler.mock.calls[0]?.[0]).toMatch(/BLOB_PUBLIC_HOST=echterspeicher/);
    fehler.mockRestore();
  });

  it("folgt BLOB_PUBLIC_HOST, wenn er gesetzt ist", async () => {
    process.env.BLOB_PUBLIC_HOST = "Echterspeicher.public.blob.vercel-storage.com";
    expect(await fremdeFotoAdressen(["https://echterspeicher.public.blob.vercel-storage.com/a.webp"]))
      .toEqual([]);
    expect(kopfAufrufe).toEqual([]);
  });

  it("weist eine kaputte Adresse ab, ohne zu fragen", async () => {
    expect(await fremdeFotoAdressen(["kein-url"])).toEqual(["kein-url"]);
    expect(kopfAufrufe).toEqual([]);
  });

  it("prüft nichts, solange gar kein Speicher eingerichtet ist", async () => {
    // Ohne eigenen Speicher gibt es nichts, wogegen sich abgrenzen liesse —
    // das ist der lokale Normalzustand, kein Sicherheitsloch.
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(await fremdeFotoAdressen([`${FREMD}/a.webp`])).toEqual([]);
    expect(kopfAufrufe).toEqual([]);
  });
});
