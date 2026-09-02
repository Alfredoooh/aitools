// ═══════════════════════════════════════════════════════════
// CONVERSÃO — implementações
// ═══════════════════════════════════════════════════════════

const ExcelJS = require('exceljs');
const cheerio = require('cheerio');
const htmlToDocx = require('@turbodocx/html-to-docx');
const mammoth = require('mammoth');
const { sanitizeFilename, escapeHtml } = require('../helpers');
const { createXlsxImpl, createPdfImpl, createPptxImpl } = require('./documents');

function parseCsv(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(l => l.length > 0);
  return lines.map(line => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { cells.push(cur); cur = ''; }
      else { cur += c; }
    }
    cells.push(cur);
    return cells;
  });
}

async function csvToXlsxImpl(csvContent) {
  try {
    if (!csvContent) return { found: false, reason: "csv_content vazio." };
    const rows = parseCsv(csvContent);
    if (rows.length === 0) return { found: false, reason: "CSV vazio ou inválido." };
    const [headers, ...dataRows] = rows;
    return await createXlsxImpl('Dados CSV', headers, dataRows);
  } catch (e) {
    return { found: false, reason: `Erro ao converter CSV: ${e.message}` };
  }
}

function jsonTransformImpl(jsonData) {
  try {
    if (!jsonData) return { found: false, reason: "json_data vazio." };
    const parsed = JSON.parse(jsonData);
    if (!Array.isArray(parsed) || parsed.length === 0) return { found: false, reason: "json_data precisa de ser um array não-vazio de objetos." };
    const headers = Array.from(new Set(parsed.flatMap(obj => Object.keys(obj))));
    const rows = parsed.map(obj => headers.map(h => obj[h] !== undefined ? String(obj[h]) : ''));
    return { found: true, headers, rows };
  } catch (e) {
    return { found: false, reason: `Erro ao transformar JSON: ${e.message}` };
  }
}

async function xlsxToJsonImpl(xlsxBase64) {
  try {
    if (!xlsxBase64) return { found: false, reason: "xlsx_base64 vazio." };
    const buffer = Buffer.from(xlsxBase64, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { found: false, reason: "Nenhuma folha encontrada no ficheiro." };
    const rows = [];
    let headers = [];
    sheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1).map(v => (v == null ? '' : (typeof v === 'object' && v.text ? v.text : v)));
      if (rowNumber === 1) { headers = values.map(v => String(v)); }
      else { const obj = {}; headers.forEach((h, i) => { obj[h] = values[i] !== undefined ? values[i] : null; }); rows.push(obj); }
    });
    return { found: true, sheet_name: sheet.name, total_rows: rows.length, data: rows };
  } catch (e) {
    return { found: false, reason: `Erro ao ler XLSX: ${e.message}` };
  }
}

async function htmlToDocxImpl(htmlContent, filename) {
  try {
    if (!htmlContent) return { found: false, reason: "html_content vazio." };
    const buffer = await htmlToDocx(htmlContent, null, { table: { row: { cantSplit: true } }, footer: false, pageNumber: false });
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return { found: true, content_base64: buf.toString('base64'), filename: `${sanitizeFilename(filename || 'documento')}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: filename || 'Documento Word' };
  } catch (e) {
    return { found: false, reason: `Erro ao converter HTML→DOCX: ${e.message}` };
  }
}

async function htmlToPdfImpl(htmlContent, title) {
  return await createPdfImpl(title || 'Documento', htmlContent, [], null);
}

async function htmlToXlsxImpl(htmlContent, sheetName) {
  try {
    if (!htmlContent) return { found: false, reason: "html_content vazio." };
    const $ = cheerio.load(htmlContent);
    const table = $('table').first();
    if (table.length === 0) return { found: false, reason: "Nenhuma <table> encontrada no HTML." };
    const rows = [];
    table.find('tr').each((_, tr) => {
      const cells = [];
      $(tr).find('th,td').each((_, td) => cells.push($(td).text().trim()));
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length === 0) return { found: false, reason: "Tabela sem linhas." };
    const [headers, ...dataRows] = rows;
    return await createXlsxImpl(sheetName || 'Dados HTML', headers, dataRows);
  } catch (e) {
    return { found: false, reason: `Erro ao converter HTML→XLSX: ${e.message}` };
  }
}

async function htmlToPptxImpl(htmlContent, title) {
  try {
    if (!htmlContent) return { found: false, reason: "html_content vazio." };
    const $ = cheerio.load(htmlContent);
    const slides = [];
    $('h1,h2,h3').each((_, heading) => {
      const headingText = $(heading).text().trim();
      const bullets = [];
      let next = $(heading).next();
      while (next.length && !['h1', 'h2', 'h3'].includes(next[0].tagName)) {
        if (next[0].tagName === 'ul' || next[0].tagName === 'ol') {
          next.find('li').each((_, li) => bullets.push($(li).text().trim()));
        } else if (next.text().trim()) { bullets.push(next.text().trim()); }
        next = next.next();
      }
      slides.push({ heading: headingText, bullets: bullets.slice(0, 8) });
    });
    if (slides.length === 0) return { found: false, reason: "Nenhum heading (h1/h2/h3) encontrado no HTML para estruturar slides." };
    return await createPptxImpl(title || 'Apresentação', slides);
  } catch (e) {
    return { found: false, reason: `Erro ao converter HTML→PPTX: ${e.message}` };
  }
}

async function docxToHtmlImpl(docxBase64) {
  try {
    if (!docxBase64) return { found: false, reason: "docx_base64 vazio." };
    const buffer = Buffer.from(docxBase64, 'base64');
    const result = await mammoth.convertToHtml({ buffer });
    return { found: true, html: result.value, warnings: (result.messages || []).map(m => m.message) };
  } catch (e) {
    return { found: false, reason: `Erro ao converter DOCX→HTML: ${e.message}` };
  }
}

module.exports = {
  csvToXlsxImpl,
  jsonTransformImpl,
  xlsxToJsonImpl,
  htmlToDocxImpl,
  htmlToPdfImpl,
  htmlToXlsxImpl,
  htmlToPptxImpl,
  docxToHtmlImpl,
};