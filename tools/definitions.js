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
    name: "get_weather",
    description: "Obtém o clima atual de uma cidade e gera um card visual PNG.",
    input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
  },

  // ─────────────────────────────────────────────────────────
  // ENVIO DE EMAIL
  // ─────────────────────────────────────────────────────────
  {
    name: "send_email",
    description: "Envia um email real para um destinatário específico via Resend. Usa sempre que o utilizador pedir para enviar, mandar ou notificar por email. O campo 'content' aceita HTML completo (recomendado, com CSS inline) para formatação rica, mas texto simples também funciona. Para incluir imagens dentro do corpo do email, usa o campo 'images': cada imagem vai como anexo embutido, e deve ser referenciada no HTML com <img src=\"cid:O_CONTENT_ID_ESCOLHIDO\">, onde O_CONTENT_ID_ESCOLHIDO tem de ser exatamente igual ao content_id que puseste nesse item de 'images'. Nota: imagens em base64 direto no <img src> NÃO funcionam no Gmail/Outlook — usa sempre o mecanismo de 'images'+cid.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Endereço de email do destinatário." },
        subject: { type: "string", description: "Assunto do email." },
        content: { type: "string", description: "Corpo do email em HTML (recomendado, com CSS inline para estilos) ou texto simples. Para imagens embutidas, referencia via <img src=\"cid:...\">." },
        from_name: { type: "string", description: "Nome do remetente a mostrar (opcional, ex: 'Nexa'). Se omitido, usa apenas o endereço de email configurado no servidor." },
        images: {
          type: "array",
          description: "Opcional. Imagens a embutir no corpo do email via CID. Cada uma tem de ser referenciada no 'content' como <img src=\"cid:content_id\">.",
          items: {
            type: "object",
            properties: {
              content_base64: { type: "string", description: "Imagem em base64 (sem prefixo data:...;base64,)." },
              content_id: { type: "string", description: "Identificador único desta imagem, usado no HTML como cid:esse_id (ex: 'logo1')." },
              filename: { type: "string", description: "Nome do ficheiro (opcional, ex: 'logo.png')." }
            },
            required: ["content_base64", "content_id"]
          }
        }
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

  // ─────────────────────────────────────────────────────────
  // DOCUMENTOS — via reportlab / python-docx (não HTML)
  // ─────────────────────────────────────────────────────────
  {
    name: "create_pdf",
    description: "Gera um PDF estilizado via reportlab (título, parágrafos, bullets, imagem opcional, tabela opcional). Layout profissional com cores, tipografia e paginação — sem depender de HTML/browser.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        paragraphs: { type: "array", items: { type: "string" } },
        bullet_list: { type: "array", items: { type: "string" } },
        image_url: { type: "string" },
        table: {
          type: "object",
          properties: {
            headers: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } }
          }
        }
      },
      required: ["title"]
    }
  },
  {
    name: "create_pdf_structured",
    description: "Gera um PDF via reportlab a partir de múltiplas seções estruturadas (heading, parágrafos, bullets, imagem, tabela por seção). Ideal para relatórios longos e multi-seção.",
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
              table: {
                type: "object",
                properties: {
                  headers: { type: "array", items: { type: "string" } },
                  rows: { type: "array", items: { type: "array", items: { type: "string" } } }
                }
              }
            }
          }
        }
      },
      required: ["title", "sections"]
    }
  },
  {
    name: "create_docx",
    description: "Gera um Word (.docx) via python-docx, com título, seções, tabelas e imagens reais embutidas — sem depender de HTML.",
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
              table: {
                type: "object",
                properties: {
                  headers: { type: "array", items: { type: "string" } },
                  rows: { type: "array", items: { type: "array", items: { type: "string" } } }
                }
              }
            }
          }
        }
      },
      required: ["title", "sections"]
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

  // ─────────────────────────────────────────────────────────
  // CRIAÇÃO DE ARQUIVO GENÉRICO
  // ─────────────────────────────────────────────────────────
  {
    name: "create_file",
    description: "Cria um arquivo de texto/código com qualquer extensão suportada (.py, .dart, .js, .ts, .html, .css, .md, .json, .java, .go, .rs, .sh, .sql, etc). Recebe o nome do arquivo e o conteúdo completo em texto.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Nome do arquivo com extensão, ex: 'main.py', 'index.html'." },
        content: { type: "string", description: "Conteúdo completo do arquivo em texto puro." }
      },
      required: ["filename", "content"]
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

  // ─────────────────────────────────────────────────────────
  // CONVERSÃO
  // ─────────────────────────────────────────────────────────
  {
    name: "csv_to_xlsx",
    description: "Converte CSV em Excel (.xlsx).",
    input_schema: { type: "object", properties: { csv_content: { type: "string" } }, required: ["csv_content"] }
  },
  {
    name: "xlsx_to_json",
    description: "Converte planilha .xlsx enviada (base64) em array JSON de objetos, usando a primeira linha como headers.",
    input_schema: { type: "object", properties: { xlsx_base64: { type: "string" } }, required: ["xlsx_base64"] }
  },

  // ─────────────────────────────────────────────────────────
  // IMAGEM — utilitários
  // ─────────────────────────────────────────────────────────
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
    name: "ocr_extract_text",
    description: "Extrai texto de uma imagem (OCR) via tesseract.js. Suporta português e inglês.",
    input_schema: { type: "object", properties: { image_base64: { type: "string" }, language: { type: "string", enum: ["por", "eng"] } }, required: ["image_base64"] }
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
    name: "merge_pdfs",
    description: "Junta múltiplos PDFs (base64) num único PDF, na ordem dada.",
    input_schema: { type: "object", properties: { pdfs_base64: { type: "array", items: { type: "string" } } }, required: ["pdfs_base64"] }
  },
  {
    name: "split_pdf_pages",
    description: "Extrai um subconjunto de páginas de um PDF para um novo PDF.",
    input_schema: { type: "object", properties: { pdf_base64: { type: "string" }, page_numbers: { type: "array", items: { type: "number" } } }, required: ["pdf_base64", "page_numbers"] }
  }
];

module.exports = { tools };