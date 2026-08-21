const canvas = document.querySelector("#previewCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const sourceInput = document.querySelector("#sourceInput");
const avatarInput = document.querySelector("#avatarInput");
const avatarMode = document.querySelector("#avatarMode");
const likeCount = document.querySelector("#likeCount");
const likeCountNumber = document.querySelector("#likeCountNumber");
const likeCountOutput = document.querySelector("#likeCountOutput");
const positionRange = document.querySelector("#positionRange");
const detectedTheme = document.querySelector("#detectedTheme");
const sourceStatus = document.querySelector("#sourceStatus");
const avatarStatus = document.querySelector("#avatarStatus");
const imageDimensions = document.querySelector("#imageDimensions");
const emptyState = document.querySelector("#emptyState");
const formatSelect = document.querySelector("#formatSelect");
const toast = document.querySelector("#toast");

const avatarNames = [
  ...Array.from({ length: 19 }, (_, index) => `assets/avatars/sample2-${String(index + 1).padStart(2, "0")}.jpg`),
  ...Array.from({ length: 20 }, (_, index) => `assets/avatars/sample1-${String(index + 1).padStart(2, "0")}.jpg`),
];
const webAvatarNames = Array.from(
  { length: 99 },
  (_, index) => `assets/web-avatars/avatar-${String((index * 37) % 99 + 1).padStart(3, "0")}.jpg`,
);

const state = {
  source: null,
  sourceName: "原图.jpg",
  avatars: [],
  libraryAvatars: [],
  webAvatars: [],
  customAvatars: [],
  avatarMode: "web",
  avatarOffset: 0,
  themeChoice: "auto",
  detectedTheme: "dark",
  automaticPosition: 28,
  dragging: false,
  dragOffset: 0,
  panelBounds: null,
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function getLikeCount() {
  return clamp(Number.parseInt(likeCount.value, 10) || 0, 0, 99);
}

function setLikeCount(value) {
  const normalized = clamp(Number.parseInt(value, 10) || 0, 0, 99);
  likeCount.value = normalized;
  likeCountNumber.value = normalized;
  likeCountOutput.value = normalized;
  likeCountOutput.textContent = normalized;
  render();
}

function getTheme() {
  return state.themeChoice === "auto" ? state.detectedTheme : state.themeChoice;
}

function useAvatarMode(mode, notify = false) {
  state.avatarMode = mode;
  state.avatarOffset = 0;
  if (mode === "library") {
    state.avatars = state.libraryAvatars;
    avatarStatus.textContent = `${state.avatars.length} 个内置头像，超出后循环`;
  } else if (mode === "web") {
    state.avatars = state.webAvatars;
    avatarStatus.textContent = `${state.avatars.length} 个网络头像，不重复`;
  } else if (state.customAvatars.length > 0) {
    state.avatars = state.customAvatars;
    avatarStatus.textContent = `${state.avatars.length} 个自定义头像，超出后循环`;
  } else {
    avatarMode.value = "web";
    useAvatarMode("web", false);
    if (notify) showToast("还没有上传头像，已切换为网络头像包");
    return;
  }
  render();
  if (notify) showToast("头像来源已切换");
}

function sampleSource() {
  const sampleCanvas = document.createElement("canvas");
  const maxWidth = 360;
  const scale = Math.min(1, maxWidth / state.source.naturalWidth);
  sampleCanvas.width = Math.max(1, Math.round(state.source.naturalWidth * scale));
  sampleCanvas.height = Math.max(1, Math.round(state.source.naturalHeight * scale));
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(state.source, 0, 0, sampleCanvas.width, sampleCanvas.height);
  return {
    canvas: sampleCanvas,
    context: sampleContext,
    width: sampleCanvas.width,
    height: sampleCanvas.height,
    scale,
  };
}

function luminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function analyzeSource() {
  const sample = sampleSource();
  const { context, width, height } = sample;
  const pixels = context.getImageData(0, 0, width, height).data;
  const colorSamples = [];
  const samplePoints = [
    [0.5, 0.55], [0.35, 0.62], [0.65, 0.62], [0.5, 0.72], [0.2, 0.55], [0.8, 0.55],
  ];

  for (const [xRatio, yRatio] of samplePoints) {
    const x = Math.floor(width * xRatio);
    const y = Math.floor(height * yRatio);
    const index = (y * width + x) * 4;
    colorSamples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  }

  colorSamples.sort((a, b) => luminance(...a) - luminance(...b));
  const background = colorSamples[Math.floor(colorSamples.length / 2)];
  state.detectedTheme = luminance(...background) < 128 ? "dark" : "light";
  detectedTheme.textContent = state.themeChoice === "auto"
    ? `自动 · ${state.detectedTheme === "dark" ? "深色" : "浅色"}`
    : state.themeChoice === "dark" ? "深色" : "浅色";

  const startY = Math.floor(height * 0.2);
  const endY = Math.floor(height * 0.5);
  const startX = Math.floor(width * 0.04);
  const endX = Math.floor(width * 0.95);
  const rowActive = new Array(height).fill(false);

  for (let y = startY; y < endY; y += 1) {
    let changed = 0;
    let checked = 0;
    for (let x = startX; x < endX; x += 3) {
      const index = (y * width + x) * 4;
      const delta = Math.abs(pixels[index] - background[0])
        + Math.abs(pixels[index + 1] - background[1])
        + Math.abs(pixels[index + 2] - background[2]);
      if (delta > 62) changed += 1;
      checked += 1;
    }
    rowActive[y] = changed / checked > 0.008;
  }

  let lastActive = Math.floor(height * 0.27);
  for (let y = startY; y < endY; y += 1) {
    if (rowActive[y]) {
      lastActive = y;
    }
  }

  const sourceY = clamp((lastActive + Math.round(width * 0.025)) / height * 100, 18, 70);
  state.automaticPosition = Number(sourceY.toFixed(1));
  positionRange.value = state.automaticPosition;
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function heartPath(context, centerX, centerY, size) {
  const x = centerX;
  const y = centerY + size * 0.08;
  context.beginPath();
  context.moveTo(x, y + size * 0.34);
  context.bezierCurveTo(x - size * 0.52, y + size * 0.02, x - size * 0.45, y - size * 0.36, x - size * 0.2, y - size * 0.38);
  context.bezierCurveTo(x - size * 0.06, y - size * 0.39, x, y - size * 0.27, x, y - size * 0.2);
  context.bezierCurveTo(x, y - size * 0.27, x + size * 0.06, y - size * 0.39, x + size * 0.2, y - size * 0.38);
  context.bezierCurveTo(x + size * 0.45, y - size * 0.36, x + size * 0.52, y + size * 0.02, x, y + size * 0.34);
  context.closePath();
}

function coverImage(context, image, x, y, size) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const sourceSize = Math.min(imageWidth, imageHeight);
  const sourceX = (imageWidth - sourceSize) / 2;
  const sourceY = (imageHeight - sourceSize) / 2;
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, x, y, size, size);
}

function calculateLayout(count) {
  const width = canvas.width;
  const height = canvas.height;
  const panelX = Math.round(width * 0.026);
  const panelWidth = width - panelX * 2;
  const panelY = Math.round(height * Number(positionRange.value) / 100);
  const leftColumn = Math.round(width * 0.094);
  const padding = Math.round(width * 0.018);
  const gap = Math.max(5, Math.round(width * 0.014));
  const preferredSize = Math.round(width * 0.076);
  const avatarX = panelX + leftColumn;
  const availableWidth = panelX + panelWidth - padding - avatarX;
  const columns = Math.max(1, Math.floor((availableWidth + gap) / (preferredSize + gap)));
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / columns));
  const lowerLimit = Math.round(height * 0.875);
  const availableHeight = Math.max(preferredSize, lowerLimit - panelY - padding * 2);
  const fittedSize = Math.floor((availableHeight - gap * (rows - 1)) / rows);
  const avatarSize = clamp(Math.min(preferredSize, fittedSize), Math.round(width * 0.028), preferredSize);
  const actualColumns = Math.max(1, Math.floor((availableWidth + gap) / (avatarSize + gap)));
  const actualRows = Math.max(1, Math.ceil(Math.max(1, count) / actualColumns));
  const panelHeight = count === 0
    ? Math.round(width * 0.11)
    : padding * 2 + actualRows * avatarSize + (actualRows - 1) * gap;

  return { panelX, panelY, panelWidth, panelHeight, leftColumn, padding, gap, avatarX, avatarSize, columns: actualColumns };
}

function render() {
  if (!state.source) return;
  const width = state.source.naturalWidth;
  const height = state.source.naturalHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.drawImage(state.source, 0, 0, width, height);
  const count = getLikeCount();
  if (count === 0) {
    state.panelBounds = null;
    return;
  }

  const layout = calculateLayout(count);
  const theme = getTheme();
  const panelColor = theme === "dark" ? "rgba(34, 34, 34, 0.98)" : "rgba(247, 248, 249, 0.98)";
  const iconColor = theme === "dark" ? "#8393ad" : "#607493";
  const cornerRadius = Math.round(width * 0.007);

  ctx.save();
  roundedRectPath(ctx, layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight, cornerRadius);
  ctx.fillStyle = panelColor;
  ctx.fill();

  const separatorX = layout.panelX + layout.leftColumn - Math.round(width * 0.012);
  ctx.beginPath();
  ctx.moveTo(separatorX, layout.panelY + layout.padding * 0.55);
  ctx.lineTo(separatorX, layout.panelY + layout.panelHeight - layout.padding * 0.55);
  ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.045)" : "rgba(40,54,70,0.07)";
  ctx.lineWidth = Math.max(1, Math.round(width * 0.0012));
  ctx.stroke();

  const heartSize = Math.round(width * 0.039);
  heartPath(ctx, layout.panelX + layout.leftColumn * 0.43, layout.panelY + layout.padding + layout.avatarSize / 2, heartSize);
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = Math.max(3, Math.round(width * 0.003));
  ctx.lineJoin = "round";
  ctx.stroke();

  for (let index = 0; index < count; index += 1) {
    if (state.avatars.length === 0) break;
    const avatar = state.avatars[(index + state.avatarOffset) % state.avatars.length];
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x = layout.avatarX + column * (layout.avatarSize + layout.gap);
    const y = layout.panelY + layout.padding + row * (layout.avatarSize + layout.gap);
    ctx.save();
    roundedRectPath(ctx, x, y, layout.avatarSize, layout.avatarSize, Math.max(2, Math.round(width * 0.004)));
    ctx.clip();
    coverImage(ctx, avatar, x, y, layout.avatarSize);
    ctx.restore();
  }
  ctx.restore();
  state.panelBounds = layout;
}

async function setSource(image, name) {
  state.source = image;
  state.sourceName = name;
  sourceStatus.textContent = `${name} · 保留原图主题与尺寸`;
  imageDimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
  emptyState.hidden = true;
  analyzeSource();
  render();
}

async function filesToImages(files) {
  const entries = await Promise.all(Array.from(files).map(async (file) => {
    const url = URL.createObjectURL(file);
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }));
  return entries;
}

async function loadDefaults() {
  try {
    const [source, avatars, webAvatars] = await Promise.all([
      loadImage("原图.jpg"),
      Promise.all(avatarNames.map((name) => loadImage(name).catch(() => null))),
      Promise.all(webAvatarNames.map((name) => loadImage(name).catch(() => null))),
    ]);
    state.libraryAvatars = avatars.filter(Boolean);
    state.webAvatars = webAvatars.filter(Boolean);
    useAvatarMode("web");
    await setSource(source, "原图.jpg");
  } catch (error) {
    emptyState.textContent = "默认图片载入失败，请选择一张原始截图";
    sourceStatus.textContent = "请选择原始截图";
  }
}

sourceInput.addEventListener("change", async () => {
  const [file] = sourceInput.files;
  if (!file) return;
  const [image] = await filesToImages([file]);
  await setSource(image, file.name);
});

avatarInput.addEventListener("change", async () => {
  if (avatarInput.files.length === 0) return;
  state.customAvatars = await filesToImages(avatarInput.files);
  avatarMode.value = "custom";
  useAvatarMode("custom");
  showToast("已使用自定义头像");
});

avatarMode.addEventListener("change", () => useAvatarMode(avatarMode.value, true));

likeCount.addEventListener("input", () => setLikeCount(likeCount.value));
likeCountNumber.addEventListener("input", () => setLikeCount(likeCountNumber.value));
document.querySelector("#decreaseButton").addEventListener("click", () => setLikeCount(getLikeCount() - 1));
document.querySelector("#increaseButton").addEventListener("click", () => setLikeCount(getLikeCount() + 1));

positionRange.addEventListener("input", render);
document.querySelector("#autoPositionButton").addEventListener("click", () => {
  positionRange.value = state.automaticPosition;
  render();
  showToast("已自动定位点赞栏");
});

document.querySelectorAll("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-theme]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.themeChoice = button.dataset.theme;
    detectedTheme.textContent = state.themeChoice === "auto"
      ? `自动 · ${state.detectedTheme === "dark" ? "深色" : "浅色"}`
      : state.themeChoice === "dark" ? "深色" : "浅色";
    render();
  });
});

document.querySelector("#shuffleButton").addEventListener("click", () => {
  if (state.avatars.length > 1) {
    state.avatarOffset = (state.avatarOffset + 1 + Math.floor(Math.random() * (state.avatars.length - 1))) % state.avatars.length;
    render();
    showToast("头像顺序已更新");
  }
});

document.querySelector("#resetButton").addEventListener("click", async () => {
  setLikeCount(20);
  avatarMode.value = "web";
  useAvatarMode("web");
  state.avatarOffset = 0;
  state.themeChoice = "auto";
  document.querySelectorAll("[data-theme]").forEach((button) => button.classList.toggle("active", button.dataset.theme === "auto"));
  try {
    const image = await loadImage("原图.jpg");
    await setSource(image, "原图.jpg");
    showToast("已恢复默认设置");
  } catch (error) {
    render();
  }
});

document.querySelector("#downloadButton").addEventListener("click", () => {
  if (!state.source) return;
  render();
  const mimeType = formatSelect.value;
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const baseName = state.sourceName.replace(/\.[^.]+$/, "");
  const link = document.createElement("a");
  link.download = `${baseName}-点赞${getLikeCount()}.${extension}`;
  link.href = canvas.toDataURL(mimeType, 0.94);
  link.click();
  showToast("图片已生成");
});

function pointerY(event) {
  const rect = canvas.getBoundingClientRect();
  return (event.clientY - rect.top) * canvas.height / rect.height;
}

canvas.addEventListener("pointerdown", (event) => {
  if (!state.panelBounds) return;
  const y = pointerY(event);
  const panel = state.panelBounds;
  if (y < panel.panelY || y > panel.panelY + panel.panelHeight) return;
  state.dragging = true;
  state.dragOffset = y - panel.panelY;
  canvas.classList.add("dragging");
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const panelY = pointerY(event) - state.dragOffset;
  positionRange.value = clamp(panelY / canvas.height * 100, Number(positionRange.min), Number(positionRange.max)).toFixed(1);
  render();
});

canvas.addEventListener("pointerup", (event) => {
  if (!state.dragging) return;
  state.dragging = false;
  canvas.classList.remove("dragging");
  canvas.releasePointerCapture(event.pointerId);
});

loadDefaults();
