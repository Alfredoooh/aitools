// ═══════════════════════════════════════════════════════════
// DISPATCHER — runTool() + export do array `tools`
// ═══════════════════════════════════════════════════════════

const { tools } = require('./definitions');
const { ENABLE_HEAVY_TOOLS, HEAVY_TOOL_NAMES } = require('../config');
const { enqueueHeavy, withTimeout } = require('../queue');

const search = require('./search');
const email = require('./email');
const imageGeneration = require('./image-generation');
const documents = require('./documents');
const fileReading = require('./file-reading');
const conversion = require('./conversion');
const imageUtils = require('./image-utils');
const previewAndMisc = require('./preview-and-misc');
const textUtils = require('./text-utils');

async function runTool(name, input) {
  input = input || {};

  if (HEAVY_TOOL_NAMES.has(name) && !ENABLE_HEAVY_TOOLS) {
    return { found: false, reason: `A tool "${name}" está desativada neste plano (ENABLE_HEAVY_TOOLS=false). Disponível ao migrar para um plano com mais RAM.` };
  }

  switch (name) {
    // Busca / dados externos
    case "web_search": return await search.webSearchImpl(input.query);
    case "read_website": return await search.readWebsiteImpl(input.url);
    case "search_images": return await search.searchImagesImpl(input.query, input.max_results);
    case "search_videos": return await search.searchVideosImpl(input.query, input.max_results);
    case "search_books": return await search.searchBooksImpl(input.query, input.max_results);
    case "download_image_for_project": return await search.downloadImageForProjectImpl(input.query_or_url, input.target_filename);
    case "search_market": return await search.searchMarketImpl(input.query);
    case "search_place": return await search.searchPlaceImpl(input.query);
    case "search_calendar_date": return search.searchCalendarDateImpl(input.query);
    case "get_weather": return await search.getWeatherImpl(input.city);

    // Envio de email
    case "send_email": return await email.sendEmailImpl(input.to, input.subject, input.content, input.from_name, input.images);

    // Geração de imagem
    case "generate_chart": return await imageGeneration.generateChartImpl(input.chart_type, input.title, input.labels, input.datasets);
    case "generate_function_plot": return await imageGeneration.generateFunctionPlotImpl(input.expression, input.x_min, input.x_max, input.title, input.highlight_roots);
    case "generate_math_sheet": return await enqueueHeavy(withTimeout(() => imageGeneration.generateMathSheetImpl(input.expression, input.show_graph)));
    case "generate_mindmap": return await imageGeneration.generateMindmapImpl(input.root);
    case "generate_qrcode": return await imageGeneration.generateQrcodeImpl(input.content, input.size);
    case "generate_barcode": return await imageGeneration.generateBarcodeImpl(input.content, input.format);
    case "generate_table_image": return await imageGeneration.generateTableImageImpl(input.title, input.headers, input.rows);
    case "generate_html_image": return await enqueueHeavy(withTimeout(() => imageGeneration.generateHtmlImageImpl(input.html, input.width, input.height)));
    case "generate_color_scheme": return imageGeneration.generateColorSchemeImpl(input.base_color_hex);
    case "generate_random_avatar": return await imageGeneration.generateRandomAvatarImpl(input.seed, input.size);

    // Documentos
    case "create_pdf": return await enqueueHeavy(withTimeout(() => documents.createPdfImpl(input.title, input.html_content, input.image_urls, input.embed_chart)));
    case "create_pdf_structured": return await enqueueHeavy(withTimeout(() => documents.createPdfStructuredImpl(input.title, input.subtitle, input.sections)));
    case "create_docx": return await enqueueHeavy(withTimeout(() => documents.createDocxImpl(input.title, input.html_content, input.image_urls, input.embed_chart)));
    case "create_xlsx": return await documents.createXlsxImpl(input.sheet_name, input.headers, input.rows);
    case "create_pptx": return await documents.createPptxImpl(input.title, input.slides);
    case "create_project_zip": return await enqueueHeavy(withTimeout(() => documents.createProjectZipImpl(input.project_name, input.files, input.image_urls_to_include), 45000));

    // Leitura
    case "read_zip_contents": return await fileReading.readZipContentsImpl(input.zip_base64);
    case "read_pdf_contents": return await fileReading.readPdfContentsImpl(input.pdf_base64);
    case "extract_document_outline": return await fileReading.extractDocumentOutlineImpl(input.pdf_base64);

    // Conversão
    case "csv_to_xlsx": return await conversion.csvToXlsxImpl(input.csv_content);
    case "json_transform": return conversion.jsonTransformImpl(input.json_data);
    case "xlsx_to_json": return await conversion.xlsxToJsonImpl(input.xlsx_base64);
    case "html_to_docx": return await conversion.htmlToDocxImpl(input.html_content, input.filename);
    case "html_to_pdf": return await enqueueHeavy(withTimeout(() => conversion.htmlToPdfImpl(input.html_content, input.title)));
    case "html_to_xlsx": return await conversion.htmlToXlsxImpl(input.html_content, input.sheet_name);
    case "html_to_pptx": return await conversion.htmlToPptxImpl(input.html_content, input.title);
    case "docx_to_html": return await conversion.docxToHtmlImpl(input.docx_base64);

    // Imagem — utilitários
    case "get_image_colors": return await imageUtils.getImageColorsImpl(input.image_url, input.image_base64, input.num_colors);
    case "convert_image_format": return await imageUtils.convertImageFormatImpl(input.image_base64, input.target_format);
    case "resize_image": return await imageUtils.resizeImageImpl(input.image_base64, input.width, input.height);
    case "crop_image": return await imageUtils.cropImageImpl(input.image_base64, input.left, input.top, input.width, input.height);
    case "watermark_image": return await imageUtils.watermarkImageImpl(input.image_base64, input.watermark_text, input.position);
    case "image_metadata": return await imageUtils.imageMetadataImpl(input.image_base64);
    case "vectorize_image": return await enqueueHeavy(withTimeout(() => imageUtils.vectorizeImageImpl(input.image_base64, input.mode)));
    case "ocr_extract_text": return await enqueueHeavy(withTimeout(() => imageUtils.ocrExtractTextImpl(input.image_base64, input.language), 45000));
    case "pdf_to_images": return await previewAndMisc.pdfToImagesImpl(input.pdf_base64, input.max_pages);
    case "pptx_to_images": return await previewAndMisc.pptxToImagesImpl(input.pptx_base64);
    case "audio_duration_check": return await previewAndMisc.audioDurationCheckImpl(input.audio_base64);

    // Texto / dados
    case "str_replace_file": return textUtils.strReplaceFileImpl(input.content, input.old_str, input.new_str);
    case "diff_text": return textUtils.diffTextImpl(input.text_before, input.text_after);
    case "extract_urls_from_text": return textUtils.extractUrlsFromTextImpl(input.text);
    case "format_markdown_to_html": return textUtils.formatMarkdownToHtmlImpl(input.markdown);
    case "count_tokens_estimate": return textUtils.countTokensEstimateImpl(input.text);
    case "text_summary_stats": return textUtils.textSummaryStatsImpl(input.text);
    case "youtube_thumbnail_extract": return await textUtils.youtubeThumbnailExtractImpl(input.youtube_url);
    case "merge_pdfs": return await textUtils.mergePdfsImpl(input.pdfs_base64);
    case "split_pdf_pages": return await textUtils.splitPdfPagesImpl(input.pdf_base64, input.page_numbers);

    // Heavy tools (bloqueadas por defeito — ver check no topo)
    case "animate_html": return { found: false, reason: "animate_html requer motor de vídeo — indisponível neste servidor mesmo com ENABLE_HEAVY_TOOLS." };
    case "generate_infographic": return { found: false, reason: "generate_infographic ainda não implementada nesta versão." };

    default:
      return { found: false, reason: `Tool desconhecida: "${name}"` };
  }
}

module.exports = { tools, runTool };