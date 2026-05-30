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
npm install C:\Pfad\zu\compeso-node-red-contrib-imap-queue-0.1.0.tgz
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
imap queue in
  -> deine Verarbeitung
      -> imap queue ack
```

Nur der erfolgreiche Verarbeitungspfad darf zum ACK-Node führen.

