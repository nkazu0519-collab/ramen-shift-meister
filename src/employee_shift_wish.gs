/**
 * 従業員希望シフト一括提出（07_ブラッシュアップ/02_企画・設計/従業員希望シフト一括提出_最小仕様.md）。
 *
 * 位置づけ（AGENTS.mdの現行スコープに追加。2026-09-25提出用の限定デモ）:
 *   - 従業員がfreee従業員一覧から自分を選んで操作する専用画面（?page=wish）。
 *   - この従業員選択は本人認証・権限制御ではない。画面上に「確認用画面です。従業員選択は
 *     ログインではありません」と明示する（view_employee_wish.html側）。認証済み・安全な
 *     本番従業員画面であるかのような表現はしない。
 *   - 任意の複数日へ同じ希望時間または出勤不可を一括設定し、確認後に「まとめて提出」で
 *     サーバーへ保存する。設定しただけでは保存しない（クライアント側の一時状態に留める）。
 *
 * データ設計（詳細はshift_wish.gs冒頭のコメントを参照）:
 *   既存A〜F列は変更せず、G列「回答区分」・H列「最終提出日時」・I列「期限後フラグ」を使う。
 *   同じ従業員・同じ営業日の従業員提出データは原則1回答とし、再提出は重複追加ではなく更新にする。
 *   従来データに同じ従業員・同じ営業日の希望が複数存在して一意に扱えない場合は、勝手に統合・
 *   削除せず、その日を店主確認が必要な競合として提出全体を止める（submitEmployeeShiftWishesBulk）。
 *
 * 保存時の整合性（最重要）:
 *   クライアント側の表示状態を信用せず、一括保存の中でScriptLock取得後に全対象日を
 *   再検証してから書き込む。1日でも入力不正・重複・勤務登録済み・既存回答の一意特定不可・
 *   保存対象間の矛盾があれば、どの日付も更新せず、該当日と理由を返す（部分保存をしない）。
 *   全件検証に通った後だけ、書き込み用のデータを組み立てて反映する。
 *
 *   書き込み回数（レビュー対応 2026-09-22、指摘1）:
 *   検証と書き込みのフェーズを分離するだけでは、書き込みフェーズ自体が複数回のsetValuesに
 *   分かれていると、その途中で例外が発生した場合に一部の行だけ書き込まれた状態になり得る
 *   （検証を先に終えたことは「書き込みが1回で終わる」ことを意味しない）。そのため
 *   submitEmployeeShiftWishesBulkは、既存行の更新と新規行の追加を両方含めて、シート上の
 *   希望シフトデータ全体をメモリ上でA〜I列の配列として組み立て直し、原則1回のsetValuesで
 *   反映する（既存の対象外の行・不正行は、その行のインデックスをそのまま保つことで、
 *   意図せず削除・統合しない）。
 */

/**
 * 従業員希望提出画面（?page=wish）の初期表示データ。
 * freee従業員一覧（getEmployees、確認用の選択対象）だけを返す。マイスター概要や時間軸のような
 * 重いデータは持たない（この画面はシフト希望の入力に特化する）
 */
function getEmployeeWishScreenInitData() {
  var employees = getEmployees()
  return { employees: employees }
}

/**
 * 対象年月・前半/後半が正しい入力かを検証する（年は4桁、月は1〜12、periodは定義済みの2値のみ）
 */
function isValidWishYearMonth_(year, month) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    && Number.isInteger(month) && month >= 1 && month <= 12
}

/**
 * freee従業員一覧に指定IDの従業員が実在するかを確認する（従業員側の操作でもemployee_idを
 * サーバー側で検証する。存在しないIDは拒否する）
 */
function findEmployeeByIdForWish_(empId) {
  var employees = getEmployees()
  for (var i = 0; i <= employees.length - 1; i++) {
    if (String(employees[i].id) === String(empId)) return employees[i]
  }
  return null
}

/**
 * "YYYY-MM-DD"文字列からDateオブジェクトを作る（business_day.gsのparseFormDate_と同じ規則。
 * ここで独自実装せず、既存の共通関数をそのまま使う）
 */
function parseWishDateStr_(dateStr) {
  return parseFormDate_(dateStr)
}

/**
 * DateからGASシートのD・E列に書き込む値を作る（既存のresolveShiftStartDate_・
 * getShiftDateTimeRange_と同じ規則で、対象営業日と開始時刻から実際の日時範囲を求める）
 */
function buildWishTimeRange_(businessDateObj, startTimeStr, endTimeStr) {
  var shiftDateObj = resolveShiftStartDate_(businessDateObj, startTimeStr)
  return getShiftDateTimeRange_(
    shiftDateObj,
    parseFormTime_(startTimeStr),
    parseFormTime_(endTimeStr)
  )
}

/**
 * 1件の時間希望入力（開始・終了時刻）が、既存のpostShiftWishと同じ規則
 * （毎時0分・3時間以上・営業日11:00〜翌3:00と重なる）を満たすかを検証する。
 * 満たさない場合はエラーメッセージ文字列を返し、満たす場合はnullを返す
 */
function validateWishTimeRange_(businessDateObj, startTimeStr, endTimeStr) {
  if (!startTimeStr || !endTimeStr) {
    return '開始・終了時刻を入力してください'
  }
  if (!isOnTheHourTimeStr_(startTimeStr) || !isOnTheHourTimeStr_(endTimeStr)) {
    return '開始・終了時刻は毎時0分（1時間単位）で入力してください'
  }
  var range = buildWishTimeRange_(businessDateObj, startTimeStr, endTimeStr)
  var durationMs = range.end.getTime() - range.start.getTime()
  if (durationMs < SHIFT_MIN_DURATION_MS) {
    return '希望シフトは3時間以上で入力してください'
  }
  var withinBusinessDay = doesShiftOverlapBusinessHours_(range.start.getTime(), range.end.getTime(), businessDateObj)
  if (!withinBusinessDay) {
    return '希望時間が対象営業日（11:00〜翌3:00）の範囲外です'
  }
  return null
}

/**
 * 対象営業日と重なる勤務（entries: getEmployeeShiftEntriesForWish_の戻り値）から、
 * 表示用の時間帯ラベル一覧を作る（レビュー対応 2026-09-22、指摘3）。
 * 翌日0〜2時台に始まる／終わる勤務は「翌」を付けて営業日との関係が分かるようにする
 * （getShiftWishesForBusinessDateの表示ラベル整形と同じ考え方）。同じ営業日に複数勤務がある
 * 場合はすべて返し、開始時刻の早い順に並べる。
 */
function buildWorkTimeLabelsForBusinessDate_(entries, businessDateObj) {
  var businessRange = getBusinessDayRange_(businessDateObj)
  var businessStartMs = businessRange.start.getTime()
  var businessEndMs = businessRange.end.getTime()

  var overlapping = entries.filter(function (e) {
    return e.startMs < businessEndMs && businessStartMs < e.endMs
  })
  overlapping.sort(function (a, b) { return a.startMs - b.startMs })

  var labels = []
  for (var i = 0; i <= overlapping.length - 1; i++) {
    var e = overlapping[i]
    var startDate = new Date(e.startMs)
    var endDate = new Date(e.endMs)
    var startLabel = formatTimeJp_(startDate)
    if (!isSameCalendarDate_(startDate, businessDateObj)) startLabel = '翌' + startLabel
    var endLabel = formatTimeJp_(endDate)
    if (!isSameCalendarDate_(endDate, businessDateObj)) endLabel = '翌' + endLabel
    labels.push(startLabel + '〜' + endLabel)
  }
  return labels
}

/**
 * 対象従業員・対象期間（年月・前半/後半）の日付別状態一覧を返す。
 * 従業員画面（js_employee_wish.html）が、期間切替・従業員切替のたびにこれを呼んで表示を組み立てる。
 * 各日付について:
 *   - work_registered: 勤務予定（希望由来・直接登録の両方を含む）が1件でもあれば true
 *   - work_time_labels: 勤務登録済みの場合の時間帯表示一覧（例:["12:00〜20:00"]。複数勤務が
 *     あれば複数件、翌日0〜2時台に関わる勤務は「翌」付き。レビュー対応 2026-09-22、指摘3）
 *   - answer_type: 既存の従業員提出データがあれば'時間希望'/'出勤不可'、なければnull（未提出）
 *   - start_time/end_time: 時間希望の場合の"HH:MM"（表示・再編集用の初期値）
 *   - wish_id: 既存の従業員提出データがあれば、その希望ID
 *   - after_deadline: 既存データの期限後フラグ（新規未提出日は常にfalse）
 *   - deadline_ms/is_before_deadline_now: 締切そのもの（表示用）。期限判定自体は保存時点の結果を
 *     保存するため、ここでの「現在時刻との比較」は画面の案内表示にのみ使い、DBへは書き込まない
 * 同じ従業員・同じ営業日に複数の従業員提出データが既にある場合（過去データが一意化できない場合）は、
 * その日をconflict:trueとして返し、画面側はその日を編集不可・要店主確認として表示する
 * （勝手に統合・削除しない）
 *
 * シート読み込み回数（レビュー対応 2026-09-22、指摘3）:
 *   対象従業員のシフト予定はgetEmployeeShiftEntriesForWish_で1回だけ取得し、対象期間の
 *   日数ぶん（最大16日）シートを繰り返し全件走査しない。取得済みの結果を日付ごとに
 *   isEmployeeWorkRegisteredOnBusinessDate_・buildWorkTimeLabelsForBusinessDate_へ渡す。
 */
function getEmployeeWishPeriodData(empId, year, month, period) {
  if (!empId) {
    return { success: false, message: '従業員を選択してください' }
  }
  if (!findEmployeeByIdForWish_(empId)) {
    return { success: false, message: '従業員が見つかりません。画面を更新して再度お試しください' }
  }
  if (!isValidWishYearMonth_(year, month)) {
    return { success: false, message: '対象年月が不正です' }
  }
  if (!isValidWishPeriod_(period)) {
    return { success: false, message: '対象期間（前半／後半）が不正です' }
  }

  var businessDates = resolveWishPeriodBusinessDates_(year, month, period)
  var deadlineMs = calcWishSubmissionDeadlineMs_(year, month, period)

  // 対象従業員の既存提出データを、対象営業日（YYYY-MM-DD）ごとにグルーピングする
  // （同じ日に複数件あれば一意化できない＝競合として扱う）
  var allWishes = getAllShiftWishRows_().filter(function (w) {
    return w.employee_id === String(empId)
  })
  var wishesByDateKey = {}
  for (var i = 0; i <= allWishes.length - 1; i++) {
    var w = allWishes[i]
    if (!w.business_date) continue
    var key = formatDateInputValueForSheet_(w.business_date)
    if (!wishesByDateKey[key]) wishesByDateKey[key] = []
    wishesByDateKey[key].push(w)
  }

  // 対象従業員のシフト予定を1回だけ取得し、日ごとの判定・時間表示の組み立てに使い回す
  var shiftEntries = getEmployeeShiftEntriesForWish_(empId)

  var days = []
  for (var d = 0; d <= businessDates.length - 1; d++) {
    var dateObj = businessDates[d]
    var dateKey = formatDateInputValueForSheet_(dateObj)
    var workRegistered = isEmployeeWorkRegisteredOnBusinessDate_(empId, dateObj, shiftEntries)
    var wishesOnDate = wishesByDateKey[dateKey] || []

    var day = {
      date: dateKey,
      work_registered: workRegistered,
      work_time_labels: workRegistered ? buildWorkTimeLabelsForBusinessDate_(shiftEntries, dateObj) : [],
      answer_type: null,
      start_time: '',
      end_time: '',
      wish_id: '',
      after_deadline: false,
      conflict: false
    }

    if (wishesOnDate.length > 1) {
      // 同じ従業員・同じ営業日に複数の提出データが既にある＝自動的に一意化できない。
      // 統合・削除はせず、店主確認が必要な競合として画面側に伝える（この日は編集不可）
      day.conflict = true
    } else if (wishesOnDate.length === 1) {
      var w1 = wishesOnDate[0]
      day.answer_type = w1.answer_type
      day.wish_id = w1.wish_id
      day.after_deadline = !!w1.after_deadline
      if (w1.answer_type === SHIFT_WISH_ANSWER_TYPE_TIME_) {
        day.start_time = formatHourMinuteForSheet_(new Date(w1.start_ms))
        day.end_time = formatHourMinuteForSheet_(new Date(w1.end_ms))
      }
    }

    days.push(day)
  }

  return {
    success: true,
    deadline_ms: deadlineMs,
    days: days
  }
}

/**
 * 一括提出リクエスト内の1件（1日分）の入力を検証する（型・値の範囲のみ。重複・勤務登録済み・
 * 既存データとの競合は、対象期間全体が揃った状態でsubmitEmployeeShiftWishesBulk側が検証する）。
 * 不正な場合はエラーメッセージを返し、正しい場合はnullを返す
 */
function validateWishSubmitItemShape_(item, periodDateKeySet) {
  if (!item || typeof item.date !== 'string') {
    return '日付が不正です'
  }
  if (!periodDateKeySet[item.date]) {
    return item.date + 'は選択した対象期間に含まれていません'
  }
  if (item.answer_type !== SHIFT_WISH_ANSWER_TYPE_TIME_ && item.answer_type !== SHIFT_WISH_ANSWER_TYPE_UNAVAILABLE_) {
    return item.date + 'の回答区分が不正です'
  }
  return null
}

/**
 * 従業員希望シフトの一括提出（「まとめて提出」）。
 *
 * request: { employee_id, year, month, period, items: [{ date, answer_type, start_time, end_time }] }
 *   itemsは提出する日付分だけを含む（未設定日は含めない＝一部提出を許可する。未設定を
 *   出勤不可として自動変換しない）。同じ日付がitems内に重複して含まれるのは入力不正として拒否する。
 *
 * 検証順序（1日でも失敗があれば、どの日付も更新しない）:
 *   1. 従業員・対象年月・対象期間・items形状の基本検証
 *   2. items内の日付重複がないか（保存対象間の矛盾）
 *   3. 各日付の時間希望はvalidateWishTimeRange_で範囲・時間帯を検証
 *   4. 各日付が勤務登録済みでないか（isEmployeeWorkRegisteredOnBusinessDate_。希望ID付き勤務・
 *      直接登録勤務の両方を対象にする。画面表示後に店主が新たに登録した競合もここで拒否する）
 *   5. 各日付の既存提出データが一意に特定できるか（0件=新規／1件=更新／2件以上=競合のため拒否）
 *   6. 時間希望同士の実時間重複がないか（レビュー対応 2026-09-22、指摘2）。一括内の時間希望
 *      同士（別営業日の希望が実時間で重なるケースを含む）、および更新対象自身を除く同じ従業員の
 *      既存の時間希望との重複を、start < otherEnd && otherStart < endで確認する（店主側の
 *      postShiftWish・updateShiftWishと同じ重複規則）。出勤不可は時刻を持たないため比較対象外。
 *      提出対象日に既存回答がある場合、その既存行は今回の内容で置き換わるため自分自身との
 *      比較から除外する。
 *   7. 新規追加分・更新分を反映したA〜I列の最終データ配列をメモリ上で組み立て、全件検証を
 *      終えてから、原則1回のsetValuesでシートのデータ部分全体へ書き込む（対象外の既存行・
 *      不正行は内容を変えずそのまま残す。検証完了前には一切書き込まない＝検証と書き込みの
 *      フェーズを分離した上で、書き込み自体も1回にまとめることで部分成功を防ぐ）。
 *   二重クリック・同一内容の再送は、ScriptLock取得後の再検証（4・5）で常に最新状態と照合するため、
 *   同じ内容を再送しても重複行は増えず、既存行の上書き（更新）になる。
 */
function submitEmployeeShiftWishesBulk(request) {
  if (!request) {
    return { success: false, message: '送信内容が不正です' }
  }
  var empId = request.employee_id
  if (!empId) {
    return { success: false, message: '従業員を選択してください' }
  }
  if (!findEmployeeByIdForWish_(empId)) {
    return { success: false, message: '従業員が見つかりません。画面を更新して再度お試しください' }
  }
  var year = Number(request.year)
  var month = Number(request.month)
  if (!isValidWishYearMonth_(year, month)) {
    return { success: false, message: '対象年月が不正です' }
  }
  if (!isValidWishPeriod_(request.period)) {
    return { success: false, message: '対象期間（前半／後半）が不正です' }
  }
  var items = request.items
  if (!items || !items.length) {
    return { success: false, message: '提出する日付を選択してください' }
  }

  var periodDates = resolveWishPeriodBusinessDates_(year, month, request.period)
  var periodDateKeySet = {}
  for (var p = 0; p <= periodDates.length - 1; p++) {
    periodDateKeySet[formatDateInputValueForSheet_(periodDates[p])] = true
  }

  // 1. 基本検証（形状・対象期間内かどうか）
  for (var i0 = 0; i0 <= items.length - 1; i0++) {
    var shapeError = validateWishSubmitItemShape_(items[i0], periodDateKeySet)
    if (shapeError) {
      return { success: false, message: shapeError, failed_date: items[i0] && items[i0].date }
    }
  }

  // 2. items内の日付重複（保存対象間の矛盾）を拒否する
  var seenDateKeys = {}
  for (var i1 = 0; i1 <= items.length - 1; i1++) {
    var dateKey1 = items[i1].date
    if (seenDateKeys[dateKey1]) {
      return { success: false, message: dateKey1 + 'が提出内容の中で重複しています', failed_date: dateKey1 }
    }
    seenDateKeys[dateKey1] = true
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var nowMs = getCurrentTimeMs_()
    var afterDeadline = isWishSubmissionAfterDeadline_(year, month, request.period, nowMs)
    var submittedAt = new Date(nowMs)

    // ロック内で最新の既存データを取り直す（画面表示後に他の操作で状態が変わっている可能性があるため、
    // クライアント側の表示は信用しない）
    var existingWishes = getAllShiftWishRows_().filter(function (w) {
      return w.employee_id === String(empId)
    })
    var existingByDateKey = {}
    for (var e = 0; e <= existingWishes.length - 1; e++) {
      var ew = existingWishes[e]
      if (!ew.business_date) continue
      var eKey = formatDateInputValueForSheet_(ew.business_date)
      if (!existingByDateKey[eKey]) existingByDateKey[eKey] = []
      existingByDateKey[eKey].push(ew)
    }

    // 3〜5. 対象日ごとの検証（時間範囲・勤務登録済み・既存データの一意性）と、書き込み計画の組み立て。
    // ここでは検証だけを行い、シートへは一切書き込まない（全件検証を通ってから書き込みフェーズへ進む）
    var plannedUpdates = [] // { sheetRow, values: [9列] }
    var plannedInserts = [] // { values: [9列] }
    var timeRangesForOverlapCheck = [] // { date, startMs, endMs } … 6.の一括内重複チェック用（時間希望のみ）
    for (var i2 = 0; i2 <= items.length - 1; i2++) {
      var item = items[i2]
      var dateObj = parseWishDateStr_(item.date)

      var startTimeForSheet = ''
      var endTimeForSheet = ''
      var startDateForRow = ''
      var endDateForRow = ''
      if (item.answer_type === SHIFT_WISH_ANSWER_TYPE_TIME_) {
        var timeError = validateWishTimeRange_(dateObj, item.start_time, item.end_time)
        if (timeError) {
          return { success: false, message: item.date + ': ' + timeError, failed_date: item.date }
        }
        var range = buildWishTimeRange_(dateObj, item.start_time, item.end_time)
        startDateForRow = range.start
        endDateForRow = range.end
        startTimeForSheet = formatHourMinuteForSheet_(range.start)
        endTimeForSheet = formatHourMinuteForSheet_(range.end)
        timeRangesForOverlapCheck.push({
          date: item.date, startMs: range.start.getTime(), endMs: range.end.getTime()
        })
      }
      // 出勤不可はD・E（開始・終了日時）を空欄にする

      // 4. 勤務登録済み（希望ID付き・直接登録の両方）を拒否する。画面表示後に店主が新たに
      // 登録した競合も、ここでロック内の最新シート状態を見るため拒否できる
      if (isEmployeeWorkRegisteredOnBusinessDate_(empId, dateObj)) {
        return { success: false, message: item.date + 'は勤務登録済みのため、この画面からは変更できません。変更は店主へ相談してください', failed_date: item.date }
      }

      // 5. 既存の従業員提出データの一意性を確認する
      var existingOnDate = existingByDateKey[item.date] || []
      if (existingOnDate.length > 1) {
        return { success: false, message: item.date + 'は既存データが複数あり自動判定できません。店主に確認してください', failed_date: item.date }
      }

      var rowValues = [
        '', empId, dateObj, startDateForRow, endDateForRow, SHIFT_WISH_STATUS_OPEN_,
        item.answer_type, submittedAt, afterDeadline
      ]

      if (existingOnDate.length === 1) {
        // 既存回答が勤務登録済みでないことは4で確認済み。希望IDは更新後も維持する
        var target = existingOnDate[0]
        if (findShiftEntryByWishId_(target.wish_id)) {
          // 4のisEmployeeWorkRegisteredOnBusinessDate_と原理的に同じはずだが、希望IDだけに
          // 依存しない二重の防御として明示的にも確認する（保存対象間の矛盾を残さないため）
          return { success: false, message: item.date + 'は勤務登録済みのため、この画面からは変更できません。変更は店主へ相談してください', failed_date: item.date }
        }
        rowValues[0] = target.wish_id
        plannedUpdates.push({ sheetRow: target.sheetRow, values: rowValues })
      } else {
        rowValues[0] = Utilities.getUuid()
        plannedInserts.push({ values: rowValues })
      }
    }

    // 6. 時間希望同士の実時間重複を確認する（レビュー対応 2026-09-22、指摘2）。
    // 6a. 一括提出内の時間希望同士（別営業日の希望が実時間で重なるケースを含む）を、
    //     全itemsが揃った状態で総当たりに比較する（片方が出勤不可の組み合わせは対象外）
    for (var ov1 = 0; ov1 <= timeRangesForOverlapCheck.length - 1; ov1++) {
      for (var ov2 = ov1 + 1; ov2 <= timeRangesForOverlapCheck.length - 1; ov2++) {
        var t1 = timeRangesForOverlapCheck[ov1]
        var t2 = timeRangesForOverlapCheck[ov2]
        if (t1.startMs < t2.endMs && t2.startMs < t1.endMs) {
          return { success: false, message: t1.date + 'と' + t2.date + 'の希望時間が重複しています', failed_date: t2.date }
        }
      }
    }
    // 6b. 更新対象自身を除く、同じ従業員の既存時間希望との重複を確認する。提出対象日に既存回答が
    //     ある場合、その既存行は今回の内容（時間希望・出勤不可のいずれであっても）で置き換わる
    //     ため、比較対象から除外する（自分自身の従来行との比較にならないようにする）。
    //     除外対象はitems全件の日付から作る（再レビュー対応 2026-09-22）。timeRangesForOverlapCheck
    //     だけから作ると、既存の時間希望を今回「出勤不可」へ変更する日が除外されず、置き換え後には
    //     存在しなくなる古い時間と、同じ一括提出内の別日の新しい時間希望とを誤って比較してしまう
    var submittedDateKeySet = {}
    for (var sd = 0; sd <= items.length - 1; sd++) {
      submittedDateKeySet[items[sd].date] = true
    }
    var existingTimeWishesForOverlap = existingWishes.filter(function (w) {
      if (w.answer_type !== SHIFT_WISH_ANSWER_TYPE_TIME_) return false
      if (!w.business_date) return false
      var wKey = formatDateInputValueForSheet_(w.business_date)
      return !submittedDateKeySet[wKey] // 今回置き換わる日付は比較対象外
    })
    for (var ov3 = 0; ov3 <= timeRangesForOverlapCheck.length - 1; ov3++) {
      var t3 = timeRangesForOverlapCheck[ov3]
      for (var ov4 = 0; ov4 <= existingTimeWishesForOverlap.length - 1; ov4++) {
        var ex = existingTimeWishesForOverlap[ov4]
        if (t3.startMs < ex.end_ms && ex.start_ms < t3.endMs) {
          return { success: false, message: t3.date + 'の希望時間が既存の希望と重複しています', failed_date: t3.date }
        }
      }
    }

    // 7. 全件検証を終えたので、ここから書き込みフェーズに入る（検証失敗時はここへ到達しない＝
    // どの日付も更新されないことが保証される）。
    //
    // 書き込みを原則1回のsetValuesにする（レビュー対応 2026-09-22、指摘1）:
    //   既存行を1行ずつ更新し、その後で新規行を別途追加すると、複数回のsetValues呼び出しの
    //   途中で例外が発生した場合に一部の行だけ書き込まれた状態になり得る（検証と書き込みの
    //   フェーズを分離しても、書き込みフェーズ自体が複数回に分かれていれば原子的にはならない）。
    //   そのため、シート上の現在の全データ行（対象外の既存行・不正行を含む）をそのまま
    //   メモリ上へ読み込み、更新対象の行だけをplannedUpdatesの内容で差し替え、その配列の末尾へ
    //   plannedInsertsを追加した、A〜I列の最終データ配列を組み立ててから、原則1回のsetValuesで
    //   シートのデータ部分全体を反映する（対象外の既存行・不正行は内容を変更せず、そのままの
    //   インデックスに残すため、勝手な削除・統合にはならない）。
    var sheet = getOrCreateShiftWishSheet_()
    var rawRows = getShiftWishSheetRawRows_(sheet)
    var updatesBySheetRow = {}
    for (var u = 0; u <= plannedUpdates.length - 1; u++) {
      updatesBySheetRow[plannedUpdates[u].sheetRow] = plannedUpdates[u].values
    }

    var finalValues = []
    for (var r = 0; r <= rawRows.length - 1; r++) {
      var rawRow = rawRows[r]
      finalValues.push(updatesBySheetRow[rawRow.sheetRow] || rawRow.values)
    }
    for (var ins = 0; ins <= plannedInserts.length - 1; ins++) {
      finalValues.push(plannedInserts[ins].values)
    }

    if (finalValues.length > 0) {
      sheet.getRange(2, 1, finalValues.length, 9).setValues(finalValues)
    }

    return {
      success: true,
      message: '希望シフトをまとめて提出しました（' + items.length + '件）',
      after_deadline: afterDeadline,
      submitted_count: items.length
    }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 希望シフト提出状況（07_ブラッシュアップ/02_企画・設計/希望シフト提出状況_最小仕様.md）。
 * 店主向けの表示専用画面（?page=wish-status）が、対象月・前半/後半ごとに従業員別の提出状況
 * （提出済み／一部提出／未提出／要確認、期限後あり）を確認するために呼ぶ。
 *
 * 状態判定:
 *   対象期間の日数をtarget_day_count、有効な回答（時間希望または出勤不可）が存在する一意の
 *   営業日数をanswered_day_countとする。
 *     - 提出済み: answered_day_count === target_day_count
 *     - 一部提出: 0 < answered_day_count < target_day_count
 *     - 未提出:   answered_day_count === 0
 *     - 要確認:   同じ従業員・同じ営業日に希望データが複数あり、一意に判定できない日が1日以上ある
 *                （このとき対象期間の判定はconflictを優先する。回答日数は表示用に一意日付数のまま数えるが、
 *                 提出済み・一部提出・未提出の判定へは混ぜない＝勝手な統合・削除をしない）
 *   未設定日（対象期間内に希望データが存在しない日）は出勤不可へ変換せず、未回答のまま扱う。
 *
 * 期限後:
 *   対象期間の現在の回答にafter_deadline=trueが1件以上あれば、その従業員をhas_late_submission=trueと
 *   する。競合日（同じ営業日に複数行）でも、その日に含まれる全行のafter_deadlineを確認する対象に
 *   含める（競合と期限後は排他的な状態ではない。レビュー対応 2026-09-22、指摘1）。現在時刻からの
 *   再計算はしない（保存時点でI列へ書き込まれた値をそのまま使う）。
 *
 * シート読み込み回数:
 *   getEmployees()・getAllShiftWishRows_()をそれぞれ1回だけ呼び、対象期間内のデータだけを
 *   メモリ上で従業員ごと・日付ごとに集計する。従業員ごとにgetEmployeeWishPeriodDataを
 *   繰り返し呼ばない（最小仕様7章のとおり）。
 *
 * 表示専用のためシートへは一切書き込まない。希望IDの変更・重複データの自動修復も行わない。
 */
function getEmployeeWishSubmissionStatus(year, month, period) {
  var yearNum = Number(year)
  var monthNum = Number(month)
  if (!isValidWishYearMonth_(yearNum, monthNum)) {
    return { success: false, message: '対象年月が不正です' }
  }
  if (!isValidWishPeriod_(period)) {
    return { success: false, message: '対象期間（前半／後半）が不正です' }
  }

  var businessDates = resolveWishPeriodBusinessDates_(yearNum, monthNum, period)
  var targetDayCount = businessDates.length
  var periodDateKeySet = {}
  for (var p = 0; p <= businessDates.length - 1; p++) {
    periodDateKeySet[formatDateInputValueForSheet_(businessDates[p])] = true
  }

  // freee従業員一覧を1回だけ取得する。一覧に存在しないIDの希望データは集計に混ぜない
  var employees = getEmployees()
  var employeeIdSet = {}
  for (var e = 0; e <= employees.length - 1; e++) {
    employeeIdSet[String(employees[e].id)] = true
  }

  // 希望データを1回だけ取得し、対象期間内・freee在籍従業員の行だけを、従業員ID→日付キーで
  // グルーピングする（同じ従業員・同じ営業日に複数行あれば、そのままlengthが2以上になり、
  // 後続の判定で要確認として扱われる＝勝手な統合・削除をしない）
  var allWishes = getAllShiftWishRows_()
  var wishesByEmpAndDate = {} // { empId: { dateKey: [wish, ...] } }
  for (var w = 0; w <= allWishes.length - 1; w++) {
    var wish = allWishes[w]
    if (!employeeIdSet[wish.employee_id]) continue
    if (!wish.business_date) continue
    var dateKey = formatDateInputValueForSheet_(wish.business_date)
    if (!periodDateKeySet[dateKey]) continue
    if (!wishesByEmpAndDate[wish.employee_id]) wishesByEmpAndDate[wish.employee_id] = {}
    if (!wishesByEmpAndDate[wish.employee_id][dateKey]) wishesByEmpAndDate[wish.employee_id][dateKey] = []
    wishesByEmpAndDate[wish.employee_id][dateKey].push(wish)
  }

  var counts = { complete: 0, partial: 0, none: 0, late: 0, conflict: 0 }
  var employeeStatuses = []

  for (var i = 0; i <= employees.length - 1; i++) {
    var emp = employees[i]
    var empId = String(emp.id)
    var wishesByDate = wishesByEmpAndDate[empId] || {}

    var answeredDayCount = 0
    var conflictDateCount = 0
    var hasLateSubmission = false

    for (var d = 0; d <= businessDates.length - 1; d++) {
      var key = formatDateInputValueForSheet_(businessDates[d])
      var wishesOnDate = wishesByDate[key] || []
      if (wishesOnDate.length === 0) continue // 未設定日は未回答のまま（出勤不可へ変換しない）
      answeredDayCount++ // 行が1件でも複数件でも、この日は一意の日付として1日分だけ数える

      // 競合と期限後は排他的な状態ではない（レビュー対応 2026-09-22、指摘1）。その日の行が
      // 1件でも複数件でも、含まれる全行のafter_deadlineを先に確認してからconflictのcontinueへ
      // 進む。いずれか1件が厳密にtrueならhas_late_submissionをtrueにする（統合・削除はしない）
      for (var wd = 0; wd <= wishesOnDate.length - 1; wd++) {
        if (wishesOnDate[wd].after_deadline === true) hasLateSubmission = true
      }

      if (wishesOnDate.length > 1) {
        conflictDateCount++
        continue // 一意に判定できない日はstatus判定の対象からも外す（どちらが正なのか分からないため）
      }
    }

    var status
    if (conflictDateCount > 0) {
      status = 'conflict'
      counts.conflict++
    } else if (answeredDayCount === targetDayCount) {
      status = 'complete'
      counts.complete++
    } else if (answeredDayCount === 0) {
      status = 'none'
      counts.none++
    } else {
      status = 'partial'
      counts.partial++
    }
    if (hasLateSubmission) counts.late++

    employeeStatuses.push({
      employee_id: empId,
      employee_name: emp.display_name,
      status: status,
      answered_day_count: answeredDayCount,
      target_day_count: targetDayCount,
      remaining_day_count: targetDayCount - answeredDayCount,
      has_late_submission: hasLateSubmission,
      conflict_date_count: conflictDateCount
    })
  }

  // 並び順: 要確認 → 未提出 → 一部提出 → 提出済み。同じ状態内はgetEmployees()が返した順を維持する
  // （Array.prototype.sortの安定ソートに依存する。氏名等による独自の並び替えはしない）
  var statusOrder = { conflict: 0, none: 1, partial: 2, complete: 3 }
  employeeStatuses.sort(function (a, b) {
    return statusOrder[a.status] - statusOrder[b.status]
  })

  return {
    success: true,
    year: yearNum,
    month: monthNum,
    period: period,
    target_day_count: targetDayCount,
    deadline_ms: calcWishSubmissionDeadlineMs_(yearNum, monthNum, period),
    counts: counts,
    employees: employeeStatuses
  }
}
