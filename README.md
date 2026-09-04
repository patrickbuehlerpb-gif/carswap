# CarSwap

Eine Tauschbörse für Autos zwischen Privatpersonen. Statt zu verkaufen und
danach zu kaufen — zwei Transaktionen, zwei Verhandlungen, zwei Mal
Händlermarge — wird direkt Fahrzeug gegen Fahrzeug getauscht. Weil die Werte
nie exakt gleich sind, berechnet die Plattform die Differenz transparent und
wickelt sie über ein Treuhandkonto ab.

Der Prototyp läuft vollständig auf Demo-Daten. Es gibt keine Datenbank und
keinen Login: Der Fahrzeugbestand ist fest hinterlegt, alles, was der Nutzer
selbst anlegt (Tauschanfragen, Merkliste), liegt im `localStorage` des
Browsers.

## Funktionen

| Bereich | Was es tut |
| --- | --- |
| **Marktplatz** (`/markt`) | Alle Inserate mit Filtern. Die Zuzahlung wird laufend gegen das eigene ausgewählte Fahrzeug gerechnet — man sieht immer, was ein Tausch unter dem Strich kostet. |
| **Matches** (`/matches`) | Sortiert Inserate nach der eigentlichen Frage eines Tauschmarkts: *Wollen beide?* Drei Gruppen — beidseitig, nur ich, nur die Gegenseite. Zusätzlich Ringtausch. |
| **Wertrechner** (`/wert`) | «Was ist mein Fahrzeug wert» mit Wertverlauf, Prognoseband, vollständiger Aufschlüsselung und Sensitivitätsanalyse. |
| **Fahrzeugdetail** (`/fahrzeug/[id]`) | Technische Daten, Wertverlauf, Bewertungsherleitung, Wunschliste des Inserenten. |
| **Tausch-Konfigurator** (`/tausch/[id]`) | Direktvergleich beider Fahrzeuge, Wertkurven übereinander, Ausgleich per Regler anpassbar samt Prüfung gegen den Rahmen der Gegenseite. |
| **Garage** (`/garage`) | Eigene Fahrzeuge mit Wert, monatlichem Wertverlust und den besten Tauschmöglichkeiten. Plus Merkliste. |
| **Tausche** (`/deals`) | Verhandlung, Zusage, Treuhand-Einzahlung, Übergabe-Checkliste, Abschluss. |

### Ringtausch

Das Grundproblem jedes Tauschmarkts ist die doppelte Bedarfskoinzidenz: Du
willst das Auto von A, aber A will deines nicht. `findRingSwaps()` sucht
deshalb Dreierkreise — du gibst an A, A gibt an B, B gibt an dich. Die drei
Ausgleichszahlungen summieren sich zu null, es fliesst also nur Geld zwischen
den Teilnehmern.

## Bewertungsmodell

`src/lib/valuation.ts` enthält ein nachvollziehbares Modell statt einer Black
Box. Der Wert entsteht aus:

1. **Restwertkurve** `r(t) = exp(−λ · t^0.7)`, wobei λ vom Antrieb abhängt
   (Elektro verliert schneller als Diesel) und mit einem Markenfaktor
   multipliziert wird. Porsche hält den Wert, Polestar und Zeekr deutlich
   weniger.
2. **Laufleistungskorrektur** gegen eine Norm von 15'000 km/Jahr, gedeckelt
   auf ±18 %.
3. **Multiplikative Faktoren**: Zustand, Serviceheft, Anzahl Halter,
   Unfallschaden und — beim Stromer — der Batteriezustand (SoH).
4. **Absolute Zu- und Abschläge**: bewertete Ausstattung, bekannte Mängel.
5. **Marktindex** je Antriebssegment, auf den Stichtag normiert. Er bildet ab,
   dass gebrauchte Elektroautos 2024 zusätzlich zur normalen Alterung
   eingebrochen sind und sich seit 2025 stabilisieren.

`valuate()` gibt die Aufschlüsselung so zurück, dass Listenpreis plus alle
ausgewiesenen Faktoren exakt dem Endwert entsprechen — man kann also über
jeden einzelnen Posten diskutieren.

`valueHistory()` rechnet dasselbe Modell für vergangene und künftige Monate
durch. Das Prognoseband wächst mit der Wurzel der Zeit.

Alle Berechnungen sind deterministisch. Das leichte Marktrauschen stammt aus
einem Hash über Fahrzeug-ID und Monat, nicht aus `Math.random()`, damit Server-
und Client-Rendering identische Werte liefern.

### Stichtag

Die Anwendung rechnet gegen den festen Stichtag `TODAY = "2026-09-01"`
(`src/lib/valuation.ts`). Für einen echten Betrieb wird daraus das aktuelle
Datum; für die Demo hält die Konstante die Zahlen reproduzierbar.

### Währung

Beträge sind in CHF, Formatierung in `src/lib/format.ts` (`CURRENCY`).
Zahlen werden bewusst ohne `Intl` formatiert, weil Node und Browser für
`de-CH` unterschiedliche Tausendertrennzeichen liefern und das zu
Hydration-Mismatches führt.

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm run typecheck
```

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4. Keine
Chart-Bibliothek — die Wertverlaufsgrafik ist handgeschriebenes SVG mit
HTML-Achsenbeschriftungen, damit die Schrift in schmalen wie breiten Spalten
gleich gross bleibt.

### Struktur

```
src/
  app/                 Routen (App Router)
    api/checkout/      Stripe-Checkout für die Treuhand-Einzahlung
  components/          UI, Charts, Konfiguratoren
  lib/
    types.ts           Domänenmodell
    valuation.ts       Bewertungs- und Prognosemodell
    matching.ts        Wunschabgleich, Scoring, Ringtausch
    format.ts          Zahlen-, Datums- und Farbformatierung
    store.tsx          Client-State (Tausche, Merkliste) mit localStorage
    data/              Demo-Fahrzeuge, Nutzer, Inserate, Tausche
```

## Zahlungen

`POST /api/checkout` legt eine Stripe-Checkout-Session für die
Ausgleichszahlung an. `payment_intent_data[capture_method] = manual` sorgt
dafür, dass der Betrag nur reserviert und erst nach beidseitiger
Übergabebestätigung eingezogen wird — genau das macht die Treuhandfunktion aus.

Ohne gesetzten `STRIPE_SECRET_KEY` antwortet die Route im Demo-Modus und der
Client simuliert die Einzahlung lokal. Der komplette Ablauf ist also auch ohne
Stripe-Konto durchspielbar.

```bash
cp .env.example .env.local   # und STRIPE_SECRET_KEY eintragen
```

Für den Produktivbetrieb fehlt noch die Freigabe der reservierten Zahlung
(`capture`) beim Abschluss sowie ein Webhook, der den Zahlungsstatus
zurückschreibt.

## Deployment

Auf Vercel ohne Konfiguration deploybar (Next.js wird automatisch erkannt).
Umgebungsvariablen: `STRIPE_SECRET_KEY` und optional `NEXT_PUBLIC_SITE_URL`
für die Redirect-URLs des Checkouts.

## Was für einen echten Betrieb fehlt

- Persistenz und Authentifizierung — aktuell ist alles Demo-Daten plus
  `localStorage`.
- Bewertungsdaten aus echten Inseraten statt aus einem parametrisierten Modell;
  die Restwertkurven sind plausibel kalibriert, aber nicht empirisch belegt.
- Identitätsprüfung, Fahrzeugausweis-Verifikation und Pfandrecht-Abfrage.
- Ringtausch-Abwicklung als atomarer Vorgang: alle drei Übergaben müssen
  zusammen gelten oder gar nicht.
- Stripe Connect für die Auszahlung an die Gegenseite statt nur Einzug.
