/* ============================================================
   ACCOUNT DELETION
   ------------------------------------------------------------
   One shared flow for all three consoles. A user opens their
   profile and picks "Delete account", gets an email OTP from
   Supabase, and only once that code verifies does the database
   wipe anything.

   The module owns its markup so the same dialog appears on the
   student, teacher and admin pages without three copies to keep
   in step. Each console passes its own Supabase client, sign-out
   destination and toast.

   Exposed as window.OtterAccount.
   ============================================================ */

(function () {
    "use strict";

    const CONFIRM_PHRASE = "DELETE";
    const CODE_MIN = 6;
    const CODE_MAX = 10;
    const RESEND_COOLDOWN = 30000;

    const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    const TRASH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
    const SIGN_OUT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';

    let session = null;
    let parts = null;
    let busy = false;
    let resendTimer = null;
    let lastFocused = null;

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

    function notify(message) {
        if (session && typeof session.toast === "function") session.toast(message);
    }

    /* ---------------- markup ---------------- */

    function dialogMarkup() {
        return `
<div class="ota-backdrop" id="otaDeleteBackdrop" hidden>
    <div class="ota-panel" role="dialog" aria-modal="true" aria-labelledby="otaDeleteTitle">
        <div class="ota-head">
            <div>
                <p class="ota-eyebrow">Account</p>
                <h2 id="otaDeleteTitle">Delete your account</h2>
            </div>
            <button class="ota-close" type="button" data-ota-cancel aria-label="Keep my account">${CLOSE_ICON}</button>
        </div>

        <div class="ota-body">
            <section class="ota-step" data-ota-step="confirm">
                <p class="ota-lead">Signing out is reversible. Deleting is not — this erases <strong>${escapeHtml(session.email)}</strong> for good:</p>
                <ul class="ota-list">
                    <li>your sign-in access and profile</li>
                    <li>every proposal, project share and announcement you wrote</li>
                    <li>every file you uploaded</li>
                    <li>your lab record — notices, bans and role</li>
                </ul>
                <label class="ota-field">
                    <span>Type <b>${CONFIRM_PHRASE}</b> to continue</span>
                    <input type="text" data-ota-confirm autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${CONFIRM_PHRASE}">
                </label>
            </section>

            <section class="ota-step" data-ota-step="code" hidden>
                <p class="ota-lead">We emailed a <strong>verification code</strong> to <strong>${escapeHtml(session.email)}</strong>. Enter it to finish.</p>
                <label class="ota-field ota-code-field">
                    <span>Verification code</span>
                    <input type="text" data-ota-code inputmode="numeric" autocomplete="one-time-code" maxlength="${CODE_MAX}" placeholder="000000" aria-describedby="otaCodeError">
                </label>
                <p class="ota-error" id="otaCodeError" data-ota-error hidden></p>
                <button class="ota-resend" type="button" data-ota-resend>Send a new code</button>
            </section>
        </div>

        <div class="ota-foot">
            <p class="ota-hint" data-ota-hint>We will check the code before anything is removed.</p>
            <button class="ota-button ota-button-danger" type="button" data-ota-submit>Send verification code</button>
        </div>
    </div>
</div>`;
    }

    function ensureDialog() {
        if (parts) return parts;

        const backdrop = build(dialogMarkup());
        document.body.appendChild(backdrop);

        parts = {
            backdrop,
            steps: [...backdrop.querySelectorAll("[data-ota-step]")],
            confirmField: backdrop.querySelector("[data-ota-confirm]"),
            codeField: backdrop.querySelector("[data-ota-code]"),
            error: backdrop.querySelector("[data-ota-error]"),
            resend: backdrop.querySelector("[data-ota-resend]"),
            submit: backdrop.querySelector("[data-ota-submit]"),
            hint: backdrop.querySelector("[data-ota-hint]")
        };

        backdrop.querySelector("[data-ota-cancel]").addEventListener("click", close);
        backdrop.addEventListener("mousedown", event => {
            if (event.target === backdrop && !busy) close();
        });

        parts.confirmField.addEventListener("input", () => {
            parts.submit.disabled = parts.confirmField.value.trim().toUpperCase() !== CONFIRM_PHRASE;
        });
        parts.confirmField.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                parts.submit.click();
            }
        });

        parts.codeField.addEventListener("input", () => {
            parts.codeField.value = parts.codeField.value.replace(/\D/g, "").slice(0, CODE_MAX);
            if (parts.codeField.value.length >= CODE_MIN) clearError();
        });
        parts.codeField.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                parts.submit.click();
            }
        });

        parts.resend.addEventListener("click", () => sendCode(true));
        parts.submit.addEventListener("click", () => {
            if (busy) return;
            if (stepName() === "confirm") sendCode();
            else verifyAndWipe();
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !backdrop.hidden && !busy) close();
        });

        return parts;
    }

    function stepName() {
        if (!parts) return "confirm";
        return parts.steps.find(step => !step.hidden)?.dataset.otaStep || "confirm";
    }

    function showStep(name) {
        if (!parts) return;
        parts.steps.forEach(step => { step.hidden = step.dataset.otaStep !== name; });
        clearError();
        const field = name === "confirm" ? parts.confirmField : parts.codeField;
        setTimeout(() => field.focus({ preventScroll: true }), 60);
    }

    function setError(message) {
        if (!parts) return;
        parts.error.textContent = message;
        parts.error.hidden = !message;
    }

    function clearError() {
        setError("");
    }

    /* ---------------- flow ---------------- */

    function open(options) {
        if (!options || !options.client || !options.email) return;

        session = options;
        busy = false;
        clearInterval(resendTimer);
        ensureDialog();

        parts.confirmField.value = "";
        parts.codeField.value = "";
        parts.submit.disabled = true;
        parts.submit.textContent = "Send verification code";
        parts.resend.hidden = true;
        parts.hint.textContent = "We will check the code before anything is removed.";
        showStep("confirm");

        lastFocused = document.activeElement;
        parts.backdrop.hidden = false;
        document.body.style.overflow = "hidden";
        setTimeout(() => parts.confirmField.focus({ preventScroll: true }), 60);
    }

    function close() {
        if (!parts || parts.backdrop.hidden) return;
        clearInterval(resendTimer);
        parts.backdrop.hidden = true;
        busy = false;
        if (!document.querySelector(".ota-backdrop:not([hidden])")) document.body.style.overflow = "";
        if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus({ preventScroll: true });
        lastFocused = null;
    }

    function setBusy(isBusy) {
        busy = isBusy;
        if (!parts) return;
        parts.submit.disabled = isBusy;
        parts.resend.disabled = isBusy;
    }

    function startResendCooldown() {
        if (!parts) return;
        let remaining = Math.ceil(RESEND_COOLDOWN / 1000);
        parts.resend.hidden = false;
        parts.resend.disabled = true;
        parts.resend.textContent = `Send a new code in ${remaining}s`;

        clearInterval(resendTimer);
        resendTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(resendTimer);
                parts.resend.disabled = false;
                parts.resend.textContent = "Send a new code";
                return;
            }
            parts.resend.textContent = `Send a new code in ${remaining}s`;
        }, 1000);
    }

    function describeSendError(error) {
        const message = String(error?.message || "");
        if (/rate|seconds/i.test(message)) return "Too many codes requested. Wait a minute, then try again.";
        if (/sign in|not found|invalid|provider/i.test(message)) return "We could not send a code to that address. Signing out is still available.";
        return "We could not send the code. Try again in a moment.";
    }

    async function sendCode(isResend) {
        if (busy || !session) return;
        setBusy(true);
        parts.submit.textContent = "Sending code...";
        clearError();

        /* signInWithOtp() sends a magic link by default and an OTP only when the
   template carries {{ .Token }} - see supabase/email-templates/otp.html.
   auth.reauthenticate() is NOT usable here: that nonce is only accepted by
   PUT /user for a password change, and "reauthentication" is not a valid
   /verify type, so verifyOtp rejects the code as invalid. */
        const { error } = await session.client.auth.signInWithOtp({
            email: session.email,
            options: { shouldCreateUser: false }
        });

        setBusy(false);

        if (error) {
            parts.submit.textContent = isResend ? "Verify and delete" : "Send verification code";
            setError(describeSendError(error));
            return;
        }

        parts.submit.disabled = false;
        parts.submit.textContent = "Verify and delete";
        parts.hint.textContent = "Nothing is deleted until the code checks out.";
        showStep("code");
        startResendCooldown();
    }

    function describeVerifyError(error) {
        const message = String(error?.message || "");
        if (/expired/i.test(message)) return "That code has expired. Send a new one.";
        if (/invalid|verify/i.test(message)) return "That code is not right. Check it and try again.";
        if (/rate|seconds/i.test(message)) return "Too many attempts. Wait a minute, then try again.";
        return "We could not check that code. Try again in a moment.";
    }

    function describeWipeError(error) {
        const message = String(error?.message || "");
        const code = String(error?.code || "");
        if (/last_admin/.test(message)) return "This is the last admin account. Promote another admin before deleting this one.";
        if (/not_signed_in/.test(message)) return "Your session expired. Sign in again to finish deleting.";
        if (/violates|foreign key|cascade/i.test(message)) return "Some records are still linked to the account. Ask an admin to remove them first.";
        if (code === "PGRST202" || /could not find the function/i.test(message)) {
            return "The delete function is missing from the database. Run supabase/account-deletion.sql in the Supabase SQL editor.";
        }
        if (code === "42501" || /permission denied/i.test(message)) {
            return "The database refused the delete. Re-run supabase/account-deletion.sql to fix the grants.";
        }
        return `The account could not be deleted (${code || "no code"}). See the console for details.`;
    }

    async function verifyAndWipe() {
        if (busy || !session) return;

        const token = parts.codeField.value.trim();
        if (token.length < CODE_MIN) {
            setError(`Enter the code from the email — at least ${CODE_MIN} digits.`);
            parts.codeField.focus();
            return;
        }

        setBusy(true);
        parts.submit.textContent = "Deleting...";
        clearError();

        /* Must match the flow that sent the code: signInWithOtp() issues an
           "email" OTP. Passing type "reauthentication" (the reauthenticate()
           nonce, which is only accepted by PUT /user for a password change)
           makes GoTrue answer "Token has expired or is invalid" for a
           perfectly good code. */
        const { error: verifyError } = await session.client.auth.verifyOtp({
            email: session.email,
            token,
            type: "email"
        });

        if (verifyError) {
            setBusy(false);
            parts.submit.textContent = "Verify and delete";
            parts.codeField.select();
            setError(describeVerifyError(verifyError));
            return;
        }

        const { error: wipeError } = await session.client.rpc("delete_my_account");

        if (wipeError) {
            console.error(
                "[otter] delete_my_account failed\n" + JSON.stringify({
                    code: wipeError.code,
                    message: wipeError.message,
                    details: wipeError.details,
                    hint: wipeError.hint
                }, null, 2)
            );
            setBusy(false);
            parts.submit.textContent = "Verify and delete";
            setError(describeWipeError(wipeError));
            /* verifyOtp() handed back a fresh session, so a dead one here means
               it really is gone. Put them back on the sign-in screen. */
            if (/not_signed_in/.test(String(wipeError.message))) {
                await session.client.auth.signOut();
                window.location.href = session.signOutHref || "index.html";
            }
            return;
        }

        await session.client.auth.signOut();
        notify("Account deleted.");
        window.location.href = session.signOutHref || "index.html";
    }

    /* ---------------- account actions ---------------- */

    async function signOutNow(options) {
        if (typeof options.onSignOut === "function") {
            await options.onSignOut();
            return;
        }
        await options.client.auth.signOut();
        window.location.href = options.signOutHref || "index.html";
    }

    function actionsMarkup(options) {
        return `
<div class="ota-actions" data-ota-variant="${options.variant === "sidebar" ? "sidebar" : "popover"}">
    <button class="ota-action" type="button" data-ota-signout>${SIGN_OUT_ICON}<span>Sign out</span></button>
    <button class="ota-action ota-action-danger" type="button" data-ota-delete>${TRASH_ICON}<span>Delete account</span></button>
</div>`;
    }

    function wireActions(container, options) {
        container.addEventListener("click", async event => {
            const trigger = event.target.closest("[data-ota-signout], [data-ota-delete]");
            if (!trigger || !options.client) return;

            if (trigger.hasAttribute("data-ota-signout")) {
                trigger.disabled = true;
                await signOutNow(options);
                return;
            }

            const { data: { user } } = await options.client.auth.getUser();
            if (!user?.email) {
                notify("We could not read your account email. Try signing out instead.");
                return;
            }
            open({
                client: options.client,
                email: user.email,
                signOutHref: options.signOutHref,
                toast: options.toast
            });
        });
    }

    function renderActions(host, options) {
        if (!host || !options || !options.client) return null;
        host.innerHTML = actionsMarkup(options);
        wireActions(host, options);
        return host;
    }

    function attachPopover(options) {
        const { trigger, panel } = options;
        if (!trigger || !panel) return null;

        function setOpen(isOpen) {
            trigger.setAttribute("aria-expanded", String(isOpen));
            panel.hidden = !isOpen;
        }

        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", "false");
        setOpen(false);

        trigger.addEventListener("click", () => setOpen(panel.hidden));

        panel.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                setOpen(false);
                trigger.focus();
            }
        });

        document.addEventListener("click", event => {
            if (panel.hidden) return;
            if (event.target === trigger || trigger.contains(event.target)) return;
            if (!event.target.closest("[data-ota-popover]")) setOpen(false);
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !panel.hidden && !trigger.contains(document.activeElement)) setOpen(false);
        });

        return { close: () => setOpen(false), open: () => setOpen(true) };
    }

    function buildPopover(options) {
        const panel = build(`
<div class="ota-popover" data-ota-popover hidden>
    <p class="ota-popover-label">${escapeHtml(options.label || "Account")}</p>
    <p class="ota-popover-name">${escapeHtml(options.name || "Signed in")}</p>
    <p class="ota-popover-email">${escapeHtml(options.email || "")}</p>
    <div class="ota-popover-divider"></div>
    <div data-ota-host></div>
</div>`);

        document.body.appendChild(panel);
        renderActions(panel.querySelector("[data-ota-host]"), options);
        return panel;
    }

    function positionPanel(trigger, panel) {
        if (panel.hidden) return;
        const anchor = trigger.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const gap = 8;
        const edge = 12;

        /* The trigger can sit anywhere - the teacher and admin footers are at
           the bottom of a tall sidebar, so the panel is flipped above it when
           there is no room below, then clamped so it never opens off-screen. */
        const left = Math.min(
            Math.max(edge, anchor.left),
            Math.max(edge, window.innerWidth - width - edge)
        );

        const below = anchor.bottom + gap;
        const flipped = below + height > window.innerHeight - edge;
        const top = Math.min(
            Math.max(edge, flipped ? anchor.top - height - gap : below),
            Math.max(edge, window.innerHeight - height - edge)
        );

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
    }

    function mount(options) {
        if (!options || !options.client) return null;
        const trigger = document.getElementById(options.triggerId);
        if (!trigger) return null;

        if (options.name) trigger.textContent = options.name;

        const panel = buildPopover(options);
        if (options.popoverId) panel.id = options.popoverId;

        const popover = attachPopover({ trigger, panel });

        /* Registered after attachPopover, so the panel is already open and
           measurable. Positioned inline rather than on the next frame:
           a throttled frame would leave it parked at its static spot. */
        trigger.addEventListener("click", () => positionPanel(trigger, panel));
        window.addEventListener("resize", () => positionPanel(trigger, panel));

        return popover;
    }

    window.OtterAccount = {
        mount,
        mountActions: renderActions,
        attachPopover,
        buildPopover,
        open,
        close
    };
})();