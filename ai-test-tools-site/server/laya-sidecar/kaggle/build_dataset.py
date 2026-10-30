"""合并训练行 → Kaggle 上传用 records.jsonl（HF typed-decisions 行格式）。

来源：
  1. artifacts/laya-ft/train.jsonl — 自家收割记录（harvest-decisions.mjs 产出，{state, questions, answer, source}）
  2. artifacts/laya-ft/mind2web/rows.jsonl — Mind2Web 转换行（convert-mind2web.mjs 产出，已是行格式）

用法：python build_dataset.py [--ftDir artifacts/laya-ft] [--out records.jsonl]
"""
import argparse
import json
from pathlib import Path


def one_hot_gold(questions: dict, answer: dict) -> dict:
    gold = {}
    operation = answer.get("operation")
    target = answer.get("target")
    if operation and operation in questions.get("operation", {}).get("criteria", {}):
        gold["operation"] = {"probabilities": {operation: 1.0}}
    if operation in ("CLICK", "TYPE_TEXT", "SELECT") and target:
        head_key = f"{operation.lower()}_target"
        head = questions.get(head_key, {})
        if target in head.get("criteria", {}):
            gold[head_key] = {"probabilities": {target: 1.0}}
    return gold


def convert_harvest(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        print(f"skip（不存在）: {path}")
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        state = record["state"]
        questions = record["questions"]
        gold = one_hot_gold(questions, record["answer"])
        if not gold:
            continue
        rows.append({
            "state": json.dumps(state, ensure_ascii=False),
            "questions": json.dumps(questions, ensure_ascii=False),
            "gold": json.dumps(gold, ensure_ascii=False),
            "source": "harvest",
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ftDir", default=None, help="artifacts/laya-ft 路径")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    ft_dir = Path(args.ftDir) if args.ftDir else Path(__file__).resolve().parents[3] / "artifacts" / "laya-ft"
    out_path = Path(args.out) if args.out else ft_dir / "records.jsonl"

    rows = convert_harvest(ft_dir / "train.jsonl")
    m2w_path = ft_dir / "mind2web" / "rows.jsonl"
    m2w = 0
    if m2w_path.exists():
        for line in m2w_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            rows.append({
                "state": row["state"],
                "questions": row["questions"],
                "gold": row["gold"],
                "source": "mind2web",
            })
            m2w += 1

    with out_path.open("w", encoding="utf-8") as out:
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"records: {len(rows)}（harvest {len(rows) - m2w} + mind2web {m2w}）→ {out_path}")


if __name__ == "__main__":
    main()
