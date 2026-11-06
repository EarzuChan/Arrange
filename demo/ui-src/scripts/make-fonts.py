# 从系统里的 Noto Serif SC 可变字体切出 Demo 自带的静态字面（常规 400、粗体 700），并裁剪到 Demo 源码用到的字符。
# 字体许可证为 SIL OFL 1.1，见仓库根目录 THIRD_PARTY_NOTICES.md。
# 运行：python demo/ui-src/scripts/make-fonts.py [可变字体路径]（需要 fontTools）
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Windows/Fonts/NotoSerifSC-VF.ttf")
out = root / "public" / "fonts"
out.mkdir(parents=True, exist_ok=True)

chars = set(chr(c) for c in range(0x20, 0x7F))
for path in (root / "src").rglob("*"):
    if path.suffix in {".sfa", ".ts"}:
        chars.update(ch for ch in path.read_text(encoding="utf-8") if ord(ch) > 0x7F)
# 标点与少量常用字，便于在页面里改字时不立刻缺字
chars.update("，。、；：？！“”‘’（）《》【】—…·「」 ")
chars.update("永和九年岁在癸丑暮春之初会于会稽山阴之兰亭")

for style, weight in (("Regular", 400), ("Bold", 700)):
    font = TTFont(source)
    font = instancer.instantiateVariableFont(font, {"wght": weight})
    options = subset.Options()
    options.layout_features = ["kern", "liga"]
    options.name_IDs = [1, 2, 3, 4, 6, 13, 14]
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(font)
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    os2.fsSelection = (os2.fsSelection & ~0x61) | (0x20 if weight == 700 else 0x40)
    font["head"].macStyle = 1 if weight == 700 else 0
    for record in list(font["name"].names):
        if record.nameID == 1:
            record.string = "Noto Serif SC"
        elif record.nameID == 2:
            record.string = style
        elif record.nameID == 4:
            record.string = f"Noto Serif SC {style}"
    font.save(out / f"NotoSerifSC-{style}.ttf")
    print(style, (out / f"NotoSerifSC-{style}.ttf").stat().st_size)
