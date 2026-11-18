---
title: "Agentische Systeme: was sie sind, was sie bringen — Blogpost"
status: done
order: 20
created: 2026-11-07
---

## Was

Ein Blogpost für netnode.ch, der erklärt, was agentische Systeme sind, welchen
Nutzen sie einer Organisation bringen — und das an drei sehr konkreten Beispielen
zeigt. Am Schluss ein kurzer, unaufgeregter Hinweis darauf, dass netnode mit
kraftwerk ein Werkzeug hat, mit dem man solche KI-gestützten Geschäftsprozesse
baut.

Der Auftrag kommt vom User: «quick explanation what it is and how it brings value
to organisations, 3 very concrete examples, plus a quick hint that kraftwerk is a
good solution to build such an AI based business process system».

**Arbeitstitel:** «Agentische Systeme: wenn Software nicht mehr nur antwortet,
sondern arbeitet» (Vorschlag, nicht gesetzt.)

- Zielgruppe: Entscheider in GL, Marketing und IT-Verantwortung, die KI bisher als
  Chatfenster kennen und wissen wollen, was der Unterschied zu einem System ist,
  das Arbeit übernimmt.
- Winkel, den nur netnode hat: wir betreiben solche Systeme selbst. Die Beispiele
  kommen nicht aus einem Analystenbericht, sondern aus unseren eigenen Workflows.
- Abgrenzung, die der Post leisten muss: Chatbot vs. Agent vs. agentisches System
  (mehrere Agenten mit Rollen, Übergaben, Prüfschritten und einer Spur). Kurz,
  zwei bis drei Absätze, keine Taxonomie-Vorlesung.
- Haltung: nüchtern. Kein «KI revolutioniert», keine Prozentversprechen, die wir
  nicht belegen können. Was ein Mensch entscheidet, bleibt beim Menschen — das ist
  der Punkt, nicht die Einschränkung.

## Die drei Beispiele

Nimm drei aus dieser Liste — alle vier sind in diesem Workspace nachprüfbar, also
keine erfundenen Zahlen und keine Fremdbeispiele:

1. **Helpdesk-Triage.** Der Workflow `helpdesk-check`: offene Tickets samt Kontext
   laden, ein Agent schlägt Priorität, Kategorie und Kommentartext vor, Skripte
   validieren und setzen. Kernsatz: der Agent schlägt vor, der Code entscheidet.
   Prüfen in `kraftwerk.yml` bzw. der Workflow-Definition, was er tatsächlich tut.
2. **Redaktionelle Produktionskette.** Genau dieses Board: Schreiben (Nora), QA auf
   Fakten und Ton (Rita), SEO auf Findbarkeit (Sven), dann ein Mensch. Jede Station
   hinterlässt eine Datei, jede Übergabe eine Logzeile. Dass dieser Post selbst so
   entstanden ist, darf im Text stehen — ein Satz, nicht als Gag.
3. **Wettbewerbsbeobachtung.** Der Workflow `competitor-watch`: Seiten holen, Text
   extrahieren, gegen den Stand im Knowledge-Bundle diffen — und nur für das, was
   sich geändert hat, sagt ein Agent, was es bedeutet. Deterministisch holen und
   diffen, Agent nur für die Deutung.
4. **Accessibility-Audit als Deployment-Gate.** Kein Push auf Produktion ohne
   grünen Audit, der Audit läuft als wiederkehrende Routine statt als Projektphase
   am Schluss (Projekt-Brief netnode.ch).

Pro Beispiel drei Dinge, sonst ist es nicht konkret: was vorher Handarbeit war, was
das System heute übernimmt, und wo der Mensch entscheidet.

## Der Hinweis auf kraftwerk

Höchstens ein kurzer Abschnitt am Schluss, Hinweis statt Werbeblock. Nur diese
Fakten verwenden, nichts dazuerfinden:

- kraftwerk ist ein Open-Source-Werkzeug von netnode: ein agentischer Workspace,
  in dem Menschen und persistente KI-Kollegen an echten Aufgaben zusammenarbeiten.
- Agenten, Wissen, Skills und Workflows gehören dem Team, nicht der Person, die
  sie eingerichtet hat.
- Agentische und deterministische Schritte kombiniert: jeder Agentenschritt muss
  einen Check passieren, der die tatsächlichen Dateien liest, bevor die Arbeit
  weiterläuft; jeder Lauf hinterlässt eine Spur mit Dauer und Kosten.
- Installation: `npm install -g @netnodeag/kraftwerk`, braucht Node 20+ und eine
  Agenten-Harness (Claude Code, Codex oder Pi).
- Keine Preise, keine Kundenzahlen, keine Roadmap-Versprechen im Text.
- Wenn du eine öffentliche URL oder ein Repo verlinken willst und keine belegte
  hast: Logzeile und offen lassen, nicht raten. Der Link ist Sache des
  CMS-Schritts.

## Fertig wenn

- [ ] Entwurf als `draft.md` im Task-Ordner, deutsch, Schweizer Schreibweise
      (kein ß), du-Form, Haltung wie in den bestehenden Posts
- [ ] «Quick explanation»: was ein agentisches System ist, in höchstens drei
      Absätzen und ohne Buzzword-Einschlag — mit der Abgrenzung zum Chatbot
- [ ] Nutzenabschnitt für Organisationen: woran man den Nutzen merkt
      (Durchlaufzeit, Gleichmässigkeit, Nachvollziehbarkeit, Entlastung von
      Routine) — qualitativ, keine erfundenen Prozentzahlen
- [ ] Genau drei Beispiele, jedes mit vorher / heute / wo der Mensch entscheidet,
      jedes gegen die Workflow-Definition oder den Projekt-Brief geprüft (nicht
      aus dem Gedächtnis beschrieben); im Log steht, was du geprüft hast
- [ ] Ein Abschnitt zu den Grenzen: wo ein agentisches System nichts bringt oder
      schadet — ein Agent ohne Rollen, Freigaben und Logbuch gehört nicht in einen
      Prozess (siehe Teaser-Task 1 auf diesem Board: als wer handelt er, worauf
      darf er zugreifen, wer schaut zu)
- [ ] kraftwerk-Hinweis am Schluss, höchstens ein Abschnitt, nur mit den Fakten
      oben, kein Werbeblock
- [ ] Länge: mittlerer Post, 900–1400 Wörter — gezählt, nicht geschätzt
- [ ] Jede Zahl, jedes Produktdetail und jede Workflow-Beschreibung im Text hat
      eine Quelle im Workspace (Datei + Pfad im Log) oder steht nicht drin
- [ ] Meta-Felder lässt du Sven: Titel, `field_teaser_text`, Slug sind seine
      Sache, nicht deine
- [ ] kein Publizieren: der Post geht über QA und SEO zu einem Menschen, das
      Einstellen ins CMS ist eine eigene Aufgabe

## Notizen

- Inhalt für netnode.ch geht über NodeHive CMS, nie über das Repository
  (Projekt-Brief).
- Hausregeln dieses Boards in `board.md` lesen, bevor du anfängst — besonders
  «Zähle, was du behauptest» und «Prüfen, nicht übernehmen».
- Offen für einen Menschen, blockiert aber nicht: wie kraftwerk auf netnode.ch
  positioniert wird (eigenes Programm, Produktseite, nur Erwähnung). Wenn du eine
  Entscheidung brauchst, Frage mit Optionen und Empfehlung ins Log — nicht leer
  zurückgeben.
- Verwandt, nicht dasselbe: der bestehende Post «KI-Agenten im Unternehmen: drei
  Fragen vor dem Start» (Teaser in Task 1). Dieser Post hier ist die Stufe darüber
  — nicht ein Agent, sondern ein System aus mehreren. Wenn der alte Post noch
  erreichbar ist, darauf verlinken statt seine Inhalte zu wiederholen.
