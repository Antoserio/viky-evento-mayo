exports.handler = async (event) => {
    try {
        const { messages } = JSON.parse(event.body);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 200,
                messages: [
                    {
                        role: 'system',
                        content: 'Eres un asistente que genera resúmenes de conversación muy breves. Responde SOLO con un párrafo corto en español, sin saludos ni explicaciones.'
                    },
                    {
                        role: 'user',
                        content: `Resume en 2-3 frases el contexto de esta conversación para que Viky sepa con quién ha hablado y de qué, sin repetir todo: ${JSON.stringify(messages)}`
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