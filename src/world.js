import * as THREE from "three";
import { CONFIG } from "./config.js";
import { mulberry32, randRange, pick } from "./rng.js";

const paper = new THREE.MeshLambertMaterial({ color: 0xf3ead6 });
const ink = new THREE.LineBasicMaterial({ color: 0x14120f });
const wood = new THREE.MeshLambertMaterial({ color: 0x6d4c2f });
const leaf = new THREE.MeshLambertMaterial({ color: 0x2f5d50 });
const waterMat = new THREE.MeshLambertMaterial({ color: 0x8fb9c4 });
const sand = new THREE.MeshLambertMaterial({ color: 0xd8c39a });
const accent = new THREE.MeshLambertMaterial({ color: 0xd0122a });

function edgedBox(w, h, d, mat = paper) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), ink);
  mesh.add(edges);
  return mesh;
}

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.colliders = [];
    this.trees = [];
    this.pois = [];
    this.pickups = [];
    this.radius = CONFIG.islandRadius;
    this._build();
  }

  _addBox(x, y, z, w, h, d, mat) {
    const mesh = edgedBox(w, h, d, mat);
    mesh.position.set(x, y + h / 2, z);
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
      mesh,
    });
    return mesh;
  }

  _build() {
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, 1.4, 64), sand);
    ground.position.y = -0.7;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 48), waterMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.85;
    this.scene.add(sea);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.radius - 0.6, this.radius + 0.2, 64),
      new THREE.MeshBasicMaterial({ color: 0x14120f, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    this._district(0, 0, "plaza");
    this._district(-38, -18, "boxes");
    this._district(34, -28, "ramps");
    this._district(-22, 40, "grove");
    this._district(42, 32, "tower");
    this._scatterTrees();
    this._scatterLoot();
  }

  _district(cx, cz, kind) {
    this.pois.push(new THREE.Vector3(cx, 0, cz));
    if (kind === "plaza") {
      this._addBox(cx, 0, cz, 14, 0.4, 14, paper);
      this._addBox(cx, 0.4, cz, 1.2, 4.5, 1.2, accent);
    } else if (kind === "boxes") {
      for (let i = 0; i < 6; i++) {
        const x = cx + randRange(this.rng, -12, 12);
        const z = cz + randRange(this.rng, -12, 12);
        const w = pick(this.rng, [4, 6, 8]);
        const d = pick(this.rng, [4, 6]);
        const h = pick(this.rng, [3, 4.5, 6]);
        this._addBox(x, 0, z, w, h, d);
        if (this.rng() > 0.5) this._addBox(x + w / 2 + 0.1, 0, z, 0.25, h, d);
      }
    } else if (kind === "ramps") {
      for (let i = 0; i < 5; i++) {
        const x = cx + i * 5 - 10;
        const ramp = edgedBox(4, 0.25, 6, paper);
        ramp.position.set(x, 1.2, cz);
        ramp.rotation.x = -0.5;
        this.scene.add(ramp);
        this.colliders.push({
          min: new THREE.Vector3(x - 2, 0, cz - 3),
          max: new THREE.Vector3(x + 2, 2.6, cz + 3),
          mesh: ramp,
          ramp: true,
        });
      }
      this._addBox(cx + 12, 0, cz, 6, 6, 6);
    } else if (kind === "grove") {
      for (let i = 0; i < 10; i++) {
        this._tree(cx + randRange(this.rng, -16, 16), cz + randRange(this.rng, -16, 16));
      }
    } else if (kind === "tower") {
      this._addBox(cx, 0, cz, 5, 12, 5);
      this._addBox(cx, 12, cz, 7, 0.35, 7);
      this._addBox(cx + 4.5, 0, cz, 0.4, 12, 3);
    }
  }

  _tree(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.2, 6), wood);
    trunk.position.set(x, 1.1, z);
    trunk.castShadow = true;
    const top = new THREE.Mesh(new THREE.SphereGeometry(1.15, 8, 6), leaf);
    top.position.set(x, 2.6, z);
    top.castShadow = true;
    this.scene.add(trunk, top);
    const tree = {
      x,
      z,
      hp: 60,
      alive: true,
      trunk,
      top,
      min: new THREE.Vector3(x - 0.35, 0, z - 0.35),
      max: new THREE.Vector3(x + 0.35, 2.2, z + 0.35),
    };
    this.trees.push(tree);
    this.colliders.push(tree);
  }

  _scatterTrees() {
    for (let i = 0; i < 28; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 18 + this.rng() * (this.radius - 28);
      this._tree(Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  _scatterLoot() {
    const kinds = ["rifle", "shotgun", "sniper", "rifle", "shotgun"];
    for (let i = 0; i < 16; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 8 + this.rng() * (this.radius - 16);
      const kind = kinds[i % kinds.length];
      this.pickups.push({
        id: `p${i}`,
        kind,
        x: Math.cos(a) * r,
        y: 0.6,
        z: Math.sin(a) * r,
        taken: false,
      });
    }
  }

  heightAt(x, z) {
    let h = 0;
    for (const c of this.colliders) {
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) {
        h = Math.max(h, c.max.y);
      }
    }
    return h;
  }

  collide(pos, radius, height) {
    const minY = pos.y;
    const maxY = pos.y + height;
    for (const c of this.colliders) {
      if (!c.alive && c.alive === false) continue;
      if (maxY < c.min.y + 0.02 || minY > c.max.y - 0.02) continue;
      const nx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
      const nz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (radius - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
    const dist = Math.hypot(pos.x, pos.z);
    if (dist > this.radius - radius) {
      const s = (this.radius - radius) / dist;
      pos.x *= s;
      pos.z *= s;
    }
  }

  groundY(x, z, y, radius) {
    let best = 0;
    for (const c of this.colliders) {
      if (c.alive === false) continue;
      if (x + radius < c.min.x || x - radius > c.max.x || z + radius < c.min.z || z - radius > c.max.z) continue;
      if (y + 0.35 >= c.max.y && y - c.max.y < 1.2) best = Math.max(best, c.max.y);
    }
    return best;
  }
}
