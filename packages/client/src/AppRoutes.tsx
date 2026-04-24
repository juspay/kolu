import type { Component } from "solid-js";
import { Navigate, Route } from "@solidjs/router";
import BoardPlaceholder from "./BoardPlaceholder";

/** Top-level app routes for the minimal Mani OS navigation slice. */
const AppRoutes: Component<{
  workspacePage: Component;
}> = (props) => (
  <>
    <Route path="/" component={() => <Navigate href="/workspace" />} />
    <Route path="/workspace" component={props.workspacePage} />
    <Route path="/board" component={BoardPlaceholder} />
  </>
);

export default AppRoutes;
