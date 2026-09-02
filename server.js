// ═══════════════════════════════════════════════════════════
// SERVER — só express app + listen
// ═══════════════════════════════════════════════════════════

const express = require('express');
const { tools, runTool } = require('./tools/index');
const { getCurrentDateInfo } = require('./config');

const app = express();
app.use(express.json({ limit: '20mb' }));
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'nexa-tools-api', version: '2.3.0', tools_count: tools.length, date: getCurrentDateInfo().full });
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
  const { FONT_REGULAR, FONT_BOLD } = require('./fonts');
  const { ENABLE_HEAVY_TOOLS, HEAVY_TOOL_NAMES } = require('./config');
  console.log(`🚀 nexa-tools-api a correr na porta ${PORT}`);
  console.log(`📦 ${tools.length} tools registadas (${HEAVY_TOOL_NAMES.size} atrás de ENABLE_HEAVY_TOOLS=${ENABLE_HEAVY_TOOLS})`);
  console.log(`🔤 Fontes Inter: ${FONT_REGULAR && FONT_BOLD ? 'OK' : 'EM FALTA — ./fonts/Inter-Regular.ttf e Inter-Bold.ttf'}`);
});