(function () {
    const captions = [
        "Calibrating the tiny screwdrivers…",
        "Sorting the good bolts from the suspicious ones…",
        "Asking the soldering iron to behave…",
        "Checking the bench for runaway washers…",
        "Counting widgets. Losing count. Starting over…",
        "A very small otter is inspecting the tools…",
        "Tuning the gears until they sing…"
    ];
    let activeScreen = null;
    let activeDismiss = null;
    let threePromise = null;
    let otterMountQueue = Promise.resolve();
    let screenSequence = 0;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = () => { script.remove(); resolve(); };
            script.onerror = () => { script.remove(); reject(new Error(`Could not load ${src}`)); };
            document.head.appendChild(script);
        });
    }

    function ensureThree() {
        if (window.THREE) return Promise.resolve();
        if (!threePromise) {
            threePromise = loadScript("three.min.js").catch(error => {
                threePromise = null;
                throw error;
            });
        }
        return threePromise;
    }

    function show() {
        if (activeScreen?.isConnected && !activeScreen.classList.contains("is-leaving")) return;
        activeScreen?.remove();
        const sequence = ++screenSequence;
        const screen = document.createElement("div");
        let captionIndex = Math.floor(Math.random() * captions.length);
        let finished = false;
        screen.className = "otter-loading-screen";
        screen.setAttribute("role", "status");
        screen.setAttribute("aria-live", "polite");
        screen.innerHTML = `
            <div class="otter-loader-card">
                <div class="otter-loader-scene" aria-hidden="true">
                    <div class="otter-loader-model otter-3d" id="otter3d"></div>
                    <span class="otter-loader-spark">✦</span>
                </div>
                <p class="otter-loader-label">OTTER LAB · SYSTEM BOOT</p>
                <strong class="otter-loader-title">Powering up the workbench...</strong>
                <div class="otter-loader-track" aria-hidden="true"><span></span></div>
                <p class="otter-loader-caption" aria-live="polite"></p>
            </div>`;
        const caption = screen.querySelector(".otter-loader-caption");
        caption.textContent = captions[captionIndex];
        document.body.appendChild(screen);
        document.documentElement.classList.add("otter-is-loading");

        const captionTimer = setInterval(() => {
            captionIndex = (captionIndex + 1) % captions.length;
            caption.textContent = captions[captionIndex];
        }, 2600);
        const fallbackTimer = setTimeout(dismiss, 20000);

        function dismiss() {
            if (finished) return;
            finished = true;
            clearTimeout(fallbackTimer);
            clearInterval(captionTimer);
            window.Otter3D?.stop?.();
            screen.classList.add("is-leaving");
            document.documentElement.classList.remove("otter-is-loading");
            setTimeout(() => {
                screen.remove();
                if (activeScreen === screen) activeScreen = null;
            }, 450);
            if (activeDismiss === dismiss) activeDismiss = null;
        }

        activeScreen = screen;
        activeDismiss = dismiss;
        otterMountQueue = otterMountQueue
            .catch(() => {})
            .then(() => ensureThree())
            .then(() => loadScript(`otter3d.js?v=5&loader=${sequence}`))
            .then(() => {
                if (!window.Otter3D) return;
                if (finished || !screen.isConnected || sequence !== screenSequence) {
                    window.Otter3D.stop?.();
                    return;
                }
                window.Otter3D.celebrate();
            })
            .catch(() => {});
    }

    window.OtterLoading = {
        show,
        hide() { activeDismiss?.(); }
    };
    if (!document.documentElement.hasAttribute("data-otter-loading-manual")) show();
})();