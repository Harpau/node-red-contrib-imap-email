# Lokale Abnahme: IMAP-Prüfung beim Deploy

Stand: 16. September 2026. Dieser Nachweis gilt für den lokal umgesetzten,
unveröffentlichten Stand auf `codex/imap-deploy-check`, ausgehend von
`1da7fc3f23ff895f59af977ff9710fad3a55bf4b`. Die Paketversion bleibt `1.0.1`;
die neuen Änderungen stehen im Changelog unter **Unreleased**, Ziel `1.1.0`.

## Ergebnis

Die automatische Startprüfung und die freigegebenen Wartungsarbeiten sind lokal
umgesetzt und geprüft. Ein separater bestehender DELETE-Fehler ist dokumentiert.
Eine Freigabe zur Veröffentlichung ist damit nicht verbunden.

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| `npm install --engine-strict` | Erfolgreich |
| `npm test`, Node.js 22.0.0 | 220 bestanden, keine Fehler oder übersprungenen Tests; aus einer frischen `npm ci --engine-strict`-Installation |
| `npm test`, Node.js 22.14.0 | 220 bestanden, keine Fehler oder übersprungenen Tests |
| `npm test`, Node.js 24.21.0 | 220 bestanden, keine Fehler oder übersprungenen Tests |
| `npm audit --omit=dev`, Repository-Lockfile | 0 Befunde |
| Frische Tarball-Installation ohne Repository-Lockfile, Node.js 22.0.0, `--engine-strict` | Erfolgreich; alle drei öffentlichen Node-Typen laden |
| Account-, Prüfhelfer- und echte Bibliotheksverträge direkt gegen diese Verbraucherinstallation | 65 bestanden, keine Fehler oder übersprungenen Tests |
| `npm audit --omit=dev`, Verbraucherinstallation | 0 Befunde |
| `npm run test:integration`, tatsächliches Node-RED 4.1.15 / Node.js 22.14.0 | 17 Szenarien bestanden; 18 TAP-Tests einschließlich übergeordnetem Test, keine Fehler oder übersprungenen Tests |
| `npm run pack:check` und tatsächlicher Tarball | Erfolgreich; 23 Dateien, keine Tests, synthetischen Schlüssel oder Entwicklungsdateien enthalten |
| Dateivergleich Tarball / Arbeitskopie / isolierte Node-RED-Installation | Alle 23 ausgelieferten Dateien identisch |
| `git diff --check` | Erfolgreich |

Direkte Abhängigkeiten: ImapFlow **2.0.5**, Mailparser **3.9.28**. Die frische
Verbraucherinstallation löste `process-warning` auf **5.1.0** auf, das
Repository-Lockfile enthält **5.0.0**. Diese Kombination wurde deshalb zusätzlich
mit den 65 genannten Tests direkt im installierten Paket geprüft.

Geprüfter Entwicklungs-Tarball: `compeso-node-red-contrib-imap-email-1.0.1.tgz`.
Er ist nicht mit der bereits veröffentlichten Version 1.0.1 gleichzusetzen.

SHA-256:
`dead5f67b5101585ebe1cf392d8ab87fc97145423a6ff72315c177f6dc1ab8bd`

## Was geprüft wurde

- Gemeinsame laufende Probe pro tatsächlicher Account-Instanz, frische Probe
  beim späteren Start, keine Probe für unbenutzte/deaktivierte Konfigurationen.
- Alle Deploy-Modi, echte gespeicherte Credential-Änderungen und -Löschung,
  TLS-Einstellungen, Accountwechsel, globale/lokale Subflow-Accounts sowie
  Prozessneustart mit gespeicherten Flows und Credentials.
- Beobachtbarkeit durch echte Status-Nodes; keine regulären Output-/Stats-
  Nachrichten durch die Probe. Download und ACK funktionieren auch nach einer
  fehlgeschlagenen Probe und während einer noch laufenden Probe.
- 30 Sekunden absolute Gesamtfrist, kürzere Teilzeitlimits, tatsächliches
  Schließen, Abbruch beim letzten Verbraucher, Generationenwechsel und Schutz
  abgeschlossener fachlicher Statusanzeigen vor verspäteten Ergebnissen.
- Sichere feste Fehlertexte und höchstens eine Warnung pro fehlgeschlagener
  Probe; keine Warnungen bei absichtlichem Abbruch, auch nicht durch späte Fehler.
- Echte ImapFlow-Verträge einschließlich PREAUTH, OAuth-Token, NAMESPACE-Fallback,
  Logout-Varianten, TLS, Download bei ignorierten Partial-Abfragen, ACK-Aktionen
  und ausgewählten Fehlerpfaden; echte MIME-Verarbeitung durch Mailparser.

Alle IMAP-Netzwerktests nutzten ausschließlich lokale synthetische Server und
Testnachrichten. Die Node-RED-Tests installierten den Tarball in einer isolierten
Umgebung und verwendeten temporäre Benutzerverzeichnisse.

## Review und geänderte Bereiche

Unabhängige Agenten prüften Laufzeitlogik, Bibliotheksverträge und tatsächlichen
Node-RED-Lifecycle. Der dabei gefundene Rückhalt des geschlossenen Clients über
eine Close-Closure wurde beseitigt. Zusätzlich sind leere Fehlergründe und Close
während eines synchronen Status-Callbacks abgesichert und getestet.

| Bereich | Dateien |
| --- | --- |
| Laufzeit | `lib/imap-connection-check.js`, `nodes/imap-email-account.js`, `nodes/imap-email-in.js`, `nodes/imap-email-ack.js` |
| Abhängigkeiten und CI | `package.json`, `package-lock.json`, `.github/workflows/test.yml`, `.github/dependabot.yml` |
| Automatische Tests | `test/imap-connection-check.test.js`, `test/imap-library-contract.test.js`, `test/account-client-error.test.js`, `test/imap-email-in-selection.test.js`, `test/imap-email-ack-actions.test.js`, `test/package-metadata.test.js`, neue Dateien unter `test/helpers/` und `test/integration/` |
| Anwenderdokumentation | `README.md`, `CHANGELOG.md`, Hilfetexte aller drei `nodes/*.html`, `docs/INSTALL_DE.md`, `docs/RELEASE_DE.md`, `docs/design-decisions-imap-email.md`, `docs/KNOWN_ISSUES.md` |
| Wartungsdokumentation | Die vier bestehenden `.github/maintainer/*.md` und dieser Nachweis |

## Vor einer Veröffentlichung offen

1. Test mit dem vorgesehenen externen Mailanbieter und einem dedizierten
   Testpostfach auf der Zielinstallation; reale Mailbox-/ACK-Rechte sind nicht
   Gegenstand der Deploy-Probe.
2. Aktuelle GitHub-Actions-Läufe nach gesondert freigegebenem Push. Lokale Tests
   sind kein Nachweis, dass die aktualisierten Actions bereits gelaufen sind.
3. Den dokumentierten [DELETE-Fehler](../../docs/KNOWN_ISSUES.md) separat behandeln:
   Nach abgewiesenem Setzen von `\Deleted` kann ACK Erfolg melden, obwohl die
   Nachricht bleibt. Der entsprechende Quellcodefehler besteht bereits in der
   ursprünglichen ImapFlow-1.4.2-Abhängigkeit; die neue Startprobe verändert den
   ACK-Executor nicht. Dies ist bei der Release-Entscheidung ausdrücklich offen.
4. Versionsanhebung, Commit-/PR-Abnahme, Tag und Veröffentlichung gesondert
   durchführen. Es wurden keine Commits, Pushes, Remote-PR-Änderungen, Tags oder
   Veröffentlichungen vorgenommen.

Empfohlene Commit-Aufteilung: Abhängigkeiten, CI, historische Dokumentation,
anschließend `feat: verify IMAP connection when nodes start` mit Tests und Hilfe.
Der erste empfohlene Commit ist `chore: update and audit runtime dependencies`.
