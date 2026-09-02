// ═══════════════════════════════════════════════════════════
// FONTES — satori exige buffer de fonte manual (não lê @font-face
// nem fontes de sistema). Coloca Inter-Regular.ttf, Inter-Bold.ttf
// e Inter-SemiBold.ttf (opcional) em ./fonts/ na raiz do projeto.
// Download: https://fonts.google.com/specimen/Inter
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

let FONT_REGULAR = null;
let FONT_BOLD = null;
let FONT_SEMIBOLD = null;

try {
  FONT_REGULAR = fs.readFileSync(path.join(__dirname, 'fonts', 'Inter-Regular.ttf'));
  FONT_BOLD = fs.readFileSync(path.join(__dirname, 'fonts', 'Inter-Bold.ttf'));
  try {
    FONT_SEMIBOLD = fs.readFileSync(path.join(__dirname, 'fonts', 'Inter-SemiBold.ttf'));
  } catch (e) {
    FONT_SEMIBOLD = FONT_BOLD;
  }
} catch (e) {
  console.warn('⚠️  Fontes não encontradas em ./fonts/ — tools baseadas em satori vão falhar até adicionares Inter-Regular.ttf e Inter-Bold.ttf');
}

function requireFonts() {
  if (!FONT_REGULAR || !FONT_BOLD) {
    throw new Error('Fontes Inter não encontradas em ./fonts/ — adiciona Inter-Regular.ttf e Inter-Bold.ttf ao repo.');
  }
}

module.exports = {
  FONT_REGULAR,
  FONT_BOLD,
  FONT_SEMIBOLD,
  requireFonts,
};