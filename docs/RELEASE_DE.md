# Release-Checkliste

Diese Checkliste beschreibt den empfohlenen Weg, um einen Release-Kandidaten oder eine stabile Version von `@compeso/node-red-contrib-imap-queue` zu veroeffentlichen.

## 1. Vorbedingungen

- Der aktuelle Stand ist in einem sauberen Git-Working-Tree.
- Der Live-Test gegen das Ziel-IMAP-System ist erfolgreich.
- GitHub Actions ist gruen.
- `README.md`, `CHANGELOG.md` und die Node-RED-Hilfetexte sind aktuell.

## 2. Lokale Pruefung

```bash
npm install --no-audit --no-fund
npm test
npm pack --dry-run
npm pack
```

Erwartung:

```text
# fail 0
```

`npm pack --dry-run` sollte nur die geplanten Paketdateien zeigen, insbesondere:

```text
nodes/
lib/
examples/
docs/
README.md
CHANGELOG.md
LICENSE
package.json
```

## 3. Git committen und taggen

Fuer den Release-Kandidaten:

```bash
git add .
git commit -m "Prepare release candidate 0.9.0"
git tag v0.9.0
git push
git push --tags
```

Fuer die spaetere stabile Version:

```bash
npm version 1.0.0 --no-git-tag-version
npm test
git add .
git commit -m "Release 1.0.0"
git tag v1.0.0
git push
git push --tags
```

## 4. Installation aus GitHub testen

In einem Node-RED-User-Verzeichnis:

```bash
cd ~/.node-red
npm uninstall @compeso/node-red-contrib-imap-queue
npm install github:compeso/node-red-contrib-imap-queue#v0.9.0
```

Danach Node-RED neu starten und den Beispiel-Flow importieren.

## 5. Installation aus dem Tarball testen

```bash
cd ~/.node-red
npm uninstall @compeso/node-red-contrib-imap-queue
npm install /path/to/compeso-node-red-contrib-imap-queue-0.9.0.tgz
```

Danach Node-RED neu starten.

## 6. npm-Veroeffentlichung

Das Paket ist ein scoped package. `package.json` enthaelt deshalb:

```json
"publishConfig": {
  "access": "public"
}
```

Fuer einen Release-Kandidaten kann ein nicht-default dist-tag verwendet werden:

```bash
npm publish --tag rc
```

Fuer die spaetere stabile Version:

```bash
npm publish
```

Wenn das Paket noch nicht auf npm veroeffentlicht werden soll, reicht die Installation aus GitHub oder aus dem erzeugten `.tgz`.

## 7. GitHub Release

Erstelle auf GitHub einen Release fuer den Tag, zum Beispiel `v0.9.0`.

Empfohlene Assets:

```text
compeso-node-red-contrib-imap-queue-0.9.0.tgz
```

Empfohlene Release Notes:

```text
Release candidate before 1.0.0.
No intentional runtime behavior change from 0.5.2.
Includes changelog, release checklist, publishing metadata, and final package checks.
```

## 8. Nach dem Release-Kandidaten

Beobachte mindestens:

- GitHub Actions auf `main` und Tags.
- Installation aus GitHub in einer frischen Node-RED-Umgebung.
- Installation aus dem `.tgz`.
- ACK/NACK-Verhalten gegen ein STRATO-Testpostfach.
- Stats-Ausgaenge bei Rueckstand und Normalbetrieb.

Wenn keine Aenderungen mehr noetig sind, kann der stabile `1.0.0`-Release vorbereitet werden.
