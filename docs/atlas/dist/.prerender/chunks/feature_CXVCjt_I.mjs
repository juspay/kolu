//#region src/content/atlas/feature.mdx?astroPropagatedAssets
async function getMod() {
	return import("./feature_DaMd_AWd.mjs");
}
var defaultMod = {
	__astroPropagation: true,
	getMod,
	collectedLinks: [],
	collectedStyles: [],
	collectedScripts: []
};
//#endregion
export { defaultMod as default };
