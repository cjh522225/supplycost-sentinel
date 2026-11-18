import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'

const root = process.cwd()
const markdown = readFileSync(join(root, 'docs', '申报书.md'), 'utf8')
const lines = markdown.split(/\r?\n/)

const TEAM = [
  ['项目名称', '链价智控 — 供应链成本监测与动态调价预警智能体'],
  ['赛道名称', 'AI+供应链'],
  ['团队名称', '坏了坏了这下好了'],
  ['项目成员', '—'],
  ['指导老师', '（待填写）'],
  ['参赛单位', '广东科技学院'],
  ['联系方式', 'https://github.com/cjh522225'],
  ['版本 / 日期', '1.0.0 / 2026 年 10 月']
]

function cleanInline(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\\\(/g, '')
    .replace(/\\\)/g, '')
    .replace(/\\\[/g, '')
    .replace(/\\\]/g, '')
    .replace(/\\/g, '')
    .trim()
}

function isFormulaLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('\\[') ||
    trimmed.startsWith('\\]') ||
    trimmed.startsWith('\\(') ||
    trimmed.startsWith('\\)') ||
    trimmed.includes('\\bar') ||
    trimmed.includes('\\frac') ||
    trimmed.includes('\\sum') ||
    trimmed.includes('\\in')
  )
}

function makeTable(rows: string[][], header = true): Table {
  const columnCount = Math.max(...rows.map((row) => row.length))
  const width = Math.floor(100 / columnCount)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDD8' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDD8' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDD8' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDD8' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E5EAE7' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E5EAE7' }
    },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: Array.from({ length: columnCount }, (_, index) => {
            const text = row[index] ?? ''
            return new TableCell({
              width: { size: width, type: WidthType.PERCENTAGE },
              shading: header && rowIndex === 0 ? { fill: 'EAF4F1' } : undefined,
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              children: [
                new Paragraph({
                  spacing: { after: 0 },
                  children: [
                    new TextRun({
                      text: cleanInline(text),
                      bold: header && rowIndex === 0,
                      size: 19,
                      color: header && rowIndex === 0 ? '0F5132' : '1F2937'
                    })
                  ]
                })
              ]
            })
          })
        })
    )
  })
}

const children: (Paragraph | Table)[] = []
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 900, after: 180 },
    children: [new TextRun({ text: '东莞市2026年工业AI应用创新挑战', size: 30, bold: true, color: '0F766E' })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: '“百景大赛”项目报告', size: 44, bold: true, color: '0B1F1C' })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 500 },
    children: [new TextRun({ text: '链价智控', size: 52, bold: true, color: '0F766E' })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 700 },
    children: [new TextRun({ text: '供应链成本监测与动态调价预警智能体', size: 24, color: '475569' })]
  }),
  makeTable(TEAM, false),
  new Paragraph({ children: [new PageBreak()] })
)

let index = 0
let skippedMetaTable = false
while (index < lines.length) {
  const raw = lines[index]
  const trimmed = raw.trim()
  if (!trimmed || isFormulaLine(raw)) {
    index += 1
    continue
  }
  if (trimmed.startsWith('|')) {
    const rows: string[][] = []
    let cursor = index
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      const row = lines[cursor]
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
      const isSeparator = row.every((cell) => /^:?-{2,}:?$/.test(cell))
      if (!isSeparator) rows.push(row)
      cursor += 1
    }
    const isMetaTable = !skippedMetaTable && rows[0]?.includes('项目') && rows[0]?.includes('内容')
    if (isMetaTable) {
      skippedMetaTable = true
    } else if (rows.length) {
      children.push(makeTable(rows, true), new Paragraph({ spacing: { after: 120 } }))
    }
    index = cursor
    continue
  }
  if (trimmed.startsWith('### ')) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        children: [new TextRun({ text: cleanInline(trimmed.slice(4)), bold: true, size: 25, color: '0F766E' })]
      })
    )
    index += 1
    continue
  }
  if (trimmed.startsWith('## ')) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 140 },
        children: [new TextRun({ text: cleanInline(trimmed.slice(3)), bold: true, size: 31, color: '0B1F1C' })]
      })
    )
    index += 1
    continue
  }
  if (trimmed.startsWith('# ')) {
    index += 1
    continue
  }
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 70 },
        children: [new TextRun({ text: cleanInline(trimmed.slice(2)), size: 21, color: '334155' })]
      })
    )
    index += 1
    continue
  }
  children.push(
    new Paragraph({
      spacing: { after: 110, line: 340 },
      children: [new TextRun({ text: cleanInline(trimmed), size: 21, color: '334155' })]
    })
  )
  index += 1
}

children.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 140 },
    children: [new TextRun({ text: '附录：验收运行摘要', bold: true, size: 31, color: '0B1F1C' })]
  }),
  makeTable(
    [
      ['检查项', '结果'],
      ['PBOC / SMM 历史回填', '2015-01 至 2026-10，已落盘并聚合'],
      ['Vitest 单元测试', '73 项全部通过'],
      ['验收检查', '历史均值、本地文件、时间轮转、跨年读取、动态配置、数据准确性全部通过'],
      ['独立复算', '欧元/人民币 2026-09 月均复算差值 0'],
      ['动态配置实测', '新增 GBP、移除 EUR、AZ91D→AM60B、恢复默认，面板正常重构'],
      ['安装包', 'NSIS，按用户安装，不自启']
    ],
    true
  ),
  new Paragraph({
    spacing: { before: 260 },
    children: [new TextRun({ text: '说明：以上结果来自本机开发环境实际运行；正式提交前可再次执行 npm test、npm run typecheck、验收模式与独立校验脚本。', size: 18, color: '64748B' })]
  })
)

const document = new Document({
  creator: '坏了坏了这下好了',
  title: '链价智控 — 供应链成本监测与动态调价预警智能体',
  description: '东莞市2026年工业AI应用创新挑战“百景大赛”项目报告',
  styles: {
    default: {
      document: {
        run: { font: 'Microsoft YaHei', size: 21, color: '334155' },
        paragraph: { spacing: { line: 340 } }
      }
    }
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: '链价智控 · 百景大赛项目报告', size: 16, color: '94A3B8' })]
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: '第 ', size: 16, color: '94A3B8' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94A3B8' }),
                new TextRun({ text: ' 页', size: 16, color: '94A3B8' })
              ]
            })
          ]
        })
      },
      children
    }
  ]
})

async function main(): Promise<void> {
  const buffer = await Packer.toBuffer(document)
  const out = join(root, 'docs', '申报书-链价智控.docx')
  writeFileSync(out, buffer)
  console.log(`report written: ${out} (${buffer.length} bytes)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
