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
const LOG_EVENTS = true; // cambiar a false para desactivar logs detallados
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
    
    // Mantener solo últimos 200 eventos
    if (eventLog.length > 200) eventLog.shift();
    
    // Guardar en localStorage cada 10 eventos
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

// Función para exportar logs (llamar desde consola)
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
};

// --- CONFIGURACIÓN ---
const MODEL_URL = './Viki_V3.gltf';
const RECONNECT_MINUTES = 55; // producción

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
        logEvent('CAMERA', 'Cámara activada');
    } catch (e) {
        logEvent('CAMERA', 'Cámara no disponible', { error: e.message });
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
    const yPos = 1.5;
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

    const particleCount = 60;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const r = 0.9 + Math.random() * 0.25;
        const a = Math.random() * Math.PI * 2;
        positions[i * 3] = Math.cos(a) * r;
        positions[i * 3 + 1] = Math.sin(a) * r;
        positions[i * 3 + 2] = 0;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    hudGroup.add(new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: 0xff69b4, size: 0.015, transparent: true, opacity: 0.6 })));

    hudElements.push({ group: hudGroup, ring1, ring2, segGroup, scanner, rotSpeed1: 0.003, rotSpeed2: -0.005 });
    logEvent('HUD', 'HUD futurista creado');
}

const loader = new GLTFLoader();
loader.load(MODEL_URL, (gltf) => {
    const model = gltf.scene;
    model.position.set(0, -0.82, 0);
    scene.add(model);
    window.vikiModel = model;
    logEvent('MODEL', 'Modelo Viky cargado');

    const box = new THREE.Box3().setFromObject(model);
    const modelSize = new THREE.Vector3();
    box.getSize(modelSize);

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

    window.animatableMeshes = [];
    model.traverse((child) => {
        if (child.isMesh && child.morphTargetDictionary) {
            window.animatableMeshes.push(child);
            Object.keys(child.morphTargetDictionary).forEach(k => {
                const fullKey = `${child.name}_${k}`;
                morphTargetValues[fullKey] = 0;
            });
        }
    });

    const texLoader = new THREE.TextureLoader();
    const texMap = { 'Holografic': 'Texture/Viki_Textura.png', 'Eye': 'Texture/Eye.png', 'eyebrow': 'Texture/Brow.png' };
    model.traverse((child) => {
        if (child.isMesh) {
            const matName = child.material?.name || '';
            if (texMap[matName]) {
                texLoader.load(texMap[matName], (texture) => {
                    child.material = new THREE.MeshStandardMaterial({
                        name: matName,
                        map: texture,
                        roughness: 0.6,
                        metalness: 0.2,
                    });
                    logEvent('TEXTURE', `Textura cargada: ${matName}`);
                });
            }
        }
    });

    buildHUD();
    initRealtime();
}, undefined, (err) => {
    logEvent('ERROR', 'Error al cargar modelo', { error: err });
});

// =============================================================================
// SISTEMA OPENAI REALTIME
// =============================================================================
let pc = null;
let dc = null;
let localStream = null;
let realtimeReady = false;
let isSpeaking = false;
let lipsyncTimeline = [];
let lipsyncStartTime = null;
let speechStartTime = null;

// Variables sistema anti-corte MEJORADO
let lastResponseTranscript = '';
let lastResponseComplete = false;
let antiCutRetryCount = 0;
let responseStartTime = null;          // NUEVO: timestamp cuando empieza respuesta
let audioBufferStartTime = null;       // NUEVO: timestamp cuando empieza audio
let expectedResponseEnd = false;       // NUEVO: flag si esperamos que termine

const ANTI_CUT_MAX_RETRIES = 3;        // aumentado de 2 a 3
const MIN_COMPLETE_SENTENCE_CHARS = 40;
const MIN_AUDIO_DURATION_MS = 500;     // NUEVO: duración mínima para considerar válida

// Sesión
let sessionMessages = [];
let sessionSummary = localStorage.getItem('viky_session_summary') || '';
let passiveTranscriptions = [];

// Wake/Sleep
let vikiAwake = false;
let wakeTimer = null;
const WAKE_DURATION_MS = 15 * 60 * 1000;
const WAKE_WORDS = ['vicky', 'viki', 'viqui', 'wiki', 'hola vicky', 'hola viki'];

// UI elements
const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading-indicator');

function addSessionMessage(role, content) {
    sessionMessages.push({ role, content, timestamp: Date.now() });
    logEvent('SESSION', `Mensaje añadido: ${role}`, { content: content.substring(0, 100) });
}

function checkWakeWord(text) {
    const lower = text.toLowerCase();
    const detected = WAKE_WORDS.some(w => lower.includes(w));
    if (detected) {
        logEvent('WAKE', 'Wake word detectada', { text });
    }
    return detected;
}

function activateViki() {
    if (vikiAwake) return;
    vikiAwake = true;
    logEvent('WAKE', 'Viky activada');
    statusEl.textContent = '🟢 Viky está escuchando';
    applyExpression('listening');
    resetWakeTimer();
}

function resetWakeTimer() {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
        vikiAwake = false;
        logEvent('WAKE', 'Viky dormida por inactividad');
        statusEl.textContent = '💤 Viky está dormida';
        applyIdleExpression();
    }, WAKE_DURATION_MS);
}

function deactivateViki() {
    vikiAwake = false;
    if (wakeTimer) clearTimeout(wakeTimer);
    logEvent('WAKE', 'Viky desactivada manualmente');
    statusEl.textContent = '💤 Viky está dormida';
    applyIdleExpression();
}

async function initRealtime() {
    try {
        logEvent('REALTIME', 'Iniciando conexión Realtime API');
        statusEl.textContent = '🔄 Conectando...';

        const tokenRes = await fetch('/.netlify/functions/session');
        const { client_secret } = await tokenRes.json();

        pc = new RTCPeerConnection();

        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        pc.ontrack = (e) => {
            audioEl.srcObject = e.streams[0];
            logEvent('REALTIME', 'Stream de audio recibido');
        };

        dc = pc.createDataChannel('oai-events');
        dc.addEventListener('message', (e) => {
            const event = JSON.parse(e.data);
            handleRealtimeEvent(event);
        });

        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        pc.addTrack(localStream.getTracks()[0]);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch('https://api.openai.com/v1/realtime', {
            method: 'POST',
            body: offer.sdp,
            headers: {
                Authorization: `Bearer ${client_secret.value}`,
                'Content-Type': 'application/sdp'
            },
        });

        await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

        dc.addEventListener('open', () => {
            realtimeReady = true;
            logEvent('REALTIME', 'Conexión establecida');
            statusEl.textContent = '💤 Viky está dormida (di "Hola Viky" para activarla)';

            const baseInstructions = `Eres Viky, una asistente inteligente de IMMERSO Live, presentada en el Congreso de Ingeniería en Fira Barcelona. Tu tono es profesional, amable y conciso. Respondes siempre en el idioma del usuario. Presentas las capacidades de avatares AI en eventos, hoteles y empresas.`;
            const contextInstructions = sessionSummary ? `\n\nCONTEXTO DE SESIÓN ANTERIOR:\n${sessionSummary}` : '';

            sendRealtimeEvent({
                type: 'session.update',
                session: {
                    modalities: ['audio', 'text'],
                    instructions: baseInstructions + contextInstructions,
                    voice: 'coral',
                    input_audio_format: 'pcm16',
                    output_audio_format: 'pcm16',
                    input_audio_transcription: { model: 'whisper-1' },
                    turn_detection: {
                        type: 'server_vad',
                        threshold: 0.5,
                        prefix_padding_ms: 300,
                        silence_duration_ms: 500
                    },
                    temperature: 0.8,
                    max_response_output_tokens: 4096
                }
            });

            // Timer reconexión 55 min
            if (window._reconnectTimer) clearTimeout(window._reconnectTimer);
            window._reconnectTimer = setTimeout(() => {
                logEvent('REALTIME', 'Auto-reconexión por timer 55min');
                reconnectRealtime();
            }, RECONNECT_MINUTES * 60 * 1000);
        });

    } catch (err) {
        logEvent('ERROR', 'Error iniciando Realtime', { error: err.message });
        statusEl.textContent = `❌ ${err.message}`;
    }
}

async function reconnectRealtime() {
    logEvent('REALTIME', 'Reconectando sesión');
    realtimeReady = false;

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
            logEvent('SESSION', 'Resumen generado', { summary: sessionSummary.substring(0, 100) });
        } catch(e) {
            logEvent('ERROR', 'Error generando resumen', { error: e.message });
            sessionSummary = '';
        }
    }

    passiveTranscriptions = [];

    if (dc) { try { dc.close(); } catch(e){} dc = null; }
    if (pc) { try { pc.close(); } catch(e){} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.querySelectorAll('audio').forEach(a => { a.srcObject = null; a.remove(); });
    await initRealtime();
}

function sendRealtimeEvent(event) {
    if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(event));
        logEvent('SEND', event.type, { details: event });
    }
}

// =============================================================================
// MANEJO DE EVENTOS REALTIME CON LOGGING DETALLADO
// =============================================================================
function handleRealtimeEvent(event) {
    switch (event.type) {
        
        case 'output_audio_buffer.started':
            audioBufferStartTime = Date.now(); // NUEVO: marcar inicio real de audio
            isSpeaking = true;
            applySpeakingExpression();
            loadingEl.classList.add('hidden');
            if (!lipsyncStartTime) lipsyncStartTime = Date.now() - 120;
            logEvent('AUDIO', '▶️ Audio buffer started', {
                responseAge: responseStartTime ? Date.now() - responseStartTime : null
            });
            break;

        case 'response.done':
            lastResponseComplete = true;
            expectedResponseEnd = true; // NUEVO: ahora esperamos que termine
            metrics.responseDones++;
            
            const responseData = {
                transcript: lastResponseTranscript.substring(0, 100),
                duration: responseStartTime ? Date.now() - responseStartTime : null,
                isSpeaking: isSpeaking
            };
            
            logEvent('RESPONSE', '✅ Response done', responseData);
            antiCutRetryCount = 0;
            setTimeout(() => applyIdleExpression(), 800);
            break;

        case 'output_audio_buffer.stopped': {
            const now = Date.now();
            const audioDuration = audioBufferStartTime ? now - audioBufferStartTime : 0;
            const totalResponseDuration = responseStartTime ? now - responseStartTime : 0;
            
            metrics.audioBufferStops++;
            
            // LOGGING DETALLADO DEL ESTADO
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
            lipsyncTimeline = [];
            lipsyncStartTime = null;
            Object.keys(morphTargetValues).forEach(k => { morphTargetValues[k] = 0; });

            // =============================================================================
            // SISTEMA ANTI-CORTE MEJORADO
            // Detecta cortes mid-speech con mayor precisión
            // =============================================================================
            const transcript = lastResponseTranscript.trim();
            const endsClean = /[.!?…"»]$/.test(transcript);
            const isTooShort = transcript.length < MIN_COMPLETE_SENTENCE_CHARS;
            const audioTooShort = audioDuration < MIN_AUDIO_DURATION_MS;
            
            // NUEVO: Detectar corte mid-speech
            // Si el audio se detuvo ANTES de que response.done llegara = CORTE
            const wasCutMidSpeech = !lastResponseComplete && !expectedResponseEnd;
            
            // Condiciones para considerar que hubo corte
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
                
                // Pequeña pausa antes de recuperar
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
                
                // Reset estado
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
                    logEvent('RESPONSE', 'Output item done', { replyLength: reply.length });
                }
            }
            break;
        }

        case 'conversation.item.input_audio_transcription.completed':
            if (event.transcript) {
                const text = event.transcript.trim();
                logEvent('USER', '🎤 Transcripción usuario', { text });

                if (!vikiAwake) {
                    if (checkWakeWord(text)) {
                        activateViki();
                        sendRealtimeEvent({
                            type: 'conversation.item.create',
                            item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[RESPONDE EN EL IDIOMA DE ESTE MENSAJE] ${text}` }] }
                        });
                        sendRealtimeEvent({ type: 'response.create' });
                    } else {
                        passiveTranscriptions.push({timestamp: Date.now(), text: text});
                        logEvent('PASSIVE', '👂 Escucha pasiva', { text });
                    }
                    break;
                }

                resetWakeTimer();
                addSessionMessage('user', text);
                extractUserData(text);
            }
            break;

        case 'input_audio_buffer.speech_started':
            if (vikiAwake) resetWakeTimer();
            speechStartTime = Date.now();
            if (!isSpeaking) applyExpression('listening');
            logEvent('USER', '🗣️ Usuario empieza a hablar');
            break;
            
        case 'input_audio_buffer.speech_stopped':
            if (!vikiAwake) {
                const audioTranscript = event.transcript?.trim();
                if (audioTranscript) {
                    passiveTranscriptions.push({timestamp: Date.now(), text: audioTranscript});
                    logEvent('PASSIVE', '👂 Escucha pasiva (stopped)', { text: audioTranscript });
                }
                break;
            }
            
            const speechDuration = speechStartTime ? Date.now() - speechStartTime : 0;
            speechStartTime = null;
            
            if (!isSpeaking) {
                applyExpression('thinking');
                loadingEl.classList.remove('hidden');
                loadingEl.textContent = 'Viky está pensando...';
            }
            
            logEvent('USER', '🤫 Usuario deja de hablar', { speechDuration });
            break;

        case 'response.audio_transcript.delta': {
            const deltaText = event.delta || '';
            lastResponseTranscript += deltaText;
            const newEntries = buildTimelineFromText(deltaText);
            if (newEntries.length > 0) {
                const offset = lipsyncTimeline.length > 0
                    ? lipsyncTimeline[lipsyncTimeline.length - 1].end : 0;
                newEntries.forEach(e => {
                    lipsyncTimeline.push({ start: e.start + offset, end: e.end + offset, visemes: e.visemes });
                });
            }
            
            // Log cada 100 caracteres para no saturar
            if (lastResponseTranscript.length % 100 === 0) {
                logEvent('TRANSCRIPT', 'Delta acumulado', { 
                    length: lastResponseTranscript.length,
                    last50: lastResponseTranscript.slice(-50)
                });
            }
            break;
        }

        case 'response.created':
            responseStartTime = Date.now(); // NUEVO: marcar inicio de respuesta
            metrics.totalResponses++;
            
            logEvent('RESPONSE', '🔵 Response created', { vikiAwake });
            
            if (!vikiAwake) {
                sendRealtimeEvent({ type: 'response.cancel' });
                logEvent('RESPONSE', 'Response cancelada (dormida)');
                break;
            }
            
            // Reset para nueva respuesta
            lastResponseTranscript = '';
            lastResponseComplete = false;
            expectedResponseEnd = false;
            audioBufferStartTime = null;
            lipsyncTimeline = [];
            lipsyncStartTime = null;
            break;

        case 'error':
            logEvent('ERROR', 'Error del servidor', { error: event.error });
            break;
    }
}

// =============================================================================
// EXPRESIONES Y ANIMACIÓN
// =============================================================================
function applyExpression(expr) {
    logEvent('EXPRESSION', `Aplicando: ${expr}`);
    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;
        Object.keys(dict).forEach(key => {
            const fullKey = `${mesh.name}_${key}`;
            const clean = key.toLowerCase();
            if (clean.includes('mouthclose') || clean.includes('blink')) return;
            morphTargetValues[fullKey] = 0;
        });
    });

    if (expr === 'listening') {
        setMorphValue('mouthSmileLeft', 0.15);
        setMorphValue('mouthSmileRight', 0.15);
    } else if (expr === 'thinking') {
        setMorphValue('browInnerUp', 0.25);
    }
}

function applySpeakingExpression() {
    if (!window.animatableMeshes) return;
    window.animatableMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        if (!dict) return;
        Object.keys(dict).forEach(key => {
            const fullKey = `${mesh.name}_${key}`;
            const clean = key.toLowerCase();
            if (clean.includes('brow') || clean.includes('cheek') || clean.includes('mouthsmile')) {
                morphTargetValues[fullKey] = 0;
            }
        });
    });
}

function applyIdleExpression() {
    applyExpression('neutral');
}

function setMorphValue(partialKey, value) {
    Object.keys(morphTargetValues).forEach(fullKey => {
        if (fullKey.toLowerCase().includes(partialKey.toLowerCase())) {
            morphTargetValues[fullKey] = value;
        }
    });
}

// =============================================================================
// LIPSYNC
// =============================================================================
const VISEME_MAP = {
    a: 'visema_aa', e: 'visema_E', i: 'visema_I', o: 'visema_O', u: 'visema_U',
    b: 'visema_PP', p: 'visema_PP', m: 'visema_PP',
    f: 'visema_FF', v: 'visema_FF',
    th: 'visema_TH', d: 'visema_DD', t: 'visema_DD', n: 'visema_nn',
    s: 'visema_SS', z: 'visema_SS', sh: 'visema_CH', ch: 'visema_CH',
    r: 'visema_RR', l: 'visema_nn', k: 'visema_kk', g: 'visema_kk'
};

function buildTimelineFromText(text) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const entries = [];
    let currentTime = 0;
    const AVG_CHAR_DURATION = 0.065;

    words.forEach(word => {
        const chars = word.split('');
        chars.forEach(char => {
            const viseme = VISEME_MAP[char] || null;
            if (viseme) {
                entries.push({
                    start: currentTime,
                    end: currentTime + AVG_CHAR_DURATION,
                    visemes: [{ name: viseme, weight: 0.75 }, { name: 'jawOpen', weight: 0.5 }]
                });
            }
            currentTime += AVG_CHAR_DURATION;
        });
        currentTime += 0.08;
    });

    return entries;
}

function updateLipsyncFromTimeline() {
    if (!lipsyncStartTime || lipsyncTimeline.length === 0) return;
    const elapsed = (Date.now() - lipsyncStartTime) / 1000;
    const activeFrames = lipsyncTimeline.filter(f => elapsed >= f.start && elapsed < f.end);

    Object.keys(morphTargetValues).forEach(k => {
        if (k.toLowerCase().includes('visema') || k.toLowerCase().includes('jawopen')) {
            morphTargetValues[k] = 0;
        }
    });

    activeFrames.forEach(frame => {
        frame.visemes.forEach(v => {
            setMorphValue(v.name, v.weight);
        });
    });
}

// =============================================================================
// PARPADEO + MIRADA
// =============================================================================
let lastBlink = 0;
let nextBlinkIn = Math.random() * 3000 + 2000;

function updateBlinks() {
    const now = Date.now();
    if (now - lastBlink > nextBlinkIn) {
        lastBlink = now;
        nextBlinkIn = Math.random() * 3000 + 2000;
        setMorphValue('eyeBlinkLeft', 1.0);
        setMorphValue('eyeBlinkRight', 1.0);
        setTimeout(() => {
            setMorphValue('eyeBlinkLeft', 0);
            setMorphValue('eyeBlinkRight', 0);
        }, 150);
    }
}

let gazeTargetX = 0, gazeTargetY = 0;
let gazeCurrentX = 0, gazeCurrentY = 0;
let gazeChangeTimer = 0;

function updateGaze(dt) {
    gazeChangeTimer -= dt;
    if (gazeChangeTimer <= 0) {
        gazeTargetX = (Math.random() - 0.5) * 0.3;
        gazeTargetY = (Math.random() - 0.5) * 0.2;
        gazeChangeTimer = Math.random() * 2 + 1;
    }
    gazeCurrentX += (gazeTargetX - gazeCurrentX) * 0.05;
    gazeCurrentY += (gazeTargetY - gazeCurrentY) * 0.05;

    if (window.animatableMeshes) {
        window.animatableMeshes.forEach(mesh => {
            if (mesh.name.toLowerCase().includes('eye')) {
                mesh.rotation.x = gazeCurrentY * 0.3;
                mesh.rotation.y = gazeCurrentX * 0.4;
            }
        });
    }
}

setInterval(updateBlinks, 100);

let headNoiseT = 0;

function applyEmotionFromText(text) {
    const lower = text.toLowerCase();
    if (lower.includes('bienvenid') || lower.includes('hola') || lower.includes('encantad')) {
        setMorphValue('mouthSmileLeft', 0.4);
        setMorphValue('mouthSmileRight', 0.4);
    } else if (lower.includes('?')) {
        setMorphValue('browInnerUp', 0.3);
    }
}

function extractUserData(text) {
    // Placeholder para extracción de datos
}

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

    if (window.animatableMeshes) {
        window.animatableMeshes.forEach(mesh => {
            if (mesh.name.toLowerCase().includes('eye')) {
                if (Math.random() < 0.02) { mesh.rotation.x += (Math.random() - 0.5) * 0.03; mesh.rotation.y += (Math.random() - 0.5) * 0.03; }
                mesh.rotation.x *= 0.92; mesh.rotation.y *= 0.92;
            }
        });
    }

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
        fg.light.position.set(fg.baseX, fg.baseY, fg.baseZ);
        fg.light.intensity = 15.0;
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
    if (confirm('¿Iniciar nuevo evento?\n\nEsto borrará el resumen anterior y los logs.')) {
        localStorage.removeItem('viky_session_summary');
        localStorage.removeItem('viky_event_log');
        localStorage.removeItem('viky_metrics');
        logEvent('SYSTEM', 'Sesión reiniciada manualmente');
        location.reload();
    }
});

// Log inicial
logEvent('SYSTEM', '🚀 Sistema inicializado', { 
    reconnectMinutes: RECONNECT_MINUTES,
    antiCutMaxRetries: ANTI_CUT_MAX_RETRIES 
});