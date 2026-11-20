import { isDesktop } from "./useMobile";

export const supportsSpatialCanvas = () => isDesktop();

export const showsWorkspaceSwitcher = () => isDesktop();

export const showsAmbientTips = () => isDesktop();

export const showsWelcome = () => isDesktop();
