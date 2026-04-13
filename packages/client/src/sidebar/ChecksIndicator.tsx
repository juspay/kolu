/** Colored dot indicating CI check status (pass/pending/fail). */

import type { Component } from "solid-js";

const ChecksIndicator: Component<{
  status: "pass" | "pending" | "fail";
}> = (props) => (
  <span
    class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
    classList={{
      "bg-ok": props.status === "pass",
      "bg-warning animate-pulse": props.status === "pending",
      "bg-danger": props.status === "fail",
    }}
  />
);

export default ChecksIndicator;
