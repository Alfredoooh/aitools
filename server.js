const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;

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
// DEFINIÇÃO DAS TOOLS
// ═══════════════════════════════════════════════════════════
const tools = [
  {
    name: "web_search",
    description: `Pesquisa informação atual na web. IMPORTANTE: hoje é ${getCurrentDateInfo().full}. Usa sempre que precisares de informação recente. Nunca inventes resultados. Devolve resultados com snippets e imagens quando disponíveis.`,
    input_schema: { type: "object", properties: { query: { type: "string", description: "Termo de busca" } }, required: ["query"] }
  },
  {
    name: "search_images",
    description: "Pesquisa imagens na web via Serper. Devolve URLs de imagens relevantes para o query.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Termo de busca de imagens" } }, required: ["query"] }
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
    description: "Obtém o clima atual de uma cidade e gera um card visual PNG. Devolve dados do clima e imagem base64.",
    input_schema: { type: "object", properties: { city: { type: "string", description: "Nome da cidade" } }, required: ["city"] }
  },
  {
    name: "generate_chart",
    description: "Gera um gráfico visual como PNG base64. Suporta line, bar, pie, doughnut, radar, polarArea.",
    input_schema: {
      type: "object",
      properties: {
        chart_type: { type: "string", enum: ["line", "bar", "pie", "doughnut", "radar", "polarArea"] },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        datasets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              data: { type: "array", items: { type: "number" } },
              color: { type: "string" }
            }
          },
          description: "Array de datasets. Cada dataset tem label, data e opcionalmente color."
        }
      },
      required: ["chart_type", "labels", "datasets"]
    }
  },
  {
    name: "generate_qrcode",
    description: "Gera um QR code como PNG base64 a partir de qualquer texto ou URL.",
    input_schema: { type: "object", properties: { content: { type: "string", description: "Texto ou URL para o QR code" }, size: { type: "number", description: "Tamanho em pixels (default 300)" } }, required: ["content"] }
  },
  {
    name: "generate_barcode",
    description: "Gera um código de barras como PNG base64.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Conteúdo do código de barras" },
        format: { type: "string", enum: ["code128", "ean13", "ean8", "upca", "qrcode"], description: "Formato do barcode (default code128)" }
      },
      required: ["content"]
    }
  },
  {
    name: "generate_math",
    description: "Avalia uma expressão matemática e gera imagem visual com o resultado. Se for uma função (ex: f(x) = x^2), gera também o gráfico.",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Expressão matemática ex: '2^10', 'sqrt(144)', 'x^2 + 2*x + 1'" },
        variable_range: { type: "object", properties: { min: { type: "number" }, max: { type: "number" } }, description: "Range para gráfico de função (opcional)" }
      },
      required: ["expression"]
    }
  },
  {
    name: "generate_table_image",
    description: "Gera uma tabela complexa como PNG base64. Usa quando markdown não é suficiente para representar a tabela visualmente.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        headers: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
        theme: { type: "string", enum: ["dark", "light", "purple"], description: "Tema visual (default purple)" }
      },
      required: ["headers", "rows"]
    }
  },
  {
    name: "generate_html_image",
    description: "Converte um snippet HTML/CSS em PNG base64. Usa para criar cards, infográficos, dashboards visuais, snippets de código com syntax highlight, ou qualquer layout visual personalizado.",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML completo com estilos inline ou tag <style>" },
        width: { type: "number", description: "Largura em pixels (default 800)" },
        height: { type: "number", description: "Altura em pixels (default 600)" }
      },
      required: ["html"]
    }
  },
  {
    name: "create_pdf",
    description: "Gera um PDF a partir de HTML rico. Devolve base64.",
    input_schema: { type: "object", properties: { title: { type: "string" }, html_content: { type: "string" } }, required: ["title", "html_content"] }
  },
  {
    name: "create_docx",
    description: "Gera um Word (.docx) a partir de HTML. Devolve base64.",
    input_schema: { type: "object", properties: { title: { type: "string" }, html_content: { type: "string" } }, required: ["title", "html_content"] }
  },
  {
    name: "create_xlsx",
    description: "Gera planilha Excel (.xlsx). Devolve base64.",
    input_schema: { type: "object", properties: { sheet_name: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["headers", "rows"] }
  },
  {
    name: "create_pptx",
    description: "Gera PowerPoint (.pptx). Devolve base64.",
    input_schema: { type: "object", properties: { title: { type: "string" }, slides: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, bullets: { type: "array", items: { type: "string" } } } } } }, required: ["title", "slides"] }
  },
  {
    name: "csv_to_xlsx",
    description: "Converte CSV em Excel (.xlsx). Devolve base64.",
    input_schema: { type: "object", properties: { csv_content: { type: "string" } }, required: ["csv_content"] }
  },
  {
    name: "json_transform",
    description: "Transforma array JSON em tabela (headers + rows).",
    input_schema: { type: "object", properties: { json_data: { type: "string" } }, required: ["json_data"] }
  },
  {
    name: "html_to_docx",
    description: "Converte HTML em Word (.docx). Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, filename: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_pdf",
    description: "Converte HTML em PDF. Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_xlsx",
    description: "Converte HTML em Excel (.xlsx). Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, sheet_name: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "html_to_pptx",
    description: "Converte HTML em PowerPoint (.pptx). Devolve base64.",
    input_schema: { type: "object", properties: { html_content: { type: "string" }, title: { type: "string" } }, required: ["html_content"] }
  },
  {
    name: "convert_document",
    description: "Converte documento entre formatos. Devolve base64.",
    input_schema: { type: "object", properties: { source_format: { type: "string" }, target_format: { type: "string" }, content_base64: { type: "string" }, filename: { type: "string" } }, required: ["source_format", "target_format", "content_base64"] }
  },
];

// ═══════════════════════════════════════════════════════════
// WEB SEARCH COM IMAGENS E DATA ATUAL
// ═══════════════════════════════════════════════════════════
async function webSearchImpl(query) {
  if (!query?.trim()) return { found: false, reason: "Query vazia" };
  if (!process.env.SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada" };
  const dateInfo = getCurrentDateInfo();
  const queryWithDate = `${query} ${dateInfo.year}`;
  try {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: queryWithDate, gl: "pt", hl: "pt", num: 8 })
    });
    if (!r.ok) return { found: false, reason: `Erro Serper: ${r.status}` };
    const data = await r.json();
    const results = (data.organic || []).slice(0, 6).map(x => ({
      title: x.title || '',
      link: x.link || '',
      snippet: x.snippet || '',
      date: x.date || null,
    }));
    const images = (data.images || []).slice(0, 6).map(x => ({
      title: x.title || '',
      imageUrl: x.imageUrl || x.link || '',
      source: x.source || '',
    }));
    const knowledgeGraph = data.knowledgeGraph || null;
    const answerBox = data.answerBox || null;
    if (results.length === 0) return { found: false, reason: `Nenhum resultado para "${query}"` };
    return { found: true, currentDate: dateInfo.full, results, images, knowledgeGraph, answerBox };
  } catch (e) { return { found: false, reason: `Erro: ${e.message}` }; }
}

async function searchImagesImpl(query) {
  if (!query?.trim()) return { found: false, reason: "Query vazia" };
  if (!process.env.SERPER_API_KEY) return { found: false, reason: "SERPER_API_KEY não configurada" };
  try {
    const r = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "pt", hl: "pt", num: 9 })
    });
    if (!r.ok) return { found: false, reason: `Erro Serper Images: ${r.status}` };
    const data = await r.json();
    const images = (data.images || []).slice(0, 9).map(x => ({
      title: x.title || '',
      imageUrl: x.imageUrl || '',
      thumbnailUrl: x.thumbnailUrl || '',
      source: x.source || '',
      link: x.link || '',
    }));
    return { found: true, images };
  } catch (e) { return { found: false, reason: `Erro: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════
async function getWeatherImpl(city) {
  if (!city?.trim()) return { found: false, reason: "Cidade vazia" };
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!geoRes.ok) return { found: false, reason: "Erro ao geocodificar cidade" };
    const geoData = await geoRes.json();
    if (!geoData.results?.length) return { found: false, reason: `Cidade "${city}" não encontrada` };
    const loc = geoData.results[0];
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto&forecast_days=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!weatherRes.ok) return { found: false, reason: "Erro ao obter clima" };
    const weatherData = await weatherRes.json();
    const current = weatherData.current;
    const weatherCodes = {
      0: { desc: "Céu limpo", emoji: "☀️" }, 1: { desc: "Maioritariamente limpo", emoji: "🌤️" },
      2: { desc: "Parcialmente nublado", emoji: "⛅" }, 3: { desc: "Nublado", emoji: "☁️" },
      45: { desc: "Névoa", emoji: "🌫️" }, 48: { desc: "Névoa com gelo", emoji: "🌫️" },
      51: { desc: "Chuviscos leves", emoji: "🌦️" }, 61: { desc: "Chuva leve", emoji: "🌧️" },
      71: { desc: "Neve leve", emoji: "🌨️" }, 80: { desc: "Aguaceiros", emoji: "🌧️" },
      95: { desc: "Trovoada", emoji: "⛈️" },
    };
    const wCode = weatherCodes[current.weather_code] || { desc: "Variável", emoji: "🌡️" };
    const weatherInfo = {
      city: loc.name,
      country: loc.country || '',
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      windSpeed: Math.round(current.wind_speed_10m),
      description: wCode.desc,
      emoji: wCode.emoji,
    };
    const image = await generateWeatherCard(weatherInfo);
    return { found: true, ...weatherInfo, image_base64: image };
  } catch (e) { return { found: false, reason: `Erro: ${e.message}` }; }
}

async function generateWeatherCard(info) {
  try {
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(520, 280);
    const ctx = canvas.getContext('2d');
    // fundo gradiente
    const grad = ctx.createLinearGradient(0, 0, 520, 280);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#16213e');
    ctx.fillStyle = grad;
    ctx.roundRect(0, 0, 520, 280, 20);
    ctx.fill();
    // card interior
    ctx.fillStyle = 'rgba(111, 90, 246, 0.15)';
    ctx.roundRect(16, 16, 488, 248, 14);
    ctx.fill();
    // emoji
    ctx.font = '64px serif';
    ctx.fillText(info.emoji, 32, 100);
    // cidade
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(`${info.city}${info.country ? ', ' + info.country : ''}`, 32, 148);
    // descrição
    ctx.fillStyle = '#a0a0c0';
    ctx.font = '16px sans-serif';
    ctx.fillText(info.description, 32, 174);
    // temperatura grande
    ctx.fillStyle = '#6F5AF6';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText(`${info.temperature}°C`, 290, 120);
    // sensação
    ctx.fillStyle = '#a0a0c0';
    ctx.font = '15px sans-serif';
    ctx.fillText(`Sensação: ${info.feelsLike}°C`, 290, 150);
    ctx.fillText(`Humidade: ${info.humidity}%`, 290, 174);
    ctx.fillText(`Vento: ${info.windSpeed} km/h`, 290, 198);
    // data
    ctx.fillStyle = '#606080';
    ctx.font = '13px sans-serif';
    ctx.fillText(getCurrentDateInfo().full, 32, 240);
    return canvas.toBuffer('image/png').toString('base64');
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════
// GRÁFICOS — chartjs-node-canvas
// ═══════════════════════════════════════════════════════════
const CHART_COLORS = [
  '#6F5AF6','#5AF6D4','#F65A8E','#F6C75A','#5A8EF6',
  '#C75AF6','#5AF65A','#F6955A','#5ACDF6','#F65A5A'
];

async function generateChartImpl(chartType, title, labels, datasets) {
  try {
    const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
    const renderer = new ChartJSNodeCanvas({ width: 800, height: 500, backgroundColour: '#1a1a2e' });
    const chartDatasets = datasets.map((ds, i) => {
      const color = ds.color || CHART_COLORS[i % CHART_COLORS.length];
      const base = { label: ds.label || `Dataset ${i+1}`, data: ds.data };
      if (chartType === 'line') {
        return { ...base, borderColor: color, backgroundColor: color + '33', tension: 0.4, fill: true, pointBackgroundColor: color };
      }
      if (chartType === 'bar') {
        return { ...base, backgroundColor: datasets.length === 1
          ? labels.map((_, j) => CHART_COLORS[j % CHART_COLORS.length])
          : color, borderRadius: 6 };
      }
      return { ...base, backgroundColor: labels.map((_, j) => CHART_COLORS[j % CHART_COLORS.length]), borderWidth: 0 };
    });
    const config = {
      type: chartType,
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: false,
        plugins: {
          title: { display: !!title, text: title || '', color: '#ffffff', font: { size: 18, weight: 'bold' } },
          legend: { labels: { color: '#cccccc' } },
        },
        scales: ['pie','doughnut','polarArea','radar'].includes(chartType) ? {} : {
          x: { ticks: { color: '#aaaaaa' }, grid: { color: '#333355' } },
          y: { ticks: { color: '#aaaaaa' }, grid: { color: '#333355' } },
        },
      },
    };
    const buffer = await renderer.renderToBuffer(config);
    return { success: true, mime_type: 'image/png', content_base64: buffer.toString('base64') };
  } catch (e) { return { success: false, reason: `Erro ao gerar gráfico: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// QR CODE
// ═══════════════════════════════════════════════════════════
async function generateQrcodeImpl(content, size = 300) {
  try {
    const QRCode = require('qrcode');
    const buffer = await QRCode.toBuffer(content, {
      width: size,
      margin: 2,
      color: { dark: '#6F5AF6', light: '#1a1a2e' },
      errorCorrectionLevel: 'H',
    });
    return { success: true, mime_type: 'image/png', content_base64: buffer.toString('base64') };
  } catch (e) { return { success: false, reason: `Erro QR code: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// BARCODE
// ═══════════════════════════════════════════════════════════
async function generateBarcodeImpl(content, format = 'code128') {
  try {
    const bwipjs = require('bwip-js');
    const formatMap = { code128: 'code128', ean13: 'ean13', ean8: 'ean8', upca: 'upca', qrcode: 'qrcode' };
    const bcFormat = formatMap[format] || 'code128';
    const buffer = await bwipjs.toBuffer({
      bcid: bcFormat,
      text: content,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
      backgroundcolor: '1a1a2e',
      barcolor: '6F5AF6',
      textcolor: 'ffffff',
    });
    return { success: true, mime_type: 'image/png', content_base64: buffer.toString('base64') };
  } catch (e) { return { success: false, reason: `Erro barcode: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// MATH — avaliação + gráfico de função
// ═══════════════════════════════════════════════════════════
async function generateMathImpl(expression, variableRange) {
  try {
    const math = require('mathjs');
    let result, isFunction = false, functionPoints = null;

    // detecta se é função com variável
    const hasVariable = /[a-df-wyz]/i.test(expression.replace(/sqrt|sin|cos|tan|log|exp|pi|abs/gi, ''));
    if (hasVariable) {
      isFunction = true;
      const min = variableRange?.min ?? -10;
      const max = variableRange?.max ?? 10;
      const steps = 100;
      const xs = Array.from({ length: steps }, (_, i) => min + (i / (steps - 1)) * (max - min));
      try {
        const compiled = math.compile(expression);
        functionPoints = xs.map(x => {
          try { return { x, y: compiled.evaluate({ x }) }; } catch { return { x, y: null }; }
        }).filter(p => p.y !== null && isFinite(p.y));
        result = `f(x) = ${expression}`;
      } catch (e) { result = `Erro ao avaliar: ${e.message}`; isFunction = false; }
    } else {
      try {
        const evaluated = math.evaluate(expression);
        result = math.format(evaluated, { precision: 10 });
      } catch (e) { result = `Erro: ${e.message}`; }
    }

    // gera imagem
    const { createCanvas } = require('canvas');
    const W = 700, H = isFunction ? 500 : 280;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // fundo
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#16213e');
    ctx.fillStyle = grad;
    ctx.roundRect(0, 0, W, H, 16);
    ctx.fill();

    if (isFunction && functionPoints?.length > 1) {
      // gráfico de função
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`f(x) = ${expression}`, 20, 36);

      const PAD = 60;
      const gW = W - PAD * 2, gH = H - PAD * 2 - 20;
      const ys = functionPoints.map(p => p.y);
      const xs = functionPoints.map(p => p.x);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const toCanvasX = x => PAD + ((x - minX) / (maxX - minX)) * gW;
      const toCanvasY = y => PAD + 30 + ((maxY - y) / (maxY - minY)) * gH;

      // grid
      ctx.strokeStyle = '#333355';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const y = PAD + 30 + (i / 5) * gH;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(PAD + gW, y); ctx.stroke();
        const x = PAD + (i / 5) * gW;
        ctx.beginPath(); ctx.moveTo(x, PAD + 30); ctx.lineTo(x, PAD + 30 + gH); ctx.stroke();
      }

      // eixo zero Y
      if (minX <= 0 && maxX >= 0) {
        const zeroX = toCanvasX(0);
        ctx.strokeStyle = '#555577';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(zeroX, PAD + 30); ctx.lineTo(zeroX, PAD + 30 + gH); ctx.stroke();
      }
      // eixo zero X
      if (minY <= 0 && maxY >= 0) {
        const zeroY = toCanvasY(0);
        ctx.strokeStyle = '#555577';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(PAD, zeroY); ctx.lineTo(PAD + gW, zeroY); ctx.stroke();
      }

      // curva
      ctx.strokeStyle = '#6F5AF6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      functionPoints.forEach((p, i) => {
        const cx = toCanvasX(p.x), cy = toCanvasY(p.y);
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      });
      ctx.stroke();

      // labels eixos
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '12px sans-serif';
      ctx.fillText(minX.toFixed(1), PAD, PAD + 30 + gH + 20);
      ctx.fillText(maxX.toFixed(1), PAD + gW - 20, PAD + 30 + gH + 20);
      ctx.fillText(maxY.toFixed(2), 2, PAD + 36);
      ctx.fillText(minY.toFixed(2), 2, PAD + 30 + gH);

    } else {
      // card de resultado simples
      ctx.fillStyle = 'rgba(111, 90, 246, 0.15)';
      ctx.roundRect(16, 16, W - 32, H - 32, 12);
      ctx.fill();

      ctx.fillStyle = '#a0a0c0';
      ctx.font = '18px sans-serif';
      ctx.fillText('Expressão:', 36, 68);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(expression, 36, 102);

      ctx.fillStyle = '#606080';
      ctx.font = '16px sans-serif';
      ctx.fillText('Resultado:', 36, 148);

      ctx.fillStyle = '#6F5AF6';
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(String(result), 36, 210);
    }

    return {
      success: true,
      mime_type: 'image/png',
      content_base64: canvas.toBuffer('image/png').toString('base64'),
      result,
      is_function: isFunction,
    };
  } catch (e) { return { success: false, reason: `Erro math: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// TABELA VISUAL
// ═══════════════════════════════════════════════════════════
async function generateTableImageImpl(title, headers, rows, theme = 'purple') {
  try {
    const { createCanvas } = require('canvas');
    const themes = {
      dark:   { bg: '#1a1a2e', header: '#2a2a4e', row: '#1e1e3a', rowAlt: '#222240', text: '#ffffff', headerText: '#6F5AF6', border: '#333355' },
      light:  { bg: '#f8f8ff', header: '#e8e8ff', row: '#ffffff', rowAlt: '#f0f0ff', text: '#1a1a2e', headerText: '#6F5AF6', border: '#ccccee' },
      purple: { bg: '#1a1a2e', header: '#6F5AF6', row: '#1e1e3a', rowAlt: '#222240', text: '#ffffff', headerText: '#ffffff', border: '#6F5AF6' },
    };
    const T = themes[theme] || themes.purple;
    const colW = Math.max(120, Math.floor(700 / headers.length));
    const rowH = 44;
    const W = colW * headers.length + 40;
    const H = rowH * (rows.length + 1) + 60 + (title ? 50 : 0);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);
    let startY = 20;
    if (title) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(title, 20, startY + 28);
      startY += 50;
    }
    // header
    ctx.fillStyle = T.header;
    ctx.fillRect(20, startY, W - 40, rowH);
    headers.forEach((h, i) => {
      ctx.fillStyle = T.headerText;
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(String(h).slice(0, 20), 20 + i * colW + 10, startY + 28);
    });
    // rows
    rows.forEach((row, ri) => {
      const y = startY + rowH * (ri + 1);
      ctx.fillStyle = ri % 2 === 0 ? T.row : T.rowAlt;
      ctx.fillRect(20, y, W - 40, rowH);
      row.forEach((cell, ci) => {
        ctx.fillStyle = T.text;
        ctx.font = '13px sans-serif';
        ctx.fillText(String(cell ?? '').slice(0, 22), 20 + ci * colW + 10, y + 28);
      });
    });
    // bordas
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(20, startY, W - 40, rowH * (rows.length + 1));
    headers.forEach((_, i) => {
      if (i === 0) return;
      ctx.beginPath();
      ctx.moveTo(20 + i * colW, startY);
      ctx.lineTo(20 + i * colW, startY + rowH * (rows.length + 1));
      ctx.stroke();
    });
    return { success: true, mime_type: 'image/png', content_base64: canvas.toBuffer('image/png').toString('base64') };
  } catch (e) { return { success: false, reason: `Erro tabela: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// HTML → IMAGEM via satori + sharp
// ═══════════════════════════════════════════════════════════
async function generateHtmlImageImpl(html, width = 800, height = 600) {
  try {
    const satori = (await import('satori')).default;
    const sharp = require('sharp');

    // converte HTML simples em estrutura satori (jsx-like objects)
    // satori não aceita HTML diretamente — converte para estrutura React-like
    const element = {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: `${width}px`,
          minHeight: `${height}px`,
          backgroundColor: '#1a1a2e',
          padding: '32px',
          fontFamily: 'sans-serif',
          color: '#ffffff',
          fontSize: '16px',
        },
        children: parseHtmlToSatori(html),
      },
    };

    const svg = await satori(element, {
      width,
      height,
      fonts: [],
    });

    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { success: true, mime_type: 'image/png', content_base64: buffer.toString('base64') };
  } catch (e) { return { success: false, reason: `Erro html→imagem: ${e.message}` }; }
}

function parseHtmlToSatori(html) {
  // parser simples de HTML para estrutura satori
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

  function nodeToSatori(el) {
    if (el.type === 'text') {
      const text = el.data?.trim();
      return text ? text : null;
    }
    if (el.type !== 'tag') return null;
    const tag = el.tagName?.toLowerCase();
    const children = $(el).contents().toArray()
      .map(nodeToSatori)
      .filter(Boolean);

    const styleMap = {
      h1: { fontSize: '32px', fontWeight: 'bold', marginBottom: '16px', color: '#6F5AF6' },
      h2: { fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: '#8B7AF6' },
      h3: { fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' },
      p:  { marginBottom: '12px', lineHeight: '1.6' },
      strong: { fontWeight: 'bold' },
      b: { fontWeight: 'bold' },
      em: { fontStyle: 'italic' },
      i:  { fontStyle: 'italic' },
      ul: { marginBottom: '12px', paddingLeft: '20px' },
      ol: { marginBottom: '12px', paddingLeft: '20px' },
      li: { marginBottom: '6px', display: 'flex' },
      code: { backgroundColor: '#2a2a4e', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '14px' },
      pre: { backgroundColor: '#2a2a4e', padding: '16px', borderRadius: '8px', marginBottom: '12px', overflow: 'hidden' },
      blockquote: { borderLeft: '4px solid #6F5AF6', paddingLeft: '16px', color: '#aaaacc', marginBottom: '12px' },
      hr: { borderTop: '1px solid #333355', marginBottom: '16px' },
      div: { display: 'flex', flexDirection: 'column' },
      span: { display: 'flex' },
      section: { display: 'flex', flexDirection: 'column', marginBottom: '16px' },
    };

    const style = styleMap[tag] || {};

    // extrai style inline
    const inlineStyle = $(el).attr('style') || '';
    const parsedInline = parseInlineStyle(inlineStyle);

    return {
      type: tag === 'li' ? 'div' : (tag === 'span' || tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'code' ? 'span' : 'div'),
      props: {
        style: { display: 'flex', flexDirection: 'column', ...style, ...parsedInline },
        children: children.length > 0 ? children : undefined,
      },
    };
  }

  function parseInlineStyle(styleStr) {
    if (!styleStr) return {};
    const result = {};
    styleStr.split(';').forEach(rule => {
      const [prop, val] = rule.split(':').map(s => s.trim());
      if (prop && val) {
        const camel = prop.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
        result[camel] = val;
      }
    });
    return result;
  }

  const bodyEl = $('body')[0] || $.root()[0];
  return $(bodyEl).contents().toArray().map(nodeToSatori).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════
// DOCUMENTOS (mantidos do original + melhorados)
// ═══════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const cheerio = require('cheerio');
const HtmlToDocx = require('@turbodocx/html-to-docx');

async function createPdfImpl(title, htmlContent) {
  return htmlToPdfImpl(htmlContent, title);
}

async function createDocxImpl(title, htmlContent) {
  return htmlToDocxImpl(htmlContent, title);
}

async function createXlsxImpl(sheetName, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName || 'Planilha1');
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6F5AF6' } };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  (rows || []).forEach(r => sheet.addRow(r));
  sheet.columns.forEach(c => { c.width = 20; });
  const buffer = await wb.xlsx.writeBuffer();
  return { success: true, filename: `sheet_${Date.now()}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: Buffer.from(buffer).toString('base64') };
}

async function createPptxImpl(title, slides) {
  const pptx = new PptxGenJS();
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' };
  const t = pptx.addSlide();
  t.background = { color: '1a1a2e' };
  t.addText(title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 36, bold: true, align: 'center', color: '6F5AF6' });
  (slides || []).forEach(s => {
    const slide = pptx.addSlide();
    slide.background = { color: '1a1a2e' };
    slide.addText(s.heading || '', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true, color: '6F5AF6' });
    const bullets = (s.bullets || []).map(b => ({ text: b, options: { bullet: true, breakLine: true, color: 'ffffff' } }));
    if (bullets.length > 0) slide.addText(bullets, { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 16, color: 'cccccc' });
  });
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return { success: true, filename: `pres_${Date.now()}.pptx`, mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', content_base64: Buffer.from(buffer).toString('base64') };
}

async function csvToXlsxImpl(csvContent) {
  const lines = (csvContent || '').trim().split('\n');
  const rows = lines.map(l => {
    const result = [];
    let current = '', inQuotes = false;
    for (const ch of l) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  });
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Dados');
  rows.forEach((r, i) => {
    const row = sheet.addRow(r);
    if (i === 0) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6F5AF6' } }; }
  });
  sheet.columns.forEach(c => { c.width = 18; });
  const buffer = await wb.xlsx.writeBuffer();
  return { success: true, filename: `converted_${Date.now()}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: Buffer.from(buffer).toString('base64') };
}

function jsonTransformImpl(jsonDataStr) {
  try {
    const data = JSON.parse(jsonDataStr);
    if (!Array.isArray(data) || data.length === 0) return { error: "json_data deve ser um array não vazio" };
    const headers = Object.keys(data[0]);
    const rows = data.map(o => headers.map(h => String(o[h] ?? '')));
    return { headers, rows };
  } catch (e) { return { error: `JSON inválido: ${e.message}` }; }
}

// HTML → DOCX
async function htmlToDocxImpl(htmlContent, filename) {
  if (!htmlContent?.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const buffer = await HtmlToDocx(htmlContent);
    return { success: true, filename: (filename || `doc_${Date.now()}`).replace(/\.docx$/i, '') + '.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content_base64: Buffer.from(buffer).toString('base64') };
  } catch (e) { return { success: false, reason: `Erro HTML→DOCX: ${e.message}` }; }
}

// HTML → PDF
const BLOCK_TAGS_PDF = new Set(['h1','h2','h3','h4','h5','h6','p','ul','ol','table','br','hr']);
function renderInline($, node, doc, style) {
  $(node).contents().each((_, el) => {
    if (el.type === 'text') {
      const text = el.data || '';
      if (!text.trim()) return;
      let font = 'Helvetica';
      if (style.bold && style.italic) font = 'Helvetica-BoldOblique';
      else if (style.bold) font = 'Helvetica-Bold';
      else if (style.italic) font = 'Helvetica-Oblique';
      doc.font(font).text(text, { continued: true });
      return;
    }
    if (el.type !== 'tag') return;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'b' || tag === 'strong') { renderInline($, el, doc, { ...style, bold: true }); return; }
    if (tag === 'i' || tag === 'em') { renderInline($, el, doc, { ...style, italic: true }); return; }
    if (tag === 'br') { doc.text('\n', { continued: true }); return; }
    renderInline($, el, doc, style);
  });
}
function renderBlock($, node, doc) {
  $(node).contents().each((_, el) => {
    if (el.type === 'text') {
      const text = el.data?.trim();
      if (text) doc.font('Helvetica').fontSize(12).text(text);
      return;
    }
    if (el.type !== 'tag') return;
    const tag = el.tagName?.toLowerCase();
    if (!BLOCK_TAGS_PDF.has(tag)) { renderBlock($, el, doc); return; }
    switch (tag) {
      case 'h1': doc.moveDown(0.5).font('Helvetica-Bold').fontSize(22); renderInline($, el, doc, { bold: true, italic: false }); doc.text('', { continued: false }); doc.font('Helvetica').fontSize(12).moveDown(0.3); break;
      case 'h2': doc.moveDown(0.4).font('Helvetica-Bold').fontSize(18); renderInline($, el, doc, { bold: true, italic: false }); doc.text('', { continued: false }); doc.font('Helvetica').fontSize(12).moveDown(0.3); break;
      case 'h3': case 'h4': case 'h5': case 'h6': doc.moveDown(0.3).font('Helvetica-Bold').fontSize(14); renderInline($, el, doc, { bold: true, italic: false }); doc.text('', { continued: false }); doc.font('Helvetica').fontSize(12).moveDown(0.2); break;
      case 'p': doc.moveDown(0.3).fontSize(12).font('Helvetica'); renderInline($, el, doc, { bold: false, italic: false }); doc.text('', { continued: false }); break;
      case 'ul': case 'ol':
        $(el).children('li').each((i, li) => {
          const bullet = tag === 'ol' ? `${i+1}. ` : '• ';
          doc.moveDown(0.1).fontSize(12).font('Helvetica').text(bullet, { continued: true, indent: 20 });
          renderInline($, li, doc, { bold: false, italic: false });
          doc.text('', { continued: false });
        });
        break;
      case 'table':
        doc.moveDown(0.3);
        $(el).find('tr').each((_, tr) => {
          const cells = $(tr).find('td,th').map((_, td) => $(td).text().trim()).get();
          doc.fontSize(11).font('Helvetica').text(cells.join('   |   '));
        });
        doc.moveDown(0.3);
        break;
      case 'hr': doc.moveDown(0.3).moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke().moveDown(0.3); break;
      case 'br': doc.moveDown(0.2); break;
    }
  });
}
async function htmlToPdfImpl(htmlContent, title) {
  if (!htmlContent?.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const $ = cheerio.load(htmlContent);
    return await new Promise((resolve) => {
      const chunks = [];
      const doc = new PDFDocument({ margin: 50 });
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve({ success: true, filename: `doc_${Date.now()}.pdf`, mime_type: 'application/pdf', content_base64: Buffer.concat(chunks).toString('base64') }));
      if (title) { doc.fontSize(20).font('Helvetica-Bold').text(title, { underline: true }); doc.font('Helvetica').moveDown(); }
      const bodyRoot = $('body')[0] || $.root()[0];
      renderBlock($, bodyRoot, doc);
      doc.end();
    });
  } catch (e) { return { success: false, reason: `Erro HTML→PDF: ${e.message}` }; }
}
async function htmlToXlsxImpl(htmlContent, sheetName) {
  if (!htmlContent?.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const $ = cheerio.load(htmlContent);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(sheetName || 'Planilha1');
    const tables = $('table');
    if (tables.length > 0) {
      $(tables[0]).find('tr').each((i, tr) => {
        const cells = $(tr).find('td,th').map((_, td) => $(td).text().trim()).get();
        if (cells.length > 0) {
          const row = sheet.addRow(cells);
          if (i === 0) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6F5AF6' } }; }
        }
      });
    } else {
      const lines = $('p,li').map((_, el) => $(el).text().trim()).get().filter(Boolean);
      if (lines.length === 0) return { success: false, reason: "Nenhum conteúdo encontrado" };
      lines.forEach(l => sheet.addRow([l]));
    }
    sheet.columns.forEach(c => { c.width = 22; });
    const buffer = await wb.xlsx.writeBuffer();
    return { success: true, filename: `sheet_${Date.now()}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: Buffer.from(buffer).toString('base64') };
  } catch (e) { return { success: false, reason: `Erro HTML→XLSX: ${e.message}` }; }
}
async function htmlToPptxImpl(htmlContent, title) {
  if (!htmlContent?.trim()) return { success: false, reason: "html_content vazio" };
  try {
    const $ = cheerio.load(htmlContent);
    const bodyRoot = $('body')[0] || $.root()[0];
    const allEls = $(bodyRoot).find('*').toArray();
    const slidesData = [];
    let current = null;
    const consumed = new Set();
    for (const el of allEls) {
      if (consumed.has(el)) continue;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'h1' || tag === 'h2') {
        current = { heading: $(el).text().trim(), bullets: [] };
        slidesData.push(current);
        continue;
      }
      if (!current) continue;
      if (tag === 'ul' || tag === 'ol') {
        $(el).find('li').each((_, li) => { current.bullets.push($(li).text().trim()); consumed.add(li); });
        consumed.add(el);
      } else if (tag === 'li') {
        const text = $(el).text().trim();
        if (text) current.bullets.push(text);
      } else if (tag === 'p' || /^h[3-6]$/.test(tag)) {
        const text = $(el).text().trim();
        if (text) current.bullets.push(text);
      }
    }
    if (slidesData.length === 0) {
      slidesData.push({ heading: title || 'Apresentação', bullets: [$(bodyRoot).text().trim()] });
    }
    const pptx = new PptxGenJS();
    const t = pptx.addSlide();
    t.background = { color: '1a1a2e' };
    t.addText(title || slidesData[0]?.heading || 'Apresentação', { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 36, bold: true, align: 'center', color: '6F5AF6' });
    slidesData.forEach(s => {
      const slide = pptx.addSlide();
      slide.background = { color: '1a1a2e' };
      slide.addText(s.heading || '', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true, color: '6F5AF6' });
      const bullets = s.bullets.filter(Boolean).map(b => ({ text: b, options: { bullet: true, breakLine: true, color: 'ffffff' } }));
      if (bullets.length > 0) slide.addText(bullets, { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 16, color: 'cccccc' });
    });
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    return { success: true, filename: `pres_${Date.now()}.pptx`, mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', content_base64: Buffer.from(buffer).toString('base64') };
  } catch (e) { return { success: false, reason: `Erro HTML→PPTX: ${e.message}` }; }
}

async function convertDocumentImpl(sourceFormat, targetFormat, contentBase64, filename) {
  const src = (sourceFormat || '').toLowerCase(), tgt = (targetFormat || '').toLowerCase();
  if (!contentBase64) return { success: false, reason: "content_base64 obrigatório" };
  try {
    const buffer = Buffer.from(contentBase64, 'base64');
    if (src === 'csv' && tgt === 'xlsx') return await csvToXlsxImpl(buffer.toString('utf-8'));
    if (src === 'txt' && tgt === 'pdf') return await htmlToPdfImpl(`<p>${buffer.toString('utf-8').replace(/\n/g, '</p><p>')}</p>`, filename || 'Documento');
    if (src === 'txt' && tgt === 'docx') return await htmlToDocxImpl(`<p>${buffer.toString('utf-8').replace(/\n/g, '</p><p>')}</p>`, filename);
    if (src === 'html' && tgt === 'docx') return await htmlToDocxImpl(buffer.toString('utf-8'), filename);
    if (src === 'html' && tgt === 'pdf') return await htmlToPdfImpl(buffer.toString('utf-8'), filename || 'Documento');
    if (src === 'html' && tgt === 'xlsx') return await htmlToXlsxImpl(buffer.toString('utf-8'), filename);
    if (src === 'html' && tgt === 'pptx') return await htmlToPptxImpl(buffer.toString('utf-8'), filename || 'Apresentação');
    if (src === 'json' && tgt === 'xlsx') {
      const t = jsonTransformImpl(buffer.toString('utf-8'));
      if (t.error) return { success: false, reason: t.error };
      return await createXlsxImpl(filename || 'Dados', t.headers, t.rows);
    }
    return { success: false, reason: `Conversão de ${src} para ${tgt} não suportada.` };
  } catch (e) { return { success: false, reason: `Erro ao converter: ${e.message}` }; }
}

// ═══════════════════════════════════════════════════════════
// SEARCH MARKET
// ═══════════════════════════════════════════════════════════
async function tryMarketAsCrypto(q) {
  try {
    const sr = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
    if (!sr.ok) return null;
    const sd = await sr.json();
    const coins = sd.coins || [];
    if (!coins.length) return null;
    const first = coins[0];
    const { id, name } = first;
    const symbol = (first.symbol || '').toUpperCase();
    if (!id || !symbol || !name) return null;
    const pr = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`, { signal: AbortSignal.timeout(8000) });
    let price = null, changePercent24h = null;
    if (pr.ok) {
      const pd = await pr.json();
      const entry = pd[id];
      if (entry) { price = entry.usd ?? null; changePercent24h = entry.usd_24h_change ?? null; }
    }
    return { found: true, type: 'crypto', symbol, name, coingeckoId: id, price, currency: 'USD', changePercent24h, source: 'coingecko' };
  } catch { return null; }
}
async function tryMarketAsForex(q) {
  try {
    const r = await fetch("https://api.frankfurter.app/currencies", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const names = await r.json();
    const c = q.trim().toUpperCase().replace(/[^A-Z/]/g, '');
    if (!c) return null;
    let base = 'USD', target = c;
    if (c.includes('/')) { [base, target] = c.split('/'); }
    else if (c.length !== 3 || !names[c]) return null;
    const res = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${target}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    const rate = d.rates?.[target];
    if (typeof rate !== 'number') return null;
    return { found: true, type: 'forex', symbol: `${base}/${target}`, name: names[target] || target, price: rate, currency: target, changePercent24h: null, source: 'frankfurter' };
  } catch { return null; }
}
async function tryMarketAsStock(q) {
  const ticker = q.trim().toLowerCase().replace(/\s+/g, '');
  if (!ticker) return null;
  try {
    const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(ticker)}&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const csv = await r.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const headers = lines[0].split(','), values = lines[1].split(',');
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = values[i]; });
    const close = parseFloat(row.Close), open = parseFloat(row.Open);
    if (isNaN(close) || !row.Symbol || row.Symbol === 'N/D') return null;
    const changePercent = (!isNaN(open) && open !== 0) ? ((close - open) / open) * 100 : null;
    return { found: true, type: 'stock', symbol: row.Symbol.toUpperCase(), name: row.Symbol.toUpperCase(), price: close, currency: 'USD', changePercent24h: changePercent, source: 'stooq' };
  } catch { return null; }
}
async function searchMarketImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: `Ativo não encontrado para "${query}".` };
  const results = await Promise.allSettled([
    tryMarketAsCrypto(trimmed),
    tryMarketAsForex(trimmed),
    tryMarketAsStock(trimmed),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return { found: false, reason: `Nenhum ativo encontrado para "${trimmed}".` };
}

// ═══════════════════════════════════════════════════════════
// SEARCH PLACE
// ═══════════════════════════════════════════════════════════
async function searchPlaceImpl(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt&q=${encodeURIComponent(trimmed)}`, { headers: { "User-Agent": "NexaApp/1.0" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const list = await r.json();
      if (list.length > 0) {
        const f = list[0];
        const lat = parseFloat(f.lat), lng = parseFloat(f.lon);
        if (!isNaN(lat) && !isNaN(lng)) return { found: true, name: f.display_name, lat, lng };
      }
    }
  } catch {}
  return { found: false, reason: `Lugar "${trimmed}" não encontrado.` };
}

// ═══════════════════════════════════════════════════════════
// SEARCH CALENDAR DATE
// ═══════════════════════════════════════════════════════════
const WEEKDAYS_PT = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const MONTHS_PT = { janeiro:0,fevereiro:1,março:2,abril:3,maio:4,junho:5,julho:6,agosto:7,setembro:8,outubro:9,novembro:10,dezembro:11 };
function toIsoDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function formatHumanLabel(d) { return `${WEEKDAYS_PT[d.getDay()]}, ${d.getDate()} de ${Object.keys(MONTHS_PT)[d.getMonth()]}`; }
async function searchCalendarDateImpl(query) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return { found: false, reason: "Query vazia" };
  const now = new Date(); now.setHours(0,0,0,0);
  if (trimmed.includes('hoje')) return { found: true, isoDate: toIsoDate(now), humanLabel: formatHumanLabel(now) };
  if (trimmed.includes('depois de amanhã') || trimmed.includes('depois de amanha')) { const d = new Date(now); d.setDate(d.getDate()+2); return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) }; }
  if (trimmed.includes('amanhã') || trimmed.includes('amanha')) { const d = new Date(now); d.setDate(d.getDate()+1); return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) }; }
  for (let i = 0; i < WEEKDAYS_PT.length; i++) {
    if (trimmed.includes(WEEKDAYS_PT[i])) {
      const d = new Date(now); let diff = (i - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
      d.setDate(d.getDate()+diff);
      return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
    }
  }
  const dm = trimmed.match(/(\d{1,2})\s+(?:de\s+)?([a-zçã]+)/);
  if (dm) {
    const day = parseInt(dm[1],10), monthIdx = MONTHS_PT[dm[2]];
    if (monthIdx !== undefined && day >= 1 && day <= 31) {
      let d = new Date(now.getFullYear(), monthIdx, day);
      if (d < now) d = new Date(now.getFullYear()+1, monthIdx, day);
      return { found: true, isoDate: toIsoDate(d), humanLabel: formatHumanLabel(d) };
    }
  }
  return { found: false, reason: `Não foi possível interpretar "${trimmed}" como data.` };
}

// ═══════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════
const HEAVY_TOOLS = new Set([
  'create_pdf','create_docx','create_xlsx','create_pptx',
  'csv_to_xlsx','convert_document',
  'html_to_docx','html_to_pdf','html_to_xlsx','html_to_pptx',
  'generate_chart','generate_math','generate_table_image','generate_html_image',
  'generate_weather',
]);

async function runTool(name, input) {
  switch (name) {
    case "web_search": return await webSearchImpl(input?.query || '');
    case "search_images": return await searchImagesImpl(input?.query || '');
    case "search_market": return await searchMarketImpl(input?.query || '');
    case "search_place": return await searchPlaceImpl(input?.query || '');
    case "search_calendar_date": return await searchCalendarDateImpl(input?.query || '');
    case "get_weather": return await getWeatherImpl(input?.city || '');
    case "generate_chart": return await generateChartImpl(input.chart_type, input.title, input.labels, input.datasets);
    case "generate_qrcode": return await generateQrcodeImpl(input.content, input.size);
    case "generate_barcode": return await generateBarcodeImpl(input.content, input.format);
    case "generate_math": return await generateMathImpl(input.expression, input.variable_range);
    case "generate_table_image": return await generateTableImageImpl(input.title, input.headers, input.rows, input.theme);
    case "generate_html_image": return await generateHtmlImageImpl(input.html, input.width, input.height);
    case "create_pdf": return await createPdfImpl(input.title, input.html_content);
    case "create_docx": return await createDocxImpl(input.title, input.html_content);
    case "create_xlsx": return await createXlsxImpl(input.sheet_name, input.headers, input.rows);
    case "create_pptx": return await createPptxImpl(input.title, input.slides);
    case "csv_to_xlsx": return await csvToXlsxImpl(input.csv_content);
    case "json_transform": return jsonTransformImpl(input.json_data);
    case "convert_document": return await convertDocumentImpl(input.source_format, input.target_format, input.content_base64, input.filename);
    case "html_to_docx": return await htmlToDocxImpl(input.html_content, input.filename);
    case "html_to_pdf": return await htmlToPdfImpl(input.html_content, input.title);
    case "html_to_xlsx": return await htmlToXlsxImpl(input.html_content, input.sheet_name);
    case "html_to_pptx": return await htmlToPptxImpl(input.html_content, input.title);
    case "convert_document": return await convertDocumentImpl(input.source_format, input.target_format, input.content_base64, input.filename);
    default: return { found: false, reason: `Tool desconhecida: ${name}` };
  }
}

async function executeTool(name, input) {
  if (HEAVY_TOOLS.has(name)) return enqueueHeavy(withTimeout(() => runTool(name, input)));
  return runTool(name, input);
}

// ═══════════════════════════════════════════════════════════
// ROTAS
// ═══════════════════════════════════════════════════════════
app.get('/tools', (_, res) => res.json({ tools }));

app.post('/tools/execute', async (req, res) => {
  const { name, input } = req.body;
  if (!name) return res.status(400).json({ error: "Campo 'name' é obrigatório" });
  try {
    const result = await executeTool(name, input || {});
    res.json({ tool_name: name, result });
  } catch (e) {
    res.status(500).json({ tool_name: name, error: e.message });
  }
});

app.get('/health', (_, res) => res.json({ status: "ok", date: getCurrentDateInfo() }));

app.listen(PORT, () => console.log(`Nexa Tools na porta ${PORT} — ${getCurrentDateInfo().full}`));