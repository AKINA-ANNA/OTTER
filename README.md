## Otter Lab

Otter is a browser-based lab equipment workspace for students, teachers, and administrators. It uses plain HTML, CSS, and JavaScript with Supabase for authentication, database access, live updates and many more features.


## Purpose
 Each dashboard serves its own function the student make requests and teachers manage the students requests and many more but it would be natural to think admins are responsible to control both the dashboards but in this application admins have the sole pupose to manage the labs parts and that is why ALE the AI assistant has been provided to handle loads of parts data easily 
## Workspaces

- **Student portal** (`index.html`): sign in or create an account, request equipment, follow loans and deadlines, see announcements and projects, and check lab hours.
- **Teacher console** (`teacher-login.html`): review equipment requests, manage announcements and projects, view student activity, and publish lab timings.
- **Admin console** (`admin-login.html`): manage the parts registry, track loans, plan restocks, manage invite codes, and use ALE, the lab assistant.



## Backend Setup

The browser apps use Supabase Auth, Postgres tables and RPC functions, and realtime subscriptions. The client configuration currently lives in the JavaScript files; update the Supabase URL and public anon key there when connecting a different Supabase project. The database schema, policies, and migrations must also be installed in that project; they are not included in this repository.

The anon key is intended for browser use, but access must be secured with Supabase Row Level Security and appropriate policies. Never put a service-role key or other private secret in client-side code.

ALE (the admin AI) runs on a Supabase Edge Function, not in the browser: `supabase/functions/ale-chat` holds the OpenRouter key, re-checks `is_admin()` with the caller's own token on every request, and forwards the chat — so the key never reaches the page. The console talks to it through `ale-api.js` (`window.AleApi`) using the existing Supabase session, and `admin.js` sends nothing but the prompt. Deploy it with `supabase secrets set OPENROUTER_KEY=<key>` then `supabase functions deploy ale-chat`. Conversations are temporary and live in the console for the session — nothing about them is stored. Supabase still provides auth, the `is_admin` role check and invite-code RPCs; teacher access uses `is_teacher`.

### Email confirmation

Turn on **Authentication → Providers → Email → Confirm email**. The setting is project-wide, so it applies to student, teacher and admin sign-ups alike.

Two things depend on it:

- With the setting off, `signUp()` returns a session immediately, so the app signs people straight in and Supabase sends no mail at all. The student sign-up screen still says "check your mailbox", which then points at an empty inbox.
- With the setting on, `signUp()` returns no session, so `claim_teacher_invite()` / `claim_admin_invite()` cannot run at sign-up — both need an authenticated caller. The role would never be granted, and first sign-in would fail with "does not have access".

Both consoles therefore store the invite code in user metadata at sign-up and finish activation on the first *verified* sign-in: login reads `user_metadata.teacher_invite_code` / `admin_invite_code` and calls the matching claim RPC when the role check is still false. Accounts created before this change activate on their next sign-in without re-entering the code.

Add the deployed origin to **Authentication → URL Configuration** so the confirmation link returns to `teacher-login.html` / `admin-login.html`.

## Account Deletion

All three workspaces expose the same two options from the user's profile: **Sign out**, and **Delete account**. Deletion asks for a confirmation phrase, emails a verification code, and only wipes anything once that code verifies.

### Install

Run `supabase/account-deletion.sql` in the Supabase SQL editor. It is safe to run more than once. The script does two things:

1. Repoints the seven columns that referenced `auth.users` without an `ON DELETE` rule (`part_proposals.reviewed_by`, `part_proposals.lent_by`, `user_bans.banned_by`, `moderation_flags.reviewed_by`, `inventory_parts.updated_by`, `part_folders.created_by`, `registry_settings.updated_by`) to `ON DELETE SET NULL`. Without this, deleting an account fails for anyone who has ever reviewed a proposal or touched the registry. The operational rows survive; only the pointer to the person goes.
2. Creates `delete_my_account()`, a `SECURITY DEFINER` function granted to `authenticated`. It clears the caller's storage objects, sweeps the tables pointing at the account, then deletes the `auth.users` row so the existing cascades handle everything downstream.

The function takes no arguments and always acts on `auth.uid()`, so there is no id to tamper with. It also refuses to delete the final admin account.

One template change **is** required. Paste the contents of `supabase/email-templates/otp.html` into **Authentication → Email Templates → Magic Link**.

Supabase decides link-versus-code from the template itself: it sends a sign-in link when the template contains `{{ .ConfirmationURL }}`, and a numeric code when it contains `{{ .Token }}`. The stock Magic Link template is link-only, so without this the dialog would wait forever for a code that never arrives. The bundled template renders `{{ .Token }}` and styles it to match the app.

### How the code is checked

The console calls `signInWithOtp({ email, options: { shouldCreateUser: false } })` to send, then `verifyOtp({ email, token, type: "email" })` to check. The `type` must match the flow that issued the code — an `"email"` OTP is rejected if you ask to verify it as anything else.

The code length is not hardcoded: it is set under **Auth → Providers → Email**, so the field accepts 6–10 digits.

> `auth.reauthenticate()` is **not** usable for this. Its nonce is only accepted by `PUT /user` for a password change, and `"reauthentication"` is not a valid `/verify` type — GoTrue answers "Token has expired or is invalid" for a code that is perfectly correct.

### Security note

The code is verified by Supabase before `delete_my_account()` is called, so the gate lives in the browser. That is unavoidable for a buildless static client — there is nowhere to keep a secret. What the database still guarantees is the important part: the function acts only on `auth.uid()`, so a stolen session can delete its own account and nothing else. Enforcing the re-authentication server-side would mean moving the call into an Edge Function that inspects the token's `aal` claim.

### Failure behaviour

- Wrong or expired code: nothing is deleted, the dialog explains why, and a resend link appears after a 30 second cooldown.
- Last admin: the wipe is refused with a message telling them to promote another admin.
- Expired session: the wipe is refused and the user is returned to the sign-in screen.

## Project Structure

| Files | Purpose |
| --- | --- |
| `index.html`, `auth.js`, `style.css` | Student sign-in, signup, and onboarding |
| `dashboard.html`, `dashboard.js`, `dashboard.css` | Student workspace |
| `teacher-login.html`, `teacher-signup.html`, `teacher.js`, `teacher.css` | Teacher access and console |
| `admin-login.html`, `admin-signup.html`, `admin.js`, `admin.css` | Admin access and console |
| `account-deletion.js`, `account-deletion.css` | Shared account panel and OTP deletion flow |
| `supabase/account-deletion.sql` | Account deletion migration and RPC |
| `lab-timings.js` | Shared lab calendar and timetable logic |
| `social.js` | Shared announcement and social helpers |
| `otter3d.js`, `three.min.js` | Signup otter scene and Three.js runtime |
| `loading-screen.js`, `loading-screen.css` | Shared workspace loading screen |
| `tutorial.js`, `tutorial-content.js`, `tutorial.css` | Guided workspace tours |
| `ale-api.js` | Chat proxy glue for the admin AI (`window.AleApi`) |
| `supabase/functions/ale-chat/index.ts` | Edge Function: admin check + OpenRouter proxy |

## Notes

- Supabase JS, Google Fonts, and the student dashboard’s Lucide icons are loaded from CDNs, so those features need an internet connection.
- The admin AI runs on the project's Supabase Edge Functions; the OpenRouter key should only be stored as an Edge Function secret (`supabase secrets set OPENROUTER_KEY=...`), never in client code.
- The client pages contain no build or test scripts. Validate JavaScript changes with `node --check <file.js>` and test the role-specific flows against a configured Supabase project.
- You might have noticed the test clock feature or the admin secret invite codes I would ask to not abuse the invite codes   as it might cause chaos with numerous differing invite codes and the test clock is a temporary feature in this tester version and will be removed later.

## DISCLAIMER : THIS IS A TESTER VERSION BUGS OR UNEXPECTED BEHAVIOUS ARE EXPECTED TO OCCUR BUT STILL IF FOUND PLEASE REPORT TO THE DEVS 