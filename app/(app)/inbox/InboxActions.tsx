"use client";

import { useRef } from "react";
import { Icon, PlayIcon } from "@/components/Icon";
import { HeaderButton } from "@/components/PageHeader";
import { UPLOAD_ACCEPT, useRunDriver } from "@/components/RunDriver";

/** "Add quotes": pick one file; the agent reads it straight away. */
export function AddQuotesButton() {
  const driver = useRunDriver();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        aria-label="Choose a quote file to add"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void driver.upload(file);
        }}
      />
      <HeaderButton onClick={() => input.current?.click()} disabled={driver.uploading}>
        <Icon name="plus" size={16} strokeWidth={2} />
        {driver.uploading ? "ADDING…" : "ADD QUOTES"}
      </HeaderButton>
    </>
  );
}

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
