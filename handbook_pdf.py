# -*- coding: utf-8 -*-
"""
PeopleLogic / CodeLogic–styled Recruiter Handbook PDF (ReportLab).
Matches product samples: logo, CodeLogic Confidential watermark, blue headings + rules,
bright blue table headers, monospace boolean strings.
"""
from __future__ import annotations

import logging
import re
from html import unescape
from io import BytesIO
from typing import List

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from evaluation_pdf import _resolve_logo_path, _usable_width_pt

# Brand (aligned with sample screenshots ~ #0070C0)
HANDBOOK_BLUE = colors.HexColor("#0070C0")
HANDBOOK_TEXT = colors.HexColor("#222222")
HANDBOOK_TABLE_BORDER = colors.HexColor("#dee2e6")
HANDBOOK_ROW_ALT = colors.HexColor("#f8f9fa")


def make_handbook_pdf_canvas_callbacks(job_title: str, oorwin_job_id: str):
    """Watermark + logo + PDF metadata on every page."""

    logo_path = _resolve_logo_path()

    def _on_page(canvas, doc):
        page_w, page_h = A4

        canvas.setCreator("PeopleLogic PeopleBot")
        canvas.setAuthor("PeopleLogic")
        parts = [p for p in ["Recruiter Playbook & Handbook", job_title or "", oorwin_job_id or ""] if p]
        canvas.setTitle(" - ".join(parts))

        # Diagonal watermark (sample: "CodeLogic Confidential")
        canvas.saveState()
        canvas.translate(page_w / 2.0, page_h / 2.0)
        canvas.rotate(35)
        canvas.setFillColor(colors.Color(0.78, 0.78, 0.78, alpha=0.26))
        canvas.setFont("Helvetica-Bold", 34)
        canvas.drawCentredString(0, 0, "CodeLogic Confidential")
        canvas.restoreState()

        if logo_path:
            try:
                iw, ih = 1.15 * inch, 0.34 * inch
                x = page_w - doc.rightMargin - iw
                y = page_h - doc.topMargin - ih + 8
                canvas.drawImage(
                    logo_path,
                    x,
                    y,
                    width=iw,
                    height=ih,
                    preserveAspectRatio=True,
                    mask="auto",
                )
            except Exception as ex:
                logging.warning("Could not draw logo on handbook PDF: %s", ex)

    return _on_page


def _handbook_hr_line(width_pt: float):
    """Thin blue rule under section titles (sample style)."""
    return Table(
        [[""]],
        colWidths=[width_pt],
        style=TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 1, HANDBOOK_BLUE),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


def _is_main_section_title(text: str) -> bool:
    text_clean = re.sub(r"[^\x00-\x7F]+", "", text).strip()
    if re.match(r"^Introduction\s*:?\s*$", text_clean, re.IGNORECASE):
        return False
    patterns = [
        r"^\s*\d+\.?\s*Primary\s+Sourcing\s+Parameters\s*\(Must-Have\)\s*:?",
        r"^\s*\d+\.?\s*Screening\s+Framework\s*:?",
        r"^\s*\d+\.?\s*Target\s+Talent\s+Pools\s*:?",
        r"^\s*\d+\.?\s*Boolean\s+Search\s+Samples\s*:?",
        r"^\s*\d+\.?\s*Red\s+Flags\s+to\s+Watch\s*:?",
        r"^\s*\d+\.?\s*Recruiter\s+Sales\s+Pitch\s*\(to\s+candidates\)\s*:?",
        r"^\s*\d+\.?\s*Recruiter\s+Checklist\s*\(Pre-call\)\s*:?",
        r"^\s*\d+\.?\s*Overqualification/Overkill\s+Risk\s+Assessment\s*:?",
        r"^\s*Primary\s+Sourcing\s+Parameters\s*\(Must-Have\)\s*:?",
        r"^\s*Screening\s+Framework\s*:?",
        r"^\s*Target\s+Talent\s+Pools\s*:?",
        r"^\s*Boolean\s+Search\s+Samples\s*:?",
        r"^\s*Red\s+Flags\s+to\s+Watch\s*:?",
        r"^\s*Recruiter\s+Sales\s+Pitch\s*\(to\s+candidates\)\s*:?",
        r"^\s*Recruiter\s+Checklist\s*\(Pre-call\)\s*:?",
        r"^\s*Overqualification/Overkill\s+Risk\s+Assessment\s*:?",
    ]
    return any(re.match(p, text_clean, re.IGNORECASE) for p in patterns)


def _is_boolean_search_line(line: str) -> bool:
    """Heuristic: Boolean / keyword search strings → monospace."""
    t = line.strip()
    if not t:
        return False
    if t.startswith("`") and t.count("`") >= 2:
        return True
    if len(t) < 18:
        return False
    if re.search(r"\bAND\b", t) and (re.search(r"\bOR\b", t) or "(" in t):
        return True
    return False


def _append_table_to_story(
    table_rows: List[List[str]],
    elements: list,
    table_style_small: ParagraphStyle,
    table_style_header: ParagraphStyle,
) -> None:
    if not table_rows:
        return

    table_data = table_rows
    is_sourcing_table = len(table_data) > 0 and len(table_data[0]) > 0 and (
        "Skill" in str(table_data[0])
        or "Experience" in str(table_data[0])
        or "Recruiter Cue" in str(table_data[0])
    )

    available_width = _usable_width_pt(50, 50)
    num_cols = len(table_data[0]) if table_data else 4
    if is_sourcing_table and num_cols >= 4:
        col_widths = [38] + [(available_width - 38) / (num_cols - 1)] * (num_cols - 1)
    else:
        col_widths = [available_width / num_cols] * num_cols

    processed_table_data = []
    for row_idx, row in enumerate(table_data):
        processed_row = []
        for cell_text in row:
            cell_text_clean = str(cell_text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            cell_text_clean = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", cell_text_clean)
            cell_text_clean = re.sub(r"\*(.+?)\*", r"<i>\1</i>", cell_text_clean)
            cell_style = table_style_header if row_idx == 0 else table_style_small
            processed_row.append(Paragraph(cell_text_clean, cell_style))
        processed_table_data.append(processed_row)

    pdf_table = Table(processed_table_data, colWidths=col_widths)

    table_style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HANDBOOK_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("GRID", (0, 0), (-1, -1), 0.5, HANDBOOK_TABLE_BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, HANDBOOK_ROW_ALT]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
    ]

    if is_sourcing_table and len(table_data[0]) >= 4:
        table_style_cmds.extend(
            [
                ("TEXTCOLOR", (0, 1), (0, -1), HANDBOOK_BLUE),
                ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
                ("ALIGN", (0, 1), (0, -1), "CENTER"),
            ]
        )

    pdf_table.setStyle(TableStyle(table_style_cmds))
    elements.append(Spacer(1, 0.08 * inch))
    elements.append(pdf_table)
    elements.append(Spacer(1, 0.18 * inch))


def build_handbook_pdf_bytes(markdown_content: str, job_title: str = "", oorwin_job_id: str = "") -> bytes:
    """Build branded handbook PDF from markdown body."""
    markdown_content = (markdown_content or "").strip()
    if not markdown_content:
        raise ValueError("No content to download")

    buffer = BytesIO()
    left_m = right_m = 50
    top_m, bot_m = 78, 22

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=right_m,
        leftMargin=left_m,
        topMargin=top_m,
        bottomMargin=bot_m,
    )

    styles = getSampleStyleSheet()
    w_pt = _usable_width_pt(left_m, right_m)

    # Document title (sample: left-aligned playbook title)
    doc_title_style = ParagraphStyle(
        "HB_DocTitle",
        parent=styles["Normal"],
        fontSize=17,
        leading=22,
        textColor=HANDBOOK_TEXT,
        fontName="Helvetica-Bold",
        alignment=TA_LEFT,
        spaceAfter=6,
        spaceBefore=0,
    )

    title_style = ParagraphStyle(
        "HB_Title",
        parent=styles["Heading1"],
        fontSize=20,
        textColor=HANDBOOK_TEXT,
        spaceAfter=14,
        alignment=TA_LEFT,
        fontName="Helvetica-Bold",
    )

    heading1_blue_style = ParagraphStyle(
        "HB_H1Blue",
        parent=styles["Heading1"],
        fontSize=13.5,
        leading=17,
        textColor=HANDBOOK_BLUE,
        spaceAfter=4,
        spaceBefore=14,
        fontName="Helvetica-Bold",
    )

    heading1_plain_style = ParagraphStyle(
        "HB_H1Plain",
        parent=styles["Heading1"],
        fontSize=13.5,
        leading=17,
        textColor=HANDBOOK_TEXT,
        spaceAfter=8,
        spaceBefore=12,
        fontName="Helvetica-Bold",
    )

    heading2_blue_style = ParagraphStyle(
        "HB_H2Blue",
        parent=styles["Heading2"],
        fontSize=12,
        leading=15,
        textColor=HANDBOOK_BLUE,
        spaceAfter=4,
        spaceBefore=10,
        fontName="Helvetica-Bold",
    )

    heading2_plain_style = ParagraphStyle(
        "HB_H2Plain",
        parent=styles["Heading2"],
        fontSize=11.5,
        leading=14,
        textColor=HANDBOOK_TEXT,
        spaceAfter=8,
        spaceBefore=8,
        fontName="Helvetica-Bold",
    )

    body_style = ParagraphStyle(
        "HB_Body",
        parent=styles["BodyText"],
        fontSize=10.5,
        leading=14,
        alignment=TA_JUSTIFY,
        spaceAfter=10,
        textColor=HANDBOOK_TEXT,
    )

    bullet_style = ParagraphStyle(
        "HB_Bullet",
        parent=styles["BodyText"],
        fontSize=10.5,
        leading=14,
        leftIndent=18,
        spaceAfter=6,
        textColor=HANDBOOK_TEXT,
    )

    boolean_style = ParagraphStyle(
        "HB_Boolean",
        parent=styles["BodyText"],
        fontSize=9,
        leading=12,
        fontName="Courier",
        textColor=HANDBOOK_TEXT,
        leftIndent=12,
        spaceAfter=8,
    )

    table_style_small = ParagraphStyle(
        "HB_TableCell",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        spaceAfter=0,
        spaceBefore=0,
        textColor=HANDBOOK_TEXT,
    )

    table_style_header = ParagraphStyle(
        "HB_TableHeader",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        spaceAfter=0,
        spaceBefore=0,
        fontName="Helvetica-Bold",
        textColor=colors.white,
    )

    elements: list = []

    # Branded header title line
    if job_title:
        header_text = f"Recruiter Playbook &amp; Handbook: {_pdf_esc(job_title)}"
    else:
        header_text = "Recruiter Playbook &amp; Handbook"
    elements.append(Paragraph(header_text, doc_title_style))
    elements.append(Spacer(1, 0.12 * inch))

    lines = markdown_content.split("\n")
    i = 0
    in_table = False
    table_rows: List[List[str]] = []
    seen_intro = False
    skipped_first_hash_title = False

    def flush_table():
        nonlocal in_table, table_rows
        if in_table and table_rows:
            _append_table_to_story(table_rows, elements, table_style_small, table_style_header)
            table_rows = []
            in_table = False

    while i < len(lines):
        line = lines[i].strip()

        if not line:
            if not in_table:
                elements.append(Spacer(1, 0.1 * inch))
            i += 1
            continue

        if re.match(r"^Introduction:?\s*$", line, re.IGNORECASE):
            if seen_intro:
                i += 1
                while i < len(lines) and not lines[i].strip():
                    i += 1
                continue
            seen_intro = True

        if re.match(r"^-\s*\[.*\]\(#.*\)", line):
            i += 1
            continue

        if "|" in line and line.count("|") >= 2:
            if re.match(r"^\|[\s\-:]+\|", line):
                i += 1
                continue
            cells = [c.strip() for c in line.split("|")[1:-1]]
            if cells:
                table_rows.append(cells)
                in_table = True
                i += 1
                continue
        else:
            flush_table()

        raw_line = line
        line = unescape(raw_line)
        line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        if line.startswith("# "):
            text = re.sub(r"[^\x00-\x7F]+", "", line[2:]).strip()
            # Skip duplicate top-level markdown title that matches our PDF header
            if not skipped_first_hash_title and job_title and job_title.lower() in text.lower():
                skipped_first_hash_title = True
                i += 1
                continue
            if re.match(r"^Recruiter\s+Playbook", text, re.IGNORECASE) and not skipped_first_hash_title:
                skipped_first_hash_title = True
                i += 1
                continue
            elements.append(Spacer(1, 0.12 * inch))
            elements.append(Paragraph(text, title_style))
            i += 1
            continue

        if line.startswith("## "):
            text = line[3:].strip()
            text_clean = re.sub(r"[^\x00-\x7F]+", "", text).strip()
            elements.append(Spacer(1, 0.08 * inch))
            use_blue = _is_main_section_title(text_clean)
            st = heading1_blue_style if use_blue else heading1_plain_style
            elements.append(Paragraph(text_clean, st))
            if use_blue:
                elements.append(_handbook_hr_line(w_pt))
            i += 1
            continue

        if line.startswith("### "):
            text = line[4:].strip()
            text_clean = re.sub(r"[^\x00-\x7F]+", "", text).strip()
            elements.append(Spacer(1, 0.06 * inch))
            st = heading2_blue_style if _is_main_section_title(text_clean) else heading2_plain_style
            elements.append(Paragraph(text_clean, st))
            if _is_main_section_title(text_clean):
                elements.append(_handbook_hr_line(w_pt))
            i += 1
            continue

        if line.startswith("#### "):
            text = line[5:].strip()
            text_clean = re.sub(r"[^\x00-\x7F]+", "", text).strip()
            elements.append(Spacer(1, 0.05 * inch))
            st = heading2_blue_style if _is_main_section_title(text_clean) else heading2_plain_style
            elements.append(Paragraph(text_clean, st))
            i += 1
            continue

        if line.startswith("- ") or line.startswith("* ") or (len(line) > 2 and line.startswith("• ")):
            text = line[2:].strip()
            text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
            text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
            raw_bullet = raw_line[2:].strip() if len(raw_line) > 2 else raw_line
            if _is_boolean_search_line(raw_bullet):
                elements.append(Paragraph("• " + text, boolean_style))
            else:
                elements.append(Paragraph("• " + text, bullet_style))
            i += 1
            continue

        if line.startswith("o "):
            text = line[2:].strip()
            text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
            text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
            elements.append(Paragraph("○ " + text, bullet_style))
            i += 1
            continue

        if re.match(r"^\d+\.\s", line):
            text = re.sub(r"^\d+\.\s", "", line)
            text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
            text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
            raw_num = re.sub(r"^\d+\.\s", "", raw_line)
            if _is_boolean_search_line(raw_num):
                elements.append(Paragraph(text, boolean_style))
            else:
                elements.append(Paragraph(text, bullet_style))
            i += 1
            continue

        if line.startswith("**") and line.endswith("**"):
            elements.append(Paragraph("<b>" + line[2:-2].strip() + "</b>", body_style))
            i += 1
            continue

        if line.startswith("---") or line.startswith("___"):
            elements.append(Spacer(1, 0.2 * inch))
            i += 1
            continue

        text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", line)
        text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
        if text.strip():
            if _is_boolean_search_line(raw_line):
                elements.append(Paragraph(text, boolean_style))
            else:
                elements.append(Paragraph(text, body_style))
        i += 1

    flush_table()

    cb = make_handbook_pdf_canvas_callbacks(job_title, oorwin_job_id)
    doc.build(elements, onFirstPage=cb, onLaterPages=cb)

    data = buffer.getvalue()
    buffer.close()
    return data


def _pdf_esc(s: str) -> str:
    if not s:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
