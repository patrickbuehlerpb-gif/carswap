# autotauschen

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
| **Fahrzeug** (`/auto/[id]`) | Alle Angaben, Wertverlauf und die Fotogalerie des Inserats. |
| **Marktplatz** (`/markt`) | Alle Inserate mit Filtern. Angemeldet wird die Zuzahlung laufend gegen das eigene Fahrzeug gerechnet. |
| **Matches** (`/matches`) | Drei Gruppen — beide wollen, nur du, nur die Gegenseite — plus Ringtausch über drei Parteien. Beidseitige Treffer kommen zusätzlich täglich per Mail. |
| **Wertrechner** (`/wert`) | Wertverlauf, Prognoseband, vollständige Aufschlüsselung und Sensitivitätsanalyse. |
| **Tausch** (`/tausch/[id]`) | Direktvergleich, Wertkurven beider Fahrzeuge, Ausgleich per Regler, Prüfung gegen den Rahmen der Gegenseite. |
| **Tauschvorgang** (`/deals/[id]`) | Verhandlung, Zusage, Treuhand, Telefonnummer der Gegenseite, Übergabe-Checkliste, Abschluss mit Halterwechsel. |
| **Ringtausch** (`/ringe/[id]`) | Derselbe Ablauf über drei Parteien: drei Zusagen, aufgeteilter Treuhandtopf, drei Übergaben, Halterwechsel im Kreis. |

### Betrieb

`/admin/betrieb` zeigt der Betreiberin auf einer Seite, was los ist: Konten,
Inserate, Tausche und Ringe je Zustand, wie viel Geld reserviert, ausgezahlt
und — die beiden wichtigsten Punkte — eingezogen aber nicht weitergeleitet
beziehungsweise zurückgebucht ist. Dazu
die Liste des Geldes, das gerade unterwegs ist, ältestes zuerst: was dort lange
steht, hängt. Ganz oben steht, welche Umgebungsvariablen fehlen; dieselben
Punkte prüft `npm run preflight`, nur läuft im Betrieb kein Skript mehr.

Die Seite ist rein lesend — auslösen lässt sich von dort nichts. Wer kein Admin
ist, bekommt eine 404 und sieht den Punkt auch nicht im Menü. Ein Konto zum
Admin macht `npm run admin`.

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

### Fotos

Ein heutiges Telefon liefert 4000×3000 Pixel und mehrere Megabyte. Angezeigt
wird ein Inserat nie breiter als ein Bildschirm — deshalb verkleinert
`lib/bilder.ts` jedes Foto **im Browser**, bevor es hochgeht: längste Kante
2000 Pixel, WebP mit Qualität 0,85, JPEG als Rückfall für Browser ohne
WebP-Codierung. Was gar nicht erst hochgeladen wird, muss auch nicht bezahlt
und nicht wieder verkleinert werden, und die inserierende Person wartet nicht
minutenlang auf einem Mobilnetz.

Entscheidend ist dabei `imageOrientation: "from-image"` beim Dekodieren:
iPhones speichern hochkant aufgenommene Bilder quer und legen die Drehung nur
in die EXIF-Daten. Beim Zeichnen auf eine Leinwand geht die Angabe verloren —
ohne diese Einstellung läge jedes Hochkantfoto nachher auf der Seite.

Angezeigt werden die Fotos über `next/image`, das je Bildschirmbreite eine
passende Fassung in AVIF oder WebP ausliefert (`remotePatterns` in
`next.config.ts`). Auf der Fahrzeugseite steht eine Galerie; ohne Fotos bleibt
die generierte Silhouette — ein ehrlicher Platzhalter statt einer Behauptung
über das Fahrzeug.

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
- **Wortmarke.** Der Name besteht aus zwei Teilen, und die Naht dazwischen ist
  die ganze Gestaltung: «auto» steht im hellen Ton und sagt, worum es geht,
  «tauschen» trägt die Betonung und sagt, was man tut. Eine zweite Farbe wäre
  falsch — daneben steht schon das grüne Signet. Zwölf Buchstaben sind für eine
  Wortmarke viel: im Kopfbereich steht sie auf dem Telefon eine Spur kleiner,
  und «Anmelden» rückt dort in die zweite Zeile, damit oben Platz für die
  Handlung bleibt, die neue Leute brauchen.
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

Alle Angaben, aus denen sich das rechnet, stammen von der inserierenden
Person. Die Aufschlüsselung sagt das jetzt auch: Beim Posten «Zustand» stand
lange «Bewertung durch Besitzer, mit Fotos belegt» — belegt war nie etwas,
niemand prüft den Zustand, und der Satz erschien auch bei einem Inserat ohne
ein einziges Foto. Ein Posten, der Franken verschiebt, darf sich nicht auf
einen Beleg berufen, den es nicht gibt.

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

Gemeinsame Handgriffe stehen in `e2e/hilfen.ts`: Registrieren, An- und
Abmelden, Aufräumen. Zwei Dinge sind dort bewusst so gelöst:

- **Der Zähler für Registrierungen wird vor jedem Konto zurückgesetzt.** Er
  zählt pro IP; im Testlauf kommt alles von derselben, was keine echte
  Nutzerschaft je tut. Dass die Sperre selbst greift, prüfen die Tests gegen
  die Datenbank, nicht der Browserlauf.
- **Jede Datei räumt ihre Konten wieder ab.** Alle teilen sich eine Datenbank,
  die nur einmal vor dem ganzen Lauf geleert wird — ein liegengebliebenes
  Inserat steht sonst im Marktplatz der anderen Durchläufe und lässt deren
  Zählungen scheitern. Das ist zweimal passiert, beide Male mit einem
  Fehlerbild, das nach einem echten Fehler in der Anwendung aussah.

```bash
TEST_DATABASE_URL=postgres://…/carswap_test npm run e2e
```

Ein Durchlauf durch den ganzen Ablauf gegen `next start`: zwei Konten
registrieren, je ein Fahrzeug inserieren, Vorschlag, Zusage, Übergabe von
beiden Seiten bestätigen, Halterwechsel in der Garage prüfen und bewerten.
Bewusst ohne Wertdifferenz — dieser Weg kommt ohne Stripe aus und deckt
trotzdem die ganze Zustandsmaschine ab. Dazu kommen der Ringtausch über drei
Konten, Passwort- und Adresswechsel, die Fotogalerie, die Betriebsübersicht
und die Prüfung auf Barrierefreiheit.

`npm run e2e` baut vorher. Das ist keine Bequemlichkeit: `next start` liefert
aus, was zuletzt gebaut wurde, nicht den Stand der Dateien — ohne Bauen prüft
der Lauf womöglich alten Code und meldet ein falsches Grün. Wer seit dem
letzten Bauen nichts geändert hat, spart die halbe Minute mit
`npm run e2e:schnell`.

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

## Tempo auf Marktplatz und Treffern

Der Marktplatz filtert und rechnet im Browser: nur so lässt sich die Zuzahlung
gegen das eigene Auto laufend nachführen, ohne bei jedem Klick den Server zu
fragen. Der Bestand ist bei `MARKTPOOL_LIMIT` (500) gedeckelt.

Gemessen mit 500 Inseraten auf einem viermal gedrosselten Gerät — vorher und
nachher:

| | vorher | nachher |
| --- | --- | --- |
| Bis die erste Karte steht | 3,0 s | 1,1 s |
| Erste Anzeige (FCP) | 0,9 s | 0,3 s |
| Ein Filterklick | 1,5 s | 0,6 s |

Nicht das Rechnen war teuer: die Passung für alle 500 Inserate dauert zehn
Millisekunden. Teuer war, fünfhundert Kartengerüste aufzubauen und bei jedem
Filterklick wieder abzuräumen. Jetzt stehen 24 im DOM, der Rest kommt auf
Klick; nach jeder Filteränderung geht es wieder bei 24 los.

Dieselbe Rechnung auf der Treffer-Seite. «Beide Seiten wollen» war dort
ungedeckelt: wer nichts in die Wunschliste einträgt — und das sind die
meisten —, passt formal zu jedem.

| | vorher | nachher |
| --- | --- | --- |
| Bis die Treffer stehen | 4,0 s | 1,0 s |
| Erste Anzeige (FCP) | 1,4 s | 0,5 s |
| Zeilen im DOM | 1560 | 46 |

Dazu kam dort die Ringsuche. Sie sammelte jeden gefundenen Ring als
vollständiges Objekt — mit Beinen, Beteiligten und Fahrzeugen — und warf nach
dem Sortieren alle bis auf sechs weg. Bei 500 Inseraten mit leeren
Wunschlisten sind das eine Viertelmillion Objektgeflechte für sechs
Ergebnisse: 470 ms auf schneller Hardware, und der Aufwand wächst mit dem
Quadrat des Marktes. Jetzt hält sie nur die besten Kandidaten fest und baut
die Ringe erst am Ende — 49 ms bei 500, 158 ms bei 1000.

Festgehalten wird all das über die Anzahl der Zeilen im DOM, nicht über eine
Zeitgrenze — auf geteilter Hardware schwankt die zu stark, um etwas zu
bedeuten. Die Anzahl ist dieselbe Aussage ohne den Zufall. Dass die
beschränkte Ringsuche dasselbe liefert wie eine unbeschränkte, prüft
`src/lib/matching.test.ts` direkt gegeneinander.

## Der erste Tag

Am Anfang ist der Marktplatz leer. Das ist kein Randfall, sondern der Zustand,
in dem die ersten Nutzerinnen die Seite sehen — und was dort steht, entscheidet,
ob sie wiederkommen.

Zwei Stellen sagten das Falsche. Der Marktplatz forderte «Sei der Erste — Auto
einstellen», auch wenn genau das gerade getan worden war: `getActiveListings`
lässt die eigenen Inserate weg, für die erste Person ist der Pool also leer,
obwohl ihr Auto drinsteht. Und die Treffer-Seite riet, die Kriterien zu
erweitern, obwohl es überhaupt nichts zu filtern gab.

Jetzt unterscheiden beide Seiten, ob jemand selbst schon inseriert hat
(`countMyActiveListings`), und sagen im leeren Markt, was tatsächlich gilt: es
gibt nichts zu vergleichen, das Inserat ist trotzdem sichtbar, und die
Treffermeldung kommt von selbst. Das Versprechen ist an die Bedingungen
geknüpft, unter denen es auch eingehalten wird — bestätigte Adresse und
eingeschalteter Schalter, siehe Treffermeldungen weiter unten.

`e2e/tag-eins.spec.ts` hält beide Zustände am selben Konto fest: erst ohne
eigenes Inserat, dann mit.

## Geteilte Links

Ein Marktplatz lebt davon, dass Leute «schau dir das an» weiterschicken. Ohne
Open-Graph-Angaben ist das eine nackte Adresse ohne Vorschau — der Absender
merkt es nicht, weil er sie selbst nie sieht.

Jede Seite bringt deshalb Titel und Beschreibung mit, ein Inserat zusätzlich
sein erstes Foto. Ohne Foto steht dort das Bild der Seite
(`app/opengraph-image.tsx`, zur Laufzeit gerendert) — ausdrücklich genannt und
nicht geerbt: sobald eine Seite eigene Open-Graph-Angaben setzt, ersetzen sie
die des Layouts vollständig, und das Inserat stünde ganz ohne Vorschau da. Die
schematische Silhouette kommt in der Vorschau bewusst nicht vor: auf der Seite
ist sie ein ehrlicher Platzhalter, in einem Chatfenster sähe sie aus wie ein
Foto des Autos.

Das Ganze hängt an `metadataBase` und damit an `SITE_URL` — ein Chatprogramm
bekommt nur den Link als Text und kann eine relative Adresse nicht auflösen.
Deshalb prüft `siteUrl()` den Wert jetzt: «autotauschen.app» ohne Schema ist keine
Adresse, sondern ein Tippfehler, der sonst beim Rendern von `metadataBase`
jede Seite umgeworfen hätte. Ein solcher Wert wird verworfen und beim Namen
genannt, und `npm run preflight` meldet die Basisadresse dann als fehlend.

## Barrierefreiheit

`e2e/barrierefreiheit.spec.ts` fährt mit axe über die öffentlichen Seiten, die
Anmeldung, die angemeldeten Bereiche und dieselben Seiten noch einmal auf
390 px. Jeder Verstoss lässt den Lauf scheitern — es gibt keine Ausnahmeliste.

Zwei Befunde kamen dabei heraus und sind behoben:

- **Links im Fliesstext waren nur an der Farbe zu erkennen** (WCAG 1.4.1). Wer
  Farben schlecht unterscheidet, sah dort keinen Link. Sie sind jetzt immer
  unterstrichen (`.textlink` in `globals.css`); beim Zeigen wird die Linie
  kräftiger, statt überhaupt erst zu erscheinen.
- **Der Schalter für die Treffermeldungen verlor beim Umlegen den Fokus.** Er
  war während des Speicherns `disabled`, und ein gesperrtes Element kann keinen
  Fokus halten — der Browser nimmt ihn weg und gibt ihn nicht zurück. Wer die
  Seite mit der Tastatur bedient, stand danach wieder am Seitenanfang. Statt zu
  sperren zeigt der Schalter jetzt `aria-busy` und verwirft einen zweiten Klick
  selbst.

Auf 390 px prüft derselbe Lauf zusätzlich, dass keine Seite seitwärts läuft
(`scrollWidth` gegen `clientWidth`), abgemeldet wie angemeldet. Das ist kein
Schönheitsfehler: was rechts hinausragt, ist oft gerade der Knopf mit der
wichtigsten Handlung. Aufgefallen ist es bei der Umbenennung — der zwölf
Buchstaben lange Name sprengte den Kopfbereich, «Konto erstellen» brach um und
stand halb ausserhalb des Bildes. Die Prüfung hält das jetzt fest.

Was axe nicht sieht, prüft derselbe Lauf von Hand: Sprunglink, Benutzermenü mit
Enter und Escape, Schalter mit der Leertaste, Aufklapper mit Enter — und dass
der Fokus dabei jeweils dort bleibt, wo er hingehört. Die Farbpalette prüft
`npm run palette` getrennt, auch auf Rot-Grün-Schwäche.

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

### Rückbuchungen

Eine Kartenrückbuchung ist der teuerste Fall im ganzen System: Stripe zieht
den Betrag sofort vom **Plattformkonto** ein — nicht vom Empfänger, dem er
längst überwiesen wurde. Bis zur Entscheidung liegt autotauschen in Vorleistung, und
ohne fristgerechte Stellungnahme ist der Fall verloren.

`charge.dispute.created` und `charge.dispute.closed` werden deshalb verarbeitet.
Vermerkt wird in eigenen Spalten (`disputed_at`, `dispute_status`,
`dispute_amount_minor`) und **nicht** im Zahlungsstatus: beides gilt
gleichzeitig — eine Zahlung kann längst ausgezahlt und trotzdem angefochten
sein. Als Status geschrieben ginge der Abwicklungsstand verloren und damit die
Angabe, ob das Geld überhaupt schon beim Empfänger war.

Gemeldet wird an die Betreiberin (`OPERATOR_EMAIL`) mit Betrag, Grund und
Frist, an beide Beteiligten, in den Verlauf des Vorgangs und ins Log. Offene
Fälle stehen in `/admin/betrieb` und unter `rueckbuchungen` in `/api/health`.
Ohne gesetzte `OPERATOR_EMAIL` schreibt das Log einen Fehler — dann erfährt
niemand davon.

## Struktur

```
src/
  app/
    actions/           Server Actions (auth, listings, deals, watchlist, account)
    api/               Stripe-Webhook, Blob-Upload-Token, Health-Check, Crons
    konto/             Registrierung, Anmeldung, Reset, Profil
    admin/             Betriebsübersicht und gemeldete Inserate
    inserat/           Inserat anlegen und bearbeiten
  components/          UI, Charts, Formulare, Konfiguratoren
  lib/
    auth/              Passwort-Hashing, Sitzungen, Token, Ratenbegrenzung
    db/                Drizzle-Schema und Verbindung
    queries.ts         Datenzugriff mit Übersetzung in Domänenobjekte
    betrieb.ts         Kennzahlen für die Betriebsübersicht
    bilder.ts          Fotos im Browser verkleinern, bevor sie hochgehen
    valuation.ts       Bewertungs- und Prognosemodell
    matching.ts        Wunschabgleich, Scoring, Ringsuche
    rings.ts           Ringrechnung: Ausgleiche zerlegen, Ring prüfen
    rings-db.ts        Ringzustände: Zusage, Treuhandwechsel, Freigabe
    payments.ts        Stripe: Treuhand, Capture, Connect-Auszahlung
    abschluss.ts       Abschluss eines Zweiertauschs: Geld, Halterwechsel
    treffer.ts         Täglicher Lauf: neue beidseitige Treffer per Mail
    wartung.ts         Täglicher Lauf: Abschlüsse nachholen, aufräumen
    lagebericht.ts     Was die Betreiberin heute wissen muss — sonst nichts
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

### Domain

Die Anwendung läuft unter **autotauschen.app**. Das ist keine Kosmetik, sondern
eine Einstellung: `.app` steht auf der HSTS-Preload-Liste, die Browser fest
eingebaut haben. Ein Aufruf über `http://` wird deshalb gar nicht erst
gesendet, sondern im Browser auf `https://` umgeschrieben — es gibt keinen
Klartext-Rückfall, auf den man versehentlich zurückfallen könnte. Für eine
Seite, über die Geld läuft, ist das der richtige Vorgabewert.

`SITE_URL` muss darum `https://autotauschen.app` lauten (mit Schema, ohne
Schrägstrich am Ende) — die Prüfung in `lib/mail.ts` weist alles andere ab.
`autotauschen.ch` kommt später dazu; sie wird dann als Weiterleitung auf die
`.app`-Adresse eingerichtet, nicht als zweite eigenständige Seite, damit
Mail-Links, Stripe-Rücksprünge und Vorschaubilder nur eine Herkunft haben.

### Mail einrichten

Eine Bestätigungsmail, die im Spam landet, ist so gut wie keine: Ohne bestätigte
Adresse gilt bei uns die Adresspflicht nicht, und wer sein Passwort vergisst,
kommt nicht mehr ins Konto. Deshalb gehört zum Livegang mehr als ein
`RESEND_API_KEY`:

1. **Domain bei Resend eintragen** und die angezeigten DNS-Einträge setzen —
   Resend nennt die genauen Werte, sie sind je Konto verschieden. Es sind
   drei Arten: ein DKIM-Schlüssel (TXT), ein SPF-Eintrag (TXT) und ein
   MX-Eintrag für Rückläufer.
2. **Von einer Subdomain senden**, etwa `mail.autotauschen.app`. Bleibt der
   Ruf der Absenderdomain einmal an einer Beschwerde hängen, trifft es dann
   nicht die Hauptdomain, unter der die Seite läuft.
3. **DMARC setzen** (`_dmarc` als TXT). Zum Start `p=none` mit einer
   Berichtsadresse: dann sieht man eine Woche lang, was ankommt, ohne dass
   etwas abgewiesen wird. Danach schrittweise auf `quarantine`.
4. **`MAIL_FROM` passend setzen**, zum Beispiel
   `autotauschen <noreply@mail.autotauschen.app>` — die Adresse muss zur
   verifizierten Domain gehören, sonst lehnt Resend jede Nachricht ab.
5. **Eine Testmail an ein echtes Postfach** schicken (Registrierung mit einer
   eigenen Adresse) und nachsehen, ob sie im Posteingang landet, nicht im
   Spam. Kommt sie nicht an, steht der Grund unter `/admin/betrieb`.

Nach dem ersten Deployment:

1. In Stripe einen Webhook auf `https://autotauschen.app/api/stripe/webhook`
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

### Datensicherung

Die Anwendung sichert nichts selbst — das ist Sache des Datenbankanbieters, und
es ist die eine Aufgabe, die sich nicht nachholen lässt. Vor dem Livegang
gehört geprüft, dass beim Anbieter eine Sicherung läuft und wie weit sie
zurückreicht (bei Neon und Vercel Postgres heisst das Point-in-Time-Recovery,
je nach Tarif zwischen einem und dreissig Tagen).

Was ohne Sicherung verloren wäre: Konten, Inserate, Fahrzeugdaten, Nachrichten
und Bewertungen. Nicht verloren wären die Zahlungen — die stehen bei Stripe und
liessen sich von dort rekonstruieren — und die Fotos, die im Blob-Speicher
liegen. Genau diese Trennung macht den Ernstfall überschaubar: Geld ist nie nur
bei uns.

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
- **Aufräumen.** Abgelaufene Sitzungen, verbrauchte Einmal-Token, alte
  Zählerstände der Ratenbegrenzung und Vermerke über gescheiterte Mails, die
  älter als 30 Tage sind. Verbrauchte Token bleiben einen Tag stehen, damit ein
  zweiter Klick auf denselben Link «bereits verwendet» meldet und nicht
  «unbekannt».
- **Liegengebliebenes Geld melden.** Gemessen wird nach dem Nachholen: was dann
  noch eingezogen und nicht weitergeleitet ist, konnte der Lauf nicht heilen.
  Das steht in der Antwort, im Log und unter `/api/health`.
- **Lagebericht schicken.** Zum Schluss geht eine Mail an `OPERATOR_EMAIL` —
  aber nur, wenn etwas zu tun ist: offene Rückbuchungen (die haben eine Frist
  und stehen zuoberst), liegengebliebenes Geld, Abschlüsse, die der Lauf nicht
  durchbrachte, Vorgänge, die seit mehr als drei Tagen mit hinterlegtem Geld
  warten, gescheiterte Mailversuche und offene Meldungen. Ist alles in Ordnung,
  kommt nichts. Eine
  tägliche «alles gut»-Mail liest nach einer Woche niemand mehr — und dann
  geht auch die eine unter, die zählt.

## Wenn keine Mail mehr ankommt

Der Mailversand ist die stillste Stelle der Anwendung. Lehnt Resend ab — Domain
nicht mehr verifiziert, Schlüssel zurückgezogen, Kontingent aufgebraucht —,
läuft alles andere weiter: Die Registrierung meldet Erfolg, die Seite sieht
normal aus, nur bekommt niemand mehr eine Bestätigung, und wer sein Passwort
vergisst, kommt nicht mehr ins Konto. Bisher stand davon nichts ausser einer
Zeile im Server-Log, und der Lagebericht kann es nicht melden — er ist selbst
eine Mail.

Jetzt hinterlässt jeder Fehlversuch eine Zeile in `mail_failures`: Zeitpunkt,
Empfängerdomain, Betreff, Grund. Die **Domain** und nicht die Adresse, weil für
die Diagnose nur der Unterschied zwischen «alles an gmx.ch scheitert» und
«alles scheitert» zählt; die volle Adresse wäre ein Personendatum in einem
Fehlerprotokoll. Vermerkt wird nur der eingerichtete Fall — ein fehlender
Schlüssel ist kein Fehlversuch, sondern der lokale Normalzustand, und den
melden `npm run preflight` und `/api/health` ohnehin.

Gelesen wird das an drei Stellen:

- **`/admin/betrieb`** zeigt den Kasten ganz oben, bei den Dingen, die Geld
  kosten.
- **`/api/health`** nennt die Zahl bei `mailversand`. Auf `fehler` — also 503 —
  geht die Prüfung erst bei einem Muster: drei Fehlversuche innerhalb einer
  Stunde. Ein einzelner kann eine falsch getippte Adresse sein, und dafür soll
  niemand nachts geweckt werden.
- **Der Lagebericht** nimmt es als Punkt auf. Scheitert der Versand nur an
  einzelnen Domains, kommt der Bericht durch — und ist dann die einzige Stelle,
  an der es überhaupt auffällt.

Dazu die andere Hälfte: Wer auf eine Mail an die eigene Adresse wartet, bekommt
jetzt die Wahrheit gesagt. «Bestätigungslink verschickt» stand vorher auch da,
wenn der Versand abgelehnt hatte — die Person wartete dann auf etwas, das nie
kam, und beim nächsten Versuch stand ihr die Ratenbegrenzung im Weg. Das gilt
für den erneuten Bestätigungslink, den Adresswechsel und die Begrüssung nach
der Registrierung.

## Was die Rechtsseiten sagen

Die drei Rechtsseiten beschreiben, was der Code tut — nicht, was üblicherweise
in solchen Texten steht. Das ist keine Zierde, sondern der einzige Weg, sie
richtig zu halten: eine Behauptung, die nicht aus dem Code kommt, veraltet beim
ersten Umbau, und niemand merkt es.

Deshalb kommen die Aufbewahrungsfristen in der Datenschutzerklärung aus
`lib/auth/tokens.ts` und `lib/wartung.ts` (Sitzung 30 Tage, Bestätigungslink 7
Tage, Passwortlink 1 Stunde, Adresswechsel 24 Stunden, verbrauchte Links und
Zähler einen Tag später), der Satz über die Kartengebühr in den AGB aus
`platformFee` — der Aufschlag deckt genau Stripes Anteil, bei der Plattform
bleibt nichts —, und der Hinweis, dass ein zugesagter Tausch die Kontolöschung
aufhält, aus der Prüfung in `actions/account.ts`.

Die Liste der Dienstleister ist der einzige Teil, der nicht ganz aus dem Code
kommt. Vercel, Stripe und Resend sind eingebaut und lassen sich nicht
wegkonfigurieren. Hinter `DATABASE_URL` kann dagegen jeder Anbieter stecken —
die Anwendung weiss es nicht, und in einem Rechtstext wird nicht geraten.
Darum `OPERATOR_DB_PROVIDER`: fehlt die Angabe, sagt die Seite «der Anbieter
ist hier noch nicht eingetragen», und `npm run preflight` meldet es als Fehler.

## Was vor dem Livegang noch fehlt

- **Impressum, Datenschutz und AGB** müssen juristisch geprüft werden.
  Insbesondere ist zu klären, ob die Treuhandfunktion unter das
  Geldwäschereigesetz fällt — die Konstruktion über Stripe Connect ist darauf
  ausgelegt, dass nie autotauschen selbst Gelder Dritter hält. Die Firmenangaben
  kommen aus `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` und
  `OPERATOR_LEGAL_FORM` und `OPERATOR_UID`, optional dazu `OPERATOR_REGISTER`
  und `OPERATOR_PHONE`. Fehlt eines davon, benennt die Seite es einzeln —
  statt eine vollständige Rechtsseite vorzutäuschen. `/api/health` meldet den
  Zustand als `impressum`.

  Was beschreibbar war, steht inzwischen drin (siehe unten). Offen sind die
  Punkte, die eine Entscheidung verlangen und keine Beschreibung: **Haftung**
  und **Gerichtsstand** in den AGB — bei Verträgen mit Konsumentinnen ist er
  nicht frei wählbar —, eine **Vertretung in der EU**, falls das DSGVO-Regime
  greift, und die **Garantie für die Bekanntgabe ins Ausland** je Anbieter
  (Angemessenheitsbeschluss oder Standardvertragsklauseln). Die Seiten benennen
  diese Lücken selbst.
- **Name und Marke.** `autotauschen.app` ist gekauft, `autotauschen.ch` folgt
  und wird dann als Weiterleitung eingerichtet. Der Name sagt, was das Produkt
  tut — das ist sein Vorzug und zugleich seine markenrechtliche Schwäche:
  beschreibende Zeichen sind als Wortmarke schwer zu schützen. Realistisch ist
  eine Wort-Bild-Marke aus Signet und Schriftzug. Vor dem Livegang gehört eine
  Recherche in Swissreg für die Klassen 35 (Vermittlung) und 36 (Zahlungen)
  gemacht — nicht um selbst einzutragen, sondern um sicher zu sein, dass der
  Name niemandem gehört.
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
- **Der Streitfall selbst.** Rückbuchungen und Erstattungen werden erkannt,
  gemeldet und in der Betriebsübersicht geführt (siehe unten) — die
  Stellungnahme bei Stripe und die Einigung zwischen den Beteiligten macht
  weiterhin ein Mensch. Automatisch geheilt wird nichts: nach einem
  abgeschlossenen Tausch sind die Autos umgeschrieben.
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
| `SITE_URL` | Basis für Mail-Links und Stripe-Rücksprung (Produktion: `https://autotauschen.app`) | fällt auf `localhost` zurück, Fehler im Log |
| `STRIPE_SECRET_KEY` | Zahlungen | Tausche mit Wertdifferenz nicht möglich |
| `STRIPE_WEBHOOK_SECRET` | Webhook-Signatur | Webhook antwortet mit 503 |
| `RESEND_API_KEY` + `MAIL_FROM` | Mailversand | keine Bestätigungs- und Reset-Mails, und die Pflicht zur bestätigten Adresse entfällt |
| `BLOB_READ_WRITE_TOKEN` | Fotouploads | Upload antwortet mit 503 |
| `BLOB_PUBLIC_HOST` | erlaubter Foto-Host | wird aus dem Token abgeleitet |
| `OPERATOR_NAME`, `OPERATOR_LEGAL_FORM`, `OPERATOR_ADDRESS`, `OPERATOR_UID`, `OPERATOR_EMAIL` | Pflichtangaben im Impressum | die Seite benennt die fehlenden Felder einzeln |
| `OPERATOR_REGISTER`, `OPERATOR_PHONE` | ergänzende Angaben | werden weggelassen |
| `OPERATOR_DB_PROVIDER` | Wer die Datenbank betreibt — für die Datenschutzerklärung | die Seite benennt die Lücke, statt einen Anbieter zu erfinden |
| `HEALTH_TOKEN` | Details unter `/api/health` (nur als `Authorization: Bearer …`) | Details nur ausserhalb der Produktion |
| `CRON_SECRET` | Die täglichen Läufe unter `/api/cron/*` | ersatzweise `HEALTH_TOKEN`; ohne beide laufen sie in Produktion nicht |
| `PLATFORM_FEE_PERCENT` / `PLATFORM_FEE_FIXED_MINOR` | Zahlungsgebühr | 2.9 % + 30 Rappen |
