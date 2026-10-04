/**
 * 機能2: シフトの1時間枠別・事前判定（今日は入力部分のみ）
 */
var SHEET_NAME_SHIFT = 'シフト予定'

var SHIFT_MIN_DURATION_MS = 3 * 60 * 60 * 1000 // 実店舗のシフトは最低3時間で構成される

/**
 * 指定した従業員の既存シフト行を、営業日に関係なくシート行番号と実開始・終了ms付きで全件返す
 * 厳密な重複確認（営業日をまたいでも実時間が重なれば拒否）と、隣接結合候補の絞り込み
 * （選択営業日と重なる行だけに限定）の両方でこの全件データを使う。営業日での絞り込みは
 * planShiftMerge_側で行い、ここでは行わない（同じ従業員の行を1回のシート走査で両用途に使うため）
 * excludeSourceRow（シート行番号）を指定すると、その行自身を除外する
 * （シフト更新時、更新対象の行を自分自身の既存行として扱わないため。新規登録では未指定のまま呼ぶ）
 */
function getExistingShiftEntriesForEmployee_(sheet, empId, excludeSourceRow) {
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var values = sheet.getRange(2, 1, last_row - 1, 6).getValues()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var currentSheetRow = i + 2
    if (excludeSourceRow && currentSheetRow === excludeSourceRow) continue
    var row = values[i]
    if (String(row[0]) != String(empId)) continue
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue
    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    list.push({
      sheetRow: currentSheetRow,
      startMs: range.start.getTime(),
      endMs: range.end.getTime(),
      wishId: row[5] ? String(row[5]) : ''
    })
  }
  return list
}

/**
 * 新しい範囲と、同じ従業員の全既存範囲群（シートI/Oと分離）から、重複か結合計画かを判定する純粋関数
 * allExistingEntriesは営業日に関係ない同じ従業員の全シフト。businessStartMs/businessEndMsは
 * 選択中の営業日範囲（隣接結合の対象を絞るためだけに使い、重複確認には使わない）
 *
 * 厳密な重複確認と隣接結合の対象を分離している。
 * 1. 厳密な重複確認（newStart < existingEnd && existingStart < newEnd）は、
 *    営業日に関係なくallExistingEntries全体に対して行う（終了時刻と次の開始時刻が同じだけの
 *    ケースは重ならない扱いになる＝隣接であって重複ではない）。
 * 2. 隣接結合の候補は、allExistingEntriesのうちbusinessRangeと重なる行だけに絞る。
 *    別営業日の行とは、実時間が隣接していても結合しない（曜日区分ではなく実日時で絞る）。
 *    隣接判定は newStart===existingEnd または newEnd===existingStart の実ミリ秒一致。
 *    1回吸収した後の範囲がさらに別の候補行へ隣接する場合があるため、これ以上隣接する行が
 *    なくなるまで連鎖的に走査する（前方・後方・複数行の橋渡し・同一営業日の日跨ぎを扱える）。
 * 3. 結合後の最終範囲についても、吸収した行を除くallExistingEntries全体との重複を再確認する
 *    （営業日に関係なく拒否。旧データにすでに重複が残っている場合、結合で広がった範囲が
 *    その重複や別営業日扱いの行を新たに巻き込むことがあるため。見つかっても自動結合・自動削除はしない）
 * 戻り値:
 *   { overlap: true } … 厳密な重複あり（自動結合しない、呼び出し元で重複エラーにする）
 *   { overlap: false, mergedStartMs, mergedEndMs, mergedSheetRows } … 結合後の範囲と、
 *     吸収する既存行のシート行番号（行番号の大きい順。呼び出し元はこの順で削除すればずれない）
 */
function planShiftMerge_(newStartMs, newEndMs, allExistingEntries, businessStartMs, businessEndMs) {
  for (var i = 0; i <= allExistingEntries.length - 1; i++) {
    var e = allExistingEntries[i]
    if (newStartMs < e.endMs && e.startMs < newEndMs) {
      return { overlap: true }
    }
  }

  // 希望シフトに関連付いた勤務（wishIdあり）は結合候補から除外する。結合すると行が1本に
  // まとまり、どの希望に対応する勤務かが分からなくなり関連付けが壊れるため
  // （希望IDを持たない従来勤務同士の結合は従来どおり行う）。厳密な重複確認（上のループ）は
  // 希望の有無にかかわらず全件に対して行う
  var candidateEntries = allExistingEntries.filter(function (e2) {
    return e2.startMs < businessEndMs && businessStartMs < e2.endMs && !e2.wishId
  })

  var mergedStartMs = newStartMs
  var mergedEndMs = newEndMs
  var mergedSheetRows = []
  var remainingCandidates = candidateEntries.slice()
  var changed = true
  while (changed) {
    changed = false
    for (var j = 0; j <= remainingCandidates.length - 1; j++) {
      var entry = remainingCandidates[j]
      if (entry.startMs === mergedEndMs || entry.endMs === mergedStartMs) {
        mergedStartMs = Math.min(mergedStartMs, entry.startMs)
        mergedEndMs = Math.max(mergedEndMs, entry.endMs)
        mergedSheetRows.push(entry.sheetRow)
        remainingCandidates.splice(j, 1)
        changed = true
        break
      }
    }
  }

  var mergedRowSet = {}
  for (var m = 0; m <= mergedSheetRows.length - 1; m++) {
    mergedRowSet[mergedSheetRows[m]] = true
  }
  for (var k = 0; k <= allExistingEntries.length - 1; k++) {
    var r = allExistingEntries[k]
    if (mergedRowSet[r.sheetRow]) continue // 吸収済みの行自身と重なるのは当然のため除外する
    if (mergedStartMs < r.endMs && r.startMs < mergedEndMs) {
      return { overlap: true }
    }
  }

  mergedSheetRows.sort(function (a, b) { return b - a })
  return {
    overlap: false,
    mergedStartMs: mergedStartMs,
    mergedEndMs: mergedEndMs,
    mergedSheetRows: mergedSheetRows
  }
}

/**
 * シフト予定シート全体から、指定した希望IDを持つ勤務行を探す（従業員を問わず1件見つかれば返す）。
 * 希望シフトの「登録済みかどうか」は、希望シートの状態列（status）ではなく、この関数が返す
 * シフト予定シート側の実在確認を正データとして判定する（レビュー対応: 状態列だけに依存すると、
 * 勤務書き込み後の状態更新に失敗した場合や、勤務削除後の状態更新に失敗した場合に、
 * 表示・二重登録防止が実態と食い違うため）。書き込み直後の確認にも、削除直後の確認にも使う
 */
function findShiftEntryByWishId_(wishId) {
  if (!wishId) return null
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return null
  var values = sheet.getRange(2, 1, last_row - 1, 6).getValues()
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (row[5] && String(row[5]) === String(wishId)) {
      return { sheetRow: i + 2, employee_id: String(row[0]) }
    }
  }
  return null
}

/**
 * シフト予定シート全体を1回だけ読み込み、指定した対象営業日に実時間が重なる勤務を持つ
 * 従業員IDの集合を返す（キーが従業員ID文字列、値はtrue）。希望ID付きの勤務（希望から
 * 登録した勤務）だけでなく、店主が直接登録した勤務（希望IDなし）も対象に含める
 * （店主の希望導線整理 2026-09-24。直接勤務登録でも、同じ従業員・同じ対象営業日に勤務が
 * あれば希望バーを隠すため。isEmployeeWorkRegisteredOnBusinessDate_と同じ「実時間が
 * 営業日範囲と重なるか」の判定規則を使うが、対象は単一従業員ではなく全従業員分を
 * 1回のシート読み込みでまとめて集合化する点が異なる）。
 * 複数の希望を対象日と照合したい呼び出し元（getShiftWishesForBusinessDate）はこちらを使い、
 * 希望ごとにシフト予定シート全体を読み直すことを避ける。単発の確認（登録・修正・削除の
 * ロック内での実在確認）は従来どおりfindShiftEntryByWishId_を使う（その場で読み直して
 * 最新状態を見る必要があるため、集合化してキャッシュする必要はない）
 */
function getEmployeeIdsWithShiftOnBusinessDate_(businessDateObj) {
  var businessRange = getBusinessDayRange_(businessDateObj)
  var businessStartMs = businessRange.start.getTime()
  var businessEndMs = businessRange.end.getTime()

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  var set = {}
  if (last_row < 2) return set
  var values = sheet.getRange(2, 1, last_row - 1, 4).getValues()
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue
    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    if (range.start.getTime() < businessEndMs && businessStartMs < range.end.getTime()) {
      set[String(row[0])] = true
    }
  }
  return set
}

/**
 * DateオブジェクトからGASシートの時刻列に保存する"HH:MM"形式の文字列を作る
 */
function formatHourMinuteForSheet_(dateObj) {
  var h = dateObj.getHours()
  var m = dateObj.getMinutes()
  return (h < 10 ? '0' + h : String(h)) + ':' + (m < 10 ? '0' + m : String(m))
}

/**
 * 指定した従業員のシフト予定を1件保存する（店主画面のフォームからemployee_idを直接受け取る）
 * 画面上部で選択中の営業日（business_date）を、登録・表示・判定に共通する唯一の日付入力として扱う。
 * 実際の勤務開始日（シート「日付」列）はクライアントから受け取らず、resolveShiftStartDate_で
 * business_dateと開始時刻から求める（updateShiftEntryと同じ規則。開始時刻が0:00〜2:00なら翌日、
 * それ以外は当日）。クライアントの入力を信用せずサーバー側で導出するのは、日付の二重入力・
 * 不一致エラーをなくすため（詳細は02_企画・設計/営業日・勤務開始日の入力統一_改善仕様.md）
 * 従業員・開始時刻・終了時刻が空の場合は保存せずエラーメッセージを返す
 * （HTML側のrequiredはブラウザの一次防御。ここはそれをすり抜けた場合の最終防御）
 * 最低3時間は、この入力区間だけでなく、隣接する既存シフトと結合した後の連続勤務時間で判定する
 * （店主にとって「12:00〜19:00へ19:00〜21:00を追加する」操作は9時間シフトの延長であり、
 * 追加分2時間だけを見て拒否すべきではないため。単独の2時間シフトは従来どおり拒否する）
 * 重複チェック・結合判定・保存はLockServiceの同じロック内で行い、連打などによる同時保存を防ぐ
 * 曜日区分（シートE列）もクライアントの入力を信用せず、business_dateからサーバー側で自動判定する
 */
function postShiftEntry(form) {
  if (!form.employee_id) {
    return '従業員を選択してください'
  }
  if (!form.start_time || !form.end_time) {
    return '開始・終了時刻は必須です'
  }
  if (!form.business_date) {
    return '営業日が特定できません。画面を再読み込みしてください'
  }
  if (!isOnTheHourTimeStr_(form.start_time) || !isOnTheHourTimeStr_(form.end_time)) {
    return '開始・終了時刻は毎時0分（1時間単位）で入力してください'
  }
  var dayTypeResult = getBusinessDayType(form.business_date)
  if (!dayTypeResult.success) {
    return dayTypeResult.message
  }
  var businessDateObj = parseFormDate_(form.business_date)
  var shiftDateObj = resolveShiftStartDate_(businessDateObj, form.start_time)
  var range = getShiftDateTimeRange_(
    shiftDateObj,
    parseFormTime_(form.start_time),
    parseFormTime_(form.end_time)
  )
  var businessRange = getBusinessDayRange_(businessDateObj)
  var withinBusinessDay = doesShiftOverlapBusinessHours_(range.start.getTime(), range.end.getTime(), businessDateObj)
  if (!withinBusinessDay) {
    return '勤務日時が選択中の営業日（11:00〜翌3:00）の範囲外です'
  }
  var empId = form.employee_id

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
    var existingEntries = getExistingShiftEntriesForEmployee_(sheet, empId, null)
    var plan = planShiftMerge_(range.start.getTime(), range.end.getTime(), existingEntries, businessRange.start.getTime(), businessRange.end.getTime())
    if (plan.overlap) {
      return '同じ従業員のシフトが既存の予定と重複しています'
    }

    var mergedDurationMs = plan.mergedEndMs - plan.mergedStartMs
    if (mergedDurationMs < SHIFT_MIN_DURATION_MS) {
      return 'シフトは3時間以上で入力してください'
    }

    var mergedStartDate = new Date(plan.mergedStartMs)
    var mergedEndDate = new Date(plan.mergedEndMs)
    var shiftDateForSheet = new Date(mergedStartDate.getFullYear(), mergedStartDate.getMonth(), mergedStartDate.getDate())
    var startTimeForSheet = formatHourMinuteForSheet_(mergedStartDate)
    var endTimeForSheet = formatHourMinuteForSheet_(mergedEndDate)
    var mergedLabel = startTimeForSheet + '〜' + endTimeForSheet

    if (plan.mergedSheetRows.length === 0) {
      // 隣接する既存行がない：新規1行として末尾に追加する
      var targetRow = sheet.getLastRow() + 1
      sheet.getRange(targetRow, 1, 1, 5).setValues([[
        empId, shiftDateForSheet, startTimeForSheet, endTimeForSheet, dayTypeResult.day_type
      ]])
      return '登録しました'
    }

    // 隣接する既存行がある：行番号が最小の行へ結合結果を書き込み、残りの吸収行を削除する
    // （書き込みを先に行うことで、後段の削除による行番号のずれの影響を受けない）
    var ascendingRows = plan.mergedSheetRows.slice().sort(function (a, b) { return a - b })
    var keepRow = ascendingRows[0]
    var rowsToDelete = plan.mergedSheetRows
      .filter(function (r) { return r !== keepRow })
      .sort(function (a, b) { return b - a }) // 大きい行番号から削除（未削除の行がずれないようにする）

    sheet.getRange(keepRow, 1, 1, 5).setValues([[
      empId, shiftDateForSheet, startTimeForSheet, endTimeForSheet, dayTypeResult.day_type
    ]])
    for (var d = 0; d <= rowsToDelete.length - 1; d++) {
      sheet.deleteRow(rowsToDelete[d])
    }
    return '既存シフトとつなげて' + mergedLabel + 'で登録しました'
  } finally {
    lock.releaseLock()
  }
}

/**
 * freeeの従業員一覧からID→氏名のマップを作る
 */
function getEmployeeNameMap_() {
  var employees = getEmployees()
  var map = {}
  for (var i = 0; i <= employees.length - 1; i++) {
    map[String(employees[i].id)] = employees[i].display_name
  }
  return map
}

/**
 * 日付を「○年○月○日」に整形する
 */
function formatDateJp_(dateObj) {
  return dateObj.getFullYear() + '年'
    + (dateObj.getMonth() + 1) + '月'
    + dateObj.getDate() + '日'
}

/**
 * 時刻を「○時○分」に整形する（分は2桁ゼロ埋め）
 */
function formatTimeJp_(dateObj) {
  var minutes = dateObj.getMinutes()
  var minutesStr = minutes < 10 ? '0' + minutes : String(minutes)
  return dateObj.getHours() + '時' + minutesStr + '分'
}

/**
 * 年月日が同じカレンダー日かどうかを判定する（時刻は見ない）
 */
function isSameCalendarDate_(a, b) {
  return a.getFullYear() == b.getFullYear() && a.getMonth() == b.getMonth() && a.getDate() == b.getDate()
}

/**
 * 指定した従業員の全シフト予定を、実開始・終了msだけ持つ形で1回のシート読み込みで返す
 * （従業員希望シフト一括提出、2026-09-21・2026-09-22。詳細はemployee_shift_wish.gs）。
 * isEmployeeWorkRegisteredOnBusinessDate_・getEmployeeWishPeriodDataの両方がこれを使い、
 * 対象期間中の日数ぶんシートを繰り返し全件走査しないようにする（1回取得した結果を
 * 呼び出し元で日付別に組み立て直す）。
 */
function getEmployeeShiftEntriesForWish_(empId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var values = sheet.getRange(2, 1, last_row - 1, 4).getValues()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (String(row[0]) !== String(empId)) continue
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue
    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    list.push({ startMs: range.start.getTime(), endMs: range.end.getTime() })
  }
  return list
}

/**
 * 指定した従業員・対象営業日に、シフト予定（勤務）が1件でもあるかを判定する。
 * 希望ID付きの勤務（希望から登録した勤務）だけでなく、店主が直接登録した勤務
 * （希望IDなし）も対象に含める。「シフト予定」の実時間を営業日範囲へ対応付け、
 * 従業員ID＋対象営業日で確認する（希望IDの関連だけに依存しない）。
 * entriesを渡さない場合はここで1回だけ読み込む（単発呼び出し用）。期間データ取得のように
 * 同じ従業員に対して複数営業日ぶん呼ぶ場合は、getEmployeeShiftEntriesForWish_で1回取得した
 * 結果を呼び出し元から渡すことで、シートの繰り返し読み込みを避けられる。
 */
function isEmployeeWorkRegisteredOnBusinessDate_(empId, businessDateObj, entries) {
  var businessRange = getBusinessDayRange_(businessDateObj)
  var businessStartMs = businessRange.start.getTime()
  var businessEndMs = businessRange.end.getTime()

  var list = entries || getEmployeeShiftEntriesForWish_(empId)
  for (var i = 0; i <= list.length - 1; i++) {
    if (list[i].startMs < businessEndMs && businessStartMs < list[i].endMs) return true
  }
  return false
}

/**
 * 判定用に、全従業員のシフトを実際の開始・終了ミリ秒だけ持つ形で返す（表示整形はしない）
 */
function getAllShiftRangesForJudge_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var values = sheet.getRange(2, 1, last_row - 1, 5).getValues()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue
    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    list.push({
      employee_id: String(row[0]),
      startMs: range.start.getTime(),
      endMs: range.end.getTime()
    })
  }
  return list
}

/**
 * 店主画面の時間軸表示用：選択した営業日（11:00〜翌3:00）と重なるシフトを従業員別に返す
 * シートの日付が選択日と一致するかではなく、実際の開始・終了日時が営業日の範囲と重なるかで抽出する
 * （重複条件: shiftStart < businessEnd && businessStart < shiftEnd）。これにより翌0:00〜3:00に始まるシフトも
 * 前日の営業日画面に表示できる。時間軸バーの位置はoffset_minutes（営業日開始からの経過分）と
 * display_minutes（営業日内で表示する分数、はみ出す部分は切り詰め）で表す。
 * ラベルの「翌」は、その時刻が選択した営業日と同じカレンダー日か翌カレンダー日かで付け外しする
 * （実際の開始・終了日時や位置計算には影響しない、表示専用の整形）
 * 従業員名は呼び出し元（view_home.htmlが保持するemployees）で解決するため、ここではemployee_idのみ返す
 * （freeeへの追加アクセスを避け、シートのシフト予定だけで完結させる）
 */
function getShiftEntriesForBusinessDate(businessDateStr) {
  var businessDate = parseFormDate_(businessDateStr)
  var businessRange = getBusinessDayRange_(businessDate)
  var businessStartMs = businessRange.start.getTime()
  var businessEndMs = businessRange.end.getTime()

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var values = sheet.getRange(2, 1, last_row - 1, 6).getValues()

  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) continue

    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    var shiftStartMs = range.start.getTime()
    var shiftEndMs = range.end.getTime()
    // 営業日と重ならないシフトは対象外: shiftStart < businessEnd && businessStart < shiftEnd
    if (!(shiftStartMs < businessEndMs && businessStartMs < shiftEndMs)) continue

    var empId = String(row[0])
    var startLabel = formatTimeJp_(row[2])
    if (!isSameCalendarDate_(range.start, businessDate)) startLabel = '翌' + startLabel
    var endLabel = formatTimeJp_(row[3])
    if (!isSameCalendarDate_(range.end, businessDate)) endLabel = '翌' + endLabel

    var clippedStartMs = Math.max(shiftStartMs, businessStartMs)
    var clippedEndMs = Math.min(shiftEndMs, businessEndMs)

    list.push({
      source_row: i + 2, // シート上の行番号（ヘッダー分+1、配列0始まり分+1）。削除対象の特定に使う
      employee_id: empId,
      start_ms: shiftStartMs,
      end_ms: shiftEndMs,
      start_label: startLabel,
      end_label: endLabel,
      wish_id: row[5] ? String(row[5]) : '', // 希望シフトから登録した勤務かどうか（表示用）
      offset_minutes: Math.round((clippedStartMs - businessStartMs) / 60000),
      display_minutes: Math.round((clippedEndMs - clippedStartMs) / 60000)
    })
  }
  list.sort(function (a, b) {
    if (a.employee_id != b.employee_id) return a.employee_id < b.employee_id ? -1 : 1
    return a.start_ms - b.start_ms
  })
  return list
}

/**
 * 店主画面から、選択したシフト予定を1件削除する
 * source_row（シート行番号）だけを信用せず、ロック取得後にその行の従業員ID・開始ms・終了msを
 * getShiftDateTimeRange_で再計算し、リクエスト内容と完全に一致した場合だけ削除する
 * （他の削除によって行番号がずれていた場合に、別の従業員のシフトを誤って削除しないため）
 */
function deleteShiftEntry(request) {
  if (!request) {
    return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
  }
  var sourceRow = Number(request.source_row)
  if (!Number.isInteger(sourceRow)) {
    return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    // シート取得・行番号の範囲確認はロック取得後に行う（ロック待機中に他の削除で行数が変わっている可能性があるため）
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
    if (!(sourceRow >= 2 && sourceRow <= sheet.getLastRow())) {
      return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
    }
    var row = sheet.getRange(sourceRow, 1, 1, 6).getValues()[0]
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) {
      return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
    }
    var range = getShiftDateTimeRange_(row[1], row[2], row[3])
    var matches = String(row[0]) == String(request.employee_id)
      && range.start.getTime() == Number(request.start_ms)
      && range.end.getTime() == Number(request.end_ms)
    if (!matches) {
      return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
    }
    var wishId = row[5] ? String(row[5]) : ''
    sheet.deleteRow(sourceRow)
    // この勤務が希望シフトから登録されたものであれば、希望シート側の状態列も「未登録」へ戻す
    // （UI表示の補助情報の書き込みに過ぎない。希望の再表示自体は、シフト予定シート側に
    // その希望IDを持つ行がもう存在しないこと＝findShiftEntryByWishId_で行われるため、
    // この更新が失敗しても、削除操作の成否・希望の再表示のどちらにも影響しない）
    if (wishId) {
      try {
        var wish = findShiftWishById_(wishId)
        if (wish) setShiftWishStatus_(wish.sheetRow, SHIFT_WISH_STATUS_OPEN_)
      } catch (e) {
        // 状態列の更新失敗は削除の成否に影響させない（上記コメントの通り）
      }
    }
    return { success: true, message: 'シフトを削除しました' }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 登録済みシフト予定の開始・終了時刻を変更する（従業員は変更しない）
 * source_row・元employee_id・元start_ms・元end_msのすべてが現在のシート内容と一致した場合だけ更新する
 * （deleteShiftEntryと同じ「行ずれ検出」の考え方。他の操作で行がずれていた場合は誤って別の行を更新しない）
 * 検証はpostShiftEntryと揃える：毎時0分、選択営業日との重なり、3時間以上、同じ従業員の別シフトとの重複なし
 * （重複確認は更新対象の行自身を除外するため、現在と同じ時刻で保存しても重複扱いにならない）
 * 対象行は上書きするだけで、削除して末尾へ再追加はしない（シート上の行位置を変えない）
 * 「日付」列（勤務開始日）はユーザーが直接入力せず、resolveShiftStartDate_でbusiness_dateと
 * 新しい開始時刻から求め直す。翌0:00〜翌2:00への変更・その逆方向の変更も、この再計算により
 * 正しい勤務開始日として列Bへ保存される（日付列は変更しないという誤った前提を廃止した）
 */
function updateShiftEntry(request) {
  if (!request) {
    return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
  }
  var sourceRow = Number(request.source_row)
  if (!Number.isInteger(sourceRow)) {
    return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
  }
  if (!request.start_time || !request.end_time) {
    return { success: false, message: '開始・終了時刻は必須です' }
  }
  if (!request.business_date) {
    return { success: false, message: '営業日が特定できません。画面を再読み込みしてください' }
  }
  if (!isOnTheHourTimeStr_(request.start_time) || !isOnTheHourTimeStr_(request.end_time)) {
    return { success: false, message: '開始・終了時刻は毎時0分（1時間単位）で入力してください' }
  }
  var dayTypeResult = getBusinessDayType(request.business_date)
  if (!dayTypeResult.success) {
    return { success: false, message: dayTypeResult.message }
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
    if (!(sourceRow >= 2 && sourceRow <= sheet.getLastRow())) {
      return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
    }
    var row = sheet.getRange(sourceRow, 1, 1, 6).getValues()[0]
    if (!(row[1] instanceof Date) || !(row[2] instanceof Date) || !(row[3] instanceof Date)) {
      return { success: false, message: '対象のシフトが見つかりません。画面を更新して再度お試しください' }
    }
    var currentRange = getShiftDateTimeRange_(row[1], row[2], row[3])
    var matches = String(row[0]) == String(request.employee_id)
      && currentRange.start.getTime() == Number(request.start_ms)
      && currentRange.end.getTime() == Number(request.end_ms)
    if (!matches) {
      return { success: false, message: '他の変更と競合しました。画面を更新して再度お試しください' }
    }

    var empId = String(row[0])
    var wishId = row[5] ? String(row[5]) : ''
    var businessDateObj = parseFormDate_(request.business_date)
    var shiftDateObj = resolveShiftStartDate_(businessDateObj, request.start_time)

    var newRange = getShiftDateTimeRange_(
      shiftDateObj,
      parseFormTime_(request.start_time),
      parseFormTime_(request.end_time)
    )
    var businessRange = getBusinessDayRange_(businessDateObj)
    var withinBusinessDay = doesShiftOverlapBusinessHours_(newRange.start.getTime(), newRange.end.getTime(), businessDateObj)
    if (!withinBusinessDay) {
      return { success: false, message: '勤務日時が選択中の営業日（11:00〜翌3:00）の範囲外です' }
    }

    // 希望シフトから登録した勤務は、変更できる時間を元の希望範囲内に限定する
    // （希望自体の時刻は店主画面から変更できない＝店主希望導線整理・希望編集削除撤去
    // 2026-09-24。この勤務を削除すれば元の希望が再表示されるが、希望の時刻自体は
    // 従業員側「希望シフト提出」画面での再提出でしか変わらない）。
    // 希望に関連付いた勤務は自動結合の対象にしないため、この行だけを単純に上書きする
    if (wishId) {
      var relatedWish = findShiftWishById_(wishId)
      if (!relatedWish) {
        return { success: false, message: '元の希望シフトが見つかりません。画面を更新して再度お試しください' }
      }
      if (newRange.start.getTime() < relatedWish.start_ms || relatedWish.end_ms < newRange.end.getTime()) {
        return { success: false, message: '変更できる時間は元の希望範囲内に限られます' }
      }
      var wishDurationMs = newRange.end.getTime() - newRange.start.getTime()
      if (wishDurationMs < SHIFT_MIN_DURATION_MS) {
        return { success: false, message: 'シフトは3時間以上で入力してください' }
      }
      var existingForWish = getExistingShiftEntriesForEmployee_(sheet, empId, sourceRow)
      for (var wv = 0; wv <= existingForWish.length - 1; wv++) {
        var ew = existingForWish[wv]
        if (newRange.start.getTime() < ew.endMs && ew.startMs < newRange.end.getTime()) {
          return { success: false, message: '同じ従業員のシフトが既存の予定と重複しています' }
        }
      }
      var wishShiftDate = new Date(shiftDateObj.getFullYear(), shiftDateObj.getMonth(), shiftDateObj.getDate())
      sheet.getRange(sourceRow, 2, 1, 4).setValues([[
        wishShiftDate,
        formatHourMinuteForSheet_(newRange.start),
        formatHourMinuteForSheet_(newRange.end),
        dayTypeResult.day_type
      ]])
      return { success: true, message: '変更しました' }
    }

    // 最低3時間はpostShiftEntryと同様、隣接する既存シフトと結合した後の連続勤務時間で判定する
    // （変更によって他のシフトへ隣接した場合も、同じ規則で1本へ統合し、隣接した別行を残さない）
    var existingEntries = getExistingShiftEntriesForEmployee_(sheet, empId, sourceRow)
    var plan = planShiftMerge_(newRange.start.getTime(), newRange.end.getTime(), existingEntries, businessRange.start.getTime(), businessRange.end.getTime())
    if (plan.overlap) {
      return { success: false, message: '同じ従業員のシフトが既存の予定と重複しています' }
    }

    var mergedDurationMs = plan.mergedEndMs - plan.mergedStartMs
    if (mergedDurationMs < SHIFT_MIN_DURATION_MS) {
      return { success: false, message: 'シフトは3時間以上で入力してください' }
    }

    var mergedStartDate = new Date(plan.mergedStartMs)
    var mergedEndDate = new Date(plan.mergedEndMs)
    var mergedShiftDate = new Date(mergedStartDate.getFullYear(), mergedStartDate.getMonth(), mergedStartDate.getDate())
    var startTimeForSheet = formatHourMinuteForSheet_(mergedStartDate)
    var endTimeForSheet = formatHourMinuteForSheet_(mergedEndDate)

    // sourceRow（更新対象の行、行ずれ検出済み）を採用行として書き込む。書き込みを先に行うため、
    // 後段でmergedSheetRows（sourceRowとは別の隣接吸収行）を削除しても、この書き込み内容は影響を受けない
    sheet.getRange(sourceRow, 2, 1, 4).setValues([[
      mergedShiftDate,
      startTimeForSheet,
      endTimeForSheet,
      dayTypeResult.day_type
    ]])
    for (var d = 0; d <= plan.mergedSheetRows.length - 1; d++) {
      sheet.deleteRow(plan.mergedSheetRows[d]) // 大きい行番号順（planShiftMerge_の戻り値の順）に削除
    }

    var message = plan.mergedSheetRows.length > 0
      ? '既存シフトとつなげて' + startTimeForSheet + '〜' + endTimeForSheet + 'で変更しました'
      : '変更しました'
    return { success: true, message: message }
  } finally {
    lock.releaseLock()
  }
}
