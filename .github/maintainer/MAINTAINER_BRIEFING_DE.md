# Maintainer-Briefing: @compeso/node-red-contrib-imap-email

Stand: veroeffentlichte stabile Version `1.0.1`; **unveroeffentlichter
Release-Kandidat `1.1.0`** mit dieser Version in Paket und Lockfile. Die
Kandidatenvorbereitung erfolgte vor dem externen Provider-Test. Lokale
Pruefergebnisse stehen im [RC-Pruefprotokoll](VALIDATION_1_1_0_RC_DE.md).
Die ergaenzende [Provider-Abnahme](VALIDATION_PROVIDER_1_1_0_DE.md) desselben
unveraenderten Kandidaten war am 16.09.2026 erfolgreich. Push-Freigabe,
aktuelle GitHub-CI-Laeufe und Veroeffentlichungsfreigabe sind offen.

Dieses Dokument ist ein kompaktes Briefing fuer spaetere Wartung, Bugfixes
und Erweiterungen des Pakets `@compeso/node-red-contrib-imap-email`.

## 1. Projektziel

Das Repository ist ein eigenstaendiges Node-RED npm-Paket fuer flexible
IMAP-E-Mail-Verarbeitung. Es liest Nachrichten extern getriggert aus einem
Postfach, gibt sie portionsweise aus und schliesst erfolgreiche Verarbeitung
ueber einen separaten ACK-Node ab.

Zielverhalten:

```text
externer Trigger
  -> imap-email in
      -> erfolgreiche Verarbeitung
          -> imap-email ack
```

Eine Nachricht darf mehrfach geliefert werden, aber nicht still verloren
gehen. ACK-Aktionen muessen fail-closed sein.

## 2. Paketdaten

```text
npm-Paket:      @compeso/node-red-contrib-imap-email
Repository:     Harpau/node-red-contrib-imap-email
Node.js:        >=22.0.0
Node-RED:       >=4.0.0
Lizenz:         MIT
Startversion:   0.1.0
Stabil:        1.0.1
Kandidat:      1.1.0, unveroeffentlicht
```

Keine Veroeffentlichung auf npm oder flows.nodered.org ohne ausdrueckliche
menschliche Freigabe.

## 3. Oeffentliche Node-RED-Typen

Nur diese Typen duerfen oeffentlich registriert werden:

```text
imap-email account
imap-email in
imap-email ack
```

Palette-Labels:

```text
imap email account
imap email in
imap email ack
```

Typnamen muessen zwischen `package.json`, JavaScript, HTML, Beispielen, README
und Tests konsistent bleiben.

## 4. Architektur

### 4.1 `imap-email account`

Config-Node fuer IMAP-Zugangsdaten und Verbindungseinstellungen:

- Host, Port, TLS
- Zertifikatspruefung
- Benutzername und Passwort als Node-RED-Credentials
- IMAP-Timeouts

Die unveroeffentlichte Startpruefung verwaltet pro Account-Instanz hoechstens
eine laufende kurzlebige Probe. Aktive Input-/ACK-Nodes fordern sie nach ihrer
Initialisierung an; unbenutzte Accounts verbinden sich nicht. Es gibt keinen
dauerhaften Erfolgs-Cache. Gleiche Account-Instanzen teilen eine laufende Probe,
ein spaeterer neuer Verbraucher startet eine frische Probe.

Die gesamte Probe ist auf 30 Sekunden begrenzt; kuerzere Account-Zeitlimits
bleiben gueltig. Ein Check selektiert keine Mailbox und aendert keine Mail.
Erfolg bestaetigt eine akzeptierte authentifizierte Sitzung; PREAUTH kann diese
ohne erneute Secret-Pruefung bereitstellen. `connected` ist der letzte
Prueferfolg und keine dauerhafte Verbindung. Regulaere Verarbeitung bleibt
unabhaengig, deren Status und ACK-Konfigurationsfehler haben Vorrang.

Startauftraege und Verbraucher sind beim Close abzumelden; die letzte Abmeldung
beendet die Probe. Alte Ergebnisse duerfen keine neue Generation beeinflussen.
Keine Probe-Output-/Stats-Nachrichten; ein Status-Node darf Statusereignisse
beobachten. Hoechstens eine sichere Warnung pro Fehlprobe, keine bei Redeploy-Abbruch.

Regel: keine Credentials oder privaten Endpunkte in Logs, Tests, Beispielen
oder Dokumentation.

### 4.2 `imap-email in`

Extern getriggerter Eingangsnode mit drei Ausgaengen:

```text
Output 1: geparste E-Mail
Output 2: Fehler / behandelbare Zustellprobleme
Output 3: Stats, wenn Diagnostics stats/debug aktiv ist
```

Wichtige Eigenschaften:

- kein internes Polling
- bounded cursor-window Strategie fuer grosse Mailboxen
- keine mailboxweite unbounded Suche
- volatile Inflight-Verfolgung
- `msg.imap.ackToken` fuer den Abschluss ueber `imap-email ack`
- optionale Attachments und Raw-Ausgabe
- Flag-Selektion fuer Deleted, Seen, Answered und Flagged

Die New-UID-Prioritaetsphase liest neue UIDs vor dem Backlog. Das logische
New-UID-Fenster bleibt durch `frontWindowSize` begrenzt; einzelne
UID-Kommandos werden durch `maxUidPerCommand` begrenzt.

### 4.3 `imap-email ack`

ACK-Node fuer erfolgreiche oder bewusst abgeschlossene Verarbeitung. Er
unterstuetzt:

- `delete`
- `move`
- `copy`
- `flag`
- message-driven Action-Plans ueber `msg.imap.ackAction`

Sicherheitsregeln:

- `delete` nur mit `UIDPLUS`, bestaetigtem STORE und Delete-Ergebnis sowie
  anschliessendem erfolgreichem UID-begrenztem SEARCH desselben Chunks ohne
  Rest-UIDs; fehlgeschlagenes SEARCH ist kein leerer Erfolg
- `move` nur mit nativer `MOVE`-Capability
- `copy` kopiert zuerst und aendert danach konfigurierte Flags nur auf der Quelle
- `false` oder `undefined` aus ImapFlow-Aktionen gilt als Fehler
- Partial-Fehler duerfen nicht als Erfolg bestaetigt werden

Scheitert die Quellflag-Aenderung nach erfolgreichem COPY, bleibt Inflight fuer
einen Retry erhalten und `msg.imapAck.partial` ist gesetzt. Ein Retry kann eine
weitere Zielkopie erzeugen.

Der historische ImapFlow-Fall mit DELETE-Erfolg nach abgelehntem Setzen von
`\Deleted` wird im Kandidaten `1.1.0` im Paket abgesichert. ACK und Input-Expunge
verwenden `lib/imap-delete.js` mit expliziter Flag-Bestaetigung, Delete-Pruefung
und begrenzter UID-Nachkontrolle. Verbindung, ausgewaehlte Mailbox und
UIDVALIDITY muessen dabei gueltig bleiben. Ein temporaerer Guard des oeffentlichen
`response`-Events verlangt pro Aufruf mindestens einen OK-Abschluss und keinen
Non-OK-Abschluss; dadurch zaehlen auch verschleierte NO-Antworten als Fehler.
Er speichert nur zwei Boolean-Werte und wird in `finally` entfernt, ohne Raw-Logs.
Ein initialer STORE-Fehler stoppt
vor EXPUNGE; nach bestaetigtem STORE sind Folgefehler partiell. ACK behaelt
Inflight und stoppt Folgechunks derselben Gruppe; Input bricht bei partiellen
oder Verbindungsfehlern den Abruf ab. Unbestaetigte UIDs werden nicht als
entfernt gezaehlt oder aus der Registry entfernt. Es gibt keinen Rollback.
Die historische Reproduktion und Grenzen stehen in
[KNOWN_ISSUES.md](../../docs/KNOWN_ISSUES.md). Das fruehere Deploy-Pruefprotokoll
belegt diesen spaeteren Fix nicht. Ergebnisse fuer den Kandidaten werden im
[RC-Pruefprotokoll](VALIDATION_1_1_0_RC_DE.md) dem jeweiligen Stand zugeordnet.

## 5. Kritische Invarianten

1. Keine unbounded IMAP-Operationen ueber grosse Mailboxen.
2. Keine mailboxweite Suche, um Batch-Groessen aufzufuellen.
3. At-least-once bleibt wichtiger als genau-einmal.
4. Eine Nachricht darf erneut erscheinen, wenn kein erfolgreicher ACK erfolgt.
5. ACK entfernt Inflight nur nach bestaetigtem Erfolg.
6. Unsichere IMAP-Fallbacks werden abgelehnt.
7. Kein persistenter lokaler Status als Pflichtbestandteil.
8. Keine Secrets oder sensiblen Mail-Inhalte loggen.
9. Node.js `>=22.0.0` und Node-RED `>=4.0.0` bleiben installierbar.
10. README, Hilfetexte, Beispiele und Tests bleiben konsistent.

## 6. Lokale Validierung

Vor groesseren Abschluessen:

```bash
npm install
npm audit --omit=dev
npm test
npm run pack:check
```

Ergaenzend sinnvoll:

```bash
git diff --check
rg "alte Paket- oder Node-Namen" .github README.md docs nodes test
```

## 7. Release-Hinweise

Historie: `0.1.0` war der Entwicklungsstart; `0.2.0` stellte vor dem ersten
stabilen Release auf Node.js `>=22.0.0` und Node-RED `>=4.0.0` um. `1.0.0` und
`1.0.1` sind veroeffentlicht. Die Startpruefung und DELETE-Absicherung sind im
unveroeffentlichten Kandidaten `1.1.0` enthalten. Ein Veroeffentlichungsdatum
steht noch nicht fest.

Verbindlicher Ablauf: [Release-Checkliste](../../docs/RELEASE_DE.md).
Technischer Abschluss verlangt einen frischen Tarball, echte Bibliotheksvertraege,
die tatsaechliche Node-RED-Deploy-Matrix mit lokalem synthetischem IMAP,
Regressionstests und einen Produktions-Audit ohne Befunde. Node.js 22.0.0
wird mit `--engine-strict` fuer Lockfile- und Verbraucherinstallation geprueft.

Der externe Provider-Test des unveraenderten Kandidaten wurde am 16.09.2026
erfolgreich abgeschlossen; Umfang und Grenzen stehen in der
[Provider-Abnahme](VALIDATION_PROVIDER_1_1_0_DE.md). Vor dem Release fehlen
aktuelle GitHub-CI-Laeufe nach gesonderter Push-Freigabe. Nachtraegliche
Paketaenderungen erfordern erneut passende Nachweise.
Der Versionswechsel auf `1.1.0` bereitet den lokalen Kandidaten vor.
Release-Commit, Tag, npm-Publishing und Katalog-Refresh werden erst im
dafuer ausdruecklich freigegebenen Umfang ausgefuehrt.
