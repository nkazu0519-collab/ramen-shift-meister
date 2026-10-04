// 実効予備の計算（calcEffectiveReserve_）を、本番のapp内の全.gsファイルをNode.jsのvmで直接読み込んで検証する。
// ロジックをこのファイルへコピーしない。calcEffectiveReserve_・buildRoleSlots_・assignRoleSlots_は
// すべて本番コードからそのまま呼び出す（実行方法・検証範囲の詳細はREADME.mdを参照）。
//
// app内の.gsファイル構成はファイル分割の進行に応じて変わるため、読み込みは共通ヘルパー
// load_all_gs_.js に委ねる（このテスト側は「今どの関数がどのファイルにあるか」を意識しない）。
//
// 実行: node effective_reserve_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var loadAllGsIntoSandbox_ = require('./load_all_gs_').loadAllGsIntoSandbox_

function loadProductionCode() {
  // code.gsはGAS APIへ依存する関数も定義しているが、今回呼び出す純粋関数（calcEffectiveReserve_、
  // buildRoleSlots_、assignRoleSlots_）はSpreadsheetApp等を一切参照しないため、
  // GAS APIのモックを用意しなくてもロード自体（関数定義の評価）は成功する
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
function findLabel(result, label) {
  var matches = result.filter(function (x) { return x.label === label })
  return matches[0]
}

console.log('検証対象: ' + loadAllGsIntoSandbox_().loadedFiles.join(', '))
console.log('---')

// ==== 高／ピーク: ホール2・麺上げ1・セット1・フリー1 ====
var roleSlotsPeak = prod.buildRoleSlots_('高／ピーク')

// 1. 現在のピーク5人体制（安定性指標_情報設計_たたき台.md 9節）
// 釜田: ホール・セット / 富安: 仕込みのみ / 遠藤: ホール / 植田: セット / 佐野: 麺上げ
var peakCurrent = [
  candidate('kamata', { 'ホール': true, 'セット': true }),
  candidate('tomiyasu', {}),
  candidate('endo', { 'ホール': true }),
  candidate('ueda', { 'セット': true }),
  candidate('sano', { '麺上げ': true })
]
assertEqual(prod.assignRoleSlots_(roleSlotsPeak, peakCurrent), true, '1. 現在のピーク5人体制: 最低配置成立')
var r1 = prod.calcEffectiveReserve_(roleSlotsPeak, peakCurrent)
assertEqual(findLabel(r1, 'ホール').effective_reserve, 0, '1. ホールの実効予備0')
assertEqual(findLabel(r1, 'セット').effective_reserve, 0, '1. セットの実効予備0')
assertEqual(findLabel(r1, '麺上げ').effective_reserve, 0, '1. 麺上げの実効予備0')

// 2. 比較用ピーク5人体制（点数・代替指標比較_たたき台.md 8節ケースB）
// 釜田: ホール / 富安: ホール・セット・麺上げ / 遠藤: ホール / 植田: セット / 佐野: 麺上げ
var peakCompare = [
  candidate('kamata', { 'ホール': true }),
  candidate('tomiyasu', { 'ホール': true, 'セット': true, '麺上げ': true }),
  candidate('endo', { 'ホール': true }),
  candidate('ueda', { 'セット': true }),
  candidate('sano', { '麺上げ': true })
]
assertEqual(prod.assignRoleSlots_(roleSlotsPeak, peakCompare), true, '2. 比較用ピーク5人体制: 最低配置成立')
var r2 = prod.calcEffectiveReserve_(roleSlotsPeak, peakCompare)
assertEqual(findLabel(r2, 'ホール').effective_reserve, 1, '2. ホールの実効予備1')
assertEqual(findLabel(r2, 'セット').effective_reserve, 1, '2. セットの実効予備1')
assertEqual(findLabel(r2, '麺上げ').effective_reserve, 1, '2. 麺上げの実効予備1')

// 3. 5人いても麺上げ可能者が0人
var noNoodle = [
  candidate('a', { 'ホール': true }),
  candidate('b', { 'ホール': true }),
  candidate('c', { 'セット': true }),
  candidate('d', { 'ホール': true, 'セット': true }),
  candidate('e', {})
]
assertEqual(prod.assignRoleSlots_(roleSlotsPeak, noNoodle), false, '3. 麺上げ可能者0人: 最低配置不成立')

// 4. 合計点が旧基準（23点）未満でも人数・持ち場が成立すれば成立扱いになること
// calcEffectiveReserve_・assignRoleSlots_はスコアを一切参照しない純粋関数であるため、
// マイスター点数の低い構成でも、人数・持ち場さえ満たせば最低配置は成立する
var lowScoreButValid = [
  candidate('a', { 'ホール': true }),
  candidate('b', { 'ホール': true }),
  candidate('c', { '麺上げ': true }),
  candidate('d', { 'セット': true }),
  candidate('e', {})
]
assertEqual(prod.assignRoleSlots_(roleSlotsPeak, lowScoreButValid), true, '4. 合計点が低くても人数・持ち場が揃えば成立')

// 5. ホールとセットを持つ同じ従業員（多能工）を、両方の持ち場の予備として不正に重複計上しない
// 釜田がホール・セット両方の資格を持つが、ホール要員がもう1人しかいないため、
// 釜田はホールへ固定しないとホール2人が成立しない → セットの実効予備として二重計上してはいけない
var multiSkillTrap = [
  candidate('kamata', { 'ホール': true, 'セット': true }),
  candidate('hall2', { 'ホール': true }),
  candidate('setperson', { 'セット': true }),
  candidate('noodle', { '麺上げ': true }),
  candidate('free', {})
]
assertEqual(prod.assignRoleSlots_(roleSlotsPeak, multiSkillTrap), true, '5. 多能工ケース: 最低配置成立')
var r5 = prod.calcEffectiveReserve_(roleSlotsPeak, multiSkillTrap)
assertEqual(findLabel(r5, 'ホール').effective_reserve, 0, '5. ホールの実効予備0（釜田はホール固定）')
assertEqual(findLabel(r5, 'セット').effective_reserve, 0, '5. セットの実効予備0（釜田を重複計上しない）')
// 参考: 単純な資格保有人数だとセットは釜田+setpersonの2人に見えてしまう危険があることの確認
var naiveSetCount = multiSkillTrap.filter(function (c) { return c.badges['セット'] }).length
assertEqual(naiveSetCount, 2, '5. 参考: 単純資格保有数だとセットは2人に見える（実効予備0との差）')

// ==== 6. 低／アイドル: 麺上げ1 + ホール・セット兼任1 ====
var roleSlotsLow = prod.buildRoleSlots_('低／アイドル')
// a: 麺上げのみ／b: 麺上げ・ホール・セットの多能工／c: 無資格
// bは「ホール・セット兼任」を成立させられる唯一の候補なので、bを麺上げへ回すと兼任枠が不成立になる。
// したがってbは麺上げの実効担当候補になれず（釜田のケース5と同じ罠）、麺上げの実効担当候補はaのみ。
var lowCase = [
  candidate('a', { '麺上げ': true }),
  candidate('b', { '麺上げ': true, 'ホール': true, 'セット': true }),
  candidate('c', {})
]
assertEqual(prod.assignRoleSlots_(roleSlotsLow, lowCase), true, '6. 低／アイドル: 最低配置成立')
var r6 = prod.calcEffectiveReserve_(roleSlotsLow, lowCase)
assertEqual(findLabel(r6, '麺上げ').effective_reserve, 0, '6. 低／アイドル: 麺上げの実効予備0（bは兼任枠に固定され二重計上されない）')
assertEqual(findLabel(r6, 'ホール・セット兼任').effective_reserve, 0, '6. 低／アイドル: ホール・セット兼任の実効予備0（bしかいない）')

// 6b. 対照ケース: aとは別にもう1人「麺上げのみ」の候補を加え、麺上げに実際の予備があるケースも確認する
// （こちらはbを動かさなくても麺上げ2人が確保できるため、実効予備1になる）
var lowCaseWithSpare = [
  candidate('a', { '麺上げ': true }),
  candidate('a2', { '麺上げ': true }),
  candidate('b', { '麺上げ': true, 'ホール': true, 'セット': true }),
  candidate('c', {})
]
assertEqual(prod.assignRoleSlots_(roleSlotsLow, lowCaseWithSpare), true, '6b. 低／アイドル対照ケース: 最低配置成立')
var r6b = prod.calcEffectiveReserve_(roleSlotsLow, lowCaseWithSpare)
assertEqual(findLabel(r6b, '麺上げ').effective_reserve, 1, '6b. 麺上げ担当が2人いれば実効予備1になる')

// ==== 7. 中: ホール1 + 麺上げ1 + セット1 ====
var roleSlotsMid = prod.buildRoleSlots_('中')
var midCase = [
  candidate('a', { 'ホール': true }),
  candidate('b', { 'ホール': true }),
  candidate('c', { '麺上げ': true }),
  candidate('d', { 'セット': true }),
  candidate('e', { 'セット': true })
]
assertEqual(prod.assignRoleSlots_(roleSlotsMid, midCase), true, '7. 中: 最低配置成立')
var r7 = prod.calcEffectiveReserve_(roleSlotsMid, midCase)
assertEqual(findLabel(r7, 'ホール').effective_reserve, 1, '7. 中: ホールの実効予備1')
assertEqual(findLabel(r7, '麺上げ').effective_reserve, 0, '7. 中: 麺上げの実効予備0（担当可能者1人のみ）')
assertEqual(findLabel(r7, 'セット').effective_reserve, 1, '7. 中: セットの実効予備1')

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
