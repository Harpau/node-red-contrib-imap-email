# Release-Checkliste

Diese Checkliste beschreibt die lokale Pruefung fuer `@compeso/node-red-contrib-imap-email`.

Wichtig: Diese Datei bereitet keine Veroeffentlichung vor. Ein `npm publish` oder eine Veroeffentlichung auf flows.nodered.org darf nur nach ausdruecklicher menschlicher Freigabe erfolgen.

## 1. Vorbedingungen

- Der Stand ist in einem sauberen Git-Working-Tree.
- `package.json` zeigt auf `@compeso/node-red-contrib-imap-email`.
- Repository, Homepage und Issues zeigen auf `https://github.com/Harpau/node-red-contrib-imap-email`.
- Die Node-RED-Typen sind `imap email account`, `imap email in` und `imap email ack`.
- README, Beispiele und Node-RED-Hilfetexte sind konsistent.

## 2. Lokale Pruefung

```bash
npm install --no-audit --no-fund
npm test
npm run pack:check
```

Erwartung fuer die Tests:

```text
# fail 0
```

`npm run pack:check` sollte die geplanten Paketdateien zeigen, insbesondere:

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

## 3. Installation in Node-RED testen

In einem Node-RED-User-Verzeichnis:

```bash
cd ~/.node-red
npm install github:Harpau/node-red-contrib-imap-email
```

Danach Node-RED neu starten und den Beispiel-Flow importieren.

## 4. Tarball lokal testen

```bash
npm pack
cd ~/.node-red
npm install /path/to/compeso-node-red-contrib-imap-email-0.1.0.tgz
```

Danach Node-RED neu starten.

## 5. Vor einer spaeteren Veroeffentlichung

- Lokalen Node-RED-Test mit einem dedizierten Testpostfach durchfuehren.
- ACK-Loeschverhalten gegen das Testpostfach pruefen.
- README, Beispiele und Hilfetexte auf alte oeffentliche Typnamen pruefen.
- Sicherstellen, dass keine Zugangsdaten, Tokens oder privaten Endpunkte enthalten sind.
- Erst danach eine Version und einen Release-Commit planen.
