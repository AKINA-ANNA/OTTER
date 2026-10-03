const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const errorElement = document.querySelector(".auth-error");
const message = text => { errorElement.textContent = text; errorElement.classList.remove("ok"); };
const report = (el, text, ok) => {
    el.textContent = text;
    el.classList.toggle("ok", Boolean(ok));
};

async function verifyTeacher() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return false;
    const inviteCode = document.getElementById("teacherInvite")?.value;
    if (inviteCode) {
        const { error: metadataError } = await supabaseClient.auth.updateUser({
            data: { teacher_invite_code: inviteCode }
        });
        if (metadataError) return false;
    }
    const { data, error } = await supabaseClient.rpc("claim_teacher_invite", {
        invite_code: inviteCode || null
    });
    if (error) {
        message(`Teacher activation error: ${error.message}`);
        return false;
    }
    if (!data) {
        message("The invite code was not accepted or has already been used.");
        return false;
    }
    return true;
}

/* The invite code is captured at sign-up into user metadata. When email
   confirmation is on, signUp() returns no session, so claim_teacher_invite()
   cannot run until the address is verified - the stored code is what lets
   activation finish at first sign-in instead of stranding the teacher. */
const storedInviteCode = user => String(user?.user_metadata?.teacher_invite_code || "").trim();

async function claimInvite(inviteCode) {
    if (!inviteCode) return false;
    const { data, error } = await supabaseClient.rpc("claim_teacher_invite", { invite_code: inviteCode });
    if (error || !data) return false;
    const { data: isTeacher } = await supabaseClient.rpc("is_teacher");
    return Boolean(isTeacher);
}

const loginForm = document.getElementById("teacherLoginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");
        window.OtterLoading?.show();
        try {
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: document.getElementById("teacherEmail").value.trim(),
                password: document.getElementById("teacherPassword").value
            });
            if (error) {
                if (/not confirmed/i.test(error.message)) {
                    message("Confirm that email first, then sign in. Check your inbox for the confirmation link.");
                } else {
                    message("That teacher email or password is not valid.");
                }
                window.OtterLoading?.hide();
                return;
            }
            const { data: isTeacher, error: roleError } = await supabaseClient.rpc("is_teacher");
            if (roleError || !isTeacher) {
                /* Not a teacher yet. If sign-up happened while email confirmation
                   was on, the invite was never claimed - finish it now that the
                   address is verified and a session exists. */
                const { data: userData } = await supabaseClient.auth.getUser();
                const activated = roleError ? false : await claimInvite(storedInviteCode(userData?.user));
                if (!activated) {
                    await supabaseClient.auth.signOut();
                    message(roleError
                        ? "Could not check teacher access right now. Try again."
                        : "This account does not have teacher access.");
                    window.OtterLoading?.hide();
                    return;
                }
            }
            window.OtterFavicon?.apply("teacher");
            window.location.href = "teacher.html";
        } catch (error) {
            console.error("Teacher sign-in failed:", error);
            message("Could not sign in right now. Check your connection and try again.");
            window.OtterLoading?.hide();
        }
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
        const button = teacherResetForm.querySelector("button[type=submit]");
        const original = button.textContent;
        button.disabled = true;
        button.textContent = "Resetting…";
        const { data, error } = await supabaseClient.rpc("reset_password_via_invite", {
            p_role: "teacher",
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
}

const signupForm = document.getElementById("teacherSignupForm");
if (signupForm) {
    signupForm.addEventListener("submit", async event => {
        event.preventDefault();
        message("");
        const password = document.getElementById("teacherPassword").value;
        if (!password) { message("Enter the password for your student account."); return; }
        const { data, error } = await supabaseClient.auth.signUp({
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
        const existingAccount = error && (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already been registered"));
        const existingEmailResponse = data?.user && data.user.identities?.length === 0;
        if (existingAccount || existingEmailResponse) {
            const { error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: document.getElementById("teacherEmail").value.trim(),
                password
            });
            if (loginError) {
                if (/not confirmed/i.test(loginError.message)) {
                    message("That account exists but its email is not confirmed yet. Confirm it, then sign in on Teacher login.");
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
        message("Almost there — open the confirmation link we just emailed you, then sign in on Teacher login. Your invite code is applied automatically at that first sign-in.");
    });
}