# Design Decisions: imap email

Status: Spezifikation fuer die naechste Implementierungsphase.

Diese Datei beschreibt die getroffenen Designentscheidungen fuer das neue Paket
`@compeso/node-red-contrib-imap-email`. Sie ist absichtlich eine technische
Entscheidungsvorlage und keine Release-Ankuendigung.

## 1. Ziel des neuen Pakets

Das Paket `@compeso/node-red-contrib-imap-email` ist ein eigenstaendiges
Node-RED npm-Paket fuer IMAP-basierte E-Mail-Verarbeitung.

Es wurde aus dem frueheren Paket `@compeso/node-red-contrib-imap-queue`
abgeleitet, soll aber unabhaengig weiterentwickelt, versioniert und
veroeffentlicht werden.

Die oeffentlichen Node-RED-Typen des neuen Pakets sind:

```text
imap email account
imap email in
imap email ack
```

Das Paket soll weiterhin fuer grosse Postfaecher geeignet sein. Der
Eingangsnode darf keine unbeschraenkten Mailbox-Scans ausfuehren. Die
bestehende bounded-window-Strategie bleibt ein zentrales Architekturprinzip.

Der Node `imap email ack` soll die bisher getrennten positiven und negativen
Abschlussaktionen in einem Node zusammenfuehren. Nutzer sollen mehrere
unterschiedlich konfigurierte `imap email ack` Nodes parallel in einem Flow
verwenden koennen.

## 2. Nicht-Ziele

Nicht Teil dieser Spezifikation:

- Keine Aenderung am alten Paket `@compeso/node-red-contrib-imap-queue`.
- Keine Registrierung alter Node-RED-Typen im neuen Paket.
- Keine unbeschraenkte IMAP-Suche ueber ganze Postfaecher.
- Kein automatisches Auffuellen eines Batches durch Scannen immer weiterer
  Mailbox-Fenster.
- Keine echte Exactly-once-Zustellung.
- Keine persistente lokale Inflight-Datenbank.
- Keine Speicherung von Zugangsdaten, Tokens oder privaten Endpunkten in
  Beispielen, Tests oder Dokumentation.
- Keine npm- oder flows.nodered.org-Veroeffentlichung ohne ausdrueckliche
  menschliche Freigabe.
- Keine OAuth2-Tokenbeschaffung oder automatische OAuth2-Tokenaktualisierung in
  dieser Phase.

## 3. `imap email in` Spezifikation

### 3.1 Grundverhalten

`imap email in` ist ein extern getriggerter Eingangsnode. Jede eingehende
Nachricht startet hoechstens einen Fetch-Zyklus.

Der Node liest pro Trigger nur ein begrenztes Cursor-Fenster des Postfachs,
zum Beispiel `1:500` im ersten Zyklus und `501:1000` im naechsten Zyklus.
Innerhalb dieses Fensters werden Kandidaten anhand von IMAP-Flags,
Inflight-Zustand, Batchgroesse und Kapazitaet gefiltert.

Der Node darf nicht so lange weitere Bereiche lesen, bis ein Batch voll ist.
Selektive Filter duerfen deshalb dazu fuehren, dass ein Trigger weniger als
`batchSize` oder auch gar keine Nachrichten ausgibt.

### 3.2 Flag-Filter

Die erste Version der erweiterten Selektion verwendet pro Flag eine
Tri-State-Auswahl:

```text
ignore   Flag-Zustand ist egal
require  Flag muss vorhanden sein
exclude  Flag darf nicht vorhanden sein
```

Unterstuetzte Kriterien:

```text
deleted   -> \Deleted
seen      -> \Seen
answered  -> \Answered
flagged   -> \Flagged
```

Empfohlene gespeicherte Konfigurationsfelder:

```text
deletedSelection
seenSelection
answeredSelection
flaggedSelection
```

Die Runtime normalisiert diese Felder intern zu einem gemeinsamen
Selection-Objekt:

```js
{
  deleted: "exclude",
  seen: "ignore",
  answered: "ignore",
  flagged: "ignore"
}
```

### 3.3 Defaults

Die Defaults muessen das bisherige Verhalten des alten `skipDeleted=true`
abbilden:

```text
deletedSelection   exclude
seenSelection      ignore
answeredSelection  ignore
flaggedSelection   ignore
```

### 3.4 Legacy-Abbildung von `skipDeleted`

Falls alte Flow-Konfigurationen oder Tests noch `skipDeleted` enthalten, gilt:

```text
skipDeleted=true   -> deletedSelection=exclude
skipDeleted=false  -> deletedSelection=ignore
```

Wenn sowohl `deletedSelection` als auch `skipDeleted` vorhanden sind, hat
`deletedSelection` Vorrang.

### 3.5 Cursor-Window-Regel

Pro Fetch-Zyklus wird genau ein begrenztes Cursor-Fenster gelesen:

```text
windowStart = scanCursor
windowEnd   = min(mailbox.exists, scanCursor + frontWindowSize - 1)
range       = windowStart:windowEnd
```

Erlaubt ist ein Fetch dieses Fensters mit `flags: true`, `uid: true` und den
bereits benoetigten leichten Metadaten.

Der Cursor ist ein fluechtiger Runtime-Zustand pro Node. Nach einem
erfolgreichen Fetch-Zyklus wird er auf `windowEnd + 1` gesetzt. Wenn das Ende
der Mailbox erreicht ist, wrappt der Cursor auf `1`. Bei leerer Mailbox,
ungueltigem Cursor oder geaenderter UIDVALIDITY wird er ebenfalls auf `1`
zurueckgesetzt.

Nicht erlaubt:

- IMAP `SEARCH` ueber das gesamte Postfach.
- Wiederholtes Lesen weiterer Fenster, bis `batchSize` erreicht ist.
- Dynamische Erhoehung von `frontWindowSize` durch Message-Input.
- Ein zweiter Limit-Parameter wie `maxWindowsPerCycle`.

### 3.6 Kandidatenfilterung

Die Kandidatenbildung soll in dieser Reihenfolge erfolgen:

1. Cursor-Fenster lesen.
2. Ungueltige UIDs verwerfen.
3. Deleted-Tracking und optionale Expunge-Logik beibehalten.
4. Flag-Selection auf die im Cursor-Fenster gelesenen Flags anwenden.
5. Aktive Inflight-Nachrichten verwerfen.
6. Kandidaten auf `batchSize` und verfuegbare `capacity` begrenzen.
7. Full-Fetch fuer die ausgewaehlten UIDs ausfuehren.
8. Flags nach dem Full-Fetch erneut pruefen, da sie sich zwischen Front-Fetch
   und Full-Fetch geaendert haben koennen.

### 3.7 Stats

Die bestehenden Stats bleiben erhalten. Sinnvolle Erweiterungen:

```text
selection
filteredByFlags
filteredByInflight
scanCursorStart
scanCursorEnd
scanCursorNext
scanCursorReset
scanWrapped
```

`selection` sollte keine Zugangsdaten oder privaten Werte enthalten.

## 4. `imap email ack` Spezifikation

### 4.1 Grundziel

`imap email ack` ist der einheitliche Abschlussnode fuer erfolgreich oder
anderweitig fachlich behandelte Mails.

Mehrere unterschiedlich konfigurierte Nodes sollen parallel verwendbar sein:

```text
imap email in
  -> fachliche Verarbeitung
      -> imap email ack Variante A
      -> imap email ack Variante B
      -> imap email ack Variante C
```

### 4.2 Modi

Die Modi werden neutral und aktionsorientiert benannt:

```text
delete
keep/requeue later
keep/requeue now
move to folder
set by msg
```

Empfohlene interne Werte:

```text
delete             delete
keep/requeue later keep-requeue-later
keep/requeue now   keep-requeue-now
move to folder     move
set by msg         message
```

### 4.3 Semantik der Modi

`delete`

- Loescht die Mail per UID.
- Entspricht der bisherigen positiven ACK-Semantik.
- Entfernt den Inflight-Eintrag erst nach erfolgreicher IMAP-Aktion.

`keep/requeue later`

- Fuehrt keine IMAP-Aktion aus.
- Laesst den Inflight-Eintrag aktiv.
- Die Mail kann nach Ablauf von `retryAfterMs` erneut ausgegeben werden.
- Entspricht der alten NACK-Semantik `retry`.

`keep/requeue now`

- Fuehrt keine IMAP-Aktion aus.
- Entfernt den Inflight-Eintrag sofort.
- Die Mail kann beim naechsten Fetch-Zyklus wieder Kandidat werden.
- Entspricht der alten NACK-Semantik `retry-now`.

`move to folder`

- Verschiebt die Mail per UID in einen Zielordner.
- Der Zielordner kann optional angelegt werden.
- Entfernt den Inflight-Eintrag erst nach erfolgreicher IMAP-Aktion.

`set by msg

- Aktion, Zielordner, Requeue-Verhalten und Flag-Aenderungen werden aus einer
  Message-Property gelesen.
- Default-Pfad:

```text
msg.imap.ackAction
```

Beispiel:

```js
msg.imap.ackAction = {
  disposition: "move",
  targetMailbox: "Archive/Processed",
  createTargetMailbox: true,
  requeue: "complete",
  flags: {
    seen: "set",
    answered: "ignore",
    flagged: "clear"
  }
};
```

### 4.4 Custom Action Model

Der statische Custom-Plan und der Message-basierte Plan sollen in dieselbe
interne Struktur normalisiert werden:

```js
{
  disposition: "delete" | "keep" | "move",
  targetMailbox: "NodeRED.failed",
  createTargetMailbox: true,
  requeue: "complete" | "later" | "now",
  flags: {
    seen: "ignore" | "set" | "clear",
    answered: "ignore" | "set" | "clear",
    flagged: "ignore" | "set" | "clear"
  }
}
```

### 4.5 Kombinationsregeln

Erlaubt:

- `keep` ohne Flag-Aenderungen.
- `keep` mit Flag-Aenderungen.
- `move` ohne Flag-Aenderungen.
- `move` mit Flag-Aenderungen.
- `delete` ohne Flag-Aenderungen.

Nicht erlaubt:

- `delete` und `move` gleichzeitig.
- `delete` mit Flag-Aenderungen in Version 0.1.
- `set` und `clear` fuer dasselbe Flag gleichzeitig.
- `move` ohne gueltigen Zielordner.
- `message`-Modus ohne gueltiges Action-Objekt.

`keep` ohne Flag-Aenderung ist technisch erlaubt, muss aber dokumentiert
werden: Die Mail bleibt im Postfach und kann erneut erscheinen.

### 4.6 Reihenfolge der IMAP-Aktionen

Bei erfolgreicher Tokenvalidierung und Mailbox-Sperre:

1. UIDVALIDITY pruefen.
2. Flags auf der Quellmailbox setzen oder entfernen.
3. Danach `move` ausfuehren, falls konfiguriert.
4. Oder `delete` ausfuehren, falls konfiguriert.
5. Inflight gemaess Plan behandeln.
6. Erfolg ausgeben.

Flags werden vor `move` ausgefuehrt, weil der ACK-Token auf die UID in der
Quellmailbox zeigt und Ziel-UIDs nach einem Move serverabhaengig sein koennen.

## 5. Message Contracts

### 5.1 `msg.imap.ackToken`

`msg.imap.ackToken` bleibt der zentrale Vertrag zwischen `imap email in` und
`imap email ack`.

Erwartete Felder:

```js
{
  accountId: "...",
  queueKey: "...",
  host: "...",
  port: 993,
  secure: true,
  user: "...",
  mailbox: "INBOX",
  uid: 123,
  uidValidity: "456"
}
```

Der bestehende Fallback auf `msg.imap.uid`, `msg.imap.mailbox` und
`msg.imap.uidValidity` darf erhalten bleiben.

### 5.2 `msg.imap.flags`

`msg.imap.flags` bleibt in Version 0.1 ein Array von IMAP-Flag-Strings:

```js
msg.imap.flags = ["\\Seen", "\\Flagged"];
```

Ein zusaetzliches Boolean-Objekt wie `msg.imap.flagState` wird vorerst nicht
eingefuehrt.

### 5.3 `msg.imap.ackAction`

Im Modus `set by msg` wird standardmaessig
`msg.imap.ackAction` gelesen.

Das Objekt beschreibt nicht nur die Hauptaktion, sondern auch Flags:

```js
{
  disposition: "keep" | "delete" | "move",
  targetMailbox: "Archive",
  createTargetMailbox: true,
  requeue: "complete" | "later" | "now",
  flags: {
    seen: "ignore" | "set" | "clear",
    answered: "ignore" | "set" | "clear",
    flagged: "ignore" | "set" | "clear"
  }
}
```

### 5.4 `msg.imapAck`

Erfolg:

```js
msg.imapAck = {
  ok: true,
  mode: "delete",
  disposition: "delete",
  mailbox: "INBOX",
  targetMailbox: undefined,
  uid: 123,
  uidValidity: "456",
  flags: {
    add: [],
    remove: []
  },
  ranges: ["123"],
  batchSize: 1,
  requeue: "complete",
  completed: true,
  inflightRemoved: true
};
```

Fehler:

```js
msg.imapAck = {
  ok: false,
  mode: "move",
  disposition: "move",
  mailbox: "INBOX",
  targetMailbox: "NodeRED.failed",
  uid: 123,
  uidValidity: "456",
  error: "UIDVALIDITY mismatch",
  completed: false,
  inflightRemoved: false
};
```

## 6. UI-Konfiguration

### 6.1 `imap email in`

UI-Bereich: `Selection`.

Felder:

```text
Deleted   Any | Only with flag | Only without flag
Seen      Any | Only with flag | Only without flag
Answered  Any | Only with flag | Only without flag
Flagged   Any | Only with flag | Only without flag
```

Interne Werte:

```text
Any               ignore
Only with flag    require
Only without flag exclude
```

Defaults:

```text
Deleted   Only without flag
Seen      Any
Answered  Any
Flagged   Any
```

### 6.2 `imap email ack`

Hauptfeld:

```text
Mode
```

Optionen:

```text
delete
keep/requeue later
keep/requeue now
move to folder
set by msg
```

Zusaetzliche Felder:

```text
Target folder              sichtbar bei move
Create target folder       sichtbar bei move
Message action property    sichtbar bei set by msg
Seen action                ignore | set | clear
Answered action            ignore | set | clear
Flagged action             ignore | set | clear
```

Bei `set by msg` ersetzt die Message-Aktion die statische Aktion
einschliesslich Flags und Zielordner.

## 7. Runtime-Verhalten

### 7.1 `imap email in`

- Ein Trigger startet hoechstens einen Fetch-Zyklus.
- Wenn bereits ein Fetch-Zyklus laeuft, wird kein paralleler Fetch gestartet.
- Es wird nur ein begrenztes Cursor-Fenster gelesen.
- Flag-Selektion wird auf die im Cursor-Fenster gelesenen Flags angewendet.
- Full-Fetch-Flags werden erneut validiert.
- Ausgegebene Nachrichten werden im volatile Inflight-Registry markiert.

### 7.2 `imap email ack`

- Eingehende Nachrichten werden wie bisher gebatcht.
- Token werden aus `msg.imap.ackToken` extrahiert.
- Nachrichten werden nach Mailbox, UIDVALIDITY und Action-Plan gruppiert.
- Grosse UID-Mengen werden mit `chunkUidRanges` in handhabbare IMAP-Kommandos
  aufgeteilt.
- Inflight wird erst nach erfolgreichem Abschluss der konfigurierten Aktion
  entfernt, ausser der Modus ist explizit `keep/requeue later`.

## 8. Fehlerverhalten

### 8.1 Allgemein

Keine Mail darf als erfolgreich behandelt werden, wenn die konfigurierte
IMAP-Aktion fehlgeschlagen ist.

Fehler werden ueber Output 2 ausgegeben und in `msg.imapAck.ok = false`
sichtbar gemacht.

### 8.2 Fehler bei `imap email in`

- Operative Fetch-Fehler gehen auf Output 2.
- Parse-Fehler gehen auf Output 2 und enthalten nach Moeglichkeit den
  ACK-Token.
- Der Node loescht keine normal verarbeiteten Nachrichten.

### 8.3 Fehler bei `imap email ack`

Fehlerfaelle:

- Fehlender oder ungueltiger ACK-Token.
- Fehlende Zielmailbox bei `move`.
- Ungueltiges Message-Action-Objekt.
- UIDVALIDITY mismatch.
- IMAP-Fehler bei Flag-Aenderung, Move oder Delete.

Bei Fehlern:

- Output 2.
- `msg.imapAck.ok = false`.
- Inflight bleibt erhalten, sofern nicht eine explizit erfolgreiche
  `keep/requeue now`-Aktion ausgefuehrt wurde.
- Stats enthalten Fehlerzaehler und Fehlermeldung.

## 9. Skalierbarkeitsregeln fuer grosse Postfaecher

`imap email in`:

- Kein unbounded Mailbox-Scan.
- Kein mailboxweites IMAP `SEARCH`.
- Pro Trigger nur ein bounded Cursor-Fenster.
- `frontWindowSize` bleibt die harte Obergrenze fuer pro Trigger gelesene
  Nachrichten.
- Der interne Scan-Cursor wrappt am Mailbox-Ende auf `1` und wird bei
  UIDVALIDITY-Wechsel zurueckgesetzt.
- `batchSize` begrenzt die Ausgabe.
- `maxInflight` begrenzt die Anzahl aktiver nicht abgeschlossener Nachrichten.
- Selektive Filter koennen dazu fuehren, dass weniger Nachrichten als
  `batchSize` ausgegeben werden.

`imap email ack`:

- `batchSize` begrenzt eingehende ACK-Items bis zum Flush.
- `maxBatchesPerFlush` begrenzt Arbeit pro Flush.
- `maxUidPerCommand` begrenzt UID-Mengen pro IMAP-Kommando.
- Gruppierung nach Action-Plan verhindert gemischte Aktionen in einem
  unklaren IMAP-Kommando.

Empfohlene Defaults bleiben:

```text
imap email in:
  batchSize:        50
  frontWindowSize:  500
  maxInflight:      500
  retryAfterMs:     1800000
  maxUidPerCommand: 500

imap email ack:
  batchSize:        100
  flushMs:          500
  maxUidPerCommand: 500
  maxBatchesPerFlush: 20
```

## 10. Testplan

### 10.1 `imap email in`

- Defaults entsprechen altem `skipDeleted=true`.
- Legacy `skipDeleted=true` wird zu `deletedSelection=exclude`.
- Legacy `skipDeleted=false` wird zu `deletedSelection=ignore`.
- `deleted`, `seen`, `answered`, `flagged` jeweils mit `ignore`, `require`,
  `exclude`.
- Kombination mehrerer Flag-Filter.
- Filterung erfolgt nach Cursor-Fetch und vor Full-Fetch.
- Full-Fetch prueft Flags erneut.
- Selektive Filter loesen kein weiteres Fenster im selben Trigger aus.
- Der interne Cursor liest pro Trigger hoechstens `frontWindowSize` Nachrichten.
- Der interne Cursor wrappt am Mailbox-Ende.
- Der interne Cursor resetet bei UIDVALIDITY-Wechsel.
- Mock-Client stellt sicher, dass kein `SEARCH` ausgefuehrt wird.
- Stats enthalten `selection`, `filteredByFlags` und Cursor-Felder.
- HTML defaults, labels und help text sind konsistent.

### 10.2 `imap email ack`

- Default-Modus `delete` verhaelt sich wie bisheriges ACK.
- `keep/requeue later` behaelt Inflight.
- `keep/requeue now` entfernt Inflight ohne IMAP-Aktion.
- `move to folder` ruft Zielordner-Erstellung und `messageMove`.
- Flag-Aenderungen rufen `messageFlagsAdd` und `messageFlagsRemove`.
- Flags werden vor Move ausgefuehrt.
- Ungueltige Kombinationen werden abgelehnt.
- `set by msg` liest Aktion und Flags aus der konfigurierten
  Message-Property.
- Ungueltiges Message-Action-Objekt geht auf Output 2.
- UIDVALIDITY mismatch geht auf Output 2.
- IMAP-Fehler bei Flags, Move oder Delete entfernt Inflight nicht.
- Grosse UID-Mengen werden gechunkt.
- Mehrere unterschiedlich konfigurierte `imap email ack` Nodes koennen gleiche
  Tokenformen verarbeiten.
- Stats enthalten Action-Plan, Erfolgszaehler, Fehlerzaehler und Timings.

### 10.3 Dokumentation und Packaging

- README beschreibt neue Selection-Optionen.
- README beschreibt Ack-Modi und Message-Action-Objekt.
- Node-RED Help-Texte beschreiben UI, Outputs und Warnungen.
- Beispiel-Flows enthalten keine Credentials.
- `npm test` und `npm run pack:check` muessen erfolgreich sein.

## 11. Offene Fragen

- Soll `delete` mit Flag-Aenderungen dauerhaft verboten bleiben oder spaeter
  als Advanced-Kombination erlaubt werden?
- Soll der volatile Scan-Cursor spaeter optional persistent werden, damit ein
  Node-RED-Neustart nicht wieder bei Sequenz `1` beginnt?
- Soll `msg.imap.flags` spaeter zusaetzlich ein Boolean-Objekt erhalten, etwa
  `msg.imap.flagState`?
- Soll der Property-Pfad fuer `set by msg` frei konfigurierbar sein oder
  fest bei `msg.imap.ackAction` bleiben?
- Wie soll die UI mit `Expunge front` umgehen, wenn `deletedSelection=require`
  gesetzt wird?
- Soll `move to folder` bei fehlendem Zielordner standardmaessig Ordner
  anlegen oder nur bei aktivierter Option?
- Soll es fuer dynamische Message-Actions eine strikte JSON-Schema-Validierung
  geben?
