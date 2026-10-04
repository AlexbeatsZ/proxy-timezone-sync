const GROUP_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay', 'Smart']);

export function aiHostsFromSource(source) {
    const block = source.match(/const AI_HOSTS = \[([\s\S]*?)\];/);
    if (!block) throw new Error('AI hostname policy is missing');
    return [...block[1].matchAll(/'([a-z0-9.-]+)'/g)].map(match => match[1]);
}

export function allowedHost(host, domains) {
    return typeof host === 'string' && /^[a-z0-9.-]+$/.test(host) &&
        domains.some(domain => host === domain || host.endsWith('.' + domain));
}

export function concreteChain(connection, proxies) {
    if (!Array.isArray(connection?.chains) || !connection.chains.length) throw new Error('Missing connection chain');
    const chain = connection.chains.filter(name => {
        const proxy = proxies[name];
        if (!proxy) throw new Error('Unknown proxy in connection chain');
        return !GROUP_TYPES.has(proxy.type);
    });
    if (!chain.length) throw new Error('No concrete outbound was observed');
    return JSON.stringify(chain);
}

export function siteRoute(connections, host, proxies) {
    const matches = connections.filter(connection =>
        (connection.metadata?.host || '').toLowerCase().replace(/\.$/, '') === host
    );
    if (!matches.length) throw new Error('No live connection for this website');
    const routes = [...new Set(matches.map(connection => concreteChain(connection, proxies)))];
    if (routes.length !== 1) throw new Error('Website connections use different outbounds');
    return routes[0];
}

export function probeRoute(connections, sourcePort, inboundPort, proxies) {
    const matches = connections.filter(connection =>
        Number(connection.metadata?.sourcePort) === Number(sourcePort) &&
        Number(connection.metadata?.inboundPort) === Number(inboundPort) &&
        connection.metadata?.host === 'ipwho.is'
    );
    if (matches.length !== 1) throw new Error('Could not correlate the probe connection');
    return concreteChain(matches[0], proxies);
}

export function createResolver({ controller, openProbe, probePorts, instanceId, now = Date.now }) {
    const cache = new Map();
    async function snapshot() {
        const [data, proxyData, providers] = await Promise.all([controller('/connections'), controller('/proxies'), controller('/providers/proxies')]);
        const nodes = {};
        for (const provider of Object.values(providers.providers || {})) {
            for (const node of provider.proxies || []) nodes[node.name] = node;
        }
        return { connections: data.connections || [], proxies: { ...nodes, ...(proxyData.proxies || {}) } };
    }
    return async (host, fresh = false) => {
        const before = await snapshot();
        const route = siteRoute(before.connections, host, before.proxies);
        const key = host + ':' + route;
        for (const port of probePorts) {
            let probe;
            try {
                probe = await openProbe(port);
                const observed = await snapshot();
                if (siteRoute(observed.connections, host, observed.proxies) !== route ||
                    probeRoute(observed.connections, probe.sourcePort, port, observed.proxies) !== route) continue;
                let result = cache.get(key);
                if (fresh || !result || now() - result.timestamp >= 15 * 60 * 1000) {
                    result = { ...(await probe.lookup()), timestamp: now() };
                }
                const after = await snapshot();
                if (siteRoute(after.connections, host, after.proxies) !== route) throw new Error('Website route changed during detection');
                const stamp = now();
                // Cache only a fully verified result, never failed/ambiguous observations.
                cache.set(key, result);
                if (cache.size > 128) cache.delete(cache.keys().next().value);
                return { ...result, host, route: JSON.parse(route), routeId: instanceId + ':' + route, verifiedAt: stamp, evidence: 'verified-proxy-chain' };
            } catch { /* An unavailable listener must not prevent trying another existing one. */ }
            finally { probe?.close(); }
        }
        throw new Error('No existing listener could probe the website outbound');
    };
}
