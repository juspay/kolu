import { n as unflatten } from "./parse_CmKbeYJl.mjs";
import { c as isRemotePath, d as removeBase, u as prependForwardSlash } from "./path_CIT6-bQV.mjs";
import { A as createHeadAndContent, C as string, D as renderHead, I as createAstro, L as createComponent, O as addAttribute, P as unescapeHTML, R as escape, S as object, T as safeParseAsync, b as date, f as renderSlot, h as renderTemplate, i as renderUniqueStylesheet, n as spreadAttributes, r as renderScriptElement, s as renderComponent, v as generateCspDigest, y as array } from "./server_B0R_ZhRD.mjs";
import { V as RenderUndefinedEntryError, X as UnknownContentCollectionError, t as AstroError } from "./errors_Dw-ehuWW.mjs";
//#region node_modules/.pnpm/astro@7.0.0_@astrojs+markdown-remark@7.2.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@_6d72ccd6bfb38d123fb144d566dabb41/node_modules/astro/dist/assets/consts.js
var VALID_INPUT_FORMATS = [
	"jpeg",
	"jpg",
	"png",
	"tiff",
	"webp",
	"gif",
	"svg",
	"avif"
];
var VALID_SUPPORTED_FORMATS = [
	"jpeg",
	"jpg",
	"png",
	"tiff",
	"webp",
	"gif",
	"svg",
	"avif"
];
var DEFAULT_OUTPUT_FORMAT = "webp";
var DEFAULT_HASH_PROPS = [
	"src",
	"width",
	"height",
	"format",
	"quality",
	"fit",
	"position",
	"background"
];
//#endregion
//#region node_modules/.pnpm/neotraverse@0.6.18/node_modules/neotraverse/dist/modern/min/modern.js
var e = (e) => Object.prototype.toString.call(e), t = (e) => ArrayBuffer.isView(e) && !(e instanceof DataView), o = (t) => "[object Date]" === e(t), n = (t) => "[object RegExp]" === e(t), r = (t) => "[object Error]" === e(t), s = (t) => "[object Boolean]" === e(t), l = (t) => "[object Number]" === e(t), i = (t) => "[object String]" === e(t), c = Array.isArray, u = Object.getOwnPropertyDescriptor, a = Object.prototype.propertyIsEnumerable, f = Object.getOwnPropertySymbols, p = Object.prototype.hasOwnProperty, h = Object.keys;
function d(e) {
	const t = h(e), o = f(e);
	for (let n = 0; n < o.length; n++) a.call(e, o[n]) && t.push(o[n]);
	return t;
}
function b(e, t) {
	return !u(e, t)?.writable;
}
function y(e, u) {
	if ("object" == typeof e && null !== e) {
		let a;
		if (c(e)) a = [];
		else if (o(e)) a = new Date(e.getTime ? e.getTime() : e);
		else if (n(e)) a = new RegExp(e);
		else if (r(e)) a = { message: e.message };
		else if (s(e) || l(e) || i(e)) a = Object(e);
		else {
			if (t(e)) return e.slice();
			a = Object.create(Object.getPrototypeOf(e));
		}
		const f = u.includeSymbols ? d : h;
		for (const t of f(e)) a[t] = e[t];
		return a;
	}
	return e;
}
var g = {
	includeSymbols: !1,
	immutable: !1
};
function m(e, t, o = g) {
	const n = [], r = [];
	let s = !0;
	const l = o.includeSymbols ? d : h, i = !!o.immutable;
	return function e(u) {
		const a = i ? y(u, o) : u, f = {};
		let h = !0;
		const d = {
			node: a,
			node_: u,
			path: [].concat(n),
			parent: r[r.length - 1],
			parents: r,
			key: n[n.length - 1],
			isRoot: 0 === n.length,
			level: n.length,
			circular: void 0,
			isLeaf: !1,
			notLeaf: !0,
			notRoot: !0,
			isFirst: !1,
			isLast: !1,
			update: function(e, t = !1) {
				d.isRoot || (d.parent.node[d.key] = e), d.node = e, t && (h = !1);
			},
			delete: function(e) {
				delete d.parent.node[d.key], e && (h = !1);
			},
			remove: function(e) {
				c(d.parent.node) ? d.parent.node.splice(d.key, 1) : delete d.parent.node[d.key], e && (h = !1);
			},
			keys: null,
			before: function(e) {
				f.before = e;
			},
			after: function(e) {
				f.after = e;
			},
			pre: function(e) {
				f.pre = e;
			},
			post: function(e) {
				f.post = e;
			},
			stop: function() {
				s = !1;
			},
			block: function() {
				h = !1;
			}
		};
		if (!s) return d;
		function g() {
			if ("object" == typeof d.node && null !== d.node) {
				d.keys && d.node_ === d.node || (d.keys = l(d.node)), d.isLeaf = 0 === d.keys.length;
				for (let e = 0; e < r.length; e++) if (r[e].node_ === u) {
					d.circular = r[e];
					break;
				}
			} else d.isLeaf = !0, d.keys = null;
			d.notLeaf = !d.isLeaf, d.notRoot = !d.isRoot;
		}
		g();
		const m = t(d, d.node);
		if (void 0 !== m && d.update && d.update(m), f.before && f.before(d, d.node), !h) return d;
		if ("object" == typeof d.node && null !== d.node && !d.circular) {
			r.push(d), g();
			for (const [t, o] of Object.entries(d.keys ?? [])) {
				n.push(o), f.pre && f.pre(d, d.node[o], o);
				const r = e(d.node[o]);
				i && p.call(d.node, o) && !b(d.node, o) && (d.node[o] = r.node), r.isLast = !!d.keys?.length && +t == d.keys.length - 1, r.isFirst = 0 == +t, f.post && f.post(d, r), n.pop();
			}
			r.pop();
		}
		return f.after && f.after(d, d.node), d;
	}(e).node;
}
var j = class {
	#e;
	#t;
	constructor(e, t = g) {
		this.#e = e, this.#t = t;
	}
	get(e) {
		let t = this.#e;
		for (let o = 0; t && o < e.length; o++) {
			const n = e[o];
			if (!p.call(t, n) || !this.#t.includeSymbols && "symbol" == typeof n) return;
			t = t[n];
		}
		return t;
	}
	has(e) {
		let t = this.#e;
		for (let o = 0; t && o < e.length; o++) {
			const n = e[o];
			if (!p.call(t, n) || !this.#t.includeSymbols && "symbol" == typeof n) return !1;
			t = t[n];
		}
		return !0;
	}
	set(e, t) {
		let o = this.#e, n = 0;
		for (n = 0; n < e.length - 1; n++) {
			const t = e[n];
			p.call(o, t) || (o[t] = {}), o = o[t];
		}
		return o[e[n]] = t, t;
	}
	map(e) {
		return m(this.#e, e, {
			immutable: !0,
			includeSymbols: !!this.#t.includeSymbols
		});
	}
	forEach(e) {
		return this.#e = m(this.#e, e, this.#t), this.#e;
	}
	reduce(e, t) {
		const o = 1 === arguments.length;
		let n = o ? this.#e : t;
		return this.forEach(((t, r) => {
			t.isRoot && o || (n = e(t, n, r));
		})), n;
	}
	paths() {
		const e = [];
		return this.forEach(((t) => {
			e.push(t.path);
		})), e;
	}
	nodes() {
		const e = [];
		return this.forEach(((t) => {
			e.push(t.node);
		})), e;
	}
	clone() {
		const e = [], o = [], n = this.#t;
		return t(this.#e) ? this.#e.slice() : function t(r) {
			for (let t = 0; t < e.length; t++) if (e[t] === r) return o[t];
			if ("object" == typeof r && null !== r) {
				const s = y(r, n);
				e.push(r), o.push(s);
				const l = n.includeSymbols ? d : h;
				for (const e of l(r)) s[e] = t(r[e]);
				return e.pop(), o.pop(), s;
			}
			return r;
		}(this.#e);
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.0.0_@astrojs+markdown-remark@7.2.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@_6d72ccd6bfb38d123fb144d566dabb41/node_modules/astro/dist/assets/runtime.js
function createSvgComponent({ meta, attributes, children, styles }) {
	const hasStyles = styles.length > 0;
	const Component = createComponent({
		async factory(result, props) {
			const normalizedProps = normalizeProps(attributes, props);
			if (hasStyles && result.cspDestination) for (const style of styles) {
				const hash = await generateCspDigest(style, result.cspAlgorithm);
				result._metadata.extraStyleHashes.push(hash);
			}
			return renderTemplate`<svg${spreadAttributes(normalizedProps)}>${unescapeHTML(children)}</svg>`;
		},
		propagation: hasStyles ? "self" : "none"
	});
	Object.defineProperty(Component, "toJSON", {
		value: () => meta,
		enumerable: false
	});
	return Object.assign(Component, meta);
}
var ATTRS_TO_DROP = [
	"xmlns",
	"xmlns:xlink",
	"version"
];
var DEFAULT_ATTRS = {};
function dropAttributes(attributes) {
	for (const attr of ATTRS_TO_DROP) delete attributes[attr];
	return attributes;
}
function normalizeProps(attributes, props) {
	return dropAttributes({
		...DEFAULT_ATTRS,
		...attributes,
		...props
	});
}
var CONTENT_IMAGE_FLAG = "astroContentImageFlag";
var IMAGE_IMPORT_PREFIX = "__ASTRO_IMAGE_";
//#endregion
//#region node_modules/.pnpm/astro@7.0.0_@astrojs+markdown-remark@7.2.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@_6d72ccd6bfb38d123fb144d566dabb41/node_modules/astro/dist/assets/utils/resolveImports.js
function imageSrcToImportId(imageSrc, filePath) {
	imageSrc = removeBase(imageSrc, IMAGE_IMPORT_PREFIX);
	if (isRemotePath(imageSrc)) return;
	const ext = imageSrc.split(".").at(-1)?.toLowerCase();
	if (!ext || !VALID_INPUT_FORMATS.includes(ext)) return;
	const params = new URLSearchParams(CONTENT_IMAGE_FLAG);
	if (filePath) params.set("importer", filePath);
	return `${imageSrc}?${params.toString()}`;
}
//#endregion
//#region node_modules/.pnpm/astro@7.0.0_@astrojs+markdown-remark@7.2.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@_6d72ccd6bfb38d123fb144d566dabb41/node_modules/astro/dist/content/data-store.js
var ImmutableDataStore = class ImmutableDataStore {
	_collections = /* @__PURE__ */ new Map();
	constructor() {
		this._collections = /* @__PURE__ */ new Map();
	}
	get(collectionName, key) {
		return this._collections.get(collectionName)?.get(String(key));
	}
	entries(collectionName) {
		return [...(this._collections.get(collectionName) ?? /* @__PURE__ */ new Map()).entries()];
	}
	values(collectionName) {
		return [...(this._collections.get(collectionName) ?? /* @__PURE__ */ new Map()).values()];
	}
	keys(collectionName) {
		return [...(this._collections.get(collectionName) ?? /* @__PURE__ */ new Map()).keys()];
	}
	has(collectionName, key) {
		const collection = this._collections.get(collectionName);
		if (collection) return collection.has(String(key));
		return false;
	}
	hasCollection(collectionName) {
		return this._collections.has(collectionName);
	}
	collections() {
		return this._collections;
	}
	/**
	* Attempts to load a DataStore from the virtual module.
	* This only works in Vite.
	*/
	static async fromModule() {
		try {
			const data = await import("./_astro_data-layer-content_DcgP1wfP.mjs");
			if (data.default instanceof Map) return ImmutableDataStore.fromMap(data.default);
			const map = unflatten(data.default);
			return ImmutableDataStore.fromMap(map);
		} catch {}
		return new ImmutableDataStore();
	}
	static async fromMap(data) {
		const store = new ImmutableDataStore();
		store._collections = data;
		return store;
	}
};
function dataStoreSingleton() {
	let instance = void 0;
	return {
		get: async () => {
			if (!instance) instance = ImmutableDataStore.fromModule();
			return instance;
		},
		set: (store) => {
			instance = store;
		}
	};
}
var globalDataStore = dataStoreSingleton();
//#endregion
//#region node_modules/.pnpm/astro@7.0.0_@astrojs+markdown-remark@7.2.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@_6d72ccd6bfb38d123fb144d566dabb41/node_modules/astro/dist/content/loaders/errors.js
function formatZodError(error) {
	return error.issues.map((issue) => `  **${issue.path.join(".")}**: ${issue.message}`);
}
var LiveCollectionError = class LiveCollectionError extends Error {
	collection;
	message;
	cause;
	constructor(collection, message, cause) {
		super(message);
		this.collection = collection;
		this.message = message;
		this.cause = cause;
		this.name = "LiveCollectionError";
		if (cause?.stack) this.stack = cause.stack;
	}
	static is(error) {
		return error instanceof LiveCollectionError;
	}
};
var LiveEntryNotFoundError = class extends LiveCollectionError {
	constructor(collection, entryFilter) {
		super(collection, `Entry ${collection} \u2192 ${typeof entryFilter === "string" ? entryFilter : JSON.stringify(entryFilter)} was not found.`);
		this.name = "LiveEntryNotFoundError";
	}
	static is(error) {
		return error?.name === "LiveEntryNotFoundError";
	}
};
var LiveCollectionValidationError = class extends LiveCollectionError {
	constructor(collection, entryId, error) {
		super(collection, [
			`**${collection} \u2192 ${entryId}** data does not match the collection schema.
`,
			...formatZodError(error),
			""
		].join("\n"));
		this.name = "LiveCollectionValidationError";
	}
	static is(error) {
		return error?.name === "LiveCollectionValidationError";
	}
};
var LiveCollectionCacheHintError = class extends LiveCollectionError {
	constructor(collection, entryId, error) {
		super(collection, [
			`**${String(collection)}${entryId ? ` \u2192 ${String(entryId)}` : ""}** returned an invalid cache hint.
`,
			...formatZodError(error),
			""
		].join("\n"));
		this.name = "LiveCollectionCacheHintError";
	}
	static is(error) {
		return error?.name === "LiveCollectionCacheHintError";
	}
};
//#endregion
//#region node_modules/.pnpm/astro@7.0.0_@astrojs+markdown-remark@7.2.0_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@_6d72ccd6bfb38d123fb144d566dabb41/node_modules/astro/dist/content/runtime.js
var cacheHintSchema = object({
	tags: array(string()).optional(),
	lastModified: date().optional()
});
async function parseLiveEntry(entry, schema, collection) {
	try {
		const parsed = await safeParseAsync(schema, entry.data);
		if (!parsed.success) return { error: new LiveCollectionValidationError(collection, entry.id, parsed.error) };
		if (entry.cacheHint) {
			const cacheHint = cacheHintSchema.safeParse(entry.cacheHint);
			if (!cacheHint.success) return { error: new LiveCollectionCacheHintError(collection, entry.id, cacheHint.error) };
			entry.cacheHint = cacheHint.data;
		}
		return { entry: {
			...entry,
			data: parsed.data
		} };
	} catch (error) {
		return { error: new LiveCollectionError(collection, `Unexpected error parsing entry ${entry.id} in collection ${collection}`, error) };
	}
}
function createGetCollection({ liveCollections }) {
	return async function getCollection(collection, filter) {
		if (collection in liveCollections) throw new AstroError({
			...UnknownContentCollectionError,
			message: `Collection "${collection}" is a live collection. Use getLiveCollection() instead of getCollection().`
		});
		const hasFilter = typeof filter === "function";
		const store = await globalDataStore.get();
		if (store.hasCollection(collection)) {
			const { default: imageAssetMap } = await import("./content-assets_DXqEyLLP.mjs");
			const result = [];
			for (const rawEntry of store.values(collection)) {
				const data = updateImageReferencesInData(rawEntry.data, rawEntry.filePath, imageAssetMap);
				let entry = {
					...rawEntry,
					data,
					collection
				};
				if (hasFilter && !filter(entry)) continue;
				result.push(entry);
			}
			return result;
		} else {
			console.warn(`The collection ${JSON.stringify(collection)} does not exist or is empty. Please check your content config file for errors.`);
			return [];
		}
	};
}
function createGetEntry({ liveCollections }) {
	return async function getEntry(collectionOrLookupObject, lookup) {
		let collection, lookupId;
		if (typeof collectionOrLookupObject === "string") {
			collection = collectionOrLookupObject;
			if (!lookup) throw new AstroError({
				...UnknownContentCollectionError,
				message: "`getEntry()` requires an entry identifier as the second argument."
			});
			lookupId = lookup;
		} else {
			collection = collectionOrLookupObject.collection;
			lookupId = "id" in collectionOrLookupObject ? collectionOrLookupObject.id : collectionOrLookupObject.slug;
		}
		if (collection in liveCollections) throw new AstroError({
			...UnknownContentCollectionError,
			message: `Collection "${collection}" is a live collection. Use getLiveEntry() instead of getEntry().`
		});
		if (typeof lookupId === "object") throw new AstroError({
			...UnknownContentCollectionError,
			message: `The entry identifier must be a string. Received object.`
		});
		const store = await globalDataStore.get();
		if (store.hasCollection(collection)) {
			const entry = store.get(collection, lookupId);
			if (!entry) {
				console.warn(`Entry ${collection} → ${lookupId} was not found.`);
				return;
			}
			const { default: imageAssetMap } = await import("./content-assets_DXqEyLLP.mjs");
			const data = updateImageReferencesInData(entry.data, entry.filePath, imageAssetMap);
			const result = {
				...entry,
				data,
				collection
			};
			warnForPropertyAccess(result.data, "slug", `[content] Attempted to access deprecated property on "${collection}" entry.
The "slug" property is no longer automatically added to entries. Please use the "id" property instead.`);
			warnForPropertyAccess(result, "render", `[content] Invalid attempt to access "render()" method on "${collection}" entry.
To render an entry, use "render(entry)" from "astro:content".`);
			return result;
		}
	};
}
function warnForPropertyAccess(entry, prop, message) {
	if (!(prop in entry)) {
		let _value = void 0;
		Object.defineProperty(entry, prop, {
			get() {
				if (_value === void 0) console.error(message);
				return _value;
			},
			set(v) {
				_value = v;
			},
			enumerable: false
		});
	}
}
function createGetLiveCollection({ liveCollections }) {
	return async function getLiveCollection(collection, filter) {
		if (!(collection in liveCollections)) return { error: new LiveCollectionError(collection, `Collection "${collection}" is not a live collection. Use getCollection() instead of getLiveCollection() to load regular content collections.`) };
		try {
			const context = {
				filter,
				collection
			};
			const response = await liveCollections[collection].loader?.loadCollection?.(context);
			if (response && "error" in response) return { error: response.error };
			const { schema } = liveCollections[collection];
			let processedEntries = response.entries;
			if (schema) {
				const entryResults = await Promise.all(response.entries.map((entry) => parseLiveEntry(entry, schema, collection)));
				for (const result of entryResults) if (result.error) return { error: result.error };
				processedEntries = entryResults.map((result) => result.entry);
			}
			let cacheHint = response.cacheHint;
			if (cacheHint) {
				const cacheHintResult = cacheHintSchema.safeParse(cacheHint);
				if (!cacheHintResult.success) return { error: new LiveCollectionCacheHintError(collection, void 0, cacheHintResult.error) };
				cacheHint = cacheHintResult.data;
			}
			if (processedEntries.length > 0) {
				const entryTags = /* @__PURE__ */ new Set();
				let latestModified;
				for (const entry of processedEntries) if (entry.cacheHint) {
					if (entry.cacheHint.tags) entry.cacheHint.tags.forEach((tag) => entryTags.add(tag));
					if (entry.cacheHint.lastModified instanceof Date) {
						if (latestModified === void 0 || entry.cacheHint.lastModified > latestModified) latestModified = entry.cacheHint.lastModified;
					}
				}
				if (entryTags.size > 0 || latestModified || cacheHint) {
					const mergedCacheHint = {};
					if (cacheHint?.tags || entryTags.size > 0) mergedCacheHint.tags = [.../* @__PURE__ */ new Set([...cacheHint?.tags || [], ...entryTags])];
					if (cacheHint?.lastModified && latestModified) mergedCacheHint.lastModified = cacheHint.lastModified > latestModified ? cacheHint.lastModified : latestModified;
					else if (cacheHint?.lastModified || latestModified) mergedCacheHint.lastModified = cacheHint?.lastModified ?? latestModified;
					cacheHint = mergedCacheHint;
				}
			}
			return {
				entries: processedEntries,
				cacheHint
			};
		} catch (error) {
			return { error: new LiveCollectionError(collection, `Unexpected error loading collection ${collection}${error instanceof Error ? `: ${error.message}` : ""}`, error) };
		}
	};
}
function createGetLiveEntry({ liveCollections }) {
	return async function getLiveEntry(collection, lookup) {
		if (!(collection in liveCollections)) return { error: new LiveCollectionError(collection, `Collection "${collection}" is not a live collection. Use getCollection() instead of getLiveEntry() to load regular content collections.`) };
		try {
			const lookupObject = {
				filter: typeof lookup === "string" ? { id: lookup } : lookup,
				collection
			};
			let entry = await liveCollections[collection].loader?.loadEntry?.(lookupObject);
			if (entry && "error" in entry) return { error: entry.error };
			if (!entry) return { error: new LiveEntryNotFoundError(collection, lookup) };
			const { schema } = liveCollections[collection];
			if (schema) {
				const result = await parseLiveEntry(entry, schema, collection);
				if (result.error) return { error: result.error };
				entry = result.entry;
			}
			return {
				entry,
				cacheHint: entry.cacheHint
			};
		} catch (error) {
			return { error: new LiveCollectionError(collection, `Unexpected error loading entry ${collection} → ${typeof lookup === "string" ? lookup : JSON.stringify(lookup)}`, error) };
		}
	};
}
var CONTENT_LAYER_IMAGE_REGEX = /__ASTRO_IMAGE_="([^"]+)"/g;
async function updateImageReferencesInBody(html, fileName) {
	const { default: imageAssetMap } = await import("./content-assets_DXqEyLLP.mjs");
	const imageObjects = /* @__PURE__ */ new Map();
	const { getImage } = await import("./_virtual_astro_get-image_si3kLQ6I.mjs");
	for (const [_full, imagePath] of html.matchAll(CONTENT_LAYER_IMAGE_REGEX)) try {
		const decodedImagePath = JSON.parse(imagePath.replace(/&(?:#x22|quot);/g, "\"").replace(/&(?:#x27|apos);/g, "'"));
		let image;
		if (URL.canParse(decodedImagePath.src)) image = await getImage(decodedImagePath);
		else {
			const id = imageSrcToImportId(decodedImagePath.src, fileName);
			const imported = imageAssetMap.get(id);
			if (!id || imageObjects.has(id) || !imported) continue;
			image = await getImage({
				...decodedImagePath,
				src: imported
			});
		}
		imageObjects.set(imagePath, image);
	} catch {
		throw new Error(`Failed to parse image reference: ${imagePath}`);
	}
	return html.replaceAll(CONTENT_LAYER_IMAGE_REGEX, (full, imagePath) => {
		const image = imageObjects.get(imagePath);
		if (!image) return full;
		const { index, ...attributes } = image.attributes;
		return Object.entries({
			...attributes,
			src: image.src,
			srcset: image.srcSet.attribute
		}).filter(([, value]) => value != null).map(([key, value]) => value === "" ? `${key}=""` : `${key}="${escape(String(value))}"`).join(" ");
	});
}
function updateImageReferencesInData(data, fileName, imageAssetMap) {
	const copy = structuredClone(data);
	new j(copy).forEach(function(ctx, val) {
		if (typeof val === "string" && val.startsWith("__ASTRO_IMAGE_")) {
			const src = val.replace(IMAGE_IMPORT_PREFIX, "");
			const id = imageSrcToImportId(src, fileName);
			if (!id) {
				ctx.update(src);
				return;
			}
			const imported = imageAssetMap?.get(id);
			if (imported) if (imported.__svgData) {
				const { __svgData: svgData, ...meta } = imported;
				ctx.update(createSvgComponent({
					meta,
					...svgData
				}));
			} else ctx.update(imported);
			else ctx.update(src);
		}
	});
	return copy;
}
async function renderEntry(entry) {
	if (!entry) throw new AstroError(RenderUndefinedEntryError);
	if (entry.deferredRender) try {
		const { default: contentModules } = await import("./content-modules_SvICRTfI.mjs");
		const renderEntryImport = contentModules.get(entry.filePath);
		return render({
			collection: "",
			id: entry.id,
			renderEntryImport
		});
	} catch (e) {
		console.error(e);
	}
	const html = entry?.rendered?.metadata?.imagePaths?.length && entry.filePath ? await updateImageReferencesInBody(entry.rendered.html, entry.filePath) : entry?.rendered?.html;
	return {
		Content: createComponent(() => renderTemplate`${unescapeHTML(html)}`),
		headings: entry?.rendered?.metadata?.headings ?? [],
		remarkPluginFrontmatter: entry?.rendered?.metadata?.frontmatter ?? {}
	};
}
async function render({ collection, id, renderEntryImport }) {
	const UnexpectedRenderError = new AstroError({
		...UnknownContentCollectionError,
		message: `Unexpected error while rendering ${String(collection)} → ${String(id)}.`
	});
	if (typeof renderEntryImport !== "function") throw UnexpectedRenderError;
	const baseMod = await renderEntryImport();
	if (baseMod == null || typeof baseMod !== "object") throw UnexpectedRenderError;
	const { default: defaultMod } = baseMod;
	if (isPropagatedAssetsModule(defaultMod)) {
		const { collectedStyles, collectedLinks, collectedScripts, getMod } = defaultMod;
		if (typeof getMod !== "function") throw UnexpectedRenderError;
		const propagationMod = await getMod();
		if (propagationMod == null || typeof propagationMod !== "object") throw UnexpectedRenderError;
		return {
			Content: createComponent({
				factory(result, baseProps, slots) {
					let styles = "", links = "", scripts = "";
					if (Array.isArray(collectedStyles)) styles = collectedStyles.map((style) => {
						return renderUniqueStylesheet(result, {
							type: "inline",
							content: style
						});
					}).join("");
					if (Array.isArray(collectedLinks)) links = collectedLinks.map((link) => {
						return renderUniqueStylesheet(result, {
							type: "external",
							src: isRemotePath(link) ? link : prependForwardSlash(link)
						});
					}).join("");
					if (Array.isArray(collectedScripts)) scripts = collectedScripts.map((script) => renderScriptElement(script)).join("");
					let props = baseProps;
					if (id.endsWith("mdx")) props = {
						components: propagationMod.components ?? {},
						...baseProps
					};
					return createHeadAndContent(unescapeHTML(styles + links + scripts), renderTemplate`${renderComponent(result, "Content", propagationMod.Content, props, slots)}`);
				},
				propagation: "self"
			}),
			headings: propagationMod.getHeadings?.() ?? [],
			remarkPluginFrontmatter: propagationMod.frontmatter ?? {}
		};
	} else if (baseMod.Content && typeof baseMod.Content === "function") return {
		Content: baseMod.Content,
		headings: baseMod.getHeadings?.() ?? [],
		remarkPluginFrontmatter: baseMod.frontmatter ?? {}
	};
	else throw UnexpectedRenderError;
}
function isPropagatedAssetsModule(module) {
	return typeof module === "object" && module != null && "__astroPropagation" in module;
}
//#endregion
//#region \0astro:content
var liveCollections = {};
var getCollection = createGetCollection({ liveCollections });
createGetEntry({ liveCollections });
createGetLiveCollection({ liveCollections });
createGetLiveEntry({ liveCollections });
//#endregion
//#region src/components/FootnoteRuntime.astro
var $$FootnoteRuntime = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`<script>
  (function () {
    var fns = Array.prototype.slice.call(
      document.querySelectorAll(".fn[data-fn]"),
    );
    if (!fns.length) return;

    // Position an open popover: reset, measure, then pull it back inside the
    // viewport horizontally and flip it above the marker if it overflows below.
    function place(fn) {
      var pop = fn.querySelector(".fn-pop");
      if (!pop) return;
      pop.style.setProperty("--fn-x", "0px");
      pop.classList.remove("fn-pop-above");
      var r = pop.getBoundingClientRect();
      var pad = 8;
      var dx = 0;
      if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
      else if (r.left < pad) dx = pad - r.left;
      if (dx) pop.style.setProperty("--fn-x", dx + "px");
      if (r.bottom > window.innerHeight - pad) pop.classList.add("fn-pop-above");
    }

    function setPinned(fn, on) {
      fn.classList.toggle("is-pinned", on);
      var btn = fn.querySelector(".fn-ref");
      if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    }

    function unpinAll(except) {
      fns.forEach(function (fn) {
        if (fn !== except) setPinned(fn, false);
      });
    }

    fns.forEach(function (fn) {
      var btn = fn.querySelector(".fn-ref");
      if (!btn) return;
      // Place on reveal so the CSS-shown popover lands in the right spot.
      btn.addEventListener("pointerenter", function () {
        place(fn);
      });
      btn.addEventListener("focus", function () {
        place(fn);
      });
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var pin = !fn.classList.contains("is-pinned");
        unpinAll(fn);
        setPinned(fn, pin);
        if (pin) place(fn);
      });
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest(".fn[data-fn]")) unpinAll(null);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") unpinAll(null);
    });
    window.addEventListener("resize", function () {
      fns.forEach(function (fn) {
        if (fn.classList.contains("is-pinned")) place(fn);
      });
    });
  })();
<\/script>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/FootnoteRuntime.astro", void 0);
//#endregion
//#region src/layouts/AtlasLayout.astro
createAstro("https://astro.build");
var $$AtlasLayout = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$AtlasLayout;
	const { title, description = "kolu's in-repo knowledge base.", path = "", ogType = "website", pubDate } = Astro.props;
	const fullTitle = title === "Atlas" ? "the kolu Atlas" : `${title} · the kolu Atlas`;
	const SITE = "https://kolu.dev/atlas/";
	const ogUrl = SITE + path;
	const ogImage = `${SITE}og.png`;
	const ogAlt = "the kolu Atlas — an in-repo knowledge graph";
	return renderTemplate`<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${fullTitle}</title><meta name="description"${addAttribute(description, "content")}><meta name="generator"${addAttribute(Astro.generator, "content")}><meta name="color-scheme" content="light"><link rel="canonical"${addAttribute(ogUrl, "href")}><link rel="icon" type="image/svg+xml" href="./favicon.svg"><meta property="og:title"${addAttribute(fullTitle, "content")}><meta property="og:description"${addAttribute(description, "content")}><meta property="og:type"${addAttribute(ogType, "content")}><meta property="og:url"${addAttribute(ogUrl, "content")}><meta property="og:site_name" content="the kolu Atlas"><meta property="og:locale" content="en_US"><meta property="og:image"${addAttribute(ogImage, "content")}><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt"${addAttribute(ogAlt, "content")}>${ogType === "article" && pubDate && renderTemplate`<meta property="article:published_time"${addAttribute(pubDate.toISOString(), "content")}>`}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@sridca"><meta name="twitter:creator" content="@sridca"><meta name="twitter:title"${addAttribute(fullTitle, "content")}><meta name="twitter:description"${addAttribute(description, "content")}><meta name="twitter:image"${addAttribute(ogImage, "content")}><meta name="twitter:image:alt"${addAttribute(ogAlt, "content")}>${renderHead($$result)}</head><body>${renderSlot($$result, $$slots["default"])}${renderComponent($$result, "FootnoteRuntime", $$FootnoteRuntime, {})}</body></html>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/layouts/AtlasLayout.astro", void 0);
//#endregion
//#region src/lib/indexTree.ts
/** Normalize the `parents` frontmatter (one slug, a list, or absent) to a list.
*  Shared with the backlink graph (lib/atlasGraph) so both views read `parents`
*  the same way. */
var toParents = (p) => p === void 0 ? [] : Array.isArray(p) ? p : [p];
/** Resolve a note's `parents` to the ids of the notes it actually edges to: drop
*  self-references and parents that name no existing note. The edge semantics —
*  "a `parents` entry whose target exists is an edge; self/missing drops" — live
*  here once, so the graph view and the backlink graph agree on what an edge is. */
var resolveParents = (noteById, note) => toParents(note.data.parents).filter((pid) => pid !== note.id && noteById.has(pid));
var titleCmp = (a, b) => a.localeCompare(b, "en-US");
/** Project a note id to its renderable {id, title} ref via the id→note map.
*  Shared by the graph view and the backlink graph, which build the same ref the
*  same way. */
var toRef = (byId, id) => ({
	id,
	title: byId.get(id).data.title
});
//#endregion
//#region src/lib/atlasGraph.ts
var NOTE_LINK = /\]\((?:\.\/)?([a-z0-9-]+)\.html(?:#[a-z0-9-]+)?\)/g;
var GENERATED_PAGES = /* @__PURE__ */ new Set(["index"]);
function stripCode(md) {
	return md.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}
/** Invert the note-to-note link graph: for each note, the set of notes that link
*  to it — via a same-directory `slug.html` prose link (with or without `./`) or
*  a `parents` edge. Reuses the edges the Atlas already has rather than a
*  hand-maintained `backlinks:` field.
*
*  Fail-fast: a prose link to a `slug.html` that names no note is a build
*  error — a dead internal link must surface here, not 404 silently in the
*  committed dist. `index.html` is the generated index, not a note, so it's
*  exempt. (A dangling `parents` stays lenient, as the index intends: an unknown
*  parent just drops to a root — membership is never blocked by a typo.) */
function buildAtlasGraph(notes) {
	const byId = new Map(notes.map((n) => [n.id, n]));
	const inbound = /* @__PURE__ */ new Map();
	const link = (target, source) => {
		if (target === source) return;
		let sources = inbound.get(target);
		if (!sources) {
			sources = /* @__PURE__ */ new Set();
			inbound.set(target, sources);
		}
		sources.add(source);
	};
	const edgeByPair = /* @__PURE__ */ new Map();
	const addEdge = (source, target, kind) => {
		if (source === target) return;
		const key = source < target ? `${source} ${target}` : `${target} ${source}`;
		const e = edgeByPair.get(key);
		if (!e) edgeByPair.set(key, {
			source,
			target,
			kind
		});
		else if (kind === "parent") e.kind = "parent";
	};
	for (const n of notes) {
		for (const m of stripCode(n.body ?? "").matchAll(NOTE_LINK)) {
			const target = m[1];
			if (GENERATED_PAGES.has(target)) continue;
			if (!byId.has(target)) throw new Error(`Atlas dead link: ${n.id}.mdx links to ${target}.html, but no note has that slug. Fix the link or rename the target.`);
			link(target, n.id);
			addEdge(n.id, target, "link");
		}
		for (const pid of resolveParents(byId, n)) {
			link(pid, n.id);
			addEdge(n.id, pid, "parent");
		}
	}
	const byTitle = (a, b) => titleCmp(a.title, b.title);
	const backlinks = /* @__PURE__ */ new Map();
	for (const [target, sources] of inbound) backlinks.set(target, [...sources].map((id) => toRef(byId, id)).sort(byTitle));
	const edges = [...edgeByPair.values()];
	const degree = /* @__PURE__ */ new Map();
	for (const e of edges) {
		degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
		degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
	}
	return {
		backlinks,
		edges,
		degree
	};
}
//#endregion
export { getCollection as a, DEFAULT_OUTPUT_FORMAT as c, $$AtlasLayout as i, VALID_SUPPORTED_FORMATS as l, resolveParents as n, renderEntry as o, titleCmp as r, DEFAULT_HASH_PROPS as s, buildAtlasGraph as t };
