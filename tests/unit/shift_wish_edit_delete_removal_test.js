// 店主画面の希望編集削除撤去（07_ブラッシュアップ/03_実装・レビュー/app配下、2026-09-24）の検証。
// 本番のjs_shift_wish.html・view_home.htmlを直接読み込み、ロジックをこのファイルへ再実装しない。
//
// 対象：
// 1. 希望バーから開くモーダルの操作ボタンが「この時間で勤務登録」「キャンセル」の2つだけであること
//    （「希望を修正」「希望を削除」のDOM・ハンドラが完全に撤去されていること）。
// 2. 希望モーダルを開く→勤務時間を調整→勤務登録が成功すること（希望自体の時刻は変更しない）。
// 3. 希望範囲外の登録はサーバー側で拒否され、モーダルを開いたまま再操作できること。
// 4. キャンセル・閉じる・開き直す操作でエラーが出ないこと（希望編集モードが存在しない状態での
//    開閉サイクル）。
// 5. 名前・マイスター表示は維持されていること（詳細はshift_wish_modal_skill_display_test.jsで
//    個別検証済みのため、ここでは撤去後も同じ関数が正しく呼ばれることの確認に絞る）。
// 6. モーダルのフォーカス復帰・連打防止・失敗時の再操作が維持されていること。
//
// 実行: node shift_wish_edit_delete_removal_test.js
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
function assertFalse(actual, label) {
  assertTrue(!actual, label)
}

var viewHomeSource = fs.readFileSync(path.join(APP_DIR, 'view_home.html'), 'utf8')
var shiftWishClientSource = fs.readFileSync(path.join(APP_DIR, 'js_shift_wish.html'), 'utf8')

console.log('パート1: 希望バーモーダルのボタン構成（view_home.html静的構造）')
console.log('---')

// 1. shift_wish_modalのmodal-actions内が「この時間で勤務登録」「キャンセル」の2ボタンだけであること
var modalActionsMatch = viewHomeSource.match(/<div id="shift_wish_modal"[\s\S]*?<div class="modal-actions">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)
assertTrue(!!modalActionsMatch, '前提: shift_wish_modalのmodal-actionsブロックを取得できた')
if (modalActionsMatch) {
  var actionsInner = modalActionsMatch[1]
  var buttonMatches = actionsInner.match(/<button[^>]*>/g) || []
  assertEqual(buttonMatches.length, 2, 'shift_wish_modalのmodal-actions内はボタン2個だけ（この時間で勤務登録／キャンセル）')
  assertTrue(/id="shift_wish_modal_register_btn"/.test(actionsInner), 'shift_wish_modal_register_btn（この時間で勤務登録）が存在する')
  assertTrue(/id="shift_wish_modal_cancel_btn"/.test(actionsInner), 'shift_wish_modal_cancel_btn（キャンセル）が存在する')
  assertFalse(/id="shift_wish_modal_edit_btn"/.test(actionsInner), 'shift_wish_modal_edit_btn（希望を修正）は存在しない')
  assertFalse(/id="shift_wish_modal_delete_btn"/.test(actionsInner), 'shift_wish_modal_delete_btn（希望を削除）は存在しない')
}

assertFalse(/希望を修正/.test(viewHomeSource), 'view_home.htmlに「希望を修正」という文言がない')
assertFalse(/希望を削除/.test(viewHomeSource), 'view_home.htmlに「希望を削除」という文言がない')
assertFalse(/希望シフトを修正/.test(viewHomeSource), 'view_home.htmlに「希望シフトを修正」という文言がない')

console.log('---')
console.log('パート2: js_shift_wish.htmlのクライアントロジック（静的構造）')
console.log('---')

assertFalse(/function applyShiftWishEditMode_/.test(shiftWishClientSource), 'applyShiftWishEditMode_の定義が存在しない')
assertFalse(/function handleShiftWishModalEdit_/.test(shiftWishClientSource), 'handleShiftWishModalEdit_の定義が存在しない')
assertFalse(/function handleShiftWishModalDelete_/.test(shiftWishClientSource), 'handleShiftWishModalDelete_の定義が存在しない')
assertFalse(/shiftWishEditMode/.test(shiftWishClientSource), 'shiftWishEditMode変数への参照が存在しない')
assertFalse(/window\.confirm/.test(shiftWishClientSource), '希望削除用のwindow.confirm呼び出しが存在しない（削除UIごと撤去したため）')
assertFalse(/\.updateShiftWish\(/.test(shiftWishClientSource), 'updateShiftWishへのgoogle.script.run呼び出しが存在しない')
assertFalse(/\.deleteShiftWish\(/.test(shiftWishClientSource), 'deleteShiftWishへのgoogle.script.run呼び出しが存在しない')
assertTrue(/function handleShiftWishRegisterShift_/.test(shiftWishClientSource), 'handleShiftWishRegisterShift_（勤務登録）の定義は維持されている')
assertTrue(/\.postShiftEntryFromWish\(/.test(shiftWishClientSource), 'postShiftEntryFromWishへのgoogle.script.run呼び出しは維持されている')

console.log('---')

// ==============================================================
// パート3: モーダルの開閉サイクル・勤務登録の動作（フェイクDOM＋フェイクgoogle.script.run）
// ==============================================================

console.log('パート3: モーダル開閉サイクル・勤務登録操作（js_shift_wish.htmlを直接実行）')
console.log('---')

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
 *  最小限のフェイクDOM要素（shift_wish_modal_skill_display_test.jsと同じ最小実装方針）
 */
function createFakeElement_(id) {
  var classes = {}
  var attrs = {}
  var el = {
    id: id,
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    children: [],
    focusCallCount: 0,
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
    getBoundingClientRect: function () { return { left: 0, right: 300 } }
  }
  return el
}

/**
 *  js_shift_wish.html全体＋js_shift.html（共通マイスターラベル関数、必要な関数だけを個別抽出）＋
 *  js_home_common.html（formatBusinessDateHeaderLabel_等）をvmで実行し、handleShiftWishBarClick_・
 *  handleShiftWishRegisterShift_・closeShiftWishModal_を直接呼べる環境を作る。
 *  js_shift.html全体を読み込むとrefreshTimeline等の本番関数までロードされ、テスト側で
 *  差し替えたフェイク（sandbox.refreshTimeline）をfunction宣言が上書きしてしまうため、
 *  shift_wish_modal_skill_display_test.jsと同じ方式でマイスターラベル関連の関数だけを個別に
 *  抽出する（js_shift.html全体をvm実行しない）。
 *  google.script.runはテストから差し替え可能なフェイクにする。
 */
function loadShiftWishClientEnv_(maisterSummariesData) {
  var jsShiftScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8'))
  var jsShiftWishScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_shift_wish.html'), 'utf8'))
  var jsHomeCommonScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'js_home_common.html'), 'utf8'))

  var createUiFn = extractFunction_(jsShiftScript, /function createSkillTagUI_\(ids\) \{[\s\S]*?\n      \}/, 'createSkillTagUI_', 'js_shift.html')
  var clearFn = extractFunction_(jsShiftScript, /function clearSkillTags_\(ui\) \{[\s\S]*?\n      \}/, 'clearSkillTags_', 'js_shift.html')
  var createTagFn = extractFunction_(jsShiftScript, /function createSkillTagEl_\(text\) \{[\s\S]*?\n      \}/, 'createSkillTagEl_', 'js_shift.html')
  var renderFn = extractFunction_(jsShiftScript, /function renderSkillTags_\(ui, empId\) \{[\s\S]*?\n      \}/, 'renderSkillTags_', 'js_shift.html')
  var recalcFn = extractFunction_(jsShiftScript, /function recalculateSkillInlineVisibility_\(ui\) \{[\s\S]*?\n      \}/, 'recalculateSkillInlineVisibility_', 'js_shift.html')
  var measureFn = extractFunction_(jsShiftScript, /function measureVisibleSkillTagCount_\(inlineList, tags\) \{[\s\S]*?\n      \}/, 'measureVisibleSkillTagCount_', 'js_shift.html')
  var toggleDetailFn = extractFunction_(jsShiftScript, /function toggleSkillDetail_\(ui\) \{[\s\S]*?\n      \}/, 'toggleSkillDetail_', 'js_shift.html')
  var startResizeFn = extractFunction_(jsShiftScript, /function startSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'startSkillResizeWatch_', 'js_shift.html')
  var stopResizeFn = extractFunction_(jsShiftScript, /function stopSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/, 'stopSkillResizeWatch_', 'js_shift.html')
  var msToTimeFn = extractFunction_(jsShiftScript, /function msToTimeInputValue_\(ms\) \{[\s\S]*?\n      \}/, 'msToTimeInputValue_', 'js_shift.html')
  var formatDateFn = extractFunction_(jsHomeCommonScript, /function formatBusinessDateHeaderLabel_\(dateObj\) \{[\s\S]*?\n      \}/, 'formatBusinessDateHeaderLabel_', 'js_home_common.html')
  var pad2Match = jsHomeCommonScript.match(/function pad2_\(n\) \{[\s\S]*?\n      \}/)
  if (!pad2Match) throw new Error('js_home_common.htmlのpad2_が見つかりません')

  var elementsById = {}
  ;[
    'shift_wish_modal_skill_tags', 'shift_wish_skill_more_btn', 'shift_wish_modal_skill_wrap',
    'shift_wish_modal_employee', 'shift_wish_modal_date', 'shift_wish_modal_range',
    'shift_wish_modal_message', 'shift_wish_modal', 'shift_wish_modal_register_btn',
    'shift_wish_modal_cancel_btn', 'shift_wish_modal_title', 'shift_wish_modal_start_time',
    'shift_wish_modal_end_time'
  ].forEach(function (id) { elementsById[id] = createFakeElement_(id) })

  var fakeDocument = {
    getElementById: function (id) {
      if (!elementsById[id]) throw new Error('未定義のDOM要素が参照されました: ' + id)
      return elementsById[id]
    },
    createElement: function () { return createFakeElement_(null) }
  }
  var resizeListeners = []
  var fakeWindow = {
    addEventListener: function (type, handler) { resizeListeners.push({ type: type, handler: handler }) },
    removeEventListener: function (type, handler) {
      resizeListeners = resizeListeners.filter(function (l) { return !(l.type === type && l.handler === handler) })
    }
  }

  var scriptRunCalls = [] // { fnName, args, resolve: function(result), reject: function(error) }
  var fakeGoogleScriptRun = {
    withSuccessHandler: function (successHandler) {
      var runner = {
        withFailureHandler: function (failureHandler) {
          var proxy = {}
          ;['postShiftEntryFromWish'].forEach(function (fnName) {
            proxy[fnName] = function (arg) {
              scriptRunCalls.push({ fnName: fnName, arg: arg, successHandler: successHandler, failureHandler: failureHandler })
            }
          })
          return proxy
        }
      }
      return runner
    }
  }

  var refreshTimelineCalls = 0
  var clearJudgeResultsCalls = 0

  var sandbox = {
    console: console,
    document: fakeDocument,
    window: fakeWindow,
    maisterSummaries: maisterSummariesData,
    currentBusinessDate: new Date(2026, 8, 16),
    google: { script: { run: fakeGoogleScriptRun } },
    syncAppShellInertForModal_: undefined,
    refreshTimeline: function () { refreshTimelineCalls++ },
    clearJudgeResults: function () { clearJudgeResultsCalls++ }
  }
  vm.createContext(sandbox)
  vm.runInContext(
    [
      "var WEEKDAY_LABELS_ = ['日', '月', '火', '水', '木', '金', '土']",
      pad2Match[0], formatDateFn, msToTimeFn,
      createUiFn, clearFn, createTagFn, renderFn, recalcFn, measureFn, toggleDetailFn, startResizeFn, stopResizeFn,
      jsShiftWishScript
    ].join('\n'),
    sandbox,
    { filename: 'js_home_common.html(抜粋) + js_shift.html(抜粋) + js_shift_wish.html' }
  )

  return {
    sandbox: sandbox,
    elementsById: elementsById,
    scriptRunCalls: scriptRunCalls,
    refreshTimelineCalls: function () { return refreshTimelineCalls },
    clearJudgeResultsCalls: function () { return clearJudgeResultsCalls }
  }
}

function createFakeWishBar_(employeeId, employeeName, startHour, endHour) {
  return {
    dataset: {
      wishId: 'w-edit-removal-1',
      employeeId: employeeId,
      employeeName: employeeName,
      startMs: String(new Date(2026, 8, 16, startHour, 0).getTime()),
      endMs: String(new Date(2026, 8, 16, endHour, 0).getTime()),
      startLabel: startHour + ':00',
      endLabel: endHour + ':00'
    },
    focusCallCount: 0,
    focus: function () { this.focusCallCount++ }
  }
}

// ------------------------------------------------------------------
// テストA: 希望モーダルを開く→勤務時間を調整→勤務登録が成功する
// ------------------------------------------------------------------
{
  var envA = loadShiftWishClientEnv_({ '1': { registered: true, acquired_meisters: ['ホール'], score: 5 } })
  var barA = createFakeWishBar_('1', '山田太郎', 11, 19)
  envA.sandbox.handleShiftWishBarClick_({ currentTarget: barA })

  assertTrue(envA.elementsById.shift_wish_modal.hidden === false, 'A. 希望モーダルが開く')
  assertEqual(envA.elementsById.shift_wish_modal_start_time.value, '11:00', 'A. 開始time inputへ希望開始時刻が初期値として入る')
  assertEqual(envA.elementsById.shift_wish_modal_end_time.value, '19:00', 'A. 終了time inputへ希望終了時刻が初期値として入る')

  // 店主が希望の範囲内で勤務時間を調整する（12:00〜17:00）
  envA.elementsById.shift_wish_modal_start_time.value = '12:00'
  envA.elementsById.shift_wish_modal_end_time.value = '17:00'
  envA.sandbox.handleShiftWishRegisterShift_()

  assertEqual(envA.scriptRunCalls.length, 1, 'A. postShiftEntryFromWishが1回呼ばれる')
  assertEqual(envA.scriptRunCalls[0].fnName, 'postShiftEntryFromWish', 'A. 呼ばれるのはpostShiftEntryFromWish（updateShiftWishではない）')
  assertEqual(envA.scriptRunCalls[0].arg, {
    wish_id: 'w-edit-removal-1', employee_id: '1', start_time: '12:00', end_time: '17:00'
  }, 'A. 調整した勤務時間（希望自体ではない）がサーバーへ送られる')

  // サーバー成功を模す
  envA.scriptRunCalls[0].successHandler('登録しました')
  assertTrue(envA.elementsById.shift_wish_modal.hidden === true, 'A. 登録成功でモーダルが閉じる')
  assertEqual(envA.refreshTimelineCalls(), 1, 'A. 登録成功でrefreshTimelineが呼ばれる')
  assertEqual(envA.clearJudgeResultsCalls(), 1, 'A. 登録成功でclearJudgeResultsが呼ばれる（判定結果の無効化）')
}

// ------------------------------------------------------------------
// テストB: 希望範囲外の登録はサーバー側で拒否され、モーダルを開いたまま再操作できる
// ------------------------------------------------------------------
{
  var envB = loadShiftWishClientEnv_({ '2': { registered: true, acquired_meisters: [], score: 0 } })
  var barB = createFakeWishBar_('2', '佐藤花子', 11, 19)
  envB.sandbox.handleShiftWishBarClick_({ currentTarget: barB })

  // 希望範囲外（開始が希望より早い10:00）を入力して登録を試みる
  envB.elementsById.shift_wish_modal_start_time.value = '10:00'
  envB.elementsById.shift_wish_modal_end_time.value = '13:00'
  envB.sandbox.handleShiftWishRegisterShift_()
  assertEqual(envB.scriptRunCalls.length, 1, 'B. postShiftEntryFromWishが呼ばれる（サーバー側の検証に委ねる）')

  // サーバー側の拒否メッセージを模す（本番shift_wish.gsのpostShiftEntryFromWishが返す実際の文言）
  envB.scriptRunCalls[0].successHandler('勤務時間は希望の範囲内で入力してください')
  assertTrue(envB.elementsById.shift_wish_modal.hidden === false, 'B. 拒否時はモーダルが開いたまま')
  assertEqual(envB.elementsById.shift_wish_modal_message.textContent, '勤務時間は希望の範囲内で入力してください', 'B. 拒否理由がモーダル内に表示される')
  assertEqual(envB.refreshTimelineCalls(), 0, 'B. 拒否時はrefreshTimelineが呼ばれない')

  // 再操作：範囲内の時間へ直して再送信できる
  envB.elementsById.shift_wish_modal_start_time.value = '12:00'
  envB.elementsById.shift_wish_modal_end_time.value = '17:00'
  envB.sandbox.handleShiftWishRegisterShift_()
  assertEqual(envB.scriptRunCalls.length, 2, 'B. 再操作でpostShiftEntryFromWishが再度呼ばれる（連打防止が解除されている）')
  envB.scriptRunCalls[1].successHandler('登録しました')
  assertTrue(envB.elementsById.shift_wish_modal.hidden === true, 'B. 再操作後の成功でモーダルが閉じる')
}

// ------------------------------------------------------------------
// テストC: キャンセル・閉じる・開き直す操作でエラーが出ない
// ------------------------------------------------------------------
{
  var envC = loadShiftWishClientEnv_({ '3': { registered: true, acquired_meisters: ['セット'], score: 5 } })
  var barC1 = createFakeWishBar_('3', '鈴木一郎', 11, 19)

  // 開く→キャンセル（closeShiftWishModal_）を3回連続で行っても例外が出ない
  for (var i = 0; i < 3; i++) {
    envC.sandbox.handleShiftWishBarClick_({ currentTarget: barC1 })
    assertTrue(envC.elementsById.shift_wish_modal.hidden === false, 'C' + i + '. 開くたびにモーダルが表示される')
    envC.sandbox.closeShiftWishModal_()
    assertTrue(envC.elementsById.shift_wish_modal.hidden === true, 'C' + i + '. キャンセル相当のcloseShiftWishModal_でモーダルが閉じる')
  }
  assertEqual(envC.elementsById.shift_wish_modal_message.textContent, '', 'C. 閉じるたびにメッセージ表示がクリアされる')

  // オーバーレイクリックでも閉じる（handleShiftWishOverlayClick_）
  envC.sandbox.handleShiftWishBarClick_({ currentTarget: barC1 })
  envC.sandbox.handleShiftWishOverlayClick_({ target: { id: 'shift_wish_modal' } })
  assertTrue(envC.elementsById.shift_wish_modal.hidden === true, 'C. オーバーレイクリックでもモーダルが閉じる')

  // 開き直し（希望バーを閉じずに連続でクリック）でも例外が出ない
  envC.sandbox.handleShiftWishBarClick_({ currentTarget: barC1 })
  envC.sandbox.handleShiftWishBarClick_({ currentTarget: barC1 })
  assertTrue(envC.elementsById.shift_wish_modal.hidden === false, 'C. 開き直した後もモーダルは正しく開いている')
}

// ------------------------------------------------------------------
// テストD: 通信中の連打防止・失敗時の再操作
// ------------------------------------------------------------------
{
  var envD = loadShiftWishClientEnv_({ '4': { registered: false, acquired_meisters: [], score: 0 } })
  var barD = createFakeWishBar_('4', '高橋次郎', 18, 23)
  envD.sandbox.handleShiftWishBarClick_({ currentTarget: barD })
  envD.elementsById.shift_wish_modal_start_time.value = '19:00'
  envD.elementsById.shift_wish_modal_end_time.value = '22:00'

  envD.sandbox.handleShiftWishRegisterShift_()
  assertEqual(envD.scriptRunCalls.length, 1, 'D. 1回目のクリックで通信が1件発生する')
  assertTrue(envD.elementsById.shift_wish_modal_register_btn.disabled, 'D. 通信中はボタンが無効化される（連打防止）')

  // 通信中にもう一度クリックしても新しい通信は発生しない
  envD.sandbox.handleShiftWishRegisterShift_()
  assertEqual(envD.scriptRunCalls.length, 1, 'D. 通信完了前に再クリックしても新しい通信は発生しない（連打防止）')

  // 通信が失敗（withFailureHandler側）した場合、ボタンが再度有効化され、再操作できる
  envD.scriptRunCalls[0].failureHandler({ message: 'ネットワークエラー' })
  assertFalse(envD.elementsById.shift_wish_modal_register_btn.disabled, 'D. 通信失敗後はボタンが再び有効化される')
  assertEqual(envD.elementsById.shift_wish_modal_message.textContent, '登録に失敗しました: ネットワークエラー', 'D. 失敗メッセージが表示される')

  envD.sandbox.handleShiftWishRegisterShift_()
  assertEqual(envD.scriptRunCalls.length, 2, 'D. 失敗後の再操作で通信が再度発生する')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのモーダルの見た目（ボタン配置・余白）、Escapeキー・背景クリックでの')
console.log('  実際の閉じる操作（Escapeハンドラ自体はjs_home_controller.htmlに実装済みで別ファイルの')
console.log('  静的構造検証対象。ここではclose関数の直接呼び出しのみ確認）')
console.log('- マイスターラベルの実際の折り返し・「＋N件」展開表示（shift_wish_modal_skill_display_test.jsで別途検証）')
console.log('- 実際のフォーカス移動（tabIndex・視覚的なフォーカスリング）')
console.log('- 二重クリック・並行操作が実際のGAS実行環境（LockService）で正しく直列化されること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
