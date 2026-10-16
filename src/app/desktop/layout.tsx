import { DesktopEscape } from "@/components/productivity/desktop-escape";

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DesktopEscape />
      {children}
    </>
  );
}
