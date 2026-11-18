# SEO draft-v2.md — Agentische Systeme: was sie sind, was sie bringen

Verdict: changes requested

Sven, 7.11.2026, erste Runde. Geprüft habe ich **`draft-v2.md`**, die von Rita
freigegebene Fassung; `draft.md` habe ich nur gelesen, um Ritas Diff zu verstehen,
und nicht bewertet. Es ist **genau ein Befund** (S1), und die Datei geht sowieso
noch einmal auf: Ritas vier Nits NV1 bis NV4 warten auf denselben Durchgang. Kein
Neuaufbau, kein zweiter Durchgang am ganzen Paket.

Die gute Nachricht zuerst, weil sie den ganzen Post trägt: **die exakte Phrase
«agentische Systeme» ist auf netnode.ch unbesetzt.** Ich habe neun Seiten im
Volltext gegengeprüft, die dafür in Frage kommen — sechs Blogposts, die
Programmseite, den Ratgeber und die AI-Agentur-Seite. Treffer für «agentisches
System» / «agentische Systeme»: **0 von 9**. Im Körper dieses Entwurfs steht die
Phrase **7-mal**, zweimal davon in einer H2. Das ist die seltene Lage, in der ein
neuer Post ein Kopf-Keyword holen kann, ohne einem eigenen URL etwas wegzunehmen.

---

## Für das CMS

Alle Werte sind copy-paste-fertig. Zeichenzahlen sind gezählt, nicht geschätzt.

### Node-Titel — `<title>` **und** H1

```
Was agentische Systeme sind und was sie bringen
```

**47 Zeichen, Budget 47, keine Reserve.** Das Frontend hängt ` | NETNODE AG` an
(13 Zeichen), der `<title>` wird also 60 Zeichen lang.

Zwei Dinge, die bei diesem Feld immer gesagt werden müssen, weil sie den Entscheid
bestimmen:

1. Auf netnode.ch gibt es **kein Meta-Title-Feld**. Der Node-Titel ist der
   `<title>` und gleichzeitig die H1 — in `ArticleHero.tsx` Zeile 51 als
   `<Heading as="h1">` gerendert. Die Regel «H1 ist keine Kopie des Meta-Titels»
   ist hier technisch nicht erfüllbar. **Der Titel, den ich vorschlage, wird die
   Schlagzeile des Posts.** Er ist deshalb als Schlagzeile gebaut, nicht als
   Suchmaschinen-Zeile.
2. Bei 47 von 47 Zeichen ist jede spätere Änderung ein Überschreiten. Wer Reserve
   will, nimmt die Alternative.

**Alternative, 45 Zeichen, 2 Zeichen Reserve, Keyword an Position 1:**

```
Agentische Systeme: was sie sind, was sie tun
```

Warum ich die erste empfehle: Die Frageform trifft die Suchanfrage («was sind
agentische systeme»), und das ist das Muster, mit dem netnode.ch nachweislich
gewinnt — `/de/blog/was-ist-agentic-coding` holt 64 Klicks bei Position 5.4,
«was ist agentic coding» und «was ist geo» sind in der GSC-Auswertung
(`repos/frontend.netnode.ch/seo/data/a1-gsc-2026-07.md`) eigene Zeilen. Der
Arbeitstitel aus task.md («Agentische Systeme: wenn Software nicht mehr nur
antwortet, sondern arbeitet») hat 76 Zeichen und liegt 29 über dem Budget; er ist
damit erledigt. Beide Vorschläge enthalten **keine Anredeform** und überleben den
offenen Du-gegen-Sie-Entscheid unverändert.

### Slug

```
agentische-systeme
```

Vollständige URL: `https://netnode.ch/de/blog/agentische-systeme`

18 Zeichen, kein Jahr, kein Füllwort. **Selbst geprüft:** der Slug ist frei —
`https://netnode.ch/de/blog/agentische-systeme` gibt heute 404, und unter den
Slugs der neun Teil-Sitemaps beginnt keiner mit «agentische». Keine Regel in
`next.config.js` berührt ihn (Wissenskonzept `netnode-website/seo/redirects-and-canonical`
Punkt für Punkt gegengelesen). Der Inhalt ist nicht jahresgebunden, der Slug muss
also nie wechseln und kostet keinen Redirect. **Dieser Post ist der Kopf-Term —
der kurze Slug gehört ihm und nicht einem späteren Text.**

### `field_teaser_text` — Meta-Description **und** Listen-Teaser **und** RSS

```
Agentische Systeme erledigen Arbeit, statt nur zu antworten: Agenten mit Rollen, Prüfschritte dazwischen, eine Spur. Drei Beispiele aus unserem Betrieb.
```

**152 Zeichen, Budget 155 bis 160** (darüber schneidet Google in der deutschen
SERP ab). 3 bis 8 Zeichen Reserve.

Drei Gründe für genau diese Fassung:

- Das Feld bedient **drei Oberflächen gleichzeitig** — `description` und
  `og:description` in `page.tsx`, den Kartentext im Artikel-Raster
  (`SectionArticleGrid.tsx` Zeile 54, dort auf 3 Zeilen beschnitten) und den
  RSS-Text. Es muss allein stehen, ohne den Lead und ohne den Titel.
- Keyword an Position 1, weil die ersten Wörter in der Liste und im Reader
  zuerst gelesen werden.
- **Keine Anredeform.** Der Du-gegen-Sie-Entscheid ist offen; dieser Wert muss
  nicht angefasst werden, wie er auch ausfällt.
- Er wiederholt den Lead nicht: der Lead beginnt mit «Ein Chatfenster antwortet
  dir», der Teaser mit «Agentische Systeme erledigen Arbeit». Zwei Feldanfänge,
  die je für sich tragen.

### `field_article_leadtext` — sichtbarer Lead im Hero

**Unverändert aus `draft-v2.md` übernehmen, 309 Zeichen, 47 Wörter.** Kein Befund.

Die Zeichenzahl, die Rita auf Task 4 für dieses Feld verlangt hat, und die ich
dort nicht liefern konnte — hier ist sie, mit der Begründung aus dem Code:

**Budget: kein hartes Limit, Empfehlung bis 320 Zeichen. 309 ist am oberen Rand,
und das ist in Ordnung.** `ArticleHero.tsx` Zeilen 57 bis 64 rendert den Lead
ungekürzt, ohne `line-clamp` und ohne `substring` — er kann also nicht abgeschnitten
werden. Er sitzt aber **fett, 15px, in zwei von vier Rasterspalten neben dem
Autor**. Deutlich mehr als 320 Zeichen werden dort zu einem fetten Block.

Was bei diesem Feld fast immer übersehen wird und hier im Code steht: der Lead ist
**nicht nur sichtbarer Text, sondern auch die `description` im `BlogPosting`-JSON-LD**
(`src/lib/json-ld/article-json-ld.ts` Zeile 13, HTML wird dort rausgestrippt). Die
Meta-Description kommt aus `field_teaser_text`, die JSON-LD-Description aus
`field_article_leadtext`. **Zwei verschiedene Felder für zwei verschiedene
Beschreibungen** — beide müssen gefüllt sein, und sie dürfen nicht derselbe Satz
sein.

### `field_markdown` — Körper

Alles zwischen der Zeile `<!-- field_markdown BEGINN -->` und der Zeile
`<!-- field_markdown ENDE -->`, die Kommentarzeilen selbst **nicht**. Ich habe die
Markerlösung nachgeprüft und sie ist richtig: die beiden Zeilen stehen in
`draft-v2.md` auf **Zeile 26 und Zeile 219**.

**Eine Falle für den CMS-Schritt, die ich selbst hineingetreten bin:** die beiden
Markerzeichenketten kommen in der Datei **je zweimal** vor — einmal in Backticks im
Dateikopf, wo die Regel erklärt wird, und einmal als eigene Zeile. Wer per Suche
auf die Zeichenkette schneidet statt auf die **ganze Zeile**, erwischt die
Kopferklärung und kopiert 17 Zeichen statt 9484. Auf die Zeile abgleichen, nicht
auf das Vorkommen.

Nachgezählt im extrahierten Feldwert, nicht aus den Logzeilen übernommen:

| Wert | Gezählt |
|---|---|
| Zeichen | 9484 |
| Wörter sichtbarer Text | 1373 |
| Wörter nach `wc -w` | 1399 |
| H1-Zeilen | 0 |
| H2 | 7 |
| H3 | 19 |
| Überschriften gesamt | 26 |
| Überschriftensprünge | keine (nur H2 → H3, kein H4) |
| URLs | 4 |

Alle Werte deckungsgleich mit Rita und Nora. Die Differenz von 26 zwischen 1373
und 1399 sind die Überschriftenmarker, nicht die Linksyntax — auch das stimmt.

### `field_teaser_image` — fehlt und muss gesetzt werden

Im Entwurf ist kein Bild benannt, und das Feld kann nicht leer bleiben. Was
passiert, wenn es leer bleibt, steht im Code und ist zweimal unangenehm:

- `NodeArticleTeaser.tsx` Zeile 39 fällt auf `/images/og-image-article.jpg` zurück
  — die Karte in der Blog-Liste trägt dann das generische Bild wie jeder andere
  Post ohne Bild.
- `article-json-ld.ts` hängt `image` nur an, **wenn** `field_teaser_image` gesetzt
  ist. Ohne Bild hat das `BlogPosting` kein `image`, und das ist das Feld, das
  Google in Discover und in den Rich Results braucht.

**Dateiname** (Keyword im Namen, Kleinschreibung, Bindestriche):

```
agentische-systeme-netnode-rollen-pruefschritte.jpg
```

**Alt-Text am Medium** (Barrierefreiheit zuerst, SEO danach — der Alt-Text
beschreibt das Bild, er ist keine Keyword-Zeile):

```
Drei Arbeitsstationen einer Aufgabe: schreiben, prüfen, freigeben
```

Der Alt-Text muss natürlich zum Bild passen, das tatsächlich gewählt wird; wenn
das Motiv ein anderes ist, beschreibt der Alt-Text das andere Motiv. Seitenverhältnis
16:9, das Hero und die Karte ziehen `image_style_uri.wide`.

### `field_article_links` — Sidebar, 4 Einträge

Das Feld gehört mir, Nora hat drei Posts als Vorschlag angelegt. Ich nehme zwei
davon heraus und zwei neue dazu. Die Begründung ist eine Regel, nicht Geschmack:
**die Sidebar soll Reichweite dazugeben, nicht den Körper doppeln.**
`ki-assistenten-vs-ki-agenten` und der kraftwerk-Post sind im Körper schon mit
beschreibendem Anchor verlinkt; ein zweiter Link auf dieselbe URL auf derselben
Seite gibt weder dem Leser noch Google etwas dazu.

Format: `internal:` plus Pfad **mit** Sprachprefix. Begründung unten in N3 — da
steckt ein echter Unterschied im Statuscode.

| # | `title` | `uri` |
|---|---|---|
| 1 | Agentic AI: Agenten bauen und betreiben | `internal:/de/programme/agentic-ai` |
| 2 | Das Agentic Work System: der Bauplan | `internal:/de/blog/agentic-work-system-bauplan` |
| 3 | Persistente KI-Mitarbeiter: Identität und Gedächtnis | `internal:/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker` |
| 4 | Agent Evaluations: Qualität von KI-Agenten messen | `internal:/de/blog/agent-evaluations-qualitaet-ki-agenten` |

Zu Nummer 1: **das ist der einzige Weg vom Post zu einem netnode-Angebot.** Die
drei thematisch nahen Posts tragen am Ende eine H2 «Lassen Sie uns darüber
sprechen» — die steht bei ihnen **im Markdown-Körper**, sie kommt nicht vom
Template (im Frontend-Repo gibt es dafür keine Komponente, ich habe danach
gesucht). Dieser Entwurf hat sie nicht. Für einen Text an Entscheider ist ein
Post ohne einen einzigen Weg zum Angebot eine verschenkte Seite, und weil ich das
in meinem eigenen Feld lösen kann, verlange ich dafür **keine Textänderung**.

Zu Nummer 4, das war Ritas offene Frage: **ja, der gehört ins Verlinkungsbild.**
Die vierte FAQ-Antwort dieses Posts fragt «Woran sehe ich, ob so ein System
funktioniert?» und antwortet mit der Spur. `agent-evaluations-qualitaet-ki-agenten`
ist genau der Post, der die Frage eine Ebene tiefer beantwortet (automatisierte
Metriken, LLM as Judge, Human Evaluation, Adaptive Rubrics — Meta-Description
gelesen, nicht nur der Slug). Das Paar FAQ-Frage plus Sidebar-Link ist stärker als
ein Link im Körper, der dort Wörter kosten würde, die wir nicht haben.

### Schema

| Typ | Status |
|---|---|
| `BlogPosting` | **automatisch**, aus dem Node. Kein CMS-Schritt nötig. |
| `Organization`, `WebSite`, `BreadcrumbList`, canonical, hreflang | **automatisch** aus dem Root-Layout. |
| `FAQPage` | **wird auf Artikeln nicht ausgeliefert.** Siehe W1 — Befund für Web, nicht für die Redaktion. |

Zwei Dinge am `BlogPosting`, die der CMS-Schritt beeinflusst:

- **`author` kommt aus `field_article_employee`.** Bleibt das Feld leer, setzt
  `article-json-ld.ts` Zeile 20 `name: 'NETNODE AG'` — typisiert aber weiterhin als
  `@type: 'Person'`, also eine Firma als Person. Bei einem Text über KI-Strategie
  ist ein benannter Mensch mit Rolle und Bild ausserdem das stärkere
  Autoritätssignal. **Feld füllen.**
- **`datePublished` und `dateModified`** kommen aus `created` und `changed`. Dazu
  unten N1, und das ist eine Entwarnung.

---

## Befund, der zurück nach Writing geht

### S1 — der nächste Nachbar ist nicht verlinkt, und genau dort sitzt die Kannibalisierung

**Besitzer: Nora. Blockierend.**

Das ist mein einziger Befund, und er ist kein Formalia-Befund. Die Stelle:

> Die Abgrenzung zwischen Assistent und Agent steht ausführlich in
> [KI-Agent vs. KI-Assistent](https://netnode.ch/de/blog/ki-assistenten-vs-ki-agenten), die
> Bauteile eines solchen Systems in
> [Das Agentic Work System](https://netnode.ch/de/blog/agentic-work-system-bauplan).

Zwei Nachbarn sind hier benannt. Der dritte, der **näher liegt als beide**, fehlt:
`/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker`, publiziert am
2.9.2026. Ich habe ihn im Volltext gelesen, nicht nur den Statuscode geholt. Was
dort steht, neben dem, was in diesem Entwurf steht:

| `persistente-ki-mitarbeiter` (2.9.2026) | dieser Entwurf |
|---|---|
| Meta-Description: «Definition, Abgrenzung und **drei Beispiele aus dem NETNODE Team**» | Definition, Abgrenzung, **drei Beispiele aus unserem eigenen Betrieb** |
| H2 «**Chatbot, Agent**, Coworker: die Abgrenzung» | H2 «**Chatbot, Agent**, agentisches System» |
| H2 «Der **Agentic Workspace**» | kraftwerk als «ein agentischer **Workspace**» |
| H2 «Was das für Ihr Unternehmen bedeutet» | H2 «Woran du den Nutzen merkst» |

**Gleiche Bauform, Nachbarbegriff, kein Link dazwischen.** Das ist die Konstellation,
in der Google selbst entscheidet, welcher der beiden URLs die Abfrage bekommt — und
es ist die einzige echte Kannibalisierungsstelle, die ich gefunden habe. Sie ist mit
einem Satz zu schliessen, und der Satz leistet zwei Dinge gleichzeitig: er setzt den
Link, und er sagt Google und dem Leser, **welcher Post was abdeckt**.

**Vorschlag** — und das ist ein Vorschlag, keine Vorschrift; eine bessere Fassung mit
Begründung im Log ist mir lieber als meine. Direkt hinter den Satz oben:

> Agenten mit eigener Identität und Gedächtnis nennen wir
> [persistente KI-Mitarbeiter](https://netnode.ch/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker);
> hier geht es um das System, in dem sie zusammenarbeiten.

**Kosten: 20 sichtbare Wörter.** Gezählt, indem ich die Einfügung in den
extrahierten Feldwert eingesetzt und neu gezählt habe, nicht geschätzt.

**Und damit zur Wortdecke, denn die ist nach dieser Einfügung knapp.** Alle Zahlen
gezählt am simulierten Ergebnis:

| Stand | Sichtbare Wörter |
|---|---|
| v2 heute | 1373 |
| Decke aus task.md | 1400 |
| **Luft** | **27** |
| nach S1 | 1393 |
| nach S1 + Ritas NV3 («und» zurück, 1 Wort) | **1394** |
| Restluft danach | 6 |

Daraus folgt eine Konsequenz für Ritas Schlusswunsch, und ich sage sie, damit
niemand sie suchen muss. Rita schreibt: «Falls Svens Durchgang Wörter frei macht,
wären das die zwei, die ich zuerst zurückholen würde» — «und beschleunigt sie» und
«In einem Postfach hast du das nicht.» **Mein Durchgang macht keine Wörter frei, er
verbraucht sie.** Von den beiden passt noch genau eine:

- «und beschleunigt sie» — 3 Wörter → **1397, passt.**
- «In einem Postfach hast du das nicht.» — 7 Wörter → **1401, passt nicht.**
- beide zusammen → 1404, passt nicht.

Entscheid gehört Nora, es ist ihr Text. Wenn sie beide will, ist das kein Fehler,
sondern der Punkt, an dem die Decke aus task.md zur Debatte steht — dann beide
Begründungen ins Log und der Entscheid an die Menschen.

---

## Zur Länge: kein Konflikt mit Rita

Rita hat das offen gelassen und mich gefragt. **Ich widerspreche ihr nicht.** 1373
und nach S1 1394 Wörter sind für dieses Thema und diese Zielgruppe richtig, und
zwar aus einem Grund, der nicht Geschmack ist: der Post holt das Kopf-Keyword mit
einer Definition, drei belegten Beispielen und einer FAQ. Länge ist dafür kein
Rangfaktor — die unbesetzte Phrase und die eigenen, nachprüfbaren Beispiele sind
es. Ein längerer Text müsste entweder wiederholen, was
`agentic-work-system-bauplan` und `ki-assistenten-vs-ki-agenten` schon abdecken
(das wäre neue Kannibalisierung), oder Zahlen erfinden (das verbietet task.md und
hat Rita in Runde eins zu Recht zweimal kassiert). **Der Zielkonflikt aus Task 4
entsteht hier nicht.** Es gibt nichts für die Menschen zu entscheiden.

---

## Nits — nichts davon blockiert, jeder mit Besitzer und Station

### N1 — kein Datum im Text nötig: das Template liefert es

**Besitzer: niemand. Das ist eine Entwarnung, und sie korrigiert einen Reflex von
mir.**

Ich verlange normalerweise ein sichtbares «Stand: November 2026» im Text, weil
datierbare Fakten bei Antwortmaschinen gewinnen. Im Körper steht **0-mal «2026»
und 0-mal «Stand:»**. Hier verlange ich es trotzdem nicht, weil der Code es schon
tut: `NodeArticle.tsx` Zeile 121 rendert `<time dateTime={created} class="dt-published">`
mit dem ausgeschriebenen deutschen Datum, und `datePublished`/`dateModified` stehen
im `BlogPosting`. Sichtbares Datum, maschinenlesbares Datum und Schema sind damit
vorhanden, **und sie pflegen sich selbst** — das ist besser als eine Zeile im
Markdown, die jemand am Publikationstag von Hand nachziehen muss.

Was bleibt, ist nicht das Datum, sondern die **drei zählbaren Behauptungen**, die
am Publikationstag stimmen müssen: «zwei Seiten beobachten wir heute so», «acht
Dateien» und «93 Logzeilen». Die stehen als Punkte 3, 7 und 8 in Noras
CMS-Liste, vollständig und mit Befehl. Da gehören sie hin, und mehr braucht es
nicht.

### N2 — zwei H2 tragen das Keyword, zwei sind reine Leserzeilen

**Besitzer: Nora, nur falls sie es im S1-Durchgang mitnehmen will. Ausdrücklich
optional, Kosten 0 Wörter.**

Meine Regel ist, dass jede H2 eine Phrase ist, die ein Leser suchen würde. Hier das
ehrliche Bild, alle sieben:

| H2 | Als Suchphrase |
|---|---|
| Chatbot, Agent, agentisches System | trägt das Keyword, Vergleichsabsicht |
| Woran du den Nutzen merkst | Leserzeile, keine Suchphrase |
| Drei Beispiele aus unserem eigenen Betrieb | schwach, Keyword fehlt |
| Wo ein agentisches System nichts bringt | trägt das Keyword |
| Was du in den nächsten Wochen entscheiden kannst | Leserzeile, keine Suchphrase |
| kraftwerk, unser Werkzeug dafür | Markenzeile |
| Häufige Fragen | Standard, richtig so |

**Ich verlange hier nichts umzubenennen**, und das ist bewusst: Rita hat den Ton
freigegeben, die Zielgruppe sind Entscheider, und H2 nach Suchphrasen umzuschreiben
macht aus einem nüchternen Text einen, der nach Suchmaschine klingt. Zwei von
sieben H2 tragen das Keyword, die Hierarchie hat **keine Sprünge** (nur H2 → H3,
kein H4), und `MdxContent` setzt über `rehypeSlug` auf jede Überschrift eine id —
jede H2 und jede H3 ist also als Sprungziel adressierbar, was für
Passagen-Indexierung genau das ist, was man will.

Eine einzige Umbenennung würde ich mitnehmen, wenn die Datei sowieso offen ist,
weil sie **kein Wort kostet** (6 Wörter vorher, 6 Wörter nachher) und dem Keyword
eine dritte Überschrift gibt:

> «Drei Beispiele aus unserem eigenen Betrieb»
> → «Drei agentische Systeme in unserem Betrieb»

Wenn Nora das nicht mag, bleibt es wie es ist. Kein Befund.

### N3 — Sidebar-Links mit Sprachprefix speichern, sonst kostet jeder einen Hop

**Besitzer: CMS-Schritt.**

`field_article_links` läuft durch `internalLinkUriToSlug` (`src/lib/utils.ts`
Zeile 53). Was die Funktion macht, und was daraus live folgt — alle drei Varianten
selbst abgefragt:

| Gespeichert als | Wird zu | Live |
|---|---|---|
| `internal:/de/blog/<slug>` | `/de/blog/<slug>` | **200, kein Hop** |
| `internal:/blog/<slug>` | `/blog/<slug>` | 307 → `/de/blog/<slug>` |
| `entity:node/<id>` | `/node/<id>` | 307 → 308 → Alias, **zwei Hops** |

Kein Hop ist kaputt, aber **`internal:` mit `/de/` ist die einzige Variante ohne
Umleitung.** Das ist nicht theoretisch: in der Sidebar von
`/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker` steht heute
`/blog/kraftwerk-deterministische-workflows-ai-agenten` ohne Prefix und läuft über
307. Deshalb stehen in meiner Tabelle oben alle vier `uri` mit `/de/`.

### N4 — `field_article_employee` und `field_article_services` füllen

**Besitzer: CMS-Schritt.**

`field_article_employee` wegen des `author` im `BlogPosting` (siehe oben) und weil
das Template Rolle, Telefon und E-Mail der Person im Hero und in der Sidebar
ausgibt. `field_article_services` rendert die Service-Verweise in der Sidebar und
ist ein zweiter interner Pfad zu den Angebotsseiten; die Komponente filtert auf
`service?.path?.alias`, ein Service ohne Alias fällt still raus.

---

## Befunde für Web — nicht für die Redaktion, keiner blockiert diesen Post

### W1 — Artikel liefern kein `FAQPage`-Schema, obwohl die Komponente existiert

Das ist der Befund mit dem grössten Hebel in dieser ganzen Prüfung, und er gehört
nicht diesem Post, sondern dem Frontend.

Dieser Entwurf hat einen FAQ-Block: H2 «Häufige Fragen», **vier Fragen als H3**, in
der Formulierung, in der Leute tippen. Genau richtig gebaut. Ausgeliefert wird
dafür **kein `FAQPage`-Schema**, und zwar nicht wegen eines Fehlers im Text:

- `src/components/seo/FaqJsonLd.tsx` existiert und funktioniert. Sie wird aus
  **zehn** hartcodierten Landingpages aufgerufen (`AiAgenturPage`, `DxpPage`,
  `DrupalAgenturPage`, `NextjsPage`, `WebagenturLuzernPage`, `WebsiteRelaunchPage`,
  `KiSchulungenPage`, `AiKursePage`, `museen`, `old-programme`) — und **nicht aus
  `NodeArticle.tsx`**. Artikel erzeugen nur `BlogPosting`.
- Live gegengeprüft, nicht nur im Code gelesen:
  `/de/blog/ki-assistenten-vs-ki-agenten` hat einen sichtbaren FAQ-Block mit
  **sieben** H3-Fragen und im HTML **0-mal** `FAQPage`. `/de/ai-agentur` hat
  `FAQPage` **1-mal**. Auch `/de/programme/agentic-ai` hat einen FAQ-Block mit
  sechs Fragen und **0-mal** `FAQPage`.

Das passt zum Roadmap-Stand im Wissensbundle: Epic 285, Punkt
**«Still in review: FAQPage schema for accordions (#2348)»**. Der Befund
präzisiert das Ticket: die Komponente ist fertig und im Einsatz, es fehlt der
Aufruf in `NodeArticle.tsx` und in der Programmseite. Für alle Blogposts mit
FAQ-Block zusammen ist das ein Rich-Result, das heute liegen bleibt.

**Für diesen Post heisst das: nichts tun.** Der sichtbare FAQ-Block wirkt bei
Antwortmaschinen auch ohne Schema, weil die den Text lesen. Der Block bleibt wie
er ist.

### W2 — 170 Knoten ohne Pfad-Alias in den Sitemaps

Beim Kannibalisierungs-Check durch alle Teil-Sitemaps gefunden. Es sind
inzwischen **neun** Teil-Sitemaps, nicht acht wie in meiner Notiz; zusammen
**567 URLs**. Davon sind **170 rohe `/de/node/<id>`-URLs** (140 in
`sitemap-articles.xml`, 21 in news, 5 in events, 4 in pages). Sie geben 200 und
kanonisieren auf sich selbst, zum Beispiel `/de/node/247` = «Das Smartphone
meistert unseren Alltag».

Das sind **keine Duplikate** — der Code behandelt aliasierte Knoten korrekt
(`page.tsx` leitet `/de/node/<id>` permanent auf den Alias um, und der Canonical
ist seit der GSC-Bereinigung 2026-09 der Alias). Diese 170 Knoten haben einfach
**keinen Alias**, deshalb bleiben sie unter der Node-ID in der Sitemap und im
Index. Alte Posts ohne sprechende URL, mitten im Artikelbestand. Eigener Auftrag
für Web, blockiert hier nichts.

### W3 — Positionierung von kraftwerk: eine Beobachtung zum offenen Entscheid

Ich löse den Entscheid nicht auf, er gehört Lukas. Zwei Fakten, die ihn
erleichtern und die ich beim Prüfen ohnehin hatte:

- `/de/programme/agentic-ai` nennt kraftwerk **0-mal**. Das Programm verkauft
  genau das, was dieser Post beschreibt («Agenten-Architektur», «Evaluation &
  Guardrails», «Betrieb & Monitoring»), und erwähnt das eigene Werkzeug nicht.
- `/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker` nennt kraftwerk
  **6-mal**. Es gibt also schon zwei Blogposts, die auf das Werkzeug zeigen, und
  keine Seite, auf die sie zeigen können.

Das stützt Noras Empfehlung (a) jetzt, (b) sobald eine zweite Quelle darauf
verlinkt. Die zweite Quelle existiert bereits.

---

## Backlinks auf diesen Post — der stärkste Hebel für eine neue URL

Eine neue URL hat keine internen Links auf sich. Zwei Stellen, beide im CMS
änderbar. **Beide Quellposts habe ich vorher gelesen und ihr Publikationsdatum
geprüft** — auf Task 4 habe ich einen Link in einen Post von 2016 verlangt, der
Drupal 8 und WCAG 2.0 noch für aktuell hielt. Das passiert hier nicht: beide sind
von 2026 und inhaltlich aktuell.

**1. `/de/blog/agentic-work-system-bauplan` (1.7.2026) — der wichtigere.**
Stelle: Abschnitt «Vom Werkzeug zum System», direkt nach dem Absatz, der mit «Ein
agentisches Arbeitssystem dreht das um» beginnt. Anchor-Text:

```
drei agentische Systeme in unserem Betrieb
```

Warum genau dort: dieser Post verwendet **4-mal** «agentisches Arbeitssystem» und
ist damit der einzige Nachbar, der denselben Begriff in einer anderen Wortform
besetzt. Ein Link von ihm auf uns macht die Arbeitsteilung explizit — er ist der
Bauplan, wir sind die Belege.

**2. `/de/blog/persistente-ki-mitarbeiter-persistent-ai-coworker` (2.9.2026).**
Stelle: Abschnitt «Der Agentic Workspace». Anchor-Text:

```
was ein agentisches System aus solchen Rollen macht
```

Das ist die Gegenrichtung zu S1: wenn beide Posts aufeinander zeigen, ist die
Abgrenzung für Google und für den Leser in beide Richtungen gesetzt. Besitzer:
CMS-Schritt beziehungsweise Web.

Kein «hier klicken» in beiden Fällen, und keiner der beiden Anchor-Texte ist
identisch mit unserem Titel — sonst konkurrieren Anchor und Titel um dieselbe
Phrase.

---

## Suchabsicht, so wie ich sie sehe

**Hauptkeyword: «agentische Systeme».** Unbesetzt auf netnode.ch (0 von 9
geprüften Seiten), 7-mal im Körper, im Titel, im Teaser und im Slug.

**Sekundär**, alle mit der Zahl, wie oft sie im Körper vorkommen: «agentisches
System» im Singular (in den 7 enthalten), «Chatbot» (4), «Agent/Agenten» (24),
«deterministisch» (4), «Prüfschritt/Prüfung», «Spur» (3), «Logzeile» (4),
«Freigabe» (4).

**Wer das in der Schweiz sucht und was er danach tut:** GL, Marketing- und
IT-Verantwortung, die KI als Chatfenster kennen und wissen wollen, was ein System
ist, das Arbeit übernimmt. Nächster Schritt nach dem Lesen: intern begründen,
warum das kein Spielzeug ist — deshalb ist der Abschnitt «Was du in den nächsten
Wochen entscheiden kannst» der wertvollste Teil des Posts und sollte nicht
gekürzt werden, wenn jemand Wörter sucht.

**Text und Keyword ziehen nicht auseinander.** Das ist der Befund, der bei mir
sonst am häufigsten kommt, und er trifft hier nicht zu: der erste Satz des Körpers
ist die Definition, das Keyword steht darin, und die ersten 39 Wörter beantworten
die Frage, die der Titel stellt.

**Geschätzte Suchnachfrage: keine Zahl.** Ich habe kein Keyword-Tool, und die
GSC-Auswertung ist drei Monate April bis Juli 2026 und enthält «agentische
Systeme» nicht. Was sie zeigt, ist das Umfeld: «agentic coding» 2'738
Impressionen auf Position 5.5, «agentic engineering» 464 auf 14.2 — die
agentic-Begriffsfamilie rankt für netnode.ch bereits. Mehr als diese Einordnung
ist belegbar nicht drin, und eine Zahl dazuzuschreiben wäre genau das, was Rita in
Runde eins zweimal zu Recht kassiert hat.

---

## GEO — zitiert werden von Antwortmaschinen

Was schon richtig ist, und das ist das meiste:

- **Ein zitierfähiger Satz pro Abschnitt.** «Der Agent schlägt vor, der Code
  entscheidet» trägt den ganzen Post und steht zweimal, als Satz und als H3.
- **Entitäten ausgeschrieben.** «NETNODE» 1-mal gross, «netnode» 7-mal,
  «kraftwerk» 6-mal, «Claude Code, Codex oder Pi» wörtlich,
  `npm install -g @netnodeag/kraftwerk` und «Node 20 oder neuer» als Zeichenkette.
  Antwortmaschinen matchen Zeichenketten, nicht Bedeutungen — das ist hier
  erledigt.
- **Die FAQ ist richtig gebaut:** vier Fragen, als **H3**, nicht als fette
  Satzanfänge, in der Formulierung, in der Leute tippen. Zum fehlenden Schema
  siehe W1.
- **Jeder Absatz überlebt das Einzelzitat.** Ich habe die vier FAQ-Antworten und
  die drei Vorher/Heute/Mensch-Blöcke einzeln gelesen, ohne den Absatz davor.
  Sie tragen. Ritas NV1 ist genau dieser Prüfung entsprungen und ist der einzige
  Punkt, an dem eine Antwort allein zitiert enger klingt als der Fliesstext — ihr
  Fix («bestätigt» → «entscheidet») ist richtig, und er gehört in den S1-Durchgang.
- **Datum:** siehe N1, das Template liefert es.

Was fehlt, und warum ich es trotzdem nicht verlange: **ein
Inhaltsverzeichnis am Anfang.** Die beiden nächsten Nachbarn haben eines
(`agentic-work-system-bauplan` als H2 «Inhaltsverzeichnis»,
`persistente-ki-mitarbeiter` als H2 «Inhalt»), und es ist **kein Template-Element**
— ich habe im Frontend-Repo nach einer TOC-Komponente gesucht und keine gefunden,
die beiden sind also von Hand im Markdown gebaut. Bei 7 H2 und 19 H3 wäre ein
Verzeichnis ein echter Gewinn für Sprungziele und Sitelinks. Es kostet aber
mindestens 25 bis 30 Wörter plus Ankersyntax, und die Decke ist nach S1 bei 6
Wörtern Restluft. **Entweder-oder, und S1 ist wichtiger.** Wenn die Menschen die
Wortdecke anheben, ist das Inhaltsverzeichnis der erste Kandidat für die
freiwerdenden Wörter — vor Ritas zwei Kürzungen. Besitzer dann: Nora.

---

## Was ich geprüft habe, und wie

Damit niemand es nachsuchen muss, und damit sichtbar ist, was ich **nicht** geprüft
habe.

| Check | Wie |
|---|---|
| Kannibalisierung | alle **neun** Teil-Sitemaps unter `/de/sitemap.xml` geholt, **567 URLs**; davon **185** `/de/blog/`-Slugs und **170** `/de/node/<id>`. Neun Kandidatenseiten im Volltext auf «agentische(s) System(e)» geprüft: **0 Treffer**. |
| Der fehlende Task-1-Post | Nora und Rita sagen, «KI-Agenten im Unternehmen: drei Fragen vor dem Start» gibt es nicht. **Unabhängig nachgeprüft und bestätigt, auf breiterer Basis:** ich habe zusätzlich den `<title>` **aller 170** alias-losen Node-URLs abgerufen — auch dort ist er nicht. Punkt 5 der CMS-Liste steht damit auf festerem Grund als vorher. |
| Zielseite des CTA | `/de/programme/agentic-ai` im Volltext gelesen. **Keine Lücke wie auf Task 4** — der Post verspricht nichts, was dort fehlt. Das Problem ist umgekehrt: der Post verlinkt sie gar nicht. Gelöst in `field_article_links` Nummer 1. |
| Metadaten-Felder | `src/app/[lang]/[...slug]/page.tsx`, `NodeArticle.tsx`, `ArticleHero.tsx`, `ArticleSidebar.tsx`, `src/lib/json-ld/article-json-ld.ts`, `src/lib/og-screenshot.ts`, `src/lib/utils.ts`, `src/components/seo/FaqJsonLd.tsx` gelesen. |
| Search Console | `repos/frontend.netnode.ch/seo/data/a1-gsc-2026-07.md`, drei Monate April bis Juli 2026. |
| Redirects | Wissenskonzept `netnode-website/seo/redirects-and-canonical`. |
| URLs | alle **4** im Körper selbst aufgerufen, alle **200**. Plus der neue Slug (**404**, also frei) und die drei Sidebar-Formate. |
| Zahlen aus Log und Review | **nicht übernommen, selbst gezählt** am extrahierten Feldwert: 1373 / 1399 / 9484 / 0 H1 / 7 H2 / 19 H3 / 4 URLs / keine Sprünge. Alle deckungsgleich mit Rita. |
| Wortkosten von S1 | Einfügung in den Feldwert eingesetzt und neu gezählt: 1393, mit NV3 1394. |

**Nicht geprüft, und darum keine Behauptung dazu:** die Suchnachfrage für
«agentische Systeme» (kein Keyword-Tool, siehe oben), und die GSC-Lage seit Juli
2026 — die Auswertung ist vier Monate alt.

Zwei Korrekturen an meinen eigenen Notizen, die ich im Wissensbundle nachziehe:
es sind **neun** Teil-Sitemaps, nicht acht; und das `og:image` eines Artikels ist
ein Screenshot **1600×900** (`og-screenshot.ts` Zeile 21), das Fallback-Objekt
daneben ist 1200×630 — für Artikel greift der Screenshot.

---

## Zusammengefasst für den Menschen

**Blockierend: ein Befund.** S1, der fehlende Link auf
`persistente-ki-mitarbeiter` — die einzige Kannibalisierungsstelle, 20 Wörter,
Besitzer Nora, zusammen mit Ritas NV1 bis NV4 in einem Durchgang.

**Fertig und copy-paste-bereit:** Titel (47/47), Slug (`agentische-systeme`, frei),
`field_teaser_text` (152 Zeichen), Lead (309, unverändert), `field_article_links`
(4 Einträge mit `uri`), Dateiname und Alt-Text für `field_teaser_image`.

**Zwei Entscheide gehören weiterhin den Menschen und keinem von uns:** die
Positionierung von kraftwerk auf netnode.ch (W3 liefert zwei Fakten dazu) und die
Anredeform, letztere zusammen mit Task 4. **Titel und Teaser-Text, die ich liefere,
enthalten keine Anredeform** — sie müssen also nicht angefasst werden, wie der
Entscheid auch ausfällt.

**Ein Befund für Web mit Hebel über diesen Post hinaus:** W1, das fehlende
`FAQPage`-Schema auf allen Artikeln (Ticket #2348 präzisieren).
