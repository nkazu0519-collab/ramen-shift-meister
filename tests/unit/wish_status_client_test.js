// 希望シフト提出状況（07_ブラッシュアップ/02_企画・設計/希望シフト提出状況_最小仕様.md）:
// view_wish_status.html・js_wish_status.htmlの専用クライアントテスト。
// ルーティング（web.gsのdoGet）、サイドバー導線・アクティブ表示、期間切替、通信中・失敗・0人表示、
// 古い通信結果の無視、表示専用（保存・削除・更新処理を呼ばない）を、可能な範囲で本番関数を
// VM・簡易DOMで実行して確認する（単なる文字列存在確認だけにしない）。ロジックをこのファイルへ再実装しない。
//
// 実行: node wish_status_client_test.js
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
 *  最小限のフェイクDOM要素（employee_wish_client_test.jsのcreateFakeElement_と同じ最小主義の方針。
 *  js_wish_status.htmlが実際に使う範囲だけを再現する）。
 */
function createFakeElement_(tag) {
  var classes = {}
  var attrs = {}
  var el = {
    tagName: tag,
    value: '',
    textContent: '',
    hidden: false,
    className: '',
    dataset: {},
    children: [],
    options: [],
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
    firstChild: null
  }
  return el
}

/**
 *  document.getElementById(id)が常に一貫した同一インスタンスを返すフェイクdocument。
 *  view_wish_status.htmlのid一覧に対応する。
 */
function createFakeDocument_() {
  var elements = {}
  var ids = [
    'wish_status_year_select', 'wish_status_month_select',
    'wish_status_period_first_btn', 'wish_status_period_second_btn',
    'wish_status_message', 'wish_status_retry_btn',
    'wish_status_summary_card', 'wish_status_counts',
    'wish_status_list_card', 'wish_status_employee_list'
  ]
  ids.forEach(function (id) {
    var tag = (id.indexOf('select') >= 0) ? 'select' : 'div'
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
 *  google.script.runのフェイク（employee_wish_client_test.jsのcreateFakeGoogleScriptRun_と同じ実装）。
 *  呼び出しごとにキューへ積み、テスト側がresolve/rejectを明示的に呼ぶことで、
 *  withSuccessHandler/withFailureHandlerの非同期コールバックを同期的に制御する。
 */
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
 *  js_home_common.html・js_wish_status.htmlのscript本体を1つのVMコンテキストへ読み込む。
 *  document・google.script.runはフェイクへ差し替える。
 */
function loadWishStatusClientEnv_() {
  var homeCommonHtml = fs.readFileSync(path.join(APP_DIR, 'js_home_common.html'), 'utf8')
  var wishStatusClientHtml = fs.readFileSync(path.join(APP_DIR, 'js_wish_status.html'), 'utf8')

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
  vm.runInContext(extractScriptBody_(wishStatusClientHtml), sandbox, { filename: 'js_wish_status.html' })

  return { sandbox: sandbox, document: fakeDocument, callLog: callLog }
}

console.log('検証対象: view_wish_status.html（構造・doGetルーティング）, js_wish_status.html（クライアントロジック）')
console.log('---')

// ------------------------------------------------------------------
// 1. web.gsのdoGetが?page=wish-statusをview_wish_status.htmlへルーティングする
// ------------------------------------------------------------------
{
  var webGsSrc = fs.readFileSync(path.join(APP_DIR, 'web.gs'), 'utf8')
  assertContains(webGsSrc, "page === 'wish-status'", '1a. doGetが?page=wish-statusの分岐を持つ')
  var wishStatusBranchMatch = webGsSrc.match(/page === 'wish-status'[\s\S]{0,200}/)
  assertTrue(wishStatusBranchMatch && wishStatusBranchMatch[0].indexOf('view_wish_status') >= 0,
    '1b. wish-status分岐がview_wish_status.htmlをレンダリングする')
}

// ------------------------------------------------------------------
// 2. サイドバーに「提出状況」のリンクがあり、?page=wish-statusを指し、シフト管理グループにある
// ------------------------------------------------------------------
{
  var sidebarSrc = fs.readFileSync(path.join(APP_DIR, 'app_sidebar.html'), 'utf8')
  assertContains(sidebarSrc, '提出状況', '2a. サイドバーに「提出状況」という項目名がある')
  var wishStatusLinkMatch = sidebarSrc.match(/[^\n]*page=wish-status[^\n]*/)
  assertTrue(!!wishStatusLinkMatch, '2b. サイドバーに?page=wish-statusへのリンクがある')
  // アクティブ表示: activePage === 'wish-status' の判定式が存在する
  assertContains(sidebarSrc, "activePage === 'wish-status'", '2c. サイドバーがwish-statusをアクティブ表示できる')
  // シフト管理グループ内（「シフト管理」見出しの後、次の見出しより前）にリンクがあることを確認する
  var shiftGroupIndex = sidebarSrc.indexOf('シフト管理')
  var staffGroupIndex = sidebarSrc.indexOf('スタッフ管理')
  var wishStatusLinkIndex = sidebarSrc.indexOf('page=wish-status')
  assertTrue(shiftGroupIndex >= 0 && staffGroupIndex >= 0 && wishStatusLinkIndex > shiftGroupIndex && wishStatusLinkIndex < staffGroupIndex,
    '2d. 「提出状況」リンクは「シフト管理」グループの中にある（「スタッフ管理」グループより前）')
}

// ------------------------------------------------------------------
// 3. view_wish_status.htmlが店主向け画面として構成されている（表示専用・シフト管理メイン画面へのカード追加なし）
// ------------------------------------------------------------------
{
  var viewSrc = fs.readFileSync(path.join(APP_DIR, 'view_wish_status.html'), 'utf8')
  assertContains(viewSrc, '希望シフト提出状況', '3a. 画面タイトルが「希望シフト提出状況」')
  var homeViewSrc = fs.readFileSync(path.join(APP_DIR, 'view_home.html'), 'utf8')
  assertTrue(homeViewSrc.indexOf('wish_status') === -1 && homeViewSrc.indexOf('wish-status') === -1,
    '3b. シフト管理のメイン画面（view_home.html）へ提出状況の新しいカードを追加していない')
}

// ------------------------------------------------------------------
// 4. 初期表示: initWishStatusScreen_が読み込み中表示を経て、getEmployeeWishSubmissionStatusを呼ぶ
// ------------------------------------------------------------------
{
  var env4 = loadWishStatusClientEnv_()
  var sb4 = env4.sandbox
  sb4.initWishStatusScreen_()

  assertEqual(env4.document.getElementById('wish_status_message').textContent, '読み込み中...', '4a. 初期表示中は「読み込み中...」を表示する')
  var call4 = env4.callLog[env4.callLog.length - 1]
  assertEqual(call4.name, 'getEmployeeWishSubmissionStatus', '4b. 初期化時にgetEmployeeWishSubmissionStatusを呼ぶ')
  assertEqual(call4.args, [sb4.wishStatusYear_, sb4.wishStatusMonth_, sb4.wishStatusPeriod_], '4c. 現在年月・今日を含む前半/後半を引数として渡す')

  var today4 = new Date()
  var expectedPeriod4 = today4.getDate() <= 15 ? 'first_half' : 'second_half'
  assertEqual(sb4.wishStatusYear_, today4.getFullYear(), '4d. 初期値の年は現在年')
  assertEqual(sb4.wishStatusMonth_, today4.getMonth() + 1, '4e. 初期値の月は現在月')
  assertEqual(sb4.wishStatusPeriod_, expectedPeriod4, '4f. 初期値の期間は今日を含む前半/後半')
}

// ------------------------------------------------------------------
// 5. 期間切替: 年月変更・前半後半トグルのたびにgetEmployeeWishSubmissionStatusを呼び直す
// ------------------------------------------------------------------
{
  var env5 = loadWishStatusClientEnv_()
  var sb5 = env5.sandbox
  sb5.wishStatusYear_ = 2026
  sb5.wishStatusMonth_ = 10
  sb5.wishStatusPeriod_ = 'first_half'
  env5.callLog.length = 0

  sb5.handleWishStatusPeriodChange_('second_half')
  assertEqual(sb5.wishStatusPeriod_, 'second_half', '5a. トグル操作で期間が切り替わる')
  var call5a = env5.callLog[env5.callLog.length - 1]
  assertEqual(call5a.name, 'getEmployeeWishSubmissionStatus', '5b. 期間トグルのたびにサーバーを呼び直す')
  assertEqual(call5a.args, [2026, 10, 'second_half'], '5c. 切替後の期間で呼び出す')

  env5.document.getElementById('wish_status_year_select').value = '2027'
  env5.document.getElementById('wish_status_month_select').value = '3'
  sb5.handleWishStatusPeriodInputChange_()
  assertEqual(sb5.wishStatusYear_, 2027, '5d. 年セレクトの変更が反映される')
  assertEqual(sb5.wishStatusMonth_, 3, '5e. 月セレクトの変更が反映される')
  var call5b = env5.callLog[env5.callLog.length - 1]
  assertEqual(call5b.args, [2027, 3, 'second_half'], '5f. 年月変更後の値で呼び出す')
}

// ------------------------------------------------------------------
// 6. 通信中は集計・一覧カードを隠す
// ------------------------------------------------------------------
{
  var env6 = loadWishStatusClientEnv_()
  var sb6 = env6.sandbox
  env6.document.getElementById('wish_status_summary_card').hidden = false
  env6.document.getElementById('wish_status_list_card').hidden = false

  sb6.loadWishStatus_()

  assertTrue(env6.document.getElementById('wish_status_summary_card').hidden, '6a. 通信中は集計カードを隠す')
  assertTrue(env6.document.getElementById('wish_status_list_card').hidden, '6b. 通信中は一覧カードを隠す')
  assertEqual(env6.document.getElementById('wish_status_message').textContent, '読み込み中...', '6c. 通信中は「読み込み中...」を表示する')
  assertTrue(env6.document.getElementById('wish_status_retry_btn').hidden, '6d. 初回読み込み中は再読み込みボタンが非表示（レビュー対応指摘2）')
}

// ------------------------------------------------------------------
// 7. 通信失敗時はエラーを表示し、古い一覧を最新結果のように残さない
// ------------------------------------------------------------------
{
  var env7 = loadWishStatusClientEnv_()
  var sb7 = env7.sandbox
  sb7.loadWishStatus_()
  var call7 = env7.callLog[env7.callLog.length - 1]
  call7.reject({ message: 'ネットワークエラー' })

  assertContains(env7.document.getElementById('wish_status_message').textContent, 'ネットワークエラー', '7a. 通信失敗時にエラーメッセージを表示する')
  assertTrue(env7.document.getElementById('wish_status_summary_card').hidden, '7b. 通信失敗時、集計カードは表示しない（古い結果を最新として残さない）')
  assertTrue(env7.document.getElementById('wish_status_list_card').hidden, '7c. 通信失敗時、一覧カードは表示しない')
  assertTrue(!env7.document.getElementById('wish_status_retry_btn').hidden, '7d. 通信失敗後に再読み込みボタンが表示される（レビュー対応指摘2）')
}

// ------------------------------------------------------------------
// 8. 従業員0人の場合はエラーではなく「従業員が登録されていません」と表示する
// ------------------------------------------------------------------
{
  var env8 = loadWishStatusClientEnv_()
  var sb8 = env8.sandbox
  sb8.loadWishStatus_()
  var call8 = env8.callLog[env8.callLog.length - 1]
  call8.resolve({
    success: true, year: 2026, month: 10, period: 'first_half', target_day_count: 15, deadline_ms: 0,
    counts: { complete: 0, partial: 0, none: 0, late: 0, conflict: 0 }, employees: []
  })

  assertEqual(env8.document.getElementById('wish_status_message').textContent, '従業員が登録されていません', '8a. 従業員0人はエラーではなく専用メッセージを表示する')
  assertTrue(env8.document.getElementById('wish_status_summary_card').hidden, '8b. 従業員0人のときは集計カードを表示しない')
  assertTrue(env8.document.getElementById('wish_status_list_card').hidden, '8c. 従業員0人のときは一覧カードを表示しない')
  assertTrue(env8.document.getElementById('wish_status_retry_btn').hidden, '8d. 従業員0人（success:trueの一種）では再読み込みボタンを表示しない（レビュー対応指摘2）')
}

// ------------------------------------------------------------------
// 9. 正常応答時、集計カード・従業員一覧カードを表示し、並び順のまま描画する
// ------------------------------------------------------------------
{
  var env9 = loadWishStatusClientEnv_()
  var sb9 = env9.sandbox
  sb9.loadWishStatus_()
  var call9 = env9.callLog[env9.callLog.length - 1]
  var result9 = {
    success: true, year: 2026, month: 10, period: 'first_half', target_day_count: 15, deadline_ms: 123,
    counts: { complete: 1, partial: 1, none: 1, late: 1, conflict: 1 },
    employees: [
      { employee_id: '1003', employee_name: '鈴木一郎', status: 'conflict', answered_day_count: 3, target_day_count: 15, remaining_day_count: 12, has_late_submission: false, conflict_date_count: 1 },
      { employee_id: '1001', employee_name: '山田太郎', status: 'none', answered_day_count: 0, target_day_count: 15, remaining_day_count: 15, has_late_submission: false, conflict_date_count: 0 },
      { employee_id: '1002', employee_name: '佐藤花子', status: 'partial', answered_day_count: 10, target_day_count: 15, remaining_day_count: 5, has_late_submission: true, conflict_date_count: 0 }
    ]
  }
  call9.resolve(result9)

  assertEqual(env9.document.getElementById('wish_status_message').textContent, '', '9a. 正常応答時はメッセージをクリアする')
  assertTrue(!env9.document.getElementById('wish_status_summary_card').hidden, '9b. 正常応答時は集計カードを表示する')
  assertTrue(!env9.document.getElementById('wish_status_list_card').hidden, '9c. 正常応答時は一覧カードを表示する')
  assertTrue(env9.document.getElementById('wish_status_retry_btn').hidden, '9i. 正常取得後は再読み込みボタンを表示しない（レビュー対応指摘2）')

  var listEl9 = env9.document.getElementById('wish_status_employee_list')
  assertEqual(listEl9.children.length, 3, '9d. 一覧はサーバーが返した従業員数ぶん描画する')
  var names9 = listEl9.children.map(function (row) {
    return row.children.filter(function (c) { return c.className.indexOf('wish-status-row__name') >= 0 })[0].textContent
  })
  assertEqual(names9, ['鈴木一郎', '山田太郎', '佐藤花子'], '9e. サーバーが返した並び順のまま描画する（クライアント側で並び替えない）')

  // 9f/9g: has_late_submission=trueの従業員（佐藤花子）でも「期限後あり」バッジを描画しない
  //        （最小仕様5. レビュー対応 2026-09-22）
  var lateRow9 = listEl9.children[2]
  var lateBadge9 = lateRow9.children.filter(function (c) { return c.className.indexOf('wish-status-row__late') >= 0 })
  assertEqual(lateBadge9.length, 0, '9f. has_late_submission=trueの従業員でも期限後ありバッジ要素を描画しない')
  var noLateRow9 = listEl9.children[0]
  var noLateBadge9 = noLateRow9.children.filter(function (c) { return c.className.indexOf('wish-status-row__late') >= 0 })
  assertEqual(noLateBadge9.length, 0, '9g. has_late_submission=falseの従業員にも期限後ありバッジ要素はない')

  // 一覧全体のどの行にも「期限後あり」という表示文字列が現れないことを確認する
  var anyLateText9 = listEl9.children.some(function (row) {
    return row.children.some(function (c) { return c.textContent === '期限後あり' })
  })
  assertTrue(!anyLateText9, '9j. 従業員一覧のどの行にも「期限後あり」という表示文字列が現れない')

  var countsEl9 = env9.document.getElementById('wish_status_counts')
  // dt(ラベル)+dd(値)が4組（提出済み・一部提出・未提出・要確認）= 8要素。counts.late > 0でも「期限後あり」は描画しない
  assertEqual(countsEl9.children.length, 8, '9h. 要確認人数が1人以上のときは要確認を含めた4項目（提出済み・一部提出・未提出・要確認）を表示する')
  var countLabels9 = countsEl9.children.filter(function (c) { return c.className.indexOf('wish-status-counts__label') >= 0 }).map(function (c) { return c.textContent })
  assertEqual(countLabels9, ['提出済み', '一部提出', '未提出', '要確認'], '9k. 上部集計のラベルに「期限後あり」を含まない（result.counts.late=1でも描画しない）')
}

// ------------------------------------------------------------------
// 10. 要確認人数が0人のときは集計に要確認を表示しない（提出済み・一部提出・未提出の3項目のみ）
// ------------------------------------------------------------------
{
  var env10 = loadWishStatusClientEnv_()
  var sb10 = env10.sandbox
  sb10.loadWishStatus_()
  var call10 = env10.callLog[env10.callLog.length - 1]
  call10.resolve({
    success: true, year: 2026, month: 10, period: 'first_half', target_day_count: 15, deadline_ms: 0,
    counts: { complete: 1, partial: 0, none: 0, late: 0, conflict: 0 },
    employees: [{ employee_id: '1001', employee_name: '山田太郎', status: 'complete', answered_day_count: 15, target_day_count: 15, remaining_day_count: 0, has_late_submission: false, conflict_date_count: 0 }]
  })
  var countsEl10 = env10.document.getElementById('wish_status_counts')
  assertEqual(countsEl10.children.length, 6, '10a. 要確認人数が0人のときは3項目（提出済み・一部提出・未提出）を表示する')
  var countLabels10 = countsEl10.children.filter(function (c) { return c.className.indexOf('wish-status-counts__label') >= 0 }).map(function (c) { return c.textContent })
  assertEqual(countLabels10, ['提出済み', '一部提出', '未提出'], '10b. 要確認0人時のラベルは提出済み・一部提出・未提出の3項目で、期限後ありを含まない')
}

// ------------------------------------------------------------------
// 11. 期間を連続変更しても古いレスポンスで新しい選択を上書きしない（リクエスト連番）
// ------------------------------------------------------------------
{
  var env11 = loadWishStatusClientEnv_()
  var sb11 = env11.sandbox
  sb11.loadWishStatus_() // 1回目（古い方）
  var call11a = env11.callLog[env11.callLog.length - 1]
  sb11.loadWishStatus_() // 2回目（新しい方、連番が進む）
  var call11b = env11.callLog[env11.callLog.length - 1]

  // 先に新しい方（2回目）が成功で返る
  call11b.resolve({
    success: true, year: 2026, month: 11, period: 'first_half', target_day_count: 15, deadline_ms: 0,
    counts: { complete: 0, partial: 0, none: 1, late: 0, conflict: 0 },
    employees: [{ employee_id: '1001', employee_name: '新しい方', status: 'none', answered_day_count: 0, target_day_count: 15, remaining_day_count: 15, has_late_submission: false, conflict_date_count: 0 }]
  })
  var namesAfterNew11 = env11.document.getElementById('wish_status_employee_list').children.map(function (row) {
    return row.children[0].textContent
  })
  assertEqual(namesAfterNew11, ['新しい方'], '11a. 新しい方のレスポンスは反映される')

  // 後から古い方（1回目）が成功で返っても、画面は新しい方のまま上書きされない
  call11a.resolve({
    success: true, year: 2026, month: 10, period: 'first_half', target_day_count: 15, deadline_ms: 0,
    counts: { complete: 1, partial: 0, none: 0, late: 0, conflict: 0 },
    employees: [{ employee_id: '1002', employee_name: '古い方', status: 'complete', answered_day_count: 15, target_day_count: 15, remaining_day_count: 0, has_late_submission: false, conflict_date_count: 0 }]
  })
  var namesAfterOld11 = env11.document.getElementById('wish_status_employee_list').children.map(function (row) {
    return row.children[0].textContent
  })
  assertEqual(namesAfterOld11, ['新しい方'], '11b. 遅れて届いた古いレスポンスは無視され、新しい選択の表示を上書きしない')
}

// ------------------------------------------------------------------
// 12. 表示専用: このファイルはsubmit・update・delete・post系の書き込みgoogle.script.run呼び出しを持たない
// ------------------------------------------------------------------
{
  var jsSrc = fs.readFileSync(path.join(APP_DIR, 'js_wish_status.html'), 'utf8')
  var forbiddenNames = [
    'submitEmployeeShiftWishesBulk', 'postShiftWish', 'updateShiftWish', 'deleteShiftWish',
    'postShiftEntryFromWish', 'postShiftEntry', 'deleteShiftEntry', 'updateShiftEntry'
  ]
  for (var i = 0; i < forbiddenNames.length; i++) {
    assertTrue(jsSrc.indexOf(forbiddenNames[i]) === -1, '12. js_wish_status.htmlは' + forbiddenNames[i] + 'を呼ばない（表示専用）')
  }
  assertContains(jsSrc, 'getEmployeeWishSubmissionStatus', '12. js_wish_status.htmlが呼ぶサーバー関数はgetEmployeeWishSubmissionStatusのみ（読み取り専用）')
}

// ------------------------------------------------------------------
// 13. 再読み込みボタン（レビュー対応 2026-09-22、指摘2）
//     13a: retryWishStatusLoad_が同じ年月・期間でgetEmployeeWishSubmissionStatusを再実行する
//     13b: 再読み込み開始時にボタンが非表示へ戻る
//     13c: success:falseでも表示される
//     13d: 新しいリクエストが成功したあと、古いリクエストの失敗が返ってもボタン・正常表示を変更しない
//     13e: ページ全体の再読み込み・location操作を行わない
// ------------------------------------------------------------------
{
  // 13a: 再読み込み操作で、現在選択中の年月・期間を変えずgetEmployeeWishSubmissionStatusを再実行する
  var env13a = loadWishStatusClientEnv_()
  var sb13a = env13a.sandbox
  sb13a.loadWishStatus_()
  var call13a1 = env13a.callLog[env13a.callLog.length - 1]
  call13a1.reject({ message: 'ネットワークエラー' })
  assertTrue(!env13a.document.getElementById('wish_status_retry_btn').hidden, '13a-前提. 通信失敗後に再読み込みボタンが表示されている')

  var yearBefore13a = sb13a.wishStatusYear_
  var monthBefore13a = sb13a.wishStatusMonth_
  var periodBefore13a = sb13a.wishStatusPeriod_
  var callCountBefore13a = env13a.callLog.length
  sb13a.retryWishStatusLoad_()
  assertEqual(env13a.callLog.length, callCountBefore13a + 1, '13a. 再読み込み操作でgoogle.script.runの呼び出しが1回増える（retryWishStatusLoad_が実際にloadWishStatus_を呼んでいる）')
  var call13a2 = env13a.callLog[env13a.callLog.length - 1]
  assertEqual(call13a2.name, 'getEmployeeWishSubmissionStatus', '13a. 再読み込みでgetEmployeeWishSubmissionStatusを再実行する')
  assertEqual(call13a2.args, [yearBefore13a, monthBefore13a, periodBefore13a], '13a. 再読み込みは現在選択中の年月・期間を変えずに引数へ渡す')

  // 13b: 再読み込み開始時（loadWishStatus_の先頭）にボタンが非表示へ戻る
  assertTrue(env13a.document.getElementById('wish_status_retry_btn').hidden, '13b. 再読み込み開始時にボタンが非表示へ戻る')

  // 13c: サーバーからsuccess:falseが返った場合も表示される
  var env13c = loadWishStatusClientEnv_()
  var sb13c = env13c.sandbox
  sb13c.loadWishStatus_()
  var call13c = env13c.callLog[env13c.callLog.length - 1]
  call13c.resolve({ success: false, message: '対象年月が不正です' })
  assertTrue(!env13c.document.getElementById('wish_status_retry_btn').hidden, '13c. success:falseが返った場合も再読み込みボタンが表示される')
  assertEqual(env13c.document.getElementById('wish_status_message').textContent, '対象年月が不正です', '13c. success:false時のメッセージも表示される')

  // 13d: 新しいリクエストが成功したあと、古いリクエストの失敗コールバックが後から呼ばれても、
  //      ボタンや正常表示を変更しない（リクエスト連番で古い応答を無視する）
  var env13d = loadWishStatusClientEnv_()
  var sb13d = env13d.sandbox
  sb13d.loadWishStatus_() // 1回目（古い方、後から失敗させる）
  var call13d1 = env13d.callLog[env13d.callLog.length - 1]
  sb13d.loadWishStatus_() // 2回目（新しい方、先に成功させる）
  var call13d2 = env13d.callLog[env13d.callLog.length - 1]

  call13d2.resolve({
    success: true, year: 2026, month: 10, period: 'first_half', target_day_count: 15, deadline_ms: 0,
    counts: { complete: 1, partial: 0, none: 0, late: 0, conflict: 0 },
    employees: [{ employee_id: '1001', employee_name: '新しい方', status: 'complete', answered_day_count: 15, target_day_count: 15, remaining_day_count: 0, has_late_submission: false, conflict_date_count: 0 }]
  })
  assertTrue(env13d.document.getElementById('wish_status_retry_btn').hidden, '13d-前提. 新しい方の成功後、再読み込みボタンは非表示のまま')
  assertTrue(!env13d.document.getElementById('wish_status_summary_card').hidden, '13d-前提. 新しい方の成功後、集計カードが表示されている')

  call13d1.reject({ message: '古いリクエストの失敗' }) // 遅れて古い方が失敗で返る
  assertTrue(env13d.document.getElementById('wish_status_retry_btn').hidden, '13d. 古いリクエストの失敗が後から返っても、再読み込みボタンは表示状態を変えない')
  assertTrue(!env13d.document.getElementById('wish_status_summary_card').hidden, '13d. 古いリクエストの失敗が後から返っても、正常表示（集計カード）を変更しない')
  assertEqual(env13d.document.getElementById('wish_status_message').textContent, '', '13d. 古いリクエストの失敗が後から返っても、メッセージを上書きしない')

  // 13e: ページ全体の再読み込み・location操作を行わない（location参照自体を持たない）
  var jsSrc13e = fs.readFileSync(path.join(APP_DIR, 'js_wish_status.html'), 'utf8')
  assertTrue(jsSrc13e.indexOf('location.reload') === -1 && jsSrc13e.indexOf('location.href') === -1,
    '13e. js_wish_status.htmlはページ全体の再読み込み・location操作を行わない')
}

// ------------------------------------------------------------------
// 14. 提出状況画面専用のCSS（.wish-status-row__late）を削除している。
//     他画面の期限後表示（日別シフト画面の.timeline-bar--wish-overdue）は残す
//     （最小仕様5. レビュー対応 2026-09-22）
// ------------------------------------------------------------------
{
  var cssSrc14 = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')
  assertTrue(cssSrc14.indexOf('wish-status-row__late') === -1, '14a. css.htmlから.wish-status-row__late（提出状況画面専用の期限後バッジ）を削除している')
  assertContains(cssSrc14, 'timeline-bar--wish-overdue', '14b. 日別シフト画面の期限後の薄い赤表示（.timeline-bar--wish-overdue）は削除せず残す')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのCSSレイアウト・スマホ幅での見た目')
console.log('- 実際のセレクト操作・タッチ操作の感触')
console.log('- google.script.runの実際の通信タイミング・GAS側の実行時間')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
