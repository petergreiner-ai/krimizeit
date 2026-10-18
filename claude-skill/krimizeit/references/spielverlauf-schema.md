# Datenschema: config.json und spielVerlauf.json

Immer zuerst die echten Dateien des Falls ansehen und einen gleichartigen, funktionierenden
Eintrag als Vorbild nehmen. Diese Referenz erklärt die Felder – das gewachsene Format des
jeweiligen Falls hat Vorrang.

## config.json

Array von Agenten (= Figuren). Reihenfolge zählt: `configAgent[0]` ist die „erste Figur"
(relevant für `spielstandNurErsteFigur`). Vor jeder Session PATCHt `eleven.js`
(`updateAgent`) den Agenten mit genau diesem Objekt.

```json
{
  "agent_id": "agent_…",          // ElevenLabs-Agent; mehrere Figuren dürfen sich EINEN teilen
  "name": "teenager",              // Figurname = Basis der status-Keys (teenager_1, teenager_2 …)
  "conversation_config": {
    "tts": { "model_id": "eleven_v3_conversational", "voice_id": "…", "stability": 0.25,
             "speed": 1.03, "similarity_boost": 0.8, "optimize_streaming_latency": 4 },
    "agent": { "prompt": { "llm": "qwen35-397b-a17b", "temperature": 0 } }
  }
}
```

Teilen sich alle Figuren eines Falls **einen** `agent_id`, gelten die im Dashboard am
Agenten hinterlegten **Client-Tools** für alle Figuren dieses Falls. Der System-Prompt und
die Begrüßung kommen zur Laufzeit als **dynamic variables** (`my_custom_instruction`,
`begruessung`); das First-Message-Feld des Agenten muss also `{{begruessung}}`, das
System-Prompt-Feld `{{my_custom_instruction}}` sein – sonst spricht der Agent ein statisches
Dashboard-First-Message (häufige Ursache für „falsche Begrüßung").

## spielVerlauf.json

Ein Array. **`daten[0]` = Kopf/Settings**, alle weiteren Elemente sind **Einträge** (status,
szene, delay).

### Kopf `daten[0]` (von `ladeSettings` gelesen)

| Feld | Wirkung |
|---|---|
| `ueberschrift` | Titel |
| `elevenPrompt` | Stimm-/Stilhinweis, wird jedem Gesprächsprompt vorangestellt |
| `toolPrompt` | allgemeine Tool-Meta-Regeln (ans Prompt-Ende, s. u.) |
| `toolPromptVorne` (bool) | stellt `toolPrompt` zusätzlich VOR die Rolle (`allgText`), Trigger bleiben am Ende |
| `poi` | zentrale POI-Deklaration je Bild: `[["bild.png",[x,y,r,text,verzoeg,zusatz], …], …]` |
| `figurenAnordnung` | Standorte der Figuren je Bild, Aufbau wie `poi`: `[["bild.png",["sherlock",0.5,0.5], …], …]`. x/y sind **Anteile des sichtbaren Fensters** (0..1) und meinen die **Mitte** der Figur. Erscheint das Bild als Hintergrund, wandern die genannten Figuren in 1 s dorthin, alle übrigen auf ihre normalen Plätze. Ohne Eintrag für ein Bild bleibt alles wie bisher. Im Spiel per **Strg+Alt+S** aus den aktuellen Positionen der sichtbaren Figuren (opacity > 0) schreibbar — das braucht einen PHP-Server (`speichereAnordnung.php`, nicht Teil der GitHub-Pages-Fassung); ohne ihn die Werte von Hand eintragen. |
| `notizSofort` (bool) | Notausgang: Notizen aus `suchwort`-Treffern wieder **sofort** schreiben. Default (Feld weg) = Notiz erst, wenn die Figur ausgesprochen hat |
| `schluesselwortImTranskript` (bool) | Schlüsselwörter am Gesprächsende im **Transkript** suchen (sh2), statt über Tool |
| `spielstandNurErsteFigur` (bool) | Spielstand nur über die erste Figur speichern (sh2) |
| `figurAktivierungPruefen` (bool, default true) | beim Aktivieren prüfen, ob der Ziel-Eintrag existiert (cb-Konvention) |

### Eintragstypen

Ein Eintrag mit **`status`** ist ein Klick-/Speicherpunkt einer Figur; sein Name ist
`"<figur>_<n>"`. Klickt der Nutzer die Figur, sucht `startCall` den Eintrag
`<figur>_<aktuellerStatus>`. Zwei Ausprägungen:

**say – die Figur sagt etwas (kein Dialog):**
```json
{
  "status": "sherlock_2",
  "say": {
    "text": "Wir gehen rüber …",         // TTS-Text; ODER "datei.mp3" bzw. ["datei.mp3", 1] = Audio
    "sherlock_opacity": "0.5",
    "szene_wechseln": ["he1", "hauseingang.jpg", "stille", "1", false],
    "tipp": { "init": "10", "intervall": "5", "hinweis": ["…","…"] }
  },
  "szene_init": ["Haus.jpg", "stille", "1", false, ["sherlock_2", "1"]]
}
```

**convo – Dialog mit der Figur (ElevenLabs-Session):**
```json
{
  "status": "teenager_2",
  "convo": {
    "begruessung": "Was ist schon wieder?",        // String ODER Array (zufällig gewählt)
    "allgText": "Du bist ein verschlossenes Teenagermädchen …",   // Persona
    "my_custom_instruction": "Du weißt: '…'. Nur auf Erpressung stückweise …",  // Geheim-Infos
    "addText": "Benutze das Tool 'notiz_protokollieren' … / 'gespraech_beenden' mit dem Befehl 'Brechstange' …",
    "schluesselwort": [
      { "wort": "Brechstange", "teenager_opacity": "0",
        "sherlock_status": "4", "sherlock_opacity": "1", "drWatson_opacity": "0.5" }
    ],
    "tipp": { "init": "10", "intervall": "5", "hinweis": ["…"] },
    "transSlice": -15
  },
  "szene_init": ["hauseingang.jpg", "stille", "1", false, ["teenager_2", "1"]]
}
```

**szene – Szenen-Anker** (Ziel eines `szene_wechseln`, wird beim Wechsel ausgeführt):
```json
{ "szene": "he1", "sherlock_opacity": "0.5",
  "delay": { "delayT": "5", "audio": ["doorbell.mp3","1",false,false],
             "teenager_status": "1", "teenager_opacity": "1" } }
```

### Wichtige Feld-Bausteine (in vielen Einträgen)

- **`<figur>_status`** – setzt den Status einer Figur (welchen Eintrag ihr nächster Klick nutzt).
- **`<figur>_opacity`** – `0` unsichtbar · `0.5` sichtbar/inaktiv · `1` aktiv/klickbar ·
  **`>1` startet die Figur sofort automatisch** (`startCall`) – so schaltet die Story weiter.
- **`szene_init`** `[bild, audio|"stille", vol, loop, [status,"1"]]` – Hintergrund+Audio des
  Zustands und Speicherpunkt.
- **`szene_wechseln`** `[szeneId, bild, mp3|"stille", vol, loop]` – blendet Vorschau ein,
  nach Klick Szenenwechsel und Ausführen des `szene:<szeneId>`-Eintrags.
- **`say.text`** – String → TTS; `"x.mp3"`/`["x.mp3",vol]` → Audio abspielen.
- **`my_custom_instruction`** – String oder Array; ein Element in `[ausdruck]text`-Form wird
  nur übernommen, wenn `eval(ausdruck)` die Variable `entscheidung >= 1` setzt (z. B.
  `[entscheidung=spielstand[0]]…`). Platzhalter `XXX`/`forename`/`lastname`/`gender` werden
  durch den `userName` ersetzt.
- **`schluesselwort`** – Array `{wort, …Änderungen}`; die Änderungen werden angewendet, wenn
  der per Tool gesendete `Befehl` (bzw. das Transkript-Wort) auf `wort` passt.
- **`suchwort`** (in einem `schluesselwort`-Eintrag) – **Live-Transkript-Trigger**: Sagt die
  Figur (Agent) im Gespräch dieses Wort, führt die Engine den Eintrag SOFORT aus (Notiz,
  Spielstand, Szenenwechsel …) – **ohne** ElevenLabs-Tool. Zuverlässiger als ein LLM-Tool-Call,
  weil es am tatsächlich gesprochenen Text hängt. String **oder** Array (ein Treffer genügt,
  case-insensitiv, Teilstring). Feuert pro Gespräch nur einmal. Läuft über `onMessage` in
  `startSession` (`source !== "user"`); nur Einträge MIT `suchwort` werden überwacht, alle
  anderen unverändert. `wort` kann zusätzlich dranbleiben (dann auch per Tool auslösbar).
  **Zahlen werden automatisch erkannt**: Die Engine vergleicht zusätzlich eine Fassung, in der
  ausgesprochene Zahlwörter als Ziffern stehen (`dreiundzwanzig` → `23`, `sechs Uhr fünfundzwanzig`
  → `6 uhr 25`, `6:25` → `6 uhr 25`) – die ausgeschriebene Variante muss also **nicht** ins Array.
  Der Zahl-Vergleich verlangt Wortgrenzen (`13 uhr` löst `3 Uhr` nicht aus); Ordinalzahlen
  (`im vierten Abteil`) bleiben absichtlich außen vor. Die **Notiz** eines `suchwort`-Treffers
  wird erst geschrieben, wenn die Figur ausgesprochen hat (sonst liest der Spieler sie vorweg);
  alle anderen Aktionen des Eintrags laufen sofort. Abschaltbar über `notizSofort` in `daten[0]`.
- weitere in `eintragAendern`: `audio`, `erzaehler`, `abspann` `[text,dauer,…]`, `bild_neu`
  `[name,datei,agent]`, `szene_neu`, `poi`, `spielstand` (eval-String), `bedingterSpielstand`
  `[{bedingung,…}]`, `buch`, `notiz` `[figur,status,text,extra]`, `startCall`, `vorhang`,
  `resetTranskript`, `scale` (Figur-Zoom im Gespräch).

### buch – Buch-Overlay (durchblätterbare Bilder)

Zeigt ein anklickbares Buch über der Szene. Als Feld in einem `schluesselwort`-Eintrag (oder
jedem `eintragAendern`-Eintrag). Array: **erstes Element = Hintergrund**, danach je `bild` eine Seite:

```json
"buch": [
  { "hintergrundbild": "buch.png" },
  { "bild": "titel.png" },
  { "bild": "plan.png", "audio": ["sprecher.mp3","0.8",false,false] },
  { "bild": "liste.png", "audio": ["sprecher2.mp3","0.8",false,false],
    "notiz": ["Quelle","","Zeile 1\nZeile 2","f"] }
]
```

- Pfade: `hintergrundbild`/`bild` werden über `basis + imgEleven/` aufgelöst → alle Dateien
  (auch `buch.png`) müssen im **Fallordner** liegen (buch.png ist sonst nur im Root/cb → kopieren).
- **Pro Seite** feuern `audio` (spielt beim Aufschlagen) und `notiz` `[auskunft,status,text,add]`
  (Notizbuch-Eintrag) – extras.js ruft beim Umblättern `eintragAendern(seite)`. `notiz` dedupliziert
  über den Text. `add`: `f`=fett, `-`=durchgestrichen, `k`=kursiv, `x`=versteckt; `\n` im Notiztext
  wird als Umbruch dargestellt (`white-space: pre-line`).
- **Mittendrin auslösen** über `befehl_senden` (Gespräch läuft weiter), Figur mit `skip_turn`
  still halten (Nutzer liest in Ruhe). Zeigt der Eintrag nur das Buch, keine Status-/Opacity-
  Änderungen setzen. Seiten-Audios mit der passenden Figuren-Stimme vorproduzieren (s. `audio-und-deploy.md`).

### Figur-Portrait & Klick-Video

Existiert zu `<name>.png` ein **`<name>-p.png`** (Portrait), aktiviert die Engine automatisch die
Klick-Video-Logik: beim Klick läuft `<name>.mp4` als Aktivierungs-Video, danach steht `<name>.png`.
Gilt auch für per `bild_neu` getauschte Bilder (`<stamm>-p.png`/`<stamm>.mp4`). **Gotcha:** liegt
eine überflüssige `<name>-p.png` (+ `<name>.mp4`) herum – gern nur auf dem Server, nicht lokal –
spielt eine Figur ungewollt ein Video. Dann **diese Dateien entfernen**, nicht die Engine ändern
(der Portrait-Mechanismus wird von cb/weigand/russoPrivat gebraucht).

## URL-Parameter (index2.html)

`?fall=<ordner>` Fall · `userName=Vor%20Nach` Spielername · `<figur>=<status>` Startstatus
einer Figur (Direkteinstieg zum Testen, z. B. `teenager=2`) · `szene=<id>` Direkteinstieg
in eine Szene.

**Gotcha – Opacity beim Direkteinstieg `?<figur>=<status>`:** `initAgents` setzt beim Start
jede Figur OHNE eigenen `?<figur>=`-Parameter hart auf `opacity 0` und wendet danach nur die
opacity-Paare an, die **im `szene_init`-Array** des Start-Eintrags stehen
(`[bild, audio, vol, loop, ["figur_status","0.5"]]`). Die separaten `<figur>_opacity`-**Felder
auf Eintragsebene** liest beim Direkteinstieg NIEMAND – die verarbeitet nur `eintragAendern`
im normalen Verlauf. Folge: Eine Begleitfigur (z. B. `drwatson_opacity: "0.5"` neben
`szene_init`) bleibt beim Testeinstieg **unsichtbar**, obwohl sie im normalen Spiel korrekt
mit halber Deckkraft erscheint. Die per URL gestartete Figur selbst wird auf `1` gesetzt und
ist deshalb da. Fix ohne Engine-Eingriff: das Paar **ins szene_init-Array einbetten**, z. B.
`"szene_init": [ "flur.png", "thema2.mp3", "0.2", true, [ "drwatson_2", "0.5" ] ]`. Wirkt nur
beim Direkteinstieg (im normalen Verlauf ignoriert). Nebeneffekt: der Code setzt aus dem
`_2` zusätzlich `status["drwatson"]="2"` – einen gültigen, plausiblen Status wählen.
