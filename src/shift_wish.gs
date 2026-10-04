/**
 * 希望シフト機能: 店主が従業員から聞いた希望時間を先に登録し、時間軸の薄いバーから押して
 * 勤務（シフト予定シート）を登録できるようにする。希望自体は「暫定運用」の入力データであり、
 * 従業員本人用の画面・ログイン・承認/通知は今回のスコープ外（AGENTS.mdの現行スコープ外）。
 *
 * データ設計:
 *   - 希望シフトは専用シート「希望シフト」で管理する（シフト予定シートとは別データ）。
 *     行番号を恒久的な関連付けに使わないため、希望ID（Utilities.getUuid()）を主キーにする。
 *   - シフト予定シートにF列「希望ID」を追加する。希望から登録した勤務だけがこの列に値を持ち、
 *     従来どおり直接登録した勤務（希望IDなし）は空欄のままになる。
 *     既存の5列読み取り処理（shift.gs）はF列を読まないため、この列追加による影響はない。
 *   - 希望シフトは勤務登録後も削除せず、状態列（status）で「未登録」→「登録済み」に変える
 *     （表示だけ隠す。既存の隣接結合・削除の見直しがあっても希望データ自体は残る）。
 *
 * 「登録済みかどうか」の正データ（レビュー対応 2026-09-15）:
 *   状態列（status）は表示上の補助情報であり、判定の正データとしては扱わない。
 *   希望が実際に勤務登録済みかどうかは、常にシフト予定シート側にその希望IDを持つ行が
 *   実在するか（shift.gsのfindShiftEntryByWishId_）で判定する。これは、勤務の書き込みと
 *   希望シート側の状態更新が別々の書き込み操作であるため、後者だけが失敗した場合に
 *   状態列と実態が食い違うことがあるため（postShiftEntryFromWish・deleteShiftEntryの
 *   コメントを参照）。状態列自体は書き込みを試みるが、その失敗は呼び出し元の成否に
 *   影響させない（try/catchで握りつぶす）。
 *   この希望ID実在確認は、希望自体の修正・変更可否（updateShiftWish・deleteShiftWish・
 *   postShiftEntryFromWishの二重登録防止）の判定に使う。一方、店主画面の時間軸で
 *   希望バーを表示するかどうか（getShiftWishesForBusinessDate）は、店主希望導線整理
 *   （2026-09-24）以降、希望IDの有無に関わらず「同じ従業員が対象営業日に勤務を持つか」
 *   （getEmployeeIdsWithShiftOnBusinessDate_）で判定する。両者は目的が異なる別の判定であり、
 *   どちらも希望データ自体を書き換えない表示・検証専用の判定である。
 *
 * 列拡張（従業員希望シフト一括提出、2026-09-21。詳細は07_ブラッシュアップ/02_企画・設計/
 * 従業員希望シフト一括提出_最小仕様.mdおよびemployee_shift_wish.gs）:
 *   既存A〜F列（希望ID／従業員ID／対象営業日／開始日時／終了日時／状態）は意味・順序とも
 *   変更しない。右側へG列「回答区分」（時間希望／出勤不可）・H列「最終提出日時」・
 *   I列「期限後フラグ」を追加した。
 *   - G列が空欄でD・EがDateなら「時間希望」として扱う（既存6列データの後方互換）。
 *   - 出勤不可（G列=出勤不可）はD・E（開始・終了日時）を空欄にする。時刻を持たない
 *     明示的な回答であり、未提出とは別データとして保存する。
 *   - 既存行のH・I列の空欄は、それぞれ「不明」「期限内」として扱う（後から閲覧しただけで
 *     期限後へ変えない。既存表示を壊さない）。
 *   getAllShiftWishRows_は出勤不可行を時刻がないという理由だけで捨てない（start_ms/end_msは
 *   出勤不可の場合nullになる）。店主画面の時間軸（getShiftWishesForBusinessDate）は
 *   answer_type === '時間希望'の行だけを対象にする（出勤不可は時間軸バーとして表示しない）。
 *   店主操作（postShiftWish・updateShiftWish等）は常に時間希望だけを作るため、
 *   start_ms/end_msを使う既存の重複確認処理は、事前にanswer_typeで時間希望へ絞り込む。
 */
var SHEET_NAME_SHIFT_WISH = '希望シフト'

var SHIFT_WISH_STATUS_OPEN_ = '未登録'
var SHIFT_WISH_STATUS_FULFILLED_ = '登録済み'

var SHIFT_WISH_ANSWER_TYPE_TIME_ = '時間希望'
var SHIFT_WISH_ANSWER_TYPE_UNAVAILABLE_ = '出勤不可'

var WISH_SHEET_EXTENDED_HEADERS_ = ['回答区分', '最終提出日時', '期限後フラグ'] // G〜I列の期待見出し

/**
 * 「希望シフト」シートを取得する。存在しない場合はヘッダー付きで新規作成する
 * （初回実行時の自動セットアップ。既存シートがある場合は何もせずそのまま返すため、
 * 既存データを消去・上書きする初期化処理にはならない）。
 * 新規作成時はG〜I列（回答区分／最終提出日時／期限後フラグ）まで含めた9列ヘッダーにする
 *
 * 既存シート（レビュー対応 2026-09-22、指摘4）:
 *   既存シートがある場合、A〜F列と既存データは一切変更しない。G1〜I1（回答区分／最終提出日時／
 *   期限後フラグ）が空欄なら、その見出しだけを補う安全な移行を行う（既に9列でG〜Iが
 *   期待どおりならデータそのままで、余計な書き込みはしない）。G1〜I1のいずれかに、
 *   期待する見出し文字列と異なる非空の値が既に入っている場合は、他人のデータを黙って
 *   上書きしないよう、見出しを書かずに明確なエラーをthrowする（呼び出し元のtry/catch任せにせず、
 *   ここで気付けるようにする）。
 */
function getOrCreateShiftWishSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(SHEET_NAME_SHIFT_WISH)
  if (sheet) {
    ensureShiftWishSheetExtendedHeaders_(sheet)
    return sheet
  }
  sheet = ss.insertSheet(SHEET_NAME_SHIFT_WISH)
  sheet.getRange(1, 1, 1, 9).setValues([[
    '希望ID', '従業員ID', '対象営業日', '開始日時', '終了日時', '状態',
    '回答区分', '最終提出日時', '期限後フラグ'
  ]])
  return sheet
}

/**
 * 既存の「希望シフト」シートのG1〜I1見出しを、安全な場合だけ補う。
 * - シートの列数が6以下（G列自体がまだない）場合は、G1〜I1へ期待見出しを新規に書き込む。
 * - 列数が7以上ある場合は、G1〜I1のうち空欄の列だけを期待見出しで埋める。
 * - 空欄でない列に、期待する見出し文字列と異なる値が入っている場合は、データ保護のため
 *   書き込みを一切行わずエラーをthrowする（別用途で使われている列を誤って上書きしないため）。
 * - 既にG1〜I1が期待どおりなら何もしない（読み込みのたびに不要な書き込みをしない）。
 */
function ensureShiftWishSheetExtendedHeaders_(sheet) {
  var lastCol = sheet.getLastColumn()
  var currentHeaders = lastCol >= 7 ? sheet.getRange(1, 7, 1, Math.min(3, lastCol - 6)).getValues()[0] : []
  while (currentHeaders.length < 3) currentHeaders.push('')

  var needsWrite = false
  for (var i = 0; i <= 2; i++) {
    var current = currentHeaders[i]
    var expected = WISH_SHEET_EXTENDED_HEADERS_[i]
    if (current === '' || current === undefined || current === null) {
      needsWrite = true
    } else if (current !== expected) {
      throw new Error(
        '希望シフトシートの' + String.fromCharCode(71 + i) + '1に、想定と異なる見出し「' + current
        + '」が既に入っているため、自動では書き換えません。シートの内容を確認してください'
      )
    }
  }
  if (!needsWrite) return

  sheet.getRange(1, 7, 1, 3).setValues([WISH_SHEET_EXTENDED_HEADERS_])
}

/**
 * 希望シフトシートのデータ部分（2行目以降）を、A〜I列そのままの生の値（型変換なし、行の
 * 意味解釈なし）で返す。1回のsetValuesで全体を書き戻すための土台として使う
 * （従業員希望シフト一括提出のsubmitEmployeeShiftWishesBulk専用。getAllShiftWishRows_のように
 * 不正行を無視したり列数を解釈したりしない。シートの実際の列数が9未満でも、この関数は
 * 常に9列ぶんの配列を返す＝存在しない列は空文字で埋め、書き戻し時に列を減らさない）。
 * 行は1件ずつ{ sheetRow, values }の形で返す（sheetRowは呼び出し直後だけ有効な位置情報）。
 */
function getShiftWishSheetRawRows_(sheet) {
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var last_col = Math.max(sheet.getLastColumn(), 9)
  var values = sheet.getRange(2, 1, last_row - 1, last_col).getValues()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i].slice(0, 9)
    while (row.length < 9) row.push('')
    list.push({ sheetRow: i + 2, values: row })
  }
  return list
}

/**
 * 希望シフトシートの全行を、型変換済みのオブジェクト配列として返す（表示整形はしない）
 * 行番号はsheetRowとして持たせる（希望IDが正データ、sheetRowはその時点のシート走査用の値）
 *
 * 後方互換: 既存6列データ（G〜I列が存在しない、または空欄）も読める。
 *   - answer_type: G列が'出勤不可'ならそれを採用。それ以外（空欄含む）でD・EがDateなら
 *     '時間希望'として扱う。D・Eのいずれかが欠けていて出勤不可でもない行は不正データとして無視する。
 *   - start_ms/end_ms: 時間希望はD・Eから求めた実ミリ秒。出勤不可はnull（時刻を持たない）。
 *   - last_submitted_ms: H列がDateならそのミリ秒、空欄ならnull（不明）。
 *   - after_deadline: I列がtrueならtrue、それ以外（空欄含む）はfalse（期限内扱い）。
 */
function getAllShiftWishRows_() {
  var sheet = getOrCreateShiftWishSheet_()
  var last_row = sheet.getLastRow()
  if (last_row < 2) return []
  var last_col = Math.max(sheet.getLastColumn(), 6)
  var values = sheet.getRange(2, 1, last_row - 1, last_col).getValues()
  var list = []
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    if (!row[0]) continue // 希望IDが空の行は不正データとして無視する

    var rawAnswerType = last_col >= 7 ? row[6] : ''
    var hasTimeRange = (row[3] instanceof Date) && (row[4] instanceof Date)
    var answerType
    if (rawAnswerType === SHIFT_WISH_ANSWER_TYPE_UNAVAILABLE_) {
      answerType = SHIFT_WISH_ANSWER_TYPE_UNAVAILABLE_
    } else if (rawAnswerType === SHIFT_WISH_ANSWER_TYPE_TIME_) {
      if (!hasTimeRange) continue // 時間希望のはずがD・Eを欠いている不正データは無視する
      answerType = SHIFT_WISH_ANSWER_TYPE_TIME_
    } else if (hasTimeRange) {
      // 既存6列データ（G列が存在しない／空欄）。D・EがDateなら時間希望として扱う（後方互換）
      answerType = SHIFT_WISH_ANSWER_TYPE_TIME_
    } else {
      continue // 回答区分不明かつ時刻もない行は不正データとして無視する
    }

    var lastSubmittedRaw = last_col >= 8 ? row[7] : null
    var afterDeadlineRaw = last_col >= 9 ? row[8] : false

    list.push({
      sheetRow: i + 2,
      wish_id: String(row[0]),
      employee_id: String(row[1]),
      business_date: row[2] instanceof Date ? row[2] : null,
      answer_type: answerType,
      start_ms: answerType === SHIFT_WISH_ANSWER_TYPE_TIME_ ? row[3].getTime() : null,
      end_ms: answerType === SHIFT_WISH_ANSWER_TYPE_TIME_ ? row[4].getTime() : null,
      status: row[5] || SHIFT_WISH_STATUS_OPEN_,
      last_submitted_ms: lastSubmittedRaw instanceof Date ? lastSubmittedRaw.getTime() : null,
      after_deadline: afterDeadlineRaw === true
    })
  }
  return list
}

/**
 * 希望シフトを1件登録する（店主が従業員から聞いた内容を入力する）
 * 開始・終了は毎時0分、最低3時間、選択営業日の営業時間との重なりをpostShiftEntryと同じ規則で検証する。
 * 分割勤務の登録は対象外のため、隣接結合（planShiftMerge_）は使わず単純な重複確認のみ行う
 * （希望はまだ勤務ではないため、既存シフトとの結合対象にはしない）
 */
function postShiftWish(form) {
  if (!form.employee_id) {
    return { success: false, message: '従業員を選択してください' }
  }
  if (!form.start_time || !form.end_time) {
    return { success: false, message: '開始・終了時刻は必須です' }
  }
  if (!form.business_date) {
    return { success: false, message: '営業日が特定できません。画面を再読み込みしてください' }
  }
  if (!isOnTheHourTimeStr_(form.start_time) || !isOnTheHourTimeStr_(form.end_time)) {
    return { success: false, message: '開始・終了時刻は毎時0分（1時間単位）で入力してください' }
  }

  var businessDateObj = parseFormDate_(form.business_date)
  var shiftDateObj = resolveShiftStartDate_(businessDateObj, form.start_time)
  var range = getShiftDateTimeRange_(
    shiftDateObj,
    parseFormTime_(form.start_time),
    parseFormTime_(form.end_time)
  )
  var durationMs = range.end.getTime() - range.start.getTime()
  if (durationMs < SHIFT_MIN_DURATION_MS) {
    return { success: false, message: '希望シフトは3時間以上で入力してください' }
  }
  var withinBusinessDay = doesShiftOverlapBusinessHours_(range.start.getTime(), range.end.getTime(), businessDateObj)
  if (!withinBusinessDay) {
    return { success: false, message: '希望時間が選択中の営業日（11:00〜翌3:00）の範囲外です' }
  }

  var empId = form.employee_id

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    // 重複確認の対象は時間希望だけにする（出勤不可は時刻を持たないため重複しようがない。
    // 従業員側の一括提出で追加された出勤不可行をここで誤って比較しないようにする）
    var existingWishes = getAllShiftWishRows_().filter(function (w) {
      return w.employee_id === String(empId) && w.answer_type === SHIFT_WISH_ANSWER_TYPE_TIME_
    })
    for (var i = 0; i <= existingWishes.length - 1; i++) {
      var w = existingWishes[i]
      if (range.start.getTime() < w.end_ms && w.start_ms < range.end.getTime()) {
        return { success: false, message: '同じ従業員の希望シフトが既存の希望と重複しています' }
      }
    }

    var sheet = getOrCreateShiftWishSheet_()
    var wishId = Utilities.getUuid()
    var targetRow = sheet.getLastRow() + 1
    sheet.getRange(targetRow, 1, 1, 9).setValues([[
      wishId, empId, businessDateObj, range.start, range.end, SHIFT_WISH_STATUS_OPEN_,
      SHIFT_WISH_ANSWER_TYPE_TIME_, '', false
    ]])
    return { success: true, message: '希望シフトを登録しました', wish_id: wishId }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 店主画面の時間軸表示用：選択した営業日と重なる希望シフトを返す（未登録のものだけ）
 * 「未登録」は希望シートの状態列ではなく、同じ従業員が対象営業日に勤務を持っているか
 * （getEmployeeIdsWithShiftOnBusinessDate_）で判定する。希望ID付きの勤務（希望から登録した
 * 勤務）だけでなく、店主が直接登録した勤務（希望IDなし）も対象に含める（店主希望導線整理
 * 2026-09-24：同じ従業員・同じ対象営業日に勤務があれば、希望と勤務の時間が部分的にしか
 * 重ならない場合・重ならない場合も含めて希望バーを隠す。これは店主の時間軸の表示整理であり、
 * 希望時間全体が勤務に採用されたという意味ではない。希望データ自体は変更しない）。
 * 最後の該当勤務が削除されればgetEmployeeIdsWithShiftOnBusinessDate_の集合から外れ、
 * 次回の呼び出しで希望が自動的に再表示される（状態列の更新失敗の影響を受けない。
 * レビュー対応：状態列だけに依存すると、勤務削除後の状態更新に失敗した場合に希望が
 * 復活しない、逆に状態列が古いまま勤務が消えている場合に希望が出てこない、という食い違いが
 * 起きるため。シフト予定シートを正データとして扱えば、状態列の更新が失敗しても表示は壊れない）
 *
 * 読み込み回数の最適化（レビュー対応 2026-09-15、2026-09-24更新）:
 *   対象日と重ならない希望はシフト予定シートと照合するまでもなく除外できるため、先に
 *   businessDateとの重なりで絞り込む。その上で、対象日に希望が1件もなければシフト予定シートの
 *   読み込み自体を省略する。対象の希望が残る場合だけgetEmployeeIdsWithShiftOnBusinessDate_で
 *   シフト予定シートを1回だけ読み込み、対象営業日に勤務を持つ従業員の集合と照合する
 *   （希望ごとにシート全体を読み直すと、希望がN件あれば対象日に該当がなくても最大N回
 *   シートを読むことになるため）
 * 表示用のoffset_minutes・display_minutesは、既存のgetShiftEntriesForBusinessDateと
 * 同じ計算式（営業日開始からの経過分、はみ出しは切り詰め）を使い、時間軸の座標系を共通化する
 *
 * 出勤不可・期限後の扱い（従業員希望シフト一括提出 2026-09-21）:
 *   出勤不可（answer_type !== '時間希望'）は時間軸バーとして表示しない対象のため、
 *   最初のフィルタで時間希望だけに絞り込む（start_ms/end_msがnullの行を後続の比較に渡さない）。
 *   after_deadline（期限後フラグ）はそのまま戻り値へ含める。店主画面側（js_shift.html）は
 *   これを見て、期限後に新規提出・変更された時間希望のバーだけを薄い赤にする。バーへ
 *   「期限後」という文言は追加しない（既存の「希望」＋時刻表記は残す）。期限後だからという
 *   理由で並び替えたり、自動的な優先順位を付けたりしない（sortは従来どおり従業員ID→開始時刻のみ）
 */
function getShiftWishesForBusinessDate(businessDateStr) {
  var businessDate = parseFormDate_(businessDateStr)
  var businessRange = getBusinessDayRange_(businessDate)
  var businessStartMs = businessRange.start.getTime()
  var businessEndMs = businessRange.end.getTime()

  var overlappingWishes = getAllShiftWishRows_().filter(function (w) {
    return w.answer_type === SHIFT_WISH_ANSWER_TYPE_TIME_
      && w.start_ms < businessEndMs && businessStartMs < w.end_ms
  })
  if (overlappingWishes.length === 0) return []

  var employeeIdsWithShift = getEmployeeIdsWithShiftOnBusinessDate_(businessDate)
  var wishes = overlappingWishes.filter(function (w) {
    return !employeeIdsWithShift[w.employee_id]
  })

  var list = []
  for (var i = 0; i <= wishes.length - 1; i++) {
    var w = wishes[i]

    var startDate = new Date(w.start_ms)
    var endDate = new Date(w.end_ms)
    var startLabel = formatTimeJp_(startDate)
    if (!isSameCalendarDate_(startDate, businessDate)) startLabel = '翌' + startLabel
    var endLabel = formatTimeJp_(endDate)
    if (!isSameCalendarDate_(endDate, businessDate)) endLabel = '翌' + endLabel

    var clippedStartMs = Math.max(w.start_ms, businessStartMs)
    var clippedEndMs = Math.min(w.end_ms, businessEndMs)

    list.push({
      wish_id: w.wish_id,
      employee_id: w.employee_id,
      start_ms: w.start_ms,
      end_ms: w.end_ms,
      start_label: startLabel,
      end_label: endLabel,
      offset_minutes: Math.round((clippedStartMs - businessStartMs) / 60000),
      display_minutes: Math.round((clippedEndMs - clippedStartMs) / 60000),
      after_deadline: !!w.after_deadline
    })
  }
  list.sort(function (a, b) {
    if (a.employee_id != b.employee_id) return a.employee_id < b.employee_id ? -1 : 1
    return a.start_ms - b.start_ms
  })
  return list
}

/**
 * 希望IDから希望シフト1件を取得する（サーバー側の検証専用。wish_idが一致する最初の行を返す）
 */
function findShiftWishById_(wishId) {
  var wishes = getAllShiftWishRows_()
  for (var i = 0; i <= wishes.length - 1; i++) {
    if (wishes[i].wish_id === String(wishId)) return wishes[i]
  }
  return null
}

/**
 * 希望IDから、表示用に整形した希望シフト1件を返す（クライアント側で「元の希望時間」を
 * 表示するために使う。登録済みの希望も対象に含める点がgetShiftWishesForBusinessDateとの違い。
 * 見つからない場合はnullを返す。statusはシフト予定シート側の実在確認（findShiftEntryByWishId_）を
 * 正データとして組み立て直す（希望シートの状態列の更新失敗があっても表示が食い違わないようにする）
 */
function getShiftWishDisplayById(wishId) {
  var wish = findShiftWishById_(wishId)
  if (!wish) return null
  var startDate = new Date(wish.start_ms)
  var endDate = new Date(wish.end_ms)
  var startLabel = formatTimeJp_(startDate)
  if (!isSameCalendarDate_(startDate, wish.business_date)) startLabel = '翌' + startLabel
  var endLabel = formatTimeJp_(endDate)
  if (!isSameCalendarDate_(endDate, wish.business_date)) endLabel = '翌' + endLabel
  return {
    wish_id: wish.wish_id,
    employee_id: wish.employee_id,
    start_ms: wish.start_ms,
    end_ms: wish.end_ms,
    start_label: startLabel,
    end_label: endLabel,
    status: findShiftEntryByWishId_(wish.wish_id) ? SHIFT_WISH_STATUS_FULFILLED_ : SHIFT_WISH_STATUS_OPEN_
  }
}

/**
 * 希望シフトシート上のwish_id行の状態列（F列ではなく希望シート内のF列＝status）を書き換える
 * sheetRowは呼び出し時点のものを使うため、この関数の呼び出し元は必ずロック内でgetAllShiftWishRows_を
 * 取り直した直後に呼ぶこと（他の操作による行ずれの影響を避けるため）
 */
function setShiftWishStatus_(sheetRow, status) {
  var sheet = getOrCreateShiftWishSheet_()
  sheet.getRange(sheetRow, 6, 1, 1).setValue(status)
}

/**
 * 未登録の希望シフトを1件、修正する（開始・終了時刻のみ変更可。従業員・対象営業日は変更しない）
 * 勤務が登録済みの希望は直接変更できない仕様とし、サーバー側でも拒否する。
 * 「登録済みかどうか」は希望シートの状態列ではなく、シフト予定シート側の実在確認
 * （findShiftEntryByWishId_）を正データとして判定する（レビュー対応）
 *
 * 呼び出し元（店主希望導線整理・希望編集削除撤去 2026-09-24）:
 *   店主画面（js_shift_wish.html）の「希望を修正」ボタンを撤去したため、現在この関数を
 *   呼び出すクライアント側UIはない。希望の変更は従業員側「希望シフト提出」画面
 *   （submitEmployeeShiftWishesBulk）に一本化する方針のため。同関数は、勤務未登録の日なら
 *   既存回答を更新できるが、勤務登録済みの日は画面とサーバー保存の両方で変更を制限する。
 *   この関数自体は、既存互換性・データ層への影響を避けるため削除せず
 *   残している（テスト・仕様上の参照が残る、将来店主側の操作を復活させる可能性を残す判断）。
 */
function updateShiftWish(request) {
  if (!request || !request.wish_id) {
    return { success: false, message: '対象の希望シフトが見つかりません。画面を更新して再度お試しください' }
  }
  if (!request.start_time || !request.end_time) {
    return { success: false, message: '開始・終了時刻は必須です' }
  }
  if (!isOnTheHourTimeStr_(request.start_time) || !isOnTheHourTimeStr_(request.end_time)) {
    return { success: false, message: '開始・終了時刻は毎時0分（1時間単位）で入力してください' }
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var wish = findShiftWishById_(request.wish_id)
    if (!wish) {
      return { success: false, message: '対象の希望シフトが見つかりません。画面を更新して再度お試しください' }
    }
    if (wish.answer_type !== SHIFT_WISH_ANSWER_TYPE_TIME_) {
      // 出勤不可（従業員側の一括提出で登録される）は時刻を持たないため、店主用の時刻修正では扱わない
      return { success: false, message: 'この希望は時間の指定がないため、この画面では変更できません' }
    }
    if (findShiftEntryByWishId_(wish.wish_id)) {
      return { success: false, message: 'この希望はすでに勤務登録済みのため、直接変更できません。先に登録済みの勤務を削除してください' }
    }

    var shiftDateObj = resolveShiftStartDate_(wish.business_date, request.start_time)
    var range = getShiftDateTimeRange_(
      shiftDateObj,
      parseFormTime_(request.start_time),
      parseFormTime_(request.end_time)
    )
    var durationMs = range.end.getTime() - range.start.getTime()
    if (durationMs < SHIFT_MIN_DURATION_MS) {
      return { success: false, message: '希望シフトは3時間以上で入力してください' }
    }
    var withinBusinessDay = doesShiftOverlapBusinessHours_(range.start.getTime(), range.end.getTime(), wish.business_date)
    if (!withinBusinessDay) {
      return { success: false, message: '希望時間が選択中の営業日（11:00〜翌3:00）の範囲外です' }
    }

    // レビュー対応：重複確認は状態が未登録の希望だけでなく、登録済みの希望も含む同じ従業員の
    // 全希望を対象にする（対象は自分自身の希望IDだけ除外する）。登録済みの希望も時間帯としては
    // 現実に存在するため、変更後の時間がそれと重なるなら拒否しないと、二重に人員を見込むことになる。
    // 出勤不可行は時刻を持たないため比較対象から除く
    var otherWishes = getAllShiftWishRows_().filter(function (w) {
      return w.employee_id === wish.employee_id && w.wish_id !== wish.wish_id && w.answer_type === SHIFT_WISH_ANSWER_TYPE_TIME_
    })
    for (var i = 0; i <= otherWishes.length - 1; i++) {
      var w2 = otherWishes[i]
      if (range.start.getTime() < w2.end_ms && w2.start_ms < range.end.getTime()) {
        return { success: false, message: '同じ従業員の希望シフトが既存の希望と重複しています' }
      }
    }

    var sheet = getOrCreateShiftWishSheet_()
    sheet.getRange(wish.sheetRow, 4, 1, 2).setValues([[range.start, range.end]])
    return { success: true, message: '希望シフトを変更しました' }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 未登録の希望シフトを1件削除する。勤務登録済みの希望は削除できない。
 * 「登録済みかどうか」はシフト予定シート側の実在確認（findShiftEntryByWishId_）で判定する
 *
 * 呼び出し元（店主希望導線整理・希望編集削除撤去 2026-09-24）:
 *   店主画面（js_shift_wish.html）の「希望を削除」ボタンを撤去したため、現在この関数を
 *   呼び出すクライアント側UIはない。従業員側「希望シフト提出」画面にも新たな希望削除機能は
 *   追加していない（今回の依頼範囲外）。既存希望データは、勤務に採用されなかった場合でも
 *   保持されたままになる。この関数自体は、既存互換性・データ層への影響を避けるため削除せず
 *   残している。
 */
function deleteShiftWish(request) {
  if (!request || !request.wish_id) {
    return { success: false, message: '対象の希望シフトが見つかりません。画面を更新して再度お試しください' }
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var wish = findShiftWishById_(request.wish_id)
    if (!wish) {
      return { success: false, message: '対象の希望シフトが見つかりません。画面を更新して再度お試しください' }
    }
    if (findShiftEntryByWishId_(wish.wish_id)) {
      return { success: false, message: 'この希望はすでに勤務登録済みのため、直接削除できません。先に登録済みの勤務を削除してください' }
    }
    var sheet = getOrCreateShiftWishSheet_()
    sheet.deleteRow(wish.sheetRow)
    return { success: true, message: '希望シフトを削除しました' }
  } finally {
    lock.releaseLock()
  }
}

/**
 * 希望シフトから勤務（シフト予定シート）を1件登録する。
 * サーバー側で希望の存在・従業員一致・時間範囲（希望の範囲内）・登録済みかどうかを再検証する
 * （クライアントの入力を信用しない。二重クリックや並行操作でも、この関数をロック内で実行することで
 * 同じ希望から勤務が重複登録されないようにする）
 * 今回は1つの希望から1本の勤務だけを登録する（分割勤務は対象外）。
 * 希望に関連付いた勤務は、既存の隣接結合（planShiftMerge_）の対象にしない
 * （希望との1対1の関連付けを壊さないため。希望IDを持たない従来勤務同士の結合のみ維持する）
 *
 * レビュー対応（途中失敗時の整合性）:
 *   「登録済みかどうか」は希望シートの状態列ではなく、シフト予定シート側にその希望IDを持つ行が
 *   実在するか（findShiftEntryByWishId_）で判定する。これを勤務書き込みの直前にロック内で
 *   もう一度確認することで、以前の呼び出しで勤務の書き込みまでは成功したが状態列の更新に
 *   失敗していた場合でも、実在確認だけで二重登録を防げる（状態列の値には依存しない）。
 *   状態列の更新はUI表示の補助情報として書き込みを試みるが、その成否は戻り値のメッセージに
 *   影響させない（状態列の更新に失敗しても、勤務登録自体は成功として扱う。次回以降の
 *   「登録済みかどうか」判定は実在確認で行われるため、状態列が古いままでも表示は壊れない）
 */
function postShiftEntryFromWish(request) {
  if (!request || !request.wish_id) {
    return '対象の希望シフトが見つかりません。画面を更新して再度お試しください'
  }
  if (!request.start_time || !request.end_time) {
    return '開始・終了時刻は必須です'
  }
  if (!isOnTheHourTimeStr_(request.start_time) || !isOnTheHourTimeStr_(request.end_time)) {
    return '開始・終了時刻は毎時0分（1時間単位）で入力してください'
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var wish = findShiftWishById_(request.wish_id)
    if (!wish) {
      return '対象の希望シフトが見つかりません。画面を更新して再度お試しください'
    }
    if (wish.answer_type !== SHIFT_WISH_ANSWER_TYPE_TIME_) {
      // 出勤不可（従業員側の一括提出で登録される）は時刻を持たないため、ここから勤務登録できない
      return 'この希望は出勤不可のため、勤務を登録できません'
    }
    if (findShiftEntryByWishId_(wish.wish_id)) {
      return 'この希望はすでに勤務登録済みです。画面を更新して再度お試しください'
    }
    if (request.employee_id && String(request.employee_id) !== wish.employee_id) {
      return '従業員が希望と一致しません。画面を更新して再度お試しください'
    }

    var dayTypeResult = getBusinessDayType(formatDateInputValueForSheet_(wish.business_date))
    if (!dayTypeResult.success) {
      return dayTypeResult.message
    }

    var shiftDateObj = resolveShiftStartDate_(wish.business_date, request.start_time)
    var range = getShiftDateTimeRange_(
      shiftDateObj,
      parseFormTime_(request.start_time),
      parseFormTime_(request.end_time)
    )
    // 勤務時間は希望の範囲内でなければならない（例: 希望11〜19時に対して勤務12〜17時は可）
    if (range.start.getTime() < wish.start_ms || wish.end_ms < range.end.getTime()) {
      return '勤務時間は希望の範囲内で入力してください'
    }
    var durationMs = range.end.getTime() - range.start.getTime()
    if (durationMs < SHIFT_MIN_DURATION_MS) {
      return 'シフトは3時間以上で入力してください'
    }

    var empId = wish.employee_id
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SHIFT)
    // 希望からの登録は、既存勤務との重複だけを確認し、自動結合はしない
    // （希望IDとの1対1の関連付けを保つため。結合対象にすると、結合後の行がどの希望に
    // 対応するか分からなくなる）
    var existingEntries = getExistingShiftEntriesForEmployee_(sheet, empId, null)
    for (var i = 0; i <= existingEntries.length - 1; i++) {
      var e = existingEntries[i]
      if (range.start.getTime() < e.endMs && e.startMs < range.end.getTime()) {
        return '同じ従業員のシフトが既存の予定と重複しています'
      }
    }

    var shiftDateForSheet = new Date(shiftDateObj.getFullYear(), shiftDateObj.getMonth(), shiftDateObj.getDate())
    var startTimeForSheet = formatHourMinuteForSheet_(range.start)
    var endTimeForSheet = formatHourMinuteForSheet_(range.end)
    var targetRow = sheet.getLastRow() + 1
    sheet.getRange(targetRow, 1, 1, 6).setValues([[
      empId, shiftDateForSheet, startTimeForSheet, endTimeForSheet, dayTypeResult.day_type, wish.wish_id
    ]])

    // 勤務の書き込みはここで確定している。以降の希望シート側の状態列更新はUI表示の補助情報の
    // 書き込みに過ぎず、これが失敗しても勤務登録自体の成功を取り消さない（例外を握りつぶして
    // 処理を続ける）。次回以降「登録済みかどうか」を確認する側は状態列ではなくシフト予定シートの
    // 実在確認（findShiftEntryByWishId_）を使うため、この更新に失敗しても二重登録は起きない
    try {
      var freshWish = findShiftWishById_(wish.wish_id)
      if (freshWish) {
        setShiftWishStatus_(freshWish.sheetRow, SHIFT_WISH_STATUS_FULFILLED_)
      }
    } catch (e) {
      // 状態列の更新失敗は登録の成否に影響させない（上記コメントの通り）
    }

    return '登録しました'
  } finally {
    lock.releaseLock()
  }
}

/**
 * Dateオブジェクトから"YYYY-MM-DD"形式の文字列を作る（getBusinessDayTypeなど日付文字列を
 * 要求する既存関数へ、希望シートのDate型business_dateを渡すための変換）
 */
function formatDateInputValueForSheet_(dateObj) {
  var y = dateObj.getFullYear()
  var m = dateObj.getMonth() + 1
  var d = dateObj.getDate()
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d)
}
