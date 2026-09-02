// ═══════════════════════════════════════════════════════════
// BUSCA / DADOS EXTERNOS — implementações
// ═══════════════════════════════════════════════════════════

const cheerio = require('cheerio');
const { SERPER_API_KEY, SERPER_MAX_RESULTS, WEBSITE_READ_MAX_CHARS, DESIGN } = require('../config');
const { escapeHtml, fetchImageAsBase64 } = require('../helpers');
const { htmlToSvgViaSatori, svgToPngBuffer } = require('../satori-helpers');

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

module.exports = {
  webSearchImpl,
  readWebsiteImpl,
  searchImagesImpl,
  searchVideosImpl,
  searchBooksImpl,
  downloadImageForProjectImpl,
  searchMarketImpl,
  searchPlaceImpl,
  searchCalendarDateImpl,
  getWeatherImpl,
};