const express = require('express');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const satori = require('satori').default;
const html = require('satori-html').html;
const sharp = require('sharp');
const math = require('mathjs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun } = require('docx');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const cheerio = require('cheerio');
const htmlToDocx = require('@turbodocx/html-to-docx');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// DEPENDÊNCIAS OPCIONAIS — libs para as tools novas que ainda
// não estão no package.json. Carregadas com try/require para
// não rebentar o arranque do servidor se faltar alguma; cada
// tool que precisar delas devolve erro claro em vez de crashar.
// Adiciona ao package.json quando quiseres ativar:
//   "pdf-lib": "^1.17.1"        → merge_pdfs, split_pdf_pages
//   "tesseract.js": "^5.1.0"    → ocr_extract_text
//   "mammoth": "^1.7.2"         → docx_to_html
//   "music-metadata": "^7.14.0" → audio_duration_check
//   "potrace": "^2.1.8"         → vectorize_image
// ═══════════════════════════════════════════════════════════
let pdfLib = null;
try { pdfLib = require('pdf-lib'); } catch (e) {}
let Tesseract = null;
try { Tesseract = require('tesseract.js'); } catch (e) {}
let mammoth = null;
try { mammoth = require('mammoth'); } catch (e) {}
let musicMetadata = null;
try { musicMetadata = require('music-metadata'); } catch (e) {}
let potrace = null;
try { potrace = require('potrace'); } catch (e) {}

const app = express();
app.use(express.json({ limit: '20mb' }));
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// CHAVES DE API — via variáveis de ambiente
// ═══════════════════════════════════════════════════════════
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';

// ═══════════════════════════════════════════════════════════
// FEATURE FLAG — tools pesadas ficam registadas mas desativadas
// até ligares ENABLE_HEAVY_TOOLS=true (ex: ao migrar para VPS
// com mais RAM). Zero reescrita nesse dia, só a env var.
// ═══════════════════════════════════════════════════════════
const ENABLE_HEAVY_TOOLS = process.env.ENABLE_HEAVY_TOOLS === 'true';

// ═══════════════════════════════════════════════════════════
// FONTE — satori exige buffer de fonte manual (não lê @font-face
// nem fontes de sistema). Coloca um Inter-Regular.ttf e um
// Inter-Bold.ttf em ./fonts/ na raiz do projeto.
// Download: https://fonts.google.com/specimen/Inter
// ═══════════════════════════════════════════════════════════
let FONT_REGULAR = null;
let FONT_BOLD = null;
try {
  FONT_REGULAR = fs.readFileSync(path.join(__dirname, 'fonts', 'Inter-Regular.ttf'));
  FONT_BOLD = fs.readFileSync(path.join(__dirname, 'fonts', 'Inter-Bold.ttf'));
} catch (e) {
  console.warn('⚠️  Fontes não encontradas em ./fonts/ — generate_html_image e create_pdf vão falhar até adicionares Inter-Regular.ttf e Inter-Bold.ttf');
}

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
// LIMITES — ZIP / arquivos / PDF / imagem, ajustados para free
// ═══════════════════════════════════════════════════════════
const ZIP_MAX_BYTES = 15 * 1024 * 1024;
const ZIP_MAX_FILES = 100;
const ZIP_TEXT_TRUNCATE = 15000;
const ZIP_MAX_IMAGES = 10;
const ZIP_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const PDF_MAX_PAGES_TEXT = 40;
const VECTORIZE_MAX_DIMENSION = 2000;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.csv', '.tsv',
  '.dart', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss',
  '.py', '.java', '.kt', '.kts', '.swift', '.go', '.rs', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bash', '.gradle', '.properties',
  '.env', '.gitignore', '.dockerfile', '.sql', '.toml', '.ini', '.lock',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function extOf(filename) {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}
function mimeForImageExt(ext) {
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }[ext] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════════════
// HELPERS DE TEXTO/FICHEIRO — usados por várias tools
// ═══════════════════════════════════════════════════════════
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(name) {
  return (name || 'documento')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'documento';
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
// FETCH DE IMAGEM EXTERNA → base64 (usado por PDF/DOCX/ZIP)
// ═══════════════════════════════════════════════════════════
async function fetchImageAsBase64(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Falha ao descarregar imagem (${r.status}): ${url}`);
  const arrayBuffer = await r.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = r.headers.get('content-type') || 'image/png';
  return { base64: buffer.toString('base64'), mimeType: contentType, buffer };
}

// ═══════════════════════════════════════════════════════════
// DEFINIÇÃO DAS TOOLS
// ═══════════════════════════════════════════════════════════
const tools = [
  // ─────────────────────────────────────────────────────────
  // BUSCA / DADOS EXTERNOS
  // ─────────────────────────────────────────────────────────
  {
    name: "web_search",
    description: `Pesquisa informação atual na web. IMPORTANTE: hoje é ${getCurrentDateInfo().full}. Usa sempre que precisares de informação recente. Nunca inventes resultados.`,
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "search_images",
    description: "Pesquisa imagens reais na web via Serper. Devolve array de imagens (url, título, origem) para exibir em carrossel.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "search_videos",
    description: "Pesquisa vídeos reais na web via Serper (YouTube e outras plataformas indexadas). Devolve título, link, duração, canal e thumbnail.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  },
  {
    name: "download_image_for_project",
    description: "Descarrega uma imagem real (URL direto ou pesquisa) e devolve em base64 pronta para anexar a um projeto/documento/zip.",
    input_schema: {
      type: "object",
      properties: {
        query_or_url: { type: "string" },
        target_filename: { type: "string" }
      },
      required: ["query_or_url"]
    }
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
    description: "Obtém o clima atual de uma cidade e gera um card visual PNG.",
    input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
  },

  // ─────────────────────────────────────────────────────────
  // GERAÇÃO DE IMAGEM
  // ─────────────────────────────────────────────────────────
  {
    name: "generate_chart",
    description: "Gera um gráfico REAL (Chart.js) como PNG base64. Suporta line, bar, pie, doughnut, radar, polarArea, scatter, bubble.",
    input_schema: {
      type: "object",
      properties: {
        chart_type: { type: "string", enum: ["line", "bar", "pie", "doughnut", "radar", "polarArea", "scatter", "bubble"] },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        datasets: { type: "array", items: { type: "object", properties: { label: { type: "string" }, data: { type: "array", items: { type: "number" } }, color: { type: "string" } } } }
      },
      required: ["chart_type", "labels", "datasets"]
    }
  },
  {
    name: "generate_function_plot",
    description: "Gera o gráfico REAL de uma função matemática avaliando ponto a ponto num intervalo.",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string" },
        x_min: { type: "number" },
        x_max: { type: "number" },
        title: { type: "string" },
        highlight_roots: { type: "boolean" }
      },
      required: ["expression"]
    }
  },
  {
    name: "generate_mindmap",
    description: "Gera um mapa mental hierárquico como PNG base64.",
    input_schema: {
      type: "object",
      properties: { root: { type: "object", properties: { label: { type: "string" }, children: { type: "array", items: { type: "object" } } } } },
      required: ["root"]
    }
  },
  {
    name: "generate_qrcode",
    description: "Gera um QR code como PNG base64.",
    input_schema: { type: "object", properties: { content: { type: "string" }, size: { type: "number" } }, required: ["content"] }
  },
  {
    name: "generate_barcode",
    description: "Gera um código de barras como PNG base64.",
    input_schema: { type: "object", properties: { content: { type: "string" }, format: { type: "string", enum: ["code128", "ean13", "ean8", "upca", "qrcode"] } }, required: ["content"] }
  },
  {
    name: "generate_math",
    description: "Avalia uma expressão matemática pontual e gera imagem visual com o resultado.",
    input_schema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] }
  },
  {
    name: "generate_table_image",
    description: "Gera uma tabela complexa como PNG base64.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } },
      required: ["headers", "rows"]
    }
  },
  {
    name: "generate_html_image",
    description: "Converte HTML+CSS real em PNG base64 usando satori (motor de layout, sem browser). Suporta background/gradient, border-radius, box-shadow parcial, flexbox com gap, tipografia, cores. NÃO suporta grid, position:absolute complexo, filter/backdrop-filter, pseudo-elementos, nem <script> (JS não executa — se precisares de valores calculados, calcula em Node antes e injeta no HTML como texto estático). Regra satori: qualquer elemento com mais de um filho direto precisa de display:flex explícito no style.",
    input_schema: {
      type: "object",
      properties: { html: { type: "string" }, width: { type: "number" }, height: { type: "number" } },
      required: ["html"]
    }
  },
  {
    name: "generate_letter_card_svg",
    description: "Gera um cartão de letra/sílaba estilo Duolingo: cor HSL, tipografia grande, para apps educacionais de literacia.",
    input_schema: {
      type: "object",
      properties: { letter_or_syllable: { type: "string" }, hue: { type: "number", description: "0-360, opcional — se omitido usa color_from_letter_seed internamente" }, size: { type: "number" } },
      required: ["letter_or_syllable"]
    }
  },
  {
    name: "generate_color_scheme",
    description: "Gera uma paleta completa light/dark a partir de 1 cor base (hex), com tokens tipo AppColorScheme: primary, secondary, background, surface, text, em ambos os modos.",
    input_schema: { type: "object", properties: { base_color_hex: { type: "string" } }, required: ["base_color_hex"] }
  },
  {
    name: "generate_random_avatar",
    description: "Gera um avatar geométrico determinístico (estilo identicon) a partir de uma seed (ex: user id ou email).",
    input_schema: { type: "object", properties: { seed: { type: "string" }, size: { type: "number" } }, required: ["seed"] }
  },
  {
    name: "generate_memory_game_grid",
    description: "Dado N pares de itens (ids/labels), devolve o layout embaralhado de grelha para um jogo da memória (posições + colunas ideais).",
    input_schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } }, columns: { type: "number" } }, required: ["items"] }
  },

  // ─────────────────────────────────────────────────────────
  // DOCUMENTOS
  // ─────────────────────────────────────────────────────────
  {
    name: "create_pdf",
    description: "Gera um PDF a partir de HTML rico, com estilo real (via satori→imagem full-page A4, resolução de ecrã). Pode incluir imagens reais e gráfico embutido.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        html_content: { type: "string" },
        image_urls: { type: "array", items: { type: "string" } },
        embed_chart: { type: "object", properties: { chart_type: { type: "string" }, labels: { type: "array", items: { type: "string" } }, datasets: { type: "array", items: { type: "object" } } } }
      },
      required: ["title", "html_content"]
    }
  },
  {
    name: "create_pdf_structured",
    description: "Gera um PDF bem formatado a partir de JSON descritivo (secções, blocos de texto, imagens, gráficos) — layout garantido, sem depender de parsing de HTML livre.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              paragraphs: { type: "array", items: { type: "string" } },
              bullet_list: { type: "array", items: { type: "string" } },
              image_url: { type: "string" },
              embed_chart: { type: "object" }
            }
          }
        }
      },
      required: ["title", "sections"]
    }
  },
  {
    name: "create_docx",
    description: "Gera um Word (.docx) a partir de HTML.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, html_content: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, embed_chart: { type: "object" } },
      required: ["title", "html_content"]
    }
  },
  {
    name: "create_xlsx",
    description: "Gera planilha Excel (.xlsx).",
    input_schema: { type: "object", properties: { sheet_name: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["headers", "rows"] }
  },
  {
    name: "create_pptx",
    description: "Gera PowerPoint (.pptx).",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, bullets: { type: "array", items: { type: "string" } } } } } },
      required: ["title", "slides"]
    }
  },
  {
    name: "create_project_zip",
    description: "Cria um projeto completo como ZIP, com estrutura de pastas e múltiplos ficheiros de qualquer extensão (código, texto, config).",
    input_schema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
        image_urls_to_include: { type: "array", items: { type: "object", properties: { url: { type: "string" }, path: { type: "string" } } } }
      },
      required: ["project_name", "files"]
    }
  },

  // ─────────────────────────────────────────────────────────
  // LEITURA DE FICHEIROS ENVIADOS
  // ─────────────────────────────────────────────────────────
  {
    name: "read_zip_contents",
    description: `Lê ZIP enviado. Limite: ${ZIP_MAX_BYTES / (1024*1024)}MB, ${ZIP_MAX_FILES} ficheiros, ${ZIP_TEXT_TRUNCATE} chars/ficheiro texto, até ${ZIP_MAX_IMAGES} imagens.`,
    input_schema: { type: "object", properties: { zip_base64: { type: "string" } }, required: ["zip_base64"] }
  },
  {
    name: "read_pdf_contents",
    description: `Extrai texto de PDF por página, até ${PDF_MAX_PAGES_TEXT} páginas.`,
    input_schema: { type: "object", properties: { pdf_base64: { type: "string" } }, required: ["pdf_base64"] }
  },
  {
    name: "extract_document_outline",
    description: "Extrai só a estrutura de headings de um PDF (via texto) — útil para gerar índice/navegação.",
    input_schema: { type: "object", properties: { pdf_base64: { type: "string" }, source_type: { type: "string", enum: ["pdf"] } }, required: ["pdf_base64", "source_type"] }
  },

  // ─────────────────────────────────────────────────────────
  // CONVERSÃO
  // ─────────────────────────────────────────────────────────
  {
    name: "csv_to_xlsx",
    description: "Converte CSV em Excel (.xlsx).",
    input_schema: { type: "object", properties: { csv_content: { type: "string" } }, required: ["csv_content"] }
  },
  {
    name: "json_transform",
    description: "Transforma array JSON de objetos em tabela (headers + rows).",
    input_schema: { type: "object", properties: { json_data: { type: "string" } }, required: ["json_data"] }
  },
  {
    name: "xlsx_to_json",
    description: "Converte planilha .xlsx enviada (base64) em array JSON de objetos, usando a primeira linha como headers.",
    input_schema: { type: "object", properties: { xlsx_base64: { type: "string" } }, required: ["xlsx_base64"] }
  },
  {
    name: "html_to_docx",
    description: "Converte HTML em Word (.docx).",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, filename: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_pdf",
    description: "Converte HTML em PDF com estilo real (via satori).",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_xlsx",
    description: "Converte HTML (com <table>) em Excel (.xlsx).",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, sheet_name: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_pptx",
    description: "Converte HTML em PowerPoint (.pptx).",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "docx_to_html",
    description: "Converte DOCX enviado (base64) em HTML editável, usando mammoth. [REQUER LIB 'mammoth' — ver topo do ficheiro]",
    input_schema: { type: "object", properties: { docx_base64: { type: "string" } }, required: ["docx_base64"] }
  },

  // ─────────────────────────────────────────────────────────
  // IMAGEM — utilitários
  // ─────────────────────────────────────────────────────────
  {
    name: "get_image_colors",
    description: "Extrai as cores dominantes de uma imagem (URL ou base64) e devolve paleta em hex.",
    input_schema: { type: "object", properties: { image_url: { type: "string" }, image_base64: { type: "string" }, num_colors: { type: "number" } } }
  },
  {
    name: "convert_image_format",
    description: "Converte uma imagem entre PNG/JPG/WebP/AVIF.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, target_format: { type: "string", enum: ["png", "jpg", "webp", "avif"] } }, required: ["image_base64", "target_format"] }
  },
  {
    name: "resize_image",
    description: "Redimensiona uma imagem para largura/altura dadas (mantém proporção se só uma for dada).",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, width: { type: "number" }, height: { type: "number" } }, required: ["image_base64"] }
  },
  {
    name: "crop_image",
    description: "Recorta uma região retangular de uma imagem.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, left: { type: "number" }, top: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, required: ["image_base64", "left", "top", "width", "height"] }
  },
  {
    name: "watermark_image",
    description: "Sobrepõe uma marca d'água (texto simples via satori) numa imagem base.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, watermark_text: { type: "string" }, position: { type: "string", enum: ["top-left", "top-right", "bottom-left", "bottom-right", "center"] } }, required: ["image_base64", "watermark_text"] }
  },
  {
    name: "image_metadata",
    description: "Lê dimensões, formato e metadados básicos de uma imagem sem descodificar todos os pixels.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" } }, required: ["image_base64"] }
  },
  {
    name: "vectorize_image",
    description: `Converte PNG em SVG vetorizado (colorido ou preto/transparente). Limite: ${VECTORIZE_MAX_DIMENSION}px na maior dimensão — imagens maiores devem ser redimensionadas primeiro com resize_image. [REQUER LIB 'potrace' — ver topo do ficheiro]`,
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, mode: { type: "string", enum: ["color", "black_transparent"] } }, required: ["image_base64"] }
  },
  {
    name: "ocr_extract_text",
    description: "Extrai texto de uma imagem (OCR) via tesseract.js. Suporta português e inglês. [REQUER LIB 'tesseract.js' — ver topo do ficheiro]",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, language: { type: "string", enum: ["por", "eng"] } }, required: ["image_base64"] }
  },
  {
    name: "pdf_to_images",
    description: "Rasteriza a primeira página de um PDF como PNG (via satori, renderização aproximada do texto extraído — não é rasterização pixel-perfect do PDF original).",
    input_schema: { type: "object", properties: { pdf_base64: { type: "string" }, max_pages: { type: "number" } }, required: ["pdf_base64"] }
  },
  {
    name: "pptx_to_images",
    description: "Gera preview visual de cada slide de um PPTX (limitado — extrai texto/estrutura via layout satori, não é renderização exata do PowerPoint).",
    input_schema: { type: "object", properties: { pptx_base64: { type: "string" } }, required: ["pptx_base64"] }
  },
  {
    name: "audio_duration_check",
    description: "Lê a duração de um ficheiro de áudio (mp3/wav/m4a) sem descodificar o áudio todo. [REQUER LIB 'music-metadata' — ver topo do ficheiro]",
    input_schema: { type: "object", properties: { audio_base64: { type: "string" } }, required: ["audio_base64"] }
  },

  // ─────────────────────────────────────────────────────────
  // UTILITÁRIOS DE TEXTO / DADOS
  // ─────────────────────────────────────────────────────────
  {
    name: "str_replace_file",
    description: "Aplica substituição exata de texto num ficheiro/conteúdo enviado. old_str deve corresponder a exatamente uma ocorrência. Devolve ficheiro completo corrigido.",
    input_schema: { type: "object", properties: { content: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" } }, required: ["content", "old_str", "new_str"] }
  },
  {
    name: "diff_text",
    description: "Compara duas versões de texto e devolve as diferenças (linhas adicionadas/removidas).",
    input_schema: { type: "object", properties: { text_before: { type: "string" }, text_after: { type: "string" } }, required: ["text_before", "text_after"] }
  },
  {
    name: "extract_urls_from_text",
    description: "Extrai todos os URLs presentes num texto.",
    input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  },
  {
    name: "format_markdown_to_html",
    description: "Converte markdown em HTML.",
    input_schema: { type: "object", properties: { markdown: { type: "string" } }, required: ["markdown"] }
  },
  {
    name: "count_tokens_estimate",
    description: "Estima o número de tokens de um texto (heurística, não é tokenizer exato de nenhum modelo específico).",
    input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  },
  {
    name: "text_summary_stats",
    description: "Devolve contagem de palavras, frases, parágrafos e tempo de leitura estimado de um texto.",
    input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  },
  {
    name: "text_to_syllables_pt",
    description: "Divide uma palavra em português nas suas sílabas (heurística de regras comuns — não cobre 100% dos casos irregulares).",
    input_schema: { type: "object", properties: { word: { type: "string" } }, required: ["word"] }
  },
  {
    name: "color_from_letter_seed",
    description: "Gera uma cor HSL determinística a partir de uma letra/sílaba/texto (mesma entrada = mesma cor sempre).",
    input_schema: { type: "object", properties: { seed: { type: "string" } }, required: ["seed"] }
  },
  {
    name: "youtube_thumbnail_extract",
    description: "Extrai thumbnail e metadata básica (título) de um vídeo do YouTube dado o URL, via oEmbed público — sem API key.",
    input_schema: { type: "object", properties: { youtube_url: { type: "string" } }, required: ["youtube_url"] }
  },
  {
    name: "merge_pdfs",
    description: "Junta múltiplos PDFs (base64) num único PDF, na ordem dada. [REQUER LIB 'pdf-lib' — ver topo do ficheiro]",
    input_schema: { type: "object", properties: { pdfs_base64: { type: "array", items: { type: "string" } } }, required: ["pdfs_base64"] }
  },
  {
    name: "split_pdf_pages",
    description: "Extrai um subconjunto de páginas de um PDF para um novo PDF. [REQUER LIB 'pdf-lib' — ver topo do ficheiro]",
    input_schema: { type: "object", properties: { pdf_base64: { type: "string" }, page_numbers: { type: "array", items: { type: "number" } } }, required: ["pdf_base64", "page_numbers"] }
  },
];

// ─────────────────────────────────────────────────────────
// TOOLS PESADAS — registadas mas só ficam utilizáveis com
// ENABLE_HEAVY_TOOLS=true. Ver runTool() para o bloqueio real.
// ─────────────────────────────────────────────────────────
tools.push(
  {
    name: "animate_html",
    description: "[REQUER ENABLE_HEAVY_TOOLS] Anima HTML+CSS ao longo do tempo e exporta como vídeo curto/longo (duração conforme timing do HTML). Requer motor de vídeo — indisponível no free tier.",
    input_schema: { type: "object", properties: { html: { type: "string" }, duration_seconds: { type: "number" } }, required: ["html", "duration_seconds"] }
  },
  {
    name: "generate_infographic",
    description: "[REQUER ENABLE_HEAVY_TOOLS] Gera infográfico com ícones e blocos organizados a partir de dados estruturados.",
    input_schema: { type: "object", properties: { title: { type: "string" }, blocks: { type: "array", items: { type: "object" } } }, required: ["title", "blocks"] }
  }
);

// ═══════════════════════════════════════════════════════════
// SATORI — helpers de fonte e conversão HTML→SVG→PNG
// ═══════════════════════════════════════════════════════════
function requireFonts() {
  if (!FONT_REGULAR || !FONT_BOLD) {
    throw new Error('Fontes Inter não encontradas em ./fonts/ — adiciona Inter-Regular.ttf e Inter-Bold.ttf ao repo.');
  }
}

async function htmlToSvgViaSatori(htmlString, width, height) {
  requireFonts();
  const tree = html(htmlString);
  const svg = await satori(tree, {
    width: width || 800,
    height: height || 600,
    fonts: [
      { name: 'Inter', data: FONT_REGULAR, weight: 400, style: 'normal' },
      { name: 'Inter', data: FONT_BOLD, weight: 700, style: 'normal' },
    ],
  });
  return svg;
}

async function svgToPngBuffer(svgString) {
  return await sharp(Buffer.from(svgString)).png().toBuffer();
}

// ═══════════════════════════════════════════════════════════
// GENERATE HTML IMAGE
// ═══════════════════════════════════════════════════════════
async function generateHtmlImageImpl(htmlContent, width, height) {
  try {
    const svg = await htmlToSvgViaSatori(htmlContent, width, height);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem HTML' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar imagem HTML: ${e.message}. Nota: cada nó com mais de 1 filho precisa de display:flex explícito.` };
  }
}

// ═══════════════════════════════════════════════════════════
// CREATE PDF — via satori→PNG full-page A4, resolução de ecrã
// ═══════════════════════════════════════════════════════════
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

async function generateChartImpl(chartType, title, labels, datasets) {
  try {
    const width = 800, height = 500;
    const chartCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });
    const palette = ['#4F46E5', '#06B6D4', '#F59E0B', '#EF4444', '#10B981', '#8B5CF6', '#EC4899', '#84CC16'];
    const config = {
      type: chartType,
      data: {
        labels: labels || [],
        datasets: (datasets || []).map((d, i) => ({
          label: d.label || `Série ${i + 1}`,
          data: d.data || [],
          backgroundColor: d.color || palette[i % palette.length],
          borderColor: d.color || palette[i % palette.length],
          borderWidth: 2,
          fill: chartType === 'radar' || chartType === 'polarArea',
        })),
      },
      options: {
        responsive: false,
        plugins: {
          title: { display: !!title, text: title || '', font: { size: 18 } },
          legend: { display: (datasets || []).length > 1 },
        },
      },
    };
    const buffer = await chartCanvas.renderToBuffer(config);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: title || `Gráfico ${chartType}` };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar gráfico: ${e.message}` };
  }
}

async function createPdfImpl(title, htmlContent, imageUrls, embedChart) {
  return new Promise(async (resolve) => {
    try {
      let bodyHtml = htmlContent || '';
      let extraImagesHtml = '';
      for (const url of (imageUrls || []).slice(0, 6)) {
        try {
          const { base64 } = await fetchImageAsBase64(url);
          extraImagesHtml += `<div style="display:flex; padding:8px 0;"><img src="data:image/png;base64,${base64}" style="max-width:100%; border-radius:8px;" /></div>`;
        } catch (_) {}
      }
      if (embedChart && embedChart.chart_type) {
        try {
          const chartResult = await generateChartImpl(embedChart.chart_type, embedChart.title, embedChart.labels, embedChart.datasets);
          if (chartResult.found) {
            extraImagesHtml += `<div style="display:flex; padding:8px 0;"><img src="data:image/png;base64,${chartResult.content_base64}" style="max-width:100%; border-radius:8px;" /></div>`;
          }
        } catch (_) {}
      }
      const fullHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:40px; background:white; font-family:Inter;">
        <div style="display:flex; font-size:22px; font-weight:700; color:#1a1a1a; padding-bottom:16px;">${escapeHtml(title || 'Documento')}</div>
        <div style="display:flex; flex-direction:column; font-size:13px; color:#333;">${bodyHtml}</div>
        ${extraImagesHtml}
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

async function createPdfStructuredImpl(title, sections) {
  try {
    let bodyHtml = '';
    for (const sec of (sections || [])) {
      if (sec.heading) bodyHtml += `<div style="display:flex; font-size:16px; font-weight:700; color:#1a1a1a; padding:14px 0 6px 0;">${escapeHtml(sec.heading)}</div>`;
      for (const p of (sec.paragraphs || [])) bodyHtml += `<div style="display:flex; font-size:12.5px; color:#333; padding-bottom:6px; line-height:1.5;">${escapeHtml(p)}</div>`;
      if (sec.bullet_list && sec.bullet_list.length > 0) {
        bodyHtml += `<div style="display:flex; flex-direction:column; padding:4px 0 8px 0;">`;
        for (const item of sec.bullet_list) bodyHtml += `<div style="display:flex; font-size:12.5px; color:#333; padding-bottom:3px;">•  ${escapeHtml(item)}</div>`;
        bodyHtml += `</div>`;
      }
      if (sec.image_url) {
        try {
          const { base64 } = await fetchImageAsBase64(sec.image_url);
          bodyHtml += `<div style="display:flex; padding:8px 0;"><img src="data:image/png;base64,${base64}" style="max-width:100%; border-radius:8px;" /></div>`;
        } catch (_) {}
      }
      if (sec.embed_chart && sec.embed_chart.chart_type) {
        try {
          const chartResult = await generateChartImpl(sec.embed_chart.chart_type, sec.embed_chart.title, sec.embed_chart.labels, sec.embed_chart.datasets);
          if (chartResult.found) bodyHtml += `<div style="display:flex; padding:8px 0;"><img src="data:image/png;base64,${chartResult.content_base64}" style="max-width:100%; border-radius:8px;" /></div>`;
        } catch (_) {}
      }
    }
    return await createPdfImpl(title, bodyHtml, [], null);
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
      } catch (_) {}
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
    sheet.getRow(1).font = { bold: true };
    (rows || []).forEach(r => sheet.addRow(r));
    sheet.columns.forEach(col => { col.width = 18; });
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

// ═══════════════════════════════════════════════════════════
// BUSCA / DADOS EXTERNOS — implementações
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
    const answerBox = data.answerBox ? { title: data.answerBox.title, answer: data.answerBox.answer || data.answerBox.snippet } : null;
    const organic = (data.organic || []).slice(0, 8).map(o => ({ title: o.title, link: o.link, snippet: o.snippet }));
    if (!answerBox && organic.length === 0) return { found: false, reason: `Nenhum resultado para "${trimmed}".` };
    return { found: true, query: trimmed, answer_box: answerBox, results: organic };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa: ${e.message}` };
  }
}

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
    const images = (data.images || []).slice(0, 10).map(img => ({
      title: img.title || '', url: img.imageUrl || '', thumbnailUrl: img.thumbnailUrl || img.imageUrl || '', source: img.source || '',
    })).filter(img => !!img.url);
    if (images.length === 0) return { found: false, reason: `Nenhuma imagem encontrada para "${trimmed}".` };
    return { found: true, query: trimmed, images };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de imagens: ${e.message}` };
  }
}

async function searchVideosImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  if (!SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada no servidor." };
  try {
    const r = await fetch('https://google.serper.dev/videos', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmed, gl: 'pt', hl: 'pt' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { found: false, reason: `Serper devolveu ${r.status}` };
    const data = await r.json();
    if (!data.videos) console.error('[search_videos] campo "videos" ausente na resposta Serper:', JSON.stringify(data).slice(0, 500));
    const videos = (data.videos || []).slice(0, 10).map(v => ({
      title: v.title || '', link: v.link || '', thumbnailUrl: v.imageUrl || '',
      channel: v.channel || v.source || '', duration: v.duration || null, date: v.date || null,
    })).filter(v => !!v.link);
    if (videos.length === 0) return { found: false, reason: `Nenhum vídeo encontrado para "${trimmed}".` };
    return { found: true, query: trimmed, videos };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de vídeos: ${e.message}` };
  }
}

async function downloadImageForProjectImpl(queryOrUrl, targetFilename) {
  const trimmed = (queryOrUrl || '').trim();
  if (!trimmed) return { found: false, reason: "query_or_url vazio" };
  try {
    let finalUrl = trimmed;
    if (!/^https?:\/\//i.test(trimmed)) {
      const searchResult = await searchImagesImpl(trimmed);
      if (!searchResult.found || searchResult.images.length === 0) return { found: false, reason: `Nenhuma imagem encontrada para "${trimmed}".` };
      finalUrl = searchResult.images[0].url;
    }
    const { base64, mimeType } = await fetchImageAsBase64(finalUrl);
    return { found: true, content_base64: base64, mime_type: mimeType, filename: targetFilename || 'imagem.png', source_url: finalUrl, label: targetFilename || 'Imagem descarregada' };
  } catch (e) {
    return { found: false, reason: `Erro ao descarregar imagem: ${e.message}` };
  }
}

async function searchMarketImpl(query) {
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
    if (data.answerBox) return { found: true, query: trimmed, value: data.answerBox.answer || data.answerBox.snippet, title: data.answerBox.title };
    const organic = (data.organic || []).slice(0, 3).map(o => ({ title: o.title, snippet: o.snippet }));
    if (organic.length === 0) return { found: false, reason: `Nenhum dado de mercado para "${trimmed}".` };
    return { found: true, query: trimmed, results: organic };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de mercado: ${e.message}` };
  }
}

async function searchPlaceImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'nexa-tools-api/2.1.0' }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { found: false, reason: `Nominatim devolveu ${r.status}` };
    const data = await r.json();
    if (!data || data.length === 0) return { found: false, reason: `Local "${trimmed}" não encontrado.` };
    const place = data[0];
    return { found: true, query: trimmed, name: place.display_name, latitude: parseFloat(place.lat), longitude: parseFloat(place.lon), type: place.type || null };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de local: ${e.message}` };
  }
}

function searchCalendarDateImpl(query) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  const now = new Date();
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const toIso = (d) => d.toISOString().split('T')[0];
  const map = {
    'hoje': now, 'amanhã': addDays(now, 1), 'amanha': addDays(now, 1),
    'ontem': addDays(now, -1), 'depois de amanhã': addDays(now, 2), 'depois de amanha': addDays(now, 2),
    'daqui a uma semana': addDays(now, 7), 'próxima semana': addDays(now, 7), 'proxima semana': addDays(now, 7),
  };
  for (const key in map) {
    if (trimmed.includes(key)) return { found: true, query: trimmed, resolved_date_iso: toIso(map[key]) };
  }
  const isoMatch = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return { found: true, query: trimmed, resolved_date_iso: isoMatch[0] };
  return { found: false, reason: `Não consegui resolver a data "${trimmed}" — tenta formato ISO (AAAA-MM-DD) ou termos como "hoje"/"amanhã".` };
}

async function getWeatherImpl(city) {
  const trimmed = (city || '').trim();
  if (!trimmed) return { found: false, reason: "Cidade vazia" };
  try {
    const geoR = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=pt`, { signal: AbortSignal.timeout(10000) });
    const geoData = await geoR.json();
    if (!geoData.results || geoData.results.length === 0) return { found: false, reason: `Cidade "${trimmed}" não encontrada.` };
    const loc = geoData.results[0];
    const wR = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`, { signal: AbortSignal.timeout(10000) });
    const wData = await wR.json();
    if (!wData.current) return { found: false, reason: "Resposta de clima inválida." };
    const weatherLabels = {
      0: 'Céu limpo', 1: 'Maioritariamente limpo', 2: 'Parcialmente nublado', 3: 'Nublado',
      45: 'Nevoeiro', 48: 'Nevoeiro com geada', 51: 'Chuvisco leve', 53: 'Chuvisco', 55: 'Chuvisco denso',
      61: 'Chuva leve', 63: 'Chuva', 65: 'Chuva forte', 71: 'Neve leve', 73: 'Neve', 75: 'Neve forte',
      80: 'Aguaceiros', 95: 'Trovoada', 96: 'Trovoada com granizo',
    };
    const code = wData.current.weather_code;
    const label = weatherLabels[code] || 'Condição desconhecida';
    const cardHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:linear-gradient(135deg,#4F46E5,#06B6D4); font-family:Inter; color:white;">
      <div style="display:flex; font-size:20px; font-weight:700;">${escapeHtml(loc.name)}</div>
      <div style="display:flex; font-size:56px; font-weight:700; padding:16px 0;">${Math.round(wData.current.temperature_2m)}°C</div>
      <div style="display:flex; font-size:16px;">${escapeHtml(label)}</div>
      <div style="display:flex; font-size:13px; padding-top:12px; opacity:0.9;">Humidade: ${wData.current.relative_humidity_2m}% · Vento: ${Math.round(wData.current.wind_speed_10m)} km/h</div>
    </div>`;
    let cardImage = null;
    try {
      const svg = await htmlToSvgViaSatori(cardHtml, 400, 260);
      const buffer = await svgToPngBuffer(svg);
      cardImage = buffer.toString('base64');
    } catch (_) {}
    return {
      found: true, city: loc.name, temperature_c: wData.current.temperature_2m, condition: label,
      humidity_percent: wData.current.relative_humidity_2m, wind_kmh: wData.current.wind_speed_10m,
      content_base64: cardImage, mime_type: cardImage ? 'image/png' : null, label: `Clima em ${loc.name}`,
    };
  } catch (e) {
    return { found: false, reason: `Erro ao obter clima: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// GERAÇÃO DE IMAGEM — implementações
// ═══════════════════════════════════════════════════════════
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
    const chartResult = await generateChartImpl('line', title || `f(x) = ${expression}`, labels, [{ label: expression, data: values, color: '#4F46E5' }]);
    if (!chartResult.found) return chartResult;
    return { ...chartResult, roots_approx: highlightRoots ? roots : undefined };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar gráfico da função: ${e.message}` };
  }
}

async function generateMindmapImpl(root) {
  try {
    if (!root || !root.label) return { found: false, reason: "root.label é obrigatório." };
    function renderNode(node, depth) {
      const childrenHtml = (node.children || []).map(c => renderNode(c, depth + 1)).join('');
      const bg = depth === 0 ? '#4F46E5' : depth === 1 ? '#06B6D4' : '#94A3B8';
      return `<div style="display:flex; flex-direction:column; align-items:flex-start; margin-left:${depth * 24}px;">
        <div style="display:flex; background:${bg}; color:white; padding:8px 14px; border-radius:8px; font-size:${Math.max(12, 18 - depth * 2)}px; font-weight:700; margin-bottom:6px;">${escapeHtml(node.label || '')}</div>
        ${childrenHtml ? `<div style="display:flex; flex-direction:column;">${childrenHtml}</div>` : ''}
      </div>`;
    }
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:24px; background:white; font-family:Inter;">${renderNode(root, 0)}</div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, 900, 700);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `Mapa mental: ${root.label}` };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar mapa mental: ${e.message}` };
  }
}

async function generateQrcodeImpl(content, size) {
  try {
    if (!content) return { found: false, reason: "content vazio." };
    const buffer = await QRCode.toBuffer(content, { width: size || 400, margin: 1 });
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

async function generateMathImpl(expression) {
  try {
    if (!expression) return { found: false, reason: "expression vazia." };
    let result;
    try { result = math.evaluate(expression); } catch (e) { return { found: false, reason: `Expressão inválida: ${e.message}` }; }
    const resultStr = typeof result === 'number' ? (Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : result.toString();
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:white; font-family:Inter; align-items:center; justify-content:center;">
      <div style="display:flex; font-size:20px; color:#666;">${escapeHtml(expression)}</div>
      <div style="display:flex; font-size:48px; font-weight:700; color:#1a1a1a; padding-top:12px;">= ${escapeHtml(resultStr)}</div>
    </div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, 600, 300);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `${expression} = ${resultStr}`, result: resultStr };
  } catch (e) {
    return { found: false, reason: `Erro ao calcular expressão: ${e.message}` };
  }
}

async function generateTableImageImpl(title, headers, rows) {
  try {
    if (!headers || headers.length === 0) return { found: false, reason: "headers vazio." };
    const headerCellsHtml = headers.map(h => `<div style="display:flex; flex:1; padding:10px 12px; font-weight:700; font-size:13px; color:white;">${escapeHtml(h)}</div>`).join('');
    const rowsHtml = (rows || []).map((row, i) => `<div style="display:flex; background:${i % 2 === 0 ? '#F8FAFC' : '#FFFFFF'};">
      ${row.map(cell => `<div style="display:flex; flex:1; padding:9px 12px; font-size:12px; color:#333;">${escapeHtml(cell)}</div>`).join('')}
    </div>`).join('');
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; background:white; font-family:Inter; border-radius:8px; overflow:hidden;">
      ${title ? `<div style="display:flex; padding:14px 16px; font-size:16px; font-weight:700; color:#1a1a1a; background:#F1F5F9;">${escapeHtml(title)}</div>` : ''}
      <div style="display:flex; background:#4F46E5;">${headerCellsHtml}</div>
      <div style="display:flex; flex-direction:column;">${rowsHtml}</div>
    </div>`;
    const width = Math.min(1200, Math.max(500, headers.length * 160));
    const height = 60 + (title ? 44 : 0) + (rows || []).length * 40;
    const svg = await htmlToSvgViaSatori(bodyHtml, width, height);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: title || 'Tabela' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar tabela: ${e.message}` };
  }
}

function colorFromLetterSeedImpl(seed) {
  const trimmed = (seed || '').toString();
  if (!trimmed) return { found: false, reason: "seed vazio." };
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) { hash = trimmed.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; }
  const hue = Math.abs(hash) % 360;
  return { found: true, seed: trimmed, hue, hsl: `hsl(${hue}, 70%, 55%)`, hsl_light: `hsl(${hue}, 70%, 90%)`, hsl_dark: `hsl(${hue}, 60%, 35%)` };
}

async function generateLetterCardSvgImpl(letterOrSyllable, hue, size) {
  try {
    if (!letterOrSyllable) return { found: false, reason: "letter_or_syllable vazio." };
    const resolvedHue = typeof hue === 'number' ? hue : colorFromLetterSeedImpl(letterOrSyllable).hue;
    const s = size || 300;
    const bodyHtml = `<div style="display:flex; width:${s}px; height:${s}px; background:hsl(${resolvedHue}, 70%, 55%); border-radius:24px; align-items:center; justify-content:center; font-family:Inter;">
      <div style="display:flex; font-size:${Math.round(s * 0.5)}px; font-weight:700; color:white;">${escapeHtml(letterOrSyllable)}</div>
    </div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, s, s);
    const buffer = await svgToPngBuffer(svg);
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `Cartão: ${letterOrSyllable}`, hue: resolvedHue };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar cartão de letra: ${e.message}` };
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

async function generateRandomAvatarImpl(seed, size) {
  try {
    const trimmed = (seed || '').toString();
    if (!trimmed) return { found: false, reason: "seed vazio." };
    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) { hash = trimmed.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; }
    const rand = (i) => { const x = Math.sin(hash + i) * 10000; return x - Math.floor(x); };
    const hue = Math.abs(hash) % 360;
    const s = size || 200;
    const cell = s / 5;
    let rects = '';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (rand(row * 3 + col) > 0.5) {
          const mirrorCol = 4 - col;
          rects += `<rect x="${col * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="hsl(${hue},65%,55%)" />`;
          if (mirrorCol !== col) rects += `<rect x="${mirrorCol * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="hsl(${hue},65%,55%)" />`;
        }
      }
    }
    const svgContent = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg"><rect width="${s}" height="${s}" fill="#F1F5F9"/>${rects}</svg>`;
    const buffer = await sharp(Buffer.from(svgContent)).png().toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: `Avatar: ${trimmed}`, hue };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar avatar: ${e.message}` };
  }
}

function generateMemoryGameGridImpl(items, columns) {
  if (!items || items.length === 0) return { found: false, reason: "items vazio." };
  const pairs = items.flatMap(item => [item, item]);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const cols = columns || Math.ceil(Math.sqrt(pairs.length));
  const grid = pairs.map((item, i) => ({ item, position: i, row: Math.floor(i / cols), col: i % cols }));
  return { found: true, total_cards: pairs.length, columns: cols, rows: Math.ceil(pairs.length / cols), grid };
}

// ═══════════════════════════════════════════════════════════
// LEITURA DE FICHEIROS — implementações
// ═══════════════════════════════════════════════════════════
async function readZipContentsImpl(zipBase64) {
  try {
    if (!zipBase64) return { found: false, reason: "zip_base64 vazio." };
    const buffer = Buffer.from(zipBase64, 'base64');
    if (buffer.length > ZIP_MAX_BYTES) return { found: false, reason: `ZIP excede o limite de ${ZIP_MAX_BYTES / (1024 * 1024)}MB.` };
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory).slice(0, ZIP_MAX_FILES);
    const files = [];
    let imageCount = 0;
    for (const entry of entries) {
      const ext = extOf(entry.entryName);
      if (IMAGE_EXTENSIONS.has(ext) && imageCount < ZIP_MAX_IMAGES) {
        const data = entry.getData();
        if (data.length <= ZIP_IMAGE_MAX_BYTES) {
          files.push({ path: entry.entryName, type: 'image', mime_type: mimeForImageExt(ext), content_base64: data.toString('base64'), size_bytes: data.length });
          imageCount++;
          continue;
        }
      }
      if (TEXT_EXTENSIONS.has(ext)) {
        const text = entry.getData().toString('utf8');
        files.push({ path: entry.entryName, type: 'text', content: text.slice(0, ZIP_TEXT_TRUNCATE), truncated: text.length > ZIP_TEXT_TRUNCATE, size_bytes: entry.header.size });
        continue;
      }
      files.push({ path: entry.entryName, type: 'binary', size_bytes: entry.header.size, note: 'Conteúdo não incluído (tipo binário não suportado ou imagem grande demais).' });
    }
    return { found: true, total_entries: zip.getEntries().length, files_read: files.length, files };
  } catch (e) {
    return { found: false, reason: `Erro ao ler ZIP: ${e.message}` };
  }
}

async function readPdfContentsImpl(pdfBase64) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    const buffer = Buffer.from(pdfBase64, 'base64');
    const data = await pdfParse(buffer);
    const numPages = data.numpages || 1;
    if (numPages > PDF_MAX_PAGES_TEXT) {
      return { found: true, total_pages: numPages, note: `PDF tem ${numPages} páginas — acima do limite de ${PDF_MAX_PAGES_TEXT}, a devolver só o texto concatenado sem separação por página.`, text: data.text.slice(0, 60000) };
    }
    return { found: true, total_pages: numPages, text: data.text, info: data.info || null };
  } catch (e) {
    return { found: false, reason: `Erro ao ler PDF: ${e.message}` };
  }
}

async function extractDocumentOutlineImpl(pdfBase64) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    const buffer = Buffer.from(pdfBase64, 'base64');
    const data = await pdfParse(buffer);
    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);
    const headings = lines.filter(l => l.length < 90 && (l === l.toUpperCase() || /^\d+(\.\d+)*\s+\S/.test(l))).slice(0, 60);
    return { found: true, total_pages: data.numpages || 1, headings_guess: headings, note: 'Heurística baseada em texto extraído — pode incluir falsos positivos/negativos, o PDF não tem marcação estrutural real de headings.' };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair esquema: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// CONVERSÃO — implementações
// ═══════════════════════════════════════════════════════════
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
  if (!mammoth) return { found: false, reason: "Lib 'mammoth' não instalada — adiciona ao package.json e faz npm install." };
  try {
    if (!docxBase64) return { found: false, reason: "docx_base64 vazio." };
    const buffer = Buffer.from(docxBase64, 'base64');
    const result = await mammoth.convertToHtml({ buffer });
    return { found: true, html: result.value, warnings: (result.messages || []).map(m => m.message) };
  } catch (e) {
    return { found: false, reason: `Erro ao converter DOCX→HTML: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// IMAGEM — utilitários — implementações
// ═══════════════════════════════════════════════════════════
async function resolveImageBuffer(imageBase64, imageUrl) {
  if (imageBase64) return Buffer.from(imageBase64, 'base64');
  if (imageUrl) { const { buffer } = await fetchImageAsBase64(imageUrl); return buffer; }
  throw new Error('Fornece image_base64 ou image_url.');
}

async function getImageColorsImpl(imageUrl, imageBase64, numColors) {
  try {
    const buffer = await resolveImageBuffer(imageBase64, imageUrl);
    const n = Math.min(Math.max(numColors || 5, 1), 10);
    const { data, info } = await sharp(buffer).resize(50, 50, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const counts = new Map();
    for (let i = 0; i < data.length; i += channels) {
      const r = Math.round(data[i] / 32) * 32, g = Math.round(data[i + 1] / 32) * 32, b = Math.round(data[i + 2] / 32) * 32;
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
    const toHex = (v) => Math.min(255, v).toString(16).padStart(2, '0');
    const colors = sorted.map(([key]) => { const [r, g, b] = key.split(',').map(Number); return `#${toHex(r)}${toHex(g)}${toHex(b)}`; });
    return { found: true, dominant_colors: colors };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair cores: ${e.message}` };
  }
}

async function convertImageFormatImpl(imageBase64, targetFormat) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    let pipeline = sharp(Buffer.from(imageBase64, 'base64'));
    if (targetFormat === 'jpg') pipeline = pipeline.jpeg({ quality: 90 });
    else if (targetFormat === 'webp') pipeline = pipeline.webp({ quality: 90 });
    else if (targetFormat === 'avif') pipeline = pipeline.avif({ quality: 80 });
    else pipeline = pipeline.png();
    const buffer = await pipeline.toBuffer();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
    return { found: true, content_base64: buffer.toString('base64'), mime_type: mimeMap[targetFormat] || 'image/png', label: `Imagem convertida (.${targetFormat})` };
  } catch (e) {
    return { found: false, reason: `Erro ao converter formato: ${e.message}` };
  }
}

async function resizeImageImpl(imageBase64, width, height) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    if (!width && !height) return { found: false, reason: "Fornece pelo menos width ou height." };
    const buffer = await sharp(Buffer.from(imageBase64, 'base64')).resize(width || null, height || null, { fit: 'inside' }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', width: meta.width, height: meta.height, label: 'Imagem redimensionada' };
  } catch (e) {
    return { found: false, reason: `Erro ao redimensionar: ${e.message}` };
  }
}

async function cropImageImpl(imageBase64, left, top, width, height) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = await sharp(Buffer.from(imageBase64, 'base64')).extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) }).png().toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem recortada' };
  } catch (e) {
    return { found: false, reason: `Erro ao recortar imagem: ${e.message}. Confirma que a região (left/top/width/height) cabe dentro das dimensões reais da imagem.` };
  }
}

async function watermarkImageImpl(imageBase64, watermarkText, position) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    if (!watermarkText) return { found: false, reason: "watermark_text vazio." };
    const baseBuffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(baseBuffer).metadata();
    const pos = position || 'bottom-right';
    const align = pos.includes('left') ? 'flex-start' : pos.includes('right') ? 'flex-end' : 'center';
    const justify = pos.includes('top') ? 'flex-start' : pos.includes('bottom') ? 'flex-end' : 'center';
    const overlayHtml = `<div style="display:flex; width:${meta.width}px; height:${meta.height}px; align-items:${justify}; justify-content:${align}; padding:20px;">
      <div style="display:flex; background:rgba(0,0,0,0.45); color:white; padding:6px 12px; border-radius:6px; font-size:${Math.max(12, Math.round(meta.width / 40))}px; font-family:Inter;">${escapeHtml(watermarkText)}</div>
    </div>`;
    const svg = await htmlToSvgViaSatori(overlayHtml, meta.width, meta.height);
    const overlayBuffer = await svgToPngBuffer(svg);
    const buffer = await sharp(baseBuffer).composite([{ input: overlayBuffer, top: 0, left: 0 }]).png().toBuffer();
    return { found: true, content_base64: buffer.toString('base64'), mime_type: 'image/png', label: 'Imagem com marca d\'água' };
  } catch (e) {
    return { found: false, reason: `Erro ao aplicar marca d'água: ${e.message}` };
  }
}

async function imageMetadataImpl(imageBase64) {
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(buffer).metadata();
    return { found: true, format: meta.format, width: meta.width, height: meta.height, has_alpha: !!meta.hasAlpha, size_bytes: buffer.length, color_space: meta.space || null };
  } catch (e) {
    return { found: false, reason: `Erro ao ler metadados: ${e.message}` };
  }
}

async function vectorizeImageImpl(imageBase64, mode) {
  if (!potrace) return { found: false, reason: "Lib 'potrace' não instalada — adiciona ao package.json e faz npm install." };
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = Buffer.from(imageBase64, 'base64');
    const meta = await sharp(buffer).metadata();
    if (Math.max(meta.width || 0, meta.height || 0) > VECTORIZE_MAX_DIMENSION) {
      return { found: false, reason: `Imagem excede ${VECTORIZE_MAX_DIMENSION}px na maior dimensão — usa resize_image primeiro.` };
    }
    const pngBuffer = await sharp(buffer).png().toBuffer();
    const svg = await new Promise((resolve, reject) => {
      const TraceClass = mode === 'color' ? potrace.Posterizer : potrace.Potrace;
      const tracer = new TraceClass();
      tracer.loadImage(pngBuffer, (err) => {
        if (err) return reject(err);
        tracer.getSVG((err2, svgStr) => { if (err2) reject(err2); else resolve(svgStr); });
      });
    });
    return { found: true, svg, label: `Vetorizado (${mode || 'black_transparent'})` };
  } catch (e) {
    return { found: false, reason: `Erro ao vetorizar imagem: ${e.message}` };
  }
}

async function ocrExtractTextImpl(imageBase64, language) {
  if (!Tesseract) return { found: false, reason: "Lib 'tesseract.js' não instalada — adiciona ao package.json e faz npm install." };
  try {
    if (!imageBase64) return { found: false, reason: "image_base64 vazio." };
    const buffer = Buffer.from(imageBase64, 'base64');
    const lang = language === 'eng' ? 'eng' : 'por';
    const { data } = await Tesseract.recognize(buffer, lang);
    return { found: true, text: (data.text || '').trim(), confidence: data.confidence || null };
  } catch (e) {
    return { found: false, reason: `Erro no OCR: ${e.message}` };
  }
}

async function pdfToImagesImpl(pdfBase64, maxPages) {
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    const buffer = Buffer.from(pdfBase64, 'base64');
    const data = await pdfParse(buffer);
    const firstPageText = data.text.split('\f')[0] || data.text.slice(0, 1500);
    const escapedLines = escapeHtml(firstPageText.slice(0, 1200)).split('\n').slice(0, 30).map(l => `<div style="display:flex; font-size:11px; color:#333; padding-bottom:2px;">${l || '&nbsp;'}</div>`).join('');
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:24px; background:white; font-family:Inter;">${escapedLines}</div>`;
    const svg = await htmlToSvgViaSatori(bodyHtml, A4_WIDTH_PX, A4_HEIGHT_PX);
    const pngBuffer = await svgToPngBuffer(svg);
    return {
      found: true, total_pages: data.numpages || 1, pages_rendered: 1,
      note: 'Preview aproximado da primeira página (texto extraído reformatado via satori) — não é rasterização pixel-perfect do PDF original.',
      images: [{ page: 1, content_base64: pngBuffer.toString('base64'), mime_type: 'image/png' }],
    };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar preview do PDF: ${e.message}` };
  }
}

async function pptxToImagesImpl(pptxBase64) {
  try {
    if (!pptxBase64) return { found: false, reason: "pptx_base64 vazio." };
    const buffer = Buffer.from(pptxBase64, 'base64');
    const zip = new AdmZip(buffer);
    const slideEntries = zip.getEntries().filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName)).sort((a, b) => {
      const na = parseInt(a.entryName.match(/\d+/)[0]), nb = parseInt(b.entryName.match(/\d+/)[0]);
      return na - nb;
    });
    if (slideEntries.length === 0) return { found: false, reason: "Nenhum slide encontrado no PPTX." };
    const images = [];
    for (let i = 0; i < Math.min(slideEntries.length, 15); i++) {
      const xml = slideEntries[i].getData().toString('utf8');
      const textMatches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, '')).filter(Boolean);
      const linesHtml = texts.slice(0, 12).map((t, idx) => `<div style="display:flex; font-size:${idx === 0 ? 22 : 14}px; font-weight:${idx === 0 ? 700 : 400}; color:#1a1a1a; padding-bottom:8px;">${escapeHtml(t)}</div>`).join('');
      const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:white; font-family:Inter;">${linesHtml}</div>`;
      try {
        const svg = await htmlToSvgViaSatori(bodyHtml, 960, 540);
        const pngBuffer = await svgToPngBuffer(svg);
        images.push({ slide: i + 1, content_base64: pngBuffer.toString('base64'), mime_type: 'image/png' });
      } catch (_) {}
    }
    return { found: true, total_slides: slideEntries.length, images, note: 'Preview baseado no texto extraído de cada slide — não reproduz imagens, formas ou estilo original do PowerPoint.' };
  } catch (e) {
    return { found: false, reason: `Erro ao gerar preview do PPTX: ${e.message}` };
  }
}

async function audioDurationCheckImpl(audioBase64) {
  if (!musicMetadata) return { found: false, reason: "Lib 'music-metadata' não instalada — adiciona ao package.json e faz npm install." };
  try {
    if (!audioBase64) return { found: false, reason: "audio_base64 vazio." };
    const buffer = Buffer.from(audioBase64, 'base64');
    const metadata = await musicMetadata.parseBuffer(buffer);
    return { found: true, duration_seconds: metadata.format.duration || null, format: metadata.format.container || null, sample_rate: metadata.format.sampleRate || null, bitrate: metadata.format.bitrate || null };
  } catch (e) {
    return { found: false, reason: `Erro ao ler duração de áudio: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS DE TEXTO / DADOS — implementações
// ═══════════════════════════════════════════════════════════
function strReplaceFileImpl(content, oldStr, newStr) {
  if (typeof content !== 'string' || content.length === 0) return { found: false, reason: "content vazio ou inválido." };
  if (typeof oldStr !== 'string' || oldStr.length === 0) return { found: false, reason: "old_str vazio — não há o que procurar." };
  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) return { found: false, reason: "old_str não encontrado no ficheiro. Confirma espaços, indentação e quebras de linha exatas." };
  if (occurrences > 1) return { found: false, reason: `old_str aparece ${occurrences} vezes — não é único. Inclui mais linhas de contexto para o tornar específico a uma só ocorrência.` };
  const updatedContent = content.replace(oldStr, newStr ?? '');
  return { found: true, content: updatedContent, chars_before: content.length, chars_after: updatedContent.length };
}

function diffTextImpl(textBefore, textAfter) {
  const before = (textBefore || '').split('\n');
  const after = (textAfter || '').split('\n');
  const maxLen = Math.max(before.length, after.length);
  const changes = [];
  for (let i = 0; i < maxLen; i++) {
    const b = before[i], a = after[i];
    if (b === a) continue;
    if (b !== undefined && a === undefined) changes.push({ line: i + 1, type: 'removed', content: b });
    else if (b === undefined && a !== undefined) changes.push({ line: i + 1, type: 'added', content: a });
    else changes.push({ line: i + 1, type: 'changed', before: b, after: a });
  }
  return { found: true, total_changes: changes.length, changes: changes.slice(0, 200) };
}

function extractUrlsFromTextImpl(text) {
  if (!text) return { found: false, reason: "text vazio." };
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const unique = Array.from(new Set(matches));
  if (unique.length === 0) return { found: false, reason: "Nenhum URL encontrado no texto." };
  return { found: true, urls: unique };
}

function formatMarkdownToHtmlImpl(markdown) {
  if (!markdown) return { found: false, reason: "markdown vazio." };
  let html = escapeHtml(markdown);
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>').replace(/^## (.*$)/gim, '<h2>$1</h2>').replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.split('\n\n').map(p => p.trim().startsWith('<h') || p.trim().startsWith('<ul') ? p : `<p>${p}</p>`).join('\n');
  return { found: true, html };
}

function countTokensEstimateImpl(text) {
  if (!text) return { found: false, reason: "text vazio." };
  const estimatedTokens = Math.ceil(text.length / 4);
  return { found: true, char_count: text.length, estimated_tokens: estimatedTokens, note: "Heurística ~4 chars/token — não é um tokenizer exato de nenhum modelo específico." };
}

function textSummaryStatsImpl(text) {
  if (!text) return { found: false, reason: "text vazio." };
  const words = (text.match(/\S+/g) || []).length;
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length || 1;
  const readingTimeMin = Math.max(1, Math.round(words / 200));
  return { found: true, word_count: words, sentence_count: sentences, paragraph_count: paragraphs, estimated_reading_time_minutes: readingTimeMin };
}

function textToSyllablesPtImpl(word) {
  if (!word) return { found: false, reason: "word vazio." };
  const trimmed = word.trim().toLowerCase();
  const vowels = 'aeiouáéíóúâêôãõ';
  const syllables = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    current += c;
    const isVowel = vowels.includes(c);
    const nextIsVowel = i + 1 < trimmed.length && vowels.includes(trimmed[i + 1]);
    const nextNextIsVowel = i + 2 < trimmed.length && vowels.includes(trimmed[i + 2]);
    if (isVowel && !nextIsVowel && i + 1 < trimmed.length) {
      if (nextNextIsVowel || i + 2 >= trimmed.length) { syllables.push(current); current = ''; }
    }
  }
  if (current) syllables.push(current);
  return { found: true, word: trimmed, syllables: syllables.length > 0 ? syllables : [trimmed], note: "Heurística de regras comuns — não cobre 100% dos casos irregulares do português." };
}

async function youtubeThumbnailExtractImpl(youtubeUrl) {
  try {
    if (!youtubeUrl) return { found: false, reason: "youtube_url vazio." };
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { found: false, reason: `Vídeo não encontrado ou URL inválido (${r.status}).` };
    const data = await r.json();
    return { found: true, title: data.title, thumbnail_url: data.thumbnail_url, author_name: data.author_name };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair thumbnail: ${e.message}` };
  }
}

async function mergePdfsImpl(pdfsBase64) {
  if (!pdfLib) return { found: false, reason: "Lib 'pdf-lib' não instalada — adiciona ao package.json e faz npm install." };
  try {
    if (!pdfsBase64 || pdfsBase64.length < 2) return { found: false, reason: "Fornece pelo menos 2 PDFs em pdfs_base64." };
    const merged = await pdfLib.PDFDocument.create();
    for (const b64 of pdfsBase64) {
      const src = await pdfLib.PDFDocument.load(Buffer.from(b64, 'base64'));
      const copiedPages = await merged.copyPages(src, src.getPageIndices());
      copiedPages.forEach(p => merged.addPage(p));
    }
    const bytes = await merged.save();
    return { found: true, content_base64: Buffer.from(bytes).toString('base64'), filename: 'documentos_unidos.pdf', mime_type: 'application/pdf', label: `${pdfsBase64.length} PDFs unidos` };
  } catch (e) {
    return { found: false, reason: `Erro ao unir PDFs: ${e.message}` };
  }
}

async function splitPdfPagesImpl(pdfBase64, pageNumbers) {
  if (!pdfLib) return { found: false, reason: "Lib 'pdf-lib' não instalada — adiciona ao package.json e faz npm install." };
  try {
    if (!pdfBase64) return { found: false, reason: "pdf_base64 vazio." };
    if (!pageNumbers || pageNumbers.length === 0) return { found: false, reason: "page_numbers vazio." };
    const src = await pdfLib.PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
    const totalPages = src.getPageCount();
    const zeroIndexed = pageNumbers.map(n => n - 1).filter(n => n >= 0 && n < totalPages);
    if (zeroIndexed.length === 0) return { found: false, reason: `Nenhuma página válida — o PDF tem ${totalPages} páginas.` };
    const out = await pdfLib.PDFDocument.create();
    const copiedPages = await out.copyPages(src, zeroIndexed);
    copiedPages.forEach(p => out.addPage(p));
    const bytes = await out.save();
    return { found: true, content_base64: Buffer.from(bytes).toString('base64'), filename: 'paginas_extraidas.pdf', mime_type: 'application/pdf', label: `${zeroIndexed.length} páginas extraídas` };
  } catch (e) {
    return { found: false, reason: `Erro ao extrair páginas: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DAS TOOLS — para runTool() saber tratar erro
// de forma consistente e para o Flutter classificar cards
// ═══════════════════════════════════════════════════════════
const HEAVY_TOOL_NAMES = new Set(['animate_html', 'generate_infographic']);

// ═══════════════════════════════════════════════════════════
// DISPATCHER — runTool()
// ═══════════════════════════════════════════════════════════
async function runTool(name, input) {
  input = input || {};

  if (HEAVY_TOOL_NAMES.has(name) && !ENABLE_HEAVY_TOOLS) {
    return { found: false, reason: `A tool "${name}" está desativada neste plano (ENABLE_HEAVY_TOOLS=false). Disponível ao migrar para um plano com mais RAM.` };
  }

  switch (name) {
    // Busca / dados externos
    case "web_search": return await webSearchImpl(input.query);
    case "search_images": return await searchImagesImpl(input.query);
    case "search_videos": return await searchVideosImpl(input.query);
    case "download_image_for_project": return await downloadImageForProjectImpl(input.query_or_url, input.target_filename);
    case "search_market": return await searchMarketImpl(input.query);
    case "search_place": return await searchPlaceImpl(input.query);
    case "search_calendar_date": return searchCalendarDateImpl(input.query);
    case "get_weather": return await getWeatherImpl(input.city);

    // Geração de imagem
    case "generate_chart": return await generateChartImpl(input.chart_type, input.title, input.labels, input.datasets);
    case "generate_function_plot": return await generateFunctionPlotImpl(input.expression, input.x_min, input.x_max, input.title, input.highlight_roots);
    case "generate_mindmap": return await generateMindmapImpl(input.root);
    case "generate_qrcode": return await generateQrcodeImpl(input.content, input.size);
    case "generate_barcode": return await generateBarcodeImpl(input.content, input.format);
    case "generate_math": return await generateMathImpl(input.expression);
    case "generate_table_image": return await generateTableImageImpl(input.title, input.headers, input.rows);
    case "generate_html_image": return await enqueueHeavy(withTimeout(() => generateHtmlImageImpl(input.html, input.width, input.height)));
    case "generate_letter_card_svg": return await generateLetterCardSvgImpl(input.letter_or_syllable, input.hue, input.size);
    case "generate_color_scheme": return generateColorSchemeImpl(input.base_color_hex);
    case "generate_random_avatar": return await generateRandomAvatarImpl(input.seed, input.size);
    case "generate_memory_game_grid": return generateMemoryGameGridImpl(input.items, input.columns);

    // Documentos
    case "create_pdf": return await enqueueHeavy(withTimeout(() => createPdfImpl(input.title, input.html_content, input.image_urls, input.embed_chart)));
    case "create_pdf_structured": return await enqueueHeavy(withTimeout(() => createPdfStructuredImpl(input.title, input.sections)));
    case "create_docx": return await enqueueHeavy(withTimeout(() => createDocxImpl(input.title, input.html_content, input.image_urls, input.embed_chart)));
    case "create_xlsx": return await createXlsxImpl(input.sheet_name, input.headers, input.rows);
    case "create_pptx": return await createPptxImpl(input.title, input.slides);
    case "create_project_zip": return await enqueueHeavy(withTimeout(() => createProjectZipImpl(input.project_name, input.files, input.image_urls_to_include), 45000));

    // Leitura
    case "read_zip_contents": return await readZipContentsImpl(input.zip_base64);
    case "read_pdf_contents": return await readPdfContentsImpl(input.pdf_base64);
    case "extract_document_outline": return await extractDocumentOutlineImpl(input.pdf_base64);

    // Conversão
    case "csv_to_xlsx": return await csvToXlsxImpl(input.csv_content);
    case "json_transform": return jsonTransformImpl(input.json_data);
    case "xlsx_to_json": return await xlsxToJsonImpl(input.xlsx_base64);
    case "html_to_docx": return await htmlToDocxImpl(input.html_content, input.filename);
    case "html_to_pdf": return await enqueueHeavy(withTimeout(() => htmlToPdfImpl(input.html_content, input.title)));
    case "html_to_xlsx": return await htmlToXlsxImpl(input.html_content, input.sheet_name);
    case "html_to_pptx": return await htmlToPptxImpl(input.html_content, input.title);
    case "docx_to_html": return await docxToHtmlImpl(input.docx_base64);

    // Imagem — utilitários
    case "get_image_colors": return await getImageColorsImpl(input.image_url, input.image_base64, input.num_colors);
    case "convert_image_format": return await convertImageFormatImpl(input.image_base64, input.target_format);
    case "resize_image": return await resizeImageImpl(input.image_base64, input.width, input.height);
    case "crop_image": return await cropImageImpl(input.image_base64, input.left, input.top, input.width, input.height);
    case "watermark_image": return await watermarkImageImpl(input.image_base64, input.watermark_text, input.position);
    case "image_metadata": return await imageMetadataImpl(input.image_base64);
    case "vectorize_image": return await enqueueHeavy(withTimeout(() => vectorizeImageImpl(input.image_base64, input.mode)));
    case "ocr_extract_text": return await enqueueHeavy(withTimeout(() => ocrExtractTextImpl(input.image_base64, input.language), 45000));
    case "pdf_to_images": return await pdfToImagesImpl(input.pdf_base64, input.max_pages);
    case "pptx_to_images": return await pptxToImagesImpl(input.pptx_base64);
    case "audio_duration_check": return await audioDurationCheckImpl(input.audio_base64);

    // Texto / dados
    case "str_replace_file": return strReplaceFileImpl(input.content, input.old_str, input.new_str);
    case "diff_text": return diffTextImpl(input.text_before, input.text_after);
    case "extract_urls_from_text": return extractUrlsFromTextImpl(input.text);
    case "format_markdown_to_html": return formatMarkdownToHtmlImpl(input.markdown);
    case "count_tokens_estimate": return countTokensEstimateImpl(input.text);
    case "text_summary_stats": return textSummaryStatsImpl(input.text);
    case "text_to_syllables_pt": return textToSyllablesPtImpl(input.word);
    case "color_from_letter_seed": return colorFromLetterSeedImpl(input.seed);
    case "youtube_thumbnail_extract": return await youtubeThumbnailExtractImpl(input.youtube_url);
    case "merge_pdfs": return await mergePdfsImpl(input.pdfs_base64);
    case "split_pdf_pages": return await splitPdfPagesImpl(input.pdf_base64, input.page_numbers);

    // Heavy tools (bloqueadas por defeito, ver check no topo)
    case "animate_html": return { found: false, reason: "animate_html requer motor de vídeo — indisponível neste servidor mesmo com ENABLE_HEAVY_TOOLS." };
    case "generate_infographic": return { found: false, reason: "generate_infographic ainda não implementada nesta versão." };

    default:
      return { found: false, reason: `Tool desconhecida: "${name}"` };
  }
}

// ═══════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'nexa-tools-api', version: '2.1.0', tools_count: tools.length, date: getCurrentDateInfo().full });
});

app.get('/tools', (req, res) => {
  res.json({ tools });
});

app.post('/run-tool', async (req, res) => {
  const { name, input } = req.body || {};
  if (!name) return res.status(400).json({ found: false, reason: "Campo 'name' é obrigatório." });
  try {
    const result = await runTool(name, input);
    res.json(result);
  } catch (e) {
    console.error(`[runTool] Erro não tratado em "${name}":`, e);
    res.status(500).json({ found: false, reason: `Erro interno ao executar "${name}": ${e.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 nexa-tools-api a correr na porta ${PORT}`);
  console.log(`📦 ${tools.length} tools registadas (${HEAVY_TOOL_NAMES.size} atrás de ENABLE_HEAVY_TOOLS=${ENABLE_HEAVY_TOOLS})`);
  console.log(`🔤 Fontes Inter: ${FONT_REGULAR && FONT_BOLD ? 'OK' : 'EM FALTA — ./fonts/Inter-Regular.ttf e Inter-Bold.ttf'}`);
});