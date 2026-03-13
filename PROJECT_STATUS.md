# 🤖 Viky 3D Avatar - Estado del Proyecto (Feb 2026)

Documento de referencia para retomar el desarrollo.  
**Última actualización:** 18 Febrero 2026.

---

## 1. Resumen del Proyecto
Viky es un avatar 3D interactivo que funciona en el navegador.  
Usa **Three.js** para el renderizado visual, **OpenAI (GPT-4o)** para la inteligencia, y la **Web Speech API** nativa para Voz y Oído.

**Objetivo:** Crear una experiencia de asistente virtual ligera, rápida y sin costes fijos de servidores complejos (Serverless).

---

## 2. Arquitectura Técnica

### 🎨 Frontend (Cliente)
- **Motor 3D:** Three.js (Carga `Head_v1.gltf`).
- **Renderizado:** Ajustado con `ACESFilmicToneMapping` y `SRGBColorSpace` para realismo.
- **Micro:** `Web Speech API` (SpeechRecognition) en modo **Continuo**.
- **Voz:** `SpeechSynthesis` filtrando voces "Google" o "Neural".
- **Dependencias:** Ninguna (Zero-Dependencies). Todo funciona con CDN o nativo.

### 🧠 Backend (Servidor)
- **Plataforma:** Netlify Functions.
- **Ruta:** `/.netlify/functions/chat`.
- **Lógica:** Proxy simple que recibe texto y llama a **OpenAI API** usando `fetch` nativo (sin `node_modules`).
- **Seguridad:** La `OPENAI_API_KEY` está oculta en el servidor, nunca expuesta al cliente.

---

## 3. Funcionalidades "Vivas" (Implementadas) ✅

1.  **Visualización 3D Perfecta**:
    *   Carga automática del modelo GLTF.
    *   **Auto-fix de Texturas**: El código fuerza la carga de `Textures/tumama.png` si el modelo viene con rutas rotas.
    *   **Auto-centrado**: La cámara se ajusta sola al tamaño de la cabeza (bounding box).

2.  **Interacción por Voz (Walkie-Talkie Infinito)**:
    *   **Microfóno Continuo**: No hay que pulsar el botón cada vez.
    *   **Auto-Mute Inteligente**: Cuando Viky habla, el micrófono deja de procesar texto para evitar que se escuche a sí misma (evita bucles infinitos).

3.  **Expresividad y Vida**:
    *   **Lip-Sync Simulado**: La boca se mueve reaccionando al "volumen" simulado de la voz.
    *   **Parpadeo y Guiños**: Ciclo aleatorio de parpadeo (3-6s) y posibilidad de guiño coqueto (10%).
    *   **Idle Animation**: La cabeza oscila suavemente (respira) y mira a los lados.
    *   **Iluminación Reactiva**: Una luz frontal dorada se enciende/sube de intensidad cuando ella habla.

---

## 4. Instrucciones de Despliegue 🚀

Este proyecto está diseñado para ser **"Drag & Drop"** en Netlify.

1.  Arrastra la carpeta `viky-avatar-threejs` a tu panel de **Netlify**.
2.  Ve a **Site Settings > Environment Variables**.
3.  Añade la clave: `OPENAI_API_KEY` con tu llave `sk-...`.
4.  **Redeploy** (Trigger Deploy) para que pille la clave.

¡Listo! No hace falta `npm install` ni compilar nada.

---

## 5. Próximos Pasos (Roadmap) 🔮

Para la Fase 2, tenemos pendiente:

-   [ ] **Memoria a Largo Plazo**: Conectar con Firebase (como en el proyecto Fluge) para recordar nombres de usuarios y conversaciones pasadas.
-   [ ] **Voz Ultra-Realista**: Sustituir la voz de Google por **ElevenLabs API** (requiere streaming de audio binario) para eliminar el tono robótico.
-   [ ] **Cuerpo Completo**: Migrar a un modelo `.rpm` (ReadyPlayerMe) o similar si se desea animar manos/cuerpo.
-   [ ] **Detección de Silencio**: Mejorar la latencia de corte cuando el usuario deja de hablar.

---

**Nota para el Desarrollador (IA):**
El código clave está en `main.js`. Toda la lógica de morfología facial (visemas) y control de voz está centralizada ahí. El backend `chat.js` es minimalista a propósito para evitar errores de despliegue.
