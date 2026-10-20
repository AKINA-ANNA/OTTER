const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const errorElement = document.querySelector(".auth-error");
const message = text => { errorElement.textContent = text; errorElement.classList.remove("ok"); };
const report = (el, text, ok) => {
    el.textContent = text;
    el.classList.toggle("ok", Boolean(ok));
};

// Show email confirmation modal
function showEmailConfirmModal(email) {
    const modal = document.getElementById("emailConfirmModal");
    const emailEl = document.getElementById("confirmEmail");
    const closeBtn = document.getElementById("emailConfirmClose");
    if (modal && emailEl) {
        emailEl.textContent = email;
        modal.hidden = false;
        modal.removeAttribute("aria-hidden");
        modal.classList.remove("closing");
        if (closeBtn) {
            closeBtn.focus();
            closeBtn.onclick = () => closeModal(modal);
        }
        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) closeModal(modal);
        };
        // Close on Escape
        const escHandler = (e) => {
            if (e.key === "Escape") {
                closeModal(modal);
                document.removeEventListener("keydown", escHandler);
            }
        };
        document.addEventListener("keydown", escHandler);
    }
}

function closeModal(modal) {
    if (!modal || modal.classList.contains("closing")) return;
    modal.classList.add("closing");
    setTimeout(() => {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        modal.classList.remove("closing");
    }, 200); // matches CSS animation duration
}
    
// Helper to set loading state on a form submit button
function setButtonLoading(form, isLoading) {
    const button = form.querySelector("button[type=submit]");
    if (!button) return;
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.textContent = "Loading…";
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText || button.textContent;
    }
}

// Robust loading wrapper - ensures hide is always called
async function withLoading(form, fn) {
    setButtonLoading(form, true);
    window.OtterLoading?.show({ fast: true });
    try {
        return await fn();
    } finally {
        // Small delay to prevent flash, then hide
        setTimeout(() => {
            window.OtterLoading?.hide();
            setButtonLoading(form, false);
        }, 150);
    }
}

async function verifyAdmin() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return false;
    const inviteCode = document.getElementById("adminInvite")?.value;
    if (inviteCode) {
        const { error: metadataError } = await supabaseClient.auth.updateUser({
            data: { admin_invite_code: inviteCode }
        });
        if (metadataError) return false;
    }
    const { data, error } = await supabaseClient.rpc("claim_admin_invite", {
        invite_code: inviteCode || null
    });
    if (error) {
        message(`Admin activation error: ${error.message}`);
        return false;
    }
    if (!data) {
        message("The invite code was not accepted or has already been used.");
        return false;
    }
    return true;
}

const storedInviteCode = user => String(user?.user_metadata?.admin_invite_code || "").trim();

async function claimInvite(inviteCode) {
    if (!inviteCode) return false;
    const { data, error } = await supabaseClient.rpc("claim_admin_invite", { invite_code: inviteCode });
    if (error || !data) return false;
    const { data: isAdmin } = await supabaseClient.rpc("is_admin");
    return Boolean(isAdmin);
}

const loginForm = document.getElementById("adminLoginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");

        await withLoading(loginForm, async () => {
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: document.getElementById("adminEmail").value.trim(),
                password: document.getElementById("adminPassword").value
            });
            if (error) {
                if (/not confirmed/i.test(error.message)) {
                    showEmailConfirmModal(document.getElementById("adminEmail").value.trim());
                } else {
                    message("That admin email or password is not valid.");
                }
                return;
            }
            const { data: isAdmin, error: roleError } = await supabaseClient.rpc("is_admin");
            if (roleError || !isAdmin) {
                const { data: userData } = await supabaseClient.auth.getUser();
                const activated = roleError ? false : await claimInvite(storedInviteCode(userData?.user));
                if (!activated) {
                    await supabaseClient.auth.signOut();
                    message(roleError
                        ? "Could not check admin access right now. Try again."
                        : "This account does not have admin access.");
                    return;
                }
            }
            window.OtterFavicon?.apply("admin");
            window.location.href = "admin.html";
        });
    });
}

const adminResetForm = document.getElementById("adminResetForm");
const adminShowReset = document.getElementById("adminShowReset");
const adminHideReset = document.getElementById("adminHideReset");
if (adminResetForm && adminShowReset && adminHideReset) {
    const resetError = document.getElementById("adminResetError");
    adminShowReset.addEventListener("click", event => {
        event.preventDefault();
        loginForm.hidden = true;
        adminResetForm.hidden = false;
        adminShowReset.closest(".auth-switch").hidden = true;
        document.getElementById("adminResetEmail").value = document.getElementById("adminEmail").value;
        message("");
        document.getElementById("adminResetEmail").focus();
    });
    adminHideReset.addEventListener("click", event => {
        event.preventDefault();
        adminResetForm.hidden = true;
        adminShowReset.closest(".auth-switch").hidden = false;
        report(resetError, "", false);
        loginForm.hidden = false;
        document.getElementById("adminPassword").focus();
    });
    adminResetForm.addEventListener("submit", async event => {
        event.preventDefault();
        report(resetError, "", false);
        const email = document.getElementById("adminResetEmail").value.trim();
        const invite = document.getElementById("adminResetCode").value.trim();
        const password = document.getElementById("adminResetPassword").value;
        const password2 = document.getElementById("adminResetPassword2").value;
        if (!email) { report(resetError, "Enter the admin email.", false); return; }
        if (!invite) { report(resetError, "Enter your invite code.", false); return; }
        if (password.length < 6) { report(resetError, "The new password must be at least 6 characters.", false); return; }
        if (password !== password2) { report(resetError, "The two passwords do not match.", false); return; }

        await withLoading(adminResetForm, async () => {
            const { data, error } = await supabaseClient.rpc("reset_password_via_invite", {
                p_role: "admin",
                p_email: email,
                p_invite_code: invite,
                p_new_password: password
            });
            if (error) {
                const text = error.message.toLowerCase();
                if (text.includes("too_many_tries")) { report(resetError, "Too many attempts from this email. Wait 10 minutes and try again.", false); return; }
                if (text.includes("invalid_invite")) { report(resetError, "That invite code was not accepted.", false); return; }
                if (text.includes("no_account")) { report(resetError, "No admin account exists for that email.", false); return; }
                if (data === false) { report(resetError, "Could not reset that password.", false); return; }
                report(resetError, error.message, false);
                return;
            }
            adminResetForm.hidden = true;
            adminShowReset.closest(".auth-switch").hidden = false;
            loginForm.hidden = false;
            document.getElementById("adminEmail").value = email;
            document.getElementById("adminPassword").value = "";
            report(errorElement, "Password reset. Sign in with your new password.", true);
            document.getElementById("adminPassword").focus();
        });
    });
}

const signupForm = document.getElementById("adminSignupForm");
if (signupForm) {
    signupForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");

        await withLoading(signupForm, async () => {
            const password = document.getElementById("adminPassword").value;
            if (!password) { message("Enter the password for your student account."); return; }
            const { data, error } = await supabaseClient.auth.signUp({
                email: document.getElementById("adminEmail").value.trim(),
                password,
                options: {
                    emailRedirectTo: `${window.location.origin}/admin-login.html`,
                    data: {
                        full_name: document.getElementById("adminName").value.trim(),
                        admin_invite_code: document.getElementById("adminInvite").value
                    }
                }
            });
            const existingAccount = error && (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already been registered"));
            const existingEmailResponse = data?.user && data.user.identities?.length === 0;
            if (existingAccount || existingEmailResponse) {
                const { error: loginError } = await supabaseClient.auth.signInWithPassword({
                    email: document.getElementById("adminEmail").value.trim(),
                    password
                });
                if (loginError) {
                    if (/not confirmed/i.test(loginError.message)) {
                        showEmailConfirmModal(document.getElementById("adminEmail").value.trim());
                    } else {
                        message("That password does not match the student account.");
                    }
                    return;
                }
                const claimed = await verifyAdmin();
                if (!claimed) { message("The invite code was not accepted."); return; }
                window.OtterFavicon?.apply("admin");
                window.location.href = "admin.html";
                return;
            }
            if (error) {
                const errorText = error.message.toLowerCase();
                if (errorText.includes("rate limit") || errorText.includes("too many")) {
                    message("Supabase email rate limit reached. Wait a few minutes before trying again.");
                } else if (errorText.includes("already registered") || errorText.includes("already been registered")) {
                    message("This email already has an account. Confirm it if needed, then use Admin login.");
                } else {
                    message(error.message);
                }
                return;
            }
            if (data.session) {
                const claimed = await verifyAdmin();
                if (!claimed) { message("The invite code was not accepted."); return; }
                window.OtterFavicon?.apply("admin");
                window.location.href = "admin.html";
                return;
            }
            showEmailConfirmModal(document.getElementById("adminEmail").value.trim());
        });
    });
}