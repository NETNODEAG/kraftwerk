Verdict: ok

Runde 2 auf `draft-v3.md`. Freigabe mit vier Nits, keiner blockierend — nach der Hausregel "eine Runde je Station" habe ich meine Runde in `seo.md` verbraucht und gebe jetzt frei. `seo.md`, `draft-v1.md`, `draft-v2.md`, `review.md` und `review-v2.md` bleiben unverändert als Protokoll stehen.

Welche Datei für welches Feld gilt: **`draft-v3.md` ist die Quelle für `field_markdown`** (Body) und für die Offene-Punkte-Liste. **Diese Datei hier ist die Quelle für `node_title`, `field_teaser_text`, `field_article_leadtext`, den Slug und `field_article_links`.** Wo eine Zahl in beiden steht, gilt die hier, weil ich sie an `draft-v3.md` selbst nachgezählt habe.

## Meine Runde-1-Befunde → Status in v3

| Befund (`seo.md`, Runde 1) | Status |
| --- | --- |
| Befund 1 — die zwei eigenen Drupal-Seiten fehlen als interne Links | **geschlossen.** 4 interne Links im Body, alle vier mit beschreibendem Anker, selbst nachgezählt: "eine Agentur" → `/de/drupal-agentur`, "Drupal Wartung as a Service" → `/de/drupal-wartung-as-a-service`, "Was ist Drupal?", "Neue Beta-Version von Drupal 11.0.0 veröffentlicht". Kein "hier klicken". |
| Befund 2 — "NETNODE" 0× im Body (GEO-Entität) | **geschlossen.** 1× im Body, im selben Satz wie der Wartungslink, ohne eigenen Umbau. |
| Ritas Nit 1, von mir mitgetragen | **erledigt, und ich hatte ihn nicht prüfen lassen sollen, sondern selbst prüfen müssen.** Siehe Antwort 2. |
| Nit "Release-Zyklus" nur 2× | **bewusst nicht umgesetzt, richtig so.** Ich hatte "Besitzer: niemand, nur zur Kenntnis" geschrieben, Noras Begründung (nachträglich eingestreute Begriffe wären Füllwörter) ist die stärkere. Bleibt 2×. |
| Nits Backlink-Quelle / FAQPage / `field_article_employee` | **in der Offenen-Punkte-Liste von v3, je mit Besitzer.** Nichts davon blockiert. |

## Antwort 1: Dein Satz zur Wartungsseite bleibt, mein Fixtext war falsch

Du hast recht, und zwar an beiden Stellen, die du nennst. Ich habe die Seite selbst erneut gezielt gelesen, statt dir zu glauben:

- **Keine Kadenz.** Die Seite sagt nur `"Neue Drupal-Versionen, Modul-Updates und Patches spielen wir laufend ein"` und für den Notfall `"Bei kritischen Sicherheitsupdates handeln wir innerhalb weniger Stunden nach Veröffentlichung"`. Keine Zahl, kein Intervall. Mein "die diesen Rhythmus abdeckt" hätte den Rhythmus aus dem Absatz davor — "zweimal jährlich nötig", 1 bis 2 zusätzliche Zyklen — der Zielseite in den Mund gelegt. Die sagt das nicht.
- **Major-Upgrades ausdrücklich ausgeschlossen.** Wörtlich: `"Nein. Das Wartungsangebot bezieht sich immer auf Drupal Major Versionen. Innerhalb des Angebotes führen wir keine Upgrades z.B. von Drupal 7 zu Drupal 11 durch."` und `"Wir haben für Drupal Upgrades auch ein entsprechendes Angebot."`

Ich habe keine Belegstelle, mit der ich deine Formulierung auseinandernehmen könnte — es gibt keine. Deine Fassung `"die laufende Updates und Sicherheitspatches übernimmt"` deckt sich fast wörtlich mit dem Satz der Seite, und der Nebeneffekt, den du nennst, ist der eigentliche Gewinn: Migration → `/de/drupal-agentur` in Zeile 45, laufende Updates → `/de/drupal-wartung-as-a-service` in Zeile 47. Diese Trennung ist genau die, die die Zielseiten selbst ziehen ("wir haben für Upgrades auch ein entsprechendes Angebot"). Für einen Drupal-10-Leser, der auf 11 oder 12 muss, zeigt der Text damit auf das richtige der beiden Angebote.

Das ist das vierte Mal auf diesem Board, dass mein Fixtext schlechter war als die Fassung der Autorin, und diesmal mit einem erkennbaren Muster: **mein Vorschlagssatz hat die Zielseite charakterisiert, ohne dass ich die Zielseite auf ihre Ausschlüsse gelesen hatte.** Ich hatte sie auf Existenz, Thema und Widerspruchsfreiheit geprüft, nicht auf ihr Kleingedrucktes. Ab jetzt: Wenn ein Vorschlag von mir eine Zielseite beschreibt, zitiere ich dafür den Satz der Zielseite — oder ich liefere nur Link und Begründung und lasse den Wortlaut dir.

## Antwort 2: Ritas Nit 1 ist erledigt, ich trage ihn nicht weiter

Selbst in der PSA nachgesehen, wörtlich vorhanden:

> "Drupal has supported each minor release of Drupal (example: 11.3, 11.4) for 12 months each since the release of Drupal 8.6 in 2018."

Der Teilsatz in Zeile 31 ist damit primärquellig gedeckt, steht zu Recht im Text, ist **von der CMS-Liste runter** und taucht in dieser Datei nicht als offener Punkt auf. Die Offene-Punkte-Liste von v3 führt ihn als "Erledigt, nicht mehr offen" samt Zitat — richtig so, damit niemand im Review darauf wartet.

Mein Teil daran: Rita hatte mich gebeten, den Nit mitzunehmen, und ich habe ihn in `seo.md` als zu schliessenden Punkt weitergegeben, **ohne die PSA selbst danach zu durchsuchen**. Das ist genau die Hausregel "prüfen, nicht übernehmen", und ich habe sie gebrochen — bei einem Befund, der mit der Autorität eines fremden Reviews ankam. Dass es nichts gekostet hat, liegt daran, dass du geprüft hast statt übernommen; die Angabe steht jetzt mit Fundstelle im Text, was besser ist als vorher. Richtig wäre gewesen, die Fundstelle vor dem Weitertragen selbst zu suchen — es war ein `grep` in einer Quelle, die ohnehin in der Quellenliste steht.

## Antwort 3: `/de/drupal-agentur` — kein Blocker vor der Publikation, aber ein Datum

Dein Befund stimmt, selbst nachgezählt: 7× "Drupal 11" auf der Seite, **0× "Drupal 12"**, Upgrade-Ziel durchgehend 11 (`"Drupal-Upgrades (Drupal 7/9/10 auf Drupal 11)"`, `"Von Drupal 7, 9 oder 10 auf Drupal 11"`, `"Bereit für Drupal 11?"`, `"Neuentwicklung und Relaunch mit Drupal 11"`, FAQ: `"Wir definieren den Upgrade-Pfad auf Drupal 11"`).

**Meine Einschätzung: nicht vor der Publikation schliessen, aber bis zur Release-Woche.** Drei Gründe:

1. **Es gibt kein gebrochenes Versprechen am Klick.** Das ist der Unterschied zu Task 4: Dort versprach der Post "Barrierefreiheit eingeschlossen" und das Wort kam auf `/de/programme/website-check` kein einziges Mal vor. Hier behauptet der Text nirgends, die Seite decke Drupal 12 ab; der Anker heisst "eine Agentur" und steht im Migrationssatz. Die Tabelle schickt Drupal-10-Betreiber auf "Drupal 11 oder 12", und die Hälfte davon — den Weg auf 11 — bedient die Seite wörtlich. Ein Leser landet also auf einer Seite, die seine Aufgabe kennt, nur nicht in der neuesten Zielversion.
2. **Das bindende Datum ist nicht der Publikationstag, sondern die Release-Woche.** Heute (12.11.2026) ist Drupal 12 nicht erschienen, und die Entscheidungsliste des Artikels selbst arbeitet mit "bis Ende November 2026 den Migrationspartner kontaktieren". Geht der Post im November live, ist die Seite am Tag 1 nicht veraltet. **Erst ab der Woche vom 7. Dezember 2026** empfiehlt eine Money-Seite einen Upgrade-Pfad auf die dann vorletzte Major-Version. Nur wenn die Publikation hinter diese Woche rutscht, wird es ein Punkt vor der Publikation — das ist die einzige Bedingung, unter der ich es anders sehe.
3. **Unabhängig von diesem Artikel ist es ohnehin fällig, und die Seite gewinnt dabei.** Ihre FAQ sagt `"Drupal 7 ist am Lebensende, Drupal 9 ohne Support"` und erwähnt nirgends, dass Drupal 10 am 9. Dezember 2026 aus dem Sicherheitssupport fällt — die dringendste Tatsache für genau das Publikum, das die Seite anspricht (`"Ihre Site läuft noch auf Drupal 7, 9 oder 10?"`). Dieser Satz ist ein Verkaufsargument, nicht Hygiene. Das Keyword-Cluster dahinter: rund 7'400 Impressionen in 3 Monaten, 3 Klicks (GSC A1, Juli 2026).

**Wo die Änderung sitzt, damit Web nicht suchen muss** (selbst im Klon nachgesehen, `/de/drupal-agentur` ist Node 842 `netnode_ch_page`, gerendert über `NodePage.tsx` → `MdxContent` mit dem Shortcode `<DrupalAgenturPage />`, der Text steht also nicht im CMS-Node):

| Element | Ort | Besitzer |
| --- | --- | --- |
| Meta-Description `"… Upgrades auf Drupal 11, Support & Hosting …"` (das ist der SERP-Snippet) | `field_teaser_text` auf Node 842 — der Repo-Konstante `DRUPAL_DESCRIPTION` (`DrupalAgenturPage.tsx:34`) spiegelt sie laut Code-Kommentar nur, beide müssen zusammen geändert werden, sonst driften sie | CMS-Schritt **und** Web |
| die 6 übrigen "Drupal 11" im sichtbaren Inhalt (Zeilen 58, 61, 70, 105, 113, 163) | Repo, `src/components/pages/DrupalAgenturPage.tsx` — PR gegen `frontend.netnode.ch`, keine CMS-Änderung | Web |

Die kleinste Fassung, die das schliesst: "auf Drupal 11" → "auf Drupal 11 oder 12" plus ein Satz zum 9. Dezember 2026 in der FAQ. Deine Formulierung in der Offenen-Punkte-Liste ("Besitzer: Web oder Redaktion") ist damit präzisierbar, aber nicht falsch: es ist tatsächlich beides, nur aufgeteilt nach Element und nicht austauschbar.

## Korrektur an meiner eigenen Zählung aus Runde 1

In `seo.md` steht "Hauptkeyword **'Drupal 12'** — 13× im Body". **Das war eine Zählung über die ganze Datei, nicht über `field_markdown`.** Body-only sind es 9× (v2 und v3 gleich; ganze Datei v2 13×, v3 14×). Das ist dieselbe Fehlerform wie die Ankerzahl in v1 — ein `grep` über die Datei statt über das Feld, inklusive der Offene-Punkte-Liste, die nie in `field_markdown` landet. Am Ergebnis ändert es nichts: 9× auf 1110 Wörter, dazu Titel, H1, Teaser, Lead, H2, Tabelle und 4 FAQ-Antworten, das trägt das Hauptkeyword deutlich. Die Zahl korrigiere ich trotzdem, weil eine Zahl in meiner Datei eine Anweisung an andere ist.

## Für das CMS — finale Werte

An `draft-v3.md` selbst nachgezählt, mit Python `len()` (nicht `wc -c`, Umlaute sind sonst 2 Byte). `node_title`, `field_teaser_text` und `field_article_leadtext` sind **zeichengleich mit v2**, programmatisch verglichen — Nora hat meine Felder nicht angefasst.

| Feld | Wert | Zeichen | Budget |
| --- | --- | --- | --- |
| `node_title` (= `<title>` **und** H1, Frontend hängt " \| NETNODE AG" an, 13 Zeichen) | `Drupal 12: Weniger Zeit für Updates` | 35 | 47 |
| `field_teaser_text` (Meta-Description, og:description, Listenteaser, RSS) | `Drupal 12 kommt im Dezember 2026, gleichzeitig sinkt das Sicherheits-Fenster je Zwischenversion von 12 auf 8 Monate. Was das für Ihre Website bedeutet.` | 151 | 155–160 |
| `field_article_leadtext` (sichtbarer Lead **und** `BlogPosting.description`) | `Ab Dezember 2026 läuft Drupal 10 aus. Und für die Versionen ab Drupal 11.5 und 12.0 gilt ein kürzeres Sicherheits-Fenster: 8 statt 12 Monate.` | 141 | kein Hardlimit, Empfehlung ≤320 |
| `field_markdown` | Body aus `draft-v3.md` zwischen den Feldmarkern, **ohne** die Offene-Punkte-Liste | 8033 Zeichen, 1110 Wörter, 11 Überschriften (6 H2 + 5 H3), 0 H1, 8 URLs (4 drupal.org + 4 netnode.ch), 0 Langstriche, 0 ss-zet | — |
| Slug | `drupal-12-weniger-zeit-fuer-updates` | kein Jahr, keine Kollision mit den 25 bestehenden Drupal-Slugs in `sitemap-articles.xml` | — |
| Schema-Typ | `BlogPosting`, automatisch aus dem Node | — | — |
| `field_teaser_image` | Alt-Text-Vorschlag: *"Drupal-12-Logo neben einer Zeitleiste der Support-Fristen Dezember 2026 bis August 2027"*; Dateiname falls neu hochgeladen: `drupal-12-sicherheits-fenster.jpg` | — | 16:9 |

Teaser und Lead sind zwei verschiedene Sätze und beide gefüllt — das muss so sein, weil der Teaser die Meta-Description und der Lead die JSON-LD-Description ist. Alle drei Feldanfänge tragen allein, kein rückgreifendes Wort über eine Feldgrenze (Rita hat das in Runde 2 einzeln geprüft, in v3 sind die drei Felder unverändert).

### `field_article_links` (Sidebar) — mein Feld, unverändert gegenüber `seo.md`

| Titel | URI |
| --- | --- |
| Drupal core release schedule | `https://www.drupal.org/about/core/policies/core-release-cycles/schedule` |
| PSA-2026-11-02: Security support reduced to 8 months | `https://www.drupal.org/psa-2026-11-02` |
| Drupal Wartung as a Service | `internal:/de/drupal-wartung-as-a-service` |
| Drupal Agentur | `internal:/de/drupal-agentur` |

Beide `internal:`-URIs **mit** `/de/` speichern: `internalLinkUriToSlug` (`src/lib/utils.ts`, selbst gelesen) streicht nur das `internal:`-Prefix, `internal:/drupal-agentur` liefe deshalb über einen 307.

## Nits (keiner blockierend, jeder mit Besitzer und Station)

**Nit 1 — `/de/drupal-agentur` nennt Drupal 11 als Upgrade-Ziel, 0× Drupal 12.** Vollständig in Antwort 3, inklusive Fundstellen und Zeilennummern. **Besitzer: Web** (6 sichtbare Strings, Repo-PR) **und CMS-Schritt** (`field_teaser_text` auf Node 842 plus die spiegelnde Repo-Konstante). **Fällig: Woche vom 7. Dezember 2026**, nicht zur Publikation — ausser die Publikation rutscht hinter diese Woche.

**Nit 2 — Backlink auf diesen Artikel von einem bestehenden Node.** `kritisches-drupal-security-update-so-handeln-wir` (21. Mai 2026) ist die bessere Quelle als `was-ist-drupal` (22. Mai 2019, nennt "über 40'000 Erweiterungen"): thematisch benachbart, aktuell, verlinkt schon heute auf `/de/drupal-wartung-as-a-service`. Vorschlag für den Anker dort: "wie lange eine Drupal-Version Sicherheitsupdates erhält". **Besitzer: Web**, anderer Node, CMS-Schritt.

**Nit 3 — Artikel spielen kein `FAQPage`-Schema aus.** `FaqJsonLd.tsx` wird nur aus den hartcodierten Landingpages aufgerufen, nie aus `NodeArticle.tsx` (Epic 285 #2348). Der sichtbare FAQ-Block mit 5 H3-Fragen wirkt bei Antwortmaschinen trotzdem, weil die den Text lesen. Nebenbefund aus dieser Runde: `/de/drupal-agentur` ruft `FaqJsonLd` auf (`DrupalAgenturPage.tsx:209`) — der Artikel ist also die Ausnahme, nicht die Landingpage. **Besitzer: Web**, blockiert keinen Post.

**Nit 4 — `field_article_employee` leer → Autor wird `NETNODE AG`, aber als `@type: 'Person'` typisiert.** Vorbestehender CMS-Fehler, nicht von diesem Text verursacht. Für GEO wäre eine namentliche Autorenschaft besser, das ist aber ein Redaktionsentscheid und kein Befund an diesem Artikel. **Besitzer: CMS-Schritt.**

## Was ich geprüft habe und was stimmt

- **Felder**: die drei von mir verantworteten Werte zeichengleich mit v2, programmatisch verglichen; Zeichenzahlen neu gerechnet, alle innerhalb Budget.
- **Interne Links**: 4, alle mit beschreibendem Anker, beide neuen Ziele selbst geöffnet (200, Inhalt gelesen, kein Widerspruch zu den Zahlen im Artikel).
- **Überschriften**: 6 H2 + 5 H3, keine Ebene übersprungen, kein H1 im Body, Ankerzählung nur über `field_markdown`.
- **Erste 100 Wörter**: Der Einstieg (Zeile 14, rund 60 Wörter) beantwortet die Frage des Titels direkt — Release-Woche, Verkürzung von 12 auf 8 Monate, und was das für den Leser heisst. Unverändert gut.
- **GEO**: 5 FAQ-Fragen in H3 vor den Quellen; Entitäten literal ausgeschrieben ("Drupal 12", "PSA-2026-11-02", "NETNODE", "Security-only", Versionsnummern); zitierfähige Einzelsätze mit Zahl, Datum und Quelle in jedem Abschnitt. Die 12-Monats-Ausnahme ist jetzt an beiden Stellen verankert ("Für Drupal 11 steht diese Version noch nicht fest, 11.5 ist sie nicht") — dass Nora den Anker zusätzlich in den Fliesstext gesetzt hat und nicht nur in die FAQ, ist die bessere Lösung, weil die Verwechslung dort zuerst entsteht.
- **Kannibalisierung**: in Runde 1 über alle neun Teil-Sitemaps geprüft, 25 bestehende Drupal-Artikel, keiner deckt die reguläre Minor-Version-Frist. In v3 unverändert.
- **Länge**: 1110 Wörter (v2: 1052, v1: 815). Rita und ich sind uns einig, dass hier kein Zielkonflikt besteht; die 58 zusätzlichen Wörter gehen auf meine beiden Befunde und Ritas Nits zurück, also auf Genauigkeit und Verlinkung. Kein Kürzungsbedarf aus SEO-Sicht.
- **Noch offen für den Menschen im Review, nicht von mir zu entscheiden**: der Sie-Form-Entscheid (16 Höflichkeitsformen, 0× du) und die Prüfung der vier Termine am Publikationstag.
