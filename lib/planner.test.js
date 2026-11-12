// Self-check: node lib/planner.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const p = require('./planner')

const day = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi)
const from = day(2026, 11, 2), to = day(2026, 11, 16) // Mon 2 Nov to Mon 16 Nov, local time

const ics = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'SUMMARY:One off\\, with comma', 'DTSTART:20261105T093000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20261110', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Stand', '  up', 'DTSTART;TZID=Europe/London:20261005T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=Europe/London:20261104T100000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Daily x3', 'DTSTART:20261112T080000', 'RRULE:FREQ=DAILY;COUNT=3', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Ended', 'DTSTART:20261001T080000', 'RRULE:FREQ=DAILY;UNTIL=20261020T000000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Cancelled', 'DTSTART:20261106T080000', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Outside', 'DTSTART:20261201T080000', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const ev = p.parseICS(ics, from, to)
const titles = ev.map(e => e.title)
assert.ok(titles.includes('One off, with comma'), 'unescapes commas')
assert.ok(titles.includes('Stand up'), 'unfolds continued lines')
assert.ok(!titles.includes('Cancelled') && !titles.includes('Outside') && !titles.includes('Ended'), 'drops cancelled, outside and ended events')
const stand = ev.filter(e => e.title === 'Stand up').map(e => new Date(e.start).getDate())
assert.deepStrictEqual(stand, [2, 9, 11], 'weekly MO,WE in range, minus the EXDATE on Wed 4')
assert.strictEqual(ev.filter(e => e.title === 'Daily x3').length, 3, 'COUNT limits a daily rule')
assert.strictEqual(ev.find(e => e.title === 'All day').allDay, true, 'VALUE=DATE is all day')
assert.ok(ev.every((e, i) => !i || ev[i - 1].start <= e.start), 'sorted by start')

assert.strictEqual(p.feedUrl('webcal://example.com/a.ics'), 'https://example.com/a.ics')
assert.throws(() => p.feedUrl('http://example.com/a.ics'), /https/)
assert.throws(() => p.feedUrl('file:///etc/passwd'), /https/)

const c = p.clean({ todos: [{ id: 'a1', text: 'x', done: 1, extra: 'drop' }, { text: '  ' }], notes: 'n', events: [{ title: 't', date: '2026-11-06', time: '9am' }, { title: 'bad', date: 'soon' }] })
assert.deepStrictEqual(c.todos, [{ id: 'a1', text: 'x', done: true }], 'keeps known fields, drops empty todos')
assert.strictEqual(c.events.length, 1); assert.strictEqual(c.events[0].time, '', 'bad time becomes empty')
assert.throws(() => p.clean({ todos: 'x', notes: '', events: [] }), /bad planner body/)

const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'planner-')), 'data', 'planner.json')
assert.deepStrictEqual(p.read(f).todos, [], 'missing file reads empty')
p.write(f, { ...c, calendarUrl: '' }); assert.strictEqual(p.read(f).notes, 'n', 'round trip')
console.log('planner ok')
