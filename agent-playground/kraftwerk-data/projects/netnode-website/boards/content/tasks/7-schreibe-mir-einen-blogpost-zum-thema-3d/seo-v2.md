Verdict: ok

# SEO draft-v3.md (Task 7, 3D-Museumswelten)

Sven, 18.11.2026, Runde 2. Freigegeben wird `draft-v3.md`. `seo.md` (Runde 1, zu `draft-v2.md`) bleibt als Protokoll stehen.

Welche Datei für welches Feld gilt: **`draft-v3.md` ist die Quelle für `field_markdown`** und für die Liste am Schluss. **Diese Datei ist die Quelle für `node_title`, `field_teaser_text`, `field_article_leadtext`, Slug und `field_article_links`.** Die drei Feldwerte oben in `draft-v3.md` sind Noras Stand aus v2, sie sagt das in ihrer Liste selbst.

Alle Body-Zahlen sind nur zwischen den Markern von `field_markdown` gerechnet, Zeichen mit Python `len()`.

## Für die Menschen im Review: zwei Entscheide und ein Hinweis

1. **Titel.** Mein Vorschlag `3D-Museumswelten: virtueller Rundgang bis VR` oder der Auftragstitel `3D-Museumswelten: Lösungen und Möglichkeiten`, beide 44 von 47 Zeichen. Grund für meinen: "3D-Museumswelt" ist voraussichtlich kein Suchbegriff (Schätzung, kein Keyword-Tool, Herleitung in `seo.md`), "virtueller Rundgang" schon. Der Titel wird auch das H1 des Beitrags. Er lässt sich später ohne Redirect ändern.
2. **Slug.** `3d-museum-virtueller-rundgang` (mein Vorschlag) oder `3d-museumswelten`. Der Slug lässt sich später nur mit Redirect ändern, dieser Entscheid ist der bindende.
3. **Rita hat `draft-v3.md` nicht gesehen.** Zwischen ihrer Freigabe (v2) und v3 liegen 14 geänderte Body-Zeilen. Davon ist 1 Zeile ihr eigener Fix-Text (Nit 1, NEMO-Halbsatz), 2 sind Quellenlinks auf Seiten, die sie und ich gelesen haben, 9 sind Überschriften und Satzanfänge ohne neue Tatsache. Neu im Inhalt sind nur die 2 Zeilen des Schlussabschnitts (H2 und Absatz) mit dem Satz zu `/de/museen`. Den habe ich unten gegen die Zielseite geprüft, Nora ebenfalls. Eine neue Zahl oder einen neuen Rechtsverweis enthält v3 nicht. Ich sehe deshalb keinen Grund für eine weitere QA-Runde, der Entscheid liegt bei Euch.

## Für das CMS: finale Werte

| Feld | Wert | Zeichen | Budget |
| --- | --- | --- | --- |
| `node_title` (= `<title>` **und** H1, das Frontend hängt " \| NETNODE AG" an, 13 Zeichen) | `3D-Museumswelten: virtueller Rundgang bis VR` | 44 | 47 |
| `field_teaser_text` (Meta-Description, og:description, Listenteaser, RSS) | `360-Grad-Rundgang, digitaler Zwilling, 3D-Objekte oder AR und VR: vier Lösungen für 3D-Museumswelten, wer sie umsetzt und welche Kosten anfallen.` | 145 | 155 bis 160 |
| `field_article_leadtext` (sichtbarer Lead **und** `BlogPosting.description`) | `Eine 3D-Museumswelt kann ein Rundgang, ein vermessenes Haus oder ein einzelnes Objekt sein. Vier Lösungen im Vergleich, mit Entscheidungen für die nächsten Wochen.` | 163 | kein Hardlimit, Empfehlung bis 320 |
| `field_markdown` | Body aus `draft-v3.md` zwischen den Feldmarkern, **ohne** die Liste am Schluss | 12'323 Zeichen, 1611 sichtbare Wörter, 8 H2, 12 H3, 0 H1, 18 Links auf 18 URLs | keine Vorgabe |
| Slug | `3d-museum-virtueller-rundgang` (URL: `https://netnode.ch/de/blog/3d-museum-virtueller-rundgang`) | 29 | kein Jahr, keine Kollision in 569 Sitemap-URLs |
| Schema-Typ | `BlogPosting`, automatisch aus dem Node | | |
| `field_teaser_image` | fehlt, Bildwahl beim Menschen im Review. Dateiname: `3d-museumswelt-virtueller-rundgang.jpg`. Alt-Text am Medium, er beschreibt das gewählte Bild. | | 16:9 |
| `field_article_employee` | Autor setzen (die Cluster-Beiträge führen "Von Lukas Fischer") | | |

Teaser und Lead sind in v3 zeichengleich mit v2 (145 und 163 nachgezählt). Das H2 "Entscheidungen für die nächsten Wochen", an dem der Lead hängt, steht unverändert.

### `field_article_links` (Sidebar)

| Titel | URI |
| --- | --- |
| Ratgeber: Museen digital | `internal:/de/ratgeber/museen-digital` |
| Digitale Museumsführung: Nutzen, Formen und Kosten | `internal:/de/blog/digitale-museumsfuehrung` |
| Digital für Museen | `internal:/de/museen` |
| Empfehlung (EU) 2021/1970 | `https://eur-lex.europa.eu/eli/reco/2021/1970/oj` |

Die `internal:`-URIs **mit** `/de/` speichern, ohne Präfix läuft der Link über einen 307.

## Meine Befunde aus Runde 1: Status in draft-v3.md

| Befund | Status | Nachgezählt |
| --- | --- | --- |
| 1: 3 H2 ohne Suchwort | geschlossen | "Welche 3D-Lösung passt zu Deinem Museum?", "Vier Lösungen: vom virtuellen Rundgang bis VR", "Was in jede Offerte für ein 3D-Projekt gehört". 6 von 8 H2 tragen jetzt ein Suchwort, die 2 ohne sind "Häufige Fragen" und "Quellen". |
| 2: 5 Absätze tragen nicht allein | geschlossen, 5 von 5 | "Wer es macht:" 0x. Der Absatz zu 3D-Objekten beginnt mit "Ein 3D-Objekt ist das digitale Modell eines einzelnen Werks". |
| 3: NETNODE-Absatz unter "Quellen" | geschlossen, mit Noras eigenem H2 | siehe Punkt 1 unten |
| 4: Link auf `/de/museen` fehlt | geschlossen | siehe Punkt 2 unten |
| 5: 2 Herstellerseiten nicht im Quellenblock | geschlossen | 13 Einträge unter "Quellen", beide als "Preisseite des Anbieters" und "Produktseite des Herstellers" bezeichnet |
| Ritas Nit 1 (NEMO-Halbsatz) | geschlossen mit ihrem Fix-Text | Zeile 32 |
| FAQ 4 | übernommen | "Was kostet ein virtueller Rundgang oder eine 3D-Museumswelt?" |

## Die drei Stellen, auf die Nora zeigt

**(1) Das H2 "3D-Projekt im Museum: zuerst das Ziel klären" statt "Lass uns darüber sprechen".** Noras Fassung ist besser als mein Vorschlag, aus dem Grund, den sie nennt. Die Cluster-Beiträge versprechen unter "Lass uns darüber sprechen" Beispiele aus eigenen Projekten ("Wir zeigen Dir an Bei[spielen]" auf `/de/blog/digitale-museumsfuehrung`). Für 3D gibt es auf netnode.ch kein Projekt, die Überschrift hätte also etwas angekündigt, das der Absatz nicht hält. Ihr H2 trägt zusätzlich "3D-Projekt" und "Museum" und sagt, wofür der Link steht. Ich hatte das Muster des Clusters übernommen, ohne zu lesen, was unter der Überschrift dort steht.

**(2) Der Satz zum Link auf `/de/museen`.** Zeile 124: "Was für ein Museum digital sinnvoll ist, klärt bei NETNODE die Digitalstrategie im Angebot Digital für Museen, das Erstgespräch ist kostenlos." Ich habe die Seite heute neu geholt (200) und jede der drei Aussagen gesucht:

- "klärt die Digitalstrategie": wörtlich dort, "Ob Guide, Audio-Rundgang oder Sammlung online sinnvoll ist, klärt die Digitalstrategie – nicht der Hype."
- "Digital für Museen": das ist das H1 der Seite, sie steht unter "Programme". "Angebot" ist dafür das richtige Wort.
- "das Erstgespräch ist kostenlos": wörtlich dort, "Das Erstgespräch ist in jedem Fall kostenlos.", dazu "30 Minuten, kostenlos und unverbindlich".

Der Satz behauptet nicht, dass die Seite 3D anbietet. Er verallgemeinert "Guide, Audio-Rundgang oder Sammlung online" zu "was für ein Museum digital sinnvoll ist". Das ist eine Zusammenfassung, kein Zitat, und sie geht nicht über die Seite hinaus. Kein gebrochenes Versprechen am Klick. Dass der Halbgeviertstrich nicht übernommen ist, ist richtig.

**(3) 20 Anker und 18 Links.** Stimmt beides. 8 H2 plus 12 H3 ergeben 20 Überschriften, alle 20 verschieden, 0 Links auf Anker. 18 Links auf 18 URLs: 5 intern, 13 im Quellenblock. Die 5 internen: `/de/blog/digitale-museumsfuehrung`, `/de/blog/barrierefreie-museums-website`, `/de/museen`, `/de/solutions-culture`, `/de/ratgeber/museen-digital`, alle mit beschreibendem Anker.

## Weitere Zählungen in draft-v3.md

- Suchbegriffe wörtlich im Body: 3D-Museumswelt 9x (davon 1x Plural), 360-Grad-Rundgang 8x, virtueller/virtuellen Rundgang 7x (v2: 4x), digitaler/digitalen Zwilling 8x mit Überschrift und Tabelle (Nora zählt 6x ohne die 2 grossgeschriebenen), virtuelles Museum 1x.
- NETNODE 2x (v2: 1x).
- 0 lange Gedankenstriche, 0 Halbgeviertstriche, 0 ß.
- `draft-v2.md` ist unverändert (Zeitstempel 09:41, vor meiner Runde 1).
- **Länge**: 1611 Wörter, 77 mehr als v2. Meine Schätzung war 40 bis 60, die Differenz ist der Satz zu `/de/museen`. Kein Kürzungsbedarf aus Suchsicht, kein Zielkonflikt mit Rita.

## Nits (keiner blockiert, jeder mit Besitzer und Station)

**Nit 1: Backlinks auf den neuen Beitrag**, in dieser Reihenfolge: (a) `/de/ratgeber/museen-digital`, als Kapitel 12 eintragen; (b) `/de/blog/zukunft-der-museen`, Anker auf "virtuelle Ausstellungen" im Satz "Digitale Inhalte (virtuelle Ausstellungen, Online-Sammlungen) ermöglichen personalisierte Kulturerlebnisse", die Seite hatte 763 Impressionen und 13 Klicks in 3 Monaten (GSC A1, Juli 2026); (c) `/de/blog/digitale-museumsfuehrung`, ein Satz im Abschnitt "Die drei Formen im Vergleich". Besitzer: Web, CMS-Schritt, andere Nodes.

**Nit 2: `/de/solutions-culture` ist als Zielseite schwach.** `<title>` "Kultur. | NETNODE AG", Meta-Description 54 Zeichen, "3D" 0x, kein Referenzprojekt zum verlinkten Satz. Besitzer: Web, eigene Aufgabe.

**Nit 3: `/de/museen` nennt 3D, virtuelle Rundgänge, AR und VR 0x.** Mit diesem Beitrag verlinkt erstmals ein 3D-Text auf die Seite. Ein Satz dort würde den Klick abholen. Wer die Seite ändert, prüft Zeile 124 des Beitrags mit, das steht auch auf Noras Liste. Besitzer: Web.

**Nit 4: `field_teaser_image` und ein Bild im Body fehlen.** Ohne Teaserbild fällt die Karte auf das generische Bild zurück und `BlogPosting` bekommt kein `image`. Ein Screenshot eines fremden Rundgangs braucht die Rechte des Hauses. Besitzer: Mensch im Review (Bildwahl), CMS-Schritt (Upload, Alt-Text).

**Nit 5: `field_article_employee` setzen**, sonst wird der Autor im Schema "NETNODE AG" mit `@type: 'Person'`. Besitzer: CMS-Schritt.

**Nit 6: Kein `FAQPage`-Schema für Artikel** (Epic 285, #2348). Die 5 sichtbaren FAQ wirken bei Antwortmaschinen trotzdem. Besitzer: Web.

**Nit 7: "hängt am Ziel aus Schritt 1"** (Zeile 124). Der Schlussabschnitt greift auf die nummerierte Liste zwei Abschnitte weiter oben zurück. Allein zitiert fehlt, was Schritt 1 ist. Klein, weil der Rest des Absatzes allein trägt. Möglich wäre "hängt an Deinem Ziel". Besitzer: Mensch im Review, nur falls der Text ohnehin angefasst wird.

**Nit 8: Am Publikationstag** die drei Häuser und die Matterport-Einbettung in Chur nachprüfen, wie auf Noras Liste. Dazu neu die zwei Herstellerseiten `matterport.com/pro3` und `sketchfab.com/plans`: Produkt- und Preisseiten ändern sich häufiger als die übrigen Quellen. Besitzer: Redaktion.

## Nicht von mir geprüft

Die Tatsachen im Text (NEMO, Empfehlung 2021/1970, Deutsches Museum, Schloss Thun, glTF, WCAG) habe ich nicht an den Quellen nachgelesen, die Prüfung ist Ritas und gilt für v2. Selbst gelesen habe ich die netnode.ch-Zielseiten, `matterport.com/pro3`, `sketchfab.com/plans` und in dieser Runde erneut `/de/museen`.
