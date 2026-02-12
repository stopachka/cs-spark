import * as THREE from "three";
import "./style.css";
import { db } from "./lib/db";

type PresenceState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  color: string;
  name: string;
};

type RemotePlayer = {
  id: string;
  root: THREE.Group;
  meshes: THREE.Mesh[];
  colorableMeshes: THREE.Mesh[];
  baseColor: number;
  name: string;
  hp: number;
  alive: boolean;
  isDying: boolean;
  deathProgress: number;
  deathSpin: number;
  beacon: THREE.Mesh;
};

type DamageEvent = {
  targetPeerId?: string;
  shooterPeerId?: string;
  amount?: number;
  at?: number;
};

const app = document.getElementById("app");
if (!app) {
  throw new Error("#app element is missing");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111722);
scene.fog = new THREE.Fog(0x111722, 20, 130);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

app.className = "game-root";
app.style.position = "relative";
app.style.overflow = "hidden";
app.append(renderer.domElement);

const overlay = document.createElement("div");
overlay.className = "ui-overlay";
overlay.innerHTML = `
  <div id="hud">
    <div id="status">Connecting...</div>
    <div id="stats">Kills: 0 | Players: 0</div>
    <div id="health">Health: 100</div>
  </div>
  <div id="crosshair"></div>
`;
app.append(overlay);

const hud = document.getElementById("stats");
const statusText = document.getElementById("status");
const healthText = document.getElementById("health");
if (!hud || !statusText || !healthText) {
  throw new Error("HUD elements missing");
}

const sceneLight = new THREE.AmbientLight(0xa7bfdc, 1.05);
scene.add(sceneLight);

const fill = new THREE.DirectionalLight(0xffffff, 1.25);
fill.position.set(12, 24, 16);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x94b7df, 0.55);
rim.position.set(-12, 18, -12);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(140, 0.5, 140),
  new THREE.MeshStandardMaterial({
    color: 0x243347,
    roughness: 0.98,
    metalness: 0.05,
  }),
);
floor.position.set(0, -0.25, 0);
scene.add(floor);

const grid = new THREE.GridHelper(140, 56, 0x2f4054, 0x293646);
grid.position.y = -0.24;
scene.add(grid);

const mapRadius = 60;
const mapBound = mapRadius - 6;
const markerMat = new THREE.MeshStandardMaterial({
  color: 0x3d4d61,
  roughness: 0.9,
  transparent: true,
  opacity: 0.5,
});
const markerA = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 1.8), markerMat);
markerA.position.set(-mapBound, 0, -mapBound);
const markerB = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 1.8), markerMat);
markerB.position.set(mapBound, 0, mapBound);
const markerC = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 1.8), markerMat);
markerC.position.set(-mapBound, 0, mapBound);
const markerD = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 1.8), markerMat);
markerD.position.set(mapBound, 0, -mapBound);
scene.add(markerA, markerB, markerC, markerD);

const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

let killCount = 0;
let localPeerId = "";
let localName = `Agent-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
let localColor = randomHexColor();
let mouseLocked = false;
let yaw = 0;
let pitch = 0;
let lastShotTime = 0;
const shootCooldown = 110;
let lastPresenceMs = 0;
const presenceHz = 60;

const playerEyeY = 1.6;

const maxPlayerX = mapRadius - 8;

const localState = {
  hp: 100,
  alive: true,
  respawnTimer: 0,
  respawnDelay: 2.2,
  isRespawning: false,
};

const roomId = "global-arena";
let roomType: "arena" | "todos" = "arena";
let room: ReturnType<typeof db.joinRoom> | null = null;
let fallbackAttempted = false;

const remotePlayers = new Map<string, RemotePlayer>();
const remoteMeshToPeer = new Map<string, string>();

const deathAnimDuration = 0.55;

// 3D model geometry
const bodyGeometry = new THREE.BoxGeometry(0.95, 1.15, 0.45);
const headGeometry = new THREE.BoxGeometry(0.55, 0.55, 0.55);
const armGeometry = new THREE.BoxGeometry(0.24, 0.75, 0.24);
const legGeometry = new THREE.BoxGeometry(0.28, 0.8, 0.28);
const gunGeometry = new THREE.BoxGeometry(0.25, 0.16, 0.7);

type WebAudioCtor = typeof AudioContext;
const chipSongVolume = 0.06;
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensureAudio() {
  if (audioCtx) {
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return;
  }

  const Ctx = (window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
    | WebAudioCtor
    | undefined;
  if (!Ctx) {
    return;
  }
  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 1.1;
  masterGain.connect(audioCtx.destination);
}

function playTone(
  frequency: number,
  startOffset: number,
  duration: number,
  type: OscillatorType,
  volume: number,
) {
  if (!audioCtx || !masterGain) {
    return;
  }
  const osc = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime + startOffset);
  osc.frequency.exponentialRampToValueAtTime(
    frequency * 0.75,
    audioCtx.currentTime + startOffset + duration,
  );

  filter.type = "lowpass";
  filter.frequency.value = 3200;

  gain.gain.setValueAtTime(0, audioCtx.currentTime + startOffset);
  gain.gain.linearRampToValueAtTime(
    volume * chipSongVolume,
    audioCtx.currentTime + startOffset + 0.005,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    audioCtx.currentTime + startOffset + duration,
  );

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  osc.start(audioCtx.currentTime + startOffset);
  osc.stop(audioCtx.currentTime + startOffset + duration);
}

function playChiptuneShot() {
  ensureAudio();
  if (!audioCtx) {
    return;
  }
  const leadIn = Math.random() * 0.04;
  playTone(1180 - leadIn * 1600, 0, 0.07, "square", 0.08);
  playTone(920 + leadIn * 1200, 0.02, 0.05, "triangle", 0.12);
  playTone(1560, 0.04, 0.04, "sawtooth", 0.08);
  playTone(700, 0.06, 0.06, "square", 0.12);
}

function playChiptuneDeath() {
  ensureAudio();
  if (!audioCtx) {
    return;
  }
  const base = 620 - Math.random() * 150;
  playTone(base + 90, 0, 0.09, "triangle", 0.15);
  playTone(base + 70, 0.05, 0.1, "square", 0.09);
  playTone(base - 190, 0.1, 0.13, "triangle", 0.08);
}

function randomSpawn() {
  let x = 0;
  let z = 0;
  do {
    x = (Math.random() * 2 - 1) * (maxPlayerX - 4);
    z = (Math.random() * 2 - 1) * (maxPlayerX - 4);
  } while (x * x + z * z < 36);
  return { x, y: playerEyeY, z };
}

function randomHexColor() {
  return `#${Math.floor(0x444444 + Math.random() * 0xbbbbbb).toString(16).padStart(6, "0")}`;
}

function toColorNumber(color: string) {
  if (color.startsWith("#")) {
    return parseInt(color.slice(1), 16);
  }
  return 0xdb3f3f;
}

function createPlayerAvatar(
  peerId: string,
  colorHex: string,
  name: string,
): RemotePlayer {
  const color = toColorNumber(colorHex);
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const torso = new THREE.Mesh(bodyGeometry, bodyMat);
  torso.position.set(0, 1.0, 0);

  const faceMat = new THREE.MeshStandardMaterial({ color: Math.min(color * 1.05, 0xffffff) });
  const head = new THREE.Mesh(headGeometry, faceMat);
  head.position.set(0, 1.75, 0);

  const limbMat = new THREE.MeshStandardMaterial({ color: color - 0x111111 });
  const leftArm = new THREE.Mesh(armGeometry, limbMat);
  leftArm.position.set(-0.62, 1.1, 0);

  const rightArm = new THREE.Mesh(armGeometry, limbMat);
  rightArm.position.set(0.62, 1.1, 0);

  const leftLeg = new THREE.Mesh(legGeometry, limbMat);
  leftLeg.position.set(-0.22, 0.38, 0);

  const rightLeg = new THREE.Mesh(legGeometry, limbMat);
  rightLeg.position.set(0.22, 0.38, 0);

  const gunBody = new THREE.Mesh(
    gunGeometry,
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  gunBody.position.set(0.78, 1.2, 0.32);

  const beaconMat = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 1.1,
    transparent: true,
    opacity: 0.85,
  });
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.08, 16),
    beaconMat,
  );
  beacon.position.set(0, 2.45, 0);
  beacon.rotation.x = Math.PI / 2;

  const meshes = [torso, head, leftArm, rightArm, leftLeg, rightLeg, gunBody];
  const colorableMeshes = [torso, head, leftLeg, rightLeg, leftArm, rightArm];
  root.add(...meshes, beacon);

  const avatar: RemotePlayer = {
    id: peerId,
    root,
    meshes,
    colorableMeshes,
    baseColor: color,
    name,
    hp: 100,
    alive: true,
    isDying: false,
    deathProgress: 0,
    deathSpin: 0,
    beacon,
  };

  for (const mesh of meshes) {
    remoteMeshToPeer.set(mesh.uuid, peerId);
  }

  scene.add(root);
  return avatar;
}

function removePlayer(peerId: string) {
  const player = remotePlayers.get(peerId);
  if (!player) {
    return;
  }
  for (const mesh of player.meshes) {
    remoteMeshToPeer.delete(mesh.uuid);
  }
  scene.remove(player.root);
  remotePlayers.delete(peerId);
}

function refreshHealthText() {
  healthText.textContent = `Health: ${Math.max(0, Math.ceil(localState.hp))}`;
}

function refreshStats() {
  const sortedByDistance = Array.from(remotePlayers.values())
    .map((peer) => ({
      player: peer,
      distance: new THREE.Vector2(peer.root.position.x - camera.position.x, peer.root.position.z - camera.position.z)
        .length(),
    }))
    .sort((a, b) => a.distance - b.distance);

  const playerNames = sortedByDistance
    .map((peer) => peer.name)
    .join(", ");
  const nearest = sortedByDistance.length
    ? sortedByDistance
        .slice(0, 3)
        .map((peer) => `${peer.player.name} ${peer.distance.toFixed(0)}m`)
        .join(" | ")
    : "none";
  const names = playerNames.length > 0 ? ` | Nearby: ${playerNames}` : "";
  hud.textContent = `Kills: ${killCount} | Players: ${1 + remotePlayers.size}${names} | Closest: ${nearest}`;
}

function setPlayerStatus(message: string) {
  statusText.textContent = message;
}

function isPeerAlive(peerState: PresenceState) {
  return peerState.alive !== false;
}

function syncRemoteFromPresence(peerId: string, data: PresenceState) {
  if (peerId === localPeerId) {
    return;
  }
  const existing = remotePlayers.get(peerId);
  const presenceAlive = isPeerAlive(data);
  const hp = typeof data.hp === "number" ? data.hp : 100;

  if (!existing) {
    const color = typeof data.color === "string" ? data.color : randomHexColor();
    const avatar = createPlayerAvatar(peerId, color, data.name ?? peerId.slice(0, 5));
    remotePlayers.set(peerId, avatar);
    applyPresenceTransform(avatar, data);
    avatar.name = typeof data.name === "string" ? data.name : avatar.name;
    applyVisualHealth(avatar, presenceAlive ? hp : 0);
    if (!presenceAlive) {
      startDeathAnimation(avatar);
    }
    return;
  }

  if (typeof data.name === "string" && data.name.length > 0) {
    existing.name = data.name;
  }

  applyPresenceTransform(existing, data);
  if (existing.alive && !presenceAlive) {
    startDeathAnimation(existing);
  }

  if (!existing.alive && presenceAlive) {
    existing.alive = true;
    existing.isDying = false;
    existing.deathProgress = 0;
    existing.deathSpin = 0;
    existing.root.visible = true;
    existing.root.scale.set(1, 1, 1);
    existing.root.rotation.set(0, 0, 0);
    existing.hp = hp;
  }

  existing.hp = hp;
  applyVisualHealth(existing, existing.alive ? hp : existing.hp);

  const colorString =
    typeof data.color === "string" ? data.color : `#${existing.baseColor.toString(16)}`;
  const colorHex = toColorNumber(colorString);
  if (existing.baseColor !== colorHex) {
    existing.baseColor = colorHex;
    for (const mesh of existing.colorableMeshes) {
      mesh.material.color.setHex(colorHex);
    }
    existing.beacon.material.color.setHex(colorHex);
    existing.beacon.material.emissive.setHex(colorHex);
  }
}

function applyPresenceTransform(player: RemotePlayer, data: PresenceState) {
  const x = typeof data.x === "number" ? data.x : player.root.position.x;
  const z = typeof data.z === "number" ? data.z : player.root.position.z;

  player.root.position.set(x, 0, z);
  if (typeof data.yaw === "number") {
    player.root.rotation.y = data.yaw;
  }
}

function applyVisualHealth(player: RemotePlayer, hp: number) {
  const ratio = Math.max(0, Math.min(1, hp / 100));
  const base = new THREE.Color(player.baseColor);
  const tint = base.clone().multiplyScalar(0.35 + 0.65 * ratio);
  player.colorableMeshes.forEach((mesh) => {
    mesh.material.color.set(tint);
  });
}

function startDeathAnimation(player: RemotePlayer) {
  player.alive = false;
  player.isDying = true;
  player.deathProgress = 0;
  player.deathSpin = (Math.random() - 0.5) * 1.5;
  playChiptuneDeath();
}

function applyLocalDamage(amount: number, shooterPeerId?: string) {
  if (!localState.alive) {
    return;
  }
  localState.hp = Math.max(0, localState.hp - amount);
  refreshHealthText();

  if (shooterPeerId && shooterPeerId !== localPeerId && localState.hp <= 0) {
    setPlayerStatus("You were eliminated. Respawning...");
  }

  if (localState.hp <= 0) {
    killLocalPlayer();
  }

  sendPresence(true);
}

function killLocalPlayer() {
  if (!localState.alive) {
    return;
  }
  localState.alive = false;
  localState.respawnTimer = localState.respawnDelay;
  localState.isRespawning = true;
  playChiptuneDeath();
}

function applyRemoteDamage(peerId: string, amount: number, shooterPeerId?: string) {
  const player = remotePlayers.get(peerId);
  if (!player || !player.alive) {
    return;
  }

  player.hp = Math.max(0, player.hp - amount);
  applyVisualHealth(player, player.hp);

  if (player.hp <= 0) {
    startDeathAnimation(player);
    if (shooterPeerId && shooterPeerId === localPeerId) {
      killCount += 1;
      refreshStats();
    }
  }
}

function handleIncomingDamage(event: unknown) {
  if (localPeerId === "") {
    return;
  }

  const typed = event as DamageEvent;
  if (!typed.targetPeerId || typeof typed.amount !== "number") {
    return;
  }

  const amount = Math.max(1, Math.min(75, typed.amount));

  if (typed.targetPeerId === localPeerId) {
    applyLocalDamage(amount, typed.shooterPeerId);
    return;
  }

  applyRemoteDamage(typed.targetPeerId, amount, typed.shooterPeerId);
}

const raycaster = new THREE.Raycaster();

async function connectToRoom() {
  if (room) {
    return;
  }

  const auth = await db.getAuth();
  if (!auth) {
    await db.auth.signInAsGuest();
  }

  const spawn = randomSpawn();
  camera.position.set(spawn.x, playerEyeY, spawn.z);
  yaw = 0;
  pitch = 0;
  updateCameraDirection();

  room = db.joinRoom(roomType, roomId, {
    initialPresence: {
      x: spawn.x,
      y: playerEyeY,
      z: spawn.z,
      yaw,
      pitch,
      hp: localState.hp,
      alive: localState.alive,
      color: localColor,
      name: localName,
    },
  });

  setPlayerStatus(`Connected to room ${roomType}. Click to lock mouse and shoot.`);
  refreshHealthText();
  refreshStats();

  room.subscribePresence({}, (presence) => {
  if (presence.error) {
    setPlayerStatus(`Presence error: ${presence.error}`);
      if (!fallbackAttempted && roomType === "arena") {
      fallbackAttempted = true;
      roomType = "todos";
      if (room) {
        room.leaveRoom();
        room = null;
      }
      for (const player of remotePlayers.values()) {
        scene.remove(player.root);
      }
      remotePlayers.clear();
      remoteMeshToPeer.clear();
      setPlayerStatus("Fallback: using global room.");
      connectToRoom();
    }
    return;
  }

  if (presence.user) {
    if (localPeerId !== presence.user.peerId) {
      localPeerId = presence.user.peerId;
      setPlayerStatus(`Connected to ${roomType}. WASD to move, mouse to look.`);
    }
    localColor =
      typeof presence.user.color === "string" ? presence.user.color : localColor;
  }

  const seenPeers = new Set<string>();
  for (const [peerId, peer] of Object.entries(presence.peers ?? {})) {
    syncRemoteFromPresence(peerId, peer as unknown as PresenceState);
    seenPeers.add(peerId);
  }

    for (const id of remotePlayers.keys()) {
      if (!seenPeers.has(id)) {
        removePlayer(id);
      }
    }

    refreshStats();
  });

  room.subscribeTopic("damage", (event) => {
    handleIncomingDamage(event);
  });

  sendPresence(true);
}

function updateCameraDirection() {
  camera.rotation.x = pitch;
  camera.rotation.y = yaw;
  camera.rotation.z = 0;
}

function updateMovement(delta: number) {
  if (!localState.alive) {
    return;
  }

  const move = new THREE.Vector3();
  if (moveState.forward) move.z -= 1;
  if (moveState.backward) move.z += 1;
  if (moveState.left) move.x -= 1;
  if (moveState.right) move.x += 1;

  if (move.lengthSq() === 0) {
    return;
  }

  move.normalize();

  const forward = new THREE.Vector3(0, 0, -1).applyEuler(
    new THREE.Euler(0, yaw, 0),
  );
  const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));

  const moveSpeed = 10;
  const deltaMove = new THREE.Vector3()
    .addScaledVector(forward, -move.z * moveSpeed * delta)
    .addScaledVector(right, move.x * moveSpeed * delta);

  const nextX = camera.position.x + deltaMove.x;
  const nextZ = camera.position.z + deltaMove.z;

  camera.position.x = Math.max(-maxPlayerX, Math.min(maxPlayerX, nextX));
  camera.position.z = Math.max(-maxPlayerX, Math.min(maxPlayerX, nextZ));
}

function updateLocalRespawn(delta: number) {
  if (localState.alive) {
    return;
  }

  localState.respawnTimer -= delta;
  if (localState.respawnTimer <= 0) {
    localState.alive = true;
    localState.isRespawning = false;
    localState.hp = 100;
    localState.respawnTimer = 0;
    const spawn = randomSpawn();
    camera.position.set(spawn.x, spawn.y, spawn.z);
    setPlayerStatus("You respawned.");
    refreshHealthText();
  }

  sendPresence(true);
}

function updatePlayerAnimations(delta: number) {
  for (const player of remotePlayers.values()) {
    if (!player.isDying) {
      continue;
    }
    player.deathProgress += delta;
    const t = Math.min(1, player.deathProgress / deathAnimDuration);
    const collapsed = 1 - t;
    player.root.scale.set(1, collapsed, 1);
    player.root.position.y = -0.45 * t;
    player.root.rotation.z = player.deathSpin * t;

    const shouldStayVisible = t < 1.0;
    player.root.visible = shouldStayVisible;
  }

  const pulse = 1 + Math.sin(performance.now() / 180) * 0.08;
  for (const player of remotePlayers.values()) {
    const alive = player.alive && !player.isDying;
    const show = !player.isDying;
    player.beacon.visible = show;
    if (show) {
      player.beacon.scale.set(pulse, 1, pulse);
      if (alive) {
        player.beacon.material.opacity = 0.7 + (1 - player.hp / 100) * 0.25;
        player.beacon.material.emissiveIntensity = 0.7 + Math.max(0, 1 - player.hp / 100);
      }
    }
  }
}

function sendPresence(force = false) {
  if (!room || !mouseLocked && !force) {
    return;
  }

  const now = performance.now();
  if (!force && now - lastPresenceMs < presenceHz && !localState.isRespawning) {
    return;
  }
  lastPresenceMs = now;

  room.publishPresence({
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
    yaw,
    pitch,
    hp: localState.hp,
    alive: localState.alive,
    color: localColor,
    name: localName,
  });
}

function shoot() {
  if (!room || !mouseLocked || !localState.alive) {
    return;
  }

  const now = performance.now();
  if (now - lastShotTime < shootCooldown) {
    return;
  }
  lastShotTime = now;
  playChiptuneShot();

  const crosshair = document.getElementById("crosshair");
  crosshair?.classList.add("fire");
  window.setTimeout(() => {
    crosshair?.classList.remove("fire");
  }, 70);

  // Raycast directly against all remote player meshes.
  const remoteParts = Array.from(remotePlayers.values()).flatMap((peer) => peer.meshes);
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(remoteParts, false);
  if (!hits.length) {
    sendPresence(true);
    return;
  }

  const first = hits[0];
  const hitPeerId = remoteMeshToPeer.get(first.object.uuid);
  if (!hitPeerId) {
    sendPresence(true);
    return;
  }

  const damage = 34 + Math.floor(Math.random() * 12);
  room.publishTopic("damage", {
    targetPeerId: hitPeerId,
    shooterPeerId: localPeerId,
    amount: damage,
    at: Date.now(),
  } as const);

  sendPresence(true);
}

document.addEventListener("pointerlockchange", () => {
  mouseLocked = document.pointerLockElement === renderer.domElement;
  if (mouseLocked) {
    setPlayerStatus("Left click to shoot. WASD to move.");
  } else {
    setPlayerStatus("Paused. Click the screen to lock pointer.");
  }
});

document.addEventListener("keydown", (event: KeyboardEvent) => {
  switch (event.code) {
    case "KeyW":
      moveState.forward = true;
      break;
    case "KeyS":
      moveState.backward = true;
      break;
    case "KeyA":
      moveState.left = true;
      break;
    case "KeyD":
      moveState.right = true;
      break;
    default:
      break;
  }
});

document.addEventListener("keyup", (event: KeyboardEvent) => {
  switch (event.code) {
    case "KeyW":
      moveState.forward = false;
      break;
    case "KeyS":
      moveState.backward = false;
      break;
    case "KeyA":
      moveState.left = false;
      break;
    case "KeyD":
      moveState.right = false;
      break;
    default:
      break;
  }
});

renderer.domElement.addEventListener("mousedown", (event) => {
  if (event.button !== 0) {
    return;
  }

  if (!mouseLocked) {
    renderer.domElement.requestPointerLock();
    return;
  }

  shoot();
});

document.addEventListener("mousemove", (event) => {
  if (!mouseLocked || !localState.alive) {
    return;
  }

  const sensitivity = 0.0028;
  yaw -= event.movementX * sensitivity;
  pitch -= event.movementY * sensitivity;
  pitch = Math.max(-Math.PI / 2 + 0.12, Math.min(Math.PI / 2 - 0.12, pitch));
  updateCameraDirection();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

db.subscribeAuth((auth) => {
  if (auth.user) {
    void connectToRoom();
  }
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  updateMovement(delta);
  updateLocalRespawn(delta);
  updatePlayerAnimations(delta);
  sendPresence();

  refreshStats();
  renderer.render(scene, camera);
}

void connectToRoom();
animate();
