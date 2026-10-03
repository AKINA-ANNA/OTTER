/* ============================================================
   ROLE FAVICON
   ------------------------------------------------------------
   Swaps the browser tab icon to match the signed-in user's role.

   Each console already knows its own role by the time it finishes
   its guard (students are simply "not admin and not teacher"), so
   this module only has to take a role string and write the icon.
   It is deliberately the single owner of the <link> elements: every
   page ships the same two-tag pair, and rel="shortcut icon" still
   tokenises as rel~="icon", so one selector covers both.

   Pages with no icon at all get one created rather than left blank,
   and an unrecognised or missing role falls back to the student icon
   because the student portal is the default landing page.

   No cache-busting query is needed: each role owns a distinct URL, so
   the browser never has a stale file at the path we point it at.

   Exposed as window.OtterFavicon.
   ============================================================ */

(function () {
    "use strict";

    /* Matches the role gating in Postgres: is_admin() and is_teacher().
       Anything that is neither is treated as a student. */
    const FALLBACK_ROLE = "student";

    /* Browsers hold favicons in their own cache and will not re-request a
       URL they have already seen, so replacing the image files on disk
       changes nothing on screen until the href itself changes. Bump this
       whenever you swap the artwork, and mirror it in the <link> tags. */
    const VERSION = "3";

    const ROLE_ICONS = {
        student: { png: "favicon-student.png", ico: "favicon-student.ico" },
        teacher: { png: "favicon-teacher.png", ico: "favicon-teacher.ico" },
        admin: { png: "favicon-admin.png", ico: "favicon-admin.ico" }
    };

    function versioned(file) {
        return `${file}?v=${VERSION}`;
    }

    let applied = null;

    function normaliseRole(role) {
        const value = String(role ?? "").trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(ROLE_ICONS, value) ? value : FALLBACK_ROLE;
    }

    function iconLinks() {
        const links = Array.from(document.querySelectorAll('link[rel~="icon"]'));
        if (links.length) return links;
        /* No favicon declared in the markup - add one so the tab never
           falls back to the browser's generic page icon. */
        const link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
        return [link];
    }

    function apply(role) {
        const resolved = normaliseRole(role);
        if (resolved === applied) return resolved;
        const icons = ROLE_ICONS[resolved];
        iconLinks().forEach(link => {
            const legacy = /\bshortcut\b/i.test(link.rel);
            link.type = legacy ? "image/x-icon" : "image/png";
            link.href = legacy ? versioned(icons.ico) : versioned(icons.png);
        });
        applied = resolved;
        return resolved;
    }

    window.OtterFavicon = {
        FALLBACK_ROLE,
        VERSION,
        ROLE_ICONS,
        normaliseRole,
        apply,
        currentRole() { return applied; }
    };
})();