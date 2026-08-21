from pathlib import Path

from PIL import Image, ImageEnhance, ImageStat


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "avatars"


def normalize_avatar(image: Image.Image) -> Image.Image:
    """Trim a tiny screenshot border and normalize every avatar to 160px."""
    width, height = image.size
    inset = max(1, round(min(width, height) * 0.025))
    image = image.crop((inset, inset, width - inset, height - inset))
    image = image.resize((160, 160), Image.Resampling.LANCZOS).convert("RGB")
    return ImageEnhance.Sharpness(image).enhance(1.08)


def is_real_avatar(image: Image.Image) -> bool:
    stat = ImageStat.Stat(image.resize((16, 16)).convert("RGB"))
    return sum(stat.var) > 260


def extract(source_name: str, prefix: str, xs: list[int], ys: list[int], size: int) -> int:
    source = Image.open(ROOT / source_name).convert("RGB")
    count = 0
    for y in ys:
        for x in xs:
            avatar = source.crop((x, y, x + size, y + size))
            if not is_real_avatar(avatar):
                continue
            count += 1
            normalize_avatar(avatar).save(
                OUTPUT / f"{prefix}-{count:02d}.jpg", quality=92, optimize=True
            )
    return count


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    specs = [
        ("样例1.jpg", "sample1", [153, 265, 378, 491, 604, 717, 830, 943, 1056], [853, 966, 1079], 95),
        ("样例2.jpg", "sample2", [147, 248, 348, 448, 548, 648, 748, 848, 948], [743, 844, 945], 82),
    ]
    total = sum(extract(*spec) for spec in specs)
    print(f"Extracted {total} avatars to {OUTPUT}")


if __name__ == "__main__":
    main()
