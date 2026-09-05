# quitt

Eine Tauschbörse für Autos zwischen Privatpersonen. Verkaufen und danach kaufen
sind zwei Geschäfte, zwei Verhandlungen und zweimal Händlermarge. Hier wird
direkt Auto gegen Auto getauscht. Weil zwei Autos nie genau gleich viel wert
sind, rechnet die Plattform die Differenz nachvollziehbar aus und verwahrt sie,
bis beide Seiten die Übergabe bestätigt haben.

Im Produkt heisst das Wort «Treuhand» nirgends so. Es wird beschrieben, was
passiert: der Betrag wird hinterlegt, er liegt bei uns, er wird ausgezahlt.
Intern trägt der Zustand weiterhin den Namen `treuhand` — das ist der
Fachbegriff für das, was der Code tut, und er steht in der Datenbank.

Die Anwendung läuft gegen eine PostgreSQL-Datenbank mit eigener
Benutzerverwaltung, echten Inseraten und Stripe-Zahlungen. Demo-Daten gibt es
nur auf ausdrücklichen Wunsch (`npm run db:seed`).

## Startklar?

```bash
npm run preflight
```

Prüft in einem Durchgang, was für den Livegang noch fehlt — mit der Folge,
nicht nur dem Variablennamen: «RESEND_API_KEY fehlt» hilft niemandem, «wer sein
Passwort vergisst, kommt nicht mehr ins Konto» schon. Der Befehl endet mit
Fehlercode, solange etwas blockiert, und lässt sich damit vor ein Deployment
hängen.

## Funktionen

| Bereich | Was es tut |
| --- | --- |
| **Konto** (`/konto/*`) | Registrierung, Anmeldung, E-Mail-Bestätigung, Passwort-Reset, Passwort und Adresse ändern, Profil, Treffermeldungen an/aus, Auszahlungskonto. |
| **Inserat** (`/inserat/neu`) | Fahrzeug einstellen mit Live-Bewertung während der Eingabe, Fotoupload, Wunschliste. Pausieren und Archivieren inklusive. |
| **Marktplatz** (`/markt`) | Alle Inserate mit Filtern. Angemeldet wird die Zuzahlung laufend gegen das eigene Fahrzeug gerechnet. |
| **Matches** (`/matches`) | Drei Gruppen — beide wollen, nur du, nur die Gegenseite — plus Ringtausch über drei Parteien. Beidseitige Treffer kommen zusätzlich täglich per Mail. |
| **Wertrechner** (`/wert`) | Wertverlauf, Prognoseband, vollständige Aufschlüsselung und Sensitivitätsanalyse. |
| **Tausch** (`/tausch/[id]`) | Direktvergleich, Wertkurven beider Fahrzeuge, Ausgleich per Regler, Prüfung gegen den Rahmen der Gegenseite. |
| **Tauschvorgang** (`/deals/[id]`) | Verhandlung, Zusage, Treuhand, Telefonnummer der Gegenseite, Übergabe-Checkliste, Abschluss mit Halterwechsel. |
| **Ringtausch** (`/ringe/[id]`) | Derselbe Ablauf über drei Parteien: drei Zusagen, aufgeteilter Treuhandtopf, drei Übergaben, Halterwechsel im Kreis. |

### Moderation

Jedes Inserat lässt sich melden; die Meldung geht in die Tabelle `reports` und
per Mail an `OPERATOR_EMAIL`. Unter `/admin/meldungen` kann die Betreiberin sie
abhaken, das Inserat sperren oder das Konto stilllegen.

Sperren ist bewusst etwas anderes als «pausiert»: ein gesperrtes Inserat
verschwindet aus dem Markt, offene Vorschläge dazu werden storniert, und der
Besitzer kann es nicht wieder aktivieren. Ein Inserat, an dem ein verbindlich
zugesagter Tausch hängt, lässt sich nicht sperren — das würde Geld bewegen.

Ein stillgelegtes Konto kann sich weiterhin anmelden und kommt an seine
laufenden Tausche und seine Daten; inserieren, tauschen und bewerten ist
gesperrt. Eine Sperre ist kein Grund, jemanden von den eigenen Daten
auszusperren.

Beides ist umkehrbar und bleibt sichtbar: die Admin-Seite listet auf, was
gerade gesperrt und wer stillgelegt ist, mit einem Knopf zum Aufheben. Beim
Stilllegen werden die Inserate nur pausiert, nicht gesperrt — sonst käme die
Person nach der Aufhebung nie wieder an sie heran.

### Bewertungen

Nach einem abgeschlossenen Tausch bewertet jede Seite die andere einmal — ein
bis fünf Sterne in halben Schritten, dazu ein freiwilliger Text. Nach einem
Ring sind es zwei Bewertungen je Person: eine für die, der man sein Fahrzeug
gegeben hat, eine für die, von der man seines bekommen hat. Beide Übergaben
können ganz unterschiedlich gelaufen sein. Der Schnitt
steht am Namen, die letzten drei Texte auf der Fahrzeugseite. Bewerten lässt
sich nur ein abgeschlossener Tausch: während einer laufenden Verhandlung wäre
die Bewertung ein Druckmittel.

### Ringtausch

Das Grundproblem jedes Tauschmarkts ist die doppelte Bedarfskoinzidenz: Du
willst das Auto von A, aber A will deines nicht. `findRingSwaps()` sucht
deshalb Dreierkreise — du gibst an A, A gibt an B, B gibt an dich. Die drei
Ausgleichszahlungen summieren sich zu null.

Ein gefundener Ring lässt sich auch abwickeln (`/ringe/[id]`). Er läuft über
dieselben Stationen wie ein Zweiertausch, mit drei Unterschieden:

- **Gebunden erst mit allen drei Zusagen.** Bis dahin bleibt jedes Fahrzeug
  frei; niemand wartet mit gesperrtem Auto auf eine Zusage, die nie kommt.
  Die letzte Zusage setzt die Sperren, und zwar dieselben wie beim
  Zweiertausch — ein Fahrzeug steckt nie in zwei verbindlichen Vorgängen.
- **Der Topf wird zerlegt.** Im Ring zahlt niemand an die Person, von der er
  das Auto bekommt. `ringTransfers()` löst die drei Ausgleiche in einzelne
  Zahlungen von den Zahlenden zu den Empfangenden auf — bei drei Parteien
  höchstens zwei. Jede davon durchläuft denselben abgesicherten Weg wie eine
  Zahlung im Zweiertausch: reservieren, einziehen, weiterleiten. Die
  Kartengebühr trägt wie dort der Zahlende, je Betrag.
- **Alles oder nichts.** In die Treuhandphase kommt der Ring erst, wenn *jede*
  nötige Reservierung vorliegt; ausgezahlt und umgeschrieben wird erst, wenn
  *alle drei* die Übergabe bestätigt haben. Vor dem ersten Einzug werden alle
  Empfängerkonten geprüft — sonst bliebe der Ring nach der ersten Überweisung
  auf halbem Weg stehen. Springt jemand ab, geht alles zurück und kein
  Fahrzeug bewegt sich.

## Erscheinungsbild

Die Oberfläche soll aussehen wie ein Messblatt, nicht wie ein Dashboard: Ein
Fahrzeugwert ist eine Behauptung über CHF 50'000, und sie wird glaubwürdiger,
wenn sie nüchtern gesetzt ist.

- **Farbe.** Warmes Papier (`--color-canvas`) statt kühlem Grau, tiefes Petrol
  (`--color-marke`) als einzige Handlungsfarbe, Bernstein (`--color-warn`)
  ausschliesslich für Geld. Petrol ist dunkel, deshalb steht auf gefüllten
  Markenflächen `--color-onmarke` und nicht die Textfarbe.
- **Schrift.** Archivo für alles — Überschriften laufen über die Breitenachse
  breit und schwer (`.display`), die Oberfläche normal. Der Abstand zur
  Standardvorlage kommt so aus Breite und Gewicht statt aus einer zweiten
  Schrift. IBM Plex Mono trägt jede Zahl (`.tabular`, `.betrag`): gleich breite
  Ziffern springen beim Aktualisieren nicht.
- **Signet.** Zwei Zeilen, gleich breit. Oben ein Fahrzeug, unten das andere —
  kürzer — plus der bernsteinfarbene Block, die Zuzahlung. Zusammen ergeben sie
  dieselbe Länge; das Zeichen ist die Aussage des Produkts. Es steckt in
  `src/app/icon.svg` und in `Signet()` in `site-header.tsx`.
- **Fahrzeugbilder.** Solange keine Fotos hochgeladen sind, steht eine flache
  Platte mit Karosserie-Strichzeichnung — eine technische Zeichnung, kein
  Farbverlauf. Die Plattenfarbe leitet sich aus der Fahrzeug-ID ab und bleibt
  zwischen Server und Client gleich.

`npm run palette` prüft die Palette nach: jede Textfarbe gegen ihre Fläche auf
WCAG AA (4.5:1), grafische Elemente auf 3:1, und die beiden Diagrammreihen auf
Trennbarkeit bei Deuteranopie und Protanopie.

## Bewertungsmodell

`src/lib/valuation.ts` enthält ein nachvollziehbares Modell statt einer Black
Box. Der Wert entsteht aus:

1. **Zulassungsverlust** von 12 %: ein Fahrzeug wird in dem Moment vom Neu-
   zum Gebrauchtwagen, in dem es eingelöst wird.
2. **Restwertkurve** `r(t) = exp(−λ · t^0.7)`, wobei λ vom Antrieb abhängt
   (Elektro verliert schneller als Diesel) und mit einem Markenfaktor
   multipliziert wird.
3. **Laufleistungskorrektur** gegen eine Norm von 15'000 km/Jahr, gedeckelt
   auf ±18 %.
4. **Multiplikative Faktoren**: Zustand, Serviceheft, Anzahl Halter,
   Unfallschaden und — beim Stromer — der Batteriezustand (SoH).
5. **Absolute Abschläge** für bekannte Mängel.
6. **Marktindex** je Antriebssegment, auf den Stichtag normiert.
7. **Deckel** auf den Neupreis als Sicherung — er gilt für den Wert, die
   Spanne und das Prognoseband gleichermassen.

Die **Ausstattung geht nicht als eigener Posten ein**. Der eingetragene
Neupreis ist der Preis der konfigurierten Version, die Sonderausstattung steckt
also bereits darin; ein zweites Mal addiert hätte sie gut ausgestattete
Fahrzeuge doppelt bewertet. Die Liste dient der Beschreibung und dem Matching.

`valuate()` gibt die Aufschlüsselung so zurück, dass Listenpreis plus alle
ausgewiesenen Faktoren exakt dem Endwert entsprechen. `valueHistory()` rechnet
dasselbe Modell rückwirkend und als Prognose mit wachsendem Unsicherheitsband
durch.

Alle Berechnungen sind deterministisch. Das leichte Marktrauschen stammt aus
einem Hash über Fahrzeug-ID und Monat, nicht aus `Math.random()`. Der Stichtag
ist der laufende Monat in UTC, und auch die Datumsarithmetik rechnet
durchgehend in UTC — mit den lokalen Gettern läge eine Erstzulassung in
westlichen Zeitzonen im Vormonat, und Server und Browser kämen auf
verschiedene Werte.

> Die Restwertkurven sind plausibel kalibriert, aber **nicht empirisch an
> echten Inseraten belegt**. Vor dem Livegang sollten sie gegen reale
> Marktdaten geprüft werden.

## Einrichtung

```bash
npm install
cp .env.example .env.local     # DATABASE_URL eintragen
npm run db:migrate             # Schema anlegen
npm run dev                    # http://localhost:3000
```

Für eine gefüllte Entwicklungsumgebung:

```bash
npm run db:seed -- --confirm   # 10 Konten, 19 Fahrzeuge mit Inseraten
```

Weitere Skripte: `npm run build`, `npm run typecheck`, `npm run db:generate`
(Migration aus dem Schema erzeugen), `npm run db:studio`.

Eine Person zur Betreiberin machen — sie sieht danach unter
`/admin/meldungen` die gemeldeten Inserate:

```bash
npm run admin -- anna@example.ch
npm run admin -- anna@example.ch --entziehen
```

### Tests

```bash
createdb carswap_test
TEST_DATABASE_URL=postgres://…/carswap_test npm run db:migrate
TEST_DATABASE_URL=postgres://…/carswap_test npm test
```

Die Tests laufen gegen eine echte Postgres-Datenbank und leeren zwischen den
Fällen alle Tabellen. Damit das nie die Entwicklungsdatenbank trifft, verlangt
der Testlauf `TEST_DATABASE_URL` (oder ein `DATABASE_URL`, dessen Datenbankname
auf `_test` endet) und bricht sonst ab. Wer die Variable nicht jedes Mal setzen
will, legt eine gitignorierte `.env.test` an. `.github/workflows/ci.yml` führt
Typprüfung, Migration, Tests und Build bei jedem Push aus.

Abgedeckt sind die Stellen, an denen Fehler Geld kosten: die Zustandsmaschine
des Tauschs samt gleichzeitiger Zugriffe, `captureAndPayout()` gegen ein
Stripe-Doppel, die Gebührenrechnung und die Webhook-Ereignisse.

### Ablauf im Browser

```bash
TEST_DATABASE_URL=postgres://…/carswap_test npm run e2e
```

Ein Durchlauf durch den ganzen Ablauf gegen `next start`: zwei Konten
registrieren, je ein Fahrzeug inserieren, Vorschlag, Zusage, Übergabe von
beiden Seiten bestätigen, Halterwechsel in der Garage prüfen und bewerten.
Bewusst ohne Wertdifferenz — dieser Weg kommt ohne Stripe aus und deckt
trotzdem die ganze Zustandsmaschine ab.

Geprüft wird gegen den Produktions-Build, nicht gegen `next dev`: Middleware,
Sicherheitsrichtlinie und Serverkomponenten verhalten sich dort anders. Chromium
wird nicht heruntergeladen, wenn `PLAYWRIGHT_BROWSERS_PATH` schon eines
bereitstellt.

### Datenbank

Jede PostgreSQL-Instanz ab Version 14 genügt; die Anwendung spricht sie über
`DATABASE_URL` an. Auf Serverless-Plattformen sollte ein Pooler davor liegen
(die Verbindung ist entsprechend mit `prepare: false` und `max: 1`
konfiguriert).

Lokal reicht:

```bash
initdb -D .pgdata && pg_ctl -D .pgdata start
createdb carswap
export DATABASE_URL=postgresql://localhost:5432/carswap
```

## Fahrzeugkatalog

`src/lib/data/catalog.ts` enthält 66 Marken mit 671 Modellen für den Schweizer
Markt (Neuwagen ab etwa 2012). Er dient als Eingabehilfe: das Formular schlägt
zur gewählten Marke passende Modelle vor, erlaubt aber weiterhin freie
Eingaben — Sondermodelle und Importe fallen sonst durchs Raster. Die
Filterlisten auf Marktplatz und Matches werden dagegen aus dem tatsächlichen
Bestand abgeleitet, damit dort keine Marke steht, zu der es kein Inserat gibt.

Der Katalog ist bewusst selbst gepflegt und **nicht** von einem Marktplatz
übernommen. Modelllisten von AutoScout24 und Vergleichbaren sind deren
Datenbestand und durch die Nutzungsbedingungen geschützt; automatisiertes
Auslesen wäre für ein konkurrierendes Angebot heikel und technisch fragil.

Für eine vollständige, gepflegte Quelle kommen infrage:

- **Eurotax / Schwacke** — der Branchenstandard in der Schweiz und Deutschland.
  Liefert Katalog *und* Restwerte und würde damit auch die fehlende empirische
  Kalibrierung des Bewertungsmodells lösen. Kostenpflichtig, Vertrag nötig.
- **Typengenehmigungsdaten des ASTRA** beziehungsweise die Fahrzeugdatensätze
  auf opendata.swiss — offizielle Schweizer Daten, frei nutzbar, dafür ohne
  Marketingbezeichnungen.
- **NHTSA vPIC** — frei und ohne Schlüssel, aber auf den US-Markt bezogen; die
  europäischen Modellbezeichnungen weichen ab.

## Sicherheit

Ein paar Entscheidungen, die nicht offensichtlich sind:

- **Die Content-Security-Policy arbeitet mit einer Nonce je Antwort.** Sie
  wird in der Middleware gesetzt (`src/lib/security-headers.ts`); Next.js liest
  sie aus der CSP der Anfrage und hängt sie an seine eigenen Skript-Tags.
  `strict-dynamic` erlaubt den so freigegebenen Skripten, die Chunks des
  Routers nachzuladen. Für Stile bleibt `'unsafe-inline'`: React setzt
  style-Attribute, und eine Nonce für Stile würde das brechen.
- **Die Anmeldesperre hängt an der IP, nicht an der Adresse.** Ein Zähler pro
  E-Mail-Adresse, der schon beim blossen Versuch hochläuft, wäre eine
  Einladung: damit sperrt jeder ein fremdes Konto aus, ohne das Passwort zu
  kennen. Fehlversuche pro Adresse werden gezählt und verlangsamen weitere
  Fehlversuche, blockieren aber nie ein korrektes Passwort.
- **Verbindliche Schritte** (Vorschlag, Zusage, Treuhand) verlangen eine
  bestätigte E-Mail-Adresse. Kann die Installation keine Mails verschicken,
  wäre die Bestätigung unmöglich — dann greift die Regel nicht, und
  `/api/health` weist den Mailversand als nicht konfiguriert aus.
- **Die Registrierung nennt eine bereits vergebene Adresse beim Namen.** Das
  ist bewusst: die Alternative wäre, jede Registrierung gleich aussehen zu
  lassen und den Hinweis nur per Mail zu schicken — ohne eingerichteten
  Mailversand käme man dann gar nicht mehr weiter. Der Preis ist, dass sich
  abfragen lässt, ob eine Adresse ein Konto hat.


- **Passwörter** werden mit scrypt gehasht (N=32768, r=8, p=1, 64 Byte Schlüssel,
  16 Byte Salt), Vergleich in konstanter Zeit. Keine nativen Abhängigkeiten.
- **Sitzungen** liegen als Zufallstoken im httpOnly-Cookie; in der Datenbank
  steht nur der SHA-256-Hash. Laufzeit 30 Tage mit gleitender Verlängerung.
  Ein Passwortwechsel meldet alle Geräte ab.
- **Server Actions** prüfen in jedem Aufruf Anmeldung und Eigentum und laden
  betroffene Objekte frisch aus der Datenbank. Vom Client kommen nur IDs.
- **Passwort und E-Mail-Adresse ändern** verlangen beide das aktuelle Passwort.
  Eine offene Sitzung allein reicht nicht: wer ein unbeaufsichtigtes Gerät
  erwischt, könnte sonst in zwei Klicks das Konto übernehmen.
- **Der Adresswechsel läuft über die neue Adresse.** Bis der Link dort
  angeklickt ist, steht die neue Adresse nur in `users.pending_email` und die
  alte bleibt in Kraft. Die bisherige Adresse wird über die Anfrage und über
  den vollzogenen Wechsel informiert — sie ist die einzige Stelle, an der ein
  unbemerkter Wechsel noch auffallen kann.
- **Ratenbegrenzung** für Anmeldung (pro IP und pro Adresse), Registrierung,
  Passwort-Reset, Nachrichten und Inserate.
- **Aufzählung von Konten** wird beim Passwort-Reset verhindert; die Anmeldung
  prüft auch bei unbekannter Adresse einen Hash, damit die Antwortzeit nichts
  verrät.
- **Sicherheits-Header** in `next.config.ts` (nosniff, Referrer-Policy,
  X-Frame-Options, Permissions-Policy, HSTS); die CSP kommt aus der Middleware,
  weil sie je Antwort eine frische Nonce braucht.

## Zahlungen

Der Ablauf ist "separate charges and transfers":

1. Nach beidseitiger Zusage legt `createEscrowCheckout()` eine
   Stripe-Checkout-Session mit `capture_method: manual` an. Der Betrag wird
   **reserviert**, nicht eingezogen.
2. Der Webhook `/api/stripe/webhook` prüft die Signatur, ist über die Tabelle
   `webhook_events` idempotent und setzt den Vorgang auf «Treuhand».
3. Bestätigen beide Seiten die Übergabe, geht der Vorgang in den Zustand
   «Abwicklung»: `captureAndPayout()` zieht den Betrag ein und überweist ihn
   per Stripe Connect an die Gegenseite. **Erst wenn das Geld beim Empfänger
   ist, wechseln die Fahrzeuge den Halter.** Ein Abbruch ist ab diesem Punkt
   gesperrt; bleibt die Abwicklung hängen, setzt ein erneutes Bestätigen sie
   fort.
4. Bricht jemand vorher ab, wird die Autorisierung freigegeben bzw. erstattet.

Die Kartengebühr trägt der Zahlende: `platformFee()` rechnet den Betrag hoch,
sodass beim Empfänger genau der vereinbarte Ausgleich ankommt. Die Sätze lassen
sich über `PLATFORM_FEE_PERCENT` (Vorgabe 2.9) und `PLATFORM_FEE_FIXED_MINOR`
(Vorgabe 30 Rappen) anpassen — Karten von ausserhalb Europas kosten Stripe mehr,
die Differenz bliebe sonst an der Plattform hängen.

Die Gegenseite muss ihr Auszahlungskonto eingerichtet haben, **bevor** eingezahlt
werden kann. Sonst läge das Geld später auf dem Plattformkonto fest.

Auszahlungen brauchen ein Stripe-Connect-Express-Konto pro Nutzer; das
Onboarding läuft über `/konto`. Bankdaten erreichen die Anwendung nie.

Ohne `STRIPE_SECRET_KEY` funktionieren Tausche **ohne** Wertdifferenz
vollständig; bei einer Differenz meldet die Anwendung, dass Zahlungen nicht
eingerichtet sind.

> Kartenautorisierungen verfallen nach sieben Tagen. Wird die Übergabe bis
> dahin nicht von beiden Seiten bestätigt, muss neu eingezahlt werden.

## Struktur

```
src/
  app/
    actions/           Server Actions (auth, listings, deals, watchlist, account)
    api/               Stripe-Webhook, Blob-Upload-Token, Health-Check, Crons
    konto/             Registrierung, Anmeldung, Reset, Profil
    inserat/           Inserat anlegen und bearbeiten
  components/          UI, Charts, Formulare, Konfiguratoren
  lib/
    auth/              Passwort-Hashing, Sitzungen, Token, Ratenbegrenzung
    db/                Drizzle-Schema und Verbindung
    queries.ts         Datenzugriff mit Übersetzung in Domänenobjekte
    valuation.ts       Bewertungs- und Prognosemodell
    matching.ts        Wunschabgleich, Scoring, Ringsuche
    rings.ts           Ringrechnung: Ausgleiche zerlegen, Ring prüfen
    rings-db.ts        Ringzustände: Zusage, Treuhandwechsel, Freigabe
    payments.ts        Stripe: Treuhand, Capture, Connect-Auszahlung
    abschluss.ts       Abschluss eines Zweiertauschs: Geld, Halterwechsel
    treffer.ts         Täglicher Lauf: neue beidseitige Treffer per Mail
    wartung.ts         Täglicher Lauf: Abschlüsse nachholen, aufräumen
    validation.ts      Zod-Schemata für alle Eingaben
scripts/               Migration, Seed, Demo-Daten
drizzle/               Erzeugte SQL-Migrationen
```

## Deployment

Auf Vercel ohne Konfiguration deploybar. Erforderliche Umgebungsvariablen
siehe `.env.example`.

Die Migrationen laufen beim Deployment automatisch mit (`npm run build` ruft
zuerst `scripts/migrate.ts`). Ohne gesetzte Datenbankadresse wird der Schritt
übersprungen, damit Vorschau-Builds ohne Datenbank durchlaufen. Für die
Migration wird die ungepoolte Verbindung bevorzugt (`DATABASE_URL_UNPOOLED`
beziehungsweise `POSTGRES_URL_NON_POOLING`), weil DDL im Transaction-Mode
eines Poolers unzuverlässig ist.

Nach dem ersten Deployment:

1. In Stripe einen Webhook auf `https://<domain>/api/stripe/webhook`
   einrichten (Ereignisse: `checkout.session.completed`,
   `checkout.session.expired`, `payment_intent.canceled`,
   `payment_intent.payment_failed`, `charge.refunded`, `account.updated`) und
   das Signaturgeheimnis als `STRIPE_WEBHOOK_SECRET` hinterlegen.
2. Einen Vercel-Blob-Store verbinden, damit Fotouploads funktionieren.
3. `CRON_SECRET` setzen. Vercel schickt es den beiden täglichen Läufen
   (`vercel.json`) als Bearer-Token mit; ohne das Geheimnis antworten sie in
   Produktion nur mit 401.
4. `/api/health` prüfen — die Antwort listet auf, was konfiguriert ist, und
   meldet unter `liegengebliebenesGeld`, ob ein eingezogener Betrag noch nicht
   beim Empfänger ist.

## Tägliche Läufe

`vercel.json` richtet zwei Crons ein. Beide prüfen dasselbe Geheimnis
(`lib/cron-auth.ts`): `CRON_SECRET`, ersatzweise `HEALTH_TOKEN`.

### Treffermeldungen — `/api/cron/treffer`, 06:00 UTC

Ohne diesen Lauf rechnet das Matching nur, solange jemand die Treffer-Seite
offen hat. Ein Autotausch ist aber nichts, wofür man täglich eine Seite
aufruft: wer sein Auto einstellte, erfuhr nie, dass inzwischen jemand
aufgetaucht ist, der genau dieses Auto sucht.

Der Lauf schickt höchstens eine Mail pro Person und Tag mit bis zu drei
Treffern. Was er meldet und was nicht:

- **Nur beidseitige Treffer, und nur mit einem echten Wunsch dahinter.** Ein
  leeres Wunschfeld besteht jede Prüfung — es stellt ja keine. Die Passung
  gälte dann formal als beidseitig, obwohl die Gegenseite nie etwas gesucht
  hat, und «jemand sucht ausdrücklich ein Auto wie deines» wäre schlicht
  falsch. Ein blosser Höchstbetrag zählt nicht als Wunsch: er sagt, was jemand
  ausgeben will, nicht welches Auto er will.
- **Jedes Inserat höchstens einmal je Person.** Was gemeldet wurde, steht in
  `match_notices`; ohne diese Zeilen käme derselbe Treffer jeden Tag erneut.
  Vermerkt wird vor dem Versand — andersherum stünde bei einem Absturz
  dazwischen eine Mail ohne Vermerk.
- **Nur an bestätigte Adressen**, nur an Konten mit dem Schalter an
  (`users.notify_matches`, im Konto umlegbar), nie an stillgelegte oder
  gelöschte.

### Wartung — `/api/cron/wartung`, 03:00 UTC

Der Lauf macht vier Dinge und ist beliebig oft wiederholbar:

- **Steckengebliebene Abschlüsse nachholen.** Beide bestätigen die Übergabe,
  das Geld wird eingezogen — und dann scheitert die Weiterleitung. Der Betrag
  liegt dann auf dem Plattformkonto und gehört jemand anderem. Bisher heilte
  das nur, wenn eine Seite von selbst zurückkam und noch einmal auf «Übergabe
  bestätigen» drückte; kam niemand, blieb es liegen. Der Lauf sucht dieselbe
  Lage, die auch der Knopf herstellt (alle haben bestätigt, der Vorgang steht
  in «treuhand» oder «abwicklung») und stösst dieselbe Abwicklung an — sie ist
  beliebig oft wiederholbar, weil Stripe über Idempotenzschlüssel weder doppelt
  einzieht noch doppelt überweist. Fehlt der Gegenseite das Auszahlungskonto,
  bekommt sie eine Erinnerung und der Vorgang bleibt unangetastet; die Autos
  wechseln erst, wenn das Geld beim Empfänger ist.
- **Verwaiste Zahlungen freigeben.** Beim Abbruch eines Tauschs wird die
  Reservierung sofort freigegeben. Scheitert das gerade an Stripe, bleibt sie
  auf der Karte des Nutzers stehen — der Lauf holt es nach und vermerkt einen
  erneuten Fehlschlag, statt ihn zu verschlucken.
- **Aufräumen.** Abgelaufene Sitzungen, verbrauchte Einmal-Token und alte
  Zählerstände der Ratenbegrenzung. Verbrauchte Token bleiben einen Tag stehen,
  damit ein zweiter Klick auf denselben Link «bereits verwendet» meldet und
  nicht «unbekannt».
- **Liegengebliebenes Geld melden.** Gemessen wird nach dem Nachholen: was dann
  noch eingezogen und nicht weitergeleitet ist, konnte der Lauf nicht heilen.
  Das steht in der Antwort, im Log und unter `/api/health`.

## Was vor dem Livegang noch fehlt

- **Impressum, Datenschutz und AGB** müssen juristisch geprüft werden.
  Insbesondere ist zu klären, ob die Treuhandfunktion unter das
  Geldwäschereigesetz fällt — die Konstruktion über Stripe Connect ist darauf
  ausgelegt, dass nie quitt selbst Gelder Dritter hält. Die Firmenangaben
  kommen aus `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` und
  `OPERATOR_LEGAL_FORM` und `OPERATOR_UID`, optional dazu `OPERATOR_REGISTER`
  und `OPERATOR_PHONE`. Fehlt eines davon, benennt die Seite es einzeln —
  statt eine vollständige Rechtsseite vorzutäuschen. `/api/health` meldet den
  Zustand als `impressum`.
- **Identitätsprüfung** der Nutzer sowie Abfrage von Fahrzeugausweis und
  Pfandrecht. Stripe Identity wäre die naheliegende Anbindung, weil Stripe
  ohnehin schon eingebunden ist. Das Feld `identityVerified` ist vorbereitet,
  wird aber von nichts gesetzt — und die Oberfläche verspricht deshalb auch
  nichts damit: sie zeigt «E-Mail bestätigt», weil nur das geprüft ist.
- **Empirische Kalibrierung** der Restwertkurven an echten Marktdaten — am
  ehesten zusammen mit einer Eurotax-Lizenz, die auch den Fahrzeugkatalog
  mitbringt.
- **Nachverhandeln im Ring.** Der Ausgleich ergibt sich aus den drei
  Fahrzeugwerten und steht mit dem Vorschlag fest. Wer einen anderen Betrag
  will, muss ablehnen und neu vorschlagen — ein Gegenangebot wie beim
  Zweiertausch gibt es nicht.
- **Rückbuchungen** (Chargebacks) und Erstattungen nach abgeschlossenem Tausch
  werden erkannt und beiden Seiten gemeldet, aber nicht automatisch geheilt —
  das braucht einen Streitfall-Prozess.
- **Missbrauchsschutz**: automatische Betrugserkennung bei auffälligen
  Wertdifferenzen und eine Prüfung neuer Konten. Melden, benachrichtigen,
  abhaken, ein Inserat sperren und ein Konto stilllegen gibt es
  (`/admin/meldungen`).
- **Kontolöschung**: Name, Adresse, Kontaktdaten, Sitzungen, Token, Fotos und
  die eigenen Nachrichten- und Bewertungstexte werden entfernt, Fahrzeuge
  archiviert. Was bleibt: die Tauschvorgänge selbst und die Bewertungen, die
  andere über das Konto geschrieben haben. Das Konto beim Zahlungsdienst-
  leister wird getrennt, aber nicht dort gelöscht.

### Umgebungsvariablen

| Variable | Wofür | Ohne sie |
| --- | --- | --- |
| `DATABASE_URL` / `POSTGRES_URL` | Datenbank | Anwendung startet, jede Abfrage scheitert |
| `SITE_URL` | Basis für Mail-Links und Stripe-Rücksprung | fällt auf `localhost` zurück, Fehler im Log |
| `STRIPE_SECRET_KEY` | Zahlungen | Tausche mit Wertdifferenz nicht möglich |
| `STRIPE_WEBHOOK_SECRET` | Webhook-Signatur | Webhook antwortet mit 503 |
| `RESEND_API_KEY` + `MAIL_FROM` | Mailversand | keine Bestätigungs- und Reset-Mails, und die Pflicht zur bestätigten Adresse entfällt |
| `BLOB_READ_WRITE_TOKEN` | Fotouploads | Upload antwortet mit 503 |
| `BLOB_PUBLIC_HOST` | erlaubter Foto-Host | wird aus dem Token abgeleitet |
| `OPERATOR_NAME`, `OPERATOR_LEGAL_FORM`, `OPERATOR_ADDRESS`, `OPERATOR_UID`, `OPERATOR_EMAIL` | Pflichtangaben im Impressum | die Seite benennt die fehlenden Felder einzeln |
| `OPERATOR_REGISTER`, `OPERATOR_PHONE` | ergänzende Angaben | werden weggelassen |
| `HEALTH_TOKEN` | Details unter `/api/health` (nur als `Authorization: Bearer …`) | Details nur ausserhalb der Produktion |
| `CRON_SECRET` | Die täglichen Läufe unter `/api/cron/*` | ersatzweise `HEALTH_TOKEN`; ohne beide laufen sie in Produktion nicht |
| `PLATFORM_FEE_PERCENT` / `PLATFORM_FEE_FIXED_MINOR` | Zahlungsgebühr | 2.9 % + 30 Rappen |
