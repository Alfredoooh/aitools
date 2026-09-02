import sys
import json
import base64
import io
import requests

from reportlab.lib.pagesizes import A4, LETTER, LEGAL
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, BaseDocTemplate, PageTemplate, Frame,
    Paragraph, Spacer, Table, TableStyle, HRFlowable, Image,
    PageBreak, FrameBreak, KeepTogether
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.platypus.flowables import Flowable
from reportlab.graphics.shapes import (
    Drawing, Rect, Circle, Ellipse, Line, Polygon, PolyLine, String, Wedge
)
from reportlab.graphics import renderPM
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.barcode import code128

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

COR_PRIMARIA = colors.HexColor("#0F172A")
COR_SECUNDARIA = colors.HexColor("#4F46E5")
COR_DESTAQUE = colors.HexColor("#F59E0B")
COR_TEXTO = colors.HexColor("#475569")
COR_CINZA_CLARO = colors.HexColor("#F8FAFC")
PALETA = ["#4F46E5", "#0EA5E9", "#F59E0B", "#EF4444", "#10B981", "#8B5CF6", "#EC4899", "#14B8A6"]

TAMANHOS_PAGINA = {"A4": A4, "LETTER": LETTER, "LEGAL": LEGAL}

ALINHAMENTOS = {"left": "LEFT", "center": "CENTER", "right": "RIGHT", "decimal": "DECIMAL"}


def get_styles():
    styles = getSampleStyleSheet()
    return {
        "titulo": ParagraphStyle("Titulo", parent=styles["Title"], fontName="Helvetica-Bold",
                                  fontSize=24, leading=28, textColor=COR_PRIMARIA, spaceAfter=10),
        "subtitulo": ParagraphStyle("Subtitulo", parent=styles["Normal"], fontName="Helvetica",
                                     fontSize=13, leading=17, textColor=COR_SECUNDARIA, spaceAfter=18),
        "heading": ParagraphStyle("Heading", parent=styles["Heading1"], fontName="Helvetica-Bold",
                                   fontSize=15, leading=19, textColor=COR_PRIMARIA,
                                   spaceBefore=16, spaceAfter=8),
        "heading2": ParagraphStyle("Heading2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                                    fontSize=12.5, leading=16, textColor=COR_SECUNDARIA,
                                    spaceBefore=10, spaceAfter=6),
        "corpo": ParagraphStyle("Corpo", parent=styles["Normal"], fontName="Helvetica",
                                 fontSize=10.5, leading=15.5, textColor=COR_TEXTO, spaceAfter=8),
        "bullet": ParagraphStyle("Bullet", parent=styles["Normal"], fontName="Helvetica",
                                  fontSize=10.5, leading=15, leftIndent=14, spaceAfter=5,
                                  textColor=COR_TEXTO),
        "toc_titulo": ParagraphStyle("TocTitulo", parent=styles["Heading1"], fontName="Helvetica-Bold",
                                      fontSize=18, textColor=COR_PRIMARIA, spaceAfter=14),
        "callout": ParagraphStyle("Callout", parent=styles["Normal"], fontName="Helvetica",
                                   fontSize=10, leading=14, textColor=COR_PRIMARIA),
        "celula": ParagraphStyle("Celula", parent=styles["Normal"], fontName="Helvetica",
                                  fontSize=9.5, leading=13, textColor=COR_TEXTO),
    }


def get_toc_styles():
    return [
        ParagraphStyle("TOCHeading1", fontName="Helvetica-Bold", fontSize=11, leading=16,
                       textColor=COR_PRIMARIA, leftIndent=0),
        ParagraphStyle("TOCHeading2", fontName="Helvetica", fontSize=10, leading=14,
                       textColor=COR_TEXTO, leftIndent=14),
    ]


def linha_divisoria():
    return HRFlowable(width="100%", thickness=1.5, color=COR_DESTAQUE, spaceBefore=4, spaceAfter=14)


def rodape_pagina(canvas_obj, doc):
    canvas_obj.saveState()
    canvas_obj.setStrokeColor(COR_CINZA_CLARO)
    canvas_obj.line(2 * cm, 1.7 * cm, doc.pagesize[0] - 2 * cm, 1.7 * cm)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.setFillColor(colors.grey)
    canvas_obj.drawRightString(doc.pagesize[0] - 2 * cm, 1.2 * cm, f"Página {doc.page}")
    canvas_obj.restoreState()


def desenhar_marca_dagua(canvas_obj, doc, watermark):
    canvas_obj.saveState()
    canvas_obj.setFont("Helvetica-Bold", watermark.get("font_size", 60))
    cor = colors.HexColor(watermark.get("color", "#EEEEEE"))
    canvas_obj.setFillColor(cor)
    canvas_obj.setFillAlpha(watermark.get("opacity", 0.3))
    canvas_obj.translate(doc.pagesize[0] / 2, doc.pagesize[1] / 2)
    canvas_obj.rotate(watermark.get("angle", 45))
    canvas_obj.drawCentredString(0, 0, watermark.get("text", ""))
    canvas_obj.restoreState()


def rodape_e_extras_pagina(header_text, watermark):
    def _draw(canvas_obj, doc):
        if watermark:
            desenhar_marca_dagua(canvas_obj, doc, watermark)
        rodape_pagina(canvas_obj, doc)
        if header_text:
            canvas_obj.saveState()
            canvas_obj.setFont("Helvetica-Bold", 8)
            canvas_obj.setFillColor(COR_SECUNDARIA)
            canvas_obj.drawString(2 * cm, doc.pagesize[1] - 1.4 * cm, header_text)
            canvas_obj.setStrokeColor(COR_CINZA_CLARO)
            canvas_obj.line(2 * cm, doc.pagesize[1] - 1.6 * cm, doc.pagesize[0] - 2 * cm, doc.pagesize[1] - 1.6 * cm)
            canvas_obj.restoreState()
    return _draw


def baixar_imagem(url, max_width_cm=15):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        img = Image(io.BytesIO(resp.content))
        largura_max = max_width_cm * cm
        proporcao = img.imageHeight / img.imageWidth
        img.drawWidth = largura_max
        img.drawHeight = largura_max * proporcao
        return img
    except Exception:
        return None


def montar_tabela(t):
    """Constrói uma Table completa aceitando tudo: merge de células
    (span), alinhamento por coluna, cor de fundo/texto por célula
    individual, imagem dentro de célula, bordas seletivas. Campos
    além de headers/rows são todos opcionais — sem eles o resultado
    é idêntico à tabela simples original."""
    headers = t["headers"]
    rows = t["rows"]
    dados = [headers] + [list(r) for r in rows]

    # Célula pode ser string simples OU {text, image_url} — resolve
    # imagens antes de montar a Table, porque a Table só aceita
    # flowables/strings nas células, não dicts.
    for i, linha in enumerate(dados):
        for j, valor in enumerate(linha):
            if isinstance(valor, dict) and valor.get("image_url"):
                img = baixar_imagem(valor["image_url"], max_width_cm=3)
                dados[i][j] = img if img else ""
            elif isinstance(valor, dict):
                dados[i][j] = valor.get("text", "")

    largura_disponivel = A4[0] - 4 * cm
    if t.get("col_widths_cm"):
        larguras = [w * cm for w in t["col_widths_cm"]]
    else:
        largura_col = largura_disponivel / len(headers)
        larguras = [largura_col] * len(headers)

    tabela = Table(dados, colWidths=larguras)

    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), COR_PRIMARIA),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, COR_CINZA_CLARO]),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]

    # Bordas: grid completo por defeito, ou seletivo se "borders" vier
    # como lista de comandos [tipo, [c0,r0], [c1,r1], espessura, cor].
    if t.get("borders"):
        for b in t["borders"]:
            tipo, inicio, fim, esp = b[0], tuple(b[1]), tuple(b[2]), b[3]
            cor_borda = colors.HexColor(b[4]) if len(b) > 4 else colors.HexColor("#DDDDDD")
            estilo.append((tipo, inicio, fim, esp, cor_borda))
    else:
        estilo.append(("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")))

    # Alinhamento por coluna: {"1": "center", "2": "right", ...}
    if t.get("align"):
        for col_idx, alinhamento in t["align"].items():
            col = int(col_idx)
            estilo.append(("ALIGN", (col, 0), (col, -1), ALINHAMENTOS.get(alinhamento, "LEFT")))

    # Merge de células: lista de [[c0,r0],[c1,r1]] — índices incluem
    # a linha de cabeçalho (linha 0).
    if t.get("merge"):
        for span in t["merge"]:
            estilo.append(("SPAN", tuple(span[0]), tuple(span[1])))

    # Cor por célula individual: lista de {row, col, bg, text_color}.
    if t.get("cell_styles"):
        for cs in t["cell_styles"]:
            pos = (cs["col"], cs["row"])
            if cs.get("bg"):
                estilo.append(("BACKGROUND", pos, pos, colors.HexColor(cs["bg"])))
            if cs.get("text_color"):
                estilo.append(("TEXTCOLOR", pos, pos, colors.HexColor(cs["text_color"])))
            if cs.get("bold"):
                estilo.append(("FONTNAME", pos, pos, "Helvetica-Bold"))

    tabela.setStyle(TableStyle(estilo))
    return tabela


def montar_runs_paragrafo(runs, style):
    partes = []
    for r in runs:
        texto = r.get("text", "")
        if r.get("bold"):
            texto = f"<b>{texto}</b>"
        if r.get("italic"):
            texto = f"<i>{texto}</i>"
        if r.get("underline"):
            texto = f"<u>{texto}</u>"
        if r.get("color"):
            texto = f'<font color="{r["color"]}">{texto}</font>'
        if r.get("link"):
            texto = f'<link href="{r["link"]}" color="{COR_SECUNDARIA.hexval()}">{texto}</link>'
        partes.append(texto)
    return Paragraph("".join(partes), style)


def montar_grafico(chart_spec):
    tipo = chart_spec.get("type", "bar")
    labels = chart_spec.get("labels", [])
    series = chart_spec.get("series", [])
    largura, altura = 420, 220

    drawing = Drawing(largura, altura)

    if chart_spec.get("title"):
        drawing.add(String(largura / 2, altura - 12, chart_spec["title"],
                            fontName="Helvetica-Bold", fontSize=11,
                            fillColor=COR_PRIMARIA, textAnchor="middle"))

    area_top = altura - 30
    cores = [colors.HexColor(c) for c in PALETA]

    if tipo == "pie":
        pie = Pie()
        pie.x = largura / 2 - 70
        pie.y = 10
        pie.width = 140
        pie.height = 140
        pie.data = series[0]["data"] if series else []
        pie.labels = labels
        for i in range(len(pie.data)):
            pie.slices[i].fillColor = cores[i % len(cores)]
        drawing.add(pie)

    elif tipo == "line":
        chart = HorizontalLineChart()
        chart.x = 50
        chart.y = 30
        chart.width = largura - 90
        chart.height = area_top - 40
        chart.data = [s["data"] for s in series]
        chart.categoryAxis.categoryNames = labels
        chart.categoryAxis.labels.fontSize = 7
        chart.valueAxis.labels.fontSize = 7
        for i, s in enumerate(series):
            chart.lines[i].strokeColor = cores[i % len(cores)]
            chart.lines[i].strokeWidth = 2
        drawing.add(chart)
        if len(series) > 1:
            legend = Legend()
            legend.x = largura - 5
            legend.y = area_top - 10
            legend.colorNamePairs = [(cores[i % len(cores)], s.get("name", f"Série {i+1}")) for i, s in enumerate(series)]
            legend.fontSize = 7
            legend.alignment = "right"
            drawing.add(legend)

    else:  # bar (default)
        chart = VerticalBarChart()
        chart.x = 50
        chart.y = 30
        chart.width = largura - 90
        chart.height = area_top - 40
        chart.data = [s["data"] for s in series]
        chart.categoryAxis.categoryNames = labels
        chart.categoryAxis.labels.fontSize = 7
        chart.valueAxis.labels.fontSize = 7
        chart.groupSpacing = 10
        chart.barSpacing = 2
        for i in range(len(series)):
            chart.bars[i].fillColor = cores[i % len(cores)]
        drawing.add(chart)
        if len(series) > 1:
            legend = Legend()
            legend.x = largura - 5
            legend.y = area_top - 10
            legend.colorNamePairs = [(cores[i % len(cores)], s.get("name", f"Série {i+1}")) for i, s in enumerate(series)]
            legend.fontSize = 7
            legend.alignment = "right"
            drawing.add(legend)

    return drawing


def montar_formas_livres(shapes_spec):
    """Desenha formas soltas (retângulo, círculo, elipse, linha, polígono,
    texto) num Drawing próprio — canvas de coordenadas livre, largura/altura
    definidas pelo próprio spec."""
    largura = shapes_spec.get("width", 420)
    altura = shapes_spec.get("height", 200)
    drawing = Drawing(largura, altura)

    for f in shapes_spec.get("shapes", []):
        tipo = f.get("type")
        cor_preenchimento = colors.HexColor(f["fill"]) if f.get("fill") else None
        cor_borda = colors.HexColor(f["stroke"]) if f.get("stroke") else None
        largura_borda = f.get("stroke_width", 1)

        if tipo == "rect":
            drawing.add(Rect(f["x"], f["y"], f["w"], f["h"],
                              fillColor=cor_preenchimento, strokeColor=cor_borda,
                              strokeWidth=largura_borda, rx=f.get("radius", 0), ry=f.get("radius", 0)))
        elif tipo == "circle":
            drawing.add(Circle(f["cx"], f["cy"], f["r"],
                                fillColor=cor_preenchimento, strokeColor=cor_borda, strokeWidth=largura_borda))
        elif tipo == "ellipse":
            drawing.add(Ellipse(f["cx"], f["cy"], f["rx"], f["ry"],
                                 fillColor=cor_preenchimento, strokeColor=cor_borda, strokeWidth=largura_borda))
        elif tipo == "line":
            drawing.add(Line(f["x1"], f["y1"], f["x2"], f["y2"],
                              strokeColor=cor_borda or colors.black, strokeWidth=largura_borda))
        elif tipo == "polygon":
            pontos = []
            for pt in f["points"]:
                pontos.extend(pt)
            drawing.add(Polygon(pontos, fillColor=cor_preenchimento, strokeColor=cor_borda, strokeWidth=largura_borda))
        elif tipo == "polyline":
            pontos = []
            for pt in f["points"]:
                pontos.extend(pt)
            drawing.add(PolyLine(pontos, strokeColor=cor_borda or colors.black, strokeWidth=largura_borda))
        elif tipo == "text":
            drawing.add(String(f["x"], f["y"], f.get("text", ""),
                                fontName=f.get("font", "Helvetica-Bold"),
                                fontSize=f.get("font_size", 12),
                                fillColor=cor_preenchimento or colors.black,
                                textAnchor=f.get("align", "start")))
        elif tipo == "wedge":
            drawing.add(Wedge(f["cx"], f["cy"], f["r"], f["start_angle"], f["end_angle"],
                               fillColor=cor_preenchimento, strokeColor=cor_borda, strokeWidth=largura_borda))

    return drawing


def montar_qrcode(spec):
    largura = spec.get("size", 100)
    widget = QrCodeWidget(spec.get("content", ""))
    b = widget.getBounds()
    w_original = b[2] - b[0]
    h_original = b[3] - b[1]
    drawing = Drawing(largura, largura, transform=[largura / w_original, 0, 0, largura / h_original, 0, 0])
    drawing.add(widget.draw())
    return drawing


def montar_barcode128(spec):
    barcode = code128.Code128(spec.get("content", ""), barHeight=spec.get("height", 15) * 1.0, barWidth=spec.get("bar_width", 0.7))
    drawing = Drawing(barcode.width, barcode.height + 10)
    drawing.add(barcode)
    return drawing


def montar_callout(callout_spec, style):
    """Caixa de destaque: texto sobre fundo colorido com borda lateral,
    tipo 'nota'/'aviso'/'dica' — implementada como Table de 1 célula
    porque Table já dá padding + fundo + borda de graça."""
    texto = callout_spec.get("text", "")
    cor_fundo = colors.HexColor(callout_spec.get("bg", "#EEF2FF"))
    cor_borda = colors.HexColor(callout_spec.get("border_color", "#4F46E5"))
    p = Paragraph(texto, style)
    tabela = Table([[p]], colWidths=[A4[0] - 4 * cm])
    tabela.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), cor_fundo),
        ("LINEBEFORE", (0, 0), (0, -1), 3, cor_borda),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    return tabela


def montar_story_secao(sec, s):
    itens = []

    if sec.get("heading"):
        nivel = sec.get("heading_level", 1)
        estilo_heading = s["heading"] if nivel == 1 else s["heading2"]
        p = Paragraph(sec["heading"], estilo_heading)
        p._toc_heading = (sec["heading"], nivel)
        itens.append(p)

    if sec.get("runs"):
        itens.append(montar_runs_paragrafo(sec["runs"], s["corpo"]))

    for p in sec.get("paragraphs", []):
        itens.append(Paragraph(p, s["corpo"]))

    for item in sec.get("bullet_list", []):
        itens.append(Paragraph(f"• {item}", s["bullet"]))

    if sec.get("callout"):
        itens.append(Spacer(1, 6))
        itens.append(montar_callout(sec["callout"], s["callout"]))
        itens.append(Spacer(1, 8))

    if sec.get("chart"):
        itens.append(Spacer(1, 6))
        itens.append(montar_grafico(sec["chart"]))
        itens.append(Spacer(1, 6))

    if sec.get("shapes"):
        itens.append(Spacer(1, 6))
        itens.append(montar_formas_livres(sec["shapes"]))
        itens.append(Spacer(1, 6))

    if sec.get("qrcode"):
        itens.append(Spacer(1, 6))
        itens.append(montar_qrcode(sec["qrcode"]))
        itens.append(Spacer(1, 6))

    if sec.get("barcode"):
        itens.append(Spacer(1, 6))
        itens.append(montar_barcode128(sec["barcode"]))
        itens.append(Spacer(1, 6))

    if sec.get("image_url"):
        img = baixar_imagem(sec["image_url"])
        if img:
            itens.append(Spacer(1, 6))
            itens.append(img)
            itens.append(Spacer(1, 6))

    if sec.get("table"):
        itens.append(Spacer(1, 6))
        itens.append(montar_tabela(sec["table"]))
        itens.append(Spacer(1, 10))

    if sec.get("page_break_after"):
        itens.append(PageBreak())

    if sec.get("frame_break_after"):
        itens.append(FrameBreak())

    return itens


class _DocComTOC(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "_toc_heading"):
            texto, nivel = flowable._toc_heading
            self.notify("TOCEntry", (nivel - 1, texto, self.page))


def create_pdf_structured(params):
    s = get_styles()

    tamanho_nome = params.get("page_size", "A4")
    pagesize = TAMANHOS_PAGINA.get(tamanho_nome, A4)

    num_colunas = params.get("columns", 1)
    usar_toc = bool(params.get("toc"))
    watermark = params.get("watermark")

    header_text = None
    for sec in params.get("sections", []):
        if sec.get("header_text"):
            header_text = sec["header_text"]
            break
    on_page = rodape_e_extras_pagina(header_text, watermark)

    buffer = io.BytesIO()

    top_margin = 2.6 * cm if header_text else 2.2 * cm

    if num_colunas > 1 or usar_toc:
        doc = _DocComTOC(buffer, pagesize=pagesize,
                          topMargin=top_margin, bottomMargin=2.2 * cm,
                          leftMargin=2 * cm, rightMargin=2 * cm,
                          title=params.get("title", "Documento"))

        largura_disponivel = pagesize[0] - 4 * cm
        if num_colunas > 1:
            largura_coluna = (largura_disponivel - (num_colunas - 1) * 0.6 * cm) / num_colunas
            frames = []
            for i in range(num_colunas):
                x = 2 * cm + i * (largura_coluna + 0.6 * cm)
                frames.append(Frame(x, 2.2 * cm, largura_coluna, pagesize[1] - top_margin - 2.2 * cm,
                                     id=f"col{i}", leftPadding=0, rightPadding=0))
        else:
            frames = [Frame(2 * cm, 2.2 * cm, largura_disponivel, pagesize[1] - top_margin - 2.2 * cm,
                             id="normal", leftPadding=0, rightPadding=0)]

        doc.addPageTemplates([PageTemplate(id="Principal", frames=frames, onPage=on_page)])

        story = [Paragraph(params["title"], s["titulo"])]
        if params.get("subtitle"):
            story.append(Paragraph(params["subtitle"], s["subtitulo"]))
        story.append(linha_divisoria())

        if usar_toc:
            story.append(Paragraph("Índice", s["toc_titulo"]))
            toc = TableOfContents()
            toc.levelStyles = get_toc_styles()
            story.append(toc)
            story.append(PageBreak())

        for sec in params.get("sections", []):
            story.extend(montar_story_secao(sec, s))

        doc.multiBuild(story)

    else:
        doc = SimpleDocTemplate(buffer, pagesize=pagesize,
                                 topMargin=top_margin, bottomMargin=2.2 * cm,
                                 leftMargin=2 * cm, rightMargin=2 * cm,
                                 title=params.get("title", "Documento"))

        story = [Paragraph(params["title"], s["titulo"])]
        if params.get("subtitle"):
            story.append(Paragraph(params["subtitle"], s["subtitulo"]))
        story.append(linha_divisoria())

        for sec in params.get("sections", []):
            story.extend(montar_story_secao(sec, s))

        doc.build(story, onFirstPage=on_page, onLaterPages=on_page)

    pdf_bytes = buffer.getvalue()
    buffer.close()
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8")}


def create_pdf(params):
    secao = {
        "paragraphs": params.get("paragraphs", []),
        "bullet_list": params.get("bullet_list", []),
        "runs": params.get("runs"),
        "image_url": params.get("image_url"),
        "table": params.get("table"),
        "chart": params.get("chart"),
        "shapes": params.get("shapes"),
        "qrcode": params.get("qrcode"),
        "barcode": params.get("barcode"),
        "callout": params.get("callout"),
        "header_text": params.get("header_text"),
    }
    return create_pdf_structured({
        "title": params["title"],
        "subtitle": params.get("subtitle"),
        "page_size": params.get("page_size", "A4"),
        "columns": params.get("columns", 1),
        "toc": params.get("toc", False),
        "watermark": params.get("watermark"),
        "sections": [secao],
    })


def create_docx(params):
    document = Document()
    document.add_heading(params["title"], level=0)

    if params.get("subtitle"):
        sub = document.add_paragraph(params["subtitle"])
        sub.runs[0].font.size = Pt(13)
        sub.runs[0].font.color.rgb = RGBColor(0x4F, 0x46, 0xE5)

    for sec in params.get("sections", []):
        if sec.get("heading"):
            document.add_heading(sec["heading"], level=1)
        for p in sec.get("paragraphs", []):
            document.add_paragraph(p)
        for item in sec.get("bullet_list", []):
            document.add_paragraph(item, style="List Bullet")
        if sec.get("image_url"):
            try:
                resp = requests.get(sec["image_url"], timeout=8)
                resp.raise_for_status()
                document.add_picture(io.BytesIO(resp.content), width=Cm(14))
            except Exception:
                pass
        if sec.get("table"):
            t = sec["table"]
            tabela = document.add_table(rows=1, cols=len(t["headers"]))
            tabela.style = "Light Grid Accent 1"
            hdr_cells = tabela.rows[0].cells
            for i, h in enumerate(t["headers"]):
                hdr_cells[i].text = h
            for row in t["rows"]:
                cells = tabela.add_row().cells
                for i, val in enumerate(row):
                    cells[i].text = str(val)

    buffer = io.BytesIO()
    document.save(buffer)
    docx_bytes = buffer.getvalue()
    buffer.close()
    return {"docx_base64": base64.b64encode(docx_bytes).decode("utf-8")}


def _draw_mindmap_node(drawing, node, x, y, depth, color_idx, max_width):
    label = node.get("label", "")
    bg_color = colors.HexColor(PALETA[color_idx % len(PALETA)]) if depth > 0 else COR_PRIMARIA
    box_width = min(max_width - x, 20 + len(label) * 6.5)
    box_height = 22

    rect = Rect(x, y - box_height, box_width, box_height, fillColor=bg_color, strokeColor=None, rx=6, ry=6)
    drawing.add(rect)
    text = String(x + 10, y - box_height + 7, label, fontSize=max(8, 12 - depth), fillColor=colors.white, fontName="Helvetica-Bold")
    drawing.add(text)

    current_y = y - box_height - 10
    children = node.get("children", [])
    for i, child in enumerate(children):
        current_y = _draw_mindmap_node(drawing, child, x + 24, current_y, depth + 1, color_idx + i + 1, max_width)
    return current_y


def generate_mindmap(params):
    root = params["root"]
    width, height = 960, 720
    drawing = Drawing(width, height)
    drawing.add(Rect(0, 0, width, height, fillColor=colors.white, strokeColor=None))
    _draw_mindmap_node(drawing, root, 20, height - 20, 0, 0, width)

    png_buffer = io.BytesIO()
    renderPM.drawToFile(drawing, png_buffer, fmt="PNG")
    png_bytes = png_buffer.getvalue()
    png_buffer.close()
    return {"png_base64": base64.b64encode(png_bytes).decode("utf-8")}


if __name__ == "__main__":
    func_name = sys.argv[1]
    params = json.loads(sys.argv[2])

    funcoes = {
        "create_pdf": create_pdf,
        "create_pdf_structured": create_pdf_structured,
        "create_docx": create_docx,
        "generate_mindmap": generate_mindmap,
    }

    if func_name not in funcoes:
        print(json.dumps({"error": f"Função '{func_name}' não encontrada"}))
        sys.exit(1)

    try:
        resultado = funcoes[func_name](params)
        print(json.dumps(resultado))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)