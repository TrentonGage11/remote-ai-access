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
const downloadProgressEl = document.getElementById("downloadProgress");
const downloadProgressLabelEl = document.getElementById("downloadProgressLabel");
const downloadProgressBarEl = document.getElementById("downloadProgressBar");
const editorRootEl = document.getElementById("editorRoot");
const editorLayoutEl = document.getElementById("editorLayout");
const themeToggleEl = document.getElementById("themeToggle");
const workspaceCodeInputEl = document.getElementById("workspaceCodeInput");
const workspaceSwitchBtnEl = document.getElementById("workspaceSwitchBtn");
const workspaceBadgeEl = document.getElementById("workspaceBadge");
const gitMetaLabelEl = document.getElementById("gitMetaLabel");
const gitRemoteUrlInputEl = document.getElementById("gitRemoteUrlInput");
const gitCloneCommandInputEl = document.getElementById("gitCloneCommandInput");
const gitPullCommandInputEl = document.getElementById("gitPullCommandInput");
const gitPushCommandInputEl = document.getElementById("gitPushCommandInput");
const copyGitRemoteBtnEl = document.getElementById("copyGitRemoteBtn");
const gitPullBtnEl = document.getElementById("gitPullBtn");
const gitPushBtnEl = document.getElementById("gitPushBtn");
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
const previewRootEl = document.getElementById("previewRoot");
const previewEmptyEl = document.getElementById("previewEmpty");
const previewMarkdownEl = document.getElementById("previewMarkdown");
const previewHtmlFrameEl = document.getElementById("previewHtmlFrame");
const previewImageEl = document.getElementById("previewImage");
const previewVideoEl = document.getElementById("previewVideo");
const previewAudioEl = document.getElementById("previewAudio");
const previewTypeChipEl = document.getElementById("previewTypeChip");
const previewMetaLabelEl = document.getElementById("previewMetaLabel");
const previewToggleBtnEl = document.getElementById("previewToggleBtn");
const refreshPreviewBtnEl = document.getElementById("refreshPreviewBtn");
const openPreviewNewTabBtnEl = document.getElementById("openPreviewNewTabBtn");

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
const copyDirectLinkBtnEl = document.getElementById("copyDirectLinkBtn");
const shareFileBtnEl = document.getElementById("shareFileBtn");
const sharePanelEl = document.getElementById("sharePanel");
const shareSelectionLabelEl = document.getElementById("shareSelectionLabel");
const shareExpirySelectEl = document.getElementById("shareExpirySelect");
const sharePasswordInputEl = document.getElementById("sharePasswordInput");
const shareEncryptInputEl = document.getElementById("shareEncryptInput");
const createShareBtnEl = document.getElementById("createShareBtn");
const refreshSharesBtnEl = document.getElementById("refreshSharesBtn");
const shareResultEl = document.getElementById("shareResult");
const shareViewUrlInputEl = document.getElementById("shareViewUrlInput");
const shareDirectUrlInputEl = document.getElementById("shareDirectUrlInput");
const copyShareViewBtnEl = document.getElementById("copyShareViewBtn");
const copyShareDirectBtnEl = document.getElementById("copyShareDirectBtn");
const shareListEl = document.getElementById("shareList");
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
const MARKDOWN_EXTENSIONS = new Set([
  "md", "markdown", "mdown", "mkd", "mkdn", "mdtxt", "rmd", "qmd", "txt"
]);
const HTML_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "shtml"
]);
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "gif", "webp", "bmp",
  "dib", "svg", "svgz", "ico", "cur", "apng", "avif", "tif", "tiff", "heic", "heif"
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "webm", "ogv", "mov", "mkv", "avi", "wmv", "flv", "f4v",
  "mpeg", "mpg", "mpe", "3gp", "3g2", "mts", "m2ts", "ts"
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "wave", "ogg", "oga", "opus", "m4a", "aac", "flac", "wma"
]);

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
let currentWorkspaceBranch = "main";
let currentWorkspaceGit = {
  remoteName: "origin",
  remoteHttpsUrl: "",
  remoteSshUrl: "",
  remotePath: ""
};
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
let previewObjectUrl = "";
let previewKind = "none";
let previewPath = "";

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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getPathExtension(pathValue) {
  const name = String(pathValue || "").split("/").pop() || "";
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) {
    return "";
  }
  return name.slice(idx + 1).toLowerCase();
}

function detectPreviewKind(pathValue) {
  const ext = getPathExtension(pathValue);
  if (!ext) {
    return "none";
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (HTML_EXTENSIONS.has(ext)) {
    return "html";
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return "audio";
  }
  return "none";
}

function revokePreviewObjectUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }
}

function setPreviewMeta(pathValue, kind, note = "") {
  if (previewTypeChipEl) {
    const label = kind === "none" ? "No preview" : kind.toUpperCase();
    previewTypeChipEl.textContent = label;
  }
  if (previewMetaLabelEl) {
    if (note) {
      previewMetaLabelEl.textContent = note;
    } else if (pathValue) {
      previewMetaLabelEl.textContent = `Previewing ${pathValue}`;
    } else {
      previewMetaLabelEl.textContent = "Select a file to preview markdown, html, images, video, or audio.";
    }
  }
}

function setPreviewVisibility(kind) {
  if (!previewRootEl) {
    return;
  }
  previewKind = kind;
  if (previewEmptyEl) previewEmptyEl.hidden = kind !== "none";
  if (previewMarkdownEl) previewMarkdownEl.hidden = kind !== "markdown";
  if (previewHtmlFrameEl) previewHtmlFrameEl.hidden = kind !== "html";
  if (previewImageEl) previewImageEl.hidden = kind !== "image";
  if (previewVideoEl) previewVideoEl.hidden = kind !== "video";
  if (previewAudioEl) previewAudioEl.hidden = kind !== "audio";
}

function renderSimpleMarkdown(markdownText) {
  const lines = String(markdownText || "").replace(/\r/g, "").split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;
  let inCodeBlock = false;
  let codeFenceMarker = "";

  const renderInline = (text) => {
    const codeTokens = [];
    const withCodeTokens = String(text || "").replace(/`([^`]+)`/g, (_match, value) => {
      const token = `@@INLINE_CODE_${codeTokens.length}@@`;
      codeTokens.push(`<code>${escapeHtml(value)}</code>`);
      return token;
    });

    let html = escapeHtml(withCodeTokens);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    for (let i = 0; i < codeTokens.length; i += 1) {
      html = html.replace(`@@INLINE_CODE_${i}@@`, codeTokens[i]);
    }
    return html;
  };

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      out.push("</blockquote>");
      inBlockquote = false;
    }
  };

  const closeAllOpenBlocks = () => {
    closeLists();
    closeBlockquote();
  };

  const splitTableCells = (value) => {
    const text = String(value || "").trim().replace(/^\|/, "").replace(/\|$/, "");
    return text.split("|").map((cell) => cell.trim());
  };

  const tableDividerPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
  const tableAlignFromDivider = (cell) => {
    const divider = String(cell || "").trim();
    if (divider.startsWith(":") && divider.endsWith(":")) {
      return "center";
    }
    if (divider.endsWith(":")) {
      return "right";
    }
    return "left";
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = String(lines[lineIndex] || "");
    const trimmed = line.trim();
    const fenceStart = trimmed.match(/^(```+|~~~+)(.*)$/);

    if (fenceStart && !inCodeBlock) {
      closeLists();
      closeBlockquote();
      inCodeBlock = true;
      codeFenceMarker = fenceStart[1].charAt(0);
      const languageLabel = escapeHtml(String(fenceStart[2] || "").trim().split(/\s+/)[0] || "");
      out.push(languageLabel
        ? `<pre data-lang="${languageLabel}"><code>`
        : "<pre><code>");
      continue;
    }

    if (inCodeBlock) {
      const fenceEnd = trimmed.match(/^(```+|~~~+)\s*$/);
      if (fenceEnd && fenceEnd[1].charAt(0) === codeFenceMarker) {
        inCodeBlock = false;
        codeFenceMarker = "";
        out.push("</code></pre>");
        continue;
      }
      out.push(`${escapeHtml(line)}\n`);
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeAllOpenBlocks();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const nextLine = String(lines[lineIndex + 1] || "");
    if (line.includes("|") && tableDividerPattern.test(nextLine)) {
      closeAllOpenBlocks();

      const headerCells = splitTableCells(line);
      const dividerCells = splitTableCells(nextLine);
      const alignments = dividerCells.map(tableAlignFromDivider);

      out.push("<table>");
      out.push("<thead><tr>");
      for (let i = 0; i < headerCells.length; i += 1) {
        const header = renderInline(headerCells[i]);
        const align = alignments[i] || "left";
        out.push(`<th style=\"text-align:${align}\">${header}</th>`);
      }
      out.push("</tr></thead>");
      out.push("<tbody>");

      lineIndex += 2;
      while (lineIndex < lines.length) {
        const rowLine = String(lines[lineIndex] || "");
        if (!rowLine.trim() || !rowLine.includes("|")) {
          break;
        }
        const rowCells = splitTableCells(rowLine);
        out.push("<tr>");
        for (let i = 0; i < headerCells.length; i += 1) {
          const cell = renderInline(rowCells[i] || "");
          const align = alignments[i] || "left";
          out.push(`<td style=\"text-align:${align}\">${cell}</td>`);
        }
        out.push("</tr>");
        lineIndex += 1;
      }

      out.push("</tbody>");
      out.push("</table>");
      lineIndex -= 1;
      continue;
    }

    if (/^\s{0,3}([-*_])\s*\1\s*\1(?:\s*\1)*\s*$/.test(line)) {
      closeAllOpenBlocks();
      out.push("<hr />");
      continue;
    }

    const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ulMatch) {
      closeBlockquote();
      if (!inUl) {
        closeLists();
        inUl = true;
        out.push("<ul>");
      }
      const taskMatch = ulMatch[1].match(/^\[( |x|X)\]\s+(.*)$/);
      if (taskMatch) {
        const checked = taskMatch[1].toLowerCase() === "x";
        out.push(`<li><input type=\"checkbox\" disabled ${checked ? "checked" : ""} /> ${renderInline(taskMatch[2])}</li>`);
      } else {
        out.push(`<li>${renderInline(ulMatch[1])}</li>`);
      }
      continue;
    }

    const olMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      closeBlockquote();
      if (!inOl) {
        closeLists();
        inOl = true;
        out.push("<ol>");
      }
      out.push(`<li>${renderInline(olMatch[1])}</li>`);
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      closeLists();
      if (!inBlockquote) {
        inBlockquote = true;
        out.push("<blockquote>");
      }
      out.push(`<p>${renderInline(quoteMatch[1])}</p>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeAllOpenBlocks();
      continue;
    }

    closeAllOpenBlocks();
    out.push(`<p>${renderInline(line)}</p>`);
  }

  closeAllOpenBlocks();
  if (inCodeBlock) {
    out.push("</code></pre>");
  }
  return out.join("\n");
}

async function fetchPreviewBlob(pathValue) {
  const path = normalizeRelativePath(pathValue);
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
    const message = maybeJson?.error || `Preview download failed (${response.status})`;
    throw new Error(message);
  }

  const blob = await response.blob();
  return {
    blob,
    contentType: String(response.headers.get("content-type") || "").toLowerCase()
  };
}

async function loadPreview(pathValue, { force = false } = {}) {
  if (!previewRootEl) {
    return;
  }

  const normalizedPath = normalizeRelativePath(pathValue);
  const kind = detectPreviewKind(normalizedPath);
  if (!normalizedPath || kind === "none") {
    revokePreviewObjectUrl();
    if (previewImageEl) previewImageEl.removeAttribute("src");
    if (previewVideoEl) {
      previewVideoEl.pause();
      previewVideoEl.removeAttribute("src");
      previewVideoEl.load();
    }
    if (previewAudioEl) {
      previewAudioEl.pause();
      previewAudioEl.removeAttribute("src");
      previewAudioEl.load();
    }
    if (previewHtmlFrameEl) previewHtmlFrameEl.srcdoc = "";
    if (previewMarkdownEl) previewMarkdownEl.innerHTML = "";
    setPreviewVisibility("none");
    setPreviewMeta(normalizedPath, "none", normalizedPath
      ? `No markdown/html/image/video/audio preview for ${normalizedPath}.`
      : "Select a file to preview markdown, html, images, video, or audio.");
    previewPath = normalizedPath;
    return;
  }

  if (!force && normalizedPath === previewPath && kind === previewKind) {
    return;
  }

  setPreviewVisibility("none");
  setPreviewMeta(normalizedPath, kind, `Loading ${kind} preview for ${normalizedPath}...`);
  previewPath = normalizedPath;

  revokePreviewObjectUrl();
  try {
    if (kind === "video") {
      await ensureBrowserFileSession();
      const videoUrl = `/api/files/video-preview?${new URLSearchParams({ path: normalizedPath }).toString()}`;
      await waitForVideoPreview(videoUrl, normalizedPath);
      if (previewVideoEl) {
        previewVideoEl.src = videoUrl;
        previewVideoEl.load();
      }
      setPreviewVisibility("video");
      const directVideo = ["mp4", "m4v"].includes(getPathExtension(normalizedPath));
      setPreviewMeta(normalizedPath, kind, directVideo
        ? `Streaming ${normalizedPath}`
        : `Playing browser-compatible MP4 preview of ${normalizedPath}`);
      return;
    }

    if (kind === "image" || kind === "audio") {
      await ensureBrowserFileSession();
      const mediaUrl = `/api/files/media-preview?${new URLSearchParams({ path: normalizedPath }).toString()}`;
      if (kind === "image" && previewImageEl) previewImageEl.src = mediaUrl;
      if (kind === "audio" && previewAudioEl) {
        previewAudioEl.src = mediaUrl;
        previewAudioEl.load();
      }
      setPreviewVisibility(kind);
      setPreviewMeta(normalizedPath, kind, `Streaming ${normalizedPath}`);
      return;
    }

    const { blob, contentType } = await fetchPreviewBlob(normalizedPath);
    if (kind === "markdown") {
      const markdown = await blob.text();
      if (previewMarkdownEl) {
        previewMarkdownEl.innerHTML = renderSimpleMarkdown(markdown);
      }
      setPreviewVisibility("markdown");
      setPreviewMeta(normalizedPath, kind);
      return;
    }

    if (kind === "html") {
      const html = await blob.text();
      if (previewHtmlFrameEl) {
        previewHtmlFrameEl.srcdoc = html;
      }
      setPreviewVisibility("html");
      setPreviewMeta(normalizedPath, kind);
      return;
    }

    previewObjectUrl = URL.createObjectURL(blob);

  } catch (error) {
    revokePreviewObjectUrl();
    setPreviewVisibility("none");
    setPreviewMeta(normalizedPath, "none", `Preview failed: ${error.message}`);
  }
}

async function waitForVideoPreview(videoUrl, pathValue) {
  for (;;) {
    const prepared = await fetch(videoUrl, { method: "HEAD" });
    if (prepared.ok) return;
    if (prepared.status !== 202) {
      throw new Error(`Video preview preparation failed (${prepared.status})`);
    }
    setPreviewMeta(pathValue, "video", `Preparing browser-compatible video for ${pathValue}…`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function mergeApiAuthHeader(headers = {}) {
  const merged = new Headers(headers);
  const apiAuth = getStoredApiAuthHeader();
  if (apiAuth && !merged.has(apiAuth.headerName)) {
    merged.set(apiAuth.headerName, apiAuth.key);
  }
  return merged;
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

async function ensureBrowserFileSession() {
  const apiAuth = getStoredApiAuthHeader();
  if (!apiAuth) {
    return;
  }

  const response = await fetch("/api/files/browser-session", {
    method: "POST",
    headers: { [apiAuth.headerName]: apiAuth.key }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not authorize browser download (${response.status})`);
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

function getGitBranchName() {
  return String(currentWorkspaceBranch || "main").trim() || "main";
}

function getGitRemoteName() {
  return String(currentWorkspaceGit.remoteName || "origin").trim() || "origin";
}

function setGitFieldValues({ remoteUrl = "", remoteName = "origin", branch = "main", workspaceCode = "" } = {}) {
  const url = String(remoteUrl || "").trim();
  const repoDir = workspaceCode ? `remote-ai-access-${workspaceCode}` : "remote-ai-access-workspace";
  const cloneCommand = url ? `git clone ${url} ${repoDir}` : "Git remote unavailable";
  const pullCommand = `git pull ${remoteName} ${branch}`;
  const pushCommand = `git push -u ${remoteName} ${branch}`;

  if (gitMetaLabelEl) {
    gitMetaLabelEl.textContent = url ? `Remote: ${remoteName} / ${branch}` : "Remote: unavailable";
  }
  if (gitRemoteUrlInputEl) {
    gitRemoteUrlInputEl.value = url || "Git remote unavailable";
  }
  if (gitCloneCommandInputEl) {
    gitCloneCommandInputEl.value = cloneCommand;
  }
  if (gitPullCommandInputEl) {
    gitPullCommandInputEl.value = pullCommand;
  }
  if (gitPushCommandInputEl) {
    gitPushCommandInputEl.value = pushCommand;
  }
}

function updateGitPanel() {
  setGitFieldValues({
    remoteUrl: currentWorkspaceGit.remoteHttpsUrl || currentWorkspaceGit.remoteSshUrl,
    remoteName: getGitRemoteName(),
    branch: getGitBranchName(),
    workspaceCode: currentWorkspaceCode || "default"
  });
}

async function loadWorkspaceInfo() {
  if (!workspaceBadgeEl) {
    return;
  }
  try {
    const data = await apiJson("/api/session/workspace");
    const code = normalizeWorkspaceCode(data?.workspaceCode) || "default";
    currentWorkspaceCode = code;
    currentWorkspaceBranch = String(data?.currentBranch || currentWorkspaceBranch || "main").trim() || "main";
    if (data?.gitRemote) {
      currentWorkspaceGit = {
        remoteName: String(data.gitRemote.remoteName || currentWorkspaceGit.remoteName || "origin"),
        remoteHttpsUrl: String(data.gitRemote.remoteHttpsUrl || currentWorkspaceGit.remoteHttpsUrl || ""),
        remoteSshUrl: String(data.gitRemote.remoteSshUrl || currentWorkspaceGit.remoteSshUrl || ""),
        remotePath: String(data.gitRemote.remotePath || currentWorkspaceGit.remotePath || "")
      };
    }
    workspaceBadgeEl.textContent = `Workspace: ${code}`;
    if (workspaceCodeInputEl && !workspaceCodeInputEl.value) {
      workspaceCodeInputEl.value = code;
    }
    updateGitPanel();
  } catch {
    currentWorkspaceCode = "";
    workspaceBadgeEl.textContent = "Workspace: unknown";
    updateGitPanel();
  }
}

async function loadWorkspaceGitInfo() {
  try {
    const data = await apiJson("/api/session/workspace/git");
    currentWorkspaceCode = normalizeWorkspaceCode(data?.workspaceCode) || currentWorkspaceCode || "default";
    currentWorkspaceGit = {
      remoteName: String(data?.remoteName || currentWorkspaceGit.remoteName || "origin"),
      remoteHttpsUrl: String(data?.remoteHttpsUrl || currentWorkspaceGit.remoteHttpsUrl || ""),
      remoteSshUrl: String(data?.remoteSshUrl || currentWorkspaceGit.remoteSshUrl || ""),
      remotePath: String(data?.remotePath || currentWorkspaceGit.remotePath || "")
    };
    updateGitPanel();
  } catch (error) {
    if (gitMetaLabelEl) {
      gitMetaLabelEl.textContent = `Remote: ${error.message}`;
    }
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
    url.searchParams.delete("access_code");
    window.location.replace(url.toString());
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    workspaceSwitchBtnEl.disabled = false;
  }
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    throw new Error("Nothing to copy.");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function pullWorkspaceGit() {
  if (!confirmDiscardUnsavedChanges("pull from git")) {
    return;
  }
  const branch = getGitBranchName();
  const remoteName = getGitRemoteName();
  const confirmed = window.confirm(`Pull ${remoteName}/${branch} into this workspace?`);
  if (!confirmed) {
    return;
  }

  if (gitPullBtnEl) {
    gitPullBtnEl.disabled = true;
  }
  try {
    const data = await apiJson("/api/session/workspace/git/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remoteName, branch, strategy: "ff-only" })
    });
    currentWorkspaceBranch = String(data?.branch || branch);
    currentWorkspaceGit.remoteName = String(data?.remote || data?.remoteName || remoteName);
    updateGitPanel();
    activeFilePath = "";
    originalFileContent = "";
    selectedPath = "";
    selectedPathType = "";
    activePathLabelEl.textContent = "No file selected";
    setEditorContent("", "");
    clearLintDiagnostics();
    await loadDirectory(currentDir);
    setStatus(`Pulled ${currentWorkspaceGit.remoteName}/${currentWorkspaceBranch}${data?.head ? ` at ${data.head}` : ""}.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    if (gitPullBtnEl) {
      gitPullBtnEl.disabled = false;
    }
  }
}

async function pushWorkspaceGit() {
  const branch = getGitBranchName();
  const remoteName = getGitRemoteName();
  if (gitPushBtnEl) {
    gitPushBtnEl.disabled = true;
  }
  try {
    const data = await apiJson("/api/session/workspace/git/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remoteName, branch, setUpstream: true })
    });
    currentWorkspaceBranch = String(data?.branch || branch);
    currentWorkspaceGit.remoteName = String(data?.remote || data?.remoteName || remoteName);
    updateGitPanel();
    setStatus(data?.ok === false ? `Push finished with output: ${data.output || "check git status"}` : `Pushed ${currentWorkspaceGit.remoteName}/${currentWorkspaceBranch}.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    if (gitPushBtnEl) {
      gitPushBtnEl.disabled = false;
    }
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
  const requestOptions = { ...options };
  requestOptions.headers = mergeApiAuthHeader(options.headers || {});
  const response = await fetch(url, requestOptions);
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

function formatShareDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function renderFileShares(shares) {
  if (!shareListEl) return;
  shareListEl.replaceChildren();
  if (!shares.length) {
    const empty = document.createElement("p");
    empty.className = "share-empty";
    empty.textContent = "No active shares in this workspace.";
    shareListEl.append(empty);
    return;
  }

  for (const share of shares) {
    const row = document.createElement("article");
    row.className = "share-item";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = share.fileName || share.path;
    const meta = document.createElement("span");
    const flags = [share.passwordProtected ? "password" : "public", share.encrypted ? "encrypted" : "range-ready"];
    meta.textContent = `${flags.join(" · ")} · expires ${formatShareDate(share.expiresAt)} · ${Number(share.accessCount || 0)} access(es)`;
    details.append(title, meta);
    const links = document.createElement("div");
    links.className = "share-item-links";
    if (share.viewUrl && share.directUrl) {
      for (const [label, url] of [["Copy View URL", share.viewUrl], ["Copy Direct URL", share.directUrl]]) {
        const copy = document.createElement("button");
        copy.className = "btn btn-soft";
        copy.type = "button";
        copy.textContent = label;
        copy.addEventListener("click", async () => {
          try {
            await copyTextToClipboard(url);
            setStatus(`${label.replace("Copy ", "")} copied.`);
          } catch (error) {
            setStatus(`Error: ${error.message}`);
          }
        });
        links.append(copy);
      }
    } else {
      const unavailable = document.createElement("span");
      unavailable.textContent = "URLs unavailable for shares created before retained links.";
      links.append(unavailable);
    }
    if (share.passwordProtected) {
      if (share.passwordCode) {
        const passwordValue = document.createElement("code");
        passwordValue.className = "share-password-code";
        passwordValue.textContent = share.passwordCode;
        passwordValue.hidden = true;
        const reveal = document.createElement("button");
        reveal.className = "btn btn-soft";
        reveal.type = "button";
        reveal.textContent = "Show Password";
        reveal.addEventListener("click", () => {
          passwordValue.hidden = !passwordValue.hidden;
          reveal.textContent = passwordValue.hidden ? "Show Password" : "Hide Password";
        });
        const copyPassword = document.createElement("button");
        copyPassword.className = "btn btn-soft";
        copyPassword.type = "button";
        copyPassword.textContent = "Copy Password";
        copyPassword.addEventListener("click", async () => {
          try {
            await copyTextToClipboard(share.passwordCode);
            setStatus("Share password copied.");
          } catch (error) {
            setStatus(`Error: ${error.message}`);
          }
        });
        links.append(reveal, copyPassword, passwordValue);
      } else {
        const unavailable = document.createElement("span");
        unavailable.textContent = "Password unavailable for shares created before retained codes.";
        links.append(unavailable);
      }
    }
    details.append(links);
    const revoke = document.createElement("button");
    revoke.className = "btn btn-soft danger";
    revoke.type = "button";
    revoke.textContent = "Revoke";
    revoke.addEventListener("click", async () => {
      if (!window.confirm(`Revoke the share for ${share.fileName}?`)) return;
      try {
        await apiJson(`/api/files/shares/${encodeURIComponent(share.id)}`, { method: "DELETE" });
        await loadFileShares();
        setStatus(`Revoked share for ${share.fileName}.`);
      } catch (error) {
        setStatus(`Error: ${error.message}`);
      }
    });
    row.append(details, revoke);
    shareListEl.append(row);
  }
}

async function loadFileShares() {
  const data = await apiJson("/api/files/shares");
  renderFileShares(Array.isArray(data.shares) ? data.shares : []);
}

async function createFileShare() {
  const pathTarget = normalizeRelativePath(selectedPath || activeFilePath);
  if (!pathTarget || selectedPathType === "directory") {
    setStatus("Select a file to share.");
    return;
  }
  createShareBtnEl.disabled = true;
  createShareBtnEl.textContent = "Creating…";
  try {
    const data = await apiJson("/api/files/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: pathTarget,
        expiresInHours: Number(shareExpirySelectEl.value),
        password: sharePasswordInputEl.value,
        encrypted: shareEncryptInputEl.checked
      })
    });
    shareViewUrlInputEl.value = data.viewUrl || "";
    shareDirectUrlInputEl.value = data.directUrl || "";
    shareResultEl.hidden = false;
    sharePasswordInputEl.value = "";
    await loadFileShares();
    setStatus(`Created public share for ${pathTarget}. Save the URLs now; the bearer token is not stored in readable form.`);
  } finally {
    createShareBtnEl.disabled = false;
    createShareBtnEl.textContent = "Create Share";
  }
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

function setDownloadProgress({ visible = true, loaded = 0, total = 0, message = "Preparing…" } = {}) {
  if (!downloadProgressEl || !downloadProgressLabelEl || !downloadProgressBarEl) {
    return;
  }

  downloadProgressEl.hidden = !visible;
  downloadProgressLabelEl.textContent = message;
  const hasTotal = Number.isFinite(total) && total > 0;
  downloadProgressBarEl.max = hasTotal ? total : 1;
  downloadProgressBarEl.value = hasTotal ? Math.min(Math.max(0, loaded), total) : 0;
}

async function downloadActiveFile(path, onProgress) {
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

  const total = Number(response.headers.get("content-length")) || 0;
  let loaded = 0;
  const chunks = [];
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
    }
  } else {
    const blob = await response.blob();
    loaded = blob.size;
    chunks.push(blob);
    onProgress?.(loaded, total || loaded);
  }

  const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
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

function getEditorCursorLineCol() {
  if (!view) {
    return { line: 1, col: 1 };
  }
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return {
    line: line.number,
    col: Math.max(1, head - line.from + 1)
  };
}

function buildDirectFileLabLink(pathValue, includeCursor = false) {
  const normalizedPath = normalizeRelativePath(pathValue);
  if (!normalizedPath) {
    return "";
  }

  const params = new URLSearchParams({ path: normalizedPath });
  if (includeCursor) {
    const cursor = getEditorCursorLineCol();
    params.set("line", String(cursor.line));
    params.set("col", String(cursor.col));
  }

  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.search = params.toString();
  return url.toString();
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
  inputEl.value = "";
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

function getMultipartUploadPosition(files, loadedBytes) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return "";
  }

  const loaded = Math.max(0, Number(loadedBytes || 0));
  let cumulative = 0;
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    const size = Math.max(0, Number(file?.size || 0));
    const nextCumulative = cumulative + size;
    const isCurrent = loaded <= nextCumulative || index === list.length - 1;
    if (isCurrent) {
      const withinFile = Math.max(0, Math.min(size, loaded - cumulative));
      const fileName = String(file?.webkitRelativePath || file?.name || "unnamed");
      return `[file ${index + 1}/${list.length}: ${fileName} ${formatByteSize(withinFile)} / ${formatByteSize(size)}]`;
    }
    cumulative = nextCumulative;
  }

  return `[file ${list.length}/${list.length}]`;
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
        const statusUrl = `/api/files/upload/chunk/${encodeURIComponent(resumeUploadId)}`;
        const status = await apiJson(statusUrl, { headers: requestHeaders });
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

    const startUrl = "/api/files/upload/chunk/start";

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

      const chunkUrl = `/api/files/upload/chunk/${encodeURIComponent(uploadId)}?index=${chunkIndex}`;

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

    const completeUrl = `/api/files/upload/chunk/${encodeURIComponent(uploadId)}/complete`;

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
    const name = document.createElement("span");
    name.className = "file-item-name";
    name.textContent = `${entry.type === "directory" ? "[D]" : "[F]"} ${entry.name}`;
    const details = document.createElement("span");
    details.className = "file-item-details";
    details.textContent = entry.type === "directory"
      ? `${formatByteSize(entry.size)} · ${Number(entry.fileCount || 0)} files · ${Number(entry.directoryCount || 0)} folders`
      : formatByteSize(entry.size);
    btn.append(name, details);
    btn.title = entry.type === "directory"
      ? `${entry.name}: ${entry.size} bytes, ${Number(entry.fileCount || 0)} files, ${Number(entry.directoryCount || 0)} folders`
      : `${entry.name} (${entry.size} bytes)`;

    btn.addEventListener("click", async () => {
      const targetPath = joinPath(currentDir, entry.name);
      if (entry.type === "directory") {
        selectedPath = targetPath;
        selectedPathType = "directory";
        activePathLabelEl.textContent = `Folder selected: ${targetPath}`;
        setStatus(`Selected folder ${targetPath}. Double-click to open.`);
        markSelectedFileItem(btn);
        loadPreview(targetPath, { force: true });
        return;
      }

      // Selection must not depend on the text editor being able to read the
      // file.  In particular, files over the editor read limit still need to
      // be downloadable from File Lab.
      selectedPath = targetPath;
      selectedPathType = "file";
      markSelectedFileItem(btn);
      loadPreview(targetPath, { force: true });

      try {
        if (activeFilePath !== targetPath && !confirmDiscardUnsavedChanges("open another file")) {
          return;
        }
        const fileData = await apiJson(`/api/files/read?${new URLSearchParams({ path: targetPath }).toString()}`);
        activeFilePath = fileData.path;
        selectedPath = activeFilePath;
        selectedPathType = "file";
        originalFileContent = fileData.content || "";
        activePathLabelEl.textContent = activeFilePath;
        setEditorContent(fileData.content || "", activeFilePath);
        clearLintDiagnostics();
        setStatus(`Loaded ${activeFilePath}`);
        loadPreview(activeFilePath, { force: true });
      } catch (error) {
        setStatus(`Could not open ${targetPath}: ${error.message}. It remains selected and can be downloaded.`);
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
  loadPreview(activeFilePath, { force: true });
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

  const uploadUrl = "/api/files/upload";

  uploadInFlight = true;
  let lastLoaded = 0;
  let lastTotal = totalBytes;
  let lastProgressAt = Date.now();
  let waitingOnServer = false;
  let lastProgressLabel = `Uploading ${files.length} file(s)... 0%`;
  let heartbeatTicks = 0;
  const heartbeat = window.setInterval(() => {
    heartbeatTicks += 1;
    const elapsed = Math.round((Date.now() - lastProgressAt) / 1000);
    const positionLabel = getMultipartUploadPosition(files, lastLoaded);
    if (waitingOnServer) {
      const dotCount = (heartbeatTicks % 3) + 1;
      setStatus(`${lastProgressLabel} ${positionLabel} Upload sent. Waiting on server${".".repeat(dotCount)} (${elapsed}s)`);
      return;
    }
    if (elapsed >= 3) {
      setStatus(`${lastProgressLabel} ${positionLabel} (${elapsed}s without new progress)`);
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
          lastProgressLabel = `Uploading ${files.length} file(s)... ${formatUploadProgress(lastLoaded, lastTotal)}`;
          const positionLabel = getMultipartUploadPosition(files, lastLoaded);
          setStatus(`${lastProgressLabel} ${positionLabel}`);
        },
        () => {
          waitingOnServer = true;
          lastProgressAt = Date.now();
          const positionLabel = getMultipartUploadPosition(files, lastLoaded);
          setStatus(`${lastProgressLabel} ${positionLabel} Upload sent. Waiting on server... (0s)`);
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
    downloadBtnEl.disabled = true;
    downloadBtnEl.textContent = "Downloading…";
    setDownloadProgress({ message: "Preparing download…" });
    await downloadActiveFile(selectedPath, (loaded, total) => {
      const hasTotal = total > 0;
      const percent = hasTotal ? Math.min(100, Math.round((loaded / total) * 100)) : null;
      setDownloadProgress({
        loaded,
        total,
        message: hasTotal
          ? `${percent}% · ${formatByteSize(loaded)} / ${formatByteSize(total)}`
          : `${formatByteSize(loaded)} received`
      });
    });
    setDownloadProgress({ message: "Download complete", loaded: 1, total: 1 });
    setStatus(`Downloaded ${selectedPath}`);
  } catch (error) {
    setDownloadProgress({ message: "Download failed" });
    setStatus(`Error: ${error.message}`);
  } finally {
    downloadBtnEl.disabled = false;
    downloadBtnEl.textContent = "Download";
  }
});

if (copyDirectLinkBtnEl) {
  copyDirectLinkBtnEl.addEventListener("click", async () => {
    const pathTarget = selectedPath || activeFilePath;
    if (!pathTarget) {
      setStatus("Select a file or folder first.");
      return;
    }

    const includeCursor = selectedPathType === "file"
      && normalizeRelativePath(pathTarget) === normalizeRelativePath(activeFilePath);
    const directLink = buildDirectFileLabLink(pathTarget, includeCursor);
    if (!directLink) {
      setStatus("Could not build a direct link for the selected path.");
      return;
    }

    try {
      await copyTextToClipboard(directLink);
      setStatus(includeCursor
        ? "Direct File Lab link copied with line and column."
        : "Direct File Lab link copied.");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  });
}

if (shareFileBtnEl) {
  shareFileBtnEl.addEventListener("click", () => {
    const pathTarget = normalizeRelativePath(selectedPath || activeFilePath);
    shareSelectionLabelEl.textContent = pathTarget && selectedPathType !== "directory"
      ? `Ready to share: ${pathTarget}`
      : "Select a file to create an expiring public link.";
    sharePanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (createShareBtnEl) {
  createShareBtnEl.addEventListener("click", () => {
    createFileShare().catch((error) => setStatus(`Error: ${error.message}`));
  });
}

if (refreshSharesBtnEl) {
  refreshSharesBtnEl.addEventListener("click", () => {
    loadFileShares().catch((error) => setStatus(`Error: ${error.message}`));
  });
}

if (copyShareViewBtnEl) {
  copyShareViewBtnEl.addEventListener("click", () => {
    copyTextToClipboard(shareViewUrlInputEl.value)
      .then(() => setStatus("Public view URL copied."))
      .catch((error) => setStatus(`Error: ${error.message}`));
  });
}

if (copyShareDirectBtnEl) {
  copyShareDirectBtnEl.addEventListener("click", () => {
    copyTextToClipboard(shareDirectUrlInputEl.value)
      .then(() => setStatus("Public direct URL copied."))
      .catch((error) => setStatus(`Error: ${error.message}`));
  });
}

if (refreshPreviewBtnEl) {
  refreshPreviewBtnEl.addEventListener("click", () => {
    const pathTarget = selectedPath || activeFilePath;
    loadPreview(pathTarget, { force: true });
  });
}

if (previewToggleBtnEl && previewRootEl) {
  previewToggleBtnEl.addEventListener("click", () => {
    const expanded = previewToggleBtnEl.getAttribute("aria-expanded") === "true";
    previewToggleBtnEl.setAttribute("aria-expanded", String(!expanded));
    previewToggleBtnEl.textContent = expanded ? "Show Preview" : "Hide Preview";
    previewRootEl.hidden = expanded;
  });
}

if (openPreviewNewTabBtnEl) {
  openPreviewNewTabBtnEl.addEventListener("click", async () => {
    const pathTarget = normalizeRelativePath(selectedPath || activeFilePath);
    if (!pathTarget) {
      setStatus("Select a file first.");
      return;
    }
    const kind = detectPreviewKind(pathTarget);
    if (kind === "none") {
      setStatus("Selected file type does not support preview.");
      return;
    }
    const endpoint = kind === "video" ? "/api/files/video-preview" : ["image", "audio"].includes(kind) ? "/api/files/media-preview" : "/api/files/download";
    const targetUrl = `${endpoint}?${new URLSearchParams({ path: pathTarget }).toString()}`;
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setStatus("Could not open preview. Allow pop-ups for this site and retry.");
      return;
    }
    previewWindow.opener = null;
    try {
      await ensureBrowserFileSession();
      if (kind === "video") await waitForVideoPreview(targetUrl, pathTarget);
      previewWindow.location.replace(targetUrl);
      setStatus("Opened file preview in a new tab.");
    } catch (error) {
      previewWindow.close();
      setStatus(`Error: ${error.message}`);
    }
  });
}

if (copyGitRemoteBtnEl) {
  copyGitRemoteBtnEl.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(currentWorkspaceGit.remoteHttpsUrl || currentWorkspaceGit.remoteSshUrl || "");
      setStatus("Git remote URL copied.");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  });
}

if (gitPullBtnEl) {
  gitPullBtnEl.addEventListener("click", () => {
    pullWorkspaceGit().catch((error) => setStatus(`Error: ${error.message}`));
  });
}

if (gitPushBtnEl) {
  gitPushBtnEl.addEventListener("click", () => {
    pushWorkspaceGit().catch((error) => setStatus(`Error: ${error.message}`));
  });
}

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

setPreviewMeta("", "none");
setPreviewVisibility("none");

loadWorkspaceInfo().catch(() => {});
loadWorkspaceGitInfo().catch(() => {});
loadUploadPolicy().catch(() => {});
loadFileShares().catch(() => {});
