import { isRouteErrorResponse, useRouteError, Link, useLocation } from "react-router";
import { useEffect, useState } from "react";

/**
 * H-06 — route-level ErrorBoundary used by every panel + public layout route.
 * Contract:
 *  - 403/404/redirect-type responses keep their semantic (message shown as-is).
 *  - ANY other thrown value (loader/action bug, PostgREST error, network) is a
 *    500: the user sees a friendly page + a CORERR id; the id is logged to the
 *    console with route + timestamp so ops can correlate with server logs.
 *  - Never leaks stack traces to the user.
 */
export function RouteErrorBoundary({ backHref }: { backHref?: string }) {
  const error = useRouteError();
  const location = useLocation();
  const [correlationId] = useState(() => `CORERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`);

  useEffect(() => {
    if (isRouteErrorResponse(error) && (error.status === 403 || error.status === 404)) return;
    // server logs already carry the stack; client logs carry the correlation id
    console.error(`[${correlationId}] route=${location.pathname}`, error);
  }, [error, correlationId, location.pathname]);

  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title = status === 403 ? "لا تملك صلاحية الوصول" : status === 404 ? "الصفحة غير موجودة" : "حدث خطأ ما";
  const body =
    status === 403
      ? "هذه الصفحة مخصصة لفريق محدد. إن كنت تعتقد أن هذا خطأ فتواصل مع الدعم."
      : status === 404
        ? "الصفحة التي تبحث عنها غير موجودة أو تم نقلها."
        : "حدث خطأ غير متوقع في هذه الصفحة. سجّلنا الخطأ ومعرّفه أدناه — أعد المحاولة أو عد إلى الرئيسية.";

  return (
    <div role="alert" className="mx-auto my-10 w-full max-w-[560px] rounded-lg border border-border bg-surface p-6 text-center">
      <p className="num text-4xl font-black text-danger" dir="ltr">{status}</p>
      <h1 className="mt-2 text-lg font-extrabold text-text">{title}</h1>
      <p className="mt-2 text-[13px] text-text-muted">{body}</p>
      {status >= 500 ? (
        <p className="mt-3 rounded-md bg-surface-tint px-3 py-2 font-mono text-xs text-text-muted" dir="ltr">
          {correlationId}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {backHref ? (
          <Link to={backHref} className="inline-flex min-h-11 items-center rounded-md bg-action px-4 text-[13px] font-extrabold text-on-action hover:bg-action-hover">
            رجوع
          </Link>
        ) : null}
        <Link to="/" className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-[13px] font-extrabold text-text hover:bg-surface-tint">
          الرئيسية
        </Link>
      </div>
    </div>
  );
}
