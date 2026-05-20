import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "public");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const youtubeApiBase = "https://www.googleapis.com/youtube/v3";
const allowedYoutubeResources = new Set([
  "channels",
  "playlistItems",
  "playlists",
  "search",
  "videos"
]);
const defaultAdminUsername = "jsg301";
const defaultAdminPasswordHash = "0168cc4c84698915ea5da286f48fab53:be665ab29c0a58b94f95d5fcab7301b20573c5eb8c61d373ff4675eb883d9c5f";
const sessionCookieName = "fp_admin_session";
const adminSessions = new Map();
const channelPopularCache = new Map();
const channelPopularCacheTtlMs = 1000 * 60 * 20;

loadLocalEnv();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(html);
}

function loadLocalEnv() {
  const envPath = getLocalEnvPath();

  if (!existsSync(envPath)) {
    return;
  }

  const envText = readFileSync(envPath, "utf8");
  envText.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function getLocalEnvPath() {
  return resolve(__dirname, ".env.local");
}

function readLocalEnvLines() {
  const envPath = getLocalEnvPath();
  if (!existsSync(envPath)) {
    return [];
  }

  return readFileSync(envPath, "utf8").split(/\r?\n/);
}

function writeLocalEnvLines(lines) {
  const normalized = lines.filter((line, index) => line || index < lines.length - 1);
  writeFileSync(getLocalEnvPath(), `${normalized.join("\n")}\n`, "utf8");
}

function upsertLocalEnvValue(key, value) {
  const lines = readLocalEnvLines();
  const nextLine = `${key}=${value}`;
  const existingIndex = lines.findIndex((line) => line.trim().startsWith(`${key}=`));

  if (existingIndex >= 0) {
    lines[existingIndex] = nextLine;
  } else {
    lines.push(nextLine);
  }

  writeLocalEnvLines(lines);
  process.env[key] = value;
}

function deleteLocalEnvValue(key) {
  const lines = readLocalEnvLines().filter((line) => !line.trim().startsWith(`${key}=`));
  writeLocalEnvLines(lines);
  delete process.env[key];
}

async function proxyYoutubeRequest(req, res, resource) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    sendJson(res, 400, { error: "Server API key is not configured" });
    return;
  }

  if (!allowedYoutubeResources.has(resource)) {
    sendJson(res, 404, { error: "Unknown YouTube resource" });
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://localhost:${port}`);
  requestUrl.searchParams.set("key", apiKey);

  const upstreamUrl = `${youtubeApiBase}/${resource}?${requestUrl.searchParams}`;
  const upstream = await fetch(upstreamUrl, {
    headers: { accept: "application/json" }
  });
  const body = await upstream.text();

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function youtubeApiGet(resource, params) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error("Server API key is not configured");
  }

  const requestParams = new URLSearchParams(params);
  requestParams.set("key", apiKey);
  const upstreamUrl = `${youtubeApiBase}/${resource}?${requestParams}`;
  const upstream = await fetch(upstreamUrl, {
    headers: { accept: "application/json" }
  });
  const data = await upstream.json();

  if (!upstream.ok) {
    const message = data?.error?.message || data?.error || "YouTube API request failed";
    const error = new Error(message);
    error.statusCode = upstream.status;
    error.payload = data;
    throw error;
  }

  return data;
}

async function handleChannelPopular(req, res) {
  if (!process.env.YOUTUBE_API_KEY) {
    sendJson(res, 400, { error: "Server API key is not configured" });
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const playlistId = String(url.searchParams.get("playlistId") || "").trim();
  const page = clampNumber(Number(url.searchParams.get("page") || 1), 1, 10_000);
  const pageSize = clampNumber(Number(url.searchParams.get("pageSize") || 10), 1, 50);
  const excludeShorts = url.searchParams.get("excludeShorts") === "1";

  if (!/^[a-zA-Z0-9_-]+$/.test(playlistId)) {
    sendJson(res, 400, { error: "Invalid playlistId" });
    return;
  }

  const archive = await getPopularChannelArchive(playlistId);
  const visibleVideos = excludeShorts
    ? archive.videos.filter((video) => !isUnderOneMinuteVideo(video))
    : archive.videos;
  const totalResults = visibleVideos.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;

  sendJson(res, 200, {
    items: visibleVideos.slice(start, start + pageSize),
    page: currentPage,
    pageSize,
    totalResults,
    totalPages,
    sourceTotalResults: archive.sourceTotalResults,
    generatedAt: archive.generatedAt
  });
}

async function getPopularChannelArchive(playlistId) {
  const now = Date.now();
  const cached = channelPopularCache.get(playlistId);

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = loadPopularChannelArchive(playlistId)
    .then((value) => {
      channelPopularCache.set(playlistId, {
        value,
        expiresAt: Date.now() + channelPopularCacheTtlMs
      });
      return value;
    })
    .catch((error) => {
      channelPopularCache.delete(playlistId);
      throw error;
    });

  channelPopularCache.set(playlistId, { promise });
  return promise;
}

async function loadPopularChannelArchive(playlistId) {
  const uploadItems = [];
  const seenIds = new Set();
  let pageToken = "";
  let sourceTotalResults = 0;
  let guard = 0;

  do {
    const data = await youtubeApiGet("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
      fields: "nextPageToken,pageInfo/totalResults,items(contentDetails/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url,snippet/thumbnails/high/url)"
    });

    sourceTotalResults = data.pageInfo?.totalResults || sourceTotalResults;
    for (const item of data.items || []) {
      const videoId = item.contentDetails?.videoId;
      if (videoId && !seenIds.has(videoId)) {
        seenIds.add(videoId);
        uploadItems.push(item);
      }
    }

    pageToken = data.nextPageToken || "";
    guard += 1;
  } while (pageToken && guard < 200);

  const chunks = [];
  for (let index = 0; index < uploadItems.length; index += 50) {
    chunks.push(uploadItems.slice(index, index + 50));
  }

  const detailEntries = await mapWithConcurrency(chunks, 8, async (chunk) => {
    const ids = chunk.map((item) => item.contentDetails?.videoId).filter(Boolean);
    if (!ids.length) {
      return [];
    }

    const data = await youtubeApiGet("videos", {
      part: "contentDetails,statistics,status",
      id: ids.join(","),
      fields: "items(id,contentDetails/duration,statistics/viewCount,status/embeddable)"
    });
    return data.items || [];
  });

  const detailsById = new Map(detailEntries.flat().map((item) => [item.id, item]));
  const videos = uploadItems
    .map((item) => toPopularVideo(item, detailsById.get(item.contentDetails?.videoId)))
    .filter((video) => video.id && video.embeddable)
    .sort((a, b) => b.viewCount - a.viewCount);

  return {
    videos,
    sourceTotalResults: sourceTotalResults || uploadItems.length,
    generatedAt: new Date().toISOString()
  };
}

function toPopularVideo(item, details) {
  const duration = details?.contentDetails?.duration || "";
  const seconds = durationToSeconds(duration);

  return {
    id: item.contentDetails?.videoId || "",
    type: "video",
    title: decodeHtmlEntities(item.snippet?.title || ""),
    channel: decodeHtmlEntities(item.snippet?.channelTitle || ""),
    publishedAt: item.snippet?.publishedAt || "",
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.high?.url || "",
    duration: formatDuration(duration),
    seconds,
    viewCount: Number(details?.statistics?.viewCount || 0),
    views: formatViews(details?.statistics?.viewCount),
    embeddable: details?.status?.embeddable !== false
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isUnderOneMinuteVideo(video) {
  return Number(video.seconds || 0) > 0 && Number(video.seconds || 0) < 60;
}

function formatDuration(value) {
  const seconds = durationToSeconds(value);
  if (!seconds) {
    return "";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = hours > 0 ? [hours, minutes, remainder] : [minutes, remainder];
  return parts.map((part) => String(part).padStart(2, "0")).join(":").replace(/^0/, "");
}

function durationToSeconds(value) {
  const match = value?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) {
    return 0;
  }

  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function formatViews(value) {
  const views = Number(value || 0);
  if (!views) {
    return "조회수 정보 없음";
  }

  return `조회수 ${new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(views)}`;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function getAdminUsername() {
  return process.env.ADMIN_USERNAME || defaultAdminUsername;
}

function getAdminPasswordHash() {
  return process.env.ADMIN_PASSWORD_HASH || defaultAdminPasswordHash;
}

function verifyPassword(password, storedValue) {
  const [salt, expectedHash] = String(storedValue || "").split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const actual = pbkdf2Sync(password, salt, 310000, 32, "sha256");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf("=");
        return [
          decodeURIComponent(cookie.slice(0, separatorIndex)),
          decodeURIComponent(cookie.slice(separatorIndex + 1))
        ];
      })
  );
}

function getAdminSession(req) {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) {
    return null;
  }

  const session = adminSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }

  return session;
}

function createAdminSession(res) {
  const token = randomBytes(32).toString("hex");
  const maxAgeSeconds = 60 * 60 * 8;
  adminSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + maxAgeSeconds * 1000
  });
  res.setHeader(
    "set-cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`
  );
}

function clearAdminSession(req, res) {
  const token = parseCookies(req)[sessionCookieName];
  if (token) {
    adminSessions.delete(token);
  }
  res.setHeader(
    "set-cookie",
    `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) {
      throw new Error("Request body too large");
    }
  }
  return body;
}

async function handleAdminLogin(req, res) {
  const body = await readBody(req);
  const form = new URLSearchParams(body);
  const username = form.get("username") || "";
  const password = form.get("password") || "";

  if (username === getAdminUsername() && verifyPassword(password, getAdminPasswordHash())) {
    createAdminSession(res);
    res.writeHead(303, { location: "/admin" });
    res.end();
    return;
  }

  res.writeHead(303, { location: "/admin?error=1" });
  res.end();
}

function handleAdminLogout(req, res) {
  clearAdminSession(req, res);
  res.writeHead(303, { location: "/admin" });
  res.end();
}

async function handleAdminApiKeySave(req, res) {
  if (!getAdminSession(req)) {
    res.writeHead(303, { location: "/admin" });
    res.end();
    return;
  }

  const body = await readBody(req);
  const form = new URLSearchParams(body);
  const apiKey = String(form.get("youtubeApiKey") || "").trim();

  if (!apiKey) {
    res.writeHead(303, { location: "/admin?apiError=empty" });
    res.end();
    return;
  }

  if (/[\r\n]/.test(apiKey)) {
    res.writeHead(303, { location: "/admin?apiError=invalid" });
    res.end();
    return;
  }

  upsertLocalEnvValue("YOUTUBE_API_KEY", apiKey);
  res.writeHead(303, { location: "/admin?saved=1" });
  res.end();
}

function handleAdminApiKeyDelete(req, res) {
  if (!getAdminSession(req)) {
    res.writeHead(303, { location: "/admin" });
    res.end();
    return;
  }

  deleteLocalEnvValue("YOUTUBE_API_KEY");
  res.writeHead(303, { location: "/admin?deleted=1" });
  res.end();
}

function renderAdminLogin(req) {
  const url = new URL(req.url || "/admin", `http://localhost:${port}`);
  const hasError = url.searchParams.get("error") === "1";
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>관리자 로그인 | Focus Player</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="admin-shell">
      <section class="admin-card" aria-labelledby="adminLoginTitle">
        <p class="admin-kicker">Focus Player</p>
        <h1 id="adminLoginTitle">관리자 로그인</h1>
        ${hasError ? '<p class="admin-error">ID 또는 패스워드가 올바르지 않습니다.</p>' : ""}
        <form class="admin-form" method="post" action="/admin/login">
          <label for="username">관리자 ID</label>
          <input id="username" name="username" autocomplete="username" required />
          <label for="password">패스워드</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit">로그인</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function maskSecret(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 10) {
    return "설정됨";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function renderAdminPage(req) {
  const url = new URL(req.url || "/admin", `http://localhost:${port}`);
  const hasYouTubeKey = Boolean(process.env.YOUTUBE_API_KEY);
  const statusMessage = (() => {
    if (url.searchParams.get("saved") === "1") {
      return '<p class="admin-success">YouTube API 키를 저장했습니다.</p>';
    }
    if (url.searchParams.get("deleted") === "1") {
      return '<p class="admin-success">YouTube API 키를 삭제했습니다.</p>';
    }
    if (url.searchParams.get("apiError") === "empty") {
      return '<p class="admin-error">저장할 API 키를 입력하세요.</p>';
    }
    if (url.searchParams.get("apiError") === "invalid") {
      return '<p class="admin-error">API 키 형식이 올바르지 않습니다.</p>';
    }
    return "";
  })();

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>관리자 페이지 | Focus Player</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="admin-shell">
      <section class="admin-card" aria-labelledby="adminTitle">
        <p class="admin-kicker">Focus Player</p>
        <h1 id="adminTitle">관리자 페이지</h1>
        ${statusMessage}
        <div class="admin-status">
          <span>YouTube API</span>
          <strong>${hasYouTubeKey ? maskSecret(process.env.YOUTUBE_API_KEY) : "미설정"}</strong>
        </div>
        <form class="admin-form" method="post" action="/admin/api-key">
          <label for="youtubeApiKey">YouTube API 키</label>
          <input id="youtubeApiKey" name="youtubeApiKey" type="password" autocomplete="off" placeholder="AIza..." />
          <button type="submit">API 키 저장</button>
        </form>
        <form method="post" action="/admin/api-key/delete">
          <button class="secondary-button" type="submit" ${hasYouTubeKey ? "" : "disabled"}>API 키 삭제</button>
        </form>
        <form method="post" action="/admin/logout">
          <button class="secondary-button" type="submit">로그아웃</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

async function getStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    return null;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return null;
  }

  return filePath;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const requestPath = new URL(req.url || "/", `http://localhost:${port}`).pathname;

    if (method === "GET" && requestPath === "/admin") {
      sendHtml(res, 200, getAdminSession(req) ? renderAdminPage(req) : renderAdminLogin(req));
      return;
    }

    if (method === "POST" && requestPath === "/admin/login") {
      await handleAdminLogin(req, res);
      return;
    }

    if (method === "POST" && requestPath === "/admin/logout") {
      handleAdminLogout(req, res);
      return;
    }

    if (method === "POST" && requestPath === "/admin/api-key") {
      await handleAdminApiKeySave(req, res);
      return;
    }

    if (method === "POST" && requestPath === "/admin/api-key/delete") {
      handleAdminApiKeyDelete(req, res);
      return;
    }

    if (req.url === "/api/config") {
      sendJson(res, 200, { hasServerKey: Boolean(process.env.YOUTUBE_API_KEY) });
      return;
    }

    if (method === "GET" && requestPath === "/api/channel-popular") {
      await handleChannelPopular(req, res);
      return;
    }

    const apiMatch = req.url?.match(/^\/api\/youtube\/([^?]+)/);
    if (apiMatch) {
      await proxyYoutubeRequest(req, res, apiMatch[1]);
      return;
    }

    const filePath = await getStaticPath(req.url || "/");
    if (!filePath) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const type = mimeTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store"
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Focus YouTube Player running at http://localhost:${port}`);

  for (const url of getNetworkUrls()) {
    console.log(`Mobile access on the same Wi-Fi: ${url}`);
  }
});

function getNetworkUrls() {
  if (host === "127.0.0.1" || host === "localhost") {
    return [];
  }

  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}
