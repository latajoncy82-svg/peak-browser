from pathlib import Path
from PIL import Image, ImageDraw

SOURCE_IMAGE = Path(
    r"C:/Users/lataj/.gemini/antigravity/brain/a35d23c9-1396-4aa6-a047-2dc7826c9e30/.user_uploaded/media_1795122723744_e334cb0c.jpg"
)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = PROJECT_ROOT / "assets"

# Exact measured squircle interior bounds (excluding outer white background & drop shadow)
CROP_BOX = (116, 108, 906, 898)


def create_rounded_mask(size: int, radius_ratio: float = 0.225, scale: int = 4) -> Image.Image:
    big = size * scale
    radius = int(big * radius_ratio)
    mask_big = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask_big)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=radius, fill=255)
    return mask_big.resize((size, size), Image.Resampling.LANCZOS)


def build_icons() -> None:
    if not SOURCE_IMAGE.exists():
        raise FileNotFoundError(f"Source logo not found: {SOURCE_IMAGE}")

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    img = Image.open(SOURCE_IMAGE).convert("RGBA")
    cropped = img.crop(CROP_BOX)

    # 512x512 main icon
    icon_512 = cropped.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.putalpha(create_rounded_mask(512))
    icon_512.save(ASSETS_DIR / "icon.png", format="PNG")

    # 64x64 UI icon
    icon_64 = cropped.resize((64, 64), Image.Resampling.LANCZOS)
    icon_64.putalpha(create_rounded_mask(64))
    icon_64.save(ASSETS_DIR / "icon-64.png", format="PNG")

    # Multi-size ICO for Windows taskbar, titlebar & shortcuts
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_base = cropped.resize((256, 256), Image.Resampling.LANCZOS)
    ico_base.putalpha(create_rounded_mask(256))
    ico_base.save(ASSETS_DIR / "icon.ico", format="ICO", sizes=ico_sizes)

    print("Generated icons in:", ASSETS_DIR)


if __name__ == "__main__":
    build_icons()
