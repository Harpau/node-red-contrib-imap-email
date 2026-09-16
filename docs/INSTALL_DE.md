# Installation und lokaler Test

Diese Anleitung gilt fuer das eigenstaendige Paket `@compeso/node-red-contrib-imap-email`.

## Voraussetzungen

- Node.js `>=22.0.0`
- Node-RED `>=4.0.0`

Node-RED 5 kann selbst ein hoeheres Node.js-Patchlevel verlangen als dieses
Paket. Pruefe beim Upgrade von Node-RED zusaetzlich die Runtime-Anforderung von
Node-RED.

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
npm audit --omit=dev
npm test
npm run pack:check
```

## 3. Installation in Node-RED aus npm Registry

Im Node-RED User-Verzeichnis:

```powershell
cd $env:USERPROFILE\.node-red
npm install @compeso/node-red-contrib-imap-email
```

Danach Node-RED neu starten.

## 4. GitHub-Repository

Das Repository ist:

```text
Owner: Harpau
Repository name: node-red-contrib-imap-email
URL: https://github.com/Harpau/node-red-contrib-imap-email
```

## 5. Installation in Node-RED aus GitHub fuer Entwicklung

Im Node-RED User-Verzeichnis:

```powershell
cd $env:USERPROFILE\.node-red
npm install github:Harpau/node-red-contrib-imap-email
```

Danach Node-RED neu starten.

## 6. Lokale Entwicklung mit npm link

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

## 7. Beispiel-Flow

In Node-RED:

```text
Menu -> Import -> examples/basic-at-least-once-flow.json
```

Danach den Config-Node `imap email account` oeffnen und Benutzername sowie Passwort eintragen. Der Beispiel-Tab ist absichtlich deaktiviert, der Inject-Node startet nicht automatisch und der ACK-Pfad markiert Nachrichten nur als gesehen.
Die sichtbaren Palette-Namen verwenden Leerzeichen; in der Flow-JSON werden die gespeicherten technischen Typen mit `imap-email ...` gespeichert.

Die unveroeffentlichte Startpruefung fuer den geplanten Release `1.1.0` beginnt
erst mit aktiven Input-/ACK-Nodes. Nach dem Aktivieren und Deploy erscheint
`checking connection`, danach `connected` oder ein konkreter Fehlerstatus.
Ein Inject ist fuer die Pruefung nicht erforderlich. `connected` beschreibt
die letzte erfolgreiche Pruefung; ihre kurzlebige Verbindung ist danach
geschlossen. Das gesamte Zeitlimit betraegt 30 Sekunden, kuerzere konfigurierte
Account-Zeitlimits gelten weiterhin. Das veroeffentlichte `1.0.1` enthaelt diese
Startpruefung noch nicht.

## 8. Produktiver Minimal-Flow

```text
Inject / Scheduler / HTTP-Trigger
  -> imap-email in
      -> erfolgreiche Verarbeitung
          -> imap-email ack
```

Nur der erfolgreiche Verarbeitungspfad darf zum ACK-Node fuehren. Wenn die Verarbeitung fehlschlaegt und kein ACK erfolgt, bleibt die Mail in der Mailbox und kann spaeter erneut geliefert werden.

## 9. Node-RED-Typen

Dieses Paket registriert diese Node-RED-Typen:

```text
imap-email account
imap-email in
imap-email ack
```

Die Palette-Labels werden als `imap email account`, `imap email in`
und `imap email ack` angezeigt.

## 10. Keine Veroeffentlichung ohne Freigabe

Dieses Paket darf nicht auf npm oder flows.nodered.org veroeffentlicht werden, solange keine ausdrueckliche menschliche Freigabe vorliegt.

Fuer Release-Pruefungen einen frischen Tarball in einer isolierten
Node-RED-Testinstanz verwenden. Die verbindliche Deploy-/Credential-/Subflow-Matrix,
strikte Installationspruefungen auf Node.js 22.0.0 und der zusaetzliche externe
Provider-Test stehen in [RELEASE_DE.md](RELEASE_DE.md). Ein Test per `npm link`
ersetzt den abschliessenden Tarballtest nicht.
