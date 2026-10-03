// ============================================================
// ALE's AI runs through a Supabase Edge Function (ale-chat) so the
// OpenRouter API key never lives in this file. It powers
// "Organize with AI", the per-part AI usage notes, the restock
// refinement, and the ALE chat.
//
// Deploy once:
//   supabase functions deploy ale-chat
//   supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
// ============================================================
const OPENROUTER_MODEL = "openai/gpt-4o-mini";

const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const toast = message => { const element = document.getElementById("adminToast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 2800); };

const STATUS_META = {
    available: { label: "Available", color: "var(--green)" },
    low: { label: "Low stock", color: "var(--yellow)" },
    reserved: { label: "Reserved", color: "var(--blue)" },
    unavailable: { label: "Unavailable", color: "var(--red)" },
    damaged: { label: "Damaged", color: "var(--red)" }
};

let registryParts = [];
let registryFolders = [];
let partPhotoFile = null;
let editingPhotoUrl = null;
let lastFilteredParts = [];

// File-explorer state: null = root (folder tiles), "__all__" = every part, otherwise a folder name.
const ROOT = null;
const ALL_PARTS = "__all__";
let explorerFolder = ROOT;

// ALE chat state
let aleHistory = [];
let aleBusy = false;
let aleAbortController = null;
let aleActiveHistoryIndex = null;
let aleActiveUserMessage = null;
let alePendingPlan = null;
let aleLastBatch = null;
let alePlanSeq = 0;
const aleSessionFolders = new Set();

function setTab(tab) {
    document.querySelectorAll("[data-admin-tab]").forEach(button => button.classList.toggle("active", button.dataset.adminTab === tab));
    document.querySelectorAll(".admin-view").forEach(view => view.classList.toggle("active", view.id === `${tab}View`));
    const details = {
        registry: ["Parts registry", "Manage the equipment catalog without changing application code."],
        partslog: ["Parts log", "Track every part that is out of the lab and who is holding it."],
        restock: ["Restock planner", "Demand-driven reorder list with a supplier-ready receipt."],
        clock: ["Test clock", "Simulate \"today\" to test overdue notices without waiting."]
    };
    const tabDetails = details[tab] || ["Admin console", "Manage the Otter workspace."];
    document.getElementById("adminTitle").textContent = tabDetails[0];
    document.getElementById("adminDescription").textContent = tabDetails[1];
    if (tab === "partslog") {
        if (!borrowRowsLoaded) loadPartsLog();
        else renderPartsLog();
    }
    if (tab === "restock") {
        if (restockPlan) renderRestockResult();
        else runRestockAnalysis();
    }
}

async function requireAdmin() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = "admin-login.html"; return null; }
    const { data: isAdmin, error } = await supabaseClient.rpc("is_admin");
    if (error || !isAdmin) { await supabaseClient.auth.signOut(); window.location.href = "admin-login.html"; return null; }
    window.OtterFavicon?.apply("admin");
    document.getElementById("adminIdentity").textContent = user.email || "Admin";
    window.OtterAccount?.mount({
        client: supabaseClient,
        triggerId: "adminIdentity",
        popoverId: "adminAccountPopover",
        variant: "sidebar",
        label: "Admin",
        name: user.user_metadata?.full_name || user.email || "Admin",
        email: user.email,
        signOutHref: "admin-login.html",
        toast
    });
    document.getElementById("adminDate").textContent = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    return user;
}

// ============================================================
// Registry
// ============================================================

function effectiveStatus(part) {
    const qty = Number(part.quantity) || 0;
    if (qty <= 0 && part.status === "available") return "unavailable";
    return part.status || "available";
}

function folderOf(part) {
    return (part.category || "").trim() || "Uncategorized";
}

function statusDot(status) {
    const meta = STATUS_META[status] || STATUS_META.available;
    return `<span class="status-dot" style="background:${meta.color}" title="${escapeHtml(meta.label)}"></span>`;
}

function allFolderNames() {
    const names = new Set(registryFolders);
    registryParts.forEach(part => names.add(folderOf(part)));
    names.delete("Uncategorized");
    return [...names].sort((a, b) => a.localeCompare(b));
}

function folderCounts() {
    const counts = new Map();
    registryFolders.forEach(name => counts.set(name, 0));
    registryParts.forEach(part => {
        const name = folderOf(part);
        counts.set(name, (counts.get(name) || 0) + 1);
    });
    return counts;
}

function renderTree() {
    const tree = document.getElementById("registryTree");
    const counts = folderCounts();
    const folderNames = allFolderNames();
    if (counts.has("Uncategorized")) folderNames.push("Uncategorized");
    const nav = (value, label, icon, count) => `<button class="tree-item${explorerFolder === value ? " active" : ""}" data-folder-nav="${escapeHtml(value)}" type="button"><span class="tree-name">${icon}&hairsp;${escapeHtml(label)}</span><span class="tree-count">${count}</span></button>`;
    tree.innerHTML = `<div class="registry-tree-head">Folders</div>`
        + nav(ALL_PARTS, "All parts", "▦", registryParts.length)
        + folderNames.map(name => `<div class="tree-row">${nav(name, name, "▸", counts.get(name) || 0)}${name === "Uncategorized" ? "" : `<button class="tree-del" data-folder-delete="${escapeHtml(name)}" type="button" title="Delete folder" aria-label="Delete folder ${escapeHtml(name)}">&times;</button>`}</div>`).join("");
    tree.querySelectorAll("[data-folder-nav]").forEach(button => button.addEventListener("click", () => {
        const value = button.dataset.folderNav;
        explorerFolder = value === ALL_PARTS ? ALL_PARTS : value;
        document.getElementById("registrySearch").value = "";
        updateRegistry();
    }));
    tree.querySelectorAll("[data-folder-delete]").forEach(button => button.addEventListener("click", event => {
        event.stopPropagation();
        deleteFolder(button.dataset.folderDelete);
    }));
}

function renderBreadcrumb() {
    const el = document.getElementById("registryBreadcrumb");
    if (explorerFolder === ROOT || explorerFolder === ALL_PARTS) {
        el.innerHTML = `<span>All parts</span>`;
        return;
    }
    el.innerHTML = `<button type="button" data-crumb-root>All parts</button><span class="crumb-sep">/</span><strong>${escapeHtml(explorerFolder)}</strong><button class="registry-up" type="button" data-crumb-root>↑ Up</button>`;
    el.querySelector("[data-crumb-root]").addEventListener("click", () => { explorerFolder = ROOT; document.getElementById("registrySearch").value = ""; updateRegistry(); });
}

function populateFolderDatalist() {
    document.getElementById("folderOptions").innerHTML = allFolderNames().map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function searchHaystack(part) {
    return `${part.name} ${part.part_code || ""} ${part.serial_number || ""} ${folderOf(part)} ${part.location || ""}`.toLowerCase();
}

// Plain text searches name / part ID / serial / folder / location.
// A path search starting with "/" locates a file-explorer style path:
//   /Resistors          -> everything in a folder whose name matches
//   /Resistors/330      -> that folder, then "330" inside the part fields
function searchMatcher(raw) {
    const query = (raw || "").trim();
    if (!query) return null;
    if (query.startsWith("/")) {
        const segments = query.replace(/^\/+/, "").split("/").map(segment => segment.trim().toLowerCase()).filter(Boolean);
        if (!segments.length) return null;
        if (segments.length === 1) {
            const token = segments[0];
            return part => folderOf(part).toLowerCase().includes(token) || searchHaystack(part).includes(token);
        }
        const folderQuery = segments.slice(0, -1).join(" ");
        const nameQuery = segments[segments.length - 1];
        return part => folderOf(part).toLowerCase().includes(folderQuery) && searchHaystack(part).includes(nameQuery);
    }
    const tokens = query.toLowerCase().split(/\s+/);
    return part => tokens.every(token => searchHaystack(part).includes(token));
}

function filteredParts() {
    const matcher = searchMatcher(document.getElementById("registrySearch").value);
    const scopedFolder = document.getElementById("registrySearch").value.trim() ? ROOT : explorerFolder;
    const statusFilter = document.getElementById("registryStatusFilter").value;
    return registryParts.filter(part => {
        if (scopedFolder && scopedFolder !== ALL_PARTS && folderOf(part) !== scopedFolder) return false;
        if (statusFilter && effectiveStatus(part) !== statusFilter) return false;
        if (matcher && !matcher(part)) return false;
        return true;
    });
}

function updateRegistry() {
    lastFilteredParts = filteredParts();
    document.getElementById("registrySearchClear").hidden = !document.getElementById("registrySearch").value;
    renderTree();
    renderBreadcrumb();
    renderRegistry();
}

async function loadInventory() {
    const [partsResult, foldersResult] = await Promise.all([
        supabaseClient.from("inventory_parts").select("id, part_code, serial_number, photo_url, name, category, manual_category, ai_category, quantity, status, location, notes, ai_use, updated_at").order("name"),
        supabaseClient.from("part_folders").select("name").order("name")
    ]);
    if (partsResult.error) { document.getElementById("inventoryList").innerHTML = `<div class="empty-admin">No registry available until the admin migration is run.</div>`; return; }
    registryParts = partsResult.data || [];
    registryFolders = (foldersResult.data || []).map(row => row.name);
    if (explorerFolder && explorerFolder !== ALL_PARTS && !allFolderNames().includes(explorerFolder) && !registryParts.some(part => folderOf(part) === explorerFolder)) explorerFolder = ROOT;
    populateFolderDatalist();
    updateRegistry();
}

function renderRegistry() {
    const listEl = document.getElementById("inventoryList");
    const query = document.getElementById("registrySearch").value.trim();
    const statusFilter = document.getElementById("registryStatusFilter").value;
    const isFiltering = !!query || !!statusFilter;
    const browsingRoot = !isFiltering && explorerFolder === ROOT;

    if (!registryParts.length) {
        listEl.innerHTML = `<div class="empty-state-block"><span class="empty-icon">▦</span><strong>No parts yet</strong><p>Add your first component and ALE can keep it organised for you.</p><button class="action-button" data-empty-add type="button">＋&hairsp;Add a part</button></div>`;
        listEl.querySelector("[data-empty-add]").addEventListener("click", () => openPartModal(null));
        return;
    }

    const parts = lastFilteredParts;

    if (browsingRoot) {
        const tiles = folderTiles();
        const orphans = registryParts.filter(part => folderOf(part) === "Uncategorized");
        listEl.innerHTML = tiles + (orphans.length
            ? `<div class="folder-block"><div class="folder-head" data-folder-name="Uncategorized"><strong>Uncategorized</strong><span>${orphans.length} part${orphans.length === 1 ? "" : "s"}</span></div><div class="parts-grid">${orphans.map(part => partCard(part, false)).join("")}</div></div>`
            : "") + (!tiles && !orphans.length ? `<div class="empty-state-block"><span class="empty-icon">▸</span><strong>No folders yet</strong><p>Create a folder or add a part to get started.</p></div>` : "");
        wireFolderHeads(listEl, query);
        return;
    }

    if (!parts.length) {
        listEl.innerHTML = (query || statusFilter)
            ? `<div class="empty-state-block"><span class="empty-icon">⌕</span><strong>Nothing found</strong><p>Try a different search or clear the filters.</p></div>`
            : `<div class="empty-state-block"><span class="empty-icon">▸</span><strong>This folder is empty</strong><p>Move parts here or ask ALE to reorganise.</p></div>`;
        return;
    }

    const groups = new Map();
    parts.forEach(part => {
        const folder = folderOf(part);
        if (!groups.has(folder)) groups.set(folder, []);
        groups.get(folder).push(part);
    });

    const ordered = [...groups.entries()].sort((a, b) => {
        if (a[0] === "Uncategorized") return 1;
        if (b[0] === "Uncategorized") return -1;
        return a[0].localeCompare(b[0]);
    });

    listEl.innerHTML = ordered.map(([folder, folderParts]) => `
        <div class="folder-block">
            <div class="folder-head" data-folder-name="${escapeHtml(folder)}" title="Open ${escapeHtml(folder)}"><strong>${escapeHtml(folder)}</strong><span>${folderParts.length} part${folderParts.length === 1 ? "" : "s"}${folderParts.length ? ` · ${folderParts.reduce((sum, part) => sum + (Number(part.quantity) || 0), 0)} units` : ""}</span></div>
            ${folderParts.length ? `<div class="parts-grid">${folderParts.map(part => partCard(part, !!query)).join("")}</div>` : `<div class="folder-empty">Empty folder</div>`}
        </div>`).join("");

    wireFolderHeads(listEl, query);

    if (query && parts.length <= 2) {
        const target = listEl.querySelector(".part-card");
        if (target) {
            target.classList.add("located");
            target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }
}

function folderTiles() {
    const counts = folderCounts();
    const names = allFolderNames();
    if (!names.length) return "";
    return `<div class="folder-tiles">${names.map(name => `
        <button class="folder-tile" data-folder-open="${escapeHtml(name)}" type="button">
            <span class="tile-icon">▸</span>
            <span><span class="tile-name">${escapeHtml(name)}</span><span class="tile-count">${counts.get(name) || 0} item${(counts.get(name) || 0) === 1 ? "" : "s"}</span></span>
        </button>`).join("")}</div>`;
}

function wireFolderHeads(listEl, query) {
    listEl.querySelectorAll("[data-folder-open]").forEach(tile => tile.addEventListener("click", () => {
        explorerFolder = tile.dataset.folderOpen;
        document.getElementById("registrySearch").value = "";
        updateRegistry();
    }));
    listEl.querySelectorAll("[data-folder-name]").forEach(head => head.addEventListener("click", () => {
        explorerFolder = head.dataset.folderName;
        document.getElementById("registrySearch").value = "";
        updateRegistry();
    }));
}

function partCard(part, highlight) {
    const status = effectiveStatus(part);
    const photo = part.photo_url ? `<img src="${escapeHtml(part.photo_url)}" alt="${escapeHtml(part.name)}" referrerpolicy="no-referrer" loading="lazy">` : `<div class="part-thumb-placeholder">O</div>`;
    const serial = part.serial_number ? `<span>Serial <b>${escapeHtml(part.serial_number)}</b></span>` : "";
    return `<article class="part-card${highlight ? " search-hit" : ""}" data-part-id="${escapeHtml(part.id)}" role="button" tabindex="0" title="View ${escapeHtml(part.name)} details">
        <div class="part-thumb">${photo}</div>
        <div class="part-card-body">
            <div class="part-card-top">
                <strong>${escapeHtml(part.name)}</strong>
                ${statusDot(status)}
            </div>
            <div class="part-code">${escapeHtml(part.part_code || "—")}</div>
            <div class="part-meta"><span>Qty <b>${Number(part.quantity) || 0}</b></span>${serial}</div>
        </div>
    </article>`;
}

function openPartDetail(part) {
    const status = effectiveStatus(part);
    const nameEl = document.getElementById("detailPartName");
    nameEl.textContent = part.name;
    const body = document.getElementById("partDetailBody");
    const photo = part.photo_url ? `<img src="${escapeHtml(part.photo_url)}" alt="${escapeHtml(part.name)}" referrerpolicy="no-referrer">` : `<div class="detail-photo detail-photo-empty">No picture added</div>`;
    const aiUse = part.ai_use ? `<div class="ai-use"><p>${escapeHtml(part.ai_use)}</p><button class="quiet-button" data-ai-part type="button">Regenerate with AI</button></div>` : `<div class="ai-use"><p class="ai-empty">AI hasn't described this part yet.</p><button class="quiet-button" data-ai-part type="button">Ask AI what it's for</button></div>`;
    body.innerHTML = `
        <div class="detail-grid">
            <div class="detail-photo">${photo}</div>
            <div class="detail-info">
                <div class="detail-row"><span>Part ID</span><code>${escapeHtml(part.part_code || "—")}</code></div>
                <div class="detail-row"><span>Status</span><strong class="status-text" style="color:${(STATUS_META[status] || STATUS_META.available).color}">${escapeHtml((STATUS_META[status] || STATUS_META.available).label)}</strong></div>
                <div class="detail-row"><span>Quantity</span><strong>${Number(part.quantity) || 0}</strong></div>
                <div class="detail-row"><span>Serial number</span><strong>${escapeHtml(part.serial_number || "—")}</strong></div>
                <div class="detail-row"><span>Folder</span><strong>${escapeHtml((part.category || "").trim() || "Uncategorized")}</strong></div>
                <div class="detail-row"><span>Location</span><strong>${escapeHtml(part.location || "—")}</strong></div>
            </div>
        </div>
        <div class="ai-block"><div class="ai-block-head"><span>✦&hairsp; AI usage notes</span></div>${aiUse}</div>
        <div class="modal-actions"><button class="quiet-button" data-edit-part type="button">Edit part</button><button class="danger-button" data-delete-part type="button">Remove part</button></div>`;
    document.getElementById("partDetailBackdrop").hidden = false;
    body.querySelector("[data-ai-part]").addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Asking AI…";
        try {
            const info = await describePartWithAI(part);
            await supabaseClient.from("inventory_parts").update({ ai_use: info, status: part.status }).eq("id", part.id);
            part.ai_use = info;
            openPartDetail(part);
        } catch (error) {
            console.error(error);
            toast("AI could not describe this part — check your OpenRouter key");
            button.disabled = false;
            button.textContent = "Ask AI what it's for";
        }
    });
    body.querySelector("[data-edit-part]").addEventListener("click", () => { document.getElementById("partDetailBackdrop").hidden = true; openPartModal(part); });
    body.querySelector("[data-delete-part]").addEventListener("click", async () => {
        if (!confirm(`Remove "${part.name}" (${part.part_code || "no id"}) from the registry?`)) return;
        const { error } = await supabaseClient.from("inventory_parts").delete().eq("id", part.id);
        if (error) { toast("Could not remove this part"); return; }
        if (part.photo_url) {
            const path = part.photo_url.split("/part-photos/")[1];
            if (path) await supabaseClient.storage.from("part-photos").remove([path]);
        }
        document.getElementById("partDetailBackdrop").hidden = true;
        await loadInventory();
        toast("Part removed");
    });
}

function openPartModal(part) {
    document.getElementById("partModalTitle").textContent = part ? `Edit · ${escapeHtml(part.part_code || "")}` : "Add part";
    document.getElementById("partId").value = part ? part.id : "";
    document.getElementById("partName").value = part ? part.name : "";
    document.getElementById("partCategory").value = part ? (part.manual_category || part.category || "") : "";
    document.getElementById("partSerial").value = part ? (part.serial_number || "") : "";
    document.getElementById("partQuantity").value = part ? part.quantity : 1;
    document.getElementById("partStatus").value = part ? (part.status || "available") : "available";
    document.getElementById("partLocation").value = part ? (part.location || "Lab storage") : "Lab storage";
    document.getElementById("partPhoto").value = "";
    populateFolderDatalist();
    partPhotoFile = null;
    editingPhotoUrl = part ? part.photo_url : null;
    const preview = document.getElementById("partPhotoPreview");
    preview.hidden = true;
    preview.innerHTML = "";
    if (editingPhotoUrl) {
        preview.innerHTML = `<img src="${escapeHtml(editingPhotoUrl)}" alt="Current picture" referrerpolicy="no-referrer"><span>Current picture</span>`;
        preview.hidden = false;
    }
    document.getElementById("partModalBackdrop").hidden = false;
}

function closePartModal() {
    document.getElementById("partModalBackdrop").hidden = true;
    document.getElementById("partPhotoPreview").hidden = true;
}

// ============================================================
// OpenRouter AI
// ============================================================

function aleAbortError() {
    const error = new Error("ALE response interrupted");
    error.name = "AbortError";
    return error;
}

function throwIfAleAborted(signal) {
    if (signal?.aborted) throw aleAbortError();
}

function waitForAleRetry(waitMs, signal) {
    return new Promise((resolve, reject) => {
        throwIfAleAborted(signal);
        const timeout = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, waitMs);
        const abort = () => {
            clearTimeout(timeout);
            reject(aleAbortError());
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

async function openRouterRequest(messages, extra = {}, onStatus = null, signal = null) {
    const token = (await supabaseClient.auth.getSession()).data.session?.access_token;
    throwIfAleAborted(signal);
    if (!token) throw new Error("not-signed-in");
    const attempts = 4;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/ale-chat`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: OPENROUTER_MODEL, messages, temperature: 0.3, ...extra }),
            signal: signal || undefined
        });
        if (response.ok) {
            const payload = await response.json();
            const message = payload.message;
            if (!message) throw new Error("Empty AI response");
            return message;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === attempts - 1) {
            if (response.status === 429) throw new Error("rate-limited");
            throw new Error(`OpenRouter ${response.status}`);
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1400 * (attempt + 1);
        if (onStatus) onStatus(waitMs);
        await waitForAleRetry(waitMs, signal);
    }
    throw new Error("OpenRouter unavailable");
}

async function callOpenRouter(messages) {
    const message = await openRouterRequest(messages);
    const content = (message.content || "").trim();
    if (!content) throw new Error("Empty AI response");
    return content;
}

function stripJsonFence(text) {
    return text.replace(/^```(?:json)?\s*/, "").replace(/```$/, "").trim();
}

async function describePartWithAI(part) {
    const prompt = [
        "You are a robotics lab assistant. Briefly explain what this spare part is used for,",
        "in one or two plain sentences. Include any handling or storage tips if relevant. Do not use markdown.",
        "",
        `Part name: ${part.name}`,
        part.serial_number ? `Serial number: ${part.serial_number}` : `Serial number: not recorded`,
        `Category: ${part.category || "unassigned"}`
    ].join("\n");
    const result = await callOpenRouter([{ role: "system", content: "You give short, practical hardware explanations." }, { role: "user", content: prompt }]);
    return result.replace(/\n{2,}/g, "\n").replace(/^[#*\->\s]+/gm, "").trim();
}

// ============================================================
// ALE — the lab assistant chat
// ============================================================

const ALE_TOOLS = [
    {
        type: "function",
        function: {
            name: "registry_overview",
            description: "Get totals for the parts registry: counts per status, low-stock items, folders with item counts, and the most-borrowed parts.",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "list_parts",
            description: "List parts with their folder, quantity, status, location and ID. Optionally filter by folder, status, or a text query.",
            parameters: {
                type: "object",
                properties: {
                    folder: { type: "string", description: "Folder/category name to filter by" },
                    status: { type: "string", description: "available | low | reserved | unavailable | damaged" },
                    query: { type: "string", description: "Free text to match against name, ID, serial or location" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_borrows",
            description: "See who borrowed which parts and when they are due. Can filter to a single part and to currently-active loans.",
            parameters: {
                type: "object",
                properties: {
                    part: { type: "string", description: "Part name or ID to look up" },
                    active_only: { type: "boolean", description: "Only loans that are out or overdue" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_part",
            description: "Change a part's quantity or status. Use this when the admin explicitly asks to change stock. Applies immediately.",
            parameters: {
                type: "object",
                properties: {
                    part: { type: "string", description: "Part name or ID" },
                    quantity: { type: "number", description: "New quantity" },
                    status: { type: "string", enum: ["available", "low", "reserved", "unavailable", "damaged"] }
                },
                required: ["part"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_folder",
            description: "Create a new empty folder in the registry.",
            parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }
        }
    },
    {
        type: "function",
        function: {
            name: "move_parts",
            description: "Propose moving parts into folders. This only shows the admin an approval card — nothing changes until they press Apply. Always use this for organising, never assume it was applied.",
            parameters: {
                type: "object",
                properties: {
                    moves: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                part: { type: "string", description: "Part name or ID" },
                                folder: { type: "string", description: "Destination folder name" }
                            },
                            required: ["part", "folder"]
                        }
                    }
                },
                required: ["moves"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "restock_plan",
            description: "Compute the demand-driven restock plan with real per-part numbers (demand rate, safety stock, target, free stock, order quantity, tier). Use this to explain the restock algorithm and why a part is or isn't ordered.",
            parameters: {
                type: "object",
                properties: {
                    top_only: { type: "boolean", description: "Return just the order list (defaults to false: includes monitor + top demand too)" }
                },
                required: []
            }
        }
    }
];

const ALE_SUGGESTIONS = [
    "Which parts are running low?",
    "What's borrowed right now, and who has it?",
    "Which parts do we use the most?",
    "How many resistors do we have left?",
    "Explain how the restock planner works",
    "Organize the registry into folders"
];

function aleSystemPrompt() {
    return [
        "You are ALE, the Otter Lab assistant embedded in the admin console.",
        "You help the admin understand and manage the robotics parts registry and the student borrowing records.",
        "Use the tools to look up real data — never guess numbers. Keep replies short and concrete.",
        "When the admin asks you to organise or regroup the registry, call move_parts with a full plan.",
        "move_parts only shows an approval card; do not claim the registry changed until the admin approves it.",
        "You may change quantities with update_part when the admin clearly asks.",
        "Restocking tab: call restock_plan to pull the live plan, then explain it in simple words.",
        "The restock algorithm: (1) estimate each part's monthly demand from real borrow history, weighing recent borrows more than old ones — parts with no borrowing get zero demand; (2) add a safety buffer sized to the chosen service level; (3) need = demand over lead time + demand over review period + safety buffer; (4) free stock = registry quantity on hand minus units borrowed out minus weighted pending requests; (5) order only pays for the part if projected need exceeds free stock, otherwise nothing is ordered — that is why a part may show no order.",
        "Field walkthrough when the admin asks: demand/mo is units used per month; out is units currently loaned to students; pend is weighted pending requests; safety is the extra buffer; need is the total target units; free is what is left after removals; order qty is need minus free (only when positive).",
        `Today is ${new Date().toDateString()}.`
    ].join(" ");
}

function findPart(reference) {
    const needle = String(reference || "").trim().toLowerCase();
    if (!needle) return null;
    return registryParts.find(part => part.id === reference)
        || registryParts.find(part => (part.part_code || "").toLowerCase() === needle)
        || registryParts.find(part => (part.name || "").toLowerCase() === needle)
        || registryParts.find(part => (part.name || "").toLowerCase().includes(needle))
        || registryParts.find(part => (part.part_code || "").toLowerCase().includes(needle));
}

async function fetchBorrowRows() {
    const { data, error } = await supabaseClient.from("part_proposals")
        .select("id, student_name, student_class_name, student_section, reason, duration_days, items, status, lent_at, due_at, returned_at, created_at")
        .order("created_at", { ascending: false })
        .limit(400);
    if (error) throw error;
    return data || [];
}

function borrowState(row, now) {
    if (row.returned_at) return "returned";
    if (row.due_at && new Date(row.due_at) < now) return "overdue";
    if (row.lent_at) return "out";
    return row.status || "pending";
}

function runRegistryOverview() {
    const counts = { available: 0, low: 0, reserved: 0, unavailable: 0, damaged: 0 };
    const lowStock = [];
    registryParts.forEach(part => {
        const status = effectiveStatus(part);
        counts[status] = (counts[status] || 0) + 1;
        if (status === "low" || (Number(part.quantity) || 0) <= 2) lowStock.push({ name: part.name, part_code: part.part_code, quantity: Number(part.quantity) || 0 });
    });
    const folders = allFolderNames().map(name => ({ folder: name, items: registryParts.filter(part => folderOf(part) === name).length }));
    return { total_parts: registryParts.length, total_units: registryParts.reduce((sum, part) => sum + (Number(part.quantity) || 0), 0), status_counts: counts, low_stock: lowStock, folders };
}

function runListParts(args) {
    let parts = registryParts.slice();
    if (args.folder) parts = parts.filter(part => folderOf(part).toLowerCase().includes(String(args.folder).toLowerCase()));
    if (args.status) parts = parts.filter(part => effectiveStatus(part) === args.status);
    if (args.query) {
        const matcher = searchMatcher(String(args.query));
        if (matcher) parts = parts.filter(matcher);
    }
    return {
        count: parts.length,
        parts: parts.slice(0, 80).map(part => ({ id: part.id, name: part.name, code: part.part_code, folder: folderOf(part), quantity: Number(part.quantity) || 0, status: effectiveStatus(part), location: part.location || "" }))
    };
}

async function runGetBorrows(args) {
    const now = new Date();
    let rows = await fetchBorrowRows();
    const target = args.part ? findPart(args.part) : null;
    const needle = args.part ? String(args.part).toLowerCase() : "";
    const records = [];
    rows.forEach(row => {
        const items = Array.isArray(row.items) ? row.items : [];
        items.forEach(item => {
            const matches = target ? item.id === target.id : (!needle || (item.name || "").toLowerCase().includes(needle));
            if (!matches) return;
            const state = borrowState(row, now);
            if (args.active_only && (state === "returned" || state === "pending")) return;
            records.push({
                part: item.name, part_id: item.id, quantity: item.quantity,
                student: row.student_name, class: row.student_class_name || "", section: row.student_section || "",
                state, lent_at: row.lent_at, due_at: row.due_at, returned_at: row.returned_at, reason: row.reason
            });
        });
    });
    return { count: records.length, records: records.slice(0, 80) };
}

async function runUpdatePart(args, signal) {
    const part = findPart(args.part);
    if (!part) return { error: `No part matches "${args.part}"` };
    const patch = {};
    if (args.quantity !== undefined) patch.quantity = Math.max(0, Number(args.quantity) || 0);
    if (args.status) patch.status = args.status;
    if (!Object.keys(patch).length) return { error: "Nothing to update" };
    patch.updated_at = new Date().toISOString();
    const { error } = await supabaseClient.from("inventory_parts").update(patch).eq("id", part.id).abortSignal(signal);
    if (error) return { error: error.message };
    throwIfAleAborted(signal);
    await loadInventory();
    return { updated: part.name, ...patch };
}

async function runCreateFolder(args, signal) {
    const name = String(args.name || "").trim();
    if (!name) return { error: "Folder name is required" };
    if (registryFolders.includes(name)) return { error: "That folder already exists" };
    const user = (await supabaseClient.auth.getUser()).data.user;
    throwIfAleAborted(signal);
    const { error } = await supabaseClient.from("part_folders").insert({ name, created_by: user ? user.id : null }).abortSignal(signal);
    if (error) return { error: error.message };
    throwIfAleAborted(signal);
    aleSessionFolders.add(name);
    await loadInventory();
    return { created: name };
}

function runMoveParts(args) {
    const moves = Array.isArray(args.moves) ? args.moves : [];
    const plan = [];
    moves.forEach(move => {
        const part = findPart(move.part);
        const folder = String(move.folder || "").trim();
        if (!part || !folder) return;
        if (folderOf(part) === folder) return;
        plan.push({ id: part.id, name: part.name, from: folderOf(part), to: folder });
    });
    if (!plan.length) return { proposal: "empty", note: "No parts would actually move." };
    alePendingPlan = plan;
    renderAleProposal(plan);
    return { proposal: "shown", pending: plan.length, note: "An approval card is now visible to the admin. Do not claim it is done." };
}

async function runAleTool(name, args, signal) {
    switch (name) {
        case "registry_overview": return runRegistryOverview();
        case "list_parts": return runListParts(args || {});
        case "get_borrows": return await runGetBorrows(args || {});
        case "update_part": return await runUpdatePart(args || {}, signal);
        case "create_folder": return await runCreateFolder(args || {}, signal);
        case "move_parts": return runMoveParts(args || {});
        case "restock_plan": return await runRestockPlanTool(args || {});
        default: return { error: `Unknown tool ${name}` };
    }
}

function parseToolArguments(raw) {
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

async function runRestockPlanTool(args) {
    await loadInventory();
    if (!borrowRowsLoaded) await loadPartsLog();
    const params = restockParamsFromForm();
    const items = buildRestockPlan(params);
    const z = RESTOCK_Z[params.serviceLevel] || 1.65;
    const pick = m => ({
        id: m.id, name: m.name, code: m.code, category: m.category,
        on_hand: m.onHand, units_out: m.unitsOut, pending_weighted: Math.round(m.pendingWeighted * 10) / 10,
        demand_per_month: Math.round(m.demandRate * 10) / 10,
        units_lent_90d: m.recent90, last_borrowed: m.lastBorrowed ? m.lastBorrowed.toISOString() : null,
        safety_stock: Math.round(m.safety * 10) / 10, target_need: Math.round(m.target * 10) / 10,
        free_stock: Math.round(m.free * 10) / 10, order_qty: m.orderQty, tier: m.tier
    });
    return {
        params,
        to_order: items.filter(m => m.tier === "critical" || (m.tier === "order" && m.orderQty > 0)).map(pick),
        monitor: args.top_only ? [] : items.filter(m => m.tier === "monitor").map(pick),
        top_demand: args.top_only ? [] : items.filter(m => m.lentEvents > 0).sort((a, b) => b.demandRate - a.demandRate).slice(0, 8).map(pick),
        algorithm: {
            demand_rate: "Units used per month, from real borrow activity in the lookback window (recency-weighted: ~50% last 30 days, ~30% the 30-60 day band, ~20% the 60-90 day band). Zero if a part was never borrowed.",
            safety_stock: `Extra buffer to absorb random spikes: z-score ${z} for the ${params.serviceLevel}% service level times sqrt(demand during the supplier lead time). Only added when there is real demand.`,
            target: "Total units the lab needs during the period = demand over supplier lead time + demand over the review period + safety stock.",
            free_stock: "Registry quantity on hand minus units currently borrowed out minus weighted pending requests (approved count ~100%, standby ~60%, pending ~35%).",
            order_qty: "Rounded-up target minus free stock. A part is ordered only when that is positive (usage outpaces what is left).",
            tiers: "critical = requests already exceed on-hand stock · order = projected to run short in the window · monitor = getting close but still covered · none = no demand or plenty of stock."
        }
    };
}

function addAleMessage(role, text, options = {}) {
    const messages = document.getElementById("aleMessages");
    const el = document.createElement("div");
    el.className = `ale-msg ${role}`;
    if (role === "user" && options.editable) {
        el.dataset.historyIndex = options.historyIndex;
        const span = document.createElement("span");
        span.className = "ale-msg-text";
        span.textContent = text;
        const edit = document.createElement("button");
        edit.className = "ale-edit";
        edit.type = "button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => beginEditUserMessage(el));
        el.append(span, edit);
    } else {
        el.textContent = text;
    }
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
}

function beginEditUserMessage(el) {
    if (aleBusy) { toast("Wait for ALE to finish first"); return; }
    const index = Number(el.dataset.historyIndex);
    const text = el.querySelector(".ale-msg-text").textContent;
    aleHistory = aleHistory.slice(0, index);
    alePendingPlan = null;
    let node = el;
    while (node) { const next = node.nextElementSibling; node.remove(); node = next; }
    const input = document.getElementById("aleInput");
    input.value = text;
    input.focus();
    input.setSelectionRange(text.length, text.length);
    if (!aleHistory.some(entry => entry.role === "system")) aleHistory.unshift({ role: "system", content: aleSystemPrompt() });
    if (!document.getElementById("aleSuggestions").children.length) renderAleSuggestions();
}

function showAleThinking(label = "ALE is thinking…") {
    clearAleThinking();
    const messages = document.getElementById("aleMessages");
    const el = document.createElement("div");
    el.className = "ale-thinking";
    el.dataset.thinking = "1";
    el.innerHTML = `<span class="dots"><span></span><span></span><span></span></span><span class="ale-thinking-text">${escapeHtml(label)}</span>`;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
}

function updateAleThinking(label) {
    const el = document.querySelector("#aleMessages .ale-thinking-text");
    if (el) el.textContent = label;
}

function clearAleThinking() {
    document.querySelectorAll("#aleMessages [data-thinking]").forEach(el => el.remove());
}

function renderAleSuggestions() {
    const el = document.getElementById("aleSuggestions");
    el.innerHTML = ALE_SUGGESTIONS.map(text => `<button type="button" data-ale-suggest="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("");
    el.querySelectorAll("[data-ale-suggest]").forEach(button => button.addEventListener("click", () => {
        document.getElementById("aleInput").value = button.dataset.aleSuggest;
        sendAleMessage(button.dataset.aleSuggest);
    }));
}

function renderAleWelcome() {
    const messages = document.getElementById("aleMessages");
    const el = document.createElement("div");
    el.className = "ale-welcome";
    el.innerHTML = `
        <span class="ale-welcome-mark">✦</span>
        <strong>Hi, I'm ALE</strong>
        <p>Your lab assistant. I can look through the registry, check what's low, see who has what borrowed, change quantities, and tidy parts into folders.</p>
        <ul>
            <li>Ask me anything about parts or loans</li>
            <li>Say "tidy up the registry" and I'll draft a plan for you to approve</li>
            <li>Nothing changes until you press Apply</li>
        </ul>`;
    messages.appendChild(el);
}

function openAlePanel() {
    const panel = document.getElementById("alePanel");
    if (!panel.hidden) return;
    panel.hidden = false;
    if (!document.getElementById("aleMessages").children.length) {
        renderAleWelcome();
        renderAleSuggestions();
    }
    document.getElementById("aleInput").focus();
}

function closeAlePanel() {
    document.getElementById("alePanel").hidden = true;
}

async function sendAleMessage(text, options = {}) {
    const message = String(text || "").trim();
    if (!message || aleBusy) return;
    openAlePanel();
    document.getElementById("aleSuggestions").innerHTML = "";
    document.getElementById("aleInput").value = "";
    if (!aleHistory.some(entry => entry.role === "system")) aleHistory.unshift({ role: "system", content: aleSystemPrompt() });
    const historyIndex = aleHistory.length;
    aleHistory.push({ role: "user", content: options.organize
        ? "Organise the entire parts registry into sensible lab folders. Call move_parts with a plan covering every part, so I can review it before anything changes."
        : message });
    aleActiveHistoryIndex = historyIndex;
    aleActiveUserMessage = addAleMessage("user", message, { editable: true, historyIndex });

    aleBusy = true;
    const controller = new AbortController();
    aleAbortController = controller;
    setAleComposerBusy(true);
    showAleThinking();
    try {
        await aleRespond(controller.signal);
    } catch (error) {
        if (error.name === "AbortError") return;
        console.error(error);
        if (error.message === "not-signed-in") addAleMessage("error", "Sign in again to wake ALE up.");
        else if (error.message === "rate-limited") addAleMessage("error", "OpenRouter is rate-limiting right now. Wait a few seconds and try again — or switch OPENROUTER_MODEL to a paid/less busy model.");
        else addAleMessage("error", `ALE hit a problem: ${error.message}`);
    } finally {
        if (aleAbortController === controller) {
            clearAleThinking();
            aleBusy = false;
            aleAbortController = null;
            aleActiveHistoryIndex = null;
            aleActiveUserMessage = null;
            setAleComposerBusy(false);
        }
    }
}

function setAleComposerBusy(isBusy) {
    document.getElementById("aleStopBtn").hidden = !isBusy;
    document.getElementById("aleSendBtn").hidden = isBusy;
    document.getElementById("aleInput").setAttribute("aria-busy", String(isBusy));
}

function interruptAle() {
    if (!aleBusy || !aleAbortController) return;
    const controller = aleAbortController;
    if (Number.isInteger(aleActiveHistoryIndex)) {
        aleHistory = aleHistory.slice(0, aleActiveHistoryIndex + 1);
    }
    aleActiveUserMessage?.classList.add("interrupted");
    aleBusy = false;
    aleAbortController = null;
    aleActiveHistoryIndex = null;
    aleActiveUserMessage = null;
    controller.abort();
    clearAleThinking();
    setAleComposerBusy(false);
    addAleMessage("tool", "Stopped. Edit this prompt to retry, or send a new one.");
}

async function aleRespond(signal) {
    for (let round = 0; round < 6; round++) {
        throwIfAleAborted(signal);
        const message = await openRouterRequest(aleHistory, { tools: ALE_TOOLS, tool_choice: "auto" }, waitMs => {
            updateAleThinking(`Rate limit hit — retrying in ${Math.round(waitMs / 1000)}s…`);
        }, signal);
        throwIfAleAborted(signal);
        aleHistory.push(message);
        const calls = message.tool_calls || [];
        if (!calls.length) {
            const content = (message.content || "").trim();
            if (content) addAleMessage("assistant", content);
            return;
        }
        for (const call of calls) {
            throwIfAleAborted(signal);
            const args = parseToolArguments(call.function.arguments);
            const label = args.folder ? ` · ${args.folder}` : args.part ? ` · ${args.part}` : "";
            addAleMessage("tool", `⚙ ${call.function.name}${label}`);
            let result;
            try { result = await runAleTool(call.function.name, args, signal); }
            catch (error) {
                if (signal.aborted) throw aleAbortError();
                result = { error: String(error.message || error) };
            }
            throwIfAleAborted(signal);
            showAleThinking();
            aleHistory.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
    }
    addAleMessage("assistant", "That took more steps than I expected — ask me again and I'll narrow it down.");
}

function renderAleProposal(plan) {
    const messages = document.getElementById("aleMessages");
    const card = document.createElement("div");
    card.className = "ale-proposal";
    const folders = [...new Set([...allFolderNames(), ...plan.map(move => move.to)])].sort((a, b) => a.localeCompare(b));
    const listId = `aleFolderOptions${++alePlanSeq}`;
    card.innerHTML = `
        <h4>✦ Organisation plan</h4>
        <p data-plan-summary></p>
        <ul>${plan.map((move, index) => `<li class="plan-row" data-index="${index}" data-id="${escapeHtml(move.id)}" data-name="${escapeHtml(move.name)}" data-from="${escapeHtml(move.from)}">
            <span class="plan-name">${escapeHtml(move.name)}</span>
            <span class="move-from">${escapeHtml(move.from)}</span>
            <span class="move-arrow">→</span>
            <input class="plan-folder" list="${listId}" value="${escapeHtml(move.to)}" aria-label="Folder for ${escapeHtml(move.name)}" spellcheck="false">
            <button class="plan-remove" type="button" aria-label="Remove from plan">&times;</button>
        </li>`).join("")}</ul>
        <datalist id="${listId}">${folders.map(name => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
        <div class="ale-actions"><button class="action-button" data-ale-apply type="button">Apply changes</button><button class="quiet-button" data-ale-dismiss type="button">Dismiss</button></div>`;
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;

    const updateSummary = () => {
        const rows = [...card.querySelectorAll(".plan-row")];
        const targets = new Set(rows.map(row => row.querySelector(".plan-folder").value.trim()).filter(Boolean));
        card.querySelector("[data-plan-summary]").textContent = `Move ${rows.length} part${rows.length === 1 ? "" : "s"} into ${targets.size} folder${targets.size === 1 ? "" : "s"}. Edit any destination, remove rows, then apply.`;
    };
    card.addEventListener("input", updateSummary);
    card.addEventListener("click", event => {
        const remove = event.target.closest(".plan-remove");
        if (remove) { remove.closest(".plan-row").remove(); updateSummary(); }
    });
    updateSummary();

    card.querySelector("[data-ale-dismiss]").addEventListener("click", () => { alePendingPlan = null; card.remove(); });
    card.querySelector("[data-ale-apply]").addEventListener("click", () => {
        const moves = [...card.querySelectorAll(".plan-row")].map(row => ({
            id: row.dataset.id,
            name: row.dataset.name,
            from: row.dataset.from,
            to: row.querySelector(".plan-folder").value.trim()
        })).filter(move => move.to);
        if (!moves.length) { toast("Add at least one destination folder"); return; }
        applyAlePlan(card, moves);
    });
}

async function restorePart(entry) {
    const { error } = await supabaseClient.from("inventory_parts").update({
        category: entry.category ?? "",
        manual_category: entry.manual_category ?? null,
        ai_category: entry.ai_category ?? null,
        updated_at: new Date().toISOString()
    }).eq("id", entry.id);
    return error;
}

async function applyAlePlan(card, plan) {
    card.querySelectorAll(".plan-folder, .plan-remove").forEach(el => { el.disabled = true; });
    const snapshot = plan.map(move => {
        const part = registryParts.find(item => item.id === move.id);
        return { id: move.id, category: part ? part.category : null, manual_category: part ? part.manual_category : null, ai_category: part ? part.ai_category : null };
    });
    for (const move of plan) {
        await supabaseClient.from("inventory_parts").update({ category: move.to, ai_category: move.to, updated_at: new Date().toISOString() }).eq("id", move.id);
    }
    aleLastBatch = { snapshot, plan, createdFolders: [...aleSessionFolders] };
    alePendingPlan = null;
    await loadInventory();
    toast("ALE applied the plan — Keep it or Undo");

    card.querySelector(".ale-actions").innerHTML = `<button class="action-button" data-ale-keep type="button">Keep changes</button><button class="quiet-button" data-ale-undo type="button">Undo</button>`;
    card.querySelector("[data-ale-keep]").addEventListener("click", async () => {
        for (const move of plan) {
            await supabaseClient.from("inventory_parts").update({ manual_category: move.to, updated_at: new Date().toISOString() }).eq("id", move.id);
        }
        const user = (await supabaseClient.auth.getUser()).data.user;
        for (const folder of [...new Set(plan.map(move => move.to))]) {
            if (!registryFolders.includes(folder)) {
                const { error } = await supabaseClient.from("part_folders").insert({ name: folder, created_by: user ? user.id : null });
                if (!error) aleSessionFolders.add(folder);
            }
        }
        aleSessionFolders.clear();
        aleLastBatch = null;
        await loadInventory();
        card.querySelector(".ale-actions").innerHTML = `<span class="summary-chip green">Kept</span>`;
        toast("ALE changes kept");
    });
    card.querySelector("[data-ale-undo]").addEventListener("click", async () => {
        let failed = false;
        for (const entry of snapshot) {
            const error = await restorePart(entry);
            if (error) failed = true;
        }
        aleLastBatch = null;
        await loadInventory();
        const created = [...aleSessionFolders];
        const emptyCreated = created.filter(name => !registryParts.some(part => folderOf(part) === name));
        if (emptyCreated.length) {
            await supabaseClient.from("part_folders").delete().in("name", emptyCreated);
            emptyCreated.forEach(name => { const index = registryFolders.indexOf(name); if (index >= 0) registryFolders.splice(index, 1); });
            await loadInventory();
        }
        aleSessionFolders.clear();
        card.querySelector(".ale-actions").innerHTML = `<span class="summary-chip yellow">Undone</span>`;
        toast(failed ? "Undo finished but some parts could not be restored" : "Undone — folders and parts restored");
    });
}

async function addFolder() {
    const name = (prompt("New folder name") || "").trim();
    if (!name) return;
    const user = (await supabaseClient.auth.getUser()).data.user;
    const { error } = await supabaseClient.from("part_folders").insert({ name, created_by: user ? user.id : null });
    if (error) { toast(error.code === "23505" ? "That folder already exists" : "Could not create folder"); return; }
    await loadInventory();
    toast(`Folder "${name}" created`);
}

async function deleteFolder(name) {
    const inside = registryParts.filter(part => folderOf(part) === name);
    const message = inside.length
        ? `Delete "${name}"? ${inside.length} part${inside.length === 1 ? "" : "s"} inside will move to Uncategorized.`
        : `Delete the empty folder "${name}"?`;
    if (!confirm(message)) return;
    if (inside.length) {
        const { error } = await supabaseClient.from("inventory_parts")
            .update({ category: "", manual_category: null, ai_category: null, updated_at: new Date().toISOString() })
            .in("id", inside.map(part => part.id));
        if (error) { toast("Could not move the parts out of this folder"); return; }
    }
    const { error } = await supabaseClient.from("part_folders").delete().eq("name", name);
    if (error) { toast("Could not delete the folder"); return; }
    if (explorerFolder === name) explorerFolder = ROOT;
    await loadInventory();
    toast(`Folder "${name}" deleted`);
}

async function loadSimClock() {
    const { data, error } = await supabaseClient.rpc("read_sim_clock");
    const clock = Array.isArray(data) ? data[0] : data;
    const clockActive = !!clock && !!clock.simulated_at;
    simClockNow = clockActive ? new Date(clock.simulated_at) : null;
    const currentEl = document.getElementById("simClockCurrent");
    const clearBtn = document.getElementById("simClockClear");
    if (currentEl) currentEl.innerHTML = clockActive
        ? `<strong class="live-sim">Test clock ACTIVE</strong> — consoles treat <strong>${escapeHtml(new Date(clock.simulated_at).toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</strong> as today${clock.label ? ` (${escapeHtml(clock.label)})` : ""}<br><small>set by ${escapeHtml(clock.set_by_name || "an admin")} · ${escapeHtml(new Date(clock.updated_at).toLocaleString())}</small>`
        : `<em>No test clock active — both consoles run against the real calendar.</em>`;
    if (clearBtn) clearBtn.hidden = !clockActive;
}
async function setSimClockFromForm(form) {
    const value = document.getElementById("simClockAt").value;
    const label = document.getElementById("simClockLabel").value.trim();
    if (!value) { toast("Pick a date and time first"); return; }
    const { error } = await supabaseClient.rpc("set_sim_clock", { p_simulated_at: new Date(value).toISOString(), p_label: label || null });
    if (error) { toast("Could not set the test clock"); return; }
    toast("Test clock set — consoles updated");
    document.getElementById("simClockAt").value = "";
    document.getElementById("simClockLabel").value = "";
    await loadSimClock();
}
document.getElementById("simClockSetForm").addEventListener("submit", event => { event.preventDefault(); setSimClockFromForm(event.target); });
document.getElementById("simClockClear").addEventListener("click", async () => {
    const { error } = await supabaseClient.rpc("clear_sim_clock");
    if (error) toast("Could not clear the test clock");
    else { toast("Test clock cleared"); await loadSimClock(); }
});
async function setSimPreset(days) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + Number(days));
    const { error } = await supabaseClient.rpc("set_sim_clock", { p_simulated_at: target.toISOString(), p_label: `Simulated +${days} days` });
    if (error) toast("Could not set the test clock");
    else { toast(`Test clock → +${days} days`); await loadSimClock(); }
}
document.querySelectorAll("[data-sim-preset]").forEach(button => button.addEventListener("click", () => setSimPreset(Number(button.dataset.simPreset))));

async function loadInviteCodes() {
    const { data: rows, error } = await supabaseClient.rpc("get_invite_codes");
    if (error) { toast("Could not load the invite codes"); return; }
    const map = {};
    (rows || []).forEach(row => { map[row.role_name] = row.code; });
    const adminInput = document.getElementById("adminInviteCode");
    const teacherInput = document.getElementById("teacherInviteCode");
    if (adminInput && map.admin !== undefined) adminInput.value = map.admin;
    if (teacherInput && map.teacher !== undefined) teacherInput.value = map.teacher;
}
async function saveInviteCodes() {
    const adminCode = document.getElementById("adminInviteCode").value.trim();
    const teacherCode = document.getElementById("teacherInviteCode").value.trim();
    if (adminCode.length < 4) { toast("Admin invite code needs at least 4 characters"); return; }
    if (teacherCode.length < 4) { toast("Teacher invite code needs at least 4 characters"); return; }
    const button = document.querySelector("#inviteCodeForm button[type=submit]");
    const original = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "Saving…"; }
    try {
        let { error } = await supabaseClient.rpc("set_invite_code", { p_role: "admin", p_code: adminCode });
        if (error) throw error;
        ({ error } = await supabaseClient.rpc("set_invite_code", { p_role: "teacher", p_code: teacherCode }));
        if (error) throw error;
        const stamp = document.getElementById("inviteCodeStamp");
        if (stamp) { stamp.textContent = "Saved — the new codes are already live for the next signup."; stamp.hidden = false; }
        toast("Invite codes updated");
    } catch (error) {
        toast(error.message ? String(error.message).replace(/^[^:]+:\s*/, "") : "Could not save the invite codes");
    } finally {
        if (button) { button.disabled = false; button.textContent = original; }
    }
}
document.getElementById("inviteCodeForm").addEventListener("submit", event => { event.preventDefault(); saveInviteCodes(); });
document.getElementById("inviteCodeToggle").addEventListener("click", () => {
    const show = document.getElementById("inviteCodeToggle").textContent.includes("Show");
    ["adminInviteCode", "teacherInviteCode"].forEach(id => { const input = document.getElementById(id); if (input) input.type = show ? "text" : "password"; });
    document.getElementById("inviteCodeToggle").textContent = show ? "Hide codes" : "Show codes";
});

// ============================================================
// Parts log — what is out of the lab right now
// ============================================================

let borrowLogRows = [];
let borrowRowsLoaded = false;
let simClockNow = null;
let restockPlan = null;

function adminNow() { return simClockNow || new Date(); }

const formatStamp = value => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

async function loadPartsLog() {
    const { data, error } = await supabaseClient.from("part_proposals")
        .select("id, student_name, student_class_name, student_section, reason, duration_days, items, status, lent_at, due_at, returned_at, created_at")
        .order("lent_at", { ascending: false });
    if (error) { console.error("Parts log load error:", error); return false; }
    borrowLogRows = data || [];
    borrowRowsLoaded = true;
    renderPartsLog();
    return true;
}

function buildPartsLogEntries() {
    const now = adminNow();
    const partById = new Map(registryParts.map(part => [part.id, part]));
    const entries = [];
    borrowLogRows.forEach(row => {
        if (!row.lent_at) return;
        const items = Array.isArray(row.items) ? row.items : [];
        items.forEach(item => {
            const part = partById.get(item.id);
            entries.push({
                proposalId: row.id,
                partId: item.id,
                name: item.name || (part ? part.name : "Unknown part"),
                code: part ? (part.part_code || "—") : "—",
                qty: Number(item.quantity) || 0,
                student: row.student_name || "Unknown",
                class: [row.student_class_name, row.student_section].filter(Boolean).join(" · ") || "—",
                reason: row.reason || "",
                lentAt: row.lent_at,
                dueAt: row.due_at,
                returnedAt: row.returned_at,
                state: borrowState(row, now)
            });
        });
    });
    entries.sort((a, b) => (b.lentAt || "").localeCompare(a.lentAt || ""));
    return entries;
}

function partsLogStats(entries) {
    const active = entries.filter(entry => entry.state !== "returned");
    const overdue = entries.filter(entry => entry.state === "overdue");
    const returned = entries.filter(entry => entry.state === "returned");
    return {
        outUnits: active.reduce((sum, entry) => sum + entry.qty, 0),
        activeLoans: new Set(active.map(entry => entry.proposalId)).size,
        overdueLoans: new Set(overdue.map(entry => entry.proposalId)).size,
        returnedRecords: returned.reduce((sum, entry) => sum + entry.qty, 0)
    };
}

function renderPartsLog() {
    const listEl = document.getElementById("partslogList");
    const statsEl = document.getElementById("partslogStats");
    if (!listEl || !statsEl) return;
    document.getElementById("partslogSearchClear").hidden = !document.getElementById("partslogSearch").value;
    if (!borrowLogRows.length) {
        statsEl.innerHTML = "";
        listEl.innerHTML = `<div class="empty-state-block"><span class="empty-icon">⇄</span><strong>No borrow activity yet</strong><p>Once the teacher hands parts out, every unit leaving the lab is logged here.</p></div>`;
        return;
    }

    const entries = buildPartsLogEntries();
    const stats = partsLogStats(entries);
    statsEl.innerHTML = `
        <div class="stat"><small>Units out of lab</small><strong>${stats.outUnits}</strong></div>
        <div class="stat"><small>Active loans</small><strong>${stats.activeLoans}</strong></div>
        <div class="stat${stats.overdueLoans ? " alert" : ""}"><small>Overdue loans</small><strong>${stats.overdueLoans}</strong></div>
        <div class="stat"><small>Units returned</small><strong>${stats.returnedRecords}</strong></div>`;

    const search = document.getElementById("partslogSearch").value.trim().toLowerCase();
    const stateFilter = document.getElementById("partslogStateFilter").value;
    const filtered = entries.filter(entry => {
        const matchesState = stateFilter === "" ? entry.state !== "returned" : entry.state === stateFilter;
        if (!matchesState) return false;
        if (!search) return true;
        return `${entry.name} ${entry.code} ${entry.student} ${entry.class} ${entry.reason}`.toLowerCase().includes(search);
    });

    if (!filtered.length) {
        listEl.innerHTML = `<div class="empty-state-block"><span class="empty-icon">⌕</span><strong>Nothing matches</strong><p>Try a different search or clear the filter.</p></div>`;
        return;
    }

    listEl.innerHTML = `
        <div class="plog-head"><span>Part / code</span><span>Qty</span><span>State</span><span>Borrower / class</span><span>Lent</span><span>Due</span><span>Reason</span></div>
        ${filtered.map(entry => {
            const stateChip = entry.state === "overdue" ? `<span class="tier-pill tier-critical">Overdue</span>`
                : entry.state === "out" ? `<span class="tier-pill tier-order">Out</span>`
                : `<span class="tier-pill tier-none">Returned</span>`;
            return `<div class="plog-row${entry.state === "overdue" ? " overdue-row" : ""}" data-part-id="${escapeHtml(entry.partId)}" role="button" tabindex="0" title="View ${escapeHtml(entry.name)} in the registry">
                <div class="plog-part"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.code)}</small></div>
                <span class="qty-num">× ${entry.qty}</span>
                ${stateChip}
                <span><strong style="color:var(--ink)">${escapeHtml(entry.student)}</strong><br><small>${escapeHtml(entry.class)}</small></span>
                <span>${escapeHtml(formatStamp(entry.lentAt))}</span>
                <span>${entry.dueAt ? escapeHtml(formatStamp(entry.dueAt)) : "—"}</span>
                <span class="plog-reason">${escapeHtml(entry.reason)}</span>
            </div>`;
        }).join("")}`;
}

// ============================================================
// Restock planner — deterministic demand-driven algorithm
// ============================================================

const RESTOCK_Z = { 90: 1.28, 95: 1.65, 97.5: 1.96, 99: 2.33 };
const MONTH_DAYS = 30.44;

function restockParamsFromForm() {
    const num = id => { const v = Number(document.getElementById(id).value); return Number.isFinite(v) && v > 0 ? v : 0; };
    return {
        leadDays: num("restockLeadTime") || 7,
        reviewDays: num("restockReviewPeriod") || 30,
        lookbackDays: num("restockLookback") || 90,
        serviceLevel: document.getElementById("restockServiceLevel").value
    };
}

function buildRestockPlan(params) {
    const now = adminNow();
    const z = RESTOCK_Z[params.serviceLevel] || 1.65;
    const partById = new Map(registryParts.map(part => [part.id, part]));
    const metrics = new Map();
    registryParts.forEach(part => metrics.set(part.id, {
        id: part.id,
        name: part.name,
        code: part.part_code || "—",
        category: folderOf(part),
        onHand: Number(part.quantity) || 0,
        unitsOut: 0,
        pendingWeighted: 0,
        lentEvents: 0,
        recent30: 0,
        recent60: 0,
        recent90: 0,
        totalLent: 0,
        lastBorrowed: null
    }));

    borrowLogRows.forEach(row => {
        const items = Array.isArray(row.items) ? row.items : [];
        if (!items.length) return;
        const lentAt = row.lent_at ? new Date(row.lent_at) : null;
        const active = row.lent_at && !row.returned_at;
        const ageDays = lentAt ? (now.getTime() - lentAt.getTime()) / 86400000 : null;
        items.forEach(item => {
            const m = metrics.get(item.id);
            if (!m) return;
            const qty = Number(item.quantity) || 0;
            if (active) m.unitsOut += qty;
            if (!lentAt) {
                const weight = row.status === "approved" ? 1 : row.status === "standby" ? 0.6 : row.status === "pending" ? 0.35 : 0;
                m.pendingWeighted += qty * weight;
            } else {
                m.lentEvents++;
                m.totalLent += qty;
                if (ageDays <= 30) m.recent30 += qty;
                if (ageDays <= 60) m.recent60 += qty;
                if (ageDays <= 90) m.recent90 += qty;
                if (!m.lastBorrowed || lentAt.getTime() > m.lastBorrowed.getTime()) m.lastBorrowed = lentAt;
            }
        });
    });

    const plan = registryParts.map(part => {
        const m = metrics.get(part.id);
        const r30 = m.recent30 / MONTH_DAYS;
        const r60 = (m.recent60 - m.recent30) / MONTH_DAYS;
        const r90 = (m.recent90 - m.recent60) / MONTH_DAYS;
        const perDay = (m.recent30 || m.recent60 || m.recent90)
            ? Math.max(0, 0.5 * r30 + 0.3 * Math.max(0, r60) + 0.2 * Math.max(0, r90))
            : 0;
        const demandRate = perDay * MONTH_DAYS;
        const leadMonths = params.leadDays / MONTH_DAYS;
        const reviewMonths = params.reviewDays / MONTH_DAYS;
        const demandLead = demandRate * leadMonths;
        const demandReview = demandRate * reviewMonths;
        const sigma = Math.sqrt(Math.max(0.16, demandLead));
        const safety = demandRate > 0 ? z * sigma : 0;
        const target = demandLead + demandReview + safety;
        const inLab = Math.max(0, m.onHand - m.unitsOut);
        const free = inLab - m.pendingWeighted;
        const shortfall = target - free;
        const orderQty = shortfall > 0 ? Math.max(1, Math.ceil(shortfall)) : 0;
        const demandActive = demandRate > 0 || m.lentEvents > 0;

        let tier;
        if (free < 0 || (m.pendingWeighted >= Math.max(1, inLab) && m.pendingWeighted > 0)) tier = "critical";
        else if (orderQty > 0) tier = "order";
        else if (demandActive && free <= target * 1.2) tier = "monitor";
        else tier = "none";

        return { ...m, demandRate, safety, target, inLab, free, shortfall, orderQty, tier, aiReason: "", aiBaseQty: orderQty, aiAdjusted: false };
    });

    const tierRank = { critical: 0, order: 1, monitor: 2, none: 3 };
    plan.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (b.shortfall - a.shortfall) || a.name.localeCompare(b.name));
    return plan;
}

function restockOrderItems() {
    return restockPlan ? restockPlan.items.filter(m => (m.tier === "critical" || m.tier === "order") && m.orderQty > 0) : [];
}

function renderMonitorList(items) {
    if (!items.length) return "";
    const rows = items.map(m => `<div class="restock-item">
        <div class="restock-part"><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.code)} · ${escapeHtml(m.category)}</small></div>
        <span class="num">${m.onHand}</span>
        <span class="num">${m.unitsOut}</span>
        <span class="num">${Math.round(m.pendingWeighted * 10) / 10}</span>
        <span class="num">${m.demandRate > 0 ? Math.round(m.demandRate * 10) / 10 : "—"}</span>
        <span class="num">${Math.round(m.safety * 10) / 10}</span>
        <span class="num">${Math.round(m.target * 10) / 10}</span>
        <span class="num" style="color:var(--yellow)">soon</span>
        <span class="tier-pill tier-monitor">Monitor</span>
    </div>`).join("");
    return `<div class="restock-sub"><div class="restock-sub-head">Watch — get more soon</div><div class="restock-list"><div class="restock-head"><span>Part</span><span>Have</span><span>Out</span><span>Asked</span><span>Used/mo</span><span>Extra</span><span>Need</span><span>Qty</span><span>Tier</span></div>${rows}</div></div>`;
}

function renderRestockStats() {
    const el = document.getElementById("restockStats");
    if (!el || !restockPlan) return;
    const orderItems = restockOrderItems();
    const totalUnits = orderItems.reduce((sum, m) => sum + m.orderQty, 0);
    const criticalCount = restockPlan.items.filter(m => m.tier === "critical").length;
    el.innerHTML = `
        <div class="stat"><small>Parts to order</small><strong>${orderItems.length}</strong></div>
        <div class="stat"><small>Units to order</small><strong>${totalUnits}</strong></div>
        <div class="stat${criticalCount ? " alert" : ""}"><small>Critical</small><strong>${criticalCount}</strong></div>`;
}

function renderNoOrderExplainer() {
    const withDemand = restockPlan.items.filter(m => m.lentEvents > 0).sort((a, b) => b.demandRate - a.demandRate);
    if (!withDemand.length) {
        return `<div class="restock-sub"><div class="restock-sub-head">Why nothing is ordered</div><div class="empty-state-block"><span class="empty-icon">▦</span><strong>No borrow history detected</strong><p>The planner only reorders parts that students have actually been lent. Borrow a few parts out in the teacher console, wait until they show in the Parts log, then run the analysis again.</p></div></div>`;
    }
    return `<div class="restock-sub">
        <div class="restock-sub-head">Why nothing is ordered now</div>
        <div class="restock-note">These parts <b>have been used</b> by students. The leftover stock — what's in the lab record minus what's out with students minus what's been requested — still covers the amount expected to be used before the next order arrives. To test a reorder, lower that part's quantity in the registry (e.g. to 1 or 2).</div>
    </div>`;
}

function renderRestockResult() {
    const container = document.getElementById("restockResult");
    if (!container) return;
    if (!restockPlan) { container.innerHTML = ""; return; }

    const orderItems = restockOrderItems();
    document.getElementById("restockAiBtn").hidden = !orderItems.length;
    document.getElementById("restockOrderedBtn").hidden = !orderItems.length;

    const aiSummaryEl = document.getElementById("restockAiSummary");
    aiSummaryEl.innerHTML = `
        <div class="restock-ai-summary">
            <strong>${restockPlan.aiReview ? "✦ ALE reviewed this order" : "✦ Deterministic plan — demand-driven"}</strong>
            ${restockPlan.aiReview
                ? escapeHtml(restockPlan.aiSummary || "AI fine-tuned the quantities and priorities on top of the algorithm.")
                : `Quantities come from how much students used recently, what's out on loan or already requested, and a ${restockPlan.params.serviceLevel}% confidence level. Press <b>Ask AI to refine</b> to double-check the list.`}
        </div>`;

    const monitorItems = restockPlan.items.filter(m => m.tier === "monitor");
    renderRestockStats();

    if (!orderItems.length) {
        container.innerHTML = renderNoOrderExplainer() + renderMonitorList(monitorItems);
    } else {
        const head = `<div class="restock-head"><span>Part</span><span>Have</span><span>Out</span><span>Asked</span><span>Used/mo</span><span>Extra</span><span>Need</span><span>Order</span><span>Tier</span></div>`;
        const rows = orderItems.map(m => {
            const badge = m.tier === "critical"
                ? `<span class="tier-pill tier-critical">Critical</span>`
                : `<span class="tier-pill tier-order">Order</span>`;
            const aiTag = m.aiAdjusted ? `<span class="restock-ai-tag">AI</span>` : "";
            const aiNote = m.aiReason ? `<span class="ai-note">${escapeHtml(m.aiReason)}</span>` : "";
            return `<div class="restock-item">
                <div class="restock-part"><strong>${escapeHtml(m.name)}${aiTag}</strong><small>${escapeHtml(m.code)} · ${escapeHtml(m.category)}</small>${aiNote}</div>
                <span class="num">${m.onHand}</span>
                <span class="num">${m.unitsOut}</span>
                <span class="num">${Math.round(m.pendingWeighted * 10) / 10}</span>
                <span class="num">${m.demandRate > 0 ? Math.round(m.demandRate * 10) / 10 : "—"}</span>
                <span class="num">${Math.round(m.safety * 10) / 10}</span>
                <span class="num"><b style="color:var(--ink)">${Math.round(m.target * 10) / 10}</b></span>
                <input class="restock-qty" type="number" min="0" step="1" value="${m.orderQty}" data-restock-qty="${escapeHtml(m.id)}" aria-label="Order quantity for ${escapeHtml(m.name)}">
                ${badge}
            </div>`;
        }).join("");
        container.innerHTML = `<div class="restock-sub"><div class="restock-sub-head">Order these now</div><div class="restock-scroll"><div class="restock-list">${head}${rows}</div></div></div>` + renderMonitorList(monitorItems);
    }
}

function refreshRestockFooters() {
    renderRestockStats();
}

function markRestockOrdered() {
    if (!restockPlan) return;
    const orderItems = restockOrderItems();
    if (!orderItems.length) return;
    restockPlan = null;
    document.getElementById("restockResult").innerHTML = "";
    document.getElementById("restockAiSummary").innerHTML = "";
    document.getElementById("restockStats").innerHTML = "";
    document.getElementById("restockAiBtn").hidden = true;
    document.getElementById("restockOrderedBtn").hidden = true;
    toast(`Order list cleared — ${orderItems.length} part type${orderItems.length === 1 ? "" : "s"} removed`);
}

async function runRestockAnalysis() {
    const runBtn = document.getElementById("restockRunBtn");
    runBtn.disabled = true;
    runBtn.textContent = "✦ Analyzing…";
    try {
        await Promise.all([loadInventory(), loadPartsLog()]);
        const params = restockParamsFromForm();
        restockPlan = { items: buildRestockPlan(params), params, aiReview: false, aiSummary: "" };
        renderRestockResult();
        const orderCount = restockOrderItems().length;
        toast(orderCount ? `Restock plan ready — ${orderCount} part type${orderCount === 1 ? "" : "s"} to order` : "Restock plan ready — nothing to order yet");
    } catch (error) {
        console.error(error);
        toast("Could not run the restock analysis");
    } finally {
        runBtn.disabled = false;
        runBtn.textContent = "✦ Run analysis";
    }
}

async function askAIRestock() {
    if (!restockPlan) return;
    const items = restockOrderItems();
    if (!items.length) { toast("Nothing to order — the AI has nothing to refine"); return; }
    const button = document.getElementById("restockAiBtn");
    button.disabled = true;
    button.textContent = "✦ ALE is refining…";
    try {
        items.forEach(m => { m.aiBaseQty = m.orderQty; });
        const payload = items.map(m => ({
            name: m.name,
            code: m.code,
            on_hand: m.onHand,
            out_now: m.unitsOut,
            pending: Math.round(m.pendingWeighted * 10) / 10,
            demand_per_month: Math.round(m.demandRate * 10) / 10,
            safety_stock: Math.round(m.safety * 10) / 10,
            projected_need: Math.round(m.target * 10) / 10,
            computed_order_qty: m.orderQty
        }));
        const prompt = [
            "You are ALE, the Otter lab restock planner. The data below was computed from the lab's real borrow history.",
            "Return ONLY valid JSON (no markdown) with this shape:",
            JSON.stringify({ summary: "1-2 sentences", items: [{ name: "part name", order_qty: 0, tier: "critical|order|monitor", reason: "short" }] }, null, 2),
            "",
            "Rules:",
            "- order_qty is a non-negative integer; base it on computed_order_qty and the demand/safety numbers.",
            "- tier critical = students already waiting / demand exceeds stock; order = order now; monitor = watch, no order.",
            "- Only list parts whose final order_qty > 0.",
            "- Use the exact names given. Do not invent parts or metrics.",
            "",
            "Candidate data:",
            JSON.stringify(payload)
        ].join("\n");
        const result = await callOpenRouter([{ role: "system", content: "You return strict JSON restock plans." }, { role: "user", content: prompt }]);
        const parsed = JSON.parse(stripJsonFence(result));
        const byName = new Map(items.map(m => [m.name.trim().toLowerCase(), m]));
        (Array.isArray(parsed.items) ? parsed.items : []).forEach(aiItem => {
            if (!aiItem || !aiItem.name) return;
            const target = byName.get(String(aiItem.name).trim().toLowerCase());
            if (!target) return;
            if (Number.isFinite(Number(aiItem.order_qty)) && Number(aiItem.order_qty) >= 0) {
                target.orderQty = Math.max(0, Math.round(Number(aiItem.order_qty)));
                target.aiAdjusted = target.orderQty !== target.aiBaseQty;
            }
            if (aiItem.tier && ["critical", "order", "monitor"].includes(aiItem.tier)) {
                target.tier = target.orderQty > 0 ? aiItem.tier : "monitor";
            }
            target.aiReason = String(aiItem.reason || "").trim().slice(0, 200);
        });
        restockPlan.aiReview = true;
        restockPlan.aiSummary = String(parsed.summary || "").trim();
        renderRestockResult();
        toast("ALE refined the order — review the receipt");
    } catch (error) {
        console.error(error);
        toast(error.message === "rate-limited" ? "OpenRouter is rate-limited — try again in a moment" : "AI refine failed — the algorithm plan still stands");
    } finally {
        button.disabled = false;
        button.textContent = "✦ Ask AI to refine";
    }
}

document.querySelectorAll("[data-admin-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.adminTab)));
document.getElementById("adminSignOut").addEventListener("click", async () => { await supabaseClient.auth.signOut(); window.location.href = "admin-login.html"; });
supabaseClient.channel("admin-clock-live").on("postgres_changes", { event: "*", schema: "public", table: "sim_clock", filter: "id=eq.1" }, () => loadSimClock()).subscribe();

// Registry UI wiring
document.getElementById("openPartModal").addEventListener("click", () => openPartModal(null));
document.getElementById("addFolderBtn").addEventListener("click", addFolder);
document.getElementById("openAleBtn").addEventListener("click", openAlePanel);
document.getElementById("closeAleBtn").addEventListener("click", closeAlePanel);
document.getElementById("aleOrganizeBtn").addEventListener("click", () => sendAleMessage("Organize the registry", { organize: true }));
document.getElementById("aleStopBtn").addEventListener("click", interruptAle);
document.getElementById("aleForm").addEventListener("submit", event => { event.preventDefault(); sendAleMessage(document.getElementById("aleInput").value); });
document.getElementById("aleInput").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendAleMessage(event.target.value); }
});
let registrySearchTimer = null;
document.getElementById("registrySearch").addEventListener("input", () => {
    clearTimeout(registrySearchTimer);
    registrySearchTimer = setTimeout(updateRegistry, 120);
});
document.getElementById("registrySearch").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.target.value = ""; updateRegistry(); return; }
    if (event.key !== "Enter") return;
    const matches = filteredParts();
    if (matches.length === 1) openPartDetail(matches[0]);
});
document.getElementById("registrySearchClear").addEventListener("click", () => { document.getElementById("registrySearch").value = ""; updateRegistry(); document.getElementById("registrySearch").focus(); });
document.getElementById("registryStatusFilter").addEventListener("change", updateRegistry);
document.querySelectorAll("[data-close-part-modal]").forEach(button => button.addEventListener("click", closePartModal));
document.querySelectorAll("[data-close-detail-modal]").forEach(button => button.addEventListener("click", () => { document.getElementById("partDetailBackdrop").hidden = true; }));
document.getElementById("partModalBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closePartModal(); });
document.getElementById("partDetailBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) document.getElementById("partDetailBackdrop").hidden = true; });
document.getElementById("partPhoto").addEventListener("change", event => {
    partPhotoFile = event.target.files[0] || null;
    const preview = document.getElementById("partPhotoPreview");
    if (!partPhotoFile) { preview.hidden = true; preview.innerHTML = ""; return; }
    const reader = new FileReader();
    reader.onload = readerEvent => { preview.innerHTML = `<img src="${readerEvent.target.result}" alt="Photo preview"><span>New picture preview</span>`; preview.hidden = false; };
    reader.readAsDataURL(partPhotoFile);
});
const partForm = document.getElementById("partForm");
partForm.addEventListener("submit", async event => {
    event.preventDefault();
    const partId = document.getElementById("partId").value;
    const name = document.getElementById("partName").value.trim();
    const category = document.getElementById("partCategory").value.trim();
    const serialNumber = document.getElementById("partSerial").value.trim();
    const quantity = Math.max(0, Number(document.getElementById("partQuantity").value) || 0);
    const status = document.getElementById("partStatus").value;
    const location = document.getElementById("partLocation").value.trim() || "Lab storage";
    let photoUrl = editingPhotoUrl;

    const submitButton = partForm.querySelector("button[type=submit]");
    submitButton.disabled = true;
    submitButton.textContent = "Saving…";

    try {
        if (partPhotoFile) {
            const extension = (partPhotoFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
            const safeName = (name || "part").replace(/[^a-z0-9]+/gi, "-").slice(0, 40).toLowerCase();
            const path = `${safeName}-${randomId().slice(0, 8)}.${extension}`;
            const { data, error: uploadError } = await supabaseClient.storage.from("part-photos").upload(path, partPhotoFile, { cacheControl: "3600", upsert: false });
            if (uploadError) throw uploadError;
            photoUrl = supabaseClient.storage.from("part-photos").getPublicUrl(path).data.publicUrl;
        }

        const payload = { name, category, manual_category: category, ai_category: category, serial_number: serialNumber || null, quantity, status, location, photo_url: photoUrl || null, updated_at: new Date().toISOString() };
        const { error } = partId
            ? await supabaseClient.from("inventory_parts").update(payload).eq("id", partId)
            : await supabaseClient.from("inventory_parts").insert(payload);
        if (error) throw error;
        if (partId && editingPhotoUrl && photoUrl !== editingPhotoUrl) {
            const oldPath = editingPhotoUrl.split("/part-photos/")[1];
            if (oldPath) await supabaseClient.storage.from("part-photos").remove([oldPath]);
        }
        closePartModal();
        await loadInventory();
        toast(partId ? "Part updated" : "Part added");
    } catch (error) {
        console.error(error);
        toast("Could not save part");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Save part";
    }
});
document.getElementById("inventoryList").addEventListener("click", event => {
    const card = event.target.closest("[data-part-id]");
    if (!card) return;
    const part = registryParts.find(item => item.id === card.dataset.partId);
    if (part) openPartDetail(part);
});
document.getElementById("inventoryList").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-part-id]");
    if (!card) return;
    event.preventDefault();
    const part = registryParts.find(item => item.id === card.dataset.partId);
    if (part) openPartDetail(part);
});

// Parts log + restock wiring
document.getElementById("partslogRefreshBtn").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    window.OtterLoading?.show();
    try {
        const refreshed = await loadPartsLog();
        toast(refreshed ? "Parts log refreshed" : "Could not refresh parts log");
    } catch (error) {
        console.error("Parts log refresh failed:", error);
        toast("Could not refresh parts log");
    } finally {
        button.disabled = false;
        window.OtterLoading?.hide();
    }
});
document.getElementById("partslogStateFilter").addEventListener("change", renderPartsLog);
document.getElementById("partslogSearchClear").addEventListener("click", () => { document.getElementById("partslogSearch").value = ""; renderPartsLog(); document.getElementById("partslogSearch").focus(); });
let partslogSearchTimer = null;
document.getElementById("partslogSearch").addEventListener("input", () => {
    clearTimeout(partslogSearchTimer);
    partslogSearchTimer = setTimeout(renderPartsLog, 120);
});
document.getElementById("partslogSearch").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.target.value = ""; renderPartsLog(); }
});
document.getElementById("partslogList").addEventListener("click", event => {
    const row = event.target.closest("[data-part-id]");
    if (!row) return;
    const part = registryParts.find(item => item.id === row.dataset.partId);
    if (part) openPartDetail(part);
});
document.getElementById("partslogList").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-part-id]");
    if (!row) return;
    event.preventDefault();
    const part = registryParts.find(item => item.id === row.dataset.partId);
    if (part) openPartDetail(part);
});

document.getElementById("restockRunBtn").addEventListener("click", runRestockAnalysis);
document.getElementById("restockAiBtn").addEventListener("click", askAIRestock);
document.getElementById("restockOrderedBtn").addEventListener("click", markRestockOrdered);
document.getElementById("restockResult").addEventListener("input", event => {
    const input = event.target.closest("[data-restock-qty]");
    if (!input || !restockPlan) return;
    const item = restockPlan.items.find(entry => entry.id === input.dataset.restockQty);
    if (!item) return;
    item.orderQty = Math.max(0, Math.round(Number(input.value) || 0));
    refreshRestockFooters();
});
supabaseClient.channel("admin-borrow-live").on("postgres_changes", { event: "*", schema: "public", table: "part_proposals" }, async () => {
    if (borrowRowsLoaded) await loadPartsLog();
    const restockActive = document.getElementById("restockView").classList.contains("active");
    if (restockPlan && restockActive) {
        const params = restockPlan.params;
        restockPlan = { items: buildRestockPlan(params), params, aiReview: false, aiSummary: "" };
        renderRestockResult();
    }
}).subscribe();

(async () => {
    try {
        const user = await requireAdmin();
        if (!user) return;
        await Promise.all([loadInventory(), loadSimClock(), loadInviteCodes()]);
        if (window.OtterTutorial) {
            OtterTutorial.autostart("admin", {
                theme: "dark",
                onNavigate: step => { if (step.go) setTab(step.go); }
            });
        }
    } catch (error) {
        console.error("Admin dashboard startup failed:", error);
        toast("The admin desk could not finish loading.");
    } finally {
        window.OtterLoading?.hide();
    }
})();