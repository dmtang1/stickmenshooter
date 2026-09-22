import * as THREE from "three";

const ink = new THREE.MeshLambertMaterial({ color: 0x14120f });
const headMat = new THREE.MeshLambertMaterial({ color: 0xf4ead3 });
const white = new THREE.MeshLambertMaterial({ color: 0xf7f1e4 });

function cyl(r, h, mat = ink, seg = 6) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.castShadow = true;
  return m;
}

function ball(r, mat = ink) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.castShadow = true;
  return m;
}

function box(w, h, d, mat = ink) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

function faceGroup(kind) {
  const g = new THREE.Group();
  const eye = () => box(0.045, 0.045, 0.03, ink);
  if (kind === "blank") {
    const l = eye();
    l.position.set(-0.055, 0.02, 0.14);
    const r = eye();
    r.position.set(0.055, 0.02, 0.14);
    g.add(l, r);
    return g;
  }
  if (kind === "cool") {
    const shades = box(0.22, 0.05, 0.04, ink);
    shades.position.set(0, 0.03, 0.145);
    g.add(shades);
    return g;
  }
  const l = eye();
  const r = eye();
  l.position.set(-0.055, 0.03, 0.145);
  r.position.set(0.055, 0.03, 0.145);
  if (kind === "wink") r.scale.set(1, 0.25, 1);
  g.add(l, r);
  const mouth = box(kind === "shock" ? 0.05 : 0.1, kind === "shock" ? 0.05 : 0.025, 0.03, ink);
  mouth.position.set(0, kind === "frown" ? -0.05 : -0.06, 0.145);
  if (kind === "smile") mouth.rotation.z = 0;
  if (kind === "frown") mouth.scale.x = 0.7;
  g.add(mouth);
  return g;
}

function hatMesh(kind, color) {
  if (kind === "none") return null;
  const mat = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  if (kind === "tophat") {
    const brim = cyl(0.22, 0.04, mat, 10);
    brim.position.y = 0.18;
    const top = cyl(0.13, 0.22, mat, 10);
    top.position.y = 0.31;
    g.add(brim, top);
  } else if (kind === "cap") {
    const cap = cyl(0.18, 0.08, mat, 10);
    cap.position.y = 0.18;
    const bill = box(0.14, 0.03, 0.12, mat);
    bill.position.set(0, 0.16, 0.14);
    g.add(cap, bill);
  } else if (kind === "beanie") {
    const hat = cyl(0.17, 0.12, mat, 10);
    hat.position.y = 0.2;
    const pom = ball(0.05, mat);
    pom.position.y = 0.28;
    g.add(hat, pom);
  } else if (kind === "antenna") {
    const rod = cyl(0.015, 0.28, mat, 5);
    rod.position.y = 0.32;
    const tip = ball(0.05, new THREE.MeshLambertMaterial({ color: 0xd0122a }));
    tip.position.y = 0.46;
    g.add(rod, tip);
  }
  return g;
}

function packMesh(kind, color) {
  if (kind === "none") return null;
  const mat = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  if (kind === "pack") {
    const body = box(0.28, 0.32, 0.14, mat);
    body.position.set(0, 1.15, -0.16);
    g.add(body);
  } else if (kind === "satchel") {
    const bag = box(0.18, 0.16, 0.1, mat);
    bag.position.set(0.18, 0.95, 0.02);
    g.add(bag);
  } else if (kind === "bedroll") {
    const roll = cyl(0.08, 0.32, mat, 8);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 1.28, -0.16);
    g.add(roll);
  }
  return g;
}

export function createStickman(profile, scale = 1) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);

  const hip = new THREE.Group();
  hip.position.y = 0.92;
  const torso = cyl(0.045, 0.55);
  torso.position.y = 0.18;
  hip.add(torso);

  const head = new THREE.Group();
  head.position.y = 0.58;
  const skull = ball(0.16, headMat);
  head.add(skull);
  hip.add(head);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.16, 0.38, 0);
  armR.position.set(0.16, 0.38, 0);
  const limbL = cyl(0.032, 0.5);
  const limbR = cyl(0.032, 0.5);
  limbL.position.y = -0.25;
  limbR.position.y = -0.25;
  armL.add(limbL);
  armR.add(limbR);
  hip.add(armL, armR);

  const gun = new THREE.Group();
  const barrel = cyl(0.02, 0.42, ink, 5);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.2;
  const body = box(0.05, 0.05, 0.18);
  const stock = box(0.03, 0.08, 0.12);
  stock.position.set(0, -0.04, -0.12);
  gun.add(barrel, body, stock);
  gun.position.set(0.02, -0.22, 0.18);
  armR.add(gun);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.09, 0.92, 0);
  legR.position.set(0.09, 0.92, 0);
  const lL = cyl(0.038, 0.92);
  const lR = cyl(0.038, 0.92);
  lL.position.y = -0.46;
  lR.position.y = -0.46;
  legL.add(lL);
  legR.add(lR);

  const extras = new THREE.Group();
  root.add(legL, legR, hip, extras);

  const state = { t: 0, profile, face: null, hat: null, pack: null };

  function applyProfile(p) {
    state.profile = p;
    if (state.face) head.remove(state.face);
    if (state.hat) head.remove(state.hat);
    if (state.pack) extras.remove(state.pack);
    state.face = faceGroup(p.face);
    head.add(state.face);
    state.hat = hatMesh(p.hat, p.color);
    if (state.hat) head.add(state.hat);
    state.pack = packMesh(p.pack, p.color);
    if (state.pack) extras.add(state.pack);
  }

  applyProfile(profile);

  return {
    root,
    head,
    hip,
    applyProfile,
    setVisible(v) {
      root.visible = v;
    },
    pose(dt, moving, grounded, pitch, shooting) {
      state.t += dt * (moving ? 10 : 2);
      const swing = moving ? Math.sin(state.t) * 0.7 : Math.sin(state.t) * 0.04;
      legL.rotation.x = grounded ? swing : 0.35;
      legR.rotation.x = grounded ? -swing : 0.35;
      armL.rotation.x = moving ? -swing * 0.6 : 0.1;
      armR.rotation.x = shooting ? -0.4 : -0.2 - pitch * 0.15;
      armR.rotation.z = 0.15;
      gun.rotation.x = -pitch;
    },
  };
}

export function createViewmodel() {
  const group = new THREE.Group();
  group.position.set(0.28, -0.24, -0.48);
  const mat = ink;
  const barrel = cyl(0.018, 0.55, mat, 6);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, -0.28);
  const body = box(0.07, 0.07, 0.22, mat);
  const grip = box(0.05, 0.14, 0.05, mat);
  grip.position.set(0, -0.08, 0.04);
  const mag = box(0.04, 0.12, 0.06, mat);
  mag.position.set(0, -0.1, -0.04);
  group.add(barrel, body, grip, mag);
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );
  flash.position.set(0, 0.04, -0.58);
  flash.visible = false;
  group.add(flash);
  return { group, flash, kick: 0 };
}

export function createMenuStickman(profile) {
  return createStickman(profile, 1);
}
