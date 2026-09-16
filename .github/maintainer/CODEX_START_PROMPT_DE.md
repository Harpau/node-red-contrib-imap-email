# Codex-/Chat-Startprompt fuer spaetere Aenderungen

Diesen Prompt zusammen mit dem aktuellen Repository-Stand oder einem
Quellpaket von `@compeso/node-red-contrib-imap-email` verwenden.

---

Du arbeitest an dem Node-RED-Paket
`@compeso/node-red-contrib-imap-email`.

Bitte inspiziere zuerst den aktuellen Stand. Lies mindestens:

- `agents.md`
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `docs/design-decisions-imap-email.md`
- `docs/INSTALL_DE.md`
- `docs/RELEASE_DE.md`
- alle Dateien in `nodes/`
- alle Dateien in `lib/`
- die relevanten Tests in `test/`
- `examples/basic-at-least-once-flow.json`

## Projektkontext

Das Paket registriert genau diese Node-RED-Typen:

```text
imap-email account
imap-email in
imap-email ack
```

Palette-Labels:

```text
imap email account
imap email in
imap email ack
```

Der Eingangsnode wird extern getriggert und liest IMAP-Nachrichten mit einer
bounded front-window Strategie. Erfolgreiche Verarbeitung wird ueber
`imap-email ack` abgeschlossen.

## Nicht verhandelbare Architekturregeln

1. Keine unbounded IMAP-Operationen ueber grosse Mailboxen einfuehren.
   - Kein globales `SEARCH` ueber das gesamte Postfach.
   - Kein unbounded `FETCH 1:*`.
   - Bounded front-window Strategie beibehalten.

2. At-least-once-Semantik beibehalten.
   - Eine Mail darf doppelt verarbeitet werden.
   - Eine Mail darf nicht still verloren gehen.
   - Ohne erfolgreichen ACK bleibt Inflight erhalten. Partielle Serveraenderungen
     koennen die erneute Zustellung verhindern, etwa Loeschung oder `\Deleted`
     bei entsprechendem Eingangsfilter; keinen automatischen Rollback behaupten.

3. ACK-Aktionen fail-closed halten.
   - `delete` braucht `UIDPLUS`.
   - ACK-Loeschung und Input-Expunge nutzen denselben begrenzten Loeschhelfer:
     STORE bestaetigen, Delete-Ergebnis pruefen, denselben UID-Chunk per SEARCH
     auf Rest-UIDs pruefen; nur ein erfolgreiches leeres UID-Array akzeptieren.
     Keine Wildcards/ALL; Verbindung, Mailbox und UIDVALIDITY validieren.
     Pro Aufruf echte OK-Abschluesse ohne Non-OK ueber das oeffentliche
     `response`-Event verlangen; temporaeren Listener immer entfernen.
   - DELETE-Folgefehler nach bestaetigtem STORE sind partiell und stoppen
     weitere ACK-Chunks derselben Gruppe. Partielle oder Verbindungsfehler bei
     Input-Expunge brechen den Abruf ab; unbestaetigte Entfernungen nicht verbuchen.
   - `move` braucht native `MOVE`-Capability.
   - `copy` kopiert zuerst und aendert danach konfigurierte Flags nur auf der Quelle.
   - Partial-Fehler behalten Inflight; ein COPY-Retry kann eine weitere Kopie erzeugen.
   - `false` und `undefined` aus ImapFlow-Aktionen sind Fehler.

4. Kein persistenter lokaler Status als Pflicht.
   - Inflight-Status ist volatil.
   - Die Mailbox bleibt die dauerhafte Quelle der Wahrheit.

5. Keine Credentials oder sensiblen Inhalte loggen.
   - Kein Passwort.
   - Kein Token.
   - Keine Raw-Mail.
   - Keine Attachments.

6. Node.js `>=22.0.0` und Node-RED `>=4.0.0` bleiben unterstuetzt. Neue
   Laufzeit- oder Node-RED-Anforderungen brauchen eine begruendete
   Breaking-Change-Entscheidung.

7. Bei jeder nutzer-sichtbaren Aenderung aktualisieren:
   - README
   - Node-RED-Hilfetexte in den `.html`-Dateien
   - Beispiel-Flow, falls relevant
   - CHANGELOG, falls release-relevant
   - Tests

8. Die Startpruefung ist kurzlebig, auf 30 Sekunden begrenzt und erzeugt keine
   regulaeren Output-/Stats-Nachrichten. Laufende Proben werden pro Account-Instanz
   geteilt. Regulaere Arbeit und ihre Statusanzeigen bleiben unabhaengig;
   spaete Probe-Ergebnisse duerfen sie nach Close/Redeploy nicht ueberschreiben.

## Arbeitsweise

Bitte arbeite in kleinen, nachvollziehbaren Schritten:

1. Problem analysieren.
2. Relevante Dateien nennen.
3. Minimalen Aenderungsplan vorschlagen.
4. Aenderung umsetzen.
5. Tests ergaenzen oder bewusst begruenden, warum keine Tests noetig sind.
6. Validierung ausfuehren.
7. Geaenderte Dateien, technische Wirkung, Tests, Risiken und empfohlenen
   Commit nennen.

## Validierung

Fuer groessere Abschluesse ausfuehren:

```bash
npm install
npm audit --omit=dev
npm test
npm run pack:check
git diff --check
```

Fuer Aenderungen an Abhaengigkeiten und Startpruefung gelten ausserdem die
Bibliotheksvertraege, strikten Minimum-Installationen und echten
Node-RED-Lifecycle-Tests aus `docs/RELEASE_DE.md`. Externer Provider-Test und
aktuelle GitHub-CI-Ergebnisse sind zusaetzliche Release-Voraussetzungen.
Historische Nachweise nicht als neue Testergebnisse ausgeben.

## Aktuelle Aufgabe

```text
[HIER KONKRETE AENDERUNG / BUGBESCHREIBUNG EINFUEGEN]
```

Rahmenbedingungen:

```text
[HIER VERSION, betroffene Nodes, Beispiele, Fehlermeldungen und gewuenschtes Verhalten ergaenzen]
```
