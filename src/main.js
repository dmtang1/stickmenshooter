import "./style.css";
import * as THREE from "three";
import { CONFIG, DEFAULT_PROFILE } from "./config.js";
import { Match } from "./match.js";
import { Net } from "./net.js";
import { createStickman } from "./stickman.js";
import { pick } from "./rng.js";

const canvas = document.getElementById("view");
const previewCanvas = document.getElementById("menu-preview");

const screens = {
  menu: document.getElementById("screen-menu"),
  customize: document.getElementById("screen-customize"),
  join: document.getElementById("screen-join"),
  lobby: document.getElementById("screen-lobby"),
  hud: document.getElementById("hud"),
  end: document.getElementById("screen-end"),
};

function show(name) {
  for (const [key, el] of Object.entries(screens)) {
    if (name === "customize" && key === "menu") {
      el.classList.remove("hidden");
      continue;
    }
    el.classList.toggle("hidden", key !== name);
  }
  if (name === "hud") {
    screens.menu.classList.add("hidden");
    screens.customize.classList.add("hidden");
    screens.join.classList.add("hidden");
    screens.lobby.classList.add("hidden");
    screens.end.classList.add("hidden");
    screens.hud.classList.remove("hidden");
  }
}

function loadProfile() {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem("stickroyale-profile") || "{}") };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(p) {
  localStorage.setItem("stickroyale-profile", JSON.stringify(p));
}

let profile = loadProfile();
let net = null;
let match = null;
let lobby = { players: [], host: false, code: "" };
let feed = [];
let preview;

function mountPreview() {
  preview = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: false });
  preview.setClearColor(0xefe7d6);
  preview.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(2.4, 1.6, 4.2);
  camera.lookAt(0, 1.1, 0);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6d6458, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const man = createStickman(profile);
  scene.add(man.root);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 24),
    new THREE.MeshLambertMaterial({ color: 0xe7dcc4 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  let t = 0;
  const loop = () => {
    if (!preview.running) {
      preview._raf = requestAnimationFrame(loop);
      return;
    }
    const rect = previewCanvas.parentElement.getBoundingClientRect();
    if (rect.width && rect.height) {
      preview.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }
    t += 0.016;
    man.root.rotation.y = Math.sin(t * 0.4) * 0.35;
    man.pose(0.016, false, true, 0, false);
    const sig = JSON.stringify(profile);
    if (preview._sig !== sig) {
      preview._sig = sig;
      man.applyProfile(profile);
    }
    preview.render(scene, camera);
    preview._raf = requestAnimationFrame(loop);
  };
  loop();
  preview.man = man;
  preview.running = true;
}

function chips(el, options, key) {
  el.innerHTML = "";
  for (const opt of options) {
    const b = document.createElement("button");
    b.className = "chip" + (profile[key] === opt ? " active" : "");
    b.textContent = opt;
    b.onclick = () => {
      profile[key] = opt;
      saveProfile(profile);
      chips(el, options, key);
    };
    el.appendChild(b);
  }
}

function swatches() {
  const el = document.getElementById("color-options");
  el.innerHTML = "";
  for (const c of CONFIG.colors) {
    const b = document.createElement("button");
    b.className = "swatch" + (profile.color === c ? " active" : "");
    b.style.background = c;
    b.onclick = () => {
      profile.color = c;
      saveProfile(profile);
      swatches();
    };
    el.appendChild(b);
  }
}

function refreshCustomize() {
  document.getElementById("name-input").value = profile.name;
  chips(document.getElementById("face-options"), CONFIG.faces, "face");
  chips(document.getElementById("hat-options"), CONFIG.hats, "hat");
  chips(document.getElementById("pack-options"), CONFIG.packs, "pack");
  swatches();
}

document.getElementById("name-input").addEventListener("input", (e) => {
  profile.name = e.target.value.toUpperCase().slice(0, 14) || "STICK";
  saveProfile(profile);
});

document.getElementById("btn-customize").onclick = () => {
  refreshCustomize();
  show("customize");
};
document.getElementById("btn-custom-back").onclick = () => show("menu");
document.getElementById("btn-join-back").onclick = () => show("menu");
document.getElementById("btn-join").onclick = () => {
  document.getElementById("join-error").textContent = "";
  show("join");
};

function botProfile(i) {
  const rng = Math.random;
  return {
    name: CONFIG.botNames[i % CONFIG.botNames.length],
    face: pick(rng, CONFIG.faces),
    hat: pick(rng, CONFIG.hats),
    pack: pick(rng, CONFIG.packs),
    color: pick(rng, CONFIG.colors),
  };
}

function makeRoster(humans) {
  const roster = humans.map((h) => ({ ...h, bot: false }));
  let i = 0;
  while (roster.length < CONFIG.maxPlayers) {
    roster.push({
      id: `bot-${i}`,
      name: CONFIG.botNames[i % CONFIG.botNames.length],
      profile: botProfile(i),
      bot: true,
    });
    i += 1;
  }
  return roster;
}

function startMatch({ role, roster, seed, localId }) {
  if (match) match.dispose();
  if (preview) preview.running = false;
  document.body.classList.add("playing");
  show("hud");
  feed = [];
  document.getElementById("kill-feed").innerHTML = "";
  document.getElementById("pause").classList.add("hidden");
  document.getElementById("death-choice").classList.add("hidden");
  document.getElementById("spec-bar").classList.add("hidden");
  document.getElementById("banner").classList.add("hidden");
  document.body.classList.remove("dead", "watching");
  match = new Match({
    canvas,
    role,
    net,
    profile,
    roster,
    seed,
    localId,
    onHud: updateHud,
    onEnd: endMatch,
  });
}

function updateHud(h) {
  if (h.alive !== undefined) document.getElementById("alive-count").textContent = h.alive;
  if (h.storm) document.getElementById("storm-timer").textContent = h.storm;
  if (h.hp !== undefined) {
    document.getElementById("hp-text").textContent = h.hp;
    document.getElementById("hp-bar").style.width = `${h.hp}%`;
  }
  if (h.wood !== undefined) document.getElementById("wood-text").textContent = h.wood;
  if (h.weapon) document.getElementById("weapon-name").textContent = h.weapon;
  if (h.ammo) document.getElementById("ammo-text").textContent = h.ammo;
  if (h.build !== undefined) {
    document.getElementById("build-bar").classList.toggle("hidden", !h.build);
    document.getElementById("crosshair").classList.toggle("build", !!h.build);
  }
  if (h.aim !== undefined) {
    document.getElementById("crosshair").classList.toggle("aim", !!h.aim && !h.build);
  }
  if (h.piece) {
    for (const slot of document.querySelectorAll(".build-slot")) {
      slot.classList.toggle("active", slot.dataset.piece === h.piece);
    }
  }
  if (h.feed) {
    feed.unshift(h.feed);
    feed = feed.slice(0, 4);
    document.getElementById("kill-feed").innerHTML = feed.map((l) => `<div>${l}</div>`).join("");
  }
  if (h.hitmarker) {
    const m = document.getElementById("hitmarker");
    m.classList.add("show");
    setTimeout(() => m.classList.remove("show"), 90);
  }
  if (h.deadPrompt !== undefined) {
    const box = document.getElementById("death-choice");
    box.classList.toggle("hidden", !h.deadPrompt);
    document.body.classList.toggle("dead", !!h.deadPrompt);
    if (h.deadPrompt) {
      document.exitPointerLock();
      document.getElementById("pause").classList.add("hidden");
      if (h.deathSub) document.getElementById("death-sub").textContent = h.deathSub;
    }
  }
  if (h.spectateName !== undefined) {
    const bar = document.getElementById("spec-bar");
    bar.classList.toggle("hidden", !h.spectateName);
    document.body.classList.toggle("watching", !!h.spectateName);
    if (h.spectateName) document.getElementById("spec-name").textContent = h.spectateName;
  }
  if (h.banner) {
    const b = document.getElementById("banner");
    b.textContent = h.banner;
    b.classList.remove("hidden");
  }
}

function endMatch(result) {
  document.body.classList.remove("dead", "watching");
  document.getElementById("death-choice").classList.add("hidden");
  document.getElementById("spec-bar").classList.add("hidden");
  screens.hud.classList.add("hidden");
  document.getElementById("end-kicker").textContent = result.win ? "Victory Royale" : "Eliminated";
  document.getElementById("end-title").textContent = result.win ? "Last stick standing" : `${result.winner} wins`;
  document.getElementById("end-sub").textContent = `${result.kills} elimination${result.kills === 1 ? "" : "s"}`;
  show("end");
}

function renderLobby() {
  const list = document.getElementById("lobby-players");
  list.innerHTML = lobby.players
    .map(
      (p) =>
        `<li><span>${p.name}</span><span>${p.host ? "HOST" : p.bot ? "BOT" : "READY"}</span></li>`
    )
    .join("");
  document.getElementById("btn-start").classList.toggle("hidden", !lobby.host);
  document.getElementById("room-code-wrap").classList.toggle("hidden", !lobby.code);
  document.getElementById("room-code").textContent = lobby.code || "------";
}

document.getElementById("btn-solo").onclick = () => {
  const localId = "local";
  const roster = makeRoster([{ id: localId, name: profile.name, profile }]);
  startMatch({ role: "solo", roster, seed: (Math.random() * 1e9) | 0, localId });
};

document.getElementById("btn-host").onclick = async () => {
  document.getElementById("lobby-status").textContent = "Opening a peer room…";
  show("lobby");
  lobby = { players: [{ id: "host", name: profile.name, profile, host: true }], host: true, code: "" };
  renderLobby();
  net = new Net();
  try {
    const code = await net.host();
    lobby.code = code;
    lobby.localId = net.localPeerId;
    lobby.players[0].id = net.localPeerId;
    document.getElementById("lobby-role").textContent = "You are hosting";
    document.getElementById("lobby-status").textContent =
      "Share this code. Keep this tab open — your browser is the free server.";
    renderLobby();
    net.on("joined", (_, id) => {
      net.sendTo(id, { t: "hello-ack", need: true });
    });
    net.on("hello", (msg, id) => {
      if (lobby.players.some((p) => p.id === id)) return;
      lobby.players.push({ id, name: msg.profile.name, profile: msg.profile, host: false });
      net.broadcast({ t: "lobby", players: lobby.players });
      net.sendTo(id, { t: "lobby", players: lobby.players });
      renderLobby();
    });
    net.on("left", (msg) => {
      lobby.players = lobby.players.filter((p) => p.id !== msg.id);
      net.broadcast({ t: "lobby", players: lobby.players });
      renderLobby();
    });
  } catch (err) {
    document.getElementById("lobby-status").textContent = err.message || "Could not host.";
  }
};

document.getElementById("btn-join-go").onclick = async () => {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  const err = document.getElementById("join-error");
  err.textContent = "";
  if (code.length < 4) {
    err.textContent = "Enter the host code.";
    return;
  }
  net = new Net();
  try {
    await net.join(code);
    show("lobby");
    lobby = { players: [], host: false, code, localId: net.localPeerId };
    document.getElementById("lobby-role").textContent = "Joined";
    document.getElementById("lobby-status").textContent = "Waiting for the host to start.";
    document.getElementById("btn-start").classList.add("hidden");
    renderLobby();
    net.sendToHost({ t: "hello", profile });
    net.on("lobby", (msg) => {
      lobby.players = msg.players;
      renderLobby();
    });
    net.on("start", (msg) => {
      startMatch({
        role: "client",
        roster: msg.roster,
        seed: msg.seed,
        localId: net.localPeerId,
      });
    });
  } catch (e) {
    err.textContent = e.message || "Could not connect.";
    net.destroy();
    net = null;
  }
};

document.getElementById("btn-start").onclick = () => {
  if (!lobby.host) return;
  const humans = lobby.players.map((p) => ({
    id: p.id,
    name: p.name,
    profile: p.profile,
    bot: false,
  }));
  const roster = makeRoster(humans);
  const seed = (Math.random() * 1e9) | 0;
  net.broadcast({ t: "start", roster, seed });
  startMatch({ role: "host", roster, seed, localId: net.localPeerId });
};

document.getElementById("btn-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(lobby.code);
    document.getElementById("btn-copy").textContent = "Copied";
  } catch {
    document.getElementById("btn-copy").textContent = lobby.code;
  }
};

function leaveLobby() {
  if (preview) preview.running = true;
  document.body.classList.remove("playing", "dead", "watching");
  if (match) {
    match.dispose();
    match = null;
  }
  if (net) {
    net.destroy();
    net = null;
  }
  document.getElementById("banner").classList.add("hidden");
  document.getElementById("death-choice").classList.add("hidden");
  document.getElementById("spec-bar").classList.add("hidden");
  show("menu");
}

document.getElementById("btn-lobby-leave").onclick = leaveLobby;
document.getElementById("btn-end-menu").onclick = leaveLobby;
document.getElementById("btn-quit").onclick = leaveLobby;
document.getElementById("btn-leave-match").onclick = leaveLobby;
document.getElementById("btn-spec-leave").onclick = leaveLobby;
document.getElementById("btn-spectate").onclick = () => {
  match?.beginSpectate();
  document.getElementById("death-choice").classList.add("hidden");
  document.body.classList.remove("dead");
};
document.getElementById("btn-spec-next").onclick = () => match?.cycleSpectate(1);

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && match) {
    if (!document.getElementById("death-choice").classList.contains("hidden")) return;
    document.getElementById("pause").classList.toggle("hidden");
  }
});

refreshCustomize();
mountPreview();
show("menu");
