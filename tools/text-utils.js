// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS DE TEXTO / DADOS — implementações
// ═══════════════════════════════════════════════════════════

const pdfLib = require('pdf-lib');
const { escapeHtml } = require('../helpers');

function strReplaceFileImpl(content, oldStr, newStr) {
  if (typeof content !== 'string' || content.length === 0) return { found: false, reason: "content vazio ou inválido." };
  if (typeof oldStr !== 'string' || oldStr.length === 0) return { found: false, reason: "old_str vazio — não há o que procurar." };
  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) return { found: false, reason: "old_str não encontrado no ficheiro. Confirma espaços, indentação e quebras de linha exatas." };
  if (occurrences > 1) return { found: false, reason: `old_str aparece ${occurrences} vezes — não é único. Inclui mais linhas de contexto para o tornar específico a uma só ocorrência.` };
  const updatedContent = content.replace(oldStr, newStr ?? '');
  return { found: true, content: updatedContent, chars_before: content.length, chars_after: updatedContent.length };
}

function diffTextImpl(textBefore, textAfter) {
  const before = (textBefore || '').split('\n');
  const after = (textAfter || '').split('\n');
  const maxLen = Math.max(before.length, after.length);
  const changes = [];
  for (let i = 0; i < maxLen; i++) {
    const b = before[i], a = after[i];
    if (b === a) continue;
    if (b !== undefined && a === undefined) changes.push({ line: i + 1, type: 'removed', content: b });
    else if (b === undefined && a !== undefined) changes.push({ line: i + 1, type: 'added', content: a });
    else changes.push({ line: i + 1, type: 'changed', before: b, after: a });
  }
  return { found: true, total_changes: changes.length, changes: changes.slice(0, 200) };
}

function extractUrlsFromTextImpl(text) {
  if (!text) return { found: false, reason: "text vazio." };
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const unique = Array.from(new Set(matches));
  if (unique.length === 0) return { found: false, reason: "Nenhum URL encontrado no texto." };
  return { found: true, urls: unique };
}

function formatMarkdownToHtmlImpl(markdown) {
  if (!markdown) return { found: false, reason: "markdown vazio." };
  let htmlOut = escapeHtml(markdown);
  htmlOut = htmlOut.replace(/^### (.*$)/gim, '<h3>$1</h3>').replace(/^## (.*$)/gim, '<h2>$1</h2>').replace(/^# (.*$)/gim, '<h1>$1</h1>');
  htmlOut = htmlOut.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
  htmlOut = htmlOut.replace(/^\- (.*$)/gim, '<li>$1</li>');
  htmlOut = htmlOut.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  htmlOut = htmlOut.split('\n\n').map(p => p.trim().startsWith('<h') || p.trim().startsWith('<ul') ? p : `<p>${p}</p>`).join('\n');
  return { found: true, html: htmlOut };
}

function countTokensEstimateImpl(text) {
  if (!text) return { found: false, reason: "text vazio." };
  const estimatedTokens = Math.ceil(text.length / 4);
  return { found: true, char_count: text.length, estimated_tokens: estimatedTokens, note: "Heurística ~4 chars/token — não é um tokenizer exato de nenhum modelo específico." };
}

function textSummaryStatsImpl(text) {
  if (!text) return { found: false, reason: "text vazio." };
  const words = (text.match(/\S+/g) || []).length;
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length || 1;
  const readingTimeMin = Math.max(1, Math.round(words / 200));
  return { found: true, word_count: words, sentence_count: sentences, paragraph_count: paragraphs, estimated_reading_time_minutes: readingTimeMin };
}

async function youtubeThumbnailExtractImpl(youtubeUrl) {
  try {
    if (!youtubeUrl) return { found: false, reason: "youtube_url vazio." };
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { found: false, reason: `Vídeo não encontrado ou URL inválido (${r.status}).` };
    const data = await r.json();
    return { found: true, title: data.title, thumbnail_url: data.thumbnail_url, author_name: data.author_name };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair thumbnail: ${e.message}` };
  }
}

async function mergePdfsImpl(pdfsBase64) {
  try {
    if (!pdfsBase64 || pdfsBase64.length < 2) return { found: false, reason: "Fornece pelo menos 2 PDFs em pdfs_base64." };
    const merged = await pdfLib.PDFDocument.create();
    for (const b64 of pdfsBase64) {
      const src = await pdfLib.PDFDocument.load(Buffer.from(b64, 'base64'));
      const copiedPages = await merged.copyPages(src, src.getPageIndices());
      copiedPages.forEach(p => merged.addPage(p));
    }
    const bytes = await merged.save();
    return { found: true, content_base64: Buffer.from(bytes).toString('base64'), filename: 'documentos_unidos.pdf', mime_type: 'application/pdf', label: `${pdfsBase64.length} PDFs unidos` };
  } catch (e) {
    return { found: false, reason: `Erro ao unir PDFs: ${e.message}` };
  }
}

async function splitPdfPagesImpl(pdfBase64, pageNumbers) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    if (!pageNumbers || pageNumbers.length === 0) return { found: false, reason: "page_numbers vazio." };
    const src = await pdfLib.PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
    const totalPages = src.getPageCount();
    const zeroIndexed = pageNumbers.map(n => n - 1).filter(n => n >= 0 && n < totalPages);
    if (zeroIndexed.length === 0) return { found: false, reason: `Nenhuma página válida — o PDF tem ${totalPages} páginas.` };
    const out = await pdfLib.PDFDocument.create();
    const copiedPages = await out.copyPages(src, zeroIndexed);
    copiedPages.forEach(p => out.addPage(p));
    const bytes = await out.save();
    return { found: true, content_base64: Buffer.from(bytes).toString('base64'), filename: 'paginas_extraidas.pdf', mime_type: 'application/pdf', label: `${zeroIndexed.length} páginas extraídas` };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair páginas: ${e.message}` };
  }
}

module.exports = {
  strReplaceFileImpl,
  diffTextImpl,
  extractUrlsFromTextImpl,
  formatMarkdownToHtmlImpl,
  countTokensEstimateImpl,
  textSummaryStatsImpl,
  youtubeThumbnailExtractImpl,
  mergePdfsImpl,
  splitPdfPagesImpl,
};