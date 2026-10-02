/* ============================================================
   OTTER TOURS — the written content
   ------------------------------------------------------------
   Every feature of the student desk, the teacher console and the
   admin console, written once here and read by tutorial.js.

   A step is:
     title    the headline
     body     what it does, in plain words
     tip      optional "try this" line
     go       tab id to switch to before the step shows
     at       CSS selector to spotlight (omit for a general step)
     say      short conversational line, used when the otter narrates
   ============================================================ */

(function () {
    "use strict";

    /* ============================================================
       STUDENT DESK
       ============================================================ */

    const student = {
        label: "Student desk",
        icon: "◇",
        summary: "Request parts, track what you have borrowed, join teacher events and check when the lab is open.",
        steps: [
            {
                title: "Welcome to your student desk",
                body: "This is the home screen. Everything you do in Otter lives here: asking for parts, keeping track of what you have borrowed, joining teacher events, and finding out when the lab is actually open.",
                tip: "Use the switcher on the left to jump between sections at any time.",
                say: "welcome aboard! this is your den."
            },
            {
                title: "The three numbers at the top",
                body: "Parts on loan is what you are holding right now. Parts overdue is what has passed its due date. Projects joined counts the teacher events you have marked as interested.",
                tip: "Every card is a button — click one to jump straight to that list, already filtered for you.",
                go: "overview",
                at: ".overview-grid .metrics",
                say: "these three numbers are your whole life, honestly."
            },
            {
                title: "Latest from the den",
                body: "Teacher announcements land here as soon as they are posted. You can like a post and leave a comment, and your teacher can pin or delete anything they have posted.",
                go: "overview",
                at: "#postList",
                say: "your teachers shout here. listen."
            },
            {
                title: "Deadlines",
                body: "Anything with a date attached to it shows up here: return dates for the parts you are borrowing, and deadlines for the projects you joined. It is the one panel worth checking every day.",
                go: "overview",
                at: "#deadlineList",
                say: "deadlines live here. don't let me down."
            },
            {
                title: "New part request",
                body: "This button is the shortcut into the request flow. It takes you to the part requests section with an empty cart, ready for you to start building a request from scratch.",
                go: "overview",
                at: "#newRequestButton",
                say: "need a part? start right here."
            },
            {
                title: "Browsing the parts registry",
                body: "The full catalogue, exactly as your admin maintains it. Search by part name, category or location, or narrow the list with the category filter.",
                go: "partProposal",
                at: "#partsGrid",
                say: "everything in the lab, all in one list."
            },
            {
                title: "Building a proposal",
                body: "Add each part you need to the proposal cart. Nothing is requested until you press Propose, so you can collect parts across several searches first and send one tidy request at the end.",
                tip: "A teacher never sees a half-built cart, only what you choose to send.",
                go: "partProposal",
                at: "#cartList",
                say: "pile up everything you need, then send it once."
            },
            {
                title: "Telling the teacher why",
                body: "When you propose, you give a reason and how many days you need the parts for. The reason is what your teacher actually reads when deciding, so say what you are building.",
                go: "partProposal",
                at: "#proposeButton",
                say: "tell them what you're building. it works."
            },
            {
                title: "Following your proposals",
                body: "Your three most recent requests stay on this page with their status: awaiting review, approved, on standby, or declined. Approved requests become collateral once a teacher hands the parts over.",
                go: "partProposal",
                at: "#requestList",
                say: "and here you can see what happened to them."
            },
            {
                title: "Borrow logs",
                body: "Every request you have ever made, with receipts. Filter by status, search by part or request, or narrow to a date range when you need to find something specific.",
                go: "borrowLogs",
                at: ".borrow-history-tools",
                say: "your paper trail. show it when you collect."
            },
            {
                title: "Teacher events",
                body: "Projects your teachers have published. Mark a project as interested to confirm you are coming, and the teacher sees exactly who has joined.",
                go: "projectProposal",
                at: "#studentProjects",
                say: "projects your teachers are running."
            },
            {
                title: "Sharing and project history",
                body: "Reach out to friends straight from a project to invite them along. Teachers see every share and can trim the list. Past events drop off the main list the day after their date but stay in project history.",
                go: "projectProposal",
                at: ".project-history-box",
                say: "bring your friends. it's more fun."
            },
            {
                title: "Lab timings",
                body: "A month calendar of every day, colour coded: green means the lab is open for at least one period, amber means a teaching day with no lab, grey means a national holiday, and a dashed cell is a weekend. Pick a day to see exactly which of the nine periods are open and the times.",
                tip: "Use the previous and next lab day buttons to skip straight to the next day the lab is actually open.",
                go: "labTimings",
                at: "#labDayGrid",
                say: "want to know when the lab is open? ask me."
            },
            {
                title: "That is everything",
                body: "You can reopen this tour any time with the Tour button. If something looks wrong, ask your teacher to correct it — they are the ones who publish the lab timings and approve the parts.",
                go: "overview",
                say: "you're all set. good luck with your build!"
            }
        ]
    };

    /* ============================================================
       TEACHER CONSOLE
       ============================================================ */

    const teacher = {
        label: "Teacher console",
        icon: "✦",
        summary: "Publish announcements, decide on part requests, hand parts over, chase overdue returns, run projects and publish lab timings.",
        steps: [
            {
                title: "Welcome to the teacher console",
                body: "This is the review workspace. Students send you things here — announcements to read, part requests to decide, projects to run. Everything in the sidebar is a queue you own.",
                say: "your job, and you do it well."
            },
            {
                title: "Sharing with students",
                body: "Write an announcement and it appears on every student dashboard immediately. You can add emoji, drop in a GIF, and attach a file.",
                tip: "The counter above the composer shows how many posts are left before you need to clear old ones.",
                go: "overview",
                at: "#teacherAnnouncementForm",
                say: "say something. they're listening."
            },
            {
                title: "Deciding on part requests",
                body: "Every pending request lands in this queue in the order it arrived. You can approve it, decline it, or put it on standby if a part is temporarily unavailable. Approving a request is what moves it into collateral for handover.",
                go: "parts",
                at: "#proposalFeed",
                say: "requests. approve, decline, or hold them."
            },
            {
                title: "You will not miss a request",
                body: "When a new part request arrives while you are on another tab, a chime plays and the nav badge shows how many have landed. Turn on desktop alerts from the header to get a system notification even when this tab is in the background.",
                tip: "The badge clears by itself the moment you open the Part proposals tab — it only ever counts what you have not seen yet.",
                go: "parts",
                at: "#teacherAlertButton",
                say: "i'll chime when they knock."
            },
            {
                title: "Request history",
                body: "Decided requests do not vanish. They stay in the history panel beside the queue, and you can expand it to see the full record of everything you have reviewed.",
                go: "parts",
                at: ".request-history-panel",
                say: "nothing gets lost. there's always a record."
            },
            {
                title: "Handing the parts over",
                body: "Approved requests appear here under Awaiting pickup. When a student collects, open the lending flow to record who took what, when it is due, and optionally a photo of the handover.",
                go: "collateral",
                at: "#awaitingList",
                say: "this is the counter. they pick up, you tap it off."
            },
            {
                title: "Collateral statuses",
                body: "The three lists are Awaiting pickup, Currently out and Returned. The status filter lets you narrow to overdue only, and overdue is worked out for you from the due date — you never have to calculate it.",
                go: "collateral",
                at: ".collateral-toolbar",
                say: "who's got what, and who's late."
            },
            {
                title: "The logbook",
                body: "A diary of every return, day by day. Use the arrows or the date picker to move between days, search by student, reason or part, and filter to on-time or late returns.",
                go: "logs",
                at: "#logsDiary",
                say: "the logbook. who brought what back."
            },
            {
                title: "Overdue notices",
                body: "These are generated automatically. Once a part passes its due date, a notice is raised against that student and it appears here with a running count of how late they are. Students see the notice on their dashboard too.",
                tip: "Dismissing a notice clears it, but the notice record keeps a permanent history of what was overdue and for how long.",
                go: "notice",
                at: "#teacherNoticeList",
                say: "late. the system nags them so you don't have to."
            },
            {
                title: "Running a project",
                body: "Create a project, pick the students you want on it, and set a date. It appears on every student dashboard as a teacher event they can mark as interested.",
                go: "projects",
                at: "#projectList",
                say: "run a project. get them building."
            },
            {
                title: "Projects and history",
                body: "A project leaves the active list the day after its date and moves into project history, so the current list only ever shows what is actually running. You can also see who has shared each project and trim that list.",
                go: "projects",
                at: ".request-history-panel",
                say: "old projects rest here, safely."
            },
            {
                title: "Publishing lab timings",
                body: "This is what students see on their Lab timings screen. Pick a day, toggle on the periods the lab is open, and publish. You can set all nine periods at once, or clear a day entirely.",
                tip: "Weekends cannot be published — they are weekends by definition. Any other teaching day with nothing ticked shows as No lab in amber.",
                go: "labTimings",
                at: "#labDayGrid",
                say: "tell them when you're open. they check this."
            },
            {
                title: "Marking a holiday",
                body: "Flip the holiday switch on any day to grey it out for students, and name it so they know what it is. Indian gazetted holidays for 2026 and 2027 are already loaded — you only need this for an extra closure.",
                go: "labTimings",
                at: "#labHolidayToggle",
                say: "holiday? grey it out. done."
            },
            {
                title: "The period timetable",
                body: "The nine period times apply to every lab day everywhere. Edit a start or end time here and it updates on every student's screen, past and future, as soon as you save.",
                go: "labTimings",
                at: "#labTimetableGrid",
                say: "one timetable. it drives every single day."
            },
            {
                title: "The header counter",
                body: "The number on the right of the page header always tells you where you stand on the tab you are looking at — how many requests await you, how many need handing out, how many projects are running, or how many lab days you have published this month.",
                go: "overview",
                at: ".page-heading-stat",
                say: "the big number always means the tab you're on."
            },
            {
                title: "That is the whole console",
                body: "Reopen this tour any time with the Tour button. Students only ever see what you publish: announcements, approved requests, projects they joined, and the lab timings.",
                say: "you're covered. go make something great."
            }
        ]
    };

    /* ============================================================
       ADMIN CONSOLE
       ============================================================ */

    const admin = {
        label: "Admin console",
        icon: "✦",
        summary: "Own the parts catalogue, watch every borrow, plan restocking, control signup codes and drive the test clock.",
        steps: [
            {
                title: "Welcome to the admin console",
                body: "This is the control centre. Everything the lab owns lives here — the parts catalogue students search, the borrow records, and the tools that keep the shelves stocked.",
                say: "welcome to the control room."
            },
            {
                title: "The parts registry",
                body: "The catalogue, laid out like a file explorer. Folders down the left, the parts inside on the right, with a breadcrumb so you always know where you are.",
                tip: "The search box understands /folder/part as a path, which is the fastest way to jump straight to a part.",
                go: "registry",
                at: "#registryTree",
                say: "the catalogue. everything starts here."
            },
            {
                title: "Adding and organising",
                body: "Add a part with the button at the top, and create folders to give the catalogue a sensible shape. Both take effect immediately for students and teachers — no deploy, no code change.",
                go: "registry",
                at: "#openPartModal",
                say: "add parts, make folders. it's live at once."
            },
            {
                title: "Asking ALE",
                body: "ALE is the lab assistant built into this console. Ask it what is running low, what is out right now and who has it, or how many of a given part you have left. It reads the same data you see on screen.",
                go: "registry",
                at: "#openAleBtn",
                say: "ale knows everything in here. just ask."
            },
            {
                title: "The parts log",
                body: "Every borrow across every student, live. Who has what, what is overdue, and the full return history — refreshed with the button at the top of the panel.",
                go: "partslog",
                at: "#partslogStats",
                say: "every borrow, every student, right now."
            },
            {
                title: "The restock planner",
                body: "A demand-driven reorder plan. It learns from your real borrow history over a lookback window, applies the delivery lead time, and works out what will run out before the next order arrives.",
                go: "restock",
                at: ".restock-controls",
                say: "it works out what you're about to run out of."
            },
            {
                title: "Running the analysis",
                body: "Set the delivery time, how often you check stock, and how confident you want it to be about not running out. Then run the analysis to get a suggested order with quantities and reasoning.",
                tip: "Only parts students have actually used are considered — nothing gets reordered on theory alone.",
                go: "restock",
                at: "#restockRunBtn",
                say: "press run. the numbers do the rest."
            },
            {
                title: "Refining and placing the order",
                body: "Ask ALE to turn the analysis into a ready-to-use receipt, adjust anything, then mark it ordered to clear the list for the next cycle.",
                go: "restock",
                at: "#restockAiBtn",
                say: "ale writes it up. you just sign it off."
            },
            {
                title: "The test clock",
                body: "Set a simulated today and every console in the system treats it as the real date — overdue notices, due dates, deadlines and the lab calendar all follow it. A banner shows on every console while it is active.",
                tip: "The presets jump eight or fifteen days ahead, which is the fastest way to test that the overdue engine fires correctly.",
                go: "clock",
                at: "#simClockSetForm",
                say: "need to test time travel? here."
            },
            {
                title: "Invite codes",
                body: "The private codes a new admin or teacher must type on their signup page. Reveal them with Show codes, change either one, and it applies to the very next signup. Keep them secret and at least four characters.",
                go: "clock",
                at: "#inviteCodeForm",
                say: "the keys to the kingdom. don't lose them."
            },
            {
                title: "That is everything",
                body: "Reopen this tour with the Tour button. Teachers and students never see this console — they see the catalogue, the notices and the lab timings that you and they publish.",
                say: "the lab runs on what you do here. good luck."
            }
        ]
    };

    /* ============================================================
       THE WALKTHROUGH THE OTTER TELLS
       Same three desks, written as one story, narrated in the
       speech bubble on the login and signup page.
       ============================================================ */

    const walkthrough = {
        label: "The whole lab",
        icon: "✦",
        summary: "Otter walks you through the student desk, the teacher console and the admin console.",
        spotlight: false,
        steps: [
            {
                title: "One lab, three desks",
                body: "Otter is a lab equipment portal. The same catalogue and the same borrow records sit behind three different desks, and each person only ever sees the one built for them.",
                say: "three desks. one lab. let me show you."
            },
            { act: "Student desk", ...student.steps[0] },
            { act: "Student desk", ...student.steps[1] },
            { act: "Student desk", ...student.steps[5] },
            { act: "Student desk", ...student.steps[6] },
            { act: "Student desk", ...student.steps[9] },
            { act: "Student desk", ...student.steps[10] },
            { act: "Student desk", ...student.steps[12] },
            { act: "Teacher console", ...teacher.steps[1] },
            { act: "Teacher console", ...teacher.steps[2] },
            { act: "Teacher console", ...teacher.steps[3] },
            { act: "Teacher console", ...teacher.steps[6] },
            { act: "Teacher console", ...teacher.steps[8] },
            { act: "Teacher console", ...teacher.steps[9] },
            { act: "Teacher console", ...teacher.steps[11] },
            { act: "Teacher console", ...teacher.steps[13] },
            { act: "Admin console", ...admin.steps[1] },
            { act: "Admin console", ...admin.steps[4] },
            { act: "Admin console", ...admin.steps[5] },
            { act: "Admin console", ...admin.steps[8] },
            {
                title: "That is the whole lab",
                body: "Students ask for parts, teachers decide and hand them over, and admins keep the catalogue stocked. Log in and you land on the desk that belongs to you.",
                say: "and that's the lot. see you in the lab!"
            }
        ]
    };

    window.OtterTours = { student, teacher, admin, walkthrough };
})();
