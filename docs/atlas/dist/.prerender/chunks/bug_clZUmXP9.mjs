//#region src/content/atlas/bug.mdx?astroPropagatedAssets
async function getMod() {
	return import("./bug_CNSrLQsp.mjs");
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
