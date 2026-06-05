# PRD / Evolution Plan: @compeso/node-red-contrib-imap-queue

Stand: 1.0.0

Dieses Dokument beschreibt die langfristige Produktpflege und Weiterentwicklung. Es ist kein PRD für die bereits fertige 1.0.0-Version, sondern eine Leitplanke für künftige Versionen.

## 1. Produktvision

`@compeso/node-red-contrib-imap-queue` soll die zuverlässigste einfache Lösung sein, um ein IMAP-Postfach in Node-RED als at-least-once Queue zu verwenden.

Der Fokus liegt auf:

- robustem Wiederanlauf nach Stillstand,
- kontrollierter Verarbeitung großer Rückstände,
- ACK nach erfolgreicher Downstream-Verarbeitung,
- bewusst akzeptierter Doppelverarbeitung,
- wenig Betriebsaufwand,
- verständlicher Diagnose.

## 2. Zielgruppen

### 2.1 Node-RED-Anwender

Anwender, die E-Mails aus einem dedizierten Postfach automatisiert verarbeiten wollen, z. B. Bestellungen, Tickets, Benachrichtigungen oder Systemmails.

Sie brauchen:

- einfach konfigurierbare Nodes,
- klare ACK/NACK-Semantik,
- keine eigene IMAP-Programmierung,
- nachvollziehbare Fehlerausgänge.

### 2.2 Betreiber / Admins

Sie brauchen:

- robuste Wiederanläufe,
- keine unkontrollierten Lastspitzen nach Ausfällen,
- sichere Behandlung von Credentials,
- verständliche Logs und Stats,
- einfache Installation über npm / Palette Manager.

### 2.3 Entwickler / Maintainer

Sie brauchen:

- klare Architekturregeln,
- Tests,
- CI,
- reproduzierbare Paketierung,
- saubere Semver-Regeln.

## 3. Non-goals

Version 1.x soll nicht versuchen, diese Probleme vollständig zu lösen:

- Exactly-once-Verarbeitung.
- Allgemeiner E-Mail-Client-Ersatz.
- Vollständige OAuth2-Provider-Abstraktion für alle Mailanbieter.
- Serverübergreifende verteilte Worker-Koordination.
- Persistente lokale Datenbank als Pflichtbestandteil.

## 4. Kernanforderungen, die dauerhaft gelten sollen

### P0: Queue-Semantik

- Mails bleiben bis zum erfolgreichen ACK in der Mailbox.
- Bei Fehlern bleiben Mails erneut zustellbar.
- Doppelte Zustellung ist zulässig.
- Kein stiller Mailverlust.

### P0: Skalierbarkeit bei Rückstand

- Kein unbounded `SEARCH UNDELETED` oder `FETCH 1:*` in großen Mailboxen.
- Front-window-Strategie beibehalten.
- Batch- und Inflight-Grenzen respektieren.

### P0: Sicherheit

- Keine Passwörter oder Tokens im Log.
- Keine Raw-Mail-Inhalte oder Attachments im Debug-Log.
- Credentials bleiben Node-RED-Credentials.

### P0: Abwärtskompatibilität

- Message-Shape und Node-Typen in 1.x stabil halten.
- Breaking Changes nur in Major Releases.

### P1: Diagnose

- Strukturierte Stats statt Log-Spam.
- Timings für Verbindungsaufbau, Fetch, Parse, Expunge und ACK.
- Fehlerausgänge für behandelbare Zustände.

### P1: Dokumentation

- README, Node-Hilfetexte und Beispiele bei jeder Nutzer-sichtbaren Änderung aktualisieren.
- Troubleshooting aus echten Issues laufend ergänzen.

## 5. Mögliche Roadmap

### 1.0.x: Stabilisierung

Ziele:

- Bugfixes aus echter Nutzung.
- Kleine Dokumentationsverbesserungen.
- Zusätzliche Tests für gemeldete Bugs.

Nicht tun:

- Keine großen API-Änderungen.
- Keine Änderung der Message-Shape.

### 1.1.x: Wartbarkeit

Mögliche Features:

- CONTRIBUTING.md.
- SECURITY.md.
- GitHub Issue Templates.
- Erweiterte Tests für Beispiele und Paketmetadaten.
- Optionaler lokaler IMAP-Testserver in CI.

### 1.2.x: Diagnose und Betrieb

Mögliche Features:

- Einheitlicheres Stats-Event-Schema.
- Optionale kumulative Zähler seit Node-Start.
- Bessere Troubleshooting-Hinweise im Editor.

### 1.3.x oder 2.0: OAuth2-Refresh

Mögliche Features:

- Provider-spezifische OAuth2-Konfiguration für Microsoft 365 und Gmail.
- Refresh Token als Credential.
- Automatische Access-Token-Erneuerung.

Risiken:

- Provider-spezifische Konfiguration ist komplex.
- Token-Lifecycle, Redirect-URLs und Admin-Consent können Supportaufwand erzeugen.
- Daher als separates Feature planen und nicht nebenbei einbauen.

## 6. Akzeptanzkriterien für neue Features

Ein Feature ist erst fertig, wenn:

- Runtime-Code implementiert ist.
- Unit-Tests oder mindestens Smoke-Tests ergänzt wurden.
- README aktualisiert wurde.
- Node-RED-Hilfetexte aktualisiert wurden.
- Beispiel-Flow angepasst wurde, falls relevant.
- CHANGELOG ergänzt wurde.
- `npm test` grün ist.
- `npm pack --dry-run` plausibel ist.
- Keine Secrets geloggt werden.
- Keine unbounded IMAP-Operation eingeführt wurde.

## 7. Bugfix-Prozess

Bei jedem Bug:

1. Fehlerbeschreibung sichern.
2. Prüfen, ob ein Test reproduzieren kann.
3. Minimalen Fix implementieren.
4. Test ergänzen.
5. README/Troubleshooting ergänzen, wenn Nutzer davon profitieren.
6. Patch-Version erhöhen.
7. Release Notes schreiben.

## 8. Entscheidungsvorlage für Breaking Changes

Ein Breaking Change ist nur gerechtfertigt, wenn:

- die aktuelle API ein reales Problem verursacht,
- ein Kompatibilitätslayer unverhältnismäßig wäre,
- die Migration klar dokumentierbar ist,
- der Nutzen für Nutzer deutlich höher ist als der Migrationsaufwand.

Breaking Changes benötigen:

- Major-Version,
- Migrationsabschnitt im README,
- CHANGELOG-Eintrag,
- aktualisierten Beispiel-Flow,
- klare Warnung im GitHub Release.
