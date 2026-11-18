<!-- node_title BEGINN -->
Drupal 12: Weniger Zeit für Updates
<!-- node_title ENDE -->

<!-- field_teaser_text BEGINN -->
Drupal 12 kommt im Dezember 2026, gleichzeitig sinkt das Sicherheits-Fenster je Zwischenversion von 12 auf 8 Monate. Was das für Ihre Website bedeutet.
<!-- field_teaser_text ENDE -->

<!-- field_article_leadtext BEGINN -->
Ab Dezember 2026 läuft Drupal 10 aus. Und für die Versionen ab Drupal 11.5 und 12.0 gilt ein kürzeres Sicherheits-Fenster: 8 statt 12 Monate.
<!-- field_article_leadtext ENDE -->

<!-- field_markdown BEGINN -->
Drupal 12 erscheint in der Woche vom 7. Dezember 2026, zwei Tage bevor Drupal 10 keine Sicherheitsupdates mehr erhält. Gleichzeitig verkürzt das Drupal-Sicherheitsteam das Fenster, in dem eine einzelne Version Sicherheitskorrekturen bekommt, von 12 auf 8 Monate. Für Sie heisst das: Wenn Sie eine Drupal-Website betreiben, müssen Sie künftig öfter aktualisieren, um abgesichert zu bleiben, nicht nur beim grossen Versionswechsel.

## Betrifft Sie das?

| Ihre Situation | Betrifft Sie das? | Was jetzt zu tun ist |
| --- | --- | --- |
| Sie betreiben Drupal 10, egal welche 10er-Version | Ja, mit Frist | Umstieg auf Drupal 11 oder 12 einleiten, die Sicherheitsupdates enden am 9. Dezember 2026 |
| Sie betreiben Drupal 11.0, 11.1 oder 11.2 | Ja, sofort | Diese Versionen erhalten bereits heute keine Sicherheitsupdates mehr, für 11.2 endete der Support in der Woche vom 29. Juni 2026. Update auf 11.4 oder 11.5 |
| Sie betreiben Drupal 11.3 | Ja, mit Frist | Die Sicherheitsupdates enden in der Woche vom 7. Dezember 2026, Update auf 11.5 oder 12.0 einplanen |
| Sie betreiben Drupal 11.4 | Ja, ab 2027 | Übergangsversion, die Sicherheitsupdates enden am 21. April 2027 |
| Sie betreiben ab Dezember 2026 Drupal 11.5 oder 12.0 | Ja, neues Fenster | Erste Versionen im 8-Monats-Fenster, der Support endet im August 2027. Danach innerhalb von 2 Monaten nach jeder neuen Zwischenversion aktualisieren |
| Sie nutzen ein anderes CMS, etwa WordPress oder TYPO3 | Nein, nicht direkt | Kein Handlungsbedarf aus diesem Artikel |

## Drupal 12 und der neue Release-Zyklus: was sich ändert

Drupal unterscheidet zwei Arten von Versionssprüngen. Eine Major-Version, etwa der Schritt von 11 auf 12, bringt grössere technische Umstellungen und neue Mindestanforderungen an PHP oder die Datenbank. Eine Minor-Version, auch Zwischenversion genannt, etwa von 11.4 auf 11.5, bringt neue Funktionen, ohne bestehenden Code zu brechen. Major-Versionen erscheinen alle zwei Jahre, Minor-Versionen etwa alle sechs Monate, jeweils im Juni und Dezember.

Jede Minor-Version erhielt bisher 12 Monate Sicherheitsabdeckung, so war es seit Drupal 8.6 im Jahr 2018. Mit der Ankündigung PSA-2026-11-02 verkürzt das Drupal-Sicherheitsteam dieses Fenster auf 8 Monate: 6 Monate mit regulärer Fehlerbehebung, danach 2 Monate, in denen nur noch Sicherheitslücken geschlossen werden (Security-only). Die ersten Versionen in diesem neuen Fenster sind Drupal 11.5 und 12.0 aus der Dezemberwoche 2026, ihr Support endet im August 2027.

Zwei Einschränkungen gehören dazu. Erstens behält die jeweils letzte Minor-Version einer Major-Version 6 Monate Fehlerbehebung plus 6 Monate Sicherheitskorrekturen, zusammen also 12 Monate. Für Drupal 11 steht diese Version noch nicht fest, 11.5 ist sie nicht. Zweitens sind Drupal 11.3 und 11.4 Übergangsfälle mit eigenen Enddaten: 11.3 in der Woche vom 7. Dezember 2026, 11.4 am 21. April 2027.

Als Grund nennt das Sicherheitsteam eine stark gestiegene Zahl an Sicherheitsmeldungen, die mehr Arbeit bedeutet, als es mit den aktuellen Mitteln bewältigen kann. Als Folge der Verkürzung rechnet es mit rund 30 Prozent weniger Backport-Aufwand, also mit weniger Arbeit, um Sicherheitskorrekturen zusätzlich in ältere Versionen einzupflegen.

Praktisch heisst das: Erscheint eine neue Minor-Version, bleiben Ihnen danach 2 Monate, in denen Ihre bisherige Version noch Sicherheitskorrekturen erhält. Bisher waren es 6 Monate. Ein Update-Termin pro Jahr genügt damit nicht mehr.

Die Laufzeit der Major-Versionen selbst ändert sich nicht: Jede wird mindestens 4 Jahre unterstützt, mit Ende jeweils im Dezember. Drupal 10 endet am 9. Dezember 2026, Drupal 11 Anfang Dezember 2028, Drupal 12 Anfang Dezember 2030.

Drupal 12 setzt zudem höhere Plattform-Anforderungen voraus: PHP 8.5 als Minimum, MariaDB mindestens 10.11 statt bisher 10.6, PostgreSQL mindestens 18 statt bisher 16.

## Wer das löst und was es kostet

**Drupal-10-Websites müssen vor dem 9. Dezember 2026 umziehen.** Das übernimmt die Stelle, die die Website technisch betreut, intern oder [eine Agentur](https://netnode.ch/de/drupal-agentur). Der Aufwand hängt vom Custom-Code und den eingesetzten Modulen ab, realistisch sind Tage bis Wochen pro Projekt.

**Das Sicherheits-Fenster schrumpft von 12 auf 8 Monate.** Das betrifft, wer den Wartungsvertrag verantwortet. Der Update-Rhythmus muss von "einmal jährlich möglich" auf "zweimal jährlich nötig" umgestellt werden, das bedeutet 1 bis 2 zusätzliche Update-Zyklen pro Jahr im Wartungsbudget. NETNODE bietet dafür [Drupal Wartung as a Service](https://netnode.ch/de/drupal-wartung-as-a-service) an, die laufende Updates und Sicherheitspatches übernimmt.

**Die Plattform-Anforderungen steigen.** Das prüft der Hosting-Provider oder das Infrastruktur-Team: PHP- und Datenbank-Version müssen vor dem Umstieg auf Drupal 12 passen. Der Aufwand liegt meist im bestehenden Hosting-Paket, braucht aber Vorlaufzeit.

## Entscheidungen für die nächsten Wochen

1. Diese Woche klären, welche Drupal-Version aktuell läuft. Bei 11.0 bis 11.2 besteht sofortiger Handlungsbedarf, dort gibt es schon heute keine Sicherheitsupdates mehr.
2. Bei Drupal 10 oder 11.3: bis Ende November 2026 den Migrationspartner kontaktieren. Beide Fristen laufen in der Woche vom 7. Dezember 2026 ab.
3. Bis Ende 2026: den Wartungsvertrag auf zwei Update-Fenster pro Jahr prüfen und anpassen lassen, statt wie bisher auf einen jährlichen Zyklus zu setzen.
4. Vor jedem Update: PHP- und Datenbank-Version mit dem Hosting-Provider abgleichen, besonders im Hinblick auf Drupal 12.

## Häufige Fragen

### Was ist der Unterschied zwischen einer Major- und einer Minor-Version?

Eine Major-Version wie Drupal 12 bringt grössere technische Umstellungen und neue Mindestanforderungen. Eine Minor-Version wie 11.5 bringt neue Funktionen, ohne dass bestehender Code angepasst werden muss.

### Für welche Versionen gilt das 8-Monats-Fenster?

Für die Minor-Versionen ab Drupal 11.5 und 12.0, die in der Woche vom 7. Dezember 2026 erscheinen und im August 2027 aus dem Support fallen. Drupal 11.3 und 11.4 sind Übergangsfälle mit eigenen Enddaten, und die jeweils letzte Minor-Version einer Major-Version behält 12 Monate. Für Drupal 11 ist diese Version noch nicht festgelegt, 11.5 ist sie nicht.

### Muss ich sofort von Drupal 11 auf Drupal 12 wechseln?

Nein. Drupal 11 wird bis Anfang Dezember 2028 unterstützt. Wichtig ist, innerhalb von Drupal 11 den Minor-Versionen zu folgen, also von 11.4 auf 11.5 und weiter, denn jede einzelne davon hat ihr eigenes, kürzeres Sicherheits-Fenster.

### Was passiert, wenn meine Website nach dem 9. Dezember 2026 noch auf Drupal 10 läuft?

Sie erhält keine Sicherheitsupdates mehr. Bekannt werdende Sicherheitslücken bleiben dann offen, bis Sie auf Drupal 11 oder 12 umgestiegen sind.

### Warum hat Drupal das Sicherheits-Fenster verkürzt?

Laut PSA-2026-11-02 ist die Zahl der gemeldeten Sicherheitslücken stark gestiegen, und zwar auf mehr Arbeit, als das Sicherheitsteam mit den aktuellen Mitteln bewältigen kann. Die Verkürzung soll rund 30 Prozent weniger Aufwand für das Nachpflegen von Korrekturen in ältere Versionen bedeuten.

## Quellen

- [Drupal core release schedule](https://www.drupal.org/about/core/policies/core-release-cycles/schedule)
- [PSA-2026-11-02: Security support for Drupal core minor versions reduced to 8 months](https://www.drupal.org/psa-2026-11-02)
- [Drupal core release process overview](https://www.drupal.org/about/core/policies/core-release-cycles/release-process-overview)
- [Announcing Drupal 12.0.0 platform requirements](https://www.drupal.org/about/core/blog/announcing-drupal-1200-platform-requirements)

Ähnliche Artikel: [Was ist Drupal?](https://netnode.ch/de/blog/was-ist-drupal) erklärt die Grundlagen, [Neue Beta-Version von Drupal 11.0.0 veröffentlicht](https://netnode.ch/de/blog/neue-beta-version-von-drupal-1100-veroeffentlicht) deckt die technischen Änderungen der letzten Major-Version ab, dieser Artikel hier den Release-Zyklus und seine Folgen für die Planung.
<!-- field_markdown ENDE -->

<!-- was_die_redaktion_nicht_im_text_loesen_kann BEGINN -->
### Was die Redaktion nicht im Text lösen kann

- Die vier Termine "9. Dezember 2026" (Drupal-10-EOL), "Woche vom 7. Dezember 2026" (Drupal 12.0 und 11.5, gleichzeitig Supportende 11.3), "21. April 2027" (Supportende 11.4) und "August 2027" (Supportende 11.5 und 12.0) am Publikationstag gegen https://www.drupal.org/about/core/policies/core-release-cycles/schedule und https://www.drupal.org/psa-2026-11-02 nachprüfen, falls sich ein Termin bis zur Veröffentlichung verschiebt. Besitzer: Redaktion.
- Backlink von einem bestehenden Node auf diesen Artikel: nach Svens Befund besser von https://netnode.ch/de/blog/kritisches-drupal-security-update-so-handeln-wir (21. Mai 2026, thematisch benachbart) als von "Was ist Drupal?" (22. Mai 2019). Besitzer: Web, anderer Node.
- Die verlinkte Landingpage https://netnode.ch/de/drupal-agentur nennt als Upgrade-Ziel ausschliesslich Drupal 11 ("Von Drupal 7, 9 oder 10 auf Drupal 11"). Sobald dieser Artikel live ist und Drupal 12 erschienen ist, passt das nicht mehr zusammen. Die Seite selbst sagt nichts Falsches, sie ist nur älter als der Release. Besitzer: Web oder Redaktion, anderer Node, kein Blocker für diesen Text.
- field_article_links (Sidebar) ist von Sven befüllt, vier Links mit internal:-Prefix und /de/, siehe seo.md. Besitzer: Sven, erledigt.
- Die beiden neuen internen Links im Body stehen als absolute netnode.ch-URLs, gleich wie die zwei bereits vorhandenen. Falls im Body eine andere Schreibweise Hausstandard ist, ist das eine globale Konvention und keine Frage dieses Artikels. Besitzer: Web.
- Sprachform: Ich habe Sie-Form gewählt, weil der direkte Vorgängerartikel zu Drupal 11 ebenfalls Sie-Form nutzt und die Entscheider-Posts auf netnode.ch durchgehend Sie-Form verwenden (siehe Log). Die Rollenvorgabe sieht Du-Form als Standard vor, der Auftrag selbst (task.md) macht dazu keine Angabe. Dieser Abweich-Entscheid liegt bei einem Menschen, falls er anders gewünscht wird.
- Argon2id als Standard für das Passwort-Hashing in Drupal 12 stand in v1 und bleibt gestrichen: Die zitierte Primärquelle deckt den Satz nicht (Review-Blocker 1, selbst gegengeprüft). Nur mit eigener Primärquelle auf drupal.org zurück in den Text. Besitzer: Redaktion.
- Erledigt, nicht mehr offen: "seit Drupal 8.6 im Jahr 2018" stand als Nit 1 in review-v2.md auf dieser Liste. Der Teilsatz ist belegt, PSA-2026-11-02 wörtlich: "Drupal has supported each minor release of Drupal (example: 11.3, 11.4) for 12 months each since the release of Drupal 8.6 in 2018." Er bleibt im Text, die Quelle ist die zweite in der Quellenliste. Besitzer: niemand.
- FAQPage-Schema wird für Artikel nicht ausgespielt (FaqJsonLd.tsx, Epic 285 #2348) und field_article_employee bleibt leer, der Autor wird dadurch als Person typisiert. Beides vorbestehend und kein Blocker, Details in seo.md. Besitzer: Web beziehungsweise CMS-Schritt.
<!-- was_die_redaktion_nicht_im_text_loesen_kann ENDE -->
