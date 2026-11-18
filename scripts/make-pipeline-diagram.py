from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

OUT = Path(__file__).resolve().parents[1] / "docs" / "report-assets"
OUT.mkdir(parents=True, exist_ok=True)
FONT = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
TEAL = "#0F766E"
TEAL_DARK = "#0B3B36"
SLATE = "#475569"
WHITE = "#FFFFFF"
BORDER = "#CBD5E1"

def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)

def text_size(draw, text, ft):
    b = draw.textbbox((0, 0), text, font=ft)
    return b[2] - b[0], b[3] - b[1]

def wrap(draw, text, ft, max_width):
    lines, current = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(current); current = ""; continue
        trial = current + ch
        if text_size(draw, trial, ft)[0] <= max_width:
            current = trial
        else:
            if current: lines.append(current)
            current = ch
    if current: lines.append(current)
    return lines

def box(draw, x, y, w, h, title, body, fill):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=16, fill=fill, outline=BORDER, width=2)
    tf = font(20, True)
    tw, th = text_size(draw, title, tf)
    draw.text((x + (w - tw) / 2, y + 18), title, font=tf, fill=TEAL_DARK)
    bf = font(15)
    lines = wrap(draw, body, bf, w - 26)
    cy = y + 18 + th + 12
    for line in lines:
        lw, lh = text_size(draw, line, bf)
        draw.text((x + (w - lw) / 2, cy), line, font=bf, fill=SLATE)
        cy += 22

def arrow(draw, start, end):
    draw.line([start, end], fill=TEAL, width=4)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    head = 12
    left = (end[0] - head * math.cos(angle - math.pi / 6), end[1] - head * math.sin(angle - math.pi / 6))
    right = (end[0] - head * math.cos(angle + math.pi / 6), end[1] - head * math.sin(angle + math.pi / 6))
    draw.polygon([end, left, right], fill=TEAL)

img = Image.new("RGB", (1900, 560), WHITE)
draw = ImageDraw.Draw(img)
draw.text((70, 36), "数据采集—校验—聚合—展示闭环", font=font(36, True), fill=TEAL_DARK)
boxes = [
    ("定时抓取 / 手动录入", "PBOC · CFETS · SMM\nAsian Metal 手动/CSV", "#DDF4EF"),
    ("原始数据落盘", "raw/<source>/<年>/<月>\nJSON + CSV + 哈希", "#E0F2FE"),
    ("校验门禁", "硬规则 → quarantine\nFX 跨源严格；金属软告警", "#FEF3C7"),
    ("有效数据", "validated/<年>/<月>\n仅有效数据进入聚合", "#DCFCE7"),
    ("多级聚合", "日 → 月 → 季 → 半年 → 年\nDecimal 全精度", "#EDE9FE"),
    ("面板 / 预警 / AI", "总览 · 历史 · 审计 · 验收\n引用本地有效数据", "#FCE7F3"),
]
x = 50
for i, (title, body, fill) in enumerate(boxes):
    box(draw, x, 150, 250, 210, title, body, fill)
    if i < len(boxes) - 1:
        arrow(draw, (x + 250, 255), (x + 285, 255))
    x += 290
draw.rounded_rectangle((70, 420, 1830, 505), radius=14, fill="#F8FAFC", outline="#E2E8F0", width=2)
draw.text((92, 440), "旁路证据：按月/年轮转日志、校验日志、隔离区、sourceFiles、sum/count、contentHash；跨卷查询自动拼接。", font=font(20), fill=SLATE)
img.save(OUT / "pipeline.png", quality=95)
print("pipeline written")
