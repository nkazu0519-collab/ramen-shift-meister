/**
 * 営業日区分（平日／休日前／休日）の自動判定
 * 内閣府公表済みの国民の祝日・休日データをローカル定数として持つ（CalendarAppや外部APIは使わない）
 * 対応範囲は2026年・2027年のみ。範囲外の日付は平日扱いにせず、明確なエラーを返す
 */
var NATIONAL_HOLIDAYS_ = {
  '2026-01-01': true, '2026-01-12': true, '2026-02-11': true, '2026-02-23': true,
  '2026-03-20': true, '2026-04-29': true, '2026-05-03': true, '2026-05-04': true,
  '2026-05-05': true, '2026-05-06': true, '2026-07-20': true, '2026-08-11': true,
  '2026-09-21': true, '2026-09-22': true, '2026-09-23': true, '2026-10-12': true,
  '2026-11-03': true, '2026-11-23': true,
  '2027-01-01': true, '2027-01-11': true, '2027-02-11': true, '2027-02-23': true,
  '2027-03-21': true, '2027-03-22': true, '2027-04-29': true, '2027-05-03': true,
  '2027-05-04': true, '2027-05-05': true, '2027-07-19': true, '2027-08-11': true,
  '2027-09-20': true, '2027-09-23': true, '2027-10-11': true, '2027-11-03': true,
  '2027-11-23': true
}

var SUPPORTED_HOLIDAY_YEARS_ = [2026, 2027]

function isSupportedHolidayYear_(year) {
  return SUPPORTED_HOLIDAY_YEARS_.indexOf(year) >= 0
}

/**
 * "YYYY-MM-DD"形式の日付文字列がカレンダー上に実在する日付かを確認する純粋関数
 * new Date(year, month-1, day)は月・日の繰り上がりを暗黙に許容するため、逆変換して一致するかで確認する
 */
function isValidDateStr_(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  var parts = dateStr.split('-')
  var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2])
  var date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/**
 * "YYYY-MM-DD"形式のキー文字列を作る（月・日は2桁ゼロ埋め）。NATIONAL_HOLIDAYS_のキーと対応させる
 */
function formatDateKey_(dateObj) {
  var m = dateObj.getMonth() + 1
  var d = dateObj.getDate()
  return dateObj.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d)
}

/**
 * 指定日が土曜・日曜・国民の祝日/休日のいずれかかを判定する純粋関数（ローカルテストしやすいよう分離）
 */
function isWeekendOrHoliday_(dateObj) {
  var dow = dateObj.getDay()
  if (dow === 0 || dow === 6) return true
  return NATIONAL_HOLIDAYS_.hasOwnProperty(formatDateKey_(dateObj))
}

/**
 * 営業日の日付から「平日／休日前／休日」を判定する純粋関数
 * 優先順位: 1.当日が休日 → 休日／2.翌日が休日 → 休日前／3.それ以外 → 平日
 * 「当日が休日」を最優先で判定するため、土曜日を「翌日が日曜だから休日前」とは判定しない
 * （選択営業日は11:00〜翌3:00だが、判定はbusinessDateObj自体の日付だけを基準にする。時刻は見ない）
 */
function determineBusinessDayType_(businessDateObj) {
  if (isWeekendOrHoliday_(businessDateObj)) return '休日'
  var nextDate = new Date(businessDateObj.getFullYear(), businessDateObj.getMonth(), businessDateObj.getDate() + 1)
  if (isWeekendOrHoliday_(nextDate)) return '休日前'
  return '平日'
}

/**
 * 日付文字列(YYYY-MM-DD)から営業日区分を自動判定して返す（判定通信・postShiftEntryの両方から呼ばれる）
 * 不正な日付、または祝日データの対応範囲外（NATIONAL_HOLIDAYS_で扱う年以外）は、
 * 平日扱いにせずsuccess:falseのエラー結果を返す。呼び出し元はこれを見てシフト登録・判定を止める
 */
function getBusinessDayType(businessDateStr) {
  if (!isValidDateStr_(businessDateStr)) {
    return { success: false, message: '営業日の日付が不正です' }
  }
  var businessDate = parseFormDate_(businessDateStr)
  var nextDate = new Date(businessDate.getFullYear(), businessDate.getMonth(), businessDate.getDate() + 1)
  if (!isSupportedHolidayYear_(businessDate.getFullYear()) || !isSupportedHolidayYear_(nextDate.getFullYear())) {
    return {
      success: false,
      message: '祝日データが未対応です（対応年: ' + SUPPORTED_HOLIDAY_YEARS_.join('年・') + '年）'
    }
  }
  var dayType = determineBusinessDayType_(businessDate)
  return {
    success: true,
    day_type: dayType,
    message: '営業日区分を自動判定しました（' + dayType + '）'
  }
}

/**
 * フォームの日付文字列("YYYY-MM-DD")からその日のDateオブジェクトを作る
 */
function parseFormDate_(dateStr) {
  var parts = dateStr.split('-')
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

/**
 * フォームの時刻文字列("HH:MM")からDateオブジェクトを作る（日付部分はダミー、時分だけ使う）
 */
function parseFormTime_(timeStr) {
  var parts = timeStr.split(':')
  return new Date(1970, 0, 1, Number(parts[0]), Number(parts[1]))
}

/**
 * "HH:MM"形式かつ00〜23時・毎時0分だけを許可する正規表現
 * ':'分割のみの判定では"12:00:30"（秒つき）が"12:00"扱いですり抜けたり、"24:00"のような
 * 範囲外の時が通ったりするため、形式と範囲の両方を1つの正規表現で厳密に固定する
 */
var ON_THE_HOUR_TIME_PATTERN_ = /^([01]\d|2[0-3]):00$/

/**
 * 時刻文字列が"00:00"〜"23:00"の毎時0分ちょうどかを厳密に判定する
 * 休憩可能性判定は1時間単位の候補枠を前提とするため、シフトの開始・終了も1時間単位に揃える
 */
function isOnTheHourTimeStr_(timeStr) {
  return typeof timeStr === 'string' && ON_THE_HOUR_TIME_PATTERN_.test(timeStr)
}

/**
 * シフトの実際の開始・終了日時を求める（深夜勤務の日跨ぎに対応）
 * 企画書のルール：入力した日付を出勤日とし、終了時刻が開始時刻以下なら翌日の終了時刻として扱う
 */
function getShiftDateTimeRange_(dateObj, startTimeObj, endTimeObj) {
  var start = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(),
    startTimeObj.getHours(), startTimeObj.getMinutes())
  var end = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(),
    endTimeObj.getHours(), endTimeObj.getMinutes())
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000) // 翌日の時刻として扱う
  }
  return { start: start, end: end }
}

/**
 * 時間に関する3つの概念を別々に扱う。
 *
 * 営業時間: 店舗が営業する時間。シフト登録・営業日別表示との重なり判定に使う。
 * 勤務時間: 従業員ごとの予定シフトそのもの。固定の共通範囲は設けず、営業時間と少しでも
 *   重なる勤務を現行どおり登録対象とする（開店前準備・閉店後作業を切り捨てないため）。
 * 判定対象時間: 人数・持ち場・休憩可能性を調べる時間。現時点では営業時間と同じだが、
 *   もくもく会の回答後に独立して変更できるよう、営業時間とは別の定数にする。
 */
var BUSINESS_OPEN_HOUR_ = 11
var BUSINESS_HOUR_COUNT_ = 16 // 当日11:00〜翌3:00
var SHIFT_JUDGE_START_HOUR_ = 11
var SHIFT_JUDGE_SLOT_COUNT_ = 16 // 当日11:00〜翌3:00を1時間ごとに16枠

/**
 * 時刻のラベルを作る（24時以降は「翌」を付ける）
 */
function formatSlotHourLabel_(hourOffset) {
  if (hourOffset < 24) return hourOffset + ':00'
  return '翌' + (hourOffset - 24) + ':00'
}

/**
 * 選択した営業日の開始・終了日時を求める（開始: 選択日11:00、終了: 翌日3:00、合計16時間）
 */
function getBusinessDayRange_(businessDateObj) {
  var start = new Date(businessDateObj.getFullYear(), businessDateObj.getMonth(), businessDateObj.getDate(), BUSINESS_OPEN_HOUR_, 0)
  var end = new Date(start.getTime() + BUSINESS_HOUR_COUNT_ * 60 * 60 * 1000)
  return { start: start, end: end }
}

/**
 * 予定勤務が対象営業日の営業時間と少しでも重なるかを判定する。
 * 勤務全体を営業時間内へ制限しないことを、登録・変更処理に共通する明示的な仕様とする。
 */
function doesShiftOverlapBusinessHours_(shiftStartMs, shiftEndMs, businessDateObj) {
  var businessRange = getBusinessDayRange_(businessDateObj)
  return shiftStartMs < businessRange.end.getTime()
    && businessRange.start.getTime() < shiftEndMs
}

/**
 * 選択営業日と開始時刻から、実際の勤務開始日（シート「日付」列に保存する値）を求める
 * 開始時刻が0:00〜2:00なら営業日の翌日、それ以外（3:00〜23:00）は営業日当日とする
 * （営業日は「当日11:00〜翌3:00」の範囲のため、深夜0〜2時台に開始する勤務は必ず翌カレンダー日になる）
 * postShiftEntry（新規登録）・updateShiftEntry（変更）の両方から呼ばれ、日付の導出規則を統一する
 */
function resolveShiftStartDate_(businessDateObj, startTimeStr) {
  var startHour = Number(startTimeStr.split(':')[0])
  if (startHour >= 0 && startHour <= 2) {
    return new Date(businessDateObj.getFullYear(), businessDateObj.getMonth(), businessDateObj.getDate() + 1)
  }
  return businessDateObj
}

/**
 * 従業員希望シフト一括提出（07_ブラッシュアップ/02_企画・設計/従業員希望シフト一括提出_最小仕様.md）:
 * 対象月の「前半（1〜15日）／後半（16日〜月末）」の締切・期限後判定。
 *
 * 締切:
 *   前半の締切: 前月15日23:59（Asia/Tokyo）
 *   後半の締切: 前月20日23:59（Asia/Tokyo）
 * 23:59台までは期限内、翌日0:00以降は期限後。1月分では前年12月を正しく求める。
 * appsscript.jsonのtimeZoneがAsia/Tokyoに設定済みのため、GAS実行環境のnew Date(y, m-1, d, h, mi)は
 * そのまま日本時間として扱える（既存のbusiness_day.gs内の他関数と同じ流儀）。
 * 現在時刻（nowMs）は呼び出し元から明示的に受け取る純粋関数にし、自動テストから固定できるようにする
 * （このファイル内に「今の時刻」を暗黙に読む処理を置かない）。
 */
/**
 * 「今の時刻」をミリ秒で返す唯一の入口。締切・期限後判定に使う「現在時刻」はこの関数を経由させ、
 * コード内で直接new Date()を呼ぶ箇所を作らない。自動テストはこの関数を差し替えるだけで、
 * 締切ロジック（isWishSubmissionAfterDeadline_等）自体を再実装せずに任意の時刻を注入できる
 */
function getCurrentTimeMs_() {
  return new Date().getTime()
}

var WISH_PERIOD_FIRST_HALF_ = 'first_half'   // 1〜15日
var WISH_PERIOD_SECOND_HALF_ = 'second_half' // 16日〜月末

function isValidWishPeriod_(period) {
  return period === WISH_PERIOD_FIRST_HALF_ || period === WISH_PERIOD_SECOND_HALF_
}

/**
 * 対象年月(year, 1-12のmonth)・前半/後半から、その期間の締切日時（23:59:59.999まで＝期限内の最終ミリ秒）を返す。
 * 前月を求める際、1月分は自動的に前年12月になる（new Dateの月フィールドは0=1月なので、month-1-1で
 * 前月の0始まり月を作り、そのままnew Dateへ渡せば年の繰り下がりも自動的に処理される）
 */
function calcWishSubmissionDeadlineMs_(year, month, period) {
  var prevMonthDate = new Date(year, month - 1 - 1, 1) // 対象月の前月1日（年跨ぎも自動処理）
  var deadlineDay = period === WISH_PERIOD_FIRST_HALF_ ? 15 : 20
  var deadline = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), deadlineDay, 23, 59, 59, 999)
  return deadline.getTime()
}

/**
 * nowMsが締切を過ぎているか（期限後かどうか）を判定する純粋関数。
 * 23:59:59.999までは期限内、翌日0:00.000以降（=deadlineMsを1ms でも超えた時点）は期限後
 */
function isWishSubmissionAfterDeadline_(year, month, period, nowMs) {
  var deadlineMs = calcWishSubmissionDeadlineMs_(year, month, period)
  return nowMs > deadlineMs
}

/**
 * 対象年月・前半/後半から、対象営業日（Dateオブジェクト、時刻は0時）の配列を返す。
 * 前半は1〜15日、後半は16日〜月末（月ごとに28〜31日と可変のため、翌月1日の前日として月末を求める）
 */
function resolveWishPeriodBusinessDates_(year, month, period) {
  var dates = []
  if (period === WISH_PERIOD_FIRST_HALF_) {
    for (var d = 1; d <= 15; d++) {
      dates.push(new Date(year, month - 1, d))
    }
    return dates
  }
  var lastDayOfMonth = new Date(year, month, 0).getDate() // 翌月0日=当月の最終日
  for (var d2 = 16; d2 <= lastDayOfMonth; d2++) {
    dates.push(new Date(year, month - 1, d2))
  }
  return dates
}
