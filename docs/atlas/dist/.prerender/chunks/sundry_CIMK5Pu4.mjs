//#region src/content/atlas/sundry.mdx?astroPropagatedAssets
async function getMod() {
	return import("./sundry_CFP9Q3RX.mjs");
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
