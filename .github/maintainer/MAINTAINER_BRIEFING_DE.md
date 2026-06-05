# Maintainer-Briefing: @compeso/node-red-contrib-imap-queue

Stand: Release 1.0.0

Dieses Dokument ist ein kompaktes Briefing für spätere Wartung, Bugfixes und Erweiterungen des Pakets `@compeso/node-red-contrib-imap-queue`. Es kann zusammen mit dem ZIP-Quellpaket `compeso-node-red-contrib-imap-queue-1.0.0.zip` in einem neuen Chat, in Codex oder in einer lokalen Entwicklungsumgebung verwendet werden.

## 1. Projektziel

Das Paket stellt Node-RED-Nodes bereit, mit denen ein IMAP-Postfach als robuste Queue genutzt werden kann.

Zielverhalten:

```text
externer Trigger
  -> imap queue in
      -> erfolgreiche Verarbeitung
          -> imap queue ack
```

Optionale Fehlerbehandlung:

```text
Verarbeitungsfehler oder fachlicher Fehler
  -> imap queue nack
```

Die Mailbox bleibt die dauerhafte Quelle der Wahrheit:

```text
Mail liegt noch in der Queue-Mailbox = noch nicht erfolgreich abgeschlossen
Mail wurde per ACK gelöscht          = erfolgreich verarbeitet
```

## 2. Zentrale Zusage: At-least-once

Das Paket garantiert bewusst keine Exactly-once-Verarbeitung. Es ist auf At-least-once ausgelegt.

```text
At least once:          ja
Exactly once:           nein
Doppelte Verarbeitung:  möglich
Persistenter lokaler Status erforderlich: nein
```

Daraus folgen wichtige Designentscheidungen:

- Eine Mail darf doppelt ausgegeben werden.
- Eine Mail darf nicht still verloren gehen.
- Erfolgreiche Verarbeitung wird erst durch `imap queue ack` abgeschlossen.
- Der flüchtige Inflight-Cache dient nur zur Deduplizierung während des laufenden Prozesses, nicht als dauerhafte Wahrheit.
- Wenn Node-RED neu startet, darf der Inflight-Cache verloren gehen; nicht geACKte Mails bleiben in der Mailbox und werden später erneut ausgegeben.

## 3. Node-Typen

Die technischen Node-RED-Typnamen verwenden Leerzeichen, nicht Bindestriche:

```text
imap queue account
imap queue in
imap queue ack
imap queue nack
```

Die Dateinamen bleiben intern mit Bindestrichen:

```text
nodes/imap-queue-account.js
nodes/imap-queue-account.html
nodes/imap-queue-in.js
nodes/imap-queue-in.html
nodes/imap-queue-ack.js
nodes/imap-queue-ack.html
nodes/imap-queue-nack.js
nodes/imap-queue-nack.html
```

Wichtig: Bei Änderungen an Typnamen müssen mindestens diese Stellen synchron bleiben:

- `RED.nodes.registerType(...)`
- `data-template-name`
- `data-help-name`
- `package.json` unter `node-red.nodes`
- Beispiel-Flows
- README und Node-RED-Hilfetexte
- Tests, insbesondere Modul- und Beispiel-Flow-Tests

## 4. Architektur

### 4.1 `imap queue account`

Config-Node für gemeinsame IMAP-Zugangsdaten und Verbindungseinstellungen.

Aktuelle Einstellungen:

- Name
- Host
- Port
- TLS
- Verify cert / `tlsRejectUnauthorized`
- Username, als Node-RED-Credential
- Password, als Node-RED-Credential
- Access token, als Node-RED-Credential, aktuell nur statisch/advanced
- Connect ms
- Greeting ms
- Socket ms

Wichtig:

- Keine Passwörter oder Tokens loggen.
- Access Token ist vorhanden, aber OAuth2-Refresh ist in Version 1.0.0 nicht finalisiert.
- Für STRATO ist Passwort-Auth der getestete Standard.

### 4.2 `imap queue in`

Extern getriggerter Abruf-Node. Es gibt keinen internen Polling-Modus mehr.

Pro eingehender Message wird genau ein begrenzter Abrufzyklus gestartet. Wenn bereits ein Abruf läuft, wird kein paralleler IMAP-Abruf gestartet; stattdessen wird eine übersprungene Stats-Meldung erzeugt.

Kernprinzip:

- Niemals ein unbounded `SEARCH UNDELETED` über die ganze Mailbox.
- Stattdessen ein begrenztes Front-Fenster lesen, z. B. `1:500`.
- Aus diesem Front-Fenster maximal `batchSize` Mails emitten.
- Jede Mail bekommt ein `msg.imap.ackToken`.
- Der Node löscht normale erfolgreich verarbeitete Mails nie selbst.

Aktuelle wichtige Einstellungen:

- Account
- Mailbox, z. B. `INBOX`
- Batch size
- Front window
- Max inflight
- Retry after ms
- UIDs/command
- Skip deleted
- Expunge deleted front
- Expunge limit
- Include parsed attachments in `msg.email.attachments`
- Emit raw source in `msg.email.raw`
- Diagnostics: `off`, `stats`, `debug`

Ausgänge:

```text
Output 1: geparste Queue-Mail
Output 2: Fehler / parsebare Fehlerfälle
Output 3: Stats, wenn Diagnostics stats/debug aktiv ist
```

Wichtige Message-Form:

```js
msg.topic                 // Mail-Betreff
msg.payload               // Text-Body

msg.email.topic           // Mail-Betreff
msg.email.messageId
msg.email.date
msg.email.from
msg.email.to
msg.email.cc
msg.email.bcc
msg.email.text
msg.email.html
msg.email.header
msg.email.attachments     // nur wenn aktiviert
msg.email.raw             // nur wenn aktiviert

msg.imap.ackToken
msg.imap.uid
msg.imap.uidValidity
msg.imap.mailbox
msg.imap.delivery.mode = "at-least-once"
msg.imap.delivery.duplicatePossible = true
```

Nicht wieder einführen, außer bewusst als Breaking Change:

```js
msg.html
msg.attachments
msg.email.subject
msg.email.headers
```

### 4.3 `imap queue ack`

ACK-Node für erfolgreiche Verarbeitung.

Er sammelt eingehende ACKs intern und löscht gebatcht per UID. Er benötigt keinen zusätzlichen Inject- oder Tick-Node.

Aktuelle Einstellungen:

- Account
- Mailbox
- Batch size
- Flush ms
- UIDs/command
- Batches/flush
- Diagnostics: `off`, `stats`, `debug`

Ausgänge:

```text
Output 1: ACK ok
Output 2: ACK error
Output 3: ACK batch stats
```

Wichtige Regeln:

- ACK darf nur auf dem erfolgreichen Verarbeitungspfad hängen.
- ACK löscht per UID und prüft UIDVALIDITY.
- Bereits verschwundene Mails sollten für ACK-Zwecke nicht unnötig als harter Fehler behandelt werden.
- ACK-Pending darf flüchtig sein. Wenn Node-RED vor dem Flush abstürzt, bleibt die Mail in der Mailbox und wird später erneut ausgegeben.

### 4.4 `imap queue nack`

Optionaler NACK-Node für fachliche Fehler oder bewusstes Aussortieren.

Aktuelle Einstellungen:

- Account
- Mailbox
- Action:
  - `retry`
  - `retry-now`
  - `move`
  - `delete`
- Failed mailbox, Default: `NodeRED.failed`
- Diagnostics: `off`, `debug`

Ausgänge:

```text
Output 1: NACK ok
Output 2: NACK error
```

Wichtig:

- Der Default für Failed mailbox ist `NodeRED.failed`, nicht `.NodeRED.failed`.
- Ein führender Punkt kann bei manchen IMAP-Servern, insbesondere STRATO, zu `Command failed` führen.

## 5. Kritische Invarianten

Diese Punkte dürfen bei Änderungen nicht versehentlich verletzt werden:

1. Kein unbounded Search/Fetch über riesige Mailboxen.
2. Keine automatische Löschung im `imap queue in` für normal verarbeitete Mails.
3. Normale Löschung nur durch `imap queue ack` nach erfolgreicher Downstream-Verarbeitung.
4. `\Deleted`-Mails im Front-Fenster werden übersprungen und optional kontrolliert expunged.
5. Kein erforderlicher persistenter lokaler Status.
6. Inflight ist nur ein RAM-Cache.
7. Credentials, Access Tokens, Raw-Mails und Attachments dürfen nicht geloggt werden.
8. Node-Typnamen mit Leerzeichen beibehalten.
9. Message-Shape ab Version 1.0.0 stabil halten, außer bei bewusstem Major Release.
10. README, Node-RED-Hilfetexte, Beispiele und Tests bei jeder Nutzer-sichtbaren Änderung aktualisieren.

## 6. Bekannte Grenzen in Version 1.0.0

- Keine Exactly-once-Verarbeitung.
- Keine automatische OAuth2-Token-Erneuerung.
- Keine echten Integrationstests gegen einen IMAP-Server im CI.
- Optimiert für eine dedizierte Queue-Mailbox und einen primären Consumer.
- Mehrere unabhängige Worker gegen dieselbe Mailbox können doppelte Verarbeitung verstärken.
- Sehr große Attachments erhöhen Speicherbedarf, wenn Attachments oder Raw Source aktiviert sind.

## 7. Test- und Qualitätsgate

Vor jedem Commit mit Funktionsänderung:

```bash
npm install --no-audit --no-fund
npm test
npm pack --dry-run
```

Vor jedem Release zusätzlich:

```bash
npm pack
```

Danach lokale Installation in Node-RED prüfen:

```bash
cd ~/.node-red
npm uninstall @compeso/node-red-contrib-imap-queue
npm install /pfad/zu/compeso-node-red-contrib-imap-queue-x.y.z.tgz
```

Bei Windows:

```powershell
cd $env:USERPROFILE\.node-red
npm uninstall @compeso/node-red-contrib-imap-queue
npm install C:\Pfad\zu\compeso-node-red-contrib-imap-queue-x.y.z.tgz
```

## 8. CI

GitHub Actions liegt unter:

```text
.github/workflows/test.yml
```

Die CI-Matrix testet Node.js 18, 20, 22 und 24.

Der Workflow sollte mindestens ausführen:

```bash
npm install --no-audit --no-fund
npm test
npm pack --dry-run
```

## 9. Release-Prozess

Für Patch-/Minor-Releases:

```bash
npm test
npm pack --dry-run

git status
git add .
git commit -m "Release x.y.z"
git tag vx.y.z
git push
git push --tags

npm publish --access public
```

Nach dem Publish prüfen:

```bash
npm view @compeso/node-red-contrib-imap-queue version
npm view @compeso/node-red-contrib-imap-queue dist-tags
```

## 10. Sinnvolle nächste Verbesserungen

Priorisierte Wartungs-/Weiterentwicklungsideen:

1. Integrationstest mit lokalem oder gemocktem IMAP-Server.
2. OAuth2-Refresh-Konzept für Microsoft 365 und Gmail als separates Feature.
3. Verbesserte Troubleshooting-Dokumentation aus realen Issues.
4. Optionales Performance-Monitoring über einheitliche Stats-Events.
5. Zusätzliche Beispiele für NACK-Strategien.
6. GitHub Issue Templates.
7. Security Policy (`SECURITY.md`).
8. CONTRIBUTING.md.
9. Optional: automatisierte Release-Notes aus CHANGELOG.

## 11. Kurzprompt für neue Chats

Wenn dieses Projekt später in einem neuen Chat weiterbearbeitet wird, sollte der neue Chat mindestens diese Informationen bekommen:

- Aktuelles ZIP-Quellpaket hochladen.
- Dieses Maintainer-Briefing hochladen oder einfügen.
- Konkrete Änderung als kleine Aufgabe formulieren.
- Verlangen, dass Tests angepasst und `npm test` sowie `npm pack --dry-run` ausgeführt werden.
- Explizit sagen: keine unbounded IMAP-Operationen, keine Änderung der At-least-once-Semantik, keine Credentials loggen.
