// 育成候補モーダル（app/view_meister_bulk.htmlのクライアントロジック）を、本番の<script>本文を
// Node.jsのvmで直接実行して検証する。ロジックをこのファイルへ再実装しない
// （meister_skill_priority_client_test.jsと同じ方針・同じ手法を踏襲する）。
//
// view_meister_bulk.htmlのscriptはGASテンプレート構文（<?!= ... ?>）を含むため、
// vmへ渡す前にその行だけをテスト用の値へ機械的に置き換える（本番ロジックの行は一切書き換えない）。
// 育成候補モーダルの月単位化（2026-09-24）でWISH_PERIOD_FIRST_HALF・WISH_PERIOD_SECOND_HALFの
// 変数宣言自体を本番コードから削除したため、置換対象もMEISTER_KEYS・APP_URLの2箇所になった。
//
// 実行: node meister_training_candidate_client_test.js
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
  var m = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('scriptタグが見つかりません')
  return m[1]
}

/**
 *  GASテンプレート構文（<?!= ... ?>）の行をテスト用の値へ置き換える。本番ロジックの行は変更しない
 */
function stripGasTemplateSyntax_(scriptBody) {
  return scriptBody
    .replace(/var MEISTER_KEYS = <\?!= JSON\.stringify\(MEISTER_KEYS\) \?>;/, "var MEISTER_KEYS = ['手洗い伝道師', 'ホール', 'セット', '仕込み', '麺上げ'];")
    .replace(/var APP_URL = <\?!= JSON\.stringify\(getAppUrl\(\)\) \?>;/, "var APP_URL = 'https://example.com/exec';")
}

/**
 *  最小限のフェイクDOM要素（meister_skill_priority_client_test.jsのcreateFakeElement_を踏襲し、
 *  今回はvalue（number input）・checked（radio）・focus・parentも扱えるよう拡張する）
 */
function createFakeElement_(tag, id) {
  var classes = {}
  var attrs = {}
  var el = {
    tagName: tag,
    id: id || '',
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    className: '',
    dataset: {},
    children: [],
    parent: null,
    focusCallCount: 0,
    classList: {
      add: function (c) { classes[c] = true; el._syncClassName() },
      remove: function (c) { delete classes[c]; el._syncClassName() },
      toggle: function (c, force) {
        var on = force === undefined ? !classes[c] : !!force
        if (on) classes[c] = true; else delete classes[c]
        el._syncClassName()
      },
      contains: function (c) { return !!classes[c] }
    },
    _syncClassName: function () {
      el.className = Object.keys(classes).filter(function (k) { return classes[k] }).join(' ')
    },
    setAttribute: function (name, value) { attrs[name] = String(value) },
    getAttribute: function (name) { return attrs.hasOwnProperty(name) ? attrs[name] : null },
    addEventListener: function (type, handler) {
      el._listeners = el._listeners || {}
      el._listeners[type] = el._listeners[type] || []
      el._listeners[type].push(handler)
    },
    _fireEvent: function (type, event) {
      var handlers = (el._listeners && el._listeners[type]) || []
      handlers.forEach(function (h) { h(event || {}) })
    },
    focus: function () { el.focusCallCount++ },
    appendChild: function (child) {
      child.parent = el
      el.children.push(child)
      if (!el.firstChild) el.firstChild = child
      return child
    },
    removeChild: function (child) {
      var idx = el.children.indexOf(child)
      if (idx >= 0) el.children.splice(idx, 1)
      el.firstChild = el.children.length > 0 ? el.children[0] : null
    },
    firstChild: null
  }
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._innerHTML || '' },
    set: function (v) { el._innerHTML = v; if (v === '') { el.children = []; el.firstChild = null } }
  })
  return el
}

/**
 *  document.getElementById(id)が常に一貫した同一インスタンスを返すフェイクdocument。
 *  view_meister_bulk.htmlが参照するid一覧（育成候補モーダル分を含む）に対応する
 */
function createFakeDocument_() {
  var elements = {}
  var ids = [
    'meister_bulk_table_body', 'meister_bulk_status', 'meister_bulk_change_count', 'meister_bulk_save_btn',
    'meister_skill_priority', 'meister_skill_priority_list',
    'training_modal', 'training_modal_title', 'training_modal_close_btn',
    'training_modal_year', 'training_modal_month',
    'training_modal_loading', 'training_modal_error', 'training_modal_error_message', 'training_modal_reload_hint',
    'training_modal_empty', 'training_modal_list'
  ]
  ids.forEach(function (id) {
    elements[id] = createFakeElement_('div', id)
  })
  var keydownHandlers = []
  return {
    getElementById: function (id) {
      if (!elements[id]) throw new Error('未登録のid: ' + id)
      return elements[id]
    },
    createElement: function (tag) { return createFakeElement_(tag) },
    querySelectorAll: function () { return [] },
    addEventListener: function (type, handler) {
      if (type === 'keydown') keydownHandlers.push(handler)
    },
    _elements: elements,
    _fireKeydown: function (key) {
      var event = { key: key }
      keydownHandlers.forEach(function (h) { h(event) })
    }
  }
}

function createFakeGoogleScriptRun_(callLog) {
  function makeRunner() {
    var successHandler = null
    var failureHandler = null
    var proxy
    var runner = {
      withSuccessHandler: function (fn) { successHandler = fn; return proxy },
      withFailureHandler: function (fn) { failureHandler = fn; return proxy }
    }
    var handler = {
      get: function (target, prop) {
        if (prop in target) return target[prop]
        return function () {
          var args = Array.prototype.slice.call(arguments)
          var entry = { name: prop, args: args, resolve: null, reject: null }
          entry.resolve = function (result) { if (successHandler) successHandler(result) }
          entry.reject = function (error) { if (failureHandler) failureHandler(error) }
          callLog.push(entry)
          return proxy
        }
      }
    }
    proxy = new Proxy(runner, handler)
    return proxy
  }
  return { script: { get run() { return makeRunner() } } }
}

/**
 *  view_meister_bulk.htmlのscript本体を1つのVMコンテキストへ読み込む。
 *  document・google.script.run・windowはフェイクへ差し替える。fixedNowDateを渡すと、
 *  resolveInitialTrainingMonth_内で使うnew Date()相当のDateコンストラクタを固定できる
 *  （openTrainingCandidateModal_はnew Date()を直接呼ぶため、vmコンテキストのDate自体を
 *  差し替えて「開いた瞬間の現在日時」をテストから制御する）
 */
function loadMeisterBulkClientEnv_(fixedNowDate) {
  var viewHtml = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var scriptBody = stripGasTemplateSyntax_(extractScriptBody_(viewHtml))

  var fakeDocument = createFakeDocument_()
  var callLog = []
  var fakeGoogle = createFakeGoogleScriptRun_(callLog)
  var fakeWindow = { addEventListener: function () {}, confirm: function () { return true } }

  var sandbox = {
    console: console,
    document: fakeDocument,
    google: fakeGoogle,
    window: fakeWindow,
    Object: Object,
    JSON: JSON,
    Array: Array,
    String: String,
    Number: Number,
    encodeURIComponent: encodeURIComponent
  }
  vm.createContext(sandbox)

  if (fixedNowDate) {
    // openTrainingCandidateModal_内のnew Date()だけを固定したいので、vmコンテキスト内の
    // グローバルDateコンストラクタを、引数なし呼び出し時だけ固定日時を返すものに差し替える
    // （引数ありの呼び出し＝resolveInitialTrainingMonth_内のnew Date(y, m, 1)等は本物のDateのまま）
    var RealDate = vm.runInContext('Date', sandbox)
    vm.runInContext(
      'var __FIXED_NOW__ = new Date(' + fixedNowDate.getTime() + ');' +
      'var __RealDate__ = Date;' +
      'Date = function () { if (arguments.length === 0) return new __RealDate__(__FIXED_NOW__.getTime()); return new (Function.prototype.bind.apply(__RealDate__, [null].concat(Array.prototype.slice.call(arguments)))); };' +
      'Date.prototype = __RealDate__.prototype;',
      sandbox
    )
  }

  vm.runInContext(scriptBody, sandbox, { filename: 'view_meister_bulk.html' })

  return { sandbox: sandbox, document: fakeDocument, callLog: callLog }
}

function sampleSkillPriorityWithButtons_() {
  return [
    { key: '麺上げ', holder_count: 0, holder_names: [], status: 'none', status_label: '担当者なし' },
    { key: 'セット', holder_count: 1, holder_names: [], status: 'single', status_label: '一人依存・育成優先' },
    { key: 'ホール', holder_count: 3, holder_names: [], status: 'multiple', status_label: '保有者3人' }
  ]
}

console.log('検証対象: view_meister_bulk.html（育成候補モーダル、クライアントロジック）')
console.log('---')

// ------------------------------------------------------------------
// 1. ページ初期表示では勤怠API（getMeisterTrainingCandidates）を呼ばない
// ------------------------------------------------------------------
{
  var env1 = loadMeisterBulkClientEnv_()
  env1.sandbox.loadMeisterBulkView()
  var call1 = env1.callLog[env1.callLog.length - 1]
  call1.resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var calledNames1 = env1.callLog.map(function (c) { return c.name })
  assertTrue(calledNames1.indexOf('getMeisterTrainingCandidates') === -1, '1. ページ初期表示ではgetMeisterTrainingCandidatesを呼ばない')
}

// ------------------------------------------------------------------
// 2/3/4. 0人・1人の技能に「育成候補を見る」が表示され、2人以上には表示されない
// ------------------------------------------------------------------
{
  var env2 = loadMeisterBulkClientEnv_()
  env2.sandbox.loadMeisterBulkView()
  var call2 = env2.callLog[env2.callLog.length - 1]
  call2.resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })

  var listEl2 = env2.document.getElementById('meister_skill_priority_list')
  var noneCard2 = listEl2.children[0] // 麺上げ（0人）
  var singleCard2 = listEl2.children[1] // セット（1人）
  var multiCard2 = listEl2.children[2] // ホール（3人）

  function findCandidateBtn_(card) {
    return card.children.filter(function (c) { return c.className.indexOf('skill-priority-card__candidate-btn') >= 0 })[0]
  }
  assertTrue(!!findCandidateBtn_(noneCard2), '2. 0人の技能（麺上げ）に「育成候補を見る」が表示される')
  assertEqual(findCandidateBtn_(noneCard2).textContent, '育成候補を見る', '2. ボタンの文言は「育成候補を見る」')
  assertTrue(!!findCandidateBtn_(singleCard2), '3. 1人依存の技能（セット）に「育成候補を見る」が表示される')
  assertTrue(!findCandidateBtn_(multiCard2), '4. 2人以上の技能（ホール）にはボタンが表示されない')
}

// ------------------------------------------------------------------
// 5. 「育成候補を見る」を押すまでgetMeisterTrainingCandidatesは呼ばれない。押すと呼ばれる
// ------------------------------------------------------------------
{
  var env5 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10)) // 2026-10-10（1〜15日 → 当月後半が初期期間）
  env5.sandbox.loadMeisterBulkView()
  var call5 = env5.callLog[env5.callLog.length - 1]
  call5.resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })

  var listEl5 = env5.document.getElementById('meister_skill_priority_list')
  var noneCard5 = listEl5.children[0]
  var btn5 = noneCard5.children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]

  assertEqual(env5.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' }).length, 0,
    '5a. ボタンを押す前はgetMeisterTrainingCandidatesを呼んでいない')

  btn5._fireEvent('click')
  var trainingCalls5 = env5.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' })
  assertEqual(trainingCalls5.length, 1, '5b. ボタンを押すとgetMeisterTrainingCandidatesを1回呼ぶ')
  assertEqual(trainingCalls5[0].args[0], '麺上げ', '5c. 対象技能名を渡す')
  // 月単位化（2026-09-24）：クライアントはサーバーへperiodを渡さない（引数は技能名・年・月の3個だけ）
  assertEqual(trainingCalls5[0].args.length, 3, '5d. getMeisterTrainingCandidatesの引数は技能名・年・月の3個だけ（periodを渡さない）')
}

// ------------------------------------------------------------------
// 6/7. 初期対象月（月単位化 2026-09-24）：当日が1〜15日なら当月、16日以降なら翌月。年跨ぎも正しく処理する
// ------------------------------------------------------------------
{
  var env6 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10)) // 2026-10-10（15日以前）
  assertEqual(env6.sandbox.resolveInitialTrainingMonth_(new Date(2026, 9, 10)),
    { year: 2026, month: 10 }, '6a. 当日が10/10（1〜15日）なら当月（10月）')
  assertEqual(env6.sandbox.resolveInitialTrainingMonth_(new Date(2026, 9, 16)),
    { year: 2026, month: 11 }, '6b. 当日が10/16（16日以降）なら翌月（11月）')
  assertEqual(env6.sandbox.resolveInitialTrainingMonth_(new Date(2026, 11, 20)),
    { year: 2027, month: 1 }, '7. 当日が12/20なら年跨ぎで翌年1月になる')
}

// ------------------------------------------------------------------
// 8. モーダルを開くと年月の初期値がセットされ、対象技能名が表示される（月単位化 2026-09-24）
// ------------------------------------------------------------------
{
  var env8 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env8.sandbox.loadMeisterBulkView()
  var call8 = env8.callLog[env8.callLog.length - 1]
  call8.resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  env8.callLog[env8.callLog.length - 1].resolve // no-op（直前行の整合のため）

  var listEl8 = env8.document.getElementById('meister_skill_priority_list')
  var btn8 = listEl8.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn8._fireEvent('click')

  assertEqual(env8.document.getElementById('training_modal_title').textContent, '麺上げの育成候補', '8a. モーダル見出しに対象技能名を表示する')
  assertEqual(env8.document.getElementById('training_modal_year').value, '2026', '8b. 年の初期値は2026')
  assertEqual(env8.document.getElementById('training_modal_month').value, '10', '8c. 月の初期値は10（当月）')
  assertEqual(env8.document.getElementById('training_modal').hidden, false, '8f. モーダルが表示される')
}

// ------------------------------------------------------------------
// 9. 年月を変更すると候補を再取得する（月単位化 2026-09-24。前半／後半の入力自体を廃止したため、
//    年月変更だけを検証する）
// ------------------------------------------------------------------
{
  var env9 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env9.sandbox.loadMeisterBulkView()
  env9.callLog[env9.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl9 = env9.document.getElementById('meister_skill_priority_list')
  var btn9 = listEl9.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn9._fireEvent('click')
  var countAfterOpen9 = env9.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' }).length
  assertEqual(countAfterOpen9, 1, '9-前提. モーダルを開いた時点で1回取得している')

  env9.document.getElementById('training_modal_month').value = '11'
  env9.sandbox.handleTrainingModalMonthChange_()
  var countAfterChange9 = env9.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' }).length
  assertEqual(countAfterChange9, 2, '9a. 月を変更すると候補を再取得する')

  env9.document.getElementById('training_modal_year').value = '2027'
  env9.sandbox.handleTrainingModalMonthChange_()
  var countAfterChange9b = env9.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' }).length
  assertEqual(countAfterChange9b, 3, '9b. 年を変更すると候補を再取得する')
}

// ------------------------------------------------------------------
// 10. モーダルを開いたとき・期間変更したときに読み込み表示を出し、再取得開始時に古い候補一覧を消す
// ------------------------------------------------------------------
{
  var env10 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env10.sandbox.loadMeisterBulkView()
  env10.callLog[env10.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl10 = env10.document.getElementById('meister_skill_priority_list')
  var btn10 = listEl10.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn10._fireEvent('click')

  assertEqual(env10.document.getElementById('training_modal_loading').hidden, false, '10a. モーダルを開いた時点で読み込み表示が出ている')

  var call10 = env10.callLog[env10.callLog.length - 1]
  call10.resolve({
    success: true, skill_key: '麺上げ', candidates: [
      { employee_id: '101', employee_name: '従業員A', average_work_days: 10, wish_day_count: 2 }
    ]
  })
  assertEqual(env10.document.getElementById('training_modal_loading').hidden, true, '10b. 取得成功後は読み込み表示を消す')
  assertEqual(env10.document.getElementById('training_modal_list').children.length, 1, '10c. 候補一覧が描画される')

  // 期間変更で再取得を開始すると、古い候補一覧が消え、読み込み表示が再度出る
  env10.sandbox.handleTrainingModalMonthChange_()
  assertEqual(env10.document.getElementById('training_modal_list').children.length, 0, '10d. 再取得開始時に古い候補一覧を消す')
  assertEqual(env10.document.getElementById('training_modal_loading').hidden, false, '10e. 期間変更時にも読み込み表示を出す')
}

// ------------------------------------------------------------------
// 11. サーバー処理全体が失敗した場合は候補一覧を表示せず、再読み込みできる
// ------------------------------------------------------------------
{
  var env11 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env11.sandbox.loadMeisterBulkView()
  env11.callLog[env11.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl11 = env11.document.getElementById('meister_skill_priority_list')
  var btn11 = listEl11.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn11._fireEvent('click')

  var call11 = env11.callLog[env11.callLog.length - 1]
  call11.resolve({ success: false, message: '従業員一覧の取得に失敗しました' })

  assertEqual(env11.document.getElementById('training_modal_error').hidden, false, '11a. 全体失敗時にエラー表示を出す')
  assertEqual(env11.document.getElementById('training_modal_error_message').textContent, '従業員一覧の取得に失敗しました', '11b. エラーメッセージを表示する')
  assertEqual(env11.document.getElementById('training_modal_list').children.length, 0, '11c. 候補一覧は表示しない')

  // 再読み込みボタンで再実行できる
  env11.sandbox.handleTrainingModalReloadClick_()
  var trainingCalls11 = env11.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' })
  assertEqual(trainingCalls11.length, 2, '11d. 再読み込みボタンで同じ条件で再実行できる')
}

// ------------------------------------------------------------------
// 12. 保有人数が2人以上へ変わった場合、再読み込みを促す案内を表示する
// ------------------------------------------------------------------
{
  var env12 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env12.sandbox.loadMeisterBulkView()
  env12.callLog[env12.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl12 = env12.document.getElementById('meister_skill_priority_list')
  var btn12 = listEl12.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn12._fireEvent('click')

  var call12 = env12.callLog[env12.callLog.length - 1]
  call12.resolve({ success: false, message: '対象技能の保有人数がすでに2人以上になっています。画面を再読み込みして最新の育成優先度をご確認ください', needs_reload: true })

  assertEqual(env12.document.getElementById('training_modal_reload_hint').hidden, false, '12a. needs_reload時は再読み込みの案内を表示する')
}
{
  // 対比：needs_reloadがない全体失敗では案内を出さない
  var env12b = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env12b.sandbox.loadMeisterBulkView()
  env12b.callLog[env12b.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl12b = env12b.document.getElementById('meister_skill_priority_list')
  var btn12b = listEl12b.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn12b._fireEvent('click')
  env12b.callLog[env12b.callLog.length - 1].resolve({ success: false, message: '通信エラー' })
  assertEqual(env12b.document.getElementById('training_modal_reload_hint').hidden, true, '12b. needs_reloadがない失敗では再読み込み案内を出さない')
}

// ------------------------------------------------------------------
// 13. 一部候補者の勤怠取得だけ失敗した場合も、取得できた候補者を表示する（partial_failure）
// ------------------------------------------------------------------
{
  var env13 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env13.sandbox.loadMeisterBulkView()
  env13.callLog[env13.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl13 = env13.document.getElementById('meister_skill_priority_list')
  var btn13 = listEl13.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn13._fireEvent('click')

  env13.callLog[env13.callLog.length - 1].resolve({
    success: true, partial_failure: true, candidates: [
      { employee_id: '101', employee_name: '従業員A', average_work_days: 12, wish_day_count: 3 },
      { employee_id: '102', employee_name: '従業員B', average_work_days: null, wish_day_count: 1 }
    ]
  })
  assertEqual(env13.document.getElementById('training_modal_list').children.length, 2, '13a. 一部失敗があっても取得できた候補者を含め全員表示する')
  assertEqual(env13.document.getElementById('training_modal_error').hidden, true, '13b. 一部失敗は全体エラー表示にしない')
}

// ------------------------------------------------------------------
// 14. 候補者ごとに氏名・月平均勤務日数・対象月の希望日数を表示する。取得できない場合は「取得できません」
//     （月単位化 2026-09-24 で表示文言を「選択期間の希望日数」から「対象月の希望日数」へ変更）
// ------------------------------------------------------------------
{
  var env14 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env14.sandbox.loadMeisterBulkView()
  env14.callLog[env14.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl14 = env14.document.getElementById('meister_skill_priority_list')
  var btn14 = listEl14.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn14._fireEvent('click')

  env14.callLog[env14.callLog.length - 1].resolve({
    success: true, candidates: [
      { employee_id: '101', employee_name: '従業員A', average_work_days: 12.3, wish_day_count: 4 },
      { employee_id: '102', employee_name: '従業員B', average_work_days: null, wish_day_count: 0 }
    ]
  })
  var rows14 = env14.document.getElementById('training_modal_list').children
  var texts14a = rows14[0].children.map(function (c) { return c.textContent })
  assertEqual(texts14a[0], '従業員A', '14a. 候補者の氏名を表示する')
  assertEqual(texts14a[1], '直近3か月の月平均勤務日数：12.3日', '14b. 月平均勤務日数を「直近3か月の月平均勤務日数：N.N日」の形で表示する')
  assertEqual(texts14a[2], '対象月の希望日数：4日', '14c. 希望日数を「対象月の希望日数：N日」の形で表示する')

  var texts14b = rows14[1].children.map(function (c) { return c.textContent })
  assertEqual(texts14b[1], '直近3か月の月平均勤務日数：取得できません', '14d. 取得できない場合は0日ではなく「取得できません」と表示する')
}

// ------------------------------------------------------------------
// 15. 候補者が0人の場合「対象技能を持っていない在籍従業員はいません」と表示する
// ------------------------------------------------------------------
{
  var env15 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env15.sandbox.loadMeisterBulkView()
  env15.callLog[env15.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl15 = env15.document.getElementById('meister_skill_priority_list')
  var btn15 = listEl15.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn15._fireEvent('click')

  env15.callLog[env15.callLog.length - 1].resolve({ success: true, candidates: [] })
  assertEqual(env15.document.getElementById('training_modal_empty').hidden, false, '15a. 候補者0人のとき案内を表示する')
  // training_modal_emptyの文言はJSで書き換えず静的HTMLへ最初から埋め込まれているため
  // （フェイクDOMのtextContentはJSからの代入しか反映しない）、静的HTML側をソースで確認する
  var viewSrc15 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  assertTrue(/id="training_modal_empty"[^>]*>対象技能を持っていない在籍従業員はいません</.test(viewSrc15),
    '15b. 案内文は「対象技能を持っていない在籍従業員はいません」')
}

// ------------------------------------------------------------------
// 16. 案内文「勤務頻度は判断材料の一つです。やる気・適性を含む最終判断は店主が行ってください。」を表示する
// ------------------------------------------------------------------
{
  var viewSrc16 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var noteText16 = '勤務頻度は判断材料の一つです。やる気・適性を含む最終判断は店主が行ってください。'
  assertTrue(viewSrc16.indexOf(noteText16) >= 0, '16. 案内文をモーダルに表示する')
}

// ------------------------------------------------------------------
// 17. 背景クリック・閉じるボタン・Escapeキーで閉じられ、閉じた後は「育成候補を見る」ボタンへフォーカスが戻る
// ------------------------------------------------------------------
{
  var env17 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env17.sandbox.loadMeisterBulkView()
  env17.callLog[env17.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var listEl17 = env17.document.getElementById('meister_skill_priority_list')
  var btn17 = listEl17.children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn17._fireEvent('click')
  assertEqual(env17.document.getElementById('training_modal').hidden, false, '17-前提. モーダルが開いている')

  // 閉じるボタン
  env17.sandbox.closeTrainingCandidateModal_()
  assertEqual(env17.document.getElementById('training_modal').hidden, true, '17a. 閉じるボタン相当のcloseTrainingCandidateModal_でモーダルが閉じる')
  assertEqual(btn17.focusCallCount, 1, '17b. 閉じると「育成候補を見る」ボタンへフォーカスが戻る')

  // 背景クリック（training_modal自身をクリックした場合だけ閉じる）
  var env17b = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env17b.sandbox.loadMeisterBulkView()
  env17b.callLog[env17b.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var btn17b = env17b.document.getElementById('meister_skill_priority_list').children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn17b._fireEvent('click')
  env17b.sandbox.handleTrainingModalOverlayClick_({ target: { id: 'training_modal' } })
  assertEqual(env17b.document.getElementById('training_modal').hidden, true, '17c. 背景（オーバーレイ自身）クリックで閉じる')

  var env17c = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env17c.sandbox.loadMeisterBulkView()
  env17c.callLog[env17c.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var btn17c = env17c.document.getElementById('meister_skill_priority_list').children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn17c._fireEvent('click')
  env17c.sandbox.handleTrainingModalOverlayClick_({ target: { id: 'training_modal_title' } }) // モーダル本体内部のクリック
  assertEqual(env17c.document.getElementById('training_modal').hidden, false, '17d. モーダル本体内部のクリックでは閉じない')

  // Escapeキー
  var env17d = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env17d.sandbox.loadMeisterBulkView()
  env17d.callLog[env17d.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var btn17d = env17d.document.getElementById('meister_skill_priority_list').children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn17d._fireEvent('click')
  env17d.document._fireKeydown('Escape')
  assertEqual(env17d.document.getElementById('training_modal').hidden, true, '17e. Escapeキーで閉じる')
  assertEqual(btn17d.focusCallCount, 1, '17f. Escapeで閉じてもボタンへフォーカスが戻る')

  // モーダルを開いていない状態でEscapeを押しても何も起きない（例外を投げない）
  var env17e = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env17e.sandbox.loadMeisterBulkView()
  env17e.callLog[env17e.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  assertTrue((function () { env17e.document._fireKeydown('Escape'); return true })(), '17g. モーダル非表示時にEscapeを押しても例外にならない')
}

// ------------------------------------------------------------------
// 18. リクエスト連番により、年月を連続変更した場合の古い応答を無視する
// ------------------------------------------------------------------
{
  var env18 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env18.sandbox.loadMeisterBulkView()
  env18.callLog[env18.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var btn18 = env18.document.getElementById('meister_skill_priority_list').children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn18._fireEvent('click')
  var firstCall18 = env18.callLog[env18.callLog.length - 1] // 1回目（開いた直後）

  // 年月を連続変更する（2回目のリクエストが飛ぶ）
  env18.document.getElementById('training_modal_month').value = '11'
  env18.sandbox.handleTrainingModalMonthChange_()
  var secondCall18 = env18.callLog[env18.callLog.length - 1]

  // 1回目（古い）の応答が2回目より後に届いたケースを再現する
  firstCall18.resolve({ success: true, candidates: [{ employee_id: '999', employee_name: '古い応答の候補者', average_work_days: 1, wish_day_count: 1 }] })
  assertEqual(env18.document.getElementById('training_modal_list').children.length, 0, '18a. 古い応答（連番不一致）は描画されない')

  secondCall18.resolve({ success: true, candidates: [{ employee_id: '101', employee_name: '最新の候補者', average_work_days: 5, wish_day_count: 2 }] })
  assertEqual(env18.document.getElementById('training_modal_list').children.length, 1, '18b. 最新の応答は描画される')
  assertEqual(env18.document.getElementById('training_modal_list').children[0].children[0].textContent, '最新の候補者', '18c. 描画された内容は最新の応答のもの')
}

// ------------------------------------------------------------------
// 19. モーダルを閉じた後に遅い応答が返っても、モーダルを勝手に再表示しない
// ------------------------------------------------------------------
{
  var env19 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env19.sandbox.loadMeisterBulkView()
  env19.callLog[env19.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var btn19 = env19.document.getElementById('meister_skill_priority_list').children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn19._fireEvent('click')
  var pendingCall19 = env19.callLog[env19.callLog.length - 1]

  env19.sandbox.closeTrainingCandidateModal_()
  assertEqual(env19.document.getElementById('training_modal').hidden, true, '19-前提. モーダルを閉じている')

  // 閉じた後に遅れて応答が届く
  pendingCall19.resolve({ success: true, candidates: [{ employee_id: '101', employee_name: '遅い応答', average_work_days: 5, wish_day_count: 1 }] })
  assertEqual(env19.document.getElementById('training_modal').hidden, true, '19a. 閉じた後の遅い応答でモーダルが再表示されない')
  assertEqual(env19.document.getElementById('training_modal_list').children.length, 0, '19b. 閉じた後の遅い応答は候補一覧にも描画されない')
}

// ------------------------------------------------------------------
// 20. 候補が多い場合の内部スクロール構造がある（.modal--form-scroll・.modal-body-scrollを使う）
// ------------------------------------------------------------------
{
  var viewSrc20 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var modalTagMatch20 = viewSrc20.match(/<div id="training_modal"[\s\S]*?<div class="modal([^"]*)"/)
  assertTrue(!!modalTagMatch20, '20-前提. training_modalの.modal要素が見つかる')
  assertTrue(modalTagMatch20[1].indexOf('modal--form-scroll') >= 0, '20a. training_modalは.modal--form-scroll（見出し＋本文スクロール構成）を使う')
  // 単純なindexOf('training_modal_list')はJS側のdocument.getElementById呼び出し（HTML要素より前に出現）に
  // マッチしてしまうため、HTMLタグとして具体的な文字列で位置を比較する
  var bodyScrollDivIdx20 = viewSrc20.indexOf('<div class="modal-body-scroll">')
  var listDivIdx20 = viewSrc20.indexOf('<div id="training_modal_list"')
  assertTrue(bodyScrollDivIdx20 >= 0 && listDivIdx20 > bodyScrollDivIdx20, '20b. candidatesの一覧（training_modal_list）は.modal-body-scroll配下にある')

  var cssSrc20 = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')
  assertTrue(/\.modal-body-scroll\s*\{[^}]*overflow-y:\s*auto/.test(cssSrc20), '20c. .modal-body-scrollがoverflow-y:autoで本文だけをスクロールさせる（既存定義の再利用）')
}

// ------------------------------------------------------------------
// 21. 表示処理（buildTrainingCandidateRow_・renderTrainingCandidates_・
//     handleTrainingCandidatesResult_）は保存・更新・削除処理を一切呼ばない
// ------------------------------------------------------------------
{
  var srcCheck21 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var fns21 = ['buildTrainingCandidateRow_', 'renderTrainingCandidates_', 'fetchTrainingCandidates_', 'handleTrainingCandidatesResult_']
  fns21.forEach(function (fnName) {
    var m = srcCheck21.match(new RegExp('function ' + fnName + '\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}'))
    assertTrue(!!m, '21-前提. ' + fnName + 'が見つかる')
    if (m) {
      assertTrue(m[0].indexOf('saveMeisterBulkChanges') === -1, '21a. ' + fnName + 'はsaveMeisterBulkChangesを呼ばない')
      assertTrue(m[0].indexOf('pendingChanges') === -1, '21b. ' + fnName + 'はpendingChangesへ触れない')
    }
  })
}

// ------------------------------------------------------------------
// 22. 禁止語チェック：育成候補モーダルの表示文言に「推薦決定」「最適」を含まない
// ------------------------------------------------------------------
{
  var viewSrc22 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var forbidden22 = ['推薦決定', '最適']
  forbidden22.forEach(function (w) {
    assertTrue(viewSrc22.indexOf(w) === -1, '22. view_meister_bulk.htmlの表示文言に「' + w + '」を含まない')
  })
}

// ------------------------------------------------------------------
// 23. 育成候補モーダルの月単位化（2026-09-24）：モーダルに前半・後半の入力が残っていない
// ------------------------------------------------------------------
{
  var viewSrc23 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var modalMatch23 = viewSrc23.match(/<div id="training_modal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/body>/)
  assertTrue(!!modalMatch23, '23-前提. training_modal全体のHTMLを抽出できた')
  var modalHtml23 = modalMatch23 ? modalMatch23[0] : ''
  assertTrue(modalHtml23.indexOf('training_modal_period_first') === -1, '23a. モーダルにtraining_modal_period_first（前半ラジオボタン）が残っていない')
  assertTrue(modalHtml23.indexOf('training_modal_period_second') === -1, '23b. モーダルにtraining_modal_period_second（後半ラジオボタン）が残っていない')
  assertTrue(modalHtml23.indexOf('type="radio"') === -1, '23c. モーダルにラジオボタン自体が残っていない')
  assertTrue(modalHtml23.indexOf('前半') === -1, '23d. モーダルに「前半」という文言が残っていない')
  assertTrue(modalHtml23.indexOf('後半') === -1, '23e. モーダルに「後半」という文言が残っていない')
  assertTrue(modalHtml23.indexOf('training-modal-period-toggle') === -1, '23f. モーダルにtraining-modal-period-toggle（前半後半トグルのクラス）が残っていない')
  // 年・月の入力自体は維持している
  assertTrue(modalHtml23.indexOf('training_modal_year') >= 0, '23g. 年の入力（training_modal_year）は維持している')
  assertTrue(modalHtml23.indexOf('training_modal_month') >= 0, '23h. 月の入力（training_modal_month）は維持している')

  // 育成候補モーダル専用の前半後半処理・変数が本番コードから削除されている。
  // 経緯説明のコメント（JSDoc）自体にこれらの識別子名を書いているため、コメントを除去した
  // 実行コードだけを対象に検証する（score_display_removal_test.jsで得た教訓と同じ対応）
  var scriptSrc23Raw = extractScriptBody_(viewSrc23)
  var scriptSrc23 = scriptSrc23Raw
    .replace(/\/\*[\s\S]*?\*\//g, '') // JSDoc・ブロックコメント除去
    .replace(/\/\/[^\n]*/g, '') // 行コメント除去
  assertTrue(scriptSrc23.indexOf('setTrainingModalPeriodInputs_') === -1, '23i. setTrainingModalPeriodInputs_（前半後半ラジオへの反映）が本番コードから削除されている')
  assertTrue(scriptSrc23.indexOf('getTrainingModalPeriod_') === -1, '23j. getTrainingModalPeriod_（前半後半の読み取り）が本番コードから削除されている')
  assertTrue(scriptSrc23.indexOf('resolveInitialTrainingPeriod_') === -1, '23k. resolveInitialTrainingPeriod_（旧・初期対象期間の関数名）が残っていない')
  assertTrue(scriptSrc23.indexOf('WISH_PERIOD_FIRST_HALF') === -1, '23l. WISH_PERIOD_FIRST_HALF（このファイル内の変数宣言）が残っていない')
  assertTrue(scriptSrc23.indexOf('WISH_PERIOD_SECOND_HALF') === -1, '23m. WISH_PERIOD_SECOND_HALF（このファイル内の変数宣言）が残っていない')
  assertTrue(scriptSrc23.indexOf('function resolveInitialTrainingMonth_') >= 0, '23n. resolveInitialTrainingMonth_（新・初期対象月の関数）が存在する')
}

// ------------------------------------------------------------------
// 24. クライアントがサーバー（getMeisterTrainingCandidates）へperiodを渡していないこと
//     （実際の呼び出し引数を検証する。テスト5dの引数個数チェックに加え、値そのものが
//     periodらしき文字列（'first_half'/'second_half'）でないことも確認する）
// ------------------------------------------------------------------
{
  var env24 = loadMeisterBulkClientEnv_(new Date(2026, 9, 10))
  env24.sandbox.loadMeisterBulkView()
  env24.callLog[env24.callLog.length - 1].resolve({ success: true, rows: [], skill_priority: sampleSkillPriorityWithButtons_() })
  var btn24 = env24.document.getElementById('meister_skill_priority_list').children[0].children.filter(function (c) { return c.className.indexOf('candidate-btn') >= 0 })[0]
  btn24._fireEvent('click')
  var call24 = env24.callLog.filter(function (c) { return c.name === 'getMeisterTrainingCandidates' })[0]
  assertEqual(call24.args, ['麺上げ', 2026, 10], '24a. getMeisterTrainingCandidatesへ渡す引数は技能名・年・月のみ（periodを含まない）')
  assertTrue(call24.args.indexOf('first_half') === -1 && call24.args.indexOf('second_half') === -1, '24b. 引数にfirst_half/second_half相当の値を渡していない')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのCSSレイアウト・スマホ幅での見た目')
console.log('- モーダルのキーボード操作（Tab移動）・実際のクリック操作の感触')
console.log('- google.script.runの実際の通信タイミング・GAS側の実行時間')
console.log('- number input・radioボタンの実際のブラウザ挙動（フェイクDOMでのvalue/checked操作のみ検証）')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
