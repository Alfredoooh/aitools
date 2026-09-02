// ═══════════════════════════════════════════════════════════
// PDF/PPTX PREVIEW + ÁUDIO — implementações
// ═══════════════════════════════════════════════════════════

const pdfParse = require('pdf-parse');
const AdmZip = require('adm-zip');
const musicMetadata = require('music-metadata');
const { DESIGN, A4_WIDTH_PX, A4_HEIGHT_PX } = require('../config');
const { escapeHtml } = require('../helpers');
const { htmlToSvgViaSatori, svgToPngBuffer } = require('../satori-helpers');

async function pdfToImagesImpl(pdfBase64, maxPages) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    const buffer = Buffer.from(pdfBase64, 'base64');
    const data = await pdfParse(buffer);
    const firstPageText = data.text.split('\f')[0] || data.text.slice(0, 1500);
    const escapedLines = escapeHtml(firstPageText.slice(0, 1200)).split('\n').slice(0, 30).map(l => `<div style="display:flex; font-size:11px; color:${DESIGN.inkSoft}; padding-bottom:2px;">${l || '&nbsp;'}</div>`).join('');
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:white; font-family:Inter;">${escapedLines}</div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, A4_WIDTH_PX, A4_HEIGHT_PX);
    const pngBuffer = await svgToPngBuffer(svg);
    return {
      found: true, total_pages: data.numpages || 1, pages_rendered: 1,
      note: 'Preview aproximado da primeira página (texto extraído reformatado via satori) — não é rasterização pixel-perfect do PDF original.',
      images: [{ page: 1, content_base64: pngBuffer.toString('base64'), mime_type: 'image/png' }],
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar preview do PDF: ${e.message}` };
  }
}

async function pptxToImagesImpl(pptxBase64) {
  try {
    if (!pptxBase64) return { found: false, reason: "pptx_base64 vazio." };
    const buffer = Buffer.from(pptxBase64, 'base64');
    const zip = new AdmZip(buffer);
    const slideEntries = zip.getEntries().filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName)).sort((a, b) => {
      const na = parseInt(a.entryName.match(/\d+/)[0]), nb = parseInt(b.entryName.match(/\d+/)[0]);
      return na - nb;
    });
    if (slideEntries.length === 0) return { found: false, reason: "Nenhum slide encontrado no PPTX." };
    const images = [];
    for (let i = 0; i < Math.min(slideEntries.length, 15); i++) {
      const xml = slideEntries[i].getData().toString('utf8');
      const textMatches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, '')).filter(Boolean);
      const linesHtml = texts.slice(0, 12).map((t, idx) => `<div style="display:flex; font-size:${idx === 0 ? 22 : 14}px; font-weight:${idx === 0 ? 700 : 400}; color:${DESIGN.ink}; padding-bottom:8px;">${escapeHtml(t)}</div>`).join('');
      const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:white; font-family:Inter;">${linesHtml}</div>`;
      try {
        const svg = await htmlToSvgViaSatori(bodyHtml, 960, 540);
        const pngBuffer = await svgToPngBuffer(svg);
        images.push({ slide: i + 1, content_base64: pngBuffer.toString('base64'), mime_type: 'image/png' });
      } catch (_) {}
    }
    return { found: true, total_slides: slideEntries.length, images, note: 'Preview baseado no texto extraído de cada slide — não reproduz imagens, formas ou estilo original do PowerPoint.' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar preview do PPTX: ${e.message}` };
  }
}

async function audioDurationCheckImpl(audioBase64) {
  try {
    if (!audioBase64) return { found: false, reason: "audio_base64 vazio." };
    const buffer = Buffer.from(audioBase64, 'base64');
    const metadata = await musicMetadata.parseBuffer(buffer);
    const common = metadata.common || {};
    const format = metadata.format || {};
    return {
      found: true,
      duration_seconds: format.duration || null,
      duration_formatted: format.duration ? `${Math.floor(format.duration / 60)}:${String(Math.round(format.duration % 60)).padStart(2, '0')}` : null,
      title: common.title || null,
      artist: common.artist || null,
      album: common.album || null,
      year: common.year || null,
      genre: (common.genre || []).join(', ') || null,
      track_number: common.track && common.track.no ? common.track.no : null,
      format: format.container || null,
      codec: format.codec || null,
      sample_rate_hz: format.sampleRate || null,
      bitrate_kbps: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      channels: format.numberOfChannels || null,
      has_embedded_cover: !!(common.picture && common.picture.length > 0),
      size_bytes: buffer.length,
    };
  } catch (e) {
    return { found: false, reason: `Erro ao ler metadados de áudio: ${e.message}` };
  }
}

module.exports = {
  pdfToImagesImpl,
  pptxToImagesImpl,
  audioDurationCheckImpl,
};