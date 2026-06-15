# Installation und lokaler Test

Diese Anleitung gilt fuer das eigenstaendige Paket `@compeso/node-red-contrib-imap-email`.

## 1. Paketordner

Arbeite im Repository:

```powershell
C:\Users\<dein-user>\src\node-red-contrib-imap-email
```

## 2. Abhaengigkeiten und Tests

Im Paketordner:

```powershell
cd C:\Users\<dein-user>\src\node-red-contrib-imap-email
npm install
npm test
npm run pack:check
```

## 3. GitHub-Repository

Das neue Repository ist:

```text
Owner: Harpau
Repository name: node-red-contrib-imap-email
URL: https://github.com/Harpau/node-red-contrib-imap-email
```

## 4. Installation in Node-RED aus GitHub

Im Node-RED User-Verzeichnis:

```powershell
cd $env:USERPROFILE\.node-red
npm install github:Harpau/node-red-contrib-imap-email
```

Danach Node-RED neu starten.

## 5. Lokale Entwicklung mit npm link

Im Paketordner:

```powershell
cd C:\Users\<dein-user>\src\node-red-contrib-imap-email
npm install
npm link
```

Im Node-RED User-Verzeichnis:

```powershell
cd $env:USERPROFILE\.node-red
npm link @compeso/node-red-contrib-imap-email
```

Danach Node-RED neu starten.

## 6. Beispiel-Flow

In Node-RED:

```text
Menu -> Import -> examples/basic-at-least-once-flow.json
```

Danach den Config-Node `imap email account` oeffnen und Benutzername sowie Passwort eintragen. Der Beispiel-Tab ist absichtlich deaktiviert, der Inject-Node startet nicht automatisch und der ACK-Pfad markiert Nachrichten nur als gesehen.
Die sichtbaren Palette-Namen verwenden Leerzeichen; in der Flow-JSON werden die gespeicherten technischen Typen mit `imap-email ...` gespeichert.

## 7. Produktiver Minimal-Flow

```text
Inject / Scheduler / HTTP-Trigger
  -> imap-email in
      -> erfolgreiche Verarbeitung
          -> imap-email ack
```

Nur der erfolgreiche Verarbeitungspfad darf zum ACK-Node fuehren. Wenn die Verarbeitung fehlschlaegt und kein ACK erfolgt, bleibt die Mail in der Mailbox und kann spaeter erneut geliefert werden.

## 8. Node-RED-Typen

Dieses Paket registriert diese Node-RED-Typen:

```text
imap-email account
imap-email in
imap-email ack
```

Die Palette-Labels werden als `imap email account`, `imap email in`
und `imap email ack` angezeigt.

## 9. Keine Veroeffentlichung ohne Freigabe

Dieses Paket darf nicht auf npm oder flows.nodered.org veroeffentlicht werden, solange keine ausdrueckliche menschliche Freigabe vorliegt.
