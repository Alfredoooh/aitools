import sys
import json
import base64
import io
import requests

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image
)
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics import renderPM

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

COR_PRIMARIA = colors.HexColor("#0F172A")
COR_SECUNDARIA = colors.HexColor("#4F46E5")
COR_DESTAQUE = colors.HexColor("#F59E0B")
COR_TEXTO = colors.HexColor("#475569")
COR_CINZA_CLARO = colors.HexColor("#F8FAFC")
PALETA = ["#4F46E5", "#0EA5E9", "#F59E0B", "#EF4444", "#10B981", "#8B5CF6", "#EC4899", "#14B8A6"]


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
        "corpo": ParagraphStyle("Corpo", parent=styles["Normal"], fontName="Helvetica",
                                 fontSize=10.5, leading=15.5, textColor=COR_TEXTO, spaceAfter=8),
        "bullet": ParagraphStyle("Bullet", parent=styles["Normal"], fontName="Helvetica",
                                  fontSize=10.5, leading=15, leftIndent=14, spaceAfter=5,
                                  textColor=COR_TEXTO),
    }


def linha_divisoria():
    return HRFlowable(width="100%", thickness=1.5, color=COR_DESTAQUE, spaceBefore=4, spaceAfter=14)


def rodape_pagina(canvas_obj, doc):
    canvas_obj.saveState()
    canvas_obj.setStrokeColor(COR_CINZA_CLARO)
    canvas_obj.line(2 * cm, 1.7 * cm, A4[0] - 2 * cm, 1.7 * cm)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.setFillColor(colors.grey)
    canvas_obj.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Página {doc.page}")
    canvas_obj.restoreState()


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


def montar_tabela(headers, rows):
    dados = [headers] + rows
    largura_col = (A4[0] - 4 * cm) / len(headers)
    tabela = Table(dados, colWidths=[largura_col] * len(headers))
    tabela.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COR_PRIMARIA),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, COR_CINZA_CLARO]),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")),
    ]))
    return tabela


def create_pdf_structured(params):
    s = get_styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                             topMargin=2.2 * cm, bottomMargin=2.2 * cm,
                             leftMargin=2 * cm, rightMargin=2 * cm,
                             title=params.get("title", "Documento"))

    story = [Paragraph(params["title"], s["titulo"])]
    if params.get("subtitle"):
        story.append(Paragraph(params["subtitle"], s["subtitulo"]))
    story.append(linha_divisoria())

    for sec in params.get("sections", []):
        if sec.get("heading"):
            story.append(Paragraph(sec["heading"], s["heading"]))
        for p in sec.get("paragraphs", []):
            story.append(Paragraph(p, s["corpo"]))
        for item in sec.get("bullet_list", []):
            story.append(Paragraph(f"• {item}", s["bullet"]))
        if sec.get("image_url"):
            img = baixar_imagem(sec["image_url"])
            if img:
                story.append(Spacer(1, 6))
                story.append(img)
                story.append(Spacer(1, 6))
        if sec.get("table"):
            t = sec["table"]
            story.append(Spacer(1, 6))
            story.append(montar_tabela(t["headers"], t["rows"]))
            story.append(Spacer(1, 10))

    doc.build(story, onFirstPage=rodape_pagina, onLaterPages=rodape_pagina)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8")}


def create_pdf(params):
    secao = {
        "paragraphs": params.get("paragraphs", []),
        "bullet_list": params.get("bullet_list", []),
        "image_url": params.get("image_url"),
        "table": params.get("table"),
    }
    return create_pdf_structured({
        "title": params["title"],
        "subtitle": params.get("subtitle"),
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
    """Desenha recursivamente um nó do mapa mental e devolve a altura ocupada."""
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