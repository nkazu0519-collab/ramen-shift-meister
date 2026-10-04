// レビュー対応（縦横スクロールを単一コンテナへ統合 2026-09-16）：
// 前回の実装は横スクロール（.timeline-scroll）と縦スクロール（.timeline-body-scroll、従業員行だけを
// 別コンテナで囲む）を別々に持たせていたが、以下2件のレビュー指摘を受けて構造を全面的に見直した。
//
// 指摘1：.timeline-body-scrollが新たなスクロールコンテナとなり、氏名列（.timeline-name、
// position:sticky; left:0）の基準がそのコンテナになってしまう。外側の.timeline-scrollを
// 横スクロールしても、氏名列は可視領域の左端に固定されない（.timeline-body-scroll自体が
// 横へ動くだけで、コンテナ内での相対位置は変わらないため見た目は左に固定されて見えるが、
// 画面上の絶対位置としては動いてしまう）。
//
// 指摘2：.timeline-body-scroll単体が縦スクロールバーを持つ環境では、その分だけ従業員行の
// 実効幅が見出し・判定行（.timeline-body-scrollの外）より狭くなり、時間軸の位置がずれる。
//
// 修正：.timeline-scroll単一コンテナへ縦横両方のoverflow: autoを持たせる（.timeline-body-scrollは
// 廃止）。見出し行・判定行はtop方向のposition:stickyで上固定、氏名列は既存どおりleft方向の
// position:stickyで左固定にする。同じスクロールコンテナ内にあるため、どちらも可視領域基準で
// 効き、指摘1・2はどちらも構造的に発生しなくなる（幅がずれる余地となる「別コンテナ」自体が
// もう存在しない）。
//
// このテストでは、view_home.htmlのマークアップ構造とcss.htmlのスタイルを確認する。
// 「文字列検査が通るだけで描画確認済みとしない」という指摘（過去のレビュー）を踏まえ、
// CSSをブロック単位で簡易パースし、max-heightのcalc()式が実際に「見出し1行＋判定1行＋
// 従業員6行＋境界線7本」と一致する値になっているかを、文字列一致ではなく数式として評価して
// 検証する。ただし、これはCSSが計算する値の検証であり、ブラウザでの実際の描画・スクロール
// （本当に単一コンテナで縦横同時にスクロールでき、氏名列・見出しが可視領域基準で固定され、
// 縦スクロールバーの有無で幅がずれないか）はこのテストの対象外（実機確認が必要）。
//
// 実行: node shift_timeline_scroll_structure_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var home = fs.readFileSync(path.join(APP_DIR, 'view_home.html'), 'utf8')
var css = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')

var pass = 0
var fail = 0
function assertTrue(value, label) {
  var ok = !!value
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

/**
 *  <style>〜</style>の中身を、メディアクエリの内外を区別しながら簡易パースする
 *  （shift_card_date_nav_test.jsのparseCssRules_と同じ考え方。各テストファイルが自己完結する
 *  既存の慣習に合わせ、共通モジュール化はせずここでも同じ実装を持つ）
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

function findRule_(selectorExact, mediaCondition) {
  return cssRules.filter(function (r) { return r.selector === selectorExact && r.mediaCondition === (mediaCondition || null) })
}
function findRulesContainingSelector_(selectorPart, mediaCondition) {
  return cssRules.filter(function (r) {
    return r.mediaCondition === (mediaCondition || null) &&
      r.selector.split(',').map(function (s) { return s.trim() }).indexOf(selectorPart) !== -1
  })
}
function getDeclValue_(declarationsText, prop) {
  var re = new RegExp('(^|;)\\s*' + prop + '\\s*:\\s*([^;]+);?')
  var m = declarationsText.match(re)
  return m ? m[2].trim() : null
}

// ------------------------------------------------------------------
// HTML構造：.timeline-body-scroll（前回の入れ子スクロール構造）はもう存在しないこと。
// 見出し行・判定行・timeline_bodyは、すべて.timeline-table直下の兄弟要素であること
// ------------------------------------------------------------------
assertTrue(!/class="[^"]*timeline-body-scroll/.test(home), 'view_home.htmlに.timeline-body-scroll（旧・入れ子の縦スクロールコンテナ）を使う要素は存在しない')
// css.html側は「なぜ単一コンテナへ変えたか」の説明としてコメント中に旧クラス名が残ってよい
// （経緯の記録として有用）。実際のスタイル定義（セレクタとして.timeline-body-scrollを持つルール）が
// もう存在しないことだけを、パース結果（コメント除去済み）で確認する
var leftoverBodyScrollRules = cssRules.filter(function (r) { return /timeline-body-scroll/.test(r.selector) })
assertTrue(leftoverBodyScrollRules.length === 0, 'css.htmlに.timeline-body-scrollをセレクタとして使うスタイル定義はもう存在しない（コメント中の経緯説明は除く）')

var timelineTableMatch = home.match(/<div class="timeline-table">([\s\S]*?)\n        <\/div>\n      <\/div>/)
assertTrue(!!timelineTableMatch, 'timeline-tableブロックの範囲を取得できた')
if (timelineTableMatch) {
  var timelineTableInner = timelineTableMatch[1]
  var headerIdx = timelineTableInner.indexOf('timeline_header_track')
  var judgeIdx = timelineTableInner.indexOf('timeline_judge_track')
  var bodyIdx = timelineTableInner.indexOf('id="timeline_body"')
  assertTrue(headerIdx !== -1, 'timeline-table内にtimeline_header_trackがある（見出し行）')
  assertTrue(judgeIdx !== -1, 'timeline-table内にtimeline_judge_trackがある（判定行）')
  assertTrue(bodyIdx !== -1, 'timeline-table内にid="timeline_body"がある')
  assertTrue(headerIdx < judgeIdx && judgeIdx < bodyIdx, '見出し行→判定行→timeline_bodyの順でtimeline-table直下に並んでいる（別コンテナへの入れ子はない）')
  // timeline_bodyの直前が</div>（判定行の閉じタグ）であること＝timeline_bodyがラップされていないことの確認
  var beforeBodyText = timelineTableInner.slice(0, bodyIdx)
  var lastOpenDivBeforeBody = beforeBodyText.lastIndexOf('<div')
  assertTrue(!/class="timeline-body-scroll"/.test(beforeBodyText.slice(lastOpenDivBeforeBody)), 'timeline_bodyを直接囲むdivに.timeline-body-scrollクラスは付いていない')
}

// ------------------------------------------------------------------
// CSS：.timeline-scroll単一コンテナが縦横両方のスクロール（overflow: auto）を持つこと
// ------------------------------------------------------------------
var scrollRule = findRule_('.timeline-scroll')[0]
assertTrue(!!scrollRule, '.timeline-scrollのトップレベルルールが存在する')
if (scrollRule) {
  var overflowValue = getDeclValue_(scrollRule.declarationsText, 'overflow')
  var overflowXValue = getDeclValue_(scrollRule.declarationsText, 'overflow-x')
  var overflowYValue = getDeclValue_(scrollRule.declarationsText, 'overflow-y')
  assertTrue(overflowValue === 'auto' || (overflowXValue === 'auto' && overflowYValue === 'auto'), '.timeline-scrollは縦横両方のoverflow: auto（単一コンテナで縦横スクロールする）')
}

// ------------------------------------------------------------------
// CSS：見出し行・判定行が縦方向にposition:stickyで上固定されていること（同じ.timeline-scroll内、
// つまり可視領域基準で効く）。判定行のtopは見出し行の高さぶんだけ下にずれていること
// ------------------------------------------------------------------
var headerRowRule = findRule_('.timeline-row.timeline-header')[0]
var judgeRowRule = findRule_('.timeline-row.timeline-judge-row')[0]
assertTrue(!!headerRowRule, '.timeline-row.timeline-headerのルールが存在する')
assertTrue(!!judgeRowRule, '.timeline-row.timeline-judge-rowのルールが存在する')
if (headerRowRule) {
  assertTrue(getDeclValue_(headerRowRule.declarationsText, 'position') === 'sticky', '見出し行はposition:stickyで上固定される')
  assertTrue(getDeclValue_(headerRowRule.declarationsText, 'top') === '0', '見出し行はtop:0（最上部に固定）')
}
if (judgeRowRule) {
  assertTrue(getDeclValue_(judgeRowRule.declarationsText, 'position') === 'sticky', '判定行はposition:stickyで上固定される')
  var judgeTop = getDeclValue_(judgeRowRule.declarationsText, 'top')
  assertTrue(!!judgeTop && /var\(--timeline-row-height\)/.test(judgeTop), '判定行のtopは--timeline-row-height（見出し行の高さ）を基準にした値になっている（見出し行の直下に固定される）')
}

// ------------------------------------------------------------------
// CSS：.timeline-nameの左固定（position:sticky; left:0）が維持されていること
// （同じ.timeline-scroll内にあるため、横スクロール時も可視領域の左端に固定される＝指摘1の解消）
// ------------------------------------------------------------------
var timelineNameRule = findRule_('.timeline-name')[0]
assertTrue(!!timelineNameRule, '.timeline-nameのトップレベルルールが存在する')
if (timelineNameRule) {
  assertTrue(getDeclValue_(timelineNameRule.declarationsText, 'position') === 'sticky', '.timeline-nameは引き続きposition:sticky（氏名列の固定を維持）')
  assertTrue(getDeclValue_(timelineNameRule.declarationsText, 'left') === '0', '.timeline-nameは引き続きleft:0（左端に固定）')
}

// 見出し・判定行の氏名セル（上下左右のsticky交差点）は、通常の従業員行の氏名セルより高い
// z-indexを持ち、交差部分で文字・バーが重ならないこと
var headerJudgeNameRules = findRulesContainingSelector_('.timeline-header .timeline-name') .filter(function (r) {
  return /z-index/.test(r.declarationsText)
})
assertTrue(headerJudgeNameRules.length > 0, '.timeline-header .timeline-name（交差部分）にz-index指定があるルールが存在する')
if (headerJudgeNameRules.length > 0 && timelineNameRule) {
  var baseZIndex = Number(getDeclValue_(timelineNameRule.declarationsText, 'z-index'))
  var crossingZIndex = Number(getDeclValue_(headerJudgeNameRules[0].declarationsText, 'z-index'))
  assertTrue(crossingZIndex > baseZIndex, '交差部分の氏名セルは基本のz-index（' + baseZIndex + '）より高い値（' + crossingZIndex + '）を持つ')
}
// 見出し行・判定行自体（.timeline-row.timeline-header等）のz-indexも、通常の従業員行（指定なし＝auto）より
// 高く、縦スクロール時に従業員行のバーの上に重なって見えないこと
if (headerRowRule && judgeRowRule) {
  var headerRowZIndex = Number(getDeclValue_(headerRowRule.declarationsText, 'z-index'))
  var judgeRowZIndex = Number(getDeclValue_(judgeRowRule.declarationsText, 'z-index'))
  assertTrue(headerRowZIndex > 0, '見出し行はz-indexが明示され、通常の従業員行より手前に来る')
  assertTrue(judgeRowZIndex > 0, '判定行はz-indexが明示され、通常の従業員行より手前に来る')
}

// ------------------------------------------------------------------
// CSS：max-heightのcalc()式が「見出し1行＋判定1行＋従業員6行＋境界線7本」という
// 意図どおりの計算になっていること。文字列一致ではなく、変数を実際の値に置き換えて数式として評価する
// ------------------------------------------------------------------
var rowHeightVarDecl = scrollRule ? getDeclValue_(scrollRule.declarationsText, '--timeline-row-height') : null
var visibleRowsVarDecl = scrollRule ? getDeclValue_(scrollRule.declarationsText, '--timeline-visible-employee-rows') : null
assertTrue(rowHeightVarDecl === 'var(--control-height)', '--timeline-row-heightは既存の--control-height（2.25rem）を参照している')
assertTrue(visibleRowsVarDecl === '6', '--timeline-visible-employee-rowsは6（指示どおり最大6人分）')

var controlHeightRule = cssRules.filter(function (r) { return r.selector === ':root' && r.mediaCondition === null })[0]
var controlHeightRem = controlHeightRule ? getDeclValue_(controlHeightRule.declarationsText, '--control-height') : null
assertTrue(controlHeightRem === '2.25rem', '前提: :root の --control-height は2.25rem（変更されていない）')

if (scrollRule && controlHeightRem === '2.25rem' && visibleRowsVarDecl === '6') {
  var maxHeightDecl = getDeclValue_(scrollRule.declarationsText, 'max-height')
  assertTrue(!!maxHeightDecl, '.timeline-scrollにmax-height宣言がある')
  if (maxHeightDecl) {
    // calc(var(--timeline-row-height) * (var(--timeline-visible-employee-rows) + 2) + (var(--timeline-visible-employee-rows) + 2 - 1) * 1px)
    // という式を、実際の値（2.25rem, 6）で置き換えて評価する。見出し1行＋判定1行＋従業員6行＝8行、
    // 境界線は8行のうち最終行以外の7本という計算になっているかを数式として確認する
    var substituted = maxHeightDecl
      .replace(/var\(--timeline-row-height\)/g, '2.25rem')
      .replace(/var\(--timeline-visible-employee-rows\)/g, '6')
    var remTermMatch = substituted.match(/calc\(\s*([\d.]+)rem\s*\*\s*\(\s*(\d+)\s*\+\s*(\d+)\s*\)/)
    var pxTermMatch = substituted.match(/\(\s*(\d+)\s*\+\s*(\d+)\s*-\s*1\s*\)\s*\*\s*1px/)
    assertTrue(!!remTermMatch, 'max-heightのcalc式からrem項（行の高さ×総行数）を抽出できた -> ' + substituted)
    assertTrue(!!pxTermMatch, 'max-heightのcalc式からpx項（境界線の本数×1px）を抽出できた -> ' + substituted)
    if (remTermMatch) {
      var remValue = Number(remTermMatch[1])
      var totalRows = Number(remTermMatch[2]) + Number(remTermMatch[3])
      assertTrue(remValue === 2.25 && totalRows === 8, 'rem項は2.25rem×8行（見出し1＋判定1＋従業員6＝18rem）を計算する式になっている')
    }
    if (pxTermMatch) {
      var totalRowsForBoundary = Number(pxTermMatch[1]) + Number(pxTermMatch[2])
      var boundaryCount = totalRowsForBoundary - 1
      assertTrue(totalRowsForBoundary === 8 && boundaryCount === 7, 'px項は8行の境界線7本ぶん（8-1=7px）を計算する式になっている')
    }
  }
}

// ------------------------------------------------------------------
// CSS：6人未満でも空白の行ができないこと（heightではなくmax-heightだけを指定しているため、
// 実際の行数がmax-heightの目安より少なければ自然にそれより低くなる、という設計の確認）
// ------------------------------------------------------------------
if (scrollRule) {
  assertTrue(!/(^|;)\s*height\s*:/.test(scrollRule.declarationsText), '.timeline-scrollはheightを固定していない（max-heightだけなので、6人未満でも空白の行ができない）')
}

// ------------------------------------------------------------------
// CSS：小さい画面では画面の高さに合わせて表示領域を縮めること（30rem以下でmin()によりmax-heightが
// ビューポート高さ基準にもなっていること）
// ------------------------------------------------------------------
var narrowMediaRule = findRule_('.timeline-scroll', '@media (max-width: 30rem)')[0]
assertTrue(!!narrowMediaRule, '@media (max-width: 30rem)内に.timeline-scrollのルールがある（小さい画面用の上限）')
if (narrowMediaRule) {
  assertTrue(/min\(/.test(narrowMediaRule.declarationsText) && /vh/.test(narrowMediaRule.declarationsText), '小さい画面ではmin()でビューポート高さ（vh）も考慮したmax-heightになる')
}

// ------------------------------------------------------------------
// 日付操作・登録ボタン（.shift-card-top）がスクロール領域に含まれていないこと
// （.shift-card-topはtimeline-scrollの外にある）
// ------------------------------------------------------------------
var shiftCardTopIdx = home.indexOf('shift-card-top')
var timelineScrollIdx = home.indexOf('class="timeline-scroll"')
assertTrue(shiftCardTopIdx !== -1 && timelineScrollIdx !== -1 && shiftCardTopIdx < timelineScrollIdx, '.shift-card-top（日付操作・登録ボタン）は.timeline-scrollより前にあり、別の要素（スクロール領域の外）')

console.log('---')
console.log('【ブラウザ実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザで「見出し＋判定行＋6人分」の高さに表が収まり、7人目以降が')
console.log('  表内スクロールで確認できること（calc式の値が正しいことは確認したが、実描画は未確認）')
console.log('- 外側を横スクロールしても、氏名列が実際に可視領域の左端に固定され続けること')
console.log('  （指摘1の解消：構造上は単一コンテナになったが、実際のブラウザ描画は未確認）')
console.log('- 縦スクロールバーが実際に表示される環境でも、見出し・判定行・従業員行の時間軸の')
console.log('  横位置が一致し続けること（指摘2の解消：同一コンテナ内なのでスクロールバー幅は')
console.log('  全行が等しく共有するはずだが、実際のブラウザ描画は未確認）')
console.log('- 6人未満のとき実際に空白の行ができず、内容に応じた高さになっていること')
console.log('- 小さい画面（スマホ幅・狭いPC幅）で表示領域が画面の高さに収まり、はみ出さないこと')
console.log('- 縦横スクロールの交差部分（見出し・判定行の氏名セル）で、実際に文字・バーが重ならないこと')
console.log('- サイドバー展開／折りたたみで横幅が変わった際も、単一コンテナでの縦横スクロールが')
console.log('  正しく機能し続けること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
