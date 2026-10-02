/* ============================================================
   OTTER TOURS — the engine
   ------------------------------------------------------------
   One overlay, four tours. The host page supplies a theme and a
   navigate callback (its tabs are driven by different functions),
   and this builds the card, the spotlight, the progress and the
   keyboard handling.

   Exposed as window.OtterTutorial.
   ============================================================ */

(function () {
    "use strict";

    const SEEN_KEY = "otter.tours.seen.v1";

    const CARD_WIDTH = 384;
    const CARD_GAP = 18;
    const EDGE = 12;

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

    function markSeen(key) {
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
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    /* ---------------- rendering ---------------- */

    function renderDots(index, total) {
        /* Dots would be unreadable past a dozen steps, so the track becomes
           a bar once the tour is long enough. */
        if (total > 12) {
            const done = total > 1 ? index / (total - 1) : 0;
            return `<div class="ot-track"><span style="width:${Math.round(done * 100)}%"></span></div>`;
        }
        return `<div class="ot-dots">${Array.from({ length: total }, (_, i) =>
            `<button type="button" class="ot-dot${i === index ? " is-current" : ""}${i < index ? " is-done" : ""}" data-ot-jump="${i}" aria-label="Go to step ${i + 1}"></button>`).join("")}</div>`;
    }

    function render() {
        const { tour, index } = session;
        const step = tour.steps[index];
        const total = tour.steps.length;
        const isLast = index === total - 1;

        session.card.innerHTML = `
            <div class="ot-head">
                <span class="ot-act">${step.act ? `<em>${escapeHtml(step.act)}</em>` : ""}<strong>${escapeHtml(tour.label)}</strong></span>
                <button class="ot-close" type="button" data-ot-close aria-label="Close the tour">&times;</button>
            </div>
            <div class="ot-progress">${renderDots(index, total)}<span class="ot-count">Step ${index + 1} of ${total}</span></div>
            <h2 class="ot-title">${escapeHtml(step.title)}</h2>
            <p class="ot-body">${escapeHtml(step.body)}</p>
            ${step.tip ? `<p class="ot-tip"><span aria-hidden="true">✦</span>${escapeHtml(step.tip)}</p>` : ""}
            <div class="ot-foot">
                <button class="ot-back" type="button" data-ot-prev${index === 0 ? " disabled" : ""}>&larr; Back</button>
                <button class="ot-next" type="button" data-ot-next>${isLast ? "Finish tour" : "Next &rarr;"}</button>
            </div>`;
    }

    /* ---------------- spotlight ---------------- */

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

    /* The card hangs below the target, centred on it. If it will not fit
       there it flips above, then falls back to the sides, and only centres
       on screen when nothing else works. */
    function placeCard() {
        const target = stepTarget();
        const card = session.card;
        card.style.left = "";
        card.style.top = "";

        const viewportH = window.innerHeight;
        const viewportW = window.innerWidth;

        if (!target) {
            card.style.left = `${Math.max(EDGE, (viewportW - CARD_WIDTH) / 2)}px`;
            card.style.top = `${Math.max(EDGE, (viewportH - card.offsetHeight) / 2)}px`;
            return;
        }

        const rect = target.getBoundingClientRect();
        const cardH = card.offsetHeight;

        /* The card itself shrinks to 100vw - 24px on narrow screens, so the
           positioning maths has to use that same width or it overflows. */
        const cardW = Math.min(CARD_WIDTH, viewportW - EDGE * 2);
        const above = rect.top - cardH - CARD_GAP;
        const centredX = rect.left + rect.width / 2 - cardW / 2;

        const candidates = [
            { left: centredX, top: rect.bottom + CARD_GAP, vertical: true },
            { left: centredX, top: above, vertical: true },
            { left: rect.right + CARD_GAP, top: rect.top, vertical: false },
            { left: rect.left - cardW - CARD_GAP, top: rect.top, vertical: false }
        ];

        for (const spot of candidates) {
            const widthOk = spot.left >= EDGE - 0.5 && spot.left + cardW <= viewportW - EDGE + 0.5;
            if (!widthOk) continue;

            /* Stacked above/below needs the full card height to fit; a side
               card can be clamped vertically and stay readable. */
            if (spot.vertical) {
                if (spot.top < EDGE || spot.top + cardH > viewportH - EDGE) continue;
                card.style.left = `${spot.left}px`;
                card.style.top = `${spot.top}px`;
                return;
            }

            card.style.left = `${spot.left}px`;
            card.style.top = `${Math.min(Math.max(EDGE, spot.top), Math.max(EDGE, viewportH - cardH - EDGE))}px`;
            return;
        }

        card.style.left = `${Math.max(EDGE, (viewportW - CARD_WIDTH) / 2)}px`;
        card.style.top = `${Math.max(EDGE, (viewportH - cardH) / 2)}px`;
    }

    function layout() {
        if (!session) return;
        syncSpotlight();
        placeCard();
    }

    /* ---------------- stepping ---------------- */

    function goTo(next) {
        const total = session.tour.steps.length;
        session.index = Math.min(Math.max(next, 0), total - 1);
        const step = session.tour.steps[session.index];
        markSeen(session.key);

        /* Switch the host tab before anything is measured, otherwise the
           target is still inside a hidden view and the ring lands nowhere. */
        if (step.go && typeof session.options.onNavigate === "function") session.options.onNavigate(step);

        render();
        layout();
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
        const { root, ring, card, options } = session;
        root.remove();
        ring.remove();
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
        const tour = window.OtterTours && window.OtterTours[key];
        if (!tour) { console.warn(`OtterTutorial: unknown tour "${key}"`); return; }

        close();
        const opts = options || {};

        const root = build(`<div class="ot-scrim" data-ot-scrim></div>`);
        root.dataset.theme = opts.theme === "light" ? "light" : "dark";

        const ring = build(`<div class="ot-ring" hidden aria-hidden="true"></div>`);
        ring.dataset.theme = root.dataset.theme;

        const card = build(`<div class="ot-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(tour.label)} tour"></div>`);
        card.dataset.theme = root.dataset.theme;

        root.appendChild(card);
        document.body.appendChild(root);
        document.body.appendChild(ring);

        session = { key, tour, options: opts, index: 0, root, ring, card };
        markSeen(key);

        card.addEventListener("click", event => {
            if (event.target.closest("[data-ot-close]")) { close(); return; }
            if (event.target.closest("[data-ot-next]")) { next(); return; }
            if (event.target.closest("[data-ot-prev]")) { previous(); return; }
            const jump = event.target.closest("[data-ot-jump]");
            if (jump) goTo(Number(jump.dataset.otJump));
        });

        root.addEventListener("click", event => {
            if (event.target.closest("[data-ot-scrim]")) close();
        });

        window.addEventListener("resize", layout);
        window.addEventListener("scroll", layout, true);
        document.addEventListener("keydown", onKey);

        /* Switch the host tab before the first spotlight is measured,
           otherwise the target is still hidden and the ring lands nowhere. */
        goTo(0);
    }

    /* ---------------- auto start ---------------- */

    function hasSeen(key) { return !!seenStore[key]; }

    /* Opens the tour by itself the first time somebody lands on a console.
       The flag is written the moment the tour opens, so bailing out early
       still counts as seen and nobody gets ambushed twice. */
    function autostart(key, options) {
        if (hasSeen(key) || session || pending[key]) return false;

        /* A second autostart can land in the same tick, before the timer runs.
           Park the key so only one is ever queued. */
        pending[key] = true;

        /* Let the host settle into its first view first, otherwise the first
           spotlight is measured against a page that has not finished
           laying out. */
        window.setTimeout(() => {
            delete pending[key];
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
