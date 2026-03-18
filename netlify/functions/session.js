const { VIKY_IDENTITY } = require('./identity');

exports.handler = async () => {
    try {
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-realtime-preview-2024-12-17',
                voice: 'shimmer',
                instructions: VIKY_IDENTITY,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            return { statusCode: response.status, body: JSON.stringify({ error: err }) };
        }

        const data = await response.json();
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};