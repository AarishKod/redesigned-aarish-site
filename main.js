import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_PATH = 'models/o_model_opt.glb';
const HDRI_PATH = 'models/ferndale_studio_01_1k.hdr';
const PRINCETON_BUILDING_PATH = 'models/low-poly_university.glb'

// Track layout. Scroll progress maps onto 0 → TRACK_END in world units of z.
const STATIONS = [0, 40, 80, 120];
const TRACK_END = STATIONS[STATIONS.length - 1];

// --- track direction -------------------------------------------------------
// The car drives in a straight line, angled toward the building rather than
// straight down +z. z is deliberately kept at 1 so carZ stays equal to the
// car's literal world z, which keeps the scroll and blend maths readable.
//
// To land the car beside the building, set:
//     TRACK_LATERAL = (desired final x) / TRACK_END
// e.g. arriving at x = -14 over 80 units → -0.175
const TRACK_LATERAL = -0.18;

const TRACK_DIR = new THREE.Vector3(TRACK_LATERAL, 0, 1);
const TRACK_LEN = TRACK_DIR.length();               // > 1 on a diagonal

// Heading while driving is derived from the track direction, so the nose points
// exactly where the car is going — no crabbing. The hero pose is a separate
// angle, and the two blend over BLEND_DIST.
const DRIVE_HEADING = Math.atan2(TRACK_DIR.x, TRACK_DIR.z);
const HERO_HEADING = -Math.PI / 10;
const INTRO_YAW = 0.25;           // extra radians of yaw the intro unwinds

// --- camera ----------------------------------------------------------------
const BLEND_DIST = 8;            // world units over which the hero handoff happens

// three.js holds the VERTICAL fov fixed, so a narrow viewport collapses the
// horizontal field rather than the vertical one: fov 35 at a 430x932 aspect
// yields hFov 16.6 deg, at which the car measures 107% of frame width and is
// cropped off BOTH edges. A profile may therefore specify a HORIZONTAL field
// and have the vertical one derived from the live aspect.
//
// The clamp guards both ends: above ~62 deg an ultra-tall phone starts showing
// edge distortion plus two slabs of flat background with no horizon to break
// them; below 40 deg a tablet-ish portrait aspect pushes the car's silhouette
// taller than the CSS band can hold.
function resolveFov(spec, aspect) {
    if (spec.mode === 'vertical') return spec.deg;
    const h = THREE.MathUtils.degToRad(spec.deg);
    const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
    return THREE.MathUtils.clamp(v, spec.min, spec.max);
}

// Where the swing from side view to rear view starts and finishes, in world z.
// Ends short of TRACK_END because damping means carZ only ever approaches it.
const ARRIVE_START = 5;
const ARRIVE_END = 40;

// Finale (station 3): the camera settles directly behind the car with the car
// centred, and the "NUImpact" 3D sign is revealed to the car's left.
const FINALE_START = 90;
const FINALE_END = 116;
// The finale camera is placed along the car's OWN heading, not the world z axis,
// so the rear faces us dead-on and no flank shows. FORWARD is the unit heading.
const FORWARD = TRACK_DIR.clone().normalize();
// --- view profiles ---------------------------------------------------------
// Pure camera framing: swapping one costs nothing, so these are re-selected on
// resize. Anything baked into GPU state lives in TIER instead, further down.
//
// Offsets are RELATIVE TO THE CAR. Keeping them relative is what holds the
// framing distance constant — absolute x would let the gap grow as the car
// drifts laterally down the angled track.
const VIEW_DESKTOP = {
    id: 'desktop',
    fov: { mode: 'vertical', deg: 35 },

    heroPos: new THREE.Vector3(2.5, 6, -10),
    heroTgt: new THREE.Vector3(2.5, 0.75, 0),

    // y is 5 and z carries a -2 that used to be applied inline in the loop:
    // the lerped offset y was computed and then thrown away in favour of a
    // literal 5, and `lerp(a, b, t) - 2 === lerp(a - 2, b - 2, t)`. Folding
    // both in here is algebraically identical and makes the constants honest.
    sideOff: new THREE.Vector3(8, 5, -12),
    sideAim: new THREE.Vector3(-7, 0.75, 0),
    rearOff: new THREE.Vector3(0, 5, -11),
    rearAim: new THREE.Vector3(-3, 0.75, 0),

    finaleDist: 14,              // how far behind the car the camera sits
    finaleHeight: 7,             // camera elevation at the finale
    finaleAimY: 0.9,             // look at the car's mid-height, so it's centred

    signOffset: new THREE.Vector3(5, 0, 5),
    signShadow: true,            // stands on the ground, so the shadow anchors it
    cardMode: 'ground',

    heroHeading: HERO_HEADING,   // car turned toward the viewer at the hero
    introYaw: INTRO_YAW,

    introDolly: 2.5,
    introLift: 1.2,
};

// Solved against the model's measured bounding box (L 4.642 x W 2.027 x
// H 1.418, centred on x) so the car's silhouette lands inside the CSS band at
// every stop, on aspects from 0.45 to 0.53. The aims sit at x = 0, i.e. ON the
// car, which is what centres it — desktop deliberately aims to one side to
// leave room for text, and that is exactly what breaks in portrait.
//
// Less flank than desktop, not more: in a narrow frame a rear-on car is
// narrower and can therefore sit closer and read bigger.
// Stations 1 and 2 share the FINALE's pose, so the camera is square-on to the
// car's rear there and does not move from station 1 all the way through the
// finale. Hoisted and referenced twice rather than typed twice: if the two
// drifted apart the finale swing would stop being a no-op and the camera would
// lurch at carZ 90.
const P_FIN_DIST = 11.88, P_FIN_HEIGHT = 5.57, P_FIN_AIM_Y = 1.48;
const P_REAR_OFF = new THREE.Vector3(
    -FORWARD.x * P_FIN_DIST, P_FIN_HEIGHT, -FORWARD.z * P_FIN_DIST);
const P_REAR_AIM = new THREE.Vector3(0, P_FIN_AIM_Y, 0);

const VIEW_PORTRAIT = {
    id: 'portrait',
    fov: { mode: 'horizontal', deg: 28, min: 40, max: 62 },

    // The hero and the transitional side shot both reuse the station pose, so
    // on mobile the camera holds one angle on the car from the very first
    // frame to the finale: every blend in the loop lerps between equal values.
    // The car sits at the origin at the hero, so its absolute pose is simply
    // the station offset and aim.
    heroPos: P_REAR_OFF.clone(),
    heroTgt: P_REAR_AIM.clone(),
    sideOff: P_REAR_OFF.clone(),
    sideAim: P_REAR_AIM.clone(),

    // Derived from the finale, which is what makes stations 1, 2 and 3 share
    // one pose. The old value pointed straight down WORLD -z while the car
    // drives down a track angled by DRIVE_HEADING, so the camera sat 10.2 deg
    // off the car's own axis — that was the sliver of flank on show.
    rearOff: P_REAR_OFF.clone(),
    rearAim: P_REAR_AIM.clone(),

    finaleDist: P_FIN_DIST,
    finaleHeight: P_FIN_HEIGHT,
    finaleAimY: P_FIN_AIM_Y,     // above the car's mid-height, which pushes the
                                 // car low and clears room for the sign above

    // On the view axis BEYOND the car and lifted into a gantry. The finale
    // camera looks DOWN, so a more distant object at the same height appears
    // higher in frame — which is what gets the sign above the car without
    // moving the camera. The desktop placement is 5.8 units to the car's RIGHT
    // (the old comment claimed left), which lands at NDC x 1.29 in portrait.
    // y calibrated in-page: at 2.50 the sign's cap collided with the HTML
    // "What's Next?" headline (measured gap -0.001 of viewport height).
    signOffset: new THREE.Vector3(-1.05, 1.90, 5.82),

    // Airborne, so there is nothing for a shadow to sit on: a 6.6-unit-wide
    // text lifted clear of the ground casts a soft smear that reaches the
    // frame edge and reads as a smudge rather than as signage.
    signShadow: false,

    // A PlaneGeometry(7,4) lying flat is seen at a ~19 deg grazing angle: its
    // 4 units of depth foreshorten to 1.3 against 7 of width, a 5.6:1
    // letterbox of body text overlapping both car and sign. The copy lives in
    // #whatsnext as real HTML instead.
    cardMode: 'off',

    // The car already faces down the track at the hero, and the intro adds no
    // yaw, so together with the shared camera pose above nothing about the
    // car's angle on screen changes from load to the finale.
    heroHeading: DRIVE_HEADING,
    introYaw: 0,

    introDolly: 1.8,
    introLift: 0.9,
};

// Classification, not raw aspect: an iOS URL-bar collapse moves innerHeight by
// ~90px, which would flip an aspect threshold but must never swap framing.
const viewKeyOf = (w, h) => (h >= w && w <= 820) ? 'portrait' : 'wide';
const pickView = (w, h) => viewKeyOf(w, h) === 'portrait' ? VIEW_PORTRAIT : VIEW_DESKTOP;

let VIEW = pickView(window.innerWidth, window.innerHeight);

// Matching the old per-frame lerp at 60Hz: it retained (1 - 0.06) of the error
// each FRAME, so the choreography ran at half its intended half-life on a
// 120Hz display and slower still when throttled.
//     exp(-(1/60) / tau) = 0.94  ->  tau = 0.2694
const SCROLL_TAU = 0.269;        // seconds; larger = heavier, more trailing
const MAX_WHEEL_SPEED = 4.5;     // world units/sec — caps apparent wheel speed
const HAZARD_PERIOD = 500;       // ms per on/off phase (~1 Hz)
const STOP_SPEED = 1.2;          // world units/SEC below this counts as stopped
                                 // (= the old 0.02/frame x 60, but frame-rate
                                 // independent now that damping is dt-scaled)

// --- building --------------------------------------------------------------
const BUILDING_POS = new THREE.Vector3(-23, 4.13, 65);
const BUILDING_ROT_Y = 0;
const CUT_HEIGHT = 14;           // cull meshes starting above this; null = keep all
const LOG_BUILDING_MESHES = false;   // flip on to re-measure the slab and footprint

// Lamp meshes, identified by name. Every exterior lamp shares one material,
// so these had to be found geometrically rather than by material name:
//   Object_524 — the light bar
//   Object_544 — the lamps flanking the bar, left and right in one mesh
//   Object_510 / 512 — front indicators
const BAR = ['Object_524'];
const HAZARDS = ['Object_544', 'Object_510', 'Object_512'];


// module scope
// One entry per STATIONS index. null = always-visible hero, no reveal needed.
const stationEls = [
    null,                                   // 0 — hero, always visible
    document.querySelector('#munichre'),    // 1
    document.querySelector('#northeastern'),// 2
    document.querySelector('#whatsnext'),   // 3
];
// Half the station spacing, so the reveal windows tile the track exactly: one
// station lit at a time, no gap and no overlap. At 12 a station went dark
// while its section was still fully on screen.
const REVEAL_RANGE = 20;          // units before/after the station


// ---------------------------------------------------------------------------
// Render tier
// ---------------------------------------------------------------------------

// Decided ONCE at boot and never revisited. Everything here is baked into GPU
// state — the light count determines every MeshStandardMaterial shader
// program, and the shadow map size allocates an FBO — so re-deciding on resize
// would mean a full shader recompile mid-scroll and would invalidate the
// programs reveal()'s compileAsync warmed.
const IS_TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
// screen.* rather than innerWidth: rotation-invariant and immune to the URL bar.
const SMALL_SCREEN = Math.min(window.screen.width, window.screen.height) <= 500;
const TIER = (IS_TOUCH && SMALL_SCREEN) ? 'mobile' : 'desktop';

// The old line MULTIPLIED device pixel ratio rather than capping it, so a
// DPR-3 phone rendered at 3x native with antialias and 2048 soft shadows.
const DPR_CAP = TIER === 'mobile' ? 2 : 3;
const DPR_SCALE = TIER === 'mobile' ? 1 : 1.5;
const dprFor = () => Math.min(window.devicePixelRatio * DPR_SCALE, DPR_CAP);

// 40/1024 = 3.9cm per texel, exactly matching desktop's 80/2048 — identical
// world-space softness for a quarter of the memory and a quarter of the
// shadow-pass work. The tighter extent is safe because the building that the
// original +-40 frustum was sized for is never loaded.
const SHADOW = TIER === 'mobile'
    ? { size: 1024, extent: 20, near: 1, far: 40 }
    : { size: 2048, extent: 40, near: 0.5, far: 500 };

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: TIER === 'mobile' ? 'default' : 'high-performance',
});
renderer.setPixelRatio(dprFor());
renderer.setSize(window.innerWidth, window.innerHeight);

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.domElement.id = 'scene';
document.body.appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// Scene + camera
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfcfbf8);

const camera = new THREE.PerspectiveCamera(
    resolveFov(VIEW.fov, window.innerWidth / window.innerHeight),
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.copy(VIEW.heroPos);
camera.lookAt(VIEW.heroTgt);

// No OrbitControls. The camera is fully derived from scroll position, and
// orbit controls keep a wheel listener attached even when disabled — which
// swallows scroll events over the canvas.

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// A reload must not restore mid-page scroll: the render loop maps scrollY onto
// carZ, so a restored offset would start the car part-way down the track,
// out of frame, behind the loading overlay.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Intro: the car settles into its hero pose as the overlay dissolves.
const INTRO_MS = 1600;
// dolly and lift now come from the view profile — portrait needs a shorter
// move, because the same world-unit dolly reads as a much larger gesture in a
// narrower frame.
let introStart = null;

// LoadingManager.onProgress reports ITEM COUNTS, not bytes — with three assets
// the bar would step 0 -> 33 -> 66 -> 100 and sit frozen in between. So the
// percentage is driven from each loader's own xhr bytes, weighted by nominal
// file size, and the manager is used only to orchestrate the reveal.
const ASSETS = {
    car: { weight: 3559080, p: 0 },
    hdri: { weight: 1632708, p: 0 },
    font: { weight: 109250, p: 0 },
};
const WEIGHT_TOTAL = Object.values(ASSETS).reduce((sum, a) => sum + a.weight, 0);

const loaderEl = document.getElementById('loader');
const loaderFillEl = document.getElementById('loader-fill');
const loaderPctEl = document.getElementById('loader-pct');

let shownProgress = 0;
let revealed = false;

// Bounds only the ASYNC tail of compileAsync — the driver readiness poll.
// The compile itself is synchronous on the main thread and cannot be
// preempted by a timer, so this is a guard against a driver that never
// reports ready, not a cap on compile cost. Measured ~100ms on an M1.
const COMPILE_BUDGET_MS = 2500;

function paintProgress() {
    const p = Object.values(ASSETS)
        .reduce((sum, a) => sum + a.p * a.weight, 0) / WEIGHT_TOTAL;

    // Monotonic: a wrong Content-Length must never walk the bar backwards.
    shownProgress = Math.max(shownProgress, p);
    const pct = Math.round(shownProgress * 100);

    if (loaderFillEl) loaderFillEl.style.width = `${(shownProgress * 100).toFixed(1)}%`;
    if (loaderPctEl) loaderPctEl.textContent = `${pct}%`;
    if (loaderEl) loaderEl.setAttribute('aria-valuenow', String(pct));
}

function trackBytes(key) {
    return (xhr) => {
        const asset = ASSETS[key];
        asset.p = xhr.total
            ? xhr.loaded / xhr.total
            // No Content-Length (a gzipped .hdr does this). Creep toward 0.9
            // so a missing header degrades instead of freezing the bar.
            : asset.p + (0.9 - asset.p) * 0.08;
        paintProgress();
    };
}

function reveal() {
    if (revealed) return;
    revealed = true;

    const start = () => {
        document.body.classList.remove('is-loading');

        if (loaderEl) {
            loaderEl.classList.add('is-done');
            // Timer rather than transitionend: under reduced motion the
            // transition is removed, so transitionend would never fire.
            setTimeout(() => { loaderEl.hidden = true; }, REDUCED_MOTION ? 0 : 700);
        }

        if (!REDUCED_MOTION) {
            // The light bar flicks on part-way through the intro.
            lamps.bar.forEach(m => { m.material.emissiveIntensity = 0; });
            introStart = performance.now();
        }
    };

    // Warms the shaders for the model's embedded textures, so the first frame
    // the visitor actually sees doesn't hitch.
    const warm = renderer.compileAsync
        ? renderer.compileAsync(scene, camera)
        : Promise.resolve();

    // Reveal anyway if the readiness poll never resolves; worst case is a
    // brief hitch on the first frame, which beats a stranded overlay. start is
    // passed as both handlers so a rejection cannot strand it either.
    Promise.race([
        warm,
        new Promise(resolve => setTimeout(resolve, COMPILE_BUDGET_MS)),
    ]).then(start, start);
}

// A permanently stalled asset must never trap the visitor behind an opaque
// overlay.
setTimeout(reveal, 20000);

const manager = new THREE.LoadingManager();

manager.onLoad = () => {
    Object.values(ASSETS).forEach(a => { a.p = 1; });
    paintProgress();
    reveal();
};

// Deliberately does not reveal. A failing loader still calls itemEnd, so
// onLoad above fires once everything settles and handles the reveal — whereas
// revealing here would tear the overlay away mid-download of the other
// assets. The watchdog covers the case where nothing settles at all.
manager.onError = (url) => {
    console.error('Asset failed to load:', url);
};

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

new RGBELoader(manager).load(
    HDRI_PATH,
    (hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = hdr;
        // Background stays flat Paper — only reflections come from the HDRI.
    },
    trackBytes('hdri'),
    (err) => console.error('HDRI failed to load:', err)
);

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

// Key light. Carries the cast shadow; the HDRI carries most of the exposure.
// The frustum is wide enough to cover the building as well as the car.
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(5, 10, 7.5);
key.castShadow = true;
key.shadow.mapSize.set(SHADOW.size, SHADOW.size);
key.shadow.camera.top = SHADOW.extent;
key.shadow.camera.bottom = -SHADOW.extent;
key.shadow.camera.left = -SHADOW.extent;
key.shadow.camera.right = SHADOW.extent;
key.shadow.camera.near = SHADOW.near;
key.shadow.camera.far = SHADOW.far;
key.shadow.radius = 8;
scene.add(key);

// The shadow frustum is centred on the light's target, so the target travels
// with the car or the shadow gets left behind.
key.target = new THREE.Object3D();
scene.add(key.target);

// Fills the camera-facing side, which the key light rakes past.
const fill = new THREE.DirectionalLight(0xffffff, TIER === 'mobile' ? 1.9 : 1.5);
fill.position.set(0, 3, -10);
scene.add(fill);

// Strip softboxes down each flank. These produce the long specular highlight
// along the bodyline. RectAreaLight does not cast shadows.
//
// Two area lights are evaluated per fragment and are by far the most expensive
// lights in the scene, so mobile trades them for a cheap directional rim and a
// slightly stronger fill. The bodyline highlight is softer, but the frame cost
// is a fraction. This must stay ABOVE reveal()'s compileAsync, or the warmed
// shader programs would not match the ones actually used.
if (TIER === 'mobile') {
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(6, 4, -2);
    scene.add(rim);
} else {
    RectAreaLightUniformsLib.init();

    for (const x of [3, -3]) {
        const strip = new THREE.RectAreaLight(0xffffff, 6, 6, 0.5);
        strip.position.set(x, 2.5, 0);
        strip.lookAt(0, 0.75, 0);
        scene.add(strip);
    }
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

// ShadowMaterial is invisible except where a shadow lands on it, so this can
// slide along with the car with no visible texture movement. Sits a hair below
// zero so it doesn't z-fight with the building's plaza slab.
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.ShadowMaterial({ opacity: 0.15 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------------------
// Car
// ---------------------------------------------------------------------------

let car = null;
let carGroundY = 0;              // y offset that sits the car on the floor

const lamps = { bar: [], hazards: [] };
const wheels = [];

new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).load(
    MODEL_PATH,
    (gltf) => {
        car = gltf.scene;

        // Sit the car on y = 0 regardless of where its origin was authored.
        // Stored, because position gets rewritten every frame.
        const box = new THREE.Box3().setFromObject(car);
        carGroundY = -box.min.y;
        car.position.y = carGroundY;

        car.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = true;

            // The lamps share one material instance, so cloning is mandatory —
            // without it, lighting one lights all of them.
            if (BAR.includes(child.name)) {
                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(0xcc0000);
                child.material.emissiveIntensity = 1.5;
                lamps.bar.push(child);
            } else if (HAZARDS.includes(child.name)) {
                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(0xff7700);
                child.material.emissiveIntensity = 0;
                lamps.hazards.push(child);
            }
        });

        scene.add(car);
        car.rotation.y = VIEW.heroHeading;

        // Must run last: reads world-space boxes, so it needs the final
        // position and rotation applied and the car in the scene graph.
        buildWheels();
    },
    trackBytes('car'),
    (err) => console.error('Model failed to load:', err)
);

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------

// The model has no wheel nodes — every mesh is named Object_NNN and the wheel
// parts are scattered across four corners. Group them by the sign of their
// local x and z, pivoting each group at its own centre so it rolls about the
// axle rather than the car's origin.
function buildWheels() {
    car.updateMatrixWorld(true);

    const SPIN_MATS = ['Wheel1A', 'Wheel2A', 'Wheel_metal', 'Wheel_Plastic', 'disc_'];
    const buckets = new Map();   // 'FL' | 'FR' | 'RL' | 'RR'
    const centre = new THREE.Vector3();

    car.traverse((child) => {
        if (!child.isMesh) return;

        const name = child.material.name;
        if (!SPIN_MATS.some(m => name.includes(m))) return;
        if (name.includes('caliper')) return;   // bolted to the upright, stays put

        new THREE.Box3().setFromObject(child).getCenter(centre);
        const local = car.worldToLocal(centre.clone());
        const corner = (local.z > 0 ? 'F' : 'R') + (local.x < 0 ? 'L' : 'R');

        if (!buckets.has(corner)) {
            buckets.set(corner, { parts: [], sum: new THREE.Vector3(), n: 0 });
        }
        const b = buckets.get(corner);
        b.parts.push(child);
        b.sum.add(local);
        b.n++;
    });

    for (const [corner, b] of buckets) {
        const group = new THREE.Group();
        group.position.copy(b.sum.divideScalar(b.n));
        car.add(group);

        // attach() re-parents while preserving world transform.
        b.parts.forEach(p => group.attach(p));

        const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
        group.userData.radius = size.y / 2;
        group.userData.corner = corner;

        wheels.push(group);
        console.log(corner, b.parts.length, 'parts, r =', group.userData.radius.toFixed(3));
    }
}

// ---------------------------------------------------------------------------
// Low Poly Princeton Building
// ---------------------------------------------------------------------------
const gltfLoaderPrinceton = new GLTFLoader();

function loadBuilding(path, { x = 0, z = 0, rotY = 0, scale = 0.1 } = {}) {
    gltfLoaderPrinceton.load(
        PRINCETON_BUILDING_PATH,
        (gltf) => {
            const model = gltf.scene;

            model.scale.setScalar(scale);
            model.rotation.y = rotY;
            model.position.set(x, 0, z);

            // Sit it on the ground regardless of where its origin was authored.
            model.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(model);
            model.position.y -= box.min.y;

            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;
            });

            scene.add(model);
            console.log(path, 'size:',
                box.getSize(new THREE.Vector3()).toArray().map(n => n.toFixed(1)));
        },
        undefined,
        (err) => console.error(`${path} failed to load:`, err)
    );
}

// loadBuilding('models/nassau_hall.glb', { x: -12, z: 40, rotY: Math.PI / 2 });

// ---------------------------------------------------------------------------
// "NUImpact" 3D sign (finale)
// ---------------------------------------------------------------------------

// Anchored to the car's final target position. The car settles at STATIONS[3]
// on the angled track, so its resting x is derived the same way carX is.
const FINALE_CAR_X = TRACK_END * TRACK_LATERAL;
const FINALE_CAR_Z = TRACK_END;

// Both props are built inside async loader callbacks, so without module-level
// handles a profile swap physically could not move them.
let signMesh = null;
let cardGroup = null;

function applyFinaleProps(view) {
    if (signMesh) {
        signMesh.position.set(
            FINALE_CAR_X + view.signOffset.x,
            view.signOffset.y,
            FINALE_CAR_Z + view.signOffset.z);
        signMesh.castShadow = view.signShadow;
    }
    if (cardGroup) cardGroup.visible = view.cardMode !== 'off';
}

new FontLoader(manager).load(
    '/fonts/Switzer_Black.json',
    (font) => {
        const geo = new TextGeometry('NUImpact', {
            font,
            size: 1,
            depth: 0.6,
            curveSegments: 8,
            bevelEnabled: true,
            bevelThickness: 0.08,
            bevelSize: 0.05,
            bevelSegments: 2,
        });
        // Centre horizontally (x) and in depth (z) only. Leave y untouched:
        // TextGeometry's baseline is already at y = 0, so at position y = 0 the
        // letters sit on the ground and the 'p' descender hangs just below it.
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        geo.translate(
            -(bb.max.x + bb.min.x) / 2,
            0,
            -(bb.max.z + bb.min.z) / 2
        );

        const mat = new THREE.MeshStandardMaterial({
            color: 0xd0021b,        // --taillight
            // Faded in on approach by the render loop. Lifting the sign for
            // portrait put it above the horizon, where it was legible as a
            // pink smudge behind the nav from two stations away.
            transparent: true,
            opacity: 0,
            // metalness: 0.1,
            // roughness: 0.5,
        });

        const sign = new THREE.Mesh(geo, mat);

        // Face the finale camera, aligned to the car's heading like the card.
        // Placement comes from the view profile: desktop sets it beside the
        // car, portrait puts it on the view axis beyond the car and lifted.
        sign.rotation.y = Math.PI + DRIVE_HEADING;
        signMesh = sign;
        applyFinaleProps(VIEW);

        scene.add(sign);
    },
    trackBytes('font'),
    (err) => console.error('Font failed to load:', err)
);

// ---------------------------------------------------------------------------
// NUImpact info card (finale)
// ---------------------------------------------------------------------------

// A flat, camera-facing panel drawn on a canvas — the title and blurb are baked
// into a texture rather than built as geometry, which is cheap and crisp.
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = word;
            y += lineHeight;
        } else {
            line = test;
        }
    }
    ctx.fillText(line, x, y);
}

function makeInfoCard(title, body) {
    const W = 1024, H = 586;             // matches the 7 : 4 ground-plane ratio
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const pad = 28;

    // paper panel with a hairline border
    ctx.fillStyle = '#FCFBF8';
    ctx.strokeStyle = 'rgba(43,41,38,0.12)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, 40);
    ctx.fill();
    ctx.stroke();

    // red accent bar (the one place red appears, matching the site)
    ctx.fillStyle = '#D0021B';
    ctx.beginPath();
    ctx.roundRect(pad + 56, pad + 60, 96, 12, 6);
    ctx.fill();

    // title
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#2B2926';
    ctx.font = '700 72px Switzer, sans-serif';
    ctx.fillText(title, pad + 54, pad + 108);

    // body, wrapped
    ctx.fillStyle = '#5b564e';
    ctx.font = '400 42px Switzer, sans-serif';
    wrapText(ctx, body, pad + 56, pad + 226, W - (pad + 56) * 2, 56);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const card = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 4),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    );
    // Lay the panel flat on the ground, texture facing up.
    card.rotation.x = -Math.PI / 2;

    // A parent group handles the in-plane orientation: spinning about Y keeps the
    // panel flat while turning the text to read right-side up from the finale
    // camera (+Math.PI flips the near/far edge) and aligning it to the car's heading.
    cardGroup = new THREE.Group();
    cardGroup.add(card);
    cardGroup.rotation.y = Math.PI + DRIVE_HEADING;
    // Sit just in front of the NUImpact text — toward the camera along −FORWARD —
    // a hair above the ground plane to avoid z-fighting.
    cardGroup.position.set(
        FINALE_CAR_X + 5 - FORWARD.x * 4,
        0.02,
        FINALE_CAR_Z - FORWARD.z * 4 + 5
    );
    scene.add(cardGroup);
}

// Guarded at TIER level so the 1024x586 canvas and its texture upload never
// happen on a phone. The copy lives in #whatsnext as HTML there instead.
if (TIER !== 'mobile') {
    makeInfoCard(
        'Rotational Associate',
        "Northeastern's student-run impact investing VC fund with $600k AUM"
    );
}

// ---------------------------------------------------------------------------
// Console helpers
// ---------------------------------------------------------------------------

// Framing calibration. The portrait numbers are solved against the model's
// measured bounding box, but the last few percent is a judgement call that
// needs to be made on a real device — and edit-reload per pass is unworkable.
//     setView({ finaleAimY: 1.6 })
//     setView({ signOffset: [-1.05, 1.1, 5.82] })
//
// Vectors are taken as plain arrays on purpose: exposing THREE on window would
// defeat tree-shaking and pull the whole library into the bundle (+136 kB).
window.view = () => VIEW;
window.setView = (patch) => {
    for (const [k, v] of Object.entries(patch)) {
        VIEW[k] = Array.isArray(v) ? new THREE.Vector3(...v) : v;
    }
    applyViewport(true);
};
// Screen-space extent of an object, as fractions from the top of the frame.
window.screenBox = (obj) => {
    if (!obj) return null;
    const box = new THREE.Box3().setFromObject(obj);
    const v = new THREE.Vector3();
    let top = Infinity, bot = -Infinity, left = Infinity, right = -Infinity;
    for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z).project(camera);
        top = Math.min(top, (1 - v.y) / 2); bot = Math.max(bot, (1 - v.y) / 2);
        left = Math.min(left, v.x); right = Math.max(right, v.x);
    }
    return { top, bot, left, right };
};
window.parts = () => ({ car, sign: signMesh, card: cardGroup });

// with the building loaded


// Falls back to 1.5 rather than 0 so the running light stays lit underneath,
// as on the real car.
window.setBrakes = (on) => {
    lamps.bar.forEach(m => m.material.emissiveIntensity = on ? 5 : 1.5);
};

// Flash any mesh to identify it: flash('Object_524')
window.flash = (name, color = 0x00ff00) => {
    if (!car) return console.warn('model not loaded yet');
    const m = car.getObjectByName(name);
    if (!m) return console.warn('no mesh named', name);
    m.material = m.material.clone();
    m.material.emissive.set(color);
    m.material.emissiveIntensity = 8;
};

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

let lastW = -1, lastH = -1, lastDpr = -1;
let viewKey = viewKeyOf(window.innerWidth, window.innerHeight);
let resizeTimer = 0;

// Cached because the loop used to read document.body.scrollHeight EVERY FRAME:
// a layout-dependent read inside the render loop.
let scrollable = 0;

function refreshScrollable() {
    scrollable = Math.max(
        document.documentElement.scrollHeight - window.innerHeight, 0);
}

// The CSS owns where the car sits on screen; this reads it back. Unitless
// fractions, so parseFloat gets a clean number. getComputedStyle is called once
// and the returned declaration is live, so this is a property read rather than
// a restyle — cheap at resize cadence, not cheap per frame.
const _rootStyle = getComputedStyle(document.documentElement);
let bandTop = 0, bandBot = 1;

function readBand() {
    bandTop = parseFloat(_rootStyle.getPropertyValue('--band-top')) || 0;
    const bot = parseFloat(_rootStyle.getPropertyValue('--band-bot'));
    bandBot = Number.isFinite(bot) ? bot : 1;
}

function applyViewport(force = false) {
    const w = window.innerWidth, h = window.innerHeight;
    if (!force && w === lastW && h === lastH) return;   // iOS fires no-op resizes
    lastW = w; lastH = h;

    // Rebuilt only when the CLASSIFICATION flips. A URL-bar collapse keeps both
    // (h >= w) and (w <= 820) true, so it never swaps the profile.
    const key = viewKeyOf(w, h);
    if (key !== viewKey || force) {
        viewKey = key;
        VIEW = pickView(w, h);
        applyFinaleProps(VIEW);
    }

    // Gated: setPixelRatio reallocates the drawing buffer.
    const dpr = dprFor();
    if (dpr !== lastDpr) { lastDpr = dpr; renderer.setPixelRatio(dpr); }

    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = resolveFov(VIEW.fov, camera.aspect);
    camera.updateProjectionMatrix();

    readBand();
    refreshScrollable();
    checkBand();
}

// The portrait camera offsets were SOLVED against this band, by projecting the
// model's measured bounding box at every station. Retuning --band-top/--band-bot
// in CSS therefore invalidates them: re-run the solver rather than nudging the
// offsets by eye, or the car will drift out of the gap the layout leaves it.
const SOLVED_BAND = [0.27, 0.72];
let bandWarned = false;

function checkBand() {
    if (bandWarned || VIEW.id !== 'portrait') return;
    if (Math.abs(bandTop - SOLVED_BAND[0]) < 1e-3 &&
        Math.abs(bandBot - SOLVED_BAND[1]) < 1e-3) return;
    bandWarned = true;
    console.warn(
        `[camera] CSS band is ${bandTop}..${bandBot} but the portrait camera ` +
        `offsets were solved for ${SOLVED_BAND[0]}..${SOLVED_BAND[1]}. ` +
        `The car may not sit in the gap the layout leaves for it.`);
}

// Debounced for renderer.setSize, which reallocates the colour and MSAA
// buffers; iOS fires resize repeatedly DURING the bar's collapse animation,
// which undebounced is one reallocation per frame. The canvas is CSS-stretched
// for <=120ms meanwhile, which the horizontal-fov scheme makes imperceptible:
// horizontal pixels-per-radian is width/hFov, and both are unchanged by the
// bar moving, so the car's on-screen size does not shift at all.
const scheduleApply = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => applyViewport(), 120);
};

window.addEventListener('resize', scheduleApply);

// iOS reports stale innerWidth/innerHeight immediately after a rotation.
window.addEventListener('orientationchange', () => {
    scheduleApply();
    setTimeout(() => applyViewport(true), 350);
});

// Page height can change with no window resize at all: an image finally laying
// out, a modal opening. Only `scrollable` cares.
const overlayEl = document.querySelector('.overlay');
if (overlayEl && 'ResizeObserver' in window) {
    new ResizeObserver(refreshScrollable).observe(overlayEl);
}

applyViewport(true);

// deliberately NOT visualViewport: the canvas is position:fixed, so it is laid
// out against the LAYOUT viewport, which innerWidth/innerHeight track.
// visualViewport shrinks under pinch-zoom and when a soft keyboard opens, so
// the car would zoom when the contact modal's mailto link is focused.

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let carZ = 0;
let prevZ = 0;
let parkStart = 0;               // time the car last settled at a station
let wasParked = false;
let prevTime = 0;

const _pos = new THREE.Vector3();   // scratch vectors, reused each frame
const _tgt = new THREE.Vector3();
const _off = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _fpos = new THREE.Vector3();  // finale camera pose
const _ftgt = new THREE.Vector3();



function animate(time) {
    // --- timing ---
    // Clamped so a backgrounded tab doesn't produce one enormous frame.
    const dt = prevTime ? Math.min((time - prevTime) / 1000, 0.1) : 0;
    prevTime = time;

    // --- scroll drives position along the track ---
    const target = scrollable > 0
        ? THREE.MathUtils.clamp(window.scrollY / scrollable, 0, 1) * TRACK_END
        : 0;

    // Exponential rather than a fixed per-frame fraction, so the choreography
    // feels the same at 60Hz, at 120Hz, and when the GPU is throttled. At
    // dt = 0 the factor is 0, matching the existing first-frame guard.
    if (snapNext) {
        carZ = target;
        prevZ = target;
        snapNext = false;
    } else {
        carZ += (target - carZ) * (1 - Math.exp(-dt / SCROLL_TAU));
    }
    // reveal each station's overlay as the car passes near it
    stationEls.forEach((el, i) => {
        if (!el) return;
        el.classList.toggle('visible', Math.abs(carZ - STATIONS[i]) < REVEAL_RANGE);
    });

    const delta = carZ - prevZ;                     // change in z
    prevZ = carZ;

    const carX = carZ * TRACK_LATERAL;

    // --- wheels roll by distance travelled, capped ---
    // Distance is longer than the z delta on a diagonal, hence TRACK_LEN.
    // The cap keeps apparent speed sane and stays below the rate at which
    // spokes alias between frames and appear to rotate backwards.
    const travelled = delta * TRACK_LEN;
    const maxThisFrame = MAX_WHEEL_SPEED * dt;
    const spin = THREE.MathUtils.clamp(travelled, -maxThisFrame, maxThisFrame);
    wheels.forEach(w => w.rotation.x += spin / w.userData.radius);

    // --- blend factors ---
    // blend:  hero pose → chase, over the first BLEND_DIST units.
    // arrive: side view → directly behind, as the car nears the building.
    const blend = THREE.MathUtils.smoothstep(carZ, 0, BLEND_DIST);
    const arrive = THREE.MathUtils.smoothstep(carZ, ARRIVE_START, ARRIVE_END);
    // finale: swing from rear-chase to the centred showcase view at station 3.
    const finale = THREE.MathUtils.smoothstep(carZ, FINALE_START, FINALE_END);

    // The sign is meant to be REVEALED at the finale, so it fades in slightly
    // ahead of the camera move rather than sitting on the horizon throughout.
    if (signMesh) {
        signMesh.material.opacity = THREE.MathUtils.smoothstep(carZ, 78, 102);
        signMesh.visible = signMesh.material.opacity > 0.002;
    }

    // --- car: straight line along the angled track, nose following it ---
    if (car) {
        car.position.set(carX, carGroundY, carZ);
        car.rotation.y = THREE.MathUtils.lerp(VIEW.heroHeading, DRIVE_HEADING, blend);
    }

    // --- world follows the car ---
    ground.position.set(carX, -0.01, carZ);

    key.position.set(carX + 5, 10, carZ + 7.5);
    key.target.position.set(carX, 0, carZ);
    key.target.updateMatrixWorld();
    
    // --- camera ---
    // Offsets are relative to the car, so the framing distance stays constant
    // however far the car drifts laterally.
    _off.lerpVectors(VIEW.sideOff, VIEW.rearOff, arrive);
    _aim.lerpVectors(VIEW.sideAim, VIEW.rearAim, arrive);

    // _off.y is honoured now; it used to be computed and then discarded in
    // favour of a literal 5, and the -2 on z is folded into the constants.
    _pos.set(carX + _off.x, _off.y, carZ + _off.z);
    _pos.lerpVectors(VIEW.heroPos, _pos, blend);

    _tgt.set(carX + _aim.x, _aim.y, carZ + _aim.z);
    _tgt.lerpVectors(VIEW.heroTgt, _tgt, blend);

    // finale: swing to a square-on view of the car's back. Positioning the
    // camera along the car's heading (rather than the world z axis) keeps the
    // rear dead-centre, so neither flank is visible.
    _fpos.set(carX - FORWARD.x * VIEW.finaleDist, VIEW.finaleHeight,
        carZ - FORWARD.z * VIEW.finaleDist);
    _ftgt.set(carX, VIEW.finaleAimY, carZ);
    _pos.lerp(_fpos, finale);
    _tgt.lerp(_ftgt, finale);

    camera.position.copy(_pos);
    camera.lookAt(_tgt);

    // --- intro ---
    // Runs once, as the loading overlay dissolves. Applied on top of the pose
    // above rather than before it, because the scroll camera and the car's
    // heading are both rewritten every frame. Weighting by (1 - blend) lets
    // the intro bow out if the visitor scrolls before it finishes, instead of
    // fighting the chase cam for the same properties.
    if (introStart !== null) {
        const it = Math.min((time - introStart) / INTRO_MS, 1);
        const ease = 1 - Math.pow(1 - it, 3);
        const w = (1 - ease) * (1 - blend);

        if (car) car.rotation.y += w * VIEW.introYaw;

        camera.position.y += w * VIEW.introLift;
        camera.translateZ(w * VIEW.introDolly);   // local +z is behind the camera
        camera.lookAt(_tgt);

        // Only the bar lamps. The hazards are driven below, every frame.
        const barLit = 1.5 * THREE.MathUtils.smoothstep(ease, 0.35, 0.7);
        lamps.bar.forEach(m => { m.material.emissiveIntensity = barLit; });

        if (it === 1) introStart = null;
    }

    // --- hazards ---
    // Blink whenever the car is genuinely settled, wherever it stopped.
    // Compared as a speed, not a per-frame delta: now that the damping is
    // dt-correct the per-frame delta halves at 120Hz, which would trip the
    // blink while the car was still moving at twice the intended speed.
    const speed = dt > 0 ? delta / dt : 0;
    const isParked = Math.abs(speed) < STOP_SPEED;
    // Restart the blink phase on arrival so the first flash lands as it settles.
    if (isParked && !wasParked) parkStart = time;
    wasParked = isParked;

    const lit = isParked && Math.floor((time - parkStart) / HAZARD_PERIOD) % 2 === 0;
    lamps.hazards.forEach(m => m.material.emissiveIntensity = lit ? 5 : 0);

    renderer.render(scene, camera);
}

let running = false;
let snapNext = false;

function startLoop() {
    if (running) return;
    running = true;
    prevTime = 0;        // first frame back gets dt = 0, not a 0.1s jump
    snapNext = true;     // iOS restores scrollY; without this the car visibly
                         // drives to the restored position over ~300ms

    // introStart is a performance.now() stamp and animate() receives the rAF
    // timestamp — the same clock, but a pause leaves the stamp stale, so on
    // resume the intro evaluates as complete and the light bar's emissive ramp
    // is stranded wherever it had reached. Finish it explicitly.
    if (introStart !== null) {
        introStart = null;
        lamps.bar.forEach(m => { m.material.emissiveIntensity = 1.5; });
    }

    renderer.setAnimationLoop(animate);
}

function stopLoop() {
    if (!running) return;
    running = false;
    renderer.setAnimationLoop(null);
}

document.addEventListener('visibilitychange',
    () => document.hidden ? stopLoop() : startLoop());

startLoop();