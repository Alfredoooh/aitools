// ═══════════════════════════════════════════════════════════
// IMAGEM — utilitários — implementações
// ═══════════════════════════════════════════════════════════

const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const potrace = require('potrace');
const { VECTORIZE_MAX_DIMENSION } = require('../config');
const { escapeHtml, fetchImageAsBase64 } = require('../helpers');
const { htmlToSvgViaSatori } = require('../satori-helpers');

async function resolveImageBuffer(imageBase64, imageUrl) {
  if (imageBase64) return Buffer.from(imageBase64, 'base64');
  if (imageUrl) { const { buffer } = await fetchImageAsBase64(imageUrl); return buffer; }
  throw new Error('Fornece image_base64 ou image_url.');
}

async function getImageColorsImpl(imageUrl, imageBase64, numColors) {
  try {
    const buffer = await resolveImageBuffer(imageBase64, imageUrl);
    const n = Math.min(Math.max(numColors || 5, 1), 10);
    const { data, info } = await sharp(buffer).resize(50, 50, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const counts = new Map();
    for (let i = 0; i < data.length; i += channels) {
      const r = Math.round(data[i] / 32) * 32, g = Math.round(data[i + 1] / 32) * 32, b = Math.round(data[i + 2] / 32) * 32;
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
    const toHex = (v) => Math.min(255, v).toString(16).padStart(2, '0');
    const colors = sorted.map(([key]) => { const [r, g, b] = key.split(',').map(Number); return `#${toHex(r)}${toHex(g)}${toHex(b)}`; });
    return { found: true, dominant_colors: colors };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair cores: ${e.message}` };
  }
}

async function convertImageFormatImpl(imageBase64, targetFormat) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    let pipeline = sharp(Buffer.from(imageBase64, 'base64'));
    if (targetFormat === 'jpg') pipeline = pipeline.jpeg({ quality: 90 });
    else if (targetFormat === 'webp') pipeline = pipeline.webp({ quality: 90 });
    else if (targetFormat === 'avif') pipeline = pipeline.avif({ quality: 80 });
    else pipeline = pipeline.png();
    const buffer = await pipeline.toBuffer();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
    return { found: true, content_base64: buffer.toString('base64'), mime_type: mimeMap[targetFormat] || 'image/png', label: `Imagem convertida (.${targetFormat})` };
  } catch (e) {
    return { found: false, reason: `Erro ao converter formato: ${e.message}` };
  }
}

async function resizeImageImpl(imageBase64, width, height) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    if (!width && !height) return { found: false, reason: "Fornece pelo menos width ou height." };
    const buffer = await sharp(Buffer.from(imageBase64, 'base64')).resize(width || null, height || null, { fit: 'inside' }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', width: meta.width, height: meta.height, label: 'Imagem redimensionada' };
  } catch (e) {
    return { found: false, reason: `Erro ao redimensionar: ${e.message}` };
  }
}

async function cropImageImpl(imageBase64, left, top, width, height) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = await sharp(Buffer.from(imageBase64, 'base64')).extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) }).png().toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem recortada' };
  } catch (e) {
    return { found: false, reason: `Erro ao recortar imagem: ${e.message}. Confirma que a região (left/top/width/height) cabe dentro das dimensões reais da imagem.` };
  }
}

async function watermarkImageImpl(imageBase64, watermarkText, position) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    if (!watermarkText) return { found: false, reason: "watermark_text vazio." };
    const baseBuffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(baseBuffer).metadata();
    const pos = position || 'bottom-right';
    const align = pos.includes('left') ? 'flex-start' : pos.includes('right') ? 'flex-end' : 'center';
    const justify = pos.includes('top') ? 'flex-start' : pos.includes('bottom') ? 'flex-end' : 'center';
    const overlayHtml = `<div style="display:flex; width:${meta.width}px; height:${meta.height}px; align-items:${justify}; justify-content:${align}; padding:20px;">
      <div style="display:flex; background:rgba(15,23,42,0.55); color:white; padding:7px 14px; border-radius:8px; font-size:${Math.max(12, Math.round(meta.width / 40))}px; font-family:Inter;">${escapeHtml(watermarkText)}</div>
    </div>`;
    const { svgToPngBuffer } = require('../satori-helpers');
    const svg = await htmlToSvgViaSatori(overlayHtml, meta.width, meta.height);
    const overlayBuffer = await svgToPngBuffer(svg);
    const buffer = await sharp(baseBuffer).composite([{ input: overlayBuffer, top: 0, left: 0 }]).png().toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem com marca d\'água' };
  } catch (e) {
    return { found: false, reason: `Erro ao aplicar marca d'água: ${e.message}` };
  }
}

async function imageMetadataImpl(imageBase64) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(buffer).metadata();
    return { found: true, format: meta.format, width: meta.width, height: meta.height, has_alpha: !!meta.hasAlpha, size_bytes: buffer.length, color_space: meta.space || null };
  } catch (e) {
    return { found: false, reason: `Erro ao ler metadados: ${e.message}` };
  }
}

async function vectorizeImageImpl(imageBase64, mode) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(buffer).metadata();
    if (Math.max(meta.width || 0, meta.height || 0) > VECTORIZE_MAX_DIMENSION) {
      return { found: false, reason: `Imagem excede ${VECTORIZE_MAX_DIMENSION}px na maior dimensão — usa resize_image primeiro.` };
    }
    const pngBuffer = await sharp(buffer).png().toBuffer();
    const svg = await new Promise((resolve, reject) => {
      const TraceClass = mode === 'color' ? potrace.Posterizer : potrace.Potrace;
      const tracer = new TraceClass();
      tracer.loadImage(pngBuffer, (err) => {
        if (err) return reject(err);
        tracer.getSVG((err2, svgStr) => { if (err2) reject(err2); else resolve(svgStr); });
      });
    });
    return { found: true, svg, label: `Vetorizado (${mode || 'black_transparent'})` };
  } catch (e) {
    return { found: false, reason: `Erro ao vetorizar imagem: ${e.message}` };
  }
}

async function ocrExtractTextImpl(imageBase64, language) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = Buffer.from(imageBase64, 'base64');
    const lang = language === 'eng' ? 'eng' : 'por';
    const { data } = await Tesseract.recognize(buffer, lang);
    return { found: true, text: (data.text || '').trim(), confidence: data.confidence || null };
  } catch (e) {
    return { found: false, reason: `Erro no OCR: ${e.message}` };
  }
}

module.exports = {
  getImageColorsImpl,
  convertImageFormatImpl,
  resizeImageImpl,
  cropImageImpl,
  watermarkImageImpl,
  imageMetadataImpl,
  vectorizeImageImpl,
  ocrExtractTextImpl,
};