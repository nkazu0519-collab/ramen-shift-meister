'use strict'

var assert = require('assert')
var loader = require('./load_all_gs_')
var app = loader.loadAllGsIntoSandbox_().sandbox

var businessDate = new Date(2026, 8, 14)
var businessRange = app.getBusinessDayRange_(businessDate)

assert.strictEqual(businessRange.start.getHours(), 11, '営業時間は11:00に始まる')
assert.strictEqual(businessRange.end.getDate(), 15, '営業時間の終了日は翌日になる')
assert.strictEqual(businessRange.end.getHours(), 3, '営業時間は翌3:00に終わる')

function at(day, hour) {
  return new Date(2026, 8, day, hour, 0).getTime()
}

assert.strictEqual(app.doesShiftOverlapBusinessHours_(at(14, 8), at(14, 14), businessDate), true,
  '開店前から始まり営業時間へ続く勤務は対象になる')
assert.strictEqual(app.doesShiftOverlapBusinessHours_(at(15, 2), at(15, 5), businessDate), true,
  '営業時間内から閉店後へ続く勤務は対象になる')
assert.strictEqual(app.doesShiftOverlapBusinessHours_(at(14, 8), at(14, 11), businessDate), false,
  '開店時刻で終わる勤務は重ならない')
assert.strictEqual(app.doesShiftOverlapBusinessHours_(at(15, 3), at(15, 6), businessDate), false,
  '閉店時刻から始まる勤務は重ならない')

var slots = app.buildJudgeSlots_(businessDate)
assert.strictEqual(slots.length, 16, '判定対象は16個の1時間枠')
assert.strictEqual(slots[0].start.getHours(), 11, '判定対象は11:00から始まる')
assert.strictEqual(slots[15].end.getHours(), 3, '判定対象は翌3:00に終わる')

console.log('time_domain_test: OK')
