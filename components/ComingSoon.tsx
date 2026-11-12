import { PageHeader } from "./PageHeader";

/** Placeholder for app pages that are built in a later step. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader breadcrumb={title} title={title} />
      <div className="rounded-card border border-line bg-white px-[22px] py-[18px] text-sm text-slate shadow-card">
        Coming soon.
      </div>
    </>
  );
}
