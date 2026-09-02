// ═══════════════════════════════════════════════════════════
// DOCUMENTOS — create_pdf, create_pdf_structured, create_docx,
// create_xlsx, create_pptx, create_project_zip
// ═══════════════════════════════════════════════════════════

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const htmlToDocx = require('@turbodocx/html-to-docx');
const AdmZip = require('adm-zip');
const { DESIGN, A4_WIDTH_PX, A4_HEIGHT_PX, A4_WIDTH_PT, A4_HEIGHT_PT } = require('../config');
const { escapeHtml, sanitizeFilename, fetchImageAsBase64 } = require('../helpers');
const { htmlToSvgViaSatori, svgToPngBuffer } = require('../satori-helpers');
const { generateChartImpl } = require('./image-generation');
const { getCurrentDateInfo } = require('../config');

function pdfHeaderHtml(title, subtitle) {
  return `<div style="display:flex; flex-direction:column; padding-bottom:22px; margin-bottom:22px; border-bottom:2px solid ${DESIGN.ink};">
    <div style="display:flex; font-size:24px; font-weight:700; color:${DESIGN.ink};">${escapeHtml(title || 'Documento')}</div>
    ${subtitle ? `<div style="display:flex; font-size:13px; color:${DESIGN.inkMuted}; padding-top:6px;">${escapeHtml(subtitle)}</div>` : ''}
  </div>`;
}

function pdfFooterHtml(pageLabel) {
  return `<div style="display:flex; justify-content:space-between; padding-top:16px; margin-top:auto; border-top:1px solid ${DESIGN.border}; font-size:10.5px; color:${DESIGN.inkMuted};">
    <div style="display:flex;">Gerado em ${escapeHtml(getCurrentDateInfo().full)}</div>
    <div style="display:flex;">${escapeHtml(pageLabel || '')}</div>
  </div>`;
}

async function buildRealImageBlockHtml(url, maxWidthPx) {
  try {
    const { base64 } = await fetchImageAsBase64(url);
    return `<div style="display:flex; padding:10px 0; justify-content:center;"><img src="data:image/png;base64,${base64}" style="max-width:${maxWidthPx || 700}px; border-radius:10px;" /></div>`;
  } catch (e) {
    return `<div style="display:flex; padding:8px 0; font-size:11px; color:${DESIGN.inkMuted};">[Imagem indisponível: ${escapeHtml(url)}]</div>`;
  }
}

async function createPdfImpl(title, htmlContent, imageUrls, embedChart, subtitle) {
  return new Promise(async (resolve) => {
    try {
      let bodyHtml = htmlContent || '';
      let extraImagesHtml = '';
      for (const url of (imageUrls || []).slice(0, 6)) {
        extraImagesHtml += await buildRealImageBlockHtml(url, 700);
      }
      if (embedChart && embedChart.chart_type) {
        try {
          const chartResult = await generateChartImpl(embedChart.chart_type, embedChart.title, embedChart.labels, embedChart.datasets);
          if (chartResult.found) {
            extraImagesHtml += `<div style="display:flex; padding:10px 0; justify-content:center;"><img src="data:image/png;base64,${chartResult.content_base64}" style="max-width:700px; border-radius:10px; border:1px solid ${DESIGN.border};" /></div>`;
          }
        } catch (_) {}
      }
      const fullHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:48px; background:${DESIGN.white}; font-family:Inter;">
        ${pdfHeaderHtml(title, subtitle)}
        <div style="display:flex; flex-direction:column; flex:1; font-size:13px; line-height:1.6; color:${DESIGN.inkSoft};">${bodyHtml}</div>
        ${extraImagesHtml}
        ${pdfFooterHtml('Página 1')}
      </div>`;
      const svg = await htmlToSvgViaSatori(fullHtml, A4_WIDTH_PX, A4_HEIGHT_PX);
      const pageImageBuffer = await svgToPngBuffer(svg);
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ found: true, content_base64: buffer.toString('base64'), filename: `${sanitizeFilename(title || 'documento')}.pdf`, mime_type: 'application/pdf', label: title || 'Documento PDF' });
      });
      doc.image(pageImageBuffer, 0, 0, { width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
      doc.end();
    } catch (e) {
      resolve({ found: false, reason: `Erro ao gerar PDF: ${e.message}` });
    }
  });
}

async function createPdfStructuredImpl(title, subtitle, sections) {
  try {
    let bodyHtml = '';
    for (const sec of (sections || [])) {
      if (sec.heading) bodyHtml += `<div style="display:flex; font-size:16px; font-weight:700; color:${DESIGN.ink}; padding:16px 0 8px 0;">${escapeHtml(sec.heading)}</div>`;
      for (const p of (sec.paragraphs || [])) bodyHtml += `<div style="display:flex; font-size:12.5px; color:${DESIGN.inkSoft}; padding-bottom:8px; line-height:1.6;">${escapeHtml(p)}</div>`;
      if (sec.bullet_list && sec.bullet_list.length > 0) {
        bodyHtml += `<div style="display:flex; flex-direction:column; padding:4px 0 10px 0;">`;
        for (const item of sec.bullet_list) {
          bodyHtml += `<div style="display:flex; padding:4px 0; font-size:12.5px; color:${DESIGN.inkSoft};"><div style="display:flex; width:6px; height:6px; border-radius:3px; background:${DESIGN.palette[0]}; margin:6px 10px 0 0;"></div><div style="display:flex; flex:1;">${escapeHtml(item)}</div></div>`;
        }
        bodyHtml += `</div>`;
      }
      if (sec.table && sec.table.headers && sec.table.headers.length > 0) {
        const headerCells = sec.table.headers.map(h => `<div style="display:flex; flex:1; padding:8px 10px; font-weight:700; font-size:11.5px; color:${DESIGN.white};">${escapeHtml(h)}</div>`).join('');
        const rowsHtml = (sec.table.rows || []).map((row, i) => `<div style="display:flex; background:${i % 2 === 0 ? DESIGN.surface : DESIGN.white};">${row.map(cell => `<div style="display:flex; flex:1; padding:7px 10px; font-size:11px; color:${DESIGN.inkSoft};">${escapeHtml(cell)}</div>`).join('')}</div>`).join('');
        bodyHtml += `<div style="display:flex; flex-direction:column; margin:8px 0 14px 0; border-radius:8px; overflow:hidden; border:1px solid ${DESIGN.border};">
          <div style="display:flex; background:${DESIGN.ink};">${headerCells}</div>
          <div style="display:flex; flex-direction:column;">${rowsHtml}</div>
        </div>`;
      }
      if (sec.image_url) {
        bodyHtml += await buildRealImageBlockHtml(sec.image_url, 650);
      }
      if (sec.embed_chart && sec.embed_chart.chart_type) {
        try {
          const chartResult = await generateChartImpl(sec.embed_chart.chart_type, sec.embed_chart.title, sec.embed_chart.labels, sec.embed_chart.datasets);
          if (chartResult.found) bodyHtml += `<div style="display:flex; padding:10px 0; justify-content:center;"><img src="data:image/png;base64,${chartResult.content_base64}" style="max-width:650px; border-radius:10px; border:1px solid ${DESIGN.border};" /></div>`;
        } catch (_) {}
      }
    }
    return await createPdfImpl(title, bodyHtml, [], null, subtitle);
  } catch (e) {
    return { found: false, reason: `Erro ao gerar PDF estruturado: ${e.message}` };
  }
}

async function createDocxImpl(title, htmlContent, imageUrls, embedChart) {
  try {
    let extraHtml = '';
    for (const url of (imageUrls || []).slice(0, 6)) {
      try {
        const { base64 } = await fetchImageAsBase64(url);
        extraHtml += `<p><img src="data:image/png;base64,${base64}" style="max-width:480px;" /></p>`;
      } catch (_) {
        extraHtml += `<p><em>[Imagem indisponível: ${escapeHtml(url)}]</em></p>`;
      }
    }
    if (embedChart && embedChart.chart_type) {
      try {
        const chartResult = await generateChartImpl(embedChart.chart_type, embedChart.title, embedChart.labels, embedChart.datasets);
        if (chartResult.found) extraHtml += `<p><img src="data:image/png;base64,${chartResult.content_base64}" style="max-width:480px;" /></p>`;
      } catch (_) {}
    }
    const buffer = await htmlToDocx(`<h1>${escapeHtml(title || '')}</h1>${htmlContent || ''}${extraHtml}`, null, {
      table: { row: { cantSplit: true } }, footer: false, pageNumber: false,
    });
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return {
      found: true, content_base64: buf.toString('base64'), filename: `${sanitizeFilename(title)}.docx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: title || 'Documento Word',
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

async function createProjectZipImpl(projectName, files, imageUrlsToInclude) {
  try {
    if (!files || files.length === 0) return { found: false, reason: "Nenhum ficheiro fornecido." };
    const zip = new AdmZip();
    const rootFolder = sanitizeFilename(projectName || 'projeto');
    for (const f of files) {
      if (!f.path || typeof f.content !== 'string') continue;
      const cleanPath = f.path.replace(/^\/+/, '');
      zip.addFile(`${rootFolder}/${cleanPath}`, Buffer.from(f.content, 'utf8'));
    }
    for (const img of (imageUrlsToInclude || []).slice(0, 8)) {
      if (!img.url || !img.path) continue;
      try {
        const { base64 } = await fetchImageAsBase64(img.url);
        const cleanPath = img.path.replace(/^\/+/, '');
        zip.addFile(`${rootFolder}/${cleanPath}`, Buffer.from(base64, 'base64'));
      } catch (_) {}
    }
    const buffer = zip.toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), filename: `${rootFolder}.zip`, mime_type: 'application/zip', label: projectName || 'Projeto ZIP' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar projeto zip: ${e.message}` };
  }
}

module.exports = {
  createPdfImpl,
  createPdfStructuredImpl,
  createDocxImpl,
  createXlsxImpl,
  createPptxImpl,
  createProjectZipImpl,
};