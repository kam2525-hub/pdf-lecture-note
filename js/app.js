// @ts-check
/**
 * スマート授業プリント＆AI暗記ノート - メインUIコントローラ
 */
import {
  STAMP_TYPES,
  TEXT_COLORS,
  MARKER_COLORS,
  PEN_COLORS,
  screenToNormalized,
  isRedSheetTargetText,
  isRedSheetTargetStroke,
  HistoryManager,
  searchDocuments,
  extractStampedPages,
  generateAiStudyPrompt,
  clamp,
} from './models.js';
import {
  initDB,
  getAllSubjects,
  saveSubject,
  getAllDocuments,
  getDocumentById,
  saveDocument,
  deleteDocument,
  getSetting,
  saveSetting,
} from './db.js';
import {
  parsePdfDocument,
  loadPdfJsInstance,
  renderPageBaseToCanvas,
  exportAnnotatedPdf,
  createSampleHandoutPdfBytes,
} from './pdf-engine.js';

/** アプリケーション状態 */
const state = {
  /** @type {Array<any>} */
  subjects: [],
  /** @type {Array<any>} */
  documents: [],
  selectedSubjectId: 'all',
  /** @type {'documents' | 'star' | 'question'} */
  homeViewMode: 'documents',
  searchQuery: '',

  // 現在開いているドキュメントとページ
  /** @type {any | null} */
  activeDoc: null,
  /** @type {any | null} */
  activePdfJsDoc: null,
  currentPageIndex: 0,
  zoomScale: 1.0,
  baseViewerWidth: 620,
  canvasCssWidth: 620,
  canvasCssHeight: 877,

  // ツール状態
  /** @type {'pan' | 'text' | 'marker' | 'pen' | 'eraser' | 'stamp'} */
  currentTool: 'text',
  /** @type {string | null} */
  selectedTextId: null,
  redSheetActive: false,

  // 記憶されるツール設定
  prefWritingMode: /** @type {'horizontal' | 'vertical'} */ ('horizontal'),
  prefTextColor: '#ef4444', // デフォルト赤（暗記シートですぐ試せる色）
  prefFontSize: 16,
  prefMarkerColor: '#fde047',
  prefMarkerOpacity: 0.4,
  prefMarkerRedSheet: false,
  prefPenColor: '#ef4444',
  prefPenSize: 3,
  prefStraightLine: false,
  prefStampId: 'star',

  // ページごとのUndo/Redo管理
  /** @type {Map<string, HistoryManager>} */
  historyByPageId: new Map(),

  // 手書き描画中の一時状態
  isDrawing: false,
  /** @type {Array<{ xNorm: number, yNorm: number }>} */
  currentStrokePoints: [],
};

/**
 * トーストメッセージを表示する
 * @param {string} msg
 */
export function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2600);
}

/**
 * 現在のページのHistoryManagerを取得する
 * @returns {HistoryManager}
 */
function getCurrentPageHistory() {
  if (!state.activeDoc) return new HistoryManager();
  const page = state.activeDoc.pages[state.currentPageIndex];
  if (!page) return new HistoryManager();
  let hist = state.historyByPageId.get(page.id);
  if (!hist) {
    hist = new HistoryManager(50);
    state.historyByPageId.set(page.id, hist);
  }
  return hist;
}

/**
 * 変更前の状態をUndo履歴に記録する
 */
function recordHistoryBeforeChange() {
  if (!state.activeDoc) return;
  const page = state.activeDoc.pages[state.currentPageIndex];
  if (!page) return;
  getCurrentPageHistory().record(page.annotations);
  updateUndoRedoButtons();
}

/**
 * 自動保存を実行し、ステータス表示を更新する
 */
async function autoSaveActiveDocument() {
  if (!state.activeDoc) return;
  const statusEl = document.getElementById('save-status');
  if (statusEl) statusEl.textContent = '保存中...';
  await saveDocument(state.activeDoc);
  state.documents = await getAllDocuments();
  if (statusEl) statusEl.textContent = '✓ 自動保存済';
}

/**
 * 保存されていたユーザー設定を読み込む
 */
async function loadUserPreferences() {
  state.prefTextColor = await getSetting('prefTextColor', '#ef4444');
  state.prefFontSize = await getSetting('prefFontSize', 16);
  state.prefWritingMode = await getSetting('prefWritingMode', 'horizontal');
  state.prefMarkerColor = await getSetting('prefMarkerColor', '#fde047');
  state.prefMarkerOpacity = await getSetting('prefMarkerOpacity', 0.4);
  state.prefMarkerRedSheet = await getSetting('prefMarkerRedSheet', false);
  state.prefPenColor = await getSetting('prefPenColor', '#ef4444');
  state.prefStraightLine = await getSetting('prefStraightLine', false);
  state.prefStampId = await getSetting('prefStampId', 'star');
}

/* ============================================================================
 * ホーム画面の描画と操作
 * ========================================================================== */

async function refreshHomeData() {
  state.subjects = await getAllSubjects();
  state.documents = await getAllDocuments();
  renderSubjectPills();
  renderHomeViewTabs();
  renderHomeContent();
}

function renderSubjectPills() {
  const bar = document.getElementById('subject-pills-bar');
  if (!bar) return;
  bar.textContent = '';

  const allBtn = document.createElement('button');
  allBtn.className = `subject-pill ${state.selectedSubjectId === 'all' ? 'active' : ''}`;
  allBtn.textContent = '📚 すべての教科';
  allBtn.addEventListener('click', () => {
    state.selectedSubjectId = 'all';
    renderSubjectPills();
    renderHomeContent();
  });
  bar.appendChild(allBtn);

  for (const subj of state.subjects) {
    const pill = document.createElement('button');
    pill.className = `subject-pill ${state.selectedSubjectId === subj.id ? 'active' : ''}`;
    if (state.selectedSubjectId === subj.id) {
      pill.style.backgroundColor = subj.color;
      pill.style.borderColor = subj.color;
    }
    pill.textContent = `${subj.icon || '📁'} ${subj.shortName || subj.name}`;
    pill.addEventListener('click', () => {
      state.selectedSubjectId = subj.id;
      renderSubjectPills();
      renderHomeContent();
    });
    bar.appendChild(pill);
  }

  const addSubjBtn = document.createElement('button');
  addSubjBtn.className = 'subject-pill';
  addSubjBtn.textContent = '＋ 教科追加';
  addSubjBtn.addEventListener('click', openAddSubjectModal);
  bar.appendChild(addSubjBtn);
}

function renderHomeViewTabs() {
  const tabs = document.querySelectorAll('.view-tab');
  tabs.forEach((tab) => {
    const mode = tab.getAttribute('data-view-mode');
    if (mode === state.homeViewMode) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
}

function renderHomeContent() {
  const container = document.getElementById('home-content');
  if (!container) return;
  container.textContent = '';

  // 1. 検索クエリが入力されている場合は横断検索結果を表示
  if (state.searchQuery.trim().length > 0) {
    renderSearchResults(container);
    return;
  }

  // 2. ★重要 / ？不明 ページまとめモードの場合
  if (state.homeViewMode === 'star' || state.homeViewMode === 'question') {
    renderStampedPagesSummary(container, state.homeViewMode);
    return;
  }

  // 3. 通常のプリント・ノート一覧表示
  const filteredDocs = state.documents.filter(
    (d) => state.selectedSubjectId === 'all' || d.subjectId === state.selectedSubjectId
  );

  if (filteredDocs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const h3 = document.createElement('h3');
    h3.textContent = '📄 まだ授業プリントやノートがありません';
    const p = document.createElement('p');
    p.style.color = 'var(--text-sub)';
    p.style.fontSize = '0.9rem';
    p.textContent =
      '上の「PDF取込」から配布プリントを読み込むか、「サンプル授業プリントで試す」を押して縦書き・赤シート・AI問題作成をすぐ体験できます！';

    const sampleBtn = document.createElement('button');
    sampleBtn.className = 'btn btn-primary';
    sampleBtn.style.marginTop = '12px';
    sampleBtn.textContent = '✨ サンプル授業プリントを作成して試す';
    sampleBtn.addEventListener('click', handleCreateSampleDocument);

    empty.append(h3, p, sampleBtn);
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'doc-grid';

  for (const doc of filteredDocs) {
    const subj = state.subjects.find((s) => s.id === doc.subjectId) || {
      shortName: 'その他',
      color: '#64748b',
      icon: '📄',
    };

    const card = document.createElement('div');
    card.className = 'doc-card';

    const header = document.createElement('div');
    header.className = 'doc-card-header';

    const badge = document.createElement('span');
    badge.className = 'subject-badge';
    badge.style.backgroundColor = subj.color;
    badge.textContent = `${subj.icon} ${subj.shortName}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.style.padding = '3px 8px';
    delBtn.style.fontSize = '0.72rem';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`「${doc.title}」を削除しますか？`)) {
        await deleteDocument(doc.id);
        await refreshHomeData();
        showToast('削除しました');
      }
    });

    header.append(badge, delBtn);

    const titleEl = document.createElement('div');
    titleEl.className = 'doc-card-title';
    titleEl.textContent = doc.title;

    // スタンプ数やメモ数の集計
    let memoCount = 0;
    let starCount = 0;
    let questionCount = 0;
    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    for (const p of pages) {
      const ann = p.annotations || {};
      memoCount += Array.isArray(ann.texts) ? ann.texts.length : 0;
      const stamps = Array.isArray(ann.stamps) ? ann.stamps : [];
      starCount += stamps.filter((s) => s.stampId === 'star').length;
      questionCount += stamps.filter((s) => s.stampId === 'question').length;
    }

    const badgesRow = document.createElement('div');
    badgesRow.className = 'doc-card-badges';

    const pageTag = document.createElement('span');
    pageTag.className = 'mini-tag memo';
    pageTag.textContent = `全${pages.length}ページ / メモ${memoCount}件`;
    badgesRow.appendChild(pageTag);

    if (starCount > 0) {
      const starTag = document.createElement('span');
      starTag.className = 'mini-tag star';
      starTag.textContent = `★重要 ×${starCount}`;
      badgesRow.appendChild(starTag);
    }
    if (questionCount > 0) {
      const qTag = document.createElement('span');
      qTag.className = 'mini-tag question';
      qTag.textContent = `？不明 ×${questionCount}`;
      badgesRow.appendChild(qTag);
    }

    const meta = document.createElement('div');
    meta.className = 'doc-card-meta';
    const dateStr = new Date(doc.updatedAt || Date.now()).toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    meta.textContent = `更新: ${dateStr}`;

    card.append(header, titleEl, badgesRow, meta);
    card.addEventListener('click', () => openDocumentEditor(doc.id, 0));
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

/**
 * 全プリント横断検索の結果を描画する
 * @param {HTMLElement} container
 */
function renderSearchResults(container) {
  const results = searchDocuments(state.documents, state.searchQuery, state.selectedSubjectId);

  const heading = document.createElement('div');
  heading.style.marginBottom = '12px';
  heading.style.fontWeight = '700';
  heading.textContent = `🔍 「${state.searchQuery}」の検索結果（${results.length}件のプリント）`;
  container.appendChild(heading);

  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '該当するプリントや書き込みメモは見つかりませんでした。';
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'doc-grid';

  for (const res of results) {
    const card = document.createElement('div');
    card.className = 'doc-card';

    const title = document.createElement('div');
    title.className = 'doc-card-title';
    title.textContent = res.docTitle;
    card.appendChild(title);

    if (res.pageMatches.length === 0) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'プリントを開く';
      btn.addEventListener('click', () => openDocumentEditor(res.docId, 0));
      card.appendChild(btn);
    } else {
      for (const m of res.pageMatches.slice(0, 4)) {
        const matchRow = document.createElement('div');
        matchRow.style.padding = '8px';
        matchRow.style.background = 'var(--bg-muted)';
        matchRow.style.borderRadius = '8px';
        matchRow.style.fontSize = '0.82rem';
        matchRow.style.cursor = 'pointer';

        const badge = document.createElement('span');
        badge.className = `mini-tag ${m.source === 'memo' ? 'star' : 'memo'}`;
        badge.style.marginRight = '6px';
        badge.textContent = `${m.pageNumber}P (${m.source === 'memo' ? '自分のメモ' : 'プリント本文'})`;

        const textSpan = document.createElement('span');
        textSpan.textContent = m.snippet;

        matchRow.append(badge, textSpan);
        matchRow.addEventListener('click', (e) => {
          e.stopPropagation();
          openDocumentEditor(res.docId, m.pageIndex);
        });
        card.appendChild(matchRow);
      }
    }

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

/**
 * 「★重要」「？不明」スタンプが押されたページまとめ画面を描画する
 * @param {HTMLElement} container
 * @param {'star' | 'question'} filterType
 */
function renderStampedPagesSummary(container, filterType) {
  const items = extractStampedPages(state.documents, filterType, state.selectedSubjectId);
  const label = filterType === 'star' ? '★重要（テスト出る！）' : '？不明（要復習・AI質問用）';

  const heading = document.createElement('div');
  heading.style.marginBottom = '12px';
  heading.style.fontWeight = '700';
  heading.textContent = `${label} スタンプがあるページ一覧（${items.length}ページ）`;
  container.appendChild(heading);

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = `まだ「${label}」スタンプが押されたページはありません。プリント編集画面の「スタンプ」ツールから配置できます！`;
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'doc-grid';

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'doc-card';

    const title = document.createElement('div');
    title.className = 'doc-card-title';
    title.textContent = `${item.docTitle} （${item.pageNumber}ページ目）`;

    const memoList = document.createElement('div');
    memoList.style.fontSize = '0.83rem';
    memoList.style.color = 'var(--text-sub)';
    const memos = item.texts.map((t) => t.content).filter(Boolean);
    memoList.textContent =
      memos.length > 0 ? `📝 メモ: ${memos.join(' / ')}` : item.extractedText.slice(0, 80) || '（メモなし）';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary';
    openBtn.textContent = `📄 ${item.pageNumber}ページ目をすぐ開く`;
    openBtn.addEventListener('click', () => openDocumentEditor(item.docId, item.pageIndex));

    card.append(title, memoList, openBtn);
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

/* ============================================================================
 * プリント取込・白紙ノート作成・サンプル生成
 * ========================================================================== */

/**
 * PDFファイルを選択して新規ドキュメントとして保存・オープンする
 * @param {File} file
 */
async function handlePdfFileUpload(file) {
  try {
    showToast('PDFを読み込んでいます...');
    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);
    const parsed = await parsePdfDocument(pdfBytes);

    const targetSubjectId =
      state.selectedSubjectId !== 'all' ? state.selectedSubjectId : state.subjects[0]?.id || 'kokugo';

    const newDoc = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: file.name.replace(/\.pdf$/i, ''),
      subjectId: targetSubjectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pdfBytes,
      pages: parsed.pages,
    };

    await saveDocument(newDoc);
    await refreshHomeData();
    await openDocumentEditor(newDoc.id, 0);
    showToast(`全${parsed.numPages}ページのPDFを取り込みました！`);
  } catch (err) {
    console.error(err);
    alert(`PDFの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 新規の白紙ノートを作成する
 */
async function handleCreateBlankNotebook() {
  const targetSubjectId =
    state.selectedSubjectId !== 'all' ? state.selectedSubjectId : state.subjects[0]?.id || 'kokugo';
  const subj = state.subjects.find((s) => s.id === targetSubjectId);
  const defaultTemplate = subj?.defaultBlankTemplate || 'ruled';

  const title = prompt('新しいノートのタイトルを入力してください:', `${subj?.shortName || '授業'}ノート`);
  if (!title) return;

  const newDoc = {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    subjectId: targetSubjectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pdfBytes: null,
    pages: [
      {
        id: `page_${Date.now()}_1`,
        type: 'blank',
        sourcePdfPageIndex: null,
        template: defaultTemplate,
        width: 595.28,
        height: 841.89,
        extractedText: '',
        annotations: {
          texts: [],
          strokes: [],
          stamps: [],
        },
      },
    ],
  };

  await saveDocument(newDoc);
  await refreshHomeData();
  await openDocumentEditor(newDoc.id, 0);
}

/**
 * 縦書き・赤シート・スタンプ・マーカーが最初から入った体験用サンプル授業プリントを生成する
 */
async function handleCreateSampleDocument() {
  try {
    showToast('サンプル授業プリントを生成しています...');
    const pdfBytes = await createSampleHandoutPdfBytes();
    const parsed = await parsePdfDocument(pdfBytes);

    // 1ページ目にサンプルの縦書きメモ・赤シート対象解答・マーカー・スタンプを初期配置
    if (parsed.pages[0]) {
      parsed.pages[0].annotations = {
        texts: [
          {
            id: 'sample_txt_1',
            xNorm: 0.21,
            yNorm: 0.425,
            content: '形容動詞ナリ活用・することがなくて退屈だ',
            color: '#ef4444', // 赤シート対象
            fontSize: 15,
            writingMode: 'horizontal',
            isMemorizeTarget: true,
          },
          {
            id: 'sample_txt_2',
            xNorm: 0.21,
            yNorm: 0.54,
            content: 'たわいもないこと・つまらないこと',
            color: '#ef4444', // 赤シート対象
            fontSize: 15,
            writingMode: 'horizontal',
            isMemorizeTarget: true,
          },
          {
            id: 'sample_txt_3',
            xNorm: 0.2,
            yNorm: 0.652,
            content: 'こそ  →  已然形（ものぐるほしけれ）',
            color: '#f97316', // オレンジ（赤シート対象）
            fontSize: 15,
            writingMode: 'horizontal',
            isMemorizeTarget: true,
          },
          {
            id: 'sample_txt_vertical',
            xNorm: 0.84,
            yNorm: 0.18,
            content: '兼好法師\n日本三大随筆\nテスト必出！',
            color: '#2563eb',
            fontSize: 15,
            writingMode: 'vertical',
            isMemorizeTarget: false,
          },
        ],
        strokes: [
          {
            id: 'sample_stroke_1',
            tool: 'marker',
            color: '#fde047',
            opacity: 0.42,
            size: 14,
            isRedSheetTarget: false,
            points: [
              { xNorm: 0.1, yNorm: 0.23 },
              { xNorm: 0.68, yNorm: 0.23 },
            ],
          },
        ],
        stamps: [
          {
            id: 'sample_stamp_1',
            stampId: 'star',
            xNorm: 0.06,
            yNorm: 0.61,
            size: 28,
          },
        ],
      };
    }

    if (parsed.pages[1]) {
      parsed.pages[1].annotations = {
        texts: [
          {
            id: 'sample_txt_p2_1',
            xNorm: 0.58,
            yNorm: 0.228,
            content: '徒然草（兼好法師）',
            color: '#ef4444',
            fontSize: 15,
            writingMode: 'horizontal',
            isMemorizeTarget: true,
          },
          {
            id: 'sample_txt_p2_2',
            xNorm: 0.36,
            yNorm: 0.38,
            content: 'ウ音便（あやしく → あやしう）',
            color: '#ef4444',
            fontSize: 15,
            writingMode: 'horizontal',
            isMemorizeTarget: true,
          },
        ],
        strokes: [],
        stamps: [
          {
            id: 'sample_stamp_p2_q',
            stampId: 'question',
            xNorm: 0.06,
            yNorm: 0.37,
            size: 28,
          },
        ],
      };
    }

    const newDoc = {
      id: `doc_sample_${Date.now()}`,
      title: '【サンプル】古典「徒然草・序段」授業プリント',
      subjectId: 'kokugo',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pdfBytes,
      pages: parsed.pages,
    };

    await saveDocument(newDoc);
    await refreshHomeData();
    await openDocumentEditor(newDoc.id, 0);
    showToast('サンプルを作成しました！「赤シート」や「AI勉強」もすぐ試せます');
  } catch (err) {
    console.error(err);
    alert(`サンプル作成エラー: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ============================================================================
 * エディタ画面のオープン・ページ描画・インタラクション
 * ========================================================================== */

/**
 * 指定IDのドキュメントをエディタ画面で開く
 * @param {string} docId
 * @param {number} [initialPageIndex=0]
 */
async function openDocumentEditor(docId, initialPageIndex = 0) {
  const doc = await getDocumentById(docId);
  if (!doc) {
    showToast('プリントが見つかりませんでした');
    return;
  }

  state.activeDoc = doc;
  state.currentPageIndex = clamp(initialPageIndex, 0, Math.max(0, doc.pages.length - 1));
  state.selectedTextId = null;
  state.redSheetActive = false;

  // 教科のデフォルト書字方向を反映（国語なら縦書き優先など）
  const subj = state.subjects.find((s) => s.id === doc.subjectId);
  if (subj && subj.defaultWritingMode) {
    state.prefWritingMode = subj.defaultWritingMode;
  }

  if (doc.pdfBytes && doc.pdfBytes.byteLength > 0) {
    state.activePdfJsDoc = await loadPdfJsInstance(doc.pdfBytes);
  } else {
    state.activePdfJsDoc = null;
  }

  // 画面切り替え
  document.getElementById('home-screen')?.classList.add('hidden');
  document.getElementById('editor-screen')?.classList.remove('hidden');

  const titleInput = /** @type {HTMLInputElement | null} */ (document.getElementById('doc-title-input'));
  if (titleInput) {
    titleInput.value = doc.title;
  }

  // スマホ画面幅に合わせて初期表示サイズを計算
  const viewer = document.getElementById('viewer-container');
  const availWidth = viewer ? Math.max(280, Math.min(780, viewer.clientWidth - 20)) : 600;
  state.baseViewerWidth = availWidth;
  state.zoomScale = 1.0;

  updateRedSheetButtonUI();
  updateToolButtonsUI();
  renderSubToolbar();
  await renderCurrentPage();
}

/**
 * 現在のズーム倍率をステージとスクロール領域（stage-scroll-sizer）に反映する
 * 再レンダリングによる白紙化や余白増加を起こさず、60fpsで即座に拡大縮小する
 * @param {number} newZoom
 */
function applyZoomScale(newZoom) {
  state.zoomScale = clamp(Math.round(newZoom * 100) / 100, 0.6, 3.0);
  const stage = document.getElementById('page-stage');
  const sizer = document.getElementById('stage-scroll-sizer');
  const zoomResetBtn = document.getElementById('btn-zoom-reset');

  if (stage) {
    stage.style.transformOrigin = '0 0';
    stage.style.transform = `scale(${state.zoomScale})`;
  }
  if (sizer) {
    sizer.style.width = `${Math.round(state.canvasCssWidth * state.zoomScale)}px`;
    sizer.style.height = `${Math.round(state.canvasCssHeight * state.zoomScale)}px`;
  }
  if (zoomResetBtn) {
    zoomResetBtn.textContent = `${Math.round(state.zoomScale * 100)}%`;
  }
}

/**
 * 空のまま放置されたテキストボックスを自動整理する
 * @param {string | null} [keepId=null]
 */
function cleanupEmptyTextBoxes(keepId = null) {
  if (!state.activeDoc) return;
  const pageMeta = state.activeDoc.pages[state.currentPageIndex];
  if (!pageMeta || !Array.isArray(pageMeta.annotations?.texts)) return;
  pageMeta.annotations.texts = pageMeta.annotations.texts.filter(
    (t) => t.id === keepId || (typeof t.content === 'string' && t.content.trim().length > 0)
  );
}

/**
 * 現在選択中のページをCanvasとオーバーレイに描画する
 */
async function renderCurrentPage() {
  if (!state.activeDoc) return;
  const pageMeta = state.activeDoc.pages[state.currentPageIndex];
  if (!pageMeta) return;

  const pdfCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('pdf-canvas'));
  const drawCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('drawing-canvas'));
  const stage = document.getElementById('page-stage');
  if (!pdfCanvas || !drawCanvas || !stage) return;

  const targetWidth = Math.round(state.baseViewerWidth);
  const dims = await renderPageBaseToCanvas(pdfCanvas, pageMeta, state.activePdfJsDoc, targetWidth);
  state.canvasCssWidth = dims.width;
  state.canvasCssHeight = dims.height;

  stage.style.width = `${dims.width}px`;
  stage.style.height = `${dims.height}px`;

  // 手書きレイヤーのサイズ同期（高解像度対応）
  const dpr = clamp(Math.max(window.devicePixelRatio || 1, 2), 1, 3);
  drawCanvas.style.width = `${dims.width}px`;
  drawCanvas.style.height = `${dims.height}px`;
  drawCanvas.width = Math.round(dims.width * dpr);
  drawCanvas.height = Math.round(dims.height * dpr);

  applyZoomScale(state.zoomScale);
  renderStrokesCanvas();
  renderOverlayElements();
  updatePageNavUI();
  updateUndoRedoButtons();
}

/**
 * 手書きマーカー・ペンストローク（および赤シートマスク）を描画Canvasにレンダリングする
 */
function renderStrokesCanvas() {
  if (!state.activeDoc) return;
  const pageMeta = state.activeDoc.pages[state.currentPageIndex];
  const drawCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('drawing-canvas'));
  if (!pageMeta || !drawCanvas) return;

  const ctx = drawCanvas.getContext('2d');
  if (!ctx) return;

  const dpr = clamp(Math.max(window.devicePixelRatio || 1, 2), 1, 3);
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  const w = state.canvasCssWidth;
  const h = state.canvasCssHeight;
  const strokes = Array.isArray(pageMeta.annotations?.strokes) ? pageMeta.annotations.strokes : [];

  for (const stroke of strokes) {
    const pts = Array.isArray(stroke.points) ? stroke.points : [];
    if (pts.length < 2) continue;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const scaledWidth = ((stroke.size || 4) / 595.28) * w;
    ctx.lineWidth = scaledWidth;

    const isMaskedInRedSheet =
      state.redSheetActive && isRedSheetTargetStroke(stroke) && !stroke.revealedInRedSheet;

    if (isMaskedInRedSheet) {
      // 赤シートON時は暗記マーカー箇所を不透明ダークレッドで隠す
      ctx.strokeStyle = '#1e293b';
      ctx.globalAlpha = 0.96;
    } else {
      ctx.strokeStyle = stroke.color || '#fde047';
      ctx.globalAlpha = typeof stroke.opacity === 'number' ? stroke.opacity : 1.0;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].xNorm * w, pts[0].yNorm * h);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].xNorm * w, pts[i].yNorm * h);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 現在ドラッグ描画中のプレビュー線
  if (state.isDrawing && state.currentStrokePoints.length >= 2) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const isMarker = state.currentTool === 'marker';
    const size = isMarker ? 16 : state.prefPenSize;
    ctx.lineWidth = (size / 595.28) * w;
    ctx.strokeStyle = isMarker ? state.prefMarkerColor : state.prefPenColor;
    ctx.globalAlpha = isMarker ? state.prefMarkerOpacity : 1.0;

    ctx.beginPath();
    ctx.moveTo(state.currentStrokePoints[0].xNorm * w, state.currentStrokePoints[0].yNorm * h);
    for (let i = 1; i < state.currentStrokePoints.length; i++) {
      ctx.lineTo(state.currentStrokePoints[i].xNorm * w, state.currentStrokePoints[i].yNorm * h);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * テキストボックスの画面端クラス（右端・上端でのバー見切れ防止）を更新する
 * @param {HTMLElement} box
 * @param {{ xNorm: number, yNorm: number }} item
 */
function updateTextBoxEdgeClasses(box, item) {
  if (item.xNorm > 0.52) {
    box.classList.add('align-right');
  } else {
    box.classList.remove('align-right');
  }
  if (item.yNorm < 0.08) {
    box.classList.add('near-top');
  } else {
    box.classList.remove('near-top');
  }
}

/**
 * テキストボックス（横書き・縦書き）とスタンプをオーバーレイDOMに描画する
 */
function renderOverlayElements() {
  if (!state.activeDoc) return;
  const pageMeta = state.activeDoc.pages[state.currentPageIndex];
  const overlay = document.getElementById('overlay-layer');
  if (!pageMeta || !overlay) return;

  overlay.textContent = '';
  const w = state.canvasCssWidth;
  const h = state.canvasCssHeight;

  const annotations = pageMeta.annotations || {};
  const texts = Array.isArray(annotations.texts) ? annotations.texts : [];
  const stamps = Array.isArray(annotations.stamps) ? annotations.stamps : [];

  // 1. スタンプの描画
  for (const st of stamps) {
    const def = STAMP_TYPES.find((t) => t.id === st.stampId) || STAMP_TYPES[0];
    const el = document.createElement('div');
    el.className = 'stamp-item';
    const pxSize = Math.round(((st.size || 28) / 595.28) * w);
    el.style.left = `${Math.round(st.xNorm * w)}px`;
    el.style.top = `${Math.round(st.yNorm * h)}px`;
    el.style.width = `${pxSize}px`;
    el.style.height = `${pxSize}px`;
    el.style.fontSize = `${Math.round(pxSize * 0.62)}px`;
    el.style.color = def.color;
    el.style.backgroundColor = def.bg;
    el.style.border = `2px solid ${def.border}`;
    el.textContent = def.symbol;

    const delBtn = document.createElement('button');
    delBtn.className = 'stamp-delete-btn';
    delBtn.textContent = '×';
    delBtn.title = 'スタンプを削除';
    delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      recordHistoryBeforeChange();
      pageMeta.annotations.stamps = pageMeta.annotations.stamps.filter((item) => item.id !== st.id);
      renderOverlayElements();
      await autoSaveActiveDocument();
    });
    el.appendChild(delBtn);

    // ドラッグ移動＆消しゴム対応
    attachDragBehavior(el, st, async () => {
      if (state.currentTool === 'eraser') {
        recordHistoryBeforeChange();
        pageMeta.annotations.stamps = pageMeta.annotations.stamps.filter((item) => item.id !== st.id);
        renderOverlayElements();
        await autoSaveActiveDocument();
      }
    });

    overlay.appendChild(el);
  }

  // 2. テキストボックス（横書き・縦書き・赤シート対応）の描画
  for (const item of texts) {
    const box = document.createElement('div');
    const isVertical = item.writingMode === 'vertical';
    const isSelected = state.selectedTextId === item.id && !state.redSheetActive;
    const isRedTarget = isRedSheetTargetText(item);

    let redSheetClass = '';
    if (state.redSheetActive && isRedTarget) {
      redSheetClass = item.revealedInRedSheet ? 'red-sheet-revealed' : 'red-sheet-masked';
    }

    box.className = `text-box-item ${isVertical ? 'vertical' : 'horizontal'} ${
      isSelected ? 'selected' : ''
    } ${redSheetClass}`.trim();
    box.setAttribute('data-id', item.id);
    updateTextBoxEdgeClasses(box, item);

    box.style.left = `${Math.round(item.xNorm * w)}px`;
    box.style.top = `${Math.round(item.yNorm * h)}px`;

    // 1. ドラッグ移動ハンドルバー（選択中のみ上部に浮かんで表示されるため、非選択時はPDFを一切隠さない）
    const handleEl = document.createElement('div');
    handleEl.className = 'text-box-handle';

    const handleTitle = document.createElement('div');
    handleTitle.className = 'handle-title-wrap';
    handleTitle.innerHTML = '<span class="handle-icon">✥</span><span>ここをドラッグで移動</span>';

    const editBtn = document.createElement('button');
    editBtn.className = 'handle-edit-btn';
    editBtn.type = 'button';
    editBtn.textContent = '✏️ 入力';
    editBtn.title = '文字を入力・編集';
    editBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const content = /** @type {HTMLElement | null} */ (box.querySelector('.text-box-content'));
      content?.focus();
    });

    handleEl.append(handleTitle, editBtn);
    box.appendChild(handleEl);

    // 2. 選択時のフローティング操作バー（横書き⇔縦書き切替・微調整・サイズ・削除）
    const ctrls = document.createElement('div');
    ctrls.className = 'text-box-controls';
    ctrls.addEventListener('pointerdown', (e) => e.stopPropagation());

    const toggleDirBtn = document.createElement('button');
    toggleDirBtn.className = 'mini-ctrl-btn';
    toggleDirBtn.type = 'button';
    toggleDirBtn.textContent = isVertical ? '🔄 横' : '🔄 縦';
    toggleDirBtn.title = '横書き・縦書き切り替え';
    toggleDirBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      recordHistoryBeforeChange();
      item.writingMode = item.writingMode === 'vertical' ? 'horizontal' : 'vertical';
      state.prefWritingMode = item.writingMode;
      await saveSetting('prefWritingMode', state.prefWritingMode);
      renderOverlayElements();
      renderSubToolbar();
      await autoSaveActiveDocument();
    });

    // 位置微調整（スマホで指で隠れずに細かく動かせる）
    const createNudgeBtn = (label, dxNorm, dyNorm) => {
      const btn = document.createElement('button');
      btn.className = 'mini-ctrl-btn nudge';
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        recordHistoryBeforeChange();
        item.xNorm = clamp(item.xNorm + dxNorm, 0.01, 0.95);
        item.yNorm = clamp(item.yNorm + dyNorm, 0.01, 0.95);
        box.style.left = `${Math.round(item.xNorm * w)}px`;
        box.style.top = `${Math.round(item.yNorm * h)}px`;
        updateTextBoxEdgeClasses(box, item);
        await autoSaveActiveDocument();
      });
      return btn;
    };

    const leftBtn = createNudgeBtn('◀', -0.012, 0);
    leftBtn.setAttribute('data-action', 'nudge-left');
    const upBtn = createNudgeBtn('▲', 0, -0.012);
    upBtn.setAttribute('data-action', 'nudge-up');
    const downBtn = createNudgeBtn('▼', 0, 0.012);
    downBtn.setAttribute('data-action', 'nudge-down');
    const rightBtn = createNudgeBtn('▶', 0.012, 0);
    rightBtn.setAttribute('data-action', 'nudge-right');

    const smallerBtn = document.createElement('button');
    smallerBtn.className = 'mini-ctrl-btn';
    smallerBtn.type = 'button';
    smallerBtn.textContent = 'A-';
    smallerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      recordHistoryBeforeChange();
      item.fontSize = clamp((item.fontSize || 16) - 2, 10, 42);
      state.prefFontSize = item.fontSize;
      await saveSetting('prefFontSize', state.prefFontSize);
      renderOverlayElements();
      renderSubToolbar();
      await autoSaveActiveDocument();
    });

    const largerBtn = document.createElement('button');
    largerBtn.className = 'mini-ctrl-btn';
    largerBtn.type = 'button';
    largerBtn.textContent = 'A+';
    largerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      recordHistoryBeforeChange();
      item.fontSize = clamp((item.fontSize || 16) + 2, 10, 42);
      state.prefFontSize = item.fontSize;
      await saveSetting('prefFontSize', state.prefFontSize);
      renderOverlayElements();
      renderSubToolbar();
      await autoSaveActiveDocument();
    });

    const delTxtBtn = document.createElement('button');
    delTxtBtn.className = 'mini-ctrl-btn danger';
    delTxtBtn.type = 'button';
    delTxtBtn.textContent = '削除';
    delTxtBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      recordHistoryBeforeChange();
      pageMeta.annotations.texts = pageMeta.annotations.texts.filter((t) => t.id !== item.id);
      if (state.selectedTextId === item.id) state.selectedTextId = null;
      renderOverlayElements();
      await autoSaveActiveDocument();
    });

    ctrls.append(toggleDirBtn, leftBtn, upBtn, downBtn, rightBtn, smallerBtn, largerBtn, delTxtBtn);
    box.appendChild(ctrls);

    // 3. テキスト編集本体
    const contentEl = document.createElement('div');
    contentEl.className = 'text-box-content';
    contentEl.contentEditable = state.redSheetActive ? 'false' : 'true';
    const scaledFontPx = Math.max(10, Math.round(((item.fontSize || 16) / 595.28) * w));
    contentEl.style.fontSize = `${scaledFontPx}px`;
    contentEl.style.color = item.color || '#1e293b';
    contentEl.textContent = item.content || '';

    const selectThisBox = () => {
      if (state.selectedTextId !== item.id) {
        cleanupEmptyTextBoxes(item.id);
        state.selectedTextId = item.id;
        document.querySelectorAll('.text-box-item').forEach((el) => el.classList.remove('selected'));
        box.classList.add('selected');
        renderSubToolbar();
      }
    };

    contentEl.addEventListener('click', (e) => {
      if (state.redSheetActive) return;
      e.stopPropagation();
      if (state.currentTool === 'eraser') {
        recordHistoryBeforeChange();
        pageMeta.annotations.texts = pageMeta.annotations.texts.filter((t) => t.id !== item.id);
        renderOverlayElements();
        autoSaveActiveDocument();
        return;
      }
      selectThisBox();
    });

    let beforeEditSnapshotRecorded = false;
    contentEl.addEventListener('focus', () => {
      beforeEditSnapshotRecorded = false;
      selectThisBox();
    });

    contentEl.addEventListener('input', async () => {
      if (!beforeEditSnapshotRecorded) {
        recordHistoryBeforeChange();
        beforeEditSnapshotRecorded = true;
      }
      item.content = contentEl.innerText;
      await autoSaveActiveDocument();
    });

    box.appendChild(contentEl);

    // ハンドルバーにドラッグ移動を付与
    attachDragBehavior(handleEl, item, () => {
      selectThisBox();
    }, box);

    // 赤シートモード時はボックス全体のタップで開閉
    box.addEventListener('click', (e) => {
      if (state.redSheetActive && isRedTarget) {
        e.stopPropagation();
        item.revealedInRedSheet = !item.revealedInRedSheet;
        renderOverlayElements();
      }
    });

    overlay.appendChild(box);
  }
}

/**
 * 要素（テキストボックスハンドル・スタンプ）のドラッグ移動とタップ処理を付与する
 * ズーム倍率 (state.zoomScale) を考慮して指の動きに1:1で追従する
 * @param {HTMLElement} handleEl ドラッグの起点となる要素
 * @param {{ xNorm: number, yNorm: number }} dataItem データオブジェクト
 * @param {() => void} [onTapCallback] タップ時のコールバック
 * @param {HTMLElement | null} [targetMoveEl=null] 実際に移動させる要素（nullならhandleEl自体）
 */
function attachDragBehavior(handleEl, dataItem, onTapCallback, targetMoveEl = null) {
  const moveTarget = targetMoveEl || handleEl;
  let startX = 0;
  let startY = 0;
  let origXNorm = 0;
  let origYNorm = 0;
  let moved = false;
  let dragging = false;

  handleEl.addEventListener('pointerdown', (e) => {
    if (state.redSheetActive) return;

    e.stopPropagation();
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    origXNorm = dataItem.xNorm;
    origYNorm = dataItem.yNorm;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  });

  handleEl.addEventListener('pointermove', (e) => {
    if (!dragging || state.redSheetActive) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!moved) {
        recordHistoryBeforeChange();
      }
      moved = true;
    }
    if (moved) {
      const w = state.canvasCssWidth || 1;
      const h = state.canvasCssHeight || 1;
      const zoom = state.zoomScale || 1;
      dataItem.xNorm = clamp(origXNorm + dx / (w * zoom), 0.01, 0.94);
      dataItem.yNorm = clamp(origYNorm + dy / (h * zoom), 0.01, 0.95);
      moveTarget.style.left = `${Math.round(dataItem.xNorm * w)}px`;
      moveTarget.style.top = `${Math.round(dataItem.yNorm * h)}px`;
      if (targetMoveEl) {
        updateTextBoxEdgeClasses(targetMoveEl, dataItem);
      }
    }
  });

  const endDrag = async (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      handleEl.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (moved) {
      await autoSaveActiveDocument();
    } else if (onTapCallback) {
      onTapCallback();
    }
  };

  handleEl.addEventListener('pointerup', endDrag);
  handleEl.addEventListener('pointercancel', endDrag);
}

/* ============================================================================
 * キャンバス上のタップ（テキスト配置・スタンプ配置・手書き・消しゴム）
 * ========================================================================== */

function setupCanvasInteractions() {
  const drawCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('drawing-canvas'));
  if (!drawCanvas) return;

  drawCanvas.addEventListener('pointerdown', async (e) => {
    if (!state.activeDoc) return;
    // 2本指以上のピンチズーム操作時や移動モード時はスキップ
    if (e.isPrimary === false || state.currentTool === 'pan') return;

    const rect = drawCanvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const { xNorm, yNorm } = screenToNormalized(relX, relY, rect.width, rect.height);
    const pageMeta = state.activeDoc.pages[state.currentPageIndex];
    if (!pageMeta) return;

    // 赤シートモード中：暗記マーカーの上をタップしたら開閉する
    if (state.redSheetActive) {
      const hitStroke = findNearestStroke(pageMeta.annotations.strokes, xNorm, yNorm, 0.04);
      if (hitStroke && isRedSheetTargetStroke(hitStroke)) {
        hitStroke.revealedInRedSheet = !hitStroke.revealedInRedSheet;
        renderStrokesCanvas();
      }
      return;
    }

    // 1. テキスト配置モード
    if (state.currentTool === 'text') {
      // 既存のテキスト選択中なら選択解除＆空ボックス整理のみ行う
      if (state.selectedTextId) {
        state.selectedTextId = null;
        cleanupEmptyTextBoxes(null);
        renderOverlayElements();
        renderSubToolbar();
        await autoSaveActiveDocument();
        return;
      }

      cleanupEmptyTextBoxes(null);
      recordHistoryBeforeChange();
      const newId = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newText = {
        id: newId,
        xNorm: clamp(xNorm, 0.02, 0.9),
        yNorm: clamp(yNorm, 0.02, 0.92),
        content: '',
        color: state.prefTextColor,
        fontSize: state.prefFontSize,
        writingMode: state.prefWritingMode,
        isMemorizeTarget: isRedSheetTargetText({ color: state.prefTextColor }),
      };

      pageMeta.annotations.texts.push(newText);
      state.selectedTextId = newId;
      renderOverlayElements();
      renderSubToolbar();
      await autoSaveActiveDocument();

      // 追加したテキストボックスにすぐフォーカスしてスマホキーボードを出す
      const selectedContent = /** @type {HTMLElement | null} */ (
        document.querySelector(`.text-box-item[data-id="${newId}"] .text-box-content`)
      );
      if (selectedContent) {
        selectedContent.focus();
      }
      return;
    }

    // 2. スタンプ配置モード
    if (state.currentTool === 'stamp') {
      recordHistoryBeforeChange();
      pageMeta.annotations.stamps.push({
        id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        stampId: state.prefStampId,
        xNorm: clamp(xNorm - 0.02, 0.01, 0.93),
        yNorm: clamp(yNorm - 0.02, 0.01, 0.93),
        size: 28,
      });
      renderOverlayElements();
      await autoSaveActiveDocument();
      return;
    }

    // 3. 消しゴムモード
    if (state.currentTool === 'eraser') {
      const hit = findNearestStroke(pageMeta.annotations.strokes, xNorm, yNorm, 0.035);
      if (hit) {
        recordHistoryBeforeChange();
        pageMeta.annotations.strokes = pageMeta.annotations.strokes.filter((s) => s.id !== hit.id);
        renderStrokesCanvas();
        await autoSaveActiveDocument();
      }
      state.isDrawing = true;
      drawCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // 4. マーカー・ペン描画モード
    if (state.currentTool === 'marker' || state.currentTool === 'pen') {
      state.isDrawing = true;
      state.currentStrokePoints = [{ xNorm, yNorm }];
      drawCanvas.setPointerCapture(e.pointerId);
    }
  });

  drawCanvas.addEventListener('pointermove', async (e) => {
    if (!state.isDrawing || !state.activeDoc) return;
    const rect = drawCanvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const { xNorm, yNorm } = screenToNormalized(relX, relY, rect.width, rect.height);
    const pageMeta = state.activeDoc.pages[state.currentPageIndex];
    if (!pageMeta) return;

    if (state.currentTool === 'eraser') {
      const hit = findNearestStroke(pageMeta.annotations.strokes, xNorm, yNorm, 0.035);
      if (hit) {
        recordHistoryBeforeChange();
        pageMeta.annotations.strokes = pageMeta.annotations.strokes.filter((s) => s.id !== hit.id);
        renderStrokesCanvas();
        await autoSaveActiveDocument();
      }
      return;
    }

    if (state.prefStraightLine && state.currentStrokePoints.length >= 1) {
      // 直線モード：始点と現在点の2点のみを保持（水平に近い場合は自動で水平補正）
      const start = state.currentStrokePoints[0];
      let endY = yNorm;
      if (Math.abs(yNorm - start.yNorm) < 0.018) {
        endY = start.yNorm; // 綺麗な水平アンダーラインに吸着
      }
      state.currentStrokePoints = [start, { xNorm, yNorm: endY }];
    } else {
      state.currentStrokePoints.push({ xNorm, yNorm });
    }
    renderStrokesCanvas();
  });

  drawCanvas.addEventListener('pointerup', async (e) => {
    if (!state.isDrawing || !state.activeDoc) return;
    state.isDrawing = false;
    try {
      drawCanvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (state.currentTool === 'marker' || state.currentTool === 'pen') {
      if (state.currentStrokePoints.length >= 2) {
        const pageMeta = state.activeDoc.pages[state.currentPageIndex];
        if (pageMeta) {
          recordHistoryBeforeChange();
          const isMarker = state.currentTool === 'marker';
          pageMeta.annotations.strokes.push({
            id: `str_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            tool: state.currentTool,
            color: isMarker ? state.prefMarkerColor : state.prefPenColor,
            opacity: isMarker ? state.prefMarkerOpacity : 1.0,
            size: isMarker ? 16 : state.prefPenSize,
            isRedSheetTarget: isMarker ? state.prefMarkerRedSheet : state.prefPenColor === '#ef4444',
            points: [...state.currentStrokePoints],
          });
          await autoSaveActiveDocument();
        }
      }
      state.currentStrokePoints = [];
      renderStrokesCanvas();
    }
  });
}

/**
 * 指定された正規化座標の近くにあるストロークを検索する
 * @param {Array<any>} strokes
 * @param {number} xNorm
 * @param {number} yNorm
 * @param {number} threshold
 * @returns {any | null}
 */
function findNearestStroke(strokes, xNorm, yNorm, threshold) {
  if (!Array.isArray(strokes)) return null;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    const pts = Array.isArray(s.points) ? s.points : [];
    for (const p of pts) {
      const dist = Math.hypot(p.xNorm - xNorm, p.yNorm - yNorm);
      if (dist <= threshold) return s;
    }
    // 直線モード（始点と終点のみ）の場合の線分距離判定
    if (pts.length === 2) {
      const d = distanceToSegment(xNorm, yNorm, pts[0].xNorm, pts[0].yNorm, pts[1].xNorm, pts[1].yNorm);
      if (d <= threshold) return s;
    }
  }
  return null;
}

/**
 * 点 (px, py) と線分 (x1, y1)-(x2, y2) の最短距離を計算する
 */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * ビューア内の指定アンカー座標 (viewX, viewY) を中心にズーム倍率を変更し、スクロール位置を補正する
 * @param {number} targetZoom
 * @param {number} [viewAnchorX]
 * @param {number} [viewAnchorY]
 */
function zoomAroundPoint(targetZoom, viewAnchorX, viewAnchorY) {
  const viewer = document.getElementById('viewer-container');
  const prevZoom = state.zoomScale || 1.0;
  const nextZoom = clamp(Math.round(targetZoom * 100) / 100, 0.6, 3.0);

  if (!viewer) {
    applyZoomScale(nextZoom);
    return;
  }

  const anchorX = typeof viewAnchorX === 'number' ? viewAnchorX : viewer.clientWidth / 2;
  const anchorY = typeof viewAnchorY === 'number' ? viewAnchorY : viewer.clientHeight / 2;

  const docX = (viewer.scrollLeft + anchorX) / prevZoom;
  const docY = (viewer.scrollTop + anchorY) / prevZoom;

  applyZoomScale(nextZoom);

  viewer.scrollLeft = Math.max(0, docX * state.zoomScale - anchorX);
  viewer.scrollTop = Math.max(0, docY * state.zoomScale - anchorY);
}

/**
 * 2本指ピンチによるPDFの拡大・縮小＆パン移動、および1本指でのスクロール移動
 */
function setupPinchZoomAndPan() {
  const viewer = document.getElementById('viewer-container');
  const stage = document.getElementById('page-stage');
  if (!viewer || !stage) return;

  let isTouchPinching = false;
  let pinchInitialDist = 0;
  let pinchInitialZoom = 1.0;
  let pinchDocX = 0;
  let pinchDocY = 0;

  // 1本指パン（移動ツール選択時またはマウスドラッグ）
  let isPanDragging = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  // スマホ2本指タッチによるピンチ拡大縮小＆2本指スクロール移動
  viewer.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length >= 2) {
        if (state.isDrawing) {
          state.isDrawing = false;
          state.currentStrokePoints = [];
          renderStrokesCanvas();
        }
        isPanDragging = false;
        isTouchPinching = true;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchInitialDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        pinchInitialZoom = state.zoomScale || 1.0;

        const rect = viewer.getBoundingClientRect();
        const midViewX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const midViewY = (t1.clientY + t2.clientY) / 2 - rect.top;

        pinchDocX = (viewer.scrollLeft + midViewX) / pinchInitialZoom;
        pinchDocY = (viewer.scrollTop + midViewY) / pinchInitialZoom;
      }
    },
    { passive: true }
  );

  viewer.addEventListener(
    'touchmove',
    (e) => {
      if (isTouchPinching && e.touches.length >= 2) {
        e.preventDefault(); // ブラウザ全体のズームやゴムバンド余白を防止しPDFのみを滑らかに拡大
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const ratio = currDist / Math.max(12, pinchInitialDist);
        const newZoom = clamp(pinchInitialZoom * ratio, 0.6, 3.0);

        const rect = viewer.getBoundingClientRect();
        const currViewX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const currViewY = (t1.clientY + t2.clientY) / 2 - rect.top;

        applyZoomScale(newZoom);
        viewer.scrollLeft = Math.max(0, pinchDocX * state.zoomScale - currViewX);
        viewer.scrollTop = Math.max(0, pinchDocY * state.zoomScale - currViewY);
      }
    },
    { passive: false }
  );

  const endTouchPinch = (e) => {
    if (isTouchPinching && (!e.touches || e.touches.length < 2)) {
      isTouchPinching = false;
    }
  };
  viewer.addEventListener('touchend', endTouchPinch, { passive: true });
  viewer.addEventListener('touchcancel', endTouchPinch, { passive: true });

  // 1本指・マウスでのパン移動（移動ツール選択時）
  viewer.addEventListener(
    'pointerdown',
    (e) => {
      if (isTouchPinching || e.isPrimary === false) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (state.currentTool === 'pan' && !state.redSheetActive) {
        isPanDragging = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartScrollLeft = viewer.scrollLeft;
        panStartScrollTop = viewer.scrollTop;
      }
    },
    { passive: true }
  );

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!isPanDragging || isTouchPinching) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      viewer.scrollLeft = panStartScrollLeft - dx;
      viewer.scrollTop = panStartScrollTop - dy;
    },
    { passive: true }
  );

  const endPointerPan = () => {
    isPanDragging = false;
  };
  window.addEventListener('pointerup', endPointerPan, { passive: true });
  window.addEventListener('pointercancel', endPointerPan, { passive: true });

  // デスクトップSafariトラックパッド・テスト用のgestureイベント対応（タッチピンチ中は二重発火しないようスキップ）
  viewer.addEventListener('gesturestart', () => {
    if (isTouchPinching) return;
    pinchInitialZoom = state.zoomScale;
  });
  viewer.addEventListener('gesturechange', (e) => {
    if (isTouchPinching) return;
    e.preventDefault();
    // @ts-ignore
    const scale = e.scale || 1.0;
    zoomAroundPoint(pinchInitialZoom * scale);
  });
  viewer.addEventListener('gestureend', (e) => {
    if (isTouchPinching) return;
    // @ts-ignore
    const scale = e.scale || 1.0;
    zoomAroundPoint(pinchInitialZoom * scale);
  });
}

/* ============================================================================
 * ツールバー・サブツールバー・Undo/Redo・赤シート・AIプロンプトUI
 * ========================================================================== */

function updateToolButtonsUI() {
  const btns = document.querySelectorAll('.tool-btn[data-tool]');
  btns.forEach((b) => {
    const t = b.getAttribute('data-tool');
    if (t === state.currentTool) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  const drawCanvas = document.getElementById('drawing-canvas');
  if (drawCanvas) {
    if (state.currentTool === 'pan' && !state.redSheetActive) {
      drawCanvas.className = 'drawing-canvas passive';
    } else {
      drawCanvas.className = 'drawing-canvas interactive';
    }
  }
}

function updateRedSheetButtonUI() {
  const btn = document.getElementById('btn-red-sheet');
  if (!btn) return;
  if (state.redSheetActive) {
    btn.classList.add('active');
    btn.textContent = '🈴 赤シートON (タップでめくる)';
  } else {
    btn.classList.remove('active');
    btn.textContent = '🈴 赤シート';
  }
}

function updateUndoRedoButtons() {
  const hist = getCurrentPageHistory();
  const undoBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-undo'));
  const redoBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-redo'));
  if (undoBtn) undoBtn.disabled = !hist.canUndo();
  if (redoBtn) redoBtn.disabled = !hist.canRedo();
}

function updatePageNavUI() {
  if (!state.activeDoc) return;
  const total = state.activeDoc.pages.length;
  const cur = state.currentPageIndex + 1;
  const label = document.getElementById('page-indicator');
  if (label) label.textContent = `${cur} / ${total} ページ`;

  const prevBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-prev-page'));
  const nextBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-next-page'));
  if (prevBtn) prevBtn.disabled = state.currentPageIndex <= 0;
  if (nextBtn) nextBtn.disabled = state.currentPageIndex >= total - 1;
}

/**
 * 選択中のツールに応じたサブツールバー（色・横書き/縦書き・直線モード・スタンプ選択）を描画する
 */
function renderSubToolbar() {
  const bar = document.getElementById('sub-toolbar');
  if (!bar) return;
  bar.textContent = '';

  if (state.redSheetActive) {
    const info = document.createElement('span');
    info.style.color = '#e11d48';
    info.style.fontWeight = '700';
    info.textContent =
      '💡 赤シート暗記モード中：隠れている赤文字・オレンジ文字・暗記マーカーをタップすると答えが表示されます！';
    bar.appendChild(info);
    return;
  }

  const pageMeta = state.activeDoc?.pages[state.currentPageIndex];
  const selectedTextObj = pageMeta?.annotations?.texts?.find((t) => t.id === state.selectedTextId) || null;

  if (state.currentTool === 'text' || selectedTextObj) {
    // 横書き / 縦書き切替スイッチ
    const modeGroup = document.createElement('div');
    modeGroup.className = 'tool-option-group';
    const curMode = selectedTextObj ? selectedTextObj.writingMode : state.prefWritingMode;

    const switchWrap = document.createElement('div');
    switchWrap.className = 'writing-mode-Switch';

    const hBtn = document.createElement('button');
    hBtn.className = `writing-mode-btn ${curMode !== 'vertical' ? 'active' : ''}`;
    hBtn.textContent = '↔ 横書き';
    hBtn.addEventListener('click', async () => {
      state.prefWritingMode = 'horizontal';
      await saveSetting('prefWritingMode', 'horizontal');
      if (selectedTextObj) {
        recordHistoryBeforeChange();
        selectedTextObj.writingMode = 'horizontal';
        renderOverlayElements();
        await autoSaveActiveDocument();
      }
      renderSubToolbar();
    });

    const vBtn = document.createElement('button');
    vBtn.className = `writing-mode-btn ${curMode === 'vertical' ? 'active' : ''}`;
    vBtn.textContent = '↕ 縦書き';
    vBtn.addEventListener('click', async () => {
      state.prefWritingMode = 'vertical';
      await saveSetting('prefWritingMode', 'vertical');
      if (selectedTextObj) {
        recordHistoryBeforeChange();
        selectedTextObj.writingMode = 'vertical';
        renderOverlayElements();
        await autoSaveActiveDocument();
      }
      renderSubToolbar();
    });

    switchWrap.append(hBtn, vBtn);
    modeGroup.appendChild(switchWrap);
    bar.appendChild(modeGroup);

    // 文字色パレット
    const colorGroup = document.createElement('div');
    colorGroup.className = 'tool-option-group';
    const curColor = selectedTextObj ? selectedTextObj.color : state.prefTextColor;

    for (const c of TEXT_COLORS) {
      const sw = document.createElement('button');
      sw.className = `color-swatch ${curColor === c.hex ? 'active' : ''} ${
        c.isRedSheetTarget ? 'red-sheet-dot' : ''
      }`;
      sw.style.backgroundColor = c.hex;
      sw.title = c.label;
      sw.addEventListener('click', async () => {
        state.prefTextColor = c.hex;
        await saveSetting('prefTextColor', c.hex);
        if (selectedTextObj) {
          recordHistoryBeforeChange();
          selectedTextObj.color = c.hex;
          selectedTextObj.isMemorizeTarget = c.isRedSheetTarget;
          renderOverlayElements();
          await autoSaveActiveDocument();
        }
        renderSubToolbar();
      });
      colorGroup.appendChild(sw);
    }
    bar.appendChild(colorGroup);

    // 文字サイズ変更
    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'tool-option-group';
    const curSize = selectedTextObj ? selectedTextObj.fontSize : state.prefFontSize;

    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = `サイズ:${curSize}pt`;
    sizeLabel.style.fontWeight = '600';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'btn';
    minusBtn.style.padding = '3px 8px';
    minusBtn.textContent = '－';
    minusBtn.addEventListener('click', async () => {
      const next = clamp(curSize - 2, 10, 42);
      state.prefFontSize = next;
      await saveSetting('prefFontSize', next);
      if (selectedTextObj) {
        recordHistoryBeforeChange();
        selectedTextObj.fontSize = next;
        renderOverlayElements();
        await autoSaveActiveDocument();
      }
      renderSubToolbar();
    });

    const plusBtn = document.createElement('button');
    plusBtn.className = 'btn';
    plusBtn.style.padding = '3px 8px';
    plusBtn.textContent = '＋';
    plusBtn.addEventListener('click', async () => {
      const next = clamp(curSize + 2, 10, 42);
      state.prefFontSize = next;
      await saveSetting('prefFontSize', next);
      if (selectedTextObj) {
        recordHistoryBeforeChange();
        selectedTextObj.fontSize = next;
        renderOverlayElements();
        await autoSaveActiveDocument();
      }
      renderSubToolbar();
    });

    sizeGroup.append(minusBtn, sizeLabel, plusBtn);
    bar.appendChild(sizeGroup);
    return;
  }

  if (state.currentTool === 'marker') {
    const colorGroup = document.createElement('div');
    colorGroup.className = 'tool-option-group';
    for (const m of MARKER_COLORS) {
      const sw = document.createElement('button');
      sw.className = `color-swatch ${state.prefMarkerColor === m.hex ? 'active' : ''} ${
        m.isRedSheetTarget ? 'red-sheet-dot' : ''
      }`;
      sw.style.backgroundColor = m.hex;
      sw.title = m.label;
      sw.addEventListener('click', async () => {
        state.prefMarkerColor = m.hex;
        state.prefMarkerOpacity = m.opacity;
        state.prefMarkerRedSheet = m.isRedSheetTarget;
        await saveSetting('prefMarkerColor', m.hex);
        await saveSetting('prefMarkerOpacity', m.opacity);
        await saveSetting('prefMarkerRedSheet', m.isRedSheetTarget);
        renderSubToolbar();
      });
      colorGroup.appendChild(sw);
    }
    bar.appendChild(colorGroup);

    bar.appendChild(createStraightLineToggleButton());
    return;
  }

  if (state.currentTool === 'pen') {
    const colorGroup = document.createElement('div');
    colorGroup.className = 'tool-option-group';
    for (const p of PEN_COLORS) {
      const sw = document.createElement('button');
      sw.className = `color-swatch ${state.prefPenColor === p.hex ? 'active' : ''} ${
        p.isRedSheetTarget ? 'red-sheet-dot' : ''
      }`;
      sw.style.backgroundColor = p.hex;
      sw.title = p.label;
      sw.addEventListener('click', async () => {
        state.prefPenColor = p.hex;
        await saveSetting('prefPenColor', p.hex);
        renderSubToolbar();
      });
      colorGroup.appendChild(sw);
    }
    bar.appendChild(colorGroup);
    bar.appendChild(createStraightLineToggleButton());
    return;
  }

  if (state.currentTool === 'stamp') {
    const stampGroup = document.createElement('div');
    stampGroup.className = 'tool-option-group';
    for (const st of STAMP_TYPES) {
      const btn = document.createElement('button');
      btn.className = `btn ${state.prefStampId === st.id ? 'btn-primary' : ''}`;
      btn.style.padding = '4px 10px';
      btn.textContent = st.label;
      btn.addEventListener('click', async () => {
        state.prefStampId = st.id;
        await saveSetting('prefStampId', st.id);
        renderSubToolbar();
      });
      stampGroup.appendChild(btn);
    }
    bar.appendChild(stampGroup);
    return;
  }

  if (state.currentTool === 'eraser') {
    const info = document.createElement('span');
    info.textContent = '🧹 消したいマーカー・線・文字・スタンプをタップまたはなぞって消去できます';
    bar.appendChild(info);
    return;
  }

  if (state.currentTool === 'pan') {
    const info = document.createElement('span');
    info.textContent = '👆 1本指でスクロール移動・ピンチ操作や右下の＋/－で拡大縮小できます';
    bar.appendChild(info);
  }
}

function createStraightLineToggleButton() {
  const btn = document.createElement('button');
  btn.className = `btn ${state.prefStraightLine ? 'btn-primary' : ''}`;
  btn.style.padding = '4px 10px';
  btn.textContent = state.prefStraightLine ? '📏 直線モード: ON' : '📏 直線モード: OFF';
  btn.addEventListener('click', async () => {
    state.prefStraightLine = !state.prefStraightLine;
    await saveSetting('prefStraightLine', state.prefStraightLine);
    renderSubToolbar();
  });
  return btn;
}

/* ============================================================================
 * 白紙ノートページ挿入・教科追加・AI勉強モーダル・PDF書き出し
 * ========================================================================== */

/**
 * 現在のページの直後に白紙ノートページを挿入する
 * @param {'ruled' | 'vertical-ruled' | 'grid' | 'plain'} template
 */
async function insertBlankPageAfterCurrent(template) {
  if (!state.activeDoc) return;
  const curPage = state.activeDoc.pages[state.currentPageIndex];
  const newPage = {
    id: `page_blank_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'blank',
    sourcePdfPageIndex: null,
    template,
    width: curPage?.width || 595.28,
    height: curPage?.height || 841.89,
    extractedText: '',
    annotations: {
      texts: [],
      strokes: [],
      stamps: [],
    },
  };

  state.activeDoc.pages.splice(state.currentPageIndex + 1, 0, newPage);
  state.currentPageIndex += 1;
  state.selectedTextId = null;

  document.getElementById('blank-page-modal')?.classList.add('hidden');
  await autoSaveActiveDocument();
  await renderCurrentPage();
  showToast('白紙ノートページを挿入しました！');
}

/**
 * 教科追加モーダル
 */
async function openAddSubjectModal() {
  const name = prompt('追加したい教科名を入力してください（例：古典、化学、日本史、情報）:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const isVerticalSubject = /国語|古典|古文|漢文|現代文/.test(trimmed);

  const colors = ['#e11d48', '#2563eb', '#059669', '#7c3aed', '#d97706', '#0891b2', '#db2777'];
  const randomColor = colors[state.subjects.length % colors.length];

  const newSubj = {
    id: `subj_${Date.now()}`,
    name: trimmed,
    shortName: trimmed.slice(0, 6),
    color: randomColor,
    icon: isVerticalSubject ? '📖' : '📒',
    defaultWritingMode: isVerticalSubject ? 'vertical' : 'horizontal',
    defaultBlankTemplate: isVerticalSubject ? 'vertical-ruled' : 'ruled',
  };

  await saveSubject(newSubj);
  state.selectedSubjectId = newSubj.id;
  await refreshHomeData();
  showToast(`教科「${trimmed}」を追加しました！`);
}

/**
 * AIテスト対策プロンプト生成モーダルを開く
 * @param {'quiz' | 'explain' | 'summary'} mode
 */
function updateAiPromptModalContent(mode) {
  if (!state.activeDoc) return;
  const subj = state.subjects.find((s) => s.id === state.activeDoc.subjectId);
  const promptText = generateAiStudyPrompt(state.activeDoc, mode, subj?.name || '');
  const textarea = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('ai-prompt-textarea'));
  if (textarea) {
    textarea.value = promptText;
  }

  document.querySelectorAll('[data-ai-mode]').forEach((btn) => {
    if (btn.getAttribute('data-ai-mode') === mode) {
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
    }
  });
}

/**
 * 書き込み済みPDFを出力してダウンロードする
 */
async function handleExportPdf() {
  if (!state.activeDoc) return;
  try {
    showToast('日本語フォントと書き込みを統合してPDFを生成中...');
    const outBytes = await exportAnnotatedPdf(state.activeDoc);
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.activeDoc.title || '授業プリント'}_書き込み済.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('書き込み済みPDFを保存しました！');
  } catch (err) {
    console.error(err);
    alert(`PDF出力中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ============================================================================
 * イベントバインディング＆アプリ初期化
 * ========================================================================== */

export async function initApp() {
  await initDB();
  await loadUserPreferences();
  await refreshHomeData();
  setupCanvasInteractions();
  setupPinchZoomAndPan();

  // ホーム画面：PDFファイル選択
  const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('pdf-file-input'));
  document.getElementById('btn-upload-pdf')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) {
      await handlePdfFileUpload(file);
      fileInput.value = '';
    }
  });

  // ホーム画面：白紙ノート作成＆サンプル作成
  document.getElementById('btn-new-notebook')?.addEventListener('click', handleCreateBlankNotebook);
  document.getElementById('btn-create-sample')?.addEventListener('click', handleCreateSampleDocument);

  // ホーム画面：横断検索バー
  const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('search-input'));
  const searchClear = document.getElementById('search-clear-btn');
  searchInput?.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    renderHomeContent();
  });
  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    state.searchQuery = '';
    renderHomeContent();
  });

  // ホーム画面：モード切替タブ（プリント一覧 / ★重要まとめ / ？不明まとめ）
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = /** @type {'documents' | 'star' | 'question'} */ (tab.getAttribute('data-view-mode') || 'documents');
      state.homeViewMode = mode;
      renderHomeViewTabs();
      renderHomeContent();
    });
  });

  // エディタ画面：戻るボタン
  document.getElementById('btn-back-home')?.addEventListener('click', async () => {
    await autoSaveActiveDocument();
    state.activeDoc = null;
    state.activePdfJsDoc = null;
    document.getElementById('editor-screen')?.classList.add('hidden');
    document.getElementById('home-screen')?.classList.remove('hidden');
    await refreshHomeData();
  });

  // エディタ画面：タイトル変更
  const titleInput = /** @type {HTMLInputElement | null} */ (document.getElementById('doc-title-input'));
  titleInput?.addEventListener('change', async () => {
    if (state.activeDoc && titleInput.value.trim()) {
      state.activeDoc.title = titleInput.value.trim();
      await autoSaveActiveDocument();
    }
  });

  // エディタ画面：デジタル赤シート切替
  document.getElementById('btn-red-sheet')?.addEventListener('click', () => {
    state.redSheetActive = !state.redSheetActive;
    state.selectedTextId = null;
    // 赤シートON時に前回めくった状態をリセットしてすぐ暗記テストできるようにする
    if (state.redSheetActive && state.activeDoc) {
      const pageMeta = state.activeDoc.pages[state.currentPageIndex];
      pageMeta?.annotations?.texts?.forEach((t) => (t.revealedInRedSheet = false));
      pageMeta?.annotations?.strokes?.forEach((s) => (s.revealedInRedSheet = false));
    }
    updateRedSheetButtonUI();
    updateToolButtonsUI();
    renderSubToolbar();
    renderStrokesCanvas();
    renderOverlayElements();
  });

  // エディタ画面：AI勉強モーダル開閉
  document.getElementById('btn-open-ai')?.addEventListener('click', () => {
    updateAiPromptModalContent('quiz');
    document.getElementById('ai-study-modal')?.classList.remove('hidden');
  });
  document.getElementById('btn-close-ai-modal')?.addEventListener('click', () => {
    document.getElementById('ai-study-modal')?.classList.add('hidden');
  });
  document.querySelectorAll('[data-ai-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = /** @type {'quiz' | 'explain' | 'summary'} */ (btn.getAttribute('data-ai-mode') || 'quiz');
      updateAiPromptModalContent(mode);
    });
  });
  document.getElementById('btn-copy-ai-prompt')?.addEventListener('click', async () => {
    const textarea = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('ai-prompt-textarea'));
    if (!textarea) return;
    try {
      await navigator.clipboard.writeText(textarea.value);
      showToast('📋 AI指示文をコピーしました！ChatGPTやGeminiに貼り付けてください');
    } catch {
      textarea.select();
      document.execCommand('copy');
      showToast('📋 AI指示文をコピーしました！');
    }
  });

  // エディタ画面：PDF保存
  document.getElementById('btn-export-pdf')?.addEventListener('click', handleExportPdf);

  // エディタ画面：メインツール切替
  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = /** @type {any} */ (btn.getAttribute('data-tool') || 'text');
      state.currentTool = tool;
      state.selectedTextId = null;
      cleanupEmptyTextBoxes(null);
      if (state.redSheetActive) {
        state.redSheetActive = false;
        updateRedSheetButtonUI();
      }
      updateToolButtonsUI();
      renderSubToolbar();
      renderOverlayElements();
      autoSaveActiveDocument();
    });
  });

  // Undo / Redo
  document.getElementById('btn-undo')?.addEventListener('click', async () => {
    if (!state.activeDoc) return;
    const page = state.activeDoc.pages[state.currentPageIndex];
    const prev = getCurrentPageHistory().undo(page.annotations);
    if (prev) {
      page.annotations = prev;
      state.selectedTextId = null;
      renderStrokesCanvas();
      renderOverlayElements();
      updateUndoRedoButtons();
      await autoSaveActiveDocument();
    }
  });

  document.getElementById('btn-redo')?.addEventListener('click', async () => {
    if (!state.activeDoc) return;
    const page = state.activeDoc.pages[state.currentPageIndex];
    const next = getCurrentPageHistory().redo(page.annotations);
    if (next) {
      page.annotations = next;
      state.selectedTextId = null;
      renderStrokesCanvas();
      renderOverlayElements();
      updateUndoRedoButtons();
      await autoSaveActiveDocument();
    }
  });

  // ページ移動
  document.getElementById('btn-prev-page')?.addEventListener('click', async () => {
    if (!state.activeDoc || state.currentPageIndex <= 0) return;
    cleanupEmptyTextBoxes(null);
    state.currentPageIndex -= 1;
    state.selectedTextId = null;
    await renderCurrentPage();
  });
  document.getElementById('btn-next-page')?.addEventListener('click', async () => {
    if (!state.activeDoc || state.currentPageIndex >= state.activeDoc.pages.length - 1) return;
    cleanupEmptyTextBoxes(null);
    state.currentPageIndex += 1;
    state.selectedTextId = null;
    await renderCurrentPage();
  });

  // 拡大・縮小・100%リセット（再レンダリングによる余白増加や白紙化を起こさず即座に中心基準ズーム）
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    zoomAroundPoint(state.zoomScale + 0.25);
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    zoomAroundPoint(state.zoomScale - 0.25);
  });
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    zoomAroundPoint(1.0);
    const viewer = document.getElementById('viewer-container');
    if (viewer) {
      viewer.scrollLeft = 0;
    }
  });

  // 白紙ページ挿入モーダル
  document.getElementById('btn-open-blank-modal')?.addEventListener('click', () => {
    document.getElementById('blank-page-modal')?.classList.remove('hidden');
  });
  document.getElementById('btn-close-blank-modal')?.addEventListener('click', () => {
    document.getElementById('blank-page-modal')?.classList.add('hidden');
  });
  document.querySelectorAll('[data-blank-template]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tpl = /** @type {any} */ (btn.getAttribute('data-blank-template') || 'ruled');
      await insertBlankPageAfterCurrent(tpl);
    });
  });
}

// ブラウザ起動時に自動初期化
if (typeof window !== 'undefined' && document.getElementById('home-screen')) {
  window.addEventListener('DOMContentLoaded', () => {
    initApp()
      .then(async () => {
        if (new URLSearchParams(window.location.search).get('e2e') === '1') {
          const mod = await import('../tests/e2e_driver.js');
          await mod.runUiE2E();
        }
      })
      .catch((err) => console.error('App init failed:', err));
  });
}
