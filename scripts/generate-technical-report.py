from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import json

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "report-assets"
OUT = ROOT / "docs" / "链价智控-技术报告.docx"
TEAL = RGBColor(15, 118, 110)
DARK = RGBColor(11, 59, 54)
GRAY = RGBColor(100, 116, 139)
LIGHT_GRAY = RGBColor(148, 163, 184)
FONT = "Microsoft YaHei"


def set_cn_font(run, name=FONT, size=10.5, bold=False, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def cell_text(cell, text, size=9, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, color=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = align
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    run = p.add_run(text)
    set_cn_font(run, size=size, bold=bold, color=color)
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def set_col_widths(table, widths):
    table.autofit = False
    for row in table.rows:
        for idx, width in enumerate(widths):
            row.cells[idx].width = Cm(width)


def repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)


def add_table(doc, headers, rows, widths, caption=None):
    if caption:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run(caption)
        set_cn_font(r, size=9, color=GRAY)
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    hdr = table.rows[0]
    repeat_table_header(hdr)
    for i, text in enumerate(headers):
        cell_text(hdr.cells[i], text, size=9, bold=True, color=DARK)
        shade(hdr.cells[i], "D9E2F3")
    for row in rows:
        cells = table.add_row().cells
        for i, text in enumerate(row):
            align = WD_ALIGN_PARAGRAPH.CENTER if i > 0 else WD_ALIGN_PARAGRAPH.LEFT
            cell_text(cells[i], str(text), size=8.5, align=align)
    set_col_widths(table, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def body(doc, text, space_after=6, indent=True, size=10.5, color=None, bold=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.space_after = Pt(space_after)
    if indent:
        p.paragraph_format.first_line_indent = Cm(0.74)
    r = p.add_run(text)
    set_cn_font(r, size=size, bold=bold, color=color)
    return p


def heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_cn_font(r, size=15 if level == 1 else 12, bold=True, color=DARK if level == 1 else TEAL)
    # bottom rule for level 1
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "3")
        bottom.set(qn("w:color"), "0F766E")
        pBdr.append(bottom)
        pPr.append(pBdr)
    return p


def figure(doc, filename, caption, width=15.8):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run()
    run.add_picture(str(ASSETS / filename), width=Cm(width))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(8)
    r = cap.add_run(caption)
    set_cn_font(r, size=9, color=GRAY)


def add_page_field(paragraph):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)


def add_header_footer(section):
    section.different_first_page_header_footer = True
    header = section.header
    hp = header.paragraphs[0]
    hp.text = ""
    hp.paragraph_format.space_after = Pt(4)
    hp.paragraph_format.tab_stops.add_tab_stop(Cm(16.2), 2)
    r = hp.add_run("东莞市 2026 年工业 AI 应用创新挑战“百景大赛” · AI+供应链 · 技术报告")
    set_cn_font(r, size=8, color=LIGHT_GRAY)
    hp.add_run("\t")
    r2 = hp.add_run("坏了坏了这下好了")
    set_cn_font(r2, size=8, color=LIGHT_GRAY)
    pPr = hp._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:space"), "2")
    bottom.set(qn("w:color"), "CBD5E1")
    pBdr.append(bottom)
    pPr.append(pBdr)
    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("第 ")
    set_cn_font(r, size=8.5, color=LIGHT_GRAY)
    add_page_field(fp)
    r = fp.add_run(" 页")
    set_cn_font(r, size=8.5, color=LIGHT_GRAY)


def title_block(doc):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("东莞市 2026 年工业 AI 应用创新挑战“百景大赛”（技术开发）")
    set_cn_font(r, size=10.5, color=GRAY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(18)
    r = p.add_run("AI+供应链 · 技术报告")
    set_cn_font(r, size=10.5, color=GRAY)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run("链价智控：基于多源校验与本地文件轮转的")
    set_cn_font(r, size=20, bold=True, color=DARK)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(14)
    r = p.add_run("供应链成本监测与动态调价预警智能体")
    set_cn_font(r, size=20, bold=True, color=DARK)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("广东科技学院 · 坏了坏了这下好了")
    set_cn_font(r, size=10, color=GRAY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(12)
    r = p.add_run("版本 1.1.0 · 2026 年 10 月")
    set_cn_font(r, size=9.5, color=LIGHT_GRAY)

    # teal bar
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.rows[0].cells[0]
    cell.width = Cm(15.6)
    shade(cell, "0F766E")
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run(" ")
    r.font.size = Pt(2)


def main():
    doc = Document()
    doc.core_properties.title = "链价智控：供应链成本监测与动态调价预警智能体技术报告"
    doc.core_properties.author = "坏了坏了这下好了"
    doc.core_properties.subject = "东莞市 2026 年工业 AI 应用创新挑战“百景大赛” AI+供应链技术报告"
    doc.core_properties.keywords = "供应链成本; 汇率; SMM; CFETS; 数据校验; 本地文件轮转; 多级均值; 动态配置; 智能体"

    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.1)
    section.left_margin = Cm(2.4)
    section.right_margin = Cm(2.4)
    add_header_footer(section)

    style = doc.styles["Normal"]
    style.font.name = FONT
    style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    style.font.size = Pt(10.5)
    style.paragraph_format.line_spacing = 1.5

    title_block(doc)
    heading(doc, "摘  要", 1)
    body(doc, "针对供应链成本数据分散、口径不一、来源受限和审计困难的问题，本文设计并实现面向 Windows 的桌面端“链价智控”智能体。系统自动抓取中国人民银行人民币汇率中间价、中国外汇交易中心交叉校验数据、上海有色网 ADC12/AZ91D 公开历史价格；Asian Metal 按赛题页允许的手工/CSV 方案接入，不自动登录、不绕过会员限制。原始记录先落盘并保留来源 URL、抓取时间、内容哈希和解析器版本，再经过结构、日期、数值、单位、来源域名、合理区间、日波动、多源偏差和重复冲突校验；失败记录进入隔离区，不进入展示层。有效数据采用 Decimal 全精度计算每日加工均值及月、季、半年、年均值；文件按来源、月和年分卷，跨卷查询自动扫描、排序、去重并拼接。系统支持监测标的动态增删改、阈值/波动/月均偏离/跨源/隔离预警、数据审计、验收检查和可选大模型助手；另设独立的实时行情参考层与大模型流式对话，实时值不进入官方原始数据、校验、聚合、均值或官方预警。当前 PBOC/SMM/CFETS 覆盖 2015—2026 年，CFETS 2015—2022 回填 3,894 条；88 项 Vitest 通过，独立 Python 复算 11,020 条聚合均值 0 失败、21 条提示；Windows 安装包完成安装与启动测试。", size=10)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("关键词：")
    set_cn_font(r, size=10, bold=True, color=DARK)
    r = p.add_run("供应链成本；人民币汇率；SMM；CFETS；数据校验；本地文件轮转；多级均值；动态配置；智能体")
    set_cn_font(r, size=10, color=GRAY)

    heading(doc, "1  背景与任务", 1)
    body(doc, "铝合金压铸、铝型材加工和金属贸易的成本，直接受 ADC12、AZ91D 价格与 EUR/USD 汇率影响。采购需要判断锁价时点，销售需要确定报价有效期，财务需要复核成本波动。实际数据分散在 PBOC、CFETS、SMM、Asian Metal 等网站，单位、报价方向、更新时间和统计口径不一致；中小企业通常人工打开多个网站、复制到 Excel，再手工计算月均或年均，存在来源与计算过程难追溯、漏采错行、响应滞后等问题。")
    body(doc, "赛题要求系统在 Windows 桌面端自动聚合官方信息源，完成数据核验、本地文件留存、多周期均值计算和面板展示，并支持监测标的动态配置；同时明确“优先完成汇率爬取和存取；如大宗交易网站因会员限制/反爬无法自动获取信源，则保留手动填写接口，或者查找同类免费信源网站”。因此，系统需要在数据可信、采集合规、计算可复算和部署轻量之间取得平衡。")
    body(doc, "本文的工作包括：第一，面向 PBOC/CFETS/SMM/Asian Metal 的统一采集与原始凭证；第二，硬规则与 FX 严格跨源校验、金属软告警和隔离区；第三，Decimal 全精度多级均值与“均值分母=有效日数、覆盖率分母=工作日数”的显式口径；第四，按月/年分卷、跨卷拼接、动态监测配置和预警；第五，可选的大模型流式解释、多会话记忆、AI 日报与本地模板兜底；第六，独立实时行情参考层和额度保护；第七，独立复算、验收脚本和安装包验证。")

    heading(doc, "2  系统架构", 1)
    body(doc, "系统采用 Electron 主进程编排、React 渲染进程展示的两层桌面架构。主进程负责网络、校验、聚合、文件、调度和 LLM 调用；渲染进程只通过 preload 暴露的白名单 IPC 访问数据，不直接读写文件。业务数据保存在程序目录下的本地 JSON/CSV 文件，不安装数据库、不注册系统服务、默认不写启动项。")
    add_table(doc,
              ["组件", "职责", "关键实现"],
              [
                  ["数据源适配器", "PBOC/CFETS/SMM 自动采集；Asian Metal 手动/CSV", "统一 RawRecord、URL、哈希、parserVersion"],
                  ["校验与聚合", "硬规则 + FX 严格跨源；日/月/季/半年/年均值", "quarantine/crossSource；Decimal、meanBasis"],
                  ["文件仓库 / 调度", "JSON+CSV、原子写、去重、分卷、跨卷", "10:00/17:00；时间跳变与 rotation log"],
                  ["渲染面板 / LLM", "总览、历史、配置、预警、审计、验收、AI", "preload IPC；safeStorage；模板兜底"],
                  ["实时行情参考层", "第三方报价、1 分钟分时、额度与健康度", "独立存储；能力位；明确演示/延迟标记"],
              ],
              [3.2, 6.2, 6.0],
              "表 1  核心组件与职责")
    figure(doc, "architecture.png", "图 1  链价智控总体架构", 14.6)
    body(doc, "如图 1 所示，PBOC、CFETS、SMM 通过 HTTP 适配器自动采集，Asian Metal 通过手动/CSV 入口进入同一原始记录模型；校验管线将记录分为 valid 与 quarantine；聚合引擎只读取有效数据；文件仓库负责原子写入、去重、月份/年份分卷和跨卷读取；调度器按本地时间触发抓取并检测周期变化；React 面板提供总览、历史、配置、预警、审计、智能分析、验收模式和独立实时参考层。")

    heading(doc, "3  数据与方法", 1)
    heading(doc, "3.1  数据源与合规采集", 2)
    add_table(doc,
              ["数据源", "指标", "采集方式", "本地覆盖", "说明"],
              [
                  ["PBOC", "EUR、USD、GBP、JPY、HKD 等中间价", "自动抓取每日公告", "2015—2026", "官方公开页面；解析正文并归一化"],
                  ["CFETS", "人民币汇率中间价", "自动抓取历史接口", "2015—2026", "2015—2022 回填 3,894 条；交叉校验"],
                  ["SMM", "ADC12、AZ91D、AM60B 等", "自动抓取公开历史接口", "2015—2026", "产品 ID 固定；按年分块、超时重试"],
                  ["Asian Metal", "ADC12、AZ91D", "手动录入 / CSV", "2026 起", "会员限制；不自动登录；历史不足显示 N/A"],
              ],
              [1.4, 4.4, 3.1, 2.3, 5.2],
              "表 2  数据源与采集方式")
    body(doc, "汇率原始公告中的“100 日元”“人民币 1 元对 X 外币”等报价统一折算为 1 单位外币兑人民币；原始 quoteUnit、rawRate、reverse 保存在 meta 中。SMM 按产品 ID 和日期区间请求，按年度分块并限制并发；Asian Metal 提供日期、产品、最低价、最高价、均价、单位、来源链接和备注入口，未填均价时取高低价中点，手动数据仍走同一校验链路。")

    heading(doc, "3.2  校验门禁", 2)
    add_table(doc,
              ["规则", "内容", "处置"],
              [
                  ["结构/日期", "必填字段齐全；YYYY-MM-DD；不晚于当前系统日期", "失败隔离"],
                  ["数值/单位", "Decimal 可解析、有限、大于 0；汇率 CNY，金属元/吨", "失败隔离"],
                  ["来源域名", "PBOC/CFETS/SMM/Asian Metal 白名单；manual://、csv:// 视为本地凭证", "失败隔离"],
                  ["合理区间", "汇率 0.1—30；金属 1,000—200,000 元/吨", "失败隔离"],
                  ["FX 跨源", "PBOC 与 CFETS 同日都存在，绝对偏差 > 0.0001", "严格模式隔离"],
                  ["金属跨源", "SMM 与 Asian Metal 同日都存在，相对偏差 > 10%", "软告警（规格/地区差异）"],
                  ["日波动/重复", "汇率 5%、金属 15%；同日同源同产品不同值", "告警，保留最新记录"],
              ],
              [2.8, 9.5, 3.0],
              "表 3  校验规则与处置")
    body(doc, "所有未通过硬规则的记录写入 quarantine，不参与趋势、均值、预警或 AI 上下文；通过者写入 validated。审计页展示抓取、校验、轮转日志、文件清单与隔离区，形成“原始记录—校验—聚合—展示”的完整证据链。FX 跨源在 2015—2022 CFETS 回填后执行严格模式，PBOC 重新校验 5,740 条、0 条因跨源失败被隔离。")

    heading(doc, "3.3  多级均值与精度", 2)
    body(doc, "设某标的在某日有 n_d 条通过校验的报价 v_(d,i)，每日加工均值为：")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("每日加工均值 = Σ v_(d,i) / n_d；周期均值 = Σ 每日加工均值 / 有效日数")
    set_cn_font(r, size=10, bold=True, color=DARK)
    body(doc, "月、季、半年、年均值均直接由周期内每日加工均值等权计算，不使用“月均再平均”，避免二次舍入和权重偏移。均值分母为有效日数，覆盖率分母为周期内工作日数；当前周期标记 partial，只覆盖截至日，不年化、不外推。每个聚合记录保存 meanBasis=available-days、coverageBasis=weekdays、availableDays、expectedWeekdays、sum、count、min、max、firstDate、lastDate、formulaVersion 与 sourceFiles，验收时可用 sum/count 独立复算。")
    body(doc, "中间计算使用 Decimal.js，precision=50、ROUND_HALF_UP；mean、sum、min、max 保存全精度字符串，展示按汇率 4 位、金属 2 位四舍五入，导出保留完整精度。中间步骤不截断，不使用 JavaScript number 做价格、汇率、均值或阈值比较。")

    heading(doc, "3.4  本地文件与轮转", 2)
    body(doc, "业务数据全部在 data/：raw/<source>/<年>/<月> 保存原始记录，validated 与 quarantine 按年月保存有效/隔离记录，aggregates/<年>/<年>.json/.csv 保存五级聚合，alerts/<年> 保存预警，audit/<年>/<月> 保存日志。写入采用临时文件 + rename，同一路径用文件锁串行化；同一来源、产品、日期只保留一条记录，后写覆盖先写；CSV 随 JSON 重写。")
    body(doc, "周期切换时自动创建新文件并写入轮转日志，旧文件不被改写；跨年查询递归扫描各年份文件，按日期过滤、去重、排序后拼接，不依赖数据库索引。应用不安装数据库、不注册服务、默认不自启，验收可直接检查目录、文件和进程。QA 中用 ensurePeriod 验证了 2026-11 新文件的创建与旧 2026-10 文件哈希不变；宿主系统时间修改仍建议在独立副本手工执行并恢复。")
    figure(doc, "pipeline.png", "图 2  数据采集—校验—聚合—展示闭环", 16.2)

    heading(doc, "3.5  动态监测与预警", 2)
    body(doc, "监测标的由 config/monitors.json 驱动，支持新增、删除、启停、改产品/币种、改阈值和精度。保存后面板立即重构：删除只隐藏，不删除本地历史；新增 SMM 标的自动抓取历史并重算；PBOC 新币种优先复用已回填的原始汇率数据。新标的从首次有效数据日期 availableFrom 起展示，加入前周期显示 —/N/A，不显示 0，不以其他标的数据替代。QA 已实测停 EUR、加 GBP、AZ91D→AM60B 并恢复 6 标的。")
    body(doc, "预警覆盖阈值突破、日波动、月均偏离、数据 stale、无数据、抓取失败、隔离数据和跨源偏差，记录写入 alerts/<年>/<年>.json，状态 open→acknowledged→resolved。需求书没有给出阈值和调价公式，当前阈值属于产品自定义规则，详见《预警规则说明》，不作为需求条款验收；QA 在独立副本构造阈值触发和非法记录，验证 alerts/quarantine 实际落盘。")

    heading(doc, "3.6  AI 智能体与安全", 2)
    body(doc, "智能分析支持 OpenCode Go、OpenAI、DeepSeek、智谱 GLM、Anthropic Claude 和自定义 OpenAI 兼容接口。模型只接收本地有效数据与聚合结果及近 12 个月走势，回答带引用；无 Key 或请求失败时使用模板兜底，数字只来自本地数据。对话采用 SSE 流式输出，支持思考状态、停止生成并保留已生成内容；会话按 index.json 与独立会话文件持久化，支持新建、切换、自动标题和删除，并自动迁移旧版 current.json。AI 日报既可手动生成，也可在抓取完成后自动生成，按日期存入 data/reports/YYYY/YYYY-MM-DD.json。请求设置 60 秒超时与失败重试，401 错误明确提示检查 Provider、Base URL 和 Key，错误信息脱敏后展示。API Key 使用 Electron safeStorage 按当前 Windows 用户加密，不写入源码、日志或导出文件；提交包不包含明文 Key。")
    heading(doc, "3.7  实时行情参考层", 2)
    body(doc, "实时行情与官方数据严格分层：第三方报价写入 data/realtime，使用独立 Provider 能力模型和独立预警，不进入 raw、validated、aggregates 或官方 alerts，不参与均值，也不冒充 PBOC 中间价。Provider 按 quotes、topOfBook、depth、trades、streaming 声明能力，界面只显示实际具备的字段；Twelve Data Basic 仅声明报价与 1 分钟分时，因此不伪造 Bid/Ask、深度或逐笔成交。无 Key 时使用明确标注“演示数据”的 Mock Provider 展示界面，不冒充真实行情。")
    body(doc, "轮询服务按 Provider 限额运行：Basic 套餐显示每分钟 8 次、每日 800 次额度；用量达到 65%/85% 自动降频 2/4 倍，额度耗尽暂停，429 退避 15 分钟。实时预警默认使用 5 分钟窗口、0.3% 涨跌阈值、15 分钟冷却和 180 秒过期时间；行情延迟超过 15 秒显示“延迟”，数据源健康度面板展示最近成功、错误与额度状态。错误和过期预警在行情恢复后自动解除；新的涨跌预警写入前先解除同标的旧未处理记录，保证同类型最多一条 open 预警。")

    heading(doc, "4  实验与结果", 1)
    heading(doc, "4.1  数据覆盖与回填", 2)
    add_table(doc,
              ["项目", "结果", "证据/说明"],
              [
                  ["PBOC", "2015—2026", "每日公告、原始 URL、抓取时间、contentHash"],
                  ["SMM", "2015—2026", "ADC12 201102250397；AZ91D 202004280003"],
                  ["CFETS", "2015—2026", "2015—2022 回填 3,894 条；PBOC 重新校验 5,740 条、0 invalid"],
                  ["Asian Metal", "2026 起手动/CSV", "2026 前 N/A；不自动登录、不绕过会员限制"],
                  ["有效数据/聚合", "13,083 条有效 / 11,020 条聚合", "无 .db 文件；无 DB 进程"],
              ],
              [3.0, 5.6, 6.5],
              "表 4  数据覆盖与回填结果")

    doc.add_page_break()
    heading(doc, "4.2  独立复算与随机月", 2)
    add_table(doc,
              ["样本", "均值（展示）", "有效日数", "覆盖率", "说明"],
              [
                  ["fx-eur 2022-06", "7.079143", "21", "95.5%", "全精度存储在 aggregates，表格四舍五入"],
                  ["fx-eur 2024-08", "7.861009", "22", "100%", "常规月，无偏路径"],
                  ["SMM ADC12 2022-06", "20,167.00", "21", "95.5%", "Q2/H1 双末端月"],
                  ["SMM ADC12 2024-08", "19,800.027273", "22", "100%", "与独立复算逐位一致"],
              ],
              [4.2, 4.3, 2.0, 2.0, 3.6],
              "表 5  随机历史月独立复算样本")
    body(doc, "独立 Python 使用 decimal.Decimal 只读 raw/validated 与 aggregates，不引用 TypeScript 聚合器；全量 11,020 条聚合均值 0 失败、21 条提示（16 条为覆盖率/节假日差异，4 条为 partial 标记差异，1 条为 pboc:GBP 有有效记录但未纳入默认监测聚合）。跨年样本 2023 年 fx-eur 均值 7.6425235537…、2024 年 7.7247613168…，与跨文件拼接结果一致。另做 .5 边界测试：displayMean(200.5, precision 0)=201，符合 ROUND_HALF_UP。")

    heading(doc, "4.3  测试与验收", 2)
    add_table(doc,
              ["检查项", "结果", "证据"],
              [
                  ["Vitest 单元测试", "88/88 通过", "tests/ 12 个测试文件"],
                  ["TypeScript", "通过", "主进程 + 渲染进程"],
                  ["独立复算", "11,020 条，0 失败/21 提示", "data/exports/verification-report.json"],
                  ["历史均值", "通过", "验收模式：2026-09 差值 0"],
                  ["本地文件/无数据库", "通过", "JSON 586、CSV 581；无 .db；无 DB 进程"],
                  ["时间轮转", "通过（模拟）", "2026-11 新文件；旧文件哈希不变"],
                  ["跨年读取", "通过", "fx-eur 覆盖 2015—2026"],
                  ["动态配置", "通过", "停 EUR/加 GBP/AZ91D→AM60B/恢复"],
                  ["实时行情分层", "通过", "实时值独立存储；不进官方均值/预警"],
                  ["AI 流式/会话/日报", "通过", "SSE、停止生成、多会话、日报落盘"],
                  ["安装包", "通过", "安装退出码 0；启动 valid=13,083、alerts=0"],
              ],
              [3.6, 4.4, 7.0],
              "表 6  测试与验收结果")
    body(doc, "验收口径与 QA 记录见 docs/验收口径确认.md、docs/QA测试记录.md；预警/隔离证据在 docs/QA-evidence/ 与 D:\\QA 副本中，生产数据保持干净。最终安装包在独立目录完成静默安装与启动测试：6 个监测标的、13,083 条有效数据、0 条生产预警、availableFrom=2015-01-05，无运行错误。")

    heading(doc, "4.4  面板展示", 2)
    figure(doc, "dashboard.png", "图 3  总览：六标的卡片、趋势、数据质量与预警", 16.2)
    figure(doc, "history.png", "图 4  历史与均值：SMM ADC12 月度趋势与周期明细", 16.2)
    figure(doc, "acceptance.png", "图 5  验收模式：历史均值、本地文件、轮转、跨年检查", 16.2)
    figure(doc, "audit.png", "图 6  数据审计：抓取、轮转、文件、隔离与手动录入", 15.6)
    body(doc, "面板以浅色工业数据风格呈现，突出数据状态、来源、精度和证据；总览卡片显示 1 单位外币 = CNY 的量纲，历史页显示“均值分母=有效日数、覆盖率分母=工作日数”，验收页直接给出通过/未通过与证据 JSON。")

    heading(doc, "5  创新点与可行性", 1)
    body(doc, "（1）可信数据链：原始记录、校验结论、隔离记录、聚合结果和展示值可回查；保留来源 URL、抓取时间、内容哈希、解析器版本、sourceFiles、sum/count 和公式版本。出现争议时可回到具体日期、来源和规则，而不是只看面板数字。")
    body(doc, "（2）精度与口径可复算：金额和价格全程 Decimal，存储全精度字符串，展示与存储精度分离；均值分母、覆盖率分母写入聚合字段并在 UI 展示；高周期均值直接由日值计算，不对已舍入月均值二次平均。")
    body(doc, "（3）本地优先、可审计、轻部署：不使用数据库、不注册服务、默认不自启；JSON/CSV 按月/年分卷，跨年查询自动拼接；写入原子化、去重明确、CSV 可读。对没有专职 IT 的中小企业，单机交付减少数据库和服务器运维。")
    body(doc, "（4）动态配置与可扩展适配器：监测标的由配置驱动，停 EUR、加 GBP、换 AM60B 不改代码；适配器接口统一，新增数据源只需实现 fetchRange/fetchDaily/catalog。配置预检、availableFrom、N/A 和回填标注降低了新标的历史语义风险。")
    body(doc, "（5）合规采集与 AI 接地：PBOC/CFETS/SMM 使用公开页面/接口，Asian Metal 明确手工/CSV，不自动登录、不绕过会员限制；AI 只接收本地有效数据和聚合结果，回答带引用，无 Key/失败时模板兜底，不编造行情。")
    body(doc, "局限性：Asian Metal 2026 年前无本地历史，属于数据权限导致的结构性缺口；公开接口可能调整，解析器需要维护；覆盖率未剔除中国法定节假日；预警阈值是实现自定义，不是需求书业务阈值；宿主系统时间修改仅完成模拟验证，仍建议在 QA 副本手工执行；单机文件锁不替代多用户并发控制。")

    heading(doc, "6  结论与交付", 1)
    body(doc, "链价智控把官方汇率、SMM 金属价格、CFETS 校验和 Asian Metal 手动数据统一到本地可审计的数据链，以校验门禁、Decimal 多级均值、按月/年分卷和动态配置解决“数据敢不敢用、均值算得准不准、标的换得动”三个问题。当前系统已完成 PBOC/SMM/CFETS 2015—2026 历史回填、88 项测试、11,020 条聚合独立复算、实时参考层与 AI 流式分析，并通过安装包验证，可用于 Windows 单机演示与验收。")
    body(doc, "本地开发与复现命令：npm run dev:local（关闭调度热更新）、npm test、npm run typecheck、npm run verify、npm run package。工作区为 D:\\Projects\\supplycost-sentinel；最终安装包、源码 ZIP、申报书与哈希在 submit/；QA 副本与备份在 D:\\QA。")

    # footer note / appendix
    heading(doc, "附录 A  复现与证据", 1)
    body(doc, "（1）数据：data/raw、data/validated、data/quarantine、data/aggregates、data/alerts、data/audit；抽样来源凭证 data/provenance/source-attestation.csv。（2）验收：docs/验收口径确认.md、docs/验收手册.md、docs/QA测试记录.md、docs/QA-evidence/。（3）构建：npm run package 生成 NSIS 安装包；源码包不含 node_modules、data、安装产物或密钥。（4）AI：设置→智能分析→选择 Provider、填写 Base URL/模型/API Key→测试连接→保存。", size=9.5)

    # update fields on open
    settings = doc.settings.element
    update = OxmlElement("w:updateFields")
    update.set(qn("w:val"), "true")
    settings.append(update)

    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
