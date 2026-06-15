# Maintainer-Briefing: @compeso/node-red-contrib-imap-email

Stand: Entwicklungsfassung 0.1.0

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
Node.js:        >=18.0.0
Node-RED:       >=3.0.0
Lizenz:         MIT
Startversion:   0.1.0
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

- `delete` nur mit `UIDPLUS`
- `move` nur mit nativer `MOVE`-Capability
- `copy` behaelt die Quellmail und setzt Flags vor dem Kopieren
- `false` oder `undefined` aus ImapFlow-Aktionen gilt als Fehler
- Partial-Fehler duerfen nicht als Erfolg bestaetigt werden

## 5. Kritische Invarianten

1. Keine unbounded IMAP-Operationen ueber grosse Mailboxen.
2. Keine mailboxweite Suche, um Batch-Groessen aufzufuellen.
3. At-least-once bleibt wichtiger als genau-einmal.
4. Eine Nachricht darf erneut erscheinen, wenn kein erfolgreicher ACK erfolgt.
5. ACK entfernt Inflight nur nach bestaetigtem Erfolg.
6. Unsichere IMAP-Fallbacks werden abgelehnt.
7. Kein persistenter lokaler Status als Pflichtbestandteil.
8. Keine Secrets oder sensiblen Mail-Inhalte loggen.
9. Node.js 18 bleibt installierbar, bis eine Major-Entscheidung getroffen wird.
10. README, Hilfetexte, Beispiele und Tests bleiben konsistent.

## 6. Lokale Validierung

Vor groesseren Abschluessen:

```bash
npm install
npm test
npm run pack:check
```

Ergaenzend sinnvoll:

```bash
git diff --check
rg "alte Paket- oder Node-Namen" .github README.md docs nodes test
```

## 7. Release-Hinweise

Die Entwicklungsfassung startet bei `0.1.0`. Eine oeffentliche `1.0.0` sollte
erst vorbereitet werden, wenn mindestens diese Punkte erledigt sind:

- lokaler Node-RED-Test mit realem Testpostfach
- Installationspruefung aus Tarball oder GitHub
- README, Beispiele, Hilfetexte und Release-Doku final konsistent
- CI gruen fuer Node.js 18 und aktuelle LTS-Versionen
- keine privaten Daten in Beispielen, Tests oder Dokumentation
