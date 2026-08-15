import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_PATH = 'models/o_model.glb';
const HDRI_PATH = 'models/ferndale_studio_01_4k.hdr';

// Toggle to light the brake lights (running lights stay on permanently).
let brakesOn = false;

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

document.body.appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// Scene + camera
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(2.5, 3, -10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(2.5, 0.75, 0);
controls.enableDamping = true;
controls.update();
controls.enabled = false;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

new RGBELoader().load(
    HDRI_PATH,
    (hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = hdr;
        // Background stays flat white — only reflections come from the HDRI.
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

// ShadowMaterial is invisible except where a shadow lands on it.
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

const BAR = ['Object_524'];
const HAZARDS = ['Object_544', 'Object_510', 'Object_512'];

const lamps = { bar: [], hazards: [] };

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

            if (BAR.includes(child.name)) {
                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(0xcc0000);
                child.material.emissiveIntensity = 1.5;
                lamps.bar.push(child);
            } else if (HAZARDS.includes(child.name)) {
                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(
                    child.name === 'Object_544' ? 0xff7700 : 0xff7700
                );
                child.material.emissiveIntensity = 0;
                lamps.hazards.push(child);
            }
        });

        scene.add(car);
        car.traverse((child) => {
            if (!child.isMesh || !child.material.name.includes('LightA')) return;
            const b = new THREE.Box3().setFromObject(child);
            const size = b.getSize(new THREE.Vector3());
            const c = b.getCenter(new THREE.Vector3());
            console.log(child.name, `w:${size.x.toFixed(2)} z:${c.z.toFixed(2)} x:${c.x.toFixed(2)}`);
        });

        car.rotation.y = -Math.PI/10;
    },
    (xhr) => {
        if (xhr.total) {
            console.log(`${((xhr.loaded / xhr.total) * 100).toFixed(0)}% loaded`);
        }
    },
    (err) => console.error('Model failed to load:', err)
);



// TEXT

const loader = new FontLoader();
loader.load('fonts/Switzer_Black.json', function (font) {

    const textGeo = new TextGeometry("Hi! I'm Aarish Kodnaney", {

        font: font,

        size: 0.4,
        depth: 0.1,
        curveSegments: 12,

        bevelThickness: 0.01,
        bevelSize: 0.008,
        bevelEnabled: true

    });

    

    textGeo.computeBoundingBox();
    const centerOffset = - 0.5 * (textGeo.boundingBox.max.x - textGeo.boundingBox.min.x);

    const textMaterial = new THREE.MeshPhongMaterial({ color: 0x999999, specular: 0x999999, color: 0x999999,
    roughness: 0.35,
    metalness: 0 });

    const mesh = new THREE.Mesh(textGeo, textMaterial);
    mesh.position.x = 8;
    mesh.position.y = 0;
    mesh.position.z = 2;
    mesh.rotation.z = Math.PI;
    mesh.rotation.x = Math.PI;
    mesh.rotation.y = -Math.PI/100;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    scene.add(mesh);

});

// Call this from a button, keypress, whatever.
function setBrakes(on) {
    brakesOn = on;
    if (!car) return;
    car.traverse((child) => {
        if (child.userData.isBrakeLight) {
            child.material.emissiveIntensity = on ? 4 : 0;
        }
    });
}

window.flash = (name) => {
    const m = car.getObjectByName(name);
    m.material = m.material.clone();
    m.material.emissive.set(0x00ff00);
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

function animate(time) {
    const lit = Math.floor(time / 500) % 2 === 0;
    lamps.hazards.forEach(m => m.material.emissiveIntensity = lit ? 5 : 0);
    controls.update();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);