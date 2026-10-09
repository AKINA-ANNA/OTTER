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
                title: "Welcome to your student desk!",
                body: "This is your main dashboard. From here you can request lab parts, see what you've borrowed, join teacher-run projects, and check when the lab is open. Use the sidebar on the left to switch between sections.",
                tip: "The sidebar on the left lets you jump between Overview, Part Requests, Borrow Logs, Projects, and Lab Timings."
            },
            {
                title: "Your quick stats at a glance",
                body: "These three cards show your current status: Parts on Loan (what you're holding right now), Parts Overdue (past due date — return these ASAP), and Projects Joined (teacher events you've signed up for). Click any card to jump directly to that section.",
                tip: "Click a card to go straight to that page.",
                go: "overview",
                at: ".overview-grid .metrics",
                
            },
            {
                title: "Teacher announcements",
                body: "Teachers post lab updates, deadlines, and news here. You can like posts and add comments to ask questions. Check this regularly so you don't miss important info.",
                go: "overview",
                at: "#postList",
                
            },
            {
                title: "Deadlines & due dates",
                body: "All your return dates for borrowed parts and project deadlines appear in this list. This is the most important thing to check daily — overdue parts block you from borrowing more.",
                go: "overview",
                at: "#deadlineList",
                
            },
            {
                title: "Start a new part request",
                body: "Click the 'New part request' button (top right) to begin. It opens the Parts Requests tab with a fresh empty cart so you can start adding parts immediately.",
                go: "overview",
                at: "#newRequestButton",
                
            },
            {
                title: "Browse the parts catalogue",
                body: "This is the full lab inventory. Use the search bar to find parts by name, the category dropdown to filter by type (electronics, mechanical, etc.), or scroll through the list. Click any part to see details and add it to your cart.",
                go: "partProposal",
                at: ".proposal-browse",
                
            },
            {
                title: "Your cart — parts you want to request",
                body: "Parts you've added appear here with quantity. You can adjust quantities or remove items. This is just your draft — teachers don't see it until you click Propose. Keep adding parts until your cart has everything you need.",
                tip: "Your cart is private until you hit Propose. Teachers only see the final submission.",
                go: "partProposal",
                at: "#cartList",
                
            },
            {
                title: "Submit your request",
                body: "When your cart is ready, click the Propose button. You'll need to write a short description of what you're building and how many days you need the parts. Be clear — this helps your teacher approve faster. Then submit.",
                go: "partProposal",
                at: "#proposeButton",
                
            },
            {
                title: "Track request status",
                body: "After submitting, your request appears in this list with its current status: Awaiting Review (teacher hasn't seen it yet), Approved (ready for pickup), On Loan (you have it), Returned (done). Check here to know when to collect approved parts.",
                go: "partProposal",
                at: "#requestList",
                
            },
            {
                title: "Full request history",
                body: "Every request you've ever made is saved here. Use the filters and search to find old receipts, check past due dates, or prove what you borrowed and when. This is your permanent record.",
                go: "borrowLogs",
                at: ".borrow-history-tools",
                
            },
            {
                title: "Join teacher projects",
                body: "Teachers create projects (competitions, workshops, events). They appear here. Click 'Mark as Interested' on any project to join — the teacher sees your name and knows you're participating. You'll get updates and deadlines for that project.",
                go: "projectProposal",
                at: "#studentProjects",
               
            },
            {
                title: "Invite friends & see past projects",
                body: "On a project page, you can invite classmates by searching their names. Past projects (after their end date) move to the history section below so you can look back on what you've done.",
                go: "projectProposal",
                at: ".project-history-box",
                
            },
            {
                title: "Lab schedule — know when it's open",
                body: "This calendar shows lab availability: Green = open for borrowing, Amber = teaching day but lab closed, Grey = holiday, Dashed = weekend. Click any day to see which of the 9 periods are available. Use the Previous/Next Lab Day buttons to jump to the next open day.",
                tip: "Use 'Previous/Next Lab Day' buttons to skip straight to open days.",
                go: "labTimings",
                at: "#labDayGrid",
                
            },
            {
                title: "You're all set!",
                body: "That's your student desk. You can request parts, track loans, join projects, and check lab hours. The tour runs automatically on your first visit. If anything's unclear, ask your teacher.",
                go: "overview",
                
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
                title: "Welcome to the teacher console!",
                body: "This is your control center. Students send part requests here, you post announcements, manage loans, run projects, and set lab schedules. The sidebar on the left switches between sections.",
                say: "welcome to your control center. let's walk through it."
            },
            {
                title: "Post announcements to all students",
                body: "Use this form to send updates to every student instantly. Add emoji, GIFs, or attach files. Students see it on their Overview immediately. The counter shows how many posts you've made today.",
                tip: "Keep posts concise. The counter resets daily.",
                go: "overview",
                at: "#teacherAnnouncementForm",
                say: "write an announcement — every student sees it."
            },
            {
                title: "Review incoming part requests",
                body: "Student requests arrive here in order. For each one: Approve (moves to collateral for handoff), Decline (with reason), or Standby (if temporarily out of stock). Click a request to see details and decide.",
                go: "parts",
                at: "#proposalFeed",
                say: "approve, decline, or standby — your call."
            },
            {
                title: "Get notified of new requests",
                body: "Click the bell icon to enable desktop notifications. You'll get alerted even when this tab isn't active. The badge shows unseen requests and clears automatically when you open the Parts tab.",
                tip: "Enable notifications so you never miss a request.",
                go: "parts",
                at: "#teacherAlertButton",
                say: "turn on alerts — never miss a request."
            },
            {
                title: "Request history — full audit trail",
                body: "Every decision you make is recorded here. Expand this panel to see all reviewed requests with timestamps, status, and your notes. Useful for accountability and checking past decisions.",
                go: "parts",
                at: ".request-history-panel",
                say: "every decision is logged automatically."
            },
            {
                title: "Hand over approved parts",
                body: "When students come to collect approved parts, use this list. Click a request, verify the parts, optionally take a photo, then click 'Mark as Lended'. This starts the borrow timer and sets the due date.",
                go: "collateral",
                at: "#awaitingList",
                say: "verify parts, mark as lended, done."
            },
            {
                title: "Track all loans in one place",
                body: "Three tabs show everything: Awaiting Pickup (approved, not collected), Currently Out (with students, shows due dates), Returned (completed). Use the Overdue filter to instantly see who's late.",
                go: "collateral",
                at: ".collateral-toolbar",
                say: "see every part, who has it, and when it's due."
            },
            {
                title: "Daily return logbook",
                body: "Browse returns day by day. Pick a date, search by student or part, filter by on-time or late. This is your complete record of what came back and when.",
                go: "logs",
                at: "#logsDiary",
                say: "daily logbook — searchable, filterable, complete."
            },
            {
                title: "Automatic overdue notices",
                body: "The system generates overdue notices automatically. Students see them too. You just review and dismiss — the record stays in the log. No manual nagging needed.",
                tip: "Dismissing hides it from view but keeps the record.",
                go: "notice",
                at: "#teacherNoticeList",
                say: "the system chases late returns for you."
            },
            {
                title: "Create student projects",
                body: "Click 'New Project' to set up a competition, workshop, or event. Pick which students see it (by grade or individually), set the date, deadline, location, and details. It instantly appears on their Projects tab.",
                go: "projects",
                at: "#projectList",
                say: "create a project, pick your audience, publish."
            },
            {
                title: "Project history",
                body: "Projects move here automatically the day after they end. You can still see who joined and all the details. Nothing gets deleted — it's all for reference.",
                go: "projects",
                at: ".request-history-panel",
                say: "past projects stay for your records."
            },
            {
                title: "Publish lab schedule",
                body: "Set which days the lab is open and which of the 9 periods are available. Click a day on the calendar, toggle periods on/off, then Publish. Students see this on their Lab Timings tab.",
                tip: "Weekends can't be published. Teaching days with no lab show as amber.",
                go: "labTimings",
                at: "#labDayGrid",
                say: "set open days and periods — students see it instantly."
            },
            {
                title: "Mark holidays",
                body: "Toggle any day as a holiday. It shows grey on all calendars and the lab is closed. Gazetted 2026/2027 holidays are preloaded — just flip the switch.",
                go: "labTimings",
                at: "#labHolidayToggle",
                say: "mark holidays — lab closes, everyone sees it."
            },
            {
                title: "Set period times globally",
                body: "Define the 9 period start/end times once here. Changes apply everywhere — student calendar, teacher console, all of it. One timetable to rule them all.",
                go: "labTimings",
                at: "#labTimetableGrid",
                say: "set periods once, updates everywhere."
            },
            {
                title: "Header stat — pending count",
                body: "The big number in the header shows how many items need your attention in the current tab. Switch tabs to see counts for requests, overdue items, notices, etc.",
                go: "overview",
                at: ".page-heading-stat",
                say: "that number tells you what needs doing."
            },
            {
                title: "Teacher console mastered!",
                body: "You can post announcements, approve parts, hand over loans, track returns, run projects, and set the lab schedule. The tour runs automatically on your first visit.",
                say: "you've got this. go run the lab like a pro."
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
                title: "Welcome to the admin console!",
                body: "This is the control room for the entire lab. You manage the parts catalogue, see every borrow across all students, plan restocking, control who can sign up, and test time-sensitive features.",
                say: "welcome to the control room. total oversight starts here."
            },
            {
                title: "Master parts catalogue",
                body: "Browse folders on the left, parts on the right. Use the breadcrumb trail to navigate. Search understands paths like 'electronics/resistors' to jump straight to a folder.",
                tip: "Search supports folder/part paths — e.g., 'electronics/arduino'.",
                go: "registry",
                at: "#registryTree",
                say: "every part in the lab lives here, organized."
            },
            {
                title: "Add parts & folders",
                body: "Click 'Add Part' to create new items or folders. Fill in name, category, location, quantity, and details. Changes go live instantly — students see them immediately in the catalogue.",
                go: "registry",
                at: "#openPartModal",
                say: "add parts, make folders, keep it organized."
            },
            {
                title: "Ask ALE — your AI assistant",
                body: "Click the ALE button and ask questions like 'what's low stock?', 'who has the arduino?', 'how many resistors left?'. ALE knows the entire catalogue and gives instant answers.",
                go: "registry",
                at: "#openAleBtn",
                say: "ask ALE anything about inventory."
            },
            {
                title: "Live borrow feed — all students",
                body: "See every borrow across the whole lab in real time. Refresh to catch the latest. Stats at the top show totals for awaiting, out, overdue, and returned.",
                go: "partslog",
                at: "#partslogStats",
                say: "real-time view of every borrow, lab-wide."
            },
            {
                title: "Smart restock planner",
                body: "This analyzes usage history, lead times, and safety stock to predict what you'll run out of before it happens. Set your delivery window, check interval, and confidence level, then run it.",
                go: "restock",
                at: ".restock-controls",
                say: "never run out — the planner predicts it first."
            },
            {
                title: "Generate restock orders",
                body: "After running the planner, click 'Ask ALE for Order' to get a formatted purchase order. Adjust quantities if needed, then mark items as ordered. Tracks what's been ordered vs. received.",
                tip: "Only actively used parts count — no dusty inventory skewing results.",
                go: "restock",
                at: "#restockRunBtn",
                say: "run the planner, get an order, send it off."
            },
            {
                title: "Test clock — time travel for testing",
                body: "Simulate any date across ALL consoles. Set a future date, hit Apply, and the system acts like it's that day — overdue logic, deadlines, lab schedule all update. A big banner shows it's simulation mode.",
                tip: "Use +8 or +15 day presets to test overdue flows quickly.",
                go: "clock",
                at: "#simClockSetForm",
                say: "time travel for testing — simulate any date."
            },
            {
                title: "Manage invite codes",
                body: "Generate private codes for new admins and teachers. Reveal or change them anytime — changes only affect the next signup. Keep these secure.",
                go: "clock",
                at: "#inviteCodeForm",
                say: "control who gets admin or teacher access."
            },
            {
                title: "Admin console complete!",
                body: "You own the catalogue, see every borrow, plan restocking, control access, and can time-travel for testing. The tour runs automatically on your first visit.",
                say: "total lab control. you've got this."
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
                body: "Otter connects the whole lab. One shared catalogue and records, but three different desks — each person sees exactly what they need.",
                say: "three desks, one lab, let's zoom through together."
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
            { act: "Admin console", ...admin.steps[1] },
            { act: "Admin console", ...admin.steps[4] },
            { act: "Admin console", ...admin.steps[5] },
            { act: "Admin console", ...admin.steps[8] },
            {
                title: "That's the full lab tour!",
                body: "Students request and track, teachers approve and hand over, admins keep everything stocked. Login lands you on your desk — you're ready to go.",
                say: "that was the full tour. you're ready — see you in the lab."
            }
        ]
    };

    window.OtterTours = { student, teacher, admin, walkthrough };
})();