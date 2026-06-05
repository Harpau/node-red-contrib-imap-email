# Codex-/Chat-Startprompt für spätere Änderungen

Diesen Prompt zusammen mit dem aktuellen ZIP-Quellpaket des Repositories verwenden, z. B. `compeso-node-red-contrib-imap-queue-1.0.0.zip` oder eine spätere Version.

---

Du arbeitest an dem Node-RED-Paket `@compeso/node-red-contrib-imap-queue`.

Bitte entpacke und inspiziere zuerst das hochgeladene ZIP-Quellpaket. Lies mindestens:

- `package.json`
- `README.md`
- `CHANGELOG.md`
- `docs/INSTALL_DE.md`
- `docs/RELEASE_DE.md`
- alle Dateien in `nodes/`
- alle Dateien in `lib/`
- alle Tests in `test/`
- `examples/basic-at-least-once-flow.json`

## Projektkontext

Das Paket stellt vier Node-RED-Nodes bereit:

```text
imap queue account
imap queue in
imap queue ack
imap queue nack
```

Die Nodes verwenden absichtlich Leerzeichen in den Node-RED-Typnamen. Die Dateinamen verwenden intern weiterhin Bindestriche.

Das Paket verwendet ein IMAP-Postfach als at-least-once Queue:

```text
externer Trigger
  -> imap queue in
      -> erfolgreiche Downstream-Verarbeitung
          -> imap queue ack
```

Optional:

```text
Fehlerpfad
  -> imap queue nack
```

## Nicht verhandelbare Architekturregeln

1. Keine unbounded IMAP-Operationen über große Mailboxen einführen.
   - Kein globales `SEARCH UNDELETED` über das gesamte Postfach.
   - Kein `FETCH 1:*` für große Mailboxen.
   - Front-window-Strategie beibehalten.

2. At-least-once-Semantik beibehalten.
   - Eine Mail darf doppelt verarbeitet werden.
   - Eine Mail darf nicht still verloren gehen.
   - Normale Löschung erst durch `imap queue ack` nach erfolgreicher Downstream-Verarbeitung.

3. Kein persistenter lokaler Status als Pflicht.
   - Inflight-Status darf nur flüchtig sein.
   - Die Mailbox ist die dauerhafte Quelle der Wahrheit.

4. Keine Credentials oder sensiblen Inhalte loggen.
   - Kein Passwort.
   - Kein Access Token.
   - Keine Raw-Mail.
   - Keine Attachments.

5. Node-Typnamen stabil halten:

```text
imap queue account
imap queue in
imap queue ack
imap queue nack
```

6. Message-Shape ab Version 1.0.0 stabil halten.
   Insbesondere nicht wieder einführen:

```js
msg.html
msg.attachments
msg.email.subject
msg.email.headers
```

Aktuelle gewünschte Form:

```js
msg.topic
msg.payload
msg.email.topic
msg.email.header
msg.email.html
msg.email.attachments // nur wenn aktiviert
msg.imap.ackToken
```

7. Bei jeder nutzer-sichtbaren Änderung aktualisieren:
   - README
   - Node-RED-Hilfetexte in den `.html`-Dateien
   - Beispiel-Flow, falls relevant
   - CHANGELOG
   - Tests

## Arbeitsweise

Bitte arbeite in kleinen, nachvollziehbaren Schritten:

1. Problem analysieren.
2. Relevante Dateien nennen.
3. Minimalen Änderungsplan vorschlagen.
4. Code ändern.
5. Tests ergänzen oder anpassen.
6. Validierung ausführen.
7. Kurze Zusammenfassung und Migrationshinweise liefern.

## Validierung

Führe mindestens aus:

```bash
npm install --no-audit --no-fund
npm test
npm pack --dry-run
```

Falls ein installierbarer Tarball gewünscht ist:

```bash
npm pack
```

## Aktuelle Aufgabe

Bitte bearbeite folgende Aufgabe:

```text
[HIER KONKRETE ÄNDERUNG / BUGBESCHREIBUNG EINFÜGEN]
```

Rahmenbedingungen:

```text
[HIER VERSION, gewünschte Zielversion, betroffene Node(s), Beispiele, Fehlermeldungen, gewünschtes Verhalten ergänzen]
```

Gewünschtes Ergebnis:

```text
- geänderte Dateien
- Tests grün
- kurze Erklärung der Änderung
- Hinweise für Installation/Upgrade
- falls sinnvoll: neues ZIP/Tarball oder Patch-Diff
```
