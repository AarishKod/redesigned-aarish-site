import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_PATH = 'models/o_model.glb';
const HDRI_PATH = 'models/ferndale_studio_01_4k.hdr';
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

// --- camera ----------------------------------------------------------------
// Absolute framing at rest, before the chase cam takes over.
const HERO_POS = new THREE.Vector3(2.5, 6, -10);
const HERO_TGT = new THREE.Vector3(2.5, 0.75, 0);
const BLEND_DIST = 8;            // world units over which the hero handoff happens

// Chase offsets, expressed RELATIVE TO THE CAR. Keeping them relative is what
// holds the framing distance constant — absolute x would let the gap grow as
// the car drifts laterally.
const CAM_SIDE_OFF = new THREE.Vector3(8, 3, -10);
const CAM_SIDE_AIM = new THREE.Vector3(-7, 0.75, 0);

const CAM_REAR_OFF = new THREE.Vector3(0, 2.2, -9);
const CAM_REAR_AIM = new THREE.Vector3(-3, 0.75, 0);

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
const FINALE_DIST = 14;          // how far behind the car the camera sits
const FINALE_HEIGHT = 7;         // camera elevation at the finale
const FINALE_AIM_Y = 0.9;        // look at the car's mid-height, so it's centred

const SCROLL_DAMPING = 0.06;     // lower = heavier, more trailing
const MAX_WHEEL_SPEED = 4.5;     // world units/sec — caps apparent wheel speed
const HAZARD_PERIOD = 500;       // ms per on/off phase (~1 Hz)
const STOP_THRESHOLD = 0.02;     // |z change/frame| below this counts as stopped

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
const REVEAL_RANGE = 12;          // units before/after the station


// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, 3));
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
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.copy(HERO_POS);
camera.lookAt(HERO_TGT);

// No OrbitControls. The camera is fully derived from scroll position, and
// orbit controls keep a wheel listener attached even when disabled — which
// swallows scroll events over the canvas.

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

new RGBELoader().load(
    HDRI_PATH,
    (hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = hdr;
        // Background stays flat Paper — only reflections come from the HDRI.
    },
    undefined,
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
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.top = 40;
key.shadow.camera.bottom = -40;
key.shadow.camera.left = -40;
key.shadow.camera.right = 40;
key.shadow.radius = 8;
scene.add(key);

// The shadow frustum is centred on the light's target, so the target travels
// with the car or the shadow gets left behind.
key.target = new THREE.Object3D();
scene.add(key.target);

// Fills the camera-facing side, which the key light rakes past.
const fill = new THREE.DirectionalLight(0xffffff, 1.5);
fill.position.set(0, 3, -10);
scene.add(fill);

// Strip softboxes down each flank. These produce the long specular highlight
// along the bodyline. RectAreaLight does not cast shadows.
RectAreaLightUniformsLib.init();

for (const x of [3, -3]) {
    const strip = new THREE.RectAreaLight(0xffffff, 6, 6, 0.5);
    strip.position.set(x, 2.5, 0);
    strip.lookAt(0, 0.75, 0);
    scene.add(strip);
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

new GLTFLoader().load(
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
        car.rotation.y = HERO_HEADING;

        // Must run last: reads world-space boxes, so it needs the final
        // position and rotation applied and the car in the scene graph.
        buildWheels();
    },
    (xhr) => {
        if (xhr.total) {
            console.log(`car ${((xhr.loaded / xhr.total) * 100).toFixed(0)}% loaded`);
        }
    },
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

new FontLoader().load(
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
            // metalness: 0.1,
            // roughness: 0.5,
        });

        const sign = new THREE.Mesh(geo, mat);
        sign.castShadow = true;

        // Face the finale camera (aligned to the car's heading, like the card),
        // stand upright on the ground, offset to the car's left.
        sign.rotation.y = Math.PI + DRIVE_HEADING;
        sign.position.set(FINALE_CAR_X + 5, 0, FINALE_CAR_Z + 5);

        scene.add(sign);
    },
    undefined,
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
    const cardGroup = new THREE.Group();
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

makeInfoCard(
    'Rotational Associate',
    "Northeastern's student-run impact investing VC fund with $600k AUM"
);

// ---------------------------------------------------------------------------
// Console helpers
// ---------------------------------------------------------------------------

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

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

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
    const scrollable = document.body.scrollHeight - window.innerHeight;
    const target = scrollable > 0
        ? THREE.MathUtils.clamp(window.scrollY / scrollable, 0, 1) * TRACK_END
        : 0;

    carZ += (target - carZ) * SCROLL_DAMPING;
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

    // --- car: straight line along the angled track, nose following it ---
    if (car) {
        car.position.set(carX, carGroundY, carZ);
        car.rotation.y = THREE.MathUtils.lerp(HERO_HEADING, DRIVE_HEADING, blend);
    }

    // --- world follows the car ---
    ground.position.set(carX, -0.01, carZ);

    key.position.set(carX + 5, 10, carZ + 7.5);
    key.target.position.set(carX, 0, carZ);
    key.target.updateMatrixWorld();
    
    // --- camera ---
    // Offsets are relative to the car, so the framing distance stays constant
    // however far the car drifts laterally.
    _off.lerpVectors(CAM_SIDE_OFF, CAM_REAR_OFF, arrive);
    _aim.lerpVectors(CAM_SIDE_AIM, CAM_REAR_AIM, arrive);

    _pos.set(carX + _off.x, 5, carZ + _off.z - 2);
    _pos.lerpVectors(HERO_POS, _pos, blend);

    _tgt.set(carX + _aim.x, _aim.y, carZ + _aim.z);
    _tgt.lerpVectors(HERO_TGT, _tgt, blend);

    // finale: swing to a square-on view of the car's back. Positioning the
    // camera along the car's heading (rather than the world z axis) keeps the
    // rear dead-centre, so neither flank is visible.
    _fpos.set(carX - FORWARD.x * FINALE_DIST, FINALE_HEIGHT, carZ - FORWARD.z * FINALE_DIST);
    _ftgt.set(carX, FINALE_AIM_Y, carZ);
    _pos.lerp(_fpos, finale);
    _tgt.lerp(_ftgt, finale);

    camera.position.copy(_pos);
    camera.lookAt(_tgt);

    // --- hazards ---
    // Blink whenever the car is genuinely settled, wherever it stopped.
    const isParked = Math.abs(delta) < STOP_THRESHOLD;
    // Restart the blink phase on arrival so the first flash lands as it settles.
    if (isParked && !wasParked) parkStart = time;
    wasParked = isParked;

    const lit = isParked && Math.floor((time - parkStart) / HAZARD_PERIOD) % 2 === 0;
    lamps.hazards.forEach(m => m.material.emissiveIntensity = lit ? 5 : 0);

    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);