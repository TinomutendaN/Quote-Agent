"use client";

import { PlayIcon } from "@/components/Icon";
import { HeaderButton } from "@/components/PageHeader";
import { useRunDriver } from "@/components/RunDriver";

/** "Process inbox": starts the shared run, or shows the one already going or finished. */
export function ProcessInboxButton() {
  const driver = useRunDriver();
  return (
    <HeaderButton primary onClick={driver.processInbox} disabled={driver.starting}>
      <PlayIcon />
      {driver.starting ? "STARTING…" : "PROCESS INBOX"}
    </HeaderButton>
  );
}

/** A problem starting the run, shown under the page title. */
export function InboxNotice() {
  const { notice } = useRunDriver();
  if (!notice) return null;
  return (
    <p role="alert" className="m-0 text-sm font-medium text-warn-text">
      {notice}
    </p>
  );
}
