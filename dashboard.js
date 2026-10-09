const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";

/* A blocked or offline CDN must not leave the page dead */
let supabaseClient = null;
try {
    if (window.supabase && typeof window.supabase.createClient === "function") {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (error) {
    console.error("Supabase client failed to start", error);
}

let currentUser = null;

let projectById = {};
let studentArchivedProjects = [];
let allShares = [];
let sharedToMe = [];
let allClassmates = [];
let shareTargetId = null;
let shareActiveCount = 0;
let shareDailyCount = 0;
let sharePick = {};
let shareClosed = [];

/* ============================================================
   AI PARTS MATCHER (Supabase Edge Function Integration)
============================================================ */
async function callPartsMatcher(query) {
    const token = (await supabaseClient.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("You must be signed in to use AI part search.");
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/parts-matcher`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        if (response.ok) {
            const payload = await response.json();
            const message = payload.message;
            if (!message) throw new Error("Empty AI response");
            return message;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === attempts - 1) {
            if (response.status === 429) throw new Error("AI search is busy right now. Please try again in a moment.");
            throw new Error(`AI part search failed (${response.status}). Please try again.`);
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1400 * (attempt + 1);
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    throw new Error("AI service is unavailable right now. Please try again.");
}

function parseAiJsonResponse(text) {
    let clean = (text || "").trim();
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        clean = clean.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(clean);
}

let simClock = { simulated_at: null, label: null };
function clockNow() { return simClock.simulated_at ? new Date(simClock.simulated_at) : new Date(); }
async function refreshSimClock(){
    try{
        const { data, error } = await supabaseClient.rpc("read_sim_clock");
        if(error) throw error;
        const clock = Array.isArray(data) ? data[0] : data;
        simClock = { simulated_at: clock && clock.simulated_at ? clock.simulated_at : null, label: clock && clock.label ? clock.label : null };
    }catch(e){ simClock={simulated_at:null,label:null}; }
}
function renderDashboardDate() {
    const today = clockNow();
    document.getElementById("todayLabel").textContent = `${today.toLocaleDateString(undefined, { weekday: "long" })} · Lab activity`;
    document.getElementById("currentDate").textContent = today.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}


let inventoryParts = [];
let partCart = {};
let partCategoryOptions = [];
let borrowLogs = [];
let receiptTimer = null;
let activeReceiptId = null;
let refreshing = false;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function initialsFor(name) {
    return String(name || "").split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "ST";
}

function formatTime(value) {
    if (!value) return "—";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function showToast(message) {
    const toast = document.getElementById("dashboardToast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function partItemCount(loan) {
    const items = Array.isArray(loan.items) ? loan.items : [];
    return items.reduce((total, item) => total + (Number(item.quantity) || 0), 0) || items.length;
}


/* ========================================================================
   MODALS
   One open/close path: scroll lock, focus return, Escape to dismiss.
   ======================================================================== */

const MODAL_CLOSERS = {
    proposeModal: closeProposeModal,
    receiptModal: closeReceipt,
    projectHistoryBackdrop: closeProjectHistoryModal,
    inviteModal: () => closeModal("inviteModal"),
    aiPartSearchModal: closeAiPartModal
};

let lastFocused = null;

function openModal(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;
    lastFocused = document.activeElement;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const firstField = backdrop.querySelector("input, textarea, select, button:not(.modal-close)");
    if (firstField) setTimeout(() => firstField.focus({ preventScroll: true }), 90);
}

function closeModal(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal-backdrop.open")) document.body.style.overflow = "";
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus({ preventScroll: true });
    lastFocused = null;
}

function closeTopModal() {
    const open = [...document.querySelectorAll(".modal-backdrop.open")].pop();
    if (!open) return true;
    const closer = MODAL_CLOSERS[open.id];
    if (closer) closer();
    else closeModal(open.id);
    return false;
}

const profileButton = document.getElementById("profileButton");
const profilePopover = document.getElementById("profilePopover");

function setProfilePopoverOpen(isOpen) {
    if (!profileButton || !profilePopover) return;
    profileButton.setAttribute("aria-expanded", String(isOpen));
    profilePopover.hidden = !isOpen;
}

function renderProfileDetails(user, profile) {
    const createdAt = user.created_at
        ? new Date(user.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
        : "Not available";
    const values = {
        profileDetailName: user.user_metadata?.full_name || currentUser.name,
        profileDetailEmail: user.email,
        profileDetailPhone: user.user_metadata?.phone || user.phone,
        profileDetailStudentId: profile?.student_id,
        profileDetailClass: profile?.class_name,
        profileDetailSection: profile?.section,
        profileDetailEmailStatus: user.email_confirmed_at ? "Verified" : "Awaiting verification",
        profileDetailCreated: createdAt
    };

    Object.entries(values).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.textContent = value || "Not provided";
    });
}

profileButton?.addEventListener("click", () => {
    setProfilePopoverOpen(profilePopover.hidden);
});
document.getElementById("profileClose")?.addEventListener("click", () => {
    setProfilePopoverOpen(false);
    profileButton?.focus();
});
document.addEventListener("click", event => {
    if (!event.target.closest?.(".profile-menu")) setProfilePopoverOpen(false);
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (profilePopover && !profilePopover.hidden) {
        setProfilePopoverOpen(false);
        profileButton?.focus();
        return;
    }
    closeTopModal();
});


async function loadOverviewMetrics() {
    if (!currentUser) return;
    const [loansResult, interestsResult] = await Promise.all([
        supabaseClient.from("part_proposals").select("id, due_at, lent_at, returned_at, items").eq("student_id", currentUser.id),
        supabaseClient.from("project_interests").select("project_id").eq("student_id", currentUser.id)
    ]);
    const active = (loansResult.data || []).filter(loan => loan.lent_at && !loan.returned_at);
    const overdue = active.filter(loan => loan.due_at && new Date(loan.due_at).getTime() < clockNow().getTime());
    document.getElementById("partsOnLoanTotal").textContent = active.reduce((total, loan) => total + partItemCount(loan), 0);
    document.getElementById("partsOverdueTotal").textContent = overdue.reduce((total, loan) => total + partItemCount(loan), 0);
    document.getElementById("projectsTakenTotal").textContent = (interestsResult.data || []).length;
}

function showFeedMessage(message, error = false) {
    const icon = error ? "" : '<i class="dashboard-empty-icon" data-lucide="inbox" aria-hidden="true"></i>';
    document.getElementById("postList").innerHTML = `<div class="empty-state dashboard-empty-state ${error ? "empty-state-error" : ""}">${icon}<strong>${escapeHtml(error ? "The den is taking a breather." : "No announcements yet")}</strong><p>${escapeHtml(message)}</p></div>`;
    if (window.lucide) lucide.createIcons();
}

const openCommentPostIds = new Set();

function renderPosts(posts) {
    if (!posts.length) {
        showFeedMessage("Teacher announcements will appear here as soon as one is shared.");
        return;
    }
    document.getElementById("postList").innerHTML = posts.map(post => {
        const formal = Social.kind(post) === "formal";
        return `
        <article class="post-card ${formal ? "teacher-important" : "informal"}" data-post-id="${escapeHtml(post.id)}">
            <div class="post-meta">
                <div class="post-author-avatar" style="background:${escapeHtml(post.author_color || "#c8f36d")}">${escapeHtml(post.author_initials)}</div>
                <div class="post-author"><strong>${escapeHtml(post.author_name)}</strong><small>${escapeHtml(formatTime(post.created_at))}</small>${formal ? `<span class="post-tag">Notice</span>` : ""}</div>
            </div>
            ${post.body ? `<p>${escapeHtml(post.body)}</p>` : ""}
            ${Social.attachmentHtml(post, escapeHtml)}
            <div class="post-actions">
                <button class="post-action ${post.liked ? "liked" : ""}" data-action="like" type="button">♡ Like ${post.like_count || ""}</button>
                <button class="post-action" data-action="comment" type="button">◌ Comment ${post.comments.length || ""}</button>
                <button class="post-action" data-action="share" type="button">↗ Share</button>
            </div>
            <div class="comments ${openCommentPostIds.has(post.id) ? "open" : ""}" data-comments>
                <div class="comment-list">${post.comments.map(comment => `
                    <div class="comment" data-comment-id="${escapeHtml(comment.id)}">
                        <strong>${escapeHtml(comment.author_name)}:</strong>
                        <span class="comment-text">${escapeHtml(comment.body)}</span>
                        ${comment.author_id === currentUser.id ? `<span class="comment-actions">
                            <button class="comment-action" data-comment-action="edit" type="button" aria-label="Edit your comment">✎</button>
                            <button class="comment-action danger" data-comment-action="delete" type="button" aria-label="Delete your comment">🗑</button>
                        </span>` : ""}
                    </div>`).join("")}</div>
                <form class="comment-form"><input aria-label="Write a comment" maxlength="300" placeholder="Add a thoughtful reply..."><button type="submit">Send</button></form>
            </div>
        </article>`;
    }).join("");
}

async function loadAnnouncements() {
    if (!currentUser) return;
    const { data: announcements, error: announcementsError } = await supabaseClient
        .from("announcements")
        .select("id, author_id, author_name, author_initials, author_color, body, tag, author_role, attachment_url, attachment_type, attachment_name, created_at")
        .order("created_at", { ascending: false });

    if (announcementsError) {
        showFeedMessage("Announcements need the Supabase setup script before they can load.", true);
        console.error("Announcement load error:", announcementsError);
        return;
    }

    if (!announcements.length) {
        renderPosts([]);
        return;
    }

    const ids = announcements.map(announcement => announcement.id);
    const [{ data: likes, error: likesError }, { data: comments, error: commentsError }] = await Promise.all([
        supabaseClient.from("announcement_likes").select("announcement_id, user_id").in("announcement_id", ids),
        supabaseClient.from("announcement_comments").select("id, announcement_id, author_id, author_name, body, created_at").in("announcement_id", ids).order("created_at", { ascending: true })
    ]);

    if (likesError || commentsError) {
        showFeedMessage("We could not load the conversation around these announcements.", true);
        console.error("Announcement interaction load error:", likesError || commentsError);
        return;
    }

    const posts = announcements.map(announcement => {
        const postLikes = likes.filter(like => like.announcement_id === announcement.id);
        return {
            ...announcement,
            like_count: postLikes.length,
            liked: postLikes.some(like => like.user_id === currentUser.id),
            comments: comments.filter(comment => comment.announcement_id === announcement.id)
        };
    });
    renderPosts(posts);
}

/* ============================================================
   AI PART MATCHER STATE & LOGIC
============================================================ */

window.aiPartMatches = null;
let aiLastSearchResults = null;
let aiLastQuery = "";
let aiSearchInProgress = false;

function openAiPartModal() {
    openModal("aiPartSearchModal");
    const descField = document.getElementById("aiPartDescription");
    if (descField) {
        setTimeout(() => descField.focus(), 120);
    }
}

function closeAiPartModal() {
    closeModal("aiPartSearchModal");
}

function renderAiIdleState() {
    const wrapper = document.getElementById("aiResultsWrapper");
    if (!wrapper) return;
    wrapper.innerHTML = `
        <div class="ai-idle-state" id="aiIdleState">
            <div class="ai-idle-icon-wrap">
                <i data-lucide="cpu" aria-hidden="true"></i>
            </div>
            <strong>Ready to find parts</strong>
            <p>Describe what you need or click one of the suggestions above.</p>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
}

function renderAiLoadingState() {
    const wrapper = document.getElementById("aiResultsWrapper");
    if (!wrapper) return;
    wrapper.innerHTML = `
        <div class="ai-loading-state">
            <div class="ai-scanner-orb">
                <i data-lucide="sparkles"></i>
            </div>
            <strong>Analyzing lab parts inventory...</strong>
            <p>Matching your description against component functions, specs, pinouts, and physical characteristics.</p>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
}

function renderAiErrorState(errorMessage) {
    const wrapper = document.getElementById("aiResultsWrapper");
    if (!wrapper) return;
    wrapper.innerHTML = `
        <div class="ai-error-state">
            <i data-lucide="alert-triangle" class="ai-error-icon"></i>
            <strong>AI Search Encountered an Issue</strong>
            <p>${escapeHtml(errorMessage)}</p>
            <button type="button" class="ai-retry-btn" id="aiRetryBtn">Try Again</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    const retryBtn = document.getElementById("aiRetryBtn");
    if (retryBtn) {
        retryBtn.addEventListener("click", () => {
            const desc = document.getElementById("aiPartDescription")?.value || "";
            if (desc.trim()) executeAiPartSearch(desc.trim());
        });
    }
}

function renderAiMatches(matches, summary, query) {
    const wrapper = document.getElementById("aiResultsWrapper");
    if (!wrapper) return;

    if (!matches || matches.length === 0) {
        wrapper.innerHTML = `
            <div class="ai-empty-state">
                <i data-lucide="search-x" class="ai-empty-icon"></i>
                <strong>No matching parts found</strong>
                <p>We couldn't find a part in the lab catalog matching "${escapeHtml(query)}". Try describing the function or appearance with different keywords.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    const cardsHtml = matches.map(match => {
        const part = match.part;
        const isInCart = Boolean(partCart[part.id]);
        const confidenceLabel = match.confidence === "high" ? "Top Match" : match.confidence === "medium" ? "Good Match" : "Possible Match";
        const confidenceClass = `ai-badge-${match.confidence || "medium"}`;

        return `
            <div class="ai-match-card ${match.confidence === 'high' ? 'ai-high-match' : ''}" data-part-id="${escapeHtml(part.id)}">
                <div class="ai-card-main">
                    <div class="ai-card-top">
                        <span class="ai-match-badge ${confidenceClass}">${confidenceLabel}</span>
                        <span class="ai-part-cat">${escapeHtml(part.category || "General")}</span>
                    </div>
                    <h3 class="ai-part-name">${escapeHtml(part.name)}</h3>
                    <p class="ai-part-reason">${escapeHtml(match.reason || "Matches requested requirements.")}</p>
                    ${match.matched_features && match.matched_features.length ? `
                        <div class="ai-part-features">
                            ${match.matched_features.map(f => `<span class="ai-feat-pill">${escapeHtml(f)}</span>`).join("")}
                        </div>
                    ` : ""}
                    <div class="ai-part-meta-row">
                        <span class="ai-part-loc"><i data-lucide="map-pin"></i> ${escapeHtml(part.location || "Lab storage")}</span>
                        <span class="ai-part-stock ${part.quantity > 0 ? "" : "out-of-stock"}">
                            ${part.quantity > 0 ? `${part.quantity} in stock` : "Out of stock"}
                        </span>
                    </div>
                </div>
                <div class="ai-card-actions">
                    <button class="add-button ${isInCart ? "added" : ""}" data-cart-action="toggle" type="button">
                        ${isInCart ? "In cart ✓" : "Add to cart"}
                    </button>
                </div>
            </div>
        `;
    }).join("");

    wrapper.innerHTML = `
        <div class="ai-results-header">
            <div class="ai-results-count">
                <i data-lucide="check-circle-2" class="ai-check-icon"></i>
                <span>Found <strong>${matches.length}</strong> matching part${matches.length > 1 ? "s" : ""}</span>
            </div>
            <button type="button" class="ai-apply-filter-btn" id="aiApplyFilterBtn">
                <i data-lucide="filter"></i>
                <span>Filter Main Catalog</span>
            </button>
        </div>
        ${summary ? `<div class="ai-analysis-summary"><i data-lucide="sparkles"></i><span>${escapeHtml(summary)}</span></div>` : ""}
        <div class="ai-matches-list">
            ${cardsHtml}
        </div>
    `;

    if (window.lucide) lucide.createIcons();

    const applyBtn = document.getElementById("aiApplyFilterBtn");
    if (applyBtn) {
        applyBtn.addEventListener("click", () => {
            applyAiMatchesToCatalog(matches, query);
        });
    }
}

async function executeAiPartSearch(rawQuery) {
    if (aiSearchInProgress) return;
    const query = (rawQuery || "").trim();
    if (!query) {
        const input = document.getElementById("aiPartDescription");
        if (input) {
            input.focus();
        }
        showToast("Please describe the part function or appearance");
        return;
    }

    if (!inventoryParts || inventoryParts.length === 0) {
        renderAiErrorState("Lab parts inventory is empty or still loading. Please try again shortly.");
        return;
    }

    const submitBtn = document.getElementById("aiSubmitSearchBtn");
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Matching...`;
        if (window.lucide) lucide.createIcons();
    }
    aiSearchInProgress = true;
    renderAiLoadingState();

    try {
        const rawResponse = await callPartsMatcher(query);

        let parsed;
        try {
            parsed = parseAiJsonResponse(rawResponse);
        } catch (e) {
            console.error("AI JSON parse error:", e, rawResponse);
            throw new Error("Could not understand AI response format. Please try again.");
        }

        const rawMatches = Array.isArray(parsed?.matches) ? parsed.matches : [];
        const partMap = new Map(inventoryParts.map(p => [p.id, p]));

        const validMatches = [];
        for (const m of rawMatches) {
            if (m && m.id && partMap.has(m.id)) {
                validMatches.push({
                    part: partMap.get(m.id),
                    confidence: m.confidence || "medium",
                    reason: m.reason || `Matches description for ${partMap.get(m.id).name}.`,
                    matched_features: Array.isArray(m.matched_features) ? m.matched_features : []
                });
            }
        }

        aiLastSearchResults = validMatches;
        aiLastQuery = query;
        renderAiMatches(validMatches, parsed.summary || "", query);

    } catch (err) {
        console.error("AI Search failed:", err);
        renderAiErrorState(err.message || "Failed to contact AI service. Please check your network connection.");
    } finally {
        aiSearchInProgress = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            if (window.lucide) lucide.createIcons();
        }
    }
}

function applyAiMatchesToCatalog(matches, query) {
    if (!matches || !matches.length) return;
    window.aiPartMatches = matches.map(m => m.part.id);
    const filterBar = document.getElementById("aiActiveFilterBar");
    const queryEl = document.getElementById("aiActiveFilterQuery");
    if (filterBar && queryEl) {
        queryEl.textContent = `"${query}" (${matches.length} found)`;
        filterBar.style.display = "flex";
    }
    const partSearchInput = document.getElementById("partSearch");
    if (partSearchInput) partSearchInput.value = "";
    renderPartsGrid();
    closeAiPartModal();
    showToast(`Showing ${matches.length} AI suggested parts`);
}

function clearAiCatalogFilter() {
    window.aiPartMatches = null;
    const filterBar = document.getElementById("aiActiveFilterBar");
    if (filterBar) filterBar.style.display = "none";
    renderPartsGrid();
    showToast("Showing all catalog parts");
}

async function loadInventoryParts() {
    const { data: parts, error } = await supabaseClient
        .from("inventory_parts")
        .select("id, name, category, quantity, location, notes, ai_use, photo_url")
        .order("name", { ascending: true });
    if (error) {
        console.error("Registry load error:", error);
        document.getElementById("partsGrid").innerHTML = `<div class="empty-state empty-state-error"><strong>Registry unavailable</strong><p>Parts could not be loaded.</p></div>`;
        return;
    }
    inventoryParts = parts || [];
    const partMap = new Map(inventoryParts.map(part => [part.id, part]));
    Object.keys(partCart).forEach(id => {
        const fresh = partMap.get(id);
        if (fresh) partCart[id].part = fresh;
        else delete partCart[id];
    });
    partCategoryOptions = [...new Set(inventoryParts.map(part => part.category).filter(Boolean))].sort();
    populateCategoryFilter();
    renderPartsGrid();
    renderCart();
}

function populateCategoryFilter() {
    const select = document.getElementById("partCategoryFilter");
    const current = select.value;
    select.innerHTML = `<option value="">All categories</option>${partCategoryOptions.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    select.value = current;
}

function visibleParts() {
    const query = document.getElementById("partSearch").value.trim().toLowerCase();
    const category = document.getElementById("partCategoryFilter").value;
    let parts = inventoryParts;

    if (window.aiPartMatches && Array.isArray(window.aiPartMatches) && window.aiPartMatches.length > 0) {
        const matchMap = new Map(window.aiPartMatches.map((id, index) => [id, index]));
        parts = parts.filter(p => matchMap.has(p.id));
        parts.sort((a, b) => matchMap.get(a.id) - matchMap.get(b.id));
    } else if (query) {
        parts = parts.filter(part => {
            const searchable = `${part.name} ${part.category || ""} ${part.location || ""} ${part.notes || ""} ${part.ai_use || ""}`.toLowerCase();
            return searchable.includes(query);
        });
    }

    if (category) {
        parts = parts.filter(part => part.category === category);
    }
    return parts;
}

// ============================================================
// Free keyword image system — Wikimedia Commons (no API key).
// Same source the admin parts registry uses, so cards here show
// the exact same pictures as the admin console.
// ============================================================

const partImageCache = new Map();

function partImageKeywords(part) {
    const name = String(part.name || "").trim();
    const category = String(part.category || "").trim();
    const words = [];
    if (name) words.push(name);
    if (category && category.toLowerCase() !== "uncategorized" && !name.toLowerCase().includes(category.toLowerCase())) words.push(category);
    return words.length ? words : ["electronics"];
}

function searchCommonsImage(keyword) {
    if (partImageCache.has(keyword)) return Promise.resolve(partImageCache.get(keyword));
    const storedKey = `otter-partimg:${keyword}`;
    try {
        const stored = localStorage.getItem(storedKey);
        if (stored) {
            partImageCache.set(keyword, stored);
            return Promise.resolve(stored);
        }
    } catch (_) { /* storage unavailable */ }
    const endpoint = "https://commons.wikimedia.org/w/api.php"
        + `?action=query&generator=search&gsrsearch=${encodeURIComponent(keyword)}&gsrnamespace=6&gsrlimit=5`
        + "&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=800&format=json&origin=*";
    return fetch(endpoint)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(`http ${res.status}`))))
        .then(json => {
            const pages = Object.values((json && json.query && json.query.pages) || {})
                .sort((a, b) => (a.index || 0) - (b.index || 0));
            const hit = pages.find(page => {
                const info = page.imageinfo && page.imageinfo[0];
                return info && info.thumburl && /^image\//.test(info.mime || "");
            });
            const found = hit ? String(hit.imageinfo[0].thumburl).split("?")[0] : null;
            partImageCache.set(keyword, found);
            if (found) { try { localStorage.setItem(storedKey, found); } catch (_) {} }
            return found;
        })
        .catch(() => { partImageCache.set(keyword, null); return null; });
}

async function resolvePartImage(keywords) {
    for (const keyword of keywords) {
        const found = await searchCommonsImage(keyword);
        if (found) return found;
    }
    return null;
}

function attachKeywordPhoto(container, keywords) {
    if (!container || !container.isConnected) return;
    resolvePartImage(keywords).then(src => {
        if (!src || !container.isConnected) return;
        if (container.querySelector("img")) return;
        const img = document.createElement("img");
        img.className = "thumb-photo";
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onload = () => img.classList.add("is-loaded");
        img.onerror = () => img.remove();
        container.appendChild(img);
        img.src = src;
    });
}

function hydrateCardImages(root) {
    if (!root) return;
    root.querySelectorAll(".part-card[data-image-keywords]").forEach(card => {
        if (card.dataset.imageRequested) return;
        card.dataset.imageRequested = "1";
        const thumb = card.querySelector(".part-thumb");
        if (thumb) attachKeywordPhoto(thumb, card.dataset.imageKeywords.split("\n").filter(Boolean));
    });
}

function renderPartsGrid() {
    const grid = document.getElementById("partsGrid");
    if (!inventoryParts.length) {
        grid.innerHTML = `<div class="empty-state"><strong>Registry is empty</strong><p>Parts added by the lab admin will appear here.</p></div>`;
        return;
    }
    const parts = visibleParts();
    if (!parts.length) {
        grid.innerHTML = `<div class="empty-state empty-state-error"><strong>No matching parts</strong><p>Try a different search or category.</p></div>`;
        return;
    }
    grid.innerHTML = parts.map(part => {
        const custom = String(part.photo_url || "").trim();
        const photo = custom
            ? `<img class="thumb-photo" src="${escapeHtml(custom)}" alt="" referrerpolicy="no-referrer" loading="lazy" onload='this.classList.add("is-loaded")' onerror='this.remove()'>`
            : "";
        const keywords = custom ? "" : ` data-image-keywords="${escapeHtml(partImageKeywords(part).join("\n"))}"`;
        return `
        <article class="part-card" data-part-id="${escapeHtml(part.id)}"${keywords}>
            <span class="part-thumb"><i class="part-glyph" data-lucide="package" aria-hidden="true"></i>${photo}</span>
            <div class="part-card-head"><strong>${escapeHtml(part.name)}</strong><span class="part-category">${escapeHtml(part.category)}</span></div>
            <p class="part-meta">${escapeHtml(part.location)}</p>
            <div class="part-actions">
                <span class="part-qty ${part.quantity > 0 ? "" : "zero"}">${part.quantity > 0 ? `${part.quantity} in stock` : "Out of stock"}</span>
                <button class="add-button ${partCart[part.id] ? "added" : ""}" data-cart-action="toggle" type="button">${partCart[part.id] ? "In cart ✓" : "Add to cart"}</button>
            </div>
        </article>`;
    }).join("");
    if (window.lucide) lucide.createIcons();
    hydrateCardImages(grid);
}

function cartItemCount() {
    return Object.values(partCart).reduce((total, entry) => total + entry.quantity, 0);
}

function renderCart() {
    const list = document.getElementById("cartList");
    const entries = Object.values(partCart);
    const totalItems = cartItemCount();
    document.getElementById("cartTotal").textContent = entries.length ? `${totalItems} item${totalItems === 1 ? "" : "s"}` : "0 items";
    document.getElementById("cartSummary").textContent = entries.length ? `${entries.length} part${entries.length === 1 ? "" : "s"} ready for review` : "No parts added yet.";
    document.getElementById("proposeButton").disabled = totalItems === 0;
    list.innerHTML = entries.length ? entries.map(entry => `
        <div class="cart-item" data-part-id="${escapeHtml(entry.part.id)}">
            <div class="cart-item-info"><strong>${escapeHtml(entry.part.name)}</strong><small>${escapeHtml(entry.part.category)}</small></div>
            <div class="cart-item-controls">
                <button class="cart-step" data-cart-action="decrement" type="button" aria-label="Remove one">−</button>
                <span class="cart-count">${entry.quantity}</span>
                <button class="cart-step" data-cart-action="increment" type="button" aria-label="Add one">+</button>
                <button class="cart-remove" data-cart-action="remove" type="button" aria-label="Remove part">×</button>
            </div>
        </div>
    `).join("") : `<div class="empty-state compact-empty"><strong>Cart is empty</strong><p>Add parts from the registry to start a proposal.</p></div>`;
}

/* ---------------- Tabs ---------------- */

const TABS = {
    overview: { section: "Dashboard" },
    partProposal: { section: "Part requests" },
    borrowLogs: { section: "Borrow logs" },
    projectProposal: { section: "Projects" },
    labTimings: { section: "Lab timings" }
};

let tabTransitionToken = 0;
let tabTransitionAnims = [];

function prefersReducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cancelTabTransition() {
    tabTransitionAnims.forEach(anim => { try { anim.cancel(); } catch (_) {} });
    tabTransitionAnims = [];
}

function setActiveTab(tabName) {
    if (!TABS[tabName]) return;

    const token = ++tabTransitionToken;
    cancelTabTransition();

    document.querySelector(".page-heading")?.setAttribute("data-watermark", tabName);

    document.querySelectorAll("[data-tab]").forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle("active", isActive);
        if (isActive) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });

    const prevView = document.querySelector(".tab-view.active");
    const nextView = document.getElementById(`${tabName}View`);
    const headingText = document.querySelector(".page-heading-text");

    const titles = {
        overview: ["Good morning,", currentUser?.name || "student", "Everything the lab has going on for you today."],
        partProposal: ["Part request", "workshop", "Search the registry, build your cart, and send one tidy proposal."],
        borrowLogs: ["Borrow", "trail", "Every part that has left the lab, with receipts and return dates."],
        projectProposal: ["Project", "proposals", "Follow the events your teachers run, then bring friends along."],
        labTimings: ["Lab", "timings", "See which periods the lab is open, and when it is closed."]
    };
    const [lead, accent, description] = titles[tabName];

    const commit = () => {
        if (token !== tabTransitionToken) return;

        document.querySelectorAll(".tab-view").forEach(view => view.classList.toggle("active", view.id === `${tabName}View`));

        const resetScroll = () => {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        };
        resetScroll();
        requestAnimationFrame(resetScroll);

        document.getElementById("pageLead").textContent = lead;
        document.getElementById("pageAccent").textContent = accent;
        document.getElementById("pageDescription").textContent = description;
        document.title = `Otter — ${TABS[tabName].section}`;

        if (headingText && typeof headingText.animate === "function" && !prefersReducedMotion()) {
            headingText.animate(
                [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }],
                { duration: 380, easing: "cubic-bezier(.22, 1, .36, 1)" }
            );
        }
    };

    const runLoaders = () => {
        if (tabName === "partProposal") {
            loadInventoryParts();
            loadMyProposals();
        }
        if (tabName === "projectProposal") loadStudentProjects();
        if (tabName === "borrowLogs") loadBorrowLogs();
        if (tabName === "overview") {
            loadOverviewMetrics();
            loadDeadlines();
        }
        if (tabName === "labTimings") loadLabTimings();
    };

    const canAnimate = !prefersReducedMotion() && prevView && nextView && prevView !== nextView
        && typeof prevView.animate === "function";

    if (!canAnimate) {
        commit();
        runLoaders();
        return;
    }

    const prevStyle = getComputedStyle(prevView);
    const fromOpacity = Number.parseFloat(prevStyle.opacity);
    const fromTransform = prevStyle.transform === "none" ? "translateY(0)" : prevStyle.transform;
    const exitOptions = { duration: 170, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" };

    tabTransitionAnims.push(prevView.animate([
        { opacity: Number.isNaN(fromOpacity) ? 1 : fromOpacity, transform: fromTransform },
        { opacity: 0, transform: "translateY(-12px)" }
    ], exitOptions));
    if (headingText && typeof headingText.animate === "function") {
        tabTransitionAnims.push(headingText.animate([
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(-8px)" }
        ], exitOptions));
    }

    runLoaders();

    Promise.all(tabTransitionAnims.map(anim => anim.finished.catch(() => {}))).then(() => {
        if (token !== tabTransitionToken) return;
        cancelTabTransition();
        commit();
    });
}

function openProposeModal() {
    const entries = Object.values(partCart);
    if (!entries.length) return;
    document.getElementById("proposeItems").innerHTML = entries.map(entry => `
        <div class="modal-item"><strong>${escapeHtml(entry.part.name)}</strong><span>× ${entry.quantity}</span></div>
    `).join("");
    document.getElementById("proposeReason").value = "";
    openModal("proposeModal");
}

function closeProposeModal() {
    closeModal("proposeModal");
}

function statusLabel(status) {
    return { pending: "Awaiting review", standby: "On standby", approved: "Approved", declined: "Declined", expired: "Expired" }[status] || status;
}

function proposalAge(value) {
    return formatTime(value);
}

async function loadMyProposals() {
    const { data: proposalRows, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, reason, duration_days, items, status, reviewed_note, created_at")
        .order("created_at", { ascending: false });
    const list = document.getElementById("requestList");
    if (error) {
        console.error("Proposal load error:", error);
        list.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load your proposals</strong><p>Run the admin SQL migration first.</p></div>`;
        return;
    }
    const proposals = (proposalRows || []).filter(proposal => proposal.student_id === currentUser.id);
    if (!proposals.length) {
        list.innerHTML = `<div class="empty-state"><strong>No proposals yet</strong><p>Send your first part request and it will be tracked here.</p></div>`;
        return;
    }
    list.innerHTML = proposals.slice(0, 3).map(proposal => {
        const items = Array.isArray(proposal.items) ? proposal.items : [];
        return `
        <button class="request-row" type="button" data-goto-tab="borrowLogs">
            <span>
                <strong>${escapeHtml(proposal.reason)}</strong>
                <small>${proposalAge(proposal.created_at)} · ${escapeHtml(proposal.duration_days)} day${proposal.duration_days === 1 ? "" : "s"}${proposal.reviewed_note ? ` · ${escapeHtml(proposal.reviewed_note)}` : ""}</small>
                <span class="request-items">${items.map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(" · ") || "No items"}</span>
            </span>
            <span class="request-status ${escapeHtml(proposal.status)}">${statusLabel(proposal.status)}</span>
        </button>`;
    }).join("");
}

/* ---------------- Borrow logs ---------------- */

const borrowStatusLabel = proposal => proposal.returned_at ? "Returned" : proposal.lent_at ? "With you" : proposal.status === "expired" ? "Never collected" : proposal.status === "approved" ? "Ready to collect" : statusLabel(proposal.status);

function isBorrowOverdue(proposal) {
    if (!proposal.due_at || proposal.returned_at || !proposal.lent_at) return false;
    return new Date(proposal.due_at).getTime() < clockNow().getTime();
}

function borrowTimeLeft(proposal) {
    if (!proposal.due_at || proposal.returned_at) return "";
    const seconds = Math.floor((new Date(proposal.due_at).getTime() - clockNow().getTime()) / 1000);
    if (seconds <= 0) return "Overdue";
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min left`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr left`;
    return `${Math.floor(seconds / 86400)} days left`;
}

async function loadBorrowLogs() {
    if (!currentUser) return;
    const { data, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, reason, duration_days, items, status, reviewed_note, reviewed_at, created_at, lent_at, due_at, returned_at, photo_url, return_note")
        .order("created_at", { ascending: false });
    const list = document.getElementById("borrowList");
    if (error) {
        list.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load your borrow logs</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Borrow log error:", error);
        return;
    }
    borrowLogs = (data || []).filter(proposal => proposal.student_id === currentUser.id);
    renderBorrowLogs();
}

function borrowFilterStatus(proposal) {
    if (proposal.returned_at) return "returned";
    if (proposal.lent_at) return "active";
    if (proposal.status === "expired") return "expired";
    if (proposal.status === "approved") return "approved";
    if (proposal.status === "declined") return "declined";
    return "pending";
}

function renderBorrowLogs() {
    const list = document.getElementById("borrowList");
    const search = document.getElementById("borrowSearch").value.trim().toLowerCase();
    const status = document.getElementById("borrowStatusFilter").value;
    const from = document.getElementById("borrowDateFrom").value;
    const to = document.getElementById("borrowDateTo").value;
    const filtered = borrowLogs.filter(proposal => {
        const items = Array.isArray(proposal.items) ? proposal.items : [];
        const searchable = [proposal.reason, proposal.status, ...items.map(item => item.name)].join(" ").toLowerCase();
        const createdDate = String(proposal.created_at || "").slice(0, 10);
        const statusMatch = status === "all"
            || (status === "overdue" ? isBorrowOverdue(proposal) : borrowFilterStatus(proposal) === status);
        return (!search || searchable.includes(search))
            && statusMatch
            && (!from || !createdDate || createdDate >= from)
            && (!to || !createdDate || createdDate <= to);
    });
    const count = document.getElementById("borrowHistoryCount");
    count.textContent = `${filtered.length} of ${borrowLogs.length} record${borrowLogs.length === 1 ? "" : "s"}`;
    if (!borrowLogs.length) {
        list.innerHTML = `<div class="empty-state"><strong>No borrow activity yet</strong><p>Proposals you send will be tracked here with their pick-up receipt.</p></div>`;
        return;
    }
    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state"><strong>No matching history</strong><p>Try a different search, date range, or status.</p></div>`;
        return;
    }
    list.innerHTML = filtered.map(proposal => {
        const items = Array.isArray(proposal.items) ? proposal.items : [];
        const timeLeft = borrowTimeLeft(proposal);
        return `
        <button class="borrow-row" type="button" data-borrow-row data-borrow-id="${escapeHtml(proposal.id)}" aria-label="Open receipt for ${escapeHtml(proposal.reason || "borrow log")}">
            <span class="borrow-row-main">
                <strong>${escapeHtml(proposal.reason)}</strong>
                <small>${formatTime(proposal.created_at)} · ${escapeHtml(proposal.duration_days)} day${proposal.duration_days === 1 ? "" : "s"} · ${items.length} part${items.length === 1 ? "" : "s"}</small>
                <span class="request-items">${items.map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(" · ") || "No items"}</span>
            </span>
            <span class="borrow-row-side">
                <span class="request-status ${escapeHtml(proposal.status)}${proposal.lent_at && !proposal.returned_at ? " lent" : ""}">${borrowStatusLabel(proposal)}</span>
                ${timeLeft ? `<span class="borrow-timeleft">${escapeHtml(timeLeft)}</span>` : ""}
            </span>
        </button>`;
    }).join("");
}

function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function receiptEvent(label, value, done) {
    return `<div class="timeline-item${done ? " done" : ""}"><span class="timeline-dot"></span><div><strong>${escapeHtml(label)}</strong><small>${value ? escapeHtml(new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })) : "—"}</small></div></div>`;
}

function openReceipt(proposalId) {
    const proposal = borrowLogs.find(item => item.id === proposalId);
    if (!proposal) return;
    activeReceiptId = proposalId;
    const items = Array.isArray(proposal.items) ? proposal.items : [];
    const verified = proposal.status === "approved";
    const isOut = proposal.lent_at && !proposal.returned_at;
    const code = `OTT-${proposal.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    document.getElementById("receiptTitle").textContent = proposal.reason;
    let notice = `<div class="receipt-notice">Awaiting review — this receipt becomes valid once approved.</div>`;
    if (isOut) notice = `<div class="receipt-notice live">The parts are with you. Return them before the due date.</div>`;
    else if (proposal.returned_at) notice = `<div class="receipt-notice done">Returned safely to the lab. Nothing left to do.</div>`;
    else if (proposal.status === "expired") notice = `<div class="receipt-notice declined">This request expired before the parts were collected, so the receipt is no longer valid. Send a new proposal if you still need them.</div>`;
    else if (proposal.status === "approved") notice = `<div class="receipt-notice ready">Verified — show this receipt at the lab to collect the parts.</div>`;
    else if (proposal.status === "declined") notice = `<div class="receipt-notice declined">This request was declined, so this receipt is not valid.</div>`;
    document.getElementById("receiptBody").innerHTML = `
        <div class="receipt-top">
            <div>
                <span class="receipt-code">${escapeHtml(code)}</span>
                <p class="receipt-holder">${escapeHtml(currentUser.name)}<small>Issued ${escapeHtml(new Date(proposal.created_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }))}</small></p>
            </div>
            <div class="receipt-seal${verified ? " verified" : ""}">${verified ? "✓ Verified" : "Unverified"}</div>
        </div>
        ${notice}
        ${isOut ? `<div class="receipt-timer"><span>Time left with the parts</span><strong id="receiptCountdown">${escapeHtml(formatCountdown(new Date(proposal.due_at).getTime() - clockNow().getTime()))}</strong><small>Due ${escapeHtml(new Date(proposal.due_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small></div>` : ""}
        <div class="receipt-parts"><div class="receipt-label">Parts on this receipt</div><div class="modal-items">${items.map(item => `<div class="modal-item"><strong>${escapeHtml(item.name)}</strong><span>× ${item.quantity}</span></div>`).join("") || `<div class="modal-item"><strong>No parts listed</strong></div>`}</div></div>
        <div class="receipt-timeline"><div class="receipt-label">Full timeline</div>
            ${receiptEvent("Proposal sent", proposal.created_at, true)}
            ${receiptEvent(proposal.status === "pending" ? "Review" : `Reviewed — ${statusLabel(proposal.status)}`, proposal.reviewed_at, Boolean(proposal.reviewed_at))}
            ${receiptEvent("Collected from the lab", proposal.lent_at, Boolean(proposal.lent_at))}
            ${receiptEvent("Due back", proposal.due_at, Boolean(proposal.due_at))}
            ${proposal.returned_at ? receiptEvent("Returned", proposal.returned_at, true) : ""}
        </div>
        ${proposal.photo_url ? `<div class="receipt-photo"><div class="receipt-label">Photo taken before hand-over</div><img src="${escapeHtml(proposal.photo_url)}" alt="Parts at hand-over"></div>` : ""}
    `;
    openModal("receiptModal");
    startReceiptTimer(proposal);
}

function startReceiptTimer(proposal) {
    clearInterval(receiptTimer);
    receiptTimer = null;
    if (!proposal.lent_at || !proposal.due_at || proposal.returned_at) return;
    receiptTimer = setInterval(() => {
        const countdown = document.getElementById("receiptCountdown");
        if (!countdown) return;
        const remaining = new Date(proposal.due_at).getTime() - clockNow().getTime();
        countdown.textContent = remaining <= 0 ? "Overdue" : formatCountdown(remaining);
    }, 1000);
}

function closeReceipt() {
    clearInterval(receiptTimer);
    receiptTimer = null;
    activeReceiptId = null;
    closeModal("receiptModal");
}

async function submitProposal(event) {
    event.preventDefault();
    const reason = document.getElementById("proposeReason").value.trim();
    const durationDays = Number(document.getElementById("proposeDuration").value);
    if (!reason) { showToast("Explain why you need these parts"); return; }
    if (![3, 7, 10, 14].includes(durationDays)) { showToast("Choose one of the fixed borrow durations"); return; }
    const entries = Object.values(partCart);
    if (!entries.length) { closeProposeModal(); return; }

    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Sending...";

    const items = entries.map(entry => ({
        id: entry.part.id,
        name: entry.part.name,
        category: entry.part.category,
        quantity: entry.quantity
    }));
    const { error } = await supabaseClient.rpc("student_create_proposal", {
        p_reason: reason,
        p_duration_days: durationDays,
        p_items: items
    });

    button.disabled = false;
    button.textContent = "Send proposal →";

    if (error) {
        showToast(error.message || "Could not send that proposal");
        console.error("Proposal create error:", error);
        return;
    }

    partCart = {};
    renderPartsGrid();
    renderCart();
    closeProposeModal();
    showToast("Proposal sent to your teacher");
    await Promise.all([loadMyProposals(), loadOverviewMetrics()]);
}

function studentProjectDetail(label, value) {
    return value ? `<div class="project-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : "";
}

const PROJECT_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

function isoStamp(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayStamp() {
    const now = clockNow();
    return isoStamp(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function projectLimitDate(project) {
    const raw = String(project?.held_date || "").trim();
    if (raw) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const text = raw.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
        const dayFirst = text.match(/(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}) (\d{4})/);
        const monthFirst = text.match(/([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)? (\d{4})/);
        const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (dayFirst && PROJECT_MONTHS[dayFirst[2].slice(0, 3)] !== undefined) {
            const stamp = isoStamp(Number(dayFirst[3]), PROJECT_MONTHS[dayFirst[2].slice(0, 3)] + 1, Number(dayFirst[1]));
            if (stamp) return stamp;
        }
        if (monthFirst && PROJECT_MONTHS[monthFirst[1].slice(0, 3)] !== undefined) {
            const stamp = isoStamp(Number(monthFirst[3]), PROJECT_MONTHS[monthFirst[1].slice(0, 3)] + 1, Number(monthFirst[2]));
            if (stamp) return stamp;
        }
        if (numeric) {
            const stamp = isoStamp(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
            if (stamp) return stamp;
        }
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) return isoStamp(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }
    return [project?.make_deadline, project?.deadline].find(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) || null;
}

function isProjectArchived(project) {
    const limit = projectLimitDate(project);
    return !!limit && limit < todayStamp();
}

function studentProjectDay(value) {
    if (!value) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return value;
}

function projectHistoryRow(project) {
    return `
        <article class="history-row">
            <div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.teacher_name || "Teacher")}${project.location ? ` · ${escapeHtml(project.location)}` : ""}</small><span>${escapeHtml(project.brief || "No brief given.")}</span></div>
            <div><b class="history-status archived">Ended</b><small>${escapeHtml(studentProjectDay(projectLimitDate(project)))}</small></div>
        </article>`;
}

function renderProjectHistory(archived) {
    studentArchivedProjects = archived;
    const search = document.getElementById("projectHistorySearch").value.trim().toLowerCase();
    const from = document.getElementById("projectHistoryDateFrom").value;
    const to = document.getElementById("projectHistoryDateTo").value;
    const filtered = archived.filter(project => {
        const searchable = [project.title, project.teacher_name, project.location, project.brief].join(" ").toLowerCase();
        const limit = projectLimitDate(project) || "";
        return (!search || searchable.includes(search))
            && (!from || limit >= from)
            && (!to || limit <= to);
    });
    const empty = `<div class="history-empty">${archived.length ? "No matching history." : "Nothing in the history box yet."}</div>`;
    const preview = document.getElementById("projectHistory");
    if (preview) preview.innerHTML = filtered.length ? filtered.slice(0, 5).map(projectHistoryRow).join("") : empty;
    const full = document.getElementById("projectHistoryFull");
    if (full) full.innerHTML = filtered.length ? filtered.map(projectHistoryRow).join("") : empty;
    document.getElementById("projectHistoryCount").textContent = archived.length;
}

async function loadStudentProjects() {
    if (!currentUser) return;
    const [projectsResult, sharesResult, interestsResult] = await Promise.all([
        supabaseClient.from("project_proposals").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("project_shares").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("project_interests").select("project_id, confirmed").eq("student_id", currentUser.id)
    ]);
    const list = document.getElementById("studentProjects");
    if (projectsResult.error) {
        list.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load projects</strong><p>Run the admin SQL migration first.</p></div>`;
        renderProjectHistory([]);
        console.error("Project load error:", projectsResult.error);
        return;
    }
    const shares = sharesResult.data || [];
    allShares = shares.filter(share => share.sharer_id === currentUser.id);
    sharedToMe = shares.filter(share => share.invitee_id === currentUser.id);
    const myInterests = interestsResult.error ? [] : (interestsResult.data || []);
    projectById = {};
    (projectsResult.data || []).forEach(project => { projectById[project.id] = project; });
    const invitedLookup = new Set();
    const visible = (projectsResult.data || []).filter(project => {
        const invited = (Array.isArray(project.invited_students) ? project.invited_students : []).some(student => student.id === currentUser.id);
        if (invited) invitedLookup.add(project.id);
        const shared = sharedToMe.some(share => share.project_id === project.id && share.status === "yes");
        return invited || shared;
    });
    const active = visible.filter(project => !isProjectArchived(project));
    const archived = visible.filter(project => isProjectArchived(project));
    if (!active.length) {
        list.innerHTML = archived.length
            ? `<div class="empty-state"><strong>No events coming up</strong><p>${archived.length} past project${archived.length === 1 ? " is" : "s are"} in the history box. New invites from your teachers will appear here.</p></div>`
            : `<div class="empty-state"><strong>No invites yet</strong><p>Projects your teachers send you — or friends share with you — will appear here.</p></div>`;
        renderProjectHistory(archived);
        return;
    }
    list.innerHTML = active.map(project => {
        const interest = myInterests.find(item => item.project_id === project.id);
        const interestOn = !!interest;
        const confirmed = !!interest?.confirmed;
        const sharer = sharedToMe.find(share => share.project_id === project.id && share.status === "yes");
        const mine = allShares.filter(share => share.project_id === project.id);
        return `
        <article class="project-card" data-project-id="${escapeHtml(project.id)}">
            <div class="project-card-top">
                ${invitedLookup.has(project.id) || !sharer
                    ? `<span class="project-cat invited">Invited by a teacher</span>`
                    : `<span class="project-cat shared">Shared to you by ${escapeHtml(sharer.sharer_name || "a friend")}</span>`}
                <div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.teacher_name)} · ${formatTime(project.created_at)}</small></div>
            </div>
            ${project.brief ? `<p class="project-brief">${escapeHtml(project.brief)}</p>` : ""}
            <div class="project-details">
                ${studentProjectDetail("When", project.held_date)}
                ${studentProjectDetail("Where", project.location)}
                ${studentProjectDetail("Transport", project.school_transport)}
                ${studentProjectDetail("School pays", project.school_funding)}
                ${project.website ? `<div class="project-detail"><span>Website</span><a href="${escapeHtml(project.website)}" target="_blank" rel="noopener">${escapeHtml(project.website)} ↗</a></div>` : ""}
            </div>
            ${mine.length ? `<div class="share-out-row"><span>You shared this with</span>${mine.map(share => `<span class="part-chip">${escapeHtml(share.invitee_name || "Friend")}</span>`).join("")}</div>` : ""}
            ${!interestOn
                ? `<button class="interested-button" data-project-action="interested" data-project-id="${escapeHtml(project.id)}" type="button">I'm interested</button>`
                : confirmed
                    ? `<div class="attend-row"><span class="attend-chip">★ Attending · confirmed</span><button class="interested-button marked" data-project-action="share" data-project-id="${escapeHtml(project.id)}" type="button">Reach out to friends</button></div>`
                    : `<div class="attend-row"><button class="interested-button" data-project-action="confirm" data-project-id="${escapeHtml(project.id)}" type="button">Confirm attendance</button><small class="confirm-hint">Confirm to unlock reaching out to friends</small></div>`}
        </article>`;
    }).join("");
    renderProjectHistory(archived);
}

async function loadDeadlines() {
    const list = document.getElementById("deadlineList");
    if (!currentUser) return;
    const [interestsResult, loansResult] = await Promise.all([
        supabaseClient.from("project_interests").select("project_id").eq("student_id", currentUser.id),
        supabaseClient.from("part_proposals").select("id, reason, due_at, items").eq("student_id", currentUser.id).not("lent_at", "is", null).is("returned_at", null)
    ]);
    if (interestsResult.error) {
        list.innerHTML = `<div class="empty-state compact-empty empty-state-error"><strong>Deadlines unavailable</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Deadline interest error:", interestsResult.error);
        return;
    }
    const ids = [...new Set((interestsResult.data || []).map(interest => interest.project_id))];
    let projects = [];
    if (ids.length) {
        const { data, error } = await supabaseClient.from("project_proposals").select("id, title, teacher_name, held_date, deadline, make_deadline").in("id", ids);
        if (error) { console.error("Deadline load error:", error); }
        else projects = data || [];
    }
    const rows = [];
    (loansResult.data || []).forEach(loan => {
        if (!loan.due_at) return;
        const date = new Date(loan.due_at).toISOString().slice(0, 10);
        const count = partItemCount(loan);
        rows.push({ title: loan.reason || "Borrowed equipment", meta: `${count} part${count === 1 ? "" : "s"} · on loan`, date, badges: deadlineBadge(date, "Return by"), tab: "borrowLogs" });
    });
    projects.filter(project => !isProjectArchived(project)).forEach(project => {
        if (!project.deadline && !project.make_deadline) return;
        rows.push({
            title: project.title,
            meta: project.teacher_name,
            date: [project.deadline, project.make_deadline].filter(Boolean).sort()[0],
            badges: `${deadlineBadge(project.deadline, "Sign up")}${deadlineBadge(project.make_deadline, "Make by")}`,
            tab: "projectProposal"
        });
    });
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!rows.length) {
        list.innerHTML = `<div class="empty-state compact-empty dashboard-empty-state"><i class="dashboard-empty-icon" data-lucide="calendar-x" aria-hidden="true"></i><strong>No deadlines yet</strong><p>Return dates for your loans and deadlines for projects you join will appear here.</p></div>`;
        if (window.lucide) lucide.createIcons();
        return;
    }
    list.innerHTML = rows.map(row => `
        <button class="deadline-row" type="button" data-goto-tab="${row.tab}">
            <span class="deadline-main">
                <strong>${escapeHtml(row.title)}</strong>
                <small>${escapeHtml(row.meta)}</small>
            </span>
            <span class="deadline-badges">${row.badges}</span>
        </button>`).join("");
}

function deadlineBadge(value, label) {
    if (!value) return "";
    const due = new Date(`${value}T00:00:00`);
    const days = Math.round((due - new Date(clockNow().toDateString())) / 86400000);
    const state = days < 0 ? "past" : days <= 3 ? "soon" : "open";
    const left = days < 0 ? "passed" : days === 0 ? "today" : days === 1 ? "1 day left" : `${days} days left`;
    return `<span class="deadline-badge ${state}">${label} · ${escapeHtml(due.toLocaleDateString(undefined, { day: "numeric", month: "short" }))} · ${left}</span>`;
}

async function toggleProjectInterest(projectId) {
    const { data: existing, error: lookupError } = await supabaseClient.from("project_interests").select("id").eq("project_id", projectId).eq("student_id", currentUser.id).maybeSingle();
    if (lookupError) { showToast("Could not update your interest"); return; }
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Student";
    const result = existing
        ? await supabaseClient.from("project_interests").delete().eq("id", existing.id)
        : await supabaseClient.from("project_interests").insert({ project_id: projectId, student_id: currentUser.id, student_name: name });
    if (result.error) {
        showToast("Could not update your interest");
        console.error("Interest update error:", result.error);
        return;
    }
    await loadStudentProjects();
    await loadDeadlines();
    await loadOverviewMetrics();
}

async function toggleLike(postId, button) {
    const { data: existing, error: lookupError } = await supabaseClient.from("announcement_likes").select("announcement_id").eq("announcement_id", postId).eq("user_id", currentUser.id).maybeSingle();
    if (lookupError) { showToast("Could not update that like"); return; }
    const result = existing
        ? await supabaseClient.from("announcement_likes").delete().eq("announcement_id", postId).eq("user_id", currentUser.id)
        : await supabaseClient.from("announcement_likes").insert({ announcement_id: postId, user_id: currentUser.id });
    if (result.error) { showToast("Could not update that like"); return; }
    button.classList.toggle("liked", !existing);
    await loadAnnouncements();
}

/* ---------------- Noise — sharing teacher projects with friends ---------------- */

async function confirmProjectInterest(projectId) {
    const { data: ok, error } = await supabaseClient.rpc("confirm_project_interest", { p_project_id: projectId });
    if (error || !ok) { showToast("Mark the project as interested first"); console.error("Confirm interest error:", error); return; }
    showToast("Attendance confirmed — you can now reach out to friends");
    await Promise.all([loadStudentProjects(), loadDeadlines()]);
}

function shareBudget() {
    return Math.min(Math.max(0, 5 - shareActiveCount), Math.max(0, 10 - shareDailyCount));
}

async function openShareModal(projectId) {
    shareTargetId = projectId;
    sharePick = {};
    const project = projectById[projectId];
    document.getElementById("inviteTitle").textContent = project ? `Reach out — ${project.title}` : "Reach out to friends";
    if (!allClassmates.length) {
        const { data, error } = await supabaseClient.rpc("list_classmates", { p_search: "" });
        if (error) { console.error("Classmate load error:", error); allClassmates = []; }
        else allClassmates = data || [];
    }
    shareClosed = [];
    (Array.isArray(project?.invited_students) ? project.invited_students : []).forEach(student => shareClosed.push(student.id));
    allShares.filter(share => share.project_id === projectId).forEach(share => shareClosed.push(share.invitee_id));
    shareActiveCount = allShares.filter(share => share.project_id === projectId && share.status === "yes").length;
    const dayStart = clockNow();
    dayStart.setHours(0, 0, 0, 0);
    const dailyResult = await supabaseClient.from("project_shares").select("id", { count: "exact", head: true }).eq("sharer_id", currentUser.id).gte("created_at", dayStart.toISOString());
    shareDailyCount = dailyResult.count || 0;
    document.getElementById("inviteSearch").value = "";
    renderSharePicker();
    openModal("inviteModal");
}

function renderSharePicker() {
    const query = document.getElementById("inviteSearch").value.trim().toLowerCase();
    const closed = new Set(shareClosed);
    const filtered = allClassmates.filter(classmate => !query || (classmate.name || "").toLowerCase().includes(query));
    const selectedCount = Object.values(sharePick).filter(Boolean).length;
    const budget = shareBudget();
    document.getElementById("sendInviteButton").disabled = selectedCount === 0 || budget <= 0;
    document.getElementById("inviteDailyLabel").textContent = `Shares today: ${shareDailyCount}/10`;
    document.getElementById("invitePendingLabel").textContent = `Already on this project: ${closed.size}`;
    document.getElementById("inviteHint").textContent = budget <= 0
        ? "You've used your share slots (max 5 friends per project) — ask your teacher to adjust."
        : `${selectedCount} selected · ${budget} slot${budget === 1 ? "" : "s"} left · max 5 friends per project`;
    const list = document.getElementById("inviteList");
    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state compact-empty"><strong>No classmates found</strong><p>Try another name.</p></div>`;
        return;
    }
    list.innerHTML = filtered.map(classmate => {
        const isClosed = closed.has(classmate.id);
        const checked = !!sharePick[classmate.id];
        return `<button class="invite-row ${checked ? "selected" : ""}${isClosed ? " disabled" : ""}" type="button" data-invite-option="${escapeHtml(classmate.id)}" role="checkbox" aria-checked="${checked}" ${isClosed ? "disabled" : ""}>
            <span class="invite-avatar">${escapeHtml(initialsFor(classmate.name))}</span>
            <span class="invite-name">${escapeHtml(classmate.name)}</span>
            ${isClosed
                ? `<span class="invite-state invited">Already on it</span>`
                : `<span class="invite-state">${checked ? "Selected" : "Tap to select"}</span>`}
        </button>`;
    }).join("");
}

async function submitShare(event) {
    event.preventDefault();
    const selected = Object.entries(sharePick).filter(([, on]) => on).map(([id]) => id);
    if (!selected.length || !shareTargetId) return;
    const button = document.getElementById("sendInviteButton");
    button.disabled = true;
    const { data, error } = await supabaseClient.rpc("share_project", { p_project_id: shareTargetId, p_invitee_ids: selected });
    button.disabled = false;
    if (error) { showToast("Reach out only works after you confirm attendance"); console.error("Share send error:", error); return; }
    let message = "";
    if (data?.limit) {
        message = data.limit === "per_project" ? "Too many friends shared on this project from you (max 5)" : "Daily share limit reached (max 10)";
    } else {
        const sent = data?.sent?.length || 0;
        const skipped = data?.skipped?.length || 0;
        const incomingLimited = data?.incoming_limited?.length || 0;
        if (sent) message += `Project shared with ${sent} friend${sent === 1 ? "" : "s"}`;
        if (skipped) message += (message ? " · " : "") + `${skipped} already on this project`;
        if (incomingLimited) message += (message ? " · " : "") + `${incomingLimited} already reached their 5-friend limit`;
    }
    closeModal("inviteModal");
    if (message) showToast(message);
    await loadStudentProjects();
}

document.addEventListener("click", async event => {
    const projectAction = event.target.closest("[data-project-action]");
    if (projectAction) {
        if (projectAction.dataset.projectAction === "confirm") await confirmProjectInterest(projectAction.dataset.projectId);
        if (projectAction.dataset.projectAction === "share") await openShareModal(projectAction.dataset.projectId);
        return;
    }
});

document.addEventListener("click", async event => {
    const tab = event.target.closest("[data-tab]");
    if (tab) setActiveTab(tab.dataset.tab);

    const goto = event.target.closest("[data-goto-tab]");
    if (goto) {
        setActiveTab(goto.dataset.gotoTab);
        if (goto.dataset.gotoFilter) {
            const filter = document.getElementById(goto.dataset.gotoFilter);
            if (filter) { filter.value = goto.dataset.gotoValue || ""; filter.dispatchEvent(new Event("change", { bubbles: true })); }
        }
        return;
    }

    const interestedAction = event.target.closest('[data-project-action="interested"]');
    if (interestedAction) {
        await toggleProjectInterest(interestedAction.dataset.projectId);
        return;
    }

    const inviteOption = event.target.closest("[data-invite-option]");
    if (inviteOption) {
        const userId = inviteOption.dataset.inviteOption;
        if (shareClosed.includes(userId)) return;
        if (!sharePick[userId] && Object.values(sharePick).filter(Boolean).length >= shareBudget()) {
            showToast("Share budget for today is used up");
            return;
        }
        sharePick[userId] = !sharePick[userId];
        renderSharePicker();
        return;
    }

    const cartAction = event.target.closest("[data-cart-action]");
    if (cartAction) {
        const partId = cartAction.closest("[data-part-id]")?.dataset.partId;
        if (!partId) return;
        if (cartAction.dataset.cartAction === "toggle") {
            const part = inventoryParts.find(item => item.id === partId);
            if (!part) return;
            if (partCart[partId]) {
                delete partCart[partId];
            } else {
                if (part.quantity <= 0) { showToast("This part is out of stock"); return; }
                partCart[partId] = { part, quantity: 1 };
            }
        } else {
            const entry = partCart[partId];
            if (!entry) return;
            if (cartAction.dataset.cartAction === "increment") {
                if (entry.quantity >= entry.part.quantity) { showToast("No more stock available"); return; }
                entry.quantity += 1;
            } else if (cartAction.dataset.cartAction === "decrement") {
                entry.quantity -= 1;
                if (entry.quantity <= 0) delete partCart[partId];
            } else {
                delete partCart[partId];
            }
        }
        renderPartsGrid();
        renderCart();
        document.querySelectorAll(`#aiPartSearchModal [data-part-id="${partId}"] [data-cart-action="toggle"]`).forEach(btn => {
            const added = Boolean(partCart[partId]);
            btn.textContent = added ? "In cart ✓" : "Add to cart";
            btn.classList.toggle("added", added);
        });
        return;
    }

    const commentAction = event.target.closest("[data-comment-action]");
    if (commentAction) {
        const commentEl = commentAction.closest("[data-comment-id]");
        if (!commentEl) return;
        if (commentAction.dataset.commentAction === "delete") {
            if (!confirm("Delete this comment?")) return;
            const { error } = await supabaseClient.rpc("delete_comment", { p_comment_id: commentEl.dataset.commentId });
            if (error) { showToast(/own comments/i.test(error.message || "") ? "You can only delete your own comments" : "Could not delete that comment"); console.error("Comment delete error:", error); return; }
            showToast("Comment deleted");
            return loadAnnouncements();
        }
        if (commentAction.dataset.commentAction === "edit") return startCommentEdit(commentEl);
        if (commentAction.dataset.commentAction === "cancelCommentEdit") return loadAnnouncements();
        return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
        const card = action.closest("[data-post-id]");
        if (card) {
            if (action.dataset.action === "like") await toggleLike(card.dataset.postId, action);
            if (action.dataset.action === "comment") {
                const comments = card.querySelector("[data-comments]");
                comments.classList.toggle("open");
                if (comments.classList.contains("open")) openCommentPostIds.add(card.dataset.postId);
                else openCommentPostIds.delete(card.dataset.postId);
            }
            if (action.dataset.action === "share") {
                await navigator.clipboard?.writeText(`${location.href.split("#")[0]}#announcement-${card.dataset.postId}`);
                showToast("Announcement link copied");
            }
        }
        return;
    }

    if (event.target.closest(".modal-backdrop") === event.target) closeTopModal();
});

const partSearchEl = document.getElementById("partSearch");
if (partSearchEl) {
    partSearchEl.addEventListener("input", () => {
        if (window.aiPartMatches) {
            window.aiPartMatches = null;
            const filterBar = document.getElementById("aiActiveFilterBar");
            if (filterBar) filterBar.style.display = "none";
        }
        renderPartsGrid();
    });
    partSearchEl.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            renderPartsGrid();
        }
    });
}
document.getElementById("partCategoryFilter").addEventListener("change", renderPartsGrid);

function initAiMatcher() {
    const aiBtn = document.getElementById("aiPartSearchBtn");
    if (aiBtn && !aiBtn.dataset.bound) {
        aiBtn.dataset.bound = "true";
        aiBtn.addEventListener("click", function(e) {
            e.preventDefault();
            e.stopPropagation();
            openAiPartModal();
        });
    }

    const closeBtn = document.getElementById("aiPartSearchClose");
    if (closeBtn) closeBtn.addEventListener("click", closeAiPartModal);

    const footCloseBtn = document.getElementById("aiModalCloseBtn");
    if (footCloseBtn) footCloseBtn.addEventListener("click", closeAiPartModal);

    const submitBtn = document.getElementById("aiSubmitSearchBtn");
    if (submitBtn) {
        submitBtn.addEventListener("click", () => {
            const desc = document.getElementById("aiPartDescription")?.value || "";
            executeAiPartSearch(desc);
        });
    }

    const descInput = document.getElementById("aiPartDescription");
    if (descInput) {
        descInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                executeAiPartSearch(descInput.value);
            }
        });
    }

    document.querySelectorAll(".ai-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const query = chip.dataset.query;
            if (descInput) descInput.value = query;
            executeAiPartSearch(query);
        });
    });

    const clearFilterBtn = document.getElementById("aiClearFilterBtn");
    if (clearFilterBtn) {
        clearFilterBtn.addEventListener("click", clearAiCatalogFilter);
    }


}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAiMatcher);
} else {
    initAiMatcher();
}
document.getElementById("proposeButton").addEventListener("click", openProposeModal);
document.getElementById("proposeClose").addEventListener("click", closeProposeModal);
document.getElementById("proposeForm").addEventListener("submit", submitProposal);
document.getElementById("borrowList").addEventListener("click", async event => {
    const row = event.target.closest("[data-borrow-row]");
    if (row) openReceipt(row.dataset.borrowId);
});
["borrowSearch", "borrowStatusFilter", "borrowDateFrom", "borrowDateTo"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderBorrowLogs);
    document.getElementById(id).addEventListener("change", renderBorrowLogs);
});
document.getElementById("receiptClose").addEventListener("click", closeReceipt);
document.getElementById("receiptModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeReceipt(); });
document.getElementById("newRequestButton").addEventListener("click", () => {
    setActiveTab("partProposal");
    setTimeout(() => document.getElementById("partSearch").focus({ preventScroll: true }), 220);
});

document.getElementById("inviteClose").addEventListener("click", () => closeModal("inviteModal"));
document.getElementById("inviteSearch").addEventListener("input", renderSharePicker);
document.getElementById("inviteForm").addEventListener("submit", submitShare);

function openProjectHistoryModal() {
    document.getElementById("projectHistoryToggle").setAttribute("aria-expanded", "true");
    renderProjectHistory(studentArchivedProjects);
    openModal("projectHistoryBackdrop");
}

function closeProjectHistoryModal() {
    document.getElementById("projectHistoryToggle").setAttribute("aria-expanded", "false");
    closeModal("projectHistoryBackdrop");
}

document.getElementById("projectHistoryToggle").addEventListener("click", openProjectHistoryModal);
document.getElementById("projectHistoryClose").addEventListener("click", closeProjectHistoryModal);
["projectHistorySearch", "projectHistoryDateFrom", "projectHistoryDateTo"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => renderProjectHistory(studentArchivedProjects));
    document.getElementById(id).addEventListener("change", () => renderProjectHistory(studentArchivedProjects));
});

document.getElementById("postList").addEventListener("submit", async event => {
    if (event.target.matches(".comment-edit-form")) {
        event.preventDefault();
        const textarea = event.target.querySelector("textarea");
        const body = (textarea?.value || "").trim();
        if (!body) return;
        const commentId = event.target.dataset.commentId;
        const { error } = await supabaseClient.rpc("edit_comment", { p_comment_id: commentId, p_body: body });
        if (error) { showToast(/own comments/i.test(error.message || "") ? "You can only edit your own comments" : "Could not edit that comment"); console.error("Comment edit error:", error); return; }
        showToast("Comment updated");
        return loadAnnouncements();
    }
    if (!event.target.matches(".comment-form")) return;
    event.preventDefault();
    const input = event.target.querySelector("input");
    const body = input.value.trim();
    if (!body) return;
    const postId = event.target.closest("[data-post-id]").dataset.postId;
    if (await onCooldownFromLastComment(input)) return;
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Student";
    const { error } = await supabaseClient.from("announcement_comments").insert({ announcement_id: postId, author_id: currentUser.id, author_name: name, body });
    if (error) { showToast(/slow down/i.test(error.message || "") ? "Please slow down — wait a bit before commenting again" : "Could not add that comment"); return; }
    openCommentPostIds.add(postId);
    await loadAnnouncements();
});

async function onCooldownFromLastComment(input) {
    const since = new Date(Date.now() - 60000).toISOString();
    const { count, error } = await supabaseClient.from("announcement_comments")
        .select("id", { count: "exact", head: true })
        .eq("author_id", currentUser.id)
        .gte("created_at", since);
    if (error) return false;
    if ((count || 0) >= 17) {
        showToast("Please slow down — wait a bit before commenting again");
        input?.focus();
        return true;
    }
    return false;
}

function startCommentEdit(commentEl) {
    const textEl = commentEl.querySelector(".comment-text");
    const actionEl = commentEl.querySelector(".comment-actions");
    const form = document.createElement("form");
    form.className = "comment-edit-form";
    form.dataset.commentId = commentEl.dataset.commentId;
    form.innerHTML = `<textarea maxlength="300" aria-label="Edit your comment">${escapeHtml(textEl.textContent)}</textarea><div class="comment-edit-actions"><button type="submit">Save</button><button type="button" data-comment-action="cancelCommentEdit">Cancel</button></div>`;
    if (textEl) textEl.replaceWith(form);
    if (actionEl) actionEl.remove();
    form.querySelector("textarea").focus();
}

async function refreshDashboard(showMessage = true) {
    if (refreshing) return;
    refreshing = true;
    const button = document.getElementById("refreshButton");
    button?.setAttribute("aria-busy", "true");
    window.OtterLoading?.show();
    try {
        await refreshSimClock();
        renderDashboardDate();
        const activeTab = document.querySelector(".tab-view.active")?.id.replace("View", "") || "overview";
        await Promise.all([
            loadOverviewMetrics(),
            loadDeadlines(),
            loadAnnouncements(),
            loadStudentProjects(),
            activeTab === "partProposal" ? loadInventoryParts() : Promise.resolve(),
            activeTab === "partProposal" ? loadMyProposals() : Promise.resolve(),
            activeTab === "borrowLogs" ? loadBorrowLogs() : Promise.resolve(),
            activeTab === "labTimings" ? loadLabTimings() : Promise.resolve()
        ]);
        if (showMessage) showToast("Dashboard refreshed");
    } catch (error) {
        console.error("Dashboard refresh failed:", error);
        if (showMessage) showToast("Could not refresh dashboard");
    } finally {
        button?.removeAttribute("aria-busy");
        refreshing = false;
        window.OtterLoading?.hide();
    }
}

/* ---------------------------------------------------------------
   Theme. Light is the default; the head script has already applied
   the saved choice, so this only has to flip and persist it.
   --------------------------------------------------------------- */

const THEME_KEY = "otter.student.theme";
const themeMeta = document.querySelector('meta[name="theme-color"]');

function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;

    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#000000" : "#f4f4f0");

    const toggle = document.getElementById("themeToggle");
    if (toggle) {
        const next = theme === "dark" ? "light" : "dark";
        const label = `Switch to ${next} mode`;
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("title", label);
        toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
}

function setTheme(theme) {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* private mode */ }
}

applyTheme(currentTheme());

document.getElementById("themeToggle").addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
});

document.getElementById("refreshButton").addEventListener("click", () => refreshDashboard());
document.getElementById("signOutButton").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
});

function showFatal(message) {
    const main = document.querySelector(".dashboard-main");
    if (!main) return;
    const box = document.createElement("div");
    box.className = "fatal-state";
    box.innerHTML = '<p class="eyebrow">Lab service</p><h2></h2><p>Reload the page to try again.</p>';
    box.querySelector("h2").textContent = message;
    main.replaceChildren(box);
}

/* ---------------- Lab timings (read-only) ---------------- */

let loadLabTimings = async function () {};
let labTimingsPickedNearest = false;

function initLabTimings() {
    const Lab = window.OtterLab;
    if (!Lab) return;

    Lab.init({
        mode: "student",
        supabase: supabaseClient,
        now: clockNow
    });

    const el = id => document.getElementById(id);
    const grid = el("labDayGrid");
    const periodList = el("labPeriodList");
    const summary = el("labDaySummary");
    if (!grid || !periodList) return;

    function render() {
        el("labMonthLabel").textContent = Lab.monthTitle(Lab.state.year, Lab.state.month);

        const stamp = Lab.state.selected;
        if (!stamp) {
            el("labDayTitle").textContent = "No day selected";
            el("labDaySubtitle").textContent = "Pick a date from the calendar.";
            periodList.innerHTML = "";
            summary.hidden = true;
            Lab.renderCalendar(grid);
            return;
        }

        const status = Lab.classifyDay(stamp);
        const numbers = status === Lab.DAY_OPEN ? Lab.openPeriodsFor(stamp) : [];
        const isWeekend = status === Lab.DAY_WEEKEND;
        const isHoliday = status === Lab.DAY_HOLIDAY;

        el("labDayTitle").textContent = Lab.formatLong(stamp);
        el("labDaySubtitle").textContent = isWeekend ? "Weekend — the lab is closed."
            : isHoliday ? `Holiday — ${Lab.state.holidays.get(stamp)}.`
            : status === Lab.DAY_OPEN ? `Lab open · ${Lab.describeOpenPeriods(numbers, Lab.state.periods)}`
            : "No lab on this day.";

        if (isWeekend || isHoliday) {
            summary.hidden = false;
            summary.className = `lab-day-summary is-${status}`;
            summary.innerHTML = `<strong>${isHoliday ? Lab.escapeHtml(Lab.state.holidays.get(stamp)) : "Weekend"}</strong><span>${isHoliday ? "National holiday. The lab is closed all day." : "The lab does not run at the weekend."}</span>`;
            periodList.innerHTML = "";
        } else {
            if (status === Lab.DAY_OPEN) {
                const first = numbers[0];
                const last = numbers[numbers.length - 1];
                const firstRow = Lab.state.periods.find(row => Number(row.period_no) === first);
                const lastRow = Lab.state.periods.find(row => Number(row.period_no) === last);
                summary.hidden = false;
                summary.className = "lab-day-summary is-open";
                summary.innerHTML = `<strong>${Lab.escapeHtml(Lab.describeOpenPeriods(numbers, Lab.state.periods))}</strong><span>${Lab.escapeHtml(Lab.timeRange(firstRow && firstRow.starts_at, lastRow && lastRow.ends_at))}</span>`;
            } else {
                summary.hidden = false;
                summary.className = "lab-day-summary is-closed";
                summary.innerHTML = `<strong>No lab</strong><span>The lab is closed for all nine periods on this day.</span>`;
            }
            Lab.renderPeriodList(periodList, { editable: false, draft: new Set(numbers) });
        }

        const upcoming = Lab.nextLabDay(Lab.todayStamp());
        el("labCalendarHint").textContent = Lab.anyPublished()
            ? `Pick a day to see when the lab is open.${upcoming ? ` Next lab day: ${Lab.formatShort(upcoming)}.` : ""}`
            : "Your teacher has not published any lab timings yet.";

        el("labPrevLabDay").disabled = !Lab.prevLabDay(Lab.state.selected);
        el("labNextLabDay").disabled = !Lab.nextLabDay(Lab.state.selected);

        Lab.renderCalendar(grid);
    }

    function goTo(stamp) {
        if (!stamp) return;
        const parts = Lab.splitStamp(stamp);
        Lab.showMonth(parts.year, parts.month);
        Lab.selectDay(stamp);
        render();
    }

    async function reload() {
        await Lab.loadData();
        if (Lab.state.lastError) {
            console.error("Lab timings error:", Lab.state.lastError);
            grid.innerHTML = `<div class="lab-error">Lab timings could not load. Tell your teacher to run the lab timings SQL migration.</div>`;
            return;
        }
        /* First time in, land on the closest day that actually has lab.
           Once the student picks a day themselves, stop moving it for them. */
        if (!Lab.state.selected || (!labTimingsPickedNearest && !Lab.anyPublished())) {
            const target = Lab.anyPublished() ? Lab.nearestLabDay(Lab.todayStamp()) : Lab.todayStamp();
            const parts = Lab.splitStamp(target);
            Lab.showMonth(parts.year, parts.month);
            Lab.selectDay(target);
            labTimingsPickedNearest = Lab.anyPublished();
        } else if (Lab.state.selected) {
            Lab.selectDay(Lab.state.selected);
        }
        render();
    }

    grid.addEventListener("click", event => {
        const button = event.target.closest("[data-lab-stamp]");
        if (!button) return;
        labTimingsPickedNearest = true;
        Lab.selectDay(button.dataset.labStamp);
        render();
    });

    el("labPrevMonth").addEventListener("click", () => { Lab.moveMonth(-1); render(); });
    el("labNextMonth").addEventListener("click", () => { Lab.moveMonth(1); render(); });
    el("labToday").addEventListener("click", () => goTo(Lab.todayStamp()));
    el("labPrevLabDay").addEventListener("click", () => { const next = Lab.prevLabDay(Lab.state.selected); if (next) goTo(next); });
    el("labNextLabDay").addEventListener("click", () => { const next = Lab.nextLabDay(Lab.state.selected); if (next) goTo(next); });

    loadLabTimings = async function () { await reload(); };
    Lab.subscribe(() => reload());

    reload();
}

async function initialiseDashboard() {
    if (!supabaseClient) {
        showFatal("We could not reach the lab service.");
        return;
    }
    await refreshSimClock();

    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) {
        window.location.href = "index.html";
        return;
    }
    currentUser = user;
    const [banResult, profileResult] = await Promise.all([
        supabaseClient.from("user_bans")
            .select("banned_until, reason")
            .eq("user_id", user.id)
            .gt("banned_until", new Date().toISOString())
            .maybeSingle(),
        supabaseClient.from("profiles")
            .select("student_id, class_name, section")
            .eq("id", user.id)
            .maybeSingle()
    ]);
    const { data: activeBan } = banResult;
    if (activeBan) {
        await supabaseClient.auth.signOut();
        alert(`Your account is restricted until ${new Date(activeBan.banned_until).toLocaleString()}.\nReason: ${activeBan.reason}`);
        window.location.href = "index.html";
        return;
    }
    const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "student";
    currentUser.name = displayName;
    window.OtterFavicon?.apply("student");
    if (profileResult.error) console.warn("Could not load profile details:", profileResult.error.message);
    renderProfileDetails(user, profileResult.data);
    renderDashboardDate();
    document.getElementById("profileName").textContent = displayName;
    document.getElementById("profileAvatar").textContent = initialsFor(displayName);
    window.OtterAccount?.mountActions(document.getElementById("profileActions"), {
        client: supabaseClient,
        variant: "popover",
        signOutHref: "index.html",
        toast: showToast,
        onTutorialNavigate: step => { if (step && step.go) setActiveTab(step.go); }
    });
    initLabTimings();
    setActiveTab("overview");
    if (window.OtterTutorial) {
        if (!window.OtterTutorial.hasSeen("student")) {
            (window.OtterTutorial.showTutorialPrompt || window.showTutorialPrompt)("student", {
                theme: currentTheme(),
                onNavigate: step => { if (step.go) setActiveTab(step.go); }
            });
        } else if (window.OtterTutorial.autostart) {
            OtterTutorial.autostart("student", {
                theme: currentTheme(),
                onNavigate: step => { if (step.go) setActiveTab(step.go); }
            });
        }
    }
    await Promise.all([loadOverviewMetrics(), loadDeadlines(), loadStudentProjects(), loadAnnouncements()]);

    supabaseClient.channel("announcements-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, loadAnnouncements)
        .on("postgres_changes", { event: "*", schema: "public", table: "announcement_likes" }, loadAnnouncements)
        .on("postgres_changes", { event: "*", schema: "public", table: "announcement_comments" }, loadAnnouncements)
        .subscribe();

    supabaseClient.channel("overview-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "part_proposals" }, () => { loadOverviewMetrics(); loadDeadlines(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "project_interests" }, () => { loadOverviewMetrics(); loadDeadlines(); })
        .subscribe();

    supabaseClient.channel("inventory-parts-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "inventory_parts" }, loadInventoryParts)
        .subscribe();

    supabaseClient.channel("my-proposals-feed")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "part_proposals" }, () => { loadMyProposals(); loadBorrowLogs(); loadOverviewMetrics(); })
        .subscribe();

    supabaseClient.channel("student-projects-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "project_proposals" }, () => { loadStudentProjects(); loadDeadlines(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "project_interests" }, () => { loadStudentProjects(); loadDeadlines(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "sim_clock" }, async () => { await refreshSimClock(); renderDashboardDate(); loadDeadlines(); loadBorrowLogs(); })
        .subscribe();

    supabaseClient.channel("noise-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "project_shares" }, () => { loadStudentProjects(); loadDeadlines(); })
        .subscribe();
}

initialiseDashboard()
    .catch(error => console.error("Student dashboard startup failed:", error))
    .finally(() => window.OtterLoading?.hide());
