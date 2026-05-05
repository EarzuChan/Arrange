import vue from "@vitejs/plugin-vue";
import arrange from "@arrange/vite-plugin";

const arrangeTags = new Set([
  "Box",
  "Row",
  "Column",
  "Spacer",
  "Text",
  "Input",
  "Image",
  "Icon",
  "Canvas",
  "FlowRow",
  "FlowColumn",
  "LazyColumn",
  "LazyRow",
  "LazyVerticalGrid",
  "LazyHorizontalGrid",
]);

export default {
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => arrangeTags.has(tag),
        },
      },
    }),
    arrange(),
  ],
};
