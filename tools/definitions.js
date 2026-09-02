// ═══════════════════════════════════════════════════════════
// DEFINIÇÃO DAS TOOLS — schemas expostos em GET /tools
// ═══════════════════════════════════════════════════════════

const { getCurrentDateInfo, SERPER_MAX_RESULTS } = require('../config');

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
  // ENVIO DE EMAIL
  // ─────────────────────────────────────────────────────────
  {
    name: "send_email",
    description: "Envia um email real para um destinatário específico via Resend. Usa sempre que o utilizador pedir para enviar, mandar ou notificar por email. O campo 'content' aceita HTML (recomendado) para formatação, mas texto simples também funciona.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Endereço de email do destinatário." },
        subject: { type: "string", description: "Assunto do email." },
        content: { type: "string", description: "Corpo do email. Pode ser HTML (ex: <p>...</p>) ou texto simples." },
        from_name: { type: "string", description: "Nome do remetente a mostrar (opcional, ex: 'Nexa'). Se omitido, usa apenas o endereço de email configurado no servidor." }
      },
      required: ["to", "subject", "content"]
    }
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
    description: "Lê ZIP enviado.",
    input_schema: { type: "object", properties: { zip_base64: { type: "string" } }, required: ["zip_base64"] }
  },
  {
    name: "read_pdf_contents",
    description: "Extrai texto de PDF por página.",
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
    description: "Converte PNG em SVG vetorizado (colorido ou preto/transparente).",
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

  // ─────────────────────────────────────────────────────────
  // TOOLS PESADAS — registadas mas só ficam utilizáveis com
  // ENABLE_HEAVY_TOOLS=true.
  // ─────────────────────────────────────────────────────────
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
];

module.exports = { tools };