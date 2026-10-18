# Audio vorproduzieren (TTS)

## `say`-Texte als feste MP3 statt Live-TTS

Skript-Monologe stehen in `say`-Einträgen (nicht `convo` – die sind interaktiv und bleiben
live). Die Engine kann einen `say` **entweder** live über ElevenLabs sprechen **oder** eine
fertige MP3 aus `imgEleven/` abspielen. Entscheidend ist der Wert von `say.text`
(eleven.js, Funktion `zeigeEintrag`,
Block „Sprache abspielen"):

| `say.text` | Verhalten |
|---|---|
| `"Normaler Satz."` | Live-TTS über `speakWithElevenLabs` (Modell seit v57 `eleven_v4_turbo`) |
| `"datei.mp3"` | spielt `imgEleven/datei.mp3`, Lautstärke 1 |
| `[ "datei.mp3", 1.0 ]` | spielt `imgEleven/datei.mp3` mit der angegebenen Lautstärke |

**Konvention:** immer die **Array-Form** `[ "datei.mp3", 1.0 ]`.
Dateinamen im cb-Stil camelCase nach dem Satzanfang (`esIstEingebrochen.mp3`,
`werWarEs.mp3`), abgelegt im `imgEleven/`-Ordner des jeweiligen Falls.

**NIEMALS `say`-Texte mit Laufzeit-Platzhaltern vertonen.** Enthält ein `say.text` einen
Platzhalter – **`XXX`**, `forename`, `lastname`, `gender` – bleibt er **Live-TTS-String**
und wird NICHT in eine MP3 umgewandelt. Diese Platzhalter ersetzt die Engine erst zur
Laufzeit durch den Spielernamen (`userName`); eine vorproduzierte MP3 würde stattdessen
starr „XXX" o. Ä. vorsprechen. Vor dem Vertonen also die `say.text` filtern
(`grep -nE '"text":.*(XXX|forename|lastname|gender)'`) und diese Einträge auslassen.

Die Platzhalter-Ersetzung (`.replace("XXX", userName)…`) macht `eleven.js` im **say-Live-TTS**
(String-Zweig vor `speakWithElevenLabs`), im **convo**-Prompt und beim **erzaehler** – aber
NICHT im MP3-Zweig. Ein Platzhalter im `say.text` bleibt also nur dann korrekt, wenn der Text
Live-TTS-String bleibt. (`.replace("XXX", …)` ersetzt nur das ERSTE Vorkommen – bei mehreren
XXX in einem Text greift nur das erste.) Beim Cache-Busting nach `eleven.js`-Änderungen die
`?v=`-Query in `index2.html` hochzählen (`eleven.js?v=N`), sonst zieht der Browser die alte Datei.

**Version-Bump immer an VIER Stellen synchron** (ES-Module: unterschiedliche `?v=` = zwei
getrennte Modul-Instanzen → gemeinsamer State `daten`/`notizen`/`status` bricht):
`index2.html` lädt `eleven.js?v=N` **und** `extras.js?v=N`; zusätzlich importieren sich beide
gegenseitig – `eleven.js` Zeile 6 `from './extras.js?v=N'`, `extras.js` Zeile 1
`from './eleven.js?v=N'`. Nach jedem Bump prüfen: `grep -rnE '\?v=' index2.html eleven.js extras.js`
(das `?v=2` beim Bild-`src` in eleven.js ist ein separater Bild-Cache-Buster, nicht mitzählen).

## MP3 mit der Figuren-Stimme erzeugen

- **API-Schlüssel:** dein eigener ElevenLabs-Schlüssel (für Skripte z. B. aus der Umgebungsvariable
  `ELEVENLABS_API_KEY`). Nie in eine ausgelieferte Datei (JS/HTML/JSON) schreiben.
- **Ersatzstimme:** Figuren mit geklonter Stimme können in der config.json neben `"name"` ein
  `"ersatzStimme": "<voice_id>"` bekommen (ElevenLabs-Standardstimme, gibt es in jedem Konto).
  Die Engine nimmt sie automatisch, wenn die eigene Stimme `voice_not_found` meldet (z. B. zz).
- **Stimme + Settings** je Figur aus der `config.json` des Falls: `voice_id`,
  `stability`, `similarity_boost`, `speed`. Pro Figur unterschiedlich (z. B. sh:
  sherlock `speed 1.03`, drWatson `speed 0.99`).
- **Modell:** seit 30.09.2026 `eleven_v4_turbo` (wie Gespräche und Live-TTS; versteht Audio-Tags,
  spricht sie nicht mit - per Spracherkennung `POST /v1/speech-to-text`, `scribe_v1` gegenprüfen).
  Emotion über Audio-Tags im Text (`[excited]`, `[worried]`, `[whispers]` …) plus niedrige `stability`.
- **Texte mit Tags immer als `<fall>/sayTexte.json` ablegen** (Job-Liste `{file, fig, text, model}`) –
  im spielVerlauf steht nur der Dateiname; bei rb mussten die Texte per Spracherkennung aus den MP3s
  zurückgewonnen werden. Seit 30.09.2026 haben rb, cb, sh2 und zz je eine `sayTexte.json`.
  Fehlt der Text: `GET /v1/history` (ElevenLabs-Verlauf, mit `voice_id` und Originaltext) über
  das Transkript der MP3 zuordnen; nur wenn dort nichts passt, per Spracherkennung zurückholen und
  Mehrsprecher-Dateien mit `diarize=true` erkennen (cb `herrKommissarDarf` = Köhler + Kommissar).
  zz-Erzählungen sind mit geklonten Stimmen des Autors gesprochen (in anderen Konten nicht verfügbar).
- **Neu vertonte MP3s unter neuem Namen ablegen** (`…_v4.mp3`) und `say.text` umstellen: die Engine
  hängt keinen Cache-Buster an, und `?v=` am Namen bricht die `.endsWith(".mp3")`-Erkennung – bei
  gleichem Namen spielen Browser sonst die alte Fassung aus dem Cache.
- (Früher: `eleven_v3` (Studio-Variante) für vorproduzierte Sprache.)
  - Wichtig: die **Live-`convo`** läuft über den Conversational-Agenten mit
    `eleven_v3_conversational` (steht in `config.json` → `model_id`). Beides ist v3, gleiche
    Stimme → praktisch deckungsgleich. Nur die tote `say`-Live-Fallback-Funktion nutzt noch
    `eleven_multilingual_v2` – die ist irrelevant, sobald alle `say`s als MP3 vorliegen.
  - Will der Nutzer es 100 % identisch zur Live-Session, stattdessen
    `eleven_v3_conversational` generieren.
- **Endpoint:** `POST https://api.elevenlabs.io/v1/text-to-speech/<voiceId>?output_format=mp3_44100_128`,
  Header `xi-api-key`, Body `{ text, model_id, voice_settings:{stability,similarity_boost,speed} }`.

Bewährtes Vorgehen: kleines Node-Skript im Scratchpad mit einer Job-Liste
`{file, voice, speed, text}` über alle Einträge loopen (Node ≥18 hat globales `fetch`);
Buffer per `fs.writeFileSync` nach `<fall>/imgEleven/` schreiben. Danach die `say.text`-Werte
im `spielVerlauf.json` **chirurgisch per Edit** auf `[ "datei.mp3", 1.0 ]` umstellen (nicht
neu serialisieren) und JSON validieren.

Erst **eine** Aufnahme zum Probehören erzeugen, dann bei OK den Rest im selben Rutsch.
Betonung/Ausdruck steuert man über `stability` (niedriger = ausdrucksstärker).

