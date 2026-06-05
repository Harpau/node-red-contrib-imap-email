# Change-Request-Template

Dieses Template eignet sich für GitHub Issues, neue Chat-Aufgaben oder Codex-Aufgaben.

## Kurzbeschreibung

Was soll geändert oder behoben werden?

```text
...
```

## Betroffener Node

- [ ] imap queue account
- [ ] imap queue in
- [ ] imap queue ack
- [ ] imap queue nack
- [ ] README / Dokumentation
- [ ] Beispiel-Flow
- [ ] Tests / CI
- [ ] Paketierung / Release

## Aktuelles Verhalten

```text
...
```

## Erwartetes Verhalten

```text
...
```

## Reproduktion

Node-RED-Version:

```text
...
```

Node.js-Version:

```text
...
```

Paketversion:

```text
...
```

IMAP-Anbieter:

```text
...
```

Flow-Ausschnitt ohne Credentials:

```json
...
```

Fehlermeldung / Debug-Ausgabe:

```text
...
```

## Akzeptanzkriterien

- [ ] Keine unbounded IMAP-Operationen.
- [ ] At-least-once-Semantik bleibt erhalten.
- [ ] Keine Secrets im Log.
- [ ] Message-Shape bleibt kompatibel, falls kein Major Release geplant ist.
- [ ] README aktualisiert, falls nutzer-sichtbar.
- [ ] Node-RED-Hilfetexte aktualisiert, falls nutzer-sichtbar.
- [ ] Beispiel-Flow aktualisiert, falls relevant.
- [ ] CHANGELOG aktualisiert.
- [ ] Tests ergänzt/angepasst.
- [ ] `npm test` grün.
- [ ] `npm pack --dry-run` plausibel.

## Versionsentscheidung

- [ ] Patch, z. B. `1.0.1`: Bugfix ohne API-Änderung.
- [ ] Minor, z. B. `1.1.0`: kompatibles neues Feature.
- [ ] Major, z. B. `2.0.0`: Breaking Change.

## Release-Notiz-Entwurf

```markdown
### Fixed / Changed / Added

- ...
```
