exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { nombre, empresa, email, tema, conversacion } = JSON.parse(event.body);

        const headers = {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        };

        // 1. Email interno a IMMERSO con el lead completo
        const htmlInterno = `
            <h2>🎯 Nuevo Lead — Viky IMMERSO</h2>
            <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse;">
                <tr><td style="padding:6px 12px;font-weight:bold;">Nombre</td><td style="padding:6px 12px;">${nombre || '—'}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:bold;">Empresa</td><td style="padding:6px 12px;">${empresa || '—'}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:bold;">Email</td><td style="padding:6px 12px;">${email || '—'}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:bold;">Tema</td><td style="padding:6px 12px;">${tema || '—'}</td></tr>
            </table>
            <hr/>
            <h3>Conversación</h3>
            <pre style="font-family:sans-serif;font-size:13px;white-space:pre-wrap;">${conversacion || '—'}</pre>
        `;

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                from: 'Viky IMMERSO <onboarding@resend.dev>',
                to: 'antonioloriso822@gmail.com',
                subject: `🎯 Nuevo lead: ${nombre || 'Visitante'} — ${empresa || 'Sin empresa'}`,
                html: htmlInterno,
            }),
        });

        // 2. Email de confirmación al visitante
        if (email && email.includes('@')) {
            const htmlVisitante = `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                    <h2 style="color:#00d4ff;">Hola ${nombre || 'de nuevo'} 👋</h2>
                    <p>Ha sido un placer hablar contigo. Te escribo para confirmar que hemos recibido tu interés y nos pondremos en contacto contigo muy pronto.</p>
                    ${empresa ? `<p>Estamos deseando explorar cómo podemos ayudar a <strong>${empresa}</strong> con nuestras soluciones de IA.</p>` : ''}
                    <p>Mientras tanto, puedes saber más sobre nosotros en <a href="https://immerso.live" style="color:#00d4ff;">immerso.live</a></p>
                    <br/>
                    <p>Un saludo,<br/><strong>El equipo de IMMERSO</strong><br/>info@immerso.live</p>
                </div>
            `;

            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    from: 'Viky IMMERSO <onboarding@resend.dev>',
                    to: email,
                    subject: `Gracias por tu interés en IMMERSO, ${nombre || ''}`,
                    html: htmlVisitante,
                }),
            });
        }

        return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};