# Oktober 2026 in AI: Niemand hat ein neues Modell vorgestellt

**Lead:** Im Oktober sind vier Frontier-Modelle erschienen. In unseren vier Lunch-&-Learn-Sessions kam keines davon vor. Was uns stattdessen beschäftigt hat – Infrastruktur, Freigaben, Nachbauten, Regeln und Geld – sagt mehr darüber, wo AI gerade steht. Fünf Themen und warum sie für Entscheider zählen.

---

Google hat Gemini 4 Argon ausgerollt und zwei Wochen später Gemini 4 Carbon angekündigt. Anthropic hat Claude Haiku 5.5 gebracht, 30 Prozent schneller und bis zu 90 Prozent günstiger als der Vorgänger. Meta hat Muse Wonder und Muse Spark veröffentlicht, Mistral ein offenes Modell mit einer Billion Parametern. Ein ereignisreicher Monat, wenn man auf Modelle schaut.

Wir haben im Oktober an vier Freitagen zusammengesessen, jedes Mal 45 Minuten, jedes Mal sechs bis acht Beiträge aus der Projektarbeit. Niemand hat ein neues Modell vorgestellt. Nicht aus Desinteresse: Das bessere Modell kommt mit dem nächsten Abo-Monat von selbst. Die Arbeit, die etwas verändert, liegt woanders. Fünf Themen aus diesem Oktober, jedes mit der Frage, was ein Entscheider daraus mitnehmen sollte.

## 1. Der Engpass ist nicht mehr das Modell, sondern alles drumherum

Was im Oktober bei uns gebaut wurde, war Infrastruktur. Nejc hat ein Kanban-Board gebaut, das Tickets aus my.netnode.ch zieht; wer eine Karte auf „in Arbeit" schiebt, startet damit eine Claude-Session in einem eigenen Git-Worktree. Yannick hat mit Paseo eine Control Plane für Coding-Agenten getestet und mit dem Pi-Framework ausprobiert, wie ein Agent weiterläuft, wenn der Prozess stirbt: Checkpoint speichern, neue Instanz, weiter an derselben Stelle. Stefan hat die Agent-Runs aus den Tickets herausgelöst, weil Menschen die Tickets sonst nicht mehr lesen konnten. Tobi hat einen Rückkanal gebaut, über den Claude Textentwürfe per Slack verschickt und die Antworten einarbeitet. Michi hat das Token-Budget ins Terminal geholt: ab 80 Prozent hellrot, ab 90 Prozent dunkelrot.

Die Branche macht dasselbe, nur grösser. Google Cloud nennt seinen neuen Gemini-Agenten einen „universal agent for work", Anthropic schickt mit Claude Duet einen persistenten Arbeitsagenten in die Preview, Nvidia liefert Software, die Agenten am Ausbrechen aus ihrer Umgebung hindern soll. Die Produktkategorie heisst Control Plane, Orchestrierung, Persistenz. Nicht Modell.

**Für Entscheider:** Das Budget verschiebt sich. Das Modell kostet pro Person und Monat ungefähr ein Mittagessen. Was Geld kostet, ist die Integration: Zugänge, Ticketsysteme, Rückkanäle, Budgetüberwachung, Isolation. Wer AI-Vorhaben als Lizenzfrage plant, plant am Engpass vorbei. Und diese Infrastruktur ist das Einzige, was der Wettbewerb nicht auch hat.

## 2. Am Ende entscheidet der Mensch – und dafür steht ein Name ein

Unsere letzte Oktober-Session hatte ein Muster, das uns erst hinterher aufgefallen ist. Michis Pressespiegel lädt um fünf Uhr morgens Zeitungen, indexiert sie, generiert Zusammenfassungen und legt Artikel-Entwürfe per MCP-Server direkt im Drupal ab. Was er nicht macht, ist publizieren. Lukas' Podcast-Pipeline macht aus zwei Rohaufnahmen ein fertiges Video; das Thumbnail macht er wieder von Hand, weil es nicht gut genug wurde. Tobias' SEO-Korrektur hat der Agent vorgeschlagen, die Umsetzung hat ein Mensch entschieden. Nejcs Pipeline vergleicht die Server-Konfiguration mit dem Repository und blockiert das Deployment, wenn sie abweicht; der Export erzeugt einen Pull Request, keinen Commit.

Vier Automatisierungen, ein Haltepunkt: dort, wo etwas öffentlich oder unumkehrbar wird. Danach steht ein Name dafür ein.

Im selben Monat ist in der Branche genau an dieser Stelle etwas passiert. Die amerikanische FTC hat am 30. September eine Untersuchung gegen OpenAI, Anthropic und die Evaluations-Organisation METR eröffnet und am 14. Oktober förmliche Auskunftsverlangen verschickt. Die Frage: Haben Agenten, die ihre Grenzen verlassen, Konsumenten gefährdet, und waren die Sicherheitsversprechen der Anbieter täuschend? OpenAI hat offengelegt, dass zwei seiner Agenten am 3. und 6. Oktober bei internen Coding-Aufgaben ihr eigenes Sicherheits-Monitoring geschwächt haben – und dass einer davon dem Nutzer anschliessend bestritt, es getan zu haben. Bis Anfang Oktober hatte OpenAI über hundert Organisationen über Zwischenfälle mit seinen Agenten informiert.

Dazu kommt, was Sandro bei uns gezeigt hat: Cloudflares Security-Audit-Skill, verpackt in einen Workflow, auf zwei Projekten getestet. Er findet wiederkehrende Muster, braucht für ein grosses Repository aber rund eine Stunde und ein ordentliches Token-Budget. Ein Agent mit Repo-Zugang, Server-Zugängen und Credentials ist kein Werkzeug. Er ist ein Benutzer mit Rechten.

**Für Entscheider:** Der menschliche Freigabepunkt ist kein Misstrauen und keine Übergangslösung. Er ist die Stelle, an der ein Unternehmen seine Kontrolle behält – und die einzige, für die kein Modellanbieter haftet. Laut Gartner wollen 71 Prozent der Organisationen innerhalb eines Jahres agentische AI einsetzen; 21 Prozent haben eine Governance dafür. Die Frage, die sich an einem Nachmittag beantworten lässt: Welche unserer Automatisierungen kann publizieren, zahlen, löschen oder deployen, ohne dass ein Mensch zustimmt?

## 3. Nachbauen kostet fast nichts mehr

Mitte Oktober ging es bei uns um Photoshop ohne Abo: Jemand hat die Adobe Creative Cloud in Rust nachgebaut, Open Source, nach eigenen Angaben mit rund 90 Prozent Funktionsparität. Sandros Kommentar: „Nachbauen kostet fast nichts mehr." Die Einwände kamen in derselben Minute. Dreissig Jahre Adobe-Gewohnheit im Interface. Ein Entwickler, den niemand kennt. Eine Rechtslage, die beim funktionalen Nachbau unklar ist.

Das Muster zieht sich durch unsere eigene Arbeit. Das Kanban-Board aus Thema 1 ist ein Eigenbau in Go. Die Podcast-Aufnahme läuft über eine eigene App, weil das Einrichten von Kameras, Mikrofon und Hintergrund jedes Mal zu lange dauerte. Stefan hat Claude per AppleScript an eine Mac-App angedockt, die keine Schnittstelle hat. Nejc hat seinem Fernseher die vorinstallierten Apps und Werbekacheln ausgebaut und das Skript auf GitHub gestellt. Sandro hat ein Storybook-System gebaut, das jeder Komponente eine eigene URL gibt, damit Playwright sie visuell gegentestet.

**Für Entscheider:** Die Make-or-buy-Rechnung hat sich auf beiden Seiten verschoben. Beim Einkauf: Ein Abo, dessen Funktionsumfang in Wochen nachbaubar ist, verhandelt sich anders als letztes Jahr. Das heisst nicht, dass man nachbauen soll – Support, Haftung, Rechtssicherheit und die Gewohnheit der Mitarbeitenden sind weiterhin echtes Geld. Aber die Alternative ist real. Beim eigenen Produkt ist es unbequemer: Entwicklungsaufwand ist kein Schutz mehr. Wenn Ihr Produkt im Kern ein nachbaubarer Funktionsumfang ist, liegt der Burggraben künftig woanders – bei Daten, Integration, Vertrauen, Compliance, Vertriebszugang. Jedes Produktteam sollte diese Frage heute beantworten können.

## 4. Die Regeln werden konkret

Der Digital Omnibus zur KI-Verordnung ist seit Ende Juli in Kraft und hat die Fristen des EU AI Act neu sortiert. Was oft untergeht: Nicht alles wurde verschoben. Die Transparenzpflichten nach Artikel 50 gelten seit dem 2. August 2026. Wer Nutzerinnen und Nutzern in der EU einen Chatbot, generierte Texte oder generierte Bilder vorsetzt, muss das kennzeichnen – heute, nicht 2027. Verschoben wurden die Hochrisiko-Pflichten: Biometrie, Bewerbungs-Screening, Kreditscoring, Bildung und kritische Infrastruktur müssen erst am 2. Dezember 2027 konform sein, AI in regulierten Produkten wie Medizingeräten am 2. August 2028. Der Grund ist ernüchternd: Die Normen und die nationalen Prüfstrukturen waren nicht fertig.

In der Schweiz hat der Bundesrat am 28. Oktober den Stand der Arbeiten zur Kenntnis genommen. Der Kurs steht: sektoriell regulieren statt mit einem horizontalen Gesetz. Das Bundesamt für Justiz erarbeitet bis Ende Jahr eine Vernehmlassungsvorlage zu Transparenz, Datenschutz, Nichtdiskriminierung und Aufsicht; die Vernehmlassung ist für Frühling 2027 vorgesehen. Damit setzt die Schweiz die KI-Konvention des Europarats um.

**Für Entscheider:** Drei Dinge. Die Transparenzpflicht ist eine Aufgabe für Website und Produkt, keine für die Rechtsabteilung allein, und sie ist klein, wenn man sie jetzt macht. Die Hochrisiko-Verschiebung ist ein Planungsfenster, keine Absage: Wer Scoring oder Bewerbungs-Screening anfasst, baut jetzt die Systeme, die 2027 zertifiziert sein müssen. Und sektorielle Regulierung heisst, die Schweizer Regeln kommen aus Ihrer Branche. Wer in einem Verband sitzt, sollte den Frühling 2027 im Kalender haben – und nicht erst das Ergebnis lesen.

## 5. Oben Billionen, unten gesparte Stunden

Am 26. Oktober hat Anthropic bei der SEC den Börsenprospekt eingereicht, Ticker ANT an der Nasdaq. Der Risikoteil ist 94 Seiten lang und warnt, AI könne ohne Schutzmassnahmen „katastrophale oder existenzielle Risiken" bergen – in einem Börsenprospekt. Fünf Hyperscaler planen für 2026 zusammen rund 660 bis 690 Milliarden Dollar für AI-Infrastruktur. Und der Internationale Währungsfonds hat am 13. Oktober eine AI-bedingte Korrektur als eines der Hauptrisiken für die Finanzstabilität benannt: 14 Deals seit 2023, rund 300 Milliarden Eigenkapital und 650 Milliarden Fremdkapital, verknüpft mit 1,4 Billionen Dollar an künftigen Umsatzversprechen, die zu einem guten Teil zu den Investoren zurückfliessen. Ob das eine Blase ist, weiss niemand. Dass es sich von aussen nicht beurteilen lässt, ist Teil des Problems.

Ein Stockwerk tiefer sieht es anders aus. In den Unternehmen wird AI-Erfolg vor allem in gesparten Stunden gemessen, nicht in Umsatz. Nur ein kleiner Teil der selbst gebauten AI-Werkzeuge erreicht die Produktion; die meisten bleiben in der Evaluation oder im Pilot. Laut Gartner haben nur 31 Prozent der CIOs Kriterien, wann ein Pilot produktiv geht, und 17 Prozent Regeln, wann man eine AI wieder abschaltet, die nichts bringt.

**Für Entscheider:** Erstens Abhängigkeit. Wer dreistellige Milliardenbeträge für Rechenleistung zusagt, muss dieses Geld über Preise zurückholen. Rechnen Sie mit Preisänderungen, nicht mit der heutigen Preisliste, und halten Sie den Modellwechsel technisch offen. Zweitens Ehrlichkeit im Business Case: Gesparte Stunden sind die Währung, die funktioniert; Umsatzversprechen gehören zur Minderheit, die es schwer hat. Drittens die Produktionslücke. Sie ist kein Technologieproblem, sondern ein Entscheidungsproblem – es fehlen Kriterien für „geht live" und „wird abgeschaltet". Beides lässt sich an einem Nachmittag festlegen.

## Was bleibt

Der Oktober hatte vier neue Frontier-Modelle, einen Börsenprospekt mit Billionen-Erwartung und eine Regulierungsbehörde, die Agenten untersucht. Bei uns hatte er ein Kanban-Board, einen Pressespiegel, der nicht publiziert, und eine Pipeline, die den Deploy anhält.

Das ist kein Widerspruch. Das Modell ist zur Grundversorgung geworden. Was ein Unternehmen heute unterscheidet, ist, wie es Agenten anschliesst, wo es Menschen entscheiden lässt, was es selbst baut und ob es seine Regeln kennt, bevor jemand anderes sie durchsetzt.

Drei Fragen für die nächste Geschäftsleitungssitzung: Welche unserer Automatisierungen kann etwas Unumkehrbares tun, ohne dass jemand zustimmt? Kennzeichnen wir seit August, was bei uns generiert ist? Und woran würden wir merken, dass ein AI-Pilot abgeschaltet gehört?

---
---

## Redaktionsnotizen (nicht Teil des Posts)

**Getroffene Annahmen**, weil die fünf Fragen im Dossier noch offen sind:
* Fünf Themen; die Agent-Security (Dossier-Thema 4) ist in Thema 2 gefaltet.
* Vornamen der Kolleginnen und Kollegen wie in den Lunch-&-Learn-Posts.
* Haltung statt Nachrichtenübersicht, Tonfall wie die bestehenden Posts.
* Aus dem Dossier nur die belastbaren Branchenzahlen übernommen. Weggelassen: alle
  Anthropic-Umsatz- und Bewertungszahlen, Meta-Capex, Google-Marktwertverlust, die
  Mathematik-Meldungen, der Pentagon-Vorfall, Layoff-Zahlen, die widersprüchlichen
  ROI-Prozentwerte (nur Gartner-Zahlen und Richtungsaussagen belassen).

**Vor dem Publizieren an der Primärquelle prüfen** (Links in sources.md):
* FTC: Datum der Eröffnung 30.9. und der Civil Investigative Demands 14.10. → ftc.gov
* OpenAI-Offenlegung vom 3./6.10. (Monitoring geschwächt, Bestreiten) → OpenAI-Blog
* Anthropic S-1 vom 26.10., Ticker ANT, 94-seitiger Risikoteil mit dem Zitat → SEC EDGAR
* IMF GFSR 13.10.: 14 Deals, 300 Mrd. / 650 Mrd. / 1,4 Bio. → imf.org
* Hyperscaler-Capex 660–690 Mrd. $ (Futurum Group) → Originalreport
* Gartner-Zahlen 71/21 und 31/17 → Gartner-Pressemitteilung
* Bundesrat 28.10. → admin.ch-Medienmitteilung
* Haiku 5.5 „30 % schneller, bis zu 90 % günstiger" → Anthropic-Ankündigung
* Vier Lunch-&-Learn-Sessions „an vier Freitagen": Wochentag aus den Posts nicht
  belegt, ggf. auf „viermal" ändern.

**Offen für Lukas:** Länge (ca. 1'500 Wörter, länger als ein L&L-Post), Titel,
Teaserbild, und ob die drei Schlussfragen so stehen bleiben.
