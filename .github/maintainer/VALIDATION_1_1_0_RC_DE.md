# Lokale Abnahme: unveröffentlichter Kandidat 1.1.0

Stand: 16. September 2026. Paket:
`@compeso/node-red-contrib-imap-email@1.1.0` auf `codex/imap-deploy-check`.
Dies ist ein lokaler Kandidat ohne Veröffentlichung oder Git-Tag. Die zuletzt
auf npm ermittelte veröffentlichte Version ist `1.0.1`.

## Änderungen und zugehörige Commits

| Commit | Inhalt |
| --- | --- |
| `91e6400` | Laufzeitabhängigkeiten aktualisiert und mit echter Bibliothek geprüft |
| `5c52099` | IMAP-Verbindungsprüfung beim Start aktiver Input-/ACK-Nodes |
| `c0ef88c` | Mindestversion, Audit und gepacktes Modul in CI prüfen |
| `3842604` | Wartungs- und Release-Dokumentation abgeglichen |
| `021c331` | Gemeinsame, begrenzte Löschprüfung mit bestätigten Serverantworten |

Der Commit, der dieses Protokoll einführt, erhöht Paket und Lockfile auf `1.1.0`
und aktualisiert die Kandidatendokumentation. Die Laufzeitdateien entsprechen
`021c331`; spätere Änderungen erfordern neue passende Prüfnachweise.

Betroffene Bereiche: `package.json`, `package-lock.json`, `.github/workflows/`,
`lib/imap-connection-check.js`, `lib/imap-delete.js`, `lib/imap-connection.js`,
`lib/imap-ack-actions.js`, `nodes/`, `test/`, README, Changelog, `docs/` und
`.github/maintainer/`. Keine zusätzlichen produktiven Abhängigkeiten und keine
Anhebung der Mindestversionen Node.js 22.0.0 / Node-RED 4.0.0.

## Automatische Prüfung des Kandidaten

| Prüfung | Ergebnis |
| --- | --- |
| `npm install --engine-strict` | Erfolgreich |
| Frische Quellkopie, `npm ci --engine-strict`, genau Node.js 22.0.0 | Erfolgreich, 267/267 Tests bestanden |
| `npm test`, Node.js 22.14.0 | 267/267 Tests bestanden |
| `npm test`, Node.js 24.21.0 | 267/267 Tests bestanden |
| `npm audit --omit=dev`, Repository-Lockfile | 0 Schwachstellen |
| Frischer Tarball-Verbraucher ohne Repository-Lockfile, Node.js 22.0.0, `--engine-strict` | Erfolgreich; alle drei öffentlichen Node-Typen laden und registrieren |
| Account-, Prüfhelfer-, Löschhelfer- und echte Bibliothekstests gegen diesen installierten Paketcode | 106/106 Tests bestanden |
| `npm audit --omit=dev`, frische Verbraucherinstallation | 0 Schwachstellen |
| Finale Metadaten-, Registry-, Lade- und Beispieltests nach Abschluss der Hilfetexte | 28/28 Tests bestanden |
| `npm run pack:check` und tatsächlicher Tarball | Erfolgreich, 24 Dateien, keine Tests, Testschlüssel oder Entwicklungsdateien |
| Finaler Tarball in echtem Node-RED 4.1.15 / Node.js 22.14.0 | 18 Szenarien, 19/19 TAP-Tests einschließlich übergeordnetem Test bestanden |
| Dateivergleich Tarball / Arbeitskopie / isolierte Node-RED-Installation | Alle 24 ausgelieferten Dateien identisch |

Alle genannten Testläufe ohne Fehler, Abbrüche oder übersprungene Tests.
Direkte installierte Abhängigkeiten: ImapFlow `2.0.5`, Mailparser `3.9.28`.
Die frische Verbraucherinstallation löste `process-warning` auf `5.1.0` auf;
das Repository-Lockfile enthält `5.0.0`. Die 106 Tests liefen deshalb direkt
gegen das tatsächlich installierte Verbraucherpaket. Beide Installationen
verwenden Nodemailer `10.0.10` und Pino `10.3.1`.

Die Node-RED-Integration prüfte insbesondere Deploy-Modi, gespeicherte
Credential-Änderungen, Subflow-Accounts, Redeploy während laufender Probe,
Status-Nodes sowie regulären Download und ACK. Der zusätzliche DELETE-Fall
belegt: abgelehnter STORE erzeugt keinen erfolgreichen ACK; Inflight bleibt,
derselbe Token kann erfolgreich wiederholt werden und eine fremde gelöschte
Nachricht bleibt erhalten. Nur begrenzte UID-Kommandos werden verwendet.

## Geprüfter Tarball

Datei: `compeso-node-red-contrib-imap-email-1.1.0.tgz` im lokalen Repository.
Die Datei ist durch `*.tgz` in `.gitignore` absichtlich nicht versioniert.

SHA-256:
`67128cd4d8ef5ed6f0d44915acae17476eb20129514e45fdeb8f40da4b8017b2`

Die Paketnummer enthält keinen `-rc`-Suffix; „Kandidat“ bezeichnet den
unveröffentlichten Freigabestatus. Diesen konkreten Tarball für den Provider-Test
verwenden. Spätere Änderungen am Paketinhalt erzeugen einen anderen Kandidaten.
Eine lesende npm-Abfrage am Prüftag ergab ausschließlich die veröffentlichten
Versionen `1.0.0` und `1.0.1`; `1.1.0` war zu diesem Zeitpunkt noch unbenutzt.

## Technische Wirkung und unabhängige Prüfung

- Aktive Nodes prüfen beim Start eine authentifizierte IMAP-Verbindung und
  zeigen `checking connection`, danach `connected` oder einen festen Fehlertext.
  Gemeinsame laufende Proben, 30-Sekunden-Gesamtfrist, Abbruch beim Redeploy und
  Vorrang regulärer Verarbeitungsstatus sind abgesichert.
- ACK-Löschen und optionale Input-Fensterbereinigung verlangen bestätigtes
  Setzen von `\Deleted`, bestätigtes Löschen und eine erfolgreiche leere
  UID-Suche ausschließlich im selben begrenzten Chunk. UIDPLUS bleibt Pflicht.
- Ein temporärer Listener für das öffentliche `response`-Ereignis verhindert,
  dass von ImapFlow verschleierte Serverfehler als Erfolg gelten. Keine privaten
  Bibliotheksmethoden und keine unbeschränkte Postfachsuche.
- Fehler erhalten ACK-Inflight. Partielle Fehler stoppen weitere Chunks der
  betroffenen Gruppe; Input bricht bei partiellen oder Verbindungsfehlern ab.
  Vorherige Änderungen am Server werden nicht zurückgerollt.
- Unabhängige Agenten prüften Architektur, echte Bibliotheksverträge,
  Node-RED-Lifecycle und Release-Dokumentation. Der abschließende Code-Review
  meldete keine offenen Blocker. Regressionstests prüfen auch die Entfernung
  temporärer Listener sowie unveränderte fremde, bereits gelöschte Nachrichten.

Alle IMAP-Tests verwendeten lokale synthetische Server, Nachrichten und
Zugangsdaten. Dies ersetzt keinen Test mit einem externen Mailanbieter.

## Offene Release-Voraussetzungen

1. Dediziertes Testpostfach auf der vorgesehenen Zielinstallation: gültige und
   falsche Anmeldung, Credential-Änderung und Deploy, Empfang sowie ACK `flag`,
   `copy`, `move` und `delete`. Destruktive Aktionen nur auf Testnachrichten.
   Versionen, Paketprüfsumme und Ergebnisse festhalten; keine Secrets speichern.
   Angaben zur Zielinstallation und zum Testkonto stehen noch aus.
2. Gesondert freigegebener Push/PR und erfolgreiche GitHub-Actions-Läufe für
   diesen Stand. Lokale Ergebnisse belegen keine bereits gelaufene Remote-CI.
3. Prüfung der finalen Release-Dokumentation, separate Freigabe für Merge, Tag,
   npm-Veröffentlichung und Aktualisierung des Node-RED-Katalogs.

Die Startprüfung bestätigt keine Mailbox-/ACK-Rechte und ist keine dauerhafte
Verbindungsüberwachung. Verbleibende `\Deleted`-Flags nach partiellen Fehlern
können die erneute Auswahl beeinflussen. Details:
[bekannte Probleme](../../docs/KNOWN_ISSUES.md) und
[Release-Checkliste](../../docs/RELEASE_DE.md).

Empfohlener nächster Commit nach erfolgreichem Praxistest:
`docs: record provider acceptance for 1.1.0`. Bei einem Fehler zuerst eine
gezielte Korrektur samt Regressionstest und einen neuen Kandidaten erstellen.
