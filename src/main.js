import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Constants (meters / seconds). z: along the court, x: across, y: up.
// Attacker lives at z < 0, the runner (defender) at z > 0.
// ---------------------------------------------------------------------------
const G = 9.8;
const BALL_R = 0.033;
const NET_H = 0.914;
const HALF_L = 11.885;
const HALF_W = 4.115;   // singles
const DHALF_W = 5.485;  // doubles
const SERVICE_Z = 6.4;
const SAMPLE_DT = 1 / 240;
const DEF_VMAX = 8.2;   // runner top speed
const PERSON = 0.85;    // player scale (1.8 m model -> ~1.53 m) so the court reads bigger
const SPEED = Number(new URLSearchParams(location.search).get('speed')) || 1; // debug fast-forward

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const signOr = v => (v > 0.3 ? 1 : v < -0.3 ? -1 : Math.random() < 0.5 ? -1 : 1);
const smooth = t => t * t * (3 - 2 * t);
const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b18);
scene.fog = new THREE.Fog(0x070b18, 45, 110);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);

scene.add(new THREE.HemisphereLight(0x9fb0ff, 0x1a2a22, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(9, 22, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 24, bottom: -24, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

function buildCourt() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 140), mat(0x173a2f));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(2 * DHALF_W + 8, 2 * HALF_L + 14), mat(0x2b6450));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.002;
  apron.receiveShadow = true;
  scene.add(apron);

  const court = new THREE.Mesh(new THREE.PlaneGeometry(2 * DHALF_W, 2 * HALF_L), mat(0x2a5d9b));
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.004;
  court.receiveShadow = true;
  scene.add(court);

  const lineMat = mat(0xf2f2f2, { roughness: 0.5 });
  const line = (x1, z1, x2, z2, w = 0.05) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 === x2 ? w : len, x1 === x2 ? len : w), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, 0.006, (z1 + z2) / 2);
    m.receiveShadow = true;
    scene.add(m);
  };
  for (const s of [-1, 1]) {
    line(s * DHALF_W, -HALF_L, s * DHALF_W, HALF_L);
    line(s * HALF_W, -HALF_L, s * HALF_W, HALF_L);
    line(-DHALF_W, s * HALF_L, DHALF_W, s * HALF_L, 0.1);
    line(-HALF_W, s * SERVICE_Z, HALF_W, s * SERVICE_Z);
    line(0, s * HALF_L, 0, s * (HALF_L - 0.15));
  }
  line(0, -SERVICE_Z, 0, SERVICE_Z);

  // Net
  const netW = 2 * (DHALF_W + 0.914);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(235,235,235,0.55)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 31, 31);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(netW / 0.06, NET_H / 0.06);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(netW, NET_H),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xcfd6e6 })
  );
  net.position.y = NET_H / 2;
  scene.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(netW, 0.06, 0.02), mat(0xffffff));
  tape.position.y = NET_H;
  scene.add(tape);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.07, 12), mat(0x30343c));
    post.position.set(s * netW / 2, 0.535, 0);
    post.castShadow = true;
    scene.add(post);
  }

  // Surrounding walls
  const wallMat = mat(0x10261f);
  const wall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), wallMat);
    m.position.set(x, 0.7, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  wall(26, 0.3, 0, -22); wall(26, 0.3, 0, 22);
  wall(0.3, 44, -13, 0); wall(0.3, 44, 13, 0);

  // Floodlight poles
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 14, 8), mat(0x2a2f3a));
    pole.position.set(sx * 14.5, 7, sz * 19);
    scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
    lamp.position.set(sx * 14.5, 14, sz * 19);
    lamp.lookAt(0, 0, 0);
    scene.add(lamp);
  }

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 700; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.42;
    const r = 140;
    pts.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 10, r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xc8d4ff, size: 0.5, fog: false })));
}
buildCourt();

// ---------------------------------------------------------------------------
// Ball, trail, shadow blob, bounce rings
// ---------------------------------------------------------------------------
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12),
  mat(0xdcf542, { emissive: 0x4a5a00, roughness: 0.4 }));
ball.castShadow = true;
scene.add(ball);

const blob = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.008;
scene.add(blob);

const TRAIL_N = 26;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
trail.frustumCulled = false;
scene.add(trail);
const trailHist = [];

const rings = [];
for (let i = 0; i < 6; i++) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  r.rotation.x = -Math.PI / 2;
  r.position.y = 0.01;
  r.userData.age = 99;
  scene.add(r);
  rings.push(r);
}
let ringIdx = 0;
function spawnRing(x, z) {
  const r = rings[ringIdx++ % rings.length];
  r.position.x = x; r.position.z = z;
  r.userData.age = 0;
}

// ---------------------------------------------------------------------------
// Players (low-poly, no facial detail)
// ---------------------------------------------------------------------------
function makePlayer({ shirt, shorts, cap, skin = 0xd9a77c }) {
  const root = new THREE.Group();
  const add = (parent, geo, color, x, y, z) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);
  const body = new THREE.Group();
  hips.add(body);
  add(body, new THREE.BoxGeometry(0.4, 0.56, 0.24), shirt, 0, 0.32, 0);
  add(body, new THREE.BoxGeometry(0.38, 0.2, 0.25), shorts, 0, 0.0, 0);
  add(body, new THREE.SphereGeometry(0.13, 16, 12), skin, 0, 0.78, 0);
  add(body, new THREE.SphereGeometry(0.137, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap, 0, 0.8, 0);
  add(body, new THREE.BoxGeometry(0.2, 0.03, 0.14), cap, 0, 0.82, 0.13); // cap brim marks the front

  const leg = x => {
    const p = new THREE.Group();
    p.position.set(x, 0.92, 0);
    root.add(p);
    add(p, new THREE.BoxGeometry(0.14, 0.5, 0.15), shorts, 0, -0.18, 0).scale.set(1, 0.6, 1);
    add(p, new THREE.BoxGeometry(0.12, 0.62, 0.13), skin, 0, -0.55, 0);
    add(p, new THREE.BoxGeometry(0.13, 0.08, 0.26), 0xf4f4f4, 0, -0.88, 0.05);
    return p;
  };
  const legL = leg(0.1);   // local +x = player's left
  const legR = leg(-0.1);

  const armL = new THREE.Group();
  armL.position.set(0.25, 0.54, 0);
  body.add(armL);
  add(armL, new THREE.BoxGeometry(0.09, 0.58, 0.09), skin, 0, -0.29, 0);

  const shoulderR = new THREE.Group();
  shoulderR.position.set(-0.25, 0.54, 0);
  body.add(shoulderR);
  const armR = new THREE.Group();
  shoulderR.add(armR);
  add(armR, new THREE.BoxGeometry(0.09, 0.58, 0.09), skin, 0, -0.29, 0);
  const racket = new THREE.Group();
  racket.position.y = -0.6;
  armR.add(racket);
  add(racket, new THREE.CylinderGeometry(0.016, 0.016, 0.24, 8), 0x222222, 0, -0.12, 0);
  const head = add(racket, new THREE.TorusGeometry(0.12, 0.013, 6, 24), 0xe8e8e8, 0, -0.39, 0);
  head.scale.set(1, 1.3, 1);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  strings.position.y = -0.39;
  strings.scale.set(1, 1.3, 1);
  racket.add(strings);

  scene.add(root);
  return {
    root, hips, body, legL, legR, armL, shoulderR, armR,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, baseYaw: 0, side: 1,
    phase: 0, move: null, swing: null, lunge: null, home: new THREE.Vector3(),
  };
}

const ATT = makePlayer({ shirt: 0xc8463c, shorts: 0x2b2b33, cap: 0xf2f2f2 });
const DEF = makePlayer({ shirt: 0xf3f5fa, shorts: 0x1f4fa8, cap: 0x1f4fa8, skin: 0xe2b48c });
ATT.root.scale.setScalar(PERSON);
DEF.root.scale.setScalar(PERSON);
ATT.side = -1; ATT.baseYaw = 0; ATT.yaw = 0; ATT.home.set(0, 0, -10.2); ATT.pos.copy(ATT.home);
DEF.side = 1; DEF.baseYaw = Math.PI; DEF.yaw = Math.PI; DEF.home.set(0, 0, 12.8); DEF.pos.copy(DEF.home);

// Player's right-hand direction in world space (racket side) for its base facing.
const rightVec = p => new THREE.Vector3(-Math.cos(p.baseYaw), 0, Math.sin(p.baseYaw));

// Trapezoidal velocity profile: quick accel, cruise, quick decel.
function trap(u, a = 0.18) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const k = 1 / (2 * a * (1 - a));
  if (u < a) return u * u * k;
  if (u > 1 - a) return 1 - (1 - u) * (1 - u) * k;
  return (u - a / 2) / (1 - a);
}

function setMove(p, to, start, end) {
  p.move = { from: p.pos.clone(), to: to.clone(), start, end: Math.max(end, start + 0.05) };
}

const SWING = {
  fh: { y0: -1.6, y1: 1.7, z: -1.15, x: 0 },
  bh: { y0: -2.4, y1: -5.0, z: -1.15, x: 0 },
};
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function updatePlayer(p, t, dt) {
  const prev = p.pos.clone();
  if (p.move) {
    const m = p.move;
    const u = (t - m.start) / (m.end - m.start);
    p.pos.lerpVectors(m.from, m.to, trap(clamp(u, 0, 1)));
  }
  if (dt > 0) p.vel.subVectors(p.pos, prev).divideScalar(dt);
  const speed = Math.hypot(p.vel.x, p.vel.z);

  // Facing: toward the opponent, turned partially into the run when sprinting.
  let swingK = 0;
  if (p.swing) swingK = clamp(1 - Math.abs(t - p.swing.time) / 0.45, 0, 1);
  let targetYaw = p.baseYaw;
  if (speed > 2) {
    const runYaw = Math.atan2(p.vel.x, p.vel.z);
    targetYaw = angleLerp(p.baseYaw, runYaw, clamp((speed - 2) / 5, 0, p.model ? 0.9 : 0.75) * (p.anim && p.anim.kind === 'dive' ? 1 : 1 - swingK));
  }
  p.yaw = angleLerp(p.yaw, targetYaw, 1 - Math.exp(-dt * 10));

  // Run cycle
  p.phase += speed * dt * 2.7;
  const amp = clamp(speed / 5, 0, 1) * 0.85;
  const sw = Math.sin(p.phase);
  p.legL.rotation.set(sw * amp, 0, 0);
  p.legR.rotation.set(-sw * amp, 0, 0);
  p.armL.rotation.set(-sw * amp * 0.8, 0, 0.15);
  let hipY = 0.92 - Math.abs(Math.cos(p.phase)) * 0.05 * amp;
  p.body.rotation.set(clamp(speed / 9, 0, 1) * 0.35, 0, 0);

  // Lunge / dive for desperate gets
  if (p.lunge) {
    const d = t - p.lunge.time;
    const k = d < 0 ? smooth(clamp(1 + d / 0.35, 0, 1)) : smooth(clamp(1 - d / 0.55, 0, 1));
    hipY -= (p.lunge.dive ? 0.42 : 0.28) * k;
    p.body.rotation.z += p.lunge.side * (p.lunge.dive ? 0.7 : 0.45) * k;
    p.body.rotation.x += 0.25 * k;
    p.legL.rotation.z += 0.5 * k;
    p.legR.rotation.z -= 0.5 * k;
    if (d > 0.7) p.lunge = null;
  }
  p.hips.position.y = hipY;
  p.legL.position.y = p.legR.position.y = hipY;

  // Racket arm
  const idle = { y: -0.5, z: -0.35, x: 0.35 };
  let ay = idle.y, az = idle.z, ax = idle.x;
  let swingBlend = 0;
  if (p.swing) {
    const s = (t - (p.swing.time - 0.32)) / 0.52; // contact at ~62%
    const blend = s < 0 ? smooth(clamp(1 + s / 0.6, 0, 1)) : s > 1 ? smooth(clamp(1 - (s - 1) / 0.6, 0, 1)) : 1;
    const e = easeInOut(clamp(s, 0, 1));
    swingBlend = blend;
    if (p.swing.kind === 'smash') {
      ay = lerp(idle.y, -0.2, blend);
      az = lerp(idle.z, -0.25, blend);
      ax = lerp(idle.x, lerp(2.4, 5.2, e), blend);
    } else {
      const S = SWING[p.swing.kind];
      ay = lerp(idle.y, lerp(S.y0, S.y1, e), blend);
      az = lerp(idle.z, S.z, blend);
      ax = lerp(idle.x, S.x, blend);
    }
    if (s > 2.2) p.swing = null;
  }
  p.shoulderR.rotation.set(0, ay, 0);
  p.armR.rotation.set(ax, 0, az);

  p.root.position.set(p.pos.x, 0, p.pos.z);
  p.root.rotation.y = p.yaw;
  if (p.model) updateModel(p, t, speed, dt, ax, ay, az, swingBlend);
}

// ---------------------------------------------------------------------------
// 3D player model (Tripo: generated from a Gemini reference image, auto-rigged,
// with a retargeted run cycle). Both players share it; the attacker's white
// outfit is recolored in the shader. Block figures stay as the fallback.
// ---------------------------------------------------------------------------
const MODEL_H = 1.8;          // model is 1 unit tall
const RUN_CLIP_SPEED = 3.7;   // m/s the run clip covers at timeScale 1
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _lq = new THREE.Quaternion();

// Strip root motion (the clip runs forward) but keep the vertical bob.
function inPlaceClip(clip, scene) {
  const hip = scene.getObjectByName('Hip');
  scene.updateMatrixWorld(true);
  const pq = hip.parent.getWorldQuaternion(new THREE.Quaternion());
  const pqi = pq.clone().invert();
  const bind = hip.position.clone().applyQuaternion(pq);
  const tracks = clip.tracks.filter(t => !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || t.name === 'Hip.position'));
  const hp = tracks.find(t => t.name === 'Hip.position');
  if (hp) {
    const v = new THREE.Vector3();
    for (let i = 0; i < hp.values.length; i += 3) {
      v.fromArray(hp.values, i).applyQuaternion(pq);
      v.x = bind.x; v.z = bind.z;
      v.applyQuaternion(pqi).toArray(hp.values, i);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function tintMaterial(src, color) {
  const m = src.clone();
  if (!color) return m;
  m.onBeforeCompile = sh => {
    sh.uniforms.uTint = { value: color };
    sh.fragmentShader = 'uniform vec3 uTint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float mn = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float k = smoothstep(0.3, 0.55, mx) * (1.0 - smoothstep(0.1, 0.22, (mx - mn) / max(mx, 1e-3)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.3 + 0.8 * mx), k);
      }`);
  };
  m.customProgramCacheKey = () => 'tint-' + color.getHexString();
  return m;
}

function makeRacket() {
  const racket = new THREE.Group();
  const part = (geo, color, y) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.y = y;
    m.castShadow = true;
    racket.add(m);
    return m;
  };
  part(new THREE.CylinderGeometry(0.016, 0.016, 0.24, 8), 0x222222, -0.1);
  part(new THREE.TorusGeometry(0.12, 0.013, 6, 24), 0xe8e8e8, -0.37).scale.set(1, 1.3, 1);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  strings.position.y = -0.37;
  strings.scale.set(1, 1.3, 1);
  racket.add(strings);
  return racket;
}

function attachModel(p, gltf, clips, tint) {
  const model = cloneSkinned(gltf.scene);
  model.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = tintMaterial(o.material, tint);
    }
  });
  const lean = new THREE.Group();
  const holder = new THREE.Group();
  holder.scale.setScalar(MODEL_H);
  holder.rotation.y = -Math.PI / 2; // model faces +x; players face local +z
  holder.add(model);
  lean.add(holder);
  p.root.add(lean);

  const mixer = new THREE.AnimationMixer(model);
  const act = (clip, loop = true) => {
    const a = mixer.clipAction(clip);
    if (!loop) a.setLoop(THREE.LoopOnce);
    a.play();
    a.weight = 0;
    return a;
  };
  const run = act(clips.run);
  // Attacker waits relaxed (idle); the runner waits crouched (the slash clip's ready frame).
  const base = p === ATT ? act(clips.idle) : act(clips.ready);
  if (p !== ATT) { base.paused = true; base.time = READY_T; }
  const dive = act(clips.dive);
  const smash = act(clips.slash);
  dive.paused = smash.paused = true; // time is set by hand from the shot timeline
  const bone = n => model.getObjectByName(n);
  const m = {
    lean, mixer, run, base, dive, smash,
    rUp: bone('R_Upperarm'), rFo: bone('R_Forearm'), rHand: bone('R_Hand'),
    lUp: bone('L_Upperarm'), lFo: bone('L_Forearm'), lHand: bone('L_Hand'),
  };

  // Racket in the right hand, pointing along the forearm.
  p.root.updateMatrixWorld(true);
  const dir = m.rHand.getWorldPosition(_a).sub(m.rFo.getWorldPosition(_b)).normalize();
  dir.applyQuaternion(m.rHand.getWorldQuaternion(_q).invert());
  const racket = makeRacket();
  racket.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  racket.scale.setScalar(1 / m.rHand.getWorldScale(_a).x);
  m.rHand.add(racket);

  p.hips.visible = p.legL.visible = p.legR.visible = false;
  p.model = m;
}

// Rotate `bone` (weight w) so the bone->child segment points along dirWorld.
function aimBone(bone, child, dirWorld, w) {
  if (w <= 0.001) return;
  const cur = child.getWorldPosition(_a).sub(bone.getWorldPosition(_b)).normalize();
  _q.setFromUnitVectors(cur, dirWorld);
  bone.getWorldQuaternion(_q2).premultiply(_q);
  bone.parent.getWorldQuaternion(_pq).invert();
  _q2.premultiply(_pq);
  bone.quaternion.slerp(_q2, w);
  bone.updateMatrixWorld(true);
}

// Racket-arm direction in player-local space (faces +z, right hand at -x).
const armDir = (ax, ay, az) =>
  new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(ax, 0, az, 'XYZ')).applyAxisAngle(Y_AXIS, ay);
const IDLE_FORE = new THREE.Vector3(-0.3, -0.25, 1).normalize();

// One-shot clips, synced so the clip's contact frame lands on the hit time.
// After contact the clip runs `after`x faster so the player is up in time.
const ONE_SHOT = {
  dive: { start: 0.95, contact: 1.17, end: 2.73, after: 1.6 },
  smash: { start: 1.45, contact: 2.0, end: 2.6, after: 1.0 },
};
const READY_T = 0.94; // slash clip: crouched ready stance

function oneShotState(p, t) {
  if (!p.anim) return null;
  const c = ONE_SHOT[p.anim.kind];
  const d = t - p.anim.time;
  const clipT = d < 0 ? c.contact + d : c.contact + d * c.after;
  if (clipT < c.start) return null;
  if (clipT >= c.end) { p.anim = null; return null; }
  const fadeIn = clamp((clipT - c.start) / 0.12, 0, 1);
  const fadeOut = clamp((c.end - clipT) / (0.25 * c.after), 0, 1);
  return { kind: p.anim.kind, clipT, w: Math.min(fadeIn, fadeOut) };
}

function updateModel(p, t, speed, dt, ax, ay, az, swingBlend) {
  const m = p.model;
  const shot = oneShotState(p, t);
  const ow = shot ? shot.w : 0;
  const runW = clamp((speed - 0.6) / 2.4, 0, 1);
  m.run.weight = runW * (1 - ow);
  m.run.timeScale = Math.max(speed, 2) / RUN_CLIP_SPEED;
  m.base.weight = (1 - runW) * (1 - ow);
  m.dive.weight = shot && shot.kind === 'dive' ? ow : 0;
  m.smash.weight = shot && shot.kind === 'smash' ? ow : 0;
  if (shot) (shot.kind === 'dive' ? m.dive : m.smash).time = shot.clipT;
  m.mixer.update(dt);

  m.lean.rotation.set(p.body.rotation.x * 0.5 * (1 - ow), 0, p.body.rotation.z * 0.6 * (1 - ow));
  p.root.updateMatrixWorld(true);
  m.lean.getWorldQuaternion(_lq);

  // Racket arm is procedural (forehand/backhand) unless a one-shot clip owns it.
  const up = armDir(ax, ay, az);
  const fore = IDLE_FORE.clone().lerp(up, swingBlend).normalize();
  aimBone(m.rUp, m.rFo, up.applyQuaternion(_lq), 1 - ow);
  aimBone(m.rFo, m.rHand, fore.applyQuaternion(_lq), 1 - ow);
}

new GLTFLoader().load('assets/player.glb', gltf => {
  const clips = {};
  for (const a of gltf.animations) clips[a.name] = inPlaceClip(a, gltf.scene);
  clips.ready = clips.slash.clone(); // separate action for the frozen ready frame
  clips.ready.name = 'ready';
  attachModel(ATT, gltf, clips, new THREE.Color(0xb8302a));
  attachModel(DEF, gltf, clips, null);
}, undefined, err => console.warn('player model failed to load, using block figures', err));

// ---------------------------------------------------------------------------
// Ball flight: aim + simulate to a sample table
// ---------------------------------------------------------------------------
function solveShot(p0, tx, tz, t, minClear) {
  let v;
  for (let k = 0; k < 80; k++) {
    v = new THREE.Vector3((tx - p0.x) / t, (BALL_R - p0.y + 0.5 * G * t * t) / t, (tz - p0.z) / t);
    const tn = -p0.z / v.z;
    const yn = p0.y + v.y * tn - 0.5 * G * tn * tn;
    if (yn >= NET_H + minClear) break;
    t += 0.03;
  }
  return v;
}

function simulate(p0, v0, rest, fric) {
  const s = [];
  const p = p0.clone(), v = v0.clone();
  let b = 0;
  for (let i = 0; i < 240 * 7; i++) {
    s.push({ t: i * SAMPLE_DT, x: p.x, y: p.y, z: p.z, vy: v.y, b });
    v.y -= G * SAMPLE_DT;
    p.addScaledVector(v, SAMPLE_DT);
    if (p.y < BALL_R && v.y < 0) {
      p.y = 2 * BALL_R - p.y;
      v.y = -v.y * (b === 0 ? rest : 0.65);
      const f = b === 0 ? fric : 0.85;
      v.x *= f; v.z *= f;
      b++;
      if (b >= 4) break;
    }
  }
  return s;
}

// Every point where `p` could meet the ball, with the run speed it needs.
function interceptCandidates(samples, p, { hMin, hMax, volley = false, reaction = 0.12 }) {
  const out = [];
  const R = rightVec(p);
  for (const s of samples) {
    if (s.b >= 2) break;
    if (p.side * s.z < 1.0) continue;
    const avail = s.t - reaction;
    if (avail < 0.15) continue;
    if (s.b === 0) {
      if (!volley || s.vy > 0 || s.y < 1.95 || s.y > 2.6) continue;
      const sx = s.x - R.x * 0.3, sz = s.z + p.side * 0.35;
      const d = Math.hypot(sx - p.pos.x, sz - p.pos.z);
      out.push({ s, sx, sz, side: 1, kind: 'smash', req: d / avail });
      continue;
    }
    if (s.y < hMin || s.y > hMax) continue;
    for (const side of [1, -1]) { // 1: forehand (ball on racket side)
      const sx = s.x - R.x * 0.62 * side, sz = s.z + p.side * 0.15;
      if (Math.abs(sx) > 9 || p.side * sz > 20) continue;
      const d = Math.hypot(sx - p.pos.x, sz - p.pos.z);
      out.push({ s, sx, sz, side, kind: side === 1 ? 'fh' : 'bh', req: d / avail });
    }
  }
  return out;
}

function chooseDefender(c) {
  const ok = c.filter(x => x.req <= DEF_VMAX * 1.06); // a last lunge beyond top speed
  if (ok.length) {
    // Earliest reachable point = arriving at full sprint. That's the ギリギリ.
    ok.sort((a, b) => a.s.t - b.s.t);
    const best = ok[Math.min(ok.length - 1, Math.floor(Math.random() * 5))];
    return { ...best, desperate: best.req > DEF_VMAX * 0.85 || best.s.y < 0.35, dive: false };
  }
  if (!c.length) return null;
  c.sort((a, b) => a.req - b.req);
  return { ...c[0], desperate: true, dive: true };
}

function chooseAttacker(c) {
  const ok = c.filter(x => x.req <= 6.5);
  const smash = ok.filter(x => x.kind === 'smash' && x.s.z < -2.5 && x.s.z > -11);
  if (smash.length && Math.random() < 0.15) return smash[Math.floor(smash.length / 2)];
  const ground = ok.filter(x => x.kind !== 'smash');
  if (ground.length) {
    ground.sort((a, b) => (Math.abs(a.s.y - 0.9) + a.req * 0.05) - (Math.abs(b.s.y - 0.9) + b.req * 0.05));
    return ground[0];
  }
  if (!c.length) return null;
  c.sort((a, b) => a.req - b.req);
  return c[0];
}

const SHOT_LABEL = { drop: 'DROP SHOT', smash: 'SMASH!', angle: 'ANGLE', wrong: 'WRONG FOOT' };

const SHOT_MIX = [['drive', 0.4], ['drop', 0.27], ['angle', 0.2], ['wrong', 0.13]];
function pickShotType() {
  let r = Math.random();
  for (const [type, w] of SHOT_MIX) if ((r -= w) < 0) return type;
  return 'drive';
}

function attackerSpec(contactKind, type) {
  const R = DEF.pos;
  const away = -signOr(R.x);
  if (contactKind === 'smash')
    return { type: 'smash', tx: away * rand(2.8, 4.0), tz: rand(6, 9.8), t: rand(0.45, 0.58), clear: 0.05, rest: 0.8, fric: 0.82 };
  switch (type) {
    case 'safe': // a rally ball back toward the runner, used when every attack would be unreachable
      return { type: 'drive', tx: clamp(R.x * 0.5 + rand(-1.5, 1.5), -3.8, 3.8), tz: rand(8.5, 11), t: rand(0.85, 1.05), clear: 0.4, rest: 0.72, fric: 0.74 };
    case 'drop':
      return { type: 'drop', tx: clamp(-R.x * 0.8 + rand(-1.5, 1.5), -3.9, 3.9), tz: rand(0.9, 2.2), t: rand(0.9, 1.15), clear: 0.08, rest: 0.42, fric: 0.25 };
    case 'angle':
      return { type: 'angle', tx: away * rand(3.6, 4.05), tz: rand(4.8, 6.8), t: rand(0.8, 0.95), clear: 0.25, rest: 0.66, fric: 0.72 };
    case 'wrong':
      return { type: 'wrong', tx: -away * rand(2.2, 3.6), tz: rand(9.5, 11.4), t: rand(0.75, 0.9), clear: 0.3, rest: 0.72, fric: 0.74 };
    default:
      return { type: 'drive', tx: away * rand(3.2, 4.0), tz: rand(9.5, 11.6), t: rand(0.66, 0.85), clear: 0.3, rest: 0.72, fric: 0.74 };
  }
}

function defenderSpec(plan) {
  const r = Math.random();
  if (r < (plan.dive ? 0.35 : plan.desperate ? 0.18 : 0.1))
    return { type: 'lob', tx: rand(-3.2, 3.2), tz: rand(-10.5, -6.5), t: plan.dive ? rand(2.4, 2.8) : rand(2.0, 2.6), clear: 1.0, rest: 0.74, fric: 0.7 };
  if (r < 0.55)
    return { type: 'slice', tx: rand(-3.4, 3.4), tz: rand(-10.5, -8), t: rand(1.3, 1.6), clear: 0.3, rest: 0.6, fric: 0.82 };
  return { type: 'deep', tx: rand(-3.3, 3.3), tz: rand(-11, -8.5), t: rand(1.15, 1.45), clear: 0.45, rest: 0.7, fric: 0.75 };
}

// ---------------------------------------------------------------------------
// Rally state machine
// ---------------------------------------------------------------------------
let simT = 0;
let shot = null;
let rally = 0;
let timeScale = 1;
let slowUntil = -1;
const stats = window.__rallyStats = { gets: 0, desperate: 0, forcedDive: 0, dives: 0, resets: 0, types: {} };

function launch(hitter, receiver, P, t0, hitKind) {
  let spec, samples, plan;
  if (receiver === DEF) {
    // Try many attacking shots and keep the one closest to a target difficulty:
    // the slowest possible run that still reaches the ball (minReq). Above
    // DEF_VMAX the runner can only get there with a dive.
    const target = DEF_VMAX * (Math.random() < 0.3 ? rand(1.1, 1.2) : rand(0.8, 1.02));
    let best = null, easiest = null;
    const want = pickShotType();
    for (let tries = 0; tries < 32; tries++) {
      if (tries === 16 && best && best.minReq > DEF_VMAX * 0.6) break; // the wanted shot type works
      const type = tries < 16 ? want : tries < 28 ? pickShotType() : 'safe';
      const sp = attackerSpec(hitKind, type);
      const smp = simulate(P, solveShot(P, sp.tx, sp.tz, sp.t, sp.clear), sp.rest, sp.fric);
      const cands = interceptCandidates(smp, DEF, { hMin: 0.1, hMax: 2.2, reaction: 0.18 });
      if (location.search.includes('stats') && tries < 16) { const k = want + ':' + (cands.length ? (Math.min(...cands.map(c => c.req)) / DEF_VMAX).toFixed(1) : 'none'); stats.probe = stats.probe || {}; stats.probe[k] = (stats.probe[k] || 0) + 1; }
      if (!cands.length) continue;
      const minReq = Math.min(...cands.map(c => c.req));
      if (!easiest || minReq < easiest.minReq) easiest = { minReq, sp, smp, cands };
      if (minReq > DEF_VMAX * 1.22) continue; // truly unreachable
      const score = Math.abs(minReq - target);
      if (!best || score < best.score) best = { score, minReq, sp, smp, cands };
    }
    best = best || easiest;
    if (location.search.includes('stats')) (stats.minReqs = stats.minReqs || []).push(+((best ? Math.min(...best.cands.map(c => c.req)) : -1) / DEF_VMAX).toFixed(2), +(easiest ? easiest.minReq / DEF_VMAX : -1).toFixed(2));
    if (best) {
      spec = best.sp;
      stats.types[spec.type] = (stats.types[spec.type] || 0) + 1;
      samples = best.smp;
      plan = chooseDefender(best.cands);
    }
  } else {
    for (let tries = 0; tries < 12; tries++) {
      spec = defenderSpec(shot ? shot.plan : { desperate: false });
      samples = simulate(P, solveShot(P, spec.tx, spec.tz, spec.t, spec.clear), spec.rest, spec.fric);
      plan = chooseAttacker(interceptCandidates(samples, ATT, { hMin: 0.3, hMax: 1.8, volley: true, reaction: 0.2 }));
      if (plan) break;
    }
  }

  if (!plan) { startRally(); return; }
  if (receiver === DEF) {
    stats.gets++;
    if (plan.desperate) stats.desperate++;
    if (plan.dive) stats.forcedDive++;
  }
  const hitTime = t0 + plan.s.t;
  setMove(receiver, new THREE.Vector3(plan.sx, 0, plan.sz), t0 + (plan.dive ? 0.04 : 0.1), hitTime);
  receiver.swing = { time: hitTime, kind: plan.kind };
  const dive = receiver === DEF && (plan.dive || (plan.desperate && Math.random() < 0.15));
  receiver.lunge = receiver === DEF && plan.desperate && !dive ? { time: hitTime, side: plan.side, dive: false } : null;
  plan.drama = dive || (receiver === DEF && plan.s.y < 0.3);
  if (dive) stats.dives++;
  receiver.anim = dive ? { kind: 'dive', time: hitTime } : plan.kind === 'smash' ? { kind: 'smash', time: hitTime } : null;

  const homeDist = hitter.pos.distanceTo(hitter.home);
  const getUp = hitter.anim && hitter.anim.kind === 'dive' ? 0.6 : 0; // finish the roll first
  setMove(hitter, hitter.home, t0 + 0.3 + getUp, t0 + 0.3 + getUp + 0.4 + homeDist / (hitter === DEF ? 3.8 : 4.5));

  shot = { samples, t0, hitter, receiver, plan, spec, lastB: 0 };
  if (SHOT_LABEL[spec.type]) flash(SHOT_LABEL[spec.type]);
}

function startRally() {
  if (rally) { console.warn('rally reset at', rally); stats.resets++; }
  rally = 0;
  ATT.pos.set(0.6, 0, -10.2);
  const P = new THREE.Vector3(0, 1.0, -10.1);
  ATT.swing = { time: simT + 0.8, kind: 'fh' };
  shot = null;
  pendingServe = { at: simT + 0.8, P };
  ball.position.copy(P);
}
let pendingServe = null;

function ballAt(tau) {
  const s = shot.samples;
  const f = clamp(tau / SAMPLE_DT, 0, s.length - 1);
  const i = Math.floor(f), j = Math.min(i + 1, s.length - 1), u = f - i;
  return { x: lerp(s[i].x, s[j].x, u), y: lerp(s[i].y, s[j].y, u), z: lerp(s[i].z, s[j].z, u), b: s[i].b };
}

function step(dt) {
  simT += dt;

  if (pendingServe && simT >= pendingServe.at) {
    const { P, at } = pendingServe;
    pendingServe = null;
    launch(ATT, DEF, P, at, 'fh');
    sound('hit', { pos: P, ...HIT_TONE.drive });
  }

  if (shot) {
    const hitAt = shot.t0 + shot.plan.s.t;
    // Shoes squeal on the hard court when the runner plants for a desperate get.
    if (shot.receiver === DEF && shot.plan.desperate && !shot.squeaked && simT >= hitAt - 0.3) {
      shot.squeaked = true;
      if (shot.plan.drama || Math.random() < 0.5) sound('squeak', { pos: DEF.pos, power: 0.5 });
    }
    if (simT >= hitAt) {
      const s = shot.plan.s;
      const P = new THREE.Vector3(s.x, s.y, s.z);
      const hitter = shot.receiver;
      rally++;
      document.getElementById('rally').textContent = rally;
      if (shot.plan.drama) slowUntil = hitAt + 0.35;
      if (hitter === DEF && shot.plan.desperate) {
        if (shot.plan.dive || Math.random() < 0.35) flash(pick(['GREAT GET!', 'STILL ALIVE!', 'JUST REACHED IT!']));
      }
      if (rally % 100 === 0) flash(`${rally} SHOTS!`);
      const scramble = hitter === DEF && shot.plan.desperate ? 0.8 : 1;
      launch(hitter, hitter === ATT ? DEF : ATT, P, hitAt, shot.plan.kind);
      if (!shot) return; // rally restarted
      const tone = HIT_TONE[shot.spec.type] || HIT_TONE.drive;
      sound('hit', { pos: P, power: tone.power * scramble, rate: tone.rate });
    }
    const b = ballAt(simT - shot.t0);
    if (b.b > shot.lastB) {
      shot.lastB = b.b;
      if (b.b === 1) spawnRing(b.x, b.z);
      sound('bounce', { pos: ball.position, power: b.b === 1 ? 0.8 : 0.4 });
    }
    ball.position.set(b.x, Math.max(b.y, 0.06), b.z);
  }

  updatePlayer(ATT, simT, dt);
  updatePlayer(DEF, simT, dt);
}
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const CAMS = [
  { id: 'tv', name: 'TV' },
  { id: 'runner', name: 'Behind' },
  { id: 'side', name: 'Side' },
  { id: 'orbit', name: 'Orbit' },
  { id: 'low', name: 'Low' },
];
let camIdx = 0;
let autoCam = true;
let camTimer = 0;
let orbitA = 0.6;
const camPos = new THREE.Vector3(0, 9, -24);
const camLook = new THREE.Vector3(0, 0, 3);

function cameraTargets(dt) {
  const D = DEF.pos, B = ball.position;
  const portrait = camera.aspect < 1;
  const pull = portrait ? 1.35 : 1;
  switch (CAMS[camIdx].id) {
    case 'tv':
      if (portrait) return [new THREE.Vector3(0, 10, -15), new THREE.Vector3(D.x * 0.4, 0, 8)];
      return [new THREE.Vector3(0, 9, -23), new THREE.Vector3(D.x * 0.25, 0, 4)];
    case 'runner':
      return [new THREE.Vector3(D.x * 0.8, 2.8, D.z + 6.5 * pull), new THREE.Vector3(D.x * 0.4 + B.x * 0.2, 1, D.z - 9)];
    case 'side':
      return [new THREE.Vector3(17 * pull, 5.5, (B.z + D.z) * 0.3), new THREE.Vector3(0, 1, (B.z + D.z) * 0.4)];
    case 'orbit':
      orbitA += dt * 0.06;
      return [new THREE.Vector3(Math.sin(orbitA) * 25 * pull, 9, Math.cos(orbitA) * 25 * pull), new THREE.Vector3(0, 0.5, 2)];
    case 'low':
      return [new THREE.Vector3(DHALF_W + 1.6, 1.0, 1.0), new THREE.Vector3(D.x * 0.5, 1.2, D.z * 0.8)];
  }
}

function setCam(i) {
  camIdx = (i + CAMS.length) % CAMS.length;
  camTimer = 0;
  document.getElementById('camName').textContent = CAMS[camIdx].name;
  const [p, l] = cameraTargets(0);
  camPos.copy(p); camLook.copy(l); // cut, like a broadcast
}

// ---------------------------------------------------------------------------
// Sound: synthesized racket hits, bounces and shoe squeaks.
// Starts on the first tap/click/key (browsers block audio before a gesture).
// ---------------------------------------------------------------------------
let audio = null, soundOn = true, master = null, wet = null;
const SOUNDS = {};

// Build a mono buffer from a sample function f(t) -> value, then normalize.
function synth(dur, f, peak = 0.9) {
  const sr = audio.sampleRate, n = Math.floor(dur * sr);
  const buf = audio.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let max = 0;
  for (let i = 0; i < n; i++) { d[i] = f(i / sr); max = Math.max(max, Math.abs(d[i])); }
  for (let i = 0; i < n; i++) d[i] *= peak / max;
  // 2 ms fade-out so the tail never clicks
  const fade = Math.floor(0.002 * sr);
  for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  return buf;
}

// Damped sine with a slight downward pitch glide.
const ring = (t, f, tau, glide = 0) => Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t * (1 - glide * Math.min(t / 0.03, 1)));

// Band-limited noise: one-pole smoothed white noise, differentiated for brightness.
function noiseFn(bright) {
  let lp = 0, prev = 0;
  return () => {
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * bright;
    const out = lp - prev * 0.6;
    prev = lp;
    return out;
  };
}

function buildSounds() {
  // Racket hit: sharp string "pock" — transient click, body resonances, short noise burst.
  SOUNDS.hit = [];
  for (let k = 0; k < 6; k++) {
    const f1 = rand(1050, 1300), f2 = rand(560, 680), f3 = rand(2100, 2600), thump = rand(160, 210);
    const nz = noiseFn(0.55);
    SOUNDS.hit.push(synth(0.22, t =>
      (t < 0.0015 ? (Math.random() * 2 - 1) * (1 - t / 0.0015) * 0.9 : 0) +
      0.8 * ring(t, f1, 0.009, 0.06) +
      0.55 * ring(t, f2, 0.014, 0.04) +
      0.3 * ring(t, f3, 0.005) +
      0.45 * ring(t, thump, 0.018) +
      0.5 * nz() * Math.exp(-t / 0.011)));
  }
  // Bounce on a hard court: duller, lower "tock".
  SOUNDS.bounce = [];
  for (let k = 0; k < 4; k++) {
    const f1 = rand(230, 290), f2 = rand(820, 980);
    const nz = noiseFn(0.35);
    SOUNDS.bounce.push(synth(0.15, t =>
      0.9 * ring(t, f1, 0.011, 0.08) +
      0.35 * ring(t, f2, 0.004) +
      0.4 * nz() * Math.exp(-t / 0.004), 0.8));
  }
  // Shoe squeak: rubber stick-slip — a gliding tone chopped at ~70 Hz.
  SOUNDS.squeak = [];
  for (let k = 0; k < 3; k++) {
    const f0 = rand(2200, 2700), df = rand(300, 700), dur = rand(0.09, 0.16), chop = rand(55, 85);
    let ph = 0;
    SOUNDS.squeak.push(synth(dur, t => {
      ph += 2 * Math.PI * (f0 + df * t / dur) / audio.sampleRate;
      const env = Math.sin(Math.PI * t / dur);
      return env * (0.6 + 0.4 * Math.sin(2 * Math.PI * chop * t)) * (Math.sin(ph) + 0.3 * Math.sin(2 * ph));
    }, 0.5));
  }
}

// Outdoor court: a few hard early reflections off the walls and a short tail.
function courtImpulse() {
  const sr = audio.sampleRate, n = Math.floor(0.7 * sr);
  const ir = audio.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / sr / 0.16) * 0.25;
    for (const [ms, a] of [[23, 0.7], [41, 0.45], [67, 0.3], [95, 0.18]]) d[Math.floor((ms + c * 3) / 1000 * sr)] += a;
  }
  return ir;
}

function initAudio() {
  if (audio) return;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  master = audio.createGain();
  master.gain.value = 0.8;
  const comp = audio.createDynamicsCompressor();
  master.connect(comp).connect(audio.destination);
  const verb = audio.createConvolver();
  verb.buffer = courtImpulse();
  wet = audio.createGain();
  wet.gain.value = 0.22;
  wet.connect(verb).connect(master);
  buildSounds();
}

const _cam = new THREE.Vector3();
// pos: world position of the sound; power: 0..1 how hard; rate: pitch factor.
function sound(kind, { pos = null, power = 1, rate = 1 } = {}) {
  if (!soundOn || !audio || audio.state !== 'running') return;
  const list = SOUNDS[kind];
  const src = audio.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  // Slow motion drops the pitch, like a slowed-down recording.
  src.playbackRate.value = rate * rand(0.97, 1.03) * lerp(0.72, 1, clamp((timeScale - 0.3) / 0.7, 0, 1));

  let gain = 0.3 + 0.7 * power, pan = 0;
  if (pos) {
    _cam.copy(pos).applyMatrix4(camera.matrixWorldInverse);
    const dist = _cam.length();
    gain *= 1 / (1 + dist / 14);
    pan = clamp(_cam.x / Math.max(-_cam.z, 4) * 0.9, -0.8, 0.8);
  }
  // Soft shots sound duller.
  const tone = audio.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2500 + 9000 * power;
  const g = audio.createGain();
  g.gain.value = gain;
  src.connect(tone).connect(g);
  let out = g;
  if (audio.createStereoPanner) {
    const p = audio.createStereoPanner();
    p.pan.value = pan;
    out = g.connect(p);
  }
  out.connect(master);
  out.connect(wet);
  src.start();
}

// How each shot type sounds when struck.
const HIT_TONE = {
  smash: { power: 1, rate: 1.06 }, drive: { power: 0.85, rate: 1 }, angle: { power: 0.8, rate: 1 },
  wrong: { power: 0.85, rate: 1 }, deep: { power: 0.75, rate: 0.98 }, slice: { power: 0.55, rate: 0.95 },
  lob: { power: 0.45, rate: 0.95 }, drop: { power: 0.3, rate: 0.93 },
};

let unlockedAt = 0;
function unlockAudio() {
  if (!soundOn) return;
  if (!audio || audio.state !== 'running') unlockedAt = performance.now();
  initAudio();
  if (audio.state !== 'running') audio.resume();
}
['pointerdown', 'touchstart', 'keydown'].forEach(e => window.addEventListener(e, unlockAudio, { passive: true }));

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
let slowOn = true;
const msgEl = document.getElementById('msg');
let msgTimer = null;
function flash(text) {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => msgEl.classList.remove('show'), 1200);
}

const verEl = document.getElementById('verText');
const v = window.APP_VERSION || 'dev';
verEl.textContent = `${v === 'dev' ? 'dev' : 'v' + v}  ${window.APP_PUBLISHED || ''}`;

const controls = document.getElementById('controls');
let idleTimer = null;
function wake() {
  controls.classList.remove('hidden');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => controls.classList.add('hidden'), 3500);
}
['mousemove', 'touchstart', 'keydown'].forEach(e => window.addEventListener(e, wake, { passive: true }));
wake();

document.getElementById('btnCam').onclick = () => { setCam(camIdx + 1); };
document.getElementById('btnAuto').onclick = () => {
  autoCam = !autoCam;
  document.getElementById('autoState').textContent = autoCam ? 'ON' : 'OFF';
};
document.getElementById('btnSlow').onclick = () => {
  slowOn = !slowOn;
  document.getElementById('slowState').textContent = slowOn ? 'ON' : 'OFF';
};
document.getElementById('btnSound').onclick = () => {
  // The press that unlocked audio should leave it on, not toggle it off.
  if (performance.now() - unlockedAt > 800) soundOn = !soundOn;
  if (soundOn) { initAudio(); audio.resume(); }
  document.getElementById('soundState').textContent = soundOn ? 'ON' : 'OFF';
};
document.getElementById('btnFull').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};
canvas.addEventListener('click', () => setCam(camIdx + 1));
window.addEventListener('keydown', e => {
  if (e.key === 'c' || e.key === 'ArrowRight') setCam(camIdx + 1);
  if (e.key === 'ArrowLeft') setCam(camIdx - 1);
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 60 : 45;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
startRally();
setCam(0);
let last = performance.now();

function frame(now) {
  const realDt = Math.min((now - last) / 1000, 0.05) * SPEED;
  last = now;

  // Slow motion right before / after a desperate get.
  let target = 1;
  if (slowOn && shot && shot.plan.drama) {
    const until = shot.t0 + shot.plan.s.t - simT;
    if (until < 0.45) target = 0.3;
  }
  if (slowOn && simT < slowUntil) target = 0.3;
  timeScale = lerp(timeScale, target, 1 - Math.exp(-realDt * 8));
  step(realDt * timeScale);

  // Trail
  trailHist.unshift(ball.position.clone());
  if (trailHist.length > TRAIL_N) trailHist.pop();
  for (let i = 0; i < TRAIL_N; i++) {
    const p = trailHist[Math.min(i, trailHist.length - 1)];
    trailPos.set([p.x, p.y, p.z], i * 3);
    const k = 1 - i / TRAIL_N;
    trailCol.set([0.86 * k, 0.96 * k, 0.26 * k], i * 3);
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;

  blob.position.x = ball.position.x;
  blob.position.z = ball.position.z;
  const hk = clamp(1 - ball.position.y / 6, 0.2, 1);
  blob.material.opacity = 0.4 * hk;
  blob.scale.setScalar(0.7 + (1 - hk));

  for (const r of rings) {
    r.userData.age += realDt * timeScale;
    const a = r.userData.age;
    r.material.opacity = a < 0.9 ? 0.7 * (1 - a / 0.9) : 0;
    r.scale.setScalar(1 + a * 3);
  }

  // Camera
  if (autoCam) {
    camTimer += realDt;
    if (camTimer > 22) setCam(camIdx + 1);
  }
  const [cp, cl] = cameraTargets(realDt);
  const k = 1 - Math.exp(-realDt * 2.5);
  camPos.lerp(cp, k);
  camLook.lerp(cl, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
