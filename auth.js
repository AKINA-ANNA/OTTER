/* ============================================================
   OTTER AUTH
   Supabase + Vanilla JS
============================================================ */


/* ============================================================
   1. SUPABASE CONFIG
============================================================ */

const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";

const { createClient } = window.supabase;

const supabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);


/* ============================================================
   2. DOM
============================================================ */

const loginView = document.getElementById("loginView");
const signupView = document.getElementById("signupView");
const confirmationView = document.getElementById("confirmationView");
const onboardingView = document.getElementById("onboardingView");

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const profileForm = document.getElementById("profileForm");

const showSignup = document.getElementById("showSignup");
const showLogin = document.getElementById("showLogin");
const backToLogin = document.getElementById("backToLogin");

const otterSpeech = document.getElementById("otterSpeech");


const toast = document.getElementById("toast");
const toastIcon = document.getElementById("toastIcon");
const toastTitle = document.getElementById("toastTitle");
const toastMessage = document.getElementById("toastMessage");
const toastClose = document.getElementById("toastClose");

const confirmationEmail =
    document.getElementById("confirmationEmail");

const strengthBar =
    document.getElementById("strengthBar");

const strengthText =
    document.getElementById("strengthText");


/* ============================================================
   3. BASIC HELPERS
============================================================ */

function $(id) {
    return document.getElementById(id);
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* ============================================================
   4. TOAST
============================================================ */

let toastTimer = null;

function showToast(
    title,
    message,
    type = "success",
    duration = 5000
) {

    clearTimeout(toastTimer);

    toastTitle.textContent = title;
    toastMessage.textContent = message;

    toast.classList.remove("error");

    if (type === "error") {
        toast.classList.add("error");
        toastIcon.textContent = "!";
    } else {
        toastIcon.textContent = "✓";
    }

    toast.classList.add("show");

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}


toastClose.addEventListener("click", () => {
    toast.classList.remove("show");
});


/* ============================================================
   5. VIEW SWITCHING
============================================================ */

function switchView(view) {

    loginView.classList.remove("active");
    signupView.classList.remove("active");
    confirmationView.classList.remove("active");
    onboardingView.classList.remove("active");

    if (view === "login") {
        loginView.classList.add("active");

        setOtterMode("login");
    }

    if (view === "signup") {
        signupView.classList.add("active");

        setOtterMode("signup");
    }

    if (view === "confirmation") {
        confirmationView.classList.add("active");

        setOtterSpeech("check your mail! 📬");
    }

    if (view === "onboarding") {
        onboardingView.classList.add("active");

        setOtterMode("onboarding");
    }

    aimField = null;
    updateOtterAim();
}


showSignup.addEventListener("click", () => {

    switchView("signup");

    clearAllErrors();

    document.getElementById("signupName").focus();
});


showLogin.addEventListener("click", () => {

    switchView("login");

    clearAllErrors();

    document.getElementById("loginEmail").focus();
});


backToLogin.addEventListener("click", () => {

    switchView("login");

    clearAllErrors();

    document.getElementById("loginEmail").focus();
});


/* ============================================================
   6. OTTER
============================================================ */

function setOtterSpeech(text) {

    const span = otterSpeech.querySelector("span");

    span.textContent = text;
}




function setOtterMode(mode) {

    if (mode === "login") {
        setOtterSpeech("welcome back 👋");
    }

    if (mode === "signup") {
        setOtterSpeech("let's get you in!");
    }

    if (mode === "onboarding") {
        setOtterSpeech("where do you sit? ✦");
    }

    if (window.Otter3D) {
        window.Otter3D.setMode(mode);
    }

    updateOtterAim();
}


function otterNo(message = "NOPE!") {

    if (window.Otter3D) {
        window.Otter3D.reactNo();
    }

    setOtterSpeech(message);

    setTimeout(() => {
        if (onboardingView.classList.contains("active")) {
            setOtterMode("onboarding");
        } else {
            setOtterMode(
                signupView.classList.contains("active")
                    ? "signup"
                    : "login"
            );
        }
    }, 700);
}


function otterHappy() {

    if (window.Otter3D) {
        window.Otter3D.reactHappy();
    }

    setOtterSpeech("YAY! 🦦");

    setTimeout(() => {
        updateOtterAim();
    }, 1300);
}


async function otterCelebrate() {

    if (window.Otter3D) {
        window.Otter3D.celebrate();
    }

    setOtterSpeech("let's go!");

    await sleep(1500);

    setOtterSpeech("🦦");
}


/* ------------------------------------------------------------
   AIMING — the 3D otter watches and points.
   - While typing in a field, it looks at that field.
   - Once ALL fields are filled it turns and points its
     paw at the login/signup submit button.
------------------------------------------------------------ */

const loginButton = $("loginButton");
const signupButton = $("signupButton");

let aimField = null;

function viewIsActive(view) {
    return view.classList.contains("active");
}

function loginFieldsFilled() {
    const email = $("loginEmail");
    const password = $("loginPassword");
    return !!(
        email &&
        password &&
        email.value.trim() !== "" &&
        password.value.trim() !== ""
    );
}

function signupFieldsFilled() {
    const ids = [
        "signupName",
        "signupEmail",
        "signupPhone",
        "signupPassword",
        "signupConfirmPassword"
    ];

    for (let i = 0; i < ids.length; i++) {
        const field = $(ids[i]);
        if (!field || field.value.trim() === "") return false;
    }

    const terms = $("terms");
    return !!(terms && terms.checked);
}

function profileFieldsFilled() {
    return ["studentId", "className", "section"].every(id => {
        const field = $(id);
        return field && field.value.trim() !== "";
    });
}

function updateOtterAim() {

    if (!window.Otter3D) return;

    const activeView = document.querySelector(".auth-view.active");

    if (!activeView) {
        window.Otter3D.setAim(null, false);
        return;
    }

    const isSignup = activeView.id === "signupView";
    const isOnboarding = activeView.id === "onboardingView";
    const allFilled = isSignup
        ? signupFieldsFilled()
        : isOnboarding
            ? profileFieldsFilled()
            : loginFieldsFilled();

    if (allFilled) {

        window.Otter3D.setAim(
            isSignup
                ? signupButton
                : isOnboarding
                    ? $("profileButton")
                    : loginButton,
            true
        );

        return;
    }

    if (aimField && activeView.contains(aimField)) {
        window.Otter3D.setAim(aimField, false);
        return;
    }

    window.Otter3D.setAim(null, false);
}

function trackAim() {

    document.querySelectorAll(".auth-view input, .onboarding-view input").forEach(input => {

        input.addEventListener("focus", () => {
            aimField = input;
            updateOtterAim();
        });

        input.addEventListener("blur", () => {
            setTimeout(() => {
                if (document.activeElement !== input) {
                    aimField = null;
                    updateOtterAim();
                }
            }, 0);
        });

        input.addEventListener("input", updateOtterAim);
    });

    const terms = $("terms");
    if (terms) {
        terms.addEventListener("change", updateOtterAim);
    }
}

trackAim();


/* ============================================================
   7. ERROR HANDLING
============================================================ */

function setError(inputId, errorId, message) {

    const input = $(inputId);
    const error = $(errorId);

    if (!input || !error) return;

    error.textContent = message;

    const field = input.closest(".field");

    if (field) {
        field.classList.add("invalid");
    }
}


function clearError(inputId, errorId) {

    const input = $(inputId);
    const error = $(errorId);

    if (!input || !error) return;

    error.textContent = "";

    const field = input.closest(".field");

    if (field) {
        field.classList.remove("invalid");
    }
}


function clearAllErrors() {

    document.querySelectorAll(".field-error").forEach(el => {
        el.textContent = "";
    });

    document.querySelectorAll(".field.invalid").forEach(el => {
        el.classList.remove("invalid");
    });
}


/* ============================================================
   8. EMAIL VALIDATION
============================================================ */

/*
    This is deliberately not presented as a security boundary.

    The browser can reject obviously fake-looking addresses,
    but actual verification comes from Supabase's confirmation
    email.

    You can add your school's permitted domain below if needed.
*/

const ALLOWED_SCHOOL_DOMAINS = [
    // Example:
    // "school.edu",
    // "school.ac.in"
];


/*
    Common disposable domains.

    This isn't an exhaustive list and should NOT be considered
    security. It simply catches common temporary-mail services.
*/

const DISPOSABLE_DOMAINS = new Set([
    "mailinator.com",
    "guerrillamail.com",
    "guerrillamail.info",
    "guerrillamail.biz",
    "guerrillamail.de",
    "guerrillamail.net",
    "guerrillamail.org",
    "10minutemail.com",
    "10minutemail.net",
    "tempmail.com",
    "temp-mail.org",
    "temp-mail.io",
    "throwawaymail.com",
    "yopmail.com",
    "sharklasers.com",
    "getnada.com",
    "emailondeck.com",
    "maildrop.cc",
    "fakeinbox.com"
]);


function validateEmail(email) {

    const value = email.trim().toLowerCase();

    if (!value) {
        return {
            valid: false,
            message: "You need to enter an email."
        };
    }

    /*
       Reject spaces and obviously malformed addresses.
    */
    if (/\s/.test(value)) {
        return {
            valid: false,
            message: "That email contains spaces."
        };
    }

    /*
       Basic RFC-friendly browser validation.
    */
    const pattern =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

    if (!pattern.test(value)) {
        return {
            valid: false,
            message: "That doesn't look like a real email address."
        };
    }

    const domain = value.split("@")[1];

    if (DISPOSABLE_DOMAINS.has(domain)) {
        return {
            valid: false,
            message: "Temporary/disposable email addresses aren't allowed."
        };
    }

    /*
       If you put domains in ALLOWED_SCHOOL_DOMAINS,
       signup will only accept those domains.
    */

    if (
        ALLOWED_SCHOOL_DOMAINS.length > 0 &&
        !ALLOWED_SCHOOL_DOMAINS.includes(domain)
    ) {
        return {
            valid: false,
            message: "Please use your school email address."
        };
    }

    return {
        valid: true,
        email: value
    };
}


/* ============================================================
   9. PHONE VALIDATION
============================================================ */

function cleanPhone(phone) {

    return phone.replace(/[^\d+]/g, "");
}


function validatePhone(phone) {

    const cleaned = cleanPhone(phone);

    /*
       Minimum 10 digits.
       This means something like "123" immediately fails.
    */

    const digits = cleaned.replace(/\D/g, "");

    if (!digits) {
        return {
            valid: false,
            message: "Please enter your phone number."
        };
    }

    if (digits.length < 10) {
        return {
            valid: false,
            message: "That number is too short."
        };
    }

    if (digits.length > 15) {
        return {
            valid: false,
            message: "That number is too long."
        };
    }

    return {
        valid: true,
        phone: cleaned
    };
}


/* ============================================================
   10. NAME VALIDATION
============================================================ */

function validateName(name) {

    const value = name.trim();

    if (!value) {
        return {
            valid: false,
            message: "Tell us your name first."
        };
    }

    if (value.length < 2) {
        return {
            valid: false,
            message: "That name is a little too short."
        };
    }

    if (value.length > 80) {
        return {
            valid: false,
            message: "That name is too long."
        };
    }

    return {
        valid: true,
        name: value
    };
}


/* ============================================================
   11. PASSWORD
============================================================ */

function passwordScore(password) {

    let score = 0;

    if (password.length >= 8) score++;
    if (password.length >= 12) score++;

    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    return Math.min(score, 5);
}


function updatePasswordStrength(password) {

    const score = passwordScore(password);

    const widths = [
        "0%",
        "20%",
        "40%",
        "60%",
        "80%",
        "100%"
    ];

    strengthBar.style.width = widths[score];

    if (score <= 1) {

        strengthBar.style.background = "#e97866";
        strengthText.textContent =
            "That password needs some muscle.";

    } else if (score === 2) {

        strengthBar.style.background = "#e9aa5e";
        strengthText.textContent =
            "Getting there...";

    } else if (score === 3) {

        strengthBar.style.background = "#d2b956";
        strengthText.textContent =
            "Pretty decent.";

    } else {

        strengthBar.style.background = "#55ae9f";
        strengthText.textContent =
            "Otterly secure.";
    }
}


function validatePassword(password) {

    if (!password) {
        return {
            valid: false,
            message: "You need a password."
        };
    }

    if (password.length < 8) {
        return {
            valid: false,
            message: "Password must be at least 8 characters."
        };
    }

    /*
       This isn't excessively restrictive, but makes a basic
       password harder to accidentally create.
    */

    if (!/[A-Za-z]/.test(password)) {
        return {
            valid: false,
            message: "Add at least one letter."
        };
    }

    if (!/[0-9]/.test(password)) {
        return {
            valid: false,
            message: "Add at least one number."
        };
    }

    return {
        valid: true
    };
}


/* ============================================================
   12. PASSWORD VISIBILITY
============================================================ */

document.querySelectorAll(".password-toggle").forEach(button => {

    button.addEventListener("click", () => {

        const target = $(button.dataset.target);

        if (!target) return;

        if (target.type === "password") {

            target.type = "text";

            button.textContent = "hide";

        } else {

            target.type = "password";

            button.textContent = "show";
        }
    });
});


/* ============================================================
   13. LIVE PASSWORD STRENGTH
============================================================ */

$("signupPassword").addEventListener("input", event => {

    updatePasswordStrength(event.target.value);

    clearError(
        "signupPassword",
        "signupPasswordError"
    );
});


/* ============================================================
   14. LIVE PHONE VALIDATION
============================================================ */

$("signupPhone").addEventListener("blur", () => {

    const result =
        validatePhone($("signupPhone").value);

    if (!result.valid) {

        setError(
            "signupPhone",
            "signupPhoneError",
            result.message
        );

        otterNo("NOPE!");
    }
});


/* ============================================================
   15. SIGNUP VALIDATION
============================================================ */

function validateSignupForm() {

    clearAllErrors();

    let valid = true;

    /*
       NAME
    */

    const nameResult =
        validateName($("signupName").value);

    if (!nameResult.valid) {

        setError(
            "signupName",
            "signupNameError",
            nameResult.message
        );

        valid = false;
    }


    /*
       EMAIL
    */

    const emailResult =
        validateEmail($("signupEmail").value);

    if (!emailResult.valid) {

        setError(
            "signupEmail",
            "signupEmailError",
            emailResult.message
        );

        valid = false;
    }


    /*
       PHONE
    */

    const phoneResult =
        validatePhone($("signupPhone").value);

    if (!phoneResult.valid) {

        setError(
            "signupPhone",
            "signupPhoneError",
            phoneResult.message
        );

        valid = false;
    }


    /*
       PASSWORD
    */

    const password =
        $("signupPassword").value;

    const passwordResult =
        validatePassword(password);

    if (!passwordResult.valid) {

        setError(
            "signupPassword",
            "signupPasswordError",
            passwordResult.message
        );

        valid = false;
    }


    /*
       CONFIRM PASSWORD
    */

    const confirmPassword =
        $("signupConfirmPassword").value;

    if (!confirmPassword) {

        setError(
            "signupConfirmPassword",
            "signupConfirmPasswordError",
            "Please confirm your password."
        );

        valid = false;

    } else if (password !== confirmPassword) {

        setError(
            "signupConfirmPassword",
            "signupConfirmPasswordError",
            "Those passwords don't match."
        );

        valid = false;
    }


    /*
       TERMS
    */

    if (!$("terms").checked) {

        $("termsError").textContent =
            "You need to agree before joining the den.";

        valid = false;
    }


    if (!valid) {

        otterNo("NOPE!");

        return null;
    }


    return {
        name: nameResult.name,
        email: emailResult.email,
        phone: phoneResult.phone,
        password
    };
}


/* ============================================================
   16. SIGNUP
============================================================ */

signupForm.addEventListener("submit", async event => {

    event.preventDefault();

    const data = validateSignupForm();

    if (!data) return;

    const button = $("signupButton");

    button.classList.add("loading");

    button.querySelector(".button-text").textContent =
        "Making your den...";


    /*
       Cute reaction first.
    */

    otterHappy();

    await sleep(750);


    try {

        /*
           IMPORTANT:
           Supabase must have email confirmation enabled.

           We deliberately do NOT mark email as verified
           ourselves. Supabase controls that.
        */

        const {
            data: authData,
            error
        } = await supabaseClient.auth.signUp({

            email: data.email,

            password: data.password,

            options: {

                /*
                   These values can be picked up by a
                   database trigger or later profile creation.
                */

                data: {
                    full_name: data.name,
                    phone: data.phone
                }
            }
        });


        if (error) {
            throw error;
        }

        if (!authData?.user) {
            throw new Error("Supabase did not return a new user.");
        }


        /*
           Supabase normally returns a user even when
           email confirmation is required.
        */

        /*
           Show the celebration animation.
           The otter hops joyfully in place — never a
           linear slide across the card.
        */

        await otterCelebrate();


        /*
           Show the confirmation screen.
        */

        confirmationEmail.textContent =
            data.email;

        switchView("confirmation");


        showToast(
            "Check your mailbox!",
            "We've sent an Otter confirmation link to your email.",
            "success",
            7000
        );

    } catch (error) {

        console.error("Signup error:", error);

        otterNo("UH OH!");

        let message =
            "We couldn't create your account.";

        const errorMessage =
            error.message ? error.message.toLowerCase() : "";

        /*
           Friendly Supabase errors.
        */

        if (errorMessage.includes("already registered")) {
            message =
                "That email already has an account. Try logging in.";
        }

        if (errorMessage.includes("password")) {
            message =
                "Supabase rejected that password. Try a stronger one.";
        }

        if (errorMessage.includes("email address") ||
            errorMessage.includes("invalid email")) {
            message =
                "Supabase rejected that email address. Please use a valid school email.";
        }

        if (errorMessage.includes("rate limit") ||
            errorMessage.includes("too many requests")) {
            message =
                "Too many signup attempts. Please wait a moment and try again.";
        }

        showToast(
            "Signup didn't work",
            message,
            "error",
            6000
        );

    } finally {

        button.classList.remove("loading");

        button.querySelector(".button-text").textContent =
            "Create my account";
    }
});


/* ============================================================
   17. LOGIN VALIDATION
============================================================ */

function validateLoginForm() {

    clearAllErrors();

    let valid = true;

    const emailResult =
        validateEmail($("loginEmail").value);

    if (!emailResult.valid) {

        setError(
            "loginEmail",
            "loginEmailError",
            emailResult.message
        );

        valid = false;
    }


    const password =
        $("loginPassword").value;

    if (!password) {

        setError(
            "loginPassword",
            "loginPasswordError",
            "Enter your password."
        );

        valid = false;
    }


    if (!valid) {

        otterNo("NOPE!");

        return null;
    }


    return {
        email: emailResult.email,
        password
    };
}


/* ============================================================
   18. LOGIN
============================================================ */

loginForm.addEventListener("submit", async event => {

    event.preventDefault();

    const data = validateLoginForm();

    if (!data) return;

    const button = $("loginButton");

    button.classList.add("loading");

    button.querySelector(".button-text").textContent =
        "Checking your paws...";


    try {

        const {
            data: authData,
            error
        } = await supabaseClient.auth.signInWithPassword({

            email: data.email,

            password: data.password
        });


        if (error) {
            throw error;
        }


        if (!authData.user) {
            throw new Error("No user returned.");
        }


        /*
           Extra protection:
           even if Supabase authentication succeeds,
           don't allow an unconfirmed account through when
           email confirmation is being used.
        */

        if (!authData.user.email_confirmed_at) {

            await supabaseClient.auth.signOut();

            otterNo("CHECK MAIL!");

            showToast(
                "Email not confirmed",
                "Please confirm your email before logging in.",
                "error",
                6500
            );

            return;
        }


        /*
           SUCCESS
        */

        otterHappy();

        showToast(
            "Welcome back!",
            "You're in. Opening your Otter dashboard...",
            "success",
            2500
        );


        await sleep(900);


          await showProfileOnboarding(authData.user);


    } catch (error) {

        console.error("Login error:", error);

        otterNo("NOPE!");

        let message =
            "That email or password isn't right.";

        if (
            error.message &&
            error.message.toLowerCase().includes("email not confirmed")
        ) {
            message =
                "Please confirm your email before logging in.";
        }

        showToast(
            "Couldn't log you in",
            message,
            "error",
            5500
        );

    } finally {

        button.classList.remove("loading");

        button.querySelector(".button-text").textContent =
            "Log me in";
    }
});


/* ============================================================
   19. FORGOT PASSWORD
============================================================ */

/* ============================================================
   19. PROFILE ONBOARDING
============================================================ */

let onboardingUser = null;

function validateProfileForm() {

    clearAllErrors();

    let valid = true;

    [
        ["studentId", "studentIdError", "Enter your admission number."],
        ["className", "classNameError", "Tell us your class."],
        ["section", "sectionError", "Tell us your section."]
    ].forEach(([inputId, errorId, message]) => {
        if (!$(inputId).value.trim()) {
            setError(inputId, errorId, message);
            valid = false;
        }
    });

    if (!valid) {
        otterNo("ALMOST!");
        return null;
    }

    return {
        student_id: $("studentId").value.trim(),
        class_name: $("className").value.trim(),
        section: $("section").value.trim()
    };
}

async function showProfileOnboarding(user) {

    onboardingUser = user;

    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("student_id, class_name, section")
        .eq("id", user.id)
        .maybeSingle();

    if (error) {
        console.warn("Could not load existing profile details:", error.message);
    }

    const complete = bool => typeof bool === "string" && bool.trim().length > 0;
    const alreadySaved = profile && complete(profile.student_id) && complete(profile.class_name) && complete(profile.section);
    if (alreadySaved) {
        window.location.href = "dashboard.html";
        return;
    }

    $("studentId").value = profile?.student_id || "";
    $("className").value = profile?.class_name || "";
    $("section").value = profile?.section || "";

    clearAllErrors();
    switchView("onboarding");
    $("studentId").focus();
}

profileForm.addEventListener("submit", async event => {

    event.preventDefault();

    const profile = validateProfileForm();

    if (!profile || !onboardingUser) return;

    const button = $("profileButton");
    button.classList.add("loading");
    button.querySelector(".button-text").textContent = "Saving your den...";

    try {
        const { data: updatedProfiles, error: updateError } = await supabaseClient
            .from("profiles")
            .update(profile)
            .eq("id", onboardingUser.id)
            .select("id");

        if (updateError) throw updateError;

        if (!updatedProfiles || updatedProfiles.length === 0) {
            const { error: insertError } = await supabaseClient
                .from("profiles")
                .insert({
                    id: onboardingUser.id,
                    ...profile
                });

            if (insertError) throw insertError;
        }

        await otterCelebrate();

        showToast(
            "Profile ready!",
            "Your class details are saved. Opening your dashboard...",
            "success",
            3000
        );

        window.location.href = "dashboard.html";
    } catch (error) {
        console.error("Profile save error:", error);
        otterNo("UH OH!");

        let message = "Please try again in a moment.";
        const errorMessage = error.message ? error.message.toLowerCase() : "";

        if (errorMessage.includes("row-level security") || error.code === "42501") {
            message = "Your profile table needs an authenticated update policy in Supabase.";
        } else if (errorMessage.includes("column") || error.code === "42703") {
            message = "One of the profile column names does not match the database.";
        }

        showToast(
            "Couldn't save your details",
            message,
            "error",
            6000
        );
    } finally {
        button.classList.remove("loading");
        button.querySelector(".button-text").textContent = "Save my details";
    }
});


/* ============================================================
   20. FORGOT PASSWORD
============================================================ */

$("forgotPassword").addEventListener("click", async () => {

    const email = $("loginEmail").value.trim();

    const result = validateEmail(email);

    if (!result.valid) {

        setError(
            "loginEmail",
            "loginEmailError",
            "Enter your email first so we know where to send the reset link."
        );

        otterNo("EMAIL!");

        return;
    }


    try {

        const {
            error
        } = await supabaseClient.auth.resetPasswordForEmail(
            result.email,
            {
                redirectTo:
                    `${window.location.origin}/reset-password.html`
            }
        );


        if (error) {
            throw error;
        }


        showToast(
            "Reset email sent",
            "Check your inbox for the password reset link.",
            "success",
            6500
        );

        setOtterSpeech("mail time! 📬");


    } catch (error) {

        console.error("Password reset error:", error);

        showToast(
            "Couldn't send reset email",
            "Please try again in a moment.",
            "error",
            5000
        );

        otterNo("UH OH!");
    }
});


/* ============================================================
   20. AUTH STATE
============================================================ */

supabaseClient.auth.onAuthStateChange(
    async (event, session) => {

        console.log(
            "Otter auth event:",
            event
        );


        /*
           If Supabase has just verified the user's email,
           this event can fire with a session.
        */

        if (
            event === "SIGNED_IN" &&
            session?.user?.email_confirmed_at
        ) {

            console.log(
                "Email confirmed for:",
                session.user.email
            );
        }


        /*
           PASSWORD RECOVERY
        */

        if (event === "PASSWORD_RECOVERY") {

            console.log(
                "Password recovery session started."
            );
        }
    }
);


/* ============================================================
   21. INPUT UX
============================================================ */

document.querySelectorAll("input").forEach(input => {

    input.addEventListener("input", () => {

        const field = input.closest(".field");

        if (field) {
            field.classList.remove("invalid");
        }

        const error =
            field?.querySelector(".field-error");

        if (error) {
            error.textContent = "";
        }
    });
});


/* ============================================================
   22. CONFIRMATION EMAIL RESEND
============================================================ */

/*
   Optional helper.

   We expose this globally so a future "Resend email"
   button can call:

       resendConfirmationEmail()
*/

async function resendConfirmationEmail() {

    const email =
        confirmationEmail.textContent.trim();

    if (!email) return;

    const button = document.getElementById("resendConfirmation");

    if (button) {
        button.disabled = true;
        button.textContent = "Sending…";
    }


    try {

        const {
            error
        } = await supabaseClient.auth.resend({

            type: "signup",

            email
        });


        if (error) {
            throw error;
        }


        showToast(
            "Email sent again!",
            "Check your inbox for the new confirmation link.",
            "success",
            6000
        );

        setOtterSpeech("again! 📬");


        if (button) {
            button.textContent = "Email sent ✓ — try again in 30s";

            setTimeout(() => {
                button.disabled = false;
                button.textContent = "Resend confirmation email";
            }, 30000);
        }


    } catch (error) {

        console.error(
            "Resend confirmation error:",
            error
        );

        if (button) {
            button.disabled = false;
            button.textContent = "Resend confirmation email";
        }

        showToast(
            "Couldn't resend",
            "Please wait a moment and try again.",
            "error"
        );
    }
}


document.getElementById("resendConfirmation").addEventListener(
    "click",
    resendConfirmationEmail
);


/* ============================================================
   23. STARTUP
============================================================ */

(async function init() {

    /*
       Make sure the page doesn't accidentally display
       a stale authentication state.
    */

    clearAllErrors();

    updatePasswordStrength("");

    setOtterMode("login");

    /*
       If the user arrives at the page with a confirmed
       session already active, you can redirect them.
    */

    const {
        data: {
            session
        }
    } = await supabaseClient.auth.getSession();


    if (
        session &&
        session.user &&
        session.user.email_confirmed_at
    ) {

        /*
           Uncomment this if you want already-authenticated
           users to automatically go to the dashboard.

           window.location.href = "dashboard.html";
        */

        await showProfileOnboarding(session.user);
    }

})();