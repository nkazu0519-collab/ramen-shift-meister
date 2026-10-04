// 従業員希望シフト一括提出（app/employee_shift_wish.gs・app/shift_wish.gs・app/shift.gsの
// 従業員希望シフト関連分岐）を、本番の.gsファイルをNode.jsのvmで直接読み込んで検証する。
// ロジックをこのファイルへ再実装しない。
//
// getEmployees（freee API）・SpreadsheetApp・LockService・Utilities.getUuidはフェイクへ差し替える。
// 現在時刻（getCurrentTimeMs_）もフェイクへ差し替え、テストから固定できるようにする
// （business_day.gs・employee_shift_wish.gsの締切・期限後判定ロジック自体は一切再実装しない）。
//
// 実行: node employee_shift_wish_test.js
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
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(haystack))
  if (ok) pass++; else fail++
}

/**
 *  Googleスプレッドシートのセルは、setValuesへ渡した値の型に応じてGAS側で自動的に型推論される。
 *  shift_wish_test.jsのcoerceCellValue_と同じ考え方・同じ実装（本番コードがDate型で読み戻す前提の
 *  値だけをDateへ変換する。boolean・stringはそのまま）。
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

/**
 *  シート1枚分のデータをインメモリの2次元配列で保持する（shift_wish_test.jsのcreateFakeSheet_と
 *  同じ実装。getLastColumnも含め、本番コードが実際に使う範囲だけを再現する）
 */
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
        getSheetByName: function (name) { return sheets[name] || null },
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

/**
 *  希望シフトシートの「2行目以降・A〜I列（データ部分）」に対するsetValues呼び出し回数を数える
 *  ラッパー（レビュー対応 2026-09-22、指摘1）。ヘッダー行（1行目）への書き込みや、行数・列数の
 *  異なる読み込みはカウント対象外にし、「データ部分をまとめて1回で書いているか」だけを見る。
 */
function wrapSheetWithDataWriteCounter_(sheet) {
  var counter = { count: 0 }
  var originalGetRange = sheet.getRange
  sheet.getRange = function (row, col, numRows, numCols) {
    var range = originalGetRange.call(sheet, row, col, numRows, numCols)
    if (row === 2 && col === 1) {
      var originalSetValues = range.setValues
      range.setValues = function (values) {
        counter.count++
        return originalSetValues.call(range, values)
      }
    }
    return range
  }
  return counter
}

/**
 *  希望シフトシートの「2行目以降・A〜I列（データ部分）」へのsetValuesを例外にするラッパー
 *  （レビュー対応 2026-09-22、指摘1）。書き込みが1回にまとまっていることを前提に、その1回が
 *  失敗した場合にシートの内容が一切変化しないことを確認するために使う。
 */
function wrapSheetWithThrowingDataWrite_(sheet) {
  var originalGetRange = sheet.getRange
  sheet.getRange = function (row, col, numRows, numCols) {
    var range = originalGetRange.call(sheet, row, col, numRows, numCols)
    if (row === 2 && col === 1) {
      range.setValues = function () {
        throw new Error('テスト用の意図的な失敗: 希望シフトのデータ部分書き込みに失敗しました')
      }
    }
    return range
  }
  return sheet
}

var FAKE_EMPLOYEES_ = [
  { id: 1001, display_name: '山田太郎' },
  { id: 1002, display_name: '佐藤花子' },
  { id: 1003, display_name: '鈴木一郎' }
]

/**
 *  本番の全.gsファイルを1つのVMコンテキストへ読み込み、SpreadsheetApp・LockService・Utilities・
 *  getEmployees（freee API）・getCurrentTimeMs_（現在時刻）をフェイクへ差し替える。
 *  nowMsを渡すとgetCurrentTimeMs_がその固定値を返すようになり、締切・期限後判定を
 *  任意の時刻で検証できる（本番の締切ロジック自体は一切再実装しない）。
 */
function loadProductionWithFakeGasApis_(nowMs) {
  var gsFiles = fs.readdirSync(APP_DIR).filter(function (n) { return n.endsWith('.gs') }).sort()
  var sheets = {}
  var uuidCounter = 0

  var sandbox = {
    console: console,
    LockService: createFakeLockService_(),
    Utilities: { getUuid: function () { uuidCounter++; return 'emp-wish-uuid-' + uuidCounter } }
  }
  vm.createContext(sandbox)
  var SandboxDate = vm.runInContext('Date', sandbox)
  sandbox.SpreadsheetApp = createFakeSpreadsheetApp_(sheets, SandboxDate)

  for (var i = 0; i < gsFiles.length; i++) {
    var filePath = path.join(APP_DIR, gsFiles[i])
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath })
  }

  // freee_api.gsのgetEmployees（UrlFetchAppに依存する本物）を、固定の従業員一覧を返す
  // フェイクへ差し替える（本番のUrlFetchApp自体はこのテストで用意しない）
  sandbox.getEmployees = function () { return FAKE_EMPLOYEES_ }

  // 現在時刻をテストから固定する（business_day.gsのgetCurrentTimeMs_を上書きするだけで、
  // 締切・期限後判定ロジック自体には一切触れない）
  if (typeof nowMs === 'number') {
    sandbox.getCurrentTimeMs_ = function () { return nowMs }
  }

  sheets[sandbox.SHEET_NAME_SHIFT] = createFakeSheet_(['従業員ID', '日付', '開始', '終了', '曜日区分', '希望ID'], SandboxDate)

  return { sandbox: sandbox, sheets: sheets }
}

console.log('検証対象: employee_shift_wish.gs, shift_wish.gs, shift.gs, business_day.gs（本番app内の全.gsファイルをフェイクGAS APIで実行）')
console.log('---')

var EMP_A = '1001'
var EMP_B = '1002'
var UNKNOWN_EMP = '9999'

// 対象期間: 2026年10月・前半（1〜15日）。締切は2026-09-15 23:59
var YEAR = 2026
var MONTH = 10
var PERIOD_FIRST = 'first_half'
var DEADLINE_OK_MS = new Date(2026, 8, 15, 20, 0).getTime()    // 締切前
var DEADLINE_OVER_MS = new Date(2026, 8, 16, 0, 1).getTime()   // 締切後

// ------------------------------------------------------------------
// 1. 任意の複数日に同じ時間を一括設定して提出できる
// ------------------------------------------------------------------
{
  var env1 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result1 = env1.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '19:00' },
      { date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '19:00' },
      { date: '2026-10-03', answer_type: '時間希望', start_time: '11:00', end_time: '19:00' }
    ]
  })
  assertTrue(result1.success, '1. 複数日への同一時間の一括提出が成功する')
  assertEqual(result1.submitted_count, 3, '1. 提出件数は3件')
  var days1 = env1.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct1 = days1.filter(function (d) { return d.date === '2026-10-01' })[0]
  assertEqual(oct1.answer_type, '時間希望', '1. 10/1は時間希望として保存されている')
  assertEqual(oct1.start_time, '11:00', '1. 10/1の開始時刻は11:00')
  assertEqual(oct1.end_time, '19:00', '1. 10/1の終了時刻は19:00')
}

// ------------------------------------------------------------------
// 2. 別の日付群へ別の時間を設定できる（一括提出は複数回に分けて呼べる）
// ------------------------------------------------------------------
{
  var env2 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env2.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '19:00' }]
  })
  var result2 = env2.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-05', answer_type: '時間希望', start_time: '17:00', end_time: '21:00' }]
  })
  assertTrue(result2.success, '2. 2回目の一括提出（別日付・別時間）も成功する')
  var days2 = env2.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct1b = days2.filter(function (d) { return d.date === '2026-10-01' })[0]
  var oct5 = days2.filter(function (d) { return d.date === '2026-10-05' })[0]
  assertEqual(oct1b.start_time, '11:00', '2. 1回目に設定した10/1の内容は残っている')
  assertEqual(oct5.start_time, '17:00', '2. 2回目に設定した10/5は別の時間で保存されている')
  assertEqual(oct5.end_time, '21:00', '2. 10/5の終了時刻は21:00')
}

// ------------------------------------------------------------------
// 3. 出勤不可を設定できる（時刻を持たない）
// ------------------------------------------------------------------
{
  var env3 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result3 = env3.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-03', answer_type: '出勤不可' }]
  })
  assertTrue(result3.success, '3. 出勤不可の提出が成功する')
  var days3 = env3.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct3 = days3.filter(function (d) { return d.date === '2026-10-03' })[0]
  assertEqual(oct3.answer_type, '出勤不可', '3. 10/3は出勤不可として保存されている')
  assertEqual(oct3.start_time, '', '3. 出勤不可は開始時刻を持たない')
  assertEqual(oct3.end_time, '', '3. 出勤不可は終了時刻を持たない')

  // 出勤不可は店主画面の時間軸（時間希望だけを返す）には出ない
  var timelineWishes3 = env3.sandbox.getShiftWishesForBusinessDate('2026-10-03')
  assertEqual(timelineWishes3.length, 0, '3. 出勤不可は店主画面の時間軸バーとして表示されない')
}

// ------------------------------------------------------------------
// 4. 未設定と出勤不可を区別する（未設定日はanswer_typeがnull、出勤不可は明示的な値を持つ）
// ------------------------------------------------------------------
{
  var env4 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env4.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-03', answer_type: '出勤不可' }]
  })
  var days4 = env4.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct2_4 = days4.filter(function (d) { return d.date === '2026-10-02' })[0]
  var oct3_4 = days4.filter(function (d) { return d.date === '2026-10-03' })[0]
  assertEqual(oct2_4.answer_type, null, '4. 未設定日（10/2）はanswer_typeがnull')
  assertEqual(oct3_4.answer_type, '出勤不可', '4. 出勤不可を設定した10/3は明示的な値を持つ（未設定と区別される）')
}

// ------------------------------------------------------------------
// 5. 一部の日付だけの提出を許可する（対象期間15日のうち1日だけ提出しても、他の日は未設定のまま）
// ------------------------------------------------------------------
{
  var env5 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env5.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-07', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var days5 = env5.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  assertEqual(days5.length, 15, '5. 対象期間は15日分返る（前提）')
  var setDays5 = days5.filter(function (d) { return d.answer_type !== null })
  assertEqual(setDays5.length, 1, '5. 提出したのは1日だけで、他14日は未設定のまま')
  assertEqual(setDays5[0].date, '2026-10-07', '5. 提出した日は10/7')
}

// ------------------------------------------------------------------
// 6. 前半／後半の境界（1〜15日／16日〜月末）
// ------------------------------------------------------------------
{
  var env6 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var days6First = env6.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, 'first_half').days
  assertEqual(days6First[0].date, '2026-10-01', '6a. 前半の初日は10/1')
  assertEqual(days6First[days6First.length - 1].date, '2026-10-15', '6b. 前半の最終日は10/15')

  var days6Second = env6.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, 'second_half').days
  assertEqual(days6Second[0].date, '2026-10-16', '6c. 後半の初日は10/16')
  assertEqual(days6Second[days6Second.length - 1].date, '2026-10-31', '6d. 後半の最終日は10/31（10月は31日まで）')

  // 前半で設定した内容は後半のデータに混ざらない
  env6.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: 'first_half',
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var days6SecondAfter = env6.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, 'second_half').days
  var setDays6Second = days6SecondAfter.filter(function (d) { return d.answer_type !== null })
  assertEqual(setDays6Second.length, 0, '6e. 前半への提出は後半の日付データに影響しない')
}

// ------------------------------------------------------------------
// 7. 月末・年跨ぎ（2月・うるう年でない年の28日まで、1月分は前年12月の締切）
// ------------------------------------------------------------------
{
  var env7 = loadProductionWithFakeGasApis_(new Date(2026, 11, 10).getTime())
  var days7Feb = env7.sandbox.getEmployeeWishPeriodData(EMP_A, 2027, 2, 'second_half').days
  assertEqual(days7Feb[days7Feb.length - 1].date, '2027-02-28', '7a. 2027年2月後半の最終日は2/28（うるう年でない）')

  var janResult7 = env7.sandbox.getEmployeeWishPeriodData(EMP_A, 2027, 1, 'first_half')
  var expectedJanDeadline = new Date(2026, 11, 15, 23, 59, 59, 999).getTime()
  assertEqual(janResult7.deadline_ms, expectedJanDeadline, '7b. 2027年1月・前半の締切は2026年12月15日（年跨ぎ）')
}

// ------------------------------------------------------------------
// 8. 締切日23:59と翌0:00（期限内新規・期限後新規の境界を一括保存経由で確認する）
// ------------------------------------------------------------------
{
  var deadlineEdgeOkMs = new Date(2026, 8, 15, 23, 59, 0).getTime() // 前半締切: 09-15 23:59
  var env8a = loadProductionWithFakeGasApis_(deadlineEdgeOkMs)
  env8a.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var days8a = env8a.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct1_8a = days8a.filter(function (d) { return d.date === '2026-10-01' })[0]
  assertTrue(!oct1_8a.after_deadline, '8a. 締切日23:59ちょうどに提出した希望は期限内扱い')

  var deadlineEdgeOverMs = new Date(2026, 8, 16, 0, 0, 0).getTime() // 翌日0:00
  var env8b = loadProductionWithFakeGasApis_(deadlineEdgeOverMs)
  env8b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var days8b = env8b.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct1_8b = days8b.filter(function (d) { return d.date === '2026-10-01' })[0]
  assertTrue(oct1_8b.after_deadline, '8b. 翌日0:00ちょうどに提出した希望は期限後扱い')
}

// ------------------------------------------------------------------
// 9. 期限内新規・期限後新規
// ------------------------------------------------------------------
{
  var env9a = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env9a.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var oct2_9a = env9a.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-02' })[0]
  assertTrue(!oct2_9a.after_deadline, '9a. 期限内の新規提出はafter_deadline=false')

  var env9b = loadProductionWithFakeGasApis_(DEADLINE_OVER_MS)
  env9b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var oct2_9b = env9b.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-02' })[0]
  assertTrue(oct2_9b.after_deadline, '9b. 期限後の新規提出はafter_deadline=true')
}

// ------------------------------------------------------------------
// 10. 期限内希望を期限後に変更、期限後希望の再変更
// ------------------------------------------------------------------
{
  var env10 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env10.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var beforeChange10 = env10.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-02' })[0]
  assertTrue(!beforeChange10.after_deadline, '10a. 前提: 期限内提出は期限内扱い')
  var wishId10 = beforeChange10.wish_id

  // 同じ環境で「現在時刻」を締切後に進めて再提出する（同じsandboxのgetCurrentTimeMs_を
  // 差し替えるだけで、本番の希望シフト保存ロジック自体はそのまま再利用する）
  env10.sandbox.getCurrentTimeMs_ = function () { return DEADLINE_OVER_MS }
  env10.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '12:00', end_time: '18:00' }]
  })
  var afterChange10 = env10.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-02' })[0]
  assertTrue(afterChange10.after_deadline, '10b. 期限内希望を締切後に変更すると期限後扱いになる')
  assertEqual(afterChange10.start_time, '12:00', '10b. 変更後の開始時刻が反映されている')
  assertEqual(afterChange10.wish_id, wishId10, '10b. 希望IDは更新後も維持される（重複追加されていない）')

  // 期限後希望をさらに再変更しても、期限後のままであり、希望IDも変わらない
  env10.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '13:00', end_time: '20:00' }]
  })
  var afterReChange10 = env10.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-02' })[0]
  assertTrue(afterReChange10.after_deadline, '10c. 期限後希望の再変更も期限後のまま')
  assertEqual(afterReChange10.start_time, '13:00', '10c. 再変更後の開始時刻が反映されている')
  assertEqual(afterReChange10.wish_id, wishId10, '10c. 再変更後も希望IDは維持される')
}

// ------------------------------------------------------------------
// 11. 期限後時間希望だけが店主画面で薄い赤（after_deadlineフラグの伝播をgetShiftWishesForBusinessDateで確認）
// ------------------------------------------------------------------
{
  var env11 = loadProductionWithFakeGasApis_(DEADLINE_OVER_MS)
  env11.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var timelineWishes11 = env11.sandbox.getShiftWishesForBusinessDate('2026-10-02')
  assertEqual(timelineWishes11.length, 1, '11a. 前提: 時間希望が時間軸に1件表示される')
  assertTrue(timelineWishes11[0].after_deadline, '11b. 期限後に提出した時間希望はafter_deadline=trueとして店主画面へ渡る（薄い赤の根拠）')

  var env11b = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env11b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var timelineWishes11b = env11b.sandbox.getShiftWishesForBusinessDate('2026-10-02')
  assertTrue(!timelineWishes11b[0].after_deadline, '11c. 期限内に提出した時間希望はafter_deadline=false')
}

// ------------------------------------------------------------------
// 12. 希望由来勤務がある日の編集拒否（店主が希望から勤務登録した日は、従業員側から変更できない）
// ------------------------------------------------------------------
{
  var env12 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env12.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '19:00' }]
  })
  var wishId12 = env12.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-02' })[0].wish_id
  env12.sandbox.postShiftEntryFromWish({
    wish_id: wishId12, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })

  var days12 = env12.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct2_12 = days12.filter(function (d) { return d.date === '2026-10-02' })[0]
  assertTrue(oct2_12.work_registered, '12a. 希望から勤務登録した日はwork_registered=trueになる')

  var editResult12 = env12.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '13:00', end_time: '18:00' }]
  })
  assertEqual(editResult12.success, false, '12b. 希望由来勤務がある日の変更は拒否される')
  assertContains(editResult12.message, '勤務登録済み', '12b. 拒否理由に勤務登録済みという説明が含まれる')
  assertEqual(editResult12.failed_date, '2026-10-02', '12b. 拒否された日付が返る')
}

// ------------------------------------------------------------------
// 13. 直接登録勤務がある日の編集拒否（postShiftEntryによる店主の直接登録でも同様に拒否する）
// ------------------------------------------------------------------
{
  var env13 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env13.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: '2026-10-03', start_time: '11:00', end_time: '15:00'
  })
  var editResult13 = env13.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-03', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  assertEqual(editResult13.success, false, '13. 直接登録した勤務がある日への提出も拒否される（希望IDの有無に依存しない）')
  var days13 = env13.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct3_13 = days13.filter(function (d) { return d.date === '2026-10-03' })[0]
  assertTrue(oct3_13.work_registered, '13. 直接登録した勤務がある日はwork_registered=trueになる')
  assertEqual(oct3_13.answer_type, null, '13. 拒否されたため希望データ自体は作られない（未設定のまま）')
}

// ------------------------------------------------------------------
// 14. 表示後に勤務登録された競合の保存時拒否（画面表示時点では未登録でも、提出直前に
//     店主が登録した場合はロック内の再検証で拒否される）
// ------------------------------------------------------------------
{
  var env14 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var beforeDisplay14 = env14.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-04' })[0]
  assertTrue(!beforeDisplay14.work_registered, '14a. 前提: 画面表示時点では10/4は勤務未登録')

  // 画面表示後、提出直前に店主が同じ日へ勤務を直接登録した想定
  env14.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: '2026-10-04', start_time: '11:00', end_time: '15:00'
  })

  var submitResult14 = env14.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-04', answer_type: '時間希望', start_time: '16:00', end_time: '20:00' }]
  })
  assertEqual(submitResult14.success, false, '14b. 表示後に勤務登録された競合は保存時に拒否される')
}

// ------------------------------------------------------------------
// 15. 1件不正なら一括処理全体が未更新（複数日のうち1日だけ不正な場合、全件が保存されない）
// ------------------------------------------------------------------
{
  var env15 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result15 = env15.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' },
      { date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '13:00' }, // 2時間=不正（3時間未満）
      { date: '2026-10-03', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }
    ]
  })
  assertEqual(result15.success, false, '15a. 1件でも不正な入力があれば一括処理全体が失敗する')
  var days15 = env15.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var setDays15 = days15.filter(function (d) { return d.answer_type !== null })
  assertEqual(setDays15.length, 0, '15b. 不正な入力を含む一括提出は、正しい日付も含めて一切保存されない（部分保存されない）')
}

// ------------------------------------------------------------------
// 16. 二重送信・同一内容再送で重複しない
// ------------------------------------------------------------------
{
  var env16 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var payload16 = {
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-06', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  }
  env16.sandbox.submitEmployeeShiftWishesBulk(payload16)
  env16.sandbox.submitEmployeeShiftWishesBulk(payload16) // 同一内容を再送（二重クリック相当）
  env16.sandbox.submitEmployeeShiftWishesBulk(payload16)

  var wishSheetRows16 = env16.sheets['希望シフト']._rows.filter(function (r) { return r[0] })
  var oct6Rows16 = wishSheetRows16.filter(function (r) {
    return r[1] && String(r[1]) === EMP_A
  })
  assertEqual(oct6Rows16.length, 1, '16. 同一内容を3回送信しても希望シフトシートの行は1件のまま（重複行が増えない）')
}

// ------------------------------------------------------------------
// 17. 従来6列データの読み込み（G〜I列がない既存データも読める。既存postShiftWishはG〜I列付きで
//     書くため、ここでは意図的に6列だけの行を直接シートへ差し込んで後方互換を確認する）
// ------------------------------------------------------------------
{
  var env17 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var wishSheet17 = env17.sandbox.getOrCreateShiftWishSheet_()
  var SandboxDate17 = vm.runInContext('Date', env17.sandbox)
  // 既存6列データ（G〜I列なし）を直接1行追加する
  wishSheet17.getRange(2, 1, 1, 6).setValues([[
    'legacy-wish-1', EMP_B, '2026-10-08', '2026-10-08 11:00', '2026-10-08 15:00', '未登録'
  ]])
  // 上のsetValuesは文字列'2026-10-08 11:00'をそのまま書くため、本物のシート型推論に近づけるには
  // Dateを直接渡す必要がある。coerceCellValue_の対象外の文字列のため、書き直す
  wishSheet17.getRange(2, 1, 1, 6).setValues([[
    'legacy-wish-1', EMP_B,
    new SandboxDate17(2026, 9, 8),
    new SandboxDate17(2026, 9, 8, 11, 0),
    new SandboxDate17(2026, 9, 8, 15, 0),
    '未登録'
  ]])

  var allRows17 = env17.sandbox.getAllShiftWishRows_()
  var legacyRow17 = allRows17.filter(function (r) { return r.wish_id === 'legacy-wish-1' })[0]
  assertTrue(!!legacyRow17, '17a. 既存6列データ（G〜I列なし）の行も読み込める')
  assertEqual(legacyRow17.answer_type, '時間希望', '17b. G列が空欄でD・EがDateなら時間希望として扱う（後方互換）')
  assertTrue(!legacyRow17.after_deadline, '17c. 既存行の期限後フラグ（I列）の空欄は期限内扱い')
  assertEqual(legacyRow17.last_submitted_ms, null, '17d. 既存行の最終提出日時（H列）の空欄はnull（不明）')

  // 店主画面の時間軸にも正しく表示される（従来どおりの読み込み経路）
  var timelineWishes17 = env17.sandbox.getShiftWishesForBusinessDate('2026-10-08')
  assertEqual(timelineWishes17.length, 1, '17e. 既存6列データの希望も店主画面の時間軸に表示される')
}

// ------------------------------------------------------------------
// 18. 店主の希望追加／修正／削除（従業員側の列拡張後も、店主用のCRUDが従来どおり動く）
// ------------------------------------------------------------------
{
  var env18 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var addResult18 = env18.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: '2026-10-09', start_time: '11:00', end_time: '19:00'
  })
  assertTrue(addResult18.success, '18a. 店主の希望追加（postShiftWish）は従来どおり成功する')

  var updateResult18 = env18.sandbox.updateShiftWish({
    wish_id: addResult18.wish_id, start_time: '12:00', end_time: '18:00'
  })
  assertTrue(updateResult18.success, '18b. 店主の希望修正（updateShiftWish）は従来どおり成功する')

  var deleteResult18 = env18.sandbox.deleteShiftWish({ wish_id: addResult18.wish_id })
  assertTrue(deleteResult18.success, '18c. 店主の希望削除（deleteShiftWish）は従来どおり成功する')
}

// ------------------------------------------------------------------
// 19. 希望→勤務登録→勤務削除→希望再表示（従業員側の列拡張後も、この一連の流れが崩れない）
// ------------------------------------------------------------------
{
  var env19 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var wish19 = env19.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: '2026-10-10', start_time: '11:00', end_time: '19:00'
  })
  var registerResult19 = env19.sandbox.postShiftEntryFromWish({
    wish_id: wish19.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertContains(registerResult19, '登録しました', '19a. 希望からの勤務登録が成功する')
  assertEqual(env19.sandbox.getShiftWishesForBusinessDate('2026-10-10').length, 0, '19b. 勤務登録後は希望が時間軸から消える')

  var entries19 = env19.sandbox.getShiftEntriesForBusinessDate('2026-10-10')
  env19.sandbox.deleteShiftEntry({
    source_row: entries19[0].source_row, employee_id: entries19[0].employee_id,
    start_ms: entries19[0].start_ms, end_ms: entries19[0].end_ms
  })
  assertEqual(env19.sandbox.getShiftWishesForBusinessDate('2026-10-10').length, 1, '19c. 勤務削除後、希望が再表示される')
}

// ------------------------------------------------------------------
// 20. 勤務変更／削除（従業員希望シフト機能追加後も従来どおり動く）
// ------------------------------------------------------------------
{
  var env20 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env20.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: '2026-10-11', start_time: '11:00', end_time: '15:00'
  })
  var entries20 = env20.sandbox.getShiftEntriesForBusinessDate('2026-10-11')
  var updateResult20 = env20.sandbox.updateShiftEntry({
    source_row: entries20[0].source_row, employee_id: entries20[0].employee_id,
    start_ms: entries20[0].start_ms, end_ms: entries20[0].end_ms,
    business_date: '2026-10-11', start_time: '11:00', end_time: '16:00'
  })
  assertTrue(updateResult20.success, '20a. 勤務変更（updateShiftEntry）は従来どおり成功する')

  var entries20b = env20.sandbox.getShiftEntriesForBusinessDate('2026-10-11')
  var deleteResult20 = env20.sandbox.deleteShiftEntry({
    source_row: entries20b[0].source_row, employee_id: entries20b[0].employee_id,
    start_ms: entries20b[0].start_ms, end_ms: entries20b[0].end_ms
  })
  assertTrue(deleteResult20.success, '20b. 勤務削除（deleteShiftEntry）は従来どおり成功する')
}

// ------------------------------------------------------------------
// 21. 存在しないemployee_idを拒否する（freee従業員一覧に存在しないIDでの操作を拒否する）
// ------------------------------------------------------------------
{
  var env21 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var periodResult21 = env21.sandbox.getEmployeeWishPeriodData(UNKNOWN_EMP, YEAR, MONTH, PERIOD_FIRST)
  assertEqual(periodResult21.success, false, '21a. 存在しないemployee_idでの期間データ取得は拒否される')

  var submitResult21 = env21.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: UNKNOWN_EMP, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  assertEqual(submitResult21.success, false, '21b. 存在しないemployee_idでの一括提出は拒否される')
}

// ------------------------------------------------------------------
// 22. 既存回答が複数あり一意に特定できない場合は競合として提出全体を止める
//     （従来データに同じ従業員・同じ営業日の希望が複数存在するケースを、直接シートへ2行差し込んで再現する）
// ------------------------------------------------------------------
{
  var env22 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var wishSheet22 = env22.sandbox.getOrCreateShiftWishSheet_()
  var SandboxDate22 = vm.runInContext('Date', env22.sandbox)
  wishSheet22.getRange(2, 1, 1, 9).setValues([[
    'dup-wish-1', EMP_A, new SandboxDate22(2026, 9, 12),
    new SandboxDate22(2026, 9, 12, 11, 0), new SandboxDate22(2026, 9, 12, 14, 0),
    '未登録', '時間希望', '', false
  ]])
  wishSheet22.getRange(3, 1, 1, 9).setValues([[
    'dup-wish-2', EMP_A, new SandboxDate22(2026, 9, 12),
    new SandboxDate22(2026, 9, 12, 17, 0), new SandboxDate22(2026, 9, 12, 20, 0),
    '未登録', '時間希望', '', false
  ]])

  var days22 = env22.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct12_22 = days22.filter(function (d) { return d.date === '2026-10-12' })[0]
  assertTrue(oct12_22.conflict, '22a. 同じ従業員・同じ営業日に複数の既存データがある日はconflict=trueになる（勝手に統合しない）')

  var submitResult22 = env22.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-12', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  assertEqual(submitResult22.success, false, '22b. 競合日を含む提出は拒否される（一意に特定できないため自動更新しない）')
}

// ------------------------------------------------------------------
// 23. 保存対象間の矛盾（items内の日付重複）を拒否する
// ------------------------------------------------------------------
{
  var env23 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result23 = env23.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' },
      { date: '2026-10-01', answer_type: '出勤不可' }
    ]
  })
  assertEqual(result23.success, false, '23. 同じ提出内容の中で日付が重複していると拒否される')
  assertContains(result23.message, '重複', '23. 拒否理由に重複という説明が含まれる')
}

// ------------------------------------------------------------------
// 24. 一括保存は既存更新のみのケースで、希望シフトシートのデータ部分へのsetValues呼び出しが
//     1回になる（レビュー対応 2026-09-22、指摘1）
// ------------------------------------------------------------------
{
  var env24 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env24.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var writeCounter24 = wrapSheetWithDataWriteCounter_(env24.sheets['希望シフト'])
  var result24 = env24.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '12:00', end_time: '16:00' }]
  })
  assertTrue(result24.success, '24a. 既存更新のみの一括提出は成功する')
  assertEqual(writeCounter24.count, 1, '24b. 既存更新のみのケースで、希望シフトシートのデータ部分へのsetValues呼び出しは1回')
}

// ------------------------------------------------------------------
// 25. 一括保存は新規追加のみのケースでもsetValues呼び出しが1回になる
// ------------------------------------------------------------------
{
  var env25 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env25.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST) // シート初期化のみ（提出はしない）
  var writeCounter25 = wrapSheetWithDataWriteCounter_(env25.sandbox.getOrCreateShiftWishSheet_())
  var result25 = env25.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' },
      { date: '2026-10-02', answer_type: '出勤不可' }
    ]
  })
  assertTrue(result25.success, '25a. 新規追加のみの一括提出は成功する')
  assertEqual(writeCounter25.count, 1, '25b. 新規追加のみのケースで、希望シフトシートのデータ部分へのsetValues呼び出しは1回')
}

// ------------------------------------------------------------------
// 26. 一括保存は既存更新と新規追加が混在するケースでもsetValues呼び出しが1回になる
// ------------------------------------------------------------------
{
  var env26 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env26.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var writeCounter26 = wrapSheetWithDataWriteCounter_(env26.sheets['希望シフト'])
  var result26 = env26.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '16:00', end_time: '20:00' }, // 既存更新
      { date: '2026-10-05', answer_type: '出勤不可' } // 新規追加
    ]
  })
  assertTrue(result26.success, '26a. 既存更新と新規追加が混在する一括提出は成功する')
  assertEqual(writeCounter26.count, 1, '26b. 混在ケースでも、希望シフトシートのデータ部分へのsetValues呼び出しは1回')
  var days26 = env26.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var oct1_26 = days26.filter(function (d) { return d.date === '2026-10-01' })[0]
  var oct5_26 = days26.filter(function (d) { return d.date === '2026-10-05' })[0]
  assertEqual(oct1_26.start_time, '16:00', '26c. 既存更新分の内容が反映されている')
  assertEqual(oct5_26.answer_type, '出勤不可', '26d. 新規追加分の内容も反映されている')
}

// ------------------------------------------------------------------
// 27. データ部分へのsetValuesが例外になった場合、シートの事前状態が変わらない
//     （レビュー対応 2026-09-22、指摘1。書き込みが1回にまとまっているため、その1回が失敗すれば
//     単純に「何も書き込まれない」ことがそのまま保証される）
// ------------------------------------------------------------------
{
  var env27 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env27.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var beforeRows27 = env27.sheets['希望シフト']._rows.map(function (r) { return r.slice() })
  wrapSheetWithThrowingDataWrite_(env27.sheets['希望シフト'])

  var threw27 = false
  try {
    env27.sandbox.submitEmployeeShiftWishesBulk({
      employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
      items: [{ date: '2026-10-06', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
    })
  } catch (e) {
    threw27 = true
  }
  assertTrue(threw27, '27a. データ部分の書き込みが例外を投げた場合、その例外は呼び出し元へ伝わる')
  var afterRows27 = env27.sheets['希望シフト']._rows
  assertEqual(afterRows27, beforeRows27, '27b. 書き込み例外時、希望シフトシートの内容は書き込み前と完全に一致する（部分書き込みが残らない）')
}

// ------------------------------------------------------------------
// 28. 入力検証失敗時は、データ部分へのsetValues呼び出しが0回になる
// ------------------------------------------------------------------
{
  var env28 = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env28.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST)
  var writeCounter28 = wrapSheetWithDataWriteCounter_(env28.sandbox.getOrCreateShiftWishSheet_())
  var result28 = env28.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '13:00' }] // 2時間=不正
  })
  assertEqual(result28.success, false, '28a. 入力不正な一括提出は失敗する')
  assertEqual(writeCounter28.count, 0, '28b. 入力検証失敗時は、希望シフトシートのデータ部分へのsetValues呼び出しが0回')
}

// ------------------------------------------------------------------
// 29. 異なる営業日の希望時間が実時間で重なる提出を拒否する（レビュー対応 2026-09-22、指摘2）
//     29a: 一括提出内の別日付同士が実時間で重なる
//     29b: 既存の別日付希望と実時間で重なる
//     29c: 更新対象自身とは重複扱いにならない
//     29d: 出勤不可は重複比較の対象外
//     29e: 隣接しているだけ（重ならない）の時間は登録できる
// ------------------------------------------------------------------
{
  // 29a: 営業日10/1・00:00〜04:00（開始0時は0-2時範囲内のため翌日扱い＝実時間は10/2 00:00〜04:00）と、
  // 営業日10/2・03:00〜12:00（実時間は10/2 03:00〜12:00、開始3時は0-2時範囲外のため当日扱い）は、
  // どちらも「対象営業日（11:00〜翌3:00）と重なる」ため個別には妥当だが、実時間としては
  // 10/2 03:00〜04:00の1時間が重複する（現行の時間規則が「範囲内に収まる」ではなく
  // 「営業時間と重なる」ことしか確認しないために起き得る、別営業日間の実時間重複の再現）
  var env29a = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result29a = env29a.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '00:00', end_time: '04:00' }, // 実時間: 10/2 0:00〜4:00
      { date: '2026-10-02', answer_type: '時間希望', start_time: '03:00', end_time: '12:00' }  // 実時間: 10/2 3:00〜12:00（重なる）
    ]
  })
  assertEqual(result29a.success, false, '29a. 別営業日の希望同士が実時間で重なる一括提出は拒否される')
  assertContains(result29a.message, '重複', '29a. 拒否理由に重複という説明が含まれる')

  // 29b: 既存の別日付希望との実時間重複（29aと同じ組み合わせを、先に1件保存してから追加提出する形で再現）
  var env29b = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env29b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '00:00', end_time: '04:00' }]
  })
  var result29b = env29b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '03:00', end_time: '12:00' }]
  })
  assertEqual(result29b.success, false, '29b. 既存の別日付希望と実時間で重なる提出は拒否される')

  // 29c: 更新対象自身との重複は拒否されない（同じ日付・同じ時間帯で再提出しても自分自身とは比較しない）
  var env29c = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env29c.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var result29c = env29c.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '18:00' }]
  })
  assertTrue(result29c.success, '29c. 更新対象自身（同じ営業日）の既存行とは重複扱いにならず、変更が成功する')

  // 29d: 出勤不可は時刻を持たないため比較対象外（出勤不可と時間希望を同じ一括提出に混ぜても拒否されない）
  var env29d = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result29d = env29d.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '出勤不可' },
      { date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }
    ]
  })
  assertTrue(result29d.success, '29d. 出勤不可は時間希望との重複比較の対象外のため、一括提出は成功する')

  // 29e: 隣接している（重ならない）時間は登録できる（10/1 23:00〜翌3:00 と 10/2 の 3:00〜7:00は
  // 対象営業日11:00〜翌3:00の範囲外になるため、営業時間内で隣接するケースとして
  // 10/1 23:00〜翌2:00 と 10/2 2:00〜5:00... ではなく、同一営業日内の隣接（重ならない）で確認する）
  var env29e = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var result29e = env29e.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '14:00' },
      { date: '2026-10-02', answer_type: '時間希望', start_time: '14:00', end_time: '18:00' } // 実時間は10/1 14:00と隣接するが別営業日で重ならない
    ]
  })
  assertTrue(result29e.success, '29e. 実時間として重ならない（隣接するだけの）希望は一括提出できる')

  // 29f: 既存の時間希望Aを同じ一括提出で出勤不可へ変更し、別日Bへ「置き換え前のA」と実時間が
  //      重なる時間希望を設定するケース（再レビュー対応 2026-09-22）。保存後の最終状態では
  //      Aに時間がなくなるため、提出は成功しなければならない
  var env29f = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  // 1. 既存の時間希望A（10/1, 00:00〜04:00 → 実時間は10/2 00:00〜04:00）を作る
  env29f.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '00:00', end_time: '04:00' }]
  })
  var beforeDays29f = env29f.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var wishIdA29f = beforeDays29f.filter(function (d) { return d.date === '2026-10-01' })[0].wish_id

  // 2〜3. 同じ一括提出で、Aの日(10/1)を出勤不可へ変更し、別日B(10/2)へ
  //       「置き換え前のA」と実時間が重なる時間希望（03:00〜12:00）を設定する
  var result29f = env29f.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [
      { date: '2026-10-01', answer_type: '出勤不可' },
      { date: '2026-10-02', answer_type: '時間希望', start_time: '03:00', end_time: '12:00' }
    ]
  })
  // 4. 保存後の最終状態ではAに時間がないため、提出は成功する
  assertTrue(result29f.success, '29f. 既存の時間希望を同じ一括提出で出勤不可へ変更する場合、置き換え前の時間とは重複扱いにならず成功する')

  // 5. Aは出勤不可、Bは時間希望として保存されている
  var afterDays29f = env29f.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
  var afterA29f = afterDays29f.filter(function (d) { return d.date === '2026-10-01' })[0]
  var afterB29f = afterDays29f.filter(function (d) { return d.date === '2026-10-02' })[0]
  assertEqual(afterA29f.answer_type, '出勤不可', '29f. Aは出勤不可として保存されている')
  assertEqual(afterB29f.answer_type, '時間希望', '29f. Bは時間希望として保存されている')
  assertEqual(afterB29f.start_time, '03:00', '29f. Bの開始時刻が反映されている')

  // 6. Aの希望IDが維持され、重複行が増えていない
  assertEqual(afterA29f.wish_id, wishIdA29f, '29f. Aの希望IDは更新後も維持される（重複行が増えていない）')

  // 7. 今回送信していない既存時間希望との重複は、引き続き拒否される
  //    （10/3へ実時間で重なる新規時間希望を既存として作った上で、10/1のみを含む一括提出が拒否されることを確認）
  var env29g = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env29g.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '03:00', end_time: '12:00' }]
  })
  var result29g = env29g.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '00:00', end_time: '04:00' }]
  })
  assertEqual(result29g.success, false, '29g. 今回送信していない既存の時間希望と実時間で重なる場合は、引き続き拒否される')
}

// ------------------------------------------------------------------
// 30. 勤務登録済み日に勤務時間一覧が返る（レビュー対応 2026-09-22、指摘3）
//     30a: 希望由来勤務の時間表示　30b: 直接登録勤務の時間表示　30c: 複数勤務
//     30d: 翌日終了・翌日開始の表記　30e: 勤務登録済み日の編集拒否が維持される
// ------------------------------------------------------------------
{
  // 30a: 希望由来勤務
  var env30a = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env30a.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '19:00' }]
  })
  var wishId30a = env30a.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-01' })[0].wish_id
  env30a.sandbox.postShiftEntryFromWish({
    wish_id: wishId30a, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  var oct1_30a = env30a.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-01' })[0]
  assertEqual(oct1_30a.work_time_labels, ['12時00分〜17時00分'], '30a. 希望由来勤務の時間帯が表示用ラベルとして返る')

  // 30b: 直接登録勤務
  var env30b = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env30b.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: '2026-10-03', start_time: '11:00', end_time: '16:00'
  })
  var oct3_30b = env30b.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-03' })[0]
  assertEqual(oct3_30b.work_time_labels, ['11時00分〜16時00分'], '30b. 直接登録勤務の時間帯も表示用ラベルとして返る')

  // 30c: 複数勤務（希望由来1件＋直接登録1件、隣接させず別時間帯で同日に2件）
  var env30c = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env30c.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-04', answer_type: '時間希望', start_time: '11:00', end_time: '14:00' }]
  })
  var wishId30c = env30c.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-04' })[0].wish_id
  env30c.sandbox.postShiftEntryFromWish({
    wish_id: wishId30c, employee_id: EMP_A, start_time: '11:00', end_time: '14:00'
  })
  env30c.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: '2026-10-04', start_time: '18:00', end_time: '21:00'
  })
  var oct4_30c = env30c.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-04' })[0]
  assertEqual(oct4_30c.work_time_labels, ['11時00分〜14時00分', '18時00分〜21時00分'], '30c. 同じ営業日に複数勤務がある場合はすべて時系列順で返る')

  // 30d: 翌日開始・翌日終了の表記（23:00〜翌2:00）
  var env30d = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env30d.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: '2026-10-05', start_time: '23:00', end_time: '02:00'
  })
  var oct5_30d = env30d.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-05' })[0]
  assertEqual(oct5_30d.work_time_labels, ['23時00分〜翌2時00分'], '30d. 翌日終了は「翌」付きで表記される')

  // 30e: 勤務登録済み日の編集拒否が維持される（時間表示を追加しても既存の拒否ロジックは崩れない）
  var editResult30e = env30d.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-05', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  assertEqual(editResult30e.success, false, '30e. 勤務登録済み日への一括提出は引き続き拒否される')
}

// ------------------------------------------------------------------
// 31. 既存希望シートのG1〜I1見出しを安全に補う（レビュー対応 2026-09-22、指摘4）
//     31a: 新規9列シート　31b: 既存6列シートへの見出し追加　31c: 既存データが変化しない
//     31d: 既に9列なら書き込み不要　31e: 競合する非空見出しを上書きしない
// ------------------------------------------------------------------
{
  // 31a: 新規シートは常に9列ヘッダーで作られる（前提の再確認）
  var env31a = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var sheet31a = env31a.sandbox.getOrCreateShiftWishSheet_()
  var header31a = sheet31a.getRange(1, 1, 1, 9).getValues()[0]
  assertEqual(header31a.slice(6), ['回答区分', '最終提出日時', '期限後フラグ'], '31a. 新規シートはG1〜I1に期待どおりの見出しを持つ')

  // 31b: 既存6列シート（G〜I列自体がまだない）に、getOrCreateShiftWishSheet_を呼ぶだけで見出しが補われる
  var env31b = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var legacySheet31b = env31b.sandbox.SpreadsheetApp.getActiveSpreadsheet().insertSheet('希望シフト')
  legacySheet31b.getRange(1, 1, 1, 6).setValues([[
    '希望ID', '従業員ID', '対象営業日', '開始日時', '終了日時', '状態'
  ]])
  var reopened31b = env31b.sandbox.getOrCreateShiftWishSheet_()
  var header31b = reopened31b.getRange(1, 1, 1, 9).getValues()[0]
  assertEqual(header31b, ['希望ID', '従業員ID', '対象営業日', '開始日時', '終了日時', '状態', '回答区分', '最終提出日時', '期限後フラグ'],
    '31b. 既存6列シートを開くと、A〜F列を保ったままG1〜I1へ見出しが補われる')

  // 31c: 既存データ（2行目以降）は変化しない
  var env31c = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var legacySheet31c = env31c.sandbox.SpreadsheetApp.getActiveSpreadsheet().insertSheet('希望シフト')
  var SandboxDate31c = vm.runInContext('Date', env31c.sandbox)
  legacySheet31c.getRange(1, 1, 1, 6).setValues([[
    '希望ID', '従業員ID', '対象営業日', '開始日時', '終了日時', '状態'
  ]])
  legacySheet31c.getRange(2, 1, 1, 6).setValues([[
    'legacy-31c', EMP_B, new SandboxDate31c(2026, 9, 8), new SandboxDate31c(2026, 9, 8, 11, 0),
    new SandboxDate31c(2026, 9, 8, 15, 0), '未登録'
  ]])
  var beforeDataRow31c = legacySheet31c.getRange(2, 1, 1, 6).getValues()[0]
  env31c.sandbox.getOrCreateShiftWishSheet_()
  var afterDataRow31c = legacySheet31c.getRange(2, 1, 1, 6).getValues()[0]
  assertEqual(afterDataRow31c, beforeDataRow31c, '31c. 見出し補完後もA〜F列の既存データ（2行目）は変化しない')

  // 31d: 既に9列で期待どおりの見出しなら、書き込み（データ部分の変化）は起きない
  var env31d = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var sheet31d = env31d.sandbox.getOrCreateShiftWishSheet_() // 1回目で9列ヘッダーが作られる
  var writeCounter31d = wrapSheetWithDataWriteCounter_(sheet31d)
  env31d.sandbox.getOrCreateShiftWishSheet_() // 2回目は書き込み不要のはず
  assertEqual(writeCounter31d.count, 0, '31d. 既にG1〜I1が期待どおりの場合、2回目の取得では追加の書き込みが発生しない')

  // 31e: G1〜I1に想定と異なる非空の見出しが既にある場合は上書きせずエラーになる
  var env31e = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var legacySheet31e = env31e.sandbox.SpreadsheetApp.getActiveSpreadsheet().insertSheet('希望シフト')
  legacySheet31e.getRange(1, 1, 1, 9).setValues([[
    '希望ID', '従業員ID', '対象営業日', '開始日時', '終了日時', '状態', '既存の別用途列', '', ''
  ]])
  var threw31e = false
  var errorMessage31e = ''
  try {
    env31e.sandbox.getOrCreateShiftWishSheet_()
  } catch (e) {
    threw31e = true
    errorMessage31e = e.message
  }
  assertTrue(threw31e, '31e. G1に想定と異なる非空の見出しがある場合はエラーになる（黙って上書きしない）')
  assertContains(errorMessage31e, '想定と異なる', '31e. エラーメッセージに想定と異なる旨が含まれる')
  var headerAfterError31e = legacySheet31e.getRange(1, 7, 1, 3).getValues()[0]
  assertEqual(headerAfterError31e, ['既存の別用途列', '', ''], '31e. エラー時、G1〜I1は書き換えられずそのまま残る')
}

// ------------------------------------------------------------------
// 32. 希望シフト提出状況（getEmployeeWishSubmissionStatus、希望シフト提出状況_最小仕様.md）
//     32a: 前半15日・月により変わる後半の日数
//     32b: 全日回答が提出済み　32c: 一部回答が一部提出　32d: 回答0件が未提出
//     32e: 時間希望・出勤不可の両方を回答日として数える　32f: 未設定日を回答として数えない
//     32g: 同日複数行を要確認にし自動修復しない　32h: I列にtrueが1件以上あれば期限後あり
//     32i: 対象外年月・別従業員・freee一覧にいないIDを混ぜない
//     32j: 要確認→未提出→一部提出→提出済みの順、同じ状態内で元の従業員順を維持
//     32k: 不正な年月・期間を拒否　32l: シートへ書き込まない・希望IDを変更しない
// ------------------------------------------------------------------
{
  // 32a: 前半は常に15日、後半は月により日数が変わる（2026-10後半=16日、2027-02後半=13日）
  var env32a = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var resultFirst32a = env32a.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  assertEqual(resultFirst32a.target_day_count, 15, '32a. 前半（1〜15日）の対象日数は15日')
  var resultOctSecond32a = env32a.sandbox.getEmployeeWishSubmissionStatus(2026, 10, 'second_half')
  assertEqual(resultOctSecond32a.target_day_count, 16, '32a. 2026年10月後半（16〜31日）の対象日数は16日')
  var resultFebSecond32a = env32a.sandbox.getEmployeeWishSubmissionStatus(2027, 2, 'second_half')
  assertEqual(resultFebSecond32a.target_day_count, 13, '32a. 2027年2月後半（16〜28日）の対象日数は13日（月により日数が変わる）')

  // 32b〜32f: 全日回答／一部回答／回答0件の状態判定、時間希望・出勤不可の両方を回答として数える、
  // 未設定日を回答として数えない（EMP_Aは全15日を時間希望＋出勤不可の混在で回答、EMP_Bは一部のみ、
  // 3人目は未回答のまま）
  var env32b = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var itemsAllDays32b = []
  for (var dd = 1; dd <= 15; dd++) {
    var dateStr = '2026-10-' + (dd < 10 ? '0' + dd : dd)
    if (dd === 5) {
      itemsAllDays32b.push({ date: dateStr, answer_type: '出勤不可' }) // 32e: 出勤不可も回答として数える
    } else {
      itemsAllDays32b.push({ date: dateStr, answer_type: '時間希望', start_time: '11:00', end_time: '15:00' })
    }
  }
  var submit32b = env32b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST, items: itemsAllDays32b
  })
  assertTrue(submit32b.success, '32b. 前提: 全15日ぶんの一括提出が成功する')
  // EMP_Bは10日だけ回答（一部提出、32c・32f: 残り5日は未設定のまま＝未回答として数える）
  var itemsPartial32b = []
  for (var dp = 1; dp <= 10; dp++) {
    var pDateStr = '2026-10-' + (dp < 10 ? '0' + dp : dp)
    itemsPartial32b.push({ date: pDateStr, answer_type: '時間希望', start_time: '11:00', end_time: '15:00' })
  }
  env32b.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_B, year: YEAR, month: MONTH, period: PERIOD_FIRST, items: itemsPartial32b
  })

  var result32b = env32b.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  assertTrue(result32b.success, '32b. getEmployeeWishSubmissionStatusが成功する')
  var empAStatus32b = result32b.employees.filter(function (e) { return e.employee_id === EMP_A })[0]
  var empBStatus32b = result32b.employees.filter(function (e) { return e.employee_id === EMP_B })[0]
  var empCStatus32b = result32b.employees.filter(function (e) { return e.employee_id === '1003' })[0]

  assertEqual(empAStatus32b.status, 'complete', '32b. 全日回答（時間希望＋出勤不可の混在）は提出済み')
  assertEqual(empAStatus32b.answered_day_count, 15, '32b. 提出済みの回答日数は15日（出勤不可の1日も数える＝32e）')
  assertEqual(empAStatus32b.remaining_day_count, 0, '32b. 提出済みの未回答日数は0日')

  assertEqual(empBStatus32b.status, 'partial', '32c. 10日だけ回答（残り5日は未設定）は一部提出')
  assertEqual(empBStatus32b.answered_day_count, 10, '32c. 一部提出の回答日数は10日')
  assertEqual(empBStatus32b.remaining_day_count, 5, '32f. 未設定の5日は回答として数えず、未回答日数に残る')

  assertEqual(empCStatus32b.status, 'none', '32d. 1件も回答していない従業員は未提出')
  assertEqual(empCStatus32b.answered_day_count, 0, '32d. 未提出の回答日数は0日')
  assertEqual(empCStatus32b.remaining_day_count, 15, '32d. 未提出の未回答日数は対象日数と同じ15日')

  // 32g: 同じ従業員・同じ営業日に希望データが複数あると要確認になり、自動修復（統合・削除）しない
  var env32g = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var sheet32g = env32g.sandbox.getOrCreateShiftWishSheet_()
  var SandboxDate32g = vm.runInContext('Date', env32g.sandbox)
  // 同じ従業員・同じ営業日（10/1）に2行の希望データを直接書き込む（自動一意化できない状態を再現）
  sheet32g.getRange(2, 1, 2, 9).setValues([
    ['dup-a-32g', EMP_A, new SandboxDate32g(2026, 9, 1), new SandboxDate32g(2026, 9, 1, 11, 0), new SandboxDate32g(2026, 9, 1, 15, 0), '未登録', '時間希望', '', false],
    ['dup-b-32g', EMP_A, new SandboxDate32g(2026, 9, 1), new SandboxDate32g(2026, 9, 1, 16, 0), new SandboxDate32g(2026, 9, 1, 20, 0), '未登録', '時間希望', '', false]
  ])
  var rowsBefore32g = sheet32g.getRange(2, 1, 2, 9).getValues()
  var result32g = env32g.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  var empAStatus32g = result32g.employees.filter(function (e) { return e.employee_id === EMP_A })[0]
  assertEqual(empAStatus32g.status, 'conflict', '32g. 同じ営業日に複数の希望データがある従業員は要確認になる')
  assertEqual(empAStatus32g.conflict_date_count, 1, '32g. 競合している日数は1日')
  assertEqual(result32g.counts.conflict, 1, '32g. 集計の要確認人数に反映される')
  var rowsAfter32g = sheet32g.getRange(2, 1, 2, 9).getValues()
  assertEqual(rowsAfter32g, rowsBefore32g, '32g. 競合データは呼び出し後も内容が変化しない（自動修復しない）')

  // 32m: 競合日（同じ従業員・同じ営業日に2行）のうち1行だけI列の期限後フラグがtrueの場合、
  //      競合と期限後は排他的ではないため、要確認のままhas_late_submission=trueになる
  //      （再コードレビュー対応 2026-09-22、指摘1）
  var env32m = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var sheet32m = env32m.sandbox.getOrCreateShiftWishSheet_()
  var SandboxDate32m = vm.runInContext('Date', env32m.sandbox)
  // 同じ従業員・同じ営業日（10/1）に2行。片方だけI列（期限後フラグ）をtrueにする
  sheet32m.getRange(2, 1, 2, 9).setValues([
    ['dup-a-32m', EMP_A, new SandboxDate32m(2026, 9, 1), new SandboxDate32m(2026, 9, 1, 11, 0), new SandboxDate32m(2026, 9, 1, 15, 0), '未登録', '時間希望', '', true],
    ['dup-b-32m', EMP_A, new SandboxDate32m(2026, 9, 1), new SandboxDate32m(2026, 9, 1, 16, 0), new SandboxDate32m(2026, 9, 1, 20, 0), '未登録', '時間希望', '', false]
  ])
  var rowsBefore32m = sheet32m.getRange(2, 1, 2, 9).getValues()
  var result32m = env32m.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  var empAStatus32m = result32m.employees.filter(function (e) { return e.employee_id === EMP_A })[0]
  assertEqual(empAStatus32m.status, 'conflict', '32m. 競合日があれば期限後フラグの有無に関わらずstatusはconflict')
  assertEqual(empAStatus32m.conflict_date_count, 1, '32m. 競合している日数は1日')
  assertEqual(empAStatus32m.answered_day_count, 1, '32m. 同じ日を重複して数えず、回答日数は1日のまま')
  assertTrue(empAStatus32m.has_late_submission, '32m. 競合行のうち1件でもafter_deadline=trueなら期限後ありになる')
  assertEqual(result32m.counts.conflict, 1, '32m. 集計の要確認人数に反映される')
  assertEqual(result32m.counts.late, 1, '32m. 集計の期限後あり人数にも反映される（要確認人数とは別に1人として数える）')
  var rowsAfter32m = sheet32m.getRange(2, 1, 2, 9).getValues()
  assertEqual(rowsAfter32m, rowsBefore32m, '32m. 呼び出し後も元データを変更・削除していない')

  // 32h: 対象期間の現在の回答にI列の期限後フラグ=trueが1件以上あれば期限後あり
  var env32h = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env32h.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  env32h.sandbox.getCurrentTimeMs_ = function () { return DEADLINE_OVER_MS }
  env32h.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-02', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }] // 期限後の新規提出
  })
  var result32h = env32h.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  var empAStatus32h = result32h.employees.filter(function (e) { return e.employee_id === EMP_A })[0]
  assertTrue(empAStatus32h.has_late_submission, '32h. 期限後フラグがtrueの回答が1件でもあれば期限後あり')
  assertEqual(result32h.counts.late, 1, '32h. 集計の期限後あり人数に反映される')

  // 32i: 対象外年月・別従業員・freee一覧にいないIDを混ぜない
  var env32i = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  // 対象外年月（2026年9月）の希望はEMP_Aの前半へ混ぜない
  env32i.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: 2026, month: 9, period: PERIOD_FIRST,
    items: [{ date: '2026-09-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  // freee一覧にいないIDの希望データをシートへ直接書き込む（一覧・人数へ混ぜてはならない）
  var sheet32i = env32i.sandbox.getOrCreateShiftWishSheet_()
  var SandboxDate32i = vm.runInContext('Date', env32i.sandbox)
  var lastRow32i = sheet32i.getLastRow() + 1
  sheet32i.getRange(lastRow32i, 1, 1, 9).setValues([[
    'unknown-32i', UNKNOWN_EMP, new SandboxDate32i(2026, 9, 1), new SandboxDate32i(2026, 9, 1, 11, 0),
    new SandboxDate32i(2026, 9, 1, 15, 0), '未登録', '時間希望', '', false
  ]])
  var result32i = env32i.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  var employeeIds32i = result32i.employees.map(function (e) { return e.employee_id })
  assertEqual(employeeIds32i.indexOf(UNKNOWN_EMP), -1, '32i. freee従業員一覧にいないIDは一覧に含まれない')
  var empAStatus32i = result32i.employees.filter(function (e) { return e.employee_id === EMP_A })[0]
  assertEqual(empAStatus32i.answered_day_count, 0, '32i. 対象外年月（別月）の回答は対象期間の集計に混ざらない')
  var totalEmployees32i = result32i.counts.complete + result32i.counts.partial + result32i.counts.none + result32i.counts.conflict
  assertEqual(totalEmployees32i, FAKE_EMPLOYEES_.length, '32i. 集計人数の合計はfreee従業員一覧の人数と一致する（不明IDを混ぜない）')

  // 32j: 並び順は要確認→未提出→一部提出→提出済み、同じ状態内はgetEmployees()が返した順を維持する
  //      （FAKE_EMPLOYEES_の順は 1001=山田太郎, 1002=佐藤花子, 1003=鈴木一郎。1001と1003を共に
  //       未提出のままにし、元の順（1001が1003より先）が保たれることを確認する）
  var env32j = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env32j.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_B, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  }) // EMP_Bだけ一部提出、EMP_A・1003は未提出のまま
  var result32j = env32j.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  var orderedIds32j = result32j.employees.map(function (e) { return e.employee_id })
  assertEqual(orderedIds32j, [EMP_A, '1003', EMP_B],
    '32j. 未提出（元の従業員順を維持）が先頭に並び、一部提出が後ろに来る')

  // 32k: 不正な年月・期間を拒否する
  var env32k = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  var resultBadMonth32k = env32k.sandbox.getEmployeeWishSubmissionStatus(YEAR, 13, PERIOD_FIRST)
  assertEqual(resultBadMonth32k.success, false, '32k. 不正な月（13）は拒否される')
  var resultBadYear32k = env32k.sandbox.getEmployeeWishSubmissionStatus(1999, MONTH, PERIOD_FIRST)
  assertEqual(resultBadYear32k.success, false, '32k. 不正な年（範囲外）は拒否される')
  var resultBadPeriod32k = env32k.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, 'middle')
  assertEqual(resultBadPeriod32k.success, false, '32k. 不正な期間（前半／後半以外）は拒否される')

  // 32l: 表示専用のため、シートへ書き込まない・希望IDを変更しない
  var env32l = loadProductionWithFakeGasApis_(DEADLINE_OK_MS)
  env32l.sandbox.submitEmployeeShiftWishesBulk({
    employee_id: EMP_A, year: YEAR, month: MONTH, period: PERIOD_FIRST,
    items: [{ date: '2026-10-01', answer_type: '時間希望', start_time: '11:00', end_time: '15:00' }]
  })
  var sheet32l = env32l.sandbox.getOrCreateShiftWishSheet_()
  var writeCounter32l = wrapSheetWithDataWriteCounter_(sheet32l)
  var wishIdBefore32l = env32l.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-01' })[0].wish_id
  env32l.sandbox.getEmployeeWishSubmissionStatus(YEAR, MONTH, PERIOD_FIRST)
  assertEqual(writeCounter32l.count, 0, '32l. getEmployeeWishSubmissionStatusは希望シフトシートのデータ部分へ書き込まない')
  var wishIdAfter32l = env32l.sandbox.getEmployeeWishPeriodData(EMP_A, YEAR, MONTH, PERIOD_FIRST).days
    .filter(function (d) { return d.date === '2026-10-01' })[0].wish_id
  assertEqual(wishIdAfter32l, wishIdBefore32l, '32l. 希望IDは呼び出し後も変化しない')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのカレンダー操作・複数日選択・「選択日へ適用」「まとめて提出」ボタン操作')
console.log('- スマホ幅での実際のレイアウト・操作性')
console.log('- 実際のGoogleスプレッドシート上でのG〜I列の見た目・列幅・自動作成')
console.log('- 店主画面（js_shift.html）で期限後バーが実際に薄い赤で描画されること（CSSクラス付与は検証済み）')
console.log('- 二重クリック・並行操作が実際のGAS実行環境（LockService）で正しく直列化されること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
