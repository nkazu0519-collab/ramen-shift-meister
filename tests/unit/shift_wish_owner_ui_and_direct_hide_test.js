// 店主希望導線整理（07_ブラッシュアップ/03_実装・レビュー/店主希望導線整理_Claude修正プロンプト_2026-09-24.md）の
// 検証。本番の.gs・.htmlファイルを直接読み込み、ロジックをこのファイルへ再実装しない。
//
// 1. 店主側の希望追加UI（「希望シフトを追加」ボタン・専用モーダル・専用クライアント関数）が
//    view_home.html・js_shift_wish.htmlから撤去されていること（否定テスト）。
// 2. サーバー関数getShiftWishesForBusinessDateが、希望ID付き勤務だけでなく、同じ従業員の
//    対象営業日への直接勤務登録でも希望バーを隠すこと。最後の該当勤務を削除すると希望が
//    再表示されること。複数勤務の一部を削除しても、勤務が残る間は隠れたままであること。
//    日跨ぎ・別従業員・別営業日・勤務時間変更に伴う重なりの変化でも正しく動くこと。
//    期限後フラグ・提出日時・希望回答内容が変化しないこと。
// 3. 従業員側の勤務登録済み判定（isEmployeeWorkRegisteredOnBusinessDate_）が、直接勤務登録
//    後も既存どおり変更禁止として働き、勤務削除後は再び変更可能に戻ること。
//
// 実行: node shift_wish_owner_ui_and_direct_hide_test.js

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

// ==============================================================
// パート1: view_home.html・js_shift_wish.htmlの静的構造（店主側希望追加UIの不在）
// ==============================================================

var viewHomeSource = fs.readFileSync(path.join(APP_DIR, 'view_home.html'), 'utf8')
var shiftWishClientSource = fs.readFileSync(path.join(APP_DIR, 'js_shift_wish.html'), 'utf8')
var homeControllerSource = fs.readFileSync(path.join(APP_DIR, 'js_home_controller.html'), 'utf8')
var sidebarSource = fs.readFileSync(path.join(APP_DIR, 'app_sidebar.html'), 'utf8')
var homeCommonSource = fs.readFileSync(path.join(APP_DIR, 'js_home_common.html'), 'utf8')

console.log('パート1: 店主側「希望シフトを追加」UIの撤去')
console.log('---')

assertFalse(/希望シフトを追加/.test(viewHomeSource), 'view_home.htmlに「希望シフトを追加」という文言が残っていない')
assertFalse(/id="shift_wish_add_btn"/.test(viewHomeSource), 'view_home.htmlにshift_wish_add_btnボタンが残っていない')
assertFalse(/id="shift_wish_add_modal"/.test(viewHomeSource), 'view_home.htmlにshift_wish_add_modalモーダルが残っていない')
assertFalse(/id="shift_wish_employee_select"/.test(viewHomeSource), 'view_home.htmlにshift_wish_employee_select（希望追加モーダル専用select）が残っていない')
assertFalse(/openShiftWishAddModal_/.test(viewHomeSource), 'view_home.htmlにopenShiftWishAddModal_の呼び出しが残っていない')

assertFalse(/function openShiftWishAddModal_/.test(shiftWishClientSource), 'js_shift_wish.htmlにopenShiftWishAddModal_の定義が残っていない')
assertFalse(/function closeShiftWishAddModal_/.test(shiftWishClientSource), 'js_shift_wish.htmlにcloseShiftWishAddModal_の定義が残っていない')
assertFalse(/function handleShiftWishAddSave_/.test(shiftWishClientSource), 'js_shift_wish.htmlにhandleShiftWishAddSave_の定義が残っていない')
assertFalse(/function handleShiftWishAddOverlayClick_/.test(shiftWishClientSource), 'js_shift_wish.htmlにhandleShiftWishAddOverlayClick_の定義が残っていない')
assertFalse(/function updateShiftWishAddModalMessage_/.test(shiftWishClientSource), 'js_shift_wish.htmlにupdateShiftWishAddModalMessage_の定義が残っていない')
assertFalse(/shiftWishAddRequestInProgress/.test(shiftWishClientSource), 'js_shift_wish.htmlにshiftWishAddRequestInProgress変数が残っていない')
assertFalse(/\.postShiftWish\(/.test(shiftWishClientSource), 'js_shift_wish.htmlからpostShiftWishへのgoogle.script.run呼び出しが削除されている（店主側の希望追加導線がなくなったため）')

// Escapeハンドラ・inert対象一覧からも撤去した専用モーダルIDへの参照がないこと
assertFalse(/shift_wish_add_modal/.test(homeControllerSource), 'js_home_controller.html（Escapeハンドラ）にshift_wish_add_modalへの参照が残っていない')
assertFalse(/shift_wish_add_modal/.test(sidebarSource), 'app_sidebar.html（inert対象一覧）にshift_wish_add_modalへの参照が残っていない')
assertFalse(/shift_wish_add_btn/.test(homeCommonSource), 'js_home_common.html（ボタン活性制御）にshift_wish_add_btnへの参照が残っていない')

// 一方、維持すべき導線は残っていること（撤去範囲が広すぎないことの確認）
assertTrue(/希望シフト提出/.test(fs.readFileSync(path.join(APP_DIR, 'view_employee_wish.html'), 'utf8')), '従業員向け「希望シフト提出」画面の文言は維持されている')
assertTrue(/直接シフトを登録/.test(viewHomeSource), '「直接シフトを登録」ボタンの文言は維持されている')
assertTrue(/id="shift_direct_add_btn"/.test(viewHomeSource), 'shift_direct_add_btn（直接シフトを登録ボタン）は維持されている')
assertTrue(/id="shift_wish_modal"/.test(viewHomeSource), '希望バーから開く既存モーダル（shift_wish_modal）は維持されている')
assertTrue(/この時間で勤務登録/.test(viewHomeSource), '希望バーからの勤務登録ボタンの文言は維持されている')

// 店主画面の「希望を修正」「希望を削除」は希望編集削除撤去（2026-09-24）で撤去済み
// （希望の提出・変更・削除は従業員側「希望シフト提出」画面にまとめる方針のため）。
// 撤去タイミングが異なるだけで、店主希望導線整理という同じ一連の変更の一部として
// このファイルで検証する
assertFalse(/希望を修正/.test(viewHomeSource), 'view_home.htmlに「希望を修正」という文言が残っていない（希望編集削除撤去 2026-09-24）')
assertFalse(/希望を削除/.test(viewHomeSource), 'view_home.htmlに「希望を削除」という文言が残っていない（希望編集削除撤去 2026-09-24）')
assertFalse(/id="shift_wish_modal_edit_btn"/.test(viewHomeSource), 'view_home.htmlにshift_wish_modal_edit_btnボタンが残っていない')
assertFalse(/id="shift_wish_modal_delete_btn"/.test(viewHomeSource), 'view_home.htmlにshift_wish_modal_delete_btnボタンが残っていない')
assertFalse(/function applyShiftWishEditMode_/.test(shiftWishClientSource), 'js_shift_wish.htmlにapplyShiftWishEditMode_の定義が残っていない')
assertFalse(/function handleShiftWishModalEdit_/.test(shiftWishClientSource), 'js_shift_wish.htmlにhandleShiftWishModalEdit_の定義が残っていない')
assertFalse(/function handleShiftWishModalDelete_/.test(shiftWishClientSource), 'js_shift_wish.htmlにhandleShiftWishModalDelete_の定義が残っていない')
assertFalse(/shiftWishEditMode/.test(shiftWishClientSource), 'js_shift_wish.htmlにshiftWishEditMode変数が残っていない')
assertFalse(/\.updateShiftWish\(/.test(shiftWishClientSource), 'js_shift_wish.htmlからupdateShiftWishへのgoogle.script.run呼び出しが削除されている')
assertFalse(/\.deleteShiftWish\(/.test(shiftWishClientSource), 'js_shift_wish.htmlからdeleteShiftWishへのgoogle.script.run呼び出しが削除されている')

// サーバー側の共用関数postShiftWish・updateShiftWish・deleteShiftWish自体は、既存希望データへの
// 影響・他の呼び出し元の有無を精査した上で残す判断（呼び出し元はいずれもクライアント側の
// 店主UIのみだったため、UI削除に伴いクライアントからは呼ばれなくなるが、関数自体の削除・
// 希望データへの影響はない）
var shiftWishGsSource = fs.readFileSync(path.join(APP_DIR, 'shift_wish.gs'), 'utf8')
assertTrue(/function postShiftWish\(/.test(shiftWishGsSource), 'サーバー関数postShiftWish自体は削除していない（既存互換性・データ層への影響を避けるため）')
assertTrue(/function updateShiftWish\(/.test(shiftWishGsSource), 'サーバー関数updateShiftWish自体は削除していない（既存互換性・データ層への影響を避けるため）')
assertTrue(/function deleteShiftWish\(/.test(shiftWishGsSource), 'サーバー関数deleteShiftWish自体は削除していない（既存互換性・データ層への影響を避けるため）')

console.log('---')

// ==============================================================
// パート2: getShiftWishesForBusinessDateの新仕様（直接勤務登録でも希望バーを隠す）
// ==============================================================

/**
 *  Googleスプレッドシートのセルは、setValuesへ渡した値の型に応じてGAS側で自動的に型推論される。
 *  本番コード（shift.gs等）はこの自動変換済みの値をDate型として読み戻す前提で書かれているため、
 *  フェイクシート側でも同じ変換を最小限再現する（shift_wish_test.jsと同じ方針）。
 */
function coerceCellValue_(value, SandboxDate) {
  if (value instanceof SandboxDate) return value
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    var dparts = value.split('-')
    return new SandboxDate(Number(dparts[0]), Number(dparts[1]) - 1, Number(dparts[2]))
  }
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    var tparts = value.split(':')
    return new SandboxDate(1899, 11, 30, Number(tparts[0]), Number(tparts[1]))
  }
  return value
}

function createFakeSheet_(headerRow, SandboxDate) {
  var rows = [headerRow.slice()]
  return {
    getLastRow: function () { return rows.length },
    getLastColumn: function () { return rows[0].length },
    getRange: function (row, col, numRows, numCols) {
      return {
        getValues: function () {
          var out = []
          for (var r = 0; r < (numRows || 1); r++) {
            var srcRow = rows[row - 1 + r] || []
            var line = []
            for (var c = 0; c < (numCols || 1); c++) {
              line.push(srcRow[col - 1 + c] === undefined ? '' : srcRow[col - 1 + c])
            }
            out.push(line)
          }
          return out
        },
        setValues: function (values) {
          for (var r2 = 0; r2 < values.length; r2++) {
            var targetRowIndex = row - 1 + r2
            while (rows.length <= targetRowIndex) rows.push([])
            var targetRow = rows[targetRowIndex]
            for (var c2 = 0; c2 < values[r2].length; c2++) {
              targetRow[col - 1 + c2] = coerceCellValue_(values[r2][c2], SandboxDate)
            }
          }
        },
        setValue: function (value) {
          var targetRowIndex = row - 1
          while (rows.length <= targetRowIndex) rows.push([])
          rows[targetRowIndex][col - 1] = coerceCellValue_(value, SandboxDate)
        }
      }
    },
    deleteRow: function (row) {
      rows.splice(row - 1, 1)
    },
    _rows: rows
  }
}

function createFakeSpreadsheetApp_(sheets, SandboxDate) {
  return {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (name) {
          return sheets[name] || null
        },
        insertSheet: function (name) {
          var sheet = createFakeSheet_([], SandboxDate)
          sheets[name] = sheet
          return sheet
        }
      }
    }
  }
}

function createFakeLockService_() {
  return {
    getScriptLock: function () {
      return { waitLock: function () {}, releaseLock: function () {} }
    }
  }
}

// getEmployees（freee API）は、EMP_A・EMP_Bを含む固定従業員一覧を返すフェイクへ差し替える
// （employee_shift_wish_test.jsと同じ方針。submitEmployeeShiftWishesBulk・
// getEmployeeWishPeriodDataがfindEmployeeByIdForWish_経由でgetEmployeesを呼ぶため）
var FAKE_EMPLOYEES_ = [
  { id: 2001, display_name: '希望導線太郎' },
  { id: 2002, display_name: '希望導線花子' }
]

function loadProductionWithFakeGasApis_() {
  var gsFiles = fs.readdirSync(APP_DIR).filter(function (n) { return n.endsWith('.gs') }).sort()
  var sheets = {}
  var uuidCounter = 0

  var sandbox = {
    console: console,
    LockService: createFakeLockService_(),
    Utilities: { getUuid: function () { uuidCounter++; return 'owner-ui-wish-uuid-' + uuidCounter } }
  }
  vm.createContext(sandbox)
  var SandboxDate = vm.runInContext('Date', sandbox)
  sandbox.SpreadsheetApp = createFakeSpreadsheetApp_(sheets, SandboxDate)

  for (var i = 0; i < gsFiles.length; i++) {
    var filePath = path.join(APP_DIR, gsFiles[i])
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath })
  }

  sheets[sandbox.SHEET_NAME_SHIFT] = createFakeSheet_(['従業員ID', '日付', '開始', '終了', '曜日区分', '希望ID'], SandboxDate)

  // freee_api.gsのgetEmployees（UrlFetchAppに依存する本物）を固定従業員一覧のフェイクへ
  // 差し替える（本番のUrlFetchApp自体はこのテストで用意しない）
  sandbox.getEmployees = function () { return FAKE_EMPLOYEES_ }

  return { sandbox: sandbox, sheets: sheets }
}

console.log('パート2: getShiftWishesForBusinessDateの新仕様（直接勤務登録でも希望バーを隠す）')
console.log('---')

var BUSINESS_DATE = '2026-09-21' // shift_wish_test.jsと同じ、対応年内の月曜日
var OTHER_DATE = '2026-09-22'
var EMP_A = '2001'
var EMP_B = '2002'

// ------------------------------------------------------------------
// テスト1（ユーザー指定シナリオ1）: 希望18〜23時、直接勤務19〜22時（希望の範囲内に部分的に
//   重なる直接登録）：希望が非表示になり、勤務削除で元の希望が再表示される
// ------------------------------------------------------------------
{
  var env1 = loadProductionWithFakeGasApis_()
  var wish1 = env1.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  assertTrue(wish1.success, 'T1. 希望18-23時の登録が成功する')

  var before1 = env1.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(before1.length, 1, 'T1. 直接勤務登録前は希望が1件表示される')

  // 「直接シフトを登録」相当（postShiftEntry、希望IDを付けない）
  var directMsg1 = env1.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '19:00', end_time: '22:00'
  })
  assertContains1(directMsg1)

  var afterRegister1 = env1.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterRegister1.length, 0, 'T1. 同じ従業員・同じ営業日への直接勤務登録（19-22時）で希望18-23時が非表示になる')

  // 希望データ自体は変更されていないこと（提出情報の保持）
  var wishDisplay1 = env1.sandbox.getShiftWishDisplayById(wish1.wish_id)
  assertEqual(wishDisplay1.start_label, '18時00分', 'T1. 希望の開始時刻は変更されていない')
  assertEqual(wishDisplay1.end_label, '23時00分', 'T1. 希望の終了時刻は変更されていない')

  // 勤務削除で元の希望が再表示される
  var entries1 = env1.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(entries1.length, 1, 'T1. 直接登録した勤務が時間軸に1件表示される')
  assertEqual(entries1[0].wish_id, '', 'T1. 直接登録した勤務には希望IDが付いていない（希望IDを無理に付けない）')
  env1.sandbox.deleteShiftEntry({
    source_row: entries1[0].source_row, employee_id: entries1[0].employee_id,
    start_ms: entries1[0].start_ms, end_ms: entries1[0].end_ms
  })
  var afterDelete1 = env1.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete1.length, 1, 'T1. 勤務削除で希望18-23時が再表示される')
  assertEqual(afterDelete1[0].wish_id, wish1.wish_id, 'T1. 再表示された希望は元の希望と同一のwish_id')
}

function assertContains1(message) {
  assertTrue(String(message).indexOf('登録しました') !== -1, 'T1. 直接勤務登録（19-22時）が成功する -> ' + JSON.stringify(message))
}

// ------------------------------------------------------------------
// テスト2（ユーザー指定シナリオ2）: 希望18〜23時、直接勤務11〜14時（希望と実時間は重ならない
//   が同じ対象営業日）：同じ営業日なら希望非表示、勤務削除で再表示される
// ------------------------------------------------------------------
{
  var env2 = loadProductionWithFakeGasApis_()
  var wish2 = env2.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  var directMsg2 = env2.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '14:00'
  })
  assertTrue(String(directMsg2).indexOf('登録しました') !== -1, 'T2. 直接勤務登録（11-14時、希望と時間が重ならない）が成功する')

  var afterRegister2 = env2.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterRegister2.length, 0, 'T2. 希望時間と重ならない直接勤務でも、同じ対象営業日なら希望18-23時が非表示になる（時間全体が採用されたという意味ではない、表示整理）')

  var entries2 = env2.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  env2.sandbox.deleteShiftEntry({
    source_row: entries2[0].source_row, employee_id: entries2[0].employee_id,
    start_ms: entries2[0].start_ms, end_ms: entries2[0].end_ms
  })
  var afterDelete2 = env2.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete2.length, 1, 'T2. 勤務削除で希望18-23時が再表示される')
  assertEqual(afterDelete2[0].wish_id, wish2.wish_id, 'T2. 再表示された希望は元の希望と同一')
}

// ------------------------------------------------------------------
// テスト3（ユーザー指定シナリオ3）: 複数勤務がある場合は、最後の該当勤務を削除した時だけ
//   希望が再表示される（一部削除では隠れたまま）
// ------------------------------------------------------------------
{
  var env3 = loadProductionWithFakeGasApis_()
  var wish3 = env3.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  env3.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '14:00'
  })
  env3.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '15:00', end_time: '18:00'
  })
  var entries3 = env3.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(entries3.length, 2, 'T3. 同じ従業員・同じ営業日へ2件の直接勤務を登録できる（別の時間帯・隣接しないため結合されない）')

  var afterBoth3 = env3.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterBoth3.length, 0, 'T3. 2件とも勤務がある間は希望が非表示')

  // 1件目だけを削除しても、まだ勤務が残っているため希望は隠れたまま
  env3.sandbox.deleteShiftEntry({
    source_row: entries3[0].source_row, employee_id: entries3[0].employee_id,
    start_ms: entries3[0].start_ms, end_ms: entries3[0].end_ms
  })
  var afterFirstDelete3 = env3.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterFirstDelete3.length, 0, 'T3. 一部（1件目）の勤務を削除しても、勤務がまだ残っているため希望は非表示のまま')

  // 残る1件（最後の該当勤務）を削除して初めて希望が再表示される
  var remainingEntries3 = env3.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(remainingEntries3.length, 1, 'T3. 残りの勤務は1件')
  env3.sandbox.deleteShiftEntry({
    source_row: remainingEntries3[0].source_row, employee_id: remainingEntries3[0].employee_id,
    start_ms: remainingEntries3[0].start_ms, end_ms: remainingEntries3[0].end_ms
  })
  var afterLastDelete3 = env3.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterLastDelete3.length, 1, 'T3. 最後の該当勤務を削除して初めて希望が再表示される')
  assertEqual(afterLastDelete3[0].wish_id, wish3.wish_id, 'T3. 再表示された希望は元の希望と同一')
}

// ------------------------------------------------------------------
// テスト4（ユーザー指定シナリオ4）: 日跨ぎ・別従業員・別営業日への影響がない
// ------------------------------------------------------------------
{
  // 4a. 日跨ぎ：営業日Aに属する22:00〜翌2:00の希望に対し、同じ営業日Aに属する直接勤務
  //     （翌0:00〜翌2:00）を登録すると希望が隠れ、削除すると戻る
  var env4a = loadProductionWithFakeGasApis_()
  var wish4a = env4a.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '22:00', end_time: '02:00'
  })
  assertTrue(wish4a.success, 'T4a. 日跨ぎ（22:00〜翌2:00）の希望登録が成功する')
  var directMsg4a = env4a.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '23:00', end_time: '02:00'
  })
  assertTrue(String(directMsg4a).indexOf('登録しました') !== -1, 'T4a. 日跨ぎ直接勤務（23-翌2時、3時間）の登録が成功する')
  var afterRegister4a = env4a.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterRegister4a.length, 0, 'T4a. 日跨ぎの直接勤務でも同じ対象営業日なら希望が非表示になる')
  var entries4a = env4a.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  env4a.sandbox.deleteShiftEntry({
    source_row: entries4a[0].source_row, employee_id: entries4a[0].employee_id,
    start_ms: entries4a[0].start_ms, end_ms: entries4a[0].end_ms
  })
  var afterDelete4a = env4a.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete4a.length, 1, 'T4a. 日跨ぎ勤務削除後、希望が再表示される')

  // 4b. 別従業員：EMP_Bへの直接勤務登録はEMP_Aの希望に影響しない
  var env4b = loadProductionWithFakeGasApis_()
  var wishA4b = env4b.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  env4b.sandbox.postShiftEntry({
    employee_id: EMP_B, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  var afterOtherEmp4b = env4b.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterOtherEmp4b.length, 1, 'T4b. 別従業員（EMP_B）への直接勤務登録はEMP_Aの希望に影響しない')
  assertEqual(afterOtherEmp4b[0].wish_id, wishA4b.wish_id, 'T4b. 表示され続けるのはEMP_Aの希望')

  // 4c. 別営業日：同じ従業員でも別の対象営業日への直接勤務登録は、対象日の希望に影響しない
  var env4c = loadProductionWithFakeGasApis_()
  var wishOn4c = env4c.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  env4c.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: OTHER_DATE, start_time: '18:00', end_time: '23:00'
  })
  var afterOtherDate4c = env4c.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterOtherDate4c.length, 1, 'T4c. 別営業日（OTHER_DATE）への直接勤務登録は、対象営業日（BUSINESS_DATE）の希望に影響しない')
  assertEqual(afterOtherDate4c[0].wish_id, wishOn4c.wish_id, 'T4c. 対象営業日の希望は表示され続ける')
}

// ------------------------------------------------------------------
// テスト5（ユーザー指定シナリオ5）: 勤務変更で営業日との重なりが変わった場合も正しく再表示される
// ------------------------------------------------------------------
{
  var env5 = loadProductionWithFakeGasApis_()
  var wish5 = env5.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  // BUSINESS_DATEの営業日（11:00〜翌3:00）へ直接勤務を登録した後、変更でOTHER_DATEの営業日側
  // （翌3:00以降＝24:00〜）へ実時間をずらし、対象営業日との重なりが消えるケースを検証する
  env5.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '20:00', end_time: '23:00'
  })
  var afterRegister5 = env5.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterRegister5.length, 0, 'T5. 勤務登録直後は希望が非表示')

  var entries5 = env5.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var target5 = entries5[0]
  // 変更後は23:00〜翌2:00（BUSINESS_DATEの営業日内、翌日側へずれる。3時間で最低時間を満たす）へ。
  // まだ同じ対象営業日と重なるため、希望は引き続き非表示のはず
  var updateResult5a = env5.sandbox.updateShiftEntry({
    source_row: target5.source_row, employee_id: target5.employee_id,
    start_ms: target5.start_ms, end_ms: target5.end_ms,
    business_date: BUSINESS_DATE, start_time: '23:00', end_time: '02:00'
  })
  assertTrue(updateResult5a.success, 'T5. 勤務変更（20-23時→23-翌2時、同じ営業日内で重なりの位置が変わる）が成功する')
  var afterUpdate5a = env5.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterUpdate5a.length, 0, 'T5. 変更後も同じ対象営業日と重なるため希望は非表示のまま')

  // さらに勤務を削除すれば、対象営業日に勤務がなくなり希望が再表示される
  var entries5b = env5.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  env5.sandbox.deleteShiftEntry({
    source_row: entries5b[0].source_row, employee_id: entries5b[0].employee_id,
    start_ms: entries5b[0].start_ms, end_ms: entries5b[0].end_ms
  })
  var afterDelete5 = env5.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete5.length, 1, 'T5. 勤務削除後、対象営業日に勤務がなくなり希望が再表示される')
  assertEqual(afterDelete5[0].wish_id, wish5.wish_id, 'T5. 再表示された希望は元の希望と同一')
}

// ------------------------------------------------------------------
// テスト6（ユーザー指定シナリオ6）: 希望由来勤務（希望IDあり）の登録→変更→削除→希望再表示が
//   これまでどおり維持される（新しい従業員別勤務集合判定に置き換えても回帰しないことの確認）
// ------------------------------------------------------------------
{
  var env6 = loadProductionWithFakeGasApis_()
  var wish6 = env6.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })
  var registerMsg6 = env6.sandbox.postShiftEntryFromWish({
    wish_id: wish6.wish_id, employee_id: EMP_A, start_time: '18:00', end_time: '21:00'
  })
  assertContains1WithLabel(registerMsg6, 'T6. 希望から勤務登録（18-21時）が成功する')
  var afterRegister6 = env6.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterRegister6.length, 0, 'T6. 希望由来勤務の登録後、希望が非表示になる')

  var entries6 = env6.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var target6 = entries6[0]
  assertEqual(target6.wish_id, wish6.wish_id, 'T6. 登録された勤務は希望IDを保持している')
  var updateResult6 = env6.sandbox.updateShiftEntry({
    source_row: target6.source_row, employee_id: target6.employee_id,
    start_ms: target6.start_ms, end_ms: target6.end_ms,
    business_date: BUSINESS_DATE, start_time: '19:00', end_time: '22:00'
  })
  assertTrue(updateResult6.success, 'T6. 希望由来勤務の変更（希望範囲内: 19-22時）が成功する')
  var afterUpdate6 = env6.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterUpdate6.length, 0, 'T6. 変更後も希望は非表示のまま')

  var entries6b = env6.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  env6.sandbox.deleteShiftEntry({
    source_row: entries6b[0].source_row, employee_id: entries6b[0].employee_id,
    start_ms: entries6b[0].start_ms, end_ms: entries6b[0].end_ms
  })
  var afterDelete6 = env6.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete6.length, 1, 'T6. 削除後、希望が再表示される')
  assertEqual(afterDelete6[0].wish_id, wish6.wish_id, 'T6. 再表示された希望は元の希望と同一のwish_id')
}

function assertContains1WithLabel(message, label) {
  assertTrue(String(message).indexOf('登録しました') !== -1, label + ' -> ' + JSON.stringify(message))
}

// ------------------------------------------------------------------
// テスト7（ユーザー指定シナリオ7）: 期限後の希望は再表示時も同じ色（after_deadlineフラグ）を
//   保持し、提出情報（提出日時・回答内容）も変更されない
// ------------------------------------------------------------------
{
  var env7 = loadProductionWithFakeGasApis_()
  // submitEmployeeShiftWishesBulkで期限後の時間希望を1件提出する（従業員側一括提出の経路）
  var deadlineMsResult7 = env7.sandbox.calcWishSubmissionDeadlineMs_
  // 対象期間を、BUSINESS_DATEを含む前半/後半のどちらかへ解決する
  var y7 = 2026, m7 = 9
  var period7 = null
  var firstHalfDates7 = env7.sandbox.resolveWishPeriodBusinessDates_(y7, m7, env7.sandbox.WISH_PERIOD_FIRST_HALF_)
  var dateKeys7 = firstHalfDates7.map(function (d) {
    return env7.sandbox.formatDateInputValueForSheet_(d)
  })
  period7 = dateKeys7.indexOf(BUSINESS_DATE) !== -1 ? env7.sandbox.WISH_PERIOD_FIRST_HALF_ : env7.sandbox.WISH_PERIOD_SECOND_HALF_

  // 現在時刻を締切より後に固定して「期限後フラグ」を確実に立てる
  var deadlineMs7 = env7.sandbox.calcWishSubmissionDeadlineMs_(y7, m7, period7)
  env7.sandbox.getCurrentTimeMs_ = function () { return deadlineMs7 + 24 * 60 * 60 * 1000 }

  var submitResult7 = env7.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: y7, month: m7, period: period7,
    items: [{ date: BUSINESS_DATE, answer_type: env7.sandbox.SHIFT_WISH_ANSWER_TYPE_TIME_, start_time: '18:00', end_time: '23:00' }]
  })
  assertTrue(submitResult7.success, 'T7. 期限後の一括提出が成功する（提出自体は拒否されない）')
  assertTrue(submitResult7.after_deadline, 'T7. 提出結果のafter_deadlineがtrueになる（前提確認）')

  var before7 = env7.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(before7.length, 1, 'T7. 期限後の希望が時間軸に1件表示される')
  assertTrue(before7[0].after_deadline, 'T7. 表示される希望のafter_deadlineがtrue（薄い赤の対象）')

  // 直接勤務登録で希望を隠す→削除で再表示させても、after_deadline・時刻表示は変わらない
  env7.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '14:00'
  })
  var hidden7 = env7.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(hidden7.length, 0, 'T7. 直接勤務登録で期限後の希望も非表示になる')

  var entries7 = env7.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  env7.sandbox.deleteShiftEntry({
    source_row: entries7[0].source_row, employee_id: entries7[0].employee_id,
    start_ms: entries7[0].start_ms, end_ms: entries7[0].end_ms
  })
  var afterDelete7 = env7.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete7.length, 1, 'T7. 削除後、期限後の希望が再表示される')
  assertTrue(afterDelete7[0].after_deadline, 'T7. 再表示後もafter_deadlineはtrueのまま（同じ色で表示される）')
  assertEqual(afterDelete7[0].start_label, '18時00分', 'T7. 再表示後も開始時刻表示が変わらない')
  assertEqual(afterDelete7[0].end_label, '23時00分', 'T7. 再表示後も終了時刻表示が変わらない')

  // 提出状況（getEmployeeWishSubmissionStatus）側でも提出日時・期限後フラグが変わらないこと
  var status7 = env7.sandbox.getEmployeeWishSubmissionStatus(y7, m7, period7)
  var empStatus7 = status7.employees.filter(function (e) { return e.employee_id === EMP_A })[0]
  assertTrue(empStatus7.has_late_submission, 'T7. 提出状況側でもhas_late_submissionがtrueのまま（希望データ自体を書き換えていない）')
}

console.log('---')

// ==============================================================
// パート3: 従業員側の勤務登録済み判定（直接勤務でも変更禁止、削除後は変更可能）
// ==============================================================

console.log('パート3: 従業員側isEmployeeWorkRegisteredOnBusinessDate_（直接勤務でも変更禁止）')
console.log('---')

// ------------------------------------------------------------------
// テスト8（ユーザー指定シナリオ8）: 従業員画面では直接勤務でも勤務登録済みとして変更禁止。
//   勤務削除後は再び変更できる
// ------------------------------------------------------------------
{
  var env8 = loadProductionWithFakeGasApis_()
  var y8 = 2026, m8 = 9
  var firstHalfDates8 = env8.sandbox.resolveWishPeriodBusinessDates_(y8, m8, env8.sandbox.WISH_PERIOD_FIRST_HALF_)
  var dateKeys8 = firstHalfDates8.map(function (d) { return env8.sandbox.formatDateInputValueForSheet_(d) })
  var period8 = dateKeys8.indexOf(BUSINESS_DATE) !== -1 ? env8.sandbox.WISH_PERIOD_FIRST_HALF_ : env8.sandbox.WISH_PERIOD_SECOND_HALF_

  // 直接勤務登録（希望IDなし）を1件入れる
  env8.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '18:00', end_time: '23:00'
  })

  var periodData8 = env8.sandbox.getEmployeeWishPeriodData(EMP_A, y8, m8, period8)
  assertTrue(periodData8.success, 'T8. 従業員側の期間データ取得が成功する')
  var targetDay8 = periodData8.days.filter(function (d) { return d.date === BUSINESS_DATE })[0]
  assertTrue(targetDay8.work_registered, 'T8. 直接勤務登録（希望IDなし）でもwork_registeredがtrueになる')

  // 一括提出でこの日を編集しようとすると、勤務登録済みとして拒否される
  var submitResult8 = env8.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: y8, month: m8, period: period8,
    items: [{ date: BUSINESS_DATE, answer_type: env8.sandbox.SHIFT_WISH_ANSWER_TYPE_TIME_, start_time: '11:00', end_time: '14:00' }]
  })
  assertFalse(submitResult8.success, 'T8. 勤務登録済みの日は一括提出で拒否される（直接勤務でも変更禁止）')
  assertTrue(String(submitResult8.message).indexOf('勤務登録済み') !== -1, 'T8. 拒否理由に「勤務登録済み」の説明が含まれる')

  // 勤務削除後は、work_registeredがfalseに戻り、提出も再び可能になる
  var entries8 = env8.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  env8.sandbox.deleteShiftEntry({
    source_row: entries8[0].source_row, employee_id: entries8[0].employee_id,
    start_ms: entries8[0].start_ms, end_ms: entries8[0].end_ms
  })
  var periodDataAfter8 = env8.sandbox.getEmployeeWishPeriodData(EMP_A, y8, m8, period8)
  var targetDayAfter8 = periodDataAfter8.days.filter(function (d) { return d.date === BUSINESS_DATE })[0]
  assertFalse(targetDayAfter8.work_registered, 'T8. 勤務削除後はwork_registeredがfalseに戻る')

  var submitResultAfter8 = env8.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: y8, month: m8, period: period8,
    items: [{ date: BUSINESS_DATE, answer_type: env8.sandbox.SHIFT_WISH_ANSWER_TYPE_TIME_, start_time: '11:00', end_time: '14:00' }]
  })
  assertTrue(submitResultAfter8.success, 'T8. 勤務削除後は同じ日の一括提出が再び成功する')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでの「希望シフトを追加」ボタン撤去後の画面初期化・日付変更・モーダル操作にエラーがないこと')
console.log('  （テスト9はview_home_includes_test.js・sidebar_structure_test.js・shift_card_date_nav_test.jsの')
console.log('  静的構造検証で代替。実際のクリック操作・コンソールエラーの有無は本人の実機確認が必要）')
console.log('- 実際のGoogleスプレッドシート上での希望シフトシートの見た目・時間軸バーの色（薄い赤）の実際の描画')
console.log('- 二重クリック・並行操作が実際のGAS実行環境（LockService）で正しく直列化されること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
