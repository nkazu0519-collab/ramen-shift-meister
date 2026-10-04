// マイスター一括管理「取得状況」一覧の内部スクロール（2026-09-24）を、本番のapp/view_meister_bulk.html・
// app/css.htmlを直接読み込んで検証する。
//
// 背景：従業員が増えるとページ全体が長くなりすぎる問題があったため、取得状況の表だけを
// 縦スクロール可能にした。PC標準表示では見出し＋従業員10人分を目安の高さにする。
// 全員を描画し10件への切り捨て・ページ分割はしない（表示だけをスクロールで絞る）。
// 共通.table-scroll（判定詳細モーダル等でも使う横スクロール用クラス）自体には高さ制限を
// 加えず、この一覧専用の修飾クラスtable-scroll--meister-bulkにだけ適用する。
//
// 縦スクロール中は列見出し（氏名・マイスター名）を上に固定する。氏名列の見出しは
// 既存の横方向sticky（left:0）と今回追加した縦方向sticky（top:0）を両方持つため、
// 重なり順・背景を確認する。
//
// このテストでは、view_meister_bulk.html・css.htmlの静的なHTML/CSS構造を確認する。
// CSSはshift_modal_scroll_structure_test.js等と同じ簡易パーサ（parseCssRules_）で
// ブロック単位にパースし、宣言の有無を機械的に検証する。実際のブラウザでの表の高さ・
// スクロール挙動・見出し固定の描画結果はこのテストの対象外（本人の実機確認が必要）。
//
// 実行: node meister_bulk_scroll_structure_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var bulk = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
var css = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')

var pass = 0
var fail = 0
function assertTrue(value, label) {
  var ok = !!value
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

/**
 *  <style>〜</style>の中身を、メディアクエリの内外を区別しながら「トップレベルのルール」と
 *  「メディアクエリ内のルール」に簡易パースする（他のテストファイルと同じ自己完結の実装）
 */
function parseCssRules_(cssText) {
  var body = cssText.replace(/^[\s\S]*?<style>/, '').replace(/<\/style>[\s\S]*$/, '')
  body = body.replace(/\/\*[\s\S]*?\*\//g, '')

  var rules = []
  var i = 0
  var mediaStack = []

  while (i < body.length) {
    var openIdx = body.indexOf('{', i)
    var closeIdx = body.indexOf('}', i)
    if (openIdx === -1 && closeIdx === -1) break

    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      if (mediaStack.length > 0) mediaStack.pop()
      i = closeIdx + 1
      continue
    }

    var head = body.slice(i, openIdx).trim()
    if (head.indexOf('@media') === 0) {
      mediaStack.push(head)
      i = openIdx + 1
      continue
    }

    var declClose = body.indexOf('}', openIdx)
    var declarationsText = body.slice(openIdx + 1, declClose)
    rules.push({
      selector: head,
      declarationsText: declarationsText,
      mediaCondition: mediaStack.length > 0 ? mediaStack[mediaStack.length - 1] : null
    })
    i = declClose + 1
  }

  return rules
}

var cssRules = parseCssRules_(css)
assertTrue(cssRules.length > 50, 'CSSルールを簡易パースできた（' + cssRules.length + '件のルールを検出）')

function declares_(declarationsText, propertyNamePattern) {
  return new RegExp('(^|;)\\s*' + propertyNamePattern + '\\s*:').test(declarationsText)
}

console.log('---')
console.log('検証対象1: view_meister_bulk.htmlのHTML構造（専用ラッパークラス・キーボード操作）')
console.log('---')

// ------------------------------------------------------------------
// HTML構造：table-scroll--meister-bulk（専用修飾クラス）
// ------------------------------------------------------------------
{
  var tableScrollMatch = bulk.match(/<div class="table-scroll[^"]*"[^>]*>[\s\S]*?<table class="meister-bulk-table">/)
  assertTrue(!!tableScrollMatch, '取得状況テーブルのラッパー（table-scroll）からtableタグまでを抽出できた')
  var wrapperOpenTag = tableScrollMatch ? tableScrollMatch[0].match(/<div class="table-scroll[^"]*"[^>]*>/)[0] : ''
  assertTrue(/class="table-scroll table-scroll--meister-bulk"/.test(wrapperOpenTag), '取得状況テーブルのラッパーは共通table-scrollに専用クラスtable-scroll--meister-bulkを重ねている')
  assertTrue(/tabindex="0"/.test(wrapperOpenTag), '取得状況テーブルのラッパーはtabindex="0"を持つ（Tabキーでフォーカスし、矢印キー等でスクロールできる）')
}

// ------------------------------------------------------------------
// HTML構造：全員を描画し、10件への切り捨て・ページ分割をする仕組みがないこと
// ------------------------------------------------------------------
{
  assertTrue(/for\s*\(\s*var\s+i\s*=\s*0\s*;\s*i\s*<\s*currentRows\.length/.test(bulk), 'renderTable_はcurrentRows.length全件をループしている（固定10件等への切り詰めがない）')
  assertTrue(bulk.indexOf('.slice(0, 10)') === -1, 'currentRowsを先頭10件に切り詰めるslice(0, 10)がない')
  assertTrue(!/page/i.test(bulk.match(/function renderTable_[\s\S]*?\n      \}/)[0]), 'renderTable_内にページ分割（page関連の語）を示す実装がない')
}

console.log('---')
console.log('検証対象2: 再読み込み・状態説明・変更件数・保存ボタンがスクロール領域の外にあること')
console.log('---')

// ------------------------------------------------------------------
// HTML構造：再読み込みボタン・状態メッセージは表のスクロール領域より前、
// 変更件数・保存ボタン（form-actions）は表のスクロール領域より後に出現する
// （=table-scroll--meister-bulkの外側にある）
// ------------------------------------------------------------------
{
  var cardStart = bulk.indexOf('<h3>取得状況</h3>')
  var reloadBtnIdx = bulk.indexOf('onclick="handleReloadClick()"', cardStart)
  var statusIdx = bulk.indexOf('id="meister_bulk_status"', cardStart)
  var tableScrollOpenIdx = bulk.indexOf('class="table-scroll table-scroll--meister-bulk"', cardStart)
  var tableScrollCloseIdx = bulk.indexOf('</div>', bulk.indexOf('</table>', tableScrollOpenIdx))
  var changeCountIdx = bulk.indexOf('id="meister_bulk_change_count"', cardStart)
  var saveBtnIdx = bulk.indexOf('id="meister_bulk_save_btn"', cardStart)

  assertTrue(reloadBtnIdx !== -1 && reloadBtnIdx < tableScrollOpenIdx, '再読み込みボタンは表のスクロール領域より前にある')
  assertTrue(statusIdx !== -1 && statusIdx < tableScrollOpenIdx, '状態説明（meister_bulk_status）は表のスクロール領域より前にある')
  assertTrue(changeCountIdx !== -1 && tableScrollCloseIdx !== -1 && changeCountIdx > tableScrollCloseIdx, '変更件数（meister_bulk_change_count）は表のスクロール領域が閉じた後にある（領域外）')
  assertTrue(saveBtnIdx !== -1 && tableScrollCloseIdx !== -1 && saveBtnIdx > tableScrollCloseIdx, '変更を保存ボタン（meister_bulk_save_btn）は表のスクロール領域が閉じた後にある（領域外）')
}

console.log('---')
console.log('検証対象3: 育成優先度カード・育成候補モーダルを変更していないこと')
console.log('---')

{
  assertTrue(/id="meister_skill_priority"/.test(bulk), '育成優先度カード（meister_skill_priority）は引き続き存在する')
  assertTrue(/id="training_modal"/.test(bulk), '育成候補モーダル（training_modal）は引き続き存在する')
  assertTrue(/id="meister_skill_priority_list"/.test(bulk), '育成優先度カードのリスト（meister_skill_priority_list）は引き続き存在する')
  // 育成優先度カードは取得状況カードより前のセクションであり、table-scroll--meister-bulkの外側にある
  var priorityCardIdx = bulk.indexOf('id="meister_skill_priority"')
  var tableScrollIdx2 = bulk.indexOf('class="table-scroll table-scroll--meister-bulk"')
  assertTrue(priorityCardIdx !== -1 && tableScrollIdx2 !== -1 && priorityCardIdx < tableScrollIdx2, '育成優先度カードは取得状況テーブルのスクロール領域より前の別セクションにある（スコープを侵していない）')
}

console.log('---')
console.log('検証対象4: 従業員順・チェック変更・未保存差分・保存処理・離脱確認のロジックを変更していないこと')
console.log('---')

{
  assertTrue(/function handleCheckboxChange_/.test(bulk), 'handleCheckboxChange_（チェック変更時の差分再計算）は引き続き存在する')
  assertTrue(/function recomputeChangeForEmployee_/.test(bulk), 'recomputeChangeForEmployee_（未保存差分の判定）は引き続き存在する')
  assertTrue(/function handleSaveClick/.test(bulk), 'handleSaveClick（保存処理）は引き続き存在する')
  assertTrue(/beforeunload/.test(bulk), '離脱確認（beforeunload）は引き続き存在する')
  assertTrue(/currentRows\[i\]/.test(bulk), 'buildRowElement_はcurrentRowsの順序どおりに行を作る（サーバーから受け取った従業員順を維持する）')
}

console.log('---')
console.log('検証対象5: css.htmlのCSS構造（高さ制限・縦スクロール・見出し固定・フォーカス）')
console.log('---')

/**
 *  カンマ区切りの複数セレクタをまとめて定義したルール（例：".a, .b { ... }"）も対象に含めて検索する
 */
function findRulesContainingSelector_(rules, selectorExact) {
  return rules.filter(function (r) {
    var parts = r.selector.split(',').map(function (s) { return s.trim() })
    return parts.indexOf(selectorExact) !== -1
  })
}

// ------------------------------------------------------------------
// .table-scroll--meister-bulk：高さ制限・縦スクロール
// ------------------------------------------------------------------
{
  var scrollRules = cssRules.filter(function (r) { return r.selector === '.table-scroll--meister-bulk' && !r.mediaCondition })
  assertTrue(scrollRules.length > 0, '.table-scroll--meister-bulkのトップレベルルールが存在する')
  var hasMaxHeight = scrollRules.some(function (r) { return declares_(r.declarationsText, 'max-height') })
  assertTrue(hasMaxHeight, '.table-scroll--meister-bulkはmax-height（見出し＋10人分目安の高さ上限）を持つ')
  // レビュー対応（高さ不足の修正 2026-09-24）：行高（th/tdのpadding上下＋テキスト行送り＋
  // border-bottom、約2.36rem/行）から見出し1行＋本文10行を概算すると約25.9remになるため、
  // 26remを下回らないこと（文字縮小・行の圧縮で数値だけ合わせていないことの確認）
  var maxHeightRemValue = scrollRules.map(function (r) { return r.declarationsText.match(/max-height\s*:\s*min\(\s*([\d.]+)rem/) }).filter(Boolean)[0]
  assertTrue(!!maxHeightRemValue && Number(maxHeightRemValue[1]) >= 26, '.table-scroll--meister-bulkのmax-heightのrem値は26rem以上（見出し＋10人分の行高概算を満たす）')
  var hasOverflowY = scrollRules.some(function (r) { return /overflow-y\s*:\s*auto/.test(r.declarationsText) })
  assertTrue(hasOverflowY, '.table-scroll--meister-bulkはoverflow-y: autoを持つ（11人目以降は縦スクロールで確認できる）')
  // 少人数なら人数に応じた高さになり、余分な空白を作らない＝max-heightであって固定heightではない
  var hasFixedHeight = scrollRules.some(function (r) { return declares_(r.declarationsText, 'height') && !declares_(r.declarationsText, 'max-height') })
  assertTrue(!hasFixedHeight, '.table-scroll--meister-bulkは固定heightを持たない（max-heightのみ。10人未満なら人数に応じた高さになり、余分な空白を作らない）')
}

// 小さい画面・拡大表示でも読める（vh併用で頭打ちにし、rem固定値だけに頼らない）
{
  var scrollRules2 = cssRules.filter(function (r) { return r.selector === '.table-scroll--meister-bulk' && !r.mediaCondition })
  var maxHeightDecl = scrollRules2.map(function (r) { return r.declarationsText.match(/max-height\s*:\s*([^;]+);?/) }).filter(Boolean)[0]
  assertTrue(!!maxHeightDecl && /vh/.test(maxHeightDecl[1]), '.table-scroll--meister-bulkのmax-heightはvh単位を含む（画面高に応じて頭打ちにし、拡大表示・狭い画面でも操作不能にしない）')
}

// ------------------------------------------------------------------
// 縦スクロール中の列見出し固定（thead th）
// ------------------------------------------------------------------
{
  var theadThRules = cssRules.filter(function (r) { return r.selector === '.table-scroll--meister-bulk thead th' && !r.mediaCondition })
  assertTrue(theadThRules.length > 0, '.table-scroll--meister-bulk thead thのルールが存在する')
  var hasStickyTop = theadThRules.some(function (r) { return /position\s*:\s*sticky/.test(r.declarationsText) && /top\s*:\s*0/.test(r.declarationsText) })
  assertTrue(hasStickyTop, '.table-scroll--meister-bulk thead thはposition: sticky; top: 0を持つ（縦スクロール中も列見出しが上に固定される）')
}

// ------------------------------------------------------------------
// 重なり順3段階（レビュー対応 2026-09-24）：
//   1: 本文の氏名列（.meister-bulk-name-cell、共通）
//   2: 列見出し（.table-scroll--meister-bulk thead th）
//   3: 左上の氏名見出し（.table-scroll--meister-bulk thead .meister-bulk-name-cell）
// 数値の大小関係そのものを確認する（存在だけでなく、本文の氏名セルが列見出しを覆わないこと）
// ------------------------------------------------------------------
{
  var nameHeadRules = findRulesContainingSelector_(cssRules, 'thead .meister-bulk-name-cell')
  var topLevelNameHead = nameHeadRules.filter(function (r) { return !r.mediaCondition })
  var hasBackground = topLevelNameHead.some(function (r) { return declares_(r.declarationsText, 'background') })
  assertTrue(hasBackground, 'thead .meister-bulk-name-cellは背景色を持つ（既存。縦横両方が固定されても下の行・列と重ならない）')

  // 本文の氏名列（共通.meister-bulk-name-cell、tbody側にも適用される）
  var bodyNameCellRules = cssRules.filter(function (r) { return r.selector === '.meister-bulk-name-cell' && !r.mediaCondition })
  var bodyNameZIndex = bodyNameCellRules.map(function (r) { return r.declarationsText.match(/z-index\s*:\s*(\d+)/) }).filter(Boolean)[0]
  assertTrue(!!bodyNameZIndex, '本文の氏名列（.meister-bulk-name-cell）にz-indexの宣言がある')

  // 列見出し（縦方向sticky）
  var headThZIndex = cssRules.filter(function (r) { return r.selector === '.table-scroll--meister-bulk thead th' && !r.mediaCondition })
    .map(function (r) { return r.declarationsText.match(/z-index\s*:\s*(\d+)/) }).filter(Boolean)[0]
  assertTrue(!!headThZIndex, '列見出し（.table-scroll--meister-bulk thead th）にz-indexの宣言がある')

  // 左上の氏名見出し（縦横両方のsticky交点）
  var nameHeadInScroll = cssRules.filter(function (r) { return r.selector === '.table-scroll--meister-bulk thead .meister-bulk-name-cell' && !r.mediaCondition })
  assertTrue(nameHeadInScroll.length > 0, '.table-scroll--meister-bulk thead .meister-bulk-name-cellの専用ルールが存在する')
  var nameHeadZIndex = nameHeadInScroll.map(function (r) { return r.declarationsText.match(/z-index\s*:\s*(\d+)/) }).filter(Boolean)[0]
  assertTrue(!!nameHeadZIndex, '左上の氏名見出しにz-indexの宣言がある')

  assertTrue(!!bodyNameZIndex && !!headThZIndex && Number(headThZIndex[1]) > Number(bodyNameZIndex[1]), '列見出しのz-indexは本文の氏名列より大きい（縦スクロール時、本文の氏名セルが技能見出しを覆わない）')
  assertTrue(!!headThZIndex && !!nameHeadZIndex && Number(nameHeadZIndex[1]) > Number(headThZIndex[1]), '左上の氏名見出しのz-indexは他の列見出しより大きい（縦横両方の固定が重なっても氏名見出しが最前面に出る）')
  assertTrue(!!bodyNameZIndex && !!nameHeadZIndex && Number(nameHeadZIndex[1]) > Number(bodyNameZIndex[1]), '左上の氏名見出しのz-indexは本文の氏名列より大きい（3段階の重なり順が一直線に成立している）')

  // 既存の横方向sticky（.meister-bulk-name-cell）を変更していないこと（回帰確認）
  var hasStickyLeft = bodyNameCellRules.some(function (r) { return /position\s*:\s*sticky/.test(r.declarationsText) && /left\s*:\s*0/.test(r.declarationsText) })
  assertTrue(hasStickyLeft, '既存の.meister-bulk-name-cell（横方向のsticky、left: 0）は変更していない')
}

// ------------------------------------------------------------------
// キーボード操作でフォーカスが見える（:focus）
// ------------------------------------------------------------------
{
  var focusRules = cssRules.filter(function (r) { return r.selector === '.table-scroll--meister-bulk:focus' && !r.mediaCondition })
  assertTrue(focusRules.length > 0, '.table-scroll--meister-bulk:focusのルールが存在する（tabindex="0"でフォーカスした際に見える）')
  var hasFocusRing = focusRules.some(function (r) { return /box-shadow\s*:\s*var\(--focus-ring\)/.test(r.declarationsText) })
  assertTrue(hasFocusRing, '.table-scroll--meister-bulk:focusは他の操作要素と同じ--focus-ringトークンを使っている')
}

console.log('---')
console.log('検証対象6: 共通.table-scroll・他画面（判定詳細モーダル等）への影響がないこと')
console.log('---')

{
  // 共通.table-scroll自体にmax-height/overflow-yを追加していないこと
  // （この一覧専用クラスtable-scroll--meister-bulkにだけ高さ制限を適用する）
  var baseTableScrollRules = cssRules.filter(function (r) { return r.selector === '.table-scroll' && !r.mediaCondition })
  assertTrue(baseTableScrollRules.length > 0, '共通.table-scrollのルールは引き続き存在する')
  var baseHasMaxHeight = baseTableScrollRules.some(function (r) { return declares_(r.declarationsText, 'max-height') })
  assertTrue(!baseHasMaxHeight, '共通.table-scrollにはmax-height（高さ制限）を追加していない（他画面の横スクロールに影響しない）')
  var baseHasOverflowY = baseTableScrollRules.some(function (r) { return declares_(r.declarationsText, 'overflow-y') })
  assertTrue(!baseHasOverflowY, '共通.table-scrollにはoverflow-y（縦スクロール制御）を追加していない')
  var baseHasOverflowX = baseTableScrollRules.some(function (r) { return /overflow-x\s*:\s*auto/.test(r.declarationsText) })
  assertTrue(baseHasOverflowX, '共通.table-scrollの既存overflow-x: auto（横スクロール）は変更していない')

  // 判定詳細モーダルの独自スクロール（.modal--judge-detail__table-scroll）が引き続き存在する
  var judgeDetailScrollRules = cssRules.filter(function (r) { return r.selector === '.modal--judge-detail__table-scroll' })
  assertTrue(judgeDetailScrollRules.length > 0, '判定詳細モーダルの.modal--judge-detail__table-scroll（既存の縦スクロール）は変更していない')
}

console.log('---')
console.log('【ブラウザ確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザで、見出し＋従業員10人分がPC標準表示のウィンドウ内に収まること')
console.log('  （max-heightのrem値は概算であり、フォントレンダリング・実際の行高で誤差が生じうる）')
console.log('- 15人で下までスクロールでき、列見出しが画面上部に残り続けること')
console.log('- 下の行のチェックを変更し、上下にスクロールしても変更が消えないこと（DOM再生成が')
console.log('  発生していないことのロジック確認はこのテストで行ったが、実際のスクロール操作の')
console.log('  見た目は未確認）')
console.log('- 下の行を保存でき、再読み込み後に反映されること')
console.log('- 縦横スクロール中、実際に氏名・マイスター名の見出しが読める位置に留まり続けること')
console.log('  （position: stickyの宣言があることの確認はできたが、実際のブラウザでの重なり・')
console.log('  背景の透け・スクロールバーとの位置関係は未確認）')
console.log('- 少人数・狭い画面・拡大表示で操作不能や過剰な空白が生まれないこと')
console.log('- tabindex="0"のラッパーを実際にTabキーでフォーカスでき、矢印キー等でスクロール')
console.log('  操作できること、フォーカスリングが実際に見えること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
