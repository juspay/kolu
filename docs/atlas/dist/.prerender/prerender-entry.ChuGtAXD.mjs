import { a as enumerable_symbols, c as is_primitive, d as valid_array_indices, f as __commonJSMin, i as DevalueError, l as stringify_key, n as unflatten$1, o as get_type, r as encode64, s as is_plain_object, t as parse$1, u as stringify_string } from "./chunks/parse_yGtCHcSr.mjs";
import { a as fileExtension, f as removeLeadingForwardSlash, g as trimSlashes, h as slash, i as collapseDuplicateTrailingSlashes, l as joinPaths, m as removeTrailingForwardSlash, n as collapseDuplicateLeadingSlashes, o as hasFileExtension, r as collapseDuplicateSlashes, s as isInternalPath, t as appendForwardSlash, u as prependForwardSlash } from "./chunks/path_DR6eUnqp.mjs";
import { n as matchPattern } from "./chunks/remote_DDCxf2My.mjs";
import { $ as i18nNoLocaleFoundInPath, D as MiddlewareNotAResponse, E as MiddlewareNoDataOrNextCalled, F as NoMatchingStaticPathFound, G as SessionStorageInitError, H as ReservedSlotName, J as UnableToLoadLogger, K as SessionStorageSaveError, L as PageNumberParamNotFound, R as PrerenderClientAddressNotAvailable, T as LocalsReassigned, U as ResponseSentError, W as RewriteWithBodyUsed, _ as GetStaticPathsRequired, a as AstroResponseHeadersReassigned, b as InvalidGetStaticPathsEntry, g as GetStaticPathsInvalidRouteParam, h as GetStaticPathsExpectedParams, i as ActionsReturnedInvalidDataError, n as AstroUserError, o as CacheNotEnabled, p as ForbiddenRewrite, q as StaticClientAddressNotAvailable, r as ActionNotFoundError, s as ClientAddressNotAvailable, t as AstroError, w as LocalsNotAnObject, x as InvalidGetStaticPathsReturn, z as PrerenderDynamicEndpointPathCollide } from "./chunks/errors_CqHSUxQm.mjs";
import { $ as s, A as normalizeCspResourceEntry, B as isRoute404, F as createVNode, G as REDIRECT_STATUS_CODES, H as ASTRO_ERROR_HEADER, J as clientAddressSymbol, K as REROUTABLE_STATUS_CODES, L as escape, N as isAstroComponentFactory, P as AstroJSX, Q as responseSentSymbol$1, R as renderEndpoint, U as ASTRO_GENERATOR, V as isRoute500, W as DEFAULT_404_COMPONENT, X as originPathnameSymbol, Y as fetchStateSymbol, Z as pipelineSymbol, _ as decryptString, a as renderPage, c as renderStreaming, d as createSlotValueFromString, g as decodeKey, h as renderTemplate, j as pushDirective, k as isRenderInstruction, m as isRenderTemplateResult, o as renderJSX, p as renderSlotToString, q as appSymbol, s as renderComponent, u as chunkToString, v as generateCspDigest } from "./chunks/server_ZVLTETd9.mjs";
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/i18n/path.js
function pathHasLocale(path, locales) {
	const segments = path.split("/").map(normalizeThePath);
	for (const segment of segments) for (const locale of locales) if (typeof locale === "string") {
		if (normalizeTheLocale(segment) === normalizeTheLocale(locale)) return true;
	} else if (segment === locale.path) return true;
	return false;
}
function normalizeTheLocale(locale) {
	return locale.replaceAll("_", "-").toLowerCase();
}
function normalizeThePath(path) {
	return path.endsWith(".html") ? path.slice(0, -5) : path;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/i18n/domain.js
function computePathnameFromDomain(request, url, i18n, base, trailingSlash, logger) {
	let pathname = void 0;
	if (i18n && (i18n.strategy === "domains-prefix-always" || i18n.strategy === "domains-prefix-other-locales" || i18n.strategy === "domains-prefix-always-no-redirect")) {
		let host = request.headers.get("X-Forwarded-Host");
		let protocol = request.headers.get("X-Forwarded-Proto");
		if (protocol) protocol = protocol + ":";
		else protocol = url.protocol;
		if (!host) host = request.headers.get("Host");
		if (host && protocol) {
			host = host.split(":")[0];
			try {
				let locale;
				const hostAsUrl = new URL(`${protocol}//${host}`);
				for (const [domainKey, localeValue] of Object.entries(i18n.domainLookupTable)) {
					const domainKeyAsUrl = new URL(domainKey);
					if (hostAsUrl.host === domainKeyAsUrl.host && hostAsUrl.protocol === domainKeyAsUrl.protocol) {
						locale = localeValue;
						break;
					}
				}
				if (locale) {
					pathname = prependForwardSlash(joinPaths(normalizeTheLocale(locale), removeBase(url.pathname, base)));
					if (trailingSlash === "always") pathname = appendForwardSlash(pathname);
					else if (trailingSlash === "never") pathname = removeTrailingForwardSlash(pathname);
					else if (url.pathname.endsWith("/")) pathname = appendForwardSlash(pathname);
				}
			} catch (e) {
				logger.error("router", `Astro tried to parse ${protocol}//${host} as an URL, but it threw a parsing error. Check the X-Forwarded-Host and X-Forwarded-Proto headers.`);
				logger.error("router", `Error: ${e}`);
			}
		}
	}
	return pathname;
}
function removeBase(pathname, base) {
	pathname = collapseDuplicateLeadingSlashes(pathname);
	if (pathname.startsWith(base)) return pathname.slice(removeTrailingForwardSlash(base).length + 1);
	return pathname;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/i18n/error-routes.js
function isLocalizedErrorRoute(route, status, locales) {
	if (!locales) return false;
	const suffix = `/${status}`;
	if (!route.endsWith(suffix)) return false;
	const localeSegment = route.slice(0, -suffix.length);
	if (!localeSegment || localeSegment.includes("/", 1)) return false;
	return pathHasLocale(localeSegment, locales);
}
function getErrorRoutePath(pathname, status, routes, locales, appendTrailingSlash = false) {
	const suffix = appendTrailingSlash ? "/" : "";
	if (locales) {
		const firstSegment = pathname.split("/").find(Boolean);
		if (firstSegment && pathHasLocale(`/${firstSegment}`, locales)) {
			const localized = `/${firstSegment}/${status}`;
			if (routes.some((route) => route.route === localized)) return `${localized}${suffix}`;
		}
	}
	return `/${status}${suffix}`;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/actions/noop-actions.js
var NOOP_ACTIONS_MOD = { server: {} };
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/middleware/defineMiddleware.js
function defineMiddleware(fn) {
	return fn;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/app/origin-check.js
var FORM_CONTENT_TYPES = [
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"text/plain"
];
var SAFE_METHODS = [
	"GET",
	"HEAD",
	"OPTIONS"
];
function isForbiddenCrossOriginRequest(request, url, isPrerendered) {
	if (isPrerendered) return false;
	if (SAFE_METHODS.includes(request.method)) return false;
	const isSameOrigin = request.headers.get("origin") === url.origin;
	if (request.headers.has("content-type")) return hasFormLikeHeader(request.headers.get("content-type")) && !isSameOrigin;
	return !isSameOrigin;
}
function createCrossOriginForbiddenResponse(request) {
	return new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
}
function createOriginCheckMiddleware() {
	return defineMiddleware((context, next) => {
		const { request, url, isPrerendered } = context;
		if (isForbiddenCrossOriginRequest(request, url, isPrerendered)) return createCrossOriginForbiddenResponse(request);
		return next();
	});
}
function hasFormLikeHeader(contentType) {
	if (contentType) {
		for (const FORM_CONTENT_TYPE of FORM_CONTENT_TYPES) if (contentType.toLowerCase().includes(FORM_CONTENT_TYPE)) return true;
	}
	return false;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/core.js
var dateTimeFormat = new Intl.DateTimeFormat([], {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false
});
var levels = {
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	silent: 90
};
function log(opts, level, label, message, newLine = true) {
	const logLevel = opts.level;
	const dest = opts.destination;
	const event = {
		label,
		level,
		message,
		newLine
	};
	if (!isLogLevelEnabled(logLevel, level)) return;
	dest.write(event);
}
function isLogLevelEnabled(configuredLogLevel, level) {
	return levels[configuredLogLevel] <= levels[level];
}
function info(opts, label, message, newLine = true) {
	return log(opts, "info", label, message, newLine);
}
function warn(opts, label, message, newLine = true) {
	return log(opts, "warn", label, message, newLine);
}
function error(opts, label, message, newLine = true) {
	return log(opts, "error", label, message, newLine);
}
function debug(...args) {
	if ("_astroGlobalDebug" in globalThis) globalThis._astroGlobalDebug(...args);
}
function getEventPrefix({ level, label }) {
	const timestamp = `${dateTimeFormat.format(/* @__PURE__ */ new Date())}`;
	const prefix = [];
	if (level === "error" || level === "warn") {
		prefix.push(s.bold(timestamp));
		prefix.push(`[${level.toUpperCase()}]`);
	} else prefix.push(timestamp);
	if (label) prefix.push(`[${label}]`);
	if (level === "error") return s.red(prefix.join(" "));
	if (level === "warn") return s.yellow(prefix.join(" "));
	if (prefix.length === 1) return s.dim(prefix[0]);
	return s.dim(prefix[0]) + " " + s.blue(prefix.splice(1).join(" "));
}
var AstroLogger = class {
	options;
	constructor(options) {
		this.options = options;
	}
	info(label, message, newLine = true) {
		info(this.options, label, message, newLine);
	}
	warn(label, message, newLine = true) {
		warn(this.options, label, message, newLine);
	}
	error(label, message, newLine = true) {
		error(this.options, label, message, newLine);
	}
	debug(label, ...messages) {
		debug(label, ...messages);
	}
	level() {
		return this.options.level;
	}
	forkIntegrationLogger(label) {
		return new AstroIntegrationLogger(this.options, label);
	}
	setDestination(destination) {
		this.options.destination = destination;
	}
	/**
	* It calls the `close` function of the provided destination, if it exists.
	*/
	close() {
		if (this.options.destination.close) this.options.destination.close();
	}
	/**
	* It calls the `flush` function of the provided destination, if it exists.
	*/
	flush() {
		if (this.options.destination.flush) this.options.destination.flush();
	}
};
var AstroIntegrationLogger = class AstroIntegrationLogger {
	options;
	label;
	constructor(logging, label) {
		this.options = logging;
		this.label = label;
	}
	/**
	* Creates a new logger instance with a new label, but the same log options.
	*/
	fork(label) {
		return new AstroIntegrationLogger(this.options, label);
	}
	info(message) {
		info(this.options, this.label, message);
	}
	warn(message) {
		warn(this.options, this.label, message);
	}
	error(message) {
		error(this.options, this.label, message);
	}
	debug(message) {
		debug(this.label, message);
	}
	/**
	* It calls the `flush` function of the provided destination, if it exists.
	*/
	flush() {
		if (this.options.destination.flush) this.options.destination.flush();
	}
	/**
	* It calls the `close` function of the provided destination, if it exists.
	*/
	close() {
		if (this.options.destination.close) this.options.destination.close();
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/middleware/noop-middleware.js
var NOOP_MIDDLEWARE_FN = async (_ctx, next) => {
	return await next();
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/helpers.js
function routeIsRedirect(route) {
	return route?.type === "redirect";
}
function routeIsFallback(route) {
	return route?.type === "fallback";
}
function getFallbackRoute(route, routeList) {
	const fallbackRoute = routeList.find((r) => {
		if (route.route === "/" && r.routeData.route === "/") return true;
		return r.routeData.fallbackRoutes.find((f) => {
			return f.route === route.route;
		});
	});
	if (!fallbackRoute) throw new Error(`No fallback route found for route ${route.route}`);
	return fallbackRoute.routeData;
}
function getCustom404Route(manifestData) {
	return manifestData.routes.find((r) => isRoute404(r.route));
}
function routeHasHtmlExtension(route) {
	return route.segments.some((segment) => segment.some((part) => !part.dynamic && part.content.includes(".html")));
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/generator.js
function sanitizeParams(params) {
	return Object.fromEntries(Object.entries(params).map(([key, value]) => {
		if (typeof value === "string") return [key, value.normalize().replace(/#/g, "%23").replace(/\?/g, "%3F")];
		return [key, value];
	}));
}
function getParameter(part, params) {
	if (part.spread) return params[part.content.slice(3)] ?? "";
	if (part.dynamic) {
		if (params[part.content] === void 0) throw new TypeError(`Missing parameter: ${part.content}`);
		return params[part.content];
	}
	return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]");
}
function getSegment(segment, params) {
	const segmentPath = segment.map((part) => getParameter(part, params)).join("");
	return segmentPath ? collapseDuplicateLeadingSlashes("/" + segmentPath) : "";
}
function getRouteGenerator(segments, addTrailingSlash) {
	return (params) => {
		const sanitizedParams = sanitizeParams(params);
		let trailing = "";
		if (addTrailingSlash === "always" && segments.length) trailing = "/";
		return segments.map((segment) => getSegment(segment, sanitizedParams)).join("") + trailing || "/";
	};
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/internal/validation.js
var VALID_PARAM_TYPES = ["string", "undefined"];
function validateGetStaticPathsParameter([key, value], route) {
	if (!VALID_PARAM_TYPES.includes(typeof value)) throw new AstroError({
		...GetStaticPathsInvalidRouteParam,
		message: GetStaticPathsInvalidRouteParam.message(key, value, typeof value),
		location: { file: route }
	});
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/params.js
function stringifyParams(params, route, trailingSlash) {
	if (route.type === "endpoint" && hasFileExtension(route.route)) trailingSlash = "never";
	const validatedParams = {};
	for (const [key, value] of Object.entries(params)) {
		validateGetStaticPathsParameter([key, value], route.component);
		if (value !== void 0) validatedParams[key] = trimSlashes(value);
	}
	return getRouteGenerator(route.segments, trailingSlash)(validatedParams);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/validation.js
function validateDynamicRouteModule(mod, { ssr, route }) {
	if ((!ssr || route.prerender) && route.origin !== "internal" && !mod.getStaticPaths) throw new AstroError({
		...GetStaticPathsRequired,
		location: { file: route.component }
	});
}
function validateGetStaticPathsResult(result, route) {
	if (!Array.isArray(result)) throw new AstroError({
		...InvalidGetStaticPathsReturn,
		message: InvalidGetStaticPathsReturn.message(typeof result),
		location: { file: route.component }
	});
	result.forEach((pathObject) => {
		if (typeof pathObject === "object" && Array.isArray(pathObject) || pathObject === null) throw new AstroError({
			...InvalidGetStaticPathsEntry,
			message: InvalidGetStaticPathsEntry.message(Array.isArray(pathObject) ? "array" : typeof pathObject)
		});
		if (pathObject.params === void 0 || pathObject.params === null || pathObject.params && Object.keys(pathObject.params).length === 0) throw new AstroError({
			...GetStaticPathsExpectedParams,
			location: { file: route.component }
		});
	});
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/render/paginate.js
function generatePaginateFunction(routeMatch, base, trailingSlash) {
	return function paginateUtility(data, args = {}) {
		const generate = getRouteGenerator(routeMatch.segments, trailingSlash);
		let { pageSize: _pageSize, params: _params, props: _props, format: _format } = args;
		const pageSize = _pageSize || 10;
		const paramName = "page";
		const additionalParams = _params || {};
		const additionalProps = _props || {};
		const formatUrl = _format || ((url) => url);
		let includesFirstPageNumber;
		if (routeMatch.params.includes(`...${paramName}`)) includesFirstPageNumber = false;
		else if (routeMatch.params.includes(`${paramName}`)) includesFirstPageNumber = true;
		else throw new AstroError({
			...PageNumberParamNotFound,
			message: PageNumberParamNotFound.message(paramName)
		});
		const lastPage = Math.max(1, Math.ceil(data.length / pageSize));
		return [...Array(lastPage).keys()].map((num) => {
			const pageNum = num + 1;
			const start = pageSize === Number.POSITIVE_INFINITY ? 0 : (pageNum - 1) * pageSize;
			const end = Math.min(start + pageSize, data.length);
			const params = {
				...additionalParams,
				[paramName]: includesFirstPageNumber || pageNum > 1 ? String(pageNum) : void 0
			};
			const current = formatUrl(addRouteBase(generate({ ...params }), base));
			const next = pageNum === lastPage ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: String(pageNum + 1)
			}), base));
			const prev = pageNum === 1 ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: !includesFirstPageNumber && pageNum - 1 === 1 ? void 0 : String(pageNum - 1)
			}), base));
			const first = pageNum === 1 ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: includesFirstPageNumber ? "1" : void 0
			}), base));
			const last = pageNum === lastPage ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: String(lastPage)
			}), base));
			return {
				params,
				props: {
					...additionalProps,
					page: {
						data: data.slice(start, end),
						start,
						end: end - 1,
						size: pageSize,
						total: data.length,
						currentPage: pageNum,
						lastPage,
						url: {
							current,
							next,
							prev,
							first,
							last
						}
					}
				}
			};
		});
	};
}
function addRouteBase(route, base) {
	let routeWithBase = joinPaths(base, route);
	if (routeWithBase === "") routeWithBase = "/";
	return routeWithBase;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/render/route-cache.js
async function callGetStaticPaths({ mod, route, routeCache, ssr, base, trailingSlash }) {
	const cached = routeCache.get(route);
	if (!mod) throw new Error("This is an error caused by Astro and not your code. Please file an issue.");
	if (cached?.staticPaths && cached.mod === mod) return cached.staticPaths;
	validateDynamicRouteModule(mod, {
		ssr,
		route
	});
	if (ssr && !route.prerender || route.origin === "internal") {
		const entry = Object.assign([], { keyed: /* @__PURE__ */ new Map() });
		routeCache.set(route, {
			...cached,
			mod,
			staticPaths: entry
		});
		return entry;
	}
	let staticPaths = [];
	if (!mod.getStaticPaths) throw new Error("Unexpected Error.");
	staticPaths = await mod.getStaticPaths({
		paginate: generatePaginateFunction(route, base, trailingSlash),
		routePattern: route.route
	});
	validateGetStaticPathsResult(staticPaths, route);
	const keyedStaticPaths = staticPaths;
	keyedStaticPaths.keyed = /* @__PURE__ */ new Map();
	for (const sp of keyedStaticPaths) {
		const paramsKey = stringifyParams(sp.params, route, trailingSlash);
		keyedStaticPaths.keyed.set(paramsKey, sp);
	}
	routeCache.set(route, {
		...cached,
		mod,
		staticPaths: keyedStaticPaths
	});
	return keyedStaticPaths;
}
var RouteCache = class {
	logger;
	cache = {};
	runtimeMode;
	constructor(logger, runtimeMode = "production") {
		this.logger = logger;
		this.runtimeMode = runtimeMode;
	}
	/** Clear the cache. */
	clearAll() {
		this.cache = {};
	}
	set(route, entry) {
		const key = this.key(route);
		if (this.runtimeMode === "production" && this.cache[key]?.staticPaths) this.logger.warn(null, `Internal Warning: route cache overwritten. (${key})`);
		this.cache[key] = entry;
	}
	get(route) {
		return this.cache[this.key(route)];
	}
	key(route) {
		return `${route.route}_${route.component}`;
	}
};
function findPathItemByKey(staticPaths, params, route, logger, trailingSlash) {
	const paramsKey = stringifyParams(params, route, trailingSlash);
	const matchedStaticPath = staticPaths.keyed.get(paramsKey);
	if (matchedStaticPath) return matchedStaticPath;
	logger.debug("router", `findPathItemByKey() - Unexpected cache miss looking for ${paramsKey}`);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/render/params-and-props.js
async function getProps(opts) {
	const { logger, mod, routeData: route, routeCache, pathname, serverLike, base, trailingSlash } = opts;
	if (!route || route.pathname) return {};
	if (routeIsRedirect(route) || routeIsFallback(route) || route.component === "astro-default-404.astro") return {};
	const staticPaths = await callGetStaticPaths({
		mod,
		route,
		routeCache,
		ssr: serverLike,
		base,
		trailingSlash
	});
	const params = getParams(route, pathname);
	const matchedStaticPath = findPathItemByKey(staticPaths, params, route, logger, trailingSlash);
	if (!matchedStaticPath && route.origin !== "internal" && (serverLike ? route.prerender : true)) throw new AstroError({
		...NoMatchingStaticPathFound,
		message: NoMatchingStaticPathFound.message(pathname),
		hint: NoMatchingStaticPathFound.hint([route.component])
	});
	if (mod) validatePrerenderEndpointCollision(route, mod, params);
	return matchedStaticPath?.props ? { ...matchedStaticPath.props } : {};
}
function getParams(route, pathname) {
	if (!route.params.length) return {};
	const hasHtmlSuffix = pathname.endsWith(".html") && !routeHasHtmlExtension(route);
	const path = hasHtmlSuffix && route.type === "page" ? pathname.slice(0, -5) : pathname;
	const allPatterns = [route, ...route.fallbackRoutes].map((r) => r.pattern);
	let paramsMatch = allPatterns.map((pattern) => pattern.exec(path)).find((x) => x);
	if (!paramsMatch && hasHtmlSuffix && route.type !== "page") {
		const strippedPath = pathname.endsWith("/index.html") ? pathname.slice(0, -11) || "/" : pathname.slice(0, -5);
		paramsMatch = allPatterns.map((pattern) => pattern.exec(strippedPath)).find((x) => x);
	}
	if (!paramsMatch) return {};
	const params = {};
	route.params.forEach((key, i) => {
		if (key.startsWith("...")) params[key.slice(3)] = paramsMatch[i + 1] ? paramsMatch[i + 1] : void 0;
		else params[key] = paramsMatch[i + 1];
	});
	return params;
}
function validatePrerenderEndpointCollision(route, mod, params) {
	if (route.type === "endpoint" && mod.getStaticPaths) {
		const lastSegment = route.segments[route.segments.length - 1];
		const paramValues = Object.values(params);
		const lastParam = paramValues[paramValues.length - 1];
		if (lastSegment.length === 1 && lastSegment[0].dynamic && lastParam === void 0) throw new AstroError({
			...PrerenderDynamicEndpointPathCollide,
			message: PrerenderDynamicEndpointPathCollide.message(route.route),
			hint: PrerenderDynamicEndpointPathCollide.hint(route.component),
			location: { file: route.component }
		});
	}
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/render/slots.js
function getFunctionExpression(slot) {
	if (!slot) return;
	const expressions = slot?.expressions?.filter((e) => isRenderInstruction(e) === false || isRenderTemplateResult(e));
	if (expressions?.length !== 1) return;
	const expression = expressions[0];
	if (isRenderTemplateResult(expression)) return getFunctionExpression(expression);
	return expression;
}
var Slots = class {
	#result;
	#slots;
	#logger;
	constructor(result, slots, logger) {
		this.#result = result;
		this.#slots = slots;
		this.#logger = logger;
		if (slots) for (const key of Object.keys(slots)) {
			if (this[key] !== void 0) throw new AstroError({
				...ReservedSlotName,
				message: ReservedSlotName.message(key)
			});
			Object.defineProperty(this, key, {
				get() {
					return true;
				},
				enumerable: true
			});
		}
	}
	has(name) {
		if (!this.#slots) return false;
		return Boolean(this.#slots[name]);
	}
	async render(name, args = []) {
		if (!this.#slots || !this.has(name)) return;
		const result = this.#result;
		if (!Array.isArray(args)) this.#logger.warn(null, `Expected second parameter to be an array, received a ${typeof args}. If you're trying to pass an array as a single argument and getting unexpected results, make sure you're passing your array as an item of an array. Ex: Astro.slots.render('default', [["Hello", "World"]])`);
		else if (args.length > 0) {
			const slotValue = this.#slots[name];
			const component = typeof slotValue === "function" ? await slotValue(result) : await slotValue;
			const expression = getFunctionExpression(component);
			if (expression) {
				const slot = async () => typeof expression === "function" ? expression(...args) : expression;
				return await renderSlotToString(result, slot).then((res) => {
					return res;
				});
			}
			if (typeof component === "function") return await renderJSX(result, component(...args)).then((res) => res != null ? String(res) : res);
		}
		return chunkToString(result, await renderSlotToString(result, this.#slots[name]));
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/build/util.js
function shouldAppendForwardSlash(trailingSlash, buildFormat) {
	switch (trailingSlash) {
		case "always": return true;
		case "never": return false;
		case "ignore": switch (buildFormat) {
			case "directory": return true;
			case "preserve":
			case "file": return false;
		}
	}
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/request.js
function createRequest({ url, headers, method = "GET", body = void 0, logger, isPrerendered = false, routePattern, init }) {
	const headersObj = isPrerendered ? void 0 : headers instanceof Headers ? headers : new Headers(Object.entries(headers).filter(([name]) => !name.startsWith(":")));
	if (typeof url === "string") url = new URL(url);
	if (isPrerendered) url.search = "";
	const request = new Request(url, {
		method,
		headers: headersObj,
		body: isPrerendered ? null : body,
		...init
	});
	if (isPrerendered) {
		let _headers = request.headers;
		const { value, writable, ...headersDesc } = Object.getOwnPropertyDescriptor(request, "headers") || {};
		Object.defineProperty(request, "headers", {
			...headersDesc,
			get() {
				logger.warn(null, `\`Astro.request.headers\` was used when rendering the route \`${routePattern}'\`. \`Astro.request.headers\` is not available on prerendered pages. If you need access to request headers, make sure that the page is server-rendered using \`export const prerender = false;\` or by setting \`output\` to \`"server"\` in your Astro config to make all your pages server-rendered by default.`);
				return _headers;
			},
			set(newHeaders) {
				_headers = newHeaders;
			}
		});
	}
	return request;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/util/pathname.js
var MultiLevelEncodingError = class extends Error {
	constructor() {
		super("URL encoding depth exceeded the maximum number of decode iterations");
		this.name = "MultiLevelEncodingError";
	}
};
var MAX_DECODE_ITERATIONS = 10;
function validateAndDecodePathname(pathname) {
	let decoded;
	try {
		decoded = decodeURI(pathname);
	} catch (_e) {
		throw new Error("Invalid URL encoding");
	}
	let iterations = 0;
	while (decoded !== pathname) {
		if (iterations >= MAX_DECODE_ITERATIONS) throw new MultiLevelEncodingError();
		pathname = decoded;
		try {
			decoded = decodeURI(pathname);
		} catch {
			break;
		}
		iterations++;
	}
	return decoded;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/template/4xx.js
function template({ title, pathname, statusCode = 404, tabTitle, body }) {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<title>${tabTitle}</title>
		<style>
			:root {
				--gray-10: hsl(258, 7%, 10%);
				--gray-20: hsl(258, 7%, 20%);
				--gray-30: hsl(258, 7%, 30%);
				--gray-40: hsl(258, 7%, 40%);
				--gray-50: hsl(258, 7%, 50%);
				--gray-60: hsl(258, 7%, 60%);
				--gray-70: hsl(258, 7%, 70%);
				--gray-80: hsl(258, 7%, 80%);
				--gray-90: hsl(258, 7%, 90%);
				--black: #13151A;
				--accent-light: #E0CCFA;
			}

			* {
				box-sizing: border-box;
			}

			html {
				background: var(--black);
				color-scheme: dark;
				accent-color: var(--accent-light);
			}

			body {
				background-color: var(--gray-10);
				color: var(--gray-80);
				font-family: ui-monospace, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", "Roboto Mono", "Oxygen Mono", "Ubuntu Monospace", "Source Code Pro", "Fira Mono", "Droid Sans Mono", "Courier New", monospace;
				line-height: 1.5;
				margin: 0;
			}

			a {
				color: var(--accent-light);
			}

			.center {
				display: flex;
				flex-direction: column;
				justify-content: center;
				align-items: center;
				height: 100vh;
				width: 100vw;
			}

			h1 {
				margin-bottom: 8px;
				color: white;
				font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
				font-weight: 700;
				margin-top: 1rem;
				margin-bottom: 0;
			}

			.statusCode {
				color: var(--accent-light);
			}

			.astro-icon {
				height: 124px;
				width: 124px;
			}

			pre, code {
				padding: 2px 8px;
				background: rgba(0,0,0, 0.25);
				border: 1px solid rgba(255,255,255, 0.25);
				border-radius: 4px;
				font-size: 1.2em;
				margin-top: 0;
				max-width: 60em;
			}
		</style>
	</head>
	<body>
		<main class="center">
			<svg class="astro-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80" fill="none"> <path d="M20.5253 67.6322C16.9291 64.3531 15.8793 57.4632 17.3776 52.4717C19.9755 55.6188 23.575 56.6157 27.3035 57.1784C33.0594 58.0468 38.7122 57.722 44.0592 55.0977C44.6709 54.7972 45.2362 54.3978 45.9045 53.9931C46.4062 55.4451 46.5368 56.9109 46.3616 58.4028C45.9355 62.0362 44.1228 64.8429 41.2397 66.9705C40.0868 67.8215 38.8669 68.5822 37.6762 69.3846C34.0181 71.8508 33.0285 74.7426 34.403 78.9491C34.4357 79.0516 34.4649 79.1541 34.5388 79.4042C32.6711 78.5705 31.3069 77.3565 30.2674 75.7604C29.1694 74.0757 28.6471 72.2121 28.6196 70.1957C28.6059 69.2144 28.6059 68.2244 28.4736 67.257C28.1506 64.8985 27.0406 63.8425 24.9496 63.7817C22.8036 63.7192 21.106 65.0426 20.6559 67.1268C20.6215 67.2865 20.5717 67.4446 20.5218 67.6304L20.5253 67.6322Z" fill="white"/> <path d="M20.5253 67.6322C16.9291 64.3531 15.8793 57.4632 17.3776 52.4717C19.9755 55.6188 23.575 56.6157 27.3035 57.1784C33.0594 58.0468 38.7122 57.722 44.0592 55.0977C44.6709 54.7972 45.2362 54.3978 45.9045 53.9931C46.4062 55.4451 46.5368 56.9109 46.3616 58.4028C45.9355 62.0362 44.1228 64.8429 41.2397 66.9705C40.0868 67.8215 38.8669 68.5822 37.6762 69.3846C34.0181 71.8508 33.0285 74.7426 34.403 78.9491C34.4357 79.0516 34.4649 79.1541 34.5388 79.4042C32.6711 78.5705 31.3069 77.3565 30.2674 75.7604C29.1694 74.0757 28.6471 72.2121 28.6196 70.1957C28.6059 69.2144 28.6059 68.2244 28.4736 67.257C28.1506 64.8985 27.0406 63.8425 24.9496 63.7817C22.8036 63.7192 21.106 65.0426 20.6559 67.1268C20.6215 67.2865 20.5717 67.4446 20.5218 67.6304L20.5253 67.6322Z" fill="url(#paint0_linear_738_686)"/> <path d="M0 51.6401C0 51.6401 10.6488 46.4654 21.3274 46.4654L29.3786 21.6102C29.6801 20.4082 30.5602 19.5913 31.5538 19.5913C32.5474 19.5913 33.4275 20.4082 33.7289 21.6102L41.7802 46.4654C54.4274 46.4654 63.1076 51.6401 63.1076 51.6401C63.1076 51.6401 45.0197 2.48776 44.9843 2.38914C44.4652 0.935933 43.5888 0 42.4073 0H20.7022C19.5206 0 18.6796 0.935933 18.1251 2.38914C18.086 2.4859 0 51.6401 0 51.6401Z" fill="white"/> <defs> <linearGradient id="paint0_linear_738_686" x1="31.554" y1="75.4423" x2="39.7462" y2="48.376" gradientUnits="userSpaceOnUse"> <stop stop-color="#D83333"/> <stop offset="1" stop-color="#F041FF"/> </linearGradient> </defs> </svg>
			<h1>${statusCode ? `<span class="statusCode">${statusCode}: </span> ` : ""}<span class="statusMessage">${title}</span></h1>
			${body || `
				<pre>Path: ${escape(pathname)}</pre>
			`}
			</main>
	</body>
</html>`;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/internal/astro-designed-error-pages.js
var DEFAULT_404_ROUTE = {
	component: DEFAULT_404_COMPONENT,
	params: [],
	pattern: /^\/404\/?$/,
	prerender: false,
	pathname: "/404",
	segments: [[{
		content: "404",
		dynamic: false,
		spread: false
	}]],
	type: "page",
	route: "/404",
	fallbackRoutes: [],
	isIndex: false,
	origin: "internal",
	distURL: []
};
async function default404Page({ pathname }) {
	return new Response(template({
		statusCode: 404,
		title: "Not found",
		tabTitle: "404: Not Found",
		pathname
	}), {
		status: 404,
		headers: { "Content-Type": "text/html" }
	});
}
default404Page.isAstroComponentFactory = true;
var default404Instance = { default: default404Page };
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/rewrite.js
function findRouteToRewrite({ payload, routes, request, trailingSlash, buildFormat, base, outDir }) {
	let newUrl = void 0;
	if (payload instanceof URL) newUrl = payload;
	else if (payload instanceof Request) newUrl = new URL(payload.url);
	else newUrl = new URL(collapseDuplicateSlashes(payload), new URL(request.url).origin);
	const { pathname, resolvedUrlPathname } = normalizeRewritePathname(newUrl.pathname, base, trailingSlash, buildFormat);
	newUrl.pathname = resolvedUrlPathname;
	const decodedPathname = validateAndDecodePathname(pathname);
	if (isRoute404(decodedPathname)) {
		const errorRoute = routes.find((route) => route.route === "/404");
		if (errorRoute) return {
			routeData: errorRoute,
			newUrl,
			pathname: decodedPathname
		};
	}
	if (isRoute500(decodedPathname)) {
		const errorRoute = routes.find((route) => route.route === "/500");
		if (errorRoute) return {
			routeData: errorRoute,
			newUrl,
			pathname: decodedPathname
		};
	}
	let foundRoute;
	for (const route of routes) if (route.pattern.test(decodedPathname)) {
		if (route.params && route.params.length !== 0 && route.distURL && route.distURL.length !== 0) {
			if (!route.distURL.find((url) => url.href.replace(outDir.toString(), "").replace(/(?:\/index\.html|\.html)$/, "") === trimSlashes(pathname))) continue;
		}
		foundRoute = route;
		break;
	}
	if (foundRoute) return {
		routeData: foundRoute,
		newUrl,
		pathname: decodedPathname
	};
	else {
		const custom404 = routes.find((route) => route.route === "/404");
		if (custom404) return {
			routeData: custom404,
			newUrl,
			pathname
		};
		else return {
			routeData: DEFAULT_404_ROUTE,
			newUrl,
			pathname
		};
	}
}
function copyRequest(newUrl, oldRequest, isPrerendered, logger, routePattern) {
	if (oldRequest.bodyUsed) throw new AstroError(RewriteWithBodyUsed);
	return createRequest({
		url: newUrl,
		method: oldRequest.method,
		body: oldRequest.body,
		isPrerendered,
		logger,
		headers: isPrerendered ? {} : oldRequest.headers,
		routePattern,
		init: {
			referrer: oldRequest.referrer,
			referrerPolicy: oldRequest.referrerPolicy,
			mode: oldRequest.mode,
			credentials: oldRequest.credentials,
			cache: oldRequest.cache,
			redirect: oldRequest.redirect,
			integrity: oldRequest.integrity,
			signal: oldRequest.signal,
			keepalive: oldRequest.keepalive,
			duplex: "half"
		}
	});
}
function setOriginPathname(request, pathname, trailingSlash, buildFormat) {
	if (!pathname) pathname = "/";
	const shouldAppendSlash = shouldAppendForwardSlash(trailingSlash, buildFormat);
	let finalPathname;
	if (pathname === "/") finalPathname = "/";
	else if (shouldAppendSlash) finalPathname = appendForwardSlash(pathname);
	else finalPathname = removeTrailingForwardSlash(pathname);
	Reflect.set(request, originPathnameSymbol, encodeURIComponent(finalPathname));
}
function getOriginPathname(request) {
	const origin = Reflect.get(request, originPathnameSymbol);
	if (origin) return decodeURIComponent(origin);
	return new URL(request.url).pathname;
}
function normalizeRewritePathname(urlPathname, base, trailingSlash, buildFormat) {
	let pathname = collapseDuplicateSlashes(urlPathname);
	const shouldAppendSlash = shouldAppendForwardSlash(trailingSlash, buildFormat);
	if (base !== "/") {
		if (urlPathname === base || urlPathname === removeTrailingForwardSlash(base)) pathname = "/";
		else if (urlPathname.startsWith(base)) {
			pathname = shouldAppendSlash ? appendForwardSlash(urlPathname) : removeTrailingForwardSlash(urlPathname);
			pathname = pathname.slice(base.length);
		}
	}
	if (!pathname.startsWith("/") && shouldAppendSlash && urlPathname.endsWith("/")) pathname = prependForwardSlash(pathname);
	if (buildFormat === "file") pathname = pathname.replace(/\.html$/, "");
	let resolvedUrlPathname;
	if (base !== "/" && (pathname === "" || pathname === "/") && !shouldAppendSlash) resolvedUrlPathname = removeTrailingForwardSlash(base);
	else resolvedUrlPathname = joinPaths(...[base, pathname].filter(Boolean));
	return {
		pathname,
		resolvedUrlPathname
	};
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/middleware/sequence.js
function sequence(...handlers) {
	const filtered = handlers.filter((h) => !!h);
	const length = filtered.length;
	if (!length) return defineMiddleware((_context, next) => {
		return next();
	});
	return defineMiddleware((context, next) => {
		let carriedPayload = void 0;
		return applyHandle(0, context);
		function applyHandle(i, handleContext) {
			const handle = filtered[i];
			return handle(handleContext, async (payload) => {
				if (i < length - 1) {
					if (payload) {
						let newRequest;
						if (payload instanceof Request) newRequest = payload;
						else if (payload instanceof URL) newRequest = new Request(payload, handleContext.request.clone());
						else newRequest = new Request(new URL(payload, handleContext.url.origin), handleContext.request.clone());
						const oldPathname = handleContext.url.pathname;
						const pipeline = Reflect.get(handleContext, pipelineSymbol);
						const { routeData, pathname } = await pipeline.tryRewrite(payload, handleContext.request);
						if (pipeline.manifest.serverLike === true && handleContext.isPrerendered === false && routeData.prerender === true) throw new AstroError({
							...ForbiddenRewrite,
							message: ForbiddenRewrite.message(handleContext.url.pathname, pathname, routeData.component),
							hint: ForbiddenRewrite.hint(routeData.component)
						});
						carriedPayload = payload;
						handleContext.request = newRequest;
						handleContext.url = new URL(newRequest.url);
						handleContext.params = getParams(routeData, pathname);
						handleContext.routePattern = routeData.route;
						setOriginPathname(handleContext.request, oldPathname, pipeline.manifest.trailingSlash, pipeline.manifest.buildFormat);
					}
					return applyHandle(i + 1, handleContext);
				} else return next(payload ?? carriedPayload);
			});
		}
	});
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/redirects/component.js
var RedirectComponentInstance = { default() {
	return new Response(null, { status: 301 });
} };
var RedirectSinglePageBuiltModule = {
	page: () => Promise.resolve(RedirectComponentInstance),
	onRequest: (_, next) => next()
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/request-body.js
async function readBodyWithLimit(request, limit) {
	const contentLengthHeader = request.headers.get("content-length");
	if (contentLengthHeader) {
		const contentLength = Number.parseInt(contentLengthHeader, 10);
		if (Number.isFinite(contentLength) && contentLength > limit) throw new BodySizeLimitError(limit);
	}
	if (!request.body) return /* @__PURE__ */ new Uint8Array();
	const reader = request.body.getReader();
	const chunks = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			received += value.byteLength;
			if (received > limit) throw new BodySizeLimitError(limit);
			chunks.push(value);
		}
	}
	const buffer = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return buffer;
}
var BodySizeLimitError = class extends Error {
	limit;
	constructor(limit) {
		super(`Request body exceeds the configured limit of ${limit} bytes`);
		this.name = "BodySizeLimitError";
		this.limit = limit;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/pattern.js
function getPattern(segments, base, addTrailingSlash) {
	const pathname = segments.map((segment) => {
		if (segment.length === 1 && segment[0].spread) return "(?:\\/(.*?))?";
		else return "\\/" + segment.map((part) => {
			if (part.spread) return "(.*?)";
			else if (part.dynamic) return "([^/]+?)";
			else return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}).join("");
	}).join("");
	const trailing = addTrailingSlash && segments.length ? getTrailingSlashPattern(addTrailingSlash) : "$";
	let initial = "\\/";
	if (addTrailingSlash === "never" && base !== "/" && pathname !== "") initial = "";
	return new RegExp(`^${pathname || initial}${trailing}`);
}
function getTrailingSlashPattern(addTrailingSlash) {
	if (addTrailingSlash === "always") return "\\/$";
	if (addTrailingSlash === "never") return "$";
	return "\\/?$";
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/server-islands/endpoint.js
var SERVER_ISLAND_ROUTE = "/_server-islands/[name]";
var SERVER_ISLAND_COMPONENT = "_server-islands.astro";
function badRequest(reason) {
	return new Response(null, {
		status: 400,
		statusText: "Bad request: " + reason
	});
}
var DEFAULT_BODY_SIZE_LIMIT = 1024 * 1024;
async function getRequestData(request, bodySizeLimit = DEFAULT_BODY_SIZE_LIMIT) {
	switch (request.method) {
		case "GET": {
			const params = new URL(request.url).searchParams;
			if (!params.has("s") || !params.has("e") || !params.has("p")) return badRequest("Missing required query parameters.");
			const encryptedSlots = params.get("s");
			return {
				encryptedComponentExport: params.get("e"),
				encryptedProps: params.get("p"),
				encryptedSlots
			};
		}
		case "POST": try {
			const body = await readBodyWithLimit(request, bodySizeLimit);
			const raw = new TextDecoder().decode(body);
			const data = JSON.parse(raw);
			if (Object.hasOwn(data, "slots") && typeof data.slots === "object") return badRequest("Plaintext slots are not allowed. Slots must be encrypted.");
			if (Object.hasOwn(data, "componentExport") && typeof data.componentExport === "string") return badRequest("Plaintext componentExport is not allowed. componentExport must be encrypted.");
			return data;
		} catch (e) {
			if (e instanceof BodySizeLimitError) return new Response(null, {
				status: 413,
				statusText: e.message
			});
			if (e instanceof SyntaxError) return badRequest("Request format is invalid.");
			throw e;
		}
		default: return new Response(null, { status: 405 });
	}
}
function createEndpoint(manifest) {
	const page = async (result) => {
		const params = result.params;
		if (!params.name) return new Response(null, {
			status: 400,
			statusText: "Bad request"
		});
		const componentId = params.name;
		const data = await getRequestData(result.request, manifest.serverIslandBodySizeLimit);
		if (data instanceof Response) return data;
		let imp = (await (await manifest.serverIslandMappings?.())?.serverIslandMap)?.get(componentId);
		if (!imp) return new Response(null, {
			status: 404,
			statusText: "Not found"
		});
		const key = await manifest.key;
		let componentExport;
		try {
			componentExport = await decryptString(key, data.encryptedComponentExport, `export:${componentId}`);
		} catch (_e) {
			return badRequest("Encrypted componentExport value is invalid.");
		}
		const encryptedProps = data.encryptedProps;
		let props = {};
		if (encryptedProps !== "") try {
			const propString = await decryptString(key, encryptedProps, `props:${componentId}`);
			props = JSON.parse(propString);
		} catch (_e) {
			return badRequest("Encrypted props value is invalid.");
		}
		let decryptedSlots = {};
		const encryptedSlots = data.encryptedSlots;
		if (encryptedSlots !== "") try {
			const slotsString = await decryptString(key, encryptedSlots, `slots:${componentId}`);
			decryptedSlots = JSON.parse(slotsString);
		} catch (_e) {
			return badRequest("Encrypted slots value is invalid.");
		}
		let Component = (await imp())[componentExport];
		const slots = {};
		for (const prop in decryptedSlots) slots[prop] = createSlotValueFromString(decryptedSlots[prop]);
		result.response.headers.set("X-Robots-Tag", "noindex");
		if (isAstroComponentFactory(Component)) {
			const ServerIsland = Component;
			Component = function(...args) {
				return ServerIsland.apply(this, args);
			};
			Object.assign(Component, ServerIsland);
			Component.propagation = "self";
		}
		return renderTemplate`${renderComponent(result, "Component", Component, props, slots)}`;
	};
	page.isAstroComponentFactory = true;
	return {
		default: page,
		partial: true
	};
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/default.js
function createDefaultRoutes(manifest) {
	const root = new URL(manifest.rootDir);
	return [{
		instance: default404Instance,
		matchesComponent: (filePath) => filePath.href === new URL(DEFAULT_404_COMPONENT, root).href,
		route: DEFAULT_404_ROUTE.route,
		component: DEFAULT_404_COMPONENT
	}, {
		instance: createEndpoint(manifest),
		matchesComponent: (filePath) => filePath.href === new URL(SERVER_ISLAND_COMPONENT, root).href,
		route: SERVER_ISLAND_ROUTE,
		component: SERVER_ISLAND_COMPONENT
	}];
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/astro-designed-error-pages.js
function ensure404Route(manifest) {
	if (!manifest.routes.some((route) => route.route === "/404")) manifest.routes.push(DEFAULT_404_ROUTE);
	return manifest;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/priority.js
function routeComparator(a, b) {
	const commonLength = Math.min(a.segments.length, b.segments.length);
	for (let index = 0; index < commonLength; index++) {
		const aSegment = a.segments[index];
		const bSegment = b.segments[index];
		const aIsStatic = aSegment.every((part) => !part.dynamic && !part.spread);
		const bIsStatic = bSegment.every((part) => !part.dynamic && !part.spread);
		if (aIsStatic && bIsStatic) {
			const aContent = aSegment.map((part) => part.content).join("");
			const bContent = bSegment.map((part) => part.content).join("");
			if (aContent !== bContent) return aContent.localeCompare(bContent);
		}
		if (aIsStatic !== bIsStatic) return aIsStatic ? -1 : 1;
		const aAllDynamic = aSegment.every((part) => part.dynamic);
		if (aAllDynamic !== bSegment.every((part) => part.dynamic)) return aAllDynamic ? 1 : -1;
		const aHasSpread = aSegment.some((part) => part.spread);
		if (aHasSpread !== bSegment.some((part) => part.spread)) return aHasSpread ? 1 : -1;
	}
	const aLength = a.segments.length;
	const bLength = b.segments.length;
	if (aLength !== bLength) {
		const aEndsInRest = a.segments.at(-1)?.some((part) => part.spread);
		const bEndsInRest = b.segments.at(-1)?.some((part) => part.spread);
		if (aEndsInRest !== bEndsInRest && Math.abs(aLength - bLength) === 1) {
			if (aLength > bLength && aEndsInRest) return 1;
			if (bLength > aLength && bEndsInRest) return -1;
		}
		return aLength > bLength ? -1 : 1;
	}
	if (a.type === "endpoint" !== (b.type === "endpoint")) return a.type === "endpoint" ? -1 : 1;
	return a.route.localeCompare(b.route);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/router.js
var Router = class {
	#routes;
	#base;
	#baseWithoutTrailingSlash;
	#buildFormat;
	#trailingSlash;
	constructor(routes, options) {
		this.#routes = [...routes].sort(routeComparator);
		this.#base = normalizeBase(options.base);
		this.#baseWithoutTrailingSlash = removeTrailingForwardSlash(this.#base);
		this.#buildFormat = options.buildFormat;
		this.#trailingSlash = options.trailingSlash;
	}
	/**
	* Match an input pathname against the route list.
	* If allowWithoutBase is true, a non-base-prefixed path is still considered.
	*/
	match(inputPathname, { allowWithoutBase = false } = {}) {
		const normalized = getRedirectForPathname(inputPathname);
		if (normalized.redirect) return {
			type: "redirect",
			location: normalized.redirect,
			status: 301
		};
		if (this.#base !== "/") {
			const baseWithSlash = `${this.#baseWithoutTrailingSlash}/`;
			if (this.#trailingSlash === "always" && (normalized.pathname === this.#baseWithoutTrailingSlash || normalized.pathname === this.#base)) return {
				type: "redirect",
				location: baseWithSlash,
				status: 301
			};
			if (this.#trailingSlash === "never" && normalized.pathname === baseWithSlash) return {
				type: "redirect",
				location: this.#baseWithoutTrailingSlash,
				status: 301
			};
		}
		const baseResult = stripBase(normalized.pathname, this.#base, this.#baseWithoutTrailingSlash, this.#trailingSlash);
		if (!baseResult) {
			if (!allowWithoutBase) return {
				type: "none",
				reason: "outside-base"
			};
		}
		let pathname = baseResult ?? normalized.pathname;
		if (this.#buildFormat === "file") pathname = normalizeFileFormatPathname(pathname);
		const route = this.#routes.find((candidate) => {
			if (candidate.pattern.test(pathname)) return true;
			return candidate.fallbackRoutes.some((fallbackRoute) => fallbackRoute.pattern.test(pathname));
		});
		if (!route) return {
			type: "none",
			reason: "no-match"
		};
		return {
			type: "match",
			route,
			params: getParams(route, pathname),
			pathname
		};
	}
	/**
	* Returns all routes that match the given pathname, in priority order.
	* Used when the first match (e.g. a prerendered route) cannot serve
	* the request and subsequent matches need to be tried.
	*/
	matchAll(inputPathname, { allowWithoutBase = false } = {}) {
		const normalized = getRedirectForPathname(inputPathname);
		if (normalized.redirect) return [];
		const baseResult = stripBase(normalized.pathname, this.#base, this.#baseWithoutTrailingSlash, this.#trailingSlash);
		if (!baseResult && !allowWithoutBase) return [];
		let pathname = baseResult ?? normalized.pathname;
		if (this.#buildFormat === "file") pathname = normalizeFileFormatPathname(pathname);
		return this.#routes.filter((candidate) => {
			if (candidate.pattern.test(pathname)) return true;
			return candidate.fallbackRoutes.some((fallbackRoute) => fallbackRoute.pattern.test(pathname));
		});
	}
};
function normalizeBase(base) {
	if (!base) return "/";
	if (base === "/") return base;
	return prependForwardSlash(base);
}
function getRedirectForPathname(pathname) {
	let value = prependForwardSlash(pathname);
	if (value.startsWith("//")) return {
		pathname: value,
		redirect: `/${value.replace(/^\/+/, "")}`
	};
	return { pathname: value };
}
function stripBase(pathname, base, baseWithoutTrailingSlash, trailingSlash) {
	if (base === "/") return pathname;
	const baseWithSlash = `${baseWithoutTrailingSlash}/`;
	if (pathname === baseWithoutTrailingSlash || pathname === base) return trailingSlash === "always" ? null : "/";
	if (pathname === baseWithSlash) return trailingSlash === "never" ? null : "/";
	if (pathname.startsWith(baseWithSlash)) return pathname.slice(baseWithoutTrailingSlash.length);
	return null;
}
function normalizeFileFormatPathname(pathname) {
	if (pathname.endsWith("/index.html")) {
		const trimmed = pathname.slice(0, -11);
		return trimmed === "" ? "/" : trimmed;
	}
	if (pathname.endsWith(".html")) {
		const trimmed = pathname.slice(0, -5);
		return trimmed === "" ? "/" : trimmed;
	}
	return pathname;
}
//#endregion
//#region node_modules/.pnpm/@astrojs+internal-helpers@0.10.1/node_modules/@astrojs/internal-helpers/dist/object.js
var FORBIDDEN_PATH_KEYS = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/public.js
function matchesLevel(messageLevel, configuredLevel) {
	return levels[messageLevel] >= levels[configuredLevel];
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/impls/node.js
function nodeLogDestination(config = {}) {
	const { level = "info" } = config;
	return { write(event) {
		let dest = process.stderr;
		if (levels[event.level] < levels["error"]) dest = process.stdout;
		if (!matchesLevel(event.level, level)) return;
		let trailingLine = event.newLine ? "\n" : "";
		if (event.label === "SKIP_FORMAT") dest.write(event.message + trailingLine);
		else dest.write(getEventPrefix(event) + " " + event.message + trailingLine);
	} };
}
function node_default(options) {
	return nodeLogDestination(options);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/impls/console.js
function consoleLogDestination(config = {}) {
	const { level = "info" } = config;
	return { write(event) {
		let dest = console.error;
		if (levels[event.level] < levels["error"]) dest = console.info;
		if (!matchesLevel(event.level, level)) return;
		if (event.label === "SKIP_FORMAT") dest(event.message);
		else dest(getEventPrefix(event) + " " + event.message);
	} };
}
function createConsoleLogger({ level }) {
	return new AstroLogger({
		level,
		destination: consoleLogDestination()
	});
}
function console_default(options) {
	return consoleLogDestination(options);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/impls/json.js
var SGR_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function jsonLoggerDestination(config = {}) {
	const { pretty = false, level = "info" } = config;
	return { write(event) {
		if (!matchesLevel(event.level, level)) return;
		const dest = levels[event.level] >= levels["error"] ? console.error : console.info;
		const message = event.message.replace(SGR_REGEX, "");
		dest(pretty ? JSON.stringify({
			message,
			label: event.label,
			level: event.level
		}, null, 2) : JSON.stringify({
			message,
			label: event.label,
			level: event.level
		}));
	} };
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/impls/compose.js
function compose(destinations) {
	return {
		write(chunk) {
			for (const logger of destinations) logger.write(chunk);
		},
		flush() {
			for (const logger of destinations) if (logger.flush) logger.flush();
		},
		close() {
			for (const logger of destinations) if (logger.close) logger.close();
		}
	};
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/logger/load.js
function normalizeEntrypoint(entrypoint) {
	return entrypoint instanceof URL ? entrypoint.href : entrypoint;
}
async function loadLoggerDestination(config) {
	let cause = void 0;
	const entrypoint = normalizeEntrypoint(config.entrypoint);
	try {
		switch (config.entrypoint) {
			case "astro/logger/node": return node_default(config.config);
			case "astro/logger/console": return console_default(config.config);
			case "astro/logger/json": return jsonLoggerDestination(config.config);
			case "astro/logger/compose": {
				let destinations = [];
				if (config.config?.loggers) {
					const loggers = config.config?.loggers;
					destinations = await Promise.all(loggers.map(async (loggerConfig) => {
						return (await import(
							/* @vite-ignore */
							normalizeEntrypoint(loggerConfig.entrypoint)
)).default(loggerConfig.config);
					}));
				}
				return compose(destinations);
			}
			default: return (await import(
				/* @vite-ignore */
				entrypoint
)).default(config.config);
		}
	} catch (e) {
		if (e instanceof Error) cause = e;
	}
	const error = new AstroError({
		...UnableToLoadLogger,
		message: UnableToLoadLogger.message(entrypoint)
	});
	if (cause) error.cause = cause;
	throw error;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/base-pipeline.js
var PipelineFeatures = {
	redirects: 1,
	sessions: 2,
	actions: 4,
	middleware: 8,
	i18n: 16,
	cache: 32
};
var ALL_PIPELINE_FEATURES = PipelineFeatures.redirects | PipelineFeatures.sessions | PipelineFeatures.actions | PipelineFeatures.middleware | PipelineFeatures.i18n | PipelineFeatures.cache;
var Pipeline = class {
	internalMiddleware;
	resolvedMiddleware = void 0;
	resolvedLogger = false;
	resolvedActions = void 0;
	resolvedSessionDriver = void 0;
	resolvedCacheProvider = void 0;
	compiledCacheRoutes = void 0;
	/**
	* Bit mask of pipeline features activated by handler classes.
	* Each handler sets its bit via `|=`. Only meaningful when a
	* custom `src/fetch.ts` fetch handler is in use.
	*/
	usedFeatures = 0;
	logger;
	manifest;
	/**
	* "development" or "production" only
	*/
	runtimeMode;
	renderers;
	resolve;
	streaming;
	/**
	* Used to provide better error messages for `Astro.clientAddress`
	*/
	adapterName;
	clientDirectives;
	inlinedScripts;
	compressHTML;
	i18n;
	middleware;
	routeCache;
	/**
	* Used for `Astro.site`.
	*/
	site;
	/**
	* Array of built-in, internal, routes.
	* Used to find the route module
	*/
	defaultRoutes;
	actions;
	sessionDriver;
	cacheProvider;
	cacheConfig;
	serverIslands;
	/** Route data derived from the manifest, used for route matching. */
	manifestData;
	/** Pattern-matching router built from manifestData. */
	#router;
	constructor(logger, manifest, runtimeMode, renderers, resolve, streaming, adapterName = manifest.adapterName, clientDirectives = manifest.clientDirectives, inlinedScripts = manifest.inlinedScripts, compressHTML = manifest.compressHTML, i18n = manifest.i18n, middleware = manifest.middleware, routeCache = new RouteCache(logger, runtimeMode), site = manifest.site ? new URL(manifest.site) : void 0, defaultRoutes = createDefaultRoutes(manifest), actions = manifest.actions, sessionDriver = manifest.sessionDriver, cacheProvider = manifest.cacheProvider, cacheConfig = manifest.cacheConfig, serverIslands = manifest.serverIslandMappings) {
		this.logger = logger;
		this.manifest = manifest;
		this.runtimeMode = runtimeMode;
		this.renderers = renderers;
		this.resolve = resolve;
		this.streaming = streaming;
		this.adapterName = adapterName;
		this.clientDirectives = clientDirectives;
		this.inlinedScripts = inlinedScripts;
		this.compressHTML = compressHTML;
		this.i18n = i18n;
		this.middleware = middleware;
		this.routeCache = routeCache;
		this.site = site;
		this.defaultRoutes = defaultRoutes;
		this.actions = actions;
		this.sessionDriver = sessionDriver;
		this.cacheProvider = cacheProvider;
		this.cacheConfig = cacheConfig;
		this.serverIslands = serverIslands;
		this.manifestData = { routes: (manifest.routes ?? []).map((route) => route.routeData) };
		ensure404Route(this.manifestData);
		this.#router = new Router(this.manifestData.routes, {
			base: manifest.base,
			trailingSlash: manifest.trailingSlash,
			buildFormat: manifest.buildFormat
		});
		this.internalMiddleware = [];
	}
	/**
	* Low-level route matching against the manifest routes. Returns the
	* matched `RouteData` or `undefined`. Does not filter prerendered
	* routes or check public assets — use `BaseApp.match()` for that.
	*/
	matchRoute(pathname) {
		const match = this.#router.match(pathname, { allowWithoutBase: true });
		if (match.type !== "match") return void 0;
		return match.route;
	}
	/**
	* Returns all routes matching the given pathname, in priority order.
	* Used when the first match cannot serve the request (e.g. a
	* prerendered dynamic route that doesn't cover this specific path)
	* and the caller needs to try subsequent matches.
	*/
	matchAllRoutes(pathname) {
		return this.#router.matchAll(pathname, { allowWithoutBase: true });
	}
	/**
	* Rebuilds the internal router after routes have been added or
	* removed (e.g. by the dev server on HMR).
	*/
	rebuildRouter() {
		this.#router = new Router(this.manifestData.routes, {
			base: this.manifest.base,
			trailingSlash: this.manifest.trailingSlash,
			buildFormat: this.manifest.buildFormat
		});
	}
	/**
	* Resolves the middleware from the manifest, and returns the `onRequest` function. If `onRequest` isn't there,
	* it returns a no-op function
	*/
	async getMiddleware() {
		if (this.resolvedMiddleware) return this.resolvedMiddleware;
		if (this.middleware) {
			const internalMiddlewares = [(await this.middleware()).onRequest ?? NOOP_MIDDLEWARE_FN];
			if (this.manifest.checkOrigin) internalMiddlewares.unshift(createOriginCheckMiddleware());
			this.resolvedMiddleware = sequence(...internalMiddlewares);
			return this.resolvedMiddleware;
		} else {
			this.resolvedMiddleware = NOOP_MIDDLEWARE_FN;
			return this.resolvedMiddleware;
		}
	}
	/**
	* Clears the cached middleware so it is re-resolved on the next request.
	* Called via HMR when middleware files change during development.
	*/
	clearMiddleware() {
		this.resolvedMiddleware = void 0;
	}
	/**
	* Resolves the logger destination from the manifest and updates the pipeline logger.
	* If the user configured `logger`, the bundled logger factory is loaded
	* and replaces the default console destination. This is lazy and only resolves once.
	*/
	async getLogger() {
		if (this.resolvedLogger) return this.logger;
		this.resolvedLogger = true;
		if (this.manifest.loggerConfig) this.logger = new AstroLogger({
			destination: await loadLoggerDestination(this.manifest.loggerConfig),
			level: this.manifest.logLevel
		});
		return this.logger;
	}
	async getActions() {
		if (this.resolvedActions) return this.resolvedActions;
		else if (this.actions) {
			this.resolvedActions = await this.actions();
			return this.resolvedActions;
		}
		return NOOP_ACTIONS_MOD;
	}
	async getSessionDriver() {
		if (this.resolvedSessionDriver !== void 0) return this.resolvedSessionDriver;
		if (this.sessionDriver) {
			const driverModule = await this.sessionDriver();
			this.resolvedSessionDriver = driverModule?.default || null;
			return this.resolvedSessionDriver;
		}
		this.resolvedSessionDriver = null;
		return null;
	}
	async getCacheProvider() {
		if (this.resolvedCacheProvider !== void 0) return this.resolvedCacheProvider;
		if (this.cacheProvider) {
			const factory = (await this.cacheProvider())?.default || null;
			this.resolvedCacheProvider = factory ? factory(this.cacheConfig?.options) : null;
			return this.resolvedCacheProvider;
		}
		this.resolvedCacheProvider = null;
		return null;
	}
	async getServerIslands() {
		if (this.serverIslands) return this.serverIslands();
		return {
			serverIslandMap: /* @__PURE__ */ new Map(),
			serverIslandNameMap: /* @__PURE__ */ new Map()
		};
	}
	async getAction(path) {
		const pathKeys = path.split(".").map((key) => decodeURIComponent(key));
		let { server } = await this.getActions();
		if (!server || !(typeof server === "object")) throw new TypeError(`Expected \`server\` export in actions file to be an object. Received ${typeof server}.`);
		for (const key of pathKeys) {
			if (FORBIDDEN_PATH_KEYS.has(key)) throw new AstroError({
				...ActionNotFoundError,
				message: ActionNotFoundError.message(pathKeys.join("."))
			});
			if (!Object.hasOwn(server, key)) throw new AstroError({
				...ActionNotFoundError,
				message: ActionNotFoundError.message(pathKeys.join("."))
			});
			server = server[key];
		}
		if (typeof server !== "function") throw new TypeError(`Expected handler for action ${pathKeys.join(".")} to be a function. Received ${typeof server}.`);
		return server;
	}
	async getModuleForRoute(route) {
		for (const defaultRoute of this.defaultRoutes) if (route.component === defaultRoute.component) return { page: () => Promise.resolve(defaultRoute.instance) };
		if (route.type === "redirect") return RedirectSinglePageBuiltModule;
		else {
			if (this.manifest.pageMap) {
				const importComponentInstance = this.manifest.pageMap.get(route.component);
				if (!importComponentInstance) throw new Error(`Unexpectedly unable to find a component instance for route ${route.route}`);
				return await importComponentInstance();
			} else if (this.manifest.pageModule) return this.manifest.pageModule;
			throw new Error("Astro couldn't find the correct page to render, probably because it wasn't correctly mapped for SSR usage. This is an internal error, please file an issue.");
		}
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cookies/cookies.js
var import_dist = (/* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.parse = parseCookie;
	exports.stringifySetCookie = stringifySetCookie;
	exports.serialize = stringifySetCookie;
	exports.stringifySetCookie = stringifySetCookie;
	exports.serialize = stringifySetCookie;
	/**
	* RegExp to match cookie-name in RFC 6265 sec 4.1.1
	* This refers out to the obsoleted definition of token in RFC 2616 sec 2.2
	* which has been replaced by the token definition in RFC 7230 appendix B.
	*
	* cookie-name       = token
	* token             = 1*tchar
	* tchar             = "!" / "#" / "$" / "%" / "&" / "'" /
	*                     "*" / "+" / "-" / "." / "^" / "_" /
	*                     "`" / "|" / "~" / DIGIT / ALPHA
	*
	* Note: Allowing more characters - https://github.com/jshttp/cookie/issues/191
	* Allow same range as cookie value, except `=`, which delimits end of name.
	*/
	var cookieNameRegExp = /^[\u0021-\u003A\u003C\u003E-\u007E]+$/;
	/**
	* RegExp to match cookie-value in RFC 6265 sec 4.1.1
	*
	* cookie-value      = *cookie-octet / ( DQUOTE *cookie-octet DQUOTE )
	* cookie-octet      = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E
	*                     ; US-ASCII characters excluding CTLs,
	*                     ; whitespace DQUOTE, comma, semicolon,
	*                     ; and backslash
	*
	* Allowing more characters: https://github.com/jshttp/cookie/issues/191
	* Comma, backslash, and DQUOTE are not part of the parsing algorithm.
	*/
	var cookieValueRegExp = /^[\u0021-\u003A\u003C-\u007E]*$/;
	/**
	* RegExp to match domain-value in RFC 6265 sec 4.1.1
	*
	* domain-value      = <subdomain>
	*                     ; defined in [RFC1034], Section 3.5, as
	*                     ; enhanced by [RFC1123], Section 2.1
	* <subdomain>       = <label> | <subdomain> "." <label>
	* <label>           = <let-dig> [ [ <ldh-str> ] <let-dig> ]
	*                     Labels must be 63 characters or less.
	*                     'let-dig' not 'letter' in the first char, per RFC1123
	* <ldh-str>         = <let-dig-hyp> | <let-dig-hyp> <ldh-str>
	* <let-dig-hyp>     = <let-dig> | "-"
	* <let-dig>         = <letter> | <digit>
	* <letter>          = any one of the 52 alphabetic characters A through Z in
	*                     upper case and a through z in lower case
	* <digit>           = any one of the ten digits 0 through 9
	*
	* Keep support for leading dot: https://github.com/jshttp/cookie/issues/173
	*
	* > (Note that a leading %x2E ("."), if present, is ignored even though that
	* character is not permitted, but a trailing %x2E ("."), if present, will
	* cause the user agent to ignore the attribute.)
	*/
	var domainValueRegExp = /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
	/**
	* RegExp to match path-value in RFC 6265 sec 4.1.1
	*
	* path-value        = <any CHAR except CTLs or ";">
	* CHAR              = %x01-7F
	*                     ; defined in RFC 5234 appendix B.1
	*/
	var pathValueRegExp = /^[\u0020-\u003A\u003D-\u007E]*$/;
	var __toString = Object.prototype.toString;
	var NullObject = /* @__PURE__ */ (() => {
		const C = function() {};
		C.prototype = Object.create(null);
		return C;
	})();
	/**
	* Parse a `Cookie` header.
	*
	* Parse the given cookie header string into an object
	* The object has the various cookies as keys(names) => values
	*/
	function parseCookie(str, options) {
		const obj = new NullObject();
		const len = str.length;
		if (len < 2) return obj;
		const dec = options?.decode || decode;
		let index = 0;
		do {
			const eqIdx = eqIndex(str, index, len);
			if (eqIdx === -1) break;
			const endIdx = endIndex(str, index, len);
			if (eqIdx > endIdx) {
				index = str.lastIndexOf(";", eqIdx - 1) + 1;
				continue;
			}
			const key = valueSlice(str, index, eqIdx);
			if (obj[key] === void 0) obj[key] = dec(valueSlice(str, eqIdx + 1, endIdx));
			index = endIdx + 1;
		} while (index < len);
		return obj;
	}
	function stringifySetCookie(_name, _val, _opts) {
		const cookie = typeof _name === "object" ? _name : {
			..._opts,
			name: _name,
			value: String(_val)
		};
		const enc = (typeof _val === "object" ? _val : _opts)?.encode || encodeURIComponent;
		if (!cookieNameRegExp.test(cookie.name)) throw new TypeError(`argument name is invalid: ${cookie.name}`);
		const value = cookie.value ? enc(cookie.value) : "";
		if (!cookieValueRegExp.test(value)) throw new TypeError(`argument val is invalid: ${cookie.value}`);
		let str = cookie.name + "=" + value;
		if (cookie.maxAge !== void 0) {
			if (!Number.isInteger(cookie.maxAge)) throw new TypeError(`option maxAge is invalid: ${cookie.maxAge}`);
			str += "; Max-Age=" + cookie.maxAge;
		}
		if (cookie.domain) {
			if (!domainValueRegExp.test(cookie.domain)) throw new TypeError(`option domain is invalid: ${cookie.domain}`);
			str += "; Domain=" + cookie.domain;
		}
		if (cookie.path) {
			if (!pathValueRegExp.test(cookie.path)) throw new TypeError(`option path is invalid: ${cookie.path}`);
			str += "; Path=" + cookie.path;
		}
		if (cookie.expires) {
			if (!isDate(cookie.expires) || !Number.isFinite(cookie.expires.valueOf())) throw new TypeError(`option expires is invalid: ${cookie.expires}`);
			str += "; Expires=" + cookie.expires.toUTCString();
		}
		if (cookie.httpOnly) str += "; HttpOnly";
		if (cookie.secure) str += "; Secure";
		if (cookie.partitioned) str += "; Partitioned";
		if (cookie.priority) switch (typeof cookie.priority === "string" ? cookie.priority.toLowerCase() : void 0) {
			case "low":
				str += "; Priority=Low";
				break;
			case "medium":
				str += "; Priority=Medium";
				break;
			case "high":
				str += "; Priority=High";
				break;
			default: throw new TypeError(`option priority is invalid: ${cookie.priority}`);
		}
		if (cookie.sameSite) switch (typeof cookie.sameSite === "string" ? cookie.sameSite.toLowerCase() : cookie.sameSite) {
			case true:
			case "strict":
				str += "; SameSite=Strict";
				break;
			case "lax":
				str += "; SameSite=Lax";
				break;
			case "none":
				str += "; SameSite=None";
				break;
			default: throw new TypeError(`option sameSite is invalid: ${cookie.sameSite}`);
		}
		return str;
	}
	/**
	* Find the `;` character between `min` and `len` in str.
	*/
	function endIndex(str, min, len) {
		const index = str.indexOf(";", min);
		return index === -1 ? len : index;
	}
	/**
	* Find the `=` character between `min` and `max` in str.
	*/
	function eqIndex(str, min, max) {
		const index = str.indexOf("=", min);
		return index < max ? index : -1;
	}
	/**
	* Slice out a value between startPod to max.
	*/
	function valueSlice(str, min, max) {
		let start = min;
		let end = max;
		do {
			const code = str.charCodeAt(start);
			if (code !== 32 && code !== 9) break;
		} while (++start < end);
		while (end > start) {
			const code = str.charCodeAt(end - 1);
			if (code !== 32 && code !== 9) break;
			end--;
		}
		return str.slice(start, end);
	}
	/**
	* URL-decode string value. Optimized to skip native call when no %.
	*/
	function decode(str) {
		if (str.indexOf("%") === -1) return str;
		try {
			return decodeURIComponent(str);
		} catch (e) {
			return str;
		}
	}
	/**
	* Determine if value is a Date.
	*/
	function isDate(val) {
		return __toString.call(val) === "[object Date]";
	}
})))();
var DELETED_EXPIRATION = /* @__PURE__ */ new Date(0);
var DELETED_VALUE = "deleted";
var responseSentSymbol = /* @__PURE__ */ Symbol.for("astro.responseSent");
var identity = (value) => value;
var AstroCookie = class {
	value;
	constructor(value) {
		this.value = value;
	}
	json() {
		if (this.value === void 0) throw new Error(`Cannot convert undefined to an object.`);
		return JSON.parse(this.value);
	}
	number() {
		return Number(this.value);
	}
	boolean() {
		if (this.value === "false") return false;
		if (this.value === "0") return false;
		return Boolean(this.value);
	}
};
var AstroCookies = class {
	#request;
	#requestValues;
	#outgoing;
	#consumed;
	constructor(request) {
		this.#request = request;
		this.#requestValues = null;
		this.#outgoing = null;
		this.#consumed = false;
	}
	/**
	* Astro.cookies.delete(key) is used to delete a cookie. Using this method will result
	* in a Set-Cookie header added to the response.
	* @param key The cookie to delete
	* @param options Options related to this deletion, such as the path of the cookie.
	*/
	delete(key, options) {
		const { maxAge: _ignoredMaxAge, expires: _ignoredExpires, ...sanitizedOptions } = options || {};
		const serializeOptions = {
			expires: DELETED_EXPIRATION,
			...sanitizedOptions
		};
		this.#ensureOutgoingMap().set(key, [
			DELETED_VALUE,
			(0, import_dist.serialize)(key, DELETED_VALUE, serializeOptions),
			false
		]);
	}
	/**
	* Astro.cookies.get(key) is used to get a cookie value. The cookie value is read from the
	* request. If you have set a cookie via Astro.cookies.set(key, value), the value will be taken
	* from that set call, overriding any values already part of the request.
	* @param key The cookie to get.
	* @returns An object containing the cookie value as well as convenience methods for converting its value.
	*/
	get(key, options = void 0) {
		if (this.#outgoing?.has(key)) {
			let [serializedValue, , isSetValue] = this.#outgoing.get(key);
			if (isSetValue) return new AstroCookie(serializedValue);
			else return;
		}
		const decode = options?.decode ?? decodeURIComponent;
		const values = this.#ensureParsed();
		if (key in values) {
			const value = values[key];
			if (value) {
				let decodedValue;
				try {
					decodedValue = decode(value);
				} catch (_error) {
					decodedValue = value;
				}
				return new AstroCookie(decodedValue);
			}
		}
	}
	/**
	* Astro.cookies.has(key) returns a boolean indicating whether this cookie is either
	* part of the initial request or set via Astro.cookies.set(key)
	* @param key The cookie to check for.
	* @param _options This parameter is no longer used.
	* @returns
	*/
	has(key, _options) {
		if (this.#outgoing?.has(key)) {
			let [, , isSetValue] = this.#outgoing.get(key);
			return isSetValue;
		}
		return this.#ensureParsed()[key] !== void 0;
	}
	/**
	* Astro.cookies.set(key, value) is used to set a cookie's value. If provided
	* an object it will be stringified via JSON.stringify(value). Additionally you
	* can provide options customizing how this cookie will be set, such as setting httpOnly
	* in order to prevent the cookie from being read in client-side JavaScript.
	* @param key The name of the cookie to set.
	* @param value A value, either a string or other primitive or an object.
	* @param options Options for the cookie, such as the path and security settings.
	*/
	set(key, value, options) {
		if (this.#consumed) {
			const warning = /* @__PURE__ */ new Error("Astro.cookies.set() was called after the cookies had already been sent to the browser.\nThis may have happened if this method was called in an imported component.\nPlease make sure that Astro.cookies.set() is only called in the frontmatter of the main page.");
			warning.name = "Warning";
			console.warn(warning);
		}
		let serializedValue;
		if (typeof value === "string") serializedValue = value;
		else {
			let toStringValue = value.toString();
			if (toStringValue === Object.prototype.toString.call(value)) serializedValue = JSON.stringify(value);
			else serializedValue = toStringValue;
		}
		const serializeOptions = {};
		if (options) Object.assign(serializeOptions, options);
		this.#ensureOutgoingMap().set(key, [
			serializedValue,
			(0, import_dist.serialize)(key, serializedValue, serializeOptions),
			true
		]);
		if (this.#request[responseSentSymbol]) throw new AstroError({ ...ResponseSentError });
	}
	/**
	* Merges a new AstroCookies instance into the current instance. Any new cookies
	* will be added to the current instance, overwriting any existing cookies with the same name.
	*/
	merge(cookies) {
		const outgoing = cookies.#outgoing;
		if (outgoing) for (const [key, value] of outgoing) this.#ensureOutgoingMap().set(key, value);
	}
	/**
	* Astro.cookies.header() returns an iterator for the cookies that have previously
	* been set by either Astro.cookies.set() or Astro.cookies.delete().
	* This method is primarily used by adapters to set the header on outgoing responses.
	* @returns
	*/
	*headers() {
		if (this.#outgoing == null) return;
		for (const [, value] of this.#outgoing) yield value[1];
	}
	/**
	* Marks the cookies as consumed and returns the header values.
	* After consumption, any subsequent `set()` calls will warn.
	*/
	consume() {
		this.#consumed = true;
		return this.headers();
	}
	/**
	* @deprecated Use the instance method `cookies.consume()` instead.
	* Kept for backward compatibility with adapters.
	*/
	static consume(cookies) {
		return cookies.consume();
	}
	#ensureParsed() {
		if (!this.#requestValues) this.#parse();
		if (!this.#requestValues) this.#requestValues = /* @__PURE__ */ Object.create(null);
		return this.#requestValues;
	}
	#ensureOutgoingMap() {
		if (!this.#outgoing) this.#outgoing = /* @__PURE__ */ new Map();
		return this.#outgoing;
	}
	#parse() {
		const raw = this.#request.headers.get("cookie");
		if (!raw) return;
		this.#requestValues = (0, import_dist.parse)(raw, { decode: identity });
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cookies/response.js
var astroCookiesSymbol = /* @__PURE__ */ Symbol.for("astro.cookies");
function attachCookiesToResponse(response, cookies) {
	Reflect.set(response, astroCookiesSymbol, cookies);
}
function getCookiesFromResponse(response) {
	let cookies = Reflect.get(response, astroCookiesSymbol);
	if (cookies != null) return cookies;
	else return;
}
function* getSetCookiesFromResponse(response) {
	const cookies = getCookiesFromResponse(response);
	if (!cookies) return [];
	for (const headerValue of cookies.consume()) yield headerValue;
	return [];
}
//#endregion
//#region node_modules/.pnpm/devalue@5.8.2/node_modules/devalue/src/stringify.js
/**
* Turn a value into a JSON string that can be parsed with `devalue.parse`
* @param {any} value
* @param {Record<string, (value: any) => any>} [reducers]
*/
function stringify$2(value, reducers) {
	const stringified = run(false, value, reducers);
	return typeof stringified === "string" ? stringified : `[${stringified.join(",")}]`;
}
/**
* @param {boolean} async
* @param {any} value
* @param {Record<string, (value: any) => any>} [reducers]
*/
function run(async, value, reducers) {
	/** @type {any[]} */
	const stringified = [];
	/** @type {Map<any, number>} */
	const indexes = /* @__PURE__ */ new Map();
	/** @type {Array<{ key: string, fn: (value: any) => any }>} */
	const custom = [];
	if (reducers) for (const key of Object.getOwnPropertyNames(reducers)) custom.push({
		key,
		fn: reducers[key]
	});
	/** @type {string[]} */
	const keys = [];
	let p = 0;
	/**
	* @param {any} thing
	* @param {number} [index]
	*/
	function flatten(thing, index) {
		if (thing === void 0) return -1;
		if (Number.isNaN(thing)) return -3;
		if (thing === Infinity) return -4;
		if (thing === -Infinity) return -5;
		if (thing === 0 && 1 / thing < 0) return -6;
		if (indexes.has(thing)) return indexes.get(thing);
		index ??= p++;
		indexes.set(thing, index);
		for (const { key, fn } of custom) {
			const value = fn(thing);
			if (value) {
				stringified[index] = `["${key}",${flatten(value)}]`;
				return index;
			}
		}
		if (typeof thing === "function") throw new DevalueError(`Cannot stringify a function`, keys, thing, value);
		else if (typeof thing === "symbol") throw new DevalueError(`Cannot stringify a Symbol primitive`, keys, thing, value);
		/** @type {string | Promise<any>} */
		let str = "";
		if (is_primitive(thing)) str = stringify_primitive(thing);
		else if (typeof thing.then === "function") {
			if (!async) throw new DevalueError(`Cannot stringify a Promise or thenable — use stringifyAsync instead`, keys, thing, value);
			str = Promise.resolve(thing).then((value) => {
				const i = flatten(value, index);
				if (i < 0) stringified[index] = i;
			});
		} else {
			const type = get_type(thing);
			switch (type) {
				case "Number":
				case "String":
				case "Boolean":
				case "BigInt":
					str = `["Object",${flatten(thing.valueOf())}]`;
					break;
				case "Date":
					str = `["Date","${!isNaN(thing.getDate()) ? thing.toISOString() : ""}"]`;
					break;
				case "URL":
					str = `["URL",${stringify_string(thing.toString())}]`;
					break;
				case "URLSearchParams":
					str = `["URLSearchParams",${stringify_string(thing.toString())}]`;
					break;
				case "RegExp":
					const { source, flags } = thing;
					str = flags ? `["RegExp",${stringify_string(source)},"${flags}"]` : `["RegExp",${stringify_string(source)}]`;
					break;
				case "Array": {
					let mostly_dense = false;
					str = "[";
					for (let i = 0; i < thing.length; i += 1) {
						if (i > 0) str += ",";
						if (Object.hasOwn(thing, i)) {
							keys.push(`[${i}]`);
							str += flatten(thing[i]);
							keys.pop();
						} else if (mostly_dense) str += -2;
						else {
							const populated_keys = valid_array_indices(thing);
							const population = populated_keys.length;
							const d = String(thing.length).length;
							if ((thing.length - population) * 3 > 4 + d + population * (d + 1)) {
								str = "[-7," + thing.length;
								for (let j = 0; j < populated_keys.length; j++) {
									const key = populated_keys[j];
									keys.push(`[${key}]`);
									str += "," + key + "," + flatten(thing[key]);
									keys.pop();
								}
								break;
							} else {
								mostly_dense = true;
								str += -2;
							}
						}
					}
					str += "]";
					break;
				}
				case "Set":
					str = "[\"Set\"";
					for (const value of thing) str += `,${flatten(value)}`;
					str += "]";
					break;
				case "Map":
					str = "[\"Map\"";
					for (const [key, value] of thing) {
						keys.push(`.get(${is_primitive(key) ? stringify_primitive(key) : "..."})`);
						str += `,${flatten(key)},${flatten(value)}`;
						keys.pop();
					}
					str += "]";
					break;
				case "Int8Array":
				case "Uint8Array":
				case "Uint8ClampedArray":
				case "Int16Array":
				case "Uint16Array":
				case "Float16Array":
				case "Int32Array":
				case "Uint32Array":
				case "Float32Array":
				case "Float64Array":
				case "BigInt64Array":
				case "BigUint64Array": {
					/** @type {import("./types.js").TypedArray} */
					const typedArray = thing;
					str = "[\"" + type + "\"," + flatten(typedArray.buffer);
					if (typedArray.byteLength !== typedArray.buffer.byteLength) str += `,${typedArray.byteOffset},${typedArray.length}`;
					str += "]";
					break;
				}
				case "DataView": {
					/** @type {DataView} */
					const view = thing;
					str = "[\"" + type + "\"," + flatten(view.buffer);
					if (view.byteLength !== view.buffer.byteLength) str += `,${view.byteOffset},${view.byteLength}`;
					str += "]";
					break;
				}
				case "ArrayBuffer":
					str = `["ArrayBuffer","${encode64(thing)}"]`;
					break;
				case "Temporal.Duration":
				case "Temporal.Instant":
				case "Temporal.PlainDate":
				case "Temporal.PlainTime":
				case "Temporal.PlainDateTime":
				case "Temporal.PlainMonthDay":
				case "Temporal.PlainYearMonth":
				case "Temporal.ZonedDateTime":
					str = `["${type}",${stringify_string(thing.toString())}]`;
					break;
				default:
					if (!is_plain_object(thing)) throw new DevalueError(`Cannot stringify arbitrary non-POJOs`, keys, thing, value);
					if (enumerable_symbols(thing).length > 0) throw new DevalueError(`Cannot stringify POJOs with symbolic keys`, keys, thing, value);
					if (Object.getPrototypeOf(thing) === null) {
						str = "[\"null\"";
						for (const key of Object.keys(thing)) {
							if (key === "__proto__") throw new DevalueError(`Cannot stringify objects with __proto__ keys`, keys, thing, value);
							keys.push(stringify_key(key));
							str += `,${stringify_string(key)},${flatten(thing[key])}`;
							keys.pop();
						}
						str += "]";
					} else {
						str = "{";
						let started = false;
						for (const key of Object.keys(thing)) {
							if (key === "__proto__") throw new DevalueError(`Cannot stringify objects with __proto__ keys`, keys, thing, value);
							if (started) str += ",";
							started = true;
							keys.push(stringify_key(key));
							str += `${stringify_string(key)}:${flatten(thing[key])}`;
							keys.pop();
						}
						str += "}";
					}
			}
		}
		stringified[index] = str;
		return index;
	}
	const index = flatten(value);
	if (index < 0) return `${index}`;
	return stringified;
}
/**
* @param {any} thing
* @returns {string}
*/
function stringify_primitive(thing) {
	const type = typeof thing;
	if (type === "string") return stringify_string(thing);
	if (thing === void 0) return (-1).toString();
	if (thing === 0 && 1 / thing < 0) return (-6).toString();
	if (type === "bigint") return `["BigInt","${thing}"]`;
	return String(thing);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/actions/consts.js
var ACTION_QUERY_PARAMS = {
	actionName: "_action",
	actionPayload: "_astroActionPayload"
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/actions/runtime/client.js
var codeToStatusMap = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	PAYMENT_REQUIRED: 402,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	METHOD_NOT_ALLOWED: 405,
	NOT_ACCEPTABLE: 406,
	PROXY_AUTHENTICATION_REQUIRED: 407,
	REQUEST_TIMEOUT: 408,
	CONFLICT: 409,
	GONE: 410,
	LENGTH_REQUIRED: 411,
	PRECONDITION_FAILED: 412,
	CONTENT_TOO_LARGE: 413,
	URI_TOO_LONG: 414,
	UNSUPPORTED_MEDIA_TYPE: 415,
	RANGE_NOT_SATISFIABLE: 416,
	EXPECTATION_FAILED: 417,
	MISDIRECTED_REQUEST: 421,
	UNPROCESSABLE_CONTENT: 422,
	LOCKED: 423,
	FAILED_DEPENDENCY: 424,
	TOO_EARLY: 425,
	UPGRADE_REQUIRED: 426,
	PRECONDITION_REQUIRED: 428,
	TOO_MANY_REQUESTS: 429,
	REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
	UNAVAILABLE_FOR_LEGAL_REASONS: 451,
	INTERNAL_SERVER_ERROR: 500,
	NOT_IMPLEMENTED: 501,
	BAD_GATEWAY: 502,
	SERVICE_UNAVAILABLE: 503,
	GATEWAY_TIMEOUT: 504,
	HTTP_VERSION_NOT_SUPPORTED: 505,
	VARIANT_ALSO_NEGOTIATES: 506,
	INSUFFICIENT_STORAGE: 507,
	LOOP_DETECTED: 508,
	NETWORK_AUTHENTICATION_REQUIRED: 511
};
var statusToCodeMap = Object.fromEntries(Object.entries(codeToStatusMap).map(([key, value]) => [value, key]));
var ActionError = class ActionError extends Error {
	type = "AstroActionError";
	code = "INTERNAL_SERVER_ERROR";
	status = 500;
	constructor(params) {
		super(params.message);
		this.code = params.code;
		this.status = ActionError.codeToStatus(params.code);
		if (params.stack) this.stack = params.stack;
	}
	static codeToStatus(code) {
		return codeToStatusMap[code];
	}
	static statusToCode(status) {
		return statusToCodeMap[status] ?? "INTERNAL_SERVER_ERROR";
	}
	static fromJson(body) {
		if (isInputError(body)) return new ActionInputError(body.issues);
		if (isActionError(body)) return new ActionError(body);
		return new ActionError({ code: "INTERNAL_SERVER_ERROR" });
	}
};
function isActionError(error) {
	return typeof error === "object" && error != null && "type" in error && error.type === "AstroActionError";
}
function isInputError(error) {
	return typeof error === "object" && error != null && "type" in error && error.type === "AstroActionInputError" && "issues" in error && Array.isArray(error.issues);
}
var ActionInputError = class extends ActionError {
	type = "AstroActionInputError";
	issues;
	fields;
	constructor(issues) {
		super({
			message: `Failed to validate: ${JSON.stringify(issues, null, 2)}`,
			code: "BAD_REQUEST"
		});
		this.issues = issues;
		this.fields = {};
		for (const issue of issues) if (issue.path.length > 0) {
			const key = issue.path[0].toString();
			this.fields[key] ??= [];
			this.fields[key]?.push(issue.message);
		}
	}
};
function deserializeActionResult(res) {
	if (res.type === "error") {
		let json;
		try {
			json = JSON.parse(res.body);
		} catch {
			return {
				data: void 0,
				error: new ActionError({
					message: res.body,
					code: "INTERNAL_SERVER_ERROR"
				})
			};
		}
		if (Object.assign({
			"ASSETS_PREFIX": void 0,
			"BASE_URL": "/",
			"DEV": false,
			"MODE": "production",
			"PROD": true,
			"SITE": void 0,
			"SSR": true
		}, {
			LD: "ld",
			AR: "ar",
			AS: "as",
			CC: "gcc",
			name: "kolu-shell-env"
		})?.PROD) return {
			error: ActionError.fromJson(json),
			data: void 0
		};
		else {
			const error = ActionError.fromJson(json);
			error.stack = actionResultErrorStack.get();
			return {
				error,
				data: void 0
			};
		}
	}
	if (res.type === "empty") return {
		data: void 0,
		error: void 0
	};
	return {
		data: parse$1(res.body, { URL: (href) => new URL(href) }),
		error: void 0
	};
}
var actionResultErrorStack = /* @__PURE__ */ (function actionResultErrorStackFn() {
	let errorStack;
	return {
		set(stack) {
			errorStack = stack;
		},
		get() {
			return errorStack;
		}
	};
})();
function getActionQueryString(name) {
	return `?${new URLSearchParams({ [ACTION_QUERY_PARAMS.actionName]: name }).toString()}`;
}
(function(A) {
	return A[A.Static = 1] = "Static", A[A.Dynamic = 2] = "Dynamic", A[A.ImportMeta = 3] = "ImportMeta", A[A.StaticSourcePhase = 4] = "StaticSourcePhase", A[A.DynamicSourcePhase = 5] = "DynamicSourcePhase", A[A.StaticDeferPhase = 6] = "StaticDeferPhase", A[A.DynamicDeferPhase = 7] = "DynamicDeferPhase", A;
})({});
new Uint8Array(new Uint16Array([1]).buffer)[0];
var C = () => {
	return A = "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", "undefined" != typeof Buffer ? Buffer.from(A, "base64") : Uint8Array.from(atob(A), (A) => A.charCodeAt(0));
	var A;
};
WebAssembly.compile(C()).then(WebAssembly.instantiate).then(({ exports: A }) => {});
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/actions/runtime/server.js
function getActionContext(context) {
	const callerInfo = getCallerInfo(context);
	const actionResultAlreadySet = Boolean(context.locals._actionPayload);
	let action = void 0;
	if (callerInfo && context.request.method === "POST" && !actionResultAlreadySet) action = {
		calledFrom: callerInfo.from,
		name: callerInfo.name,
		handler: async () => {
			const pipeline = Reflect.get(context, pipelineSymbol);
			const callerInfoName = shouldAppendForwardSlash(pipeline.manifest.trailingSlash, pipeline.manifest.buildFormat) ? removeTrailingForwardSlash(callerInfo.name) : callerInfo.name;
			let baseAction;
			try {
				baseAction = await pipeline.getAction(callerInfoName);
			} catch (error) {
				if (error instanceof Error && "name" in error && typeof error.name === "string" && error.name === ActionNotFoundError.name) return {
					data: void 0,
					error: new ActionError({ code: "NOT_FOUND" })
				};
				throw error;
			}
			const bodySizeLimit = pipeline.manifest.actionBodySizeLimit;
			let input;
			try {
				input = await parseRequestBody(context.request, bodySizeLimit);
			} catch (e) {
				if (e instanceof ActionError) return {
					data: void 0,
					error: e
				};
				if (e instanceof TypeError) return {
					data: void 0,
					error: new ActionError({ code: "UNSUPPORTED_MEDIA_TYPE" })
				};
				throw e;
			}
			const omitKeys = [
				"props",
				"getActionResult",
				"callAction",
				"redirect"
			];
			const actionAPIContext = Object.create(Object.getPrototypeOf(context), Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(context)).filter(([key]) => !omitKeys.includes(key))));
			Reflect.set(actionAPIContext, ACTION_API_CONTEXT_SYMBOL, true);
			return baseAction.bind(actionAPIContext)(input);
		}
	};
	function setActionResult(actionName, actionResult) {
		context.locals._actionPayload = {
			actionResult,
			actionName
		};
	}
	return {
		action,
		setActionResult,
		serializeActionResult,
		deserializeActionResult
	};
}
function getCallerInfo(ctx) {
	if (ctx.routePattern === "/_actions/[...path]") return {
		from: "rpc",
		name: ctx.url.pathname.replace(/^.*\/_actions\//, "")
	};
	const queryParam = ctx.url.searchParams.get(ACTION_QUERY_PARAMS.actionName);
	if (queryParam) return {
		from: "form",
		name: queryParam
	};
}
async function parseRequestBody(request, bodySizeLimit) {
	const contentType = request.headers.get("content-type");
	const contentLengthHeader = request.headers.get("content-length");
	const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : void 0;
	const hasContentLength = typeof contentLength === "number" && Number.isFinite(contentLength);
	if (!contentType) return void 0;
	if (hasContentLength && contentLength > bodySizeLimit) throw new ActionError({
		code: "CONTENT_TOO_LARGE",
		message: `Request body exceeds ${bodySizeLimit} bytes`
	});
	try {
		if (hasContentType(contentType, formContentTypes)) {
			if (!hasContentLength) {
				const body = await readBodyWithLimit(request.clone(), bodySizeLimit);
				return await new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body: toArrayBuffer(body)
				}).formData();
			}
			return await request.clone().formData();
		}
		if (hasContentType(contentType, ["application/json"])) {
			if (contentLength === 0) return void 0;
			if (!hasContentLength) {
				const body = await readBodyWithLimit(request.clone(), bodySizeLimit);
				if (body.byteLength === 0) return void 0;
				return JSON.parse(new TextDecoder().decode(body));
			}
			return await request.clone().json();
		}
	} catch (e) {
		if (e instanceof BodySizeLimitError) throw new ActionError({
			code: "CONTENT_TOO_LARGE",
			message: `Request body exceeds ${bodySizeLimit} bytes`
		});
		throw e;
	}
	throw new TypeError("Unsupported content type");
}
var ACTION_API_CONTEXT_SYMBOL = /* @__PURE__ */ Symbol.for("astro.actionAPIContext");
var formContentTypes = ["application/x-www-form-urlencoded", "multipart/form-data"];
function hasContentType(contentType, expected) {
	const type = contentType.split(";")[0].toLowerCase();
	return expected.some((t) => type === t);
}
function serializeActionResult(res) {
	if (res.error) {
		if (Object.assign({
			"ASSETS_PREFIX": void 0,
			"BASE_URL": "/",
			"DEV": false,
			"MODE": "production",
			"PROD": true,
			"SITE": void 0,
			"SSR": true
		}, {
			AR: "ar",
			out: "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/outputs/out",
			name: "kolu-shell-env"
		})?.DEV) actionResultErrorStack.set(res.error.stack);
		let body2;
		if (res.error instanceof ActionInputError) body2 = {
			type: res.error.type,
			issues: res.error.issues,
			fields: res.error.fields
		};
		else body2 = {
			...res.error,
			message: res.error.message
		};
		return {
			type: "error",
			status: res.error.status,
			contentType: "application/json",
			body: JSON.stringify(body2)
		};
	}
	if (res.data === void 0) return {
		type: "empty",
		status: 204
	};
	let body;
	try {
		body = stringify$2(res.data, { URL: (value) => value instanceof URL && value.href });
	} catch (e) {
		let hint = ActionsReturnedInvalidDataError.hint;
		if (res.data instanceof Response) hint = REDIRECT_STATUS_CODES.includes(res.data.status) ? "If you need to redirect when the action succeeds, trigger a redirect where the action is called. See the Actions guide for server and client redirect examples: https://docs.astro.build/en/guides/actions." : "If you need to return a Response object, try using a server endpoint instead. See https://docs.astro.build/en/guides/endpoints/#server-endpoints-api-routes";
		throw new AstroError({
			...ActionsReturnedInvalidDataError,
			message: ActionsReturnedInvalidDataError.message(String(e)),
			hint
		});
	}
	return {
		type: "data",
		status: 200,
		contentType: "application/json+devalue",
		body
	};
}
function toArrayBuffer(buffer) {
	const copy = new Uint8Array(buffer.byteLength);
	copy.set(buffer);
	return copy.buffer;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/actions/utils.js
function hasActionPayload(locals) {
	return "_actionPayload" in locals;
}
function createGetActionResult(locals) {
	return (actionFn) => {
		if (!hasActionPayload(locals) || actionFn.toString() !== getActionQueryString(locals._actionPayload.actionName)) return;
		return deserializeActionResult(locals._actionPayload.actionResult);
	};
}
function createCallAction(context) {
	return (baseAction, input) => {
		Reflect.set(context, ACTION_API_CONTEXT_SYMBOL, true);
		return baseAction.bind(context)(input);
	};
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/i18n/fallback.js
function computeFallbackRoute(options) {
	const { pathname, responseStatus, fallback, fallbackType, locales, defaultLocale, strategy, base } = options;
	if (responseStatus !== 404) return { type: "none" };
	if (!fallback || Object.keys(fallback).length === 0) return { type: "none" };
	const urlLocale = pathname.split("/").find((segment) => {
		for (const locale of locales) if (typeof locale === "string") {
			if (locale === segment) return true;
		} else if (locale.path === segment) return true;
		return false;
	});
	if (!urlLocale) return { type: "none" };
	if (!Object.keys(fallback).includes(urlLocale)) return { type: "none" };
	const fallbackLocale = fallback[urlLocale];
	const pathFallbackLocale = getPathByLocale(fallbackLocale, locales);
	let newPathname;
	if (pathFallbackLocale === defaultLocale && strategy === "pathname-prefix-other-locales") if (pathname.includes(`${base}`)) newPathname = pathname.replace(`/${urlLocale}`, ``);
	else newPathname = pathname.replace(`/${urlLocale}`, `/`);
	else newPathname = pathname.replace(`/${urlLocale}`, `/${pathFallbackLocale}`);
	return {
		type: fallbackType,
		pathname: newPathname
	};
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/i18n/router.js
var I18nRouter = class {
	#strategy;
	#defaultLocale;
	#locales;
	#base;
	#domains;
	constructor(options) {
		this.#strategy = options.strategy;
		this.#defaultLocale = options.defaultLocale;
		this.#locales = options.locales;
		this.#base = options.base === "/" ? "/" : removeTrailingForwardSlash(options.base || "");
		this.#domains = options.domains;
	}
	/**
	* Evaluate routing strategy for a pathname.
	* Returns decision object (not HTTP Response).
	*/
	match(pathname, context) {
		if (this.shouldSkipProcessing(pathname, context)) return { type: "continue" };
		switch (this.#strategy) {
			case "manual": return { type: "continue" };
			case "pathname-prefix-always": return this.matchPrefixAlways(pathname, context);
			case "domains-prefix-always":
				if (this.localeHasntDomain(context.currentLocale, context.currentDomain)) return { type: "continue" };
				return this.matchPrefixAlways(pathname, context);
			case "pathname-prefix-other-locales": return this.matchPrefixOtherLocales(pathname, context);
			case "domains-prefix-other-locales":
				if (this.localeHasntDomain(context.currentLocale, context.currentDomain)) return { type: "continue" };
				return this.matchPrefixOtherLocales(pathname, context);
			case "pathname-prefix-always-no-redirect": return this.matchPrefixAlwaysNoRedirect(pathname, context);
			case "domains-prefix-always-no-redirect":
				if (this.localeHasntDomain(context.currentLocale, context.currentDomain)) return { type: "continue" };
				return this.matchPrefixAlwaysNoRedirect(pathname, context);
			default: return { type: "continue" };
		}
	}
	/**
	* Check if i18n processing should be skipped for this request
	*/
	shouldSkipProcessing(pathname, context) {
		if (pathname.includes("/404") || pathname.includes("/500")) return true;
		if (pathname.includes("/_server-islands/")) return true;
		if (context.isReroute) return true;
		if (context.routeType && context.routeType !== "page" && context.routeType !== "fallback") return true;
		return false;
	}
	/**
	* Strategy: pathname-prefix-always
	* All locales must have a prefix, including the default locale.
	*/
	matchPrefixAlways(pathname, _context) {
		if (pathname === this.#base + "/" || pathname === this.#base) return {
			type: "redirect",
			location: `${this.#base === "/" ? "" : this.#base}/${this.#defaultLocale}`
		};
		if (!pathHasLocale(pathname, this.#locales)) return { type: "notFound" };
		return { type: "continue" };
	}
	/**
	* Strategy: pathname-prefix-other-locales
	* Default locale has no prefix, other locales must have a prefix.
	*/
	matchPrefixOtherLocales(pathname, _context) {
		let pathnameContainsDefaultLocale = false;
		for (const segment of pathname.split("/")) if (normalizeTheLocale(segment) === normalizeTheLocale(this.#defaultLocale)) {
			pathnameContainsDefaultLocale = true;
			break;
		}
		if (pathnameContainsDefaultLocale) return {
			type: "notFound",
			location: pathname.replace(`/${this.#defaultLocale}`, "")
		};
		return { type: "continue" };
	}
	/**
	* Strategy: pathname-prefix-always-no-redirect
	* Like prefix-always but allows root to serve instead of redirecting
	*/
	matchPrefixAlwaysNoRedirect(pathname, _context) {
		if (pathname === this.#base + "/" || pathname === this.#base) return { type: "continue" };
		if (!pathHasLocale(pathname, this.#locales)) return { type: "notFound" };
		return { type: "continue" };
	}
	/**
	* Check if the current locale doesn't belong to the configured domain.
	* Used for domain-based routing strategies.
	*/
	localeHasntDomain(currentLocale, currentDomain) {
		if (!this.#domains || !currentDomain) return false;
		if (!currentLocale) return false;
		const localesForDomain = this.#domains[currentDomain];
		if (!localesForDomain) return true;
		return !localesForDomain.includes(currentLocale);
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/i18n/handler.js
var I18n = class {
	#i18n;
	#base;
	#trailingSlash;
	#format;
	#router;
	constructor(i18n, base, trailingSlash, format) {
		this.#i18n = i18n;
		this.#base = base;
		this.#trailingSlash = trailingSlash;
		this.#format = format;
		this.#router = new I18nRouter({
			strategy: i18n.strategy,
			defaultLocale: i18n.defaultLocale,
			locales: i18n.locales,
			base,
			domains: i18n.domainLookupTable ? Object.keys(i18n.domainLookupTable).reduce((acc, domain) => {
				const locale = i18n.domainLookupTable[domain];
				if (!acc[domain]) acc[domain] = [];
				acc[domain].push(locale);
				return acc;
			}, {}) : void 0
		});
	}
	async finalize(state, response) {
		state.pipeline.usedFeatures |= PipelineFeatures.i18n;
		const i18n = this.#i18n;
		if (state.skipErrorReroute && typeof i18n.fallback === "undefined") return response;
		if (state.responseRouteType !== "page" && state.responseRouteType !== "fallback") return response;
		const url = state.url;
		const currentLocale = state.computeCurrentLocale();
		const isPrerendered = state.routeData.prerender;
		const routerContext = {
			currentLocale,
			currentDomain: url.hostname,
			routeType: state.responseRouteType,
			isReroute: false
		};
		const routeDecision = this.#router.match(url.pathname, routerContext);
		switch (routeDecision.type) {
			case "redirect": {
				let location = routeDecision.location;
				if (shouldAppendForwardSlash(this.#trailingSlash, this.#format)) location = appendForwardSlash(location);
				return new Response(null, {
					status: routeDecision.status ?? 302,
					headers: { Location: location }
				});
			}
			case "notFound": {
				if (isPrerendered) {
					const prerenderedRes = new Response(response.body, {
						status: 404,
						headers: response.headers
					});
					state.skipErrorReroute = true;
					if (routeDecision.location) prerenderedRes.headers.set("Location", routeDecision.location);
					return prerenderedRes;
				}
				const headers = new Headers();
				if (routeDecision.location) headers.set("Location", routeDecision.location);
				return new Response(null, {
					status: 404,
					headers
				});
			}
			case "continue": break;
		}
		if (i18n.fallback && i18n.fallbackType) {
			const effectiveStatus = state.responseRouteType === "fallback" ? 404 : response.status;
			const fallbackDecision = computeFallbackRoute({
				pathname: url.pathname,
				responseStatus: effectiveStatus,
				currentLocale,
				fallback: i18n.fallback,
				fallbackType: i18n.fallbackType,
				locales: i18n.locales,
				defaultLocale: i18n.defaultLocale,
				strategy: i18n.strategy,
				base: this.#base
			});
			switch (fallbackDecision.type) {
				case "redirect": return new Response(null, {
					status: 302,
					headers: { Location: fallbackDecision.pathname + url.search }
				});
				case "rewrite": return await state.rewrite(fallbackDecision.pathname + url.search);
				case "none": break;
			}
		}
		return response;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/i18n/index.js
function getPathByLocale(locale, locales) {
	for (const loopLocale of locales) if (typeof loopLocale === "string") {
		if (loopLocale === locale) return loopLocale;
	} else for (const code of loopLocale.codes) if (code === locale) return loopLocale.path;
	throw new AstroError(i18nNoLocaleFoundInPath);
}
function getAllCodes(locales) {
	const result = [];
	for (const loopLocale of locales) if (typeof loopLocale === "string") result.push(loopLocale);
	else result.push(...loopLocale.codes);
	return result;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/i18n/utils.js
function parseLocale(header) {
	if (header === "*") return [{
		locale: header,
		qualityValue: void 0
	}];
	const result = [];
	const localeValues = header.split(",").map((str) => str.trim());
	for (const localeValue of localeValues) {
		const split = localeValue.split(";").map((str) => str.trim());
		const localeName = split[0];
		const qualityValue = split[1];
		if (!split) continue;
		if (qualityValue && qualityValue.startsWith("q=")) {
			const qualityValueAsFloat = Number.parseFloat(qualityValue.slice(2));
			if (Number.isNaN(qualityValueAsFloat) || qualityValueAsFloat > 1) result.push({
				locale: localeName,
				qualityValue: void 0
			});
			else result.push({
				locale: localeName,
				qualityValue: qualityValueAsFloat
			});
		} else result.push({
			locale: localeName,
			qualityValue: void 0
		});
	}
	return result;
}
function sortAndFilterLocales(browserLocaleList, locales) {
	const normalizedLocales = getAllCodes(locales).map(normalizeTheLocale);
	return browserLocaleList.filter((browserLocale) => {
		if (browserLocale.locale !== "*") return normalizedLocales.includes(normalizeTheLocale(browserLocale.locale));
		return true;
	}).sort((a, b) => {
		if (a.qualityValue && b.qualityValue) return Math.sign(b.qualityValue - a.qualityValue);
		return 0;
	});
}
function computePreferredLocale(request, locales) {
	const acceptHeader = request.headers.get("Accept-Language");
	let result = void 0;
	if (acceptHeader) {
		const firstResult = sortAndFilterLocales(parseLocale(acceptHeader), locales).at(0);
		if (firstResult && firstResult.locale !== "*") {
			outer: for (const currentLocale of locales) if (typeof currentLocale === "string") {
				if (normalizeTheLocale(currentLocale) === normalizeTheLocale(firstResult.locale)) {
					result = currentLocale;
					break;
				}
			} else for (const currentCode of currentLocale.codes) if (normalizeTheLocale(currentCode) === normalizeTheLocale(firstResult.locale)) {
				result = currentCode;
				break outer;
			}
		}
	}
	return result;
}
function computePreferredLocaleList(request, locales) {
	const acceptHeader = request.headers.get("Accept-Language");
	let result = [];
	if (acceptHeader) {
		const browserLocaleList = sortAndFilterLocales(parseLocale(acceptHeader), locales);
		if (browserLocaleList.length === 1 && browserLocaleList.at(0).locale === "*") return getAllCodes(locales);
		else if (browserLocaleList.length > 0) {
			for (const browserLocale of browserLocaleList) for (const loopLocale of locales) if (typeof loopLocale === "string") {
				if (normalizeTheLocale(loopLocale) === normalizeTheLocale(browserLocale.locale)) result.push(loopLocale);
			} else for (const code of loopLocale.codes) if (code === browserLocale.locale) result.push(code);
		}
	}
	return result;
}
function computeCurrentLocale(pathname, locales, defaultLocale) {
	for (const segment of pathname.split("/").map(normalizeThePath)) for (const locale of locales) if (typeof locale === "string") {
		if (!segment.includes(locale)) continue;
		if (normalizeTheLocale(locale) === normalizeTheLocale(segment)) return locale;
	} else if (locale.path === segment) return locale.codes.at(0);
	else for (const code of locale.codes) if (normalizeTheLocale(code) === normalizeTheLocale(segment)) return code;
	for (const locale of locales) if (typeof locale === "string") {
		if (locale === defaultLocale) return locale;
	} else if (locale.path === defaultLocale) return locale.codes.at(0);
}
function computeCurrentLocaleFromParams(params, locales) {
	const byNormalizedCode = /* @__PURE__ */ new Map();
	const byPath = /* @__PURE__ */ new Map();
	for (const locale of locales) if (typeof locale === "string") byNormalizedCode.set(normalizeTheLocale(locale), locale);
	else {
		byPath.set(locale.path, locale.codes[0]);
		for (const code of locale.codes) byNormalizedCode.set(normalizeTheLocale(code), code);
	}
	for (const value of Object.values(params)) {
		if (!value) continue;
		const pathMatch = byPath.get(value);
		if (pathMatch) return pathMatch;
		const codeMatch = byNormalizedCode.get(normalizeTheLocale(value));
		if (codeMatch) return codeMatch;
	}
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/middleware/callMiddleware.js
async function callMiddleware(onRequest, apiContext, responseFunction) {
	let nextCalled = false;
	let responseFunctionPromise = void 0;
	const next = async (payload) => {
		nextCalled = true;
		responseFunctionPromise = responseFunction(apiContext, payload);
		return responseFunctionPromise;
	};
	const middlewarePromise = onRequest(apiContext, next);
	return await Promise.resolve(middlewarePromise).then(async (value) => {
		if (nextCalled) if (typeof value !== "undefined") {
			if (value instanceof Response === false) throw new AstroError(MiddlewareNotAResponse);
			return value;
		} else if (responseFunctionPromise) return responseFunctionPromise;
		else throw new AstroError(MiddlewareNotAResponse);
		else if (typeof value === "undefined") throw new AstroError(MiddlewareNoDataOrNextCalled);
		else if (value instanceof Response === false) throw new AstroError(MiddlewareNotAResponse);
		else return value;
	});
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cache/runtime/noop.js
var EMPTY_OPTIONS = Object.freeze({ tags: [] });
var NoopAstroCache = class {
	enabled = false;
	set() {}
	get tags() {
		return [];
	}
	get options() {
		return EMPTY_OPTIONS;
	}
	async invalidate() {}
};
var hasWarned = false;
var DisabledAstroCache = class {
	enabled = false;
	#logger;
	constructor(logger) {
		this.#logger = logger;
	}
	#warn() {
		if (!hasWarned) {
			hasWarned = true;
			this.#logger?.warn("cache", "`cache.set()` was called but caching is not enabled. Configure a cache provider in your Astro config under `cache` to enable caching.");
		}
	}
	set() {
		this.#warn();
	}
	get tags() {
		return [];
	}
	get options() {
		return EMPTY_OPTIONS;
	}
	async invalidate() {
		throw new AstroError(CacheNotEnabled);
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/middleware/astro-middleware.js
var AstroMiddleware = class {
	#pipeline;
	constructor(pipeline) {
		this.#pipeline = pipeline;
	}
	async handle(state, renderRouteCallback) {
		state.pipeline.usedFeatures |= PipelineFeatures.middleware;
		const pipeline = this.#pipeline;
		await state.getProps();
		const apiContext = state.getAPIContext();
		state.counter++;
		if (state.counter === 4) return new Response("Loop Detected", {
			status: 508,
			statusText: "Astro detected a loop where you tried to call the rewriting logic more than four times."
		});
		const next = async (ctx, payload) => {
			if (payload) {
				pipeline.logger.debug("router", "Called rewriting to:", payload);
				applyRewriteToState(state, payload, await pipeline.tryRewrite(payload, state.request));
			}
			return renderRouteCallback(state, ctx);
		};
		let response;
		if (state.skipMiddleware) response = await next(apiContext);
		else {
			const pipelineMiddleware = await pipeline.getMiddleware();
			response = await callMiddleware(sequence(...pipeline.internalMiddleware, pipelineMiddleware), apiContext, next);
		}
		response = this.#finalize(state, response);
		state.response = response;
		return response;
	}
	/**
	* Like `handle`, but mirrors the app-level error handling that
	* `AstroHandler` provides on the standard path, the same way
	* `PagesHandler.handleWithErrorFallback` does for `pages()`. When no
	* route matched it returns a 404 marked with `X-Astro-Error` for the
	* app's post-check; when Astro's own middleware chain throws it logs the
	* error and renders the custom `500.astro`.
	*
	* Errors surfaced through `renderRouteCallback` (the host framework's
	* `next`, e.g. host middleware mounted below `middleware()`) are
	* re-thrown instead, so the host's own error handling still runs rather
	* than being swallowed into Astro's 500 page. A sentinel tells the two
	* apart.
	*
	* Used by the composable `astro/fetch` `middleware()` entry point, where
	* there is no surrounding `AstroHandler` to supply this fallback.
	*/
	async handleWithErrorFallback(app, state, renderRouteCallback) {
		if (!state.routeData) return new Response(null, {
			status: 404,
			headers: { [ASTRO_ERROR_HEADER]: "true" }
		});
		let nextError;
		try {
			return await this.handle(state, async (s, ctx) => {
				try {
					return await renderRouteCallback(s, ctx);
				} catch (err) {
					nextError = err;
					throw err;
				}
			});
		} catch (err) {
			if (err === nextError) throw err;
			app.logger.error(null, err.stack || err.message || String(err));
			return app.renderError(state.request, {
				...state.renderOptions,
				status: 500,
				error: err,
				pathname: state.pathname
			});
		}
	}
	#finalize(state, response) {
		attachCookiesToResponse(response, state.cookies);
		return response;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/pages/handler.js
var EMPTY_SLOTS = Object.freeze({});
var PagesHandler = class {
	#pipeline;
	constructor(pipeline) {
		this.#pipeline = pipeline;
	}
	async handle(state, ctx) {
		const { logger, streaming } = this.#pipeline;
		state.resetResponseMetadata();
		let response;
		const componentInstance = await state.loadComponentInstance();
		switch (state.routeData.type) {
			case "endpoint":
				response = await renderEndpoint(componentInstance, ctx, state.routeData.prerender, logger, state);
				break;
			case "page": {
				const props = await state.getProps();
				const actionApiContext = state.getActionAPIContext();
				const result = await state.createResult(componentInstance, actionApiContext);
				try {
					response = await renderPage(result, componentInstance?.default, props, state.slots ?? EMPTY_SLOTS, streaming, state.routeData);
				} catch (e) {
					result.cancelled = true;
					throw e;
				}
				state.responseRouteType = "page";
				if (state.routeData.route === "/404" || state.routeData.route === "/500") state.skipErrorReroute = true;
				break;
			}
			case "redirect": return new Response(null, {
				status: 404,
				headers: { [ASTRO_ERROR_HEADER]: "true" }
			});
			case "fallback":
				state.responseRouteType = "fallback";
				return new Response(null, { status: 500 });
		}
		const responseCookies = getCookiesFromResponse(response);
		if (responseCookies) state.cookies.merge(responseCookies);
		state.response = response;
		return response;
	}
	/**
	* Like `handle`, but mirrors the app-level error handling that
	* `AstroHandler` provides on the standard path: unmatched routes
	* return a 404 marked with `X-Astro-Error` for the app's post-check
	* to render the 404 error page, and render-time errors are logged
	* and render the 500 error page instead of propagating to the host
	* framework.
	*
	* Used by the composable `astro/fetch` `pages()` entry point, where
	* there is no surrounding `AstroHandler` to supply this fallback.
	*/
	async handleWithErrorFallback(app, state) {
		if (!state.routeData) return new Response(null, {
			status: 404,
			headers: { [ASTRO_ERROR_HEADER]: "true" }
		});
		const ctx = state.getAPIContext();
		if (this.#pipeline.manifest.checkOrigin && isForbiddenCrossOriginRequest(ctx.request, ctx.url, ctx.isPrerendered)) return createCrossOriginForbiddenResponse(ctx.request);
		try {
			return await this.handle(state, ctx);
		} catch (err) {
			app.logger.error(null, err.stack || err.message || String(err));
			return app.renderError(state.request, {
				...state.renderOptions,
				status: 500,
				error: err,
				pathname: state.pathname
			});
		}
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/util/normalized-url.js
function createNormalizedUrl(requestUrl) {
	return normalizeUrl(new URL(requestUrl));
}
function normalizeUrl(url) {
	try {
		url.pathname = validateAndDecodePathname(url.pathname);
	} catch {
		try {
			url.pathname = decodeURI(url.pathname);
		} catch {}
	}
	url.pathname = collapseDuplicateSlashes(url.pathname);
	return url;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/rewrites/handler.js
function applyRewriteToState(state, payload, { routeData, componentInstance, newUrl, pathname }, { mergeCookies = false } = {}) {
	const pipeline = state.pipeline;
	const oldPathname = state.pathname;
	const isI18nFallback = routeData.fallbackRoutes && routeData.fallbackRoutes.length > 0;
	if (pipeline.manifest.serverLike && !state.routeData.prerender && routeData.prerender && !isI18nFallback) throw new AstroError({
		...ForbiddenRewrite,
		message: ForbiddenRewrite.message(state.pathname, pathname, routeData.component),
		hint: ForbiddenRewrite.hint(routeData.component)
	});
	state.routeData = routeData;
	state.componentInstance = componentInstance;
	if (payload instanceof Request) state.request = payload;
	else state.request = copyRequest(newUrl, state.request, routeData.prerender, pipeline.logger, state.routeData.route);
	state.url = createNormalizedUrl(state.request.url);
	if (mergeCookies) {
		const newCookies = new AstroCookies(state.request);
		if (state.cookies) newCookies.merge(state.cookies);
		state.cookies = newCookies;
	}
	state.params = getParams(routeData, pathname);
	state.pathname = pathname;
	state.isRewriting = true;
	state.status = 200;
	setOriginPathname(state.request, oldPathname, pipeline.manifest.trailingSlash, pipeline.manifest.buildFormat);
	state.invalidateContexts();
}
var Rewrites = class {
	async execute(state, payload) {
		const pipeline = state.pipeline;
		pipeline.logger.debug("router", "Calling rewrite: ", payload);
		applyRewriteToState(state, payload, await pipeline.tryRewrite(payload, state.request), { mergeCookies: true });
		const middleware = new AstroMiddleware(pipeline);
		const pagesHandler = new PagesHandler(pipeline);
		return middleware.handle(state, pagesHandler.handle.bind(pagesHandler));
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/match.js
function matchRoute(pathname, manifest) {
	if (isRoute404(pathname)) {
		const errorRoute = manifest.routes.find((route) => isRoute404(route.route));
		if (errorRoute) return errorRoute;
	}
	if (isRoute500(pathname)) {
		const errorRoute = manifest.routes.find((route) => isRoute500(route.route));
		if (errorRoute) return errorRoute;
	}
	return manifest.routes.find((route) => {
		return route.pattern.test(pathname) || route.fallbackRoutes.some((fallbackRoute) => fallbackRoute.pattern.test(pathname));
	});
}
function isRoute404or500(route) {
	return isRoute404(route.route) || isRoute500(route.route);
}
function isRouteServerIsland(route) {
	return route.component === SERVER_ISLAND_COMPONENT;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/app/render-options.js
var renderOptionsSymbol = /* @__PURE__ */ Symbol.for("astro.renderOptions");
function getRenderOptions(request) {
	return Reflect.get(request, renderOptionsSymbol);
}
function setRenderOptions(request, options) {
	Reflect.set(request, renderOptionsSymbol, options);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/app/validate-headers.js
function getFirstForwardedValue(multiValueHeader) {
	return multiValueHeader?.toString().split(",").map((e) => e.trim())[0];
}
function sanitizeHost(hostname) {
	if (!hostname) return void 0;
	if (/[/\\]/.test(hostname)) return void 0;
	return hostname;
}
function parseHost(host) {
	const parts = host.split(":");
	return {
		hostname: parts[0],
		port: parts[1]
	};
}
function matchesAllowedDomains(hostname, protocol, port, allowedDomains) {
	const urlString = `${protocol}://${port ? `${hostname}:${port}` : hostname}`;
	if (!URL.canParse(urlString)) return false;
	const testUrl = new URL(urlString);
	return allowedDomains.some((pattern) => matchPattern(testUrl, pattern));
}
function validateHost(host, protocol, allowedDomains) {
	if (!host || host.length === 0) return void 0;
	if (!allowedDomains || allowedDomains.length === 0) return void 0;
	const sanitized = sanitizeHost(host);
	if (!sanitized) return void 0;
	const { hostname, port } = parseHost(sanitized);
	if (matchesAllowedDomains(hostname, protocol, port, allowedDomains)) return sanitized;
}
function validateForwardedHeaders(forwardedProtocol, forwardedHost, forwardedPort, allowedDomains) {
	const result = {};
	if (forwardedProtocol) {
		if (allowedDomains && allowedDomains.length > 0) {
			if (allowedDomains.some((pattern) => pattern.protocol !== void 0)) try {
				const testUrl = new URL(`${forwardedProtocol}://example.com`);
				if (allowedDomains.some((pattern) => matchPattern(testUrl, { protocol: pattern.protocol }))) result.protocol = forwardedProtocol;
			} catch {}
			else if (/^https?$/.test(forwardedProtocol)) result.protocol = forwardedProtocol;
		}
	}
	if (forwardedPort && allowedDomains && allowedDomains.length > 0) {
		if (allowedDomains.some((pattern) => pattern.port !== void 0)) {
			if (allowedDomains.some((pattern) => pattern.port === forwardedPort)) result.port = forwardedPort;
		}
	}
	if (forwardedHost && forwardedHost.length > 0 && allowedDomains && allowedDomains.length > 0) {
		const protoForValidation = result.protocol || "https";
		const sanitized = sanitizeHost(forwardedHost);
		if (sanitized) {
			const { hostname, port: portFromHost } = parseHost(sanitized);
			if (matchesAllowedDomains(hostname, protoForValidation, result.port || portFromHost, allowedDomains)) result.host = sanitized;
		}
	}
	return result;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/fetch/fetch-state.js
var FetchState = class {
	pipeline;
	/**
	* The request to render. Mutated during rewrites so subsequent renders
	* see the rewritten URL.
	*/
	request;
	routeData;
	/**
	* The pathname to use for routing and rendering. Starts out as the raw,
	* base-stripped, decoded pathname from the request. May be further
	* normalized by `AstroHandler` after routeData is known (in dev, when
	* the matched route has no `.html` extension, `.html` / `/index.html`
	* suffixes are stripped).
	*/
	pathname;
	/** Resolved render options (addCookieHeader, clientAddress, locals, etc.). */
	renderOptions;
	/** When the request started, used to log duration. */
	timeStart;
	/**
	* The route's loaded component module. Set before middleware runs; may
	* be swapped during in-flight rewrites from inside the middleware chain.
	*/
	componentInstance;
	/**
	* Slot overrides supplied by the container API. `undefined` for HTTP
	* requests — `PagesHandler` coalesces to `{}` on read so we don't
	* allocate an empty object per request.
	*/
	slots;
	/**
	* The `Response` produced by handlers, if any. Set after page
	* rendering or middleware completes.
	*/
	response;
	/**
	* Default HTTP status for the rendered response. Callers override
	* before rendering runs (e.g. `AstroHandler` sets this from
	* `BaseApp.getDefaultStatusCode`; error handlers set `404` / `500`).
	*/
	status = 200;
	/** Whether user middleware should be skipped for this request. */
	skipMiddleware = false;
	/**
	* Set to `true` when the request path was encoded too many times to fully
	* decode (see {@link validateAndDecodePathname}). These requests are
	* rejected with a `400` before middleware or routing run.
	*/
	invalidEncoding = false;
	/** A flag that tells the render content if the rewriting was triggered. */
	isRewriting = false;
	/** A safety net in case of loops (rewrite counter). */
	counter = 0;
	/** Cookies for this request. Created lazily on first access. */
	cookies;
	/** Route params derived from routeData + pathname. Computed lazily. */
	#params;
	get params() {
		if (!this.#params && this.routeData) this.#params = getParams(this.routeData, this.pathname);
		return this.#params;
	}
	set params(value) {
		this.#params = value;
	}
	/** Normalized URL for this request. */
	url;
	/** Client address for this request. */
	clientAddress;
	/** Whether this is a partial render (container API). */
	partial;
	/** Internal metadata about the current response route type. */
	responseRouteType;
	/** Internal flag to prevent rerouting this response to an error page. */
	skipErrorReroute = false;
	/** Whether to inject CSP meta tags. */
	shouldInjectCspMetaTags;
	/** Request-scoped locals object, shared with user middleware. */
	locals = {};
	/**
	* Memoized `props` (see `getProps`). `null` means "not yet computed"
	* — using `null` (rather than `undefined`) keeps the hidden class
	* stable and distinct from a valid-but-empty result.
	*/
	props = null;
	/** Memoized `ActionAPIContext` (see `getActionAPIContext`). */
	actionApiContext = null;
	/** Memoized `APIContext` (see `getAPIContext`). */
	apiContext = null;
	/** Registered context providers keyed by name. Lazy-initialized on first provide(). */
	#providers;
	/** Cached values from resolved providers. Lazy-initialized on first resolve(). */
	#providersResolvedValues;
	/** Cached promise for lazy component instance loading. */
	#componentInstancePromise;
	/** SSR result for the current page render. */
	result;
	/** Initial props (from container/error handler). */
	initialProps = {};
	/** Rewrites handler instance. Lazy-initialized on first rewrite(). */
	#rewrites;
	/** Memoized Astro page partial. */
	#astroPagePartial;
	/**
	* Locale-prefixed pathname derived from the Host header for domain-based
	* i18n routing (e.g. `/en/boats/1/foo`), or `undefined` when the request
	* isn't served from a locale-mapped domain. When set, `this.pathname` is
	* derived from it so locale/param resolution match the route pattern.
	*/
	#domainPathname;
	/** Memoized current locale. */
	#currentLocale;
	/** Memoized preferred locale. */
	#preferredLocale;
	/** Memoized preferred locale list. */
	#preferredLocaleList;
	constructor(pipeline, request, options) {
		this.pipeline = pipeline;
		this.request = request;
		options ??= getRenderOptions(request);
		this.routeData = options?.routeData;
		this.renderOptions = options ?? {
			addCookieHeader: false,
			clientAddress: void 0,
			locals: void 0,
			prerenderedErrorPageFetch: fetch,
			routeData: void 0,
			waitUntil: void 0
		};
		this.componentInstance = void 0;
		this.slots = void 0;
		const url = new URL(request.url);
		const domainPathname = computePathnameFromDomain(request, url, pipeline.manifest.i18n, pipeline.manifest.base, pipeline.manifest.trailingSlash, pipeline.logger);
		if (domainPathname) {
			this.#domainPathname = domainPathname;
			try {
				this.pathname = decodeURI(domainPathname);
			} catch {
				this.pathname = domainPathname;
			}
		} else this.pathname = this.#computePathname(url);
		this.timeStart = performance.now();
		this.clientAddress = options?.clientAddress;
		this.locals = options?.locals ?? {};
		this.url = normalizeUrl(url);
		this.cookies = new AstroCookies(request);
		if (pipeline.manifest.allowedDomains && pipeline.manifest.allowedDomains.length > 0 && !this.routeData?.prerender) this.#applyForwardedHeaders();
		if (!Reflect.get(this.request, originPathnameSymbol)) setOriginPathname(this.request, this.pathname, pipeline.manifest.trailingSlash, pipeline.manifest.buildFormat);
		this.#resolveRouteData();
	}
	/**
	* Triggers a rewrite. Delegates to the Rewrites handler.
	*/
	rewrite(payload) {
		return (this.#rewrites ??= new Rewrites()).execute(this, payload);
	}
	/**
	* Creates the SSR result for the current page render.
	*/
	async createResult(mod, ctx) {
		const pipeline = this.pipeline;
		const { clientDirectives, inlinedScripts, compressHTML, manifest, renderers, resolve } = pipeline;
		const routeData = this.routeData;
		const { links, scripts, styles } = await pipeline.headElements(routeData);
		const extraStyleHashes = [];
		const extraScriptHashes = [];
		const shouldInjectCspMetaTags = this.shouldInjectCspMetaTags ?? manifest.shouldInjectCspMetaTags;
		const cspAlgorithm = manifest.csp?.algorithm ?? "SHA-256";
		if (shouldInjectCspMetaTags) {
			for (const style of styles) extraStyleHashes.push(await generateCspDigest(style.children, cspAlgorithm));
			for (const script of scripts) extraScriptHashes.push(await generateCspDigest(script.children, cspAlgorithm));
		}
		const componentMetadata = await pipeline.componentMetadata(routeData) ?? manifest.componentMetadata;
		const headers = new Headers({ "Content-Type": "text/html" });
		const partial = typeof this.partial === "boolean" ? this.partial : Boolean(mod.partial);
		const actionResult = hasActionPayload(this.locals) ? deserializeActionResult(this.locals._actionPayload.actionResult) : void 0;
		const status = this.status;
		const response = {
			status: actionResult?.error ? actionResult?.error.status : status,
			statusText: actionResult?.error ? actionResult?.error.type : "OK",
			get headers() {
				return headers;
			},
			set headers(_) {
				throw new AstroError(AstroResponseHeadersReassigned);
			}
		};
		const state = this;
		const result = {
			base: manifest.base,
			userAssetsBase: manifest.userAssetsBase,
			cancelled: false,
			clientDirectives,
			inlinedScripts,
			componentMetadata,
			compressHTML,
			cookies: this.cookies,
			createAstro: (props, slots) => state.createAstro(result, props, slots, ctx),
			links,
			params: this.params,
			partial,
			pathname: this.pathname,
			renderers,
			resolve,
			response,
			request: this.request,
			scripts,
			styles,
			actionResult,
			async getServerIslandNameMap() {
				return (await pipeline.getServerIslands()).serverIslandNameMap ?? /* @__PURE__ */ new Map();
			},
			key: manifest.key,
			trailingSlash: manifest.trailingSlash,
			_metadata: {
				hasHydrationScript: false,
				rendererSpecificHydrationScripts: /* @__PURE__ */ new Set(),
				hasRenderedHead: false,
				renderedScripts: /* @__PURE__ */ new Set(),
				hasDirectives: /* @__PURE__ */ new Set(),
				hasRenderedServerIslandRuntime: false,
				headInTree: false,
				extraHead: [],
				extraStyleHashes,
				extraScriptHashes,
				propagators: /* @__PURE__ */ new Set(),
				routeHasPropagation: false,
				pendingSlotEvaluations: [],
				templateDepth: 0
			},
			cspDestination: manifest.csp?.cspDestination ?? (routeData.prerender ? "meta" : "header"),
			shouldInjectCspMetaTags,
			cspAlgorithm,
			directives: manifest.csp?.directives ? [...manifest.csp.directives] : [],
			scriptHashes: manifest.csp?.scriptHashes ? [...manifest.csp.scriptHashes] : [],
			scriptResources: manifest.csp?.scriptResources ? [...manifest.csp.scriptResources] : [],
			styleHashes: manifest.csp?.styleHashes ? [...manifest.csp.styleHashes] : [],
			styleResources: manifest.csp?.styleResources ? [...manifest.csp.styleResources] : [],
			isStrictDynamic: manifest.csp?.isStrictDynamic ?? false,
			scriptDirective: {
				resources: manifest.csp?.scriptDirective ? [...manifest.csp.scriptDirective.resources] : [],
				hashes: manifest.csp?.scriptDirective ? [...manifest.csp.scriptDirective.hashes] : [],
				strictDynamic: manifest.csp?.scriptDirective?.strictDynamic ?? false
			},
			styleDirective: {
				resources: manifest.csp?.styleDirective ? [...manifest.csp.styleDirective.resources] : [],
				hashes: manifest.csp?.styleDirective ? [...manifest.csp.styleDirective.hashes] : []
			},
			internalFetchHeaders: manifest.internalFetchHeaders
		};
		this.result = result;
		return result;
	}
	/**
	* Creates the Astro global object for a component render.
	*/
	createAstro(result, props, slotValues, apiContext) {
		let astroPagePartial;
		if (this.isRewriting) this.#astroPagePartial = this.createAstroPagePartial(result, apiContext);
		this.#astroPagePartial ??= this.createAstroPagePartial(result, apiContext);
		astroPagePartial = this.#astroPagePartial;
		const astroComponentPartial = {
			props,
			self: null
		};
		const Astro = Object.assign(Object.create(astroPagePartial), astroComponentPartial);
		let _slots;
		Object.defineProperty(Astro, "slots", { get: () => {
			if (!_slots) _slots = new Slots(result, slotValues, this.pipeline.logger);
			return _slots;
		} });
		return Astro;
	}
	/**
	* Creates the Astro page-level partial (prototype for Astro global).
	*/
	createAstroPagePartial(result, apiContext) {
		const state = this;
		const { cookies, locals, params, pipeline, url } = this;
		const { response } = result;
		const redirect = (path, status = 302) => {
			if (state.request[responseSentSymbol$1]) throw new AstroError({ ...ResponseSentError });
			return new Response(null, {
				status,
				headers: { Location: path }
			});
		};
		const rewrite = async (reroutePayload) => {
			return await state.rewrite(reroutePayload);
		};
		const callAction = createCallAction(apiContext);
		const partial = {
			generator: ASTRO_GENERATOR,
			routePattern: this.routeData.route,
			isPrerendered: this.routeData.prerender,
			cookies,
			get clientAddress() {
				return state.getClientAddress();
			},
			get currentLocale() {
				return state.computeCurrentLocale();
			},
			params,
			get preferredLocale() {
				return state.computePreferredLocale();
			},
			get preferredLocaleList() {
				return state.computePreferredLocaleList();
			},
			locals,
			redirect,
			rewrite,
			request: this.request,
			response,
			site: pipeline.site,
			getActionResult: createGetActionResult(locals),
			get callAction() {
				return callAction;
			},
			url,
			get originPathname() {
				return getOriginPathname(state.request);
			},
			get csp() {
				return state.getCsp();
			},
			get logger() {
				return {
					info(msg) {
						pipeline.logger.info(null, msg);
					},
					warn(msg) {
						pipeline.logger.warn(null, msg);
					},
					error(msg) {
						pipeline.logger.error(null, msg);
					}
				};
			}
		};
		this.defineProviderGetters(partial);
		return partial;
	}
	getClientAddress() {
		const { pipeline, clientAddress } = this;
		const routeData = this.routeData;
		if (routeData.prerender) throw new AstroError({
			...PrerenderClientAddressNotAvailable,
			message: PrerenderClientAddressNotAvailable.message(routeData.component)
		});
		if (clientAddress) return clientAddress;
		if (pipeline.adapterName) throw new AstroError({
			...ClientAddressNotAvailable,
			message: ClientAddressNotAvailable.message(pipeline.adapterName)
		});
		throw new AstroError(StaticClientAddressNotAvailable);
	}
	getCookies() {
		return this.cookies;
	}
	getCsp() {
		const state = this;
		const { pipeline } = this;
		if (!pipeline.manifest.csp) {
			if (pipeline.runtimeMode === "production") pipeline.logger.warn("csp", `context.csp was used when rendering the route ${s.green(state.routeData.route)}, but CSP was not configured. For more information, see https://docs.astro.build/en/reference/configuration-reference/#securitycsp`);
			return;
		}
		const warnedFallback = /* @__PURE__ */ new Set();
		const warnFallback = (family, kind) => {
			if (kind === "default" || !state.result) return;
			const defaultResources = (family === "script" ? state.result.scriptDirective : state.result.styleDirective).resources.map(normalizeCspResourceEntry).filter((entry) => entry.kind === "default").map((entry) => entry.resource);
			if (defaultResources.length === 0) return;
			const key = `${family}:${kind}`;
			if (warnedFallback.has(key)) return;
			warnedFallback.add(key);
			const general = `${family}-src`;
			const specific = `${general}-${kind === "element" ? "elem" : "attr"}`;
			pipeline.logger.warn("csp", `A resource was added to \`${specific}\`, but \`${general}\` also defines custom resources (${defaultResources.join(" ")}). Because \`${specific}\` overrides \`${general}\` for its scope (browsers do not fall back), those resources will not apply there. Add them to \`${specific}\` as well if needed.`);
		};
		return {
			insertDirective(payload) {
				if (state.result) state.result.directives = pushDirective(state.result.directives, payload);
			},
			insertScriptResource(payload) {
				if (!state.result) return;
				warnFallback("script", normalizeCspResourceEntry(payload).kind);
				state.result.scriptDirective.resources.push(payload);
			},
			insertStyleResource(payload) {
				if (!state.result) return;
				warnFallback("style", normalizeCspResourceEntry(payload).kind);
				state.result.styleDirective.resources.push(payload);
			},
			insertStyleHash(payload) {
				state.result?.styleDirective.hashes.push(payload);
			},
			insertScriptHash(payload) {
				state.result?.scriptDirective.hashes.push(payload);
			}
		};
	}
	computeCurrentLocale() {
		const { url, pipeline: { i18n }, routeData } = this;
		if (!i18n || !routeData) return;
		const { defaultLocale, locales, strategy } = i18n;
		const fallbackTo = strategy === "pathname-prefix-other-locales" || strategy === "domains-prefix-other-locales" ? defaultLocale : void 0;
		if (this.#currentLocale) return this.#currentLocale;
		let computedLocale;
		if (isRouteServerIsland(routeData)) {
			let referer = this.request.headers.get("referer");
			if (referer) {
				if (URL.canParse(referer)) referer = new URL(referer).pathname;
				computedLocale = computeCurrentLocale(referer, locales, defaultLocale);
			}
		} else {
			let pathname = routeData.pathname;
			if (this.#domainPathname) pathname = this.pathname;
			else if (url && !routeData.pattern.test(url.pathname)) {
				for (const fallbackRoute of routeData.fallbackRoutes) if (fallbackRoute.pattern.test(url.pathname)) {
					pathname = fallbackRoute.pathname;
					break;
				}
			}
			pathname = pathname && !isRoute404or500(routeData) ? pathname : url.pathname ?? this.pathname;
			computedLocale = computeCurrentLocale(pathname, locales, defaultLocale);
			if (routeData.params.length > 0) {
				const localeFromParams = computeCurrentLocaleFromParams(this.params, locales);
				if (localeFromParams) computedLocale = localeFromParams;
			}
		}
		this.#currentLocale = computedLocale ?? fallbackTo;
		return this.#currentLocale;
	}
	computePreferredLocale() {
		const { pipeline: { i18n }, request } = this;
		if (!i18n) return;
		return this.#preferredLocale ??= computePreferredLocale(request, i18n.locales);
	}
	computePreferredLocaleList() {
		const { pipeline: { i18n }, request } = this;
		if (!i18n) return;
		return this.#preferredLocaleList ??= computePreferredLocaleList(request, i18n.locales);
	}
	/**
	* Lazily loads the route's component module. Returns the cached
	* instance if already loaded. The promise is cached so concurrent
	* callers share the same load.
	*/
	async loadComponentInstance() {
		if (this.componentInstance) return this.componentInstance;
		if (this.#componentInstancePromise) return this.#componentInstancePromise;
		this.#componentInstancePromise = this.pipeline.getComponentByRoute(this.routeData).then((mod) => {
			this.componentInstance = mod;
			return mod;
		});
		return this.#componentInstancePromise;
	}
	/**
	* Registers a context provider under the given key. Handlers call
	* this to contribute values to the request context (e.g. sessions).
	* The `create` factory is called lazily on the first `resolve(key)`.
	*/
	provide(key, provider) {
		(this.#providers ??= /* @__PURE__ */ new Map()).set(key, provider);
	}
	/**
	* Lazily resolves a provider registered under `key`. Calls
	* `provider.create()` on first access and caches the result.
	* Returns `undefined` if no provider was registered for the key.
	*/
	resolve(key) {
		if (this.#providersResolvedValues?.has(key)) return this.#providersResolvedValues.get(key);
		const provider = this.#providers?.get(key);
		if (!provider) return void 0;
		const value = provider.create();
		(this.#providersResolvedValues ??= /* @__PURE__ */ new Map()).set(key, value);
		return value;
	}
	/**
	* Runs all registered `finalize` callbacks. Should be called after
	* the response is produced, typically in a `finally` block.
	*
	* Returns synchronously (no promise allocation) when nothing needs
	* finalizing — important for the hot path where sessions are not used.
	*/
	finalizeAll() {
		if (!this.#providersResolvedValues || this.#providersResolvedValues.size === 0) return;
		let chain;
		for (const [key, provider] of this.#providers) if (provider.finalize && this.#providersResolvedValues.has(key)) {
			const result = provider.finalize(this.#providersResolvedValues.get(key));
			if (result) chain = chain ? chain.then(() => result) : result;
		}
		return chain;
	}
	/**
	* Adds lazy getters to `target` for each registered provider key.
	* Used by context creation (APIContext, Astro global) so that
	* provider values like `session` and `cache` appear as properties
	* without hard-coding the keys.
	*
	* Always defines a `session` getter (returning `undefined` when no
	* provider is registered) so `ctx.session` / `Astro.session` is a
	* present property regardless of whether the sessions handler was
	* included in the pipeline.
	*/
	defineProviderGetters(target) {
		const state = this;
		if (this.#providers) for (const key of this.#providers.keys()) Object.defineProperty(target, key, {
			get: () => state.resolve(key),
			enumerable: true,
			configurable: true
		});
		if (!this.#providers?.has("session")) {
			let warned = false;
			Object.defineProperty(target, "session", {
				get() {
					if (!warned) {
						warned = true;
						state.pipeline.logger.warn("session", "`Astro.session` was accessed but no session storage is configured. Either configure the storage manually or use an adapter that provides session storage. For more information, see https://docs.astro.build/en/guides/sessions/");
					}
				},
				enumerable: true,
				configurable: true
			});
		}
	}
	/**
	* Resolves the route to use for this request and stores it on
	* `this.routeData`. If the adapter (or the dev server) provided a
	* `routeData` via render options it's already set and this is a
	* no-op. Otherwise we use the app's synchronous route matcher and
	* fall back to a `404.astro` route so middleware can still run.
	*
	* Called eagerly from the constructor so individual handlers
	* (actions, pages, middleware, etc.) always see a resolved route
	* without the caller needing an extra setup step.
	*
	* Once routeData is known, finalizes `this.pathname`: in dev, if the
	* matched route has no `.html` extension, strip `.html` / `/index.html`
	* suffixes so the rendering pipeline sees the canonical pathname.
	*/
	/**
	* Strip `.html` / `/index.html` suffixes from the pathname so the
	* rendering pipeline sees the canonical route path. Only applies to
	* page routes where `.html` is framework-injected. Endpoint routes
	* preserve `.html` because any such suffix is user-provided (e.g.
	* from `getStaticPaths` params). Skipped when the matched route
	* itself has an `.html` extension in its definition.
	*/
	#stripHtmlExtension() {
		if (this.routeData && this.routeData.type === "page" && !routeHasHtmlExtension(this.routeData)) this.pathname = this.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
	}
	#resolveRouteData() {
		const pipeline = this.pipeline;
		if (this.routeData) {
			this.#stripHtmlExtension();
			return;
		}
		const matched = pipeline.matchRoute(this.pathname);
		if (matched && matched.prerender && pipeline.manifest.serverLike) if (matched.params.length > 0) {
			const allMatches = pipeline.matchAllRoutes(this.pathname);
			this.routeData = allMatches.find((r) => !r.prerender);
		} else this.routeData = void 0;
		else this.routeData = matched;
		pipeline.logger.debug("router", "Astro matched the following route for " + this.request.url);
		pipeline.logger.debug("router", "RouteData:\n" + this.routeData);
		if (!this.routeData) {
			const custom404 = getCustom404Route(pipeline.manifestData);
			if (custom404 && !custom404.prerender) this.routeData = custom404;
		}
		if (!this.routeData) {
			pipeline.logger.debug("router", "Astro hasn't found routes that match " + this.request.url);
			pipeline.logger.debug("router", "Here's the available routes:\n", pipeline.manifestData);
			return;
		}
		this.#stripHtmlExtension();
	}
	/**
	* Strips the pipeline's base from the request URL, prepends a forward
	* slash, and decodes the pathname. Falls back to the raw (not decoded)
	* pathname if `decodeURI` throws.
	*
	* Mirrors `BaseApp.removeBase`, including the
	* `collapseDuplicateLeadingSlashes` fix that prevents middleware
	* authorization bypass when the URL starts with `//`.
	*/
	#computePathname(url) {
		let pathname = collapseDuplicateLeadingSlashes(url.pathname);
		const base = this.pipeline.manifest.base;
		if (pathname.startsWith(base)) {
			const baseWithoutTrailingSlash = removeTrailingForwardSlash(base);
			pathname = pathname.slice(baseWithoutTrailingSlash.length + 1);
		}
		pathname = prependForwardSlash(pathname);
		try {
			return validateAndDecodePathname(pathname);
		} catch (e) {
			if (e instanceof MultiLevelEncodingError) {
				this.invalidEncoding = true;
				return pathname;
			}
			this.pipeline.logger.error(null, e.toString());
			return pathname;
		}
	}
	/**
	* Reads X-Forwarded-Proto, X-Forwarded-Host, and X-Forwarded-Port
	* from the request headers, validates them against the manifest's
	* `allowedDomains`, and updates `this.url` accordingly. Also resolves
	* `clientAddress` from X-Forwarded-For when the host is trusted.
	*
	* Only called when `allowedDomains` is configured — without it,
	* forwarded headers are never trusted.
	*/
	#applyForwardedHeaders() {
		const headers = this.request.headers;
		const allowedDomains = this.pipeline.manifest.allowedDomains;
		const validated = validateForwardedHeaders(getFirstForwardedValue(headers.get("x-forwarded-proto") ?? void 0), getFirstForwardedValue(headers.get("x-forwarded-host") ?? void 0), getFirstForwardedValue(headers.get("x-forwarded-port") ?? void 0), allowedDomains);
		if (!validated.protocol && !validated.host && !validated.port) return;
		if (validated.protocol) this.url.protocol = validated.protocol + ":";
		if (validated.host) {
			const colonIdx = validated.host.indexOf(":");
			if (colonIdx !== -1) {
				this.url.hostname = validated.host.slice(0, colonIdx);
				this.url.port = validated.host.slice(colonIdx + 1);
			} else {
				this.url.hostname = validated.host;
				this.url.port = "";
			}
		}
		if (validated.port) this.url.port = validated.port;
		if (validated.host !== void 0 && !this.clientAddress) {
			const forwardedFor = getFirstForwardedValue(this.request.headers.get("x-forwarded-for") ?? void 0);
			if (forwardedFor) this.clientAddress = forwardedFor;
		}
		const oldRequest = this.request;
		this.request = new Request(this.url, oldRequest);
		const app = Reflect.get(oldRequest, appSymbol);
		if (app !== void 0) Reflect.set(this.request, appSymbol, app);
	}
	/**
	* Returns the resolved `props` for this render, computing them lazily
	* from the route + component module on first access. If the
	* `initialProps` already carries user-supplied props (e.g. the
	* container API) those are used verbatim.
	*/
	async getProps() {
		if (this.props !== null) return this.props;
		if (Object.keys(this.initialProps).length > 0) {
			this.props = this.initialProps;
			return this.props;
		}
		const pipeline = this.pipeline;
		const mod = await this.loadComponentInstance();
		this.props = await getProps({
			mod,
			routeData: this.routeData,
			routeCache: pipeline.routeCache,
			pathname: this.pathname,
			logger: pipeline.logger,
			serverLike: pipeline.manifest.serverLike,
			base: pipeline.manifest.base,
			trailingSlash: pipeline.manifest.trailingSlash
		});
		return this.props;
	}
	/**
	* Returns the `ActionAPIContext` for this render, creating it lazily.
	* Used by middleware, actions, and page dispatch.
	*/
	getActionAPIContext() {
		if (this.actionApiContext !== null) return this.actionApiContext;
		const state = this;
		const ctx = {
			get cookies() {
				return state.cookies;
			},
			routePattern: this.routeData.route,
			isPrerendered: this.routeData.prerender,
			get clientAddress() {
				return state.getClientAddress();
			},
			get currentLocale() {
				return state.computeCurrentLocale();
			},
			generator: ASTRO_GENERATOR,
			get locals() {
				return state.locals;
			},
			set locals(_) {
				throw new AstroError(LocalsReassigned);
			},
			params: this.params,
			get preferredLocale() {
				return state.computePreferredLocale();
			},
			get preferredLocaleList() {
				return state.computePreferredLocaleList();
			},
			request: this.request,
			site: this.pipeline.site,
			url: this.url,
			get originPathname() {
				return getOriginPathname(state.request);
			},
			get csp() {
				return state.getCsp();
			},
			get logger() {
				return {
					info(msg) {
						state.pipeline.logger.info(null, msg);
					},
					warn(msg) {
						state.pipeline.logger.warn(null, msg);
					},
					error(msg) {
						state.pipeline.logger.error(null, msg);
					}
				};
			}
		};
		this.defineProviderGetters(ctx);
		this.actionApiContext = ctx;
		return this.actionApiContext;
	}
	/**
	* Returns the `APIContext` for this render, creating it lazily from
	* the memoized props + action context.
	*
	* Callers must ensure `getProps()` has resolved at least once before
	* calling this.
	*/
	getAPIContext() {
		if (this.apiContext !== null) return this.apiContext;
		const actionApiContext = this.getActionAPIContext();
		const state = this;
		const redirect = (path, status = 302) => new Response(null, {
			status,
			headers: { Location: path }
		});
		const rewrite = async (reroutePayload) => {
			return await state.rewrite(reroutePayload);
		};
		Reflect.set(actionApiContext, pipelineSymbol, this.pipeline);
		actionApiContext[fetchStateSymbol] = this;
		this.apiContext = Object.assign(actionApiContext, {
			props: this.props,
			redirect,
			rewrite,
			getActionResult: createGetActionResult(actionApiContext.locals),
			callAction: createCallAction(actionApiContext)
		});
		return this.apiContext;
	}
	/**
	* Invalidates the cached `APIContext` so the next `getAPIContext()`
	* call re-derives it from the (possibly mutated) state. Used
	* after an in-flight rewrite swaps the route / request / params.
	*/
	invalidateContexts() {
		this.props = null;
		this.actionApiContext = null;
		this.apiContext = null;
	}
	resetResponseMetadata() {
		this.responseRouteType = void 0;
		this.skipErrorReroute = false;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/actions/handler.js
var ActionHandler = class {
	/**
	* Run action handling for the current request. Expects the APIContext
	* that is already being used by the render pipeline.
	*
	* Returns a `Response` when the action fully handles the request (RPC),
	* or `undefined` when the caller should continue processing the
	* request (form actions or non-action requests).
	*/
	handle(apiContext, state) {
		state.pipeline.usedFeatures |= PipelineFeatures.actions;
		if (apiContext.isPrerendered) return;
		const { action, setActionResult } = getActionContext(apiContext);
		if (!action) return;
		if (state.pipeline.manifest.checkOrigin && isForbiddenCrossOriginRequest(apiContext.request, apiContext.url, apiContext.isPrerendered)) return Promise.resolve(createCrossOriginForbiddenResponse(apiContext.request));
		return this.#executeAction(action, setActionResult);
	}
	async #executeAction(action, setActionResult) {
		const serialized = serializeActionResult(await action.handler());
		if (action.calledFrom === "rpc") {
			if (serialized.type === "empty") return new Response(null, { status: serialized.status });
			return new Response(serialized.body, {
				status: serialized.status,
				headers: { "Content-Type": serialized.contentType }
			});
		}
		setActionResult(action.name, serialized);
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/app/prepare-response.js
function prepareResponse(response, { addCookieHeader }) {
	if (addCookieHeader) for (const setCookieHeaderValue of getSetCookiesFromResponse(response)) response.headers.append("set-cookie", setCookieHeaderValue);
	Reflect.set(response, responseSentSymbol$1, true);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/3xx.js
function redirectTemplate({ status, absoluteLocation, relativeLocation, from }) {
	const delay = status === 302 ? 2 : 0;
	const rel = escape(String(relativeLocation));
	return `<!doctype html>
<title>Redirecting to: ${rel}</title>
<meta http-equiv="refresh" content="${delay};url=${rel}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${escape(String(absoluteLocation))}">
<body>
	<a href="${rel}">Redirecting ${from ? `from <code>${escape(from)}</code> ` : ""}to <code>${rel}</code></a>
</body>`;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/trailing-slash-handler.js
var TrailingSlashHandler = class {
	#app;
	constructor(app) {
		this.#app = app;
	}
	/**
	* Returns a redirect `Response` if the request pathname needs
	* normalization, or `undefined` if no redirect is required.
	*/
	handle(state) {
		const url = new URL(state.request.url);
		const redirect = this.#redirectTrailingSlash(url.pathname);
		if (redirect === url.pathname) return;
		const addCookieHeader = state.renderOptions.addCookieHeader;
		const status = state.request.method === "GET" ? 301 : 308;
		const response = new Response(redirectTemplate({
			status,
			relativeLocation: url.pathname,
			absoluteLocation: redirect,
			from: state.request.url
		}), {
			status,
			headers: { location: redirect + url.search }
		});
		prepareResponse(response, { addCookieHeader });
		return response;
	}
	#redirectTrailingSlash(pathname) {
		const { trailingSlash } = this.#app.manifest;
		if (pathname === "/" || isInternalPath(pathname)) return pathname;
		const path = collapseDuplicateTrailingSlashes(pathname, trailingSlash !== "never");
		if (path !== pathname) return path;
		if (trailingSlash === "ignore") return pathname;
		if (trailingSlash === "always" && !hasFileExtension(pathname)) return appendForwardSlash(pathname);
		if (trailingSlash === "never") return removeTrailingForwardSlash(pathname);
		return pathname;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cache/runtime/utils.js
function defaultSetHeaders(options) {
	const headers = new Headers();
	const directives = [];
	if (options.maxAge !== void 0) directives.push(`max-age=${options.maxAge}`);
	if (options.swr !== void 0) directives.push(`stale-while-revalidate=${options.swr}`);
	if (directives.length > 0) headers.set("CDN-Cache-Control", directives.join(", "));
	if (options.tags && options.tags.length > 0) headers.set("Cache-Tag", options.tags.join(", "));
	if (options.lastModified) headers.set("Last-Modified", options.lastModified.toUTCString());
	if (options.etag) headers.set("ETag", options.etag);
	return headers;
}
function isLiveDataEntry(value) {
	return value != null && typeof value === "object" && "id" in value && "data" in value && "cacheHint" in value;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cache/runtime/cache.js
var APPLY_HEADERS = /* @__PURE__ */ Symbol.for("astro:cache:apply");
var IS_ACTIVE = /* @__PURE__ */ Symbol.for("astro:cache:active");
var AstroCache = class {
	#options = {};
	#tags = /* @__PURE__ */ new Set();
	#disabled = false;
	#provider;
	enabled = true;
	constructor(provider) {
		this.#provider = provider;
	}
	set(input) {
		if (input === false) {
			this.#disabled = true;
			this.#tags.clear();
			this.#options = {};
			return;
		}
		this.#disabled = false;
		let options;
		if (isLiveDataEntry(input)) {
			if (!input.cacheHint) return;
			options = input.cacheHint;
		} else options = input;
		if ("maxAge" in options && options.maxAge !== void 0) this.#options.maxAge = options.maxAge;
		if ("swr" in options && options.swr !== void 0) this.#options.swr = options.swr;
		if ("etag" in options && options.etag !== void 0) this.#options.etag = options.etag;
		if (options.lastModified !== void 0) {
			if (!this.#options.lastModified || options.lastModified > this.#options.lastModified) this.#options.lastModified = options.lastModified;
		}
		if (options.tags) for (const tag of options.tags) this.#tags.add(tag);
	}
	get tags() {
		return [...this.#tags];
	}
	/**
	* Get the current cache options (read-only snapshot).
	* Includes all accumulated options: maxAge, swr, tags, etag, lastModified.
	*/
	get options() {
		return {
			...this.#options,
			tags: this.tags
		};
	}
	async invalidate(input) {
		if (!this.#provider) throw new AstroError(CacheNotEnabled);
		let options;
		if (isLiveDataEntry(input)) options = { tags: input.cacheHint?.tags ?? [] };
		else options = input;
		return this.#provider.invalidate(options);
	}
	/** @internal */
	[APPLY_HEADERS](response, request) {
		if (this.#disabled) return;
		const finalOptions = {
			...this.#options,
			tags: this.tags
		};
		if (finalOptions.maxAge === void 0 && !finalOptions.tags?.length) return;
		const headers = this.#provider?.setHeaders?.(finalOptions, request) ?? defaultSetHeaders(finalOptions);
		for (const [key, value] of headers) response.headers.set(key, value);
	}
	/** @internal */
	get [IS_ACTIVE]() {
		return !this.#disabled && (this.#options.maxAge !== void 0 || this.#tags.size > 0);
	}
};
function applyCacheHeaders(cache, response, request) {
	if (APPLY_HEADERS in cache) cache[APPLY_HEADERS](response, request);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/parts.js
var ROUTE_DYNAMIC_SPLIT = /\[(.+?\(.+?\)|.+?)\]/;
var ROUTE_SPREAD = /^\.{3}.+$/;
function getParts(part, file) {
	const result = [];
	part.split(ROUTE_DYNAMIC_SPLIT).map((str, i) => {
		if (!str) return;
		const dynamic = i % 2 === 1;
		const [, content] = dynamic ? /([^(]+)$/.exec(str) || [null, null] : [null, str];
		if (!content || dynamic && !/^(?:\.\.\.)?[\w$]+$/.test(content)) throw new Error(`Invalid route ${file} \u2014 parameter name must match /^[a-zA-Z0-9_$]+$/`);
		result.push({
			content,
			dynamic,
			spread: dynamic && ROUTE_SPREAD.test(content)
		});
	});
	return result;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cache/runtime/route-matching.js
function compileCacheRoutes(routes, base, trailingSlash) {
	const compiled = Object.entries(routes).map(([path, options]) => {
		const segments = removeLeadingForwardSlash(path).split("/").filter(Boolean).map((s) => getParts(s, path));
		return {
			pattern: getPattern(segments, base, trailingSlash),
			options,
			segments,
			route: path
		};
	});
	compiled.sort((a, b) => routeComparator({
		segments: a.segments,
		route: a.route,
		type: "page"
	}, {
		segments: b.segments,
		route: b.route,
		type: "page"
	}));
	return compiled;
}
function matchCacheRoute(pathname, compiledRoutes) {
	for (const route of compiledRoutes) if (route.pattern.test(pathname)) return route.options;
	return null;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/cache/handler.js
var CACHE_KEY = "cache";
function provideCache(state) {
	const pipeline = state.pipeline;
	if (!pipeline.cacheConfig) {
		state.provide(CACHE_KEY, { create: () => new DisabledAstroCache(pipeline.logger) });
		return;
	}
	if (pipeline.runtimeMode === "development") {
		state.provide(CACHE_KEY, { create: () => new NoopAstroCache() });
		return;
	}
	return provideCacheAsync(state, pipeline);
}
async function provideCacheAsync(state, pipeline) {
	const cacheProvider = await pipeline.getCacheProvider();
	state.provide(CACHE_KEY, { create() {
		const cache = new AstroCache(cacheProvider);
		if (pipeline.cacheConfig?.routes) {
			if (!pipeline.compiledCacheRoutes) pipeline.compiledCacheRoutes = compileCacheRoutes(pipeline.cacheConfig.routes, pipeline.manifest.base, pipeline.manifest.trailingSlash);
			const matched = matchCacheRoute(state.pathname, pipeline.compiledCacheRoutes);
			if (matched) cache.set(matched);
		}
		return cache;
	} });
}
var CacheHandler = class {
	#app;
	constructor(app) {
		this.#app = app;
	}
	async handle(state, next) {
		this.#app.pipeline.usedFeatures |= PipelineFeatures.cache;
		if (!this.#app.pipeline.cacheProvider) return next();
		const cache = state.resolve(CACHE_KEY);
		const cacheProvider = await this.#app.pipeline.getCacheProvider();
		if (cacheProvider?.onRequest) {
			const response2 = await cacheProvider.onRequest({
				request: state.request,
				url: new URL(state.request.url),
				waitUntil: state.renderOptions.waitUntil
			}, async () => {
				const res = await next();
				applyCacheHeaders(cache, res, state.request);
				return res;
			});
			response2.headers.delete("CDN-Cache-Control");
			response2.headers.delete("Cache-Tag");
			return response2;
		}
		const response = await next();
		applyCacheHeaders(cache, response, state.request);
		return response;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/redirects/render.js
function isExternalURL(url) {
	return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}
function redirectIsExternal(redirect) {
	if (typeof redirect === "string") return isExternalURL(redirect);
	else return isExternalURL(redirect.destination);
}
function computeRedirectStatus(method, redirect, redirectRoute) {
	return redirectRoute && typeof redirect === "object" ? redirect.status : method === "GET" ? 301 : 308;
}
function resolveRedirectTarget(params, redirect, redirectRoute, trailingSlash) {
	if (typeof redirectRoute !== "undefined") return getRouteGenerator(redirectRoute.segments, trailingSlash)(params) || redirectRoute?.pathname || "/";
	else if (typeof redirect === "string") if (redirectIsExternal(redirect)) return redirect;
	else {
		let target = redirect;
		for (const param of Object.keys(params)) {
			const paramValue = params[param];
			target = target.replace(`[${param}]`, paramValue).replace(`[...${param}]`, paramValue);
		}
		return target;
	}
	else if (typeof redirect === "undefined") return "/";
	return redirect.destination;
}
async function renderRedirect(state) {
	state.pipeline.usedFeatures |= PipelineFeatures.redirects;
	const { redirect, redirectRoute } = state.routeData;
	const status = computeRedirectStatus(state.request.method, redirect, redirectRoute);
	const headers = { location: encodeURI(resolveRedirectTarget(state.params, redirect, redirectRoute, state.pipeline.manifest.trailingSlash)) };
	if (redirect && redirectIsExternal(redirect)) if (typeof redirect === "string") return Response.redirect(redirect, status);
	else return Response.redirect(redirect.destination, status);
	return new Response(null, {
		status,
		headers
	});
}
//#endregion
//#region node_modules/.pnpm/destr@2.0.5/node_modules/destr/dist/index.mjs
var suspectProtoRx = /"(?:_|\\u0{2}5[Ff]){2}(?:p|\\u0{2}70)(?:r|\\u0{2}72)(?:o|\\u0{2}6[Ff])(?:t|\\u0{2}74)(?:o|\\u0{2}6[Ff])(?:_|\\u0{2}5[Ff]){2}"\s*:/;
var suspectConstructorRx = /"(?:c|\\u0063)(?:o|\\u006[Ff])(?:n|\\u006[Ee])(?:s|\\u0073)(?:t|\\u0074)(?:r|\\u0072)(?:u|\\u0075)(?:c|\\u0063)(?:t|\\u0074)(?:o|\\u006[Ff])(?:r|\\u0072)"\s*:/;
var JsonSigRx = /^\s*["[{]|^\s*-?\d{1,16}(\.\d{1,17})?([Ee][+-]?\d+)?\s*$/;
function jsonParseTransform(key, value) {
	if (key === "__proto__" || key === "constructor" && value && typeof value === "object" && "prototype" in value) {
		warnKeyDropped(key);
		return;
	}
	return value;
}
function warnKeyDropped(key) {
	console.warn(`[destr] Dropping "${key}" key to prevent prototype pollution.`);
}
function destr(value, options = {}) {
	if (typeof value !== "string") return value;
	if (value[0] === "\"" && value[value.length - 1] === "\"" && value.indexOf("\\") === -1) return value.slice(1, -1);
	const _value = value.trim();
	if (_value.length <= 9) switch (_value.toLowerCase()) {
		case "true": return true;
		case "false": return false;
		case "undefined": return;
		case "null": return null;
		case "nan": return NaN;
		case "infinity": return Number.POSITIVE_INFINITY;
		case "-infinity": return Number.NEGATIVE_INFINITY;
	}
	if (!JsonSigRx.test(value)) {
		if (options.strict) throw new SyntaxError("[destr] Invalid JSON");
		return value;
	}
	try {
		if (suspectProtoRx.test(value) || suspectConstructorRx.test(value)) {
			if (options.strict) throw new Error("[destr] Possible prototype pollution");
			return JSON.parse(value, jsonParseTransform);
		}
		return JSON.parse(value);
	} catch (error) {
		if (options.strict) throw error;
		return value;
	}
}
//#endregion
//#region node_modules/.pnpm/unstorage@1.17.5/node_modules/unstorage/dist/shared/unstorage.zVDD2mZo.mjs
function wrapToPromise(value) {
	if (!value || typeof value.then !== "function") return Promise.resolve(value);
	return value;
}
function asyncCall(function_, ...arguments_) {
	try {
		return wrapToPromise(function_(...arguments_));
	} catch (error) {
		return Promise.reject(error);
	}
}
function isPrimitive(value) {
	const type = typeof value;
	return value === null || type !== "object" && type !== "function";
}
function isPureObject(value) {
	const proto = Object.getPrototypeOf(value);
	return !proto || proto.isPrototypeOf(Object);
}
function stringify$1(value) {
	if (isPrimitive(value)) return String(value);
	if (isPureObject(value) || Array.isArray(value)) return JSON.stringify(value);
	if (typeof value.toJSON === "function") return stringify$1(value.toJSON());
	throw new Error("[unstorage] Cannot stringify value!");
}
var BASE64_PREFIX = "base64:";
function serializeRaw(value) {
	if (typeof value === "string") return value;
	return BASE64_PREFIX + base64Encode(value);
}
function deserializeRaw(value) {
	if (typeof value !== "string") return value;
	if (!value.startsWith(BASE64_PREFIX)) return value;
	return base64Decode(value.slice(7));
}
function base64Decode(input) {
	if (globalThis.Buffer) return Buffer.from(input, "base64");
	return Uint8Array.from(globalThis.atob(input), (c) => c.codePointAt(0));
}
function base64Encode(input) {
	if (globalThis.Buffer) return Buffer.from(input).toString("base64");
	return globalThis.btoa(String.fromCodePoint(...input));
}
function normalizeKey(key) {
	if (!key) return "";
	return key.split("?")[0]?.replace(/[/\\]/g, ":").replace(/:+/g, ":").replace(/^:|:$/g, "") || "";
}
function joinKeys(...keys) {
	return normalizeKey(keys.join(":"));
}
function normalizeBaseKey(base) {
	base = normalizeKey(base);
	return base ? base + ":" : "";
}
function filterKeyByDepth(key, depth) {
	if (depth === void 0) return true;
	let substrCount = 0;
	let index = key.indexOf(":");
	while (index > -1) {
		substrCount++;
		index = key.indexOf(":", index + 1);
	}
	return substrCount <= depth;
}
function filterKeyByBase(key, base) {
	if (base) return key.startsWith(base) && key[key.length - 1] !== "$";
	return key[key.length - 1] !== "$";
}
//#endregion
//#region node_modules/.pnpm/unstorage@1.17.5/node_modules/unstorage/dist/index.mjs
function defineDriver(factory) {
	return factory;
}
var DRIVER_NAME = "memory";
var memory = defineDriver(() => {
	const data = /* @__PURE__ */ new Map();
	return {
		name: DRIVER_NAME,
		getInstance: () => data,
		hasItem(key) {
			return data.has(key);
		},
		getItem(key) {
			return data.get(key) ?? null;
		},
		getItemRaw(key) {
			return data.get(key) ?? null;
		},
		setItem(key, value) {
			data.set(key, value);
		},
		setItemRaw(key, value) {
			data.set(key, value);
		},
		removeItem(key) {
			data.delete(key);
		},
		getKeys() {
			return [...data.keys()];
		},
		clear() {
			data.clear();
		},
		dispose() {
			data.clear();
		}
	};
});
function createStorage(options = {}) {
	const context = {
		mounts: { "": options.driver || memory() },
		mountpoints: [""],
		watching: false,
		watchListeners: [],
		unwatch: {}
	};
	const getMount = (key) => {
		for (const base of context.mountpoints) if (key.startsWith(base)) return {
			base,
			relativeKey: key.slice(base.length),
			driver: context.mounts[base]
		};
		return {
			base: "",
			relativeKey: key,
			driver: context.mounts[""]
		};
	};
	const getMounts = (base, includeParent) => {
		return context.mountpoints.filter((mountpoint) => mountpoint.startsWith(base) || includeParent && base.startsWith(mountpoint)).map((mountpoint) => ({
			relativeBase: base.length > mountpoint.length ? base.slice(mountpoint.length) : void 0,
			mountpoint,
			driver: context.mounts[mountpoint]
		}));
	};
	const onChange = (event, key) => {
		if (!context.watching) return;
		key = normalizeKey(key);
		for (const listener of context.watchListeners) listener(event, key);
	};
	const startWatch = async () => {
		if (context.watching) return;
		context.watching = true;
		for (const mountpoint in context.mounts) context.unwatch[mountpoint] = await watch(context.mounts[mountpoint], onChange, mountpoint);
	};
	const stopWatch = async () => {
		if (!context.watching) return;
		for (const mountpoint in context.unwatch) await context.unwatch[mountpoint]();
		context.unwatch = {};
		context.watching = false;
	};
	const runBatch = (items, commonOptions, cb) => {
		const batches = /* @__PURE__ */ new Map();
		const getBatch = (mount) => {
			let batch = batches.get(mount.base);
			if (!batch) {
				batch = {
					driver: mount.driver,
					base: mount.base,
					items: []
				};
				batches.set(mount.base, batch);
			}
			return batch;
		};
		for (const item of items) {
			const isStringItem = typeof item === "string";
			const key = normalizeKey(isStringItem ? item : item.key);
			const value = isStringItem ? void 0 : item.value;
			const options2 = isStringItem || !item.options ? commonOptions : {
				...commonOptions,
				...item.options
			};
			const mount = getMount(key);
			getBatch(mount).items.push({
				key,
				value,
				relativeKey: mount.relativeKey,
				options: options2
			});
		}
		return Promise.all([...batches.values()].map((batch) => cb(batch))).then((r) => r.flat());
	};
	const storage = {
		hasItem(key, opts = {}) {
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			return asyncCall(driver.hasItem, relativeKey, opts);
		},
		getItem(key, opts = {}) {
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			return asyncCall(driver.getItem, relativeKey, opts).then((value) => destr(value));
		},
		getItems(items, commonOptions = {}) {
			return runBatch(items, commonOptions, (batch) => {
				if (batch.driver.getItems) return asyncCall(batch.driver.getItems, batch.items.map((item) => ({
					key: item.relativeKey,
					options: item.options
				})), commonOptions).then((r) => r.map((item) => ({
					key: joinKeys(batch.base, item.key),
					value: destr(item.value)
				})));
				return Promise.all(batch.items.map((item) => {
					return asyncCall(batch.driver.getItem, item.relativeKey, item.options).then((value) => ({
						key: item.key,
						value: destr(value)
					}));
				}));
			});
		},
		getItemRaw(key, opts = {}) {
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			if (driver.getItemRaw) return asyncCall(driver.getItemRaw, relativeKey, opts);
			return asyncCall(driver.getItem, relativeKey, opts).then((value) => deserializeRaw(value));
		},
		async setItem(key, value, opts = {}) {
			if (value === void 0) return storage.removeItem(key);
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			if (!driver.setItem) return;
			await asyncCall(driver.setItem, relativeKey, stringify$1(value), opts);
			if (!driver.watch) onChange("update", key);
		},
		async setItems(items, commonOptions) {
			await runBatch(items, commonOptions, async (batch) => {
				if (batch.driver.setItems) return asyncCall(batch.driver.setItems, batch.items.map((item) => ({
					key: item.relativeKey,
					value: stringify$1(item.value),
					options: item.options
				})), commonOptions);
				if (!batch.driver.setItem) return;
				await Promise.all(batch.items.map((item) => {
					return asyncCall(batch.driver.setItem, item.relativeKey, stringify$1(item.value), item.options);
				}));
			});
		},
		async setItemRaw(key, value, opts = {}) {
			if (value === void 0) return storage.removeItem(key, opts);
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			if (driver.setItemRaw) await asyncCall(driver.setItemRaw, relativeKey, value, opts);
			else if (driver.setItem) await asyncCall(driver.setItem, relativeKey, serializeRaw(value), opts);
			else return;
			if (!driver.watch) onChange("update", key);
		},
		async removeItem(key, opts = {}) {
			if (typeof opts === "boolean") opts = { removeMeta: opts };
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			if (!driver.removeItem) return;
			await asyncCall(driver.removeItem, relativeKey, opts);
			if (opts.removeMeta || opts.removeMata) await asyncCall(driver.removeItem, relativeKey + "$", opts);
			if (!driver.watch) onChange("remove", key);
		},
		async getMeta(key, opts = {}) {
			if (typeof opts === "boolean") opts = { nativeOnly: opts };
			key = normalizeKey(key);
			const { relativeKey, driver } = getMount(key);
			const meta = /* @__PURE__ */ Object.create(null);
			if (driver.getMeta) Object.assign(meta, await asyncCall(driver.getMeta, relativeKey, opts));
			if (!opts.nativeOnly) {
				const value = await asyncCall(driver.getItem, relativeKey + "$", opts).then((value_) => destr(value_));
				if (value && typeof value === "object") {
					if (typeof value.atime === "string") value.atime = new Date(value.atime);
					if (typeof value.mtime === "string") value.mtime = new Date(value.mtime);
					Object.assign(meta, value);
				}
			}
			return meta;
		},
		setMeta(key, value, opts = {}) {
			return this.setItem(key + "$", value, opts);
		},
		removeMeta(key, opts = {}) {
			return this.removeItem(key + "$", opts);
		},
		async getKeys(base, opts = {}) {
			base = normalizeBaseKey(base);
			const mounts = getMounts(base, true);
			let maskedMounts = [];
			const allKeys = [];
			let allMountsSupportMaxDepth = true;
			for (const mount of mounts) {
				if (!mount.driver.flags?.maxDepth) allMountsSupportMaxDepth = false;
				const rawKeys = await asyncCall(mount.driver.getKeys, mount.relativeBase, opts);
				for (const key of rawKeys) {
					const fullKey = mount.mountpoint + normalizeKey(key);
					if (!maskedMounts.some((p) => fullKey.startsWith(p))) allKeys.push(fullKey);
				}
				maskedMounts = [mount.mountpoint, ...maskedMounts.filter((p) => !p.startsWith(mount.mountpoint))];
			}
			const shouldFilterByDepth = opts.maxDepth !== void 0 && !allMountsSupportMaxDepth;
			return allKeys.filter((key) => (!shouldFilterByDepth || filterKeyByDepth(key, opts.maxDepth)) && filterKeyByBase(key, base));
		},
		async clear(base, opts = {}) {
			base = normalizeBaseKey(base);
			await Promise.all(getMounts(base, false).map(async (m) => {
				if (m.driver.clear) return asyncCall(m.driver.clear, m.relativeBase, opts);
				if (m.driver.removeItem) {
					const keys = await m.driver.getKeys(m.relativeBase || "", opts);
					return Promise.all(keys.map((key) => m.driver.removeItem(key, opts)));
				}
			}));
		},
		async dispose() {
			await Promise.all(Object.values(context.mounts).map((driver) => dispose(driver)));
		},
		async watch(callback) {
			await startWatch();
			context.watchListeners.push(callback);
			return async () => {
				context.watchListeners = context.watchListeners.filter((listener) => listener !== callback);
				if (context.watchListeners.length === 0) await stopWatch();
			};
		},
		async unwatch() {
			context.watchListeners = [];
			await stopWatch();
		},
		mount(base, driver) {
			base = normalizeBaseKey(base);
			if (base && context.mounts[base]) throw new Error(`already mounted at ${base}`);
			if (base) {
				context.mountpoints.push(base);
				context.mountpoints.sort((a, b) => b.length - a.length);
			}
			context.mounts[base] = driver;
			if (context.watching) Promise.resolve(watch(driver, onChange, base)).then((unwatcher) => {
				context.unwatch[base] = unwatcher;
			}).catch(console.error);
			return storage;
		},
		async unmount(base, _dispose = true) {
			base = normalizeBaseKey(base);
			if (!base || !context.mounts[base]) return;
			if (context.watching && base in context.unwatch) {
				context.unwatch[base]?.();
				delete context.unwatch[base];
			}
			if (_dispose) await dispose(context.mounts[base]);
			context.mountpoints = context.mountpoints.filter((key) => key !== base);
			delete context.mounts[base];
		},
		getMount(key = "") {
			key = normalizeKey(key) + ":";
			const m = getMount(key);
			return {
				driver: m.driver,
				base: m.base
			};
		},
		getMounts(base = "", opts = {}) {
			base = normalizeKey(base);
			return getMounts(base, opts.parents).map((m) => ({
				driver: m.driver,
				base: m.mountpoint
			}));
		},
		keys: (base, opts = {}) => storage.getKeys(base, opts),
		get: (key, opts = {}) => storage.getItem(key, opts),
		set: (key, value, opts = {}) => storage.setItem(key, value, opts),
		has: (key, opts = {}) => storage.hasItem(key, opts),
		del: (key, opts = {}) => storage.removeItem(key, opts),
		remove: (key, opts = {}) => storage.removeItem(key, opts)
	};
	return storage;
}
function watch(driver, onChange, base) {
	return driver.watch ? driver.watch((event, key) => onChange(event, base + key)) : () => {};
}
async function dispose(driver) {
	if (typeof driver.dispose === "function") await asyncCall(driver.dispose);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/session/runtime.js
var PERSIST_SYMBOL = /* @__PURE__ */ Symbol();
var DEFAULT_COOKIE_NAME = "astro-session";
var VALID_COOKIE_REGEX = /^[\w-]+$/;
var unflatten = (parsed, _) => {
	return unflatten$1(parsed, { URL: (href) => new URL(href) });
};
var stringify = (data, _) => {
	return stringify$2(data, { URL: (val) => val instanceof URL && val.href });
};
var AstroSession = class AstroSession {
	#cookies;
	#config;
	#cookieConfig;
	#cookieName;
	#storage;
	#data;
	#sessionID;
	#toDestroy = /* @__PURE__ */ new Set();
	#toDelete = /* @__PURE__ */ new Set();
	#dirty = false;
	#cookieSet = false;
	#sessionIDFromCookie = false;
	#partial = true;
	#driverFactory;
	static #sharedStorage = /* @__PURE__ */ new Map();
	constructor({ cookies, config, runtimeMode, driverFactory, mockStorage }) {
		if (!config) throw new AstroError({
			...SessionStorageInitError,
			message: SessionStorageInitError.message("No driver was defined in the session configuration and the adapter did not provide a default driver.")
		});
		this.#cookies = cookies;
		this.#driverFactory = driverFactory;
		const { cookie: cookieConfig = DEFAULT_COOKIE_NAME, ...configRest } = config;
		let cookieConfigObject;
		if (typeof cookieConfig === "object") {
			const { name = DEFAULT_COOKIE_NAME, ...rest } = cookieConfig;
			this.#cookieName = name;
			cookieConfigObject = rest;
		} else this.#cookieName = cookieConfig || DEFAULT_COOKIE_NAME;
		this.#cookieConfig = {
			sameSite: "lax",
			secure: runtimeMode === "production",
			path: "/",
			...cookieConfigObject,
			httpOnly: true
		};
		this.#config = configRest;
		if (mockStorage) this.#storage = mockStorage;
	}
	/**
	* Gets a session value. Returns `undefined` if the session or value does not exist.
	*/
	async get(key) {
		return (await this.#ensureData()).get(key)?.data;
	}
	/**
	* Checks if a session value exists.
	*/
	async has(key) {
		return (await this.#ensureData()).has(key);
	}
	/**
	* Gets all session values.
	*/
	async keys() {
		return (await this.#ensureData()).keys();
	}
	/**
	* Gets all session values.
	*/
	async values() {
		return [...(await this.#ensureData()).values()].map((entry) => entry.data);
	}
	/**
	* Gets all session entries.
	*/
	async entries() {
		return [...(await this.#ensureData()).entries()].map(([key, entry]) => [key, entry.data]);
	}
	/**
	* Deletes a session value.
	*/
	delete(key) {
		this.#data ??= /* @__PURE__ */ new Map();
		this.#data.delete(key);
		if (this.#partial) this.#toDelete.add(key);
		this.#dirty = true;
	}
	/**
	* Sets a session value. The session is created if it does not exist.
	*/
	set(key, value, { ttl } = {}) {
		if (!key) throw new AstroError({
			...SessionStorageSaveError,
			message: "The session key was not provided."
		});
		let cloned;
		try {
			cloned = unflatten(JSON.parse(stringify(value)));
		} catch (err) {
			throw new AstroError({
				...SessionStorageSaveError,
				message: `The session data for ${key} could not be serialized.`,
				hint: "See the devalue library for all supported types: https://github.com/rich-harris/devalue"
			}, { cause: err });
		}
		if (!this.#cookieSet) {
			this.#setCookie();
			this.#cookieSet = true;
		}
		this.#data ??= /* @__PURE__ */ new Map();
		const lifetime = ttl ?? this.#config.ttl;
		const expires = typeof lifetime === "number" ? Date.now() + lifetime * 1e3 : lifetime;
		this.#data.set(key, {
			data: cloned,
			expires
		});
		this.#dirty = true;
	}
	/**
	* Destroys the session, clearing the cookie and storage if it exists.
	*/
	destroy() {
		const sessionId = this.#sessionID ?? this.#cookies.get(this.#cookieName)?.value;
		if (sessionId) this.#toDestroy.add(sessionId);
		this.#cookies.delete(this.#cookieName, this.#cookieConfig);
		this.#sessionID = void 0;
		this.#data = void 0;
		this.#dirty = true;
	}
	/**
	* Regenerates the session, creating a new session ID. The existing session data is preserved.
	*/
	async regenerate() {
		let data = /* @__PURE__ */ new Map();
		try {
			data = await this.#ensureData();
		} catch (err) {
			console.error("Failed to load session data during regeneration:", err);
		}
		const oldSessionId = this.#sessionID;
		this.#sessionID = crypto.randomUUID();
		this.#sessionIDFromCookie = false;
		this.#data = data;
		this.#dirty = true;
		await this.#setCookie();
		if (oldSessionId && this.#storage) this.#storage.removeItem(oldSessionId).catch((err) => {
			console.error("Failed to remove old session data:", err);
		});
	}
	async [PERSIST_SYMBOL]() {
		if (!this.#dirty && !this.#toDestroy.size) return;
		const storage = await this.#ensureStorage();
		if (this.#dirty && this.#data) {
			const data = await this.#ensureData();
			this.#toDelete.forEach((key2) => data.delete(key2));
			const key = this.#ensureSessionID();
			let serialized;
			try {
				serialized = stringify(data);
			} catch (err) {
				throw new AstroError({
					...SessionStorageSaveError,
					message: SessionStorageSaveError.message("The session data could not be serialized.", this.#config.driver)
				}, { cause: err });
			}
			await storage.setItem(key, serialized);
			this.#dirty = false;
		}
		if (this.#toDestroy.size > 0) {
			const cleanupPromises = [...this.#toDestroy].map((sessionId) => storage.removeItem(sessionId).catch((err) => {
				console.error("Failed to clean up session %s:", sessionId, err);
			}));
			await Promise.all(cleanupPromises);
			this.#toDestroy.clear();
		}
	}
	get sessionID() {
		return this.#sessionID;
	}
	/**
	* Loads a session from storage with the given ID, and replaces the current session.
	* Any changes made to the current session will be lost.
	* This is not normally needed, as the session is automatically loaded using the cookie.
	* However it can be used to restore a session where the ID has been recorded somewhere
	* else (e.g. in a database).
	*/
	async load(sessionID) {
		this.#sessionID = sessionID;
		this.#data = void 0;
		await this.#setCookie();
		await this.#ensureData();
	}
	/**
	* Sets the session cookie.
	*/
	async #setCookie() {
		if (!VALID_COOKIE_REGEX.test(this.#cookieName)) throw new AstroError({
			...SessionStorageSaveError,
			message: "Invalid cookie name. Cookie names can only contain letters, numbers, and dashes."
		});
		const value = this.#ensureSessionID();
		this.#cookies.set(this.#cookieName, value, this.#cookieConfig);
	}
	/**
	* Attempts to load the session data from storage, or creates a new data object if none exists.
	* If there is existing partial data, it will be merged into the new data object.
	*/
	async #ensureData() {
		if (this.#data && !this.#partial) return this.#data;
		this.#data ??= /* @__PURE__ */ new Map();
		if (!this.#sessionID && !this.#cookies.get(this.#cookieName)?.value) {
			this.#partial = false;
			return this.#data;
		}
		const raw = await (await this.#ensureStorage()).get(this.#ensureSessionID());
		if (!raw) {
			if (this.#sessionIDFromCookie) {
				this.#sessionID = crypto.randomUUID();
				this.#sessionIDFromCookie = false;
				if (this.#cookieSet) await this.#setCookie();
			}
			return this.#data;
		}
		try {
			const storedMap = unflatten(raw);
			if (!(storedMap instanceof Map)) {
				await this.destroy();
				throw new AstroError({
					...SessionStorageInitError,
					message: SessionStorageInitError.message("The session data was an invalid type.", this.#config.driver)
				});
			}
			const now = Date.now();
			for (const [key, value] of storedMap) {
				const expired = typeof value.expires === "number" && value.expires < now;
				if (!this.#data.has(key) && !this.#toDelete.has(key) && !expired) this.#data.set(key, value);
			}
			this.#partial = false;
			return this.#data;
		} catch (err) {
			await this.destroy();
			if (err instanceof AstroError) throw err;
			throw new AstroError({
				...SessionStorageInitError,
				message: SessionStorageInitError.message("The session data could not be parsed.", this.#config.driver)
			}, { cause: err });
		}
	}
	/**
	* Returns the session ID, generating a new one if it does not exist.
	*/
	#ensureSessionID() {
		if (!this.#sessionID) {
			const cookieValue = this.#cookies.get(this.#cookieName)?.value;
			if (cookieValue) {
				this.#sessionID = cookieValue;
				this.#sessionIDFromCookie = true;
			} else this.#sessionID = crypto.randomUUID();
		}
		return this.#sessionID;
	}
	/**
	* Ensures the storage is initialized.
	* This is called automatically when a storage operation is needed.
	*/
	async #ensureStorage() {
		if (this.#storage) return this.#storage;
		if (AstroSession.#sharedStorage.has(this.#config.driver)) {
			this.#storage = AstroSession.#sharedStorage.get(this.#config.driver);
			return this.#storage;
		}
		if (!this.#driverFactory) throw new AstroError({
			...SessionStorageInitError,
			message: SessionStorageInitError.message("Astro could not load the driver correctly. Does it exist?", this.#config.driver)
		});
		const driver = this.#driverFactory;
		try {
			this.#storage = createStorage({ driver: {
				...driver(this.#config.options),
				hasItem() {
					return false;
				},
				getKeys() {
					return [];
				}
			} });
			AstroSession.#sharedStorage.set(this.#config.driver, this.#storage);
			return this.#storage;
		} catch (err) {
			throw new AstroError({
				...SessionStorageInitError,
				message: SessionStorageInitError.message("Unknown error", this.#config.driver)
			}, { cause: err });
		}
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/session/handler.js
var SESSION_KEY = "session";
function provideSession(state) {
	state.pipeline.usedFeatures |= PipelineFeatures.sessions;
	const config = state.pipeline.manifest.sessionConfig;
	if (!config) return;
	return provideSessionAsync(state, config);
}
async function provideSessionAsync(state, config) {
	const pipeline = state.pipeline;
	const driverFactory = await pipeline.getSessionDriver();
	if (!driverFactory) return;
	state.provide(SESSION_KEY, {
		create() {
			const cookies = state.cookies;
			return new AstroSession({
				cookies,
				config,
				runtimeMode: pipeline.runtimeMode,
				driverFactory,
				mockStorage: null
			});
		},
		finalize(session) {
			return session[PERSIST_SYMBOL]();
		}
	});
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/routing/handler.js
var AstroHandler = class {
	#app;
	#trailingSlashHandler;
	#actionHandler;
	#astroMiddleware;
	#pagesHandler;
	#cacheHandler;
	/** Bound callback for the middleware chain — created once, reused per request. */
	#renderRouteCallback;
	/**
	* i18n post-processor. Only set when the app has i18n configured and
	* the strategy is not `manual` — for the manual strategy users wire
	* `astro:i18n.middleware(...)` into their own `onRequest`.
	*/
	#i18n;
	/** Whether sessions are configured on the manifest. */
	#hasSession;
	constructor(app) {
		this.#app = app;
		this.#trailingSlashHandler = new TrailingSlashHandler(app);
		this.#actionHandler = new ActionHandler();
		this.#astroMiddleware = new AstroMiddleware(app.pipeline);
		this.#pagesHandler = new PagesHandler(app.pipeline);
		this.#cacheHandler = new CacheHandler(app);
		this.#renderRouteCallback = this.#actionsAndPages.bind(this);
		this.#hasSession = !!app.manifest.sessionConfig;
		const i18n = app.manifest.i18n;
		if (i18n && i18n.strategy !== "manual") this.#i18n = new I18n(i18n, app.manifest.base, app.manifest.trailingSlash, app.manifest.buildFormat);
	}
	/**
	* Runs actions then pages — the callback at the bottom of the
	* middleware chain. Bound once in the constructor to avoid
	* per-request closure allocation.
	*/
	#actionsAndPages(state, ctx) {
		if (!state.skipMiddleware) {
			const actionResult = this.#actionHandler.handle(ctx, state);
			if (actionResult) return actionResult.then((response) => response ?? this.#pagesHandler.handle(state, ctx));
		}
		return this.#pagesHandler.handle(state, ctx);
	}
	async handle(state) {
		state.pipeline.usedFeatures |= ALL_PIPELINE_FEATURES;
		if (state.invalidEncoding) return new Response(null, {
			status: 400,
			statusText: "Bad Request"
		});
		const trailingSlashRedirect = this.#trailingSlashHandler.handle(state);
		if (trailingSlashRedirect) return trailingSlashRedirect;
		if (!state.routeData) return this.#app.renderError(state.request, {
			...state.renderOptions,
			status: 404,
			pathname: state.pathname
		});
		return this.render(state);
	}
	/**
	* Renders a response for the given `FetchState`. Assumes
	* trailing-slash redirects and routeData resolution have already run.
	*
	* User-triggered rewrites (`Astro.rewrite` / `ctx.rewrite`) go through
	* `Rewrites.execute` on the current `FetchState` — they mutate the
	* existing state in place and re-run middleware + page dispatch.
	*/
	async render(state) {
		const routeData = state.routeData;
		const pathname = state.pathname;
		const request = state.request;
		const { addCookieHeader } = state.renderOptions;
		state.status = this.#app.getDefaultStatusCode(routeData, pathname);
		let response;
		try {
			const sessionP = this.#hasSession ? provideSession(state) : void 0;
			const cacheP = provideCache(state);
			if (sessionP || cacheP) await Promise.all([sessionP, cacheP]);
			state.pipeline.usedFeatures |= PipelineFeatures.sessions;
			if (routeData.type === "redirect") {
				const redirectResponse = await renderRedirect(state);
				this.#app.logThisRequest({
					pathname,
					method: request.method,
					statusCode: redirectResponse.status,
					isRewrite: false,
					timeStart: state.timeStart
				});
				prepareResponse(redirectResponse, { addCookieHeader });
				this.#app.pipeline.logger.flush();
				return redirectResponse;
			}
			if (!this.#app.pipeline.cacheProvider) {
				this.#app.pipeline.usedFeatures |= PipelineFeatures.cache;
				response = await this.#astroMiddleware.handle(state, this.#renderRouteCallback);
				if (this.#i18n) response = await this.#i18n.finalize(state, response);
			} else {
				const runPipeline = async () => {
					let res = await this.#astroMiddleware.handle(state, this.#renderRouteCallback);
					if (this.#i18n) res = await this.#i18n.finalize(state, res);
					return res;
				};
				response = await this.#cacheHandler.handle(state, runPipeline);
			}
			this.#app.logThisRequest({
				pathname,
				method: request.method,
				statusCode: response.status,
				isRewrite: state.isRewriting,
				timeStart: state.timeStart
			});
		} catch (err) {
			this.#app.logger.error(null, err.stack || err.message || String(err));
			return this.#app.renderError(request, {
				...state.renderOptions,
				status: 500,
				error: err,
				pathname: state.pathname
			});
		} finally {
			const finalize = state.finalizeAll();
			if (finalize) await finalize;
		}
		if (REROUTABLE_STATUS_CODES.includes(response.status) && response.body === null && !state.skipErrorReroute) return this.#app.renderError(request, {
			...state.renderOptions,
			response,
			status: response.status,
			error: response.status === 500 ? null : void 0,
			pathname: state.pathname
		});
		prepareResponse(response, { addCookieHeader });
		this.#app.pipeline.logger.flush();
		return response;
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/fetch/default-handler.js
var DefaultFetchHandler = class {
	#app;
	#handler;
	constructor(app) {
		this.#app = app ?? null;
		this.#handler = app ? new AstroHandler(app) : null;
	}
	/**
	* Fast path: called directly by `BaseApp.render()` with pre-resolved
	* options, avoiding the `Reflect.set/get` round-trip through the request.
	*/
	renderWithOptions(request, options) {
		if (!this.#app) {
			const app = Reflect.get(request, appSymbol);
			if (!app) throw new Error("No fetch handler provided.");
			this.#app = app;
			this.#handler = new AstroHandler(app);
		}
		const state = new FetchState(this.#app.pipeline, request, options);
		return this.#handler.handle(state);
	}
	fetch = (request) => {
		if (!this.#app) {
			const app = Reflect.get(request, appSymbol);
			if (!app) throw new Error("No fetch handler provided.");
			this.#app = app;
			this.#handler = new AstroHandler(app);
		}
		const state = new FetchState(this.#app.pipeline, request);
		if (!this.#handler) throw new Error("No fetch handler provided.");
		return this.#handler.handle(state);
	};
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/output-filename.js
var STATUS_CODE_PAGES = /* @__PURE__ */ new Set(["/404", "/500"]);
function getOutputFilename(buildFormat, name, routeData) {
	if (routeData.type === "endpoint") return name;
	if (name === "/" || name === "") return name === "" ? "index.html" : "/index.html";
	if (buildFormat === "file" || STATUS_CODE_PAGES.has(name)) return `${removeTrailingForwardSlash(name || "index")}.html`;
	if (buildFormat === "preserve" && !routeData.isIndex) return `${removeTrailingForwardSlash(name || "index")}.html`;
	return `${removeTrailingForwardSlash(name)}/index.html`;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/errors/default-handler.js
var DefaultErrorHandler = class {
	#app;
	#astroMiddleware;
	#pagesHandler;
	constructor(app) {
		this.#app = app;
		this.#astroMiddleware = new AstroMiddleware(app.pipeline);
		this.#pagesHandler = new PagesHandler(app.pipeline);
	}
	async renderError(request, { status, response: originalResponse, skipMiddleware = false, error, pathname, ...resolvedRenderOptions }) {
		const app = this.#app;
		const resolvedPathname = pathname ?? new FetchState(app.pipeline, request).pathname;
		const errorRouteData = matchRoute(getErrorRoutePath(resolvedPathname, status, app.manifestData.routes, app.manifest.i18n?.locales, app.manifest.trailingSlash === "always"), app.manifestData);
		const url = new URL(request.url);
		if (errorRouteData) {
			if (errorRouteData.prerender) {
				const allowedDomains = app.manifest.allowedDomains;
				const safeOrigin = validateHost(url.host, url.protocol.replace(":", ""), allowedDomains) ? url.origin : `${url.protocol}//localhost`;
				const statusURL = new URL(`${app.baseWithoutTrailingSlash}${getOutputFilename(app.manifest.buildFormat, errorRouteData.route, errorRouteData)}`, safeOrigin);
				if (statusURL.toString() !== request.url && resolvedRenderOptions.prerenderedErrorPageFetch) try {
					const newResponse = mergeResponses(await resolvedRenderOptions.prerenderedErrorPageFetch(statusURL.toString()), originalResponse, {
						status,
						removeContentEncodingHeaders: true
					});
					prepareResponse(newResponse, resolvedRenderOptions);
					return newResponse;
				} catch {
					const response2 = mergeResponses(new Response(null, { status }), originalResponse);
					prepareResponse(response2, resolvedRenderOptions);
					return response2;
				}
			}
			const mod = await app.pipeline.getComponentByRoute(errorRouteData);
			const errorState = new FetchState(app.pipeline, request);
			errorState.skipMiddleware = skipMiddleware;
			errorState.clientAddress = resolvedRenderOptions.clientAddress;
			errorState.routeData = errorRouteData;
			errorState.pathname = resolvedPathname;
			errorState.status = status;
			errorState.componentInstance = mod;
			errorState.locals = resolvedRenderOptions.locals ?? {};
			errorState.initialProps = { error };
			try {
				await provideSession(errorState);
				const newResponse = mergeResponses(await this.#astroMiddleware.handle(errorState, this.#pagesHandler.handle.bind(this.#pagesHandler)), originalResponse);
				prepareResponse(newResponse, resolvedRenderOptions);
				return newResponse;
			} catch {
				if (skipMiddleware === false) return this.renderError(request, {
					...resolvedRenderOptions,
					status,
					error,
					response: originalResponse,
					skipMiddleware: true,
					pathname: resolvedPathname
				});
			} finally {
				await errorState.finalizeAll();
			}
		}
		const response = mergeResponses(new Response(null, { status }), originalResponse);
		prepareResponse(response, resolvedRenderOptions);
		return response;
	}
};
function mergeResponses(newResponse, originalResponse, override) {
	let newResponseHeaders = newResponse.headers;
	if (override?.removeContentEncodingHeaders) {
		newResponseHeaders = new Headers(newResponseHeaders);
		newResponseHeaders.delete("Content-Encoding");
		newResponseHeaders.delete("Content-Length");
	}
	if (!originalResponse) {
		if (override !== void 0) return new Response(newResponse.body, {
			status: override.status,
			statusText: newResponse.statusText,
			headers: newResponseHeaders
		});
		return newResponse;
	}
	const status = override?.status ? override.status : originalResponse.status === 200 ? newResponse.status : originalResponse.status;
	try {
		originalResponse.headers.delete("Content-type");
		originalResponse.headers.delete("Content-Length");
		originalResponse.headers.delete("Transfer-Encoding");
	} catch {}
	const newHeaders = new Headers();
	const seen = /* @__PURE__ */ new Set();
	for (const [name, value] of originalResponse.headers) {
		newHeaders.append(name, value);
		seen.add(name.toLowerCase());
	}
	for (const [name, value] of newResponseHeaders) if (!seen.has(name.toLowerCase())) newHeaders.append(name, value);
	const mergedResponse = new Response(newResponse.body, {
		status,
		statusText: status === 200 ? newResponse.statusText : originalResponse.statusText,
		headers: newHeaders
	});
	const originalCookies = getCookiesFromResponse(originalResponse);
	const newCookies = getCookiesFromResponse(newResponse);
	if (originalCookies) {
		if (newCookies) for (const cookieValue of newCookies.consume()) originalResponse.headers.append("set-cookie", cookieValue);
		attachCookiesToResponse(mergedResponse, originalCookies);
	} else if (newCookies) attachCookiesToResponse(mergedResponse, newCookies);
	return mergedResponse;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/app/base.js
var BaseApp = class BaseApp {
	manifest;
	manifestData;
	pipeline;
	#adapterLogger;
	baseWithoutTrailingSlash;
	/**
	* The handler that turns incoming `Request` objects into `Response`s.
	* Defaults to a `DefaultFetchHandler` pinned to this app and can be
	* overridden via `setFetchHandler` — typically by the bundled
	* entrypoint after importing `virtual:astro:fetchable`.
	*/
	#fetchHandler;
	#errorHandler;
	/**
	* Whether a custom fetch handler (from `src/fetch.ts`) has been set
	* via `setFetchHandler`. When false, the `DefaultFetchHandler` is
	* in use and all features are implicitly active.
	*/
	#hasCustomFetchHandler = false;
	/**
	* Whether the missing-feature check has already run. We only want
	* to warn once — after the first request in dev, or at build end.
	*/
	#featureCheckDone = false;
	get logger() {
		return this.pipeline.logger;
	}
	get adapterLogger() {
		const currentOptions = this.logger.options;
		if (!this.#adapterLogger || this.#adapterLogger.options !== currentOptions) this.#adapterLogger = new AstroIntegrationLogger(currentOptions, this.manifest.adapterName);
		return this.#adapterLogger;
	}
	constructor(manifest, streaming = true, ...args) {
		this.manifest = manifest;
		this.baseWithoutTrailingSlash = removeTrailingForwardSlash(manifest.base);
		this.pipeline = this.createPipeline(streaming, manifest, ...args);
		this.manifestData = this.pipeline.manifestData;
		this.#fetchHandler = new DefaultFetchHandler(this);
		this.#errorHandler = this.createErrorHandler();
	}
	/**
	* Override the fetch handler used to dispatch requests. Entrypoints
	* call this with the default export of `virtual:astro:fetchable` to
	* plug in a user-authored handler from `src/fetch.ts`.
	*/
	setFetchHandler(handler) {
		this.#fetchHandler = handler;
		this.#hasCustomFetchHandler = !(handler instanceof DefaultFetchHandler);
	}
	/**
	* Returns the error handler strategy used by this app. Override to
	* provide environment-specific behavior (dev overlay, build-time throws, etc.).
	*/
	createErrorHandler() {
		return new DefaultErrorHandler(this);
	}
	/**
	* Resets the cached adapter logger so it picks up a new logger instance.
	* Used by BuildApp when the logger is replaced via setOptions().
	*/
	resetAdapterLogger() {
		this.#adapterLogger = void 0;
	}
	getAllowedDomains() {
		return this.manifest.allowedDomains;
	}
	matchesAllowedDomains(forwardedHost, protocol) {
		return BaseApp.validateForwardedHost(forwardedHost, this.manifest.allowedDomains, protocol);
	}
	static validateForwardedHost(forwardedHost, allowedDomains, protocol) {
		if (!allowedDomains || allowedDomains.length === 0) return false;
		try {
			const testUrl = new URL(`${protocol || "https"}://${forwardedHost}`);
			return allowedDomains.some((pattern) => {
				return matchPattern(testUrl, pattern);
			});
		} catch {
			return false;
		}
	}
	set setManifestData(newManifestData) {
		this.manifestData = newManifestData;
		this.pipeline.manifestData = newManifestData;
		this.pipeline.rebuildRouter();
	}
	removeBase(pathname) {
		pathname = collapseDuplicateLeadingSlashes(pathname);
		if (pathname.startsWith(this.manifest.base)) return pathname.slice(this.baseWithoutTrailingSlash.length + 1);
		return pathname;
	}
	/**
	* Decodes a pathname with `decodeURI`, falling back to the raw pathname when it
	* contains an invalid percent-sequence (e.g. `%C0%AF`, an overlong-UTF-8 encoding of
	* `/` commonly sent by path-traversal scanners). A raw `decodeURI()` would throw
	* `URIError: URI malformed`, and because `match()` runs before `render()` that error
	* escapes the adapter's request handler as an uncaught exception (HTTP 500) that user
	* middleware can't catch.
	*/
	safeDecodeURI(pathname) {
		try {
			return decodeURI(pathname);
		} catch (e) {
			this.adapterLogger.debug(e.toString());
			return pathname;
		}
	}
	/**
	* Extracts the base-stripped, decoded pathname from a request.
	* Used by adapters to compute the pathname for dev-mode route matching.
	*/
	getPathnameFromRequest(request) {
		const url = new URL(request.url);
		const pathname = prependForwardSlash(this.removeBase(url.pathname));
		return this.safeDecodeURI(pathname);
	}
	/**
	* Given a `Request`, it returns the `RouteData` that matches its `pathname`. By default, prerendered
	* routes aren't returned, even if they are matched.
	*
	* When `allowPrerenderedRoutes` is `true`, the function returns matched prerendered routes too.
	* @param request
	* @param allowPrerenderedRoutes
	*/
	match(request, allowPrerenderedRoutes = false) {
		const url = new URL(request.url);
		if (this.manifest.assets.has(url.pathname)) return void 0;
		let pathname = this.computePathnameFromDomain(request);
		if (!pathname) pathname = prependForwardSlash(this.removeBase(url.pathname));
		const routeData = this.pipeline.matchRoute(this.safeDecodeURI(pathname));
		if (!routeData) return void 0;
		if (allowPrerenderedRoutes) return routeData;
		if (routeData.prerender) {
			if (routeData.params.length > 0) return this.pipeline.matchAllRoutes(this.safeDecodeURI(pathname)).find((r) => !r.prerender);
			return;
		}
		return routeData;
	}
	/**
	* A matching route function to use in the development server.
	* Contrary to the `.match` function, this function resolves props and params, returning the correct
	* route based on the priority, segments. It also returns the correct, resolved pathname.
	* @param pathname
	*/
	devMatch(pathname) {}
	computePathnameFromDomain(request) {
		return computePathnameFromDomain(request, new URL(request.url), this.manifest.i18n, this.manifest.base, this.manifest.trailingSlash, this.logger);
	}
	async render(request, { addCookieHeader = false, clientAddress = Reflect.get(request, clientAddressSymbol), locals, prerenderedErrorPageFetch = fetch, routeData, waitUntil } = {}) {
		await this.pipeline.getLogger();
		if (routeData) {
			this.logger.debug("router", "The adapter " + this.manifest.adapterName + " provided a custom RouteData for ", request.url);
			this.logger.debug("router", "RouteData");
			this.logger.debug("router", routeData);
		}
		if (locals) {
			if (typeof locals !== "object") {
				const error = new AstroError(LocalsNotAnObject);
				this.logger.error(null, error.stack);
				return this.renderError(request, {
					addCookieHeader,
					clientAddress,
					prerenderedErrorPageFetch,
					locals: void 0,
					routeData,
					waitUntil,
					status: 500,
					error
				});
			}
		}
		if (!routeData) {
			const domainPathname = this.computePathnameFromDomain(request);
			if (domainPathname) routeData = this.pipeline.matchRoute(this.safeDecodeURI(domainPathname));
		}
		const resolvedOptions = {
			addCookieHeader,
			clientAddress,
			prerenderedErrorPageFetch,
			locals,
			routeData,
			waitUntil
		};
		let response;
		if (this.#fetchHandler instanceof DefaultFetchHandler) {
			Reflect.set(request, appSymbol, this);
			response = await this.#fetchHandler.renderWithOptions(request, resolvedOptions);
		} else {
			setRenderOptions(request, resolvedOptions);
			Reflect.set(request, appSymbol, this);
			response = await this.#fetchHandler.fetch(request);
		}
		this.#warnMissingFeatures();
		if (response.headers.get("X-Astro-Error")) {
			response.headers.delete(ASTRO_ERROR_HEADER);
			return this.renderError(request, {
				addCookieHeader,
				clientAddress,
				prerenderedErrorPageFetch,
				locals,
				routeData,
				waitUntil,
				response,
				status: response.status,
				error: response.status === 500 ? null : void 0
			});
		}
		return response;
	}
	setCookieHeaders(response) {
		return getSetCookiesFromResponse(response);
	}
	/**
	* Reads all the cookies written by `Astro.cookie.set()` onto the passed response.
	* For example,
	* ```ts
	* for (const cookie_ of App.getSetCookieFromResponse(response)) {
	*     const cookie: string = cookie_
	* }
	* ```
	* @param response The response to read cookies from.
	* @returns An iterator that yields key-value pairs as equal-sign-separated strings.
	*/
	static getSetCookieFromResponse = getSetCookiesFromResponse;
	/**
	* If it is a known error code, try sending the according page (e.g. 404.astro / 500.astro).
	* This also handles pre-rendered /404 or /500 routes.
	*
	* Delegates to the app's configured `ErrorHandler`. To customize behavior
	* for a specific environment, override `createErrorHandler()` rather than
	* this method.
	*/
	async renderError(request, options) {
		return this.#errorHandler.renderError(request, options);
	}
	/**
	* One-shot check: after the first request with a custom `src/fetch.ts`,
	* compare `usedFeatures` against the manifest and warn about any
	* configured features the user's pipeline doesn't call.
	*/
	#warnMissingFeatures() {
		if (this.#featureCheckDone || !this.#hasCustomFetchHandler) return;
		this.#featureCheckDone = true;
		const manifest = this.manifest;
		const missing = [];
		const used = this.pipeline.usedFeatures;
		if (manifest.routes.some((r) => r.routeData.type === "redirect") && !(used & PipelineFeatures.redirects)) missing.push("redirects");
		if (manifest.sessionConfig && !(used & PipelineFeatures.sessions)) missing.push("sessions");
		if (manifest.actions && !(used & PipelineFeatures.actions)) missing.push("actions");
		if (manifest.middleware && !(used & PipelineFeatures.middleware)) missing.push("middleware");
		if (manifest.i18n && manifest.i18n.strategy !== "manual" && !(used & PipelineFeatures.i18n)) missing.push("i18n");
		if (manifest.cacheConfig && !(used & PipelineFeatures.cache)) missing.push("cache");
		for (const feature of missing) this.logger.warn("router", `Your project uses ${feature}, but your custom src/fetch.ts does not call the ${feature}() handler. This feature will not work unless you add it to your fetch.ts pipeline.`);
	}
	getDefaultStatusCode(routeData, pathname) {
		if (!routeData.pattern.test(pathname)) {
			for (const fallbackRoute of routeData.fallbackRoutes) if (fallbackRoute.pattern.test(pathname)) return 302;
		}
		const route = removeTrailingForwardSlash(routeData.route);
		const locales = this.manifest.i18n?.locales;
		if (isRoute404(route) || isLocalizedErrorRoute(route, 404, locales)) return 404;
		if (isRoute500(route) || isLocalizedErrorRoute(route, 500, locales)) return 500;
		return 200;
	}
	getManifest() {
		return this.pipeline.manifest;
	}
	logThisRequest({ pathname, method, statusCode, isRewrite, timeStart }) {
		const timeEnd = performance.now();
		this.logRequest({
			pathname,
			method,
			statusCode,
			isRewrite,
			reqTime: timeEnd - timeStart
		});
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/assets/utils/getAssetsPrefix.js
function getAssetsPrefix(fileExtension, assetsPrefix) {
	let prefix = "";
	if (!assetsPrefix) prefix = "";
	else if (typeof assetsPrefix === "string") prefix = assetsPrefix;
	else prefix = assetsPrefix[fileExtension.slice(1)] || assetsPrefix.fallback;
	return prefix;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/render/ssr-element.js
var URL_PARSE_BASE = "https://astro.build";
function splitAssetPath(path) {
	const parsed = new URL(path, URL_PARSE_BASE);
	return {
		pathname: !URL.canParse(path) && !path.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname,
		suffix: `${parsed.search}${parsed.hash}`
	};
}
function appendQueryParams(path, queryParams) {
	const queryString = queryParams.toString();
	if (!queryString) return path;
	const hashIndex = path.indexOf("#");
	const basePath = hashIndex === -1 ? path : path.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
	return `${basePath}${basePath.includes("?") ? "&" : "?"}${queryString}${hash}`;
}
function createAssetLink(href, base, assetsPrefix, queryParams) {
	const { pathname, suffix } = splitAssetPath(href);
	let url = "";
	if (assetsPrefix) url = joinPaths(getAssetsPrefix(fileExtension(pathname), assetsPrefix), slash(pathname)) + suffix;
	else if (base) url = prependForwardSlash(joinPaths(base, slash(pathname))) + suffix;
	else url = href;
	if (queryParams) url = appendQueryParams(url, queryParams);
	return url;
}
function createStylesheetElement(stylesheet, base, assetsPrefix, queryParams) {
	if (stylesheet.type === "inline") return {
		props: {},
		children: stylesheet.content
	};
	else return {
		props: {
			rel: "stylesheet",
			href: createAssetLink(stylesheet.src, base, assetsPrefix, queryParams)
		},
		children: ""
	};
}
function createStylesheetElementSet(stylesheets, base, assetsPrefix, queryParams) {
	return new Set(stylesheets.map((s) => createStylesheetElement(s, base, assetsPrefix, queryParams)));
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/app/manifest.js
function deserializeManifest(serializedManifest, routesList) {
	const routes = [];
	if (serializedManifest.routes) for (const serializedRoute of serializedManifest.routes) {
		routes.push({
			...serializedRoute,
			routeData: deserializeRouteData(serializedRoute.routeData)
		});
		const route = serializedRoute;
		route.routeData = deserializeRouteData(serializedRoute.routeData);
	}
	if (routesList) for (const route of routesList?.routes) routes.push({
		file: "",
		links: [],
		scripts: [],
		styles: [],
		routeData: route
	});
	const assets = new Set(serializedManifest.assets);
	const componentMetadata = new Map(serializedManifest.componentMetadata);
	const inlinedScripts = new Map(serializedManifest.inlinedScripts);
	const clientDirectives = new Map(serializedManifest.clientDirectives);
	const key = decodeKey(serializedManifest.key);
	return {
		middleware() {
			return { onRequest: NOOP_MIDDLEWARE_FN };
		},
		...serializedManifest,
		rootDir: new URL(serializedManifest.rootDir),
		srcDir: new URL(serializedManifest.srcDir),
		publicDir: new URL(serializedManifest.publicDir),
		outDir: new URL(serializedManifest.outDir),
		cacheDir: new URL(serializedManifest.cacheDir),
		buildClientDir: new URL(serializedManifest.buildClientDir),
		buildServerDir: new URL(serializedManifest.buildServerDir),
		assets,
		componentMetadata,
		inlinedScripts,
		clientDirectives,
		routes,
		key
	};
}
function deserializeRouteData(rawRouteData) {
	return {
		route: rawRouteData.route,
		type: rawRouteData.type,
		pattern: new RegExp(rawRouteData.pattern),
		params: rawRouteData.params,
		component: rawRouteData.component,
		pathname: rawRouteData.pathname || void 0,
		segments: rawRouteData.segments,
		prerender: rawRouteData.prerender,
		redirect: rawRouteData.redirect,
		redirectRoute: rawRouteData.redirectRoute ? deserializeRouteData(rawRouteData.redirectRoute) : void 0,
		fallbackRoutes: rawRouteData.fallbackRoutes.map((fallback) => {
			return deserializeRouteData(fallback);
		}),
		isIndex: rawRouteData.isIndex,
		origin: rawRouteData.origin,
		distURL: rawRouteData.distURL
	};
}
function deserializeRouteInfo(rawRouteInfo) {
	return {
		styles: rawRouteInfo.styles,
		file: rawRouteInfo.file,
		links: rawRouteInfo.links,
		scripts: rawRouteInfo.scripts,
		routeData: deserializeRouteData(rawRouteInfo.routeData)
	};
}
//#endregion
//#region node_modules/.pnpm/@astrojs+mdx@7.0.0_@astrojs+markdown-satteri@0.3.4_astro@7.1.0_@emnapi+core@1.11.1_@emn_131cf69f7464bdb105434148ae00e101/node_modules/@astrojs/mdx/dist/server.js
var slotName = (str) => str.trim().replace(/[-_]([a-z])/g, (_, w) => w.toUpperCase());
async function check(Component, props, { default: children = null, ...slotted } = {}) {
	if (typeof Component !== "function") return false;
	const slots = {};
	for (const [key, value] of Object.entries(slotted)) {
		const name = slotName(key);
		slots[name] = value;
	}
	try {
		return (await Component({
			...props,
			...slots,
			children
		}))[AstroJSX];
	} catch (e) {
		throwEnhancedErrorIfMdxComponent(e, Component);
	}
	return false;
}
async function renderToStaticMarkup(Component, props = {}, { default: children = null, ...slotted } = {}) {
	const slots = {};
	for (const [key, value] of Object.entries(slotted)) {
		const name = slotName(key);
		slots[name] = value;
	}
	const { result } = this;
	try {
		let html = "";
		const destination = { write(chunk) {
			if (chunk instanceof Response) return;
			html += chunkToString(result, chunk);
		} };
		await renderStreaming(createVNode(Component, {
			...props,
			...slots,
			children
		}), result, destination);
		return { html };
	} catch (e) {
		throwEnhancedErrorIfMdxComponent(e, Component);
		throw e;
	}
}
function throwEnhancedErrorIfMdxComponent(error, Component) {
	if (Component[/* @__PURE__ */ Symbol.for("mdx-component")]) {
		if (AstroUserError.is(error)) return;
		error.title = error.name;
		error.hint = `This issue often occurs when your MDX component encounters runtime errors.`;
		throw error;
	}
}
//#endregion
//#region \0virtual:astro:renderers
var renderers = [Object.assign({
	"name": "astro:jsx",
	"serverEntrypoint": "file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/node_modules/.pnpm/@astrojs+mdx@7.0.0_@astrojs+markdown-satteri@0.3.4_astro@7.1.0_@emnapi+core@1.11.1_@emn_131cf69f7464bdb105434148ae00e101/node_modules/@astrojs/mdx/dist/server.js"
}, { ssr: {
	name: "astro:jsx",
	check,
	renderToStaticMarkup
} })];
[{
	"file": "",
	"links": [],
	"scripts": [],
	"styles": [],
	"routeData": {
		"route": "/",
		"isIndex": true,
		"type": "page",
		"pattern": "^\\/$",
		"segments": [],
		"params": [],
		"component": "src/pages/index.astro",
		"pathname": "/",
		"prerender": true,
		"fallbackRoutes": [],
		"distURL": [],
		"origin": "project",
		"_meta": { "trailingSlash": "ignore" }
	}
}, {
	"file": "",
	"links": [],
	"scripts": [],
	"styles": [],
	"routeData": {
		"route": "/[...slug]",
		"isIndex": false,
		"type": "page",
		"pattern": "^(?:\\/(.*?))?\\/?$",
		"segments": [[{
			"content": "...slug",
			"dynamic": true,
			"spread": true
		}]],
		"params": ["...slug"],
		"component": "src/pages/[...slug].astro",
		"prerender": true,
		"fallbackRoutes": [],
		"distURL": [],
		"origin": "project",
		"_meta": { "trailingSlash": "ignore" }
	}
}].map(deserializeRouteInfo);
//#endregion
//#region \0virtual:astro:pages
var _page0 = () => import("./chunks/index_Cfu_Ztn2.mjs");
var _page1 = () => import("./chunks/_.._OaT6fHfu.mjs");
var pageMap = /* @__PURE__ */ new Map([["src/pages/index.astro", _page0], ["src/pages/[...slug].astro", _page1]]);
//#endregion
//#region \0virtual:astro:manifest
var _manifest = deserializeManifest({"rootDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/","cacheDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/node_modules/.astro/","outDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/dist/","srcDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/","publicDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/public/","buildClientDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/dist/client/","buildServerDir":"file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/dist/server/","adapterName":"","assetsDir":"_astro","routes":[{"file":"","links":[],"scripts":[],"styles":[{"type":"inline","content":".atlas-graph[data-astro-cid-5zu2za2p]{background:var(--surface);border:1px solid var(--rule);border-radius:14px;margin:0;padding:.5rem;position:relative;overflow:hidden}.graph-bar[data-astro-cid-5zu2za2p]{justify-content:space-between;align-items:center;gap:.75rem;padding:.35rem .4rem .55rem;display:flex}.graph-search[data-astro-cid-5zu2za2p]{background:var(--paper);border:1px solid var(--rule);border-radius:999px;flex:auto;align-items:center;gap:.45rem;max-width:22rem;padding:.3rem .7rem;transition:border-color .15s;display:flex}.graph-search[data-astro-cid-5zu2za2p]:focus-within{border-color:var(--amber-soft)}.search-ic[data-astro-cid-5zu2za2p]{fill:none;width:13px;height:13px;stroke:var(--ink-faint);stroke-width:1.4px;stroke-linecap:round;flex:none}.graph-search[data-astro-cid-5zu2za2p] input[data-astro-cid-5zu2za2p]{min-width:0;font-family:var(--sans);color:var(--ink);background:0 0;border:0;outline:none;flex:auto;font-size:.85rem}.graph-search[data-astro-cid-5zu2za2p] input[data-astro-cid-5zu2za2p]::placeholder{color:var(--ink-faint)}.graph-bar-meta[data-astro-cid-5zu2za2p]{color:var(--ink-faint);flex:none;align-items:center;gap:.7rem;font-size:.62rem;display:inline-flex}.search-count[data-astro-cid-5zu2za2p]{letter-spacing:.06em;white-space:nowrap}.graph-reset[data-astro-cid-5zu2za2p]{font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);background:var(--paper);border:1px solid var(--rule);cursor:pointer;border-radius:999px;padding:.15rem .6rem;font-size:.6rem}.graph-reset[data-astro-cid-5zu2za2p]:hover{color:var(--amber);border-color:var(--amber-soft)}.graph-foot[data-astro-cid-5zu2za2p]{letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin:0;padding:.45rem .4rem .2rem;font-size:.58rem}.graph-svg[data-astro-cid-5zu2za2p]{touch-action:none;cursor:grab;width:100%;height:auto;max-height:78vh;display:block}.graph-svg[data-astro-cid-5zu2za2p]:active{cursor:grabbing}.edge[data-astro-cid-5zu2za2p]{stroke:var(--rule);stroke-width:1px;transition:opacity .18s}.edge[data-astro-cid-5zu2za2p].link{stroke-dasharray:2 3}.edge[data-astro-cid-5zu2za2p].moc{stroke:var(--rule);opacity:.45}.node[data-astro-cid-5zu2za2p]{cursor:pointer;transition:opacity .18s}.dot[data-astro-cid-5zu2za2p]{stroke-width:1.6px;transition:opacity .18s,filter .18s}.node[data-astro-cid-5zu2za2p]:hover .dot[data-astro-cid-5zu2za2p]{filter:brightness(1.06)}.c-red[data-astro-cid-5zu2za2p]{fill:var(--alert)}.c-teal[data-astro-cid-5zu2za2p]{fill:var(--teal)}.c-gold[data-astro-cid-5zu2za2p]{fill:var(--gold)}.c-grey[data-astro-cid-5zu2za2p]{fill:var(--ink-muted)}.c-green[data-astro-cid-5zu2za2p]{fill:var(--green)}.c-blue[data-astro-cid-5zu2za2p]{fill:#1f6feb}.c-purple[data-astro-cid-5zu2za2p]{fill:#7c3aed}.m-seedling[data-astro-cid-5zu2za2p]{stroke:var(--gold)}.m-budding[data-astro-cid-5zu2za2p]{stroke:var(--teal)}.m-evergreen[data-astro-cid-5zu2za2p]{stroke:var(--green)}.label[data-astro-cid-5zu2za2p]{fill:var(--ink-dim);font-family:var(--sans);text-anchor:middle;paint-order:stroke;stroke:var(--paper);stroke-width:3px;stroke-linejoin:round;opacity:0;pointer-events:none;font-size:8px;font-weight:600;transition:opacity .18s}.label-hub[data-astro-cid-5zu2za2p]{fill:var(--ink);opacity:1}.node[data-astro-cid-5zu2za2p]:hover .label[data-astro-cid-5zu2za2p]{opacity:1}.chip[data-astro-cid-5zu2za2p]{transition:filter .18s}.chip-label[data-astro-cid-5zu2za2p]{fill:#fff;font-family:var(--serif);text-anchor:middle;dominant-baseline:central;pointer-events:none;font-size:11px;font-weight:600}.node[data-astro-cid-5zu2za2p].moc:hover .chip[data-astro-cid-5zu2za2p]{filter:brightness(1.08)}.graph-svg[data-astro-cid-5zu2za2p].dim .node[data-astro-cid-5zu2za2p]{opacity:.14}.graph-svg[data-astro-cid-5zu2za2p].dim .node[data-astro-cid-5zu2za2p].on,.graph-svg[data-astro-cid-5zu2za2p].dim .node[data-astro-cid-5zu2za2p].on .label[data-astro-cid-5zu2za2p]{opacity:1}.graph-svg[data-astro-cid-5zu2za2p].dim .edge[data-astro-cid-5zu2za2p]{opacity:.04}.graph-svg[data-astro-cid-5zu2za2p].dim .edge[data-astro-cid-5zu2za2p].on{opacity:.85;stroke:var(--ink-faint)}@media (prefers-reduced-motion:reduce){.edge[data-astro-cid-5zu2za2p],.node[data-astro-cid-5zu2za2p],.dot[data-astro-cid-5zu2za2p],.label[data-astro-cid-5zu2za2p],.chip[data-astro-cid-5zu2za2p]{transition:none}}.moc-hubs[data-astro-cid-pyzg7dyc]{margin:2rem 0 0}.moc-grid[data-astro-cid-pyzg7dyc]{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start;gap:1rem;display:grid}.hub-card[data-astro-cid-pyzg7dyc]{background:var(--surface);border:1px solid var(--rule);border-left:3px solid var(--cat-color,var(--ink-muted));border-radius:12px;padding:1rem 1.1rem 1.1rem;transition:box-shadow .15s}.hub-card[data-astro-cid-pyzg7dyc]:hover{box-shadow:0 1px 0 var(--rule), 0 6px 20px -14px #1a1c2066}.hub-card[data-astro-cid-pyzg7dyc].is-moc{grid-column:span 2}@media (width<=660px){.hub-card[data-astro-cid-pyzg7dyc].is-moc{grid-column:span 1}}.cc-red[data-astro-cid-pyzg7dyc]{--cat-color:var(--alert)}.cc-teal[data-astro-cid-pyzg7dyc]{--cat-color:var(--teal)}.cc-gold[data-astro-cid-pyzg7dyc]{--cat-color:var(--gold)}.cc-grey[data-astro-cid-pyzg7dyc]{--cat-color:var(--ink-muted)}.cc-green[data-astro-cid-pyzg7dyc]{--cat-color:var(--green)}.cc-blue[data-astro-cid-pyzg7dyc]{--cat-color:#1f6feb}.cc-purple[data-astro-cid-pyzg7dyc]{--cat-color:#7c3aed}.hub-head[data-astro-cid-pyzg7dyc]{align-items:baseline;gap:.5rem;display:flex}.hub-bar[data-astro-cid-pyzg7dyc]{background:var(--cat-color);border-radius:3px;flex:none;align-self:center;width:8px;height:8px}.hub-title[data-astro-cid-pyzg7dyc]{font-family:var(--serif);letter-spacing:-.01em;color:var(--ink);font-size:1.15rem;font-weight:600;text-decoration:none}.hub-title[data-astro-cid-pyzg7dyc]:hover{color:var(--amber)}.hub-count[data-astro-cid-pyzg7dyc]{font-family:var(--mono);letter-spacing:.04em;color:var(--ink-faint);white-space:nowrap;flex:none;margin-left:auto;font-size:.6rem}.hub-desc[data-astro-cid-pyzg7dyc]{color:var(--ink-muted);margin:.5rem 0 .7rem;font-size:.82rem;line-height:1.45}.cluster[data-astro-cid-pyzg7dyc]{border-top:1px solid var(--rule-soft);gap:.05rem;margin:0;padding:.7rem 0 0;list-style:none;display:grid}.is-moc[data-astro-cid-pyzg7dyc] .cluster[data-astro-cid-pyzg7dyc]{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.05rem 1.4rem}.cluster-row[data-astro-cid-pyzg7dyc]{border-radius:6px;align-items:center;gap:.5rem;min-width:0;padding:.2rem .3rem;text-decoration:none;display:flex}.cluster-row[data-astro-cid-pyzg7dyc]:hover{background:var(--paper)}.cluster-row[data-astro-cid-pyzg7dyc]:hover .cluster-t[data-astro-cid-pyzg7dyc]{color:var(--amber)}.cluster-dot[data-astro-cid-pyzg7dyc]{border-radius:50%;flex:none;width:6px;height:6px}.cluster-dot[data-astro-cid-pyzg7dyc].m-seedling{background:var(--gold)}.cluster-dot[data-astro-cid-pyzg7dyc].m-budding{background:var(--teal)}.cluster-dot[data-astro-cid-pyzg7dyc].m-evergreen{background:var(--green)}.cluster-t[data-astro-cid-pyzg7dyc]{white-space:nowrap;text-overflow:ellipsis;max-width:100%;color:var(--ink-dim);flex:none;font-size:.84rem;font-weight:600;overflow:hidden}.cluster-d[data-astro-cid-pyzg7dyc]{white-space:nowrap;text-overflow:ellipsis;min-width:0;color:var(--ink-faint);flex:auto;font-size:.78rem;overflow:hidden}.wrap-index[data-astro-cid-lcdefpme]{max-width:64rem}.wrap-index[data-astro-cid-lcdefpme] .lede[data-astro-cid-lcdefpme]{max-width:44rem;margin-bottom:1.6rem}.graph-legend[data-astro-cid-lcdefpme]{border:1px solid var(--rule);background:var(--surface);border-radius:10px;flex-wrap:wrap;gap:.6rem 1.6rem;margin:0 0 1rem;padding:.7rem .9rem;display:flex}.legend-group[data-astro-cid-lcdefpme]{flex-wrap:wrap;align-items:center;gap:.4rem .9rem;display:inline-flex}.legend-cap[data-astro-cid-lcdefpme]{font-family:var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);font-size:.58rem}.legend-item[data-astro-cid-lcdefpme]{font-family:var(--mono);color:var(--ink-muted);align-items:center;gap:.4em;font-size:.66rem;display:inline-flex}.legend-swatch[data-astro-cid-lcdefpme]{border-radius:50%;width:9px;height:9px}.legend-swatch[data-astro-cid-lcdefpme].c-red{background:var(--alert)}.legend-swatch[data-astro-cid-lcdefpme].c-teal{background:var(--teal)}.legend-swatch[data-astro-cid-lcdefpme].c-gold{background:var(--gold)}.legend-swatch[data-astro-cid-lcdefpme].c-grey{background:var(--ink-muted)}.legend-swatch[data-astro-cid-lcdefpme].c-green{background:var(--green)}.legend-swatch[data-astro-cid-lcdefpme].c-blue{background:#1f6feb}.legend-swatch[data-astro-cid-lcdefpme].c-purple{background:#7c3aed}.legend-ring[data-astro-cid-lcdefpme]{background:var(--surface);border:1.5px solid var(--ink-faint);border-radius:50%;width:9px;height:9px}.legend-ring[data-astro-cid-lcdefpme].m-seedling{border-color:var(--gold)}.legend-ring[data-astro-cid-lcdefpme].m-budding{border-color:var(--teal)}.legend-ring[data-astro-cid-lcdefpme].m-evergreen{border-color:var(--green)}.legend-line[data-astro-cid-lcdefpme]{border-top:1.5px solid var(--ink-faint);width:16px;height:0}.legend-line[data-astro-cid-lcdefpme].dashed{border-top-style:dashed}.moc-head[data-astro-cid-lcdefpme]{border-bottom:1px solid var(--rule);margin:3rem 0 0;padding-bottom:.5rem}.moc-h[data-astro-cid-lcdefpme]{font-family:var(--serif);letter-spacing:-.01em;color:var(--ink);margin:0;font-size:1.5rem;font-weight:600}.moc-sub[data-astro-cid-lcdefpme]{max-width:42rem;color:var(--ink-muted);margin:.5rem 0 0;font-size:.9rem}.note-foot[data-astro-cid-lcdefpme]{border-top:1px solid var(--rule);justify-content:space-between;margin-top:4rem;padding-top:1.4rem;display:flex}\n:root{--paper:#f6f7f9;--surface:#fff;--ink:#1a1c20;--ink-dim:#3f444b;--ink-muted:#6b7178;--ink-faint:#9aa0a6;--rule:#e3e6ea;--rule-soft:#eceef1;--amber:#b4690e;--amber-soft:#f0e2c8;--teal:#0b6478;--green:#1b7a3a;--gold:#8a5200;--alert:#b42318;--code-bg:#eef1f4;--sans:ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;--serif:\"Iowan Old Style\", \"Palatino Linotype\", Palatino, Georgia, ui-serif, serif;--mono:ui-monospace, \"SF Mono\", \"JetBrains Mono\", \"Cascadia Code\", Menlo, monospace}*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;margin:0;font-size:17px;line-height:1.6}a{color:var(--amber);text-decoration:none}a:hover{text-decoration:underline}.wrap{max-width:46rem;margin:0 auto;padding:4rem 1.5rem 6rem}.mono{font-family:var(--mono)}.eyebrow{font-family:var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--ink-muted);margin:0;font-size:.72rem}.atlas-title{font-family:var(--serif);letter-spacing:-.01em;margin:.6rem 0 0;font-size:clamp(2.6rem,6vw,3.6rem);font-weight:600;line-height:1.05}.atlas-title .accent{color:var(--amber)}.lede{color:var(--ink-dim);max-width:40rem;margin:1rem 0 0;font-size:.95rem}.wrap-index{max-width:56rem}.legend{font-family:var(--mono);color:var(--ink-muted);flex-wrap:wrap;align-items:center;gap:.45rem 1.1rem;margin:.7rem 0 0;font-size:.66rem;display:flex}.legend-item{align-items:center;gap:.4em;display:inline-flex}.legend-dot{border-radius:50%;width:7px;height:7px;display:inline-block}.moc{margin:1.5rem 0 0;padding:0;list-style:none}.moc-sub{border-left:1px solid var(--rule);margin:.05rem 0 .2rem .55rem;padding-left:.8rem;list-style:none}.row{border-radius:6px;align-items:center;gap:.5rem;padding:.22rem .45rem;line-height:1.3;display:flex}.row:hover{background:var(--surface);text-decoration:none}.row:hover .row-t{color:var(--amber)}.row-dot{border-radius:50%;flex:none;width:7px;height:7px}.row-t{color:var(--ink);white-space:nowrap;flex:none;font-size:.95rem;font-weight:600}.row-d{color:var(--ink-muted);white-space:nowrap;text-overflow:ellipsis;flex:auto;min-width:0;font-size:.84rem;overflow:hidden}.row-rel{font-family:var(--mono);color:var(--ink-faint);margin:.02rem 0 .18rem 1.55rem;font-size:.64rem}.row-rel-lead{letter-spacing:.1em;text-transform:uppercase;margin-right:.45em}.row-rel a{color:var(--ink-muted)}.row-rel a:hover{color:var(--amber);text-decoration:none}.row-rel-sep{color:var(--rule);margin:0 .35em}.row-flag{font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;flex:none;font-size:.56rem}.row-flag.is-status{color:var(--ink-faint)}.row-flag.is-draft{color:var(--alert)}.m-seedling{background:var(--gold)}.m-budding{background:var(--teal)}.m-evergreen{background:var(--green)}.backlink{font-family:var(--mono);letter-spacing:.14em;color:var(--ink-muted);font-size:.72rem}.backlink:hover{color:var(--amber)}.note-h1{font-family:var(--serif);letter-spacing:-.01em;margin:1.6rem 0 0;font-size:clamp(2.1rem,5vw,3rem);font-weight:600;line-height:1.08}.meta-row{font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-muted);flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:1.1rem;font-size:.7rem;display:flex}.meta-sep{color:var(--ink-faint)}.note-sub{color:var(--ink-dim);margin-top:1.1rem}.note-foot{border-top:1px solid var(--rule);justify-content:space-between;margin-top:4rem;padding-top:1.4rem;display:flex}.prose{color:var(--ink-dim);counter-reset:kolu-footnote}.prose>:first-child{margin-top:0}.prose h2{font-family:var(--serif);color:var(--ink);letter-spacing:-.01em;margin:2.6rem 0 .8rem;font-size:1.6rem;font-weight:600}.prose h3{font-family:var(--serif);color:var(--ink);margin:2rem 0 .6rem;font-size:1.25rem;font-weight:600}.prose p{margin:0 0 1.1rem}.prose strong{color:var(--ink);font-weight:650}.prose em{font-style:italic}.prose ul,.prose ol{margin:0 0 1.2rem;padding-left:1.3rem}.prose li{margin:.35rem 0}.prose li::marker{color:var(--ink-faint)}.prose a{color:var(--amber);text-underline-offset:2px;text-decoration:underline 1px}.prose code{font-family:var(--mono);background:var(--code-bg);border:1px solid var(--rule);border-radius:5px;padding:.08em .35em;font-size:.86em}.prose pre{background:var(--code-bg);border:1px solid var(--rule);border-radius:10px;margin:0 0 1.3rem;padding:1rem 1.1rem;overflow-x:auto}.prose pre code{background:0 0;border:0;padding:0;font-size:.82rem}.prose blockquote{border-left:3px solid var(--amber-soft);color:var(--ink-dim);margin:1.3rem 0;padding:.2rem 0 .2rem 1.1rem}.prose blockquote p:last-child{margin-bottom:0}.prose hr{border:0;border-top:1px solid var(--rule);margin:2.4rem 0}.prose table{border-collapse:collapse;width:100%;margin:0 0 1.4rem;font-size:.9rem;display:block;overflow-x:auto}.prose th,.prose td{text-align:left;border:1px solid var(--rule);vertical-align:top;padding:.55rem .7rem}.prose th{background:var(--rule-soft);font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);font-size:.72rem;font-weight:600}\n"}],"routeData":{"route":"/","isIndex":true,"type":"page","pattern":"^\\/$","segments":[],"params":[],"component":"src/pages/index.astro","pathname":"/","prerender":true,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"inline","content":":root{--paper:#f6f7f9;--surface:#fff;--ink:#1a1c20;--ink-dim:#3f444b;--ink-muted:#6b7178;--ink-faint:#9aa0a6;--rule:#e3e6ea;--rule-soft:#eceef1;--amber:#b4690e;--amber-soft:#f0e2c8;--teal:#0b6478;--green:#1b7a3a;--gold:#8a5200;--alert:#b42318;--code-bg:#eef1f4;--sans:ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;--serif:\"Iowan Old Style\", \"Palatino Linotype\", Palatino, Georgia, ui-serif, serif;--mono:ui-monospace, \"SF Mono\", \"JetBrains Mono\", \"Cascadia Code\", Menlo, monospace}*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;margin:0;font-size:17px;line-height:1.6}a{color:var(--amber);text-decoration:none}a:hover{text-decoration:underline}.wrap{max-width:46rem;margin:0 auto;padding:4rem 1.5rem 6rem}.mono{font-family:var(--mono)}.eyebrow{font-family:var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--ink-muted);margin:0;font-size:.72rem}.atlas-title{font-family:var(--serif);letter-spacing:-.01em;margin:.6rem 0 0;font-size:clamp(2.6rem,6vw,3.6rem);font-weight:600;line-height:1.05}.atlas-title .accent{color:var(--amber)}.lede{color:var(--ink-dim);max-width:40rem;margin:1rem 0 0;font-size:.95rem}.wrap-index{max-width:56rem}.legend{font-family:var(--mono);color:var(--ink-muted);flex-wrap:wrap;align-items:center;gap:.45rem 1.1rem;margin:.7rem 0 0;font-size:.66rem;display:flex}.legend-item{align-items:center;gap:.4em;display:inline-flex}.legend-dot{border-radius:50%;width:7px;height:7px;display:inline-block}.moc{margin:1.5rem 0 0;padding:0;list-style:none}.moc-sub{border-left:1px solid var(--rule);margin:.05rem 0 .2rem .55rem;padding-left:.8rem;list-style:none}.row{border-radius:6px;align-items:center;gap:.5rem;padding:.22rem .45rem;line-height:1.3;display:flex}.row:hover{background:var(--surface);text-decoration:none}.row:hover .row-t{color:var(--amber)}.row-dot{border-radius:50%;flex:none;width:7px;height:7px}.row-t{color:var(--ink);white-space:nowrap;flex:none;font-size:.95rem;font-weight:600}.row-d{color:var(--ink-muted);white-space:nowrap;text-overflow:ellipsis;flex:auto;min-width:0;font-size:.84rem;overflow:hidden}.row-rel{font-family:var(--mono);color:var(--ink-faint);margin:.02rem 0 .18rem 1.55rem;font-size:.64rem}.row-rel-lead{letter-spacing:.1em;text-transform:uppercase;margin-right:.45em}.row-rel a{color:var(--ink-muted)}.row-rel a:hover{color:var(--amber);text-decoration:none}.row-rel-sep{color:var(--rule);margin:0 .35em}.row-flag{font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;flex:none;font-size:.56rem}.row-flag.is-status{color:var(--ink-faint)}.row-flag.is-draft{color:var(--alert)}.m-seedling{background:var(--gold)}.m-budding{background:var(--teal)}.m-evergreen{background:var(--green)}.backlink{font-family:var(--mono);letter-spacing:.14em;color:var(--ink-muted);font-size:.72rem}.backlink:hover{color:var(--amber)}.note-h1{font-family:var(--serif);letter-spacing:-.01em;margin:1.6rem 0 0;font-size:clamp(2.1rem,5vw,3rem);font-weight:600;line-height:1.08}.meta-row{font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-muted);flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:1.1rem;font-size:.7rem;display:flex}.meta-sep{color:var(--ink-faint)}.note-sub{color:var(--ink-dim);margin-top:1.1rem}.note-foot{border-top:1px solid var(--rule);justify-content:space-between;margin-top:4rem;padding-top:1.4rem;display:flex}.prose{color:var(--ink-dim);counter-reset:kolu-footnote}.prose>:first-child{margin-top:0}.prose h2{font-family:var(--serif);color:var(--ink);letter-spacing:-.01em;margin:2.6rem 0 .8rem;font-size:1.6rem;font-weight:600}.prose h3{font-family:var(--serif);color:var(--ink);margin:2rem 0 .6rem;font-size:1.25rem;font-weight:600}.prose p{margin:0 0 1.1rem}.prose strong{color:var(--ink);font-weight:650}.prose em{font-style:italic}.prose ul,.prose ol{margin:0 0 1.2rem;padding-left:1.3rem}.prose li{margin:.35rem 0}.prose li::marker{color:var(--ink-faint)}.prose a{color:var(--amber);text-underline-offset:2px;text-decoration:underline 1px}.prose code{font-family:var(--mono);background:var(--code-bg);border:1px solid var(--rule);border-radius:5px;padding:.08em .35em;font-size:.86em}.prose pre{background:var(--code-bg);border:1px solid var(--rule);border-radius:10px;margin:0 0 1.3rem;padding:1rem 1.1rem;overflow-x:auto}.prose pre code{background:0 0;border:0;padding:0;font-size:.82rem}.prose blockquote{border-left:3px solid var(--amber-soft);color:var(--ink-dim);margin:1.3rem 0;padding:.2rem 0 .2rem 1.1rem}.prose blockquote p:last-child{margin-bottom:0}.prose hr{border:0;border-top:1px solid var(--rule);margin:2.4rem 0}.prose table{border-collapse:collapse;width:100%;margin:0 0 1.4rem;font-size:.9rem;display:block;overflow-x:auto}.prose th,.prose td{text-align:left;border:1px solid var(--rule);vertical-align:top;padding:.55rem .7rem}.prose th{background:var(--rule-soft);font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);font-size:.72rem;font-weight:600}\n.toc-list[data-astro-cid-rda6bqd5]{margin:0;padding:0;list-style:none}.toc-item[data-astro-cid-rda6bqd5]{margin:.2rem 0}.toc-item[data-astro-cid-rda6bqd5] a[data-astro-cid-rda6bqd5]{color:var(--ink-dim);font-size:.92rem;text-decoration:none}.toc-item[data-astro-cid-rda6bqd5] a[data-astro-cid-rda6bqd5]:hover{color:var(--amber)}.toc-item[data-astro-cid-rda6bqd5] .toc-list[data-astro-cid-rda6bqd5]{border-left:1px solid var(--rule);margin:.15rem 0 .35rem .2rem;padding-left:.8rem}.toc-item[data-astro-cid-rda6bqd5] .toc-list[data-astro-cid-rda6bqd5] a[data-astro-cid-rda6bqd5]{color:var(--ink-muted);font-size:.85rem}.toc[data-astro-cid-7k3pnqyz]{border:1px solid var(--rule);background:var(--surface);border-radius:8px;margin:1.8rem 0;padding:.9rem 1.1rem}.toc-title[data-astro-cid-7k3pnqyz]{font-family:var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--ink-muted);margin:0 0 .5rem;font-size:.66rem}.backlinks[data-astro-cid-aziudkuj]{border-top:1px solid var(--rule);margin:2.5rem 0 0;padding-top:1.25rem}.backlinks-h[data-astro-cid-aziudkuj]{font-family:var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin:0 0 .7rem;font-size:.72rem;font-weight:650}.backlinks-list[data-astro-cid-aziudkuj]{flex-wrap:wrap;gap:.45rem 1rem;margin:0;padding:0;list-style:none;display:flex}.backlinks-list[data-astro-cid-aziudkuj] a[data-astro-cid-aziudkuj]{color:var(--ink-dim);border-bottom:1px solid var(--rule);font-size:.92rem;text-decoration:none}.backlinks-list[data-astro-cid-aziudkuj] a[data-astro-cid-aziudkuj]:hover{color:var(--amber);border-color:var(--amber)}\n"}],"routeData":{"route":"/[...slug]","isIndex":false,"type":"page","pattern":"^(?:\\/(.*?))?\\/?$","segments":[[{"content":"...slug","dynamic":true,"spread":true}]],"params":["...slug"],"component":"src/pages/[...slug].astro","prerender":true,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}}],"serverLike":false,"middlewareMode":"classic","base":"/","trailingSlash":"ignore","compressHTML":"jsx","componentMetadata":[["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/pages/[...slug].astro",{"propagation":"in-tree","containsHead":true}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/pages/index.astro",{"propagation":"in-tree","containsHead":true}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/agent-spawn-first-class.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/.astro/content-modules.mjs",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/content/runtime.js",{"propagation":"in-tree","containsHead":false}],["\u0000astro:content",{"propagation":"in-tree","containsHead":false}],["\u0000virtual:astro:page:src/pages/[...slug]@_@astro",{"propagation":"in-tree","containsHead":false}],["\u0000virtual:astro:pages",{"propagation":"in-tree","containsHead":false}],["\u0000virtual:astro:manifest",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/entrypoints/prerender.js",{"propagation":"in-tree","containsHead":false}],["\u0000virtual:astro:page:src/pages/index@_@astro",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/analysis.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/anyforge.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/app-thin-shell.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/awareness-derive-store.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/back-button-semantics.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/be-workflow.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-gateless-socket-squatter.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-remote-kaval-contract-skew.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-shiki-grammar-load-race.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/campaign-surface.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/canvas-tile-state-borders.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chrome-bar-declutter.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/cite-code-browser.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-browse-git-status.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-filter-empty-dirs.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/comparison.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/correctness-review.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/deep-links.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/dock-repo-identity.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/dynamic-workflow-viewer.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/e2e-graduation.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/electricity.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/feature.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/flaky-test-tracker.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/ghostex-vs-remote-terminals.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/graph-moc.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/grok-cli-support.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/hcom-vs-kolu.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/herdr-vs-kolu.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-isolation-locks.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-switch-ux.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-heap-oom.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-memory-architecture.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-sessions.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-skew-fix-design.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-vs-zmosh.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kolu-cli.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/llm-autonomy.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-footnotes.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-relative-links.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-wikilinks.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/meta.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-architecture-review.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-keybar-two-row.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-typecheck-gate.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-without-github.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-runner.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-web.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/opencode-perf.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/orchestrator-repo.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/p2p-kolu.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi-latency-baseline.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pedagogy.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/performance.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/phantom-running-background.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/port-preview.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pre-2.0-hardening.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pref-storm.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-chrome-bar.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-tui.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-tui.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web-mirror-health.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/reference.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/release-workflow.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-bind-parity.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-surfaces.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals-future.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/roadmap-graph.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/scrollback-backfill.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/session-timer-unref.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/shared-canvas.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sleeping-terminals.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-browser.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-fileview.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/split-active-pane.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/state-isolation.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/stdio-agent-lifetime.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sundry.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-app.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-attention-101.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-connection.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-daemon.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-101.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-lifetime-audit.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-live-data.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-map-101.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-mcp.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-reactive-bridge.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-reactor-engine.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-runtime-boundary.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-metadata-model.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-notes.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-teams.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/video-evidence.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/vorflux-manifesto.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/welcome-revamp.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}],["/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/xterm-kit.mdx?astroPropagatedAssets",{"propagation":"in-tree","containsHead":false}]],"renderers":[],"clientDirectives":[["idle","(()=>{var l=(n,t)=>{let i=async()=>{await(await n())()},e=typeof t.value==\"object\"?t.value:void 0,s={timeout:e==null?void 0:e.timeout};\"requestIdleCallback\"in window?window.requestIdleCallback(i,s):setTimeout(i,s.timeout||200)};(self.Astro||(self.Astro={})).idle=l;window.dispatchEvent(new Event(\"astro:idle\"));})();"],["load","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).load=e;window.dispatchEvent(new Event(\"astro:load\"));})();"],["media","(()=>{var n=(a,t)=>{let i=async()=>{await(await a())()};if(t.value){let e=matchMedia(t.value);e.matches?i():e.addEventListener(\"change\",i,{once:!0})}};(self.Astro||(self.Astro={})).media=n;window.dispatchEvent(new Event(\"astro:media\"));})();"],["only","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).only=e;window.dispatchEvent(new Event(\"astro:only\"));})();"],["visible","(()=>{var a=(s,i,o)=>{let r=async()=>{await(await s())()},t=typeof i.value==\"object\"?i.value:void 0,c={rootMargin:t==null?void 0:t.rootMargin},n=new IntersectionObserver(e=>{for(let l of e)if(l.isIntersecting){n.disconnect(),r();break}},c);for(let e of o.children)n.observe(e)};(self.Astro||(self.Astro={})).visible=a;window.dispatchEvent(new Event(\"astro:visible\"));})();"]],"entryModules":{"astro/entrypoints/prerender":"prerender-entry.ChuGtAXD.mjs","\u0000virtual:astro:page:src/pages/[...slug]@_@astro":"chunks/_.._OaT6fHfu.mjs","\u0000astro:data-layer-content":"chunks/_astro_data-layer-content_PB0Jfbds.mjs","\u0000noop-middleware":"chunks/_noop-middleware_CQ50ikAJ.mjs","\u0000virtual:astro:get-image":"chunks/_virtual_astro_get-image_DTetWjXe.mjs","\u0000virtual:astro:server-island-manifest":"chunks/_virtual_astro_server-island-manifest_C1Q2srgE.mjs","\u0000virtual:astro:session-driver":"chunks/_virtual_astro_session-driver_C-PI1Pas.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/agent-spawn-first-class.mdx":"chunks/agent-spawn-first-class_CFDkU8he.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/agent-spawn-first-class.mdx?astroPropagatedAssets":"chunks/agent-spawn-first-class_Cdo8wzU5.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/analysis.mdx?astroPropagatedAssets":"chunks/analysis_D6DuZKaQ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/analysis.mdx":"chunks/analysis_DG9PwkMW.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/anyforge.mdx":"chunks/anyforge_CqNR4jkD.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/anyforge.mdx?astroPropagatedAssets":"chunks/anyforge_XQjLJDX4.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/app-thin-shell.mdx":"chunks/app-thin-shell_DMTc94eY.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/app-thin-shell.mdx?astroPropagatedAssets":"chunks/app-thin-shell_DqQnbe13.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/awareness-derive-store.mdx":"chunks/awareness-derive-store_BnkulsvF.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/awareness-derive-store.mdx?astroPropagatedAssets":"chunks/awareness-derive-store_DRr-gxw4.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/back-button-semantics.mdx?astroPropagatedAssets":"chunks/back-button-semantics_CfNQiCg7.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/back-button-semantics.mdx":"chunks/back-button-semantics_DVPSsJ__.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/be-workflow.mdx":"chunks/be-workflow_B8rc7jei.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/be-workflow.mdx?astroPropagatedAssets":"chunks/be-workflow_CPaF7yvA.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-gateless-socket-squatter.mdx":"chunks/bug-gateless-socket-squatter_Bzhj-NGh.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-gateless-socket-squatter.mdx?astroPropagatedAssets":"chunks/bug-gateless-socket-squatter_D8hW5pR2.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-remote-kaval-contract-skew.mdx":"chunks/bug-remote-kaval-contract-skew_BLNuBe6Y.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-remote-kaval-contract-skew.mdx?astroPropagatedAssets":"chunks/bug-remote-kaval-contract-skew_BdonntlC.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-shiki-grammar-load-race.mdx":"chunks/bug-shiki-grammar-load-race_BYXP30ks.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-shiki-grammar-load-race.mdx?astroPropagatedAssets":"chunks/bug-shiki-grammar-load-race_DNynq0iW.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug.mdx":"chunks/bug_CNSrLQsp.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug.mdx?astroPropagatedAssets":"chunks/bug_clZUmXP9.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/campaign-surface.mdx?astroPropagatedAssets":"chunks/campaign-surface_BWnMI343.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/campaign-surface.mdx":"chunks/campaign-surface_DaohVg6t.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/canvas-tile-state-borders.mdx?astroPropagatedAssets":"chunks/canvas-tile-state-borders_B9JmwcJl.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/canvas-tile-state-borders.mdx":"chunks/canvas-tile-state-borders_BWA8LRuK.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx?astroPropagatedAssets":"chunks/chat-native-agents-and-kolu_Cl0NumES.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx":"chunks/chat-native-agents-and-kolu_hiruBUJ-.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chrome-bar-declutter.mdx?astroPropagatedAssets":"chunks/chrome-bar-declutter_BpFodHcm.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chrome-bar-declutter.mdx":"chunks/chrome-bar-declutter_pL2aIoAM.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/cite-code-browser.mdx?astroPropagatedAssets":"chunks/cite-code-browser_CUT15NNz.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/cite-code-browser.mdx":"chunks/cite-code-browser_k964hd-T.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-browse-git-status.mdx?astroPropagatedAssets":"chunks/code-tab-browse-git-status_4puJkIum.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-browse-git-status.mdx":"chunks/code-tab-browse-git-status_Ctuf0yWU.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-filter-empty-dirs.mdx?astroPropagatedAssets":"chunks/code-tab-filter-empty-dirs_D5K25OLZ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-filter-empty-dirs.mdx":"chunks/code-tab-filter-empty-dirs_Dd4deJnF.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/comparison.mdx?astroPropagatedAssets":"chunks/comparison_DKySkK4U.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/comparison.mdx":"chunks/comparison_T7ttXUsr.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/.astro/content-assets.mjs":"chunks/content-assets_DXqEyLLP.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/.astro/content-modules.mjs":"chunks/content-modules_BaBJmmhr.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/correctness-review.mdx?astroPropagatedAssets":"chunks/correctness-review_Bhb-arUP.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/correctness-review.mdx":"chunks/correctness-review_OTuqzxBA.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/deep-links.mdx":"chunks/deep-links_C7gxQset.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/deep-links.mdx?astroPropagatedAssets":"chunks/deep-links_t1CfTpLS.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/dock-repo-identity.mdx?astroPropagatedAssets":"chunks/dock-repo-identity_CXRnZ6S7.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/dock-repo-identity.mdx":"chunks/dock-repo-identity_q4QLI6YX.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/dynamic-workflow-viewer.mdx":"chunks/dynamic-workflow-viewer_D4rTFwwD.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/dynamic-workflow-viewer.mdx?astroPropagatedAssets":"chunks/dynamic-workflow-viewer_bAXZqsap.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/e2e-graduation.mdx":"chunks/e2e-graduation_BzE8jb6V.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/e2e-graduation.mdx?astroPropagatedAssets":"chunks/e2e-graduation_CYNe3EYG.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/electricity.mdx":"chunks/electricity_B2NgGtxG.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/electricity.mdx?astroPropagatedAssets":"chunks/electricity_CG7nyPZ6.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/feature.mdx?astroPropagatedAssets":"chunks/feature_B-EmW27C.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/feature.mdx":"chunks/feature_DVr2h7_8.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/flaky-test-tracker.mdx":"chunks/flaky-test-tracker_BMtBCm6v.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/flaky-test-tracker.mdx?astroPropagatedAssets":"chunks/flaky-test-tracker_E84HbH4U.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/ghostex-vs-remote-terminals.mdx?astroPropagatedAssets":"chunks/ghostex-vs-remote-terminals_CkxupeLw.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/ghostex-vs-remote-terminals.mdx":"chunks/ghostex-vs-remote-terminals_DhDDFcMC.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/graph-moc.mdx":"chunks/graph-moc_B9GedxB9.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/graph-moc.mdx?astroPropagatedAssets":"chunks/graph-moc_CkrKUpMy.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/grok-cli-support.mdx":"chunks/grok-cli-support_CL-No7VN.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/grok-cli-support.mdx?astroPropagatedAssets":"chunks/grok-cli-support_DL_bZb7c.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/hcom-vs-kolu.mdx?astroPropagatedAssets":"chunks/hcom-vs-kolu_BfDej9YE.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/hcom-vs-kolu.mdx":"chunks/hcom-vs-kolu_xikxmteM.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/herdr-vs-kolu.mdx?astroPropagatedAssets":"chunks/herdr-vs-kolu_B1UoV2g9.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/herdr-vs-kolu.mdx":"chunks/herdr-vs-kolu_kvlMKVNm.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-isolation-locks.mdx?astroPropagatedAssets":"chunks/host-isolation-locks_ChjGSl3O.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-isolation-locks.mdx":"chunks/host-isolation-locks_DNan0oSS.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-switch-ux.mdx":"chunks/host-switch-ux_-uFXj0KK.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-switch-ux.mdx?astroPropagatedAssets":"chunks/host-switch-ux_CWw5OHbS.mjs","\u0000virtual:astro:page:src/pages/index@_@astro":"chunks/index_Cfu_Ztn2.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-heap-oom.mdx?astroPropagatedAssets":"chunks/kaval-heap-oom_BJxe_iIB.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-heap-oom.mdx":"chunks/kaval-heap-oom_D6TycX-m.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-memory-architecture.mdx":"chunks/kaval-memory-architecture_BgasmuCw.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-memory-architecture.mdx?astroPropagatedAssets":"chunks/kaval-memory-architecture_BsJe1-6y.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-sessions.mdx":"chunks/kaval-sessions_ClFzxMJY.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-sessions.mdx?astroPropagatedAssets":"chunks/kaval-sessions_Dg5AHJI7.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-skew-fix-design.mdx":"chunks/kaval-skew-fix-design_BmJCkxkp.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-skew-fix-design.mdx?astroPropagatedAssets":"chunks/kaval-skew-fix-design_DSLLanHc.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-vs-zmosh.mdx":"chunks/kaval-vs-zmosh_Dx8HJZ9x.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-vs-zmosh.mdx?astroPropagatedAssets":"chunks/kaval-vs-zmosh_IlJFCWEu.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kolu-cli.mdx?astroPropagatedAssets":"chunks/kolu-cli_D2JKCm9v.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kolu-cli.mdx":"chunks/kolu-cli_DrXporSM.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/llm-autonomy.mdx?astroPropagatedAssets":"chunks/llm-autonomy_CeK8m0s6.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/llm-autonomy.mdx":"chunks/llm-autonomy_DMblOILD.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-footnotes.mdx?astroPropagatedAssets":"chunks/md-preview-footnotes_BibAuYYh.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-footnotes.mdx":"chunks/md-preview-footnotes_CN2XenTu.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-relative-links.mdx":"chunks/md-preview-relative-links_C3W3j9uG.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-relative-links.mdx?astroPropagatedAssets":"chunks/md-preview-relative-links_DdLYrZ66.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-wikilinks.mdx?astroPropagatedAssets":"chunks/md-preview-wikilinks_DjEN6yw_.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-wikilinks.mdx":"chunks/md-preview-wikilinks_DkiIpTn9.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/meta.mdx":"chunks/meta_CoE3iwyN.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/meta.mdx?astroPropagatedAssets":"chunks/meta_S4J_NGGj.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-architecture-review.mdx":"chunks/mobile-architecture-review_C_gvFguu.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-architecture-review.mdx?astroPropagatedAssets":"chunks/mobile-architecture-review_Cm30Y2vo.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-keybar-two-row.mdx?astroPropagatedAssets":"chunks/mobile-keybar-two-row_Cx2vwRtI.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-keybar-two-row.mdx":"chunks/mobile-keybar-two-row_DCBrLksw.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-typecheck-gate.mdx":"chunks/nix-typecheck-gate_CMDATeh0.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-typecheck-gate.mdx?astroPropagatedAssets":"chunks/nix-typecheck-gate_Uvr1Lscp.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-without-github.mdx?astroPropagatedAssets":"chunks/nix-without-github_C1Dfu9PL.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-without-github.mdx":"chunks/nix-without-github_C2VvLpx-.mjs","\u0000virtual:astro:actions/noop-entrypoint":"chunks/noop-entrypoint_Z3zFhrGC.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-runner.mdx?astroPropagatedAssets":"chunks/odu-runner_CJqn9CAy.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-runner.mdx":"chunks/odu-runner_DjGLJ_ae.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-web.mdx":"chunks/odu-web_DJYZ8leh.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-web.mdx?astroPropagatedAssets":"chunks/odu-web_DkPgBVes.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu.mdx?astroPropagatedAssets":"chunks/odu_CEfbwd2T.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu.mdx":"chunks/odu_D3gqSvd_.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/opencode-perf.mdx":"chunks/opencode-perf_DOUuFMfz.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/opencode-perf.mdx?astroPropagatedAssets":"chunks/opencode-perf_DkqtoIZl.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/orchestrator-repo.mdx":"chunks/orchestrator-repo_C4H71aQN.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/orchestrator-repo.mdx?astroPropagatedAssets":"chunks/orchestrator-repo_CdFLzs7L.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/p2p-kolu.mdx":"chunks/p2p-kolu_BPtld9qZ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/p2p-kolu.mdx?astroPropagatedAssets":"chunks/p2p-kolu_DfdGqWbU.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi-latency-baseline.mdx":"chunks/padi-latency-baseline_CyDTkoEd.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi-latency-baseline.mdx?astroPropagatedAssets":"chunks/padi-latency-baseline_dqgxSKug.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi.mdx?astroPropagatedAssets":"chunks/padi_F_n65K3C.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi.mdx":"chunks/padi_sTiKqI1w.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pedagogy.mdx":"chunks/pedagogy_2PmHpENx.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pedagogy.mdx?astroPropagatedAssets":"chunks/pedagogy_BDAt7Na1.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/performance.mdx?astroPropagatedAssets":"chunks/performance_C_WF2F8z.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/performance.mdx":"chunks/performance_q6La0FNn.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/phantom-running-background.mdx?astroPropagatedAssets":"chunks/phantom-running-background_BWg91jR2.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/phantom-running-background.mdx":"chunks/phantom-running-background_C9Pt-3rU.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/port-preview.mdx":"chunks/port-preview_BDDa2Ter.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/port-preview.mdx?astroPropagatedAssets":"chunks/port-preview_DiZeEI69.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pre-2.0-hardening.mdx":"chunks/pre-2.0-hardening_BwUdz4Zt.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pre-2.0-hardening.mdx?astroPropagatedAssets":"chunks/pre-2.0-hardening_c1be9Jya.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pref-storm.mdx?astroPropagatedAssets":"chunks/pref-storm_DmHZA0s9.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pref-storm.mdx":"chunks/pref-storm_M44N5HS7.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-chrome-bar.mdx?astroPropagatedAssets":"chunks/pty-daemon-chrome-bar_5CLikZJp.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-chrome-bar.mdx":"chunks/pty-daemon-chrome-bar_Df96L7Wu.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-tui.mdx":"chunks/pty-daemon-tui_BoDiSmNO.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-tui.mdx?astroPropagatedAssets":"chunks/pty-daemon-tui_Cvd29vVd.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon.mdx":"chunks/pty-daemon_BOLmO0qQ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon.mdx?astroPropagatedAssets":"chunks/pty-daemon_J1Hkmv7r.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-tui.mdx?astroPropagatedAssets":"chunks/pulam-tui_BiZqttmn.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-tui.mdx":"chunks/pulam-tui_DXB8WLnj.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web-mirror-health.mdx?astroPropagatedAssets":"chunks/pulam-web-mirror-health_CNGsN2v2.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web-mirror-health.mdx":"chunks/pulam-web-mirror-health_CSVNbEBY.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web.mdx?astroPropagatedAssets":"chunks/pulam-web_DJFU0aHk.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web.mdx":"chunks/pulam-web_DgmqOY1S.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam.mdx?astroPropagatedAssets":"chunks/pulam_B590fAJ3.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam.mdx":"chunks/pulam_DTBhABM4.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/reference.mdx":"chunks/reference_C0aQI26E.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/reference.mdx?astroPropagatedAssets":"chunks/reference_CHQt8iGk.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/release-workflow.mdx":"chunks/release-workflow_D26e1HAt.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/release-workflow.mdx?astroPropagatedAssets":"chunks/release-workflow_wjyssW6I.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-bind-parity.mdx?astroPropagatedAssets":"chunks/remote-bind-parity_BAgAzHV1.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-bind-parity.mdx":"chunks/remote-bind-parity_BPdOUxVg.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-surfaces.mdx?astroPropagatedAssets":"chunks/remote-surfaces_BnUpnFAg.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-surfaces.mdx":"chunks/remote-surfaces_q_qJNWof.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals-future.mdx?astroPropagatedAssets":"chunks/remote-terminals-future_9J3ERs2a.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals-future.mdx":"chunks/remote-terminals-future_BVuvMqmG.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals.mdx":"chunks/remote-terminals_7DYjTG4r.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals.mdx?astroPropagatedAssets":"chunks/remote-terminals_C7kRIvwq.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/roadmap-graph.mdx":"chunks/roadmap-graph_BtzGcZ0U.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/roadmap-graph.mdx?astroPropagatedAssets":"chunks/roadmap-graph_DPd_ZyXr.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/scrollback-backfill.mdx":"chunks/scrollback-backfill_CIIfRRnx.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/scrollback-backfill.mdx?astroPropagatedAssets":"chunks/scrollback-backfill_Jm6M2vUL.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/session-timer-unref.mdx":"chunks/session-timer-unref_DKjnQKNf.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/session-timer-unref.mdx?astroPropagatedAssets":"chunks/session-timer-unref_Ds-PoO4I.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/shared-canvas.mdx?astroPropagatedAssets":"chunks/shared-canvas_B9WUBI_C.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/shared-canvas.mdx":"chunks/shared-canvas_Cd516xId.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/assets/services/sharp.js":"chunks/sharp_dhWEsKeI.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sleeping-terminals.mdx":"chunks/sleeping-terminals_CCMThAt7.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sleeping-terminals.mdx?astroPropagatedAssets":"chunks/sleeping-terminals_CEURMPBj.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-browser.mdx":"chunks/solid-browser_4mHPbi39.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-browser.mdx?astroPropagatedAssets":"chunks/solid-browser_DBHOcfpj.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-fileview.mdx?astroPropagatedAssets":"chunks/solid-fileview_DQ8XQ6y0.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-fileview.mdx":"chunks/solid-fileview_DvhS8b9a.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/split-active-pane.mdx":"chunks/split-active-pane_0Y8y1MsK.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/split-active-pane.mdx?astroPropagatedAssets":"chunks/split-active-pane_DlA_ZhJU.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/state-isolation.mdx?astroPropagatedAssets":"chunks/state-isolation_B3iklVIh.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/state-isolation.mdx":"chunks/state-isolation_cAo-6WpV.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/stdio-agent-lifetime.mdx":"chunks/stdio-agent-lifetime_B-tVnLxZ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/stdio-agent-lifetime.mdx?astroPropagatedAssets":"chunks/stdio-agent-lifetime_CNpphm8k.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sundry.mdx?astroPropagatedAssets":"chunks/sundry_BkH3-uqP.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sundry.mdx":"chunks/sundry_CfzzhvS6.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-app.mdx":"chunks/surface-app_BLQ3-pMo.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-app.mdx?astroPropagatedAssets":"chunks/surface-app_Cj4cD9Nh.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-attention-101.mdx?astroPropagatedAssets":"chunks/surface-attention-101_CHmCW-66.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-attention-101.mdx":"chunks/surface-attention-101_DJ20atDY.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-connection.mdx?astroPropagatedAssets":"chunks/surface-connection_BwC5PF-z.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-connection.mdx":"chunks/surface-connection_CHYvRyPQ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-daemon.mdx?astroPropagatedAssets":"chunks/surface-daemon_B-x0HTjc.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-daemon.mdx":"chunks/surface-daemon_D3tIUHsU.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-101.mdx?astroPropagatedAssets":"chunks/surface-hosting-101_DvXt72qr.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-101.mdx":"chunks/surface-hosting-101_w2OR8rtG.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx?astroPropagatedAssets":"chunks/surface-hosting-roadblocks_D6mKC0d5.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx":"chunks/surface-hosting-roadblocks_DwFy1iCs.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-lifetime-audit.mdx?astroPropagatedAssets":"chunks/surface-lifetime-audit_BeWekwmY.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-lifetime-audit.mdx":"chunks/surface-lifetime-audit_DXn6DbVu.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-live-data.mdx":"chunks/surface-live-data_CFhGdFK0.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-live-data.mdx?astroPropagatedAssets":"chunks/surface-live-data_fryTjTgN.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-map-101.mdx?astroPropagatedAssets":"chunks/surface-map-101_B8-VZxr5.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-map-101.mdx":"chunks/surface-map-101_CPBhvrJe.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-mcp.mdx":"chunks/surface-mcp_BPF7zmrZ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-mcp.mdx?astroPropagatedAssets":"chunks/surface-mcp_DpxbKdg4.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-reactive-bridge.mdx?astroPropagatedAssets":"chunks/surface-reactive-bridge_BEVMo-Y1.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-reactive-bridge.mdx":"chunks/surface-reactive-bridge_DxOLdMOZ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-reactor-engine.mdx":"chunks/surface-reactor-engine_ACe1w7Ga.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-reactor-engine.mdx?astroPropagatedAssets":"chunks/surface-reactor-engine_BmNSKHoH.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-runtime-boundary.mdx?astroPropagatedAssets":"chunks/surface-runtime-boundary_BB33HCaf.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-runtime-boundary.mdx":"chunks/surface-runtime-boundary_DLMeH0PV.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface.mdx?astroPropagatedAssets":"chunks/surface_6ezWhHHM.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface.mdx":"chunks/surface_CxojV6Sw.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-metadata-model.mdx":"chunks/terminal-metadata-model_2n7MOr64.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-metadata-model.mdx?astroPropagatedAssets":"chunks/terminal-metadata-model_SMoXgW-T.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-notes.mdx":"chunks/terminal-notes_BZIh71qw.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-notes.mdx?astroPropagatedAssets":"chunks/terminal-notes_DfqeFgHZ.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-teams.mdx":"chunks/terminal-teams_Ah5a_3Db.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-teams.mdx?astroPropagatedAssets":"chunks/terminal-teams_BmKIAjiO.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/video-evidence.mdx":"chunks/video-evidence_C3AoVE8n.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/video-evidence.mdx?astroPropagatedAssets":"chunks/video-evidence_CsN44WLv.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/vorflux-manifesto.mdx?astroPropagatedAssets":"chunks/vorflux-manifesto_DbrpMtbp.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/vorflux-manifesto.mdx":"chunks/vorflux-manifesto_DmN9e4Re.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/welcome-revamp.mdx":"chunks/welcome-revamp_BsByv74Z.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/welcome-revamp.mdx?astroPropagatedAssets":"chunks/welcome-revamp_DatS0NTX.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/xterm-kit.mdx?astroPropagatedAssets":"chunks/xterm-kit_B10lRlDR.mjs","/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/xterm-kit.mdx":"chunks/xterm-kit_BPTejx8l.mjs","virtual:astro:noop":"_astro/_virtual_astro_noop.SBldSjMi.js","astro:scripts/before-hydration.js":""},"inlinedScripts":[],"assets":["/file:///home/srid/code/kolu/.worktrees/chat-1/docs/atlas/dist/index.html"],"buildFormat":"file","checkOrigin":false,"actionBodySizeLimit":1048576,"serverIslandBodySizeLimit":1048576,"allowedDomains":[],"key":"MUmWq4v8aOrKInXqr0+fmiIsuGQ1dMRDu3cjfGvroBc=","image":{},"devToolbar":{"enabled":false,"debugInfoOutput":""},"logLevel":"info","shouldInjectCspMetaTags":false});
var manifestRoutes = _manifest.routes;
var manifest = Object.assign(_manifest, {
	renderers,
	actions: () => import("./chunks/noop-entrypoint_Z3zFhrGC.mjs"),
	middleware: () => import("./chunks/_noop-middleware_CQ50ikAJ.mjs"),
	sessionDriver: () => import("./chunks/_virtual_astro_session-driver_C-PI1Pas.mjs"),
	serverIslandMappings: () => import("./chunks/_virtual_astro_server-island-manifest_C1Q2srgE.mjs"),
	routes: manifestRoutes,
	pageMap
});
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/vite-plugin-pages/const.js
var VIRTUAL_PAGE_RESOLVED_MODULE_ID = "\0virtual:astro:page:";
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/vite-plugin-pages/util.js
var ASTRO_PAGE_EXTENSION_POST_PATTERN = "@_@";
function getVirtualModulePageName(virtualModulePrefix, path) {
	const extension = fileExtension(path);
	return virtualModulePrefix + (extension.startsWith(".") ? path.slice(0, -extension.length) + extension.replace(".", ASTRO_PAGE_EXTENSION_POST_PATTERN) : path);
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/vite-plugin-scripts/index.js
var SCRIPT_ID_PREFIX = `astro:scripts/`;
var BEFORE_HYDRATION_SCRIPT_ID = `${SCRIPT_ID_PREFIX}before-hydration.js`;
var PAGE_SCRIPT_ID = `${SCRIPT_ID_PREFIX}page.js`;
`${SCRIPT_ID_PREFIX}`;
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/build/plugins/util.js
var ASTRO_PAGE_KEY_SEPARATOR = "&";
function makePageDataKey(route, componentPath) {
	return route + ASTRO_PAGE_KEY_SEPARATOR + componentPath;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/build/runtime.js
function getPageData(internals, route, component) {
	let pageData = internals.pagesByKeys.get(makePageDataKey(route, component));
	if (pageData) return pageData;
}
function cssOrder(a, b) {
	let depthA = a.depth, depthB = b.depth, orderA = a.order, orderB = b.order;
	if (orderA === -1 && orderB >= 0) return 1;
	else if (orderB === -1 && orderA >= 0) return -1;
	else if (orderA > orderB) return 1;
	else if (orderA < orderB) return -1;
	else if (depthA === -1) return -1;
	else if (depthB === -1) return 1;
	else return depthA > depthB ? -1 : 1;
}
function mergeInlineCss(acc, current) {
	const lastAdded = acc.at(acc.length - 1);
	const lastWasInline = lastAdded?.type === "inline";
	const currentIsInline = current?.type === "inline";
	if (lastWasInline && currentIsInline) {
		const currentHasImport = current.content.includes("@import");
		const lastHasImport = lastAdded.content.includes("@import");
		if (!currentHasImport && !lastHasImport) {
			const merged = {
				type: "inline",
				content: lastAdded.content + current.content
			};
			acc[acc.length - 1] = merged;
			return acc;
		}
	}
	acc.push(current);
	return acc;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/build/pipeline.js
var BuildPipeline = class BuildPipeline extends Pipeline {
	internals;
	options;
	manifest;
	defaultRoutes;
	getName() {
		return "BuildPipeline";
	}
	/**
	* This cache is needed to map a single `RouteData` to its file path.
	* @private
	*/
	#routesByFilePath = /* @__PURE__ */ new WeakMap();
	getSettings() {
		if (!this.options) throw new Error("No options defined");
		return this.options.settings;
	}
	getOptions() {
		if (!this.options) throw new Error("No options defined");
		return this.options;
	}
	getInternals() {
		if (!this.internals) throw new Error("No internals defined");
		return this.internals;
	}
	constructor(manifest, defaultRoutes = createDefaultRoutes(manifest)) {
		const resolveCache = /* @__PURE__ */ new Map();
		async function resolve(specifier) {
			if (resolveCache.has(specifier)) return resolveCache.get(specifier);
			const hashedFilePath = manifest.entryModules[specifier];
			if (typeof hashedFilePath !== "string" || hashedFilePath === "") {
				if (specifier === BEFORE_HYDRATION_SCRIPT_ID) {
					resolveCache.set(specifier, "");
					return "";
				}
				throw new Error(`Cannot find the built path for ${specifier}`);
			}
			const assetLink = createAssetLink(hashedFilePath, manifest.base, manifest.assetsPrefix);
			resolveCache.set(specifier, assetLink);
			return assetLink;
		}
		const logger = createConsoleLogger({ level: manifest.logLevel });
		super(logger, manifest, "production", manifest.renderers, resolve, manifest.serverLike);
		this.manifest = manifest;
		this.defaultRoutes = defaultRoutes;
	}
	getRoutes() {
		return this.getOptions().routesList.routes;
	}
	static create({ manifest }) {
		return new BuildPipeline(manifest);
	}
	setInternals(internals) {
		this.internals = internals;
	}
	setOptions(options) {
		this.options = options;
	}
	headElements(routeData) {
		const { manifest: { assetsPrefix, base } } = this;
		const settings = this.getSettings();
		const internals = this.getInternals();
		const links = /* @__PURE__ */ new Set();
		const pageBuildData = getPageData(internals, routeData.route, routeData.component);
		const scripts = /* @__PURE__ */ new Set();
		const sortedCssAssets = pageBuildData?.styles.sort(cssOrder).map(({ sheet }) => sheet).reduce(mergeInlineCss, []);
		const styles = createStylesheetElementSet(sortedCssAssets ?? [], base, assetsPrefix);
		if (settings.scripts.some((script) => script.stage === "page")) {
			const hashedFilePath = internals.entrySpecifierToBundleMap.get(PAGE_SCRIPT_ID);
			if (typeof hashedFilePath !== "string") throw new Error(`Cannot find the built path for ${PAGE_SCRIPT_ID}`);
			const src = createAssetLink(hashedFilePath, base, assetsPrefix);
			scripts.add({
				props: {
					type: "module",
					src
				},
				children: ""
			});
		}
		for (const script of settings.scripts) if (script.stage === "head-inline") scripts.add({
			props: {},
			children: script.content
		});
		return {
			scripts,
			styles,
			links
		};
	}
	componentMetadata() {}
	/**
	* It collects the routes to generate during the build.
	* It returns a map of page information and their relative entry point as a string.
	*/
	retrieveRoutesToGenerate() {
		const pages = /* @__PURE__ */ new Set();
		const defaultRouteComponents = new Set(this.defaultRoutes.map((route) => route.component));
		for (const { routeData } of this.manifest.routes) {
			if (routeIsRedirect(routeData)) {
				pages.add(routeData);
				continue;
			}
			if (routeIsFallback(routeData) && i18nHasFallback(this.manifest)) {
				pages.add(routeData);
				continue;
			}
			if (defaultRouteComponents.has(routeData.component)) continue;
			pages.add(routeData);
			const moduleSpecifier = getVirtualModulePageName(VIRTUAL_PAGE_RESOLVED_MODULE_ID, routeData.component);
			const filePath = this.internals?.entrySpecifierToBundleMap.get(moduleSpecifier);
			if (filePath) this.#routesByFilePath.set(routeData, filePath);
		}
		return pages;
	}
	async getComponentByRoute(routeData) {
		return (await this.getModuleForRoute(routeData)).page();
	}
	async getModuleForRoute(route) {
		for (const defaultRoute of this.defaultRoutes) if (route.component === defaultRoute.component) return { page: () => Promise.resolve(defaultRoute.instance) };
		let routeToProcess = route;
		if (routeIsRedirect(route)) if (route.redirectRoute) routeToProcess = route.redirectRoute;
		else return RedirectSinglePageBuiltModule;
		else if (routeIsFallback(route)) routeToProcess = getFallbackRoute(route, this.manifest.routes);
		if (this.manifest.pageMap) {
			const importComponentInstance = this.manifest.pageMap.get(routeToProcess.component);
			if (!importComponentInstance) throw new Error(`Unexpectedly unable to find a component instance for route ${route.route}`);
			return await importComponentInstance();
		} else if (this.manifest.pageModule) return this.manifest.pageModule;
		throw new Error("Astro couldn't find the correct page to render, probably because it wasn't correctly mapped for SSR usage. This is an internal error, please file an issue.");
	}
	async tryRewrite(payload, request) {
		const { routeData, pathname, newUrl } = findRouteToRewrite({
			payload,
			request,
			routes: this.manifest.routes.map((routeInfo) => routeInfo.routeData),
			trailingSlash: this.manifest.trailingSlash,
			buildFormat: this.manifest.buildFormat,
			base: this.manifest.base,
			outDir: this.manifest.serverLike ? this.manifest.buildClientDir : this.manifest.outDir
		});
		return {
			routeData,
			componentInstance: await this.getComponentByRoute(routeData),
			newUrl,
			pathname
		};
	}
};
function i18nHasFallback(manifest) {
	if (manifest.i18n && manifest.i18n.fallback) return Object.keys(manifest.i18n.fallback).length > 0;
	return false;
}
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/errors/build-handler.js
var BuildErrorHandler = class {
	#default;
	constructor(app) {
		this.#default = new DefaultErrorHandler(app);
	}
	async renderError(request, options) {
		if (options.status === 500) {
			if (options.response) return options.response;
			throw options.error;
		}
		return this.#default.renderError(request, {
			...options,
			prerenderedErrorPageFetch: void 0
		});
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/core/build/app.js
var BuildApp = class extends BaseApp {
	createPipeline(_streaming, manifest, ..._args) {
		return BuildPipeline.create({ manifest });
	}
	isDev() {
		return true;
	}
	setInternals(internals) {
		this.pipeline.setInternals(internals);
	}
	setOptions(options) {
		this.pipeline.setOptions(options);
		this.logger.setDestination(options.logger.options.destination);
		this.resetAdapterLogger();
	}
	getOptions() {
		return this.pipeline.getOptions();
	}
	getSettings() {
		return this.pipeline.getSettings();
	}
	createErrorHandler() {
		return new BuildErrorHandler(this);
	}
	logRequest(_options) {}
};
//#endregion
//#region node_modules/.pnpm/astro@7.1.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.2_@types+node@22.19.19_rollup@4.61.0_yaml@2.9.0/node_modules/astro/dist/entrypoints/prerender.js
var app = new BuildApp(manifest);
//#endregion
export { app, manifest };
