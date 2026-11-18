# Entwurf v2: Agentische Systeme, was sie sind und was sie bringen

Zweite Fassung, 7.11.2026, Nora. Sie schliesst Ritas drei Befunde B1, B2 und B3 aus
review.md sowie die Nits N1, N2 und N3. `draft.md` bleibt unangetastet daneben stehen.
Titel, `field_teaser_text` und Slug stehen hier absichtlich nicht: sie gehören Sven.

**Für den CMS-Schritt, eindeutig:** der Feldwert von `field_markdown` ist alles zwischen
der Zeile `<!-- field_markdown BEGINN -->` und der Zeile `<!-- field_markdown ENDE -->`,
die Kommentarzeilen selbst gehören nicht dazu. Der Körper trägt keine H1-Zeile, seine
Überschriften beginnen bei H2, weil auf netnode.ch der Node-Titel gleichzeitig `<title>`
und H1 ist.

Arbeitstitel aus task.md, nur zur Information: «Agentische Systeme: wenn Software nicht mehr
nur antwortet, sondern arbeitet» (76 Zeichen, also 29 über dem Budget von 47; die Kürzung
ist Svens Sache).

## field_article_leadtext (sichtbarer Lead, 309 Zeichen, 47 Wörter, unverändert gegenüber draft.md)

Ein Chatfenster antwortet dir. Ein agentisches System erledigt Arbeit: mehrere KI-Agenten
mit je einer Rolle, dazwischen Übergaben und Prüfschritte, und am Ende eine Spur, in der
steht, wer was getan hat. Drei Beispiele aus unserem eigenen Betrieb zeigen, was das
konkret heisst und wo der Mensch entscheidet.

## field_markdown (Körper, 1373 Wörter sichtbarer Text, 1399 mit Markdown-Linksyntax, 9484 Zeichen, keine H1-Zeile)

<!-- field_markdown BEGINN -->

Ein agentisches System ist Software, die eine Aufgabe nicht beantwortet, sondern erledigt, und
zwar nicht als ein grosser Alleskönner, sondern als mehrere Agenten mit Rollen, Übergaben und
Prüfschritten. Der Unterschied zum Chatfenster liegt nicht im Modell, sondern im Aufbau.

## Chatbot, Agent, agentisches System

Ein Chatbot wartet auf deine Frage und gibt eine Antwort; was danach passiert, machst du. Ein
Agent erledigt eine Aufgabe in echten Systemen: er liest Dateien, ruft eine Schnittstelle auf,
schreibt ein Resultat. Im agentischen System hat jeder Agent nur seine Rolle, zwischen ihnen
liegen Übergaben, und nach jedem Schritt sitzt eine Prüfung. Diese Prüfung ist kein zweites
Modell, sondern Code, der die Dateien liest, die der Agent wirklich geschrieben hat, und den
Ablauf anhält, wenn etwas fehlt. Solche Schritte nennen wir deterministisch: derselbe Input
ergibt dasselbe Resultat, weil Code entscheidet und nicht ein Modell.

Daraus folgt der Satz, der das Muster trägt: der Agent schlägt vor, der Code entscheidet. Und
weil jeder Schritt eine Datei und jede Übergabe eine Logzeile hinterlässt, kannst du hinterher
lesen, was passiert ist. Die Abgrenzung zwischen Assistent und Agent steht ausführlich in
[KI-Agent vs. KI-Assistent](https://netnode.ch/de/blog/ki-assistenten-vs-ki-agenten), die
Bauteile eines solchen Systems in
[Das Agentic Work System](https://netnode.ch/de/blog/agentic-work-system-bauplan).

## Woran du den Nutzen merkst

Wir messen den Nutzen nicht in Prozent und erfinden auch keine. Vier Dinge fallen auf.

### Durchlaufzeit

Der erste Schritt läuft, wenn die Aufgabe entsteht, und nicht erst, wenn jemand Zeit hat. Der
Mensch kommt an eine Vorlage statt an ein leeres Blatt.

### Gleichmässigkeit

Derselbe Prozess liefert dieselbe Form, unabhängig davon, wer dran ist.

### Nachvollziehbarkeit

Du kannst nachlesen, welcher Schritt was vorgeschlagen hat, welche Prüfung angeschlagen hat
und wer freigegeben hat.

### Entlastung von Routine

Lesen, Sortieren, Abgleichen und Vorformulieren wandern ins System. Was bleibt, ist der
Entscheid.

## Drei Beispiele aus unserem eigenen Betrieb

Die drei Systeme laufen bei netnode, und was hier steht, ist gegen ihre Definitionen im
Workspace gelesen.

### Helpdesk-Triage: der Agent schlägt vor, der Code entscheidet

**Vorher:** Jemand öffnet morgens die offenen Tickets, liest jedes samt Verlauf, setzt
Priorität und Kategorie und schreibt eine interne Notiz dazu. Je mehr über Nacht gekommen ist,
desto länger dauert es, und die Einordnung sieht je nach Person anders aus.

**Heute:** Ein Skript holt alle offenen Tickets samt Verlauf und legt die beiseite, die ein
früherer Lauf schon triagiert hat. Ein Agent liest die übrigen und schlägt pro Ticket eine
Priorität aus fünf erlaubten Werten vor, eine Kategorie von A bis D, eine
Begründung und zwei Textbausteine. Dann prüft ein Skript die Vorschläge gegen Regeln: Ist die
Kategorie eine der vier? Fehlt eine Begründung, ein Ticket, ein Textbaustein? Erst wenn alles
passt, setzt ein zweites Skript die Priorität, hängt die Notizen an, ruft das Ticket neu ab und
vergleicht, ob dort steht, was stehen sollte. Schlägt eine Prüfung fehl, geht der
Befund zurück an den Agenten, benannt bis aufs Ticket.

**Wo der Mensch entscheidet:** Beide Texte landen als interne Notiz am Ticket, nie als Antwort
an die Kundin. Der Agent formuliert den Vorschlag, der Mensch im Support schickt ihn ab, ändert
ihn oder verwirft ihn.

### Die Redaktionskette: drei Rollen, eine Spur

**Vorher:** Eine Person schreibt, eine zweite liest gegen, wenn sie dazu kommt, die Findbarkeit
prüft am Schluss jemand oder niemand. Was in welcher Runde geändert wurde, weiss später
keiner mehr.

**Heute:** Ein Board mit sieben Spalten und drei Agenten. Nora schreibt, Rita prüft Fakten und
Ton, Sven prüft die Findbarkeit für Google und für Antwortmaschinen, dann liest ein Mensch.
Jede Station legt ihre Datei im Aufgabenordner ab, jede Übergabe schreibt eine Logzeile. Dieser
Post ist so entstanden. Beim Beitrag davor, einem Text zur Revision des
Behindertengleichstellungsgesetzes, sind acht Dateien und 93 Logzeilen angefallen, auf drei
Entwürfe und fünf Runden verteilt. Kein schöner Wert, aber ein nachlesbarer: jede Runde hat
einen Befund, und jeder steht in einer Datei.

**Wo der Mensch entscheidet:** Die Freigabe. Keine Station darf veröffentlichen, das Einstellen
ins CMS ist eine eigene Aufgabe. Und wenn zwei Rollen verschiedene Ziele haben, Findbarkeit
gegen Lesbarkeit zum Beispiel, lösen die Agenten den Konflikt nicht selbst: beide Begründungen gehen
ins Log, der Entscheid geht an einen Menschen.

### Wettbewerbsbeobachtung: holen und vergleichen ohne Modell, deuten mit

**Vorher:** Alle paar Wochen klickt jemand die Seiten der Mitbewerber durch und versucht sich
zu erinnern, wie sie vorher aussahen. In der Praxis fiel es aus.

**Heute:** Ein Skript holt die Seiten, extrahiert den sichtbaren Text und vergleicht ihn Zeile
für Zeile mit der letzten Fassung aus dem Wissensbestand des Teams. An diesem Teil ist kein
Modell beteiligt, deshalb fällt er jedes Mal gleich aus. Nur für die Seiten, die sich geändert
haben, sagt danach ein Agent in zwei bis vier Punkten, was sich geändert hat und warum es für
eine Agentur wichtig sein könnte, und er darf nichts behaupten, was nicht im Vergleich steht.
Zwei Seiten beobachten wir heute so.

**Wo der Mensch entscheidet:** Ob aus einer Beobachtung eine Aufgabe wird. Das System sagt, was
sich geändert hat, nicht, was wir tun.

## Wo ein agentisches System nichts bringt

Vier Fälle, in denen wir abraten.

### Der Prozess ist nicht beschrieben

Wenn niemand sagen kann, was der Auslöser ist, welche Schritte folgen und was am Schluss
dasteht, erbt das System die Unordnung.

### Die Aufgabe kommt einmal vor

Der Aufbau kostet mehr, als ein einmaliger Lauf spart. Es zahlt sich aus, wo etwas jede Woche
gleich läuft.

### Es gibt keine Rollen, keine Freigaben, kein Logbuch

Ein Agent ohne diese drei gehört nicht in einen Prozess. Drei Fragen vor dem Start: Als wer
handelt der Agent? Worauf darf er zugreifen? Wer schaut zu, wenn er es tut? Wer darauf keine
Antwort hat, baut kein System, sondern ein Risiko.

### Die Entscheidung trägt Verantwortung

Geld, Recht, Kundenkontakt, Personal: dort bleibt der Entscheid beim Menschen. Das ist nicht
die Einschränkung des Ansatzes, sondern sein Sinn. Ein System, dem man die Prüfschritte wegnimmt,
ist wieder ein Chatfenster mit Schreibrechten.

## Was du in den nächsten Wochen entscheiden kannst

Vier Schritte ohne Budgetantrag.

### Einen Prozess in zehn Zeilen aufschreiben

Nimm einen Ablauf, der jede Woche gleich läuft, und notiere Auslöser, Schritte, Resultat. Macht
die Person, die ihn heute macht, in einer halben Stunde.

### Die prüfbaren Schritte markieren

Markiere, was Code lesen und entscheiden kann: Vollständigkeit, Format, Werte aus einer Liste.
Alles andere ist Kandidat für einen Agentenschritt. Macht die IT.

### Festlegen, wo die Freigabe sitzt

Bestimme vor dem Bauen, welcher Schritt einen Menschen braucht und wer das ist. Nachträglich
eingebaute Freigaben werden umgangen. Entscheidet die Bereichsleitung.

### Den Ausgangswert festhalten

Zähl einmal, wie viel Zeit der Ablauf heute kostet und wie oft er ausfällt. Ohne diese
Zahlen kannst du später nicht sagen, ob es besser wurde.

## kraftwerk, unser Werkzeug dafür

Wir bauen solche Systeme mit kraftwerk, einem Open-Source-Werkzeug von netnode: ein agentischer
Workspace, in dem Menschen und persistente KI-Kollegen an echten Aufgaben zusammenarbeiten.
Agenten, Wissen, Skills und Workflows gehören dem Team und nicht der Person, die sie
eingerichtet hat. Agentische und deterministische Schritte sind kombiniert: jeder
Agentenschritt muss einen Check passieren, der die tatsächlichen Dateien liest, bevor die
Arbeit weiterläuft, und jeder Lauf hinterlässt eine Spur mit Dauer und Kosten. Installiert wird
es mit `npm install -g @netnodeag/kraftwerk`, es braucht Node 20 oder neuer und eine
Agenten-Harness, also Claude Code, Codex oder Pi. Der Code liegt offen auf
[GitHub](https://github.com/NETNODEAG/kraftwerk), wie wir damit Workflows bauen, steht in
[kraftwerk: Deterministische Workflows für AI-Agenten](https://netnode.ch/de/blog/kraftwerk-deterministische-workflows-ai-agenten).

## Häufige Fragen

### Was ist der Unterschied zwischen einem Chatbot und einem agentischen System?

Ein Chatbot antwortet auf eine Frage. Ein agentisches System erledigt eine Aufgabe: mehrere
Agenten mit Rollen, Prüfschritte zwischen den Übergaben, ein Mensch an den Stellen, an denen
entschieden wird.

### Braucht ein agentisches System ein eigenes KI-Modell?

Nein. Wir nutzen Standardmodelle und legen die Struktur darum herum. Welches Modell einen
Schritt macht, steht in der Workflow-Definition und ist austauschbar.

### Entscheidet die KI dann über Kundenanliegen?

In unserer Helpdesk-Triage nicht. Der Agent schlägt Priorität, Kategorie und zwei Texte vor,
ein Skript prüft den Vorschlag, und erst danach ändert das System zwei Dinge am Ticket: es
setzt die Priorität und hängt die beiden Texte als interne Notiz an. Nach aussen geht nichts
davon: was die Kundin liest, bestätigt ein Mensch im Support.

### Woran sehe ich, ob so ein System funktioniert?

An der Spur. Jeder Lauf hinterlässt Dateien und Logzeilen samt Dauer und Kosten, jede
fehlgeschlagene Prüfung ist dort benannt. Wenn du das nicht nachlesen kannst, hast du kein
System, sondern ein Versprechen.

<!-- field_markdown ENDE -->

## Links für field_article_links (Vorschlag, Feld gehört Sven)

1. KI-Agent vs. KI-Assistent: Was Entscheider 2026 wissen müssen,
   https://netnode.ch/de/blog/ki-assistenten-vs-ki-agenten
2. Das Agentic Work System: Der Bauplan für die agentische Organisation,
   https://netnode.ch/de/blog/agentic-work-system-bauplan
3. kraftwerk: Deterministische Workflows für AI-Agenten,
   https://netnode.ch/de/blog/kraftwerk-deterministische-workflows-ai-agenten

---

## Was die Redaktion im Text nicht lösen kann

1. **Positionierung von kraftwerk auf netnode.ch** ist offen und blockiert diesen Post
   nicht. Der bestehende kraftwerk-Post liegt unter `/de/blog/`, eine Produktseite gibt es
   nicht. Optionen: (a) nur Erwähnung im Blog wie hier, (b) eigene Produktseite unter
   `/de/programme/`, auf die dieser Post verlinkt, (c) eigenes Programm mit mehreren Seiten.
   Empfehlung: (a) jetzt, (b) sobald eine zweite Quelle als dieser Post darauf verlinken
   soll. Entscheid: Lukas.
2. **Du-Form gegen Sie-Form.** task.md verlangt du-Form, dieser Entwurf ist in du-Form. Die
   drei thematisch nahen Posts auf netnode.ch sind durchgehend in Sie-Form (gezählt: 41,
   18 und 14 Vorkommen von «Sie», null von «du» oder «dein»). Derselbe Entscheid ist auf
   Task 4 offen. Empfehlung: einmal für beide Posts entscheiden, aus Konsistenz mit den
   bestehenden Entscheider-Posts Sie-Form. Umbau kostet eine Runde.
3. **«Zwei Seiten beobachten wir heute so»** im dritten Beispiel ist der Stand vom
   7.11.2026 (zwei Konzepte im Wissensbundle `competitor-watch`). Vor der Publikation
   nachzählen, die Zahl kann sich ändern. Die Namen der beobachteten Mitbewerber stehen
   bewusst nicht im Text.
4. **Backlink:** aus `/de/blog/kraftwerk-deterministische-workflows-ai-agenten` und aus
   `/de/blog/agentic-work-system-bauplan` auf diesen Post verlinken, sonst steht er allein.
   Aufgabe für Web im CMS-Schritt.
5. **Der Post «KI-Agenten im Unternehmen: drei Fragen vor dem Start»** aus Task 1 ist auf
   netnode.ch nicht auffindbar (182 Blog-Slugs geprüft). Die drei Fragen stehen deshalb
   ausgeschrieben im Grenzen-Abschnitt. Wenn es den Post doch gibt, Link nachtragen und die
   Fragen kürzen.
6. **npm-Seite nicht verlinkt:** `npmjs.com/package/@netnodeag/kraftwerk` antwortet
   einfachen Clients mit 403. Der Paketname ist belegt, der Link bleibt draussen.
7. **«93 Logzeilen» und «acht Dateien» vor der Publikation nachzählen** (Ritas N4). Beide
   Werte stimmen am 7.11.2026 exakt, aber Task 4 liegt in Review: gibt ein Mensch ihn
   zurück, wachsen Logzeilen und Dateien. Befehl für die Logzeilen:
   `grep -c '^\* ' <Task-4-Ordner>/log.md`. Wer: CMS-Schritt.
8. **`competitor-watch` vor der Publikation einmal laufen lassen** (Ritas N5). Der Satz
   «Zwei Seiten beobachten wir heute so» steht im Präsens, der letzte Lauf war am
   23.9.2026, und brief.md sagt «reviewed weekly». Ein Lauf macht den Satz aktuell und
   bestätigt gleichzeitig die Zahl zwei. Wer: Web oder wer den Workflow auslöst.
9. **Den bestehenden kraftwerk-Post nachziehen** (Ritas N6).
   `/de/blog/kraftwerk-deterministische-workflows-ai-agenten` nennt kraftwerk ein
   «Open-Source-Framework» für feste Workflows und sagt «npx genügt», dieser Post sagt
   «agentischer Workspace» und `npm install -g`. Beides war zu seiner Zeit richtig,
   nebeneinander im selben Blog ist es verwirrend. Eigener Auftrag für Web, blockiert
   diesen Post nicht.
