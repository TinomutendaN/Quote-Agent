import { Sidebar } from "@/components/Sidebar";

// Shared layout for the five app pages: sidebar on the left (stacked on top
// at phone width) and the page content on the right.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-wrap bg-page text-ink">
      <Sidebar />
      <main className="box-border flex min-w-0 flex-[999_1_640px] flex-col gap-[18px] px-4 pt-[22px] pb-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}
