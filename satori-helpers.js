// ═══════════════════════════════════════════════════════════
// SATORI — helpers de fonte e conversão HTML→SVG→PNG
// ═══════════════════════════════════════════════════════════

const satori = require('satori').default;
const html = require('satori-html').html;
const sharp = require('sharp');
const { FONT_REGULAR, FONT_BOLD, FONT_SEMIBOLD, requireFonts } = require('./fonts');

async function htmlToSvgViaSatori(htmlString, width, height) {
  requireFonts();
  const tree = html(htmlString);
  const svg = await satori(tree, {
    width: width || 800,
    height: height || 600,
    fonts: [
      { name: 'Inter', data: FONT_REGULAR, weight: 400, style: 'normal' },
      { name: 'Inter', data: FONT_SEMIBOLD || FONT_BOLD, weight: 600, style: 'normal' },
      { name: 'Inter', data: FONT_BOLD, weight: 700, style: 'normal' },
    ],
  });
  return svg;
}

async function svgToPngBuffer(svgString, scale) {
  const density = 72 * (scale || 2); // renderiza em @2x por defeito, evita PNG borrado
  return await sharp(Buffer.from(svgString), { density }).png().toBuffer();
}

module.exports = {
  htmlToSvgViaSatori,
  svgToPngBuffer,
};