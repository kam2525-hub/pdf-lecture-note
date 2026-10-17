// @ts-check
/**
 * スマート授業プリント＆AI暗記ノート - ドメインモデル・純粋ロジック
 * 座標変換、縦書きレイアウト計算、赤シート判定、Undo/Redo履歴、横断検索、AIプロンプト生成を担う。
 */

export const DEFAULT_SUBJECTS = [
  {
    id: 'kokugo',
    name: '国語（現代文・古文・漢文）',
    shortName: '国語',
    color: '#e11d48',
    icon: '📖',
    defaultWritingMode: /** @type {'vertical' | 'horizontal'} */ ('vertical'),
    defaultBlankTemplate: /** @type {'vertical-ruled' | 'ruled' | 'grid' | 'plain'} */ ('vertical-ruled'),
  },
  {
    id: 'math',
    name: '数学（ⅠA・ⅡB・C）',
    shortName: '数学',
    color: '#2563eb',
    icon: '📐',
    defaultWritingMode: /** @type {'vertical' | 'horizontal'} */ ('horizontal'),
    defaultBlankTemplate: /** @type {'vertical-ruled' | 'ruled' | 'grid' | 'plain'} */ ('grid'),
  },
  {
    id: 'english',
    name: '英語（R・L・文法）',
    shortName: '英語',
    color: '#059669',
    icon: '🔤',
    defaultWritingMode: /** @type {'vertical' | 'horizontal'} */ ('horizontal'),
    defaultBlankTemplate: /** @type {'vertical-ruled' | 'ruled' | 'grid' | 'plain'} */ ('ruled'),
  },
  {
    id: 'science',
    name: '理科（物理・化学・生物）',
    shortName: '理科',
    color: '#7c3aed',
    icon: '🧪',
    defaultWritingMode: /** @type {'vertical' | 'horizontal'} */ ('horizontal'),
    defaultBlankTemplate: /** @type {'vertical-ruled' | 'ruled' | 'grid' | 'plain'} */ ('grid'),
  },
  {
    id: 'social',
    name: '社会（歴史・地理・公共）',
    shortName: '社会',
    color: '#d97706',
    icon: '🌍',
    defaultWritingMode: /** @type {'vertical' | 'horizontal'} */ ('horizontal'),
    defaultBlankTemplate: /** @type {'vertical-ruled' | 'ruled' | 'grid' | 'plain'} */ ('ruled'),
  },
];

export const STAMP_TYPES = [
  { id: 'star', label: '★重要', symbol: '★', color: '#d97706', bg: '#fef3c7', border: '#f59e0b' },
  { id: 'question', label: '？不明', symbol: '？', color: '#7c3aed', bg: '#ede9fe', border: '#8b5cf6' },
  { id: 'circle', label: '○', symbol: '○', color: '#dc2626', bg: '#fee2e2', border: '#ef4444' },
  { id: 'cross', label: '×', symbol: '×', color: '#2563eb', bg: '#dbeafe', border: '#3b82f6' },
  { id: 'check', label: '✓済', symbol: '✓', color: '#059669', bg: '#d1fae5', border: '#10b981' },
];

export const TEXT_COLORS = [
  { id: 'black', label: '黒（通常）', hex: '#1e293b', isRedSheetTarget: false },
  { id: 'red', label: '赤（赤シート対象）', hex: '#ef4444', isRedSheetTarget: true },
  { id: 'orange', label: 'オレンジ（赤シート対象）', hex: '#f97316', isRedSheetTarget: true },
  { id: 'blue', label: '青（重要補足）', hex: '#2563eb', isRedSheetTarget: false },
  { id: 'green', label: '緑（解説）', hex: '#059669', isRedSheetTarget: false },
];

export const MARKER_COLORS = [
  { id: 'yellow', label: '黄マーカー', hex: '#fde047', opacity: 0.4, isRedSheetTarget: false },
  { id: 'pink', label: 'ピンクマーカー', hex: '#f472b6', opacity: 0.38, isRedSheetTarget: false },
  { id: 'memorize-green', label: '暗記マーカー（赤シート対象）', hex: '#10b981', opacity: 0.45, isRedSheetTarget: true },
  { id: 'blue', label: '青マーカー', hex: '#60a5fa', opacity: 0.38, isRedSheetTarget: false },
];

export const PEN_COLORS = [
  { id: 'red-pen', label: '赤ペン', hex: '#ef4444', isRedSheetTarget: true },
  { id: 'black-pen', label: '黒ペン', hex: '#1e293b', isRedSheetTarget: false },
  { id: 'blue-pen', label: '青ペン', hex: '#2563eb', isRedSheetTarget: false },
];

/**
 * 数値を [min, max] の範囲にクランプする
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  if (!Number.isFinite(val)) return min;
  return Math.min(Math.max(val, min), max);
}

/**
 * 画面キャンバス上の座標 (px) を [0, 1] の正規化座標に変換する
 * @param {number} x
 * @param {number} y
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {{ xNorm: number, yNorm: number }}
 */
export function screenToNormalized(x, y, canvasWidth, canvasHeight) {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 || !Number.isFinite(canvasHeight) || canvasHeight <= 0) {
    throw new Error('Invalid canvas dimensions');
  }
  return {
    xNorm: clamp(x / canvasWidth, 0, 1),
    yNorm: clamp(y / canvasHeight, 0, 1),
  };
}

/**
 * 正規化座標 [0, 1]（左上原点）を PDF 座標系（左下原点, pt）に変換する
 * @param {number} xNorm
 * @param {number} yNorm
 * @param {number} pdfWidth
 * @param {number} pdfHeight
 * @returns {{ x: number, y: number }}
 */
export function normalizedToPdfPoint(xNorm, yNorm, pdfWidth, pdfHeight) {
  if (!Number.isFinite(pdfWidth) || pdfWidth <= 0 || !Number.isFinite(pdfHeight) || pdfHeight <= 0) {
    throw new Error('Invalid PDF page dimensions');
  }
  const cx = clamp(xNorm, 0, 1);
  const cy = clamp(yNorm, 0, 1);
  return {
    x: cx * pdfWidth,
    y: (1 - cy) * pdfHeight,
  };
}

/**
 * 縦書き時に回転や位置補正が必要な文字セット
 */
const VERTICAL_ROTATE_90_CHARS = new Set(['ー', '−', '―', '‐', '-', '…', '‥', '（', '）', '(', ')', '「', '」', '『', '』', '【', '】', '［', '］', '〜', '～', '＝', '=']);
const VERTICAL_TOP_RIGHT_PUNCTUATION = new Set(['、', '。', '，', '．', '｡', '､']);
const VERTICAL_SMALL_KANA = new Set(['っ', 'ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ッ', 'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ']);

/**
 * PDF出力用に縦書きテキストの1文字ずつの配置座標（左下原点PDF座標系）を計算する
 * 縦書きは右上を開始基準（またはボックスの左上基準から列を右→左へ展開）とする。
 * 画面上の writing-mode: vertical-rl のボックス左上 (startX, startY) と総列数に合わせ、
 * 1列目を最も右側に配置し、改行ごとに左へ列を進める。
 *
 * @param {string} text
 * @param {number} boxLeftX PDF上のテキストボックス左端X座標 (pt)
 * @param {number} boxTopY PDF上のテキストボックス上端Y座標 (pt, 左下原点での上端)
 * @param {number} fontSize フォントサイズ (pt)
 * @param {number} [lineHeightFactor=1.18] 文字間の縦送り倍率
 * @param {number} [columnSpacingFactor=1.45] 列間の横送り倍率
 * @returns {Array<{ char: string, x: number, y: number, rotateDeg: number, fontSize: number }>}
 */
export function layoutVerticalTextForPdf(
  text,
  boxLeftX,
  boxTopY,
  fontSize,
  lineHeightFactor = 1.18,
  columnSpacingFactor = 1.45
) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }
  const safeFontSize = Math.max(4, Number.isFinite(fontSize) ? fontSize : 14);
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const columns = normalizedText.split('\n');
  const colStep = safeFontSize * columnSpacingFactor;
  const charStep = safeFontSize * lineHeightFactor;

  // 総列数に応じて右端の列X座標を決定（1列のみなら boxLeftX）
  const totalCols = columns.length;
  const rightMostColX = boxLeftX + Math.max(0, totalCols - 1) * colStep;

  /** @type {Array<{ char: string, x: number, y: number, rotateDeg: number, fontSize: number }>} */
  const placements = [];

  for (let colIdx = 0; colIdx < totalCols; colIdx++) {
    const colText = Array.from(columns[colIdx]);
    const baseColX = rightMostColX - colIdx * colStep;

    for (let rowIdx = 0; rowIdx < colText.length; rowIdx++) {
      const ch = colText[rowIdx];
      if (ch === ' ' || ch === '　') {
        continue;
      }
      // PDFのdrawTextはベースライン基準のため、上端から1文字分下げた位置を1文字目の基準にする
      let x = baseColX;
      let y = boxTopY - (rowIdx + 1) * charStep;
      let rotateDeg = 0;
      let renderSize = safeFontSize;

      if (VERTICAL_ROTATE_90_CHARS.has(ch)) {
        // 長音や括弧類は時計回り90度回転（pdf-libでは -90度）し、位置を中央補正
        rotateDeg = -90;
        x = baseColX + safeFontSize * 0.15;
        y = y + safeFontSize * 0.82;
      } else if (VERTICAL_TOP_RIGHT_PUNCTUATION.has(ch)) {
        // 句読点はマスの右上に寄せる
        x = baseColX + safeFontSize * 0.45;
        y = y + safeFontSize * 0.45;
      } else if (VERTICAL_SMALL_KANA.has(ch)) {
        // 促音・拗音は少し右上へ寄せる
        x = baseColX + safeFontSize * 0.1;
        y = y + safeFontSize * 0.1;
      }

      placements.push({
        char: ch,
        x,
        y,
        rotateDeg,
        fontSize: renderSize,
      });
    }
  }

  return placements;
}

/**
 * テキスト要素がデジタル赤シートの非表示対象かどうかを判定する
 * @param {{ color?: string, isMemorizeTarget?: boolean }} textItem
 * @returns {boolean}
 */
export function isRedSheetTargetText(textItem) {
  if (!textItem || typeof textItem !== 'object') return false;
  if (textItem.isMemorizeTarget === true) return true;
  const c = (textItem.color || '').toLowerCase();
  return c === '#ef4444' || c === '#f97316' || c === '#dc2626';
}

/**
 * 手書きストロークがデジタル赤シートの非表示対象かどうかを判定する
 * @param {{ color?: string, isRedSheetTarget?: boolean, tool?: string }} strokeItem
 * @returns {boolean}
 */
export function isRedSheetTargetStroke(strokeItem) {
  if (!strokeItem || typeof strokeItem !== 'object') return false;
  if (strokeItem.isRedSheetTarget === true) return true;
  const c = (strokeItem.color || '').toLowerCase();
  return c === '#10b981' || c === '#ef4444';
}

/**
 * ページアノテーションのディープコピーを作成する
 * @param {{ texts?: Array<any>, strokes?: Array<any>, stamps?: Array<any> }} annotation
 * @returns {{ texts: Array<any>, strokes: Array<any>, stamps: Array<any> }}
 */
export function clonePageAnnotation(annotation) {
  const safe = annotation || {};
  return {
    texts: Array.isArray(safe.texts) ? safe.texts.map((t) => ({ ...t })) : [],
    strokes: Array.isArray(safe.strokes)
      ? safe.strokes.map((s) => ({
          ...s,
          points: Array.isArray(s.points) ? s.points.map((p) => ({ ...p })) : [],
        }))
      : [],
    stamps: Array.isArray(safe.stamps) ? safe.stamps.map((st) => ({ ...st })) : [],
  };
}

/**
 * Undo / Redo 履歴管理クラス（上限ステップ数付き）
 */
export class HistoryManager {
  /**
   * @param {number} [maxSteps=50]
   */
  constructor(maxSteps = 50) {
    this.maxSteps = Math.max(1, maxSteps);
    /** @type {Array<{ texts: Array<any>, strokes: Array<any>, stamps: Array<any> }>} */
    this.undoStack = [];
    /** @type {Array<{ texts: Array<any>, strokes: Array<any>, stamps: Array<any> }>} */
    this.redoStack = [];
  }

  /**
   * 変更前の状態を保存し、Redoスタックをクリアする
   * @param {{ texts?: Array<any>, strokes?: Array<any>, stamps?: Array<any> }} stateBeforeChange
   */
  record(stateBeforeChange) {
    this.undoStack.push(clonePageAnnotation(stateBeforeChange));
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * 1つ前の状態に戻す
   * @param {{ texts?: Array<any>, strokes?: Array<any>, stamps?: Array<any> }} currentState
   * @returns {{ texts: Array<any>, strokes: Array<any>, stamps: Array<any> } | null}
   */
  undo(currentState) {
    if (this.undoStack.length === 0) return null;
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(clonePageAnnotation(currentState));
    return clonePageAnnotation(prev);
  }

  /**
   * やり直した操作を1つ進める
   * @param {{ texts?: Array<any>, strokes?: Array<any>, stamps?: Array<any> }} currentState
   * @returns {{ texts: Array<any>, strokes: Array<any>, stamps: Array<any> } | null}
   */
  redo(currentState) {
    if (this.redoStack.length === 0) return null;
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(clonePageAnnotation(currentState));
    return clonePageAnnotation(next);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/**
 * 全プリント横断キーワード検索を実行する
 * 元のPDFから抽出されたテキスト＋自分が書き込んだメモ＋プリント名を横断検索する
 *
 * @param {Array<any>} documents
 * @param {string} query
 * @param {string} [subjectId='all']
 * @returns {Array<{
 *   docId: string,
 *   docTitle: string,
 *   subjectId: string,
 *   matchedInTitle: boolean,
 *   pageMatches: Array<{ pageIndex: number, pageNumber: number, snippet: string, source: 'memo' | 'pdf' }>
 * }>}
 */
export function searchDocuments(documents, query, subjectId = 'all') {
  if (!Array.isArray(documents)) return [];
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return [];

  const results = [];

  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') continue;
    if (subjectId && subjectId !== 'all' && doc.subjectId !== subjectId) continue;

    const title = String(doc.title || '');
    const matchedInTitle = title.toLowerCase().includes(trimmed);
    /** @type {Array<{ pageIndex: number, pageNumber: number, snippet: string, source: 'memo' | 'pdf' }>} */
    const pageMatches = [];

    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] || {};
      const annotations = page.annotations || {};
      const texts = Array.isArray(annotations.texts) ? annotations.texts : [];

      // 1. ユーザーの書き込みテキストから検索
      for (const t of texts) {
        const content = String(t.content || '');
        if (content.toLowerCase().includes(trimmed)) {
          pageMatches.push({
            pageIndex: i,
            pageNumber: i + 1,
            snippet: content,
            source: 'memo',
          });
        }
      }

      // 2. 元PDFの抽出テキストから検索
      const pdfText = String(page.extractedText || '');
      const idx = pdfText.toLowerCase().indexOf(trimmed);
      if (idx !== -1) {
        const start = Math.max(0, idx - 20);
        const end = Math.min(pdfText.length, idx + trimmed.length + 30);
        const snippet = (start > 0 ? '…' : '') + pdfText.slice(start, end) + (end < pdfText.length ? '…' : '');
        pageMatches.push({
          pageIndex: i,
          pageNumber: i + 1,
          snippet,
          source: 'pdf',
        });
      }
    }

    if (matchedInTitle || pageMatches.length > 0) {
      results.push({
        docId: doc.id,
        docTitle: title,
        subjectId: doc.subjectId,
        matchedInTitle,
        pageMatches,
      });
    }
  }

  return results;
}

/**
 * 「★（重要）」「？（不明）」などのスタンプが押されたページだけを全プリントから抽出する
 * @param {Array<any>} documents
 * @param {'star' | 'question' | 'all-important'} filterType
 * @param {string} [subjectId='all']
 * @returns {Array<{
 *   docId: string,
 *   docTitle: string,
 *   subjectId: string,
 *   pageIndex: number,
 *   pageNumber: number,
 *   stamps: Array<any>,
 *   texts: Array<any>,
 *   extractedText: string
 * }>}
 */
export function extractStampedPages(documents, filterType = 'all-important', subjectId = 'all') {
  if (!Array.isArray(documents)) return [];
  const extracted = [];

  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') continue;
    if (subjectId && subjectId !== 'all' && doc.subjectId !== subjectId) continue;

    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] || {};
      const annotations = page.annotations || {};
      const stamps = Array.isArray(annotations.stamps) ? annotations.stamps : [];
      const texts = Array.isArray(annotations.texts) ? annotations.texts : [];

      const matchingStamps = stamps.filter((st) => {
        if (!st) return false;
        if (filterType === 'star') return st.stampId === 'star';
        if (filterType === 'question') return st.stampId === 'question';
        return st.stampId === 'star' || st.stampId === 'question';
      });

      if (matchingStamps.length > 0) {
        extracted.push({
          docId: doc.id,
          docTitle: String(doc.title || '無題のプリント'),
          subjectId: doc.subjectId,
          pageIndex: i,
          pageNumber: i + 1,
          stamps: matchingStamps,
          texts,
          extractedText: String(page.extractedText || ''),
        });
      }
    }
  }

  return extracted;
}

/**
 * テスト勉強用のAIプロンプトを自動生成する
 * @param {any} doc プリントドキュメント
 * @param {'quiz' | 'explain' | 'summary'} mode
 * @param {string} [subjectName='']
 * @returns {string}
 */
export function generateAiStudyPrompt(doc, mode, subjectName = '') {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Document is required to generate prompt');
  }

  const title = String(doc.title || '授業プリント');
  const pages = Array.isArray(doc.pages) ? doc.pages : [];

  let headerInstruction = '';
  if (mode === 'quiz') {
    headerInstruction = [
      'あなたは優秀な家庭教師です。以下の授業プリントの内容と、私が授業中に書き込んだメモ（特に【★重要】や【赤字（暗記対象）】の箇所）をもとに、定期テスト対策用の「一問一答（10問）」と「記述・応用問題（3問）」を作成してください。',
      '問題の後には、解答とわかりやすい解説も付けてください。',
    ].join('\n');
  } else if (mode === 'explain') {
    headerInstruction = [
      'あなたは優しい家庭教師です。以下の授業プリントの中で、私が【？不明】スタンプを押したページや疑問メモを中心に、高校生にも直感的にわかるよう噛み砕いて解説してください。',
      '具体例や覚え方のコツがあれば一緒に教えてください。',
    ].join('\n');
  } else {
    headerInstruction = [
      'あなたは優秀な学習アドバイザーです。以下の授業プリントの本文と私の授業メモを統合し、テスト直前に3分で復習できる「要点まとめノート（箇条書き）」を作成してください。',
      '特に私がメモした箇所や重要マークがある部分を優先して整理してください。',
    ].join('\n');
  }

  const lines = [
    headerInstruction,
    '',
    '---',
    `■ 教科: ${subjectName || '指定なし'}`,
    `■ プリント名: ${title}`,
    '---',
  ];

  let hasAnyContent = false;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] || {};
    const annotations = page.annotations || {};
    const texts = Array.isArray(annotations.texts) ? annotations.texts : [];
    const stamps = Array.isArray(annotations.stamps) ? annotations.stamps : [];
    const pdfText = String(page.extractedText || '').trim();

    if (!pdfText && texts.length === 0 && stamps.length === 0) {
      continue;
    }
    hasAnyContent = true;

    const stampLabels = stamps.map((s) => {
      const found = STAMP_TYPES.find((t) => t.id === s.stampId);
      return found ? `【${found.label}】` : `【${s.symbol || ''}】`;
    });

    lines.push('');
    lines.push(`### 📄 ${i + 1}ページ目 ${stampLabels.join(' ')}`.trim());

    if (pdfText) {
      lines.push('【プリント元の文章】');
      lines.push(pdfText);
    }

    if (texts.length > 0) {
      lines.push('【私が書き込んだ授業メモ】');
      for (const t of texts) {
        const content = String(t.content || '').trim();
        if (!content) continue;
        const isMemorize = isRedSheetTargetText(t);
        const prefix = isMemorize ? '- 🔥[赤字・暗記重要] ' : '- 📝 ';
        const modeTag = t.writingMode === 'vertical' ? ' (縦書きメモ)' : '';
        lines.push(`${prefix}${content.replace(/\n/g, ' / ')}${modeTag}`);
      }
    }
  }

  if (!hasAnyContent) {
    lines.push('');
    lines.push('（※まだテキストやメモが入力されていません。プリントに文字を書き込んでから再度お試しください）');
  }

  return lines.join('\n');
}
