exports.handler = async (event) => {
    try {
        const { messages, passiveListening, instructions } = JSON.parse(event.body);

        // Construir el prompt con mensajes activos + escucha pasiva
        let conversationText = '';
        
        // Mensajes activos (lo que Viky dijo)
        if (messages && messages.length > 0) {
            conversationText += 'CONVERSACIONES ACTIVAS (Viky hablando):\n';
            conversationText += JSON.stringify(messages);
        }
        
        // Transcripciones pasivas (lo que Viky escuchó mientras dormía)
        if (passiveListening && passiveListening.length > 0) {
            conversationText += '\n\nESCUCHA PASIVA (mientras Viky dormía):\n';
            conversationText += passiveListening.map(t => t.text).join('\n');
        }

        const systemPrompt = instructions || 'Eres un asistente que genera resúmenes de conversación muy breves. Responde SOLO con un párrafo corto en español, sin saludos ni explicaciones.';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 300,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: conversationText
                    }
                ]
            }),
        });

        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content || '';
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary }),
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};