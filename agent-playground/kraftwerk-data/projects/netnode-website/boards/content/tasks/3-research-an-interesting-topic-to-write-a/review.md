# Review: research.md — Themenrecherche netnode.ch

Verdict: approved

Runde 2, geprüft von Rita am 6.11.2026. Alle zehn Befunde aus Runde 1 sind
eingearbeitet, keiner nur halb. Drei Nits bleiben offen — sie gehen an die
Menschen mit, nicht mehr an Nora zurück.

**Für den Menschen im Review in zwei Sätzen:** Das Dossier empfiehlt die
BehiG-Revision als nächstes Thema (Barrierefreiheit soll per 1.1.2027 Pflicht für
private Anbieter werden) und begründet das mit einer echten Lücke im Blog und
einem Beleg, den tatsächlich nur netnode hat — der Accessibility-Audit als
Deployment-Gate. Bevor daraus ein Post wird, sind die sechs Punkte im Abschnitt
«Faktenlage» abzuarbeiten: die Frist steht auf Sekundärquellen und ist
parlamentarisch noch nicht durch, und ob das Thema im Wettbewerb wirklich frei
ist, ist eine offene Frage und kein Befund.

## Runde 1: alle zehn Befunde geschlossen

| # | Befund aus Runde 1 | Status |
|---|---|---|
| 1 | «Das Thema ist frei» nicht belegt | geschlossen — der Satz ist weg, der Wettbewerbs-Absatz sagt jetzt nur, was die Snapshots zeigen («sie sind je eine Seite, die Blogs beider Firmen sind nicht darin»), und die Frage steht als Prüfauftrag in Faktenlage 5 |
| 2 | Falscher Titel des offenen Blog-Tasks | geschlossen — «AI Security, 3 Paragraphen», gegen das Board geprüft, stimmt; Board ist jetzt mitgenannt |
| 3 | «Kein einziges Stück zu Websites bauen und betreiben» | geschlossen — die vier Relaunch-Posts vom 13.7. sind benannt, die Lücke ist auf «kein Post zu Barrierefreiheit und keiner zu einer regulatorischen Pflicht» verengt, «seit 2003» korrigiert, die Snapshot-Einschränkung steht auch in der Prosa |
| 4 | «Drei Posts» zu GEO | geschlossen — ein Post, die drei anderen als Relaunch-Posts gleichen Datums ausgewiesen; Thema 4 nennt den Artikel jetzt im Singular und mit Titel |
| 5 | Sechs Felder nur bei der Empfehlung | geschlossen — Vergleichstabelle mit allen sechs Feldern für alle fünf Themen |
| 6 | «Harte Termine» gegen «Entwurf im Verfahren» | geschlossen — «ein absehbarer und ein gesetzter Termin»; «hart» kommt im Dossier nicht mehr vor |
| 7 | WCAG 2.2 AA / eCH-0059 / EAA nicht in der Faktenlage | geschlossen — Faktenlage 2, mit Prüfauftrag gegen eCH und EBGB |
| 8 | Falsches Snapshot-Datum | geschlossen — 23.9.2026, dazu «je nur die Startseite» |
| 9 | Kaputter Ankerlink | geschlossen — Anker mit ü, zielt auf die Überschrift |
| 10 | Suchlogik ohne Volumendaten | geschlossen — als geschätzt beschriftet, Spaltentitel «Suchlogik (geschätzt)», KI-schlägt-AI-Hinweis dabei |

Die zwei Stellen, die Nora mir vorgelegt hat, sind beide in Ordnung. Die
Vergleichstabelle macht die Shortlist erst vergleichbar und ist dort ehrlich, wo
es wehtut (Thema 4: «eigene Analytics von netnode.ch (noch nicht erhoben)»,
Thema 5: «blockiert, bis das Produktteam liefert»). Faktenlage 5 ist genau die
richtige Umwandlung: aus einem Argument ist ein Auftrag geworden, inklusive der
Beobachtung, dass Liip «Digitale Verantwortung» als eigene Leistung führt und
darum wahrscheinlich dazu publiziert. Das ist stärker als die ursprüngliche
Behauptung, weil es stimmt.

Mechanik nachgezählt: 1981 Wörter, deutsch, kein einziges ß («Grössenordnung»,
«Massnahmen» korrekt), keine Sie-Form, kein Buzzword-Einschlag. Kein fertiger
Blogpost — der letzte Punkt der Fertig-wenn-Liste ist damit auch erfüllt.

## Offene Nits — für den Menschen, nicht mehr für Nora

**A. Der neue Drupal-12-Beleg stimmt zur Hälfte.**

> «netnode.ch selbst läuft auf NodeHive/Drupal, wir machen dieses Upgrade also
> zuerst an uns — und können schreiben, was dabei tatsächlich anfällt.»

Der erste Teil ist belegt: `overview.md` und `stack/cms-nodehive.md` sagen beide,
dass der Content in NodeHive (Drupal) auf netnode.nodehive.app liegt. Der zweite
Teil ist eine Absicht, die so nirgends steht. In der Knowledge ist keine
Drupal-Version dokumentiert — und das ist hier nicht nebensächlich, weil Drupal 12
laut Dossier keine Datenbank-Updates von Installationen unter 11.3.0 annimmt: ob
das Upgrade für netnode ein Schritt oder zwei ist, hängt genau daran. Dazu läuft
der Workspace seit Juni 2026 im Modus «Marketing Operations» (Content zuerst,
Code nur als begleitender Unterhalt, keine grossen Initiativen) — ein
Major-Upgrade ist damit nicht automatisch geplant. Vor dem Schreiben beim
Web-Team zwei Fragen stellen: welche Drupal-Version läuft auf
netnode.nodehive.app, und ist ein Wechsel auf 12 vorgesehen? Fällt die Antwort
anders aus, verliert Thema 2 seinen netnode-Beleg, nicht aber seine Relevanz für
Kundenprojekte.

**B. «Drupal 11 Support-Ende» als Suchbegriff ohne Datum.**

Die Suchlogik von Thema 2 nennt «Drupal 11 Support-Ende», während Faktenlage 3
festhält, dass das EOL-Datum nicht belastbar gefunden wurde. Als Suchbegriff
unbedenklich — sobald daraus im Post eine Jahres- oder Monatsangabe wird, braucht
sie drupal.org.

**C. Der Einleitungssatz der Faktenlage passt nicht mehr auf alle sechs Punkte.**

> «Alles unten steht auf einer Websuche vom 6.11.2026.»

Punkt 5 stammt nicht aus einer Websuche, sondern ist eine Lücke in den internen
Belegen. Ein halber Satz («Punkte 1–4 und 6 stehen auf einer Websuche vom
6.11.2026, Punkt 5 ist eine offene interne Frage») räumt das auf.

## Was stimmt und nicht angetastet werden soll

* «13 der 15 zuletzt publizierten Posts drehen sich um KI» — nachgezählt, stimmt.
* Die vier Relaunch-Posts vom 13.7.2026 und die Zuordnung, welcher davon der
  GEO-Artikel ist — stimmt gegen den Snapshot.
* «Kein Deployment auf Produktion ohne grünen Accessibility-Audit», vor jedem
  Produktions-Push und sonst wöchentlich — so in `overview.md` und
  `operations/routines.md`. Der stärkste Teil der Empfehlung.
* Zielgruppe und das Programm «Website Check» — deckungsgleich mit
  `seo/competitors.md`.
* Die Titel der beiden offenen Blog-Tasks und das Snapshot-Datum 23.9.2026.
* Sprache, Länge, Ton.

Nicht geprüft, weil hier nicht prüfbar: die externen Fakten (BehiG-Frist,
Drupal-12-Termine, AI-Act-Daten, Traffic-Zahlen). Dafür ist der
Faktenlage-Abschnitt da, und er benennt sie vollständig.
