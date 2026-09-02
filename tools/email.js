// ═══════════════════════════════════════════════════════════
// ENVIO DE EMAIL — via Resend REST API
// ═══════════════════════════════════════════════════════════

const { RESEND_API_KEY, RESEND_FROM_EMAIL } = require('../config');

async function sendEmailImpl(to, subject, content, fromName) {
  const trimmedTo = (to || '').trim();
  const trimmedSubject = (subject || '').trim();
  const trimmedContent = (content || '').trim();
  
  if (!trimmedTo) return { found: false, reason: "to vazio." };
  if (!trimmedSubject) return { found: false, reason: "subject vazio." };
  if (!trimmedContent) return { found: false, reason: "content vazio." };
  if (!RESEND_API_KEY) return { found: false, reason: "RESEND_API_KEY não configurada no servidor." };
  
  const fromField = fromName ?
    `${fromName} <${RESEND_FROM_EMAIL}>` :
    RESEND_FROM_EMAIL;
  
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromField,
        to: trimmedTo,
        subject: trimmedSubject,
        html: trimmedContent,
      }),
      signal: AbortSignal.timeout(15000),
    });
    
    const data = await r.json();
    
    if (!r.ok) {
      return { found: false, reason: `Resend devolveu ${r.status}: ${data.message || JSON.stringify(data)}` };
    }
    
    return { found: true, email_id: data.id || null, to: trimmedTo, subject: trimmedSubject, label: `Email enviado para ${trimmedTo}` };
  } catch (e) {
    return { found: false, reason: `Erro ao enviar email: ${e.message}` };
  }
}

module.exports = { sendEmailImpl };