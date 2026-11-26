import { APP_NAME, WEIGHBRIDGE_ID } from "@trinetra/shared";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-5xl font-bold">{APP_NAME}</h1>
      <p className="text-2xl text-muted-foreground">
        Smart Weighbridge Prototype · {WEIGHBRIDGE_ID}
      </p>
    </main>
  );
}
