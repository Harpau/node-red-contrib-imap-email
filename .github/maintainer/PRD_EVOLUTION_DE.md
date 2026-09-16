# PRD / Evolution Plan: @compeso/node-red-contrib-imap-email

Stand 16.09.2026: Release `1.1.0` ist abgeschlossen. PR #5 ist gemergt,
GitHub-Release und Tag sind oeffentlich, npm `latest` und Node-RED-Katalog
zeigen `1.1.0`; die Registryinstallation ist geprueft. Commit, Artefakt,
CI und Abnahmen sind im zentralen [Release-Nachweis](RELEASE_1_1_0_DE.md)
dokumentiert. Die damalige Freigabe gilt nur fuer diesen Release.

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
- Die Startpruefung zeigt Verbindungs-/Anmeldeprobleme ohne
  Trigger an. Ihre Statusereignisse koennen von Status-Nodes beobachtet werden.
- `connected` bedeutet letzter erfolgreicher Check einer authentifizierten
  Sitzung, keine dauerhaft offene Verbindung und keine bestaetigten Mailboxrechte.

### P1: Wartbarkeit

- Tests decken Runtime, Action-Planung, Paketmetadaten, Beispiele und
  Fehlerpfade ab.
- CI prueft Node.js 22 und aktuelle Node.js-Versionen.
- Dokumentation wird bei jeder nutzer-sichtbaren Aenderung aktualisiert.

## 5. Veroeffentlichte Entwicklung und spaetere Ideen

### Historische Entwicklung

- `0.1.0`: erste Entwicklung der drei Nodes, begrenzter Abruf und ACK-Vertrag.
- `0.2.0`: dokumentierte Pre-1.0-Umstellung auf Node.js `>=22.0.0` und Node-RED
  `>=4.0.0`; Node.js 18/20 und Node-RED 3 aus der Support-Matrix entfernt.
- `1.0.0`: erste stabile oeffentliche Version.
- `1.0.1`: Input-Close-Abbruch und Stream-Bereinigung, Netzwerk-Palettengruppe
  und aktualisierte Laufzeitabhaengigkeiten. Details stehen im CHANGELOG.

### Release 1.1.0

- Automatische kurzlebige Verbindungspruefung beim Start aktiver Input-/ACK-Nodes.
- Gemeinsame laufende Probe pro Account-Instanz, 30 Sekunden Gesamtfrist,
  Abbruch beim letzten Verbraucher-Close und Schutz vor spaeten Ergebnissen.
- Fehlerstatus ohne sensible Inhalte; regulaere Verarbeitung bleibt unabhaengig
  und deren Status hat Vorrang. PREAUTH-Grenze und fehlende Mailbox-/ACK-Rechtepruefung
  sind dokumentiert.
- Aktualisierte Laufzeitabhaengigkeiten und CI bei unveraenderten oeffentlichen
  Flow-Vertraegen und Mindestversionen.
- Gepruefte echte Bibliotheksvertraege und Node-RED-Deploy-Matrix mit lokalem
  synthetischem IMAP.
- DELETE fuer ACK und Input-Bereinigung ist mit bestaetigtem STORE,
  Delete-Ergebnis und begrenztem UID-SEARCH abgesichert; echte OK-Abschluesse
  werden ueber das oeffentliche response-Event geprueft. Partielle
  Serveraenderungen werden nicht zurueckgerollt.

Diese Aenderungen wurden am 16.09.2026 als `1.1.0` veroeffentlicht und sind in
`1.0.1` nicht enthalten. Der [Release-Nachweis](RELEASE_1_1_0_DE.md) unterscheidet
Provider-Kandidat, finales Release-Artefakt und deren jeweilige Pruefungen.
Historische Protokolle werden nicht nachtraeglich auf neue Staende umgedeutet.

### Spaetere Ideen ohne Versionszusage

- zusaetzliche sichere ACK-Varianten nur mit klarer IMAP-Bestaetigung
- bessere Flow-Beispiele fuer typische Verarbeitungspfade
- optionale Dokumentation fuer Provider-Besonderheiten

## 6. Feature-Akzeptanzkriterien

Ein Feature ist erst fertig, wenn:

- Runtime-Code implementiert ist.
- Fehlerpfade betrachtet wurden.
- Tests ergaenzt oder bewusst als nicht noetig begruendet wurden.
- README/Hilfe/Beispiel-Flow aktualisiert sind, falls nutzer-sichtbar.
- `npm test` gruen ist.
- `npm audit --omit=dev` keine Produktions-Befunde meldet.
- `npm run pack:check` plausibel ist.
- keine neuen unbounded IMAP-Operationen eingefuehrt wurden.
- Node.js `>=22.0.0` und Node-RED `>=4.0.0` unterstuetzt bleiben oder eine
  Breaking-Change-Entscheidung dokumentiert ist.

Fuer die Startpruefung sind zusaetzlich die tatsaechlichen Bibliotheksvertraege
und die Node-RED-Deploy-/Credential-/Subflow-Matrix aus
[RELEASE_DE.md](../../docs/RELEASE_DE.md) Pflicht. Reine Runtime-Stubs reichen
dafuer nicht. Node.js 22.0.0 wird mit `--engine-strict` fuer Lockfile und
frische Verbraucherinstallation nachgewiesen.

Release-Bereitschaft setzt einen dokumentierten externen Provider-Test und
aktuelle GitHub-CI-Ergebnisse auf dem finalen Stand voraus. Push und Release
benoetigen ihre eigene Freigabe; historische Tests ersetzen diese Nachweise nicht.

## 7. Breaking-Change-Entscheidung

Breaking Changes benoetigen:

- klare Problembeschreibung
- Migrationshinweise
- CHANGELOG-Eintrag
- Major-Version nach `1.0.0`; vor `1.0.0` eine explizit dokumentierte
  Kompatibilitaetslinie wie `0.2.0`
- aktualisierte Beispiele und Hilfetexte
- bewusste Freigabe vor Release
