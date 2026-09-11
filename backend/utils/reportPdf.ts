// Arabic-capable PDF rendering for the QC performance report. PDFKit + fontkit shape (join) Arabic
// letters correctly but do NO bidi reordering, so multi-word/mixed strings come out with their word
// order reversed. We solve that here with word-level RTL layout: tokenise on whitespace, let fontkit
// shape each token, and place the logical tokens right-to-left ourselves (validated to render every
// department/indicator name and mixed Arabic+number cell correctly). The embedded font is the same
// OFL IBM Plex Sans Arabic the web UI uses (assets/fonts/, copied into dist/ by scripts/copy-assets.js).
//
// This module is pure presentation: it takes an already-computed ReportModel and draws it onto a
// PDFDocument. routes/reports.ts builds the model from the aggregation views and streams the doc.
import path from 'path';
import fs from 'fs';

export interface ReportRow {
    name: string;                    // Arabic label for the row (department / college)
    cells: (number | null)[];        // per-indicator score fractions 0..1 (null = not evaluated)
    final: number | null;            // composite score fraction 0..1 (null = not evaluated)
}

export interface ReportModel {
    title: string;                   // e.g. "تقرير الأداء"
    periodLabel: string;             // e.g. "أيلول 2026"
    indicators: string[];            // indicator names, in column order
    departments: ReportRow[];
    colleges: ReportRow[];
    generatedAt: string;             // short date string (LTR), e.g. "12/09/2026"
}

const REGULAR = 'ar';
const BOLD = 'ar-bold';

function resolveFontDir(): string {
    const candidates = [
        path.join(__dirname, '..', 'assets', 'fonts'),        // dev: backend/utils -> backend/assets
        path.join(process.cwd(), 'assets', 'fonts'),
        path.join(process.cwd(), 'dist', 'assets', 'fonts'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'IBMPlexSansArabic-Regular.ttf'))) return c;
    }
    return candidates[0];
}

export function registerReportFonts(doc: PDFKit.PDFDocument): void {
    const dir = resolveFontDir();
    doc.registerFont(REGULAR, path.join(dir, 'IBMPlexSansArabic-Regular.ttf'));
    doc.registerFont(BOLD, path.join(dir, 'IBMPlexSansArabic-SemiBold.ttf'));
}

function pct(v: number | null): string {
    return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function scoreColor(v: number | null): string {
    if (v == null) return '#9ca3af';
    const p = v * 100;
    return p >= 90 ? '#0e9f6e' : p >= 70 ? '#c27803' : '#e02424';
}

// Draw text with word-level RTL ordering inside [x, x+width]; `y` is the top of the text.
// Logical tokens are placed from the alignment edge leftward, each shaped individually by fontkit.
function drawRtl(
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    y: number,
    width: number,
    opts: { align?: 'right' | 'center' | 'left'; size?: number; font?: string; color?: string } = {},
): void {
    const { align = 'right', size = 10, font = REGULAR, color = '#111827' } = opts;
    doc.font(font).fontSize(size).fillColor(color);
    const tokens = String(text).split(/(\s+)/).filter(t => t.length > 0);
    const widths = tokens.map(t => doc.widthOfString(t));
    const total = widths.reduce((a, b) => a + b, 0);
    let cursor: number;
    if (align === 'right') cursor = x + width;
    else if (align === 'center') cursor = x + (width + total) / 2;
    else cursor = x + total;
    for (let i = 0; i < tokens.length; i++) {
        cursor -= widths[i];
        doc.text(tokens[i], cursor, y, { lineBreak: false });
    }
}

// Plain left-to-right cell (numbers/percentages), horizontally centred in its column.
function drawNum(
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    y: number,
    width: number,
    opts: { size?: number; font?: string; color?: string } = {},
): void {
    const { size = 10, font = REGULAR, color = '#111827' } = opts;
    doc.font(font).fontSize(size).fillColor(color);
    doc.text(text, x, y, { width, align: 'center', lineBreak: false });
}

interface Column {
    width: number;
    header: string;
    kind: 'rtl' | 'num';
}

// Render one RTL table (columns laid right-to-left: columns[0] is the rightmost). Handles page
// breaks, redrawing the header row on each new page. Returns the y just below the table.
function drawTable(
    doc: PDFKit.PDFDocument,
    columns: Column[],
    rows: { cells: string[]; colors?: (string | undefined)[]; bold?: boolean[] }[],
    startY: number,
    left: number,
): number {
    const rowH = 22;
    const headerH = 24;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const size = 9.5;

    // Right-to-left x positions: first column sits at the right edge of the content box.
    const totalW = columns.reduce((a, c) => a + c.width, 0);
    const rightEdge = left + totalW;
    const xOf = (i: number): number => {
        let x = rightEdge;
        for (let k = 0; k <= i; k++) x -= columns[k].width;
        return x;
    };

    const drawHeader = (y: number): number => {
        doc.rect(left, y, totalW, headerH).fill('#eef2f7');
        columns.forEach((col, i) => {
            const x = xOf(i);
            const ty = y + (headerH - size) / 2 - 1;
            if (col.kind === 'rtl') drawRtl(doc, col.header, x + 4, ty, col.width - 8, { size, font: BOLD, color: '#1f2937' });
            else drawNum(doc, col.header, x, ty, col.width, { size, font: BOLD, color: '#1f2937' });
        });
        doc.moveTo(left, y + headerH).lineTo(rightEdge, y + headerH).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
        return y + headerH;
    };

    let y = drawHeader(startY);
    rows.forEach((row, ri) => {
        if (y + rowH > pageBottom) {
            doc.addPage();
            y = drawHeader(doc.page.margins.top);
        }
        if (ri % 2 === 1) doc.rect(left, y, totalW, rowH).fill('#f8fafc');
        const ty = y + (rowH - size) / 2 - 1;
        columns.forEach((col, i) => {
            const x = xOf(i);
            const color = row.colors?.[i];
            const font = row.bold?.[i] ? BOLD : REGULAR;
            if (col.kind === 'rtl') drawRtl(doc, row.cells[i], x + 4, ty, col.width - 8, { size, font, color });
            else drawNum(doc, row.cells[i], x, ty, col.width, { size, font, color });
        });
        doc.moveTo(left, y + rowH).lineTo(rightEdge, y + rowH).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
        y += rowH;
    });
    return y;
}

// Build the RTL column set for an aggregation table: [rowLabel | 1 | 2 | … | N | النهائي].
function buildColumns(rowLabelHeader: string, contentWidth: number, nIndicators: number): Column[] {
    const nameW = Math.min(160, Math.max(110, contentWidth * 0.22));
    const finalW = 64;
    const indW = Math.max(28, (contentWidth - nameW - finalW) / Math.max(nIndicators, 1));
    const cols: Column[] = [{ width: nameW, header: rowLabelHeader, kind: 'rtl' }];
    for (let i = 0; i < nIndicators; i++) cols.push({ width: indW, header: String(i + 1), kind: 'num' });
    cols.push({ width: finalW, header: 'النهائي', kind: 'num' });
    return cols;
}

function tableRows(rows: ReportRow[]): { cells: string[]; colors?: (string | undefined)[]; bold?: boolean[] }[] {
    return rows.map(r => {
        const cells = [r.name, ...r.cells.map(pct), pct(r.final)];
        const colors: (string | undefined)[] = [undefined, ...r.cells.map(() => undefined), scoreColor(r.final)];
        const bold: boolean[] = [false, ...r.cells.map(() => false), true];
        return { cells, colors, bold };
    });
}

// Render the whole report onto `doc`. Caller registers fonts (registerReportFonts), pipes the doc,
// and ends it.
export function renderReportPdf(doc: PDFKit.PDFDocument, model: ReportModel): void {
    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Header block.
    drawRtl(doc, model.title, left, doc.page.margins.top, contentWidth, { align: 'right', size: 20, font: BOLD });
    drawRtl(doc, `الفترة: ${model.periodLabel}`, left, doc.page.margins.top + 28, contentWidth, { align: 'right', size: 12 });
    doc.font(REGULAR).fontSize(9).fillColor('#6b7280')
        .text(`Generated: ${model.generatedAt}`, left, doc.page.margins.top + 30, { width: contentWidth, align: 'left', lineBreak: false });

    let y = doc.page.margins.top + 56;

    // Indicator legend (numbered), so the numeric column headers stay compact.
    drawRtl(doc, 'المؤشرات', left, y, contentWidth, { align: 'right', size: 12, font: BOLD, color: '#1f2937' });
    y += 18;
    model.indicators.forEach((name, i) => {
        drawRtl(doc, `${i + 1}. ${name}`, left, y, contentWidth, { align: 'right', size: 9.5, color: '#374151' });
        y += 14;
    });
    y += 8;

    if (model.departments.length > 0) {
        drawRtl(doc, 'التقييم الشامل حسب القسم', left, y, contentWidth, { align: 'right', size: 13, font: BOLD, color: '#1f2937' });
        y += 20;
        const cols = buildColumns('الكلية/القسم', contentWidth, model.indicators.length);
        y = drawTable(doc, cols, tableRows(model.departments), y, left);
        y += 24;
    }

    if (model.colleges.length > 0) {
        if (y + 80 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
        drawRtl(doc, 'التقييم حسب الكلية', left, y, contentWidth, { align: 'right', size: 13, font: BOLD, color: '#1f2937' });
        y += 20;
        const cols = buildColumns('الكلية', contentWidth, model.indicators.length);
        y = drawTable(doc, cols, tableRows(model.colleges), y, left);
    }
}
