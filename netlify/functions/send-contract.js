exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing RESEND_API_KEY' }) };

    const { nombre, apellidos, dni, nacimiento, email, telefono, producto, iban, poliza, fechaEfecto, codigoPostal, direccion } = JSON.parse(event.body);
    const nombreCompleto = `${nombre} ${apellidos}`;
    const ibanOculto = iban.replace(/\S(?=\S{4})/g, '*');

    // ── EMAIL AL CLIENTE (estilo AXA real) ─────────────────────────────────────
    const emailCliente = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width"/></head>
    <body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 0;">
        <tr><td align="center">
          <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
            
            <!-- HEADER AXA -->
            <tr>
              <td style="background:#004B8D;padding:28px 40px;text-align:left;">
                <div style="color:#ffffff;font-size:32px;font-weight:bold;letter-spacing:2px;">AXA</div>
                <div style="color:#B0D8F8;font-size:13px;margin-top:4px;">Seguros · Ahorro · Inversión</div>
              </td>
            </tr>

            <!-- CUERPO -->
            <tr>
              <td style="padding:36px 40px;">
                <h2 style="color:#004B8D;font-size:22px;margin:0 0 8px 0;">Gracias por confiar en AXA</h2>
                <p style="color:#333;font-size:15px;margin:0 0 24px 0;">Hola <strong>${nombre}</strong>,</p>
                <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 20px 0;">
                  Te damos la bienvenida a tu <strong>${producto}</strong> con nº de póliza 
                  <strong style="color:#004B8D;">${poliza}</strong> y fecha de efecto <strong>${fechaEfecto}</strong>.
                </p>

                <!-- CAJA PÓLIZA -->
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7ff;border-left:4px solid #004B8D;border-radius:8px;margin:0 0 24px 0;">
                  <tr><td style="padding:18px 20px;">
                    <p style="margin:0 0 8px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;">Resumen de tu póliza</p>
                    <p style="margin:0 0 6px 0;font-size:14px;color:#333;"><strong>Producto:</strong> ${producto}</p>
                    <p style="margin:0 0 6px 0;font-size:14px;color:#333;"><strong>Nº de póliza:</strong> ${poliza}</p>
                    <p style="margin:0 0 6px 0;font-size:14px;color:#333;"><strong>Fecha de efecto:</strong> ${fechaEfecto}</p>
                    <p style="margin:0;font-size:14px;color:#333;"><strong>Domiciliación:</strong> ${ibanOculto}</p>
                  </td></tr>
                </table>

                <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 20px 0;">
                  Consulta los siguientes documentos para conocer y sacar el máximo partido a tu nuevo seguro:
                </p>

                <ul style="color:#555;font-size:14px;line-height:2;padding-left:20px;margin:0 0 24px 0;">
                  <li><strong>Tarjeta sanitaria:</strong> en breve la recibirás y estará disponible en tu App MyAXA.</li>
                  <li><strong>Tu póliza de seguro</strong>, con todo el detalle del producto contratado.</li>
                  <li><strong>Guía de uso rápida</strong>, para que sepas cómo actuar ante cualquier necesidad.</li>
                </ul>

                <!-- BOTÓN MYAXA -->
                <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="background:#004B8D;border-radius:8px;padding:14px 28px;">
                      <a href="https://www.axa.es/cliente/axa" style="color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">
                        Acceder a MyAXA →
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="color:#888;font-size:12px;line-height:1.6;margin:0;">
                  Recuerda revisar que tus datos sean correctos y completar el proceso de firma digital.<br/>
                  Si necesitas más información, contacta con tu asesor o visita <a href="https://www.axa.es" style="color:#004B8D;">www.axa.es</a>.
                </p>
              </td>
            </tr>

            <!-- FIRMA -->
            <tr>
              <td style="background:#f8f9fb;padding:20px 40px;border-top:1px solid #eee;">
                <p style="margin:0;color:#555;font-size:13px;">Gracias por tu confianza,<br/><strong style="color:#004B8D;">Tu Equipo AXA</strong></p>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="background:#004B8D;padding:16px 40px;text-align:center;">
                <p style="margin:0;color:#B0D8F8;font-size:11px;">
                  AXA Seguros Generales S.A. · Monseñor Palmer, 1 · 07014 Palma de Mallorca · 
                  <a href="https://www.axa.es" style="color:#B0D8F8;">www.axa.es</a>
                </p>
              </td>
            </tr>

          </table>
        </td></tr>
      </table>
    </body>
    </html>`;

    // ── EMAIL INTERNO A IMMERSO ─────────────────────────────────────────────────
    const emailInterno = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"/></head>
    <body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:30px;">
      <div style="background:#fff;border-radius:10px;padding:28px;max-width:500px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
        <h2 style="color:#004B8D;margin:0 0 18px 0;">🎉 Nueva contratación AXA — Demo Viki</h2>
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;width:140px;">Nombre</td><td style="padding:8px 0;color:#333;"><strong>${nombreCompleto}</strong></td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">DNI</td><td style="padding:8px 0;color:#333;">${dni || '—'}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Nacimiento</td><td style="padding:8px 0;color:#333;">${nacimiento || '—'}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Email</td><td style="padding:8px 0;color:#333;">${email}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Teléfono</td><td style="padding:8px 0;color:#333;">${telefono || '—'}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Producto</td><td style="padding:8px 0;color:#004B8D;"><strong>${producto}</strong></td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">IBAN</td><td style="padding:8px 0;color:#333;font-family:monospace;">${iban}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Nº Póliza</td><td style="padding:8px 0;color:#004B8D;"><strong>${poliza}</strong></td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Código postal</td><td style="padding:8px 0;color:#333;">${codigoPostal || '—'}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;color:#888;">Dirección</td><td style="padding:8px 0;color:#333;">${direccion || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Fecha efecto</td><td style="padding:8px 0;color:#333;">${fechaEfecto}</td></tr>
        </table>
        <p style="margin:20px 0 0 0;font-size:12px;color:#aaa;">Demo Viki × AXA · IMMERSO · immerso.live</p>
      </div>
    </body>
    </html>`;

    try {
        // Enviar email al cliente
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Viki AXA <viki@immerso.live>',
                to: [email],
                subject: `Bienvenido/a a AXA — Tu póliza ${producto} está activa`,
                html: emailCliente
            })
        });

        // Enviar notificación interna
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Viki AXA <viki@immerso.live>',
                to: ['info@immerso.live'],
                subject: `🎉 Nueva contratación AXA Demo — ${nombreCompleto} · ${producto}`,
                html: emailInterno
            })
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true, poliza })
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};