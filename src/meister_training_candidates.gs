/**
 * 育成候補提示（07_ブラッシュアップ/02_企画・設計/育成候補提示_最小仕様.md）。
 *
 * 位置づけ:
 *   技能別の育成優先度カード（meister.gs、buildMeisterSkillPriority_）で「担当者なし（0人）」
 *   「一人依存・育成優先（1人）」と分かった技能について、その技能を持っていない在籍従業員を、
 *   勤務頻度という客観情報とともに一覧できるようにする。システムは候補と根拠を提示するだけで、
 *   誰を育成するかは店主が最終判断する（本人の判断が正データ、システムは断定しない）。
 *
 * 構成（Node.jsテストで直接検証できるよう、freee API呼び出しと集計ロジックを分離する）:
 *   - fetchWorkRecordSummariesForCandidates_: UrlFetchApp.fetchAllでのAPI呼び出し（GAS依存）
 *   - resolveMonthDateKeySet_: 選択月の1日〜月末の日付キー集合を作る純粋関数（月単位化 2026-09-24）
 *   - buildTrainingCandidates_: 候補作成・平均計算・希望日数計算・並び替えを行う純粋関数
 *   - getMeisterTrainingCandidates: 公開関数。検証・再計算・freee呼び出し・純粋関数呼び出しをまとめる
 *
 * 期間の単位（2026-09-24、実機確認での判断）:
 *   希望日数は当初、前半・後半をモーダル内で選ぶ半月単位だったが、育成は半月単位で判断するもの
 *   ではなく、過去実績（直近3か月の月平均勤務日数）とも期間単位が合わないと分かったため、
 *   育成候補モーダルだけを選択月全体（1日〜月末）へ変更した。希望提出画面・提出状況画面が使う
 *   前半・後半の締切仕様（business_day.gs）自体は変更していない。
 *
 * 表示専用処理であり、シート・マイスター・希望シフト・勤務予定・freeeへは一切書き込まない。
 */

/**
 * ミリ秒（getCurrentTimeMs_由来）を、GAS実行環境のタイムゾーン（appsscript.jsonのAsia/Tokyo）で
 * "YYYY-MM-DD"の日付キーへ正規化する。new Date(ms)のgetFullYear/getMonth/getDateはGAS実行環境の
 * タイムゾーンで解釈される値を返す（business_day.gsの他の日付処理と同じ前提。ブラウザ時刻には依存しない）
 */
function formatDateKeyFromMs_(ms) {
  var d = new Date(ms)
  var y = d.getFullYear()
  var m = d.getMonth() + 1
  var day = d.getDate()
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day)
}

/**
 * freeeの従業員一覧（getEmployeesの全件結果、退職者を含む）から、基準日時点で在籍する従業員だけを
 * 抽出する純粋関数（育成候補提示_コードレビュー_2026-09-23、必須修正2）。
 *
 * 判定: entry_date <= 基準日 かつ（retire_dateが空/null、または retire_date >= 基準日）。
 *   - 退職日当日はまだ在籍扱い、退職日の翌日から除外する（>=なので当日を含む）
 *   - 入社日前は除外する（entry_date <= 基準日を満たさない）
 *   - 日付は"YYYY-MM-DD"形式の文字列同士を辞書式比較する（この形式は文字列比較がそのまま
 *     日付の大小比較になるため、Dateへの変換によるタイムゾーンのずれを持ち込まない）
 *
 * entry_dateの扱い（レビュー対応、方針を明示的に固定する）:
 *   entry_dateが欠損・"YYYY-MM-DD"として不正な行は、推測で在籍扱いにせず、この従業員を
 *   在籍集合から除外する（在籍を確認できないデータを「在籍している」とみなす方が、
 *   退職者混入や誤った保有人数につながるリスクが大きいため、安全側＝除外を選ぶ）。
 *   retire_dateは空/null/undefinedを「在籍中（退職日未設定）」として扱う（nullable仕様どおり）。
 *   retire_date自体が非空なのに不正な形式の場合も、安全側として除外する。
 *
 * 入力employees配列・各従業員オブジェクトは変更しない（新しい配列を返す）。
 */
var DATE_KEY_PATTERN_ = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * "YYYY-MM-DD"文字列が実在する暦日かを検証する（レビュー対応、育成候補提示_再コードレビュー_2026-09-23、指摘2）。
 * 正規表現の形式チェックだけでは2026-02-30・2026-13-01・2026-00-10・2026-04-31のような
 * 存在しない日付も通ってしまうため、new Date(y, m-1, d)で日付を作った後、
 * getFullYear/getMonth/getDateを読み戻して入力の年・月・日と一致するかを確認する
 * （月・日が範囲外だとDateは自動的に繰り上がる。例：new Date(2026,1,30)は2026-03-02になる。
 * この繰り上がりを信用せず、生成後の値が入力と一致した場合だけ実在日と判定する）。
 * new Date(y, m-1, d)はUTCへ変換せずローカルの年月日コンポーネントから直接組み立てるため、
 * タイムゾーンによるずれを持ち込まない純粋な暦日検証になる。
 * うるう年の2月29日（例：2028-02-29）は正しく有効、平年の2月29日（例：2026-02-29）は無効になる。
 */
function isValidDateKey_(value) {
  if (typeof value !== 'string') return false
  var m = DATE_KEY_PATTERN_.exec(value)
  if (!m) return false
  var year = Number(m[1])
  var month = Number(m[2])
  var day = Number(m[3])
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  var d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

function filterActiveEmployeesAsOf_(employees, referenceDateKey) {
  if (!Array.isArray(employees)) return []
  var result = []
  for (var i = 0; i <= employees.length - 1; i++) {
    var emp = employees[i]
    if (!emp) continue
    if (!isValidDateKey_(emp.entry_date)) continue // entry_date欠損・不正は在籍扱いにせず除外する

    var hasEntered = emp.entry_date <= referenceDateKey
    if (!hasEntered) continue // 入社日前は除外する

    var retireDate = emp.retire_date
    var isRetiredBeforeReference
    if (retireDate === null || retireDate === undefined || retireDate === '') {
      isRetiredBeforeReference = false // retire_date未設定＝在籍中
    } else if (!isValidDateKey_(retireDate)) {
      isRetiredBeforeReference = true // 不正な形式は安全側として除外する
    } else {
      isRetiredBeforeReference = retireDate < referenceDateKey // 退職日当日は含む（>=なので除外条件は < ）
    }
    if (isRetiredBeforeReference) continue

    result.push(emp)
  }
  return result
}

/**
 * 過去勤務の集計対象とする「現在月を含めない、完了済みの直近3暦月」を返す（[{year, month}, ...]、古い順）。
 * nowYear/nowMonthは呼び出し元が明示的に渡す（getCurrentTimeMs_由来。この関数自体は現在時刻を読まない
 * 純粋関数にし、自動テストから任意の「現在」を注入できるようにする）。年跨ぎ（1月・2月）も正しく処理する
 */
function resolveCompletedPastMonths_(nowYear, nowMonth) {
  var months = []
  for (var back = 3; back >= 1; back--) {
    var d = new Date(nowYear, nowMonth - 1 - back, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }
  return months
}

/**
 * 候補者一人ぶんの3か月分work_daysレスポンスから、月平均勤務日数を計算する純粋関数。
 * summaries: [{ ok: true/false, workDays: number }, ...]（3件、fetchWorkRecordSummariesForCandidates_の
 * 検証結果を渡す想定）。3件すべてok:trueの場合だけ合計を3で割り、小数第1位へ丸めた数値を返す。
 * 1件でもok:falseがあればnullを返す（0日扱いにしない。「取得できません」は呼び出し元の表示側で組み立てる）
 */
function calcAverageWorkDays_(summaries) {
  if (!Array.isArray(summaries) || summaries.length !== 3) return null
  var sum = 0
  for (var i = 0; i <= summaries.length - 1; i++) {
    if (!summaries[i] || summaries[i].ok !== true) return null
    if (typeof summaries[i].workDays !== 'number' || !isFinite(summaries[i].workDays)) return null
    sum += summaries[i].workDays
  }
  var avg = sum / 3
  return Math.round(avg * 10) / 10
}

/**
 * 対象年月の1日〜月末までの日付キー（"YYYY-MM-DD"）集合を返す純粋関数（育成候補モーダルの
 * 月単位化 2026-09-24）。
 *
 * 前半・後半で対象営業日を区切るresolveWishPeriodBusinessDates_（希望提出・提出状況の締切仕様で
 * 使用中）とは別の関数として用意する。育成は半月単位で判断するものではなく、過去実績（直近3か月の
 * 月平均勤務日数）と期間単位を揃えるため、育成候補だけをこの月全体版に切り替える
 * （resolveWishPeriodBusinessDates_自体は変更・流用しない）。
 * 月末は28〜31日の違い・年跨ぎ（12月→翌年1月への繰り上がりはnew Dateが自動処理）を正しく扱う
 */
function resolveMonthDateKeySet_(year, month) {
  var lastDayOfMonth = new Date(year, month, 0).getDate() // 翌月0日=当月の最終日
  var set = {}
  for (var d = 1; d <= lastDayOfMonth; d++) {
    set[formatDateInputValueForSheet_(new Date(year, month - 1, d))] = true
  }
  return set
}

/**
 * 選択期間（日付キー集合。育成候補では対象月の1日〜月末、periodDateKeySetという引数名は
 * 呼び出し元の変数名を踏襲している）内で、対象従業員の「時間希望」の一意日付数を数える純粋関数。
 * allWishRows: getAllShiftWishRows_()の戻り値そのもの（呼び出し元で1回だけ取得し、候補者数ぶん
 * 繰り返し取得しない）。出勤不可・対象期間外・別従業員の行は数えない。同じ従業員・同じ営業日に
 * 複数行があっても、日付キーの重複を除いて1日だけ数える（Setに相当する処理をオブジェクトで行う）
 */
function countWishDaysInPeriod_(empId, allWishRows, periodDateKeySet) {
  var seenDateKeys = {}
  var count = 0
  for (var i = 0; i <= allWishRows.length - 1; i++) {
    var w = allWishRows[i]
    if (w.employee_id !== String(empId)) continue
    if (w.answer_type !== SHIFT_WISH_ANSWER_TYPE_TIME_) continue
    if (!w.business_date) continue
    var dateKey = formatDateInputValueForSheet_(w.business_date)
    if (!periodDateKeySet[dateKey]) continue
    if (seenDateKeys[dateKey]) continue
    seenDateKeys[dateKey] = true
    count++
  }
  return count
}

/**
 * 育成候補一覧を組み立てる純粋関数（freee API・シートへは一切アクセスしない）。
 *
 * candidateEmployees: [{ employee_id, employee_name }, ...]（対象技能を持っていない在籍従業員。
 *   freee従業員一覧の順を維持したまま、呼び出し元がbadgesで絞り込み済みのものを渡す）
 * workDaysSummariesByEmpId: { empId: [{ ok, workDays }, ...3件] }（fetchWorkRecordSummariesForCandidates_の
 *   検証済み結果。候補者に対応するエントリがない場合は取得失敗として扱う）
 * allWishRows: getAllShiftWishRows_()の戻り値
 * periodDateKeySet: { 'YYYY-MM-DD': true, ... }（対象月の1日〜月末の日付キー集合。
 *   resolveMonthDateKeySet_の戻り値。引数名は導入時の名残でperiodのままだが、値自体は
 *   月単位化 2026-09-24 以降、月全体を表す）
 *
 * 戻り値は候補者オブジェクトの配列。並び順は最小仕様8章のとおり：
 *   1. 月平均を取得できた候補者を、平均が多い順に並べる
 *   2. 同じ平均値はcandidateEmployeesの順（freee従業員一覧の順）を維持する。希望日数では並べ替えない
 *   3. 月平均を取得できなかった候補者は後ろに置き、その中でもcandidateEmployeesの順を維持する
 * 過去実績と希望日数を混ぜた総合点は作らない（別項目のまま返す）
 */
function buildTrainingCandidates_(candidateEmployees, workDaysSummariesByEmpId, allWishRows, periodDateKeySet) {
  var candidates = []
  for (var i = 0; i <= candidateEmployees.length - 1; i++) {
    var emp = candidateEmployees[i]
    var empId = String(emp.employee_id)
    var summaries = workDaysSummariesByEmpId[empId]
    var avg = summaries ? calcAverageWorkDays_(summaries) : null
    var wishDays = countWishDaysInPeriod_(empId, allWishRows, periodDateKeySet)

    candidates.push({
      employee_id: empId,
      employee_name: emp.employee_name,
      average_work_days: avg, // 取得できた場合は数値（小数第1位）、できなければnull
      wish_day_count: wishDays,
      original_order: i // 安定順を保証するための元の並び位置（freee従業員一覧の順）
    })
  }

  // Array#sortは安定ソートが前提。まず「平均を取得できたか」で2群に分け、
  // 取得できた群だけ平均降順で並べる。同値・取得不能群はoriginal_order（freee従業員一覧の順）を
  // 明示的な最終比較にして、sort実装の安定性に依存しすぎない
  candidates.sort(function (a, b) {
    var aHas = a.average_work_days !== null
    var bHas = b.average_work_days !== null
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (aHas && bHas && a.average_work_days !== b.average_work_days) {
      return b.average_work_days - a.average_work_days
    }
    return a.original_order - b.original_order
  })

  return candidates.map(function (c) {
    return {
      employee_id: c.employee_id,
      employee_name: c.employee_name,
      average_work_days: c.average_work_days,
      wish_day_count: c.wish_day_count
    }
  })
}

/**
 * freee人事労務APIの勤怠情報月次サマリ（work_record_summaries）を、候補者×3か月ぶん
 * UrlFetchApp.fetchAllでまとめて取得し、個別に検証する。
 * レスポンス構造は公式スキーマ（ApiV1EmployeesWorkRecordSummarySerializer）のとおり、
 * トップレベルオブジェクトに work_days（number、労働日数）を直接持つ形。ラップされていない
 * （参照: https://developer.freee.co.jp/reference/hr ,
 *   https://raw.githubusercontent.com/freee/freee-api-schema/master/hr/open-api-3/api-schema.json ）
 *
 * candidateEmployees: [{ employee_id, employee_name }, ...]
 * pastMonths: resolveCompletedPastMonths_の戻り値（[{year, month}, ...3件]）
 * 戻り値: { empId: [{ ok, workDays }, ...3件（pastMonthsと同じ順）] }
 *
 * 各レスポンスは個別に、HTTPステータス200であること・JSON.parseが例外を投げないこと・
 * work_daysがnumber型かつ有限値であることを検証する。いずれか1つでも満たさない月は
 * ok:falseとし、0日扱いにしない（候補者一覧からも除外しない。「取得できません」は
 * 呼び出し元の表示側でnullを見て組み立てる）
 */
function fetchWorkRecordSummariesForCandidates_(candidateEmployees, pastMonths) {
  var requests = []
  // requests配列のインデックスから (候補者インデックス, 月インデックス) を逆引きできるようにする
  var indexMap = []
  for (var e = 0; e <= candidateEmployees.length - 1; e++) {
    for (var m = 0; m <= pastMonths.length - 1; m++) {
      var empId = candidateEmployees[e].employee_id
      var pm = pastMonths[m]
      var url = 'https://api.freee.co.jp/hr/api/v1/employees/' + empId.toString()
        + '/work_record_summaries/' + pm.year + '/' + pm.month
        + '?company_id=' + companyId.toString()
      var options = getRequestOptions()
      options.url = url
      requests.push(options)
      indexMap.push({ empIndex: e, monthIndex: m })
    }
  }

  var result = {}
  for (var ei = 0; ei <= candidateEmployees.length - 1; ei++) {
    result[String(candidateEmployees[ei].employee_id)] = pastMonths.map(function () {
      return { ok: false, workDays: null }
    })
  }
  if (requests.length === 0) return result

  var responses = UrlFetchApp.fetchAll(requests)
  for (var r = 0; r <= responses.length - 1; r++) {
    var mapping = indexMap[r]
    var empId2 = String(candidateEmployees[mapping.empIndex].employee_id)
    result[empId2][mapping.monthIndex] = parseWorkRecordSummaryResponse_(responses[r])
  }
  return result
}

/**
 * UrlFetchApp.fetchAllの1件ぶんのHTTPResponseを検証し、{ok, workDays}へ変換する。
 * 実際のレスポンス構造を推測で固定しない：HTTPステータス・JSON形式・work_daysの有無と
 * 数値妥当性を、この関数の中で毎回個別に確認する
 */
function parseWorkRecordSummaryResponse_(response) {
  var code
  try {
    code = response.getResponseCode()
  } catch (err) {
    return { ok: false, workDays: null } // 通信自体の失敗
  }
  if (code !== 200) return { ok: false, workDays: null } // 非200（権限不足401/403等を含む）

  var json
  try {
    json = JSON.parse(response.getContentText())
  } catch (err) {
    return { ok: false, workDays: null } // 不正JSON
  }
  if (!json || typeof json !== 'object') return { ok: false, workDays: null }

  var workDays = json.work_days
  if (typeof workDays !== 'number' || !isFinite(workDays)) return { ok: false, workDays: null } // work_days欠損・不正値

  return { ok: true, workDays: workDays }
}

/**
 * 育成候補提示の公開関数。技能別の育成優先度カードの「育成候補を見る」から呼ばれる。
 *
 * 育成候補モーダルの月単位化（2026-09-24、実機確認での判断）：育成は半月単位で判断するものでは
 * なく、前半・後半を切り替える意味が分かりにくいため、periodを廃止し年月だけを受け取る。
 * 過去実績（直近3か月の月平均勤務日数）と期間単位を揃え、選択月の1日〜月末までの希望日数を数える。
 * 前半・後半自体（希望提出・提出状況の締切判定、期限後判定）は他画面で使用中のため維持し、
 * この関数・育成候補モーダルの範囲でだけperiodを扱わない。
 *
 * サーバー側で必ず行う検証・再計算（クライアントの入力・表示状態を信用しない）:
 *   1. skillKeyが対象4技能（MEISTER_PRIORITY_SKILL_KEYS）のいずれかであることを検証する
 *      （手洗い伝道師・未定義キーは拒否する）
 *   2. year/monthが有効範囲であることを検証する（既存isValidWishYearMonth_を再利用）
 *   3. 最新のfreee従業員一覧・保存済みマイスター情報を取得し、buildMeisterBulkRows_・
 *      buildMeisterSkillPriority_で対象技能の保有人数を再計算する（クライアントから渡された
 *      人数・取得状況は一切使わない）
 *   4. 保有人数が2人以上へ変わっていた場合は候補を返さず、再読み込みを促すメッセージだけを返す
 *
 * 戻り値: {
 *   success, skill_key, past_months: [{year, month}, ...3件],
 *   wish_year, wish_month, candidates: [...],
 *   partial_failure（一部候補者の勤怠取得に失敗したか）, message
 * }
 * サーバー側で成功と判定できなかった場合はsuccess:falseとメッセージだけを返し、candidatesは含めない
 */
function getMeisterTrainingCandidates(skillKey, year, month) {
  if (MEISTER_PRIORITY_SKILL_KEYS.indexOf(skillKey) === -1) {
    return { success: false, message: '対象技能が不正です' }
  }
  var yearNum = Number(year)
  var monthNum = Number(month)
  if (!isValidWishYearMonth_(yearNum, monthNum)) {
    return { success: false, message: '対象年月が不正です' }
  }

  var nowMs = getCurrentTimeMs_() // 在籍判定・過去3か月算出の両方でこの1つの基準時刻を使う

  var employeesAll
  try {
    employeesAll = getEmployees()
  } catch (err) {
    return { success: false, message: '従業員一覧の取得に失敗しました。時間をおいて再読み込みしてください' }
  }
  if (!employeesAll || !Array.isArray(employeesAll)) {
    return { success: false, message: '従業員一覧の取得に失敗しました。時間をおいて再読み込みしてください' }
  }
  // レビュー対応（育成候補提示_コードレビュー_2026-09-23、必須修正3）：getEmployees()は退職者も
  // 含めた全期間の一覧を返すため、以降の保有人数再計算・候補抽出はすべて在籍従業員だけへ絞ってから行う
  var employees = filterActiveEmployeesAsOf_(employeesAll, formatDateKeyFromMs_(nowMs))

  // 最新の保存済みマイスター情報から、対象技能の保有人数を再計算する
  // （クライアントから渡された人数・取得状況は信用しない。表示後に他の操作で状態が変わっている可能性がある）
  var maisterSummaries = getAllMaisterSummaries()
  var rows = buildMeisterBulkRows_(employees, maisterSummaries)
  var priorities = buildMeisterSkillPriority_(rows)
  var targetPriority = null
  for (var p = 0; p <= priorities.length - 1; p++) {
    if (priorities[p].key === skillKey) { targetPriority = priorities[p]; break }
  }
  if (!targetPriority || targetPriority.status === 'multiple') {
    return {
      success: false,
      message: '対象技能の保有人数がすでに2人以上になっています。画面を再読み込みして最新の育成優先度をご確認ください',
      needs_reload: true
    }
  }

  // 対象技能を持っていない在籍従業員を、freee従業員一覧の順のまま全員候補にする
  var candidateEmployees = []
  for (var r2 = 0; r2 <= rows.length - 1; r2++) {
    if (rows[r2].badges[skillKey] !== true) {
      candidateEmployees.push({ employee_id: rows[r2].employee_id, employee_name: rows[r2].employee_name })
    }
  }

  var nowDate = new Date(nowMs)
  var pastMonths = resolveCompletedPastMonths_(nowDate.getFullYear(), nowDate.getMonth() + 1)

  var workDaysSummariesByEmpId = {}
  var partialFailure = false
  if (candidateEmployees.length > 0) {
    workDaysSummariesByEmpId = fetchWorkRecordSummariesForCandidates_(candidateEmployees, pastMonths)
    for (var k in workDaysSummariesByEmpId) {
      if (calcAverageWorkDays_(workDaysSummariesByEmpId[k]) === null) partialFailure = true
    }
  }

  var periodDateKeySet = resolveMonthDateKeySet_(yearNum, monthNum)
  var allWishRows = getAllShiftWishRows_()

  var candidates = buildTrainingCandidates_(candidateEmployees, workDaysSummariesByEmpId, allWishRows, periodDateKeySet)

  return {
    success: true,
    skill_key: skillKey,
    past_months: pastMonths,
    wish_year: yearNum,
    wish_month: monthNum,
    candidates: candidates,
    partial_failure: partialFailure
  }
}
