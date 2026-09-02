// ═══════════════════════════════════════════════════════════
// IMAGEM — utilitários — implementações
// ═══════════════════════════════════════════════════════════

const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { fetchImageAsBase64 } = require('../helpers');

async function resolveImageBuffer(imageBase64, imageUrl) {
  if (imageBase64) return Buffer.from(imageBase64, 'base64');
  if (imageUrl) { const { buffer } = await fetchImageAsBase64(imageUrl); return buffer; }
  throw new Error('Fornece image_base64 ou image_url.');
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

/**
 * Marca d'água desenhada via sharp SVG nativo (sem satori) —
 * sharp aceita um buffer SVG como input de composite diretamente.
 */
async function watermarkImageImpl(imageBase64, watermarkText, position) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    if (!watermarkText) return { found: false, reason: "watermark_text vazio." };
    const baseBuffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(baseBuffer).metadata();
    const w = meta.width || 800;
    const h = meta.height || 600;
    const pos = position || 'bottom-right';
    
    const fontSize = Math.max(12, Math.round(w / 40));
    const paddingBox = 20;
    const textWidthEstimate = watermarkText.length * fontSize * 0.6 + 28;
    const boxHeight = fontSize + 20;
    
    let boxX, boxY;
    if (pos.includes('left')) boxX = paddingBox;
    else if (pos.includes('right')) boxX = w - textWidthEstimate - paddingBox;
    else boxX = (w - textWidthEstimate) / 2;
    
    if (pos.includes('top')) boxY = paddingBox;
    else if (pos.includes('bottom')) boxY = h - boxHeight - paddingBox;
    else boxY = (h - boxHeight) / 2;
    
    const escapedText = watermarkText
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const svgOverlay = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${boxX}" y="${boxY}" width="${textWidthEstimate}" height="${boxHeight}" rx="8" ry="8" fill="rgba(15,23,42,0.55)" />
      <text x="${boxX + 14}" y="${boxY + boxHeight / 2 + fontSize / 3}" font-family="sans-serif" font-size="${fontSize}" fill="white">${escapedText}</text>
    </svg>`;
    
    const buffer = await sharp(baseBuffer)
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toBuffer();
    
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem com marca d\'água' };
  } catch (e) {
    return { found: false, reason: `Erro ao aplicar marca d'água: ${e.message}` };
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
  convertImageFormatImpl,
  resizeImageImpl,
  cropImageImpl,
  watermarkImageImpl,
  ocrExtractTextImpl,
};