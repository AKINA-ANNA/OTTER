const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const errorElement = document.querySelector(".auth-error");
const message = text => { errorElement.textContent = text; errorElement.classList.remove("ok"); };
const report = (el, text, ok) => {
    el.textContent = text;
    el.classList.toggle("ok", Boolean(ok));
};

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

/* The invite code is captured at sign-up into user metadata. With email
   confirmation on, signUp() returns no session so claim_admin_invite() cannot
   run until the address is verified; the stored code is what lets activation
   finish at first sign-in instead of leaving the admin locked out. */
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
        window.OtterLoading?.show();
        try {
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: document.getElementById("adminEmail").value.trim(),
                password: document.getElementById("adminPassword").value
            });
            if (error) {
                if (/not confirmed/i.test(error.message)) {
                    message("Confirm that email first, then sign in. Check your inbox for the confirmation link.");
                } else {
                    message("That admin email or password is not valid.");
                }
                window.OtterLoading?.hide();
                return;
            }
            const { data: isAdmin, error: roleError } = await supabaseClient.rpc("is_admin");
            if (roleError || !isAdmin) {
                /* Not an admin yet. If sign-up happened while email confirmation
                   was on, the invite was never claimed - finish it now that the
                   address is verified and a session exists. The invite field only
                   exists on the sign-up page, so the code comes from metadata. */
                const { data: userData } = await supabaseClient.auth.getUser();
                const activated = roleError ? false : await claimInvite(storedInviteCode(userData?.user));
                if (!activated) {
                    await supabaseClient.auth.signOut();
                    message(roleError
                        ? "Could not check admin access right now. Try again."
                        : "This account does not have admin access.");
                    window.OtterLoading?.hide();
                    return;
                }
            }
            window.OtterFavicon?.apply("admin");
            window.location.href = "admin.html";
        } catch (error) {
            console.error("Admin sign-in failed:", error);
            message("Could not sign in right now. Check your connection and try again.");
            window.OtterLoading?.hide();
        }
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
        const button = adminResetForm.querySelector("button[type=submit]");
        const original = button.textContent;
        button.disabled = true;
        button.textContent = "Resetting…";
        const { data, error } = await supabaseClient.rpc("reset_password_via_invite", {
            p_role: "admin",
            p_email: email,
            p_invite_code: invite,
            p_new_password: password
        });
        button.disabled = false;
        button.textContent = original;
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
}

const signupForm = document.getElementById("adminSignupForm");
if (signupForm) {
    signupForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");
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
                    message("That account exists but its email is not confirmed yet. Confirm it, then sign in on Admin login.");
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
        message("Almost there — open the confirmation link we just emailed you, then sign in on Admin login. Your invite code is applied automatically at that first sign-in.");
    });
}
