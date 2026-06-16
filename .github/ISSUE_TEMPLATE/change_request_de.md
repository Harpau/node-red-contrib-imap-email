---
name: Change Request
about: Aenderung, Fehler oder Dokumentationsbedarf fuer imap-email beschreiben
title: ""
labels: ""
assignees: ""
---

# Change Request

## Kurzbeschreibung

Was soll geaendert oder behoben werden?

```text
...
```

## Betroffener Bereich

- [ ] `imap-email account`
- [ ] `imap-email in`
- [ ] `imap-email ack`
- [ ] README / Dokumentation
- [ ] Node-RED-Hilfetexte
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

Paketversion oder Commit:

```text
...
```

IMAP-Anbieter / Server:

```text
...
```

Flow-Ausschnitt ohne Credentials:

```json
...
```

Fehlermeldung / Debug-Ausgabe ohne Secrets:

```text
...
```

## Akzeptanzkriterien

- [ ] Keine unbounded IMAP-Operationen ueber grosse Mailboxen.
- [ ] At-least-once-Semantik bleibt erhalten.
- [ ] Erfolgreiche ACKs entstehen nur nach bestaetigter IMAP-Aktion.
- [ ] Keine Credentials, Tokens, Raw-Mails oder Attachments im Log.
- [ ] Node.js `>=22.0.0` und Node-RED `>=4.0.0` bleiben unterstuetzt.
- [ ] README aktualisiert, falls nutzer-sichtbar.
- [ ] Node-RED-Hilfetexte aktualisiert, falls nutzer-sichtbar.
- [ ] Beispiel-Flow aktualisiert, falls relevant.
- [ ] CHANGELOG aktualisiert, falls release-relevant.
- [ ] Tests ergaenzt oder begruendet nicht noetig.
- [ ] `npm test` gruen.
- [ ] `npm run pack:check` plausibel.

## Versionsentscheidung

- [ ] Patch: Bugfix ohne kompatibilitaetsrelevante API-Aenderung.
- [ ] Minor: kompatibles neues Feature.
- [ ] Major: Breaking Change mit Migrationsdokumentation.

## Release-Notiz-Entwurf

```markdown
### Fixed / Changed / Added

- ...
```
