// レビュー対応（日付操作の統合 2026-09-16、狭い幅での不要な高さ・Tab順の修正 2026-09-16）：
// 上部の独立した日付カード（旧.card.nav-card）を撤去し、中身を「営業日のシフト体制」カード上部
// （.shift-card-top）へ移動した。対象日とシフトを同じ場所で確認・操作できるようにする変更で、
// 日付操作の要素ID・onclickハンドラ・イベント処理は変更していない（js_home_controller.html側の
// goToPreviousDay/goToNextDay/goToToday/handleBusinessDateInputChangeはIDを参照するだけで
// DOM上の位置に依存しないため、ロジック自体には手を入れていない）。
//
// 再レビューで見つかった2件の修正：
// 1. .shift-card-top__actions・.shift-card-top__navのflex-basis（20rem）が、横並び（row）だけでなく
//    縦並び（元はcolumn-reverse）の既定スタイルにも残っており、縦方向では「高さ」の基準値として
//    作用して不要な空白を生んでいた。flex-basisを横並び用の@media (min-width: 60rem)ブロック内だけに
//    移し、縦並び時は内容に応じた高さ（auto）に戻した。
// 2. DOM順が「actions→nav」のままcolumn-reverseで視覚順だけを逆転させていたため、狭い画面で
//    Tabキーが見た目と逆順（actions→nav）に移動する分かりにくさがあった。DOM順を表示指示どおり
//    「nav→actions」に入れ替え、column-reverseをやめて素直なcolumnにした。広い画面での
//    「左actions・右nav」という見た目は、.shift-card-top__actionsのorder:-1（@media内）だけで
//    実現し、Tab順は常にDOM順（nav→actions）のままにする（本人判断：広い画面でTab順と視覚順が
//    左右で入れ替わる点は許容し、実装をシンプルに保つ）。
//
// このテストでは、view_home.html・css.htmlの静的なHTML/CSS構造を確認する。加えて、
// 「文字列検査が通るだけでレイアウト確認済みとしない」という指摘に応えるため、CSSの
// ブロック構造を簡易パースして「.shift-card-top__actions・.shift-card-top__navの既定ルール
// （メディアクエリの外）にflex-basisを作る宣言（flex-basis / flexショートハンド）が
// 含まれていないこと」を、文字列一致ではなく宣言単位で機械的に検証する（今回の不具合を
// 検出できる回帰テスト）。
//
// 実行: node shift_card_date_nav_test.js
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
 *  <style>〜</style>の中身を、メディアクエリの内外を区別しながら「トップレベルのルール」と
 *  「メディアクエリ内のルール」に簡易パースする。本番CSSはネストしたメディアクエリを使わない
 *  前提の最小実装（このアプリのcss.htmlの構造に限定した簡易パーサであり、汎用CSSパーサの
 *  代わりではない）。各ルールは { selector, declarationsText, mediaCondition（トップレベルはnull） } を持つ
 */
function parseCssRules_(cssText) {
  var body = cssText.replace(/^[\s\S]*?<style>/, '').replace(/<\/style>[\s\S]*$/, '')
  // コメントを除去（/* ... */はネストしない前提）
  body = body.replace(/\/\*[\s\S]*?\*\//g, '')

  var rules = []
  var i = 0
  var mediaStack = []

  while (i < body.length) {
    // 次の '{' または '}' を探す
    var openIdx = body.indexOf('{', i)
    var closeIdx = body.indexOf('}', i)
    if (openIdx === -1 && closeIdx === -1) break

    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      // メディアクエリの閉じ括弧
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

    // 通常のルール：selector { declarations }
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

function findRules_(selectorExact) {
  return cssRules.filter(function (r) { return r.selector === selectorExact })
}
function declaresFlexBasis_(declarationsText) {
  // 「flex-basis:」宣言、または「flex:」ショートハンド（flex: <grow> <shrink> <basis> の形）の
  // どちらでもflex-basisを与えるため両方を対象にする
  return /(^|;)\s*flex-basis\s*:/.test(declarationsText) || /(^|;)\s*flex\s*:\s*[\d.]+\s+[\d.]+\s+\S/.test(declarationsText)
}

// ------------------------------------------------------------------
// 回帰テスト（不要な高さの原因を機械的に検証）：.shift-card-top__actions・
// .shift-card-top__nav.nav-cardのトップレベル（メディアクエリ外）ルールに、
// flex-basisを作る宣言が存在しないこと。存在すれば、縦並び時にその値が高さの
// 基準として作用し不要な空白を生む（この検証が本来の不具合を再現・検出する）
// ------------------------------------------------------------------
var actionsTopLevelRules = findRules_('.shift-card-top__actions').filter(function (r) { return r.mediaCondition === null })
var navTopLevelRules = findRules_('.shift-card-top__nav.nav-card').filter(function (r) { return r.mediaCondition === null })
assertTrue(actionsTopLevelRules.length === 1, '.shift-card-top__actionsのトップレベル（メディアクエリ外）ルールが1件ある')
assertTrue(navTopLevelRules.length === 1, '.shift-card-top__nav.nav-cardのトップレベル（メディアクエリ外）ルールが1件ある')
if (actionsTopLevelRules.length === 1) {
  assertTrue(!declaresFlexBasis_(actionsTopLevelRules[0].declarationsText), '.shift-card-top__actionsのトップレベルルールにflex-basisを作る宣言がない（縦並び時に高さの基準値として作用しない）')
}
if (navTopLevelRules.length === 1) {
  assertTrue(!declaresFlexBasis_(navTopLevelRules[0].declarationsText), '.shift-card-top__nav.nav-cardのトップレベルルールにflex-basisを作る宣言がない（縦並び時に高さの基準値として作用しない）')
}

// flex-basisは横並び用の@media (min-width: 60rem)ブロック内には存在してよい（むしろ必要）。
// トップレベルにはなく、メディアクエリ内にはあることまで確認し、「単に消しただけ」ではなく
// 「横並び時のカラム幅制御は維持されている」ことを裏付ける
var actionsWideRules = findRules_('.shift-card-top__actions').filter(function (r) { return r.mediaCondition === '@media (min-width: 60rem)' })
var navWideRules = findRules_('.shift-card-top__nav.nav-card').filter(function (r) { return r.mediaCondition === '@media (min-width: 60rem)' })
assertTrue(actionsWideRules.length === 1 && declaresFlexBasis_(actionsWideRules[0].declarationsText), '.shift-card-top__actionsは@media (min-width: 60rem)内でflex-basisを持つ（横並び時のカラム幅制御は維持）')
assertTrue(navWideRules.length === 1 && declaresFlexBasis_(navWideRules[0].declarationsText), '.shift-card-top__nav.nav-cardは@media (min-width: 60rem)内でflex-basisを持つ（横並び時のカラム幅制御は維持）')

// ------------------------------------------------------------------
// 縦並び（トップレベル）の.shift-card-topはcolumn（column-reverseではない）であること
// （レビュー対応：DOM順をnav→actionsに揃えたため、視覚順を逆転させるcolumn-reverseは不要になった）
// ------------------------------------------------------------------
var shiftCardTopTopLevelRules = findRules_('.shift-card-top').filter(function (r) { return r.mediaCondition === null })
assertTrue(shiftCardTopTopLevelRules.length === 1, '.shift-card-topのトップレベルルールが1件ある')
if (shiftCardTopTopLevelRules.length === 1) {
  var topDecl = shiftCardTopTopLevelRules[0].declarationsText
  assertTrue(/flex-direction\s*:\s*column\s*;/.test(topDecl), '.shift-card-topは縦並び時、素直なcolumn（column-reverseではない）')
  assertTrue(!/column-reverse/.test(topDecl), '.shift-card-topのトップレベルルールにcolumn-reverseは存在しない')
}

// 広い画面では、DOM順を変えずorderだけで見た目上actionsを先頭（左）に出す
var actionsWideRule = actionsWideRules[0]
assertTrue(!!actionsWideRule && /order\s*:\s*-1\s*;/.test(actionsWideRule.declarationsText), '.shift-card-top__actionsは@media (min-width: 60rem)内でorder:-1を持つ（DOM順を変えずに見た目だけ左へ出す）')

// ------------------------------------------------------------------
// DOM順の確認：表示指示どおり「日付操作(nav)→判定・登録操作(actions)」の順であること
// （レビュー対応：以前はDOM順が「actions→nav」で、column-reverseにより視覚順だけ逆転させていた。
// 狭い画面でTabキーが見た目と逆順に移動する分かりにくさがあったため、DOM順自体を表示順に揃えた）
// ------------------------------------------------------------------
var shiftCardTopMatch = home.match(/<div class="shift-card-top">([\s\S]*?)\n      <\/div>\n\n      <div id="timeline_message"/)
assertTrue(!!shiftCardTopMatch, 'shift-card-topブロックの範囲を取得できた（直後にtimeline_messageが続く）')
if (shiftCardTopMatch) {
  var shiftCardTopInner = shiftCardTopMatch[1]
  var actionsIndex = shiftCardTopInner.indexOf('shift-card-top__actions')
  var navIndex = shiftCardTopInner.indexOf('shift-card-top__nav')
  assertTrue(actionsIndex !== -1, 'shift-card-top内にshift-card-top__actionsがある')
  assertTrue(navIndex !== -1, 'shift-card-top内にshift-card-top__navがある')
  assertTrue(navIndex !== -1 && actionsIndex !== -1 && navIndex < actionsIndex, 'DOM順は日付操作(nav)が先、判定・登録操作(actions)が後（表示指示どおりの順で、Tab順もこの順になる）')
  assertTrue(/id="judge_btn"/.test(shiftCardTopInner), 'shift-card-top内に判定ボタン（judge_btn）がある')
  assertTrue(!/id="shift_wish_add_btn"/.test(shiftCardTopInner), 'shift-card-top内に希望シフト追加ボタン（shift_wish_add_btn）がない（店主希望導線整理 2026-09-24で撤去）')
  assertTrue(/id="shift_direct_add_btn"/.test(shiftCardTopInner), 'shift-card-top内に直接シフト登録ボタン（shift_direct_add_btn）がある')
}

// ------------------------------------------------------------------
// 日付操作が新しいラッパー（.shift-card-top__nav）の中に移動していること（ID・onclickの維持確認）
// ------------------------------------------------------------------
assertTrue(!/class="card nav-card"/.test(home), '上部の独立した日付カード（class="card nav-card"）は存在しない')
var navWrapMatch = home.match(/<div class="nav-card shift-card-top__nav">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)
assertTrue(!!navWrapMatch, '日付操作のラッパー（class="nav-card shift-card-top__nav"）が見つかった')
if (navWrapMatch) {
  var navBlock = navWrapMatch[0]
  assertTrue(/id="business_date_label"/.test(navBlock), '日付操作ラッパー内にbusiness_date_labelがある')
  assertTrue(/id="business_date_input"/.test(navBlock), '日付操作ラッパー内にbusiness_date_inputがある')
  assertTrue(/id="business_day_type_display"/.test(navBlock), '日付操作ラッパー内にbusiness_day_type_displayがある')
  assertTrue(/onclick="goToPreviousDay\(\)"/.test(navBlock), '日付操作ラッパー内に前日ボタン（goToPreviousDay）がある')
  assertTrue(/onclick="goToNextDay\(\)"/.test(navBlock), '日付操作ラッパー内に翌日ボタン（goToNextDay）がある')
  assertTrue(/onclick="goToToday\(\)"/.test(navBlock), '日付操作ラッパー内に今日へ戻るボタン（goToToday）がある')
  assertTrue(/onchange="handleBusinessDateInputChange\(this\)"/.test(navBlock), '日付操作ラッパー内に日付指定入力（handleBusinessDateInputChange）がある')
}

// ------------------------------------------------------------------
// 全ての既存ID（日付操作・判定・登録操作）がview_home.html全体で重複なく1回だけ出現すること
// ------------------------------------------------------------------
var idsToCheck = [
  'business_date_label',
  'business_date_input',
  'business_day_type_display',
  'judge_btn',
  'judge_open_detail_btn',
  'judge_summary',
  'judge_message',
  'shift_direct_add_btn',
  'timeline_message'
]
idsToCheck.forEach(function (id) {
  var re = new RegExp('id="' + id + '"', 'g')
  var matches = home.match(re) || []
  assertTrue(matches.length === 1, 'id="' + id + '"はview_home.html内に重複なく1回だけ出現する（実際: ' + matches.length + '件）')
})

// 店主希望導線整理（2026-09-24）で撤去した「希望シフトを追加」ボタン・モーダルが
// view_home.html全体に残っていないことの否定テスト
assertTrue(!/id="shift_wish_add_btn"/.test(home), 'id="shift_wish_add_btn"はview_home.html全体に存在しない（店主希望導線整理で撤去）')
assertTrue(!/id="shift_wish_add_modal"/.test(home), 'id="shift_wish_add_modal"はview_home.html全体に存在しない（店主希望導線整理で撤去）')

// ------------------------------------------------------------------
// シフト表（.timeline-scroll）・休憩確保カードが「営業日のシフト体制」カードの後続として維持されていること
// ------------------------------------------------------------------
assertTrue(/<div class="timeline-scroll">/.test(home), 'シフト表（timeline-scroll）が存在する')
assertTrue(home.indexOf('shift-card-top') < home.indexOf('timeline-scroll'), 'shift-card-topはシフト表（timeline-scroll）より前に配置されている')
assertTrue(/休憩確保の候補/.test(home), '休憩確保の候補カードが存在する（無関係な変更をしていない）')

// ------------------------------------------------------------------
// 既存の.nav-card・.nav-primary・.nav-secondary・.judge-action-row自体の基本ルールは変更していない
// （クラス名としてそのまま残っていることだけを確認する。無関係な変更をしていないことの裏付け）
// ------------------------------------------------------------------
assertTrue(/\.nav-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/.test(css), '.nav-card自体のflex-direction:columnルールは維持されている')
assertTrue(/\.nav-primary\s*\{/.test(css), '.nav-primaryのスタイルは維持されている')
assertTrue(/\.nav-secondary\s*\{/.test(css), '.nav-secondaryのスタイルは維持されている')
assertTrue(/\.judge-action-row\s*\{/.test(css), '.judge-action-rowのスタイルは維持されている（既存の判定・登録操作の横並びに影響しない）')

console.log('---')
console.log('【ブラウザ実機確認が必要】このテストでは検証できない範囲:')
console.log('- 60rem以上の実際のブラウザ幅で、判定・登録操作（左）と日付操作（右）が視覚的に')
console.log('  左右2カラムで並び、要素が重ならないこと')
console.log('- 60rem未満・サイドバー展開時・ブラウザ拡大時に、日付操作→判定・登録操作→シフト表の順で')
console.log('  縦に折り返され、要素が切れたり重なったりしないこと、かつ不要な空白ができていないこと')
console.log('  （flex-basis除去の実際の描画結果はブラウザでのみ確認できる）')
console.log('- スマホ幅・狭いPC幅・広いPC幅、サイドバー展開／折りたたみの組み合わせで高さ・はみ出しがないこと')
console.log('- 実際のTabキー操作で、狭い画面は視覚順どおり、広い画面はDOM順（日付操作→判定・登録操作、')
console.log('  視覚上は右→左）でフォーカスが移動すること')
console.log('- シフト表自体の既存の横スクロール（timeline-scroll）が引き続き機能すること')
console.log('- 「対象営業日」の表示が見やすく、通信中・エラーメッセージが操作と無関係な場所へ')
console.log('  離れていないこと')
console.log('- シフト表の開始位置が、変更前と比べて実際に上へ寄っていること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
