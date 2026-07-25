"""研究包内部路径；不得引用 Labs 或产品目录。"""

from pathlib import Path


RESEARCH_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = RESEARCH_ROOT / "data"
REPORT_DIR = RESEARCH_ROOT / "report"
