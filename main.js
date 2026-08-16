import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// ---------------------------------------------------------------------------
// Navbar
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_PATH = 'models/o_model.glb';
const HDRI_PATH = 'models/ferndale_studio_01_4k.hdr';
const clickable = [];

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
scene.background = new THREE.Color(0xFCFBF8);


const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(2.5, 6, -10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(2.5, 0.75, 0);
controls.enableDamping = true;
controls.update();
controls.enabled = true;

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

        car.rotation.y = -Math.PI / 10;
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
    // 3d text
    const textGeo = new TextGeometry("Hi! I'm Aarish Kodnaney", {

        font: font,

        size: 0.4,
        depth: 0.1,
        curveSegments: 12,

        bevelThickness: 0.01,
        bevelSize: 0.008,
        bevelEnabled: true

    });

    // 3d text
    textGeo.computeBoundingBox();
    const centerOffset = - 0.5 * (textGeo.boundingBox.max.x - textGeo.boundingBox.min.x);

    const textMaterial = new THREE.MeshPhongMaterial({
        color: 0x999999, specular: 0x2B2926, color: 0x918B80,
        roughness: 0.35,
        metalness: 0
    });

    const mesh = new THREE.Mesh(textGeo, textMaterial);
    mesh.position.x = 8;
    mesh.position.y = 0;
    mesh.position.z = 1;
    mesh.rotation.z = Math.PI;
    mesh.rotation.x = Math.PI;
    // mesh.rotation.y = -Math.PI / 100;

    mesh.castShadow = true;
    mesh.receiveShadow = true;


    // social media buttons
    function makeFloorButton(label, url, x, z) {
        const dpr = 4;                       // supersample; it's viewed at an angle
        const w = 256, h = 88;

        const canvas = document.createElement('canvas');
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // after the first canvas, before creating the meshes
        const outlineCanvas = document.createElement('canvas');
        outlineCanvas.width = w * dpr;
        outlineCanvas.height = h * dpr;
        const octx = outlineCanvas.getContext('2d');
        octx.scale(dpr, dpr);
        octx.rect(2, 2, w - 4, h - 4);
        octx.lineWidth = 2;
        octx.strokeStyle = '#333333';
        octx.stroke();

        const outlineTex = new THREE.CanvasTexture(outlineCanvas);
        outlineTex.colorSpace = THREE.SRGBColorSpace;
        outlineTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

        // pill
        ctx.beginPath();
        ctx.rect(2, 2, w - 4, h - 4);        // was roundRect
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FCFBF8';
        ctx.stroke();                         // no fill() — transparent interior

        // label
        ctx.fillStyle = '#2B2926';
        ctx.font = '600 30px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2 + 1);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const scale = 0.008;                 // px → world units
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w * scale, h * scale),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true })
        );

        mesh.position.set(x, 0.02, z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = Math.PI;
        // mesh.rotation.y = Math.PI / 100;
        mesh.userData.url = url;
        mesh.userData.canvasRedraw = (hovered) => { /* see below */ };

        scene.add(mesh);

        const outline = new THREE.Mesh(
            new THREE.PlaneGeometry(w * scale, h * scale),
            new THREE.MeshBasicMaterial({ map: outlineTex, transparent: true, opacity: 0 })
        );
        outline.rotation.copy(mesh.rotation);
        outline.position.set(x, 0.02, z);
        scene.add(outline);

        mesh.userData.outline = outline;
        mesh.userData.baseY = 0.02;

        clickable.push(mesh);
        return mesh;
    }

    makeFloorButton('GitHub', 'https://github.com/...', 7, 0);
    makeFloorButton('LinkedIn', 'https://linkedin.com/in/...', 4.5, 0);

    scene.add(mesh);

});

// ---------------------------------------------------------------------------
// Social Media Button Interaction
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

renderer.domElement.addEventListener('pointermove', (e) => {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(clickable)[0];

    clickable.forEach(m => m.material.color.set(0x999999));
    if (hit) hit.object.material.color.set(0x333333);
    renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
});

renderer.domElement.addEventListener('click', (e) => {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(clickable)[0];
    if (hit) window.open(hit.object.userData.url, '_blank', 'noopener');
});
let hoveredButton = null;

renderer.domElement.addEventListener('pointermove', (e) => {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(clickable)[0];
    hoveredButton = hit ? hit.object : null;
    renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
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

function makeAFrame(imgPath, x, z) {
    const W = 1.1;
    const H = 1.5;
    const D = 0.05;
    const SPLAY = 0.22;                  // radians each panel leans

    const group = new THREE.Group();

    const frameMat = new THREE.MeshStandardMaterial({
        color: 0x3a352e, roughness: 0.85, metalness: 0
    });

    const tex = new THREE.TextureLoader().load(imgPath);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });

    function panel(faceForward) {
        const p = new THREE.Group();

        // outer frame — four rails around the opening
        const railW = 0.09;
        const mk = (w, h, px, py) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, D), frameMat);
            m.position.set(px, py, 0);
            m.castShadow = true;
            return m;
        };
        p.add(mk(W, railW, 0, H / 2 - railW / 2));
        p.add(mk(W, railW, 0, -H / 2 + railW / 2));
        p.add(mk(railW, H, -W / 2 + railW / 2, 0));
        p.add(mk(railW, H, W / 2 - railW / 2, 0));

        // the photo, inset slightly so the frame sits proud of it
        const inner = new THREE.Mesh(
            new THREE.PlaneGeometry(W - railW * 2, H - railW * 2),
            faceForward ? faceMat : frameMat
        );
        inner.position.z = D / 2 - 0.008;
        p.add(inner);

        return p;
    }

    const front = panel(true);
    front.position.set(0, H / 2, 0);
    front.rotation.x = -SPLAY;
    group.add(front);

    const back = panel(false);
    back.position.set(0, H / 2, 0);
    back.rotation.x = SPLAY;
    back.rotation.y = Math.PI;
    group.add(back);

    group.position.set(x, 0, z);
    group.rotation.y = Math.PI;
    scene.add(group);
    return group;
}

makeAFrame('images/IMG_4883.jpeg', 3, 2);

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
    // in animate()
    clickable.forEach(m => {
        const o = m.userData.outline;
        const target = m === hoveredButton ? 0.1 : 0;

        o.position.y += (m.userData.baseY + target - o.position.y) * 0.15;

        const targetOpacity = m === hoveredButton ? 1 : 0;
        o.material.opacity += (targetOpacity - o.material.opacity) * 0.15;
    });
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);