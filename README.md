# Finestyle Speisekarten

WordPress-Plugin von Finestyle: Speisekarte als PDF hochladen → wird automatisch als sauberes HTML auf der Seite ausgegeben.

## Neue Version veröffentlichen
1. Versionsnummer in `fs-speisekarten.php` an beiden Stellen erhöhen (Kopf `Version:` und `FS_SK_VERSION`).
2. In `CHANGELOG.md` einen Abschnitt `## 1.x.y` mit den Änderungen ergänzen.
3. Nach `main` pushen.

GitHub baut dann automatisch `fs-speisekarten.zip` und legt ein Release an. Alle Seiten mit dem Plugin zeigen anschließend „Update verfügbar“ – auch in MainWP.

## Google-Unternehmensprofil

Jede Website gibt ihre veröffentlichten Karten im Google-Format aus:

- Alle Karten: `https://kunde.de/wp-json/fs-speisekarten/v1/google`
- Eine Karte: `https://kunde.de/wp-json/fs-speisekarten/v1/google/{id}`

Die Antwort enthält `foodMenus` (geht unverändert per `PATCH …/locations/{id}/foodMenus` an Google), dazu `hash` (ändert sich nur, wenn sich die Karte ändert) und `cards` (Übersicht). Karten ohne Häkchen „Karte an Google senden“ werden ausgelassen, Gerichte ohne Preis auch (Google verlangt einen Preis).

**Auslesen geändert?** Nur wenn sich `assets/parser.js` ändert, auch `FS_SK_PARSER` in `fs-speisekarten.php` hochsetzen. Dann werden nach dem Update alle Karten zum Neu-Auslesen vorgemerkt – sonst nicht.

**Automatisch an Google:** Nach dem Speichern einer veröffentlichten Karte meldet sich die Website beim Kundenpanel (`FS_SK_PANEL_PING`, Standard `https://panel.finestyle.eu/google.php?a=ping`). Das Panel holt die Karte über `/wp-json/fs-speisekarten/v1/google` und sendet sie an das zugeordnete Google-Profil. Abschalten pro Website: `define( 'FS_SK_PANEL_PING', '' );` in der wp-config.php.
