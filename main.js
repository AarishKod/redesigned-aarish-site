import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_PATH = 'models/o_model.glb';
const HDRI_PATH = 'models/ferndale_studio_01_4k.hdr';

// Track layout. Scroll progress maps onto 0 → TRACK_END in world units.
const STATIONS = [0, 40, 80];
const TRACK_END = STATIONS[STATIONS.length - 1];

// Camera framing at rest, before the chase cam takes over.
const HERO_POS = new THREE.Vector3(2.5, 6, -10);
const HERO_TGT = new THREE.Vector3(2.5, 0.75, 0);
const BLEND_DIST = 8;            // world units over which the handoff happens

// The car travels along +z, so any non-zero heading makes it crab sideways.
// Set to something like -Math.PI / 10 if you prefer the angled hero pose and
// don't mind the drift once it's moving.
const CAR_HEADING = -Math.PI / 10;

const SCROLL_DAMPING = 0.06;     // lower = heavier, more trailing
const MAX_WHEEL_SPEED = 4.5;     // world units/sec — caps apparent wheel speed
const HAZARD_PERIOD = 500;       // ms per on/off phase (~1 Hz)

// Lamp meshes, identified by name. Every exterior lamp shares one material,
// so these had to be found geometrically rather than by material name:
//   Object_524 — the light bar
//   Object_544 — the lamps flanking the bar, left and right in one mesh
//   Object_510 / 512 — front indicators
const BAR = ['Object_524'];
const HAZARDS = ['Object_544', 'Object_510', 'Object_512'];

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
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(5, 10, 7.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.top = 5;
key.shadow.camera.bottom = -5;
key.shadow.camera.left = -5;
key.shadow.camera.right = 5;
key.shadow.radius = 8;
scene.add(key);

// The shadow frustum is only ±5 around the light's target, so the target has
// to travel with the car or the shadow gets left behind.
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
// slide along with the car with no visible texture movement.
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.ShadowMaterial({ opacity: 0.15 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

let car = null;

const lamps = { bar: [], hazards: [] };
const wheels = [];

new GLTFLoader().load(
    MODEL_PATH,
    (gltf) => {
        car = gltf.scene;

        // Sit the car on y = 0 regardless of where its origin was authored.
        const box = new THREE.Box3().setFromObject(car);
        car.position.y -= box.min.y;

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
        car.rotation.y = CAR_HEADING;

        // Must run last: reads world-space boxes, so it needs the final
        // position and rotation applied and the car in the scene graph.
        buildWheels();
    },
    (xhr) => {
        if (xhr.total) {
            console.log(`${((xhr.loaded / xhr.total) * 100).toFixed(0)}% loaded`);
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
// Console helpers
// ---------------------------------------------------------------------------

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
let prevTime = 0;

const _pos = new THREE.Vector3();   // scratch vectors, reused each frame
const _tgt = new THREE.Vector3();

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

    const delta = carZ - prevZ;
    prevZ = carZ;

    // --- wheels roll by distance travelled, capped ---
    // The cap keeps apparent speed sane and stays below the rate at which
    // spokes alias between frames and appear to rotate backwards.
    const maxThisFrame = MAX_WHEEL_SPEED * dt;
    const spin = THREE.MathUtils.clamp(delta, -maxThisFrame, maxThisFrame);
    wheels.forEach(w => w.rotation.x += spin / w.userData.radius);

    // --- car ---
    if (car) car.position.z = carZ;

    // --- world follows the car ---
    ground.position.z = carZ;

    key.position.set(5, 10, carZ + 7.5);
    key.target.position.set(0, 0, carZ);
    key.target.updateMatrixWorld();

    // --- camera: hero framing, blending into chase ---
    const blend = THREE.MathUtils.smoothstep(carZ, 0, BLEND_DIST);

    _pos.set(8, 3, carZ - 10);
    camera.position.lerpVectors(HERO_POS, _pos, blend);

    _tgt.set(-7, 0.75, carZ);
    camera.lookAt(_tgt.lerpVectors(HERO_TGT, _tgt, blend));

    // --- hazards ---
    const lit = Math.floor(time / HAZARD_PERIOD) % 2 === 0;
    lamps.hazards.forEach(m => m.material.emissiveIntensity = lit ? 5 : 0);

    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);