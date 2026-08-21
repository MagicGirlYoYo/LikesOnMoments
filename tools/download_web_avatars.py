import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "web-avatars"
MANIFEST = OUTPUT / "sources.json"
TARGET_COUNT = 99
RAW = OUTPUT / "raw"


def normalize_avatar(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as source:
        avatar = ImageOps.fit(source.convert("RGB"), (256, 256), Image.Resampling.LANCZOS)
        output = BytesIO()
        avatar.save(output, "JPEG", quality=91, optimize=True, progressive=True)
        return output.getvalue()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    if "--from-cache" not in sys.argv:
        for gender in ("men", "women"):
            subprocess.run(
                [
                    "curl.exe", "-sS", "-L", "--fail", "--create-dirs",
                    f"https://randomuser.me/api/portraits/{gender}/[0-49].jpg",
                    "-o", str(RAW / f"{gender}-#1.jpg"),
                ],
                check=True,
            )

    seen = set()
    records = []

    for source in sorted(RAW.glob("*.jpg")):
        normalized = normalize_avatar(source.read_bytes())
        digest = hashlib.sha256(normalized).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        number = len(records) + 1
        filename = f"avatar-{number:03d}.jpg"
        gender, source_number = source.stem.split("-")
        source_url = f"https://randomuser.me/api/portraits/{gender}/{source_number}.jpg"
        (OUTPUT / filename).write_bytes(normalized)
        records.append({"file": filename, "source": source_url, "sha256": digest})
        print(f"[{number:02d}/{TARGET_COUNT}] {filename}")
        if len(records) >= TARGET_COUNT:
            break

    if len(records) != TARGET_COUNT:
        raise RuntimeError(f"Only downloaded {len(records)} unique avatars")

    manifest = {
        "provider": "Random User Generator",
        "provider_url": "https://randomuser.me/",
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "count": len(records),
        "files": records,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.rmtree(RAW)
    print(f"Saved {len(records)} unique avatars and {MANIFEST}")


if __name__ == "__main__":
    main()
