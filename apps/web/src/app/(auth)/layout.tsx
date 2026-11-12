import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col p-6 md:p-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]" />
        <div className="relative max-w-md text-white">
          <p className="text-2xl font-semibold leading-snug">
            From requirement to signed release report, without leaving one app.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/85">
            <li>✓ AI drafts test cases. You approve.</li>
            <li>✓ Full traceability: requirement → test → run → bug → release.</li>
            <li>✓ Keyboard-first. Press ⌘K anywhere.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
