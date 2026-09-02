// ═══════════════════════════════════════════════════════════
// GERAÇÃO DE IMAGEM — implementações (sem satori)
// ═══════════════════════════════════════════════════════════

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const math = require('mathjs');
const { DESIGN } = require('../config');
const { callPythonDocumentTool } = require('./documents-bridge');

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

/**
 * Compõe a ficha matemática via canvas nativo: cabeçalho + gráfico (PNG do Chart.js) + rodapé.
 */
async function composeMathSheetWithGraph(expression, chartPngBase64, sampleAtZero) {
  const width = 900, height = 680;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = DESIGN.white;
  ctx.fillRect(0, 0, width, height);

  // Cabeçalho
  ctx.strokeStyle = DESIGN.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 92);
  ctx.lineTo(width - 32, 92);
  ctx.stroke();

  ctx.fillStyle = DESIGN.inkMuted;
  ctx.font = 'bold 12px Sans';
  ctx.fillText('FICHA MATEMÁTICA', 32, 48);

  ctx.fillStyle = DESIGN.ink;
  ctx.font = 'bold 26px Sans';
  ctx.fillText(`f(x) = ${expression}`, 32, 78);

  // Gráfico embutido
  const chartBuffer = Buffer.from(chartPngBase64, 'base64');
  const chartImg = await loadImage(chartBuffer);
  const chartWidth = 820;
  const chartHeight = (chartImg.height / chartImg.width) * chartWidth;
  ctx.drawImage(chartImg, 32, 112, chartWidth, chartHeight);

  // Bloco de exemplo
  if (sampleAtZero !== null && sampleAtZero !== undefined) {
    const boxY = 112 + chartHeight + 20;
    ctx.fillStyle = DESIGN.surface;
    ctx.fillRect(32, boxY, width - 64, 46);
    ctx.fillStyle = DESIGN.inkSoft;
    ctx.font = '13px Sans';
    const rounded = Math.round(sampleAtZero * 1000) / 1000;
    ctx.fillText(`Exemplo — em x = 0:  f(0) = ${rounded}`, 50, boxY + 28);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Compõe o card de resultado simples (sem gráfico) via canvas nativo.
 */
function composeMathResultCard(expression, resultStr) {
  const width = 640, height = 340;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = DESIGN.white;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';

  ctx.fillStyle = DESIGN.inkMuted;
  ctx.font = 'bold 12px Sans';
  ctx.fillText('RESULTADO', width / 2, 130);

  ctx.fillStyle = DESIGN.inkMuted;
  ctx.font = '22px Sans';
  ctx.fillText(expression, width / 2, 168);

  ctx.fillStyle = DESIGN.ink;
  ctx.font = 'bold 56px Sans';
  ctx.fillText(`= ${resultStr}`, width / 2, 232);

  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
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

      const buffer = await composeMathSheetWithGraph(expression, chartResult.content_base64, sampleAtZero);
      return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `f(x) = ${expression}`, has_graph: true };
    }

    let result;
    try { result = math.evaluate(expression); } catch (e) { return { found: false, reason: `Expressão inválida: ${e.message}` }; }
    const resultStr = typeof result === 'number' ? (Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : result.toString();

    const buffer = composeMathResultCard(expression, resultStr);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `${expression} = ${resultStr}`, result: resultStr, has_graph: false };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar ficha matemática: ${e.message}` };
  }
}

/**
 * generate_mindmap — delegado ao Python (reportlab.graphics), que lida melhor
 * com layout hierárquico recursivo do que desenho manual em canvas 2D.
 */
async function generateMindmapImpl(root) {
  try {
    if (!root || !root.label) return { found: false, reason: "root.label é obrigatório." };
    const result = await callPythonDocumentTool('generate_mindmap', { root });
    return { found: true, content_base64: result.png_base64, mime_type: 'image/png', label: `Mapa mental: ${root.label}` };
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

/**
 * generate_table_image — desenhado via canvas nativo (grade simples de linhas/colunas).
 */
async function generateTableImageImpl(title, headers, rows) {
  try {
    if (!headers || headers.length === 0) return { found: false, reason: "headers vazio." };

    const colWidth = Math.min(280, Math.max(140, 1000 / headers.length));
    const width = Math.min(1200, Math.max(560, headers.length * colWidth));
    const titleHeight = title ? 50 : 0;
    const headerRowHeight = 44;
    const rowHeight = 42;
    const dataRows = rows || [];
    const height = titleHeight + headerRowHeight + dataRows.length * rowHeight;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fundo
    ctx.fillStyle = DESIGN.white;
    ctx.fillRect(0, 0, width, height);

    let y = 0;

    // Título
    if (title) {
      ctx.fillStyle = DESIGN.surfaceAlt;
      ctx.fillRect(0, y, width, titleHeight);
      ctx.fillStyle = DESIGN.ink;
      ctx.font = 'bold 16px Sans';
      ctx.fillText(title, 18, y + 32);
      y += titleHeight;
    }

    // Cabeçalho
    ctx.fillStyle = DESIGN.ink;
    ctx.fillRect(0, y, width, headerRowHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 13px Sans';
    headers.forEach((h, i) => {
      ctx.fillText(String(h), 14 + i * colWidth, y + 27);
    });
    y += headerRowHeight;

    // Linhas de dados
    ctx.font = '12.5px Sans';
    dataRows.forEach((row, rIdx) => {
      ctx.fillStyle = rIdx % 2 === 0 ? DESIGN.surface : DESIGN.white;
      ctx.fillRect(0, y, width, rowHeight);
      ctx.fillStyle = DESIGN.inkSoft;
      row.forEach((cell, cIdx) => {
        ctx.fillText(String(cell), 14 + cIdx * colWidth, y + 26);
      });
      y += rowHeight;
    });

    // Borda externa
    ctx.strokeStyle = DESIGN.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    const buffer = canvas.toBuffer('image/png');
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: title || 'Tabela' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar tabela: ${e.message}` };
  }
}

module.exports = {
  generateChartImpl,
  generateFunctionPlotImpl,
  expressionHasVariableX,
  generateMathSheetImpl,
  generateMindmapImpl,
  generateQrcodeImpl,
  generateBarcodeImpl,
  generateTableImageImpl,
};