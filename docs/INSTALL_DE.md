# Installation und GitHub-Veröffentlichung

Diese Anleitung beschreibt den Weg von der lokalen Paketversion zu einem GitHub-Repository und zur Installation in Node-RED.

## 1. Lokalen Paketordner entpacken

Lade `compeso-node-red-contrib-imap-queue.zip` herunter und entpacke ihn an einen Arbeitsort, z. B.:

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
npm install C:\Pfad\zu\compeso-node-red-contrib-imap-queue-0.3.1.tgz
```

Danach Node-RED neu starten.

## 7. Beispiel-Flow importieren

In Node-RED:

```text
Menu -> Import -> examples/basic-at-least-once-flow.json
```

Danach den Config-Node `STRATO test` öffnen und Benutzername/Passwort eintragen.

## 8. Produktiver Flow

Minimaler Aufbau:

```text
Inject / Scheduler / HTTP-Trigger
  -> imap queue in
      -> deine Verarbeitung
          -> imap queue ack
```

Nur der erfolgreiche Verarbeitungspfad darf zum ACK-Node führen.



## 9. Hinweis ab Version 0.2.0

Der Node `imap queue in` ruft keine Mails mehr automatisch ab. Er hat einen Eingang und startet genau einen begrenzten Abrufzyklus pro eingehender Message.

Das ist absichtlich so, damit der Mailabruf ausschließlich von deinem Flow gesteuert wird, zum Beispiel über einen Inject-Node, einen Scheduler, einen HTTP-Endpoint oder einen eigenen Backpressure-Mechanismus.

Wenn während eines laufenden Abrufs ein weiterer Trigger eintrifft, wird kein paralleler IMAP-Abruf gestartet. Stattdessen sendet der Node auf Ausgang 3 eine Stats-Meldung mit `payload.skipped = true` und `payload.reason = "already running"`.


## 10. Hinweis ab Version 0.3.0

Der Output des Nodes `imap queue in` wurde bereinigt:

```text
msg.html             entfällt
msg.attachments      entfällt
msg.email.subject    heißt jetzt msg.email.topic
msg.email.headers    heißt jetzt msg.email.header
```

Der Top-Level-Wert `msg.topic` bleibt weiterhin der Betreff der Mail. HTML-Body und Attachments liegen nur noch unter `msg.email.html` beziehungsweise `msg.email.attachments`.

## 11. Hinweis ab Version 0.3.1

`imap queue in` behandelt Mails robuster, die zwischen Front-Window-Scan und vollständigem Abruf bereits das IMAP-Flag `\\Deleted` bekommen haben. Solche Mails werden nicht mehr an `mailparser` übergeben und erzeugen dadurch keine Parse-Fehler vom Typ `Input cannot be null or undefined` mehr.

In der Stats-Ausgabe können zusätzlich diese Werte erscheinen:

```text
deletedSkippedDuringFetch
missingSource
```
