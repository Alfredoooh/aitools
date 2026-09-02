// ═══════════════════════════════════════════════════════════
// CONFIG — chaves de API, constantes globais, paleta de design
// ═══════════════════════════════════════════════════════════

const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

const ENABLE_HEAVY_TOOLS = process.env.ENABLE_HEAVY_TOOLS === 'true';

const ZIP_MAX_BYTES = 15 * 1024 * 1024;
const ZIP_MAX_FILES = 100;
const ZIP_TEXT_TRUNCATE = 15000;
const ZIP_MAX_IMAGES = 10;
const ZIP_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const PDF_MAX_PAGES_TEXT = 40;
const VECTORIZE_MAX_DIMENSION = 2000;
const SERPER_MAX_RESULTS = 100;
const WEBSITE_READ_MAX_CHARS = 20000;

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.csv', '.tsv',
  '.dart', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss',
  '.py', '.java', '.kt', '.kts', '.swift', '.go', '.rs', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bash', '.gradle', '.properties',
  '.env', '.gitignore', '.dockerfile', '.sql', '.toml', '.ini', '.lock',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

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

const HEAVY_TOOL_NAMES = new Set(['animate_html', 'generate_infographic']);

function getCurrentDateInfo() {
  const now = new Date();
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return {
    iso: now.toISOString().split('T')[0],
    full: `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

module.exports = {
  SERPER_API_KEY,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  ENABLE_HEAVY_TOOLS,
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  ZIP_TEXT_TRUNCATE,
  ZIP_MAX_IMAGES,
  ZIP_IMAGE_MAX_BYTES,
  PDF_MAX_PAGES_TEXT,
  VECTORIZE_MAX_DIMENSION,
  SERPER_MAX_RESULTS,
  WEBSITE_READ_MAX_CHARS,
  A4_WIDTH_PX,
  A4_HEIGHT_PX,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  TEXT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  DESIGN,
  HEAVY_TOOL_NAMES,
  getCurrentDateInfo,
};