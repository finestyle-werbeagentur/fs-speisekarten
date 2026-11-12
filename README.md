# Finestyle Speisekarten

WordPress-Plugin von Finestyle: Speisekarte als PDF hochladen → wird automatisch als sauberes HTML auf der Seite ausgegeben.

## Neue Version veröffentlichen
1. Versionsnummer in `fs-speisekarten.php` an beiden Stellen erhöhen (Kopf `Version:` und `FS_SK_VERSION`).
2. Änderungen committen und pushen.
3. Tag setzen: `git tag v1.5.1 && git push --tags`

GitHub baut dann automatisch `fs-speisekarten.zip` und legt ein Release an. Alle Seiten mit dem Plugin zeigen anschließend „Update verfügbar“ – auch in MainWP.
