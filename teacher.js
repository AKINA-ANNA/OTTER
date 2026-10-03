const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let proposals = [];
let activeFilter = "all";
let allProjects = [];
let allInterests = [];
let allShares = [];
let students = [];
let selectedStudentMap = {};
let editingProjectId = null;
let projectModalMode = "new";
let modalStep = "students";
let reachStudentIds = new Set();
let lendingProposal = null;
let lendPhotoFile = null;
let lendPhotoObjectUrl = null;
let collateralProposals = [];
let logRows = [];
let profileMap = {};
let logsRangeMode = "default";
let teacherNotices = [];
let teacherNoticeHistory = [];
let simClock = { simulated_at: null, label: null };
function effectiveTeacherNow() { return simClock.simulated_at ? new Date(simClock.simulated_at) : new Date(); }

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

function initialsFor(name) {
    return name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "T";
}

function showToast(message) {
    const toast = document.getElementById("teacherToast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function formatTime(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const statusLabel = status => ({ pending: "Awaiting review", standby: "On standby", approved: "Approved", declined: "Declined" }[status] || status);

let audioContext = null;
function primeAudio() {
    if (!audioContext) {
        try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch (error) { return; }
    }
    if (audioContext.state === "suspended") audioContext.resume();
}

function playNotificationSound() {
    if (!audioContext) return;
    /* A tab restored from the background can come back suspended even
       though it was unlocked earlier, so nudge it before playing. */
    if (audioContext.state === "suspended") audioContext.resume();
    const now = audioContext.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = now + index * 0.16;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.48);
    });
}

/* Desktop alerts for new part proposals. Browsers only grant this from a
   user gesture, so the ask is a button rather than a prompt on load. */
function notificationsSupported() { return "Notification" in window; }

function syncAlertButton() {
    const button = document.getElementById("teacherAlertButton");
    if (!button) return;
    if (!notificationsSupported()) { button.hidden = true; return; }
    if (Notification.permission === "granted") { button.hidden = true; return; }
    const label = document.getElementById("teacherAlertLabel");
    const blocked = Notification.permission === "denied";
    button.hidden = false;
    button.classList.toggle("is-blocked", blocked);
    button.disabled = blocked;
    if (label) label.textContent = blocked ? "Desktop alerts are blocked" : "Turn on desktop alerts";
}

async function requestAlerts() {
    if (!notificationsSupported() || Notification.permission !== "default") { syncAlertButton(); return; }
    try { await Notification.requestPermission(); } catch (error) { console.error("Alert permission error:", error); }
    syncAlertButton();
}

function showDesktopAlert(title, body, tag) {
    if (!notificationsSupported() || Notification.permission !== "granted") return;
    /* With the console already in front of the teacher a system popup
       would only be noise on top of the toast and the chime. */
    if (!document.hidden) return;
    try {
        const alert = new Notification(title, { body, tag: tag || "otter", silent: true });
        alert.onclick = () => { window.focus(); setTeacherTab("parts"); alert.close(); };
    } catch (error) { console.error("Desktop alert failed:", error); }
}

let activeTeacherTab = "overview";
const teacherTabStats = {};

/* A nav badge counts what has landed since the teacher last opened that
   tab, not everything still outstanding. Seen ids are kept per tab in
   localStorage so a reload does not resurrect a badge already cleared. */
const TEACHER_SEEN_KEY = "otter.teacher.seen.v1";
const teacherSeen = readTeacherSeen();
const teacherTabUnseen = {};

function readTeacherSeen() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TEACHER_SEEN_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) { return {}; }
}

function writeTeacherSeen() {
    try { localStorage.setItem(TEACHER_SEEN_KEY, JSON.stringify(teacherSeen)); } catch (error) { /* private mode, nothing to do */ }
}

function unseenCountFor(tab, items, idOf) {
    const seen = new Set((teacherSeen[tab] || []).map(String));
    return items.reduce((total, item) => {
        const id = idOf(item);
        return id && !seen.has(String(id)) ? total + 1 : total;
    }, 0);
}

/* Opening the tab clears it. Recording the current list also prunes ids
   that have since left the list, so the store cannot grow forever. */
function markTabSeen(tab, items, idOf) {
    teacherSeen[tab] = items.map(idOf).filter(Boolean).map(String);
    writeTeacherSeen();
}

function setUnseenCount(tab, count) {
    teacherTabUnseen[tab] = count;
    paintNavCounts();
}

/* Badge shows what arrived while the teacher was elsewhere; looking at the
   tab marks the list seen, so the badge drops to zero immediately. */
function refreshUnseenBadge(tab, items, idOf) {
    if (activeTeacherTab === tab) {
        markTabSeen(tab, items, idOf);
        setUnseenCount(tab, 0);
        return;
    }
    setUnseenCount(tab, unseenCountFor(tab, items, idOf));
}

function paintNavCounts() {
    document.querySelectorAll("[data-nav-count]").forEach(badge => {
        const tab = badge.dataset.navCount;
        const unseen = teacherTabUnseen[tab];
        /* Tabs that do not track arrivals fall back to their plain count. */
        const value = typeof unseen === "number" ? unseen : (teacherTabStats[tab] || {}).value;
        if (typeof value !== "number" || value <= 0) {
            badge.textContent = "";
            badge.hidden = true;
            return;
        }
        badge.textContent = value > 99 ? "99+" : String(value);
        badge.hidden = false;
    });
}

function setHeaderStat(tab, value, label) {
    teacherTabStats[tab] = { value, label };
    paintNavCounts();
    if (activeTeacherTab !== tab) return;
    const valueEl = document.getElementById("teacherHeaderStatValue");
    const labelEl = document.getElementById("teacherHeaderStatLabel");
    if (valueEl) valueEl.textContent = value;
    if (labelEl) labelEl.textContent = label;
}

function setTeacherTab(tabName) {
    document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
    document.querySelectorAll(".teacher-view").forEach(view => view.classList.toggle("active", view.id === `${tabName}View`));
    activeTeacherTab = tabName;
    window.scrollTo({ top: 0, behavior: "auto" });
    const titles = {
        overview: ["Overview", "today", "Here is what your students are sharing."],
        parts: ["Part requests", "queue", "Review parts proposals and keep the lab moving."],
        collateral: ["Collateral", "desk", "Hand out approved parts and track everything on loan."],
        logs: ["Lab logs", "record", "Every part that has been handed out and returned."],
        notice: ["Overdue", "notices", "Overdue borrow notices appear here automatically."],
        projects: ["Project proposals", "studio", "Publish build events and keep an eye on student team builds."],
        labTimings: ["Lab timings", "timetable", "Set when the lab is open. Students see this on their dashboard."]
    };
    const [lead, accent, description] = titles[tabName];
    document.getElementById("teacherLead").textContent = lead;
    document.getElementById("teacherAccent").textContent = accent;
    document.getElementById("teacherDescription").textContent = description;
    setHeaderStat(tabName, "—", "loading");
    if (tabName === "overview") updateTeacherPostLimit();
    if (tabName === "parts") loadProposals();
    if (tabName === "collateral") loadCollateral();
    if (tabName === "logs") loadLogs();
    if (tabName === "notice") { loadNoticeData(); loadStudents(); }
    if (tabName === "projects") { loadProjects(); }
    if (tabName === "labTimings") loadLabTimings();
}

/* ---------------- Announcements (overview) ---------------- */

function renderTeacherPosts(posts) {
    const feed = document.getElementById("teacherPostList");
    if (!posts.length) {
        feed.innerHTML = `<div class="empty-state"><strong>No announcements yet</strong><p>Share an update or reply to a student here.</p></div>`;
        return;
    }
    feed.innerHTML = posts.map(post => {
        const formal = Social.kind(post) === "formal";
        const own = post.author_id === currentUser.id;
        return `
        <article class="teacher-post-card ${formal ? "important" : "informal"}" data-post-id="${escapeHtml(post.id)}">
            <div class="post-meta">
                <div class="post-author-avatar" style="background:${escapeHtml(post.author_color || "#c8f36d")}">${escapeHtml(post.author_initials)}</div>
                <div class="post-author"><strong>${escapeHtml(post.author_name)}${own ? ' <span class="you-tag">you</span>' : ""}</strong><small>${escapeHtml(formatTime(post.created_at))}</small></div>
                ${formal
                    ? `<div class="post-flags"><span class="post-flag teacher">Official · Formal</span></div>`
                    : `<span class="post-tag informal">Informal</span>`}
            </div>
            ${post.body ? `<p>${escapeHtml(post.body)}</p>` : ""}
            ${Social.attachmentHtml(post, escapeHtml)}
            <div class="post-actions">
                <button class="post-action ${post.liked ? "liked" : ""}" data-post-action="like" type="button">♡ Like ${post.like_count || ""}</button>
                <button class="post-action" data-post-action="comment" type="button">◌ Comment ${post.comments.length || ""}</button>
                ${own ? `<button class="post-action" data-post-action="edit" type="button">✎ Edit</button><button class="post-action danger" data-post-action="delete" type="button">🗑 Delete</button>` : ""}
            </div>
            <div class="comments open" data-comments>
                <div class="comment-list">${post.comments.map(comment => `
                    <div class="comment" data-comment-id="${escapeHtml(comment.id)}">
                        <strong>${escapeHtml(comment.author_name)}:</strong>
                        <span class="comment-text">${escapeHtml(comment.body)}</span>
                        ${comment.author_id === currentUser.id ? `<span class="comment-actions">
                            <button class="comment-action" data-comment-action="edit" type="button" aria-label="Edit your comment">✎</button>
                            <button class="comment-action danger" data-comment-action="delete" type="button" aria-label="Delete your comment">🗑</button>
                        </span>` : ""}
                    </div>`).join("")}</div>
                <form class="comment-form"><input aria-label="Write a comment" maxlength="300" placeholder="Add a reply..."><button type="submit">Send</button></form>
            </div>
        </article>`;
    }).join("");
}

async function loadTeacherAnnouncements() {
    const { data: announcements, error } = await supabaseClient
        .from("announcements")
        .select("id, author_id, author_name, author_initials, author_color, body, tag, author_role, attachment_url, attachment_type, attachment_name, created_at")
        .order("created_at", { ascending: false });
    const feed = document.getElementById("teacherPostList");
    if (error) {
        feed.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load announcements</strong><p>Make sure the base Supabase tables exist.</p></div>`;
        console.error("Announcement load error:", error);
        return;
    }
    if (!announcements.length) { renderTeacherPosts([]); return; }
    const ids = announcements.map(announcement => announcement.id);
    const [{ data: likes }, { data: comments }] = await Promise.all([
        supabaseClient.from("announcement_likes").select("announcement_id, user_id").in("announcement_id", ids),
        supabaseClient.from("announcement_comments").select("id, announcement_id, author_id, author_name, body, created_at").in("announcement_id", ids).order("created_at", { ascending: true })
    ]);
    const posts = announcements.map(announcement => {
        const postLikes = likes.filter(like => like.announcement_id === announcement.id);
        return {
            ...announcement,
            like_count: postLikes.length,
            liked: postLikes.some(like => like.user_id === currentUser.id),
            comments: comments.filter(comment => comment.announcement_id === announcement.id)
        };
    });
    renderTeacherPosts(posts);
}

async function updateTeacherPostLimit() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count, error } = await supabaseClient
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .eq("author_id", currentUser.id)
        .gte("created_at", startOfDay.toISOString());
    if (error) return;
    const used = count || 0;
    document.getElementById("teacherAnnouncementCount").textContent = `${used}/20 announcements used today`;
    document.getElementById("teacherPostAnnouncement").disabled = used >= 20;
    setHeaderStat("overview", used, used === 1 ? "announcement today" : "announcements today");
}

async function createTeacherAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const textarea = document.getElementById("teacherAnnouncementText");
    const body = textarea.value.trim();
    const attachment = Social.compose(form);
    if (!body && !attachment) { showToast("Write something or attach a file"); return; }

    const button = document.getElementById("teacherPostAnnouncement");
    button.disabled = true;
    button.textContent = "Posting...";

    let attachmentUrl = "";
    let attachmentType = "";
    let attachmentName = "";
    if (attachment) {
        if (attachment.file) {
            const uploaded = await Social.uploadFile(supabaseClient, attachment.file, currentUser.id);
            if (uploaded.error) {
                button.disabled = false;
                button.textContent = "Post announcement";
                showToast("Could not upload the attachment");
                console.error("Attachment upload error:", uploaded.error);
                return;
            }
            attachmentUrl = uploaded.url;
            attachmentType = attachment.type;
            attachmentName = attachment.file.name;
        } else {
            attachmentUrl = attachment.url;
            attachmentType = attachment.type;
            attachmentName = attachment.name;
        }
    }

    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Teacher";
    const { error } = await supabaseClient.from("announcements").insert({
        author_id: currentUser.id,
        author_name: name,
        author_initials: initialsFor(name),
        author_color: "#a9d94e",
        body,
        tag: "Teacher · Important",
        author_role: "teacher",
        attachment_url: attachmentUrl,
        attachment_type: attachmentType,
        attachment_name: attachmentName
    });

    button.disabled = false;
    button.textContent = "Post announcement";
    if (error) {
        showToast(error.code === "P0001" ? "You have reached today's 20-announcement limit" : "Could not share that announcement");
        console.error("Announcement create error:", error);
        return;
    }

    textarea.value = "";
    Social.resetComposer(form);
    await Promise.all([loadTeacherAnnouncements(), updateTeacherPostLimit()]);
    showToast("Announcement shared with students");
}

async function toggleTeacherLike(postId, button) {
    const { data: existing, error: lookupError } = await supabaseClient.from("announcement_likes").select("announcement_id").eq("announcement_id", postId).eq("user_id", currentUser.id).maybeSingle();
    if (lookupError) { showToast("Could not update that like"); return; }
    const result = existing
        ? await supabaseClient.from("announcement_likes").delete().eq("announcement_id", postId).eq("user_id", currentUser.id)
        : await supabaseClient.from("announcement_likes").insert({ announcement_id: postId, user_id: currentUser.id });
    if (result.error) { showToast("Could not update that like"); return; }
    button.classList.toggle("liked", !existing);
    await loadTeacherAnnouncements();
}

function startTeacherPostEdit(card) {
    const bodyEl = card.querySelector("> p");
    const editor = document.createElement("textarea");
    editor.className = "post-edit-field";
    editor.maxLength = 600;
    editor.value = bodyEl ? bodyEl.textContent : "";
    if (bodyEl) {
        bodyEl.replaceWith(editor);
    } else {
        card.insertBefore(editor, card.querySelector(".post-actions"));
    }
    card.classList.add("editing");
    const actions = card.querySelector(".post-actions");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "post-action save-edit";
    save.dataset.postAction = "saveEdit";
    save.textContent = "Save changes";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "post-action cancel-edit";
    cancel.dataset.postAction = "cancelEdit";
    cancel.textContent = "Cancel";
    actions.appendChild(save);
    actions.appendChild(cancel);
    editor.focus();
}

function startTeacherCommentEdit(commentEl) {
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

async function deleteTeacherPost(postId) {
    if (!confirm("Delete this announcement? Students will no longer see it.")) return;
    const { error } = await supabaseClient.rpc("teacher_delete_announcement", { p_announcement_id: postId });
    if (error) { showToast("Could not delete that announcement"); console.error("Announcement delete error:", error); return; }
    showToast("Announcement deleted");
    await Promise.all([loadTeacherAnnouncements(), updateTeacherPostLimit()]);
}

/* ---------------- Part proposals queue ---------------- */

function visibleProposals() {
    return proposals.filter(proposal => proposal.status === "pending");
}

function studentClassSection(proposal) {
    const details = [
        proposal.student_class_name ? `Class ${proposal.student_class_name}` : "",
        proposal.student_section ? `Section ${proposal.student_section}` : ""
    ].filter(Boolean);
    return details.length ? details.join(" · ") : "Class and section not provided";
}

function renderProposals() {
    const feed = document.getElementById("proposalFeed");
    const visible = visibleProposals();
    const reviewed = proposals.filter(proposal => proposal.status !== "pending");
    setHeaderStat("parts", visible.length, "awaiting decision");
    refreshUnseenBadge("parts", visible, proposal => proposal.id);
    document.getElementById("proposalHistoryCount").textContent = reviewed.length;

    if (!proposals.length) {
        feed.innerHTML = `<div class="empty-state"><strong>No part proposals yet</strong><p>Requests students submit will appear here as soon as they are sent.</p></div>`;
    } else if (!visible.length) {
        feed.innerHTML = `<div class="empty-state"><strong>Nothing needs a decision</strong><p>New requests will appear here when students submit them.</p></div>`;
    } else {
        feed.innerHTML = visible.map(proposal => {
            const items = Array.isArray(proposal.items) ? proposal.items : [];
            return renderProposalCard(proposal, items);
        }).join("");
        feed.querySelectorAll("[data-review]").forEach(button => {
            button.addEventListener("click", () => {
                const proposalId = button.closest("[data-proposal-id]").dataset.proposalId;
                reviewProposal(proposalId, button.dataset.review);
            });
        });
    }

    renderProposalHistory(reviewed);
}

function historyRow(proposal) {
    return `
        <article class="history-row">
            <div><strong>${escapeHtml(proposal.student_name)}</strong><small>${escapeHtml(studentClassSection(proposal))}</small><span>${escapeHtml(proposal.reason)}</span></div>
            <div><b class="history-status ${escapeHtml(proposal.status)}">${statusLabel(proposal.status)}</b><small>${formatTime(proposal.created_at)}</small></div>
        </article>`;
}

function historyEmpty(hasReviewed) {
    return `<div class="history-empty">${hasReviewed ? "No matching history." : "No reviewed requests yet."}</div>`;
}

function renderProposalHistory(reviewed) {
    const expanded = document.getElementById("historyBackdrop").classList.contains("open");
    const search = document.getElementById("historySearch").value.trim().toLowerCase();
    const status = document.getElementById("historyStatus").value;
    const from = document.getElementById("historyDateFrom").value;
    const to = document.getElementById("historyDateTo").value;
    const filtered = reviewed.filter(proposal => {
        const searchable = [proposal.student_name, proposal.student_class_name, proposal.student_section, proposal.reason].join(" ").toLowerCase();
        const date = proposal.created_at.slice(0, 10);
        return (!search || searchable.includes(search))
            && (status === "all" || proposal.status === status)
            && (!from || date >= from)
            && (!to || date <= to);
    });
    const preview = document.getElementById("proposalHistory");
    if (preview) preview.innerHTML = filtered.length ? filtered.slice(0, 5).map(historyRow).join("") : historyEmpty(reviewed.length);
    const full = document.getElementById("proposalHistoryFull");
    if (full && expanded) full.innerHTML = filtered.length ? filtered.map(historyRow).join("") : historyEmpty(reviewed.length);
    document.getElementById("proposalHistoryCount").textContent = reviewed.length;
}

async function loadProposals() {
    const { data, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, student_name, student_class_name, student_section, reason, duration_days, items, status, reviewed_note, reviewed_at, created_at")
        .order("created_at", { ascending: false });
    if (error) {
        document.getElementById("proposalFeed").innerHTML = `<div class="empty-state empty-state-error"><strong>Queue unavailable</strong><p>Could not load part proposals.</p></div>`;
        console.error("Proposal load error:", error);
        return;
    }
    proposals = data || [];
    renderProposals();
}

function renderProposalCard(proposal, items) {
    return `
        <article class="proposal-card" data-proposal-id="${escapeHtml(proposal.id)}" data-status="${escapeHtml(proposal.status)}">
            <div class="proposal-card-top">
                <div class="proposal-caller"><span class="caller-avatar">${escapeHtml((proposal.student_name || "?").split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase())}</span><div><strong>${escapeHtml(proposal.student_name)}</strong><small>${escapeHtml(studentClassSection(proposal))} · ${formatTime(proposal.created_at)}</small></div></div>
                <span class="proposal-status pending">Awaiting decision</span>
            </div>
            <p class="proposal-reason">${escapeHtml(proposal.reason)}</p>
            <div class="proposal-detail"><span>Duration</span><strong>${proposal.duration_days} day${proposal.duration_days === 1 ? "" : "s"}</strong></div>
            <div class="proposal-items">${items.map(item => `<span class="part-chip">${escapeHtml(item.name)} × ${item.quantity}</span>`).join("") || `<span class="part-chip">No items listed</span>`}</div>
            <div class="proposal-actions">
                <button class="review-button approve" data-review="approved" type="button">Accept</button>
                <button class="review-button standby" data-review="standby" type="button">Standby</button>
                <button class="review-button decline" data-review="declined" type="button">Decline</button>
            </div>
        </article>`;
}

async function reviewProposal(proposalId, status) {
    const proposal = proposals.find(item => item.id === proposalId);
    const { error } = await supabaseClient
        .from("part_proposals")
        .update({
            status,
            reviewed_by: currentUser.id,
            reviewed_at: effectiveTeacherNow().toISOString()
        })
        .eq("id", proposalId);
    if (error) {
        console.error("Proposal review error:", error);
        showToast(`Could not review proposal: ${error.message || "database error"}`);
        return;
    }
    const outcome = status === "approved" ? "Accepted" : status === "standby" ? "Placed on standby" : "Declined";
    showToast(`${outcome} ${proposal?.student_name || ""} proposal`.trim());
    await Promise.all([loadProposals(), loadCollateral()]);
}

function timeLeftText(proposal) {
    if (!proposal.due_at) return "";
    const seconds = Math.floor((new Date(proposal.due_at).getTime() - effectiveTeacherNow().getTime()) / 1000);
    if (seconds <= 0) return "Overdue";
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min left`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr left`;
    return `${Math.floor(seconds / 86400)} days left`;
}

async function loadCollateral() {
    await syncOverdueState();
    const { data, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, student_name, student_class_name, student_section, reason, duration_days, items, status, lent_at, due_at, returned_at, photo_url, photo_path, return_note, reviewed_at, created_at")
        .in("status", ["approved"])
        .order("created_at", { ascending: false });
    if (error) {
        document.getElementById("awaitingList").innerHTML = `<div class="empty-state empty-state-error"><strong>Collateral unavailable</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Collateral load error:", error);
        return;
    }
    collateralProposals = data || [];
    renderCollateral();
}

function collateralChipList(items) {
    return (Array.isArray(items) ? items : []).map(item => `<span class="part-chip">${escapeHtml(item.name)} × ${item.quantity}</span>`).join("");
}

function currentCollateralFilter() {
    return {
        search: (document.getElementById("collateralSearch").value || "").trim().toLowerCase(),
        status: document.getElementById("collateralStatus").value
    };
}

function collateralMatchesSearch(proposal, search) {
    if (!search) return true;
    const itemNames = (Array.isArray(proposal.items) ? proposal.items : []).map(item => item.name).join(" ");
    return [proposal.student_name, proposal.student_class_name, proposal.student_section, proposal.reason, itemNames].join(" ").toLowerCase().includes(search);
}

const isCollateralAwaiting = proposal => !proposal.lent_at;
const isCollateralOut = proposal => proposal.lent_at && !proposal.returned_at;
const isCollateralReturned = proposal => proposal.returned_at;
const isCollateralOverdue = proposal => isCollateralOut(proposal) && proposal.due_at && new Date(proposal.due_at) <= effectiveTeacherNow();

function renderCollateral() {
    const { search, status } = currentCollateralFilter();
    const filtered = collateralProposals.filter(proposal => collateralMatchesSearch(proposal, search) && (status === "all" || (status === "awaiting" ? isCollateralAwaiting(proposal) : status === "out" ? isCollateralOut(proposal) : status === "overdue" ? isCollateralOverdue(proposal) : status === "returned" ? isCollateralReturned(proposal) : true)));
    const awaiting = filtered.filter(isCollateralAwaiting);
    const out = filtered.filter(isCollateralOut);
    const returned = filtered.filter(isCollateralReturned);
    setHeaderStat("collateral", collateralProposals.filter(isCollateralAwaiting).length, "to hand out");
    refreshUnseenBadge("collateral", collateralProposals.filter(isCollateralAwaiting), proposal => proposal.id);
    renderCollateralSection("awaitingList", awaiting, "awaiting");
    renderCollateralSection("outList", out, "out");
    const latestReturned = status === "returned" ? returned : [...returned].sort((a, b) => new Date(b.returned_at) - new Date(a.returned_at)).slice(0, 1);
    renderCollateralSection("returnedList", latestReturned, "returned");
    const returnedNote = document.getElementById("returnedNote");
    if (returnedNote) returnedNote.textContent = status !== "returned" && returned.length > 1 ? `Showing the latest return · ${returned.length - 1} more in the Logs tab.` : "";
}

function collateralItemCount(proposal) {
    return (Array.isArray(proposal.items) ? proposal.items : []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function renderCollateralSection(targetId, items, kind) {
    const container = document.getElementById(targetId);
    const stateText = `${kind === "awaiting" ? "No approved requests waiting to be handed out" : kind === "out" ? "Nothing is currently out on loan" : "No parts returned yet"}.`;
    if (!items.length) {
        container.innerHTML = `<div class="empty-state compact-empty"><strong>${kind === "awaiting" ? "Waiting for approved requests" : kind === "out" ? "No parts currently out" : "Nothing returned yet"}</strong><p>${stateText}</p></div>`;
        return;
    }
    container.innerHTML = items.map(proposal => {
        const overdue = kind === "out" && isCollateralOverdue(proposal);
        const badge = kind === "awaiting" ? { text: "Ready to collect", cls: "approved" } : kind === "out" ? (overdue ? { text: "Overdue", cls: "overdue" } : { text: "On loan", cls: "out" }) : { text: "Returned", cls: "returned" };
        const timing = kind === "awaiting" ? `Approved ${formatTime(proposal.reviewed_at || proposal.created_at)}` : kind === "out" ? `Out ${formatTime(proposal.lent_at)} · ${timeLeftText(proposal)}` : `Returned ${formatTime(proposal.returned_at)}`;
        const action = kind === "awaiting"
            ? `<button class="review-button approve" data-lend="start" type="button">Proceed with lending →</button>`
            : kind === "out"
                ? `<button class="review-button standby" data-lend="return" type="button">Mark returned</button>`
                : "";
        const itemsCount = collateralItemCount(proposal);
        const dueSnippet = proposal.due_at ? ` · due ${new Date(proposal.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "";
        return `
        <article class="collateral-card ${overdue ? "overdue" : ""}" data-proposal-id="${escapeHtml(proposal.id)}" data-status="${escapeHtml(proposal.status)}">
            <div class="collateral-card-top">
                <span class="collateral-avatar">${escapeHtml((proposal.student_name || "?").split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase())}</span>
                <div class="collateral-who"><strong>${escapeHtml(proposal.student_name)}</strong><small>${escapeHtml(studentClassSection(proposal))} · ${timing}</small></div>
                <span class="collateral-badge ${badge.cls}">${badge.text}</span>
            </div>
            <div class="collateral-card-foot">
                <span class="collateral-meta">${itemsCount} item${itemsCount === 1 ? "" : "s"} · ${proposal.duration_days} day${proposal.duration_days === 1 ? "" : "s"}${kind === "out" ? dueSnippet : ""}</span>
                <div class="collateral-card-foot-actions">
                    ${action ? `<span class="collateral-action">${action}</span>` : ""}
                    <span class="collateral-expand"><i aria-hidden="true"></i>details</span>
                </div>
            </div>
            <div class="collateral-card-details">
                <p class="proposal-reason">${escapeHtml(proposal.reason)}</p>
                <div class="proposal-detail"><span>Duration</span><strong>${proposal.duration_days} day${proposal.duration_days === 1 ? "" : "s"}</strong>${proposal.due_at ? `<span class="proposal-detail-inline">Due ${new Date(proposal.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : ""}</div>
                <div class="proposal-items">${collateralChipList(proposal.items) || `<span class="part-chip">No items listed</span>`}</div>
                ${proposal.photo_url ? `<img class="collateral-photo" src="${escapeHtml(proposal.photo_url)}" alt="Parts handed over to ${escapeHtml(proposal.student_name)}">` : ""}
            </div>
        </article>`;
    }).join("");
}

function openLendModal(proposal) {
    lendingProposal = proposal;
    lendPhotoFile = null;
    if (lendPhotoObjectUrl) URL.revokeObjectURL(lendPhotoObjectUrl);
    lendPhotoObjectUrl = null;
    document.getElementById("lendPhoto").value = "";
    document.getElementById("lendPhotoPreview").src = "";
    document.getElementById("lendPhotoPreview").style.display = "none";
    document.getElementById("lendTitle").textContent = `Hand over parts to ${proposal.student_name}`;
    document.getElementById("lendSummary").textContent = `${proposal.reason} · ${proposal.duration_days} day${proposal.duration_days === 1 ? "" : "s"}`;
    document.getElementById("lendItems").innerHTML = (Array.isArray(proposal.items) ? proposal.items : []).map(item => `<div class="modal-item"><strong>${escapeHtml(item.name)}</strong><span>× ${item.quantity}</span></div>`).join("");
    document.getElementById("lendModal").classList.add("open");
    document.getElementById("lendModal").setAttribute("aria-hidden", "false");
}

function closeLendModal() {
    document.getElementById("lendModal").classList.remove("open");
    document.getElementById("lendModal").setAttribute("aria-hidden", "true");
    if (lendPhotoObjectUrl) URL.revokeObjectURL(lendPhotoObjectUrl);
    lendPhotoObjectUrl = null;
    lendPhotoFile = null;
    lendingProposal = null;
}

function onLendPhotoChange(event) {
    const file = event.target.files && event.target.files[0];
    const preview = document.getElementById("lendPhotoPreview");
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Please choose an image file"); event.target.value = ""; return; }
    lendPhotoFile = file;
    if (lendPhotoObjectUrl) URL.revokeObjectURL(lendPhotoObjectUrl);
    lendPhotoObjectUrl = URL.createObjectURL(file);
    preview.src = lendPhotoObjectUrl;
    preview.style.display = "block";
}

async function confirmLend(event) {
    event.preventDefault();
    if (!lendingProposal) return;
    const button = document.getElementById("lendConfirm");
    button.disabled = true;
    button.textContent = "Handing over...";
    let photoUrl = "";
    let path = "";
    if (lendPhotoFile) {
        const extension = (lendPhotoFile.name.split(".").pop() || "jpg").toLowerCase();
        path = `${lendingProposal.id}/${Date.now()}.${extension}`;
        const { error: uploadError } = await supabaseClient.storage.from("part-pickups").upload(path, lendPhotoFile, { contentType: lendPhotoFile.type, upsert: false });
        if (uploadError) {
            button.disabled = false;
            button.textContent = "Mark as lended →";
            showToast("Could not upload the photo");
            console.error("Photo upload error:", uploadError);
            return;
        }
        photoUrl = supabaseClient.storage.from("part-pickups").getPublicUrl(path).data.publicUrl;
    }
    const lentAtDate = effectiveTeacherNow();
    const lentAt = lentAtDate.toISOString();
    const dueAt = new Date(lentAtDate.getTime() + lendingProposal.duration_days * 86400000).toISOString();
    const { error } = await supabaseClient.from("part_proposals").update({
        lent_at: lentAt,
        due_at: dueAt,
        lent_by: currentUser.id,
        photo_url: photoUrl,
        photo_path: path
    }).eq("id", lendingProposal.id);
    button.disabled = false;
    button.textContent = "Mark as lended →";
    if (error) { showToast("Could not finish the lending process"); console.error("Lend update error:", error); return; }
    const studentName = lendingProposal.student_name;
    closeLendModal();
    showToast(`Handed over — borrow timer started for ${studentName}`);
    await Promise.all([loadCollateral(), loadProposals()]);
}

function storagePathFromUrl(url) {
    if (!url) return "";
    const marker = "/part-pickups/";
    const index = url.indexOf(marker);
    return index === -1 ? "" : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

async function markReturned(proposal) {
    if (!confirm(`Mark these parts as returned by ${proposal.student_name}?`)) return;
    const path = proposal.photo_path || storagePathFromUrl(proposal.photo_url);
    const { error } = await supabaseClient.from("part_proposals").update({ returned_at: new Date().toISOString(), photo_url: "", photo_path: "" }).eq("id", proposal.id);
    if (error) { console.error("markReturned error:", error); showToast(`Could not mark as returned: ${error.message || "database error"}`); return; }
    if (path) {
        const { error: removeError } = await supabaseClient.storage.from("part-pickups").remove([path]);
        if (removeError) console.warn("Photo cleanup error:", removeError);
    }
    showToast("Parts marked as returned — logged");
    await Promise.all([loadCollateral(), loadProposals(), loadLogs()]);
}

function openLightbox(src, alt) {
    const lightbox = document.getElementById("lightbox");
    document.getElementById("lightboxImage").src = src;
    document.getElementById("lightboxImage").alt = alt || "Hand-over photo";
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
}

function closeLightbox() {
    const lightbox = document.getElementById("lightbox");
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    document.getElementById("lightboxImage").src = "";
}

/* ---------------- Lab logs (returned history) ---------------- */

function formatDateTime(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDay(value) {
    if (!value) return "—";
    return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

async function loadLogs() {
    const { data, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, student_name, student_class_name, student_section, reason, duration_days, items, reviewed_at, created_at, lent_at, due_at, returned_at")
        .not("returned_at", "is", null)
        .order("returned_at", { ascending: false });
    const diary = document.getElementById("logsDiary");
    if (error) {
        diary.innerHTML = `<div class="empty-state empty-state-error"><strong>Logs unavailable</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Log load error:", error);
        return;
    }
    logRows = data || [];
    const ids = [...new Set(logRows.map(row => row.student_id).filter(Boolean))];
    if (ids.length) {
        const { data: profiles } = await supabaseClient.from("student_profiles").select("user_id, name, email").in("user_id", ids);
        profileMap = Object.fromEntries((profiles || []).map(profile => [profile.user_id, profile]));
    } else {
        profileMap = {};
    }
    renderLogs();
}

function localDayKey(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysTo(value, days) {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
}

function renderLogs() {
    const diary = document.getElementById("logsDiary");
    setHeaderStat("logs", logRows.length, "returned");
    const search = (document.getElementById("logsSearch").value || "").trim().toLowerCase();
    const filter = document.getElementById("logsFilter").value;
    const picker = document.getElementById("logsDayPicker");
    const selected = picker.value;

    const matched = logRows.map(row => ({
        ...row,
        profile: profileMap[row.student_id] || {},
        keptDays: row.lent_at ? Math.max(0, Math.round((new Date(row.returned_at) - new Date(row.lent_at)) / 86400000)) : 0,
        late: row.due_at && new Date(row.returned_at) > new Date(row.due_at)
    })).filter(row => {
        const names = [row.student_name, row.profile.name, row.profile.email].filter(Boolean).join(" ");
        const items = (Array.isArray(row.items) ? row.items : []).map(item => item.name).join(" ");
        const hay = [names, row.student_class_name, row.student_section, row.reason, items].join(" ").toLowerCase();
        if (search && !hay.includes(search)) return false;
        if (filter === "ontime" && row.late) return false;
        if (filter === "late" && !row.late) return false;
        return true;
    });

    const byDay = {};
    matched.forEach(row => {
        const key = localDayKey(row.returned_at);
        (byDay[key] = byDay[key] || []).push(row);
    });
    Object.values(byDay).forEach(entries => entries.sort((a, b) => new Date(a.returned_at) - new Date(b.returned_at)));

    const todayKey = localDayKey(effectiveTeacherNow());
    const filtering = search || filter !== "all";
    let dayKeys;

    if (selected) {
        dayKeys = [selected];
    } else if (filtering) {
        dayKeys = Object.keys(byDay).filter(key => byDay[key].length).sort();
    } else if (logsRangeMode === "all") {
        const allKeys = [...new Set([...Object.keys(byDay), todayKey])].sort();
        const start = new Date(`${allKeys[0]}T00:00:00`);
        const end = new Date(`${todayKey}T00:00:00`);
        dayKeys = [];
        let cursor = new Date(start);
        while (cursor <= end) {
            dayKeys.push(localDayKey(cursor));
            cursor = addDaysTo(cursor, 1);
        }
    } else {
        dayKeys = [todayKey];
    }

    if (!selected && !filtering && !Object.keys(byDay).length && dayKeys.length === 1 && dayKeys[0] === todayKey) {
        diary.innerHTML = `<div class="empty-state"><strong>No returns logged yet</strong><p>Once you mark a loan as returned it will be recorded here day by day.</p></div>`;
        return;
    }

    if (!dayKeys.length) {
        diary.innerHTML = `<div class="empty-state"><strong>No matching records</strong><p>Nothing in the logbook matches your search or filter.</p></div>`;
        return;
    }

    diary.innerHTML = dayKeys.map(key => renderDiaryDay(key, byDay[key] || [], key === todayKey)).join("");

    if (selected) {
        const target = diary.querySelector(`[data-day="${selected}"] .diary-day-head`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function renderDiaryDay(key, entries, isToday) {
    const date = new Date(`${key}T00:00:00`);
    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    const monthYear = date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const ontime = entries.filter(entry => !entry.late).length;
    const summary = !entries.length ? "no returns" : `${entries.length} return${entries.length === 1 ? "" : "s"}${ontime === entries.length ? " · all on time" : ` · ${ontime} on time · ${entries.length - ontime} late`}`;
    return `
        <section class="diary-day ${isToday ? "today" : ""}" data-day="${key}">
            <header class="diary-day-head">
                <div class="diary-date-block">
                    <span class="diary-weekday">${escapeHtml(weekday)}</span>
                    <strong class="diary-daynum">${date.getDate()}</strong>
                    <span class="diary-month">${escapeHtml(monthYear)}</span>
                </div>
                <div class="diary-day-title">
                    <strong>${isToday ? "Today's record" : "Day record"}</strong>
                    <small>${escapeHtml(summary)}</small>
                </div>
            </header>
            <div class="diary-day-body">
                ${entries.length ? `<ul class="diary-entries">${entries.map(renderDiaryEntry).join("")}</ul>` : `<div class="diary-blank"><p><strong>Blank record</strong><span>${isToday ? "Nothing has been returned yet today — this page fills in as the day progresses." : "No parts were returned on this day."}</span></p></div>`}
            </div>
        </section>`;
}

function renderDiaryEntry(row) {
    const name = row.profile.name || row.student_name || "Unknown student";
    const email = row.profile.email || "";
    const initials = name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
    const returnedTime = new Date(row.returned_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `
        <li class="diary-entry ${row.late ? "late" : ""}">
            <span class="diary-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
            <div class="diary-entry-main">
                <strong>${escapeHtml(name)}${email ? `<span class="diary-email"> · ${escapeHtml(email)}</span>` : ""}</strong>
                <small>${escapeHtml(studentClassSection(row))} · kept ${row.keptDays} day${row.keptDays === 1 ? "" : "s"} of a ${row.duration_days}-day loan</small>
                <p>${escapeHtml(row.reason)}</p>
                <div class="proposal-items">${collateralChipList(row.items) || `<span class="part-chip">No items listed</span>`}</div>
            </div>
            <div class="diary-entry-side">
                <span class="diary-badge ${row.late ? "late" : "ontime"}">${row.late ? "Returned late" : "On time"}</span>
                <small>Returned ${escapeHtml(returnedTime)}</small>
                <small>Requested ${escapeHtml(formatDateTime(row.created_at))}</small>
            </div>
        </li>`;
}

/* ---------------- Overdue notices (Notice tab) ---------------- */

async function loadNoticeData() {
    await syncOverdueState();
    const { data: notices, error } = await supabaseClient
        .from("notices")
        .select("*")
        .eq("recipient_role", "teacher")
        .order("created_at", { ascending: false });
    if (error) {
        console.error("Notice load error:", error);
        renderTeacherNotices([]);
        renderNoticeHistory([]);
        return;
    }
    const all = (notices || []).slice();
    const loanIds = [...new Set(all.map(notice => notice.loan_id).filter(Boolean))];
    let loans = [];
    if (loanIds.length) {
        const { data, error: loanError } = await supabaseClient
            .from("part_proposals")
            .select("id, student_name, student_class_name, student_section, reason, items, due_at, returned_at")
            .in("id", loanIds);
        if (!loanError) loans = data;
    }
    const loanMap = Object.fromEntries((loans || []).map(loan => [loan.id, loan]));
    const now = effectiveTeacherNow();
    all.forEach(notice => {
        notice.loan = notice.loan_id ? loanMap[notice.loan_id] || null : null;
        notice.overdue_days = notice.loan?.due_at ? Math.max(0, Math.floor((now - new Date(notice.loan.due_at)) / 86400000)) : null;
        notice.days_late = notice.loan?.due_at && notice.loan.returned_at ? Math.max(0, Math.round((new Date(notice.loan.returned_at) - new Date(notice.loan.due_at)) / 86400000)) : null;
    });
    const byUrgency = (a, b) => {
        if (a.overdue_days != null && b.overdue_days != null) return b.overdue_days - a.overdue_days;
        if (a.overdue_days != null) return -1;
        if (b.overdue_days != null) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    };
    all.sort(byUrgency);
    teacherNoticeHistory = all;
    teacherNotices = all.filter(notice => !(Array.isArray(notice.dismissed_by) ? notice.dismissed_by : []).includes(currentUser.id));
    renderTeacherNotices();
    renderNoticeHistory();
    document.getElementById("noticeHistoryCount").textContent = teacherNoticeHistory.length;
    if (teacherNotices.length) playNotificationSound();
}

async function renderTeacherNotices(listToRender) {
    const list = document.getElementById("teacherNoticeList");
    const notices = listToRender || teacherNotices;
    setHeaderStat("notice", notices.length, notices.length === 1 ? "open notice" : "open notices");
    if (!notices.length) {
        list.innerHTML = `<div class="empty-state compact-empty"><strong>No overdue notices</strong><p>When a borrowed part is not returned by its due date, a notice is sent here automatically.</p></div>`;
        return;
    }
    list.innerHTML = notices.map(notice => {
        const kind = notice.kind === "overdue" ? "Overdue" : "System";
        let body = notice.body || "";
        if (notice.loan_id) {
            const loan = notice.loan || collateralProposals.find(proposal => proposal.id === notice.loan_id);
            if (loan) body = `${body}${body ? " " : ""}(${escapeHtml(loan.student_name)} · ${escapeHtml(studentClassSection(loan))} · ${escapeHtml(loan.reason)})`;
        }
        const overdue = notice.overdue_days != null
            ? `<span class="notice-overdue">${notice.overdue_days} day${notice.overdue_days === 1 ? "" : "s"} overdue</span>`
            : "";
        return `
        <div class="notice-row" data-notice-id="${escapeHtml(notice.id)}">
            <div class="notice-head"><span class="notice-head-group"><span class="notice-kind ${escapeHtml(notice.kind)}">${escapeHtml(kind)}</span>${overdue}</span><small>${escapeHtml(formatTime(notice.created_at))}</small></div>
            <strong>${escapeHtml(notice.title)}</strong>
            <p>${escapeHtml(body)}</p>
            <button class="lost-report-button dismiss" data-teacher-notice-action="dismiss" type="button">Dismiss</button>
        </div>`;
    }).join("");
}

async function dismissTeacherNotice(noticeId) {
    const { error } = await supabaseClient.rpc("dismiss_notice", { p_notice_id: noticeId });
    if (error) { showToast("Could not dismiss that notice"); return; }
    await loadNoticeData();
}

function noticeHistoryRow(record) {
    const loan = record.loan;
    const dismissed = (Array.isArray(record.dismissed_by) ? record.dismissed_by : []).length > 0;
    const statusText = record.kind === "overdue"
        ? loan?.returned_at
            ? (record.days_late ? `Returned · ${record.days_late}d late` : "Returned on time")
            : (record.overdue_days != null && record.overdue_days > 0 ? `Overdue · ${record.overdue_days}d` : "Due today")
        : "System";
    const statusClass = record.kind === "system" ? "standby" : (loan?.returned_at ? (record.days_late ? "declined" : "approved") : "declined");
    const items = Array.isArray(loan?.items) ? loan.items : [];
    const detail = loan
        ? `${studentClassSection(loan)}${items.length ? ` · ${escapeHtml(items.map(item => item.name).join(", "))}` : ""}`
        : (record.kind === "system" ? "System-wide record" : "Equipment record");
    return `
        <article class="history-row">
            <div>
                <strong>${escapeHtml(loan ? loan.student_name : (record.title || "Notice"))}</strong>
                <small>${escapeHtml(detail)}</small>
                <span>${escapeHtml(loan ? (record.body || "") : (record.body || record.title || ""))}</span>
            </div>
            <div>
                <b class="history-status ${statusClass}">${statusText}${dismissed ? " · Seen" : ""}</b>
                <small>${formatTime(record.created_at)}</small>
            </div>
        </article>`;
}

function noticeHistoryEmpty(hasRecords) {
    return `<div class="history-empty">${hasRecords ? "No matching records." : "No notices recorded yet."}</div>`;
}

function renderNoticeHistory(listToRender) {
    const records = listToRender || teacherNoticeHistory;
    const expanded = document.getElementById("noticeHistoryBackdrop").classList.contains("open");
    const search = document.getElementById("noticeHistorySearch").value.trim().toLowerCase();
    const kind = document.getElementById("noticeHistoryKind").value;
    const from = document.getElementById("noticeHistoryFrom").value;
    const to = document.getElementById("noticeHistoryTo").value;
    const filtered = records.filter(record => {
        const loan = record.loan;
        const names = [loan?.student_name, loan?.student_class_name, loan?.student_section].filter(Boolean).join(" ");
        const items = (Array.isArray(loan?.items) ? loan.items : []).map(item => item.name).join(" ");
        const searchable = [record.title, record.body, names, items, loan?.reason].filter(Boolean).join(" ").toLowerCase();
        const date = record.created_at.slice(0, 10);
        return (!search || searchable.includes(search))
            && (kind === "all" || record.kind === kind)
            && (!from || date >= from)
            && (!to || date <= to);
    });
    const preview = document.getElementById("noticeHistory");
    if (preview) preview.innerHTML = filtered.length ? filtered.slice(0, 5).map(noticeHistoryRow).join("") : noticeHistoryEmpty(records.length);
    const full = document.getElementById("noticeHistoryFull");
    if (full && expanded) full.innerHTML = filtered.length ? filtered.map(noticeHistoryRow).join("") : noticeHistoryEmpty(records.length);
    const count = document.getElementById("noticeHistoryCount");
    if (count) count.textContent = records.length;
}

async function syncOverdueState() {
    const { error } = await supabaseClient.rpc("process_overdue_incidents");
    if (error) console.error("Overdue processing error:", error);
    return !error;
}

/* ---------------- Project proposals ---------------- */

const detailTag = (label, value) => value ? `<div class="project-detail"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>` : "";

const PROJECT_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

function isoStamp(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayStamp() {
    const now = effectiveTeacherNow();
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

function renderProjects() {
    const list = document.getElementById("projectList");
    const active = allProjects.filter(project => !isProjectArchived(project));
    const archived = allProjects.filter(project => isProjectArchived(project));
    document.getElementById("projectCount").textContent = active.length ? `${active.length} project${active.length === 1 ? "" : "s"} published` : "No projects yet";
    setHeaderStat("projects", active.length, active.length === 1 ? "open project" : "open projects");
    refreshUnseenBadge("projects", active, project => project.id);
    if (!active.length) {
        list.innerHTML = archived.length
            ? `<div class="empty-state"><strong>No projects open</strong><p>${archived.length} project${archived.length === 1 ? " is" : "s are"} waiting in the history box. Anything you publish shows up here.</p></div>`
            : `<div class="empty-state"><strong>No projects published yet</strong><p>Create your first project and invite students to it.</p></div>`;
        renderProjectHistory(archived);
        return;
    }
    list.innerHTML = active.map(project => {
        const invited = Array.isArray(project.invited_students) ? project.invited_students : [];
        const interests = allInterests.filter(interest => interest.project_id === project.id);
        const own = project.teacher_id === currentUser.id;
        return `
        <article class="project-card" data-project-id="${escapeHtml(project.id)}">
            <div class="project-card-top">
                <div class="project-caller"><span class="caller-avatar">${escapeHtml((project.teacher_name || "?").split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase())}</span><div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.teacher_name)} · ${formatTime(project.created_at)}</small></div></div>
                ${own ? `<div class="project-manage"><button class="review-button standby" data-project-action="edit" type="button">Edit</button><button class="new-project-button" data-project-action="reach" type="button">Reach out</button><button class="review-button decline" data-project-action="delete" type="button">Delete</button></div>` : ""}
            </div>
            ${project.brief ? `<p class="project-brief">${escapeHtml(project.brief)}</p>` : ""}
            <div class="project-details">
                ${detailTag("When", project.held_date)}
                ${project.deadline ? `<div class="project-detail"><span>Sign up by</span><strong>${escapeHtml(formatDay(project.deadline))}</strong></div>` : ""}
                ${project.make_deadline ? `<div class="project-detail"><span>Make by</span><strong>${escapeHtml(formatDay(project.make_deadline))}</strong></div>` : ""}
                ${detailTag("Where", project.location)}
                ${detailTag("Transport", project.school_transport)}
                ${detailTag("School pays", project.school_funding)}
                ${project.website ? `<div class="project-detail"><span>Website</span><a href="${escapeHtml(project.website)}" target="_blank" rel="noopener">${escapeHtml(project.website)} ↗</a></div>` : ""}
            </div>
            <div class="project-audience"><span class="audience-label">Sent to</span>${invited.map(student => `<span class="part-chip">${escapeHtml(student.name)}</span>`).join("") || `<span class="part-chip muted">No students</span>`}</div>
            ${interests.length ? `<div class="interested-row"><span class="interested-label">Interested · ${interests.length}</span>${interests.map(interest => `<span class="interested-name">${escapeHtml(interest.student_name)}</span>`).join("")}</div>` : ""}
            ${renderNoiseShares(project.id)}
        </article>`;
    }).join("");
    renderProjectHistory(archived);
}

function projectHistoryRow(project) {
    const invited = Array.isArray(project.invited_students) ? project.invited_students.length : 0;
    return `
        <article class="history-row">
            <div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.teacher_name || "Teacher")}${project.location ? ` · ${escapeHtml(project.location)}` : ""} · ${invited} student${invited === 1 ? "" : "s"}</small><span>${escapeHtml(project.brief || "No brief given.")}</span></div>
            <div><b class="history-status archived">Ended</b><small>${escapeHtml(formatDay(projectLimitDate(project)))}</small></div>
        </article>`;
}

function renderProjectHistory(archived) {
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

async function loadProjects() {
    const { data, error } = await supabaseClient
        .from("project_proposals")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) {
        document.getElementById("projectList").innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load projects</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Project load error:", error);
        return;
    }
    allProjects = data || [];
    const { data: interests, error: interestsError } = await supabaseClient.from("project_interests").select("project_id, student_id, student_name");
    if (interestsError) { console.error("Interest load error:", interestsError); allInterests = []; }
    else allInterests = interests || [];
    const { data: shares, error: sharesError } = await supabaseClient.from("project_shares").select("*").order("created_at", { ascending: false });
    if (sharesError) { console.error("Share load error:", sharesError); allShares = []; }
    else allShares = shares || [];
    renderProjects();
}

/* ---------------- Noise — student shares of projects (oversight) ---------------- */

function renderNoiseShares(projectId) {
    const shares = allShares.filter(share => share.project_id === projectId && share.status !== "removed");
    if (!shares.length) return "";
    const rows = shares.map(share => {
        return `
            <div class="noise-invite-row">
                <span class="part-chip">${escapeHtml(share.sharer_name || "A student")}</span>
                <span class="share-arrow">→</span>
                <span class="part-chip">${escapeHtml(share.invitee_name || "A friend")}</span>
                <span class="share-chip">Coming</span>
                <div class="noise-invite-actions">
                    <button class="review-button standby" data-share-action="remove" data-share-id="${escapeHtml(share.id)}" type="button">Remove</button>
                </div>
            </div>`;
    }).join("");
    return `<div class="project-audience"><span class="audience-label">Student shares</span>
        <div class="noise-invite-list">${rows}</div>
    </div>`;
}

async function setShareStatus(shareId, status) {
    if (status === "removed") {
        const confirmed = window.confirm("Remove this friend from the project? This can't be undone.");
        if (!confirmed) return;
    }
    const { error } = await supabaseClient.from("project_shares").update({ status }).eq("id", shareId);
    if (error) { showToast("Could not update that share"); console.error("Share update error:", error); return; }
    showToast("Friend removed from the project");
    await loadProjects();
}

document.addEventListener("click", async event => {
    const shareAction = event.target.closest("[data-share-action]");
    if (!shareAction) return;
    await setShareStatus(shareAction.dataset.shareId, shareAction.dataset.shareAction === "remove" ? "removed" : "yes");
});

async function loadStudents() {
    const { data, error } = await supabaseClient.rpc("list_students");
    if (error) {
        console.error("Student list error:", error);
        students = [];
        document.getElementById("studentPicker").innerHTML = `<div class="empty-state compact-empty"><strong>Students unavailable</strong><p>${escapeHtml(error.message || "Could not load the student list.")}</p></div>`;
        return;
    }
    students = data || [];
    renderStudentPicker();
}

function gradeNumber(student) {
    const match = String(student.class_name || "").match(/\d+/);
    return match ? match[0] : "";
}

function addStudentsToSelection(list) {
    list.forEach(student => {
        selectedStudentMap[student.id] = { id: student.id, name: student.name || student.email, class_name: student.class_name || "" };
    });
    renderSelectedChips();
    renderStudentPicker(document.getElementById("studentSearch").value);
}

function renderStudentPicker(query = "") {
    const normalized = query.trim().toLowerCase();
    const picker = document.getElementById("studentPicker");
    const filtered = students.filter(student => !selectedStudentMap[student.id] && !reachStudentIds.has(student.id) && `${student.name} ${student.email} ${student.class_name || ""}`.toLowerCase().includes(normalized));
    if (!filtered.length) {
        picker.innerHTML = reachStudentIds.size
            ? `<div class="empty-state compact-empty"><strong>Every invited student is covered</strong><p>There is no one new to reach out to.</p></div>`
            : `<div class="empty-state compact-empty"><strong>No more students found</strong><p>Keep typing to search, or clear the query.</p></div>`;
        return;
    }
    picker.innerHTML = filtered.slice(0, 60).map(student => `
        <button class="student-option" type="button" data-student-id="${escapeHtml(student.id)}" data-student-name="${escapeHtml(student.name || student.email)}">${escapeHtml(student.name || student.email)}<small>${escapeHtml(student.email)}${student.class_name ? ` · Class ${escapeHtml(student.class_name)}` : ""}</small></button>
    `).join("");
}

function selectedCount() {
    return Object.keys(selectedStudentMap).length;
}

function renderSelectedChips() {
    const container = document.getElementById("selectedStudents");
    const selected = Object.values(selectedStudentMap);
    if (!selected.length) {
        container.innerHTML = projectModalMode === "new"
            ? `<span class="chips-hint">Choose the students this project should reach, then press Next.</span>`
            : `<span class="chips-hint">Choose new students to reach out to.</span>`;
    } else {
        container.innerHTML = selected.map(student => `
            <span class="invite-chip">${escapeHtml(student.name)}<button type="button" data-student-remove="${escapeHtml(student.id)}">×</button></span>
        `).join("");
    }
    renderAudienceNote();
    syncModalActions();
}

function renderAudienceNote() {
    const audienceNote = document.getElementById("editAudience");
    if (projectModalMode !== "edit") { audienceNote.style.display = "none"; return; }
    const invited = Object.values(selectedStudentMap);
    audienceNote.style.display = "block";
    audienceNote.innerHTML = invited.length
        ? `<span class="audience-label">Audience</span>${invited.map(student => `<span class="part-chip">${escapeHtml(student.name)}</span>`).join("")}`
        : `<span class="audience-label">No students invited yet — use Reach out to add some after publishing.</span>`;
}

function syncModalActions() {
    const next = document.getElementById("projectNext");
    const back = document.getElementById("projectBack");
    const submit = document.getElementById("projectSubmit");
    const hint = document.getElementById("projectModalHint");
    const onStudents = modalStep === "students";
    next.classList.toggle("hidden", !(onStudents && projectModalMode === "new"));
    back.classList.toggle("hidden", !(!onStudents && projectModalMode === "new"));
    submit.classList.toggle("hidden", !((onStudents && projectModalMode === "reach") || (!onStudents && projectModalMode !== "reach")));
    if (projectModalMode === "new") {
        hint.textContent = onStudents ? "Step 1 of 2 — pick who should see this project." : "Step 2 of 2 — anything unknown can be left blank and edited later.";
        next.disabled = onStudents && selectedCount() === 0;
        submit.disabled = false;
        submit.textContent = "Publish →";
    } else if (projectModalMode === "reach") {
        hint.textContent = "Only students you have not invited before appear here.";
        const count = selectedCount();
        submit.disabled = count === 0;
        submit.textContent = count ? `Send to ${count} more →` : "Select students…";
    } else {
        hint.textContent = "Update the details. Invites stay the same — use Reach out to add more.";
        submit.disabled = false;
        submit.textContent = "Save changes →";
    }
}

function setModalStep(step) {
    modalStep = step;
    document.getElementById("stepStudents").classList.toggle("active", step === "students");
    document.getElementById("stepForm").classList.toggle("active", step === "form");
    syncModalActions();
}

function openProjectModal(project = null, mode = "new") {
    projectModalMode = mode;
    editingProjectId = project?.id || null;
    reachStudentIds = new Set();
    document.getElementById("projectForm").reset();
    selectedStudentMap = {};
    document.getElementById("projectModalTitle").textContent = mode === "reach" ? "Reach out to more students" : (project ? "Edit project" : "New project");
    if (mode === "reach") {
        (project.invited_students || []).forEach(student => reachStudentIds.add(student.id));
    } else if (project) {
        document.getElementById("projectTitle").value = project.title || "";
        document.getElementById("projectDate").value = project.held_date || "";
        document.getElementById("projectDeadline").value = project.deadline || "";
        document.getElementById("projectMakeDeadline").value = project.make_deadline || "";
        document.getElementById("projectLocation").value = project.location || "";
        document.getElementById("projectTransport").value = project.school_transport || "";
        document.getElementById("projectWebsite").value = project.website || "";
        document.getElementById("projectFunding").value = project.school_funding || "";
        document.getElementById("projectBrief").value = project.brief || "";
        (project.invited_students || []).forEach(student => { selectedStudentMap[student.id] = { id: student.id, name: student.name || "Student" }; });
    }
    document.getElementById("studentSearch").value = "";
    renderSelectedChips();
    setModalStep(mode === "edit" ? "form" : "students");
    document.getElementById("projectModal").classList.add("open");
    document.getElementById("projectModal").setAttribute("aria-hidden", "false");
    renderStudentPicker();
    loadStudents();
}

function closeProjectModal() {
    document.getElementById("projectModal").classList.remove("open");
    document.getElementById("projectModal").setAttribute("aria-hidden", "true");
}

async function saveProject(event) {
    event.preventDefault();
    if (projectModalMode === "reach") {
        const additions = Object.values(selectedStudentMap);
        if (!additions.length) { showToast("Select at least one student"); return; }
        const project = allProjects.find(item => item.id === editingProjectId);
        const existing = Array.isArray(project?.invited_students) ? project.invited_students : [];
        const merged = [...existing];
        const known = new Set(existing.map(student => student.id));
        additions.forEach(student => { if (!known.has(student.id)) merged.push(student); });
        const { error } = await supabaseClient.from("project_proposals").update({ invited_students: merged, updated_at: new Date().toISOString() }).eq("id", editingProjectId);
        if (error) { showToast("Could not reach the selected students"); console.error("Reach out error:", error); return; }
        closeProjectModal();
        showToast(`Project sent to ${additions.length} new student${additions.length === 1 ? "" : "s"}`);
        await loadProjects();
        return;
    }
    const invitedStudents = projectModalMode === "edit" && editingProjectId
        ? (allProjects.find(item => item.id === editingProjectId)?.invited_students || [])
        : Object.values(selectedStudentMap);
    if (projectModalMode === "new" && !invitedStudents.length) { showToast("Pick at least one student first"); return; }
    const payload = {
        title: document.getElementById("projectTitle").value.trim(),
        held_date: document.getElementById("projectDate").value.trim(),
        deadline: document.getElementById("projectDeadline").value || null,
        make_deadline: document.getElementById("projectMakeDeadline").value || null,
        location: document.getElementById("projectLocation").value.trim(),
        school_transport: document.getElementById("projectTransport").value,
        website: document.getElementById("projectWebsite").value.trim(),
        brief: document.getElementById("projectBrief").value.trim(),
        school_funding: document.getElementById("projectFunding").value,
        invited_students: invitedStudents
    };
    if (!payload.title) { showToast("Give the project a name"); return; }
    if (Object.values(payload).some(value => typeof value === "string" && value.length > 1000)) { showToast("One of the fields is too long"); return; }
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Publishing...";
    const result = editingProjectId
        ? await supabaseClient.from("project_proposals").update(payload).eq("id", editingProjectId)
        : await supabaseClient.from("project_proposals").insert({ ...payload, teacher_id: currentUser.id, teacher_name: currentUser.name });
    button.disabled = false;
    button.textContent = "Publish →";
    if (result.error) {
        showToast("Could not save the project");
        console.error("Project save error:", result.error);
        return;
    }
    closeProjectModal();
    showToast(editingProjectId ? "Project updated" : `Project published to ${payload.invited_students.length} student${payload.invited_students.length === 1 ? "" : "s"}`);
    await loadProjects();
}

async function deleteProject(projectId) {
    if (!confirm("Delete this project? Students will no longer see it.")) return;
    const { error } = await supabaseClient.from("project_proposals").delete().eq("id", projectId);
    if (error) { showToast("Could not delete the project"); return; }
    showToast("Project deleted");
    await loadProjects();
}

/* ---------------- Events ---------------- */

document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => setTeacherTab(button.dataset.tab)));

const TEACHER_TAB_ORDER = ["overview", "parts", "collateral", "logs", "notice", "projects"];
document.addEventListener("keydown", event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (event.target && event.target.tagName) || "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || (event.target && event.target.isContentEditable)) return;
    if (document.querySelector(".modal-panel.open")) return;
    if (event.key === "/") {
        const firstField = document.querySelector(".teacher-view.active input:not([type=hidden]), .teacher-view.active textarea, .teacher-view.active select");
        if (firstField) { event.preventDefault(); firstField.focus(); }
        return;
    }
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < TEACHER_TAB_ORDER.length) {
        event.preventDefault();
        setTeacherTab(TEACHER_TAB_ORDER[index]);
    }
});
document.getElementById("teacherSignOut").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "teacher-login.html";
});
document.addEventListener("pointerdown", primeAudio, { capture: true });
document.getElementById("teacherAlertButton").addEventListener("click", requestAlerts);
syncAlertButton();

document.getElementById("teacherAnnouncementForm").addEventListener("submit", createTeacherAnnouncement);
Social.initComposer(document.getElementById("teacherAnnouncementForm"), { onNotice: showToast });
document.getElementById("teacherPostList").addEventListener("click", async event => {
    const commentAction = event.target.closest("[data-comment-action]");
    if (commentAction) {
        const commentEl = commentAction.closest("[data-comment-id]");
        if (!commentEl) return;
        if (commentAction.dataset.commentAction === "delete") {
            if (!confirm("Delete this comment?")) return;
            const { error } = await supabaseClient.rpc("delete_comment", { p_comment_id: commentEl.dataset.commentId });
            if (error) { showToast(/own comments/i.test(error.message || "") ? "You can only delete your own comments" : "Could not delete that comment"); console.error("Comment delete error:", error); return; }
            showToast("Comment deleted");
            return loadTeacherAnnouncements();
        }
        if (commentAction.dataset.commentAction === "edit") return startTeacherCommentEdit(commentEl);
        if (commentAction.dataset.commentAction === "cancelCommentEdit") return loadTeacherAnnouncements();
        return;
    }
    const button = event.target.closest("[data-post-action]");
    if (!button) return;
    const card = button.closest("[data-post-id]");
    const action = button.dataset.postAction;
    if (action === "like") return toggleTeacherLike(card.dataset.postId, button);
    if (action === "comment") return card.querySelector("[data-comments]").classList.toggle("open");
    if (action === "edit") return startTeacherPostEdit(card);
    if (action === "cancelEdit") return loadTeacherAnnouncements();
    if (action === "saveEdit") {
        const editor = card.querySelector(".post-edit-field");
        const body = (editor?.value || "").trim();
        if (!body) { showToast("Write something before saving"); editor?.focus(); return; }
        const { error } = await supabaseClient.rpc("teacher_edit_announcement", { p_announcement_id: card.dataset.postId, p_body: body });
        if (error) { showToast("Could not edit that announcement"); console.error("Announcement edit error:", error); return; }
        showToast("Announcement updated");
        return loadTeacherAnnouncements();
    }
    if (action === "delete") return deleteTeacherPost(card.dataset.postId);
});
document.getElementById("teacherPostList").addEventListener("submit", async event => {
    if (event.target.matches(".comment-edit-form")) {
        event.preventDefault();
        const textarea = event.target.querySelector("textarea");
        const body = (textarea?.value || "").trim();
        if (!body) return;
        const commentId = event.target.dataset.commentId;
        const { error } = await supabaseClient.rpc("edit_comment", { p_comment_id: commentId, p_body: body });
        if (error) { showToast(/own comments/i.test(error.message || "") ? "You can only edit your own comments" : "Could not edit that comment"); console.error("Comment edit error:", error); return; }
        showToast("Comment updated");
        return loadTeacherAnnouncements();
    }
    if (!event.target.matches(".comment-form")) return;
    event.preventDefault();
    const input = event.target.querySelector("input");
    const body = input.value.trim();
    if (!body) return;
    const postId = event.target.closest("[data-post-id]").dataset.postId;
    if (await onTeacherCommentCooldown(input)) return;
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Teacher";
    const { error } = await supabaseClient.from("announcement_comments").insert({ announcement_id: postId, author_id: currentUser.id, author_name: name, body });
    if (error) { showToast(/slow down/i.test(error.message || "") ? "Please slow down — wait a bit before commenting again" : "Could not add that comment"); return; }
    await loadTeacherAnnouncements();
    document.querySelector(`[data-post-id="${postId}"] [data-comments]`).classList.add("open");
});

async function onTeacherCommentCooldown(input) {
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

function openHistoryModal() {
    const backdrop = document.getElementById("historyBackdrop");
    document.getElementById("historyToggle").setAttribute("aria-expanded", "true");
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    renderProposalHistory(proposals.filter(proposal => proposal.status !== "pending"));
}

function closeHistoryModal() {
    const backdrop = document.getElementById("historyBackdrop");
    document.getElementById("historyToggle").setAttribute("aria-expanded", "false");
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
}

document.getElementById("historyToggle").addEventListener("click", openHistoryModal);
document.getElementById("historyClose").addEventListener("click", closeHistoryModal);
document.getElementById("historyBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeHistoryModal(); });
["historySearch", "historyStatus", "historyDateFrom", "historyDateTo"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => renderProposalHistory(proposals.filter(proposal => proposal.status !== "pending")));
    document.getElementById(id).addEventListener("change", () => renderProposalHistory(proposals.filter(proposal => proposal.status !== "pending")));
});

function openNoticeHistoryModal() {
    const backdrop = document.getElementById("noticeHistoryBackdrop");
    document.getElementById("noticeHistoryToggle").setAttribute("aria-expanded", "true");
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    renderNoticeHistory();
}

function closeNoticeHistoryModal() {
    const backdrop = document.getElementById("noticeHistoryBackdrop");
    document.getElementById("noticeHistoryToggle").setAttribute("aria-expanded", "false");
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
}

document.getElementById("noticeHistoryToggle").addEventListener("click", openNoticeHistoryModal);
document.getElementById("noticeHistoryClose").addEventListener("click", closeNoticeHistoryModal);
document.getElementById("noticeHistoryBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeNoticeHistoryModal(); });
["noticeHistorySearch", "noticeHistoryKind", "noticeHistoryFrom", "noticeHistoryTo"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderNoticeHistory);
    document.getElementById(id).addEventListener("change", renderNoticeHistory);
});

function openProjectHistoryModal() {
    const backdrop = document.getElementById("projectHistoryBackdrop");
    document.getElementById("projectHistoryToggle").setAttribute("aria-expanded", "true");
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    renderProjectHistory(allProjects.filter(project => isProjectArchived(project)));
}

function closeProjectHistoryModal() {
    const backdrop = document.getElementById("projectHistoryBackdrop");
    document.getElementById("projectHistoryToggle").setAttribute("aria-expanded", "false");
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
}

document.getElementById("projectHistoryToggle").addEventListener("click", openProjectHistoryModal);
document.getElementById("projectHistoryClose").addEventListener("click", closeProjectHistoryModal);
document.getElementById("projectHistoryBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeProjectHistoryModal(); });
["projectHistorySearch", "projectHistoryDateFrom", "projectHistoryDateTo"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => renderProjectHistory(allProjects.filter(project => isProjectArchived(project))));
    document.getElementById(id).addEventListener("change", () => renderProjectHistory(allProjects.filter(project => isProjectArchived(project))));
});

document.getElementById("newProjectButton").addEventListener("click", () => openProjectModal());
document.getElementById("projectClose").addEventListener("click", closeProjectModal);
document.getElementById("projectModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeProjectModal(); });
document.getElementById("projectForm").addEventListener("submit", saveProject);
document.getElementById("projectNext").addEventListener("click", () => setModalStep("form"));
document.getElementById("projectBack").addEventListener("click", () => setModalStep("students"));
document.getElementById("studentSearch").addEventListener("input", event => renderStudentPicker(event.target.value));
document.getElementById("studentSearch").addEventListener("keydown", event => { if (event.key === "Enter") event.preventDefault(); });
document.getElementById("gradeActions").addEventListener("click", event => {
    const button = event.target.closest("[data-grade]");
    if (!button) return;
    const grade = button.dataset.grade;
    const pool = students.filter(student => !selectedStudentMap[student.id] && !reachStudentIds.has(student.id));
    const target = grade === "all" ? pool : pool.filter(student => gradeNumber(student) === grade);
    if (!target.length) {
        showToast(grade === "all" ? "Everyone available is already selected" : `No unselected Grade ${grade} students`);
        return;
    }
    addStudentsToSelection(target);
});

document.getElementById("lendClose").addEventListener("click", closeLendModal);
document.getElementById("lendModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeLendModal(); });
document.getElementById("lendForm").addEventListener("submit", confirmLend);
document.getElementById("lendPhoto").addEventListener("change", onLendPhotoChange);
document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
document.getElementById("lightbox").addEventListener("click", event => { if (event.target === event.currentTarget) closeLightbox(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeLightbox(); });

document.getElementById("collateralLists").addEventListener("click", event => {
    const photo = event.target.closest("img.collateral-photo");
    if (photo) { openLightbox(photo.src, photo.alt); return; }
    const button = event.target.closest("[data-lend]");
    if (button) {
        const card = button.closest("[data-proposal-id]");
        const proposal = collateralProposals.find(item => item.id === card.dataset.proposalId);
        if (!proposal) return;
        if (button.dataset.lend === "start") openLendModal(proposal);
        else if (button.dataset.lend === "return") markReturned(proposal);
        return;
    }
    const card = event.target.closest(".collateral-card");
    if (card) card.classList.toggle("open");
});
document.getElementById("collateralSearch").addEventListener("input", renderCollateral);
document.getElementById("collateralStatus").addEventListener("change", renderCollateral);

const logsPicker = document.getElementById("logsDayPicker");
function logsShiftDay(offset) {
    const base = logsPicker.value ? new Date(`${logsPicker.value}T00:00:00`) : effectiveTeacherNow();
    logsPicker.value = localDayKey(addDaysTo(base, offset));
    logsRangeMode = "default";
    renderLogs();
}
document.getElementById("logsDayPrev").addEventListener("click", () => logsShiftDay(-1));
document.getElementById("logsDayNext").addEventListener("click", () => logsShiftDay(1));
logsPicker.addEventListener("change", () => { logsRangeMode = "default"; renderLogs(); });
document.getElementById("logsDayAll").addEventListener("click", () => { logsPicker.value = ""; logsRangeMode = "all"; renderLogs(); });
document.getElementById("logsSearch").addEventListener("input", renderLogs);
document.getElementById("logsFilter").addEventListener("change", renderLogs);
document.getElementById("teacherNoticeList").addEventListener("click", async event => {
    const button = event.target.closest("[data-teacher-notice-action]");
    if (!button) return;
    const notice = button.closest("[data-notice-id]");
    if (!notice || button.dataset.teacherNoticeAction !== "dismiss") return;
    await dismissTeacherNotice(notice.dataset.noticeId);
});
document.getElementById("studentPicker").addEventListener("click", event => {
    const option = event.target.closest("[data-student-id]");
    if (!option) return;
    selectedStudentMap[option.dataset.studentId] = { id: option.dataset.studentId, name: option.dataset.studentName };
    document.getElementById("studentSearch").value = "";
    renderSelectedChips();
    renderStudentPicker();
});
document.getElementById("selectedStudents").addEventListener("click", event => {
    const button = event.target.closest("[data-student-remove]");
    if (!button) return;
    delete selectedStudentMap[button.dataset.studentRemove];
    renderSelectedChips();
    renderStudentPicker();
});
document.getElementById("projectList").addEventListener("click", event => {
    const button = event.target.closest("[data-project-action]");
    if (!button) return;
    const card = button.closest("[data-project-id]");
    const project = allProjects.find(item => item.id === card.dataset.projectId);
    if (button.dataset.projectAction === "edit") openProjectModal(project);
    if (button.dataset.projectAction === "reach") openProjectModal(project, "reach");
    if (button.dataset.projectAction === "delete") deleteProject(project.id);
});

/* ---------------- Lab timings ---------------- */

let loadLabTimings = async function () {};

function initLabTimings() {
    const Lab = window.OtterLab;
    if (!Lab) return;

    Lab.init({
        mode: "teacher",
        supabase: supabaseClient,
        now: effectiveTeacherNow
    });

    const el = id => document.getElementById(id);
    const grid = el("labDayGrid");
    const periodList = el("labPeriodList");
    const timetableGrid = el("labTimetableGrid");
    if (!grid || !periodList) return;

    function render() {
        el("labMonthLabel").textContent = Lab.monthTitle(Lab.state.year, Lab.state.month);

        const stamp = Lab.state.selected;
        const parts = stamp ? Lab.splitStamp(stamp) : null;
        if (stamp) {
            const status = Lab.classifyDay(stamp);
            const isWeekend = status === Lab.DAY_WEEKEND;
            /* The holiday state comes from the draft, not from classifyDay:
               a teacher who has just flipped the switch but not yet published
               still needs the panel to show the holiday layout. */
            const isHoliday = Lab.state.holidayDraft;
            /* Read the name off the draft, not off the saved holidays map:
               a holiday the teacher has just switched on has not been
               published yet, so the map has nothing to give us. */
            const holidayName = (Lab.state.holidayNameDraft || "").trim() || "Holiday";
            el("labDayTitle").textContent = Lab.formatLong(stamp);
            el("labDaySubtitle").textContent = isWeekend ? "Weekend — not a teaching day."
                : isHoliday ? `Holiday — ${holidayName}.`
                : status === Lab.DAY_OPEN ? `Lab open · ${Lab.describeOpenPeriods(Lab.openPeriodsFor(stamp), Lab.state.periods)}`
                : "No lab published for this day.";

            el("labPeriodList").hidden = isWeekend || isHoliday;
            el("labBulk").hidden = isWeekend || isHoliday;
            el("labDayActions").hidden = false;
            el("labHolidayToggle").hidden = isWeekend;
            el("labHolidayName").hidden = isWeekend || !Lab.state.holidayDraft;

            if (isWeekend) {
                periodList.innerHTML = `<div class="empty-state"><strong>Weekend</strong><p>${parts.day} ${Lab.MONTH_NAMES[parts.month - 1]} is a ${Lab.weekdayOf(stamp) === 6 ? "Saturday" : "Sunday"}, so the lab is closed and nothing can be published.</p></div>`;
            } else if (isHoliday) {
                periodList.innerHTML = `<div class="empty-state"><strong>Holiday</strong><p>The whole day is off, so there are no periods to set. Students see this day greyed out.</p></div>`;
            } else {
                Lab.renderPeriodList(periodList, { editable: true, draft: Lab.state.draft });
            }

            el("labHolidaySwitch").setAttribute("aria-checked", String(Lab.state.holidayDraft));
            el("labHolidayToggle").classList.toggle("is-on", Lab.state.holidayDraft);
            el("labHolidayHint").textContent = Lab.state.holidayDraft
                ? `Marked as ${(Lab.state.holidayNameDraft || "").trim() || "a holiday"}. Students see this day greyed out.`
                : "A holiday is a full day off. The lab is closed and students see it greyed out.";
            if (el("labHolidayLabel").value !== Lab.state.holidayNameDraft && document.activeElement !== el("labHolidayLabel")) {
                el("labHolidayLabel").value = Lab.state.holidayNameDraft;
            }
            el("labSaveDay").disabled = isWeekend;
            el("labClearDay").disabled = isWeekend;
        } else {
            el("labDayTitle").textContent = "No day selected";
            el("labDaySubtitle").textContent = "Pick a date from the calendar.";
            periodList.innerHTML = "";
            el("labDayActions").hidden = true;
        }

        el("labSaveNote").textContent = Lab.state.dirty
            ? "Unsaved changes on this day."
            : "Changes save as soon as you publish the day.";

        const upcoming = Lab.nextLabDay(Lab.todayStamp());
        el("labCalendarHint").textContent = upcoming
            ? `Pick a day to set the lab timings for it. Next lab day: ${Lab.formatShort(upcoming)}.`
            : "Pick a day to set the lab timings for it. No lab days are published yet.";

        /* Header stat: how many lab days are on in the month on screen, so
           the count always matches the calendar being looked at. */
        const openThisMonth = Lab.monthGrid(Lab.state.year, Lab.state.month)
            .filter(day => day && Lab.classifyDay(day) === Lab.DAY_OPEN).length;
        setHeaderStat("labTimings", openThisMonth, openThisMonth === 1 ? "lab day this month" : "lab days this month");

        Lab.renderCalendar(grid);
        /* A realtime timetable change must not wipe a field mid-keystroke. */
        if (!timetableGrid.contains(document.activeElement)) Lab.renderTimetableGrid(timetableGrid);
    }

    async function reload(selectStamp) {
        await Lab.loadData();
        if (selectStamp) Lab.selectDay(selectStamp);
        render();
    }

    grid.addEventListener("click", event => {
        const button = event.target.closest("[data-lab-stamp]");
        if (!button) return;
        Lab.selectDay(button.dataset.labStamp);
        render();
    });

    el("labPrevMonth").addEventListener("click", () => { Lab.moveMonth(-1); render(); });
    el("labNextMonth").addEventListener("click", () => { Lab.moveMonth(1); render(); });
    el("labToday").addEventListener("click", () => {
        const parts = Lab.splitStamp(Lab.todayStamp());
        Lab.showMonth(parts.year, parts.month);
        Lab.selectDay(Lab.todayStamp());
        render();
    });

    el("labBulk").addEventListener("click", event => {
        const button = event.target.closest("[data-lab-all]");
        if (!button) return;
        Lab.setAllPeriods(button.dataset.labAll === "open");
        render();
    });

    periodList.addEventListener("click", event => {
        const button = event.target.closest("[data-lab-period]");
        if (!button) return;
        Lab.togglePeriod(Number(button.dataset.labPeriod));
        render();
    });

    el("labHolidaySwitch").addEventListener("click", () => {
        Lab.setHolidayDraft(!Lab.state.holidayDraft, Lab.state.holidayNameDraft);
        render();
    });

    el("labHolidayLabel").addEventListener("input", event => {
        Lab.state.holidayNameDraft = event.target.value;
    });

    el("labSaveDay").addEventListener("click", async () => {
        const result = await Lab.saveDay();
        if (result.ok) { showToast("Lab timings published"); render(); return; }
        showToast(result.missing
            ? "Run the lab timings SQL migration first"
            : result.validation || "Could not publish that day");
        if (result.missing) console.error("Lab timings migration missing:", result.error);
    });

    el("labClearDay").addEventListener("click", async () => {
        const result = await Lab.clearDay();
        if (result.ok) { showToast("Day cleared"); render(); return; }
        showToast(result.missing ? "Run the lab timings SQL migration first" : "Could not clear that day");
    });

    el("labSavePeriods").addEventListener("click", async () => {
        const result = await Lab.savePeriods(timetableGrid);
        if (result.ok) { showToast("Timetable saved"); render(); return; }
        showToast(result.missing ? "Run the lab timings SQL migration first" : result.validation || "Could not save the timetable");
    });

    el("labSaveDay").disabled = false;

    loadLabTimings = async function () { await reload(); };
    Lab.subscribe(() => reload());

    reload().then(() => {
        Lab.selectDay(Lab.todayStamp());
        render();
    });
}

/* ---------------- Init ---------------- */

async function loadTestClockState() {
    try {
        const { data, error } = await supabaseClient.rpc("read_sim_clock");
        if (error) throw error;
        const clock = Array.isArray(data) ? data[0] : data;
        simClock = { simulated_at: (clock && clock.simulated_at) ? clock.simulated_at : null, label: (clock && clock.label) ? clock.label : null };
    } catch (e) { simClock = { simulated_at: null, label: null }; }
    renderTeacherSimBanner();
}
function renderTeacherSimBanner() {
    const banner = document.getElementById("teacherSimBanner");
    if (banner) banner.remove();
}
async function refreshTeacherSimClock() {
    await loadTestClockState();
    await syncOverdueState();
    await Promise.all([loadNoticeData(), loadCollateral()]);
}
async function initialiseTeacher() {
    await loadTestClockState().catch(() => {});
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = "teacher-login.html"; return; }
    const { data: isTeacher, error } = await supabaseClient.rpc("is_teacher");
    if (error || !isTeacher) {
        await supabaseClient.auth.signOut();
        window.location.href = "teacher-login.html";
        return;
    }
    currentUser = user;
    window.OtterFavicon?.apply("teacher");
    const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Teacher";
    currentUser.name = displayName;
    document.getElementById("teacherIdentity").textContent = displayName;
    window.OtterAccount?.mount({
        client: supabaseClient,
        triggerId: "teacherIdentity",
        popoverId: "teacherAccountPopover",
        variant: "sidebar",
        label: "Teacher",
        name: displayName,
        email: user.email,
        signOutHref: "teacher-login.html",
        toast: showToast
    });
    initLabTimings();
    setTeacherTab("overview");
    if (window.OtterTutorial) {
        OtterTutorial.autostart("teacher", {
            theme: "light",
            onNavigate: step => { if (step.go) setTeacherTab(step.go); }
        });
    }
    await syncOverdueState();
    /* Prime the three arrival badges up front. Without this they stay empty
       until the teacher clicks into each tab, so a proposal that arrived
       while they were away would never raise a badge on a fresh load. */
    await Promise.all([loadTeacherAnnouncements(), updateTeacherPostLimit(), loadProposals(), loadCollateral(), loadProjects()]);

    supabaseClient.channel("teacher-proposal-feed")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "part_proposals" }, payload => {
            const who = payload.new?.student_name || "A student";
            primeAudio();
            playNotificationSound();
            showToast(`New proposal from ${who}`);
            showDesktopAlert("New part proposal", `${who} sent a part request.`, `otter-proposal-${payload.new?.id}`);
            loadProposals();
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "part_proposals" }, () => { loadProposals(); loadCollateral(); loadLogs(); })
        .subscribe();

    supabaseClient.channel("teacher-announcement-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, loadTeacherAnnouncements)
        .on("postgres_changes", { event: "*", schema: "public", table: "announcement_likes" }, loadTeacherAnnouncements)
        .on("postgres_changes", { event: "*", schema: "public", table: "announcement_comments" }, loadTeacherAnnouncements)
        .subscribe();

    supabaseClient.channel("teacher-project-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "project_proposals" }, loadProjects)
        .on("postgres_changes", { event: "*", schema: "public", table: "project_interests" }, loadProjects)
        .subscribe();

    supabaseClient.channel("teacher-noise-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "project_shares" }, loadProjects)
        .subscribe();

    supabaseClient.channel("teacher-notice-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "notices" }, loadNoticeData)
        .on("postgres_changes", { event: "*", schema: "public", table: "sim_clock" }, () => { refreshTeacherSimClock(); loadProposals(); })
        .subscribe();
}

initialiseTeacher()
    .catch(error => console.error("Teacher dashboard startup failed:", error))
    .finally(() => window.OtterLoading?.hide());