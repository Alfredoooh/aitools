// ═══════════════════════════════════════════════════════════
// GERAÇÃO DE IMAGEM — implementações
// ═══════════════════════════════════════════════════════════

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const math = require('mathjs');
const { DESIGN } = require('../config');
const { escapeHtml } = require('../helpers');
const { htmlToSvgViaSatori, svgToPngBuffer } = require('../satori-helpers');

async function generateChartImpl(chartType, title, labels, datasets) {
  try {
    const width = 900, height = 540;
    const chartCanvas = new ChartJSNodeCanvas({
      width, height,
      backgroundColour: '#ffffff',
      chartCallback: (ChartJS) => {
        ChartJS.defaults.font.family = "'Helvetica Neue', Arial, sans-serif";
        ChartJS.defaults.font.size = 12.5;
        ChartJS.defaults.color = DESIGN.inkSoft;
      },
    });

    const isPie = ['pie', 'doughnut', 'polarArea'].includes(chartType);
    const isRadar = chartType === 'radar';
    const palette = DESIGN.palette;

    const config = {
      type: chartType,
      data: {
        labels: labels || [],
        datasets: (datasets || []).map((d, i) => {
          const color = d.color || palette[i % palette.length];
          const soft = (d.color || palette[i % palette.length]) + '26';
          return {
            label: d.label || `Série ${i + 1}`,
            data: d.data || [],
            borderColor: isPie ? '#ffffff' : color,
            backgroundColor: isPie
              ? (d.data || []).map((_, j) => palette[j % palette.length])
              : (chartType === 'line' ? soft : color),
            borderWidth: chartType === 'line' ? 3 : (isPie ? 2 : 0),
            borderRadius: chartType === 'bar' ? 6 : 0,
            fill: chartType === 'line' ? true : (isRadar || chartType === 'polarArea'),
            tension: 0.35,
            pointRadius: chartType === 'line' ? 3 : undefined,
            pointBackgroundColor: color,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            pointHoverRadius: 5,
            hoverOffset: isPie ? 10 : undefined,
          };
        }),
      },
      options: {
        responsive: false,
        layout: { padding: { top: title ? 6 : 20, right: 24, bottom: 8, left: 8 } },
        plugins: {
          title: {
            display: !!title,
            text: title || '',
            font: { size: 19, weight: '700' },
            color: DESIGN.ink,
            padding: { bottom: 18 },
            align: 'start',
          },
          legend: {
            display: (datasets || []).length > 1 || isPie,
            position: 'bottom',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              padding: 16,
              font: { size: 12.5, weight: '500' },
              color: DESIGN.inkSoft,
            },
          },
        },
        scales: isPie ? {} : {
          x: {
            grid: { display: false },
            border: { display: true, color: DESIGN.border },
            ticks: { font: { size: 11.5 }, color: DESIGN.inkMuted },
          },
          y: {
            beginAtZero: true,
            grid: { color: DESIGN.gridLine },
            border: { display: false },
            ticks: { font: { size: 11.5 }, color: DESIGN.inkMuted, padding: 8 },
          },
        },
      },
    };
    const buffer = await chartCanvas.renderToBuffer(config);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: title || `Gráfico ${chartType}` };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar gráfico: ${e.message}` };
  }
}

async function generateHtmlImageImpl(htmlContent, width, height) {
  try {
    const svg = await htmlToSvgViaSatori(htmlContent, width, height);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem HTML' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar imagem HTML: ${e.message}. Nota: cada nó com mais de 1 filho precisa de display:flex explícito.` };
  }
}

async function generateFunctionPlotImpl(expression, xMin, xMax, title, highlightRoots) {
  try {
    const min = typeof xMin === 'number' ? xMin : -10;
    const max = typeof xMax === 'number' ? xMax : 10;
    const steps = 200;
    const labels = [];
    const values = [];
    const roots = [];
    let prevY = null, prevX = null;
    for (let i = 0; i <= steps; i++) {
      const x = min + (i / steps) * (max - min);
      let y;
      try { y = math.evaluate(expression, { x }); } catch (e) { throw new Error(`Expressão inválida: ${e.message}`); }
      labels.push(x.toFixed(2));
      values.push(typeof y === 'number' && isFinite(y) ? y : null);
      if (highlightRoots && prevY !== null && typeof y === 'number' && isFinite(y) && isFinite(prevY) && Math.sign(y) !== Math.sign(prevY)) {
        roots.push(((prevX + x) / 2).toFixed(2));
      }
      prevY = y; prevX = x;
    }
    const chartResult = await generateChartImpl('line', title || `f(x) = ${expression}`, labels, [{ label: expression, data: values, color: DESIGN.palette[0] }]);
    if (!chartResult.found) return chartResult;
    return { ...chartResult, roots_approx: highlightRoots ? roots : undefined };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar gráfico da função: ${e.message}` };
  }
}

function expressionHasVariableX(expression) {
  try {
    const node = math.parse(expression);
    let hasX = false;
    node.traverse(n => { if (n.isSymbolNode && n.name === 'x') hasX = true; });
    return hasX;
  } catch (e) {
    return false;
  }
}

async function generateMathSheetImpl(expression, showGraph) {
  try {
    if (!expression) return { found: false, reason: "expression vazia." };
    const wantsGraph = showGraph !== false && expressionHasVariableX(expression);

    if (wantsGraph) {
      const min = -10, max = 10, steps = 200;
      const labels = [], values = [];
      for (let i = 0; i <= steps; i++) {
        const x = min + (i / steps) * (max - min);
        let y;
        try { y = math.evaluate(expression, { x }); } catch (e) { return { found: false, reason: `Expressão inválida: ${e.message}` }; }
        labels.push(x.toFixed(1));
        values.push(typeof y === 'number' && isFinite(y) ? y : null);
      }
      const chartResult = await generateChartImpl('line', null, labels, [{ label: `f(x) = ${expression}`, data: values, color: DESIGN.palette[0] }]);
      if (!chartResult.found) return chartResult;

      let sampleAtZero = null;
      try {
        const y0 = math.evaluate(expression, { x: 0 });
        if (typeof y0 === 'number' && isFinite(y0)) sampleAtZero = y0;
      } catch (_) {}

      const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:${DESIGN.white}; font-family:Inter;">
        <div style="display:flex; flex-direction:column; padding-bottom:18px; border-bottom:2px solid ${DESIGN.ink}; margin-bottom:20px;">
          <div style="display:flex; font-size:12px; font-weight:600; color:${DESIGN.inkMuted}; letter-spacing:1px;">FICHA MATEMÁTICA</div>
          <div style="display:flex; font-size:26px; font-weight:700; color:${DESIGN.ink}; padding-top:4px;">f(x) = ${escapeHtml(expression)}</div>
        </div>
        <div style="display:flex; padding-bottom:16px;">
          <img src="data:image/png;base64,${chartResult.content_base64}" style="width:820px; border-radius:12px; border:1px solid ${DESIGN.border};" />
        </div>
        ${sampleAtZero !== null ? `<div style="display:flex; background:${DESIGN.surface}; border-radius:10px; padding:14px 18px;"><div style="display:flex; font-size:13px; color:${DESIGN.inkSoft};">Exemplo — em x = 0:  f(0) = ${escapeHtml(String(Math.round(sampleAtZero * 1000) / 1000))}</div></div>` : ''}
      </div>`;
      const svg = await htmlToSvgViaSatori(bodyHtml, 900, 680);
      const buffer = await svgToPngBuffer(svg);
      return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `f(x) = ${expression}`, has_graph: true };
    }

    let result;
    try { result = math.evaluate(expression); } catch (e) { return { found: false, reason: `Expressão inválida: ${e.message}` }; }
    const resultStr = typeof result === 'number' ? (Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : result.toString();
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:40px; background:${DESIGN.white}; font-family:Inter; align-items:center; justify-content:center;">
      <div style="display:flex; font-size:12px; font-weight:600; color:${DESIGN.inkMuted}; letter-spacing:1px; padding-bottom:14px;">RESULTADO</div>
      <div style="display:flex; font-size:22px; color:${DESIGN.inkMuted};">${escapeHtml(expression)}</div>
      <div style="display:flex; font-size:56px; font-weight:700; color:${DESIGN.ink}; padding-top:14px;">= ${escapeHtml(resultStr)}</div>
    </div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, 640, 340);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `${expression} = ${resultStr}`, result: resultStr, has_graph: false };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar ficha matemática: ${e.message}` };
  }
}

async function generateMindmapImpl(root) {
  try {
    if (!root || !root.label) return { found: false, reason: "root.label é obrigatório." };
    const palette = DESIGN.palette;
    function renderNode(node, depth, colorIdx) {
      const childrenHtml = (node.children || []).map((c, i) => renderNode(c, depth + 1, colorIdx + i + 1)).join('');
      const bg = depth === 0 ? DESIGN.ink : palette[colorIdx % palette.length];
      return `<div style="display:flex; flex-direction:column; align-items:flex-start; margin-left:${depth * 28}px; padding-top:${depth === 0 ? 0 : 8}px;">
        <div style="display:flex; background:${bg}; color:white; padding:9px 16px; border-radius:10px; font-size:${Math.max(12, 17 - depth * 1.5)}px; font-weight:${depth === 0 ? 700 : 600};">${escapeHtml(node.label || '')}</div>
        ${childrenHtml ? `<div style="display:flex; flex-direction:column; padding-left:14px; border-left:2px solid ${DESIGN.border}; margin-left:8px; margin-top:6px;">${childrenHtml}</div>` : ''}
      </div>`;
    }
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:${DESIGN.white}; font-family:Inter;">${renderNode(root, 0, 0)}</div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, 960, 720);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `Mapa mental: ${root.label}` };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar mapa mental: ${e.message}` };
  }
}

async function generateQrcodeImpl(content, size) {
  try {
    if (!content) return { found: false, reason: "content vazio." };
    const buffer = await QRCode.toBuffer(content, { width: size || 400, margin: 1, color: { dark: DESIGN.ink, light: '#FFFFFF' } });
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'QR Code' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar QR code: ${e.message}` };
  }
}

async function generateBarcodeImpl(content, format) {
  try {
    if (!content) return { found: false, reason: "content vazio." };
    const bcid = { code128: 'code128', ean13: 'ean13', ean8: 'ean8', upca: 'upca', qrcode: 'qrcode' }[format || 'code128'] || 'code128';
    const buffer = await new Promise((resolve, reject) => {
      bwipjs.toBuffer({ bcid, text: content, scale: 3, height: 12, includetext: true, textxalign: 'center' }, (err, buf) => {
        if (err) reject(err); else resolve(buf);
      });
    });
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `Código de barras (${bcid})` };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar código de barras: ${e.message}` };
  }
}

async function generateTableImageImpl(title, headers, rows) {
  try {
    if (!headers || headers.length === 0) return { found: false, reason: "headers vazio." };
    const headerCellsHtml = headers.map(h => `<div style="display:flex; flex:1; padding:12px 14px; font-weight:700; font-size:13px; color:white;">${escapeHtml(h)}</div>`).join('');
    const rowsHtml = (rows || []).map((row, i) => `<div style="display:flex; background:${i % 2 === 0 ? DESIGN.surface : DESIGN.white};">
      ${row.map(cell => `<div style="display:flex; flex:1; padding:10px 14px; font-size:12.5px; color:${DESIGN.inkSoft};">${escapeHtml(cell)}</div>`).join('')}
    </div>`).join('');
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; background:white; font-family:Inter; border-radius:14px; overflow:hidden; border:1px solid ${DESIGN.border};">
      ${title ? `<div style="display:flex; padding:16px 18px; font-size:16px; font-weight:700; color:${DESIGN.ink}; background:${DESIGN.surfaceAlt};">${escapeHtml(title)}</div>` : ''}
      <div style="display:flex; background:${DESIGN.ink};">${headerCellsHtml}</div>
      <div style="display:flex; flex-direction:column;">${rowsHtml}</div>
    </div>`;
    const width = Math.min(1200, Math.max(560, headers.length * 170));
    const height = 70 + (title ? 50 : 0) + (rows || []).length * 42;
    const svg = await htmlToSvgViaSatori(bodyHtml, width, height);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: title || 'Tabela' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar tabela: ${e.message}` };
  }
}

function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  const clean = hex.replace('#', '');
  if (clean.length === 3) { r = parseInt(clean[0] + clean[0], 16); g = parseInt(clean[1] + clean[1], 16); b = parseInt(clean[2] + clean[2], 16); }
  else if (clean.length === 6) { r = parseInt(clean.slice(0, 2), 16); g = parseInt(clean.slice(2, 4), 16); b = parseInt(clean.slice(4, 6), 16); }
  else throw new Error('Hex inválido');
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function generateColorSchemeImpl(baseColorHex) {
  try {
    if (!baseColorHex) return { found: false, reason: "base_color_hex vazio." };
    const { h, s } = hexToHsl(baseColorHex);
    return {
      found: true, base_color: baseColorHex,
      light: {
        primary: hslToHex(h, s, 50), secondary: hslToHex((h + 30) % 360, Math.max(20, s - 15), 55),
        background: hslToHex(h, 15, 98), surface: hslToHex(h, 10, 100), text: hslToHex(h, 10, 15),
      },
      dark: {
        primary: hslToHex(h, s, 65), secondary: hslToHex((h + 30) % 360, Math.max(20, s - 15), 60),
        background: hslToHex(h, 15, 10), surface: hslToHex(h, 12, 15), text: hslToHex(h, 10, 95),
      },
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar paleta: ${e.message}` };
  }
}

function seededRandomFactory(seedString) {
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) { hash = seedString.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; }
  let state = Math.abs(hash) || 1;
  return function next() {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

async function generateRandomAvatarImpl(seed, size) {
  try {
    const trimmed = (seed || '').toString();
    if (!trimmed) return { found: false, reason: "seed vazio." };
    const rand = seededRandomFactory(trimmed);
    const s = size || 256;
    const cx = s / 2, cy = s / 2;

    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) { hash = trimmed.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; }
    const baseHue = Math.abs(hash) % 360;
    const hueShift = 35 + Math.floor(rand() * 40);
    const colorA = `hsl(${baseHue}, 68%, 58%)`;
    const colorB = `hsl(${(baseHue + hueShift) % 360}, 70%, 62%)`;
    const colorC = `hsl(${(baseHue + hueShift * 2) % 360}, 65%, 50%)`;

    const bgId = 'bg' + Math.abs(hash);
    let shapes = `<defs><linearGradient id="${bgId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${colorB}" stop-opacity="0.28"/>
    </linearGradient></defs>`;
    shapes += `<rect width="${s}" height="${s}" fill="url(#${bgId})"/>`;

    const shapeCount = 3 + Math.floor(rand() * 2);
    const colors = [colorA, colorB, colorC];
    for (let i = 0; i < shapeCount; i++) {
      const color = colors[i % colors.length];
      const type = rand();
      const angle = rand() * Math.PI * 2;
      const dist = rand() * s * 0.22;
      const ox = cx + Math.cos(angle) * dist;
      const oy = cy + Math.sin(angle) * dist;
      const r = s * (0.18 + rand() * 0.16);
      const opacity = 0.55 + rand() * 0.35;

      if (type < 0.45) {
        shapes += `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
      } else if (type < 0.75) {
        const points = 6;
        let path = '';
        const coords = [];
        for (let p = 0; p < points; p++) {
          const pa = (p / points) * Math.PI * 2;
          const pr = r * (0.75 + rand() * 0.5);
          coords.push([ox + Math.cos(pa) * pr, oy + Math.sin(pa) * pr]);
        }
        path += `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)} `;
        for (let p = 0; p < points; p++) {
          const next = coords[(p + 1) % points];
          const curr = coords[p];
          const mx = (curr[0] + next[0]) / 2, my = (curr[1] + next[1]) / 2;
          path += `Q ${curr[0].toFixed(1)} ${curr[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)} `;
        }
        path += 'Z';
        shapes += `<path d="${path}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
      } else {
        const rot = rand() * 360;
        shapes += `<polygon points="${ox},${(oy - r).toFixed(1)} ${(ox + r * 0.87).toFixed(1)},${(oy + r * 0.5).toFixed(1)} ${(ox - r * 0.87).toFixed(1)},${(oy + r * 0.5).toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${ox.toFixed(1)} ${oy.toFixed(1)})"/>`;
      }
    }

    const svgContent = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
    const buffer = await sharp(Buffer.from(svgContent)).png().toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `Avatar: ${trimmed}` };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar avatar: ${e.message}` };
  }
}

module.exports = {
  generateChartImpl,
  generateHtmlImageImpl,
  generateFunctionPlotImpl,
  expressionHasVariableX,
  generateMathSheetImpl,
  generateMindmapImpl,
  generateQrcodeImpl,
  generateBarcodeImpl,
  generateTableImageImpl,
  generateColorSchemeImpl,
  generateRandomAvatarImpl,
};