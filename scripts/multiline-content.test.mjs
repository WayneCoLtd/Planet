import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('plain-text paste keeps blank lines and indentation, including Windows newlines', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const start = source.indexOf('function parseNightReadingPasteText(')
  const end = source.indexOf('\nfunction ', start + 1)
  const context = vm.createContext({})
  vm.runInContext(source.slice(start, end) + '\nglobalThis.parse = parseNightReadingPasteText;', context)
  const result = context.parse('第一行\r\n\r\n\r\n  第二段\r\n第三行')
  assert.equal(result.length, 1)
  assert.equal(result[0].text, '第一行\n\n\n  第二段\n第三行')
  assert.equal(context.parse('  \n ').length, 0)
})

test('legacy reading migration retains authored paragraphs, blank lines and gallery order', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const start = source.indexOf('function buildNightReadingBlocksFromLegacy(')
  const end = source.indexOf('\nfunction ', start + 1)
  const context = vm.createContext({})
  vm.runInContext(source.slice(start, end) + '\nglobalThis.convert = buildNightReadingBlocksFromLegacy;', context)
  const text = '第一行\n第二行\n\n\n  缩进的第四段\n末行'
  const result = context.convert(text, ['one.jpg', 'two.jpg'])
  assert.equal(result[0].text, text)
  assert.deepEqual(Array.from(result, item => item.type), ['text', 'image', 'image'])
  assert.deepEqual(Array.from(result.slice(1), item => item.url), ['one.jpg', 'two.jpg'])
  assert.equal(context.convert('', [], true)[0].text, '')
})
