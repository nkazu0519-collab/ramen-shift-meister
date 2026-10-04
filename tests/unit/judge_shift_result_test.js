// 1時間枠の判定結果組み立て（buildSlotJudgeResult_）を、本番のapp内の全.gsファイルをNode.jsのvmで
// 直接読み込んで検証する。judgeShiftsForDate自体はスプレッドシート・freee APIへアクセスするため
// 直接は呼ばず、その内部で1時間枠ごとに呼んでいるbuildSlotJudgeResult_（副作用のない純粋関数）を
// 本番コードからそのまま取り出して呼ぶ。テスト側でstatus/message_lines等の生成ロジックを
// 再実装しない（詳細・検証範囲はREADME.mdを参照）。
//
// buildSlotJudgeResult_は evaluateSlotCoverage_ の戻り値（coverage）をそのまま受け取る形なので、
// このテストでは本番のbuildRoleSlots_・assignRoleSlots_も使ってcoverageを本物同様に組み立ててから渡す
// （coverageの中身を手書きで捏造せず、判定の下位ロジックも本番関数で計算させる）。
//
// buildSlotJudgeResult_はcalcMaisterScoreにも依存するため、分割後は複数の.gsファイルへ
// またがって定義されることになる。app内の.gsファイル構成はファイル分割の進行に応じて変わるため、
// 読み込みは共通ヘルパー load_all_gs_.js に委ねる。
//
// 実行: node judge_shift_result_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var loadAllGsIntoSandbox_ = require('./load_all_gs_').loadAllGsIntoSandbox_

function loadProductionCode() {
  return loadAllGsIntoSandbox_().sandbox
}

var prod = loadProductionCode()

var pass = 0, fail = 0
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}

function candidate(id, badges) { return { employee_id: id, badges: badges } }

/**
 * evaluateSlotCoverage_の戻り値と同じ形のcoverageを、本番のbuildRoleSlots_・assignRoleSlots_を使って組み立てる
 * （evaluateSlotCoverage_自体はgetEmployeesCoveringSlot_経由でmergedRangesByEmployeeを要求し、
 * スプレッドシート由来のシフトデータ組み立てまで持ち込むとテストが重くなるため、
 * present配列を直接与える形で本番のcoverage生成と同じ計算を行う）
 *
 * ruleのrequiredCount・standardScoreはテスト側で決め打ちせず、本番の
 * SHIFT_JUDGE_STAFFING_RULES_[congestion]をそのまま使う。standardScoreを0のような
 * ダミー値にすると、将来「totalScore >= rule.standardScore」という条件が判定へ誤って
 * 復活しても常に真になってしまい、回帰を検知できなくなるため（再コードレビュー2026-09-10 P1）。
 */
function buildCoverage(congestion, present) {
  var roleSlots = prod.buildRoleSlots_(congestion)
  var rule = prod.SHIFT_JUDGE_STAFFING_RULES_[congestion]
  var countOk = present.length >= rule.requiredCount
  var roleAssignable = countOk ? prod.assignRoleSlots_(roleSlots, present) : false
  return {
    present: present,
    congestion: congestion,
    rule: rule,
    countOk: countOk,
    roleSlots: roleSlots,
    roleAssignable: roleAssignable,
    coverageOk: countOk && roleAssignable
  }
}

console.log('検証対象: ' + loadAllGsIntoSandbox_().loadedFiles.join(', '))
console.log('---')

var slotLabel = { label: '20:00' }

// 3. 人数5人・麺上げ可能者0人 → 不成立、持ち場不足
var noNoodle = [
  candidate('a', { 'ホール': true }),
  candidate('b', { 'ホール': true }),
  candidate('c', { 'セット': true }),
  candidate('d', { 'ホール': true, 'セット': true }),
  candidate('e', {})
]
var coverage3 = buildCoverage('高／ピーク', noNoodle)
var result3 = prod.buildSlotJudgeResult_(slotLabel, coverage3)
assertEqual(result3.status, '不成立', '3. 麺上げ可能者0人: status=不成立')
assertEqual(result3.coverage_ok, false, '3. 麺上げ可能者0人: coverage_ok=false')
assertEqual(result3.message_lines, ['麺上げ：必要1人／担当可能0人'], '3. 不足している麺上げだけが1行で表示される')

// 8. 予備なし時のmessage_lines・shortage_labels・detail_lines（現在のピーク5人体制）
var peakCurrent = [
  candidate('kamata', { 'ホール': true, 'セット': true }),
  candidate('tomiyasu', {}),
  candidate('endo', { 'ホール': true }),
  candidate('ueda', { 'セット': true }),
  candidate('sano', { '麺上げ': true })
]
var coverage8 = buildCoverage('高／ピーク', peakCurrent)
var result8 = prod.buildSlotJudgeResult_(slotLabel, coverage8)
assertEqual(result8.status, '成立', '8. 予備なしケース: status=成立')
assertEqual(result8.coverage_ok, true, '8. 予備なしケース: coverage_ok=true')
assertEqual(result8.message_lines, ['成立していますが、必須持ち場に予備がありません'], '8. 予備なしケース: message_lines')
assertEqual(result8.shortage_labels.slice().sort(), ['セット', 'ホール', '麺上げ'].sort(), '8. 予備なしケース: shortage_labels')
assertEqual(
  result8.detail_lines.slice().sort(),
  ['ホール：必要2人／実効担当候補2人／予備0人', '麺上げ：必要1人／実効担当候補1人／予備0人', 'セット：必要1人／実効担当候補1人／予備0人'].sort(),
  '8. 予備なしケース: detail_lines'
)

// 9. 全持ち場に予備あり時のmessage_lines（比較用ピーク5人体制）
var peakCompare = [
  candidate('kamata', { 'ホール': true }),
  candidate('tomiyasu', { 'ホール': true, 'セット': true, '麺上げ': true }),
  candidate('endo', { 'ホール': true }),
  candidate('ueda', { 'セット': true }),
  candidate('sano', { '麺上げ': true })
]
var coverage9 = buildCoverage('高／ピーク', peakCompare)
var result9 = prod.buildSlotJudgeResult_(slotLabel, coverage9)
assertEqual(result9.status, '成立', '9. 全持ち場に予備ありケース: status=成立')
assertEqual(result9.message_lines, ['必要な持ち場を満たし、配置変更の余地があります'], '9. 全持ち場に予備ありケース: message_lines')
assertEqual(result9.shortage_labels, [], '9. 全持ち場に予備ありケース: shortage_labels=空')
assertEqual(
  result9.detail_lines.slice().sort(),
  ['ホール：必要2人／実効担当候補3人／予備1人', '麺上げ：必要1人／実効担当候補2人／予備1人', 'セット：必要1人／実効担当候補2人／予備1人'].sort(),
  '9. 全持ち場に予備ありケース: detail_lines'
)

// 4. 合計点が旧基準未満でも人数・持ち場が成立すればstatusは成立
// buildSlotJudgeResult_はtotal_scoreを結果へ含めるが、statusの算出にはtotal_scoreを一切使わない
var lowScoreButValid = [
  candidate('a', { 'ホール': true }),
  candidate('b', { 'ホール': true }),
  candidate('c', { '麺上げ': true }),
  candidate('d', { 'セット': true }),
  candidate('e', {})
]
var coverage4 = buildCoverage('高／ピーク', lowScoreButValid)
var result4 = prod.buildSlotJudgeResult_(slotLabel, coverage4)
// ホール3点×2人＋麺上げ5点＋セット4点＋無資格0点＝15点（MEISTER_POINTS準拠、本番のcalcMaisterScoreで算出）。
// standard_scoreは本番のSHIFT_JUDGE_STAFFING_RULES_['高／ピーク'].standardScore（23点）をそのまま使っている
// （buildCoverageが0などのダミー値を渡していないことの確認を兼ねる。再コードレビュー2026-09-10 P1）。
// total_score(15) < standard_score(23)という「旧基準未満」の状態を実際に作ったうえで、
// それでもstatusが'成立'になる（合計点を判定に使わない）ことを同じケースでまとめて確認する
assertEqual(result4.total_score, 15, '4. 合計点が低い構成: total_score=15（旧基準23点未満）')
assertEqual(result4.standard_score, 23, '4. 合計点が低い構成: standard_score=23（本番のSHIFT_JUDGE_STAFFING_RULES_由来）')
assertEqual(result4.status, '成立', '4. 合計点が低い構成: status=成立（15<23でも合計点は判定に使わない）')

// 人数不足のケースも確認（回帰: 持ち場は足りていても人数が足りなければ不成立で、shortage_labels/detail_linesは空配列）
// テストD: 人数不足時は「人数不足：あとN人」の1行のみで、技能不足の行は追加しない
var tooFew = [
  candidate('a', { 'ホール': true }),
  candidate('b', { '麺上げ': true })
]
var coverageFew = buildCoverage('高／ピーク', tooFew)
var resultFew = prod.buildSlotJudgeResult_(slotLabel, coverageFew)
assertEqual(resultFew.status, '不成立', '回帰: 人数不足は不成立')
assertEqual(resultFew.message_lines, ['人数不足：あと3人'], 'D. 人数不足時はmessage_linesが人数不足の1行のみ（技能不足行を追加しない）')
assertEqual(resultFew.shortage_labels, [], '回帰: 不成立時のshortage_labelsは空配列')
assertEqual(resultFew.detail_lines, [], '回帰: 不成立時のdetail_linesは空配列')

// テストB: 複数の持ち場が不足している場合、不足している持ち場だけが別々の行で出る
// （高／ピーク：ホール2人・麺上げ1人・セット1人・フリー1人。麺上げ0人・セット0人、ホール・フリーは充足）
var multiShort = [
  candidate('a', { 'ホール': true }),
  candidate('b', { 'ホール': true }),
  candidate('c', {}),
  candidate('d', {}),
  candidate('e', {})
]
var coverageB = buildCoverage('高／ピーク', multiShort)
var resultB = prod.buildSlotJudgeResult_(slotLabel, coverageB)
assertEqual(resultB.status, '不成立', 'B. 複数持ち場不足: status=不成立')
assertEqual(
  resultB.message_lines.slice().sort(),
  ['麺上げ：必要1人／担当可能0人', 'セット：必要1人／担当可能0人'].sort(),
  'B. 不足している麺上げ・セットだけが別々の行で出る（充足しているホール・フリーの行は出ない）'
)

// テストC: 持ち場ごとの担当可能人数は足りているが、同じ従業員に候補が重なり重複なし配置ができない場合
// （中：ホール1人＋麺上げ1人＋セット1人。3人中1人だけがホール・セット・麺上げすべてを持ち、他2人は無資格）
var overlapOnly = [
  candidate('a', { 'ホール': true, 'セット': true, '麺上げ': true }),
  candidate('b', {}),
  candidate('c', {})
]
var coverageC = buildCoverage('中', overlapOnly)
var resultC = prod.buildSlotJudgeResult_(slotLabel, coverageC)
assertEqual(resultC.status, '不成立', 'C. 候補重複による配置不可: status=不成立')
assertEqual(
  resultC.message_lines,
  ['担当候補が重なり、配置できません'],
  'C. 個別人数は足りるが重複で配置不可の場合は専用の1行のみ（特定の持ち場を不足扱いにしない）'
)

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
