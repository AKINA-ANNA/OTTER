/* ============================================================
   TUTORIAL OTTER 3D — WebGL otter built with three.js
   A playful, guide-like variant of the login otter with tutorial-specific animations.
   Exposes window.TutorialOtter for tutorial.js.
   ============================================================ */

(function () {

    if (!window.THREE) {
        console.error("tutorial-otter: three.js did not load.");
        return;
    }

    const THREE = window.THREE;

    const REDUCE_MOTION =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------------- state ---------------- */

    let canvas = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let otter = null;
    let headGroup = null;
    let bodyPivot = null;
    let armL = null;
    let armR = null;
    let tailPivot = null;
    let eyeL = null;
    let eyeR = null;
    let noseGlint = null;
    let water = null;
    let shadowPlane = null;

    let animationFrame = 0;
    let running = false;
    let lastTime = 0;

    /* Animation state */
    let mode = "idle"; // idle, wave, point, celebrate, bounce, think, sleep, excited
    let modeStartTime = 0;
    let modeDuration = 0;

    /* Gaze tracking */
    let targetGaze = { x: 0, y: 0 };
    let currentGaze = { x: 0, y: 0 };

    /* Blink */
    let blinkUntil = 0;
    let nextBlinkTime = 0;

    /* Idle animation offsets */
    let idleTime = 0;

    /* Reaction system */
    let currentReaction = null;

    /* Canvas size */
    let canvasWidth = 150;
    let canvasHeight = 150;

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

    // Tutorial otter colors - slightly different from login otter (more playful)
    const MAT_BACK = furMaterial(0x5d442e);      // Slightly warmer brown
    const MAT_DARK = furMaterial(0x3d2a1a);
    const MAT_LIGHT = furMaterial(0x7d5a3d);     // Warmer light
    const MAT_BELLY = furMaterial(0xe8c49a, 0.9); // Creamier belly
    const MAT_INNER = furMaterial(0x9d6442);

    const MAT_NOSE = new THREE.MeshStandardMaterial({
        color: 0x1a120a,
        roughness: 0.25,
        metalness: 0.05
    });

    const MAT_EYE = new THREE.MeshStandardMaterial({
        color: 0x0a0806,
        roughness: 0.1,
        metalness: 0.0
    });

    const MAT_WHITE = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.15
    });

    const MAT_WHISKER = new THREE.MeshStandardMaterial({
        color: 0xf0ebe0,
        roughness: 0.5
    });

    /* Water material */
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

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function smoothStep(t) {
        return t * t * (3 - 2 * t);
    }

    /* ---------------- build otter ---------------- */

    function buildOtter() {
        otter = new THREE.Group();
        scene.add(otter);

        /* Body pivot for breathing/bouncing */
        bodyPivot = new THREE.Group();
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
        tailPivot = new THREE.Group();
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
        armL = new THREE.Group();
        armL.position.set(-0.56, 1.42, 0.18);
        otter.add(armL);

        armR = new THREE.Group();
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
        headGroup = new THREE.Group();
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
        noseGlint = place(headGroup, ellipse(0.02, 0.014, 0.012, MAT_WHITE), -0.022, -0.135, 0.905);

        /* eyes (blinkable) - slightly larger for more expression */
        eyeL = place(headGroup, ellipse(0.055, 0.065, 0.055, MAT_EYE), -0.22, 0.12, 0.62);
        eyeR = place(headGroup, ellipse(0.055, 0.065, 0.055, MAT_EYE), 0.22, 0.12, 0.62);
        place(headGroup, ellipse(0.018, 0.022, 0.02, MAT_WHITE), -0.22, 0.145, 0.685);
        place(headGroup, ellipse(0.018, 0.022, 0.02, MAT_WHITE), 0.22, 0.145, 0.685);

        /* whiskers */
        headGroup.add(whiskerGroup(-0.46, -0.08, 0.5, -1));
        headGroup.add(whiskerGroup(0.46, -0.08, 0.5, 1));

        /* water ground */
        water = new THREE.Mesh(
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

        shadowPlane = new THREE.Mesh(
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
    }

    /* ---------------- initialization ---------------- */

    function init(canvasEl) {
        canvas = canvasEl;

        if (running) return;

        /* renderer */
        try {
            renderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: true,
                antialias: true
            });
        } catch (err) {
            console.error("tutorial-otter: WebGL unavailable", err);
            return;
        }

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;

        /* scene */
        scene = new THREE.Scene();

        /* camera */
        camera = new THREE.PerspectiveCamera(
            38,
            canvasWidth / Math.max(canvasHeight, 1),
            0.1,
            60
        );
        camera.position.set(0, 2.0, 8.0);
        camera.lookAt(0, 1.15, 0);

        /* lights */
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

        /* build otter */
        buildOtter();

        /* resize */
        resize();

        /* start loop */
        running = true;
        lastTime = performance.now();
        animationFrame = requestAnimationFrame(loop);

        /* schedule first blink */
        scheduleBlink();
    }

    function resize() {
        if (!canvas || !renderer || !camera) return;
        canvasWidth = canvas.clientWidth || 150;
        canvasHeight = canvas.clientHeight || 150;
        if (canvasWidth === 0 || canvasHeight === 0) return;
        renderer.setSize(canvasWidth, canvasHeight);
        camera.aspect = canvasWidth / canvasHeight;
        camera.updateProjectionMatrix();
    }

    /* ---------------- animation modes ---------------- */

    function setMode(newMode, duration = 0) {
        mode = newMode;
        modeStartTime = performance.now();
        modeDuration = duration;
    }

    function triggerReaction(type) {
        const reactions = {
            wave: { duration: 1500, mode: "wave" },
            point: { duration: 2000, mode: "point" },
            celebrate: { duration: 2000, mode: "celebrate" },
            bounce: { duration: 1000, mode: "bounce" },
            think: { duration: 2500, mode: "think" },
            excited: { duration: 1800, mode: "excited" },
            nod: { duration: 1200, mode: "nod" },
            shake: { duration: 1200, mode: "shake" }
        };

        const reaction = reactions[type];
        if (reaction) {
            currentReaction = { type: reaction.mode, start: performance.now(), dur: reaction.duration };
            setMode(reaction.mode, reaction.duration);
        }
    }

    /* ---------------- gaze ---------------- */

    function setGaze(x, y) {
        targetGaze.x = clamp(x, -1, 1);
        targetGaze.y = clamp(y, -1, 1);
    }

    function clearGaze() {
        targetGaze.x = 0;
        targetGaze.y = 0;
    }

    /* ---------------- blink ---------------- */

    function scheduleBlink() {
        nextBlinkTime = performance.now() + 2000 + Math.random() * 3000;
    }

    function triggerBlink() {
        blinkUntil = performance.now() + 150;
        scheduleBlink();
    }

    /* ---------------- update loop ---------------- */

    function update(now) {
        const dt = clamp((now - lastTime) / 1000, 0, 0.05);
        lastTime = now;
        const t = now / 1000;
        idleTime += dt;

        /* Reaction handling */
        let reactionProgress = 0;
        let reactionActive = false;

        if (currentReaction) {
            reactionProgress = clamp((now - currentReaction.start) / currentReaction.dur, 0, 1);
            reactionActive = reactionProgress < 1;

            if (!reactionActive) {
                currentReaction = null;
                setMode("idle");
            }
        }

        /* Gaze smoothing */
        const gazeSpeed = REDUCE_MOTION ? 1 : Math.min(1, dt * 6);
        currentGaze.x += (targetGaze.x - currentGaze.x) * gazeSpeed;
        currentGaze.y += (targetGaze.y - currentGaze.y) * gazeSpeed;

        /* Head rotation from gaze + reaction */
        let headYaw = currentGaze.x * 0.8;
        let headPitch = currentGaze.y * 0.5;
        let headRoll = 0;

        /* Body lean */
        let bodyLeanY = currentGaze.x * 0.15;
        let bodyLeanZ = 0;

        /* Mode-specific animations */
        let armWaveL = 0;
        let armWaveR = 0;
        let pointAmount = 0;
        let bounceAmount = 0;
        let excitedSpin = 0;
        let excitedRise = 0;

        if (reactionActive) {
            const u = smoothStep(reactionProgress);
            const uInv = 1 - u;

            switch (currentReaction.type) {
                case "wave":
                    armWaveR = Math.sin(t * 12) * 0.8 * uInv;
                    armWaveL = Math.sin(t * 12 + Math.PI) * 0.3 * uInv;
                    headYaw += Math.sin(t * 3) * 0.15 * uInv;
                    bounceAmount = Math.sin(t * 4) * 0.08 * uInv;
                    break;

                case "point":
                    pointAmount = uInv;
                    armWaveR = -0.2 * uInv;
                    headYaw += currentGaze.x * 0.3 * uInv;
                    break;

                case "celebrate":
                    excitedRise = Math.sin(u * Math.PI) * 0.3;
                    excitedSpin = u * Math.PI * 2;
                    armWaveL = Math.sin(t * 15) * 0.6 * uInv;
                    armWaveR = Math.sin(t * 15 + Math.PI) * 0.6 * uInv;
                    bounceAmount = Math.sin(t * 8) * 0.12 * uInv;
                    headRoll = Math.sin(t * 5) * 0.2 * uInv;
                    break;

                case "bounce":
                    bounceAmount = Math.sin(u * Math.PI * 2) * 0.15;
                    armWaveL = Math.sin(t * 10) * 0.4 * uInv;
                    armWaveR = Math.sin(t * 10) * 0.4 * uInv;
                    break;

                case "think":
                    headPitch = -0.2 + Math.sin(t * 2) * 0.1;
                    headYaw = Math.sin(t * 1.5) * 0.3;
                    armWaveL = -0.3;
                    armWaveR = 0.1;
                    headRoll = Math.sin(t * 1) * 0.1;
                    break;

                case "excited":
                    excitedRise = Math.sin(t * 8) * 0.15 * uInv;
                    excitedSpin = Math.sin(t * 3) * 0.5 * uInv;
                    bounceAmount = Math.sin(t * 6) * 0.1 * uInv;
                    armWaveL = Math.sin(t * 14) * 0.5 * uInv;
                    armWaveR = Math.sin(t * 14 + Math.PI) * 0.5 * uInv;
                    headYaw += Math.sin(t * 4) * 0.2 * uInv;
                    break;

                case "nod":
                    headPitch = Math.sin(u * Math.PI * 2) * 0.4;
                    break;

                case "shake":
                    headYaw = Math.sin(u * Math.PI * 4) * 0.5;
                    break;
            }
        } else {
            /* Idle animations */
            if (!REDUCE_MOTION) {
                bounceAmount = Math.sin(t * 1.7) * 0.04;
                bodyLeanZ = Math.sin(t * 0.8) * 0.01;
                tailPivot.rotation.x = Math.sin(t * 1.9) * 0.06;
                tailPivot.rotation.y = Math.sin(t * 1.4) * 0.08;
            }
        }

        /* Apply head rotation */
        headGroup.rotation.y = headYaw;
        headGroup.rotation.x = headPitch;
        headGroup.rotation.z = headRoll;

        /* Apply body lean */
        bodyPivot.rotation.y += (bodyLeanY - bodyPivot.rotation.y) * Math.min(1, dt * 3);
        bodyPivot.rotation.z += (bodyLeanZ - bodyPivot.rotation.z) * Math.min(1, dt * 2);

        /* Vertical bounce/rise */
        otter.position.y = excitedRise + bounceAmount;

        /* Excited spin */
        otter.rotation.y = excitedSpin;

        /* Arm animations */
        const pointLerp = clamp(pointAmount, 0, 1);

        // Right arm - pointing
        armR.swing.rotation.y = -0.1 + pointLerp * 1.2;
        armR.rotation.x = -0.35 + pointLerp * -1.8 + armWaveR;
        armR.rotation.z = armWaveR * 0.3;

        // Left arm - waving/gesturing
        armL.rotation.x = -0.35 + armWaveL;
        armL.rotation.z = 1.2 + armWaveL * 0.5;

        /* Chest turns slightly toward gaze */
        const chestTurn = currentGaze.x * 0.15 + pointLerp * 0.1;
        bodyPivot.rotation.y += (chestTurn - bodyPivot.rotation.y) * Math.min(1, dt * 2);

        /* Water subtle animation */
        if (!REDUCE_MOTION) {
            water.scale.x = 1 + Math.sin(t * 1.1) * 0.015;
            water.scale.y = 1 - Math.sin(t * 1.1) * 0.015;
        }

        /* Blink */
        if (now > nextBlinkTime) {
            triggerBlink();
        }
        const blink = now < blinkUntil ? 0.1 : 1;
        eyeL.scale.y = 0.065 * blink;
        eyeR.scale.y = 0.065 * blink;

        /* Nose glint follows light */
        if (noseGlint) {
            noseGlint.rotation.y = t * 0.2;
        }

        renderer.render(scene, camera);
    }

    function loop() {
        if (!running) return;
        animationFrame = requestAnimationFrame(loop);
        update(performance.now());
    }

    /* ---------------- public API ---------------- */

    function dispose() {
        if (!running) return;
        running = false;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        if (renderer) {
            renderer.dispose();
            renderer.forceContextLoss();
            if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        }
        canvas = null;
        renderer = null;
        scene = null;
        camera = null;
        otter = null;
        headGroup = null;
        bodyPivot = null;
        armL = null;
        armR = null;
        tailPivot = null;
        eyeL = null;
        eyeR = null;
        noseGlint = null;
        water = null;
        shadowPlane = null;
    }

    window.TutorialOtter = {
        init,
        resize,
        dispose,
        setMode,
        triggerReaction,
        setGaze,
        clearGaze,
        triggerBlink
    };

})();