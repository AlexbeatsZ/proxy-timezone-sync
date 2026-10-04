import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../proxy-timezone-sync.user.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const token = 'a'.repeat(64);

function page(url, storage = new Map()) {
    const requests = [], menus = new Map();
    let gmReads = 0;
    const context = vm.createContext({ location: new URL(url), URL, AbortController, console: { log() {}, error() {} },
        document: { hidden: false, addEventListener() {} }, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
        GM_getValue(key, fallback) { gmReads++; return storage.has(key) ? storage.get(key) : fallback; },
        GM_setValue(key, value) { storage.set(key, value); },
        GM_registerMenuCommand(label, action) { menus.set(label, action); },
        GM_xmlhttpRequest(details) { requests.push({ ...details, transport: 'extension' }); return { abort() {} }; },
        fetch(url, details) { return new Promise(resolve => requests.push({ ...details, url, transport: 'page', resolve })); },
        alert() {}, prompt() { return null; }
    });
    vm.runInContext('window = globalThis; unsafeWindow = globalThis; nativeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; nativeFormat = Intl.DateTimeFormat; nativeHours = Date.prototype.getHours;', context);
    vm.runInContext(source, context);
    return { context, storage, requests, menus, reads: () => gmReads,
        zone: () => vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context),
        respond(index, status, text, finalUrl) {
            const request = requests[index];
            const responseUrl = finalUrl || request.url;
            if (request.transport === 'page') request.resolve({ status, url: responseUrl, text: async () => text });
            else request.onload({ status, responseText: text, finalUrl: responseUrl });
        } };
}

test('Old global timezone values do not affect a new website', () => {
    const current = page('https://claude.ai/', new Map([['PROXY_TZ_CACHE_V2', { timeZone: 'Asia/Tokyo' }], ['MANUAL_TZ_OVERRIDE', 'Asia/Tokyo']]));
    assert.equal(current.zone(), current.context.nativeZone);
    assert.equal(current.requests[0].url, 'https://claude.ai/cdn-cgi/trace');
    assert.equal(current.requests[0].transport, 'page');
});

test('Trace geolocation queries the website IP explicitly and updates cached default formatters', async () => {
    const current = page('https://chatgpt.com/');
    vm.runInContext('held = Intl.DateTimeFormat("en", {hour:"numeric", hour12:false}); explicit = Intl.DateTimeFormat("en", {timeZone:"UTC"});', current.context);
    current.respond(0, 200, 'h=chatgpt.com\nip=203.0.113.1\nts=123\nloc=JP\n');
    await tick();
    assert.equal(current.requests[1].url, 'https://ipwho.is/203.0.113.1?fields=success,ip,timezone.id');
    assert.equal(current.requests[1].transport, 'extension');
    current.respond(1, 200, JSON.stringify({ success: true, ip: '203.0.113.1', timezone: { id: 'Asia/Tokyo' } }));
    await tick();
    assert.equal(current.zone(), 'Asia/Tokyo');
    assert.equal(vm.runInContext('held.resolvedOptions().timeZone', current.context), 'Asia/Tokyo');
    assert.equal(vm.runInContext('explicit.resolvedOptions().timeZone', current.context), 'UTC');
    assert.equal(vm.runInContext('new Date(1791062316000).getHours()', current.context), 6);
    assert.equal(current.storage.get('PROXY_TZ_CACHE_V3:chatgpt.com').evidence, 'site-ip');
});

test('A site without trace uses a verified local bridge result', async () => {
    const current = page('https://claude.ai/', new Map([['PROXY_TZ_BRIDGE_V3', { url: 'http://127.0.0.1:17898', token }]]));
    current.respond(0, 404, 'not a trace');
    await tick();
    assert.equal(current.requests[1].method, 'HEAD');
    assert.equal(current.requests[1].transport, 'page');
    current.respond(1, 200, '');
    await tick();
    assert(current.requests[2].url.includes('host=claude.ai'));
    current.respond(2, 200, JSON.stringify({ host: 'claude.ai', timeZone: 'America/Los_Angeles', ip: '203.0.113.2', evidence: 'verified-proxy-chain', route: ['LAX'], routeId: 'machine:LAX', verifiedAt: Date.now() }));
    await tick();
    assert.equal(current.zone(), 'America/Los_Angeles');
    assert.equal(vm.runInContext('new Date(1791062316000).getHours()', current.context), 14);
});

test('An unverified or redirected trace cannot become a global IP probe fallback', async () => {
    const current = page('https://gemini.google.com/');
    current.respond(0, 200, 'h=gemini.google.com\nip=203.0.113.1\nts=1\nloc=JP', 'https://evil.test/trace');
    await tick();
    assert.equal(current.requests.length, 1);
    assert.equal(current.zone(), current.context.nativeZone);
});

test('Late automatic detection cannot overwrite a newer site manual choice', async () => {
    const current = page('https://chatgpt.com/');
    current.context.prompt = () => 'America/Los_Angeles';
    current.menus.get('⚙️ 手动指定此网站时区')();
    current.respond(0, 200, 'h=chatgpt.com\nip=203.0.113.1\nts=1\nloc=JP');
    await tick();
    current.respond(1, 200, JSON.stringify({ ip: '203.0.113.1', timezone: { id: 'Asia/Tokyo' } }));
    await tick();
    assert.equal(current.zone(), 'America/Los_Angeles');
    assert(!current.storage.has('PROXY_TZ_CACHE_V3:chatgpt.com'));
});

test('Manual settings are isolated between sites, even with shared GM storage', () => {
    const storage = new Map();
    const gpt = page('https://chatgpt.com/', storage);
    gpt.context.prompt = () => 'Asia/Tokyo';
    gpt.menus.get('⚙️ 手动指定此网站时区')();
    const claude = page('https://claude.ai/', storage);
    assert.equal(claude.zone(), claude.context.nativeZone);
    assert.equal(gpt.zone(), 'Asia/Tokyo');
});

test('Unknown bridge responses and stale cache leave native time in place', async () => {
    const current = page('https://claude.ai/', new Map([['PROXY_TZ_CACHE_V3:claude.ai', { timeZone: 'Asia/Tokyo' }], ['PROXY_TZ_BRIDGE_V3', { url: 'http://127.0.0.1:17898', token }]]));
    assert.equal(current.zone(), current.context.nativeZone);
    current.respond(0, 404, ''); await tick();
    current.respond(1, 200, ''); await tick();
    current.respond(2, 409, '{}'); await tick();
    assert.equal(current.zone(), current.context.nativeZone);
});

test('QQ, local networks, generic domains and deceptive names remain untouched', () => {
    for (const url of ['http://127.0.0.1:8081/', 'http://100.106.169.46:8081/', 'http://192.168.31.32:8081/', 'https://qq.com/', 'https://google.com/', 'https://mail.google.com/', 'https://x.com/i/grok', 'https://evilchatgpt.com/', 'https://chatgpt.com.evil.test/', 'https://claude.ai@evil.test/', 'about:blank']) {
        const current = page(url);
        assert.equal(current.reads(), 0, url);
        assert.equal(current.requests.length, 0, url);
        assert.equal(vm.runInContext('Intl.DateTimeFormat === nativeFormat && Date.prototype.getHours === nativeHours', current.context), true, url);
    }
});
