# KrimiZeit – Sprach-Krimis zum Mitreden

Interaktive Krimis im Browser: Du bist Ermittler, sprichst über dein Mikrofon mit den Figuren,
sammelst Hinweise und löst den Fall. Die Figuren antworten mit eigenen Stimmen über
[ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai).

**▶ Spielen:** <https://petergreiner-ai.github.io/krimizeit/>
(in einem Fork: `https://<benutzername>.github.io/<repository>/`)

## Enthaltene Fälle

| Ordner | Fall |
|---|---|
| `rb` | Rotkäppchen und der böse Wolf |
| `zz` | Zauberer Zackifurz: Das versaute Weihnachten |
| `sh2` | Sherlock Holmes: Mord im Nachtzug |

## Was du brauchst

- Einen PC mit **Mikrofon** (Kopfhörer empfohlen) und Chrome oder Edge.
- Ein **eigenes ElevenLabs-Konto** mit einem API-Schlüssel. Die Gespräche laufen über dein Konto
  und verbrauchen dort Guthaben. Mit einem kostenlosen Konto reicht das Guthaben nur zum
  Anspielen, und Stimmen aus der ElevenLabs-Bibliothek sind dort über die API eventuell nicht
  nutzbar.

## Einrichtung (einmalig)

1. Bei ElevenLabs unter **Developers → API Keys** einen Schlüssel anlegen, mit diesen Rechten:
   **Text to Speech**, **ElevenLabs Agents: Write**, **Voices: Read**.
2. Die Spielseite öffnen. Du landest auf **Einrichten**, dort den Schlüssel einfügen.
3. Die Seite legt in deinem Konto einen Agenten „KrimiZeit“ mit drei Werkzeugen an
   (`notiz_protokollieren`, `gespraech_beenden`, `befehl_senden`). Danach geht es los.

Der Schlüssel bleibt **nur in deinem Browser** (localStorage) und wird nur an
`api.elevenlabs.io` geschickt. Spielstand und Notizen liegen ebenfalls im Browser.

## Selbst betreiben

Das Ganze ist eine statische Website, ein Server ist nicht nötig. Lokal zum Beispiel mit
```bash
python -m http.server 8080
```
starten und `http://localhost:8080/` öffnen (das Mikrofon braucht `localhost` oder HTTPS).

## Eigene Fälle bauen

Jeder Fall ist ein Ordner mit zwei Dateien plus Bildern und Tönen:

- `config.json`: die Figuren mit Stimme (`voice_id`), Sprachmodell und Einstellungen
- `spielVerlauf.json`: der Story-Ablauf (Szenen, Gespräche, Schlüsselwörter, Hinweise)
- `imgEleven/`: Figurenbilder, Szenenbilder, MP3s

Der schnellste Einstieg: einen vorhandenen Fall kopieren (`rb` ist der kleinste) und umbauen.
Das vollständige Datenschema steht in [doku/spielverlauf-schema.md](doku/spielverlauf-schema.md),
die Werkzeuge und das Schreiben zuverlässiger Figuren-Prompts in
[doku/tools-und-prompts.md](doku/tools-und-prompts.md), das Vorproduzieren von Sprache in
[doku/audio.md](doku/audio.md). Neue Fälle in `index.html` eintragen.

**Mit Claude Code:** Der Ordner [claude-skill/krimizeit](claude-skill/krimizeit) ist ein Skill
für [Claude Code](https://claude.com/claude-code). In `~/.claude/skills/` kopieren, dann kann
Claude Fälle anlegen, Figuren und Szenen ergänzen und Fehler suchen („die Szene schaltet nicht
weiter“).

Hinweise zu Stimmen: Figuren mit einer geklonten Stimme des Autors haben in der `config.json`
eine `ersatzStimme` (ElevenLabs-Standardstimme). Die Engine nimmt sie automatisch, wenn die
eigentliche Stimme im Konto des Spielers fehlt.

## Mitmachen

Fehler gefunden, Idee, neuer Fall? Gern als **Issue** oder **Pull Request**: Repository
forken, Fall bauen, Pull Request schicken.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | Spielauswahl |
| `einrichten.html` | Schlüssel prüfen, Agent und Werkzeuge im ElevenLabs-Konto anlegen |
| `login.html` | Spielername, Spielstand fortsetzen |
| `index2.html` | Spielfläche |
| `eleven.js` | Engine (Gespräche, Szenen, Spielstand) |
| `extras.js` | Buch, Notizbuch, Einblendungen |
| `agent-vorlage.json` | Vorlage für den ElevenLabs-Agenten |

## Lizenz

- **Engine und Seiten** (`*.js`, `*.html`, `*.css`, `agent-vorlage.json`, `doku/`,
  `claude-skill/`): [MIT](LICENSE)
- **Die Fälle** (`rb/`, `sh2/`, `zz/` und `imgEleven/`, also Geschichten, Texte, Bilder und
  Tonaufnahmen): [CC BY-NC-SA 4.0](LICENSE-FAELLE.md). Weiterentwickeln ist ausdrücklich
  erwünscht, mit Namensnennung, nicht kommerziell und unter derselben Lizenz.

Erdacht und programmiert von „The Greiners“.
