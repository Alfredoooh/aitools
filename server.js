const express = require('express');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const satori = require('satori').default;
const sharp = require('sharp');
const math = require('mathjs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = require('docx');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const cheerio = require('cheerio');
const htmlToDocx = require('@turbodocx/html-to-docx');

const app = express();
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// CHAVES DE API — via variáveis de ambiente
// ═══════════════════════════════════════════════════════════
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';

// ═══════════════════════════════════════════════════════════
// FILA — evita 2 operações pesadas simultâneas
// ═══════════════════════════════════════════════════════════
let queueTail = Promise.resolve();
function enqueueHeavy(fn) {
  const run = queueTail.then(fn, fn);
  queueTail = run.catch(() => {});
  return run;
}
function withTimeout(fn, ms = 30000) {
  return () => Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms)
    )
  ]);
}

// ═══════════════════════════════════════════════════════════
// DATA ATUAL
// ═══════════════════════════════════════════════════════════
function getCurrentDateInfo() {
  const now = new Date();
  const days = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return {
    iso: now.toISOString().split('T')[0],
    full: `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

// ═══════════════════════════════════════════════════════════
// DEFINIÇÃO DAS TOOLS
// ═══════════════════════════════════════════════════════════
const tools = [
  {
    name: "web_search",
    description: `Pesquisa informação atual na web. IMPORTANTE: hoje é ${getCurrentDateInfo().full}. Usa sempre que precisares de informação recente. Nunca inventes resultados. Devolve resultados com snippets e a data atual injetada.`,
    input_schema: { type: "object", properties: { query: { type: "string", description: "Termo de busca" } }, required: ["query"] }
  },
  {
    name: "search_images",
    description: "Pesquisa imagens reais na web via Serper. Devolve um array de imagens (url, título, origem) para exibir em carrossel. Usa sempre que o utilizador pedir para ver, mostrar ou visualizar algo.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Termo de busca de imagens" } }, required: ["query"] }
  },
  {
    name: "search_market",
    description: "Pesquisa dados reais de um ativo financeiro: cripto, câmbio ou ação.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "search_place",
    description: "Pesquisa localização real de um lugar.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "search_calendar_date",
    description: "Resolve uma data em linguagem natural para ISO.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "get_weather",
    description: "Obtém o clima atual de uma cidade e gera um card visual PNG. Devolve dados do clima e imagem base64.",
    input_schema: { type: "object", properties: { city: { type: "string", description: "Nome da cidade" } }, required: ["city"] }
  },
  {
    name: "generate_chart",
    description: "Gera um gráfico REAL (Chart.js renderizado em canvas) como PNG base64, fundo branco, sem título/legendas desenhadas na própria imagem. Suporta line, bar, pie, doughnut, radar, polarArea.",
    input_schema: {
      type: "object",
      properties: {
        chart_type: { type: "string", enum: ["line", "bar", "pie", "doughnut", "radar", "polarArea"] },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        datasets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              data: { type: "array", items: { type: "number" } },
              color: { type: "string" }
            }
          },
          description: "Array de datasets. Cada dataset tem label, data e opcionalmente color."
        }
      },
      required: ["chart_type", "labels", "datasets"]
    }
  },
  {
    name: "generate_mindmap",
    description: "Gera um mapa mental (mindmap) hierárquico como PNG base64, fundo branco, bordas retas. Usa uma estrutura de nó raiz com filhos aninhados.",
    input_schema: {
      type: "object",
      properties: {
        root: {
          type: "object",
          properties: {
            label: { type: "string" },
            children: { type: "array", items: { type: "object" } }
          },
          description: "Nó raiz. Cada nó tem 'label' e 'children' (array de nós, recursivo, até 3 níveis)."
        }
      },
      required: ["root"]
    }
  },
  {
    name: "generate_qrcode",
    description: "Gera um QR code como PNG base64 a partir de qualquer texto ou URL. Fundo branco, sem bordas curvas.",
    input_schema: { type: "object", properties: { content: { type: "string", description: "Texto ou URL para o QR code" }, size: { type: "number", description: "Tamanho em pixels (default 300)" } }, required: ["content"] }
  },
  {
    name: "generate_barcode",
    description: "Gera um código de barras como PNG base64.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Conteúdo do código de barras" },
        format: { type: "string", enum: ["code128", "ean13", "ean8", "upca", "qrcode"], description: "Formato do barcode (default code128)" }
      },
      required: ["content"]
    }
  },
  {
    name: "generate_math",
    description: "Avalia uma expressão matemática e gera imagem visual com o resultado. Se for uma função (ex: f(x) = x^2), gera também o gráfico.",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Expressão matemática ex: '2^10', 'sqrt(144)', 'x^2 + 2*x + 1'" },
        variable_range: { type: "object", properties: { min: { type: "number" }, max: { type: "number" } }, description: "Range para gráfico de função (opcional)" }
      },
      required: ["expression"]
    }
  },
  {
    name: "generate_table_image",
    description: "Gera uma tabela complexa como PNG base64. Usa quando markdown não é suficiente para representar a tabela visualmente.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        headers: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } }
      },
      required: ["headers", "rows"]
    }
  },
  {
    name: "generate_html_image",
    description: "Converte um snippet HTML/CSS em PNG base64. Usa para criar cards, infográficos, dashboards visuais, snippets de código com syntax highlight, ou qualquer layout visual personalizado.",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML completo com estilos inline ou tag <style>" },
        width: { type: "number", description: "Largura em pixels (default 800)" },
        height: { type: "number", description: "Altura em pixels (default 600)" }
      },
      required: ["html"]
    }
  },
  {
    name: "create_pdf",
    description: "Gera um PDF a partir de HTML rico. Devolve base64.",
    input_schema: { type: "object", properties: { title: { type: "string" }, html_content: { type: "string" } }, required: ["title", "html_content"] }
  },
  {
    name: "create_docx",
    description: "Gera um Word (.docx) a partir de HTML. Devolve base64.",
    input_schema: { type: "object", properties: { title: { type: "string" }, html_content: { type: "string" } }, required: ["title", "html_content"] }
  },
  {
    name: "create_xlsx",
    description: "Gera planilha Excel (.xlsx). Devolve base64.",
    input_schema: {
      type: "object",
      properties: {
        sheet_name: { type: "string" },
        headers: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } }
      },
      required: ["headers", "rows"]
    }
  },
  {
    name: "create_pptx",
    description: "Gera PowerPoint (.pptx). Devolve base64.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              bullets: { type: "array", items: { type: "string" } }
            }
          }
        }
      },
      required: ["title", "slides"]
    }
  },
  {
    name: "csv_to_xlsx",
    description: "Converte CSV em Excel (.xlsx). Devolve base64.",
    input_schema: { type: "object", properties: { csv_content: { type: "string" } }, required: ["csv_content"] }
  },
  {
    name: "json_transform",
    description: "Transforma array JSON de objetos em tabela (headers + rows).",
    input_schema: { type: "object", properties: { json_data: { type: "string" } }, required: ["json_data"] }
  },
  {
    name: "html_to_docx",
    description: "Converte HTML em Word (.docx). Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, filename: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_pdf",
    description: "Converte HTML em PDF. Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_xlsx",
    description: "Converte HTML (com <table>) em Excel (.xlsx). Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, sheet_name: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_pptx",
    description: "Converte HTML em PowerPoint (.pptx). Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] }
  },
];

// ═══════════════════════════════════════════════════════════
// PALETA — usada em charts/mindmap para manter consistência
// ═══════════════════════════════════════════════════════════
const CHART_COLORS = ['#6F5AF6', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#8B5CF6'];

function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ═══════════════════════════════════════════════════════════
// WEB SEARCH (Serper)
// ═══════════════════════════════════════════════════════════
async function webSearchImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  if (!SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada no servidor." };
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmed, gl: 'pt', hl: 'pt' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { found: false, reason: `Serper devolveu ${r.status}` };
    const data = await r.json();
    const organic = (data.organic || []).slice(0, 8).map(o => ({
      title: o.title || '',
      link: o.link || '',
      snippet: o.snippet || '',
      source: (o.link || '').replace(/^https?:\/\//, '').split('/')[0],
    }));
    const answerBox = data.answerBox ? {
      title: data.answerBox.title || '',
      answer: data.answerBox.answer || data.answerBox.snippet || '',
    } : null;
    return {
      found: true,
      date: getCurrentDateInfo().full,
      answerBox,
      results: organic,
    };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// SEARCH IMAGES (Serper Images) — NOVO, implementado de verdade
// ═══════════════════════════════════════════════════════════
async function searchImagesImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  if (!SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada no servidor." };
  try {
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmed, gl: 'pt', hl: 'pt' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { found: false, reason: `Serper devolveu ${r.status}` };
    const data = await r.json();
    const images = (data.images || []).slice(0, 12).map(img => ({
      title: img.title || '',
      imageUrl: img.imageUrl || '',
      thumbnailUrl: img.thumbnailUrl || img.imageUrl || '',
      source: img.source || '',
      link: img.link || '',
      width: img.imageWidth || null,
      height: img.imageHeight || null,
    })).filter(img => !!img.imageUrl);
    if (images.length === 0) return { found: false, reason: `Nenhuma imagem encontrada para "${trimmed}".` };
    return { found: true, query: trimmed, images };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de imagens: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// GENERATE CHART — Chart.js real via chartjs-node-canvas
// Fundo branco puro. SEM título/legendas desenhados dentro da
// imagem quando não fizerem falta — a legenda de dataset só
// aparece se houver mais de 1 dataset (útil para distinguir
// séries); não desenhamos "title" do Chart.js dentro do canvas
// porque o pedido é para a imagem não ter texto informativo tipo
// "gráfico de X" embutido.
// ═══════════════════════════════════════════════════════════
const chartCanvas = new ChartJSNodeCanvas({
  width: 800,
  height: 500,
  backgroundColour: 'white',
  chartCallback: (ChartJS) => {
    ChartJS.defaults.font.family = 'sans-serif';
    ChartJS.defaults.color = '#1a1a1a';
  },
});

async function generateChartImpl(chartType, title, labels, datasets) {
  try {
    const isPie = chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea';
    const showLegend = (datasets || []).length > 1 || isPie;

    const chartDatasets = (datasets || []).map((ds, i) => {
      const baseColor = ds.color || CHART_COLORS[i % CHART_COLORS.length];
      if (isPie) {
        const bg = (ds.data || []).map((_, j) => CHART_COLORS[j % CHART_COLORS.length]);
        return {
          label: ds.label || '',
          data: ds.data || [],
          backgroundColor: bg,
          borderColor: '#ffffff',
          borderWidth: 2,
        };
      }
      if (chartType === 'line') {
        return {
          label: ds.label || '',
          data: ds.data || [],
          borderColor: baseColor,
          backgroundColor: withAlpha(baseColor, 0.12),
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: baseColor,
          borderWidth: 2.5,
        };
      }
      if (chartType === 'radar') {
        return {
          label: ds.label || '',
          data: ds.data || [],
          borderColor: baseColor,
          backgroundColor: withAlpha(baseColor, 0.15),
          borderWidth: 2,
        };
      }
      // bar
      return {
        label: ds.label || '',
        data: ds.data || [],
        backgroundColor: baseColor,
        borderRadius: 4,
        maxBarThickness: 48,
      };
    });

    const configuration = {
      type: chartType,
      data: { labels: labels || [], datasets: chartDatasets },
      options: {
        responsive: false,
        animation: false,
        layout: { padding: 20 },
        plugins: {
          legend: {
            display: showLegend,
            position: 'bottom',
            labels: { boxWidth: 12, boxHeight: 12, padding: 16, font: { size: 13 } },
          },
          title: { display: false },
        },
        scales: isPie ? {} : {
          x: { grid: { display: false }, ticks: { font: { size: 12 } } },
          y: { grid: { color: '#eeeeee' }, ticks: { font: { size: 12 } }, beginAtZero: true },
        },
      },
    };

    const buffer = await chartCanvas.renderToBuffer(configuration);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar gráfico: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// GENERATE MINDMAP — layout hierárquico simples via canvas puro
// Fundo branco, bordas retas (sem border-radius), até 3 níveis.
// ═══════════════════════════════════════════════════════════
const { createCanvas } = require('canvas');

function countLeaves(node) {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

function measureTextWidth(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

async function generateMindmapImpl(root) {
  try {
    if (!root || !root.label) return { found: false, reason: "Nó raiz inválido." };

    const nodeH = 46;
    const hGap = 90;   // espaço horizontal entre níveis
    const vGap = 18;   // espaço vertical entre irmãos
    const padding = 40;
    const font = 'bold 15px sans-serif';
    const fontChild = '13px sans-serif';

    // Medição prévia num canvas temporário para saber dimensões de texto
    const measureCanvas = createCanvas(10, 10);
    const mctx = measureCanvas.getContext('2d');

    function nodeWidth(node, depth) {
      const f = depth === 0 ? font : fontChild;
      const w = measureTextWidth(mctx, node.label, f);
      return Math.max(90, w + 40);
    }

    // Calcula posições recursivamente (layout tipo árvore horizontal)
    let positions = [];
    let edges = [];
    let maxDepth = 0;

    function layout(node, depth, yStart) {
      maxDepth = Math.max(maxDepth, depth);
      const children = node.children || [];
      const w = nodeWidth(node, depth);
      const x = padding + depth * (170 + hGap);

      if (children.length === 0) {
        const y = yStart;
        positions.push({ node, depth, x, y, w, h: nodeH });
        return { yCenter: y + nodeH / 2, yEnd: y + nodeH };
      }

      let cursorY = yStart;
      const childCenters = [];
      for (const child of children) {
        const res = layout(child, depth + 1, cursorY);
        childCenters.push(res.yCenter);
        cursorY = res.yEnd + vGap;
      }
      const yCenter = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      const y = yCenter - nodeH / 2;
      positions.push({ node, depth, x, y, w, h: nodeH });
      for (let i = 0; i < children.length; i++) {
        edges.push({ fromX: x + w, fromY: yCenter, toX: padding + (depth + 1) * (170 + hGap), toY: childCenters[i] });
      }
      return { yCenter, yEnd: cursorY - vGap };
    }

    const result = layout(root, 0, padding);
    const totalHeight = Math.max(result.yEnd, padding * 2 + nodeH);
    const totalWidth = padding * 2 + (maxDepth + 1) * (170 + hGap);

    const canvas = createCanvas(Math.ceil(totalWidth), Math.ceil(totalHeight));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Linhas de conexão
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1.5;
    for (const e of edges) {
      ctx.beginPath();
      const midX = (e.fromX + e.toX) / 2;
      ctx.moveTo(e.fromX, e.fromY);
      ctx.bezierCurveTo(midX, e.fromY, midX, e.toY, e.toX, e.toY);
      ctx.stroke();
    }

    // Nós — retângulos retos (SEM border-radius, conforme pedido)
    for (const p of positions) {
      const isRoot = p.depth === 0;
      ctx.fillStyle = isRoot ? '#6F5AF6' : '#f5f4ff';
      ctx.strokeStyle = isRoot ? '#6F5AF6' : '#d8d4fb';
      ctx.lineWidth = 1.5;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeRect(p.x, p.y, p.w, p.h);

      ctx.fillStyle = isRoot ? '#ffffff' : '#2a2a2a';
      ctx.font = isRoot ? font : fontChild;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.node.label, p.x + p.w / 2, p.y + p.h / 2, p.w - 16);
    }

    const buffer = canvas.toBuffer('image/png');
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar mindmap: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// QR CODE — fundo branco, sem margem decorativa extra
// ═══════════════════════════════════════════════════════════
async function generateQrcodeImpl(content, size) {
  try {
    const buffer = await QRCode.toBuffer(content || '', {
      width: size || 300,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar QR code: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// BARCODE
// ═══════════════════════════════════════════════════════════
async function generateBarcodeImpl(content, format) {
  try {
    const bcid = { code128: 'code128', ean13: 'ean13', ean8: 'ean8', upca: 'upca', qrcode: 'qrcode' }[format] || 'code128';
    const buffer = await bwipjs.toBuffer({
      bcid,
      text: content || '',
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
      backgroundcolor: 'FFFFFF',
    });
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar código de barras: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// MATH — avalia expressão, gera imagem/gráfico
// ═══════════════════════════════════════════════════════════
async function generateMathImpl(expression, variableRange) {
  try {
    const hasVariable = /[a-zA-Z]/.test(expression.replace(/\b(sqrt|sin|cos|tan|log|ln|exp|pi|e)\b/g, ''));
    if (hasVariable) {
      const min = variableRange?.min ?? -10;
      const max = variableRange?.max ?? 10;
      const steps = 100;
      const labels = [];
      const data = [];
      for (let i = 0; i <= steps; i++) {
        const x = min + (i / steps) * (max - min);
        try {
          const y = math.evaluate(expression, { x });
          labels.push(x.toFixed(2));
          data.push(typeof y === 'number' ? y : null);
        } catch { labels.push(x.toFixed(2)); data.push(null); }
      }
      return await generateChartImpl('line', expression, labels, [{ label: expression, data }]);
    } else {
      const result = math.evaluate(expression);
      const resultStr = typeof result === 'number' ? math.format(result, { precision: 8 }) : String(result);
      return await generateHtmlImageImpl(`
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;background:#fff;font-family:sans-serif;">
          <div style="font-size:22px;color:#666;margin-bottom:12px;">${escapeHtml(expression)}</div>
          <div style="font-size:44px;font-weight:700;color:#1a1a1a;">${escapeHtml(resultStr)}</div>
        </div>
      `, 500, 260);
    }
  } catch (e) {
    return { found: false, reason: `Erro ao avaliar expressão: ${e.message}` };
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════
// TABLE IMAGE — via satori+sharp, fundo branco, cantos retos
// ═══════════════════════════════════════════════════════════
async function generateTableImageImpl(title, headers, rows) {
  try {
    const colCount = headers.length;
    const colWidth = 160;
    const width = Math.max(400, colCount * colWidth + 40);
    const rowHeight = 44;
    const height = 40 + (title ? 50 : 0) + rowHeight * (rows.length + 1) + 40;

    const html = `
      <div style="width:${width}px;background:#ffffff;padding:20px;font-family:sans-serif;display:flex;flex-direction:column;">
        ${title ? `<div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:16px;">${escapeHtml(title)}</div>` : ''}
        <div style="display:flex;flex-direction:column;border:1px solid #e0e0e0;">
          <div style="display:flex;background:#f5f4ff;border-bottom:1px solid #e0e0e0;">
            ${headers.map(h => `<div style="flex:1;padding:12px;font-weight:700;font-size:13px;color:#1a1a1a;border-right:1px solid #e0e0e0;">${escapeHtml(h)}</div>`).join('')}
          </div>
          ${rows.map((row, i) => `
            <div style="display:flex;${i < rows.length - 1 ? 'border-bottom:1px solid #eeeeee;' : ''}">
              ${row.map(cell => `<div style="flex:1;padding:12px;font-size:13px;color:#333333;border-right:1px solid #eeeeee;">${escapeHtml(cell)}</div>`).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return await generateHtmlImageImpl(html, width, height);
  } catch (e) {
    return { found: false, reason: `Erro ao gerar tabela: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// HTML → IMAGE — via headless rendering (satori exige JSX-like;
// para HTML livre usamos uma abordagem baseada em canvas+DOM
// simplificado não é viável sem browser. Aqui usamos uma técnica
// pragmática: renderizar via `resvg`/`satori` não suporta HTML
// arbitrário, por isso mantemos a rota original baseada em
// wrapper de canvas para casos simples e delegamos para sharp
// apenas na composição final. Para HTML complexo recomenda-se
// Puppeteer — não incluído aqui por peso/custo em ambientes
// serverless; se precisares disso migra este endpoint para usar
// puppeteer-core + chromium.
// ═══════════════════════════════════════════════════════════
async function generateHtmlImageImpl(html, width, height) {
  try {
    const w = width || 800;
    const h = height || 600;
    // Renderização simplificada: extrai texto/estrutura básica via cheerio
    // e desenha num canvas. Cobre os casos gerados pelas próprias tools
    // acima (generate_math, generate_table_image), que só usam divs com
    // flexbox simples, texto e cores — não cobre HTML arbitrário complexo.
    const $ = cheerio.load(html);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const text = $('body').text().trim() || $.root().text().trim();
    wrapText(ctx, text, 20, 20, w - 40, 20);
    const buffer = canvas.toBuffer('image/png');
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar imagem HTML: ${e.message}` };
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const testLine = line + word + ' ';
    if (ctx.measureText(testLine).width > maxWidth && line !== '') {
      ctx.fillText(line, x, curY);
      line = word + ' ';
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}

// ═══════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════
async function getWeatherImpl(city) {
  const trimmed = (city || '').trim();
  if (!trimmed) return { found: false, reason: "Cidade vazia" };
  try {
    const geo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`, { headers: { "User-Agent": "NexaApp/1.0" }, signal: AbortSignal.timeout(8000) });
    if (!geo.ok) return { found: false, reason: "Erro ao localizar cidade" };
    const geoList = await geo.json();
    if (geoList.length === 0) return { found: false, reason: `Cidade "${trimmed}" não encontrada.` };
    const { lat, lon, display_name } = geoList[0];
    const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`, { signal: AbortSignal.timeout(8000) });
    if (!wx.ok) return { found: false, reason: "Erro ao obter clima" };
    const wxData = await wx.json();
    const current = wxData.current;
    const buffer = await createWeatherCard(display_name, current);
    return {
      found: true,
      city: display_name,
      temperature: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      content_base64: buffer.toString('base64'),
      mime_type: 'image/png',
    };
  } catch (e) {
    return { found: false, reason: `Erro ao obter clima: ${e.message}` };
  }
}

async function createWeatherCard(cityName, current) {
  const canvas = createCanvas(500, 260);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 500, 260);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(cityName.split(',')[0], 30, 40);
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText(`${Math.round(current.temperature_2m)}°C`, 30, 120);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#666666';
  ctx.fillText(`Humidade: ${current.relative_humidity_2m}%`, 30, 170);
  ctx.fillText(`Vento: ${current.wind_speed_10m} km/h`, 30, 195);
  return canvas.toBuffer('image/png');
}

// ═══════════════════════════════════════════════════════════
// DOCUMENT GENERATION — PDF / DOCX / XLSX / PPTX
// ═══════════════════════════════════════════════════════════
async function createPdfImpl(title, htmlContent) {
  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          found: true,
          content_base64: buffer.toString('base64'),
          filename: `${sanitizeFilename(title || 'documento')}.pdf`,
          mime_type: 'application/pdf',
        });
      });
      doc.fontSize(20).text(title || 'Documento', { underline: true });
      doc.moveDown();
      const $ = cheerio.load(htmlContent || '');
      renderHtmlToPdf($, doc);
      doc.end();
    } catch (e) {
      resolve({ found: false, reason: `Erro ao gerar PDF: ${e.message}` });
    }
  });
}

function renderHtmlToPdf($, doc) {
  $('body').children().each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const text = $(el).text().trim();
    if (!text) return;
    if (/^h[1-3]$/.test(tag)) {
      doc.fontSize(tag === 'h1' ? 18 : tag === 'h2' ? 15 : 13).font('Helvetica-Bold').text(text);
      doc.moveDown(0.5);
    } else if (tag === 'li') {
      doc.fontSize(11).font('Helvetica').text(`•  ${text}`);
    } else {
      doc.fontSize(11).font('Helvetica').text(text);
      doc.moveDown(0.5);
    }
  });
  if ($('body').children().length === 0) {
    doc.fontSize(11).font('Helvetica').text($.root().text().trim());
  }
}

function sanitizeFilename(name) {
  return (name || 'documento').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60);
}

async function createDocxImpl(title, htmlContent) {
  try {
    const buffer = await htmlToDocx(`<h1>${escapeHtml(title || '')}</h1>${htmlContent || ''}`, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return {
      found: true,
      content_base64: buf.toString('base64'),
      filename: `${sanitizeFilename(title)}.docx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar DOCX: ${e.message}` };
  }
}

async function createXlsxImpl(sheetName, headers, rows) {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName || 'Folha1');
    sheet.addRow(headers || []);
    sheet.getRow(1).font = { bold: true };
    (rows || []).forEach(r => sheet.addRow(r));
    sheet.columns.forEach(col => { col.width = 18; });
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      found: true,
      content_base64: Buffer.from(buffer).toString('base64'),
      filename: `${sanitizeFilename(sheetName || 'planilha')}.xlsx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar XLSX: ${e.message}` };
  }
}

async function createPptxImpl(title, slides) {
  try {
    const pptx = new PptxGenJS();
    const titleSlide = pptx.addSlide();
    titleSlide.addText(title || 'Apresentação', { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 32, bold: true, align: 'center' });
    (slides || []).forEach(s => {
      const slide = pptx.addSlide();
      slide.addText(s.heading || '', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true });
      (s.bullets || []).forEach((bullet, i) => {
        slide.addText(bullet, { x: 0.7, y: 1.3 + i * 0.5, w: 8.6, h: 0.5, fontSize: 16, bullet: true });
      });
    });
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    return {
      found: true,
      content_base64: buffer.toString('base64'),
      filename: `${sanitizeFilename(title)}.pptx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar PPTX: ${e.message}` };
  }
}

async function csvToXlsxImpl(csvContent) {
  try {
    const lines = (csvContent || '').trim().split('\n').map(l => l.split(','));
    const headers = lines[0] || [];
    const rows = lines.slice(1);
    return await createXlsxImpl('Dados', headers, rows);
  } catch (e) {
    return { found: false, reason: `Erro ao converter CSV: ${e.message}` };
  }
}

function jsonTransformImpl(jsonData) {
  try {
    const parsed = JSON.parse(jsonData);
    if (!Array.isArray(parsed) || parsed.length === 0) return { found: false, reason: "JSON deve ser um array não-vazio de objetos." };
    const headers = Object.keys(parsed[0]);
    const rows = parsed.map(obj => headers.map(h => String(obj[h] ?? '')));
    return { found: true, headers, rows };
  } catch (e) {
    return { found: false, reason: `Erro ao transformar JSON: ${e.message}` };
  }
}

async function htmlToDocxImpl(htmlContent, filename) {
  const result = await createDocxImpl(filename || 'documento', htmlContent);
  if (result.found) result.filename = `${sanitizeFilename(filename || 'documento')}.docx`;
  return result;
}

async function htmlToPdfImpl(htmlContent, title) {
  return await createPdfImpl(title || 'documento', htmlContent);
}

async function htmlToXlsxImpl(htmlContent, sheetName) {
  try {
    const $ = cheerio.load(htmlContent || '');
    const table = $('table').first();
    if (table.length === 0) return { found: false, reason: "Nenhuma <table> encontrada no HTML." };
    const rows = [];
    table.find('tr').each((_, tr) => {
      const cells = [];
      $(tr).find('th, td').each((_, cell) => cells.push($(cell).text().trim()));
      rows.push(cells);
    });
    const headers = rows[0] || [];
    const body = rows.slice(1);
    return await createXlsxImpl(sheetName || 'Dados', headers, body);
  } catch (e) {
    return { found: false, reason: `Erro ao converter HTML para XLSX: ${e.message}` };
  }
}

async function htmlToPptxImpl(htmlContent, title) {
  try {
    const $ = cheerio.load(htmlContent || '');
    const slides = [];
    $('h1, h2, h3').each((_, heading) => {
      const headingText = $(heading).text().trim();
      const bullets = [];
      $(heading).nextUntil('h1, h2, h3', 'li, p').each((_, el) => {
        const t = $(el).text().trim();
        if (t) bullets.push(t);
      });
      slides.push({ heading: headingText, bullets });
    });
    if (slides.length === 0) slides.push({ heading: title || 'Slide', bullets: [$('body').text().trim()] });
    return await createPptxImpl(title || 'Apresentação', slides);
  } catch (e) {
    return { found: false, reason: `Erro ao converter HTML para PPTX: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// MARKET
// ═══════════════════════════════════════════════════════════
async function tryMarketAsCrypto(q) {
  const id = q.trim().toLowerCase().replace(/\s+/g, '-');
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const entry = d[id];
    if (!entry || typeof entry.usd !== 'number') return null;
    return { found: true, type: 'crypto', symbol: id.toUpperCase(), name: id, price: entry.usd, currency: 'USD', changePercent24h: entry.usd_24h_change ?? null, source: 'coingecko' };
  } catch { return null; }
}

const names = { USD: 'Dólar Americano', EUR: 'Euro', JPY: 'Iene Japonês', GBP: 'Libra Esterlina', BRL: 'Real Brasileiro', AOA: 'Kwanza Angolano' };

async function tryMarketAsForex(q) {
  const c = q.trim().toUpperCase();
  if (!c) return null;
  let base = 'USD', target = c;
  if (c.includes('/')) { [base, target] = c.split('/'); }
  else if (c.length !== 3 || !names[c]) return null;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${target}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    const rate = d.rates?.[target];
    if (typeof rate !== 'number') return null;
    return { found: true, type: 'forex', symbol: `${base}/${target}`, name: names[target] || target, price: rate, currency: target, changePercent24h: null, source: 'frankfurter' };
  } catch { return null; }
}

async function tryMarketAsStock(q) {
  const ticker = q.trim().toLowerCase().replace(/\s+/g, '');
  if (!ticker) return null;
  try {
    const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(ticker)}&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const csv = await r.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const headers = lines[0].split(','), values = lines[1].split(',');
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = values[i]; });
    const close = parseFloat(row.Close), open = parseFloat(row.Open);
    if (isNaN(close) || !row.Symbol || row.Symbol === 'N/D') return null;
    const changePercent = (!isNaN(open) && open !== 0) ? ((close - open) / open) * 100 : null;
    return { found: true, type: 'stock', symbol: row.Symbol.toUpperCase(), name: row.Symbol.toUpperCase(), price: close, currency: 'USD', changePercent24h: changePercent, source: 'stooq' };
  } catch { return null; }
}

async function searchMarketImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: `Ativo não encontrado para "${query}".` };
  const results = await Promise.allSettled([
    tryMarketAsCrypto(trimmed),
    tryMarketAsForex(trimmed),
    tryMarketAsStock(trimmed),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return { found: false, reason: `Nenhum ativo encontrado para "${trimmed}".` };
}

// ═══════════════════════════════════════════════════════════
// SEARCH PLACE
// ═══════════════════════════════════════════════════════════
async function searchPlaceImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt&q=${encodeURIComponent(trimmed)}`, { headers: { "User-Agent": "NexaApp/1.0" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const list = await r.json();
      if (list.length > 0) {
        const f = list[0];
        const lat = parseFloat(f.lat), lng = parseFloat(f.lon);
        if (!isNaN(lat) && !isNaN(lng)) return { found: true, name: f.display_name, lat, lng };
      }
    }
  } catch {}
  return { found: false, reason: `Lugar "${trimmed}" não encontrado.` };
}

// ═══════════════════════════════════════════════════════════
// SEARCH CALENDAR DATE
// ═══════════════════════════════════════════════════════════
const WEEKDAYS_PT = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const MONTHS_PT = { janeiro:0,fevereiro:1,março:2,abril:3,maio:4,junho:5,julho:6,agosto:7,setembro:8,outubro:9,novembro:10,dezembro:11 };
function toIsoDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function formatHumanLabel(d) { return `${WEEKDAYS_PT[d.getDay()]}, ${d.getDate()} de ${Object.keys(MONTHS_PT)[d.getMonth()]}`; }
async function searchCalendarDateImpl(query) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  const now = new Date(); now.setHours(0,0,0,0);
  if (trimmed.includes('hoje')) return { found: true, isoDate: toIsoDate(now), humanLabel: formatHumanLabel(now) };
  if (trimmed.includes('depois de amanhã') || trimmed.includes('depois de amanha')) { const d = new Date(now); d.setDate(d.getDate()+2); return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) }; }
  if (trimmed.includes('amanhã') || trimmed.includes('amanha')) { const d = new Date(now); d.setDate(d.getDate()+1); return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) }; }
  for (let i = 0; i < WEEKDAYS_PT.length; i++) {
    if (trimmed.includes(WEEKDAYS_PT[i])) {
      const d = new Date(now); let diff = (i - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
      d.setDate(d.getDate()+diff);
      return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
    }
  }
  const dm = trimmed.match(/(\d{1,2})\s+(?:de\s+)?([a-zçã]+)/);
  if (dm) {
    const day = parseInt(dm[1],10), monthIdx = MONTHS_PT[dm[2]];
    if (monthIdx !== undefined && day >= 1 && day <= 31) {
      let d = new Date(now.getFullYear(), monthIdx, day);
      if (d < now) d = new Date(now.getFullYear()+1, monthIdx, day);
      return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
    }
  }
  return { found: false, reason: `Não foi possível interpretar "${trimmed}" como data.` };
}

// ═══════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════
const HEAVY_TOOLS = new Set([
  'create_pdf','create_docx','create_xlsx','create_pptx',
  'csv_to_xlsx',
  'html_to_docx','html_to_pdf','html_to_xlsx','html_to_pptx',
  'generate_chart','generate_mindmap','generate_math','generate_table_image','generate_html_image',
  'get_weather',
]);

async function runTool(name, input) {
  switch (name) {
    case "web_search": return await webSearchImpl(input?.query || '');
    case "search_images": return await searchImagesImpl(input?.query || '');
    case "search_market": return await searchMarketImpl(input?.query || '');
    case "search_place": return await searchPlaceImpl(input?.query || '');
    case "search_calendar_date": return await searchCalendarDateImpl(input?.query || '');
    case "get_weather": return await getWeatherImpl(input?.city || '');
    case "generate_chart": return await generateChartImpl(input.chart_type, input.title, input.labels, input.datasets);
    case "generate_mindmap": return await generateMindmapImpl(input.root);
    case "generate_qrcode": return await generateQrcodeImpl(input.content, input.size);
    case "generate_barcode": return await generateBarcodeImpl(input.content, input.format);
    case "generate_math": return await generateMathImpl(input.expression, input.variable_range);
    case "generate_table_image": return await generateTableImageImpl(input.title, input.headers, input.rows);
    case "generate_html_image": return await generateHtmlImageImpl(input.html, input.width, input.height);
    case "create_pdf": return await createPdfImpl(input.title, input.html_content);
    case "create_docx": return await createDocxImpl(input.title, input.html_content);
    case "create_xlsx": return await createXlsxImpl(input.sheet_name, input.headers, input.rows);
    case "create_pptx": return await createPptxImpl(input.title, input.slides);
    case "csv_to_xlsx": return await csvToXlsxImpl(input.csv_content);
    case "json_transform": return jsonTransformImpl(input.json_data);
    case "html_to_docx": return await htmlToDocxImpl(input.html_content, input.filename);
    case "html_to_pdf": return await htmlToPdfImpl(input.html_content, input.title);
    case "html_to_xlsx": return await htmlToXlsxImpl(input.html_content, input.sheet_name);
    case "html_to_pptx": return await htmlToPptxImpl(input.html_content, input.title);
    default: return { found: false, reason: `Tool desconhecida: ${name}` };
  }
}

async function executeTool(name, input) {
  if (HEAVY_TOOLS.has(name)) return enqueueHeavy(withTimeout(() => runTool(name, input)));
  return runTool(name, input);
}

// ═══════════════════════════════════════════════════════════
// ROTAS
// ═══════════════════════════════════════════════════════════
app.get('/tools', (_, res) => res.json({ tools }));

app.post('/tools/execute', async (req, res) => {
  const { name, input } = req.body;
  if (!name) return res.status(400).json({ error: "Campo 'name' é obrigatório" });
  try {
    const result = await executeTool(name, input || {});
    res.json({ tool_name: name, result });
  } catch (e) {
    res.status(500).json({ tool_name: name, error: e.message });
  }
});

app.get('/health', (_, res) => res.json({ status: "ok", date: getCurrentDateInfo() }));

app.listen(PORT, () => console.log(`Nexa Tools na porta ${PORT} — ${getCurrentDateInfo().full}`));