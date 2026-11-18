# Review draft.md — Agentische Systeme: was sie sind, was sie bringen

Verdict: changes requested

Rita, 7.11.2026, erste Runde. Dies ist meine einzige Rückgabe auf dieser Aufgabe
(Hausregel «eine Runde je Station»). Es geht um **drei Textstellen**, sonst nichts.
Der Rest des Entwurfs ist geprüft und freigegeben, die Liste «Was richtig ist»
weiter unten sagt, was dabei nicht angefasst werden darf. Bitte keinen zweiten
vollständigen Durchgang am ganzen Paket starten.

Meine Fixtexte sind Vorschläge, keine Vorschriften. Wenn du eine bessere Lösung
hast, nimm sie und schreib die Begründung ins Log — auf Task 4 waren zwei deiner
Abweichungen besser als meine Formulierung.

## Was zu ändern ist

### B1 — Die FAQ-Antwort sagt etwas, das das System nicht tut (blockiert)

Zitat, `field_markdown`, Abschnitt «Häufige Fragen»:

> ### Entscheidet die KI dann über Kundenanliegen?
>
> In unserer Helpdesk-Triage nicht. Der Agent schlägt Priorität, Kategorie und Text
> vor, **alles landet als interne Notiz**, und ein Mensch entscheidet, was die Kundin
> liest.

«Alles» stimmt nicht. `scripts/apply.sh` setzt die vorgeschlagene Priorität am
Ticket selbst, ohne Mensch dazwischen:

```
if p["priority_proposed"] != p["priority_current"]:
    my("tickets", "priority", str(tid), p["priority_proposed"], "-w", ws)
```

Als interne Notiz landen die **zwei Texte** (`--internal` bei beiden
`my comments add`), nicht die Priorität. Dein Fliesstext sagt es zwei Abschnitte
weiter oben korrekt («Erst wenn alles passt, setzt ein zweites Skript die
Priorität» und «Beide Texte landen als interne Notiz am Ticket»). Die FAQ-Antwort
widerspricht also dem eigenen Körper.

Das ist deshalb ein Blocker und kein Nit: FAQ-Antworten sind dafür gebaut, allein
zitiert zu werden. Eine Antwortmaschine zitiert genau diese vier Zeilen, ohne den
Fliesstext daneben — und zitiert dann eine Aussage über unser eigenes System, die
falsch ist.

Vorschlag:

> In unserer Helpdesk-Triage nicht. Der Agent schlägt Priorität, Kategorie und zwei
> Texte vor; geprüft wird das von Code, und beide Texte landen als interne Notiz am
> Ticket, nie als Antwort an die Kundin. Was die Kundin liest, entscheidet ein
> Mensch im Support. Automatisch gesetzt wird nur die Priorität, und auch die erst,
> wenn die Prüfung durch ist.

Der letzte Satz ist der ehrlichere und der interessantere: er zeigt die Grenze
genau dort, wo sie wirklich liegt.

### B2 — Zwei erfundene Zahlen in einem Post, der zwei Abschnitte vorher verspricht, keine zu erfinden (blockiert)

Zitat, Beispiel 1, Abschnitt «Vorher»:

> Bei **drei Tickets eine Viertelstunde**, bei **zwanzig der halbe Vormittag**, und die
> Einordnung sieht je nach Person anders aus.

Zwei Aufwandzahlen ohne Quelle im Workspace. Die Fertig-Liste in task.md sagt:
«Jede Zahl, jedes Produktdetail und jede Workflow-Beschreibung im Text hat eine
Quelle im Workspace (Datei + Pfad im Log) oder steht nicht drin.» Ich habe die
17 Läufe von `helpdesk-check` unter `kraftwerk-data/output/runs/` durchgesehen:
die höchste je gefundene Zahl offener Tickets ist **4** (Lauf 2026-08-25-1814-25,
über 75 Workspaces), am 16.9.2026 war es **1**. «Zwanzig» kommt in unseren Daten
nicht vor, und eine Zeitmessung gibt es nirgends.

Dazu kommt der Selbstwiderspruch: der Abschnitt «Woran du den Nutzen merkst»
beginnt mit «Wir messen den Nutzen nicht in Prozent und erfinden auch keine». Zwei
Abschnitte später stehen zwei erfundene Zahlen. Das ist die Stelle, an der ein
skeptischer Entscheider — die Zielgruppe — aussteigt.

Vorschlag:

> Bei drei Tickets ist das eine kurze Runde, bei zwanzig ist der halbe Vormittag
> weg, und die Einordnung sieht je nach Person anders aus.

— oder noch kürzer, ohne jede Mengenangabe:

> Je mehr Tickets über Nacht gekommen sind, desto länger dauert es, und die
> Einordnung sieht je nach Person anders aus.

Zum Vergleich, damit die Linie klar ist und du nicht zu viel streichst: «Einen
Prozess in **zehn Zeilen** aufschreiben … in **einer halben Stunde**» im Abschnitt
«Was du in den nächsten Wochen entscheiden kannst» bleibt stehen. Das ist eine
Empfehlung an die Leserin für ihre eigene Arbeit, keine Behauptung über unseren
Betrieb unter der Überschrift «aus unserem eigenen Betrieb».

### B3 — Der Agent sieht nicht alle Tickets, sondern nur die noch nicht triagierten

Zitat, Beispiel 1, Abschnitt «Heute»:

> Ein Skript holt alle offenen Tickets samt Verlauf. Ein Agent liest **sie** und schlägt
> pro Ticket eine Priorität aus fünf erlaubten Werten vor …

«Sie» verweist auf alle offenen Tickets. `scripts/fetch.sh` filtert vorher:

```
# Tickets that a previous run already triaged (marker comments) are filtered
# out here; todo.json is written ONLY when untriaged tickets remain, so the
# agent step's `if:` skips otherwise.
```

Der Agent liest `todo.json`, also nur die Teilmenge ohne Marker-Kommentar; bereits
triagierte Tickets mit neuer Kundenantwort gehen in `followup.json`, der Rest fällt
raus. Belegt an echten Läufen: am 25.8.2026 waren 4 Tickets offen und 4 «already
triaged» — der Agentenschritt lief gar nicht. Am 16.9.2026 war 1 Ticket offen und
1 «awaiting triage».

Das ist nicht nur Genauigkeit, es ist der bessere Satz: dass das System weiss, was
es schon gemacht hat, ist genau der Unterschied zum Chatfenster.

Vorschlag:

> Ein Skript holt alle offenen Tickets samt Verlauf und legt die beiseite, die ein
> früherer Lauf schon triagiert hat. Ein Agent liest die übrigen und schlägt pro
> Ticket eine Priorität aus fünf erlaubten Werten vor …

## Nits — ändern, wenn du ohnehin in der Datei bist

Keiner davon blockiert. Wer sie schliesst, steht dabei.

| # | Stelle | Befund | Wer / wann |
|---|---|---|---|
| N1 | Körper, erster Absatz + Lead | Die Definition steht dreimal in den ersten rund 120 Wörtern: im Lead, im Körperanfang, im ersten Absatz von «Chatbot, Agent, agentisches System». Dazu zählt die Erklärung vier Absätze, task.md erlaubt «höchstens drei». Ein Schnitt löst beides. | Nora, jetzt |
| N2 | Dateikopf | «alles zwischen den beiden Trennlinien unten» — es gibt **drei** `---`-Zeilen (Zeilen 21, 215 und 226). Für den CMS-Schritt eindeutig machen: «von Zeile 22 bis vor die erste `---` nach dem FAQ-Block». | Nora, jetzt |
| N3 | Redaktionskette, «Wo der Mensch entscheidet» | «Lesbarkeit gegen Länge» benennt den Zielkonflikt schief: die Ziele der beiden Rollen sind Findbarkeit (Sven) und Leser (Rita), die Länge ist der Streitpunkt. Vorschlag: «Findbarkeit gegen Lesbarkeit zum Beispiel». | Nora, jetzt |
| N4 | «93 Logzeilen» | Stimmt heute exakt (siehe unten), kann aber wachsen: Task 4 liegt in Review, und wenn ein Mensch ihn zurückgibt, kommen Logzeilen dazu. Vor der Publikation nachzählen. | CMS-Schritt, Liste unten |
| N5 | «Zwei Seiten beobachten wir heute so» | Zwei Seiten stimmen. Der letzte echte Lauf von `competitor-watch` war aber am 23.9.2026, brief.md sagt «reviewed weekly». Der Satz steht im Präsens. Entweder vor der Publikation einen Lauf machen oder den Satz nicht ändern und das Risiko bewusst tragen. | CMS-Schritt, Liste unten |
| N6 | kraftwerk-Abschnitt | Der verlinkte Post sagt «Eine Installation im Projekt braucht es nicht: npx genügt» und nennt kraftwerk ein «Open-Source-Framework»; dieser Post sagt `npm install -g` und «agentischer Workspace». Deine Entscheidung für task.md ist richtig (jüngere Anweisung), der Widerspruch bleibt aber einen Klick entfernt. | Web, eigener Auftrag: den alten Post nachziehen |

## Eine Korrektur am Protokoll, keine am Text

Deine Logzeile sagt «8-mal du, 1-mal dein, null Sie oder Ihr im Körper **und im
Lead**». Im Körper habe ich dasselbe gezählt: 8 `du`, 1 `dein`, 0 `dir`, 0 `dich`,
0 `Sie`, 0 `Ihr*`. Der Lead enthält aber ein weiteres Du-Form-Zeichen: «Ein
Chatfenster antwortet **dir**.» Zusammen sind es zehn Stellen, nicht neun.

Das ändert den Text nicht, aber es ändert die Entscheidungsgrundlage für den
Menschen: ein Wechsel auf Sie-Form fasst auch `field_article_leadtext` an, nicht
nur `field_markdown`. Darum steht es hier und nicht nur in meinem Kopf.

## Was richtig ist und nicht angefasst werden darf

Alles hier habe ich selbst gegengelesen, nicht aus deinem Log übernommen.

**Helpdesk-Beispiel, gegen `validate-triage.sh` und `apply.sh` gelesen (nicht nur
workflow.yml):**
- Fünf erlaubte Prioritätswerte ✔ — `PRIORITIES = {"low","medium","high","urgent","blocker"}`.
- Vier Kategorien A bis D ✔ — `CATEGORIES = {"A","B","C","D"}`.
- Zwei Textbausteine pro Ticket ✔ — `comment-triage-<id>.txt` und `comment-reply-<id>.txt`, beide als vorhanden und nicht leer geprüft.
- Beide Kommentare als interne Notiz ✔ — beide `my comments add` tragen `--internal`, und die Verifikation akzeptiert sie nur mit `c.get("is_internal")`.
- «Fehlt eine Begründung, ein Ticket, ein Textbaustein?» ✔ — alle drei Regeln stehen im Gate, inklusive «ticket X from todo.json has no proposal».
- «ruft das Ticket neu ab und vergleicht» ✔ — `my tickets context … --json`, danach Abgleich von Priorität und beiden Kommentar-IDs.
- «Schlägt eine Prüfung fehl, geht der Befund zurück an den Agenten, benannt bis aufs Ticket» ✔ — ich habe das nicht nur im Skriptkommentar nachgelesen, sondern in `node_modules/kraftwerk/dist/run.js`: ein fehlgeschlagenes Gate erzeugt für Agentenschritte einen `correctionPrompt` in derselben Session, und die Fehlermeldungen des Gates nennen Datei und Ticket.
- Nicht erfunden: die Beschreibung ist vom echten Lauf 2026-09-16 gedeckt — Ticket 2673, Kategorie B, zwei Kommentare gesetzt, `"verified": true`.

**Zahlen der Redaktionskette, selbst nachgezählt:**
- Sieben Spalten ✔ — `board.md` Frontmatter: ideas, todo, progress, qa, seo, review, done.
- Drei Agenten ✔ — Nora, Rita, Sven.
- Acht Dateien bei Task 4 ✔ — zehn Dateien im Ordner, minus task.md und log.md: draft.md, draft-v2.md, draft-v3.md, factcheck.md, review.md, review-v2.md, review-v3.md, seo.md.
- 93 Logzeilen ✔ — `grep -c '^\* '` ergibt 93, und alle 93 tragen einen Zeitstempel; es gibt keine eingerückten Bullets, die die Zahl verfälschen könnten.
- Drei Entwürfe, fünf Runden ✔ — state.md, Zeile «Content pipeline retro after task 4 (2026-11-07, five rounds, three drafts, three returns from a human)».

**Wettbewerbsbeobachtung, gegen `fetch.sh`, `summarise.md` und das Bundle gelesen:**
- «Zeile für Zeile» ✔ — `difflib.unified_diff(old.splitlines(), text.splitlines(), …)`.
- «Kein Modell beteiligt» ✔ — Kopfzeile von fetch.sh: «No LLM».
- «Nur für die Seiten, die sich geändert haben» ✔ — der Prompt sagt «skip pages marked unchanged».
- «Zwei bis vier Punkte» ✔ — Persona und Prompt sagen beide «two to four bullets per changed page».
- «Darf nichts behaupten, was nicht im Vergleich steht» ✔ — «no speculation beyond the diff», «Use only what changes.md contains».
- «Zwei Seiten» ✔ — das Bundle `competitor-watch` hat genau zwei Konzepte unter `pages/`: liip.ch/de und unic.com/de. Dass die Namen nicht im Text stehen, ist richtig so.

**kraftwerk-Abschnitt, gegen die Primärquellen:**
- Alle fünf Faktenpunkte stehen so in `node_modules/kraftwerk/README.md`, Zeilen 1 bis 20: agentischer Workspace, Team-Eigentum von Agenten/Wissen/Skills/Workflows, Check nach jedem Agentenschritt, Spur mit Dauer und Kosten, `npm install -g @netnodeag/kraftwerk`, Node 20+, Harness Claude Code / Codex / Pi.
- Paketname und Node-Version zusätzlich aus `package.json` ✔ — `@netnodeag/kraftwerk`, `engines.node: ">=20"`.
- «Spur mit Dauer und Kosten» habe ich nicht nur im README gelesen, sondern in einer echten `trace.jsonl` nachgesehen: die Einträge tragen `durationMs` und `costUsd`.
- Keine Version, keine Lizenz, keine Preise, keine Kundenzahlen im Text ✔. Genau ein Abschnitt ✔.

**Die vier URLs — geöffnet und den Inhalt gelesen, nicht nur den Statuscode:**
- `netnode.ch/de/blog/ki-assistenten-vs-ki-agenten` → 200, Titel «KI-Agent vs. KI-Assistent: Was Entscheider 2026 wissen müssen», enthält die Abgrenzung Assistent/Agent wörtlich («Ein Assistent antwortet. Ein Agent verfolgt ein Ziel.») und einen Abschnitt «Multi-Agenten-Systeme». Deine Verlinkungsformel stimmt also.
- `netnode.ch/de/blog/agentic-work-system-bauplan` → 200, Titel «Das Agentic Work System: Der Bauplan für die agentische Organisation», führt Kontext, Skills und Capabilities als Bauteile. «Die Bauteile eines solchen Systems» trifft zu.
- `netnode.ch/de/blog/kraftwerk-deterministische-workflows-ai-agenten` → 200, Titel wie in deiner Linkliste.
- `github.com/NETNODEAG/kraftwerk` → 200, Titel «GitHub - NETNODEAG/kraftwerk». Zusätzlich gedeckt: unser eigener kraftwerk-Post nennt dieselbe URL als Quellcode-Ort.

**Deine Negativ-Behauptung habe ich unabhängig nachgeprüft:** Ich habe die Blog-Übersicht selbst durchgezählt und komme auf dieselben **182** Slugs. Einen Post «KI-Agenten im Unternehmen: drei Fragen vor dem Start» gibt es dort nicht. Die drei Fragen ausgeschrieben statt verlinkt ist damit richtig, und sie stehen wörtlich so wie in Task 1: «Als wer handelt der Agent? Worauf darf er zugreifen? Wer schaut zu, wenn er es tut?»

**Dass das Accessibility-Gate nicht im Text ist, ist richtig.** state.md sagt «No baseline yet: no check workflow has run» — ein «heute macht das System X» wäre dafür nicht belegt. Deine Begründung im Log ist genau der Massstab, den ich auch angelegt hätte. (Derselbe Massstab ist der Grund für N5.)

**Form, selbst nachgezählt:**
- Körper 1373 Wörter sichtbarer Text, 1399 nach `wc -w` mit Markdown-Linksyntax — beide innerhalb von 900 bis 1400 ✔. Ohne Überschriften sind es 1238 Wörter; auch das liegt drin.
- Körperzeichen: 9489 ohne, 9490 mit abschliessendem Zeilenumbruch, 9491 mit den Leerzeilen an beiden Rändern. Deine 9490 sind damit korrekt gezählt, das muss niemand nachrechnen.
- Lead exakt 309 Zeichen und 47 Wörter ✔.
- Keine H1 im Körper ✔, 7 H2 und 19 H3 ✔ (4 Nutzen + 3 Beispiele + 4 Grenzen + 4 Entscheide + 4 FAQ = 19).
- Null `ß` in der ganzen Datei ✔, null lange Gedankenstriche, weder Em noch En, in der ganzen Datei ✔.
- Vier URLs im Körper ✔.
- Feldanfänge stehen für sich ✔: der Lead beginnt mit «Ein Chatfenster antwortet dir», der Körper mit «Ein agentisches System ist Software, die …». Kein Bezugswort über die Feldgrenze. Ich habe das geprüft, weil der Lead auf netnode.ch im Hero steht und der Körper erst im zweiten Container darunter — nachgesehen in `repos/frontend.netnode.ch/src/components/node/article/NodeArticle.tsx`, Zeilen 77 bis 99.
- Die drei übrigen FAQ-Antworten stehen je für sich, auch allein zitiert ✔. Nur B1 fällt durch diese Prüfung.
- Drei Beispiele mit je vorher / heute / wo der Mensch entscheidet ✔, Grenzen-Abschnitt ✔, Entscheid-Abschnitt ✔, ein Satz zur Entstehung dieses Posts ohne Gag ✔.

**Findbarkeit habe ich nicht geprüft und verlange dazu nichts.** Titel,
`field_teaser_text` und Slug sind leer gelassen, das ist richtig; sie gehören
Sven. Der Arbeitstitel liegt tatsächlich 29 Zeichen über dem Budget — auch das ist
seine Sache, nicht deine.

## Für den CMS-Schritt: was die Redaktion im Text nicht lösen kann

Deine sechs Punkte am Dateiende bleiben, wie sie sind, und sind richtig
formuliert. Ich ergänze drei und streiche keinen:

7. **«93 Logzeilen» vor der Publikation nachzählen.** Der Wert stimmt am
   7.11.2026 exakt. Task 4 liegt in Review; gibt ein Mensch ihn zurück, wächst die
   Zahl. Befehl: `grep -c '^\* ' <Task-4-Ordner>/log.md`. Dasselbe gilt für «acht
   Dateien», wenn eine vierte Fassung dazukommt. Wer: CMS-Schritt.
8. **`competitor-watch` vor der Publikation einmal laufen lassen.** Der Satz «Zwei
   Seiten beobachten wir heute so» steht im Präsens; der letzte Lauf war am
   23.9.2026. Ein Lauf macht den Satz aktuell und bestätigt gleichzeitig die Zahl
   zwei. Wer: Web oder wer den Workflow auslöst.
9. **Den bestehenden kraftwerk-Post nachziehen.**
   `/de/blog/kraftwerk-deterministische-workflows-ai-agenten` beschreibt kraftwerk
   als «Open-Source-Framework» für feste Workflows und sagt «npx genügt». Dieser
   Post sagt «agentischer Workspace» und `npm install -g`. Beides ist zu seiner
   Zeit richtig gewesen, nebeneinander im selben Blog ist es verwirrend. Eigener
   Auftrag für Web, blockiert diesen Post nicht.

Zur Information für Sven, kein Befund und keine Forderung von mir: unter den 182
Slugs liegt auch `/de/blog/agent-evaluations-qualitaet-ki-agenten`. Ob der ins
Verlinkungsbild gehört, entscheidet er.

## Konflikt mit SEO

Keiner, den ich sehe. Die Länge liegt mit 1373 Wörtern innerhalb der Vorgabe von
task.md; wenn Sven für Rechtsfragen- oder Grundlagenposts mehr will, ist das der
bekannte Zielkonflikt von Task 4 und gehört dann in beide Logs und zu den
Menschen, nicht in eine weitere Runde zwischen uns.
