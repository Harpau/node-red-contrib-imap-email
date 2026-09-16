# Release-Nachweis 1.1.0

Datum: 16.09.2026. Paket: `@compeso/node-red-contrib-imap-email`.
**Status: Release abgeschlossen.** Version `1.1.0` ist auf npm als `latest`
veroeffentlicht, der GitHub-Release ist oeffentlich und der Node-RED-Katalog
ist aktualisiert. Der Nutzer hatte Push sowie anschliessend Merge und
Veroeffentlichung ausdruecklich freigegeben. Diese Freigaben gehoeren zu
diesem abgeschlossenen Release und sind keine Freigabe fuer spaetere Releases.

Dieses Dokument ist die zentrale Uebergabe zum abgeschlossenen Release.
Die aelteren RC-, Deploy- und Provider-Protokolle sind historische Nachweise;
deren damalige offene Release-Schritte sind durch die folgenden Ergebnisse
abgeschlossen. Fuer neue Aenderungen immer den aktuellen Git-Stand pruefen.

## Geprueftes Artefakt

- Datei: `compeso-node-red-contrib-imap-email-1.1.0.tgz`
- SHA256: `0a2181f7a8acc7f7fb57656c5aaa131248126aaa64bd92e69f08e1a23088a297`
- npm SHA1: `a7945ada51d3262f6de8c24a9ae37c570173329e`
- npm Integrity: `sha512-ZhHtGG61McmmD8Ma8D1YkfwvpDhBNGqqK88IZjmjGqmQm+cl2IP/EsHBwgHAaGpbE5i6WBK+SPmuDSR5z9BxIg==`
- 24 Dateien; 64.917 Bytes komprimiert, 248.697 Bytes entpackt.

Der finale Tarball schliesst die Dokumentation und Node-RED-Hilfetexte ab.
Der [Provider-Nachweis](VALIDATION_PROVIDER_1_1_0_DE.md) gilt fuer den dort
identifizierten Kandidaten mit SHA256
`67128cd4d8ef5ed6f0d44915acae17476eb20129514e45fdeb8f40da4b8017b2`.
Die beiden Tarballs sind unterschiedliche Artefakte. Runtime-JavaScript,
Paketmetadaten, Beispiele und Editorlogik blieben unveraendert; die erneuten
Paket- und Integrationstests prueften den finalen Tarball. Die Provider-Tests
werden deshalb nicht als neuer Test dieses Tarballs ausgegeben.

## Validierung

- Abschliessend `npm install --engine-strict`, `npm audit --omit=dev`,
  `npm test`, `npm run pack:check` und `git diff --check`: erfolgreich.
- Node.js 22.14.0: 267/267 Tests, keine uebersprungenen Tests;
  Produktions-Audit: null Befunde.
- Frische Verbraucherinstallation des finalen Tarballs ohne Repository-Lockfile
  unter genau Node.js 22.0.0 mit `--engine-strict`: erfolgreich. Alle drei
  Node-Typen laden; 106/106 Bibliotheks-/Vertragstests erfolgreich, null
  uebersprungene Tests und null Audit-Befunde.
- Aufgeloeste Verbraucherversionen: ImapFlow 2.0.5, Mailparser 3.9.28,
  Nodemailer 10.0.10, Pino 10.3.1 und process-warning 5.1.0. Das Repository
  verwendet process-warning 5.0.0; beide Aufloesungen sind geprueft.
- Finalen Tarball physisch neu in der isolierten Node-RED-4.1.15-Installation
  installiert: alle 24 installierten Dateien bytegleich; 19/19 Integrationstests
  unter Node.js 22.14.0 erfolgreich, keine uebersprungenen Tests.
- Unabhaengiger Artefaktvergleich: identische Pfadmengen; alle 12 Runtime-JS-Dateien,
  `package.json`, Beispiel sowie HTML-Editor-Skripte/Templates bytegleich zum
  Provider-Kandidaten. Ausschliesslich sechs Markdown-Dateien und drei
  HTML-Hilfebloecke geaendert. Keine neuen Review-Befunde.
- Die vorangegangene vollstaendige Matrix auf Node.js 22.0.0, 22.14.0 und
  24.21.0 ist im [RC-Protokoll](VALIDATION_1_1_0_RC_DE.md) dokumentiert.
  Die GitHub-CI des finalen PR-Stands pruefte die Matrix erneut erfolgreich.

## Zuordnung zu Git und Veroeffentlichung

| Schritt | Abgeschlossener Nachweis |
| --- | --- |
| PR | [#5](https://github.com/Harpau/node-red-contrib-imap-email/pull/5), am 16.09.2026 gemergt |
| Gepruefter PR-Head | `f7b6f863f5dc10b68978e4ecdfbd1984e9c5b73b` |
| Merge-Commit / Tag-Ziel | `f086643b93155ab6adee17bae6431cf8802b187e`, Tag `v1.1.0`; Git-Tree identisch mit dem geprueften PR-Head |
| Finale PR-CI | [35093569302](https://github.com/Harpau/node-red-contrib-imap-email/actions/runs/35093569302), erfolgreich |
| Main-CI des Merge-Commits | [35093741617](https://github.com/Harpau/node-red-contrib-imap-email/actions/runs/35093741617), erfolgreich |
| Tag-CI | [35093873214](https://github.com/Harpau/node-red-contrib-imap-email/actions/runs/35093873214), erfolgreich |
| GitHub-Release | [v1.1.0](https://github.com/Harpau/node-red-contrib-imap-email/releases/tag/v1.1.0), oeffentlich, kein Prerelease; Tarball und SHA256-Datei angehaengt |
| npm | [Paket](https://www.npmjs.com/package/@compeso/node-red-contrib-imap-email), Version `1.1.0`, Dist-Tag `latest` am Abschlusstag bestaetigt |
| Node-RED-Katalog | [Eintrag](https://flows.nodered.org/node/@compeso/node-red-contrib-imap-email), nach Refresh Version `1.1.0` und neue README sichtbar |

Alle drei CI-Laeufe bestanden mit Node.js 22.0.0, 22.x und 24.x einschliesslich
Audit und Paketpruefung. Der jeweilige 22.x-Job pruefte zusaetzlich die
Node-RED-Integration. Das sind Nachweise fuer die angegebenen Commits,
nicht automatisch fuer spaetere Dokumentations- oder Codeaenderungen.

Der von npm heruntergeladene Tarball und das heruntergeladene GitHub-Asset
sind bytegleich zum oben identifizierten finalen Artefakt; SHA256 und
Registry-Integrity stimmen ueberein. Eine weitere frische Installation aus
der Registry unter genau Node.js 22.0.0 mit `--engine-strict`, ohne
Repository-Lockfile, war erfolgreich: alle drei Node-Typen geladen,
Produktions-Audit null Befunde. Die Aufloesung der Abhaengigkeiten entspricht
den oben genannten Verbraucherversionen. Die 106 Vertragstests wurden am
finalen lokalen Tarball ausgefuehrt; nach der bytegleichen Registry-Installation
wurden Installation, Laden der Nodes und Audit geprueft, nicht erneut diese Suite.

## Erledigte npm-Anzeige und Hinweise fuer spaetere Releases

Der erste Publish-Versuch scheiterte an einer abgelaufenen npm-Sicherheits-
bestaetigung. Vor dem erneuten Versuch wurde geprueft, dass `1.1.0` noch
nicht verfuegbar war. Der zweite Versuch veroeffentlichte denselben Tarball.
Nach der Erfolgsmeldung brauchte die Registry noch einige Minuten, bis die
Version abrufbar war. Bei einem spaeteren unklaren Publish-Ausgang deshalb
zuerst Version und Integrity pruefen, bevor ein neuer Versuch gestartet wird.

Die npm-Webseite zeigte zunaechst keine README. In den Registry-Metadaten und
im Paket war sie bereits vollstaendig und bytegleich vorhanden; auch der
Node-RED-Katalog zeigte sie. Der Nutzer bestaetigte anschliessend, dass sich
die Anzeige von selbst korrigiert hat. **Erledigt; kein offener Fehler, kein
README-Fix und keine zusaetzliche Paketversion erforderlich.** Die genaue
Ursache der verzoegerten Anzeige wurde nicht nachgewiesen.

## Lokale Testumgebung und Einstieg in den naechsten Chat

- Die bereitgestellte Testinstallation unter `~/.node-red` wurde mit
  Node-RED 5.0.7 und Node.js 22.14.0 verwendet. Dort blieb nach der Abnahme
  der Provider-Kandidat `1.1.0` installiert. Seine Runtime entspricht dem
  Release; seine Dokumentation/Hilfe ist aelter. Die Versionsnummer allein
  unterscheidet diese beiden Paketstaende nicht. Die Registry-Nachpruefung
  erfolgte in einer separaten frischen Installation, nicht durch ein
  erneutes Update dieser Testinstallation.
- Originale Flows und Account-Credentials wurden nach dem Provider-Test
  wiederhergestellt; Testflows und temporaere IMAP-Ordner wurden entfernt.
  Details und Grenzen stehen im [Provider-Nachweis](VALIDATION_PROVIDER_1_1_0_DE.md).
  Die vorherige lokale Installation wurde vollstaendig gesichert.
- Temporare Testverzeichnisse, Prozesse und npm-Anmeldungen sind kein
  dauerhafter Zustand und muessen vor erneuter Nutzung geprueft werden.
  Keine Zugangsdaten, Authentifizierungslinks oder privaten Provider-Endpunkte
  aus dieser Sitzung in kuenftige Dokumentation uebernehmen.
- Die Uebergabedokumentation wurde nach dem Release vervollstaendigt.
  Der veroeffentlichte Tarball und Tag bleiben unveraendert. Insbesondere
  die aktuelle `docs/RELEASE_DE.md` kann deshalb neuer sein als die Datei im
  Paket `1.1.0`. Aktuellen Arbeitsbaum, Commit und Release-Tag getrennt betrachten.
- Zum Einstieg [Startprompt](CODEX_START_PROMPT_DE.md) und
  [Maintainer-Briefing](MAINTAINER_BRIEFING_DE.md) lesen. Fuer `1.1.0` ist
  kein Release-Schritt mehr offen; eine neue Aufgabe, Versionswahl oder
  Veroeffentlichung nicht aus alten Vorbereitungshinweisen ableiten.

## Grenzen

`connected` bestaetigt die letzte akzeptierte authentifizierte Sitzung;
die Probe haelt keine Dauerverbindung und prueft keine Mailbox-/ACK-Rechte.
PREAUTH kann eine Sitzung ohne erneute Secret-Pruefung liefern. Die
Provider-Abnahme prueft gezielt eine Nachricht je ACK-Aktion und ist kein
Lasttest. Partielle Loeschfehler koennen bereits erfolgte Serveraenderungen
hinterlassen; es gibt keinen automatischen Rollback.

Historische Pruefprotokolle bleiben unveraendert. Dieses Maintainer-Protokoll
ist nicht Bestandteil des npm-Tarballs.
