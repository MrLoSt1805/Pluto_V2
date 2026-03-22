# -*- coding: utf-8 -*-
"""
PeopleLogic-branded Resume Evaluation PDF generation (ReportLab).
Matches sample layout: logo, watermark, section headers, tables, spacing.
"""
from __future__ import annotations

import json
import logging
import os
from io import BytesIO
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Brand colors (aligned with sample PDFs)
EVAL_BLUE = colors.HexColor("#0070AD")
EVAL_BLUE_DARK = colors.HexColor("#1a365d")
EVAL_TEXT = colors.HexColor("#333333")
EVAL_MUTED = colors.HexColor("#6c757d")
EVAL_BOX_BG = colors.HexColor("#E6F2FA")
EVAL_TABLE_BORDER = colors.HexColor("#dee2e6")

# Match factor keys (API) -> short column labels (sample PDF)
FACTOR_COLUMNS = [
    ("Skills Match", "Skills"),
    ("Experience Match", "Experience"),
    ("Education Match", "Education"),
    ("Industry Knowledge", "Industry"),
    ("Certification Match", "Certification"),
]


def _resolve_logo_path() -> Optional[str]:
    for name in ("logo.png", "plbot.png", "peoplelogic.png"):
        p = os.path.join(BASE_DIR, "static", name)
        if os.path.exists(p):
            return p
    root_png = os.path.join(BASE_DIR, "plbot.png")
    return root_png if os.path.exists(root_png) else None


def _pdf_escape(s) -> str:
    if s is None:
        return ""
    t = str(s)
    return (
        t.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _as_dict(v) -> dict:
    if v is None:
        return {}
    if isinstance(v, dict):
        return v
    if isinstance(v, str) and v.strip():
        try:
            return json.loads(v)
        except Exception:
            return {}
    return {}


def _usable_width_pt(left_margin: float = 50, right_margin: float = 50) -> float:
    """Content width (points) for given side margins on A4."""
    return float(A4[0] - left_margin - right_margin)


def _hr_line(width_pt: float):
    """Thin blue rule under section titles (sample style)."""
    return Table(
        [[""]],
        colWidths=[width_pt],
        style=TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 1, EVAL_BLUE),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


def make_evaluation_pdf_canvas_callbacks(job_title: str, filename: str):
    """Draw watermark + logo + PDF metadata on every page."""

    logo_path = _resolve_logo_path()

    def _on_page(canvas, doc):
        page_w, page_h = A4

        # PDF metadata
        canvas.setCreator("PeopleLogic PeopleBot")
        canvas.setAuthor("PeopleLogic")
        title_parts = [p for p in ["Resume Evaluation", job_title or "", filename or ""] if p]
        canvas.setTitle(" - ".join(title_parts))

        # Diagonal watermark
        canvas.saveState()
        canvas.translate(page_w / 2.0, page_h / 2.0)
        canvas.rotate(35)
        canvas.setFillColor(colors.Color(0.78, 0.78, 0.78, alpha=0.28))
        canvas.setFont("Helvetica-Bold", 36)
        canvas.drawCentredString(0, 0, "PeopleLogic Confidential")
        canvas.restoreState()

        # Logo top-right (above content frame)
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
                logging.warning("Could not draw logo on evaluation PDF: %s", ex)

    return _on_page


def _hr_line_compact(width_pt: float):
    """Thinner rule for concise PDF."""
    return Table(
        [[""]],
        colWidths=[width_pt],
        style=TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 0.75, EVAL_BLUE),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


def _maybe_truncate(text: str, max_chars: int) -> str:
    if not text or len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def build_evaluation_pdf_story(evaluation_data: dict, concise: bool = False) -> List:
    """Build ReportLab flowables for the evaluation report.

    If ``concise`` is True (merge-with-resume download): compact 1–2 pages, no
    interview questions, tighter typography and spacing.
    """
    styles = getSampleStyleSheet()
    _m = 42 if concise else 50
    w_pt = _usable_width_pt(_m, _m)

    if concise:
        # Readable “standard” sizes (similar to 10–11pt Word body); still compact via spacing
        title_style = ParagraphStyle(
            "PL_EvalTitle_C",
            parent=styles["Normal"],
            fontSize=18,
            leading=22,
            alignment=TA_CENTER,
            textColor=EVAL_BLUE_DARK,
            fontName="Helvetica-Bold",
            spaceAfter=8,
            spaceBefore=0,
        )
        meta_style = ParagraphStyle(
            "PL_Meta_C",
            parent=styles["Normal"],
            fontSize=10,
            leading=13,
            alignment=TA_LEFT,
            textColor=EVAL_TEXT,
            spaceAfter=3,
        )
        section_blue_style = ParagraphStyle(
            "PL_SectionBlue_C",
            parent=styles["Normal"],
            fontSize=12,
            leading=15,
            textColor=EVAL_BLUE,
            fontName="Helvetica-Bold",
            spaceBefore=8,
            spaceAfter=3,
        )
        body_style = ParagraphStyle(
            "PL_Body_C",
            parent=styles["BodyText"],
            fontSize=10,
            leading=13,
            alignment=TA_JUSTIFY,
            textColor=EVAL_TEXT,
            spaceAfter=6,
        )
        body_left = ParagraphStyle(
            "PL_BodyLeft_C",
            parent=body_style,
            alignment=TA_LEFT,
        )
        italic_body = ParagraphStyle(
            "PL_Italic_C",
            parent=body_style,
            fontName="Helvetica-Oblique",
            alignment=TA_JUSTIFY,
        )
        bullet_style = ParagraphStyle(
            "PL_Bullet_C",
            parent=body_style,
            leftIndent=12,
            bulletIndent=5,
            spaceAfter=4,
        )
        cell_hdr = ParagraphStyle(
            "PL_CellHdr_C",
            parent=styles["Normal"],
            fontSize=9,
            fontName="Helvetica-Bold",
            textColor=colors.white,
            alignment=TA_LEFT,
            leading=11,
        )
        cell_body = ParagraphStyle(
            "PL_CellBody_C",
            parent=styles["Normal"],
            fontSize=9,
            leading=11,
            textColor=EVAL_TEXT,
            alignment=TA_LEFT,
        )
        factor_cell = ParagraphStyle(
            "PL_FactorCell_C",
            parent=styles["Normal"],
            fontSize=11,
            leading=13,
            alignment=TA_CENTER,
        )
    else:
        title_style = ParagraphStyle(
            "PL_EvalTitle",
            parent=styles["Normal"],
            fontSize=20,
            leading=24,
            alignment=TA_CENTER,
            textColor=EVAL_BLUE_DARK,
            fontName="Helvetica-Bold",
            spaceAfter=14,
            spaceBefore=4,
        )

        meta_style = ParagraphStyle(
            "PL_Meta",
            parent=styles["Normal"],
            fontSize=10,
            leading=14,
            alignment=TA_LEFT,
            textColor=EVAL_TEXT,
            spaceAfter=5,
        )

        section_blue_style = ParagraphStyle(
            "PL_SectionBlue",
            parent=styles["Normal"],
            fontSize=13,
            leading=16,
            textColor=EVAL_BLUE,
            fontName="Helvetica-Bold",
            spaceBefore=14,
            spaceAfter=4,
        )

        body_style = ParagraphStyle(
            "PL_Body",
            parent=styles["BodyText"],
            fontSize=11,
            leading=14,
            alignment=TA_JUSTIFY,
            textColor=EVAL_TEXT,
            spaceAfter=10,
        )

        body_left = ParagraphStyle(
            "PL_BodyLeft",
            parent=body_style,
            alignment=TA_LEFT,
        )

        italic_body = ParagraphStyle(
            "PL_Italic",
            parent=body_style,
            fontName="Helvetica-Oblique",
            alignment=TA_JUSTIFY,
        )

        bullet_style = ParagraphStyle(
            "PL_Bullet",
            parent=body_style,
            leftIndent=14,
            bulletIndent=6,
            spaceAfter=8,
        )

        cell_hdr = ParagraphStyle(
            "PL_CellHdr",
            parent=styles["Normal"],
            fontSize=10,
            fontName="Helvetica-Bold",
            textColor=colors.white,
            alignment=TA_LEFT,
            leading=13,
        )

        cell_body = ParagraphStyle(
            "PL_CellBody",
            parent=styles["Normal"],
            fontSize=9,
            leading=12,
            textColor=EVAL_TEXT,
            alignment=TA_LEFT,
        )

        factor_cell = ParagraphStyle(
            "PL_FactorCell",
            parent=styles["Normal"],
            fontSize=11,
            leading=14,
            alignment=TA_CENTER,
        )

    job_title = evaluation_data.get("job_title") or "N/A"
    filename = evaluation_data.get("filename") or "Unknown"
    oorwin_job_id = evaluation_data.get("oorwin_job_id")

    match_pct = evaluation_data.get("match_percentage", 0)
    try:
        match_pct = int(match_pct) if match_pct is not None else 0
    except (TypeError, ValueError):
        match_pct = 0
    match_pct_str = evaluation_data.get("match_percentage_str") or f"{match_pct}%"

    match_factors = _as_dict(evaluation_data.get("match_factors"))
    candidate_fit = _as_dict(evaluation_data.get("candidate_fit_analysis"))
    job_stability = _as_dict(evaluation_data.get("job_stability"))
    career_progression = _as_dict(evaluation_data.get("career_progression"))

    elements: List = []

    def _vsp(small: float, full: float) -> Spacer:
        return Spacer(1, (small if concise else full) * inch)

    def _hrule():
        return _hr_line_compact(w_pt) if concise else _hr_line(w_pt)

    # Title (logo drawn on canvas)
    elements.append(Paragraph("Resume Evaluation Report", title_style))
    elements.append(_vsp(0.04, 0.12))

    elements.append(
        Paragraph(f"<b>Job Title:</b> {_pdf_escape(job_title)}", meta_style)
    )
    elements.append(
        Paragraph(f"<b>Candidate Resume:</b> {_pdf_escape(filename)}", meta_style)
    )
    if oorwin_job_id:
        elements.append(
            Paragraph(f"<b>Job ID:</b> {_pdf_escape(oorwin_job_id)}", meta_style)
        )
    elements.append(_vsp(0.06, 0.18))

    # Match Score
    elements.append(
        Paragraph(
            f"<b>Match Score: {_pdf_escape(match_pct_str)}</b>",
            section_blue_style,
        )
    )
    elements.append(_hrule())
    elements.append(_vsp(0.05, 0.12))

    # Match Factors — 5-column boxed row (sample style)
    elements.append(
        Paragraph("<b>Match Factors Breakdown</b>", section_blue_style)
    )
    elements.append(_hrule())
    elements.append(_vsp(0.04, 0.08))

    col_w = w_pt / 5.0
    factor_cells = []
    for key, short_label in FACTOR_COLUMNS:
        raw = match_factors.get(key)
        if raw is None:
            display = "N/A"
        else:
            try:
                display = f"{int(raw)}%"
            except (TypeError, ValueError):
                display = _pdf_escape(str(raw))
        lbl_sz = "8"
        factor_cells.append(
            Paragraph(
                f"<b><font color='#0070AD'>{_pdf_escape(display)}</font></b><br/>"
                f"<font size='{lbl_sz}' color='#6c757d'>{_pdf_escape(short_label)}</font>",
                factor_cell,
            )
        )
    _pad = 7 if concise else 10
    ft = Table([factor_cells], colWidths=[col_w] * 5)
    ft.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), EVAL_BOX_BG),
                ("BOX", (0, 0), (-1, -1), 0.75, EVAL_BLUE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, EVAL_BLUE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), _pad),
                ("BOTTOMPADDING", (0, 0), (-1, -1), _pad),
                ("LEFTPADDING", (0, 0), (-1, -1), 3 if concise else 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3 if concise else 4),
            ]
        )
    )
    elements.append(ft)
    elements.append(_vsp(0.06, 0.16))

    # Profile Summary
    profile_summary = evaluation_data.get("profile_summary") or ""
    if profile_summary:
        if concise:
            profile_summary = _maybe_truncate(str(profile_summary), 900)
        elements.append(Paragraph("<b>Profile Summary</b>", section_blue_style))
        elements.append(_hrule())
        elements.append(_vsp(0.03, 0.06))
        elements.append(Paragraph(_pdf_escape(profile_summary), body_style))
        elements.append(_vsp(0.06, 0.14))

    # Candidate Fit — Dimension table
    dim_rows = candidate_fit.get("Dimension Evaluation") or []
    if dim_rows:
        elements.append(
            Paragraph(
                "<b>Candidate Fit Analysis against Job JD</b>",
                section_blue_style,
            )
        )
        elements.append(_hrule())
        elements.append(_vsp(0.04, 0.08))

        tdata = [
            [
                Paragraph("<b>Dimension</b>", cell_hdr),
                Paragraph("<b>Evaluation</b>", cell_hdr),
                Paragraph("<b>Recruiter Comments</b>", cell_hdr),
            ]
        ]
        for row in dim_rows:
            tdata.append(
                [
                    Paragraph(_pdf_escape(row.get("Dimension", "")), cell_body),
                    Paragraph(_pdf_escape(row.get("Evaluation", "")), cell_body),
                    Paragraph(_pdf_escape(row.get("Recruiter Comments", "")), cell_body),
                ]
            )
        cw0 = w_pt * 0.22
        cw1 = w_pt * 0.18
        cw2 = w_pt - cw0 - cw1
        dim_table = Table(tdata, colWidths=[cw0, cw1, cw2], repeatRows=1)
        _tp = 5 if concise else 7
        _hdr_fs = 9 if concise else 10
        dim_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), EVAL_BLUE),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, 0), _hdr_fs),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                    ("TEXTCOLOR", (0, 1), (-1, -1), EVAL_TEXT),
                    ("GRID", (0, 0), (-1, -1), 0.5, EVAL_TABLE_BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), _tp),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), _tp),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4 if concise else 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4 if concise else 6),
                ]
            )
        )
        elements.append(dim_table)
        elements.append(_vsp(0.06, 0.18))

    # Risk & Gaps
    risk_gaps = candidate_fit.get("Risk and Gaps")
    if risk_gaps:
        if not isinstance(risk_gaps, list):
            risk_gaps = [risk_gaps] if risk_gaps else []
        if risk_gaps:
            if not concise:
                elements.append(PageBreak())
            else:
                elements.append(_vsp(0.05, 0.12))
            elements.append(
                Paragraph("<b>Risk &amp; Gaps to Probe</b>", section_blue_style)
            )
            elements.append(_hrule())
            elements.append(_vsp(0.04, 0.08))
            rg_data = [
                [
                    Paragraph("<b>Area</b>", cell_hdr),
                    Paragraph("<b>Risk</b>", cell_hdr),
                    Paragraph("<b>Recruiter Strategy</b>", cell_hdr),
                ]
            ]
            for rg in risk_gaps:
                if not isinstance(rg, dict):
                    continue
                rg_data.append(
                    [
                        Paragraph(_pdf_escape(rg.get("Area", "")), cell_body),
                        Paragraph(_pdf_escape(rg.get("Risk", "")), cell_body),
                        Paragraph(_pdf_escape(rg.get("Recruiter Strategy", "")), cell_body),
                    ]
                )
            rg_w0 = w_pt * 0.2
            rg_w1 = w_pt * 0.35
            rg_w2 = w_pt - rg_w0 - rg_w1
            rg_tbl = Table(rg_data, colWidths=[rg_w0, rg_w1, rg_w2], repeatRows=1)
            _rtp = 5 if concise else 7
            rg_tbl.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), EVAL_BLUE),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("GRID", (0, 0), (-1, -1), 0.5, EVAL_TABLE_BORDER),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), _rtp),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), _rtp),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4 if concise else 6),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4 if concise else 6),
                    ]
                )
            )
            elements.append(rg_tbl)
            elements.append(_vsp(0.06, 0.18))

    # Recruiter Recommendation
    rec = candidate_fit.get("Recommendation")
    if rec and isinstance(rec, dict):
        elements.append(
            Paragraph("<b>Recruiter Recommendation</b>", section_blue_style)
        )
        elements.append(_hrule())
        elements.append(_vsp(0.04, 0.08))
        rec_data = [
            [
                Paragraph("<b>Verdict</b>", cell_hdr),
                Paragraph("<b>Fit Level</b>", cell_hdr),
                Paragraph("<b>Rationale</b>", cell_hdr),
            ],
            [
                Paragraph(_pdf_escape(rec.get("Verdict", "")), cell_body),
                Paragraph(_pdf_escape(rec.get("Fit Level", "")), cell_body),
                Paragraph(_pdf_escape(rec.get("Rationale", "")), cell_body),
            ],
        ]
        rw0 = w_pt * 0.2
        rw1 = w_pt * 0.15
        rw2 = w_pt - rw0 - rw1
        rec_tbl = Table(rec_data, colWidths=[rw0, rw1, rw2])
        _rtp2 = 5 if concise else 7
        rec_tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), EVAL_BLUE),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.5, EVAL_TABLE_BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), _rtp2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), _rtp2),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4 if concise else 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4 if concise else 6),
                ]
            )
        )
        elements.append(rec_tbl)
        elements.append(_vsp(0.06, 0.18))

    # Recruiter Narrative (italic body — sample style)
    narrative = candidate_fit.get("Recruiter Narrative")
    if narrative:
        if concise:
            narrative = _maybe_truncate(str(narrative), 1200)
        elements.append(
            Paragraph("<b>Recruiter Narrative for Submission</b>", section_blue_style)
        )
        elements.append(_hrule())
        elements.append(_vsp(0.03, 0.06))
        elements.append(Paragraph(_pdf_escape(narrative), italic_body))
        elements.append(_vsp(0.06, 0.16))

    # Missing Keywords
    missing_keywords = evaluation_data.get("missing_keywords") or []
    if isinstance(missing_keywords, str):
        try:
            missing_keywords = json.loads(missing_keywords)
        except Exception:
            missing_keywords = [missing_keywords]
    if missing_keywords and len(missing_keywords) > 0:
        elements.append(Paragraph("<b>Missing Keywords</b>", section_blue_style))
        elements.append(_hrule())
        elements.append(_vsp(0.03, 0.06))
        kw_text = ", ".join(str(k) for k in missing_keywords)
        if concise:
            kw_text = _maybe_truncate(kw_text, 500)
        elements.append(Paragraph(_pdf_escape(kw_text), body_left))
        elements.append(_vsp(0.06, 0.14))

    # Job Stability
    if job_stability:
        if not concise:
            elements.append(PageBreak())
        else:
            elements.append(_vsp(0.05, 0.12))
        elements.append(Paragraph("<b>Job Stability Analysis</b>", section_blue_style))
        elements.append(_hrule())
        elements.append(_vsp(0.04, 0.08))
        if job_stability.get("StabilityScore") is not None:
            elements.append(
                Paragraph(
                    f"<b>Stability Score:</b> {_pdf_escape(job_stability.get('StabilityScore'))}",
                    body_left,
                )
            )
        if job_stability.get("RiskLevel"):
            elements.append(
                Paragraph(
                    f"<b>Risk Level:</b> {_pdf_escape(job_stability.get('RiskLevel'))}",
                    body_left,
                )
            )
        if job_stability.get("AverageJobTenure"):
            elements.append(
                Paragraph(
                    f"<b>Average Job Tenure:</b> {_pdf_escape(job_stability.get('AverageJobTenure'))}",
                    body_left,
                )
            )
        if job_stability.get("JobCount") is not None:
            elements.append(
                Paragraph(
                    f"<b>Job Count:</b> {_pdf_escape(job_stability.get('JobCount'))}",
                    body_left,
                )
            )
        if job_stability.get("ReasoningExplanation"):
            elements.append(_vsp(0.03, 0.06))
            _re = job_stability.get("ReasoningExplanation")
            if concise:
                _re = _maybe_truncate(str(_re), 600)
            elements.append(
                Paragraph(
                    _pdf_escape(_re),
                    body_style,
                )
            )
        elements.append(_vsp(0.06, 0.14))

    # Career Progression
    if career_progression:
        elements.append(
            Paragraph("<b>Career Progression Analysis</b>", section_blue_style)
        )
        elements.append(_hrule())
        elements.append(_vsp(0.03, 0.06))
        ps = career_progression.get("progression_score")
        if ps is not None:
            elements.append(
                Paragraph(
                    f"<b>Progression Score:</b> {_pdf_escape(ps)}",
                    body_left,
                )
            )
            elements.append(_vsp(0.03, 0.06))
        obs = career_progression.get("key_observations") or []
        if isinstance(obs, str):
            obs = [obs]
        if obs:
            elements.append(
                Paragraph("<b>Key Observations:</b>", body_left)
            )
            elements.append(_vsp(0.02, 0.04))
            _max_obs = 8 if concise else len(obs)
            for o in obs[:_max_obs]:
                elements.append(
                    Paragraph(f"&bull; {_pdf_escape(o)}", bullet_style)
                )
        reasoning = career_progression.get("reasoning")
        if reasoning:
            elements.append(_vsp(0.03, 0.06))
            if isinstance(reasoning, list):
                for r in reasoning[: (4 if concise else len(reasoning))]:
                    elements.append(Paragraph(_pdf_escape(r), body_left))
            else:
                _rs = str(reasoning)
                if concise:
                    _rs = _maybe_truncate(_rs, 400)
                elements.append(Paragraph(_pdf_escape(_rs), body_style))
        red_flags = career_progression.get("red_flags") or []
        if red_flags:
            elements.append(_vsp(0.04, 0.08))
            elements.append(Paragraph("<b>Red Flags</b>", body_left))
            for rf in red_flags[: (5 if concise else len(red_flags))]:
                elements.append(
                    Paragraph(f"&bull; {_pdf_escape(rf)}", bullet_style)
                )
        elements.append(_vsp(0.06, 0.14))

    # Over/Under Qualification
    over_under = evaluation_data.get("over_under_qualification") or ""
    if over_under:
        elements.append(
            Paragraph("<b>Over/Under Qualification Analysis</b>", section_blue_style)
        )
        elements.append(_hrule())
        elements.append(_vsp(0.03, 0.06))
        _ou = str(over_under)
        if concise:
            _ou = _maybe_truncate(_ou, 800)
        elements.append(Paragraph(_pdf_escape(_ou), body_style))
        elements.append(_vsp(0.06, 0.14))

    # Interview Questions (omitted in concise / merge-with-resume PDF)
    technical_questions = evaluation_data.get("technical_questions") or []
    nontechnical_questions = evaluation_data.get("nontechnical_questions") or []
    behavioral_questions = evaluation_data.get("behavioral_questions") or []

    if concise:
        return elements

    if technical_questions or nontechnical_questions or behavioral_questions:
        elements.append(PageBreak())
        elements.append(Paragraph("<b>Interview Questions</b>", section_blue_style))
        elements.append(_hr_line(w_pt))
        elements.append(Spacer(1, 0.1 * inch))

        if technical_questions:
            elements.append(
                Paragraph("<b>Technical Questions</b>", body_left)
            )
            elements.append(Spacer(1, 0.04 * inch))
            for i, q in enumerate(technical_questions[:15], 1):
                elements.append(
                    Paragraph(f"{i}. {_pdf_escape(q)}", body_left)
                )
            elements.append(Spacer(1, 0.12 * inch))

        if nontechnical_questions:
            elements.append(
                Paragraph("<b>Non-Technical Questions</b>", body_left)
            )
            elements.append(Spacer(1, 0.04 * inch))
            for i, q in enumerate(nontechnical_questions[:15], 1):
                elements.append(
                    Paragraph(f"{i}. {_pdf_escape(q)}", body_left)
                )
            elements.append(Spacer(1, 0.12 * inch))

        if behavioral_questions:
            elements.append(
                Paragraph("<b>Behavioral Questions</b>", body_left)
            )
            elements.append(Spacer(1, 0.04 * inch))
            for i, q in enumerate(behavioral_questions[:15], 1):
                elements.append(
                    Paragraph(f"{i}. {_pdf_escape(q)}", body_left)
                )

    return elements


def build_evaluation_pdf_bytes(evaluation_data: dict, concise: bool = False) -> bytes:
    """Render evaluation report to PDF bytes (PeopleLogic layout).

    ``concise=True`` is used for *Download with Evaluation* (1–2 pages, no
    interview questions). ``concise=False`` is the full standalone evaluation PDF.
    """
    buffer = BytesIO()
    if concise:
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=42,
            leftMargin=42,
            topMargin=48,
            bottomMargin=40,
        )
    else:
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=50,
            leftMargin=50,
            topMargin=72,
            bottomMargin=54,
        )
    job_title = evaluation_data.get("job_title") or ""
    filename = evaluation_data.get("filename") or ""
    story = build_evaluation_pdf_story(evaluation_data, concise=concise)
    cb = make_evaluation_pdf_canvas_callbacks(job_title, filename)
    doc.build(story, onFirstPage=cb, onLaterPages=cb)
    data = buffer.getvalue()
    buffer.close()
    return data
