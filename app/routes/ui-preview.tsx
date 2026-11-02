import { useState } from "react";
import type { Route } from "./+types/ui-preview";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { SkeletonPage } from "~/components/ui/Skeleton";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardBody,
  CardHeader,
  Combobox,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  FileUpload,
  Input,
  PriceTag,
  Rating,
  Select,
  Skeleton,
  SkeletonCard,
  Stepper,
  Table,
  Tabs,
  TCell,
  Timeline,
  ToastProvider,
  TRow,
  useToast,
} from "~/components/ui";

export async function loader({ params }: Route.LoaderArgs) {
  return { lang: requireLang(params) };
}

/**
 * UI primitives preview (F-04): all 20 components with their states,
 * tokens only, RTL-verified. noindex (internal tooling page).
 */
export default function UiPreview({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <ToastProvider>
      <div className="mx-auto w-full max-w-page px-4 py-6">
        <meta name="robots" content="noindex, nofollow" />
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-text">{t("ui.title")}</h1>
            <p className="text-[13px] text-text-muted">{t("ui.subtitle")}</p>
          </div>
          <LanguageSwitch current={loaderData.lang} />
        </header>
        <Sections />
      </div>
    </ToastProvider>
  );
}

function Sections() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [combo, setCombo] = useState<string | null>(null);
  const [rating, setRating] = useState(3.5);
  const toast = useToast();

  return (
    <div className="flex flex-col gap-6">
      <Section title={t("ui.section.actions")}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">{t("ui.button.primary")}</Button>
          <Button variant="outline">{t("ui.button.outline")}</Button>
          <Button variant="ghost">{t("ui.button.ghost")}</Button>
          <Button variant="dark">{t("ui.button.dark")}</Button>
          <Button loading>{t("ui.button.loading")}</Button>
          <Button disabled>{t("ui.button.disabled")}</Button>
          <Button size="sm">{t("ui.button.primary")}</Button>
          <Button size="lg">{t("ui.button.primary")}</Button>
        </div>
      </Section>

      <Section title={t("ui.section.inputs")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label={t("ui.input.label")} placeholder={t("ui.input.placeholder")} />
          <Input label={t("ui.input.withError")} error={t("ui.input.errorText")} defaultValue="x" />
          <Input label={t("ui.input.disabled")} disabled placeholder={t("ui.input.placeholder")} />
          <Input label={t("auth.login.password")} type="password" showPasswordToggle defaultValue="secret123" />
        </div>
      </Section>

      <Section title={t("ui.section.selection")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t("ui.select.label")}
            options={[
              { value: "ar", label: t("common.arabic") },
              { value: "en", label: t("common.english") },
            ]}
          />
          <Combobox
            label={t("ui.combobox.label")}
            value={combo}
            onChange={setCombo}
            options={[
              { value: "cairo", label: "القاهرة — Cairo" },
              { value: "giza", label: "الجيزة — Giza" },
              { value: "alex", label: "الإسكندرية — Alexandria" },
              { value: "luxor", label: "الأقصر — Luxor" },
            ]}
          />
        </div>
      </Section>

      <Section title={t("ui.section.overlays")}>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setDialogOpen(true)}>{t("ui.dialog.open")}</Button>
          <Button variant="outline" onClick={() => setDrawerOpen(true)}>
            {t("ui.drawer.open")}
          </Button>
        </div>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={t("ui.dialog.title")}>
          <p className="text-sm text-text-muted">{t("ui.dialog.body")}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => setDialogOpen(false)}>{t("common.confirm")}</Button>
          </div>
        </Dialog>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t("ui.drawer.title")}>
          <p className="text-sm text-text-muted">{t("ui.dialog.body")}</p>
        </Drawer>
      </Section>

      <Section title={t("ui.section.navigation")}>
        <div className="flex flex-col gap-5">
          <Tabs
            items={[
              { id: "1", label: t("ui.tabs.first"), content: t("ui.tabs.panel1") },
              { id: "2", label: t("ui.tabs.second"), content: t("ui.tabs.panel2") },
              { id: "3", label: t("ui.tabs.third"), content: t("ui.tabs.panel3") },
            ]}
          />
          <div>
            <p className="mb-2 text-[13px] font-bold text-text">{t("ui.stepper.label")}</p>
            <Stepper
              label={t("ui.stepper.label")}
              current={1}
              steps={[t("ui.stepper.step1"), t("ui.stepper.step2"), t("ui.stepper.step3"), t("ui.stepper.step4")]}
            />
          </div>
          <Breadcrumbs
            label={t("ui.breadcrumbs.label")}
            items={[{ label: t("common.home"), href: "#" }, { label: t("nav.categories"), href: "#" }, { label: t("ui.title") }]}
          />
        </div>
      </Section>

      <Section title={t("ui.section.display")}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{t("ui.badge.neutral")}</Badge>
          <Badge tone="success">{t("ui.badge.success")}</Badge>
          <Badge tone="warning">{t("ui.badge.warning")}</Badge>
          <Badge tone="danger">{t("ui.badge.danger")}</Badge>
          <Badge tone="info">{t("ui.badge.info")}</Badge>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title={t("ui.card.title")} />
            <CardBody>
              <p className="text-[13px] text-text-muted">{t("ui.card.body")}</p>
            </CardBody>
          </Card>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-[13px] font-bold text-text">{t("ui.rating.label")}</p>
              <Rating value={rating} onChange={setRating} />
            </div>
            <div>
              <p className="mb-1 text-[13px] font-bold text-text">{t("ui.price.label")}</p>
              <div className="flex flex-col gap-2">
                <PriceTag pricePiastres={125000} locale="ar" />
                <PriceTag pricePiastres={99900} comparePricePiastres={149900} locale="ar" />
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("ui.section.feedback")}>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => toast.showToast("success", t("ui.badge.success"))}>
            {t("ui.toast.success")}
          </Button>
          <Button variant="outline" onClick={() => toast.showToast("error", t("ui.badge.danger"))}>
            {t("ui.toast.error")}
          </Button>
          <Button variant="outline" onClick={() => toast.showToast("info", t("ui.badge.info"))}>
            {t("ui.toast.info")}
          </Button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-bold text-text">{t("ui.skeleton.label")}</p>
            <SkeletonCard />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <EmptyState title={t("ui.empty.title")} body={t("ui.empty.body")} action={<Button size="sm">{t("ui.empty.action")}</Button>} />
        </div>
      </Section>

      <Section title={t("ui.section.data")}>
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-[13px] font-bold text-text">{t("ui.table.title")}</p>
            <Table columns={[t("admin.users.name"), t("admin.users.role")]} caption={t("a11y.tableCaption")}>
              <TRow>
                <TCell>Admin</TCell>
                <TCell>
                  <Badge tone="danger">admin</Badge>
                </TCell>
              </TRow>
              <TRow>
                <TCell>Vendor</TCell>
                <TCell>
                  <Badge>vendor</Badge>
                </TCell>
              </TRow>
            </Table>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-bold text-text">{t("ui.datatable.title")}</p>
            <DataTable
              rows={[
                { id: "1", name: "أحمد محمود", email: "ahmed@example.com", role: "customer" },
                { id: "2", name: "Sara Ali", email: "sara@example.com", role: "vendor" },
                { id: "3", name: "منى سعيد", email: "mona@example.com", role: "staff" },
              ]}
              columns={[
                { key: "name", header: t("admin.users.name"), render: (row) => row.name, text: (row) => row.name },
                { key: "email", header: t("admin.users.email"), render: (row) => row.email, text: (row) => row.email },
                { key: "role", header: t("admin.users.role"), render: (row) => <Badge>{row.role}</Badge>, text: (row) => row.role },
              ]}
              rowKey={(row) => row.id}
              searchPlaceholder={t("ui.datatable.search")}
              emptyTitle={t("admin.users.empty")}
              emptyBody={t("ui.empty.body")}
              cardTitle={(row) => row.name}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FileUpload
              label={t("ui.fileupload.label")}
              onPick={() => toast.showToast("success", t("ui.badge.success"))}
              onError={(message) => toast.showToast("error", message)}
            />
            <div>
              <p className="mb-2 text-[13px] font-bold text-text">{t("ui.timeline.label")}</p>
              <Timeline
                label={t("ui.timeline.label")}
                steps={[
                  { label: t("ui.timeline.step1"), state: "done", meta: "10:00" },
                  { label: t("ui.timeline.step2"), state: "done", meta: "12:30" },
                  { label: t("ui.timeline.step3"), state: "current" },
                  { label: t("ui.timeline.step4"), state: "pending" },
                ]}
              />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** H-24: stable hydrate fallback. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
