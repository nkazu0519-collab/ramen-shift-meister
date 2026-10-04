/**
 * 機能1: マイスター登録とスコア化
 */
var MEISTER_KEYS = ['手洗い伝道師', 'ホール', 'セット', '仕込み', '麺上げ']
var MEISTER_POINTS = {
  '手洗い伝道師': 1,
  'ホール': 3,
  'セット': 4,
  '仕込み': 4,
  '麺上げ': 5
}
var SHEET_NAME_MAISTER = 'マイスターマスタ'

/**
 * マイスターマスタシートから対象従業員の行番号を返す（未登録ならnull）
 */
function getMaisterRowNumber_(empId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_MAISTER)
  var last_row = sheet.getLastRow()
  if (last_row < 2) return null
  var idRange = sheet.getRange(2, 1, last_row - 1, 1).getValues()
  for (var i = 0; i <= idRange.length - 1; i++) {
    if (String(idRange[i][0]) == String(empId)) {
      return i + 2 // ヘッダー分のズレ+1、配列0始まりのズレ+1
    }
  }
  return null
}

/**
 * 指定した従業員のマイスター取得状況を返す（{手洗い伝道師: true/false, ...}）
 * マイスターマスタに行がない場合は全技能なし（false）として安全に扱う
 */
function getMaisterBadgesForEmp_(empId) {
  var rowNumber = getMaisterRowNumber_(empId)
  var badges = {}
  if (rowNumber == null) {
    for (var i = 0; i <= MEISTER_KEYS.length - 1; i++) {
      badges[MEISTER_KEYS[i]] = false
    }
    return badges
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_MAISTER)
  var values = sheet.getRange(rowNumber, 2, 1, MEISTER_KEYS.length).getValues()[0]
  for (var i = 0; i <= MEISTER_KEYS.length - 1; i++) {
    badges[MEISTER_KEYS[i]] = values[i] === true
  }
  return badges
}

/**
 * 選択中の従業員のマイスター取得状況を返す（{手洗い伝道師: true/false, ...}）
 */
function getMaisterBadges() {
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  return getMaisterBadgesForEmp_(selectedEmpId)
}

/**
 * マイスタースコアを合計する
 */
function calcMaisterScore(badges) {
  var score = 0
  for (var i = 0; i <= MEISTER_KEYS.length - 1; i++) {
    var key = MEISTER_KEYS[i]
    if (badges[key]) {
      score += MEISTER_POINTS[key]
    }
  }
  return score
}

/**
 * 画面のチェックボックス表示用に、マイスター区分・点数・チェック状態をまとめて返す
 */
function getMaisterDisplayList() {
  var badges = getMaisterBadges()
  var list = []
  for (var i = 0; i <= MEISTER_KEYS.length - 1; i++) {
    var key = MEISTER_KEYS[i]
    list.push({
      key: key,
      points: MEISTER_POINTS[key],
      checked: badges[key]
    })
  }
  return list
}

/**
 * 全従業員分のマイスター概要（取得済みマイスター名の配列・技能点・登録済みか）を、
 * マイスターマスタの1回のgetValues()だけでまとめて返す（従業員IDをキーにしたオブジェクト）
 * シフト登録フォームで従業員を選ぶたびに通信しないよう、ページ表示時に1回だけ呼ぶことを想定
 * 既存のMEISTER_KEYS・MEISTER_POINTS・calcMaisterScore()を再利用し、点数定義は重複させない
 * 同じ従業員IDが複数行ある場合は、getMaisterRowNumber_と同じく最初の行を採用する
 */
function getAllMaisterSummaries() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_MAISTER)
  var last_row = sheet.getLastRow()
  var summaries = {}
  if (last_row < 2) return summaries
  var values = sheet.getRange(2, 1, last_row - 1, 1 + MEISTER_KEYS.length).getValues()
  for (var i = 0; i <= values.length - 1; i++) {
    var row = values[i]
    var empId = String(row[0])
    if (empId in summaries) continue // 重複IDは最初の行を採用する

    var badges = {}
    var acquired = []
    for (var k = 0; k <= MEISTER_KEYS.length - 1; k++) {
      var key = MEISTER_KEYS[k]
      var has = row[1 + k] === true
      badges[key] = has
      if (has) acquired.push(key)
    }

    summaries[empId] = {
      employee_id: empId,
      acquired_meisters: acquired,
      score: calcMaisterScore(badges),
      registered: true
    }
  }
  return summaries
}

/**
 * マイスター取得状況の保存（フォームから呼ばれる）
 * チェックを外した項目はフォーム送信時にキー自体が存在しないので undefined になる
 */
function postMaisterBadges(form) {
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_MAISTER)
  var rowNumber = getMaisterRowNumber_(selectedEmpId)
  if (rowNumber == null) {
    rowNumber = sheet.getLastRow() + 1
    sheet.getRange(rowNumber, 1).setValue(selectedEmpId)
  }
  var values = []
  for (var i = 0; i <= MEISTER_KEYS.length - 1; i++) {
    values.push(form[MEISTER_KEYS[i]] === 'on')
  }
  sheet.getRange(rowNumber, 2, 1, MEISTER_KEYS.length).setValues([values])
  // レビュー対応（9月25日提出版_合計スコア表示の削除）：scoreは既存互換性のため戻り値に
  // 残すが、保存完了メッセージにはスコアを含めない（呼び出し元のview_detail.htmlも
  // messageだけを表示し、scoreは使わない）
  var score = calcMaisterScore(getMaisterBadges())
  return {
    success: true,
    message: '保存しました',
    score: score
  }
}

/**
 * 機能1補助: マイスター一括管理（店主用の独立ページ。selectedEmpId・UserPropertiesには依存しない）
 * freee従業員を行、既存のMEISTER_KEYSを列にした表を1画面で確認・変更し、変更分だけを1回で保存する。
 * 点数・判定ロジックの新定義は行わない（既存のcalcMaisterScore・MEISTER_POINTSをそのまま使う）。
 */

/**
 * freee従業員一覧とマイスターマスタをID（文字列）で結合する純粋関数
 * 未登録従業員は全キーfalseとして扱う。マイスターマスタ側に従業員一覧へ存在しないIDの行があっても、
 * 一括管理の表示行はfreee従業員一覧を正としfreee側の行数・順序で作る（表示に使わない孤立行は無視する）
 */
function buildMeisterBulkRows_(employees, maisterSummaries) {
  var rows = []
  for (var i = 0; i <= employees.length - 1; i++) {
    var emp = employees[i]
    var empId = String(emp.id)
    var summary = maisterSummaries[empId]
    var badges = {}
    for (var k = 0; k <= MEISTER_KEYS.length - 1; k++) {
      var key = MEISTER_KEYS[k]
      badges[key] = !!(summary && summary.acquired_meisters.indexOf(key) >= 0)
    }
    rows.push({
      employee_id: empId,
      employee_name: emp.display_name,
      badges: badges
    })
  }
  return rows
}

/**
 * 技能別の育成優先度（店主用の育成優先度カード、07_ブラッシュアップ/02_企画・設計/技能別育成優先度_最小仕様.md）
 * 対象は次の4技能のみ。MEISTER_KEYSには基礎資格「手洗い伝道師」も含まれるため、ここでは混ぜずに固定配列で明示する
 */
var MEISTER_PRIORITY_SKILL_KEYS = ['ホール', 'セット', '仕込み', '麺上げ']

var MEISTER_PRIORITY_STATUS_LABELS_ = {
  none: '担当者なし',
  single: '一人依存・育成優先',
  multiple: null // 「保有者N人」は人数を埋め込むため個別に組み立てる
}

/**
 * buildMeisterBulkRows_が返すrowsを入力に、技能別の育成優先度を集計する純粋関数
 * 入力rowsは変更しない。対象は上の固定4技能のみ（手洗い伝道師は含めない）
 * 従業員0人（rows.length === 0）でも例外にせず、4技能を0人として返す
 */
function buildMeisterSkillPriority_(rows) {
  var priorities = []
  for (var k = 0; k <= MEISTER_PRIORITY_SKILL_KEYS.length - 1; k++) {
    var key = MEISTER_PRIORITY_SKILL_KEYS[k]
    var holderNames = []
    for (var i = 0; i <= rows.length - 1; i++) {
      var row = rows[i]
      if (row.badges[key] === true) {
        holderNames.push(row.employee_name)
      }
    }
    var count = holderNames.length
    var status, statusLabel
    if (count === 0) {
      status = 'none'
      statusLabel = MEISTER_PRIORITY_STATUS_LABELS_.none
    } else if (count === 1) {
      status = 'single'
      statusLabel = MEISTER_PRIORITY_STATUS_LABELS_.single
    } else {
      status = 'multiple'
      statusLabel = '保有者' + count + '人'
    }
    priorities.push({
      key: key,
      holder_count: count,
      holder_names: holderNames,
      status: status,
      status_label: statusLabel
    })
  }

  // 保有人数の少ない順（0人→1人→2人以上）。同数はMEISTER_PRIORITY_SKILL_KEYSの固定順を維持するため、
  // 安定ソートが前提のArray#sortで人数だけを比較する（同数の要素同士は入れ替えない）
  priorities.sort(function (a, b) { return a.holder_count - b.holder_count })
  return priorities
}

/**
 * マイスター一括管理ページの初期表示データを返す
 * freee従業員一覧（外部API）の取得に失敗した場合はsuccess:falseを返し、rowsを含めない。
 * クライアントはsuccess:falseのとき表を描画せず、編集・保存を無効のままにする
 * （読込失敗時に空の表を保存して全員のデータを解除してしまう事故を防ぐ、最小仕様4章の必須要件）
 *
 * 技能別育成優先度（skill_priority）はbuildMeisterBulkRows_が返すrowsから集計するため、
 * getEmployees()・getAllMaisterSummaries()の追加呼び出しは発生しない
 */
function getMeisterBulkView() {
  var employeesAll
  try {
    employeesAll = getEmployees()
  } catch (err) {
    return { success: false, message: '従業員一覧の取得に失敗しました。時間をおいて再読み込みしてください' }
  }
  if (!employeesAll || !Array.isArray(employeesAll)) {
    return { success: false, message: '従業員一覧の取得に失敗しました。時間をおいて再読み込みしてください' }
  }
  // レビュー対応（育成候補提示_コードレビュー_2026-09-23、必須修正3）：freee従業員一覧は退職者も
  // 含めた全期間の一覧のため、一括管理表・技能別育成優先度は在籍従業員だけへ絞ってから作る
  // （filterActiveEmployeesAsOf_・formatDateKeyFromMs_はmeister_training_candidates.gsで定義。
  // GASは全.gsファイルを同一グローバルスコープとして評価するため、ここから直接呼び出せる）
  var employees = filterActiveEmployeesAsOf_(employeesAll, formatDateKeyFromMs_(getCurrentTimeMs_()))
  var maisterSummaries = getAllMaisterSummaries()
  var rows = buildMeisterBulkRows_(employees, maisterSummaries)
  return { success: true, rows: rows, skill_priority: buildMeisterSkillPriority_(rows) }
}

/**
 * 一括保存リクエストの検証（純粋関数。Spreadsheet・freee APIへは一切アクセスしない）
 * changes: [{ employee_id, badges: { マイスターキー: true/false, ... } }, ...]
 * validEmployeeIds: freee従業員一覧に実在するID（文字列）の配列
 * 1件でも不正があれば valid:false を返し、呼び出し元はどの行も書き込まない（全件検証してから書き込む）
 */
function validateMeisterBulkChanges_(changes, validEmployeeIds) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { valid: false, error: '変更がありません' }
  }
  var validIdSet = {}
  for (var v = 0; v <= validEmployeeIds.length - 1; v++) {
    validIdSet[String(validEmployeeIds[v])] = true
  }
  var meisterKeySet = {}
  for (var mk = 0; mk <= MEISTER_KEYS.length - 1; mk++) {
    meisterKeySet[MEISTER_KEYS[mk]] = true
  }

  var seenIds = {}
  for (var i = 0; i <= changes.length - 1; i++) {
    var change = changes[i]
    if (!change || typeof change !== 'object') {
      return { valid: false, error: '不正な変更データです' }
    }
    var empId = String(change.employee_id)
    if (!change.employee_id && change.employee_id !== 0) {
      return { valid: false, error: '従業員IDが指定されていません' }
    }
    if (seenIds[empId]) {
      return { valid: false, error: '同じ従業員が複数回指定されています（ID: ' + empId + '）' }
    }
    seenIds[empId] = true
    if (!validIdSet[empId]) {
      return { valid: false, error: '存在しない従業員IDが含まれています（ID: ' + empId + '）' }
    }
    var badges = change.badges
    if (!badges || typeof badges !== 'object' || Array.isArray(badges)) {
      return { valid: false, error: '不正なマイスターデータです（ID: ' + empId + '）' }
    }
    var badgeKeys = Object.keys(badges)
    for (var b = 0; b <= badgeKeys.length - 1; b++) {
      var key = badgeKeys[b]
      if (!meisterKeySet[key]) {
        return { valid: false, error: '未定義のマイスターキーです（' + key + '）' }
      }
      if (typeof badges[key] !== 'boolean') {
        return { valid: false, error: 'マイスターの値が不正です（' + key + '）' }
      }
    }
  }
  return { valid: true }
}

/**
 * マイスター一括管理の保存（変更された従業員だけをクライアントから受け取る）
 * 全件の検証（validateMeisterBulkChanges_）を終えてから初めて書き込みを始める。
 * 従業員1人につきgetRange().setValues()を1回だけ呼ぶ（セルごとの書き込みはしない）。
 * 複数タブ・連打からの同時保存を防ぐため、検証後の書き込み全体をLockServiceで直列化する。
 * 既存シートに同一従業員IDの重複行がある場合はgetMaisterRowNumber_と同じ「最初の行」だけを更新し、
 * 2行目以降を黙って書き換えない（安全側。重複行があったこと自体はレスポンスのwarningsで伝える）
 */
function saveMeisterBulkChanges(request) {
  var changes = request && request.changes
  var employeesAll
  try {
    employeesAll = getEmployees()
  } catch (err) {
    return { success: false, message: '従業員一覧の取得に失敗しました。時間をおいて再読み込みしてください' }
  }
  if (!employeesAll || !Array.isArray(employeesAll)) {
    return { success: false, message: '従業員一覧の取得に失敗しました。時間をおいて再読み込みしてください' }
  }
  // レビュー対応（育成候補提示_再コードレビュー_2026-09-23、指摘1）：getMeisterBulkView・
  // getMeisterTrainingCandidatesと同じ在籍集合で保存対象を検証する。表示後から保存までの間に
  // 退職した従業員、入社前・在籍日付を確認できない従業員は保存対象として認めない
  var employees = filterActiveEmployeesAsOf_(employeesAll, formatDateKeyFromMs_(getCurrentTimeMs_()))
  var validEmployeeIds = employees.map(function (e) { return String(e.id) })

  var validation = validateMeisterBulkChanges_(changes, validEmployeeIds)
  if (!validation.valid) {
    return { success: false, message: validation.error }
  }

  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_MAISTER)
    var idOccurrences = countMaisterIdOccurrences_(sheet)
    var warnings = []
    for (var i = 0; i <= changes.length - 1; i++) {
      var change = changes[i]
      var empId = String(change.employee_id)
      if ((idOccurrences[empId] || 0) > 1) {
        // 重複行は最初の行だけを更新し、2行目以降は黙って書き換えない（安全側。理由はレスポンスで伝える）
        warnings.push('従業員ID ' + empId + ' はマイスターマスタに複数行あるため、最初の行だけを更新しました')
      }
      var rowNumber = getMaisterRowNumber_(empId)
      if (rowNumber == null) {
        rowNumber = sheet.getLastRow() + 1
        sheet.getRange(rowNumber, 1).setValue(empId)
      }
      var values = []
      for (var k = 0; k <= MEISTER_KEYS.length - 1; k++) {
        var key = MEISTER_KEYS[k]
        values.push(change.badges.hasOwnProperty(key) ? change.badges[key] : false)
      }
      // 従業員1人分5項目を1回のsetValuesで保存する（セルごとの書き込みをしない）
      sheet.getRange(rowNumber, 2, 1, MEISTER_KEYS.length).setValues([values])
    }
    return { success: true, message: changes.length + '人分を保存しました', saved_count: changes.length, warnings: warnings }
  } finally {
    lock.releaseLock()
  }
}

/**
 * マイスターマスタの全行を1回だけ走査し、従業員IDごとの出現回数を返す（重複行の検出専用）
 * { empId: 出現回数 } の形。getMaisterRowNumber_は最初の行番号しか返さないため、
 * 「複数行あるかどうか」自体はここで別に数える
 */
function countMaisterIdOccurrences_(sheet) {
  var last_row = sheet.getLastRow()
  var counts = {}
  if (last_row < 2) return counts
  var idRange = sheet.getRange(2, 1, last_row - 1, 1).getValues()
  for (var i = 0; i <= idRange.length - 1; i++) {
    var id = String(idRange[i][0])
    counts[id] = (counts[id] || 0) + 1
  }
  return counts
}
