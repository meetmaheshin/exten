import DeveloperDetailClient from "./DeveloperDetailClient";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

export default function Page() {
  return <DeveloperDetailClient />;
}
