// Browser glue for the ALE chat proxy (supabase/functions/ale-chat).
//
// Classic script loaded before admin.js; it exposes window.AleApi. The
// OpenRouter key stays in the Edge Function, which re-checks is_admin() on
// every call, so nothing secret lives in this file. Chats are temporary: the
// conversation lives in admin.js memory for the session and is never stored.
//
// Auth is just the Supabase session — the same access token the rest of the
// console already uses — so there is nothing extra to verify on this side.

(function () {
    const FUNCTION_URL = "https://xwawghxsebspjonkxafm.supabase.co/functions/v1/ale-chat";
    let supabase = null;

    async function accessToken() {
        if (!supabase) return null;
        try {
            const { data } = await supabase.auth.getSession();
            return data?.session?.access_token ?? null;
        } catch {
            return null;
        }
    }

    // Sentinels the edge function returns as { error }; admin.js switches on
    // these plain strings, so pull the first one out of whatever we were
    // handed — parsed body first, message second.
    const SENTINELS = [
        "gate-unavailable",
        "Admins only",
        "Not signed in",
        "rate-limited",
        "upstream-unavailable",
    ];

    function reason(error) {
        const data = error?.data;
        const dataText = typeof data === "string" ? data : data !== undefined ? JSON.stringify(data) : "";
        const body = String(error?.body ?? "");
        const message = String(error?.message ?? error ?? "");
        const haystack = `${dataText} ${body} ${message}`;
        for (const sentinel of SENTINELS) {
            if (haystack.includes(sentinel)) return sentinel;
        }
        return message;
    }

    async function chat(args, signal) {
        const token = await accessToken();
        if (!token) throw new Error("Not signed in");

        let response;
        try {
            response = await fetch(FUNCTION_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(args),
                signal: signal || undefined,
            });
        } catch (error) {
            if (error && error.name === "AbortError") throw error;
            throw new Error("upstream-unavailable");
        }

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            const failure = new Error((payload && payload.error) || `ALE request failed (${response.status})`);
            failure.body = JSON.stringify(payload || "");
            throw failure;
        }
        return payload;
    }

    function init(client) {
        supabase = client;
    }

    window.AleApi = { init, chat, reason };
})();
