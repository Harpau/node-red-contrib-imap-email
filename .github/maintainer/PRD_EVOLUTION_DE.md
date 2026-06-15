# PRD / Evolution Plan: @compeso/node-red-contrib-imap-email

Stand: Entwicklungsfassung 0.1.0

Dieses Dokument beschreibt die Produktpflege und Weiterentwicklung des
eigenstaendigen Pakets `@compeso/node-red-contrib-imap-email`.

## 1. Produktvision

Das Paket soll eine robuste, gut dokumentierte Node-RED-Erweiterung fuer
IMAP-basierte E-Mail-Verarbeitung sein:

- extern getriggerter Abruf statt verstecktem Polling
- bounded Verarbeitung grosser Postfaecher
- klare At-least-once-Zustellung
- ACK-Aktionen fuer delete, move, copy und flag
- nachvollziehbare Diagnostics ohne sensible Inhalte

## 2. Zielgruppen

### Node-RED-Anwender

Sie wollen E-Mails aus IMAP-Postfaechern in Flows verarbeiten, ohne eigene
IMAP-Logik schreiben zu muessen.

### Betreiber

Sie brauchen berechenbare Last, klare Fehlerausgaenge, keine Secrets im Log
und robuste Wiederanlaeufe.

### Maintainer

Sie brauchen klare Architekturregeln, Tests, CI und reproduzierbare
Paketierung.

## 3. Non-goals

- Exactly-once-Verarbeitung.
- Allgemeiner E-Mail-Client-Ersatz.
- Ein weiterer oeffentlicher Node-RED-Typ ausser account, in und ack.
- Pflicht-Datenbank oder persistenter lokaler Zustandsstore.
- Automatisches npm Publishing aus CI.
- Provider-spezifische OAuth2-Abstraktion ohne separates Design.

## 4. Dauerhafte Anforderungen

### P0: Skalierbarkeit

- Kein unbounded `SEARCH` ueber das gesamte Postfach.
- Kein unbounded `FETCH 1:*` fuer grosse Mailboxen.
- Bounded front-window Strategie beibehalten.
- `batchSize`, `frontWindowSize`, `maxInflight` und `maxUidPerCommand`
  respektieren.

### P0: Zustellsemantik

- At-least-once ist bewusstes Ziel.
- Nicht geACKte Nachrichten bleiben erneut zustellbar.
- Inflight ist volatil und nicht die Quelle der Wahrheit.
- ACK-Erfolg nur nach bestaetigter IMAP-Aktion.

### P0: Sicherheit

- Keine Credentials, Tokens, Raw-Mails oder Attachments im Log.
- Unsichere Delete-/Move-Fallbacks ablehnen.
- Beispiele duerfen keine privaten Endpunkte oder Zugangsdaten enthalten.

### P1: Nutzerfuehrung

- README und Node-RED-Hilfe erklaeren Delivery-Semantik und Grenzen.
- Beispiel-Flow bleibt deaktiviert und nicht destruktiv.
- Fehlerausgaenge sind maschinenlesbar und enthalten genug IMAP-Metadaten.

### P1: Wartbarkeit

- Tests decken Runtime, Action-Planung, Paketmetadaten, Beispiele und
  Fehlerpfade ab.
- CI prueft Node.js 18 und aktuelle Node-Versionen.
- Dokumentation wird bei jeder nutzer-sichtbaren Aenderung aktualisiert.

## 5. Moegliche Roadmap

### 0.1.x: Haertung vor oeffentlicher Nutzung

- echte Node-RED-Installation lokal testen
- weitere Provider-Szenarien sammeln
- README und Hilfe finalisieren
- Release-Checkliste weiter schaerfen

### 0.2.x: Betrieb und Diagnose

- Troubleshooting aus echten Issues aufnehmen
- Stats-Felder auf Stabilitaet pruefen
- optional lokale IMAP-Testserver-Evaluation fuer CI

### 0.3.x: Komfortfunktionen

- zusaetzliche sichere ACK-Varianten nur mit klarer IMAP-Bestaetigung
- bessere Flow-Beispiele fuer typische Verarbeitungspfade
- optionale Dokumentation fuer Provider-Besonderheiten

### 1.0.0: Oeffentliche stabile Version

- Node-RED-Test bestanden
- Installationsweg aus npm/Tarball validiert
- Semver- und Release-Prozess dokumentiert
- keine bekannten P1-Sicherheits- oder Datenverlust-Risiken offen

## 6. Feature-Akzeptanzkriterien

Ein Feature ist erst fertig, wenn:

- Runtime-Code implementiert ist.
- Fehlerpfade betrachtet wurden.
- Tests ergaenzt oder bewusst als nicht noetig begruendet wurden.
- README/Hilfe/Beispiel-Flow aktualisiert sind, falls nutzer-sichtbar.
- `npm test` gruen ist.
- `npm run pack:check` plausibel ist.
- keine neuen unbounded IMAP-Operationen eingefuehrt wurden.
- Node.js 18-Kompatibilitaet erhalten bleibt oder eine Major-Entscheidung
  dokumentiert ist.

## 7. Breaking-Change-Entscheidung

Breaking Changes benoetigen:

- klare Problembeschreibung
- Migrationshinweise
- CHANGELOG-Eintrag
- Major-Version
- aktualisierte Beispiele und Hilfetexte
- bewusste Freigabe vor Release
