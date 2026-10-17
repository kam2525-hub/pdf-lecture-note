// @ts-check
/**
 * PDF描画・テキスト抽出・白紙ノート描画・書き込み済みPDF出力エンジン
 */
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import {
  normalizedToPdfPoint,
  layoutVerticalTextForPdf,
  STAMP_TYPES,
  clamp,
} from './models.js';

// PDF.js Worker設定
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

/** @type {ArrayBuffer | null} */
let cachedFontBytes = null;

/**
 * 日本語フォント (NotoSansJP) のバイナリを取得・キャッシュする
 * @returns {Promise<ArrayBuffer | null>}
 */
async function loadJapaneseFontBytes() {
  if (cachedFontBytes) return cachedFontBytes;
  try {
    const fontUrl = new URL('../vendor/NotoSansJP-Regular.ttf', import.meta.url).href;
    const res = await fetch(fontUrl);
    if (!res.ok) return null;
    cachedFontBytes = await res.arrayBuffer();
    return cachedFontBytes;
  } catch (err) {
    console.warn('Japanese font load failed:', err);
    return null;
  }
}

/**
 * Hexカラー文字列 (#rrggbb) を { r, g, b } (0〜1) に変換する
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb01(hex) {
  const clean = String(hex || '#1e293b').replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return {
      r: Number.isFinite(r) ? r : 0,
      g: Number.isFinite(g) ? g : 0,
      b: Number.isFinite(b) ? b : 0,
    };
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
  };
}

/**
 * PDFバイナリを読み込み、各ページの寸法と抽出テキストを含むページメタデータ配列を返す
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<{ numPages: number, pages: Array<{ id: string, type: 'pdf', sourcePdfPageIndex: number, template: 'plain', width: number, height: number, extractedText: string, annotations: { texts: Array<any>, strokes: Array<any>, stamps: Array<any> } }> }>}
 */
export async function parsePdfDocument(pdfBytes) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    throw new Error('PDFデータが空か無効です');
  }
  // PDF.jsが内部でArrayBufferをTransferしてDetachedになるのを防ぐためコピーを渡す
  const copyBytes = new Uint8Array(pdfBytes);
  const loadingTask = pdfjsLib.getDocument({ data: copyBytes });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const pages = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    let extractedText = '';
    try {
      const textContent = await page.getTextContent();
      extractedText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      extractedText = '';
    }

    pages.push({
      id: `page_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      type: /** @type {'pdf'} */ ('pdf'),
      sourcePdfPageIndex: i - 1,
      template: /** @type {'plain'} */ ('plain'),
      width: viewport.width || 595.28,
      height: viewport.height || 841.89,
      extractedText,
      annotations: {
        texts: [],
        strokes: [],
        stamps: [],
      },
    });
  }

  return { numPages, pages };
}

/**
 * PDFドキュメントオブジェクトをキャッシュ付きで取得する
 * @param {Uint8Array} pdfBytes
 */
export async function loadPdfJsInstance(pdfBytes) {
  const copyBytes = new Uint8Array(pdfBytes);
  const loadingTask = pdfjsLib.getDocument({ data: copyBytes });
  return await loadingTask.promise;
}

/**
 * 指定されたPDFページまたは白紙ノートページをCanvasに描画する
 * @param {HTMLCanvasElement} canvas
 * @param {any} pageMeta ページ情報
 * @param {any | null} pdfJsDoc PDF.jsドキュメントインスタンス
 * @param {number} targetWidth 画面上の表示幅 (px)
 * @param {number} [devicePixelRatio=1]
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function renderPageBaseToCanvas(
  canvas,
  pageMeta,
  pdfJsDoc,
  targetWidth,
  devicePixelRatio = window.devicePixelRatio || 1
) {
  const dpr = clamp(devicePixelRatio, 1, 3);
  const baseWidth = pageMeta.width || 595.28;
  const baseHeight = pageMeta.height || 841.89;
  const scale = targetWidth / baseWidth;
  const cssWidth = Math.round(baseWidth * scale);
  const cssHeight = Math.round(baseHeight * scale);

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return { width: cssWidth, height: cssHeight };

  if (pageMeta.type === 'pdf' && pdfJsDoc && typeof pageMeta.sourcePdfPageIndex === 'number') {
    const pdfPage = await pdfJsDoc.getPage(pageMeta.sourcePdfPageIndex + 1);
    const viewport = pdfPage.getViewport({ scale: scale * dpr });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({
      canvasContext: ctx,
      viewport,
    }).promise;
  } else {
    ctx.save();
    ctx.scale(dpr, dpr);
    drawBlankTemplateOnCanvas(ctx, cssWidth, cssHeight, pageMeta.template || 'ruled');
    ctx.restore();
  }

  return { width: cssWidth, height: cssHeight };
}

/**
 * 白紙ノートページ（無地・横罫線・国語縦罫線・数学方眼）をCanvas上に描画する
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {'plain' | 'ruled' | 'vertical-ruled' | 'grid'} template
 */
export function drawBlankTemplateOnCanvas(ctx, width, height, template) {
  ctx.fillStyle = '#fffdf9';
  ctx.fillRect(0, 0, width, height);

  const marginX = width * 0.06;
  const marginY = height * 0.06;

  if (template === 'ruled') {
    // 横罫線ノート
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    const rows = 26;
    const stepY = (height - marginY * 2) / rows;
    for (let i = 0; i <= rows; i++) {
      const y = marginY + i * stepY;
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(width - marginX, y);
      ctx.stroke();
    }
    // ヘッダー太線
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(marginX, marginY + stepY);
    ctx.lineTo(width - marginX, marginY + stepY);
    ctx.stroke();
  } else if (template === 'vertical-ruled') {
    // 国語用・縦罫線ノート
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    const cols = 15;
    const stepX = (width - marginX * 2) / cols;
    for (let i = 0; i <= cols; i++) {
      const x = marginX + i * stepX;
      ctx.beginPath();
      ctx.moveTo(x, marginY);
      ctx.lineTo(x, height - marginY);
      ctx.stroke();
    }
    // 外枠
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(marginX, marginY, width - marginX * 2, height - marginY * 2);
  } else if (template === 'grid') {
    // 数学・理科用 5mm方眼風ノート
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.8;
    const cols = 22;
    const step = (width - marginX * 2) / cols;
    for (let x = marginX; x <= width - marginX + 0.5; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, marginY);
      ctx.lineTo(x, height - marginY);
      ctx.stroke();
    }
    for (let y = marginY; y <= height - marginY + 0.5; y += step) {
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(width - marginX, y);
      ctx.stroke();
    }
  }
}

/**
 * 元のPDF＋追加された白紙ノート＋書き込んだテキスト（横書き/縦書き）・マーカー・ペン・スタンプを統合し、
 * 新しいPDFバイナリ (Uint8Array) として出力する
 *
 * @param {any} doc ドキュメントデータ
 * @returns {Promise<Uint8Array>}
 */
export async function exportAnnotatedPdf(doc) {
  // @ts-ignore
  const PDFLib = window.PDFLib;
  // @ts-ignore
  const fontkit = window.fontkit;
  if (!PDFLib) {
    throw new Error('PDF出力ライブラリ (pdf-lib) が読み込まれていません');
  }

  const { PDFDocument, rgb, degrees, LineCapStyle } = PDFLib;
  const outPdf = await PDFDocument.create();

  if (fontkit) {
    outPdf.registerFontkit(fontkit);
  }

  // 日本語フォント埋め込み
  let customFont = null;
  const fontBytes = await loadJapaneseFontBytes();
  if (fontBytes && fontkit) {
    try {
      customFont = await outPdf.embedFont(fontBytes, { subset: true });
    } catch (err) {
      console.warn('Custom Japanese font embed failed, falling back to standard font:', err);
    }
  }
  const fallbackFont = await outPdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const activeFont = customFont || fallbackFont;

  // 元PDFがある場合は読み込む
  let srcPdf = null;
  if (doc.pdfBytes && doc.pdfBytes.byteLength > 0) {
    srcPdf = await PDFDocument.load(doc.pdfBytes);
  }

  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  for (let i = 0; i < pages.length; i++) {
    const pageMeta = pages[i];
    let pdfPage;

    if (pageMeta.type === 'pdf' && srcPdf && typeof pageMeta.sourcePdfPageIndex === 'number') {
      const [copiedPage] = await outPdf.copyPages(srcPdf, [pageMeta.sourcePdfPageIndex]);
      pdfPage = outPdf.addPage(copiedPage);
    } else {
      const w = pageMeta.width || 595.28;
      const h = pageMeta.height || 841.89;
      pdfPage = outPdf.addPage([w, h]);
      drawBlankTemplateOnPdfPage(pdfPage, w, h, pageMeta.template || 'ruled', rgb);
    }

    const { width: pdfW, height: pdfH } = pdfPage.getSize();
    const annotations = pageMeta.annotations || {};

    // 1. 手書きマーカー・ペンストロークの描画
    const strokes = Array.isArray(annotations.strokes) ? annotations.strokes : [];
    for (const stroke of strokes) {
      const pts = Array.isArray(stroke.points) ? stroke.points : [];
      if (pts.length < 2) continue;

      const { r, g, b } = hexToRgb01(stroke.color || '#fde047');
      const opacity = typeof stroke.opacity === 'number' ? stroke.opacity : stroke.tool === 'marker' ? 0.38 : 1.0;
      const thickness = ((stroke.size || 4) / 595.28) * pdfW;

      for (let p = 0; p < pts.length - 1; p++) {
        const p1 = normalizedToPdfPoint(pts[p].xNorm, pts[p].yNorm, pdfW, pdfH);
        const p2 = normalizedToPdfPoint(pts[p + 1].xNorm, pts[p + 1].yNorm, pdfW, pdfH);
        pdfPage.drawLine({
          start: { x: p1.x, y: p1.y },
          end: { x: p2.x, y: p2.y },
          thickness,
          color: rgb(r, g, b),
          opacity,
          lineCap: LineCapStyle.Round,
        });
      }
    }

    // 2. スタンプの描画
    const stamps = Array.isArray(annotations.stamps) ? annotations.stamps : [];
    for (const st of stamps) {
      const stampDef = STAMP_TYPES.find((t) => t.id === st.stampId) || STAMP_TYPES[0];
      const pos = normalizedToPdfPoint(st.xNorm, st.yNorm, pdfW, pdfH);
      const { r, g, b } = hexToRgb01(stampDef.color);
      const bgRgb = hexToRgb01(stampDef.bg);
      const sizePt = ((st.size || 24) / 595.28) * pdfW;

      pdfPage.drawCircle({
        x: pos.x + sizePt * 0.5,
        y: pos.y - sizePt * 0.5,
        size: sizePt * 0.65,
        color: rgb(bgRgb.r, bgRgb.g, bgRgb.b),
        borderColor: rgb(r, g, b),
        borderWidth: 1.5,
        opacity: 0.9,
      });

      try {
        pdfPage.drawText(stampDef.symbol, {
          x: pos.x + sizePt * 0.14,
          y: pos.y - sizePt * 0.82,
          size: sizePt * 0.72,
          font: activeFont,
          color: rgb(r, g, b),
        });
      } catch {
        // フォント未対応文字の場合はスキップ
      }
    }

    // 3. テキストボックス（横書き・縦書き）の描画
    const texts = Array.isArray(annotations.texts) ? annotations.texts : [];
    for (const item of texts) {
      const content = String(item.content || '');
      if (!content.trim()) continue;

      const { r, g, b } = hexToRgb01(item.color || '#1e293b');
      const fontSizePt = ((item.fontSize || 16) / 595.28) * pdfW;
      const topLeft = normalizedToPdfPoint(item.xNorm, item.yNorm, pdfW, pdfH);

      if (item.writingMode === 'vertical') {
        const placements = layoutVerticalTextForPdf(content, topLeft.x, topLeft.y, fontSizePt);
        for (const glyph of placements) {
          try {
            pdfPage.drawText(glyph.char, {
              x: glyph.x,
              y: glyph.y,
              size: glyph.fontSize,
              font: activeFont,
              color: rgb(r, g, b),
              rotate: degrees(glyph.rotateDeg),
            });
          } catch {
            // 未収録グリフがあってもクラッシュさせない
          }
        }
      } else {
        // 横書き（複数行対応）
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const lineStep = fontSizePt * 1.28;
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const lineText = lines[lineIdx];
          if (!lineText) continue;
          try {
            pdfPage.drawText(lineText, {
              x: topLeft.x,
              y: topLeft.y - (lineIdx + 0.9) * lineStep,
              size: fontSizePt,
              font: activeFont,
              color: rgb(r, g, b),
            });
          } catch {
            // 未収録グリフ保護
          }
        }
      }
    }
  }

  return await outPdf.save();
}

/**
 * PDF出力時に白紙ノートテンプレートの罫線をpdf-libページに描画する
 * @param {any} pdfPage
 * @param {number} width
 * @param {number} height
 * @param {'plain' | 'ruled' | 'vertical-ruled' | 'grid'} template
 * @param {any} rgb
 */
function drawBlankTemplateOnPdfPage(pdfPage, width, height, template, rgb) {
  const marginX = width * 0.06;
  const marginY = height * 0.06;
  const lineColor = rgb(0.82, 0.85, 0.9);

  if (template === 'ruled') {
    const rows = 26;
    const stepY = (height - marginY * 2) / rows;
    for (let i = 0; i <= rows; i++) {
      const y = marginY + i * stepY;
      pdfPage.drawLine({
        start: { x: marginX, y },
        end: { x: width - marginX, y },
        thickness: 0.7,
        color: lineColor,
      });
    }
  } else if (template === 'vertical-ruled') {
    const cols = 15;
    const stepX = (width - marginX * 2) / cols;
    for (let i = 0; i <= cols; i++) {
      const x = marginX + i * stepX;
      pdfPage.drawLine({
        start: { x, y: marginY },
        end: { x, y: height - marginY },
        thickness: 0.7,
        color: lineColor,
      });
    }
  } else if (template === 'grid') {
    const cols = 22;
    const step = (width - marginX * 2) / cols;
    for (let x = marginX; x <= width - marginX + 0.5; x += step) {
      pdfPage.drawLine({
        start: { x, y: marginY },
        end: { x, y: height - marginY },
        thickness: 0.5,
        color: lineColor,
      });
    }
    for (let y = marginY; y <= height - marginY + 0.5; y += step) {
      pdfPage.drawLine({
        start: { x: marginX, y },
        end: { x: width - marginX, y },
        thickness: 0.5,
        color: lineColor,
      });
    }
  }
}

/**
 * すぐ試せる「サンプル授業プリントPDF（2ページ：古典・現代文＆数学）」を生成する
 * @returns {Promise<Uint8Array>}
 */
export async function createSampleHandoutPdfBytes() {
  // @ts-ignore
  const PDFLib = window.PDFLib;
  // @ts-ignore
  const fontkit = window.fontkit;
  const { PDFDocument, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  if (fontkit) {
    pdfDoc.registerFontkit(fontkit);
  }

  let font = null;
  const fontBytes = await loadJapaneseFontBytes();
  if (fontBytes && fontkit) {
    try {
      font = await pdfDoc.embedFont(fontBytes, { subset: true });
    } catch {
      font = null;
    }
  }
  if (!font) {
    font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  }

  // 1ページ目：国語（古文・現代文プリント）
  const p1 = pdfDoc.addPage([595.28, 841.89]);
  p1.drawRectangle({
    x: 36,
    y: 760,
    width: 523,
    height: 44,
    color: rgb(0.95, 0.96, 0.98),
    borderColor: rgb(0.7, 0.75, 0.82),
    borderWidth: 1,
  });
  p1.drawText('第1回 古典・言語文化 授業プリント「徒然草・序段」', {
    x: 50,
    y: 775,
    size: 16,
    font,
    color: rgb(0.1, 0.15, 0.25),
  });

  const p1Lines = [
    '【本文】次の傍線部の意味と文法事項を空欄に記入せよ。',
    '',
    '「つれづれなるままに、日暮らし、硯にむかひて、',
    '  心にうつりゆくよしなしごとを、そこはかとなく書きつくれば、',
    '  あやしうこそものぐるほしけれ。」（兼好法師『徒然草』）',
    '',
    '問1. 「つれづれなる」の品詞と現代語訳を答えよ。',
    '   答え： [                                              ]',
    '',
    '問2. 「よしなしごと」の意味を答えよ。',
    '   答え： [                                              ]',
    '',
    '問3. 「あやしうこそものぐるほしけれ」に含まれる係り結びの法則を説明せよ。',
    '   係助詞：[          ]  →  結び（活用形）：[              ]',
    '',
    '💡 ヒント：右上の「縦書き」切替ボタンを使うと、本文の横に縦書きで注釈を入れられます！',
  ];

  let yPos = 720;
  for (const line of p1Lines) {
    p1.drawText(line, {
      x: 48,
      y: yPos,
      size: 13,
      font,
      color: rgb(0.15, 0.2, 0.28),
    });
    yPos -= 32;
  }

  // 2ページ目：重要事項＆自由記述欄
  const p2 = pdfDoc.addPage([595.28, 841.89]);
  p2.drawRectangle({
    x: 36,
    y: 760,
    width: 523,
    height: 44,
    color: rgb(0.95, 0.96, 0.98),
    borderColor: rgb(0.7, 0.75, 0.82),
    borderWidth: 1,
  });
  p2.drawText('第1回 重要古語チェック＆定期テスト対策演習', {
    x: 50,
    y: 775,
    size: 16,
    font,
    color: rgb(0.1, 0.15, 0.25),
  });

  const p2Lines = [
    '■ テスト頻出ポイント整理',
    '1. 三大随筆をすべて答えよ。',
    '   ① 枕草子（清少納言）  ② 方丈記（鴨長明）  ③ [            ]',
    '',
    '2. 「そこはかとなく」の現代語訳： [                        ]',
    '',
    '3. 「あやしう」の活用現象名： [                  ]',
    '',
    '■ 授業メモ欄（★スタンプや赤文字を入れて「赤シート」「AI問題作成」を試してみよう）',
  ];

  yPos = 720;
  for (const line of p2Lines) {
    p2.drawText(line, {
      x: 48,
      y: yPos,
      size: 13,
      font,
      color: rgb(0.15, 0.2, 0.28),
    });
    yPos -= 32;
  }

  p2.drawRectangle({
    x: 48,
    y: 120,
    width: 500,
    height: 280,
    color: rgb(0.99, 0.99, 1.0),
    borderColor: rgb(0.8, 0.84, 0.9),
    borderWidth: 1,
  });

  return await pdfDoc.save();
}
