# Review draft.md — Verdict: approved

> **Zweiter Nachtrag vom 7. November 2026, 16:30 (rita). Freigabe gilt weiter.** Nach Svens
> SEO-Durchgang hat Nora auch diese Fassung angefasst, weil der Fassungsentscheid noch offen
> ist. Drin sind Svens fünf Befunde (Suchphrase an zwei Stellen, Link auf
> `/de/programme/website-check`, interner Link auf den Museums-Post, FAQ-Block vor den
> Referenzen, die fünf Regeln als H3) und die CMS-Werte. Geprüft habe ich:
>
> * **Der H3-Umbau**, der hier eine echte Umformulierung an fünf Stellen war: Die
>   WCAG-Nummern standen im fetten Listentitel und stehen jetzt als erster Satz im Absatz
>   («WCAG 1.4.3 verlangt mindestens 4,5:1 für normalen Text. Verletzt auf 83,9 Prozent …»).
>   Inhaltlich unverändert, nachgezählt: 1.4.3 mit 4,5:1 und 83,9 Prozent bei 34 Einzelfällen,
>   1.1.1 mit 53,1 und 16,2 Prozent bei 66,6 und 10,8 Bildern, 1.3.1 und 3.3.2 mit 51 und
>   33,1 Prozent und 36 Prozent in drei Jahren, 2.4.4 und 4.1.2 mit 46,3 und 30,6 Prozent,
>   2.1.1 und 2.4.7. Keine Hierarchiesprünge, kein Absatz beginnt mit einer Klammer.
> * **Der FAQ-Block** ist derselbe wie in v2 und gegen den Gesetzeswortlaut und Curia Vista
>   geprüft. Zwei Nits dazu stehen in `review-v2.md`.
> * **Formal:** kein ß, null Gedankenstriche, du-Form, acht Anker treffen, achtzehn URLs
>   erreichbar, 2137 Wörter im Postteil.
>
> Offen bleiben in dieser Fassung die drei Nits aus `review-v2.md` vom 13:15-Stand:
> der Zwischentitel nennt weiter nur den Bund, obwohl der Absatz auch Kantone und Gemeinden
> behandelt; im Text steht der 7. November 2026, in zwei Referenzen der 6. November; und der
> Auslöser der 100-Tage-Frist fehlt hier noch. In `draft-v2.md` sind alle drei geschlossen.

> **Nachtrag vom 7. November 2026, 13:20 (rita).** `draft.md` wurde nach dieser Freigabe noch
> an zwei Stellen geändert, und die Freigabe gilt weiter. Grund: Beim Review von `draft-v2.md`
> habe ich zwei Fehler gefunden, die auch in dieser Fassung standen, und die ich in den Runden
> davor übersehen hatte. Erstens stand die Verbindlichkeit für Kantone und Gemeinden allein am
> kantonalen Recht, obwohl das BehiG Dienstleistungen des Gemeinwesens erfasst (Art. 3 lit. e)
> und Art. 8 Abs. 1 dort einen Beseitigungsanspruch gibt; am Kanton hängt die technische Norm,
> und er darf weiter gehen (Art. 4). Zweitens fehlte, dass Art. 6 BehiG Privaten, die
> Dienstleistungen öffentlich anbieten, die Diskriminierung schon heute verbietet, mit einer
> Entschädigung von höchstens 5000 Franken als Rechtsbehelf (Art. 8 Abs. 3, Art. 11 Abs. 2).
> Nora hat beides korrigiert, das BehiG in die Quellenliste aufgenommen und das Stand-Datum auf
> den 7. November 2026 gezogen. Ich habe die geänderten Stellen gegen den Gesetzeswortlaut
> geprüft, sie sind korrekt; der Rest der Datei ist unverändert. Details und drei kleine
> Restpunkte zu dieser Fassung stehen in `review-v2.md`. Die Befundtabelle unten bezieht sich
> auf den Stand vom 7. November 00:16 und bleibt als Protokoll stehen.

Alle sechzehn Befunde aus meiner ersten Runde sind geschlossen, keiner nur halb, und ich habe
jeden einzeln gegengeprüft statt die Meldung zu übernehmen. Der Vorbehalt, der bleibt, gehört
nicht in den Text, sondern in den Betrieb: der letzte `accessibility-audit` auf netnode.ch ist
vom 17.9.2026, und der Post spricht in einem Abschnitt über genau diese Routine — Nora hat den
Satz korrekt auf die Einrichtung gedreht, aber vor dem Publizieren sollte der Lauf einmal
stattfinden, damit der Abschnitt nicht nur formal stimmt.

Zweite und letzte Runde von mir. Der Text geht an die Menschen.

## Die sechzehn Befunde

| # | Befund | Status | Wie geprüft |
|---|---|---|---|
| 1 | «Der Nationalrat ist eingetreten» | **geschlossen** | Z. 198-202: «Die zuständige Kommission des Nationalrats ist eingetreten», dazu das 17-zu-8 und «abgestimmt hat bis heute keine der beiden Kammern». Besser als mein Fixtext, weil die Gegenprobe gleich mitsteht. |
| 2 | «Verbindlich» über einem Abschnitt ohne Rechtsgrundlage | **geschlossen** | Z. 32-33 und Z. 53: neue Einleitung, Zwischentitel «Nicht verbindlich, aber teuer: Formulare, die nicht funktionieren», Reihenfolge erhalten. Noras Einleitungsvariante ist die richtige, siehe unten. |
| 3 | WebAIM-Bezugsgrösse bei den Alternativtexten | **geschlossen** | Z. 102-104 wörtlich wie vorgeschlagen, die 66,6 stehen zusätzlich in der Quellenliste (Z. 265). |
| 4 | Audit-Kadenz im Präsens | **geschlossen, mit Vorbehalt** | Z. 185-187 beschreibt die Einrichtung, Z. 191 ergänzt «eine Routine ist nur so gut wie ihr letzter Lauf», das «wöchentlich sehen» ist weg. Der Vorbehalt ist der Lauf selbst, nicht der Satz. |
| 5 | Konjunktiv im Rechtsabschnitt | **geschlossen** | Z. 145-150: «würde entscheiden», «gelten soll», «verlangt würde», «bekämen», «würde bedeuten». Mehr als die zwei Stellen, die ich gemeldet hatte. |
| 6 | 17-zu-8-Eintreten fehlte | **geschlossen** | Z. 67 in der Tabellenzeile und Z. 201 im Fazit. |
| 7 | «87 WCAG-Erfolgskriterien» ohne Version | **geschlossen** | Z. 83 «die 78 Erfolgskriterien der WCAG 2.1», Herleitung in Z. 256-259. Nachgezählt: w3.org/TR/WCAG21 listet unter «The following Success Criteria are new in WCAG 2.1» genau 17 Kriterien, 61 + 17 = 78, und 86 für 2.2 stimmt ebenfalls. |
| 8 | EAA-Sektoren lasen abschliessend | **geschlossen** | Z. 47-49 mit «unter anderem» und den audiovisuellen Mediendiensten. |
| 9 | BFS-Link führte ins Leere | **geschlossen, selbst nachgerechnet** | Siehe eigener Abschnitt unten. Die Tabelle trägt die Zahlen, und zwar genau die genannten. |
| 10 | admin.ch-Zitate nicht am verlinkten Ort | **geschlossen** | Z. 238-240 nennt Curia Vista 25.020 «Ausgangslage» als zweite, ohne Einschränkung abrufbare Quelle. |
| 11 | eCH-0059 «genehmigt am 25. Juni 2020» | **geschlossen** | Z. 246-247 «genehmigt am 4. Juni 2020 und publiziert am 25. Juni 2020». |
| 12 | «diese Woche» gegen «die nächsten Wochen» | **geschlossen** | Z. 17-18 und Z. 158 sagen beide «die nächsten Wochen». |
| 13 | Bund und Kantone vermischt | **geschlossen** | Z. 35 «wenn du für den Bund arbeitest», Z. 40-41 mit dem Halbsatz zum kantonalen Recht. |
| 14 | Meta-Title fragte nach dem falschen Objekt | **geschlossen** | «Wird Barrierefreiheit 2027 Pflicht? Der Stand zum BehiG», 55 Zeichen nachgezählt. |
| 15 | «etwa ein Drittel» ohne Quelle | **geschlossen** | Z. 134-135 «nach unserer Erfahrung … eine Zahl ohne amtliche Quelle» im Satz selbst. |
| 16 | Umlaut-Anker | **weitergegeben** | Im File nichts zu tun, der Punkt steht in der Übergabe an die Menschen und unten unter «Für den CMS-Schritt». |

Dazu zwei Abweichungen von meinen Vorschlägen, beide begründet und beide richtig:

* **Die Einleitungszeile des Abschnitts.** Nora schreibt «Zwei Dinge sind heute verbindlich,
  eines zählt auch ohne Gesetz, und eines ist noch gar nicht beschlossen. In dieser
  Reihenfolge:» statt meiner Version. Ihre ist besser: die Aufzählung folgt damit der
  tatsächlichen Abschnittsfolge, und der Leser weiss nach dem ersten Satz, wie viele Teile
  kommen. Nachgezählt stimmt die Reihenfolge (Bund, EU, Formulare, Pflicht für Private).
* **Der Siebener-Weg ist nicht genommen,** mit der Begründung, dass sieben Entscheide weniger
  handlungsfähig sind als fünf und das Feedback des Menschen vom 6.11. genau die
  Handlungsfähigkeit verlangt. Das überzeugt mich; mein Vorschlag war eine Möglichkeit, das
  Kästchen zu schliessen, kein Qualitätsargument. Der Punkt bleibt als Entscheid bei den
  Menschen, siehe unten.

## Die BFS-Zahlen, selbst nachgerechnet

Mein Nit 9 war der einzige, bei dem ich die Korrektur nicht nur lesen, sondern nachrechnen
wollte, weil die alte Quelle ins Leere führte. Ich habe die Tabelle von
`statistik.admin.ch/de/asset/36217371` heruntergeladen und Blatt 2023 geöffnet. Was dort steht:

* Blatt-Titel: «Geschätzte Anzahl der Menschen mit Behinderungen, nach Geschlecht und Alter» —
  genau so, wie der Entwurf sie zitiert.
* Zeile «Bevölkerung 15 Jahre und mehr»: 1 809 000 (± 60 000), davon 1 469 000 schwach
  (± 55 000) und 340 000 stark eingeschränkt (± 28 000). Alle vier Werte stimmen auf die Zahl.
* Fussnote 2: die ± sind die «Grenzen des 95%-Vertrauensintervalls».
* Quellenzeile: «BFS – Erhebung über die Einkommen und die Lebensbedingungen (SILC) und
  Statistik der sozialmedizinischen Institutionen (SOMED)» — der Entwurf verwendet den
  amtlichen Namen jetzt korrekt, vorher stand dort «Erhebung über Einkommen und
  Lebensbedingungen».

Ein Detail, das ich ausdrücklich festhalte, damit es später niemand «korrigiert»: Die
Zeilenbeschriftung sagt «15 Jahre und mehr», Fussnote 1 sagt «etwa 18 000 Personen, 16 Jahre
und älter, die in einem Privathaushalt leben». Für die SILC-Spalten gilt die Fussnote, und der
Entwurf schreibt deshalb richtig «ab 16 Jahren in Privathaushalten». Wer das auf 15 ändert,
macht es falsch.

Dass die «rund 22 Prozent» ganz heraus sind, ist die saubere Lösung. Die absoluten Zahlen
tragen das Argument, und der Prozentwert hätte mit einem gleich aussehenden Wert aus einer
anderen Erhebung verwechselt werden können.

## Formale Endkontrolle, nachgezählt und nicht übernommen

* kein ß, null lange und null kurze Gedankenstriche, du-Form durchgehend, keine Sie-Form
* 1766 Wörter im Postteil (plus 115 gegenüber der zweiten Runde)
* alle sieben Anker des Inhaltsverzeichnisses treffen eine Überschrift
* Meta-Title 55 Zeichen, Meta-Description 152 Zeichen
* alle fünfzehn URLs im Entwurf aufgerufen: dreizehn direkt mit 200; ech.ch leitet mit 302 auf
  `/ech-0059/3.0` und ist damit sogar genauer; admin.ch gibt einfachen Clients weiterhin 403,
  was in der Referenz jetzt offen dasteht und über Curia Vista aufgelöst ist. Diesmal habe ich
  bei jedem Link auch das Ziel nach den Redirects geprüft, nicht nur den Statuscode — das war
  die Lehre aus Nit 9.
* `factcheck.md` ist auf dem Stand der dritten Runde, und Punkt 6 nennt die seit sieben Wochen
  ausstehende Audit-Routine als eigenen Hinweis für die Menschen. Genau dort gehört er hin.

## Was stimmt und nicht angetastet werden darf

Die Liste aus meiner ersten Runde gilt unverändert; Nora hat an diesen Stellen nichts
geglättet, und ich habe es nachgeprüft:

* **Der Aufhänger hält.** Curia Vista 25.020 über die OData-API, erneut abgefragt am
  7.11.2026: Botschaft 20.12.2024, Erstrat Nationalrat, Status «In Kommission des
  Nationalrats», Statusdatum 11.3.2025, kein Inkrafttretensdatum in irgendeinem Feld. Der
  Status hat sich seit Noras Abfrage nicht verändert.
* Die beiden Kommissionsdaten stehen wörtlich so in Curia Vista, inklusive des 17-zu-8.
* eCH-0059 V3.0 stützt sich auf WCAG 2.1 AA, es gibt keine Version mit 2.2.
* Die beiden Bundesratszitate sind wörtlich belegt.
* Die Einschränkung des EAA auf die aufgezählten Sektoren und die Absage an «wer in die EU
  verkauft, muss».
* Regel 5 (Tastatur und Fokus) mit der Begründung, dass kein automatischer Test sie messen
  kann.
* Die Offenlegung, dass unsere eigenen Seiten nicht bei 100 Punkten stehen, und der Schlusssatz
  «Wenn dabei herauskommt, dass deine Seite besser ist als unsere, sagen wir es dir auch».

## Für den CMS-Schritt

1. **Die Umlaut-Anker.** Das Inhaltsverzeichnis verweist auf `#fünf-regeln-…`,
   `#was-angemessene-vorkehrungen-offen-lässt` und `#vier-entscheide-für-die-nächsten-wochen`.
   Gegen die Überschriften stimmen alle sieben, aber NodeHive kann beim Erzeugen der IDs
   transliterieren (`fuenf-`, `laesst`, `fuer`). Nach dem Einstellen einmal durchklicken.
2. **Das Stand-Datum.** Der Post schreibt «Der Stand der Beratung am 6. November 2026» und die
   Referenzen «abgefragt am 6. November 2026». Ich habe den Status am 7.11.2026 erneut geprüft,
   er ist unverändert — aber dieser Post lebt von einem Datumsstempel. Am Publikationstag
   einmal nachziehen, das ist eine Abfrage und zwei Zeilen.
3. **Der Audit-Lauf.** Der Abschnitt «Warum wir den Audit als Gate fahren» ist jetzt korrekt
   formuliert, aber die Routine steht seit dem 17.9.2026 aus. Ein Lauf vor dem Publizieren
   macht den Abschnitt wahr und nicht nur richtig.

## Zwei Entscheide, die bei euch liegen

Beide stehen schon aus der ersten Runde offen, keiner blockiert den Text:

* **du-Form gegen Sie-Form.** task.md verlangt du-Form, die bestehenden Posts auf netnode.ch
  verwenden Sie-Form (im Katalog gegengelesen: «So messen Sie die Qualität Ihrer KI-Agenten»,
  «So fangen Sie an»). Nora hat task.md befolgt und den Konflikt gemeldet. Ein Wechsel ist eine
  halbe Stunde, aber es ist ein Markenentscheid.
* **Fünf Regeln statt sieben Punkte.** Das Kästchen «Checkliste mit sieben Punkten» in der
  Fertig-wenn-Liste bleibt formal offen, weil euer Feedback vom 6.11. fünf WCAG-Regeln verlangt
  hat. Ich halte den Weg für richtig und die Belegbasis für härter als unsere acht Seiten. Falls
  die Sieben doch gewünscht ist: die sechste WebAIM-Fehlerart (fehlende Dokumentsprache,
  13,5 Prozent) steht in der Quellenliste, mit Tastatur und Fokus als siebtem Punkt wären es
  sieben ohne jede Erfindung. Ein Satz Arbeit.

Dazu als Randnotiz: 1766 Wörter sind am oberen Rand von «mittlere Länge». Gewachsen ist der
Text durch meine Korrekturen, die präziser und nicht kürzer sind. Ich würde nichts kürzen,
aber ihr sollt es wissen.
