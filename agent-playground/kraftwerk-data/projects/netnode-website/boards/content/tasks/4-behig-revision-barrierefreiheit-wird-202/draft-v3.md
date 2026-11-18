# draft v3: fertig zum Einstellen

Diese Datei ist die Fassung, die ins CMS geht. Sie baut auf `draft-v2.md`
(von Rita freigegeben, von Sven SEO-geprüft) und löst die vier Nits aus
Ritas Nachtrag vom 7. November 2026. Jeder Abschnitt unten entspricht einem Feld
in NodeHive; die Feldnamen stehen aus `seo.md`. Der Textkörper beginnt
absichtlich ohne `#`-Zeile: Der Node-Titel ist auf netnode.ch gleichzeitig die
H1, eine zweite H1 im Körper stünde doppelt auf der Seite.

---

## Feld `title` (= Meta-Title = H1)

```
Barrierefreie Website Schweiz: Pflicht ab 2027?
```

47 Zeichen. Das Frontend hängt « | NETNODE AG» an, im Suchergebnis sind es 60.

## Feld `field_teaser_text` (= Meta-Description, Listenteaser, RSS)

```
Barrierefreie Website in der Schweiz: Für Bund und EU-Verkauf gilt die Pflicht heute, für private Anbieter nicht. Prüfe in der Tabelle, ob du betroffen bist.
```

157 Zeichen.

## Feld `field_article_leadtext` (sichtbarer Lead über dem Bild)

```
Wenn du für Bund, Kanton oder Gemeinde arbeitest oder in der EU an Konsumenten verkaufst, musst du schon heute. Für private Anbieter in der Schweiz ist die Barrierefreiheits-Pflicht in Vorbereitung, aber nicht beschlossen: Der 1. Januar 2027, der überall steht, ist nirgends festgelegt.
```

Der Titel stellt eine Frage, dieser Lead beantwortet sie, und die Jahreszahl aus
dem Titel kommt einmal ausgeschrieben vor. Damit schliesst sich die Schlaufe
sichtbar, wie Rita es in ihrem Nit 3 vorgeschlagen hat.

## Feld `path` (Slug)

```
barrierefreie-website-schweiz-pflicht
```

Volle URL: `https://netnode.ch/de/blog/barrierefreie-website-schweiz-pflicht`.
Keine Jahreszahl im Slug, damit der Post ohne Redirect gültig bleibt, wenn das
Parlament erst 2028 entscheidet.

## Feld `field_teaser_image`

Datei: `barrierefreie-website-schweiz-behig-2027.jpg`
Alt-Text am Medium, an das tatsächliche Bild anpassen, weil er das Bild
beschreibt und nicht den Post:
`Tastatur-Fokusrahmen auf einem Webformular, daneben der Kontrastwert des Textes`

`og:image` ist nichts zu liefern, das Frontend macht daraus automatisch einen
Screenshot der Seite.

## Feld `field_article_links` (Sidebar)

| Titel | URL |
| --- | --- |
| Website Check: unabhängige Analyse deiner Website | https://netnode.ch/de/programme/website-check |
| Barrierefreie und mehrsprachige Museums-Website | https://netnode.ch/de/blog/barrierefreie-museums-website |
| Fünf Eigenschaften, die Drupal barrierefreier machen (2016) | https://netnode.ch/de/blog/drupal-barrierefrei |

Der Drupal-Beitrag ist von 2016 und beschreibt Drupal 8 und WCAG 2.0. Im
Fliesstext ist er deshalb bewusst nicht verlinkt; in der Sidebar steht die
Jahreszahl daneben, und damit ist er unbedenklich. Wer ihn auch dort nicht will,
lässt die dritte Zeile weg.

---

## Feld `field_markdown` (Textkörper)

Alles ab hier bis zum Schlussstrich kommt in den Körper.

Dass die Pflicht noch nicht beschlossen ist, heisst nicht, dass heute nichts
gilt: Diskriminieren darfst du schon jetzt nicht, und darauf kommen wir unten
zurück. Vor allem aber lohnt sich das Anfangen jetzt, und zwar nicht aus
Rechtsgründen: Die häufigsten Barrieren kosten dich heute Anmeldungen, und die
billigste kostet einen unsichtbaren Namen im Code, kein Projekt.

## Inhalt

- [Worum es geht, in drei Beispielen](#worum-es-geht-in-drei-beispielen)
- [Barrierefreie Website in der Schweiz: Gilt die Pflicht für dich?](#barrierefreie-website-in-der-schweiz-gilt-die-pflicht-für-dich)
- [Woher die Jahreszahl 2027 kommt](#woher-die-jahreszahl-2027-kommt)
- [Die fünf häufigsten Barrieren](#die-fünf-häufigsten-barrieren)
- [Warum «angemessen» im Gesetzesentwurf ein Problem ist](#warum-angemessen-im-gesetzesentwurf-ein-problem-ist)
- [Was du als Erstes tust](#was-du-als-erstes-tust)
- [Wie wir es bei uns halten](#wie-wir-es-bei-uns-halten)
- [Die Botschaft in einem Satz](#die-botschaft-in-einem-satz)
- [Häufige Fragen](#häufige-fragen)
- [Referenzen](#referenzen)

## Worum es geht, in drei Beispielen

Barrierefreiheit klingt nach einer technischen Spezialdisziplin. Im Alltag sind
es drei Situationen, die du selbst nachstellen kannst:

**Jemand bedient deine Website ohne Maus.** Wer die Hände nicht ruhig halten kann
oder nichts sieht, springt mit der Tabulatortaste von Feld zu Feld. Probiere es
auf deiner eigenen Startseite: Taste drücken und schauen, ob du erkennst, wo du
gerade bist, und ob du bis zum Absenden eines Formulars kommst. Bei vielen Seiten
endet der Weg im Cookie-Hinweis.

**Jemand lässt sich deine Website vorlesen.** Blinde Nutzende verwenden ein
Programm, das den Bildschirm vorliest, einen Screenreader. Es liest, was im Code
steht: Eine Schaltfläche mit nur einem Symbol wird zu «Link», ein Formularfeld
ohne hinterlegte Beschriftung zu «Eingabefeld». Dann bleibt nur Raten.

**Jemand sieht schlecht.** Hellgrauer Text auf weissem Grund ist eine
Designentscheidung. Für Augen, die nachlassen, ist sie eine Barriere, und es
braucht dafür keine Behinderung: Es reicht Sonnenlicht auf dem Handy.

Wie viele Menschen das betrifft, ist gezählt: Nach der Erhebung über die
Einkommen und die Lebensbedingungen 2023 leben in der Schweiz 1 809 000 Menschen
mit einer Behinderung, davon 340 000 mit starken Einschränkungen, gerechnet unter
den Personen ab 16 Jahren in Privathaushalten. Wie das in einem echten Projekt
aussieht, haben wir dort aufgeschrieben, wo die Anforderungen besonders hoch
sind: [was eine barrierefreie Museums-Website
ausmacht](https://netnode.ch/de/blog/barrierefreie-museums-website).

## Barrierefreie Website in der Schweiz: Gilt die Pflicht für dich?

| Deine Situation | Gilt für dich? |
| --- | --- |
| Du arbeitest für den Bund oder lieferst ihm Websites | Ja, heute schon |
| Du bist ein Kanton, eine Gemeinde oder arbeitest für sie | Dem Grundsatz nach ja, schon nach Bundesrecht. Welche technische Norm gilt, hängt vom Kanton ab |
| Du verkaufst Konsumenten in der EU, etwa über einen Onlineshop | Ja, seit dem 28. Juni 2025, in bestimmten Branchen |
| Du bist ein Verband, eine Institution, ein Unternehmen in der Schweiz | Eine Barrierefreiheits-Pflicht gibt es in der Schweiz noch nicht. Diskriminieren darfst du aber schon heute nicht |

Ob eine barrierefreie Website in der Schweiz Pflicht ist, hängt davon ab, für wen
du sie betreibst.

**Für Bund, Kantone und Gemeinden** gilt das Behindertengleichstellungsgesetz,
kurz BehiG, seit Jahren. Es erfasst ausdrücklich Dienstleistungen des
Gemeinwesens (Artikel 3 Buchstabe e), und wer eine solche Dienstleistung nur
unter erschwerenden Bedingungen nutzen kann, hat Anspruch darauf, dass die
Benachteiligung beseitigt wird (Artikel 8 Absatz 1). Das Ob steht also im
Bundesrecht.

Am Kanton hängt das Wie, nämlich welche technische Norm verbindlich ist. Für den
Bund legt das der Bundesrat fest; dafür gibt es den Standard eCH-0059, der auf
die internationale Messlatte für Barrierefreiheit verweist, die WCAG, und zwar
auf die Fassung 2.1 in der mittleren Stufe AA. Wichtig, falls du Angebote
schreibst: nicht auf die neuere Fassung 2.2, das steht auf vielen Anbieterseiten
falsch. Ein Kanton kann eigene Regeln haben und darf weiter gehen als der Bund
(Artikel 4 BehiG).

**Für den EU-Markt** gilt seit dem 28. Juni 2025 der European Accessibility Act,
und zwar nicht nach deinem Sitz, sondern nach deinem Markt: wenn du in der EU
verkaufst, und auch dann nur in bestimmten Branchen wie Onlinehandel, Banken für
Privatkunden, Personenverkehr, E-Books, Telekommunikation und audiovisuelle
Mediendienste. Für eine Website, die nur über dich informiert, gilt er nicht, und
die Behauptung «wer in die EU verkauft, muss», ist zu weit gefasst.

**Für private Anbieter in der Schweiz** gibt es heute keine Pflicht, eine Website
auf eine bestimmte Stufe zu bringen. Was es heute gibt, ist Artikel 6 BehiG:
«Private, die Dienstleistungen öffentlich anbieten, dürfen Behinderte nicht auf
Grund ihrer Behinderung diskriminieren.» Der Rechtsbehelf dazu ist allerdings
schwach: Wer diskriminiert wird, kann eine Entschädigung verlangen, höchstens
5000 Franken (Artikel 8 Absatz 3 und Artikel 11 Absatz 2), aber keine Beseitigung
der Barriere. Genau diese Lücke würde der Gesetzesentwurf schliessen. Und damit
zur Jahreszahl.

## Woher die Jahreszahl 2027 kommt

Wenn du zu dem Thema gesucht hast, hast du den 1. Januar 2027 gelesen, auf
Anbieterseiten, in Anwaltsblogs und in Checklisten, die dir ein Prüfwerkzeug
verkaufen wollen. Wir haben nachgeprüft, beim Parlament und beim zuständigen
Bundesamt: Die Zahl steht in keiner amtlichen Quelle. Der Stand in normalen
Worten:

- Der Bundesrat hat im **Dezember 2024** einen Gesetzesentwurf ans Parlament
  geschickt. Er würde die Pflicht auf Dienstleistungen ausweiten, die von
  Privaten angeboten werden.
- Im **März 2025** hat die zuständige Kommission des Nationalrats entschieden,
  den Entwurf überhaupt zu beraten. Das ist der erste von vielen Schritten, keine
  Zustimmung zum Inhalt.
- Im **April 2026** hat dieselbe Kommission beschlossen, die Massnahmen mit einem
  grösseren Paket zusammenzulegen, und der Verwaltung ein Dutzend Fragen zur
  Klärung mitgegeben. Die Zusammenlegung beschloss sie einstimmig. Dass sie das
  grössere Paket überhaupt berät, war dagegen umstritten: Dieser Schritt ging nur
  mit 17 zu 8 Stimmen durch.
- **Heute**, Stand 7. November 2026, liegt der Entwurf weiterhin in dieser
  Kommission. Keine der beiden Kammern des Parlaments hat je darüber abgestimmt.

Und was danach noch kommt: Nach einem Ja in beiden Kammern folgt die
Schlussabstimmung, danach können 50 000 Stimmberechtigte oder acht Kantone
innerhalb von 100 Tagen seit der amtlichen Veröffentlichung des Gesetzes eine
Volksabstimmung verlangen, und erst dann kann der Bundesrat es in Kraft setzen.
Für den 1. Januar 2027 reicht das nicht mehr.

Inhaltlich würde der Entwurf Arbeitgeber und Dienstleister verpflichten,
«angemessene Vorkehrungen» zu treffen, und der Bundesrat nennt als Beispiel
ausdrücklich «einen besseren Zugang zu Online-Diensten». Von digitalen Formularen
spricht die Vorlage nicht, obwohl man das überall liest.

Für dich heisst das nicht «entwarnt». Ein Termin wäre ein Grund zu warten. Ohne
Termin entscheidest du selbst, wann du anfängst.

## Die fünf häufigsten Barrieren

Die Messlatte WCAG hat in der Fassung 2.1 genau 78 Prüfpunkte. Über 78 Punkte
entscheidet niemand, du musst über eine Handvoll entscheiden. Welche, sagen die
Zahlen: Die Organisation WebAIM prüft jedes Jahr die Startseiten der eine Million
grössten Websites, und im Bericht vom Februar 2026 hatten 95,9 Prozent davon
mindestens einen maschinell erkennbaren Fehler, im Schnitt 56 pro Seite. Sechs
Fehlerarten machen zusammen 96 Prozent aller Fehler aus. Das sind die fünf, die
zählen, jede mit den zwei Angaben, die du für einen Entscheid brauchst: wer sie
behebt und was sie kostet.

### 1. Text, der zu hell ist

Auf 83,9 Prozent der geprüften Startseiten, im
Schnitt 34 Stellen pro Seite. Die häufigste Barriere im Netz, mit Abstand.
*Wer:* Marke und Design, nicht die Technik. Eine zu helle Hausfarbe ist ein
Entscheid der Geschäftsleitung und kein Auftrag an die Agentur.
*Aufwand:* eine Sitzung für den Entscheid, danach ein Durchgang über die
Seitenvorlagen.

### 2. Bilder ohne Beschreibung

Auf 53,1 Prozent der Startseiten. 16,2 Prozent
aller Bilder haben keine hinterlegte Beschreibung: bei durchschnittlich 66,6
Bildern pro Startseite sind das rund 10,8 Bilder pro Seite, die vorgelesen
einfach fehlen.
*Wer:* die Redaktion, bei jedem neuen Beitrag, direkt im Redaktionssystem. Der
einzige Punkt dieser Liste, der dauerhaft im Marketing liegt.
*Aufwand:* keine Programmierung. Eine Regel im Redaktionsablauf und ein
Pflichtfeld im System.

### 3. Formularfelder ohne Beschriftung

Auf 51 Prozent der Startseiten, und ein
Drittel aller Formularfelder ist betroffen. Die Zahl der Felder pro Seite ist in
drei Jahren um 36 Prozent gestiegen.
*Wer:* die Technik, zusammen mit der Abteilung, die das Formular verantwortet.
*Aufwand:* pro Formular klein, in der Summe der Punkt, der am meisten bringt.
Hier entstehen Anmeldungen, Mitgliedschaften und Spenden.

### 4. Links und Schaltflächen ohne Text

Leere Links auf 46,3 Prozent, leere
Schaltflächen auf 30,6 Prozent der Startseiten. Typisch ist ein Symbol ohne
Beschriftung, etwa das Logo oben links oder die Lupe der Suche. Vorgelesen wird
daraus «Link» und sonst nichts.
*Wer:* die Technik.
*Aufwand:* der günstigste Punkt der Liste, ein unsichtbarer Name im Code pro
Element.

### 5. Bedienbarkeit ohne Maus

In den Zahlen oben fehlt dieser Punkt, und zwar
nicht, weil er selten ist, sondern weil kein Prüfwerkzeug ihn beantworten kann.
Ob man mit der Tastatur in sinnvoller Reihenfolge durch die Seite kommt,
jederzeit sieht, wo man steht, und aus einem aufgeklappten Menü wieder
herausfindet, muss ein Mensch von Hand prüfen.
*Wer:* die Technik, nach einer Prüfung von Hand.
*Aufwand:* die Prüfung kostet rund einen halben Tag. Die Behebung reicht von
einer Zeile im Stylesheet bis zu einem neu gebauten Menü.

Ein Satz, damit die Liste nicht mehr verspricht, als sie kann: Prüfwerkzeuge
finden nach unserer Erfahrung etwa ein Drittel der Probleme, eine Zahl ohne
amtliche Quelle. Dieses Drittel finden sie zuverlässig und billig, und es enthält
die Punkte 1 bis 4. Für Punkt 5 braucht es Hände, eine Tastatur und einen
Screenreader. Wer nur ein Werkzeug laufen lässt und das Ergebnis «grün» nennt,
hat zwei Drittel nicht angeschaut.

## Warum «angemessen» im Gesetzesentwurf ein Problem ist

Den unangenehmen Teil sagen wir lieber selbst, als dass du ihn in zwei Jahren von
einem Anwalt hörst. «Angemessen» heisst, dass Aufwand und Nutzen in einem
Verhältnis stehen müssen, und wo dieses Verhältnis kippt, würde am Ende ein
Gericht oder eine Verordnung entscheiden. Welche technische Norm gelten soll,
welche Stufe verlangt würde und ob bestehende Inhalte eine Übergangsfrist
bekämen, ist in der Kommunikation des Bundesrates zur Vorlage nicht beantwortet.
Für einen Verband mit fünf Angestellten würde angemessen etwas anderes bedeuten
als für eine Krankenkasse.

Neu ist dieser unbestimmte Begriff übrigens nicht: Schon heute ordnet ein Gericht
die Beseitigung einer Benachteiligung nicht an, wenn der Nutzen in einem
Missverhältnis zum wirtschaftlichen Aufwand steht (Artikel 11 Absatz 1 BehiG).
Neu wäre nur, auf wen er angewendet wird.

Eine Vorgabe lässt sich daraus heute nicht ableiten. Ein Verhalten schon: Wer
belegen kann, dass er den Stand seiner Website kennt und die gefundenen Barrieren
nachweisbar abgearbeitet hat, steht in jeder Auslegung von «angemessen» besser da
als jemand, der nie gemessen hat. Dokumentierte Arbeit ist die Vorkehrung. Eine
Jahreszahl im Protokoll ist keine.

## Was du als Erstes tust

Vier Schritte, keiner davon braucht das Parlament.

**1. Messen, bevor du budgetierst.** Eine Prüfung über die zehn wichtigsten
Seiten und über jedes Formular. Heraus kommt eine Liste nach Aufwand und Wirkung,
und damit eine Zahl, die du im Budget vertreten kannst. Ohne diese Messung ist
jede Offerte zu Barrierefreiheit geraten, auch unsere.

**2. Über die Hausfarbe entscheiden.** Wenn euer Blau oder Grau zu hell ist, ist
das die einzige Frage dieser Liste, die niemand für dich lösen kann. Entscheide
sie, statt sie als Auftrag weiterzugeben, wo sie liegen bleibt.

**3. Formulare vor Imageseiten.** Fang dort an, wo etwas passiert: Anmeldung,
Mitgliedschaft, Kontakt, Spende. Das ist gleichzeitig der Bereich, auf den der
Gesetzesentwurf zielt, und der, in dem eine Barriere direkt Geld kostet.

**4. Die Prüfung in den Ablauf hängen, nicht ans Projektende.** Eine Prüfung am
Schluss erzeugt eine Liste, die beim nächsten Umbau wieder länger ist. Das ist
eine Frage des Ablaufs und nicht des Budgets, und so halten wir es selbst.

## Wie wir es bei uns halten

Für netnode.ch gilt eine Regel aus dem eigenen Projektauftrag: keine
Veröffentlichung auf der produktiven Website ohne bestandene
Barrierefreiheits-Prüfung. Die Prüfung ist so eingerichtet, dass sie vor jeder
Veröffentlichung läuft und sonst wöchentlich, und sie schreibt Befunde und
Korrekturen in einen Bericht.

Das erzeugt Nichtereignisse: Der Fehler kommt nie auf die produktive Website,
weil die Veröffentlichung nicht durchgeht. Damit das nicht nach Erfolgsmeldung
klingt: Unsere eigenen Seiten stehen nicht bei der vollen Punktzahl, und eine
Routine ist nur so gut wie ihr letzter Lauf. Der Unterschied ist, dass wir unsere
Zahl kennen und eine Verschlechterung sehen, bevor sie jemand von aussen sieht.

## Die Botschaft in einem Satz

Warte nicht auf das Gesetz, sondern lass einmal messen, wo deine Website steht,
und behebe zuerst das Billige.

Die Pflicht für private Anbieter ist nicht beschlossen, und der 1. Januar 2027
steht in keiner amtlichen Quelle. Dass die Anforderung kommt, ist trotzdem
absehbar, weil der Entwurf in einem grösseren Paket weiterlebt und das EU-Recht
in dieselbe Richtung geht. Und die halbe Arbeit ist ohnehin fällig, weil sie dich
heute Kunden kostet. Der erste Schritt ist der langweiligste und der
nützlichste: einmal messen. Genau das macht unser Programm
[Website Check](https://netnode.ch/de/programme/website-check),
Barrierefreiheit eingeschlossen, mit einer Liste nach Aufwand und Wirkung. Wenn
dabei herauskommt, dass deine Website besser ist als unsere, sagen wir es dir
auch.

## Häufige Fragen

**Ist eine barrierefreie Website in der Schweiz Pflicht?**
Für Dienstleistungen des Gemeinwesens ja: Das Behindertengleichstellungsgesetz
(BehiG, SR 151.3) erfasst sie in Artikel 3 Buchstabe e, und Artikel 8 Absatz 1
gibt einen Anspruch auf Beseitigung der Benachteiligung. Welche technische Norm
dabei gilt, hängt davon ab, ob Bund oder Kanton. Für private Anbieter in
der Schweiz gibt es, Stand 7. November 2026, keine Pflicht zu einer bestimmten
Stufe, sondern nur das Diskriminierungsverbot in Artikel 6 BehiG.

**Kommt die Barrierefreiheits-Pflicht am 1. Januar 2027?**
Nein, dieses Datum steht in keiner amtlichen Quelle. Die BehiG-Revision
(Geschäft 25.020) liegt am 7. November 2026 in der Kommission des Nationalrats,
keine der beiden Kammern hat darüber abgestimmt, und ein Inkrafttretensdatum ist
nirgends festgelegt.

**Gilt das BehiG auch für private Unternehmen?**
Ja, aber anders als für das Gemeinwesen: Nach Artikel 6 BehiG dürfen Private, die
Dienstleistungen öffentlich anbieten, Menschen mit Behinderungen nicht
diskriminieren. Der Rechtsbehelf ist eine Entschädigung von höchstens
5000 Franken (Artikel 8 Absatz 3 und Artikel 11 Absatz 2), nicht die Beseitigung
der Barriere.

**Gilt in der Schweiz WCAG 2.1 oder WCAG 2.2?**
Verbindlich für den Bund ist WCAG 2.1 Stufe AA, über den Standard eCH-0059
Version 3.0 vom 25. Juni 2020. WCAG 2.2 ist die neuere Fassung des
WCAG-Standards, in eCH-0059 aber nicht referenziert. Die Behauptung, in der
Schweiz sei «WCAG 2.2 AA» verbindlich, ist deshalb falsch; wer die Stufe
freiwillig zusichert, sagt nichts Unwahres.

## Referenzen

**Was heute gilt (amtliche Quellen)**

- Behindertengleichstellungsgesetz (BehiG), SR 151.3, konsolidierte Fassung
  «Stand am 1. Juli 2020», selbst gelesen am 7. November 2026. Zitiert sind:
  Artikel 3 Buchstabe e (Geltungsbereich, «Dienstleistungen Privater … und des
  Gemeinwesens»), Artikel 4 (weitergehendes kantonales Recht bleibt möglich),
  Artikel 6 (Diskriminierungsverbot für Private, die Dienstleistungen öffentlich
  anbieten), Artikel 8 Absatz 1 (Beseitigungsanspruch bei Dienstleistungen),
  Artikel 8 Absatz 3 (Entschädigung), Artikel 11 Absatz 1
  (Verhältnismässigkeit) und Artikel 11 Absatz 2 (höchstens 5000 Franken):
  <https://www.fedlex.admin.ch/eli/cc/2003/667/de>, Volltext als PDF:
  <https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/2003/667/20200701/de/pdf-a/fedlex-data-admin-ch-eli-cc-2003-667-20200701-de-pdf-a.pdf>
- Artikel 14 Absatz 2 BehiG verpflichtet «die Behörden» für
  Internet-Dienstleistungen gegenüber Sehbehinderten und gibt dem Bundesrat die
  technischen Vorschriften. Er steht im 4. Abschnitt «Besondere Bestimmungen für
  den Bund»; für die Aussage zu Kantonen und Gemeinden ist er deshalb nicht
  herangezogen, dafür stehen Artikel 3 Buchstabe e und Artikel 8 Absatz 1.

**Stand der Beratung (amtliche Quellen)**

- Geschäft 25.020 «Behindertengleichstellungsgesetz. Änderung», Botschaft vom
  20. Dezember 2024, Erstrat Nationalrat, Status «In Kommission des
  Nationalrats». Curia Vista, Geschäftsdatenbank des Parlaments:
  <https://www.parlament.ch/de/ratsbetrieb/suche-curia-vista/geschaeft?AffairId=20250020>
  (abgefragt am 7. November 2026)
- Medienmitteilungen der Kommission für Wissenschaft, Bildung und Kultur des
  Nationalrats vom 28. März 2025 (Eintreten ohne Gegenstimme) und vom
  24. April 2026 (einstimmige Integration der BehiG-Massnahmen in den
  Gegenvorschlag, Eintreten auf den Gegenvorschlag mit 17 zu 8 Stimmen,
  Prüfaufträge an die Verwaltung), im Geschäft 25.020 unter «Verhandlungen»
- Geschäft 26.029 «Für die Gleichstellung von Menschen mit Behinderungen
  (Inklusions-Initiative)». Volksinitiative und indirekter Gegenvorschlag,
  Botschaft vom 25. Februar 2026, BBl 2026 715:
  <https://www.parlament.ch/de/ratsbetrieb/suche-curia-vista/geschaeft?AffairId=20260029>
- Vorschau Nationalrat, Herbstsession 2026, zu 26.029, Abschnitt «Parallele
  Behandlung des Behindertengleichstellungsgesetz im Parlament»:
  <https://www.parlament.ch/centers/documents/de/Vorschau%20NR%20HS%202026.pdf>
- Eidgenössisches Büro für die Gleichstellung von Menschen mit Behinderungen,
  «Teilrevision BehiG»: <https://www.ebgb.admin.ch/de/teilrevision-behig> und
  «Laufende Gesetzgebungsrevisionen»:
  <https://www.ebgb.admin.ch/de/laufende-gesetzgebungsrevisionen> (beide ohne
  Angabe eines Inkrafttretens, abgefragt am 7. November 2026)
- Medienmitteilung des Bundesrates vom 23. Dezember 2024, «Bundesrat
  verabschiedet Botschaft zur Teilrevision des BehiG», mit den Zitaten
  «angemessene Vorkehrungen» und «besserer Zugang zu Online-Diensten»:
  <https://www.admin.ch/de/nsb?id=103701>. Der Satz mit beiden Zitaten steht
  wörtlich auch in Curia Vista 25.020 im Feld «Ausgangslage», und dort ist er
  ohne Einschränkung abrufbar.
- Referendum: «Verlangen es 50 000 Stimmberechtigte oder acht Kantone innerhalb
  von 100 Tagen seit der amtlichen Veröffentlichung des Erlasses», Artikel 141
  Absatz 1 der Bundesverfassung:
  <https://www.fedlex.admin.ch/eli/cc/1999/404/de#art_141>. Die eli-Adresse
  braucht JavaScript; der Volltext liegt als PDF unter
  <https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/1999/404/20240101/de/pdf-a/fedlex-data-admin-ch-eli-cc-1999-404-20240101-de-pdf-a.pdf>

**Technische Norm und EU-Recht**

- eCH-0059 Accessibility-Standard, Version 3.0, genehmigt am 4. Juni 2020 und
  publiziert am 25. Juni 2020, Grundlage WCAG 2.1 Stufe AA:
  <https://www.ech.ch/de/ech/ech-0059>, dazu das Standarddokument:
  <https://ech.ch/sites/default/files/dosvers/hauptdokument/STAN_d_DEF_2020-05-19_eCH-0059_V3.0_Accessibility%20Standard.pdf>
- Richtlinie (EU) 2019/882 (European Accessibility Act), Anwendung auf
  Dienstleistungen ab 28. Juni 2025, Übergangsbestimmungen in Artikel 32, die
  erfassten Dienstleistungen in Artikel 2:
  <https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32019L0882>

**Zahlen**

- WCAG 2.1 mit 78 Prüfpunkten (Erfolgskriterien): 61 Kriterien der WCAG 2.0 plus
  die 17, die der Standard selbst als neu auflistet
  (<https://www.w3.org/TR/WCAG21/>). WCAG 2.2 kommt auf 86 und ist in eCH-0059
  nicht referenziert.
- WebAIM Million, Bericht vom Februar 2026, Auswertung von 1 000 000
  Startseiten: 95,9 Prozent mit erkannten WCAG-Fehlern, 56,1 Fehler pro Seite,
  Kontrast 83,9 Prozent bei 34 Stellen pro Seite, fehlende Alternativtexte
  53,1 Prozent, fehlende Formularbeschriftungen 51 Prozent und 33,1 Prozent der
  Felder, leere Links 46,3 Prozent, leere Buttons 30,6 Prozent, fehlende
  Dokumentsprache 13,5 Prozent, sechs Fehlerarten gleich 96 Prozent aller
  Fehler. Zu den Bildbeschreibungen: 66,6 Bilder pro Startseite, 16,2 Prozent
  davon ohne Alternativtext, im Schnitt 10,8 Bilder pro Seite:
  <https://webaim.org/projects/million/>
- Bundesamt für Statistik, Tabelle «Geschätzte Anzahl der Menschen mit
  Behinderungen, nach Geschlecht und Alter», Blatt 2023: 1 809 000 Menschen mit
  Behinderungen (Vertrauensintervall 60 000), davon 340 000 mit starken
  Einschränkungen (28 000). Grundlage ist die Erhebung über die Einkommen und die
  Lebensbedingungen (SILC) 2023, Personen ab 16 Jahren in Privathaushalten:
  <https://statistik.admin.ch/de/asset/36217371>, publiziert mit der
  Medienmitteilung vom 27. November 2025:
  <https://statistik.admin.ch/de/news/2025-0199>
- «Etwa ein Drittel der Probleme» für Prüfwerkzeuge: Erfahrungswert ohne
  amtliche Quelle, im Text als solcher gekennzeichnet; so auch in der Fixliste
  unseres eigenen Audit-Workflows
- Regel «keine Veröffentlichung ohne bestandene Barrierefreiheits-Prüfung» und
  die Kadenz «vor jeder Veröffentlichung, sonst wöchentlich»: Projektauftrag
  netnode.ch und die Betriebsroutinen des Projekts, intern

---

## Nicht Teil des Posts

**Was v3 gegenüber `draft-v2.md` ändert.** Nur vier Dinge, alle aus Ritas
Nachtrag vom 7. November 2026:

1. **Der Titel ist jetzt wirklich der Titel.** Svens Node-Titel ist auf
   netnode.ch gleichzeitig die H1, also die Schlagzeile des Posts. Die
   `#`-Überschrift von v2 («Muss deine Website barrierefrei sein? Der Stand in
   der Schweiz») ist damit weg, und der Körper beginnt mit dem ersten Absatz.
2. **Der Lead nennt die Jahreszahl ausgeschrieben** («Der 1. Januar 2027, der
   überall steht, ist nirgends festgelegt»), damit die Frage im Titel sichtbar
   beantwortet wird. Ritas Nit 3.
3. **FAQ 1** trennt das Ob vom Wie: «Welche technische Norm dabei gilt, hängt
   davon ab, ob Bund oder Kanton.» Ritas Nit 2.
4. **FAQ 4** sagt nicht mehr, die Angabe «WCAG 2.2 AA» sei falsch, sondern die
   Behauptung, sie sei in der Schweiz verbindlich. Wer die Stufe freiwillig
   zusichert, sagt nichts Unwahres. Ritas Nit 1.

Inhaltlich ist nichts anderes geändert, keine Zahl und kein Rechtsbezug. Die
Belege stehen in `factcheck.md`, die Prüfungen in `review.md`, `review-v2.md`
und `seo.md`.

**Zur Länge, weil sie der eine offene Streitpunkt war:** Der Körper hat rund
2400 Wörter. Sven hält das für unproblematisch, weil Posts zu Rechtsfragen lang
ranken; Rita hält es für über mittlerer Länge, empfiehlt aber, es in Kauf zu
nehmen, weil man nach dem Lead oder nach der Tabelle aufhören kann. Beide
Empfehlungen zeigen in dieselbe Richtung, deshalb ist in v3 nichts gekürzt. Wer
trotzdem kürzen will: «Wie wir es bei uns halten» sind rund 140 Wörter und
kosten den netnode-eigenen Winkel.

**Was beim Einstellen noch zu tun ist** (aus `review.md`, `review-v2.md` und
`seo.md`, nichts davon kann die Redaktion im Text lösen):

- Das Stand-Datum am Publikationstag nachziehen: «Heute, Stand 7. November 2026»
  im Abschnitt zur Jahreszahl und die Abfragedaten in den Referenzen. Für die
  Antwortmaschinen ist das sichtbare Datum im Text wertvoller als ein
  Metadatum, also bitte wirklich im Text.
- Den Link aus `/de/blog/barrierefreie-museums-website` auf diesen Post setzen,
  im Abschnitt «Rechtlicher Rahmen in der Schweiz», Ankertext etwa «ob die
  Pflicht auch für private Anbieter gilt». Das ist der stärkste interne
  Startschuss für die neue URL und eine Änderung an einem bestehenden Node.
- Den `accessibility-audit` auf netnode.ch einmal laufen lassen. Letzter Lauf ist
  der 17. September 2026, und der Post hat einen Abschnitt über genau diese
  Routine. Der Satz ist korrekt auf die Einrichtung gedreht, aber ein Lauf macht
  ihn wahr und nicht nur richtig.
- Offen bei Web, nicht im Post zu lösen: Auf `/de/programme/website-check` kommt
  das Wort Barrierefreiheit nicht vor, obwohl der Post «Barrierefreiheit
  eingeschlossen» verspricht. Besser wäre ein Nutzenpunkt auf der Programmseite.
  Der Halbsatz im Post bleibt, bis dagegen entschieden wird.
- Zwei Seiten zum Website Check (`/de/programme/website-check` und
  `/de/website-check`) sind beide self-canonical. Eigener Task für Web, verlinkt
  ist die Programmseite.
- Eine Frage an Sven, kein Blocker: Der Lead hat 286 Zeichen und rendert in einer
  schmalen Hero-Spalte neben dem Autorenblock. Ob für dieses Feld ein
  Zeichenbudget gilt, steht in `seo.md` nicht. Falls gekürzt werden muss, ist der
  erste Satz der verzichtbare und nicht der mit der Jahreszahl.

**Erledigt und nicht mehr auf der Liste:** Die Umlaut-Anker muss niemand im CMS
durchklicken. Rita hat den Körper über `MdxContent` nachverfolgt, das
`rehypeSlug` setzt, und die zehn Überschriften mit dem `github-slugger` aus den
`node_modules` des Frontends durch dieselbe Funktion geschickt: Umlaute bleiben
erhalten, Guillemets und Doppelpunkte fallen weg, alle zehn Anker treffen die
tatsächlich erzeugten IDs. Ein Blick nach dem Einstellen schadet nicht, nötig
ist er nicht.

**Beim Einstellen wichtig:** genau an den Schnittmarken schneiden, also von
«Alles ab hier bis zum Schlussstrich kommt in den Körper» bis zum `---` vor
«Nicht Teil des Posts». Die Feld-Überschriften oberhalb sind H2 und stünden
sonst im Post.

**Offen für die Menschen:** du-Form gegen Sie-Form (task.md verlangt du, die
bestehenden Posts verwenden Sie; ein Wechsel ist eine halbe Stunde), und fünf
Regeln statt der sieben Punkte aus der Fertig-wenn-Liste (das Feedback vom
6. November hat fünf verlangt, Rita und ich halten das für richtig).

Suchlogik, geschätzt und nicht aus dem Keyword Planner: «barrierefreie Website
Schweiz», «BehiG Pflicht», «muss meine Website barrierefrei sein»,
«Barrierefreiheit 2027 Schweiz», «WCAG 2.2 AA Schweiz», «eCH-0059».
