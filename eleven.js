// Der nackte Paketname liefert bei unpkg inzwischen das IIFE-Bundle (Feld "unpkg"
// in der package.json) und damit keine ES-Exporte. Deshalb direkt den Web-Einstieg
// laden: er registriert zusaetzlich die Browser-Setups (Voice-Session, WebRTC-Audio,
// iOS-Audio-Unlock) und re-exportiert Conversation. Version bewusst gepinnt.
import { Conversation } from 'https://unpkg.com/@elevenlabs/client@1.15.0/dist/platform/web/index.js?module';
import { performanceRate, initBuchWithDaten, wegMitBuch, showScrollingOverlay, removeScrollingOverlay } from './extras.js?v=63';

// ElevenLabs nur noch ueber den Server: eleven.php haelt den Schluessel (seit 18.10.2026;
// vorher stand er hier im Klartext und war fuer jeden Spieler lesbar). Der Browser holt
// sich je Gespraech ein Einmal-Token, Sprachausgabe/Stimmenwechsel/Transkript laufen
// ebenfalls ueber eleven.php - jeweils nur fuer Figuren aus der config.json des Falls.
const ELEVEN_PROXY = "eleven.php";

// Oeffentliche Fassung (GitHub Pages, ohne eigenen Server): index2.html setzt vorher
// window.KRIMIZEIT_OEFFENTLICH = true. Dann ruft der Browser ElevenLabs direkt mit dem
// EIGENEN Schluessel des Spielers auf (einrichten.html legt Schluessel und Agenten-ID im
// localStorage ab), und Spielstand/Notizen bleiben im Browser statt in user.json.
// Ohne das Flag (bewusstheit.org) laeuft alles wie bisher ueber eleven.php/speichern.php.
const OEFFENTLICH = !!window.KRIMIZEIT_OEFFENTLICH;

function eigenerZugang() {
    try {
        return {
            key: localStorage.getItem("krimizeit_schluessel") || "",
            agent: localStorage.getItem("krimizeit_agent") || ""
        };
    } catch (e) { return { key: "", agent: "" }; }
}

// Ein Weg fuer alle ElevenLabs-Aufrufe: aktion = token | tts | agent | transkript, Antwort
// immer als fetch-Response mit derselben Form wie eleven.php. In der oeffentlichen Fassung
// bildet direkterAufruf() die Logik von eleven.php im Browser nach (inkl. Ersatzstimme).
async function elevenAufruf(aktion, daten = {}) {
    if (OEFFENTLICH) return direkterAufruf(aktion, daten);
    if (aktion === "token" || aktion === "transkript") {
        return fetch(`${ELEVEN_PROXY}?` + new URLSearchParams({ aktion, fall, ...daten }));
    }
    return fetch(`${ELEVEN_PROXY}?aktion=${aktion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fall, ...daten })
    });
}

async function direkterAufruf(aktion, daten) {
    const { key, agent } = eigenerZugang();
    const api = (pfad, opt = {}) => fetch("https://api.elevenlabs.io" + pfad,
        { ...opt, headers: { ...(opt.headers || {}), "xi-api-key": key } });
    const antwort = (code, obj) => new Response(JSON.stringify(obj),
        { status: code, headers: { "Content-Type": "application/json" } });
    const stimmeFehlt = async res => res.status >= 400 && (await res.clone().text()).includes("voice_not_found");
    if (!key || !agent) return antwort(401, { error: "Nicht eingerichtet – bitte einrichten.html aufrufen." });

    switch (aktion) {
        case "token":
            return api(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(agent)}`);
        case "transkript":
            return api(`/v1/convai/conversations/${encodeURIComponent(daten.id)}`);
        case "tts": {
            const sprich = stimme => api(`/v1/text-to-speech/${encodeURIComponent(stimme)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: daten.text, model_id: "eleven_v4_turbo" })
            });
            let res = await sprich(daten.voice_id);
            const ersatz = configAgent.find(a => a.conversation_config?.tts?.voice_id === daten.voice_id)?.ersatzStimme;
            if (ersatz && await stimmeFehlt(res)) res = await sprich(ersatz);
            return res;
        }
        case "agent": {
            const figur = configAgent.find(a => a.name === daten.name);
            if (!figur) return antwort(404, { error: "Unbekannte Figur." });
            const patch = stimme => {
                const k = JSON.parse(JSON.stringify(figur));
                delete k.agent_id;      // der Agent des Spielers kommt aus einrichten.html
                delete k.ersatzStimme;  // unser Zusatzfeld, nicht fuer ElevenLabs
                if (stimme) k.conversation_config.tts.voice_id = stimme;
                return api(`/v1/convai/agents/${encodeURIComponent(agent)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(k)
                });
            };
            let res = await patch();
            let ersatz = false;
            if (figur.ersatzStimme && await stimmeFehlt(res)) { res = await patch(figur.ersatzStimme); ersatz = true; }
            return res.ok ? antwort(200, { ok: true, ersatz }) : res;
        }
    }
    return antwort(400, { error: "Unbekannte Aktion." });
}

// Spielstaende der oeffentlichen Fassung: wie user.json, aber je Fall im localStorage.
function lokaleSpieler() {
    try { return JSON.parse(localStorage.getItem("krimizeit_spieler_" + fall) || "{}") || {}; }
    catch (e) { return {}; }
}
function speichereLokaleSpieler(alle) {
    try { localStorage.setItem("krimizeit_spieler_" + fall, JSON.stringify(alle)); }
    catch (e) { console.warn("Spielstand konnte nicht im Browser gespeichert werden:", e); }
}

// Fall-Ordner: Die Engine liegt in KrimiZeit/, die Falldaten in Unterordnern
// (cb, sh, sh2, rb). 'fall' waehlt den Ordner (?fall=cb), 'basis' ist der Prefix
// fuer alle fallspezifischen Pfade (Daten, Figuren-/Szenen-/Audio-Assets).
// Geteilte UI-Assets (denk.png, buch.png, pfeile, erzaehler.png, UI-Sounds) liegen
// direkt in KrimiZeit/imgEleven/ und werden ohne 'basis' referenziert.
const fall = (new URLSearchParams(location.search).get('fall') || 'cb').replace(/[^A-Za-z0-9_-]/g, '');
export const basis = (fall || 'cb') + '/';

// Einmal-Token fuer ein WebRTC-Gespraech mit der Figur (gleichwertig zur "signed URL",
// die das SDK nur fuer WebSocket annimmt). Wirft bei Fehlern - der Aufrufer raeumt auf.
async function holeGespraechsToken(name) {
    const res = await elevenAufruf("token", { name });
    const daten = await res.json().catch(() => ({}));
    if (!res.ok || !daten.token) {
        const err = new Error("Kein Gesprächs-Token (" + res.status + "): " + JSON.stringify(daten));
        err.name = "Zugang " + res.status;
        throw err;
    }
    return daten.token;
}

let convo;
let status = {};
export let daten = [];
let eintrag;
let begr = "Hallo";
let aktuellerTippEintrag = null;
let aktuellerTippIndex = 0;
let hinweisIndex = 1;
let timeoutId;
window.pruefeWS = "";
window.transcript = {}; 
let configAgent = [];
let aktuellesHAudio = null;
let aktuellesAudio = null;
let userName = "Herr Max Mustermann";
let userForename = "Max";
let userLastname = "Mustermann";
let userGender = "Herr";
let startUser = "user_1";
window.spielstand = [];
let szeneVorher = "";
let szeneJetzt = "";
let aktivePois = [];
// Zentrale POI-Deklaration je Bild (aus daten[0].poi): { "bild.png": [ [poi], ... ] }
let poiRegister = {};
// Zentrale Figuren-Anordnung je Bild (aus daten[0].figurenAnordnung), Aufbau wie poi:
// { "bild.png": [ ["sherlock", 0.5, 0.5], ... ] }. x/y sind ANTEILE des sichtbaren
// Fensters (0..1) und meinen die MITTE der Figur - 0.5/0.5 ist also Bildschirmmitte.
// Erscheint das Bild als Hintergrund, wandern die Figuren dorthin; ohne Eintrag fahren
// sie wie bisher auf ihre normalen (Flex-)Plaetze.
let figurenAnordnungRegister = {};
// Dauer, in der Figuren an ihren Platz wandern - dieselbe wie beim Zuruecksetzen.
const FIGUR_WANDER_MS = 1000;
// Referenzbild-Masse fuer die POI-Geometrie, falls die POIs aus einem anderen Bild
// stammen als der Hintergrund (Video-Fallback X.mp4 -> X.png). null = Hintergrund nutzen.
let poiRefGroesse = null;
const poiBildGroessen = {}; // Cache: bildname -> { w, h }
let poiTooltip = null;
let poiListenerAktiv = false;
let poiAktiverIndex = -1;
let poiTimeoutId = null;
let gezeigtePoiTexte = new Set();
let poiTextSichtbar = false;
let agentModus = "listening"; // "speaking" | "listening" - von onModeChange gepflegt
// Fruehester Zeitpunkt (ms), zu dem die Figur ihre letzte Aeusserung ausgesprochen haben kann -
// aus Textlaenge geschaetzt (onMessage). Gespraechsende davor waere mitten im Satz.
let sprechEndeFruehestens = 0;
// Vollstaendiger Figurenzustand im Spielstand: Bisher stellte das Laden nur die Startfigur und
// die Paare aus deren szene_init her - alle anderen Figuren standen auf Status "0"/unsichtbar
// (z. B. sh2 drwatson_4: Schaffner liess sich nicht mehr rufen). Jetzt wird beim Speichern
// Status, Deckkraft und ggf. das per bild_neu getauschte Bild jeder Figur mitgeschrieben.
let figurBild = {};                 // name -> [dateiname, nAgentName] aus dem letzten bild_neu
let gespeicherteFiguren = null;     // aus user.json beim Laden
let gespeicherteFigurenFuer = null; // Spielstand, zu dem sie gehoeren

function figurenZustand() {
    const z = {};
    for (const agent of configAgent) {
        const n = agent.name;
        if (!n) continue;
        const el = document.getElementById(n);
        let op = el ? parseFloat(el.style.opacity) : NaN;
        if (Number.isNaN(op)) op = 0;       // leer = CSS-Vorgabe (unsichtbar)
        if (op === 0.2) op = 1;             // voruebergehend abgedunkelt (Maus am Rand)
        if (op === 0.19) op = 0.5;
        z[n] = { s: String(status[n] ?? "0"), o: op };
        if (figurBild[n]) z[n].b = figurBild[n];
    }
    return z;
}

async function wendeFigurenZustandAn(z) {
    for (const agent of configAgent) {
        const n = agent.name;
        const f = z[n];
        if (!n || !f) continue;
        if (Array.isArray(f.b) && f.b[0]) await ersetzeBild(n, f.b[0], f.b[1] ?? undefined);
        if (f.s !== undefined) status[n] = String(f.s);
        const el = document.getElementById(n);
        const op = Number(f.o);
        if (el && !Number.isNaN(op)) {
            el.style.opacity = op;
            el.style.zIndex = "2";
            el.style.cursor = op === 1 ? "pointer" : "default";
        }
    }
    console.log("♻️ Figurenzustand aus dem Spielstand wiederhergestellt:", JSON.stringify(z));
}
let suchwortAusgeloest = new Set(); // pro convo: welche "suchwort"-Schluesselwoerter im Live-Transkript schon getroffen haben
let textToolAusgefuehrt = new Set(); // pro convo: welche AUSGESPROCHENEN Tool-Aufrufe schon nachgeholt wurden
// Notizen aus "suchwort"-Treffern, die noch darauf warten, dass die Figur ihren Satz
// zu Ende gesprochen hat. Eintraege sind die rohen notiz-Arrays [auskunft, status, text, add].
let offeneNotizen = [];
export let notizen = [];
let szeneAmWechseln = false;
let audioEintrag = null;
let elevenPrompt="";
let ganzerPrompt;
let toolPrompt = ""; // Default: Faelle ohne toolPrompt (z. B. sh2) haengen sonst "undefined" an den Prompt
// Wenn true (in daten[0] gesetzt), werden Schlüsselwörter am Gesprächsende im
// Transkript gesucht (sh2, dessen Agenten das Tool nie nutzen), statt über das
// Tool ergebnisGespraech zu laufen (cb). Default false -> cb sucht nie im Transkript.
let schluesselwortImTranskript = false;
// Wenn true (in daten[0] gesetzt), wird der Spielstand nur über die erste Figur
// verwaltet (sh2: nur drwatson-Status ist Speicherpunkt). Default false -> cb
// speichert bei jedem szene_init+status-Eintrag.
let spielstandNurErsteFigur = false;
// Prüft beim Aktivieren einer Figur (opacity>=1), ob ihr Ziel-Eintrag existiert
// (cb-Konvention: Aktivieren + Status setzen). sh2 setzt Status woanders -> in
// sh2/daten[0] auf false setzen, sonst würden gültige Aktivierungen übersprungen.
let figurAktivierungPruefen = true;
// Wenn true (in daten[0] gesetzt), wird die allgemeine Tool-Meta-Regel (toolPrompt)
// zusaetzlich VOR die Rolle (allgText) gestellt, damit sie die Persona rahmt und den
// Rollen-Konflikt entschaerft. Die konkreten Trigger (addText) bleiben am Ende (Recency).
// Default false -> toolPrompt nur am Ende (cb, sh2 unveraendert).
let toolPromptVorne = false;
// Wenn true (daten[0]), wird der bisherige Gesprächsverlauf NICHT vorne in den Prompt
// eingebaut (bisherGesagt). Sinnvoll, wenn jede Figur/Szene ein eigenständiges Gespräch
// ist (zz, sh) und alter Verlauf die Rolle stören würde. Default false -> wie bisher.
let transkriptNichtVorne = false;
// Notizen aus einem "suchwort"-Treffer im Live-Transkript werden erst geschrieben, wenn
// die Figur ihre Aeusserung KOMPLETT zu Ende gesprochen hat - sonst steht der Hinweis im
// Notizbuch, bevor der Spieler ihn gehoert hat, und er liest ihn vorweg. Alle uebrigen
// Aktionen des Treffers (Szenenwechsel, Bilder, Spielstand) laufen unveraendert sofort.
// Mit notizSofort: true (daten[0]) gilt wieder das alte Verhalten.
let notizSofort = false;
// Ebenso der GANZE Treffer-Eintrag (Szenenwechsel, Bild, Status): Er wird erst ausgefuehrt,
// wenn die Figur ihre Aeusserung zu Ende gesprochen hat. Sonst springt die Szene mitten im
// Satz um - onMessage liefert den Text naemlich, bevor das Audio ueberhaupt anlaeuft.
// Mit suchwortSofort: true (daten[0]) gilt wieder das alte Verhalten (sofort ausfuehren).
let suchwortSofort = false;
// daten[0].abschiedErkennen: true -> verabschiedet sich der Nutzer, endet das Gespraech nach
// der Antwort der Figur von selbst (Default false = nur ueber das Ende-Tool).
let abschiedErkennen = false;
window.notizen = window.notizen || [];

// --- Figuren per Klick-und-Ziehen verschieben -------------------------------
// Der Nutzer kann jede SICHTBARE Figur mit gedrueckter Maustaste (bzw. Finger) an
// eine andere Stelle schieben, damit das Hintergrundbild frei wird. Die Verschiebung
// haelt ein translate() auf dem Figuren-Container (.bild-mit-overlay). Bei jedem
// Hintergrundwechsel fahren die Figuren binnen 1s an ihre Ausgangsposition zurueck
// (figurenPositionZuruecksetzen).
let ziehAktiv = false;      // Zeiger ist gerade auf einer Figur gedrueckt
let geradeGezogen = false;  // es wurde tatsaechlich verschoben -> folgenden Klick unterdruecken
let ziehFigur = null;       // aktuell gezogener Container
let ziehStartX = 0, ziehStartY = 0;   // Zeigerposition bei pointerdown
let ziehBasisX = 0, ziehBasisY = 0;   // bereits vorhandene Verschiebung der Figur
let ziehVorherZ = "";       // Container-zIndex vor dem Ziehen (danach wiederhergestellt)
// Referenz der Figur bei pointerdown (Offset 0), um die Verschiebung so zu begrenzen,
// dass die Figur vollstaendig im sichtbaren Fenster bleibt.
let ziehRefLeft = 0, ziehRefTop = 0;  // Viewport-Position der Figur ohne Verschiebung
let ziehBreite = 0, ziehHoehe = 0;    // sichtbare Groesse der Figur (inkl. scale)
const ZIEH_SCHWELLE = 5;    // ab dieser Pixel-Bewegung gilt es als Ziehen (statt Klick)
// So viele Pixel der Figur muessen beim Ziehen im Fenster bleiben - der Rest darf ueber den
// Rand hinaus. Verhindert, dass breite Figurenbilder (viel transparenter Rand) am Rand
// festhaengen, und dass eine Figur wieder eingefangen werden muss.
const FIGUR_REST_SICHTBAR = 40;

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const [configData, spielData] = await Promise.all([
            fetch(basis + 'config.json?_=' + Date.now()).then(res => res.json()),
            fetch(basis + 'spielVerlauf.json?_=' + Date.now()).then(res => res.json())
        ]);

        configAgent = configData;
        daten = spielData;

        const params = new URLSearchParams(window.location.search);
        if (params.get("userName") !== null) {
            userName = params.get("userName");
            const teile = userName.split(" ");
            userLastname = teile[1];
            userForename = teile[0];
        }

        // Status und transcript vorbereiten
        for (let agent of configAgent) {
            if (agent.name) {
                status[agent.name] = "0"; // später evtl. durch URL-Parameter überschrieben
                transcript[agent.name] = [];
            }
        }
        renderPersonen();
        gesichterVorbereiten();   // Figurenkarten sofort lesen (Feld 0 statt Einzelbild)
        // denk.png in die drei Blasenteile zerlegen und auf die (schon erzeugte) Blase anwenden.
        denkTeileVorbereiten().then(() => {
            const ov = document.querySelector(".denk-overlay");
            if (ov) denkBackgroundsAnwenden(ov);
        });
        setupDenkblaseClick();
        document.querySelectorAll("img").forEach(img => {
            img.draggable = false;
            img.addEventListener("dragstart", e => e.preventDefault());
            img.addEventListener("mousedown", e => e.preventDefault());
        });
        ladeSettings();
        
        for (let i = 0; i <= 10; i++) {
            spielstand[i] = 0;
        }
        await ladeNotizen(userName);
        initAgents(configAgent);
        initNotebookOverlay({
            imageSrc: "imgEleven/notizbuch.png",
            title: " "
        });
        updateNotebookOverlay(notizen);
        attachNotebookBadgeToFirstPerson('imgEleven/notizbuch.png');

    } catch (err) {
        console.error("❌ Fehler beim Laden der JSON-Dateien:", err);
    }

    // Rand-Effekt: sobald der Zeiger ins rechte Zehntel des Fensters kommt, werden ALLE
    // Figuren durchsichtiger, damit der Nutzer das Hintergrundbild rechts sehen kann.
    // Das frueher zusaetzliche einzelne Abblenden der Figur unter dem Zeiger entfaellt -
    // stattdessen laesst sich jede Figur per Klick-und-Ziehen aus dem Weg schieben (siehe
    // setupFigurenZiehen). Bewusst ueber die Zeiger-Geometrie am document statt ueber
    // mouseenter der Figur: inaktive Figuren haben pointer-events: none. Aktiv (opacity 1)
    // -> 0.2, inaktiv (0.5) -> 0.19; die weiche 2s-Transition kommt aus dem CSS. Schwellen
    // sind disjunkt, daher idempotent.
    document.addEventListener("mousemove", (e) => {
        // Waehrend eine Figur gezogen wird, die Deckkraft nicht anfassen.
        if (ziehAktiv) return;
        const amRand = e.clientX > window.innerWidth * 0.9;
        document.querySelectorAll('.personen img, .personen video').forEach(fig => {
            // Denkblase / Notiz-Badge nicht anfassen - deren Deckkraft wird woanders gesteuert.
            if (fig.classList && (fig.classList.contains("denk-overlay") || fig.classList.contains("nb-badge"))) return;
            if (amRand) {
                if (fig.style.opacity === "1") fig.style.opacity = 0.2;
                else if (fig.style.opacity === "0.5") fig.style.opacity = 0.19;
            } else {
                if (fig.style.opacity === "0.2") fig.style.opacity = 1;
                else if (fig.style.opacity === "0.19") fig.style.opacity = 0.5;
            }
            // Sicherheitsnetz gegen einen haengengebliebenen Hand-Cursor: ein ausgeblendetes
            // Figurenbild ist unsichtbar, belegt aber weiter seinen Platz in der Leiste am
            // oberen Rand - mit "pointer" entstuende dort eine Hand, wo nichts zu klicken ist.
            // Nur den Fehlerfall anfassen, sichtbare Figuren bleiben unberuehrt.
            // Inline-Deckkraft kann leer sein (dann gilt die CSS-Regel opacity: 0) - in dem
            // Fall die tatsaechlich gerenderte Deckkraft heranziehen.
            if (fig.style.cursor === "pointer") {
                const roh = fig.style.opacity;
                const opJetzt = roh === "" ? parseFloat(window.getComputedStyle(fig).opacity || "0")
                                           : parseFloat(roh);
                if (!(opJetzt > 0.01)) fig.style.cursor = "default";
            }
        });
        // Dasselbe Sicherheitsnetz für die Denkblase: Wurde sie irgendwo ein- oder
        // ausgeblendet, ohne denkblaseKlickbar() mitzuführen, wird sie hier nachgezogen.
        const denkOv = document.querySelector(".denk-overlay");
        if (denkOv) {
            const sichtbar = parseFloat(window.getComputedStyle(denkOv).opacity || "0") > 0.01;
            const jetztAn = denkOv.style.pointerEvents === "auto";
            if (sichtbar !== jetztAn) denkblaseKlickbar(denkOv, sichtbar);
        }
    });

    setupFigurenZiehen();
    setupAnordnungSpeichern();

});
async function startCall(name,nAgentName) {
    console.log(name + "_"+ status[name] + " " + pruefeWS);
    if (pruefeWS == name) return;
    if (pruefeWS !="" && pruefeWS.split("_")[0] != name) return;
    if (pruefeWS=="") pruefeWS = name;
    
    eintrag = daten.find(obj => obj.status === (name + "_" + status[name]));
    if (!eintrag) {
        console.warn("Kein Eintrag für " + name + "_" + status[name] + " – Klick ignoriert.");
        if (pruefeWS === name) pruefeWS = "";
        return;
    }
    eintragAendern(eintrag);

    //Wenn Konversation läuft, dann Stopp
    if (convo) {
        await convo.endSession();
        const unterDaten = eintrag.convo;
        const convoId = convo.getId();
        convo = null;
        pruefeWS = "";
        if (schluesselwortImTranskript && eintrag.convo.schluesselwort) {
            // sh2-Verhalten: kein Tool – das Transkript wird nach den Schlüsselwörtern
            // durchsucht und der jeweilige Treffer-Eintrag ausgelöst.
            waitUntilConversationIsDone(convoId, eintrag.convo.schluesselwort, name);
        } else {
            // cb-Verhalten: Convo-Aktionen anwenden + Transkript speichern (Schlüsselwörter
            // laufen dort über das Tool ergebnisGespraech / safeEndSession).
            eintragAendern(unterDaten);
            writeTranscript(convoId, name);
        }
        borderWeg();
        return;
    }

    let voiceId = getVoiceIdByName(nAgentName || name);
    await updateAgent(nAgentName || name);

    //Bild aktivieren
    const elem = document.getElementById(name);
    const zielScale = eintrag?.scale ?? 2;
    // Portrait-Variante (<name>-p.png vorhanden): das Figuren-Video <name>.mp4 startet
    // JETZT und vergroessert sich synchron WAEHREND des Vergroesserns der Figur. Nach
    // dem Video wird auf das Standbild <name>.png umgeschaltet. Ohne Portrait-Variante
    // spielt kein Video und der Ablauf bleibt wie bisher. Nicht awaiten -> laeuft parallel.
    spieleFigurAktivierung(elem, zielScale);
    elem.style.border = "3px solid white";
    elem.style.borderRadius = "8px";
    elem.style.opacity = "1";
    elem.style.boxShadow = "0 0 20px 15px grey";
    //console.log("SCALE" + (zielScale));
    // Vergroessern ueber 2,5s (statt der 0,5s aus dem CSS); opacity-Transition erhalten.
    elem.style.transition = "transform 2.5s ease, opacity 2s ease";
    elem.style.transform = `scale(${zielScale})`;
    elem.style.zIndex = "5";
    // z-index wirkt nur auf positionierte Elemente - das Bild ist static, daher den
    // Container (position: relative) in den Vordergrund holen. In borderWeg zurueckgesetzt.
    const containerElem = document.getElementById(name + "-container");
    if (containerElem) containerElem.style.zIndex = "10";

    // Sprache abspielen
    if (eintrag.say !== undefined) {
        console.log("Text:", eintrag.say.text);
        elem.style.border = "1px solid white";
        pruefeWS = name;

        if (
            (Array.isArray(eintrag.say.text) && eintrag.say.text[0].endsWith(".mp3")) ||
            (typeof eintrag.say.text === "string" && eintrag.say.text.endsWith(".mp3"))
        ) {
            let aktuellesAudio;
            if (Array.isArray(eintrag.say.text)) {
                aktuellesAudio = new Audio(basis + "imgEleven/" + eintrag.say.text[0]);
                aktuellesAudio.volume = eintrag.say.text[1];

            } else {
                aktuellesAudio = new Audio(basis + "imgEleven/" + eintrag.say.text);
                aktuellesAudio.volume = 1;
            }
            mundStart(elem, mundPegelAudio(aktuellesAudio));
            await new Promise((resolve) => {
                aktuellesAudio.addEventListener("ended", resolve);
                aktuellesAudio.play();
            });
            mundStop();
        } else await speakWithElevenLabs(
            // Platzhalter auch im say-Live-TTS ersetzen (wie bei convo/erzaehler). Nur hier im
            // String-Zweig; MP3-say (Array/".mp3") duerfen keine Platzhalter enthalten.
            (eintrag.say.text ?? "").replace("XXX", userName).replace("forename", userForename).replace("lastname", userLastname).replace("gender", userGender),
            voiceId);

        eintragAendern(eintrag.say);
        borderWeg();
        aktuellerTippEintrag = null;
        //console.log("Stopp Tipp1");
        aktuellerTippIndex = 0;
        clearTimeout(timeoutId);
        const overlay = document.querySelector(".denk-overlay");
        overlay.style.opacity = "0";
        denkblaseKlickbar(overlay, false);
        versteckeText();
        starteTipp(eintrag.say);
        pruefeWS = "";
        return;
    }

    //Starte Konversation
    if (eintrag.convo !== undefined) {
        // Diesen Convo-Eintrag fest fuer den Tool-Closure merken. eintrag ist ein modul-
        // weites let und koennte bis zum Tool-Aufruf ueberschrieben werden -> dann wuerde
        // das Schluesselwort (z. B. 1Stufe2) in der falschen schluesselwort-Liste gesucht.
        const convoEintrag = eintrag.convo;
        // Rahmen startet WEISS (Figur verbindet/begruesst = spricht). Er wird erst rot, wenn
        // die Figur zuhoert - umgeschaltet in onModeChange (unten).
        elem.style.border = "5px solid white";
        let begrN = eintrag.convo.begruessung;
        if (Array.isArray(begrN)) {
            begrN = begrN[ Math.floor(Math.random() * (begrN.length))];
        } else if (typeof begrN !== "string") {
            begrN = "Guten Tag."; // Fallback
        }
        if (begrN == begr) { begr = "Ja?" } else { begr = begrN }
        let transSlice = -15;
        if (eintrag.convo.transSlice) transSlice = eintrag.convo.transSlice;
        let result = "";

        const instr = Array.isArray(eintrag.convo.my_custom_instruction)
            ? eintrag.convo.my_custom_instruction
            : [eintrag.convo.my_custom_instruction];

        instr.forEach(s => {
            const match = s.match(/^\[(.*?)\](.*)/s); // Regex: Inhalt in [ ] + Rest
            if (match) {
                const expr = match[1];   // z.B. "entscheidung = 1-notizEnthalten(...)"
                const text = match[2];   // Rest nach der ]

                let entscheidung = 0;
                try {
                    eval(expr); // setzt "entscheidung"
                    //console.log(expr+" = "+entscheidung);

                } catch (e) {
                    console.error("Eval-Fehler:", e, expr);
                }

                if (entscheidung >= 1) {
                    //console.log(text);
                    result += "\n" + text
                        .replace("XXX", userName)
                        .replace("forename", userForename)
                        .replace("lastname", userLastname)
                        .replace("gender", userGender);
                };
            } else {
                // Falls keine [ ] enthalten sind -> immer übernehmen
                result += "\n" + s
                    .replace("XXX", userName)
                    .replace("forename", userForename)
                    .replace("lastname", userLastname)
                    .replace("gender", userGender);
            }
        });

        // null-sicher: manche Fälle (z. B. zz) haben kein allgText – die ganze Rolle steckt
        // dann im my_custom_instruction. undefined/null -> "" statt Crash bei .replace.
        const ersetze = t => (t ?? "").replace("XXX", userName).replace("forename", userForename).replace("lastname", userLastname).replace("gender", userGender);
        // toolPromptVorne (daten[0]): allgemeine Tool-Meta-Regel als Rahmen VOR die Rolle
        // (governt die Persona), konkrete Trigger (addText) bleiben am Ende. Ohne Flag alles
        // wie bisher: toolPrompt am Ende.
        const toolVorne = (toolPromptVorne && toolPrompt) ? ersetze(toolPrompt) + "\n\n" : "";
        const addTextTeil = eintrag.convo.addText ? "\n\n" + ersetze(eintrag.convo.addText) + "\n" : "";
        const toolHinten = toolPromptVorne
            ? addTextTeil
            : (eintrag.convo.addText ? addTextTeil + toolPrompt : "\n" + toolPrompt);
        ganzerPrompt = (transkriptNichtVorne ? "" : bisherGesagt(transcript[name], transSlice)) +
            elevenPrompt + "\n\n" +
            toolVorne +
            ersetze(eintrag.convo.allgText) + "\n" +
            result +
            toolHinten;
        console.log(ganzerPrompt);
        suchwortAusgeloest.clear(); // Live-Transkript-Trigger dieses Gespraechs zuruecksetzen
        textToolAusgefuehrt.clear();
        sprechEndeFruehestens = 0;
        schreibeOffeneNotizen("vor dem nächsten Gespräch"); // nichts aus dem letzten Gespraech offen lassen
        convo = await holeGespraechsToken(nAgentName || name).then(conversationToken => Conversation.startSession({
            conversationToken, // vom Server (eleven.php) - der Agent selbst verlangt Authentifizierung
            connectionType: "webrtc", // stabilere Latenz/Jitter als pures WS
            dynamicVariables: {
                my_custom_instruction: ganzerPrompt,
                begruessung: begr.replace("XXX", userName).replace("forename", userForename).replace("lastname", userLastname).replace("gender", userGender)
            },
            onModeChange: ({ mode }) => {
                if (mode !== agentModus) console.log("🎙️ " + name + ": " + mode);
                agentModus = mode; // "speaking"|"listening"
                // Rahmen der aktiven Gespraechs-Figur: startet weiss (Figur spricht/verbindet)
                // und wird beim ERSTEN Zuhoeren rot - danach bleibt er rot bis zum
                // Gespraechsende (kein Zuruecksetzen auf weiss mehr).
                if (convo && pruefeWS === name + "_C" && mode === "listening") {
                    elem.style.border = "5px solid red";
                }
            },
            // Live-Transkript-Trigger: Sobald die Figur (Agent) ein definiertes "suchwort" eines
            // schluesselwort-Eintrags ausspricht, wird dieser Eintrag SOFORT ausgefuehrt (Notiz,
            // Spielstand, ggf. Szenenwechsel) - zuverlaessiger als ein LLM-Tool-Aufruf, weil es am
            // tatsaechlich gesprochenen Text haengt. Nur aktiv fuer Eintraege mit "suchwort"; ohne
            // dieses Feld unveraendert. suchwort = String oder Array (ein Treffer genuegt). Jeder
            // Eintrag feuert pro Gespraech nur einmal (suchwortAusgeloest).
            onMessage: (nachricht) => {
                // Signatur je nach SDK-Fassung unterschiedlich benannt - alle gaengigen
                // Felder abklopfen, sonst liefe die Suchworterkennung ins Leere.
                const message = nachricht?.message ?? nachricht?.text ?? nachricht?.content
                    ?? (typeof nachricht === "string" ? nachricht : null);
                const source = nachricht?.source ?? nachricht?.role ?? nachricht?.type;
                if (!message) return;
                if (source === "user" || source === "human") { // ab hier nur die Figur
                    abschiedPruefen(String(message), name, convoEintrag);
                    return;
                }
                sprechEndeFruehestens = Math.max(sprechEndeFruehestens,
                    Date.now() + geschaetzteSprechMs(String(message)));
                const woerter = convoEintrag.schluesselwort || [];
                // Jede Aeusserung der Figur mitschreiben: nur so laesst sich sehen, mit welchen
                // Worten sie eine Information tatsaechlich herausgibt - die Grundlage dafuer,
                // die "suchwort"-Listen zu treffen.
                const offene = woerter.filter(e => e.suchwort).length;
                console.log("💬 " + name + " sagt: " + JSON.stringify(String(message))
                    + "  [" + offene + " Suchwort-Einträge in " + (eintrag.status || "?") + "]");
                // Stimmung aus den Audio-Tags dieser Aeusserung uebernehmen (Figurenkarte).
                gesichtStimmung(String(message));
                // Hat die Figur einen Tool-Aufruf nur ausgesprochen statt ihn aufzurufen,
                // wird er hier nachgeholt (siehe textToolAufrufe).
                textToolAufrufe(String(message), name, convoEintrag);
                const txt = String(message).toLowerCase();
                // Zweite Lesart derselben Aeusserung, in der ausgesprochene Zahlen als Ziffern
                // stehen ("dreiundzwanzig" -> "23") - siehe zahlenNormalisiert.
                const txtZahl = zahlenNormalisiert(message);
                for (const e of woerter) {
                    if (!e.suchwort) continue;
                    const key = e.wort || (Array.isArray(e.suchwort) ? e.suchwort.join("|") : e.suchwort);
                    if (suchwortAusgeloest.has(key)) continue;
                    let ueberZahlwort = false;
                    const treffer = (Array.isArray(e.suchwort) ? e.suchwort : [e.suchwort])
                        .some(sw => {
                            if (txt.includes(String(sw).toLowerCase())) return true;
                            const swZahl = zahlenNormalisiert(sw);
                            if (enthaeltAlsWort(txtZahl, swZahl)) { ueberZahlwort = true; return true; }
                            return false;
                        });
                    if (treffer) {
                        suchwortAusgeloest.add(key);
                        const notizTxt = Array.isArray(e.notiz) ? e.notiz[2] : "";
                        console.log("👂 suchwort erkannt " + JSON.stringify(e.suchwort) + (ueberZahlwort ? " [über Zahlwort: \"" + txtZahl + "\"]" : "") + (notizTxt ? "  →  📝 Notiz: \"" + notizTxt + "\" (nach dem Ausreden)" : "  → (Aktion ausgeführt)"));
                        suchwortEintragAusfuehren(e, name, String(message));
                    }
                }
            },
            clientTools: {
                ergebnisGespraech: async ({ message }) => {
                    // Roh-Nachricht säubern: .trim() entfernt nur normalen Leerraum. Manche
                    // Modelle/TTS stellen unsichtbare Zeichen (BOM U+FEFF, Zero-Width U+200B..U+200D)
                    // voran oder hängen Satzzeichen an ("1Stufe2.") - beides bricht den exakten
                    // Vergleich e.wort === msg, obwohl das Log scheinbar "1Stufe2" zeigt.
                    const msg = (message ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
                    console.log("🛑 Agent sendet:", JSON.stringify(msg)); // stringify macht Rest-Sonderzeichen sichtbar
                    if (msg.startsWith("0")) {
                        safeEndSession(msg, name);
                    }
                    if (msg.startsWith("1")) {
                        const schluesselwoerter = convoEintrag.schluesselwort || [];
                        // Tolerant matchen: erst exakt, dann nach Entfernen von Satzzeichen/Leerraum,
                        // zuletzt per Präfix (msg beginnt mit dem Schlüsselwort). Kein Schlüsselwort
                        // ist Präfix eines anderen (1Stufe2/3/4, 1MutterLuege) -> eindeutig.
                        const norm = s => String(s).replace(/[^0-9A-Za-zÄÖÜäöüß]/g, "").toLowerCase();
                        const match = schluesselwoerter.find(e => e.wort === msg)
                            || schluesselwoerter.find(e => norm(e.wort) === norm(msg))
                            || schluesselwoerter.find(e => e.wort && norm(msg).startsWith(norm(e.wort)));
                        if (match) {
                            console.log("🔑 Schlüsselwort-Treffer:", match.wort, "→ bild_neu:", match.bild_neu ?? "(keins)");
                            eintragAendern(match);
                        } else {
                            console.warn("Kein Schlüsselwort-Treffer für:", JSON.stringify(msg), "| verfügbar:", schluesselwoerter.map(e => e.wort));
                        }
                    }
                    if (!/^[0-9]/.test(msg)) {
                        addOrUpdateNotiz(name, status[name], msg, "")
                    }
                },

                // --- Neue, klar getrennte Client-Tools (sh; kuenftige Spiele) ----------------
                // Alte Spiele (cb, sh2) nutzen weiter ergebnisGespraech oben - beide Wege
                // laufen parallel. notiz_protokollieren = reine Notiz, kein Szenenwechsel.
                notiz_protokollieren: async (args) => {
                    const notiz = bereinigeToolText(toolArgWert(args, "notiz_text", "notiz", "message", "text", "inhalt", "hinweis"));
                    console.log("📝 notiz_protokollieren:", JSON.stringify(notiz));
                    if (notiz) addOrUpdateNotiz(name, status[name], notiz, "");
                },

                // befehl_senden = Fortschritt WEITERschalten, das Gespräch läuft weiter (für
                // die cb-Variante). Der Befehl (statt eines hartkodierten Schlüsselworts im
                // Transkript) wählt den passenden schluesselwort-Eintrag dieses convo-Eintrags.
                // Soll das Weiterschalten das Gespräch beenden (sh), nutzt man gespraech_beenden
                // mit Befehl - nicht dieses Tool.
                befehl_senden: async (args) => {
                    const befehl = bereinigeToolText(toolArgWert(args, "Befehl", "befehl", "command", "kommando", "message", "wort"));
                    console.log("➡️ befehl_senden:", JSON.stringify(befehl));
                    const match = findeSchluesselwort(befehl, convoEintrag.schluesselwort);
                    if (match) {
                        console.log("🔑 Befehl-Treffer:", match.wort, "→ bild_neu:", match.bild_neu ?? "(keins)");
                        eintragAendern(match);
                    } else {
                        console.warn("Kein Befehl-Treffer für:", JSON.stringify(befehl), "| verfügbar:", (convoEintrag.schluesselwort || []).map(e => e.wort));
                    }
                },

                // gespraech_beenden = Gespraech sauber beenden. Optionaler Befehl schaltet
                // dabei die passende schluesselwort-Aktion (z. B. Szenenwechsel); ohne Befehl
                // nur beenden. Route ueber safeEndSession (<zahl><befehl>): fuehrende Zahl =
                // Verzoegerung in Sekunden, Rest = Schluesselwort -> bestehende End-Logik bleibt.
                gespraech_beenden: async (args) => {
                    const istObj = args && typeof args === "object";
                    // Delay: optionaler Integer-Parameter (in ElevenLabs "Delay") - Sekunden
                    // bis zum Beenden. Case-insensitiv, da Objektschlüssel case-sensitiv sind.
                    const delayKeys = ["delay", "verzoegerung", "sekunden"];
                    let delay = 0;
                    if (istObj) {
                        for (const k of Object.keys(args)) {
                            if (delayKeys.includes(k.toLowerCase()) && Number.isFinite(parseFloat(args[k]))) {
                                delay = parseFloat(args[k]);
                                break;
                            }
                        }
                    }
                    // Befehl (optional): schaltet beim Beenden die passende schluesselwort-Aktion.
                    // Delay-Parameter ausklammern, damit er nicht als Befehl missverstanden wird.
                    const argsOhneDelay = istObj
                        ? Object.fromEntries(Object.entries(args).filter(([k]) => !delayKeys.includes(k.toLowerCase())))
                        : args;
                    const befehl = bereinigeToolText(toolArgWert(argsOhneDelay, "Befehl", "befehl", "command", "kommando", "wort", "grund", "message"));
                    console.log("🚪 gespraech_beenden:", JSON.stringify(befehl), "delay:", delay);
                    // safeEndSession erwartet <zahl><befehl>: fuehrende Zahl = Verzoegerung (s).
                    safeEndSession(`${delay}${befehl}`, name);
                }
            }
        })).catch(err => {
            // Scheitert der Start (Mikrofon abgelehnt, Netz weg, ElevenLabs-Fehler, kein
            // Token von eleven.php), lief
            // bisher niemand mehr auf: pruefeWS blieb auf dem Figurennamen stehen und
            // dataset.aktiv auf "1". Damit war die Figur DAUERHAFT blockiert - ein erneuter
            // Klick brach ganz oben ab ("if (pruefeWS == name) return"), es kam kein
            // Aktivierungs-Video mehr und kein Gespräch. Darum hier sauber aufräumen.
            console.error("Gespräch mit " + name + " konnte nicht gestartet werden:", err);
            zeigeKurzmeldung("Gespräch mit " + name + " nicht gestartet – "
                + ((err && err.name) || "Fehler") + ". Bitte erneut anklicken.", "#c00");
            pruefeWS = "";
            if (elem && elem.dataset) elem.dataset.aktiv = "";
            borderWeg();
            return null;
        });
        if (!convo) return;   // Start fehlgeschlagen - oben ist bereits aufgeräumt
        // Lippenbewegung fuer die Dauer des Gespraechs; sie beendet sich selbst, sobald
        // convo wieder null ist (mundPegelGespraech liefert dann null).
        mundStart(elem, mundPegelGespraech, mundRuhigGespraech);
        pruefeWS = name + "_C"
        aktuellerTippEintrag = null;
        //console.log("Stopp Tipp2");
        aktuellerTippIndex = 0;
        clearTimeout(timeoutId);
        const overlay = document.querySelector(".denk-overlay");
        overlay.style.opacity = "0";
        denkblaseKlickbar(overlay, false);
        versteckeText();
        starteTipp(eintrag.convo);
    }
}

// Wartet, bis der Agent seine aktuelle Aeusserung sicher zu Ende gesprochen hat:
// der Modus muss fuer eine kurze Nachlaufzeit "listening" bleiben (fuer Pausen
// zwischen Saetzen). Mit Sicherheits-Timeout, damit es nie haengen bleibt.
// Vorher mindestens bis sprechEndeFruehestens warten: Das SDK meldet "listening" schon,
// wenn der Tonpuffer kurz leerlaeuft (Pause bei "..." / stockende TTS) - ohne diese
// Untergrenze beendete gespraech_beenden die Figur mitten im Satz.
async function warteBisAgentFertigGesprochen(maxMs = 8000, graceMs = 1500) {
    const rest = sprechEndeFruehestens - Date.now();
    if (rest > 0) {
        console.log("⏳ Figur spricht laut Textlänge noch mind. " + (rest / 1000).toFixed(1) + "s – Ende wartet");
        while (convo && Date.now() < sprechEndeFruehestens) await sleep(150);
    }
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        if (agentModus !== "speaking") {
            await sleep(graceMs);
            if (agentModus !== "speaking") return; // wirklich fertig
        } else {
            await sleep(150);
        }
    }
    console.warn("warteBisAgentFertigGesprochen: Timeout – beende trotzdem.");
}

// --- Ausgesprochene Zahlen automatisch als Ziffern erkennen ----------------------
// Der Agent spricht Zahlen fast immer aus ("dreiundzwanzig", "sechs Uhr fuenfundzwanzig"),
// waehrend das suchwort in der spielVerlauf.json in Ziffern steht ("23", "6 Uhr 25").
// Darum wird vor dem Vergleich BEIDES auf dieselbe Form gebracht - die Falldateien
// muessen die ausgeschriebene Variante NICHT zusaetzlich auffuehren.
const ZAHL_EINER = { "null": 0, "eins": 1, "ein": 1, "eine": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "sechs": 6, "sieben": 7, "acht": 8, "neun": 9 };
const ZAHL_ZEHNER = {
    "zehn": 10, "elf": 11, "zwölf": 12, "dreizehn": 13, "vierzehn": 14, "fünfzehn": 15,
    "sechzehn": 16, "siebzehn": 17, "achtzehn": 18, "neunzehn": 19, "zwanzig": 20,
    "dreißig": 30, "dreissig": 30, "vierzig": 40, "fünfzig": 50, "sechzig": 60,
    "siebzig": 70, "achtzig": 80, "neunzig": 90
};
// Ein zusammengeschriebenes Zahlwort von "null" bis "neunhundertneunundneunzig".
// Reihenfolge der Alternativen ist wichtig: laengere zuerst (achtzehn vor acht).
const ZAHLWORT_RE = /\b(?:(?:ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)?hundert)?(?:(?:ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und)?(?:dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig|zehn|elf|zwölf|eins|eine|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|null)\b/g;

// Wert eines einzelnen Zahlworts, sonst null.
function zahlwortWert(wort) {
    let rest = wort;
    let wert = 0;
    const hundert = rest.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)?hundert/);
    if (hundert) {
        wert += 100 * (hundert[1] ? ZAHL_EINER[hundert[1]] : 1);
        rest = rest.slice(hundert[0].length);
        if (!rest) return wert;
    }
    const und = rest.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(.+)$/);
    if (und && ZAHL_ZEHNER[und[2]] !== undefined) return wert + ZAHL_EINER[und[1]] + ZAHL_ZEHNER[und[2]];
    if (ZAHL_ZEHNER[rest] !== undefined) return wert + ZAHL_ZEHNER[rest];
    if (ZAHL_EINER[rest] !== undefined) return wert + ZAHL_EINER[rest];
    return null;
}

// Bringt Transkript UND suchwort auf eine gemeinsame Form: klein geschrieben,
// Zahlwoerter als Ziffern, Uhrzeit mit Doppelpunkt als "<h> uhr <mm>" (so trifft
// auch das suchwort "6:25" auf gesprochenes "sechs Uhr fuenfundzwanzig").
function zahlenNormalisiert(text) {
    let t = String(text ?? "").toLowerCase();
    t = t.replace(/(\d{1,2})\s*:\s*(\d{2})\b/g, "$1 uhr $2");
    t = t.replace(ZAHLWORT_RE, (treffer, offset, ganzerText) => {
        // "ein"/"eine" ist meist der unbestimmte Artikel ("ein Mann") - nur vor "Uhr"
        // als Zahl lesen, sonst bliebe von jedem Artikel eine 1 im Text stehen.
        if (treffer === "ein" || treffer === "eine") {
            if (!/^\s*uhr\b/.test(ganzerText.slice(offset + treffer.length))) return treffer;
        }
        const wert = zahlwortWert(treffer);
        return wert === null ? treffer : String(wert);
    });
    return t.replace(/\s+/g, " ").trim();
}

// Enthaelt der normalisierte Text den normalisierten Suchbegriff als eigenstaendiges
// Wort? Noetig, weil aus "dreizehn Uhr" ein "13 uhr" wird und ein reines includes()
// darin faelschlich das suchwort "3 Uhr" faende. Ohne Lookbehind, damit es auch in
// aelteren Safari-Versionen (iPad) laeuft.
function enthaeltAlsWort(text, teil) {
    if (!text || !teil) return false;
    const istWortzeichen = c => /[0-9a-zäöüß]/.test(c);
    for (let i = text.indexOf(teil); i !== -1; i = text.indexOf(teil, i + 1)) {
        const davor = i > 0 ? text[i - 1] : "";
        const danach = text[i + teil.length] || "";
        if ((!davor || !istWortzeichen(davor)) && (!danach || !istWortzeichen(danach))) return true;
    }
    return false;
}

// --- Notizen aus Live-Transkript-Treffern zurueckstellen -------------------------
// Fuehrt einen per "suchwort" getroffenen schluesselwort-Eintrag aus - und zwar erst, wenn
// die Figur ihre Aeusserung zu Ende gesprochen hat (Szene, Bilder, Status ebenso wie die
// Notiz). Mit daten[0].suchwortSofort bzw. notizSofort gilt jeweils wieder das alte,
// sofortige Verhalten.
function suchwortEintragAusfuehren(e, name, aeusserung = "") {
    // Optional "beendeGespraech": <Sekunden> - dann wirkt der Suchwort-Treffer genau wie
    // der Tool-Aufruf '0<Sekunden><wort>': Das Gespraech wird sauber beendet (nachdem die
    // Figur ausgesprochen hat) und dabei DIESER Eintrag ausgefuehrt. Ohne das Feld bleibt
    // alles wie bisher - der Treffer schaltet nur weiter, das Gespraech laeuft weiter.
    // Der Text der Aeusserung liegt oft vor, BEVOR die Figur zu sprechen beginnt (schnelle
    // LLMs/TTS wie deepseek-v41-flash + eleven_v4_turbo). safeEndSession allein wartete dann
    // nur <Sekunden> + 0,6 s, sah "nicht speaking" und beendete mitten im Satz. Darum hier erst
    // abwarten, bis sie wirklich ausgesprochen hat (mit Anlaufphase), dann <Sekunden> Pause.
    // Zusaetzlich meldet das SDK "listening", sobald der Tonpuffer kurz leerlaeuft (Pause bei
    // "..." oder stockende TTS) - die Figur waere dann mitten im Satz abgeschnitten. Darum aus
    // dem schon vorliegenden Text eine Mindest-Sprechdauer schaetzen und vorher nie beenden.
    if (e && e.beendeGespraech !== undefined && e.wort && name) {
        const minSprechMs = geschaetzteSprechMs(aeusserung);
        console.log("👂→🚪 Suchwort beendet das Gespräch: " + e.wort
            + " (nach dem Ausreden, mind. " + (minSprechMs / 1000).toFixed(1) + "s Sprechen, + "
            + e.beendeGespraech + "s)");
        (async () => {
            if (!suchwortSofort) await warteBisAusgesprochen(60000, 2500, 1500, minSprechMs);
            safeEndSession(String(e.beendeGespraech) + e.wort, name);
        })();
        return;
    }
    if (notizSofort || !e || e.notiz === undefined) {
        eintragNachDemSprechen(e);
        return;
    }
    const { notiz, ...ohneNotiz } = e;   // flache Kopie ohne die Notiz
    eintragNachDemSprechen(ohneNotiz);
    notizNachDemSprechen(notiz);
}

// Wendet den Treffer-Eintrag an, sobald die Figur ausgesprochen hat (oder sofort, wenn
// daten[0].suchwortSofort gesetzt ist bzw. gar kein Gespraech mehr laeuft).
async function eintragNachDemSprechen(e) {
    if (suchwortSofort) { eintragAendern(e); return; }
    await warteBisAusgesprochen();
    console.log("👂→▶️ Suchwort-Eintrag wird jetzt ausgeführt (Figur hat ausgesprochen)");
    eintragAendern(e);
}

// Schreibt alle zurueckgestellten Notizen (in Trefferreihenfolge) ins Notizbuch.
function schreibeOffeneNotizen(grund = "") {
    if (!offeneNotizen.length) return;
    const liste = offeneNotizen;
    offeneNotizen = [];
    console.log("📝 " + liste.length + " zurückgestellte Notiz(en) werden geschrieben" + (grund ? " (" + grund + ")" : ""));
    // Kurze Renderverzoegerung statt der ueblichen 5 s: der Agent ist hier schon fertig,
    // die Notiz soll unmittelbar nach dem Gehoerten im Buch stehen.
    liste.forEach(n => addOrUpdateNotiz(n[0], n[1], n[2], n[3], 400));
}

// Stellt eine Notiz zurueck und schreibt sie, sobald die Figur zu Ende gesprochen hat.
// Anlaufphase, weil onMessage dem Audio vorauslaufen kann (Text liegt vor, bevor der
// Modus auf "speaking" steht). Endet das Gespraech vorher, wird sofort geschrieben,
// damit nie eine Notiz verloren geht.
async function notizNachDemSprechen(notiz, maxMs = 60000, anlaufMs = 2500, graceMs = 800) {
    offeneNotizen.push(notiz);
    await warteBisAusgesprochen(maxMs, anlaufMs, graceMs);
    schreibeOffeneNotizen(convo ? "Figur hat ausgesprochen" : "Gespräch beendet");
}

// Wartet, bis die Figur ihre Aeusserung wirklich gesprochen hat. Die Anlaufphase ist noetig,
// weil onMessage dem Audio vorauslaufen kann: Der Text liegt vor, bevor der Modus ueberhaupt
// auf "speaking" steht - ohne Anlauf waere die Wartezeit sofort vorbei. Endet das Gespraech
// zwischendurch, kehrt die Funktion sofort zurueck, damit nichts verloren geht.
// minSprechMs (optional): vor Ablauf dieser Zeit ab Sprechbeginn gilt ein "listening" nur als
// Pause mitten in der Aeusserung, nicht als Ende.
async function warteBisAusgesprochen(maxMs = 60000, anlaufMs = 2500, graceMs = 800, minSprechMs = 0) {
    const start = Date.now();
    while (convo && agentModus !== "speaking" && Date.now() - start < anlaufMs) {
        await sleep(100);
    }
    const sprechStart = Date.now();
    while (convo && Date.now() - start < maxMs) {
        if (agentModus !== "speaking") {
            await sleep(graceMs);
            if (agentModus !== "speaking" && Date.now() - sprechStart >= minSprechMs) break; // wirklich ausgesprochen
        } else {
            await sleep(150);
        }
    }
}

// Untergrenze der Sprechdauer einer Aeusserung: Audio-Tags [..] zaehlen nicht, ~17 Zeichen/s
// liegt knapp ueber dem gemessenen Tempo (rb-Wolf, eleven_v4_turbo: ~15,5 Zeichen/s).
function geschaetzteSprechMs(text) {
    const reinerText = String(text || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    return Math.round(reinerText.length / 17 * 1000);
}

// --- Abschied des Nutzers (daten[0].abschiedErkennen) ------------------------------
// Sagt der Nutzer "Tschüss" o. ae., ruft das LLM das Ende-Tool oft nicht auf - der Nutzer
// musste sich mehrmals verabschieden. Darum hier am Nutzer-Transkript erkennen: Die Figur
// darf noch antworten, danach wird beendet wie mit '0Ende'. Kam das Tool schneller,
// passiert nichts (safeEndSession markiert das Gespraech).
const ABSCHIED_RE = /(?<!\p{L})(tsch(ü|ue|u)ss?|tschö|tschau|ciao|adieu|auf wieder(sehen|hören|schauen)|bis (später|dann|bald|gleich|morgen)|mach'?s gut|macht'?s gut)(?!\p{L})/iu;
function abschiedPruefen(text, name, convoEintrag) {
    if (!abschiedErkennen || !convo || !ABSCHIED_RE.test(text)) return;
    const c = convo;
    if (c._kzAbschied) return;
    c._kzAbschied = true;
    const ende = (convoEintrag?.schluesselwort || []).some(e => e.wort === "Ende") ? "Ende" : "";
    console.log("👋 Nutzer verabschiedet sich: " + JSON.stringify(text) + " → Gespräch endet nach der Antwort der Figur");
    (async () => {
        await warteBisAusgesprochen(20000, 4000, 800);
        if (convo !== c || c._kzEndeAngefordert) return; // Tool war schneller
        safeEndSession("0" + ende, name);
    })();
}

async function safeEndSession(message, name) {
    if (convo) convo._kzEndeAngefordert = true;
    const num = parseFloat(message);
    const zielStatus = name + "_" + status[name];
    eintrag = daten.find(obj => obj.status === zielStatus);
    const match = message.match(/^[-+]?\d*\.?\d+(.*)$/);
    const schluesselwort = match ? match[1] : "";
    console.log("🚪 safeEnd: " + JSON.stringify(message) + " → Schlüsselwort " + JSON.stringify(schluesselwort)
        + ", Verzögerung " + (isNaN(num) ? 0 : num) + "s, Eintrag " + zielStatus
        + (eintrag ? "" : "  ⚠️ NICHT GEFUNDEN – es wird nur beendet"));

    if (!isNaN(num)) await sleep(num * 1000);
    // Erst beenden, wenn der Agent sicher zu Ende gesprochen hat.
    await warteBisAgentFertigGesprochen();
    if (!convo) return;
    // Zwei Ende-Wege gleichzeitig (Tool + Abschied/Text-Tool) duerfen die End-Aktion
    // nicht doppelt ausfuehren - sonst liefe der Szenenwechsel zweimal.
    if (convo._kzEndeLaeuft) return;
    convo._kzEndeLaeuft = true;

    const convoId = convo.getId();          // vor dem Beenden holen
    try {
        await convo.endSession();
    } catch (err) {
        console.warn("endSession meldete einen Fehler – es wird trotzdem aufgeräumt:", err);
    }
    // Ab hier gilt das Gespraech als beendet, und das muss auch dann gelten, wenn unten
    // etwas schiefgeht: bleibt pruefeWS/convo stehen, haelt das Spiel die Figur fuer
    // besetzt und sie laesst sich nicht mehr anklicken - das Gespraech waere dann
    // scheinbar "nicht zu beenden". Darum zuerst aufraeumen, dann erst handeln.
    convo = null;
    pruefeWS = "";

    try {
        // Exakt bevorzugt; als Fallback tolerant (Groß-/Kleinschreibung, Sonderzeichen) -
        // so trifft auch ein leicht abweichend geschriebener Befehl (z. B. aus
        // gespraech_beenden) den richtigen Eintrag. Leeres Schlüsselwort ("nur beenden")
        // matcht nie und faellt sauber auf den Standard-Abschluss durch.
        const liste = eintrag?.convo?.schluesselwort;
        let treffer = null;
        if (liste) {
            const norm = s => String(s).replace(/[^0-9A-Za-zÄÖÜäöüß]/g, "").toLowerCase();
            treffer = liste.find(u => u.wort == schluesselwort)
                || (schluesselwort ? liste.find(u => norm(u.wort) === norm(schluesselwort)) : null);
            if (schluesselwort && !treffer) {
                console.warn("Kein Schlüsselwort-Treffer für " + JSON.stringify(schluesselwort)
                    + " in " + zielStatus + " | verfügbar: " + JSON.stringify(liste.map(u => u.wort)));
            }
        }
        const anzuwenden = treffer || eintrag?.convo;
        if (anzuwenden) eintragAendern(anzuwenden);
    } catch (err) {
        console.error("Fehler beim Anwenden der End-Aktion – das Gespräch ist trotzdem beendet:", err);
    }

    writeTranscript(convoId, name);
    borderWeg();
}

// --- Notnagel: ausgeschriebene Tool-Aufrufe im Antworttext ------------------------
// Das LLM (qwen35) ruft ein Tool gelegentlich NICHT auf, sondern schreibt den Aufruf als
// Text in seine Antwort:  "Machen Sie, dass Sie wegkommen! [gespraech_beenden(Befehl=
// "schmeicheln")] [skip_turn()]".  Im Client kommt dann kein Tool-Aufruf an - das
// Gespraech liefe weiter, obwohl die Figur sich verabschiedet hat. Solche Aufrufe hier
// aus dem gesprochenen Text herausziehen und dieselbe Aktion ausloesen wie das echte Tool.
// Erkannt werden [tool(...)], (tool(...)) und tool(...) am Satzende; skip_turn wird
// bewusst ignoriert (das Weiterreden verhindert ohnehin das Beenden).
const TEXT_TOOL_RE = /[\[(]?\s*\b(gespraech_beenden|befehl_senden|notiz_protokollieren|ergebnisGespraech)\s*\(([^)]*)\)\s*[\])]?/gi;

// Zieht den Wert eines ausgeschriebenen Parameters: Befehl="x", befehl='x' oder nur "x".
function textToolParameter(roh, ...namen) {
    const inhalt = String(roh ?? "").trim();
    if (!inhalt) return "";
    for (const n of namen) {
        const m = inhalt.match(new RegExp(n + '\\s*[:=]\\s*["\'„“]?([^"\'“”,]+)', 'i'));
        if (m) return bereinigeToolText(m[1]);
    }
    const bloss = inhalt.match(/^["'„]?([^"'“”]+)/);
    return bloss ? bereinigeToolText(bloss[1]) : "";
}

function textToolAufrufe(text, name, convoEintrag) {
    let treffer;
    TEXT_TOOL_RE.lastIndex = 0;
    while ((treffer = TEXT_TOOL_RE.exec(text)) !== null) {
        const werkzeug = treffer[1].toLowerCase();
        const roh = treffer[2] || "";
        const schluessel = werkzeug + "|" + roh;
        if (textToolAusgefuehrt.has(schluessel)) continue;   // pro Gespraech nur einmal
        textToolAusgefuehrt.add(schluessel);
        console.warn("🩹 Tool wurde nur AUSGESPROCHEN statt aufgerufen – wird nachgeholt: "
            + werkzeug + "(" + roh + ")");

        if (werkzeug === "gespraech_beenden") {
            const befehl = textToolParameter(roh, "Befehl", "command", "kommando", "wort");
            safeEndSession("0" + befehl, name);
        } else if (werkzeug === "befehl_senden") {
            const befehl = textToolParameter(roh, "Befehl", "command", "kommando", "wort");
            const match = findeSchluesselwort(befehl, convoEintrag.schluesselwort);
            if (match) eintragAendern(match);
            else console.warn("Kein Befehl-Treffer für:", JSON.stringify(befehl));
        } else if (werkzeug === "notiz_protokollieren") {
            const notiz = textToolParameter(roh, "notiz_text", "notiz", "text", "inhalt");
            if (notiz) addOrUpdateNotiz(name, status[name], notiz, "");
        } else if (werkzeug === "ergebnisgespraech") {
            const msg = textToolParameter(roh, "message", "nachricht", "text");
            if (msg.startsWith("0")) safeEndSession(msg, name);
            else if (msg.startsWith("1")) {
                const match = findeSchluesselwort(msg, convoEintrag.schluesselwort);
                if (match) eintragAendern(match);
            } else if (msg) addOrUpdateNotiz(name, status[name], msg, "");
        }
    }
}

// --- Hilfen fuer die neuen Client-Tools ------------------------------------------
// Saeubert vom Modell/TTS eingeschleuste unsichtbare Zeichen (BOM U+FEFF,
// Zero-Width U+200B..U+200D) und umgebenden Leerraum - sonst bricht der exakte
// Vergleich, obwohl das Log scheinbar den reinen Text zeigt.
function bereinigeToolText(s) {
    return (s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

// Die neuen Client-Tools erhalten ein Argument-Objekt, dessen Parametername in
// ElevenLabs frei vergeben wird. Robust den ersten sinnvollen String-Wert ziehen:
// erst bekannte Schluessel in Reihenfolge, sonst irgendeinen nicht-leeren String.
function toolArgWert(args, ...bevorzugt) {
    if (args == null) return "";
    if (typeof args === "string") return args;
    for (const k of bevorzugt) {
        if (args[k] != null && String(args[k]).trim() !== "") return String(args[k]);
    }
    for (const v of Object.values(args)) {
        if (typeof v === "string" && v.trim() !== "") return v;
    }
    return "";
}

// Sucht in der schluesselwort-Liste eines convo-Eintrags den passenden Befehl
// (tolerant: exakt, dann ohne Sonderzeichen/Groß-klein, zuletzt als Praefix) - gleiche
// Logik wie der "1"-Zweig von ergebnisGespraech. Kein Schluesselwort ist Praefix eines
// anderen -> eindeutig.
function findeSchluesselwort(befehl, liste) {
    const schluesselwoerter = liste || [];
    const norm = s => String(s).replace(/[^0-9A-Za-zÄÖÜäöüß]/g, "").toLowerCase();
    return schluesselwoerter.find(e => e.wort === befehl)
        || schluesselwoerter.find(e => norm(e.wort) === norm(befehl))
        || schluesselwoerter.find(e => e.wort && norm(befehl).startsWith(norm(e.wort)))
        || null;
}

function borderWeg() {
    mundStop();   // eine noch laufende Lippenbewegung darf den Bildwechsel unten nicht stoeren
    const container = document.querySelector('.personen');
    if (container) {
        // <img> UND <video>-Figuren zuruecksetzen. Per bild_neu getauschte Figuren
        // (z. B. koehlerAengstlich.mp4) sind <video> - wuerden sie hier fehlen, blieben
        // sie beim erneuten Klick vergroessert stehen (kein scale(1)-Reset).
        const images = container.querySelectorAll('img, video');
        images.forEach(img => {
            // denk.png und das laufende Aktivierungs-Video überspringen
            if (img.src && img.src.includes("denk.png")) return;
            if (img.classList && img.classList.contains("figur-aktivierung-video")) return;
            img.style.border = "3px solid white";
            // Inline-Transition (2,5s beim Vergroessern) loeschen -> Verkleinern nutzt
            // wieder die schnelle CSS-Transition (0,5s).
            img.style.transition = "";
            img.style.transform = `scale(1)`;
            img.style.boxShadow = "none";
            img.style.zIndex = "2";
            // Portrait-Variante: nach dem Deaktivieren wieder das Portrait <name>-p.png
            // zeigen und den Aktiv-Merker loeschen (naechster Klick spielt das Video neu).
            if (img.dataset && img.dataset.pSrc) {
                img.src = img.dataset.pSrc;
                img.dataset.aktiv = "";
            }
        });
        // Ein evtl. noch laufendes Figuren-Aktivierungs-Video entfernen.
        container.querySelectorAll('video.figur-aktivierung-video').forEach(v => v.remove());
        // Vordergrund-Hebung der vergroesserten Figur wieder zuruecknehmen.
        container.querySelectorAll('.bild-mit-overlay').forEach(c => { c.style.zIndex = ""; });
    }
}

// Figur mit Portrait-Variante (<name>-p.png) wird aktiviert: <name>.mp4 startet an der
// Stelle der Figur und vergroessert sich synchron WAEHREND die Figur vergroessert wird
// (gleiche 2,5s-Transition, gleicher Skalierungsfaktor). Nach dem Video wird auf das
// Standbild <name>.png umgeschaltet und das Video entfernt. Ohne Portrait-Variante
// (kein dataset.pSrc) oder wenn die Figur schon aktiv ist, passiert nichts. Laeuft nicht
// blockierend - der Gespraechsstart im Aufrufer wartet nicht auf das Videoende.
function spieleFigurAktivierung(elem, zielScale) {
    if (!elem || !elem.dataset || !elem.dataset.pSrc) {
        // Ohne <name>-p.png gibt es bewusst kein Video. Trotzdem melden, sonst bleibt
        // unklar, warum der Uebergang ausbleibt.
        if (elem && elem.id) console.log("🎬 kein Aktivierungs-Video für " + elem.id
            + " (keine Portrait-Variante " + elem.id + "-p.png gefunden)");
        return;
    }
    if (elem.dataset.aktiv === "1") {
        // Der Merker verhindert ein zweites Video, solange die Figur vergroessert ist.
        // Blieb er faelschlich stehen (ein Ende ohne borderWeg), spielte die Figur nie
        // wieder ein Video ab - genau das Symptom "nach einer Weile kommt kein mp4 mehr".
        // Darum gegen den tatsaechlichen Zustand pruefen: ist die Figur gar nicht mehr
        // vergroessert, war der Merker verwaist und wird verworfen.
        const tr = elem.style.transform || "";
        const nochGross = tr.includes("scale(") && !/scale\(\s*1\s*\)/.test(tr);
        if (nochGross) return;
        console.warn("🎬 Aktiv-Merker von " + elem.id + " war hängengeblieben – wird zurückgesetzt.");
    }
    elem.dataset.aktiv = "1";

    const aktivSrc = elem.dataset.aktivSrc;
    const videoSrc = elem.dataset.videoSrc;
    const containerElem = elem.parentNode;
    if (!containerElem) { if (aktivSrc) elem.src = aktivSrc; return; }
    const skala = zielScale ?? 2;

    // Reste eines frueheren Aktivierungs-Videos entfernen (schnelles Re-Klick).
    containerElem.querySelectorAll("video.figur-aktivierung-video").forEach(v => v.remove());

    // Video deckungsgleich ueber der (noch kleinen) Figur platzieren.
    const video = document.createElement("video");
    video.className = "figur-aktivierung-video";
    video.src = videoSrc;
    video.playsInline = true;
    video.autoplay = true;
    video.muted = true; // Das Figuren-Video laeuft grundsaetzlich ohne Ton.
    Object.assign(video.style, {
        position: "absolute",
        // WIE DAS BILD rechnen: <img> nutzt content-box, ein dickerer Rahmen macht es also
        // insgesamt groesser (168 + 2x5 = 178). Mit border-box waere das Video bei jedem
        // Rahmenwechsel (3px -> 5px beim Gespraechsstart) unten zu kurz - oben blieb es
        // buendig, weil beide an "top" haengen, unten liefen sie auseinander.
        boxSizing: "content-box",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        objectFit: "fill", // mp4 wird in die Box gestreckt -> Seitenverhaeltnis = ziel.png
        opacity: "0",
        zIndex: "6",
        pointerEvents: "none",
        borderRadius: "10px",
        transformOrigin: "center center",
        transition: "transform 2.5s ease, opacity 0.5s ease",
        transform: "scale(1)"
    });
    containerElem.appendChild(video);

    // Seitenverhaeltnis der Ziel-<name>.png ermitteln (asynchron). Solange unbekannt,
    // dient die aktuelle Bildbox als Naeherung.
    let zielAspect = 0; // Breite / Hoehe der ziel.png
    const zielBild = new Image();
    zielBild.onload = () => {
        if (zielBild.naturalHeight > 0) {
            zielAspect = zielBild.naturalWidth / zielBild.naturalHeight;
            angleichen();
        }
    };
    zielBild.src = aktivSrc;

    // Video an das Bild angleichen (nicht an den ganzen Container): ein inline-<img> laesst
    // unten eine Baseline-Luecke und der Container ist um die Bild-Border groesser - beides
    // wuerde das Video verschieben. Die Video-BREITE folgt dem Seitenverhaeltnis der
    // ziel.png (per object-fit:fill wird das mp4 hineingestreckt, sein Groessenverhaeltnis
    // also an die ziel.png angepasst) und wird in der Bildbox horizontal zentriert. Zugleich
    // Rahmen der Figur spiegeln (der Aufrufer setzt border/boxShadow ERST nach diesem Aufruf
    // und aendert sie bei say/convo). offset* ignoriert das transform -> unskalierte Box.
    const angleichen = () => {
        video.style.border = elem.style.border;
        video.style.borderRadius = elem.style.borderRadius || "10px";
        video.style.boxShadow = elem.style.boxShadow;
        if (elem.offsetWidth > 0 && elem.offsetHeight > 0) {
            // Gerechnet wird mit den INHALTSMASSEN des Bildes (clientWidth/-Height, also
            // ohne Rahmen) - das Video nutzt dieselbe content-box, sein Rahmen legt sich
            // aussen an wie beim Bild. Die Breite folgt dem Seitenverhaeltnis der ziel.png,
            // weil gerade noch das Portrait <name>-p.png zu sehen sein kann.
            const innenH = elem.clientHeight;
            const innenW = zielAspect > 0 ? Math.round(innenH * zielAspect) : elem.clientWidth;
            video.style.height = innenH + "px";
            video.style.width = innenW + "px";
            video.style.top = elem.offsetTop + "px";
            // Waagerecht im Bild zentrieren, falls das Ziel-Seitenverhaeltnis vom aktuell
            // gezeigten Bild abweicht; bei gleichem Verhaeltnis liegt es exakt buendig.
            video.style.left = (elem.offsetLeft + (elem.clientWidth - innenW) / 2) + "px";
        }
    };
    angleichen();
    const rahmenBeobachter = new MutationObserver(angleichen);
    rahmenBeobachter.observe(elem, { attributes: true, attributeFilter: ["style"] });
    // Der Aufrufer setzt Rahmen und Skalierung ERST NACH diesem Aufruf, und beim
    // Gespraechsstart wechselt der Rahmen noch einmal von 3px auf 5px. Weil das Bild mit
    // content-box rechnet, aendert sich dabei seine Gesamthoehe - das Video muss also
    // nachziehen, sonst steht seine Unterkante 4px zu hoch. Der MutationObserver allein
    // kann ein knappes Timing verpassen, darum in den naechsten Frames (und einmal spaet)
    // erneut angleichen. Ein ResizeObserver fasst zusaetzlich Groessenaenderungen ab, die
    // ohne Style-Attribut passieren (Fenstergroesse, Layout).
    requestAnimationFrame(angleichen);
    requestAnimationFrame(() => requestAnimationFrame(angleichen));
    setTimeout(angleichen, 300);
    let groessenBeobachter = null;
    if (typeof ResizeObserver === "function") {
        groessenBeobachter = new ResizeObserver(angleichen);
        groessenBeobachter.observe(elem);
    }

    // Reflow erzwingen, damit scale(1) zuerst festgeschrieben ist - sonst setzt der
    // Browser Anfangs- und Endwert im selben Durchlauf und das Video springt schlagartig
    // auf die Endgroesse, statt ueber 2,5s zu wachsen.
    void video.getBoundingClientRect();
    // Video ueber 0,5s einblenden und synchron mit der Figur ueber 2,5s hochskalieren.
    video.style.opacity = "1";
    video.style.transform = `scale(${skala})`;

    let fertig = false;
    const beenden = () => {
        if (fertig) return;
        fertig = true;
        // Standbild <name>.png unter das Video legen, dann Video ueber 0,5s ausblenden -
        // kein Flackern, denn darunter liegt bereits das gleich grosse, vergroesserte Bild.
        if (aktivSrc) elem.src = aktivSrc;
        video.style.opacity = "0";
        setTimeout(() => {
            rahmenBeobachter.disconnect();
            if (groessenBeobachter) groessenBeobachter.disconnect();
            video.remove();
        }, 500);
    };
    video.addEventListener("ended", beenden);
    video.addEventListener("error", beenden);
    // Sicherheits-Timeout, falls "ended" nie feuert (z. B. fehlende Datei).
    setTimeout(beenden, 20000);
    // Stumm (muted) -> Autoplay ist immer erlaubt. Scheitert es trotzdem (fehlende Datei,
    // zu viele gleichzeitig dekodierte Videos), wurde das bisher still verschluckt - der
    // Uebergang blieb ohne jeden Hinweis aus. Darum den Grund melden.
    video.play().catch(err => {
        console.warn("🎬 " + (elem.id || "Figur") + ": Aktivierungs-Video startet nicht ("
            + (err && err.name ? err.name + ": " + err.message : err) + ") – Quelle: " + videoSrc);
        beenden();
    });
}


// --- Lippenbewegung ------------------------------------------------------------------
// Liegt neben dem Figurenbild <name>.png ein <name>-mund.png (gleicher Ausschnitt, nur der
// Mund offen), wird waehrend des Sprechens zwischen beiden umgeschaltet. Die Animation
// haengt AUSSCHLIESSLICH an dieser Datei: fehlt sie, passiert exakt wie bisher nichts -
// der 404 beim Pruefen ist gewollt, genau wie der beim Portrait <name>-p.png.
//
// Der Pegel kommt im Gespraech aus dem SDK (convo.getOutputVolume(), 0..1), der Mund
// oeffnet sich also silbengenau. Kennt das SDK die Methode nicht, klappert der Mund
// gleichmaessig weiter, solange die Figur spricht.
//
// Der Mund steht beim Sprechen nie still, sondern wechselt in unregelmaessigen Abstaenden
// zwischen zwei Stellungen - das ist der Unterschied zwischen einer aufgerissenen Maske und
// jemandem, der spricht. MIT -mund2.png (halb geschlossen) gibt es drei Stufen:
//   Stille        -> Mund zu
//   leise         -> Wechsel zwischen ZU und HALB   (gemurmelte Silben, kleine Bewegung)
//   laut          -> Wechsel zwischen OFFEN und HALB (betonte Silben, grosse Bewegung)
// Ohne -mund2.png bleibt es bei einer Stufe: Wechsel zwischen OFFEN und ZU.
//
// "Laut" wird NICHT an einem festen Pegel festgemacht, sondern an der Spitze der letzten
// Sekunden: Stimmen und Aufnahmen sind unterschiedlich laut, ein absoluter Wert muesste je
// Figur nachgezogen werden. Die Spitze faellt langsam ab, damit auf einen lauten Satz nicht
// minutenlang alles als "leise" gilt.
const MUND_SCHWELLE = 0.05;   // ab diesem Pegel gilt der Mund als offen
const MUND_TAKT = 40;         // ms zwischen zwei Pruefungen (25/s - fein genug zum Wechseln)
const MUND_KLAPPERN = 260;    // ms fuer eine Auf-Zu-Runde im Ersatzbetrieb ohne Pegel
const MUND_HALT_MIN = 90;     // kuerzeste Standzeit einer Mundstellung beim Sprechen
const MUND_HALT_MAX = 200;    // laengste - der Zufall dazwischen macht es unrhythmisch
// Der Anteil bestimmt die Mischung: hoch = die grosse Mundbewegung (offen<->halb) bleibt
// den wenigen betonten Silben vorbehalten, der Rest laeuft ueber zu<->halb. 0.8 heisst,
// dass nur Silben im obersten Fuenftel der aktuellen Pegelspitze als laut gelten.
const MUND_LAUT_ANTEIL = 0.9; // ab diesem Anteil der Pegelspitze gilt eine Silbe als laut
const MUND_LAUT_MIN = 0.10;   // ... aber nie unterhalb dieses absoluten Pegels
const MUND_SPITZE_ZERFALL = 0.999;  // je Takt - die Spitze haelt rund eine halbe Minute
// Zwinkern (optionales <name>-zwinkert.png): nur beim ZUHOEREN, nie waehrend die Figur
// spricht - waehrend des Sprechens gehoert das Bild der Mundanimation.
const ZWINKER_MIN = 2000;     // kuerzeste Pause zwischen zwei Zwinkern
const ZWINKER_MAX = 8000;     // laengste
const ZWINKER_DAUER = 300;    // wie lange das Auge zu bleibt
let mundTimer = null;
let mundElem = null;          // die gerade animierte Figur
let mundZu = null;            // Bildquelle mit geschlossenem Mund
let mundAuf = null;           // Bildquelle mit offenem Mund
let mundHalb = null;          // zweite Sprechstellung: -mund2.png oder ersatzweise mundZu
let mundFelder = null;        // alle Felder der Figurenkarte (Name -> Adresse)
let mundStimmung = null;      // Adresse des aktuellen Stimmungsfeldes, sonst null
let mundOhnePegel = false;    // SDK liefert keine Lautstaerke -> Ersatzbetrieb

// Zufaellige Standzeit, damit der Mund nicht im Metronom klappert.
function mundHaltedauer() {
    return MUND_HALT_MIN + Math.random() * (MUND_HALT_MAX - MUND_HALT_MIN);
}

// Absolute Form, damit sich img.src (immer absolut) mit unseren Pfaden vergleichen laesst.
function mundAbs(pfad) {
    try { return new URL(pfad, location.href).href; } catch (e) { return pfad; }
}

// Stamm des aktuell gezeigten Figurenbildes ohne ".png".
function mundStamm(elem) {
    // Bei einer Figurenkarte zeigt aktivSrc auf ein ausgeschnittenes Feld (blob:) - der
    // urspruengliche Stamm wird darum gemerkt.
    if (elem.dataset.gesichtStamm) return elem.dataset.gesichtStamm;
    const q = elem.dataset.aktivSrc || elem.getAttribute("src") || "";
    if (!/\.png$/i.test(q)) return "";              // Video oder kein Bild -> keine Animation
    return q.replace(/\.png$/i, "").replace(/-mund2?$/i, "");
}

// --- Figurenkarte -----------------------------------------------------------------------
// Liegt neben <name>.png eine <name>_map.png, kommen alle Gesichtsausdruecke aus DIESER
// einen Tafel: In der ersten Reihe stehen die vier Felder [0, mund2, mund, zwinkert].
// Das spart Downloads und vor allem das Nachladen mitten im Sprechen.
//
// Die Felder werden selbst gefunden, die Tafel darf also Beschriftungen und Abstaende haben:
// Gezaehlt wird je Zeile und Spalte der Anteil der Punkte, die nicht heller Hintergrund
// sind. Die Felder ergeben breite Baender, Beschriftungen bleiben unter der Mindestgroesse.
// Bedeutung der Felder, Reihe fuer Reihe. Reihe 1 steuert Mund und Augen, die weiteren
// Reihen sind Stimmungen (siehe STIMMUNG_ZU_FELD). Eine Karte darf weniger Reihen haben -
// dann gibt es die fehlenden Stimmungen eben nicht.
const KARTE_FELDER = [
    ["null", "mund2", "mund", "zwinkert"],
    ["heiter", "hocherfreut", "traurig", "aengstlich"],
    ["wuetend", "unsicher", "fluesternd", "listig"]
];
const KARTE_REIHE1 = KARTE_FELDER[0];
const KARTE_HELL = 235;       // ab hier gilt ein Punkt als heller Hintergrund
const KARTE_ANTEIL = 0.25;    // so viel einer Zeile/Spalte muss belegt sein
const KARTE_MINDEST = 0.05;   // Baender unter 5 % der Bildkante sind Beschriftung

function kartenBaender(werte, mindest) {
    const b = [];
    let start = null;
    for (let i = 0; i < werte.length; i++) {
        if (werte[i] > KARTE_ANTEIL) { if (start === null) start = i; }
        else if (start !== null) { if (i - start >= mindest) b.push([start, i]); start = null; }
    }
    if (start !== null && werte.length - start >= mindest) b.push([start, werte.length]);
    return b;
}

// Schneidet die erste Reihe der Tafel in einzelne Bilder und liefert deren Adressen.
function kartenFelderSchneiden(bild) {
    const B = bild.naturalWidth, H = bild.naturalHeight;
    const c = document.createElement("canvas");
    c.width = B; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bild, 0, 0);
    let d;
    try { d = ctx.getImageData(0, 0, B, H).data; }
    catch (e) { console.warn("🗺️ Figurenkarte nicht lesbar:", e); return null; }

    const zeile = new Float32Array(H), spalte = new Float32Array(B);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < B; x++) {
            const i = (y * B + x) * 4;
            if (Math.min(d[i], d[i + 1], d[i + 2]) < KARTE_HELL) { zeile[y]++; spalte[x]++; }
        }
    }
    for (let y = 0; y < H; y++) zeile[y] /= B;
    for (let x = 0; x < B; x++) spalte[x] /= H;

    const reihen = kartenBaender(zeile, H * KARTE_MINDEST);
    const spalten = kartenBaender(spalte, B * KARTE_MINDEST);
    if (!reihen.length || spalten.length < KARTE_REIHE1.length) {
        console.warn("🗺️ Figurenkarte: Raster nicht erkannt (" + reihen.length + " Reihen, "
            + spalten.length + " Spalten) - es gelten wieder die Einzelbilder.");
        return null;
    }

    // ALLE Felder bekommen die Groesse von Feld 0. Die erkannten Baender sind je Reihe und
    // Spalte ein bis zwei Punkte unterschiedlich gross; da ein <img> seine Abmessungen aus
    // dem Bild zieht, wuerde die Figur bei jedem Wechsel minimal groesser oder schmaler -
    // genau das Zucken, das man im Spiel sieht. Geschnitten wird ab der linken oberen Ecke
    // des jeweiligen Feldes, es wird also nichts verzerrt, hoechstens ein Punkt abgeschnitten.
    const FB = spalten[0][1] - spalten[0][0];
    const FH = reihen[0][1] - reihen[0][0];
    const felder = {};
    const auftraege = [];
    reihen.forEach(([y0, y1], r) => {
        const namen = KARTE_FELDER[r];
        if (!namen) return;                       // mehr Reihen als benannt -> ignorieren
        namen.forEach((name, i) => {
            if (!spalten[i]) return;
            const x0 = Math.min(spalten[i][0], B - FB);
            const oy = Math.min(y0, H - FH);
            const z = document.createElement("canvas");
            z.width = FB; z.height = FH;
            z.getContext("2d").drawImage(bild, x0, oy, FB, FH, 0, 0, FB, FH);
            auftraege.push(new Promise(fertig => z.toBlob(blob => {
                felder[name] = blob ? URL.createObjectURL(blob) : null;
                fertig();
            }, "image/png")));
        });
    });
    const [y0, y1] = reihen[0];
    return Promise.all(auftraege).then(() => {
        console.log("🗺️ Figurenkarte gelesen: " + reihen.length + " Reihen x " + spalten.length
            + " Spalten, alle Felder " + FB + "x" + FH
            + " - Felder: " + Object.keys(felder).join(", "));
        return felder;
    });
}

// Sucht die Tafel und richtet die Figur darauf ein. Ohne Tafel passiert nichts.
async function kartenFelderLaden(elem, stamm) {
    const bild = new Image();
    const da = await new Promise(fertig => {
        bild.onload = () => fertig(true);
        bild.onerror = () => fertig(false);   // keine Tafel: voellig in Ordnung
        bild.src = stamm + "_map.png";
    });
    if (!da) return null;
    const felder = await kartenFelderSchneiden(bild);
    if (!felder || !felder.null) return null;
    elem.dataset.kartenFelder = JSON.stringify(felder);
    // Ab jetzt ist die Tafel die Quelle fuer das Gesicht - auch fuer den Ruhezustand. Sonst
    // spraenge die Figur beim ersten Wechsel, denn die Felder sind anders beschnitten als
    // das grosse Einzelbild.
    const altAktiv = elem.dataset.aktivSrc;
    elem.dataset.aktivSrc = felder.null;
    // Nur umschalten, wenn gerade das grosse Einzelbild zu sehen ist. Ein Portrait
    // (<name>-p.png) oder ein Video bleibt stehen - das gehoert der Aktivierung.
    const zeigtGrundbild = (altAktiv && elem.src === mundAbs(altAktiv))
        || elem.src === mundAbs(stamm + ".png");
    if (zeigtGrundbild) elem.src = felder.null;
    return felder;
}

// Beim Spielstart einmal je Figur nachsehen, ob es eine Figurenkarte gibt. Wenn ja, zeigt
// die Figur sofort Feld 0 - sonst sähe sie bis zum ersten Sprechen anders aus als danach,
// weil die Kartenfelder enger beschnitten sind als das grosse Einzelbild. Gibt es keine
// Karte, passiert nichts: die Einzelbilder werden wie gehabt erst beim Sprechen gesucht.
async function gesichtVorbereiten(elem, stamm) {
    if (!elem || elem.tagName !== "IMG" || elem.dataset.mundFuer === stamm) return;
    const karte = await kartenFelderLaden(elem, stamm);
    if (!karte) return;
    elem.dataset.gesichtStamm = stamm;
    elem.dataset.mundFuer = stamm;
    elem.dataset.mundSrc = karte.mund || "";
    elem.dataset.mund2Src = karte.mund2 || "";
    elem.dataset.zwinkerSrc = karte.zwinkert || "";
    console.log("🗺️ " + elem.id + " zeigt ab sofort Feld 0 der Figurenkarte");
}

function gesichterVorbereiten() {
    configAgent.forEach(agent => {
        // Stamm aus dem Figurennamen, nicht aus dem aktuellen src: Beim Start steht dort
        // unter Umstaenden noch das Portrait <name>-p.png.
        gesichtVorbereiten(document.getElementById(agent.name), basis + "imgEleven/" + agent.name);
    });
}

// Laedt ein Bild und meldet, ob es existiert - das Vorladen verhindert zugleich, dass der
// erste Wechsel flackert.
function mundBildPruefen(quelle) {
    return new Promise(resolve => {
        const test = new Image();
        test.onload = () => resolve(quelle);
        test.onerror = () => resolve(null);          // bewusst still: Datei ist optional
        test.src = quelle;
    });
}

// Prueft EINMAL je Bildstamm, welche Mundbilder es gibt: -mund.png schaltet die Animation
// ueberhaupt erst ein, -mund2.png ist die optionale zweite Sprechstellung. Das Ergebnis
// haengt am Element, wird also nicht bei jedem Satz neu geladen.
async function mundBildLaden(elem) {
    if (!elem || elem.tagName !== "IMG" || !elem.dataset) return null;
    const stamm = mundStamm(elem);
    if (!stamm) return null;
    if (elem.dataset.mundFuer !== stamm) {
        // Zuerst die Figurenkarte; nur wenn es keine gibt, zaehlen die Einzelbilder.
        const karte = await kartenFelderLaden(elem, stamm);
        const auf = karte ? karte.mund : await mundBildPruefen(stamm + "-mund.png");
        const halb = karte ? karte.mund2
                           : (auf ? await mundBildPruefen(stamm + "-mund2.png") : null);
        const zwinkert = karte ? karte.zwinkert : await mundBildPruefen(stamm + "-zwinkert.png");
        elem.dataset.gesichtStamm = stamm;
        elem.dataset.mundFuer = stamm;
        elem.dataset.mundSrc = auf || "";
        elem.dataset.mund2Src = halb || "";
        elem.dataset.zwinkerSrc = zwinkert || "";
        if (auf) {
            console.log("👄 Lippenbewegung für " + elem.id + " aktiv"
                + (karte ? " (aus der Figurenkarte)"
                         : (halb ? " (zwei Sprechstellungen)" : " (offen/zu – kein -mund2.png)")));
        }
        if (zwinkert) console.log("😉 Zwinkern für " + elem.id + " aktiv");
    }
    return elem.dataset.mundSrc || null;
}


// --- Stimmung aus dem Live-Transkript ---------------------------------------------------
// Die Figur stellt ihren Antworten Audio-Tags voran ([excited], [angry] ...). Gibt es zu
// einem davon ein Stimmungsfeld auf der Karte, wird dieses Feld zum Gesicht der Figur -
// es ersetzt also das Ruhebild (Feld 0), waehrend Mund und Augen weiter animiert werden.
// Es zaehlt der LETZTE passende Tag einer Aeusserung; passt keiner, gilt wieder Feld 0.
//
// Bewusst auf kein Feld gelegt (also Feld 0) sind: Akzente, reine Geraeusche (Raeuspern,
// Schlucken), Sprechtempo und schwache Faerbungen wie "curious" oder "quietly". Sonst
// zappelt das Gesicht bei jedem zweiten Satz, statt die wirklich starken Momente zu zeigen.
const STIMMUNG_ZU_FELD = {
    // heiter - freundlich, aufgeraeumt
    "warm": "heiter", "amused": "heiter", "chuckles": "heiter", "gently": "heiter",
    "playful": "heiter", "brightly": "heiter", "relieved": "heiter", "eager": "heiter",
    "admiring": "heiter", "impressed": "heiter", "happy": "heiter", "friendly": "heiter",
    // hocherfreut - begeistert, laut freudig
    "excited": "hocherfreut", "laughs": "hocherfreut", "delighted": "hocherfreut",
    "triumphant": "hocherfreut", "surprised": "hocherfreut", "joyful": "hocherfreut",
    // traurig - niedergeschlagen
    "sad": "traurig", "crying": "traurig", "sniffles": "traurig", "resigned": "traurig",
    "voice breaking": "traurig", "vulnerable": "traurig", "pleading": "traurig",
    "melancholic": "traurig", "sorrowful": "traurig",
    // aengstlich - Angst, Anspannung
    "scared": "aengstlich", "nervous": "aengstlich", "anxious": "aengstlich",
    "shaky voice": "aengstlich", "breathes shakily": "aengstlich", "worried": "aengstlich",
    "tense": "aengstlich", "swallows": "aengstlich", "stammers": "aengstlich",
    "reluctant": "aengstlich", "timid": "aengstlich", "panicked": "aengstlich",
    // wuetend - hart, abweisend, zornig
    "angry": "wuetend", "indignant": "wuetend", "shouting": "wuetend", "snippy": "wuetend",
    "bitter": "wuetend", "cold": "wuetend", "icy": "wuetend", "stern": "wuetend",
    "scoffs": "wuetend", "dismissive": "wuetend", "disgusted": "wuetend",
    "annoyed": "wuetend", "curt": "wuetend", "clipped": "wuetend", "furious": "wuetend",
    "condescending": "wuetend", "jealous": "wuetend",
    // unsicher - zoegernd, verlegen
    "unsure": "unsicher", "uncertain": "unsicher", "hesitant": "unsicher",
    "shy": "unsicher", "uneasy": "unsicher", "mumbles": "unsicher",
    "defensive": "unsicher", "muttering": "unsicher", "embarrassed": "unsicher",
    // fluesternd - gedeckt, verschwoererisch
    "whispers": "fluesternd", "hushed": "fluesternd", "lowers voice": "fluesternd",
    "whispering": "fluesternd", "conspiratorial": "fluesternd",
    // listig - spitzbuebisch, spoettisch
    "smug": "listig", "sarcastic": "listig", "mocking": "listig", "teasing": "listig",
    "sly": "listig", "knowing": "listig", "cunning": "listig"
};

// Sucht im Text der Figur den letzten Tag mit Stimmungsfeld und setzt das Gesicht danach.
function gesichtStimmung(text) {
    if (!mundElem || !mundFelder) return;
    let feld = null;
    const treffer = String(text).match(/\[[^\]]{1,30}\]/g) || [];
    for (const roh of treffer) {
        const name = STIMMUNG_ZU_FELD[roh.slice(1, -1).trim().toLowerCase()];
        if (name && mundFelder[name]) feld = name;    // der letzte Treffer gewinnt
    }
    const neu = feld ? mundFelder[feld] : null;
    if (neu === mundStimmung) return;
    mundStimmung = neu;
    console.log("🎭 Stimmung: " + (feld || "keine – Feld 0"));
}
// pegelFn liefert 0..1 - oder null, wenn die Quelle zu Ende ist (dann endet die Animation).
// ruhigFn (optional) meldet, ob die Figur gerade ZUHOERT - nur dann wird gezwinkert.
async function mundStart(elem, pegelFn, ruhigFn) {
    mundStop();
    const auf = await mundBildLaden(elem);
    const zwinkert = elem && elem.dataset ? (elem.dataset.zwinkerSrc || null) : null;
    if (!auf && !zwinkert) return;               // weder Mund- noch Zwinkerbild -> nichts tun
    mundElem = elem;
    mundAuf = auf;
    mundZu = elem.dataset.aktivSrc || elem.getAttribute("src");
    // Zweite Sprechstellung: der halb geschlossene Mund, sonst das geschlossene Bild.
    mundHalb = elem.dataset.mund2Src || mundZu;
    // Stimmungsfelder der Karte (falls vorhanden). Jedes Gespraech faengt ohne Stimmung an.
    try { mundFelder = JSON.parse(elem.dataset.kartenFelder || "null"); }
    catch (e) { mundFelder = null; }
    mundStimmung = null;
    // Das Portrait <name>-p.png gehoert mit in die Liste: Bei Figuren mit Aktivierungs-Video
    // steht es noch im Bild, wenn das Gespraech startet (auf <name>.png wird erst am Ende des
    // Videos umgeschaltet). Ohne diesen Eintrag haette die Schleife das fuer einen fremden
    // Bildtausch gehalten und sich sofort beendet - die Figur haette nie den Mund bewegt.
    const portrait = elem.dataset.pSrc || null;
    // Alle Bilder, die uns gehoeren duerfen - inklusive saemtlicher Kartenfelder, sonst
    // haelte die Schleife ein Stimmungsfeld fuer einen fremden Bildtausch.
    const eigene = [mundZu, mundAuf, mundHalb, zwinkert, portrait]
        .concat(mundFelder ? Object.values(mundFelder) : [])
        .filter(Boolean).map(mundAbs);
    const portraitAbs = portrait ? mundAbs(portrait) : null;
    let zwinkerBis = 0;         // Auge ist bis zu diesem Zeitpunkt zu
    let zwinkerAb = Date.now() + ZWINKER_MIN + Math.random() * (ZWINKER_MAX - ZWINKER_MIN);
    // Ohne -mund2.png gibt es nur eine Stufe (offen/zu) - dann zaehlt jedes Sprechen als laut.
    const dreiStufen = !!elem.dataset.mund2Src;
    let spricht = false;        // steht der Mund gerade in einer Sprechstellung?
    let ersteStellung = true;   // true = die vom Pegel abhaengige, false = der halbe Mund
    let bisWann = 0;            // Zeitpunkt, an dem die Stellung wechseln darf
    let spitze = 0;             // Pegelspitze der letzten Sekunden
    mundTimer = setInterval(() => {
        if (!mundElem || !mundElem.isConnected) { mundStop(); return; }
        // Hat etwas anderes das Bild getauscht (bild_neu, borderWeg), gehoert es uns nicht
        // mehr - dann sofort aussteigen, statt den fremden Tausch zu ueberschreiben.
        if (!eigene.includes(mundElem.src)) { mundStop(true); return; }
        // Noch im Portrait: Die Aktivierung schaltet gleich auf das grosse Bild um - bis
        // dahin nichts anfassen, sonst springt die Figur mitten im Video.
        if (portraitAbs && mundElem.src === portraitAbs) return;
        let pegel = 0;
        try { pegel = pegelFn(); } catch (e) { pegel = null; }
        if (pegel === null || pegel === undefined) { mundStop(); return; }

        const jetztMs = Date.now();
        // Ruhebild ist normalerweise Feld 0 - liegt eine Stimmung an, tritt deren Feld an
        // seine Stelle. Mund und Augen werden darueber unveraendert weiter animiert.
        const ruhe = mundStimmung || mundZu;
        if (pegel <= MUND_SCHWELLE) {                // Stille: Mund zu
            if (spricht || mundElem.src !== mundAbs(ruhe)) {
                spricht = false;
                if (!zwinkerBis) mundElem.src = ruhe;
            }
            // Zwinkern nur, wenn die Figur wirklich zuhoert - eine kurze Sprechpause
            // mitten im Satz zaehlt nicht dazu (ruhigFn meldet dann weiter "spricht").
            if (zwinkert && ruhigFn && ruhigFn()) {
                let ziel = ruhe;
                if (zwinkerBis) {
                    if (jetztMs < zwinkerBis) ziel = zwinkert;
                    else {
                        zwinkerBis = 0;
                        zwinkerAb = jetztMs + ZWINKER_MIN + Math.random() * (ZWINKER_MAX - ZWINKER_MIN);
                    }
                } else if (jetztMs >= zwinkerAb) {
                    zwinkerBis = jetztMs + ZWINKER_DAUER;
                    ziel = zwinkert;
                }
                if (mundElem.src !== mundAbs(ziel)) mundElem.src = ziel;
            } else if (zwinkerBis) {                 // Sprechen faengt an: Auge sofort auf
                zwinkerBis = 0;
                if (mundElem.src === mundAbs(zwinkert)) mundElem.src = ruhe;
            }
            return;
        }
        if (!mundAuf) return;                        // nur Zwinkerbild vorhanden, kein Mund

        spitze = Math.max(pegel, spitze * MUND_SPITZE_ZERFALL);
        const laut = !dreiStufen
            || pegel >= Math.max(MUND_LAUT_MIN, spitze * MUND_LAUT_ANTEIL);
        // Laute Silbe: offen <-> halb. Leise Silbe: Ruhebild <-> halb.
        const stellungA = laut ? mundAuf : ruhe;

        const jetzt = Date.now();
        if (!spricht) {                              // Sprechen faengt an
            spricht = true;
            ersteStellung = true;
            bisWann = jetzt + mundHaltedauer();
        } else if (jetzt >= bisWann) {               // Stellung wechseln
            ersteStellung = !ersteStellung;
            bisWann = jetzt + mundHaltedauer();
        }
        // Immer nachziehen: so schlaegt auch ein Wechsel laut<->leise sofort durch, ohne
        // das Ende der laufenden Standzeit abzuwarten.
        const ziel = ersteStellung ? stellungA : mundHalb;
        if (mundElem.src !== mundAbs(ziel)) mundElem.src = ziel;
    }, MUND_TAKT);
}

// fremd=true: Das Bild gehoert uns nicht mehr, also NICHT zurueckschreiben.
function mundStop(fremd) {
    if (mundTimer) clearInterval(mundTimer);
    mundTimer = null;
    if (!fremd && mundElem && mundZu && mundElem.src !== mundAbs(mundZu)) {
        mundElem.src = mundZu;                       // immer mit geschlossenem Mund enden
    }
    mundElem = mundZu = mundAuf = mundHalb = null;
    mundFelder = null;
    mundStimmung = null;
}

// Pegel der laufenden Unterhaltung. Waehrend die Figur zuhoert, bleibt der Mund zu.
// Meldet, ob die Figur im Gespraech gerade zuhoert - Bedingung fuers Zwinkern.
function mundRuhigGespraech() {
    return !!convo && agentModus === "listening";
}

function mundPegelGespraech() {
    if (!convo) return null;                         // Gespraech vorbei -> Animation beenden
    if (agentModus !== "speaking") return 0;
    if (!mundOhnePegel) {
        try {
            const v = convo.getOutputVolume();
            if (typeof v === "number" && !Number.isNaN(v)) return v;
        } catch (e) { /* faellt unten auf das Klappern zurueck */ }
        mundOhnePegel = true;
        console.warn("👄 getOutputVolume nicht nutzbar – der Mund klappert im Takt weiter.");
    }
    return (Date.now() % MUND_KLAPPERN) < MUND_KLAPPERN / 2 ? 1 : 0;
}

// Pegel fuer say-Audio (MP3 wie Live-TTS). Hier wird der Ton bewusst NICHT durch einen
// Web-Audio-Knoten geleitet - ein Fehler dabei wuerde die Sprachausgabe verstummen lassen.
// Stattdessen klappert der Mund, solange das Audio-Element laeuft.
function mundPegelAudio(audio) {
    return () => {
        if (!audio || audio.ended) return null;
        if (audio.paused) return 0;
        return (Date.now() % MUND_KLAPPERN) < MUND_KLAPPERN / 2 ? 1 : 0;
    };
}

async function speakWithElevenLabs(text, voiceId) {
    // Ueber eleven.php: der Server setzt das Modell (eleven_v4_turbo - versteht Audio-Tags
    // wie [excited], ohne sie vorzulesen) und laesst nur Stimmen aus der config.json zu.
    const response = await elevenAufruf("tts", { voice_id: voiceId, text });
    if (!response.ok) {
        console.error("Sprachausgabe fehlgeschlagen:", response.status, await response.text());
        return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);

    // Audio im Browser abspielen
    const audio = new Audio(url);
    // Die sprechende Figur bewegt dazu den Mund, sofern es ein -mund.png zu ihr gibt.
    const figur = document.getElementById(pruefeWS);
    if (figur) mundStart(figur, mundPegelAudio(audio));
    await new Promise((resolve) => {
        audio.onended = resolve;
        audio.play();
    });
    mundStop();
}

export async function eintragAendern(eintr,stopA=false) {
    if (!eintr) return; // undefined/null (z. B. fehlender Eintrag) ignorieren

    // Optionale Kurzform: "<figurname>": [status, opacity]
    // Setzt Status und Deckkraft einer Figur in EINEM Feld, z. B. "silberbronze": ["1", 1].
    // Nur null (oder ein fehlendes Array-Element) an einer Position => dieser Wert bleibt
    // UNVERAENDERT. 0 bzw. "0" sind gueltige Werte (Status "0" bzw. Opacity 0 = unsichtbar).
    // Wird in die bestehenden Felder <name>_status / <name>_opacity expandiert, damit die
    // restliche Logik (Statuswechsel, Deckkraft, opacity>1 = Auto-Start) unveraendert greift.
    // Die Langform (<name>_status / <name>_opacity) hat Vorrang, falls zusaetzlich gesetzt.
    for (const agent of configAgent) {
        const name = agent.name;
        const kurz = eintr[name];
        if (!Array.isArray(kurz)) continue;
        const unveraendert = v => (v === null || v === undefined);
        if (!unveraendert(kurz[0]) && eintr[name + "_status"] === undefined) {
            eintr[name + "_status"] = kurz[0];
        }
        if (!unveraendert(kurz[1]) && eintr[name + "_opacity"] === undefined) {
            eintr[name + "_opacity"] = kurz[1];
        }
    }

    // Wird eine Figur aktiviert (opacity >= 1, also klickbar), muss der Eintrag
    // existieren, den sie beim Klick nutzt (<name>_<status>). Der Zielstatus ist der
    // in diesem Eintrag gesetzte <name>_status, sonst der aktuelle Status der Figur.
    // Fehlt der Eintrag, würde ein Klick ins Leere laufen -> Warnung + ganzen Eintrag
    // NICHT ausführen. Nur sinnvoll, wenn Aktivieren immer mit Status-Setzen einhergeht
    // (cb). sh2 setzt den Status woanders -> Prüfung dort per Flag aus (figurAktivierungPruefen=false).
    if (figurAktivierungPruefen) {
        for (const agent of configAgent) {
            const name = agent.name;
            const op = eintr[name + "_opacity"];
            if (op === undefined || parseFloat(op) < 1) continue;
            const zielStatus = (eintr[name + "_status"] !== undefined) ? eintr[name + "_status"] : status[name];
            if (!daten.some(o => o.status === name + "_" + zielStatus)) {
                console.warn("⚠️ Eintrag übersprungen: Figur '" + name + "' wird aktiviert, aber es gibt keinen Eintrag '" + name + "_" + zielStatus + "'.");
                return;
            }
        }
    }

    if (eintr && eintr.delayT !== undefined) {
        await sleep(parseFloat(eintr.delayT) * 1000);
    }

    //console.log(eintr);
    if (eintr.szene_init !== undefined && eintr.status !== undefined) {
        // sh2 verwaltet den Spielstand NUR über die erste Figur (drwatson) – andere
        // szene_init-Einträge (z. B. sherlock_N) sind dort keine Speicherpunkte.
        // cb (Flag aus) speichert wie bisher bei jedem szene_init+status-Eintrag.
        if (!spielstandNurErsteFigur || eintr.status.split("_")[0] === configAgent[0].name) {
            console.log("Spielstand speichern:" + eintr.status);
            // Mit vollstaendigem Figurenzustand: Hier ist noch nichts von diesem Eintrag
            // angewendet - genau der Stand, den das Laden wiederherstellen muss.
            speichereSpielstand(userName, eintr.status , spielstand, notizen, figurenZustand());
        }
    }


    if (eintr && eintr.erzaehler !== undefined) {
        await speakWithElevenLabs(eintr.erzaehler.replace("XXX", userName).replace("forename", userForename).replace("lastname", userLastname).replace("gender", userGender), getVoiceIdByName("erzaehler"));
    }

    if (eintr.audio) { AudioPlay(eintr.audio); } else { if (stopA==false) stopAudioPlay(); }

    // Status VOR dem Delay setzen, damit verschachtelte delay-Eintraege (und deren
    // figurAktivierungPruefen) bereits den neuen <figur>_status sehen.
    for (let agent of configAgent) {
        const name = agent.name;
        const key = name + "_status";

        if (eintr && eintr[key] !== undefined) {
            status[name] = eintr[key];
        }
    }

    if (eintr && eintr.delay !== undefined) {
        eintragAendern(eintr.delay);
    }

    if (eintr && eintr.weiterTipp == undefined) {
        aktuellerTippEintrag = null;
        aktuellerTippIndex = 0;
        clearTimeout(timeoutId);
        const overlay = document.querySelector(".denk-overlay");
        overlay.style.opacity = "0";
        denkblaseKlickbar(overlay, false);
        versteckeText();
    }

    // (Status-Update erfolgt jetzt oben, vor dem Delay.)
    for (let agent of configAgent) {
        const name = agent.name;
        const key = name + "_opacity";

        if (eintr && eintr[key] !== undefined) {
            const elem = document.getElementById(name);
            if (elem) {
                let val = parseFloat(eintr[key]);
                //console.log("scale: "+ eintr.scale ?? 2)
                //const scaleValue = val === 1 ? 1 : 1;
                //elem.style.transform = `scale(${scaleValue})`;
                if (val > 1) {
                    val = 1;
                    elem.style.opacity = 1;
                    elem.style.zIndex = "2";
                    elem.style.cursor = "pointer";
                    pruefeWS = "";
                    startCall(name);
                } else {
                    elem.style.opacity = val;
                    elem.style.zIndex = "2";
                    elem.style.cursor = val === 1 ? "pointer" : "default";
                }
            }
        }
    }

    if (eintr && eintr.szene_wechseln !== undefined) {
        szene_wechseln(eintr.szene_wechseln[1], eintr.szene_wechseln[0], eintr.szene_wechseln[2] ?? undefined, eintr.szene_wechseln[3] ?? undefined, eintr.szene_wechseln[4] ?? undefined);
    }
    if (eintr && eintr.szene_wechseln_loeschen) {
        loescheSzeneWechsel();
    }
    if (eintr && eintr.szene_neu !== undefined) {
        ladeSzene(eintr, false);
        if (eintr.szene_neu[1] === "stille") stopHAudioPlay();
        if (eintr.szene_neu[1] != undefined) HAudioPlay(eintr.szene_neu[1], eintr.szene_neu[2] ?? undefined, eintr.szene_neu[3] ?? undefined);
    }
    if (eintr && eintr.poi !== undefined) {
        setzePois(eintr.poi);
    }
    if (eintr && eintr.abspann !== undefined) {
        zeigeAbspann(
            eintr.abspann[0],
            eintr.abspann[1],
            eintr.abspann[2],
            eintr.abspann?.[3] ?? true,
            eintr.abspann?.[4] ?? '4em',
            eintr
        );    
    }
    if (eintr && eintr.bild_neu !== undefined) {
        const [nameb, dateinameb, nAgentName] = eintr.bild_neu;
        await ersetzeBild(nameb, dateinameb, nAgentName ?? undefined);
    }
    if (eintr && eintr.resetTranskript !== undefined) {
        console.log("resetTranskript:" + eintrag.status.split("_")[0]);
        transcript[eintrag.status.split("_")[0]] = [];
    }
    if (eintr && eintr.spielstand !== undefined) {
        eval(eintr.spielstand);
        console.log("spielstand:" + eintr.spielstand);
        speichereSpielstand(userName, null, spielstand, notizen);
    }
    if (eintr && Array.isArray(eintr.bedingterSpielstand)) {
        eintr.bedingterSpielstand.forEach((regel) => {
            let entscheidung = 0;

            try {
                // Die Bedingung ist z. B. "entscheidung=(spielstand[0])"
                eval(regel.bedingung); // setzt die Variable `entscheidung`

                console.log(regel.bedingung+" : " + entscheidung);

                if (entscheidung >= 1) {
                    eintragAendern(regel);
                }
            } catch (e) {
                console.error("Fehler bei bedingterSpielstand:", regel, e);
            }
        });
    }
    if (eintr && eintr.buch !== undefined) {
        initBuchWithDaten(eintr);
        //console.log(eintr.buch);
    }
    if (eintr && eintr.notiz !== undefined) {
        addOrUpdateNotiz(eintr.notiz[0], eintr.notiz[1], eintr.notiz[2], eintr.notiz[3])
    }

    if (eintr && eintr.startCall !== undefined) {
        console.log("StartCall", eintr.startCall);
        startCall(eintr.startCall);
    }

    if (eintr && eintr.buch == undefined && eintr.bild == undefined) {
        wegMitBuch();
    }
    if (eintr && eintr.vorhang !== undefined ) {
        if (eintr.vorhang !== "weg") {
            showScrollingOverlay(eintr.vorhang, { duration: 15000, keepOnScreen: true });
        } else {
            removeScrollingOverlay();
        }
    }

}
async function waitUntilConversationIsDone(convoId, unterDaten, name, daten,schluesselwort) {
    let data;
    pruefeWS = name;

    data = await writeTranscript(convoId, name);
    versteckeText();

    let ueberhauptEinWortGefunden = false;

    if (data && Array.isArray(data.transcript) && unterDaten != undefined) {
        // Durchlaufe alle Einträge aus unterDaten (jetzt ein Array)
        unterDaten.forEach((eintrag) => {
            let wortGefunden = false;

            if (schluesselwort != undefined) {
                if (schluesselwort.toLowerCase().includes(eintrag.wort.toLowerCase())) {
                    wortGefunden = true;
                    ueberhauptEinWortGefunden = true;
                }
            }
            data.transcript.forEach((entry) => {
                if (
                    entry.role === "agent" &&
                    typeof entry.message === "string" &&
                    typeof eintrag.wort === "string" &&
                    entry.message.toLowerCase().includes(eintrag.wort.toLowerCase())
                ) {
                    wortGefunden = true;
                    ueberhauptEinWortGefunden = true;
                }
            });

            if (notizen.some(n => n.text === eintrag.wort)) {
                wortGefunden = true;
                ueberhauptEinWortGefunden = true;
            }

            if (wortGefunden) {
                console.log(`🔑 Schlüsselwort "${eintrag.wort}" gefunden – ändere Eintrag.`);
                eintragAendern(eintrag);
            }
        });
    }
    if (ueberhauptEinWortGefunden == false) {
        if (unterDaten != undefined) console.log(`🚫 Schlüsselwort "${unterDaten.wort}" NICHT gefunden.`);
        if (daten != undefined) eintragAendern(daten);
    }
    pruefeWS = "";
    return data;
}
async function writeTranscript(convoId, name) {
    let status = "";
    let data;
    let warte = "";
    // Eine gerade beendete Conversation ist bei ElevenLabs erst nach einigen
    // Sekunden abrufbar (bis dahin 404). Begrenzt oft neu versuchen, dann aufgeben -
    // sonst pollt die Schleife bei dauerhaftem 404 endlos weiter.
    const maxVersuche = 30;

    for (let versuch = 0; versuch < maxVersuche && status !== "done"; versuch++) {
        try {
            const res = await elevenAufruf("transkript", { id: convoId });

            if (!res.ok) {
                // 404 = Transkript noch nicht bereit; warten und erneut versuchen.
                console.log(`Transkript noch nicht bereit (${res.status}), Versuch ${versuch + 1}/${maxVersuche}`);
                await sleep(2000);
                warte = warte + ".";
                zeigeText(warte);
                continue;
            }

            data = await res.json();
            status = data.status;
            console.log(`Aktueller Status: ${status}`);
            warte = warte + ".";
            zeigeText(warte);

            if (status !== "done") {
                await sleep(2000); // 2 Sekunden warten, bevor erneut geprüft wird
            }

        } catch (err) {
            console.error("Fehler beim Abrufen:", err);
            await sleep(2000); // Bei Fehler auch warten und erneut versuchen
        }
    }

    versteckeText();

    if (status !== "done" || !data || !Array.isArray(data.transcript)) {
        console.warn("Transkript für", name, "konnte nicht geladen werden – überspringe.");
        return data;
    }

    transcript[name].push(...data.transcript);
    //console.log("Transcript " + name + ":", transcript[name])
    return data;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function szene_wechseln(dateiname, szenenN, mp3name, lautstaerke, loop) {
    if (szeneAmWechseln) {
        console.log("Szene wechseln schon im Gange " + dateiname);
        return;
    }
    szeneAmWechseln = true;
    console.log("Szene wechseln " + dateiname);
    const szene = document.querySelector(".szene");
    const istVideo = dateiname.toLowerCase().endsWith(".mp4");

    // Vorschau-Element vorbereiten (rechts unten)
    const vorschau = istVideo ? document.createElement("video") : document.createElement("img");
    vorschau.src = basis + "imgEleven/" + dateiname;
    vorschau.alt = dateiname;
    vorschau.classList.add("szene-vorschau"); // damit sie per szene_wechseln_loeschen entfernt werden kann

    // bei Video: Autoplay + Schleife + ohne Ton
    if (istVideo) {
        vorschau.autoplay = true;
        vorschau.loop = true;
        vorschau.muted = true;
        vorschau.playsInline = true; // für iOS
    }

    vorschau.style.opacity = "0";
    vorschau.style.position = "absolute";
    vorschau.style.bottom = "20px";
    vorschau.style.right = "20px";
    vorschau.style.width = "auto";
    vorschau.style.height = "min(50vh,50vw)";
    vorschau.style.objectFit = "contain";
    vorschau.style.border = "4px solid white";
    vorschau.style.borderRadius = "10px";
    vorschau.style.boxShadow = "0 0 20px rgba(0,0,0,0.6)";
    vorschau.style.cursor = "pointer";
    vorschau.style.transition = "opacity 2s ease, transform 1s ease";
    // Nur klickbar, nicht ziehbar: natives Bild-Dragging (das "Ghost"-Bild, das sich beim
    // Gedrueckthalten verschieben laesst) unterbinden - wie bei den Figuren soll die
    // Vorschau ausschliesslich per Klick reagieren.
    vorschau.draggable = false;
    vorschau.style.webkitUserDrag = "none";
    vorschau.style.userSelect = "none";
    vorschau.addEventListener("dragstart", e => e.preventDefault());

    setTimeout(() => {
        vorschau.style.opacity = "1";
        vorschau.style.transform = "translateY(0)";
    }, 100);

    vorschau.onclick = () => {
        szeneAmWechseln = false;
        vorschau.style.opacity = "0";
        vorschau.style.cursor = "default";
        vorschau.style.pointerEvents = 'none';

        setTimeout(() => {
            loeschePois();
            // Hintergrund wechselt -> Figuren wandern an die fuer dieses Bild hinterlegte
            // Anordnung, sonst (wie bisher) auf ihre Ausgangsposition zurueck.
            figurenAnordnenFuerBild(dateiname);
            const altesElement = szene.querySelector(".background");

            const neuesElement = istVideo ? document.createElement("video") : document.createElement("img");
            neuesElement.src = vorschau.src;
            neuesElement.alt = vorschau.alt;
            neuesElement.classList.add("background");
            neuesElement.style.position = "absolute";
            neuesElement.style.top = "0";
            neuesElement.style.left = "50%";
            neuesElement.style.transform = "translateX(-50%)";
            neuesElement.style.width = "auto";
            neuesElement.style.height = "100vh";
            neuesElement.style.maxWidth = "100%";
            neuesElement.style.objectFit = "contain";
            neuesElement.style.opacity = "0";
            neuesElement.style.transition = "opacity 2s ease";
            neuesElement.onload = function () {
                const colorThief = new ColorThief();
                const dominantColor = colorThief.getColor(neuesElement); // z. B. [123, 200, 150]
                document.body.style.backgroundColor = `rgb(${dominantColor.join(",")})`;
            };

            if (istVideo) {
                neuesElement.autoplay = true;
                neuesElement.loop = true;
                neuesElement.muted = true;
                neuesElement.playsInline = true;
                // Wie in ladeSzene: Farbe fuer Videos aus dem gleichnamigen Standbild.
                setzeHintergrundfarbeAusStandbild(dateiname);
            }

            szene.appendChild(neuesElement);
            // Zentrale POIs fuer das neue Hintergrundbild aktivieren.
            setzePoisFuerBild(dateiname);

            requestAnimationFrame(() => {
                neuesElement.style.opacity = "1";
                if (altesElement) {
                    altesElement.style.transition = "opacity 2s ease";
                    altesElement.style.opacity = "0";
                }
            });

            setTimeout(() => {
                if (altesElement) {
                    altesElement.src = vorschau.src;
                    szene.removeChild(altesElement);
                }
            }, 2000);

            const eintrag = daten.find(obj => obj.szene === szenenN);
            if (eintrag) eintragAendern(eintrag);
            HAudioPlay(mp3name ?? undefined, lautstaerke ?? undefined, loop ?? undefined);
            szeneVorher = dateiname;
        }, 1000);
        if (szeneJetzt != dateiname) szeneVorher = szeneJetzt;
        szeneJetzt = dateiname;
    };
    szene.appendChild(vorschau);
}
// Entfernt eine noch offene Szenenwechsel-Vorschau (rechts unten), ohne die Szene
// zu wechseln - der User bleibt also in der aktuellen Szene / im Gespraech.
function loescheSzeneWechsel() {
    let entfernt = false;
    document.querySelectorAll(".szene .szene-vorschau").forEach(el => {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        setTimeout(() => el.remove(), 500);
        entfernt = true;
    });
    szeneAmWechseln = false;
    if (entfernt) console.log("Szenenwechsel-Vorschau entfernt.");
}
// --- Points of Interest -------------------------------------------------
// poi: [ [x, y, radius, text, verzoegerung], ... ] mit x/y/radius in Pixeln des
// Originalbildes. Ist der Mauszeiger innerhalb des Radius, erscheint der Text am
// Mauszeiger. Die Verzoegerung in Sekunden ist optional: ist sie gesetzt, blendet
// der Text erst nach dieser Zeit ueber 1 Sekunde ein - und nur, wenn der Mauszeiger
// den Radius waehrend der Wartezeit nicht verlassen hat. Einmal gesehene Texte
// erscheinen ab dann sofort.
function setzePois(poiListe) {
    aktivePois = Array.isArray(poiListe) ? poiListe : [];
    poiRefGroesse = null; // Standard: Koordinaten liegen im Raum des aktuellen Hintergrunds
    versteckePoiTooltip();
    if (aktivePois.length > 0) aktivierePoiListener();
}
// Aktiviert die zentral (daten[0].poi) fuer diesen Bilddateinamen deklarierten POIs.
// Wird immer aufgerufen, sobald ein Bild als Hintergrund erscheint. Gibt es keine
// zentrale Deklaration, bleiben die POIs (vom vorherigen loeschePois) leer - ein
// eventueller eintrag-eigener poi wird davon nicht angetastet (der ueberschreibt spaeter).
function setzePoisFuerBild(dateiname) {
    if (!dateiname) return;
    const name = String(dateiname).split("/").pop().split("?")[0].toLowerCase();
    let liste = poiRegister[name];
    let refBild = liste ? name : null;
    // Video ohne eigene POIs: auf gleichnamiges Standbild zurueckfallen
    // (z. B. regenZuhause.mp4 -> regenZuhause.png). Die POI-Koordinaten liegen dann
    // im Pixelraum des Standbildes - die Geometrie muss dessen Masse verwenden.
    if (!liste && name.endsWith(".mp4")) {
        const stamm = name.slice(0, -4);
        for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]) {
            if (poiRegister[stamm + ext]) { liste = poiRegister[stamm + ext]; refBild = stamm + ext; break; }
        }
    }
    if (Array.isArray(liste) && liste.length > 0) {
        setzePois(liste); // setzt poiRefGroesse zurueck
        // Weicht das Referenzbild vom Hintergrund ab (Video-Fallback), Geometrie an
        // der Groesse des Referenzbildes ausrichten.
        if (refBild && refBild !== name) poiReferenzGroesseLaden(refBild);
    }
}
// Ermittelt (und cached) die Natur-Masse eines Referenzbildes fuer die POI-Geometrie.
function poiReferenzGroesseLaden(bildname) {
    if (poiBildGroessen[bildname]) { poiRefGroesse = poiBildGroessen[bildname]; return; }
    poiRefGroesse = null;
    const img = new Image();
    img.onload = () => {
        poiBildGroessen[bildname] = { w: img.naturalWidth, h: img.naturalHeight };
        poiRefGroesse = poiBildGroessen[bildname];
    };
    img.src = basis + "imgEleven/" + bildname;
}
function loeschePois() {
    aktivePois = [];
    versteckePoiTooltip();
}
function versteckePoiTooltip() {
    if (poiTimeoutId !== null) {
        clearTimeout(poiTimeoutId);
        poiTimeoutId = null;
    }
    poiAktiverIndex = -1;
    poiTextSichtbar = false;
    document.body.style.cursor = "";
    if (poiTooltip) {
        poiTooltip.style.transition = "opacity 0.2s ease";
        poiTooltip.style.opacity = "0";
    }
}
// Der POI-Text ist jetzt sichtbar: Hand-Cursor nur zeigen, falls eine Conversation
// laeuft UND der aktive POI einen optionalen Zusatztext (Index 5) hat - nur dann
// laesst er sich ueberhaupt senden.
function poiTextErschienen() {
    poiTextSichtbar = true;
    const sendbar = poiAktiverIndex !== -1 && poiZusatzText(aktivePois[poiAktiverIndex]);
    document.body.style.cursor = (convo && sendbar) ? "pointer" : "";
}
function erzeugePoiTooltip() {
    if (poiTooltip) return poiTooltip;
    poiTooltip = document.createElement("div");
    poiTooltip.className = "poi-tooltip";
    Object.assign(poiTooltip.style, {
        position: "fixed",
        left: "0",
        top: "0",
        opacity: "0",
        zIndex: "10001",
        pointerEvents: "none",
        padding: "0.3em 0.6em",
        borderRadius: "6px",
        background: "rgba(0,0,0,0.6)",
        color: "white",
        fontSize: "1.2em",
        whiteSpace: "pre",
        textShadow: "2px 2px 4px rgba(0, 0, 0, 0.7)",
        transition: "opacity 0.2s ease"
    });
    document.body.appendChild(poiTooltip);
    return poiTooltip;
}
// Baut den Tooltip-Inhalt: ist text2 gesetzt (die Hand wird gezeigt), erscheint er
// kleiner eine Zeile ueber Text1; sonst nur Text1.
function setzePoiTooltipInhalt(text1, text2) {
    poiTooltip.textContent = "";
    if (text2) {
        const zusatz = document.createElement("div");
        zusatz.textContent = text2;
        zusatz.style.fontSize = "0.7em";
        zusatz.style.opacity = "0.85";
        poiTooltip.appendChild(zusatz);
    }
    const haupt = document.createElement("div");
    haupt.textContent = text1;
    poiTooltip.appendChild(haupt);
}
function aktivierePoiListener() {
    if (poiListenerAktiv) return;
    poiListenerAktiv = true;
    erzeugePoiTooltip();
    document.addEventListener("mousemove", pruefePoi);
    document.addEventListener("mouseleave", versteckePoiTooltip);
    // Capture-Phase (true): der POI-Klick wird VOR dem onclick der darunter/darueber
    // liegenden Figur ausgewertet - so hat ein sendbarer POI Vorrang vor der Figur.
    document.addEventListener("click", pruefePoiKlick, true);
}
// Rechnet die "object-fit: contain"-Darstellung des Hintergrundbildes aus:
// tatsaechlich gemalte Flaeche (links/oben) und Skalierung Bildpixel -> Bildschirm.
function poiBildGeometrie() {
    // Waehrend einer Ueberblendung liegen kurz zwei .background-Elemente im DOM,
    // das zuletzt eingefuegte ist das aktuelle.
    const bilder = document.querySelectorAll(".szene .background");
    const bild = bilder[bilder.length - 1];
    if (!bild) return null;

    // Stammen die POIs aus einem Referenzbild (z. B. Standbild eines Videos), dessen
    // Masse verwenden - die POI-Koordinaten liegen in diesem Pixelraum.
    const natBreite = poiRefGroesse ? poiRefGroesse.w : (bild.naturalWidth || bild.videoWidth || 0);
    const natHoehe  = poiRefGroesse ? poiRefGroesse.h : (bild.naturalHeight || bild.videoHeight || 0);
    if (!natBreite || !natHoehe) return null;

    const rect = bild.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const skalierung = Math.min(rect.width / natBreite, rect.height / natHoehe);
    return {
        skalierung: skalierung,
        left: rect.left + (rect.width - natBreite * skalierung) / 2,
        top: rect.top + (rect.height - natHoehe * skalierung) / 2
    };
}
// Liefert den Index des POI unter dem Bildschirmpunkt (oder -1). Bei Ueberschneidung
// gewinnt der naechstgelegene POI.
function poiIndexAnPunkt(clientX, clientY) {
    if (aktivePois.length === 0) return -1;
    const geo = poiBildGeometrie();
    if (!geo) return -1;

    let trefferIndex = -1;
    let besteDistanz = Infinity;
    aktivePois.forEach((poi, index) => {
        const [x, y, radius] = poi;
        const mitteX = geo.left + parseFloat(x) * geo.skalierung;
        const mitteY = geo.top + parseFloat(y) * geo.skalierung;
        const distanz = Math.hypot(clientX - mitteX, clientY - mitteY);

        if (distanz <= parseFloat(radius) * geo.skalierung && distanz < besteDistanz) {
            besteDistanz = distanz;
            trefferIndex = index;
        }
    });
    return trefferIndex;
}
// Optionaler Zusatztext (Index 5) eines POI. Nur wenn er vorhanden (und nicht leer)
// ist, laesst sich der POI an den Agenten senden und die Hand wird gezeigt.
function poiZusatzText(poi) {
    if (!poi || poi[5] === undefined || poi[5] === null) return null;
    const text2 = String(poi[5]);
    return text2.length > 0 ? text2 : null;
}
// Klick auf einen aktiven POI: laeuft gerade eine Conversation UND hat der POI einen
// optionalen Zusatztext (Index 5), wird dem Agenten "text2 + ' ' + text1" gesendet.
// Liegt an dieser Stelle ein Bedien-Element (Denkblase, Notizbuch-Icon)? POIs sind reine
// Koordinatenbereiche auf dem Hintergrundbild und liegen darum "unter" der Bedienung -
// ein POI darf ihr weder den Klick wegnehmen noch sie mit seinem Tooltip zudecken.
function bedienElementAnPunkt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    if (el.closest && el.closest(".denk-overlay")) return true;
    if (el.classList && el.classList.contains("nb-badge")) return true;
    return false;
}

function pruefePoiKlick(e) {
    // Vorrang fuer die Bedienung: sonst schluckt ein sendbarer POI den Klick per
    // stopImmediatePropagation, und die darueber liegende Denkblase liesse sich an
    // dieser Stelle nicht mehr anklicken.
    if (bedienElementAnPunkt(e.clientX, e.clientY)) return;
    const trefferIndex = poiIndexAnPunkt(e.clientX, e.clientY);
    if (trefferIndex === -1 || !convo) return;

    const text2 = poiZusatzText(aktivePois[trefferIndex]);
    if (!text2) return; // Ohne optionalen Zusatztext wird nichts gesendet - Figur klickt normal.

    // Sendbarer POI getroffen: Vorrang vor der Figur. Klick nicht an die Figur
    // (elem.onclick -> startCall) weiterreichen.
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    e.preventDefault();

    const nachricht = text2 + " " + aktivePois[trefferIndex][3];
    try {
        // sendUserMessage (nicht sendContextualUpdate): nur ein User-Redebeitrag
        // stoesst den Agenten zu einer Antwort an - eine reine Kontext-Aktualisierung
        // wird sonst still bis zur naechsten User-Aeusserung aufgehoben.
        if (typeof convo.sendUserMessage === "function") {
            convo.sendUserMessage(nachricht);
        } else if (typeof convo.sendContextualUpdate === "function") {
            convo.sendContextualUpdate(nachricht);
        }
        console.log("POI an Agent:", nachricht);
    } catch (err) {
        console.error("POI-Nachricht an Agent fehlgeschlagen:", err);
    }
}
function pruefePoi(e) {
    if (!poiTooltip) return;

    // Ueber der Denkblase / dem Notizbuch-Icon gilt die Bedienung, nicht der POI: keinen
    // Tooltip einblenden (der wuerde die Blase zudecken) und den Zeiger dem Element
    // ueberlassen, damit sichtbar bleibt, dass es anklickbar ist.
    if (bedienElementAnPunkt(e.clientX, e.clientY)) {
        document.body.style.cursor = "";
        versteckePoiTooltip();
        poiAktiverIndex = -1;
        return;
    }

    const trefferIndex = poiIndexAnPunkt(e.clientX, e.clientY);

    // Hand-Cursor nur, wenn der POI-Text tatsaechlich erschienen ist (nach der
    // Verzoegerung + Einblendung), eine Conversation laeuft UND der POI unter dem
    // Cursor einen optionalen Zusatztext (Index 5) hat - nur dann sendet ein Klick
    // auch wirklich etwas.
    const sendbar = trefferIndex !== -1 && poiZusatzText(aktivePois[trefferIndex]);
    document.body.style.cursor = (poiTextSichtbar && convo && sendbar) ? "pointer" : "";

    if (trefferIndex === -1) {
        versteckePoiTooltip();
        return;
    }

    // Nur beim Wechsel auf einen anderen POI neu starten - Bewegung innerhalb
    // desselben Radius darf die Wartezeit nicht zuruecksetzen.
    if (trefferIndex !== poiAktiverIndex) {
        versteckePoiTooltip();
        poiAktiverIndex = trefferIndex;

        const text = aktivePois[trefferIndex][3];
        // Zeigt der POI die "Hand" (sendbar + laufende Conversation), erscheint Text2
        // (Index 5) kleiner eine Zeile ueber Text1; sonst nur Text1.
        const zusatz = poiZusatzText(aktivePois[trefferIndex]);
        setzePoiTooltipInhalt(text, (convo && zusatz) ? zusatz : null);

        // Einmal gesehene Texte erscheinen ab dann sofort.
        const verzoegerung = parseFloat(aktivePois[trefferIndex][4]);
        if (!isNaN(verzoegerung) && verzoegerung > 0 && !gezeigtePoiTexte.has(text)) {
            poiTimeoutId = setTimeout(() => {
                gezeigtePoiTexte.add(text);
                poiTooltip.style.transition = "opacity 1s ease";
                poiTooltip.style.opacity = "1";
                // Erst nach der 1s-Einblendung gilt der Text als erschienen -> Hand.
                poiTimeoutId = setTimeout(() => {
                    poiTimeoutId = null;
                    poiTextErschienen();
                }, 1000);
            }, verzoegerung * 1000);
        } else {
            gezeigtePoiTexte.add(text);
            poiTooltip.style.opacity = "1";
            poiTextErschienen();
        }
    }

    // Am Bildschirmrand auf die andere Seite des Mauszeigers klappen
    const abstand = 16;
    let left = e.clientX + abstand;
    let top = e.clientY + abstand;
    if (left + poiTooltip.offsetWidth > window.innerWidth) left = e.clientX - abstand - poiTooltip.offsetWidth;
    if (top + poiTooltip.offsetHeight > window.innerHeight) top = e.clientY - abstand - poiTooltip.offsetHeight;
    poiTooltip.style.left = left + "px";
    poiTooltip.style.top = top + "px";
}

function starteTipp(eintrag) {
    if (!eintrag.tipp || !Array.isArray(eintrag.tipp.hinweis)) return;
    const { init, intervall, hinweis } = eintrag.tipp;
    aktuellerTippEintrag = eintrag;
    aktuellerTippIndex = 1;
    hinweisIndex = 0;
    //console.log("Tipp gestartet.");
    timeoutId = setTimeout(() => {
        zeigeHinweis(eintrag, aktuellerTippIndex);
    }, parseFloat(init) * 1000);
}
function zeigeHinweis(eintrag, nr) {
    const overlay = document.querySelector(".denk-overlay");
    if (!overlay) return;
    //console.log("Tipp: " + nr);
    // Bedingte Tipps ([entscheidung = ...]Text), deren Bedingung nicht greift, gleich
    // ueberspringen - sonst wartet die Blase ein ganzes Intervall auf eine leere Stelle.
    const tippListe = eintrag.tipp?.hinweis || [];
    while (nr < tippListe.length && !hinweisGilt(tippListe[nr - 1])) nr++;
    aktuellerTippEintrag = eintrag;
    aktuellerTippIndex = nr;

    // Waehrend die Blase geoeffnet ist (Text sichtbar), das Wachsen/Umpositionieren NICHT
    // ausfuehren - sonst wuerde die aufgefahrene, links verankerte Blase springen. Der
    // naechste Tick wird trotzdem geplant (unten), damit das Wachsen danach weiterlaeuft.
    if (!overlay.classList.contains("offen")) {
        const scaleFactor = 1 + (nr - 1) * 0.4;
        overlay.style.opacity = "0.5";
        denkblaseKlickbar(overlay, true);
        overlay.style.transformOrigin = "left bottom";
        overlay.style.transform = `scale(${scaleFactor})`;
        positioniereDenkblase();
    }

    console.log("TipLänge:", eintrag.tipp.hinweis.length);
    if (eintrag.tipp.hinweis.length > aktuellerTippIndex) {
        //starte Intervall für Blasenvergrößerung
        if (!eintrag.tipp || !Array.isArray(eintrag.tipp.hinweis)) return;
        const { init, intervall, hinweis } = eintrag.tipp;
        timeoutId = setTimeout(() => {
            zeigeHinweis(eintrag, aktuellerTippIndex + 1);
        }, parseFloat(intervall) * 1000);
    }
}
// Nur wenn das User-Bild vergroessert ist (scale > 1): Denkblase so setzen, dass ihre
// rechte obere Ecke mit der rechten oberen Ecke des vergroesserten User-Bildes
// zusammenfaellt. Sonst bleibt die Denkblase an ihrer Standardposition (CSS).
function positioniereDenkblase() {
    const overlay = document.querySelector(".denk-overlay");
    const userImg = document.getElementById("user");
    if (!overlay || !userImg) return;

    const container = overlay.closest(".bild-mit-overlay");
    if (!container) return;

    // Skalierung aus dem inline gesetzten transform lesen.
    const m = /scale\(\s*([\d.]+)/.exec(userImg.style.transform || "");
    const scale = m ? parseFloat(m[1]) : 1;

    if (scale <= 1.01) {
        // nicht vergroessert -> Standardposition (transformOrigin von zeigeHinweis lassen)
        overlay.style.right = "";
        overlay.style.top = "";
        return;
    }

    const imgRect = userImg.getBoundingClientRect();      // skalierte, sichtbare Bildflaeche
    const contRect = container.getBoundingClientRect();

    // Blase am oberen rechten Eckpunkt verankern, damit auch beim Wachsen der Blase
    // die rechte obere Ecke fixiert bleibt.
    overlay.style.transformOrigin = "top right";
    overlay.style.right = (contRect.right - imgRect.right) + "px";
    overlay.style.top = (imgRect.top - contRect.top) + "px";
}
// true, wenn der Tipp angezeigt werden darf: ohne [Bedingung] immer, sonst bei entscheidung >= 1.
function hinweisGilt(hinweis) {
    if (typeof hinweis !== "string") return false;
    const match = hinweis.match(/^\[(.*?)\](.*)/s);
    if (!match) return true;
    let entscheidung = 0;
    try {
        eval(match[1]); // setzt "entscheidung"
    } catch (e) {
        console.error("Eval-Fehler:", e, match[1]);
        return false;
    }
    return entscheidung >= 1;
}
function setupDenkblaseClick() {
    const overlay = document.querySelector(".denk-overlay");
    if (overlay) {
        overlay.addEventListener("click", () => {
            if (!aktuellerTippEintrag) return;

            const transform = overlay.style.transform || "scale(1)";
            const currentScale = parseFloat(transform.match(/scale\(([^)]+)\)/)?.[1]) || 1;
            // Zum naechsten freigeschalteten Tipp weiterblaettern, dessen Bedingung greift.
            const tippListe = aktuellerTippEintrag.tipp?.hinweis || [];
            for (let versuch = 0; versuch < aktuellerTippIndex; versuch++) {
                if (hinweisIndex < aktuellerTippIndex) { hinweisIndex = hinweisIndex + 1; } else { hinweisIndex = 1; }
                if (hinweisGilt(tippListe[hinweisIndex - 1])) break;
            }
            const hinweis = tippListe[hinweisIndex - 1];

            //Zeigt den Tipp bei [], wenn entscheidung >=1
            const match = hinweis.match(/^\[(.*?)\](.*)/s); // Regex: Inhalt in [ ] + Rest
            if (match) {
                const expr = match[1];   // z.B. "entscheidung = 1-notizEnthalten(...)"
                const text = match[2];   // Rest nach der ]

                let entscheidung = 0;
                try {
                    eval(expr); // setzt "entscheidung"
                    //console.log(expr+" = "+entscheidung);

                } catch (e) {
                    console.error("Eval-Fehler:", e, expr);
                }

                if (entscheidung >= 1) {
                    zeigeDenkText(text);
                };
            } else {
                zeigeDenkText(hinweis);
            }

            if (currentScale > 1.0) {
                clearTimeout(timeoutId);
                if (aktuellerTippEintrag.tipp.hinweis.length > aktuellerTippIndex) {
                    //starte Intervall für Blasenvergrößerung
                    if (!aktuellerTippEintrag.tipp || !Array.isArray(aktuellerTippEintrag.tipp.hinweis)) return;
                    const { init, intervall, hinweis } = aktuellerTippEintrag.tipp;
                    //console.log(intervall + " Tipp gestartet");
                    timeoutId = setTimeout(() => {
                        zeigeHinweis(aktuellerTippEintrag, aktuellerTippIndex + 1);
                    }, parseFloat(intervall) * 1000);
                }
            }
        });
    } else {
        console.warn("Denkblase (.denk-overlay) nicht gefunden beim DOMContentLoaded");
    }
}
function zeigeText(text) {
    const textDiv = document.getElementById("textzeile");
    textDiv.textContent = text;
    textDiv.style.visibility = "visible";
}
function versteckeText() {
    const textDiv = document.getElementById("textzeile");
    textDiv.style.visibility = "hidden";
}
function bisherGesagt(transcript, slice = -15) {
    // Zuerst ungültige oder leere Nachrichten herausfiltern
    const gueltigeEinträge = transcript.filter(entry => entry.message && entry.message.trim() !== "");

    // Dann die letzten N Einträge davon nehmen
    const lastEntries = gueltigeEinträge.slice(slice);
    console.log(lastEntries);

    // Einträge in lesbares Gesprächsformat umwandeln
    const formatted = lastEntries.map(entry => {
        const speaker = entry.role === 'user' ? 'Nutzer' : 'Du';
        return `${speaker}: ${entry.message}`;
    }).join('\n');

    // Wenn kein Gesprächsinhalt, dann auch kein systemPrompt
    if (!formatted.trim()) {
        return "";
    }

    // Prompt-Text zusammenbauen
    const systemPrompt =
        `Dies ist eine Fortsetzung einer früheren Unterhaltung. Hier ist das bisherige Gespräch:\n\n` +
        `${formatted}\n\n` +
        `Bitte fahre fort, als hätte es keine Unterbrechung gegeben.\n\n`;

    return systemPrompt;
}

// Alle Figuren eines Falls teilen sich EINEN Agenten - die Stimme wird vor jedem Auftritt
// per PATCH umgestellt. Scheitert dieser PATCH (haeufigster Fall: die voice_id aus der
// config.json wurde im ElevenLabs-Konto geloescht -> "voice_not_found"), behaelt der Agent
// die Stimme der VORIGEN Figur. Das Spiel lief bisher stumm mit der falschen Stimme weiter,
// zu sehen nur als Konsolen-Log. Darum jetzt zusaetzlich eine sichtbare Kurzmeldung, die
// AUSDRUECKLICH die betroffene Figur nennt.
async function updateAgent(name, alias) {
    const stimmProblem = (grund, detail) => {
        console.error("Stimme für '" + name + "' nicht gesetzt (" + grund + ") - die Figur "
            + "spricht mit der Stimme der vorigen Figur.", detail ?? "");
        zeigeKurzmeldung("⚠ Stimme für „" + name + "“ nicht gesetzt (" + grund
            + ") – spricht mit der vorigen Stimme", "#c00", 7000);
    };

    const agent = configAgent.find(a => a.name === name);
    if (!agent) {
        stimmProblem("fehlt in config.json");
        return;
    }

    // eleven.php schickt den config.json-Eintrag der Figur selbst als PATCH an den Agenten -
    // der Browser nennt nur Fall und Figur.
    let res;
    try {
        res = await elevenAufruf("agent", { name });
    } catch (e) {
        // Netz weg: frueher flog der Fehler bis in den Aufrufer und brach den Auftritt ab.
        stimmProblem("Netzwerkfehler", e);
        return;
    }

    if (!res.ok) {
        const err = await res.text();
        console.error("Update fehlgeschlagen:", res.status, err);
        // ElevenLabs nennt den Grund in detail.status (z. B. "voice_not_found"); faellt das
        // aus, bleibt der HTTP-Status als Anhaltspunkt.
        let grund = "HTTP " + res.status;
        try {
            const d = JSON.parse(err).detail;
            grund = (d && (d.status || d.code)) || grund;
        } catch (e) { /* keine JSON-Antwort - dann eben der HTTP-Status */ }
        stimmProblem(grund, "voice_id: " + (agent.conversation_config?.tts?.voice_id ?? "?"));
        return;
    }

    const data = await res.json();
    //console.log("Agent aktualisiert:", data);
    // Eigene Stimme fehlt im Konto -> eleven.php hat die "ersatzStimme" aus der config.json gesetzt.
    if (data && data.ersatz) {
        console.warn("Stimme für '" + name + "' nicht gefunden - Ersatzstimme aktiv.");
        zeigeKurzmeldung("Ersatzstimme für „" + name + "“", "#c80", 4000);
    }
}
function getVoiceIdByName(name) {
    const agent = configAgent.find(a => a.name === name);
    return agent?.conversation_config?.tts?.voice_id || null;
}
function getAgentIdByName(name) {
    const agent = configAgent.find(a => a.name === name);
    return agent ? agent.agent_id : null;
}
function initAgents(configAgent) {
    const params = new URLSearchParams(window.location.search);
    let hasParams = false;
    let eintr;
    let elem;

    // Start-Button erstellen
    const startButton = document.createElement("button");
    startButton.textContent = "▶ Start";
    startButton.style.position = "fixed";
    startButton.style.top = "50%";
    startButton.style.left = "50%";
    startButton.style.transform = "translate(-50%, -50%)";
    startButton.style.fontSize = "2em";
    startButton.style.padding = "1em 2em";
    startButton.style.backgroundColor = "#222";
    startButton.style.color = "#fff";
    startButton.style.border = "none";
    startButton.style.borderRadius = "10px";
    startButton.style.boxShadow = "0 0 20px rgba(0,0,0,0.5)";
    startButton.style.zIndex = "9999";
    startButton.style.cursor = "pointer";

    for (let agent of configAgent) {
        let name = agent.name;
        let elem;

        elem = document.getElementById(name);

        status[name] = "0";
        transcript[name] = [];

        const paramValue = params.get(name);
        if (paramValue !== null) {
            hasParams = true;
            status[name] = paramValue;
            console.log("startUser aus params: "+name + "_" + status[name]);
            startUser=name + "_" + status[name];
            // KEIN Hand-Cursor hier: die Figur ist zu diesem Zeitpunkt noch unsichtbar und
            // belegt als transparentes Bild trotzdem ihren Platz in der Figurenleiste. Den
            // Zeiger setzt weiter unten die Stelle, die sie auch wirklich einblendet.
        } else {
            elem.style.opacity = "0";
            elem.style.transform = `scale(1)`;
            elem.style.zIndex = "2";
            elem.style.cursor = "default";
        }

        elem.onclick = () => {
            const cursor = window.getComputedStyle(elem).cursor;
            //console.log("init" + name);
            if (cursor === "pointer") {
                startCall(name);
                let aAudio = new Audio("imgEleven/klick.mp3");
                aAudio.volume = Math.min(1, Math.max(0, 1));
                aAudio.play().catch(err => {
                    console.error("Fehler beim Abspielen:", err);
                });
            }
        };
    }
    //if (!hasParams) { ladeSzene(); }
    // sh2 speichert historisch nur die Status-Nummer der ersten Figur (z. B. "3").
    // Enthält der geladene Start-Status kein "_", als <erste Figur>_<Nummer> lesen.
    if (startUser && !String(startUser).includes("_")) {
        startUser = (configAgent[0]?.name || "user") + "_" + startUser;
    }
    // Fall-uebergreifend: Ist der Start-Status ungueltig (z. B. Default "user_1" in
    // einem Fall ohne "user"-Figur wie sh2 mit "drwatson"), auf die erste Figur des
    // Falls zurueckfallen. Deckt neuen Nutzer, Neustart und cb gleichermassen ab.
    if (!daten.some(obj => obj.status === startUser)) {
        startUser = (configAgent[0]?.name || "user") + "_1";
    }
    elem = document.getElementById(startUser.split("_")[0]);
    status[startUser.split("_")[0]]=startUser.split("_")[1];

    document.body.appendChild(startButton);
    startButton.addEventListener("click", () => {
        startButton.remove(); // Button entfernen

        // Direkteinstieg bei einer Szene: ?szene=<id>  (z. B. ?fall=cb&szene=rz1)
        const szeneParam = new URLSearchParams(location.search).get("szene");
        if (szeneParam && daten.some(o => o.szene === szeneParam)) {
            starteBeiSzene(szeneParam);
            return;
        }

        elem.style.opacity = "1";
        elem.style.transform = `scale(1)`;
        elem.style.border = "3px solid white";
        elem.style.zIndex = "2";
        elem.style.cursor = "pointer";
        eintr = daten.find(obj => obj.status === (startUser));
        ladeSzene(eintr, true);
        // Beim Einstieg laeuft kein eintragAendern - POIs des Startbildes hier setzen.
        if (eintr.poi !== undefined) setzePois(eintr.poi);
        if (eintr.szene_init) {
            const [, audio, vol, loop, ...rest] = eintr.szene_init;
            if (audio !== undefined) {
                HAudioPlay(audio, vol ?? undefined, loop ?? undefined);
            }

            for (const pair of rest) {
                if (!Array.isArray(pair) || pair.length < 1) continue; 

                const [nameStatus, opacity] = pair;
                const [name, stat] = String(nameStatus).split(/_(.+)/);

                if (!name) continue;

                // Status speichern
                status[name] = stat ?? "";

                // DOM-Element anpassen
                const el = document.getElementById(name);
                if (el) {
                    if (opacity !== undefined) {
                        const op = Number(opacity);
                        if (!Number.isNaN(op)) {
                            el.style.opacity = op;
                            // Zeiger IMMER mitfuehren - fehlte das Zuruecksetzen, behielt eine
                            // ausgeblendete Figur den Hand-Cursor und zeigte ihn dort, wo ihr
                            // unsichtbares Bild in der Figurenleiste liegt.
                            el.style.cursor = op === 1 ? "pointer" : "default";
                        }
                    }
                }
            }
        }
        // Wurde beim Speichern der vollstaendige Figurenzustand mitgeschrieben (ab v58),
        // ihn jetzt wiederherstellen - er ist massgeblich, szene_init oben nur der Rueckfall
        // fuer aeltere Spielstaende. Nicht bei Einstieg per URL-Parameter.
        if (!hasParams && gespeicherteFiguren && gespeicherteFigurenFuer === startUser) {
            wendeFigurenZustandAn(gespeicherteFiguren);
        }
    });
    /*
    if (!hasParams && configAgent.length > 0) {
        const first = configAgent[0];
        const name = first.name;
        const elem = document.getElementById(name);
        status[name] = "1";
        elem.style.opacity = "1";
        elem.style.transform = `scale(1)`;
        elem.style.cursor = "pointer";
        elem.style.zIndex = "2";
    }
    */
}
// Ermittelt Bild + Audio einer Szene aus dem szene_wechseln, das sie anspringt.
function szeneEinstiegInfo(id) {
    let info = null;
    (function walk(n) {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n.szene_wechseln) && n.szene_wechseln[0] === id && n.szene_wechseln[1]) {
            info = { bild: n.szene_wechseln[1], audio: n.szene_wechseln[2], vol: n.szene_wechseln[3], loop: n.szene_wechseln[4] };
        }
        for (const k of Object.keys(n)) walk(n[k]);
    })(daten);
    return info;
}
// Direkteinstieg bei einer "szene":<id>: erst das zugehoerige Hintergrundbild setzen
// (damit auch die zentral am Bild deklarierten POIs greifen), dann den Szenen-Eintrag
// ganz normal ausfuehren. Szenen-Eintraege sind sonst keine Startpunkte.
async function starteBeiSzene(id) {
    const eintr = daten.find(o => o.szene === id);
    if (!eintr) { console.warn("Keine Szene '" + id + "' gefunden."); return; }
    const info = szeneEinstiegInfo(id);
    if (info && info.bild) {
        await ladeSzene({ szene_neu: [info.bild, "stille", "0", false] }, false);
        if (info.audio) HAudioPlay(info.audio, info.vol ?? undefined, info.loop ?? undefined);
    }
    eintragAendern(eintr);
}
// Ermittelt den Figuren-Container (.bild-mit-overlay) unter dem Zeiger. Nur SICHTBARE
// Figuren (opacity > 0) zaehlen; ueberlappen mehrere, gewinnt der hoechste z-index (meist
// die aktive, vergroesserte Figur). Getroffen wird ueber die Zeiger-Geometrie - wie der
// Rand-Effekt - damit es auch fuer inaktive Figuren (pointer-events: none) funktioniert.
function figurUnterZeiger(x, y) {
    const treffer = [];
    document.querySelectorAll('.personen img, .personen video').forEach(fig => {
        if (fig.classList && (fig.classList.contains("denk-overlay") || fig.classList.contains("nb-badge"))) return;
        const op = parseFloat(window.getComputedStyle(fig).opacity || "0");
        if (op <= 0.01) return; // unsichtbare Figur -> nicht ziehbar
        const r = fig.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const c = fig.closest('.bild-mit-overlay');
            if (c) treffer.push(c);
        }
    });
    if (treffer.length === 0) return null;
    treffer.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0));
    return treffer[0];
}

// Verdrahtet das Klick-und-Ziehen der Figuren. Alle Zeiger-Listener haengen am document
// (nicht an den Figuren), damit auch inaktive Figuren mit pointer-events: none gegriffen
// werden koennen. Ein kurzer Klick ohne Bewegung bleibt ein normaler Klick (startCall);
// erst ab ZIEH_SCHWELLE Pixeln Bewegung wird verschoben und der folgende Klick unterdrueckt.
function setupFigurenZiehen() {
    document.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button > 0) return; // nur linke Taste / Touch / Stift
        // Klicks auf UI-Overlays (Denkblase, Notizbuch-Icon) nicht als Figur-Drag werten -
        // sie liegen ueber der ersten Figur und haetten sonst deren Drag ausgeloest.
        const oben = document.elementFromPoint(e.clientX, e.clientY);
        if (oben && ((oben.closest && oben.closest(".denk-overlay")) || (oben.classList && oben.classList.contains("nb-badge")))) return;
        const container = figurUnterZeiger(e.clientX, e.clientY);
        if (!container) return;
        ziehAktiv = true;
        geradeGezogen = false;
        ziehFigur = container;
        ziehStartX = e.clientX;
        ziehStartY = e.clientY;
        ziehBasisX = parseFloat(container.dataset.dragX || "0");
        ziehBasisY = parseFloat(container.dataset.dragY || "0");
        ziehVorherZ = container.style.zIndex;
        // Referenz der sichtbaren Figur (Haupt-<img>/<video>, ohne Denkblase) erfassen, um
        // die Verschiebung spaeter auf den Fensterbereich zu begrenzen. r.left/top enthalten
        // den aktuellen Offset (ziehBasis) -> abziehen ergibt die Position bei Offset 0.
        const hauptFig = container.querySelector('img:not(.denk-overlay), video');
        if (hauptFig) {
            const r = hauptFig.getBoundingClientRect();
            ziehRefLeft = r.left - ziehBasisX;
            ziehRefTop = r.top - ziehBasisY;
            ziehBreite = r.width;
            ziehHoehe = r.height;
        } else {
            ziehRefLeft = ziehRefTop = 0;
            ziehBreite = ziehHoehe = 0;
        }
        // Waehrend des Ziehens keine weiche Transition -> die Figur klebt am Zeiger.
        container.style.transition = "none";
    });

    document.addEventListener("pointermove", (e) => {
        if (!ziehAktiv || !ziehFigur) return;
        const dx = e.clientX - ziehStartX;
        const dy = e.clientY - ziehStartY;
        if (!geradeGezogen && Math.hypot(dx, dy) < ZIEH_SCHWELLE) return; // noch Klick, kein Zug
        geradeGezogen = true;
        let nx = ziehBasisX + dx;
        let ny = ziehBasisY + dy;
        // Begrenzung: es muss nur ein Stueck der Figur im Fenster bleiben, nicht die ganze.
        // Frueher wurde das VOLLE Bildrechteck im Fenster gehalten - das kostet genau bei den
        // breiten Figurenbildern (koehler/user sind ueber doppelt so breit wie holzmann, der
        // Rest ist transparenter Rand) viel Weg, und sobald das Bild breiter als das Fenster
        // war, wurde die Figur mittig festgehalten und liess sich gar nicht mehr schieben.
        const restX = Math.min(FIGUR_REST_SICHTBAR, ziehBreite);
        const restY = Math.min(FIGUR_REST_SICHTBAR, ziehHoehe);
        const minX = -ziehRefLeft - ziehBreite + restX;
        const maxX = window.innerWidth  - ziehRefLeft - restX;
        const minY = -ziehRefTop - ziehHoehe + restY;
        const maxY = window.innerHeight - ziehRefTop - restY;
        nx = Math.min(Math.max(nx, minX), maxX);
        ny = Math.min(Math.max(ny, minY), maxY);
        ziehFigur.dataset.dragX = String(nx);
        ziehFigur.dataset.dragY = String(ny);
        ziehFigur.style.transform = `translate(${nx}px, ${ny}px)`;
        ziehFigur.style.zIndex = "30"; // waehrend des Ziehens nach vorne
        e.preventDefault();
    }, { passive: false });

    const beenden = () => {
        if (!ziehAktiv) return;
        ziehAktiv = false;
        if (ziehFigur) {
            ziehFigur.style.transition = "";
            ziehFigur.style.zIndex = ziehVorherZ; // vorherige Ebene wiederherstellen
        }
        ziehFigur = null;
        // geradeGezogen bleibt gesetzt, bis der (evtl.) folgende Klick unterdrueckt wurde;
        // der naechste pointerdown setzt es ohnehin zurueck.
    };
    document.addEventListener("pointerup", beenden);
    document.addEventListener("pointercancel", beenden);

    // Ein tatsaechliches Ziehen darf NICHT als Klick (startCall) enden. In der Capture-
    // Phase abfangen, bevor der onclick der Figur feuert.
    document.addEventListener("click", (e) => {
        if (geradeGezogen) {
            e.stopPropagation();
            e.preventDefault();
            geradeGezogen = false;
        }
    }, true);
}

// Faehrt alle vom Nutzer verschobenen Figuren binnen 1s sanft an ihre vordefinierte
// (Flex-)Position zurueck. Wird bei jedem Hintergrundwechsel aufgerufen.
function figurenPositionZuruecksetzen() {
    document.querySelectorAll('.personen .bild-mit-overlay').forEach(c => figurZuruecksetzen(c));
}

// Eine einzelne Figur an ihren normalen (Flex-)Platz zuruecklaufen lassen.
function figurZuruecksetzen(c) {
    const verschoben = parseFloat(c.dataset.dragX || "0") !== 0 || parseFloat(c.dataset.dragY || "0") !== 0;
    if (!verschoben) return;
    c.dataset.dragX = "0";
    c.dataset.dragY = "0";
    c.style.transition = "transform " + (FIGUR_WANDER_MS / 1000) + "s ease";
    c.style.transform = "translate(0px, 0px)";
    setTimeout(() => {
        // Nur aufraeumen, wenn seither nicht erneut gezogen wird/wurde.
        if (!ziehAktiv && parseFloat(c.dataset.dragX || "0") === 0 && parseFloat(c.dataset.dragY || "0") === 0) {
            c.style.transition = "";
            c.style.transform = "";
        }
    }, FIGUR_WANDER_MS);
}

// --- Figuren-Anordnung je Hintergrundbild ---------------------------------------
// Das sichtbare Haupt-Bild/Video einer Figur (ohne die Denkblase, die ein DIV ist).
function figurHauptbild(container) {
    return container ? container.querySelector('img:not(.denk-overlay), video') : null;
}

// Anordnungsliste fuer ein Hintergrundbild, mit demselben Video-Fallback wie bei den
// POIs (regen.mp4 nutzt die Angaben von regen.png, falls keine eigenen da sind).
function figurenAnordnungListe(dateiname) {
    if (!dateiname) return null;
    const name = String(dateiname).split("/").pop().split("?")[0].toLowerCase();
    let liste = figurenAnordnungRegister[name];
    if (!liste && name.endsWith(".mp4")) {
        const stamm = name.slice(0, -4);
        for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]) {
            if (figurenAnordnungRegister[stamm + ext]) { liste = figurenAnordnungRegister[stamm + ext]; break; }
        }
    }
    return Array.isArray(liste) && liste.length > 0 ? liste : null;
}

// Schiebt eine Figur so, dass ihre Mitte auf dem Anteil relX/relY des sichtbaren
// Fensters liegt. Gerechnet wird ueber denselben translate-Offset wie beim Ziehen:
// Zielpunkt minus Figurmitte OHNE Verschiebung.
function figurAufPosition(container, relX, relY) {
    const haupt = figurHauptbild(container);
    if (!haupt) return false;
    const r = haupt.getBoundingClientRect();
    if (!r.width || !r.height) return false; // Bild noch nicht geladen -> nicht raten
    const basisX = parseFloat(container.dataset.dragX || "0");
    const basisY = parseFloat(container.dataset.dragY || "0");
    const nx = relX * window.innerWidth - (r.left + r.width / 2 - basisX);
    const ny = relY * window.innerHeight - (r.top + r.height / 2 - basisY);
    container.dataset.dragX = String(nx);
    container.dataset.dragY = String(ny);
    container.style.transition = "transform " + (FIGUR_WANDER_MS / 1000) + "s ease";
    container.style.transform = `translate(${nx}px, ${ny}px)`;
    return true;
}

// Wird bei JEDEM Hintergrundwechsel statt figurenPositionZuruecksetzen aufgerufen:
// Gibt es fuer das Bild eine Anordnung, wandern die genannten Figuren dorthin und alle
// uebrigen auf ihre normalen Plaetze. Ohne Anordnung bleibt alles wie bisher.
function figurenAnordnenFuerBild(dateiname) {
    const liste = figurenAnordnungListe(dateiname);
    if (!liste) { figurenPositionZuruecksetzen(); return; }
    const ziele = new Map();
    for (const p of liste) ziele.set(String(p[0]).toLowerCase(), p);
    let gesetzt = 0;
    document.querySelectorAll('.personen .bild-mit-overlay').forEach(c => {
        const haupt = figurHauptbild(c);
        const ziel = haupt && haupt.id ? ziele.get(haupt.id.toLowerCase()) : null;
        if (!ziel) { figurZuruecksetzen(c); return; }
        if (figurAufPosition(c, parseFloat(ziel[1]), parseFloat(ziel[2]))) gesetzt++;
    });
    console.log("🧍 Figuren-Anordnung für " + dateiname + ": " + gesetzt + "/" + liste.length + " gesetzt");
}

// --- Anordnung im Spiel einrichten und sichern (Strg + Alt + S) ------------------
// Liest die Standorte aller SICHTBAREN Figuren (opacity > 0) als Anteile des Fensters,
// bezogen auf die Figurmitte - genau die Form, die figurAufPosition wieder herstellt.
function figurenAnordnungLesen() {
    const liste = [];
    document.querySelectorAll('.personen .bild-mit-overlay').forEach(c => {
        const haupt = figurHauptbild(c);
        if (!haupt || !haupt.id) return;
        if (parseFloat(getComputedStyle(haupt).opacity || "1") <= 0) return;
        if (parseFloat(getComputedStyle(c).opacity || "1") <= 0) return;
        const r = haupt.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const runde = v => Math.round(v * 1000) / 1000;
        liste.push([
            haupt.id,
            runde((r.left + r.width / 2) / window.innerWidth),
            runde((r.top + r.height / 2) / window.innerHeight)
        ]);
    });
    return liste;
}

// Kurze Rueckmeldung mitten im Bild (kein alert, das wuerde das Gespraech stoeren).
function zeigeKurzmeldung(text, farbe = "#0a0", dauer = 2500) {
    let el = document.getElementById("kurzmeldung");
    if (!el) {
        el = document.createElement("div");
        el.id = "kurzmeldung";
        el.style.cssText = "position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:9999;" +
            "padding:10px 18px;border-radius:8px;background:rgba(0,0,0,0.75);color:#fff;" +
            "font:16px sans-serif;pointer-events:none;opacity:0;transition:opacity 0.3s ease;";
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.borderLeft = "6px solid " + farbe;
    el.style.opacity = "1";
    clearTimeout(el.dataset.timer);
    el.dataset.timer = String(setTimeout(() => { el.style.opacity = "0"; }, dauer));
}

// Laeuft das Spiel auf dem Server (bewusstheit.org), wird dieselbe Anordnung zusaetzlich
// an einen LOKAL laufenden PHP-Server geschickt - so bleibt die Arbeitskopie unter
// C:\Tools\Bewusstheit\KrimiZeit auf demselben Stand. Voraussetzung: der lokale Server
// laeuft (php -S localhost:8000 -t C:\Tools\Bewusstheit). Die beiden Kandidaten decken
// beide ueblichen Wurzeln ab (-t Bewusstheit bzw. -t KrimiZeit); der erste Treffer zaehlt.
const ANORDNUNG_SPIEGEL = [
    "http://localhost:8000/KrimiZeit/speichereAnordnung.php",
    "http://localhost:8000/speichereAnordnung.php"
];
// Der Befehl, der diesen Server startet - erscheint im Hinweis UND im Konsolen-Log.
const LOKALER_SERVER_BEFEHL = "C:\\Tools\\php\\php.exe -S localhost:8000 -t C:\\Tools\\Bewusstheit";
// Laeuft das Spiel bei IONOS (bewusstheit.org), ist der Weg oben ohnehin versperrt: Chrome
// laesst eine oeffentliche Seite nicht ins private Netz greifen (ERR_BLOCKED_BY_CLIENT), und
// von einem anderen Rechner aus zeigt "localhost" sowieso auf den falschen PC. Der
// zuverlaessige Weg ist dann der Waechter auf dem Arbeits-PC: er beobachtet die Datei auf
// dem Server und holt jede neue Anordnung von selbst nach.
const WAECHTER_BEFEHL = "C:\\Tools\\Bewusstheit\\KrimiZeit\\anordnungWaechter.cmd";

async function spiegleAnordnungLokal(payload) {
    if (/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) return "lokal"; // schon lokal geschrieben
    for (const url of ANORDNUNG_SPIEGEL) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const d = await res.json().catch(() => null);
            if (res.ok && d && d.ok === true) {
                console.log("[lokale Kopie] " + d.nachricht + "  (" + url + ")");
                return url;
            }
            console.warn("[lokale Kopie] " + url + " antwortete:", d || res.status);
        } catch (err) {
            /* naechsten Kandidaten versuchen - Server laeuft dort vermutlich nicht */
        }
    }
    // Hierher kommt nur, wer NICHT auf localhost spielt - also das Spiel bei IONOS laeuft.
    console.warn("Lokale Kopie NICHT aktualisiert. Läuft der Anordnungs-Wächter auf dem Arbeits-PC? "
        + WAECHTER_BEFEHL);
    return null;
}

// Grosser Hinweis, wenn die lokale Datei NICHT geschrieben werden konnte: nennt den Grund
// und den Startbefehl. Bleibt stehen, bis er weggeklickt wird (oder 20 s), und ein Klick
// auf den Befehl legt ihn in die Zwischenablage - sonst muesste man ihn abtippen.
// Der Hinweis wird nur ueber die Deckkraft aus- und eingeblendet und bleibt danach im
// DOM stehen. Ohne pointer-events-Umschaltung liegt er unsichtbar (z-index 10000, bis
// 720px breit, top 10%) im oberen Bilddrittel und faengt dort Klicks ab - der Zeiger wird
// zur Hand, wo nichts zu sehen ist. Sichtbarkeit und Klickbarkeit darum immer zusammen
// schalten.
function hinweisSichtbar(box, an) {
    if (!box) return;
    box.style.opacity = an ? "1" : "0";
    box.style.pointerEvents = an ? "auto" : "none";
    box.style.cursor = an ? "pointer" : "default";
}

function zeigeServerHinweis(kopf, erklaerung, befehlText, labelText, fussText) {
    // Ohne die letzten drei Argumente verhaelt sich alles wie bisher (Startbefehl des
    // lokalen PHP-Servers). befehlText === null laesst den Befehlsblock ganz weg - fuer
    // Faelle, in denen es nichts zu starten gibt.
    const derBefehl = (befehlText === undefined) ? LOKALER_SERVER_BEFEHL : befehlText;
    const derFuss = fussText || "Danach erneut Strg+Alt+S drücken. (Klick schließt diesen Hinweis)";
    let box = document.getElementById("serverhinweis");
    if (!box) {
        box = document.createElement("div");
        box.id = "serverhinweis";
        box.style.cssText = "position:fixed;left:50%;top:10%;transform:translateX(-50%);z-index:10000;" +
            "max-width:min(90vw,720px);padding:16px 20px;border-radius:10px;border-left:6px solid #e90;" +
            "background:rgba(0,0,0,0.88);color:#fff;font:15px/1.5 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);" +
            "cursor:pointer;opacity:0;pointer-events:none;transition:opacity 0.3s ease;";
        document.body.appendChild(box);
    }
    box.innerHTML = "";

    const titel = document.createElement("div");
    titel.style.cssText = "font-weight:bold;margin-bottom:6px;";
    titel.textContent = "⚠ " + kopf;
    box.appendChild(titel);

    const text = document.createElement("div");
    text.style.cssText = "margin-bottom:10px;";
    text.textContent = erklaerung;
    box.appendChild(text);

    let befehl = null;
    if (derBefehl) {
        const label = document.createElement("div");
        label.style.cssText = "margin-bottom:4px;opacity:.8;";
        label.textContent = labelText || "Diesen Server starten (Klick kopiert den Befehl):";
        box.appendChild(label);

        befehl = document.createElement("code");
        befehl.style.cssText = "display:block;padding:8px 10px;border-radius:6px;background:#222;color:#8f8;" +
            "font:13px/1.4 monospace;word-break:break-all;user-select:all;";
        befehl.textContent = derBefehl;
        box.appendChild(befehl);
    }

    const fuss = document.createElement("div");
    fuss.style.cssText = "margin-top:10px;opacity:.6;font-size:13px;";
    fuss.textContent = derFuss;
    box.appendChild(fuss);

    // Kopieren: erst die Clipboard-API, sonst der alte Weg ueber eine Textauswahl
    // (die API ist ohne https/Berechtigung nicht immer erlaubt). Schlaegt beides fehl,
    // bleibt der Befehl markiert stehen und laesst sich mit Strg+C mitnehmen.
    const kopiereBefehl = () => {
        const ueberAuswahl = () => {
            const bereich = document.createRange();
            bereich.selectNodeContents(befehl);
            const auswahl = window.getSelection();
            auswahl.removeAllRanges();
            auswahl.addRange(bereich);
            let ok = false;
            try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
            return ok;
        };
        const melde = ok => {
            fuss.textContent = ok
                ? "Befehl kopiert. " + derFuss
                : "Befehl ist markiert – mit Strg+C kopieren. " + derFuss;
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(derBefehl)
                .then(() => melde(true))
                .catch(() => melde(ueberAuswahl()));
        } else {
            melde(ueberAuswahl());
        }
    };
    if (befehl) befehl.onclick = (e) => {
        e.stopPropagation();                      // Klick auf den Befehl schliesst nicht
        kopiereBefehl();
    };
    box.onclick = () => { hinweisSichtbar(box, false); };

    hinweisSichtbar(box, true);
    clearTimeout(box.dataset.timer);
    box.dataset.timer = String(setTimeout(() => { hinweisSichtbar(box, false); }, 20000));
}

// Strg + Alt + S: Standorte der sichtbaren Figuren fuer das AKTUELLE Hintergrundbild
// in die spielVerlauf.json des Falls schreiben (daten[0].figurenAnordnung).
async function speichereFigurenAnordnung() {
    const bild = szeneJetzt;
    if (!bild) { zeigeKurzmeldung("Kein Hintergrundbild aktiv – nichts gespeichert.", "#c00"); return; }
    const figuren = figurenAnordnungLesen();
    if (figuren.length === 0) { zeigeKurzmeldung("Keine sichtbare Figur – nichts gespeichert.", "#c00"); return; }
    console.log("💾 Anordnung für " + bild + ":", JSON.stringify(figuren));
    const payload = { fall: fall, bild: bild, figuren: figuren };
    try {
        const res = await fetch("speichereAnordnung.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data || data.ok !== true) {
            console.error("[speichereAnordnung.php]", data);
            zeigeKurzmeldung("Speichern fehlgeschlagen: " + ((data && data.error) || res.status), "#c00");
            return;
        }
        // Register sofort mitziehen, damit die Anordnung ohne Neuladen der Seite gilt.
        figurenAnordnungRegister[String(bild).split("/").pop().split("?")[0].toLowerCase()] = figuren;
        console.log("[speichereAnordnung.php] " + data.nachricht);
        // Vom Server aus zusaetzlich die lokale Arbeitskopie nachziehen.
        const spiegel = await spiegleAnordnungLokal(payload);
        if (spiegel === null) {
            // Auf dem Server gespeichert, die Arbeitskopie auf dem PC ist aber noch alt.
            // Dieser Zweig tritt nur auf, wenn das Spiel bei IONOS laeuft (bei localhost
            // liefert spiegleAnordnungLokal "lokal") - dann hilft nur der Waechter.
            zeigeKurzmeldung("Auf dem Server gespeichert – Wächter auf dem Arbeits-PC läuft nicht", "#e90");
            zeigeServerHinweis(
                "Anordnung noch nicht auf dem Arbeits-PC",
                "Die Anordnung für " + bild + " steht auf dem Server. Die Datei "
                + fall + "\\spielVerlauf.json unter C:\\Tools\\Bewusstheit\\KrimiZeit ist aber noch auf altem "
                + "Stand – beim nächsten Hochladen wäre die Anordnung wieder weg. Starte auf dem Arbeits-PC "
                + "den Anordnungs-Wächter, dann holt er sie sich.",
                WAECHTER_BEFEHL,
                "Diesen Wächter auf dem Arbeits-PC starten (Klick kopiert den Befehl):",
                "Der Wächter holt die Anordnung beim Start von selbst ab – Strg+Alt+S muss nicht wiederholt "
                + "werden. (Klick schließt diesen Hinweis)"
            );
            return;
        }
        zeigeKurzmeldung("Anordnung für " + bild + " gespeichert (" + figuren.length + " Figuren)"
            + (spiegel === "lokal" ? "" : " + lokale Kopie"));
    } catch (err) {
        console.error("Anordnung konnte nicht gespeichert werden:", err);
        zeigeKurzmeldung("Speichern fehlgeschlagen – Server nicht erreichbar", "#c00");
        // Lokal gespielt: es fehlt der PHP-Server (Datei per file:// oder ueber den
        // Node-Server, der kein PHP ausfuehrt) - dann hilft der Startbefehl. Bei IONOS
        // gibt es dagegen nichts zu starten, da ist die Leitung oder der Server das Problem.
        if (/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
            zeigeServerHinweis(
                "Nichts gespeichert",
                "speichereAnordnung.php war nicht erreichbar – ohne PHP-Server kann die Anordnung "
                + "nicht in die spielVerlauf.json geschrieben werden."
            );
        } else {
            zeigeServerHinweis(
                "Nichts gespeichert",
                "speichereAnordnung.php auf dem Server war nicht erreichbar – die Anordnung für "
                + bild + " ist nirgends angekommen. Internetverbindung prüfen und Strg+Alt+S erneut "
                + "drücken.",
                null,
                null,
                "(Klick schließt diesen Hinweis)"
            );
        }
    }
}

function setupAnordnungSpeichern() {
    document.addEventListener("keydown", (e) => {
        // e.code statt e.key: mit Alt liefern manche Layouts ein Sonderzeichen statt "s".
        if (!e.ctrlKey || !e.altKey || e.code !== "KeyS") return;
        e.preventDefault();
        speichereFigurenAnordnung();
    });
    // Strg + Alt + D: zeigt, WAS den Zeiger zur Hand macht. Jede Flaeche, die einen
    // Hand-Cursor erzeugt, bekommt einen roten Rahmen mit Namensschild; die Konsole
    // listet sie zusaetzlich mit Groesse auf. Erneutes Druecken blendet es wieder aus.
    // Gedacht fuer die Frage "hier ist eine Hand, aber nichts zu klicken".
    document.addEventListener("keydown", (e) => {
        if (!e.ctrlKey || !e.altKey || e.code !== "KeyD") return;
        e.preventDefault();
        zeigeKlickflaechen();
    });
}

let klickflaechenAn = false;
function zeigeKlickflaechen() {
    document.querySelectorAll(".klickflaeche-marke").forEach(m => m.remove());
    klickflaechenAn = !klickflaechenAn;
    if (!klickflaechenAn) {
        zeigeKurzmeldung("Klickflächen ausgeblendet");
        return;
    }
    // Alles einsammeln, was der Browser mit cursor:pointer zeichnet - unabhaengig davon,
    // ob es sichtbar ist. Genau das ist ja die Frage.
    const gefunden = [];
    document.querySelectorAll("body *").forEach(el => {
        const cs = window.getComputedStyle(el);
        if (cs.cursor !== "pointer" || cs.pointerEvents === "none") return;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const name = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")
            + (typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : "");
        gefunden.push({ name, r, opacity: cs.opacity });

        const marke = document.createElement("div");
        marke.className = "klickflaeche-marke";
        marke.style.cssText = "position:fixed;z-index:99998;pointer-events:none;border:2px solid #f00;"
            + "background:rgba(255,0,0,0.12);font:11px/1.3 monospace;color:#fff;"
            + "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;";
        const schild = document.createElement("div");
        schild.style.cssText = "position:absolute;left:0;top:-15px;white-space:nowrap;background:#c00;padding:0 4px;";
        schild.textContent = name + " (" + Math.round(r.width) + "×" + Math.round(r.height) + ", op " + cs.opacity + ")";
        marke.appendChild(schild);
        document.body.appendChild(marke);
    });
    console.log("🖱️ " + gefunden.length + " Fläche(n) mit Hand-Cursor:");
    gefunden.forEach(g => console.log("   " + g.name + "  " + Math.round(g.r.left) + "," + Math.round(g.r.top)
        + "  " + Math.round(g.r.width) + "×" + Math.round(g.r.height) + "  opacity " + g.opacity));
    zeigeKurzmeldung(gefunden.length + " Klickfläche(n) markiert – Strg+Alt+D blendet sie aus");
}

// --- Denkblase mit dehnbarem Textfeld ---------------------------------------
// Klickbarkeit und Zeiger der Denkblase IMMER an ihre Sichtbarkeit koppeln. Eine
// unsichtbare Blase mit pointer-events/cursor liegt sonst als unsichtbarer Klickfaenger
// ueber der Szene (sie sitzt am ersten Personenbild, also im oberen Bilddrittel): Der
// Zeiger wird dort zur Hand, obwohl nichts zu sehen ist, und Klicks auf POI-Tooltips
// darunter kommen nicht mehr durch.
function denkblaseKlickbar(overlay, an) {
    if (!overlay) return;
    overlay.style.pointerEvents = an ? "auto" : "none";
    overlay.style.cursor = an ? "pointer" : "default";
}

// Die Denkblase (denk.png) wird einmal per Canvas in drei Teile zerlegt: linke Haelfte,
// rechte Haelfte und eine schmale Mittel-Saeule, die sich zu beliebiger Breite dehnen
// laesst. Beim Klick faehrt die Mitte auf, zeigt den Text (dunkelgrau) 5s und schliesst
// wieder. Die Teile sind DIVs mit background-image (kein <img>), damit die Figuren-Logik
// sie nicht anfasst.
let denkTeileURLs = null;      // { links, rechts, mitte, splitRatio }
const DENK_BREITE = 50;        // geschlossene Blasenbreite in px (wie bisher width:50px)
const DENK_SPLIT = 0.53;       // Teilungsstelle (Anteil der Bildbreite) fuer sauberes Mittelprofil
let denkSchliessTimer = null;
let denkPrev = null;           // gemerkte Verankerung/Transform waehrend des Oeffnens

// denk.png per Canvas in die drei Teile schneiden (einmalig). Same-Origin -> kein Taint.
function denkTeileVorbereiten() {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const W = img.naturalWidth, H = img.naturalHeight;
                const splitX = Math.round(W * DENK_SPLIT);
                const schneide = (sx, sw) => {
                    const c = document.createElement("canvas");
                    c.width = sw; c.height = H;
                    c.getContext("2d").drawImage(img, sx, 0, sw, H, 0, 0, sw, H);
                    return c.toDataURL("image/png");
                };
                denkTeileURLs = {
                    links: schneide(0, splitX),
                    rechts: schneide(splitX, W - splitX),
                    mitte: schneide(Math.max(0, splitX - 2), 4), // schmale Saeule, wird gedehnt
                    splitRatio: splitX / W
                };
            } catch (e) {
                console.warn("Denkblase konnte nicht zerlegt werden:", e);
                denkTeileURLs = null;
            }
            resolve(denkTeileURLs);
        };
        img.onerror = () => { console.warn("denk.png nicht ladbar"); resolve(null); };
        img.src = "imgEleven/denk.png";
    });
}

// Setzt die Hintergrundbilder + Breiten der drei Teile einer konkreten Denkblase.
function denkBackgroundsAnwenden(overlay) {
    if (!denkTeileURLs || !overlay) return;
    const links = overlay.querySelector(".denk-links");
    const rechts = overlay.querySelector(".denk-rechts");
    const mitte = overlay.querySelector(".denk-mitte");
    const wLinks = Math.round(DENK_BREITE * denkTeileURLs.splitRatio);
    const wRechts = DENK_BREITE - wLinks;
    if (links) { links.style.backgroundImage = `url(${denkTeileURLs.links})`; links.style.width = wLinks + "px"; }
    if (rechts) { rechts.style.backgroundImage = `url(${denkTeileURLs.rechts})`; rechts.style.width = wRechts + "px"; }
    if (mitte) { mitte.style.backgroundImage = `url(${denkTeileURLs.mitte})`; }
}

// Text in der Denkblase anzeigen: Blase geht nach RECHTS auf (linke Kante bleibt fix),
// Text erscheint 5s, danach schliesst sie wieder. Wird vom Denkblasen-Klick aufgerufen.
function zeigeDenkText(text) {
    const overlay = document.querySelector(".denk-overlay");
    if (!overlay) return;
    const mitte = overlay.querySelector(".denk-mitte");
    const textEl = overlay.querySelector(".denk-text");
    if (!mitte || !textEl) { zeigeText(text); return; } // Fallback: untere Textzeile
    textEl.textContent = text;

    // Den aktuellen (evtl. gewachsenen) Scale BEIBEHALTEN, damit Blase UND Text in der
    // schon erreichten Groesse aufgehen und so bleiben. Transform-Origin auf die linke
    // Seite legen, damit das Auffahren/Wachsen die linke Kante NICHT verschiebt (Blase
    // waechst nach rechts).
    const parent = overlay.offsetParent || overlay.parentElement;
    const pR = parent.getBoundingClientRect();
    // Sichtbare obere linke Ecke VOR dem Umbau merken (im aktuellen Scale-Zustand).
    const vorher = overlay.getBoundingClientRect();
    const vLeft = vorher.left - pR.left;
    const vTop = vorher.top - pR.top;
    if (!denkPrev) {
        denkPrev = { left: overlay.style.left, right: overlay.style.right, top: overlay.style.top, origin: overlay.style.transformOrigin };
    }
    // Von der oberen linken Ecke aus wachsen (nach unten-rechts) -> Ecke bleibt fix, egal
    // welche Verankerung/Origin vorher galt (z. B. top-right waehrend eines Gespraechs).
    overlay.style.transformOrigin = "left top";
    overlay.style.right = "auto";
    overlay.style.left = vLeft + "px";
    overlay.style.top = vTop + "px";
    // Nach Origin-/Ankerwechsel die Ecke nachziehen, falls sie sich (bei Scale>1) verschoben hat.
    void overlay.getBoundingClientRect();
    const nachher = overlay.getBoundingClientRect();
    overlay.style.left = (vLeft + (vLeft - (nachher.left - pR.left))) + "px";
    overlay.style.top = (vTop + (vTop - (nachher.top - pR.top))) + "px";

    overlay.style.opacity = "0.5"; // Blase mit Text ebenfalls halbtransparent
    denkblaseKlickbar(overlay, true);
    overlay.classList.add("offen");

    // Textbreite (unskaliert, span ist nowrap) messen und Mittelstueck darauf dehnen; der
    // Transform-Scale vergroessert Mitte + Text danach gemeinsam. Deckel gegen Ueberlauf.
    const breite = Math.min(textEl.offsetWidth + 8, 320);
    mitte.style.width = breite + "px";

    clearTimeout(denkSchliessTimer);
    denkSchliessTimer = setTimeout(() => schliesseDenkText(), 5000);
}

// Denkblase wieder zusammenrutschen und Verankerung wiederherstellen.
function schliesseDenkText() {
    const overlay = document.querySelector(".denk-overlay");
    if (!overlay) return;
    const mitte = overlay.querySelector(".denk-mitte");
    if (mitte) mitte.style.width = "0px";
    overlay.classList.remove("offen");
    overlay.style.opacity = "0.5"; // zurueck in den sichtbaren Ruhezustand
    denkblaseKlickbar(overlay, true);
    // Nach der Schliess-Animation (0.35s) die urspruengliche Verankerung/Transform zuruecksetzen.
    setTimeout(() => {
        if (denkPrev) {
            overlay.style.left = denkPrev.left;
            overlay.style.right = denkPrev.right;
            overlay.style.top = denkPrev.top;
            overlay.style.transformOrigin = denkPrev.origin || "";
            denkPrev = null;
        }
    }, 400);
}

function renderPersonen() {
    const container = document.querySelector('.personen');
    if (!container || configAgent.length === 0) return;

    container.innerHTML = ""; // alles löschen, bevor wir neu aufbauen

    configAgent.forEach((agent, index) => {
        const name = agent.name;
        const bildDiv = document.createElement("div");
        bildDiv.className = "bild-mit-overlay";
        bildDiv.id = `${name}-container`;

        const pngSrc = `${basis}imgEleven/${name}.png`;
        const portraitSrc = `${basis}imgEleven/${name}-p.png`;

        const img = document.createElement("img");
        img.alt = name;
        img.id = name;
        // Portrait-Variante <name>-p.png wird DIREKT als erste Quelle geladen - so ist sie
        // beim Einstieg (z. B. ueber szene_init) sofort da, statt sichtbar von <name>.png
        // auf <name>-p.png umzuschalten. Laedt sie, wird die Klick-Video-Logik aktiviert
        // (dataset.pSrc/aktivSrc/videoSrc). Fehlt <name>-p.png, gibt es einen 404 im Log
        // (bewusst) und es wird auf <name>.png zurueckgefallen; fehlt auch das, Figur weg.
        img.onload = () => {
            if (img.src.endsWith(`${name}-p.png`)) {
                img.dataset.pSrc = portraitSrc;
                img.dataset.aktivSrc = pngSrc;
                img.dataset.videoSrc = `${basis}imgEleven/${name}.mp4`;
            }
        };
        img.onerror = () => {
            if (img.dataset.portraitVersucht !== "1") {
                img.dataset.portraitVersucht = "1";
                img.src = pngSrc;
            } else {
                bildDiv.remove();
            }
        };
        img.src = portraitSrc;

        bildDiv.appendChild(img);

        if (index === 0) {
            // Denkblase als 3-teiliges Composite (Divs, KEINE <img> -> die Figuren-Logik
            // wie borderWeg/Rand-Effekt/Drag fasst sie nicht an, da sie nur img/video sucht).
            const overlay = document.createElement("div");
            overlay.className = "denk-overlay";
            overlay.style.opacity = "0";
            denkblaseKlickbar(overlay, false);
            const links = document.createElement("div");
            links.className = "denk-teil denk-links";
            const mitte = document.createElement("div");
            mitte.className = "denk-mitte";
            const textEl = document.createElement("span");
            textEl.className = "denk-text";
            mitte.appendChild(textEl);
            const rechts = document.createElement("div");
            rechts.className = "denk-teil denk-rechts";
            overlay.appendChild(links);
            overlay.appendChild(mitte);
            overlay.appendChild(rechts);
            bildDiv.appendChild(overlay);
            denkBackgroundsAnwenden(overlay); // Hintergrundbilder setzen (falls schon geladen)
        }

        container.appendChild(bildDiv);
    });
}
function ladeSettings() {
    if (daten.length === 0) return;

    const ersterEintrag = daten[0];
    if (ersterEintrag.ueberschrift) {
        const ueberschriftElement = document.getElementById("ueberschrift");
        if (ueberschriftElement) {
            ueberschriftElement.textContent = ersterEintrag.ueberschrift;
        } else {
            console.warn("Kein Element mit ID 'ueberschrift' gefunden.");
        }
    }
    if (ersterEintrag.elevenPrompt) {
        elevenPrompt = ersterEintrag.elevenPrompt;
    }
    if (ersterEintrag.toolPrompt) {
        toolPrompt = ersterEintrag.toolPrompt;
    }
    if (ersterEintrag.toolPromptVorne) {
        toolPromptVorne = true;
    }
    if (ersterEintrag.transkriptNichtVorne) {
        transkriptNichtVorne = true;
    }
    // Notausgang: Notizen aus suchwort-Treffern wieder sofort schreiben (altes Verhalten).
    if (ersterEintrag.notizSofort) {
        notizSofort = true;
    }
    // Notausgang: ganzen suchwort-Treffer wieder sofort ausfuehren (altes Verhalten).
    if (ersterEintrag.suchwortSofort) {
        suchwortSofort = true;
    }
    // Abschied des Nutzers ("Tschüss" ...) im Transkript erkennen und das Gespraech selbst
    // beenden, auch wenn das LLM das Ende-Tool nicht aufruft (siehe abschiedPruefen).
    if (ersterEintrag.abschiedErkennen) {
        abschiedErkennen = true;
    }
    // Zentrale POI-Deklaration: [ ["bild.png", [poi], [poi], ...], ... ]
    // -> Register { "bild.png": [ [poi], ... ] }. Wird bei jeder Anzeige des Bildes
    //    automatisch aktiviert (siehe setzePoisFuerBild), egal ueber welchen Eintrag.
    if (Array.isArray(ersterEintrag.poi)) {
        poiRegister = {};
        for (const eintrag of ersterEintrag.poi) {
            if (!Array.isArray(eintrag) || typeof eintrag[0] !== "string") continue;
            const name = eintrag[0].split("/").pop().split("?")[0].toLowerCase();
            poiRegister[name] = eintrag.slice(1).filter(p => Array.isArray(p));
        }
        console.log("POI-Register geladen:", Object.keys(poiRegister));
    }
    // Zentrale Figuren-Anordnung: [ ["bild.png", ["figur", x, y], ...], ... ]
    // -> Register { "bild.png": [ ["figur", x, y], ... ] }. Wird bei jeder Anzeige des
    //    Bildes angewendet (siehe figurenAnordnenFuerBild).
    if (Array.isArray(ersterEintrag.figurenAnordnung)) {
        figurenAnordnungRegister = {};
        for (const eintrag of ersterEintrag.figurenAnordnung) {
            if (!Array.isArray(eintrag) || typeof eintrag[0] !== "string") continue;
            const name = eintrag[0].split("/").pop().split("?")[0].toLowerCase();
            figurenAnordnungRegister[name] = eintrag.slice(1)
                .filter(p => Array.isArray(p) && typeof p[0] === "string" && isFinite(p[1]) && isFinite(p[2]));
        }
        console.log("Figuren-Anordnung geladen:", Object.keys(figurenAnordnungRegister));
    }
    if (ersterEintrag.schluesselwortImTranskript) {
        schluesselwortImTranskript = true;
    }
    if (ersterEintrag.spielstandNurErsteFigur) {
        spielstandNurErsteFigur = true;
    }
    if (ersterEintrag.figurAktivierungPruefen !== undefined) {
        figurAktivierungPruefen = ersterEintrag.figurAktivierungPruefen;
    }
}

// Hintergrundfarbe des Bodys aus einem Standbild ableiten. Noetig fuer Video-Szenen:
// <video> feuert kein onload und ColorThief kann nur Bild-Elemente auswerten. Ersatzweise
// wird das gleichnamige Standbild geprueft (nachtzug.mp4 -> nachtzug.png). Fehlt es, bleibt
// die bisherige Hintergrundfarbe unveraendert - fuer Bilder aendert sich nichts.
function setzeHintergrundfarbeAusStandbild(dateiname) {
    const standbild = String(dateiname ?? "").replace(/\.(mp4|webm|mov)$/i, ".png");
    if (standbild === dateiname) return; // kein Video -> normaler onload-Weg greift
    const probe = new Image();
    probe.onload = () => {
        try {
            const dominantColor = new ColorThief().getColor(probe);
            document.body.style.backgroundColor = `rgb(${dominantColor.join(",")})`;
        } catch (e) {
            console.warn("Hintergrundfarbe aus " + standbild + " nicht ermittelbar:", e);
        }
    };
    probe.onerror = () => console.log("Kein Standbild " + standbild + " - Hintergrundfarbe bleibt.");
    probe.src = basis + "imgEleven/" + standbild;
}

async function ladeSzene(eintrag, init) {
    let szenenName;

    if (eintrag && eintrag.szene_neu) {
        if (eintrag.szene_neu[0] === "weiter") {
            szenenName = szeneJetzt;
        } else {
            szenenName = eintrag.szene_neu[0];
        }
        if (szenenName === "vorher") {
            szenenName = szeneVorher;
        }
    } else {
        const startSzeneEintrag = daten.find(e => e.szene !== undefined);
        if (!startSzeneEintrag) {
            console.warn("Keine Startszene gefunden.");
            return;
        }
        szenenName = startSzeneEintrag.szene;

        if (startSzeneEintrag.erzaehler !== undefined) {
            console.log(getVoiceIdByName("erzaehler"));
            speakWithElevenLabs(startSzeneEintrag.erzaehler, getVoiceIdByName("erzaehler"));
        }
    }

    if (eintrag && init && eintrag.szene_init) {
        szenenName = eintrag.szene_init[0];
        szeneJetzt = eintrag.szene_init[0];
        szeneVorher = eintrag.szene_init[0];
    }
    console.log("📸 Szene:", szenenName);
    if (szeneJetzt != szenenName) szeneVorher = szeneJetzt;
    szeneJetzt = szenenName;
    const istVideo = szenenName.toLowerCase().endsWith(".mp4");

    const container = document.querySelector(".szene");
    if (!container) {
        console.warn("⚠️ Kein Container mit Klasse .szene gefunden.");
        return;
    }

    const vorherigesBild = container.querySelector(".background");
    let bildDateiname = "xxx";

    if (vorherigesBild) {
        const bildUrl = vorherigesBild.src;
        bildDateiname = bildUrl.split("/").pop().split("?")[0];
    }
    if (bildDateiname != szenenName) {
        loeschePois();
        // Hintergrund wechselt -> Figuren wandern an die fuer dieses Bild hinterlegte
        // Anordnung, sonst (wie bisher) auf ihre Ausgangsposition zurueck.
        figurenAnordnenFuerBild(szenenName);
        // Altes Hintergrundbild NICHT sofort entfernen -> weiche Kreuzblende.
        const altesBild = vorherigesBild;
        // Überblenddauer in Sekunden: optionaler 5. Parameter von szene_neu, sonst 0,5s.
        // Beispiel Gewitter: [ "biltzZuhause.png", "weiter", "0.5", true, 0.05 ]
        let fadeDauer = 0.5;
        if (eintrag && Array.isArray(eintrag.szene_neu) && eintrag.szene_neu[4] !== undefined) {
            const f = parseFloat(eintrag.szene_neu[4]);
            if (!isNaN(f) && f >= 0) fadeDauer = f;
        }

        // 🎨 Neues Bild/Video erzeugen
        const bild = istVideo ? document.createElement("video") : document.createElement("img");
        //console.log("Bild:" + szenenName);
        const pushFront = () => {
            bild.classList.add("fg");
            document.body.classList.add("body--bgHold");
        };
        const popFront = () => {
            bild.classList.remove("fg");
            document.body.classList.remove("body--bgHold");
        };
        bild.addEventListener("pointerdown", pushFront);
        // beim Loslassen/Verlassen zurücksetzen
        window.addEventListener("pointerup", popFront);
        bild.addEventListener("pointerleave", popFront);
        bild.addEventListener("pointercancel", popFront);

        // bei Video: Autoplay + Schleife + ohne Ton
        if (istVideo) {
            bild.autoplay = true;
            bild.loop = true;
            bild.muted = true;
            bild.playsInline = true; // für iOS
        }

        bild.classList.add("background");
        bild.style.pointerEvents = "none";
        bild.style.opacity = "0";                       // startet unsichtbar
        bild.style.transition = "opacity " + fadeDauer + "s ease";
        bild.src = basis + "imgEleven/" + szenenName + "?t=" + Date.now();  // Cache-Busting
        bild.alt = szenenName;
        bild.style.width = "100%";
        bild.style.height = "100%";
        bild.style.objectFit = "contain";

        container.appendChild(bild);
        // Zentrale POIs fuer dieses Hintergrundbild aktivieren.
        setzePoisFuerBild(szenenName);

        // Kreuzblende: neues Bild einblenden, altes ausblenden + nach der Blende entfernen.
        let eingeblendet = false;
        const einblenden = () => {
            if (eingeblendet) return;
            eingeblendet = true;
            requestAnimationFrame(() => { bild.style.opacity = "1"; });
            if (altesBild) {
                altesBild.style.transition = "opacity " + fadeDauer + "s ease";
                altesBild.style.opacity = "0";
                setTimeout(() => altesBild.remove(), fadeDauer * 1000);
            }
        };
        if (istVideo) {
            bild.onloadeddata = einblenden;
            // Videos loesen die Farbanpassung unten nicht aus (kein onload, ColorThief kann
            // keine <video>-Elemente) - ersatzweise das gleichnamige Standbild auswerten.
            setzeHintergrundfarbeAusStandbild(szenenName);
        }
        // Notbremse: sollte das Ready-Event ausbleiben (z. B. Ladefehler), nach 3s trotzdem blenden.
        setTimeout(einblenden, 3000);
        bild.onload = function () {
            einblenden();
            const colorThief = new ColorThief();
            const dominantColor = colorThief.getColor(bild); // z. B. [123, 200, 150]
            document.body.style.backgroundColor = `rgb(${dominantColor.join(",")})`;
        };
    }
}
function AudioPlay(eintrag) {
    if (eintrag.playAudio != undefined) {
        audioEintrag = eintrag;
        eintrag = eintrag.playAudio;
    }

    const dateiname = eintrag[0];   // "vogelgezwitscher.mp3"
    const lautstaerke = parseFloat(eintrag[1]);  // 0.06 (als Zahl)
    const loop = eintrag[2];        // true
    const zeigeErzaehler = eintrag[3]; 
    const erzaehlerBild = document.getElementById("erzaehlerBild");

    if (dateiname != "weiter") {
        stopAudioPlay(); // Stoppe evtl. vorheriges Audio
        aktuellesAudio = new Audio(basis + "imgEleven/" + dateiname);

        // Optional: Lautstärke setzen
        if (lautstaerke !== undefined) {
            aktuellesAudio.volume = Math.min(1, Math.max(0, lautstaerke)); // Clamp auf [0,1]
        }

        // Optional: Loop aktivieren
        if (loop === true) {
            aktuellesAudio.loop = true;
        } else { aktuellesAudio.loop = false; }

        // Erzählerbild zeigen, falls gewünscht
        if (zeigeErzaehler === true && erzaehlerBild) {
            erzaehlerBild.style.opacity = 0.8;
        }
        aktuellesAudio.addEventListener("ended", () => {
            erzaehlerBild.style.opacity = 0;
            console.log("audio ", audioEintrag);
            if (audioEintrag) eintragAendern(audioEintrag,true);
            audioEintrag = null;
        });      

        aktuellesAudio.play().catch(err => {
            console.error("Fehler beim Abspielen:", err);
        });
    } else {
        if (lautstaerke !== undefined && aktuellesAudio !== null) {
            aktuellesAudio.volume = Math.min(1, Math.max(0, lautstaerke)); // Clamp auf [0,1]
        }
        if (loop === true && aktuellesAudio !== null) {
            aktuellesAudio.loop = true;
        }
        if (loop === false && aktuellesAudio !== null) {
            aktuellesAudio.loop = false;
        }
    }
    //if (aktuellesAudio) { console.log(loop); }
}
function skaliereErzaehlerBild() {
    const bild = document.getElementById("erzaehlerBild");
    if (!bild) return;

    const breite = window.innerWidth;
    const hoehe = window.innerHeight;
    const ziel = Math.min(breite, hoehe) * 0.5; // 50% der kleineren Seite

    bild.style.width = ziel + "px";
    bild.style.height = "auto";
}

// Bei Start und bei Fensteränderung
window.addEventListener("DOMContentLoaded", skaliereErzaehlerBild);
window.addEventListener("resize", skaliereErzaehlerBild);

function stopAudioPlay() {
    if (aktuellesAudio) {
        aktuellesAudio.pause();
        aktuellesAudio.currentTime = 0;
        aktuellesAudio = null;
        const erzaehlerBild = document.getElementById("erzaehlerBild");
        erzaehlerBild.style.opacity = 0;
        console.log("Stop");
        if (audioEintrag) eintragAendern(audioEintrag);
        audioEintrag = null;
    }
}
function HAudioPlay(dateiname, lautstaerke, loop) {
    if (dateiname == "stille") {
        stopHAudioPlay();
        return;
    }
    if (dateiname == undefined) {
        return;
    }
    lautstaerke = parseFloat(lautstaerke);  // 0.06 (als Zahl)
    //console.log("Hplay "+dateiname);
    if (dateiname != "weiter") {
        stopHAudioPlay(); // Stoppe evtl. vorheriges Audio
        aktuellesHAudio = new Audio(basis + "imgEleven/" + dateiname);

        // Optional: Lautstärke setzen
        if (lautstaerke !== undefined) {
            aktuellesHAudio.volume = Math.min(1, Math.max(0, lautstaerke)); // Clamp auf [0,1]
        }

        // Optional: Loop aktivieren
        if (loop === true) {
            aktuellesHAudio.loop = true;
        } else { aktuellesHAudio.loop = false; }

        aktuellesHAudio.play().catch(err => {
            console.error("Fehler beim Abspielen:", err);
        });
    } else {
        if (lautstaerke !== undefined && aktuellesHAudio !== null) {
            aktuellesHAudio.volume = Math.min(1, Math.max(0, lautstaerke)); // Clamp auf [0,1]
        }
    }
}
function stopHAudioPlay() {
    if (aktuellesHAudio) {
        aktuellesHAudio.pause();
        aktuellesHAudio.currentTime = 0;
        aktuellesHAudio.loop = false;
        aktuellesHAudio = null;
    }
}
async function speichereSpielstand(name, spielstand, spielstandV, notizenArray = notizen, figuren = null) {
    const begrenztesSpielstandV = (spielstandV || [])
        .slice(0, 11)
        .map(v => (v == null ? 0 : v));

    const notizenSauber = Array.isArray(notizenArray) ? notizenArray : [];

    const payload = {
        fall: fall, // Ziel-Fallordner fuer die serverseitige Speicherung
        name: String(name),
        ...(spielstand != null ? { spielstand: String(spielstand) } : {}),
        ...(spielstand != null && figuren ? { figuren } : {}),
        ...(begrenztesSpielstandV != null ? { spielstandV: begrenztesSpielstandV } : {}),
        ...(Array.isArray(notizenSauber) && notizenSauber.length ? { notizen: notizenSauber } : {})
    };


    // Oeffentliche Fassung: wie speichern.php, nur im localStorage (nur gesendete Felder
    // ueberschreiben, Notizen per Text zusammenfuehren).
    if (OEFFENTLICH) {
        const alle = lokaleSpieler();
        const u = alle[payload.name] = (alle[payload.name] && typeof alle[payload.name] === "object") ? alle[payload.name] : {};
        if ("spielstand" in payload) {
            u.spielstand = payload.spielstand;
            if (payload.figuren) u.figuren = payload.figuren; else delete u.figuren;
        }
        if ("spielstandV" in payload) u.spielstandV = payload.spielstandV.slice(0, 10);
        if (!Array.isArray(u.notizen)) u.notizen = [];
        (payload.notizen || []).forEach(n => {
            if (!n || !n.text) return;
            const vorhanden = u.notizen.find(x => x.text === n.text);
            if (vorhanden) vorhanden.add = n.add ?? "";
            else u.notizen.push({ auskunft: n.auskunft ?? "", auskunft_status: n.auskunft_status ?? "", text: n.text, add: n.add ?? "" });
        });
        speichereLokaleSpieler(alle);
        return;
    }

    // Erste Priorität: lokal im Projekt (z. B. live-Server)
    try {
        const res = await fetch("speichern.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data?.nachricht) {
            console.log("[speichern.php] " + data.nachricht, "(Notizen:", data.notizen_anzahl, ")");
            return;
        } else {
            console.warn("[speichern.php] Fehler:", data?.fehler || data);
        }
    } catch (err) {
        console.warn("[speichern.php] Nicht erreichbar, versuche localhost:8000 …", err);
    }

    // Fallback: Lokaler Server (PHP)
    try {
        const resLocal = await fetch("http://localhost:8000/speichern.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const dataLocal = await resLocal.json();
        if (resLocal.ok && dataLocal?.nachricht) {
            console.log("[localhost:8000] " + dataLocal.nachricht, "(Notizen:", dataLocal.notizen_anzahl, ")");
        } else {
            console.error("[localhost:8000] Fehler:", dataLocal?.fehler || dataLocal);
        }
    } catch (err) {
        console.error("[localhost:8000] Auch fehlgeschlagen:", err);
    }
}

async function zeigeAbspann(text, dauerInSekunden = 20, warteNachScroll = 3, pR = false, fontS ='4em', eintr) {
    // Alte Instanzen aufräumen (falls Funktion mehrfach aufgerufen wurde)
    document.querySelectorAll('.abspann-container').forEach(el => el.remove());
    document.getElementById('abspann-style')?.remove();

    // Container erstellen
    const container = document.createElement('div');
    container.className = 'abspann-container';

    // Ein Haupt-Div für den Text und ein separates für die Ermittlungsquote
    const mainTextDiv = document.createElement('div');
    mainTextDiv.className = 'abspann-text';
    mainTextDiv.textContent = text;
    container.appendChild(mainTextDiv);

    if (pR) {
        // Neues Div für die Ermittlungsquote mit einer separaten Klasse
        const rateDiv = document.createElement('div');
        const zahl = performanceRate(eintr);
        let eQ = "";
        if (zahl!=2) eQ = `Ermittlungsquote: ${Math.round(zahl * 100)}%\n`;
        let text;
        switch (true) {
            case (zahl >= 0 && zahl <= 0.2):
                text = "Das wird nicht klappen, wenn Du weiter so viel übersiehst.";
                break;
            case (zahl > 0.2 && zahl <= 0.4):
                text = "Schaue genauer hin, das wird sonst schwierig.";
                break;
            case (zahl > 0.4 && zahl <= 0.6):
                text = "Ermittle genauer! Sonst bleibst Du stecken.";
                break;
            case (zahl > 0.6 && zahl <= 0.8):
                text = "Du ermittelst nicht ganz schlecht, aber es könnten Dir wichtige Indizien fehlen um den Fall aufzuklären.";
                break;
            case (zahl > 0.8 && zahl < 1.0):
                text = "Du hast gut ermittelt, hoffentlich fehlt dir nicht die entscheidende Information.";
                break;
            case (zahl == 2):
                text = "Los gehts, sammle Indizien!";
                break;
            default:
                text = "Perfekt! Nichts übersehen bisher.";
                break;
        }

        rateDiv.className = 'abspann-rate';
        rateDiv.textContent = eQ +text;
        container.appendChild(rateDiv);
    }

    document.body.appendChild(container);

    // Style einfügen
    const style = document.createElement('style');
    style.id = 'abspann-style';
    style.textContent = `
    .abspann-container {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      flex-direction: column; /* Elemente untereinander anordnen */
      justify-content: flex-end;
      align-items: center; /* Zentriert die Elemente horizontal */
      overflow: hidden;
      background: transparent;
      pointer-events: none;
    }
    .abspann-text {
      color: white;
      text-shadow: 2px 2px 4px rgba(0,0,0,.7);
      font-size: ${fontS};
      text-align: center;
      white-space: pre-line;
      pointer-events: none;
    }
    .abspann-rate {
      color: white;
      text-shadow: 2px 2px 4px rgba(0,0,0,.7);
      font-size: 2em; /* Kleinere Schriftgröße */
      text-align: center;
      margin-top: 10px; /* Kleiner Abstand zum Text */
      pointer-events: none;
      white-space: pre-line;
    }
    @keyframes scrollUp {
      0%   { transform: translateY(100%); }
      100% { transform: translateY(-100%); }
    }
    /* Die Animation wird jetzt dem Container zugewiesen */
    .abspann-container .abspann-text,
    .abspann-container .abspann-rate {
        animation: scrollUp ${dauerInSekunden}s linear forwards;
    }
  `;
    document.head.appendChild(style);

    // Nach Ende der Animation + Wartezeit entfernen
    const cleanup = () => {
        setTimeout(() => {
            container.remove();
            style.remove();
        }, Math.max(0, warteNachScroll) * 1000);
    };

    // Finde das letzte animierte Element, um auf das Ende zu warten
    const lastElement = container.lastElementChild;
    if (lastElement) {
        lastElement.addEventListener('animationend', cleanup, { once: true });
    }

    // Fallback: falls 'animationend' nicht feuert (z.B. sehr alte Browser)
    setTimeout(cleanup, (dauerInSekunden + warteNachScroll + 0.1) * 1000);
}

// Prueft asynchron, ob <stamm>-p.png WIRKLICH existiert. Wenn ja, wird das (bereits
// sichtbare) Standbild-Element auf die Portrait-Variante umgestellt und die Klick-Video-
// Logik aktiviert (dataset.pSrc/aktivSrc/videoSrc).
//
// WICHTIG: Der Server leitet fehlende Stufen-Portraits per 301 auf das Basis-Portrait um
// (z. B. weigand3-p.png -> weigand-p.png). Ein reiner new Image()-onload-Check kann diesen
// Redirect NICHT erkennen und wuerde das gerade gesetzte Stufenbild (weigand3.png) faelsch-
// licherweise mit dem lächelnden Basis-Portrait ueberschreiben. Deshalb per fetch pruefen
// und Treffer verwerfen, die (a) fehlen, (b) umgeleitet wurden oder (c) kein Bild sind.
function aktivierePortraitWennVorhanden(imgEl, stamm) {
    const portraitSrc = `${basis}imgEleven/${stamm}-p.png`;
    fetch(portraitSrc, { method: "HEAD" })
        .then(res => {
            const ct = res.headers.get("content-type") || "";
            // res.redirected === true -> Server hat auf ein anderes Bild umgeleitet (kein echtes Portrait).
            if (!res.ok || res.redirected || !ct.startsWith("image/")) return;
            // Element wurde inzwischen ersetzt (z. B. naechster Stufen-Tausch) -> nichts tun.
            if (!imgEl.isConnected) return;
            imgEl.dataset.pSrc = portraitSrc;
            imgEl.dataset.aktivSrc = `${basis}imgEleven/${stamm}.png`;
            imgEl.dataset.videoSrc = `${basis}imgEleven/${stamm}.mp4`;
            // Neue Bildquelle -> Mund-, Zwinker- und Kartenerkennung neu durchlaufen lassen.
            delete imgEl.dataset.gesichtStamm;
            delete imgEl.dataset.mundFuer;
            // Nur umschalten, solange die Figur nicht gerade aktiv (vergroessert) ist.
            if (imgEl.dataset.aktiv !== "1") imgEl.src = portraitSrc;
        })
        .catch(() => { /* Netzwerkfehler -> kein Portrait, Standbild bleibt */ });
}

async function ersetzeBild(name, dateiname, nAgentName) {
    const altElement = document.getElementById(name);
    if (!altElement) { console.warn("ersetzeBild: kein Element '" + name + "' gefunden."); return; }
    figurBild[name] = [dateiname, nAgentName ?? null];   // fuer den Spielstand (figurenZustand)

    // Ein noch laufendes Aktivierungs-Video (Portrait-Klick-Effekt) liegt als Overlay
    // ueber der Figur und wuerde das neue Bild verdecken (z. B. beim Stufen-Wechsel
    // weigand -> weigand2 mitten im Gespraech). Vor dem Tausch entfernen und den
    // Aktiv-Merker der alten Figur zuruecksetzen.
    const altContainer = altElement.parentNode;
    if (altContainer) altContainer.querySelectorAll("video.figur-aktivierung-video").forEach(v => v.remove());
    if (altElement.dataset) altElement.dataset.aktiv = "";

    const istVideo = dateiname.toLowerCase().endsWith(".mp4");

    let neuElement;

    if (istVideo) {
        neuElement = document.createElement("video");
        neuElement.src = `${basis}imgEleven/${dateiname}`;
        neuElement.autoplay = true;
        neuElement.loop = true;
        neuElement.muted = true;
        neuElement.playsInline = true;
        // Kein Bild-in-Bild-Button (Chrome blendet ihn sonst ueber dem Video ein).
        neuElement.disablePictureInPicture = true;
        neuElement.controls = false;
    } else {
        neuElement = document.createElement("img");
        // Sofort das eingetauschte Standbild zeigen (kein await davor -> der Tausch ist nie
        // leer, z. B. weigand -> weigand2 mitten im Gespraech).
        neuElement.src = `${basis}imgEleven/${dateiname}` + `?v=2`;
        // Parallel pruefen, ob eine Portrait-Variante <stamm>-p.png existiert; wenn ja, auf
        // Portrait + Klick-Video umstellen (z. B. russoPrivat). Fehlt sie, bleibt es beim
        // Standbild - der Existenz-Check hinterlaesst dann bewusst einen 404 im Log.
        aktivierePortraitWennVorhanden(neuElement, dateiname.replace(/\.[^.]+$/, ""));
    }

    neuElement.id = name;
    neuElement.alt = name;

    // ✅ ZUERST styles und Klassen übernehmen
    neuElement.style.cssText = altElement.style.cssText;
    neuElement.className = altElement.className;

    // ✅ DANN falls Video: gezielt korrigieren
    if (istVideo) {
        Object.assign(neuElement.style, {
            maxHeight: "min(21vh, 21vw)",
            width: "auto",
            height: "auto",
            objectFit: "contain",
            display: "block",
            margin: "0 auto"
        });
    }
    
    altElement.parentNode.replaceChild(neuElement, altElement);
    // Das Abblenden beim Hover/rechten Rand uebernimmt der zentrale, geometriebasierte
    // mousemove-Handler (siehe oben) - fuer <img> wie <video> gleichermassen. Hier daher
    // nur noch den Klick verdrahten.
    neuElement.onclick = () => {
        const cursor = window.getComputedStyle(neuElement).cursor;
        if (cursor === "pointer") startCall(name, nAgentName ?? undefined);
        let aAudio = new Audio("imgEleven/klick.mp3");
        aAudio.volume = Math.min(1, Math.max(0, 1));
        aAudio.play().catch(err => {
            console.error("Fehler beim Abspielen:", err);
        });
    };
}
// verzoegerungMs: wie lange bis Notizbuch-Render + Schreibgeraeusch. Default 5000 wie
// bisher (Notiz faellt waehrend/kurz nach dem Sprechen an). Zurueckgestellte Notizen aus
// suchwort-Treffern uebergeben einen kleinen Wert - dort ist bereits ausgeredet worden.
async function addOrUpdateNotiz(auskunft, auskunft_status, text, add, verzoegerungMs = 5000) {
    let schonDa = true;
    if (!text) return;
    const i = notizen.findIndex(n => n.text === text);
    if (i >= 0) {
        // Nur "add" aktualisieren
        notizen[i].add = add;
    } else {
        // Neue Notiz anhängen
        notizen.push({
            auskunft: auskunft,
            auskunft_status: auskunft_status,
            text: text,
            add: add
        });
        schonDa = false;
    }
    if (schonDa === false) {
        setTimeout(() => {
            scheduleNotebookRender();
            speichereSpielstand(userName, null, spielstand, notizen);
            let aAudio = new Audio("imgEleven/schreiben.mp3");
            aAudio.volume = Math.min(1, Math.max(0, 0.5));
            aAudio.play().catch(err => {
                console.error("Fehler beim Abspielen:", err);
            });
        }, verzoegerungMs);
    } else {
        setTimeout(() => {
            let aAudio = new Audio("imgEleven/mhm.mp3");
            aAudio.volume = Math.min(1, Math.max(0, 0.6));
            aAudio.play().catch(err => {
                console.error("Fehler beim Abspielen:", err);
            });
        }, Math.min(3000, verzoegerungMs));
    }

}
async function ladeNotizen(username) {
    try {
        let alleUser;
        if (OEFFENTLICH) {
            alleUser = lokaleSpieler(); // oeffentliche Fassung: Spielstaende im Browser
        } else {
            const res = await fetch(basis + "user.json?ts=" + Date.now()); // ts gegen Cache
            if (!res.ok) throw new Error("Fehler beim Laden von user.json");
            alleUser = await res.json();
        }

        if (alleUser[username] && Array.isArray(alleUser[username].notizen)) {
            notizen = alleUser[username].notizen;
        } else {
            notizen = []; // falls keine notizen vorhanden
        }

        if (alleUser[username] && Array.isArray(alleUser[username].spielstandV)) {
            spielstand = alleUser[username].spielstandV;
        } else {
            spielstand = [0,0,0,0,0,0,0,0,0,0,0]; // falls kein spielstandV vorhanden
        }

        if (alleUser[username] && alleUser[username].spielstand) {
            startUser = alleUser[username].spielstand;
        } else {
            startUser = "user_1"; // neuer Nutzer (login.php legt spielstand: null an) -> Spielbeginn
        }

        const fz = alleUser[username]?.figuren;
        gespeicherteFiguren = (fz && typeof fz === "object" && !Array.isArray(fz)) ? fz : null;
        gespeicherteFigurenFuer = gespeicherteFiguren ? alleUser[username].spielstand : null;

        console.log("startUser geladen "+ username+":", startUser);
        console.log("Notizen geladen "+ username+":", notizen);
        console.log("Spielstand geladen "+ username+":", spielstand);

    } catch (err) {
        console.error("Konnte Notizen nicht laden:", err);
        notizen = [];
    }
}



function updateNotebookOverlay(notizenArray) {
    const overlay = document.getElementById("notebook-overlay");
    if (!overlay) return;

    overlay.innerHTML = '<h4 class="nb-title"> </h4>';
    const ul = document.createElement("ul");
    ul.className = "nb-list";

    (Array.isArray(notizenArray) ? notizenArray : []).forEach(n => {
        const text = (n?.text ?? "").trim();
        if (!text) return; // leere Einträge skippen

        // Wenn add = "x", diesen Eintrag komplett überspringen
        if ((n.add ?? "").trim() === "x") return;

        const li = document.createElement("li");
        li.className = "nb-item";

        const meta = document.createElement("div");
        meta.className = "nb-meta";
        meta.textContent = `${n.auskunft ?? ""} · Status: ${n.auskunft_status ?? "-"}`;

        const main = document.createElement("div");
        main.style.whiteSpace = "pre-line"; // \n in Notiztexten als Zeilenumbruch (z. B. Belegungsliste)
        main.textContent = text;

        // Sonderformatierungen nach n.add
        switch ((n.add ?? "").trim()) {
            case "-":
                main.style.textDecoration = "line-through"; // durchgestrichen
                break;
            case "f":
                main.style.fontWeight = "bold"; // fett
                break;
            case "k":
                main.style.fontStyle = "italic"; // kursiv
                break;
        }

        // Zusatz-Text nur anzeigen, wenn add nicht in den Steuerzeichen
        if ((n.add ?? "").trim() && !["x", "-", "f", "k"].includes((n.add ?? "").trim())) {
            const add = document.createElement("div");
            add.className = "nb-meta";
            add.textContent = `Anm.: ${n.add}`;
            li.appendChild(add);
        }

        li.appendChild(meta);
        li.appendChild(main);
        ul.appendChild(li);
    });


    overlay.appendChild(ul);
    overlay.scrollTop = overlay.scrollHeight;
}

function initNotebookOverlay({ imageSrc, title = " " } = {}) {
    const root = document.getElementById("notebook-root");
    if (!root) { console.error("#notebook-root fehlt"); return; }

    const inner = root.querySelector(".nb-inner");
    const imgEl = root.querySelector(".nb-img");
    const titleEl = root.querySelector(".nb-title");

    if (titleEl) titleEl.textContent = title;

    if (imageSrc) {
        // URL robust absolut machen (verhindert relative-Path-Fallen)
        const url = new URL(imageSrc, location.href).toString();

        // 1) als <img>
        if (imgEl) {
            imgEl.src = url + "?ts=" + Date.now(); // Cache-Bust
            //imgEl.onload = () => console.log("IMG geladen:", imgEl.naturalWidth + "×" + imgEl.naturalHeight);
            imgEl.onerror = () => console.error("IMG NICHT geladen (404/Typfehler?):", imgEl.src);
        }

        // 2) zusätzlich als CSS-Background (sichtbar auch bei <img>-Fehlern)
        if (inner) {
            inner.style.backgroundImage = `url("${url}")`;
            // Sanity-Check via HEAD/GET (optional)
            fetch(url, { method: "GET", cache: "no-store" })
                .catch(e => console.error("Background-Check Fehler:", e));
        }
    }

    // Fallback für Browser ohne aspect-ratio:
    const supportsAR = CSS.supports?.("aspect-ratio", "1 / 1");
    if (!supportsAR && root) {
        function sizeFallback() {
            const h = Math.floor(window.innerHeight * 0.5); // 50vh
            root.style.height = h + "px";
            root.style.width = Math.round(h * (915 / 1249)) + "px";
        }
        sizeFallback();
        window.addEventListener("resize", sizeFallback);
    }
}
// Toggle für das Notizbuch unten links
let notebookTimer;

function toggleNotebook(force) {
    const root = document.getElementById('notebook-root');
    if (!root) return;

    if (typeof force === 'boolean') {
        root.classList.toggle('open', force);
    } else {
        root.classList.toggle('open');
    }
    //console.log("notizbuch");
    const overlay = document.getElementById("notebook-overlay");
    overlay.scrollTop = overlay.scrollHeight;

    if (root.classList.contains('open')) {
        startNotebookTimer(root);
        // nur einmal Eventlistener hinzufügen
        if (!root.dataset.hoverEvents) {
            root.addEventListener('mouseenter', () => {
                clearTimeout(notebookTimer); // Timer stoppen
            });
            root.addEventListener('mouseleave', () => {
                startNotebookTimer(root); // Timer neu starten
            });
            root.dataset.hoverEvents = "true";
        }
    } else {
        clearTimeout(notebookTimer);
    }
}

function startNotebookTimer(root) {
    clearTimeout(notebookTimer);
    notebookTimer = setTimeout(() => {
        root.classList.remove('open');
    }, 15000);
}

// Hängt das kleine Notizbuch-Icon an das erste Personenbild
function attachNotebookBadgeToFirstPerson(iconSrc = 'imEleven/notizbuch.png') {
    const firstImg = document.querySelector('.personen img');
    if (!firstImg) return;

    // Badge auf Body-Ebene (fixed) statt in der Figuren-Hierarchie: nur so bleibt es
    // ueber dem Buch-Overlay (z-index 9000) und ist auch bei offenem Buch klickbar.
    const badge = document.createElement('img');
    badge.className = 'nb-badge';
    badge.src = iconSrc;
    badge.alt = 'Notizbuch öffnen/schließen';
    badge.title = 'Notizen';
    document.body.appendChild(badge);

    // Klick toggelt das große Notizbuch
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNotebook();
    });

    // Badge an der unteren linken Ecke der ersten Figur halten (fixed, Viewport-Koords).
    const positioniere = () => {
        const r = firstImg.getBoundingClientRect();
        if (r.width && r.height) {
            badge.style.left = (r.left - 8) + 'px';
            badge.style.top  = (r.bottom - 36) + 'px';
        }
    };
    positioniere();
    window.addEventListener('resize', positioniere);
    window.addEventListener('scroll', positioniere, true);
    setInterval(positioniere, 250); // folgt Skalierung/Wechsel der Figur
}
function renderNotebookNow() {
    // init nur beim allerersten Mal (wenn du init schon woanders machst, kannst du das if weglassen)
    if (!renderNotebookNow._inited && typeof initNotebookOverlay === 'function') {
        initNotebookOverlay({ imageSrc: 'imgEleven/notizbuch.png', title: ' ' });
        renderNotebookNow._inited = true;
    }
    if (typeof updateNotebookOverlay === 'function') {
        updateNotebookOverlay(notizen);
    }
}

// sanftes Throttling: mehrere Updates in einem Frame zusammenfassen
let _nbRaf = null;
function scheduleNotebookRender() {
    if (_nbRaf) return;
    _nbRaf = requestAnimationFrame(() => {
        _nbRaf = null;
        renderNotebookNow();
    });
}

// optional: Notizbuch sichtbar machen
function openNotebook() {
    const root = document.getElementById('notebook-root');
    if (root) root.classList.add('open');
}

function notizEnthalten(text) {
    let enthalten = 0;

    for (let i = 0; i < notizen.length; i++) {
        if (notizen[i].text === text) {
            enthalten = 1;
        }
    }
    return enthalten;
}
