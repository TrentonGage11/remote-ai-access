import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6.5.2";
import { EditorView, lineNumbers, highlightActiveLineGutter } from "https://esm.sh/@codemirror/view@6.38.7?deps=@codemirror/state@6.5.2";
import { syntaxHighlighting, HighlightStyle, StreamLanguage } from "https://esm.sh/@codemirror/language@6.11.3?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7";
import { tags } from "https://esm.sh/@lezer/highlight@1.2.1";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.4?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { html } from "https://esm.sh/@codemirror/lang-html@6.4.9?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { css } from "https://esm.sh/@codemirror/lang-css@6.3.1?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { json } from "https://esm.sh/@codemirror/lang-json@6.0.1?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { markdown } from "https://esm.sh/@codemirror/lang-markdown@6.3.4?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { python } from "https://esm.sh/@codemirror/lang-python@6.1.6?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { cpp } from "https://esm.sh/@codemirror/lang-cpp@6.0.2?deps=@codemirror/state@6.5.2,@codemirror/view@6.38.7,@codemirror/language@6.11.3";
import { tcl as tclMode } from "https://esm.sh/@codemirror/legacy-modes@6.4.0/mode/tcl";

const synopterKeywords = new Set([
  "actor", "alarm", "and", "call", "channel", "command", "config", "connect", "const", "define", "else",
  "end", "enum", "event", "false", "for", "function", "if", "import", "include", "link", "message", "module",
  "not", "on", "or", "param", "return", "signal", "state", "struct", "task", "then", "true", "type", "var", "while"
]);

const qmlKeywords = new Set([
  "import", "as", "property", "signal", "readonly", "required", "id", "alias", "function", "on", "if", "else",
  "for", "while", "return", "var", "true", "false", "null", "pragma", "component", "default"
]);

function createSimpleWordMode({ keywords = new Set(), hashComments = false, slashComments = true, blockComments = true }) {
  return {
    startState() {
      return { inString: "", inBlockComment: false };
    },
    token(stream, state) {
      if (stream.eatSpace()) {
        return null;
      }

      if (state.inBlockComment) {
        if (stream.skipTo("*/")) {
          stream.match("*/");
          state.inBlockComment = false;
        } else {
          stream.skipToEnd();
        }
        return "comment";
      }

      if (state.inString) {
        let escaped = false;
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === state.inString && !escaped) {
            state.inString = "";
            break;
          }
          escaped = ch === "\\" ? !escaped : false;
        }
        return "string";
      }

      if (hashComments && stream.match("#")) {
        stream.skipToEnd();
        return "comment";
      }
      if (slashComments && stream.match("//")) {
        stream.skipToEnd();
        return "comment";
      }
      if (blockComments && stream.match("/*")) {
        state.inBlockComment = true;
        return "comment";
      }

      const quote = stream.peek();
      if (quote === '"' || quote === "'") {
        state.inString = quote;
        stream.next();
        return "string";
      }

      if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) {
        return "number";
      }

      if (stream.match(/^[A-Za-z_][A-Za-z0-9_\-.]*/)) {
        const word = stream.current();
        if (keywords.has(word)) {
          return "keyword";
        }
        if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
          return "typeName";
        }
        return "variableName";
      }

      if (stream.match(/^(==|!=|<=|>=|&&|\|\||=>|:=|[-+*/%<>!=&|^~?:])/)) {
        return "operator";
      }

      stream.next();
      return null;
    }
  };
}

const synopterMode = createSimpleWordMode({
  keywords: synopterKeywords,
  hashComments: true,
  slashComments: true,
  blockComments: true
});

const qmlMode = createSimpleWordMode({
  keywords: qmlKeywords,
  hashComments: false,
  slashComments: true,
  blockComments: true
});

const fileListEl = document.getElementById("fileList");
const dirPathInputEl = document.getElementById("dirPathInput");
const fileUploadInputEl = document.getElementById("fileUploadInput");
const folderUploadInputEl = document.getElementById("folderUploadInput");
const dropZoneEl = document.getElementById("dropZone");
const activePathLabelEl = document.getElementById("activePathLabel");
const fileStatusEl = document.getElementById("fileStatus");
const editorRootEl = document.getElementById("editorRoot");
const editorLayoutEl = document.getElementById("editorLayout");
const themeToggleEl = document.getElementById("themeToggle");
const syntaxThemeSelectEl = document.getElementById("syntaxThemeSelect");
const fontSizeRangeEl = document.getElementById("fontSizeRange");
const fontSizeValueEl = document.getElementById("fontSizeValue");
const minimapToggleEl = document.getElementById("minimapToggle");
const minimapPaneEl = document.getElementById("minimapPane");
const minimapCanvasEl = document.getElementById("minimapCanvas");
const minimapViewportEl = document.getElementById("minimapViewport");
const diffModalEl = document.getElementById("diffModal");
const diffOriginalEl = document.getElementById("diffOriginal");
const diffUpdatedEl = document.getElementById("diffUpdated");
const diffCancelBtnEl = document.getElementById("diffCancelBtn");
const diffConfirmBtnEl = document.getElementById("diffConfirmBtn");

const refreshBtnEl = document.getElementById("refreshBtn");
const goDirBtnEl = document.getElementById("goDirBtn");
const uploadBtnEl = document.getElementById("uploadBtn");
const uploadFolderBtnEl = document.getElementById("uploadFolderBtn");
const newFileBtnEl = document.getElementById("newFileBtn");
const newDirBtnEl = document.getElementById("newDirBtn");
const renameBtnEl = document.getElementById("renameBtn");
const moveBtnEl = document.getElementById("moveBtn");
const deleteBtnEl = document.getElementById("deleteBtn");
const downloadBtnEl = document.getElementById("downloadBtn");
const saveBtnEl = document.getElementById("saveBtn");
const formatBtnEl = document.getElementById("formatBtn");
const lintBtnEl = document.getElementById("lintBtn");
const gitLogBtnEl = document.getElementById("gitLogBtn");
const revertBtnEl = document.getElementById("revertBtn");

const THEME_STORAGE_KEY = "remote-ai-access-theme";
const FILELAB_SYNTAX_THEME_KEY = "filelab-syntax-theme";
const FILELAB_FONT_SIZE_KEY = "filelab-font-size";
const FILELAB_MINIMAP_KEY = "filelab-minimap-enabled";
const languageCompartment = new Compartment();
const editorThemeCompartment = new Compartment();

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;

let currentDir = "";
let activeFilePath = "";
let originalFileContent = "";
let view;
let pendingSaveAction = null;
let editorInitError = null;
let currentSyntaxTheme = "verdant";
let currentFontSize = 14;
let minimapEnabled = true;
let minimapFrame = 0;
let minimapBoundScroller = null;

const syntaxThemePalette = {
  verdant: {
    label: "Verdant",
    light: {
      keyword: "#0b6b42",
      string: "#8a2d12",
      number: "#0b5ea8",
      comment: "#5a7868",
      variable: "#133327",
      fn: "#6c2ac2",
      type: "#134f8b"
    },
    dark: {
      keyword: "#7de4b0",
      string: "#f7b79a",
      number: "#8ad0ff",
      comment: "#88a99a",
      variable: "#e7fff3",
      fn: "#d2a5ff",
      type: "#9fcdf7"
    }
  },
  "cyberpunk-hc": {
    label: "Cyberpunk HC",
    light: {
      keyword: "#d94a00",
      string: "#8f00c9",
      number: "#006ad6",
      comment: "#b70d2b",
      variable: "#1d0830",
      fn: "#4734de",
      type: "#c21f42"
    },
    dark: {
      keyword: "#ff7a00",
      string: "#d100ff",
      number: "#28a7ff",
      comment: "#ff4d64",
      variable: "#f3eeff",
      fn: "#7a63ff",
      type: "#ff2f57"
    }
  },
  ember: {
    label: "Ember",
    light: {
      keyword: "#8f3a08",
      string: "#7f1d1d",
      number: "#2a5bbf",
      comment: "#6f6b66",
      variable: "#35241b",
      fn: "#8f2d74",
      type: "#7a4414"
    },
    dark: {
      keyword: "#ffb07f",
      string: "#ff9e9e",
      number: "#9ec6ff",
      comment: "#b8a99e",
      variable: "#ffeede",
      fn: "#ffb0ef",
      type: "#ffd3a6"
    }
  },
  oceanic: {
    label: "Oceanic",
    light: {
      keyword: "#045b8f",
      string: "#12564e",
      number: "#3f3fa9",
      comment: "#5b7480",
      variable: "#112e45",
      fn: "#0a6a8f",
      type: "#18508f"
    },
    dark: {
      keyword: "#87dcff",
      string: "#91ecd2",
      number: "#b8b8ff",
      comment: "#8fa8bb",
      variable: "#d8f1ff",
      fn: "#87dfff",
      type: "#9ac2ff"
    }
  },
  mono: {
    label: "Mono Ink",
    light: {
      keyword: "#1f2a35",
      string: "#2d3944",
      number: "#283646",
      comment: "#66717c",
      variable: "#15212b",
      fn: "#1e2e3d",
      type: "#1f2a35"
    },
    dark: {
      keyword: "#dce8f2",
      string: "#cdd9e4",
      number: "#d3deea",
      comment: "#8ea0b2",
      variable: "#eff7ff",
      fn: "#d9e4ef",
      type: "#ddeaf8"
    }
  },
  preparing: {
    label: "Preparing",
    light: {
      keyword: "#c45a16",
      string: "#9f2f5d",
      number: "#1f6fa6",
      comment: "#6d6a76",
      variable: "#2b2233",
      fn: "#7a3aa6",
      type: "#7a4a1f"
    },
    dark: {
      keyword: "#ffb86b",
      string: "#ff8fb3",
      number: "#8bc8ff",
      comment: "#9b91a8",
      variable: "#f2ecff",
      fn: "#cda7ff",
      type: "#ffd19a"
    }
  }
};

function buildHighlightStyle(colors) {
  return HighlightStyle.define([
    { tag: tags.keyword, color: colors.keyword, fontWeight: "700" },
    { tag: [tags.string, tags.special(tags.string)], color: colors.string },
    { tag: [tags.number, tags.bool, tags.null], color: colors.number },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: colors.comment, fontStyle: "italic" },
    { tag: [tags.variableName, tags.propertyName], color: colors.variable },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: colors.fn },
    { tag: tags.typeName, color: colors.type }
  ]);
}

function getSyntaxTheme() {
  if (syntaxThemePalette[currentSyntaxTheme]) {
    return currentSyntaxTheme;
  }
  return "verdant";
}

function getHighlightStyleForMode(mode) {
  const themeKey = getSyntaxTheme();
  const palette = syntaxThemePalette[themeKey] || syntaxThemePalette.verdant;
  return buildHighlightStyle(mode === "dark" ? palette.dark : palette.light);
}

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

function getEditorThemeExtension(theme) {
  const fontSizePx = `${currentFontSize}px`;
  if (theme === "dark") {
    return [
      EditorView.theme({
        "&": { height: "100%", fontSize: fontSizePx, color: "#dbf8eb" },
        ".cm-scroller": { fontFamily: '"IBM Plex Mono", monospace' },
        ".cm-content": { caretColor: "#7de4b0" },
        ".cm-gutters": {
          borderRight: "1px solid rgba(188, 238, 215, 0.2)",
          backgroundColor: "rgba(12, 22, 18, 0.94)",
          color: "#9ac0ad"
        },
        ".cm-activeLine": { backgroundColor: "rgba(57, 203, 131, 0.12)" },
        ".cm-activeLineGutter": { backgroundColor: "rgba(57, 203, 131, 0.14)" },
        ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgba(57, 203, 131, 0.3)" }
      }),
      syntaxHighlighting(getHighlightStyleForMode("dark"))
    ];
  }

  return [
    EditorView.theme({
      "&": { height: "100%", fontSize: fontSizePx, color: "#102218" },
      ".cm-scroller": { fontFamily: '"IBM Plex Mono", monospace' },
      ".cm-content": { caretColor: "#0a8f56" },
      ".cm-gutters": {
        borderRight: "1px solid rgba(16, 34, 24, 0.15)",
        backgroundColor: "rgba(255, 255, 255, 0.72)",
        color: "#4d6356"
      },
      ".cm-activeLine": { backgroundColor: "rgba(10, 143, 86, 0.08)" },
      ".cm-activeLineGutter": { backgroundColor: "rgba(10, 143, 86, 0.1)" },
      ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgba(10, 143, 86, 0.2)" }
    }),
    syntaxHighlighting(getHighlightStyleForMode("light"))
  ];
}

function clampFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 14;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(numeric)));
}

function setFontSizeLabel(size) {
  if (fontSizeRangeEl) {
    fontSizeRangeEl.value = String(size);
  }
  if (fontSizeValueEl) {
    fontSizeValueEl.textContent = `${size}px`;
  }
}

function applyFontSize(size, persist = true) {
  currentFontSize = clampFontSize(size);
  setFontSizeLabel(currentFontSize);
  if (persist) {
    localStorage.setItem(FILELAB_FONT_SIZE_KEY, String(currentFontSize));
  }

  if (view) {
    view.dispatch({
      effects: editorThemeCompartment.reconfigure(getEditorThemeExtension(getCurrentTheme()))
    });
  }
  scheduleMinimapRender();
}

function applySyntaxTheme(themeName, persist = true) {
  currentSyntaxTheme = syntaxThemePalette[themeName] ? themeName : "verdant";
  if (syntaxThemeSelectEl) {
    syntaxThemeSelectEl.value = currentSyntaxTheme;
  }
  if (persist) {
    localStorage.setItem(FILELAB_SYNTAX_THEME_KEY, currentSyntaxTheme);
  }

  if (view) {
    view.dispatch({
      effects: editorThemeCompartment.reconfigure(getEditorThemeExtension(getCurrentTheme()))
    });
  }
  scheduleMinimapRender();
}

function getMinimapColors() {
  const isDark = getCurrentTheme() === "dark";
  if (currentSyntaxTheme === "ember") {
    return isDark
      ? { bg: "#131111", line: "rgba(255, 176, 127, 0.7)", viewport: "rgba(255, 176, 127, 0.35)" }
      : { bg: "#fff7f1", line: "rgba(143, 58, 8, 0.58)", viewport: "rgba(143, 58, 8, 0.2)" };
  }
  if (currentSyntaxTheme === "oceanic") {
    return isDark
      ? { bg: "#10171c", line: "rgba(135, 220, 255, 0.7)", viewport: "rgba(135, 220, 255, 0.35)" }
      : { bg: "#f1f8ff", line: "rgba(4, 91, 143, 0.52)", viewport: "rgba(4, 91, 143, 0.18)" };
  }
  if (currentSyntaxTheme === "mono") {
    return isDark
      ? { bg: "#11161b", line: "rgba(220, 232, 242, 0.58)", viewport: "rgba(220, 232, 242, 0.24)" }
      : { bg: "#f7fbff", line: "rgba(31, 42, 53, 0.46)", viewport: "rgba(31, 42, 53, 0.2)" };
  }
  if (currentSyntaxTheme === "preparing") {
    return isDark
      ? { bg: "#16111d", line: "rgba(255, 184, 107, 0.72)", viewport: "rgba(255, 184, 107, 0.32)" }
      : { bg: "#fff7ef", line: "rgba(196, 90, 22, 0.54)", viewport: "rgba(196, 90, 22, 0.18)" };
  }
  if (currentSyntaxTheme === "cyberpunk-hc") {
    return isDark
      ? { bg: "#0b0614", line: "rgba(255, 122, 0, 0.78)", viewport: "rgba(209, 0, 255, 0.34)" }
      : { bg: "#fff4ff", line: "rgba(217, 74, 0, 0.6)", viewport: "rgba(143, 0, 201, 0.24)" };
  }
  return isDark
    ? { bg: "#0f1714", line: "rgba(125, 228, 176, 0.72)", viewport: "rgba(125, 228, 176, 0.3)" }
    : { bg: "#f1f8f5", line: "rgba(11, 107, 66, 0.54)", viewport: "rgba(11, 107, 66, 0.18)" };
}

function hashLine(line) {
  let hash = 0;
  for (let i = 0; i < line.length; i += 1) {
    hash = ((hash << 5) - hash) + line.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function ensureMinimapCanvasSize() {
  if (!minimapCanvasEl || !minimapPaneEl) {
    return null;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, minimapPaneEl.clientWidth);
  const height = Math.max(1, minimapPaneEl.clientHeight);
  const nextWidth = Math.round(width * dpr);
  const nextHeight = Math.round(height * dpr);

  if (minimapCanvasEl.width !== nextWidth || minimapCanvasEl.height !== nextHeight) {
    minimapCanvasEl.width = nextWidth;
    minimapCanvasEl.height = nextHeight;
  }
  return { dpr, width, height };
}

function getEditorScroller() {
  if (!view) {
    return null;
  }
  return view.scrollDOM || editorRootEl.querySelector(".cm-scroller");
}

function updateMinimapViewport() {
  if (!minimapEnabled || !minimapViewportEl || !minimapPaneEl) {
    return;
  }
  const scroller = getEditorScroller();
  if (!scroller) {
    return;
  }

  const paneHeight = Math.max(1, minimapPaneEl.clientHeight);
  const ratio = paneHeight / Math.max(1, scroller.scrollHeight);
  const top = scroller.scrollTop * ratio;
  const height = Math.max(18, scroller.clientHeight * ratio);

  minimapViewportEl.style.top = `${Math.min(top, Math.max(0, paneHeight - 18))}px`;
  minimapViewportEl.style.height = `${Math.min(paneHeight, height)}px`;
}

function bindMinimapScroller() {
  const scroller = getEditorScroller();
  if (!scroller || minimapBoundScroller === scroller) {
    return;
  }
  if (minimapBoundScroller) {
    minimapBoundScroller.removeEventListener("scroll", updateMinimapViewport);
  }
  minimapBoundScroller = scroller;
  minimapBoundScroller.addEventListener("scroll", updateMinimapViewport, { passive: true });
}

function renderMinimap() {
  if (!view || !minimapEnabled || !minimapCanvasEl || !minimapPaneEl) {
    return;
  }

  bindMinimapScroller();
  const size = ensureMinimapCanvasSize();
  if (!size) {
    return;
  }

  const { dpr, width, height } = size;
  const ctx = minimapCanvasEl.getContext("2d");
  if (!ctx) {
    return;
  }

  const colors = getMinimapColors();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  const lines = view.state.doc.toString().split("\n");
  const lineCount = Math.max(1, lines.length);
  const lineStep = Math.max(height / lineCount, 0.5);
  const barHeight = Math.max(1, lineStep * 0.9);

  for (let i = 0; i < lineCount; i += 1) {
    const text = lines[i] || "";
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }

    const y = i * lineStep;
    const hash = hashLine(trimmed);
    const variation = (hash % 20) / 100;
    const density = Math.min(1, trimmed.length / 120);
    const barWidth = Math.max(6, (width - 8) * (0.25 + density * 0.75));

    ctx.fillStyle = colors.line.replace(/0\.\d+\)/, `${Math.min(0.85, 0.45 + variation)})`);
    ctx.fillRect(4, y, barWidth, barHeight);
  }

  if (minimapViewportEl) {
    minimapViewportEl.style.background = colors.viewport;
  }
  updateMinimapViewport();
}

function scheduleMinimapRender() {
  if (minimapFrame) {
    return;
  }
  minimapFrame = window.requestAnimationFrame(() => {
    minimapFrame = 0;
    renderMinimap();
  });
}

function applyMinimapEnabled(enabled, persist = true) {
  minimapEnabled = Boolean(enabled);
  if (persist) {
    localStorage.setItem(FILELAB_MINIMAP_KEY, minimapEnabled ? "1" : "0");
  }

  if (editorLayoutEl) {
    editorLayoutEl.classList.toggle("minimap-hidden", !minimapEnabled);
  }
  if (minimapPaneEl) {
    minimapPaneEl.hidden = !minimapEnabled;
  }
  if (minimapToggleEl) {
    minimapToggleEl.textContent = minimapEnabled ? "Hide minimap" : "Show minimap";
  }

  if (minimapEnabled) {
    scheduleMinimapRender();
  }
}

function initEditorPreferences() {
  const storedSyntax = localStorage.getItem(FILELAB_SYNTAX_THEME_KEY);
  applySyntaxTheme(storedSyntax || "verdant", false);

  const storedFont = localStorage.getItem(FILELAB_FONT_SIZE_KEY);
  applyFontSize(storedFont ? Number(storedFont) : 14, false);

  const storedMinimap = localStorage.getItem(FILELAB_MINIMAP_KEY);
  applyMinimapEnabled(storedMinimap !== "0", false);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleEl) {
    themeToggleEl.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }

  if (view) {
    view.dispatch({
      effects: editorThemeCompartment.reconfigure(getEditorThemeExtension(theme))
    });
  }
  scheduleMinimapRender();
}

function initTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    applyTheme(storedTheme);
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function setStatus(text) {
  fileStatusEl.textContent = text;
}

function extensionForPath(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".jsx") || lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return javascript({ jsx: true, typescript: lower.endsWith(".ts") || lower.endsWith(".tsx") });
  }
  if (lower.endsWith(".json")) return json();
  if (lower.endsWith(".html")) return html();
  if (lower.endsWith(".css")) return css();
  if (lower.endsWith(".md")) return markdown();
  if (lower.endsWith(".py")) return python();
  if (lower.endsWith(".tcl") || lower.endsWith(".tm")) return StreamLanguage.define(tclMode);
  if (lower.endsWith(".qml") || lower.endsWith(".qmltypes") || lower.endsWith(".qrc")) return StreamLanguage.define(qmlMode);
  if (lower.endsWith(".syn") || lower.endsWith(".synopter") || lower.endsWith(".ccs5") || lower.endsWith(".spt")) return StreamLanguage.define(synopterMode);
  if (lower.endsWith(".c") || lower.endsWith(".h") || lower.endsWith(".cc") || lower.endsWith(".cpp") || lower.endsWith(".cxx") || lower.endsWith(".hpp") || lower.endsWith(".hh") || lower.endsWith(".hxx")) return cpp();
  return [];
}

function initEditor() {
  if (view) {
    return view;
  }
  if (!editorRootEl) {
    throw new Error("Editor root element was not found.");
  }

  const state = EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.viewportChanged) {
          scheduleMinimapRender();
        }
      }),
      languageCompartment.of([]),
      editorThemeCompartment.of(getEditorThemeExtension(getCurrentTheme()))
    ]
  });

  view = new EditorView({
    state,
    parent: editorRootEl
  });

  editorInitError = null;
  scheduleMinimapRender();
  return view;
}

function requireEditorView() {
  if (view) {
    return view;
  }
  if (editorInitError) {
    throw editorInitError;
  }

  try {
    return initEditor();
  } catch (error) {
    editorInitError = error instanceof Error ? error : new Error(String(error));
    throw editorInitError;
  }
}

function setEditorContent(text, filePath) {
  const editorView = requireEditorView();
  const ext = extensionForPath(filePath);
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
    effects: languageCompartment.reconfigure(ext)
  });
  scheduleMinimapRender();
}

function getEditorText() {
  return requireEditorView().state.doc.toString();
}

function clearLintDiagnostics() {
  // No in-editor diagnostics currently; lint results are shown via alert/status.
}

function setCursorPosition(line, col) {
  const editorView = requireEditorView();
  const pos = posFromLineCol(editorView.state.doc, Number(line || 1), Number(col || 1));
  editorView.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true
  });
  editorView.focus();
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function joinPath(dir, name) {
  const base = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return name;
  return `${base}/${name}`;
}

function parentDir(dir) {
  const cleaned = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!cleaned) return "";
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(0, idx) : "";
}

async function loadDirectory(pathValue = currentDir) {
  const path = String(pathValue || "").trim();
  const query = new URLSearchParams({ path });
  const data = await apiJson(`/api/files/list?${query.toString()}`);

  currentDir = data.path || "";
  dirPathInputEl.value = currentDir;
  renderFileList(data.entries || []);
}

function formatForDiff(text) {
  const lines = String(text || "").split("\n");
  return lines
    .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

function showDiffModal(originalText, updatedText, onConfirm) {
  pendingSaveAction = onConfirm;
  diffOriginalEl.textContent = formatForDiff(originalText);
  diffUpdatedEl.textContent = formatForDiff(updatedText);
  diffModalEl.classList.add("open");
  diffModalEl.setAttribute("aria-hidden", "false");
}

function hideDiffModal() {
  pendingSaveAction = null;
  diffModalEl.classList.remove("open");
  diffModalEl.setAttribute("aria-hidden", "true");
}

function renderFileList(entries) {
  fileListEl.innerHTML = "";

  if (currentDir) {
    const upItem = document.createElement("li");
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "file-item up";
    upBtn.textContent = ".. (parent)";
    upBtn.addEventListener("click", () => {
      loadDirectory(parentDir(currentDir)).catch((error) => setStatus(`Error: ${error.message}`));
    });
    upItem.appendChild(upBtn);
    fileListEl.appendChild(upItem);
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `file-item ${entry.type}`;
    btn.textContent = `${entry.type === "directory" ? "[D]" : "[F]"} ${entry.name}`;
    btn.title = `${entry.name} (${entry.size} bytes)`;

    btn.addEventListener("click", async () => {
      const targetPath = joinPath(currentDir, entry.name);
      if (entry.type === "directory") {
        try {
          await loadDirectory(targetPath);
          setStatus(`Opened folder: ${targetPath}`);
        } catch (error) {
          setStatus(`Error: ${error.message}`);
        }
        return;
      }

      try {
        const fileData = await apiJson(`/api/files/read?${new URLSearchParams({ path: targetPath }).toString()}`);
        activeFilePath = fileData.path;
        originalFileContent = fileData.content || "";
        activePathLabelEl.textContent = activeFilePath;
        setEditorContent(fileData.content || "", activeFilePath);
        clearLintDiagnostics();
        setStatus(`Loaded ${activeFilePath}`);
      } catch (error) {
        setStatus(`Error: ${error.message}`);
      }
    });

    item.appendChild(btn);
    fileListEl.appendChild(item);
  }
}

async function saveActiveFile() {
  if (!activeFilePath) {
    setStatus("Select or create a file first.");
    return;
  }

  await apiJson("/api/files/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: activeFilePath, content: getEditorText() })
  });
  originalFileContent = getEditorText();
  setStatus(`Saved ${activeFilePath}`);
  await loadDirectory(currentDir);
}

async function openFileByPath(targetPath, line, col) {
  const cleanPath = normalizeRelativePath(targetPath);
  if (!cleanPath) {
    return;
  }

  const fileData = await apiJson(`/api/files/read?${new URLSearchParams({ path: cleanPath }).toString()}`);
  activeFilePath = fileData.path;
  originalFileContent = fileData.content || "";
  activePathLabelEl.textContent = activeFilePath;
  setEditorContent(fileData.content || "", activeFilePath);
  clearLintDiagnostics();

  const dir = parentDir(activeFilePath);
  await loadDirectory(dir);
  if (line || col) {
    setCursorPosition(line, col);
  }
  setStatus(`Loaded ${activeFilePath}`);
}

function previewAndSave() {
  if (!activeFilePath) {
    setStatus("Select or create a file first.");
    return;
  }

  const currentContent = getEditorText();
  if (currentContent === originalFileContent) {
    setStatus("No changes to save.");
    return;
  }

  showDiffModal(originalFileContent, currentContent, async () => {
    try {
      await saveActiveFile();
      hideDiffModal();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  });
}

async function formatActiveFile() {
  if (!activeFilePath) {
    setStatus("Select or create a file first.");
    return;
  }

  const data = await apiJson("/api/files/format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: activeFilePath, content: getEditorText(), write: false })
  });

  setEditorContent(data.formatted || "", activeFilePath);
  setStatus(`Formatted with parser: ${data.parser}`);
}

async function lintActiveFile() {
  if (!activeFilePath) {
    setStatus("Select or create a file first.");
    return;
  }

  const data = await apiJson("/api/files/lint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: activeFilePath, content: getEditorText() })
  });

  const lines = (data.messages || []).map((item) => `${item.severity.toUpperCase()} L${item.line}:${item.column} ${item.message}${item.ruleId ? ` (${item.ruleId})` : ""}`);
  window.alert(lines.length ? lines.join("\n") : "No lint issues found.");
  setStatus(`Linted ${activeFilePath}: ${data.issueCount} issue(s)`);
}

async function uploadFiles(files) {
  if (!files || files.length === 0) {
    return;
  }

  const form = new FormData();
  form.append("path", currentDir);

  for (const file of files) {
    form.append("files", file);
    const relativePath = normalizeRelativePath(file.webkitRelativePath || file.name);
    form.append("relativePaths", relativePath);
  }

  const response = await fetch("/api/files/upload", { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Upload failed (${response.status})`);
  }

  const count = Array.isArray(data.files) ? data.files.length : (data.path ? 1 : 0);
  setStatus(`Uploaded ${count} file(s).`);
  await loadDirectory(currentDir);
}

async function deleteSelected() {
  if (!activeFilePath) {
    setStatus("Select a file first.");
    return;
  }
  const confirmed = window.confirm(`Delete ${activeFilePath}?`);
  if (!confirmed) {
    return;
  }

  await apiJson(`/api/files/delete?${new URLSearchParams({ path: activeFilePath }).toString()}`, { method: "DELETE" });
  activeFilePath = "";
  originalFileContent = "";
  activePathLabelEl.textContent = "No file selected";
  setEditorContent("", "");
  clearLintDiagnostics();
  setStatus("Deleted.");
  await loadDirectory(currentDir);
}

refreshBtnEl.addEventListener("click", () => {
  loadDirectory(currentDir).catch((error) => setStatus(`Error: ${error.message}`));
});

goDirBtnEl.addEventListener("click", () => {
  loadDirectory(dirPathInputEl.value).catch((error) => setStatus(`Error: ${error.message}`));
});

saveBtnEl.addEventListener("click", () => {
  previewAndSave();
});

formatBtnEl.addEventListener("click", () => {
  formatActiveFile().catch((error) => setStatus(`Error: ${error.message}`));
});

lintBtnEl.addEventListener("click", () => {
  lintActiveFile().catch((error) => setStatus(`Error: ${error.message}`));
});

uploadBtnEl.addEventListener("click", () => {
  fileUploadInputEl.click();
});

uploadFolderBtnEl.addEventListener("click", () => {
  folderUploadInputEl.click();
});

fileUploadInputEl.addEventListener("change", () => {
  const files = Array.from(fileUploadInputEl.files || []);
  if (files.length === 0) return;
  uploadFiles(files)
    .catch((error) => setStatus(`Error: ${error.message}`))
    .finally(() => {
      fileUploadInputEl.value = "";
    });
});

folderUploadInputEl.addEventListener("change", () => {
  const files = Array.from(folderUploadInputEl.files || []);
  if (files.length === 0) return;
  uploadFiles(files)
    .catch((error) => setStatus(`Error: ${error.message}`))
    .finally(() => {
      folderUploadInputEl.value = "";
    });
});

newFileBtnEl.addEventListener("click", async () => {
  const name = window.prompt("New file name (relative to current directory):", "new-file.txt");
  if (!name) return;

  const path = joinPath(currentDir, name);
  try {
    await apiJson("/api/files/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: "" })
    });
    await loadDirectory(currentDir);
    activeFilePath = path;
    originalFileContent = "";
    activePathLabelEl.textContent = path;
    setEditorContent("", path);
    clearLintDiagnostics();
    setStatus(`Created ${path}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

newDirBtnEl.addEventListener("click", async () => {
  const name = window.prompt("New directory name:", "new-folder");
  if (!name) return;
  const path = joinPath(currentDir, name);
  try {
    await apiJson("/api/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });
    await loadDirectory(currentDir);
    setStatus(`Created folder ${path}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

renameBtnEl.addEventListener("click", async () => {
  if (!activeFilePath) {
    setStatus("Select a file first.");
    return;
  }
  const nextName = window.prompt("New name:", activeFilePath.split("/").pop());
  if (!nextName) return;

  try {
    const data = await apiJson("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: activeFilePath, newName: nextName })
    });
    activeFilePath = data.path;
    activePathLabelEl.textContent = activeFilePath;
    await loadDirectory(currentDir);
    setStatus(`Renamed to ${activeFilePath}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

moveBtnEl.addEventListener("click", async () => {
  if (!activeFilePath) {
    setStatus("Select a file first.");
    return;
  }
  const toPath = window.prompt("Move to path:", activeFilePath);
  if (!toPath) return;

  try {
    await apiJson("/api/files/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPath: activeFilePath, toPath })
    });
    activeFilePath = toPath;
    activePathLabelEl.textContent = activeFilePath;
    await loadDirectory(currentDir);
    setStatus(`Moved to ${toPath}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

deleteBtnEl.addEventListener("click", () => {
  deleteSelected().catch((error) => setStatus(`Error: ${error.message}`));
});

downloadBtnEl.addEventListener("click", () => {
  if (!activeFilePath) {
    setStatus("Select a file first.");
    return;
  }
  const query = new URLSearchParams({ path: activeFilePath }).toString();
  window.location.href = `/api/files/download?${query}`;
});

gitLogBtnEl.addEventListener("click", async () => {
  try {
    const data = await apiJson("/api/files/git/log?limit=12");
    const lines = (data.commits || []).map((item) => `${item.shortHash} ${item.date} ${item.subject}`);
    window.alert(lines.length ? lines.join("\n") : "No commits yet.");
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

revertBtnEl.addEventListener("click", async () => {
  const ref = window.prompt("Revert sandbox to git ref (for example HEAD~1 or a commit hash):", "HEAD~1");
  if (!ref) return;
  const confirmed = window.confirm(`This will hard reset sandbox to ${ref}. Continue?`);
  if (!confirmed) return;

  try {
    await apiJson("/api/files/git/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref })
    });

    activeFilePath = "";
    originalFileContent = "";
    activePathLabelEl.textContent = "No file selected";
    setEditorContent("", "");
    clearLintDiagnostics();
    await loadDirectory(currentDir);
    setStatus(`Reverted sandbox to ${ref}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

if (themeToggleEl) {
  themeToggleEl.addEventListener("click", () => {
    const current = getCurrentTheme();
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  });
}

if (syntaxThemeSelectEl) {
  syntaxThemeSelectEl.addEventListener("change", () => {
    applySyntaxTheme(syntaxThemeSelectEl.value);
    setStatus(`Syntax theme: ${syntaxThemePalette[getSyntaxTheme()].label}`);
  });
}

if (fontSizeRangeEl) {
  fontSizeRangeEl.addEventListener("input", () => {
    applyFontSize(Number(fontSizeRangeEl.value));
  });
}

if (minimapToggleEl) {
  minimapToggleEl.addEventListener("click", () => {
    applyMinimapEnabled(!minimapEnabled);
  });
}

if (minimapPaneEl) {
  minimapPaneEl.addEventListener("click", (event) => {
    if (!minimapEnabled) {
      return;
    }
    const scroller = getEditorScroller();
    if (!scroller) {
      return;
    }

    const rect = minimapPaneEl.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const ratio = Math.max(0, Math.min(1, y / Math.max(1, rect.height)));
    const target = (scroller.scrollHeight * ratio) - (scroller.clientHeight / 2);
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight, target));
    updateMinimapViewport();
  });
}

window.addEventListener("resize", () => {
  scheduleMinimapRender();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZoneEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZoneEl.classList.add("active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZoneEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZoneEl.classList.remove("active");
  });
});

dropZoneEl.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length === 0) return;
  uploadFiles(files).catch((error) => setStatus(`Error: ${error.message}`));
});

diffCancelBtnEl.addEventListener("click", hideDiffModal);
diffConfirmBtnEl.addEventListener("click", async () => {
  if (typeof pendingSaveAction === "function") {
    await pendingSaveAction();
  }
});

diffModalEl.addEventListener("click", (event) => {
  if (event.target === diffModalEl) {
    hideDiffModal();
  }
});

try {
  initEditorPreferences();
  initTheme();
  initEditor();
  setEditorContent("", "");
} catch (error) {
  setStatus(`Error: ${error.message || error}`);
}
const launchParams = new URLSearchParams(window.location.search || "");
const launchPath = launchParams.get("path") || "";
const launchLine = launchParams.get("line") || "";
const launchCol = launchParams.get("col") || "";

if (launchPath) {
  openFileByPath(launchPath, launchLine, launchCol).catch((error) => setStatus(`Error: ${error.message}`));
} else {
  loadDirectory("").catch((error) => setStatus(`Error: ${error.message}`));
}
