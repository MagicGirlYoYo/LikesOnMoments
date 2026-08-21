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
const MAX_LIKE_COUNT = 200;
const WEB_AVATAR_COUNT = 1000;
const webAvatarNames = Array.from(
  { length: WEB_AVATAR_COUNT },
  (_, index) => `assets/web-avatars/avatar-${String(index + 1).padStart(4, "0")}.jpg`,
);

const state = {
  source: null,
  sourceName: "原图.jpg",
  avatars: [],
  libraryAvatars: [],
  webAvatars: [],
  webStyleBuckets: [],
  customAvatars: [],
  avatarMode: "web",
  avatarOffset: 0,
  themeChoice: "auto",
  detectedTheme: "dark",
  automaticPosition: 28,
  dragging: false,
  dragOffset: 0,
  panelBounds: null,
  existingLikes: null,
  pageBackground: [255, 255, 255],
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
  return clamp(Number.parseInt(likeCount.value, 10) || 0, 0, MAX_LIKE_COUNT);
}

function setLikeCount(value) {
  const normalized = clamp(Number.parseInt(value, 10) || 0, 0, MAX_LIKE_COUNT);
  likeCount.value = normalized;
  likeCountNumber.value = normalized;
  likeCountOutput.value = normalized;
  likeCountOutput.textContent = normalized;
  render();
}

function shuffleInPlace(list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temporary = list[index];
    list[index] = list[swapIndex];
    list[swapIndex] = temporary;
  }
  return list;
}

function interleaveStyleBuckets(buckets) {
  const queues = buckets
    .map((bucket) => ({ style: bucket.style, avatars: bucket.avatars.slice() }))
    .filter((bucket) => bucket.avatars.length > 0);
  for (const bucket of queues) shuffleInPlace(bucket.avatars);

  const result = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const bucket of queues) {
      if (bucket.avatars.length === 0) continue;
      result.push(bucket.avatars.shift());
      progressed = true;
    }
  }
  return result;
}

function arrangeWebAvatars() {
  if (state.webStyleBuckets.length > 0) {
    return interleaveStyleBuckets(state.webStyleBuckets);
  }
  return shuffleInPlace(state.webAvatars.slice());
}

function getTheme() {
  return state.themeChoice === "auto" ? state.detectedTheme : state.themeChoice;
}

function useAvatarMode(mode, notify = false) {
  state.avatarMode = mode;
  state.avatarOffset = 0;
  if (mode === "library") {
    state.avatars = state.libraryAvatars.slice();
    avatarStatus.textContent = `${state.avatars.length} 个内置头像，超出后循环`;
  } else if (mode === "web") {
    state.avatars = arrangeWebAvatars();
    const styleCount = state.webStyleBuckets.length || 1;
    avatarStatus.textContent = `${state.avatars.length} 张缓存头像（${styleCount} 种风格均匀穿插），${MAX_LIKE_COUNT} 以内不重复，可随机换一批`;
  } else if (state.customAvatars.length > 0) {
    state.avatars = state.customAvatars.slice();
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

function colorDelta(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function pixelAt(pixels, width, x, y) {
  const index = (y * width + Math.max(0, Math.min(width - 1, x))) * 4;
  return [pixels[index], pixels[index + 1], pixels[index + 2]];
}

function meanColor(colors) {
  const count = colors.length || 1;
  return [
    Math.round(colors.reduce((sum, color) => sum + color[0], 0) / count),
    Math.round(colors.reduce((sum, color) => sum + color[1], 0) / count),
    Math.round(colors.reduce((sum, color) => sum + color[2], 0) / count),
  ];
}

function sampleLeftStrip(pixels, width, y, leftX0, leftX1) {
  const colors = [];
  const step = Math.max(1, Math.floor((leftX1 - leftX0) / 6) || 1);
  for (let x = leftX0; x < Math.max(leftX0 + 1, leftX1); x += step) {
    colors.push(pixelAt(pixels, width, x, y));
  }
  return meanColor(colors);
}

function samplePageBackground(pixels, width, height) {
  const samples = [];
  const x = Math.max(2, Math.floor(width * 0.012));
  const startY = Math.floor(height * 0.12);
  const endY = Math.max(startY + 1, Math.floor(height * 0.22));
  for (let y = startY; y < endY; y += 2) {
    samples.push(pixelAt(pixels, width, x, y));
  }
  if (samples.length === 0) return [255, 255, 255];
  samples.sort((a, b) => luminance(...a) - luminance(...b));
  return samples[Math.floor(samples.length / 2)];
}

function detectExistingLikePanel(sample, pageBackground) {
  const { context, width, height } = sample;
  const pixels = context.getImageData(0, 0, width, height).data;
  const startY = Math.floor(height * 0.14);
  const endY = Math.floor(height * 0.88);
  const leftX0 = Math.floor(width * 0.036);
  const leftX1 = Math.floor(width * 0.058);
  const avatarX0 = Math.floor(width * 0.125);
  const avatarX1 = Math.floor(width * 0.96);
  const minCell = Math.floor(width * 0.045);
  const maxCell = Math.floor(width * 0.12);
  const edgeStep = Math.max(1, Math.floor(width / 220));
  const isPanelLeft = new Array(height).fill(false);
  const edgeScore = new Array(height).fill(0);
  const cellCount = new Array(height).fill(0);
  const likeRow = new Array(height).fill(false);

  for (let y = startY; y < endY; y += 1) {
    const lefts = [];
    const leftStep = Math.max(1, Math.floor((leftX1 - leftX0) / 6) || 1);
    for (let x = leftX0; x < Math.max(leftX0 + 1, leftX1); x += leftStep) {
      lefts.push(pixelAt(pixels, width, x, y));
    }
    const mean = meanColor(lefts);
    const deltaPage = colorDelta(mean, pageBackground);
    const uniform = Math.max(...lefts.map((color) => colorDelta(color, mean)));
    isPanelLeft[y] = deltaPage >= 8 && uniform <= 28;

    let edges = 0;
    let checked = 0;
    let previous = pixelAt(pixels, width, avatarX0, y);
    for (let x = avatarX0; x < avatarX1; x += edgeStep) {
      const current = pixelAt(pixels, width, x, y);
      if (colorDelta(current, previous) > 70) edges += 1;
      previous = current;
      checked += 1;
    }
    edgeScore[y] = edges / Math.max(1, checked);

    const cellBackground = isPanelLeft[y] ? mean : pageBackground;
    let cells = 0;
    let x = avatarX0;
    while (x < avatarX1) {
      if (colorDelta(pixelAt(pixels, width, x, y), cellBackground) <= 36) {
        x += 1;
        continue;
      }
      const runStart = x;
      while (x < avatarX1 && colorDelta(pixelAt(pixels, width, x, y), cellBackground) > 36) {
        x += 1;
      }
      const runWidth = x - runStart;
      if (runWidth >= minCell && runWidth <= maxCell) cells += 1;
    }
    cellCount[y] = cells;
    likeRow[y] = (isPanelLeft[y] && (edgeScore[y] > 0.05 || cells >= 3)) || cells >= 5;
  }

  const gapTolerance = Math.max(3, Math.floor(width * 0.04));
  const clusters = [];
  for (let y = startY; y < endY; ) {
    if (!likeRow[y]) {
      y += 1;
      continue;
    }
    const clusterStart = y;
    let last = y;
    y += 1;
    while (y < endY && y - last <= gapTolerance) {
      if (likeRow[y]) last = y;
      y += 1;
    }
    clusters.push([clusterStart, last]);
  }

  let best = null;
  let bestScore = 0;
  const minHeight = Math.floor(width * 0.05);
  const maxHeight = Math.floor(height * 0.5);
  const strongThreshold = Math.max(8, Math.round(width * 0.03));

  for (const [clusterStart, clusterEnd] of clusters) {
    let top = clusterStart;
    let bottom = clusterEnd;
    while (top - 1 >= startY && isPanelLeft[top - 1]) top -= 1;
    while (bottom + 1 < endY && isPanelLeft[bottom + 1]) bottom += 1;
    while (top - 1 >= startY) {
      const mean = sampleLeftStrip(pixels, width, top - 1, leftX0, leftX1);
      const delta = colorDelta(mean, pageBackground);
      if (delta >= 3 && delta < 10) top -= 1;
      else break;
    }
    while (bottom + 1 < endY) {
      const mean = sampleLeftStrip(pixels, width, bottom + 1, leftX0, leftX1);
      const delta = colorDelta(mean, pageBackground);
      if (delta >= 3 && delta < 10) bottom += 1;
      else break;
    }

    const panelHeight = bottom - top + 1;
    if (panelHeight < minHeight || panelHeight > maxHeight) continue;

    let avatarSum = 0;
    let strong = 0;
    for (let y = top; y <= bottom; y += 1) {
      avatarSum += cellCount[y];
      if (cellCount[y] >= 4 || edgeScore[y] > 0.08) strong += 1;
    }
    const score = avatarSum + strong * 10;
    if (strong >= strongThreshold && score > bestScore) {
      bestScore = score;
      best = [top, bottom];
    }
  }

  if (!best) return null;

  const [top, bottom] = best;
  const midY = top + Math.max(2, Math.floor((bottom - top) / 10));
  let left = Math.floor(width * 0.008);
  let right = width - Math.floor(width * 0.008);
  while (left < Math.floor(width * 0.12) && colorDelta(pixelAt(pixels, width, left, midY), pageBackground) < 6) {
    left += 1;
  }
  while (right > Math.floor(width * 0.88) && colorDelta(pixelAt(pixels, width, right, midY), pageBackground) < 6) {
    right -= 1;
  }

  const pad = Math.max(2, Math.round(width * 0.008));
  const scaleX = state.source.naturalWidth / width;
  const scaleY = state.source.naturalHeight / height;
  const x = Math.max(0, Math.round((left - pad) * scaleX));
  const y = Math.max(0, Math.round((top - pad) * scaleY));
  return {
    x,
    y,
    width: Math.min(state.source.naturalWidth - x, Math.round((right - left + 1 + pad * 2) * scaleX)),
    height: Math.min(state.source.naturalHeight - y, Math.round((bottom - top + 1 + pad * 2) * scaleY)),
  };
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
  state.pageBackground = samplePageBackground(pixels, width, height);
  state.existingLikes = detectExistingLikePanel(sample, state.pageBackground);

  if (state.existingLikes) {
    const sourceY = clamp(state.existingLikes.y / state.source.naturalHeight * 100, 18, 70);
    state.automaticPosition = Number(sourceY.toFixed(1));
    positionRange.value = state.automaticPosition;
    return;
  }

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
  if (state.existingLikes) {
    const [red, green, blue] = state.pageBackground;
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillRect(
      state.existingLikes.x,
      state.existingLikes.y,
      state.existingLikes.width,
      state.existingLikes.height,
    );
  }

  const count = getLikeCount();
  if (count === 0) {
    state.panelBounds = null;
    return;
  }

  const layout = calculateLayout(count);
  const theme = getTheme();
  const panelColor = theme === "dark" ? "rgb(34, 34, 34)" : "rgb(247, 247, 247)";
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
  if (state.existingLikes) {
    sourceStatus.textContent = `${name} · 保留原图主题与尺寸 · 已抹去原有点赞`;
    showToast("已抹去原有点赞并按当前数量重绘");
  }
  render();
}

function showSourcePickerPrompt(message = "尚未选择截图") {
  state.source = null;
  state.sourceName = "";
  state.existingLikes = null;
  state.panelBounds = null;
  state.pageBackground = [255, 255, 255];
  sourceStatus.textContent = message;
  imageDimensions.textContent = "-- × --";
  detectedTheme.textContent = state.themeChoice === "auto"
    ? "自动"
    : state.themeChoice === "dark" ? "深色" : "浅色";
  emptyState.hidden = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

function clearSource() {
  sourceInput.value = "";
  showSourcePickerPrompt("尚未选择截图");
  showToast("已清除图片");
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

function hasFilePayload(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function isSourceImageFile(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png" || type === "image/webp") {
    return true;
  }
  return /\.(jpe?g|png|webp)$/i.test(file.name || "");
}

function pickSourceFile(fileList) {
  return Array.from(fileList || []).find(isSourceImageFile) || null;
}

async function applySourceFile(file) {
  if (!isSourceImageFile(file)) {
    showToast("请选择或拖入 JPG、PNG 或 WebP 图片");
    return;
  }
  try {
    const [image] = await filesToImages([file]);
    await setSource(image, file.name || "截图.jpg");
  } catch (error) {
    showToast("图片无法读取，请换一张再试");
  }
}

function setFileDragging(active) {
  document.body.classList.toggle("is-file-dragging", active);
}

async function loadAvatarLibraries() {
  const [avatars, webImages, manifest] = await Promise.all([
    Promise.all(avatarNames.map((name) => loadImage(name).catch(() => null))),
    Promise.all(webAvatarNames.map((name) => loadImage(name).catch(() => null))),
    fetch("assets/web-avatars/sources.json").then((response) => response.json()).catch(() => null),
  ]);

  state.libraryAvatars = avatars.filter(Boolean);
  state.webAvatars = webImages.filter(Boolean);

  const imagesByFile = new Map();
  webAvatarNames.forEach((name, index) => {
    const image = webImages[index];
    if (image) imagesByFile.set(name.split("/").pop(), image);
  });

  if (manifest?.files?.length) {
    const bucketMap = new Map();
    for (const entry of manifest.files) {
      const image = imagesByFile.get(entry.file);
      if (!image) continue;
      if (!bucketMap.has(entry.style)) bucketMap.set(entry.style, []);
      bucketMap.get(entry.style).push(image);
    }
    const styleOrder = manifest.keywords?.length
      ? manifest.keywords
      : [...bucketMap.keys()];
    state.webStyleBuckets = styleOrder
      .map((style) => ({ style, avatars: bucketMap.get(style) || [] }))
      .filter((bucket) => bucket.avatars.length > 0);
  } else {
    state.webStyleBuckets = [];
  }

  useAvatarMode("web");
}

async function loadDefaults() {
  sourceStatus.textContent = "正在准备头像库...";
  try {
    await loadAvatarLibraries();
  } catch (error) {
    avatarStatus.textContent = "头像库载入失败，可改用上传头像";
  }

  try {
    const source = await loadImage("原图.jpg");
    await setSource(source, "原图.jpg");
  } catch (error) {
    showSourcePickerPrompt("请选择一张朋友圈截图开始");
  }
}

sourceInput.addEventListener("change", async () => {
  const [file] = sourceInput.files;
  if (!file) return;
  await applySourceFile(file);
});

let fileDragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  setFileDragging(true);
});
window.addEventListener("dragover", (event) => {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (event) => {
  if (!hasFilePayload(event)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  const outside = event.clientX <= 0 || event.clientY <= 0
    || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
  if (fileDragDepth === 0 || outside) {
    fileDragDepth = 0;
    setFileDragging(false);
  }
});
window.addEventListener("drop", async (event) => {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  setFileDragging(false);
  await applySourceFile(pickSourceFile(event.dataTransfer.files));
});

document.querySelector("#clearSourceButton").addEventListener("click", () => {
  clearSource();
});

document.querySelector("#emptyPickButton").addEventListener("click", () => {
  sourceInput.click();
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
  if (state.avatars.length <= 1) return;
  if (state.avatarMode === "web") {
    state.avatars = arrangeWebAvatars();
  } else {
    shuffleInPlace(state.avatars);
  }
  state.avatarOffset = 0;
  render();
  showToast(state.avatarMode === "web" ? "已按风格重新均匀穿插" : "头像顺序已更新");
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
