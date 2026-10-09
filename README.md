# NEON GRID – GTA2-Style Top-Down Prototype

Ein spielbarer 2D-Top-Down-Action-Prototyp im Stil von GTA2. Keine externen Assets: Alles wird mit Canvas-Formen gezeichnet, Sounds werden per WebAudio erzeugt.

**Tech-Stack:** TypeScript + Vite + natives HTML5-Canvas-2D (keine Game-Engine) · Electron + electron-builder für den Windows-11-Installer.

## Schnellstart

```bash
npm install
npm run dev          # Browser: http://localhost:5173
npm run desktop      # als Desktop-App (Electron)
npm run dist:win     # Windows-Installer -> release/NeonGrid-Setup-<version>.exe
```

### Windows-11-Installer

* `npm run dist:win` erzeugt einen NSIS-Installer (x64) mit Wahl des Installationsordners, Desktop- und Startmenü-Verknüpfung und Deinstaller.
  * Unter Windows läuft der Befehl direkt.
  * Unter Linux braucht der Build `wine` (64- und 32-Bit).
* Der GitHub-Actions-Workflow `.github/workflows/build-windows.yml` baut den Installer bei jedem Push auf einem `windows-latest`-Runner. Das Ergebnis liegt als Artifact **NeonGrid-Windows-Installer** im jeweiligen Actions-Lauf. Wenn du einen Tag `v*` pushst, wird die `.exe` zusätzlich an das GitHub-Release angehängt.
* Der Installer ist nicht signiert. Windows SmartScreen zeigt deshalb beim ersten Start „Der Computer wurde durch Windows geschützt“. Klicke auf **Weitere Informationen → Trotzdem ausführen**.
* In der Desktop-Version schaltet **F11** den Vollbildmodus um.

## Steuerung

Maus + Tastatur und Xbox-Controller funktionieren gleichzeitig. Das HUD zeigt die Tastenhinweise passend zum zuletzt benutzten Gerät.

| Aktion | Maus + Tastatur | Xbox-Controller |
|---|---|---|
| Laufen / Lenken | W A S D / Pfeile | Linker Stick / D-Pad |
| Zielen | Maus | Rechter Stick (mit Aim-Assist) |
| Schießen | Linke Maustaste / Strg | RT (im Auto: X) |
| Sprinten | Shift | A |
| Gas / Bremse + Rückwärts | W / S | RT / LT (analog) |
| Handbremse (Drift) | Leertaste | A |
| Nitro | Shift | B |
| Ein-/Aussteigen, Telefon | F / Enter | Y |
| Waffe wechseln | Q / E, Mausrad, 1–5 | LB / RB |
| Pause / Steuerung | Esc oder P / H | Start / Back |

Bei Treffern, Crashs und Explosionen vibriert der Controller (Rumble).

## Features

* **Kamera:** folgt dem Spieler weich, schaut in Fahrtrichtung voraus, zoomt bei hoher Geschwindigkeit heraus (wie in GTA2) und wackelt bei Treffern und Explosionen.
* **Stadt:** prozedurale Tilemap mit 86×86 Kacheln und 6×6 Blöcken. Es gibt Straßen mit Spuren, Mittellinien und Zebrastreifen, Gehwege, Gassen, Parks mit Bäumen und Plätze mit Brunnen. Gebäude werden pseudo-3D gezeichnet: Die Dächer sind perspektivisch versetzt, sodass man die Wände sieht.
* **Fahrzeugphysik:** arcadig mit Beschleunigung, Bremse, Rückwärtsgang, geschwindigkeitsabhängiger Lenkung, Seitenhaftung und Handbremsen-Drift. Dazu kommen Kollisionen mit Impulsen und Schaden, Reifenspuren, Rauch, Brand und Explosion. Acht Fahrzeugtypen, darunter Polizei, SWAT und Geldtransporter.
* **KI:**
  * Passanten laufen umher und flüchten bei Schüssen.
  * Der Verkehr hält die Spur (Rechtsverkehr), biegt an Kreuzungen ab, bremst vor Hindernissen, hupt und löst Deadlocks auf.
  * Fahrer geraten bei Schüssen in Panik, manche lassen ihr Auto stehen.
* **Waffen:** Fäuste, Pistole, Maschinenpistole und Schrotflinte, jeweils mit Projektilen, Reichweite, Streuung und Munition. Waffen und Munition findest du als Pickups.
* **Fahndungslevel (1–5 Sterne):**
  * Jedes Verbrechen erhöht die „Heat“.
  * Bei 1★ versuchen Polizisten zu Fuß, dich festzunehmen (BUSTED).
  * Ab 2★ schießen Cops, Streifenwagen jagen dich über ein BFS-Flow-Field durch das Straßennetz, rammen dich und setzen Beamte ab.
  * Ab 3★ tragen Cops Maschinenpistolen, ab 4★ kommen SWAT-Vans.
  * Bleibst du außer Sicht, sinkt das Level Stern für Stern. Die Sterne blinken, solange du unentdeckt bist.
* **Fraktionen:**
  * Neon Serpents, Iron Kings und Ghost Cartel liegen im Kreis miteinander im Krieg: Die Serpents hassen die Kings, die Kings das Cartel, das Cartel die Serpents.
  * Tötest du Mitglieder einer Gang, sinkt dein Respekt bei ihr und steigt bei ihrem Erzfeind.
  * Bei Respekt ≤ −30 greift dich die Gang an. Bei ≥ +30 gibt sie dir Deckung.
  * Jede Gang hat ihr eigenes Revier (Westen, Mitte, Osten).

### Eigene Ideen

1. **Drift-Nitro:** Driften baut eine Combo auf (bis x5). Das bringt Geld und lädt die Nitro-Leiste, Shift oder B zündet den Boost.
2. **EMP-Werfer:** Spezialwaffe, die Motoren im Umkreis 5 Sekunden lahmlegt (auch Streifenwagen!) und Personen kurz betäubt. Ideal, um Verfolgungsjagden zu beenden.
3. **Telefon-Jobs (☎):** In jedem Revier steht ein Telefon. Die Gangs vergeben drei Job-Typen:
   * **Hit:** 4 Rivalen ausschalten.
   * **Delivery:** einen Wagen in mindestens 40 % Zustand zu einem Abgabepunkt bringen.
   * **Drift-Show:** 2500 Drift-Punkte sammeln.

   Jeder Job hat ein Zeitlimit und bringt eine Belohnung. Gangs, die dich hassen, gehen nicht ans Telefon.
4. **Dynamische Stadt-Events:**
   * **Bandenkrieg:** Zwei verfeindete Gangs liefern sich eine Schießerei. Wenn du mitmischst, ändert sich dein Respekt.
   * **Gepanzerter Geldtransporter:** fährt durch die Stadt. Knackst du ihn, gibt es $2000 – und viel Fahndungslevel.

## Ordnerstruktur

```
index.html
vite.config.ts            relative base -> Build läuft auch über file:// (Electron)
electron/main.cjs         Electron-Hauptprozess (Fenster, F11-Vollbild)
build/icon.png|ico        App-Icon
src/
  main.ts                 Bootstrap
  config.ts               Konstanten, Waffen-, Fahrzeug-, Fraktions- und Wanted-Daten
  core/
    Game.ts               Game-Loop, Weltzustand, Systemverdrahtung, Respawn
    Input.ts              Tastatur/Maus + Gamepad -> einheitliche Controls
    Camera.ts             Follow-Kamera, Speed-Zoom, Screenshake
    Sound.ts              synthetische WebAudio-Effekte + Sirene
    math.ts               Helfer, Seeded RNG
  world/
    City.ts               Tilemap-Generator, Kollision, Spurgeometrie, Flow-Field
    CityRenderer.ts       Boden + Pseudo-3D-Gebäude
  entities/               Ped, Vehicle, Projectile, Pickup
  systems/
    PlayerController.ts   Laufen/Zielen/Schießen, Ein-/Aussteigen, Fahren
    VehicleSystem.ts      Fahrphysik, Drift/Nitro, Kollisionen, Rendering
    AIManager.ts          Spawning, Passanten, Gangs, Cops, Verkehr, Polizeifahrten
    CombatSystem.ts       Waffen, Projektile, Schaden, Explosionen, EMP, Pickups
    WantedSystem.ts       Heat, Sterne, Sichtprüfung, Abbau
    FactionSystem.ts      Respekt-System
    MissionSystem.ts      Telefon-Jobs + Stadt-Events
    Particles.ts          Partikel + Decals (Reifenspuren, Blut, Brandflecken)
  ui/HUD.ts               HUD, Minimap, Zielpfeil, Overlays
```

In der Browser-Konsole erreichst du den gesamten Spielzustand über `window.game`.
