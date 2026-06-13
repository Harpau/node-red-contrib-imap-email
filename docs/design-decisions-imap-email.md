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

Die gespeicherten Node-RED-Flow-Typen des neuen Pakets sind:

```text
imap-email account
imap-email in
imap-email ack
```

Die sichtbaren Palette-Labels bleiben benutzerfreundlich `imap email account`,
`imap email in` und `imap email ack`.

Das Paket soll weiterhin fuer grosse Postfaecher geeignet sein. Der
Eingangsnode darf keine unbeschraenkten Mailbox-Scans ausfuehren. Die
bestehende bounded-window-Strategie bleibt ein zentrales Architekturprinzip.

Der Node `imap-email ack` soll die bisher getrennten positiven und negativen
Abschlussaktionen in einem Node zusammenfuehren. Nutzer sollen mehrere
unterschiedlich konfigurierte `imap-email ack` Nodes parallel in einem Flow
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

## 3. `imap-email in` Spezifikation

### 3.1 Grundverhalten

`imap-email in` ist ein extern getriggerter Eingangsnode. Jede eingehende
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

Die Standardstrategie `cursor-window` liest pro Fetch-Zyklus genau ein
begrenztes Cursor-Fenster:

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

Der Cursor bleibt in Version 0.1 bewusst volatil. Nach einem Node-RED-Neustart
beginnt der Scan-Cursor wieder bei Sequenz `1`. Eine Persistenz ueber
Node-RED Context ist kein Ziel fuer Version 0.1.

### 3.5.1 New-UID-Priority-Strategie

Die optionale Strategie `new-uid-priority` ist fuer Postfaecher gedacht, in
denen verarbeitete Nachrichten im selben Ordner bleiben und z. B. nur mit
`\Seen` markiert werden. Auch diese Strategie bleibt speicherbegrenzt: Es wird
immer nur ein Fenster gestreamt und verworfen, bevor das naechste Fenster
gelesen wird. Gespeichert werden nur Kandidaten bis `batchSize` bzw. bis zur
verfuegbaren `maxInflight`-Kapazitaet.

Nach Node-RED-Neustart, ungueltigem `newUidCursor` oder UIDVALIDITY-Wechsel
laeuft die Strategie in eine Warm-up-Phase:

```text
windowSize = frontWindowSize
range      = scanCursor : min(mailbox.exists, scanCursor + windowSize - 1)
```

Nach jedem vollstaendig gelesenen Fenster wird der Node-Status aktualisiert.
Leere Fenster werden verworfen. Die Warm-up-Phase laeuft weiter, bis
`batchSize`, `maxInflight`-Kapazitaet, Mailbox-Ende oder `scanTimeLimitMs`
erreicht ist. `scanTimeLimitMs=0` bedeutet: nur ein Warm-up-Fenster lesen.
Enthaelt ein Fenster mehr ausgabefaehige Kandidaten als in die verbleibende
Batch-/Inflight-Kapazitaet passen, wird der Scan-Cursor auf dem Fensteranfang
gehalten. Dieses Fenster wird dann bei einem spaeteren Trigger erneut gelesen,
statt Kandidaten hinter dem Cursor zurueckzulassen. Wird das Mailbox-Ende ohne
Kandidatenueberlauf erreicht, wird `newUidCursor` auf den pro Trigger fixierten
`uidNextSnapshot` gesetzt.

Sobald `newUidCursor` gueltig ist, wird pro Trigger zuerst ein UID-Fenster fuer
neu eingegangene Nachrichten gelesen:

```text
uidWindowStart = newUidCursor
uidWindowEnd   = min(uidNextSnapshot - 1, newUidCursor + ceil(frontWindowSize / 2) - 1)
```

Danach wird, sofern noch Batch-/Inflight-Kapazitaet frei ist, ein zyklisches
Bestandsfenster mit der kleineren Haelfte von `frontWindowSize` gelesen. Neue
UIDs werden zuerst und in aufsteigender UID-Reihenfolge ausgegeben. Wenn ein
New-UID-Fenster ueberlaeuft, wird `newUidCursor` auf die erste nicht mehr in
die Batch passende UID gesetzt. Wenn ein Bestandsfenster ueberlaeuft, wird der
Bestands-Cursor auf dem Fensteranfang gehalten. Die Strategie garantiert
dadurch keine global strikt aelteste ungelesene Nachricht ueber das gesamte
Postfach.

Nicht erlaubt:

- IMAP `SEARCH` ueber das gesamte Postfach.
- Unbegrenztes Lesen weiterer Fenster ohne Zeit- oder Strategielimit.
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

## 4. `imap-email ack` Spezifikation

### 4.1 Grundziel

`imap-email ack` ist der einheitliche Abschlussnode fuer erfolgreich oder
anderweitig fachlich behandelte Mails.

Mehrere unterschiedlich konfigurierte Nodes sollen parallel verwendbar sein:

```text
imap-email in
  -> fachliche Verarbeitung
      -> imap-email ack Variante A
      -> imap-email ack Variante B
      -> imap-email ack Variante C
```

### 4.2 Modi

Die Modi werden neutral und aktionsorientiert benannt:

```text
delete
move
flag
set by msg.
```

Empfohlene interne Werte:

```text
delete      delete
move        move
flag        flag
set by msg. message
```

### 4.3 Semantik der Modi

`delete`

- Loescht die Mail per UID.
- Entspricht der bisherigen positiven ACK-Semantik.
- Entfernt den Inflight-Eintrag erst nach erfolgreicher IMAP-Aktion.

`move`

- Verschiebt die Mail per UID in einen Zielordner.
- Der Zielordner wird automatisch angelegt, falls der Server ihn als fehlend
  meldet.
- Entfernt den Inflight-Eintrag erst nach erfolgreicher IMAP-Aktion.
- Darf nicht mit Flag-Aenderungen kombiniert werden.

`flag`

- Setzt oder entfernt IMAP-Flags per UID.
- Behaelt die Mail im Postfach.
- Entfernt den Inflight-Eintrag erst nach erfolgreicher Flag-Aktion.
- Wenn keine Flag-Aenderung konfiguriert ist, wird die Mail unveraendert im
  Postfach behalten und trotzdem als erfolgreich abgeschlossen behandelt.

`set by msg.`

- Aktion, Zielordner und Flag-Aenderungen werden aus einer Message-Property
  gelesen.
- Default-Pfad:

```text
msg.imap.ackAction
```

Beispiel:

```js
msg.imap.ackAction = {
  action: "flag",
  flags: {
    seen: "set",
    answered: "ignore",
    flagged: "clear"
  }
};
```

### 4.4 Action Model

Der statische Plan und der Message-basierte Plan werden in dieselbe interne
Struktur normalisiert:

```js
{
  action: "delete" | "move" | "flag",
  disposition: "delete" | "move" | "keep",
  targetMailbox: "Archive",
  flags: {
    add: ["\\Seen"],
    remove: ["\\Flagged"]
  }
}
```

### 4.5 Kombinationsregeln

Erlaubt:

- `flag` ohne Flag-Aenderungen.
- `flag` mit Flag-Aenderungen.
- `move` ohne Flag-Aenderungen.
- `delete` ohne Flag-Aenderungen.

Nicht erlaubt:

- `delete` mit Flag-Aenderungen.
- `move` mit Flag-Aenderungen.
- `set` und `clear` fuer dasselbe Flag gleichzeitig.
- `move` ohne gueltigen Zielordner.
- `message`-Modus ohne gueltiges Action-Objekt.

`flag` ohne Flag-Aenderung ist technisch erlaubt, muss aber dokumentiert
werden: Die Mail bleibt im Postfach und kann erneut erscheinen, falls
`imap-email in` sie weiter selektiert.

### 4.6 Reihenfolge der IMAP-Aktionen

Bei erfolgreicher Tokenvalidierung und Mailbox-Sperre:

1. UIDVALIDITY pruefen.
2. UID-Mengen in handhabbare Chunks aufteilen.
3. Bei `flag`: Flags fuer den Chunk setzen oder entfernen.
4. Bei `move`: Zielordner bei Bedarf anlegen und den Chunk verschieben.
5. Bei `delete`: den Chunk loeschen.
6. Erfolgreiche Chunk-Mails abschliessen und Inflight entfernen.
7. Fehlgeschlagene Chunk-Mails auf Output 2 ausgeben und Inflight behalten.

Chunks bleiben die Performance-Grenze. Innerhalb eines fehlgeschlagenen Chunks
wird nicht auf einzelne UIDs heruntergebrochen.

## 5. Message Contracts

### 5.1 `msg.imap.ackToken`

`msg.imap.ackToken` bleibt der zentrale Vertrag zwischen `imap-email in` und
`imap-email ack`.

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

Zusaetzlich wird `msg.imap.flagState` als Convenience-Objekt ausgegeben:

```js
msg.imap.flagState = {
  deleted: false,
  seen: true,
  answered: false,
  flagged: true
};
```

`msg.imap.flags` bleibt dabei die vollstaendige Server-Flag-Liste. Das
Boolean-Objekt bildet nur die vom Node unterstuetzten Standardflags ab.

### 5.3 `msg.imap.ackAction`

Im Modus `set by msg.` wird fest `msg.imap.ackAction` gelesen. Der
Property-Pfad ist nicht konfigurierbar.

Das Objekt beschreibt die Aktion, den Zielordner fuer `move` und Flags fuer
`flag`:

```js
{
  action: "delete" | "move" | "flag",
  targetMailbox: "Archive",
  flags: {
    seen: "ignore" | "set" | "clear",
    answered: "ignore" | "set" | "clear",
    flagged: "ignore" | "set" | "clear"
  }
}
```

Das Objekt wird durch den internen Normalizer validiert. Eine externe
JSON-Schema-Validierung ist in Version 0.1 nicht vorgesehen.

### 5.4 `msg.imapAck`

Erfolg:

```js
msg.imapAck = {
  ok: true,
  action: "delete",
  disposition: "delete",
  mailbox: "INBOX",
  targetMailbox: "",
  uid: 123,
  uidValidity: "456",
  flags: {
    add: [],
    remove: []
  },
  range: "123",
  completed: true
};
```

Fehler:

```js
msg.imapAck = {
  ok: false,
  action: "move",
  disposition: "move",
  mailbox: "INBOX",
  targetMailbox: "NodeRED.failed",
  uid: 123,
  uidValidity: "456",
  flags: {
    add: [],
    remove: []
  },
  range: "123",
  error: "UIDVALIDITY mismatch",
  completed: false
};
```

## 6. UI-Konfiguration

### 6.1 `imap-email in`

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

`Expunge window` und `Expunge limit` werden nur angezeigt, wenn `Deleted =
Only without flag` gesetzt ist. Runtime-seitig bleibt Expunge ebenfalls auf
`deletedSelection=exclude` beschraenkt.

### 6.2 `imap-email ack`

Hauptfeld:

```text
Mode
```

Optionen:

```text
delete
move
flag
set by msg.
```

Zusaetzliche Felder:

```text
Target folder              sichtbar bei move
Seen action                sichtbar bei flag, ignore | set | clear
Answered action            sichtbar bei flag, ignore | set | clear
Flagged action             sichtbar bei flag, ignore | set | clear
```

Bei `set by msg.` ersetzt die Message-Aktion die statische Aktion
einschliesslich Flags und Zielordner. Der Node liest dabei fest
`msg.imap.ackAction`.

## 7. Runtime-Verhalten

### 7.1 `imap-email in`

- Ein Trigger startet hoechstens einen Fetch-Zyklus.
- Wenn bereits ein Fetch-Zyklus laeuft, wird kein paralleler Fetch gestartet.
- Es wird nur ein begrenztes Cursor-Fenster gelesen.
- Flag-Selektion wird auf die im Cursor-Fenster gelesenen Flags angewendet.
- Full-Fetch-Flags werden erneut validiert.
- Ausgegebene Nachrichten werden im volatile Inflight-Registry markiert.

### 7.2 `imap-email ack`

- Eingehende Nachrichten werden wie bisher gebatcht.
- Token werden aus `msg.imap.ackToken` extrahiert.
- Nachrichten werden nach Mailbox, UIDVALIDITY und Action-Plan gruppiert.
- Grosse UID-Mengen werden in handhabbare IMAP-Kommandos
  aufgeteilt.
- Erfolgreiche Chunks entfernen Inflight fuer die enthaltenen Mails.
- Fehlgeschlagene Chunks behalten Inflight fuer die enthaltenen Mails.

## 8. Fehlerverhalten

### 8.1 Allgemein

Keine Mail darf als erfolgreich behandelt werden, wenn die konfigurierte
IMAP-Aktion fehlgeschlagen ist.

Fehler werden ueber Output 2 ausgegeben und in `msg.imapAck.ok = false`
sichtbar gemacht.

### 8.2 Fehler bei `imap-email in`

- Operative Fetch-Fehler gehen auf Output 2.
- Parse-Fehler gehen auf Output 2 und enthalten nach Moeglichkeit den
  ACK-Token.
- Der Node loescht keine normal verarbeiteten Nachrichten.

### 8.3 Fehler bei `imap-email ack`

Fehlerfaelle:

- Fehlender oder ungueltiger ACK-Token.
- Fehlende Zielmailbox bei `move`.
- Ungueltiges Message-Action-Objekt.
- UIDVALIDITY mismatch.
- IMAP-Fehler bei Flag-Aenderung, Move oder Delete.

Bei Fehlern:

- Output 2.
- `msg.imapAck.ok = false`.
- Inflight bleibt fuer die betroffenen Mails erhalten. Dadurch kann
  `imap-email in` die Mail nach Ablauf von `retryAfterMs` erneut ausgeben.
- Stats enthalten Fehlerzaehler, Chunk-Informationen und Fehlermeldung.

## 9. Skalierbarkeitsregeln fuer grosse Postfaecher

`imap-email in`:

- Kein unbounded Mailbox-Scan.
- Kein mailboxweites IMAP `SEARCH`.
- In der Standardstrategie pro Trigger nur ein bounded Cursor-Fenster.
- In der Strategie `new-uid-priority` duerfen pro Trigger mehrere bounded
  Fenster nacheinander gelesen werden. Die Warm-up-Phase wird durch
  `scanTimeLimitMs` begrenzt; im laufenden Betrieb werden hoechstens ein
  New-UID-Fenster und ein Bestandsfenster gelesen.
- `frontWindowSize` bleibt die harte Obergrenze fuer ein einzelnes gelesenes
  Fenster. Im laufenden `new-uid-priority`-Betrieb wird es auf New-UID- und
  Bestandsfenster aufgeteilt.
- Der interne Scan-Cursor wrappt am Mailbox-Ende auf `1` und wird bei
  UIDVALIDITY-Wechsel zurueckgesetzt.
- `batchSize` begrenzt die Ausgabe.
- `maxInflight` begrenzt die Anzahl aktiver nicht abgeschlossener Nachrichten.
- Selektive Filter koennen dazu fuehren, dass weniger Nachrichten als
  `batchSize` ausgegeben werden.

`imap-email ack`:

- `batchSize` begrenzt eingehende ACK-Items bis zum Flush.
- `maxBatchesPerFlush` begrenzt Arbeit pro Flush.
- `maxUidPerCommand` begrenzt UID-Mengen pro IMAP-Kommando.
- Gruppierung nach Action-Plan verhindert gemischte Aktionen in einem
  unklaren IMAP-Kommando.
- Chunk-Erfolge und Chunk-Fehler werden getrennt behandelt. Innerhalb eines
  fehlgeschlagenen Chunks wird nicht weiter auf einzelne UIDs heruntergebrochen.

Empfohlene Defaults bleiben:

```text
imap-email in:
  batchSize:        50
  frontWindowSize:  500
  maxInflight:      500
  retryAfterMs:     1800000
  scanStrategy:     cursor-window
  scanTimeLimitMs:  10000
  maxUidPerCommand: 500

imap-email ack:
  batchSize:        100
  flushMs:          500
  maxUidPerCommand: 500
  maxBatchesPerFlush: 20
```

## 10. Testplan

### 10.1 `imap-email in`

- Defaults entsprechen altem `skipDeleted=true`.
- Legacy `skipDeleted=true` wird zu `deletedSelection=exclude`.
- Legacy `skipDeleted=false` wird zu `deletedSelection=ignore`.
- `deleted`, `seen`, `answered`, `flagged` jeweils mit `ignore`, `require`,
  `exclude`.
- Kombination mehrerer Flag-Filter.
- Filterung erfolgt nach Cursor-Fetch und vor Full-Fetch.
- Full-Fetch prueft Flags erneut.
- In `cursor-window` loesen selektive Filter kein weiteres Fenster im selben
  Trigger aus.
- In `new-uid-priority` aktualisiert die Warm-up-Phase den Status nach jedem
  gelesenen Fenster und respektiert `scanTimeLimitMs`.
- In `new-uid-priority` halten Warm-up- und Bestandsfenster den Cursor bei
  Kandidatenueberlauf auf dem Fensteranfang.
- In `new-uid-priority` werden neue UIDs vor dem Bestandsfenster ausgegeben.
- In `new-uid-priority` teilt der laufende Betrieb `frontWindowSize` auf New-
  UID- und Bestandsfenster auf.
- Der interne Cursor liest pro Standard-Trigger hoechstens `frontWindowSize`
  Nachrichten.
- Der interne Cursor wrappt am Mailbox-Ende.
- Der interne Cursor resetet bei UIDVALIDITY-Wechsel.
- Mock-Client stellt sicher, dass kein `SEARCH` ausgefuehrt wird.
- Stats enthalten `selection`, `filteredByFlags` und Cursor-Felder.
- HTML defaults, labels und help text sind konsistent.

### 10.2 `imap-email ack`

- Default-Modus `delete` verhaelt sich wie bisheriges ACK.
- `move` ruft Zielordner-Erstellung und `messageMove`.
- `flag` ruft `messageFlagsAdd` und `messageFlagsRemove`.
- `delete` und `move` koennen nicht mit Flag-Aenderungen kombiniert werden.
- Ungueltige Kombinationen werden abgelehnt.
- `set by msg.` liest Aktion und Flags aus der konfigurierten
  Message-Property.
- Ungueltiges Message-Action-Objekt geht auf Output 2.
- UIDVALIDITY mismatch geht auf Output 2.
- IMAP-Fehler bei Flags, Move oder Delete entfernt Inflight nicht.
- Grosse UID-Mengen werden gechunkt.
- Erfolgreiche Chunks entfernen Inflight und gehen auf Output 1.
- Fehlgeschlagene Chunks behalten Inflight und gehen auf Output 2.
- Mehrere unterschiedlich konfigurierte `imap-email ack` Nodes koennen gleiche
  Tokenformen verarbeiten.
- Stats enthalten Action-Plan, Chunk-Details, Erfolgszaehler, Fehlerzaehler
  und Timings.

### 10.3 Dokumentation und Packaging

- README beschreibt neue Selection-Optionen.
- README beschreibt Ack-Modi und Message-Action-Objekt.
- Node-RED Help-Texte beschreiben UI, Outputs und Warnungen.
- Beispiel-Flows enthalten keine Credentials.
- `npm test` und `npm run pack:check` muessen erfolgreich sein.

## 11. Entschiedene Folgefragen

- Der Scan-Cursor bleibt volatil. Nach einem Node-RED-Neustart beginnt der
  Cursor wieder bei Sequenz `1`.
- `msg.imap.flags` bleibt als vollstaendiges Array der IMAP-Flags erhalten.
  Zusaetzlich wird `msg.imap.flagState` als Convenience-Objekt mit `deleted`,
  `seen`, `answered` und `flagged` vorgesehen.
- `set by msg.` liest fest `msg.imap.ackAction`. Der Property-Pfad wird nicht
  konfigurierbar gemacht.
- `Expunge window` und `Expunge limit` werden in der UI nur angezeigt, wenn
  `Deleted = Only without flag` gesetzt ist. Runtime-seitig bleibt Expunge auf
  `deletedSelection=exclude` beschraenkt.
- Es gibt keine externe JSON-Schema-Validierung fuer dynamische
  Message-Actions in Version 0.1. `msg.imap.ackAction` wird durch den internen
  Normalizer validiert.
