# Review draft-v2.md — Agentische Systeme: was sie sind, was sie bringen

Verdict: approved

Rita, 7.11.2026, zweite Runde. `review.md` bleibt daneben als Protokoll der ersten
Runde stehen; `draft.md` ist unverändert und war nie freigegeben, deshalb braucht
es dort keinen Nachtrag. Freigegeben ist **`draft-v2.md`**.

Vier Nits bleiben offen, keiner blockiert, jeder hat einen Besitzer. Drei davon
sind Ein-Wort-Korrekturen; wenn die Aufgabe aus irgendeinem Grund noch einmal nach
Writing zurückkommt, gehören sie in denselben Durchgang.

## Befunde aus Runde eins → Status

| Befund | Status | Womit geprüft |
|---|---|---|
| B1 — FAQ «alles landet als interne Notiz» ist falsch | **geschlossen, besser als mein Fixtext** | Antwort nennt jetzt beide automatischen Schreibvorgänge und zieht die Grenze an der Aussengrenze; gegen `apply.sh` gelesen |
| B2 — zwei Aufwandzahlen ohne Quelle | **geschlossen** | «Bei drei Tickets eine Viertelstunde, bei zwanzig der halbe Vormittag» ist raus, keine Zahl an ihre Stelle getreten |
| B3 — «Ein Agent liest sie» | **geschlossen** | Filterschritt steht jetzt im Satz, gegen `fetch.sh` Zeilen 120–146 gelesen |
| N1 — Definition dreimal, Erklärung vier Absätze | **geschlossen** | Erklärung hat jetzt 3 Absätze (1 vor der ersten H2 + 2 im Abschnitt), nachgezählt |
| N2 — «die beiden Trennlinien» bei drei `---` | **geschlossen, besser als mein Vorschlag** | Marker in Zeile 26 und 219, im Rest der Datei genau eine `---` (Zeile 230) |
| N3 — «Lesbarkeit gegen Länge» | **geschlossen** | heisst jetzt «Findbarkeit gegen Lesbarkeit» |
| N4, N5, N6 | **als Punkte 7, 8 und 9 in der CMS-Liste** | im Dateiende nachgelesen, alle drei vollständig mit Besitzer |

## Zu deinen beiden Abweichungen: du hast in beiden Fällen recht

**B1.** Deine Begründung trifft, mein Fixtext war schlechter als deiner. «Automatisch
gesetzt wird nur die Priorität» lässt sich tatsächlich so lesen, als schriebe ein
Mensch die beiden Kommentare — `apply.sh` postet sie mit demselben automatischen
`my comments add`, nur mit `--internal`. Hätte ich meinen Satz durchgesetzt, hätte
die FAQ-Antwort einen neuen Fehler getragen statt den alten zu verlieren, und zwar
genau an der Stelle, die allein zitiert wird. Deine Fassung zieht die Grenze dort,
wo sie im Code wirklich liegt. Bitte mach das weiter so.

**B2.** Hier ist mein Fehler grösser, und er gehört ins Protokoll: mein **erster**
Fixtext enthielt «bei zwanzig ist der halbe Vormittag weg» — also exakt die
erfundene Zahl, um die der Befund ging. Hättest du ihn übernommen, wäre B2 nicht
geschlossen gewesen und wir wären in einer dritten Runde über dieselbe Stelle.
Dass du stattdessen den zweiten Vorschlag genommen und die Läufe selbst
durchgesehen hast, hat genau das verhindert. Deine Gegenzahlen stimmen mit meinen
überein: 17 Läufe von `helpdesk-check`, Maximum vier offene Tickets, am 16.9.2026
eines, keine Zeitmessung irgendwo.

## Die Kürzungen: nichts aus der geschützten Liste ist verlorengegangen

Das war deine Hauptfrage, und sie ist die richtige — bei einem Umbau sitzt der
Fehler fast immer dort. Ich habe nicht stichprobenartig geschaut, sondern den
Körper von v1 gegen den von v2 wortweise diffen lassen und **jede** geänderte
Stelle einzeln angesehen.

**Ergebnis: 26 geänderte Stellen, 80 Wörter raus, 80 Wörter rein, netto null.**
Davon entfallen **12** auf B1, B2, B3, N1 und N3 (B1 vier, B2 eine, B3 zwei,
N1 drei — darunter die reine Zeichensetzung «Antwort. Was» → «Antwort; was» —,
N3 zwei) und **14** auf reine Kürzungen. 12 + 14 = 26.

Deine Logzeile sagt «an zwölf Stellen gekürzt», ich komme auf vierzehn. Der
Unterschied ist die Zählregel, keine übersehene Kürzung: ich zähle Diff-Stellen,
du zählst offenbar Sätze, und drei meiner vierzehn sind Einzelwörter, von denen
zwei im selben Satz sitzen («weil sie nerven» und «Chatfenster, **nur** mit
Schreibrechten»). Hier sind alle vierzehn, damit niemand sie noch einmal suchen muss:

1. «und wie voll der Tag war» (Gleichmässigkeit)
2. «In einem Postfach hast du das nicht.» (Nachvollziehbarkeit)
3. «und nicht aus der Erinnerung beschrieben» (Intro der Beispiele)
4. «wirklich» (Helpdesk, Heute)
5. «nach zwei Wochen» → «später» (Redaktionskette, Vorher)
6. «Befund» in «und jeder Befund steht in einer Datei»
7. «sobald es eng wurde» (Wettbewerb, Vorher)
8. «und beschleunigt sie» (Grenzen, Der Prozess ist nicht beschrieben)
9. «weil sie nerven» (Grenzen, Die Entscheidung trägt Verantwortung)
10. «nur» in «Chatfenster, nur mit Schreibrechten»
11. «zwei» in «ohne diese zwei Zahlen»
12. «dabei» in «gehören dabei dem Team»
13. «und» vor «wie wir damit Workflows bauen» (kraftwerk-Abschnitt) → siehe NV3
14. «und» vor «jede fehlgeschlagene Prüfung» (FAQ 4)

**Dreizehn der vierzehn kosten nichts.** Nummer 14 erzeugt ein Komma zwischen zwei
Hauptsätzen, das im Deutschen zulässig ist und sich gut liest. Nur Nummer 13 kostet
etwas, siehe unten.

Deine Aussage «kein Punkt aus Ritas Liste ist betroffen» habe ich nicht
übernommen, sondern die Liste Punkt für Punkt gegen `draft-v2.md` gehalten. Sie
stimmt. Im Einzelnen, alles in v2 nachgelesen:

- Fünf erlaubte Prioritätswerte, Kategorie A bis D, «Ist die Kategorie eine der
  vier?», «Fehlt eine Begründung, ein Ticket, ein Textbaustein?», zwei
  Textbausteine, «ruft das Ticket neu ab und vergleicht», «Schlägt eine Prüfung
  fehl, geht der Befund zurück an den Agenten, benannt bis aufs Ticket», «Beide
  Texte landen als interne Notiz am Ticket, nie als Antwort an die Kundin» — alle
  unverändert.
- Sieben Spalten, drei Agenten, acht Dateien, 93 Logzeilen, drei Entwürfe, fünf
  Runden — alle unverändert, alle weiterhin richtig.
- Zeile für Zeile, kein Modell im Hol- und Diff-Teil, nur geänderte Seiten, zwei
  bis vier Punkte, nichts behaupten ausserhalb des Vergleichs, zwei Seiten — alle
  unverändert.
- kraftwerk: alle fünf Fakten wörtlich erhalten, keine Version, keine Lizenz, keine
  Preise dazugekommen. Gekürzt wurde dort nur «dabei» und das «und» aus NV3.
- Die drei Fragen aus Task 1 stehen wörtlich («Als wer handelt der Agent? Worauf
  darf er zugreifen? Wer schaut zu, wenn er es tut?»), der Entstehungssatz steht,
  alle drei Blöcke tragen weiterhin **Vorher**, **Heute** und **Wo der Mensch
  entscheidet** — je dreimal gezählt.
- «Wir messen den Nutzen nicht in Prozent und erfinden auch keine» steht noch da,
  und jetzt stimmt der Rest des Textes auch dazu.

## Offene Nits

Keiner blockiert. NV1 ist der, an dem mir am meisten liegt.

| # | Stelle | Befund und Fix | Wer / wann |
|---|---|---|---|
| NV1 | FAQ, «Entscheidet die KI dann über Kundenanliegen?» | «was die Kundin liest, **bestätigt** ein Mensch im Support» ist enger als dein eigener Fliesstext, der sagt: «der Mensch im Support schickt ihn ab, **ändert ihn oder verwirft ihn**». Im Workflow gibt es keinen Bestätigen-Knopf; der Mensch handelt ausserhalb. Allein zitiert liest sich «bestätigt» wie ein Abnicken. Fix: «**entscheidet** ein Mensch im Support» — das Wort aus v1, kein Wort mehr. | Nora, sobald die Datei wieder offen ist |
| NV2 | «Chatbot, Agent, agentisches System», dritter Satz | «Im agentischen System hat **jeder Agent** nur seine Rolle, zwischen **ihnen** liegen Übergaben» — «ihnen» hat seit dem N1-Umbau keinen Plural mehr, auf den es zeigt (v1 hatte «Mehrere Agenten haben je eine Rolle»). Fix ohne Wortzuwachs: «…nur seine Rolle, **dazwischen** liegen Übergaben». Oder mit einem Wort mehr: «zwischen **den Agenten** liegen Übergaben». | Nora, sobald die Datei wieder offen ist |
| NV3 | kraftwerk-Abschnitt, letzter Satz | Kürzung 13 hat das «und» entfernt: «Der Code liegt offen auf GitHub, wie wir damit Workflows bauen, steht in …». Durch die drei Kommas hintereinander liest sich der Mittelteil zuerst als Nebensatz zu GitHub. Fix: «und» zurück. Kostet ein Wort, der Körper läge dann bei 1374 sichtbaren Wörtern und damit weiter innerhalb von 900–1400. | Nora, sobald die Datei wieder offen ist |
| NV4 | CMS-Liste, Punkt 2 (Du-Form gegen Sie-Form) | Meine Korrektur ist im Log angekommen, aber nicht in Punkt 2 — und der Mensch entscheidet aus der Liste, nicht aus dem Log. Ergänzung, eine Zeile: «Ein Wechsel fasst auch `field_article_leadtext` an («Ein Chatfenster antwortet dir»), nicht nur `field_markdown`. Stand v2: 7-mal «du» und 1-mal «deine» im Körper plus 1-mal «dir» im Lead, zusammen neun Stellen.» | Nora, sobald die Datei wieder offen ist; sonst liest der Mensch die Zahlen hier |

Zwei Kürzungen haben dem Text etwas Kante genommen, ohne dass ein Fakt
verlorenging: «und beschleunigt sie» und «In einem Postfach hast du das nicht.»
Das ist kein Befund, und ich verlange nichts. Falls Svens Durchgang Wörter frei
macht, wären das die zwei, die ich zuerst zurückholen würde.

## Was in v2 richtig ist und nicht angefasst werden darf

Zusätzlich zu allem aus `review.md`, das oben Punkt für Punkt nachgeprüft ist:

- **B1-Antwort inhaltlich korrekt.** Gegen `apply.sh` gelesen: das System setzt die
  Priorität (`my tickets priority`) und hängt beide Texte mit `--internal` an;
  «zwei Dinge am Ticket» ist richtig gezählt, «nach aussen geht nichts davon»
  stimmt. Eine Feinheit, die **keine** Änderung verlangt und die ich nur aufschreibe,
  damit sie niemand als Fehler meldet: `apply.sh` schreibt die Priorität nur, wenn
  sie von der aktuellen abweicht (`if p["priority_proposed"] != p["priority_current"]`).
  Im Lauf vom 16.9.2026 war sie gleich, also blieb der Schreibvorgang aus. Der
  Endzustand ist derselbe, den der Satz beschreibt — er bleibt so stehen.
- **N2 ist besser gelöst als von mir vorgeschlagen.** Zeilennummern verrutschen bei
  der nächsten Fassung, Marker nicht. Dass die Markerzeilen ausdrücklich nicht zum
  Feldwert gehören, steht im Dateikopf; ich habe nachgezählt, dass es im Rest der
  Datei genau noch eine `---` gibt (Zeile 230), die also nicht mehr verwechselt
  werden kann. Die Marker sind HTML-Kommentare ausserhalb des Feldwerts und können
  in NodeHive nichts anrichten.
- **Form, selbst nachgezählt in v2, nicht aus deinem Log übernommen:**
  Körper 1373 Wörter sichtbarer Text und 1399 nach `wc -w` — die Differenz von 26
  sind exakt die Überschriftenmarker (7 H2 + 19 H3), nicht die Linksyntax; 9484
  Zeichen ohne abschliessenden Zeilenumbruch. Alle drei Werte stimmen mit deinen
  überein. Lead unverändert 309 Zeichen und 47 Wörter. Keine H1, 7 H2, 19 H3, vier
  URLs, null `ß`, null lange Gedankenstriche in der ganzen Datei, null «Sie» und
  null «Ihr» im Körper.
- **Du-Form-Stand in v2:** 7-mal «du», 1-mal «deine» im Körper, 1-mal «dir» im
  Lead, zusammen neun. Die eine Stelle weniger gegenüber v1 steckt in Kürzung 2
  («hast **du** das nicht»). Deine Zählung stimmt.
- **Feldanfänge tragen weiterhin je für sich:** Lead «Ein Chatfenster antwortet
  dir», Körper «Ein agentisches System ist Software, die …». Kein Bezugswort über
  die Feldgrenze.
- **Dass die Definition zweimal steht, im Lead und im Körperanfang, ist richtig so**
  und war nie mein Befund. Deine Begründung — der Körper muss ohne den Lead tragen,
  weil `field_article_leadtext` im Hero steht und das Feld ist, an dem noch gedreht
  wird — deckt sich mit dem, was ich in `NodeArticle.tsx` nachgesehen habe. Nicht
  zusammenziehen.
- **Die FAQ-Antworten 1, 2 und 4 stehen weiterhin je für sich**, auch allein
  zitiert. Nur Antwort 3 trägt NV1.

## Konflikt mit SEO

Keiner. Die Länge liegt mit 1373 Wörtern innerhalb der Vorgabe aus task.md. Wenn
Sven mehr Text will, ist das der bekannte Zielkonflikt aus Task 4: beide
Begründungen ins Log, Entscheid an die Menschen, keine weitere Runde zwischen uns.

## Was mit dem Paket an die Menschen geht

Offen und nicht im Text lösbar sind die **neun Punkte** am Ende von `draft-v2.md`
(Positionierung von kraftwerk, Anredeform, Stand der zwei beobachteten Seiten,
Backlinks, der fehlende Task-1-Post, die npm-Seite, 93 Logzeilen und acht Dateien
nachzählen, ein `competitor-watch`-Lauf, den alten kraftwerk-Post nachziehen) plus
die vier Nits oben. Zwei Entscheide gehören einem Menschen und keinem von uns:
die Positionierung von kraftwerk auf netnode.ch und die Anredeform — letztere
zusammen mit Task 4, wo sie seit dem 7.11.2026 ebenfalls offen ist.
