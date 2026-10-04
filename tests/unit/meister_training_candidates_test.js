// 育成候補提示（app/meister_training_candidates.gs）を、本番の.gsファイルをNode.jsのvmで
// 直接読み込んで検証する。集計ロジックをこのファイルへ再実装しない。
//
// UrlFetchApp（fetchAll）・SpreadsheetApp・LockService・getEmployees（freee API）・
// getCurrentTimeMs_（現在時刻）はフェイクへ差し替える。純粋関数
// （resolveCompletedPastMonths_・calcAverageWorkDays_・countWishDaysInPeriod_・
// buildTrainingCandidates_・parseWorkRecordSummaryResponse_）は直接、公開関数
// getMeisterTrainingCandidatesはフェイクGAS APIを注入した状態で直接実行する。
//
// 実行: node meister_training_candidates_test.js
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

/**
 *  シート1枚分のデータをインメモリの2次元配列で保持する（employee_shift_wish_test.jsの
 *  createFakeSheet_と同じ実装。本番コードが実際に使う範囲だけを再現する）
 */
function coerceCellValue_(value, SandboxDate) {
  if (value instanceof SandboxDate) return value
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    var dparts = value.split('-')
    return new SandboxDate(Number(dparts[0]), Number(dparts[1]) - 1, Number(dparts[2]))
  }
  return value
}

function createFakeSheet_(headerRow, SandboxDate) {
  var rows = [headerRow.slice()]
  return {
    _rows: rows,
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
            for (var c2 = 0; c2 < values[r2].length; c2++) {
              rows[targetRowIndex][col - 1 + c2] = coerceCellValue_(values[r2][c2], SandboxDate)
            }
          }
        },
        setValue: function (value) {
          while (rows.length <= row - 1) rows.push([])
          rows[row - 1][col - 1] = coerceCellValue_(value, SandboxDate)
        }
      }
    }
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
 *  シートへのsetValue/setValues呼び出し回数を数えるラッパー（employee_shift_wish_test.jsの
 *  wrapSheetWithDataWriteCounter_と同じ考え方）。saveMeisterBulkChangesが全件拒否時に
 *  シートへ一切書き込んでいないことを、書き込みメソッドの呼び出し回数そのもので確認するために使う
 */
function wrapSheetWithWriteCounter_(sheet) {
  var counter = { setValueCount: 0, setValuesCount: 0 }
  var originalGetRange = sheet.getRange
  sheet.getRange = function (row, col, numRows, numCols) {
    var range = originalGetRange.call(sheet, row, col, numRows, numCols)
    var originalSetValue = range.setValue
    var originalSetValues = range.setValues
    range.setValue = function (value) {
      counter.setValueCount++
      return originalSetValue.call(range, value)
    }
    range.setValues = function (values) {
      counter.setValuesCount++
      return originalSetValues.call(range, values)
    }
    return range
  }
  return counter
}

/**
 *  UrlFetchApp.fetchAllのフェイク。responseByUrlは { url: () => {code, bodyText} または直接の
 *  {code, bodyText} } の形。呼び出し順・件数を記録し、テストから検証できるようにする。
 *  bodyTextが関数なら都度呼び出す（毎回同じレスポンスでなくてよいようにする。テストでは
 *  基本的に固定値を使うため、関数でなくてもよい）
 */
function createFakeUrlFetchApp_(responseByUrl, callLog) {
  return {
    fetchAll: function (requests) {
      return requests.map(function (req) {
        callLog.push(req.url)
        // 未定義URL（テストの設定漏れ、または回帰確認用の一時破壊で想定外のリクエストが
        // 飛んだ場合）は、テスト全体を例外で止めず404相当（取得失敗）として扱う。
        // 呼び出しの有無・件数はurlFetchCallLogで別途検証できるため、ここで例外にする必要はない
        var def = responseByUrl[req.url] || { code: 404, bodyText: JSON.stringify({ message: 'not found (fake)' }) }
        var code = typeof def.code === 'function' ? def.code() : def.code
        var bodyText = typeof def.bodyText === 'function' ? def.bodyText() : def.bodyText
        return {
          getResponseCode: function () {
            if (code === 'THROW') throw new Error('通信エラー（テスト用）')
            return code
          },
          getContentText: function () { return bodyText }
        }
      })
    }
  }
}

// entry_date（過去日）・retire_date（null＝在籍中）を持たせ、filterActiveEmployeesAsOf_で
// 全員が在籍扱いになるようにする（既存テストの意図＝候補抽出・並び順ロジックの検証を壊さない）
var FAKE_EMPLOYEES_ = [
  { id: 101, display_name: '従業員A', entry_date: '2020-01-01', retire_date: null },
  { id: 102, display_name: '従業員B', entry_date: '2020-01-01', retire_date: null },
  { id: 103, display_name: '従業員C', entry_date: '2020-01-01', retire_date: null }
]

/**
 *  本番の全.gsファイルを1つのVMコンテキストへ読み込み、SpreadsheetApp・LockService・
 *  UrlFetchApp・getEmployees（freee API）・companyId・accessToken・getCurrentTimeMs_（現在時刻）を
 *  フェイクへ差し替える。集計ロジック（resolveCompletedPastMonths_・calcAverageWorkDays_・
 *  countWishDaysInPeriod_・buildTrainingCandidates_・parseWorkRecordSummaryResponse_・
 *  fetchWorkRecordSummariesForCandidates_・getMeisterTrainingCandidates）は一切再実装せず、
 *  本番関数をそのまま呼び出す。
 */
function loadProductionWithFakeGasApis_(options) {
  options = options || {}
  var gsFiles = fs.readdirSync(APP_DIR).filter(function (n) { return n.endsWith('.gs') }).sort()
  var sheets = {}
  var urlFetchCallLog = []

  var sandbox = {
    console: console,
    LockService: createFakeLockService_(),
    Utilities: { getUuid: function () { return 'training-test-uuid' } }
  }
  vm.createContext(sandbox)
  var SandboxDate = vm.runInContext('Date', sandbox)
  sandbox.SpreadsheetApp = createFakeSpreadsheetApp_(sheets, SandboxDate)
  sandbox.UrlFetchApp = createFakeUrlFetchApp_(options.responseByUrl || {}, urlFetchCallLog)

  for (var i = 0; i < gsFiles.length; i++) {
    var filePath = path.join(APP_DIR, gsFiles[i])
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath })
  }

  // config.gsがvar companyId = 0（実値はGASエディタ側だけに入れる方針）を宣言しているため、
  // 全.gs読み込み後にテスト用の値で上書きする（読み込み順の途中で上書きしても、後続ファイルの
  // var宣言に巻き戻される。getEmployeesの差し替えと同じ理由でここに置く）
  sandbox.companyId = 999
  sandbox.accessToken = 'fake-token'

  sandbox.getEmployees = function () { return options.employees || FAKE_EMPLOYEES_ }

  if (typeof options.nowMs === 'number') {
    sandbox.getCurrentTimeMs_ = function () { return options.nowMs }
  }

  // マイスターマスタシート（A列=empId、B〜F列=MEISTER_KEYS: 手洗い伝道師,ホール,セット,仕込み,麺上げ）
  var maisterSheet = createFakeSheet_(['従業員ID', '手洗い伝道師', 'ホール', 'セット', '仕込み', '麺上げ'], SandboxDate)
  if (options.maisterRows) {
    options.maisterRows.forEach(function (r) {
      maisterSheet._rows.push([r.employee_id, !!r['手洗い伝道師'], !!r['ホール'], !!r['セット'], !!r['仕込み'], !!r['麺上げ']])
    })
  }
  sheets[sandbox.SHEET_NAME_MAISTER] = maisterSheet
  var maisterWriteCounter = wrapSheetWithWriteCounter_(maisterSheet)

  // 希望シフトシート（A〜I列）。_rows.pushはgetRange().setValuesを経由しないため
  // coerceCellValue_（"YYYY-MM-DD"文字列→Date変換）が働かない。getAllShiftWishRows_は
  // business_date・start_time・end_timeをinstanceof Dateで判定するため、ここで明示的に
  // vmコンテキストのDate（SandboxDate）へ変換してから積む（育成候補の月単位化テスト 2026-09-24 で
  // 実データを入れる必要が生じたため対応。既存のwishRows: []だけを使う呼び出し元には影響しない）。
  // business_dateは"YYYY-MM-DD"、start_time/end_timeは"YYYY-MM-DD HH:MM"の文字列で指定する
  function toSandboxDateIfDateKey_(value) {
    if (typeof value !== 'string') return value // Dateオブジェクト（SandboxDate）・空文字等はそのまま
    var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (dateOnly) return new SandboxDate(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    var dateTime = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value)
    if (dateTime) return new SandboxDate(Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]), Number(dateTime[4]), Number(dateTime[5]))
    return value
  }
  var wishSheet = createFakeSheet_(['希望ID', '従業員ID', '対象営業日', '開始日時', '終了日時', '状態', '回答区分', '最終提出日時', '期限後フラグ'], SandboxDate)
  if (options.wishRows) {
    options.wishRows.forEach(function (w) {
      wishSheet._rows.push([
        w.wish_id, w.employee_id, toSandboxDateIfDateKey_(w.business_date),
        toSandboxDateIfDateKey_(w.start_time || ''), toSandboxDateIfDateKey_(w.end_time || ''),
        w.status || '未登録', w.answer_type, w.last_submitted || '', !!w.after_deadline
      ])
    })
  }
  sheets[sandbox.SHEET_NAME_SHIFT_WISH] = wishSheet

  return { sandbox: sandbox, sheets: sheets, urlFetchCallLog: urlFetchCallLog, maisterWriteCounter: maisterWriteCounter }
}

/**
 *  work_record_summariesの正常レスポンス（公式スキーマどおり、トップレベルにwork_daysを持つ）を作る
 */
function makeWorkRecordSummaryUrl_(empId, year, month) {
  return 'https://api.freee.co.jp/hr/api/v1/employees/' + empId + '/work_record_summaries/' + year + '/' + month + '?company_id=999'
}
function okResponse_(workDays) {
  return { code: 200, bodyText: JSON.stringify({ year: 2026, month: 1, work_days: workDays }) }
}

console.log('検証対象: meister_training_candidates.gs（本番app内の全.gsファイルをフェイクGAS APIで実行）')
console.log('---')

var prodPure = loadProductionWithFakeGasApis_({}).sandbox

// ------------------------------------------------------------------
// 1. resolveCompletedPastMonths_: 現在月を含めない、完了済み直近3暦月（年跨ぎを含む）
// ------------------------------------------------------------------
assertEqual(prodPure.resolveCompletedPastMonths_(2026, 6), [{ year: 2026, month: 3 }, { year: 2026, month: 4 }, { year: 2026, month: 5 }],
  '1a. 2026年6月が現在月なら、対象は2026年3〜5月（現在月を含まない直近3か月）')
assertEqual(prodPure.resolveCompletedPastMonths_(2026, 1), [{ year: 2025, month: 10 }, { year: 2025, month: 11 }, { year: 2025, month: 12 }],
  '1b. 2026年1月が現在月なら、年跨ぎで2025年10〜12月になる')
assertEqual(prodPure.resolveCompletedPastMonths_(2026, 2), [{ year: 2025, month: 11 }, { year: 2025, month: 12 }, { year: 2026, month: 1 }],
  '1c. 2026年2月が現在月なら、2025年11月・12月・2026年1月（年跨ぎを1か月だけ含む）')

// ------------------------------------------------------------------
// 2. calcAverageWorkDays_: 3か月分work_daysの平均・小数第1位丸め、1件でも失敗ならnull
// ------------------------------------------------------------------
assertEqual(prodPure.calcAverageWorkDays_([{ ok: true, workDays: 20 }, { ok: true, workDays: 21 }, { ok: true, workDays: 22 }]), 21,
  '2a. 3か月とも取得成功なら平均を返す（20+21+22)/3=21')
assertEqual(prodPure.calcAverageWorkDays_([{ ok: true, workDays: 20 }, { ok: true, workDays: 21 }, { ok: true, workDays: 21 }]), 20.7,
  '2b. 小数第1位へ丸める（20+21+21)/3=20.666...→20.7）')
assertEqual(prodPure.calcAverageWorkDays_([{ ok: true, workDays: 20 }, { ok: false, workDays: null }, { ok: true, workDays: 22 }]), null,
  '2c. 1か月でも取得失敗（ok:false）ならnull（0日扱いにしない）')
assertEqual(prodPure.calcAverageWorkDays_([{ ok: true, workDays: 20 }, { ok: true, workDays: 21 }]), null,
  '2d. 3件揃っていなければnull')

// ------------------------------------------------------------------
// 3. parseWorkRecordSummaryResponse_: HTTPステータス・JSON形式・work_daysの妥当性を個別に検証する
// ------------------------------------------------------------------
function fakeResp_(code, bodyText, throwOnCode) {
  return {
    getResponseCode: function () { if (throwOnCode) throw new Error('通信失敗'); return code },
    getContentText: function () { return bodyText }
  }
}
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(200, JSON.stringify({ work_days: 15.5 }))), { ok: true, workDays: 15.5 },
  '3a. 200・正しいJSON・work_daysが数値なら成功として扱う')
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(401, JSON.stringify({ message: '権限がありません' }))), { ok: false, workDays: null },
  '3b. 非200（401=権限不足）は失敗として扱う（0日扱いにしない）')
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(403, JSON.stringify({ message: '権限がありません' }))), { ok: false, workDays: null },
  '3b2. 非200（403）も失敗として扱う')
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(200, '{不正なJSON')), { ok: false, workDays: null },
  '3c. 不正JSONは失敗として扱う')
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(200, JSON.stringify({ year: 2026 }))), { ok: false, workDays: null },
  '3d. work_days欠損は失敗として扱う（0日扱いにしない）')
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(200, JSON.stringify({ work_days: 'たくさん' }))), { ok: false, workDays: null },
  '3e. work_daysが数値でない（不正な値）場合は失敗として扱う')
assertEqual(prodPure.parseWorkRecordSummaryResponse_(fakeResp_(200, null, true)), { ok: false, workDays: null },
  '3f. 通信そのものが失敗（getResponseCodeが例外）した場合も失敗として扱う')

// ------------------------------------------------------------------
// 4. countWishDaysInPeriod_: 時間希望だけを一意日付で数える。出勤不可・対象期間外・別従業員は数えない
// ------------------------------------------------------------------
var periodKeySet4 = { '2026-10-01': true, '2026-10-02': true, '2026-10-03': true }
var wishRows4 = [
  { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 1) },
  { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 1) }, // 同日重複行（1日として数える）
  { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 2) },
  { employee_id: '101', answer_type: '出勤不可', business_date: new Date(2026, 9, 3) }, // 出勤不可は数えない
  { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 10) }, // 対象期間外
  { employee_id: '102', answer_type: '時間希望', business_date: new Date(2026, 9, 1) } // 別従業員
]
assertEqual(prodPure.countWishDaysInPeriod_('101', wishRows4, periodKeySet4), 2,
  '4a. 時間希望の一意日付だけを数える（10/1は重複行があっても1日、10/2で計2日）')
assertEqual(prodPure.countWishDaysInPeriod_('999', wishRows4, periodKeySet4), 0,
  '4b. 対象従業員の行が1件もなければ0日')

// ------------------------------------------------------------------
// 4x. resolveMonthDateKeySet_: 育成候補モーダルの月単位化（2026-09-24）で追加した、選択月の
//     1日〜月末までの日付キー集合を作る純粋関数。月末の違い（28〜31日）・年跨ぎを正しく扱う
// ------------------------------------------------------------------
{
  var keys31_4x = Object.keys(prodPure.resolveMonthDateKeySet_(2026, 10)).sort()
  assertEqual(keys31_4x.length, 31, '4x-a. 31日月（2026年10月）は31日ぶんのキーを持つ')
  assertTrue(keys31_4x.indexOf('2026-10-01') >= 0, '4x-b. 31日月は1日を含む')
  assertTrue(keys31_4x.indexOf('2026-10-31') >= 0, '4x-c. 31日月は月末（31日）を含む')
  assertTrue(keys31_4x.indexOf('2026-11-01') === -1, '4x-d. 31日月は翌月の日付を含まない')
  assertTrue(keys31_4x.indexOf('2026-09-30') === -1, '4x-e. 31日月は前月の日付を含まない')

  var keys30_4x = Object.keys(prodPure.resolveMonthDateKeySet_(2026, 9))
  assertEqual(keys30_4x.length, 30, '4x-f. 30日月（2026年9月）は30日ぶんのキーを持つ')

  var keysFeb平年_4x = Object.keys(prodPure.resolveMonthDateKeySet_(2026, 2))
  assertEqual(keysFeb平年_4x.length, 28, '4x-g. 平年の2月（2026年）は28日ぶんのキーを持つ')
  assertTrue(keysFeb平年_4x.indexOf('2026-02-29') === -1, '4x-h. 平年の2月は29日を含まない')

  var keysFebうるう_4x = Object.keys(prodPure.resolveMonthDateKeySet_(2028, 2))
  assertEqual(keysFebうるう_4x.length, 29, '4x-i. うるう年の2月（2028年）は29日ぶんのキーを持つ')
  assertTrue(keysFebうるう_4x.indexOf('2028-02-29') >= 0, '4x-j. うるう年の2月は29日を含む')

  var keysDec_4x = Object.keys(prodPure.resolveMonthDateKeySet_(2025, 12))
  assertEqual(keysDec_4x.length, 31, '4x-k. 12月から翌年1月への年跨ぎでも12月自体は31日ぶんのキーを持つ')
  assertTrue(keysDec_4x.indexOf('2025-12-31') >= 0, '4x-l. 12月は年末（12/31）を含む')
  assertTrue(keysDec_4x.indexOf('2026-01-01') === -1, '4x-m. 12月は翌年1月の日付を含まない')

  var keysJan_4x = Object.keys(prodPure.resolveMonthDateKeySet_(2026, 1))
  assertTrue(keysJan_4x.indexOf('2026-01-01') >= 0, '4x-n. 12月から翌年1月への年跨ぎで、1月側は年始（1/1）を含む')
  assertTrue(keysJan_4x.indexOf('2025-12-31') === -1, '4x-o. 1月は前年12月の日付を含まない')
}

// ------------------------------------------------------------------
// 4y. countWishDaysInPeriod_ + resolveMonthDateKeySet_: 選択月全体（1日と月末を含む）の
//     時間希望を数える。前月・翌月の希望は混ぜない。出勤不可・重複行は数えない（本番の組み合わせ）
// ------------------------------------------------------------------
{
  var monthKeySet4y = prodPure.resolveMonthDateKeySet_(2026, 10)
  var wishRows4y = [
    { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 1) }, // 月初
    { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 1) }, // 同日重複行
    { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 31) }, // 月末
    { employee_id: '101', answer_type: '出勤不可', business_date: new Date(2026, 9, 15) }, // 出勤不可は数えない
    { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 8, 30) }, // 前月（9/30）は数えない
    { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 10, 1) } // 翌月（11/1）は数えない
  ]
  assertEqual(prodPure.countWishDaysInPeriod_('101', wishRows4y, monthKeySet4y), 2,
    '4y. 選択月（10月）の1日・月末はそれぞれ1日として数え、重複行・出勤不可・前月・翌月は数えない（結果は2日）')
}

// ------------------------------------------------------------------
// 5. buildTrainingCandidates_: 並び順（平均取得できた者を多い順、同値はfreee順、
//    未取得は後ろでfreee順）。過去実績と希望日数を混ぜた総合点にしない
// ------------------------------------------------------------------
var candEmps5 = [
  { employee_id: '101', employee_name: '従業員A' },
  { employee_id: '102', employee_name: '従業員B' },
  { employee_id: '103', employee_name: '従業員C' },
  { employee_id: '104', employee_name: '従業員D' }
]
var summariesByEmp5 = {
  '101': [{ ok: true, workDays: 10 }, { ok: true, workDays: 10 }, { ok: true, workDays: 10 }], // 平均10
  '102': [{ ok: true, workDays: 20 }, { ok: true, workDays: 20 }, { ok: true, workDays: 20 }], // 平均20（最多）
  '103': [{ ok: false, workDays: null }, { ok: true, workDays: 20 }, { ok: true, workDays: 20 }], // 取得失敗
  '104': [{ ok: true, workDays: 10 }, { ok: true, workDays: 10 }, { ok: true, workDays: 10 }] // 平均10（101と同値）
}
var periodKeySet5 = { '2026-10-01': true }
var wishRows5 = [
  { employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 1) }, // 希望多いが並びには影響しない
  { employee_id: '102', answer_type: '出勤不可', business_date: new Date(2026, 9, 1) } // 希望0日
]
var built5 = prodPure.buildTrainingCandidates_(candEmps5, summariesByEmp5, wishRows5, periodKeySet5)
assertEqual(built5.map(function (c) { return c.employee_id }), ['102', '101', '104', '103'],
  '5a. 平均が多い順（102=20）→同値は元の順（101→104、どちらも10）→取得失敗（103）は最後')
assertEqual(built5[0].average_work_days, 20, '5b. 102の平均は20')
assertEqual(built5[3].average_work_days, null, '5c. 103は取得失敗のためnull（0日にしない）')
assertEqual(built5[1].wish_day_count, 1, '5d. 101の希望日数は1日（時間希望のみ）')
assertEqual(built5[0].wish_day_count, 0, '5e. 102の希望日数は0日（出勤不可は数えない）。希望日数の大小は並び順に影響しない（102が1位のまま）')
built5.forEach(function (c) {
  assertTrue(!('total_score' in c) && !('score' in c) && !('combined_score' in c), '5f. ' + c.employee_id + 'に過去実績と希望日数を混ぜた総合点フィールドがない')
})

// ------------------------------------------------------------------
// 6. buildTrainingCandidates_は入力配列を変更しない（純粋関数）
// ------------------------------------------------------------------
var candEmps6 = [{ employee_id: '101', employee_name: '従業員A' }]
var summaries6 = { '101': [{ ok: true, workDays: 5 }, { ok: true, workDays: 5 }, { ok: true, workDays: 5 }] }
var wishRows6 = [{ employee_id: '101', answer_type: '時間希望', business_date: new Date(2026, 9, 1) }]
var periodKeySet6 = { '2026-10-01': true }
var candEmpsCopy6 = JSON.parse(JSON.stringify(candEmps6))
var wishRowsLen6Before = wishRows6.length
prodPure.buildTrainingCandidates_(candEmps6, summaries6, wishRows6, periodKeySet6)
assertEqual(JSON.stringify(candEmps6.map(function (c) { return { employee_id: c.employee_id, employee_name: c.employee_name } })), JSON.stringify(candEmpsCopy6),
  '6. buildTrainingCandidates_はcandidateEmployees配列の内容を変更しない')
assertEqual(wishRows6.length, wishRowsLen6Before, '6. buildTrainingCandidates_はallWishRows配列を変更しない')

// ------------------------------------------------------------------
// 7. getMeisterTrainingCandidates: skillKey検証（手洗い伝道師・未定義キーは拒否）、
//    年月検証（不正年・0月・13月を拒否）。月単位化（2026-09-24）でperiod引数・
//    isValidWishPeriod_検証を削除したため、periodなしの3引数だけで呼び出せることを併せて確認する
// ------------------------------------------------------------------
var env7 = loadProductionWithFakeGasApis_({})
var result7a = env7.sandbox.getMeisterTrainingCandidates('手洗い伝道師', 2026, 10)
assertEqual(result7a.success, false, '7a. 手洗い伝道師はsuccess:falseで拒否される')
var result7b = env7.sandbox.getMeisterTrainingCandidates('未定義技能', 2026, 10)
assertEqual(result7b.success, false, '7b. 未定義の技能キーも拒否される')
var result7c = env7.sandbox.getMeisterTrainingCandidates('ホール', 99999, 10)
assertEqual(result7c.success, false, '7c. 不正な年（範囲外）は拒否される')
var result7d = env7.sandbox.getMeisterTrainingCandidates('ホール', 2026, 13)
assertEqual(result7d.success, false, '7d. 不正な月（13月）は拒否される')
var result7f = env7.sandbox.getMeisterTrainingCandidates('ホール', 2026, 0)
assertEqual(result7f.success, false, '7f. 不正な月（0月）は拒否される')
var result7g = env7.sandbox.getMeisterTrainingCandidates('ホール', 2026, 10)
assertTrue(result7g.success, '7g. periodを渡さず年月だけの3引数で呼び出しても成功する（月単位化後の公開関数の形）')
assertTrue(!('wish_period' in result7g), '7h. 戻り値に育成候補専用のwish_periodを含まない（月単位化で削除）')
assertEqual(result7g.wish_year, 2026, '7i. wish_yearは維持している')
assertEqual(result7g.wish_month, 10, '7i. wish_monthは維持している')

// ------------------------------------------------------------------
// 8. getMeisterTrainingCandidates: 保有人数が2人以上へ変わっていたら候補を返さず再読み込みを促す
// ------------------------------------------------------------------
var env8 = loadProductionWithFakeGasApis_({
  maisterRows: [
    { employee_id: '101', 'ホール': true },
    { employee_id: '102', 'ホール': true } // クライアントの古い表示では0人/1人だったはずが、最新は2人
  ]
})
var result8 = env8.sandbox.getMeisterTrainingCandidates('ホール', 2026, 10)
assertEqual(result8.success, false, '8a. 最新状態で保有人数が2人以上なら候補を返さない')
assertEqual(result8.needs_reload, true, '8b. 再読み込みを促すフラグを立てる')
assertEqual(env8.urlFetchCallLog.length, 0, '8d. 2人以上と判明した時点でfreeeの勤怠API（UrlFetchApp.fetchAll）を一切呼ばない')
assertTrue(!result8.candidates, '8c. candidatesを含めない')

// ------------------------------------------------------------------
// 9. getMeisterTrainingCandidates: 対象技能取得済みの従業員を除外し、未取得の在籍従業員を全員含める
// ------------------------------------------------------------------
var year9 = 2026, month9 = 10
var pastMonths9 = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }]
var responseByUrl9 = {}
;['101', '102', '103'].forEach(function (empId) {
  pastMonths9.forEach(function (pm) {
    responseByUrl9[makeWorkRecordSummaryUrl_(empId, pm.year, pm.month)] = okResponse_(10)
  })
})
var env9 = loadProductionWithFakeGasApis_({
  maisterRows: [{ employee_id: '101', 'ホール': true }], // 101だけホール取得済み（0人ではなく実質1人は101ではない別状態を作るため後述の2人検証と分離）
  responseByUrl: responseByUrl9,
  nowMs: new Date(year9, month9 - 1, 20).getTime() // 2026-10-20を「現在」とする
})
var result9 = env9.sandbox.getMeisterTrainingCandidates('ホール', year9, month9)
assertTrue(result9.success, '9-前提. 保有者1人（101）の状態で候補取得に成功する')
assertEqual(result9.candidates.map(function (c) { return c.employee_id }).sort(), ['102', '103'],
  '9a. ホール取得済みの101を除外し、未取得の102・103を全員候補にする')

// ------------------------------------------------------------------
// 10. getMeisterTrainingCandidates: 過去勤務0日・希望0日でも候補から除外しない
// ------------------------------------------------------------------
var responseByUrl10 = {}
;['101', '102', '103'].forEach(function (empId) {
  pastMonths9.forEach(function (pm) {
    responseByUrl10[makeWorkRecordSummaryUrl_(empId, pm.year, pm.month)] = okResponse_(0) // 全員0日
  })
})
var env10 = loadProductionWithFakeGasApis_({
  maisterRows: [], // 誰もホールを持っていない（0人）
  responseByUrl: responseByUrl10,
  wishRows: [], // 希望データなし（希望0日）
  nowMs: new Date(year9, month9 - 1, 20).getTime()
})
var result10 = env10.sandbox.getMeisterTrainingCandidates('ホール', year9, month9)
assertEqual(result10.candidates.length, 3, '10a. 過去勤務0日・希望0日の従業員も除外されず3人とも候補に含まれる')
result10.candidates.forEach(function (c) {
  assertEqual(c.average_work_days, 0, '10b. ' + c.employee_id + 'の月平均は0日（除外ではなく0という値として表示する）')
  assertEqual(c.wish_day_count, 0, '10c. ' + c.employee_id + 'の希望日数は0日')
})

// ------------------------------------------------------------------
// 11. getMeisterTrainingCandidates: 一部候補者の勤怠取得失敗時、partial_failureがtrueになり、
//     取得できた候補者は表示される（除外されない）
// ------------------------------------------------------------------
var responseByUrl11 = {}
pastMonths9.forEach(function (pm) {
  responseByUrl11[makeWorkRecordSummaryUrl_('102', pm.year, pm.month)] = okResponse_(15)
  responseByUrl11[makeWorkRecordSummaryUrl_('103', pm.year, pm.month)] = okResponse_(15)
})
// 101は3か月中1か月だけ403（権限不足）で失敗させる
responseByUrl11[makeWorkRecordSummaryUrl_('101', pastMonths9[0].year, pastMonths9[0].month)] = { code: 403, bodyText: JSON.stringify({ message: '権限がありません' }) }
responseByUrl11[makeWorkRecordSummaryUrl_('101', pastMonths9[1].year, pastMonths9[1].month)] = okResponse_(15)
responseByUrl11[makeWorkRecordSummaryUrl_('101', pastMonths9[2].year, pastMonths9[2].month)] = okResponse_(15)
var env11 = loadProductionWithFakeGasApis_({
  maisterRows: [],
  responseByUrl: responseByUrl11,
  nowMs: new Date(year9, month9 - 1, 20).getTime()
})
var result11 = env11.sandbox.getMeisterTrainingCandidates('ホール', year9, month9)
assertEqual(result11.partial_failure, true, '11a. 一部候補者（101）の取得失敗でpartial_failureがtrueになる')
assertEqual(result11.candidates.length, 3, '11b. 取得失敗者も含めて3人とも一覧に表示される（除外しない）')
var cand101_11 = result11.candidates.filter(function (c) { return c.employee_id === '101' })[0]
assertEqual(cand101_11.average_work_days, null, '11c. 101の月平均はnull（取得できませんと表示する材料。0日にしない）')
var successIndex11 = result11.candidates.map(function (c) { return c.employee_id }).indexOf('102')
var failIndex11 = result11.candidates.map(function (c) { return c.employee_id }).indexOf('101')
assertTrue(failIndex11 > successIndex11, '11d. 取得失敗者（101）は取得できた候補者（102）より後ろに置かれる')

// ------------------------------------------------------------------
// 12. getMeisterTrainingCandidates: 候補者が0人の場合、空配列を返す（画面側が「対象技能を
//     持っていない在籍従業員はいません」を表示する。メッセージ文言はクライアント側の責務）。
//     在籍従業員が1人だけで、その1人が対象技能を保有している（＝1人依存の状態）なら、
//     対象技能を持っていない候補者は0人になる
// ------------------------------------------------------------------
var env12 = loadProductionWithFakeGasApis_({
  employees: [{ id: 101, display_name: '従業員A', entry_date: '2020-01-01', retire_date: null }], // 在籍1人だけ
  maisterRows: [{ employee_id: '101', 'ホール': true }], // その1人だけがホールを保有（1人依存）
  nowMs: new Date(year9, month9 - 1, 20).getTime()
})
var result12 = env12.sandbox.getMeisterTrainingCandidates('ホール', year9, month9)
assertTrue(result12.success, '12-前提. 在籍1人・保有者1人（一人依存）は候補取得に成功する')
assertEqual(result12.candidates, [], '12a. 対象技能を持っていない在籍従業員がいない場合、candidatesは空配列')

// ------------------------------------------------------------------
// 13. 年跨ぎ（1月が対象月）でもgetMeisterTrainingCandidatesが正しく動く
// ------------------------------------------------------------------
var pastMonthsJan13 = [{ year: 2025, month: 10 }, { year: 2025, month: 11 }, { year: 2025, month: 12 }]
var responseByUrl13 = {}
;['101', '102', '103'].forEach(function (empId) {
  pastMonthsJan13.forEach(function (pm) {
    responseByUrl13[makeWorkRecordSummaryUrl_(empId, pm.year, pm.month)] = okResponse_(12)
  })
})
var env13 = loadProductionWithFakeGasApis_({
  maisterRows: [],
  responseByUrl: responseByUrl13,
  nowMs: new Date(2026, 0, 10).getTime() // 現在=2026年1月10日
})
var result13 = env13.sandbox.getMeisterTrainingCandidates('セット', 2026, 1)
assertTrue(result13.success, '13a. 1月を現在月とする年跨ぎでも成功する')
assertEqual(result13.past_months, pastMonthsJan13, '13b. 過去3か月は2025年10〜12月（年跨ぎを正しく処理）')

// ------------------------------------------------------------------
// 13x. getMeisterTrainingCandidates: 公開関数を通して、選択月全体（1日〜月末）の希望日数を数え、
//      前月・翌月の希望を混ぜない（エンドツーエンド。周期を単純化するため過去3か月の勤怠は
//      全員0日に揃える）
// ------------------------------------------------------------------
{
  var pastMonths13x = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }]
  var responseByUrl13x = {}
  ;['101'].forEach(function (empId) {
    pastMonths13x.forEach(function (pm) {
      responseByUrl13x[makeWorkRecordSummaryUrl_(empId, pm.year, pm.month)] = okResponse_(0)
    })
  })
  var env13x = loadProductionWithFakeGasApis_({
    employees: [{ id: 101, display_name: '従業員A', entry_date: '2020-01-01', retire_date: null }],
    maisterRows: [],
    responseByUrl: responseByUrl13x,
    wishRows: [
      { wish_id: 'w1', employee_id: '101', business_date: '2026-10-01', answer_type: '時間希望', start_time: '2026-10-01 09:00', end_time: '2026-10-01 17:00' }, // 対象月・月初
      { wish_id: 'w2', employee_id: '101', business_date: '2026-10-01', answer_type: '時間希望', start_time: '2026-10-01 10:00', end_time: '2026-10-01 18:00' }, // 同一従業員・同一日付の重複行
      { wish_id: 'w3', employee_id: '101', business_date: '2026-10-31', answer_type: '時間希望', start_time: '2026-10-31 09:00', end_time: '2026-10-31 17:00' }, // 対象月・月末
      { wish_id: 'w4', employee_id: '101', business_date: '2026-10-15', answer_type: '出勤不可' }, // 出勤不可は数えない
      { wish_id: 'w5', employee_id: '101', business_date: '2026-09-30', answer_type: '時間希望', start_time: '2026-09-30 09:00', end_time: '2026-09-30 17:00' }, // 前月は数えない
      { wish_id: 'w6', employee_id: '101', business_date: '2026-11-01', answer_type: '時間希望', start_time: '2026-11-01 09:00', end_time: '2026-11-01 17:00' } // 翌月は数えない
    ],
    nowMs: new Date(2026, 9, 20).getTime()
  })
  var result13x = env13x.sandbox.getMeisterTrainingCandidates('ホール', 2026, 10)
  assertTrue(result13x.success, '13x-前提. 候補取得に成功する')
  assertEqual(result13x.candidates.length, 1, '13x-前提. 候補は101の1人')
  assertEqual(result13x.candidates[0].wish_day_count, 2, '13x. 対象月（10月）の1日・31日（月末）だけを数え、重複行は1日、出勤不可・前月・翌月は数えない（結果は2日）')
}

// ------------------------------------------------------------------
// 14. getEmployees・getAllMaisterSummaries呼び出しはページ初期表示に含まれない
//     （getMeisterTrainingCandidatesのソースにgetEmployees呼び出しが含まれることを確認しつつ、
//     この関数自体がgetMeisterBulkViewとは独立した公開関数であることをソースで確認する）
// ------------------------------------------------------------------
var fnSource14 = prodPure.getMeisterTrainingCandidates.toString()
assertTrue(fnSource14.indexOf('getEmployees()') >= 0, '14a. getMeisterTrainingCandidatesは最新のfreee従業員一覧を取得する')
assertTrue(fnSource14.indexOf('getAllMaisterSummaries()') >= 0, '14b. getMeisterTrainingCandidatesは保存済みマイスター情報を取得する')
assertTrue(fnSource14.indexOf('SpreadsheetApp') === -1, '14c. getMeisterTrainingCandidates自体はSpreadsheetAppへ直接アクセスしない（既存関数経由のみ）')
assertTrue(fnSource14.indexOf('setValue') === -1 && fnSource14.indexOf('.setValues') === -1, '14d. getMeisterTrainingCandidatesは書き込み（setValues/setValue）を一切行わない')

// ------------------------------------------------------------------
// 15. filterActiveEmployeesAsOf_: 入社日前は除外、入社日当日は含む
// ------------------------------------------------------------------
{
  var empsBeforeEntry15 = [
    { id: 201, display_name: '入社前', entry_date: '2026-10-02', retire_date: null }, // 基準日の翌日入社
    { id: 202, display_name: '入社当日', entry_date: '2026-10-01', retire_date: null } // 基準日と同日入社
  ]
  var active15 = prodPure.filterActiveEmployeesAsOf_(empsBeforeEntry15, '2026-10-01')
  assertEqual(active15.map(function (e) { return e.id }), [202], '15a. 入社日が基準日より後（翌日）の従業員は除外する')
  assertEqual(active15.length, 1, '15b. 入社日当日の従業員は含む（entry_date <= 基準日を満たす）')
}

// ------------------------------------------------------------------
// 16. filterActiveEmployeesAsOf_: retire_dateなしは含む、退職日当日は含む、退職日の翌日は除外
// ------------------------------------------------------------------
{
  var empsRetire16 = [
    { id: 301, display_name: '退職日なし', entry_date: '2020-01-01', retire_date: null },
    { id: 302, display_name: '退職日当日', entry_date: '2020-01-01', retire_date: '2026-10-01' },
    { id: 303, display_name: '退職日翌日基準', entry_date: '2020-01-01', retire_date: '2026-09-30' }, // 基準日の前日に退職＝基準日には既に退職済み
    { id: 304, display_name: '退職日空文字', entry_date: '2020-01-01', retire_date: '' }
  ]
  var active16 = prodPure.filterActiveEmployeesAsOf_(empsRetire16, '2026-10-01')
  var activeIds16 = active16.map(function (e) { return e.id })
  assertTrue(activeIds16.indexOf(301) >= 0, '16a. retire_dateがnullの従業員は在籍扱い（含む）')
  assertTrue(activeIds16.indexOf(302) >= 0, '16b. 退職日（retire_date）が基準日と同日の従業員は在籍扱い（退職日当日は含む）')
  assertTrue(activeIds16.indexOf(303) === -1, '16c. 退職日が基準日より前（基準日は退職日の翌日）の従業員は除外する')
  assertTrue(activeIds16.indexOf(304) >= 0, '16d. retire_dateが空文字の従業員は在籍扱い（含む）')
}

// ------------------------------------------------------------------
// 17. filterActiveEmployeesAsOf_: entry_date欠損・不正時の採用方針（在籍扱いにせず除外する）を固定する
// ------------------------------------------------------------------
{
  var empsInvalid17 = [
    { id: 401, display_name: 'entry_dateなし', retire_date: null }, // entry_date自体が欠損
    { id: 402, display_name: 'entry_date空文字', entry_date: '', retire_date: null },
    { id: 403, display_name: 'entry_date不正形式', entry_date: '2026/10/01', retire_date: null }, // "/"区切りは不正
    { id: 404, display_name: 'entry_date正常', entry_date: '2020-01-01', retire_date: null }
  ]
  var active17 = prodPure.filterActiveEmployeesAsOf_(empsInvalid17, '2026-10-01')
  var activeIds17 = active17.map(function (e) { return e.id })
  assertTrue(activeIds17.indexOf(401) === -1, '17a. entry_dateが欠損（undefined）の従業員は在籍扱いにせず除外する')
  assertTrue(activeIds17.indexOf(402) === -1, '17b. entry_dateが空文字の従業員は在籍扱いにせず除外する')
  assertTrue(activeIds17.indexOf(403) === -1, '17c. entry_dateが不正な形式（"YYYY-MM-DD"以外）の従業員は在籍扱いにせず除外する')
  assertTrue(activeIds17.indexOf(404) >= 0, '17d. entry_dateが正しい形式の従業員は通常どおり判定される')

  // retire_dateが非空だが不正な形式の場合も、安全側として除外する方針を固定する
  var empsInvalidRetire17 = [{ id: 405, display_name: 'retire_date不正形式', entry_date: '2020-01-01', retire_date: '不正な値' }]
  var active17b = prodPure.filterActiveEmployeesAsOf_(empsInvalidRetire17, '2026-10-01')
  assertEqual(active17b.length, 0, '17e. retire_dateが非空かつ不正な形式の従業員は、安全側として除外する')
}

// ------------------------------------------------------------------
// 18. filterActiveEmployeesAsOf_は入力配列・各従業員オブジェクトを変更しない（純粋関数）
// ------------------------------------------------------------------
{
  var empsOriginal18 = [
    { id: 501, display_name: 'A', entry_date: '2020-01-01', retire_date: null },
    { id: 502, display_name: 'B', entry_date: '2026-10-02', retire_date: null } // 除外される側
  ]
  var empsCopy18 = JSON.parse(JSON.stringify(empsOriginal18))
  prodPure.filterActiveEmployeesAsOf_(empsOriginal18, '2026-10-01')
  assertEqual(JSON.stringify(empsOriginal18), JSON.stringify(empsCopy18), '18. filterActiveEmployeesAsOf_は入力配列・従業員オブジェクトの内容を変更しない')
}

// ------------------------------------------------------------------
// 19. getMeisterTrainingCandidates: 退職者が対象技能を持っていても保有人数（holder_count相当）に含めない
// ------------------------------------------------------------------
{
  var pastMonths19 = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }]
  var responseByUrl19 = {}
  ;['101'].forEach(function (empId) {
    pastMonths19.forEach(function (pm) {
      responseByUrl19[makeWorkRecordSummaryUrl_(empId, pm.year, pm.month)] = okResponse_(10)
    })
  })
  var env19 = loadProductionWithFakeGasApis_({
    employees: [
      { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
      { id: 102, display_name: '退職者', entry_date: '2020-01-01', retire_date: '2026-09-01' } // 基準日（10/20）より前に退職済み
    ],
    // 101（在籍）・102（退職済み）の両方がホールを保有している設定。退職者を除外すれば実質1人依存のはず
    maisterRows: [
      { employee_id: '101', 'ホール': true },
      { employee_id: '102', 'ホール': true }
    ],
    responseByUrl: responseByUrl19,
    nowMs: new Date(2026, 9, 20).getTime() // 2026-10-20を「現在」とする
  })
  var result19 = env19.sandbox.getMeisterTrainingCandidates('ホール', 2026, 10)
  assertTrue(result19.success, '19-前提. 退職者を除けば保有者は101の1人だけなので、2人以上として拒否されず候補取得に成功する')
  assertEqual(result19.candidates.length, 0, '19a. 対象技能（ホール）を持っていない在籍従業員はいない（101が唯一の在籍者で保有済み、102は退職者のため対象外）')
}

// ------------------------------------------------------------------
// 20. getMeisterTrainingCandidates: 退職者は、対象技能を持っていなくても育成候補に表示されない
// ------------------------------------------------------------------
{
  var pastMonths20 = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }]
  var responseByUrl20 = {}
  ;['101'].forEach(function (empId) {
    pastMonths20.forEach(function (pm) {
      responseByUrl20[makeWorkRecordSummaryUrl_(empId, pm.year, pm.month)] = okResponse_(5)
    })
  })
  var env20 = loadProductionWithFakeGasApis_({
    employees: [
      { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
      { id: 102, display_name: '退職者', entry_date: '2020-01-01', retire_date: '2026-09-01' } // 対象技能未取得のまま退職済み
    ],
    maisterRows: [], // 誰もホールを保有していない（0人）
    responseByUrl: responseByUrl20,
    nowMs: new Date(2026, 9, 20).getTime()
  })
  var result20 = env20.sandbox.getMeisterTrainingCandidates('ホール', 2026, 10)
  assertTrue(result20.success, '20-前提. 候補取得に成功する')
  assertEqual(result20.candidates.map(function (c) { return c.employee_id }), ['101'],
    '20a. 対象技能を持っていなくても、退職者（102）は候補一覧に含まれない（101のみ）')
}

// ------------------------------------------------------------------
// 21. マイスター一括表（getMeisterBulkView）・技能別育成優先度カード・育成候補の保有人数再判定が
//     同じ在籍集合を使う（退職者を含む同じfreee従業員一覧から、3つの結果すべてで退職者が除外される）
// ------------------------------------------------------------------
{
  var employeesWithRetiree21 = [
    { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
    { id: 102, display_name: '退職者', entry_date: '2020-01-01', retire_date: '2026-09-01' }
  ]
  var maisterRows21 = [
    { employee_id: '101', 'ホール': true },
    { employee_id: '102', 'ホール': true }
  ]
  var nowMs21 = new Date(2026, 9, 20).getTime()

  // 21a. getMeisterBulkView（マイスター一括表・技能別育成優先度カード）
  var envBulk21 = loadProductionWithFakeGasApis_({ employees: employeesWithRetiree21, maisterRows: maisterRows21, nowMs: nowMs21 })
  var bulkResult21 = envBulk21.sandbox.getMeisterBulkView()
  assertEqual(bulkResult21.rows.length, 1, '21a. getMeisterBulkViewのrowsは退職者を除いた在籍1人だけ')
  assertEqual(bulkResult21.rows[0].employee_id, '101', '21a. rowsに残るのは在籍者（101）のみ')
  var holeSkill21 = bulkResult21.skill_priority.filter(function (s) { return s.key === 'ホール' })[0]
  assertEqual(holeSkill21.holder_count, 1, '21b. 技能別育成優先度カードのホール保有人数は、退職者を除いた1人（一人依存）')
  assertEqual(holeSkill21.status, 'single', '21b. ステータスは一人依存・育成優先（2人以上ではない）')

  // 21c. getMeisterTrainingCandidates（サーバー側の保有人数再判定）が同じ結論（2人以上ではない）に達し、
  //      候補取得を拒否しないことを確認する（母集団が一致していれば、bulkView側と矛盾しない）
  var envCand21 = loadProductionWithFakeGasApis_({ employees: employeesWithRetiree21, maisterRows: maisterRows21, nowMs: nowMs21 })
  var candResult21 = envCand21.sandbox.getMeisterTrainingCandidates('ホール', 2026, 10)
  assertTrue(candResult21.success, '21c. 育成候補側の保有人数再判定も、退職者を除いた1人依存と判断し候補取得を拒否しない（bulkViewと矛盾しない）')
}

// ------------------------------------------------------------------
// 22. saveMeisterBulkChanges: 在籍従業員IDだけを有効として保存できる
// ------------------------------------------------------------------
{
  var employees22 = [
    { id: 101, display_name: '在籍者A', entry_date: '2020-01-01', retire_date: null },
    { id: 102, display_name: '在籍者B', entry_date: '2020-01-01', retire_date: null }
  ]
  var env22 = loadProductionWithFakeGasApis_({ employees: employees22, nowMs: new Date(2026, 9, 1).getTime() })
  var request22 = { changes: [{ employee_id: '101', badges: { 'ホール': true } }] }
  var result22 = env22.sandbox.saveMeisterBulkChanges(request22)
  assertTrue(result22.success, '22a. 在籍従業員（101）だけを対象にした変更は保存できる')
  assertEqual(result22.saved_count, 1, '22b. 保存件数は1件')
  assertEqual(env22.maisterWriteCounter.setValuesCount, 1, '22c. マイスターマスタへの書き込みが1回行われる')
}

// ------------------------------------------------------------------
// 23. saveMeisterBulkChanges: 退職済み従業員を含む変更はsuccess:falseになり、
//     SpreadsheetAppのsetValue/setValuesを一度も呼ばない
// ------------------------------------------------------------------
{
  var employees23 = [
    { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
    { id: 102, display_name: '退職者', entry_date: '2020-01-01', retire_date: '2026-08-01' } // 基準日（10/1）より前に退職済み
  ]
  var env23 = loadProductionWithFakeGasApis_({ employees: employees23, nowMs: new Date(2026, 9, 1).getTime() })
  var request23 = { changes: [{ employee_id: '102', badges: { 'ホール': true } }] } // 退職者だけを対象にした変更
  var result23 = env23.sandbox.saveMeisterBulkChanges(request23)
  assertEqual(result23.success, false, '23a. 退職済み従業員（102）を含む変更はsuccess:falseになる')
  assertEqual(env23.maisterWriteCounter.setValueCount, 0, '23b. setValueは一度も呼ばれない')
  assertEqual(env23.maisterWriteCounter.setValuesCount, 0, '23c. setValuesは一度も呼ばれない')
}

// ------------------------------------------------------------------
// 24. saveMeisterBulkChanges: 入社前従業員を含む変更も同様に全件保存しない
// ------------------------------------------------------------------
{
  var employees24 = [
    { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
    { id: 103, display_name: '入社前', entry_date: '2026-11-01', retire_date: null } // 基準日（10/1）より後に入社予定
  ]
  var env24 = loadProductionWithFakeGasApis_({ employees: employees24, nowMs: new Date(2026, 9, 1).getTime() })
  var request24 = { changes: [{ employee_id: '103', badges: { 'セット': true } }] }
  var result24 = env24.sandbox.saveMeisterBulkChanges(request24)
  assertEqual(result24.success, false, '24a. 入社前従業員（103）を含む変更はsuccess:falseになる')
  assertEqual(env24.maisterWriteCounter.setValueCount, 0, '24b. setValueは一度も呼ばれない')
  assertEqual(env24.maisterWriteCounter.setValuesCount, 0, '24c. setValuesは一度も呼ばれない')
}

// ------------------------------------------------------------------
// 25. saveMeisterBulkChanges: 在籍者と退職者が混在するリクエストでも、在籍者だけを部分保存せず、
//     全件拒否する（1件でも不正があれば、どの行も書き込まない既存の全件検証を維持している確認）
// ------------------------------------------------------------------
{
  var employees25 = [
    { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
    { id: 102, display_name: '退職者', entry_date: '2020-01-01', retire_date: '2026-08-01' }
  ]
  var env25 = loadProductionWithFakeGasApis_({ employees: employees25, nowMs: new Date(2026, 9, 1).getTime() })
  var request25 = {
    changes: [
      { employee_id: '101', badges: { 'ホール': true } }, // 在籍者
      { employee_id: '102', badges: { 'セット': true } } // 退職者
    ]
  }
  var result25 = env25.sandbox.saveMeisterBulkChanges(request25)
  assertEqual(result25.success, false, '25a. 在籍者・退職者混在のリクエストは全件拒否される（success:false）')
  assertEqual(env25.maisterWriteCounter.setValuesCount, 0, '25b. 在籍者（101）ぶんも含めて一切書き込まれない（部分保存にならない）')
}

// ------------------------------------------------------------------
// 26. saveMeisterBulkChanges: 表示後に退職した想定として、現在基準日では退職済みとなるIDを
//     保存拒否する（画面表示時点では在籍していたが、保存操作時点の基準日では退職済みのケース）
// ------------------------------------------------------------------
{
  var employees26 = [
    { id: 101, display_name: '在籍者', entry_date: '2020-01-01', retire_date: null },
    { id: 104, display_name: '直近退職者', entry_date: '2020-01-01', retire_date: '2026-09-30' } // 保存時の基準日（10/1）の前日に退職
  ]
  var env26 = loadProductionWithFakeGasApis_({ employees: employees26, nowMs: new Date(2026, 9, 1).getTime() }) // 基準日=2026-10-01
  var request26 = { changes: [{ employee_id: '104', badges: { '麺上げ': true } }] }
  var result26 = env26.sandbox.saveMeisterBulkChanges(request26)
  assertEqual(result26.success, false, '26a. 保存操作時点の基準日では退職済み（104、退職日翌日）のIDを含む変更は拒否される')
  assertEqual(env26.maisterWriteCounter.setValuesCount, 0, '26b. 書き込みは一切行われない')

  // 対比：退職日当日はまだ在籍扱いのため保存できる
  var employees26b = [{ id: 105, display_name: '退職日当日', entry_date: '2020-01-01', retire_date: '2026-10-01' }]
  var env26b = loadProductionWithFakeGasApis_({ employees: employees26b, nowMs: new Date(2026, 9, 1).getTime() })
  var result26b = env26b.sandbox.saveMeisterBulkChanges({ changes: [{ employee_id: '105', badges: { '麺上げ': true } }] })
  assertTrue(result26b.success, '26c. 退職日が基準日と同日（退職日当日）のIDはまだ在籍扱いのため保存できる')
}

// ------------------------------------------------------------------
// 27. isValidDateKey_: 通常日・うるう日・存在しない日・月0/13を検証する
// ------------------------------------------------------------------
{
  assertEqual(prodPure.isValidDateKey_('2026-02-28'), true, '27a. 通常の日付（2026-02-28）は有効')
  assertEqual(prodPure.isValidDateKey_('2028-02-29'), true, '27b. うるう年の2月29日（2028-02-29）は有効')
  assertEqual(prodPure.isValidDateKey_('2026-02-29'), false, '27c. 平年の2月29日（2026-02-29）は無効')
  assertEqual(prodPure.isValidDateKey_('2026-02-30'), false, '27d. 存在しない日（2026-02-30）は無効')
  assertEqual(prodPure.isValidDateKey_('2026-13-01'), false, '27e. 存在しない月（2026-13-01）は無効')
  assertEqual(prodPure.isValidDateKey_('2026-00-10'), false, '27f. 月0（2026-00-10）は無効')
  assertEqual(prodPure.isValidDateKey_('2026-04-31'), false, '27g. 4月31日（2026-04-31、30日までの月）は無効')
  assertEqual(prodPure.isValidDateKey_('2026-01-01'), true, '27h. 年始（2026-01-01）は有効')
  assertEqual(prodPure.isValidDateKey_('2026-12-31'), true, '27i. 年末（2026-12-31）は有効')
}

// ------------------------------------------------------------------
// 28. filterActiveEmployeesAsOf_: 存在しない暦日のentry_date/retire_dateを持つ従業員を除外する
// ------------------------------------------------------------------
{
  var empsInvalidCalendar28 = [
    { id: 601, display_name: 'entry_date不正暦日', entry_date: '2026-02-30', retire_date: null },
    { id: 602, display_name: 'retire_date不正暦日', entry_date: '2020-01-01', retire_date: '2026-02-30' },
    { id: 603, display_name: '正常', entry_date: '2020-01-01', retire_date: null }
  ]
  var active28 = prodPure.filterActiveEmployeesAsOf_(empsInvalidCalendar28, '2026-10-01')
  var activeIds28 = active28.map(function (e) { return e.id })
  assertTrue(activeIds28.indexOf(601) === -1, '28a. entry_dateが存在しない暦日（2026-02-30）の従業員は除外する')
  assertTrue(activeIds28.indexOf(602) === -1, '28b. retire_dateが存在しない暦日（2026-02-30）の従業員は除外する')
  assertTrue(activeIds28.indexOf(603) >= 0, '28c. 正常な日付の従業員は通常どおり在籍扱いになる')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のfreee人事労務APIのレスポンス形式・実データでの動作')
console.log('- UrlFetchApp.fetchAllの実際の並列実行・タイムアウト挙動')
console.log('- GAS実行時間制限内で候補者数×3リクエストが収まるか')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
