# SEO draft-v3.md — Agentische Systeme: was sie sind, was sie bringen

Verdict: ok

Sven, 7.11.2026, zweite Runde. Geprüft ist **`draft-v3.md`**. `seo.md` bleibt
daneben als Protokoll der ersten Runde stehen; die **Feldwerte dort gelten
unverändert weiter** — dieses Dokument ersetzt sie nicht, es ergänzt sie um die
Prüfung von v3 und um drei Nits. Freigegeben ist `draft-v3.md`.

**S1 ist geschlossen.** Nora hat ihn nicht nur eingearbeitet, sondern vorher
gegengelesen, und an einer Stelle besser gelöst als ich. Von mir kommt keine
Forderung mehr.

---

## Lies zuerst das: zwei Dateien, ein Feld

Das ist das Einzige, was beim Einstellen wirklich schiefgehen kann, deshalb steht
es oben und nicht unter den Nits.

**`field_article_links`:** `draft-v3.md` führt unter «Links für
field_article_links» **drei** Posts auf, `seo.md` führt **vier** mit `uri` und
Titel. Noras Liste ist als Vorschlag markiert und ihr Dateikopf sagt, dass das
Feld mir gehört — aber eine numerierte Liste in der Entwurfsdatei liest sich wie
eine Anweisung. **Gültig ist die Tabelle in `seo.md`.** Sie enthält
`/de/programme/agentic-ai` (den einzigen Weg vom Post zu einem Angebot) und
`agent-evaluations`, und sie lässt die zwei Posts weg, die im Körper schon mit
beschreibendem Anchor verlinkt sind.

**Alles andere, was mir gehört, steht nur in `seo.md`** und in Noras Liste
absichtlich nicht: Node-Titel, `field_teaser_text`, Slug, Teaser-Bild samt
Dateiname und Alt-Text, Schema, das Sprachprefix der Sidebar-`uri`,
`field_article_employee`, `field_article_services`. Der CMS-Schritt braucht beide
Dateien, und Nora hat das am Ende ihrer Liste selbst so hingeschrieben. Das ist
die richtige Arbeitsteilung, sie muss nur einmal laut gesagt werden.

---

## Noras zwei Fragen, beantwortet

### 1. Sitzt der neue Satz an der richtigen Stelle? Ja.

Sie hat ihn hinter **beide** bestehenden Links gehängt und nicht dazwischen. Das
ist richtig, und zwar aus zwei Gründen, die beide gegen «dazwischen» sprechen:

- Die zwei bestehenden Links sind **eine** grammatische Einheit («Die Abgrenzung …
  steht ausführlich in X, die Bauteile eines solchen Systems in Y»). Ein Satz
  dazwischen hätte sie auseinandergerissen.
- Der neue Satz endet auf «hier geht es um das System, in dem mehrere davon
  zusammenarbeiten». Damit steht die **eigene Positionierung dieses Posts am
  Absatzende** — die Stelle, die ein Leser behält und die eine Antwortmaschine
  beim Zitieren des Absatzes mitnimmt. Zwischen den anderen Links wäre sie
  Beiwerk gewesen.

### 2. Ergeben die fünf Links im Körper das richtige Verlinkungsbild? Ja, und `agent-evaluations` gehört nicht dazu.

Das war mein Entscheid, Nora hat ihn richtig offengelassen. **Er bleibt im Körper
draussen**, aus drei Gründen:

1. **Die Decke.** 1397 von 1400 sichtbaren Wörtern, drei Wörter Luft. Ein Link mit
   beschreibendem Anchor-Text kostet mehr als drei.
2. **Er ist schon gesetzt, nur anderswo.** `agent-evaluations-qualitaet-ki-agenten`
   ist Eintrag 4 der Sidebar in `seo.md`, und zwar als Paar zur vierten
   FAQ-Antwort («Woran sehe ich, ob so ein System funktioniert?»). Frage im Text,
   Antwort eine Ebene tiefer in der Sidebar — das ist stärker als ein sechster
   Link im Fliesstext.
3. **Die Dichte stimmt schon.** Vier interne netnode-Links plus einer nach aussen
   auf 1397 Wörter, also ungefähr einer je 280 Wörter. Meine Vorgabe sind zwei bis
   vier interne Links mit beschreibendem Anchor-Text; vier ist das obere Ende.
   Ein fünfter interner Link verdünnt das Signal, statt es zu stärken.

Anchor-Texte selbst nachgelesen, alle fünf: «KI-Agent vs. KI-Assistent», «Das
Agentic Work System», «persistente KI-Mitarbeiter», «GitHub», «kraftwerk:
Deterministische Workflows für AI-Agenten». **Kein «hier klicken», kein «mehr
erfahren»**, und keiner ist mit unserem Titel identisch — sonst würden Anchor und
Titel um dieselbe Phrase konkurrieren.

---

## Noras Abweichung von meinem Fixtext: sie hat recht

Statt «in dem **sie** zusammenarbeiten» steht «in dem **mehrere davon**
zusammenarbeiten», ein Wort mehr.

Ihre Begründung trifft, und mein Fixtext war an dieser Stelle schlechter als
ihrer. «Sie» zeigt grammatisch auf das Nächstliegende zurück, also auf die
persistenten KI-Mitarbeiter — der Satz hätte dann gesagt, dass dieser Post vom
System der KI-Mitarbeiter handelt. Gemeint und in task.md verlangt ist aber die
Stufe über dem **einzelnen Agenten**. «Mehrere davon» sagt genau das. Der Satz,
der die Kannibalisierung auflösen soll, hätte in meiner Fassung die Abgrenzung
wieder verwischt, die er setzen soll. Ein Wort gut investiert.

Das ist in diesem Durchgang das zweite Mal, dass ein Fixtext aus einem Review
schlechter war als die Fassung der Autorin — Rita hat dasselbe in Runde eins
zweimal protokolliert. Dass Fixtexte Vorschläge sind und nicht Vorschriften, ist
damit auf diesem Board dreifach belegt.

---

## Und einmal hat sie mein Problem besser gelöst als ich

Mein Hinweis auf die Marker-Falle war: *warnt den CMS-Schritt, dass die
Zeichenkette zweimal vorkommt.* Nora hat stattdessen **die Dopplung entfernt**.
Selbst nachgezählt in `draft-v3.md`:

| Zeichenkette | Vorkommen in v2 | Vorkommen in v3 |
|---|---|---|
| `field_markdown BEGINN` | 2 | **1** |
| `field_markdown ENDE` | 2 | **1** |

Der Dateikopf nennt die Marker jetzt als «der Kommentar BEGINN» statt die
Zeichenkette zu wiederholen. Damit landet auch ein naiver Schnitt auf die
Zeichenkette richtig, nicht nur ein Schnitt auf die ganze Zeile. **Eine Falle
abgeschafft ist besser als eine Falle beschildert.** Die Markerzeilen liegen jetzt
auf Zeile 25 und 215.

---

## Selbst nachgezählt in v3, nicht aus Noras Logzeile übernommen

| Wert | Nora sagt | Ich zähle |
|---|---|---|
| Zeichen | 9738 | **9738** |
| Wörter sichtbarer Text | 1397 | **1397** |
| Wörter nach `wc -w` | 1423 | **1423** |
| Differenz der zwei Zählweisen | 26 Überschriftenmarker | **26**, und es gibt genau **26** Überschriften |
| H1 | 0 | **0** |
| H2 | 7 | **7** |
| H3 | 19 | **19** |
| Hierarchiesprünge | keine | **keine**, nur H2 und H3, kein H4 |
| URLs im Körper | 5 | **5**, alle fünf einzeln aufgerufen, alle **200** |
| «agentische Systeme» im Körper | 8 | **8** |
| H2 mit dem Keyword | 3 von 7 | **3 von 7** |
| `ß` | 0 | **0** |
| lange Gedankenstriche | 0 | **0** em, **0** en |
| «Sie» / «Ihr» im Körper | 0 | **0** |

Alle dreizehn Werte deckungsgleich. Ihre Rechnung zur Decke geht ebenfalls genau
auf, nachgerechnet: 1373 + 21 (S1) + 1 (NV3) + 3 («und beschleunigt sie») − 1
(NV2 gibt ein Wort zurück) = **1397**, drei unter 1400.

Die drei H2, die das Keyword tragen: «Chatbot, Agent, agentisches System», «Drei
agentische Systeme in unserem Betrieb» (mein N2, von ihr übernommen) und «Wo ein
agentisches System nichts bringt».

### Zur Wortdecke und zu Ritas zweiter Rückholung

Nora hat «In einem Postfach hast du das nicht.» draussen gelassen und begründet
das damit, dass die Decke von einem Menschen kommt und Rita nichts verlangt hat.
**Das ist richtig entschieden und es ist ihr Entscheid, nicht meiner.** Ich hatte
geschrieben, dass sie damit die Decke zur Debatte stellen *kann*; sie hat es nicht
getan, und sieben Wörter Rhetorik gegen eine Vorgabe aus task.md zu setzen wäre
unverhältnismässig gewesen. Es geht also **kein Entscheid zur Länge an die
Menschen** — es gibt keinen. Der Zielkonflikt aus Task 4 ist in diesem Post nie
entstanden.

---

## Drei Nits — keiner blockiert, jeder mit Besitzer und Station

Nach der Hausregel «eine Runde je Station» gebe ich jetzt die Freigabe und lasse
den Rest hier liegen. Alle drei sind Protokoll- oder Sequenzpunkte, **keiner
betrifft den Fliesstext**, und keiner muss vor der Freigabe erledigt werden.

### SV1 — Punkt 4 und Punkt 9 der CMS-Liste sind ein Auftrag, nicht zwei

**Besitzer: CMS-Schritt beziehungsweise Web. Kostet nichts, spart einen Durchgang.**

Punkt 4 verlangt einen Backlink **aus**
`/de/blog/kraftwerk-deterministische-workflows-ai-agenten`. Punkt 9 sagt, dass
genau dieser Post überholt ist («Open-Source-Framework», «npx genügt») und
nachgezogen werden muss. Wer ihn zweimal anfasst, macht die Arbeit doppelt:
**den Backlink setzen, während der Post sowieso offen ist.**

Dazu die Präzisierung meiner Backlink-Empfehlung, weil `seo.md` und Punkt 4
verschiedene Quellen nennen und ein Mensch sonst zwei Listen vergleicht. Meine
gilt, weil sie Stelle und Anchor-Text benennt und ich beide Quellposts im Volltext
gelesen und ihr Publikationsdatum geprüft habe:

| Quelle | Stelle | Anchor-Text | Status |
|---|---|---|---|
| `/de/blog/agentic-work-system-bauplan` (1.7.2026) | Abschnitt «Vom Werkzeug zum System» | `drei agentische Systeme in unserem Betrieb` | **wichtigster**, siehe `seo.md` |
| `/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker` (2.9.2026) | Abschnitt «Der Agentic Workspace» | `was ein agentisches System aus solchen Rollen macht` | Gegenrichtung zu S1 |
| `/de/blog/kraftwerk-deterministische-workflows-ai-agenten` | beim Nachziehen aus Punkt 9 | frei | **mitnehmen, nicht separat** |

### SV2 — «182 Blog-Slugs geprüft» in Punkt 5 ist jetzt zu niedrig

**Besitzer: niemand, nur fürs Protokoll. Ich korrigiere es hier statt die Datei
dafür aufzumachen.**

Punkt 5 der CMS-Liste begründet, warum der Task-1-Post «KI-Agenten im Unternehmen:
drei Fragen vor dem Start» nicht verlinkt ist, mit «182 Blog-Slugs geprüft». Das
war der Stand von Noras Prüfung über die Blog-Listenseite und er war nicht falsch
— er ist nur inzwischen überholt. **Geprüft ist mehr:** 185 aliasierte
`/de/blog/`-Slugs aus `sitemap-articles.xml` **plus** der `<title>` aller **170**
alias-losen `/de/node/<id>`-URLs aus den neun Teil-Sitemaps. Der Post existiert in
keinem der beiden Bestände. Die Begründung in Punkt 5 steht damit auf festerem
Grund als ihre eigene Zahl sagt; wenn die Datei aus einem anderen Grund noch
einmal aufgeht, kann die Zahl nachgezogen werden, sonst liest der Mensch sie hier.

### SV3 — Inhaltsverzeichnis bleibt der erste Kandidat, falls die Decke je steigt

**Besitzer: Nora, aber nur wenn ein Mensch die Wortdecke anhebt. Sonst nichts zu tun.**

Unverändert aus `seo.md`: die zwei nächsten Nachbarn haben ein handgebautes
Inhaltsverzeichnis (`agentic-work-system-bauplan` als H2 «Inhaltsverzeichnis»,
`persistente-ki-mitarbeiter` als H2 «Inhalt»), es ist **kein Template-Element**,
und bei 7 H2 und 19 H3 wäre es ein echter Gewinn für Sprungziele und Sitelinks.
Es kostet 25 bis 30 Wörter plus Ankersyntax, und die Luft ist **drei** Wörter.
Deshalb kein Befund. Falls die Decke steigt: das Verzeichnis zuerst, erst danach
Ritas zweite Rückholung.

---

## Was unverändert gilt

Aus `seo.md`, nichts davon hat sich durch v3 geändert:

- **Hauptkeyword «agentische Systeme», auf netnode.ch unbesetzt** — 0 Treffer auf
  9 im Volltext geprüften Kandidatenseiten. In v3 steht die Phrase **8-mal** im
  Körper (eine mehr als in v2, durch die neue H2) und trägt **3 von 7** H2.
- **Alle CMS-Feldwerte**: Node-Titel «Was agentische Systeme sind und was sie
  bringen» (47/47 Zeichen), Alternative mit 2 Zeichen Reserve, Slug
  `agentische-systeme` (geprüft frei), `field_teaser_text` (152 Zeichen),
  `field_article_leadtext` unverändert 309 Zeichen und 47 Wörter,
  `field_article_links` (4 Einträge mit `internal:/de/…`), Dateiname und Alt-Text
  für `field_teaser_image`.
- **Schema**: `BlogPosting` automatisch, `FAQPage` wird auf Artikeln nicht
  ausgeliefert (W1, Befund für Web, Ticket #2348 präzisieren) — für diesen Post
  ausdrücklich nichts zu tun.
- **Kein Datum im Text nötig**: das Template liefert `<time class="dt-published">`
  und die JSON-LD-Daten und pflegt sie selbst.
- **W2**: 170 Knoten ohne Pfad-Alias in den Sitemaps, eigener Auftrag für Web.
- **W3**: `/de/programme/agentic-ai` nennt kraftwerk 0-mal,
  `persistente-ki-mitarbeiter` nennt es 6-mal — zwei Fakten für den offenen
  Positionierungsentscheid.

---

## Was mit dem Paket an die Menschen geht

**Zu lesen sind vier Dateien:** `draft-v3.md` (der Text und die Liste der neun
Punkte, die die Redaktion im Text nicht lösen kann), `review-v2.md` (Ritas
Freigabe von v2), `seo.md` (die CMS-Feldwerte und die Web-Befunde) und diese
Datei. `draft.md`, `draft-v2.md` und `review.md` liegen als Protokoll daneben und
müssen nicht gelesen werden.

**Zwei Entscheide gehören einem Menschen und keinem von uns:**

1. **Die Positionierung von kraftwerk auf netnode.ch.** Noras Empfehlung (a) jetzt,
   (b) sobald eine zweite Quelle darauf verlinkt. W3 in `seo.md` liefert zwei
   Fakten dazu, und der wichtigere ist: die zweite Quelle existiert schon.
2. **Die Anredeform, zusammen mit Task 4.** Stand v3: neun Du-Stellen, davon acht
   im Körper und eine im Lead. **Node-Titel und `field_teaser_text`, die ich
   liefere, enthalten keine Anredeform** — sie müssen nicht angefasst werden, wie
   der Entscheid auch ausfällt.

**Was ausdrücklich nicht entschieden werden muss:** die Länge. Es gibt dazu keinen
Konflikt zwischen Rita und mir.

**Ein Hinweis, den Nora selbst ins Log geschrieben hat und den ich bestätige:** der
S1-Satz ist der einzige Text in v3, den Rita nie gesehen hat. Er enthält ausser dem
Linkziel keine neue Tatsachenbehauptung, und das Linkziel habe ich in Runde eins im
Volltext gelesen, Nora in dieser Runde unabhängig noch einmal. Nach der Hausregel
muss die Freigabe dafür nicht erneuert werden — die Naht ist damit sichtbar
protokolliert, und ein Mensch, der es anders sieht, findet hier die Stelle.
