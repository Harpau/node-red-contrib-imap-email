# Release-Checkliste

Diese Checkliste beschreibt Pruefung und spaetere Veroeffentlichung von
`@compeso/node-red-contrib-imap-email`. Sie ist kein Testprotokoll und erteilt
keine Freigabe fuer Push, Merge, Tags, GitHub-Releases oder Veroeffentlichung.
Ein `npm publish` und die Aktualisierung auf flows.nodered.org erfolgen erst
nach ausdruecklicher menschlicher Freigabe des konkreten Release-Stands.

## 1. Stand und Voraussetzungen

- Letzte veroeffentlichte Version: `1.0.1`. Neue Aenderungen stehen unter
  `Unreleased`; Ziel des kompatiblen Funktionsreleases ist `1.1.0`.
- Die Paketversion bleibt waehrend der Entwicklung `1.0.1`. Ein Entwicklungstarball
  mit dieser Nummer ist nicht mit dem bereits veroeffentlichten Paket identisch.
  Git-Commit, Working-Tree-Aenderungen und Tarball-Pruefsumme mit dokumentieren.
- Paketname: `@compeso/node-red-contrib-imap-email`.
- Repository, Homepage und Issues zeigen auf
  `https://github.com/Harpau/node-red-contrib-imap-email`.
- Gespeicherte Typen: `imap-email account`, `imap-email in`, `imap-email ack`.
  Palette-Labels: `imap email account`, `imap email in`, `imap email ack`.
- Support-Matrix: Node.js `>=22.0.0`, Node-RED `>=4.0.0`. Eine eingesetzte
  Node-RED-Version kann selbst ein hoeheres Node.js-Patchlevel verlangen.
- README, Hilfetexte, Beispiele und Changelog passen zum zu pruefenden Code.
  Keine Zugangsdaten, Tokens oder privaten Endpunkte im Paket oder Pruefprotokoll.
- [Bekannte Probleme](KNOWN_ISSUES.md) in die Release-Entscheidung einbeziehen.
  Der historische DELETE-Fehler wird in `Unreleased` durch einen gemeinsamen
  Loeschhelfer abgesichert. Seine Regressionstests und finale Abnahme muessen
  zum aktuellen Code passen; ein erfolgreicher Verbindungscheck oder das
  historische Deploy-Pruefprotokoll liefert hierzu keinen Nachweis.

## 2. Automatische Pruefung

Im Repository:

```bash
npm install
npm audit --omit=dev
npm test
npm run pack:check
git diff --check
```

Erwartung: keine fehlgeschlagenen Tests, keine Produktions-Audit-Befunde und
plausibler Paketinhalt. Das Paket enthaelt `nodes/`, `lib/`, `examples/`,
`docs/`, `README.md`, `CHANGELOG.md`, `LICENSE` und `package.json`.

Zusaetzlich in sauberer Testumgebung:

- `npm ci` und Tests auf Node.js 22.x und 24.x.
- Unter genau Node.js 22.0.0: `npm ci --engine-strict` und Tests.
  Warnungen oder ein Lauf nur auf aktuellem 22.x belegen das Minimum nicht.
- Echte Bibliotheksvertraege mit lokalem synthetischem IMAP pruefen:
  Verbindungsoptionen, Authentifizierung, Verify-/Close-Verhalten,
  Download-Streams und ACK-Ergebnisse einschliesslich Fehlerfaellen.
- Mailparser mit synthetischen MIME-Nachrichten fuer Header, Body und
  Attachments pruefen. Client-Doubles allein belegen keine Upstream-Kompatibilitaet.
- Fuer die Startpruefung Timeout, Redeploy-Abbruch, spaete Ereignisse,
  Ressourcenfreigabe und vollstaendige Status-/Logfolgen pruefen.
- Fuer ACK `delete` und Input-Fensterbereinigung pruefen: abgelehnter initialer
  STORE verhindert EXPUNGE; EXPUNGE-Fehler, verbliebene UIDs und Aenderungen von
  Verbindung, Mailbox oder UIDVALIDITY verhindern Erfolg. Nach bestaetigtem
  STORE sind Folgefehler partiell; Inflight bleibt, weitere ACK-Chunks derselben
  Gruppe stoppen. Bei partiellen oder Verbindungsfehlern bricht Input den Abruf
  ab und zaehlt unbestaetigte UIDs nicht als entfernt. Tatsaechlichen
  Serverzustand mitpruefen, einschliesslich Teilloeschung ohne Rollback.
- UIDPLUS-Pflicht und ausschliesslich auf denselben begrenzten UID-Chunk
  eingeschraenktes Bestaetigungs-SEARCH auch mit der echten Bibliothek nachweisen.
  Nur ein erfolgreiches leeres UID-Array bestaetigt die Entfernung; NO, BAD und
  Throttling duerfen nicht als leerer Erfolg gelten. Kein ALL, keine Wildcards
  und kein mailboxweites SEARCH/FETCH.
- Den temporaeren `response`-Event-Guard mit echter Bibliothek pruefen: pro
  STORE-/Delete-/SEARCH-Aufruf mindestens ein OK und kein Non-OK-Abschluss,
  einschliesslich von ImapFlow sonst als Erfolg behandelter NO-Sondertexte.
  Der Listener muss bei Erfolg und Fehler entfernt werden; keine Raw-Logs
  oder gespeicherten Servertexte/Tags hinzufuegen.

## 3. Frischen Tarball als Verbraucher installieren

```bash
npm pack
```

Genau diesen Tarball in einem separaten, frischen Node-RED-User-Verzeichnis
installieren; keine bestehende produktive Installation fuer Tests veraendern:

```bash
cd /path/to/isolated-node-red-user-directory
npm install --engine-strict /path/to/compeso-node-red-contrib-imap-email-<version>.tgz
npm audit --omit=dev
```

Danach die isolierte Node-RED-Instanz mit diesem User-Verzeichnis starten.
Paketinstallation und Produktions-Audit ausserdem als frischer Verbraucher
mit `npm install --engine-strict` ohne Repository-Lockfile unter Node.js 22.0.0
pruefen. Eine vollstaendige Node-RED-Installation wird mit der fuer sie
erforderlichen Node.js-Version betrieben. Fuer beide Abhaengigkeitsaufloesungen,
Repository und Verbraucher, Versionen und Audit-Ergebnis dokumentieren.

## 4. Echte Node-RED-Deploy-Pruefung: technischer Abschluss

Diese Pruefung ist auch ohne externen Provider verpflichtend. Einen lokalen
synthetischen IMAP-Server auf Loopback und temporaeren Ports verwenden.
Mindestens die unterstuetzte Node-RED-4.x-Linie und die vorgesehene
Zielinstallation pruefen. Synthetische Credentials ebenfalls ueber den
Node-RED-Credential-Pfad einsetzen.

Die Integrationssuite verwendet eine separate Installation von Node-RED und
des frisch gepackten Moduls. Beispiel fuer eine temporaere Installation auf
macOS/Linux, aus dem Repository mit einer passenden Node.js-Version starten:

```bash
imap_test_dir="$(mktemp -d)"
npm pack --pack-destination "$imap_test_dir"
npm install --prefix "$imap_test_dir" --engine-strict --no-audit --no-fund node-red@4.1.15 "$imap_test_dir"/compeso-node-red-contrib-imap-email-*.tgz
NODE_RED_TEST_DIR="$imap_test_dir" npm run test:integration
```

`NODE_RED_TEST_DIR` zeigt auf das Installationsverzeichnis, das beide Pakete
unter `node_modules` enthaelt. Die Suite verwaltet ihre isolierten User-Verzeichnisse
fuer Testflows separat. Fuer die reproduzierbare Einrichtung die verwendete
Node-RED-Version festhalten; reale Credentials werden nicht benoetigt.

- Drei Typen laden und deaktivierten Beispiel-Flow importieren.
- Erststart und vollstaendiger Deploy ohne Inject: ein echter Status-Node sieht
  `checking connection` und Ergebnis; es entstehen keine Probe-Output-/Stats-Nachrichten.
- Beide Modi `Modified Nodes` und `Modified Flows`: Credential-only-Wechsel
  gueltig -> ungueltig -> gueltig, Secret loeschen, unveraendertes gespeichertes
  Passwort, Account-Wechsel und Aenderung eines Node-Feldes pruefen.
- Weiterlaufende Nodes erhalten keine neue Probe. Bei `Modified Flows` duerfen
  unveraenderte Nodes desselben neu gestarteten Flows erneut pruefen.
- Gemeinsame Accounts teilen eine laufende Probe. Unbenutzte Accounts und
  ausschliesslich deaktivierte Nodes/Flows erzeugen null Probeverbindungen.
- Zwei Subflow-Instanzen mit gemeinsamem globalem Account und mit getrennten
  lokalen Account-Instanzen pruefen; Verbindungen serverseitig zaehlen.
- Redeploy waehrend langsamer Probe beendet alte Verbraucher zeitnah und ohne
  spaete Statusmeldungen oder Warnungen. Ein abgebrochener geplanter Start
  erzeugt keinen Client. 30-Sekunden-Gesamtfrist und kuerzere Teilfristen pruefen.
- Sofortige regulaere Verarbeitung sowie Verarbeitung nach einer fehlgeschlagenen
  Probe bleiben moeglich. ACK-Konfigurationsfehler und regulaere Statusmeldungen
  werden nicht von der Probe ueberschrieben.
- Download und `flag`, `copy`, `move`, `delete` samt Fehlerfaellen mit
  synthetischen Nachrichten pruefen. Probe- und Arbeitsverbindungen getrennt zaehlen.
- Den neuen DELETE-Schutz im gepackten Modul pruefen: kein erfolgreicher ACK
  bei abgelehntem STORE oder unbestaetigter Entfernung; partielle Fehler und
  der Abbruch der Input-Fensterbereinigung muessen am Node-Ausgang sichtbar sein.

Erfolg bestaetigt eine vom Server akzeptierte authentifizierte Sitzung. Bei
`PREAUTH` wird das konfigurierte Secret nicht erneut herausgefordert. Die Probe
waehlt keine Mailbox aus und prueft keine ACK-Berechtigungen. Normaler Close vor
Connect-Resolve, Logout-OK/NO/BAD, Socket-Close und haengender Logout muessen
zum dokumentierten oeffentlichen Bibliotheksvertrag passen.

Ausstehende Tests dieses Abschnitts verhindern den technischen Abschluss.

## 5. Externer Provider-Test vor dem Release

Mit einem dedizierten Testpostfach den fertigen Tarball pruefen: gueltige und
falsche Anmeldung, Deploy, Empfang sowie ACK `flag`, `copy`, `move`, `delete`.
Destruktive Aktionen nur auf ausdruecklich dafuer vorgesehenen Testnachrichten
ausfuehren. Credentials ausschliesslich in Node-RED eingeben und weder im Chat
noch im Repository oder Pruefprotokoll speichern.

Protokollieren: Paket-/Git-Stand, Tarball-Pruefsumme, Node.js-/Node-RED-Version,
Zeitpunkt, gepruefte Szenarien, Ergebnis und offene Punkte. Historischer Nachweis:
Strato und IONOS wurden am 2026-06-17 manuell erfolgreich getestet.
Dieser alte Test bestaetigt keine spaeteren Aenderungen. Fehlt die externe
Testumgebung, bleibt der Provider-Test als offene Release-Voraussetzung stehen.

## 6. Release vorbereiten und gesondert freigeben

1. Nach erfolgreichem Praxistest Semver waehlen: Patch fuer kompatible Fehlerbehebung,
   Minor fuer kompatible Funktion, Major fuer oeffentliche Vertragsaenderungen.
   Fuer die Startpruefung ist `1.1.0` vorgesehen.
2. Version in Paket und Lockfile konsistent erhoehen; `Unreleased`-Eintraege mit
   Release-Datum uebernehmen und Entwicklungshinweise in README/Hilfen anpassen.
3. Finalen Versionsstand erneut pruefen und einen neuen Tarball erzeugen. Der
   freigegebene Tarball muss genau dem geprueften Release-Stand entsprechen.
4. Release-Commit mit sauberem Working-Tree vorbereiten und unabhaengig pruefen.
5. Nach gesonderter Push-Freigabe aktuelle GitHub-Actions-Laeufe auf dem finalen
   Stand abwarten. Alte PR-Laeufe und lokale Tests ersetzen diesen Nachweis nicht.
6. Konkreten Stand, Version, Tarball und Nachweise fuer die menschliche
   Veroeffentlichungsfreigabe vorlegen. npm-Zugang fuer `@compeso`, erforderliche
   Authentifizierung und eine noch nicht verwendete Versionsnummer pruefen;
   niemals Zugangsdaten oder Tokens in Dokumentation uebernehmen.

## 7. Erst nach Veroeffentlichungsfreigabe

- Freigegebenen Tarball als oeffentliches Paket
  `@compeso/node-red-contrib-imap-email` auf npm veroeffentlichen.
- Git-Tag/GitHub-Release dem freigegebenen Commit und der gleichen Version
  zuordnen; diese Schritte ebenfalls nur im freigegebenen Umfang ausfuehren.
- Installation der veroeffentlichten Version in einer frischen Testinstanz
  kontrollieren. Der normale Installationsweg lautet:

  ```bash
  npm install @compeso/node-red-contrib-imap-email
  ```

- Den bestehenden [Node-RED-Katalogeintrag](https://flows.nodered.org/node/@compeso/node-red-contrib-imap-email)
  angemeldet ueber `request refresh` aktualisieren und Version/README kontrollieren.
  Ein npm-Update allein aktualisiert die Flow Library nicht automatisch;
  siehe [offizielle Paketierungsanleitung](https://nodered.org/docs/creating-nodes/packaging).

Weder diese Checkliste noch erfolgreiche Tests erlauben eine automatische
Veroeffentlichung.
