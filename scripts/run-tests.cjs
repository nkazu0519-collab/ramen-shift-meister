'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const testDir = path.resolve(__dirname, '..', 'tests', 'unit')
const tests = fs.readdirSync(testDir).filter(name => name.endsWith('_test.js')).sort()
if (tests.length === 0) {
  console.error('No test files found.')
  process.exit(1)
}

let failedFiles = 0
let passedAssertions = 0
let failedAssertions = 0
for (const name of tests) {
  const result = spawnSync(process.execPath, [path.join(testDir, name)], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, TZ: 'Asia/Tokyo' },
    maxBuffer: 16 * 1024 * 1024
  })
  const output = (result.stdout || '') + (result.stderr || '')
  const summaries = [...output.matchAll(/pass=(\d+)\s+fail=(\d+)/g)]
  const summary = summaries.at(-1)
  if (summary) {
    passedAssertions += Number(summary[1])
    failedAssertions += Number(summary[2])
  }
  const failed = result.error || result.status !== 0 || (summary && Number(summary[2]) > 0)
  console.log(`${failed ? 'FAIL' : 'PASS'} ${name}${summary ? `: ${summary[0]}` : ''}`)
  if (failed) {
    failedFiles++
    process.stderr.write(output)
    if (result.error) console.error(result.error.message)
  }
}

console.log(`Files: ${tests.length}; failed files: ${failedFiles}; reported pass=${passedAssertions} fail=${failedAssertions}`)
if (failedFiles > 0 || failedAssertions > 0) process.exit(1)
