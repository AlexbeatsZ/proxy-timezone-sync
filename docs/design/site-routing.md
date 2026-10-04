# Site-specific timezone selection

## User requirement

Windows and Mac route different AI websites through different exits (ordinary proxy and clean-pool). A request to a generic IP service follows that service's rule, not the current page's rule. Never apply one global probe/cache/manual override to all sites.

## Evidence and precedence

1. An explicit manual override belongs to one exact hostname.
2. A valid Cloudflare `/cdn-cgi/trace` response from the current origin supplies the IP seen by that website. Fetch it with the page's captured native fetch so per-tab proxy rules apply, rather than an extension-background GM request. Query the timezone of that explicit IP; never use the IP service's implicit caller IP in this path. Reject redirects and malformed/non-trace bodies.
3. Optional local bridge: read live Mihomo connections for the exact page hostname; all observed connections must agree on the concrete outbound chain after removing policy-group wrappers. Open an IP-service CONNECT tunnel through an existing ordinary/clean listener, correlate its source port in Mihomo, and require the concrete chain to equal the page chain. Check the page chain again before returning a result. Never switch selectors, rewrite rules, or expose a controller forwarding endpoint.
4. If neither method can establish evidence, retain the native system timezone. Ignore old global V2 cache/override automatically; preserve those storage keys for explicit user migration.

A single hostname can have ambiguous routes because of process rules, load balancing or live old connections. Return an unresolved result rather than choosing the most recent connection or assuming a group/port name implies a location. Comparing chains identifies the proxy used, not an absolute guarantee against a proxy operator changing its public egress per destination.

## Cache and changes

The bridge caches geolocation per hostname and concrete route, for at most 15 minutes. Every hit still establishes a fresh probe tunnel and validates its chain and the current site's chain. Userscript persistence is per hostname and is diagnostic only; do not apply automatic cached timezones at document-start without current route evidence. Periodic/visibility refreshes detect changes. Request generations stop delayed results overwriting a newer detection or manual setting.

## Bridge boundary

- Windows uses discovered production named pipes; Mac discovers the running Unix socket including `external-controller-unix` in the current Clash Verge configuration. Only GET `/version`, `/configs`, `/connections`, `/proxies`, `/providers/proxies` is permitted by the client.
- HTTP bridge binds only `127.0.0.1:17898`. Authentication token and machine identity live in ignored `.runtime/` files, never in the published userscript or Git history.
- Only fixed endpoints and AI hostnames from the userscript allowlist are accepted. No arbitrary URL/proxy/controller operations. Loopback Host/peer checks and token authentication are required; no permissive CORS.
- Existing proxy listener ports are explicit local configuration. A listener's name/config is not sufficient proof: actual tunnel-chain observation is mandatory.
- Run the helper from the project; no global dependencies or proxy changes. Login startup registration, if requested, requires user approval because it writes outside the project.

## Verification

Exercise two simultaneous sites on different routes, selector changes, mismatched probes, ambiguous connections, late responses, legacy global values, explicit-IP lookup and excluded sites. Use live Windows/Mac controller/proxy evidence separately from VM tests. Installation into Tampermonkey remains user action when browser extension settings are blocked.
