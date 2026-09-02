// ═══════════════════════════════════════════════════════════
// Chama documents.py via subprocess e devolve o resultado
// ═══════════════════════════════════════════════════════════

const { spawn } = require("child_process");
const path = require("path");

const PYTHON_SCRIPT = path.join(__dirname, "documents.py");

function callPythonDocumentTool(funcName, params) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [
      PYTHON_SCRIPT,
      funcName,
      JSON.stringify(params),
    ]);
    
    let stdout = "";
    let stderr = "";
    
    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`documents.py falhou: ${stderr || stdout}`));
      }
      try {
        const result = JSON.parse(stdout);
        if (result.error) return reject(new Error(result.error));
        resolve(result);
      } catch (e) {
        reject(new Error(`Resposta inválida do Python: ${stdout}`));
      }
    });
    
    proc.on("error", (err) => {
      reject(new Error(`Não foi possível iniciar o processo Python: ${err.message}`));
    });
  });
}

async function create_pdf(params) {
  return callPythonDocumentTool("create_pdf", params);
}

async function create_pdf_structured(params) {
  return callPythonDocumentTool("create_pdf_structured", params);
}

async function create_docx(params) {
  return callPythonDocumentTool("create_docx", params);
}

async function merge_pdfs(params) {
  return callPythonDocumentTool("merge_pdfs", params);
}

async function split_pdf_pages(params) {
  return callPythonDocumentTool("split_pdf_pages", params);
}

async function read_pdf_contents(params) {
  return callPythonDocumentTool("read_pdf_contents", params);
}

module.exports = {
  create_pdf,
  create_pdf_structured,
  create_docx,
  merge_pdfs,
  split_pdf_pages,
  read_pdf_contents,
};