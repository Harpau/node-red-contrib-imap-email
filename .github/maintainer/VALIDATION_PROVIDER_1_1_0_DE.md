# Provider-Abnahme des unveröffentlichten Kandidaten 1.1.0

Am **16. September 2026** wurde der Kandidat auf der vom Maintainer bereitgestellten
lokalen Node-RED-Testinstallation mit dem eingerichteten echten IMAP-Testkonto
geprüft. Die unten beschriebenen Provider-Fälle sind erfolgreich abgeschlossen.
Eine Veröffentlichung oder Freigabe für Push, Merge oder Release ist damit
nicht verbunden.

## Geprüfter Stand

| Eigenschaft | Nachweis |
| --- | --- |
| Paket | `@compeso/node-red-contrib-imap-email@1.1.0`, unveröffentlicht |
| Paket-/Dokumentationsstand vor dieser Abnahme | Commit `7f4c3d9`; Laufzeit unverändert seit `021c331` |
| Tarball | `compeso-node-red-contrib-imap-email-1.1.0.tgz` |
| SHA-256 | `67128cd4d8ef5ed6f0d44915acae17476eb20129514e45fdeb8f40da4b8017b2` |
| Tatsächliche Testinstanz | Node-RED `5.0.7`, Node.js `22.14.0`, lokales Node-RED-Benutzerverzeichnis |
| Installation | Alle 24 installierten Paketdateien bytegleich zum Tarball; alle drei öffentlichen Node-Typen als Version `1.1.0` geladen und aktiviert |
| Verbindung | Passwortanmeldung, TLS und Zertifikatsprüfung aktiv; Server unterstützt `UIDPLUS` und `MOVE` |

Runtimeversionen wurden über die laufende Admin-API und das Startprotokoll
geprüft. Die gesamte vorherige Installation wurde vor dem Update gesichert.
Der Kandidat bleibt nach dem Test in der laufenden Testinstanz installiert.
Paketdateien wurden während dieser Abnahme nicht geändert oder neu gepackt.

## Umfang und Ergebnisse

Ein separater temporärer Flow verwendete eine Kopie des bestehenden IMAP-Kontos.
Nur diese Kopie erhielt absichtlich ungültige beziehungsweise leere Credentials.
Das ursprüngliche Konto blieb unverändert. Pro Testlauf entstanden sechs neue
Unterordner unter einem eindeutig benannten neuen Elternordner sowie fünf
synthetische Nachrichten. Die Nachrichten wurden per IMAP APPEND angelegt;
es wurden keine E-Mails an Empfänger versendet.

Alle Abrufe waren auf diese Testordner begrenzt: Batchgröße 1, Frontfenster 5,
maximal 1 Inflight-Nachricht und 1 UID pro Kommando, automatische
Fensterbereinigung aus. Vor einem ACK mussten Betreff, synthetischer Inhalt,
Account-ID und Testordner passen. Bestehende Postfachnachrichten waren kein
Bestandteil des Tests.

| Prüffall | Ergebnis |
| --- | --- |
| Vollständiger Deploy ohne Inject | Alle acht Test-Nodes zeigen `checking connection` → `connected` |
| Ein absichtlich falsches Passwort, Modified Nodes | Alle Verbraucher der Kontokopie zeigen `authentication failed`; nach Rücksetzen wieder `connected` |
| Fehlende Credentials, Modified Flows | `missing credentials`; nach Wiederherstellung wieder `connected` |
| Unverändertes gespeichertes Passwort | Übergabe des Node-RED-Platzhalters erhält das Passwort; Probe erfolgreich |
| Änderung eines Input-Nodes, Modified Nodes | Nur der geänderte Input startet neu und prüft; andere Test-Nodes bleiben ohne neue Statusereignisse |
| Änderung desselben Inputs, Modified Flows | Input und verbundener ACK prüfen erneut; die sechs Nodes der anderen drei Pfade bleiben unverändert |
| Startprüfung ohne fachliche Verarbeitung | Ausschließlich Statusereignisse; keine Mail-, Fehler- oder Statistiknachrichten |
| Empfang | Alle vier regulären synthetischen Nachrichten mit korrektem Inhalt und UID ausgegeben |
| ACK `flag` | Erfolgreicher Abschluss; `Seen` und `Flagged` am Server gesetzt, zuvor gesetztes `Answered` entfernt |
| ACK `copy` | Erfolgreicher Abschluss; ursprüngliche Nachricht erhalten und dieselbe Message-ID im vorgesehenen neuen Zielordner |
| ACK `move` | Erfolgreicher Abschluss; Quell-UID nicht mehr vorhanden, dieselbe Message-ID im vorgesehenen neuen Zielordner |
| ACK `delete` | Erfolgreicher Abschluss; Ziel-UID nicht mehr vorhanden; eine zusätzliche bereits mit `Deleted` markierte Kontrollnachricht bleibt erhalten |

ACK-Erfolg wurde sowohl über `ok:true` / `completed:true` als auch über den
tatsächlichen IMAP-Serverzustand geprüft. Prüfkommandos mussten bestätigte
Serverantworten liefern. Nach jedem ACK war die Warteschlange leer.

## Zwei Prüfläufe und korrigierte Testerwartung

Der erste Lauf bestätigte die Credential-Fälle und den Modified-Nodes-Test,
endete danach aber mit einem Timeout im Prüfskript: Es erwartete bei einem
Modified-Flows-Deploy fälschlich neue Statusmeldungen aller acht Test-Nodes.
Node-RED startet hier nur das zusammenhängende geänderte Flow-Segment neu,
also den betroffenen Input und dessen ACK. Die anderen drei Pfade sind nicht
mit diesem Segment verdrahtet.

Ein unabhängiger Agent reproduzierte genau diese Folge mit Node-RED `5.0.7`,
dem installierten Paket und einem ausschließlich lokalen synthetischen
IMAP-Server. Dabei blieben die sechs übrigen Node-Instanzen sowie das Konto
erhalten; pro Deploy entstand eine Probe. Es war keine Änderung am Paketcode
erforderlich.

Der zweite Provider-Lauf bestand mit der korrigierten Erwartung sämtliche
Deploy- und Verarbeitungsschritte. Die bereits belegten negativen
Credential-Fälle wurden nicht wiederholt. Die Abnahme stützt sich auf die
erfolgreichen Credential-Nachweise des ersten und die erfolgreichen Deploy-/
ACK-Nachweise des zweiten Laufs; der erste Gesamtlauf wird nicht als bestanden
gewertet.

## Wiederherstellung und unabhängige Prüfung

In beiden Läufen wurde der temporäre Flow entfernt. Die ursprünglichen
28 Flow-Einträge sind danach inhaltlich identisch, und die Credentials des
ursprünglichen IMAP-Kontos sind unverändert. Dies ist keine Behauptung über
Byteidentität der neu verschlüsselten globalen Credentialdatei oder über
unveränderte flüchtige Laufzeitzustände nach einem Deploy.

Vor dem Entfernen jedes neuen Testordners wurden Anzahl und Message-IDs der
verbliebenen Nachrichten kontrolliert. Für jeden der sieben angelegten Ordner
wurden `UNSUBSCRIBE` und `DELETE` erfolgreich bestätigt. Die temporäre lokale
HTTP-Testroute ist anschließend nicht mehr vorhanden. Runtimeprotokoll und
bereinigte Ergebnisdateien enthalten keine verwendeten Zugangsdaten oder den
IMAP-Endpunkt.

Ein weiterer unabhängiger Agent prüfte Prüflogik, Ergebnisdateien und
Wiederherstellung. Es blieben keine Blocker für die oben beschriebenen Fälle.
Lokale Roh-Nachweise liegen im privaten Sicherungsverzeichnis, insbesondere
`provider-acceptance-initial.json`, `provider-acceptance.json` und
`provider-installation-verification.json`; sie werden nicht mit dem Paket
ausgeliefert. Die vorherigen automatischen Prüfungen bleiben im
[RC-Prüfprotokoll](VALIDATION_1_1_0_RC_DE.md) nachvollziehbar.

Nach der Provider-Abnahme wurden die vorgeschriebenen Repository-Prüfungen
erneut ausgeführt: `npm install --engine-strict` erfolgreich und Audit ohne
Befund, `npm test` mit 267/267 bestandenen Tests sowie `npm run pack:check`
mit 24 Paketdateien. Auch `git diff --check` und der erneute Dateivergleich
zum unveränderten Kandidaten waren erfolgreich.

## Grenzen und nächste Schritte

- Dies war eine Funktionsabnahme mit jeweils einer Nachricht pro ACK-Aktion,
  kein Lasttest oder umfassender Provider-Fehlerfalltest. Weitere Mailanbieter
  und OAuth wurden hier nicht geprüft.
- Aktuelle GitHub-Actions-Läufe auf dem finalen Stand stehen noch aus.
  Dafür folgen nach gesonderter Freigabe Push und PR.
- Vor einem öffentlichen Release müssen Kandidatenhinweise und Release-Datum
  abgeglichen werden. Ändert sich der Paketinhalt, sind ein neuer Tarball und
  passende Prüfungen erforderlich. Merge, Tag, npm-Veröffentlichung und
  Aktualisierung des Node-RED-Katalogs bleiben gesondert freizugeben.
