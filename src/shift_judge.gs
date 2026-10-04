/**
 * 判定対象日の0時を基準に、11時〜翌3時の16枠（各1時間）を作る
 * hourOffsetが24以上でもDateが自動で翌日へ繰り上がるため、日跨ぎの計算を個別に書く必要はない
 */
function buildJudgeSlots_(businessDateObj) {
  var slots = []
  for (var i = 0; i <= SHIFT_JUDGE_SLOT_COUNT_ - 1; i++) {
    var hourOffset = SHIFT_JUDGE_START_HOUR_ + i
    var slotStart = new Date(businessDateObj.getFullYear(), businessDateObj.getMonth(), businessDateObj.getDate(), hourOffset, 0)
    var slotEnd = new Date(businessDateObj.getFullYear(), businessDateObj.getMonth(), businessDateObj.getDate(), hourOffset + 1, 0)
    slots.push({
      start: slotStart,
      end: slotEnd,
      label: formatSlotHourLabel_(hourOffset) + '〜' + formatSlotHourLabel_(hourOffset + 1)
    })
  }
  return slots
}






/**
 * 混雑区分ごとの必要人数・最低成立点（企画書ドラフトの「最低成立条件」表と同じ値）
 */
var SHIFT_JUDGE_STAFFING_RULES_ = {
  '低／アイドル': { requiredCount: 2, standardScore: 17 },
  '中': { requiredCount: 3, standardScore: 18 },
  '高／ピーク': { requiredCount: 5, standardScore: 23 }
}

/**
 * 時間帯（開始時刻のhourOffset）と曜日区分から混雑区分を求める
 * 指定のない時間帯は低／アイドル扱いにする
 */
var SHIFT_JUDGE_CONGESTION_RULES_ = [
  { from: 12, to: 14, byDayType: { '平日': '中', '休日前': '中', '休日': '高／ピーク' } }, // 昼12:00〜14:00
  { from: 20, to: 24, byDayType: { '平日': '高／ピーク', '休日前': '高／ピーク', '休日': '高／ピーク' } }, // 中間20:00〜24:00
  { from: 24, to: 27, byDayType: { '平日': '低／アイドル', '休日前': '高／ピーク', '休日': '高／ピーク' } } // 翌0:00〜3:00
]

function getCongestionLevel_(hourOffset, dayType) {
  for (var i = 0; i <= SHIFT_JUDGE_CONGESTION_RULES_.length - 1; i++) {
    var rule = SHIFT_JUDGE_CONGESTION_RULES_[i]
    if (hourOffset >= rule.from && hourOffset < rule.to) {
      return rule.byDayType[dayType] || '低／アイドル'
    }
  }
  return '低／アイドル'
}

/**
 * 混雑区分ごとの持ち場の枠を作る（1枠1人。手洗い伝道師・仕込みは持ち場判定に使わない）
 * 低／アイドル: 麺上げ1人＋ホール・セット兼任1人（兼任は1人でホールとセットの両方を満たす）
 * 中: ホール1人＋麺上げ1人＋セット1人
 * 高／ピーク: ホール2人＋麺上げ1人＋セット1人＋フリー1人（フリーは特定マイスターを必須としない）
 */
function buildRoleSlots_(congestion) {
  if (congestion == '低／アイドル') {
    return [
      { label: '麺上げ', isEligible: function (b) { return b['麺上げ'] } },
      { label: 'ホール・セット兼任', isEligible: function (b) { return b['ホール'] && b['セット'] } }
    ]
  }
  if (congestion == '中') {
    return [
      { label: 'ホール', isEligible: function (b) { return b['ホール'] } },
      { label: '麺上げ', isEligible: function (b) { return b['麺上げ'] } },
      { label: 'セット', isEligible: function (b) { return b['セット'] } }
    ]
  }
  return [
    { label: 'ホール', isEligible: function (b) { return b['ホール'] } },
    { label: 'ホール', isEligible: function (b) { return b['ホール'] } },
    { label: '麺上げ', isEligible: function (b) { return b['麺上げ'] } },
    { label: 'セット', isEligible: function (b) { return b['セット'] } },
    { label: 'フリー', isEligible: function () { return true } }
  ]
}

/**
 * 持ち場の枠（roleSlots）を、同じ従業員を重複させずcandidatesへ割り当てられるかをバックトラッキングで判定する
 * 割り当てできればtrue、できなければfalseを返す（枠数・候補者数とも小規模なので全探索で十分）
 */
function assignRoleSlots_(roleSlots, candidates) {
  var usedEmployeeIds = {}

  function backtrack(slotIndex) {
    if (slotIndex > roleSlots.length - 1) return true
    var slot = roleSlots[slotIndex]
    for (var i = 0; i <= candidates.length - 1; i++) {
      var candidate = candidates[i]
      if (usedEmployeeIds[candidate.employee_id]) continue
      if (!slot.isEligible(candidate.badges)) continue
      usedEmployeeIds[candidate.employee_id] = true
      if (backtrack(slotIndex + 1)) return true
      usedEmployeeIds[candidate.employee_id] = false
    }
    return false
  }

  return backtrack(0)
}

/**
 * シフト範囲（getAllShiftRangesForJudge_の戻り値）を従業員ごとにまとめる
 * 戻り値: { employee_id: [{startMs, endMs}, ...], ... }
 */
function groupShiftRangesByEmployee_(shiftRanges) {
  var grouped = {}
  for (var i = 0; i <= shiftRanges.length - 1; i++) {
    var sr = shiftRanges[i]
    if (!grouped[sr.employee_id]) grouped[sr.employee_id] = []
    grouped[sr.employee_id].push({ startMs: sr.startMs, endMs: sr.endMs })
  }
  return grouped
}

/**
 * 同じ従業員の時間範囲を開始時刻順に並べ、重複または隣接（前の終了時刻以前に次が始まる）するものを1本へ結合する
 * 例: 11:00〜14:30と14:30〜17:30は11:00〜17:30の1本になる
 */
function mergeShiftRanges_(ranges) {
  if (ranges.length == 0) return []
  var sorted = ranges.slice().sort(function (a, b) { return a.startMs - b.startMs })
  var merged = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }]
  for (var i = 1; i <= sorted.length - 1; i++) {
    var current = sorted[i]
    var last = merged[merged.length - 1]
    if (current.startMs <= last.endMs) {
      if (current.endMs > last.endMs) last.endMs = current.endMs
    } else {
      merged.push({ startMs: current.startMs, endMs: current.endMs })
    }
  }
  return merged
}

/**
 * 指定した1時間枠を、結合済みの勤務時間が全体を通してカバーしている従業員IDの一覧を返す
 * 枠の一部だけ在籍している（例: 枠の途中に空白がある）場合はその枠の在籍者として数えない
 * 在籍条件: mergedStart <= slotStart && slotEnd <= mergedEnd
 */
function getEmployeesCoveringSlot_(mergedRangesByEmployee, slotStartMs, slotEndMs) {
  var employeeIds = []
  for (var empId in mergedRangesByEmployee) {
    var ranges = mergedRangesByEmployee[empId]
    for (var i = 0; i <= ranges.length - 1; i++) {
      if (ranges[i].startMs <= slotStartMs && slotEndMs <= ranges[i].endMs) {
        employeeIds.push(empId)
        break
      }
    }
  }
  return employeeIds
}

/**
 * 役割ラベルごとに、必要人数と技能条件を満たす候補者数をまとめる（参考情報。重複なし割当の可否そのものではない）
 * 複数マイスターを持つ従業員がいると「この役割が必ず何人不足」とは断定できないため、必要人数と担当可能人数を併記するだけに留める
 */
function buildRoleCoverageSummary_(roleSlots, candidates) {
  var summary = []
  var indexByLabel = {}
  for (var i = 0; i <= roleSlots.length - 1; i++) {
    var label = roleSlots[i].label
    if (!(label in indexByLabel)) {
      indexByLabel[label] = summary.length
      summary.push({ label: label, required: 0, isEligible: roleSlots[i].isEligible })
    }
    summary[indexByLabel[label]].required += 1
  }
  for (var s = 0; s <= summary.length - 1; s++) {
    var eligibleCount = 0
    for (var c = 0; c <= candidates.length - 1; c++) {
      if (summary[s].isEligible(candidates[c].badges)) eligibleCount += 1
    }
    summary[s].eligibleCount = eligibleCount
  }
  return summary
}

/**
 * 持ち場ごとの「実効予備」を計算する（安定性指標_情報設計_たたき台.md 9節の定義に基づく）
 * 単純な「資格保有人数－必要人数」ではなく、成立するすべての重複なし配置の中で、
 * その持ち場へ実際に割り当て可能だった従業員の集合を求める。
 * 手順: ラベルごとに枠を1つ取り出し、各候補者について「その候補者をその枠へ固定したとき、
 * 残りの枠（同ラベルの他の枠を含む）を残りの候補者で重複なく割り当てられるか」をassignRoleSlots_で判定する。
 * 成立した候補者だけをその持ち場の実効担当候補として数えるため、
 * 他の持ち場を成立させるために動かせない多能工を、存在しない予備として重複計上しない（ケース5相当）。
 * 戻り値: [{ label, required, effective_candidate_count, effective_reserve }, ...]（ラベルごとに1件）
 */
function calcEffectiveReserve_(roleSlots, candidates) {
  var labelOrder = []
  var requiredByLabel = {}
  var firstSlotIndexByLabel = {}
  for (var i = 0; i <= roleSlots.length - 1; i++) {
    var label = roleSlots[i].label
    if (!(label in requiredByLabel)) {
      labelOrder.push(label)
      requiredByLabel[label] = 0
      firstSlotIndexByLabel[label] = i
    }
    requiredByLabel[label] += 1
  }

  var result = []
  for (var li = 0; li <= labelOrder.length - 1; li++) {
    var label = labelOrder[li]
    var targetSlotIdx = firstSlotIndexByLabel[label]
    var targetSlot = roleSlots[targetSlotIdx]
    var remainingSlots = roleSlots.slice(0, targetSlotIdx).concat(roleSlots.slice(targetSlotIdx + 1))

    var capableIds = {}
    for (var c = 0; c <= candidates.length - 1; c++) {
      var candidate = candidates[c]
      if (capableIds[candidate.employee_id]) continue
      if (!targetSlot.isEligible(candidate.badges)) continue
      var remainingCandidates = []
      for (var r = 0; r <= candidates.length - 1; r++) {
        if (candidates[r].employee_id !== candidate.employee_id) remainingCandidates.push(candidates[r])
      }
      if (assignRoleSlots_(remainingSlots, remainingCandidates)) {
        capableIds[candidate.employee_id] = true
      }
    }
    var effectiveCandidateCount = Object.keys(capableIds).length
    result.push({
      label: label,
      required: requiredByLabel[label],
      effective_candidate_count: effectiveCandidateCount,
      effective_reserve: effectiveCandidateCount - requiredByLabel[label]
    })
  }
  return result
}

/**
 * 指定した1時間枠の人数・持ち場カバー判定を行う（休憩可能性判定の候補枠判定と共通利用するため抽出）
 * excludeEmpIdを指定すると、その従業員を在籍者から除外して判定する（休憩中を想定した再判定用）
 * 合計スコアはここでは扱わない（休憩可能性判定へ使用しないため。呼び出し元のjudgeShiftsForDateで別途計算する）
 */
function evaluateSlotCoverage_(slotStartMs, slotEndMs, hourOffset, dayType, mergedRangesByEmployee, getBadgesCached, excludeEmpId) {
  var presentEmployeeIds = getEmployeesCoveringSlot_(mergedRangesByEmployee, slotStartMs, slotEndMs)
  var present = []
  for (var i = 0; i <= presentEmployeeIds.length - 1; i++) {
    var empId = presentEmployeeIds[i]
    if (excludeEmpId && String(empId) === String(excludeEmpId)) continue
    present.push({ employee_id: empId, badges: getBadgesCached(empId) })
  }

  var congestion = getCongestionLevel_(hourOffset, dayType)
  var rule = SHIFT_JUDGE_STAFFING_RULES_[congestion]
  var countOk = present.length >= rule.requiredCount
  var roleSlots = buildRoleSlots_(congestion)
  var roleAssignable = countOk ? assignRoleSlots_(roleSlots, present) : false

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

/**
 * 1時間枠1つ分の判定結果（status・message・detail_lines等）を組み立てる純粋関数
 * evaluateSlotCoverage_の戻り値（coverage）とslot（labelを含む）だけを受け取り、
 * スプレッドシートやfreee APIへは一切アクセスしない。
 * judgeShiftsForDate（本番の1時間枠ループ）とテストコードの両方がこの関数を呼ぶことで、
 * 「テスト側が同じ条件分岐を別実装し、本番と同じ誤りに気づけない」状態を避ける。
 * 成立／不成立は人数と必須持ち場の重複なし割り当てだけで決める（合計スコアは判定条件から外した。
 * 安定性指標_情報設計_たたき台.md／点数・代替指標比較_たたき台.md の2026-09-03決定を反映）。
 * 合計スコアは参考値として結果へ含めるが、営業の安定性が保証された値としては扱わない。
 * 成立した枠については、必須持ち場（「フリー」を除く。フリーは特定技能を要求しないため実効予備の対象外）ごとに
 * calcEffectiveReserve_で実効予備を計算し、いずれかが0人なら短い注意文を、全て予備ありなら肯定文を返す。
 * レビュー対応（不成立詳細の不足のみ表示 2026-09-24）：人数は足りるが持ち場不足で不成立の場合、
 * buildRoleCoverageSummary_の構造化データからeligibleCount < requiredの持ち場だけを
 * messageLinesへ1行ずつ入れる（「麺上げ：必要1人／担当可能0人」）。足りている持ち場・長い共通説明・
 * 同じ従業員を複数の持ち場には配置できませんという括弧補足は出さない。個別の持ち場はすべて
 * 担当可能人数が足りているのに重複なく割り当てられない場合（候補が同じ従業員に重なっている場合）は、
 * 特定の持ち場を不足扱いにせず「担当候補が重なり、配置できません」の1行だけを返す。
 */
function buildSlotJudgeResult_(slot, coverage) {
  var present = coverage.present
  var congestion = coverage.congestion
  var rule = coverage.rule
  var countOk = coverage.countOk
  var roleSlots = coverage.roleSlots
  var roleAssignable = coverage.roleAssignable
  var coverageOk = coverage.coverageOk

  var totalScore = 0
  for (var p = 0; p <= present.length - 1; p++) {
    totalScore += calcMaisterScore(present[p].badges)
  }

  // 休憩結果のdetail_linesと同じ考え方で、状況ごとに行を分ける（人数不足／持ち場不足／参考／実効予備）
  // messageは互換用の一文（title属性等、一文で十分な場所向け）。画面表示はmessageLinesを優先する
  // 初期表示へ複数の長文警告を並べないため、成立時は最優先の一言だけをmessageLinesの先頭に置き、
  // 持ち場ごとの内訳（必要人数／実効担当候補数／実効予備人数）はdetailLinesへ分離して「詳細を見る」でのみ渡す
  var status, messageLines, detailLines, shortageLabels
  if (!coverageOk) {
    status = '不成立'
    messageLines = []
    detailLines = []
    shortageLabels = []
    if (!countOk) {
      messageLines.push('人数不足：あと' + (rule.requiredCount - present.length) + '人')
    }
    if (countOk && !roleAssignable) {
      var coverageSummary = buildRoleCoverageSummary_(roleSlots, present)
      for (var cs = 0; cs <= coverageSummary.length - 1; cs++) {
        var item = coverageSummary[cs]
        if (item.eligibleCount < item.required) {
          messageLines.push(item.label + '：必要' + item.required + '人／担当可能' + item.eligibleCount + '人')
        }
      }
      // 持ち場別の担当可能人数はすべて足りているのに重複なく割り当てられない場合、
      // 特定の持ち場を不足扱いにできない（同じ従業員に候補が重なっているだけのため）
      if (messageLines.length === 0) {
        messageLines.push('担当候補が重なり、配置できません')
      }
    }
  } else {
    status = '成立'
    // フリーは特定技能を要求しないため実効予備の対象外（buildRoleSlots_のisEligibleが常にtrueの枠）
    var reserveByLabel = calcEffectiveReserve_(roleSlots, present).filter(function (r) { return r.label !== 'フリー' })
    shortageLabels = []
    for (var rv = 0; rv <= reserveByLabel.length - 1; rv++) {
      if (reserveByLabel[rv].effective_reserve <= 0) shortageLabels.push(reserveByLabel[rv].label)
    }
    if (shortageLabels.length > 0) {
      messageLines = ['成立していますが、必須持ち場に予備がありません']
    } else {
      messageLines = ['必要な持ち場を満たし、配置変更の余地があります']
    }
    detailLines = []
    for (var dl = 0; dl <= reserveByLabel.length - 1; dl++) {
      var d = reserveByLabel[dl]
      detailLines.push(d.label + '：必要' + d.required + '人／実効担当候補' + d.effective_candidate_count + '人／予備' + d.effective_reserve + '人')
    }
  }
  var message = messageLines.join('。')

  return {
    label: slot.label,
    congestion: congestion,
    present_count: present.length,
    required_count: rule.requiredCount,
    coverage_ok: coverageOk,
    shortage_labels: shortageLabels,
    detail_lines: detailLines,
    total_score: totalScore,
    standard_score: rule.standardScore,
    status: status,
    message: message,
    message_lines: messageLines
  }
}

/**
 * 選択した日付で、11:00〜翌3:00の16枠それぞれを判定する
 * 各枠の結果生成はbuildSlotJudgeResult_（副作用のない純粋関数）へ委譲する
 * 曜日区分はクライアントから受け取らず、judge_dateからサーバー側で自動判定する
 * （手動選択の間違いで判定結果が変わらないようにするため。対応範囲外・不正日付はエラーを返し判定を実行しない）
 */
function judgeShiftsForDate(form) {
  if (!form || !form.judge_date) {
    return { error: '判定対象日を選択してください' }
  }
  var dayTypeResult = getBusinessDayType(form.judge_date)
  if (!dayTypeResult.success) {
    return { error: dayTypeResult.message }
  }
  var businessDate = parseFormDate_(form.judge_date)
  var dayType = dayTypeResult.day_type
  var slots = buildJudgeSlots_(businessDate)
  var shiftRanges = getAllShiftRangesForJudge_()
  var groupedRanges = groupShiftRangesByEmployee_(shiftRanges)
  var mergedRangesByEmployee = {}
  for (var empId in groupedRanges) {
    mergedRangesByEmployee[empId] = mergeShiftRanges_(groupedRanges[empId])
  }
  var badgeCache = {}

  function getBadgesCached(empId) {
    if (!(empId in badgeCache)) {
      badgeCache[empId] = getMaisterBadgesForEmp_(empId)
    }
    return badgeCache[empId]
  }

  var results = []
  for (var s = 0; s <= slots.length - 1; s++) {
    var slot = slots[s]
    var slotStartMs = slot.start.getTime()
    var slotEndMs = slot.end.getTime()

    var coverage = evaluateSlotCoverage_(slotStartMs, slotEndMs, SHIFT_JUDGE_START_HOUR_ + s, dayType, mergedRangesByEmployee, getBadgesCached, null)
    results.push(buildSlotJudgeResult_(slot, coverage))
  }

  var nameMap = getEmployeeNameMap_()
  var breaks = judgeBreakPossibility_(businessDate, dayType, slots, mergedRangesByEmployee, getBadgesCached, nameMap)

  return { slots: results, breaks: breaks }
}

/**
 * 機能3: 休憩可能性判定
 * 予定シフトを公開する前に、長時間勤務者が一人ずつ連続休憩を取っても
 * 最低配置条件（人数・持ち場）を維持できる候補があるかを確認する
 * 合計スコアは休憩可能性判定に使用しない（企画上の決定。休憩可能性最小仕様を参照）
 */

/**
 * 勤務時間(ミリ秒)から必要休憩分数を返す純粋関数（代表店舗の休憩ルール）
 * 3〜5時間: 0分／6時間: 5分／7時間: 45分／8時間以上: 60分
 * シフトは1時間単位で登録される前提のため、時間数は割り切れる想定だが、
 * 念のため四捨五入して安全側（休憩0分＝対象外にはしない）に丸める
 */
function calcRequiredBreakMinutes_(durationMs) {
  var hours = Math.round(durationMs / (60 * 60 * 1000))
  if (hours <= 5) return 0
  if (hours === 6) return 5
  if (hours === 7) return 45
  return 60
}

/**
 * 営業日基準のミリ秒時刻を「11:00」「翌2:00」のような時刻ラベルにする
 * （formatSlotHourLabel_はhourOffset基準のため、実時刻からhourOffsetへ変換してから委譲する）
 */
function formatMsAsHourLabel_(ms, businessDateObj) {
  var d = new Date(ms)
  var hour = d.getHours()
  if (!isSameCalendarDate_(d, businessDateObj)) hour += 24
  return formatSlotHourLabel_(hour)
}

/**
 * 営業日（11:00〜翌3:00）と重なる勤務ブロックのうち、休憩が必要な長時間勤務者を列挙する
 * mergeShiftRanges_で結合済みのブロック単位で判定するため、隣接する連続シフトを二重に休憩対象としない
 * 同じ従業員が同じ営業日に重ならない長時間シフトを2本持つ場合もあるため、
 * 割当の識別には従業員IDではなく、勤務ブロックごとに一意なtarget_id（"従業員ID#開始ms"）を使う
 */
function collectBreakTargets_(mergedRangesByEmployee, businessStartMs, businessEndMs, nameMap) {
  var targets = []
  for (var empId in mergedRangesByEmployee) {
    var ranges = mergedRangesByEmployee[empId]
    for (var i = 0; i <= ranges.length - 1; i++) {
      var r = ranges[i]
      if (!(r.startMs < businessEndMs && businessStartMs < r.endMs)) continue
      var requiredMinutes = calcRequiredBreakMinutes_(r.endMs - r.startMs)
      if (requiredMinutes <= 0) continue
      targets.push({
        target_id: empId + '#' + r.startMs,
        employee_id: empId,
        employee_name: nameMap[empId] || ('ID:' + empId),
        rangeStartMs: r.startMs,
        rangeEndMs: r.endMs,
        required_minutes: requiredMinutes
      })
    }
  }
  return targets
}

/**
 * 対象者の勤務ブロックに完全に含まれる1時間枠のうち、対象者を除外しても
 * 人数・持ち場の最低配置条件を維持できる枠（slots配列のインデックス）を列挙する
 * 既存のevaluateSlotCoverage_をexcludeEmpId付きで呼び、判定ロジックを別実装しない
 */
function collectCandidateSlotsForTarget_(target, slots, dayType, mergedRangesByEmployee, getBadgesCached) {
  var candidateSlotIndexes = []
  for (var s = 0; s <= slots.length - 1; s++) {
    var slot = slots[s]
    var slotStartMs = slot.start.getTime()
    var slotEndMs = slot.end.getTime()
    if (!(target.rangeStartMs <= slotStartMs && slotEndMs <= target.rangeEndMs)) continue
    var coverage = evaluateSlotCoverage_(slotStartMs, slotEndMs, SHIFT_JUDGE_START_HOUR_ + s, dayType, mergedRangesByEmployee, getBadgesCached, target.employee_id)
    if (coverage.coverageOk) candidateSlotIndexes.push(s)
  }
  return candidateSlotIndexes
}

/**
 * 候補枠が一つもない対象者について、勤務時間内の全枠を人数不足・持ち場代替不可の観点で説明する
 * 持ち場代替不可の枠は、既存のbuildRoleCoverageSummary_で「ホール：必要2人／担当可能1人」のような
 * 参考人数を添える（店主が誰を追加すべきか判断できるように）。複数技能者の重複により単一の不足持ち場を
 * 断定できない場合も、buildRoleCoverageSummary_自体が「必要人数」と「担当可能人数」の併記に留まる
 * 参考情報なので、断定していない旨は自然に表現される
 * 戻り値は「人数不足の時間帯」「持ち場不足の時間帯」「持ち場別参考情報」を分けた構造化データにする
 * （画面側で項目ごとに改行して表示するため）。textは互換用の一文（title属性等、一文で十分な場所向け）
 */
function describeNoCandidateReason_(target, slots, dayType, mergedRangesByEmployee, getBadgesCached) {
  var countShortageLabels = []
  var roleShortageLabels = []
  var roleShortageDetails = []
  var seenDetailTexts = {} // 同じ持ち場別人数の組み合わせが複数枠で繰り返されるのを防ぐ

  for (var s = 0; s <= slots.length - 1; s++) {
    var slot = slots[s]
    var slotStartMs = slot.start.getTime()
    var slotEndMs = slot.end.getTime()
    if (!(target.rangeStartMs <= slotStartMs && slotEndMs <= target.rangeEndMs)) continue
    var coverage = evaluateSlotCoverage_(slotStartMs, slotEndMs, SHIFT_JUDGE_START_HOUR_ + s, dayType, mergedRangesByEmployee, getBadgesCached, target.employee_id)
    if (!coverage.countOk) {
      countShortageLabels.push(slot.label)
      continue
    }
    if (!coverage.roleAssignable) {
      roleShortageLabels.push(slot.label)
      var summary = buildRoleCoverageSummary_(coverage.roleSlots, coverage.present)
      var parts = []
      for (var p = 0; p <= summary.length - 1; p++) {
        parts.push(summary[p].label + '：必要' + summary[p].required + '人／担当可能' + summary[p].eligibleCount + '人')
      }
      var detailText = parts.join('、')
      if (!seenDetailTexts[detailText]) {
        seenDetailTexts[detailText] = true
        roleShortageDetails.push(detailText)
      }
    }
  }

  var messages = []
  if (countShortageLabels.length > 0) {
    messages.push('外すと人数が不足する時間帯があります（' + countShortageLabels.join('、') + '）')
  }
  if (roleShortageLabels.length > 0) {
    messages.push(
      '外すと必要な持ち場を重複なく割り当てられない時間帯があります（' + roleShortageLabels.join('、') + '）。'
      + '参考情報 - ' + roleShortageDetails.join('／')
    )
  }

  return {
    count_shortage_labels: countShortageLabels,
    role_shortage_labels: roleShortageLabels,
    role_shortage_details: roleShortageDetails,
    text: messages.length === 0 ? '勤務時間内に該当する時間帯がありません' : messages.join('。')
  }
}

/**
 * describeNoCandidateReason_の構造化データを、画面表示用の行配列にする
 * 「人数不足：…」「持ち場不足：…」「参考：…」を別行にし、店主が修正箇所を見つけやすくする
 */
function buildNoCandidateDetailLines_(reason) {
  var lines = []
  if (reason.count_shortage_labels.length > 0) {
    lines.push('人数不足：' + reason.count_shortage_labels.join('、'))
  }
  if (reason.role_shortage_labels.length > 0) {
    lines.push('持ち場不足：' + reason.role_shortage_labels.join('、'))
  }
  if (reason.role_shortage_details.length > 0) {
    lines.push('参考：' + reason.role_shortage_details.join('、'))
  }
  if (lines.length === 0) {
    lines.push('勤務時間内に該当する時間帯がありません')
  }
  return lines
}

/**
 * 休憩が必要な全員へ、同じ1時間枠内の休憩分数合計が60分以下になるよう、重複しない候補枠を割り当てる
 * 個々の候補は成立済み（collectCandidateSlotsForTarget_で確認済み）なので、ここでは枠の競合だけを解く
 * 割当はtarget_id（勤務ブロック単位）で管理する。同じ従業員に休憩対象ブロックが2本あっても、
 * 別々のtarget_idとして扱われるため、一方の割当がもう一方を上書きすることはない
 *
 * 割当不能ケースで探索が急増しないよう、次の2点で抑える
 * 1. 探索順は元のtargets順ではなく、候補枠が少ない対象者を先、同数なら必要休憩時間が長い対象者を先にする
 *    （制約が厳しい対象者を先に確定させ、矛盾を早期に検出する。表示順に使うtargets自体は並び替えない）
 * 2. 「この探索位置でこのslot使用状況に達すると必ず失敗する」状態をメモ化し、同じ状態を再訪しない
 */
function assignBreakSlots_(targets) {
  var order = targets.map(function (t, i) { return i })
  order.sort(function (ia, ib) {
    var a = targets[ia], b = targets[ib]
    if (a.candidate_slots.length !== b.candidate_slots.length) {
      return a.candidate_slots.length - b.candidate_slots.length
    }
    return b.required_minutes - a.required_minutes
  })

  var slotUsedMinutes = {}
  var assignment = {} // target_id -> slotIndex
  var failedStates = {} // "探索位置|slot使用状況の文字列" -> true（この状態は必ず失敗する）

  function serializeSlotUsage_() {
    var keys = Object.keys(slotUsedMinutes).sort()
    var parts = []
    for (var k = 0; k <= keys.length - 1; k++) {
      parts.push(keys[k] + ':' + slotUsedMinutes[keys[k]])
    }
    return parts.join(',')
  }

  function backtrack(pos) {
    if (pos > order.length - 1) return true

    var stateKey = pos + '|' + serializeSlotUsage_()
    if (failedStates[stateKey]) return false

    var t = targets[order[pos]]
    for (var c = 0; c <= t.candidate_slots.length - 1; c++) {
      var slotIdx = t.candidate_slots[c]
      var used = slotUsedMinutes[slotIdx] || 0
      if (used + t.required_minutes > 60) continue
      slotUsedMinutes[slotIdx] = used + t.required_minutes
      assignment[t.target_id] = slotIdx
      if (backtrack(pos + 1)) return true
      slotUsedMinutes[slotIdx] = used
      delete assignment[t.target_id]
    }

    failedStates[stateKey] = true
    return false
  }

  var success = backtrack(0)
  return { success: success, assignment: assignment }
}

/**
 * 休憩可能性判定の本体。対象者ごとの候補枠列挙と、全員分の重複しない割り当てをまとめて行う
 * 「休憩可能候補がある」という当日の判断材料であり、休憩の取得や安定営業を保証する結果ではない
 */
function judgeBreakPossibility_(businessDate, dayType, slots, mergedRangesByEmployee, getBadgesCached, nameMap) {
  var businessRange = getBusinessDayRange_(businessDate)
  var rawTargets = collectBreakTargets_(mergedRangesByEmployee, businessRange.start.getTime(), businessRange.end.getTime(), nameMap)

  if (rawTargets.length === 0) {
    return {
      targets: [],
      overall_status: 'no_target',
      overall_message: 'この営業日に休憩が必要な長時間勤務者（6時間以上）はいません'
    }
  }

  var targets = []
  for (var i = 0; i <= rawTargets.length - 1; i++) {
    var t = rawTargets[i]
    var candidateSlots = collectCandidateSlotsForTarget_(t, slots, dayType, mergedRangesByEmployee, getBadgesCached)
    targets.push({
      target_id: t.target_id,
      employee_id: t.employee_id,
      employee_name: t.employee_name,
      shift_label: formatMsAsHourLabel_(t.rangeStartMs, businessDate) + '〜' + formatMsAsHourLabel_(t.rangeEndMs, businessDate),
      duration_hours: Math.round((t.rangeEndMs - t.rangeStartMs) / (60 * 60 * 1000)),
      required_minutes: t.required_minutes,
      candidate_slots: candidateSlots,
      no_candidate_reason: candidateSlots.length === 0
        ? describeNoCandidateReason_(t, slots, dayType, mergedRangesByEmployee, getBadgesCached)
        : ''
    })
  }

  var assignResult = assignBreakSlots_(targets)

  var results = []
  for (var j = 0; j <= targets.length - 1; j++) {
    var tg = targets[j]
    var status, note, detailLines
    if (tg.candidate_slots.length === 0) {
      status = 'no_candidate'
      note = tg.no_candidate_reason.text
      detailLines = buildNoCandidateDetailLines_(tg.no_candidate_reason)
    } else if (assignResult.success && (tg.target_id in assignResult.assignment)) {
      status = 'ok'
      note = ''
      detailLines = ['候補例：' + slots[assignResult.assignment[tg.target_id]].label + 'の間']
    } else {
      status = 'conflict'
      note = '他の対象者と休憩時間帯が重なり、一人ずつでは全員分を確保できません'
      detailLines = [note]
    }
    results.push({
      employee_id: tg.employee_id,
      employee_name: tg.employee_name,
      shift_label: tg.shift_label,
      duration_hours: tg.duration_hours,
      required_minutes: tg.required_minutes,
      status: status,
      candidate_slot_label: status === 'ok' ? slots[assignResult.assignment[tg.target_id]].label : '',
      note: note,
      detail_lines: detailLines
    })
  }

  return {
    targets: results,
    overall_status: assignResult.success ? 'ok' : 'difficult',
    overall_message: assignResult.success
      ? '全員が一人ずつ連続休憩を取れる候補があります。当日の混雑を見て休憩時刻を決めてください（取得を保証するものではありません）'
      : '全員分の休憩を一人ずつ確保できる組み合わせが見つかりませんでした。対象者ごとの注意を確認してください'
  }
}
