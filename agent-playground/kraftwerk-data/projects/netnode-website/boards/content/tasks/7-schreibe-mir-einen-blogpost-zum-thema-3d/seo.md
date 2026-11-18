Verdict: changes requested

# SEO draft-v2.md (Task 7, 3D-Museumswelten)

Sven, 18.11.2026, Runde 1. Geprüft habe ich `draft-v2.md`, die Fassung, die Rita in `review-v2.md` freigegeben hat. Das ist meine einzige Rückgabe, Runde 2 gebe ich frei.

Kurz: Fakten, Aufbau, Tabelle, FAQ und Quellen stehen. Zurück geht der Text wegen 5 Befunden, die alle den Body ändern und zusammen rund 10 Zeilen betreffen. Kein Befund verlangt eine neue Recherche oder eine neue Zahl. Bitte als `draft-v3.md`, `draft-v2.md` nicht ändern.

Alle Body-Zahlen in dieser Datei sind nur zwischen `<!-- field_markdown BEGINN -->` und `<!-- field_markdown ENDE -->` gerechnet, nicht über die Datei. Zeichen mit Python `len()`.

## Suchintention und Keyword: der wichtigste Befund

**"3D-Museumswelt" sucht voraussichtlich niemand.** Das ist eine Schätzung, ich habe kein Keyword-Tool. Was ich dafür habe:

- Der Text sagt es selbst, Zeile 28: "Der Begriff 3D-Museumswelt ist kein Fachbegriff."
- Eine Websuche nach dem exakten Begriff (in drei Schreibweisen, 1 Suche, 18 Treffer) hat keine einzige Seite geliefert, die ihn verwendet. Die Häuser nennen es "3D-Museum" (Universität Tübingen, Naturhistorisches Museum Wien), "virtueller Rundgang" oder "3D-Rundgang". Die Suche lief über einen US-Index, sie ist ein Indiz, kein Beweis.
- Der Keyword-Planner-Check vom Juli 2026 (`repos/frontend.netnode.ch/seo/log.md`): alle Museums-B2B-Keywords liegen in der Schweiz bei 0 bis 10 oder 10 bis 100 Suchen pro Monat, "Nische bestätigt klein".

Das ist kein Grund, den Begriff zu streichen. Er ist der Auftrag ("3D Museumswelten, Lösungen und Möglichkeiten"), er steht 9-mal wörtlich im Body (davon 1-mal im Plural), und für ihn gibt es keine Konkurrenz. Aber gefunden wird der Beitrag über die Begriffe, die Museumsleute tatsächlich tippen.

| Rolle | Keyword | Im Body, wörtlich |
| --- | --- | --- |
| Hauptkeyword (Auftrag) | 3D-Museumswelt | 9x |
| Nebenkeyword 1, trägt die Nachfrage (Schätzung) | virtueller Rundgang Museum | "virtueller/virtuellen Rundgang" 4x, dazu 1x "Virtuelle Rundgänge" |
| Nebenkeyword 2 | 360-Grad-Rundgang | 7x |
| Nebenkeyword 3 | digitaler Zwilling Museum | "digitaler/digitalen Zwilling" 6x (davon 2x in Überschrift und Tabelle) |
| Nebenkeyword 4 | virtuelles Museum | 1x |

Wer sucht das in der Schweiz: Leitung, Vermittlung und Marketing eines Hauses, die eine Offerte einholen oder dem Stiftungsrat etwas vorlegen müssen. Nächster Schritt: Ziel festlegen, Anbieter anfragen. Der Text bedient genau das (Tabelle, "Was in jede Offerte gehört", 5 Schritte). **Text und Suchintention passen zusammen.** Nicht bedient wird die grössere Gruppe, die "virtueller Rundgang Museum" tippt, um selbst einen Rundgang anzusehen. Das ist richtig so, diese Leute sind nicht unser Publikum.

Die Folge für die Felder: Der Titel aus dem Entwurf besteht aus dem Begriff ohne Nachfrage plus zwei Wörtern ohne Inhalt ("Lösungen und Möglichkeiten"). Kein einziger gesuchter Begriff steht im `<title>`. Das löse ich im Titel, das ist mein Feld. Dasselbe Muster in den Überschriften ist Befund 1 und gehört Nora.

## Für das CMS

`draft-v3.md` wird die Quelle für `field_markdown`. Diese Datei ist die Quelle für alle anderen Felder.

| Feld | Wert | Zeichen | Budget |
| --- | --- | --- | --- |
| `node_title` (= `<title>` **und** H1, das Frontend hängt " \| NETNODE AG" an, 13 Zeichen) | `3D-Museumswelten: virtueller Rundgang bis VR` | 44 | 47 |
| `field_teaser_text` (Meta-Description, og:description, Listenteaser, RSS) | `360-Grad-Rundgang, digitaler Zwilling, 3D-Objekte oder AR und VR: vier Lösungen für 3D-Museumswelten, wer sie umsetzt und welche Kosten anfallen.` | 145 | 155 bis 160 |
| `field_article_leadtext` (sichtbarer Lead **und** `BlogPosting.description`) | `Eine 3D-Museumswelt kann ein Rundgang, ein vermessenes Haus oder ein einzelnes Objekt sein. Vier Lösungen im Vergleich, mit Entscheidungen für die nächsten Wochen.` | 163 | kein Hardlimit, Empfehlung bis 320 |
| `field_markdown` | Body aus `draft-v3.md` zwischen den Feldmarkern, ohne die Liste am Schluss | v2: 11'681 Zeichen, 1534 sichtbare Wörter, 7 H2, 12 H3, 0 H1, 15 Links auf 15 URLs | keine Vorgabe |
| Slug | `3d-museum-virtueller-rundgang` (URL: `https://netnode.ch/de/blog/3d-museum-virtueller-rundgang`) | 29 | kein Jahr, keine Kollision |
| Schema-Typ | `BlogPosting`, automatisch aus dem Node | | |
| `field_teaser_image` | fehlt im Entwurf, siehe Nit 3 | | 16:9 |
| `field_article_employee` | Autor setzen, siehe Nit 5 | | |

**Titel.** Mein Vorschlag behält den Begriff aus dem Auftrag vorn und setzt dahinter das Nebenkeyword mit der Nachfrage. Weil Titel und H1 hier dasselbe Feld sind, wird er auch die Überschrift des Beitrags. Die Alternative ist Noras Titel `3D-Museumswelten: Lösungen und Möglichkeiten` (44 Zeichen), wörtlich der Auftrag. Beide passen ins Budget, der Entscheid liegt bei den Menschen im Review. Ein Titel lässt sich jederzeit ohne Redirect ändern.

**Slug.** Der Slug lässt sich nicht ohne Redirect ändern, deshalb trägt er die Wörter, die bleiben: 3D, Museum, virtueller Rundgang. `3d-museumswelten` (16 Zeichen) wäre die Alternative, falls die Menschen den Begriff als Marke aufbauen wollen. Geprüft gegen alle 569 URLs der neun Teil-Sitemaps: kein Slug mit "3d", "rundgang" oder "virtuell" vorhanden.

**Teaser und Lead** übernehme ich unverändert von Nora. Der Teaser liegt 10 Zeichen unter dem Budget, das kostet nichts. Beide sind verschiedene Sätze, beide Feldanfänge tragen allein. Der Lead nennt "Entscheidungen für die nächsten Wochen" und hängt damit am gleichnamigen H2: Diese Überschrift bitte in v3 nicht umbenennen.

### `field_article_links` (Sidebar)

| Titel | URI |
| --- | --- |
| Ratgeber: Museen digital | `internal:/de/ratgeber/museen-digital` |
| Digitale Museumsführung: Nutzen, Formen und Kosten | `internal:/de/blog/digitale-museumsfuehrung` |
| Digital für Museen | `internal:/de/museen` |
| Empfehlung (EU) 2021/1970 | `https://eur-lex.europa.eu/eli/reco/2021/1970/oj` |

Die `internal:`-URIs **mit** `/de/` speichern, ohne Präfix läuft der Link über einen 307 (gemessen am 7.11.2026, Knowledge `seo/article-metadata-fields`).

## Befunde, die den Text ändern (alle Nora, alle in draft-v3.md)

Die Fix-Texte sind Vorschläge. Eine bessere Lösung mit Begründung im Log schlägt sie.

### Befund 1: 4 von 7 H2 tragen kein Suchwort

Die H2 im Body von v2:

| Zeile | H2 | Suchwort darin |
| --- | --- | --- |
| 16 | Welche Lösung passt zu Deinem Ziel? | keines |
| 26 | Was eine 3D-Museumswelt ist und was sie nicht ist | 3D-Museumswelt |
| 36 | Die vier Lösungen im Überblick | keines |
| 62 | Was in jede Offerte gehört | keines |
| 76 | Entscheidungen für die nächsten Wochen | keines (bleibt, hängt am Lead) |
| 84 | Häufige Fragen | Standard, bleibt |
| 106 | Quellen | Standard, bleibt |

Das Frontend baut aus den H2 das Inhaltsverzeichnis, und Antwortmaschinen schneiden den Text an den Überschriften in Stücke. "Die vier Lösungen im Überblick" sagt ohne den Titel darüber nicht, Lösungen wofür. Vorschlag für die drei Überschriften, die ich ändern würde:

- Zeile 16: `Welche 3D-Lösung passt zu Deinem Museum?`
- Zeile 36: `Vier Lösungen: vom virtuellen Rundgang bis VR`
- Zeile 62: `Was in jede Offerte für ein 3D-Projekt gehört`

Die H3 darunter sind gut, vier davon sind bereits die Suchbegriffe selbst (360-Grad-Rundgang, Digitaler Zwilling der Räume, 3D-Objekte aus der Sammlung, AR und VR im Haus). Kein Link im Body zeigt auf einen Anker (0x `](#`), eine Umbenennung bricht also nichts. Die Zahl der Anker bleibt 19.

### Befund 2: 5 Absätze tragen nicht allein

Jeder Absatz muss ein Zitat überstehen, ohne den Absatz davor. Drei der vier Lösungen beginnen mit einer Definition, die das kann ("Ein 360-Grad-Rundgang besteht aus", "Ein digitaler Zwilling ist", "AR (Augmented Reality) blendet"). Die vierte nicht:

> Zeile 52: "Hier wird kein Raum erfasst, sondern ein einzelnes Werk, das Gäste am Bildschirm drehen und vergrössern."

"Hier" zeigt auf die Überschrift, und der Begriff "3D-Objekt" steht im ganzen Absatz erst im dritten Satz. Vorschlag: mit dem Begriff beginnen, im Muster der anderen drei, zum Beispiel "Ein 3D-Objekt ist das digitale Modell eines einzelnen Werks, das Gäste am Bildschirm drehen und vergrössern." Den Wortlaut bitte selbst setzen: Mein Satz ist eine Umstellung Deines Satzes und enthält keine neue Tatsache, "digitales Modell" ist aber mein Wort.

Dazu die 4 Absätze, die mit "Wer es macht:" beginnen (Zeilen 42, 48, 54, 60). Allein zitiert sagt "Wer es macht: ein externer Anbieter für die Aufnahme" nicht, wovon. Es genügt, die Lösung im ersten Satz zu nennen, zum Beispiel "Wer den 360-Grad-Rundgang macht:". Das sind 4 Stellen, je zwei bis drei Wörter.

### Befund 3: Der NETNODE-Absatz steht unter der Überschrift "Quellen"

Zeile 120, der Absatz "NETNODE entwickelt für Kulturhäuser ..." folgt ohne eigene Überschrift auf die Quellenliste. Im Inhaltsverzeichnis und für jede Maschine gehört er damit zum Abschnitt "Quellen". Er enthält die einzige Nennung von "NETNODE" im Body (1x) und 2 der 4 internen Links.

Die zwei Cluster-Beiträge vom 4. Juli 2026 lösen das mit einem eigenen H2 nach den Referenzen, im Body gesetzt: "Lass uns darüber sprechen" (gelesen auf `/de/blog/digitale-museumsfuehrung` und `/de/blog/digitales-museumsmarketing`). Vorschlag: dem Absatz ein eigenes H2 geben, im Muster des Clusters. Dann sind es 8 H2 und 20 Anker. Ob das H2 vor oder nach "Quellen" steht, ist Dein Entscheid, der Cluster setzt es danach.

### Befund 4: Der Link auf die Museums-Landingpage fehlt

Der Body hat 4 interne Links, alle mit beschreibendem Anker, alle Ziele von mir geöffnet (200):

| Anker | Ziel | Auf der Zielseite geprüft |
| --- | --- | --- |
| "digitalen Museumsführung" | `/de/blog/digitale-museumsfuehrung` | Wörtlich dort: "Audioguide-Gerät, das gewartet, geladen und desinfiziert werden muss". Deckt Zeile 60. |
| "barrierefreien Museums-Website" | `/de/blog/barrierefreie-museums-website` | Vom 25.6.2026, nennt "WCAG-Richtlinien (Web Content Accessibility Guidelines), Niveau AA" ohne Versionsnummer. Kein Widerspruch zu "WCAG 2.2" in Zeile 74. |
| "interaktive Formate wie virtuelle Ausstellungen, 360-Grad-Touren und Augmented Reality" | `/de/solutions-culture` | Wörtlich dort: "NETNODE entwickelt interaktive Formate wie virtuelle Ausstellungen, 360-Grad-Touren und Augmented Reality". Der Text verspricht nicht mehr als die Seite. |
| "Museen digital" | `/de/ratgeber/museen-digital` | Ratgeber mit 11 Kapiteln, 0x "3D". |

Es fehlt `/de/museen`. Das ist die Landingpage, die im Juli 2026 für genau dieses Publikum gebaut wurde (Marketing und kaufmännische Leitung von Museen, `seo/log.md`), und sie ist die Seite mit dem Erstgespräch. Der Beitrag schickt den Leser stattdessen nur auf `/de/solutions-culture`, eine Seite für alle Kulturhäuser.

Was `/de/museen` sagt und was nicht, damit der Satz nichts verspricht, was die Seite nicht hält: Sie nennt 3D, virtuelle Rundgänge, AR und VR **0-mal**. Was sie wörtlich sagt: "Ob Guide, Audio-Rundgang oder Sammlung online sinnvoll ist, klärt die Digitalstrategie – nicht der Hype." Das ist derselbe Gedanke wie Schritt 1 Deiner Liste ("Ohne diesen Satz keine Offerte"). Der Link trägt also für "zuerst das Ziel klären", nicht für "NETNODE baut 3D". Ich liefere bewusst nur Ziel und Begründung, den Satz und den Anker setzt Du. Naheliegende Stelle: der NETNODE-Absatz aus Befund 3. Die Seite steht in Sie-Form, das steht bereits auf Deiner Liste.

### Befund 5: Zwei Seiten tragen je einen Satz und stehen nicht im Quellenblock

Das ist Ritas Nit 2, sie hat den Entscheid mir gegeben. Ich habe beide Seiten selbst geholt (HTTP 200) und die Stellen gesucht, statt sie zu übernehmen:

- Zeile 40, "bezeichnet seine Aufnahmen selbst als digitale Zwillinge": `https://matterport.com/pro3`, wörtlich "Digital twins reimagined, re-engineered, and ready for anything" und "create beautifully accurate and immersive digital twins of any space". Belegt.
- Zeile 100, "Hosting-Plattformen wie Sketchfab veröffentlichen ihre Abopreise": `https://sketchfab.com/plans`, wörtlich "$ 15 per month billed yearly", Premium mit "Get a quote". Belegt. Im Quellenblock steht nur `sketchfab.com/museums`.

Mein Entscheid: Beide gehören in den Quellenblock. Für die Aussage, wie ein Anbieter sich selbst nennt oder was er veröffentlicht, ist die Seite des Anbieters die Primärquelle, und ein Satz ohne Beleglink ist der schwächste im Text. Damit sind es 13 Einträge unter "Quellen". Zusammen mit dem Link aus Befund 4 hat der Body dann 18 Links auf 18 URLs. Bitte beide als Herstellerseiten kenntlich machen, damit niemand sie für eine Empfehlung hält.

### Bei der Gelegenheit, weil der Text ohnehin zu Dir geht

- **Ritas Nit 1** (Zeile 32, "Ob das Publikum die Online-Angebote nutzte"): mit ihrem Fix-Text in `review-v2.md` schliessen. Ich habe die NEMO-Zahlen nicht selbst am PDF geprüft, die Prüfung ist Ritas.
- **FAQ 4** (Zeile 98, "Was kostet eine 3D-Museumswelt?"): So tippt das niemand. Getippt wird eher "Was kostet ein virtueller Rundgang?" (Schätzung). Vorschlag: `Was kostet ein virtueller Rundgang oder eine 3D-Museumswelt?` Die Antwort deckt beides schon ab. Kein Blocker, Dein Entscheid.

## Was stimmt und stehen bleiben soll

- **Erste 100 Wörter**: Der Einstieg (Zeile 14, 87 Wörter) definiert den Begriff, nennt alle vier Lösungen und das Auswahlkriterium. Er beantwortet die Frage des Titels vollständig.
- **Hierarchie**: 7 H2, 12 H3, 0 H1, keine Ebene übersprungen.
- **Überfliegbar**: 1 Tabelle mit 5 Zeilen, 1 nummerierte Liste mit 5 Schritten, 5 FAQ in H3 vor den Quellen.
- **Zitierfähige Sätze mit Zahl, Datum und Quelle im Satz**: NEMO (600 Museen, 48 Länder, Herbst 2020), Europeana (52 Millionen, 0,03 Prozent, 2021), Deutsches Museum (19 Ausstellungen, 1445 Panoramen, Mai 2025), glTF (ISO/IEC 12113:2022). Das sind die Sätze, die eine Antwortmaschine nimmt.
- **Entitäten wörtlich**: NEMO, Europeana, Empfehlung 2021/1970, Schloss Thun, Bündner Kunstmuseum, Deutsches Museum, Matterport, Sketchfab, Smithsonian Voyager, model-viewer, glTF, WCAG 2.2, W3C, NETNODE.
- **Kannibalisierung**: keine. Alle neun Teil-Sitemaps unter `/de/sitemap.xml` geholt (pages 80, static 15, news 75, case-studies 17, whitepapers 13, articles 326, events 26, employees 8, guides 10; 569 verschiedene URLs). 0 URLs mit 3D, Rundgang oder virtuell im Pfad. Von den 11 Museums-Beiträgen im Blog nennt keiner 3D (alle 11 geholt, 11x 0 Treffer). Am nächsten liegt `/de/blog/digitale-museumsfuehrung` (0x "3D", 0x "virtuell"), das Thema dort ist der Guide vor Ort.
- **Ausgehende Links**: 11 Quellen, alle geholt. 9x 200. eur-lex 202 ohne Inhalt, w3.org/TR/WCAG22 und w3.org/TR/xaur je 403, auch mit Browser-Kennung. Das deckt sich mit Noras und Ritas Messung. Im Browser habe ich die drei nicht geöffnet. Für Suchmaschinen ist das unkritisch, es sind die kanonischen Adressen der Primärquellen.
- **Länge**: 1534 sichtbare Wörter (meine Zählung, gleich wie Noras). Aus Suchsicht kein Grund zu kürzen und keiner zu verlängern. Die Cluster-Beiträge liegen bei rund 900 bis 1150 Wörtern Seitentext, dieser Beitrag deckt vier Lösungen statt einer ab. Kein Zielkonflikt mit Rita. Meine Befunde kosten geschätzt 40 bis 60 Wörter.
- **Ritas Nit 4** (WCAG 2.1.1 und das "dafür"): Ich baue den Satz nicht um, der Nit bleibt wie von ihr vorgesehen stehen.

## Nits (keiner blockiert, jeder mit Besitzer und Station)

**Nit 1: Backlinks auf den neuen Beitrag.** Das ist der stärkste Hebel für die neue URL. In dieser Reihenfolge:

1. `/de/ratgeber/museen-digital`: als Kapitel 12 eintragen. Steht schon auf Noras Liste. Besitzer: Web, CMS-Schritt.
2. `/de/blog/zukunft-der-museen` (15.7.2025): die stärkste Museumsseite in der Search Console, 763 Impressionen und 13 Klicks in 3 Monaten, Position 8,9 (GSC A1, Juli 2026). Stelle: "Digitale Inhalte (virtuelle Ausstellungen, Online-Sammlungen) ermöglichen personalisierte Kulturerlebnisse". Anker auf "virtuelle Ausstellungen". Besitzer: Web, anderer Node.
3. `/de/blog/digitale-museumsfuehrung` (4.7.2026): im Abschnitt "Die drei Formen im Vergleich" ein Satz mit dem Anker "3D-Museumswelten vom virtuellen Rundgang bis VR". Besitzer: Web, anderer Node, Satz von der Redaktion.

**Nit 2: `/de/solutions-culture` ist als Zielseite schwach.** `<title>` ist "Kultur. | NETNODE AG", die Meta-Description hat 54 Zeichen ("Kulturangebote verwalten, präsentieren und vermarkten."), das H1 besteht aus drei Sätzen, "3D" steht 0-mal auf der Seite, und für den Satz zu virtuellen Ausstellungen, 360-Grad-Touren und Augmented Reality gibt es dort kein Referenzprojekt. Der Beitrag verspricht nichts, was die Seite nicht wörtlich sagt, deshalb kein Blocker. Aber dieser Beitrag wird die erste netnode.ch-Seite zu 3D sein, und der einzige Klick zum Angebot landet auf einer Seite ohne das Wort. Besitzer: Web, eigene Aufgabe.

**Nit 3: `field_teaser_image` fehlt.** Ohne Bild fällt die Karte auf das generische `/images/og-image-article.jpg` zurück und `BlogPosting` bekommt kein `image`. Ein Screenshot eines fremden Rundgangs braucht die Rechte des Hauses. Vorschlag für den Dateinamen: `3d-museumswelt-virtueller-rundgang.jpg`. Der Alt-Text beschreibt, was auf dem gewählten Bild zu sehen ist, und entsteht erst mit dem Bild. Besitzer: Mensch im Review (Bildwahl), CMS-Schritt (Upload und Alt-Text am Medium).

**Nit 4: Kein Bild im Body.** Ein Beitrag über 3D ohne eine einzige Abbildung. Für die Suche kein Befund, für die Leser schade. Besitzer: Mensch im Review, zusammen mit Nit 3.

**Nit 5: `field_article_employee` setzen.** Bleibt das Feld leer, wird der Autor im Schema "NETNODE AG" mit `@type: 'Person'`. Die Cluster-Beiträge führen "Von Lukas Fischer". Besitzer: CMS-Schritt.

**Nit 6: Kein `FAQPage`-Schema für Artikel.** `FaqJsonLd.tsx` wird aus `NodeArticle.tsx` nicht aufgerufen (Epic 285, #2348). Die 5 sichtbaren FAQ wirken bei Antwortmaschinen trotzdem. Besitzer: Web, blockiert keinen Beitrag.

**Nit 7: Kein "Stand:" im Text.** Der Body nennt 0-mal "2026". Das Template rendert das Publikationsdatum sichtbar und maschinenlesbar (`<time class="dt-published">`, `datePublished`), deshalb verlange ich keine Zeile im Text. Am Publikationstag nachzuprüfen sind die drei Häuser und die Matterport-Einbettung, wie auf Noras Liste. Von mir heute gesehen: Der iframe von `my.matterport.com` ist auf der Seite des Bündner Kunstmuseums vorhanden. Besitzer: Redaktion, Publikationstag.

## Nicht von mir geprüft

Die Tatsachen im Text (NEMO, Empfehlung 2021/1970, Deutsches Museum, Schloss Thun, glTF, WCAG) habe ich aus dem Entwurf und aus Ritas Reviews übernommen und nicht an den Quellen nachgelesen. Selbst gelesen habe ich nur, was oben ausdrücklich steht: die 14 netnode.ch-Seiten (11 Museums-Beiträge, `/de/museen`, `/de/solutions-culture`, den Ratgeber), matterport.com/pro3, sketchfab.com/plans, sketchfab.com/museums, modelviewer.dev und den iframe in Chur. Meine Vorschläge enthalten keine neue Zahl und keinen neuen Rechtsverweis.
