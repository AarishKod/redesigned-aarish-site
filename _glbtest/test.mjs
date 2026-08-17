import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const S = document.getElementById('status');
const log = (m)=>{ S.textContent += '\n'+m; console.log('[TEST]', m); };
window.addEventListener('error', e=> log('JS ERROR: '+e.message));

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfcfbf8);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(5,10,7.5); key.castShadow = true; scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff,0.3));

const camera = new THREE.PerspectiveCamera(35, innerWidth/innerHeight, 0.1, 2000);

const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
const loader = new GLTFLoader().setDRACOLoader(draco);

loader.load('/models/free_london_skyscraper_optimized.glb', (gltf)=>{
  const root = gltf.scene;
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  let meshes=0, mats=new Set(), tex=0, missingTex=0, noUV=0, tris=0;
  const seenTex=new Set();
  root.traverse(o=>{ if(o.isMesh){ meshes++; o.castShadow=o.receiveShadow=true;
    const g=o.geometry; if(g.index) tris+=g.index.count/3; else tris+=g.attributes.position.count/3;
    if(!g.attributes.uv) noUV++;
    if(!g.attributes.normal) log('WARN no normals: '+o.name);
    const m=o.material; mats.add(m.uuid);
    for(const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap']){
      if(m[k]){ if(!seenTex.has(m[k].uuid)){seenTex.add(m[k].uuid);tex++;} if(!m[k].image) missingTex++; }
    }
  }});
  log('LOADED OK');
  log(`meshes=${meshes} materials=${mats.size} textures=${tex} triangles=${Math.round(tris)}`);
  log(`missingTexImages=${missingTex} meshesWithoutUV=${noUV}`);
  log(`bbox min=(${box.min.x.toFixed(1)},${box.min.y.toFixed(1)},${box.min.z.toFixed(1)}) max=(${box.max.x.toFixed(1)},${box.max.y.toFixed(1)},${box.max.z.toFixed(1)})`);
  log(`size=(${size.x.toFixed(1)},${size.y.toFixed(1)},${size.z.toFixed(1)})`);
  // frame it
  const r = size.length()/2;
  camera.position.set(ctr.x + r*0.9, ctr.y + r*0.2, ctr.z + r*1.1);
  camera.lookAt(ctr);
  renderer.setAnimationLoop(()=>renderer.render(scene,camera));
  window.__done = true;
}, (p)=>{ if(p.total) S.textContent='loading '+Math.round(100*p.loaded/p.total)+'%'; },
   (err)=>{ log('LOAD ERROR: '+(err?.message||err)); window.__done='error'; });
