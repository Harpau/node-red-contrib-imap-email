# AGENTS.md

## Projektziel

Dieses Repository ist ein eigenständiges Node-RED npm-Paket.

## Paket

- GitHub-Repository: Harpau/node-red-contrib-imap-email
- npm-Paketname: @compeso/node-red-contrib-imap-email
- Internes Node-RED-Typpräfix: imap-email
- Sichtbare Node-Namen:
  - imap email account
  - imap email in
  - imap email ack

## Zielarchitektur

Das neue Paket stellt flexible IMAP-Nodes für Node-RED bereit.

Die Verarbeitung muss für sehr große Postfächer geeignet sein. Der Eingangsnode darf nicht unbeschränkt das gesamte Postfach durchsuchen. Eine bounded-front-window-Logik oder eine gleichwertig sichere, begrenzte Strategie ist verbindlich.

## Ziel-Nodes für die öffentliche Version

### imap-email account

Interner Node-RED-Typ:
- imap-email account

Sichtbarer Name:
- imap email account

Zweck:
- gemeinsame IMAP-Kontokonfiguration
- Host, Port, TLS, Zertifikatsprüfung, Benutzername, Passwort
- optionale spätere OAuth2-Erweiterung

### imap-email in

Interner Node-RED-Typ:
- imap-email in

Sichtbarer Name:
- imap email in

Zweck:
- extern getriggerter IMAP-Eingangsnode
- bounded front-window fetch
- portionsweise Ausgabe von E-Mails
- geeignet für große Postfächer
- Ausgabe von msg.imap.ackToken zur späteren Verarbeitung mit imap-email ack

Selektionsoptionen:
- Deleted: ignore / only deleted / not deleted
- Seen: ignore / only seen / not seen
- Answered: ignore / only answered / not answered
- Flagged: ignore / only flagged / not flagged

Konfigurationskonzepte:
- Batch size
- Front window
- Max inflight
- Retry after ms
- UIDs/command
- Attachments optional
- Raw source optional
- Diagnostics off/stats/debug

### imap-email ack

Interner Node-RED-Typ:
- imap-email ack

Sichtbarer Name:
- imap email ack

Zweck:
- einheitlicher Abschlussnode für erfolgreich oder fehlerhaft verarbeitete Mails
- mehrere unterschiedlich konfigurierte imap email ack Nodes sollen in einem Flow parallel einsetzbar sein

Mögliche Aktionen:
- Mail löschen
- Mail in Zielordner verschieben
- Mail behalten
- Flags setzen
- Flags entfernen
- Mail für spätere erneute Ausgabe vorbereiten

Konfigurierbare Flags:
- \Seen
- \Answered
- \Flagged
- \Deleted

## Nicht-Ziele

- Keine Registrierung anderer öffentlicher Node-RED-Typen als imap-email account, imap-email in und imap-email ack.
- Keine Veröffentlichung unter einem anderen Paketnamen als @compeso/node-red-contrib-imap-email.
- Keine öffentliche Veröffentlichung, solange Dokumentation, Tests und Beispiele nicht konsistent sind.
- Keine unbeschränkte Suche über sehr große Postfächer.
- Keine Speicherung von Zugangsdaten, Tokens oder privaten Endpunkten in Tests, Beispielen oder Dokumentation.

## Versions- und Kompatibilitätsregeln

- Node.js-Mindestversion: >=22.0.0
- Node-RED-Mindestversion: >=4.0.0
- Neue Laufzeit- oder Node-RED-Anforderungen nur nach Begründung einführen.
- Die Entwicklungsfassung begann mit Version 0.1.0.
- Version 0.2.0 dokumentiert die Pre-1.0-Kompatibilitätsumstellung auf Node.js >=22.0.0 und Node-RED >=4.0.0.
- Eine öffentliche Version 1.0.0 erst nach erfolgreichem lokalen Node-RED-Test und Dokumentationsprüfung vorbereiten.

## package.json-Regeln

- package.json name muss lauten: @compeso/node-red-contrib-imap-email
- repository, homepage und bugs müssen auf Harpau/node-red-contrib-imap-email zeigen, sofern nicht ausdrücklich anders vorgegeben.
- package.json muss eine gültige "node-red"-Sektion enthalten.
- Alle Einträge in "node-red.nodes" müssen auf existierende JavaScript-Dateien zeigen.
- Alle Node-RED-Typen in package.json, JavaScript und HTML müssen konsistent sein.
- publishConfig.access darf public bleiben.
- Kein npm publish ohne ausdrückliche menschliche Freigabe.

## Node-RED-Regeln

- RED.nodes.registerType(...) darf nur die öffentlichen Typen dieses Pakets verwenden.
- HTML-Dateien müssen dieselben Typnamen verwenden wie die passenden JavaScript-Dateien.
- data-template-name, data-help-name und RED.nodes.registerType(...) müssen konsistent sein.
- Palette-Labels dürfen benutzerfreundlich imap email account, imap email in und imap email ack heißen.
- Interne Typen sollen imap-email account, imap-email in und imap-email ack heißen.
- Beispiel-Flows gehören in examples.
- README.md muss Installation, Konfiguration, Beispiel-Flows, Delivery-Semantik, große Postfächer und Grenzen dokumentieren.

## Testregeln

Vor jedem größeren Abschluss ausführen:

- npm install
- npm test
- npm run pack:check

Wenn npm run pack:check nicht verfügbar ist:

- npm pack --dry-run

Tests müssen insbesondere abdecken:

- package.json-Metadaten
- Node-RED-Registry
- Laden aller Node-Dateien
- Konsistenz zwischen package.json, JS und HTML
- Beispiele im examples-Ordner
- bounded front-window Verhalten
- UID-Range-/Chunking-Logik
- Selektionslogik für Deleted, Seen, Answered und Flagged
- Ack-Aktionsplanung
- Batch-/Flush-Verhalten von imap email ack
- Fehlerpfade ohne echte IMAP-Zugangsdaten

## Arbeitsweise für Codex

- Zuerst analysieren.
- Dann planen.
- Erst danach ändern.
- Große Aufgaben in kleine, reviewbare Änderungen aufteilen.
- Vor riskanten Änderungen erklären, welche Dateien betroffen sind.
- Nach Änderungen immer liefern:
  - geänderte Dateien
  - technische Wirkung
  - Testergebnis
  - offene Risiken
  - empfohlener nächster Commit
- Keine neuen produktiven Abhängigkeiten hinzufügen, ohne vorher den Grund zu erklären.
- Keine Veröffentlichung auf npm oder flows.nodered.org durchführen.
