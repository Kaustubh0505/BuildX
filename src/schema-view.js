const GENERIC_HEADINGS = /^(?:data (?:model|entities|schema)|entities|schema|relationships|notes|overview)$/i

function clean(value) {
  return value.replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim()
}

function parseField(line) {
  const table = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)(?:\s*\|.*)?$/.exec(line)
  if (table) {
    const name = clean(table[1])
    if (!name || /^[-: ]+$/.test(name) || /^(?:field|column|attribute|name)$/i.test(name)) return null
    return { name, detail: clean(table[2]) }
  }
  const bullet = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\*\*)?([\w][\w .-]{0,45}?)(?:\*\*)?\s*(?::|—|–|\(|\|)\s*(.*?)\)?\s*$/.exec(line)
  if (!bullet) return null
  return { name: clean(bullet[1]), detail: clean(bullet[2]) }
}

export function parseDataEntities(markdown) {
  const entities = []
  let current = null
  let inCode = false

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue }
    if (inCode) continue

    const heading = /^\s*#{2,5}\s+(.+?)\s*#*\s*$/.exec(line)
    const boldHeading = /^\s*(?:[-*]\s+)?\*\*([^*]+)\*\*\s*:?\s*$/.exec(line)
    const title = clean(heading?.[1] || boldHeading?.[1] || '')
    if (title && GENERIC_HEADINGS.test(title)) { current = null; continue }
    if (title && !GENERIC_HEADINGS.test(title)) {
      current = { name: title.replace(/^entity\s*:\s*/i, ''), fields: [] }
      entities.push(current)
      continue
    }

    if (!current) {
      const entityLine = /^\s*[-*]\s+([A-Z][\w ]{1,35})\s*:\s*(.+)$/.exec(line)
      if (entityLine) {
        current = { name: clean(entityLine[1]), fields: [] }
        entities.push(current)
        for (const field of entityLine[2].split(',')) {
          const name = clean(field)
          if (name) current.fields.push({ name, detail: '' })
        }
      }
      continue
    }

    const field = parseField(line)
    if (field) current.fields.push(field)
  }

  return entities.filter((entity) => entity.name).slice(0, 8)
}
