import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlencode

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "web-avatars"
MANIFEST = OUTPUT / "sources.json"
RAW = OUTPUT / "raw"
TARGET_COUNT = 1000

# 国内朋友圈常见头像风格关键词（百度图片）
KEYWORDS = [
    "微信头像",
    "卡通头像",
    "动漫头像",
    "简约头像",
    "手绘头像",
    "萌宠头像",
    "风景头像",
    "文字头像",
    "男生头像",
    "女生头像",
    "可爱头像",
    "情侣头像",
]

PER_KEYWORD = 90
PAGE_SIZE = 30
REQUEST_GAP_SECONDS = 0.35
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def normalize_avatar(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as source:
        avatar = ImageOps.fit(source.convert("RGB"), (256, 256), Image.Resampling.LANCZOS)
        output = BytesIO()
        avatar.save(output, "JPEG", quality=91, optimize=True, progressive=True)
        return output.getvalue()


def curl_bytes(url: str, *, referer: str | None = None) -> bytes:
    command = [
        "curl",
        "-sS",
        "-L",
        "--fail",
        "--retry",
        "4",
        "--retry-all-errors",
        "--retry-delay",
        "1",
        "--connect-timeout",
        "20",
        "--max-time",
        "45",
        "-A",
        USER_AGENT,
        "-H",
        "Accept-Language: zh-CN,zh;q=0.9",
    ]
    if referer:
        command.extend(["-H", f"Referer: {referer}"])
    command.append(url)
    result = subprocess.run(command, check=True, capture_output=True)
    return result.stdout


def search_baidu(keyword: str, pn: int) -> list[dict]:
    params = {
        "tn": "resultjson_com",
        "logid": "1",
        "ipn": "rj",
        "ct": "201326592",
        "fp": "result",
        "queryWord": keyword,
        "word": keyword,
        "pn": pn,
        "rn": PAGE_SIZE,
        "ie": "utf-8",
        "oe": "utf-8",
        "face": "0",
        "istype": "2",
        "nc": "1",
    }
    url = "https://image.baidu.com/search/acjson?" + urlencode(params, quote_via=quote)
    referer = f"https://image.baidu.com/search/index?tn=baiduimage&word={quote(keyword)}"
    raw = curl_bytes(url, referer=referer)
    text = raw.decode("utf-8", errors="ignore")
    if "Forbid spider" in text:
        raise RuntimeError(f"Baidu blocked spider for keyword={keyword}")
    payload = json.loads(text)
    results = []
    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        image_url = item.get("thumbURL") or item.get("middleURL") or item.get("hoverURL")
        if not image_url or not image_url.startswith("http"):
            continue
        results.append({
            "url": image_url,
            "title": item.get("fromPageTitle") or item.get("fromPageTitleEnc") or keyword,
        })
    return results


def download_keyword(keyword: str) -> list[Path]:
    safe = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", keyword)
    folder = RAW / safe
    folder.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    seen_urls = set()
    pn = 0
    attempts = 0
    while len(saved) < PER_KEYWORD and attempts < 12:
        attempts += 1
        try:
            items = search_baidu(keyword, pn)
        except Exception as error:
            print(f"[{keyword}] search failed pn={pn}: {error}")
            time.sleep(1.5)
            pn += PAGE_SIZE
            continue
        if not items:
            print(f"[{keyword}] empty page pn={pn}")
            break
        for item in items:
            if len(saved) >= PER_KEYWORD:
                break
            url = item["url"]
            if url in seen_urls:
                continue
            seen_urls.add(url)
            destination = folder / f"{len(saved) + 1:03d}.jpg"
            if destination.exists() and destination.stat().st_size > 0:
                saved.append(destination)
                continue
            try:
                data = curl_bytes(url, referer="https://image.baidu.com/")
                if len(data) < 800:
                    continue
                destination.write_bytes(data)
                saved.append(destination)
                print(f"[{keyword}] {len(saved):03d}/{PER_KEYWORD}")
            except Exception as error:
                print(f"[{keyword}] skip download: {error}")
            time.sleep(REQUEST_GAP_SECONDS)
        pn += PAGE_SIZE
        time.sleep(REQUEST_GAP_SECONDS)
    return saved


def collect_entries() -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {}
    for keyword in KEYWORDS:
        safe = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", keyword)
        folder = RAW / safe
        entries = []
        for path in sorted(folder.glob("*.jpg")):
            data = path.read_bytes()
            if len(data) < 800:
                continue
            try:
                normalized = normalize_avatar(data)
            except Exception as error:
                print(f"skip unreadable {path}: {error}")
                continue
            digest = hashlib.sha256(normalized).hexdigest()
            entries.append({
                "keyword": keyword,
                "normalized": normalized,
                "sha256": digest,
                "source": f"baidu-image:{keyword}:{path.name}",
            })
        buckets[keyword] = entries
        print(f"bucket {keyword}: {len(entries)}")
    return buckets


def rotate_unique(buckets: dict[str, list[dict]], target: int) -> list[dict]:
    order = list(KEYWORDS)
    indices = {name: 0 for name in order}
    seen = set()
    records = []
    while len(records) < target:
        progressed = False
        for name in order:
            while indices[name] < len(buckets[name]):
                entry = buckets[name][indices[name]]
                indices[name] += 1
                if entry["sha256"] in seen:
                    continue
                seen.add(entry["sha256"])
                records.append(entry)
                progressed = True
                break
            if len(records) >= target:
                break
        if not progressed:
            break
    return records


def write_outputs(records: list[dict]) -> None:
    for old in OUTPUT.glob("avatar-*.jpg"):
        old.unlink()

    files = []
    for index, entry in enumerate(records, start=1):
        filename = f"avatar-{index:04d}.jpg"
        (OUTPUT / filename).write_bytes(entry["normalized"])
        files.append({
            "file": filename,
            "provider": "Baidu Image Search",
            "style": entry["keyword"],
            "source": entry["source"],
            "sha256": entry["sha256"],
        })
        if index % 50 == 0 or index == len(records):
            print(f"[{index:04d}/{len(records)}] {filename} ({entry['keyword']})")

    style_counts = defaultdict(int)
    for item in files:
        style_counts[item["style"]] += 1

    manifest = {
        "providers": [
            {"name": "Baidu Image Search", "url": "https://image.baidu.com/"},
        ],
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "count": len(files),
        "style_counts": dict(style_counts),
        "keywords": KEYWORDS,
        "files": files,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"style counts: {dict(style_counts)}")
    print(f"Saved {len(files)} unique avatars and {MANIFEST}")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    if "--from-cache" not in sys.argv:
        for keyword in KEYWORDS:
            download_keyword(keyword)

    buckets = collect_entries()
    records = rotate_unique(buckets, TARGET_COUNT)
    if len(records) < 200:
        available = {name: len(items) for name, items in buckets.items()}
        raise RuntimeError(
            f"Only assembled {len(records)} unique avatars; need at least 200. buckets={available}"
        )
    if len(records) < TARGET_COUNT:
        print(f"warning: only {len(records)} unique avatars (target {TARGET_COUNT})")

    write_outputs(records)
    if "--keep-raw" not in sys.argv:
        shutil.rmtree(RAW)


if __name__ == "__main__":
    main()
