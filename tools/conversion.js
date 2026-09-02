// ═══════════════════════════════════════════════════════════
// CONVERSÃO + CRIAÇÃO DE PLANILHA/APRESENTAÇÃO — implementações
// ═══════════════════════════════════════════════════════════

const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const { sanitizeFilename } = require('../helpers');

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

async function createXlsxImpl(sheetName, headers, rows) {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName || 'Folha1');
    sheet.addRow(headers || []);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle' };
    (rows || []).forEach((r, i) => {
      const row = sheet.addRow(r);
      if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    sheet.columns.forEach(col => {
      let maxLen = 10;
      col.eachCell({ includeEmpty: true }, cell => { maxLen = Math.max(maxLen, String(cell.value || '').length); });
      col.width = Math.min(40, maxLen + 4);
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      found: true, content_base64: Buffer.from(buffer).toString('base64'), filename: `${sanitizeFilename(sheetName || 'planilha')}.xlsx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: sheetName || 'Folha de cálculo',
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar XLSX: ${e.message}` };
  }
}

async function createPptxImpl(title, slides) {
  try {
    const pptx = new PptxGenJS();
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: '0F172A' };
    titleSlide.addText(title || 'Apresentação', { x: 0.5, y: 2.1, w: 9, h: 1.5, fontSize: 34, bold: true, align: 'center', color: 'FFFFFF' });
    (slides || []).forEach(s => {
      const slide = pptx.addSlide();
      slide.addText(s.heading || '', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true, color: '0F172A' });
      slide.addShape('rect', { x: 0.5, y: 1.15, w: 1.2, h: 0.04, fill: { color: '4F46E5' } });
      (s.bullets || []).forEach((bullet, i) => {
        slide.addText(bullet, { x: 0.7, y: 1.45 + i * 0.5, w: 8.6, h: 0.5, fontSize: 16, bullet: { code: '2022' }, color: '334155' });
      });
    });
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    return {
      found: true, content_base64: buffer.toString('base64'), filename: `${sanitizeFilename(title)}.pptx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: title || 'Apresentação',
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar PPTX: ${e.message}` };
  }
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

module.exports = {
  createXlsxImpl,
  createPptxImpl,
  csvToXlsxImpl,
  xlsxToJsonImpl,
};