import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createResolver, concreteChain, siteRoute } from '../bridge/routes.mjs';
import { createBridgeServer } from '../bridge/server.mjs';

function fixture() {
    const state = { sites: { 'chatgpt.com': ['JP', 'AI'], 'claude.ai': ['LAX', 'clean-pool'] }, probeChain: [], port: 0, lookups: [], opens: [], closes: 0, stamp: 1, onLookup: null };
    const nodes = { JP: { name: 'JP', type: 'Shadowsocks' }, LAX: { name: 'LAX', type: 'Vless' } };
    const groups = { AI: { type: 'Selector' }, 'clean-pool': { type: 'Selector' } };
    const controller = async request => {
        if (request === '/proxies') return { proxies: groups };
        if (request === '/providers/proxies') return { providers: { subscription: { proxies: Object.values(nodes) } } };
        if (request === '/connections') return { connections: [
            ...Object.entries(state.sites).map(([host, chains]) => ({ metadata: { host }, chains })),
            { metadata: { host: 'ipwho.is', sourcePort: '12345', inboundPort: String(state.port) }, chains: state.probeChain }
        ] };
        throw new Error('Unexpected controller operation');
    };
    const openProbe = async port => {
        state.opens.push(port);
        state.port = port;
        state.probeChain = port === 7897 ? ['JP', 'AI'] : ['LAX', 'clean-pool'];
        return { sourcePort: 12345, close() { state.closes++; }, async lookup() {
            state.lookups.push(port);
            state.onLookup?.();
            return { ip: port === 7897 ? '203.0.113.1' : '203.0.113.2', timeZone: port === 7897 ? 'Asia/Tokyo' : 'America/Los_Angeles' };
        } };
    };
    return { state, resolve: createResolver({ controller, openProbe, probePorts: [7897, 17897], instanceId: 'machine', now: () => state.stamp }) };
}

test('Two websites resolve through their different actual proxy chains', async () => {
    const { state, resolve } = fixture();
    const jp = await resolve('chatgpt.com');
    const us = await resolve('claude.ai');
    assert.equal(jp.timeZone, 'Asia/Tokyo');
    assert.equal(us.timeZone, 'America/Los_Angeles');
    assert.deepEqual(state.lookups, [7897, 17897]);
    assert.equal(state.opens.length, state.closes);
});

test('Cache is per website, and hits still establish a route-verified tunnel', async () => {
    const { state, resolve } = fixture();
    await resolve('chatgpt.com');
    await resolve('chatgpt.com');
    state.sites['claude.ai'] = ['JP', 'AI'];
    await resolve('claude.ai');
    assert.equal(state.opens.length, 3);
    assert.equal(state.lookups.length, 2);
});

test('A changed route invalidates the old result and uses the other listener', async () => {
    const { state, resolve } = fixture();
    await resolve('chatgpt.com');
    state.sites['chatgpt.com'] = ['LAX', 'clean-pool'];
    assert.equal((await resolve('chatgpt.com')).timeZone, 'America/Los_Angeles');
    assert.deepEqual(state.lookups, [7897, 17897]);
});

test('Mid-probe route changes cannot return or cache the stale result', async () => {
    const { state, resolve } = fixture();
    state.onLookup = () => { state.sites['chatgpt.com'] = ['LAX', 'clean-pool']; };
    await assert.rejects(resolve('chatgpt.com'));
    state.onLookup = null;
    state.sites['chatgpt.com'] = ['JP', 'AI'];
    await resolve('chatgpt.com');
    assert.equal(state.lookups.length, 2);
});

test('No matching listener or missing site connection does not guess a timezone', async () => {
    const { state, resolve } = fixture();
    state.sites['claude.ai'] = ['OTHER'];
    await assert.rejects(resolve('claude.ai'));
    delete state.sites['chatgpt.com'];
    await assert.rejects(resolve('chatgpt.com'));
    assert.equal(state.lookups.length, 0);
});

test('Ambiguous process/load-balancer routes are rejected', () => {
    const proxies = { JP: { type: 'Shadowsocks' }, LAX: { type: 'Vless' } };
    assert.throws(() => siteRoute([{ metadata: { host: 'claude.ai' }, chains: ['JP'] }, { metadata: { host: 'claude.ai' }, chains: ['LAX'] }], 'claude.ai', proxies));
    assert.throws(() => concreteChain({ chains: ['unknown'] }, proxies));
});

test('Manual refresh bypasses geo cache, TTL expiry also refreshes', async () => {
    const { state, resolve } = fixture();
    await resolve('chatgpt.com');
    await resolve('chatgpt.com', true);
    state.stamp += 15 * 60 * 1000;
    await resolve('chatgpt.com');
    assert.equal(state.lookups.length, 3);
});

test('Bridge exposes only authenticated, loopback, AI-specific read operations', async t => {
    const config = { port: 0, token: 'a'.repeat(64) };
    let calls = 0;
    const server = createBridgeServer({ config, domains: ['claude.ai'], resolve: async () => { calls++; return { timeZone: 'Asia/Tokyo' }; } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    config.port = server.address().port;
    t.after(() => new Promise(resolve => server.close(resolve)));
    const root = 'http://127.0.0.1:' + config.port;
    const headers = { Authorization: 'Bearer ' + config.token };
    assert.equal((await fetch(root + '/v1/timezone?host=claude.ai')).status, 401);
    assert.equal((await fetch(root + '/v1/timezone?host=localhost', { headers })).status, 400);
    assert.equal((await fetch(root + '/v1/timezone?host=claude.ai.evil.test', { headers })).status, 400);
    assert.equal((await fetch(root + '/configs', { headers })).status, 404);
    assert.equal((await fetch(root + '/v1/timezone?host=claude.ai', { method: 'POST', headers })).status, 405);
    const wrongHostStatus = await new Promise((resolve, reject) => {
        const request = http.get(root + '/v1/health', { headers: { ...headers, Host: 'evil.test' } }, response => {
            response.resume();
            resolve(response.statusCode);
        });
        request.on('error', reject);
    });
    assert.equal(wrongHostStatus, 403);
    assert.equal(calls, 0);
    assert.equal((await fetch(root + '/v1/timezone?host=claude.ai', { headers })).status, 200);
    assert.equal(calls, 1);
});
