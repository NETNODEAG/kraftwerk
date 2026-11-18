Verdict: approved

Runde 2 auf `draft-v2.md`. Freigabe mit fünf Nits, keiner davon blockierend — nach der Hausregel "eine Runde je Station" gebe ich jetzt frei und lasse den Rest als Nits stehen, jeder mit Besitzer und Station. `review.md` und `draft-v1.md` bleiben unverändert als Protokoll der ersten Runde stehen. Fix-Texte unten sind Vorschläge, keine Vorgaben.

## Befunde aus Runde 1 → Status in v2

| Befund (Runde 1) | Status |
| --- | --- |
| Blocker 1 — Argon2id-Satz durch die Quelle nicht gedeckt | **geschlossen.** Satz gestrichen, Grund in der Offenen-Punkte-Liste vermerkt. Nora hat die Quelle selbst erneut durchsucht und die Herkunft gefunden (Snippet von thedroptimes.com) — genau die Diagnose, die der Befund brauchte. |
| Blocker 2, Teil 11.4 — falsch mit 11.5/12.0 gebündelt | **geschlossen.** 11.4 hat eine eigene Zeile mit dem exakten Enddatum 21. April 2027. |
| Blocker 2, Teil 11.5 — "bekommt 12 statt 8 Monate" | **zurückgezogen. Mein Befund war falsch.** Siehe Korrektur unten. |
| Nit — 30 Prozent als zweiter Grund statt als Folge | **geschlossen.** Steht jetzt als Folge (Zeilen 35, 78). |
| Nit — Ankerzahl 11 statt 10 | **geschlossen.** Ursache war nicht der `node_title`, sondern das Prüfskript. Meine Erklärung war falsch, ihre stimmt — siehe Korrektur 2. |
| Nit — Zeile "11.0 bis 11.3 … ab 2027" | **geschlossen und erweitert.** 11.0–11.2 stehen jetzt auf "Ja, sofort", 11.3 hat eine eigene Zeile mit Supportende in der Woche vom 7. Dezember 2026. Diesen dritten Fall hat Nora beim Nachgehen des Nits selbst gefunden. |

## Korrektur 1: 11.5 bekommt 8 Monate, nicht 12 — mein Befund war falsch

Nora widerspricht mit Wortlaut, und sie hat recht. Ich habe beide Quellen selbst neu gelesen, nicht ihren Bericht übernommen:

- PSA-2026-11-02, wörtlich: **"Drupal 12.0 and 11.5 (scheduled for December 2026) will be supported until August 2027."** Dezember 2026 bis August 2027 sind 8 Monate.
- Die 6+6-Regel lautet wörtlich: **"The final minor version for each major receives six months of bugfix support followed by six months of security support."** Das ist die letzte Minor-Version *einer Major-Version*, und 11.5 ist das nicht: dieselbe PSA plant **"Drupal 12.1 and 11.6 (scheduled for June 2027) will be supported until February 2028"**, und die Schedule-Seite führt **"Week of Jun 14, 2027 (UTC) Drupal 12.1.0 and 11.6.0 released."**
- Auf der Schedule-Seite gehört die Formulierung "last minor version" zu Drupal 10: **"Drupal 10.6.x is the last minor version of Drupal 10."** Kein Satz dort bezeichnet 11.5 so.

Alle drei Zitate aus Noras Rückmeldung stimmen wörtlich.

**Wie ich den Fehler gebaut habe:** Ich habe die Quelle das Falsche gefragt. Meine Abfrage in Runde 1 lautete "welche Minor-Version ist die letzte der 11.x-Reihe, bevor 12.0 erscheint" — eine Suggestivfrage. Die Antwort ("die letzte Minor vor Drupal 12") habe ich dann gegen die PSA-Regel über "the final minor version for each major" gelegt. Das sind zwei verschiedene Dinge, und das eine davon hatte ich selbst in die Frage gelegt. Dazu kommt: der Satz, der mich widerlegt ("Drupal 10.6.x is the last minor version of Drupal 10"), stand bereits in meiner ersten Lektüre der Schedule-Seite. Ich habe ihn nicht gegen meinen eigenen Schluss gehalten.

**Was das gekostet hätte:** Hätte Nora meinen Fix-Text übernommen, stünde in der zentralen Handlungstabelle, dass der Schutz für 11.5 12 Monate läuft, also bis etwa Dezember 2027, statt im August 2027 zu enden. Vier Monate falsche Sicherheit, und zwar in der einen Zeile, aus der ein Leser handelt. Ein falscher Befund im Review ist teurer als ein falscher Satz im Draft, weil er mit Autorität und einem fertigen Fix-Text ankommt. Nora hat geprüft statt übernommen — das ist das Verhalten, das diese Hausregel will, und hier hat es genau das verhindert, was es verhindern soll. Bitte weiter so.

## Korrektur 2: Ursache der Ankerzahl

Ich hatte die Differenz 11 gegen 10 dem `node_title` zugeschrieben. Noras Erklärung ist die belegte: ihr v1-Skript lief über die ganze Datei und hat die Überschrift der Offenen-Punkte-Liste ausserhalb von `field_markdown` mitgezählt. Nachgezählt in v1: 10 Überschriften innerhalb von `field_markdown` plus die eine ausserhalb ergeben ihre 11. Mein Befund zu `ArticleHero.tsx` (`node_title` als `<Heading as="h1">` ohne `id`, ausserhalb der rehype-slug-Pipeline) ist unabhängig davon richtig, war aber nicht die Ursache. Folge gering, aber eine falsch diagnostizierte Ursache hätte denselben Zählfehler im nächsten Draft wiederholt.

## Nits (keiner blockierend)

**Nit 1 — "seit Drupal 8.6 im Jahr 2018" ist durch keine der vier Quellen gedeckt.** Zeile 31: *"Jede Minor-Version erhielt bisher 12 Monate Sicherheitsabdeckung, so war es seit Drupal 8.6 im Jahr 2018."* Die 12 Monate selbst sind belegt (PSA, plus 11.3 als Rechenbeispiel: Dezember 2025 bis Dezember 2026). Der Zusatz mit Version und Jahr ist es nicht: `release-process-overview` erwähnt weder "8.6" noch 2018 im Zusammenhang mit dem Support-Fenster, die anderen drei Quellen auch nicht. Das ist dieselbe Fehlerform wie der Argon2-Satz, nur an kleinerer Stelle — eine prüfbar klingende Jahres- und Versionsangabe ohne Quelle. *Vorschlag:* Teilsatz streichen; der Satz trägt ohne ihn genauso. Wer ihn behalten will, braucht einen Change Record auf drupal.org. **Besitzer: Nora, falls der Text von Sven ohnehin zurückkommt; sonst der Mensch im Review.** Das ist der einzige Nit, der aus meiner Sicht nicht unaufgelöst publiziert werden sollte, weil er eine Quellenregel berührt und nicht Geschmack — er steht deshalb auch auf der CMS-Liste unten.

**Nit 2 — "bei unveränderten Mitteln" an 2 Stellen (Zeilen 35 und 78).** Die PSA sagt, die Arbeitslast übersteige, was das Team *"especially with its current levels of funding, can sustain"* — also dass die heutigen Mittel nicht reichen, nicht dass sie über die Zeit unverändert geblieben sind. "Unverändert" behauptet eine Konstanz, die so nicht in der Quelle steht. *Vorschlag:* "bei den aktuellen Mitteln" (so stand es in v1 und war näher an der Quelle). **Besitzer: Nora, an derselben Station wie Nit 1.**

**Nit 3 — die 12-Monats-Ausnahme in der neuen FAQ-Antwort (Zeile 66), Noras Frage 3.** Die Antwort macht ihre Hauptsache gut: Versionen, Datum, Enddatum, und die Ausnahme ist korrekt *nicht* einer bestimmten Version zugeschrieben. Der Schlussteil *"und die jeweils letzte Minor-Version einer Major-Version behält 12 Monate"* ist aber die eine Stelle, an der ein Nicht-Fachleser hängen bleibt: er erfährt nicht, welche Version das ist, und kann sich selbst dafür halten — ein Leser auf 11.5 liest eine Zeile vorher "August 2027" und hier "12 Monate". Dass diese Verwechslung naheliegt, weiss ich belegt: ich bin ihr in Runde 1 selbst aufgesessen. *Vorschlag:* einen Halbsatz Anker ergänzen, etwa "…behält 12 Monate; für Drupal 11 steht diese Version noch nicht fest, 11.5 ist sie nicht." **Besitzer: Nora, falls der Text zurückkommt; sonst der Mensch im Review.**

**Nit 4 — "enden noch nach dem alten Muster" (Zeile 33) ist für 11.4 ungenau.** Für 11.3 stimmt es exakt (Dezember 2025 bis Dezember 2026, 12 Monate). 11.4 läuft von Juni 2026 bis 21. April 2027, also rund 10 Monate — weder altes noch neues Fenster; die PSA nennt es *"while the old schedule is being phased out"*. "Übergangsfälle" im selben Satz ist richtig, nur "nach dem alten Muster" trägt für 11.4 nicht. Die exakten Enddaten stehen direkt daneben, ein Leser wird also nicht fehlgeleitet. *Vorschlag:* "…sind Übergangsfälle mit eigenen Enddaten: 11.3 in der Woche vom 7. Dezember 2026, 11.4 am 21. April 2027." **Besitzer: Nora, falls der Text zurückkommt; sonst stehenlassen.**

**Nit 5 — zwei Wörter für dieselbe Sache, nie verbunden.** "Zwischenversion" steht 2× (Zeilen 6 und 24), "Minor-Version" 10× (Zeilen 29, 31, 33, 37, 60, 62, 66, 70). Beide "Zwischenversion"-Stellen kommen *vor* der Major/Minor-Erklärung in Zeile 29, das ist für den Einstieg sogar das freundlichere Wort — nur werden die beiden Begriffe nie aneinandergebunden. Wer Teaser und Tabelle liest und dann in die FAQ springt, muss selbst schliessen, dass dasselbe gemeint ist. *Vorschlag:* in Zeile 29 einmal "Eine Minor-Version, auch Zwischenversion genannt, …". **Besitzer: Nora, falls der Text zurückkommt; sonst der Mensch im Review.** Reiner Lesefluss, keine Faktenfrage.

## Was ist richtig und darf nicht angerührt werden

Runde-2-Prüfung auf die Umbaustellen konzentriert: alle Zahlen und Normbezüge einzeln durchgezählt, den unveränderten Rest nicht neu aufgerollt.

Termine, jeder einzeln gegen die Primärquelle gelesen (nicht aus v1 übernommen):

- **11.3, Woche vom 7. Dezember 2026** — Schedule, wörtlich: "Week of Dec 07, 2026 (UTC) Drupal 12.0.0 and 11.5.0 released. End of security support for 11.3.x and 10.6.x." Neue Tabellenzeile und Entscheidungsliste stimmen.
- **11.4, 21. April 2027** — Schedule, wörtlich: "April 21, 2027 (UTC) Last day of security support for 11.4.x." Der exakte Tag ist präziser als das "April 2027" der PSA; die Entscheidung, die Schedule-Seite zu nehmen, war richtig.
- **11.5 und 12.0, August 2027** — PSA, wörtlich (siehe Korrektur 1).
- **11.2, Woche vom 29. Juni 2026** — Schedule, wörtlich: "Week of Jun 29, 2026 (UTC) Drupal 11.4.0 released. End of security support for 11.2.x and 10.5.x." Dass für 11.0 und 11.1 kein Datum genannt wird, weil keines auf der Seite steht, ist richtig — kein erfundenes Datum.
- **Drupal 10 am 9. Dezember 2026, Drupal 11 Anfang Dezember 2028, Drupal 12 Anfang Dezember 2030**, und **12.0 in der Woche vom 7. Dezember 2026** — erneut bestätigt.

Regeln und Zahlen:

- **8 Monate = 6 + 2** — PSA: "Each minor version will have six months of bugfix support followed by two months of security-only support", und unabhängig bestätigt durch die vierte Quelle `release-process-overview`: "Each minor version is supported for eight months, with bug and security fixes for the first six months, and security fixes only for the last two months."
- **Die 12-Monats-Ausnahme** — ebenfalls doppelt belegt: PSA (6+6) und `release-process-overview`: "The final maintenance minor of each major version will receive security fixes for a full twelve months." Richtig ist vor allem, dass der Draft sie **keiner** namentlichen Version zuschreibt. Genau diese Zurückhaltung war der Fehler, den mein Befund hineingetragen hätte.
- **"mindestens 4 Jahre"** — "Each major version is supported for a minimum of 4 years, until the release of two further major versions."
- **Kadenz** — "Major versions are released every two years, in even years." / "Minor versions are released approximately every six months, in June and December."
- **Die Rechnung in Zeile 37** (nach einer neuen Minor bleiben 2 Monate, bisher 6) selbst nachgerechnet: 8 − 6 = 2, früher 12 − 6 = 6. Stimmt, und es ist die Stelle, die dem Leser das Fenster praktisch erklärt.
- **30 Prozent und der Grund** — unverändert korrekt, jetzt in der richtigen Einordnung als Folge.
- **PHP 8.5, MariaDB 10.11 (von 10.6), PostgreSQL 18 (von 16)** — unverändert korrekt.
- Die vierte Quelle nachträglich zu ergänzen, weil Kadenz und 4-Jahres-Aussage in v1 ohne Quelle im Text standen, war richtig und von mir nicht gefordert.

Selbst nachgezählt, alles bestätigt: Titel 35 Zeichen (Budget 47), Teaser 151, Lead 141, Body 1052 Wörter (`wc -w`), 6 H2 + 5 H3 = 11 Überschriften, 0 H1 im Body, 6 Tabellenzeilen ohne Kopfzeile, 6 URLs (4 drupal.org, 2 netnode.ch), 0 Halbgeviertstriche, 0 ß, 16 Höflichkeitsformen (13× Sie, 2× Ihre/Ihr, 1× Ihnen), 0× du. Die 11 Anker neu gegen github-slugger im geklonten Frontend gerechnet: 11 Überschriften, 11 eindeutige Slugs, keine Kollision (Skript danach gelöscht, `git status --short` leer). Beim Body in Zeichen komme ich auf 7578 gegen ihre 7577 — ein Zeichen Umbruch am Blockende, ohne Folge.

Feldanfänge einzeln geprüft, weil der Lead in ein eigenes Feld wandert und ein Bild dazwischen steht: `field_teaser_text` beginnt "Drupal 12 kommt im Dezember 2026, …", `field_article_leadtext` beginnt "Ab Dezember 2026 läuft Drupal 10 aus.", `field_markdown` beginnt "Drupal 12 erscheint in der Woche vom 7. Dezember 2026, …". Alle drei tragen allein, kein rückgreifendes Wort über eine Feldgrenze.

FAQ-Pass einzeln: alle fünf Antworten stehen als Zitat für sich und keine widerspricht dem eigenen Fliesstext — die Verallgemeinerung aus v1 ist weg. Einzige Schwachstelle ist Nit 3, und die ist Verständlichkeit, nicht Widerspruch.

Sie-Form: sauber durchgezogen (16 Höflichkeitsformen, 0× du). Der Entscheid selbst bleibt beim Menschen, ich löse ihn nicht auf.

## Länge: QA- und SEO-Sicht gehen hier auseinander

Der Body wächst von 815 auf 1052 Wörter, plus 237. Meine QA-Position: Dieser Zuwachs ist genau der Preis dafür, dass jede Tabellenzeile jetzt eine Realität und ein Datum trägt — und das ist, was eine falsche Handlung verhindert. Ich würde ihn nicht zurückhandeln. Wenn Sven die Länge für die Findbarkeit anders bewertet, ist das der dokumentierte Zielkonflikt und nicht ein Fehler: beide Begründungen gehen an die Menschen, keiner von uns löst das allein. Falls gekürzt werden muss, trägt "Wer das löst und was es kostet" die am wenigsten datumskritische Information; Tabelle und FAQ sollten unangetastet bleiben.

## Für die CMS-Checkliste

Noras Liste bleibt gültig, mit einer Ergänzung von mir:

- Die vier Termine (9.12.2026, Woche vom 7.12.2026, 21.4.2027, August 2027) am Publikationstag gegen Schedule-Seite und PSA nachprüfen — **Redaktion**.
- Backlink von "Was ist Drupal?" auf diesen Artikel — **Web**, anderer Node.
- `field_article_links` — **Sven**.
- Sie-Form-Entscheid — **Mensch**.
- Argon2id bleibt gestrichen; nur mit eigener Primärquelle auf drupal.org zurück in den Text — **Redaktion**.
- **Neu: Nit 1** ("seit Drupal 8.6 im Jahr 2018") vor der Publikation entweder mit einem drupal.org-Change-Record belegen oder den Teilsatz streichen — **Nora oder der Mensch im Review**. Nicht unaufgelöst publizieren.
