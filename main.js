import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- CONFIGURACIÓN ---
const MODEL_URL = './Viki_V3.gltf';
const RECONNECT_MINUTES = 3; // cambiar a 55 para producción

// --- CÁMARA DE VISIÓN ---
let videoStream = null;
let videoElement = null;
let cameraCanvas = null;
let cameraActive = false;

async function initCamera() {
    try {
        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        cameraCanvas = document.createElement('canvas');
        cameraCanvas.width = 320;
        cameraCanvas.height = 240;
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        videoElement.srcObject = videoStream;
        await videoElement.play();
        cameraActive = true;
        console.log('📷 Cámara activada');
    } catch (e) {
        console.warn('📷 Cámara no disponible:', e.message);
        cameraActive = false;
    }
}

let cameraInitialized = false;
async function ensureCamera() {
    if (!cameraInitialized) {
        cameraInitialized = true;
        await initCamera();
    }
}

// --- STATE & ANIMATION ---
const morphTargetValues = {};
const currentMorphInfluences = {};

// --- AUDIO CONTEXT ---
let audioContext = null;
let analyser = null;
let dataArray = null;
let reverbNode = null;
let wetGainNode = null;
let dryGainNode = null;

// --- THREE.JS SETUP ---
const scene = new THREE.Scene();
window.scene = scene;
scene.background = new THREE.Color(0x030810);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0.1, 0.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// --- POST-PROCESSING ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85);
bloomPass.threshold = 0.9;
bloomPass.strength = 0.2;
bloomPass.radius = 0.4;
const outputPass = new OutputPass();
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(outputPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

// Luces
const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambLight);
const faceLight = new THREE.PointLight(0xffaa00, 0.0, 10);
faceLight.position.set(0, 0.5, 2);
scene.add(faceLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 5);
scene.add(dirLight);
const eyeLight = new THREE.PointLight(0xffffff, 0, 0);
eyeLight.position.set(0, 0.15, 0.8);
scene.add(eyeLight);
const fillLight = new THREE.PointLight(0x4477cc, 1.2, 4);
fillLight.position.set(-1, 0.3, 1.5);
scene.add(fillLight);
const fillLight2 = new THREE.PointLight(0x2255aa, 0.8, 4);
fillLight2.position.set(1, 0.3, 1.5);
scene.add(fillLight2);

// --- FACE GHOST LIGHTS ---
const faceGhosts = [
    { light: new THREE.PointLight(0x00d4ff, 0.55, 2.0), baseX: -0.22, baseY: 0.05, baseZ: 0.50, phase: 0.0 },
    { light: new THREE.PointLight(0x3db89a, 0.50, 2.0), baseX: 0.22, baseY: 0.05, baseZ: 0.50, phase: 1.2 },
    { light: new THREE.PointLight(0x2255aa, 0.20, 1.5), baseX: 0.00, baseY: 0.30, baseZ: 0.48, phase: 2.4 },
];
faceGhosts.forEach(fg => scene.add(fg.light));

// --- GHOST RING LIGHTS ---
const ghostLights = [];
const ghostColors = [0x00d4ff, 0x3db89a, 0x00d4ff, 0x3db89a, 0xffffff];
for (let i = 0; i < 5; i++) {
    const pLight = new THREE.PointLight(ghostColors[i], 0, 4);
    const yPos = 0.0 + (i * 0.25);
    const angle = (i / 5) * Math.PI * 2;
    pLight.position.set(Math.cos(angle) * 0.7, yPos, Math.sin(angle) * 0.7);
    scene.add(pLight);
    ghostLights.push({ light: pLight, angle, speed: 0.006 + (i * 0.002), yBase: yPos, baseIntensity: i === 0 ? 0.15 : 0.09 });
}

// --- HUD FUTURISTA ---
const hudElements = [];

function buildHUD() {
    const hudGroup = new THREE.Group();
    hudGroup.position.set(0, 0.05, -0.5);
    scene.add(hudGroup);

    // ROSA — anillos principales visibles
    const ring1 = new THREE.Mesh(
        new THREE.RingGeometry(1.05, 1.08, 128),
        new THREE.MeshBasicMaterial({ color: 0xff69b4, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
    );
    hudGroup.add(ring1);

    const ring2 = new THREE.Mesh(
        new THREE.RingGeometry(0.88, 0.90, 128),
        new THREE.MeshBasicMaterial({ color: 0xff1493, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
    );
    hudGroup.add(ring2);

    for (let i = 0; i < 48; i++) {
        if (i % 4 === 3) continue;
        const angle = (i / 48) * Math.PI * 2;
        hudGroup.add(new THREE.Mesh(
            new THREE.RingGeometry(0.97, 0.99, 1, 1, angle, (Math.PI * 2 / 48) * 0.7),
            new THREE.MeshBasicMaterial({ color: 0xff69b4, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
        ));
    }

    for (let i = 0; i < 72; i++) {
        const angle = (i / 72) * Math.PI * 2;
        const isLong = i % 6 === 0, isMed = i % 3 === 0;
        const innerR = isLong ? 0.90 : isMed ? 0.93 : 0.96;
        hudGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(Math.cos(angle) * innerR, Math.sin(angle) * innerR, 0),
                new THREE.Vector3(Math.cos(angle) * 1.05, Math.sin(angle) * 1.05, 0)
            ]),
            new THREE.LineBasicMaterial({ color: isLong ? 0xff69b4 : 0xc0006a, transparent: true, opacity: isLong ? 0.3 : 0.15 })
        ));
    }

    // Arcos exteriores rosa
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((startAngle, i) => {
        hudGroup.add(new THREE.Mesh(
            new THREE.RingGeometry(1.12, 1.15, 32, 1, startAngle + 0.15, Math.PI / 2 - 0.3),
            new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xff69b4 : 0xff1493, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        ));
    });

    const segGroup = new THREE.Group();
    hudGroup.add(segGroup);
    for (let i = 0; i < 24; i++) {
        if (i % 3 === 2) continue;
        const angle = (i / 24) * Math.PI * 2;
        segGroup.add(new THREE.Mesh(
            new THREE.RingGeometry(1.18, 1.22, 1, 1, angle, (Math.PI * 2 / 24) * 0.6),
            new THREE.MeshBasicMaterial({ color: 0xff1493, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
        ));
    }

    const scanner = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.88, 0.01),
            new THREE.Vector3(0, 1.22, 0.01)
        ]),
        new THREE.LineBasicMaterial({ color: 0xff69b4, transparent: true, opacity: 0.6 })
    );
    hudGroup.add(scanner);

    const particleCount = 80;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2;
        const r = 0.92 + (Math.random() - 0.5) * 0.15;
        positions[i * 3] = Math.cos(angle) * r;
        positions[i * 3 + 1] = Math.sin(angle) * r;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    hudGroup.add(new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: 0xff69b4, size: 0.015, transparent: true, opacity: 0.6 })));

    hudElements.push({ group: hudGroup, ring1, ring2, segGroup, scanner, rotSpeed1: 0.003, rotSpeed2: -0.005 });
    console.log('✅ HUD futurista creado');
}

buildHUD();

// --- CARGA DEL MODELO ---
let headMesh = null;
const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading');

const loader = new GLTFLoader();

loader.load(MODEL_URL, (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    window.vikiModel = model;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) model.scale.setScalar(1.6 / maxDim);

    const box2 = new THREE.Box3().setFromObject(model);
    const center2 = box2.getCenter(new THREE.Vector3());
    model.position.sub(center2);
    model.position.y += 0.2;

    camera.position.set(0, 0.15, 1.8);
    camera.lookAt(0, 0.1, 0);
    controls.target.set(0, 0.1, 0);

    const box3 = new THREE.Box3().setFromObject(model);
    const modelSize = box3.getSize(new THREE.Vector3());
    const fh = modelSize.y;
    faceGhosts.forEach((fg, i) => {
        const offsets = [
            { x: -0.12 * modelSize.x, y: fh * 0.35, z: modelSize.z * 0.55 },
            { x: 0.12 * modelSize.x, y: fh * 0.35, z: modelSize.z * 0.55 },
            { x: 0, y: fh * 0.48, z: modelSize.z * 0.50 },
        ];
        fg.light.position.set(offsets[i].x, offsets[i].y, offsets[i].z);
        fg.baseX = offsets[i].x; fg.baseY = offsets[i].y; fg.baseZ = offsets[i].z;
        fg.light.intensity = [1.4, 1.2, 1.1][i];
        fg.light.userData.baseInt = fg.light.intensity;
        model.add(fg.light);
    });

    const morphMeshes = [];
    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) child.material.needsUpdate = true;
            if (child.morphTargetInfluences && child.morphTargetDictionary) {
                morphMeshes.push(child);
                Object.keys(child.morphTargetDictionary).forEach(key => {
                    const fullKey = `${child.name}_${key}`;
                    morphTargetValues[fullKey] = 0;
                    currentMorphInfluences[fullKey] = 0;
                });
                if (!headMesh || Object.keys(child.morphTargetDictionary).length > Object.keys(headMesh.morphTargetDictionary).length) {
                    headMesh = child;
                }
            }
        }
    });

    // --- TEXTURAS REALES (estilo Girasomnis) ---
    const texLoader = new THREE.TextureLoader();
    const texMap = { 'Holografic': 'Texture/Viki_Textura.png', 'Eye': 'Texture/Eye.png', 'eyebrow': 'Texture/Brow.png' };
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const matName = child.material.name;
            const texPath = texMap[matName];
            if (texPath) {
                texLoader.load(texPath, (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.flipY = false;
                    let mat;
                    if (matName === 'Eye') {
                        mat = new THREE.MeshStandardMaterial({ name: 'Eye', map: tex, color: new THREE.Color(0x888888), emissive: new THREE.Color(0x000000), emissiveIntensity: 0.0, roughness: 0.5, metalness: 0.1 });
                    } else {
                        mat = child.material.clone();
                        mat.map = tex;
                    }
                    mat.needsUpdate = true;
                    child.material = mat;
                });
            }
        }
    });

    if (headMesh) {
        window.animatableMeshes = morphMeshes;
        statusEl.textContent = '✅ Viky Ready — toca para activar';
        statusEl.style.color = '#00d4ff';
        setupDynamicMorphs(headMesh);
        setupIdleAnimations(headMesh);
        setVisema('sil', 1);
        setTimeout(() => startFaceTracking(), 2000);
    } else {
        statusEl.textContent = '⚠️ Modelo sin animaciones';
    }

}, undefined, (error) => {
    console.error(error);
    statusEl.textContent = '❌ Error cargando modelo';
});

// --- UI ---
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');

// =============================================================================
// OPENAI REALTIME — WebRTC
// =============================================================================
let pc = null;
let dc = null;
let localStream = null;
let isMicrophoneActive = true;
let realtimeReady = false;
let sessionSummary = '';
let isSpeaking = false;
let speechStartTime = null; // para medir duración antes de interrumpir

// =============================================================================
// WAKE WORD / MODO DORMIDO
// =============================================================================
let vikiAwake = false;          // false = dormida, true = activa
let wakeWordTimer = null;       // timeout para volver a dormida
const WAKE_TIMEOUT_MS = 90000;   // 1.5 minutos
const WAKE_WORDS = ['viki', 'vicky', 'viqui', 'wiki'];

function activateViki() {
    vikiAwake = true;
    if (wakeWordTimer) clearTimeout(wakeWordTimer);
    wakeWordTimer = setTimeout(sleepViki, WAKE_TIMEOUT_MS);
    statusEl.textContent = '✅ Viky Lista';
    statusEl.style.color = '#00d4ff';
    console.log('👋 Viki activada');
}

function sleepViki() {
    vikiAwake = false;
    if (wakeWordTimer) { clearTimeout(wakeWordTimer); wakeWordTimer = null; }
    statusEl.textContent = '😴 Viky en espera...';
    statusEl.style.color = '#888';
    applyIdleExpression();
    console.log('😴 Viki dormida');
}

function resetWakeTimer() {
    if (!vikiAwake) return;
    if (wakeWordTimer) clearTimeout(wakeWordTimer);
    wakeWordTimer = setTimeout(sleepViki, WAKE_TIMEOUT_MS);
}

function checkWakeWord(text) {
    const lower = text.toLowerCase();
    return WAKE_WORDS.some(w => lower.includes(w));
}

// =============================================================================
// LIPSYNC POR TRANSCRIPT (response.audio_transcript.delta)
// =============================================================================
const CHAR_TO_VISEME = {
    'a': { visema_a: 0.9, jawOpen: 0.50 },
    'á': { visema_a: 0.9, jawOpen: 0.50 },
    'e': { visema_e: 0.85, jawOpen: 0.22 },
    'é': { visema_e: 0.85, jawOpen: 0.22 },
    'i': { visema_i: 0.85, jawOpen: 0.08 },
    'í': { visema_i: 0.85, jawOpen: 0.08 },
    'o': { visema_o: 0.80, mouthFunnel: 0.35, jawOpen: 0.38 },
    'ó': { visema_o: 0.80, mouthFunnel: 0.35, jawOpen: 0.38 },
    'u': { visema_u: 0.80, mouthPucker: 0.45, jawOpen: 0.12 },
    'ú': { visema_u: 0.80, mouthPucker: 0.45, jawOpen: 0.12 },
    'p': { visema_p: 0.92, jawOpen: 0.00 },
    'b': { visema_p: 0.72, jawOpen: 0.00 },
    'm': { visema_p: 0.85, jawOpen: 0.00 },
    'f': { visema_f: 0.85, jawOpen: 0.04 },
    'v': { visema_f: 0.65, jawOpen: 0.04 },
    's': { visema_s: 0.78, jawOpen: 0.03 },
    'z': { visema_s: 0.65, jawOpen: 0.03 },
    'c': { visema_s: 0.55, jawOpen: 0.03 },
    't': { visema_t: 0.78, jawOpen: 0.03 },
    'd': { visema_t: 0.55, jawOpen: 0.07 },
    'l': { visema_t: 0.45, jawOpen: 0.07 },
    'n': { visema_t: 0.38, jawOpen: 0.03 },
    'ñ': { visema_t: 0.45, visema_sh: 0.30, jawOpen: 0.07 },
    'k': { visema_k: 0.78, jawOpen: 0.10 },
    'g': { visema_k: 0.55, jawOpen: 0.10 },
    'q': { visema_k: 0.65, jawOpen: 0.07 },
    'j': { visema_sh: 0.82, jawOpen: 0.08 },
    'x': { visema_sh: 0.72, jawOpen: 0.08 },
    'y': { visema_sh: 0.50, visema_i: 0.30, jawOpen: 0.06 },
    'r': { visema_r: 0.68, jawOpen: 0.16 },
    'h': { jawOpen: 0.10 },
    ' ': { visema_sil: 1.00 },
    '.': { visema_sil: 1.00 },
    ',': { visema_sil: 0.90 },
    '!': { visema_sil: 1.00 },
    '?': { visema_sil: 1.00 },
};

const DIGRAPH_MAP = {
    'ch': { visema_sh: 0.88, jawOpen: 0.09 },
    'll': { visema_sh: 0.70, visema_i: 0.25, jawOpen: 0.07 },
    'rr': { visema_r: 0.85, jawOpen: 0.22 },
    'qu': { visema_k: 0.78, jawOpen: 0.08 },
    'gu': { visema_k: 0.55, jawOpen: 0.10 },
};

// Buffer de texto que llega por deltas — se va acumulando
// Timeline construida: [{start, end, visemes}]
let lipsyncTimeline = [];
// Momento en que arrancó el audio (Date.now())
let lipsyncStartTime = null;
// Duración media estimada por carácter de habla (ms) — ajustable
const MS_PER_CHAR = 60;

function buildTimelineFromText(text) {
    // Convierte texto a timeline de visemas con tiempos estimados
    const timeline = [];
    let t = 0; // tiempo acumulado en segundos
    let i = 0;
    const chars = text.toLowerCase();

    while (i < chars.length) {
        // Comprobar dígrafo
        if (i + 1 < chars.length) {
            const pair = chars[i] + chars[i + 1];
            if (DIGRAPH_MAP[pair]) {
                const dur = (MS_PER_CHAR * 2) / 1000;
                timeline.push({ start: t, end: t + dur, visemes: DIGRAPH_MAP[pair] });
                t += dur;
                i += 2;
                continue;
            }
        }
        // Carácter individual
        const ch = chars[i];
        const visemes = CHAR_TO_VISEME[ch];
        if (visemes) {
            const dur = MS_PER_CHAR / 1000;
            timeline.push({ start: t, end: t + dur, visemes });
            t += dur;
        }
        i++;
    }
    return timeline;
}

function updateLipsyncFromTimeline() {
    if (!analyser || !dataArray) return;

    // --- FFT: energía real del audio (garantiza movimiento continuo) ---
    analyser.getByteFrequencyData(dataArray);
    let lowFreq = 0;
    for (let i = 2; i < 20; i++) lowFreq += dataArray[i];
    // Normalizar a rango 0-1 con multiplicador más bajo para más dinámica
    lowFreq = Math.min((lowFreq / 18 / 128) * 1.6, 1.0);
    // Aplicar curva de potencia para enfatizar variaciones medias y comprimir picos
    lowFreq = Math.pow(lowFreq, 0.6);
    const audioActive = lowFreq > 0.06;

    // --- Timeline: fonema activo por tiempo estimado ---
    let timelineTargets = null;
    if (lipsyncStartTime && lipsyncTimeline.length > 0) {
        const elapsed = (Date.now() - lipsyncStartTime) / 1000;
        const active = lipsyncTimeline.find(e => elapsed >= e.start && elapsed <= e.end);
        if (active && !active.visemes.visema_sil) {
            // Coarticulación con siguiente fonema
            const activeIdx = lipsyncTimeline.indexOf(active);
            const next = activeIdx + 1 < lipsyncTimeline.length ? lipsyncTimeline[activeIdx + 1] : null;
            const timeLeft = active.end - elapsed;
            const blend = (next && !next.visemes.visema_sil && timeLeft < 0.04)
                ? Math.max(0, 1 - timeLeft / 0.04) : 0;
            if (blend > 0 && next) {
                timelineTargets = {};
                const allKeys = new Set([...Object.keys(active.visemes), ...Object.keys(next.visemes)]);
                allKeys.forEach(k => {
                    timelineTargets[k] = (active.visemes[k] || 0) * (1 - blend * 0.3) + (next.visemes[k] || 0) * (blend * 0.3);
                });
            } else {
                timelineTargets = active.visemes;
            }
        }
    }

    // --- Combinar: timeline para forma de boca, FFT para amplitud ---
    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;

        const findKey = (name) => Object.keys(dict).find(k => k.toLowerCase() === name.toLowerCase());
        const applyVal = (key, val) => {
            if (!key || dict[key] === undefined) return;
            const fullKey = `${mesh.name}_${key}`;
            morphTargetValues[fullKey] = val;
        };

        const keySil = findKey('visema_sil');
        const keyA   = findKey('visema_a');
        const keyJaw = findKey('jawOpen');

        if (!audioActive) {
            // Silencio real — dejar que el LERP cierre suavemente
            // Solo ponemos visema_sil a 1, los demás los lleva el LERP a 0
            applyVal(keySil, 1.0);
            return;
        }

        // Limpiar todos los visemas de boca antes de aplicar nuevos
        const MOUTH_KEYS = ['visema_a','visema_e','visema_i','visema_o','visema_u','visema_p','visema_f','visema_t','visema_k','visema_s','visema_r','visema_sh','visema_sil','jawOpen','mouthFunnel','mouthPucker'];
        MOUTH_KEYS.forEach(k => { const mk = findKey(k); if (mk) applyVal(mk, 0); });

        if (timelineTargets) {
            // Fonema activo — aplicar forma escalada por FFT
            const amp = Math.max(lowFreq * 0.9, 0.35);
            Object.keys(timelineTargets).forEach(k => {
                const meshKey = findKey(k);
                if (meshKey) applyVal(meshKey, timelineTargets[k] * amp);
            });
        } else {
            // Sin fonema pero hay audio — FFT puro
            applyVal(keyA,   Math.min(lowFreq * 0.55, 0.60));
            applyVal(keyJaw, Math.min(lowFreq * 0.18, 0.28));
        }
    });
}

const VIKY_IDENTITY = `
[VOZ Y ACENTO — CRÍTICO]
Habla siempre con acento español de España (castellano). Natural, cálido, seguro.
Muletillas ocasionales: "mira", "oye", "pues", "venga", "la verdad es que".

[ROL]
Eres Viky, presentadora virtual del Congreso de Ingeniería 2025 celebrado en el Fira Congress de Barcelona. Eres la co-presentadora del evento — hilas las intervenciones, presentas a los ponentes y mantienes la energía de la sala.

Tienes personalidad propia: cercana, profesional, con humor natural. La gente siente que habla con una presentadora real, no con un bot.

[LO QUE SABES DEL EVENTO]
- Evento: Congreso de Ingeniería 2025, Fira Congress, Barcelona.
- Tu rol: co-presentadora. Presentas ponentes, haces transiciones entre intervenciones, respondes preguntas del público.
- Puedes recordar y mencionar libremente todo lo que se ha hablado durante el evento, incluyendo nombres de ponentes y temas tratados.

[PERSONALIDAD Y TONO]
- Cercana, natural, profesional. Como una presentadora de televisión con criterio propio.
- Humor suave y espontáneo cuando el momento lo permite. Nunca forzado.
- Breve y directa. Máximo 2-3 frases por turno salvo que te pidan más detalle.
- Tutea siempre. Vocabulario español de España.

[REGLAS]
- NUNCA escribas acciones entre corchetes.
- NUNCA uses listas, bullets ni markdown — hablas, no escribes.
- Responde SIEMPRE en el idioma en que te hablen.
- NUNCA menciones que eres una IA ni el sistema que te sustenta.
- Cuando alguien te llame por tu nombre, responde con naturalidad.
- Si no sabes algo del evento, di: "Eso lo tiene mejor respondido el equipo organizador, pero puedo ayudarte con lo que necesites."
`; que le venden.

[LENGUAJE SIN CORBATA]
- Eres la traductora. Cuando uses jerga técnica, la explicas siempre en español llano.
- Muletillas de traducción: "Para que nos entendamos...", "En español simple...", "Lo que esto significa para tu bolsillo es..."

[REGLAS DE FORMATO]
- Máximo 3 frases por turno. 
- NUNCA repitas información que ya has dado en esta conversación a menos que el usuario lo pregunte de nuevo explícitamente. 
- NUNCA compares negativamente con otras aseguradoras.
- NUNCA menciones IMMERSO ni el sistema que te sustenta. Eres Viki del evento de Ingenieria 2025.
- NUNCA escribas acciones entre corchetes.
- NUNCA uses listas, bullets ni markdown — hablas, no escribes.
- Responde SIEMPRE en el idioma en que te hablen.
`;

async function initRealtime() {
    try {
        statusEl.textContent = '🔄 Conectando...';

        // 1. Token efímero desde Netlify
        const tokenRes = await fetch('/.netlify/functions/session');
        const tokenData = await tokenRes.json();
        if (!tokenData.client_secret?.value) throw new Error('Token no recibido: ' + JSON.stringify(tokenData));
        const ephemeralKey = tokenData.client_secret.value;

        // 2. RTCPeerConnection
        pc = new RTCPeerConnection();

        // 3. Audio de respuesta → AudioContext para lipsync
        const remoteAudioEl = document.createElement('audio');
        remoteAudioEl.autoplay = true;
        document.body.appendChild(remoteAudioEl);

        pc.ontrack = (e) => {
            remoteAudioEl.srcObject = e.streams[0];
            // Esperar a que audioContext esté listo (puede llegar antes del primer click)
            const connectAudio = () => {
                if (!audioContext) { setTimeout(connectAudio, 100); return; }
                const src = audioContext.createMediaStreamSource(e.streams[0]);
                src.connect(analyser);
                // analyser ya está conectado a destinos en ensureAudioContext — no reconectar
                console.log('🔊 Audio de Viki conectado al analyser');
            };
            connectAudio();
        };

        // 4. Micrófono
        localStream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    } 
});
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        // 5. DataChannel
        dc = pc.createDataChannel('oai-events');

        dc.onopen = () => {
            console.log('✅ DataChannel abierto');
            realtimeReady = true;

            sendRealtimeEvent({
                type: 'session.update',
                session: {
                    instructions: VIKY_IDENTITY + (sessionSummary ? `\n\n[CONTEXTO DE SESIÓN ANTERIOR — NO MENCIONES ESTO ESPONTÁNEAMENTE]\n${sessionSummary}\nEspera a que te hablen, no digas nada al reconectar.` : ''),
                    voice: 'marin',
                    input_audio_transcription: { model: 'whisper-1' },
                    turn_detection: {
                        type: 'server_vad',
                        threshold: 0.95,
                        prefix_padding_ms: 300,
                        silence_duration_ms: 600,
                    },
                    modalities: ['text', 'audio'],
                }
            });

            // Timer reconexión automática
            if (window._reconnectTimer) clearTimeout(window._reconnectTimer);
            window._reconnectTimer = setTimeout(() => {
                reconnectRealtime();
            }, RECONNECT_MINUTES * 60 * 1000);

            micBtn.style.background = '#FF4136';
            // Arrancar en modo dormido
            setTimeout(() => sleepViki(), 500);
        };

        dc.onmessage = (e) => handleRealtimeEvent(JSON.parse(e.data));
        dc.onerror = (e) => console.error('DC error:', e);

        // 6. SDP handshake
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp',
            },
            body: offer.sdp,
        });

        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        console.log('✅ WebRTC conectado con OpenAI Realtime');

    } catch (err) {
        console.error('❌ Error Realtime:', err);
        statusEl.textContent = `❌ ${err.message}`;
    }
}

async function reconnectRealtime() {
    console.log('🔄 Reconectando sesión Realtime...');
    realtimeReady = false;

    // Generar resumen de sesión antes de reconectar
    if (sessionMessages.length > 0) {
        try {
            const res = await fetch('/.netlify/functions/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: sessionMessages })
            });
            const data = await res.json();
            sessionSummary = data.summary || '';
            console.log('📝 Resumen de sesión:', sessionSummary);
        } catch(e) {
            console.warn('No se pudo generar resumen:', e);
            sessionSummary = '';
        }
    }

    if (dc) { try { dc.close(); } catch(e){} dc = null; }
    if (pc) { try { pc.close(); } catch(e){} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.querySelectorAll('audio').forEach(a => { a.srcObject = null; a.remove(); });
    await initRealtime();
}

function sendRealtimeEvent(event) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(event));
}

function handleRealtimeEvent(event) {
    switch (event.type) {

        case 'output_audio_buffer.started':
            isSpeaking = true;
            applySpeakingExpression();
            loadingEl.classList.add('hidden');
            // Arrancar reloj — la timeline ya se va construyendo con los deltas
            if (!lipsyncStartTime) lipsyncStartTime = Date.now();
            break;

        case 'response.done':
            // No tocar isSpeaking ni morphs aquí — el audio puede seguir sonando
            // output_audio_buffer.stopped es el evento correcto para cerrar
            setTimeout(() => applyIdleExpression(), 800);
            break;

        case 'output_audio_buffer.stopped': {
            const audioDuration = lipsyncStartTime ? (Date.now() - lipsyncStartTime) / 1000 : 0;
            const timelineDuration = lipsyncTimeline.length > 0 ? lipsyncTimeline[lipsyncTimeline.length - 1].end : 0;
            isSpeaking = false;
            lipsyncTimeline = [];
            lipsyncStartTime = null;
            Object.keys(morphTargetValues).forEach(k => { morphTargetValues[k] = 0; });
            break;
        }

        case 'response.output_item.done': {
            // En modo audio, el contenido viene como transcript no como text
            const item = event.item;
            if (item?.content) {
                const textBlock = item.content.find(c => c.type === 'text');
                const audioBlock = item.content.find(c => c.type === 'audio');
                const reply = textBlock?.text || audioBlock?.transcript || '';
                if (reply) {
                    addSessionMessage('assistant', reply);
                    showPdfBtn();
                    applyEmotionFromText(reply);
                    if (!pendingVideoId) detectVideoPending(reply, true);
                    // Detectar si Viki activa el formulario de contratación
                    if (reply.toLowerCase().includes('te muestro el formulario ahora mismo')) {
                        setTimeout(() => showContractForm(), 800);
                    } else if (reply.toLowerCase().includes('te muestro el formulario de contacto ahora mismo')) {
                        setTimeout(() => showContactForm(), 800);
                    } else if (reply.toLowerCase().includes('aquí tienes la tabla comparativa') || reply.toLowerCase().includes('aqui tienes la tabla comparativa')) {
                        setTimeout(() => showPDFViewer(), 800);
                    }
                    // Si Viki pregunta sobre la tabla, marcar que está esperando confirmación
                    if (reply.toLowerCase().includes('quieres que te muestre la tabla') || reply.toLowerCase().includes('¿quieres que te muestre')) {
                        window._waitingTableConfirm = true;
                    }
                }
            }
            break;
        }

        case 'conversation.item.input_audio_transcription.completed':
            if (event.transcript) {
                const text = event.transcript.trim();
                console.log('🎤 Usuario:', text);

                // Wake word check
                if (!vikiAwake) {
                    if (checkWakeWord(text)) {
                        activateViki();
                        // Enviar el texto con instrucción de idioma explícita
                        sendRealtimeEvent({
                            type: 'conversation.item.create',
                            item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[RESPONDE EN EL IDIOMA DE ESTE MENSAJE] ${text}` }] }
                        });
                        sendRealtimeEvent({ type: 'response.create' });
                    }
                    break; // dormida — ignorar todo lo demás
                }

                // Activa — resetear timer y procesar normalmente
                resetWakeTimer();
                addSessionMessage('user', text);
                extractUserData(text);

                const CLOSE_KW = ['cerrar', 'quita', 'cierra', 'oculta', 'stop', 'quítalo', 'quitalo'];
                if (CLOSE_KW.some(w => text.toLowerCase().includes(w))) hideVideo();

                if (pendingVideoId && videoOffered) {
                    if (checkUserConfirmation(text)) {
                        showVideo(pendingVideoId, pendingVideoLabel, pendingVideoType);
                        pendingVideoId = null; videoOffered = false;
                    } else if (checkUserRejection(text)) {
                        pendingVideoId = null; videoOffered = false;
                    }
                }

                if (!pendingVideoId) detectVideoPending(text, false);

                // Mostrar tabla si usuario la pide directamente o confirma la propuesta de Viki
                const tableKeywords = ['tabla', 'comparativa', 'visual', 'muéstrame algo', 'muestrame algo', 'ver las diferencias', 'ver los seguros'];
                const userConfirms = ['sí', 'si', 'claro', 'dale', 'venga', 'por favor', 'ok', 'perfecto'];
                const userWantsTable = tableKeywords.some(w => text.toLowerCase().includes(w));
                const userConfirmsTable = window._waitingTableConfirm && userConfirms.some(w => text.toLowerCase().includes(w));
                if (userWantsTable || userConfirmsTable) {
                    window._waitingTableConfirm = false;
                    setTimeout(() => showPDFViewer(), 600);
                }
            }
            break;

        case 'input_audio_buffer.speech_started':
            if (vikiAwake) resetWakeTimer();
            speechStartTime = Date.now(); // registrar cuándo empezó el habla
            if (!isSpeaking) applyExpression('listening');
            break;

        case 'input_audio_buffer.speech_stopped':
            if (!vikiAwake) break; // dormida — ignorar
            // Dejar que el VAD de OpenAI gestione la interrupción automáticamente
            speechStartTime = null;
            if (!isSpeaking) {
                applyExpression('thinking');
                loadingEl.classList.remove('hidden');
                loadingEl.textContent = 'Viky está pensando...';
            }
            break;

        case 'response.audio_transcript.delta': {
            const deltaText = event.delta || '';
            const newEntries = buildTimelineFromText(deltaText);
            if (newEntries.length > 0) {
                const offset = lipsyncTimeline.length > 0
                    ? lipsyncTimeline[lipsyncTimeline.length - 1].end : 0;
                newEntries.forEach(e => {
                    lipsyncTimeline.push({ start: e.start + offset, end: e.end + offset, visemes: e.visemes });
                });
            }
            break;
        }

        case 'response.created':
    console.log('🔵 response.created, vikiAwake:', vikiAwake);
    if (!vikiAwake) {
        // Dormida — cancelar respuesta que OpenAI generó automáticamente
        sendRealtimeEvent({ type: 'response.cancel' });
        break;
            }
            lipsyncTimeline = [];
            lipsyncStartTime = null;
            loadingEl.classList.add('hidden');
            break;

        case 'error':
            // Ignorar error de cancelación cuando no hay respuesta activa (condición de carrera normal)
            if (event.error?.code === 'response_cancel_not_active') break;
            console.error('❌ Realtime error:', event.error);
            statusEl.textContent = `❌ ${event.error?.message || 'Error'}`;
            break;
    }
}

function sendTextMessage(text) {
    if (!realtimeReady) { console.warn('Realtime no listo todavía'); return; }
    addSessionMessage('user', text);
    extractUserData(text);
    sendRealtimeEvent({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    });
    sendRealtimeEvent({ type: 'response.create' });
}

// AudioContext helper
function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.1;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        reverbNode = audioContext.createConvolver();
        const rate = audioContext.sampleRate;
        const impulse = audioContext.createBuffer(2, rate * 1.5, rate);
        for (let i = 0; i < impulse.length; i++) {
            const decay = Math.exp(-i / rate * 4);
            impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * decay;
            impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * decay;
        }
        reverbNode.buffer = impulse;

        wetGainNode = audioContext.createGain();
        wetGainNode.gain.value = 0.08;
        dryGainNode = audioContext.createGain();
        dryGainNode.gain.value = 1.0;

        // Routing fijo: analyser → dry/wet → destino
        analyser.connect(dryGainNode);
        analyser.connect(reverbNode);
        reverbNode.connect(wetGainNode);
        wetGainNode.connect(audioContext.destination);
        dryGainNode.connect(audioContext.destination);

        console.log('🔈 AudioContext listo');
    }
    if (audioContext.state === 'suspended') audioContext.resume();
}

// Primer click: desbloquear audio + iniciar Realtime
let realtimeStarted = false;
const unlockAndStart = async () => {
    ensureAudioContext();
    await ensureCamera();
    if (!realtimeStarted) {
        realtimeStarted = true;
        await initRealtime();
    }
    window.removeEventListener('click', unlockAndStart);
    window.removeEventListener('touchstart', unlockAndStart);
};
window.addEventListener('click', unlockAndStart, { once: true });
window.addEventListener('touchstart', unlockAndStart, { once: true });

// Botón micrófono: mute/unmute
micBtn.addEventListener('click', () => {
    ensureAudioContext();
    if (!localStream) return;
    isMicrophoneActive = !isMicrophoneActive;
    localStream.getAudioTracks().forEach(t => { t.enabled = isMicrophoneActive; });
    micBtn.style.background = isMicrophoneActive ? '#FF4136' : '#00ff88';
    applyExpression(isMicrophoneActive ? 'listening' : 'neutral');
});

// Enviar texto manual
sendBtn.addEventListener('click', () => {
    ensureAudioContext();
    const text = chatInput.value.trim();
    if (text) { sendTextMessage(text); chatInput.value = ''; }
});
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        ensureAudioContext();
        const text = chatInput.value.trim();
        if (text) { sendTextMessage(text); chatInput.value = ''; }
    }
});

// =============================================================================
// LIPSYNC POR ENERGÍA FFT
// =============================================================================
function updateLipsyncFromFFT() {
    if (!analyser || !dataArray) return;
    analyser.getByteFrequencyData(dataArray);

    let lowFreq = 0, midFreq = 0;
    for (let i = 2; i < 20; i++) lowFreq += dataArray[i];
    lowFreq = (lowFreq / 18 / 128) * 3.0;
    for (let i = 20; i < 60; i++) midFreq += dataArray[i];
    midFreq = (midFreq / 40 / 128) * 2.2;


    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;

        // Buscar keys reales del modelo (case-insensitive)
        const findKey = (name) => Object.keys(dict).find(k => k.toLowerCase() === name.toLowerCase());

        const keyA   = findKey('visema_a');
        const keySil = findKey('visema_sil');
        const keyJaw = findKey('jawOpen');
        const keyE   = findKey('visema_e');
        const keyO   = findKey('visema_o');

        const applyDirect = (key, val) => {
            if (!key) return;
            const idx = dict[key];
            if (idx === undefined) return;
            const fullKey = `${mesh.name}_${key}`;
            morphTargetValues[fullKey] = val;
            // Aplicar también directo por si el LERP tiene algún bloqueo
            mesh.morphTargetInfluences[idx] = val;
        };

        // threshold bajo (0.12) para capturar silencios entre sílabas también
        const speakingNow = lowFreq > 0.12;
        applyDirect(keyA,   speakingNow ? Math.min(lowFreq * 0.18, 0.80) : 0);
        applyDirect(keySil, speakingNow ? 0 : 1.0);
        applyDirect(keyJaw, speakingNow ? Math.min(lowFreq * 0.06, 0.40) : 0);
        applyDirect(keyE,   midFreq > 0.15 ? Math.min(midFreq * 0.12, 0.35) : 0);
        applyDirect(keyO,   midFreq > 0.15 ? Math.min(midFreq * 0.09, 0.30) : 0);
    });
}

// =============================================================================
// FACE TRACKING + GAZE
// =============================================================================
let gazeTargetX = 0, gazeTargetY = 0, gazeCurrentX = 0, gazeCurrentY = 0;
let detectedFaces = [], gazeAlternateIdx = 0, gazeAlternateTimer = 0;
let facePresenceTimer = 0, noFaceTimer = 0, hasGreetedCurrentFace = false;
let headNoiseT = 0;

async function startFaceTracking() {
    if (!videoElement || !cameraActive) return;
    if (typeof FaceDetection === 'undefined') { console.warn('MediaPipe no cargado'); return; }

    const faceDetection = new FaceDetection({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
    });
    faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.5 });
    faceDetection.onResults((results) => {
        detectedFaces = results.detections?.length
            ? results.detections.map(d => ({
                x: ((d.boundingBox.xCenter || 0.5) - 0.5) * 2,
                y: -((d.boundingBox.yCenter || 0.5) - 0.5) * 2
            }))
            : [];
    });

    setInterval(async () => {
        if (!videoElement || videoElement.readyState < 2) return;
        try { await faceDetection.send({ image: videoElement }); } catch (e) { }
    }, 200);

    console.log('✅ Face tracking iniciado');
}

function updateGaze(dt) {
    gazeAlternateTimer += dt;
    let targetFace = null;

    if (detectedFaces.length === 1) {
        targetFace = detectedFaces[0];
    } else if (detectedFaces.length >= 2) {
        if (gazeAlternateTimer > 3.5 + Math.random() * 1.5) { gazeAlternateIdx = 1 - gazeAlternateIdx; gazeAlternateTimer = 0; }
        targetFace = detectedFaces[Math.min(gazeAlternateIdx, detectedFaces.length - 1)];
    }

    if (targetFace) {
        gazeTargetX = Math.max(-0.6, Math.min(0.6, targetFace.x * 0.5));
        gazeTargetY = Math.max(-0.3, Math.min(0.4, targetFace.y * 0.3));
        noFaceTimer = 0;

        if (!hasGreetedCurrentFace && !isSpeaking && sessionMessages.length === 0) {
            facePresenceTimer += dt;
            if (facePresenceTimer > 4.0) {
                hasGreetedCurrentFace = true;
                loadingEl.classList.remove('hidden');
                loadingEl.textContent = 'Viky te ha visto...';
                sendTextMessage('(Contexto: nueva persona mirando fijamente en silencio. Salúdalo proactivamente, rompe el hielo con algo divertido o sarcástico sobre que te está mirando pero no habla)');
            }
        }
    } else {
        gazeTargetX = Math.sin(headNoiseT * 0.4) * 0.08;
        gazeTargetY = Math.sin(headNoiseT * 0.6) * 0.04;
        noFaceTimer += dt;
        if (noFaceTimer > 5.0) { hasGreetedCurrentFace = false; facePresenceTimer = 0; }
    }

    gazeCurrentX += (gazeTargetX - gazeCurrentX) * 0.05;
    gazeCurrentY += (gazeTargetY - gazeCurrentY) * 0.05;

    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;
        const gazeMap = [
            { keys: ['eyelookoutleft', 'eyelookoutright'], val: gazeCurrentX > 0 ? gazeCurrentX : 0 },
            { keys: ['eyelookinleft', 'eyelookinright'], val: gazeCurrentX < 0 ? -gazeCurrentX : 0 },
            { keys: ['eyelookupleft', 'eyelookupright'], val: gazeCurrentY > 0 ? gazeCurrentY : 0 },
            { keys: ['eyelookdownleft', 'eyelookdownright'], val: gazeCurrentY < 0 ? -gazeCurrentY : 0 },
        ];
        gazeMap.forEach(({ keys, val }) => {
            keys.forEach(k => {
                const found = Object.keys(dict).find(dk => dk.toLowerCase() === k);
                if (found !== undefined) {
                    const idx = dict[found];
                    mesh.morphTargetInfluences[idx] += (val - mesh.morphTargetInfluences[idx]) * 0.08;
                }
            });
        });
    });
}

// =============================================================================
// MORPHS Y EXPRESIONES
// =============================================================================
function setVisema(name, value) {
    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;
        let targetKey = null;
        if (name === 'a') targetKey = Object.keys(dict).find(k => k.toLowerCase().includes('visema_a'));
        if (name === 'p') targetKey = Object.keys(dict).find(k => k.toLowerCase().includes('visema_p'));
        if (name === 'sil') targetKey = Object.keys(dict).find(k => k.toLowerCase().includes('visema_sil'));
        if (targetKey && dict[targetKey] !== undefined) morphTargetValues[`${mesh.name}_${targetKey}`] = value;
    });
}

function setupDynamicMorphs(mesh) {
}

function setupIdleAnimations(mesh) {
    if (mesh.morphTargetDictionary) {
        startBlinkLoop();
        startEyeLoop();
        startExpressionLoop();
        startMicroExpressions();
    }
}

function startMicroExpressions() {
    setInterval(() => {
        if (!window.animatableMeshes || isSpeaking) return;
        window.animatableMeshes.forEach(mesh => {
            const dict = mesh.morphTargetDictionary;
            if (!dict) return;
            ['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'].forEach(k => {
                if (dict[k] !== undefined) {
                    const cur = morphTargetValues[`${mesh.name}_${k}`] || 0;
                    morphTargetValues[`${mesh.name}_${k}`] = Math.max(0, Math.min(0.3, cur + (Math.random() - 0.5) * 0.06));
                }
            });
            ['cheekSquintLeft', 'cheekSquintRight'].forEach(k => {
                if (dict[k] !== undefined) {
                    const cur = morphTargetValues[`${mesh.name}_${k}`] || 0;
                    morphTargetValues[`${mesh.name}_${k}`] = Math.max(0, Math.min(0.15, cur + (Math.random() - 0.5) * 0.03));
                }
            });
        });
    }, 600);
}

function setEyeOpen(value) {
    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;
        ['eyeWideLeft', 'eyeWideRight'].forEach(k => {
            if (dict[k] !== undefined) morphTargetValues[`${mesh.name}_${k}`] = value;
        });
    });
}

function startEyeLoop() {
    setEyeOpen(0.05);
    function scheduleNextLook() {
        setTimeout(() => {
            if (!window.animatableMeshes) { scheduleNextLook(); return; }
            const lookTargets = [
                { eyeLookInLeft: 0.25, eyeLookInRight: 0.25 },
                { eyeLookInLeft: 0.25, eyeLookInRight: 0.25 },
                { eyeLookOutLeft: 0.2, eyeLookOutRight: 0.0 },
                { eyeLookOutLeft: 0.0, eyeLookOutRight: 0.2 },
                { eyeLookUpLeft: 0.15, eyeLookUpRight: 0.15 },
                { eyeLookDownLeft: 0.1, eyeLookDownRight: 0.1 },
                {}
            ];
            const chosen = lookTargets[Math.floor(Math.random() * lookTargets.length)];
            window.animatableMeshes.forEach(mesh => {
                const d = mesh.morphTargetDictionary;
                ['eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
                    'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight'].forEach(k => {
                        if (d[k] !== undefined) morphTargetValues[`${mesh.name}_${k}`] = chosen[k] || 0;
                    });
            });
            scheduleNextLook();
        }, Math.random() * 2000 + 800);
    }
    scheduleNextLook();
}

function startExpressionLoop() {
    function scheduleNext() {
        setTimeout(() => {
            if (!isSpeaking) {
                const exprs = ['neutral', 'neutral', 'neutral', 'smile', 'smile', 'thinking', 'listening', 'empathetic'];
                applyExpression(exprs[Math.floor(Math.random() * exprs.length)]);
            }
            scheduleNext();
        }, Math.random() * 6000 + 4000);
    }
    scheduleNext();
}

function applyExpression(expr) {
    if (!window.animatableMeshes) return;
    const EXPRESSION_MORPHS = [
        'mouthSmileLeft', 'mouthSmileRight', 'mouthDimpleLeft', 'mouthDimpleRight',
        'mouthFrownLeft', 'mouthFrownRight', 'mouthStretchLeft', 'mouthStretchRight',
        'mouthShrugLower', 'mouthShrugUpper', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
        'browDownLeft', 'browDownRight', 'cheekSquintLeft', 'cheekSquintRight', 'cheekPuff',
        'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'noseSneerLeft', 'noseSneerRight',
    ];
    const targets = {
        neutral:    { mouthSmileLeft: 0.15, mouthSmileRight: 0.15 },
        laughing:   { mouthSmileLeft: 0.75, mouthSmileRight: 0.75, jawOpen: 0.20, mouthDimpleLeft: 0.40, mouthDimpleRight: 0.40, cheekSquintLeft: 0.60, cheekSquintRight: 0.60, eyeSquintLeft: 0.35, eyeSquintRight: 0.35 },
        smile:      { mouthSmileLeft: 0.45, mouthSmileRight: 0.45, mouthDimpleLeft: 0.20, mouthDimpleRight: 0.20, cheekSquintLeft: 0.35, cheekSquintRight: 0.35, eyeSquintLeft: 0.20, eyeSquintRight: 0.20 },
        thinking:   { mouthSmileLeft: 0.15, mouthSmileRight: 0.15, browDownLeft: 0.35, browInnerUp: 0.40, eyeSquintLeft: 0.10 },
        listening:  { mouthSmileLeft: 0.20, mouthSmileRight: 0.20, browInnerUp: 0.28, browOuterUpLeft: 0.12, browOuterUpRight: 0.12 },
        excited:    { mouthSmileLeft: 0.65, mouthSmileRight: 0.65, cheekSquintLeft: 0.50, cheekSquintRight: 0.50, eyeWideLeft: 0.20, eyeWideRight: 0.20 },
        empathetic: { mouthSmileLeft: 0.15, mouthSmileRight: 0.15, browInnerUp: 0.45, browDownLeft: 0.15, browDownRight: 0.15 },
        speaking:   { mouthSmileLeft: 0.22, mouthSmileRight: 0.22, browInnerUp: 0.22, browOuterUpLeft: 0.08, browOuterUpRight: 0.08 },
    };
    const morphs = targets[expr] || targets.neutral;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;
        EXPRESSION_MORPHS.forEach(k => { if (dict[k] !== undefined) morphTargetValues[`${mesh.name}_${k}`] = 0; });
        Object.keys(morphs).forEach(k => { if (dict[k] !== undefined) morphTargetValues[`${mesh.name}_${k}`] = morphs[k]; });
    });
}

function applySpeakingExpression() { applyExpression('speaking'); setEyeOpen(0.15); }
function applyIdleExpression() { applyExpression('neutral'); setEyeOpen(0.05); }

function applyEmotionFromText(text) {
    const t = text.toLowerCase();
    if (t.includes('jaja') || t.includes('jeje')) { applyExpression('laughing'); setTimeout(() => applyExpression('smile'), 3500); }
    else if (t.includes('!') && (t.includes('genial') || t.includes('increíble') || t.includes('perfecto'))) applyExpression('excited');
    else if (t.includes('entiendo') || t.includes('comprendo')) applyExpression('empathetic');
    else if (t.includes('?') || t.includes('hmm') || t.includes('interesante')) applyExpression('thinking');
    else applyExpression('listening');
}

function startBlinkLoop() {
    setTimeout(() => {
        if (!window.animatableMeshes) { startBlinkLoop(); return; }
        window.animatableMeshes.forEach(mesh => {
            const dict = mesh.morphTargetDictionary;
            if (!dict) return;
            const blinkKey = Object.keys(dict).find(k => k.toLowerCase().includes('blink') && !k.toLowerCase().includes('left') && !k.toLowerCase().includes('right')) ||
                Object.keys(dict).find(k => k.toLowerCase().includes('close'));
            if (blinkKey) {
                const idx = dict[blinkKey];
                mesh.morphTargetInfluences[idx] = 1;
                setTimeout(() => { mesh.morphTargetInfluences[idx] = 0; }, 120);
                if (Math.random() < 0.15) setTimeout(() => {
                    mesh.morphTargetInfluences[idx] = 1;
                    setTimeout(() => { mesh.morphTargetInfluences[idx] = 0; }, 120);
                }, 300);
            }
        });
        startBlinkLoop();
    }, Math.random() * 3000 + 2000);
}

// =============================================================================
// MEMORIA + PDF
// =============================================================================
const MEMORY_KEY = 'viki1_memory';
let sessionMessages = [];

function saveMemory(data) {
    try {
        const existing = getMemory();
        localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...existing, ...data, lastSeen: new Date().toISOString() }));
    } catch (e) { }
}
function getMemory() {
    try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}'); } catch (e) { return {}; }
}
function addSessionMessage(role, content) {
    sessionMessages.push({ role, content });
    if (sessionMessages.length > 30) sessionMessages.splice(0, 10);
}
function extractUserData(text) {
    // Normalizar "arroba" → "@"
    const normalizedText = text.replace(/\sarroba\s/gi, "@").replace(/\sarroba/gi, "@").replace(/\spunto\s/gi, ".").replace(/\spunto/gi, ".");
    let emailMatch = normalizedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) {
        // Detectar cualquier patron usuario.dominio.tld sin @ — funciona con cualquier empresa
        const noAtMatch = normalizedText.match(/\b([a-zA-Z0-9._%+-]+)\.([a-zA-Z0-9-]+)\.(com|es|net|org|io|live|co|eu|info|biz)\b/i);
        if (noAtMatch) emailMatch = [`${noAtMatch[1]}@${noAtMatch[2]}.${noAtMatch[3]}`];
    }
    if (emailMatch) {
        saveMemory({ email: emailMatch[0] });
        // Solo enviar cuando detectamos email nuevo en este mensaje
        const mem = getMemory();
        const nameMatch2 = text.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/i);
        if (nameMatch2) saveMemory({ name: nameMatch2[1] });
        const companyMatch2 = text.match(/(?:trabajo en|soy de|mi empresa es|vengo de|represento a)\s+([\w\s&]+?)(?:[.,]|$)/i);
        if (companyMatch2) saveMemory({ company: companyMatch2[1].trim() });
        sendLead(getMemory());
        return;
    }
    const nameMatch = text.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/i);
    if (nameMatch) saveMemory({ name: nameMatch[1] });
    const companyMatch = text.match(/(?:trabajo en|soy de|mi empresa es|vengo de|represento a)\s+([\w\s&]+?)(?:[.,]|$)/i);
    if (companyMatch) saveMemory({ company: companyMatch[1].trim() });
}

async function sendLead(mem) {
    try {
        const conversacion = sessionMessages
            .map(m => `${m.role === 'user' ? 'Visitante' : 'Viky'}: ${m.content}`)
            .join('\n');
        await fetch('/.netlify/functions/send-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: mem.name || '',
                empresa: mem.company || '',
                email: mem.email || '',
                tema: '',
                conversacion,
            }),
        });
        console.log('📧 Lead enviado');
    } catch (e) {
        console.error('❌ Error enviando lead:', e);
    }
}

function generatePDF() {
    const msgs = sessionMessages;
    let content = `CONVERSACIÓN CON VIKI - FLUGE AUDIOVISUALES\nFecha: ${new Date().toLocaleDateString('es-ES')}\n\n`;
    msgs.forEach(m => { content += `${m.role === 'user' ? 'TÚ' : 'VIKI'}: ${m.content}\n\n`; });
    content += `\nViki by IMMERSO | immerso.live | Powered by Girasomnis | girasomnis.com\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Viki_Fluge_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadConversationPDF() {
    if (sessionMessages.length === 0) return;
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(16); doc.setTextColor(0, 180, 200);
        doc.text('CONVERSACIÓN CON VIKI', 20, 20);
        doc.setFontSize(10); doc.setTextColor(100);
        doc.text('Fluge Audiovisuales', 20, 28);
        doc.text(`Fecha: ${new Date().toLocaleString('es-ES')}`, 20, 34);
        doc.setDrawColor(0, 180, 200); doc.line(20, 38, 190, 38);

        // Datos del lead
        const mem = loadMemory();
        let y = 46;
        if (mem.name || mem.email || mem.company) {
            doc.setFontSize(11); doc.setTextColor(0, 130, 150);
            doc.setFont(undefined, 'bold'); doc.text('DATOS DEL CONTACTO', 20, y); y += 7;
            doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40); doc.setFontSize(10);
            if (mem.name)    { doc.text(`Nombre:  ${mem.name}`, 20, y); y += 6; }
            if (mem.company) { doc.text(`Empresa: ${mem.company}`, 20, y); y += 6; }
            if (mem.email)   { doc.text(`Email:   ${mem.email}`, 20, y); y += 6; }
            doc.setDrawColor(0, 180, 200); doc.line(20, y + 2, 190, y + 2); y += 10;
        }
        doc.setFontSize(11);
        sessionMessages.forEach(m => {
            const who = m.role === 'user' ? 'Tú' : 'Viki';
            doc.setTextColor(...(m.role === 'user' ? [40, 40, 40] : [0, 130, 150]));
            doc.setFont(undefined, 'bold'); doc.text(`${who}:`, 20, y);
            doc.setFont(undefined, 'normal'); doc.setTextColor(60, 60, 60);
            doc.splitTextToSize(m.content, 160).forEach(line => {
                if (y > 270) { doc.addPage(); y = 20; }
                doc.text(line, 30, y); y += 6;
            });
            y += 4;
        });
        doc.save(`conversacion-viki-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) { generatePDF(); }
}

const downloadBtn = document.getElementById('download-btn');
if (downloadBtn) downloadBtn.addEventListener('click', downloadConversationPDF);
const pdfBtn = document.getElementById('pdf-btn');
if (pdfBtn) pdfBtn.addEventListener('click', downloadConversationPDF);
function showPdfBtn() { if (pdfBtn) pdfBtn.classList.remove('hidden'); }
function checkDownloadRequest(text) {
    return ['descargar', 'guardar conversacion', 'pdf', 'resumen'].some(w => text.toLowerCase().includes(w));
}

// =============================================================================
// VIDEO PANEL
// =============================================================================
const MEDIA_CATALOG = [
    { type: 'video', id: 'UGdVEh-7wM0', keywords: ['mapping', 'proyecci', 'videomapping'], label: 'Video Mapping · Ayuntamiento Sevilla' },
    { type: 'video', id: 'yr-ZIEPZKOY', keywords: ['escenario', 'gira', 'stage', 'concierto'], label: 'Next Stage · Escenario Sostenible' },
    { type: 'video', id: 'Gv0h7sqsj5k', keywords: ['interactiv', 'experiencia', 'inmersiv'], label: 'Experiencia Interactiva' },
    { type: 'video', id: 'B9wqSpSo9JQ', keywords: ['realidad aumentada', ' ar ', 'exposici', 'museo'], label: 'Realidad Aumentada' },
    { type: 'video', id: '4zPD6AUbhfk', keywords: ['iluminaci', 'luz', 'luces', 'lighting'], label: 'Iluminación · Fluge' },
    { type: 'image', url: 'https://www.fluge.es/wp-content/uploads/2021/05/logo_fluge_audiovisuales_definitivo.png', keywords: ['imagen corporativa', 'logo fluge'], label: 'Imagen Corporativa Fluge' }
];

let pendingVideoId = null, pendingVideoLabel = null, pendingVideoType = null, videoOffered = false;
let vikiBroposalCount = 0, vikiLastProposalTime = null, autoCloseVideoTimer = null;
const VIKI_MAX_PROPOSALS = 2, VIKI_PROPOSAL_COOLDOWN = 30 * 60 * 1000;

const videoPanel = document.getElementById('video-panel');
const videoFrame = document.getElementById('video-frame');
const videoLabel = document.getElementById('video-label');
const videoClose = document.getElementById('video-close');
if (videoClose) videoClose.addEventListener('click', hideVideo);

function hideVideo() {
    if (!videoPanel) return;
    videoPanel.classList.remove('visible');
    videoPanel.classList.add('hidden');
    if (videoFrame) videoFrame.src = '';
    const imgFrame = document.getElementById('image-frame');
    if (imgFrame) imgFrame.style.display = 'none';
    if (autoCloseVideoTimer) { clearTimeout(autoCloseVideoTimer); autoCloseVideoTimer = null; }
}

function showVideo(mediaIdOrUrl, label, type = 'video') {
    if (!videoPanel || !videoFrame) return;
    if (videoLabel) videoLabel.textContent = label || 'Proyecto Fluge';
    let imgFrame = document.getElementById('image-frame');
    if (!imgFrame) {
        imgFrame = document.createElement('img');
        imgFrame.id = 'image-frame';
        imgFrame.style.cssText = 'width:100%;height:100%;object-fit:contain;display:none;';
        videoFrame.parentNode.appendChild(imgFrame);
    }
    if (type === 'video') {
        videoFrame.src = `https://www.youtube.com/embed/${mediaIdOrUrl}?autoplay=1&enablejsapi=1`;
        videoFrame.style.display = 'block'; imgFrame.style.display = 'none'; imgFrame.src = '';
    } else {
        imgFrame.src = mediaIdOrUrl;
        imgFrame.style.display = 'block'; videoFrame.style.display = 'none'; videoFrame.src = '';
    }
    videoPanel.classList.remove('hidden');
    videoPanel.classList.add('visible');
    if (autoCloseVideoTimer) clearTimeout(autoCloseVideoTimer);
    if (type !== 'video') autoCloseVideoTimer = setTimeout(() => hideVideo(), 60000);
}

function detectVideoPending(text, fromViki = false) {
    const lower = text.toLowerCase();
    for (const m of MEDIA_CATALOG) {
        if (m.keywords.some(k => lower.includes(k))) {
            if (fromViki) {
                const now = Date.now();
                if (vikiBroposalCount >= VIKI_MAX_PROPOSALS) return false;
                if (vikiLastProposalTime && (now - vikiLastProposalTime) < VIKI_PROPOSAL_COOLDOWN) return false;
                vikiBroposalCount++; vikiLastProposalTime = now;
            }
            pendingVideoId = m.type === 'video' ? m.id : m.url;
            pendingVideoLabel = m.label; pendingVideoType = m.type;
            return true;
        }
    }
    return false;
}

function checkUserConfirmation(text) {
    return ['sí', 'si', 'claro', 'dale', 'venga', 'muéstrame', 'muestrame', 'por supuesto', 'ok', 'quiero ver', 'ponlo'].some(w => text.toLowerCase().includes(w));
}
function checkUserRejection(text) {
    return ['no quiero', 'no gracias', 'no hace falta', 'no me interesa', 'da igual', 'déjalo', 'dejalo'].some(w => text.toLowerCase().includes(w));
}

window.addEventListener('message', (event) => {
    if (!event.origin.includes('youtube.com')) return;
    try { const d = JSON.parse(event.data); if (d.event === 'onStateChange' && d.info === 0) hideVideo(); } catch (e) { }
});

// =============================================================================
// SUELO SUTIL
// =============================================================================
const floorGeo = new THREE.PlaneGeometry(8, 8);
const floorMat = new THREE.MeshStandardMaterial({
    color: 0x000510,
    metalness: 0.95,
    roughness: 0.05,
    transparent: true,
    opacity: 0.4,
});
const meshFloor = new THREE.Mesh(floorGeo, floorMat);
meshFloor.rotation.x = -Math.PI / 2;
meshFloor.position.y = -0.82;
scene.add(meshFloor);

// =============================================================================
// PARTÍCULAS CAYENDO
// =============================================================================
const fallingParticles = [];
const FP_COUNT = 28;
const fpPositions = new Float32Array(FP_COUNT * 3);
const fpGeo = new THREE.BufferGeometry();
fpGeo.setAttribute('position', new THREE.BufferAttribute(fpPositions, 3));
const fpMat = new THREE.PointsMaterial({ color: 0x00ffff, size: 0.035, transparent: true, opacity: 1.0 });
const fpPoints = new THREE.Points(fpGeo, fpMat);
scene.add(fpPoints);

for (let i = 0; i < FP_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 0.85 + Math.random() * 0.35;
    fallingParticles.push({
        x: Math.cos(angle) * r,
        y: 0.8 + Math.random() * 1.2,
        z: Math.sin(angle) * r * 0.15,
        speed: 0.003 + Math.random() * 0.006,
        opacity: Math.random(),
        r,
    });
}

function updateFallingParticles() {
    for (let i = 0; i < FP_COUNT; i++) {
        const p = fallingParticles[i];
        p.y -= p.speed;
        if (p.y < -0.9) {
            const angle = Math.random() * Math.PI * 2;
            p.r = 0.85 + Math.random() * 0.35;
            p.x = Math.cos(angle) * p.r;
            p.z = Math.sin(angle) * p.r * 0.15;
            p.y = 0.8 + Math.random() * 0.8;
            p.speed = 0.003 + Math.random() * 0.006;
        }
        fpPositions[i * 3]     = p.x;
        fpPositions[i * 3 + 1] = p.y;
        fpPositions[i * 3 + 2] = p.z;
    }
    fpGeo.attributes.position.needsUpdate = true;
}

// =============================================================================
// LOOP PRINCIPAL
// =============================================================================
function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001;

    if (isSpeaking) updateLipsyncFromTimeline();

    if (window.animatableMeshes) {
        window.animatableMeshes.forEach(mesh => {
            const dict = mesh.morphTargetDictionary;
            if (!dict) return;
            Object.keys(dict).forEach(key => {
                const fullKey = `${mesh.name}_${key}`;
                const idx = dict[key];
                const cleanKey = key.toLowerCase();
                if (cleanKey === 'mouthclose' || cleanKey.includes('blink') || cleanKey.includes('eyewide')) return;

                const target = morphTargetValues[fullKey] || 0;
                if (currentMorphInfluences[fullKey] === undefined) currentMorphInfluences[fullKey] = 0;

                if (cleanKey === 'jawopen') {
                    const speed = target > currentMorphInfluences[fullKey] ? 0.22 : 0.10;
                    currentMorphInfluences[fullKey] += (target - currentMorphInfluences[fullKey]) * speed;
                } else {
                    const isExpr = cleanKey.includes('mouthsmile') || cleanKey.includes('brow') || cleanKey.includes('cheeksquint');
                    const speed = isExpr ? 0.06 : cleanKey.includes('visema') ? 0.35 : 0.12;
                    currentMorphInfluences[fullKey] += (target - currentMorphInfluences[fullKey]) * speed;
                }
                mesh.morphTargetInfluences[idx] = Math.max(0, currentMorphInfluences[fullKey]);
            });
        });
    }

    // Movimiento de cabeza
    headNoiseT += 0.008;
    if (window.vikiModel) {
        let hx, hy, hz;
        if (isSpeaking && analyser && dataArray) {
            analyser.getByteTimeDomainData(dataArray);
            let rms = 0;
            for (let s = 0; s < dataArray.length; s++) { const v = (dataArray[s] - 128) / 128; rms += v * v; }
            rms = Math.sqrt(rms / dataArray.length);
            hx = -rms * 0.06 + Math.sin(headNoiseT * 1.8) * 0.012;
            hy = Math.sin(headNoiseT * 0.9) * 0.025;
            hz = Math.sin(headNoiseT * 0.6) * 0.010;
        } else {
            hx = Math.sin(headNoiseT * 0.7) * 0.022 + Math.sin(headNoiseT * 1.3) * 0.008;
            hy = Math.sin(headNoiseT * 0.5) * 0.030 + Math.cos(headNoiseT * 0.9) * 0.012;
            hz = Math.sin(headNoiseT * 0.35) * 0.012;
        }
        window.vikiModel.rotation.x += (hx - window.vikiModel.rotation.x) * 0.04;
        window.vikiModel.rotation.y += (hy - window.vikiModel.rotation.y) * 0.04;
        window.vikiModel.rotation.z += (hz - window.vikiModel.rotation.z) * 0.03;
    }

    // Sacadas oculares
    if (window.animatableMeshes) {
        window.animatableMeshes.forEach(mesh => {
            if (mesh.name.toLowerCase().includes('eye')) {
                if (Math.random() < 0.02) { mesh.rotation.x += (Math.random() - 0.5) * 0.03; mesh.rotation.y += (Math.random() - 0.5) * 0.03; }
                mesh.rotation.x *= 0.92; mesh.rotation.y *= 0.92;
            }
        });
    }

    // HUD
    hudElements.forEach(hud => {
        const sm = isSpeaking ? 2.5 : 1.0;
        hud.ring1.rotation.z += hud.rotSpeed1 * sm;
        hud.ring2.rotation.z += hud.rotSpeed2 * sm;
        if (hud.segGroup) hud.segGroup.rotation.z += 0.002 * sm;
        const pulse = Math.sin(time * 1.5) * 0.15 + 0.85;
        hud.ring1.material.opacity = isSpeaking ? 0.06 : 0.02;
        hud.ring2.material.opacity = 0.04 * pulse;
        if (hud.scanner) { hud.scanner.rotation.z += 0.02 * sm; hud.scanner.material.opacity = 0.12 + Math.sin(time * 3) * 0.06; }
        hud.group.rotation.x = Math.sin(time * 0.35) * 0.02;
        hud.group.rotation.y = Math.sin(time * 0.45) * 0.02;
    });

    // Ghost lights
    ghostLights.forEach((obj, i) => {
        if (i === 0) { obj.light.intensity = obj.baseIntensity; }
        else {
            obj.angle += obj.speed;
            obj.light.position.x = Math.cos(obj.angle) * 0.7;
            obj.light.position.z = Math.sin(obj.angle) * 0.7;
            obj.light.position.y = obj.yBase + Math.sin(time + i) * 0.1;
            obj.light.intensity = obj.baseIntensity * 0.28 * (Math.sin(time * 2 + i) * 0.5 + 0.5) * (isSpeaking ? 1.15 : 1.0);
        }
    });

    faceGhosts.forEach(fg => {
        const breath = Math.sin(time * 0.8 + fg.phase) * 0.5 + 0.5;
        fg.light.position.set(fg.baseX + Math.sin(time * 0.4 + fg.phase) * 0.012, fg.baseY + Math.sin(time * 0.3 + fg.phase) * 0.008, fg.baseZ);
        if (!fg.light.userData.baseInt) fg.light.userData.baseInt = fg.light.intensity;
        fg.light.intensity = fg.light.userData.baseInt * (0.4 + 0.6 * breath) * (isSpeaking ? 1.6 : 1.0);
    });

    updateFallingParticles();
    updateGaze(1 / 60);
    controls.update();
    bloomPass.strength = isSpeaking ? 0.35 + Math.sin(time * 8) * 0.04 : 0.2 + Math.sin(time * 1.5) * 0.02;
    composer.render();
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// =============================================================================
// FORMULARIO DE CONTRATACIÓN AXA
// =============================================================================

function injectContractFormStyles() {
    if (document.getElementById('axa-form-styles')) return;
    const style = document.createElement('style');
    style.id = 'axa-form-styles';
    style.textContent = `
        #axa-contract-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
        }
        #axa-contract-panel {
            background: #ffffff;
            border-radius: 16px;
            padding: 36px 40px;
            width: 520px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,75,141,0.35);
            font-family: Arial, sans-serif;
            position: relative;
        }
        #axa-contract-panel .axa-logo-header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 24px;
            padding-bottom: 18px;
            border-bottom: 2px solid #004B8D;
        }
        #axa-contract-panel .axa-logo-header img {
            height: 40px;
        }
        #axa-contract-panel .axa-logo-header span {
            font-size: 18px;
            font-weight: bold;
            color: #004B8D;
        }
        #axa-contract-panel h2 {
            color: #004B8D;
            font-size: 20px;
            margin: 0 0 6px 0;
        }
        #axa-contract-panel p.subtitle {
            color: #666;
            font-size: 13px;
            margin: 0 0 24px 0;
        }
        #axa-contract-panel .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 14px;
        }
        #axa-contract-panel .form-row.full {
            grid-template-columns: 1fr;
        }
        #axa-contract-panel label {
            display: block;
            font-size: 12px;
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }
        #axa-contract-panel input,
        #axa-contract-panel select {
            width: 100%;
            padding: 10px 12px;
            border: 1.5px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
            box-sizing: border-box;
            transition: border-color 0.2s;
            outline: none;
        }
        #axa-contract-panel input:focus,
        #axa-contract-panel select:focus {
            border-color: #004B8D;
        }
        #axa-contract-panel .sepa-box {
            background: #f0f7ff;
            border: 1.5px solid #004B8D;
            border-radius: 10px;
            padding: 14px 16px;
            margin: 18px 0;
            font-size: 13px;
            color: #333;
        }
        #axa-contract-panel .sepa-box strong {
            color: #004B8D;
        }
        #axa-contract-panel .sepa-check {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            margin-top: 10px;
            font-size: 12px;
            color: #555;
            cursor: pointer;
        }
        #axa-contract-panel .sepa-check input[type=checkbox] {
            width: 18px;
            height: 18px;
            min-width: 18px;
            margin-top: 1px;
            cursor: pointer;
        }
        #axa-contract-panel .btn-row {
            display: flex;
            gap: 12px;
            margin-top: 24px;
        }
        #axa-contract-panel .btn-submit {
            flex: 1;
            background: #004B8D;
            color: white;
            border: none;
            border-radius: 10px;
            padding: 14px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.2s;
        }
        #axa-contract-panel .btn-submit:hover {
            background: #003a6e;
        }
        #axa-contract-panel .btn-submit:disabled {
            background: #aaa;
            cursor: not-allowed;
        }
        #axa-contract-panel .btn-cancel {
            background: transparent;
            border: 1.5px solid #ccc;
            border-radius: 10px;
            padding: 14px 20px;
            font-size: 14px;
            color: #666;
            cursor: pointer;
        }
        #axa-contract-panel .btn-cancel:hover {
            border-color: #999;
        }
        #axa-contract-panel .close-btn {
            position: absolute;
            top: 16px; right: 20px;
            background: none;
            border: none;
            font-size: 22px;
            color: #999;
            cursor: pointer;
        }
        #axa-contract-panel .success-msg {
            text-align: center;
            padding: 20px 0;
        }
        #axa-contract-panel .success-msg .check-icon {
            font-size: 56px;
            margin-bottom: 12px;
        }
        #axa-contract-panel .success-msg h3 {
            color: #004B8D;
            font-size: 22px;
            margin: 0 0 8px 0;
        }
        #axa-contract-panel .success-msg p {
            color: #555;
            font-size: 14px;
        }
        #contract-form-btn {
            position: fixed;
            bottom: 80px;
            right: 24px;
            background: #004B8D;
            color: white;
            border: none;
            border-radius: 50px;
            padding: 12px 22px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            z-index: 1000;
            box-shadow: 0 4px 20px rgba(0,75,141,0.4);
            font-family: Arial, sans-serif;
        }
        #contract-form-btn:hover {
            background: #003a6e;
        }
    `;
    document.head.appendChild(style);
}

// =============================================================================
// MINI FORMULARIO DE CONTACTO
// =============================================================================
window.showContactForm = function() { showContactForm(); };
window.closeContactForm = function() { closeContactForm(); };
window.submitContactForm = function() { submitContactForm(); };

function showContactForm() {
    injectContractFormStyles();
    if (document.getElementById('axa-contact-form-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'axa-contact-form-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:36px 40px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,75,141,0.35);font-family:Arial,sans-serif;position:relative;">
            <button onclick="closeContactForm()" style="position:absolute;top:16px;right:20px;background:none;border:none;font-size:22px;color:#999;cursor:pointer;">✕</button>
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;padding-bottom:18px;border-bottom:2px solid #004B8D;">
                <img src="axa_logo.png" alt="AXA" style="height:40px;" onerror="this.style.display='none'"/>
                <span style="font-size:18px;font-weight:bold;color:#004B8D;">Un asesor te contactará</span>
            </div>
            <p style="color:#666;font-size:13px;margin:0 0 20px 0;">Déjanos tus datos y te llamamos en menos de 24 horas.</p>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:bold;color:#333;margin-bottom:5px;">Nombre *</label>
                <input type="text" id="cc-nombre" placeholder="María García" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;" />
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:bold;color:#333;margin-bottom:5px;">Teléfono *</label>
                <input type="tel" id="cc-telefono" placeholder="600 000 000" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;" />
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;font-weight:bold;color:#333;margin-bottom:5px;">Email *</label>
                <input type="email" id="cc-email" placeholder="maria@email.com" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;" />
            </div>
            <div style="margin-bottom:24px;">
                <label style="display:block;font-size:12px;font-weight:bold;color:#333;margin-bottom:5px;">¿Qué seguro te interesa?</label>
                <select id="cc-producto" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;">
                    <option value="">— Selecciona —</option>
                    <option>Seguro de Salud</option>
                    <option>Seguro de Coche</option>
                    <option>Seguro de Hogar</option>
                    <option>Seguro de Vida</option>
                    <option>Varios / No sé aún</option>
                </select>
            </div>
            <div style="display:flex;gap:12px;">
                <button onclick="closeContactForm()" style="background:transparent;border:1.5px solid #ccc;border-radius:10px;padding:14px 20px;font-size:14px;color:#666;cursor:pointer;">Cancelar</button>
                <button onclick="submitContactForm()" id="cc-submit-btn" style="flex:1;background:#004B8D;color:white;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:bold;cursor:pointer;">📞 Solicitar llamada</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function closeContactForm() {
    const el = document.getElementById('axa-contact-form-overlay');
    if (el) el.remove();
}

async function submitContactForm() {
    const nombre = document.getElementById('cc-nombre')?.value.trim();
    const telefono = document.getElementById('cc-telefono')?.value.trim();
    const email = document.getElementById('cc-email')?.value.trim();
    const producto = document.getElementById('cc-producto')?.value;
    if (!nombre || !telefono || !email) { alert('Por favor, rellena nombre, teléfono y email.'); return; }
    const btn = document.getElementById('cc-submit-btn');
    btn.disabled = true; btn.textContent = 'Enviando...';
    try {
        const res = await fetch('/.netlify/functions/send-contact-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, telefono, email, producto })
        });
        if (res.ok) {
            document.querySelector('#axa-contact-form-overlay > div').innerHTML = `
                <div style="text-align:center;padding:20px 0;">
                    <div style="font-size:56px;margin-bottom:12px;">✅</div>
                    <h3 style="color:#004B8D;font-size:22px;margin:0 0 8px 0;">¡Perfecto, ${nombre}!</h3>
                    <p style="color:#555;font-size:14px;">Un asesor de AXA te contactará pronto en el <strong>${telefono}</strong>.</p>
                    <button onclick="closeContactForm()" style="margin-top:20px;background:#004B8D;color:white;border:none;border-radius:8px;padding:12px 28px;font-size:15px;cursor:pointer;">Cerrar</button>
                </div>`;
            const msgContacto = nombre + ' ha dejado sus datos de contacto. Teléfono: ' + telefono + '. Seguro de interés: ' + (producto || 'no especificado') + '. Confírmale calurosamente que un asesor le llamará pronto.';
            sendRealtimeEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: msgContacto }] } });
            sendRealtimeEvent({ type: 'response.create' });
        } else { throw new Error('Error servidor'); }
    } catch(e) {
        btn.disabled = false; btn.textContent = '📞 Solicitar llamada';
        alert('Error al enviar. Inténtalo de nuevo.');
    }
}


window.showContractForm = function() { showContractForm(); };
window.closeContractForm = function() { closeContractForm(); };
window.formatIBAN = function(input) { formatIBAN(input); };
window.submitContractForm = function() { submitContractForm(); };

function showContractForm() {
    injectContractFormStyles();
    if (document.getElementById('axa-contract-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'axa-contract-overlay';
    overlay.innerHTML = `
        <div id="axa-contract-panel">
            <button class="close-btn" onclick="closeContractForm()">✕</button>
            <div class="axa-logo-header">
                <img src="axa_logo.png" alt="AXA" onerror="this.style.display='none'"/>
                <span>Contratación de Seguro</span>
            </div>
            <h2>¡Casi listo!</h2>
            <p class="subtitle">Rellena tus datos y tu póliza estará activa en minutos.</p>

            <div class="form-row">
                <div>
                    <label>Nombre *</label>
                    <input type="text" id="cf-nombre" placeholder="María" />
                </div>
                <div>
                    <label>Apellidos *</label>
                    <input type="text" id="cf-apellidos" placeholder="García López" />
                </div>
            </div>
            <div class="form-row">
                <div>
                    <label>DNI / NIE *</label>
                    <input type="text" id="cf-dni" placeholder="12345678A" />
                </div>
                <div>
                    <label>Fecha de nacimiento *</label>
                    <input type="date" id="cf-nacimiento" />
                </div>
            </div>
            <div class="form-row">
                <div>
                    <label>Email *</label>
                    <input type="email" id="cf-email" placeholder="maria@email.com" />
                </div>
                <div>
                    <label>Teléfono *</label>
                    <input type="tel" id="cf-telefono" placeholder="600 000 000" />
                </div>
            </div>
            <div class="form-row full">
                <div>
                    <label>Producto seleccionado *</label>
                    <select id="cf-producto">
                        <option value="">— Selecciona un seguro —</option>
                        <optgroup label="Salud">
                            <option>Óptima Smart</option>
                            <option>Óptima (sin copago)</option>
                            <option>Óptima Familiar S</option>
                            <option>Óptima Familiar M</option>
                            <option>Óptima Familiar L</option>
                            <option>Óptima Plus</option>
                        </optgroup>
                        <optgroup label="Coche">
                            <option>Motor Elige — Terceros Básico</option>
                            <option>Motor Elige — Terceros Ampliado</option>
                            <option>Motor Elige — Todo Riesgo con franquicia</option>
                            <option>Motor Elige — Todo Riesgo sin franquicia</option>
                        </optgroup>
                        <optgroup label="Hogar">
                            <option>Hogar Único</option>
                        </optgroup>
                    </select>
                </div>
            </div>

            <div class="sepa-box">
                <strong>💳 Domiciliación bancaria (SEPA)</strong>
                <p style="margin:6px 0 0 0; font-size:12px;">El cobro de tu seguro se realizará mediante adeudo directo SEPA. Introduce tu IBAN de forma segura:</p>
                <div style="margin-top:10px;">
                    <label>IBAN *</label>
                    <input type="text" id="cf-iban" placeholder="ES00 0000 0000 0000 0000 0000" 
                        oninput="formatIBAN(this)" maxlength="29" style="font-family:monospace; letter-spacing:1px;" />
                </div>
                <label class="sepa-check">
                    <input type="checkbox" id="cf-sepa" />
                    <span>Autorizo a AXA Seguros Generales S.A. a cargar en la cuenta indicada los recibos correspondientes a mi póliza (Mandato SEPA).</span>
                </label>
            </div>

            <div class="btn-row">
                <button class="btn-cancel" onclick="closeContractForm()">Cancelar</button>
                <button class="btn-submit" id="cf-submit-btn" onclick="submitContractForm()">
                    ✅ Confirmar y activar póliza
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

}

function closeContractForm() {
    const overlay = document.getElementById('axa-contract-overlay');
    if (overlay) overlay.remove();
}

function formatIBAN(input) {
    let val = input.value.replace(/\s/g, '').toUpperCase();
    let formatted = val.match(/.{1,4}/g)?.join(' ') || val;
    input.value = formatted;
}

async function submitContractForm() {
    const nombre = document.getElementById('cf-nombre')?.value.trim();
    const apellidos = document.getElementById('cf-apellidos')?.value.trim();
    const dni = document.getElementById('cf-dni')?.value.trim();
    const nacimiento = document.getElementById('cf-nacimiento')?.value;
    const email = document.getElementById('cf-email')?.value.trim();
    const telefono = document.getElementById('cf-telefono')?.value.trim();
    const producto = document.getElementById('cf-producto')?.value;
    const iban = document.getElementById('cf-iban')?.value.trim();
    const sepa = document.getElementById('cf-sepa')?.checked;

    if (!nombre || !apellidos || !email || !producto || !iban || !sepa) {
        alert('Por favor, rellena todos los campos obligatorios y acepta el mandato SEPA.');
        return;
    }

    const btn = document.getElementById('cf-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    // Número de póliza simulado
    const poliza = 'AXA-DEMO-' + Math.floor(Math.random() * 9000000 + 1000000);
    const fechaEfecto = new Date();
    fechaEfecto.setDate(fechaEfecto.getDate() + 1);
    const fechaStr = fechaEfecto.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    try {
        const res = await fetch('/.netlify/functions/send-contract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, apellidos, dni, nacimiento, email, telefono, producto, iban, poliza, fechaEfecto: fechaStr })
        });

        if (res.ok) {
            // Mostrar éxito
            document.getElementById('axa-contract-panel').innerHTML = `
                <div class="success-msg">
                    <div class="check-icon">✅</div>
                    <h3>¡Bienvenido/a a AXA, ${nombre}!</h3>
                    <p>Tu póliza <strong>${producto}</strong> está activa.<br/>
                    Nº de póliza: <strong>${poliza}</strong><br/>
                    Fecha de efecto: <strong>${fechaStr}</strong><br/><br/>
                    Hemos enviado toda la documentación a <strong>${email}</strong>.</p>
                    <button onclick="closeContractForm()" style="margin-top:20px; background:#004B8D; color:white; border:none; border-radius:8px; padding:12px 28px; font-size:15px; cursor:pointer;">Cerrar</button>
                </div>
            `;
            // Decirle a Viki que confirme
            sendRealtimeEvent({
                type: 'conversation.item.create',
                item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `El formulario ha sido enviado correctamente. El cliente ${nombre} ha contratado ${producto} con número de póliza ${poliza} y fecha de efecto ${fechaStr}. Confírmalo de forma cálida y entusiasta.` }] }
            });
            sendRealtimeEvent({ type: 'response.create' });
        } else {
            throw new Error('Error en el servidor');
        }
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '✅ Confirmar y activar póliza';
        alert('Error al enviar. Inténtalo de nuevo.');
    }
}

// =============================================================================
// VISOR PDF — TABLA COMPARATIVA PÓLIZAS AXA
// =============================================================================
window.showPDFViewer = function() { showPDFViewer(); };
window.closePDFViewer = function() { closePDFViewer(); };
window.changePDFPage = function(dir) { loadPDFPage((window._pdfCurrentPage || 1) + dir); };
window.changePDFZoom = function(dir) {
    window._pdfZoom = Math.max(0.5, Math.min(3.0, (window._pdfZoom || 1.0) + dir * 0.25));
    loadPDFPage(window._pdfCurrentPage || 1);
};

function showPDFViewer() {
    if (document.getElementById('axa-pdf-overlay')) return;
    window._pdfZoom = 1.0;

    const overlay = document.createElement('div');
    overlay.id = 'axa-pdf-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;';

    overlay.innerHTML = `
        <div style="width:90vw;height:90vh;background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:#004B8D;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;flex-wrap:wrap;gap:8px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <img src="axa_logo.png" alt="AXA" style="height:28px;" onerror="this.style.display='none'"/>
                    <span style="color:white;font-family:Arial;font-size:15px;font-weight:bold;">Comparativa Pólizas de Salud</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button onclick="changePDFPage(-1)" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:7px 14px;border-radius:6px;font-size:16px;cursor:pointer;">◀</button>
                    <span id="pdf-page-info" style="color:white;font-family:Arial;font-size:13px;min-width:80px;text-align:center;">Página 1 / 6</span>
                    <button onclick="changePDFPage(1)" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:7px 14px;border-radius:6px;font-size:16px;cursor:pointer;">▶</button>
                    <div style="width:1px;height:24px;background:rgba(255,255,255,0.3);margin:0 4px;"></div>
                    <button onclick="changePDFZoom(-1)" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:7px 12px;border-radius:6px;font-size:16px;cursor:pointer;">−</button>
                    <span id="pdf-zoom-info" style="color:white;font-family:Arial;font-size:13px;min-width:40px;text-align:center;">100%</span>
                    <button onclick="changePDFZoom(1)" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:7px 12px;border-radius:6px;font-size:16px;cursor:pointer;">+</button>
                    <div style="width:1px;height:24px;background:rgba(255,255,255,0.3);margin:0 4px;"></div>
                    <button onclick="closePDFViewer()" style="background:rgba(255,255,255,0.15);border:none;color:white;padding:7px 14px;border-radius:6px;font-size:14px;cursor:pointer;">✕ Cerrar</button>
                </div>
            </div>
            <div id="pdf-scroll-container" style="flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;background:#f5f5f5;padding:16px;">
                <canvas id="pdf-canvas" style="display:block;box-shadow:0 4px 20px rgba(0,0,0,0.15);"></canvas>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    loadPDFPage(1);

    // Swipe táctil para pasar páginas
    let touchStartX = 0;
    overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', e => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 60) changePDFPage(diff > 0 ? 1 : -1);
    }, { passive: true });
}

function closePDFViewer() {
    const el = document.getElementById('axa-pdf-overlay');
    if (el) el.remove();
    window._pdfDoc = null;
    window._pdfCurrentPage = 1;
    window._pdfZoom = 1.0;
}

window._pdfCurrentPage = 1;
window._pdfTotalPages = 6;
window._pdfZoom = 1.0;

async function loadPDFPage(pageNum) {
    try {
        if (!window.pdfjsLib) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        if (!window._pdfDoc) {
            window._pdfDoc = await window.pdfjsLib.getDocument('./AXA_PROD_SALUD_TABLA_COMPARATIVA.pdf').promise;
            window._pdfTotalPages = window._pdfDoc.numPages;
        }

        window._pdfCurrentPage = Math.max(1, Math.min(pageNum, window._pdfTotalPages));

        const page = await window._pdfDoc.getPage(window._pdfCurrentPage);
        const canvas = document.getElementById('pdf-canvas');
        if (!canvas) return;

        const container = document.getElementById('pdf-scroll-container');
        const baseScale = container
            ? Math.min(container.clientWidth / page.getViewport({ scale: 1 }).width, (container.clientHeight - 32) / page.getViewport({ scale: 1 }).height) * 0.95
            : 1.0;

        const scale = baseScale * (window._pdfZoom || 1.0);
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const pageInfo = document.getElementById('pdf-page-info');
        if (pageInfo) pageInfo.textContent = `Página ${window._pdfCurrentPage} / ${window._pdfTotalPages}`;

        const zoomInfo = document.getElementById('pdf-zoom-info');
        if (zoomInfo) zoomInfo.textContent = Math.round((window._pdfZoom || 1.0) * 100) + '%';

    } catch (e) {
        console.error('❌ Error cargando PDF:', e);
    }
}