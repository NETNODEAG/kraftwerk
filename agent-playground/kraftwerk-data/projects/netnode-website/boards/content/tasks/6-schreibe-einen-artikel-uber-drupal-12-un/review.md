Verdict: changes requested

Runde 1. Zwei Blocker, beide an der Stelle, die Nora explizit zur Prüfung vorgelegt hat (Kernclaim PSA-2026-11-02 und die Tabelle). Fix-Texte unten sind Vorschläge, keine Vorgaben — wenn Nora beim Gegenlesen der Primärquelle eine bessere Formulierung findet, gilt die, nicht meine.

## Blocker 1 — Argon2id-Satz ist durch die zitierte Quelle nicht gedeckt

> Zeile 33: "und PHP muss mit Argon2-Unterstützung kompiliert sein, weil Argon2id zum Standard für das Hashing von Passwörtern wird."

Ich habe drupal.org/about/core/blog/announcing-drupal-1200-platform-requirements selbst gelesen und zusätzlich gezielt nach "Argon2" / "password hash" durchsucht: PHP 8.5, MariaDB 10.11 (hoch von 10.6) und PostgreSQL 18 (hoch von 16) stehen dort, Argon2 oder Passwort-Hashing kommt im gesamten Blogpost kein einziges Mal vor. Die drei Plattform-Minima sind belegt, der Argon2-Satz ist es nicht — das ist entweder aus einer anderen, nicht zitierten Quelle oder erfunden.

**Vorschlag:** Satz streichen. Falls Argon2id tatsächlich kommt, braucht es eine eigene Primärquelle (z. B. ein separates Core-Issue oder eine RFC-Seite auf drupal.org), bevor der Satz zurück in den Text darf.

## Blocker 2 — Tabelle und Fliesstext generalisieren das 8-Monats-Fenster falsch

> Zeile 22 (Tabelle): "Sie betreiben bereits Drupal 11.4, 11.5 oder 12.0 | Ja, Sie sind bereits im neuen Rhythmus | Alle 6 Monate aktualisieren, sonst endet der Schutz nach 8 statt 12 Monaten"
> Zeile 29 (Fliesstext): "verkürzt das Drupal-Sicherheitsteam dieses Fenster für alle 2027 unterstützten Versionen auf 8 Monate"

Ich habe PSA-2026-11-02 und die Schedule-Seite selbst gelesen (nicht nur den von Nora zitierten Auszug übernommen). Zwei Ausnahmen fehlen in beiden Sätzen:

- **11.3 und 11.4** bleiben laut PSA explizit "transitional versions ... still following the old 12-month schedule" — 11.4 gehört also ins alte 12-Monats-Fenster, nicht ins "neue Rhythmus"-Feld der Tabelle.
- **11.5.0** ist laut Schedule-Seite "the final minor release preceding Drupal 12" (zusammen mit 12.0.0 in der Woche vom 7. Dezember 2026 veröffentlicht). Die PSA sagt ausdrücklich: Die letzte Minor-Version vor einem Major-Wechsel bekommt 6 Monate Bugfix + 6 Monate Security-only = 12 Monate, nicht 8. Nur 12.0 selbst fällt unter das neue 8-Monats-Fenster (6+2).

Die Tabellenzeile bündelt also drei Versionen mit zwei unterschiedlichen, teils entgegengesetzten Realitäten unter einer Handlungsempfehlung. Für jemanden auf 11.5 ist "sonst endet der Schutz nach 8 statt 12 Monaten" schlicht falsch — der Schutz dort endet wie bisher nach 12 Monaten. Das sitzt genau in der Tabelle, die Nora als Punkt 3 zur Prüfung vorgelegt hat, und zwar in der Handlungsspalte, die ein Nicht-Fachleser direkt umsetzt.

**Vorschlag:** Zeile aufteilen: (a) 11.3/11.4 — altes 12-Monats-Fenster, läuft aus wie gewohnt; (b) 11.5 — Sonderfall mit 12 Monaten als letzte Minor-Version vor Drupal 12; (c) 12.0 und alles danach — neues 8-Monats-Fenster. Im Fliesstext "für alle 2027 unterstützten Versionen" präzisieren, z. B. "für jede Minor-Version ausser der letzten vor einem Major-Wechsel".

### Nit dazu — Zeile 21 (nicht blockierend, nicht vollständig durchgerechnet)

> "Sie betreiben Drupal 11.0 bis 11.3 | Ja, ab 2027 verkürzt sich Ihr Sicherheits-Fenster | Update auf 11.4 oder 11.5 einplanen"

Laut Schedule-Seite endet der Security-Support für 11.2.x bereits in der Woche vom 29. Juni 2026 (zusammen mit 10.5.x) — also schon heute (12.11.2026), nicht erst ab 2027. Wer noch auf 11.0–11.2 läuft, hat vermutlich schon jetzt keine Sicherheitsupdates mehr. Ich habe das nur für 11.2 belegt, nicht für 11.0/11.1 einzeln nachgerechnet — Nora bitte beim Nachbessern von Blocker 2 gleich mitprüfen, ob diese Zeile auch geteilt werden muss.

## Nit — Grund vs. Folge bei den 30 Prozent (nicht blockierend)

> Zeile 29: "Als Grund nennt das Team zwei Dinge: eine stark gestiegene Zahl an Sicherheitsmeldungen ... und das Ziel, den Backport-Aufwand ... um rund 30 Prozent zu senken."

In der PSA selbst steht der 30-Prozent-Satz im Kontext der Folgen/Vorteile der Entscheidung ("We will continue protecting Drupal sites for at least 4 years ... while cutting backport work ... by 30%"), nicht als zweiter, gleichrangiger Grund neben der Flut an Sicherheitsmeldungen. Die Zahl selbst ist richtig, nur die Einordnung als "zweiter Grund" verschiebt die Quelle leicht.

**Vorschlag:** "Als Grund nennt das Team eine stark gestiegene Zahl an Sicherheitsmeldungen ... Als Folge der Verkürzung rechnet das Team zudem mit rund 30 Prozent weniger Backport-Aufwand." Kann auch so bleiben, wenn Nora die Quelle anders liest — die 30 % selbst sind nicht strittig.

## Nit — Ankerzahl im Log (keine Textänderung, nur zur Protokollführung)

> Log 14:20: "alle 11 Anker eindeutig, keine Kollisionen"

Ich habe die Anker selbst mit github-slugger im geklonten `repos/frontend.netnode.ch` nachgebaut (Skript geschrieben, ausgeführt, gelöscht — Repo danach clean laut `git status --short`): im Body stehen 6 H2 + 4 H3 = **10** Überschriften, alle mit eindeutigem Slug (bestätigt: keine Kollision). Der `node_title` wird in `ArticleHero.tsx` als reines `<Heading as="h1">` ohne `id` gerendert, ausserhalb der `MdxContent`/rehype-slug-Pipeline — er bekommt also gar keinen Anker. Damit sind es 10 Anker, nicht 11. Das Ergebnis (keine Kollision) stimmt trotzdem, nur die Zahl im Log war falsch.

## Was ist richtig und darf nicht angerührt werden

- EOL-Daten selbst auf der Schedule-Seite gelesen und bestätigt: Drupal 10 → 9. Dezember 2026, Drupal 11 → Anfang Dezember 2028, Drupal 12 → Anfang Dezember 2030.
- Drupal 12.0-Release "Woche vom 7. Dezember 2026" (zusammen mit 11.5.0) — selbst auf drupal.org gelesen, korrekt.
- Plattform-Minima PHP 8.5, MariaDB 10.11 (hoch von 10.6), PostgreSQL 18 (hoch von 16) — selbst auf drupal.org gelesen, korrekt (nur der angehängte Argon2-Satz ist das Problem, siehe Blocker 1).
- Die 30-Prozent-Backport-Zahl selbst und die "Tsunami an Sicherheitsmeldungen durch KI-Tools" als Kernursache — korrekt wiedergegeben (nur die Einordnung als "zweiter Grund" ist der Nit oben).
- Alle drei Quellen sind drupal.org-Primärquellen, keine Vendor- oder Agentur-Blogs — bestätigt.
- Zählungen selbst nachgerechnet und korrekt: Titel 35 Zeichen, Teaser 148 Zeichen, Lead 145 Zeichen, Body 815 Wörter, 6 H2 + 4 H3, 5 URLs, 0 Halbgeviertstriche, 0 ß, 12× Sie, 0× du.
- FAQ-Antworten einzeln als Zitat-Einheit geprüft: alle vier stehen ohne den umgebenden Fliesstext verständlich, keine widerspricht dem eigenen Körper (anders als bei Task 4 kein "alles"-Fehler gefunden).
- CMS-Paket-Form passt: Feldmarker korrekt, kein H1 im `field_markdown`-Body, offene Punkte am Ende sauber mit Besitzer versehen (Redaktion fürs Datum, Web für den Backlink, Sven für `field_article_links`, Mensch für die Sprachform).
- Sie-Form-Entscheid: bleibt bewusst offen für einen Menschen, wie von Nora vorgesehen — ich löse das nicht auf. Sachlich passt Sie-Form zum Entscheider-Publikum, sobald Blocker 2 behoben ist.

## Für die CMS-Checkliste (nichts Neues, Noras Liste bleibt gültig)

- Wochendaten am Publikationstag gegen die Schedule-Seite nachprüfen (Redaktion).
- Backlink von "Was ist Drupal?" auf diesen Artikel (Web, anderer Node).
- `field_article_links` bleibt Sven.
- Sie-Form-Entscheid liegt bei einem Menschen.
