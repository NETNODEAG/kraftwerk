# SEO-Prüfung — BehiG-Revision / Barrierefreiheit

Verdict: ok

Geprüfte Datei: **`draft-v2.md`** (die von Rita empfohlene Fassung, Stand
7. November 2026). `draft.md` habe ich für Titel, Slug und Keyword-Abdeckung
mitgelesen, aber nicht on-page geprüft; die Werte unten gelten für v2, und was
sich bei einer Entscheidung für v1 ändert, steht am Schluss unter «Falls die
Menschen v1 nehmen». Der Slug ist für beide Fassungen derselbe, der
Fassungsentscheid ändert die URL also nicht.

Nichts an diesem Post blockiert die Veröffentlichung. Die Befunde unten sind alle
im CMS-Schritt erledigt, während der Text eingestellt wird — dafür braucht es
keine neue Runde bei Nora.

---

## Für das CMS

Wichtig vorweg, weil es die Werte bestimmt: Dieses Frontend hat **kein eigenes
Meta-Title- und kein eigenes Meta-Description-Feld**. Es nimmt

| Was im HTML landet | Woher es kommt |
| --- | --- |
| `<title>` und `<h1>` | der **Node-Titel** (`title`), plus automatisch ` \| NETNODE AG` |
| `<meta name="description">`, `og:description`, Teaser in der Blog-Liste und im RSS | **`field_teaser_text`** |
| sichtbarer Lead über dem Bild | **`field_article_leadtext`** |
| Textkörper | **`field_markdown`** |
| Hero- und Listenbild | **`field_teaser_image`** (Alt-Text am Medium) |
| Links in der Sidebar | **`field_article_links`** (Titel + URL) |
| `og:image` | automatisch, Screenshot der Seite über `preview.nodehive.com`, 1600×900 |
| `BlogPosting`-JSON-LD | automatisch aus dem Node |

(Feldnamen aus dem Frontend-Code: `src/app/[lang]/[...slug]/page.tsx` und
`src/components/node/article/NodeArticle.tsx`. Die Labels in NodeHive können
anders heissen, die Felder sind dieselben.)

Daraus folgt zweierlei: Meta-Title und H1 sind **physisch dasselbe Feld** — die
Regel «H1 nicht gleich Meta-Title» ist hier nicht erfüllbar, ausser Web baut ein
Override-Feld ein. Und der Titel hat nur **47 Zeichen Budget**, weil das Template
` | NETNODE AG` 13 Zeichen anhängt.

### Node-Titel (= Meta-Title = H1)

```
Barrierefreie Website Schweiz: Pflicht ab 2027?
```

47 Zeichen, mit Suffix im SERP **60 Zeichen** («Barrierefreie Website Schweiz:
Pflicht ab 2027? | NETNODE AG»). Hauptkeyword vollständig in den ersten 29
Zeichen, keine Markendoppelung.

Warum nicht Noras Vorschlag «Barrierefreie Website Schweiz: Pflicht oder noch
nicht?»: 55 Zeichen plus Suffix sind 68, Google schneidet dort ab. Der Keyword-
Teil ist derselbe, der hintere Teil kostet nur Platz. Warum nicht die Überschrift
des Entwurfs «Muss deine Website barrierefrei sein? Der Stand in der Schweiz»:
62 plus 13 sind 75, davon sieht man im SERP etwa drei Viertel, und das
Hauptkeyword steht nicht als Phrase drin.

Die Jahreszahl im Titel ist Absicht und widerspricht dem Post nicht: Gesucht wird
«barrierefreiheit 2027 schweiz» und «behig 2027», der Titel stellt die Frage und
der erste Absatz beantwortet sie mit «kein Datum». Ein Titel ist jederzeit ohne
Redirect änderbar — wenn 2027 vorbei ist, ändert man ihn. Im Slug hat eine
Jahreszahl deshalb nichts zu suchen (siehe unten).

Alternative ohne Jahreszahl, falls jemand die Frage im Titel nicht will:

```
Barrierefreie Website Schweiz: gilt die Pflicht?
```

48 Zeichen, mit Suffix 61.

### `field_teaser_text` (= Meta-Description, Listenteaser, RSS)

```
Barrierefreie Website in der Schweiz: Für Bund und EU-Verkauf gilt die Pflicht heute, für private Anbieter nicht. Prüfe in der Tabelle, ob du betroffen bist.
```

157 Zeichen. Hauptkeyword am Anfang, Verb und Klickversprechen am Schluss
(«Prüfe in der Tabelle»), kein Zusammenfassungs-Satz. Sie-Form, falls der
du/Sie-Entscheid auf Sie fällt (148 Zeichen):

```
Barrierefreie Website in der Schweiz: Für Bund und EU-Verkauf gilt die Pflicht heute, für private Anbieter nicht. Prüfen Sie, ob Sie betroffen sind.
```

Noras Vorschlag («Für den Bund und den EU-Verkauf gilt die Pflicht heute, für
alle anderen noch nicht. Was wirklich beschlossen ist und welche fünf Barrieren
zählen.», 147 Zeichen) ist formal in der Länge, enthält aber das Wort
«barrierefrei» in keiner Form und endet ohne Verb. Beides kostet messbar: im SERP
fällt die Fettung des Suchworts weg, und derselbe Text steht als Teaser in der
Blog-Liste und im RSS.

### Slug und URL

```
barrierefreie-website-schweiz-pflicht
```

Volle URL: `https://netnode.ch/de/blog/barrierefreie-website-schweiz-pflicht`

Vier Wörter, Kleinschreibung, Bindestriche, Hauptkeyword als Phrase, keine
Stoppwörter, keine Umlaute (die bestehenden Slugs transliterieren: `fuer`,
`loesungen`, `masseinheiten`), **keine Jahreszahl** — der Post bleibt gültig, wenn
das Parlament 2027 oder 2028 entscheidet, und ein Slugwechsel nach der
Veröffentlichung kostet einen Redirect in `next.config.js`. Richtiger Abschnitt
`/de/blog/`, wie beauftragt. Keine Kollision mit `/de/blog/drupal-barrierefrei`
und `/de/blog/barrierefreie-museums-website`.

### H1

Identisch mit dem Node-Titel, siehe oben — das Frontend lässt keinen
Unterschied zu. Im Markdown-Körper darf die `# …`-Zeile deshalb **nicht**
mitkopiert werden, sonst steht die H1 zweimal auf der Seite.

### `field_article_leadtext` (sichtbarer Lead)

Der «Kurz:»-Absatz des Entwurfs gehört in dieses Feld, nicht in den
Markdown-Körper — dann steht die Antwort über dem Bild, im HTML ganz vorne, und
sie ist das, was ein Antwortsystem zuerst liest:

```
Wenn du für Bund, Kanton oder Gemeinde arbeitest oder in der EU an Konsumenten verkaufst, musst du schon heute. Für private Anbieter in der Schweiz ist die Barrierefreiheits-Pflicht in Vorbereitung, aber nicht beschlossen, und sie hat kein Datum.
```

Der Rest des Absatzes («Diskriminieren darfst du allerdings auch heute nicht …»)
bleibt als erster Absatz im Körper.

### og:image

Nichts zu liefern: Für Artikel setzt das Frontend `og:image` automatisch auf
einen Live-Screenshot der Seite (1600×900, `preview.nodehive.com`). Kein
1200×630-Teaserbild nötig. Das heisst aber: **das og:image ist der obere
Seitenrand** — Titel und Lead müssen dort gut aussehen, und der Screenshot wird
erst nach der Veröffentlichung richtig.

Gebraucht wird trotzdem ein `field_teaser_image` (Hero und Blog-Liste).
Dateiname mit Keyword, Alt-Text beschreibend (Zugänglichkeit vor SEO, die
Eigenwerbung dieses Posts hängt daran):

- Datei: `barrierefreie-website-schweiz-behig-2027.jpg`
- Alt: `Tastatur-Fokusrahmen auf einem Webformular, daneben der Kontrastwert des Textes`
  (Alt-Text an das tatsächliche Bild anpassen — er beschreibt das Bild, nicht den Post.)

### Schema

- `BlogPosting` kommt automatisch (`generateArticleJsonLd`), zusammen mit
  `Organization`, `WebSite` und `BreadcrumbList` aus dem Root-Layout. Nichts zu tun.
- Gewünscht wäre **`FAQPage`** für den FAQ-Block (Befund 5). Das Schema für
  Accordions ist Roadmap-Ticket 2348 und steht laut Knowledge-Bundle
  `netnode-website/seo/redirects-and-canonical` noch im Review, ist also
  vermutlich nicht verfügbar. Der FAQ-Block hilft den Antwortmaschinen auch ohne
  Schema; wer ihn im Markdown schreibt, bekommt das Schema später gratis dazu.

---

## Befunde

### 1. Die Suchphrase «barrierefreie Website» kommt im Text nicht vor

In der geprüften Datei (2747 Wörter inklusive Inhaltsverzeichnis und
Referenzen; Rita zählt 2096 Wörter im Fliesstext) steht «barrierefrei» genau
einmal, nämlich in der
Überschrift «Muss deine Website **barrierefrei** sein?». Die Phrase
«barrierefreie Website» steht null Mal, «Schweiz» fünf Mal. Das Hauptkeyword der
Fertig-wenn-Liste ist «barrierefreie Website Schweiz».

Semantisch trifft der Post die Suchabsicht sehr genau — das ist der Grund, warum
das kein Blocker ist. Für die exakte Phrase reicht es aber nicht, dass sie nur im
Titel steht. Zwei Stellen, beide beim Einstellen erledigt:

- Die Überschrift **«Gilt es für dich? Die kurze Antwort»** wird zu
  **«Barrierefreie Website in der Schweiz: Gilt die Pflicht für dich?»** — der
  Abschnitt mit der Tabelle ist der, der zu dieser Suche rankt.
- Im ersten Absatz nach der Tabelle, vor «Für Bund, Kantone und Gemeinden gilt
  das Behindertengleichstellungsgesetz», einen Satz einschieben:
  «Ob eine barrierefreie Website in der Schweiz Pflicht ist, hängt davon ab, für
  wen du sie betreibst.»

### 2. Ein einziger interner Link, und er zeigt auf die falsche Seite

Der Post verlinkt genau eine netnode-Seite:

> Genau das macht unser Programm [Website Check](https://netnode.ch/de/programme),
> Barrierefreiheit eingeschlossen

`/de/programme` ist die Übersicht aller zwölf Programme. Die Zielseite ist
`https://netnode.ch/de/programme/website-check` («Website Check Schweiz –
unabhängige Website-Analyse», self-canonical). Ein Klick weniger, und der Link
zeigt auf die Seite, die der Ankertext verspricht.

Dazu fehlen die beiden einzigen thematisch verwandten Seiten der Domain. Beide
sollten aus dem Fliesstext verlinkt werden, mit beschreibendem Ankertext:

- `https://netnode.ch/de/blog/barrierefreie-museums-website` (25. Juni 2026) —
  im Abschnitt «Worum es geht, in drei Beispielen» oder bei den fünf Barrieren,
  Anker etwa «was eine barrierefreie Museums-Website ausmacht».
- `https://netnode.ch/de/blog/drupal-barrierefrei` (11. November 2016) — bei
  Barriere 3 oder 4, Anker etwa «welche Eigenschaften von Drupal dabei helfen».
  Der Post ist zehn Jahre alt; wenn ihn niemand mehr vertreten will, bleibt er
  weg, dann aber bitte als Entscheid und nicht aus Versehen.

Zusätzlich im CMS, ohne den Text anzufassen: **`field_article_links`** füllt die
Sidebar mit echten Links. Vorschlag für die drei Einträge:

| Titel | URL |
| --- | --- |
| Website Check: unabhängige Analyse deiner Website | https://netnode.ch/de/programme/website-check |
| Barrierefreie und mehrsprachige Museums-Website | https://netnode.ch/de/blog/barrierefreie-museums-website |
| Fünf Eigenschaften, die Drupal barrierefreier machen | https://netnode.ch/de/blog/drupal-barrierefrei |

**Und die Gegenrichtung**, die wichtiger ist als alle Links aus dem neuen Post
heraus: `/de/blog/barrierefreie-museums-website` hat den Abschnitt «Rechtlicher
Rahmen in der Schweiz» mit dem Satz

> Für Bund und bundesnahe Betriebe gilt Barrierefreiheit längst als Pflicht
> (Behindertengleichstellungsgesetz, Standard eCH-0059 auf Basis der WCAG).
> Kantone und Städte ziehen nach …

Genau dort gehört ein Link auf den neuen Post, Ankertext etwa «ob die Pflicht
auch für private Anbieter gilt». Das ist eine CMS-Änderung an einem bestehenden
Node und der stärkste interne Startschuss, den die neue URL bekommen kann.

### 3. Der Ankertext verspricht etwas, das die Zielseite nicht sagt

> Genau das macht unser Programm Website Check, **Barrierefreiheit
> eingeschlossen**, mit einer Liste nach Aufwand und Wirkung.

Auf `/de/programme/website-check` kommt das Wort «Barrierefreiheit» **null Mal**
vor (abgefragt am 7. November 2026). Die Seite nennt als Themen Performance,
Sicherheit, SEO/GEO, UX und Konkurrenz, in «Ihr Nutzen» sechs Punkte, keiner
davon Zugänglichkeit.

Das ist kein Textfehler von Nora, sondern eine Lücke zwischen Post und
Landingpage, und sie kostet die Conversion dieses Posts. Zwei Wege, der erste ist
der bessere: Barrierefreiheit als siebten Nutzenpunkt auf die Programmseite
(dann rankt sie selbst für «website check barrierefreiheit»), oder im Post
«Barrierefreiheit eingeschlossen» streichen. Entscheid liegt bei den Menschen,
umsetzen müsste es Web.

### 4. Die fünf Barrieren sind fett gesetzt, nicht als Überschriften

> **1. Text, der zu hell ist.** Auf 83,9 Prozent der geprüften Startseiten …

Die fünf Barrieren sind der Teil des Posts, der am besten zitierbar ist: je eine
Zahl, je eine Zuständigkeit, je ein Aufwand. Als fetter Satzanfang bekommen sie
keine `id`, keinen Ankerlink und keinen eigenen Eintrag in einem
Google-Sprungziel, und ein Antwortsystem sieht fünf Absätze statt fünf
Abschnitte.

Vorschlag: `### 1. Text, der zu hell ist` bis `### 5. Bedienbarkeit ohne Maus`.
Die Hierarchie bleibt sauber (H1 → H2 → H3, keine Sprünge), das
Inhaltsverzeichnis bleibt unverändert, und «Die fünf häufigsten Barrieren» bleibt
die H2 darüber.

### 5. Kein FAQ-Block — die Antwortmaschinen bekommen nichts zum Zitieren

Der Post ist für GEO gut gebaut: Entitäten stehen ausgeschrieben (BehiG neun
Mal, eCH-0059 vier Mal, WCAG acht Mal), jeder Abschnitt trägt eine datierte Zahl,
und «Stand 7. November 2026» steht sichtbar im Text. Was fehlt, ist der Block, der
in den Antwortmaschinen am häufigsten wörtlich übernommen wird. Vier Fragen in
der Formulierung, in der sie getippt werden, mit Antworten, die alleine stehen —
fertig zum Einfügen vor den Referenzen:

```markdown
## Häufige Fragen

**Ist eine barrierefreie Website in der Schweiz Pflicht?**
Für Dienstleistungen des Gemeinwesens ja: Das Behindertengleichstellungsgesetz
(BehiG, SR 151.3) erfasst sie in Artikel 3 Buchstabe e, und Artikel 8 Absatz 1
gibt einen Anspruch auf Beseitigung der Benachteiligung. Für private Anbieter in
der Schweiz gibt es, Stand 7. November 2026, keine Pflicht zu einer bestimmten
Stufe, sondern nur das Diskriminierungsverbot in Artikel 6 BehiG.

**Kommt die Barrierefreiheits-Pflicht am 1. Januar 2027?**
Nein, dieses Datum steht in keiner amtlichen Quelle. Die BehiG-Revision
(Geschäft 25.020) liegt am 7. November 2026 in der Kommission des Nationalrats,
keine der beiden Kammern hat darüber abgestimmt, und ein Inkrafttretensdatum ist
nirgends festgelegt.

**Gilt das BehiG auch für private Unternehmen?**
Ja, aber anders als für den Bund: Nach Artikel 6 BehiG dürfen Private, die
Dienstleistungen öffentlich anbieten, nicht diskriminieren. Der Rechtsbehelf ist
eine Entschädigung von höchstens 5000 Franken (Artikel 11 Absatz 2), nicht die
Beseitigung der Barriere.

**Gilt in der Schweiz WCAG 2.1 oder WCAG 2.2?**
Verbindlich für den Bund ist WCAG 2.1 Stufe AA, über den Standard eCH-0059
Version 3.0 vom 25. Juni 2020. WCAG 2.2 ist die neuere Fassung der Richtlinie,
in eCH-0059 aber nicht referenziert — die Angabe «WCAG 2.2 AA» auf vielen
Anbieterseiten ist für die Schweiz falsch.
```

Die vierte Frage bedient gleichzeitig die beauftragte Suchlogik «WCAG 2.2 AA
Schweiz», und das ist ihr eigentlicher Wert: Gesucht wird nach 2.2, richtig ist
2.1, und wir sind die Seite, die den Unterschied erklärt. Im Fliesstext steht
«WCAG 2.2» heute nur als «die neuere Fassung 2.2» — die Zeichenfolge, auf die
eine Suchmaschine matcht, kommt dort nicht vor.

### 6. Kannibalisierung: geprüft, keine

Ich habe alle 559 URLs aus den acht Teil-Sitemaps von netnode.ch gezogen
(`/de/sitemap.xml`, abgefragt am 7. November 2026) und nach Barrierefreiheit
durchsucht. Treffer sind genau zwei:

| Seite | Datum | Zielsuche |
| --- | --- | --- |
| `/de/blog/drupal-barrierefrei` | 11.11.2016 | «drupal barrierefrei» |
| `/de/blog/barrierefreie-museums-website` | 25.06.2026 | «barrierefreie museums-website» |

Beide konkurrieren nicht um «barrierefreie Website Schweiz» oder «BehiG Pflicht»:
Der eine Post ist auf Drupal-Eigenschaften gedreht, der andere auf Museen, und
Museums-Keywords haben laut Knowledge-Bundle `netnode-website/seo/competitors`
praktisch kein Volumen. Eine kleine Überlappung hat der Museums-Post, weil
«Pflicht» in seinem Titel steht und sein Abschnitt «Rechtlicher Rahmen in der
Schweiz» dasselbe Thema anfasst. Richtung sauber halten: Der neue Post ist das
Ziel für die Rechtsfrage, der Museums-Post verlinkt dorthin (Befund 2) und bleibt
bei den Museen. Nachtragen muss ihn niemand — er behauptet den 1. Januar 2027
nicht, ich habe seinen Rechtsabschnitt im Volltext gelesen.

In der Search Console (`seo/data/a1-gsc-2026-07.md`, drei Monate bis 1.7.2026)
kommt keine einzige Barrierefreiheits-Suche vor, in den Top-30-Queries und
Top-50-Impressionen jedenfalls nicht. Die neue URL startet also ohne eigene
Historie: Der interne Link aus dem Museums-Post ist der schnellste Hebel, den sie
hat.

### 7. Suchabsicht: der Post passt zum Keyword, mit einer Einschränkung

Hauptkeyword: **«barrierefreie Website Schweiz»** (geschätzt, kein Keyword-Tool,
wie in task.md verlangt). Sekundär: «BehiG Pflicht», «Barrierefreiheit 2027
Schweiz», «eCH-0059», «WCAG 2.2 AA Schweiz».

Wer das sucht, ist in der Schweiz Entscheiderin oder Entscheider in GL oder
Marketing und will eine einzige Sache wissen: muss ich? Die Tabelle «Gilt es für
dich?» beantwortet genau das in vier Zeilen, und der nächste Schritt dieser
Leserschaft ist eine Messung — also der Website Check. Passt.

Die Einschränkung: v2 hat die Jahreszahl aus der Schlagzeile genommen. «behig
2027» und «barrierefreiheit 2027 schweiz» sind die Suchen, bei denen wir das
einzige richtige Ergebnis im Netz wären, und ohne die Zahl im Titel treten wir
dort schwächer an. Genau deshalb steht sie in meinem Titelvorschlag, und genau
deshalb ist die Überschrift «Woher die Jahreszahl 2027 kommt» (im Markdown) die
wichtigste H2 des Posts — die bitte nicht umbenennen.

---

## Nits, keiner blockiert

1. **Zwei Website-Check-Seiten.** `/de/programme/website-check` und
   `/de/website-check` existieren beide, beide self-canonical, gleiches Thema.
   Das ist ein eigener Task für Web (eine Seite gewinnt, die andere bekommt einen
   Redirect in `next.config.js`), hier nur als Notiz: Verlinkt wird aus dem Post
   die Programmseite.
2. **Stand-Datum.** «Heute, Stand 7. November 2026» im Abschnitt zur Jahreszahl
   und die drei Abfragedaten in den Referenzen am Publikationstag nachziehen —
   Rita hat das schon notiert. Für die Antwortmaschinen ist das sichtbare Datum
   im Text wertvoller als `dateModified`, also bitte wirklich im Text ändern.
3. **Umlaut-Anker.** Neun Anker im Inhaltsverzeichnis mit Umlauten
   (`#gilt-es-für-dich-die-kurze-antwort`, `#die-fünf-häufigsten-barrieren`).
   Rita hat das Durchklicken schon in `review-v2.md`; falls das Markdown-Rendering
   Umlaute anders normalisiert als erwartet, sind es ausserdem neun kaputte
   Sprungziele in Googles «Jump to»-Links.
4. **`#inhalt`.** Das Inhaltsverzeichnis steht als H2 «Inhalt» im Dokument. Das
   ist in den bestehenden Posts so und bleibt, nur zur Sicherheit erwähnt: Es ist
   die einzige H2 ohne eigene Suchphrase.
5. **Lesbarkeit im SERP-Snippet.** Die Tabelle «Gilt es für dich?» ist der
   Abschnitt, aus dem Google ein Snippet zieht. Dort steht in Zeile 4 «Die
   Barrierefreiheits-Pflicht noch nicht.» — ohne Kontext gelesen heisst das
   «keine Pflicht». Ein Wort mehr («In der Schweiz noch nicht …») schützt vor der
   Verkürzung, die der ganze Post bekämpft.
6. **2096 Wörter** sind für diese Suche kein Problem, im Gegenteil: Die Posts,
   die zu Rechtsfragen ranken, sind lang. Der Längenentscheid ist aus
   SEO-Sicht keiner.

---

## Falls die Menschen v1 nehmen

Geprüft habe ich v2. `draft.md` habe ich für die vier Werte mitgelesen; was sich
ändert:

- **Node-Titel**: Die Überschrift von v1 («Barrierefreiheit: Alle nennen den
  1. Januar 2027. Beschlossen ist er nicht.», 76 Zeichen) ist als Titel zu lang
  und enthält das Hauptkeyword nicht. Mein Vorschlag oben passt auch zu v1,
  inhaltlich sogar besser, weil v1 die Jahreszahl im Zentrum hat.
- **`field_teaser_text`**: derselbe Wert wie oben.
- **Slug**: derselbe. Der Fassungsentscheid ändert die URL nicht.
- **Befund 1** ist bei v1 kleiner («barrierefreie Website» kommt einmal vor,
  «Schweiz» einmal), aber nicht erledigt: Die H2-Umbenennung entfällt, der
  eingeschobene Satz bleibt sinnvoll.
- **Befunde 2, 3, 5** gelten unverändert: v1 hat denselben einen Link auf
  `/de/programme`, dieselbe Zusage «Barrierefreiheit eingeschlossen» und keinen
  FAQ-Block.
- **Befund 4** gilt auch: v1 setzt seine fünf Regeln ebenfalls fett statt als H3.

---

*Geprüft von Sven (SEO) am 7. November 2026. Quellen dieser Prüfung:
`draft-v2.md` und `draft.md` im Task-Ordner; `/de/sitemap.xml` mit allen acht
Teil-Sitemaps, `/de/blog.xml`, `/de/programme/website-check`,
`/de/blog/barrierefreie-museums-website` und `/de/blog/drupal-barrierefrei`
(alle abgefragt am 7. November 2026); `repos/frontend.netnode.ch` für die
Metadaten-Felder und das Titel-Template; Knowledge-Bundle `netnode-website`
(`seo/redirects-and-canonical`, `seo/competitors`); `seo/data/a1-gsc-2026-07.md`
für die Search-Console-Lage. Suchvolumen sind geschätzt, es gibt kein
Keyword-Tool in diesem Workspace.*
