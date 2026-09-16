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

Historische Entwicklung bis `1.0.0`:

```text
0.1.x  Haertung, Bugfixes, Dokumentation
0.2.x  Pre-1.0-Kompatibilitaetsumstellung auf Node.js >=22 und Node-RED >=4
1.0.0  erste oeffentliche stabile Version nach Node-RED-Test
```

Fuer die stabile Linie ab `1.0.0`:

```text
Patch  Bugfixes ohne API- oder Flow-Vertragsaenderung
Minor  kompatible neue Features
Major  Breaking Changes
```

Stand 16.09.2026: Release `1.1.0` mit Startpruefung, DELETE-Absicherung und
aktualisierten Laufzeitabhaengigkeiten ist abgeschlossen. PR #5 ist gemergt,
Tag und GitHub-Release sind oeffentlich; npm `latest` und Node-RED-Katalog
zeigen `1.1.0`. Die Registryinstallation ist geprueft. Alle Zuordnungen und
Nachweise stehen zentral im [Release-Nachweis](RELEASE_1_1_0_DE.md).
Die damaligen Freigaben gelten nicht fuer spaetere Veroeffentlichungen.

## 4. Pull-Request-Pruefung

Jeder PR sollte beantworten:

- Was aendert sich fuer Nutzer?
- Bleibt At-least-once erhalten?
- Gibt es ein Risiko fuer grosse Postfaecher?
- Werden Credentials und Mail-Inhalte geschuetzt?
- Bleiben Node.js >=22.0.0 und Node-RED >=4.0.0 installierbar?
- Sind README, Hilfetexte, Beispiele oder CHANGELOG betroffen?
- Sind Tests, Produktions-Audit und Paketpruefung erfolgreich?
- Sind echte Bibliotheksvertraege und relevante Node-RED-Lifecycle-Faelle geprueft?

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

Das Paket ist oeffentlich. Ein eigener `SECURITY.md` kann den Meldeweg fuer
Schwachstellen ergaenzen. Issues und Templates sollen weiterhin klar sagen:

- keine Passwoerter, Tokens oder privaten Hostnamen posten
- Flow-Ausschnitte nur ohne Credentials teilen
- Raw-Mails und Attachments nur anonymisiert beschreiben

## 7. CI

Der Standard-Workflow prueft:

- Node.js 22.0.0, aktuelles 22.x und 24.x
- `npm ci --engine-strict --no-audit --no-fund`
- `npm audit --omit=dev`
- `npm test`
- `npm run pack:check`
- isolierte Node-RED-Integration auf 4.x aus einem frisch gepackten Tarball

CI darf keine Veroeffentlichungsschritte enthalten. Aktuelle GitHub-Laeufe
werden erst nach freigegebenem Push als Nachweis verwendet; alte PR-Laeufe
und lokale Ausfuehrung der Kommandos werden getrennt ausgewiesen.

## 8. Praxistests und Release-Nachweise

Vor technischem Abschluss der Startpruefung ist die isolierte echte
Node-RED-Deploy-Matrix mit lokalem synthetischem IMAP verpflichtend:
Full-/Partial-Deploy, Credential-only-Aenderungen, deaktivierte Flows,
geteilte Accounts, Subflows, Statusprioritaet und Redeploy-Abbruch.

Vor dem Release zusaetzlich in der vorgesehenen Zielinstallation mit einem
dedizierten externen Testpostfach pruefen:

- Installation in lokalem Node-RED
- Import des deaktivierten Beispiel-Flows
- Verbindung mit dediziertem Testpostfach
- `imap-email in` mit bounded Front-Window
- ACK `flag`, `copy`, `move` und `delete` gegen passende Server-Capabilities
- Verhalten nach Node-RED-Neustart

Tarball-Pruefsumme, Git-/Paketstand, Runtime-Versionen, Datum und Ergebnisse
ohne Secrets festhalten. Historische Provider-Tests gelten nicht fuer neue
Aenderungen. Der verbindliche Ablauf inklusive Versionswahl, Freigabe, npm
und Refresh des bestehenden Node-RED-Eintrags steht in
[RELEASE_DE.md](../../docs/RELEASE_DE.md).

## 9. Codex-Nutzung

Bei jeder Codex-Aufgabe die wichtigsten Regeln wiederholen:

```text
Keine unbounded IMAP-Operationen.
Keine Secrets loggen.
At-least-once bleibt erhalten.
ACK-Erfolg nur nach bestaetigter IMAP-Aktion.
Node.js >=22.0.0 und Node-RED >=4.0.0 bleiben unterstuetzt.
```

Grosse Aenderungen in kleine, reviewbare Commits schneiden.

Nach jedem Release den Einstieg fuer den naechsten Chat aktualisieren:
aktueller Repository-Stand, veroeffentlichtes Artefakt und noch offene Arbeit
getrennt benennen und den zentralen Release-Nachweis verlinken. Historische
Pruefprotokolle behalten Datum, Artefaktbezug und urspruenglichen Pruefumfang.
