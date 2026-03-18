exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing RESEND_API_KEY' }) };

    const { nombre, telefono, email, producto } = JSON.parse(event.body);

    const emailInterno = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"/></head>
    <body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:30px;">
      <div style="background:#fff;border-radius:10px;padding:28px;max-width:500px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
        <h2 style="color:#004B8D;margin:0 0 18px 0;">📞 Nuevo contacto AXA — Demo Viki</h2>
        <p style="color:#555;font-size:14px;margin:0 0 18px 0;">Un cliente ha solicitado ser contactado por un asesor.</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px 0;color:#888;width:140px;">Nombre</td>
            <td style="padding:8px 0;color:#333;"><strong>${nombre}</strong></td>
          </tr>
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px 0;color:#888;">Teléfono</td>
            <td style="padding:8px 0;color:#004B8D;"><strong>${telefono}</strong></td>
          </tr>
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px 0;color:#888;">Email</td>
            <td style="padding:8px 0;color:#333;">${email}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#888;">Seguro de interés</td>
            <td style="padding:8px 0;color:#333;">${producto || '—'}</td>
          </tr>
        </table>
        <p style="margin:20px 0 0 0;font-size:12px;color:#aaa;">Demo Viki × AXA · IMMERSO · immerso.live</p>
      </div>
    </body>
    </html>`;

    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Viki AXA <viki@immerso.live>',
                to: ['info@immerso.live'],
                subject: `📞 Nuevo contacto AXA — ${nombre} · ${producto || 'Seguro'}`,
                html: emailInterno
            })
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true })
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};