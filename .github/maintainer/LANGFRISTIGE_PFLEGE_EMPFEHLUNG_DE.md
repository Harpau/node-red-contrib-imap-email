# Empfehlung fuer die langfristige Pflege

## 1. Repository als Quelle der Wahrheit

Das GitHub-Repository `Harpau/node-red-contrib-imap-email` ist die Quelle der
Wahrheit. Tarballs und ZIPs sind nur Artefakte fuer Tests, Releases oder
Uebergaben.

Empfohlener Arbeitsfluss:

```text
Issue -> Branch -> Aenderung -> Tests -> Pull Request -> CI -> Merge -> Tag -> Release
```

Ein `npm publish` erfolgt nie automatisch und nur nach ausdruecklicher
menschlicher Freigabe.

## 2. Branch-Strategie

Einfach halten:

```text
main      immer gruener, releasefaehiger Stand
codex/*   Codex-Arbeitszweige
topic/*   manuelle Features oder Bugfixes
```

## 3. Semver-Leitlinie

Vor `1.0.0`:

```text
0.1.x  Haertung, Bugfixes, Dokumentation
0.2.x  kompatible Verbesserungen vor erster stabiler Version
1.0.0  erste oeffentliche stabile Version nach Node-RED-Test
```

Nach `1.0.0`:

```text
Patch  Bugfixes ohne API- oder Flow-Vertragsaenderung
Minor  kompatible neue Features
Major  Breaking Changes
```

## 4. Pull-Request-Pruefung

Jeder PR sollte beantworten:

- Was aendert sich fuer Nutzer?
- Bleibt At-least-once erhalten?
- Gibt es ein Risiko fuer grosse Postfaecher?
- Werden Credentials und Mail-Inhalte geschuetzt?
- Bleibt Node.js 18 installierbar?
- Sind README, Hilfetexte, Beispiele oder CHANGELOG betroffen?
- Sind `npm test` und `npm run pack:check` gruen?

## 5. Sinnvolle Labels

```text
bug
feature
documentation
imap-provider
performance
diagnostics
security
breaking-change
good-first-issue
needs-repro
```

## 6. Security

Ein `SECURITY.md` ist sinnvoll, sobald das Paket oeffentlich genutzt wird.
Bis dahin sollten Issues und Templates klar sagen:

- keine Passwoerter, Tokens oder privaten Hostnamen posten
- Flow-Ausschnitte nur ohne Credentials teilen
- Raw-Mails und Attachments nur anonymisiert beschreiben

## 7. CI

Der Standard-Workflow prueft:

- Node.js 18, 20, 22 und 24
- `npm install --no-audit --no-fund`
- `npm test`
- `npm run pack:check`

CI darf keine Veroeffentlichungsschritte enthalten.

## 8. Manuelle Tests, die CI nicht ersetzt

Vor relevanten Releases weiterhin manuell pruefen:

- Installation in lokalem Node-RED
- Import des deaktivierten Beispiel-Flows
- Verbindung mit dediziertem Testpostfach
- `imap-email in` mit bounded Front-Window
- ACK `flag`, `copy`, `move` und `delete` gegen passende Server-Capabilities
- Verhalten nach Node-RED-Neustart

## 9. Codex-Nutzung

Bei jeder Codex-Aufgabe die wichtigsten Regeln wiederholen:

```text
Keine unbounded IMAP-Operationen.
Keine Secrets loggen.
At-least-once bleibt erhalten.
ACK-Erfolg nur nach bestaetigter IMAP-Aktion.
Node.js 18 bleibt unterstuetzt.
```

Grosse Aenderungen in kleine, reviewbare Commits schneiden.
