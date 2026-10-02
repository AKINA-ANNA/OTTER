/* ============================================================
   ELASTIC MESH GRID
   A lattice of springs pinned to a rest grid. The cursor pushes
   nearby nodes away from it and they spring back. Drawn to a fixed
   canvas behind the dashboard, so the solid cards stay readable.
   Exposes window.ElasticGrid for teardown/debugging.
============================================================ */

const ElasticGrid = (function () {
    const SPACING = 80;        // rest distance between nodes (Larpothon-style squares)
    const RADIUS = 150;        // cursor influence radius
    const PUSH = 1.5;          // how hard the cursor shoves a node
    const SPRING = 0.12;       // pull back toward the rest position
    const FRICTION = 0.50;     // critical damping (zeta 1.0): returns firmly, never rings
    const MAX_TRAVEL = 18;     // hard cap on node displacement, keeps the lattice intact
    const REST = 0.05;         // below this a node counts as settled
    const FOLLOW = 0.09;       // how fast the influence point trails the cursor
    const STRENGTH_IN = 0.10;  // how fast the cursor takes hold
    const STRENGTH_OUT = 0.05; // how fast it lets go
    const SNAP = 0.02;         // below this strength, place the influence on the cursor
    const IDLE = 1200;         // ms of no cursor movement before the mesh relaxes
    // The lattice colour comes from the active theme (--grid-line), so the mesh
    // stays visible on both the dark and the light console.
    const LINE_FALLBACK = "rgba(255, 255, 255, 0.06)";
    let line = LINE_FALLBACK;

    const host = document.querySelector(".dashboard-shell");
    if (!host) return null;

    const canvas = document.createElement("canvas");
    canvas.className = "elastic-grid";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    host.appendChild(canvas);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: -1000, y: -1000, live: false };
    // The influence point trails the cursor, so the mesh eases in behind the
    // pointer instead of snapping to it. strength fades it in and out.
    const focus = { x: -1000, y: -1000 };
    let strength = 0;
    let grid = [];
    let width = 0;
    let height = 0;
    let ratio = 1;
    let frame = 0;
    let lastMove = 0;

    function build() {
        const cols = Math.ceil(width / SPACING) + 1;
        const rows = Math.ceil(height / SPACING) + 1;
        grid = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const x = c * SPACING;
                const y = r * SPACING;
                row.push({ x, y, ox: x, oy: y, vx: 0, vy: 0 });
            }
            grid.push(row);
        }
    }

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        build();
        render();
    }

    function step() {
        let busy = false;
        for (let r = 0; r < grid.length; r++) {
            const row = grid[r];
            for (let c = 0; c < row.length; c++) {
                const p = row[c];

                if (strength > 0.001) {
                    const dx = focus.x - p.x;
                    const dy = focus.y - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0.0001 && dist < RADIUS) {
                        const force = (RADIUS - dist) / RADIUS * strength;
                        p.vx -= (dx / dist) * force * PUSH;
                        p.vy -= (dy / dist) * force * PUSH;
                    }
                }

                p.vx += (p.ox - p.x) * SPRING;
                p.vy += (p.oy - p.y) * SPRING;
                p.vx *= FRICTION;
                p.vy *= FRICTION;
                p.x += p.vx;
                p.y += p.vy;

                // Cap travel. Without this a node that overshoots the cursor has the
                // force flip on it, which pumps energy in and tears the lattice apart.
                const offX = p.x - p.ox;
                const offY = p.y - p.oy;
                const off = Math.sqrt(offX * offX + offY * offY);
                if (off > MAX_TRAVEL) {
                    const scale = MAX_TRAVEL / off;
                    p.x = p.ox + offX * scale;
                    p.y = p.oy + offY * scale;
                    p.vx *= 0.5;
                    p.vy *= 0.5;
                }

                if (Math.abs(p.x - p.ox) > REST || Math.abs(p.y - p.oy) > REST
                    || Math.abs(p.vx) > REST || Math.abs(p.vy) > REST) {
                    busy = true;
                }
            }
        }
        return busy;
    }

    function render() {
        const rowCount = grid.length;
        if (!rowCount) return;
        const colCount = grid[0].length;
        if (!colCount) return;

        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();

        for (let c = 0; c < colCount; c++) {
            ctx.moveTo(grid[0][c].x, grid[0][c].y);
            for (let r = 1; r < rowCount; r++) {
                ctx.lineTo(grid[r][c].x, grid[r][c].y);
            }
        }

        for (let r = 0; r < rowCount; r++) {
            const row = grid[r];
            ctx.moveTo(row[0].x, row[0].y);
            for (let c = 1; c < row.length; c++) {
                ctx.lineTo(row[c].x, row[c].y);
            }
        }

        ctx.stroke();
    }

    function tick() {
        if (pointer.live && performance.now() - lastMove > IDLE) pointer.live = false;

        // ease the cursor's hold on the mesh in and out
        const target = pointer.live ? 1 : 0;
        strength += (target - strength) * (pointer.live ? STRENGTH_IN : STRENGTH_OUT);
        const strengthMoving = Math.abs(target - strength) > 0.0001;

        if (strength < SNAP) {
            // fully released: sit on the cursor so it never sweeps in from off-screen
            focus.x = pointer.x;
            focus.y = pointer.y;
        } else {
            focus.x += (pointer.x - focus.x) * FOLLOW;
            focus.y += (pointer.y - focus.y) * FOLLOW;
        }

        const busy = step();
        render();
        frame = busy || strengthMoving || pointer.live ? requestAnimationFrame(tick) : 0;
    }

    function wake() {
        if (reduced.matches) return;
        if (!frame) frame = requestAnimationFrame(tick);
    }

    function onMove(event) {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.live = true;
        lastMove = performance.now();
        wake();
    }

    function onLeave() {
        pointer.live = false;
        pointer.x = -1000;
        pointer.y = -1000;
        wake();
    }

    function onMotionChange() {
        if (reduced.matches) {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            build();
            render();
        } else {
            wake();
        }
    }

    // settle check lives in tick(): drop the cursor force once it has been still
    function onVisibility() {
        if (document.hidden) {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
        } else {
            wake();
        }
    }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    // mouseleave, not mouseout: mouseout bubbles up from every child element the
    // pointer crosses, which would reset the cursor on every internal transition
    document.addEventListener("mouseleave", onLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced.addEventListener) reduced.addEventListener("change", onMotionChange);

    // Re-read the lattice colour whenever the page flips theme, so the mesh
    // repaints in the new colour even while the cursor is at rest.
    function readLine() {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue("--grid-line").trim();
        if (value && value !== line) {
            line = value;
            render();
        }
    }
    readLine();
    const themeObserver = new MutationObserver(readLine);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
    });

    resize();

    return { destroy() {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener("resize", resize);
        window.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseleave", onLeave);
        document.removeEventListener("visibilitychange", onVisibility);
        if (reduced.removeEventListener) reduced.removeEventListener("change", onMotionChange);
        themeObserver.disconnect();
        canvas.remove();
    } };
}());
