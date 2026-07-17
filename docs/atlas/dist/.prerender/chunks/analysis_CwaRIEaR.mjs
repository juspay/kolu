//#region src/content/atlas/analysis.mdx?astroPropagatedAssets
async function getMod() {
	return import("./analysis_KOH-p9ca.mjs");
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
