// ==UserScript==
// @name         自动同步代理时区 (Proxy Timezone Sync) v2.1 (静默版)
// @namespace    https://antigravity.assistant/
// @version      2.1.2
// @description  仅在指定 AI 服务及相关站点同步代理出口时区，其他网页保持系统时区（全静默无阻断）
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
// @connect      api.ip.sb
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


    const CACHE_KEY = 'PROXY_TZ_CACHE_V2';
    const OVERRIDE_KEY = 'MANUAL_TZ_OVERRIDE';
    const CACHE_EXPIRE_MS = 15 * 60 * 1000; // 缓存 15 分钟

    const cachedData = GM_getValue(CACHE_KEY, null);
    const manualTz = GM_getValue(OVERRIDE_KEY, '');

    // 当前生效时区状态（支持动态热更新）
    let activeTimeZone = manualTz || (cachedData && cachedData.timeZone) || 'America/Los_Angeles';

    // 格式化器列表，用于时区变动时动态同步
    const activeUpdaters = [];

    // 1. 穿透注入全局上下文
    applyTimezoneHook();

    // 2. 检查是否需要更新代理 IP 时区（后台静默检测）
    const now = Date.now();
    if (!manualTz && (!cachedData || (now - cachedData.timestamp > CACHE_EXPIRE_MS))) {
        detectProxyTimezone(false);
    }

    // 3. 快捷菜单
    GM_registerMenuCommand(`🔄 立即检测代理时区 (当前生效: ${activeTimeZone})`, () => {
        detectProxyTimezone(true);
    });

    GM_registerMenuCommand(`⚙️ 手动指定时区 (留空恢复自动)`, () => {
        const current = GM_getValue(OVERRIDE_KEY, '');
        const input = prompt('输入目标时区名（例如 America/New_York、Asia/Tokyo、Europe/London），留空恢复自动检测：', current);
        if (input !== null) {
            const trimmed = input.trim();
            GM_setValue(OVERRIDE_KEY, trimmed);
            if (trimmed) {
                switchActiveTimeZone(trimmed);
            } else {
                const refreshed = GM_getValue(CACHE_KEY, null);
                switchActiveTimeZone((refreshed && refreshed.timeZone) || 'America/Los_Angeles');
            }
        }
    });

    GM_registerMenuCommand(`🧪 打印当前时区诊断信息`, () => {
        const currentIntl = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const currentOffset = new Date().getTimezoneOffset();
        const dateStr = new Date().toString();
        alert(`【时区诊断】\n当前生效时区: ${currentIntl}\nOffset 偏移量: ${currentOffset} 分钟\n时间字符串: ${dateStr}`);
    });

    // ========================================================
    // 动态时区切换（热更新，无需刷新页面）
    // ========================================================
    function switchActiveTimeZone(newTz) {
        if (!newTz || newTz === activeTimeZone) return;
        activeTimeZone = newTz;
        activeUpdaters.forEach(fn => {
            try { fn(newTz); } catch (e) {}
        });
        console.log(
            `%c[TimezoneSync] 🔄 时区已静默热更新为: ${newTz}`,
            'color: #0284c7; font-weight: bold; background: #f0f9ff; padding: 2px 6px; border-radius: 4px;'
        );
    }

    // ========================================================
    // 核心 Hook
    // ========================================================
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
            if (!opts.timeZone) {
                opts.timeZone = activeTimeZone;
            }
            if (!(this instanceof PatchedDateTimeFormat)) {
                return new OrigDateTimeFormat(locales, opts);
            }
            return Reflect.construct(OrigDateTimeFormat, [locales, opts], new.target || PatchedDateTimeFormat);
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

        // 控制台初始状态输出
        const offsetVal = getTargetOffset(new OrigDate());
        console.log(
            `%c[TimezoneSync] ✅ 代理时区已穿透注入: ${activeTimeZone} (Offset: ${offsetVal})`,
            'color: #10b981; font-weight: bold; background: #ecfdf5; padding: 3px 8px; border-radius: 4px; border: 1px solid #a7f3d0;'
        );
    }

    // ========================================================
    // 代理 IP 探测
    // ========================================================
    function detectProxyTimezone(isManual) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://ipwho.is/',
            timeout: 6000,
            onload: function (res) {
                try {
                    const data = JSON.parse(res.responseText);
                    if (data && data.success !== false && data.timezone && data.timezone.id) {
                        saveResult(data.ip, data.timezone.id, isManual);
                        return;
                    }
                } catch (e) {}
                fallbackFetch(isManual);
            },
            onerror: () => fallbackFetch(isManual),
            ontimeout: () => fallbackFetch(isManual)
        });
    }

    function fallbackFetch(isManual) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.ip.sb/geoip',
            timeout: 6000,
            onload: function (res) {
                try {
                    const data = JSON.parse(res.responseText);
                    if (data && data.timezone) {
                        saveResult(data.ip, data.timezone, isManual);
                        return;
                    }
                } catch (e) {}
                if (isManual) alert('探测代理时区失败，请检查网络。');
            },
            onerror: () => { if (isManual) alert('连接网络错误。'); }
        });
    }

    function saveResult(ip, timeZone, isManual) {
        GM_setValue(CACHE_KEY, { ip, timeZone, timestamp: Date.now() });

        // 如果未锁定手动时区，则无缝切换到新时区
        if (!GM_getValue(OVERRIDE_KEY, '')) {
            switchActiveTimeZone(timeZone);
        }

        // 仅在用户手动点击菜单探测时才弹窗反馈，自动检测时 100% 静默无感
        if (isManual) {
            alert(`✅ 探测成功！\n出口 IP: ${ip}\n对应时区: ${timeZone}`);
        }
    }
})();