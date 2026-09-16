# Release-Nachweis 1.1.0

Datum: 16.09.2026. Paket: `@compeso/node-red-contrib-imap-email`.
Der Nutzer hat Push sowie anschliessend Merge und Veroeffentlichung
ausdruecklich freigegeben.

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
Paketmetadaten, Beispiele und Editorlogik bleiben unveraendert; die erneuten
Paket- und Integrationstests pruefen den finalen Tarball. Die Provider-Tests
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
  Die GitHub-CI des finalen PR-Stands prueft die Matrix erneut.

## Zuordnung zu Git und Veroeffentlichung

Die Release-Aenderungen werden in
[PR #5](https://github.com/Harpau/node-red-contrib-imap-email/pull/5)
zusammengefuehrt. Der Tag `v1.1.0` soll exakt den freigegebenen Merge-Commit
bezeichnen. Veroeffentlicht wird der oben identifizierte Tarball.

Die tatsaechliche Ausfuehrung wird in den
[GitHub-Release-Notizen](https://github.com/Harpau/node-red-contrib-imap-email/releases/tag/v1.1.0)
mit finalem Commit und CI-Link dokumentiert. Dort werden npm-Verifikation,
Installation aus der Registry und Katalogaktualisierung erst nach ihrem
Erfolg bestaetigt. Eine Freigabe oder dieses Pruefprotokoll allein behauptet
noch keine abgeschlossene Veroeffentlichung.

## Grenzen

`connected` bestaetigt die letzte akzeptierte authentifizierte Sitzung;
die Probe haelt keine Dauerverbindung und prueft keine Mailbox-/ACK-Rechte.
PREAUTH kann eine Sitzung ohne erneute Secret-Pruefung liefern. Die
Provider-Abnahme prueft gezielt eine Nachricht je ACK-Aktion und ist kein
Lasttest. Partielle Loeschfehler koennen bereits erfolgte Serveraenderungen
hinterlassen; es gibt keinen automatischen Rollback.

Historische Pruefprotokolle bleiben unveraendert. Dieses Maintainer-Protokoll
ist nicht Bestandteil des npm-Tarballs.
