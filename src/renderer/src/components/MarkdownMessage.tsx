import type { ReactNode } from 'react'
import { cn } from '../lib/format'

interface TableBlock {
  header: string[]
  rows: string[][]
  align: Array<'left' | 'center' | 'right'>
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function alignmentOf(line: string): Array<'left' | 'center' | 'right'> {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : right ? 'right' : 'left'
  })
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]
  if (!line.trim()) return true
  if (/^#{1,4}\s+/.test(line)) return true
  if (/^```/.test(line)) return true
  if (/^>\s?/.test(line)) return true
  if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) return true
  if (/^---+$/.test(line.trim())) return true
  if (line.includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1])) return true
  return false
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${index}`
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.92em] dark:bg-slate-700/80">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link && /^(https?:\/\/|#|\/)/i.test(link[2])) {
        nodes.push(<a key={key} className="text-teal-700 underline dark:text-teal-300" href={link[2]} target={link[2].startsWith('http') ? '_blank' : undefined} rel="noreferrer">{link[1]}</a>)
      } else {
        nodes.push(token)
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    cursor = match.index + token.length
    index += 1
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function Table({ table, keyPrefix }: { table: TableBlock; keyPrefix: string }) {
  const alignOf = (index: number): 'left' | 'center' | 'right' => {
    const declared = table.align[index] ?? 'left'
    if (declared !== 'left') return declared
    const values = table.rows.map((row) => row[index]?.trim()).filter(Boolean)
    return values.length > 0 && values.every((value) => /^[+\-−]?[\d,.]+%?$/.test(value)) ? 'right' : 'left'
  }
  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="ai-table">
        <thead>
          <tr>
            {table.header.map((cell, index) => (
              <th key={`${keyPrefix}-h-${index}`} className={alignOf(index) === 'right' ? 'text-right' : alignOf(index) === 'center' ? 'text-center' : 'text-left'}>
                {renderInline(cell, `${keyPrefix}-h-${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${keyPrefix}-r-${rowIndex}`}>
              {table.header.map((_, cellIndex) => (
                <td key={`${keyPrefix}-c-${rowIndex}-${cellIndex}`} className={cn('tabular', alignOf(cellIndex) === 'right' ? 'text-right' : alignOf(cellIndex) === 'center' ? 'text-center' : 'text-left')}>
                  {renderInline(row[cellIndex] ?? '', `${keyPrefix}-c-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function parseMarkdown(content: string): ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let blockIndex = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    const key = `block-${blockIndex++}`

    if (/^```/.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(<pre key={key} className="my-2 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100"><code>{code.join('\n')}</code></pre>)
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const sizes = ['text-lg', 'text-base', 'text-sm', 'text-[13px]']
      blocks.push(
        <div key={key} className={cn('mt-3 font-semibold text-slate-900 first:mt-0 dark:text-white', sizes[level - 1])}>
          {renderInline(heading[2], key)}
        </div>
      )
      index += 1
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const header = splitRow(line)
      const align = alignmentOf(lines[index + 1])
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitRow(lines[index]))
        index += 1
      }
      blocks.push(<Table key={key} table={{ header, rows, align }} keyPrefix={key} />)
      continue
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line)
      const items: string[] = []
      while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index]) : /^[-*]\s+/.test(lines[index]))) {
        items.push(lines[index].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
        index += 1
      }
      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag key={key} className={cn('my-2 space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ListTag>
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={key} className="my-2 border-l-2 border-teal-400 pl-3 text-slate-500 dark:text-slate-400">{renderInline(quote.join('\n'), key)}</blockquote>)
      continue
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key} className="my-3 border-slate-200 dark:border-slate-700" />)
      index += 1
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index])
      index += 1
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(
      <p key={key} className="my-1 whitespace-pre-wrap">
        {renderInline(paragraph.join('\n'), key)}
      </p>
    )
  }
  return blocks
}

export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
  return <div className={cn('ai-markdown', className)}>{parseMarkdown(content)}</div>
}
