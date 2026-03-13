# Viky Avatar 3D (Sin HeyGen)

Este proyecto es un avatar 3D propio, usando **Three.js** y **Web Speech API** para voz, con lip-sync simulado basado en el estado de "hablando".

## 🚀 Setup Rápido

### 1. Modelo 3D (Importado ✅)
He copiado automáticamente tu modelo `Head_v1.gltf`, el archivo `.bin` y la carpeta `Textures` desde tu escritorio (`vicky prototipo/Head`).
El modelo ya está en la raíz del proyecto listo para funcionar.

### 2. Configuración de API Key (OpenAI)
Para que Viky responda preguntas reales, necesitas añadir la variable de entorno `OPENAI_API_KEY` en Netlify:
- Ve a **Netlify > Site Settings > Environment Variables**
- Añade `OPENAI_API_KEY` con tu clave de OpenAI.

### 3. Deploy en Netlify
Simplemente arrastra esta carpeta a Netlify Drop o haz `git push`. La estructura ya está lista con `netlify.toml` implícito (carpeta `netlify/functions` detectada automáticamente).

## 🛠️ Cómo Funciona
- **Main.js**: Carga el modelo GLTF. Cuando el usuario pregunta, llama a la Netlify Function.
- **Chat.js (Backend)**: Recibe el mensaje, pregunta a GPT-4o-mini, y devuelve la respuesta.
- **SpeechSynthesis (Frontend)**: El navegador lee la respuesta.
- **Lip Sync (Simulado)**: Mientras el evento `speechSynthesis.speaking` es true, modulamos el morph target `visema_a` con una onda sinusoidal (`Math.sin`) para simular el movimiento de labios al hablar. Cuando para, forzamos `visema_sil = 1`.

## 📦 Dependencias (Backend)
- `openai` (vía `package.json`)
