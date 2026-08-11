import { SelfCheck } from "./self-check";

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <SelfCheck />
    </main>
  );
}
