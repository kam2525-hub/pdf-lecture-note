// @ts-check
/**
 * index.html?e2e=1 起動時に実画面のDOM操作を一通り自動検証するE2Eドライバ
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runUiE2E() {
  const results = [];
  function assert(cond, name) {
    if (!cond) {
      results.push({ name, passed: false });
      throw new Error(`UI E2E FAIL: ${name}`);
    }
    results.push({ name, passed: true });
  }

  try {
    await sleep(300);

    // 1. ホーム画面の初期表示確認
    const subjectPills = document.querySelectorAll('.subject-pill');
    assert(subjectPills.length >= 6, 'Home screen renders default subject pills');

    // 2. 「✨ サンプルで試す」ボタンをクリックしてサンプルプリントを生成・オープン
    const sampleBtn = /** @type {HTMLElement | null} */ (document.getElementById('btn-create-sample'));
    assert(Boolean(sampleBtn), 'Sample button exists');
    sampleBtn?.click();

    // PDF生成・描画完了まで待機
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      const editorScreen = document.getElementById('editor-screen');
      const boxes = document.querySelectorAll('.text-box-item');
      if (editorScreen && !editorScreen.classList.contains('hidden') && boxes.length > 0) break;
    }

    const editorScreen = document.getElementById('editor-screen');
    assert(Boolean(editorScreen && !editorScreen.classList.contains('hidden')), 'Editor screen opened after sample creation');

    // 3. 縦書きテキストボックスと横書きテキストボックスの描画確認
    const textBoxes = document.querySelectorAll('.text-box-item');
    assert(textBoxes.length === 4, 'Sample page 1 renders 4 initial text boxes');
    const verticalBoxes = document.querySelectorAll('.text-box-item.vertical');
    assert(verticalBoxes.length === 1, 'Sample page 1 has 1 vertical text box');

    // 3-1. 非選択時の背景透明化＆ハンドル非表示と、選択時のハンドル表示・文字入力の検証
    const handles = document.querySelectorAll('.text-box-handle');
    assert(handles.length === 4, 'All text boxes have dedicated drag handles in DOM');

    const firstBox = /** @type {HTMLElement} */ (textBoxes[0]);
    const firstHandle = /** @type {HTMLElement} */ (firstBox.querySelector('.text-box-handle'));
    const unselectedBg = window.getComputedStyle(firstBox).backgroundColor;
    const unselectedHandleDisplay = window.getComputedStyle(firstHandle).display;
    assert(
      unselectedBg === 'rgba(0, 0, 0, 0)' || unselectedBg === 'transparent',
      'Unselected text box has transparent background so PDF text underneath is clearly visible'
    );
    assert(
      unselectedHandleDisplay === 'none',
      'Unselected text box hides move handle bar so PDF text underneath is not covered'
    );

    const firstContent = /** @type {HTMLElement} */ (firstBox.querySelector('.text-box-content'));
    assert(Boolean(firstContent), 'First box has content editable area');
    firstContent.focus();
    await sleep(30);
    assert(firstBox.classList.contains('selected'), 'Focusing text box marks it as selected');
    assert(
      window.getComputedStyle(firstHandle).display !== 'none',
      'Selected text box displays floating move handle bar'
    );
    assert(
      Math.abs(firstHandle.getBoundingClientRect().width - firstBox.getBoundingClientRect().width) <= 4,
      'Move handle bar tightly fits the text box width rather than being oversized'
    );

    firstContent.innerText = '更新後のメモ入力テスト';
    firstContent.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    assert(firstContent.innerText === '更新後のメモ入力テスト', 'Text input successfully updates box content');

    // 3-2. 文字サイズ変更ボタン（A- / A+）の検証
    const initialFontSize = parseFloat(firstContent.style.fontSize);
    const fontPlusBtn = /** @type {HTMLElement | null} */ (firstBox.querySelector('[data-action="font-plus"]'));
    assert(Boolean(fontPlusBtn), 'Font plus (A+) button exists on text box controls');
    fontPlusBtn?.click();
    await sleep(50);
    let currentBox = /** @type {HTMLElement} */ (document.querySelectorAll('.text-box-item')[0]);
    let currentContent = /** @type {HTMLElement} */ (currentBox.querySelector('.text-box-content'));
    const increasedFontSize = parseFloat(currentContent.style.fontSize);
    assert(increasedFontSize > initialFontSize, 'Clicking A+ button increases text font size on screen');

    const fontMinusBtn = /** @type {HTMLElement | null} */ (currentBox.querySelector('[data-action="font-minus"]'));
    assert(Boolean(fontMinusBtn), 'Font minus (A-) button exists on text box controls');
    fontMinusBtn?.click();
    await sleep(50);
    currentBox = /** @type {HTMLElement} */ (document.querySelectorAll('.text-box-item')[0]);
    currentContent = /** @type {HTMLElement} */ (currentBox.querySelector('.text-box-content'));
    const decreasedFontSize = parseFloat(currentContent.style.fontSize);
    assert(decreasedFontSize < increasedFontSize, 'Clicking A- button decreases text font size on screen');

    // 3-3. 微調整矢印ボタンでの移動検証
    const initialLeft = parseFloat(currentBox.style.left);
    const nudgeRightBtn = /** @type {HTMLElement | null} */ (currentBox.querySelector('[data-action="nudge-right"]'));
    assert(Boolean(nudgeRightBtn), 'Nudge right button exists');
    nudgeRightBtn?.click();
    await sleep(50);
    const nudgedLeft = parseFloat(currentBox.style.left);
    assert(nudgedLeft > initialLeft, 'Nudge right button moves text box to the right');

    // 3-3. 2本指ピンチズームジェスチャー＆余白・スクロール領域同期の検証
    const viewer = document.getElementById('viewer-container');
    const sizer = document.getElementById('stage-scroll-sizer');
    const stage = document.getElementById('page-stage');
    const baseSizerWidth = sizer ? parseFloat(sizer.style.width) : 0;
    assert(baseSizerWidth > 100, 'Stage scroll sizer has valid base width');

    const gestureEv = new CustomEvent('gestureend');
    // @ts-ignore
    gestureEv.scale = 1.5;
    viewer?.dispatchEvent(new CustomEvent('gesturestart'));
    viewer?.dispatchEvent(gestureEv);
    await sleep(100);
    const zoomedSizerWidth = sizer ? parseFloat(sizer.style.width) : 0;
    assert(
      Math.abs(zoomedSizerWidth - Math.round(baseSizerWidth * 1.5)) <= 2,
      'Pinch zoom scales stage-scroll-sizer width proportionally without blank margin growth'
    );
    assert(
      Boolean(stage && stage.style.transform.includes('scale(1.5)')),
      'Pinch zoom applies scale(1.5) transform with origin 0 0 to page-stage'
    );

    // 100%リセットボタンの検証
    const zoomResetBtn = document.getElementById('btn-zoom-reset');
    assert(Boolean(zoomResetBtn && zoomResetBtn.textContent === '150%'), 'Zoom reset button displays 150%');
    zoomResetBtn?.click();
    await sleep(50);
    assert(Boolean(zoomResetBtn && zoomResetBtn.textContent === '100%'), 'Zoom reset button restores 100% scale');

    // 4. デジタル赤シートモードのON/OFFとタップめくり確認
    const redSheetBtn = /** @type {HTMLElement | null} */ (document.getElementById('btn-red-sheet'));
    redSheetBtn?.click();
    await sleep(100);
    const maskedBoxes = document.querySelectorAll('.text-box-item.red-sheet-masked');
    assert(maskedBoxes.length === 3, 'Red sheet mode masks 3 red/orange text boxes on page 1');

    // 再度クリックして赤シートOFFに戻す
    redSheetBtn?.click();
    await sleep(100);
    assert(document.querySelectorAll('.text-box-item.red-sheet-masked').length === 0, 'Red sheet mode OFF unmasks boxes');

    // 5. AI勉強プロンプト生成モーダルの確認
    const aiBtn = /** @type {HTMLElement | null} */ (document.getElementById('btn-open-ai'));
    aiBtn?.click();
    await sleep(100);
    const promptArea = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('ai-prompt-textarea'));
    assert(Boolean(promptArea && promptArea.value.includes('徒然草')), 'AI prompt modal generates study prompt with handout content');
    document.getElementById('btn-close-ai-modal')?.click();

    // 6. 白紙ノートページ挿入の確認
    document.getElementById('btn-open-blank-modal')?.click();
    await sleep(50);
    const gridBtn = /** @type {HTMLElement | null} */ (document.querySelector('[data-blank-template="grid"]'));
    gridBtn?.click();
    await sleep(300);
    const pageIndicator = document.getElementById('page-indicator');
    assert(Boolean(pageIndicator && pageIndicator.textContent?.includes('/ 3 ページ')), 'Blank page inserted (total 3 pages)');

    // 6-2. PDF保存ボタンをクリックして保存・エクスポートモーダルの表示とテキスト同期の検証
    const exportBtn = /** @type {HTMLElement | null} */ (document.getElementById('btn-export-pdf'));
    assert(Boolean(exportBtn), 'PDF export button exists');
    exportBtn?.click();
    for (let w = 0; w < 40; w++) {
      await sleep(150);
      const m = document.getElementById('pdf-export-modal');
      if (m && !m.classList.contains('hidden')) break;
    }
    const exportModal = document.getElementById('pdf-export-modal');
    assert(Boolean(exportModal && !exportModal.classList.contains('hidden')), 'PDF export complete modal opens with options');
    document.getElementById('btn-close-export-modal')?.click();
    await sleep(100);

    // 7. ホーム画面へ戻り、「★重要まとめ」「？不明まとめ」「横断検索」を確認
    document.getElementById('btn-back-home')?.click();
    await sleep(300);

    const starTab = /** @type {HTMLElement | null} */ (document.querySelector('.view-tab[data-view-mode="star"]'));
    starTab?.click();
    await sleep(100);
    assert(Boolean(document.getElementById('home-content')?.textContent?.includes('1ページ')), 'Star summary tab lists stamped page 1');

    const qTab = /** @type {HTMLElement | null} */ (document.querySelector('.view-tab[data-view-mode="question"]'));
    qTab?.click();
    await sleep(100);
    assert(Boolean(document.getElementById('home-content')?.textContent?.includes('ページ')), 'Question summary tab lists stamped page');

    // 横断検索
    const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('search-input'));
    if (searchInput) {
      searchInput.value = '兼好法師';
      searchInput.dispatchEvent(new Event('input'));
    }
    await sleep(100);
    assert(Boolean(document.getElementById('home-content')?.textContent?.includes('検索結果')), 'Cross-document search displays matching results');

    await fetch('/__test_result__', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ALL_PASSED', total: results.length, results }),
    });
  } catch (err) {
    await fetch('/__test_result__', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
        results,
      }),
    });
  }
}
