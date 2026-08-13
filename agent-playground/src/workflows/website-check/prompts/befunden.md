Lies messwerte.md — die rohen, deterministisch gemessenen Ausgaben der
fuenf Pruefungen fuer ${{ request }}. Wende GENAU die folgenden
Schwellwerte an und leite daraus Befunde ab. Interpretiere nur, was in
messwerte.md steht; erfinde nichts, rate nichts.

## Schwellwerte

- HTTPS (Kategorie: HTTPS): http:// leitet nicht auf https:// um = hoch;
  finaler Status nicht 200 = hoch; Abruf fehlgeschlagen = hoch.
- Security-Header (Kategorie: Security-Header): jeder Header mit "FEHLT"
  ist ein Befund — strict-transport-security und content-security-policy
  = hoch, die uebrigen vier = mittel.
- SEO (Kategorie: SEO): title FEHLT oder title-laenge unter 10 / ueber 60
  = hoch; meta-description FEHLT oder description-laenge unter 50 / ueber
  160 = hoch; canonical FEHLT = mittel; robots.txt oder sitemap.xml nicht
  Status 200 = mittel; img-ohne-alt groesser 0 = mittel.
- Performance (Kategorie: Performance): ttfb ueber 1.5s = hoch, ueber
  0.8s = mittel; size ueber 2000000B = mittel; content-encoding FEHLT =
  mittel; kein cache-control = niedrig.
- Links (Kategorie: Links): jeder Link mit Status 4xx/5xx ist ein Befund
  (404/410/5xx = hoch, sonst mittel).

## Ergebnis

Schreibe alle Befunde nach findings.md. Erste Zeile "# Befunde", danach
pro Befund ein Abschnitt "## <kurzer Titel>" mit genau diesen Zeilen:

- Kategorie: <HTTPS | Security-Header | SEO | Performance | Links>
- Schweregrad: <hoch | mittel | niedrig>
- Evidenz: <die betreffende Zeile aus messwerte.md woertlich zitiert>
- Empfehlung: <ein Satz, was zu tun ist>

Erfuellt eine Messung ihren Schwellwert nicht, ist sie KEIN Befund und
erscheint nicht in findings.md.
