// ═══════════════════════════════════════════════════════════
// create_file — cria arquivo de texto/código com qualquer extensão
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "generated_files");

const EXTENSOES_PERMITIDAS = [
  ".py", ".dart", ".js", ".ts", ".jsx", ".tsx",
  ".html", ".css", ".md", ".json", ".yaml", ".yml",
  ".txt", ".java", ".kt", ".swift", ".go", ".rs",
  ".c", ".cpp", ".h", ".sh", ".sql", ".xml",
];

function create_file(params) {
  const { filename, content } = params;
  
  if (!filename || typeof content !== "string") {
    throw new Error("filename e content são obrigatórios");
  }
  
  const ext = path.extname(filename).toLowerCase();
  if (!EXTENSOES_PERMITIDAS.includes(ext)) {
    throw new Error(
      `Extensão '${ext}' não permitida. Permitidas: ${EXTENSOES_PERMITIDAS.join(", ")}`
    );
  }
  
  // Sanitiza o nome do arquivo (evita path traversal)
  const safeFilename = path.basename(filename);
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const filePath = path.join(OUTPUT_DIR, safeFilename);
  fs.writeFileSync(filePath, content, "utf-8");
  
  return {
    filename: safeFilename,
    size_bytes: Buffer.byteLength(content, "utf-8"),
    content_base64: Buffer.from(content, "utf-8").toString("base64"),
  };
}

module.exports = { create_file };