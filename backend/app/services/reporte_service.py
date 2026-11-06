import io
from datetime import datetime, timezone

import openpyxl
from fastapi import HTTPException, status
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app import models


class NumberedCanvas(canvas.Canvas):
    """Canvas de dos pasadas para calcular y dibujar el número total de páginas."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#667085"))
        footer_text = f"Página {self._pageNumber} de {page_count}"
        self.drawRightString(612 - 36, 20, footer_text)
        self.drawString(
            36, 20, "Sistema de Fondeo Marítimo - Reporte Oficial Confidencial"
        )
        self.setStrokeColor(colors.HexColor("#D0D5DD"))
        self.setLineWidth(0.5)
        self.line(36, 30, 612 - 36, 30)
        self.restoreState()


class ReporteService:
    """
    Servicio de generación de reportes consolidados en memoria (Excel y PDF)
    para el seguimiento de avances en líneas de fondeo marítimo.
    """

    def __init__(self, db: Session | None = None):
        self.db = db

    @staticmethod
    def obtener_linea_y_registros(
        db: Session,
        linea_id: int | None = None,
    ) -> tuple[models.LineaFondeo, list[models.RegistroAvance], float, float, float]:
        """
        Obtiene la línea solicitada (o la primera activa) y sus registros de avance,
        calculando métricas clave de progreso.
        """
        if linea_id is not None:
            linea = (
                db.query(models.LineaFondeo)
                .filter(models.LineaFondeo.id == linea_id)
                .first()
            )
            if not linea:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="La línea de fondeo no existe",
                )
        else:
            linea = (
                db.query(models.LineaFondeo)
                .filter(models.LineaFondeo.estado == "activa")
                .first()
            )
            if not linea:
                linea = db.query(models.LineaFondeo).first()

            if not linea:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se encontraron líneas de fondeo registradas",
                )

        registros = (
            db.query(models.RegistroAvance)
            .filter(models.RegistroAvance.linea_id == linea.id)
            .order_by(models.RegistroAvance.fecha.asc())
            .all()
        )

        metros_totales = float(linea.metros_totales)
        metros_acumulados = round(sum(float(r.metros_avanzados) for r in registros), 2)
        metros_restantes = round(max(0.0, metros_totales - metros_acumulados), 2)
        porcentaje_avance = (
            round((metros_acumulados / metros_totales) * 100, 2)
            if metros_totales > 0
            else 0.0
        )

        return (
            linea,
            registros,
            metros_acumulados,
            metros_restantes,
            porcentaje_avance,
        )

    @classmethod
    def generar_excel_avance(
        cls,
        db: Session,
        linea_id: int | None = None,
    ) -> io.BytesIO:
        """
        Construye un libro Excel (.xlsx) en memoria con dos hojas:
        1. Resumen General (metadatos e indicadores clave).
        2. Bitácora de Avances (historial cronológico completo).
        """
        (
            linea,
            registros,
            metros_acumulados,
            metros_restantes,
            porcentaje_avance,
        ) = cls.obtener_linea_y_registros(db=db, linea_id=linea_id)

        wb = openpyxl.Workbook()

        # Estilos corporativos
        color_primario = "1F4E79"
        fill_header = PatternFill(
            start_color=color_primario,
            end_color=color_primario,
            fill_type="solid",
        )
        fill_zebra = PatternFill(
            start_color="F2F4F7", end_color="F2F4F7", fill_type="solid"
        )
        font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        font_titulo = Font(name="Calibri", size=15, bold=True, color=color_primario)
        font_subtitulo = Font(name="Calibri", size=10, italic=True, color="595959")
        font_bold = Font(name="Calibri", size=10, bold=True)
        font_normal = Font(name="Calibri", size=10)

        border_thin = Side(style="thin", color="D0D5DD")
        border_box = Border(
            left=border_thin,
            right=border_thin,
            top=border_thin,
            bottom=border_thin,
        )

        now_utc = datetime.now(timezone.utc)

        # ----------------------------------------------------------------------
        # HOJA 1: Resumen General
        # ----------------------------------------------------------------------
        ws_resumen = wb.active
        ws_resumen.title = "Resumen General"
        ws_resumen.views.sheetView[0].showGridLines = True

        ws_resumen["A1"] = "INFORME EJECUTIVO DE AVANCE - LÍNEA DE FONDEO"
        ws_resumen["A1"].font = font_titulo
        ws_resumen["A2"] = (
            f"Fecha de emisión: {now_utc.strftime('%d/%m/%Y %H:%M UTC')} | Estado: Oficial"
        )
        ws_resumen["A2"].font = font_subtitulo

        ws_resumen["A4"] = "Metadatos y KPIs Operacionales"
        ws_resumen["A4"].font = Font(
            name="Calibri", size=12, bold=True, color=color_primario
        )

        metadatos = [
            ("Identificador de Línea (ID)", str(linea.id)),
            ("Nombre de la Línea", linea.nombre),
            ("Estado Operacional", linea.estado.upper()),
            (
                "Fecha de Inicio Programada",
                (
                    linea.fecha_inicio.strftime("%d/%m/%Y")
                    if linea.fecha_inicio
                    else "N/A"
                ),
            ),
            (
                "Fecha Meta Estimada",
                linea.fecha_meta.strftime("%d/%m/%Y") if linea.fecha_meta else "N/A",
            ),
            ("Metros Totales Programados", f"{linea.metros_totales:,.2f} m"),
            ("Metros Acumulados Reales", f"{metros_acumulados:,.2f} m"),
            ("Metros Restantes por Fondeo", f"{metros_restantes:,.2f} m"),
            ("Porcentaje de Avance Físico", f"{porcentaje_avance:.2f}%"),
            ("Total de Maniobras Registradas", len(registros)),
        ]

        ws_resumen["A5"] = "Parámetro"
        ws_resumen["B5"] = "Valor"
        ws_resumen["A5"].font = font_header
        ws_resumen["B5"].font = font_header
        ws_resumen["A5"].fill = fill_header
        ws_resumen["B5"].fill = fill_header
        ws_resumen["A5"].alignment = Alignment(horizontal="left", vertical="center")
        ws_resumen["B5"].alignment = Alignment(horizontal="left", vertical="center")
        ws_resumen["A5"].border = border_box
        ws_resumen["B5"].border = border_box

        for idx, (param, val) in enumerate(metadatos, start=6):
            cell_a = ws_resumen[f"A{idx}"]
            cell_b = ws_resumen[f"B{idx}"]
            cell_a.value = param
            cell_b.value = val
            cell_a.font = font_bold
            cell_b.font = font_normal
            cell_a.border = border_box
            cell_b.border = border_box
            if idx % 2 == 1:
                cell_a.fill = fill_zebra
                cell_b.fill = fill_zebra

        # ----------------------------------------------------------------------
        # HOJA 2: Bitácora de Avances
        # ----------------------------------------------------------------------
        ws_bitacora = wb.create_sheet(title="Bitácora de Avances")
        ws_bitacora.views.sheetView[0].showGridLines = True

        ws_bitacora["A1"] = f"BITÁCORA DE AVANCES - {linea.nombre.upper()}"
        ws_bitacora["A1"].font = font_titulo
        ws_bitacora["A2"] = (
            f"Registros cronológicos de maniobras al {now_utc.strftime('%d/%m/%Y %H:%M UTC')}"
        )
        ws_bitacora["A2"].font = font_subtitulo

        headers_bitacora = [
            "Fecha",
            "Supervisor",
            "Metros Avanzados",
            "Metros Acumulados",
            "Coordenadas (Lat, Lon)",
            "Observación",
        ]

        row_header = 4
        for col_idx, header_text in enumerate(headers_bitacora, start=1):
            cell = ws_bitacora.cell(row=row_header, column=col_idx, value=header_text)
            cell.font = font_header
            cell.fill = fill_header
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border_box

        acumulado_running = 0.0
        if registros:
            for idx, r in enumerate(registros, start=5):
                acumulado_running = round(
                    acumulado_running + float(r.metros_avanzados), 2
                )
                fecha_str = r.fecha.strftime("%d/%m/%Y %H:%M") if r.fecha else "N/A"
                sup_nombre = (
                    r.usuario.nombre
                    if r.usuario
                    else (f"Usuario #{r.usuario_id}" if r.usuario_id else "N/A")
                )
                coords_str = (
                    f"{r.latitud:.5f}, {r.longitud:.5f}"
                    if (r.latitud is not None and r.longitud is not None)
                    else "Sin GPS"
                )
                obs_str = r.observacion or "-"

                row_vals = [
                    fecha_str,
                    sup_nombre,
                    float(r.metros_avanzados),
                    acumulado_running,
                    coords_str,
                    obs_str,
                ]

                is_zebra = idx % 2 == 1
                for col_idx, val in enumerate(row_vals, start=1):
                    cell = ws_bitacora.cell(row=idx, column=col_idx, value=val)
                    cell.font = font_normal
                    cell.border = border_box
                    if is_zebra:
                        cell.fill = fill_zebra

                    if col_idx in (3, 4):
                        cell.number_format = "#,##0.00"
                        cell.alignment = Alignment(
                            horizontal="right", vertical="center"
                        )
                    elif col_idx in (1, 5):
                        cell.alignment = Alignment(
                            horizontal="center", vertical="center"
                        )
                    else:
                        cell.alignment = Alignment(horizontal="left", vertical="center")
        else:
            ws_bitacora.append(["Sin registros de avance", "-", 0.0, 0.0, "-", "-"])

        # Ajuste dinámico de ancho de columnas
        for ws in [ws_resumen, ws_bitacora]:
            for col in ws.columns:
                max_len = 0
                col_letter = get_column_letter(col[0].column)
                for cell in col:
                    if cell.row in (1, 2, 4):
                        continue
                    val_str = str(cell.value or "")
                    max_len = max(max_len, len(val_str))
                ws.column_dimensions[col_letter].width = max(max_len + 4, 15)

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer

    @classmethod
    def generar_pdf_avance(
        cls,
        db: Session,
        linea_id: int | None = None,
    ) -> io.BytesIO:
        """
        Construye un documento PDF ejecutivo en memoria con diseño formal corporativo:
        título principal, bloque de resumen de KPIs y tabla de bitácora detallada.
        """
        (
            linea,
            registros,
            metros_acumulados,
            metros_restantes,
            porcentaje_avance,
        ) = cls.obtener_linea_y_registros(db=db, linea_id=linea_id)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            leftMargin=36,
            rightMargin=36,
            topMargin=36,
            bottomMargin=42,
        )

        styles = getSampleStyleSheet()

        # Estilos personalizados
        color_navy = colors.HexColor("#1F4E79")
        color_sub = colors.HexColor("#595959")
        color_border = colors.HexColor("#D0D5DD")
        color_zebra = colors.HexColor("#F8F9FA")

        title_style = ParagraphStyle(
            "DocTitle",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=color_navy,
        )

        subtitle_style = ParagraphStyle(
            "DocSubTitle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=color_sub,
        )

        section_style = ParagraphStyle(
            "DocSection",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=16,
            textColor=color_navy,
        )

        cell_style = ParagraphStyle(
            "CellNormal",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
        )

        cell_bold = ParagraphStyle(
            "CellBold",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=color_navy,
        )

        now_utc = datetime.now(timezone.utc)
        elements = []

        # Encabezado
        elements.append(
            Paragraph("Informe de Progreso - Líneas de Fondeo", title_style)
        )
        elements.append(
            Paragraph(
                f"Línea: <b>{linea.nombre}</b> &nbsp;|&nbsp; "
                f"Emisión: {now_utc.strftime('%d/%m/%Y %H:%M UTC')} &nbsp;|&nbsp; "
                "Estado: Confidencial / Oficial",
                subtitle_style,
            )
        )
        elements.append(Spacer(1, 8))
        elements.append(
            HRFlowable(width="100%", thickness=1.5, color=color_navy, spaceAfter=12)
        )

        # Bloque de Resumen Ejecutivo (Matriz 2x4)
        elements.append(Paragraph("Resumen Operativo de la Línea", section_style))
        elements.append(Spacer(1, 6))

        resumen_data = [
            [
                Paragraph("<b>Línea de Fondeo:</b>", cell_style),
                Paragraph(linea.nombre, cell_bold),
                Paragraph("<b>Estado Operacional:</b>", cell_style),
                Paragraph(linea.estado.upper(), cell_bold),
            ],
            [
                Paragraph("<b>Metros Programados:</b>", cell_style),
                Paragraph(f"{linea.metros_totales:,.2f} m", cell_style),
                Paragraph("<b>Metros Acumulados:</b>", cell_style),
                Paragraph(f"{metros_acumulados:,.2f} m", cell_bold),
            ],
            [
                Paragraph("<b>Metros Restantes:</b>", cell_style),
                Paragraph(f"{metros_restantes:,.2f} m", cell_style),
                Paragraph("<b>Porcentaje de Avance:</b>", cell_style),
                Paragraph(f"<b>{porcentaje_avance:.2f}%</b>", cell_bold),
            ],
            [
                Paragraph("<b>Fecha de Inicio:</b>", cell_style),
                Paragraph(
                    (
                        linea.fecha_inicio.strftime("%d/%m/%Y")
                        if linea.fecha_inicio
                        else "N/A"
                    ),
                    cell_style,
                ),
                Paragraph("<b>Fecha Meta:</b>", cell_style),
                Paragraph(
                    (
                        linea.fecha_meta.strftime("%d/%m/%Y")
                        if linea.fecha_meta
                        else "N/A"
                    ),
                    cell_style,
                ),
            ],
        ]

        table_resumen = Table(resumen_data, colWidths=[120, 150, 120, 150])
        table_resumen.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), color_zebra),
                    ("BOX", (0, 0), (-1, -1), 0.75, color_border),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, color_border),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        elements.append(table_resumen)
        elements.append(Spacer(1, 14))

        # Tabla de Detalle Cronológico
        elements.append(Paragraph("Bitácora Cronológica de Maniobras", section_style))
        elements.append(Spacer(1, 6))

        headers_tabla = [
            Paragraph("<b>Fecha</b>", cell_bold),
            Paragraph("<b>Metros</b>", cell_bold),
            Paragraph("<b>Acumulado</b>", cell_bold),
            Paragraph("<b>GPS (Lat, Lon)</b>", cell_bold),
            Paragraph("<b>Supervisor</b>", cell_bold),
            Paragraph("<b>Observación</b>", cell_bold),
        ]

        bitacora_rows = [headers_tabla]
        acumulado_calc = 0.0

        if registros:
            for r in registros:
                acumulado_calc = round(acumulado_calc + float(r.metros_avanzados), 2)
                fecha_str = r.fecha.strftime("%d/%m/%Y %H:%M") if r.fecha else "-"
                sup_nombre = (
                    r.usuario.nombre
                    if r.usuario
                    else (f"ID {r.usuario_id}" if r.usuario_id else "Desconocido")
                )
                gps_str = (
                    f"{r.latitud:.4f}, {r.longitud:.4f}"
                    if (r.latitud is not None and r.longitud is not None)
                    else "Sin GPS"
                )
                obs_p = Paragraph(r.observacion or "-", cell_style)

                bitacora_rows.append(
                    [
                        Paragraph(fecha_str, cell_style),
                        Paragraph(f"{float(r.metros_avanzados):,.2f} m", cell_style),
                        Paragraph(f"{acumulado_calc:,.2f} m", cell_style),
                        Paragraph(gps_str, cell_style),
                        Paragraph(sup_nombre, cell_style),
                        obs_p,
                    ]
                )
        else:
            bitacora_rows.append(
                [
                    Paragraph("Sin registros de avance ingresados", cell_style),
                    Paragraph("-", cell_style),
                    Paragraph("-", cell_style),
                    Paragraph("-", cell_style),
                    Paragraph("-", cell_style),
                    Paragraph("-", cell_style),
                ]
            )

        # Ancho total: 540 pt (coincide exactamente con el margen imprimible)
        table_bitacora = Table(
            bitacora_rows,
            colWidths=[80, 60, 65, 95, 100, 140],
            repeatRows=1,
        )

        t_style = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("BOX", (0, 0), (-1, -1), 0.75, color_border),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, color_border),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]

        for i in range(1, len(bitacora_rows)):
            if i % 2 == 0:
                t_style.append(
                    ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F9FAFB"))
                )

        table_bitacora.setStyle(TableStyle(t_style))
        elements.append(table_bitacora)

        doc.build(elements, canvasmaker=NumberedCanvas)
        buffer.seek(0)
        return buffer


# Exportaciones funcionales a nivel de módulo
generar_excel_avance = ReporteService.generar_excel_avance
generar_pdf_avance = ReporteService.generar_pdf_avance
