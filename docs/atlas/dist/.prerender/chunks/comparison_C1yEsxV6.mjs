//#region src/content/atlas/comparison.mdx?astroPropagatedAssets
async function getMod() {
	return import("./comparison_BdyktBvs.mjs");
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
