/* Shared social-feed helpers used by both the student and teacher
   dashboards: emoji + GIF + file attachments for the formal/informal
   announcement feed. Exposed as window.Social. */

(function () {
    "use strict";

    const EMOJIS = [
        "😀", "😁", "😂", "🤣", "😊", "😇", "😍", "🤩", "😜", "🤪",
        "😎", "🤓", "🧐", "🥳", "😏", "😌", "😴", "🤗", "🤔", "😬",
        "😢", "😭", "😅", "🥺", "😳", "🙃", "😉", "🤯", "😱", "🥶",
        "👍", "👎", "👏", "🙏", "👊", "✌️", "🤞", "💪", "✍️", "🙌",
        "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💯", "✨", "🎉",
        "🎂", "🎁", "🔥", "⚡", "🌈", "☀️", "🌙", "⭐", "🍀", "🎓",
        "🔧", "⚙️", "🤖", "🚀", "🛠️", "💡", "📚", "🏆", "⚽", "🎮"
    ];

    /* Discord-style `:name` autocomplete registry, sorted by name so the
       "closest" suggestion is the first starts-with match. */
    const EMOJI_CODES = [
        { name: "100", char: "💯" }, { name: "alien", char: "👽" },
        { name: "angry", char: "😠" }, { name: "art", char: "🎨" },
        { name: "balloon", char: "🎈" }, { name: "banana", char: "🍌" },
        { name: "basketball", char: "🏀" }, { name: "bear", char: "🐻" },
        { name: "beer", char: "🍺" }, { name: "bell", char: "🔔" },
        { name: "bike", char: "🚴" }, { name: "blush", char: "😊" },
        { name: "book", char: "📖" }, { name: "boom", char: "💥" },
        { name: "brain", char: "🧠" }, { name: "bread", char: "🍞" },
        { name: "bug", char: "🐛" }, { name: "bulb", char: "💡" },
        { name: "burger", char: "🍔" }, { name: "bus", char: "🚌" },
        { name: "butterfly", char: "🦋" }, { name: "cactus", char: "🌵" },
        { name: "cake", char: "🍰" }, { name: "calendar", char: "📅" },
        { name: "camera", char: "📷" }, { name: "cat", char: "🐱" },
        { name: "chart", char: "📈" }, { name: "check", char: "✅" },
        { name: "cherry", char: "🍒" }, { name: "chicken", char: "🐔" },
        { name: "clap", char: "👏" }, { name: "cloud", char: "☁️" },
        { name: "coffee", char: "☕" }, { name: "computer", char: "💻" },
        { name: "cookie", char: "🍪" }, { name: "cool", char: "😎" },
        { name: "crab", char: "🦀" }, { name: "cry", char: "😢" },
        { name: "dance", char: "🕺" }, { name: "dog", char: "🐶" },
        { name: "donut", char: "🍩" }, { name: "dragon", char: "🐉" },
        { name: "drop", char: "💧" }, { name: "duck", char: "🦆" },
        { name: "earth", char: "🌍" }, { name: "egg", char: "🥚" },
        { name: "eyes", char: "👀" }, { name: "fire", char: "🔥" },
        { name: "fish", char: "🐟" }, { name: "flag", char: "🚩" },
        { name: "flower", char: "🌸" }, { name: "football", char: "🏈" },
        { name: "fork", char: "🍴" }, { name: "fox", char: "🦊" },
        { name: "frog", char: "🐸" }, { name: "gear", char: "⚙️" },
        { name: "ghost", char: "👻" }, { name: "gift", char: "🎁" },
        { name: "goat", char: "🐐" }, { name: "grape", char: "🍇" },
        { name: "green_apple", char: "🍏" }, { name: "guitar", char: "🎸" },
        { name: "hamburger", char: "🍔" }, { name: "hammer", char: "🔨" },
        { name: "heart", char: "❤️" }, { name: "heart_eyes", char: "😍" },
        { name: "high_voltage", char: "⚡" }, { name: "horse", char: "🐴" },
        { name: "hug", char: "🤗" }, { name: "idea", char: "💡" },
        { name: "jack_o_lantern", char: "🎃" }, { name: "joy", char: "😂" },
        { name: "kiss", char: "😘" }, { name: "lab", char: "🧪" },
        { name: "laptop", char: "💻" }, { name: "leaf", char: "🍃" },
        { name: "lemon", char: "🍋" }, { name: "lion", char: "🦁" },
        { name: "magic_wand", char: "🪄" }, { name: "streak", char: "🔥" },
        { name: "map", char: "🗺️" }, { name: "megaphone", char: "📣" },
        { name: "microphone", char: "🎤" }, { name: "microscope", char: "🔬" },
        { name: "milk", char: "🥛" }, { name: "money", char: "💰" },
        { name: "monkey", char: "🐒" }, { name: "moon", char: "🌙" },
        { name: "motorcycle", char: "🏍️" }, { name: "muscle", char: "💪" },
        { name: "music", char: "🎵" }, { name: "nerd", char: "🤓" },
        { name: "new_moon", char: "🌚" }, { name: "newspaper", char: "📰" },
        { name: "nose", char: "👃" }, { name: "notebook", char: "📓" },
        { name: "ocean", char: "🌊" }, { name: "octopus", char: "🐙" },
        { name: "ok_hand", char: "👌" }, { name: "orange", char: "🍊" },
        { name: "orange_heart", char: "🧡" }, { name: "panda", char: "🐼" },
        { name: "parrot", char: "🦜" }, { name: "party", char: "🎉" },
        { name: "partying", char: "🤩" }, { name: "peace", char: "✌️" },
        { name: "pencil", char: "✏️" }, { name: "penguin", char: "🐧" },
        { name: "phone", char: "📱" }, { name: "pie", char: "🥧" },
        { name: "pig", char: "🐷" }, { name: "pineapple", char: "🍍" },
        { name: "pizza", char: "🍕" }, { name: "planet", char: "🪐" },
        { name: "point_down", char: "👇" }, { name: "point_left", char: "👈" },
        { name: "point_right", char: "👉" }, { name: "point_up", char: "☝️" },
        { name: "police", char: "🚓" }, { name: "poop", char: "💩" },
        { name: "popcorn", char: "🍿" }, { name: "pray", char: "🙏" },
        { name: "pushpin", char: "📌" }, { name: "puzzle", char: "🧩" },
        { name: "question", char: "❓" }, { name: "rabbit", char: "🐰" },
        { name: "rainbow", char: "🌈" }, { name: "raised_hand", char: "✋" },
        { name: "raised_hands", char: "🙌" }, { name: "recycle", char: "♻️" },
        { name: "rocket", char: "🚀" }, { name: "roll_eyes", char: "🙄" },
        { name: "rose", char: "🌹" }, { name: "ruler", char: "📏" },
        { name: "run", char: "🏃" }, { name: "santa", char: "🎅" },
        { name: "scissors", char: "✂️" }, { name: "scream", char: "😱" },
        { name: "ship", char: "🚢" }, { name: "siren", char: "🚨" },
        { name: "skateboard", char: "🛹" }, { name: "skull", char: "💀" },
        { name: "sleeping", char: "😴" }, { name: "smile", char: "😁" },
        { name: "smiley", char: "😀" }, { name: "snail", char: "🐌" },
        { name: "snake", char: "🐍" }, { name: "snow", char: "❄️" },
        { name: "snowflake", char: "❄️" }, { name: "sob", char: "😭" },
        { name: "soccer", char: "⚽" }, { name: "sparkles", char: "✨" },
        { name: "spider", char: "🕷️" }, { name: "star", char: "⭐" },
        { name: "sun", char: "☀️" }, { name: "sunglasses", char: "😎" },
        { name: "sweat", char: "😅" }, { name: "sword", char: "🗡️" },
        { name: "syringe", char: "💉" }, { name: "taco", char: "🌮" },
        { name: "tea", char: "🍵" }, { name: "tennis", char: "🎾" },
        { name: "thinking", char: "🤔" }, { name: "thumbsdown", char: "👎" },
        { name: "thumbsup", char: "👍" }, { name: "tiger", char: "🐯" },
        { name: "tired", char: "😫" }, { name: "tomato", char: "🍅" },
        { name: "train", char: "🚆" }, { name: "truck", char: "🚚" },
        { name: "trophy", char: "🏆" }, { name: "turtle", char: "🐢" },
        { name: "umbrella", char: "☔" }, { name: "unicorn", char: "🦄" },
        { name: "video_game", char: "🎮" }, { name: "volcano", char: "🌋" },
        { name: "volleyball", char: "🏐" }, { name: "wave", char: "👋" },
        { name: "watermelon", char: "🍉" }, { name: "whale", char: "🐳" },
        { name: "wink", char: "😉" }, { name: "wolf", char: "🐺" },
        { name: "zany", char: "🤪" }, { name: "zap", char: "⚡" },
        { name: "zzz", char: "💤" }
    ];

    /* Curated GIFs shown when the Giphy search is unreachable. Broken
       tiles quietly remove themselves, and a paste-a-link field is
       always available as a fallback. */
    const GIF_FALLBACKS = [
        { label: "Thumbs up", url: "https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif" },
        { label: "Surprised", url: "https://media.giphy.com/media/3o7aCSPqXE5C6T8tBC/giphy.gif" },
        { label: "Mind blown", url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif" },
        { label: "Clapping", url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif" },
        { label: "Yes!", url: "https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif" },
        { label: "Cool", url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" },
        { label: "Cheers", url: "https://media.giphy.com/media/g9582DNuQppxC/giphy.gif" },
        { label: "Good job", url: "https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif" }
    ];

    const GIF_API_KEY = "dc6zaTOxFJmzC";
    const MAX_FILE_BYTES = 50 * 1024 * 1024;

    function kind(post) {
        const role = post.author_role || (/teacher/i.test(post.tag || "") ? "teacher" : "student");
        return role === "teacher" ? "formal" : "informal";
    }

    function mediaType(file) {
        if (!file) return null;
        if (file.type === "image/gif") return "gif";
        if (file.type.startsWith("image/")) return "image";
        if (file.type.startsWith("video/")) return "video";
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) return "pdf";
        return "other";
    }

    function formatBytes(bytes) {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function attachmentHtml(post, esc) {
        const url = post.attachment_url;
        if (!url) return "";
        const type = post.attachment_type || "other";
        const name = post.attachment_name || (type === "pdf" ? "Document.pdf" : "Attachment");
        if (type === "image" || type === "gif") {
            return `<a class="post-media" href="${esc(url)}" target="_blank" rel="noopener" title="Open in new tab"><img class="post-media-image" src="${esc(url)}" alt="${esc(name)}" loading="lazy"></a>`;
        }
        if (type === "video") {
            return `<div class="post-media"><video class="post-media-video" src="${esc(url)}" controls preload="metadata"></video></div>`;
        }
        const icon = type === "pdf" ? "📄" : "📎";
        return `<a class="post-file" href="${esc(url)}" target="_blank" rel="noopener"><span class="post-file-icon">${icon}</span><span class="post-file-name">${esc(name)}</span><span class="post-file-open">Open</span></a>`;
    }

    async function uploadFile(supabaseClient, file, userId) {
        const clean = String(file.name || "attachment").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(-60) || "attachment";
        const ext = (String(file.name || "").split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabaseClient.storage.from("announcement-files").upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false
        });
        if (error) return { error };
        const { data } = supabaseClient.storage.from("announcement-files").getPublicUrl(path);
        return { url: data.publicUrl, path };
    }

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
        const position = start + text.length;
        textarea.selectionStart = textarea.selectionEnd = position;
        textarea.focus();
    }

    function emojiGridHtml() {
        return EMOJIS.map(emoji => `<button type="button" class="emoji-option" data-emoji="${emoji}">${emoji}</button>`).join("");
    }

    function gifGridHtml(gifs) {
        return gifs.map(gif => `
            <button type="button" class="gif-option" data-gif-url="${gif.url}" data-gif-label="${gif.label || "GIF"}">
                <img src="${gif.url}" alt="${gif.label || "GIF"}" loading="lazy">
            </button>`).join("");
    }

    async function fetchGifs(query) {
        const endpoint = query
            ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query)}&api_key=${GIF_API_KEY}&limit=18&rating=pg-13`
            : `https://api.giphy.com/v1/gifs/trending?api_key=${GIF_API_KEY}&limit=18&rating=pg-13`;
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error("GIF service unavailable");
            const json = await response.json();
            const gifs = (json.data || [])
                .map(item => ({
                    url: item.images?.fixed_height?.url || item.images?.original?.url,
                    label: item.title || "GIF"
                }))
                .filter(gif => gif.url);
            if (!gifs.length) throw new Error("No GIFs found");
            return gifs;
        } catch (error) {
            console.warn("GIF search fell back to curated set:", error);
            return GIF_FALLBACKS.slice();
        }
    }

    function initComposer(form, options) {
        if (!form || form.__socialComposerReady) return;
        form.__socialComposerReady = true;
        const opts = options || {};
        const notice = opts.onNotice || (() => {});
        const textarea = form.querySelector("textarea");
        const state = { file: null, gifUrl: null, gifLabel: null };
        form.__socialComposer = state;

        const emojiToggle = form.querySelector("[data-emoji-toggle]");
        const gifToggle = form.querySelector("[data-gif-toggle]");
        const fileTrigger = form.querySelector("[data-file-trigger]");
        const fileInput = form.querySelector("[data-file-input]");
        const emojiPanel = form.querySelector("[data-emoji-panel]");
        const emojiGrid = form.querySelector("[data-emoji-grid]");
        const gifPanel = form.querySelector("[data-gif-panel]");
        const gifSearch = form.querySelector("[data-gif-search]");
        const gifUrl = form.querySelector("[data-gif-url]");
        const gifGrid = form.querySelector("[data-gif-grid]");
        const preview = form.querySelector("[data-attachment-preview]");

        const closeSidePanels = (exceptToggle) => {
            if (!exceptToggle || exceptToggle === emojiToggle) { if (emojiPanel) emojiPanel.hidden = true; if (emojiToggle) emojiToggle.classList.remove("active"); }
            if (!exceptToggle || exceptToggle === gifToggle) { if (gifPanel) gifPanel.hidden = true; if (gifToggle) gifToggle.classList.remove("active"); }
        };

        const makeDraggable = (panel, offsetKey) => {
            const handle = panel.querySelector(".popup-drag");
            if (!handle) return;
            let lastX = 0;
            let lastY = 0;
            handle.addEventListener("pointerdown", event => {
                if (event.button !== 0) return;
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
                const base = (panel.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/) || []);
                const baseX = parseFloat(base[1] || 0);
                const baseY = parseFloat(base[2] || 0);
                const startX = event.clientX;
                const startY = event.clientY;
                handle.classList.add("dragging");
                const onMove = moveEvent => {
                    lastX = baseX + moveEvent.clientX - startX;
                    lastY = baseY + moveEvent.clientY - startY;
                    panel.style.transform = `translate(${lastX}px, ${lastY}px)`;
                };
                const onUp = () => {
                    if (offsetKey && state) state[offsetKey] = { x: lastX, y: lastY };
                    handle.classList.remove("dragging");
                    handle.removeEventListener("pointermove", onMove);
                    handle.removeEventListener("pointerup", onUp);
                };
                handle.addEventListener("pointermove", onMove);
                handle.addEventListener("pointerup", onUp);
            });
        };
        if (emojiPanel) makeDraggable(emojiPanel, "emojiOffset");
        if (gifPanel) makeDraggable(gifPanel, "gifOffset");

        const positionPanel = (panel, toggle, offsetKey) => {
            const rect = toggle.getBoundingClientRect();
            const panelWidth = panel.offsetWidth || 300;
            const panelHeight = panel.offsetHeight || 200;
            let top = rect.top - panelHeight - 10;
            if (top < 8) top = rect.bottom + 10;
            let left = rect.left;
            if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
            if (left < 8) left = 8;
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            const saved = (state && state[offsetKey]) || null;
            panel.style.transform = saved ? `translate(${saved.x}px, ${saved.y}px)` : "translate(0px, 0px)";
        };

        const relocateToBody = element => {
            if (element && element.parentNode && element.parentNode !== document.body) document.body.appendChild(element);
        };
        relocateToBody(emojiPanel);
        relocateToBody(gifPanel);

        const renderPreview = () => {
            if (!preview) return;
            if (state.gifUrl) {
                preview.innerHTML = `<span class="attach-chip"><span class="attach-icon">🌀</span><span class="attach-name">${escapeAttribute(state.gifLabel || "GIF")}</span><button type="button" class="attach-remove" data-attach-remove aria-label="Remove GIF">×</button></span>`;
            } else if (state.file) {
                const icon = { image: "🖼", gif: "🌀", video: "🎬", pdf: "📄", other: "📎" }[mediaType(state.file)] || "📎";
                preview.innerHTML = `<span class="attach-chip"><span class="attach-icon">${icon}</span><span class="attach-name">${escapeAttribute(state.file.name)}</span><span class="attach-size">${formatBytes(state.file.size)}</span><button type="button" class="attach-remove" data-attach-remove aria-label="Remove attachment">×</button></span>`;
            } else {
                preview.innerHTML = "";
            }
            preview.hidden = !(state.gifUrl || state.file);
        };

        if (preview) {
            preview.addEventListener("click", event => {
                if (!event.target.closest("[data-attach-remove]")) return;
                state.file = null;
                state.gifUrl = null;
                state.gifLabel = null;
                if (fileInput) fileInput.value = "";
                renderPreview();
            });
        }

        if (emojiToggle && emojiPanel) {
            if (emojiGrid) emojiGrid.innerHTML = emojiGridHtml();
            emojiToggle.addEventListener("click", () => {
                const opening = emojiPanel.hidden;
                closeSidePanels(opening ? emojiToggle : null);
                closeAuto();
                emojiPanel.hidden = !opening;
                emojiToggle.classList.toggle("active", opening);
                if (emojiToggle) emojiToggle.setAttribute("aria-expanded", String(opening));
                if (opening && emojiToggle) positionPanel(emojiPanel, emojiToggle, "emojiOffset");
            });
            emojiPanel.addEventListener("click", event => {
                const option = event.target.closest("[data-emoji]");
                if (!option || !textarea) return;
                insertAtCursor(textarea, option.dataset.emoji);
            });
        }

        if (gifToggle && gifPanel && gifGrid) {
            const fillGrid = gifs => {
                gifGrid.innerHTML = gifGridHtml(gifs);
                gifGrid.querySelectorAll(".gif-option img").forEach(img => {
                    img.addEventListener("error", () => img.closest(".gif-option")?.remove(), { once: true });
                });
                if (!gifGrid.children.length && !gifUrl?.value.trim()) {
                    gifGrid.innerHTML = `<p class="gif-empty">No GIFs came back — paste a link above instead.</p>`;
                }
            };

            gifToggle.addEventListener("click", async () => {
                const opening = gifPanel.hidden;
                closeSidePanels(opening ? gifToggle : null);
                closeAuto();
                gifPanel.hidden = !opening;
                gifToggle.classList.toggle("active", opening);
                if (gifToggle) gifToggle.setAttribute("aria-expanded", String(opening));
                if (opening && gifToggle) positionPanel(gifPanel, gifToggle, "gifOffset");
                if (opening && !state.__gifLoaded) {
                    state.__gifLoaded = true;
                    fillGrid(await fetchGifs(""));
                }
            });

            let searchTimer = null;
            if (gifSearch) {
                gifSearch.addEventListener("input", () => {
                    clearTimeout(searchTimer);
                    const query = gifSearch.value.trim();
                    if (!query) fillGrid(GIF_FALLBACKS.slice());
                    else searchTimer = setTimeout(async () => fillGrid(await fetchGifs(query)), 350);
                });
            }

            const chooseGif = (url, label) => {
                state.gifUrl = url;
                state.gifLabel = label || "GIF";
                state.file = null;
                if (fileInput) fileInput.value = "";
                if (gifPanel) gifPanel.hidden = true;
                if (gifToggle) gifToggle.classList.remove("active");
                renderPreview();
            };

            if (gifUrl) {
                gifUrl.addEventListener("keydown", event => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const url = gifUrl.value.trim();
                    if (!/^https?:\/\//i.test(url)) { notice("Paste a valid http(s) GIF link"); return; }
                    chooseGif(url, "GIF");
                    gifUrl.value = "";
                });
            }

            gifGrid.addEventListener("click", event => {
                const option = event.target.closest("[data-gif-url]");
                if (!option) return;
                chooseGif(option.dataset.gifUrl, option.dataset.gifLabel);
            });
        }

        const suggest = query => {
            const typed = query.toLowerCase();
            const starts = EMOJI_CODES.filter(item => item.name.startsWith(typed));
            const inside = EMOJI_CODES.filter(item => !item.name.startsWith(typed) && item.name.includes(typed));
            return starts.concat(inside).slice(0, 9);
        };

        const emojiAuto = document.createElement("div");
        emojiAuto.className = "emoji-suggest";
        emojiAuto.hidden = true;
        (document.body || document.documentElement).appendChild(emojiAuto);
        let autoItems = [];
        let autoIndex = 0;
        let closeAuto = () => {
            emojiAuto.hidden = true;
            emojiAuto.innerHTML = "";
            autoItems = [];
        };
        const autoToken = node => {
            const before = node.value.slice(0, node.selectionStart ?? node.value.length);
            const match = before.match(/(^|[\s])(:[\w+\-]*)$/);
            return match ? { token: match[2], start: node.selectionStart - match[2].length } : null;
        };
        const showAuto = () => {
            if (!textarea) { closeAuto(); return; }
            const token = autoToken(textarea);
            if (!token || token.token.length < 2) { closeAuto(); return; }
            closeSidePanels(null);
            const items = suggest(token.token.slice(1));
            if (!items.length) { closeAuto(); return; }
            autoItems = items;
            autoIndex = 0;
            emojiAuto.innerHTML = items.map((item, index) => `
                <button type="button" class="emoji-suggest-item ${index === 0 ? "selected" : ""}" data-index="${index}">
                    <span class="emoji-suggest-char">${item.char}</span>
                    <span class="emoji-suggest-name">:${escapeAttribute(item.name)}:</span>
                </button>`).join("");
            emojiAuto.hidden = false;
            const textareaRect = textarea.getBoundingClientRect();
            const padLeft = parseFloat(window.getComputedStyle(textarea).paddingLeft) || 0;
            let left = textareaRect.left + padLeft + measureTextWidth(textarea.value.slice(0, textarea.selectionStart), textarea);
            left = Math.max(4, Math.min(left, window.innerWidth - emojiAuto.offsetWidth - 6));
            emojiAuto.style.left = `${left}px`;
            emojiAuto.style.top = `${textareaRect.bottom + 6}px`;
        };
        const selectAuto = () => {
            const item = autoItems[autoIndex];
            const token = item && textarea ? autoToken(textarea) : null;
            if (!item || !token) { closeAuto(); return; }
            const before = textarea.value.slice(0, token.start);
            const after = textarea.value.slice(textarea.selectionStart);
            const next = before + item.char + " " + after;
            textarea.value = next;
            textarea.selectionStart = textarea.selectionEnd = before.length + item.char.length + 1;
            closeAuto();
            textarea.focus();
        };
        const moveAuto = step => {
            if (!autoItems.length) return;
            autoIndex = (autoIndex + step + autoItems.length) % autoItems.length;
            emojiAuto.querySelectorAll(".emoji-suggest-item").forEach((element, index) => element.classList.toggle("selected", index === autoIndex));
            const selected = emojiAuto.querySelector(".selected");
            if (selected) selected.scrollIntoView({ block: "nearest" });
        };
        if (textarea) {
            textarea.addEventListener("input", showAuto);
            textarea.addEventListener("keydown", event => {
                if (emojiAuto.hidden) return;
                if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    selectAuto();
                } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveAuto(1);
                } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveAuto(-1);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeAuto();
                }
            });
            textarea.addEventListener("blur", () => {
                setTimeout(() => {
                    if (!emojiAuto.contains(document.activeElement)) closeAuto();
                }, 120);
            });
        }
        emojiAuto.addEventListener("mousedown", event => event.preventDefault());
        emojiAuto.addEventListener("click", event => {
            const item = event.target.closest(".emoji-suggest-item");
            if (!item) return;
            autoIndex = parseInt(item.dataset.index, 10);
            selectAuto();
        });

        if (fileTrigger && fileInput) {
            fileTrigger.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", () => {
                const file = fileInput.files && fileInput.files[0];
                if (!file) return;
                if (file.size > MAX_FILE_BYTES) {
                    notice(`"${file.name}" is too large — keep files under 50 MB`);
                    fileInput.value = "";
                    return;
                }
                state.file = file;
                state.gifUrl = null;
                state.gifLabel = null;
                renderPreview();
            });
        }

        const closePopups = () => { closeSidePanels(null); closeAuto(); };
        document.addEventListener("pointerdown", event => {
            const insidePanel = (emojiPanel && emojiPanel.contains(event.target)) || (gifPanel && gifPanel.contains(event.target)) || (emojiAuto && emojiAuto.contains(event.target));
            if (insidePanel || form.contains(event.target)) return;
            closePopups();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") closePopups();
        });
    }

    function measureTextWidth(text, textarea) {
        const mirror = document.createElement("span");
        mirror.textContent = text.replace(/\s/g, "\u00a0");
        mirror.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre;pointer-events:none;";
        mirror.style.font = window.getComputedStyle(textarea).font;
        document.body.appendChild(mirror);
        const width = mirror.getBoundingClientRect().width;
        mirror.remove();
        return width;
    }

    function compose(form) {
        if (!form || !form.__socialComposer) return null;
        const state = form.__socialComposer;
        if (state.file) return { file: state.file, type: mediaType(state.file), name: state.file.name };
        if (state.gifUrl) return { url: state.gifUrl, type: "gif", name: state.gifLabel || "GIF" };
        return null;
    }

    function resetComposer(form) {
        if (!form || !form.__socialComposer) return;
        const state = form.__socialComposer;
        state.file = null;
        state.gifUrl = null;
        state.gifLabel = null;
        const fileInput = form.querySelector("[data-file-input]");
        if (fileInput) fileInput.value = "";
        const preview = form.querySelector("[data-attachment-preview]");
        if (preview) { preview.innerHTML = ""; preview.hidden = true; }
        const emojiPanel = form.querySelector("[data-emoji-panel]");
        if (emojiPanel) emojiPanel.hidden = true;
        const gifPanel = form.querySelector("[data-gif-panel]");
        if (gifPanel) gifPanel.hidden = true;
        const emojiToggle = form.querySelector("[data-emoji-toggle]");
        if (emojiToggle) emojiToggle.classList.remove("active");
        const gifToggle = form.querySelector("[data-gif-toggle]");
        if (gifToggle) gifToggle.classList.remove("active");
    }

    function escapeAttribute(value) {
        return String(value ?? "").replace(/[&<>'"]/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
        }[character]));
    }

    window.Social = {
        KIND_FORMAL: "formal",
        KIND_INFORMAL: "informal",
        kind,
        mediaType,
        attachmentHtml,
        uploadFile,
        insertAtCursor,
        fetchGifs,
        initComposer,
        compose,
        resetComposer,
        escapeAttribute
    };
})();