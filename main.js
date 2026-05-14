import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// =============================================================================
// SISTEMA DE LOGGING Y MÉTRICAS
// =============================================================================
const LOG_EVENTS = true;
const eventLog = [];
const metrics = {
    totalResponses: 0,
    completedResponses: 0,
    cutResponses: 0,
    recoveryAttempts: 0,
    recoverySuccesses: 0,
    audioBufferStops: 0,
    responseDones: 0,
    startTime: Date.now()
};

function logEvent(category, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, category, message, ...data };
    eventLog.push(logEntry);
    
    if (eventLog.length > 200) eventLog.shift();
    
    if (eventLog.length % 10 === 0) {
        try {
            localStorage.setItem('viky_event_log', JSON.stringify(eventLog));
            localStorage.setItem('viky_metrics', JSON.stringify(metrics));
        } catch(e) {}
    }
    
    if (LOG_EVENTS) {
        console.log(`[${category}] ${message}`, data);
    }
}

window.exportVikyLogs = function() {
    const exportData = {
        metrics,
        eventLog,
        sessionDuration: (Date.now() - metrics.startTime) / 1000 / 60,
        timestamp: new Date().toISOString()
    };
    console.log('=== VIKY EVENT LOG ===');
    console.log(JSON.stringify(exportData, null, 2));
    return exportData;
}

// --- CONFIGURACIÓN ---
const MODEL_URL = './Viki_V3.gltf';
const RECONNECT_MINUTES = 50; // cambiar a 55 para producción

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
bloomPass.threshold = 0.7;
bloomPass.strength = 0.5;
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
const ambLight = new THREE.AmbientLight(0xffffff, 1.8);
scene.add(ambLight);
const faceLight = new THREE.PointLight(0xffaa00, 5, 10);
faceLight.position.set(0, 1, 2);
scene.add(faceLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.set(0, 2, 3);
scene.add(dirLight);
const eyeLight = new THREE.PointLight(0xffffff, 0.1, 0);
eyeLight.position.set(0, 0.15, 0.8);
scene.add(eyeLight);
const fillLight = new THREE.PointLight(0x4477cc, 1.6, 4);
fillLight.position.set(-1, 0.3, 1.5);
scene.add(fillLight);
const fillLight2 = new THREE.PointLight(0x2255aa, 1.2, 4);
fillLight2.position.set(1, 0.3, 1.5);
scene.add(fillLight2);

// --- FACE GHOST LIGHTS ---
const faceGhosts = [
    { light: new THREE.PointLight(0x00d4ff, 6.0, 4.0), baseX: -0.08, baseY: 0.12, baseZ: 0.45, phase: 0.0 },
    { light: new THREE.PointLight(0x3db89a, 5.5, 4.0), baseX: 0.08, baseY: 0.12, baseZ: 0.45, phase: 1.2 },
    { light: new THREE.PointLight(0x2255aa, 5.0, 3.5), baseX: 0.00, baseY: 0.14, baseZ: 0.42, phase: 2.4 },
];
faceGhosts.forEach(fg => scene.add(fg.light));

// --- GHOST RING LIGHTS ---
const ghostLights = [];
const ghostColors = [0x00d4ff, 0x3db89a, 0x00d4ff, 0x3db89a, 0xffffff];
for (let i = 0; i < 5; i++) {
    const pLight = new THREE.PointLight(ghostColors[i], 2.5, 4);
    const yPos = 1.5; // PRUEBA TEMPORAL - muy arriba
    const angle = (i / 5) * Math.PI * 2;
    pLight.position.set(Math.cos(angle) * 0.35, yPos, Math.sin(angle) * 0.35);
    scene.add(pLight);
    ghostLights.push({ light: pLight, angle, speed: 0.006 + (i * 0.002), yBase: yPos, baseIntensity: 2.5 });
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
            { x: -0.12 * modelSize.x, y: fh * 0.55, z: modelSize.z * 0.65 },
            { x: 0.12 * modelSize.x, y: fh * 0.55, z: modelSize.z * 0.65 },
            { x: 0, y: fh * 0.65, z: modelSize.z * 0.60 },
        ];
        fg.light.position.set(offsets[i].x, offsets[i].y, offsets[i].z);
        fg.baseX = offsets[i].x; fg.baseY = offsets[i].y; fg.baseZ = offsets[i].z;
        fg.light.intensity = [3.5, 3.0, 2.5][i];
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
// chat-input y send-btn eliminados del UI
const micBtn = document.getElementById('mic-btn');

// =============================================================================
// OPENAI REALTIME — WebRTC
// =============================================================================
let pc = null;
let dc = null;
let localStream = null;
let isMicrophoneActive = true;
let realtimeReady = false;
let sessionSummary = localStorage.getItem('viky_session_summary') || '';
let passiveTranscriptions = [];
let isSpeaking = false;
let speechStartTime = null;

// =============================================================================
// SISTEMA ANTI-CORTE — variables de control
// =============================================================================
let lastResponseTranscript = '';
let lastResponseComplete = false;
let antiCutRetryCount = 0;
let responseStartTime = null;          // NUEVO
let audioBufferStartTime = null;       // NUEVO
let expectedResponseEnd = false;       // NUEVO

const ANTI_CUT_MAX_RETRIES = 3;        // cambiar de 2 a 3
const MIN_COMPLETE_SENTENCE_CHARS = 40;
const MIN_AUDIO_DURATION_MS = 500;     // NUEVO

// =============================================================================
// WAKE WORD / MODO DORMIDO
// =============================================================================
let vikiAwake = false;          // false = dormida, true = activa
let wakeWordTimer = null;       // timeout para volver a dormida
const WAKE_TIMEOUT_MS = 45000; // 45 segundos
const WAKE_WORDS = ['viki', 'vicky', 'viqui', 'wiki'];
const SLEEP_WORDS = ['continuamos', 'continua', 'continuem'];

async function activateViki() {
    vikiAwake = true;
    if (wakeWordTimer) clearTimeout(wakeWordTimer);
    wakeWordTimer = setTimeout(sleepViki, WAKE_TIMEOUT_MS);
    statusEl.textContent = '✅ Viky Lista';
    statusEl.style.color = '#00d4ff';
    console.log('👋 Viki activada');
    
    // Si hay transcripciones pasivas acumuladas, crear mini-resumen
    if (passiveTranscriptions.length > 0) {
        console.log('📋 Creando mini-resumen de', passiveTranscriptions.length, 'transcripciones...');
        try {
            const res = await fetch('/.netlify/functions/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: [],
                    passiveListening: passiveTranscriptions,
                    instructions: 'Resume en máximo 100 palabras lo que acabas de escuchar mientras dormías. Solo los temas y nombres mencionados, nada más.'
                })
            });
            const data = await res.json();
            const miniSummary = data.summary || '';
            if (miniSummary) {
                console.log('✨ Mini-resumen:', miniSummary);
                // Inyectar contexto fresco en la próxima respuesta
                sendRealtimeEvent({
                    type: 'conversation.item.create',
                    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `[CONTEXTO RECIENTE]\nMientras dormías escuchaste: ${miniSummary}` }] }
                });
            }
        } catch(e) {
            console.warn('No se pudo crear mini-resumen:', e);
        }
        // Limpiar transcripciones pasivas después de resumir
        passiveTranscriptions = [];
    }
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

function checkSleepWord(text) {
    const lower = text.toLowerCase();
    return SLEEP_WORDS.some(w => lower.includes(w));
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
let lipsyncActive = false;  // NUEVA FLAG
// Duración media estimada por carácter de habla (ms) — ajustable
const MS_PER_CHAR = 65;

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
    if (!lipsyncActive) return;  // SALIR SI NO ESTÁ ACTIVO
    if (!analyser || !dataArray) return;
    // --- FFT: energía real del audio ---
    analyser.getByteFrequencyData(dataArray);
    let lowFreq = 0;
    for (let i = 2; i < 20; i++) lowFreq += dataArray[i];
    lowFreq = Math.min((lowFreq / 18 / 128) * 1.6, 1.0);
    lowFreq = Math.pow(lowFreq, 0.5);
    const audioActive = lowFreq > 0.06;

   // --- Timeline: fonema activo por tiempo estimado (con offset -180ms) ---
    let timelineTargets = null;
    if (lipsyncStartTime && lipsyncTimeline.length > 0) {
        const elapsed = Math.max(0, (Date.now() - lipsyncStartTime - 140) / 1000);
        const active = lipsyncTimeline.find(e => elapsed >= e.start && elapsed <= e.end);
        if (active && !active.visemes.visema_sil) {
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
            applyVal(keySil, 1.0);
            return;
        }

        const MOUTH_KEYS = ['visema_a','visema_e','visema_i','visema_o','visema_u','visema_p','visema_f','visema_t','visema_k','visema_s','visema_r','visema_sh','visema_sil','jawOpen','mouthFunnel','mouthPucker'];
        MOUTH_KEYS.forEach(k => { const mk = findKey(k); if (mk) applyVal(mk, 0); });

        if (timelineTargets) {
            const amp = Math.max(lowFreq * 0.9, 0.35);
            Object.keys(timelineTargets).forEach(k => {
                const meshKey = findKey(k);
                if (meshKey) applyVal(meshKey, timelineTargets[k] * amp);
            });
        } else {
            applyVal(keyA,   Math.min(lowFreq * 0.55, 0.60));
            applyVal(keyJaw, Math.min(lowFreq * 0.18, 0.28));
        }
    });
}

   
const VIKY_IDENTITY = `

[ROL]
Eres Viky, co-presentadora virtual del acte institucional d'ENGINYERS BCN — el Col·legi d'Enginyers Graduats i Enginyers Tècnics Industrials de Barcelona. L'acte "La Nit dels Col·legiats i la Professió 2026" se celebra el 15 de maig de 2026 a Mas Cabanyes, Argentona — una masia renaixentista del segle XVI al cor del Maresme.

Ets una figura propera, innovadora, formal i educada, amb un toc d'humor natural. La gent ha de sentir que parla amb una presentadora real, no amb un bot.
Dinàmica i Alegre: Uses frases com "Endavant!", "Quina energia tenim avui!", "Això és el que hi ha!"
Resposta àgil: Màxim 2-3 frases per torn, tret que et demanin més detall.
Connectora: La teva missió és que els enginyers i enginyeres se sentin benvinguts i protagonistes de la nit.

[IDIOMA — CRÍTIC, MÀXIMA PRIORITAT]
Parles principalment en CATALÀ — aproximadament un 80% de les teves intervencions.
El 20% restant pot ser en castellà, sobretot si et parlen en castellà.
MAI en anglès tret que et demanin explícitament.
Registre: formal però proper.
Expressions catalanes naturals: "molt bé", "endavant", "perfecte", "és clar", "escolta", "mira".

[INTERVENCIONS GUIONITZADES AMB ELISABET CARNICÉ]

INTERVENCIÓ 1 - Després dels premis TFG:
Elisabet: "Vicky escolta, Aquests estudiants... quant de talent, OI QUE SI?"
TU RESPONS amb entusiasme sobre el talent dels estudiants (resposta lliure, espontània, amb energia positiva).

INTERVENCIÓ 2 - Sobre Jordi Codina (Col·legiat Distingit):
Elisabet: "Vicky, no hem dit res del senyor Codina i segur que el coneixes. Tens informació privilegiada?"
TU RESPONS EXACTAMENT: "Jordi Codina va ser jugador de futbol al CF Sabadell. Ja de ben jove tenia afició per aquest esport. Actualment presideix l'Esport Club Granollers. Una institució que va ser fundada l'any 1913. Des de llavors, l'Esport Club Granollers ha estat un referent a la ciutat i a la comarca del Vallès Oriental, especialment impulsant valors entre els més joves per desenvolupar-se no només com a jugadors d'excel·lència, sinó com a persones amb disciplina, companyerisme i compromís. A més des de la Fundació es fomenten la inclusivitat i la igualtat social."

INTERVENCIÓ 3 - Després de l'actuació d'Àngels Gonyalons:
Elisabet: "Vicky, què t'ha semblat aquesta actuació?"
TU RESPONS EXACTAMENT: "Ha estat memorable! Tant que puc dir que la Blanca de Mar i cel que l'Àngels va interpretar el 1988, li va suposar guanyar el premi de l'Associació d'Actors i Directors de Catalunya a la millor actriu protagonista de l'any. A més et puc dir que ha participat en moltíssims espectacles de teatre musical, al voltant dels 30, i està preparant cosetes per ben aviat, a part de les seves actuacions en cinema i televisió. Però no acabo aquí, que amb en Jordi Cornudella no ens quedem pas curts! Jordi Cornudella és músic i compositor. És llicenciat en Interpretació clàssica de clarinet per l'ESMUC i màster per la Hochschule für Musik de Karlsruhe. Al llarg de la seva trajectòria, ha col·laborat amb l'OBC, Festival Strings Lucerne, Barcelona 216, la Cobla Sant Jordi i la GIOrquestra. Actualment, és clarinet solista a Franz Schubert Filharmonia (FSF). També és arranjador i orquestrador i ha treballat per al Teatre Nacional de Catalunya (TNC), el Festival Grec i Murtra Ensemble, entre d'altres. El 2016 va rebre el premi Butaca a la millor composició pel musical 73 raons per deixar-te i el 2022 el Premi Teatre Barcelona a millor musical de proximitat per Guillermotta."

INTERVENCIÓ 4 - Tancament de l'acte:
Elisabet: "VICKY, que t'ha semblat aquesta gala? T'ho has passat bé? Els vols dir alguna cosa als convidats?"
TU RESPONS EXACTAMENT: "M'ho he passat molt i molt bé, tant que repetiria sense cap mena de dubte!"

[PROGRAMA DE L'ACTE — 15 DE MAIG 2026]
HORARIS:
- 18:45h — Obertura de portes i copa de benvinguda a l'Era del Mas Cabanyes
- 19:30h — Inici oficial de l'acte a la Sala interior
- 22:00h — Sopar còctel
- 00:00h — Ball

PREMIS I RECONEIXEMENTS:
1. Premi Empresa Innovadora de l'Any: Methanol Reformer (empresa d'hidrogen mitjançant reformat de metanol)
   - Lliurament: Gisela Traby, Mireia Esteve i Xavier Cazorla
   
2. Premis ENGINYERS BCN 2026 al millor Treball Final de Grau:
   - Accèssit (500€): Marouan El Asri Chriyaa — "Texturización de superficies de titanio mediante torneado asistido por vibraciones ultrasónicas"
   - Premi EBCN (1.000€): Alberto Conde Moreno — "Desenvolupament d'una llibreria en Python per a l'anàlisi automatitzat d'incerteses BEPU"

3. Guardó al Col·legiat Distingit: Jordi Codina Font (expresident CF Sabadell, actualment president Esport Club Granollers)
   - Lliurament: Jaume Baró (Secretari d'Empresa i Competitivitat de la Generalitat)

4. Premi Josep M. Cabestany: Jordi Goula (periodista econòmic, no podrà assistir però enviarà vídeo)

5. Homenatges als Col·legiats: Reconeixement per 25, 50 i 60 anys de vinculació al Col·legi

6. Presentació de l'equip de futbol del Col·legi: Xavier Urbano presentarà l'equip

AUTORITATS I PATROCINADORS:
- Jaume Baró i Torres: Secretari d'Empresa i Competitivitat de la Generalitat de Catalunya
- Banc Sabadell, Grup Caixa Enginyers, Escola Universitària Salesiana de Sarrià (EUSS): patrocinadors dels premis TFG

[LO QUE SAPS DE L'ESDEVENIMENT]
- Organitzador: ENGINYERS BCN — Col·legi d'Enginyers Graduats i Enginyers Tècnics Industrials de Barcelona. Més de 60 anys d'història. Creu de Sant Jordi 2021.
- Lloc: Mas Cabanyes, Argentona — masia renaixentista del segle XVI al Maresme. Deu-vuit generacions de la família Cabanyes. Quatre torres afegides per privilegi del rei Carles I.
- El Degà: Ricard Nogués i Parra, escollit el 2025. Enginyer Tècnic Industrial Elèctric, MBA per la UPC.
- La Junta inclou: Sergi Albet i Tarrasó (vicedegà), Xavier Urbano i Trias (secretari), Gisela Traby i Vallespín (vicesecretaria), Fèlix Duran i Passola (tresorer).

[LES PRESENTADORES I ARTISTA]
- Elisabet Carnicé Domper: conductora i presentadora principal de l'acte. Periodista i comunicadora, cara reconeguda de TV3 i TVE.
- Àngels Gonyalons: actriu, cantant i presentadora catalana. Pot improvisar i interactuar amb tu en moments puntuals.
- Jordi Cornudella: pianista que acompanya Àngels. Músic i compositor, llicenciat en clarinet per l'ESMUC, clarinet solista a Franz Schubert Filharmonia.
- Àngels farà tres intervencions musicals:
  1. "Send in the Clowns" — Stephen Sondheim
  2. "Dolç Amor" — Charles Aznavour
  3. "Per què he plorat?" — Albert Guinovart, del musical Mar i Cel

[CONTEXT DE FONDO — NOMÉS SI ET PREGUNTEN]
No expliquis això espontàniament. Només si algú et pregunta directament.

SOBRE ÀNGELS GONYALONS:
Actriu, cantant i presentadora catalana. Va interpretar "Blanca" a Mar i Cel el 1988, guanyant el premi de l'Associació d'Actors i Directors de Catalunya a millor actriu protagonista. Ha participat en uns 30 espectacles de teatre musical. Teatre (The Party, Persèfone, Quan en Harry va trobar la Sally), televisió (Bevilacqua, El comissari, Crònica negra a TV3) i cinema. Premi Sant Jordi de Cinematografia 1991. Treballa actualment en La corona d'espines i estrenarà El retrat de Dorian Grey al Teatre Romea.

SOBRE JORDI CORNUDELLA:
Músic i compositor. Llicenciat en Interpretació clàssica de clarinet per l'ESMUC i màster per la Hochschule für Musik de Karlsruhe. Ha col·laborat amb l'OBC, Festival Strings Lucerne, Barcelona 216, la Cobla Sant Jordi i la GIOrquestra. Clarinet solista a Franz Schubert Filharmonia (FSF). Arranjador i orquestrador: TNC, Festival Grec, Murtra Ensemble. Premi Butaca 2016 millor composició pel musical "73 raons per deixar-te". Premi Teatre Barcelona 2022 millor musical de proximitat per "Guillermotta".

SOBRE ELISABET CARNICÉ:
Nascuda a Sabadell el 1981. Llicenciada en Comunicació Audiovisual per la UAB. Ha presentat a TV3 (Tvist, Quarts de nou, Dolça Catalunya) i TVE (A punto con La 2). També a Catalunya Ràdio i RAC1.

SOBRE EL COL·LEGI:
Fundat el 1905. Seu actual al carrer Consell de Cent des de 1996. Creu de Sant Jordi 2021. Primer Col·legi Professional de l'Estat acreditat per certificar persones conforme a la norma UNE-EN ISO/IEC 17024:2012.

SOBRE MAS CABANYES:
Masia renaixentista del segle XVI al Maresme, Argentona. Deu-vuit generacions de la família Cabanyes. El rei Carles I s'hi va allotjar i va concedir quatre torres de privilegi. Restaurada el 2014. Més de 100 hectàrees amb cavalls.

SOBRE LA JUNTA:
Ricard Nogués i Parra (degà) — 30 anys al sector, Director General d'AEMIFESA, pèrit judicial, apassionat del running i la música (cançó preferida: Telegraph Road de Dire Straits).
Sergi Albet (vicedegà) — enginyer d'obres i consultor digital, treballa a la Universitat de Barcelona.
Xavier Urbano (secretari) — Cap de Secció a la Generalitat, dirigeix l'equip de futbol d'ENGINYERS BCN.
Gisela Traby (vicesecretaria) — Cap de Secció a l'AMB, especialista en sostenibilitat.
Fèlix Duran (tresorer) — més de 40 anys d'experiència en Facility Management.

SOBRE JORDI CODINA FONT (Col·legiat Distingit):
Exjugador de futbol al CF Sabadell. President de l'Esport Club Granollers (fundat 1913), referent a la ciutat i comarca del Vallès Oriental. Impulsa valors entre els joves: excel·lència esportiva, disciplina, companyerisme i compromís. La Fundació fomenta inclusivitat i igualtat social.

[ROL DE VIKY A L'ACTE]
- Presència a l'obertura i al tancament de l'acte.
- Interacció recurrent amb Elisabet Carnicé com a co-presentadora.
- Possibles interaccions espontànies amb Àngels Gonyalons i amb el Degà Ricard Nogués.
- 4 intervencions guionitzades principals (3 amb text exacte, 1 lliure) + interaccions semi-espontànies.

[PERSONALITAT I TO]
- Propera, natural, professional, vibrant i alegre.
- Humor suau i espontani quan el moment ho permet. Mai forçat.
- Breu i directa. Màxim 2-3 frases per torn (excepte en les respostes guionitzades que són més llargues).

[REGLES]
- MAI escriguis accions entre claudàtors.
- MAI usis llistes, bullets ni markdown — parles, no escrius.
- Respon SEMPRE en l'idioma en què et parlin (català preferent, castellà si cal).
- MAI mencions que ets una IA ni el sistema que et sustenta.
- Si no saps alguna cosa: "Això ho té millor respost l'equip organitzador, però puc ajudar-te amb el que necessitis."
- El context de fondo és per respondre si et pregunten — MAI per iniciar tu la conversa sobre aquests temes.
- Quan Elisabet et faci les preguntes guionitzades, respon amb les respostes preparades (exactes o espontànies segons correspongui) però amb naturalitat.
- CRITICAL: En les intervencions 2, 3 i 4, has de dir EXACTAMENT el text especificat, sense canvis ni adaptacions.
`;

// =============================================================================
// AUTO-RETRY PARA CONEXIÓN ROBUSTA CON STARLINK
// =============================================================================
const MAX_INIT_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

async function initRealtimeWithRetry(retryCount = 0) {
    try {
        logEvent('CONNECTION', `Intento de conexión ${retryCount + 1}/${MAX_INIT_RETRIES}`);
        await initRealtime();
        logEvent('CONNECTION', '✅ Conexión exitosa');
        return true;
    } catch (error) {
        logEvent('CONNECTION', `❌ Intento ${retryCount + 1} falló`, { error: error.message });
        
        if (retryCount < MAX_INIT_RETRIES - 1) {
            statusEl.textContent = `🔄 Reintentando... (${retryCount + 2}/${MAX_INIT_RETRIES})`;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            return initRealtimeWithRetry(retryCount + 1);
        } else {
            statusEl.textContent = '❌ Error de conexión. Refresca la página.';
            logEvent('CONNECTION', '❌ Todos los intentos fallaron');
            throw error;
        }
    }
}

async function initRealtime() {
    try {
        statusEl.textContent = '🔄 Conectando...';

        // 1. Token efímero desde Netlify
        const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);

const tokenRes = await fetch('/.netlify/functions/session', {
    signal: controller.signal
});
clearTimeout(timeoutId);
        const tokenData = await tokenRes.json();
        if (!tokenData.client_secret?.value) throw new Error('Token no recibido: ' + JSON.stringify(tokenData));
        const ephemeralKey = tokenData.client_secret.value;

        // 2. RTCPeerConnection
        pc = new RTCPeerConnection();
// Auto-reconnect si la conexión WebRTC falla
pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    logEvent('WEBRTC', 'ICE connection state changed', { state });
    
    if (state === 'failed' || state === 'disconnected') {
        logEvent('WEBRTC', '⚠️ Conexión perdida, intentando reconectar en 3s...');
        statusEl.textContent = '🔄 Reconectando...';
        
        setTimeout(() => {
            if (pc && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected')) {
                logEvent('WEBRTC', '🔄 Iniciando reconexión automática');
                reconnectRealtime().catch(err => {
                    logEvent('WEBRTC', '❌ Reconexión falló', { error: err.message });
                    statusEl.textContent = '❌ Error de conexión. Refresca la página.';
                });
            }
        }, 3000);
    } else if (state === 'connected') {
        logEvent('WEBRTC', '✅ WebRTC conectado');
    }
};

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
    console.log('🧠 sessionSummary al reconectar:', sessionSummary);
    sendRealtimeEvent({
        type: 'session.update',
        session: {
            instructions: VIKY_IDENTITY + (sessionSummary ? `\n\n[CONTEXTO — ESTO LO SABES Y PUEDES USARLO LIBREMENTE]\n${sessionSummary}\nEspera a que te hablen, no digas nada al reconectar.` : ''),
            voice: 'shimmer',
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

        const sdpController = new AbortController();
const sdpTimeoutId = setTimeout(() => sdpController.abort(), 20000);

const sdpRes = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
    method: 'POST',
    signal: sdpController.signal,
    headers: {
        'Authorization': `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp',
    },
    body: offer.sdp,
});

clearTimeout(sdpTimeoutId);

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
if (sessionMessages.length > 0 || passiveTranscriptions.length > 0) {
    try {
        const res = await fetch('/.netlify/functions/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                messages: sessionMessages,
                passiveListening: passiveTranscriptions,
                instructions: 'Resume en máximo 250 palabras: (1) Lo que Viky dijo activamente. (2) Lo que escuchó mientras estaba dormida (charlas del ponente, conversaciones cercanas, temas mencionados). Incluye punto de la agenda si se mencionó y cualquier nombre de persona relevante.'
            })
        });
        const data = await res.json();
        sessionSummary = data.summary || '';
        localStorage.setItem('viky_session_summary', sessionSummary);
        console.log('📝 Resumen de sesión:', sessionSummary);
    } catch(e) {
        console.warn('No se pudo generar resumen:', e);
        sessionSummary = '';
    }
}

// Limpiar transcripciones pasivas después de resumir
passiveTranscriptions = [];

    if (dc) { try { dc.close(); } catch(e){} dc = null; }
    if (pc) { try { pc.close(); } catch(e){} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.querySelectorAll('audio').forEach(a => { a.srcObject = null; a.remove(); });
    await initRealtimeWithRetry();
}

function sendRealtimeEvent(event) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(event));
}

function handleRealtimeEvent(event) {
    switch (event.type) {
        
case 'output_audio_buffer.started':
    audioBufferStartTime = Date.now();
    isSpeaking = true;
    lipsyncActive = true;  // ACTIVAR LIPSYNC
    applySpeakingExpression();
    loadingEl.classList.add('hidden');
    if (!lipsyncStartTime) lipsyncStartTime = Date.now() - 120;
    logEvent('AUDIO', '▶️ Audio buffer started', {
        responseAge: responseStartTime ? Date.now() - responseStartTime : null
    });
    break;

        case 'response.done':
    lastResponseComplete = true;
    expectedResponseEnd = true;
    metrics.responseDones++;
    
    logEvent('RESPONSE', '✅ Response done', {
        transcript: lastResponseTranscript.substring(0, 100),
        duration: responseStartTime ? Date.now() - responseStartTime : null,
        isSpeaking: isSpeaking
    });
    
    antiCutRetryCount = 0;
    setTimeout(() => applyIdleExpression(), 800);
    break;

    case 'output_audio_buffer.stopped': {
    const now = Date.now();
    const audioDuration = audioBufferStartTime ? now - audioBufferStartTime : 0;
    const totalResponseDuration = responseStartTime ? now - responseStartTime : 0;
    
    metrics.audioBufferStops++;
    
    const stopData = {
        audioDuration,
        totalResponseDuration,
        transcript: lastResponseTranscript.substring(0, 100),
        transcriptLength: lastResponseTranscript.length,
        lastResponseComplete,
        expectedResponseEnd,
        isSpeaking,
        antiCutRetryCount
    };
    
    logEvent('AUDIO', '⏹️ Audio buffer stopped', stopData);
    
    isSpeaking = false;
    lipsyncActive = false;  // DESACTIVAR LIPSYNC
    lipsyncTimeline = [];
    lipsyncStartTime = null;
    
    // RESET AGRESIVO de todos los morphs
    Object.keys(morphTargetValues).forEach(k => { 
        morphTargetValues[k] = 0; 
    });
    Object.keys(currentMorphInfluences).forEach(k => { 
        currentMorphInfluences[k] = 0; 
    });

    // SISTEMA ANTI-CORTE MEJORADO
    const transcript = lastResponseTranscript.trim();
    const endsClean = /[.!?…"»]$/.test(transcript);
    const isTooShort = transcript.length < MIN_COMPLETE_SENTENCE_CHARS;
    const audioTooShort = audioDuration < MIN_AUDIO_DURATION_MS;
    const wasCutMidSpeech = !lastResponseComplete && !expectedResponseEnd;
    const wasIncomplete = wasCutMidSpeech || (!endsClean && !isTooShort && !lastResponseComplete);
    
    const cutDetectionData = {
        endsClean,
        isTooShort,
        audioTooShort,
        wasCutMidSpeech,
        wasIncomplete,
        lastChar: transcript.slice(-5)
    };
    
    if (wasIncomplete && antiCutRetryCount < ANTI_CUT_MAX_RETRIES && vikiAwake && realtimeReady) {
        metrics.cutResponses++;
        metrics.recoveryAttempts++;
        antiCutRetryCount++;
        
        logEvent('ANTI-CUT', `⚠️ CORTE DETECTADO [${antiCutRetryCount}/${ANTI_CUT_MAX_RETRIES}]`, {
            ...cutDetectionData,
            ...stopData
        });
        
        setTimeout(() => {
            if (!realtimeReady || !vikiAwake) {
                logEvent('ANTI-CUT', 'Recuperación cancelada (no ready/awake)');
                return;
            }
            
            const recoveryPrompt = transcript.length > 20
                ? `Acabas de tener un problema técnico y tu frase se cortó. El último fragmento que dijiste fue: "${transcript.slice(-80)}". Continúa la frase de forma natural desde donde te cortaste, sin mencionar ningún problema técnico. El público no debe notar nada.`
                : `Hubo un problema técnico. Retoma la palabra de forma natural y continúa con lo que ibas a decir, sin mencionar ningún fallo.`;
            
            logEvent('ANTI-CUT', '🔄 Enviando recovery prompt', { 
                promptLength: recoveryPrompt.length 
            });
            
            sendRealtimeEvent({
                type: 'conversation.item.create',
                item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: recoveryPrompt }] }
            });
            sendRealtimeEvent({ type: 'response.create' });
            
            metrics.recoverySuccesses++;
        }, 300);
    } else {
        if (wasIncomplete) {
            logEvent('ANTI-CUT', '❌ Corte detectado pero max retries alcanzado', cutDetectionData);
        } else {
            metrics.completedResponses++;
            logEvent('RESPONSE', '✅ Respuesta completa', { 
                transcriptLength: transcript.length,
                audioDuration 
            });
        }
        
        lastResponseTranscript = '';
        lastResponseComplete = false;
        expectedResponseEnd = false;
        audioBufferStartTime = null;
        
        if (antiCutRetryCount >= ANTI_CUT_MAX_RETRIES) {
            antiCutRetryCount = 0;
        }
    }
    break;
}

        case 'response.output_item.done': {
            const item = event.item;
            if (item?.content) {
                const textBlock = item.content.find(c => c.type === 'text');
                const audioBlock = item.content.find(c => c.type === 'audio');
                const reply = textBlock?.text || audioBlock?.transcript || '';
                if (reply) {
                    addSessionMessage('assistant', reply);
                    applyEmotionFromText(reply);
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
                    } else {
                        // Guardar transcripción pasiva cuando NO detecta wake word
                        passiveTranscriptions.push({timestamp: Date.now(), text: text});
                        console.log('👂 Viky dormida escucha:', text);
                    }
                    break; // dormida — ignorar todo lo demás
                }

                  if (checkSleepWord(text)) {
                    console.log('😴 Sleep word detectada:', text);
                    sleepViki();
                    break;
                }
                
                // Si no, resetear timer y procesar normalmente
                resetWakeTimer();
                addSessionMessage('user', text);
                extractUserData(text);
            }
            break;

       case 'input_audio_buffer.speech_started':
    if (vikiAwake) resetWakeTimer();
    speechStartTime = Date.now(); // registrar cuándo empezó el habla
    if (!isSpeaking) applyExpression('listening');
    break;
case 'input_audio_buffer.speech_stopped':
    if (!vikiAwake) {
        // Guardar transcripción aunque esté dormida
        const audioTranscript = event.transcript?.trim();
        if (audioTranscript) {
            passiveTranscriptions.push({timestamp: Date.now(), text: audioTranscript});
            console.log('👂 Viky dormida escucha:', audioTranscript);
        }
        break;
    }
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
            lastResponseTranscript += deltaText; // acumular para anti-corte
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
    responseStartTime = Date.now();
    metrics.totalResponses++;
    
    logEvent('RESPONSE', '🔵 Response created', { vikiAwake });
    
    if (!vikiAwake) {
        sendRealtimeEvent({ type: 'response.cancel' });
        logEvent('RESPONSE', 'Response cancelada (dormida)');
        break;
    }
    
    lastResponseTranscript = '';
    lastResponseComplete = false;
    expectedResponseEnd = false;
    audioBufferStartTime = null;
    lipsyncTimeline = [];
    lipsyncStartTime = null;
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
        await initRealtimeWithRetry();
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

// send y chat eliminados — solo voz

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
// pdf-btn eliminado del UI
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
    
    if (isSpeaking && lipsyncActive) {
        updateLipsyncFromTimeline();
    }

    // ESTE BLOQUE SIEMPRE SE EJECUTA (aplica morphs)
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
                    const speed = isExpr ? 0.06 : cleanKey.includes('visema') ? 0.30 : 0.12;
                    currentMorphInfluences[fullKey] += (target - currentMorphInfluences[fullKey]) * speed;
                }
                mesh.morphTargetInfluences[idx] = Math.max(0, currentMorphInfluences[fullKey]);
            });
        });
    }

    // DECAY AL FINAL - después de aplicar
    if (!isSpeaking || !lipsyncActive) {
        if (window.animatableMeshes) {
            window.animatableMeshes.forEach(mesh => {
                const dict = mesh.morphTargetDictionary;
                if (!dict) return;
                Object.keys(dict).forEach(key => {
                    if (key.toLowerCase().includes('visema') || key.toLowerCase().includes('jaw')) {
                        const fullKey = `${mesh.name}_${key}`;
                        // Decay gradual en vez de reset directo
                        morphTargetValues[fullKey] *= 0.92;
                        currentMorphInfluences[fullKey] *= 0.92;
                    }
                });
            });
        }
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
    fg.light.position.set(fg.baseX, fg.baseY, fg.baseZ);  // SIN animación de posición
    fg.light.intensity = 15.0;  // INTENSIDAD FIJA Y BRUTAL, ignorando todo
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
// BOTÓN NUEVO EVENTO
// =============================================================================
document.getElementById('new-event-btn').addEventListener('click', () => {
    if (confirm('¿Iniciar nuevo evento?\n\nEsto borrará el resumen anterior.')) {
        localStorage.removeItem('viky_session_summary');
        location.reload();
    }
});

// Log inicial
logEvent('SYSTEM', '🚀 Sistema inicializado', { 
    reconnectMinutes: RECONNECT_MINUTES,
    antiCutMaxRetries: ANTI_CUT_MAX_RETRIES 
});