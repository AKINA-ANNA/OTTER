const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";

let _supabaseClient = null;
function getSupabaseClient() {
    if (!_supabaseClient) {
        if (!window.supabase || !window.supabase.createClient) {
            throw new Error("Supabase library not loaded yet. Please wait and try again.");
        }
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _supabaseClient;
}

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
    }, 200);
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
        setTimeout(() => {
            window.OtterLoading?.hide();
            setButtonLoading(form, false);
        }, 150);
    }
}

async function verifyTeacher() {
    try {
        const { data: { user } } = await getSupabaseClient().auth.getUser();
        if (!user) return false;
        // First try form field, then fall back to user metadata
        let inviteCode = document.getElementById("teacherInvite")?.value;
        if (!inviteCode) {
            inviteCode = user.user_metadata?.teacher_invite_code || user.user_metadata?.invite_code;
        }
        if (inviteCode) {
            const { error: metadataError } = await getSupabaseClient().auth.updateUser({
                data: { teacher_invite_code: inviteCode }
            });
            if (metadataError) return false;
        }
        let rpcResult;
        try {
            rpcResult = await getSupabaseClient().rpc("claim_teacher_invite", {
                invite_code: inviteCode || null
            });
        } catch (rpcError) {
            console.error("Claim invite RPC error:", rpcError);
            message("Could not connect. Check your internet and try again.");
            return false;
        }
        const { data, error } = rpcResult;
        if (error) {
            message(`Teacher activation error: ${error.message}`);
            return false;
        }
        if (!data) {
            message("The invite code was not accepted or has already been used.");
            return false;
        }
        return true;
    } catch (err) {
        console.error("verifyTeacher error:", err);
        return false;
    }
}

const storedInviteCode = user => String(user?.user_metadata?.teacher_invite_code || "").trim();

async function claimInvite(inviteCode) {
    if (!inviteCode) return false;
    let rpcResult;
    try {
        rpcResult = await getSupabaseClient().rpc("claim_teacher_invite", { invite_code: inviteCode });
    } catch (rpcError) {
        console.error("Claim invite RPC error:", rpcError);
        return false;
    }
    const { data, error } = rpcResult;
    if (error || !data) return false;
    let teacherResult;
    try {
        teacherResult = await getSupabaseClient().rpc("is_teacher");
    } catch (teacherRpcError) {
        console.error("is_teacher RPC error:", teacherRpcError);
        return false;
    }
    return Boolean(teacherResult.data);
}

const loginForm = document.getElementById("teacherLoginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");

        await withLoading(loginForm, async () => {
            let signInResult;
            try {
                signInResult = await getSupabaseClient().auth.signInWithPassword({
                    email: document.getElementById("teacherEmail").value.trim(),
                    password: document.getElementById("teacherPassword").value
                });
            } catch (networkError) {
                console.error("Sign in network error:", networkError);
                message("Could not connect. Check your internet and try again.");
                return;
            }

            const { error } = signInResult;
            if (error) {
                if (/not confirmed/i.test(error.message)) {
                    showEmailConfirmModal(document.getElementById("teacherEmail").value.trim());
                } else {
                    message("That teacher email or password is not valid.");
                }
                return;
            }
            const { data: isTeacher, error: roleError } = await getSupabaseClient().rpc("is_teacher");
            if (roleError || !isTeacher) {
                const { data: userData } = await getSupabaseClient().auth.getUser();
                const activated = roleError ? false : await claimInvite(storedInviteCode(userData?.user));
                if (!activated) {
                    await getSupabaseClient().auth.signOut();
                    message(roleError
                        ? "Could not check teacher access right now. Try again."
                        : "This account does not have teacher access.");
                    return;
                }
            }
            window.OtterFavicon?.apply("teacher");
            window.location.href = "teacher.html";
        });
    });
}

const teacherResetForm = document.getElementById("teacherResetForm");
const teacherShowReset = document.getElementById("teacherShowReset");
const teacherHideReset = document.getElementById("teacherHideReset");
if (teacherResetForm && teacherShowReset && teacherHideReset) {
    const resetError = document.getElementById("teacherResetError");
    teacherShowReset.addEventListener("click", event => {
        event.preventDefault();
        loginForm.hidden = true;
        teacherResetForm.hidden = false;
        teacherShowReset.closest(".auth-switch").hidden = true;
        document.getElementById("teacherResetEmail").value = document.getElementById("teacherEmail").value;
        message("");
        document.getElementById("teacherResetEmail").focus();
    });
    teacherHideReset.addEventListener("click", event => {
        event.preventDefault();
        teacherResetForm.hidden = true;
        teacherShowReset.closest(".auth-switch").hidden = false;
        report(resetError, "", false);
        loginForm.hidden = false;
        document.getElementById("teacherPassword").focus();
    });
    teacherResetForm.addEventListener("submit", async event => {
        event.preventDefault();
        report(resetError, "", false);
        const email = document.getElementById("teacherResetEmail").value.trim();
        const invite = document.getElementById("teacherResetCode").value.trim();
        const password = document.getElementById("teacherResetPassword").value;
        const password2 = document.getElementById("teacherResetPassword2").value;
        if (!email) { report(resetError, "Enter the teacher email.", false); return; }
        if (!invite) { report(resetError, "Enter your invite code.", false); return; }
        if (password.length < 6) { report(resetError, "The new password must be at least 6 characters.", false); return; }
        if (password !== password2) { report(resetError, "The two passwords do not match.", false); return; }

        await withLoading(teacherResetForm, async () => {
            let rpcResult;
            try {
                rpcResult = await getSupabaseClient().rpc("reset_password_via_invite", {
                    p_role: "teacher",
                    p_email: email,
                    p_invite_code: invite,
                    p_new_password: password
                });
            } catch (rpcError) {
                console.error("RPC network error:", rpcError);
                report(resetError, "Could not connect. Check your internet and try again.", false);
                return;
            }
            const { data, error } = rpcResult;
            if (error) {
                const text = error.message.toLowerCase();
                if (text.includes("too_many_tries")) { report(resetError, "Too many attempts from this email. Wait 10 minutes and try again.", false); return; }
                if (text.includes("invalid_invite")) { report(resetError, "That invite code was not accepted.", false); return; }
                if (text.includes("no_account")) { report(resetError, "No teacher account exists for that email.", false); return; }
                if (data === false) { report(resetError, "Could not reset that password.", false); return; }
                report(resetError, error.message, false);
                return;
            }
            teacherResetForm.hidden = true;
            teacherShowReset.closest(".auth-switch").hidden = false;
            loginForm.hidden = false;
            document.getElementById("teacherEmail").value = email;
            document.getElementById("teacherPassword").value = "";
            report(errorElement, "Password reset. Sign in with your new password.", true);
            document.getElementById("teacherPassword").focus();
        });
    });
}

const signupForm = document.getElementById("teacherSignupForm");
if (signupForm) {
    signupForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");

        await withLoading(signupForm, async () => {
            const password = document.getElementById("teacherPassword").value;
            if (!password) { message("Enter the password for your student account."); return; }
            let signUpResult;
            try {
                signUpResult = await getSupabaseClient().auth.signUp({
                    email: document.getElementById("teacherEmail").value.trim(),
                    password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/teacher-login.html`,
                        data: {
                            full_name: document.getElementById("teacherName").value.trim(),
                            teacher_invite_code: document.getElementById("teacherInvite").value
                        }
                    }
                });
            } catch (networkError) {
                console.error("Sign up network error:", networkError);
                message("Could not connect. Check your internet and try again.");
                return;
            }

            const { data, error } = signUpResult;
            const existingAccount = error && (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already been registered"));
            const existingEmailResponse = data?.user && data.user.identities?.length === 0;
            if (existingAccount || existingEmailResponse) {
                let loginResult;
                try {
                    loginResult = await getSupabaseClient().auth.signInWithPassword({
                        email: document.getElementById("teacherEmail").value.trim(),
                        password
                    });
                } catch (loginNetworkError) {
                    console.error("Login network error:", loginNetworkError);
                    message("Could not connect. Check your internet and try again.");
                    return;
                }
                const { error: loginError } = loginResult;
                if (loginError) {
                    if (/not confirmed/i.test(loginError.message)) {
                        showEmailConfirmModal(document.getElementById("teacherEmail").value.trim());
                    } else {
                        message("That password does not match the student account.");
                    }
                    return;
                }
                const claimed = await verifyTeacher();
                if (!claimed) { message("The invite code was not accepted."); return; }
                window.OtterFavicon?.apply("teacher");
                window.location.href = "teacher.html";
                return;
            }
            if (error) {
                const errorText = error.message.toLowerCase();
                if (errorText.includes("rate limit") || errorText.includes("too many")) {
                    message("Supabase email rate limit reached. Wait a few minutes before trying again.");
                } else if (errorText.includes("already registered") || errorText.includes("already been registered")) {
                    message("This email already has an account. Confirm it if needed, then use Teacher login.");
                } else {
                    message(error.message);
                }
                return;
            }
            if (data.session) {
                const claimed = await verifyTeacher();
                if (!claimed) { message("The invite code was not accepted."); return; }
                window.OtterFavicon?.apply("teacher");
                window.location.href = "teacher.html";
                return;
            }
            showEmailConfirmModal(document.getElementById("teacherEmail").value.trim());
        });
    });
}