<!-- node_title BEGINN -->
Drupal 12: Weniger Zeit für Updates
<!-- node_title ENDE -->

<!-- field_teaser_text BEGINN -->
Drupal 12 kommt im Dezember 2026, gleichzeitig schrumpft das Sicherheits-Fenster pro Version von 12 auf 8 Monate. Was das für Ihre Website bedeutet.
<!-- field_teaser_text ENDE -->

<!-- field_article_leadtext BEGINN -->
Ab Dezember 2026 läuft Drupal 10 aus. Und ab 2027 gilt für alle Drupal-Versionen ein kürzeres Sicherheits-Fenster: 8 statt 12 Monate pro Version.
<!-- field_article_leadtext ENDE -->

<!-- field_markdown BEGINN -->
Drupal 12 erscheint in der Woche vom 7. Dezember 2026, zwei Tage bevor Drupal 10 keine Sicherheitsupdates mehr erhält. Gleichzeitig hat das Drupal-Sicherheitsteam angekündigt, das Update-Fenster pro Version ab 2027 von 12 auf 8 Monate zu verkürzen. Für Sie heisst das: Wenn Sie eine Drupal-Website betreiben, müssen Sie künftig öfter aktualisieren, um abgesichert zu bleiben, nicht nur beim grossen Versionswechsel.

## Betrifft Sie das?

| Ihre Situation | Betrifft Sie das? | Was jetzt zu tun ist |
| --- | --- | --- |
| Sie betreiben noch Drupal 10 | Ja, direkt | Umstieg auf 11 oder 12 bis 9. Dezember 2026 einleiten |
| Sie betreiben Drupal 11.0 bis 11.3 | Ja, ab 2027 verkürzt sich Ihr Sicherheits-Fenster | Update auf 11.4 oder 11.5 einplanen |
| Sie betreiben bereits Drupal 11.4, 11.5 oder 12.0 | Ja, Sie sind bereits im neuen Rhythmus | Alle 6 Monate aktualisieren, sonst endet der Schutz nach 8 statt 12 Monaten |
| Sie nutzen ein anderes CMS, etwa WordPress oder TYPO3 | Nein, nicht direkt | Kein Handlungsbedarf aus diesem Artikel |

## Drupal 12 und der neue Release-Zyklus: was sich ändert

Drupal unterscheidet zwei Arten von Versionssprüngen. Eine Major-Version, etwa der Schritt von 11 auf 12, bringt grössere technische Umstellungen und neue Mindestanforderungen an PHP oder die Datenbank. Eine Minor-Version, etwa von 11.4 auf 11.5, bringt neue Funktionen, ohne bestehenden Code zu brechen. Major-Versionen erscheinen alle zwei Jahre, Minor-Versionen etwa alle sechs Monate, jeweils im Juni und Dezember.

Bisher erhielt jede Minor-Version 12 Monate Sicherheitsabdeckung, davon die letzten Monate nur noch für Sicherheitslücken, nicht mehr für andere Fehler (Security-only). Mit der Ankündigung PSA-2026-11-02 verkürzt das Drupal-Sicherheitsteam dieses Fenster für alle 2027 unterstützten Versionen auf 8 Monate: 6 Monate reguläre Fehlerbehebung, danach 2 Monate Security-only. Als Grund nennt das Team zwei Dinge: eine stark gestiegene Zahl an Sicherheitsmeldungen, die es mit den aktuellen Mitteln nicht mehr bewältigen kann, und das Ziel, den Backport-Aufwand, also das Nachpflegen von Sicherheitskorrekturen in ältere Versionen, um rund 30 Prozent zu senken.

Die Laufzeit der Major-Versionen selbst ändert sich nicht: Jede wird mindestens 4 Jahre unterstützt, mit Ende jeweils im Dezember. Drupal 10 endet am 9. Dezember 2026, Drupal 11 Anfang Dezember 2028, Drupal 12 Anfang Dezember 2030.

Drupal 12 setzt zudem höhere Plattform-Anforderungen voraus: PHP 8.5 als Minimum, MariaDB mindestens 10.11, PostgreSQL mindestens 18, und PHP muss mit Argon2-Unterstützung kompiliert sein, weil Argon2id zum Standard für das Hashing von Passwörtern wird.

## Wer das löst und was es kostet

**Drupal-10-Websites müssen vor dem 9. Dezember 2026 umziehen.** Das übernimmt die Stelle, die die Website technisch betreut, intern oder eine Agentur. Der Aufwand hängt vom Custom-Code und den eingesetzten Modulen ab, realistisch sind Tage bis Wochen pro Projekt.

**Das Sicherheits-Fenster schrumpft von 12 auf 8 Monate.** Das betrifft, wer den Wartungsvertrag verantwortet. Der Update-Rhythmus muss von "einmal jährlich möglich" auf "zweimal jährlich nötig" umgestellt werden, das bedeutet 1 bis 2 zusätzliche Update-Zyklen pro Jahr im Wartungsbudget.

**Die Plattform-Anforderungen steigen.** Das prüft der Hosting-Provider oder das Infrastruktur-Team: PHP-Version, Datenbank-Version und Argon2-Unterstützung müssen vor dem Umstieg auf Drupal 12 passen. Der Aufwand liegt meist im bestehenden Hosting-Paket, braucht aber Vorlaufzeit.

## Entscheidungen für die nächsten Wochen

1. Diese Woche klären, welche Drupal-Version aktuell läuft: 10, eine frühe 11er-Version, oder bereits 11.4/12.0.
2. Bei Drupal 10: bis Ende November 2026 den Migrationspartner kontaktieren. Das Zeitfenster bis zum 9. Dezember ist kurz.
3. Bis Ende 2026: den Wartungsvertrag auf den neuen 6-Monats-Rhythmus prüfen und anpassen lassen, statt wie bisher auf einen jährlichen Zyklus zu setzen.
4. Vor jedem Update: PHP- und Datenbank-Version mit dem Hosting-Provider abgleichen, besonders im Hinblick auf Drupal 12.

## Häufige Fragen

### Was ist der Unterschied zwischen einer Major- und einer Minor-Version?

Eine Major-Version wie Drupal 12 bringt grössere technische Umstellungen und neue Mindestanforderungen. Eine Minor-Version wie 11.5 bringt neue Funktionen, ohne dass bestehender Code angepasst werden muss.

### Muss ich sofort von Drupal 11 auf Drupal 12 wechseln?

Nein. Drupal 11 wird bis Anfang Dezember 2028 unterstützt. Wichtig ist, innerhalb von Drupal 11 auf dem aktuellen Minor-Stand zu bleiben, damit das Sicherheits-Fenster nicht abläuft.

### Was passiert, wenn meine Website nach dem 9. Dezember 2026 noch auf Drupal 10 läuft?

Sie erhält keine Sicherheitsupdates mehr. Bekannt werdende Sicherheitslücken bleiben dann offen, bis Sie auf Drupal 11 oder 12 umgestiegen sind.

### Warum hat Drupal das Sicherheits-Fenster verkürzt?

Laut PSA-2026-11-02 ist die Zahl der gemeldeten Sicherheitslücken stark gestiegen, bei gleichbleibenden Mitteln des Sicherheitsteams. Die Verkürzung soll den Aufwand für das Nachpflegen von Korrekturen in ältere Versionen um rund 30 Prozent senken.

## Quellen

- [Drupal core release schedule](https://www.drupal.org/about/core/policies/core-release-cycles/schedule)
- [PSA-2026-11-02: Security support for Drupal core minor versions reduced to 8 months](https://www.drupal.org/psa-2026-11-02)
- [Announcing Drupal 12.0.0 platform requirements](https://www.drupal.org/about/core/blog/announcing-drupal-1200-platform-requirements)

Ähnliche Artikel: [Was ist Drupal?](https://netnode.ch/de/blog/was-ist-drupal) erklärt die Grundlagen, [Neue Beta-Version von Drupal 11.0.0 veröffentlicht](https://netnode.ch/de/blog/neue-beta-version-von-drupal-1100-veroeffentlicht) deckt die technischen Änderungen der letzten Major-Version ab, dieser Artikel hier den Release-Zyklus und seine Folgen für die Planung.
<!-- field_markdown ENDE -->

<!-- was_die_redaktion_nicht_im_text_loesen_kann BEGINN -->
### Was die Redaktion nicht im Text lösen kann

- Die Zieldaten "9. Dezember 2026" (Drupal-10-EOL) und "7. Dezember 2026" (Drupal-12-Release) sind Wochenangaben von drupal.org und sollten am Publikationstag gegen https://www.drupal.org/about/core/policies/core-release-cycles/schedule nachgeprüft werden, falls sich der Termin vor der eigentlichen Veröffentlichung noch verschiebt.
- Backlink von einem bestehenden Node: "Was ist Drupal?" (https://netnode.ch/de/blog/was-ist-drupal) sollte idealerweise nachträglich auf diesen neuen Artikel verlinken, das ist eine Änderung an einem bereits publizierten Node, nicht an diesem Text.
- field_article_links (Sidebar) ist nicht befüllt, das ordnet Sven den Quellen/Links zu, die er für SEO/GEO für sinnvoll hält.
- Sprachform: Ich habe Sie-Form gewählt, weil der direkte Vorgängerartikel zu Drupal 11 ebenfalls Sie-Form nutzt und die Entscheider-Posts auf netnode.ch durchgehend Sie-Form verwenden (siehe Log). Die Rollenvorgabe sieht Du-Form als Standard vor, der Auftrag selbst (task.md) macht dazu keine Angabe. Dieser Abweich-Entscheid liegt bei einem Menschen, falls er anders gewünscht wird.
<!-- was_die_redaktion_nicht_im_text_loesen_kann ENDE -->
