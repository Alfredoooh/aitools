// ═══════════════════════════════════════════════════════════
// ENVIO DE EMAIL — via Resend REST API
// Suporta HTML rico e imagens embutidas via CID (attachments).
// Nota: <img src="data:base64,..."> direto no HTML NÃO funciona
// no Gmail/Outlook — eles bloqueiam data URIs. Por isso imagens
// vão como attachment com content_id, referenciadas no HTML como
// <img src="cid:o-id-escolhido">.
// ═══════════════════════════════════════════════════════════

const { RESEND_API_KEY, RESEND_FROM_EMAIL } = require('../config');

async function sendEmailImpl(to, subject, content, fromName, images) {
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
  
  const payload = {
    from: fromField,
    to: trimmedTo,
    subject: trimmedSubject,
    html: trimmedContent,
  };
  
  // Imagens embutidas via CID — cada uma vira um attachment,
  // e deve ser referenciada no html como <img src="cid:esse_content_id">
  if (Array.isArray(images) && images.length > 0) {
    const attachments = [];
    for (const img of images.slice(0, 10)) {
      if (!img.content_base64 || !img.content_id) continue;
      attachments.push({
        content: img.content_base64,
        filename: img.filename || `${img.content_id}.png`,
        content_id: img.content_id,
      });
    }
    if (attachments.length > 0) payload.attachments = attachments;
  }
  
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    
    const data = await r.json();
    
    if (!r.ok) {
      return { found: false, reason: `Resend devolveu ${r.status}: ${data.message || JSON.stringify(data)}` };
    }
    
    return {
      found: true,
      email_id: data.id || null,
      to: trimmedTo,
      subject: trimmedSubject,
      images_attached: payload.attachments ? payload.attachments.length : 0,
      label: `Email enviado para ${trimmedTo}`,
    };
  } catch (e) {
    return { found: false, reason: `Erro ao enviar email: ${e.message}` };
  }
}

module.exports = { sendEmailImpl };