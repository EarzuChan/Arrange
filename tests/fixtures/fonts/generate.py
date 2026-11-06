# 生成 Arrange 测试用的原创方块字体：只有字符 A-Z、a-z、0-9、空格与句点，字形是方块，
# 常规、粗体、斜体三个字面的前进量互不相同，原生测试据此判断选中了哪个字面。
# 运行：python tests/fixtures/fonts/generate.py（需要 fontTools）
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = Path(__file__).parent
EM = 1000
CHARS = [" ", "."] + [chr(c) for c in range(ord("0"), ord("9") + 1)] + [chr(c) for c in range(ord("A"), ord("Z") + 1)] + [chr(c) for c in range(ord("a"), ord("z") + 1)]

def glyph_name(ch: str) -> str:
    return {" ": "space", ".": "period"}.get(ch, ch if ch.isalnum() and ch.isascii() else f"uni{ord(ch):04X}")

def build(style: str, weight: int, advance: int, italic: bool, bold: bool) -> None:
    glyphs = {".notdef": None}
    metrics = {".notdef": (advance, 0)}
    cmap = {}
    for ch in CHARS:
        name = glyph_name(ch)
        cmap[ord(ch)] = name
        metrics[name] = (advance, 40)
        if ch == " ":
            glyphs[name] = None
            continue
        height = 700 if not ch.islower() else 500
        pen = TTGlyphPen(None)
        left, right = 40, advance - 40
        skew = 150 if italic else 0
        pen.moveTo((left, 0)); pen.lineTo((left + skew, height)); pen.lineTo((right + skew, height)); pen.lineTo((right, 0)); pen.closePath()
        # 内部镂空一个小方块，让字形不是实心块
        inset = 120
        pen.moveTo((left + inset, inset)); pen.lineTo((right - inset, inset)); pen.lineTo((right - inset + skew * 0, height - inset)); pen.lineTo((left + inset, height - inset)); pen.closePath()
        glyphs[name] = pen.glyph()
    pen = TTGlyphPen(None)
    pen.moveTo((40, 0)); pen.lineTo((40, 700)); pen.lineTo((advance - 40, 700)); pen.lineTo((advance - 40, 0)); pen.closePath()
    glyphs[".notdef"] = pen.glyph()
    empty = TTGlyphPen(None).glyph()
    glyph_order = [".notdef"] + [glyph_name(c) for c in CHARS]
    glyphs = {name: (g if g is not None else empty) for name, g in glyphs.items()}
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (advance, 40) for name in glyph_order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    selection = (0x01 if italic else 0) | (0x20 if bold else 0) | (0x40 if not italic and not bold else 0)
    fb.setupNameTable({"familyName": "Arrange Test Sans", "styleName": style})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, usWeightClass=weight, fsSelection=selection)
    fb.setupPost()
    fb.font["head"].macStyle = (1 if bold else 0) | (2 if italic else 0)
    fb.save(OUT / f"ArrangeTestSans-{style}.ttf")

build("Regular", 400, 520, False, False)
build("Bold", 700, 680, False, True)
build("Italic", 400, 600, True, False)
