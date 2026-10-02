/* ============================================================
   OTTER 3D — WebGL otter built with three.js
   Procedural model + realistic lighting + interactive gaze.
   Exposes window.Otter3D for auth.js.
============================================================ */

(function () {

    if (!window.THREE) {
        console.error("otter3d: three.js did not load.");
        return;
    }

    const THREE = window.THREE;

    const REDUCE_MOTION =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const wrap = document.getElementById("otter3d");

    if (!wrap) return;

    /* ---------------- renderer ---------------- */

    let renderer;

    try {
        renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });
    } catch (err) {
        console.error("otter3d: WebGL unavailable", err);
        return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
        38,
        wrap.clientWidth / Math.max(wrap.clientHeight, 1),
        0.1,
        60
    );
    camera.position.set(0, 2.0, 8.0);
    camera.lookAt(0, 1.15, 0);

    /* ---------------- lights ---------------- */

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x7a5c44, 0.85);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1d6, 2.0);
    key.position.set(4.5, 6.5, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2.6;
    key.shadow.camera.right = 2.6;
    key.shadow.camera.top = 3.0;
    key.shadow.camera.bottom = -2.4;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0004;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    fill.position.set(-5, 1.6, 3.5);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe6b0, 1.05);
    rim.position.set(0.5, 3.2, -5.5);
    scene.add(rim);

    const ambient = new THREE.AmbientLight(0xfff4e2, 0.18);
    scene.add(ambient);

    /* ---------------- materials ---------------- */

    function makeFurBumpTexture() {
        const size = 256;
        const cnv = document.createElement("canvas");
        cnv.width = size;
        cnv.height = size;
        const ctx = cnv.getContext("2d");

        ctx.fillStyle = "#808080";
        ctx.fillRect(0, 0, size, size);

        for (let i = 0; i < 4200; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const light = Math.random() > 0.5;
            ctx.strokeStyle = light
                ? "rgba(220,220,225," + (0.25 + Math.random() * 0.3) + ")"
                : "rgba(40,40,45," + (0.25 + Math.random() * 0.3) + ")";
            ctx.lineWidth = 0.7 + Math.random() * 0.9;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4);
            ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(cnv);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(7, 7);
        return tex;
    }

    const furBump = makeFurBumpTexture();

    function furMaterial(colorHex, roughness) {
        return new THREE.MeshStandardMaterial({
            color: colorHex,
            roughness: roughness === undefined ? 0.93 : roughness,
            metalness: 0.0,
            bumpMap: furBump,
            bumpScale: 0.06
        });
    }

    const MAT_BACK = furMaterial(0x6e4d36);
    const MAT_DARK = furMaterial(0x44301f);
    const MAT_LIGHT = furMaterial(0x8a5f43);
    const MAT_BELLY = furMaterial(0xd9b28b, 0.9);
    const MAT_INNER = furMaterial(0xa86a4f);

    const MAT_NOSE = new THREE.MeshStandardMaterial({
        color: 0x140d09,
        roughness: 0.28,
        metalness: 0.05
    });

    const MAT_EYE = new THREE.MeshStandardMaterial({
        color: 0x0d0a08,
        roughness: 0.15,
        metalness: 0.0
    });

    const MAT_WHITE = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2
    });

    const MAT_WHISKER = new THREE.MeshStandardMaterial({
        color: 0xece6d8,
        roughness: 0.55
    });

    /* ---------------- helpers ---------------- */

    function ellipse(radX, radY, radZ, mat) {
        const m = new THREE.Mesh(
            new THREE.SphereGeometry(1, 40, 28),
            mat
        );
        m.scale.set(radX, radY, radZ);
        m.castShadow = true;
        m.receiveShadow = false;
        return m;
    }

    function capsuleMesh(radius, length, mat) {
        const m = new THREE.Mesh(
            new THREE.CapsuleGeometry(radius, length, 4, 10),
            mat
        );
        m.castShadow = true;
        return m;
    }

    function place(parent, mesh, x, y, z) {
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    }

    function whiskerGroup(x, y, z, side) {
        const g = new THREE.Group();
        g.position.set(x, y, z);

        for (let i = 0; i < 3; i++) {
            const w = new THREE.Mesh(
                new THREE.CylinderGeometry(0.009, 0.013, 0.55, 6),
                MAT_WHISKER
            );
            const tilt = -0.45 + i * 0.45;
            const yaw = side * (0.42 + i * 0.14);
            w.setRotationFromEuler(new THREE.Euler(Math.PI / 2 + tilt * 0.2, yaw, 0));
            g.add(w);
        }
        return g;
    }

    /* ---------------- otter ---------------- */

    const otter = new THREE.Group();
    scene.add(otter);

    const bodyPivot = new THREE.Group();
    bodyPivot.position.set(0, 0.62, 0);
    otter.add(bodyPivot);

    /* body */
    place(bodyPivot, ellipse(0.53, 0.45, 0.42, MAT_BACK), 0, 0.85, 0);
    place(bodyPivot, ellipse(0.42, 0.26, 0.3, MAT_BELLY), 0, 0.78, 0.22);
    place(bodyPivot, ellipse(0.4, 0.3, 0.28, MAT_LIGHT), 0, 0.98, 0.16);

    /* rear haunches */
    place(bodyPivot, ellipse(0.3, 0.26, 0.34, MAT_DARK), 0.32, 0.14, -0.18);
    place(bodyPivot, ellipse(0.3, 0.26, 0.34, MAT_DARK), -0.32, 0.14, -0.18);

    /* feet */
    place(bodyPivot, ellipse(0.15, 0.08, 0.24, MAT_DARK), 0.28, 0.1, 0.42);
    place(bodyPivot, ellipse(0.15, 0.08, 0.24, MAT_DARK), -0.28, 0.1, 0.42);

    /* tail */
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.44, -0.4);
    bodyPivot.add(tailPivot);

    const tailSegs = [
        [0, -0.08, 0.0, 0.52, MAT_BACK],
        [-0.06, -0.22, -0.12, 0.46, MAT_BACK],
        [-0.16, -0.38, -0.2, 0.39, MAT_BACK],
        [-0.3, -0.5, -0.22, 0.33, MAT_BACK],
        [-0.46, -0.55, -0.16, 0.26, MAT_DARK],
        [-0.58, -0.5, -0.05, 0.21, MAT_DARK],
        [-0.62, -0.38, 0.08, 0.16, MAT_DARK]
    ];

    tailSegs.forEach(seg => {
        place(tailPivot, ellipse(seg[3], seg[3], seg[3], seg[4]), seg[0], seg[1], seg[2]);
    });

    /* arms */
    const armL = new THREE.Group();
    armL.position.set(-0.56, 1.42, 0.18);
    otter.add(armL);

    const armR = new THREE.Group();
    armR.position.set(0.56, 1.42, 0.18);
    otter.add(armR);

    function buildArm(rig, side) {
        const cap = capsuleMesh(0.13, 0.6, MAT_BACK);
        cap.position.set(0, -0.42, 0.02);
        cap.castShadow = true;
        rig.pawMesh = place(rig, ellipse(0.14, 0.1, 0.12, MAT_LIGHT), 0, -0.78, 0.16);
        rig.add(cap);

        rig.swing = new THREE.Group();
        while (rig.children.length) {
            const child = rig.children[0];
            rig.remove(child);
            rig.swing.add(child);
        }
        rig.add(rig.swing);

        rig.swing.rotation.y = side * -0.1;
        rig.rotation.z = side * 1.2;
        rig.rotation.x = -0.35;
    }

    buildArm(armL, -1);
    buildArm(armR, 1);

    /* head */
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.9, 0.18);
    otter.add(headGroup);

    place(headGroup, ellipse(0.5, 0.43, 0.46, MAT_BACK), 0, 0, 0);
    place(headGroup, ellipse(0.18, 0.2, 0.18, MAT_BACK), 0.45, 0, 0.2);
    place(headGroup, ellipse(0.18, 0.2, 0.18, MAT_BACK), -0.45, 0, 0.2);

    /* ears */
    place(headGroup, ellipse(0.15, 0.15, 0.11, MAT_DARK), 0.4, 0.4, -0.18);
    place(headGroup, ellipse(0.15, 0.15, 0.11, MAT_DARK), -0.4, 0.4, -0.18);
    place(headGroup, ellipse(0.07, 0.07, 0.05, MAT_INNER), 0.4, 0.4, -0.1);
    place(headGroup, ellipse(0.07, 0.07, 0.05, MAT_INNER), -0.4, 0.4, -0.1);

    /* head tufts */
    const tuftL = ellipse(0.1, 0.14, 0.08, MAT_DARK);
    tuftL.rotation.z = -0.3;
    place(headGroup, tuftL, -0.16, 0.46, -0.12);
    const tuftR = ellipse(0.1, 0.14, 0.08, MAT_DARK);
    tuftR.rotation.z = 0.3;
    place(headGroup, tuftR, 0.16, 0.46, -0.12);

    /* face */
    place(headGroup, ellipse(0.42, 0.22, 0.34, MAT_LIGHT), 0, -0.06, 0.44);
    place(headGroup, ellipse(0.22, 0.13, 0.12, MAT_BELLY), 0, -0.18, 0.72);

    const nose = place(headGroup, ellipse(0.075, 0.05, 0.055, MAT_NOSE), 0, -0.16, 0.84);
    const noseGlint = place(headGroup, ellipse(0.02, 0.014, 0.012, MAT_WHITE), -0.022, -0.135, 0.905);

    /* eyes (blinkable) */
    const eyeL = place(headGroup, ellipse(0.05, 0.058, 0.05, MAT_EYE), -0.22, 0.12, 0.62);
    const eyeR = place(headGroup, ellipse(0.05, 0.058, 0.05, MAT_EYE), 0.22, 0.12, 0.62);
    place(headGroup, ellipse(0.018, 0.022, 0.02, MAT_WHITE), -0.22, 0.145, 0.685);
    place(headGroup, ellipse(0.018, 0.022, 0.02, MAT_WHITE), 0.22, 0.145, 0.685);

    /* whiskers */
    headGroup.add(whiskerGroup(-0.46, -0.08, 0.5, -1));
    headGroup.add(whiskerGroup(0.46, -0.08, 0.5, 1));

    /* ---------------- water ground ---------------- */

    const waterTexture = (function () {
        const cnv = document.createElement("canvas");
        cnv.width = cnv.height = 256;
        const ctx = cnv.getContext("2d");
        const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
        grad.addColorStop(0, "rgba(74,205,205,0.55)");
        grad.addColorStop(0.55, "rgba(74,205,205,0.28)");
        grad.addColorStop(0.82, "rgba(74,205,205,0.1)");
        grad.addColorStop(1, "rgba(74,205,205,0.0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);
        const tex = new THREE.CanvasTexture(cnv);
        return tex;
    })();

    const water = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 5.6),
        new THREE.MeshBasicMaterial({
            map: waterTexture,
            transparent: true,
            depthWrite: false
        })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.012, 0);
    scene.add(water);

    const shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 5.4),
        new THREE.ShadowMaterial({
            opacity: 0.34,
            transparent: true
        })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.set(0, 0.004, 0);
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    /* ---------------- state ---------------- */

    const keys = {
        noHead: [
            [0, 0],
            [0.1, 0],
            [0.22, -0.5],
            [0.34, 0.45],
            [0.46, -0.34],
            [0.58, 0.26],
            [0.7, -0.16],
            [0.82, 0.08],
            [0.94, -0.03],
            [1, 0]
        ],
        noTilt: [
            [0, 0],
            [0.15, 0.12],
            [0.3, -0.1],
            [0.5, 0.08],
            [0.7, -0.05],
            [1, 0]
        ],
        happyRise: [
            [0, 0],
            [0.12, 0.6],
            [0.2, 1.1],
            [0.3, 0.42],
            [0.42, 0.72],
            [0.55, 1.3],
            [0.7, 0.34],
            [0.8, 0.5],
            [0.92, 0.14],
            [1, 0]
        ],
        happySpin: [
            [0, 0],
            [0.2, 1.2],
            [0.45, 3.6],
            [0.7, 5.5],
            [0.86, 6.28],
            [1, 6.28]
        ],
        happyTilt: [
            [0, 0],
            [0.2, 0.14],
            [0.4, -0.12],
            [0.6, 0.1],
            [0.8, -0.05],
            [1, 0]
        ],
        happyArm: [
            [0, 0],
            [0.1, 1],
            [0.25, 0.55],
            [0.35, 1],
            [0.5, 0.65],
            [0.6, 1],
            [0.75, 0.45],
            [0.9, 0.15],
            [1, 0]
        ],
        celRise: [
            [0, 0],
            [0.1, 0.85],
            [0.18, 1.8],
            [0.3, 0.42],
            [0.38, 1.0],
            [0.48, 2.0],
            [0.62, 0.32],
            [0.7, 0.72],
            [0.82, 1.15],
            [0.93, 0.2],
            [1, 0]
        ],
        celSpin: [
            [0, 0],
            [0.3, 2.0],
            [0.5, 4.1],
            [0.7, 6.0],
            [0.88, 6.28],
            [1, 6.28]
        ],
        celArm: [
            [0, 0],
            [0.08, 1],
            [0.2, 0.66],
            [0.32, 1],
            [0.44, 0.72],
            [0.56, 1],
            [0.68, 0.66],
            [0.8, 0.34],
            [0.95, 0.1],
            [1, 0.06]
        ]
    };

    function sample(keysArr, t) {
        if (t <= keysArr[0][0]) return keysArr[0][1];
        if (t >= keysArr[keysArr.length - 1][0]) {
            return keysArr[keysArr.length - 1][1];
        }
        for (let i = 0; i < keysArr.length - 1; i++) {
            const ta = keysArr[i][0];
            const va = keysArr[i][1];
            const tb = keysArr[i + 1][0];
            const vb = keysArr[i + 1][1];
            if (t >= ta && t <= tb) {
                const k = (t - ta) / (tb - ta);
                const e = k * k * (3 - 2 * k);
                return va + (vb - va) * e;
            }
        }
        return keysArr[keysArr.length - 1][1];
    }

    let aimElement = null;
    let aimPoint = false;
    let curGaze = { gx: 0.35, gy: -0.1 };
    let mode = "login";
    let reaction = null;

    let pointAmt = 0;
    let headY = 0;
    let headP = 0;
    let headZ = 0;
    let riseY = 0;
    let spinY = 0;
    let blinkUntil = 0;
    let blinkTimer = performance.now() + 2000 + Math.random() * 2500;

    /* ---------------- aim ---------------- */

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function rectDelta(el) {
        const r = el.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const gx = (r.left + r.width / 2 - (wr.left + wr.width / 2)) / (wr.width / 2);
        const gy = (r.top + r.height / 2 - (wr.top + wr.height / 2)) / (wr.height / 2);
        return {
            gx: clamp(gx, -1.05, 1.05),
            gy: clamp(gy, -1.05, 1.05)
        };
    }

    function defaultAim() {
        const card = document.getElementById("authCard");
        if (card) return rectDelta(card);
        return { gx: 0.35, gy: -0.1 };
    }

    /* ---------------- API ---------------- */

    function setAim(element, pointing) {
        aimElement = element || null;
        aimPoint = !!pointing;
    }

    function setMode(nextMode) {
        mode = nextMode;
        aimElement = null;
        aimPoint = false;
    }

    function reactNo() {
        const dur = REDUCE_MOTION ? 0.001 : 620;
        reaction = { type: "no", start: performance.now(), dur };
    }

    function reactHappy() {
        const dur = REDUCE_MOTION ? 0.001 : 1200;
        reaction = { type: "happy", start: performance.now(), dur };
    }

    function celebrate() {
        const dur = REDUCE_MOTION ? 0.001 : 1500;
        reaction = { type: "celebrate", start: performance.now(), dur };
    }

    function stop() {
        if (!running) return;
        running = false;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        window.removeEventListener("resize", resize);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
    }

    window.Otter3D = {
        setAim: setAim,
        setMode: setMode,
        reactNo: reactNo,
        reactHappy: reactHappy,
        celebrate: celebrate,
        stop: stop
    };

    /* ---------------- resize ---------------- */

    function resize() {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    let resizeObserver = null;
    if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(wrap);
    }
    window.addEventListener("resize", resize);

    /* ---------------- loop ---------------- */

    let last = performance.now();
    let running = true;
    let animationFrame = 0;

    function update(now) {
        const dt = clamp((now - last) / 1000, 0, 0.05);
        last = now;
        const t = now / 1000;

        /* reaction */
        let rHead = 0;
        let rTilt = 0;
        let armWave = 0;

        if (reaction) {
            const u = clamp((now - reaction.start) / reaction.dur, 0, 1);
            if (reaction.type === "no") {
                rHead = sample(keys.noHead, u);
                rTilt = sample(keys.noTilt, u);
            } else if (reaction.type === "happy") {
                riseY = sample(keys.happyRise, u);
                spinY = sample(keys.happySpin, u);
                rTilt = sample(keys.happyTilt, u);
                armWave = sample(keys.happyArm, u);
            } else if (reaction.type === "celebrate") {
                riseY = sample(keys.celRise, u);
                spinY = sample(keys.celSpin, u);
                armWave = sample(keys.celArm, u);
            }
            if (u >= 1) {
                reaction = null;
                if (reaction === null) {
                    spinY *= 0; /* settle handled below */
                }
            }
        } else {
            riseY += (0 - riseY) * Math.min(1, dt * 3.2);
            spinY += (0 - spinY) * Math.min(1, dt * 4);
        }

        /* gaze */
        const aim = aimElement ? rectDelta(aimElement) : defaultAim();
        const speed = REDUCE_MOTION ? 1 : Math.min(1, dt * 5);
        curGaze.gx += (aim.gx - curGaze.gx) * speed;
        curGaze.gy += (aim.gy - curGaze.gy) * speed;

        const maxYaw = REDUCE_MOTION ? 0.85 : 0.8;
        const maxPitch = 0.5;
        const targetHeadY = curGaze.gx * maxYaw + rHead;
        const targetHeadP = curGaze.gy * maxPitch;
        const targetHeadZ = rTilt;

        headY += (targetHeadY - headY) * Math.min(1, dt * 8);
        headP += (targetHeadP - headP) * Math.min(1, dt * 8);
        headZ += (targetHeadZ - headZ) * Math.min(1, dt * 10);

        headGroup.rotation.y = headY;
        headGroup.rotation.x = headP;
        headGroup.rotation.z = headZ;

        /* pointing arm */
        const wantPoint = aimPoint ? 1 : 0;
        pointAmt += (wantPoint - pointAmt) * Math.min(1, dt * 4);
        const point = pointAmt * (1 - (reaction ? armWave * 0.5 : 0));

        armR.swing.rotation.y = -0.1 + point * 1.0;
        armR.rotation.x = -0.35 + point * -1.95;
        armL.rotation.x = -0.35 + armWave * -1.4;
        armL.rotation.z = 1.2 + armWave * 0.5;

        /* chest turns toward gaze */
        const leanY = curGaze.gx * 0.24;
        bodyPivot.rotation.y += (leanY + point * 0.15 - bodyPivot.rotation.y) * Math.min(1, dt * 3);
        bodyPivot.rotation.z += (Math.sin(t * 0.7) * 0.02 - bodyPivot.rotation.z) * Math.min(1, dt * 2);

        /* idle */
        if (!REDUCE_MOTION) {
            otter.position.y = riseY + Math.sin(t * 1.7) * 0.05;
            otter.rotation.y = spinY + Math.sin(t * 0.45) * 0.03;
            otter.rotation.z = Math.sin(t * 0.8) * 0.015;
            tailPivot.rotation.x = Math.sin(t * 1.9) * 0.06;
            tailPivot.rotation.y = Math.sin(t * 1.4) * 0.08;
            water.scale.x = 1 + Math.sin(t * 1.1) * 0.015;
            water.scale.y = 1 - Math.sin(t * 1.1) * 0.015;
        } else {
            otter.position.y = riseY;
            otter.rotation.y = spinY;
            otter.rotation.z = 0;
            tailPivot.rotation.x = 0;
            tailPivot.rotation.y = 0;
        }

        /* arms wave during happiness */
        if (reaction && (reaction.type === "happy" || reaction.type === "celebrate")) {
            const flap = Math.sin(t * 14) * (armWave ? 0.25 : 0);
            armL.rotation.x += (flap * -0.5);
            armR.rotation.x += flap * 0.4;
        }

        /* blink */
        if (now > blinkTimer) {
            blinkUntil = now + 130;
            blinkTimer = now + 2600 + Math.random() * 2800;
        }
        const blink = now < blinkUntil ? 0.12 : 1;
        eyeL.scale.y = 0.058 * blink;
        eyeR.scale.y = 0.058 * blink;

        renderer.render(scene, camera);
    }

    function loop() {
        if (!running) return;
        animationFrame = requestAnimationFrame(loop);
        update(performance.now());
    }

    loop();
    resize();

})();