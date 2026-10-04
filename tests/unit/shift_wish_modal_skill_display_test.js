// レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：
// 「希望シフトから勤務を登録」モーダル（shift_wish_modal）にも、シフトの変更・削除モーダル
// （shift_edit_modal）と同じ方式で、従業員名横に取得マイスターのラベルを表示できるようにした。
//
// 実装は、従業員名横のマイスターラベル表示ロジック（実幅計測・「＋N件」開閉・リサイズ追従）を
// js_shift.htmlの共通関数（createSkillTagUI_・clearSkillTags_・createSkillTagEl_・
// renderSkillTags_・recalculateSkillInlineVisibility_・toggleSkillDetail_・
// startSkillResizeWatch_・stopSkillResizeWatch_）へ切り出し、shift_edit_modal・shift_wish_modalの
// 両方がそれぞれ専用のui（createSkillTagUI_インスタンス：shiftEditSkillTagUI_・
// shiftWishSkillTagUI_）を介して呼ぶ形にした。2モーダル分の要素ID・状態（保持中のマイスター一覧・
// リサイズハンドラ参照）はuiインスタンスごとに独立しており、片方の開閉・リサイズがもう片方の
// 表示・状態に影響しない（要素ID・表示状態・イベント処理を混線させない、という要件に対応）。
//
// js_shift_wish.html側の変更：
// - shiftWishSkillTagUI_（shift_wish_modal専用のui）を新設。
// - handleShiftWishBarClick_（希望バークリックで開く処理）で、モーダル表示後に
//   renderSkillTags_(shiftWishSkillTagUI_, employee_id)・startSkillResizeWatch_を呼ぶ
//   （openShiftEditModal_と同じ「表示→ラベル組み立て・計測→リサイズ監視開始」の順序）。
// - closeShiftWishModal_で、stopSkillResizeWatch_・clearSkillTags_を呼ぶ
//   （closeShiftEditModal_と同じ「閉じるたびに確実にリサイズ監視を止める」対策）。
// - toggleShiftWishSkillDetail_（「＋N件」ボタンの開閉）を新設。
//
// view_home.html側の変更：
// - shift_wish_modalに.modal--form-scroll・.modal-body-scrollを追加し、本文だけがスクロールし
//   変更・削除・キャンセルの操作領域が常に画面内に残る構成にした（shift_edit_modalと同じ）。
// - 従業員名の行にshift_wish_modal_skill_tags（常時表示ラベル列）・shift_wish_skill_more_btn
//   （「＋N件」ボタン）を追加。
//
// レビュー対応（展開表示の重複解消 2026-09-16）：「＋N件」を押すと、別行の「全マイスター」
// （shift_wish_modal_skill_detail_field・shift_wish_modal_skill_detail_tags）へ全件が
// 再表示されるため、常時表示済みのラベルと重複していた。修正：別行は廃止し、常時表示の
// ラベル列（shift_wish_modal_skill_tags）自体が折りたたみ・展開の両方を担う設計へ変更した
// （js_shift.htmlのtoggleSkillDetail_・css.htmlの.skill-tag-list--expanded・
// .modal-field--skill-row-expanded参照）。ボタンのaria-controlsはラベル列自身を指す。
//
// レビュー対応（従業員名の下へマイスターラベルを配置 2026-09-21）：以前は氏名と同じ行に
// ラベル列・「＋N件」ボタンを並べていたため、狭い画面・長い氏名で氏名が不自然に改行される
// 問題があった。修正：氏名は通常の.modal-field（ラベル＋値のみ）に戻し、マイスターラベルは
// 氏名の下の別行（.modal-field--skill-row、要素IDはshift_wish_modal_skill_wrapのまま据え置き）
// へ移した。マイスター情報がない場合は不要な空行を残さないよう、共通ロジック側
// （js_shift.htmlのclearSkillTags_・renderSkillTags_）がラベル行自体のhiddenを制御する
// （テスト2dで検証）。
//
// このファイルは、js_shift.html（共通ロジック）とjs_shift_wish.html（shift_wish_modal側の
// 呼び出し）の両方から関数本体を抽出し、Node.jsのvmで連結実行して検証する（ロジックを
// テスト側へ再実装しない）。フェイクDOMの実装・制約はshift_modal_skill_display_test.jsと同じ
// （固定幅の横一列シミュレーションであり、実ブラウザのflexboxレイアウトエンジンを再現しない）。
//
// 表示ロジック自体の単体検証（実幅計測の正しさ・境界値・0件時の扱い等）は
// shift_modal_skill_display_test.jsで共通ロジックとして既に行っているため、ここではその
// 重複を避け、「shift_wish_modal固有の呼び出し経路（handleShiftWishBarClick_・
// closeShiftWishModal_）が正しくラベル表示・リセット・リサイズ監視を行うか」に絞って検証する。
//
// モーダルCSS構造（.modal--form-scroll等）・HTML構造の検証はshift_modal_scroll_structure_test.jsで行う。
//
// 実行: node shift_wish_modal_skill_display_test.js
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

function extractFunction_(script, signaturePattern, label, filename) {
  var m = script.match(signaturePattern)
  if (!m) throw new Error((filename || '') + 'の' + label + 'が見つかりません')
  return m[0]
}

/**
 *  最小限のフェイクDOM要素。shift_modal_skill_display_test.jsと同じ実装
 *  （本番コードが使う範囲だけを再現。widthは固定値として明示的に渡し、overflow: hiddenで
 *  コンテナ幅が内容量に応じて広がらないというCSS前提を模す）
 */
function createFakeElement_(id, width) {
  var classes = {}
  var attrs = {}
  var el = {
    id: id,
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    className: '',
    children: [],
    focusCallCount: 0,
    width: typeof width === 'number' ? width : 0,
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

function tagTexts_(el) {
  return el.children.map(function (c) { return c.textContent })
}
function visibleTagTexts_(el) {
  return el.children.filter(function (c) { return !c.hidden }).map(function (c) { return c.textContent })
}

/**
 *  js_shift.html（共通ロジック）＋js_shift_wish.html（shift_wish_modal側の呼び出し）から、
 *  希望シフトモーダルのマイスターラベル表示に関わる関数一式を抽出し、フェイクDOM・
 *  maisterSummaries・currentBusinessDateと一緒に実行する環境を作る。
 *  handleShiftWishBarClick_はformatBusinessDateHeaderLabel_・msToTimeInputValue_にも
 *  依存するため、それらもjs_shift.html・js_shift_wish.html・js_home_common.htmlから読み込む。
 */
function loadShiftWishSkillEnv_(maisterSummariesData, inlineListWidth, tagWidth) {
  var jsShiftScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8'))
  var jsShiftWishScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_shift_wish.html'), 'utf8'))
  var jsHomeCommonScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_home_common.html'), 'utf8'))

  // 共通ロジック（js_shift.html）
  var createUiFn = extractFunction_(jsShiftScript, /function createSkillTagUI_\(ids\) \{[\s\S]*?\n      \}/, 'createSkillTagUI_', 'js_shift.html')
  var clearFn = extractFunction_(jsShiftScript, /function clearSkillTags_\(ui\) \{[\s\S]*?\n      \}/, 'clearSkillTags_', 'js_shift.html')
  var createTagFn = extractFunction_(jsShiftScript, /function createSkillTagEl_\(text\) \{[\s\S]*?\n      \}/, 'createSkillTagEl_', 'js_shift.html')
  var renderFn = extractFunction_(jsShiftScript, /function renderSkillTags_\(ui, empId\) \{[\s\S]*?\n      \}/, 'renderSkillTags_', 'js_shift.html')
  var recalcFn = extractFunction_(jsShiftScript, /function recalculateSkillInlineVisibility_\(ui\) \{[\s\S]*?\n      \}/, 'recalculateSkillInlineVisibility_', 'js_shift.html')
  var measureFn = extractFunction_(jsShiftScript, /function measureVisibleSkillTagCount_\(inlineList, tags\) \{[\s\S]*?\n      \}/, 'measureVisibleSkillTagCount_', 'js_shift.html')
  var toggleDetailFn = extractFunction_(jsShiftScript, /function toggleSkillDetail_\(ui\) \{[\s\S]*?\n      \}/, 'toggleSkillDetail_', 'js_shift.html')
  var startResizeFn = extractFunction_(jsShiftScript, /function startSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'startSkillResizeWatch_', 'js_shift.html')
  var stopResizeFn = extractFunction_(jsShiftScript, /function stopSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'stopSkillResizeWatch_', 'js_shift.html')

  // 日付・時刻ヘルパー（js_home_common.html）
  var formatDateFn = extractFunction_(jsHomeCommonScript, /function formatBusinessDateHeaderLabel_\(dateObj\) \{[\s\S]*?\n      \}/, 'formatBusinessDateHeaderLabel_', 'js_home_common.html')
  // msToTimeInputValue_はjs_shift.html側にある
  var msToTimeFn = extractFunction_(jsShiftScript, /function msToTimeInputValue_\(ms\) \{[\s\S]*?\n      \}/, 'msToTimeInputValue_', 'js_shift.html')
  var pad2Match = jsHomeCommonScript.match(/function pad2_\(n\) \{[\s\S]*?\n      \}/)
  if (!pad2Match) throw new Error('js_home_common.htmlのpad2_が見つかりません')

  // shift_wish_modal側の呼び出し（js_shift_wish.html）
  var uiVarMatch = jsShiftWishScript.match(/var shiftWishSkillTagUI_ = createSkillTagUI_\(\{[\s\S]*?\n      \}\)/)
  if (!uiVarMatch) throw new Error('js_shift_wish.htmlのshiftWishSkillTagUI_宣言が見つかりません')
  var toggleWishDetailFn = extractFunction_(jsShiftWishScript, /function toggleShiftWishSkillDetail_\(\) \{[\s\S]*?\n      \}/, 'toggleShiftWishSkillDetail_', 'js_shift_wish.html')
  var setButtonsDisabledFn = extractFunction_(jsShiftWishScript, /function setShiftWishModalButtonsDisabled_\(disabled\) \{[\s\S]*?\n      \}/, 'setShiftWishModalButtonsDisabled_', 'js_shift_wish.html')
  var updateMessageFn = extractFunction_(jsShiftWishScript, /function updateShiftWishModalMessage_\(message\) \{[\s\S]*?\n      \}/, 'updateShiftWishModalMessage_', 'js_shift_wish.html')
  var applyNormalModeFn = extractFunction_(jsShiftWishScript, /function applyShiftWishNormalMode_\(\) \{[\s\S]*?\n      \}/, 'applyShiftWishNormalMode_', 'js_shift_wish.html')
  var barClickFn = extractFunction_(jsShiftWishScript, /function handleShiftWishBarClick_\(event\) \{[\s\S]*?\n      \}/, 'handleShiftWishBarClick_', 'js_shift_wish.html')
  var closeFn = extractFunction_(jsShiftWishScript, /function closeShiftWishModal_\(\) \{[\s\S]*?\n      \}/, 'closeShiftWishModal_', 'js_shift_wish.html')

  var contextVarMatch = jsShiftWishScript.match(/var shiftWishContext = null[^\n]*\n/)
  if (!contextVarMatch) throw new Error('js_shift_wish.htmlのshiftWishContext宣言が見つかりません')
  var triggerVarMatch = jsShiftWishScript.match(/var shiftWishTriggerEl = null[^\n]*\n/)
  if (!triggerVarMatch) throw new Error('js_shift_wish.htmlのshiftWishTriggerEl宣言が見つかりません')
  var reqInProgressVarMatch = jsShiftWishScript.match(/var shiftWishRequestInProgress = false[^\n]*\n/)
  if (!reqInProgressVarMatch) throw new Error('js_shift_wish.htmlのshiftWishRequestInProgress宣言が見つかりません')
  // shiftWishEditMode（希望自体を修正するモード用の変数）は店主希望導線整理・希望編集削除撤去
  // （2026-09-24）で撤去済み。「希望を修正」「希望を削除」ボタンの撤去に伴い、このテストが
  // 参照していたeditBtn・deleteBtnの要素も含めて取り除いた

  var inlineList = createFakeElement_('shift_wish_modal_skill_tags', inlineListWidth)
  var moreBtn = createFakeElement_('shift_wish_skill_more_btn')
  var wrapField = createFakeElement_('shift_wish_modal_skill_wrap')
  var employeeEl = createFakeElement_('shift_wish_modal_employee')
  var dateEl = createFakeElement_('shift_wish_modal_date')
  var rangeEl = createFakeElement_('shift_wish_modal_range')
  var messageEl = createFakeElement_('shift_wish_modal_message')
  var modalEl = createFakeElement_('shift_wish_modal')
  var registerBtn = createFakeElement_('shift_wish_modal_register_btn')
  var cancelBtn = createFakeElement_('shift_wish_modal_cancel_btn')
  var titleEl = createFakeElement_('shift_wish_modal_title')
  var startTimeEl = createFakeElement_('shift_wish_modal_start_time')
  var endTimeEl = createFakeElement_('shift_wish_modal_end_time')

  var elementsById = {
    shift_wish_modal_skill_tags: inlineList,
    shift_wish_skill_more_btn: moreBtn,
    shift_wish_modal_skill_wrap: wrapField,
    shift_wish_modal_employee: employeeEl,
    shift_wish_modal_date: dateEl,
    shift_wish_modal_range: rangeEl,
    shift_wish_modal_message: messageEl,
    shift_wish_modal: modalEl,
    shift_wish_modal_register_btn: registerBtn,
    shift_wish_modal_cancel_btn: cancelBtn,
    shift_wish_modal_title: titleEl,
    shift_wish_modal_start_time: startTimeEl,
    shift_wish_modal_end_time: endTimeEl
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
    maisterSummaries: maisterSummariesData,
    currentBusinessDate: new Date(2026, 8, 16),
    syncAppShellInertForModal_: undefined // typeof チェックでfunctionでないため呼ばれない
  }
  vm.createContext(sandbox)
  vm.runInContext(
    [
      "var WEEKDAY_LABELS_ = ['日', '月', '火', '水', '木', '金', '土']",
      pad2Match[0], formatDateFn, msToTimeFn,
      createUiFn, clearFn, createTagFn, renderFn, recalcFn, measureFn, toggleDetailFn, startResizeFn, stopResizeFn,
      contextVarMatch[0], triggerVarMatch[0], reqInProgressVarMatch[0],
      uiVarMatch[0], toggleWishDetailFn, setButtonsDisabledFn, updateMessageFn, applyNormalModeFn,
      barClickFn, closeFn
    ].join('\n'),
    sandbox,
    { filename: 'js_shift.html + js_shift_wish.html (shift wish skill tags)' }
  )
  return {
    sandbox: sandbox,
    inlineList: inlineList,
    moreBtn: moreBtn,
    wrapField: wrapField,
    employeeEl: employeeEl,
    modalEl: modalEl,
    startTimeEl: startTimeEl,
    resizeListeners: function () { return resizeListeners },
    fireResize: function () {
      resizeListeners.filter(function (l) { return l.type === 'resize' }).forEach(function (l) { l.handler() })
    }
  }
}

/**
 *  希望バー（button）要素を模したフェイクオブジェクト。本番はevent.currentTarget.datasetから
 *  読み取るため、datasetとfocusCallCountだけを持つ最小限の実装にする
 */
function createFakeWishBar_(employeeId, employeeName) {
  return {
    dataset: {
      wishId: 'w1',
      employeeId: employeeId,
      employeeName: employeeName,
      startMs: String(new Date(2026, 8, 16, 11, 0).getTime()),
      endMs: String(new Date(2026, 8, 16, 19, 0).getTime()),
      startLabel: '11:00',
      endLabel: '19:00'
    },
    focusCallCount: 0,
    focus: function () { this.focusCallCount++ }
  }
}

console.log('検証対象: js_shift_wish.htmlのhandleShiftWishBarClick_・closeShiftWishModal_・toggleShiftWishSkillDetail_（希望シフトモーダルの従業員名横マイスターラベル）')
console.log('---')

// ------------------------------------------------------------------
// 1. 希望バーを押すと、対象従業員の取得マイスターが氏名の下に表示される
// ------------------------------------------------------------------
{
  var env1 = loadShiftWishSkillEnv_({ '1': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 } }, 300, 60)
  var bar1 = createFakeWishBar_('1', '山田太郎')
  env1.sandbox.handleShiftWishBarClick_({ currentTarget: bar1 })
  assertEqual(tagTexts_(env1.inlineList), ['ホール', 'セット'], '1a. 希望バークリックで、対象従業員の取得マイスターがラベル列に生成される')
  assertEqual(visibleTagTexts_(env1.inlineList), ['ホール', 'セット'], '1b. 実幅（300px）に収まるため2件とも表示される')
  assertTrue(env1.modalEl.hidden === false, '1c. モーダルが開く')
  assertTrue(env1.wrapField.hidden === false, '1d. マイスター情報があるため、ラベル行自体（wrapField）は表示される')
}

// ------------------------------------------------------------------
// 2. 未登録・取得0件・情報取得不可のときはラベルを出さない（技能情報表示不可でも勤務登録を妨げない）。
//    ラベル行自体（wrapField）もhiddenのまま（レビュー対応：従業員名の下へマイスターラベルを
//    配置 2026-09-21。マイスター情報がない場合に不要な空行を残さない要件の検証）
// ------------------------------------------------------------------
{
  var env2a = loadShiftWishSkillEnv_({ '2': { registered: false, acquired_meisters: [], score: 0 } }, 300, 60)
  env2a.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('2', '未登録さん') })
  assertEqual(env2a.inlineList.children.length, 0, '2a. registered:falseのとき、ラベルは1件も出さない')
  assertTrue(env2a.modalEl.hidden === false, '2a. それでもモーダルは通常どおり開く（勤務登録を妨げない）')
  assertTrue(env2a.wrapField.hidden === true, '2a. ラベル行自体（wrapField）もhiddenのまま（不要な空行を残さない）')

  var env2b = loadShiftWishSkillEnv_({ '3': { registered: true, acquired_meisters: [], score: 0 } }, 300, 60)
  env2b.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('3', '取得0件さん') })
  assertEqual(env2b.inlineList.children.length, 0, '2b. 取得0件のとき、ラベルは1件も出さない')
  assertTrue(env2b.wrapField.hidden === true, '2b. ラベル行自体（wrapField）もhiddenのまま')

  var env2c = loadShiftWishSkillEnv_(null, 300, 60)
  env2c.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('4', '取得不可さん') })
  assertEqual(env2c.inlineList.children.length, 0, '2c. maisterSummaries自体が取得できていないとき、ラベルは1件も出さない（例外にもならない）')
  assertTrue(env2c.modalEl.hidden === false, '2c. それでもモーダルは通常どおり開く')
  assertTrue(env2c.wrapField.hidden === true, '2c. ラベル行自体（wrapField）もhiddenのまま')
}

// ------------------------------------------------------------------
// 2d. マイスター情報がある従業員から、情報がない従業員へ切り替えると、ラベル行自体が
//     再びhiddenになる（レビュー対応：従業員名の下へマイスターラベルを配置 2026-09-21）
// ------------------------------------------------------------------
{
  var summaries2d = {
    '20': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 },
    '21': { registered: false, acquired_meisters: [], score: 0 }
  }
  var env2d = loadShiftWishSkillEnv_(summaries2d, 300, 60)
  env2d.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('20', '従業員20') })
  assertTrue(env2d.wrapField.hidden === false, '2d-1. マイスター情報がある従業員20では、ラベル行が表示される（前提）')

  env2d.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('21', '従業員21') }) // マイスター情報がない従業員21へ切替
  assertEqual(env2d.inlineList.children.length, 0, '2d-2. 従業員21のラベルは1件も出さない')
  assertTrue(env2d.wrapField.hidden === true, '2d-2. ラベル行自体が再びhiddenになり、不要な空行を残さない')
}

// ------------------------------------------------------------------
// 3. 一部だけが実幅に収まる場合：収まる分だけ表示、残りは「＋N件」
// ------------------------------------------------------------------
{
  var env3 = loadShiftWishSkillEnv_({ '5': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], score: 40 } }, 200, 60)
  env3.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('5', '複数マイスターさん') })
  assertEqual(visibleTagTexts_(env3.inlineList), ['ホール', 'セット', '麺上げ'], '3a. 実幅（200px）に収まる先頭3件だけが表示される')
  assertTrue(env3.moreBtn.hidden === false, '3b. 隠れている2件がある場合、「＋N件」ボタンを表示する')
  assertEqual(env3.moreBtn.textContent, '＋2件', '3c. 「＋N件」は隠れている件数（5-3=2件）を正しく示す')
  assertEqual(tagTexts_(env3.inlineList).length, 5, '3d. ラベル列自体には全5件を生成する（隠れている分もこの列の中にhiddenで保持する。別行への複製はない）')
}

// ------------------------------------------------------------------
// 4. toggleShiftWishSkillDetail_で、下段のラベル列（inlineList）自体を展開・折りたたみできる
//    （レビュー対応：展開表示の重複解消 2026-09-16。別行の「全マイスター」は廃止し、同じ
//    ラベル列へ隠れていた分を追加して1回だけ表示する）
// ------------------------------------------------------------------
{
  var env4 = loadShiftWishSkillEnv_({ '6': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 } }, 200, 60)
  env4.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('6', '詳細開閉さん') })
  assertEqual(visibleTagTexts_(env4.inlineList), ['ホール', 'セット', '麺上げ'], '4a. handleShiftWishBarClick_直後（折りたたみ）は実幅に収まる3件だけが見える（前提）')

  env4.sandbox.toggleShiftWishSkillDetail_()
  assertEqual(visibleTagTexts_(env4.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '4b. 1回目のtoggleShiftWishSkillDetail_（展開）で、隠れていた分を含む全4件が同じラベル列に表示される（全文を確認できる）')
  assertEqual(tagTexts_(env4.inlineList).length, 4, '4b. ラベル列内の要素数は4件のまま（重複しない）')
  assertEqual(env4.moreBtn.textContent, '折りたたむ', '4b. 展開時、ボタン文言は「折りたたむ」に変わる')
  assertEqual(env4.moreBtn.getAttribute('aria-expanded'), 'true', '4b. 開いた状態でaria-expandedはtrue')

  env4.sandbox.toggleShiftWishSkillDetail_()
  assertEqual(visibleTagTexts_(env4.inlineList), ['ホール', 'セット', '麺上げ'], '4c. 2回目のtoggleShiftWishSkillDetail_（折りたたみ）で、その時点の幅で再計算した3件だけに戻る')
  assertEqual(env4.moreBtn.textContent, '＋1件', '4c. 折りたたみ後、「＋N件」の表記に戻る')
  assertEqual(env4.moreBtn.getAttribute('aria-expanded'), 'false', '4c. 閉じた状態でaria-expandedはfalse')
}

// ------------------------------------------------------------------
// 5. 別の希望バーを開いたとき、前の従業員のラベル・展開状態が残らない（リセット要件）
// ------------------------------------------------------------------
{
  var summaries5 = {
    '7': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 },
    '8': { registered: true, acquired_meisters: ['ホール'], score: 5 }
  }
  var env5 = loadShiftWishSkillEnv_(summaries5, 200, 60)
  env5.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('7', '従業員7') })
  env5.sandbox.toggleShiftWishSkillDetail_() // 従業員7を展開した状態にする
  assertEqual(env5.moreBtn.textContent, '折りたたむ', '5a. 従業員7を展開した状態にする（前提）')

  env5.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('8', '従業員8') }) // 別の希望バーへ切替
  assertEqual(tagTexts_(env5.inlineList), ['ホール'], '5b. 従業員8のラベルへ置き換わり、従業員7の4件は残らない')
  assertTrue(env5.moreBtn.hidden === true, '5b. 従業員8は1件のみ・実幅にも収まるため「＋N件」は出ない')
  assertTrue(!env5.inlineList.classList.contains('skill-tag-list--expanded'), '5c. 従業員切替で展開状態もリセットされ、折りたたみ状態に戻る')
  assertTrue(!env5.wrapField.classList.contains('modal-field--skill-row-expanded'), '5c. 親行の展開用クラスもリセットされる')
}

// ------------------------------------------------------------------
// 6. closeShiftWishModal_を呼ぶと、リサイズ監視が止まりラベルもクリアされる
//    （次に別の希望バーを開いたときに前回の状態が残らない、リスナー重複も防ぐ）
// ------------------------------------------------------------------
{
  var env6 = loadShiftWishSkillEnv_({ '9': { registered: true, acquired_meisters: ['ホール', 'セット'], score: 10 } }, 300, 60)
  env6.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('9', '従業員9') })
  assertEqual(tagTexts_(env6.inlineList), ['ホール', 'セット'], '6a. モーダルを開いた直後はラベルが入っている（前提）')

  var resizeListenersBeforeClose6 = env6.resizeListeners().filter(function (l) { return l.type === 'resize' })
  assertEqual(resizeListenersBeforeClose6.length, 1, '6a. モーダルを開いた直後はresizeリスナーが1件登録されている（前提）')

  env6.sandbox.closeShiftWishModal_()
  assertTrue(env6.modalEl.hidden === true, '6b. closeShiftWishModal_でモーダルが閉じる')
  assertEqual(env6.inlineList.children.length, 0, '6c. closeShiftWishModal_でラベル列がクリアされる（次回開いたときに前の従業員の表示が残らない）')
  assertTrue(env6.moreBtn.hidden === true, '6c. 「＋N件」ボタンもクリアされる')
  assertTrue(!env6.inlineList.classList.contains('skill-tag-list--expanded'), '6c. 展開用クラスもクリアされ折りたたみ状態に戻る')
  var resizeListenersAfterClose6 = env6.resizeListeners().filter(function (l) { return l.type === 'resize' })
  assertEqual(resizeListenersAfterClose6.length, 0, '6d. closeShiftWishModal_でresizeリスナーが確実に解除される（閉じた後に古いリサイズ処理が動き続けない）')
}

// ------------------------------------------------------------------
// 9. 希望バーを閉じずに開き直す（handleShiftWishBarClick_を連続で呼ぶ）操作を模した場合でも、
//    resizeリスナーは重複登録されず常に1件のまま
//    （「イベントリスナーを重複登録しない」という要件の直接的な回帰確認）
// ------------------------------------------------------------------
{
  var env9 = loadShiftWishSkillEnv_({ '12': { registered: true, acquired_meisters: ['ホール'], score: 5 } }, 300, 60)
  env9.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('12', '従業員12') })
  env9.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('12', '従業員12') })
  env9.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('12', '従業員12') })
  var resizeListeners9 = env9.resizeListeners().filter(function (l) { return l.type === 'resize' })
  assertEqual(resizeListeners9.length, 1, '9. handleShiftWishBarClick_を3回連続で呼んでも、resizeリスナーは重複登録されず1件のまま')
}

// ------------------------------------------------------------------
// 7. リサイズ監視：モーダル表示後の幅変更にrecalculateSkillInlineVisibility_相当の
//    再計算が追従する（startSkillResizeWatch_で登録されたハンドラを直接呼び出して確認する。
//    実際のwindow.resizeイベント発火はブラウザでの確認が必要）
// ------------------------------------------------------------------
{
  var env7 = loadShiftWishSkillEnv_({ '10': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], score: 40 } }, 200, 60)
  env7.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('10', '従業員10') })
  assertEqual(visibleTagTexts_(env7.inlineList), ['ホール', 'セット', '麺上げ'], '7a. 幅200pxでは3件が収まる（前提）')

  // 幅を変えてから実際にresizeイベントを発火させる（本番のwindow.resizeに相当）
  env7.inlineList.width = 400
  env7.fireResize()
  assertEqual(visibleTagTexts_(env7.inlineList), ['ホール', 'セット', '麺上げ', '仕込み', '手洗い伝道師'], '7b. 幅が広がった後にリサイズが発火すると、全5件が収まるようになる')
}

// ------------------------------------------------------------------
// 7d. 展開中にリサイズイベントが発火しても、意図せず折りたたまれない
//     （レビュー対応：「展開中のリサイズで意図せず折りたたまない」という要件の確認）
// ------------------------------------------------------------------
{
  var env7d = loadShiftWishSkillEnv_({ '13': { registered: true, acquired_meisters: ['ホール', 'セット', '麺上げ', '仕込み'], score: 30 } }, 200, 60)
  env7d.sandbox.handleShiftWishBarClick_({ currentTarget: createFakeWishBar_('13', '従業員13') })
  env7d.sandbox.toggleShiftWishSkillDetail_() // 展開する
  assertEqual(env7d.moreBtn.textContent, '折りたたむ', '7d-1. 展開状態にする（前提）')
  assertEqual(visibleTagTexts_(env7d.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '7d-1. 展開直後は全4件が見える（前提）')

  env7d.inlineList.width = 90
  env7d.fireResize()
  assertEqual(env7d.moreBtn.textContent, '折りたたむ', '7d-2. リサイズ発火後もボタン文言は「折りたたむ」のまま（意図せず折りたたまれない）')
  assertEqual(visibleTagTexts_(env7d.inlineList), ['ホール', 'セット', '麺上げ', '仕込み'], '7d-2. リサイズ発火後も全4件が見えたまま')
}

// ------------------------------------------------------------------
// 8. shift_edit_modal側のuiとshift_wish_modal側のuiが独立していること
//    （片方の状態がもう片方の要素IDへ書き込まれない、という混線防止の確認）
// ------------------------------------------------------------------
{
  var env8 = loadShiftWishSkillEnv_({ '11': { registered: true, acquired_meisters: ['ホール'], score: 5 } }, 300, 60)
  var uiIds = env8.sandbox.shiftWishSkillTagUI_.ids
  assertEqual(uiIds.inlineList, 'shift_wish_modal_skill_tags', '8. shiftWishSkillTagUI_のinlineList要素IDはshift_wish_modal専用のものである（shift_edit_modal側のIDと異なる）')
  assertEqual(uiIds.moreBtn, 'shift_wish_skill_more_btn', '8. shiftWishSkillTagUI_のmoreBtn要素IDもshift_wish_modal専用である')
}

console.log('---')
console.log('【ブラウザ確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでの見た目（モーダルの縦の長さ、勤務登録・希望修正・削除・キャンセルボタンの')
console.log('  見える位置、ラベルの折り返し）')
console.log('- .modal-body-scrollが実際に本文だけをスクロールさせ、.modal-actionsが画面内に固定されること')
console.log('- recalculateSkillInlineVisibility_が、実ブラウザのflexboxレイアウト・実フォント・')
console.log('  パディングのもとで、名前・「＋N件」ボタンとの兼ね合いを含めて正しい件数を計算すること')
console.log('  （このテストのフェイクgetBoundingClientRectは固定幅を横一列に並べる簡易計算であり、')
console.log('  実際のCSSレイアウトエンジンの計算を再現していない）')
console.log('- 表示中の実際のウィンドウリサイズで、resizeイベントが発火しラベル表示が追従すること')
console.log('- 実際のブラウザで、.modal-field--skill-row・.skill-tag-list--inlineが意図通りに働き、')
console.log('  ラベル列や「＋N件」ボタンが氏名の下の行からさらに別行へ落ちないこと')
console.log('- 氏名が下段のラベル行と分離されたことで、狭い画面・長い氏名でも氏名側が不自然に')
console.log('  改行されず読みやすくなっていること。320px程度の狭い画面幅で、長い日本語氏名・')
console.log('  空白のない長い英字氏名が実際に折り返り、モーダル幅を超えてはみ出さないこと')
console.log('- キーボード操作（Tab・Enter/Space）で開閉ボタン・「＋N件」ボタンを実際に操作できること')
console.log('- 長い従業員名・長いマイスター名での実際のレイアウト崩れの有無、展開時の折り返し表示の見た目')
console.log('- 展開時に、実際のブラウザで.skill-tag-list--expanded・.modal-field--skill-row-expandedが')
console.log('  意図通りに働き、ラベルが複数行に折り返って全件読めること')
console.log('- 詳細開閉・リサイズを行っても、入力中の勤務時刻（開始・終了）が実際に保持され、')
console.log('  勤務登録が行えること')
console.log('- .skill-tag・.skill-tag-more-btnのhidden属性が、実ブラウザのCSSで実際に')
console.log('  非表示として描画されること（[hidden]優先ルールの存在自体はCSS構造テストで確認済みだが、')
console.log('  実際の計算済みスタイル・描画結果はこのテストの対象外）')
console.log('- Escape・背景操作抑止・閉じた際のフォーカス復帰の実際の挙動')
console.log('- shift_edit_modal・shift_direct_add_modalの回帰（このテストではshift_wish_modal側の')
console.log('  呼び出し経路しか実行しておらず、shift_edit_modal側はshift_modal_skill_display_test.js・')
console.log('  sidebar_modal_interaction_test.jsで別途確認している）')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
