Verdict: changes requested

Geprüft: `draft-v2.md` (von Rita in Runde 2 freigegeben, `review-v2.md`). `draft-v1.md` und `review.md` bleiben Protokoll der Runde 1, unangetastet.

Das ist meine erste Runde auf diesem Task (Nora: 2, Rita: 2). Nach der Hausregel "eine Runde je Station" gebe ich jetzt einmal zurück und lasse alles Übrige als Nit mit Besitzer stehen — beim nächsten Durchgang gebe ich frei, auch wenn Nits offen bleiben.

## Für das CMS

Alle Werte an `draft-v2.md` selbst nachgezählt (Python `len()`, nicht `wc -c` — Umlaute sind sonst 2 Byte und verzerren die Zählung), gegen `repos/frontend.netnode.ch` geprüft (`page.tsx`, `NodeArticle.tsx`, `src/lib/utils.ts`).

| Feld | Wert | Zeichen | Budget |
| --- | --- | --- | --- |
| `node_title` (= `<title>` und H1, Frontend hängt " \| NETNODE AG" an, 13 Zeichen) | `Drupal 12: Weniger Zeit für Updates` | 35 | 47 |
| `field_teaser_text` (Meta-Description, og:description, Listenteaser, RSS) | siehe `draft-v2.md` Zeile 6 | 151 | 155–160 |
| `field_article_leadtext` (sichtbarer Lead + `BlogPosting.description`) | siehe `draft-v2.md` Zeile 10 | 141 | kein Hardlimit, Empfehlung ≤320 |
| `field_markdown` | Body, siehe Datei | 1060 Wörter (`wc -w` zwischen den Feldmarkern), 11 Überschriften (6 H2 + 5 H3), 0 H1 im Body | — |
| Schema-Typ | `BlogPosting`, automatisch aus dem Node | — | — |
| `field_teaser_image` (Alt-Text) | Vorschlag: *"Drupal-12-Logo neben einer Zeitleiste der Support-Fristen Dezember 2026 bis August 2027"* — Alt beschreibt das Bild, nicht das Keyword; Dateiname falls neu hochgeladen: `drupal-12-sicherheits-fenster.jpg` | — | 16:9 |
| Slug-Vorschlag | `drupal-12-weniger-zeit-fuer-updates` — kein Jahr (Inhalt ist nicht jahresgebunden, nur die Fristen sind es), spiegelt den Titel, keine Kollision mit den 25 bestehenden Drupal-Slugs in `sitemap-articles.xml` | — | — |
| `field_article_employee` (Autor) | nicht gesetzt in `draft-v2.md` — bleibt dann automatisch `name: 'NETNODE AG'`, aber `@type: 'Person'` typisiert (bekannter CMS-Fehler, nicht neu). **Besitzer: CMS-Schritt/Redaktion**, kein Blocker hier. | — | — |

### `field_article_links` (Sidebar) — das Feld gehört mir, hier die Werte

| Titel | URI | Grund |
| --- | --- | --- |
| Drupal core release schedule | `https://www.drupal.org/about/core/policies/core-release-cycles/schedule` | Primärquelle, Datumsbelege |
| PSA-2026-11-02: Security support reduced to 8 months | `https://www.drupal.org/psa-2026-11-02` | Primärquelle, trägt den Hook |
| Drupal Wartung as a Service | `internal:/de/drupal-wartung-as-a-service` | eigene Dienstleistung, direkt passend zum Thema (siehe Befund 1) |
| Drupal Agentur | `internal:/de/drupal-agentur` | eigene Landingpage, direkt passend (siehe Befund 1) |

Beide `internal:`-URIs mit `/de/`-Prefix speichern, nicht ohne Sprachpräfix: `internalLinkUriToSlug` (`src/lib/utils.ts`) gibt `/de/...` ohne Hop nur bei dieser Schreibweise zurück, `internal:/drupal-agentur` liefe über einen 307.

## Befunde

**Befund 1 — zwei eigene Geschäftsseiten passen genau zum Thema und fehlen im Text. Nora's Station.**

Der Artikel beschreibt ausführlich, dass Betreiber jetzt öfter aktualisieren müssen und dass das den Wartungsvertrag betrifft (Zeile 47: *"Der Update-Rhythmus muss von 'einmal jährlich möglich' auf 'zweimal jährlich nötig' umgestellt werden"*) und dass das die Stelle betrifft, die die Website betreut, intern oder eine Agentur (Zeile 45). Beide Sätze verlinken auf nichts. Netnode.ch hat dafür zwei lebende Seiten: `/de/drupal-wartung-as-a-service` (genau dieses Wartungsmodell) und `/de/drupal-agentur` (die Agentur-Option aus Zeile 45) — beide selbst geöffnet und geprüft, keine 404, kein Widerspruch zu den Zahlen im Draft (die Wartungsseite nennt keine feste Kadenz, die unserem 8-Monats-Fenster widersprechen würde).

Das ist kein Nice-to-have: In den GSC-Daten (`repos/frontend.netnode.ch/seo/data/a1-gsc-2026-07.md`, 3 Monate bis Juli 2026, Property `sc-domain:netnode.ch`) stehen "drupal agentur" (1'870 Impressionen, Position 10.8), "drupal agentur zürich" (1'093, Pos. 7.0), "drupal agentur schweiz" (691, Pos. 6.3), "drupal beratung" (505, Pos. 12.1), "drupal" (2'197, Pos. 19.4) — zusammen rund 7'400 Impressionen in drei Monaten, 3 Klicks. Der Report selbst nennt das den "grössten Hebel" und empfiehlt genau die Landingpage, die inzwischen existiert. Ein neuer, sachlicher Drupal-Artikel, der nicht auf sie verlinkt, lässt diesen Hebel liegen.

*Vorschlag (keine Vorgabe):* in Zeile 45 "eine Agentur" auf `/de/drupal-agentur` verlinken; in Zeile 47 einen Halbsatz ergänzen, der auf `/de/drupal-wartung-as-a-service` verweist, z. B. "… im Wartungsbudget. NETNODE bietet dafür eine Drupal Wartung as a Service an, die diesen Rhythmus abdeckt." Das löst gleichzeitig Befund 2. Damit stehen 4 interne Links im Body (2 bestehende + diese 2), innerhalb der 2-bis-4-Spanne.

**Befund 2 — "NETNODE" kommt im Body kein einziges Mal vor. Nora's Station, GEO.**

Geprüft mit `grep -o NETNODE draft-v2.md`: 0 Treffer in `field_markdown`. Antwortmaschinen matchen Entitäten über den literalen String, nicht über automatische Autor-Metadaten. Lässt sich mit demselben Satz wie Befund 1 lösen (die Wartungsservice-Erwähnung), braucht keinen eigenen Umbau.

**Befund 1 in review-v2.md, Rita's Nit 1 — "seit Drupal 8.6 im Jahr 2018" unbelegt. Übernommen, weil der Text ohnehin zurückgeht.** Rita hat mich ausdrücklich gebeten, das mitzunehmen, falls ich den Text an Nora zurückgebe: Zeile 31, der Teilsatz ist durch keine der vier Quellen gedeckt (Rita hat `release-process-overview` erneut geprüft, kein Treffer für "8.6" oder "2018"). *Vorschlag:* Teilsatz streichen, der Satz trägt ohne ihn genauso. **Besitzer: Nora**, da der Text jetzt ohnehin zurückkommt — das war Ritas eigene Bedingung dafür.

## Suchintention und Keywords (keine eigene Keyword-Recherche möglich, als Schätzung markiert)

Hauptkeyword: **"Drupal 12"** — 13× im Body, in Titel, H1, Teaser, Lead und H2. Wer das sucht: Technik- oder IT-Verantwortliche bestehender Drupal-Websites in der Schweiz, die wissen wollen, ob und wann sie handeln müssen — die nächste Aktion ist "eigene Version prüfen" bzw. "Wartungspartner kontaktieren", genau das liefert die Tabelle in Zeile 18–25.

Nebenkeywords: "Sicherheitsupdate(s)" (7×), "Minor-Version" (10×). **Nit, nicht blockierend:** "Release-Zyklus" — der Begriff aus dem ursprünglichen Auftragstitel — kommt nur 2× vor, beide Male nur in der H2-Zeile bzw. im Schlusssatz, nie im erklärenden Fliesstext selbst. Trägt den Suchbegriff nicht so stark, wie der Auftragstitel suggeriert. Keine Textänderung nötig, da "Drupal 12" und "Minor-Version"/"Sicherheitsupdate" die tatsächliche Suchintention (Handlungsbedarf, nicht Begriffsdefinition) besser abdecken. **Besitzer: niemand, nur zur Kenntnis.**

Keine Kannibalisierung gefunden: Ich habe entgegen der Acht-Sitemaps-Angabe in meiner Rolle die **neun** Teil-Sitemaps unter `/de/sitemap.xml` selbst live abgefragt (Stand heute: `sitemap-pages`, `-static`, `-news`, `-case-studies`, `-whitepapers`, `-articles`, `-events`, `-employees`, `-guides` — meine eigene Notiz von letzter Woche mit "neun" war richtig, die Acht in der aktuellen Rollenbeschreibung ist veraltet). `sitemap-articles.xml` (545 URLs) enthält 25 bestehende Drupal-Artikel, nicht die 8, die Nora über eine `site:`-Suche fand — `site:`-Suchen untererfassen zuverlässig, das deckt sich mit meiner früheren Erfahrung mit den alias-losen Node-URLs. Die beiden inhaltlich nächsten geprüft: `neue-beta-version-von-drupal-1100-veroeffentlicht` (bereits im Draft abgegrenzt) und `kritisches-drupal-security-update-so-handeln-wir` (Mai 2026, CVE-2026-9082, akute Einzel-Lücke, nicht die reguläre Support-Fenster-Kadenz) sowie `wie-sicher-ist-drupal` (Sicherheitsarchitektur allgemein, kein Bezug zu Support-Monaten) — keiner davon deckt das Thema dieses Artikels (reguläre Minor-Version-Fristen).

## Nits (keiner blockierend)

**Nit — Backlink-Quelle: nicht "Was ist Drupal?", sondern der frischere Nachbar.** Nora schlägt in der Offene-Punkte-Liste vor, dass "Was ist Drupal?" nachträglich auf diesen neuen Artikel verlinken soll. Selbst geöffnet: der Post ist vom 22. Mai 2019 und nennt eine mutmasslich veraltete Zahl ("über 40'000 Erweiterungen") — kein falscher Versionsbezug wie bei Task 4, aber ein Post, der ohnehin ein Refresh brauchen könnte, bevor er als Linkquelle dient. Besser passt `kritisches-drupal-security-update-so-handeln-wir` (21. Mai 2026, aktuell, bereits thematisch benachbart: Sicherheitsupdates bei Drupal) als Backlink-Quelle, zusätzlich oder statt "Was ist Drupal?". **Besitzer: Web** — das ist eine Änderung an einem bestehenden, bereits publizierten Node, kein Teil dieses Textes.

**Nit — FAQPage-Schema fehlt für Artikel.** Bekannte, bereits dokumentierte Lücke (Epic 285 #2348): `FaqJsonLd.tsx` wird nie aus `NodeArticle.tsx` aufgerufen, nur aus zehn Landingpages. Der sichtbare FAQ-Block in diesem Draft wirkt für Antwortmaschinen trotzdem, weil die den Text lesen. **Besitzer: Web**, blockiert diesen Post nie.

**Nit — `field_article_employee` leer → Autor wird `NETNODE AG` als `Person` typisiert.** Vorbestehender CMS-Fehler, nicht durch diesen Text verursacht. **Besitzer: CMS-Schritt.**

## Länge: schliesse mich Ritas Einschätzung an, kein Zielkonflikt

Rita und ich sind uns hier einig, anders als bei Task 4 — das wird trotzdem dokumentiert, weil die Hausregel das für genau diesen Fall vorsieht. Body wächst von 815 auf 1052/1060 Wörter (kleine Abweichung zur Zählweise, ohne Belang). Aus Findbarkeits-Sicht ist das kein Problem: Die Tabelle mit sechs klar unterscheidbaren Fällen und die fünf FAQ-Antworten sind genau die Struktur, die Antwortmaschinen zitieren und die einen Leser mit einer konkreten Drupal-Version direkt zu seiner Zeile führt. Kürzen würde Genauigkeit kosten, nicht Lesbarkeit gewinnen. Falls trotzdem gekürzt werden muss, Ritas Vorschlag ("Wer das löst und was es kostet" zuerst) ist auch aus SEO-Sicht die richtige Stelle — Tabelle und FAQ sollten stehen bleiben.
