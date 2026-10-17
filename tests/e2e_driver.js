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
