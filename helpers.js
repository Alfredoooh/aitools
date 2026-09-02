// ═══════════════════════════════════════════════════════════
// HELPERS DE TEXTO/FICHEIRO — usados por várias tools
// ═══════════════════════════════════════════════════════════

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(name) {
  return (name || 'documento')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'documento';
}

function extOf(filename) {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

function mimeForImageExt(ext) {
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' } [ext] || 'application/octet-stream';
}

async function fetchImageAsBase64(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Falha ao descarregar imagem (${r.status}): ${url}`);
  const arrayBuffer = await r.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = r.headers.get('content-type') || 'image/png';
  return { base64: buffer.toString('base64'), mimeType: contentType, buffer };
}

module.exports = {
  escapeHtml,
  sanitizeFilename,
  extOf,
  mimeForImageExt,
  fetchImageAsBase64,
};