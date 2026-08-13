Lies findings.md, bewerte die Befunde nach Business-Impact und
Dringlichkeit und kuere die fuenf kritischsten Issues. Schreibe den
Report nach report.md in genau dieser Struktur:

- Erste Zeile: "# Website-Check: <URL aus dem Auftrag: ${{ request }}>"
- "## Zusammenfassung": 3-5 Saetze zum Gesamtzustand der Website und dem
  wichtigsten Handlungsfeld.
- Danach genau fuenf Abschnitte "## Issue 1: <Titel>" bis
  "## Issue 5: <Titel>", absteigend nach Kritikalitaet, je mit den Zeilen:
  - Schweregrad: <hoch | mittel | niedrig>
  - Befund: <was ist das Problem, inkl. Evidenz aus findings.md>
  - Auswirkung: <warum es Besucher:innen oder das Geschaeft kostet>
  - Empfehlung: <konkreter naechster Schritt>

Uebernimm nur Befunde aus findings.md, erfinde keine neuen. Liegen mehr
als fuenf vor, waehle nach Impact; die uebrigen kannst du am Ende unter
"## Weitere Beobachtungen" in einer Zeile pro Punkt nennen.
