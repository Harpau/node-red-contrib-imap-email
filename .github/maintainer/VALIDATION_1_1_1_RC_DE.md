# Lokale Abnahme: unveröffentlichter Kandidat 1.1.1

Stand: 25. Oktober 2026. Paket:
`@compeso/node-red-contrib-imap-email@1.1.1` auf `codex/release-1.1.1-candidate`.
Dies ist ein lokaler Kandidat ohne Veröffentlichung oder Git-Tag. Eine lesende
npm-Abfrage am Prüftag ergab ausschließlich die veröffentlichten Versionen
`1.0.0`, `1.0.1` und `1.1.0` mit Dist-Tag `latest` auf `1.1.0`; `1.1.1` war
unbenutzt.

## Anlass

Am 22. und 23. Oktober 2026 wurden moderate Advisories für Produktions-
abhängigkeiten veröffentlicht: Nodemailer `< 10.1.4` (GHSA-8c8m-p3m8-cjg8,
GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h; Adress-Parser, den Mailparser für
Adress-Header nutzt) und ip-address `<= 10.7.3` (GHSA-rxp7-6hxx-x8q5; transitiv
über socks/ImapFlow). Das Repository-Lockfile von Release `1.1.0` löste
Nodemailer `10.0.10` und ip-address `10.7.2` auf; `npm audit --omit=dev` und
damit der CI-Schritt schlugen fehl.

## Änderungen und zugehörige Commits

| Commit | Inhalt |
| --- | --- |
| `8a14ebd` | Lockfile: Mailparser 3.12.4, Nodemailer 10.2.1, ip-address 10.7.5 (PR #7, Merge `cc40a69`, CI auf `main` erfolgreich) |
| `9ae6c6f` | Lockfile: ImapFlow 2.9.1 (PR #8) |
| `1d631e7` | Drei Bibliotheksvertragstests, `docs/KNOWN_ISSUES.md` und zwei Kommentare in `lib/imap-delete.js` an ImapFlow 2.9.1 angeglichen; neuer Test pinnt die Upstream-STORE-Prüfung (PR #8, Merge `a76ca61`) |
| `48cfb39` | Laufzeitanforderungen auf ImapFlow `^2.9.1` und Mailparser `^3.12.4` angehoben; Metadaten-Test, Kommentar und KNOWN_ISSUES entsprechend angepasst |

Der Commit, der dieses Protokoll einführt, erhöht Paket und Lockfile auf `1.1.1`
und aktualisiert Changelog, README, `docs/INSTALL_DE.md`, `docs/RELEASE_DE.md`,
`AGENTS.md` sowie die Maintainer-Dokumente. Gegenüber dem Release-Tag `v1.1.0`
ist das Runtime-JavaScript in `lib/`, `nodes/` und `examples/` bis auf
Kommentare in `lib/imap-delete.js` unverändert; die Hilfetexte in `nodes/*.html`
sind unverändert. Keine neuen produktiven Abhängigkeiten, keine Anhebung der
Mindestversionen Node.js 22.0.0 / Node-RED 4.0.0.

Entscheidung zur Prüfung durch den Maintainer: Die Anhebung der deklarierten
Bereiche in `48cfb39` folgt dem Vorgehen bei `1.1.0` (Bereiche auf den
getesteten Lockfile-Stand). Ohne diese Anhebung würde `1.1.1` Verbrauchern mit
eigenem Lockfile keine bereinigte Nodemailer-Version garantieren. Der Commit
ist separat und kann einzeln verworfen werden; Changelog und Dokumente wären
dann anzupassen.

## Automatische Prüfung des Kandidaten

Umgebung: Node.js 26.12.1, npm 11.20.0, macOS. Kein lokaler Versionsmanager;
Node.js 22.0.0, 22.x und 24.x wurden lokal nicht ausgeführt.

| Prüfung | Ergebnis |
| --- | --- |
| `npm ci --engine-strict --no-audit --no-fund` aus dem Repository-Lockfile | Erfolgreich |
| `npm audit --omit=dev`, Repository-Lockfile | 0 Schwachstellen |
| `npm test` (Unit-, Metadaten-, Beispiel- und echte Bibliotheksvertragstests mit lokalem synthetischem IMAP und synthetischen MIME-Nachrichten) | 268/268 Tests bestanden, keine übersprungenen |
| `npm run pack:check` | 24 Dateien, keine Tests, Testschlüssel oder Entwicklungsdateien |
| `git diff --check` | Sauber |
| Frischer Tarball als Verbraucher ohne Repository-Lockfile mit `--engine-strict` neben Node-RED 4.1.15 | Erfolgreich; Auflösung ImapFlow 2.9.1, Mailparser 3.12.4, Nodemailer 10.2.1, ip-address 10.7.5 |
| Produktions-Audit der isolierten Installation | Paketbaum ohne Befund; verbleibende Befunde liegen ausschließlich im eigenen Abhängigkeitsbaum von Node-RED 4.1.15 |
| Dateivergleich Tarball / Arbeitskopie / isolierte Installation | Alle 24 ausgelieferten Dateien identisch |
| Isolierte Node-RED-4.1.15-Integration mit diesem Tarball (`npm run test:integration`) | 19/19 TAP-Tests bestanden, keine übersprungenen |

Die GitHub-CI hat die Lockfile-Commits `8a14ebd` und `9ae6c6f`/`1d631e7` über
PR #7 und PR #8 sowie die Merge-Commits auf `main` jeweils auf Node.js 22.0.0,
22.x und 24.x erfolgreich geprüft. Für den Kandidatenstand selbst (Bereiche und
Version `1.1.1`) liegt noch kein CI-Lauf vor.

## Geprüfter Tarball

Datei: `compeso-node-red-contrib-imap-email-1.1.1.tgz`, erzeugt mit `npm pack`
aus diesem Stand. Die Datei ist durch `*.tgz` in `.gitignore` absichtlich nicht
versioniert.

SHA-256:
`7e95034092b1ad24d52fb9f44ec51557187e2e84a0ce669953ef11d0f4eb3f36`

24 Dateien, 67,5 kB komprimiert, 255,8 kB entpackt. Die Paketnummer enthält
keinen `-rc`-Suffix; „Kandidat“ bezeichnet den unveröffentlichten
Freigabestatus. Diesen konkreten Tarball für den Provider-Test verwenden.
Spätere Änderungen am Paketinhalt erzeugen einen anderen Kandidaten.

## Technische Wirkung

- Frische Installationen von `1.1.1` erhalten garantiert Mailparser `>= 3.12.4`
  mit Nodemailer `>= 10.2.1`. ip-address bleibt eine transitive Abhängigkeit
  von socks über ImapFlow und wird nur über das jeweilige Lockfile aufgelöst;
  Verbraucher mit eigenem Lockfile sollten es z. B. per `npm audit fix` erneuern.
- ImapFlow `>= 2.9.1` prüft das Ergebnis des internen `\Deleted`-STORE selbst.
  Der gemeinsame begrenzte Löschhelfer des Pakets behält seine explizite
  STORE-Prüfung, die Delete-Prüfung, das UID-begrenzte Bestätigungs-SEARCH und
  den `response`-Event-Guard unverändert.
- Mit ImapFlow `>= 2.0.8` wirft ein nach den bibliothekseigenen Wiederholungen
  weiterhin gedrosselter Abruf `ETHROTTLE`, statt ein leeres Fenster zu liefern.
  `imap email in` behandelt das wie jeden anderen Abruffehler: roter Status,
  Fehlerobjekt auf Ausgang 2 und `node.error`; kein transienter
  Verbindungsfehler. Verbraucher von `1.1.0` erhalten diese Versionen über den
  bisherigen Bereich `^2.0.5` bereits.
- Keine Änderung an Flow-Verträgen, Node-Typen, Konfigurationsfeldern oder
  Zustellsemantik.

## Nicht geprüft

- Node.js 22.0.0, 22.x und 24.x lokal; Nachweis über die GitHub-CI nach Push.
- Externer Provider-Test mit diesem Tarball.
- Node-RED 5.x; die Integration lief ausschließlich mit Node-RED 4.1.15.

## Offene Release-Voraussetzungen

1. Gesondert freigegebener Push/PR und erfolgreiche GitHub-Actions-Läufe für
   diesen Stand auf Node.js 22.0.0, 22.x und 24.x.
2. Externer Provider-Test mit dem oben identifizierten Tarball nach
   `docs/RELEASE_DE.md` Abschnitt 5, ohne Secrets im Protokoll.
3. Entscheidung über die Anhebung der Abhängigkeitsbereiche (`48cfb39`).
4. Separate Freigabe für Merge, Entfernen der Kandidatenhinweise mit
   Release-Datum, Tag, npm-Veröffentlichung und Aktualisierung des
   Node-RED-Katalogs. Danach einen zentralen Release-Nachweis `RELEASE_1_1_1_DE.md`
   anlegen und die Einstiegsdokumente aktualisieren.

Die Freigaben für Release `1.1.0` gelten nicht für diesen Kandidaten.
