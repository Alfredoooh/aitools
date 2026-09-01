const express = require('express');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const satori = require('satori').default;
const html = require('satori-html').html;
const sharp = require('sharp');
const math = require('mathjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const cheerio = require('cheerio');
const htmlToDocx = require('@turbodocx/html-to-docx');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const pdfLib = require('pdf-lib');
const Tesseract = require('tesseract.js');
const mammoth = require('mammoth');
const musicMetadata = require('music-metadata');
const potrace = require('potrace');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// CHAVES DE API
// ═══════════════════════════════════════════════════════════
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';

// ═══════════════════════════════════════════════════════════
// FEATURE FLAG — tools pesadas ficam registadas mas desativadas
// até ligares ENABLE_HEAVY_TOOLS=true (ex: ao migrar para VPS
// com mais RAM). Zero reescrita nesse dia, só a env var.
// ═══════════════════════════════════════════════════════════
const ENABLE_HEAVY_TOOLS = process.env.ENABLE_HEAVY_TOOLS === 'true';

// ═══════════════════════════════════════════════════════════
// FONTES — satori exige buffer de fonte manual (não lê @font-face
// nem fontes de sistema). Coloca Inter-Regular.ttf, Inter-Bold.ttf
// e Inter-SemiBold.ttf (opcional) em ./fonts/ na raiz do projeto.
// Download: https://fonts.google.com/specimen/Inter
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// FILA — evita operações pesadas simultâneas (protege os 512MB)
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
// LIMITES — ajustados para o free tier de 512MB
// ═══════════════════════════════════════════════════════════
const ZIP_MAX_BYTES = 15 * 1024 * 1024;
const ZIP_MAX_FILES = 100;
const ZIP_TEXT_TRUNCATE = 15000;
const ZIP_MAX_IMAGES = 10;
const ZIP_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const PDF_MAX_PAGES_TEXT = 40;
const VECTORIZE_MAX_DIMENSION = 2000;
const SERPER_MAX_RESULTS = 100; // teto real do Serper por página em /images, /videos e /search
const WEBSITE_READ_MAX_CHARS = 20000;

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
// HELPERS DE TEXTO/FICHEIRO
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

async function fetchImageAsBase64(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Falha ao descarregar imagem (${r.status}): ${url}`);
  const arrayBuffer = await r.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = r.headers.get('content-type') || 'image/png';
  return { base64: buffer.toString('base64'), mimeType: contentType, buffer };
}

// ═══════════════════════════════════════════════════════════
// PALETA DE DESIGN COMPARTILHADA — usada por chart, pdf, tabela,
// math, mindmap, weather, avatar, para manter tudo consistente
// e evitar o visual "genérico" das versões anteriores.
// ═══════════════════════════════════════════════════════════
const DESIGN = {
  palette: ['#4F46E5', '#0EA5E9', '#F59E0B', '#EF4444', '#10B981', '#8B5CF6', '#EC4899', '#14B8A6'],
  ink: '#0F172A',
  inkSoft: '#475569',
  inkMuted: '#64748B',
  border: '#E2E8F0',
  surface: '#F8FAFC',
  surfaceAlt: '#F1F5F9',
  white: '#FFFFFF',
  gridLine: '#EEF2F6',
};

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
    name: "read_website",
    description: "Lê o conteúdo completo de uma página web dado o URL, e devolve o texto limpo (sem menus, scripts, anúncios) mais título, descrição e links principais. Usa para resumir artigos, extrair informação de páginas específicas ou analisar conteúdo de um site.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
  },
  {
    name: "search_images",
    description: `Pesquisa imagens reais na web via Serper. Devolve até ${SERPER_MAX_RESULTS} imagens (url, título, origem, dimensões) para exibir em carrossel ou anexar a documentos.`,
    input_schema: { type: "object", properties: { query: { type: "string" }, max_results: { type: "number", description: `Máximo ${SERPER_MAX_RESULTS}, default 30.` } }, required: ["query"] }
  },
  {
    name: "search_videos",
    description: `Pesquisa vídeos reais na web via Serper (YouTube e outras plataformas indexadas). Devolve até ${SERPER_MAX_RESULTS} resultados com título, link, duração, canal e thumbnail.`,
    input_schema: { type: "object", properties: { query: { type: "string" }, max_results: { type: "number", description: `Máximo ${SERPER_MAX_RESULTS}, default 30.` } }, required: ["query"] }
  },
  {
    name: "search_books",
    description: "Pesquisa livros reais (Google Books): título, autor(es), editora, ano, descrição, capa, avaliação média e link de compra/leitura. Útil para recomendações, referências bibliográficas e verificação de dados de um livro.",
    input_schema: { type: "object", properties: { query: { type: "string" }, max_results: { type: "number", description: "Máximo 40, default 10." } }, required: ["query"] }
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
    description: "Gera um gráfico REAL (Chart.js) como PNG base64, com design limpo e profissional. Suporta line, bar, pie, doughnut, radar, polarArea, scatter, bubble.",
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
    name: "generate_math_sheet",
    description: "Gera uma ficha matemática completa e organizada em PNG: expressão, resultado, e (quando a expressão tem variável x) o gráfico da função correspondente lado a lado — não é apenas um número solto.",
    input_schema: { type: "object", properties: { expression: { type: "string" }, show_graph: { type: "boolean", description: "Se a expressão tiver x, tenta desenhar o gráfico da função ao lado do resultado. Default true." } }, required: ["expression"] }
  },
  {
    name: "generate_mindmap",
    description: "Gera um mapa mental hierárquico como PNG base64, com cartões e conectores visuais.",
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
    name: "generate_table_image",
    description: "Gera uma tabela complexa e bem formatada como PNG base64.",
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
    name: "generate_color_scheme",
    description: "Gera uma paleta completa light/dark a partir de 1 cor base (hex), com tokens tipo AppColorScheme: primary, secondary, background, surface, text, em ambos os modos.",
    input_schema: { type: "object", properties: { base_color_hex: { type: "string" } }, required: ["base_color_hex"] }
  },
  {
    name: "generate_random_avatar",
    description: "Gera um avatar geométrico único e determinístico a partir de uma seed (ex: user id ou email) — formas orgânicas variadas (círculos, blobs, triângulos sobrepostos), não um grid de blocos.",
    input_schema: { type: "object", properties: { seed: { type: "string" }, size: { type: "number" } }, required: ["seed"] }
  },

  // ─────────────────────────────────────────────────────────
  // DOCUMENTOS
  // ─────────────────────────────────────────────────────────
  {
    name: "create_pdf",
    description: "Gera um PDF profissional a partir de HTML rico, com cabeçalho, rodapé com paginação, tipografia cuidada e imagens reais embutidas corretamente (URLs são descarregadas e inseridas de facto no layout, não apenas referenciadas).",
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
    description: "Gera um PDF bem formatado a partir de JSON descritivo (secções, blocos de texto, imagens, gráficos, tabelas) — layout profissional garantido, com imagens de facto inseridas, sem depender de parsing de HTML livre.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              paragraphs: { type: "array", items: { type: "string" } },
              bullet_list: { type: "array", items: { type: "string" } },
              image_url: { type: "string" },
              table: { type: "object", properties: { headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } } },
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
    description: "Gera um Word (.docx) a partir de HTML, com imagens reais embutidas.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, html_content: { type: "string" }, image_urls: { type: "array", items: { type: "string" } }, embed_chart: { type: "object" } },
      required: ["title", "html_content"]
    }
  },
  {
    name: "create_xlsx",
    description: "Gera planilha Excel (.xlsx) com cabeçalho estilizado e colunas ajustadas ao conteúdo.",
    input_schema: { type: "object", properties: { sheet_name: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["headers", "rows"] }
  },
  {
    name: "create_pptx",
    description: "Gera PowerPoint (.pptx) com layout cuidado por slide.",
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
    description: "Converte HTML em PDF profissional (via satori), com cabeçalho e paginação.",
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
    description: "Converte DOCX enviado (base64) em HTML editável, usando mammoth.",
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
    description: "Sobrepõe uma marca d'água (texto) numa imagem base.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, watermark_text: { type: "string" }, position: { type: "string", enum: ["top-left", "top-right", "bottom-left", "bottom-right", "center"] } }, required: ["image_base64", "watermark_text"] }
  },
  {
    name: "image_metadata",
    description: "Lê dimensões, formato e metadados básicos de uma imagem sem descodificar todos os pixels.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" } }, required: ["image_base64"] }
  },
  {
    name: "vectorize_image",
    description: `Converte PNG em SVG vetorizado (colorido ou preto/transparente). Limite: ${VECTORIZE_MAX_DIMENSION}px na maior dimensão — imagens maiores devem ser redimensionadas primeiro com resize_image.`,
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, mode: { type: "string", enum: ["color", "black_transparent"] } }, required: ["image_base64"] }
  },
  {
    name: "ocr_extract_text",
    description: "Extrai texto de uma imagem (OCR) via tesseract.js. Suporta português e inglês.",
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
    description: "Lê metadados completos de um ficheiro de áudio: duração, título, artista, álbum, ano, género, codec, sample rate, bitrate, canais e se tem capa embutida — sem descodificar o áudio todo.",
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
    name: "youtube_thumbnail_extract",
    description: "Extrai thumbnail e metadata básica (título) de um vídeo do YouTube dado o URL, via oEmbed público — sem API key.",
    input_schema: { type: "object", properties: { youtube_url: { type: "string" } }, required: ["youtube_url"] }
  },
  {
    name: "merge_pdfs",
    description: "Junta múltiplos PDFs (base64) num único PDF, na ordem dada.",
    input_schema: { type: "object", properties: { pdfs_base64: { type: "array", items: { type: "string" } } }, required: ["pdfs_base64"] }
  },
  {
    name: "split_pdf_pages",
    description: "Extrai um subconjunto de páginas de um PDF para um novo PDF.",
    input_schema: { type: "object", properties: { pdf_base64: { type: "string" }, page_numbers: { type: "array", items: { type: "number" } } }, required: ["pdf_base64", "page_numbers"] }
  },
];

// ─────────────────────────────────────────────────────────
// TOOLS PESADAS — registadas mas só ficam utilizáveis com
// ENABLE_HEAVY_TOOLS=true. Não cabem confortavelmente em 512MB
// (motor de vídeo / composição de muitas camadas). Ver runTool().
// ─────────────────────────────────────────────────────────
tools.push(
  {
    name: "animate_html",
    description: "[REQUER ENABLE_HEAVY_TOOLS] Anima HTML+CSS ao longo do tempo e exporta como vídeo curto/longo (duração conforme timing do HTML). Requer motor de vídeo — indisponível no free tier de 512MB.",
    input_schema: { type: "object", properties: { html: { type: "string" }, duration_seconds: { type: "number" } }, required: ["html", "duration_seconds"] }
  },
  {
    name: "generate_infographic",
    description: "[REQUER ENABLE_HEAVY_TOOLS] Gera infográfico com ícones e blocos organizados a partir de dados estruturados. Composição pesada — indisponível no free tier de 512MB.",
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
      { name: 'Inter', data: FONT_SEMIBOLD || FONT_BOLD, weight: 600, style: 'normal' },
      { name: 'Inter', data: FONT_BOLD, weight: 700, style: 'normal' },
    ],
  });
  return svg;
}

async function svgToPngBuffer(svgString, scale) {
  const density = 72 * (scale || 2); // renderiza em @2x por defeito, evita PNG borrado
  return await sharp(Buffer.from(svgString), { density }).png().toBuffer();
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
// CREATE PDF — layout A4 profissional: cabeçalho, corpo, rodapé
// com paginação, via satori→PNG full-page, resolução de ecrã.
// ═══════════════════════════════════════════════════════════
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

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

// ── HTML helpers de layout de documento (cabeçalho/rodapé/imagem real) ──
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

async function createPdfImpl(title, htmlContent, imageUrls, embedChart) {
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
        ${pdfHeaderHtml(title)}
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

async function readWebsiteImpl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return { found: false, reason: "url vazio." };
  if (!/^https?:\/\//i.test(trimmed)) return { found: false, reason: "url precisa de começar com http:// ou https://." };
  try {
    const r = await fetch(trimmed, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nexa-tools-api/2.2.0; +https://nexa.app)' },
    });
    if (!r.ok) return { found: false, reason: `Site devolveu status ${r.status}.` };
    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { found: false, reason: `Conteúdo do URL não é HTML (content-type: ${contentType}).` };
    }
    const rawHtml = await r.text();
    const $ = cheerio.load(rawHtml);
    $('script, style, noscript, iframe, svg, nav, footer, [aria-hidden="true"]').remove();
    const title = $('title').first().text().trim() || null;
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null;
    const mainText = ($('article').text() || $('main').text() || $('body').text() || '')
      .replace(/\s+/g, ' ')
      .trim();
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && links.length < 25 && /^https?:\/\//i.test(href)) links.push({ text: text.slice(0, 100), href });
    });
    if (!mainText) return { found: false, reason: "Não foi possível extrair texto legível da página." };
    return {
      found: true, url: trimmed, title, description,
      text: mainText.slice(0, WEBSITE_READ_MAX_CHARS),
      truncated: mainText.length > WEBSITE_READ_MAX_CHARS,
      char_count_total: mainText.length,
      links_sample: links,
    };
  } catch (e) {
    return { found: false, reason: `Erro ao ler o site: ${e.message}` };
  }
}

async function searchImagesImpl(query, maxResults) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  if (!SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada no servidor." };
  const num = Math.min(SERPER_MAX_RESULTS, Math.max(1, maxResults || 30));
  try {
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmed, gl: 'pt', hl: 'pt', num }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { found: false, reason: `Serper devolveu ${r.status}` };
    const data = await r.json();
    const images = (data.images || []).slice(0, num).map(img => ({
      title: img.title || '', url: img.imageUrl || '', thumbnailUrl: img.thumbnailUrl || img.imageUrl || '',
      source: img.source || '', width: img.imageWidth || null, height: img.imageHeight || null,
    })).filter(img => !!img.url);
    if (images.length === 0) return { found: false, reason: `Nenhuma imagem encontrada para "${trimmed}".` };
    return { found: true, query: trimmed, total_returned: images.length, images };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de imagens: ${e.message}` };
  }
}

async function searchVideosImpl(query, maxResults) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  if (!SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada no servidor." };
  const num = Math.min(SERPER_MAX_RESULTS, Math.max(1, maxResults || 30));
  try {
    const r = await fetch('https://google.serper.dev/videos', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmed, gl: 'pt', hl: 'pt', num }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { found: false, reason: `Serper devolveu ${r.status}` };
    const data = await r.json();
    if (!data.videos) console.error('[search_videos] campo "videos" ausente na resposta Serper:', JSON.stringify(data).slice(0, 500));
    const videos = (data.videos || []).slice(0, num).map(v => ({
      title: v.title || '', link: v.link || '', thumbnailUrl: v.imageUrl || '',
      channel: v.channel || v.source || '', duration: v.duration || null, date: v.date || null,
    })).filter(v => !!v.link);
    if (videos.length === 0) return { found: false, reason: `Nenhum vídeo encontrado para "${trimmed}".` };
    return { found: true, query: trimmed, total_returned: videos.length, videos };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de vídeos: ${e.message}` };
  }
}

async function searchBooksImpl(query, maxResults) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  const num = Math.min(40, Math.max(1, maxResults || 10));
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(trimmed)}&maxResults=${num}&langRestrict=pt`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { found: false, reason: `Google Books devolveu ${r.status}` };
    const data = await r.json();
    if (!data.items || data.items.length === 0) return { found: false, reason: `Nenhum livro encontrado para "${trimmed}".` };
    const books = data.items.slice(0, num).map(item => {
      const info = item.volumeInfo || {};
      const sale = item.saleInfo || {};
      return {
        title: info.title || null,
        subtitle: info.subtitle || null,
        authors: info.authors || [],
        publisher: info.publisher || null,
        published_date: info.publishedDate || null,
        description: info.description ? info.description.slice(0, 600) : null,
        page_count: info.pageCount || null,
        categories: info.categories || [],
        average_rating: info.averageRating || null,
        ratings_count: info.ratingsCount || null,
        language: info.language || null,
        thumbnail: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || null,
        preview_link: info.previewLink || null,
        buy_link: sale.buyLink || null,
        isbn_13: (info.industryIdentifiers || []).find(id => id.type === 'ISBN_13')?.identifier || null,
      };
    });
    return { found: true, query: trimmed, total_returned: books.length, books };
  } catch (e) {
    return { found: false, reason: `Erro na pesquisa de livros: ${e.message}` };
  }
}

async function downloadImageForProjectImpl(queryOrUrl, targetFilename) {
  const trimmed = (queryOrUrl || '').trim();
  if (!trimmed) return { found: false, reason: "query_or_url vazio" };
  try {
    let finalUrl = trimmed;
    if (!/^https?:\/\//i.test(trimmed)) {
      const searchResult = await searchImagesImpl(trimmed, 1);
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
      headers: { 'User-Agent': 'nexa-tools-api/2.2.0' }, signal: AbortSignal.timeout(10000),
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
    const cardHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:36px; background:linear-gradient(135deg,#4F46E5,#0EA5E9); font-family:Inter; color:white;">
      <div style="display:flex; font-size:20px; font-weight:700;">${escapeHtml(loc.name)}</div>
      <div style="display:flex; align-items:flex-end;">
        <div style="display:flex; font-size:64px; font-weight:700; padding-top:14px;">${Math.round(wData.current.temperature_2m)}°</div>
        <div style="display:flex; font-size:20px; padding:0 0 14px 10px; opacity:0.85;">C</div>
      </div>
      <div style="display:flex; font-size:16px; font-weight:600;">${escapeHtml(label)}</div>
      <div style="display:flex; font-size:13px; padding-top:14px; opacity:0.9;">Humidade: ${wData.current.relative_humidity_2m}%  ·  Vento: ${Math.round(wData.current.wind_speed_10m)} km/h</div>
    </div>`;
    let cardImage = null;
    try {
      const svg = await htmlToSvgViaSatori(cardHtml, 420, 280);
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
      // gera o gráfico da função e compõe um cartão único com expressão + gráfico
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

    // sem variável x — expressão pontual, cartão simples mas bem desenhado
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

// ── Avatar geométrico real: gerador determinístico de formas
// orgânicas sobrepostas (círculos, blobs, triângulos) — substitui
// o antigo grid de blocos, que ficava sempre "quadriculado" e feio.
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

    // fundo em gradiente suave
    const bgId = 'bg' + Math.abs(hash);
    let shapes = `<defs><linearGradient id="${bgId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${colorB}" stop-opacity="0.28"/>
    </linearGradient></defs>`;
    shapes += `<rect width="${s}" height="${s}" fill="url(#${bgId})"/>`;

    // 3 a 4 formas orgânicas sobrepostas, posições e tamanhos variam pela seed
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
        // círculo
        shapes += `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
      } else if (type < 0.75) {
        // blob orgânico (polígono suavizado com pontos aleatórios em torno de um círculo)
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
        // triângulo rotacionado
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
      <div style="display:flex; background:rgba(15,23,42,0.55); color:white; padding:7px 14px; border-radius:8px; font-size:${Math.max(12, Math.round(meta.width / 40))}px; font-family:Inter;">${escapeHtml(watermarkText)}</div>
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
    const escapedLines = escapeHtml(firstPageText.slice(0, 1200)).split('\n').slice(0, 30).map(l => `<div style="display:flex; font-size:11px; color:${DESIGN.inkSoft}; padding-bottom:2px;">${l || '&nbsp;'}</div>`).join('');
    const bodyHtml = `<div style="display:flex; flex-direction:column; width:100%; height:100%; padding:32px; background:white; font-family:Inter;">${escapedLines}</div>`;
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
      const linesHtml = texts.slice(0, 12).map((t, idx) => `<div style="display:flex; font-size:${idx === 0 ? 22 : 14}px; font-weight:${idx === 0 ? 700 : 400}; color:${DESIGN.ink}; padding-bottom:8px;">${escapeHtml(t)}</div>`).join('');
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
  try {
    if (!audioBase64) return { found: false, reason: "audio_base64 vazio." };
    const buffer = Buffer.from(audioBase64, 'base64');
    const metadata = await musicMetadata.parseBuffer(buffer);
    const common = metadata.common || {};
    const format = metadata.format || {};
    return {
      found: true,
      duration_seconds: format.duration || null,
      duration_formatted: format.duration ? `${Math.floor(format.duration / 60)}:${String(Math.round(format.duration % 60)).padStart(2, '0')}` : null,
      title: common.title || null,
      artist: common.artist || null,
      album: common.album || null,
      year: common.year || null,
      genre: (common.genre || []).join(', ') || null,
      track_number: common.track && common.track.no ? common.track.no : null,
      format: format.container || null,
      codec: format.codec || null,
      sample_rate_hz: format.sampleRate || null,
      bitrate_kbps: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      channels: format.numberOfChannels || null,
      has_embedded_cover: !!(common.picture && common.picture.length > 0),
      size_bytes: buffer.length,
    };
  } catch (e) {
    return { found: false, reason: `Erro ao ler metadados de áudio: ${e.message}` };
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
  let htmlOut = escapeHtml(markdown);
  htmlOut = htmlOut.replace(/^### (.*$)/gim, '<h3>$1</h3>').replace(/^## (.*$)/gim, '<h2>$1</h2>').replace(/^# (.*$)/gim, '<h1>$1</h1>');
  htmlOut = htmlOut.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
  htmlOut = htmlOut.replace(/^\- (.*$)/gim, '<li>$1</li>');
  htmlOut = htmlOut.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  htmlOut = htmlOut.split('\n\n').map(p => p.trim().startsWith('<h') || p.trim().startsWith('<ul') ? p : `<p>${p}</p>`).join('\n');
  return { found: true, html: htmlOut };
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
// CLASSIFICAÇÃO DAS TOOLS PESADAS — bloqueadas sem ENABLE_HEAVY_TOOLS
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
    case "read_website": return await readWebsiteImpl(input.url);
    case "search_images": return await searchImagesImpl(input.query, input.max_results);
    case "search_videos": return await searchVideosImpl(input.query, input.max_results);
    case "search_books": return await searchBooksImpl(input.query, input.max_results);
    case "download_image_for_project": return await downloadImageForProjectImpl(input.query_or_url, input.target_filename);
    case "search_market": return await searchMarketImpl(input.query);
    case "search_place": return await searchPlaceImpl(input.query);
    case "search_calendar_date": return searchCalendarDateImpl(input.query);
    case "get_weather": return await getWeatherImpl(input.city);

    // Geração de imagem
    case "generate_chart": return await generateChartImpl(input.chart_type, input.title, input.labels, input.datasets);
    case "generate_function_plot": return await generateFunctionPlotImpl(input.expression, input.x_min, input.x_max, input.title, input.highlight_roots);
    case "generate_math_sheet": return await enqueueHeavy(withTimeout(() => generateMathSheetImpl(input.expression, input.show_graph)));
    case "generate_mindmap": return await generateMindmapImpl(input.root);
    case "generate_qrcode": return await generateQrcodeImpl(input.content, input.size);
    case "generate_barcode": return await generateBarcodeImpl(input.content, input.format);
    case "generate_table_image": return await generateTableImageImpl(input.title, input.headers, input.rows);
    case "generate_html_image": return await enqueueHeavy(withTimeout(() => generateHtmlImageImpl(input.html, input.width, input.height)));
    case "generate_color_scheme": return generateColorSchemeImpl(input.base_color_hex);
    case "generate_random_avatar": return await generateRandomAvatarImpl(input.seed, input.size);

    // Documentos
    case "create_pdf": return await enqueueHeavy(withTimeout(() => createPdfImpl(input.title, input.html_content, input.image_urls, input.embed_chart)));
    case "create_pdf_structured": return await enqueueHeavy(withTimeout(() => createPdfStructuredImpl(input.title, input.subtitle, input.sections)));
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
    case "youtube_thumbnail_extract": return await youtubeThumbnailExtractImpl(input.youtube_url);
    case "merge_pdfs": return await mergePdfsImpl(input.pdfs_base64);
    case "split_pdf_pages": return await splitPdfPagesImpl(input.pdf_base64, input.page_numbers);

    // Heavy tools (bloqueadas por defeito — ver check no topo)
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
  res.json({ status: 'ok', service: 'nexa-tools-api', version: '2.2.0', tools_count: tools.length, date: getCurrentDateInfo().full });
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

// Alias — mesmo runTool() que /run-tool, nome diferente exigido
// por alguns workers/clientes que apontam para /tools/execute.
app.post('/tools/execute', async (req, res) => {
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