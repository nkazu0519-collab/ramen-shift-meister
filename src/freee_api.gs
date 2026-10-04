/**
 * API request optionの共通化
 */
function getRequestOptions(method, payload) {
  return {
    'method' : method || 'get',
    'muteHttpExceptions' : true,
    "contentType": "application/json",
    'headers' : {
      'accept': 'application/json',
      'Authorization': 'Bearer ' + accessToken
    },
    'payload' : payload
  }
}

/**
 * freee public apiから事業所情報を取得して事業所名を返却する
 * https://developer.freee.co.jp/docs/accounting/reference#/Companies/get_company
 */
function getCompanyName() {
  var requestUrl = 'https://api.freee.co.jp//api/1/companies/' + companyId.toString()
  var response = UrlFetchApp.fetch(requestUrl, getRequestOptions())
  var responseJson = JSON.parse(response.getContentText())
  if (response.getResponseCode() != 200) {
    console.error(responseJson.message)
    return responseJson.message
  }
  var companyName = responseJson.company.display_name
  return companyName
}

/**
 * 従業員一覧（全期間・全ページ）
 * https://developer.freee.co.jp/docs/hr/reference#/%E5%BE%93%E6%A5%AD%E5%93%A1/get_company_employees
 *
 * レビュー対応（育成候補提示_コードレビュー_2026-09-23、必須修正1）:
 *   このAPI（GET /api/v1/companies/{company_id}/employees）は「全期間の従業員一覧」であり、
 *   退職者も含めて返す（在籍中だけへの絞り込みは呼び出し元がentry_date/retire_dateで行う。
 *   このファイルは通信専用のため、在籍判定はmeister_training_candidates.gsのfilterActiveEmployees_へ分離する）。
 *   また1ページの最大件数は100件（公式仕様の上限）のため、limit=100・offsetでページングし、
 *   1ページの返却件数がlimitを下回るまで（＝最終ページに達するまで）取得を続ける。
 *   各ページはHTTPステータス200・JSON.parseが例外を投げないこと・レスポンスが配列であることを
 *   個別に検証し、いずれかを満たさない場合は例外を投げて呼び出し元の既存失敗処理
 *   （getMeisterBulkView・getMeisterTrainingCandidates等のtry/catch）へそのまま委ねる
 *   （従来どおり、このファイル自体は失敗時のフォールバック値を作らない）。
 *   offsetは実際に取得できた件数（ページの長さ）だけ進める（limit固定値を進めると、
 *   万一ページ長がlimitと異なる応答が来た場合に無限ループ・欠落の原因になるため）。
 *   ページの結合順（APIが返した順）はそのまま維持し、独自の並び替えをしない。
 */
function getEmployees() {
  var limit = 100
  var offset = 0
  var allEmployees = []
  while (true) {
    var requestUrl = 'https://api.freee.co.jp/hr/api/v1/companies/'
      + companyId.toString()
      + '/employees?limit=' + limit + '&offset=' + offset + '&with_no_payroll_calculation=true'
    var response = UrlFetchApp.fetch(requestUrl, getRequestOptions())
    if (response.getResponseCode() != 200) {
      throw new Error('従業員一覧の取得に失敗しました（HTTP ' + response.getResponseCode() + '）')
    }
    var page
    try {
      page = JSON.parse(response.getContentText())
    } catch (err) {
      throw new Error('従業員一覧のレスポンスが不正なJSON形式です')
    }
    if (!Array.isArray(page)) {
      throw new Error('従業員一覧のレスポンスが配列ではありません')
    }

    allEmployees = allEmployees.concat(page) // APIが返した順のまま連結する（並び替えない）

    if (page.length < limit) break // 最終ページ（返却件数がlimit未満）に達した
    offset += page.length // 実際に取得できた件数だけ進める（limit固定値を進めない）
  }
  return allEmployees
}

/**
 * 従業員情報の取得
 * ※ デバッグするときにはselectedEmpIdを存在するIDで書き換えてください
 */
function getEmployee() {
  var selectedEmpId = PropertiesService.getUserProperties().getProperty('selectedEmpId')
  var requestUrl = 'https://api.freee.co.jp/hr/api/v1/employees/'
    + selectedEmpId.toString()
    + '?company_id=' + companyId.toString()
    + '&year=2022&month=9'  // ※ 年月を指定しているので注意
  var response = UrlFetchApp.fetch(requestUrl, getRequestOptions())
  var responseJson = JSON.parse(response.getContentText())
  if (response.getResponseCode() != 200) {
    console.error(responseJson.message)
    return responseJson.message
  }
  return responseJson
}
