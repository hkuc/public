import 'assets://js/lib/crypto-js.js';

const CryptoJS = globalThis.CryptoJS;
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IMAGE_KEY = 'f5d965df75336270';
const IMAGE_IV = '97b60394abc2fbe1';

const DEFAULT_CONFIG = {
    siteBase: 'https://huangguoai.com',
    timeoutMs: 15000,
    categories: [
    { type_id: 'ai-duanju', type_name: 'AI成人短剧' },
    { type_id: 'ai-manju', type_name: 'AI成人漫剧' },
    { type_id: 'ai-huanlian', type_name: 'AI换脸' },
    { type_id: 'ai-mogai', type_name: 'AI魔改' },
    ],
    filters: {},
};

const state = {
    config: { ...DEFAULT_CONFIG },
};

function init(ext) {
    state.config = normalizeConfig(parseExtend(ext));
    return '{}';
}

function request(path) {
    let target = String(path || '');
    if (!/^https?:\/\//i.test(target)) {
        target = state.config.siteBase + (target.charAt(0) === '/' ? target : '/' + target);
    }
    const response = req(target, {
        timeout: state.config.timeoutMs,
        headers: requestHeaders()
    });
    return typeof response === 'string' ? response : (response.content || '');
}

function requestHeaders() {
    return {
        'User-Agent': USER_AGENT,
        'Referer': state.config.siteBase + '/',
        'Origin': state.config.siteBase,
        'Accept-Language': 'zh-CN,zh;q=0.9',
    };
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;|&#34;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
        .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(parseInt(code, 10)); });
}

function cleanText(value) {
    return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function getAttr(source, name) {
    const match = String(source || '').match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'i'));
    return match ? decodeHtml(match[1]) : '';
}

function absoluteUrl(path) {
    const value = decodeHtml(path);
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : state.config.siteBase + (value.charAt(0) === '/' ? value : '/' + value);
}

function imageProxyUrl(url) {
    if (!url) return '';
    return getProxy(true) + '&url=' + encodeURIComponent(url);
}

function extractCards(html) {
    const starts = [];
    const marker = /<div\s+class="hg-drama-card"\s+([^>]*)>/gi;
    let match;
    while ((match = marker.exec(html)) !== null) {
        starts.push({ index: match.index, end: marker.lastIndex, attrs: match[1] });
    }

    const videos = [];
    const seen = {};
    for (let i = 0; i < starts.length; i++) {
        const current = starts[i];
        const nextIndex = i + 1 < starts.length ? starts[i + 1].index : html.length;
        const fragment = html.slice(current.index, nextIndex);
        const id = getAttr(current.attrs, 'data-track-id') || ((fragment.match(/href="\/detail\/(\d+)\//i) || [])[1] || '');
        if (!id || seen[id]) continue;

        const title = getAttr(current.attrs, 'data-track-title') || cleanText((fragment.match(/hg-drama-card__title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]);
        const picture = getAttr(fragment, 'data-src') || getAttr(fragment, 'src');
        const episode = cleanText((fragment.match(/class="hg-drama-card__episode"[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
        const score = cleanText((fragment.match(/class="hg-drama-card__score"[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
        if (!title) continue;

        seen[id] = true;
        videos.push({
            vod_id: id,
            vod_name: title,
            vod_pic: imageProxyUrl(absoluteUrl(picture)),
            vod_remarks: episode || score,
        });
    }
    return videos;
}

function parseInitialData(html) {
    const match = String(html || '').match(/<script\s+id="videoInitialData"\s+type="application\/json">([\s\S]*?)<\/script>/i);
    if (!match) return {};
    try {
        return JSON.parse(match[1]);
    } catch (e) {
        return {};
    }
}

function extractEpisodes(html) {
    const episodes = [];
    const seen = {};
    const pattern = /<a\b([^>]*?)\bdata-ep-id="(\d+)"([^>]*)>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const attrs = match[1] + ' ' + match[3];
        const number = parseInt(match[2], 10);
        const href = getAttr(attrs, 'href');
        if (!number || !href || seen[number]) continue;
        seen[number] = true;
        episodes.push({ number: number, url: absoluteUrl(href) });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
}

function categoryUrl(typeId, page) {
    const current = Math.max(parseInt(page, 10) || 1, 1);
    return '/' + typeId + (current > 1 ? '/' + current + '/' : '/');
}

function home(filter) {
    return JSON.stringify({ class: state.config.categories, filters: state.config.filters });
}

function homeVod(params) {
    return JSON.stringify({ list: extractCards(request('/')) });
}

function category(tid, pg, filter, extend) {
    const allowed = state.config.categories.some(function (item) { return item.type_id === tid; });
    if (!allowed) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    }

    const page = Math.max(parseInt(pg, 10) || 1, 1);
    const html = request(categoryUrl(tid, page));
    const pages = parseInt((html.match(/data-pages="(\d+)"/i) || [])[1], 10) || 1;
    const list = extractCards(html);
    return JSON.stringify({
        page: page,
        pagecount: pages,
        limit: list.length || 20,
        total: pages * (list.length || 20),
        list: list,
    });
}

function detail(id) {
    const videoId = String(id || '').match(/\d+/);
    if (!videoId) return JSON.stringify({ list: [] });

    const html = request('/video/' + videoId[0] + '/');
    const data = parseInitialData(html);
    const episodes = extractEpisodes(html);
    const urls = episodes.map(function (episode) {
        const label = '第' + (episode.number < 10 ? '0' : '') + episode.number + '集';
        return label + '$' + episode.url;
    });

    const typeNames = (data.breadcrumb || []).map(function (item) { return item.name; }).filter(Boolean).join(' / ');
    const vod = {
        vod_id: videoId[0],
        vod_name: data.title || '',
        vod_pic: imageProxyUrl(absoluteUrl(data.coverSrc || data.posterSrc)),
        type_name: typeNames,
        vod_year: String(data.time || '').slice(0, 4),
        vod_area: '',
        vod_remarks: data.ep ? ('更新至' + data.ep + '集') : '',
        vod_actor: data.author || '',
        vod_director: '',
        vod_content: data.description || '',
        vod_play_from: '黄果短剧',
        vod_play_url: urls.join('#'),
    };
    return JSON.stringify({ list: [vod] });
}

function play(flag, id, flags) {
    const html = request(id);
    const data = parseInitialData(html);
    const playUrl = data.videoSrc || ((data.epPlaySrcs || {})[data.ep]);
    if (!playUrl) return JSON.stringify({ parse: 0, url: '' });

    return JSON.stringify({
        parse: 0,
        url: playUrl,
        header: requestHeaders()
    });
}

function search(wd, quick) {
    const keyword = encodeURIComponent(String(wd || ''));
    return JSON.stringify({ list: extractCards(request('/search/video/' + keyword + '/')) });
}

function parseExtend(ext) {
    if (!ext) return {};
    if (typeof ext === 'object') return ext.ext ? parseExtend(ext.ext) : ext;
    try {
        return JSON.parse(String(ext));
    } catch (e) {
        return {};
    }
}

function normalizeCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) return DEFAULT_CONFIG.categories.slice();
    const result = [];
    for (let index = 0; index < categories.length; index++) {
        const item = categories[index] || {};
        const typeId = String(item.type_id || item.id || '');
        const typeName = String(item.type_name || item.name || '');
        if (typeId && typeName) result.push({ type_id: typeId, type_name: typeName });
    }
    return result.length ? result : DEFAULT_CONFIG.categories.slice();
}

function normalizeConfig(input) {
    const config = Object.assign({}, DEFAULT_CONFIG, input || {});
    config.siteBase = normalizeBaseUrl(config.siteBase || DEFAULT_CONFIG.siteBase) || DEFAULT_CONFIG.siteBase;
    config.timeoutMs = clampTimeout(config.timeoutMs, DEFAULT_CONFIG.timeoutMs);
    config.categories = normalizeCategories(config.categories);
    config.filters = config.filters && typeof config.filters === 'object' && !Array.isArray(config.filters)
        ? config.filters : {};
    return config;
}

function clampTimeout(value, fallback) {
    const timeout = parseInt(value, 10);
    return timeout >= 3000 && timeout <= 60000 ? timeout : fallback;
}

function normalizeBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
}

// [HTTP 状态码, MIME 类型, 内容, 响应头, 内容是否 Base64(1 = 是)]。
function proxy(params) {
    const url = String((params && params.url) || '');

    try {
        const response = req(url, {
            buffer: 2,
            headers: requestHeaders()
        });
        const cipherBase64 = response && response.content;
        if (!cipherBase64) {
            return [502, 'text/plain; charset=utf-8', 'Image request failed'];
        }

        const plain = CryptoJS.AES.decrypt(cipherBase64, CryptoJS.enc.Utf8.parse(IMAGE_KEY), {
            iv: CryptoJS.enc.Utf8.parse(IMAGE_IV),
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.NoPadding,
        });
        const imageBase64 = CryptoJS.enc.Base64.stringify(plain);
        if (!imageBase64) {
            return [502, 'text/plain; charset=utf-8', 'Image decrypt failed'];
        }

        return [
            200,
            'image/jpeg',
            imageBase64,
            { 'Cache-Control': 'public, max-age=86400' },
            1,
        ];
    } catch (e) {
        return [502, 'text/plain; charset=utf-8', 'Image decrypt failed'];
    }
}

__JS_SPIDER__ = {
    init: init,
    home: home,
    homeVod: homeVod,
    category: category,
    detail: detail,
    play: play,
    search: search,
    proxy: proxy,
};
