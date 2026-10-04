// 従業員希望シフト一括提出の締切・期限後判定（business_day.gs）を、本番の.gsファイルを
// Node.jsのvmで直接読み込んで検証する。締切ロジックをこのファイルへ再実装しない
// （calcWishSubmissionDeadlineMs_・isWishSubmissionAfterDeadline_・resolveWishPeriodBusinessDates_を
// そのまま呼ぶ）。現在時刻はすべて呼び出し側の引数として明示的に渡すため、テストから固定できる。
//
// 実行: node wish_deadline_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var loader = require('./load_all_gs_')
var app = loader.loadAllGsIntoSandbox_().sandbox

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

function ms(y, m, d, h, mi) {
  return new Date(y, m - 1, d, h || 0, mi || 0).getTime()
}

// calcWishSubmissionDeadlineMs_は「期限内の最終ミリ秒」（23:59:59.999）を返す仕様のため、
// 締切そのものの期待値はこちらを使う
function deadlineMs(y, m, d) {
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}

console.log('検証対象: business_day.gs（従業員希望シフト一括提出の締切・期限後判定）')
console.log('---')

// ------------------------------------------------------------------
// 1. 前半（1〜15日）の締切は前月15日23:59
// ------------------------------------------------------------------
{
  var deadline1 = app.calcWishSubmissionDeadlineMs_(2026, 10, app.WISH_PERIOD_FIRST_HALF_)
  assertEqual(deadline1, deadlineMs(2026, 9, 15), '1. 2026年10月・前半の締切は2026-09-15 23:59')
}

// ------------------------------------------------------------------
// 2. 後半（16日〜月末）の締切は前月20日23:59
// ------------------------------------------------------------------
{
  var deadline2 = app.calcWishSubmissionDeadlineMs_(2026, 10, app.WISH_PERIOD_SECOND_HALF_)
  assertEqual(deadline2, deadlineMs(2026, 9, 20), '2. 2026年10月・後半の締切は2026-09-20 23:59')
}

// ------------------------------------------------------------------
// 3. 1月分の締切は前年12月を正しく求める（年跨ぎ）
// ------------------------------------------------------------------
{
  var deadline3a = app.calcWishSubmissionDeadlineMs_(2027, 1, app.WISH_PERIOD_FIRST_HALF_)
  assertEqual(deadline3a, deadlineMs(2026, 12, 15), '3a. 2027年1月・前半の締切は2026-12-15 23:59（前年12月）')
  var deadline3b = app.calcWishSubmissionDeadlineMs_(2027, 1, app.WISH_PERIOD_SECOND_HALF_)
  assertEqual(deadline3b, deadlineMs(2026, 12, 20), '3b. 2027年1月・後半の締切は2026-12-20 23:59（前年12月）')
}

// ------------------------------------------------------------------
// 4. 締切日23:59台は期限内、翌日0:00以降は期限後（境界値）
// ------------------------------------------------------------------
{
  var y = 2026, m = 10, period = app.WISH_PERIOD_FIRST_HALF_ // 締切: 2026-09-15 23:59
  assertTrue(!app.isWishSubmissionAfterDeadline_(y, m, period, ms(2026, 9, 15, 23, 0)), '4a. 締切日23:00は期限内')
  assertTrue(!app.isWishSubmissionAfterDeadline_(y, m, period, ms(2026, 9, 15, 23, 59)), '4b. 締切日23:59ちょうどは期限内')
  assertTrue(!app.isWishSubmissionAfterDeadline_(y, m, period, ms(2026, 9, 15, 23, 59) + 999), '4c. 締切日23:59:59.999（23:59台の最後のミリ秒）も期限内')
  assertTrue(app.isWishSubmissionAfterDeadline_(y, m, period, ms(2026, 9, 16, 0, 0)), '4d. 翌日0:00ちょうどは期限後')
  assertTrue(app.isWishSubmissionAfterDeadline_(y, m, period, ms(2026, 9, 16, 0, 1)), '4e. 翌日0:01は期限後')
}

// ------------------------------------------------------------------
// 5. 後半の締切境界（2026-09-20 23:59 / 09-21 0:00）
// ------------------------------------------------------------------
{
  var y5 = 2026, m5 = 10, period5 = app.WISH_PERIOD_SECOND_HALF_
  assertTrue(!app.isWishSubmissionAfterDeadline_(y5, m5, period5, ms(2026, 9, 20, 23, 59)), '5a. 後半締切日23:59は期限内')
  assertTrue(app.isWishSubmissionAfterDeadline_(y5, m5, period5, ms(2026, 9, 21, 0, 0)), '5b. 後半締切翌日0:00は期限後')
}

// ------------------------------------------------------------------
// 6. 前半の対象日付は1〜15日
// ------------------------------------------------------------------
{
  var firstHalfDates = app.resolveWishPeriodBusinessDates_(2026, 9, app.WISH_PERIOD_FIRST_HALF_)
  assertEqual(firstHalfDates.length, 15, '6a. 前半（2026年9月）は15日分')
  assertEqual(firstHalfDates[0].getDate(), 1, '6b. 前半の初日は1日')
  assertEqual(firstHalfDates[14].getDate(), 15, '6c. 前半の最終日は15日')
}

// ------------------------------------------------------------------
// 7. 後半の対象日付は16日〜月末（月によって28〜31日と可変）
// ------------------------------------------------------------------
{
  // 2026年9月は30日まで（後半は16〜30日=15日分）
  var secondHalfSep = app.resolveWishPeriodBusinessDates_(2026, 9, app.WISH_PERIOD_SECOND_HALF_)
  assertEqual(secondHalfSep.length, 15, '7a. 後半（2026年9月、30日まで）は15日分')
  assertEqual(secondHalfSep[secondHalfSep.length - 1].getDate(), 30, '7b. 2026年9月後半の最終日は30日')

  // 2027年1月は31日まで（後半は16〜31日=16日分）
  var secondHalfJan = app.resolveWishPeriodBusinessDates_(2027, 1, app.WISH_PERIOD_SECOND_HALF_)
  assertEqual(secondHalfJan.length, 16, '7c. 後半（2027年1月、31日まで）は16日分')
  assertEqual(secondHalfJan[secondHalfJan.length - 1].getDate(), 31, '7d. 2027年1月後半の最終日は31日')

  // 2月（うるう年でない2027年）は28日まで（後半は16〜28日=13日分）
  var secondHalfFeb = app.resolveWishPeriodBusinessDates_(2027, 2, app.WISH_PERIOD_SECOND_HALF_)
  assertEqual(secondHalfFeb.length, 13, '7e. 後半（2027年2月、28日まで）は13日分')
  assertEqual(secondHalfFeb[secondHalfFeb.length - 1].getDate(), 28, '7f. 2027年2月後半の最終日は28日')
}

// ------------------------------------------------------------------
// 8. isValidWishPeriod_は定義済みの2値だけを正とする
// ------------------------------------------------------------------
{
  assertTrue(app.isValidWishPeriod_('first_half'), '8a. first_halfは正しい期間指定')
  assertTrue(app.isValidWishPeriod_('second_half'), '8b. second_halfは正しい期間指定')
  assertTrue(!app.isValidWishPeriod_('third_half'), '8c. 未定義の値は不正')
  assertTrue(!app.isValidWishPeriod_(''), '8d. 空文字は不正')
  assertTrue(!app.isValidWishPeriod_(null), '8e. nullは不正')
}

// ------------------------------------------------------------------
// 9. getCurrentTimeMs_は実際の現在時刻に近い値を返す（本番コードが直接new Date()を呼ばず、
//    この関数を経由することの前提確認。テストはこの関数自体を差し替えて固定時刻を注入する）
// ------------------------------------------------------------------
{
  var before = Date.now()
  var got = app.getCurrentTimeMs_()
  var after = Date.now()
  assertTrue(got >= before && got <= after + 1000, '9. getCurrentTimeMs_は実行時点に近い時刻を返す（テストからの差し替え対象であることの前提確認）')
}

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
