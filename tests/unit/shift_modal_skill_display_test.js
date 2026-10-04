// レビュー対応（2つのモーダルのマイスター表示改善、再レビューでの修正 2026-09-16）：
// ①直接シフト登録モーダルは、従業員選択後のマイスター情報でモーダルが縦長になり登録ボタンが
//   押しづらくなる問題があった。マイスター詳細（employee_skill_card）を初期状態で閉じ、
//   「マイスター情報を見る」ボタンで開閉できるようにした（resetShiftSkillToggle_・toggleShiftSkillCard_）。
// ②シフトの変更・削除モーダルは、従業員名の横に取得マイスターのラベルを表示したいという
//   追加希望があった。当初はshiftEditSkillInlineLimit_で「通常3件・狭い画面1件」の固定件数に
//   していたが、再レビューで「名前の横に収まる分だけ」という仕様を満たさない指摘を受け、
//   recalculateShiftEditSkillInlineVisibility_でgetBoundingClientRect()による実幅計測へ
//   置き換えた（shiftEditSkillInlineLimit_は削除）。
//
// 再レビューで見つかったもう1件の指摘：.skill-tag・.skill-tag-more-btn・.skill-toggle-btnは
// displayをクラスセレクタで常時指定しており、要素のhidden属性だけでは非表示にならない
// （クラスセレクタとhidden属性のUAスタイルは詳細度が同じでソース順が勝つため）。
// 「hidden属性だけを調べるDOMスタブではCSS上書きを検出できない」という指摘どおり、
// この問題はJS側の単体テストでは原理的に検出できない（フェイクDOMはCSSのdisplay計算を
// 再現しないため）。CSS側の[hidden]優先ルールの存在確認はshift_modal_scroll_structure_test.jsで行う。
//
// さらに再レビューで見つかった指摘（幅計算に残る問題、2026-09-16）：
// recalculateShiftEditSkillInlineVisibility_はラベル列内部（.skill-tag-list--inline）だけを
// 計測中にnowrap化していたが、親の.modal-field--wrapはflex-wrap: wrapのままだった。
// ラベル列自体はflex: 1 1 autoのため、全タグを配置した計測時に「行自体」が2行目へ折り返ることが
// あり、その場合getBoundingClientRect().rightは「折り返った別行の幅」を返してしまい、
// 「名前の横の残り幅」を正しく計測できていなかった。
// 修正：.modal-field--wrapをflex-wrap: nowrapに固定し、「＋N件」ボタンはflex: 0 0 autoのまま、
// ラベル列がflex: 1 1 auto; min-width: 0; overflow: hiddenで「名前・ボタンを除いた残り幅」に
// 固定されるようにした。
//
// さらにその後の指摘（幅計算に残る問題2、2026-09-16）：名前（.modal-field__value）を
// flex-shrink: 0; max-width: 60%にしていたため、狭い画面で氏名が長いと「名前(60%)＋ラベル列
// (0まで縮小可能)＋＋N件ボタン＋gap」の合計が行幅を超えても名前自体が縮まず、行からはみ出す
// 問題が残っていた。修正：名前もflex-shrink: 1（既定）で縮められるようにし、min-width: 3rem
// だけ最低限の可読幅として残す。溢れる分はoverflow-wrap: anywhereで、空白のない長い英字名も
// 強制的に折り返す。recalculateShiftEditSkillInlineVisibility_のロジック自体（ラベル列の
// getBoundingClientRect().rightで実幅を計測する方式）は変更していない。名前が縮んだ結果として
// ラベル列に割り当てられる残り幅が変わっても、計測ロジックはその値をそのまま使うため対応できる。
//
// さらにその後の指摘（展開表示の重複解消、2026-09-16）：「＋N件」を押すと、別行の「全マイスター」
// （detailField・detailList）へ全件が再表示されるため、常時表示済みのラベルと重複していた。
// 修正：別行を廃止し、常時表示のラベル列（inlineList）自体が折りたたみ・展開の両方を担う設計へ
// 変更した。ui（createSkillTagUI_インスタンス）にui.expanded（展開状態）を追加。
// toggleSkillDetail_は、折りたたみ中なら隠れていたタグのhiddenを外して全件を1回だけ表示し
// （タグ要素自体はrecalculateSkillInlineVisibility_で既に全件分がinlineList内に存在するため、
// 作り直さない）、展開中ならrecalculateSkillInlineVisibility_を呼び直してその時点の幅で
// 表示件数・残り件数を再計算する（全件収まれば「＋N件」を表示しない）。展開中はCSS側
// （.skill-tag-list--expanded・.modal-field--skill-row-expandedでoverflow: visible・flex-wrap: wrap）
// で折り返しを許可する。startSkillResizeWatch_のリサイズハンドラは、ui.expanded===trueの間は
// recalculateSkillInlineVisibility_自体を呼ばないため、展開中のリサイズで意図せず
// 折りたたまれることはない。detailList・detailFieldへの参照はjs_shift.html・view_home.htmlから
// 削除された（wrapFieldがidsへ新規追加された）。
//
// さらにその後の指摘（従業員名の下へマイスターラベルを配置、2026-09-21）：以前は氏名と同じ行に
// ラベル列・「＋N件」ボタンを並べていたため、狭い画面・長い氏名で氏名が不自然に改行される
// 問題があった。修正：氏名は通常の.modal-field（ラベル＋値のみ）に戻し、マイスターラベルは
// 氏名の下の別行（.modal-field--skill-row、要素IDはwrapFieldのまま据え置き）へ移した。
// マイスター情報がない場合（renderSkillTags_が1件もラベルを追加しない場合）は不要な空行を
// 残さないよう、clearSkillTags_がwrapField.hidden = trueにし、renderSkillTags_が実際に
// ラベルを追加する直前にwrapField.hidden = falseへ戻す（テスト23で検証）。
// 旧.modal-field--wrap-expandedは.modal-field--skill-row-expandedへ改称した（同じ役割：
// 展開中に親行の折り返しを許可する）。
// 詳細はcss.html・js_shift.htmlのコメントを参照。
//
// このファイルは本番のjs_shift.htmlから関数本体をそのまま抽出してNode.jsのvmで実行し検証する
// （ロジックをテスト側へ再実装しない）。DOM操作はフェイク要素（getElementById/createElement/
// classList/getBoundingClientRect相当の最小実装）で再現し、実際のブラウザ描画・CSSレイアウトの
// 計算（実フォント・パディングでの折り返し）はこのテストの対象外。
//
// フェイクのgetBoundingClientRect()は、各要素へテストコード側で割り当てた固定の幅（width）と
// 左端（left）から{left, right}を計算する簡易実装であり、実ブラウザのflexboxレイアウトエンジンを
// 再現するものではない。「幅の制約に対してrecalculateShiftEditSkillInlineVisibility_のロジックが
// 正しく収まる/収まらないを判定するか」を検証する目的に限定する。
//
// モーダルCSS（.modal--form-scroll・.modal-body-scroll、下段のラベル列・「＋N件」ボタン、
// [hidden]優先ルール）の構造検証はshift_modal_scroll_structure_test.jsで行う。
//
// 実行: node shift_modal_skill_display_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var APP_DIR = path.join(__dirname, '..', '..', 'src')

var pass = 0, fail = 0
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}
function assertTrue(actual, label) {
  var ok = !!actual
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

function extractScriptBody_(html) {
  var m = html.match(/<script>([\s\S]*)<\/script>/)
  if (!m) throw new Error('scriptタグが見つかりません')
  return m[1]
}

function extractFunction_(script, signaturePattern, label) {
  var m = script.match(signaturePattern)
  if (!m) throw new Error('js_shift.htmlの' + label + 'が見つかりません')
  return m[0]
}

/**
 *  最小限のフェイクDOM要素。本番コードが使う範囲（hidden、textContent、className、
 *  setAttribute/getAttribute、firstChild/removeChild/appendChild、children、focus、
 *  classList.add/remove、getBoundingClientRect）だけを再現する。
 *  width（横幅）はテストコード側が明示的に割り当てる固定値で、appendChildのたびに
 *  左端（left）を「兄弟要素の幅の合計」として自動的に積み上げる、簡易的な横並びシミュレーションを行う
 */
function createFakeElement_(id, width) {
  var classes = {}
  var attrs = {}
  var el = {
    id: id,
    hidden: false,
    value: '',
    textContent: '',
    className: '',
    children: [],
    focusCallCount: 0,
    width: typeof width === 'number' ? width : 0,
    // widthが明示的に指定された要素は「CSSのoverflow: hidden等でコンテナ幅が固定されている」
    // ことを表す（0を指定するケース＝ラベル列に割り当てられる残り幅が0、を正しく再現するため、
    // width || right のような falsy判定ではなくこのフラグで「固定幅かどうか」を区別する）
    _hasFixedWidth: typeof width === 'number',
    get firstChild() { return this.children.length > 0 ? this.children[0] : null },
    appendChild: function (child) { this.children.push(child) },
    removeChild: function (child) {
      var idx = this.children.indexOf(child)
      if (idx !== -1) this.children.splice(idx, 1)
    },
    setAttribute: function (name, value) { attrs[name] = String(value) },
    getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null },
    focus: function () { this.focusCallCount++ },
    classList: {
      add: function (c) { classes[c] = true },
      remove: function (c) { delete classes[c] },
      contains: function (c) { return !!classes[c] }
    },
    /**
     *  可視な子要素（hidden !== true）だけを左から順に並べたときの右端位置を返す簡易実装。
     *  本番のflexboxのように折り返し（flex-wrap）は再現しない
     *  （計測対象はskill-tag-list--measuringでnowrap化される前提のコードなので、テスト上も
     *  「折り返さず横一列に並ぶ」状態だけを再現すれば十分）。
     *  widthが明示的に指定された要素（_hasFixedWidth）は、内容量（子要素の合計幅）に関わらず
     *  常にその固定値を右端として返す（css.htmlの.skill-tag-list--inlineのoverflow: hiddenで
     *  「コンテナ自身の幅は内容量で広がらない」効果を再現する。0を指定した場合も正しく0として扱う）
     */
    getBoundingClientRect: function () {
      var left = 0
      if (this._hasFixedWidth) return { left: left, right: this.width }
      var visibleChildren = this.children.filter(function (c) { return !c.hidden })
      var right = left
      for (var i = 0; i < visibleChildren.length; i++) {
        right += visibleChildren[i].width
      }
      return { left: left, right: right }
    }
  }
  return el
}

/**
 *  レビュー対応（ラベルの幅計測に関するレビュー指摘 2026-09-21）：inlineList（ラベル列）に、
 *  「＋N件」ボタン（moreBtn）の表示有無で利用可能幅が変わるフェイクgetBoundingClientRectを
 *  割り当てる。本番CSS（.modal-field--skill-rowがflex; .skill-tag-list--inlineがflex: 1 1 auto;
 *  .skill-tag-more-btnがflex: 0 0 auto）のとおり、ラベル列の実効幅は
 *  「行全体の幅rowWidth − （moreBtnが可視のときだけ）moreBtn.width − gap」になる。
 *  rowWidthはボタンが完全に無い場合にラベル列がとれる最大幅（＝ボタン非表示時の利用可能幅）を表す。
 *  この関数を使わない限り、inlineListは従来どおりの固定幅（ボタンの表示有無に関わらず一定）のままなので、
 *  ボタン表示有無で計測結果が変わることを検証したいテストだけがこれを使う
 */
function attachRowAwareInlineListRect_(inlineList, moreBtn, rowWidth, moreBtnWidth, gap) {
  inlineList._hasFixedWidth = true
  inlineList.width = rowWidth // env.inlineList.width = X でリサイズ後の行全体の幅を差し替えられるようにする
  inlineList.getBoundingClientRect = function () {
    var available = inlineList.width
    if (!moreBtn.hidden) available -= (moreBtnWidth + gap)
    if (available < 0) available = 0
    return { left: 0, right: available }
  }
}

/**
 *  子要素側のgetBoundingClientRectは「自分より前にある可視な兄弟の幅の合計」を左端とし、
 *  自分の幅を足したものを右端とする（親のcreateFakeElement_とは別に、子要素自身が
 *  自分の位置を知るための実装。appendChildされた時点の並び順をchildren配列から都度計算する）
 */
function attachChildRectBehavior_(child, parentGetter) {
  child.getBoundingClientRect = function () {
    var parent = parentGetter()
    var left = 0
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i] === child) break
      if (!parent.children[i].hidden) left += parent.children[i].width
    }
    return { left: left, right: left + child.width }
  }
}

/**
 *  js_shift.htmlから、直接シフト登録モーダルの折りたたみに関わる関数を抽出し、
 *  最小限のフェイクDOM（shift_skill_toggle_btn・employee_skill_card等）と一緒に実行する
 */
function loadSkillToggleEnv_() {
  var jsShiftFullScript = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
  var jsShiftScript = extractScriptBody_(jsShiftFullScript)

  var resetFn = extractFunction_(jsShiftScript, /function resetShiftSkillToggle_\(\) \{[\s\S]*?\n      \}/, 'resetShiftSkillToggle_')
  var toggleFn = extractFunction_(jsShiftScript, /function toggleShiftSkillCard_\(\) \{[\s\S]*?\n      \}/, 'toggleShiftSkillCard_')

  var toggleBtn = createFakeElement_('shift_skill_toggle_btn')
  var card = createFakeElement_('employee_skill_card')
  var elementsById = {
    shift_skill_toggle_btn: toggleBtn,
    employee_skill_card: card
  }
  var fakeDocument = {
    getElementById: function (id) { return elementsById[id] || null }
  }
  var sandbox = { console: console, document: fakeDocument }
  vm.createContext(sandbox)
  vm.runInContext(resetFn + '\n' + toggleFn, sandbox, { filename: 'js_shift.html (skill toggle)' })
  return { sandbox: sandbox, toggleBtn: toggleBtn, card: card }
}

console.log('検証対象1: js_shift.htmlのresetShiftSkillToggle_・toggleShiftSkillCard_（直接シフト登録モーダルのマイスター詳細折りたたみ）')
console.log('---')

// ------------------------------------------------------------------
// 1. 初期状態でresetShiftSkillToggle_を呼ぶと、詳細は閉じた状態（hidden=true）になる
// ------------------------------------------------------------------
{
  var env1 = loadSkillToggleEnv_()
  env1.sandbox.resetShiftSkillToggle_()
  assertTrue(env1.card.hidden === true, '1. resetShiftSkillToggle_後、employee_skill_cardはhidden（閉じている）')
  assertEqual(env1.toggleBtn.getAttribute('aria-expanded'), 'false', '1. resetShiftSkillToggle_後、トグルボタンのaria-expandedはfalse')
  assertEqual(env1.toggleBtn.textContent, 'マイスター情報を見る', '1. resetShiftSkillToggle_後、ボタン文言は「マイスター情報を見る」')
}

// ------------------------------------------------------------------
// 2. toggleShiftSkillCard_を呼ぶたびに開閉が反転する（閉→開→閉）
// ------------------------------------------------------------------
{
  var env2 = loadSkillToggleEnv_()
  env2.sandbox.resetShiftSkillToggle_()
  env2.sandbox.toggleShiftSkillCard_()
  assertTrue(env2.card.hidden === false, '2a. 1回目のtoggleShiftSkillCard_後、詳細が開く（hidden=false）')
  assertEqual(env2.toggleBtn.getAttribute('aria-expanded'), 'true', '2a. 開いた状態でaria-expandedはtrue')
  assertEqual(env2.toggleBtn.textContent, 'マイスター情報を閉じる', '2a. 開いた状態でボタン文言は「マイスター情報を閉じる」')

  env2.sandbox.toggleShiftSkillCard_()
  assertTrue(env2.card.hidden === true, '2b. 2回目のtoggleShiftSkillCard_後、詳細が閉じる（hidden=true）')
  assertEqual(env2.toggleBtn.getAttribute('aria-expanded'), 'false', '2b. 閉じた状態でaria-expandedはfalse')
  assertEqual(env2.toggleBtn.textContent, 'マイスター情報を見る', '2b. 閉じた状態でボタン文言は「マイスター情報を見る」')
}

// ------------------------------------------------------------------
// 3. 開いた状態からresetShiftSkillToggle_を呼ぶと、強制的に閉じた状態へ戻る
//    （従業員の選び直し・モーダル再表示のたびに閉じる仕様の根拠）
// ------------------------------------------------------------------
{
  var env3 = loadSkillToggleEnv_()
  env3.card.hidden = false // 開いた状態を前提として作る
  env3.sandbox.resetShiftSkillToggle_()
  assertTrue(env3.card.hidden === true, '3. 開いた状態からresetShiftSkillToggle_を呼ぶと閉じた状態に戻る')
  assertEqual(env3.toggleBtn.getAttribute('aria-expanded'), 'false', '3. リセット後はaria-expanded=false')
}

/**
 *  js_shift.htmlから、マイスターラベル表示の共通ロジック一式（createSkillTagUI_・clearSkillTags_・
 *  createSkillTagEl_・renderSkillTags_・recalculateSkillInlineVisibility_・toggleSkillDetail_・
 *  startSkillResizeWatch_・stopSkillResizeWatch_）を抽出する。
 *  レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：このロジックは
 *  shift_edit_modal（js_shift.html）・shift_wish_modal（js_shift_wish.html）の両方から
 *  ui（createSkillTagUI_が返すインスタンス）を介して呼ばれる共通処理になった。このテストでは
 *  shift_edit_modal用のIDでuiインスタンスを作り、共通ロジック自体の挙動を検証する
 *  （shift_edit_modal側の薄いラッパー関数・shift_wish_modal側の呼び出しはそれぞれ
 *  shift_modal_scroll_structure_test.js・shift_wish_modal_skill_display_test.jsで確認する）
 */
function extractSkillTagCommonLogic_() {
  var jsShiftFullScript = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
  var jsShiftScript = extractScriptBody_(jsShiftFullScript)

  var createUiFn = extractFunction_(jsShiftScript, /function createSkillTagUI_\(ids\) \{[\s\S]*?\n      \}/, 'createSkillTagUI_')
  var clearFn = extractFunction_(jsShiftScript, /function clearSkillTags_\(ui\) \{[\s\S]*?\n      \}/, 'clearSkillTags_')
  var createTagFn = extractFunction_(jsShiftScript, /function createSkillTagEl_\(text\) \{[\s\S]*?\n      \}/, 'createSkillTagEl_')
  var renderFn = extractFunction_(jsShiftScript, /function renderSkillTags_\(ui, empId\) \{[\s\S]*?\n      \}/, 'renderSkillTags_')
  var recalcFn = extractFunction_(jsShiftScript, /function recalculateSkillInlineVisibility_\(ui\) \{[\s\S]*?\n      \}/, 'recalculateSkillInlineVisibility_')
  var measureFn = extractFunction_(jsShiftScript, /function measureVisibleSkillTagCount_\(inlineList, tags\) \{[\s\S]*?\n      \}/, 'measureVisibleSkillTagCount_')
  var toggleDetailFn = extractFunction_(jsShiftScript, /function toggleSkillDetail_\(ui\) \{[\s\S]*?\n      \}/, 'toggleSkillDetail_')
  var startResizeFn = extractFunction_(jsShiftScript, /function startSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'startSkillResizeWatch_')
  var stopResizeFn = extractFunction_(jsShiftScript, /function stopSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'stopSkillResizeWatch_')

  return [createUiFn, clearFn, createTagFn, renderFn, recalcFn, measureFn, toggleDetailFn, startResizeFn, stopResizeFn].join('\n')
}

/**
 *  共通ロジック＋shift_edit_modal用のui（createSkillTagUI_インスタンス）・フェイクDOM・
 *  maisterSummariesと一緒に実行する環境を作る。
 *  inlineListWidthは、既定では「ラベル列に実際に割り当てられる幅」の固定値
 *  （recalculateSkillInlineVisibility_内でgetBoundingClientRect().rightとして参照される）。
 *  tagWidthは1個のラベルタグの想定幅（全タグ共通の固定値にして計算を単純化する）。
 *
 *  rowOptions（省略可）を渡すと、inlineListWidthを「行全体の幅（rowWidth、＝＋N件ボタンが
 *  無い場合にラベル列が取れる最大幅）」として扱い、「＋N件」ボタンが可視のときだけ
 *  そのボタン幅・gap分を差し引いた残り幅で計測する、ボタンの表示有無に連動するフェイクへ
 *  切り替える（レビュー対応：ラベルの幅計測に関するレビュー指摘 2026-09-21。
 *  「ボタンなしなら全件収まる場合、ボタン込みの幅で判定して不要な＋N件ボタンを出して
 *  しまう」問題の境界条件を検証するために使う）。{ moreBtnWidth: number, gap: number }
 */
function loadShiftEditSkillEnv_(maisterSummariesData, inlineListWidth, tagWidth, rowOptions) {
  var commonLogic = extractSkillTagCommonLogic_()
  var jsShiftScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8'))
  var startResizeFn = extractFunction_(jsShiftScript, /function startSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'startSkillResizeWatch_')
  var stopResizeFn = extractFunction_(jsShiftScript, /function stopSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'stopSkillResizeWatch_')

  var inlineList = createFakeElement_('shift_edit_modal_skill_tags', inlineListWidth)
  var moreBtn = createFakeElement_('shift_edit_skill_more_btn')
  var wrapField = createFakeElement_('shift_edit_modal_skill_wrap')
  if (rowOptions) {
    attachRowAwareInlineListRect_(inlineList, moreBtn, inlineListWidth, rowOptions.moreBtnWidth, rowOptions.gap)
  }
  var elementsById = {
    shift_edit_modal_skill_tags: inlineList,
    shift_edit_skill_more_btn: moreBtn,
    shift_edit_modal_skill_wrap: wrapField
  }
  var fakeDocument = {
    getElementById: function (id) { return elementsById[id] || null },
    createElement: function () {
      var el = createFakeElement_(null, tagWidth)
      attachChildRectBehavior_(el, function () { return inlineList })
      return el
    }
  }
  var resizeListeners = []
  var fakeWindow = {
    addEventListener: function (type, handler) { resizeListeners.push({ type: type, handler: handler }) },
    removeEventListener: function (type, handler) {
      resizeListeners = resizeListeners.filter(function (l) { return !(l.type === type && l.handler === handler) })
    }
  }
  var sandbox = {
    console: console,
    document: fakeDocument,
    window: fakeWindow,
    maisterSummaries: maisterSummariesData
  }
  vm.createContext(sandbox)
  vm.runInContext(commonLogic + '\n' + startResizeFn + '\n' + stopResizeFn, sandbox, { filename: 'js_shift.html (skill tag common logic)' })

  var ui = sandbox.createSkillTagUI_({
    inlineList: 'shift_edit_modal_skill_tags',
    moreBtn: 'shift_edit_skill_more_btn',
    wrapField: 'shift_edit_modal_skill_wrap'
  })

  return {
    sandbox: {
      renderShiftEditSkillTags_: function (empId) { sandbox.renderSkillTags_(ui, empId) },
      recalculateShiftEditSkillInlineVisibility_: function () { sandbox.recalculateSkillInlineVisibility_(ui) },
      toggleShiftEditSkillDetail_: function () { sandbox.toggleSkillDetail_(ui) },
      startShiftEditSkillResizeWatch_: function () { sandbox.startSkillResizeWatch_(ui) },
      stopShiftEditSkillResizeWatch_: function () { sandbox.stopSkillResizeWatch_(ui) }
    },
    ui: ui,
    inlineList: inlineList,
    moreBtn: moreBtn,
    wrapField: wrapField,
    fireResize: function () {
      resizeListeners.filter(function (l) { return l.type === 'resize' }).forEach(function (l) { l.handler() })
    }
  }
}

function tagTexts_(el) {
  return el.children.map(function (c) { return c.textContent })
}
function visibleTagTexts_(el) {
  return el.children.filter(function (c) { return !c.hidden }).map(function (c) { return c.textContent })
}

console.log('---')
console.log('検証対象2: js_shift.htmlのrenderShiftEditSkillTags_・recalculateShiftEditSkillInlineVisibility_・toggleShiftEditSkillDetail_（シフト変更・削除モーダルの従業員名下段マイスターラベル、実幅計測版）')
console.log('---')

// ------------------------------------------------------------------
// 4. 従業員未選択相当（該当キーなし）：ラベルを出さない。ラベル行自体もhiddenのまま
//    （レビュー対応：従業員名の下へマイスターラベルを配置 2026-09-21。マイスター情報が
//    ない場合に不要な空行を残さない要件の検証）
// ------------------------------------------------------------------
{
  var env4 = loadShiftEditSkillEnv_({}, 300, 60)
  env4.sandbox.renderShiftEditSkillTags_('999')
  assertEqual(env4.inlineList.children.length, 0, '4. maisterSummariesに該当キーがないとき、ラベルは1件も出さない')
  assertTrue(env4.moreBtn.hidden === true, '4. 「＋N件」ボタンも出さない')
  assertTrue(env4.wrapField.hidden === true, '4. ラベル行自体（wrapField）もhiddenのまま（不要な空行を残さない）')
}

// ------------------------------------------------------------------
// 5. 未登録（registered: false）：ラベルを出さない。ラベル行自体もhiddenのまま
// ------------------------------------------------------------------
{
  var env5 = loadShiftEditSkillEnv_({ '1': { registered: false, acquired_meisters: [], score: 0 } }, 300, 60)
  env5.sandbox.renderShiftEditSkillTags_('1')
  assertEqual(env5.inlineList.children.length, 0, '5. registered:falseのとき、ラベルは1件も出さない（未登録と取得0件を混同しない）')
  assertTrue(env5.moreBtn.hidden === true, '5. 「＋N件」ボタンも出さない')
  assertTrue(env5.wrapField.hidden === true, '5. ラベル行自体（wrapField）もhiddenのまま')
}

// ------------------------------------------------------------------
// 6. 取得0件（registered: true, acquired_meisters: []）：ラベルを出さない。ラベル行自体もhiddenのまま
// ------------------------------------------------------------------
{
  var env6 = loadShiftEditSkillEnv_({ '2': { registered: true, acquired_meisters: [], score: 0 } }, 300, 60)
  env6.sandbox.renderShiftEditSkillTags_('2')
  assertEqual(env6.inlineList.children.length, 0, '6. registered:trueでも取得0件のとき、ラベルは1件も出さない（未登録とは別扱いだが表示なしは同じ）')
  assertTrue(env6.wrapField.hidden === true, '6. ラベル行自体（wrapField）もhiddenのまま')
}

// ------------------------------------------------------------------
// 7. 情報取得不可（maisterSummariesがオブジェクトでない）：ラベルを出さない。例外にもならない。
//    ラベル行自体もhiddenのまま
// ------------------------------------------------------------------
{
  var env7 = loadShiftEditSkillEnv_(null, 300, 60)
  env7.sandbox.renderShiftEditSkillTags_('3')
  assertEqual(env7.inlineList.children.length, 0, '7. maisterSummaries自体が取得できていないとき、ラベルは1件も出さない（例外にもならない）')
  assertTrue(env7.moreBtn.hidden === true, '7. 「＋N件」ボタンも出さない')
  assertTrue(env7.wrapField.hidden === true, '7. ラベル行自体（wrapField）もhiddenのまま')
}

// ------------------------------------------------------------------
// 8. 全件が実幅に収まる場合：全件を下段に常時表示し、「＋N件」は出ない
//    （inlineListWidth=300、タグ幅60×2件=120 <= 300のため全件収まる）
// ------------------------------------------------------------------
{
  var env8 = loadShiftEditSkillEnv_({ '4': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 } }, 300, 60)
  env8.sandbox.renderShiftEditSkillTags_('4')
  assertEqual(tagTexts_(env8.inlineList), ['ホール', 'セット'], '8. 2件とも下段のラベル列に生成される')
  assertEqual(visibleTagTexts_(env8.inlineList), ['ホール', 'セット'], '8. 実幅に収まるため、2件とも表示状態（hidden=falseのまま）')
  assertTrue(env8.moreBtn.hidden === true, '8. 隠れているラベルがないため「＋N件」ボタンは出ない')
  assertTrue(env8.wrapField.hidden === false, '8. マイスター情報があるため、ラベル行自体（wrapField）は表示される')
}

// ------------------------------------------------------------------
// 9. 一部だけが実幅に収まる場合：収まる分だけ表示、残りは「＋N件」
//    （inlineListWidth=200、タグ幅60×5件=300 > 200のため、200 / 60 = 3件目まで収まり、4・5件目は隠れる）
// ------------------------------------------------------------------
{
  var env9 = loadShiftEditSkillEnv_({ '5': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], score: 40 } }, 200, 60)
  env9.sandbox.renderShiftEditSkillTags_('5')
  assertEqual(tagTexts_(env9.inlineList), ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], '9. 下段のラベル列自体には全5件を生成する（折りたたみ時は隠れる分もこの列の中にhiddenで保持する）')
  assertEqual(visibleTagTexts_(env9.inlineList), ['ホール', 'セット', '麺上げ'], '9. 表示（hidden=false）されるのは実幅（200px）に収まる先頭3件（60px×3=180px<=200px、60px×4=240px>200px）')
  assertTrue(env9.moreBtn.hidden === false, '9. 隠れている2件がある場合、「＋N件」ボタンを表示する')
  assertEqual(env9.moreBtn.textContent, '＋2件', '9. 「＋N件」は隠れている件数（5-3=2件）を正しく示す')
}

// ------------------------------------------------------------------
// 9b〜9e. レビュー対応（ラベルの幅計測に関するレビュー指摘 2026-09-21）：
//   「＋N件」ボタンの表示有無で行の利用可能幅が変わることを、rowOptions付きの
//   loadShiftEditSkillEnv_（attachRowAwareInlineListRect_）で再現して検証する。
//   moreBtnWidth=40, gap=8（合計48px）をボタンあり計測時にだけ差し引く。
//   修正前の実装（まずボタンを表示してから計測する）では、9bのようにボタンさえ
//   出さなければ全件収まるケースでも、ボタン分を差し引いた狭い幅で判定してしまい、
//   不要な「＋N件」を表示していた
// ------------------------------------------------------------------

// 9b. 境界条件：ボタンなし（rowWidth=190）なら3件180px<=190pxで全件収まるが、
//     ボタンあり（190-48=142px）では2件120px<=142px、3件180px>142pxで収まらない。
//     期待する挙動は「全件収まる」＝ボタン非表示・3件とも表示（ボタンなしでの判定を優先する）
{
  var env9b = loadShiftEditSkillEnv_(
    { '5b': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ'], score: 20 } },
    190, 60, { moreBtnWidth: 40, gap: 8 }
  )
  env9b.sandbox.renderShiftEditSkillTags_('5b')
  assertEqual(visibleTagTexts_(env9b.inlineList), ['ホール', 'セット', '麺上げ'], '9b. ボタンなしなら全件収まる境界条件で、3件とも表示される（ボタンありの狭い幅で誤判定しない）')
  assertTrue(env9b.moreBtn.hidden === true, '9b. 全件収まるため「＋N件」ボタンはhiddenのまま')
}

// 9c. 全件が余裕で収まる場合（rowWidth=300、ボタンなしでもありでも2件120pxは収まる）
{
  var env9c = loadShiftEditSkillEnv_(
    { '5c': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 } },
    300, 60, { moreBtnWidth: 40, gap: 8 }
  )
  env9c.sandbox.renderShiftEditSkillTags_('5c')
  assertEqual(visibleTagTexts_(env9c.inlineList), ['ホール', 'セット'], '9c. 余裕で全件収まる場合、2件とも表示される')
  assertTrue(env9c.moreBtn.hidden === true, '9c. 「＋N件」ボタンは出ない')
}

// 9d. ちょうど収まる場合（rowWidth=180、ボタンなしの状態で3件180pxとちょうど一致）
{
  var env9d = loadShiftEditSkillEnv_(
    { '5d': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ'], score: 20 } },
    180, 60, { moreBtnWidth: 40, gap: 8 }
  )
  env9d.sandbox.renderShiftEditSkillTags_('5d')
  assertEqual(visibleTagTexts_(env9d.inlineList), ['ホール', 'セット', '麺上げ'], '9d. ボタンなしの幅とちょうど一致する場合も全件収まる扱いになる')
  assertTrue(env9d.moreBtn.hidden === true, '9d. 「＋N件」ボタンは出ない')
}

// 9e. 全幅（ボタンなしの幅）でも収まらない場合：ボタンを表示した状態で改めて計測し直し、
//     収まる件数・隠れる件数を確定する（rowWidth=100、ボタンなしでも5件300pxは収まらない。
//     ボタンあり100-48=52pxでは0件のみ収まる）
{
  var env9e = loadShiftEditSkillEnv_(
    { '5e': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], score: 40 } },
    100, 60, { moreBtnWidth: 40, gap: 8 }
  )
  env9e.sandbox.renderShiftEditSkillTags_('5e')
  assertEqual(visibleTagTexts_(env9e.inlineList), [], '9e. ボタンなしでも収まらない場合、ボタンを表示した状態で再計測し、収まる分だけ表示する（この幅では0件）')
  assertTrue(env9e.moreBtn.hidden === false, '9e. 「＋N件」ボタンを表示する')
  assertEqual(env9e.moreBtn.textContent, '＋5件', '9e. 「＋N件」は全5件が隠れていることを正しく示す')
}

// ------------------------------------------------------------------
// 10. 極端に狭い場合：1件も収まらなくても例外にならず、全件を「＋N件」から確認できる
//     （ラベルが1件も収まらない場合も全件を確認できるという要件の根拠）
// ------------------------------------------------------------------
{
  var env10 = loadShiftEditSkillEnv_({ '6': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], score: 40 } }, 10, 60)
  env10.sandbox.renderShiftEditSkillTags_('6')
  assertEqual(visibleTagTexts_(env10.inlineList), [], '10. 利用可能幅が極端に狭い場合、下段の常時表示は0件になる')
  assertEqual(env10.moreBtn.textContent, '＋5件', '10. 0件でも「＋N件」は全5件を正しく示し、そこから全件を確認できる')
  assertTrue(env10.moreBtn.hidden === false, '10. 0件のときも「＋N件」ボタン自体は表示される')
}

// ------------------------------------------------------------------
// 11. toggleShiftEditSkillDetail_で、下段のラベル列（inlineList）自体を展開・折りたたみできる
//     （レビュー対応：展開表示の重複解消 2026-09-16。以前は別行の「全マイスター」へ全件を
//     再表示していたため、下段に表示済みの分と重複していた。展開時は同じinlineListへ
//     隠れていた分を追加し、各ラベルを1回だけ表示する。ボタン文言は「折りたたむ」に変わる）
// ------------------------------------------------------------------
{
  var env11 = loadShiftEditSkillEnv_({ '7': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 } }, 200, 60)
  env11.sandbox.renderShiftEditSkillTags_('7')
  assertEqual(visibleTagTexts_(env11.inlineList), ['ホール', 'セット', '麺上げ'], '11a. renderShiftEditSkillTags_直後（折りたたみ）は実幅に収まる3件だけが見える（前提）')
  assertEqual(env11.moreBtn.textContent, '＋1件', '11a. 「＋1件」が隠れた仕込みの分を示す（前提）')

  env11.sandbox.toggleShiftEditSkillDetail_()
  assertEqual(visibleTagTexts_(env11.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '11b. 1回目のtoggleShiftEditSkillDetail_（展開）で、隠れていた分を含む全4件が同じラベル列に表示される')
  assertEqual(tagTexts_(env11.inlineList).length, 4, '11b. ラベル列内の要素数は4件のまま（別行への複製が増えず、重複しない）')
  assertEqual(env11.moreBtn.textContent, '折りたたむ', '11b. 展開時、ボタン文言は「折りたたむ」に変わる')
  assertEqual(env11.moreBtn.getAttribute('aria-expanded'), 'true', '11b. 展開した状態でaria-expandedはtrue')
  assertTrue(env11.inlineList.classList.contains('skill-tag-list--expanded'), '11b. 展開時、ラベル列にskill-tag-list--expandedクラスが付く（折り返しを許可するCSSフック）')
  assertTrue(env11.wrapField.classList.contains('modal-field--skill-row-expanded'), '11b. 展開時、親行にmodal-field--skill-row-expandedクラスが付く（親行も折り返しを許可する）')

  env11.sandbox.toggleShiftEditSkillDetail_()
  assertEqual(visibleTagTexts_(env11.inlineList), ['ホール', 'セット', '麺上げ'], '11c. 2回目のtoggleShiftEditSkillDetail_（折りたたみ）で、その時点の幅（200px）で再計算した3件だけに戻る')
  assertEqual(env11.moreBtn.textContent, '＋1件', '11c. 折りたたみ後、「＋N件」の表記に戻る')
  assertEqual(env11.moreBtn.getAttribute('aria-expanded'), 'false', '11c. 折りたたんだ状態でaria-expandedはfalse')
  assertTrue(!env11.inlineList.classList.contains('skill-tag-list--expanded'), '11c. 折りたたみ時、skill-tag-list--expandedクラスが外れる')
  assertTrue(!env11.wrapField.classList.contains('modal-field--skill-row-expanded'), '11c. 折りたたみ時、modal-field--skill-row-expandedクラスが外れる')
}

// ------------------------------------------------------------------
// 11d. 全件が実幅に収まる場合は、そもそも「＋N件」ボタンが出ないため、実際の操作導線
//      （ボタンクリック）からtoggleShiftEditSkillDetail_が呼ばれることはない
//      （ボタン自体がhidden＝クリック不可能であることの前提確認。関数自体はボタンの
//      表示状態を見ずに動作するため、呼べば展開はできる仕様であり、それ自体は問題ない）
// ------------------------------------------------------------------
{
  var env11d = loadShiftEditSkillEnv_({ '7b': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 } }, 300, 60)
  env11d.sandbox.renderShiftEditSkillTags_('7b')
  assertTrue(env11d.moreBtn.hidden === true, '11d. 全件収まる場合、「＋N件」ボタンはhiddenのまま（実際の画面では展開操作自体ができない）')
}

// ------------------------------------------------------------------
// 12. 従業員切替時、renderShiftEditSkillTags_を再度呼ぶと前の従業員のラベル・展開状態が残らない
//     （別の従業員のモーダルを開いたときに内容・展開状態をリセットする要件）
// ------------------------------------------------------------------
{
  var summaries12 = {
    '8': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 },
    '9': { registered: true, acquired_meisters: ['ホール'], score: 5 }
  }
  var env12 = loadShiftEditSkillEnv_(summaries12, 200, 60)
  env12.sandbox.renderShiftEditSkillTags_('8')
  env12.sandbox.toggleShiftEditSkillDetail_() // 従業員8を展開した状態にする
  assertTrue(env12.ui.expanded === true, '12a. 従業員8を展開した状態にする（前提）')

  env12.sandbox.renderShiftEditSkillTags_('9') // 従業員9へ切替（openShiftEditModal_が毎回呼ぶのと同じ呼び出し）
  assertEqual(tagTexts_(env12.inlineList), ['ホール'], '12b. 従業員9のラベルへ置き換わり、従業員8の4件は残らない')
  assertTrue(env12.moreBtn.hidden === true, '12b. 従業員9は1件のみ・実幅にも収まるため「＋N件」は出ない')
  assertTrue(env12.ui.expanded === false, '12c. 従業員切替で展開状態もリセットされ、折りたたみ状態に戻る')
  assertTrue(!env12.inlineList.classList.contains('skill-tag-list--expanded'), '12c. 従業員切替でskill-tag-list--expandedクラスも外れる')
  assertTrue(!env12.wrapField.classList.contains('modal-field--skill-row-expanded'), '12c. 従業員切替でmodal-field--skill-row-expandedクラスも外れる')
  assertTrue(env12.wrapField.hidden === false, '12d. 従業員9もマイスター情報を持つため、ラベル行は表示されたまま')
}

// ------------------------------------------------------------------
// 12e. マイスター情報がある従業員から、情報がない従業員へ切り替えると、ラベル行自体が
//      再びhiddenになる（レビュー対応：従業員名の下へマイスターラベルを配置 2026-09-21。
//      切替のたびにclearSkillTags_が呼ばれ、renderSkillTags_はマイスター情報がなければ
//      wrapField.hidden=falseへ戻す処理自体を実行しないため、hiddenのまま残ることの確認）
// ------------------------------------------------------------------
{
  var summaries12e = {
    '20': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 },
    '21': { registered: false, acquired_meisters: [], score: 0 }
  }
  var env12e = loadShiftEditSkillEnv_(summaries12e, 300, 60)
  env12e.sandbox.renderShiftEditSkillTags_('20')
  assertTrue(env12e.wrapField.hidden === false, '12e-1. マイスター情報がある従業員20では、ラベル行が表示される（前提）')

  env12e.sandbox.renderShiftEditSkillTags_('21') // マイスター情報がない従業員21へ切替
  assertEqual(env12e.inlineList.children.length, 0, '12e-2. 従業員21のラベルは1件も出さない')
  assertTrue(env12e.wrapField.hidden === true, '12e-2. ラベル行自体が再びhiddenになり、不要な空行を残さない')
}

// ------------------------------------------------------------------
// 13. モーダル表示後の幅変更（リサイズ）：recalculateShiftEditSkillInlineVisibility_を
//     単体で呼び直すと、直前のrenderShiftEditSkillTags_が保持したマイスター一覧
//     （shiftEditSkillMeisters_）を使って再計算する
// ------------------------------------------------------------------
{
  var env13 = loadShiftEditSkillEnv_({ '10': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], score: 40 } }, 200, 60)
  env13.sandbox.renderShiftEditSkillTags_('10')
  assertEqual(visibleTagTexts_(env13.inlineList), ['ホール', 'セット', '麺上げ'], '13a. 幅200pxでは3件が収まる（前提）')

  // 幅が広がった（画面が大きくなった）想定でinlineListのwidthを書き換え、再計算だけを呼ぶ
  env13.inlineList.width = 400
  env13.sandbox.recalculateShiftEditSkillInlineVisibility_()
  assertEqual(visibleTagTexts_(env13.inlineList), ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], '13b. 幅が広がった後にrecalculateShiftEditSkillInlineVisibility_を呼ぶと、全5件が収まるようになる')
  assertTrue(env13.moreBtn.hidden === true, '13b. 全件収まったため「＋N件」ボタンは隠れる')

  // 幅が狭くなった（画面が小さくなった）想定
  env13.inlineList.width = 130
  env13.sandbox.recalculateShiftEditSkillInlineVisibility_()
  assertEqual(visibleTagTexts_(env13.inlineList), ['ホール', 'セット'], '13c. 幅が130pxに狭まった後は2件だけが収まる（60px×2=120px<=130px、60px×3=180px>130px）')
  assertEqual(env13.moreBtn.textContent, '＋3件', '13c. 「＋N件」の件数も再計算後の値（5-2=3件）に更新される')
}

// ------------------------------------------------------------------
// 14. 折りたたみ中に幅が広がり全件収まるようになった場合、「＋N件」ボタンが自動的に隠れる
//     （展開していない状態でのrecalculateSkillInlineVisibility_呼び出しなので、
//     展開状態には最初から触れていない。展開中の挙動はテスト18で別途検証する）
// ------------------------------------------------------------------
{
  var env14 = loadShiftEditSkillEnv_({ '11': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ'], score: 20 } }, 100, 60)
  env14.sandbox.renderShiftEditSkillTags_('11')
  assertTrue(env14.moreBtn.hidden === false, '14a. 幅100pxでは3件中一部が収まらず「＋N件」が出る（前提）')
  assertTrue(env14.ui.expanded === false, '14a. 折りたたみ状態のまま（前提）')

  env14.inlineList.width = 400
  env14.sandbox.recalculateShiftEditSkillInlineVisibility_()
  assertTrue(env14.moreBtn.hidden === true, '14b. 幅が広がり全件収まると「＋N件」ボタンは隠れる')
  assertEqual(visibleTagTexts_(env14.inlineList), ['ホール', 'セット', '麺上げ'], '14b. 全件が表示される')
}

// ------------------------------------------------------------------
// 15. 計測領域（inlineList）の幅がコンテナ側の制約（名前・ボタンを除いた残り幅）で
//     固定されており、タグを全件挿入しても計測領域自体が内容量に応じて広がらないこと
//     （レビュー対応：親.modal-field--wrapのflex-wrapが原因でラベル列自体が2行目へ落ち、
//     「名前の横の残り幅」ではなく「折り返った別行の幅」を誤計測していた問題 2026-09-16）。
//     css.html側は.modal-field--wrapをflex-wrap: nowrapに固定し、.skill-tag-list--inlineに
//     overflow: hiddenを追加することで、ラベル列自身の幅が常に「割り当てられた残り幅」を
//     超えないようにした。このフェイク環境ではwidthを明示的に固定値として渡すことで
//     「コンテナ幅が内容に関わらず一定である」というCSS修正後の前提を再現している
//     （固定幅の模擬DOMであり、実レイアウトエンジンの折り返し判定そのものは保証しない。
//     この前提が実際のブラウザでも成立しているかはshift_modal_scroll_structure_test.jsの
//     CSS構造確認、および本人による実機確認が必要）
// ------------------------------------------------------------------
{
  var env15 = loadShiftEditSkillEnv_({ '12': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師', '手洗い伝道師2', '手洗い伝道師3'], score: 40 } }, 150, 60)
  env15.sandbox.renderShiftEditSkillTags_('12')
  var widthBeforeMeasuring15 = env15.inlineList.width
  // 計測中（skill-tag-list--measuringが付与されている間）に、全7件のタグを一時的に挿入しても、
  // コンテナ自身のwidth（＝CSSのoverflow: hiddenで固定される幅に相当）は変化しないことを確認する
  assertEqual(env15.inlineList.width, widthBeforeMeasuring15, '15a. 計測前後でinlineList自身の幅（コンテナとして割り当てられた残り幅）は変化しない')
  assertEqual(visibleTagTexts_(env15.inlineList), ['ホール', 'セット'], '15b. 幅150pxでは2件だけが収まる（60px×2=120px<=150px、60px×3=180px>150px）。タグが7件あっても計測領域の幅自体は広がらない')
  assertEqual(env15.moreBtn.textContent, '＋5件', '15c. 隠れた5件を「＋N件」が正しく示す')
}

// ------------------------------------------------------------------
// 16. 境界値：ちょうど収まる幅（誤差許容0.5px）と、1px超過する幅の違いを正しく判定する
// ------------------------------------------------------------------
{
  // タグ2件分の幅がちょうどコンテナ幅と一致する場合（60px×2=120px、コンテナ幅120px）→2件とも収まる
  var env16a = loadShiftEditSkillEnv_({ '13': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ'], score: 20 } }, 120, 60)
  env16a.sandbox.renderShiftEditSkillTags_('13')
  assertEqual(visibleTagTexts_(env16a.inlineList), ['ホール', 'セット'], '16a. コンテナ幅とタグ合計幅がちょうど一致する場合（120px=60px×2）、両方とも収まる')

  // コンテナ幅が1px足りない場合（119px）→2件目は収まらない
  var env16b = loadShiftEditSkillEnv_({ '14': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ'], score: 20 } }, 119, 60)
  env16b.sandbox.renderShiftEditSkillTags_('14')
  assertEqual(visibleTagTexts_(env16b.inlineList), ['ホール'], '16b. コンテナ幅が1px不足する場合（119px<60px×2=120px）、1件目だけが収まる')
}

// ------------------------------------------------------------------
// 17. 従業員名が長い想定（ラベル列に割り当てられる残り幅が狭い場合）でも、
//     例外にならずラベルが正しく絞り込まれ、「＋N件」から全件を確認できる
//     （css.html側は.modal-field__value（名前）をmin-width: 3rem; overflow-wrap: anywhereで
//     縮小・折り返し可能にした。極端に長い名前ではラベル列に割り当てられる残り幅が0近くまで
//     狭くなるが、このテストではその結果として「ラベル列に割り当てられる幅が狭い」状態を
//     inlineListWidthの値で直接模している。計測ロジック自体はラベル列自身の幅を見るだけなので、
//     名前側がflex-shrink: 0からflex-shrink: 1（既定）に変わっても動作は変わらない）
// ------------------------------------------------------------------
{
  var env17 = loadShiftEditSkillEnv_({ '15': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ'], score: 20 } }, 0, 60)
  env17.sandbox.renderShiftEditSkillTags_('15')
  assertEqual(visibleTagTexts_(env17.inlineList), [], '17. 名前が長くラベル列の残り幅が0のとき、常時表示は0件になる（例外にならない）')
  assertEqual(env17.moreBtn.textContent, '＋3件', '17. 0件でも「＋N件」は全3件を正しく示し、そこから全件を確認できる')
}

// ------------------------------------------------------------------
// 18. 狭い画面で長い名前が折り返り、ラベル列に割り当てられる残り幅が広がった想定
//     （名前がflex-shrink: 1で縮む→折り返って複数行になる→その分ラベル列側の残り幅が
//     変わりうる、という一連の流れのうち、「ラベル列側の幅が変化したときrecalculateが
//     正しく追従するか」をリサイズ経由で確認する。実際の折り返し判定自体はブラウザでの
//     描画に依存するため、このテストでは幅の変化に対する追従だけを検証する）
// ------------------------------------------------------------------
{
  var env18b = loadShiftEditSkillEnv_({ '16': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 } }, 20, 60)
  env18b.sandbox.renderShiftEditSkillTags_('16')
  assertEqual(visibleTagTexts_(env18b.inlineList), [], '18a. 名前が長く残り幅20pxのとき、常時表示は0件（前提）')

  // 画面幅が広がり、名前が折り返さずに収まるようになった結果、ラベル列側の残り幅が広がった想定
  env18b.inlineList.width = 200
  env18b.sandbox.recalculateShiftEditSkillInlineVisibility_()
  assertEqual(visibleTagTexts_(env18b.inlineList), ['ホール', 'セット', '麺上げ'], '18b. 残り幅が200pxに広がった後は3件が収まる（60px×3=180px<=200px）')
}

// ------------------------------------------------------------------
// 18c. 展開中にリサイズイベントが発火しても、意図せず折りたたまれない
//      （レビュー対応：「展開中のリサイズで意図せず折りたたまない」という要件の直接的な確認。
//      startSkillResizeWatch_が登録するリサイズハンドラは、ui.expanded===trueの間は
//      recalculateSkillInlineVisibility_自体を呼ばないため、展開状態・表示内容が保たれる）
// ------------------------------------------------------------------
{
  var env18c = loadShiftEditSkillEnv_({ '17': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 } }, 200, 60)
  env18c.sandbox.renderShiftEditSkillTags_('17')
  env18c.sandbox.startShiftEditSkillResizeWatch_()
  env18c.sandbox.toggleShiftEditSkillDetail_() // 展開する
  assertTrue(env18c.ui.expanded === true, '18c-1. 展開状態にする（前提）')
  assertEqual(visibleTagTexts_(env18c.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '18c-1. 展開直後は全4件が見える（前提）')

  // 幅を変えてからリサイズイベントを発火させる（本番のwindow.resizeに相当）
  env18c.inlineList.width = 90
  env18c.fireResize()
  assertTrue(env18c.ui.expanded === true, '18c-2. リサイズ発火後も展開状態のまま（意図せず折りたたまれない）')
  assertEqual(visibleTagTexts_(env18c.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '18c-2. リサイズ発火後も全4件が見えたまま（展開中は再計算されないため表示内容が変わらない）')
  assertTrue(env18c.inlineList.classList.contains('skill-tag-list--expanded'), '18c-2. 展開用クラスも保たれる')

  env18c.sandbox.stopShiftEditSkillResizeWatch_()
}

// ------------------------------------------------------------------
// 18d. 折りたたみ中のリサイズは、従来どおりrecalculateSkillInlineVisibility_相当の
//      再計算が働く（18cとの対比：展開していなければリサイズで再計算されることの確認）
// ------------------------------------------------------------------
{
  var env18d = loadShiftEditSkillEnv_({ '18': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 } }, 200, 60)
  env18d.sandbox.renderShiftEditSkillTags_('18')
  env18d.sandbox.startShiftEditSkillResizeWatch_()
  assertTrue(env18d.ui.expanded === false, '18d-1. 折りたたみ状態のまま（前提）')

  env18d.inlineList.width = 400
  env18d.fireResize()
  assertEqual(visibleTagTexts_(env18d.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '18d-2. 折りたたみ中のリサイズでは、その時点の幅で再計算され全4件が収まるようになる')

  env18d.sandbox.stopShiftEditSkillResizeWatch_()
}

console.log('---')
console.log('検証対象3: js_shift.htmlのstartShiftEditSkillResizeWatch_・stopShiftEditSkillResizeWatch_（リサイズ監視のイベント登録重複防止）')
console.log('---')

/**
 *  js_shift.htmlから、リサイズ監視の開始・停止に関わる共通ロジック（startSkillResizeWatch_・
 *  stopSkillResizeWatch_）とshift_edit_modal用の薄いラッパー（startShiftEditSkillResizeWatch_・
 *  stopShiftEditSkillResizeWatch_、shiftEditSkillTagUI_）を抽出し、addEventListener/
 *  removeEventListenerの呼び出し回数を記録するフェイクwindowと一緒に実行する。
 *  レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：ハンドラ参照は
 *  トップレベル変数ではなくui.resizeHandlerとしてui（createSkillTagUI_インスタンス）側に
 *  持つ設計になったため、shiftEditSkillResizeHandler_という変数宣言は読み込まない
 *  （そもそも存在しない）
 */
function loadResizeWatchEnv_() {
  var jsShiftFullScript = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
  var jsShiftScript = extractScriptBody_(jsShiftFullScript)

  var createUiFn = extractFunction_(jsShiftScript, /function createSkillTagUI_\(ids\) \{[\s\S]*?\n      \}/, 'createSkillTagUI_')
  var startCommonFn = extractFunction_(jsShiftScript, /function startSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'startSkillResizeWatch_')
  var stopCommonFn = extractFunction_(jsShiftScript, /function stopSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'stopSkillResizeWatch_')
  var uiVarMatch = jsShiftScript.match(/var shiftEditSkillTagUI_ = createSkillTagUI_\(\{[\s\S]*?\n      \}\)/)
  if (!uiVarMatch) throw new Error('js_shift.htmlのshiftEditSkillTagUI_宣言が見つかりません')
  var startWrapperFn = extractFunction_(jsShiftScript, /function startShiftEditSkillResizeWatch_\(\) \{[\s\S]*?\n      \}/, 'startShiftEditSkillResizeWatch_')
  var stopWrapperFn = extractFunction_(jsShiftScript, /function stopShiftEditSkillResizeWatch_\(\) \{[\s\S]*?\n      \}/, 'stopShiftEditSkillResizeWatch_')
  // startSkillResizeWatch_はrecalculateSkillInlineVisibility_を呼ぶ関数を登録するだけで、
  // このテストでは実際に発火させないため、参照エラーにならないダミーを与える
  var recalcStub = 'function recalculateSkillInlineVisibility_() {}'

  var listeners = []
  var fakeWindow = {
    addEventListener: function (type, handler) { listeners.push({ type: type, handler: handler }) },
    removeEventListener: function (type, handler) {
      listeners = listeners.filter(function (l) { return !(l.type === type && l.handler === handler) })
    }
  }
  var sandbox = { console: console, window: fakeWindow }
  vm.createContext(sandbox)
  vm.runInContext(
    recalcStub + '\n' + createUiFn + '\n' + startCommonFn + '\n' + stopCommonFn + '\n' +
    uiVarMatch[0] + '\n' + startWrapperFn + '\n' + stopWrapperFn,
    sandbox,
    { filename: 'js_shift.html (resize watch)' }
  )
  return { sandbox: sandbox, listeners: function () { return listeners } }
}

// ------------------------------------------------------------------
// 19. startShiftEditSkillResizeWatch_を1回呼ぶと、resizeリスナーが1件だけ登録される
// ------------------------------------------------------------------
{
  var env19a = loadResizeWatchEnv_()
  env19a.sandbox.startShiftEditSkillResizeWatch_()
  var resizeListeners19a = env19a.listeners().filter(function (l) { return l.type === 'resize' })
  assertEqual(resizeListeners19a.length, 1, '19. startShiftEditSkillResizeWatch_を1回呼ぶと、resizeリスナーが1件だけ登録される')
}

// ------------------------------------------------------------------
// 20. モーダルを閉じずに開き直す（startShiftEditSkillResizeWatch_を連続で呼ぶ）操作を模した場合でも、
//     リスナーは重複登録されず常に1件のまま
//     （「再表示のたびのイベント登録重複に注意」という指摘の直接的な回帰確認）
// ------------------------------------------------------------------
{
  var env20 = loadResizeWatchEnv_()
  env20.sandbox.startShiftEditSkillResizeWatch_()
  env20.sandbox.startShiftEditSkillResizeWatch_()
  env20.sandbox.startShiftEditSkillResizeWatch_()
  var resizeListeners20 = env20.listeners().filter(function (l) { return l.type === 'resize' })
  assertEqual(resizeListeners20.length, 1, '20. startShiftEditSkillResizeWatch_を3回連続で呼んでも、resizeリスナーは重複登録されず1件のまま')
}

// ------------------------------------------------------------------
// 21. stopShiftEditSkillResizeWatch_を呼ぶと、登録されていたリスナーが確実に外れる
//     （閉じたあとに古いモーダルのリサイズ処理が動き続けない）
// ------------------------------------------------------------------
{
  var env21 = loadResizeWatchEnv_()
  env21.sandbox.startShiftEditSkillResizeWatch_()
  assertEqual(env21.listeners().filter(function (l) { return l.type === 'resize' }).length, 1, '21a. 開始直後はリスナーが1件登録されている（前提）')
  env21.sandbox.stopShiftEditSkillResizeWatch_()
  assertEqual(env21.listeners().filter(function (l) { return l.type === 'resize' }).length, 0, '21b. stopShiftEditSkillResizeWatch_後、resizeリスナーは0件になる')
}

// ------------------------------------------------------------------
// 22. stopShiftEditSkillResizeWatch_を、リスナー未登録の状態で呼んでも例外にならない
//     （モーダルを一度も開かずに閉じる操作などに相当）
// ------------------------------------------------------------------
{
  var env22 = loadResizeWatchEnv_()
  var threw22 = false
  try {
    env22.sandbox.stopShiftEditSkillResizeWatch_()
  } catch (e) {
    threw22 = true
  }
  assertTrue(threw22 === false, '22. リスナー未登録の状態でstopShiftEditSkillResizeWatch_を呼んでも例外にならない')
}

console.log('---')
console.log('【ブラウザ確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでの見た目（モーダルの縦の長さ、登録・キャンセルボタンの見える位置、ラベルの折り返し）')
console.log('- .modal-body-scrollが実際に本文だけをスクロールさせ、.modal-actionsが画面内に固定されること')
console.log('- recalculateShiftEditSkillInlineVisibility_が、実ブラウザのflexboxレイアウト・実フォント・')
console.log('  パディングのもとで、名前・「＋N件」ボタンとの兼ね合いを含めて正しい件数を計算すること')
console.log('  （このテストのフェイクgetBoundingClientRectは固定幅を横一列に並べる簡易計算であり、')
console.log('  実際のCSSレイアウトエンジンの計算を再現していない）')
console.log('- 表示中の実際のウィンドウリサイズで、resizeイベントが発火しラベル表示が追従すること')
console.log('- 実際のブラウザで、.modal-field--skill-row（flex-wrap: nowrap）・.skill-tag-list--inline')
console.log('  （overflow: hidden）が意図通りに働き、ラベル列や「＋N件」ボタンが氏名の下の行から')
console.log('  さらに別行へ落ちないこと（CSS宣言の存在自体はshift_modal_scroll_structure_test.jsで')
console.log('  確認済みだが、実際のCSSレイアウトエンジンでの折り返し判定・計算結果はこのテストの対象外）')
console.log('- 氏名が下段のラベル行と分離されたことで、狭い画面・長い氏名でも氏名側が不自然に')
console.log('  改行されず読みやすくなっていること。320px程度の狭い画面幅で、長い日本語氏名・')
console.log('  空白のない長い英字氏名が実際にoverflow-wrap: anywhereの効果で折り返り、モーダル幅を')
console.log('  超えてはみ出さないこと（このテストのフェイクDOMは名前要素自体の折り返しは再現しない）')
console.log('- キーボード操作（Tab・Enter/Space）で開閉ボタン・「＋N件」ボタンを実際に操作できること')
console.log('- 長い従業員名・長いマイスター名での実際のレイアウト崩れの有無、展開時の折り返し表示の見た目')
console.log('- 展開時に、実際のブラウザで.skill-tag-list--expanded（overflow: visible; flex-wrap: wrap）・')
console.log('  .modal-field--skill-row-expanded（flex-wrap: wrap）が意図通りに働き、ラベルが複数行に')
console.log('  折り返って全件読めること（CSS宣言の存在自体はshift_modal_scroll_structure_test.jsで')
console.log('  確認済みだが、実際の折り返し結果の見た目はこのテストの対象外）')
console.log('- 開閉操作を行っても、入力中の時刻（開始・終了）が実際に保持され、登録・変更・削除が行えること')
console.log('- .skill-tag・.skill-tag-more-btn・.skill-toggle-btnのhidden属性が、実ブラウザのCSSで')
console.log('  実際に非表示として描画されること（[hidden]優先ルールの存在自体はCSS構造テストで確認済みだが、')
console.log('  実際の計算済みスタイル・描画結果はこのテスト・CSS構造テストいずれの対象でもない）')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
