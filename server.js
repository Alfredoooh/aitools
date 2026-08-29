const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// FILA SIMPLES — serializa tools pesadas de documento para
// nunca ter 2 conversões rodando ao mesmo tempo no mesmo processo.
// Isso evita estourar os 500MB do Render free sob carga concorrente.
// ═══════════════════════════════════════════════════════════
let queueTail = Promise.resolve();
function enqueueHeavy(fn) {
  const run = queueTail.then(fn, fn);
  queueTail = run.catch(() => {});
  return run;
}

// ═══════════════════════════════════════════════════════════
// DEFINIÇÃO DAS TOOLS
// ═══════════════════════════════════════════════════════════
const tools = [
  { name: "web_search", description: "Pesquisa informação atual na web usando um motor de busca real. Usa sempre que precisares de informação recente, notícias, ou dados que possam ter mudado — nunca inventes resultados.", input_schema: { type: "object", properties: { query: { type: "string", description: "Termo de busca" } }, required: ["query"] } },
  { name: "search_market", description: "Pesquisa dados reais de um ativo financeiro: cripto (nome/símbolo, ex 'bitcoin'), câmbio (código ISO, ex 'EUR', 'USD/JPY'), ou ação/índice (ticker, ex 'AAPL'). Devolve preço e variação reais — nunca inventes valores.", input_schema: { type: "object", properties: { query: { type: "string", description: "Nome, símbolo, código ou ticker" } }, required: ["query"] } },
  { name: "search_place", description: "Pesquisa a localização real (coordenadas e nome formal) de um lugar — cidade, morada, ponto de interesse. Nunca inventes coordenadas.", input_schema: { type: "object", properties: { query: { type: "string", description: "Nome do lugar" } }, required: ["query"] } },
  { name: "search_calendar_date", description: "Resolve uma data em linguagem natural (ex 'próxima sexta-feira') para ISO (YYYY-MM-DD).", input_schema: { type: "object", properties: { query: { type: "string", description: "Referência de data em linguagem natural" } }, required: ["query"] } },
  { name: "create_pdf", description: "Gera um PDF a partir de texto simples (sem HTML), devolve em base64.", input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string", description: "Parágrafos separados por \\n\\n" } }, required: ["title", "content"] } },
  { name: "create_docx", description: "Gera um Word (.docx) a partir de texto simples (sem HTML), devolve em base64.", input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string", description: "Parágrafos separados por \\n\\n" } }, required: ["title", "content"] } },
  { name: "create_xlsx", description: "Gera uma planilha Excel (.xlsx) a partir de headers e linhas já estruturados, devolve em base64.", input_schema: { type: "object", properties: { sheet_name: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["headers", "rows"] } },
  { name: "create_pptx", description: "Gera um PowerPoint (.pptx) a partir de slides já estruturados, devolve em base64.", input_schema: { type: "object", properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, bullets: { type: "array", items: { type: "string" } } } } } }, required: ["title", "slides"] } },
  { name: "generate_chart", description: "Gera um gráfico como PNG, devolve em base64.", input_schema: { type: "object", properties: { chart_type: { type: "string", enum: ["line", "bar", "pie", "doughnut"] }, title: { type: "string" }, labels: { type: "array", items: { type: "string" } }, data: { type: "array", items: { type: "number" } }, dataset_label: { type: "string" } }, required: ["chart_type", "labels", "data"] } },
  { name: "csv_to_xlsx", description: "Converte CSV em planilha Excel (.xlsx), devolve em base64.", input_schema: { type: "object", properties: { csv_content: { type: "string" } }, required: ["csv_content"] } },
  { name: "json_transform", description: "Transforma array JSON de objetos em tabela (headers + rows).", input_schema: { type: "object", properties: { json_data: { type: "string" } }, required: ["json_data"] } },
  { name: "convert_document", description: "Converte um documento entre formatos (docx, pdf, xlsx, pptx, txt, csv, html) a partir de conteúdo base64.", input_schema: { type: "object", properties: { source_format: { type: "string" }, target_format: { type: "string" }, content_base64: { type: "string", description: "Conteúdo do ficheiro de origem em base64" }, filename: { type: "string" } }, required: ["source_format", "target_format", "content_base64"] } },
  { name: "html_to_docx", description: "Converte HTML (qualquer estrutura, incluindo tags aninhadas em qualquer profundidade: negrito, itálico, títulos h1-h6, listas, tabelas, cores) em Word (.docx), devolve em base64.", input_schema: { type: "object", properties: { html_content: { type: "string", description: "HTML completo ou fragmento, qualquer estrutura" }, filename: { type: "string" } }, required: ["html_content"] } },
  { name: "html_to_pdf", description: "Converte HTML (qualquer estrutura e profundidade de aninhamento) em PDF preservando títulos, parágrafos, listas, tabelas e negrito/itálico mesmo misturados dentro do mesmo parágrafo — não reproduz CSS avançado (flexbox, grid, posicionamento absoluto). Devolve em base64.", input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] } },
  { name: "html_to_xlsx", description: "Converte HTML em planilha Excel (.xlsx). Procura <table> em qualquer profundidade do documento (mesmo dentro de divs aninhadas): cada <tr> vira linha, <td>/<th> vira célula. Sem <table>, cada <p>/<li> (em qualquer profundidade) vira uma linha numa coluna única. Devolve em base64.", input_schema: { type: "object", properties: { html_content: { type: "string" }, sheet_name: { type: "string" } }, required: ["html_content"] } },
  { name: "html_to_pptx", description: "Converte HTML em PowerPoint (.pptx). Cada <h1> ou <h2>, em qualquer profundidade de aninhamento no documento, inicia um novo slide (o texto do heading vira o título); todo conteúdo até o próximo heading vira bullets desse slide. Sem headings, gera um único slide com todo o conteúdo. Devolve em base64.", input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] } },
];

// ═══════════════════════════════════════════════════════════
// WEB SEARCH
// ═══════════════════════════════════════════════════════════
async function webSearchImpl(query) {
  if (!query || !query.trim()) return { found: false, reason: "Query vazia" };
  if (!process.env.SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada" };
  try {
    const r = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ q: query }) });
    if (!r.ok) return { found: false, reason: `Erro Serper: status ${r.status}` };
    const data = await r.json();
    const results = (data.organic || []).slice(0, 5).map(x => ({ title: x.title || '', link: x.link || '', snippet: x.snippet || '' }));
    if (results.length === 0) return { found: false, reason: `Nenhum resultado para "${query}"` };
    return { found: true, results };
  } catch (e) { return { found: false, reason: `Erro ao pesquisar: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// SEARCH MARKET — em paralelo
// ═══════════════════════════════════════════════════════════
async function tryMarketAsCrypto(q) {
  try {
    const sr = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
    if (!sr.ok) return null;
    const sd = await sr.json();
    const coins = sd.coins || [];
    if (coins.length === 0) return null;
    const first = coins[0];
    const id = first.id, symbol = (first.symbol || '').toUpperCase(), name = first.name;
    if (!id || !symbol || !name) return null;
    const pr = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`, { signal: AbortSignal.timeout(8000) });
    let price = null, changePercent24h = null;
    if (pr.ok) {
      const pd = await pr.json();
      const entry = pd[id];
      if (entry) { price = typeof entry.usd === 'number' ? entry.usd : null; changePercent24h = typeof entry.usd_24h_change === 'number' ? entry.usd_24h_change : null; }
    }
    return { found: true, type: 'crypto', symbol, name, coingeckoId: id, price, currency: 'USD', changePercent24h, source: 'coingecko' };
  } catch (_) { return null; }
}
async function fetchForexCurrencyNames() {
  try {
    const r = await fetch("https://api.frankfurter.app/currencies", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    return await r.json();
  } catch (_) { return {}; }
}
function matchForexCode(q, names) {
  const c = q.trim().toUpperCase().replace(/[^A-Z/]/g, '');
  if (!c) return null;
  if (c.includes('/')) { const p = c.split('/'); return (p.length === 2 && names[p[0]] && names[p[1]]) ? c : null; }
  return (c.length === 3 && names[c]) ? c : null;
}
async function tryMarketAsForex(q) {
  const names = await fetchForexCurrencyNames();
  const code = matchForexCode(q, names);
  if (!code) return null;
  try {
    let base = 'USD', target = code;
    if (code.includes('/')) [base, target] = code.split('/');
    const r = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${target}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const rate = d.rates ? d.rates[target] : null;
    if (typeof rate !== 'number') return null;
    return { found: true, type: 'forex', symbol: code.includes('/') ? code : `${base}/${target}`, name: names[target] || target, price: rate, currency: target, changePercent24h: null, source: 'frankfurter' };
  } catch (_) { return null; }
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
  } catch (_) { return null; }
}
async function searchMarketImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: `Não foi encontrado nenhum ativo para "${query}".` };
  const results = await Promise.allSettled([
    tryMarketAsCrypto(trimmed),
    tryMarketAsForex(trimmed),
    tryMarketAsStock(trimmed),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return { found: false, reason: `Não foi encontrado nenhum ativo (cripto, câmbio ou ação) para "${trimmed}".` };
}

// ═══════════════════════════════════════════════════════════
// SEARCH PLACE
// ═══════════════════════════════════════════════════════════
async function searchPlaceImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: `Não foi encontrado nenhum lugar para "${query}".` };
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt&q=${encodeURIComponent(trimmed)}`, { headers: { "User-Agent": "NexaApp/1.0" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const list = await r.json();
      if (list.length > 0) {
        const f = list[0], lat = parseFloat(f.lat), lng = parseFloat(f.lon), name = f.display_name;
        if (!isNaN(lat) && !isNaN(lng) && name) return { found: true, name, lat, lng };
      }
    }
  } catch (_) {}
  return { found: false, reason: `Não foi encontrado nenhum lugar para "${trimmed}".` };
}

// ═══════════════════════════════════════════════════════════
// SEARCH CALENDAR DATE
// ═══════════════════════════════════════════════════════════
const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS_PT = { janeiro: 0, fevereiro: 1, março: 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };
function toIsoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function formatHumanLabel(d) { return `${WEEKDAYS_PT[d.getDay()]}, ${d.getDate()} de ${Object.keys(MONTHS_PT)[d.getMonth()]}`; }
async function searchCalendarDateImpl(query) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return { found: false, reason: `Não foi possível interpretar "${query}" como uma data.` };
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (trimmed.includes('hoje')) return { found: true, isoDate: toIsoDate(now), humanLabel: formatHumanLabel(now) };
  if (trimmed.includes('depois de amanhã') || trimmed.includes('depois de amanha')) { const d = new Date(now); d.setDate(d.getDate() + 2); return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) }; }
  if (trimmed.includes('amanhã') || trimmed.includes('amanha')) { const d = new Date(now); d.setDate(d.getDate() + 1); return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) }; }
  const rel = trimmed.match(/daqui a (\d+|um[a]?|dois|duas|três|tres|quatro|cinco) (dia|dias|semana|semanas)/);
  if (rel) {
    const numWords = { um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5 };
    const num = numWords[rel[1]] !== undefined ? numWords[rel[1]] : parseInt(rel[1], 10);
    const days = rel[2].startsWith('semana') ? num * 7 : num;
    const d = new Date(now); d.setDate(d.getDate() + days);
    return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
  }
  for (let i = 0; i < WEEKDAYS_PT.length; i++) {
    const short = WEEKDAYS_PT[i].replace('-feira', '');
    if (trimmed.includes(short)) {
      const d = new Date(now); let diff = (i - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
      d.setDate(d.getDate() + diff);
      return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
    }
  }
  const dm = trimmed.match(/(\d{1,2})\s+(?:de\s+)?([a-zçã]+)/);
  if (dm) {
    const day = parseInt(dm[1], 10), monthIdx = MONTHS_PT[dm[2]];
    if (monthIdx !== undefined && day >= 1 && day <= 31) {
      let year = now.getFullYear(), d = new Date(year, monthIdx, day);
      if (d < now) d = new Date(year + 1, monthIdx, day);
      return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
    }
  }
  return { found: false, reason: `Não foi possível interpretar "${trimmed}" como uma data.` };
}

// ═══════════════════════════════════════════════════════════
// CRIAÇÃO DE DOCUMENTOS — texto puro
// ═══════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');
async function createPdfImpl(title, content) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50 });
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve({ success: true, filename: `doc_${Date.now()}.pdf`, mime_type: 'application/pdf', content_base64: Buffer.concat(chunks).toString('base64') }));
    doc.fontSize(20).text(title, { underline: true }); doc.moveDown();
    (content || '').split('\n\n').forEach(p => { doc.fontSize(12).text(p); doc.moveDown(); });
    doc.end();
  });
}

const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
async function createDocxImpl(title, content) {
  const paragraphs = (content || '').split('\n\n').map(p => new Paragraph({ children: [new TextRun(p)], spacing: { after: 200 } }));
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }), ...paragraphs] }] });
  const buffer = await Packer.toBuffer(doc);
  return { success: true, filename: `doc_${Date.now()}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content_base64: buffer.toString('base64') };
}

const ExcelJS = require('exceljs');
async function createXlsxImpl(sheetName, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName || 'Planilha1');
  sheet.addRow(headers); sheet.getRow(1).font = { bold: true };
  (rows || []).forEach(r => sheet.addRow(r));
  sheet.columns.forEach(c => { c.width = 18; });
  const buffer = await wb.xlsx.writeBuffer();
  return { success: true, filename: `sheet_${Date.now()}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: Buffer.from(buffer).toString('base64') };
}

const PptxGenJS = require('pptxgenjs');
async function createPptxImpl(title, slides) {
  const pptx = new PptxGenJS();
  const t = pptx.addSlide();
  t.addText(title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 32, bold: true, align: 'center' });
  (slides || []).forEach(s => {
    const slide = pptx.addSlide();
    slide.addText(s.heading || '', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true });
    const bullets = (s.bullets || []).map(b => ({ text: b, options: { bullet: true, breakLine: true } }));
    if (bullets.length > 0) slide.addText(bullets, { x: 0.5, y: 1.4, w: 9, h: 4, fontSize: 16 });
  });
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return { success: true, filename: `pres_${Date.now()}.pptx`, mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', content_base64: Buffer.from(buffer).toString('base64') };
}

async function generateChartImpl(chartType, title, labels, data, datasetLabel) {
  const config = { type: chartType, data: { labels, datasets: [{ label: datasetLabel || 'Dados', data, backgroundColor: ['#6F5AF6', '#5AF6D4', '#F65A8E', '#F6C75A', '#5A8EF6', '#C75AF6'], borderColor: '#6F5AF6', borderWidth: 1 }] }, options: { plugins: { title: { display: !!title, text: title || '' } } } };
  const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}&width=600&height=400`;
  const r = await fetch(url);
  if (!r.ok) return { success: false, reason: `Erro ao gerar gráfico: status ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  return { success: true, filename: `chart_${Date.now()}.png`, mime_type: 'image/png', content_base64: buf.toString('base64') };
}

async function csvToXlsxImpl(csvContent) {
  const lines = (csvContent || '').trim().split('\n').map(l => l.split(','));
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Dados');
  lines.forEach((l, i) => { const row = sheet.addRow(l.map(c => c.trim())); if (i === 0) row.font = { bold: true }; });
  sheet.columns.forEach(c => { c.width = 18; });
  const buffer = await wb.xlsx.writeBuffer();
  return { success: true, filename: `converted_${Date.now()}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: Buffer.from(buffer).toString('base64') };
}

function jsonTransformImpl(jsonDataStr) {
  try {
    const data = JSON.parse(jsonDataStr);
    if (!Array.isArray(data) || data.length === 0) return { error: "json_data deve ser um array não vazio" };
    const headers = Object.keys(data[0]);
    const rows = data.map(o => headers.map(h => String(o[h] ?? '')));
    return { headers, rows };
  } catch (e) { return { error: `JSON inválido: ${e.message}` }; }
}

async function convertDocumentImpl(sourceFormat, targetFormat, contentBase64, filename) {
  const src = (sourceFormat || '').toLowerCase(), tgt = (targetFormat || '').toLowerCase();
  if (!contentBase64) return { success: false, reason: "content_base64 obrigatório" };
  try {
    const buffer = Buffer.from(contentBase64, 'base64');
    if (src === 'csv' && tgt === 'xlsx') return await csvToXlsxImpl(buffer.toString('utf-8'));
    if (src === 'txt' && tgt === 'pdf') return await createPdfImpl(filename || 'Documento', buffer.toString('utf-8'));
    if (src === 'txt' && tgt === 'docx') return await createDocxImpl(filename || 'Documento', buffer.toString('utf-8'));
    if (src === 'html' && tgt === 'docx') return await htmlToDocxImpl(buffer.toString('utf-8'), filename);
    if (src === 'html' && tgt === 'pdf') return await htmlToPdfImpl(buffer.toString('utf-8'), filename || 'Documento');
    if (src === 'html' && tgt === 'xlsx') return await htmlToXlsxImpl(buffer.toString('utf-8'), filename);
    if (src === 'html' && tgt === 'pptx') return await htmlToPptxImpl(buffer.toString('utf-8'), filename || 'Apresentação');
    if (src === 'json' && tgt === 'xlsx') {
      const t = jsonTransformImpl(buffer.toString('utf-8'));
      if (t.error) return { success: false, reason: t.error };
      return await createXlsxImpl(filename || 'Dados', t.headers, t.rows);
    }
    return { success: false, reason: `Conversão de ${src} para ${tgt} não suportada nesta versão. Formatos que dependem de renderização visual fiel (ex: docx→pdf preservando layout exato) exigem um motor de conversão dedicado, não incluído aqui.` };
  } catch (e) {
    return { success: false, reason: `Erro ao converter: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// HTML COMO ORIGEM UNIVERSAL — puro JavaScript, sem Chromium,
// sem LibreOffice, sem binário nativo. Todas as 4 funções abaixo
// aceitam HTML de QUALQUER estrutura e profundidade de
// aninhamento — não dependem mais de tags serem filhas diretas
// de um elemento específico.
// ═══════════════════════════════════════════════════════════
const cheerio = require('cheerio');
const HtmlToDocx = require('@turbodocx/html-to-docx');

// --- HTML → DOCX ---
// @turbodocx/html-to-docx já parseia a árvore inteira e entende
// aninhamento arbitrário nativamente (é um parser de HTML de
// verdade por baixo) — não precisa de tratamento especial aqui.
async function htmlToDocxImpl(htmlContent, filename) {
  if (!htmlContent || !htmlContent.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const buffer = await HtmlToDocx(htmlContent);
    return { success: true, filename: (filename || `doc_${Date.now()}`).replace(/\.docx$/i, '') + '.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content_base64: Buffer.from(buffer).toString('base64') };
  } catch (e) {
    return { success: false, reason: `Erro ao converter HTML para DOCX: ${e.message}` };
  }
}

// --- HTML → PDF ---
// Reescrito para recursão genuína: renderInline() processa o
// CONTEÚDO de um bloco (parágrafo, célula, li) nó-a-nó, mantendo
// negrito/itálico mesmo misturado no meio do texto (usa
// `continued: true` do pdfkit para não quebrar linha entre pedaços).
// renderBlock() decide se um elemento é estrutural (h1, p, table,
// ul...) e o processa como bloco, OU se é só um contêiner (div,
// span, section, body...) e nesse caso desce recursivamente nos
// filhos sem limite de profundidade.
const BLOCK_TAGS_PDF = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'table', 'br', 'hr']);

function renderInline($, node, doc, style) {
  // style acumula { bold, italic } conforme desce por <b>/<strong>/<i>/<em>
  $(node).contents().each((_, el) => {
    if (el.type === 'text') {
      const text = $(el).data || '';
      if (text.trim().length === 0 && text.length > 0) { doc.text(' ', { continued: true }); return; }
      if (!text.trim()) return;
      let font = 'Helvetica';
      if (style.bold && style.italic) font = 'Helvetica-BoldOblique';
      else if (style.bold) font = 'Helvetica-Bold';
      else if (style.italic) font = 'Helvetica-Oblique';
      doc.font(font).text(text, { continued: true });
      return;
    }
    if (el.type !== 'tag') return;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'b' || tag === 'strong') { renderInline($, el, doc, { ...style, bold: true }); return; }
    if (tag === 'i' || tag === 'em') { renderInline($, el, doc, { ...style, italic: true }); return; }
    if (tag === 'br') { doc.text('', { continued: true }); doc.text('\n', { continued: true }); return; }
    // qualquer outra tag inline (span, a, small, code...) — desce mantendo o style atual
    renderInline($, el, doc, style);
  });
}

function renderBlock($, node, doc) {
  $(node).contents().each((_, el) => {
    if (el.type === 'text') {
      const text = $(el).data ? $(el).data.trim() : '';
      if (text) doc.font('Helvetica').fontSize(12).text(text);
      return;
    }
    if (el.type !== 'tag') return;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    if (!BLOCK_TAGS_PDF.has(tag)) {
      // div, span solto no nível de bloco, section, article, body, etc:
      // não é estrutural — desce recursivamente sem limite de profundidade
      renderBlock($, el, doc);
      return;
    }

    switch (tag) {
      case 'h1': doc.moveDown(0.5); doc.fontSize(22).font('Helvetica-Bold').text(''); doc.font('Helvetica-Bold').fontSize(22); renderInline($, el, doc, { bold: true, italic: false }); doc.text('', { continued: false }); doc.font('Helvetica').fontSize(12).moveDown(0.3); break;
      case 'h2': doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(18); renderInline($, el, doc, { bold: true, italic: false }); doc.text('', { continued: false }); doc.font('Helvetica').fontSize(12).moveDown(0.3); break;
      case 'h3': case 'h4': case 'h5': case 'h6': doc.moveDown(0.4); doc.font('Helvetica-Bold').fontSize(14); renderInline($, el, doc, { bold: true, italic: false }); doc.text('', { continued: false }); doc.font('Helvetica').fontSize(12).moveDown(0.2); break;
      case 'p':
        doc.moveDown(0.3).fontSize(12).font('Helvetica');
        renderInline($, el, doc, { bold: false, italic: false });
        doc.text('', { continued: false }); // fecha a linha continued
        break;
      case 'ul': case 'ol':
        // <li> pode conter QUALQUER coisa (não só texto) — desce recursivamente
        // no conteúdo de cada <li>, com o bullet como prefixo
        $(el).children('li').each((i, li) => {
          const bullet = tag === 'ol' ? `${i + 1}. ` : '• ';
          doc.moveDown(0.1).fontSize(12).font('Helvetica').text(bullet, { continued: true, indent: 20 });
          renderInline($, li, doc, { bold: false, italic: false });
          doc.text('', { continued: false });
        });
        break;
      case 'table':
        doc.moveDown(0.3);
        // procura <tr> em qualquer profundidade dentro da tabela
        // (cobre <thead>/<tbody>/<tfoot> e wrappers extras)
        $(el).find('tr').each((_, tr) => {
          const cells = $(tr).find('td, th').map((_, td) => $(td).text().trim()).get();
          doc.fontSize(11).font('Helvetica').text(cells.join('   |   '));
        });
        doc.moveDown(0.3);
        break;
      case 'hr': doc.moveDown(0.3); doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke(); doc.moveDown(0.3); break;
      case 'br': doc.moveDown(0.2); break;
    }
  });
}

async function htmlToPdfImpl(htmlContent, title) {
  if (!htmlContent || !htmlContent.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const $ = cheerio.load(htmlContent);
    return await new Promise((resolve) => {
      const chunks = [];
      const doc = new PDFDocument({ margin: 50 });
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve({ success: true, filename: `doc_${Date.now()}.pdf`, mime_type: 'application/pdf', content_base64: Buffer.concat(chunks).toString('base64') }));
      if (title) { doc.fontSize(20).font('Helvetica-Bold').text(title, { underline: true }); doc.font('Helvetica').moveDown(); }
      const bodyRoot = $('body').length ? $('body')[0] : $.root()[0];
      renderBlock($, bodyRoot, doc);
      doc.end();
    });
  } catch (e) {
    return { success: false, reason: `Erro ao converter HTML para PDF: ${e.message}` };
  }
}

// --- HTML → XLSX ---
// $('table') do cheerio já busca em QUALQUER profundidade do
// documento por padrão (é uma busca CSS-selector, não limitada
// a filhos diretos) — isso já funcionava certo antes. O que
// estava raso era o fallback: agora usa $('p, li') que também
// já busca em qualquer profundidade, sem mudança necessária aqui
// além de deixar isso explícito no comentário.
async function htmlToXlsxImpl(htmlContent, sheetName) {
  if (!htmlContent || !htmlContent.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const $ = cheerio.load(htmlContent);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(sheetName || 'Planilha1');
    const tables = $('table'); // busca em qualquer profundidade
    if (tables.length > 0) {
      $(tables[0]).find('tr').each((i, tr) => { // find() também é recursivo por padrão
        const cells = $(tr).find('td, th').map((_, td) => $(td).text().trim()).get();
        if (cells.length > 0) {
          const row = sheet.addRow(cells);
          if (i === 0) row.font = { bold: true };
        }
      });
    } else {
      const lines = $('p, li').map((_, el) => $(el).text().trim()).get().filter(Boolean); // busca em qualquer profundidade
      if (lines.length === 0) return { success: false, reason: "Nenhuma <table>, <p> ou <li> encontrada no HTML para converter em linhas." };
      lines.forEach(l => sheet.addRow([l]));
    }
    sheet.columns.forEach(c => { c.width = 22; });
    const buffer = await wb.xlsx.writeBuffer();
    return { success: true, filename: `sheet_${Date.now()}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: Buffer.from(buffer).toString('base64') };
  } catch (e) {
    return { success: false, reason: `Erro ao converter HTML para XLSX: ${e.message}` };
  }
}

// --- HTML → PPTX ---
// Reescrito: em vez de olhar só filhos diretos do body, agora
// percorre TODOS os elementos do documento em ordem de documento
// (profundidade arbitrária) usando $('*').each() do cheerio, que
// varre a árvore inteira respeitando a ordem em que aparecem no
// HTML. Isso captura heading dentro de <div>, <section>, tabela,
// wrapper de qualquer tipo.
function flattenInDocumentOrder($, root) {
  // $('*', root) retorna todo elemento descendente de root,
  // em ordem de documento (topo pra baixo, esquerda pra direita) —
  // é assim que o cheerio/CSS selectors funcionam por padrão.
  return $(root).find('*').toArray();
}

async function htmlToPptxImpl(htmlContent, title) {
  if (!htmlContent || !htmlContent.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const $ = cheerio.load(htmlContent);
    const bodyRoot = $('body').length ? $('body')[0] : $.root()[0];
    const allEls = flattenInDocumentOrder($, bodyRoot);

    const slidesData = [];
    let current = null;
    const consumed = new Set(); // evita processar o mesmo <li>/texto 2x (uma vez como parte de <ul>, outra solto)

    for (const el of allEls) {
      if (consumed.has(el)) continue;
      const tag = el.tagName ? el.tagName.toLowerCase() : '';

      if (tag === 'h1' || tag === 'h2') {
        current = { heading: $(el).text().trim(), bullets: [] };
        slidesData.push(current);
        continue;
      }
      if (!current) continue; // texto antes do primeiro heading não vira slide (vai pro fallback se não houver heading nenhum)

      if (tag === 'ul' || tag === 'ol') {
        $(el).find('li').each((_, li) => {
          current.bullets.push($(li).text().trim());
          consumed.add(li);
        });
        consumed.add(el);
      } else if (tag === 'li') {
        // <li> solto que não foi consumido por um <ul>/<ol> já visitado
        const text = $(el).text().trim();
        if (text) current.bullets.push(text);
      } else if (tag === 'table') {
        $(el).find('tr').each((_, tr) => {
          const cells = $(tr).find('td, th').map((_, td) => $(td).text().trim()).get();
          if (cells.length > 0) current.bullets.push(cells.join(' | '));
          consumed.add(tr);
        });
        consumed.add(el);
      } else if (tag === 'p' || /^h[3-6]$/.test(tag)) {
        const text = $(el).text().trim();
        if (text) current.bullets.push(text);
      }
      // divs/spans/sections puros não geram bullet próprio — o texto
      // deles já foi capturado quando o <p>/<li> interno foi visitado
      // pela própria iteração de allEls (que inclui TODOS os descendentes)
    }

    if (slidesData.length === 0) {
      const allText = $(bodyRoot).text().trim();
      slidesData.push({ heading: title || 'Apresentação', bullets: allText ? [allText] : [] });
    }

    const pptx = new PptxGenJS();
    const t = pptx.addSlide();
    t.addText(title || slidesData[0].heading || 'Apresentação', { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 32, bold: true, align: 'center' });
    slidesData.forEach(s => {
      const slide = pptx.addSlide();
      slide.addText(s.heading || '', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true });
      const bullets = s.bullets.filter(Boolean).map(b => ({ text: b, options: { bullet: true, breakLine: true } }));
      if (bullets.length > 0) slide.addText(bullets, { x: 0.5, y: 1.4, w: 9, h: 4, fontSize: 16 });
    });
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    return { success: true, filename: `pres_${Date.now()}.pptx`, mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', content_base64: Buffer.from(buffer).toString('base64') };
  } catch (e) {
    return { success: false, reason: `Erro ao converter HTML para PPTX: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════
const HEAVY_TOOLS = new Set([
  'create_pdf', 'create_docx', 'create_xlsx', 'create_pptx',
  'csv_to_xlsx', 'convert_document',
  'html_to_docx', 'html_to_pdf', 'html_to_xlsx', 'html_to_pptx',
]);

async function runTool(name, input) {
  const query = input?.query || '';
  switch (name) {
    case "web_search": return await webSearchImpl(query);
    case "search_market": return await searchMarketImpl(query);
    case "search_place": return await searchPlaceImpl(query);
    case "search_calendar_date": return await searchCalendarDateImpl(query);
    case "create_pdf": return await createPdfImpl(input.title, input.content);
    case "create_docx": return await createDocxImpl(input.title, input.content);
    case "create_xlsx": return await createXlsxImpl(input.sheet_name, input.headers, input.rows);
    case "create_pptx": return await createPptxImpl(input.title, input.slides);
    case "generate_chart": return await generateChartImpl(input.chart_type, input.title, input.labels, input.data, input.dataset_label);
    case "csv_to_xlsx": return await csvToXlsxImpl(input.csv_content);
    case "json_transform": return jsonTransformImpl(input.json_data);
    case "convert_document": return await convertDocumentImpl(input.source_format, input.target_format, input.content_base64, input.filename);
    case "html_to_docx": return await htmlToDocxImpl(input.html_content, input.filename);
    case "html_to_pdf": return await htmlToPdfImpl(input.html_content, input.title);
    case "html_to_xlsx": return await htmlToXlsxImpl(input.html_content, input.sheet_name);
    case "html_to_pptx": return await htmlToPptxImpl(input.html_content, input.title);
    default: return { found: false, reason: `Função desconhecida: ${name}` };
  }
}

async function executeTool(name, input) {
  if (HEAVY_TOOLS.has(name)) return enqueueHeavy(() => runTool(name, input));
  return runTool(name, input);
}

// ═══════════════════════════════════════════════════════════
// ROTAS
// ═══════════════════════════════════════════════════════════
app.get('/tools', (req, res) => res.json({ tools }));

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

app.get('/health', (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`Servidor de tools na porta ${PORT}`));