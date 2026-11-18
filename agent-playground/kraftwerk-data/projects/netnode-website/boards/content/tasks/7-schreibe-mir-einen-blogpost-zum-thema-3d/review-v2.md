Verdict: approved

# Review draft-v2.md (Task 7, 3D-Museumswelten)

Rita, 18.11.2026, Runde 2. Freigegeben wird draft-v2.md. review.md (Runde 1, zu draft-v1.md) bleibt als Protokoll stehen.

Geprüft habe ich die geänderten Stellen, nicht den ganzen Text noch einmal: Der Diff zwischen v1 und v2 zeigt 13 geänderte Body- und Feldzeilen und 3 Zeilen in der Schlussliste, alles andere ist zeichengleich und war in Runde 1 an der Quelle geprüft.

## Befunde aus Runde 1: Status

| Nr. | Befund | Status in draft-v2.md | Geprüft an |
| --- | --- | --- | --- |
| 1 | NEMO-Schluss nicht von den Zahlen getragen (Blocker) | geschlossen | Grafik S. 14 und S. 18 im PDF |
| 2 | Definition "im Browser" gegen "AR und VR im Haus" (Blocker) | geschlossen, 2 von 2 Stellen | Text gegen eigenen Text |
| 3 | "gilt für sie nicht" | geschlossen, 2 von 2 Stellen (Absatz und FAQ 5) | Volltext der Empfehlung, Runde 1 |
| 4 | "Öffentliche Listenpreise gibt es dafür kaum" | geschlossen, Noras Fassung ist genauer als mein Vorschlag | sketchfab.com/plans, Runde 1 |
| 5 | Bündner Kunstmuseum unter 360-Grad-Rundgang | geschlossen, mit Noras eigenem, belegtem Satz statt meinem | matterport.com/pro3, neu gelesen |

Nits aus Runde 1: 1 bis 5 geschlossen, 6 und 7 bleiben wie vorgesehen stehen, 8 brauchte nichts.

## Die drei Stellen, auf die Nora zeigt

**(1) "40 Prozent der Häuser boten keinen an".** Liest die Grafik richtig. S. 14, "How online services have changed since COVID19", 600 responses, Zeile "Virtual tours through the museum": 18 Prozent "Increased existing service", 29 Prozent "New service", 40 Prozent "We do not offer this", 11 Prozent "They did not change due to COVID19". Die 40 Prozent und die 29 Prozent stammen aus derselben Frage und derselben Basis, sie dürfen im selben Satz stehen. "Fast 40 Prozent" im Satz danach kommt aus einer anderen Frage (S. 18, 572 Antworten, 10,7 plus 28,7 gleich 39,4 Prozent); der Text trennt die beiden durch einen eigenen Satz, das genügt. Im Body steht "40 Prozent" 2-mal (einmal ohne Rundgang, einmal ohne Messung), "28 Prozent", "59 Prozent" und "42 Prozent" 0-mal.

**(2) Der Matterport-Satz.** "Matterport, der Anbieter des dort eingebetteten Rundgangs, bezeichnet seine Aufnahmen selbst als digitale Zwillinge." Ich habe matterport.com/pro3 selbst geholt (HTTP 200) und im sichtbaren Text gesucht: "Digital twins reimagined, re-engineered, and ready for anything" und "create beautifully accurate and immersive digital twins of any space". Der Satz ist als Selbstbezeichnung eines Anbieters markiert, das ist die richtige Stärke. Er ist besser als mein Vorschlag aus Runde 1, der eine technische Behauptung ohne gelesene Quelle war. Was er nicht belegt und auch nicht behauptet: mit welcher Kamera der Rundgang in Chur aufgenommen wurde. Siehe Nit 2.

**(3) Die neue Definition.** Body-Einstieg: "Mit einer 3D-Museumswelt erkunden Gäste Dein Haus oder Deine Sammlung räumlich und digital: meist direkt im Browser, im Haus auch mit AR oder VR." FAQ 1: "Gäste erkunden es meist direkt im Browser, im Haus auch mit AR oder VR." Beide Stellen schliessen jetzt alle vier Lösungen ein, und FAQ 1 steht allein. "Meist" ist durch den Text selbst gedeckt (drei von vier Lösungen laufen im Browser). Noras Grund gegen meinen Vorschlag stimmt: Eine VR-Brille ist für den Leser kein Bildschirm. Der Body beginnt nun anders als der Lead, damit ist auch Nit 1 erledigt.

## Selbstkorrektur

Mein Fix-Text in Befund 1 enthielt den Satz "Ob das Publikum die Online-Angebote nutzte, wussten viele nicht". Nora hat ihn übernommen. Er ist ungenauer als die Quelle: Gefragt wurde, wie sich die Online-Besuche seit der Wiedereröffnung entwickelt haben, und 39,4 Prozent erfassten das nicht oder wussten es nicht. Das ist die Entwicklung der Besuche insgesamt, nicht die Nutzung einzelner Angebote. Die Zahl und der Schluss ("braucht eine Messung") stimmen, nur der einleitende Halbsatz greift etwas zu weit. Folge: Nit 1 unten, kein Blocker, weil der Doppelpunkt-Satz danach den genauen Sachverhalt nennt.

## Nits (nicht blockierend)

1. **NEMO, einleitender Halbsatz** (Zeile 32). Vorschlag: "Wie sich ihre Online-Besuche entwickelten, wussten viele nicht: Fast 40 Prozent erfassten das nicht oder kannten die Entwicklung nicht." Besitzerin: Nora, falls der Text von Sven noch einmal zu ihr geht; sonst der Mensch im Review.
2. **Matterport steht nicht im Quellenblock.** Der Satz zur fliessenden Grenze stützt sich auf matterport.com/pro3, die Seite ist nicht unter "Quellen" verlinkt (dort stehen 11 Einträge). Mit dem Eintrag wären es 16 Links. Besitzer: Sven entscheidet, ob ein Herstellerlink in den Quellenblock gehört; eintragen würde ihn Nora.
3. **Schloss Thun als Beleg für Kosten** (Nit 6 aus Runde 1), unverändert. Kann stehen bleiben. Besitzer: niemand.
4. **WCAG 2.1.1 und das "dafür"** (Nit 7 aus Runde 1), unverändert. Besitzer: Sven, nur falls er den Satz umbaut.

## Länge: keine Vorgabe, Entscheid bei den Menschen

Der Body hat nach meiner Zählung 1518 sichtbare Wörter (v1: 1442), nach Noras 1534 (v1: 1458); `wc -w` gibt bei beiden 1592. Der Zuwachs von 76 Wörtern kommt aus den Befunden. task.md nennt keine Länge, die Spanne 1100 bis 1400 war Noras eigene Annahme. Ich habe deshalb nichts zum Kürzen verlangt. Wenn Sven aus Suchsicht eine andere Länge will, ist das ein Zielkonflikt für die Menschen, kein Befund.

## Was richtig ist und nicht angefasst werden darf

Zusätzlich zur Liste in review.md, die für alle unveränderten Stellen weiter gilt:

- **NEMO-Absatz**: 600 Museen, 48 Länder, 29 Prozent, 40 Prozent ohne Rundgang, fast 40 Prozent ohne Messung. Jede Zahl steht in der Quelle an einer Stelle eindeutig. Den Wert zum Publikumsinteresse (28 gegen 32 Prozent) bitte nicht zurückholen.
- **Empfehlung 2021/1970**: "auch für die Mitgliedstaaten nicht verbindlich, und die Schweiz ist nicht angesprochen" und FAQ 5.
- **FAQ 4**: "Hosting-Plattformen wie Sketchfab" ist genauer als mein "Plattformen", weil nur Sketchfab geprüft ist.
- **FAQ 2**: AR im Browser des Smartphones, gedeckt durch model-viewer ("on the web & in AR").
- **Deutsches Museum**: "sieht darin auch eine Grundlage für".
- **Schritt 4 der Liste** nennt keine Zahl mehr, die "fast 40 Prozent" stehen damit nur einmal.
- **Form, nachgezählt**: node_title 44 Zeichen, field_teaser_text 145, field_article_leadtext 163; 7 H2, 12 H3, kein H1, Überschriften unverändert; 15 Links auf 15 URLs; 0 lange Gedankenstriche, 0 Halbgeviertstriche, 0 ß; 14x Du/Dein gross, 0x klein, 0x Ihr/Ihnen; "im Browser" 4-mal. Alles wie in Noras Log.
- **draft-v1.md** ist unverändert (Zeitstempel 09:35, vor meinem Review).

## Liste für den CMS-Schritt

Noras Liste am Schluss von draft-v2.md ist vollständig und hat je Punkt einen Besitzer. Aus QA-Sicht nichts offen. Bei den Menschen liegen weiterhin: Winkel bei leerem task.md, kein eigenes 3D-Referenzprojekt, Hausnummern in Franken, Anrede im Cluster. Bei der Redaktion am Publikationstag: Schloss Thun, Bündner Kunstmuseum (Matterport-Einbettung), Deutsches Museum.
