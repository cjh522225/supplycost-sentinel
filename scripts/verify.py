#!/usr/bin/env python3
"""Independent verifier for supply-cost aggregate data.

This script deliberately does not import or execute any TypeScript code.  It
re-implements the period rules and the daily-mean aggregation with Decimal and
checks every stored AggregateRecord against the validated source records.

Usage:
    python scripts/verify.py [data-dir]

Defaults to <repository>/data.  A Chinese report is printed and a machine
readable report is written to <data-dir>/exports/verification-report.json.
Exit code is 1 when at least one aggregate fails verification.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path

getcontext().prec = 50
getcontext().rounding = ROUND_HALF_UP

TOLERANCE = Decimal("1e-8")
COVERAGE_TOLERANCE = Decimal("0.05")
PERIOD_TYPES = ("day", "month", "quarter", "half", "year")
PERIOD_LABELS = {
    "day": "日",
    "month": "月",
    "quarter": "季度",
    "half": "半年",
    "year": "年",
}


def default_data_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "data"


def parse_date_key(value: object) -> date:
    if not isinstance(value, str) or len(value) < 10:
        raise ValueError(f"无效日期: {value!r}")
    return date.fromisoformat(value[:10])


def period_key(period_type: str, day: date) -> str:
    if period_type == "day":
        return day.isoformat()
    if period_type == "month":
        return f"{day.year:04d}-{day.month:02d}"
    if period_type == "quarter":
        return f"{day.year:04d}-Q{(day.month - 1) // 3 + 1}"
    if period_type == "half":
        return f"{day.year:04d}-H{1 if day.month <= 6 else 2}"
    if period_type == "year":
        return f"{day.year:04d}"
    raise ValueError(f"未知周期类型: {period_type}")


def last_day_of_month(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def period_range(period_type: str, key: str) -> tuple[date, date]:
    try:
        if period_type == "day":
            value = date.fromisoformat(key)
            return value, value
        if period_type == "month":
            year_text, month_text = key.split("-", 1)
            year, month = int(year_text), int(month_text)
            return date(year, month, 1), last_day_of_month(year, month)
        if period_type == "quarter":
            year_text, quarter_text = key.split("-Q", 1)
            year, quarter = int(year_text), int(quarter_text)
            start_month = (quarter - 1) * 3 + 1
            return date(year, start_month, 1), last_day_of_month(year, start_month + 2)
        if period_type == "half":
            year_text, half_text = key.split("-H", 1)
            year, half = int(year_text), int(half_text)
            start_month = 1 if half == 1 else 7
            return date(year, start_month, 1), last_day_of_month(year, start_month + 5)
        if period_type == "year":
            year = int(key)
            return date(year, 1, 1), date(year, 12, 31)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"无法解析周期键 {period_type} {key}: {exc}") from exc
    raise ValueError(f"未知周期类型: {period_type}")


def count_weekdays(start: date, end: date) -> int:
    if end < start:
        return 0
    cursor = start
    total = 0
    while cursor <= end:
        if cursor.weekday() < 5:
            total += 1
        cursor += timedelta(days=1)
    return total


def coverage_for(period_type: str, key: str, count: int, today: date) -> tuple[bool, Decimal, int]:
    start, end = period_range(period_type, key)
    if period_type == "day":
        partial = key == today.isoformat()
    else:
        partial = start <= today <= end
    effective_end = end
    if partial and end > today:
        effective_end = today
    expected_weekdays = count_weekdays(start, effective_end)
    if expected_weekdays <= 0:
        coverage = Decimal(100)
    else:
        coverage = Decimal(count) * Decimal(100) / Decimal(expected_weekdays)
    return partial, coverage.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP), expected_weekdays


def load_json_array(path: Path) -> list:
    with path.open("r", encoding="utf-8-sig") as handle:
        value = json.load(handle)
    if not isinstance(value, list):
        raise ValueError(f"文件内容不是 JSON 数组: {path}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def decimal_or_none(value: object) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = Decimal(text)
    except Exception:
        return None
    return parsed if parsed.is_finite() else None


def decimal_close(left: Decimal | None, right: Decimal | None, tolerance: Decimal = TOLERANCE) -> bool | None:
    if left is None or right is None:
        return None
    return abs(left - right) <= tolerance


def pair_of(record: dict) -> tuple[str, str]:
    return str(record.get("source") or ""), str(record.get("productId") or "")


def daily_values(records: list[dict]) -> tuple[dict[str, Decimal], int]:
    grouped: dict[str, list[Decimal]] = {}
    skipped = 0
    for record in records:
        date_key = str(record.get("date") or "")
        try:
            parse_date_key(date_key)
        except ValueError:
            skipped += 1
            continue
        value = decimal_or_none(record.get("value"))
        if value is None:
            skipped += 1
            continue
        grouped.setdefault(date_key[:10], []).append(value)

    daily: dict[str, Decimal] = {}
    for date_key in sorted(grouped):
        values = grouped[date_key]
        daily[date_key] = sum(values, Decimal(0)) / Decimal(len(values))
    return daily, skipped


def build_buckets(daily: dict[str, Decimal]) -> dict[str, dict[str, list[tuple[str, Decimal]]]]:
    buckets: dict[str, dict[str, list[tuple[str, Decimal]]]] = {name: {} for name in PERIOD_TYPES}
    for date_key in sorted(daily):
        current = date.fromisoformat(date_key)
        for period_type in PERIOD_TYPES:
            key = period_key(period_type, current)
            buckets[period_type].setdefault(key, []).append((date_key, daily[date_key]))
    return buckets


def stored_index(rows: list[dict]) -> tuple[dict[str, dict], list[str]]:
    index: dict[str, dict] = {}
    duplicates: list[str] = []
    for row in rows:
        period_type = str(row.get("periodType") or "")
        key = str(row.get("periodKey") or "")
        if not period_type or not key:
            continue
        identity = f"{period_type}:{key}"
        if identity in index:
            duplicates.append(identity)
        index[identity] = row
    return index, duplicates


def evaluate_expected_period(
    period_type: str,
    key: str,
    entries: list[tuple[str, Decimal]],
    stored: dict | None,
    today: date,
) -> dict:
    entries = sorted(entries, key=lambda item: item[0])
    values = [value for _, value in entries]
    count = len(values)
    total = sum(values, Decimal(0))
    mean = total / Decimal(count)
    minimum = min(values)
    maximum = max(values)
    partial, coverage, expected_weekdays = coverage_for(period_type, key, count, today)
    start, end = period_range(period_type, key)

    result: dict = {
        "periodType": period_type,
        "periodKey": key,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "expected": {
            "mean": str(mean),
            "sum": str(total),
            "count": count,
            "min": str(minimum),
            "max": str(maximum),
            "firstDate": entries[0][0],
            "lastDate": entries[-1][0],
            "coverage": str(coverage),
            "expectedWeekdays": expected_weekdays,
            "partial": partial,
        },
        "stored": None,
        "diff": None,
        "status": "FAIL",
        "message": "",
        "notes": [],
    }

    if stored is None:
        result["message"] = "缺少聚合记录"
        return result

    stored_mean = decimal_or_none(stored.get("mean"))
    result["stored"] = {
        "mean": stored.get("mean"),
        "sum": stored.get("sum"),
        "count": stored.get("count"),
        "min": stored.get("min"),
        "max": stored.get("max"),
        "coverage": stored.get("coverage"),
        "partial": stored.get("partial"),
    }

    if stored_mean is None:
        result["message"] = "聚合记录 mean 缺失或无法解析"
        return result

    diff = abs(stored_mean - mean)
    result["diff"] = str(diff)
    if diff <= TOLERANCE:
        result["status"] = "PASS"
        result["message"] = "均值一致"
    else:
        result["message"] = f"均值偏差 {diff} 超过容差 {TOLERANCE}"
        return result

    stored_count = stored.get("count")
    if isinstance(stored_count, int) and stored_count != count:
        result["notes"].append(f"count 不一致：期望 {count}，实际 {stored_count}")

    stored_min = decimal_or_none(stored.get("min"))
    stored_max = decimal_or_none(stored.get("max"))
    if decimal_close(stored_min, minimum) is False:
        result["notes"].append(f"min 不一致：期望 {minimum}，实际 {stored.get('min')}")
    if decimal_close(stored_max, maximum) is False:
        result["notes"].append(f"max 不一致：期望 {maximum}，实际 {stored.get('max')}")

    stored_coverage = decimal_or_none(stored.get("coverage"))
    if decimal_close(stored_coverage, coverage, COVERAGE_TOLERANCE) is False:
        result["notes"].append(
            f"coverage 不一致：期望 {coverage}，实际 {stored.get('coverage')}"
        )

    stored_partial = stored.get("partial")
    if isinstance(stored_partial, bool) and stored_partial != partial:
        result["notes"].append(f"partial 不一致：期望 {partial}，实际 {stored_partial}")

    return result


def evaluate_monitor(
    monitor: dict,
    stored_rows: list[dict],
    corrected_records: list[dict],
    today: date,
) -> dict:
    daily, skipped = daily_values(corrected_records)
    buckets = build_buckets(daily)
    index, duplicate_periods = stored_index(stored_rows)

    monitor_result: dict = {
        "monitorId": monitor["monitorId"],
        "monitorName": monitor.get("monitorName", ""),
        "source": monitor.get("source", ""),
        "productId": monitor.get("productId", ""),
        "unit": monitor.get("unit", ""),
        "validatedRecords": len(corrected_records),
        "dailyCount": len(daily),
        "skippedRecords": skipped,
        "periods": [],
        "failures": [],
        "warnings": [],
    }

    for identity in duplicate_periods:
        message = f"聚合文件中存在重复周期记录: {identity}"
        monitor_result["warnings"].append(message)

    for period_type in PERIOD_TYPES:
        expected = buckets[period_type]
        stored_for_type = {
            key.split(":", 1)[1]: row
            for key, row in index.items()
            if key.startswith(f"{period_type}:")
        }
        all_keys = sorted(set(expected) | set(stored_for_type))
        for key in all_keys:
            entries = expected.get(key)
            stored = stored_for_type.get(key)
            try:
                if entries is None:
                    start, end = period_range(period_type, key)
                    period_result = {
                        "periodType": period_type,
                        "periodKey": key,
                        "startDate": start.isoformat(),
                        "endDate": end.isoformat(),
                        "expected": None,
                        "stored": {
                            "mean": stored.get("mean") if stored else None,
                            "count": stored.get("count") if stored else None,
                        },
                        "diff": None,
                        "status": "FAIL",
                        "message": "没有对应的有效日数据，无法重算",
                        "notes": [],
                    }
                else:
                    period_result = evaluate_expected_period(period_type, key, entries, stored, today)
            except ValueError as exc:
                period_result = {
                    "periodType": period_type,
                    "periodKey": key,
                    "expected": None,
                    "stored": None,
                    "diff": None,
                    "status": "FAIL",
                    "message": str(exc),
                    "notes": [],
                }
            monitor_result["periods"].append(period_result)
            if period_result["status"] == "FAIL":
                monitor_result["failures"].append(
                    f"{period_type}:{key} {period_result['message']}"
                )
            for note in period_result.get("notes", []):
                monitor_result["warnings"].append(f"{period_type}:{key} {note}")

    return monitor_result


def scan(data_dir: Path, kind: str) -> list[Path]:
    root = data_dir / kind
    if not root.is_dir():
        return []
    return sorted(path for path in root.glob("*/*.json") if path.is_file())


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    data_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else default_data_dir().resolve()
    today = date.today()

    report_errors: list[str] = []
    report_warnings: list[str] = []
    inputs: list[dict] = []

    validated_files = scan(data_dir, "validated")
    aggregate_files = scan(data_dir, "aggregates")

    validated_records: list[dict] = []
    validated_index: dict[tuple[str, str], list[dict]] = {}
    for path in validated_files:
        try:
            rows = load_json_array(path)
        except Exception as exc:
            report_errors.append(f"读取有效记录失败 {relative_path(path, data_dir)}: {exc}")
            continue
        count = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            validated_records.append(row)
            validated_index.setdefault(pair_of(row), []).append(row)
            count += 1
        inputs.append(
            {
                "path": relative_path(path, data_dir),
                "kind": "validated",
                "records": count,
                "sha256": sha256_file(path),
            }
        )

    aggregate_rows: list[dict] = []
    for path in aggregate_files:
        try:
            rows = load_json_array(path)
        except Exception as exc:
            report_errors.append(f"读取聚合记录失败 {relative_path(path, data_dir)}: {exc}")
            continue
        count = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            aggregate_rows.append(row)
            count += 1
        inputs.append(
            {
                "path": relative_path(path, data_dir),
                "kind": "aggregates",
                "records": count,
                "sha256": sha256_file(path),
            }
        )

    if not aggregate_files and validated_files:
        report_errors.append("存在有效记录文件，但未找到任何聚合文件（aggregates/*/*.json）")

    monitors: dict[str, dict] = {}
    monitor_order: list[str] = []
    for row in aggregate_rows:
        source, product_id = pair_of(row)
        monitor_id = str(row.get("monitorId") or f"{source}:{product_id}")
        if monitor_id not in monitors:
            monitors[monitor_id] = {
                "monitorId": monitor_id,
                "monitorName": row.get("monitorName", ""),
                "source": source,
                "productId": product_id,
                "unit": row.get("unit", ""),
                "stored": [],
            }
            monitor_order.append(monitor_id)
        monitors[monitor_id]["stored"].append(row)

    monitor_results: list[dict] = []
    aggregate_pairs: set[tuple[str, str]] = set()
    for monitor_id in monitor_order:
        monitor = monitors[monitor_id]
        pair = (str(monitor.get("source") or ""), str(monitor.get("productId") or ""))
        aggregate_pairs.add(pair)
        records = validated_index.get(pair, [])
        monitor_results.append(evaluate_monitor(monitor, monitor["stored"], records, today))

    for pair, records in sorted(validated_index.items()):
        if pair in aggregate_pairs:
            continue
        report_warnings.append(
            f"有效记录 {pair[0]}:{pair[1]} 共 {len(records)} 条，但没有对应的聚合记录"
        )

    all_periods = [period for monitor in monitor_results for period in monitor["periods"]]
    pass_count = sum(1 for period in all_periods if period["status"] == "PASS")
    fail_count = sum(1 for period in all_periods if period["status"] == "FAIL")
    period_warnings = sum(len(monitor["warnings"]) for monitor in monitor_results)

    status = "PASS" if fail_count == 0 and not report_errors else "FAIL"
    if not aggregate_files and not validated_files:
        report_warnings.append("数据目录中没有 validated 或 aggregates 数据，跳过核验")

    summary = {
        "status": status,
        "dataDir": str(data_dir),
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "tolerance": str(TOLERANCE),
        "validatedFiles": len(validated_files),
        "aggregateFiles": len(aggregate_files),
        "validatedRecords": len(validated_records),
        "aggregateRecords": len(aggregate_rows),
        "monitorCount": len(monitor_results),
        "periodCount": len(all_periods),
        "passCount": pass_count,
        "failCount": fail_count,
        "warningCount": period_warnings + len(report_warnings),
    }

    report = {
        "summary": summary,
        "monitors": monitor_results,
        "errors": report_errors,
        "warnings": report_warnings,
        "inputs": inputs,
    }

    exports_dir = data_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    report_path = exports_dir / "verification-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 78)
    print("供应链数据独立核验（Python / Decimal，不依赖 TypeScript 实现）")
    print(f"数据目录: {summary['dataDir']}")
    print(
        f"有效记录文件: {summary['validatedFiles']}，"
        f"聚合文件: {summary['aggregateFiles']}，"
        f"监控项: {summary['monitorCount']}，"
        f"周期: {summary['periodCount']}"
    )
    print("=" * 78)

    for monitor in monitor_results:
        print(
            f"\n监控项 {monitor['monitorId']} "
            f"({monitor['source']}:{monitor['productId']}) "
            f"有效记录 {monitor['validatedRecords']} 条 / {monitor['dailyCount']} 个交易日"
        )
        for period in monitor["periods"]:
            label = PERIOD_LABELS.get(period["periodType"], period["periodType"])
            line = (
                f"[{period['status']}] {monitor['monitorId']} {period['periodKey']} "
                f"{label}"
            )
            expected = period.get("expected")
            if expected:
                line += (
                    f" mean={expected['mean']} count={expected['count']}"
                    f" min={expected['min']} max={expected['max']}"
                    f" coverage={expected['coverage']}%"
                )
            stored = period.get("stored")
            if stored and stored.get("mean") is not None:
                line += f" | 存储 mean={stored['mean']} diff={period.get('diff')}"
            else:
                line += " | 存储 mean=缺失"
            if period["status"] != "PASS":
                line += f" ({period['message']})"
            print(line)
            for note in period.get("notes", []):
                print(f"        提示: {note}")

    if report_warnings:
        print("\n警告:")
        for warning in report_warnings:
            print(f"  - {warning}")

    if report_errors:
        print("\n错误:")
        for error in report_errors:
            print(f"  - {error}")

    print("\n" + "-" * 78)
    print(
        f"汇总: 通过 {pass_count} / 失败 {fail_count} / 警告 {summary['warningCount']} "
        f"=> {status}"
    )
    print(f"报告已写入: {report_path}")
    print("-" * 78)

    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
