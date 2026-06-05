# Empfehlung für die langfristige Pflege

## 1. Repository als Quelle der Wahrheit

Langfristig sollte nicht mehr mit einzelnen ZIPs als Primärquelle gearbeitet werden. Das GitHub-Repository sollte die Quelle der Wahrheit sein.

ZIPs und Tarballs sind gut für:

- Releases,
- Tests in isolierten Umgebungen,
- Übergabe an neue Chats,
- Archivierung.

Für laufende Pflege ist besser:

```text
GitHub Issue -> Branch -> Änderung -> npm test -> Pull Request -> GitHub Actions -> Merge -> Tag -> npm publish
```

## 2. Kleine Änderungen, kleine Releases

Empfohlene Semver-Regel:

```text
1.0.x  Bugfixes, Dokumentationsfixes, kleine interne Verbesserungen
1.x.0  kompatible neue Features
2.0.0  Breaking Changes
```

Beispiele:

```text
Bug in ACK-Batching                  -> Patch
Neues Diagnostics-Feld               -> Minor, wenn kompatibel
Message-Shape ändern                 -> Major
Node-Typnamen ändern                 -> Major
OAuth2-Refresh als zusätzliches Auth -> Minor, wenn kompatibel
```

## 3. Branch-Strategie

Einfach halten:

```text
main      immer releasefähig
topic/*   einzelne Features oder Bugfixes
```

Beispiele:

```text
topic/fix-nack-mailbox
topic/oauth2-refresh
topic/integration-tests
```

## 4. Pull-Request-Checkliste

Jeder PR sollte diese Punkte beantworten:

- Was ändert sich für Nutzer?
- Bleibt At-least-once erhalten?
- Gibt es ein Risiko für große Mailboxen?
- Werden Credentials geschützt?
- Wurden README/Hilfetexte/CHANGELOG angepasst?
- Sind Tests grün?

## 5. Issue Labels

Sinnvolle GitHub Labels:

```text
bug
feature
documentation
imap-provider
performance
diagnostics
oauth2
breaking-change
good-first-issue
needs-repro
```

## 6. Security

Ein `SECURITY.md` wäre sinnvoll, sobald das Paket öffentlich stärker genutzt wird.

Empfohlener Inhalt:

- Keine Secrets in Issues posten.
- Sicherheitsprobleme per privatem Kontakt melden.
- Unterstützte Versionen nennen, z. B. nur aktuelle Minor-Version.

## 7. Codex-Nutzung

Codex eignet sich besonders für:

- Tests ergänzen,
- kleine Bugfixes,
- README/Hilfetexte konsistent halten,
- Codebase-Exploration,
- Pull-Request-Vorbereitung.

Bei jeder Codex-Aufgabe sollten die Architekturregeln explizit genannt werden. Besonders wichtig:

```text
Keine unbounded IMAP-Operationen.
Keine Secrets loggen.
At-least-once bleibt wichtiger als genau-einmal.
```

## 8. Manuelle Tests, die CI nicht ersetzt

Vor relevanten Releases weiterhin manuell prüfen:

- Installation in Node-RED aus npm oder Tarball.
- Import des Beispiel-Flows.
- STRATO-Testpostfach mit Rückstand.
- ACK im Normalbetrieb.
- NACK move nach `NodeRED.failed`.
- Verhalten nach Node-RED-Neustart.

## 9. Empfohlener nächster Repository-Ausbau

1. `CONTRIBUTING.md` aus diesem Maintainer Pack ableiten.
2. `SECURITY.md` ergänzen.
3. GitHub Issue Templates aus `CHANGE_REQUEST_TEMPLATE_DE.md` ableiten.
4. Optional: englische Version des Maintainer-Briefings für öffentliche Contributor.
5. Optional: Integrationstest mit lokalem IMAP-Testserver evaluieren.
