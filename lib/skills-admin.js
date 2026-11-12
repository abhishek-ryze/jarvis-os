// Move user skill folders in and out of <root>/.archive. The root is an argument so tests can use a temp folder.
const fs = require('fs')
const path = require('path')

function move(root, name, from, to) {
  if (!name || name !== path.basename(name) || name.startsWith('.')) throw new Error('bad skill name')
  const src = path.join(root, from, name)
  const dst = path.join(root, to, name)
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error('skill not found')
  if (fs.existsSync(dst)) throw new Error('target exists')
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.renameSync(src, dst)
  return { name, from: src, to: dst }
}

const archive = (root, name) => move(root, name, '.', '.archive')
const unarchive = (root, name) => move(root, name, '.archive', '.')

module.exports = { archive, unarchive }
