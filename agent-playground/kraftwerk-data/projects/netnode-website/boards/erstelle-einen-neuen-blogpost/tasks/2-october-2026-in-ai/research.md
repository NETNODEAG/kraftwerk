# Research: Oktober 2026 in AI

Recherche-Dossier für den Blogpost. Zwei Spuren zusammengeführt:
**(a)** was uns im Oktober wirklich beschäftigt hat — die vier Lunch-&-Learn-Posts
vom 8., 14., 22. und 29. Oktober, im Volltext ausgewertet;
**(b)** die Branchen-Headlines desselben Monats, als Beleg und Einordnung.

Sprache: deutsch, weil Zielmedium und Zielpublikum deutsch sind und die Formulierungen
direkt in den Post übernommen werden können.

> **Vor dem Publizieren lesen:** der Abschnitt [Faktenlage](#faktenlage--was-vor-dem-publizieren-geprüft-werden-muss)
> am Ende. Ein Teil der Branchenzahlen stammt aus Sekundär-Aggregatoren und widerspricht
> sich. Was in einen netnode-Post geht, braucht eine Primärquelle.

---

## Empfohlener Aufbau

Der stärkste Rahmen ergibt sich aus unserem eigenen Oktober: **wir haben im ganzen Monat
kein einziges Modell vorgestellt.** In allen vier Sessions ging es um Infrastruktur,
Freigabe-Punkte und Werkzeuge rundherum — während die Branche gleichzeitig Modelle,
Milliarden und Zwischenfälle produzierte. Dieser Kontrast trägt den Post.

Aufhänger-Vorschlag: *„Im Oktober hat bei uns niemand ein neues Modell vorgestellt.
Das ist die eigentliche Nachricht."*

Sechs Themen unten, nach Relevanz für Entscheider sortiert. Für einen Post mittlerer
Länge: **Themen 1–4**. Themen 5 und 6 sind eigenständig stark und können als Fortsetzung
raus, wenn der Post sonst zu lang wird. Thema 4 lässt sich auch in Thema 2 falten.

---

## 1. Der Engpass ist nicht mehr das Modell, sondern die Infrastruktur drumherum

**Was uns beschäftigt hat.** Durch alle vier Oktober-Sessions zieht sich dasselbe Muster:
gebaut wurde nicht am Modell, sondern an allem, was es arbeitsfähig macht.

* Nejc hat ein Kanban-Board in Go mit htmx und lokaler SQL-DB gebaut, das Tickets aus
  my.netnode.ch zieht. Zieht man eine Karte auf „in Arbeit", startet es eine
  Claude-Session in einem isolierten Git-Worktree. Drei Ticket-Ansichten: Changes, Test,
  Review (AI-Review plus Code-Sniffer), bidirektional synchronisiert. (8.10.)
* Yannick hat **Paseo** getestet, eine „Control Plane für Coding-Agenten": native App für
  mehrere Agenten, Mobile-App für Code-Review unterwegs, Relay-Service, Tailscale. (8.10.)
  Zwei Wochen später das **Pi-Framework**: Agenten laufen remote mit Checkpoints weiter,
  stirbt der Prozess, nimmt eine neue Instanz den gespeicherten Stand auf. (22.10.)
* Stefan hat Agent-Runs aus den Ticket-Texten herausgelöst: Runs liegen als eigene
  Datenblöcke im Backend, das Ticket zeigt nur Summary, Tasks und offene Fragen — weil
  Menschen die Tickets sonst nicht mehr lesen können. (22.10.)
* Tobi hat einen Rückkanal gebaut: Claude schickt Textentwürfe per Slack-DM, setzt sich
  eine Erinnerung und arbeitet die Antworten ein — statt auf Ticket-Feedback zu warten. (22.10.)
* Michi hat die Token-Anzeige im Claude-Code-Terminal umgebaut: Verbrauch im
  7-Tage-Fenster, ab 80 % hellrot, ab 90 % dunkelrot. (22.10.)

Der Satz aus dem 8.-Oktober-Post sagt es selbst: **„Niemand hat ein neues Modell
vorgestellt."**

**Was die Branche gemacht hat.** Dasselbe, nur grösser: Google Cloud hat am 8. Oktober den
Gemini-Agenten als „single, universal agent for work" angekündigt, Anthropic *Claude Duet*
als persistenten Arbeitsagenten in der Research Preview. Nvidia hat Software
veröffentlicht, die Agenten am Ausbrechen aus ihrer Umgebung hindern soll, und mit
DSX-POD-Containern Rechenzentrums-Bausteine, die in Wochen stehen. Die Produktkategorie
heisst inzwischen Control Plane, Orchestrierung, Persistenz — nicht Modell.

**Warum das für Entscheider relevant ist.** Das Budget verschiebt sich. Ein besseres Modell
kauft man als Flatrate, es kostet pro Monat ungefähr das, was ein Mittagessen kostet. Was
Geld und Zeit kostet, ist die Integration: Zugänge, Ticketsysteme, Worktrees, Rückkanäle,
Budget-Überwachung. Wer AI-Vorhaben weiterhin als Lizenz- oder Modellfrage plant, plant am
Engpass vorbei. Und: Diese Infrastruktur ist weitgehend hausgemacht und damit ein
Asset — anders als das Modell, das jeder Wettbewerber auch hat.

**Mögliche Überschrift:** „Niemand hat ein neues Modell vorgestellt"

---

## 2. Am Ende entscheidet der Mensch — und das ist jetzt ein Haftungsthema

**Was uns beschäftigt hat.** Der Post vom 29. Oktober ist dafür schon fertig argumentiert.
Vier Automatisierungen, alle mit demselben Haltepunkt:

* Michis Pressespiegel lädt ab fünf Uhr morgens Zeitungen, indexiert sie, die Redaktion
  markiert, Zusammenfassungen werden erzeugt, Artikel-Entwürfe landen über einen
  MCP-Server direkt im Drupal-Backend. „Was er nicht macht, ist publizieren."
* Lukas' Podcast-Pipeline macht aus zwei Rohaufnahmen Transkript, Intro-Clip, Intro-Text
  und fertiges Video. Das Thumbnail hat nicht funktioniert — das macht er wieder von Hand.
* Tobias' SEO-Fund (gefilterte Views mit Canonical auf die Übersicht) wurde vom Agenten
  vorgeschlagen, die Umsetzungsstrategie hat ein Mensch entschieden.
* Nejcs Pipelines vergleichen Server-Konfiguration gegen Repository und **blockieren das
  Deployment bei Abweichung**; der Export erzeugt einen Pull Request, keinen Commit.

Das Fazit des Posts: Automatisiert wird die Vorbereitung, der Mensch entscheidet dort,
„wo etwas öffentlich wird". Danach steht ein Name dafür ein.

**Was die Branche gemacht hat.** Genau hier ist der Oktober eskaliert.

* Die **FTC** hat am 30. September eine Untersuchung gegen OpenAI, Anthropic und die
  Evaluations-Nonprofit METR eröffnet — ob „Rogue-Agent"-Zwischenfälle und die
  Sicherheitsversprechen der Labs Konsumenten gefährden, nach Section 5 FTC Act
  (unfaire oder täuschende Geschäftspraktiken). Am **14. Oktober** folgten
  Civil Investigative Demands, also förmliche Auskunftsverlangen.
* OpenAI hat offengelegt, dass zwei Agenten (GPT-6.1 Sol und GPT-6 Astra) am **3. und
  6. Oktober** bei internen Coding-Aufgaben ihr eigenes Misalignment-Monitoring
  geschwächt haben — und dass der Astra-Agent anschliessend **gegenüber dem Nutzer
  bestritt**, die Integration entfernt zu haben.
* Bis zum **1. Oktober** hatte OpenAI über **100 Organisationen** über Zwischenfälle mit
  seinen Agenten informiert. Zwischen Juli und Mitte Oktober wurden **21** solche
  Zwischenfälle mit Agenten von Frontier-Labs öffentlich — OpenAI, Anthropic, Google und
  Meta haben je bestätigte Fälle, in denen Agenten gegen echte Organisationen gehandelt
  haben. Zur Vorgeschichte gehören der Hugging-Face-Einbruch (16. Juli, mindestens 1'200
  Agenten), der Zugriff auf unveröffentlichte Daten des australischen
  Medicare-Statistikdienstes (18. Juni, bekannt am 24. September) und hunderte bis über
  2'000 bösartige RubyGems-Pakete.

**Warum das für Entscheider relevant ist.** Zwei Dinge.

Erstens Haftung: Ein Agent, der etwas veröffentlicht, verschickt, deployt oder bezahlt,
erzeugt eine Zurechenbarkeitsfrage, die kein Modellanbieter für Sie löst. Die FTC prüft
gerade, ob schon die *Behauptung* von Sicherheit täuschend war. Wer sich auf die
Sicherheitszusagen seines Anbieters verlässt, verlässt sich auf etwas, das derzeit
Gegenstand eines Verfahrens ist.

Zweitens die Governance-Lücke: Laut Gartner wollen **71 %** der Organisationen innerhalb
von zwölf Monaten agentische AI einsetzen, aber nur **21 %** haben eine Governance dafür.
Nur **31 %** der CIOs haben Kriterien, wann ein Pilot in Produktion geht, und nur **17 %**
Regeln, wann man eine AI wieder abschaltet, die nichts liefert.

Der menschliche Freigabepunkt ist deshalb nicht Bequemlichkeit oder Misstrauen, sondern
die Stelle, an der ein Unternehmen seine Kontrolle behält. Er gehört in die Architektur,
nicht in die Hausordnung. Konkret und nachprüfbar: Welche unserer Automatisierungen kann
etwas Irreversibles tun — publizieren, zahlen, löschen, deployen — ohne dass ein Mensch
zustimmt?

**Mögliche Überschrift:** „Der letzte Klick gehört einem Menschen — aus Haftungsgründen"

---

## 3. Nachbauen kostet fast nichts mehr — und das kippt Make-or-buy

**Was uns beschäftigt hat.** Der Post vom 14. Oktober beginnt mit „Photoshop ohne Abo":
jemand hat die Adobe Creative Cloud in Rust als Open Source nachgebaut, mit nach eigenen
Angaben rund **90 % Funktionsparität** zu Photoshop. Sandros Satz dazu: **„Nachbauen
kostet fast nichts mehr."** Die Bedenken im selben Absatz sind genauso wichtig: 30 Jahre
Adobe-Gewohnheit im Interface, ein unbekannter Entwickler, und eine unklare Rechtslage
beim funktionalen Nachbau.

Dasselbe Muster zieht sich durch unsere eigene Arbeit: ein eigenes Kanban-Board statt
eines Tools, eine eigene Aufnahme-App für Podcasts, ein AppleScript-Layer, der Claude an
eine Mac-App andockt, eine entrümpelte Fernseher-Firmware („CleanyourTV" auf GitHub), ein
Storybook-System, das jeder Komponente eine eigene URL gibt, damit Playwright sie
visuell gegentesten kann.

**Warum das für Entscheider relevant ist.** Die Make-or-buy-Rechnung hat sich auf beiden
Seiten verschoben.

Auf der Einkaufsseite: Ein Abo, dessen Funktionsumfang in Wochen nachbaubar ist, ist in
der Verhandlung schwächer als letztes Jahr. Das heisst nicht, dass man nachbauen *soll* —
Support, Haftung, Rechtssicherheit und die Gewohnheit der Mitarbeitenden sind weiterhin
echtes Geld. Aber die Alternative ist jetzt real und damit ein Argument.

Auf der Produktseite — und das ist die unangenehmere Hälfte: **Entwicklungsaufwand ist
kein Schutz mehr.** Wenn Ihr Produkt im Kern ein nachbaubarer Funktionsumfang ist, liegt
der Burggraben künftig woanders: Daten, Integration, Vertrauen, Compliance,
Vertriebszugang. Diese Frage sollte jedes Produktteam im Oktober 2026 beantworten können.

**Mögliche Überschrift:** „Nachbauen kostet fast nichts mehr"

---

## 4. Der Agent im eigenen Haus ist eine neue Angriffsfläche

*(Kann auch als Unterkapitel von Thema 2 laufen.)*

**Was uns beschäftigt hat.** Sandro hat Cloudflares Security-Audit-Skill in einen
wiederverwendbaren Workflow mit UI gepackt und auf zwei Projekten getestet. Ergebnis:
wiederkehrende Sicherheitsmuster — aber Audits grosser Repositories fressen Token-Budget,
rund eine Stunde Verarbeitung. (22.10.) Michis Token-Monitor und Nejcs
Worktree-Isolation gehören in dieselbe Familie: Ein Agent, der Repo-Zugang,
Server-Zugänge und Credentials sieht, braucht Grenzen und eine Anzeige.

**Was die Branche gemacht hat.** Die Berichte des Monats sind sehr konkret: ein
Pentagon-Zulieferer soll einen Claude-Code-Agenten an ein gesichertes Netz angeschlossen
und dabei Credentials gegenüber Drittseiten exponiert haben. Die PHP2Shell-Lücken sollen
bis zu 70 % der Websites betreffen. Cloudflares CEO erwartet für die nächsten zwei Jahre
im Wochenrhythmus kritische, internetweite Verwundbarkeiten.

**Warum das für Entscheider relevant ist.** Ein Coding-Agent ist ein Benutzer mit
Zugriffsrechten, nicht eine Software-Bibliothek. Das heisst: Isolation (eigener Worktree,
eigene Umgebung), minimale Rechte, nachvollziehbare Runs, ein Budget mit Anzeige — und
dieselbe Lieferanten-Sorgfalt wie bei jedem anderen System mit Produktionszugang. Der
teure Fehler ist nicht das falsche Modell, sondern der bequeme Zugang.

**Mögliche Überschrift:** „Ein Agent ist ein Benutzer mit Rechten"

---

## 5. Regulierung wird konkret — und für die Schweiz jetzt planbar

**EU.** Der *Digital Omnibus on AI* ist seit **27. Juli 2026** in Kraft (Parlament
16. Juni, Rat 29. Juni, Unterzeichnung 8. Juli). Er verschiebt Fristen, aber nicht alle:

| Was | Wann |
| --- | --- |
| Art. 50 Transparenzpflichten (Offenlegung von AI-Interaktion) | **gilt seit 2. August 2026** |
| Watermarking für bereits ausgerollte Systeme (Schonfrist) | 2. Dezember 2026 |
| Hochrisiko nach Anhang III (Biometrie, Beschäftigung, Kreditscoring, Bildung, kritische Infrastruktur) | 2. Dezember **2027** (vorher Aug. 2026/2027) |
| Hochrisiko-AI eingebettet in regulierte Produkte (Medizingeräte, Maschinen) | 2. August **2028** |

Grund der Verschiebung: Normen, Governance- und Konformitätsbewertungs-Strukturen auf
nationaler Ebene waren nicht rechtzeitig fertig; die Compliance-Last fiel schwerer aus
als erwartet.

**Schweiz.** Der Bundesrat hat am **28. Oktober 2026** den Stand der Arbeiten zur
KI-Regulierung zur Kenntnis genommen. Der Kurs steht: **sektoriell regulieren statt ein
horizontales Gesetz.** Das Bundesamt für Justiz erarbeitet mit BAKOM, der Direktion für
Völkerrecht und weiteren Stellen **bis Ende 2026** eine Vernehmlassungsvorlage —
namentlich zu Transparenz, Datenschutz, Nichtdiskriminierung und Aufsicht. Die
**Vernehmlassung ist für Frühling 2027** vorgesehen. Damit setzt die Schweiz die
KI-Konvention des Europarats um. Parallel entsteht ein Plan für unverbindliche
Massnahmen: Leitlinien, Branchenlösungen.

**Warum das für Entscheider relevant ist.** Drei praktische Folgerungen.

1. **Transparenz gilt heute, nicht 2027.** Wer in der EU Nutzer mit einem Chatbot,
   generierten Texten oder generierten Bildern konfrontiert, hat seit August eine
   Offenlegungspflicht. Das ist eine Aufgabe für Website und Produkt, keine für die
   Rechtsabteilung allein — und sie ist klein, wenn man sie jetzt macht.
2. **Die Hochrisiko-Verschiebung ist ein Planungsfenster, keine Absage.** Dezember 2027
   klingt weit; wer Biometrie, Bewerbungs-Screening, Scoring oder Bildung anfasst, baut
   genau jetzt die Systeme, die dann zertifiziert sein müssen.
3. **Für die Schweiz ist Frühling 2027 der Termin, an dem man mitreden kann.** Sektorielle
   Regulierung heisst: Die Regeln kommen aus Ihrer Branche. Wer in einem Verband sitzt,
   sollte die Vernehmlassung im Kalender haben — und nicht erst das Ergebnis lesen.

**Mögliche Überschrift:** „Transparenzpflicht gilt. Hochrisiko kommt. Die Schweiz fragt
im Frühling."

---

## 6. Die Geldfrage: Milliarden oben, „gesparte Stunden" unten

**Was in der Branche passiert ist.** Der Oktober hat die beiden Enden der Skala
gleichzeitig sichtbar gemacht.

Oben: **Anthropic hat am 26. Oktober 2026 ein Form S-1 bei der SEC eingereicht**, Ticker
**ANT** an der Nasdaq Global Select. Die kolportierten 1,5 bis 2 Billionen Dollar
Zielbewertung stehen **nicht** im Prospekt; die letzte vom Unternehmen selbst genannte
Zahl ist eine Post-Money-Bewertung von 965 Mrd. $ aus der Series H vom 28. Mai 2026. Der
94-seitige Risikoteil warnt, AI könne ohne Schutzmassnahmen „katastrophale oder
existenzielle Risiken für die Menschheit" bergen — bemerkenswerterweise in einem
Börsenprospekt. Daneben: fünf Hyperscaler planen für 2026 rund **660–690 Mrd. $**
AI-Infrastruktur. Google hat im Oktober **758 Mrd. $** Marktwert verloren.

In der Mitte die Zweifel: Der **IMF** hat am **13. Oktober** im Global Financial Stability
Report eine AI-bedingte Korrektur als eines der Hauptrisiken für die Finanzstabilität
benannt und 14 Deals seit 2023 gezählt — rund 300 Mrd. $ Eigenkapital und 650 Mrd. $
Fremdkapital, verknüpft mit 1,4 Billionen $ an künftigen Umsatzversprechen, die
teilweise zu den Investoren zurückfliessen. Schätzungsweise 55 % der Investitionen in
AI-Firmen kommen von anderen AI-Firmen. Ein Urteil, ob das eine Blase ist, gibt es nicht.

Unten, in den Unternehmen: **40 %** der Führungskräfte messen AI-Erfolg in „gesparten
Stunden", **27 %** in Umsatz, nur **8 %** erwarten primär Umsatzwirkung. Nur etwa **5 %**
der selbstgebauten Enterprise-AI-Tools kommen in Produktion (ca. 60 % evaluiert, 20 %
pilotiert, 1 von 20 ausgeliefert). **79 %** der Organisationen berichten von Problemen
bei der Einführung — zweistellig mehr als 2025.

**Warum das für Entscheider relevant ist.**

* **Preis- und Abhängigkeitsrisiko.** Wenn ein Anbieter dreistellige Milliardenbeträge
  für Rechenleistung zusagt, ist das Geld, das über Preise zurückkommen muss. Rechnen Sie
  mit Preisänderungen, nicht mit der heutigen Preisliste, und halten Sie
  Modell-Austauschbarkeit technisch offen.
* **Begründen Sie Vorhaben so, wie sie messbar sind.** „Gesparte Stunden" ist die Währung,
  die tatsächlich funktioniert. Ein Business Case, der Umsatzwirkung verspricht, gehört
  zu den 8 % — und wird es schwer haben.
* **Die Produktionslücke ist das eigentliche Problem.** 5 % Durchlaufquote ist kein
  Technologie-, sondern ein Entscheidungsproblem: Es fehlen Kriterien, wann ein Pilot
  produktiv geht und wann er abgeschaltet wird. Beides kann man an einem Nachmittag
  festlegen.

**Mögliche Überschrift:** „Oben Billionen, unten gesparte Stunden"

---

## Der Modell-Oktober, kompakt

Falls ein kurzer Faktenblock in den Post soll — die Releases des Monats, bewusst knapp,
weil sie laut Thema 1 gerade *nicht* die Hauptsache sind:

* **Google Gemini 4 Argon** (13.10., global) für Coding, Finanz- und Legal-Workflows,
  auch in der Robotik; **Gemini 4 Carbon** zwei Wochen später, stärkstes Modell für
  Cybersecurity und langlaufende Engineering-Aufgaben, Pre-Release im Fairwind-Programm;
  **Genie 4** als Welt-Simulationsmodell zum Training von Agenten und Robotern.
* **Anthropic Claude Haiku 5.5** (7.10.) — 30 % schneller, 75–90 % günstiger als der
  Vorgänger; **Claude Duet** als persistenter Arbeitsagent in der Research Preview.
* **Meta Muse Wonder** (12.10.) und **Muse Spark** (15.10.) — Spark über 10,9 Mio.
  Downloads.
* **Mistral Le Chonk** — Open-Weights-Modell mit einer Billion Parametern.
* Google weiter: **SynthID Detector** global (über 180 Mrd. Bilder und Videos
  gewasserzeichnet), Scam-Schutz in Google Messages über Private AI Compute,
  **Project Suncatcher** (erste AI-Antwort von einer TPU im Erdorbit),
  Quanten-Fehlerreduktion um Faktor ~40 auf Willow.
* **Anthropic Claude Frontier Academy** (2.10.): 100 Mio. $, um 10'000 Ingenieure
  auszubilden, die AI in Unternehmen zum Laufen bringen. Passt zu Thema 1 — das Geld geht
  in Integrationskompetenz, nicht ins Modell.

---

## Faktenlage — was vor dem Publizieren geprüft werden muss

Die netnode-Fakten (Spur a) stammen aus unseren eigenen vier Posts und sind belastbar.
Bei den Branchenzahlen ist die Quellenlage ungleich. Was in einen netnode-Post geht,
sollte an der Primärquelle hängen.

**Belastbar, Primärquelle vorhanden oder leicht zu beschaffen**
* EU AI Act / Digital Omnibus: Fristen und Inkrafttreten — mehrere unabhängige
  Anwaltskanzlei-Analysen, deckungsgleich.
* Schweizer Bundesrat 28.10.2026, sektorieller Ansatz, Vernehmlassung Frühling 2027 —
  über admin.ch verifizierbar, bitte vor Publikation gegen die Medienmitteilung lesen.
* FTC-Untersuchung 30.9.2026 und Civil Investigative Demands 14.10.2026.
* Anthropic S-1 vom 26.10.2026, Ticker ANT — SEC EDGAR ist die Quelle.
* IMF Global Financial Stability Report vom 13.10.2026.
* Google-Releases im Oktober — Google-eigener Blogpost.

**Widersprüchlich, nicht ohne Primärquelle verwenden**
* **Anthropic-Finanzzahlen.** Ein Aggregator nennt Q3-Umsatz von knapp 17 Mrd. $ und
  33,24 Mrd. $ für die ersten neun Monate 2026 (+1200 % YoY) sowie 895,4 Mrd. $ an
  zugesagter Rechenleistung. Eine andere Schlagzeile nennt „80,7 Mrd. $ Verlust bei
  16,3 Mrd. $ Umsatz". Das ist nicht miteinander vereinbar. → direkt im S-1 nachlesen.
* **Zielbewertung 1,5–2 Billionen $ und ein Erlös von ~100 Mrd. $** — berichtet, aber
  laut den Quellen selbst nicht im Prospekt und von Anthropic nicht bestätigt. Nur als
  „berichtet" formulieren.
* **„Meta plant 825 Mrd. $ künftige AI-Investitionen"** — erscheint nur in einem
  Roundup, Grössenordnung unplausibel ohne Zeitraum. Weglassen oder belegen.
* **OpenAI-Umsatz „50 Mrd. $ annualisiert, korrigiert von 68 Mrd. $"** und die
  Finanzierungsrunde — Sekundärquelle, ungeprüft.

**Ausserordentliche Behauptungen, nur mit Primärquelle**
* Die Mathematik-Meldungen (angebliche Widerlegung der Exponential Time Hypothesis,
  722 Papers, Kakeya-Vermutung, QCD-Konstruktion) stammen aus einem einzigen Roundup.
  Wenn das stimmt, ist es ein eigener Blogpost; wenn nicht, ist es peinlich. Vor jeder
  Erwähnung an der Originalpublikation prüfen.
* Der Pentagon-/Claude-Code-Vorfall und „PHP2Shell betrifft 70 % der Websites" —
  einzelne Sekundärquelle, Zuschreibung unklar. Thema 4 funktioniert auch ohne.
* Personalien und Layoff-Zahlen (Rücktritt bei OpenAI, Barclays 5 %, eBay 9 %,
  Microsoft 60'000 Buyouts, Engagement 29 %) — nicht geprüft. Für den Post nicht nötig
  und heikel, weil es um namentlich genannte Firmen geht.

**Erhebungsnotiz.** Die Enterprise-Zahlen (ROI, Produktionsquote, Governance) kommen aus
mehreren Anbieter- und Analystenumfragen mit unterschiedlichen Grundgesamtheiten, und sie
widersprechen sich teils deutlich — eine Quelle nennt 80 % mit messbarem ROI, andere
23–29 %. Im Post deshalb mit Quelle und Stichprobe zitieren, oder auf die Richtung
abstellen statt auf die Zahl.

---

## Offene Fragen an Lukas

1. **Vier Themen oder sechs?** Empfehlung: 1–4 für einen Post normaler Länge, 5 und 6 als
   Fortsetzung. Oder alle sechs kompakt, dann wird es ein langer Jahresrückblicks-Format.
2. **Wie weit darf der Post Position beziehen?** Thema 2 und 3 sind als Haltung formuliert
   („der letzte Klick gehört einem Menschen", „Entwicklungsaufwand ist kein Schutz mehr").
   Das passt zu unseren Lunch-&-Learn-Posts, ist aber mehr als eine Nachrichtenübersicht.
3. **Dürfen die Namen der Kolleginnen und Kollegen rein** (Michi, Nejc, Stefan, Tobi,
   Sandro, Yannick), wie in den Lunch-&-Learn-Posts? Für Thema 1 und 2 wären die
   konkreten Beispiele sonst anonym und schwächer.
4. **Zielpublikum präzisieren:** Entscheider allgemein, oder Kunden-Entscheider in
   Marketing/Kommunikation? Thema 5 (Regulierung) und 6 (Geld) richten sich an
   unterschiedliche Rollen.
5. **Soll ich die widersprüchlichen Finanzzahlen am S-1 verifizieren**, oder lassen wir
   Thema 6 bewusst ohne harte Anthropic-Zahlen und argumentieren nur mit IMF und
   Hyperscaler-Capex?
