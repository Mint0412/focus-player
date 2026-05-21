const storageKey = "focus-youtube-player-api-key";
const themeStorageKey = "focus-youtube-player-theme";
const pageSize = {
  channels: 5,
  videos: 20,
  channelVideos: 10,
  channelPlaylists: 10,
  channelShorts: 10,
  playlistVideos: 10
};
const channelSearchFetchSize = 25;
const hiddenUnlessExactChannelNames = [
  "최욱의 매불쇼"
];
const channelVideoSortOptions = [
  ["latest", "최신순"],
  ["popular", "인기순"],
  ["date", "날짜순"]
];
const uploadArchivePageSize = 50;

const state = {
  apiKey: "",
  usingServerKey: false,
  theme: "light",
  player: null,
  selectedVideo: null,
  selectedChannel: null,
  lastResults: { channels: [], videos: [] },
  search: createEmptySearchState(),
  channelView: createEmptyChannelViewState(),
  sessionStartedAt: Date.now(),
  timerId: null
};

const els = {
  homeButton: document.querySelector("#homeButton"),
  themeToggle: document.querySelector("#themeToggle"),
  clearResultsButton: document.querySelector("#clearResultsButton"),
  urlForm: document.querySelector("#urlForm"),
  videoUrlInput: document.querySelector("#videoUrlInput"),
  searchForm: document.querySelector("#searchForm"),
  queryInput: document.querySelector("#queryInput"),
  searchButton: document.querySelector("#searchButton"),
  playerMount: document.querySelector("#playerMount"),
  finishButton: document.querySelector("#finishButton"),
  resultsTitle: document.querySelector("#resultsTitle"),
  resultsList: document.querySelector("#resultsList"),
  resultCount: document.querySelector("#resultCount"),
  pagination: document.querySelector("#pagination"),
  statusMessage: document.querySelector("#statusMessage"),
  sessionTime: document.querySelector("#sessionTime")
};

window.onYouTubeIframeAPIReady = () => {
  window.youtubeIframeReady = true;
};

init();

async function init() {
  hydrateTheme();
  startTimer();
  await hydrateApiKey();
  bindEvents();
  updateSearchState();
}

function bindEvents() {
  els.homeButton.addEventListener("click", resetAppToHome);
  els.themeToggle.addEventListener("change", toggleTheme);
  els.clearResultsButton.addEventListener("click", resetResults);
  els.urlForm.addEventListener("submit", handleUrlPlay);
  els.searchForm.addEventListener("submit", handleSearch);
  els.finishButton.addEventListener("click", finishViewing);
}

function createEmptySearchState() {
  return {
    active: false,
    query: "",
    duration: "any",
    currentPage: 1,
    loadingPage: 0,
    pages: {},
    tokens: {
      channels: [""],
      videos: [""]
    },
    totalResults: {
      channels: 0,
      videos: 0
    },
    exhausted: {
      channels: false,
      videos: false
    }
  };
}

function createEmptyPagerState() {
  return {
    currentPage: 1,
    loadingPage: 0,
    pages: {},
    buffer: [],
    tokens: [""],
    totalResults: 0,
    exhausted: false
  };
}

function createEmptyUploadArchiveState() {
  return {
    items: [],
    popularVideos: null,
    popularVideosWithoutShorts: null,
    videosWithoutShorts: null,
    nextPageToken: "",
    totalResults: 0,
    complete: false,
    loadingPromise: null
  };
}

function createEmptyChannelViewState() {
  return {
    active: false,
    mode: "",
    tab: "",
    sort: "latest",
    excludeShortVideos: false,
    channel: null,
    playlist: null,
    uploadArchive: createEmptyUploadArchiveState(),
    pager: createEmptyPagerState()
  };
}

function hydrateTheme() {
  const storedTheme = localStorage.getItem(themeStorageKey);
  const theme = storedTheme === "dark" ? "dark" : "light";
  applyTheme(theme);
}

function toggleTheme() {
  applyTheme(els.themeToggle.checked ? "dark" : "light");
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "only light";
  document.body.style.colorScheme = theme === "dark" ? "dark" : "only light";
  els.themeToggle.checked = theme === "dark";
  updateColorSchemeMeta(theme);
  localStorage.setItem(themeStorageKey, theme);
}

function updateColorSchemeMeta(theme) {
  const colorScheme = theme === "dark" ? "dark" : "light";
  document
    .querySelectorAll('meta[name="color-scheme"], meta[name="supported-color-schemes"]')
    .forEach((meta) => {
      meta.setAttribute("content", colorScheme);
    });
}

async function hydrateApiKey() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    if (config.hasServerKey) {
      state.usingServerKey = true;
      localStorage.removeItem(storageKey);
      setStatus("검색어를 입력하면 시작할 수 있습니다.", "success");
      return;
    }
  } catch {
    state.usingServerKey = false;
  }

  localStorage.removeItem(storageKey);
  setStatus("서버 API 키가 설정되어 있지 않습니다.", "error");
}

function updateSearchState() {
  els.searchButton.disabled = false;
}

function getCurrentKey() {
  return "";
}

async function handleSearch(event) {
  event.preventDefault();
  const key = getCurrentKey();
  const query = els.queryInput.value.trim();
  const duration = normalizeDurationFilter(new FormData(els.searchForm).get("duration"));

  if (!state.usingServerKey) {
    setStatus("서버 API 키가 설정되어 있지 않습니다.", "error");
    return;
  }

  if (!query) {
    setStatus("검색어를 입력하세요.", "error");
    return;
  }

  state.apiKey = key;
  state.selectedChannel = null;
  state.channelView = createEmptyChannelViewState();
  state.search = createEmptySearchState();
  state.search.active = true;
  state.search.query = query;
  state.search.duration = duration;
  els.searchButton.disabled = true;
  els.clearResultsButton.disabled = true;
  els.resultsTitle.textContent = "검색 결과";
  stopPlaybackForSearch();
  setStatus("검색 중입니다.");
  clearResults();

  try {
    const { channels, videos } = await getSearchPage(1);

    if (!videos.length && !channels.length) {
      setStatus("검색 결과가 없습니다.");
      renderPagination();
      return;
    }

    state.lastResults = { channels, videos };
    renderMixedResults({ channels, videos }, 1);
    setStatus("영상을 선택하면 플레이어 화면으로 전환됩니다. 채널은 해당 채널 안의 콘텐츠만 봅니다.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "검색 중 문제가 생겼습니다.", "error");
  } finally {
    updateSearchState();
    updateClearResultsState();
  }
}

async function youtubeGet(resource, params, key = getCurrentKey()) {
  const requestParams = new URLSearchParams(params);
  const url = `/api/youtube/${resource}?${requestParams}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data));
  }

  return data;
}

async function handleUrlPlay(event) {
  event.preventDefault();

  if (!state.usingServerKey) {
    setStatus("서버 API 키가 설정되어 있지 않습니다.", "error");
    return;
  }

  const videoId = extractYouTubeVideoId(els.videoUrlInput.value);
  if (!videoId) {
    setStatus("올바른 유튜브 영상 URL을 입력하세요.", "error");
    return;
  }

  els.videoUrlInput.blur();
  setStatus("URL 영상을 불러오는 중입니다.");

  try {
    const video = await getVideoById(videoId);
    if (!video?.embeddable) {
      setStatus("이 영상은 외부 재생을 허용하지 않습니다.", "error");
      return;
    }

    playVideo(video);
  } catch (error) {
    setStatus(getErrorText(error), "error");
  }
}

async function getVideoById(videoId) {
  const data = await youtubeGet("videos", {
    part: "snippet,contentDetails,statistics,status",
    id: videoId,
    fields: "items(id,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url,snippet/thumbnails/high/url,contentDetails/duration,statistics/viewCount,status/embeddable)"
  });
  const item = data.items?.[0];

  if (!item) {
    throw new Error("해당 영상을 찾을 수 없습니다.");
  }

  return toVideo({
    id: item.id,
    title: item.snippet?.title,
    channel: item.snippet?.channelTitle,
    publishedAt: item.snippet?.publishedAt,
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.high?.url,
    details: item
  });
}

async function getSearchPage(pageNumber) {
  if (state.search.pages[pageNumber]) {
    state.search.currentPage = pageNumber;
    return state.search.pages[pageNumber];
  }

  for (let page = 1; page <= pageNumber; page += 1) {
    if (!state.search.pages[page]) {
      await fetchSearchPage(page);
    }
  }

  state.search.currentPage = pageNumber;
  return state.search.pages[pageNumber] || { channels: [], videos: [] };
}

async function fetchSearchPage(pageNumber) {
  const key = getCurrentKey();
  const videoToken = state.search.tokens.videos[pageNumber - 1];
  const channelToken = state.search.tokens.channels[pageNumber - 1];
  const canFetchVideos = pageNumber === 1 || Boolean(videoToken);
  const canFetchChannels = pageNumber === 1 || Boolean(channelToken);

  state.search.loadingPage = pageNumber;
  renderPagination();

  const [videoResult, channelResult] = await Promise.all([
    canFetchVideos
      ? searchVideosForDurationPage({
        key,
        query: state.search.query,
        duration: state.search.duration,
        pageToken: videoToken
      })
      : Promise.resolve({ videos: [], nextPageToken: "", totalResults: state.search.totalResults.videos }),
    canFetchChannels
      ? searchChannels({
        key,
        query: state.search.query,
        pageToken: channelToken
      })
      : Promise.resolve({ items: [], nextPageToken: "", totalResults: state.search.totalResults.channels })
  ]);

  state.search.tokens.videos[pageNumber] = videoResult.nextPageToken || "";
  state.search.tokens.channels[pageNumber] = channelResult.nextPageToken || "";
  state.search.exhausted.videos = !videoResult.nextPageToken;
  state.search.exhausted.channels = !channelResult.nextPageToken;
  state.search.totalResults.videos = videoResult.totalResults || state.search.totalResults.videos;
  state.search.totalResults.channels = channelResult.totalResults || state.search.totalResults.channels;

  const channelDetailsById = await getChannelDetails({
    key,
    ids: channelResult.items.map((item) => item.id.channelId)
  });

  const page = {
    videos: videoResult.videos
      .filter((video) => video.embeddable && !shouldHideNamedChannelTitle(video.channel, state.search.query)),
    channels: channelResult.items
      .map((item) => toChannel(item, channelDetailsById))
      .filter((channel) => isRelevantChannel(channel, state.search.query))
  };

  state.search.pages[pageNumber] = page;
  state.search.loadingPage = 0;
  renderPagination();
  return page;
}

async function searchVideosForDurationPage({ key, query, duration, pageToken = "" }) {
  const durationFilter = normalizeDurationFilter(duration);
  const videos = [];
  let nextToken = pageToken;
  let totalResults = 0;
  let attempts = 0;

  do {
    const result = await searchVideos({
      key,
      query,
      duration: durationFilter,
      pageToken: nextToken
    });
    const detailsById = await getVideoDetails({
      key,
      ids: result.items.map((item) => item.id.videoId)
    });
    const filteredVideos = result.items
      .map((item) => toVideoFromSearch(item, detailsById))
      .filter((video) => matchesDurationFilter(video, durationFilter));

    videos.push(...filteredVideos);
    nextToken = result.nextPageToken;
    totalResults = result.totalResults || totalResults;
    attempts += 1;
  } while (durationFilter !== "any" && videos.length < pageSize.videos && nextToken && attempts < 5);

  return {
    videos: videos.slice(0, pageSize.videos),
    nextPageToken: nextToken,
    totalResults
  };
}

async function searchVideos({ key, query, duration, pageToken = "" }) {
  const apiDuration = getApiDurationForFilter(duration);
  const params = {
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    maxResults: duration === "any" ? String(pageSize.videos) : "50",
    q: query,
    fields: "nextPageToken,pageInfo/totalResults,items(id/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url)"
  };

  if (apiDuration !== "any") {
    params.videoDuration = apiDuration;
  }

  if (pageToken) {
    params.pageToken = pageToken;
  }

  const data = await youtubeGet("search", params, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

async function searchChannels({ key, query, pageToken = "" }) {
  const data = await youtubeGet("search", {
    part: "snippet",
    type: "channel",
    maxResults: String(channelSearchFetchSize),
    q: query,
    ...(pageToken ? { pageToken } : {}),
    fields: "nextPageToken,pageInfo/totalResults,items(id/channelId,snippet/title,snippet/description,snippet/thumbnails/medium/url)"
  }, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

async function searchChannelShortVideos({ key, channelId, pageToken = "" }) {
  const data = await youtubeGet("search", {
    part: "snippet",
    type: "video",
    channelId,
    maxResults: String(pageSize.channelShorts),
    order: "date",
    videoDuration: "short",
    videoEmbeddable: "true",
    ...(pageToken ? { pageToken } : {}),
    fields: "nextPageToken,pageInfo/totalResults,items(id/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url)"
  }, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

async function searchChannelVideos({ key, channelId, order, pageToken = "", maxResults = pageSize.channelVideos }) {
  const data = await youtubeGet("search", {
    part: "snippet",
    type: "video",
    channelId,
    order,
    maxResults: String(maxResults),
    videoEmbeddable: "true",
    ...(pageToken ? { pageToken } : {}),
    fields: "nextPageToken,pageInfo/totalResults,items(id/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url)"
  }, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

async function getVideoDetails({ key, ids }) {
  if (!ids.length) {
    return new Map();
  }

  const data = await youtubeGet("videos", {
    part: "contentDetails,statistics,status",
    id: ids.join(","),
    fields: "items(id,contentDetails/duration,statistics/viewCount,status/embeddable)"
  }, key);

  return new Map((data.items || []).map((item) => [item.id, item]));
}

async function getChannelDetails({ key, ids }) {
  if (!ids.length) {
    return new Map();
  }

  const data = await youtubeGet("channels", {
    part: "snippet,statistics,contentDetails",
    id: ids.join(","),
    fields: "items(id,snippet/title,snippet/description,snippet/customUrl,snippet/publishedAt,snippet/thumbnails/high/url,statistics/subscriberCount,statistics/hiddenSubscriberCount,statistics/videoCount,contentDetails/relatedPlaylists/uploads)"
  }, key);

  return new Map((data.items || []).map((item) => [item.id, item]));
}

async function getUploadItems({ key, playlistId, pageToken = "", maxResults = pageSize.channelVideos }) {
  const data = await youtubeGet("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: String(maxResults),
    ...(pageToken ? { pageToken } : {}),
    fields: "nextPageToken,pageInfo/totalResults,items(contentDetails/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url)"
  }, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

async function getChannelPlaylists({ key, channelId, pageToken = "" }) {
  const data = await youtubeGet("playlists", {
    part: "snippet,contentDetails",
    channelId,
    maxResults: String(pageSize.channelPlaylists),
    ...(pageToken ? { pageToken } : {}),
    fields: "nextPageToken,pageInfo/totalResults,items(id,snippet/title,snippet/description,snippet/publishedAt,snippet/thumbnails/medium/url,contentDetails/itemCount)"
  }, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

async function getPlaylistItems({ key, playlistId, pageToken = "" }) {
  const data = await youtubeGet("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: String(pageSize.playlistVideos),
    ...(pageToken ? { pageToken } : {}),
    fields: "nextPageToken,pageInfo/totalResults,items(contentDetails/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/medium/url)"
  }, key);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: data.nextPageToken || "",
    totalResults: data.pageInfo?.totalResults || 0
  };
}

function toVideoFromSearch(item, detailsById) {
  const videoId = item.id.videoId;
  const details = detailsById.get(videoId);
  return toVideo({
    id: videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails?.medium?.url,
    details
  });
}

function toVideoFromPlaylist(item, detailsById) {
  const videoId = item.contentDetails?.videoId;
  const details = detailsById.get(videoId);
  return toVideo({
    id: videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails?.medium?.url,
    details
  });
}

function toVideo({ id, title, channel, publishedAt, thumbnail, details }) {
  return {
    id,
    type: "video",
    title: decodeHtml(title),
    channel: decodeHtml(channel),
    publishedAt,
    thumbnail: thumbnail || "",
    duration: formatDuration(details?.contentDetails?.duration),
    seconds: durationToSeconds(details?.contentDetails?.duration),
    viewCount: Number(details?.statistics?.viewCount || 0),
    views: formatViews(details?.statistics?.viewCount),
    embeddable: details?.status?.embeddable !== false
  };
}

function toChannel(item, detailsById) {
  const channelId = item.id.channelId || item.id;
  const details = detailsById.get(channelId);
  const snippet = details?.snippet || item.snippet || {};
  const statistics = details?.statistics || {};

  return {
    id: channelId,
    type: "channel",
    title: decodeHtml(snippet.title),
    description: decodeHtml(snippet.description),
    thumbnail: snippet.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || "",
    customUrl: snippet.customUrl || "",
    uploadPlaylistId: details?.contentDetails?.relatedPlaylists?.uploads || "",
    subscribers: statistics.hiddenSubscriberCount ? "구독자 비공개" : formatSubscribers(statistics.subscriberCount),
    videoCount: formatVideoCount(statistics.videoCount)
  };
}

function toPlaylist(item) {
  return {
    id: item.id,
    type: "playlist",
    title: decodeHtml(item.snippet.title),
    description: decodeHtml(item.snippet.description),
    publishedAt: item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails?.medium?.url || "",
    itemCount: Number(item.contentDetails?.itemCount || 0)
  };
}

function normalizeDurationFilter(value) {
  const allowedValues = new Set([
    "any",
    "under1",
    "1to3",
    "4to10",
    "10to15",
    "over20"
  ]);
  return allowedValues.has(value) ? value : "any";
}

function getApiDurationForFilter(value) {
  const duration = normalizeDurationFilter(value);
  if (duration === "under1" || duration === "1to3") {
    return "short";
  }

  if (duration === "4to10" || duration === "10to15") {
    return "medium";
  }

  if (duration === "over20") {
    return "long";
  }

  return "any";
}

function matchesDurationFilter(video, value) {
  const duration = normalizeDurationFilter(value);
  const seconds = Number(video.seconds || 0);

  if (duration === "any") {
    return true;
  }

  if (!seconds) {
    return false;
  }

  if (duration === "under1") {
    return seconds < 60;
  }

  if (duration === "1to3") {
    return seconds >= 60 && seconds < 240;
  }

  if (duration === "4to10") {
    return seconds >= 240 && seconds < 600;
  }

  if (duration === "10to15") {
    return seconds >= 600 && seconds < 900;
  }

  return seconds >= 1200;
}

function isRelevantChannel(channel, query) {
  if (shouldHideNamedChannelTitle(channel.title, query)) {
    return false;
  }

  const queryNorm = normalizeSearchText(query);
  if (!queryNorm) {
    return true;
  }

  const titleNorm = normalizeSearchText(channel.title);
  const customNorm = normalizeSearchText(channel.customUrl);
  const descriptionNorm = normalizeSearchText(channel.description);

  if (titleNorm === queryNorm || titleNorm.includes(queryNorm) || customNorm.includes(queryNorm)) {
    return true;
  }

  const tokens = tokenizeSearchQuery(query);
  if (tokens.length <= 1) {
    return false;
  }

  const titleText = `${titleNorm} ${customNorm}`;
  const hasTitleSignal = tokens.some((token) => titleText.includes(token));
  const everyTokenFound = tokens.every((token) => titleText.includes(token) || descriptionNorm.includes(token));

  return hasTitleSignal && everyTokenFound;
}

function shouldHideNamedChannelTitle(channelTitle, query) {
  const titleNorm = normalizeSearchText(channelTitle);
  const queryNorm = normalizeSearchText(query);

  return hiddenUnlessExactChannelNames.some((channelName) => {
    const blockedNorm = normalizeSearchText(channelName);
    const isBlockedChannel = titleNorm.includes(blockedNorm);
    const isExactSearch = queryNorm === blockedNorm || queryNorm === titleNorm;
    return isBlockedChannel && !isExactSearch;
  });
}

function renderMixedResults({ channels, videos }, pageNumber = state.search.currentPage) {
  if (state.selectedVideo) {
    renderWatchResults({ channels, videos }, pageNumber);
    return;
  }

  renderDiscoveryResults({ channels, videos }, pageNumber);
}

function renderDiscoveryResults({ channels, videos }, pageNumber = state.search.currentPage) {
  const groupedVideos = groupSearchVideos(videos);
  const nodes = [];

  if (groupedVideos.lead.length) {
    nodes.push(createSearchSection(
      "가장 관련 높은 영상",
      groupedVideos.lead.map((video) => createVideoCard(video, { variant: "lead" })),
      "lead-video-list"
    ));
  }

  if (groupedVideos.shorts.length) {
    nodes.push(createShortsSection(groupedVideos.shorts));
  }

  if (channels.length) {
    nodes.push(createSearchSection("채널", channels.map(createChannelCard), "channel-result-list"));
  }

  if (groupedVideos.more.length) {
    nodes.push(createSearchSection(
      groupedVideos.more.length ? "더 많은 영상" : "영상",
      groupedVideos.more.map((video) => createVideoCard(video, { variant: "wide" })),
      "more-video-list"
    ));
  }

  if (!nodes.length && videos.length) {
    nodes.push(createSearchSection(
      "영상",
      videos.map((video) => createVideoCard(video, { variant: "wide" })),
      "more-video-list"
    ));
  }

  els.resultsTitle.textContent = "검색 결과";
  const layout = document.createElement("div");
  layout.className = "search-results-layout";
  layout.replaceChildren(...nodes);
  els.resultsList.replaceChildren(layout);
  els.resultCount.textContent = `${pageNumber}페이지 · ${channels.length + videos.length}개`;
  state.search.currentPage = pageNumber;
  state.lastResults = { channels, videos };
  renderPagination();
  updateClearResultsState();
}

function renderWatchResults({ channels, videos }, pageNumber = state.search.currentPage) {
  const nodes = [];
  const currentVideoId = state.selectedVideo?.id || "";
  const nextVideos = videos.filter((video) => video.id !== currentVideoId);

  if (nextVideos.length) {
    nodes.push(createSectionLabel("다른 검색 결과"));
    nodes.push(...nextVideos.map((video) => createVideoCard(video, { variant: "compact" })));
  }

  if (channels.length) {
    nodes.push(createSectionLabel("채널"));
    nodes.push(...channels.map(createChannelCard));
  }

  els.resultsTitle.textContent = "관련 검색 결과";
  els.resultsList.replaceChildren(...nodes);
  els.resultCount.textContent = `${pageNumber}페이지 · ${nextVideos.length + channels.length}개`;
  state.search.currentPage = pageNumber;
  state.lastResults = { channels, videos };
  renderPagination();
  updateClearResultsState();
}

function groupSearchVideos(videos) {
  const safeVideos = Array.isArray(videos) ? videos : [];
  const leadPool = state.search.duration === "under1"
    ? safeVideos
    : safeVideos.filter((video) => !isSearchShortVideo(video));
  const lead = (leadPool.length ? leadPool : safeVideos).slice(0, 3);
  const leadIds = new Set(lead.map((video) => video.id));
  const shorts = safeVideos.filter((video) => isSearchShortVideo(video) && !leadIds.has(video.id));
  const shortIds = new Set(shorts.map((video) => video.id));
  const more = safeVideos.filter((video) => !leadIds.has(video.id) && !shortIds.has(video.id));

  return { lead, shorts, more };
}

function isSearchShortVideo(video) {
  return isUnderOneMinuteVideo(video);
}

function createSearchSection(title, children, className = "") {
  const section = document.createElement("section");
  section.className = "search-result-section";

  const heading = document.createElement("h3");
  heading.className = "search-section-heading";
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = `search-section-list ${className}`.trim();
  list.replaceChildren(...children);

  section.append(heading, list);
  return section;
}

function createShortsSection(videos) {
  const cards = videos.map((video) => createVideoCard(video, { variant: "short" }));
  return createSearchSection("짧은 영상", cards, "shorts-video-row");
}

function createSectionLabel(text) {
  const label = document.createElement("div");
  label.className = "result-section-label";
  label.textContent = text;
  return label;
}

function renderPagination() {
  const pager = getActivePager();
  if (!pager) {
    els.pagination.replaceChildren();
    return;
  }

  const current = pager.currentPage;
  const totalPages = state.channelView.active ? getChannelPageCount() : getSearchPageCount();
  const start = Math.max(1, Math.min(current - 2, Math.max(1, totalPages - 6)));
  const end = Math.min(totalPages, start + 6);
  const nodes = [];

  nodes.push(createPageButton("이전", Math.max(1, current - 1), current === 1));

  for (let page = start; page <= end; page += 1) {
    nodes.push(createPageButton(String(page), page, false, page === current));
  }

  nodes.push(createPageButton("다음", Math.min(totalPages, current + 1), current >= totalPages));
  els.pagination.replaceChildren(...nodes);
}

function createPageButton(label, pageNumber, disabled = false, active = false) {
  const pager = getActivePager();
  const button = document.createElement("button");
  button.className = `page-button ${active ? "is-active" : ""}`.trim();
  button.type = "button";
  button.textContent = pager?.loadingPage === pageNumber ? "..." : label;
  button.disabled = disabled || Boolean(pager?.loadingPage) || active;
  button.addEventListener("click", () => {
    if (state.channelView.active) {
      goToChannelPage(pageNumber);
    } else {
      goToSearchPage(pageNumber);
    }
  });
  return button;
}

function getActivePager() {
  if (state.channelView.active) {
    return state.channelView.pager;
  }

  return state.search.active ? state.search : null;
}

async function goToSearchPage(pageNumber) {
  try {
    setStatus(`${pageNumber}페이지를 불러오는 중입니다.`);
    const page = await getSearchPage(pageNumber);

    if (!page.channels.length && !page.videos.length) {
      setStatus("더 이상 표시할 검색 결과가 없습니다.");
      renderPagination();
      return;
    }

    renderMixedResults(page, pageNumber);
    setStatus(`${pageNumber}페이지 검색 결과입니다.`, "success");
  } catch (error) {
    state.search.loadingPage = 0;
    renderPagination();
    setStatus(getErrorText(error), "error");
  }
}

function getSearchPageCount() {
  const videoPages = Math.ceil((state.search.totalResults.videos || pageSize.videos) / pageSize.videos);
  const channelPages = Math.ceil((state.search.totalResults.channels || channelSearchFetchSize) / channelSearchFetchSize);
  const estimatedPages = Math.max(1, videoPages, channelPages);
  return Math.min(50, estimatedPages);
}

function getChannelPageCount() {
  const pager = state.channelView.pager;
  const sizeByMode = {
    videos: pageSize.channelVideos,
    playlists: pageSize.channelPlaylists,
    shorts: pageSize.channelShorts,
    playlistVideos: pageSize.playlistVideos
  };
  const size = sizeByMode[state.channelView.mode] || pageSize.channelVideos;
  const estimatedPages = Math.ceil((pager.totalResults || size) / size);
  return Math.max(1, estimatedPages);
}

function createVideoCard(video, options = {}) {
  const variant = typeof options === "object" && options ? options.variant || "" : "";
  const button = document.createElement("button");
  button.className = [
    "result-card",
    "video-card",
    variant ? `is-${variant}-card` : ""
  ].filter(Boolean).join(" ");
  button.type = "button";
  button.addEventListener("click", () => playVideo(video));

  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.src = video.thumbnail;

  const meta = document.createElement("span");
  meta.className = "result-meta";

  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = video.title;

  const channel = document.createElement("span");
  channel.className = "result-channel";
  channel.textContent = video.channel;

  const detail = document.createElement("span");
  detail.className = "result-detail";
  detail.append(
    createTextPill(video.duration || "길이 정보 없음"),
    createTextPill(video.views),
    createTextPill(formatDate(video.publishedAt))
  );

  meta.append(title, channel, detail);
  button.append(image, meta);
  return button;
}

function createChannelCard(channel) {
  const button = document.createElement("button");
  button.className = "result-card channel-card";
  button.type = "button";
  button.addEventListener("click", () => openChannel(channel));

  const avatar = document.createElement("img");
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.src = channel.thumbnail;

  const meta = document.createElement("span");
  meta.className = "result-meta";

  const badge = document.createElement("span");
  badge.className = "result-badge";
  badge.textContent = "채널";

  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = channel.title;

  const description = document.createElement("span");
  description.className = "result-channel description-line";
  description.textContent = channel.description || channel.customUrl || "채널 설명 없음";

  const detail = document.createElement("span");
  detail.className = "result-detail";
  detail.append(createTextPill(channel.subscribers), createTextPill(channel.videoCount));

  meta.append(badge, title, description, detail);
  button.append(avatar, meta);
  return button;
}

function createPlaylistCard(playlist) {
  const button = document.createElement("button");
  button.className = "result-card playlist-card";
  button.type = "button";
  button.addEventListener("click", () => openPlaylistVideos(playlist));

  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.src = playlist.thumbnail;

  const meta = document.createElement("span");
  meta.className = "result-meta";

  const badge = document.createElement("span");
  badge.className = "result-badge";
  badge.textContent = "재생목록";

  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = playlist.title;

  const detail = document.createElement("span");
  detail.className = "result-detail";
  detail.append(createTextPill(`${playlist.itemCount}개 영상`), createTextPill(formatDate(playlist.publishedAt)));

  meta.append(badge, title, detail);
  button.append(image, meta);
  return button;
}

function openChannel(channel) {
  stopPlaybackForSearch();
  state.selectedChannel = channel;
  startChannelMode(channel, "videos");
}

function startChannelMode(channel, activeTab) {
  const modeByTab = {
    videos: "videos",
    playlists: "playlists",
    shorts: "shorts"
  };
  const pager = createEmptyPagerState();
  pager.loadingPage = 1;
  state.selectedChannel = channel;
  state.channelView = {
    active: true,
    mode: modeByTab[activeTab],
    tab: activeTab,
    sort: "latest",
    excludeShortVideos: false,
    channel,
    playlist: null,
    uploadArchive: createEmptyUploadArchiveState(),
    pager
  };
  renderChannelShell(channel, activeTab);
  goToChannelPage(1);
}

function openPlaylistVideos(playlist) {
  state.channelView = {
    active: true,
    mode: "playlistVideos",
    tab: "playlists",
    sort: "latest",
    excludeShortVideos: state.channelView.excludeShortVideos || false,
    channel: state.selectedChannel,
    playlist,
    uploadArchive: state.channelView.uploadArchive || createEmptyUploadArchiveState(),
    pager: createEmptyPagerState()
  };
  renderChannelShell(state.selectedChannel, "playlists");
  goToChannelPage(1);
}

function returnToSearchResults() {
  state.channelView = createEmptyChannelViewState();
  renderMixedResults(state.lastResults, state.search.currentPage);
}

function renderChannelShell(channel, activeTab) {
  els.resultsTitle.textContent = "채널";
  els.resultCount.textContent = "";
  els.pagination.replaceChildren();
  updateClearResultsState();

  const shell = document.createElement("div");
  shell.className = "channel-view";

  const header = document.createElement("div");
  header.className = "channel-header";

  const backButton = document.createElement("button");
  backButton.className = "ghost-button compact-button";
  backButton.type = "button";
  backButton.textContent = "검색 결과";
  backButton.addEventListener("click", returnToSearchResults);

  const avatar = document.createElement("img");
  avatar.alt = "";
  avatar.src = channel.thumbnail;

  const copy = document.createElement("div");
  copy.className = "channel-copy";

  const title = document.createElement("strong");
  title.textContent = channel.title;

  const detail = document.createElement("span");
  detail.textContent = `${channel.subscribers} · ${channel.videoCount}`;

  copy.append(title, detail);
  header.append(backButton, avatar, copy);

  const tabs = document.createElement("div");
  tabs.className = "channel-tabs";
  const sortbar = activeTab === "videos" ? createChannelSortBar() : null;
  const content = document.createElement("div");
  content.className = "channel-content";

  [
    ["videos", "동영상"],
    ["playlists", "재생목록"],
    ["shorts", "짧은 영상"]
  ].forEach(([tab, label]) => {
    const tabButton = document.createElement("button");
    tabButton.className = `tab-button ${activeTab === tab ? "is-active" : ""}`.trim();
    tabButton.type = "button";
    tabButton.textContent = label;
    tabButton.addEventListener("click", () => startChannelMode(channel, tab));
    tabs.append(tabButton);
  });

  shell.append(header, tabs);
  if (sortbar) {
    shell.append(sortbar);
  }
  shell.append(content);
  els.resultsList.replaceChildren(shell);
}

function createChannelSortBar() {
  const sortbar = document.createElement("div");
  sortbar.className = "channel-sortbar";
  const isLoading = Boolean(state.channelView.pager.loadingPage || state.channelView.uploadArchive.loadingPromise);

  const label = document.createElement("span");
  label.textContent = "정렬";

  const controls = document.createElement("div");
  controls.className = "channel-sort-controls";

  channelVideoSortOptions.forEach(([value, text]) => {
    const button = document.createElement("button");
    button.className = `sort-button ${state.channelView.sort === value ? "is-active" : ""}`.trim();
    button.type = "button";
    button.dataset.sort = value;
    button.textContent = text;
    button.disabled = isLoading || state.channelView.sort === value;
    button.addEventListener("click", () => changeChannelVideoSort(value));
    controls.append(button);
  });

  const filterLabel = document.createElement("label");
  filterLabel.className = "shorts-filter";

  const filterInput = document.createElement("input");
  filterInput.type = "checkbox";
  filterInput.checked = state.channelView.excludeShortVideos;
  filterInput.disabled = isLoading;
  filterInput.addEventListener("change", () => changeChannelShortsFilter(filterInput.checked));

  const filterText = document.createElement("span");
  filterText.textContent = "1분 미만 쇼츠영상 제외";

  filterLabel.append(filterInput, filterText);
  sortbar.append(label, controls, filterLabel);
  return sortbar;
}

function changeChannelVideoSort(sort) {
  const normalizedSort = normalizeChannelVideoSort(sort);
  if (state.channelView.sort === normalizedSort) {
    return;
  }

  state.channelView.sort = normalizedSort;
  state.channelView.pager = createEmptyPagerState();
  state.channelView.pager.loadingPage = 1;
  renderChannelShell(state.channelView.channel, "videos");
  goToChannelPage(1);
}

function changeChannelShortsFilter(checked) {
  const nextValue = Boolean(checked);
  if (state.channelView.excludeShortVideos === nextValue) {
    return;
  }

  state.channelView.excludeShortVideos = nextValue;
  state.channelView.pager = createEmptyPagerState();
  state.channelView.pager.loadingPage = 1;
  renderChannelShell(state.channelView.channel, "videos");
  goToChannelPage(1);
}

function syncChannelSortControls() {
  const isLoading = Boolean(state.channelView.pager.loadingPage || state.channelView.uploadArchive.loadingPromise);
  document.querySelectorAll(".sort-button").forEach((button) => {
    const isActive = button.dataset.sort === state.channelView.sort;
    button.classList.toggle("is-active", isActive);
    button.disabled = isLoading || isActive;
  });

  const filterInput = document.querySelector(".shorts-filter input");
  if (filterInput) {
    filterInput.checked = state.channelView.excludeShortVideos;
    filterInput.disabled = isLoading;
  }
}

async function goToChannelPage(pageNumber) {
  try {
    const content = getChannelContentElement();
    if (!content) {
      return;
    }

    renderInlineStatus(content, getChannelLoadingMessage());
    const page = await getChannelPage(pageNumber);

    if (!page.items.length) {
      renderInlineStatus(content, getChannelEmptyMessage());
      renderPagination();
      return;
    }

    renderChannelPage(page, pageNumber);
    setStatus(`${state.selectedChannel.title} 채널의 ${pageNumber}페이지입니다.`, "success");
  } catch (error) {
    state.channelView.pager.loadingPage = 0;
    renderPagination();
    const content = getChannelContentElement();
    if (content) {
      renderInlineStatus(content, getErrorText(error), "error");
    }
  }
}

async function getChannelPage(pageNumber) {
  const pager = state.channelView.pager;
  if (pager.pages[pageNumber]) {
    pager.currentPage = pageNumber;
    return pager.pages[pageNumber];
  }

  for (let page = 1; page <= pageNumber; page += 1) {
    if (!pager.pages[page]) {
      await fetchChannelPage(page);
    }
  }

  pager.currentPage = pageNumber;
  return pager.pages[pageNumber] || { items: [] };
}

async function fetchChannelPage(pageNumber) {
  const { channel, mode, playlist, pager } = state.channelView;
  const token = pager.tokens[pageNumber - 1];
  const canFetch = pageNumber === 1 || Boolean(token);

  if (
    !canFetch &&
    !pager.buffer.length &&
    !(mode === "videos" && (state.channelView.sort === "date" || state.channelView.sort === "popular"))
  ) {
    pager.pages[pageNumber] = { items: [] };
    return pager.pages[pageNumber];
  }

  pager.loadingPage = pageNumber;
  if (mode === "videos") {
    renderChannelShell(channel, "videos");
    const currentContent = getChannelContentElement();
    if (currentContent) {
      renderInlineStatus(currentContent, getChannelLoadingMessage());
    }
  }
  renderPagination();

  const key = getCurrentKey();
  let result;

  if (mode === "videos") {
    if (state.channelView.sort === "popular") {
      return fetchPopularChannelPage({ key, pageNumber });
    } else if (state.channelView.sort === "date") {
      return fetchDateSortedChannelPage({ key, pageNumber });
    } else if (!channel.uploadPlaylistId) {
      result = { items: [], nextPageToken: "", totalResults: 0 };
    } else {
      return fetchLatestChannelPage({ key, pageNumber });
    }
  } else if (mode === "playlists") {
    result = await getChannelPlaylists({ key, channelId: channel.id, pageToken: token });
  } else if (mode === "shorts") {
    result = await searchChannelShortVideos({ key, channelId: channel.id, pageToken: token });
  } else {
    result = await getPlaylistItems({ key, playlistId: playlist.id, pageToken: token });
  }

  pager.tokens[pageNumber] = result.nextPageToken || "";
  pager.exhausted = !result.nextPageToken;
  pager.totalResults = result.totalResults || pager.totalResults;

  let items;
  if (mode === "playlists") {
    items = result.items.map(toPlaylist);
  } else if (mode === "videos" && state.channelView.sort === "popular") {
    const detailsById = await getVideoDetails({
      key,
      ids: result.items.map((item) => item.id.videoId)
    });
    items = result.items
      .map((item) => toVideoFromSearch(item, detailsById))
      .filter((video) => video.embeddable);
  } else if (mode === "shorts") {
    const detailsById = await getVideoDetails({
      key,
      ids: result.items.map((item) => item.id.videoId)
    });
    items = result.items
      .map((item) => toVideoFromSearch(item, detailsById))
      .filter((video) => video.embeddable);
  } else {
    const videoIds = result.items.map((item) => item.contentDetails?.videoId).filter(Boolean);
    const detailsById = await getVideoDetails({ key, ids: videoIds });
    items = result.items
      .map((item) => toVideoFromPlaylist(item, detailsById))
      .filter((video) => video.id && video.embeddable);
  }

  const page = { items };
  pager.pages[pageNumber] = page;
  pager.loadingPage = 0;
  renderPagination();
  return page;
}

async function fetchLatestChannelPage({ key, pageNumber }) {
  const { channel, pager } = state.channelView;
  return fetchBufferedChannelVideoPage({
    pageNumber,
    pager,
    getSourcePage: (pageToken) => getUploadItems({
      key,
      playlistId: channel.uploadPlaylistId,
      pageToken,
      maxResults: state.channelView.excludeShortVideos ? uploadArchivePageSize : pageSize.channelVideos
    }),
    toVideos: async (items) => {
      const videoIds = items.map((item) => item.contentDetails?.videoId).filter(Boolean);
      const detailsById = await getVideoDetails({ key, ids: videoIds });
      return items.map((item) => toVideoFromPlaylist(item, detailsById));
    }
  });
}

async function fetchPopularChannelPage({ key, pageNumber }) {
  const { channel, pager } = state.channelView;
  if (!channel.uploadPlaylistId) {
    pager.pages[pageNumber] = { items: [] };
    pager.loadingPage = 0;
    return pager.pages[pageNumber];
  }

  const result = await getServerPopularChannelPage({
    playlistId: channel.uploadPlaylistId,
    pageNumber,
    excludeShorts: state.channelView.excludeShortVideos
  });
  const page = {
    items: result.items
  };

  pager.pages[pageNumber] = page;
  pager.totalResults = result.totalResults || result.items.length;
  pager.currentPage = result.page || pageNumber;
  pager.loadingPage = 0;
  pager.exhausted = true;
  renderPagination();
  return page;
}

async function getServerPopularChannelPage({ playlistId, pageNumber, excludeShorts }) {
  const params = new URLSearchParams({
    playlistId,
    page: String(pageNumber),
    pageSize: String(pageSize.channelVideos),
    excludeShorts: excludeShorts ? "1" : "0"
  });
  const response = await fetch(`/api/channel-popular?${params}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data));
  }

  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: data.page || pageNumber,
    totalResults: data.totalResults || 0
  };
}

async function fetchBufferedChannelVideoPage({ pageNumber, pager, getSourcePage, toVideos }) {
  const collected = pager.buffer.splice(0, pageSize.channelVideos);
  let nextToken = pager.tokens[pageNumber - 1] || "";
  let totalResults = pager.totalResults;
  let attempts = 0;

  while (collected.length < pageSize.channelVideos && (pageNumber === 1 || nextToken || attempts > 0)) {
    const result = await getSourcePage(nextToken);
    const videos = await toVideos(result.items);
    collected.push(...filterChannelVideos(videos));
    nextToken = result.nextPageToken || "";
    totalResults = result.totalResults || totalResults;
    attempts += 1;

    if (!nextToken || (!state.channelView.excludeShortVideos && attempts >= 1) || attempts >= 8) {
      break;
    }
  }

  const pageItems = collected.slice(0, pageSize.channelVideos);
  pager.buffer = collected.slice(pageSize.channelVideos);
  pager.pages[pageNumber] = { items: pageItems };
  pager.tokens[pageNumber] = nextToken;
  pager.totalResults = totalResults || pageItems.length;
  pager.currentPage = pageNumber;
  pager.loadingPage = 0;
  pager.exhausted = !nextToken && !pager.buffer.length;
  renderPagination();
  return pager.pages[pageNumber];
}

async function fetchDateSortedChannelPage({ key, pageNumber }) {
  const { channel, pager } = state.channelView;
  if (!channel.uploadPlaylistId) {
    pager.pages[pageNumber] = { items: [] };
    pager.loadingPage = 0;
    return pager.pages[pageNumber];
  }

  await ensureUploadArchiveLoaded({ key, playlistId: channel.uploadPlaylistId });
  const archive = state.channelView.uploadArchive;
  const start = (pageNumber - 1) * pageSize.channelVideos;

  if (state.channelView.excludeShortVideos) {
    const videosWithoutShorts = await getArchivedVideosWithoutShorts({ key });
    const page = {
      items: videosWithoutShorts.slice(start, start + pageSize.channelVideos)
    };
    pager.pages[pageNumber] = page;
    pager.totalResults = videosWithoutShorts.length;
    pager.currentPage = pageNumber;
    pager.loadingPage = 0;
    pager.exhausted = true;
    renderPagination();
    return page;
  }

  const itemsByOldest = [...archive.items].reverse();
  const pageItems = itemsByOldest.slice(start, start + pageSize.channelVideos);
  const videoIds = pageItems.map((item) => item.contentDetails?.videoId).filter(Boolean);
  const detailsById = await getVideoDetails({ key, ids: videoIds });
  const items = pageItems
    .map((item) => toVideoFromPlaylist(item, detailsById))
    .filter((video) => video.id && video.embeddable);

  const page = { items };
  pager.pages[pageNumber] = page;
  pager.totalResults = archive.totalResults || archive.items.length;
  pager.currentPage = pageNumber;
  pager.loadingPage = 0;
  pager.exhausted = true;
  renderPagination();
  return page;
}

async function getArchivedVideosWithoutShorts({ key }) {
  const archive = state.channelView.uploadArchive;
  if (archive.videosWithoutShorts) {
    return archive.videosWithoutShorts;
  }

  const itemsByOldest = [...archive.items].reverse();
  const videos = [];

  for (let index = 0; index < itemsByOldest.length; index += 50) {
    const chunk = itemsByOldest.slice(index, index + 50);
    const videoIds = chunk.map((item) => item.contentDetails?.videoId).filter(Boolean);
    const detailsById = await getVideoDetails({ key, ids: videoIds });
    videos.push(
      ...chunk
        .map((item) => toVideoFromPlaylist(item, detailsById))
        .filter((video) => video.id && video.embeddable && !isUnderOneMinuteVideo(video))
    );
  }

  archive.videosWithoutShorts = videos;
  return videos;
}

async function getArchivedPopularVideos({ key }) {
  const archive = state.channelView.uploadArchive;
  if (archive.popularVideos) {
    return archive.popularVideos;
  }

  const videos = [];

  for (let index = 0; index < archive.items.length; index += 50) {
    const chunk = archive.items.slice(index, index + 50);
    const videoIds = chunk.map((item) => item.contentDetails?.videoId).filter(Boolean);
    const detailsById = await getVideoDetails({ key, ids: videoIds });
    videos.push(
      ...chunk
        .map((item) => toVideoFromPlaylist(item, detailsById))
        .filter((video) => video.id && video.embeddable)
    );
  }

  archive.popularVideos = videos.sort((a, b) => b.viewCount - a.viewCount);
  archive.popularVideosWithoutShorts = archive.popularVideos.filter((video) => !isUnderOneMinuteVideo(video));
  return archive.popularVideos;
}

async function ensureUploadArchiveLoaded({ key, playlistId }) {
  const archive = state.channelView.uploadArchive;
  if (archive.complete) {
    return;
  }

  if (archive.loadingPromise) {
    await archive.loadingPromise;
    return;
  }

  archive.loadingPromise = (async () => {
    let nextToken = archive.nextPageToken || "";
    let guard = 0;

    do {
      const result = await getUploadItems({
        key,
        playlistId,
        pageToken: nextToken,
        maxResults: uploadArchivePageSize
      });
      const knownIds = new Set(archive.items.map((item) => item.contentDetails?.videoId).filter(Boolean));
      const newItems = result.items.filter((item) => {
        const videoId = item.contentDetails?.videoId;
        return videoId && !knownIds.has(videoId);
      });
      archive.items.push(...newItems);
      archive.popularVideos = null;
      archive.popularVideosWithoutShorts = null;
      archive.videosWithoutShorts = null;
      archive.totalResults = result.totalResults || archive.totalResults || archive.items.length;
      nextToken = result.nextPageToken;
      guard += 1;
    } while (nextToken && guard < 200);

    archive.nextPageToken = nextToken || "";
    archive.complete = !nextToken;
  })();

  try {
    await archive.loadingPromise;
  } finally {
    archive.loadingPromise = null;
  }
}

function renderChannelPage(page, pageNumber) {
  const content = getChannelContentElement();
  if (!content) {
    return;
  }

  const nodes = [];
  if (state.channelView.mode === "playlistVideos") {
    nodes.push(createPlaylistDetailHeader(state.channelView.playlist));
    nodes.push(...page.items.map(createVideoCard));
    els.resultCount.textContent = `${state.channelView.playlist.title} · ${pageNumber}페이지 · ${page.items.length}개`;
  } else if (state.channelView.mode === "playlists") {
    nodes.push(...page.items.map(createPlaylistCard));
    els.resultCount.textContent = `재생목록 ${pageNumber}페이지 · ${page.items.length}개`;
  } else {
    nodes.push(...page.items.map(createVideoCard));
    els.resultCount.textContent = `${getChannelModeLabel()} · ${pageNumber}페이지 · ${page.items.length}개`;
  }

  content.replaceChildren(...nodes);
  state.channelView.pager.currentPage = pageNumber;
  renderPagination();
  syncChannelSortControls();
  updateClearResultsState();
}

function createPlaylistDetailHeader(playlist) {
  const header = document.createElement("div");
  header.className = "playlist-detail-header";

  const backButton = document.createElement("button");
  backButton.className = "ghost-button compact-button";
  backButton.type = "button";
  backButton.textContent = "재생목록";
  backButton.addEventListener("click", () => startChannelMode(state.selectedChannel, "playlists"));

  const title = document.createElement("strong");
  title.textContent = playlist.title;

  header.append(backButton, title);
  return header;
}

function getChannelContentElement() {
  return document.querySelector(".channel-content");
}

function getChannelModeLabel() {
  if (state.channelView.mode === "shorts") {
    return "짧은 영상";
  }

  if (state.channelView.mode === "videos") {
    return `${getChannelSortLabel()} 채널 영상`;
  }

  return "채널 영상";
}

function getChannelLoadingMessage() {
  if (state.channelView.mode === "playlists") {
    return "재생목록을 불러오는 중입니다.";
  }

  if (state.channelView.mode === "shorts") {
    return "짧은 영상을 불러오는 중입니다.";
  }

  if (state.channelView.mode === "playlistVideos") {
    return "재생목록 영상을 불러오는 중입니다.";
  }

  if (state.channelView.mode === "videos" && state.channelView.sort === "popular") {
    return "전체 업로드 목록을 조회수 기준으로 정렬하는 중입니다.";
  }

  if (state.channelView.mode === "videos" && state.channelView.sort === "date") {
    return "날짜순 정렬을 준비하는 중입니다.\n다수의 동영상을 불러올 경우 로딩에 다소 시간이 걸릴 수 있습니다.";
  }

  return "채널 동영상을 불러오는 중입니다.";
}

function getChannelEmptyMessage() {
  if (state.channelView.mode === "playlists") {
    return "공개 재생목록이 없습니다.";
  }

  if (state.channelView.mode === "shorts") {
    return "공개된 짧은 영상을 찾지 못했습니다.";
  }

  if (state.channelView.mode === "playlistVideos") {
    return "재생 가능한 공개 영상이 없습니다.";
  }

  if (!state.channelView.channel?.uploadPlaylistId) {
    return "이 채널의 업로드 목록을 가져올 수 없습니다.";
  } else if (state.channelView.mode === "videos" && state.channelView.excludeShortVideos) {
    return "1분 미만 영상을 제외한 재생 가능한 공개 영상이 없습니다.";
  } else {
    return "재생 가능한 공개 영상이 없습니다.";
  }
}

function filterChannelVideos(videos) {
  return videos
    .filter((video) => video.id && video.embeddable)
    .filter((video) => !state.channelView.excludeShortVideos || !isUnderOneMinuteVideo(video));
}

function isUnderOneMinuteVideo(video) {
  const seconds = Number(video.seconds || 0);
  return seconds > 0 && seconds < 60;
}

function normalizeChannelVideoSort(value) {
  return channelVideoSortOptions.some(([sort]) => sort === value) ? value : "latest";
}

function getChannelSortLabel() {
  const option = channelVideoSortOptions.find(([value]) => value === normalizeChannelVideoSort(state.channelView.sort));
  return option?.[1] || "최신순";
}

function createTextPill(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function playVideo(video) {
  state.selectedVideo = video;
  els.finishButton.disabled = false;
  document.body.classList.add("has-active-video");
  if (state.search.active && !state.channelView.active) {
    renderWatchResults(state.lastResults, state.search.currentPage);
  }
  els.playerMount.replaceChildren();

  if (state.player?.destroy) {
    state.player.destroy();
  }

  if (window.YT?.Player) {
    try {
      const mount = document.createElement("div");
      mount.id = "youtubePlayer";
      els.playerMount.append(mount);
      state.player = new window.YT.Player("youtubePlayer", {
        host: "https://www.youtube-nocookie.com",
        videoId: video.id,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin
        },
        events: {
          onReady(event) {
            event.target.playVideo();
          },
          onStateChange(event) {
            if (event.data === window.YT.PlayerState.ENDED) {
              finishViewing();
            }
          }
        }
      });
    } catch {
      state.player = null;
      els.playerMount.replaceChildren();
      mountFallbackPlayer(video);
    }
  } else {
    mountFallbackPlayer(video);
  }

  setStatus(`선택한 영상: ${video.title}`, "success");
  scrollPlayerIntoViewOnMobile();
}

function mountFallbackPlayer(video) {
  const iframe = document.createElement("iframe");
  iframe.title = video.title;
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`;
  els.playerMount.append(iframe);
}

function finishViewing() {
  if (state.player?.destroy) {
    state.player.destroy();
  }

  const message = state.selectedVideo
    ? `${state.selectedVideo.title} 시청을 마쳤습니다.`
    : "시청을 마쳤습니다.";

  state.player = null;
  state.selectedVideo = null;
  document.body.classList.remove("has-active-video");
  els.finishButton.disabled = true;
  els.playerMount.replaceChildren(createEmptyPlayer("시청 완료"));
  if (state.search.active && !state.channelView.active) {
    renderMixedResults(state.lastResults, state.search.currentPage);
  }
  setStatus(message, "success");
}

function scrollPlayerIntoViewOnMobile() {
  if (!window.matchMedia("(max-width: 900px)").matches) {
    return;
  }

  window.requestAnimationFrame(() => {
    const top = els.playerMount.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth"
    });
  });
}

function createEmptyPlayer(message) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-player";

  const mark = document.createElement("span");
  mark.className = "play-mark";
  mark.setAttribute("aria-hidden", "true");

  const text = document.createElement("p");
  text.textContent = message;

  wrapper.append(mark, text);
  return wrapper;
}

function stopPlaybackForSearch() {
  if (state.player?.destroy) {
    state.player.destroy();
  }

  state.player = null;
  state.selectedVideo = null;
  document.body.classList.remove("has-active-video");
  els.finishButton.disabled = true;
  els.playerMount.replaceChildren(createEmptyPlayer("검색 결과에서 볼 영상을 하나 선택하세요."));
}

function clearResults() {
  els.resultsList.replaceChildren();
  els.resultCount.textContent = "0개";
  els.pagination.replaceChildren();
}

function resetAppToHome() {
  if (state.player?.destroy) {
    state.player.destroy();
  }

  state.player = null;
  state.selectedVideo = null;
  state.selectedChannel = null;
  state.lastResults = { channels: [], videos: [] };
  state.search = createEmptySearchState();
  state.channelView = createEmptyChannelViewState();
  state.sessionStartedAt = Date.now();
  document.body.classList.remove("has-active-video");
  els.videoUrlInput.value = "";
  els.queryInput.value = "";
  const defaultDuration = els.searchForm.querySelector('input[name="duration"][value="any"]');
  if (defaultDuration) {
    defaultDuration.checked = true;
  }
  els.resultsTitle.textContent = "검색 결과";
  els.finishButton.disabled = true;
  els.searchButton.disabled = false;
  els.playerMount.replaceChildren(createEmptyPlayer("검색 결과에서 볼 영상을 하나 선택하세요."));
  clearResults();
  updateClearResultsState();
  setStatus(
    state.usingServerKey ? "검색어를 입력하면 시작할 수 있습니다." : "서버 API 키가 설정되어 있지 않습니다.",
    state.usingServerKey ? "success" : "error"
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetResults() {
  state.selectedChannel = null;
  state.lastResults = { channels: [], videos: [] };
  state.search = createEmptySearchState();
  state.channelView = createEmptyChannelViewState();
  els.resultsTitle.textContent = "검색 결과";
  clearResults();
  setStatus("검색 결과를 지웠습니다.", "success");
  updateClearResultsState();
}

function updateClearResultsState() {
  const hasResults = Boolean(els.resultsList.children.length) || Boolean(els.pagination.children.length);
  els.clearResultsButton.disabled = !hasResults;
}

function renderInlineStatus(content, message, tone = "") {
  const status = document.createElement("div");
  status.className = `status-message ${tone}`.trim();
  status.textContent = message;
  content.replaceChildren(status);
}

function setStatus(message, tone = "") {
  els.statusMessage.textContent = message;
  els.statusMessage.className = `status-message ${tone}`.trim();
}

function startTimer() {
  state.timerId = window.setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - state.sessionStartedAt) / 1000);
    const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    els.sessionTime.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function getApiErrorMessage(data) {
  const reason = data?.error?.errors?.[0]?.reason;

  if (reason === "keyInvalid") {
    return "API 키가 올바르지 않습니다.";
  }

  if (reason === "dailyLimitExceeded" || reason === "quotaExceeded") {
    return "YouTube API 할당량을 초과했습니다.";
  }

  if (reason === "forbidden") {
    return "API 키 제한사항을 확인하세요.";
  }

  return data?.error?.message || data?.error || "YouTube API 요청에 실패했습니다.";
}

function getErrorText(error) {
  return error instanceof Error ? error.message : "요청 중 문제가 생겼습니다.";
}

function extractYouTubeVideoId(value) {
  const rawValue = String(value || "").trim();
  const directId = normalizeVideoId(rawValue);
  if (directId) {
    return directId;
  }

  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue.includes("://") ? rawValue : `https://${rawValue}`);
    const hostname = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (hostname === "youtu.be") {
      return normalizeVideoId(url.pathname.split("/").filter(Boolean)[0]);
    }

    if (hostname.endsWith("youtube.com") || hostname.endsWith("youtube-nocookie.com")) {
      const watchId = normalizeVideoId(url.searchParams.get("v"));
      if (watchId) {
        return watchId;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live", "v"].includes(parts[0])) {
        return normalizeVideoId(parts[1]);
      }
    }
  } catch {
    return "";
  }

  return "";
}

function normalizeVideoId(value) {
  const candidate = String(value || "").trim();
  const match = candidate.match(/^[a-zA-Z0-9_-]{11}$/);
  return match ? candidate : "";
}

function decodeHtml(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value || "";
  return textarea.value;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function tokenizeSearchQuery(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .normalize("NFKC")
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((token) => normalizeSearchText(token))
    .filter((token) => token.length >= 2);
}

function formatDuration(value) {
  if (!value) {
    return "";
  }

  const seconds = durationToSeconds(value);
  if (!seconds) {
    return "";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = hours > 0
    ? [hours, minutes, remainder]
    : [minutes, remainder];

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

function formatSubscribers(value) {
  const subscribers = Number(value || 0);
  if (!subscribers) {
    return "구독자 정보 없음";
  }

  return `구독자 ${new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(subscribers)}`;
}

function formatVideoCount(value) {
  const count = Number(value || 0);
  if (!count) {
    return "영상 정보 없음";
  }

  return `영상 ${new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(count)}개`;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}
