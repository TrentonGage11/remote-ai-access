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
const genericTextMode = createSimpleWordMode({
  keywords: new Set(),
  hashComments: true,
  slashComments: true,
  blockComments: true
});

const fileListEl = document.getElementById("fileList");
const dirPathInputEl = document.getElementById("dirPathInput");
const fileUploadInputEl = document.getElementById("fileUploadInput");
const folderUploadInputEl = document.getElementById("folderUploadInput");
const uploadBypassCodeInputEl = document.getElementById("uploadBypassCodeInput");
const dropZoneEl = document.getElementById("dropZone");
const activePathLabelEl = document.getElementById("activePathLabel");
const fileStatusEl = document.getElementById("fileStatus");
const editorRootEl = document.getElementById("editorRoot");
const editorLayoutEl = document.getElementById("editorLayout");
const themeToggleEl = document.getElementById("themeToggle");
const workspaceCodeInputEl = document.getElementById("workspaceCodeInput");
const workspaceSwitchBtnEl = document.getElementById("workspaceSwitchBtn");
const workspaceBadgeEl = document.getElementById("workspaceBadge");
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
const duplicateBtnEl = document.getElementById("duplicateBtn");
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
const FILELAB_UPLOAD_BYPASS_CODE_KEY = "filelab-upload-bypass-code";
const FILELAB_CHUNK_SESSIONS_KEY = "filelab-chunk-sessions-v1";
const languageCompartment = new Compartment();
const editorThemeCompartment = new Compartment();
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;

let currentDir = "";
let activeFilePath = "";
let selectedPath = "";
let selectedPathType = "";
let originalFileContent = "";
let view;
let pendingSaveAction = null;
let editorInitError = null;
let currentSyntaxTheme = "verdant";
let currentFontSize = 14;
let minimapEnabled = true;
let currentWorkspaceCode = "";
let lastLintMessages = [];
let uploadPolicy = {
  defaultMaxBytes: DEFAULT_MAX_UPLOAD_BYTES,
  bypassConfiguredForWorkspace: false,
  chunked: {
    enabled: true,
    thresholdBytes: 64 * 1024 * 1024,
    chunkSizeBytes: 4 * 1024 * 1024
  }
};
let uploadInFlight = false;
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
      ? { bg: "#131111", line: "rgba(255, 176, 127, 0.7)", viewport: "rgba(255, 176, 127, 0.35)", error: "#ff6b6b", cursor: "#ffe082", symbol: "#ffd3a6" }
      : { bg: "#fff7f1", line: "rgba(143, 58, 8, 0.58)", viewport: "rgba(143, 58, 8, 0.2)", error: "#b53030", cursor: "#9a6900", symbol: "#7a4414" };
  }
  if (currentSyntaxTheme === "oceanic") {
    return isDark
      ? { bg: "#10171c", line: "rgba(135, 220, 255, 0.7)", viewport: "rgba(135, 220, 255, 0.35)", error: "#ff5d78", cursor: "#ffe082", symbol: "#7ee7ff" }
      : { bg: "#f1f8ff", line: "rgba(4, 91, 143, 0.52)", viewport: "rgba(4, 91, 143, 0.18)", error: "#c91f42", cursor: "#a46a00", symbol: "#006a8f" };
  }
  if (currentSyntaxTheme === "mono") {
    return isDark
      ? { bg: "#11161b", line: "rgba(220, 232, 242, 0.58)", viewport: "rgba(220, 232, 242, 0.24)", error: "#ff6b6b", cursor: "#f6df7a", symbol: "#cdd9e4" }
      : { bg: "#f7fbff", line: "rgba(31, 42, 53, 0.46)", viewport: "rgba(31, 42, 53, 0.2)", error: "#9f1d1d", cursor: "#8a6400", symbol: "#1f2a35" };
  }
  if (currentSyntaxTheme === "preparing") {
    return isDark
      ? { bg: "#16111d", line: "rgba(255, 184, 107, 0.72)", viewport: "rgba(255, 184, 107, 0.32)", error: "#ff5a79", cursor: "#fff07a", symbol: "#cda7ff" }
      : { bg: "#fff7ef", line: "rgba(196, 90, 22, 0.54)", viewport: "rgba(196, 90, 22, 0.18)", error: "#b70d2b", cursor: "#9a6900", symbol: "#7a3aa6" };
  }
  if (currentSyntaxTheme === "cyberpunk-hc") {
    return isDark
      ? { bg: "#0b0614", line: "rgba(255, 122, 0, 0.78)", viewport: "rgba(209, 0, 255, 0.34)", error: "#ff2f57", cursor: "#fff200", symbol: "#28a7ff" }
      : { bg: "#fff4ff", line: "rgba(217, 74, 0, 0.6)", viewport: "rgba(143, 0, 201, 0.24)", error: "#c21f42", cursor: "#946f00", symbol: "#4734de" };
  }
  return isDark
    ? { bg: "#0f1714", line: "rgba(125, 228, 176, 0.72)", viewport: "rgba(125, 228, 176, 0.3)", error: "#ff5d78", cursor: "#f7e27c", symbol: "#9fcdf7" }
    : { bg: "#f1f8f5", line: "rgba(11, 107, 66, 0.54)", viewport: "rgba(11, 107, 66, 0.18)", error: "#b70d2b", cursor: "#936600", symbol: "#134f8b" };
}

function hashLine(line) {
  let hash = 0;
  for (let i = 0; i < line.length; i += 1) {
    hash = ((hash << 5) - hash) + line.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function isSymbolLine(text) {
  const trimmed = String(text || "").trim();
  return /^(export\s+)?(async\s+)?(function|class|interface|type|enum|struct|namespace)\s+[A-Za-z_$][\w$-]*/.test(trimmed)
    || /^(def|class)\s+[A-Za-z_]\w*/.test(trimmed)
    || /^[A-Za-z_$][\w$]*\s*[:=]\s*(async\s*)?\([^)]*\)\s*=>/.test(trimmed)
    || /^#{1,6}\s+\S+/.test(trimmed);
}

function drawMinimapMarker(ctx, lineNumber, lineStep, width, color, offset = 0, markerHeight = 2) {
  if (!lineNumber || lineNumber < 1) {
    return;
  }
  const y = Math.max(0, (lineNumber - 1) * lineStep);
  ctx.fillStyle = color;
  ctx.fillRect(offset, y, Math.max(4, width - offset), Math.max(markerHeight, lineStep * 1.1));
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
  const scrollHeight = Math.max(1, scroller.scrollHeight);
  const ratio = paneHeight / scrollHeight;
  const viewportHeight = Math.min(paneHeight, Math.max(18, scroller.clientHeight * ratio));
  const maxTop = Math.max(0, paneHeight - viewportHeight);
  const top = Math.min(maxTop, Math.max(0, scroller.scrollTop * ratio));

  minimapViewportEl.style.top = `${top}px`;
  minimapViewportEl.style.height = `${viewportHeight}px`;
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
  const scroller = getEditorScroller();
  const computedLineHeight = Number.parseFloat(window.getComputedStyle(view.contentDOM).lineHeight);
  const fallbackLineHeight = Math.max(1, currentFontSize * 1.4);
  const lineHeightPx = Number.isFinite(computedLineHeight) && computedLineHeight > 0
    ? computedLineHeight
    : fallbackLineHeight;
  const visualLineCount = scroller
    ? Math.max(lines.length, Math.ceil(scroller.scrollHeight / lineHeightPx))
    : lines.length;
  const lineCount = Math.max(1, visualLineCount);
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

  for (let i = 0; i < lines.length; i += 1) {
    if (isSymbolLine(lines[i])) {
      drawMinimapMarker(ctx, i + 1, lineStep, width, colors.symbol, 0, 2);
    }
  }

  for (const item of lastLintMessages) {
    drawMinimapMarker(ctx, Number(item?.line || 0), lineStep, width, colors.error, 0, 3);
  }

  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  drawMinimapMarker(ctx, cursorLine, lineStep, width, colors.cursor, 0, 2);

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

function getStoredApiAuthHeader() {
  try {
    const authApi = window.RemoteAiAuth;
    if (!authApi || typeof authApi.getApiKey !== "function") {
      return null;
    }
    const key = String(authApi.getApiKey() || "").trim();
    if (!key) {
      return null;
    }
    const headerName = typeof authApi.getApiKeyHeaderName === "function"
      ? String(authApi.getApiKeyHeaderName() || "x-api-key").trim() || "x-api-key"
      : "x-api-key";
    return { headerName, key };
  } catch {
    return null;
  }
}

function normalizeUploadBypassCode(value) {
  let normalized = String(value || "");
  try {
    normalized = normalized.normalize("NFKC");
  } catch {
    // String normalization is optional; continue with raw value if unsupported.
  }

  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (normalized.length >= 2 && normalized.startsWith("`") && normalized.endsWith("`")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\s+/g, "");
}

function normalizeWorkspaceCode(value) {
  const code = String(value || "").trim().toLowerCase();
  if (!code) {
    return "";
  }
  return /^[a-z0-9][a-z0-9_-]{1,47}$/.test(code) ? code : "";
}

async function loadWorkspaceInfo() {
  if (!workspaceBadgeEl) {
    return;
  }
  try {
    const data = await apiJson("/api/session/workspace");
    const code = normalizeWorkspaceCode(data?.workspaceCode) || "default";
    currentWorkspaceCode = code;
    workspaceBadgeEl.textContent = `Workspace: ${code}`;
    if (workspaceCodeInputEl && !workspaceCodeInputEl.value) {
      workspaceCodeInputEl.value = code;
    }
  } catch {
    currentWorkspaceCode = "";
    workspaceBadgeEl.textContent = "Workspace: unknown";
  }
}

async function loadUploadPolicy() {
  try {
    const data = await apiJson("/api/tools");
    const maxBytes = Number(data?.uploadPolicy?.defaultMaxBytes);
    const thresholdBytes = Number(data?.uploadPolicy?.chunked?.thresholdBytes);
    const chunkSizeBytes = Number(data?.uploadPolicy?.chunked?.chunkSizeBytes);
    uploadPolicy = {
      defaultMaxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_UPLOAD_BYTES,
      bypassConfiguredForWorkspace: Boolean(data?.uploadPolicy?.bypassConfiguredForWorkspace),
      chunked: {
        enabled: data?.uploadPolicy?.chunked?.enabled !== false,
        thresholdBytes: Number.isFinite(thresholdBytes) && thresholdBytes > 0 ? thresholdBytes : 64 * 1024 * 1024,
        chunkSizeBytes: Number.isFinite(chunkSizeBytes) && chunkSizeBytes > 0 ? chunkSizeBytes : 4 * 1024 * 1024
      }
    };
  } catch {
    uploadPolicy = {
      defaultMaxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      bypassConfiguredForWorkspace: false,
      chunked: {
        enabled: true,
        thresholdBytes: 64 * 1024 * 1024,
        chunkSizeBytes: 4 * 1024 * 1024
      }
    };
  }
}

async function switchWorkspace() {
  if (!workspaceCodeInputEl || !workspaceSwitchBtnEl) {
    return;
  }

  const code = normalizeWorkspaceCode(workspaceCodeInputEl.value);
  if (!code) {
    setStatus("Workspace code must use letters, numbers, _ or -.");
    return;
  }
  if (!confirmDiscardUnsavedChanges("switch workspaces")) {
    return;
  }

  workspaceSwitchBtnEl.disabled = true;
  try {
    await apiJson("/api/session/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: code })
    });
    const url = new URL(window.location.href);
    url.searchParams.set("access_code", code);
    window.location.href = url.toString();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    workspaceSwitchBtnEl.disabled = false;
  }
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
  return StreamLanguage.define(genericTextMode);
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
        if (update.docChanged) {
          lastLintMessages = [];
        }
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
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
  lastLintMessages = [];
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
    effects: languageCompartment.reconfigure(ext)
  });
  scheduleMinimapRender();
}

function getEditorText() {
  return requireEditorView().state.doc.toString();
}

function hasUnsavedEditorChanges() {
  return Boolean(activeFilePath) && getEditorText() !== originalFileContent;
}

function confirmDiscardUnsavedChanges(actionLabel = "continue") {
  if (!hasUnsavedEditorChanges()) {
    return true;
  }
  return window.confirm(`You have unsaved changes in ${activeFilePath}. Discard them and ${actionLabel}?`);
}

function clearLintDiagnostics() {
  lastLintMessages = [];
  scheduleMinimapRender();
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
    if (response.status === 401 || response.status === 403) {
      const base = data.error || "Access denied.";
      throw new Error(`${base} Set your API key in Security Admin, then retry.`);
    }
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function parseDownloadFilename(contentDisposition, fallbackPath) {
  const fallbackName = String(fallbackPath || "download").split(/[\\/]/).pop() || "download";
  const header = String(contentDisposition || "");

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const basicMatch = header.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1];
  }

  return fallbackName;
}

async function downloadActiveFile(path) {
  const query = new URLSearchParams({ path }).toString();
  const headers = {};
  const apiAuth = getStoredApiAuthHeader();
  if (apiAuth) {
    headers[apiAuth.headerName] = apiAuth.key;
  }

  const response = await fetch(`/api/files/download?${query}`, {
    method: "GET",
    headers
  });

  if (!response.ok) {
    const maybeJson = await response.json().catch(() => null);
    const message = maybeJson?.error || `Download failed (${response.status})`;
    throw new Error(message);
  }

  const blob = await response.blob();
  const name = parseDownloadFilename(response.headers.get("content-disposition"), path);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
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

function formatByteSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function openPickerForInput(inputEl) {
  if (!inputEl) {
    return;
  }
  if (typeof inputEl.showPicker === "function") {
    try {
      inputEl.showPicker();
      return;
    } catch {
      // Fallback to click if showPicker is unsupported by the browser runtime.
    }
  }
  inputEl.click();
}

function getUploadBypassCode() {
  return normalizeUploadBypassCode(uploadBypassCodeInputEl?.value || "");
}

function formatUploadProgress(loaded, total) {
  const safeLoaded = Math.max(0, Number(loaded || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  if (!safeTotal) {
    return `sent ${formatByteSize(safeLoaded)}`;
  }
  const percent = Math.max(0, Math.min(100, Math.round((safeLoaded / safeTotal) * 100)));
  return `${percent}% (${formatByteSize(safeLoaded)} / ${formatByteSize(safeTotal)})`;
}

function uploadWithProgress(uploadUrl, requestHeaders, form, onProgress, onUploadSent) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl, true);
    xhr.responseType = "text";
    xhr.timeout = 10 * 60 * 1000;
    for (const [key, value] of Object.entries(requestHeaders || {})) {
      xhr.setRequestHeader(key, String(value));
    }

    xhr.upload.addEventListener("progress", (event) => {
      onProgress?.(event.loaded, event.total, event.lengthComputable);
    });
    xhr.upload.addEventListener("load", () => {
      onUploadSent?.();
    });

    xhr.addEventListener("error", () => reject(new Error("Network error while uploading.")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.addEventListener("load", () => {
      const raw = String(xhr.responseText || "");
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ status: xhr.status, data, raw });
        return;
      }

      const trimmed = raw.replace(/\s+/g, " ").trim();
      const fallback = trimmed ? trimmed.slice(0, 160) : `Upload failed (${xhr.status})`;
      reject(new Error(data.error || fallback));
    });

    xhr.send(form);
  });
}

function getSavedChunkSessions() {
  try {
    const raw = localStorage.getItem(FILELAB_CHUNK_SESSIONS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setSavedChunkSessions(value) {
  try {
    localStorage.setItem(FILELAB_CHUNK_SESSIONS_KEY, JSON.stringify(value || {}));
  } catch {
    // Ignore localStorage quota/access issues.
  }
}

function makeChunkResumeKey(file, relativePath) {
  return [
    currentWorkspaceCode || "default",
    String(currentDir || ""),
    String(relativePath || file?.name || ""),
    Number(file?.size || 0),
    Number(file?.lastModified || 0)
  ].join("|");
}

async function uploadFilesChunked(files, bypassCode, totalBytes) {
  const requestHeaders = {};
  if (bypassCode) {
    requestHeaders["X-Upload-Bypass-Code"] = bypassCode;
  }
  const apiAuth = getStoredApiAuthHeader();
  if (apiAuth) {
    requestHeaders[apiAuth.headerName] = apiAuth.key;
  }

  let uploadedOverall = 0;
  const saved = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const relativePath = normalizeRelativePath(file.webkitRelativePath || file.name);
    const resumeKey = makeChunkResumeKey(file, relativePath);
    const sessions = getSavedChunkSessions();
    const resumeUploadId = String(sessions?.[resumeKey]?.uploadId || "");

    let uploadId = "";
    let chunkSize = Math.max(256 * 1024, Number(uploadPolicy?.chunked?.chunkSizeBytes || (4 * 1024 * 1024)));
    let expectedChunks = Math.max(1, Math.ceil(Number(file.size || 0) / chunkSize));
    let startChunkIndex = 0;

    if (resumeUploadId) {
      try {
        const statusUrl = bypassCode
          ? `/api/files/upload/chunk/${encodeURIComponent(resumeUploadId)}?upload_code=${encodeURIComponent(bypassCode)}`
          : `/api/files/upload/chunk/${encodeURIComponent(resumeUploadId)}`;
        const status = await apiJson(statusUrl);
        if (Number(status.expectedSize || 0) === Number(file.size || 0)) {
          uploadId = resumeUploadId;
          expectedChunks = Math.max(1, Number(status.totalChunks || expectedChunks));
          startChunkIndex = Math.max(0, Number(status.nextChunkIndex || 0));
          setStatus(`Resuming upload: file ${fileIndex + 1}/${files.length} from chunk ${startChunkIndex + 1}/${expectedChunks}...`);
        }
      } catch {
        // Session missing/expired; start a new one.
      }
    }

    if (!uploadId) {
    const startPayload = {
      path: currentDir,
      name: file.name,
      relativePath,
      size: Number(file.size || 0),
      mimeType: String(file.type || "application/octet-stream")
    };

    const startUrl = bypassCode
      ? `/api/files/upload/chunk/start?upload_code=${encodeURIComponent(bypassCode)}`
      : "/api/files/upload/chunk/start";

      const started = await apiJson(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...requestHeaders },
      body: JSON.stringify(startPayload)
    });

      uploadId = String(started.uploadId || "");
      chunkSize = Math.max(256 * 1024, Number(started.chunkSizeBytes || uploadPolicy?.chunked?.chunkSizeBytes || (4 * 1024 * 1024)));
      expectedChunks = Math.max(1, Number(started.totalChunks || Math.ceil(file.size / chunkSize)));
      startChunkIndex = 0;
    }

    const updatedSessions = getSavedChunkSessions();
    updatedSessions[resumeKey] = { uploadId, updatedAt: Date.now() };
    setSavedChunkSessions(updatedSessions);

    for (let chunkIndex = startChunkIndex; chunkIndex < expectedChunks; chunkIndex += 1) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunk = file.slice(start, end);

      const chunkUrlBase = `/api/files/upload/chunk/${encodeURIComponent(uploadId)}?index=${chunkIndex}`;
      const chunkUrl = bypassCode
        ? `${chunkUrlBase}&upload_code=${encodeURIComponent(bypassCode)}`
        : chunkUrlBase;

      await fetch(chunkUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", ...requestHeaders },
        body: chunk
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Chunk upload failed (${response.status})`);
        }
      });

      const fileProgress = end;
      const currentOverall = uploadedOverall + fileProgress;
      setStatus(`Uploading ${files.length} file(s)... ${formatUploadProgress(currentOverall, totalBytes)} [file ${fileIndex + 1}/${files.length}, chunk ${chunkIndex + 1}/${expectedChunks}]`);
    }

    const completeUrl = bypassCode
      ? `/api/files/upload/chunk/${encodeURIComponent(uploadId)}/complete?upload_code=${encodeURIComponent(bypassCode)}`
      : `/api/files/upload/chunk/${encodeURIComponent(uploadId)}/complete`;

    const completed = await apiJson(completeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...requestHeaders },
      body: JSON.stringify({})
    });

    saved.push({ path: completed.path, size: completed.size });
    uploadedOverall += Number(file.size || 0);
    const doneSessions = getSavedChunkSessions();
    delete doneSessions[resumeKey];
    setSavedChunkSessions(doneSessions);
  }

  return {
    files: saved,
    count: saved.length,
    workspaceCode: currentWorkspaceCode || undefined
  };
}

async function loadDirectory(pathValue = currentDir) {
  if (String(pathValue || "").trim() !== currentDir && !confirmDiscardUnsavedChanges("change folders")) {
    return;
  }
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

function markSelectedFileItem(button) {
  for (const selected of fileListEl.querySelectorAll(".file-item.selected")) {
    selected.classList.remove("selected");
  }
  button?.classList.add("selected");
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
    btn.className = [
      "file-item",
      entry.type,
      entry.hidden ? "hidden-entry" : "",
      entry.executable ? "executable" : ""
    ].filter(Boolean).join(" ");
    btn.textContent = `${entry.type === "directory" ? "[D]" : "[F]"} ${entry.name}`;
    btn.title = `${entry.name} (${entry.size} bytes)`;

    btn.addEventListener("click", async () => {
      const targetPath = joinPath(currentDir, entry.name);
      if (entry.type === "directory") {
        selectedPath = targetPath;
        selectedPathType = "directory";
        activePathLabelEl.textContent = `Folder selected: ${targetPath}`;
        setStatus(`Selected folder ${targetPath}. Double-click to open.`);
        markSelectedFileItem(btn);
        return;
      }

      try {
        if (activeFilePath !== targetPath && !confirmDiscardUnsavedChanges("open another file")) {
          return;
        }
        const fileData = await apiJson(`/api/files/read?${new URLSearchParams({ path: targetPath }).toString()}`);
        activeFilePath = fileData.path;
        selectedPath = activeFilePath;
        selectedPathType = "file";
        markSelectedFileItem(btn);
        originalFileContent = fileData.content || "";
        activePathLabelEl.textContent = activeFilePath;
        setEditorContent(fileData.content || "", activeFilePath);
        clearLintDiagnostics();
        setStatus(`Loaded ${activeFilePath}`);
      } catch (error) {
        setStatus(`Error: ${error.message}`);
      }
    });
    btn.addEventListener("dblclick", () => {
      if (entry.type !== "directory") {
        return;
      }
      const targetPath = joinPath(currentDir, entry.name);
      loadDirectory(targetPath)
        .then(() => setStatus(`Opened folder: ${targetPath}`))
        .catch((error) => setStatus(`Error: ${error.message}`));
    });
    if (selectedPath === joinPath(currentDir, entry.name)) {
      btn.classList.add("selected");
    }

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
  if (activeFilePath !== cleanPath && !confirmDiscardUnsavedChanges("open another file")) {
    return;
  }

  const fileData = await apiJson(`/api/files/read?${new URLSearchParams({ path: cleanPath }).toString()}`);
  activeFilePath = fileData.path;
  selectedPath = activeFilePath;
  selectedPathType = "file";
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
  lastLintMessages = [];
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

  lastLintMessages = Array.isArray(data.messages) ? data.messages : [];
  scheduleMinimapRender();
  const lines = lastLintMessages.map((item) => `${item.severity.toUpperCase()} L${item.line}:${item.column} ${item.message}${item.ruleId ? ` (${item.ruleId})` : ""}`);
  window.alert(lines.length ? lines.join("\n") : "No lint issues found.");
  setStatus(`Linted ${activeFilePath}: ${data.issueCount} issue(s)`);
}

async function uploadFiles(files) {
  if (!files || files.length === 0) {
    return;
  }

  if (uploadInFlight) {
    setStatus("Upload already in progress. Please wait.");
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + Number(file?.size || 0), 0);
  setStatus(`Preparing upload: ${files.length} file(s), ${formatByteSize(totalBytes)}.`);

  const bypassCode = getUploadBypassCode();
  const maxUploadBytes = Number(uploadPolicy?.defaultMaxBytes || DEFAULT_MAX_UPLOAD_BYTES);
  const tooLarge = files.filter((file) => Number(file?.size || 0) > maxUploadBytes);
  if (!bypassCode && tooLarge.length > 0) {
    const first = tooLarge[0];
    const bypassHint = uploadPolicy?.bypassConfiguredForWorkspace
      ? " Enter your upload unlock code, then try again."
      : "";
    throw new Error(`File too large: ${first.name} (${formatByteSize(first.size)}). Max is ${formatByteSize(maxUploadBytes)}.${bypassHint}`);
  }

  const form = new FormData();
  form.append("path", currentDir);

  for (const file of files) {
    form.append("files", file);
    const relativePath = normalizeRelativePath(file.webkitRelativePath || file.name);
    form.append("relativePaths", relativePath);
  }

  const requestHeaders = {};
  if (bypassCode) {
    requestHeaders["X-Upload-Bypass-Code"] = bypassCode;
  }
  const apiAuth = getStoredApiAuthHeader();
  if (apiAuth) {
    requestHeaders[apiAuth.headerName] = apiAuth.key;
  }

  const uploadUrl = bypassCode
    ? `/api/files/upload?upload_code=${encodeURIComponent(bypassCode)}`
    : "/api/files/upload";

  uploadInFlight = true;
  let lastLoaded = 0;
  let lastTotal = totalBytes;
  let lastProgressAt = Date.now();
  let waitingOnServer = false;
  let heartbeatTicks = 0;
  const heartbeat = window.setInterval(() => {
    heartbeatTicks += 1;
    const elapsed = Math.round((Date.now() - lastProgressAt) / 1000);
    if (waitingOnServer) {
      const dotCount = (heartbeatTicks % 3) + 1;
      setStatus(`Upload sent. Waiting on server${".".repeat(dotCount)} (${elapsed}s)`);
      return;
    }
    if (elapsed >= 3) {
      setStatus(`Uploading ${files.length} file(s)... ${formatUploadProgress(lastLoaded, lastTotal)} (${elapsed}s without new progress)`);
    }
  }, 1000);

  let data;
  try {
    const shouldUseChunked = Boolean(uploadPolicy?.chunked?.enabled)
      && files.some((file) => Number(file?.size || 0) >= Number(uploadPolicy?.chunked?.thresholdBytes || (64 * 1024 * 1024)));

    if (shouldUseChunked) {
      setStatus(`Uploading ${files.length} file(s)... 0% [chunked mode]`);
      data = await uploadFilesChunked(files, bypassCode, totalBytes);
      setStatus("Chunked upload complete. Finalizing file list...");
    } else {
      setStatus(`Uploading ${files.length} file(s)... 0%`);
      const result = await uploadWithProgress(
        uploadUrl,
        requestHeaders,
        form,
        (loaded, total, lengthComputable) => {
          lastLoaded = Math.max(0, Number(loaded || 0));
          lastTotal = lengthComputable ? Math.max(0, Number(total || 0)) : totalBytes;
          lastProgressAt = Date.now();
          setStatus(`Uploading ${files.length} file(s)... ${formatUploadProgress(lastLoaded, lastTotal)}`);
        },
        () => {
          waitingOnServer = true;
          lastProgressAt = Date.now();
          setStatus("Upload sent. Waiting on server... (0s)");
        }
      );
      data = result.data;
      setStatus("Upload complete. Finalizing file list...");
    }
  } finally {
    window.clearInterval(heartbeat);
    uploadInFlight = false;
  }

  const count = Array.isArray(data.files) ? data.files.length : (data.path ? 1 : 0);
  const responseWorkspace = normalizeWorkspaceCode(data?.workspaceCode);
  if (responseWorkspace && currentWorkspaceCode && responseWorkspace !== currentWorkspaceCode) {
    setStatus(`Error: upload landed in workspace '${responseWorkspace}' while UI is '${currentWorkspaceCode}'.`);
    return;
  }
  setStatus(`Uploaded ${count} file(s).`);
  await loadDirectory(currentDir);
}

async function deleteSelected() {
  if (!selectedPath) {
    setStatus("Select a file or folder first.");
    return;
  }
  const label = selectedPathType === "directory" ? "folder" : "file";
  const confirmed = window.confirm(`Delete ${label} ${selectedPath}?`);
  if (!confirmed) {
    return;
  }

  await apiJson(`/api/files/delete?${new URLSearchParams({ path: selectedPath }).toString()}`, { method: "DELETE" });
  if (activeFilePath === selectedPath || activeFilePath.startsWith(`${selectedPath}/`)) {
    activeFilePath = "";
    originalFileContent = "";
    activePathLabelEl.textContent = "No file selected";
    setEditorContent("", "");
    clearLintDiagnostics();
  }
  selectedPath = "";
  selectedPathType = "";
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
  setStatus("Opening file picker...");
  openPickerForInput(fileUploadInputEl);
});

uploadFolderBtnEl.addEventListener("click", () => {
  const supportsFolder = "webkitdirectory" in folderUploadInputEl || "directory" in folderUploadInputEl;
  if (!supportsFolder) {
    setStatus("Folder upload is not supported on this browser. Use Upload Files instead.");
    openPickerForInput(fileUploadInputEl);
    return;
  }
  setStatus("Opening folder picker...");
  openPickerForInput(folderUploadInputEl);
});

if (uploadBypassCodeInputEl) {
  const savedCode = localStorage.getItem(FILELAB_UPLOAD_BYPASS_CODE_KEY);
  if (savedCode) {
    uploadBypassCodeInputEl.value = normalizeUploadBypassCode(savedCode);
  }
  uploadBypassCodeInputEl.addEventListener("change", () => {
    const value = getUploadBypassCode();
    uploadBypassCodeInputEl.value = value;
    if (value) {
      localStorage.setItem(FILELAB_UPLOAD_BYPASS_CODE_KEY, value);
    } else {
      localStorage.removeItem(FILELAB_UPLOAD_BYPASS_CODE_KEY);
    }
  });
}

fileUploadInputEl.addEventListener("change", () => {
  const files = Array.from(fileUploadInputEl.files || []);
  if (files.length === 0) {
    setStatus("No files selected.");
    return;
  }
  uploadFiles(files)
    .catch((error) => setStatus(`Error: ${error.message}`))
    .finally(() => {
      fileUploadInputEl.value = "";
    });
});

folderUploadInputEl.addEventListener("change", () => {
  const files = Array.from(folderUploadInputEl.files || []);
  if (files.length === 0) {
    setStatus("No folder selected.");
    return;
  }
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
    activeFilePath = path;
    selectedPath = path;
    selectedPathType = "file";
    await loadDirectory(currentDir);
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
    selectedPath = path;
    selectedPathType = "directory";
    await loadDirectory(currentDir);
    setStatus(`Created folder ${path}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

duplicateBtnEl.addEventListener("click", async () => {
  if (!selectedPath) {
    setStatus("Select a file or folder first.");
    return;
  }
  const baseName = selectedPath.split("/").pop() || "copy";
  const parent = parentDir(selectedPath);
  const dotIndex = baseName.lastIndexOf(".");
  const copyName = dotIndex > 0
    ? `${baseName.slice(0, dotIndex)} copy${baseName.slice(dotIndex)}`
    : `${baseName} copy`;
  const defaultPath = joinPath(parent, copyName);
  const toPath = window.prompt("Duplicate to path:", defaultPath);
  if (!toPath) return;

  try {
    const data = await apiJson("/api/files/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPath: selectedPath, toPath })
    });
    selectedPath = data.toPath;
    selectedPathType = data.type || selectedPathType;
    await loadDirectory(currentDir);
    setStatus(`Duplicated to ${selectedPath}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

renameBtnEl.addEventListener("click", async () => {
  if (!selectedPath) {
    setStatus("Select a file or folder first.");
    return;
  }
  const nextName = window.prompt("New name:", selectedPath.split("/").pop());
  if (!nextName) return;

  try {
    const data = await apiJson("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedPath, newName: nextName })
    });
    const oldPath = selectedPath;
    selectedPath = data.path;
    if (activeFilePath === oldPath || activeFilePath.startsWith(`${oldPath}/`)) {
      activeFilePath = activeFilePath === oldPath
        ? data.path
        : `${data.path}/${activeFilePath.slice(oldPath.length + 1)}`;
    }
    activePathLabelEl.textContent = selectedPathType === "directory" ? `Folder selected: ${selectedPath}` : activeFilePath;
    await loadDirectory(currentDir);
    setStatus(`Renamed to ${selectedPath}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

moveBtnEl.addEventListener("click", async () => {
  if (!selectedPath) {
    setStatus("Select a file or folder first.");
    return;
  }
  const toPath = window.prompt("Move to path:", selectedPath);
  if (!toPath) return;

  try {
    await apiJson("/api/files/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPath: selectedPath, toPath })
    });
    const oldPath = selectedPath;
    selectedPath = normalizeRelativePath(toPath);
    if (activeFilePath === oldPath || activeFilePath.startsWith(`${oldPath}/`)) {
      activeFilePath = activeFilePath === oldPath
        ? selectedPath
        : `${selectedPath}/${activeFilePath.slice(oldPath.length + 1)}`;
    }
    activePathLabelEl.textContent = selectedPathType === "directory" ? `Folder selected: ${selectedPath}` : activeFilePath;
    await loadDirectory(currentDir);
    setStatus(`Moved to ${selectedPath}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

deleteBtnEl.addEventListener("click", () => {
  deleteSelected().catch((error) => setStatus(`Error: ${error.message}`));
});

downloadBtnEl.addEventListener("click", async () => {
  if (!selectedPath) {
    setStatus("Select a file or folder first.");
    return;
  }
  try {
    await downloadActiveFile(selectedPath);
    setStatus(`Downloaded ${selectedPath}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
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

if (workspaceSwitchBtnEl) {
  workspaceSwitchBtnEl.addEventListener("click", () => {
    switchWorkspace();
  });
}

if (workspaceCodeInputEl) {
  workspaceCodeInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      switchWorkspace();
    }
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

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedEditorChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
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

loadWorkspaceInfo().catch(() => {});
loadUploadPolicy().catch(() => {});
