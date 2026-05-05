import test from "node:test";
import assert from "node:assert/strict";
import { Row, Column, Box, Text, Spacer, Input, Image, m, dp, Color, Arrangement, Alignment, ContentScale, rounded, CircleShape } from "../../packages/runtime/src/index.mjs";
import { h, renderArrange } from "../../packages/runtime/src/test/index.mjs";

test("Row lays out fixed and weighted children", async () => {
  const ui = await renderArrange(() => h(Row, { modifier: m.size(dp(300), dp(100)) }, [
    h(Box, { modifier: m.width(dp(100)).fillMaxHeight().testTag("fixed") }),
    h(Box, { modifier: m.weight(1).fillMaxHeight().testTag("weighted") }),
  ]));
  assert.deepEqual(ui.node("fixed").bounds(), { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(ui.node("weighted").bounds(), { x: 100, y: 0, width: 200, height: 100 });
});

test("Column spacing, padding and text measurement produce stable bounds", async () => {
  const ui = await renderArrange(() => h(Column, { modifier: m.width(dp(200)).padding(dp(10)), verticalArrangement: Arrangement.spacedBy(dp(5)) }, [
    h(Text, { text: "Hello", textStyle: { fontSize: 10 }, modifier: m.testTag("hello") }),
    h(Spacer, { modifier: m.fillMaxWidth().height(dp(20)).testTag("space") }),
  ]));
  assert.deepEqual(ui.node("hello").bounds(), { x: 10, y: 10, width: 30, height: 12 });
  assert.ok(Math.abs(ui.node("hello").baseline() - 9.6) < 0.0001);
  assert.deepEqual(ui.node("space").bounds(), { x: 10, y: 27, width: 180, height: 20 });
});

test("Text maxLines, overflow and alignment are reflected in measurement and draw ops", async () => {
  const ui = await renderArrange(() => h(Text, {
    text: "Short\nLongest line\nHidden",
    textStyle: { fontSize: 10, lineHeight: 14 },
    textAlign: "center",
    maxLines: 2,
    overflow: "ellipsis",
    modifier: m.testTag("multi"),
  }));

  assert.deepEqual(ui.node("multi").bounds(), { x: 0, y: 0, width: 72, height: 28 });
  assert.ok(Math.abs(ui.node("multi").baseline() - 11.2) < 0.0001);
  assert.deepEqual(ui.drawOps(), [
    ["drawText", "Short\nLongest line\nHidden", 0, 0, 72, 28, { textAlign: "center", overflow: "ellipsis", maxLines: 2 }],
  ]);
});

test("Input multiline uses visible line count and minLines for headless measurement", async () => {
  const ui = await renderArrange(() => h(Input, {
    modelValue: "One\nLonger",
    singleLine: false,
    minLines: 3,
    textStyle: { fontSize: 16 },
  }));

  assert.deepEqual(ui.snapshot().bounds, { x: 0, y: 0, width: 120, height: 57.599999999999994 });
  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "drawText").at(-1), [
    "drawText",
    "One\nLonger",
    0,
    0,
    120,
    57.599999999999994,
    { textAlign: "start", overflow: "clip", maxLines: 2 },
  ]);
});

test("DrawOps include modifier visuals and text", async () => {
  const ui = await renderArrange(() => h(Box, { modifier: m.size(dp(100), dp(40)).background(Color(0xFF222222)).border(dp(1), Color(0xFF606060)) }, [
    h(Text, { text: "A", modifier: m.testTag("text") }),
  ]));
  assert.deepEqual(ui.drawOps().slice(0, 3), [
    ["fillRect", 0, 0, 100, 40, "0xFF222222"],
    ["strokeRect", 0, 0, 100, 40, 1, "0xFF606060"],
    ["drawText", "A", 0, 0, 8.4, 16.8],
  ]);
});

test("Modifier order changes padding and size measurement like Compose", async () => {
  const ui = await renderArrange(() => h(Column, {}, [
    h(Box, { modifier: m.size(dp(100), dp(40)).padding(dp(10)).testTag("size-then-padding") }),
    h(Box, { modifier: m.padding(dp(10)).size(dp(100), dp(40)).testTag("padding-then-size") }),
  ]));

  assert.deepEqual(ui.node("size-then-padding").bounds(), { x: 0, y: 0, width: 100, height: 40 });
  assert.deepEqual(ui.node("padding-then-size").bounds(), { x: 0, y: 40, width: 120, height: 60 });
});

test("DrawOps respect modifier order for background and padding", async () => {
  const ui = await renderArrange(() => h(Column, {}, [
    h(Box, { modifier: m.size(dp(100), dp(40)).background(Color(0xFF111111)).padding(dp(10)).testTag("outer-bg") }),
    h(Box, { modifier: m.size(dp(100), dp(40)).padding(dp(10)).background(Color(0xFF222222)).testTag("inner-bg") }),
  ]));

  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "fillRect"), [
    ["fillRect", 0, 0, 100, 40, "0xFF111111"],
    ["fillRect", 10, 50, 80, 20, "0xFF222222"],
  ]);
});

test("verticalScroll offsets child placement in headless layout", async () => {
  const scrollState = { value: 12 };
  const ui = await renderArrange(() => h(Column, { modifier: m.size(dp(100), dp(40)).verticalScroll(scrollState) }, [
    h(Text, { text: "Top", modifier: m.height(dp(20)).testTag("top") }),
    h(Text, { text: "Bottom", modifier: m.height(dp(20)).testTag("bottom") }),
  ]));
  assert.deepEqual(ui.node("top").bounds(), { x: 0, y: -12, width: 25.2, height: 20 });
  assert.deepEqual(ui.node("bottom").bounds(), { x: 0, y: 8, width: 50.4, height: 20 });
  assert.deepEqual(ui.drawOps(), [
    ["pushClip", 0, 0, 100, 40],
    ["drawText", "Top", 0, -12, 25.2, 20],
    ["drawText", "Bottom", 0, 8, 50.4, 20],
    ["popClip"],
  ]);
});

test("offset moves placement and alpha affects later draw ops", async () => {
  const ui = await renderArrange(() => h(Column, {}, [
    h(Box, {
      modifier: m
        .size(dp(20), dp(10))
        .offset({ x: dp(4), y: dp(3) })
        .background(Color(0xFF112233))
        .alpha(0.5)
        .border(dp(1), Color(0xFF445566)),
    }),
  ]));

  const box = ui.tree.children[0];
  assert.equal(box.x, 4);
  assert.equal(box.y, 3);
  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "fillRect").at(-1), ["fillRect", 4, 3, 20, 10, "0xFF112233"]);
  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "strokeRect").at(-1), ["strokeRect", 4, 3, 20, 10, 1, "0x80445566"]);
});

test("graphicsLayer translation moves placement without changing measured size", async () => {
  const ui = await renderArrange(() => h(Box, { modifier: m.size(dp(100), dp(50)) }, [
    h(Box, {
      modifier: m
        .size(dp(20), dp(10))
        .graphicsLayer({ translationX: dp(12), translationY: dp(7) })
        .background(Color(0xFF334455))
        .testTag("translated"),
    }),
  ]));

  assert.deepEqual(ui.node("translated").bounds(), { x: 12, y: 7, width: 20, height: 10 });
  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "fillRect").at(-1), ["fillRect", 12, 7, 20, 10, "0xFF334455"]);
});

test("graphicsLayer scale and rotation emit paint transform ops", async () => {
  const ui = await renderArrange(() => h(Box, { modifier: m.size(dp(100), dp(50)) }, [
    h(Box, {
      modifier: m
        .size(dp(20), dp(10))
        .graphicsLayer({ scaleX: 2, scaleY: 1.5, rotationZ: 30, transformOrigin: Alignment.TopStart })
        .background(Color(0xFF334455)),
    }),
  ]));

  assert.deepEqual(ui.drawOps().slice(-3), [
    ["pushTransform", 0, 0, 20, 10, 2, 1.5, 30, 0, 0],
    ["fillRect", 0, 0, 20, 10, "0xFF334455"],
    ["popTransform"],
  ]);
});

test("zIndex orders overlapping draw ops from back to front", async () => {
  const ui = await renderArrange(() => h(Box, { modifier: m.size(dp(30), dp(30)) }, [
    h(Box, { modifier: m.size(dp(20), dp(20)).zIndex(10).background(Color(0xFF0000FF)) }),
    h(Box, { modifier: m.size(dp(20), dp(20)).zIndex(0).background(Color(0xFFFF0000)) }),
  ]));

  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "fillRect"), [
    ["fillRect", 0, 0, 20, 20, "0xFFFF0000"],
    ["fillRect", 0, 0, 20, 20, "0xFF0000FF"],
  ]);
});

test("dropShadow emits a shadow draw op before content", async () => {
  const ui = await renderArrange(() => h(Box, {
    modifier: m
      .size(dp(20), dp(10))
      .dropShadow({ color: Color(0x80000000), offsetX: dp(3), offsetY: dp(2) })
      .background(Color(0xFF112233)),
  }));

  assert.deepEqual(ui.drawOps().slice(0, 2), [
    ["fillRect", 3, 2, 20, 10, "0x80000000"],
    ["fillRect", 0, 0, 20, 10, "0xFF112233"],
  ]);
});

test("shape-aware background border clip and shadows emit explicit draw ops", async () => {
  const ui = await renderArrange(() => h(Box, {
    modifier: m
      .size(dp(40), dp(24))
      .dropShadow({ color: Color(0x66000000), offset: { x: dp(2), y: dp(3) }, shape: rounded(dp(6)) })
      .background(Color(0xFF223344), rounded(dp(6)))
      .border(dp(2), Color(0xFF667788), rounded(dp(6)))
      .clip(CircleShape),
  }, [
    h(Box, { modifier: m.size(dp(12), dp(12)).background(Color(0xFFFFFFFF), CircleShape) }),
  ]));

  assert.deepEqual(ui.drawOps(), [
    ["fillRoundRect", 2, 3, 40, 24, 6, "0x66000000"],
    ["fillRoundRect", 0, 0, 40, 24, 6, "0xFF223344"],
    ["strokeRoundRect", 0, 0, 40, 24, 6, 2, "0xFF667788"],
    ["pushClipEllipse", 0, 0, 40, 24],
    ["fillEllipse", 0, 0, 12, 12, "0xFFFFFFFF"],
    ["popClip"],
  ]);
});

test("Image draw ops preserve contentScale alignment and tint intent", async () => {
  const ui = await renderArrange(() => h(Row, {}, [
    h(Image, {
      source: "logo.png",
      contentScale: ContentScale.Crop,
      alignment: Alignment.BottomEnd,
      tint: Color(0x80FFFFFF),
      modifier: m.size(dp(40), dp(20)),
    }),
    h(Image, {
      source: "wide.png",
      contentScale: ContentScale.FillWidth,
      alignment: Alignment.TopStart,
      modifier: m.size(dp(50), dp(20)),
    }),
    h(Image, {
      source: "tall.png",
      contentScale: ContentScale.FillHeight,
      alignment: Alignment.CenterEnd,
      modifier: m.size(dp(30), dp(60)),
    }),
  ]));

  assert.deepEqual(ui.drawOps().filter((op) => op[0] === "drawImage"), [
    [
      "drawImage",
      "logo.png",
      0,
      0,
      40,
      20,
      { contentScale: "Crop", alignment: "BottomEnd", tint: 0x80ffffff },
    ],
    [
      "drawImage",
      "wide.png",
      40,
      0,
      50,
      20,
      { contentScale: "FillWidth", alignment: "TopStart", tint: undefined },
    ],
    [
      "drawImage",
      "tall.png",
      90,
      0,
      30,
      60,
      { contentScale: "FillHeight", alignment: "CenterEnd", tint: undefined },
    ],
  ]);
});

