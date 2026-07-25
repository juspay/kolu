/** The Inspector's **Forwarded Ports** group — the doors kolu is holding open,
 *  filtered to the host the inspected terminal is on.
 *
 *  Filtered rather than showing everything, and host rather than terminal: a
 *  forward is a fact about a MACHINE (a listener on kolu's own box pointed at a
 *  port on that machine), not about a tile. The tile that opened it can be closed
 *  while its server keeps running, and a forward opened from the ⌘K palette
 *  belongs to no tile at all — so filtering by terminal would hide rows the user
 *  is looking straight at. The host tab's dropdown shows the same rows for the
 *  same reason; this is that list, narrowed to the host in front of you.
 *
 *  It renders nothing when there are no forwards on this host, which is the
 *  ordinary case: a heading over an empty list would advertise a feature as
 *  broken rather than unused.
 */

import { type Component, Show } from "solid-js";
import Section from "../ui/Section";
import { activeHost } from "../wire";
import { ForwardRows } from "./ForwardRows";
import { forwardsForHost } from "./useForwards";

const ForwardedPortsSection: Component = () => {
  const forwards = () => forwardsForHost(activeHost());
  return (
    <Show when={forwards().length > 0}>
      <Section title="Forwarded Ports">
        <div data-testid="inspector-forwarded-ports">
          <ForwardRows forwards={forwards()} />
        </div>
      </Section>
    </Show>
  );
};

export default ForwardedPortsSection;
