# ElevenLabs-Tools, eleven.js-Verdrahtung und Prompt-Regeln

## Die Client-Tools und ihre Umsetzung in eleven.js

Die Tool-**Schemas** werden im ElevenLabs-Dashboard am Agenten definiert; die
**Implementierung** liegt in `eleven.js` im `clientTools`-Objekt von
`Conversation.startSession(...)`. Beide müssen zusammenpassen. Aktuelles Set:

### notiz_protokollieren
- ElevenLabs-Parameter: **`notiz_text`** (string, required).
- Wirkung: `addOrUpdateNotiz(name, status[name], text, "")` – Notiz ins Notizbuch.

### gespraech_beenden
- Parameter: **`Befehl`** (string, optional) und **`Delay`** (integer, optional).
- Wirkung: beendet die Session. Mit `Befehl` wird beim Beenden die passende
  `schluesselwort`-Aktion ausgelöst (Szenenwechsel/Figurwechsel); ohne `Befehl` nur beenden.
  `Delay` = Sekunden Verzögerung vor dem Beenden.
- Umsetzung: baut `"<Delay><Befehl>"` und ruft `safeEndSession(...)`. Beispiel
  `Befehl='Brechstange', Delay=0` → `"0Brechstange"` → 0 s warten, `schluesselwort`-Wort
  „Brechstange" auslösen, beenden.

### befehl_senden
- Parameter: **`Befehl`** (string).
- Wirkung: schaltet **mitten im laufenden Gespräch** die passende `schluesselwort`-Aktion
  (Session bleibt offen). Für Enthüllungen/Effekte, die das Verhör NICHT beenden sollen –
  cb-Szenenwechsel, sh2 Mid-Reveals (`tot`, `Bewegung`, `gehämmert`, `Oktoberfest`, `Bierkrug`)
  und das **Buch mittendrin** (schaffner_2/3: Grundriss/Belegungsplan zeigen, Verhör läuft weiter).
- Matcht `Befehl` gegen `convoEintrag.schluesselwort` unabhängig von `schluesselwortImTranskript`.

### skip_turn (ElevenLabs-System-Tool, KEIN Client-Tool)
- Eingebautes System-Tool von ElevenLabs: Dashboard → Agent → Tools → **System tools → Skip turn**
  aktivieren. Steht **nicht** in `eleven.js`. Der Agent überspringt seinen Sprech-Zug, bleibt still.
- Einsatz in sh2: **nach jedem `gespraech_beenden`** (erzwingt „sage danach nichts mehr") und
  **nach dem Buch-`befehl_senden`** (Nutzer liest in Ruhe, Figur redet nicht weiter). Als
  Prompt-Regel: „Rufe unmittelbar nach jedem Aufruf von 'gespraech_beenden' zusätzlich 'skip_turn'
  auf und sage danach nichts mehr." Fehlt das Tool am Agenten, greift nur der Text.

### befehl_senden vs gespraech_beenden – Entscheidung
- **Info-Reveal / Effekt, Gespräch läuft weiter** → `befehl_senden` (+ ggf. `skip_turn`).
- **Weggehen / Szene- oder Figurwechsel / Finale / Verabschiedung** → `gespraech_beenden`
  (mit Befehl = Weiterschalten, ohne Befehl = nur beenden).
- **Falle (Symptom „Weiterschaltung passiert nicht"):** Führt der Befehl auf einen
  `say`-Eintrag oder einen narrativen Szenenwechsel (die Figur schweigt, eine andere Figur/der
  Erzähler übernimmt, `szene_wechseln`), MUSS es `gespraech_beenden` mit Befehl sein –
  `befehl_senden` lässt die Voice-Session offen, und ein `say`/Wechsel kann nicht abgespielt
  werden, solange der Agent noch spricht. Prüfen: Setzt der `schluesselwort`-Eintrag einen
  `<figur>_status`, dessen Ziel-Eintrag ein `say` ist? → `gespraech_beenden`. `befehl_senden`
  nur für Reveals/Overlays (Buch, Bild-/Opacity-Effekt), die das Verhör offen lassen.
  (Realfall sh2: `schaffner_1` `tot` → `sherlock_2` (say) lief mit `befehl_senden` ins Leere.)

### ergebnisGespraech (Legacy – cb, sh2)
Ein Tool mit kodiertem `message`-String, bleibt unterstützt:
- `message` beginnt mit **`0`** → `safeEndSession` (beenden; Rest = optionale Verzögerung +
  Schlüsselwort, z. B. `02Brechstange` = 2 s + „Brechstange").
- beginnt mit **`1`** → Mid-Session-Schlüsselwort (`eintragAendern(match)`).
- **kein** führender Ziffer → Notiz.

### Robustheit im Code
- **`bereinigeToolText`** entfernt unsichtbare Zeichen (BOM/Zero-Width) + Leerraum – Modelle
  hängen so etwas gern an und brechen sonst den Vergleich.
- **`toolArgWert(args, …keys)`** zieht den Wert case-genau über bekannte Schlüssel und fällt
  sonst auf den ersten nicht-leeren String zurück – funktioniert auch bei anders benannten
  Parametern. Trotzdem den **exakten Parameternamen** (`notiz_text`, `Befehl`, `Delay`) als
  ersten bevorzugten Schlüssel führen. Objektschlüssel sind **case-sensitiv** (`Delay` ≠
  `delay`) – `Delay` wird deshalb case-insensitiv erkannt und aus der Befehl-Erkennung
  ausgeklammert.
- **`findeSchluesselwort(befehl, liste)`** matcht tolerant: exakt → ohne Sonderzeichen/
  Groß-klein → als Präfix. `safeEndSession` matcht exakt und dann case-/zeichentolerant.
  Deshalb muss der gesendete `Befehl` dem `wort` im Wortstamm entsprechen.

### Neues fallweites Verhalten einbauen
Wenn ein Verhalten nur einen Fall betrifft, **Flag in `daten[0]`** einführen und in
`ladeSettings()` lesen; Default = altes Verhalten, damit cb/sh2 unberührt bleiben (Muster:
`toolPromptVorne`, `schluesselwortImTranskript`, `spielstandNurErsteFigur`,
`figurAktivierungPruefen`). Nach dem Entfernen eines Flags/Tools per Grep sicherstellen,
dass keine verwaiste Referenz bleibt (`node --check` findet das nicht).

## Prompt-Zusammenbau (startCall)

Reihenfolge des an den Agenten gesendeten `my_custom_instruction`:

```
bisheriger Verlauf
+ elevenPrompt
+ [ toolPrompt ]            ← nur wenn toolPromptVorne=true (Rahmen VOR der Rolle)
+ allgText                  ← Persona
+ my_custom_instruction     ← Geheim-Infos (Array/[expr]-Logik aufgelöst)
+ addText                   ← konkrete Tool-Trigger (am Ende = Recency)
+ [ toolPrompt ]            ← nur wenn toolPromptVorne=false (wie bisher, am Ende)
```

Platzhalter `XXX`/`forename`/`lastname`/`gender` werden über den `userName` ersetzt.
Die Begrüßung geht separat als dynamic variable `begruessung`.

## Prompt-Regeln für zuverlässige Tool-Aufrufe

1. **Meta-Regel „Tools sind kein Sprechen" als Rahmen VOR die Rolle** (`toolPromptVorne: true`).
   Sonst unterdrückt eine passive/wortkarge Persona den Tool-Aufruf. Formulierung z. B.:
   „Werkzeuge (Tools) sind kein Sprechen und haben Vorrang vor Deiner Rolle – Du bleibst
   nach außen in Deiner Rolle und rufst Tools nur im Hintergrund auf."
2. **Konkrete Auslöser bleiben am Ende** (`addText`), direkt vor der Generierung.
3. **Die Tool-Beschreibung in ElevenLabs ist der stärkste Hebel** – die Wann-Bedingung
   dorthin schreiben (z. B. „Aufrufen, sobald ein konkretes Täter-Detail verraten wird").
   Das wirkt zuverlässiger als jede System-Prompt-Zeile.
4. **An Nutzer-Eingaben hängen**, nicht an Selbstbeobachtung. „Sobald der Nutzer sich
   verabschiedet" ist robuster als „sobald DU X sagst".
5. **Trigger-Last niedrig halten** – wenige, klar getrennte Bedingungen je Gespräch.
6. **Keine `skip_turn`-Ketten** – `gespraech_beenden` beendet selbst; danach „sage nichts mehr".

### Wenn Tool-Trigger unzuverlässig bleiben: `suchwort` (Live-Transkript)

Reveals/Notizen, die ein Tool-Call (`befehl_senden`/`notiz_protokollieren`) auslösen soll,
feuern **prinzipiell probabilistisch** – auch mit optimierter Dashboard-`description`. Für
KRITISCHE Reveals ist der **`suchwort`-Live-Trigger** der robusteste Weg: er hängt am
tatsächlich gesprochenen Text der Figur, nicht an der Tool-Call-Laune des LLM. In den
`schluesselwort`-Eintrag `"suchwort": "Wort"` **oder** `"suchwort": ["Wort1","Wort2"]`
(ein Treffer genügt) setzen; sagt die Figur eines der Wörter, führt `onMessage` in
`eleven.js` den Eintrag SOFORT aus (Notiz/Spielstand/Szene). Den entsprechenden
Tool-Trigger im `addText` dann **entfernen** (sonst doppelt; `notiz`/`spielstand` sind zwar
idempotent, aber sauberer ist eins). Schema-Details in `spielverlauf-schema.md`. Grenzen:
wirkt nur auf den **Agenten-Text** (nicht Nutzer-Eingaben), Suchwörter eindeutig genug
wählen (Teilstring-Match, case-insensitiv), und die Figur muss das Wort auch wirklich sagen –
also im `my_custom_instruction` verankern, dass sie das Detail bei Nachfrage preisgibt. Das
`suchwort`-Feature ist rückwärtskompatibel (nur Einträge MIT `suchwort` werden überwacht);
nach der `eleven.js`-Änderung `?v=` an vier Stellen bumpen (s. `audio-und-deploy.md`).

### addText-Vorlagen (neues Tool-Set)

```
Notiz:        Benutze das Tool 'notiz_protokollieren' mit dem Text '<Notiz>', wenn <Bedingung>.
Weiter+Ende:  Benutze das Tool 'gespraech_beenden' mit dem Befehl '<Wort>', wenn <Bedingung>; sage danach nichts mehr.
Nur Ende:     Benutze das Tool 'gespraech_beenden', NUR wenn der NUTZER das Gespräch beenden möchte.
Mid-Session:  Benutze das Tool 'befehl_senden' mit dem Befehl '<Wort>', wenn <Bedingung>.   (cb-Variante)
```
`<Wort>` muss dem `wort` eines `schluesselwort`-Eintrags des Gesprächs entsprechen.

## Debugging in der Browser-Konsole

`eleven.js` loggt jeden Tool-Aufruf: `📝 notiz_protokollieren` · `🚪 gespraech_beenden` ·
`➡️ befehl_senden` · `🔑 …-Treffer`. Zeigt kein Treffer-Log: `Befehl` ≠ `wort`, Tool hängt
nicht am Agenten, oder der Prompt nennt das falsche Tool. Der gesamte gesendete Prompt wird
ebenfalls geloggt (`console.log(ganzerPrompt)`) – so prüfen, ob `toolPrompt` an der richtigen
Stelle steht.

## Fall von Transkript-Suche auf Tools umstellen (sh2-Muster)

Alt: `schluesselwortImTranskript: true` – Schlüsselwörter wurden am Gesprächsende (Klick auf
andere Figur) im **Transkript** gesucht. Umstellung auf tool-getrieben:

1. `daten[0].schluesselwortImTranskript` auf **`false`** setzen.
2. **Jedes** `schluesselwort`-`wort` braucht nun einen Tool-Trigger im `addText`/`my_custom_instruction`:
   Info-Reveal → `befehl_senden`, Weggehen/Wechsel → `gespraech_beenden` mit Befehl.
3. **In jeder convo** die Verabschiedung `gespraech_beenden` (ohne Befehl) sicherstellen.
4. Redundante/Duplikat-Schlüsselwörter zusammenlegen (z. B. `tot`/`Leiche`, `Bierkrug`/`Bierkrüge`);
   zeigen zwei Wörter dieselbe Aktion, reicht eines, der Prompt sendet denselben Befehl.
5. Prüfskript: jedes `wort` muss als `Befehl '<wort>'` im Text vorkommen, jede convo eine
   plain-`gespraech_beenden`-Verabschiedung haben. `agent_id` auf den Agenten mit dem 3-Tool-Set
   (+ `skip_turn`) setzen (alle Fälle teilen den Agenten „KrimiZeit“ aus einrichten.html).

## Gesprächs-Rahmenfarbe (eleven.js)

Beim Start einer convo ist der Figur-Rahmen **weiß** (Figur verbindet/spricht) und wird beim
**ersten Zuhören** rot (`onModeChange`, `mode === "listening"`); danach bleibt er rot bis
Gesprächsende. Klick-Vorschau beim `szene_wechseln` ist nur klickbar, nicht ziehbar
(`draggable=false`).

## Stimmungsstufen über Audio-Tags auslösen (bewährt, cb `weigand_2`, 30.09.2026)

Hat eine Figur Stufen/Phasen mit eigenen Audio-Tags im Prompt (z. B. Stufe 2 `[nervous]`,
Stufe 3 `[panicked]`), die Tags als `suchwort` an das Stufen-Schlüsselwort hängen:
`"suchwort": [ "[nervous]", "[stammers]" ]`. Die Tags stehen im Antworttext (`onMessage`), der
Wechsel folgt damit zuverlässig der Stimme. Das Tool bleibt als zweiter Weg erhalten. Grund: DeepSeek
(deepseek-v41-flash) spielte die Stufen sauber im Ton, rief das Stufen-Tool aber nur 1 von 6 Mal auf.
Tags je Stufe disjunkt wählen. Vorher gegen echte Protokolle testen (`GET /v1/convai/conversations/<id>`).

Client-Tools in ElevenLabs: `pre_tool_speech` auf `off` (bei `force` erzwingt das Modell vor jedem
Aufruf einen gesprochenen Satz wie „Einen Moment, ich sammle mich kurz.“).

**Achtung:** Alle Figuren eines Falls teilen EINEN Agenten und damit dieselben Tools. Tool-Beschreibungen in ElevenLabs gelten also für jede Figur. Dort nie figurenspezifische Werte oder Auslöser eintragen (am 30.09.2026 passiert und zurückgenommen). Figurenspezifisches gehört in den Prompt der Figur (`my_custom_instruction`/`addText`) oder als `suchwort` in die spielVerlauf.json. Änderungen am gemeinsamen Tool betreffen alle Fälle – vorher alle Fälle mitprüfen.
