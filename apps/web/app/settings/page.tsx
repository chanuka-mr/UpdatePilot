import { AgentControls } from "../../features/inventory/agent-controls";
import { Heading } from "../../components/ui/dashboard";

export default function Page() {
  return <>
    <Heading title="Agent Settings" description="Pair this Windows user, run scans, and check execution readiness for controlled updates." />
    <AgentControls />
  </>;
}
