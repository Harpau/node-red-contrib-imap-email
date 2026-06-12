# Installation und lokaler Test

Diese Anleitung gilt fuer das neue eigenstaendige Paket `@compeso/node-red-contrib-imap-email`.

## 1. Paketordner

Arbeite im neuen Repository:

```powershell
C:\Users\<dein-user>\src\node-red-contrib-imap-email
```

Das alte Repository `node-red-contrib-imap-queue` bleibt unveraendert.

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

Danach den Config-Node `imap email account` oeffnen und Benutzername sowie Passwort eintragen.
Die sichtbaren Palette-Namen verwenden Leerzeichen; in der Flow-JSON werden die technischen Typen mit `imap-email ...` gespeichert.

## 7. Produktiver Minimal-Flow

```text
Inject / Scheduler / HTTP-Trigger
  -> imap-email in
      -> erfolgreiche Verarbeitung
          -> imap-email ack
```

Nur der erfolgreiche Verarbeitungspfad darf zum ACK-Node fuehren. Wenn die Verarbeitung fehlschlaegt und kein ACK erfolgt, bleibt die Mail in der Mailbox und kann spaeter erneut geliefert werden.

## 8. Node-RED-Typen

Dieses Paket registriert nur die neuen Typen:

```text
imap-email account
imap-email in
imap-email ack
```

Die Palette-Labels duerfen weiterhin als `imap email account`, `imap email in`
und `imap email ack` angezeigt werden.

Die alten Typen aus `@compeso/node-red-contrib-imap-queue` werden hier nicht registriert:

```text
imap queue account
imap queue in
imap queue ack
imap queue nack
```

## 9. Migration

Bestehende Flow-JSONs aus dem alten Paket muessen mindestens diese Typen umstellen:

```text
imap queue account -> imap-email account
imap queue in      -> imap-email in
imap queue ack     -> imap-email ack
```

Flows mit `imap queue nack` benoetigen eine spaetere fachliche Migration auf die geplanten Abschlussaktionen von `imap-email ack`.
Fruehe Entwicklungsflows mit `imap email ...` als gespeichertem Typ muessen auf
`imap-email ...` aktualisiert werden.

## 10. Keine Veroeffentlichung ohne Freigabe

Dieses Paket darf nicht auf npm oder flows.nodered.org veroeffentlicht werden, solange keine ausdrueckliche menschliche Freigabe vorliegt.
