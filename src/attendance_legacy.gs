var COL_NUM_EMPID = 1
var COL_NUM_MEMO = 2

/**
 * 勤怠情報の取得
 * 今月における今日までの勤怠情報が取得される
 */
function getTimeClocks() {
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  var requestUrl = 'https://api.freee.co.jp/hr/api/v1/employees/'
    + selectedEmpId.toString()
    + '/time_clocks?company_id=' + companyId.toString()
  var response = UrlFetchApp.fetch(requestUrl, getRequestOptions())
  var responseJson = JSON.parse(response.getContentText())
  if (response.getResponseCode() != 200) {
    console.error(responseJson.message)
    return responseJson.message
  }

  // 画面表示用にデータを加工する
  var formatedRecords = []
  for (var i = 0; i <= responseJson.length - 1; i++) {
    // [i]番目の勤怠情報
    var timeClock = responseJson[i]
    // 打刻種別を取り出す
    var type = timeClock['type']
    // 打刻時刻を取り出す
    var datetime = timeClock['datetime']
    // 打刻時刻をDateオブジェクトに変換
    var dateObj = new Date(datetime)
    // 見やすい日時にフォーマット
    var dateStr = dateObj.getFullYear() + '年'
      + (dateObj.getMonth() + 1) + '月'
      + dateObj.getDate() + '日 '
      + dateObj.getHours() + '時'
      + dateObj.getMinutes() + '分'

    // 打刻種別をわかりやすい単語に変換
    var typeName = ''
    switch (type) {
      case 'clock_in':
        typeName = '出勤'
        break
      case 'break_begin':
        typeName = '休憩開始'
        break
      case 'break_end':
        typeName = '休憩終了'
        break
      case 'clock_out':
        typeName = '退勤'
        break;
    }
    // formatedRecordsの配列に追加する
    formatedRecords.push({
      'date': dateStr,
      'type': typeName
    })
  }
  return formatedRecords
}

/**
 * 勤怠情報登録
 */
function postWorkRecord(form) {
  // ※デバッグするには以下の変数を直接書き換える必要があります
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  // inputタグのnameで取得
  var targetDate = form.target_date
  var targetTime = form.target_time
  var targetType = form.target_type

  var requestPayload = {
      'company_id': companyId,
      'type': targetType,
      'date': 'string',
      'datetime': targetDate + ' ' + targetTime
  }
  var requestUrl = 'https://api.freee.co.jp/hr/api/v1/employees/'
    + selectedEmpId.toString()
    + '/time_clocks'
  var requestOptions = getRequestOptions('post', JSON.stringify(requestPayload))
  var response = UrlFetchApp.fetch(requestUrl, requestOptions)
  var responseJson = JSON.parse(response.getContentText())
  var responseCode = response.getResponseCode()
  if (responseCode != 201) {
    console.error(responseJson)
    return responseJson.message
  }
  return '登録しました'
}

/**
 * spreadSheetに保存されている指定のemployee_idの行番号を返す
 */
function getTargetEmpRowNumber(empId) {
  // 開いているシートを取得
  var sheet = SpreadsheetApp.getActiveSheet()
  // 最終行取得
  var last_row = sheet.getLastRow()
  // 2行目から最終行までの1列目(emp_id)の範囲を取得
  var data_range = sheet.getRange(1, COL_NUM_EMPID, last_row, COL_NUM_EMPID);
  // 該当範囲のデータを取得
  var sheetRows = data_range.getValues();
  // ループ内で検索
  for (var i = 0; i <= sheetRows.length - 1; i++) {
    var row = sheetRows[i]
    if (row[0] == empId) {
      // spread sheetの行番号は1から始まるが配列のindexは0から始まるため + 1して行番号を返す
      return i + 1;
    }
  }
  // 見つからない場合にはnullを返す
  return null
}

/**
 * 選択している従業員のメモカラムの値をspread sheetから取得する
 */
function getEmpMemo() {
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId') // ※デバッグするにはこの変数を直接書き換える必要があります
  var checkSheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
  var last_row = checkSheet.getLastRow()
  var timeClocksRange = checkSheet.getRange(2, 1, last_row, 2);// シートの中のヘッダーを除く範囲を取得
  var checkResult = "";
  var i = 1;
  while (true) {
    var empId =timeClocksRange.getCell(i, 1).getValue();
    var result =timeClocksRange.getCell(i, 2).getValue();
    if (empId === ""){ //　値を取得できなくなったら終了
      break;
    }
    if (empId == selectedEmpId){
        checkResult = result
        break;
    }
    i++
  }

  return checkResult
}

/**
 * メモの内容をSpreadSheetに保存する
 */
function postMemo(form) {
  // ※デバッグするには以下の変数を直接書き換える必要があります
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  // inputタグのnameで取得
  var memo = form.memo

  var targetRowNumber = getTargetEmpRowNumber(selectedEmpId)
  var sheet = SpreadsheetApp.getActiveSheet()
  if (targetRowNumber == null) {
    // targetRowNumberがない場合には新規に行を追加する
    // 現在の最終行に+1した行番号
    targetRowNumber = sheet.getLastRow() + 1
    // 1列目にempIdをセットして保存
    sheet.getRange(targetRowNumber, COL_NUM_EMPID).setValue(selectedEmpId)
  }
  // memoの内容を保存
  var values = sheet.getRange(targetRowNumber, COL_NUM_MEMO).setValue(memo)

}

/**
 * 選択中の従業員のシフト予定一覧を返す（画面表示用、登録順）
 * シートの日付・時刻セルはGASに渡るとDateオブジェクトになるため、
 * タイムレコーダー履歴（getTimeClocks）と同じ考え方で手動整形する
 * 終了時刻が日をまたぐ場合は「翌」を付けて表示し、日跨ぎ判定が正しく効いているか目視確認できるようにする
 */
function getShiftEntries() {
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var values = sheet.getRange(2, 1, last_row - 1, 5).getValues()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (String(row[0]) != String(selectedEmpId)) continue
    // 日付・開始・終了のいずれかが空欄（Dateオブジェクトでない）行は、
    // 整形処理が壊れるので画面全体を落とさずスキップする
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue

    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    var endLabel = formatTimeJp_(row[3])
    if (range.end.getDate() != range.start.getDate()) {
      endLabel = '翌' + endLabel
    }

    list.push({
      date: formatDateJp_(row[1]),
      start_time: formatTimeJp_(row[2]),
      end_time: endLabel,
      day_type: row[4]
    })
  }
  return list
}

/**
 * 店主画面用：全従業員の登録済みシフト予定を返す
 * 実際の開始日時が早い順、同じ開始日時なら終了日時が早い順に並べる（表示用データのみのソート。シート自体の行順は変更しない）
 * 深夜勤務は入力した日付を開始日として扱う（getShiftDateTimeRange_と同じルール）
 */
function getAllShiftEntries() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var values = sheet.getRange(2, 1, last_row - 1, 5).getValues()
  var nameMap = getEmployeeNameMap_()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    // 日付・開始・終了のいずれかが空欄（Dateオブジェクトでない）行は画面全体を落とさずスキップする
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue

    var empId = String(row[0])
    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    var endLabel = formatTimeJp_(row[3])
    if (range.end.getDate() != range.start.getDate()) {
      endLabel = '翌' + endLabel
    }

    list.push({
      employee_id: empId,
      employee_name: nameMap[empId] || ('ID:' + empId),
      date: formatDateJp_(row[1]),
      start_time: formatTimeJp_(row[2]),
      end_time: endLabel,
      day_type: row[4],
      sort_start_ms: range.start.getTime(),
      sort_end_ms: range.end.getTime()
    })
  }
  list.sort(function (a, b) {
    if (a.sort_start_ms != b.sort_start_ms) return a.sort_start_ms - b.sort_start_ms
    return a.sort_end_ms - b.sort_end_ms
  })
  return list
}
