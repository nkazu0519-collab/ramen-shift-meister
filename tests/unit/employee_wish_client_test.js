// 従業員希望シフト一括提出（レビュー対応 2026-09-22、指摘まとめの「追加テスト」）:
// view_employee_wish.html・js_employee_wish.htmlの専用クライアントテスト。
// ルーティング（web.gsのdoGet）、サイドバーリンク、確認用画面の注記、複数日選択、未提出表示、
// 連打防止、通信失敗時の入力維持、勤務時間表示を、可能な範囲で本番関数をVM・簡易DOMで実行して
// 確認する（単なる文字列存在確認だけにしない）。ロジックをこのファイルへ再実装しない。
//
// 実行: node employee_wish_client_test.js
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
function assertContains(haystack, needle, label) {
  var ok = String(haystack).indexOf(needle) >= 0
  var displayed = String(haystack).length > 120 ? String(haystack).slice(0, 120) + '...(略)' : haystack
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(displayed))
  if (ok) pass++; else fail++
}

function extractScriptBody_(html) {
  var m = html.match(/<script>([\s\S]*)<\/script>/)
  if (!m) throw new Error('scriptタグが見つかりません')
  return m[1]
}

/**
 *  最小限のフェイクDOM要素。js_employee_wish.htmlが実際に使う範囲（value、textContent、hidden、
 *  disabled、className・classList.add/remove/toggle、setAttribute/getAttribute、
 *  appendChild/removeChild/firstChild、children、addEventListener、dataset、options/remove）
 *  だけを再現する（shift_modal_skill_display_test.jsのフェイクDOMと同じ最小主義の方針）。
 */
function createFakeElement_(tag) {
  var classes = {}
  var attrs = {}
  var listeners = {}
  var el = {
    tagName: tag,
    value: '',
    textContent: '',
    hidden: false,
    disabled: false,
    className: '',
    dataset: {},
    children: [],
    options: [], // select専用（テスト側から直接参照する）
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
    appendChild: function (child) {
      el.children.push(child)
      if (!el.firstChild) el.firstChild = child
      if (tag === 'select') el.options.push(child)
      return child
    },
    removeChild: function (child) {
      var idx = el.children.indexOf(child)
      if (idx >= 0) el.children.splice(idx, 1)
      el.firstChild = el.children.length > 0 ? el.children[0] : null
    },
    remove: function (indexOrNothing) {
      // select.remove(1)相当（js_employee_wish.htmlのrenderWishEmployeeOptions_が使う）
      if (typeof indexOrNothing === 'number') {
        el.options.splice(indexOrNothing, 1)
        el.children.splice(indexOrNothing, 1)
      }
    },
    addEventListener: function (type, handler) {
      listeners[type] = listeners[type] || []
      listeners[type].push(handler)
    },
    _fire: function (type, event) {
      (listeners[type] || []).forEach(function (h) { h(event) })
    },
    firstChild: null
  }
  return el
}

/**
 *  document.getElementById(id)が常に一貫した同一インスタンスを返すフェイクdocument。
 *  必要な要素IDはテスト側で事前にすべて作成しておく（view_employee_wish.htmlのid一覧に対応）。
 */
function createFakeDocument_() {
  var elements = {}
  var ids = [
    'wish_employee_select', 'wish_year_select', 'wish_month_select',
    'wish_period_first_btn', 'wish_period_second_btn', 'wish_deadline_note', 'wish_period_message',
    'wish_editor_card', 'wish_calendar', 'wish_answer_time_btn', 'wish_answer_unavailable_btn',
    'wish_apply_start_field', 'wish_apply_end_field', 'wish_apply_start_time', 'wish_apply_end_time',
    'wish_apply_message', 'wish_apply_btn',
    'wish_submit_message', 'wish_submit_btn'
  ]
  ids.forEach(function (id) {
    var tag = (id.indexOf('select') >= 0) ? 'select' : (id.indexOf('_time') >= 0 ? 'input' : 'div')
    elements[id] = createFakeElement_(tag)
  })
  return {
    getElementById: function (id) {
      if (!elements[id]) throw new Error('未登録のid: ' + id)
      return elements[id]
    },
    createElement: function (tag) { return createFakeElement_(tag) },
    _elements: elements
  }
}

/**
 *  google.script.runのフェイク。呼び出しごとにキューへ積み、テスト側がresolve/rejectを
 *  明示的に呼ぶことで、withSuccessHandler/withFailureHandlerの非同期コールバックを
 *  同期的に制御できるようにする（通信失敗・連打防止のテストで使う）。
 */
function createFakeGoogleScriptRun_(callLog) {
  function makeRunner() {
    var successHandler = null
    var failureHandler = null
    var proxy // withSuccessHandler/withFailureHandler・関数呼び出しのいずれも、後続チェーンのために
               // Proxyインスタンス自身（生のrunnerではなく）を返す必要があるため、先に変数だけ用意する
    var runner = {
      withSuccessHandler: function (fn) { successHandler = fn; return proxy },
      withFailureHandler: function (fn) { failureHandler = fn; return proxy }
    }
    // すべての公開関数名をこのProxy相当で受け付ける（実際の呼び出し名はcallLogへ記録する）
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
  // 実際のgoogle.script.runも、呼び出しのたびに独立したbuilderとして働く（本番コードは
  // 常にgoogle.script.run.withSuccessHandler(...)...の形で毎回新しく組み立てて使うため、
  // ここでもgetterで参照のたびに新しいrunnerを返す）
  return { script: { get run() { return makeRunner() } } }
}

/**
 *  js_home_common.html・js_employee_wish.htmlのscript本体を1つのVMコンテキストへ読み込む。
 *  document・google.script.runはフェイクへ差し替える。
 */
function loadWishClientEnv_() {
  var homeCommonHtml = fs.readFileSync(path.join(APP_DIR, 'js_home_common.html'), 'utf8')
  var wishClientHtml = fs.readFileSync(path.join(APP_DIR, 'js_employee_wish.html'), 'utf8')

  var fakeDocument = createFakeDocument_()
  var callLog = []
  var fakeGoogle = createFakeGoogleScriptRun_(callLog)

  var sandbox = {
    console: console,
    document: fakeDocument,
    google: fakeGoogle,
    Object: Object,
    JSON: JSON,
    Date: Date,
    String: String,
    Number: Number
  }
  vm.createContext(sandbox)
  vm.runInContext(extractScriptBody_(homeCommonHtml), sandbox, { filename: 'js_home_common.html' })
  vm.runInContext(extractScriptBody_(wishClientHtml), sandbox, { filename: 'js_employee_wish.html' })

  return { sandbox: sandbox, document: fakeDocument, callLog: callLog }
}

console.log('検証対象: view_employee_wish.html（構造・doGetルーティング）, js_employee_wish.html（クライアントロジック）')
console.log('---')

// ------------------------------------------------------------------
// 1. web.gsのdoGetが?page=wishをview_employee_wish.htmlへルーティングする
// ------------------------------------------------------------------
{
  var webGsSrc = fs.readFileSync(path.join(APP_DIR, 'web.gs'), 'utf8')
  assertContains(webGsSrc, "page === 'wish'", '1a. doGetが?page=wishの分岐を持つ')
  var wishBranchMatch = webGsSrc.match(/page === 'wish'[\s\S]{0,200}/)
  assertTrue(wishBranchMatch && wishBranchMatch[0].indexOf('view_employee_wish') >= 0,
    '1b. wish分岐がview_employee_wish.htmlをレンダリングする')
}

// ------------------------------------------------------------------
// 2. サイドバーに「希望シフト提出」のリンクがあり、?page=wishを指す
// ------------------------------------------------------------------
{
  var sidebarSrc = fs.readFileSync(path.join(APP_DIR, 'app_sidebar.html'), 'utf8')
  assertContains(sidebarSrc, '希望シフト提出', '2a. サイドバーに「希望シフト提出」という項目名がある')
  var wishLinkMatch = sidebarSrc.match(/[^\n]*page=wish[^\n]*/)
  assertTrue(!!wishLinkMatch, '2b. サイドバーに?page=wishへのリンクがある')
}

// ------------------------------------------------------------------
// 3. view_employee_wish.htmlに確認用画面の注記が明示されている
// ------------------------------------------------------------------
{
  var viewSrc = fs.readFileSync(path.join(APP_DIR, 'view_employee_wish.html'), 'utf8')
  assertContains(viewSrc, '確認用画面です。従業員選択はログインではありません', '3. 確認用画面の注記が画面に含まれる')
}

// ------------------------------------------------------------------
// 3x. 提出内容の確認カード・下部一覧を削除し、カレンダーが確認表示を兼ねる構成になっている
//     （2026-09-25、UI整理）。view_employee_wish.htmlのHTML構造を静的に検証する
// ------------------------------------------------------------------
{
  var viewSrc3x = fs.readFileSync(path.join(APP_DIR, 'view_employee_wish.html'), 'utf8')

  assertTrue(viewSrc3x.indexOf('wish_summary_card') === -1, '3x-a. wish_summary_cardが画面に存在しない')
  assertTrue(viewSrc3x.indexOf('wish_summary_list') === -1, '3x-b. wish_summary_listが画面に存在しない')
  assertTrue(viewSrc3x.indexOf('提出内容の確認') === -1, '3x-c. 「提出内容の確認」という独立見出しが存在しない')

  var editorCardMatch3x = viewSrc3x.match(/<div class="card card--feature" id="wish_editor_card"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)
  assertTrue(!!editorCardMatch3x, '3x-d. wish_editor_cardのブロックを抽出できる')
  var editorCardHtml3x = editorCardMatch3x ? editorCardMatch3x[0] : ''
  assertTrue(editorCardHtml3x.indexOf('id="wish_submit_message"') >= 0, '3x-e. wish_submit_messageがwish_editor_card内にある')
  assertTrue(editorCardHtml3x.indexOf('id="wish_submit_btn"') >= 0, '3x-f. wish_submit_btnがwish_editor_card内にある')
}

// ------------------------------------------------------------------
// 4. 複数日選択→選択日へ適用で、wishPendingByDate_へ反映され、選択状態がクリアされる
// ------------------------------------------------------------------
{
  var env4 = loadWishClientEnv_()
  var sb4 = env4.sandbox
  sb4.wishSelectedEmpId_ = '1001'
  sb4.wishServerDays_ = [
    { date: '2026-10-01', work_registered: false, work_time_labels: [], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false },
    { date: '2026-10-02', work_registered: false, work_time_labels: [], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false }
  ]
  sb4.wishSelectedDates_ = { '2026-10-01': true, '2026-10-02': true }
  sb4.wishApplyAnswerType_ = '時間希望'
  env4.document.getElementById('wish_apply_start_time').value = '11:00'
  env4.document.getElementById('wish_apply_end_time').value = '15:00'

  sb4.handleWishApplyToSelectedDates_()

  assertEqual(Object.keys(sb4.wishSelectedDates_).length, 0, '4a. 適用後、選択状態はクリアされる（別の日付群を続けて選べる）')
  assertEqual(sb4.wishPendingByDate_['2026-10-01'], { answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }, '4b. 選択した日付すべてにwishPendingByDate_が設定される（10/1）')
  assertEqual(sb4.wishPendingByDate_['2026-10-02'], { answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }, '4c. 選択した日付すべてにwishPendingByDate_が設定される（10/2）')

  // カレンダーが確認表示を兼ねるため、適用後は再描画されたカレンダーセルへ「未提出」が反映される
  var calendar4 = env4.document.getElementById('wish_calendar')
  var cellStatus4a = calendar4.children[0].children[1].textContent
  var cellStatus4b = calendar4.children[1].children[1].textContent
  assertContains(cellStatus4a, '（未提出）', '4d. 適用後、カレンダーセル（10/1）に「未提出」が反映される')
  assertContains(cellStatus4b, '（未提出）', '4e. 適用後、カレンダーセル（10/2）に「未提出」が反映される')
  assertContains(cellStatus4a, '11:00〜15:00', '4f. 適用後、カレンダーセルに設定した時間が表示される')

  // 未提出変更がある場合だけ提出ボタンが有効になる
  assertTrue(!env4.document.getElementById('wish_submit_btn').disabled, '4g. 未提出の変更がある場合、提出ボタンが有効になる')

  // 適用文言も新しいカード配置に合わせて更新されている
  assertContains(env4.document.getElementById('wish_apply_message').textContent, '選択した2日へ設定しました', '4h. 適用メッセージに設定件数が含まれる')
  assertContains(env4.document.getElementById('wish_apply_message').textContent, 'まとめて提出', '4i. 適用メッセージが「まとめて提出」を押すよう案内する')
  assertTrue(env4.document.getElementById('wish_apply_message').textContent.indexOf('画面下の確認一覧') === -1, '4j. 適用メッセージに旧文言「画面下の確認一覧」が含まれない')
}

// ------------------------------------------------------------------
// 4y. 未提出変更が0件なら提出ボタンは無効のまま（updateWishSubmitState_の初期判定）
// ------------------------------------------------------------------
{
  var env4y = loadWishClientEnv_()
  var sb4y = env4y.sandbox
  sb4y.wishServerDays_ = [
    { date: '2026-10-01', work_registered: false, work_time_labels: [], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false }
  ]
  sb4y.wishPendingByDate_ = {}
  sb4y.updateWishSubmitState_()
  assertTrue(env4y.document.getElementById('wish_submit_btn').disabled, '4y. 未提出変更が0件のとき提出ボタンは無効')
}

// ------------------------------------------------------------------
// 5. 未設定日はbuildWishDayStatusText_が「未設定」を返す（未提出と出勤不可を区別する表示）
// ------------------------------------------------------------------
{
  var env5 = loadWishClientEnv_()
  var sb5 = env5.sandbox
  var serverDay5 = { date: '2026-10-03', work_registered: false, work_time_labels: [], answer_type: null, conflict: false }
  var display5 = sb5.resolveWishDayDisplay_(serverDay5)
  assertEqual(sb5.buildWishDayStatusText_(serverDay5, display5), '未設定', '5. 未提出日の状態文言は「未設定」')
}

// ------------------------------------------------------------------
// 6. 「まとめて提出」の連打防止（送信中に2回目を呼んでもgoogle.script.runは1回しか呼ばれない）
// ------------------------------------------------------------------
{
  var env6 = loadWishClientEnv_()
  var sb6 = env6.sandbox
  sb6.wishSelectedEmpId_ = '1001'
  sb6.wishSelectedYear_ = 2026
  sb6.wishSelectedMonth_ = 10
  sb6.wishSelectedPeriod_ = 'first_half'
  sb6.wishPendingByDate_ = { '2026-10-01': { answer_type: '時間希望', start_time: '11:00', end_time: '15:00' } }

  sb6.handleWishSubmitBulk_() // 1回目（未解決のまま連打を試みる）
  var callCountAfterFirst6 = env6.callLog.filter(function (c) { return c.name === 'submitEmployeeShiftWishesBulk' }).length
  sb6.handleWishSubmitBulk_() // 2回目（連打）
  var callCountAfterSecond6 = env6.callLog.filter(function (c) { return c.name === 'submitEmployeeShiftWishesBulk' }).length

  assertEqual(callCountAfterFirst6, 1, '6a. 1回目の提出でsubmitEmployeeShiftWishesBulkが呼ばれる')
  assertEqual(callCountAfterSecond6, 1, '6b. 送信中（未解決）の連打では2回目は呼ばれない（連打防止）')
}

// ------------------------------------------------------------------
// 7. 通信失敗時は入力中の内容（wishPendingByDate_）を画面に残す
// ------------------------------------------------------------------
{
  var env7 = loadWishClientEnv_()
  var sb7 = env7.sandbox
  sb7.wishSelectedEmpId_ = '1001'
  sb7.wishSelectedYear_ = 2026
  sb7.wishSelectedMonth_ = 10
  sb7.wishSelectedPeriod_ = 'first_half'
  sb7.wishPendingByDate_ = { '2026-10-01': { answer_type: '時間希望', start_time: '11:00', end_time: '15:00' } }
  var pendingBeforeFailure7 = JSON.parse(JSON.stringify(sb7.wishPendingByDate_))

  sb7.handleWishSubmitBulk_()
  var call7 = env7.callLog[env7.callLog.length - 1]
  call7.reject({ message: 'ネットワークエラー' }) // 通信失敗を模擬

  assertEqual(sb7.wishPendingByDate_, pendingBeforeFailure7, '7a. 通信失敗時、wishPendingByDate_（入力中の内容）は消えずに残る')
  assertEqual(sb7.wishSubmitInProgress_, false, '7b. 通信失敗後は連打防止フラグが解除され、再送信できる状態に戻る')
  assertContains(env7.document.getElementById('wish_submit_message').textContent, 'ネットワークエラー', '7c. 失敗メッセージが画面に表示される')
}

// ------------------------------------------------------------------
// 8. 成功時はwishPendingByDate_がクリアされ、保存済み表示へ更新される
// ------------------------------------------------------------------
{
  var env8 = loadWishClientEnv_()
  var sb8 = env8.sandbox
  sb8.wishSelectedEmpId_ = '1001'
  sb8.wishSelectedYear_ = 2026
  sb8.wishSelectedMonth_ = 10
  sb8.wishSelectedPeriod_ = 'first_half'
  sb8.wishPendingByDate_ = { '2026-10-01': { answer_type: '時間希望', start_time: '11:00', end_time: '15:00' } }

  sb8.handleWishSubmitBulk_()
  var call8 = env8.callLog[env8.callLog.length - 1]
  call8.resolve({ success: true, message: '希望シフトをまとめて提出しました（1件）' })

  assertEqual(sb8.wishPendingByDate_, {}, '8a. 成功時、wishPendingByDate_はクリアされる')
  assertEqual(sb8.wishSubmitInProgress_, false, '8b. 成功後は連打防止フラグが解除される')
  // 成功時はloadWishPeriodData_が呼ばれ、最新状態の再取得が走る
  var reloadCall8 = env8.callLog.filter(function (c) { return c.name === 'getEmployeeWishPeriodData' })
  assertTrue(reloadCall8.length >= 1, '8c. 成功後、最新の期間データを再取得する（getEmployeeWishPeriodData）')
}

// ------------------------------------------------------------------
// 9. 勤務登録済みの日は、サーバーのwork_time_labelsがそのままカレンダーの文言に使われる
// ------------------------------------------------------------------
{
  var env9 = loadWishClientEnv_()
  var sb9 = env9.sandbox
  var serverDay9 = { date: '2026-10-04', work_registered: true, work_time_labels: ['12時00分〜20時00分'], answer_type: null, conflict: false }
  var display9 = sb9.resolveWishDayDisplay_(serverDay9)
  assertEqual(sb9.buildWishDayStatusText_(serverDay9, display9), '勤務登録済み 12時00分〜20時00分', '9a. 勤務登録済み日は時間帯付きで表示される')

  var serverDayMulti9 = { date: '2026-10-05', work_registered: true, work_time_labels: ['11時00分〜14時00分', '18時00分〜21時00分'], answer_type: null, conflict: false }
  var displayMulti9 = sb9.resolveWishDayDisplay_(serverDayMulti9)
  assertEqual(sb9.buildWishDayStatusText_(serverDayMulti9, displayMulti9), '勤務登録済み 11時00分〜14時00分、18時00分〜21時00分', '9b. 複数勤務は読点区切りですべて表示される')
}

// ------------------------------------------------------------------
// 10. 勤務登録済み・競合の日はカレンダーセルが選択不可になる（クリックハンドラが登録されない）
// ------------------------------------------------------------------
{
  var env10 = loadWishClientEnv_()
  var sb10 = env10.sandbox
  sb10.wishServerDays_ = [
    { date: '2026-10-06', work_registered: true, work_time_labels: ['12時00分〜17時00分'], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false },
    { date: '2026-10-07', work_registered: false, work_time_labels: [], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false }
  ]
  sb10.wishSelectedDates_ = {}
  sb10.renderWishCalendar_()

  var calendar10 = env10.document.getElementById('wish_calendar')
  var registeredCell10 = calendar10.children[0]
  var openCell10 = calendar10.children[1]
  assertTrue(registeredCell10.disabled, '10a. 勤務登録済みの日のセルはdisabledになる')
  assertTrue(!openCell10.disabled, '10b. 未登録の日のセルはdisabledにならない')
}

// ------------------------------------------------------------------
// 11. JSが削除済みDOM（wish_summary_card・wish_summary_list）を参照しない。
//     フェイクdocumentは未登録のidをgetElementByIdすると例外を投げるため、
//     wish_summary_card・wish_summary_listを登録しない状態でも一連の操作が例外なく動くことで確認する
// ------------------------------------------------------------------
{
  var env11 = loadWishClientEnv_()
  var sb11 = env11.sandbox
  sb11.wishSelectedEmpId_ = '1001'
  sb11.wishServerDays_ = [
    { date: '2026-10-01', work_registered: false, work_time_labels: [], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false }
  ]

  var threw11 = false
  var threwMessage11 = ''
  try {
    // loadWishPeriodData_の成功パス（successHandler）を実際に通し、
    // 内部でwish_summary_card等の未登録idを参照していないかを確認する
    sb11.loadWishPeriodData_()
    var call11 = env11.callLog[env11.callLog.length - 1]
    call11.resolve({
      success: true,
      days: [
        { date: '2026-10-01', work_registered: false, work_time_labels: [], answer_type: null, start_time: '', end_time: '', wish_id: '', after_deadline: false, conflict: false }
      ],
      deadline_ms: null
    })
  } catch (e) {
    threw11 = true
    threwMessage11 = e.message
  }
  assertTrue(!threw11, '11a. loadWishPeriodData_成功パスが未登録id（wish_summary_card等）を参照せず例外を投げない' + (threw11 ? ' (' + threwMessage11 + ')' : ''))

  var threw11b = false
  try {
    sb11.wishSelectedDates_ = { '2026-10-01': true }
    sb11.wishApplyAnswerType_ = '出勤不可'
    sb11.handleWishApplyToSelectedDates_()
  } catch (e) {
    threw11b = true
  }
  assertTrue(!threw11b, '11b. handleWishApplyToSelectedDates_（内部でupdateWishSubmitState_を呼ぶ）が未登録idを参照せず例外を投げない')
}

// ------------------------------------------------------------------
// 12. 保存済み・期限後の時間希望セルに期限後専用クラス（wish-day-cell--after-deadline）が付く。
//     通常期限内の保存済み希望には付かない（2026-09-25、レビュー対応・指摘1）
// ------------------------------------------------------------------
{
  var env12 = loadWishClientEnv_()
  var sb12 = env12.sandbox
  sb12.wishServerDays_ = [
    { date: '2026-10-01', work_registered: false, work_time_labels: [], answer_type: '時間希望', start_time: '11:00', end_time: '15:00', wish_id: 'w1', after_deadline: true, conflict: false },
    { date: '2026-10-02', work_registered: false, work_time_labels: [], answer_type: '時間希望', start_time: '11:00', end_time: '15:00', wish_id: 'w2', after_deadline: false, conflict: false }
  ]
  sb12.wishSelectedDates_ = {}
  sb12.renderWishCalendar_()

  var calendar12 = env12.document.getElementById('wish_calendar')
  var afterDeadlineCell12 = calendar12.children[0]
  var onTimeCell12 = calendar12.children[1]
  assertTrue(afterDeadlineCell12.className.indexOf('wish-day-cell--after-deadline') >= 0, '12a. 保存済み・期限後の時間希望セルに期限後専用クラスが付く')
  assertTrue(onTimeCell12.className.indexOf('wish-day-cell--after-deadline') === -1, '12b. 通常期限内の保存済み希望には期限後専用クラスが付かない')
}

// ------------------------------------------------------------------
// 13. 保存済み・期限後の出勤不可セルにも期限後専用クラスが付く
// ------------------------------------------------------------------
{
  var env13 = loadWishClientEnv_()
  var sb13 = env13.sandbox
  sb13.wishServerDays_ = [
    { date: '2026-10-03', work_registered: false, work_time_labels: [], answer_type: '出勤不可', start_time: '', end_time: '', wish_id: 'w3', after_deadline: true, conflict: false }
  ]
  sb13.wishSelectedDates_ = {}
  sb13.renderWishCalendar_()

  var cell13 = env13.document.getElementById('wish_calendar').children[0]
  assertTrue(cell13.className.indexOf('wish-day-cell--after-deadline') >= 0, '13. 保存済み・期限後の出勤不可セルにも期限後専用クラスが付く')
}

// ------------------------------------------------------------------
// 14. 未提出変更には、元データが期限後でも期限後専用クラスを付けない。
//     勤務登録済み・競合日には期限後専用クラスを付けない
// ------------------------------------------------------------------
{
  var env14 = loadWishClientEnv_()
  var sb14 = env14.sandbox
  sb14.wishServerDays_ = [
    // 元は期限後の保存済みだが、pendingで上書き中（is_pending）の日
    { date: '2026-10-04', work_registered: false, work_time_labels: [], answer_type: '時間希望', start_time: '11:00', end_time: '15:00', wish_id: 'w4', after_deadline: true, conflict: false },
    // 期限後フラグは立っているが勤務登録済みの日
    { date: '2026-10-05', work_registered: true, work_time_labels: ['12時00分〜17時00分'], answer_type: '時間希望', start_time: '', end_time: '', wish_id: 'w5', after_deadline: true, conflict: false },
    // 期限後フラグは立っているが競合日
    { date: '2026-10-06', work_registered: false, work_time_labels: [], answer_type: '時間希望', start_time: '11:00', end_time: '15:00', wish_id: 'w6', after_deadline: true, conflict: true }
  ]
  sb14.wishPendingByDate_ = { '2026-10-04': { answer_type: '出勤不可', start_time: '', end_time: '' } }
  sb14.wishSelectedDates_ = {}
  sb14.renderWishCalendar_()

  var calendar14 = env14.document.getElementById('wish_calendar')
  assertTrue(calendar14.children[0].className.indexOf('wish-day-cell--after-deadline') === -1, '14a. 未提出変更中の日は、元データが期限後でも期限後専用クラスを付けない')
  assertTrue(calendar14.children[1].className.indexOf('wish-day-cell--after-deadline') === -1, '14b. 勤務登録済みの日には期限後専用クラスを付けない')
  assertTrue(calendar14.children[2].className.indexOf('wish-day-cell--after-deadline') === -1, '14c. 競合日には期限後専用クラスを付けない')
}

// ------------------------------------------------------------------
// 15. 期限後セルの表示文字列に、目立つ「期限後」という文言を追加していない
//     （識別はクラス・aria-labelで行い、セル内文言は変えない）
// ------------------------------------------------------------------
{
  var env15 = loadWishClientEnv_()
  var sb15 = env15.sandbox
  sb15.wishServerDays_ = [
    { date: '2026-10-07', work_registered: false, work_time_labels: [], answer_type: '時間希望', start_time: '11:00', end_time: '15:00', wish_id: 'w7', after_deadline: true, conflict: false }
  ]
  sb15.wishSelectedDates_ = {}
  sb15.renderWishCalendar_()

  var cell15 = env15.document.getElementById('wish_calendar').children[0]
  var statusText15 = cell15.children[1].textContent
  assertEqual(statusText15, '11:00〜15:00', '15a. 期限後セルの表示文字列に「期限後」という文言を追加していない')
  assertContains(cell15.getAttribute('aria-label'), '期限後に提出済み', '15b. 色だけに依存しないよう、aria-labelへ「期限後に提出済み」を含める')
}

// ------------------------------------------------------------------
// 16. 従業員・年月・前半後半の切替で提出メッセージがクリアされる（2026-09-25、レビュー対応・指摘2）
// ------------------------------------------------------------------
{
  var env16 = loadWishClientEnv_()
  var sb16 = env16.sandbox
  env16.document.getElementById('wish_submit_message').textContent = '要店主確認の日があります。まとめて提出は可能ですが、その日は含まれません'
  sb16.wishSelectedEmpId_ = '' // 従業員未選択に戻すことでgoogle.script.run呼び出しを避け、リセット処理だけを見る
  sb16.handleWishEmployeeChange_()
  assertEqual(env16.document.getElementById('wish_submit_message').textContent, '', '16a. 従業員切替で提出メッセージがクリアされる')

  var env16b = loadWishClientEnv_()
  var sb16b = env16b.sandbox
  env16b.document.getElementById('wish_submit_message').textContent = '提出に失敗しました: ネットワークエラー'
  sb16b.wishSelectedEmpId_ = ''
  sb16b.handleWishPeriodInputChange_()
  assertEqual(env16b.document.getElementById('wish_submit_message').textContent, '', '16b. 年月切替で提出メッセージがクリアされる')

  var env16c = loadWishClientEnv_()
  var sb16c = env16c.sandbox
  env16c.document.getElementById('wish_submit_message').textContent = '希望シフトをまとめて提出しました（1件）'
  sb16c.wishSelectedEmpId_ = ''
  sb16c.handleWishPeriodChange_('second_half')
  assertEqual(env16c.document.getElementById('wish_submit_message').textContent, '', '16c. 前半後半切替で提出メッセージがクリアされる')
}

// ------------------------------------------------------------------
// 17. 提出成功直後の再読み込みでは、成功メッセージが維持される
//     （handleWishSubmitBulk_の成功処理はresetWishPendingAndSelection_を経由しないため、
//     指摘2の対応がこの挙動を壊していないことを確認する）
// ------------------------------------------------------------------
{
  var env17 = loadWishClientEnv_()
  var sb17 = env17.sandbox
  sb17.wishSelectedEmpId_ = '1001'
  sb17.wishSelectedYear_ = 2026
  sb17.wishSelectedMonth_ = 10
  sb17.wishSelectedPeriod_ = 'first_half'
  sb17.wishPendingByDate_ = { '2026-10-01': { answer_type: '時間希望', start_time: '11:00', end_time: '15:00' } }

  sb17.handleWishSubmitBulk_()
  var call17 = env17.callLog[env17.callLog.length - 1]
  call17.resolve({ success: true, message: '希望シフトをまとめて提出しました（1件）' })

  assertEqual(env17.document.getElementById('wish_submit_message').textContent, '希望シフトをまとめて提出しました（1件）', '17. 提出成功直後は、再読み込み後も成功メッセージが維持される')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのCSSレイアウト・スマホ幅での見た目')
console.log('- 実際のカレンダーのクリック操作・タッチ操作の感触')
console.log('- google.script.runの実際の通信タイミング・GAS側の実行時間')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
