# Release-Nachweis 1.1.1

Datum: 25.10.2026. Paket: `@compeso/node-red-contrib-imap-email`.
**Status: Release vorbereitet, nicht veroeffentlicht.** Version `1.1.1` ist
weder getaggt noch auf npm oder im Node-RED-Katalog veroeffentlicht. Dieses
Dokument identifiziert den vorbereiteten Release-Stand und seinen Tarball. Die
Veroeffentlichungsschritte werden erst nach gesonderter menschlicher Freigabe
ausgefuehrt und danach hier nachgetragen. Die Freigaben fuer Release 1.1.0
gelten nicht fuer 1.1.1.

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

Der Release-Commit, der dieses Dokument einfuehrt, entfernt die
Kandidatenhinweise aus README, Changelog, `docs/INSTALL_DE.md` und
`docs/RELEASE_DE.md`, setzt das Changelog-Datum `2026-10-25` und aktualisiert
`docs/KNOWN_ISSUES.md` sowie die Maintainer-Dokumente.

## Vorbereiteter Release-Tarball

- Datei: `compeso-node-red-contrib-imap-email-1.1.1.tgz`, erzeugt mit
  `npm pack` aus dem Release-Commit.
- SHA256: `3aac19d23f8e589bdeed7e8892d904f0f7d10588ab96a6104ffde96410890dba`
- 24 Dateien; 67,1 kB komprimiert, 254,7 kB entpackt.

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

Node.js 22.0.0, 22.x und 24.x wurden fuer den Release-Commit noch nicht durch
die GitHub-CI geprueft; die vorangegangenen Staende (PR #9 Lauf 40206947266,
Main-Lauf 40207389607 auf `c9e3c53`, PR #10) waren auf der gesamten Matrix
erfolgreich. Der Release-Commit aendert ausschliesslich Dokumentation.

## Zuordnung zu Git und Veroeffentlichung

| Schritt | Stand am 25.10.2026 |
| --- | --- |
| Release-Commit | Vorbereitet auf `codex/release-1.1.1`, nicht gepusht |
| PR und GitHub-CI | Offen; Push braucht eine eigene Freigabe |
| Merge-Commit / Tag-Ziel | Offen |
| Tag `v1.1.1` und GitHub-Release | Offen |
| npm `1.1.1` als `latest` | Offen; lesende Abfrage am 25.10.2026: `latest` ist `1.1.0`, `1.1.1` unbenutzt |
| Registry-Installation in frischer Testinstanz | Offen |
| Node-RED-Katalog (`request refresh`) | Offen |

Nach der Veroeffentlichung sind hier Merge-Commit, Tag, CI-Laeufe, npm-SHA1
und Integrity, Registry-Installation und Katalog-Refresh nachzutragen und die
Einstiegsdokumente (`AGENTS.md`, Briefing, Startprompt, PRD, Pflegeempfehlung)
auf den abgeschlossenen Release zu aktualisieren.

## Grenzen

- Das Changelog-Datum `2026-10-25` setzt eine Veroeffentlichung an diesem Tag
  voraus. Bei spaeterer Veroeffentlichung sind Changelog, `docs/RELEASE_DE.md`
  und dieses Dokument vor dem Tag anzupassen; das erzeugt einen neuen Tarball
  mit erneuten automatischen Pruefungen.
- Die Provider-Abnahme deckte `delete`, `move` und `flag` (`\Seen`) ab, nicht
  `copy`, Fehlanmeldung, partielle Fehler oder Throttling.
- Keine lokale Pruefung unter Node.js 22.x/24.x; Nachweis nur ueber die CI.
- `connected` der Startpruefung bestaetigt weiterhin nur die letzte
  akzeptierte authentifizierte Sitzung; partielle Loeschfehler werden nicht
  zurueckgerollt (siehe [KNOWN_ISSUES.md](../../docs/KNOWN_ISSUES.md)).

Dieses Maintainer-Protokoll ist nicht Bestandteil des npm-Tarballs.
