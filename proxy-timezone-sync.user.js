// ==UserScript==
// @name         自动同步代理时区 (Proxy Timezone Sync) v2.1 (静默版)
// @namespace    https://antigravity.assistant/
// @version      3.0.0
// @description  按当前 AI 网站实际出口或已核实代理链同步时区，支持 Windows / Mac，其他网页保持系统时区
// @author       Antigravity
// @homepageURL  https://github.com/AlexbeatsZ/proxy-timezone-sync
// @supportURL   https://github.com/AlexbeatsZ/proxy-timezone-sync/issues
// @updateURL    https://raw.githubusercontent.com/AlexbeatsZ/proxy-timezone-sync/main/proxy-timezone-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/AlexbeatsZ/proxy-timezone-sync/main/proxy-timezone-sync.user.js
// @match        https://*.chatgpt.com/*
// @match        https://*.openai.com/*
// @match        https://*.claude.ai/*
// @match        https://*.claude.com/*
// @match        https://*.anthropic.com/*
// @match        https://*.grok.com/*
// @match        https://*.x.ai/*
// @match        https://*.gemini.google.com/*
// @match        https://*.aistudio.google.com/*
// @match        https://*.makersuite.google.com/*
// @match        https://*.ai.google.dev/*
// @match        https://*.ai.google/*
// @match        https://*.deepmind.google/*
// @match        https://*.notebooklm.google.com/*
// @match        https://*.notebooklm.google/*
// @match        https://*.notebook.google/*
// @match        https://*.deepseek.com/*
// @match        https://*.perplexity.ai/*
// @match        https://*.qwen.ai/*
// @match        https://*.kimi.com/*
// @match        https://*.kimi.ai/*
// @match        https://*.moonshot.cn/*
// @match        https://*.moonshot.ai/*
// @match        https://*.copilot.microsoft.com/*
// @match        https://*.copilot.com/*
// @match        https://*.poe.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      ipwho.is
// @connect      self
// @connect      127.0.0.1
// ==/UserScript==

(function () {
    'use strict';

    // Keep this check before any GM API, network request, menu or timezone hook.
    // Exact domains and their subdomains only; no substring/domain-keyword matching.
    const AI_HOSTS = [
        'chatgpt.com', 'openai.com',
        'claude.ai', 'claude.com', 'anthropic.com',
        'grok.com', 'x.ai',
        'gemini.google.com', 'aistudio.google.com', 'makersuite.google.com',
        'ai.google.dev', 'ai.google', 'deepmind.google',
        'notebooklm.google.com', 'notebooklm.google', 'notebook.google',
        'deepseek.com', 'perplexity.ai', 'qwen.ai',
        'kimi.com', 'kimi.ai', 'moonshot.cn', 'moonshot.ai',
        'copilot.microsoft.com', 'copilot.com', 'poe.com'
    ];
    const pageHost = location.hostname.toLowerCase().replace(/\.$/, '');
    const isAiPage = location.protocol === 'https:' && AI_HOSTS.some(domain =>
        pageHost === domain || pageHost.endsWith('.' + domain)
    );
    if (!isAiPage) return;


    const pageContext = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const pageFetch = pageContext.fetch.bind(pageContext);
    const NativeFormat = pageContext.Intl.DateTimeFormat;
    const nativeTimeZone = NativeFormat().resolvedOptions().timeZone;
    const SITE_CACHE_KEY = 'PROXY_TZ_CACHE_V3:' + pageHost;
    const SITE_OVERRIDE_KEY = 'MANUAL_TZ_OVERRIDE_V3:' + pageHost;
    const BRIDGE_KEY = 'PROXY_TZ_BRIDGE_V3';
    const BRIDGE_URL = 'http://127.0.0.1:17898';
    const activeUpdaters = [];
    let activeTimeZone = validZone(GM_getValue(SITE_OVERRIDE_KEY, '')) || nativeTimeZone;
    let generation = 0;
    let lastResult = { evidence: activeTimeZone === nativeTimeZone ? 'native' : 'manual' };

    // Old global V2 cache and override stay stored, but are never applied automatically.
    applyTimezoneHook();
    detectTimezone(false);

    GM_registerMenuCommand('🔄 重新识别此网站的代理时区', () => detectTimezone(true));
    GM_registerMenuCommand('⚙️ 手动指定此网站时区', () => {
        const input = prompt('仅设置 ' + pageHost + ' 的时区，例如 Asia/Tokyo 或 America/Los_Angeles。留空恢复自动识别：', GM_getValue(SITE_OVERRIDE_KEY, ''));
        if (input === null) return;
        const timeZone = input.trim();
        if (timeZone && !validZone(timeZone)) return alert('时区名称无效。');
        GM_setValue(SITE_OVERRIDE_KEY, timeZone);
        generation++;
        if (timeZone) {
            lastResult = { evidence: 'manual' };
            switchActiveTimeZone(timeZone);
        } else {
            switchActiveTimeZone(nativeTimeZone);
            detectTimezone(true);
        }
    });
    GM_registerMenuCommand('🔗 连接本机代理助手（Windows / Mac）', () => {
        const input = prompt('粘贴本机代理助手生成的 client-settings.json 内容。留空断开助手：', '');
        if (input === null) return;
        if (!input.trim()) {
            GM_setValue(BRIDGE_KEY, null);
        } else {
            try {
                const config = JSON.parse(input);
                if (config.url !== BRIDGE_URL || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error();
                GM_setValue(BRIDGE_KEY, { url: config.url, token: config.token });
            } catch { return alert('助手配置无效，请复制 client-settings.json 的完整内容。'); }
        }
        detectTimezone(true);
    });
    GM_registerMenuCommand('🧪 查看此网站时区', () => {
        const labels = { native: '未核实，保留系统时区', manual: '此网站手动设置', 'site-ip': '网站自身返回的出口 IP', 'verified-proxy-chain': '本机已核对代理链' };
        alert('网站：' + pageHost + '\n生效时区：' + activeTimeZone + '\n来源：' + (labels[lastResult.evidence] || labels.native) +
            (lastResult.ip ? '\n出口 IP：' + lastResult.ip : '') +
            (lastResult.route ? '\n代理：' + lastResult.route.join(' → ') : ''));
    });
    const legacyManual = validZone(GM_getValue('MANUAL_TZ_OVERRIDE', ''));
    if (legacyManual) GM_registerMenuCommand('沿用旧手动时区到此网站', () => {
        generation++;
        GM_setValue(SITE_OVERRIDE_KEY, legacyManual);
        lastResult = { evidence: 'manual' };
        switchActiveTimeZone(legacyManual);
    });
    setInterval(() => { if (!document.hidden) detectTimezone(false); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) detectTimezone(false); });

    function validZone(value) {
        if (typeof value !== 'string' || !value || value.length > 100) return '';
        try { new NativeFormat('en', { timeZone: value }); return value; } catch { return ''; }
    }

    function switchActiveTimeZone(timeZone) {
        if (!validZone(timeZone) || timeZone === activeTimeZone) return;
        activeTimeZone = timeZone;
        for (const update of activeUpdaters) update(timeZone);
    }

    function request(details, timeout = 12000) {
        return new Promise((resolve, reject) => {
            let handle;
            let done = false;
            const finish = (error, response) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                error ? reject(error) : resolve(response);
            };
            const timer = setTimeout(() => {
                finish(new Error('Request timeout'));
                handle?.abort();
            }, timeout);
            try {
                handle = GM_xmlhttpRequest({ ...details, timeout, onload: response => finish(null, response),
                    onerror: () => finish(new Error('Request failed')), ontimeout: () => finish(new Error('Request timeout')) });
            } catch (error) { finish(error); }
        });
    }

    function normalizedIp(value) {
        if (typeof value !== 'string' || value.length > 45) return '';
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(part => Number(part) <= 255)) return value.split('.').map(Number).join('.');
        if (value.includes(':') && /^[0-9a-f:.]+$/i.test(value)) {
            try { return new URL('https://[' + value + ']/').hostname.toLowerCase(); } catch { /* Invalid IPv6. */ }
        }
        return '';
    }

    async function requestOrigin(method, pathname, timeout = 12000) {
        // Keep this request in the page's network context, including per-tab proxy rules.
        const controller = new pageContext.AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await pageFetch(location.origin + pathname, { method, credentials: 'omit',
                cache: 'no-store', redirect: 'error', signal: controller.signal });
            if (new URL(response.url).origin !== location.origin) throw new Error('Origin changed');
            return { status: response.status, responseText: method === 'HEAD' ? '' : await response.text(), finalUrl: response.url };
        } finally { clearTimeout(timer); }
    }

    async function lookupSiteIp() {
        const trace = await requestOrigin('GET', '/cdn-cgi/trace');
        if (trace.status !== 200 || typeof trace.responseText !== 'string' || trace.responseText.length > 8192 ||
            new URL(trace.finalUrl || location.origin).origin !== location.origin) throw new Error('No same-origin trace');
        const fields = Object.fromEntries(trace.responseText.split(/\r?\n/).filter(line => line.includes('=')).map(line => {
            const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
        }));
        if ((fields.h || '').toLowerCase() !== location.hostname.toLowerCase() || !normalizedIp(fields.ip) || !fields.ts || !fields.loc) throw new Error('Invalid site trace');
        const response = await request({ method: 'GET', url: 'https://ipwho.is/' + encodeURIComponent(fields.ip) + '?fields=success,ip,timezone.id', anonymous: true });
        if (response.status !== 200 || new URL(response.finalUrl || 'https://ipwho.is/').hostname !== 'ipwho.is') throw new Error('IP lookup failed');
        const data = JSON.parse(response.responseText);
        if (data.success === false || normalizedIp(data.ip) !== normalizedIp(fields.ip) || !validZone(data.timezone?.id)) throw new Error('IP lookup mismatch');
        return { host: pageHost, ip: fields.ip, timeZone: data.timezone.id, evidence: 'site-ip', verifiedAt: Date.now() };
    }

    async function lookupBridge(fresh) {
        const config = GM_getValue(BRIDGE_KEY, null);
        if (!config || config.url !== BRIDGE_URL || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Bridge is not configured');
        // A same-origin request helps expose the current browser route to Mihomo.
        try { await requestOrigin('HEAD', '/', 6000); } catch { /* Existing page connections may still provide evidence. */ }
        const response = await request({ method: 'GET', url: BRIDGE_URL + '/v1/timezone?host=' + encodeURIComponent(pageHost) + (fresh ? '&fresh=1' : ''),
            headers: { Authorization: 'Bearer ' + config.token }, anonymous: true }, 24000);
        if (response.status !== 200 || new URL(response.finalUrl || BRIDGE_URL).origin !== BRIDGE_URL) throw new Error('Website route was not verified');
        const result = JSON.parse(response.responseText);
        if (result.host !== pageHost || result.evidence !== 'verified-proxy-chain' || !validZone(result.timeZone) ||
            !normalizedIp(result.ip) || !Array.isArray(result.route) || !result.route.length ||
            typeof result.routeId !== 'string' || !Number.isFinite(result.verifiedAt) || Math.abs(Date.now() - result.verifiedAt) > 120000) throw new Error('Invalid bridge response');
        return result;
    }

    async function detectTimezone(manual) {
        const owner = ++generation;
        const override = validZone(GM_getValue(SITE_OVERRIDE_KEY, ''));
        if (override) {
            lastResult = { evidence: 'manual' };
            switchActiveTimeZone(override);
            return;
        }
        try {
            let result;
            try { result = await lookupSiteIp(); } catch { result = await lookupBridge(manual); }
            if (owner !== generation || validZone(GM_getValue(SITE_OVERRIDE_KEY, ''))) return;
            GM_setValue(SITE_CACHE_KEY, result);
            lastResult = result;
            switchActiveTimeZone(result.timeZone);
            if (manual) alert('此网站已识别为 ' + result.timeZone + (result.ip ? '\n出口 IP：' + result.ip : ''));
        } catch {
            if (owner !== generation || validZone(GM_getValue(SITE_OVERRIDE_KEY, ''))) return;
            lastResult = { evidence: 'native' };
            switchActiveTimeZone(nativeTimeZone);
            if (manual) alert('暂时无法核实此网站的出口，已保留系统时区。可连接本机代理助手或为此网站手动指定时区。');
        }
    }


    function applyTimezoneHook() {
        const targets = [];
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow) targets.push(unsafeWindow);
        if (typeof window !== 'undefined' && window && !targets.includes(window)) targets.push(window);

        targets.forEach(win => {
            try {
                hookWindowContext(win);
            } catch (e) {
                console.error('[TimezoneSync] Hook error on window:', e);
            }
        });
    }

    function hookWindowContext(targetWin) {
        const OrigDateTimeFormat = targetWin.Intl.DateTimeFormat;
        const OrigDate = targetWin.Date;

        function disguiseNative(fn, name) {
            try {
                Object.defineProperty(fn, 'name', { value: name, configurable: true });
            } catch (e) {}
            const nativeStr = `function ${name}() { [native code] }`;
            try {
                fn.toString = () => nativeStr;
            } catch (e) {}
            return fn;
        }

        // 1. Hook Intl.DateTimeFormat（动态跟随 activeTimeZone）
        const PatchedDateTimeFormat = function (locales, options) {
            const opts = Object.assign({}, options);
            const followsPage = opts.timeZone === undefined;
            if (followsPage) {
                opts.timeZone = activeTimeZone;
            }
            const target = new.target || OrigDateTimeFormat;
            let formatter = Reflect.construct(OrigDateTimeFormat, [locales, opts], target);
            if (!followsPage) return formatter;
            let currentZone = activeTimeZone;
            const methods = new Map();
            function refresh() {
                if (currentZone !== activeTimeZone) {
                    formatter = Reflect.construct(OrigDateTimeFormat, [locales, { ...opts, timeZone: activeTimeZone }], target);
                    currentZone = activeTimeZone;
                }
            }
            // Page code often caches formatters before asynchronous route detection completes.
            return new Proxy(formatter, {
                get(_base, property) {
                    refresh();
                    const value = Reflect.get(formatter, property, formatter);
                    if (typeof value !== 'function' || property === 'constructor') return value;
                    if (!methods.has(property)) methods.set(property, disguiseNative(function (...args) {
                        refresh();
                        return Reflect.apply(Reflect.get(formatter, property, formatter), formatter, args);
                    }, typeof property === 'string' ? property : value.name));
                    return methods.get(property);
                }
            });
        };
        PatchedDateTimeFormat.prototype = OrigDateTimeFormat.prototype;
        PatchedDateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;
        disguiseNative(PatchedDateTimeFormat, 'DateTimeFormat');
        targetWin.Intl.DateTimeFormat = PatchedDateTimeFormat;

        // 2. 动态维护 Offset 计算引擎
        let dtfParts = createDtfParts(activeTimeZone);
        function createDtfParts(tz) {
            return new OrigDateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
                hour12: false
            });
        }

        activeUpdaters.push((newTz) => {
            dtfParts = createDtfParts(newTz);
        });

        function getTargetOffset(date) {
            try {
                const parts = dtfParts.formatToParts(date);
                let y = 1970, m = 1, d = 1, h = 0, min = 0, s = 0;
                for (let i = 0; i < parts.length; i++) {
                    const p = parts[i];
                    if (p.type === 'year') y = parseInt(p.value, 10);
                    else if (p.type === 'month') m = parseInt(p.value, 10);
                    else if (p.type === 'day') d = parseInt(p.value, 10);
                    else if (p.type === 'hour') h = parseInt(p.value, 10);
                    else if (p.type === 'minute') min = parseInt(p.value, 10);
                    else if (p.type === 'second') s = parseInt(p.value, 10);
                }
                if (h === 24) h = 0;
                const targetUtc = OrigDate.UTC(y, m - 1, d, h, min, s);
                const origUtc = date.getTime() - date.getMilliseconds();
                return -Math.round((targetUtc - origUtc) / 60000);
            } catch (e) {
                return 0;
            }
        }

        // 3. Hook getTimezoneOffset
        OrigDate.prototype.getTimezoneOffset = disguiseNative(function getTimezoneOffset() {
            return getTargetOffset(this);
        }, 'getTimezoneOffset');

        // 4. 对齐本地时间 Getter
        function asShifted(d) {
            const offset = getTargetOffset(d);
            return new OrigDate(d.getTime() - offset * 60000);
        }

        OrigDate.prototype.getFullYear = disguiseNative(function getFullYear() { return asShifted(this).getUTCFullYear(); }, 'getFullYear');
        OrigDate.prototype.getMonth = disguiseNative(function getMonth() { return asShifted(this).getUTCMonth(); }, 'getMonth');
        OrigDate.prototype.getDate = disguiseNative(function getDate() { return asShifted(this).getUTCDate(); }, 'getDate');
        OrigDate.prototype.getDay = disguiseNative(function getDay() { return asShifted(this).getUTCDay(); }, 'getDay');
        OrigDate.prototype.getHours = disguiseNative(function getHours() { return asShifted(this).getUTCHours(); }, 'getHours');
        OrigDate.prototype.getMinutes = disguiseNative(function getMinutes() { return asShifted(this).getUTCMinutes(); }, 'getMinutes');
        OrigDate.prototype.getSeconds = disguiseNative(function getSeconds() { return asShifted(this).getUTCSeconds(); }, 'getSeconds');

    }

})();
