"""Parse all AkShare stock interfaces from the downloaded HTML."""
import re
import json

HTML_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\.workbuddy\scratch\stock.html"
OUT_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\.workbuddy\scratch\interfaces.json"

with open(HTML_PATH, "r", encoding="utf-8") as f:
    html = f.read()

# Strip tags helper for text extraction
def strip_tags(s):
    # Remove headerlink anchors (permalink icons) first
    s = re.sub(r'<a\s+class="headerlink"[^>]*>.*?</a>', '', s, flags=re.DOTALL)
    s = re.sub(r"<[^>]+>", "", s)
    # Remove any private-use-area chars (mkdocs icons)
    s = "".join(ch for ch in s if ord(ch) < 0xE000)
    s = re.sub(r"\s+", " ", s).strip()
    return s

# We split the HTML by the <p>接口: markers to isolate each interface block.
# Each interface block: from "接口:" to the next "接口:" (or end).
# But we also need the preceding headings (h3/h4) for name and data source.

# Strategy: walk through the HTML and track current h3 (section) and h4 (data source),
# and whenever we hit a <p>接口: xxx</p>, record an interface with the current context.

# Use a tokenizer over the relevant tags: h3, h4, p, table
# We'll process the raw HTML with a regex that captures h3, h4, p tags in order.

token_re = re.compile(
    r"<(h[34]|p)\b[^>]*>(.*?)</\1>",
    re.DOTALL,
)

current_h3 = ""
current_h4 = ""
interfaces = []

# Also need to capture the parameter table that follows "输入参数".
# We'll do a second pass: for each interface, find the next table after its 输入参数 marker.

for m in token_re.finditer(html):
    tag = m.group(1)
    content = strip_tags(m.group(2))
    if tag == "h3":
        current_h3 = content
        # Reset h4 when entering a new h3 section
        current_h4 = ""
    elif tag == "h4":
        current_h4 = content
    elif tag == "p":
        if content.startswith("接口:"):
            func_name = content[len("接口:"):].strip()
            interfaces.append({
                "section": current_h3,
                "data_source_hint": current_h4,
                "func": func_name,
                "name": "",  # will fill from heading context
                "url": "",
                "desc": "",
                "params_raw": "",
            })
        elif interfaces:
            last = interfaces[-1]
            if content.startswith("目标地址:"):
                last["url"] = content[len("目标地址:"):].strip()
            elif content.startswith("描述:"):
                last["desc"] = content[len("描述:"):].strip()
            elif content == "输入参数":
                last["_params_marker_pos"] = m.end()

# Now extract the parameter table for each interface.
# Find all table blocks and their positions.
table_re = re.compile(r"<table\b[^>]*>(.*?)</table>", re.DOTALL)
tables = list(table_re.finditer(html))

for iface in interfaces:
    marker_pos = iface.pop("_params_marker_pos", None)
    params = []
    if marker_pos is not None:
        # find first table after marker
        for tm in tables:
            if tm.start() > marker_pos:
                # parse this table's rows
                tbody = tm.group(1)
                row_re = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.DOTALL)
                cell_re = re.compile(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", re.DOTALL)
                rows = row_re.findall(tbody)
                parsed_rows = []
                for row in rows:
                    cells = [strip_tags(c) for c in cell_re.findall(row)]
                    parsed_rows.append(cells)
                # Skip header row if it's 名称/类型/描述
                if parsed_rows and parsed_rows[0] and parsed_rows[0][0] in ("名称", "参数"):
                    parsed_rows = parsed_rows[1:]
                # Collect param names (first column) that are not "-" or empty
                for row in parsed_rows:
                    if row and row[0] not in ("-", "", "—"):
                        params.append(row[0])
                break
    if params:
        iface["params_raw"] = ", ".join(params)
    else:
        iface["params_raw"] = "null"

# Derive interface display name: prefer the h4 if it looks like a name, else desc, else section
NON_NAME_HINTS = {"结构图", "示意图", "效果图", "成分股", "结果示例", "示例", "接口示例"}
for iface in interfaces:
    section = iface["section"]
    hint = iface["data_source_hint"]
    if hint and hint not in NON_NAME_HINTS:
        # If hint already contains section as prefix, just use hint (avoid duplication)
        if section and hint.startswith(section):
            iface["name"] = hint
        elif section and section != hint:
            iface["name"] = f"{section}-{hint}"
        else:
            iface["name"] = hint
    else:
        iface["name"] = section or iface["desc"] or iface["func"]

# Derive data source: always infer from URL (h4 is often a feature name, not a source)
def infer_source(url, hint):
    u = url.lower()
    if "sse.com" in u: return "上海证券交易所"
    if "szse.cn" in u or "static.szse" in u: return "深圳证券交易所"
    if "eastmoney.com" in u: return "东方财富"
    if "xueqiu" in u: return "雪球"
    if "finance.sina" in u or "vip.stock.finance.sina" in u or "stock.finance.sina" in u: return "新浪财经"
    if "gu.qq.com" in u or "qq.com" in u: return "腾讯"
    if "163.com" in u or "money.163" in u: return "网易"
    if "10jqka" in u or "ths" in u or "basic.10jqka" in u: return "同花顺"
    if "msci.com" in u: return "MSCI"
    if "bse" in u or "bjss" in u: return "北京证券交易所"
    if "csindex" in u: return "中证指数"
    if "cninfo" in u or "cninf" in u: return "巨潮资讯"
    if "legulegu" in u: return "乐估乐股"
    if "gushitong.baidu" in u or "baidu.com" in u: return "百度股市通"
    if "caixin" in u: return "财新"
    if "swhyresearch" in u: return "申万宏源研究"
    if "eniu" in u: return "亿牛"
    if "stock.pingan" in u: return "平安证券"
    if "etnet.com.hk" in u: return "香港经济通"
    if "futunn" in u: return "富途"
    if "sseinfo" in u: return "上证e互动"
    if "ushknews" in u: return "港股新闻"
    if "sse.com" in u: return "上海证券交易所"
    return "其他"

for iface in interfaces:
    iface["data_source"] = infer_source(iface["url"], iface["data_source_hint"])

# Save
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(interfaces, f, ensure_ascii=False, indent=2)

print(f"Total interfaces parsed: {len(interfaces)}")
print("\nFirst 5:")
for i, iface in enumerate(interfaces[:5], 1):
    print(f"  {i}. {iface['name']} | {iface['data_source']} | {iface['func']} | {iface['url'][:60]} | {iface['params_raw']}")
print("\nLast 5:")
for i, iface in enumerate(interfaces[-5:], len(interfaces)-4):
    print(f"  {i}. {iface['name']} | {iface['data_source']} | {iface['func']} | {iface['url'][:60]} | {iface['params_raw']}")
