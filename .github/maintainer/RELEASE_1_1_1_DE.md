# Release-Nachweis 1.1.1

Datum: 25.10.2026. Paket: `@compeso/node-red-contrib-imap-email`.
**Status: Release abgeschlossen; Refresh des Node-RED-Katalogs offen.**
Version `1.1.1` ist auf npm als `latest` veroeffentlicht, Tag `v1.1.1` und der
GitHub-Release sind oeffentlich, die Installation aus der Registry ist
geprueft. Der Nutzer hatte Push, Merge, Tag, GitHub-Release und
npm-Veroeffentlichung jeweils ausdruecklich freigegeben. Diese Freigaben
gehoeren zu diesem abgeschlossenen Release und sind keine Freigabe fuer
spaetere Releases. Der Node-RED-Katalog zeigte am 25.10.2026 noch `1.1.0`;
der Refresh ueber die Flow Library ist der letzte offene Schritt.

## Umfang

- Laufzeitanforderungen auf ImapFlow `^2.9.1` und Mailparser `^3.12.4`
  angehoben. Damit erhalten frische Installationen Nodemailer `>= 10.2.1`
  (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h) und ImapFlow
  mit eigener STORE-Pruefung in `messageDelete()`. ip-address wird transitiv
  ueber socks aufgeloest und nur im Lockfile auf `10.7.5` gehoben
  (GHSA-rxp7-6hxx-x8q5).
- Bibliotheksvertragstests an ImapFlow 2.9.1 angeglichen; der begrenzte
  Loeschhelfer behaelt seine explizite STORE-Pruefung als zusaetzliche
  Absicherung.
- Keine Aenderung an Runtime-Logik, Flow-Vertraegen, Hilfetexten, Beispiel
  oder den Mindestversionen Node.js `>=22.0.0` / Node-RED `>=4.0.0`.

Commits auf `main` seit `v1.1.0`:

| Commit | Inhalt | PR / Merge |
| --- | --- | --- |
| `8a14ebd` | Lockfile: Mailparser 3.12.4, Nodemailer 10.2.1, ip-address 10.7.5 | PR #7, `cc40a69` |
| `9ae6c6f` | Lockfile: ImapFlow 2.9.1 | PR #8, `a76ca61` |
| `1d631e7` | Vertragstests, KNOWN_ISSUES und Kommentare an ImapFlow 2.9.1 angeglichen | PR #8, `a76ca61` |
| `48cfb39` | Laufzeitanforderungen `^2.9.1` / `^3.12.4` | PR #9, `c9e3c53` |
| `519062b` | Unveroeffentlichter Kandidat 1.1.1: Version, Changelog, Kandidatendokumentation, RC-Protokoll | PR #9, `c9e3c53` |
| `d93117f` | Provider-Abnahme des Kandidaten dokumentiert | PR #10, `0b554ba` |

Der Release-Commit `ab70a81` (PR #11, Merge `b545686`) entfernt die
Kandidatenhinweise aus README, Changelog, `docs/INSTALL_DE.md` und
`docs/RELEASE_DE.md`, setzt das Changelog-Datum `2026-10-25` und aktualisiert
`docs/KNOWN_ISSUES.md` sowie die Maintainer-Dokumente. Die Nachtraege in
diesem Dokument nach der Veroeffentlichung aendern den veroeffentlichten
Tarball und den Tag nicht.

## Veroeffentlichter Release-Tarball

- Datei: `compeso-node-red-contrib-imap-email-1.1.1.tgz`, erzeugt mit
  `npm pack` aus dem Merge-Commit `b545686`; als GitHub-Release-Asset
  angehaengt und unveraendert auf npm veroeffentlicht.
- SHA256: `3aac19d23f8e589bdeed7e8892d904f0f7d10588ab96a6104ffde96410890dba`
- npm SHA1: `7ed1d570dedd433965c8f87bc2a55eef68db1304`
- npm Integrity: `sha512-Wri1MBtKn52GJs0s9Xtn9LoZauGiSJXOVGPq3fRx3JMYq1ajfMk6kACxd9smFAu745VRIr1/xx1eLQ+d55QZzw==`
- 24 Dateien; 67.140 Bytes komprimiert, 254.712 Bytes entpackt.

Der provider-gepruefte Kandidaten-Tarball aus dem
[RC-Pruefprotokoll](VALIDATION_1_1_1_RC_DE.md) hat die SHA256
`7e95034092b1ad24d52fb9f44ec51557187e2e84a0ce669953ef11d0f4eb3f36`. Beide
Tarballs sind unterschiedliche Artefakte. Unabhaengiger Dateivergleich: alle 24
Pfade identisch; ausschliesslich `CHANGELOG.md`, `README.md`,
`docs/INSTALL_DE.md`, `docs/KNOWN_ISSUES.md` und `docs/RELEASE_DE.md` geaendert.
Runtime-JavaScript in `lib/` und `nodes/`, Editor-HTML, Beispiel, `package.json`
und `LICENSE` sind bytegleich. Die Provider-Abnahme wird deshalb nicht als neuer
Test dieses Tarballs ausgegeben; die automatischen Pruefungen wurden fuer ihn
wiederholt.

## Validierung des Release-Tarballs

Umgebung: Node.js 26.12.1, npm 11.20.0, macOS.

| Pruefung | Ergebnis |
| --- | --- |
| `npm ci --engine-strict --no-audit --no-fund` | Erfolgreich |
| `npm audit --omit=dev` | 0 Schwachstellen |
| `npm test` | 268/268 Tests bestanden, keine uebersprungenen |
| `npm run pack:check` | 24 Dateien |
| `git diff --check` | Sauber |
| Frischer Tarball als Verbraucher ohne Repository-Lockfile mit `--engine-strict` neben Node-RED 4.1.15 | Erfolgreich; Aufloesung ImapFlow 2.9.1, Mailparser 3.12.4, Nodemailer 10.2.1, ip-address 10.7.5 |
| Isolierte Node-RED-4.1.15-Integration mit diesem Tarball | 19/19 Tests bestanden |

Die GitHub-CI hat den Release-Stand auf Node.js 22.0.0, 22.x und 24.x
geprueft: PR-#11-Lauf auf `ab70a81`, Main-Lauf und Tag-Lauf auf `b545686`,
jeweils erfolgreich einschliesslich Produktions-Audit, Paketpruefung und
Node-RED-Integration im 22.x-Job (Links in der Tabelle unten). Der
Release-Commit aendert gegenueber dem Kandidaten ausschliesslich Dokumentation.

## Zuordnung zu Git und Veroeffentlichung

| Schritt | Abgeschlossener Nachweis |
| --- | --- |
| PR | [#11](https://github.com/Harpau/node-red-contrib-imap-email/pull/11), am 25.10.2026 gemergt |
| Gepruefter PR-Head | `ab70a819c9d0fd3c276cadd97f983cc1d77a36b0` |
| Merge-Commit / Tag-Ziel | `b5456864eedbcb602edc186675a760ffbbf92428`; annotierter Tag `v1.1.1` (Tag-Objekt `afe65a42a844049805cf15a1cea7fde8319588f8`); Git-Tree identisch mit dem geprueften PR-Head |
| PR-CI | [40211395626](https://github.com/Harpau/node-red-contrib-imap-email/actions/runs/40211395626), erfolgreich |
| Main-CI des Merge-Commits | [40211513103](https://github.com/Harpau/node-red-contrib-imap-email/actions/runs/40211513103), erfolgreich |
| Tag-CI | [40211689098](https://github.com/Harpau/node-red-contrib-imap-email/actions/runs/40211689098), erfolgreich |
| GitHub-Release | [v1.1.1](https://github.com/Harpau/node-red-contrib-imap-email/releases/tag/v1.1.1), oeffentlich, kein Prerelease; Tarball und `imap-email-1.1.1-SHA256SUMS.txt` angehaengt; Notes nach der Veroeffentlichung um Registry-Nachweise ergaenzt |
| npm | [Paket](https://www.npmjs.com/package/@compeso/node-red-contrib-imap-email), Version `1.1.1`, Dist-Tag `latest`, veroeffentlicht 2026-10-25 16:36 UTC; SHA1 und Integrity wie oben |
| Registry-Tarball | Per `npm pack @compeso/node-red-contrib-imap-email@1.1.1` heruntergeladen: SHA256 identisch, bytegleich zum Release-Asset; README in den Registry-Metadaten bytegleich zur paketierten Datei |
| Registry-Installation | Frische Installation mit `--engine-strict` neben Node-RED 4.1.15: ImapFlow 2.9.1, Mailparser 3.12.4, Nodemailer 10.2.1, ip-address 10.7.5; alle 24 Dateien bytegleich zum Release-Asset; Paketbaum im Produktions-Audit ohne Befund; 19/19 Integrationstests |
| Node-RED-Katalog | **Offen.** Lesende Kontrolle am 25.10.2026: Eintrag zeigt `1.1.0`. Angemeldet ueber `request refresh` aktualisieren, danach Version und README kontrollieren |

Hinweise zum Ablauf: `npm whoami` meldete vor der Veroeffentlichung
`401 Unauthorized`; der Nutzer meldete sich mit `npm login` (Web-Login) an.
Der erste `npm publish` aus einer nicht-interaktiven Sitzung scheiterte vor
dem Upload mit `EOTP` (Web-Authentifizierung erforderlich). Der zweite
Versuch im Terminal des Nutzers veroeffentlichte nach abgeschlossener
Authentifizierung dasselbe Asset. Die Registry stellte die Version weniger als
eine Minute nach der Erfolgsmeldung bereit.

## Grenzen

- Das Changelog-Datum `2026-10-25` entspricht dem Veroeffentlichungstag.
- Die Provider-Abnahme deckte `delete`, `move` und `flag` (`\Seen`) ab, nicht
  `copy`, Fehlanmeldung, partielle Fehler oder Throttling.
- Keine lokale Pruefung unter Node.js 22.x/24.x; Nachweis nur ueber die CI.
- `connected` der Startpruefung bestaetigt weiterhin nur die letzte
  akzeptierte authentifizierte Sitzung; partielle Loeschfehler werden nicht
  zurueckgerollt (siehe [KNOWN_ISSUES.md](../../docs/KNOWN_ISSUES.md)).

Dieses Maintainer-Protokoll ist nicht Bestandteil des npm-Tarballs.
