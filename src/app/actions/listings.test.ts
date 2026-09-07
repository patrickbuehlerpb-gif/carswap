import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings, vehicles } from "@/lib/db/schema";
import { als, createUser, resetDatabase } from "@/test/fixtures";
import { createListingAction, updateListingAction } from "@/app/actions/listings";
import { MIN_FOTOS } from "@/lib/validation";

/**
 * Ein Auto ohne Bilder ist kein Angebot, sondern eine Behauptung. Seit ein
 * Inserat mindestens drei Fotos braucht, muss diese Grenze an beiden Stellen
 * halten: beim Anlegen und beim Bearbeiten. Sonst liesse sich ein Inserat mit
 * drei Bildern veröffentlichen und die Bilder gleich danach wieder entfernen.
 */

// Die Kennung im Token bestimmt den erlaubten Fotohost — genau wie im Betrieb.
const TOKEN = "vercel_blob_rw_pruefspeicher_ABCDEFGHIJKLMNOP";
const HOST = "https://pruefspeicher.public.blob.vercel-storage.com";

/*
 * Der Speicher wird nachgebaut, nicht angesprochen: Adressen unseres Hosts
 * gehen ohne Rückfrage durch, für alle anderen fragt die Anwendung nach — und
 * eine echte Anfrage mit einem erfundenen Token hätte in einem Testlauf nichts
 * verloren.
 */
vi.mock("@vercel/blob", () => ({
  head: async (url: string) => {
    throw new Error(`Vercel Blob: The requested blob does not exist (${url})`);
  },
}));

let vorher: string | undefined;

beforeEach(async () => {
  await resetDatabase();
  // Alle Testdateien teilen sich einen Prozess: was hier gesetzt wird, muss
  // hier auch wieder weg — sonst gilt die Fotopflicht in jeder folgenden.
  vorher = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
});

afterEach(() => {
  if (vorher === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = vorher;
});

function fotos(anzahl: number) {
  return Array.from({ length: anzahl }, (_, i) => ({
    url: `${HOST}/auto-${i}.webp`,
    width: 1600,
    height: 900,
  }));
}

function eingabe(anzahl: number) {
  return {
    make: "Polestar",
    model: "4",
    firstRegistration: "2024-03",
    mileageKm: 12_000,
    fuel: "elektro",
    body: "suv",
    drivetrain: "heck",
    powerPs: 272,
    listPriceNew: 60_000,
    condition: "gut",
    serviceHistory: "lückenlos scheckheft",
    previousOwners: 1,
    accidentFree: true,
    mfkUntil: "",
    photos: fotos(anzahl),
    wishMakes: [],
    wishBodies: [],
    wishFuels: [],
    askPremium: 0,
  };
}

describe("Fotopflicht beim Anlegen", () => {
  it("nimmt kein Inserat ohne Fotos an", async () => {
    const ich = await createUser("Anna");
    als(ich);

    const res = await createListingAction(eingabe(0));
    expect(res.error).toMatch(/mindestens 3 Fotos/);
    expect(await db.select().from(listings)).toHaveLength(0);
    expect(await db.select().from(vehicles)).toHaveLength(0);
  });

  it("sagt, wie viele noch fehlen", async () => {
    const ich = await createUser("Anna");
    als(ich);

    expect((await createListingAction(eingabe(1))).error).toMatch(/Noch 2 Fotos/);
    expect((await createListingAction(eingabe(2))).error).toMatch(/Noch ein Foto/);
  });

  it("lässt es ab drei Fotos durch", async () => {
    const ich = await createUser("Anna");
    als(ich);

    const res = await createListingAction(eingabe(MIN_FOTOS));
    expect(res.error).toBeUndefined();
    expect(res.vehicleId).toBeDefined();
    const [fahrzeug] = await db.select().from(vehicles).where(eq(vehicles.id, res.vehicleId!));
    expect(fahrzeug.photos).toHaveLength(MIN_FOTOS);
  });

  it("kostet keinen Platz des Tageskontingents", async () => {
    // Zehn Inserate am Tag sind erlaubt. Wer zwölfmal ohne Fotos abgewiesen
    // wird, muss danach immer noch eines anlegen können — geprüft wird vor
    // dem Zählen.
    const ich = await createUser("Anna");
    als(ich);
    for (let i = 0; i < 12; i++) {
      expect((await createListingAction(eingabe(0))).error).toMatch(/mindestens/);
    }
    expect((await createListingAction(eingabe(MIN_FOTOS))).error).toBeUndefined();
  });
});

describe("Fotopflicht beim Bearbeiten", () => {
  async function angelegt() {
    const ich = await createUser("Anna");
    als(ich);
    const res = await createListingAction(eingabe(MIN_FOTOS));
    expect(res.error).toBeUndefined();
    return { ich, vehicleId: res.vehicleId! };
  }

  it("lässt die Bilder nicht nachträglich wieder entfernen", async () => {
    const { vehicleId } = await angelegt();

    const res = await updateListingAction(vehicleId, { ...eingabe(1), mileageKm: 13_000 });
    expect(res.error).toMatch(/Noch 2 Fotos/);

    // Und nichts davon ist gespeichert worden.
    const [fahrzeug] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(fahrzeug.photos).toHaveLength(MIN_FOTOS);
    expect(fahrzeug.mileageKm).toBe(12_000);
  });

  it("lässt Ändern zu, solange drei bleiben", async () => {
    const { vehicleId } = await angelegt();

    const res = await updateListingAction(vehicleId, { ...eingabe(4), mileageKm: 13_000 });
    expect(res.error).toBeUndefined();
    const [fahrzeug] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(fahrzeug.photos).toHaveLength(4);
    expect(fahrzeug.mileageKm).toBe(13_000);
  });
});

describe("Ohne eingerichteten Fotospeicher", () => {
  it("verlangt keine Fotos — sonst entstünde gar kein Inserat mehr", async () => {
    // Auf einer Installation ohne Blob-Speicher ist der Uploadknopf tot. Eine
    // Pflicht, die sich nicht erfüllen lässt, wäre dort keine Regel, sondern
    // eine Sperre.
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const ich = await createUser("Anna");
    als(ich);

    const res = await createListingAction({ ...eingabe(0) });
    expect(res.error).toBeUndefined();
  });
});

describe("Herkunft der Fotos beim Anlegen", () => {
  it("nimmt kein Bild an, das nicht aus unserem Speicher kommt", async () => {
    const ich = await createUser("Anna");
    als(ich);

    // Formal einwandfrei — https, richtiger Dienst —, aber ein fremder
    // Speicher. Ohne diese Prüfung hinge das Bild eines anderen Kontos im
    // Inserat, und die Kosten dafür trüge jemand anderes.
    const eingabeMitFremdem = {
      ...eingabe(MIN_FOTOS),
      photos: [
        ...fotos(2),
        {
          url: "https://jemandanders.public.blob.vercel-storage.com/geklaut.webp",
          width: 1600,
          height: 900,
        },
      ],
    };

    const res = await createListingAction(eingabeMitFremdem);
    expect(res.error).toMatch(/nicht aus dem Upload dieser Seite/);
    expect(await db.select().from(listings)).toHaveLength(0);
    expect(await db.select().from(vehicles)).toHaveLength(0);
  });

  it("lässt es beim Bearbeiten ebenso wenig durch", async () => {
    const ich = await createUser("Anna");
    als(ich);
    const angelegt = await createListingAction(eingabe(MIN_FOTOS));
    expect(angelegt.error).toBeUndefined();

    const res = await updateListingAction(angelegt.vehicleId!, {
      ...eingabe(MIN_FOTOS),
      photos: [
        ...fotos(2),
        { url: "https://jemandanders.public.blob.vercel-storage.com/x.webp", width: 100, height: 100 },
      ],
    });
    expect(res.error).toMatch(/nicht aus dem Upload dieser Seite/);

    // Die alten Bilder stehen unverändert.
    const [fahrzeug] = await db.select().from(vehicles).where(eq(vehicles.id, angelegt.vehicleId!));
    expect(fahrzeug.photos?.every((p) => p.url.startsWith(HOST))).toBe(true);
  });
});
