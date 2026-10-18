---
name: krimizeit
description: >-
  Baut und pflegt die interaktiven Sprach-Krimispiele der KrimiZeit-Engine
  (dieses Repository) - eine ElevenLabs-Conversational-AI-Engine, in der
  der Nutzer per Stimme mit Figuren (Sherlock, Watson u. a.) spricht und den Fall löst.
  Jedes Spiel liegt in einem Unterordner (rb, sh2, zz …) mit config.json
  (Agenten/Stimmen) und spielVerlauf.json (Story-Ablauf). IMMER verwenden, wenn der Nutzer
  ein KrimiZeit-Spiel/einen Fall anlegen, erweitern oder umbauen will, eine spielVerlauf.json
  oder config.json bearbeitet, eine Figur/Szene/ein Gespräch (convo, say, szene) hinzufügt
  oder ändert, die Story weiterschalten oder verzweigen will (Schlüsselwörter), an eleven.js
  arbeitet, die ElevenLabs-Client-Tools (notiz_protokollieren, gespraech_beenden,
  befehl_senden; früher ergebnisGespraech) einbaut oder debuggt, Tool-Aufrufe unzuverlässig
  auslösen ("Tool wird nicht aufgerufen"), Figuren-Prompts (allgText, my_custom_instruction,
  addText, toolPrompt) schreibt, oder Begriffe wie fall=, Denkblase/Tipp, POI, Abspann,
  Spielstand, Notizbuch im KrimiZeit-Kontext fallen. Auch bei vagen Aufrufen wie "mach den
  neuen Fall", "die Figur soll X sagen", "warum schaltet die Szene nicht weiter".
---

# KrimiZeit – Sprach-Krimispiele bauen und pflegen

Eine Engine für Audio-Krimis: Der Nutzer spielt Ermittler und **spricht per ElevenLabs
Voice-Session mit Figuren**. Er befragt sie, findet Hinweise, und die Geschichte schaltet
über Schlüsselwörter zur nächsten Szene weiter. Alles wird datengetrieben aus zwei
JSON-Dateien je Fall gesteuert; die Engine selbst ist eine gemeinsame `eleven.js`.

## Aufbau

```
KrimiZeit/   (Repository-Wurzel)
  eleven.js            gemeinsame Engine (ALLE Fälle) – mit Vorsicht ändern
  extras.js            Buch/Notizbuch/Overlays
  index2.html          Einstieg (?fall=<ordner>&userName=Vor%20Nach&<figur>=<status>)
  imgEleven\           GETEILTE UI-Assets (denk.png, buch.png, Pfeile, UI-Sounds)
  <fall>\              ein Fall je Ordner: cb, sh, sh2, rb, zz, hg …
    config.json        Agenten: agent_id, name, Stimme (voice_id), LLM
    spielVerlauf.json  Story-Ablauf (Header + Einträge)
    imgEleven\         fallspezifische Figuren-/Szenen-/Audio-Assets
```

`?fall=sh` wählt den Ordner; ohne Parameter ist `cb` die Vorgabe. `userName` (z. B.
`Max%20Mustermann`) füllt in Prompts `forename`/`lastname`/`gender`/`XXX`.

## Grundhaltung

1. **Zuerst die Dateien des Falls lesen.** Das Schema ist gewachsen und variiert je Fall
   (z. B. sh2 nutzt Transkript-Suche statt Tool). Nie ein gemerktes Schema blind anwenden –
   am aktuellen Inhalt und an einem gleichartigen, bereits funktionierenden Eintrag
   desselben Falls orientieren.
2. **Struktur exakt spiegeln.** Neue Figuren/Szenen/Gespräche im Stil der vorhandenen
   Einträge anlegen (Feldnamen, Reihenfolge, `\n`-Escapes in Prompt-Strings, Einrückung).
3. **Chirurgisch mit dem Edit-Tool editieren, nicht die JSON neu serialisieren.** Ein
   `json.dump` zerstört Formatierung/Reihenfolge. Für viele gleichartige Ersetzungen ein
   kleines Text-`replace`-Skript, das nur die Zielstellen anfasst.
4. **eleven.js ist geteilt.** Änderungen daran betreffen ALLE Fälle. Neues Verhalten immer
   **rückwärtskompatibel** und – wo es nur einen Fall betrifft – über ein Flag in
   `daten[0]` schalten (Default = altes Verhalten), damit cb/sh2 unberührt bleiben.
5. **Nie ein Spiel „veröffentlichen"** und keine JSON-Dateien zum manuellen Import
   erzeugen – direkt in den Falldateien arbeiten.
6. **Nach jeder Änderung validieren** (siehe unten) und dem Nutzer kurz zusammenfassen,
   was sich geändert hat und was er ggf. in ElevenLabs noch anpassen muss.

## Das Tool-System (Kern)

Figuren-Gespräche laufen über ElevenLabs **Client-Tools**. Die Tool-*Schemas* liegen im
ElevenLabs-Dashboard am Agenten; die *Implementierung* steckt in `eleven.js` unter
`clientTools`. Aktuelles, sauberes Set (sh):

| Tool | Parameter (ElevenLabs) | Wirkung |
|---|---|---|
| `notiz_protokollieren` | `notiz_text` (string) | Ermittlungs-Notiz festhalten (kein Szenenwechsel) |
| `gespraech_beenden` | `Befehl` (string, opt.), `Delay` (int, opt.) | Gespräch beenden; **mit `Befehl`** dabei die Szene weiterschalten (Schlüsselwort), **ohne** nur beenden; `Delay` = Sekunden Verzögerung |
| `befehl_senden` | `Befehl` (string) | Weiterschalten/Enthüllung, **Gespräch läuft weiter** (Mid-Session; cb-Variante, sh2-Reveals, Buch mittendrin) |
| `skip_turn` | – (ElevenLabs-**System-Tool**) | Agent überspringt seinen Sprech-Zug (bleibt still). Am Agenten aktivieren; nach `gespraech_beenden` bzw. Buch-Anzeige, damit die Figur nicht weiterredet |

Legacy: **`ergebnisGespraech(message)`** – ein Tool mit kodiertem String (`0…`=beenden,
`1…`=Mid-Session-Schalten, Text ohne Ziffer=Notiz). cb und sh2 nutzen das noch; es bleibt
in `eleven.js` unterstützt. **Neue Fälle** mit dem klaren 3-Tool-Set bauen.

`Befehl`/Schlüsselwort steuert den Szenenwechsel: Der gesendete `Befehl` muss dem `wort`
eines `schluesselwort`-Eintrags des aktuellen Gesprächs entsprechen (tolerant gegen
Groß-/Kleinschreibung & Sonderzeichen, aber der Wortstamm muss stimmen).

Die genaue Mechanik (wie die Tools in `eleven.js` verdrahtet sind, robustes Parameter-Ziehen,
`safeEndSession`) steht in `references/tools-und-prompts.md`. Das vollständige Datenschema
(alle Eintragstypen und Header-Flags) in `references/spielverlauf-schema.md`. **Beide vor
größeren Umbauten lesen.** Audio-Vorproduktion (`say` als MP3, TTS-Erzeugung) steht in `references/audio.md`.

## Prompts zuverlässig schreiben

- **Meta-Regel „Tools sind kein Sprechen"** gehört als Rahmen VOR die Rolle, damit sie eine
  passive/wortkarge Persona nicht unterdrückt. Dafür gibt es das Header-Flag
  `toolPromptVorne: true` (stellt `toolPrompt` vor `allgText`). Konkrete Auslöser (`addText`)
  bleiben am ENDE des Prompts (Recency).
- **Stärkster Hebel ist die Tool-Beschreibung in ElevenLabs**, nicht der System-Prompt:
  die Auslöse-Bedingung dort eintragen (z. B. „Aufrufen, sobald ein Täter-Detail verraten wird").
- Trigger, die an **Nutzer-Eingaben** hängen, sind zuverlässiger als Selbstbeobachtung
  („sobald DU X sagst"). Trigger-Last je Gespräch niedrig halten.
- Keine `skip_turn`-Ketten nötig – `gespraech_beenden` beendet selbst sauber.

Details und Formulierungsvorlagen in `references/tools-und-prompts.md`.

## Typische Aufgaben

- **Fall auf das neue Tool-Set umstellen:** alle `ergebnisGespraech`-`addText` ersetzen –
  Notizen → `notiz_protokollieren`, End+Weiterschalten → `gespraech_beenden` mit `Befehl`,
  reines Ende → `gespraech_beenden` ohne Argument. `schluesselwort`-Einträge bleiben
  unverändert (sie sind das Ziel des Befehls). `toolPromptVorne` setzen. Prüfen, dass die
  drei Tools am ElevenLabs-Agenten des Falls hängen.
- **Figur/Szene/Gespräch ergänzen:** neuen Eintrag nach Vorbild anlegen, `status`-Namen
  konsistent (`<figur>_<n>`), Figur in `config.json` mit Stimme hinterlegen.
- **`say`-Texte als feste MP3 vorproduzieren** (statt Live-TTS): MP3 per ElevenLabs-API mit
  der Figuren-Stimme erzeugen, in `<fall>/imgEleven/` ablegen, `say.text` auf
  `[ "datei.mp3", 1.0 ]` umstellen. Details in `references/audio.md`.
- **Buch-Overlay einbauen** (durchblätterbare Bilder mit Seiten-Audio/-Notiz, cb/gästebuch):
  `buch`-Feld in einen `schluesselwort`-Eintrag, mittendrin über `befehl_senden` auslösen und
  die Figur per `skip_turn` still halten; `buch.png` in den Fallordner kopieren. Schema in
  `references/spielverlauf-schema.md`, Tools in `references/tools-und-prompts.md`.
- **Fall von Transkript-Suche auf Tools umstellen** (`schluesselwortImTranskript: false`,
  jedes Schlüsselwort tool-getrieben): Muster in `references/tools-und-prompts.md`.
- **„Szene schaltet nicht weiter":** meist stimmt `Befehl` ≠ `wort` nicht überein, das Tool
  hängt nicht am Agenten, oder der Prompt nennt das falsche Tool. In der Browser-Konsole
  zeigen `🚪/➡️/📝`-Logs den tatsächlichen Aufruf.

## Nach dem Editieren immer validieren

```bash
# JSON gültig?
powershell -Command "Get-Content -Raw '<fall>\spielVerlauf.json' | ConvertFrom-Json > $null; 'OK'"
# eleven.js syntaktisch ok (nach Engine-Änderungen)?
node --input-type=module --check < eleven.js
```

Bei Engine-Änderungen zusätzlich prüfen, dass keine **verwaiste Referenz** auf entfernte
Variablen/Tools bleibt (Grep) – `node --check` findet nur Syntax, keine undefinierten Namen.
Danach dem Nutzer die geänderten Stellen kompakt nennen und offene ElevenLabs-Schritte
(Tools am Agenten, Parameter-/Beschreibungstexte) ausdrücklich zur Gegenprüfung auflisten.
