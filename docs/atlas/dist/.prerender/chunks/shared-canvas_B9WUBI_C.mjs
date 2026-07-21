//#region src/content/atlas/shared-canvas.mdx?astroPropagatedAssets
async function getMod() {
	return import("./shared-canvas_Cd516xId.mjs");
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
