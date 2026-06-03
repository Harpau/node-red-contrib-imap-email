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

Fuer die stabile Version:

```bash
git add .
git commit -m "Release 1.0.0"
git tag v1.0.0
git push
git push --tags
```

Fuer spaetere Patch-Releases entsprechend die Version erhoehen, zum Beispiel `1.0.1`, testen, committen und taggen.

## 4. Installation aus GitHub testen

In einem Node-RED-User-Verzeichnis:

```bash
cd ~/.node-red
npm uninstall @compeso/node-red-contrib-imap-queue
npm install github:compeso/node-red-contrib-imap-queue#v1.0.0
```

Danach Node-RED neu starten und den Beispiel-Flow importieren.

## 5. Installation aus dem Tarball testen

```bash
cd ~/.node-red
npm uninstall @compeso/node-red-contrib-imap-queue
npm install /path/to/compeso-node-red-contrib-imap-queue-1.0.0.tgz
```

Danach Node-RED neu starten.

## 6. npm-Veroeffentlichung

Das Paket ist ein scoped package. `package.json` enthaelt deshalb:

```json
"publishConfig": {
  "access": "public"
}
```

Fuer die stabile Version:

```bash
npm publish
```

Da das Paket scoped ist, muss es oeffentlich veroeffentlicht werden. `package.json` enthaelt dafuer bereits `publishConfig.access = public`.

## 7. GitHub Release

Erstelle auf GitHub einen Release fuer den Tag `v1.0.0`.

Empfohlene Assets:

```text
compeso-node-red-contrib-imap-queue-1.0.0.tgz
```

Empfohlene Release Notes:

```text
First stable public release.
No intentional runtime behavior change from 0.9.0.
Includes externally triggered IMAP front-window queue fetch, at-least-once ACK deletion, optional NACK handling, diagnostics, docs, and examples.
```

## 8. Nach dem Release

Beobachte mindestens:

- GitHub Actions auf `main` und Tags.
- Installation aus GitHub in einer frischen Node-RED-Umgebung.
- Installation aus dem `.tgz`.
- ACK/NACK-Verhalten gegen ein STRATO-Testpostfach.
- Stats-Ausgaenge bei Rueckstand und Normalbetrieb.

Wenn keine Aenderungen mehr noetig sind, bleibt `1.0.0` die stabile Linie. Korrekturen koennen als Patch-Releases, zum Beispiel `1.0.1`, veroeffentlicht werden.
