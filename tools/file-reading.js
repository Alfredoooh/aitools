// ═══════════════════════════════════════════════════════════
// LEITURA DE FICHEIROS ENVIADOS
// ═══════════════════════════════════════════════════════════

const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const { ZIP_MAX_BYTES, ZIP_MAX_FILES, ZIP_TEXT_TRUNCATE, ZIP_MAX_IMAGES, ZIP_IMAGE_MAX_BYTES, PDF_MAX_PAGES_TEXT, TEXT_EXTENSIONS, IMAGE_EXTENSIONS } = require('../config');
const { extOf, mimeForImageExt } = require('../helpers');

async function readZipContentsImpl(zipBase64) {
  try {
    if (!zipBase64) return { found: false, reason: "zip_base64 vazio." };
    const buffer = Buffer.from(zipBase64, 'base64');
    if (buffer.length > ZIP_MAX_BYTES) return { found: false, reason: `ZIP excede o limite de ${ZIP_MAX_BYTES / (1024 * 1024)}MB.` };
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory).slice(0, ZIP_MAX_FILES);
    const files = [];
    let imageCount = 0;
    for (const entry of entries) {
      const ext = extOf(entry.entryName);
      if (IMAGE_EXTENSIONS.has(ext) && imageCount < ZIP_MAX_IMAGES) {
        const data = entry.getData();
        if (data.length <= ZIP_IMAGE_MAX_BYTES) {
          files.push({ path: entry.entryName, type: 'image', mime_type: mimeForImageExt(ext), content_base64: data.toString('base64'), size_bytes: data.length });
          imageCount++;
          continue;
        }
      }
      if (TEXT_EXTENSIONS.has(ext)) {
        const text = entry.getData().toString('utf8');
        files.push({ path: entry.entryName, type: 'text', content: text.slice(0, ZIP_TEXT_TRUNCATE), truncated: text.length > ZIP_TEXT_TRUNCATE, size_bytes: entry.header.size });
        continue;
      }
      files.push({ path: entry.entryName, type: 'binary', size_bytes: entry.header.size, note: 'Conteúdo não incluído (tipo binário não suportado ou imagem grande demais).' });
    }
    return { found: true, total_entries: zip.getEntries().length, files_read: files.length, files };
  } catch (e) {
    return { found: false, reason: `Erro ao ler ZIP: ${e.message}` };
  }
}

async function readPdfContentsImpl(pdfBase64) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    const buffer = Buffer.from(pdfBase64, 'base64');
    const data = await pdfParse(buffer);
    const numPages = data.numpages || 1;
    if (numPages > PDF_MAX_PAGES_TEXT) {
      return { found: true, total_pages: numPages, note: `PDF tem ${numPages} páginas — acima do limite de ${PDF_MAX_PAGES_TEXT}, a devolver só o texto concatenado sem separação por página.`, text: data.text.slice(0, 60000) };
    }
    return { found: true, total_pages: numPages, text: data.text, info: data.info || null };
  } catch (e) {
    return { found: false, reason: `Erro ao ler PDF: ${e.message}` };
  }
}

async function extractDocumentOutlineImpl(pdfBase64) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    const buffer = Buffer.from(pdfBase64, 'base64');
    const data = await pdfParse(buffer);
    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);
    const headings = lines.filter(l => l.length < 90 && (l === l.toUpperCase() || /^\d+(\.\d+)*\s+\S/.test(l))).slice(0, 60);
    return { found: true, total_pages: data.numpages || 1, headings_guess: headings, note: 'Heurística baseada em texto extraído — pode incluir falsos positivos/negativos, o PDF não tem marcação estrutural real de headings.' };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair esquema: ${e.message}` };
  }
}

module.exports = {
  readZipContentsImpl,
  readPdfContentsImpl,
  extractDocumentOutlineImpl,
};