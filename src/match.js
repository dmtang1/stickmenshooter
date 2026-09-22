import * as THREE from "three";
import { CONFIG } from "./config.js";
import { Input } from "./input.js";
import { World } from "./world.js";
import { createStickman, createViewmodel } from "./stickman.js";
import { createSfx } from "./audio.js";
import { mulberry32, pick, randRange } from "./rng.js";

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const ray = new THREE.Raycaster();

function weaponState(kind) {
  const w = CONFIG.weapons[kind];
  return { kind, mag: w.mag, reserve: w.reserve, cooldown: 0, reloading: 0 };
}

function pieceKey(piece) {
  return `${piece.type}:${piece.ix}:${piece.iy}:${piece.iz}:${piece.rot}`;
}

export class Match {
  constructor({ canvas, role, net, profile, roster, seed, localId, onHud, onEnd, onQuit }) {
    this.canvas = canvas;
    this.role = role;
    this.net = net;
    this.profile = profile;
    this.onHud = onHud;
    this.onEnd = onEnd;
    this.onQuit = onQuit;
    this.localId = localId;
    this.seed = seed;
    this.authority = role !== "client";

    this.clock = new THREE.Clock();
    this.input = new Input(canvas);
    this.sfx = createSfx();
    this.rng = mulberry32(seed);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(0xc8d6cf);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc8d6cf, 48, 160);
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.07, 400);

    const hemi = new THREE.HemisphereLight(0xf3ead6, 0x6d7c6a, 1.05);
    const sun = new THREE.DirectionalLight(0xfff4dd, 1.15);
    sun.position.set(40, 70, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    this.scene.add(hemi, sun, new THREE.AmbientLight(0xffffff, 0.16));

    this.world = new World(this.scene, seed);
    this.players = new Map();
    this.avatars = new Map();
    this.builds = new Map();
    this.buildMeshes = new Map();
    this.pickupMeshes = new Map();
    this.tracers = [];
    this.events = [];
    this.ended = false;
    this.netAcc = 0;
    this.botAcc = 0;
    this.time = 0;
    this.buildPiece = "wall";
    this.ads = 0;
    this.spectating = false;
    this.spectateId = null;
    this.lastKillerName = "";
    this.lastKillerId = null;
    this._specClicked = false;
    this.ghost = this._makeGhost();
    this.scene.add(this.ghost);

    this.viewmodel = createViewmodel();
    this.camera.add(this.viewmodel.group);
    this.scene.add(this.camera);

    this.storm = {
      cx: 0,
      cz: 0,
      radius: CONFIG.islandRadius + 18,
      nextCx: 0,
      nextCz: 0,
      nextRadius: CONFIG.storm[0].radius,
      phase: 0,
      t: 0,
      state: "wait",
      dps: 0,
    };
    this._pickNextStorm();
    this.stormMesh = this._makeStorm();
    this.scene.add(this.stormMesh.ring, this.stormMesh.next, this.stormMesh.dome);

    this._spawnPickups();
    for (const p of roster) this._addPlayer(p);

    this._onResize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    window.addEventListener("resize", this._onResize);

    if (this.net && this.role === "host") {
      this.net.on("input", (msg, from) => this._acceptInput(from, msg));
    }
    if (this.net && this.role === "client") {
      this.net.on("state", (msg) => this._applyState(msg));
      this.net.on("event", (msg) => this._playEvent(msg.event));
    }

    this.canvas.addEventListener("click", () => this.input.requestLock());
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  _addPlayer(data) {
    const dropA = this.rng() * Math.PI * 2;
    const dropR = randRange(this.rng, 20, CONFIG.islandRadius - 12);
    const player = {
      id: data.id,
      name: data.name,
      profile: data.profile,
      bot: !!data.bot,
      x: Math.cos(dropA) * dropR,
      y: CONFIG.dropHeight,
      z: Math.sin(dropA) * dropR,
      vx: 0,
      vy: -2,
      vz: 0,
      yaw: dropA + Math.PI,
      pitch: -0.38,
      hp: CONFIG.startHp,
      wood: CONFIG.startWood,
      alive: true,
      grounded: false,
      falling: true,
      buildMode: false,
      weapon: weaponState("pistol"),
      kills: 0,
      input: emptyInput(),
      poi: 0,
      strafe: 1,
      think: 0,
    };
    this.players.set(player.id, player);
    const avatar = createStickman(player.profile);
    this.scene.add(avatar.root);
    this.avatars.set(player.id, avatar);
  }

  _spawnPickups() {
    for (const p of this.world.pickups) {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.18, 0.18),
        new THREE.MeshLambertMaterial({ color: 0x14120f })
      );
      mesh.add(body);
      mesh.position.set(p.x, p.y, p.z);
      this.scene.add(mesh);
      this.pickupMeshes.set(p.id, mesh);
    }
  }

  _makeGhost() {
    const g = new THREE.Mesh(
      new THREE.BoxGeometry(CONFIG.cell, CONFIG.story, 0.18),
      new THREE.MeshBasicMaterial({
        color: 0x14120f,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      })
    );
    g.visible = false;
    return g;
  }

  _makeStorm() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(10, 10.4, 64),
      new THREE.MeshBasicMaterial({ color: 0x4a3dff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    const next = new THREE.Mesh(
      new THREE.RingGeometry(6, 6.25, 64),
      new THREE.MeshBasicMaterial({ color: 0xd0122a, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
    );
    next.rotation.x = -Math.PI / 2;
    next.position.y = 0.1;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(12, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x4a3dff,
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
      })
    );
    return { ring, next, dome };
  }

  _pickNextStorm() {
    const phase = CONFIG.storm[Math.min(this.storm.phase, CONFIG.storm.length - 1)];
    const rng = this.rng;
    const maxOff = Math.max(0, this.storm.radius - phase.radius - 4);
    const a = rng() * Math.PI * 2;
    const r = rng() * maxOff;
    this.storm.nextCx = this.storm.cx + Math.cos(a) * r;
    this.storm.nextCz = this.storm.cz + Math.sin(a) * r;
    this.storm.nextRadius = phase.radius;
    this.storm.wait = phase.wait;
    this.storm.shrink = phase.shrink;
    this.storm.dps = phase.dps;
  }

  loop() {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    if (this.authority) this.simulate(dt);
    else this.predictLocal(dt);
    this.syncVisuals(dt);
    this.drawMinimap();
    this.renderer.render(this.scene, this.camera);
    this._hud();
    requestAnimationFrame(this.loop);
  }

  simulate(dt) {
    this._updateStorm(dt);
    if (this.authority) {
      this.botAcc += dt;
      if (this.botAcc > 0.12) {
        this.botAcc = 0;
        this._thinkBots();
      }
    }
    const local = this.players.get(this.localId);
    this._updateAds(dt, local);
    if (local && !this.spectating) this._applyLocalLook(local);

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.id === this.localId) p.input = this.input.snapshot();
      this._movePlayer(p, dt);
      this._combat(p, dt);
      this._pickup(p);
      this._stormDamage(p, dt);
    }
    this._resolveBuilds();
    this._checkEnd();
    this._pollSpecInput();
    this._netSend(dt);
    this.input.lookX = 0;
    this.input.lookY = 0;
  }

  predictLocal(dt) {
    const local = this.players.get(this.localId);
    this._updateAds(dt, local);
    if (!local?.alive) {
      this._pollSpecInput();
      if (!this.spectating) this._applyLocalLook(local || { yaw: 0, pitch: 0, alive: false });
      return;
    }
    this._applyLocalLook(local);
    local.input = this.input.snapshot();
    this._movePlayer(local, dt);
    this._combat(local, dt);
    this.netAcc += dt;
    if (this.netAcc > 1 / CONFIG.netHz) {
      this.netAcc = 0;
      this.net?.sendToHost({
        t: "input",
        input: { ...local.input, buildMode: local.buildMode, piece: this.buildPiece },
        yaw: local.yaw,
        pitch: local.pitch,
      });
    }
    this.input.lookX = 0;
    this.input.lookY = 0;
  }

  _aiming(p) {
    return !!(p?.alive && p.input?.rmb && !p.buildMode);
  }

  _updateAds(dt, local) {
    const want = local?.alive && this.input.rmb && !local.buildMode ? 1 : 0;
    this.ads += (want - this.ads) * Math.min(1, dt * 12);
  }

  _applyLocalLook(local) {
    if (!local) return;
    const look = this.input.consumeLook();
    const sens = 0.0022 * (1 - this.ads * 0.58);
    local.yaw -= look.x * sens;
    local.pitch -= look.y * sens * 0.9;
    local.pitch = Math.max(-1.2, Math.min(1.2, local.pitch));
  }

  _movePlayer(p, dt) {
    const inAir = p.y > 2.2 && p.falling;
    const ads = this._aiming(p);
    let speed = inAir ? CONFIG.airSpeed : !ads && p.input.sprint ? CONFIG.sprint : CONFIG.speed;
    if (ads && !inAir) speed *= 0.62;
    let ix = (p.input.d ? 1 : 0) - (p.input.a ? 1 : 0);
    let iz = (p.input.w ? 1 : 0) - (p.input.s ? 1 : 0);
    const len = Math.hypot(ix, iz) || 1;
    ix /= len;
    iz /= len;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    const wishX = -s * iz + c * ix;
    const wishZ = -c * iz - s * ix;
    p.vx = wishX * speed;
    p.vz = wishZ * speed;
    p.vy -= CONFIG.gravity * dt * (inAir && p.input.jump ? 0.42 : 1);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    const gy = this.world.groundY(p.x, p.z, p.y, CONFIG.radius);
    const buildH = this._buildHeight(p.x, p.z, p.y);
    const floor = Math.max(gy, buildH);
    const wasFalling = p.falling;
    if (p.vy <= 0 && p.y <= floor + 0.02) {
      p.y = floor;
      p.vy = 0;
      p.grounded = true;
      p.falling = false;
      if (p.input.jump && !wasFalling) p.vy = CONFIG.jump;
    } else {
      p.grounded = false;
    }
    this.world.collide(p, CONFIG.radius, 1.7);
    this._collideBuilds(p);
  }

  _collideBuilds(p) {
    for (const b of this.builds.values()) {
      if (b.type === "floor" || b.type === "ramp") continue;
      const { min, max } = b.box;
      if (p.y + 1.7 < min.y + 0.05 || p.y > max.y - 0.05) continue;
      const nx = Math.max(min.x, Math.min(p.x, max.x));
      const nz = Math.max(min.z, Math.min(p.z, max.z));
      const dx = p.x - nx;
      const dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      const r = CONFIG.radius;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (r - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      }
    }
  }

  _buildHeight(x, z, y) {
    let h = 0;
    for (const b of this.builds.values()) {
      const { min, max } = b.box;
      if (x < min.x || x > max.x || z < min.z || z > max.z) continue;
      if (b.type === "ramp") {
        const fx = (x - min.x) / Math.max(0.01, max.x - min.x);
        const fz = (z - min.z) / Math.max(0.01, max.z - min.z);
        const t = b.rot === 0 ? fz : b.rot === 2 ? 1 - fz : b.rot === 1 ? fx : 1 - fx;
        const rh = min.y + t * CONFIG.story;
        if (y + 0.55 >= rh) h = Math.max(h, rh);
      } else if (y + 0.4 >= max.y) {
        h = Math.max(h, max.y);
      }
    }
    return h;
  }

  _combat(p, dt) {
    const w = p.weapon;
    const spec = CONFIG.weapons[w.kind];
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = spec.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
    }
    for (const code of p.input.queued || []) {
      if (code === "KeyB") p.buildMode = !p.buildMode;
      if (code === "KeyQ") {
        p.buildMode = true;
        this.buildPiece = "wall";
      }
      if (code === "KeyZ") {
        p.buildMode = true;
        this.buildPiece = "floor";
      }
      if (code === "KeyC") {
        p.buildMode = true;
        this.buildPiece = "ramp";
      }
      if (code === "KeyR" && w.reserve > 0 && w.mag < spec.mag) w.reloading = 1.15;
      if (p.id === this.localId) {
        if (code === "KeyQ") this.buildPiece = "wall";
        if (code === "KeyZ") this.buildPiece = "floor";
        if (code === "KeyC") this.buildPiece = "ramp";
      }
    }
    if (p.id === this.localId && p.input.queued?.length) {
      if (p.buildMode) this.buildPiece = this.buildPiece;
    }
    if (!p.buildMode && p.input.lmb && w.cooldown <= 0 && w.mag > 0 && w.reloading <= 0) {
      this._shoot(p, this._aiming(p));
      w.mag -= 1;
      w.cooldown = 60 / spec.rpm;
      if (w.mag <= 0 && w.reserve > 0) w.reloading = 1.15;
    }
  }

  _eye(p, target) {
    target.set(p.x, p.y + CONFIG.eye, p.z);
    return target;
  }

  _dir(p, target) {
    const cp = Math.cos(p.pitch);
    target.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
    return target;
  }

  _shoot(p, aiming = false) {
    const spec = CONFIG.weapons[p.weapon.kind];
    const origin = this._eye(p, tmp.clone());
    const spread = spec.spread * (aiming ? CONFIG.adsSpread : 1);
    if (p.id === this.localId) {
      this.viewmodel.kick = aiming ? 0.035 : 0.08;
      this.viewmodel.flash.visible = true;
      this.sfx.shoot();
    }
    for (let i = 0; i < spec.pellets; i++) {
      const dir = this._dir(p, tmp2.clone());
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      const hit = this._hitscan(p, origin, dir, 160);
      this._tracer(origin, hit.point);
      if (hit.player && this.authority) this._hurt(hit.player, spec.dmg, p);
      if (hit.tree && this.authority) this._chop(hit.tree, p);
      if (hit.build && this.authority) this._breakBuild(hit.build, spec.dmg);
    }
  }

  _hitscan(owner, origin, dir, dist) {
    const far = origin.clone().addScaledVector(dir, dist);
    let best = { point: far, dist };
    for (const p of this.players.values()) {
      if (p.id === owner.id || !p.alive) continue;
      const t = rayVsCapsule(origin, dir, p, CONFIG.radius, 1.7);
      if (t > 0 && t < best.dist) best = { point: origin.clone().addScaledVector(dir, t), dist: t, player: p };
    }
    for (const tree of this.world.trees) {
      if (!tree.alive) continue;
      const t = rayVsAabb(origin, dir, tree.min, tree.max);
      if (t > 0 && t < best.dist) best = { point: origin.clone().addScaledVector(dir, t), dist: t, tree };
    }
    for (const b of this.builds.values()) {
      const t = rayVsAabb(origin, dir, b.box.min, b.box.max);
      if (t > 0 && t < best.dist) best = { point: origin.clone().addScaledVector(dir, t), dist: t, build: b };
    }
    for (const c of this.world.colliders) {
      if (c.hp !== undefined) continue;
      const t = rayVsAabb(origin, dir, c.min, c.max);
      if (t > 0 && t < best.dist) best = { point: origin.clone().addScaledVector(dir, t), dist: t };
    }
    return best;
  }

  _hurt(victim, dmg, attacker) {
    if (!victim.alive) return;
    victim.hp -= dmg;
    if (victim.id === this.localId) this.sfx.hurt();
    if (attacker.id === this.localId) {
      this.sfx.hit();
      this.onHud?.({ hitmarker: true });
    }
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      attacker.kills += 1;
      this._event({ type: "kill", killer: attacker.name, victim: victim.name });
      const av = this.avatars.get(victim.id);
      if (av) av.root.visible = false;
      if (victim.id === this.localId) {
        this.lastKillerName = attacker.name;
        this.lastKillerId = attacker.id;
      }
    }
  }

  _chop(tree, p) {
    tree.hp -= 22;
    p.wood = Math.min(999, p.wood + 8);
    if (tree.hp <= 0 && tree.alive) {
      tree.alive = false;
      tree.trunk.visible = false;
      tree.top.visible = false;
      p.wood = Math.min(999, p.wood + CONFIG.treeWood);
    }
  }

  _pickup(p) {
    for (const loot of this.world.pickups) {
      if (loot.taken) continue;
      if (Math.hypot(p.x - loot.x, p.z - loot.z) < 1.4 && Math.abs(p.y - loot.y) < 2) {
        loot.taken = true;
        p.weapon = weaponState(loot.kind);
        const mesh = this.pickupMeshes.get(loot.id);
        if (mesh) mesh.visible = false;
      }
    }
  }

  _stormDamage(p, dt) {
    const d = Math.hypot(p.x - this.storm.cx, p.z - this.storm.cz);
    if (d > this.storm.radius - 0.4) {
      p.hp -= this.storm.dps * dt;
      if (p.hp <= 0 && p.alive) {
        p.hp = 0;
        p.alive = false;
        this._event({ type: "storm", victim: p.name });
        if (p.id === this.localId) {
          this.lastKillerName = "The storm";
          this.lastKillerId = null;
        }
      }
    }
  }

  _updateStorm(dt) {
    this.storm.t += dt;
    if (this.storm.state === "wait" && this.storm.t >= this.storm.wait) {
      this.storm.state = "shrink";
      this.storm.t = 0;
      this.sfx.storm();
    } else if (this.storm.state === "shrink") {
      const k = Math.min(1, this.storm.t / this.storm.shrink);
      this.storm.radius += (this.storm.nextRadius - this.storm.radius) * Math.min(1, dt / Math.max(0.01, this.storm.shrink * (1 - k) + 0.01));
      this.storm.cx += (this.storm.nextCx - this.storm.cx) * Math.min(1, dt * 0.35);
      this.storm.cz += (this.storm.nextCz - this.storm.cz) * Math.min(1, dt * 0.35);
      if (k >= 1) {
        this.storm.radius = this.storm.nextRadius;
        this.storm.cx = this.storm.nextCx;
        this.storm.cz = this.storm.nextCz;
        this.storm.phase += 1;
        this.storm.state = "wait";
        this.storm.t = 0;
        if (this.storm.phase < CONFIG.storm.length) this._pickNextStorm();
      }
    }
        const r = Math.max(0.8, this.storm.radius);
    this.stormMesh.ring.position.set(this.storm.cx, 0.08, this.storm.cz);
    this.stormMesh.ring.scale.setScalar(r / 10);
    const nr = Math.max(0.8, this.storm.nextRadius);
    this.stormMesh.next.position.set(this.storm.nextCx, 0.1, this.storm.nextCz);
    this.stormMesh.next.scale.setScalar(nr / 6);
    this.stormMesh.dome.position.set(this.storm.cx, 0, this.storm.cz);
    this.stormMesh.dome.scale.setScalar(r / 12);
  }

  _resolveBuilds() {
    const local = this.players.get(this.localId);
    let previewed = false;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.input?.piece) p.piece = p.input.piece;
      if (typeof p.input?.buildMode === "boolean" && p.id !== this.localId) p.buildMode = p.input.buildMode;
      if (!p.buildMode) {
        p._builtThisClick = false;
        continue;
      }
      const origin = this._eye(p, new THREE.Vector3());
      const dir = this._dir(p, new THREE.Vector3());
      const probe = origin.clone().addScaledVector(dir, 5.5);
      const gy = this.world.groundY(probe.x, probe.z, probe.y + 2, 0.2);
      const iy = Math.max(0, Math.round(Math.max(gy, probe.y) / CONFIG.story));
      const ix = Math.round(probe.x / CONFIG.cell);
      const iz = Math.round(probe.z / CONFIG.cell);
      const rot = Math.round((((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
      const type = p.id === this.localId ? this.buildPiece : p.input?.piece || "wall";
      const preview = { type, ix, iy, iz, rot };
      if (p.id === this.localId) {
        this._ghostAt(preview);
        previewed = true;
      }
      if (p.input.lmb && p.wood >= CONFIG.buildCost && this.authority) {
        if (!p._builtThisClick) p._builtThisClick = this._place(preview, p);
      } else p._builtThisClick = false;
    }
    this.ghost.visible = !!(local?.alive && local.buildMode && previewed);
  }

  _ghostAt(piece) {
    const box = pieceBox(piece);
    this.ghost.visible = true;
    this.ghost.geometry.dispose();
    const s = box.max.clone().sub(box.min);
    this.ghost.geometry = new THREE.BoxGeometry(Math.max(0.18, s.x), Math.max(0.18, s.y), Math.max(0.18, s.z));
    this.ghost.position.copy(box.min.clone().add(box.max).multiplyScalar(0.5));
    this.ghost.rotation.set(0, 0, 0);
  }

  _place(piece, owner) {
    const key = pieceKey(piece);
    if (this.builds.has(key)) return false;
    if (Math.hypot(piece.ix * CONFIG.cell, piece.iz * CONFIG.cell) > CONFIG.islandRadius - 2) return false;
    owner.wood -= CONFIG.buildCost;
    const box = pieceBox(piece);
    const rec = { ...piece, hp: 140, box, owner: owner.id };
    this.builds.set(key, rec);
    this._meshFor(key, rec);
    if (owner.id === this.localId) this.sfx.build();
    return true;
  }

  _meshFor(key, rec) {
    const s = rec.box.max.clone().sub(rec.box.min);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.12, s.x), Math.max(0.12, s.y), Math.max(0.12, s.z)),
      new THREE.MeshLambertMaterial({ color: 0xf3ead6 })
    );
    mesh.position.copy(rec.box.min.clone().add(rec.box.max).multiplyScalar(0.5));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x14120f })));
    this.scene.add(mesh);
    this.buildMeshes.set(key, mesh);
  }

  _breakBuild(b, dmg) {
    b.hp -= dmg;
    if (b.hp <= 0) {
      const key = pieceKey(b);
      const mesh = this.buildMeshes.get(key);
      if (mesh) {
        this.scene.remove(mesh);
        this.buildMeshes.delete(key);
      }
      this.builds.delete(key);
    }
  }

  _thinkBots() {
    const living = [...this.players.values()].filter((p) => p.alive);
    for (const bot of living) {
      if (!bot.bot) continue;
      const inStorm = Math.hypot(bot.x - this.storm.cx, bot.z - this.storm.cz) < this.storm.radius - 6;
      let target = null;
      let best = 48;
      for (const other of living) {
        if (other.id === bot.id) continue;
        const d = Math.hypot(other.x - bot.x, other.z - bot.z);
        if (d < best) {
          const origin = this._eye(bot, new THREE.Vector3());
          const dir = new THREE.Vector3(other.x - bot.x, other.y + 1.2 - (bot.y + CONFIG.eye), other.z - bot.z).normalize();
          const hit = this._hitscan(bot, origin, dir, d + 0.2);
          if (hit.player === other || d < 8) {
            best = d;
            target = other;
          }
        }
      }
      bot.input = emptyInput();
      if (bot.falling || this.time < 10) {
        const poi = this.world.pois[bot.poi % this.world.pois.length];
        bot.yaw = Math.atan2(-(poi.x - bot.x), -(poi.z - bot.z));
        bot.input.w = true;
        bot.input.jump = bot.falling;
        bot.input.sprint = !bot.falling;
        continue;
      }
      if (!inStorm) {
        bot.yaw = Math.atan2(-(this.storm.cx - bot.x), -(this.storm.cz - bot.z));
        bot.input.w = true;
        bot.input.sprint = true;
        bot.input.jump = bot.falling;
        continue;
      }
      if (target) {
        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const dy = target.y + 1.2 - (bot.y + CONFIG.eye);
        bot.yaw = Math.atan2(-dx, -dz) + (this.rng() - 0.5) * 0.28;
        bot.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (this.rng() - 0.5) * 0.08;
        bot.input.w = best > 11;
        bot.input.s = best < 5;
        bot.input.a = bot.strafe > 0;
        bot.input.d = bot.strafe < 0;
        if (this.rng() < 0.08) bot.strafe *= -1;
        bot.input.lmb = best < 34 && this.rng() < 0.32;
        if (bot.hp < 45 && bot.wood >= CONFIG.buildCost && this.rng() < 0.2) {
          bot.buildMode = true;
          this._place(
            {
              type: "wall",
              ix: Math.round(bot.x / CONFIG.cell),
              iy: Math.round(bot.y / CONFIG.story),
              iz: Math.round(bot.z / CONFIG.cell),
              rot: Math.round(bot.yaw / (Math.PI / 2)) & 3,
            },
            bot
          );
          bot.buildMode = false;
        }
      } else {
        const poi = this.world.pois[bot.poi % this.world.pois.length];
        if (Math.hypot(bot.x - poi.x, bot.z - poi.z) < 4) bot.poi += 1;
        bot.yaw = Math.atan2(-(poi.x - bot.x), -(poi.z - bot.z));
        bot.input.w = true;
        bot.pitch = 0;
      }
    }
  }

  beginSpectate() {
    this.spectating = true;
    const living = [...this.players.values()].filter((p) => p.alive);
    const killer = living.find((p) => p.id === this.lastKillerId);
    this.spectateId = (killer || living[0])?.id || null;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  cycleSpectate(dir = 1) {
    const living = [...this.players.values()].filter((p) => p.alive);
    if (!living.length) {
      this.spectateId = null;
      return;
    }
    const i = Math.max(0, living.findIndex((p) => p.id === this.spectateId));
    this.spectateId = living[(i + dir + living.length * 8) % living.length].id;
  }

  _pollSpecInput() {
    if (!this.spectating) return;
    if (this.input.lmb && !this._specClicked) {
      this._specClicked = true;
      if (!this.input.uiClick) this.cycleSpectate(1);
    }
    if (!this.input.lmb) this._specClicked = false;
  }

  _checkEnd() {
    if (this.ended) return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length <= 1) {
      this.ended = true;
      const winner = alive[0];
      const local = this.players.get(this.localId);
      if (winner?.id === this.localId) this.sfx.win();
      else this.sfx.lose();
      this._event({ type: "end", winner: winner?.name || "Nobody", winId: winner?.id });
      setTimeout(() => {
        this.onEnd?.({
          win: winner?.id === this.localId,
          winner: winner?.name || "Nobody",
          kills: local?.kills || 0,
        });
      }, 900);
    }
  }

  _event(event) {
    this.events.push({ ...event, at: this.time });
    this._playEvent(event);
    if (this.role === "host") this.net?.broadcast({ t: "event", event });
  }

  _playEvent(event) {
    if (event.type === "kill") this.onHud?.({ feed: `${event.killer} snapped ${event.victim}` });
    if (event.type === "storm") this.onHud?.({ feed: `${event.victim} was inked by the storm` });
    if (event.type === "end") this.onHud?.({ banner: event.winId === this.localId ? "VICTORY" : "ELIMINATED" });
  }

  _netSend(dt) {
    if (this.role !== "host" || !this.net) return;
    this.netAcc += dt;
    if (this.netAcc < 1 / CONFIG.netHz) return;
    this.netAcc = 0;
    this.net.broadcast({ t: "state", state: this._serialize() });
  }

  _serialize() {
    return {
      t: this.time,
      storm: { ...this.storm },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        hp: p.hp,
        wood: p.wood,
        alive: p.alive,
        falling: p.falling,
        grounded: p.grounded,
        buildMode: p.buildMode,
        weapon: p.weapon,
        kills: p.kills,
      })),
      builds: [...this.builds.values()].map((b) => ({
        type: b.type,
        ix: b.ix,
        iy: b.iy,
        iz: b.iz,
        rot: b.rot,
        hp: b.hp,
      })),
      pickups: this.world.pickups.map((p) => ({ id: p.id, taken: p.taken })),
      trees: this.world.trees.map((t, i) => ({ i, alive: t.alive, hp: t.hp })),
    };
  }

  _applyState(msg) {
    const s = msg.state;
    this.storm.cx = s.storm.cx;
    this.storm.cz = s.storm.cz;
    this.storm.radius = s.storm.radius;
    this.storm.nextCx = s.storm.nextCx;
    this.storm.nextCz = s.storm.nextCz;
    this.storm.nextRadius = s.storm.nextRadius;
    this.storm.state = s.storm.state;
    this.storm.t = s.storm.t;
    this.storm.phase = s.storm.phase;
    this.storm.dps = s.storm.dps;
    for (const sp of s.players) {
      const p = this.players.get(sp.id);
      if (!p) continue;
      if (sp.id === this.localId) {
        p.hp = sp.hp;
        p.wood = sp.wood;
        p.alive = sp.alive;
        p.weapon = sp.weapon;
        p.kills = sp.kills;
        if (Math.hypot(p.x - sp.x, p.z - sp.z) > 3.5) {
          p.x = sp.x;
          p.y = sp.y;
          p.z = sp.z;
        }
      } else {
        Object.assign(p, sp);
      }
    }
    const seen = new Set();
    for (const b of s.builds) {
      const key = pieceKey(b);
      seen.add(key);
      if (!this.builds.has(key)) {
        const rec = { ...b, box: pieceBox(b) };
        this.builds.set(key, rec);
        this._meshFor(key, rec);
      }
    }
    for (const key of [...this.builds.keys()]) {
      if (!seen.has(key)) {
        const mesh = this.buildMeshes.get(key);
        if (mesh) this.scene.remove(mesh);
        this.buildMeshes.delete(key);
        this.builds.delete(key);
      }
    }
    for (const loot of s.pickups) {
      const local = this.world.pickups.find((p) => p.id === loot.id);
      if (local) {
        local.taken = loot.taken;
        const mesh = this.pickupMeshes.get(loot.id);
        if (mesh) mesh.visible = !loot.taken;
      }
    }
    if (s.trees) {
      for (const t of s.trees) {
        const tree = this.world.trees[t.i];
        if (!tree) continue;
        tree.hp = t.hp;
        tree.alive = t.alive;
        tree.trunk.visible = t.alive;
        tree.top.visible = t.alive;
      }
    }
  }

  _acceptInput(from, msg) {
    const id = from.replace(/^stickroyale-/, "");
    let p = this.players.get(from);
    if (!p) p = [...this.players.values()].find((pl) => pl.id === from || pl.peerId === from);
    if (!p || p.bot) return;
    p.input = msg.input;
    p.yaw = msg.yaw;
    p.pitch = msg.pitch;
  }

  _tracer(from, to) {
    const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x14120f, transparent: true, opacity: 0.7 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
  }

  syncVisuals(dt) {
    const local = this.players.get(this.localId);
    for (const t of this.tracers) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life * 8);
    }
    this.tracers = this.tracers.filter((t) => {
      if (t.life > 0) return true;
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      return false;
    });
    const spec = CONFIG.weapons[local?.weapon.kind || "pistol"];
    const fov = CONFIG.fov + ((spec.adsFov || 50) - CONFIG.fov) * this.ads;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.viewmodel.flash.visible) this.viewmodel.flash.visible = Math.random() > 0.4 && this.viewmodel.kick > 0.02;
    this.viewmodel.kick *= 0.8;
    const a = this.ads;
    this.viewmodel.group.position.set(
      0.28 * (1 - a) + 0.02 * a,
      -0.24 * (1 - a) + -0.12 * a + this.viewmodel.kick,
      -0.48 * (1 - a) + -0.4 * a + this.viewmodel.kick * 0.4
    );
    this.viewmodel.group.rotation.z = (1 - a) * 0.04;
    this.viewmodel.group.visible = !!(local?.alive);
    if (this.spectating) {
      const follow = this.players.get(this.spectateId);
      if (!follow?.alive) this.cycleSpectate(1);
    }

    for (const p of this.players.values()) {
      const av = this.avatars.get(p.id);
      if (!av) continue;
      av.root.visible = p.alive && p.id !== this.localId;
      av.root.position.set(p.x, p.y, p.z);
      av.root.rotation.y = p.yaw + Math.PI;
      av.pose(dt, Math.hypot(p.vx || 0, p.vz || 0) > 0.4, p.grounded, p.pitch, p.input?.lmb);
    }

    this.camera.rotation.order = "YXZ";
    const follow = this.spectating ? this.players.get(this.spectateId) : null;
    if (follow?.alive) {
      const cp = Math.cos(follow.pitch);
      const dx = -Math.sin(follow.yaw) * cp;
      const dy = Math.sin(follow.pitch);
      const dz = -Math.cos(follow.yaw) * cp;
      this.camera.position.set(
        follow.x - dx * 4.4,
        follow.y + CONFIG.eye + 1.05 - dy * 4.4,
        follow.z - dz * 4.4
      );
      this.camera.lookAt(follow.x, follow.y + CONFIG.eye, follow.z);
    } else if (local) {
      this.camera.position.set(local.x, local.y + CONFIG.eye, local.z);
      this.camera.rotation.y = local.yaw;
      this.camera.rotation.x = local.pitch;
      if (!local.alive) {
        this.camera.position.y += 1.4;
        this.camera.rotation.x = -0.25;
      }
    }

    for (const p of this.world.pickups) {
      const mesh = this.pickupMeshes.get(p.id);
      if (mesh && !p.taken) {
        mesh.position.y = 0.55 + Math.sin(this.time * 3 + p.x) * 0.1;
        mesh.rotation.y += dt * 1.4;
      }
    }
  }

  drawMinimap() {
    const c = document.getElementById("minimap");
    if (!c) return;
    const g = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#efe7d6";
    g.fillRect(0, 0, w, h);
    const to = (x, z) => [w / 2 + (x / CONFIG.islandRadius) * (w * 0.42), h / 2 + (z / CONFIG.islandRadius) * (h * 0.42)];
    g.strokeStyle = "#14120f";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#4a3dff";
    g.beginPath();
    const [sx, sy] = to(this.storm.cx, this.storm.cz);
    g.arc(sx, sy, (this.storm.radius / CONFIG.islandRadius) * (w * 0.42), 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#d0122a";
    g.beginPath();
    const [nx, ny] = to(this.storm.nextCx, this.storm.nextCz);
    g.arc(nx, ny, (this.storm.nextRadius / CONFIG.islandRadius) * (w * 0.42), 0, Math.PI * 2);
    g.stroke();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const [px, py] = to(p.x, p.z);
      g.fillStyle = p.id === this.localId ? "#d0122a" : "#14120f";
      g.fillRect(px - 2, py - 2, 4, 4);
    }
  }

  _hud() {
    const local = this.players.get(this.localId);
    const alive = [...this.players.values()].filter((p) => p.alive).length;
    const remain =
      this.storm.state === "wait"
        ? Math.max(0, this.storm.wait - this.storm.t)
        : Math.max(0, this.storm.shrink - this.storm.t);
    this.onHud?.({
      alive,
      storm: `${this.storm.state === "wait" ? "closes" : "shrinking"} ${remain.toFixed(0)}s`,
      hp: Math.max(0, Math.ceil(local?.hp || 0)),
      wood: local?.wood || 0,
      weapon: CONFIG.weapons[local?.weapon.kind || "pistol"].name,
      ammo: `${local?.weapon.mag || 0} / ${local?.weapon.reserve || 0}`,
      build: local?.buildMode,
      aim: this.ads > 0.35 && !local?.buildMode && local?.alive,
      piece: this.buildPiece,
      deadPrompt: !!(local && !local.alive && !this.spectating && !this.ended),
      deathSub: this.lastKillerName
        ? this.lastKillerName === "The storm"
          ? "The storm inked you."
          : `${this.lastKillerName} snapped you.`
        : "The round is still going.",
      spectateName: this.spectating ? this.players.get(this.spectateId)?.name || "" : "",
    });
  }

  dispose() {
    this.running = false;
    this.input.dispose();
    window.removeEventListener("resize", this._onResize);
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
  }
}

function emptyInput() {
  return { w: false, a: false, s: false, d: false, jump: false, sprint: false, crouch: false, lmb: false, rmb: false, queued: [] };
}

function pieceBox(piece) {
  const x = piece.ix * CONFIG.cell;
  const y = piece.iy * CONFIG.story;
  const z = piece.iz * CONFIG.cell;
  if (piece.type === "floor") {
    return {
      min: new THREE.Vector3(x - CONFIG.cell / 2, y, z - CONFIG.cell / 2),
      max: new THREE.Vector3(x + CONFIG.cell / 2, y + 0.18, z + CONFIG.cell / 2),
    };
  }
  if (piece.type === "ramp") {
    return {
      min: new THREE.Vector3(x - CONFIG.cell / 2, y, z - CONFIG.cell / 2),
      max: new THREE.Vector3(x + CONFIG.cell / 2, y + CONFIG.story, z + CONFIG.cell / 2),
    };
  }
  if (piece.rot % 2 === 0) {
    return {
      min: new THREE.Vector3(x - CONFIG.cell / 2, y, z - 0.12),
      max: new THREE.Vector3(x + CONFIG.cell / 2, y + CONFIG.story, z + 0.12),
    };
  }
  return {
    min: new THREE.Vector3(x - 0.12, y, z - CONFIG.cell / 2),
    max: new THREE.Vector3(x + 0.12, y + CONFIG.story, z + CONFIG.cell / 2),
  };
}

function rayVsCapsule(origin, dir, p, r, h) {
  const cx = p.x;
  const cz = p.z;
  const cy0 = p.y + r;
  const cy1 = p.y + h - r;
  let closest = 1e9;
  for (const cy of [cy0, Math.max(cy0, Math.min(cy1, origin.y)), cy1]) {
    const ocx = origin.x - cx;
    const ocy = origin.y - cy;
    const ocz = origin.z - cz;
    const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < closest) closest = t;
    }
  }
  return closest === 1e9 ? -1 : closest;
}

function rayVsAabb(origin, dir, min, max) {
  let tmin = 0;
  let tmax = 200;
  for (const axis of ["x", "y", "z"]) {
    const inv = 1 / (dir[axis] || 1e-8);
    let t0 = (min[axis] - origin[axis]) * inv;
    let t1 = (max[axis] - origin[axis]) * inv;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return -1;
  }
  return tmin;
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
