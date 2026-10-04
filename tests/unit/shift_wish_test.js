// 希望シフト機能（app/shift_wish.gs・app/shift.gsの希望関連分岐）を、本番の.gsファイルを
// Node.jsのvmで直接読み込んで検証する。ロジックをこのファイルへ再実装しない。
//
// postShiftWish・postShiftEntryFromWish・updateShiftWish・deleteShiftWish・deleteShiftEntry・
// updateShiftEntryはいずれもSpreadsheetApp・LockServiceに依存するため、本物のGoogleスプレッドシートを
// 使わずに検証するには、インメモリの最小限のフェイク実装が必要になる。
// フェイクは「2次元配列を保持し、getRange/getValues/setValues/setValue/deleteRow/getLastRowだけを
// 本物と同じ挙動で提供する」ことに徹し、本番の希望シフト判定・検証ロジック自体はテストコード側に
// 一切書かない（本番のpostShiftWish等をそのまま呼び出し、シートの中身の変化とレスポンスだけを見る）。
//
// 実行: node shift_wish_test.js
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
 *  Googleスプレッドシートのセルは、setValuesへ渡した値の型に応じてGAS側で自動的に型推論される
 *  （"YYYY-MM-DD"や日付オブジェクトはDate型のセルへ、"HH:MM"はGAS上では日付部分が
 *  1899-12-30の時刻セルへ、という具合）。本番コード（shift.gs等）はこの自動変換済みの値を
 *  Date型として読み戻す前提で書かれているため（row[1] instanceof Date等）、フェイクシート側でも
 *  同じ変換を最小限再現する。この変換ロジック自体は「セルへの書き込みが何型で読み戻るか」という
 *  スプレッドシートAPIのI/O層の話であり、シフト・希望シフトの判定・検証ロジックではないため、
 *  ここで再現しても「本番ロジックの再実装をしない」という方針には反しない
 */
// Node.jsのvmは、コンテキストごとに組み込みDateコンストラクタを別インスタンスとして持つ
// （メインコンテキストのnew Dateとsandbox内のnew Dateは別物で、instanceofが一致しない）。
// 本番コード（row[1] instanceof Date等）はsandbox内のDateを期待するため、フェイクシートが
// 型推論結果としてDateを生成する際は、必ずsandbox内のDateコンストラクタを使う必要がある。
// このためcreateFakeSheet_はsandboxDateコンストラクタを受け取る作りにする
function coerceCellValue_(value, SandboxDate) {
  if (value instanceof SandboxDate) return value
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    var dparts = value.split('-')
    return new SandboxDate(Number(dparts[0]), Number(dparts[1]) - 1, Number(dparts[2]))
  }
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    var tparts = value.split(':')
    // GAS上の時刻セルは日付部分が1899-12-30固定になるが、本番コードはrow[2]/row[3]の
    // 時・分だけをgetShiftDateTimeRange_へ渡すため、日付部分の具体値はどこにも影響しない
    return new SandboxDate(1899, 11, 30, Number(tparts[0]), Number(tparts[1]))
  }
  return value
}

/**
 *  シート1枚分のデータをインメモリの2次元配列で保持し、GASのRange APIのうち
 *  本番コードが実際に使うメソッド（getRange/getValues/setValues/setValue/deleteRow/getLastRow）
 *  だけを本物と同じ挙動で提供する。1行目はヘッダーとして予約し、データは2行目から入る前提
 *  （本番のシフト予定・希望シフトシートと同じ構造）。
 */
function createFakeSheet_(headerRow, SandboxDate) {
  var rows = [headerRow.slice()] // index 0 = header（1-indexed row 1）
  return {
    getLastRow: function () { return rows.length },
    // ヘッダー行（1行目）の列数をシートの列数として返す（getAllShiftWishRows_が
    // G〜I列の有無を確認するために呼ぶ。本物のSpreadsheetのgetLastColumn()と同じく、
    // データ行がヘッダーより長くても短くてもヘッダー行の列数を基準にする簡易実装）
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
    _rows: rows // テスト側から直接中身を確認するための抜け道（本番コードは使わない）
  }
}

/**
 *  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name) / insertSheet(name) を
 *  インメモリのFakeSheetマップで再現する。シフト予定シートは6列（F列=希望ID）、
 *  希望シフトシートはgetOrCreateShiftWishSheet_が初回にヘッダーごと作成する想定のため、
 *  ここでは空のシートとして用意する（ヘッダー行の中身は本番コードが書く）
 */
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

/**
 *  希望シフトシートの状態列（6列目）への書き込みだけを失敗させるラッパー。
 *  postShiftEntryFromWish・deleteShiftEntryが「勤務の書き込み／削除は成功したが、
 *  希望シートの状態列更新には失敗した」という途中失敗を再現するために使う。
 *  getRange自体はそのまま元のシートへ委譲し、setValue/setValuesの呼び出し先が
 *  状態列（col===6）を含む場合だけ例外を投げる（他の列・他のシートへは影響しない）
 */
function wrapSheetWithFailingStatusColumn_(sheet) {
  var originalGetRange = sheet.getRange
  sheet.getRange = function (row, col, numRows, numCols) {
    var range = originalGetRange.call(sheet, row, col, numRows, numCols)
    if (col <= 6 && col + (numCols || 1) - 1 >= 6) {
      var originalSetValue = range.setValue
      var originalSetValues = range.setValues
      range.setValue = function () {
        throw new Error('テスト用の意図的な失敗: 希望シフトの状態列更新に失敗しました')
      }
      range.setValues = function () {
        throw new Error('テスト用の意図的な失敗: 希望シフトの状態列更新に失敗しました')
      }
      // 参照だけ残しておく（本テストでは使わないが、元の挙動を完全に消さないため）
      range._originalSetValue = originalSetValue
      range._originalSetValues = originalSetValues
    }
    return range
  }
  return sheet
}

/**
 *  シートに対する「全件読み込み」（getRange(2, 1or6, N行, ...)のような、ヘッダーを除く全データ行を
 *  対象にした呼び出し）の回数を数えるラッパー。getShiftEntryWishIdSet_・
 *  getExistingShiftEntriesForEmployee_・getAllShiftRangesForJudge_・getShiftEntriesForBusinessDateなど、
 *  シフト予定シートを丸ごと読む本番関数の呼び出し回数を、行番号1・列に関係なく「開始行が2」の
 *  getRange呼び出しとして数える（本番コードのいずれの全件読み込みも2行目から始まるため）
 */
function wrapSheetWithReadCounter_(sheet) {
  var counter = { count: 0 }
  var originalGetRange = sheet.getRange
  sheet.getRange = function (row, col, numRows, numCols) {
    if (row === 2) counter.count++
    return originalGetRange.call(sheet, row, col, numRows, numCols)
  }
  return counter
}

/**
 *  本番の全.gsファイルを1つのVMコンテキストへ読み込み、SpreadsheetApp・LockService・Utilitiesだけを
 *  フェイクへ差し替える。差し替え後もSHEET_NAME_SHIFT（'シフト予定'）という本番の定数名をそのまま使う
 */
function loadProductionWithFakeGasApis_() {
  var gsFiles = fs.readdirSync(APP_DIR).filter(function (n) { return n.endsWith('.gs') }).sort()
  var sheets = {}
  var uuidCounter = 0

  var sandbox = {
    console: console,
    LockService: createFakeLockService_(),
    Utilities: { getUuid: function () { uuidCounter++; return 'wish-uuid-' + uuidCounter } }
  }
  vm.createContext(sandbox)
  // sandbox内の組み込みDateコンストラクタを取得してから、それを使うSpreadsheetApp（フェイク）を
  // sandboxへ後から差し込む（コンテキスト作成前にはsandbox内のDateを取得できないため）
  var SandboxDate = vm.runInContext('Date', sandbox)
  sandbox.SpreadsheetApp = createFakeSpreadsheetApp_(sheets, SandboxDate)

  for (var i = 0; i < gsFiles.length; i++) {
    var filePath = path.join(APP_DIR, gsFiles[i])
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath })
  }

  // シフト予定シートを6列（希望ID列を含む）ヘッダーで用意する
  sheets[sandbox.SHEET_NAME_SHIFT] = createFakeSheet_(['従業員ID', '日付', '開始', '終了', '曜日区分', '希望ID'], SandboxDate)

  return { sandbox: sandbox, sheets: sheets }
}

console.log('検証対象: shift_wish.gs, shift.gs（本番app内の全.gsファイルをフェイクGAS APIで実行）')
console.log('---')

// テスト対象の営業日は2026-09-21（月）祝日データ上「敬老の日」＝休日。judgeロジックとは無関係だが、
// getBusinessDayType呼び出しが必要な箇所（postShiftEntryFromWish内）で成功させるため対応年内の日付を使う
var BUSINESS_DATE = '2026-09-21'
var EMP_A = '1001'
var EMP_B = '1002'

// ------------------------------------------------------------------
// 1. 希望だけでは判定人数に加算されない
//    （getAllShiftRangesForJudge_はシフト予定シートだけを見る。希望シフトシートに1件登録しても
//    シフト予定シートは空のままなので、判定対象の配列が空であることを確認する）
// ------------------------------------------------------------------
{
  var env1 = loadProductionWithFakeGasApis_()
  var wishResult1 = env1.sandbox.postShiftWish({
    employee_id: EMP_A,
    business_date: BUSINESS_DATE,
    start_time: '11:00',
    end_time: '19:00'
  })
  assertTrue(wishResult1.success, '1. 希望シフトの登録が成功する')
  var judgeRanges1 = env1.sandbox.getAllShiftRangesForJudge_()
  assertEqual(judgeRanges1, [], '1. 希望だけでは判定対象（getAllShiftRangesForJudge_）に含まれない')
}

// ------------------------------------------------------------------
// 2. 希望範囲内の勤務を登録できる（例: 希望11〜19時に対して勤務12〜17時）
// ------------------------------------------------------------------
{
  var env2 = loadProductionWithFakeGasApis_()
  var wish2 = env2.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  var message2 = env2.sandbox.postShiftEntryFromWish({
    wish_id: wish2.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertContains(message2, '登録しました', '2. 希望範囲内（12-17時）の勤務登録が成功する')
  var judgeRanges2 = env2.sandbox.getAllShiftRangesForJudge_()
  assertEqual(judgeRanges2.length, 1, '2. 勤務登録後、判定対象に1件だけ追加される')
}

// ------------------------------------------------------------------
// 3. 範囲外・重複・最低時間未満をサーバー側で拒否する
// ------------------------------------------------------------------
{
  var env3 = loadProductionWithFakeGasApis_()
  var wish3 = env3.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })

  // 3a. 範囲外（希望11-19時に対して勤務10-15時は開始が範囲外）
  var outOfRange = env3.sandbox.postShiftEntryFromWish({
    wish_id: wish3.wish_id, employee_id: EMP_A, start_time: '10:00', end_time: '15:00'
  })
  assertContains(outOfRange, '希望の範囲内', '3a. 希望の範囲外の勤務登録は拒否される')

  // 3b. 最低時間未満（12-14時は2時間）
  var tooShort = env3.sandbox.postShiftEntryFromWish({
    wish_id: wish3.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '14:00'
  })
  assertContains(tooShort, '3時間以上', '3b. 希望範囲内でも最低3時間未満は拒否される')

  // 3c. 重複（既存の直接シフトと重なる時間へ希望から登録しようとする）
  env3.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '13:00', end_time: '16:00'
  })
  var overlapping = env3.sandbox.postShiftEntryFromWish({
    wish_id: wish3.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '15:00'
  })
  assertContains(overlapping, '重複', '3c. 既存の勤務と重複する時間への希望からの登録は拒否される')
}

// ------------------------------------------------------------------
// 4. 翌日終了や翌日開始の希望でも範囲を正しく判定する
// ------------------------------------------------------------------
{
  var env4 = loadProductionWithFakeGasApis_()
  // 22:00〜翌2:00（4時間、日跨ぎ）の希望
  var wish4 = env4.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '22:00', end_time: '02:00'
  })
  assertTrue(wish4.success, '4. 日跨ぎ（22:00〜翌2:00）の希望シフト登録が成功する')

  // 希望範囲内（23:00〜翌2:00、3時間）の勤務は登録できる
  var withinNextDay = env4.sandbox.postShiftEntryFromWish({
    wish_id: wish4.wish_id, employee_id: EMP_A, start_time: '23:00', end_time: '02:00'
  })
  assertContains(withinNextDay, '登録しました', '4. 日跨ぎ希望の範囲内（23:00〜翌2:00）の勤務登録が成功する')

  // 別ケース: 希望範囲外（翌2:00より後の終了）は拒否される
  var env4b = loadProductionWithFakeGasApis_()
  var wish4b = env4b.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '22:00', end_time: '02:00'
  })
  var beyondEnd = env4b.sandbox.postShiftEntryFromWish({
    wish_id: wish4b.wish_id, employee_id: EMP_A, start_time: '22:00', end_time: '03:00'
  })
  assertContains(beyondEnd, '希望の範囲内', '4. 日跨ぎ希望の終了時刻（翌2:00）を超える勤務登録は拒否される')
}

// ------------------------------------------------------------------
// 5. 同じ希望からの二重登録を拒否する（1つの希望から1本の勤務だけを登録する）
// ------------------------------------------------------------------
{
  var env5 = loadProductionWithFakeGasApis_()
  var wish5 = env5.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  var first5 = env5.sandbox.postShiftEntryFromWish({
    wish_id: wish5.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertContains(first5, '登録しました', '5. 1回目の勤務登録は成功する')
  var second5 = env5.sandbox.postShiftEntryFromWish({
    wish_id: wish5.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertContains(second5, '登録済み', '5. 同じ希望からの2回目の勤務登録は拒否される（二重登録防止）')
  var judgeRanges5 = env5.sandbox.getAllShiftRangesForJudge_()
  assertEqual(judgeRanges5.length, 1, '5. 二重登録を試みても判定対象は1件のままになる')
}

// ------------------------------------------------------------------
// 6. 勤務登録後は関連する希望だけが非表示になる
//    （getShiftWishesForBusinessDateは未登録の希望だけを返す。別の希望は引き続き表示される）
// ------------------------------------------------------------------
{
  var env6 = loadProductionWithFakeGasApis_()
  var wishX = env6.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  var wishY = env6.sandbox.postShiftWish({
    employee_id: EMP_B, business_date: BUSINESS_DATE, start_time: '17:00', end_time: '21:00'
  })
  var beforeList = env6.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(beforeList.length, 2, '6. 勤務登録前は希望が2件とも表示される')

  env6.sandbox.postShiftEntryFromWish({
    wish_id: wishX.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  var afterList = env6.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterList.length, 1, '6. 勤務登録後、関連する希望だけが表示から消える（残り1件）')
  assertEqual(afterList[0].wish_id, wishY.wish_id, '6. 表示に残るのは勤務登録していない方の希望である')
}

// ------------------------------------------------------------------
// 7. 勤務削除後は希望が再表示される
// ------------------------------------------------------------------
{
  var env7 = loadProductionWithFakeGasApis_()
  var wish7 = env7.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  env7.sandbox.postShiftEntryFromWish({
    wish_id: wish7.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertEqual(env7.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE).length, 0, '7. 勤務登録直後は希望が非表示')

  var entries7 = env7.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(entries7.length, 1, '7. 前提: 勤務が1件登録されている')
  var deleteResult7 = env7.sandbox.deleteShiftEntry({
    source_row: entries7[0].source_row,
    employee_id: entries7[0].employee_id,
    start_ms: entries7[0].start_ms,
    end_ms: entries7[0].end_ms
  })
  assertTrue(deleteResult7.success, '7. 勤務削除が成功する')
  var afterDeleteWishes7 = env7.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDeleteWishes7.length, 1, '7. 勤務削除後、関連する希望が再表示される')
  assertEqual(afterDeleteWishes7[0].wish_id, wish7.wish_id, '7. 再表示された希望は削除した勤務の元の希望と一致する')
}

// ------------------------------------------------------------------
// 8. 勤務変更は元の希望範囲内に限定される
// ------------------------------------------------------------------
{
  var env8 = loadProductionWithFakeGasApis_()
  var wish8 = env8.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  env8.sandbox.postShiftEntryFromWish({
    wish_id: wish8.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  var entries8 = env8.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var target8 = entries8[0]

  // 8a. 希望範囲内への変更は成功する（12-17時 → 13-18時、いずれも希望11-19時の範囲内）
  var okUpdate = env8.sandbox.updateShiftEntry({
    source_row: target8.source_row, employee_id: target8.employee_id,
    start_ms: target8.start_ms, end_ms: target8.end_ms,
    business_date: BUSINESS_DATE, start_time: '13:00', end_time: '18:00'
  })
  assertTrue(okUpdate.success, '8a. 元の希望範囲内（13-18時）への変更は成功する')

  // 8b. 希望範囲外への変更は拒否される（20時は希望終了19時を超える）
  var entries8b = env8.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var target8b = entries8b[0]
  var badUpdate = env8.sandbox.updateShiftEntry({
    source_row: target8b.source_row, employee_id: target8b.employee_id,
    start_ms: target8b.start_ms, end_ms: target8b.end_ms,
    business_date: BUSINESS_DATE, start_time: '13:00', end_time: '20:00'
  })
  assertEqual(badUpdate.success, false, '8b. 元の希望範囲外（〜20時）への変更は拒否される')
  assertContains(badUpdate.message, '希望範囲内', '8b. 拒否理由に希望範囲内という説明が含まれる')
}

// ------------------------------------------------------------------
// 9. 希望IDのない既存勤務を引き続き操作できる（変更・削除とも希望なし従来仕様のまま）
// ------------------------------------------------------------------
{
  var env9 = loadProductionWithFakeGasApis_()
  env9.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '15:00'
  })
  var entries9 = env9.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(entries9[0].wish_id, '', '9. 希望なしで直接登録した勤務はwish_idが空文字になる')

  var update9 = env9.sandbox.updateShiftEntry({
    source_row: entries9[0].source_row, employee_id: entries9[0].employee_id,
    start_ms: entries9[0].start_ms, end_ms: entries9[0].end_ms,
    business_date: BUSINESS_DATE, start_time: '11:00', end_time: '16:00'
  })
  assertTrue(update9.success, '9. 希望IDのない従来勤務の変更が従来どおり成功する（範囲制限を受けない）')

  var entries9b = env9.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var del9 = env9.sandbox.deleteShiftEntry({
    source_row: entries9b[0].source_row, employee_id: entries9b[0].employee_id,
    start_ms: entries9b[0].start_ms, end_ms: entries9b[0].end_ms
  })
  assertTrue(del9.success, '9. 希望IDのない従来勤務の削除が従来どおり成功する')
}

// ------------------------------------------------------------------
// 10. 隣接勤務との結合で希望の関連付けが壊れない
//     （希望に関連付いた勤務は結合候補から除外される。希望IDを持たない従来勤務同士の結合は維持する）
// ------------------------------------------------------------------
{
  var env10 = loadProductionWithFakeGasApis_()
  var wish10 = env10.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  // 希望から11-15時を登録する
  env10.sandbox.postShiftEntryFromWish({
    wish_id: wish10.wish_id, employee_id: EMP_A, start_time: '11:00', end_time: '15:00'
  })
  // 直接、隣接する15-19時を同じ従業員で登録する（希望に紐づく11-15時行と隣接するが、結合されないはず）
  var directAdjacent = env10.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '15:00', end_time: '19:00'
  })
  assertContains(directAdjacent, '登録しました', '10. 希望付き勤務に隣接する直接登録が成功する')

  var entries10 = env10.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(entries10.length, 2, '10. 希望付き勤務は結合候補から除外され、2行のまま別々に残る')
  var wishRow10 = entries10.filter(function (e) { return e.wish_id === wish10.wish_id })
  assertEqual(wishRow10.length, 1, '10. 希望に関連付いた行は引き続き1本のまま、希望IDを保持している')

  // 希望IDを持たない従来勤務同士（15-19時 と 19-21時）の結合は維持されることを確認する
  var directAdjacent2 = env10.sandbox.postShiftEntry({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '19:00', end_time: '21:00'
  })
  assertContains(directAdjacent2, 'つなげて', '10. 希望なし従来勤務同士（15-19時・19-21時）は従来どおり隣接結合される')
  var entries10b = env10.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  assertEqual(entries10b.length, 2, '10. 結合後も合計2行（希望付き1行＋結合済み従来勤務1行）のまま')
}

// ------------------------------------------------------------------
// 11. 保存失敗時に入力や表示が不正な状態にならない
//     （サーバー側は失敗時にエラーメッセージを返すだけで、シートへは書き込まない
//     ＝失敗した操作の前後でシートの行数・内容が変化しないことを確認する）
// ------------------------------------------------------------------
{
  var env11 = loadProductionWithFakeGasApis_()
  var wish11 = env11.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  var beforeWishRows = env11.sheets['希望シフト']._rows.length
  var beforeShiftRows = (env11.sheets[env11.sandbox.SHEET_NAME_SHIFT] || { _rows: [] })._rows
    ? env11.sheets[env11.sandbox.SHEET_NAME_SHIFT]._rows.length : 1

  var failedRegister = env11.sandbox.postShiftEntryFromWish({
    wish_id: wish11.wish_id, employee_id: EMP_A, start_time: '09:00', end_time: '11:00'
  })
  assertContains(failedRegister, '範囲', '11. 範囲外の勤務登録は失敗メッセージを返す')
  var afterWishRows = env11.sheets['希望シフト']._rows.length
  var afterShiftRows = env11.sheets[env11.sandbox.SHEET_NAME_SHIFT]._rows.length
  assertEqual(afterWishRows, beforeWishRows, '11. 失敗した勤務登録の前後で希望シフトシートの行数が変化しない')
  assertEqual(afterShiftRows, beforeShiftRows, '11. 失敗した勤務登録の前後でシフト予定シートの行数が変化しない（誤った書き込みがない）')
  var wishAfterFail = env11.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(wishAfterFail.length, 1, '11. 失敗後も希望シフトは引き続き表示され、消えたり壊れたりしない')
}

// ------------------------------------------------------------------
// 12. 勤務保存後の状態更新で例外を発生させても、同じ希望IDの勤務が2本できない
//     （レビュー対応：postShiftEntryFromWishは勤務の書き込みを確定させた後、希望シートの
//     状態列更新を試みる。この更新が例外で失敗しても、勤務登録自体は成功として扱い、
//     状態列は古い「未登録」のまま残る。次にこの希望へ再度登録しようとしても、
//     「登録済みかどうか」の判定はシフト予定シート側の実在確認で行われるため拒否されることを確認する）
// ------------------------------------------------------------------
{
  var env12 = loadProductionWithFakeGasApis_()
  var wish12 = env12.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  // 希望シフトシートは初回のpostShiftWishで既に自動作成されているため、ここで状態列書き込みを
  // 失敗させるラッパーを被せる（勤務の書き込み自体は別シート＝シフト予定シートなので影響しない）
  wrapSheetWithFailingStatusColumn_(env12.sheets['希望シフト'])

  var firstAttempt = env12.sandbox.postShiftEntryFromWish({
    wish_id: wish12.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertContains(firstAttempt, '登録しました', '12. 状態列更新が失敗しても、勤務登録自体は成功として扱われる')

  var wishAfterFailure = env12.sandbox.findShiftWishById_(wish12.wish_id)
  assertEqual(wishAfterFailure.status, env12.sandbox.SHIFT_WISH_STATUS_OPEN_, '12. 状態列は更新に失敗したため古い「未登録」のまま残っている（前提確認）')

  // 状態列が古い「未登録」のままでも、別の時間で同じ希望から再登録しようとすると拒否される
  var secondAttempt = env12.sandbox.postShiftEntryFromWish({
    wish_id: wish12.wish_id, employee_id: EMP_A, start_time: '17:00', end_time: '19:00'
  })
  assertContains(secondAttempt, '登録済み', '12. 状態列が古いままでも、同じ希望IDの勤務が既に実在するため2本目の登録は拒否される')

  var judgeRanges12 = env12.sandbox.getAllShiftRangesForJudge_()
  assertEqual(judgeRanges12.length, 1, '12. 再試行しても、判定対象の勤務は1件のままになる（2本登録されていない）')

  // 状態列が更新できない状態のままでも、時間軸からは正しく「登録済み」として希望が隠れる
  // （getShiftWishesForBusinessDateもシフト予定シート側の実在確認を使うため）
  var wishesOnTimeline12 = env12.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(wishesOnTimeline12.length, 0, '12. 状態列が古いままでも、勤務が実在する希望は時間軸に表示されない')
}

// ------------------------------------------------------------------
// 13. 勤務削除後の状態更新で例外を発生させても、再取得すると希望が再表示される
//     （レビュー対応：deleteShiftEntryは勤務行の削除を確定させた後、希望シートの状態列を
//     「未登録」へ戻そうとする。この更新が例外で失敗しても削除自体は成功として扱い、
//     希望の再表示はシフト予定シート側の実在確認（勤務行が既に消えている）で行われることを確認する）
// ------------------------------------------------------------------
{
  var env13 = loadProductionWithFakeGasApis_()
  var wish13 = env13.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '19:00'
  })
  env13.sandbox.postShiftEntryFromWish({
    wish_id: wish13.wish_id, employee_id: EMP_A, start_time: '12:00', end_time: '17:00'
  })
  assertEqual(env13.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE).length, 0, '13. 前提: 勤務登録直後は希望が非表示')

  // ここから希望シートの状態列書き込みを失敗させる
  wrapSheetWithFailingStatusColumn_(env13.sheets['希望シフト'])

  var entries13 = env13.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var deleteResult13 = env13.sandbox.deleteShiftEntry({
    source_row: entries13[0].source_row, employee_id: entries13[0].employee_id,
    start_ms: entries13[0].start_ms, end_ms: entries13[0].end_ms
  })
  assertTrue(deleteResult13.success, '13. 状態列更新が失敗しても、勤務削除自体は成功として扱われる')

  var wishAfterDeleteFailure = env13.sandbox.findShiftWishById_(wish13.wish_id)
  assertEqual(wishAfterDeleteFailure.status, env13.sandbox.SHIFT_WISH_STATUS_FULFILLED_, '13. 状態列は更新に失敗したため古い「登録済み」のまま残っている（前提確認）')

  var wishesAfterDelete13 = env13.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(wishesAfterDelete13.length, 1, '13. 状態列が古い「登録済み」のままでも、勤務が実在しないため希望は再表示される')
  assertEqual(wishesAfterDelete13[0].wish_id, wish13.wish_id, '13. 再表示された希望は削除した勤務の元の希望と一致する')

  // 状態列が古いままでも、この希望から再び勤務を登録できる（実在確認ベースなので操作不能にならない）
  var reregister13 = env13.sandbox.postShiftEntryFromWish({
    wish_id: wish13.wish_id, employee_id: EMP_A, start_time: '13:00', end_time: '18:00'
  })
  assertContains(reregister13, '登録しました', '13. 状態列が古いままでも、再表示された希望から改めて勤務登録できる（操作不能にならない）')
}

// ------------------------------------------------------------------
// 14. 希望の重複チェックを追加・修正で統一する（updateShiftWishが登録済みの希望とも重複判定する）
//     再現例: 希望A(11-17時)から勤務11-14時を登録済み。希望B(17-21時)を14-21時へ変更しようとすると、
//     Aは登録済みだが時間帯としては11-17時に実在するため、14-17時の重なりを拒否する
// ------------------------------------------------------------------
{
  var env14 = loadProductionWithFakeGasApis_()
  var wishA14 = env14.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '17:00'
  })
  env14.sandbox.postShiftEntryFromWish({
    wish_id: wishA14.wish_id, employee_id: EMP_A, start_time: '11:00', end_time: '14:00'
  })
  var wishB14 = env14.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '17:00', end_time: '21:00'
  })

  var conflictingUpdate = env14.sandbox.updateShiftWish({
    wish_id: wishB14.wish_id, start_time: '14:00', end_time: '21:00'
  })
  assertEqual(conflictingUpdate.success, false, '14. 登録済みの希望Aと重なる希望Bの変更（14-21時）は拒否される')
  assertContains(conflictingUpdate.message, '重複', '14. 拒否理由に重複という説明が含まれる')

  // 重ならない範囲（17-20時、希望Aの11-17時と重ならない）への変更は成功する
  var nonConflictingUpdate = env14.sandbox.updateShiftWish({
    wish_id: wishB14.wish_id, start_time: '17:00', end_time: '20:00'
  })
  assertTrue(nonConflictingUpdate.success, '14. 登録済みの希望Aと重ならない変更（17-20時）は成功する')

  // 自分自身（希望Bそのもの）を除外できていることの確認：変更前と同じ範囲への「変更」も
  // 自分自身との重複として拒否されてはならない
  var env14b = loadProductionWithFakeGasApis_()
  var wishC14 = env14b.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '17:00', end_time: '21:00'
  })
  var selfUpdate = env14b.sandbox.updateShiftWish({
    wish_id: wishC14.wish_id, start_time: '17:00', end_time: '20:00'
  })
  assertTrue(selfUpdate.success, '14. 自分自身の希望IDは重複確認から除外され、範囲を狭める変更は成功する')
}

// ------------------------------------------------------------------
// 15. getShiftWishesForBusinessDateが、希望件数によらずシフト予定シートの全件読み込みを
//     1回の呼び出しにつき最大1回に抑える（レビュー対応：希望ごとにfindShiftEntryByWishId_を
//     呼ぶとシフト予定シート全体をN回読むことになっていた問題の修正確認）
// ------------------------------------------------------------------
{
  var env15 = loadProductionWithFakeGasApis_()
  // 対象営業日と重なる希望を5件、重ならない希望（別営業日）を3件登録する
  // （対象日と重ならない希望はシフト予定シートの照合対象にすらしないため、絞り込みの効果も確認できる）
  var otherDate = '2026-09-22'
  // 同じ従業員の希望は重複できないため、3時間ずつ隙間なく並べて登録する。営業時間は11:00〜翌3:00
  // なので、EMP_Aは5件（11-14,14-17,17-20,20-23,23-翌2）、EMP_Bは3件（11-14,14-17,17-20、別営業日）にする
  var empAWishSlots = [['11:00', '14:00'], ['14:00', '17:00'], ['17:00', '20:00'], ['20:00', '23:00'], ['23:00', '02:00']]
  for (var w = 0; w < empAWishSlots.length; w++) {
    env15.sandbox.postShiftWish({
      employee_id: EMP_A, business_date: BUSINESS_DATE,
      start_time: empAWishSlots[w][0], end_time: empAWishSlots[w][1]
    })
  }
  var empBWishSlots = [['11:00', '14:00'], ['14:00', '17:00'], ['17:00', '20:00']]
  for (var w2 = 0; w2 < empBWishSlots.length; w2++) {
    env15.sandbox.postShiftWish({
      employee_id: EMP_B, business_date: otherDate,
      start_time: empBWishSlots[w2][0], end_time: empBWishSlots[w2][1]
    })
  }
  // シフト予定シートに最低1件は勤務が実在する状態にする（getShiftEntryWishIdSet_はシートが
  // 空＝getLastRow()<2の場合にgetRangeを呼ばず早期returnするため、読み込み回数の検証には
  // 意味を持たない。実データがある状態でこそ「1回に抑えられているか」を確認できる）
  env15.sandbox.postShiftEntry({
    employee_id: EMP_B, business_date: otherDate, start_time: '20:00', end_time: '23:00'
  })

  var shiftSheet15 = env15.sheets[env15.sandbox.SHEET_NAME_SHIFT]
  var readCounter15 = wrapSheetWithReadCounter_(shiftSheet15)

  var wishesOnDate15 = env15.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(wishesOnDate15.length, 5, '15. 対象営業日と重なる希望5件が返る（別営業日の3件は対象外）')
  assertEqual(readCounter15.count, 1, '15. 希望が5件あっても、シフト予定シートの全件読み込みは1回の呼び出しにつき最大1回になる')

  // 対象営業日と重なる希望が0件の場合は、シフト予定シートの読み込み自体を省略する
  var readCounter15b = wrapSheetWithReadCounter_(shiftSheet15)
  var wishesOnEmptyDate15 = env15.sandbox.getShiftWishesForBusinessDate('2026-09-25')
  assertEqual(wishesOnEmptyDate15.length, 0, '15. 対象営業日と重なる希望が0件のケース')
  assertEqual(readCounter15b.count, 0, '15. 対象の希望が0件のときはシフト予定シートの読み込み自体を省略する')
}

// ------------------------------------------------------------------
// 16. 読み込み回数最適化後も、同一従業員・同一営業日の希望の非表示・勤務削除後の再表示が
//     維持される（店主希望導線整理 2026-09-24：同じ従業員が対象営業日に勤務を1件でも持てば、
//     その従業員のその営業日の希望はすべて隠す。希望Qの時間だけを部分的に隠すのではない。
//     別従業員の希望Rは影響を受けないことも併せて確認する）
// ------------------------------------------------------------------
{
  var env16 = loadProductionWithFakeGasApis_()
  var wishP16 = env16.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '11:00', end_time: '14:00'
  })
  var wishQ16 = env16.sandbox.postShiftWish({
    employee_id: EMP_A, business_date: BUSINESS_DATE, start_time: '14:00', end_time: '17:00'
  })
  var wishR16 = env16.sandbox.postShiftWish({
    employee_id: EMP_B, business_date: BUSINESS_DATE, start_time: '17:00', end_time: '20:00'
  })

  env16.sandbox.postShiftEntryFromWish({
    wish_id: wishQ16.wish_id, employee_id: EMP_A, start_time: '14:00', end_time: '17:00'
  })
  var afterRegister16 = env16.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterRegister16.length, 1, '16. EMP_Aが勤務を持つと、Aの希望P・Qが両方とも表示から消える')
  var remainingIds16 = afterRegister16.map(function (w) { return w.wish_id }).sort()
  assertEqual(remainingIds16, [wishR16.wish_id], '16. 表示に残るのは別従業員の希望Rのみ')

  var entries16 = env16.sandbox.getShiftEntriesForBusinessDate(BUSINESS_DATE)
  var target16 = entries16.filter(function (e) { return e.wish_id === wishQ16.wish_id })[0]
  env16.sandbox.deleteShiftEntry({
    source_row: target16.source_row, employee_id: target16.employee_id,
    start_ms: target16.start_ms, end_ms: target16.end_ms
  })
  var afterDelete16 = env16.sandbox.getShiftWishesForBusinessDate(BUSINESS_DATE)
  assertEqual(afterDelete16.length, 3, '16. 勤務削除後、EMP_Aの希望P・Qが再表示され3件に戻る')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のGoogleスプレッドシート上での希望シフトシートの自動作成・列幅・見た目')
console.log('- 希望シフトを追加・希望バー・登録済みバーのモーダル操作、時間軸の実際の描画・配色・折り返し')
console.log('- 二重クリック・並行操作が実際のGAS実行環境（LockService）で正しく直列化されること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
