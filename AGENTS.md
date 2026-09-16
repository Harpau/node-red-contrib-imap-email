# AGENTS.md

## Projektziel

Dieses Repository ist ein eigenständiges Node-RED npm-Paket.

## Aktueller Stand und Einstieg für neue Chats

Stand 16.09.2026: Version `1.1.0` ist auf npm als `latest` veröffentlicht,
GitHub-Release und Node-RED-Katalog sind aktualisiert. Der Release ist abgeschlossen.
Das vorübergehende npm-README-Anzeigeproblem hat sich laut Nutzer erledigt.

Vor neuen Änderungen lesen:

- [Release-Nachweis 1.1.0](.github/maintainer/RELEASE_1_1_0_DE.md): verbindliche
  Zuordnung von Commit, Tag, CI, Tarball, Veröffentlichung und lokaler Testinstallation.
- [Maintainer-Briefing](.github/maintainer/MAINTAINER_BRIEFING_DE.md): Architektur
  und unveränderliche Anforderungen.
- [Startprompt](.github/maintainer/CODEX_START_PROMPT_DE.md): Einstieg und Prüfablauf.

Historische RC-/Provider-Protokolle beschreiben ihren damaligen Prüfstand.
Dort noch offene Schritte nicht als heute offene Release-Aufgaben behandeln.
Aktuellen Git-Arbeitsbaum und installierte Paketdateien prüfen; gleiche
Versionsnummern allein belegen keinen identischen Artefaktstand.

## Paket

- GitHub-Repository: Harpau/node-red-contrib-imap-email
- npm-Paketname: @compeso/node-red-contrib-imap-email
- Internes Node-RED-Typpräfix: imap-email
- Sichtbare Node-Namen:
  - imap email account
  - imap email in
  - imap email ack

## Zielarchitektur

Das Paket stellt flexible IMAP-Nodes für Node-RED bereit.

Die Verarbeitung muss für sehr große Postfächer geeignet sein. Der Eingangsnode darf nicht unbeschränkt das gesamte Postfach durchsuchen. Eine bounded-front-window-Logik oder eine gleichwertig sichere, begrenzte Strategie ist verbindlich.

## Öffentliche Nodes

### imap-email account

Interner Node-RED-Typ:
- imap-email account

Sichtbarer Name:
- imap email account

Zweck:
- gemeinsame IMAP-Kontokonfiguration
- Host, Port, TLS, Zertifikatsprüfung, Benutzername, Passwort
- optionaler statischer OAuth2-Access-Token; automatische Beschaffung und Erneuerung sind nicht implementiert
- gemeinsame kurzlebige Startprüfung für aktive Input-/ACK-Nodes; höchstens 30 Sekunden, keine dauerhafte Verbindung und keine Mailbox-/ACK-Rechteprüfung

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

Öffentliche Aktionen:
- `delete`: Mail löschen, nur mit `UIDPLUS` und bestätigter begrenzter Entfernung
- `move`: Mail in Zielordner verschieben, nur mit nativer `MOVE`-Capability
- `copy`: Mail kopieren und konfigurierte Flags danach auf der Quelle ändern
- `flag`: Mail behalten und Flags setzen oder entfernen
- Modus `set by msg.imap.ackAction`: eine der genannten Aktionen aus der Nachricht wählen

Erfolgreiche Aktionen schließen die Inflight-Verarbeitung ab. Fehlgeschlagene
Aktionen behalten Inflight für einen Retry; partielle Serveränderungen werden
nicht zurückgerollt. Es gibt keinen eigenen öffentlichen `keep`- oder `retry`-
Befehl; erneute Ausgabe hängt von Inflight-Frist, Mailbox und Auswahlfiltern ab.

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
- Versionen 1.0.0, 1.0.1 und 1.1.0 sind veröffentlicht. Für künftige Releases gelten die aktuellen Prüfungen in docs/RELEASE_DE.md; historische Nachweise ersetzen keine neue Abnahme geänderter Laufzeit.

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
- Startprüfung einschließlich geteilter Probe, Timeout, Close/Redeploy und Statuspriorität
- bestätigte begrenzte Löschung für ACK und Input-Fensterbereinigung; keine mailboxweite Suche und kein Erfolg bei unbestätigter Entfernung

Bei Änderungen an Startprüfung, IMAP-Bibliotheksverträgen oder Lifecycle zusätzlich
die isolierte Node-RED-Integration mit frisch gepacktem Modul ausführen:
`NODE_RED_TEST_DIR=/path/to/isolated-install npm run test:integration`.
Einrichtung und vollständige Abnahmematrix stehen in `docs/RELEASE_DE.md`.

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
- Keine Veröffentlichung auf npm oder flows.nodered.org ohne ausdrückliche menschliche Freigabe für den konkreten Release durchführen. Die Freigaben für den abgeschlossenen Release 1.1.0 erlauben keine weiteren Veröffentlichungen.
