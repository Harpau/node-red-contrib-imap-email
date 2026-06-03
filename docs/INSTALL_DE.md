# Installation und GitHub-Veröffentlichung

Diese Anleitung beschreibt den Weg von der lokalen Paketversion zu einem GitHub-Repository und zur Installation in Node-RED.

## 1. Lokalen Paketordner entpacken

Lade das ZIP-Paket herunter und entpacke es an einen Arbeitsort, z. B.:

```powershell
C:\Users\<dein-user>\src\node-red-contrib-imap-queue
```

Im entpackten Ordner muss `package.json` direkt auf oberster Ebene liegen.

## 2. Abhängigkeiten installieren und Tests ausführen

```powershell
cd C:\Users\<dein-user>\src\node-red-contrib-imap-queue
npm install
npm test
```

## 3. GitHub-Repository erstellen

Erstelle auf GitHub ein neues Repository:

```text
Owner: compeso
Repository name: node-red-contrib-imap-queue
```

Danach lokal initialisieren und pushen:

```powershell
git init
git add .
git commit -m "Initial IMAP queue Node-RED nodes"
git branch -M main
git remote add origin https://github.com/compeso/node-red-contrib-imap-queue.git
git push -u origin main
```

Falls du SSH verwendest:

```powershell
git remote add origin git@github.com:compeso/node-red-contrib-imap-queue.git
```

## 4. In Node-RED direkt von GitHub installieren

Im Node-RED User-Verzeichnis:

```powershell
cd $env:USERPROFILE\.node-red
npm install github:compeso/node-red-contrib-imap-queue
```

Danach Node-RED neu starten.

## 5. Lokale Entwicklung mit npm link

Im Paketordner:

```powershell
cd C:\Users\<dein-user>\src\node-red-contrib-imap-queue
npm install
npm link
```

Im Node-RED User-Verzeichnis:

```powershell
cd $env:USERPROFILE\.node-red
npm link @compeso/node-red-contrib-imap-queue
```

Danach Node-RED neu starten.

## 6. Lokales TGZ-Paket installieren

Alternativ kann die erzeugte Tarball-Datei installiert werden:

```powershell
cd $env:USERPROFILE\.node-red
npm install C:\Pfad\zu\compeso-node-red-contrib-imap-queue-0.5.1.tgz
```

Danach Node-RED neu starten.

## 7. Beispiel-Flow importieren

In Node-RED:

```text
Menu -> Import -> examples/basic-at-least-once-flow.json
```

Danach den Config-Node `STRATO test` öffnen und Benutzername/Passwort eintragen.

## 8. Produktiver Minimal-Flow

```text
Inject / Scheduler / HTTP-Trigger
  -> imap queue in
      -> deine erfolgreiche Verarbeitung
          -> imap queue ack
```

Nur der erfolgreiche Verarbeitungspfad darf zum ACK-Node führen. Wenn die Verarbeitung fehlschlägt, bleibt die Mail in der Mailbox und wird später erneut geliefert.

## 9. GitHub Actions / CI

Ab Version `0.5.1` installiert der CI-Workflow die Laufzeit-Abhängigkeiten explizit aus `package.json`, bevor `npm test` ausgeführt wird. Dadurch funktionieren die Smoke-Tests auch in frischen GitHub-Actions-Runnern, in denen `imapflow` und `mailparser` vorher nicht vorhanden sind.

Für die Repository-Version wird kein lokal erzeugtes `package-lock.json` vorausgesetzt. Falls ein altes Lockfile mit privaten Registry-URLs im Repository liegt, sollte es entfernt oder in einer öffentlichen Umgebung neu erzeugt werden.

## 9. Node-Namen ab Version 0.5.0

Ab Version `0.5.0` heißen die Node-RED-Typen ohne Bindestriche:

```text
imap queue account
imap queue in
imap queue ack
imap queue nack
```

Falls vorhandene Flow-JSONs noch alte Typnamen enthalten, müssen diese ersetzt werden:

```text
imap-queue-account -> imap queue account
imap-queue-in      -> imap queue in
imap-queue-ack     -> imap queue ack
imap-queue-nack    -> imap queue nack
```

## 10. Wichtige Einstellungen

Für ein STRATO-Queue-Postfach ist ein sinnvoller Start:

```text
imap queue in:
  Mailbox:          INBOX
  Batch size:       50
  Front window:     500
  Max inflight:     500
  Retry after ms:   1800000
  UIDs/command:     500
  Skip deleted:     true
  Expunge front:    true
  Expunge limit:    200
  Attachments:      false
  Raw source:       false
  Diagnostics:      stats

imap queue ack:
  Batch size:       100
  Flush ms:         500
  UIDs/command:     500
  Batches/flush:    20
  Diagnostics:      stats
```

## 11. Hinweise zur Zustellgarantie

Das Paket ist auf `at least once` ausgelegt:

```text
Mail liegt noch in der Mailbox = noch nicht erfolgreich geACKt
Mail wurde gelöscht           = erfolgreich verarbeitet und geACKt
```

Doppelte Verarbeitung ist möglich, insbesondere nach Neustarts oder ACK-Fehlern. Dafür gehen Mails nicht still verloren, solange sie erst nach erfolgreicher Verarbeitung an `imap queue ack` übergeben werden.
