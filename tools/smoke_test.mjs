import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const browserPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profilePath = await mkdtemp(path.join(os.tmpdir(), "likes-smoke-"));
const port = 9327;

const browser = spawn(browserPath, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-breakpad",
  "--disable-crash-reporter",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  "http://127.0.0.1:8765/",
], { stdio: "ignore" });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((entry) => entry.type === "page" && entry.url.includes("127.0.0.1:8765"));
      if (page) return page;
    } catch {
      // Browser startup is still in progress.
    }
    await delay(250);
  }
  throw new Error("Browser page did not become available");
}

function openCdp(url) {
  const socket = new WebSocket(url);
  let requestId = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      requestId += 1;
      const id = requestId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    const details = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    throw new Error(details);
  }
  return response.result.value;
}

try {
  const page = await findPage();
  const client = openCdp(page.webSocketDebuggerUrl);
  await client.ready;

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ready = await evaluate(client, "document.querySelector('#sourceStatus')?.textContent.includes('保留原图主题与尺寸')");
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new Error("Default source or avatars did not load");

  const result = await evaluate(client, `(() => {
    const canvas = document.querySelector("#previewCanvas");
    const range = document.querySelector("#likeCount");
    const setCount = (count) => {
      range.value = count;
      range.dispatchEvent(new Event("input", { bubbles: true }));
      return canvas.toDataURL("image/jpeg", 0.94).length;
    };
    const cases = [0, 20, 99].map((count) => ({ count, exportLength: setCount(count) }));
    const exportLength = setCount(20);
    const defaultAvatarLabel = document.querySelector("#avatarStatus").textContent;
    const mode = document.querySelector("#avatarMode");
    mode.value = "web";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    setCount(99);
    const webAvatars = {
      status: document.querySelector("#avatarStatus").textContent,
      exportLength: canvas.toDataURL("image/jpeg", 0.94).length,
    };
    return {
      dimensions: [canvas.width, canvas.height],
      themeLabel: document.querySelector("#detectedTheme").textContent,
      avatarLabel: defaultAvatarLabel,
      position: Number(document.querySelector("#positionRange").value),
      exportLength,
      cases,
      loadingHidden: document.querySelector("#emptyState").hidden,
      webAvatars,
    };
  })()`);

  const assertions = [
    [result.dimensions[0] === 1320 && result.dimensions[1] === 2848, "canvas preserves source dimensions"],
    [result.themeLabel.includes("深色"), "dark theme is detected"],
    [result.avatarLabel.includes("99") && result.avatarLabel.includes("网络"), "all cached web avatars load"],
    [result.position >= 26 && result.position <= 31, "like panel is positioned after the post metadata"],
    [result.exportLength > 100000, "JPEG export contains rendered image data"],
    [result.cases[1].exportLength > result.cases[0].exportLength, "twenty likes renders the panel"],
    [result.cases[2].exportLength > result.cases[1].exportLength, "ninety-nine likes render additional rows"],
    [result.loadingHidden === true, "loading state is hidden after render"],
    [result.webAvatars.status.includes("99") && result.webAvatars.status.includes("不重复"), "web avatar mode has 99 unique entries"],
    [result.webAvatars.exportLength > result.exportLength, "cached web avatars render into export"],
  ];

  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(200);
  const mobileLayout = await evaluate(client, `({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    headerWidth: Math.round(document.querySelector(".app-header").getBoundingClientRect().width),
    controlsWidth: Math.round(document.querySelector(".controls").getBoundingClientRect().width),
  })`);
  assertions.push([
    mobileLayout.documentWidth <= mobileLayout.viewportWidth,
    "mobile layout has no horizontal overflow",
  ]);

  for (const [passed, description] of assertions) {
    if (!passed) throw new Error(`Failed: ${description}\n${JSON.stringify(result, null, 2)}`);
    console.log(`PASS ${description}`);
  }
  console.log(JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ mobileLayout }, null, 2));

  if (process.argv.includes("--write-output")) {
    await evaluate(client, `(() => {
      const range = document.querySelector("#likeCount");
      range.value = 20;
      range.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const dataUrl = await evaluate(client, "document.querySelector('#previewCanvas').toDataURL('image/jpeg', 0.94)");
    const outputPath = path.join(root, "生成结果.jpg");
    await writeFile(outputPath, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`WROTE ${outputPath}`);
  }
  client.close();
} finally {
  browser.kill();
  await delay(1000);
  await rm(profilePath, { recursive: true, force: true }).catch(() => {});
}
