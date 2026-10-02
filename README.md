## Otter Lab

Otter is a browser-based lab equipment workspace for students, teachers, and administrators. It uses plain HTML, CSS, and JavaScript with Supabase for authentication, database access, live updates and many more features.


## Purpose
 Each dashboard serves its own function the student make requests and teachers manage the students requests and many more but it would be natural to think admins are responsible to control both the dashboards but in this application admins have the sole pupose to manage the labs parts and that is why ALE the AI assistant has been provided to handle loads of parts data easily 
## Workspaces

- **Student portal** (`index.html`): sign in or create an account, request equipment, follow loans and deadlines, see announcements and projects, and check lab hours.
- **Teacher console** (`teacher-login.html`): review equipment requests, manage announcements and projects, view student activity, and publish lab timings.
- **Admin console** (`admin-login.html`): manage the parts registry, track loans, plan restocks, manage invite codes, and use ALE, the lab assistant.

## Run Locally

The project has no build step or package manager. Serve the project directory over HTTP rather than opening the pages with `file://`:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500/` and choose the relevant workspace. Any static file server can be used instead.

## Backend Setup

The browser apps use Supabase Auth, Postgres tables and RPC functions, and realtime subscriptions. The client configuration currently lives in the JavaScript files; update the Supabase URL and public anon key there when connecting a different Supabase project. The database schema, policies, and migrations must also be installed in that project; they are not included in this repository.

The anon key is intended for browser use, but access must be secured with Supabase Row Level Security and appropriate policies. Never put a service-role key or other private secret in client-side code.

ALE calls the Supabase Edge Function `ale-chat`. Deploy the function and configure its `OPENROUTER_API_KEY` secret in Supabase before using ALE. The admin console also uses the `is_admin` role check and invite-code RPCs; teacher access uses `is_teacher`.

## Project Structure

| Files | Purpose |
| --- | --- |
| `index.html`, `auth.js`, `style.css` | Student sign-in, signup, and onboarding |
| `dashboard.html`, `dashboard.js`, `dashboard.css` | Student workspace |
| `teacher-login.html`, `teacher-signup.html`, `teacher.js`, `teacher.css` | Teacher access and console |
| `admin-login.html`, `admin-signup.html`, `admin.js`, `admin.css` | Admin access and console |
| `lab-timings.js` | Shared lab calendar and timetable logic |
| `social.js` | Shared announcement and social helpers |
| `otter3d.js`, `three.min.js` | Signup otter scene and Three.js runtime |
| `loading-screen.js`, `loading-screen.css` | Shared workspace loading screen |
| `tutorial.js`, `tutorial-content.js`, `tutorial.css` | Guided workspace tours |

## Notes

- Supabase JS, Google Fonts, and the student dashboard’s Lucide icons are loaded from CDNs, so those features need an internet connection.
- The admin AI uses the configured Edge Function; the OpenRouter key should only be stored as a Supabase function secret.
- The client pages contain no build or test scripts. Validate JavaScript changes with `node --check <file.js>` and test the role-specific flows against a configured Supabase project.
- You might have noticed the test clock feature or the admin secret invite codes I would ask to not abuse the invite codes   as it might cause chaos with numerous differing invite codes and the test clock is a temporary feature in this tester version and will be removed later.

## DISCLAIMER : THIS IS A TESTER VERSION BUGS OR UNEXPECTED BEHAVIOUS ARE EXPECTED TO OCCUR BUT STILL IF FOUND PLEASE REPORT TO THE DEVS 