/* ============================================================
   OTTER TOURS — the engine
   ------------------------------------------------------------
   No card/box. The otter IS the tutorial — speech bubble shows
   everything, otter points at things, reacts, guides you.
   ============================================================ */

(function () {
    "use strict";

    const SEEN_KEY = "otter.tours.seen.v1";

    let session = null;
    const pending = {};

    /* ---------------- persistence ---------------- */

    function readStore(key) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || "{}");
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) { return {}; }
    }

    function writeStore(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* private mode */ }
    }

    const seenStore = readStore(SEEN_KEY);
    console.log(`[OtterTutorial] Initialized, seenStore:`, seenStore);

    function markSeen(key) {
        console.log(`[OtterTutorial] markSeen called for "${key}"`);
        seenStore[key] = Date.now();
        writeStore(SEEN_KEY, seenStore);
    }

    /* ---------------- dom helpers ---------------- */

    function build(html) {
        const template = document.createElement("template");
        template.innerHTML = html.trim();
        return template.content.firstElementChild;
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">")
            .replace(/"/g, "\"").replace(/'/g, "'");
    }

    /* ---------------- rendering ---------------- */

    function render() {
        const { tour, index } = session;
        const step = tour.steps[index];
        const total = tour.steps.length;
        const isLast = index === total - 1;

        /* Build bubble content — title + body + tip + progress + nav */
        let bubbleHtml = `
            <div class="ot-bubble-title">${escapeHtml(step.title)}</div>
            <div class="ot-bubble-body">${escapeHtml(step.body)}</div>
            ${step.tip ? `<div class="ot-bubble-tip"><span aria-hidden="true">💡</span>${escapeHtml(step.tip)}</div>` : ""}
            <div class="ot-bubble-progress">Step ${index + 1} of ${total}</div>
            <div class="ot-bubble-nav">
                <button class="ot-bubble-btn ot-bubble-prev" data-ot-prev ${index === 0 ? "disabled" : ""} aria-label="Back">← Back</button>
                <button class="ot-bubble-btn ot-bubble-next" data-ot-next aria-label="${isLast ? "Finish" : "Next"}">${isLast ? "All done ✨" : "Next →"}</button>
            </div>`;

        session.otterBubble.innerHTML = bubbleHtml;

        /* Update otter say text (small hint under canvas) */
        if (session.otterSay) {
            session.otterSay.textContent = step.say || "follow me!";
        }

        /* Trigger otter reaction */
        triggerOtterReaction(step, index, total);

        /* Re-attach click handlers to new buttons */
        attachBubbleHandlers();
    }

    function attachBubbleHandlers() {
        if (!session || !session.otterBubble) return;
        const bubble = session.otterBubble;
        bubble.querySelectorAll("[data-ot-next]").forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); next(); };
        });
        bubble.querySelectorAll("[data-ot-prev]").forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); previous(); };
        });
    }

    function triggerOtterReaction(step, index, total) {
        if (!window.TutorialOtter) return;
        const isLast = index === total - 1;
        const isFirst = index === 0;

        if (isFirst) {
            window.TutorialOtter.triggerReaction("wave");
            window.TutorialOtter.setGaze(0, -0.2);
        } else if (isLast) {
            window.TutorialOtter.triggerReaction("celebrate");
            window.TutorialOtter.setGaze(0, -0.3);
        } else if (step.at) {
            window.TutorialOtter.triggerReaction("point");
            const target = document.querySelector(step.at);
            if (target) pointOtterAtTarget(target);
        } else if (step.tip) {
            window.TutorialOtter.triggerReaction("think");
            window.TutorialOtter.setGaze(0.3, 0);
        } else if (step.go) {
            window.TutorialOtter.triggerReaction("excited");
            window.TutorialOtter.setGaze(-0.2, 0);
        } else {
            window.TutorialOtter.triggerReaction("nod");
            window.TutorialOtter.setGaze(0, 0);
        }
    }

    function pointOtterAtTarget(target) {
        if (!session || !session.otterWrap) return;
        const wrap = session.otterWrap;
        const rect = target.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();

        const targetCenterX = rect.left + rect.width / 2;
        const targetCenterY = rect.top + rect.height / 2;
        const wrapCenterX = wrapRect.left + wrapRect.width / 2;
        const wrapCenterY = wrapRect.top + wrapRect.height / 2;

        const dx = (targetCenterX - wrapCenterX) / (window.innerWidth / 2);
        const dy = (targetCenterY - wrapCenterY) / (window.innerHeight / 2);

        window.TutorialOtter.setGaze(clamp(dx, -1, 1), clamp(dy, -1, 1));
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function stepTarget() {
        if (session.tour.spotlight === false) return null;
        const step = session.tour.steps[session.index];
        if (!step.at) return null;
        try { return document.querySelector(step.at); } catch (error) { return null; }
    }

    function syncSpotlight() {
        const target = stepTarget();
        if (!target) { hideSpotlight(); return; }

        const rect = target.getBoundingClientRect();
        const onScreen = rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.right > 0
            && rect.top < window.innerHeight && rect.left < window.innerWidth;

        if (!onScreen) { hideSpotlight(); return; }

        const pad = 8;
        const ring = session.ring;
        ring.hidden = false;
        ring.style.top = `${rect.top - pad}px`;
        ring.style.left = `${rect.left - pad}px`;
        ring.style.width = `${rect.width + pad * 2}px`;
        ring.style.height = `${rect.height + pad * 2}px`;
        ring.style.borderRadius = getComputedStyle(target).borderRadius || "10px";
    }

    function hideSpotlight() {
        if (session) session.ring.hidden = true;
    }

    function positionOtterNear(target) {
        if (!session || !session.otterWrap) return;
        const wrap = session.otterWrap;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const pad = 20;
        const otW = 260;
        const otH = 280;

        if (!target) {
            wrap.style.left = '';
            wrap.style.right = pad + 'px';
            wrap.style.top = '';
            wrap.style.bottom = pad + 'px';
            wrap.style.transform = 'translate(0,0)';
            window.TutorialOtter?.clearGaze();
            return;
        }

        const rect = target.getBoundingClientRect();
        const candidates = [
            {x: rect.left - otW - pad, y: Math.max(pad, rect.top + (rect.height-otH)/2)},
            {x: rect.right + pad, y: Math.max(pad, rect.top + (rect.height-otH)/2)},
            {x: Math.max(pad, (viewportW-otW)/2), y: rect.top - otH - pad},
            {x: Math.max(pad, (viewportW-otW)/2), y: rect.bottom + pad}
        ];

        let best = null;
        for (const c of candidates) {
            if (c.x>=pad && c.x+otW<=viewportW-pad && c.y>=pad && c.y+otH<=viewportH-pad) { best=c; break; }
        }
        if (!best) {
            best = {x: viewportW-otW-pad, y: viewportH-otH-pad};
        }

        wrap.style.left = best.x + 'px';
        wrap.style.right = '';
        wrap.style.top = best.y + 'px';
        wrap.style.bottom = '';
        wrap.style.transform = 'translate(0,0)';

        pointOtterAtTarget(target);
    }

    function layout() {
        if (!session) return;
        syncSpotlight();
        positionOtterNear(stepTarget());
    }

    /* ---------------- stepping ---------------- */

    function goTo(next) {
        const total = session.tour.steps.length;
        session.index = Math.min(Math.max(next, 0), total - 1);
        const step = session.tour.steps[session.index];
        markSeen(session.key);

        if (step.go && typeof session.options.onNavigate === "function") session.options.onNavigate(step);

        render();
        let tries = 0;
        function doLayout() {
            layout();
            const t = stepTarget();
            if ((!t || t.getBoundingClientRect().width===0 || t.offsetParent===null) && tries < 10) {
                tries++;
                setTimeout(doLayout, 60);
                return;
            }
            layout();
        }
        requestAnimationFrame(() => { setTimeout(doLayout, 30); });
        if (typeof session.options.onStep === "function") {
            session.options.onStep(step, session.index, session.tour);
        }
    }

    function next() {
        if (session.index === session.tour.steps.length - 1) { close(); return; }
        goTo(session.index + 1);
    }

    function previous() { goTo(session.index - 1); }

    function close() {
        if (!session) return;
        const { root, ring, otterWrap, options } = session;
        root.remove();
        ring.remove();
        if (otterWrap) otterWrap.remove();
        if (window.TutorialOtter) window.TutorialOtter.dispose();
        if (typeof options.onClose === "function") options.onClose();
        session = null;
        window.removeEventListener("resize", layout);
        window.removeEventListener("scroll", layout, true);
        document.removeEventListener("keydown", onKey);
    }

    function onKey(event) {
        if (!session) return;
        if (event.key === "Escape") { close(); return; }
        if (event.key === "ArrowRight") { event.preventDefault(); next(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); previous(); }
    }

    /* ---------------- open ---------------- */

    function open(key, options) {
        console.log(`[OtterTutorial] open called for "${key}"`);
        if (!window.OtterTours) {
            console.error(`[OtterTutorial] OtterTours not loaded! tutorial-content.js may have failed to load.`);
            return;
        }
        const tour = window.OtterTours[key];
        if (!tour) { console.warn(`OtterTutorial: unknown tour "${key}"`); return; }

        close();
        const opts = options || {};

        const root = build(`<div class="ot-scrim" data-ot-scrim></div>`);
        root.dataset.theme = opts.theme === "light" ? "light" : "dark";

        const ring = build(`<div class="ot-ring" hidden aria-hidden="true"></div>`);
        ring.dataset.theme = root.dataset.theme;

        /* Otter side panel — BIGGER, with bubble that holds ALL content */
        const otterWrap = build(`<div class="otter-side">
            <div class="otter-bubble">
                <div class="otter-bubble-content"></div>
            </div>
            <div class="otter-say"></div>
            <div class="otter-canvas-wrap"><canvas class="otter-tut-canvas"></canvas></div>
        </div>`);
        otterWrap.dataset.theme = root.dataset.theme;
        otterWrap.style.position = "fixed";
        otterWrap.style.display = "flex";
        otterWrap.style.flexDirection = "column";
        otterWrap.style.alignItems = "flex-end";
        otterWrap.style.zIndex = '9999';
        otterWrap.style.pointerEvents = 'none';

        const otterBubble = otterWrap.querySelector(".otter-bubble-content");
        const otterSay = otterWrap.querySelector(".otter-say");
        const otterCanvas = otterWrap.querySelector(".otter-tut-canvas");

        document.body.appendChild(root);
        document.body.appendChild(ring);
        document.body.appendChild(otterWrap);

        session = { key, tour, options: opts, index: 0, root, ring, otterWrap, otterBubble, otterSay, otterCanvas };
        markSeen(key);

        /* Click handlers on bubble (for nav buttons) */
        otterWrap.addEventListener("click", (e) => {
            if (e.target.closest("[data-ot-next]")) { e.stopPropagation(); next(); return; }
            if (e.target.closest("[data-ot-prev]")) { e.stopPropagation(); previous(); return; }
        });

        /* Scrim click to close */
        root.addEventListener("click", event => {
            if (event.target.closest("[data-ot-scrim]")) {
                if (window.confirm("End the tutorial?")) close();
            }
        });

        window.addEventListener("resize", layout);
        window.addEventListener("scroll", layout, true);
        document.addEventListener("keydown", onKey);

        /* Initialize the tutorial otter */
        if (otterCanvas && window.THREE && window.TutorialOtter) {
            try {
                window.TutorialOtter.init(otterCanvas);
            } catch (e) { console.warn(e); }
        } else if (otterCanvas && !window.TutorialOtter) {
            let tries=0;
            function tryInit(){
                tries++;
                if(window.TutorialOtter){
                    try{window.TutorialOtter.init(otterCanvas)}catch(e){}
                    return;
                }
                if(tries<20) setTimeout(tryInit,100);
            }
            tryInit();
        }

        goTo(0);
    }

    /* ---------------- auto start ---------------- */

    function hasSeen(key) { return !!seenStore[key]; }

    function autostart(key, options) {
        console.log(`[OtterTutorial] autostart called for "${key}", hasSeen: ${hasSeen(key)}, session: ${!!session}, pending: ${!!pending[key]}`);
        if (hasSeen(key) || session || pending[key]) return false;

        pending[key] = true;

        window.setTimeout(() => {
            delete pending[key];
            console.log(`[OtterTutorial] autostart timeout fired for "${key}", hasSeen: ${hasSeen(key)}, session: ${!!session}`);
            if (hasSeen(key) || session) return;
            open(key, options);
        }, 700);

        return true;
    }

    window.OtterTutorial = {
        open,
        close,
        goTo,
        next,
        previous,
        autostart,
        hasSeen,
        markSeen,
        isActive: () => !!session
    };
})();