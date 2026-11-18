# Review draft-v3.md — Verdict: approved

> **Nachtrag vom 7. November 2026, 17:35 (rita). Freigegeben.** Der eine Befund ist mit dem
> Fixtext unverändert geschlossen; der Körper beginnt jetzt mit «Dass die Pflicht noch nicht
> beschlossen ist, heisst nicht, dass heute nichts gilt: Diskriminieren darfst du schon jetzt
> nicht, und darauf kommen wir unten zurück.» Der Absatz steht damit allein und hängt nicht
> mehr an der Formulierung von `field_article_leadtext`. Sonst ist nichts angetastet, auch der
> Lead nicht.
>
> Nachgeprüft: `title` 47 Zeichen, `field_teaser_text` 157, `field_article_leadtext` 286,
> `path` 37 ohne Jahreszahl. Kein H1 im Körper, elf H2 und fünf H3, kein ß, null lange und
> null kurze Gedankenstriche, du-Form, keine Sie-Form, 2358 Wörter im Postteil. Fünfundzwanzig
> Stichproben auf Zahlen und Rechtsbezüge gegen die freigegebene v2: alle identisch. Die
> einzige Abweichung war «7. November 2026» mit neun statt sechs Treffern, und alle drei
> zusätzlichen liegen ausserhalb des Körpers (Dateikopf, Änderungsvermerk, Aufgabenliste) — im
> Körper stehen genau dieselben sechs wie in v2. Die zehn Anker habe ich am Endstand noch
> einmal durch `github-slugger` geschickt, alle treffen. Dass du den Ankerpunkt unabhängig
> nachgerechnet hast statt ihn zu übernehmen, ist genau richtig; das Repo ist vorher und
> nachher clean, ich habe es geprüft.
>
> **Eine Korrektur an mir selbst, weil sie ändert, was jemand tut:** In meinem Review stand,
> der Text nenne den 7. November 2026 «an drei Stellen». Es sind sechs im Körper.
>
> **Ein neuer Nit, der genau daran hängt** — der letzte, und er kostet eine Zeile in der
> Aufgabenliste, nicht im Text: Die Anweisung zum Stand-Datum nennt «den Abschnitt zur
> Jahreszahl und die Abfragedaten in den Referenzen». Das sind vier der sechs Stellen. Die
> anderen zwei stehen im FAQ-Block (Zeile 351 «Stand 7. November 2026» in der ersten Antwort,
> Zeile 356 «liegt am 7. November 2026» in der zweiten). Gerade die dürfen nicht veralten,
> weil FAQ-Antworten dafür gebaut sind, wörtlich zitiert zu werden. Bitte den FAQ-Block in der
> Anweisung ausdrücklich dazuschreiben — oder kürzer und sicherer: «alle sechs Stellen mit dem
> 7. November 2026 im Körper».
>
> Das ist ein Nit und kein Grund für eine weitere Runde. `draft-v3.md` ist freigegeben und
> meine Empfehlung zum Publizieren.

# Ursprüngliches Review vom 17:25 — Verdict: changes requested (ein Satz)

Das Einstell-Paket ist richtig gebaut: ein Abschnitt pro Feld, Werte nachgezählt, kein H1 im
Körper, klare Schnittmarken. Alle vier Nits sind geschlossen, und keine Zahl und kein
Rechtsbezug hat sich gegenüber der freigegebenen v2 verschoben, das habe ich einzeln
gegengezählt. Zurück geht die Datei wegen genau eines Satzes, und das ist der, auf den du mich
selbst hast schauen lassen: **der erste Satz des Körpers trägt ohne den Lead nicht.** Fixtext
unten, danach geht die Fassung durch.

Deine zweite Frage, die Länge: Nein, ich sehe es nicht anders. Deine Lesart meiner Position ist
richtig, ich bleibe dabei, und du sollst nichts kürzen.

Eine gute Nachricht dazu, die einen alten Punkt von meiner Liste nimmt: **Die Anker stimmen
nachweislich, der CMS-Klick dafür ist nicht nötig.** Begründung unten.

## Der eine Befund: «allerdings» hat im Körper keinen Bezug

> Diskriminieren darfst du allerdings auch heute nicht, und darauf kommen wir unten zurück.

Du hast gefragt, ob das ohne den Lead trägt. Ich habe es nicht geschätzt, sondern im Frontend
nachgesehen (`repos/frontend.netnode.ch`), weil die Frage davon abhängt, wo die beiden Felder
auf der Seite landen:

* `src/components/node/article/NodeArticle.tsx` rendert zuerst `<ArticleHero … title={title}
  teaserHtml={teaser?.processed} author={…} image={…} />` in einem eigenen `Container`, und
  **danach in einem zweiten `Container` mit `pt-20 md:pt-28`** den Körper.
* `src/components/node/article/ArticleHero.tsx` ist laut eigenem Kommentar ein «swiss split
  layout»: Rücklink in den Spalten 1–2, der Titel in 3–6, und am unteren Rand dieser Spalte
  sitzt der Lead in einem Untergitter **neben dem Autorenblock**; das 16:9-Bild nimmt die
  Spalten 7–12.

Der Lead ist damit ein Element des Heros neben dem Autorenfoto, und der Körper beginnt nach
einem Layoutwechsel und fünf bis sieben Rem Abstand. Auf dem Handy liegt zwischen Lead und
Körper zusätzlich das Hero-Bild. Das «allerdings» muss also über die Autorenzeile und einen
Abschnittswechsel zurückgreifen, und der erste Satz des Posts beginnt mit einem Widerspruch zu
etwas, das nicht mehr daneben steht.

Zwei Gründe kommen dazu, die unabhängig vom Layout gelten:

1. **Der nächstliegende Bezug ist der falsche.** Der Lead endet mit «Der 1. Januar 2027, der
   überall steht, ist nirgends festgelegt.» Wer von dort weiterliest, bezieht das «allerdings»
   auf das Datum, nicht auf die fehlende Pflicht. Gemeint ist der Widerspruch zu «nicht
   beschlossen», und der steht einen Satz weiter vorn.
2. **Der Körper darf nicht von der Formulierung eines anderen Feldes abhängen.**
   `field_article_leadtext` ist der sichtbare Lead und damit das Feld, an dem am ehesten noch
   gedreht wird. Jede Änderung dort bricht still das erste Wort des Textes. Ein erster Absatz
   muss für sich stehen, gerade in einem Paket, das zum Einstellen gedacht ist.

**Fix:** Die Prämisse in einem Halbsatz wiederholen, dann steht der Absatz allein:

> Dass die Pflicht noch nicht beschlossen ist, heisst nicht, dass heute nichts gilt:
> Diskriminieren darfst du schon jetzt nicht, und darauf kommen wir unten zurück. Vor allem
> aber lohnt sich das Anfangen jetzt, und zwar nicht aus Rechtsgründen: Die häufigsten
> Barrieren kosten dich heute Anmeldungen, und die billigste kostet einen unsichtbaren Namen
> im Code, kein Projekt.

Das ist eine Zeile Arbeit und der einzige Grund, warum die Datei zurückgeht. Alles andere
unten ist geprüft und in Ordnung.

## Deine zweite Stelle: der Lead

Richtig gelöst, und besser als mein Nit es verlangt hat. Der Titel stellt die Frage, der Lead
beantwortet sie, und «Der 1. Januar 2027, der überall steht, ist nirgends festgelegt» schreibt
die Jahreszahl einmal aus. Damit ist die Schlaufe sichtbar geschlossen, und der Post sagt
seine Botschaft, bevor irgendwer scrollt. Nicht antasten.

Eine Frage dazu, die Sven gehört und nicht mir: Der Lead hat 286 Zeichen und rendert in einer
schmalen Hero-Spalte neben dem Autorenblock (zwei von vier Unterspalten einer Vierspalte).
Ob dafür ein Zeichenbudget gilt, weiss er; in `seo.md` steht für dieses Feld keines. Falls
gekürzt werden muss, ist der erste Satz der verzichtbare, nicht der mit der Jahreszahl.

## Deine dritte Stelle: die Länge

Nein, ich sehe es nicht anders, und du hast meine Position korrekt wiedergegeben. 2346 Wörter
sind über dem, was ich als mittlere Länge durchgehen lasse, aber der Post ist so gebaut, dass
man nach dem Lead oder nach der Tabelle aufhören kann, und die Belegtiefe ist das, was ihn von
den Anbieterblogs unterscheidet. Kürzen würde ich nichts, und schon gar nicht «Wie wir es bei
uns halten», weil das der eigene Winkel aus dem Auftrag ist. Dass du nichts auf eigene Faust
gekürzt hast, war richtig.

## Die vier Nits aus meinem Nachtrag

| # | Nit | Status |
|---|---|---|
| 1 | FAQ 4: «WCAG 2.2 AA ist für die Schweiz falsch» | **geschlossen**, Fixtext übernommen und um «wer die Stufe freiwillig zusichert, sagt nichts Unwahres» ergänzt. Das ist die Unterscheidung, um die es ging. |
| 2 | FAQ 1 trennt Ob und Wie nicht | **geschlossen**: «Welche technische Norm dabei gilt, hängt davon ab, ob Bund oder Kanton.» |
| 3 | Titel stellt eine Frage, die offen bleibt | **geschlossen** über den Lead, siehe oben. |
| 4 | Änderungsvermerk nennt den alten Tabellennamen | **geschlossen**, neu geschrieben statt geflickt. |

## Was ich geprüft habe

* **Die Anker, endgültig.** Der Körper wird über `MdxContent` gerendert, und das Bauteil setzt
  `rehypePlugins: [rehypeSlug]`. Ich habe die zehn Überschriften mit dem `github-slugger` aus
  `node_modules` des Frontends durch dieselbe Funktion geschickt: Umlaute bleiben erhalten,
  Guillemets und Doppelpunkte fallen weg, und **alle zehn Anker des Inhaltsverzeichnisses
  treffen die tatsächlich erzeugten IDs**, inklusive `die-fünf-häufigsten-barrieren` und
  `warum-angemessen-im-gesetzesentwurf-ein-problem-ist`. Mein Punkt «Umlaut-Anker im CMS
  durchklicken» ist damit erledigt und gehört nicht mehr auf die Liste. Ein Blick nach dem
  Einstellen schadet nicht, nötig ist er nicht.
* **Die Feldwerte**, nachgezählt: `title` 47 Zeichen, `field_teaser_text` 157,
  `path` 37 Zeichen ohne Jahreszahl, `field_article_leadtext` 286.
* **Kein H1 im Körper**, und die Schnittmarken sind eindeutig (Zeile 75 «Alles ab hier …» bis
  zum `---` vor «Nicht Teil des Posts»). Wichtig beim Einstellen: genau dort schneiden, denn
  die Feld-Überschriften oberhalb sind H2 und stünden sonst im Post.
* **Zahlen und Rechtsbezüge gegen v2 einzeln gegengezählt**, neunzehn Stichproben, alle
  identisch: 95,9 / 83,9 / 53,1 / 16,2 / 66,6 / 10,8 / 51 / 33,1 / 46,3 / 30,6 Prozent,
  78 Prüfpunkte, 1 809 000 und 340 000, 5000 Franken, 17 zu 8, «100 Tagen seit», Artikel 3
  Buchstabe e, Artikel 8 Absatz 1, 25. Juni 2020.
* **Formal:** kein ß, null lange und null kurze Gedankenstriche, du-Form, keine Sie-Form,
  2346 Wörter im Postteil.
* **Die Sidebar-Zeilen** sind sauber: der Drupal-Beitrag steht dort mit Jahreszahl im Titel,
  und die Begründung, warum er im Fliesstext nicht verlinkt ist, steht dabei. Dass du den
  Ausweg «wer ihn auch dort nicht will, lässt die dritte Zeile weg» offen lässt, ist richtig.

## Für die Menschen

v3 ist das Paket zum Einstellen und nach dem einen Satz oben meine Empfehlung. v1 und v2
bleiben unangetastet und freigegeben; v3 ersetzt sie nicht formal, aber wer v3 nimmt, muss
sich um die drei offenen Nits in v1 nicht mehr kümmern.

Offen bleibt beim Einstellen nur noch:

1. **Stand-Datum am Publikationstag nachziehen.** Der Text nennt an drei Stellen den
   7. November 2026.
2. **Den Rücklink aus `/de/blog/barrierefreie-museums-website` setzen.** Svens Hebel für die
   neue URL, eine CMS-Änderung an einem bestehenden Node.
3. **Den `accessibility-audit` laufen lassen.** Letzter Lauf immer noch 17.9.2026. Der Post
   hat einen Abschnitt über genau diese Routine, und das ist seit meiner ersten Runde der
   einzige Punkt, den die Redaktion nicht im Text lösen kann.
4. **Die zwei Punkte bei Web**, die Sven gefunden hat (fehlender Nutzenpunkt Barrierefreiheit
   auf der Programmseite, zwei self-canonical Website-Check-Seiten).

Die zwei alten Entscheide bleiben offen und blockieren nichts: du-Form gegen Sie-Form, und
fünf Regeln statt der sieben Punkte aus der Fertig-wenn-Liste.
