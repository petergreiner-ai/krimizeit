import { notizen, daten, eintragAendern, basis } from './eleven.js?v=63';





export function performanceRate(suchObj) {



    const alles = JSON.stringify(daten);

    const teil = alles.split(JSON.stringify(suchObj))[0] + JSON.stringify(suchObj);



    //console.log(teil);

    const re = /'message'\s*=\s*'([^']+)'/g;

    const messages = [];

    let m;



    while ((m = re.exec(teil)) !== null) {

        let firstChar = m[1][0];

        if (isNaN(firstChar)) messages.push(m[1]);

    }



    const uMessages = [...new Set(messages)];

    //console.log(uMessages);

    let uNotizen = [];



    for (let i = 0; i < notizen.length; i++) {

        uNotizen.push(notizen[i].text);

    }



    //console.log(uNotizen);

    // Z�hler f�r die gemeinsamen Nachrichten

    let commonCount = 0;



    // Durchlaufen der einzigartigen Nachrichten (uMessages)

    for (let i = 0; i < uMessages.length; i++) {

        // �berpr�fen, ob die Nachricht in uNotizen enthalten ist

        if (uNotizen.includes(uMessages[i])) {

            commonCount++;

        }

    }



    // Berechnung des Verh�ltnisses

    const totalUMessages = uMessages.length;

    const ratio = totalUMessages > 0 ? commonCount / totalUMessages : 2;



    console.log("Anzahl der gefundenen Indizien:", commonCount);

    console.log("Gesamtzahl der m�glichen Indizien:", totalUMessages);

    console.log("Verh�ltnis:", ratio);

    return ratio;

}



// -------- Konfiguration (nur Pfade anpassen) --------

const BUCH_BG_SRC = 'imgEleven/buch.png';         // gro�es Buch (Hintergrund)

const PFEIL_L_SRC = 'imgEleven/pfeilLinks.png';

const PFEIL_R_SRC = 'imgEleven/pfeilRechts.png';



// -------- interner State --------

let buchSeiten = [];

let buchIndex = 0;

let handlersBound = false;

let pointerTimer = null;



// H�he ist 80vh; Breite aus Bildratio des Buchhintergrundes berechnen,

// damit das Buch wirklich zentriert und korrekt skaliert ist.

function setStageWidthFromImage(img, stage) {

    if (!img?.naturalWidth || !img?.naturalHeight) return;

    const ar = img.naturalWidth / img.naturalHeight;

    stage.style.width = Math.round(stage.clientHeight * ar) + 'px';

}



function isVideo(path) {

    return /\.(mp4|webm|ogg|mov)$/i.test(path || '');

}



function getBildPfad(bild) {

    if (!bild) return '';

    if (/^(https?:|\/)/.test(bild)) return bild;  // absolute URL

    return basis + 'imgEleven/' + bild;           // fallspezifischer Unterordner

}











function showBookPointer(duration = 5000) {

    const pointer = document.getElementById('buch-pointer');

    if (!pointer) return;

    clearTimeout(pointerTimer);



    pointer.classList.remove('visible');

    pointer.style.animation = 'none';

    pointer.offsetWidth; // force reflow so the animation restarts cleanly

    pointer.style.animation = '';

    pointer.classList.add('visible');



    if (duration > 0) {

        pointerTimer = setTimeout(() => {

            hideBookPointer();

        }, duration);

    }

}



function hideBookPointer() {

    const pointer = document.getElementById('buch-pointer');

    if (!pointer) return;

    clearTimeout(pointerTimer);

    pointerTimer = null;



    pointer.classList.remove('visible');

    pointer.style.animation = 'none';

    pointer.offsetWidth; // reflow to reset animation state

    pointer.style.animation = '';

}

export function updateBuchUI(e =true) {

    const prevEl = document.getElementById('buch-prev');

    const nextEl = document.getElementById('buch-next');

    const imgEl = document.getElementById('buch-imgPage');

    const vidEl = document.getElementById('buch-videoPage');



    if (!buchSeiten.length) {

        // alles leeren

        if (imgEl) imgEl.removeAttribute('src');

        if (vidEl) { vidEl.pause(); vidEl.removeAttribute('src'); vidEl.load(); }

        prevEl?.setAttribute('aria-disabled', 'true');

        nextEl?.setAttribute('aria-disabled', 'true');

        return;

    }



    // aktuelles Seitenobjekt

    const unterDaten = buchSeiten[buchIndex];

    const src = getBildPfad(unterDaten.bild);



    if (isVideo(src)) {

        // Video anzeigen

        if (imgEl) imgEl.style.display = 'none';

        if (vidEl) {

            vidEl.style.display = 'block';

            // Quelle nur setzen, wenn neu

            const abs = new URL(src, location.href).toString();

            if (vidEl.src !== abs) {

                vidEl.pause();

                vidEl.removeAttribute('src');

                vidEl.load();

                vidEl.src = abs;

            }

            vidEl.muted = true;             // Autoplay-Policy

            vidEl.play().catch(() => { });     // Autoplay versuchen

        }

    } else {

        // Bild anzeigen

        if (vidEl) { vidEl.pause(); vidEl.style.display = 'none'; }

        if (imgEl) {

            imgEl.style.display = 'block';

            imgEl.src = src;

        }

    }



    // Pfeile aktiv/deaktiv

    prevEl?.toggleAttribute('aria-disabled', buchIndex <= 0);

    nextEl?.toggleAttribute('aria-disabled', buchIndex >= buchSeiten.length - 1);



    // Nachbarbilder preloaden

    [buchIndex + 1, buchIndex - 1].forEach(i => {

        if (i >= 0 && i < buchSeiten.length) {

            const nsrc = getBildPfad(buchSeiten[i].bild);

            if (!isVideo(nsrc)) {

                const im = new Image();

                im.src = nsrc;

            }

        }

    });



    // Hook: Zusatzdaten (Audio, Text, �)

    if (typeof window.eintragAendern === 'function') {

        try { window.eintragAendern(unterDaten); } catch (e) { console.error(e); }

    }

    if (e) eintragAendern(unterDaten);

}



function openBuch(open = true) {

    const overlay = document.getElementById('buch-overlay');

    const stage = document.getElementById('buch-stage');

    const bg = document.getElementById('buch-bg');

    hideBookPointer();



    if (open) {

        // sichtbar machen

        overlay.style.display = 'flex';

        overlay.classList.add('open');



        // Accessibility: sichtbar => nicht aria-hidden/inert

        overlay.removeAttribute('aria-hidden');

        overlay.removeAttribute('inert');



        // optional fokussieren (nur wenn sichtbar)

        overlay.focus({ preventScroll: true });



        // Gr��e an Buchbild anpassen

        if (bg?.complete) setStageWidthFromImage(bg, stage);

        bg?.addEventListener('load', () => setStageWidthFromImage(bg, stage), { once: true });

    } else {

        // 1) Wenn aktuell ein Kind im Overlay den Fokus hat: Fokus raus

        const active = document.activeElement;

        if (active && overlay.contains(active)) {

            // Variante A: auf Body schieben

            document.body.focus();

            // Variante B (zus�tzlich): explizit blur

            active.blur();

        }



        // 2) Verstecken + f�r ATs unzug�nglich machen

        overlay.classList.remove('open');

        overlay.style.display = 'none';

        overlay.setAttribute('aria-hidden', 'true'); // oder: overlay.setAttribute('inert', '');

    }

}



function toggleBuch() {

    const overlay = document.getElementById('buch-overlay');

    openBuch(overlay.style.display !== 'flex');

    console.log(overlay.style.display);

    if (overlay.style.display == 'flex' && buchIndex == 0) { updateBuchUI(); }

}



function setBookPagesFromDaten(daten) {

    const arr = Array.isArray(daten?.buch) ? daten.buch : [];

    // nur Eintr�ge mit .bild �bernehmen

    buchSeiten = arr.filter(p => p && p.bild);

    buchIndex = 0;

    updateBuchUI();

}



// feste Handler-Referenzen

function onToggleClick() { toggleBuch(); }

function onPrevClick() {

    if (buchIndex > 0) {

        buchIndex--; updateBuchUI();

        let aAudio = new Audio("imgEleven/umblaettern.mp3");

        aAudio.volume = Math.min(1, Math.max(0, 0.4));

        aAudio.play().catch(err => {

            console.error("Fehler beim Abspielen:", err);

        });

    };

    if (buchIndex == 0) { document.getElementById('buch-prev').style.opacity = 0; } else { document.getElementById('buch-prev').style.opacity = 1; }    

    if (buchIndex == buchSeiten.length - 1) { document.getElementById('buch-next').style.opacity = 0; } else { document.getElementById('buch-next').style.opacity = 1; }    

}

function onNextClick() {

    if (buchIndex < buchSeiten.length - 1) {

        buchIndex++; updateBuchUI();

        let aAudio = new Audio("imgEleven/umblaettern.mp3");

        aAudio.volume = Math.min(1, Math.max(0, 0.4));

        aAudio.play().catch(err => {

            console.error("Fehler beim Abspielen:", err);

        });

    };

    if (buchIndex == 0) { document.getElementById('buch-prev').style.opacity = 0; } else { document.getElementById('buch-prev').style.opacity = 1; }

    if (buchIndex == buchSeiten.length - 1) { document.getElementById('buch-next').style.opacity = 0; } else { document.getElementById('buch-next').style.opacity = 1; }

}

function onOverlayKey(e) {

    if (e.key === 'ArrowRight') onNextClick();

    if (e.key === 'ArrowLeft') onPrevClick();

    if (e.key === 'Escape') openBuch(false);

}



// Hilfsfunktionen f�r Handler

function bindHandlers() {

    if (handlersBound) return;

    document.getElementById('buch-toggle').addEventListener('click', onToggleClick);

    document.getElementById('buch-prev').addEventListener('click', onPrevClick);

    document.getElementById('buch-next').addEventListener('click', onNextClick);

    document.getElementById('buch-overlay').addEventListener('keydown', onOverlayKey);

    handlersBound = true;

}

function unbindHandlers() {

    if (!handlersBound) return;

    document.getElementById('buch-toggle').removeEventListener('click', onToggleClick);

    document.getElementById('buch-prev').removeEventListener('click', onPrevClick);

    document.getElementById('buch-next').removeEventListener('click', onNextClick);

    document.getElementById('buch-overlay').removeEventListener('keydown', onOverlayKey);

    handlersBound = false;

}



// ------------------- Exportierte Funktionen -------------------



export function initBuchWithDaten(daten) {

    const toggleBtn = document.getElementById('buch-toggle');

    const bg = document.getElementById('buch-bg');

    const stage = document.getElementById('buch-stage');

    const toggleImg = toggleBtn.querySelector('img'); // <img> im Button





    // Bildquellen setzen

    document.getElementById('buch-prev').src = 'imgEleven/pfeilLinks.png';

    document.getElementById('buch-next').src = 'imgEleven/pfeilRechts.png';

    //bg.src = 'imgEleven/buch.png';

    const arr = Array.isArray(daten?.buch) ? daten.buch : [];

    buchSeiten = arr.filter(p => p && p.bild);

    buchIndex = 0;

    bg.src = arr[0]?.hintergrundbild

        ? basis + "imgEleven/" + arr[0].hintergrundbild

        : 'imgEleven/buch.png';

    toggleImg.src = arr[0]?.hintergrundbild

        ? basis + "imgEleven/" + arr[0].hintergrundbild

        : 'imgEleven/buch.png';

    // Toggle-Button sichtbar machen

    toggleBtn.style.display = 'block';

    showBookPointer();





    // Stage-Breite anpassen

    bg.onload = () => setStageWidthFromImage(bg, stage);

    window.addEventListener('resize', () => setStageWidthFromImage(bg, stage));



    if (buchIndex == 0) { document.getElementById('buch-prev').style.opacity = 0; } else { document.getElementById('buch-prev').style.opacity = 1; }

    if (buchIndex == buchSeiten.length - 1) { document.getElementById('buch-next').style.opacity = 0; } else { document.getElementById('buch-next').style.opacity = 1; }



    bindHandlers();   // Events binden (nur einmal)

    updateBuchUI(false);   // erste Seite anzeigen

}



export function wegMitBuch() {

    openBuch(false);

    hideBookPointer(); // Overlay schliessen



    // Icon verschwinden lassen

    const toggleBtn = document.getElementById('buch-toggle');

    if (toggleBtn) toggleBtn.style.display = 'none';



    // Video sicher stoppen

    const vidEl = document.getElementById('buch-videoPage');

    if (vidEl) { vidEl.pause(); vidEl.removeAttribute('src'); vidEl.load(); }



    // Events wieder l�sen

    unbindHandlers();



    // State aufr�umen

    buchSeiten = [];

    buchIndex = 0;

}



// Overlay f�r vollfl�chigen Bild-Scroll-Effekt

let activeScrollingOverlay = null;



export function showScrollingOverlay(bild, options = {}) {

    const { duration = 6000, easing = 'ease-in-out', keepOnScreen = false, removeDelay = 500 } = options ?? {};

    const src = getBildPfad(bild);

    if (!src) return Promise.reject(new Error('Kein Bildpfad �bergeben.'));



    if (activeScrollingOverlay) {

        activeScrollingOverlay.teardown();

    }



    return new Promise((resolve, reject) => {

        const overlay = document.createElement('div');

        overlay.setAttribute('data-role', 'scroll-overlay');

        overlay.style.position = 'fixed';

        overlay.style.inset = '0';

        overlay.style.width = '100vw';

        overlay.style.height = '100vh';

        overlay.style.zIndex = '20000';

        overlay.style.display = 'flex';

        overlay.style.justifyContent = 'center';

        overlay.style.alignItems = 'flex-start';

        overlay.style.background = 'transparent';

        overlay.style.overflow = 'hidden';
        overlay.style.pointerEvents = 'none';



        const img = document.createElement('img');

        img.src = src;

        img.alt = '';

        img.style.width = '100vw';

        img.style.height = 'auto';

        img.style.maxHeight = 'none';

        img.style.objectFit = 'contain';

        img.style.willChange = 'transform';

        img.style.opacity = '1';

        img.style.transform = 'translateY(-100%)';



        overlay.appendChild(img);

        document.body.appendChild(overlay);



        const prevBodyOverflow = document.body.style.overflow;

        const prevHtmlOverflow = document.documentElement.style.overflow;

        document.body.style.overflow = 'hidden';

        document.documentElement.style.overflow = 'hidden';



        const cleanup = () => {

            if (cleanup.done) return;

            cleanup.done = true;

            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);

            document.body.style.overflow = prevBodyOverflow;

            document.documentElement.style.overflow = prevHtmlOverflow;

            if (activeScrollingOverlay?.overlay === overlay) {

                activeScrollingOverlay = null;

            }

        };

        cleanup.done = false;



        let settled = false;

        const safeResolve = () => {

            if (settled) return;

            settled = true;

            resolve();

        };

        const safeReject = (err) => {

            if (settled) return;

            settled = true;

            reject(err);

        };



        const state = {

            overlay,

            animation: null,

            teardown: () => {

                state.animation?.cancel();

                cleanup();

                safeResolve();

            }

        };



        activeScrollingOverlay = state;



        const startAnimation = () => {

            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;

            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

            const scale = viewportWidth > 0 && img.naturalWidth > 0 ? viewportWidth / img.naturalWidth : 1;

            const imageHeight = img.naturalHeight * scale;

            const startY = -imageHeight;

            const targetY = 0;

            console.log('scroll overlay start', { bild, startY, targetY, imageHeight, duration, easing });



            img.style.transform = `translateY(${startY}px)`;



            const animation = img.animate(

                [

                    { transform: `translateY(${startY}px)` },

                    { transform: `translateY(${targetY}px)` }

                ],

                { duration, easing, fill: 'forwards' }

            );



            state.animation = animation;



            const finalize = () => {

                if (!keepOnScreen) {

                    const remove = () => {

                        cleanup();

                        safeResolve();

                    };

                    if (removeDelay > 0) {

                        setTimeout(remove, removeDelay);

                    } else {

                        remove();

                    }

                } else {

                    img.style.transform = `translateY(${targetY}px)`;

                    img.style.transition = '';

                    safeResolve();

                }

            };



            animation.addEventListener('finish', finalize, { once: true });

            animation.addEventListener('cancel', () => {

                cleanup();

                safeResolve();

            }, { once: true });

        };



        if (img.complete && img.naturalWidth) {

            startAnimation();

        } else {

            img.addEventListener('load', startAnimation, { once: true });

            img.addEventListener('error', () => {

                cleanup();

                safeReject(new Error(`Bild "${bild}" konnte nicht geladen werden.`));

            }, { once: true });

        }

    });

}



// Beendet das laufende Overlay vorzeitig.

export function removeScrollingOverlay() {

    if (!activeScrollingOverlay) return;

    const current = activeScrollingOverlay;

    activeScrollingOverlay = null;

    current.teardown?.();

}

