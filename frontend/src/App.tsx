import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Clock4,
  Copy,
  Database,
  Filter,
  Github,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Star,
  Terminal,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

import { api } from "./api";
import type {
  AppConfig,
  Repo,
  RepoStatus,
  SecretsMeta,
  StatusResponse,
  Strategy,
} from "./types";

type Tab = "repos" | "status" | "settings";
type SettingsTab = "crawl" | "providers" | "agent" | "notify";
type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive";
type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "muted";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");
const REPOS_VIEW_STATE_KEY = "reporadar.repos.view-state";
const SETTINGS_TAB_STATE_KEY = "reporadar.settings.active-tab";

const statusOptions: Array<{ value: RepoStatus; label: string }> = [
  { value: "queued", label: "待介绍" },
  { value: "analyzing", label: "介绍中" },
  { value: "analyzed", label: "已介绍" },
  { value: "failed", label: "介绍失败" },
  { value: "ignored", label: "已忽略" },
  { value: "archived", label: "已归档" },
];

const settingsTabs: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    id: "crawl",
    label: "采集策略",
    icon: <Clock4 className="h-4 w-4 sm:mr-2" />,
  },
  {
    id: "providers",
    label: "AI 引擎",
    icon: <Bot className="h-4 w-4 sm:mr-2" />,
  },
  {
    id: "agent",
    label: "AI 任务",
    icon: <Terminal className="h-4 w-4 sm:mr-2" />,
  },
  {
    id: "notify",
    label: "飞书通知",
    icon: <Send className="h-4 w-4 sm:mr-2" />,
  },
];

const statusMeta: Record<RepoStatus, { label: string; variant: BadgeVariant }> =
  {
    queued: { label: "待介绍", variant: "muted" },
    analyzing: { label: "介绍中", variant: "warning" },
    analyzed: { label: "已介绍", variant: "success" },
    failed: { label: "介绍失败", variant: "destructive" },
    ignored: { label: "已忽略", variant: "secondary" },
    archived: { label: "已归档", variant: "muted" },
  };

function getTabFromLocation(): Tab {
  const value = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  return value === "status" || value === "settings" || value === "repos"
    ? value
    : "repos";
}

function readSettingsTab(): SettingsTab {
  const value = window.localStorage.getItem(SETTINGS_TAB_STATE_KEY);
  return value === "providers" ||
    value === "agent" ||
    value === "notify" ||
    value === "crawl"
    ? value
    : "crawl";
}

function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false, ...options });
}

function formatCreatedDate(value: string): string {
  if (!value) return "创建时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "创建时间未知";
  return `创建于 ${date.toLocaleDateString("zh-CN")}`;
}

function listText(values: string[], fallback = "未知"): string {
  return values.length ? values.join("、") : fallback;
}

function createStrategy(): Strategy {
  return {
    id: `strategy-${Date.now()}`,
    name: "新策略组",
    enabled: false,
    query: "agent OR llm",
    stars_min: 10,
    stars_max: 500,
    max_pages: 8,
    pages_per_run: 1,
    per_run_target: 8,
  };
}

type SavedReposView = {
  repoQuery: string;
  language: string;
  strategyId: string;
  filterStatus: string[];
  starsMin: string;
  starsMax: string;
  dateFrom: string;
  dateTo: string;
  pageSize: number;
};

function readSavedReposView(): SavedReposView {
  const fallback: SavedReposView = {
    repoQuery: "",
    language: "",
    strategyId: "",
    filterStatus: [],
    starsMin: "",
    starsMax: "",
    dateFrom: "",
    dateTo: "",
    pageSize: 20,
  };
  try {
    const value = JSON.parse(
      window.localStorage.getItem(REPOS_VIEW_STATE_KEY) || "{}",
    ) as Partial<SavedReposView>;
    return {
      repoQuery:
        typeof value.repoQuery === "string"
          ? value.repoQuery
          : fallback.repoQuery,
      language:
        typeof value.language === "string" ? value.language : fallback.language,
      strategyId:
        typeof value.strategyId === "string"
          ? value.strategyId
          : fallback.strategyId,
      filterStatus: Array.isArray(value.filterStatus)
        ? value.filterStatus.filter(
            (item): item is string => typeof item === "string",
          )
        : fallback.filterStatus,
      starsMin:
        typeof value.starsMin === "string" ? value.starsMin : fallback.starsMin,
      starsMax:
        typeof value.starsMax === "string" ? value.starsMax : fallback.starsMax,
      dateFrom:
        typeof value.dateFrom === "string" ? value.dateFrom : fallback.dateFrom,
      dateTo: typeof value.dateTo === "string" ? value.dateTo : fallback.dateTo,
      pageSize:
        value.pageSize === 10 || value.pageSize === 20 || value.pageSize === 50
          ? value.pageSize
          : fallback.pageSize,
    };
  } catch {
    return fallback;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "default" | "sm" | "icon";
  }
>(({ className, variant = "default", size = "default", ...props }, ref) => {
  const variants: Record<ButtonVariant, string> = {
    default: "bg-slate-900 text-slate-50 hover:bg-slate-900/90 shadow-sm",
    outline:
      "border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900 shadow-sm",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-100/80",
    ghost: "hover:bg-slate-100 hover:text-slate-900",
    destructive: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
  };
  const sizes = {
    default: "h-9 px-4 py-2",
    sm: "h-8 rounded-md px-3 text-xs",
    icon: "h-9 w-9",
  };
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";

const Card = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm",
      className,
    )}
    {...props}
  />
);
const CardHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
);
const CardTitle = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
);
const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm text-slate-500", className)} {...props} />
);
const CardContent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 pt-0", className)} {...props} />
);
const CardFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
);

const Badge = ({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: BadgeVariant }) => {
  const variants: Record<BadgeVariant, string> = {
    default: "border-transparent bg-slate-900 text-slate-50",
    secondary: "border-transparent bg-slate-100 text-slate-900",
    outline: "border-slate-200 text-slate-950",
    success: "border-transparent bg-emerald-100 text-emerald-800",
    warning: "border-transparent bg-amber-100 text-amber-800",
    destructive: "border-transparent bg-rose-100 text-rose-800",
    muted: "border-transparent bg-slate-100 text-slate-500",
  };
  return (
    <div
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
};

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-9 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

const Switch = ({
  checked,
  onCheckedChange,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      "inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-slate-900" : "bg-slate-300",
    )}
  >
    <span
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
        checked ? "translate-x-6" : "translate-x-1",
      )}
    />
  </button>
);

function ShadcnSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-slate-200 bg-transparent px-3 py-2 text-left text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-slate-950",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-slate-50",
          selected ? "text-slate-900" : "text-slate-500",
        )}
      >
        <span className="truncate">
          {selected?.label || placeholder || "请选择"}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      {!disabled && isOpen && (
        <div className="absolute top-full z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 text-slate-950 shadow-md animate-in fade-in-0 zoom-in-95">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={cn(
                "relative flex w-full items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm transition-colors hover:bg-slate-100",
                value === option.value
                  ? "font-semibold text-slate-900"
                  : "text-slate-700",
              )}
            >
              {value === option.value && (
                <Check className="absolute left-2 h-4 w-4" />
              )}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          "flex min-h-9 w-full items-center justify-between rounded-md border border-slate-200 bg-transparent px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-slate-50",
          value.length ? "text-slate-900" : "text-slate-500",
        )}
      >
        <span className="truncate">
          {value.length ? `已选 ${value.length} 项` : placeholder}
        </span>
        <span className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 opacity-50" />
        </span>
      </button>
      {isOpen && (
        <div className="absolute top-full z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 text-slate-950 shadow-md animate-in fade-in-0 zoom-in-95">
          <button
            type="button"
            className="mb-1 flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-100"
            onClick={() => {
              onChange([]);
              setIsOpen(false);
            }}
          >
            清空 <XCircle className="h-3.5 w-3.5" />
          </button>
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                onClick={() =>
                  onChange(
                    checked
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value],
                  )
                }
                className={cn(
                  "relative flex w-full items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm transition-colors hover:bg-slate-100",
                  checked ? "font-semibold text-slate-900" : "text-slate-700",
                )}
              >
                {checked && <Check className="absolute left-2 h-4 w-4" />}
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CustomIcons = {
  Radar: ({ className }: { className?: string }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 12v.01" />
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4.03 5.47A10 10 0 0 0 4.5 20.3" />
      <path d="M8.46 22.04A10 10 0 0 0 21.5 15.5" />
      <path d="M15.54 15.54A5 5 0 0 0 8.46 8.46" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Feishu: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M448 352c0-88.32 71.68-160 160-160 30.72 0 57.6 8.96 81.92 23.04l88.32-88.32C718.08 81.92 665.6 57.6 608 57.6 445.44 57.6 314.88 189.44 314.88 352v614.4h133.12V352z"
        fill="#00D2D3"
      />
      <path
        d="M721.92 519.68c-44.8-19.2-94.72-27.52-145.92-27.52-64 0-125.44 14.08-179.2 40.96l55.04 117.76c35.84-17.92 76.8-27.52 119.04-27.52 53.76 0 103.68 15.36 145.92 42.24l85.12-108.8c-25.6-14.08-51.2-26.88-79.36-37.12z"
        fill="#00D2D3"
      />
      <path
        d="M211.2 554.24l-89.6-96c34.56-29.44 76.8-51.2 124.16-61.44l29.44 129.28c-24.32 5.12-46.08 15.36-64 28.16z"
        fill="#00D2D3"
      />
    </svg>
  ),
};

function StatusBadge({ status }: { status: RepoStatus }) {
  const detail = statusMeta[status];
  return <Badge variant={detail.variant}>{detail.label}</Badge>;
}

function InlineError({
  title,
  message,
  onRetry,
  compact = false,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-rose-200 bg-rose-50 text-rose-800",
        compact ? "px-3 py-2 text-xs" : "p-5",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1">{message}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            重试
          </Button>
        )}
      </div>
    </div>
  );
}

const LoadingCard = ({ title }: { title: string }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500">
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      {title}
    </div>
  </div>
);

function DetailItem({
  icon,
  title,
  children,
  wide = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Card
      className={cn(
        "border-slate-200/80 bg-white p-4 shadow-none",
        wide && "md:col-span-2",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
        {icon}
        {title}
      </div>
      <div className="text-sm leading-6 text-slate-700">{children}</div>
    </Card>
  );
}

function RepoCard({
  repo,
  expanded,
  copied,
  onToggleExpand,
  onCopyLink,
  onUpdateStatus,
  updating,
}: {
  repo: Repo;
  expanded: boolean;
  copied: boolean;
  onToggleExpand: (id: number) => void;
  onCopyLink: (url: string) => void;
  onUpdateStatus: (repo: Repo, next: RepoStatus) => void;
  updating: boolean;
}) {
  const { analysis } = repo;
  const repoUrl = repo.html_url || `https://github.com/${repo.full_name}`;
  const selectableStatus =
    repo.status === "analyzing"
      ? []
      : statusOptions.filter((option) => option.value !== "analyzing");

  return (
    <Card className="repo-card flex h-full flex-col overflow-hidden border-slate-200 shadow-none transition-colors hover:border-slate-300">
      <div className="flex min-h-[300px] flex-1 flex-col overflow-hidden p-4 sm:p-5">
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-start gap-2 text-base font-semibold leading-6 text-slate-900 transition-colors hover:text-blue-600 sm:text-lg"
              >
                <Github size={18} className="mt-0.5 shrink-0 text-slate-700" />
                <span className="line-clamp-2">{repo.full_name}</span>
              </a>
              <div className="repo-card-tag-row flex max-w-full items-center gap-2 overflow-x-auto pb-1">
                <StatusBadge status={repo.status} />
                {repo.source_strategy_ids.map((strategy) => (
                  <Badge variant="outline" key={strategy} className="bg-white">
                    {strategy}
                  </Badge>
                ))}
                {repo.topics.slice(0, 2).map((topic) => (
                  <Badge variant="secondary" key={topic}>
                    {topic}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <Button
                type="button"
                size="icon"
                variant={copied ? "secondary" : "outline"}
                className="h-8 w-8 shrink-0 bg-white"
                title={copied ? "已复制仓库链接" : "复制仓库链接"}
                onClick={() => onCopyLink(repoUrl)}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              {repo.status === "analyzing" ? (
                <StatusBadge status={repo.status} />
              ) : (
                <ShadcnSelect
                  value={repo.status}
                  onChange={(value) =>
                    value !== repo.status &&
                    onUpdateStatus(repo, value as RepoStatus)
                  }
                  options={selectableStatus}
                  className="w-[112px] sm:w-[128px]"
                  disabled={updating}
                />
              )}
            </div>
          </div>

          <div className="flex min-h-[84px] flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <p className="line-clamp-4 leading-6">
              {analysis.summary ||
                repo.description ||
                "等待 AI 从仓库公开资料生成项目介绍。"}
            </p>
          </div>

          {repo.status === "failed" && repo.failure_message && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {repo.failure_message}
            </div>
          )}

          <div className="mt-auto border-t border-slate-100 pt-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
              <div className="min-w-0 space-y-2">
                <div className="flex max-h-[52px] flex-wrap items-center gap-2 overflow-hidden text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                    <span className="h-2 w-2 rounded-full bg-slate-800" />
                    {repo.language || "未知语言"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                    <Star size={12} className="text-amber-500" />
                    {repo.stars}
                  </span>
                  <span className="inline-flex max-w-full items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                    <span className="truncate">
                      {repo.repo_license || analysis.license || "未声明协议"}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">
                    {formatCreatedDate(repo.created_at)}
                  </span>
                  <span>{formatDate(repo.fetched_at)}</span>
                </div>
              </div>
              <div className="flex justify-center sm:self-center">
                <button
                  type="button"
                  className="inline-flex h-11 min-w-[88px] items-center justify-center rounded-full px-4 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  title={expanded ? "收起详情" : "查看详情"}
                  onClick={() => onToggleExpand(repo.id)}
                >
                  {expanded ? (
                    <ChevronUp size={20} />
                  ) : (
                    <ChevronDown size={20} />
                  )}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {(repo.status === "failed" ||
                  repo.status === "ignored" ||
                  repo.status === "archived") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 bg-white px-3"
                    disabled={updating}
                    onClick={() => onUpdateStatus(repo, "queued")}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重新排队
                  </Button>
                )}
                {repo.status !== "ignored" && repo.status !== "analyzing" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 bg-white px-3"
                    disabled={updating}
                    onClick={() => onUpdateStatus(repo, "ignored")}
                  >
                    忽略
                  </Button>
                )}
                {repo.status !== "archived" && repo.status !== "analyzing" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 bg-white px-3"
                    disabled={updating}
                    onClick={() => onUpdateStatus(repo, "archived")}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    归档
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50/80 p-4 text-sm animate-in slide-in-from-top-2 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-md bg-white font-mono"
            >{`可信度 ${(analysis.confidence * 100).toFixed(0)}%`}</Badge>
            <Badge variant="secondary" className="rounded-md">
              {analysis.analyzed_at
                ? `介绍于 ${formatDate(analysis.analyzed_at)}`
                : "等待项目介绍"}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DetailItem
              icon={<Search size={15} className="text-slate-500" />}
              title="项目用途"
            >
              {analysis.purpose || "未知"}
            </DetailItem>
            <DetailItem
              icon={<Zap size={15} className="text-slate-500" />}
              title="主要功能"
            >
              {listText(analysis.features)}
            </DetailItem>
            <DetailItem
              icon={<BarChart3 size={15} className="text-slate-500" />}
              title="目标用户"
            >
              {listText(analysis.target_users)}
            </DetailItem>
            <DetailItem
              icon={<Terminal size={15} className="text-slate-500" />}
              title="技术栈"
            >
              {listText(analysis.tech_stack)}
            </DetailItem>
            <DetailItem
              icon={<Settings size={15} className="text-slate-500" />}
              title="部署说明"
            >
              {analysis.deployment_notes || "未知"}
            </DetailItem>
            <DetailItem
              icon={<Github size={15} className="text-slate-500" />}
              title="许可证"
            >
              {analysis.license || repo.repo_license || "未知"}
            </DetailItem>
            <DetailItem
              icon={<Database size={15} className="text-slate-500" />}
              title="资料来源"
              wide
            >
              {listText(analysis.evidence, "尚未读取公开文件")}
            </DetailItem>
          </div>
        </div>
      )}
    </Card>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone = "slate",
  note,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: "slate" | "emerald" | "amber" | "blue";
  note: string;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
  };
  return (
    <Card className="status-metric border-slate-200 shadow-none">
      <div className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {value}
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{note}</p>
        </div>
        <div className={cn("rounded-lg p-2", tones[tone])}>{icon}</div>
      </div>
    </Card>
  );
}

export function App() {
  const [savedReposView] = useState(readSavedReposView);
  const [tab, setTab] = useState<Tab>(getTabFromLocation);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(readSettingsTab);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(savedReposView.pageSize);
  const [repoQuery, setRepoQuery] = useState(savedReposView.repoQuery);
  const [language, setLanguage] = useState(savedReposView.language);
  const [strategyId, setStrategyId] = useState(savedReposView.strategyId);
  const [filterStatus, setFilterStatus] = useState<string[]>(
    savedReposView.filterStatus,
  );
  const [starsMin, setStarsMin] = useState(savedReposView.starsMin);
  const [starsMax, setStarsMax] = useState(savedReposView.starsMax);
  const [dateFrom, setDateFrom] = useState(savedReposView.dateFrom);
  const [dateTo, setDateTo] = useState(savedReposView.dateTo);
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(null);
  const [copiedRepoUrl, setCopiedRepoUrl] = useState("");
  const [statusUpdatingRepoId, setStatusUpdatingRepoId] = useState<
    number | null
  >(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [secrets, setSecrets] = useState<SecretsMeta | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [feishuForm, setFeishuForm] = useState({
    app_id: "",
    app_secret: "",
    group_chat_id: "",
  });
  const [selectedProvider, setSelectedProvider] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visiblePages = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    return Array.from(
      { length: Math.min(5, totalPages - start + 1) },
      (_, index) => start + index,
    );
  }, [page, totalPages]);
  const repoRows = useMemo(
    () =>
      repos.reduce<Repo[][]>((rows, repo, index) => {
        if (index % 2 === 0) rows.push([repo]);
        else rows[rows.length - 1].push(repo);
        return rows;
      }, []),
    [repos],
  );
  const enabledStrategyCount =
    config?.search.strategies.filter((strategy) => strategy.enabled).length ??
    0;
  const activeProvider = config?.providers[selectedProvider];

  function updateConfig(mutator: (current: AppConfig) => AppConfig) {
    setConfig((current) => (current ? mutator(current) : current));
  }

  async function loadRepos(nextPage = page) {
    const response = await api.repos({
      repo_query: repoQuery,
      language,
      strategy_id: strategyId,
      status: filterStatus,
      stars_min: starsMin || undefined,
      stars_max: starsMax || undefined,
      date_from: dateFrom,
      date_to: dateTo,
      page: nextPage,
      page_size: pageSize,
    });
    setRepos(response.items);
    setLanguages(response.languages);
    setTotal(response.pagination.total);
    setPage(response.pagination.page);
  }

  async function loadAll({
    refreshRepos = true,
  }: { refreshRepos?: boolean } = {}) {
    setIsLoading(true);
    setError("");
    try {
      const [nextConfig, nextStatus, nextSecrets] = await Promise.all([
        api.config(),
        api.status(),
        api.secrets(),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setSecrets(nextSecrets);
      setFeishuForm((current) => ({
        ...current,
        group_chat_id: nextConfig.feishu.group_chat_id,
      }));
      if (refreshRepos) await loadRepos(1);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);
  useEffect(() => {
    const onHashChange = () => setTab(getTabFromLocation());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const state = {
      repoQuery,
      language,
      strategyId,
      filterStatus,
      starsMin,
      starsMax,
      dateFrom,
      dateTo,
      pageSize,
    };
    window.localStorage.setItem(REPOS_VIEW_STATE_KEY, JSON.stringify(state));
  }, [
    repoQuery,
    language,
    strategyId,
    filterStatus,
    starsMin,
    starsMax,
    dateFrom,
    dateTo,
    pageSize,
  ]);

  function changeTab(next: Tab) {
    setTab(next);
    window.location.hash = next;
    if (next === "settings") {
      const saved = readSettingsTab();
      setSettingsTab(saved);
    }
  }

  function changeSettingsTab(next: SettingsTab) {
    setSettingsTab(next);
    window.localStorage.setItem(SETTINGS_TAB_STATE_KEY, next);
  }

  async function withFeedback(
    action: () => Promise<void>,
    success: string,
    refresh = true,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      if (refresh) await loadAll();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function resetFilters() {
    setRepoQuery("");
    setLanguage("");
    setStrategyId("");
    setFilterStatus([]);
    setStarsMin("");
    setStarsMax("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  async function handleCopyRepoLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRepoUrl(url);
      window.setTimeout(() => setCopiedRepoUrl(""), 2000);
    } catch {
      setError("浏览器未允许复制仓库链接。");
    }
  }

  function updateStrategy(index: number, patch: Partial<Strategy>) {
    updateConfig((current) => ({
      ...current,
      search: {
        ...current.search,
        strategies: current.search.strategies.map((strategy, position) =>
          position === index ? { ...strategy, ...patch } : strategy,
        ),
      },
    }));
  }

  function updateProvider(
    index: number,
    patch: Partial<AppConfig["providers"][number]>,
  ) {
    updateConfig((current) => ({
      ...current,
      providers: current.providers.map((provider, position) =>
        position === index ? { ...provider, ...patch } : provider,
      ),
    }));
  }

  async function saveCrawl() {
    if (!config) return;
    await withFeedback(async () => {
      await api.saveConfig({ search: config.search });
    }, "采集策略已保存并重新加载");
  }

  async function saveProviders() {
    if (!config) return;
    await withFeedback(async () => {
      await api.saveConfig({ providers: config.providers });
      await api.saveSecrets({
        github_token: githubToken,
        providers: providerKeys,
        replace_providers: true,
      });
    }, "GitHub Token 和 AI Provider 已保存");
  }

  async function saveAgent() {
    if (!config) return;
    await withFeedback(async () => {
      await api.saveConfig({ agent: config.agent });
    }, "AI 分析任务已保存");
  }

  async function saveNotify() {
    if (!config) return;
    await withFeedback(async () => {
      await api.saveConfig({ notify: config.notify });
      await api.saveFeishu(feishuForm);
    }, "飞书群聊和通知调度已保存");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-slate-200">
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <button
              type="button"
              className="group flex items-center gap-2 rounded-lg text-left transition-colors hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
              onClick={() => changeTab("repos")}
              aria-label="返回仓库列表"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
                <CustomIcons.Radar className="h-5 w-5" />
              </div>
              <span className="hidden text-lg font-bold tracking-tight sm:block">
                RepoRadar
              </span>
            </button>
            <div className="flex items-center gap-2">
              <nav className="flex items-center space-x-1 sm:space-x-2">
                {[
                  {
                    id: "repos" as const,
                    icon: <Search className="h-4 w-4 sm:mr-2" />,
                    label: "发现库",
                  },
                  {
                    id: "status" as const,
                    icon: <BarChart3 className="h-4 w-4 sm:mr-2" />,
                    label: "系统状态",
                  },
                  {
                    id: "settings" as const,
                    icon: <Settings className="h-4 w-4 sm:mr-2" />,
                    label: "调度与配置",
                  },
                ].map((item) => (
                  <Button
                    key={item.id}
                    variant={tab === item.id ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => changeTab(item.id)}
                    className="px-3"
                  >
                    {item.icon}
                    <span className="hidden sm:inline">{item.label}</span>
                  </Button>
                ))}
              </nav>
              <a
                href="https://github.com/dnwwdwd/repo-radar"
                target="_blank"
                rel="noreferrer"
                aria-label="打开 RepoRadar GitHub 仓库"
                title="GitHub 仓库"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <Github className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-8 animate-in fade-in duration-300 sm:px-6 lg:px-8">
        {(notice || error) && (
          <div className="mb-5">
            {error ? (
              <InlineError title="操作失败" message={error} compact />
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice("")}
                  aria-label="关闭提示"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "repos" && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold tracking-tight">仓库</h2>
              <div className="text-sm font-medium text-slate-500">
                {isLoading ? "-" : `${total} 条`}
              </div>
            </div>
            <Card className="border-slate-200 p-4 shadow-none">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={repoQuery}
                  onChange={(event) => setRepoQuery(event.target.value)}
                  placeholder="owner/repo、链接或项目介绍关键词"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRepoQuery("")}
                  disabled={!repoQuery.trim()}
                >
                  清空
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void withFeedback(
                      async () => {
                        await loadRepos(1);
                      },
                      "仓库列表已刷新",
                      false,
                    )
                  }
                  disabled={busy || isLoading}
                >
                  <RefreshCw
                    className={cn("mr-2 h-4 w-4", busy && "animate-spin")}
                  />
                  刷新
                </Button>
              </div>
            </Card>
            <Card className="border-slate-200 p-4 shadow-none">
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MultiSelect
                    value={filterStatus}
                    onChange={setFilterStatus}
                    placeholder="状态"
                    options={statusOptions}
                  />
                  <ShadcnSelect
                    value={language}
                    onChange={setLanguage}
                    placeholder="语言"
                    options={[
                      { value: "", label: "全部语言" },
                      ...languages.map((item) => ({
                        value: item,
                        label: item,
                      })),
                    ]}
                  />
                  <ShadcnSelect
                    value={strategyId}
                    onChange={setStrategyId}
                    placeholder="策略组"
                    options={[
                      { value: "", label: "全部策略组" },
                      ...(config?.search.strategies ?? []).map((item) => ({
                        value: item.id,
                        label: item.name,
                      })),
                    ]}
                  />
                  <ShadcnSelect
                    value={pageSize.toString()}
                    onChange={(value) => {
                      setPageSize(Number(value));
                      setPage(1);
                    }}
                    placeholder="每页数量"
                    options={[
                      { value: "10", label: "10 / 页" },
                      { value: "20", label: "20 / 页" },
                      { value: "50", label: "50 / 页" },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Input
                    type="number"
                    min="0"
                    value={starsMin}
                    onChange={(event) => setStarsMin(event.target.value)}
                    placeholder="最低 Stars"
                  />
                  <Input
                    type="number"
                    min="0"
                    value={starsMax}
                    onChange={(event) => setStarsMax(event.target.value)}
                    placeholder="最高 Stars"
                  />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                    <Filter className="h-4 w-4" />
                    当前启用 {enabledStrategyCount} 个策略组 · {page} /{" "}
                    {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void withFeedback(
                          async () => {
                            await loadRepos(1);
                          },
                          "筛选结果已更新",
                          false,
                        )
                      }
                      disabled={busy}
                    >
                      应用筛选
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetFilters}
                    >
                      重置筛选
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <LoadingCard title="正在加载仓库..." />
                <LoadingCard title="正在加载仓库..." />
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="flex flex-col gap-4 lg:hidden">
                    {repos.map((repo) => (
                      <RepoCard
                        key={repo.id}
                        repo={repo}
                        expanded={expandedRepoId === repo.id}
                        copied={copiedRepoUrl === repo.html_url}
                        onToggleExpand={(id) =>
                          setExpandedRepoId((current) =>
                            current === id ? null : id,
                          )
                        }
                        onCopyLink={(url) => void handleCopyRepoLink(url)}
                        updating={statusUpdatingRepoId === repo.id}
                        onUpdateStatus={(item, next) =>
                          void withFeedback(async () => {
                            setStatusUpdatingRepoId(item.id);
                            try {
                              await api.updateRepoStatus(item.id, next);
                            } finally {
                              setStatusUpdatingRepoId(null);
                            }
                          }, "仓库状态已更新")
                        }
                      />
                    ))}
                  </div>
                  <div className="hidden flex-col gap-4 lg:flex">
                    {repoRows.map((row, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch"
                      >
                        {row.map((repo) => (
                          <RepoCard
                            key={repo.id}
                            repo={repo}
                            expanded={expandedRepoId === repo.id}
                            copied={copiedRepoUrl === repo.html_url}
                            onToggleExpand={(id) =>
                              setExpandedRepoId((current) =>
                                current === id ? null : id,
                              )
                            }
                            onCopyLink={(url) => void handleCopyRepoLink(url)}
                            updating={statusUpdatingRepoId === repo.id}
                            onUpdateStatus={(item, next) =>
                              void withFeedback(async () => {
                                setStatusUpdatingRepoId(item.id);
                                try {
                                  await api.updateRepoStatus(item.id, next);
                                } finally {
                                  setStatusUpdatingRepoId(null);
                                }
                              }, "仓库状态已更新")
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  {!repos.length && (
                    <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-sm font-medium text-slate-500">
                      还没有仓库记录。请在设置页启用一个策略组。
                    </div>
                  )}
                </div>
                {total > 0 && (
                  <Card className="border-slate-200 p-4 shadow-none">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="text-sm text-slate-500">
                        本页 {repos.length} 条 · 第 {page} / {totalPages} 页
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page <= 1 || busy}
                          onClick={() =>
                            void withFeedback(
                              async () => {
                                await loadRepos(1);
                              },
                              "已回到首页",
                              false,
                            )
                          }
                        >
                          首页
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page <= 1 || busy}
                          onClick={() =>
                            void withFeedback(
                              async () => {
                                await loadRepos(page - 1);
                              },
                              "已切换上一页",
                              false,
                            )
                          }
                        >
                          上一页
                        </Button>
                        {visiblePages.map((item) => (
                          <Button
                            key={item}
                            type="button"
                            variant={item === page ? "default" : "outline"}
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void withFeedback(
                                async () => {
                                  await loadRepos(item);
                                },
                                `已切换到第 ${item} 页`,
                                false,
                              )
                            }
                          >
                            {item}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page >= totalPages || busy}
                          onClick={() =>
                            void withFeedback(
                              async () => {
                                await loadRepos(page + 1);
                              },
                              "已切换下一页",
                              false,
                            )
                          }
                        >
                          下一页
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page >= totalPages || busy}
                          onClick={() =>
                            void withFeedback(
                              async () => {
                                await loadRepos(totalPages);
                              },
                              "已到末页",
                              false,
                            )
                          }
                        >
                          末页
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {tab === "status" && (
          <div className="space-y-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">系统大盘</h2>
                <p className="mt-1 text-sm text-slate-500">
                  查看 GitHub 采集、项目介绍任务和飞书群聊的运行情况。
                </p>
              </div>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
                  status?.service.status === "running"
                    ? "border-emerald-100 bg-emerald-50 text-emerald-600"
                    : "border-amber-100 bg-amber-50 text-amber-700",
                )}
              >
                <span className="relative flex h-2 w-2">
                  {status?.service.status === "running" && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex h-2 w-2 rounded-full",
                      status?.service.status === "running"
                        ? "bg-emerald-500"
                        : "bg-amber-500",
                    )}
                  />
                </span>
                {status?.service.status === "running"
                  ? status.service.scheduler_running
                    ? "服务运行中，调度器已启动"
                    : "服务运行中，调度器未运行"
                  : "正在读取服务状态"}
              </div>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <LoadingCard title="正在加载系统指标..." />
                <LoadingCard title="正在加载系统指标..." />
                <LoadingCard title="正在加载系统指标..." />
                <LoadingCard title="正在加载系统指标..." />
              </div>
            ) : (
              <>
                {status && (
                  <>
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <MetricCard
                        label="API 剩余配额"
                        value={status.github.remaining ?? "-"}
                        note={status.github.message || "等待 GitHub 状态"}
                        icon={<Github className="h-4 w-4" />}
                      />
                      <MetricCard
                        label="待介绍队列"
                        value={status.queues.queued ?? 0}
                        note={`介绍中 ${status.queues.analyzing ?? 0} 条`}
                        tone="amber"
                        icon={<Terminal className="h-4 w-4" />}
                      />
                      <MetricCard
                        label="AI Provider"
                        value={status.agent.active_provider || "未启用"}
                        note={
                          status.agent.provider_configured
                            ? "密钥已配置"
                            : "密钥未配置"
                        }
                        tone="emerald"
                        icon={<Bot className="h-4 w-4" />}
                      />
                      <MetricCard
                        label="飞书群聊"
                        value={
                          status.feishu.group_chat_configured
                            ? "已配置"
                            : "未配置"
                        }
                        note={
                          status.feishu.group_chat_id_masked || "请在设置页填写"
                        }
                        tone="blue"
                        icon={<Send className="h-4 w-4" />}
                      />
                    </div>
                    <Card className="relative mt-8 overflow-hidden">
                      <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-5 pt-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Settings className="h-4 w-4 text-slate-500" />
                              调度任务状态
                            </CardTitle>
                            <CardDescription className="mt-1">
                              后台定时任务的注册状态与下次执行时间。
                            </CardDescription>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void loadAll()}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            刷新
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="divide-y divide-slate-100">
                          {status.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="flex flex-col justify-between gap-4 p-5 transition-colors hover:bg-slate-50/50 sm:flex-row sm:items-center"
                            >
                              <div className="flex items-start gap-4">
                                <span className="relative mt-1 flex h-3 w-3 shrink-0">
                                  <span
                                    className={cn(
                                      "relative inline-flex h-3 w-3 rounded-full",
                                      task.status === "running"
                                        ? "bg-emerald-500"
                                        : "bg-slate-300",
                                    )}
                                  />
                                </span>
                                <div>
                                  <p className="font-mono text-sm font-semibold text-slate-900">
                                    {task.name}
                                  </p>
                                  <p className="mt-0.5 text-sm text-slate-500">
                                    {task.status === "running"
                                      ? "任务正在执行"
                                      : "等待下一次调度"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 pl-7 sm:pl-0">
                                <Badge
                                  variant={
                                    task.status === "running"
                                      ? "success"
                                      : "secondary"
                                  }
                                >
                                  {task.status === "running"
                                    ? "运行中"
                                    : "等待调度"}
                                </Badge>
                                <div className="flex items-center rounded-md border border-slate-200/60 bg-slate-100/80 px-2.5 py-1.5 text-xs font-medium text-slate-600">
                                  <Clock className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                                  下次执行: {task.next_run || "-"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Zap className="h-4 w-4 text-slate-500" />
                            运行控制
                          </CardTitle>
                          <CardDescription>
                            暂停不会打断正在执行的一轮任务，恢复后会立即补跑一轮。
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 gap-4">
                          <ControlPanel
                            title="GitHub 采集"
                            description="控制新仓库的自动发现链路。"
                            enabled={status.controls.crawl.enabled}
                            running={status.controls.crawl.running}
                            busy={busy}
                            onClick={() =>
                              void withFeedback(
                                async () => {
                                  await api.control(
                                    "crawl",
                                    status.controls.crawl.enabled
                                      ? "pause"
                                      : "resume",
                                  );
                                },
                                status.controls.crawl.enabled
                                  ? "GitHub 采集已暂停"
                                  : "GitHub 采集已恢复",
                              )
                            }
                          />
                          <ControlPanel
                            title="AI 项目介绍"
                            description="控制仓库资料的读取与中文介绍生成。"
                            enabled={status.controls.agent.enabled}
                            running={status.controls.agent.running}
                            busy={busy}
                            onClick={() =>
                              void withFeedback(
                                async () => {
                                  await api.control(
                                    "agent",
                                    status.controls.agent.enabled
                                      ? "pause"
                                      : "resume",
                                  );
                                },
                                status.controls.agent.enabled
                                  ? "AI 项目介绍已暂停"
                                  : "AI 项目介绍已恢复",
                              )
                            }
                          />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Clock className="h-4 w-4 text-slate-500" />
                            最近运行事件
                          </CardTitle>
                          <CardDescription>
                            保留最近的采集、介绍、通知和配置操作记录。
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {status.runtime_events.length ? (
                            status.runtime_events.map((event) => (
                              <div
                                key={event.id}
                                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium text-slate-900">
                                    {event.summary}
                                  </p>
                                  <Badge
                                    variant={
                                      event.status === "success"
                                        ? "success"
                                        : event.status === "failed"
                                          ? "destructive"
                                          : "secondary"
                                    }
                                  >
                                    {event.status}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {formatDate(event.created_at)} ·{" "}
                                  {event.category}
                                </p>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                              暂无运行事件。
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === "settings" && (
          <div className="mx-auto max-w-3xl space-y-8 pb-12">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                系统配置
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                调整仓库发现、项目介绍与飞书群聊通知。保存后调度器会自动重新加载。
              </p>
            </div>
            <div className="flex w-full border-b border-slate-200">
              <div className="flex w-full overflow-x-auto">
                <div className="flex min-w-max items-center gap-1 p-1">
                  {settingsTabs.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      variant={settingsTab === item.id ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => changeSettingsTab(item.id)}
                    >
                      {item.icon}
                      <span className="hidden sm:inline">{item.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            {!config || isLoading ? (
              <LoadingCard title="正在加载配置..." />
            ) : (
              <>
                {settingsTab === "crawl" && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock4 className="h-5 w-5 text-slate-400" />
                        采集策略
                      </CardTitle>
                      <CardDescription>
                        每个策略组有自己的 GitHub Query、Stars
                        范围和分页节奏。默认关闭，启用后才会开始采集。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <label className="text-sm font-medium text-slate-900">
                            采集 Cron
                          </label>
                          <Input
                            value={config.search.cron}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  cron: event.target.value,
                                },
                              }))
                            }
                            placeholder="0 */2 * * *"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            新建仓库时间窗口（天）
                          </label>
                          <Input
                            type="number"
                            min="1"
                            value={config.search.created_window_days}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  created_window_days: Number(
                                    event.target.value,
                                  ),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            游标回看范围（天）
                          </label>
                          <Input
                            type="number"
                            min="1"
                            value={config.search.created_lookback_days}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  created_lookback_days: Number(
                                    event.target.value,
                                  ),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            数据库去重冷却（天）
                          </label>
                          <Input
                            type="number"
                            min="1"
                            value={config.search.seen_cooldown_days}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  seen_cooldown_days: Number(
                                    event.target.value,
                                  ),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            每轮新仓库上限
                          </label>
                          <Input
                            type="number"
                            min="1"
                            value={config.search.max_new_repos_per_tick}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  max_new_repos_per_tick: Number(
                                    event.target.value,
                                  ),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            每轮策略组上限
                          </label>
                          <Input
                            type="number"
                            min="1"
                            value={config.search.max_strategy_runs_per_tick}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  max_strategy_runs_per_tick: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            冷却跳页比例
                          </label>
                          <Input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={config.search.cooldown_skip_page_threshold}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  cooldown_skip_page_threshold: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">
                            冷却追加页数
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={config.search.max_cooldown_extra_pages_per_strategy}
                            onChange={(event) =>
                              updateConfig((current) => ({
                                ...current,
                                search: {
                                  ...current.search,
                                  max_cooldown_extra_pages_per_strategy: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-4 border-t border-slate-100 pt-5">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">
                            策略组
                          </h4>
                          <p className="mt-1 text-xs text-slate-500">
                            Query 支持 GitHub Search 语法。Stars
                            范围将自动补进请求条件。
                          </p>
                        </div>
                        {config.search.strategies.map((strategy, index) => (
                          <div
                            key={strategy.id}
                            className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5"
                          >
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <Switch
                                  checked={strategy.enabled}
                                  onCheckedChange={(enabled) =>
                                    updateStrategy(index, { enabled })
                                  }
                                />
                                <Input
                                  value={strategy.name}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      name: event.target.value,
                                    })
                                  }
                                  className="font-medium"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="删除策略组"
                                onClick={() =>
                                  updateConfig((current) => ({
                                    ...current,
                                    search: {
                                      ...current.search,
                                      strategies:
                                        current.search.strategies.filter(
                                          (_, position) => position !== index,
                                        ),
                                    },
                                  }))
                                }
                              >
                                <Trash2 className="h-4 w-4 text-slate-500" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <div className="space-y-2 sm:col-span-2">
                                <label className="text-sm font-medium text-slate-900">
                                  GitHub Query
                                </label>
                                <Input
                                  value={strategy.query}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      query: event.target.value,
                                    })
                                  }
                                  placeholder="agent OR llm"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-900">
                                  最低 Stars
                                </label>
                                <Input
                                  type="number"
                                  min="0"
                                  value={strategy.stars_min}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      stars_min: Number(event.target.value),
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-900">
                                  最高 Stars
                                </label>
                                <Input
                                  type="number"
                                  min="0"
                                  value={strategy.stars_max}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      stars_max: Number(event.target.value),
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-900">
                                  最大页数
                                </label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={strategy.max_pages}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      max_pages: Number(event.target.value),
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-900">
                                  每轮读取页数
                                </label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={strategy.pages_per_run}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      pages_per_run: Number(event.target.value),
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-900">
                                  每轮目标数
                                </label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={strategy.per_run_target}
                                  onChange={(event) =>
                                    updateStrategy(index, {
                                      per_run_target: Number(event.target.value),
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            updateConfig((current) => ({
                              ...current,
                              search: {
                                ...current.search,
                                strategies: [
                                  ...current.search.strategies,
                                  createStrategy(),
                                ],
                              },
                            }))
                          }
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          新增策略组
                        </Button>
                      </div>
                    </CardContent>
                    <CardFooter className="flex flex-col items-start justify-between gap-4 rounded-b-xl border-t border-slate-100 bg-slate-50 py-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">
                          游标与冷却记录
                        </p>
                        <p className="text-xs text-slate-500">
                          重置游标不会清空数据库去重记录。
                        </p>
                      </div>
                      <div className="flex w-full gap-2 sm:w-auto">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 sm:flex-none"
                          disabled={busy}
                          onClick={() =>
                            void withFeedback(async () => {
                              await api.resetCrawlState(false);
                            }, "采集游标已重置")
                          }
                        >
                          重置游标
                        </Button>
                        <Button
                          className="flex-1 sm:flex-none"
                          disabled={busy}
                          onClick={() => void saveCrawl()}
                        >
                          保存采集策略
                        </Button>
                      </div>
                    </CardFooter>
                  </Card>
                )}
                {settingsTab === "providers" && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-slate-400" />
                        AI 引擎与模型
                      </CardTitle>
                      <CardDescription>
                        配置兼容 OpenAI API 的
                        Provider。项目介绍仅使用仓库公开资料，未知信息会明确标记。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-900">
                          GitHub Token
                        </label>
                        <Input
                          type="password"
                          value={githubToken}
                          onChange={(event) =>
                            setGithubToken(event.target.value)
                          }
                          placeholder={
                            secrets?.github_token.masked || "输入后保存"
                          }
                          autoComplete="off"
                        />
                        <p className="text-xs text-slate-500">
                          Token 可提高 GitHub API 配额；未配置时会自动降级。
                        </p>
                      </div>
                      <div className="border-t border-slate-100 pt-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">
                              模型通道
                            </h4>
                            <p className="mt-1 text-xs text-slate-500">
                              选择一个通道编辑；只有一个通道会作为当前介绍任务的
                              Provider。
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              updateConfig((current) => ({
                                ...current,
                                providers: [
                                  ...current.providers,
                                  {
                                    name: `provider-${current.providers.length + 1}`,
                                    base_url: "https://api.example.com/v1",
                                    model: "",
                                    active: current.providers.length === 0,
                                  },
                                ],
                              }));
                              setSelectedProvider(config.providers.length);
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            新增
                          </Button>
                        </div>
                        {config.providers.length ? (
                          <>
                            <div className="flex w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1">
                              {config.providers.map((provider, index) => (
                                <button
                                  type="button"
                                  key={`${provider.name}-${index}`}
                                  onClick={() => setSelectedProvider(index)}
                                  className={cn(
                                    "flex shrink-0 items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                                    selectedProvider === index
                                      ? "border border-slate-200/50 bg-white text-slate-900 shadow-sm"
                                      : "border border-transparent text-slate-500 hover:bg-slate-200/50 hover:text-slate-700",
                                  )}
                                >
                                  {provider.name || "未命名通道"}
                                  {provider.active && (
                                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                  )}
                                </button>
                              ))}
                            </div>
                            {activeProvider && (
                              <div className="mt-5 space-y-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">
                                      通道详情
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      保存模型配置后生效。
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant={
                                        activeProvider.active
                                          ? "success"
                                          : "secondary"
                                      }
                                    >
                                      {activeProvider.active
                                        ? "已启用"
                                        : "未启用"}
                                    </Badge>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        updateConfig((current) => ({
                                          ...current,
                                          providers: current.providers.filter(
                                            (_, index) =>
                                              index !== selectedProvider,
                                          ),
                                        }));
                                        setSelectedProvider(
                                          Math.max(0, selectedProvider - 1),
                                        );
                                      }}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      删除
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                  <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-900">
                                      通道名称
                                    </label>
                                    <Input
                                      value={activeProvider.name}
                                      onChange={(event) =>
                                        updateProvider(selectedProvider, {
                                          name: event.target.value,
                                        })
                                      }
                                      placeholder="例如 openai"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-900">
                                      模型名称
                                    </label>
                                    <Input
                                      value={activeProvider.model}
                                      onChange={(event) =>
                                        updateProvider(selectedProvider, {
                                          model: event.target.value,
                                        })
                                      }
                                      placeholder="例如 gpt-4o-mini"
                                    />
                                  </div>
                                  <div className="space-y-2 sm:col-span-2">
                                    <label className="text-sm font-medium text-slate-900">
                                      接口地址
                                    </label>
                                    <Input
                                      value={activeProvider.base_url}
                                      onChange={(event) =>
                                        updateProvider(selectedProvider, {
                                          base_url: event.target.value,
                                        })
                                      }
                                      placeholder="https://api.example.com/v1"
                                    />
                                  </div>
                                  <div className="space-y-2 sm:col-span-2">
                                    <label className="text-sm font-medium text-slate-900">
                                      API 密钥
                                    </label>
                                    <Input
                                      type="password"
                                      value={
                                        providerKeys[activeProvider.name] ?? ""
                                      }
                                      onChange={(event) =>
                                        setProviderKeys((current) => ({
                                          ...current,
                                          [activeProvider.name]:
                                            event.target.value,
                                        }))
                                      }
                                      placeholder={
                                        secrets?.providers[activeProvider.name]
                                          ?.masked || "输入后保存"
                                      }
                                      autoComplete="off"
                                    />
                                  </div>
                                </div>
                                {!activeProvider.active && (
                                  <Button
                                    variant="secondary"
                                    onClick={() =>
                                      updateConfig((current) => ({
                                        ...current,
                                        providers: current.providers.map(
                                          (provider, index) => ({
                                            ...provider,
                                            active: index === selectedProvider,
                                          }),
                                        ),
                                      }))
                                    }
                                  >
                                    设为当前启用项
                                  </Button>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-sm text-slate-500">
                            当前还没有任何模型通道，请先新增一项可用配置。
                          </div>
                        )}
                      </div>
                    </CardContent>
                    <CardFooter className="justify-end rounded-b-xl border-t border-slate-100 bg-slate-50 py-4">
                      <Button
                        className="w-full sm:w-auto"
                        disabled={busy}
                        onClick={() => void saveProviders()}
                      >
                        保存模型配置
                      </Button>
                    </CardFooter>
                  </Card>
                )}
                {settingsTab === "agent" && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Terminal className="h-5 w-5 text-slate-400" />
                        AI 分析任务
                      </CardTitle>
                      <CardDescription>
                        配置项目介绍的执行频次、每轮处理数量、公开文件读取轮数与失败重试限制。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <label className="text-sm font-medium text-slate-900">
                          任务 Cron
                        </label>
                        <Input
                          value={config.agent.cron}
                          onChange={(event) =>
                            updateConfig((current) => ({
                              ...current,
                              agent: {
                                ...current.agent,
                                cron: event.target.value,
                              },
                            }))
                          }
                          placeholder="*/10 * * * *"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-900">
                          每轮项目数
                        </label>
                        <Input
                          type="number"
                          min="1"
                          value={config.agent.batch_size}
                          onChange={(event) =>
                            updateConfig((current) => ({
                              ...current,
                              agent: {
                                ...current.agent,
                                batch_size: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-900">
                          最大读取轮数
                        </label>
                        <Input
                          type="number"
                          min="1"
                          value={config.agent.max_turns}
                          onChange={(event) =>
                            updateConfig((current) => ({
                              ...current,
                              agent: {
                                ...current.agent,
                                max_turns: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-900">
                          失败重试限制
                        </label>
                        <Input
                          type="number"
                            min="1"
                            value={config.agent.failure_retry_limit}
                          onChange={(event) =>
                            updateConfig((current) => ({
                              ...current,
                              agent: {
                                ...current.agent,
                                failure_retry_limit: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </div>
                    </CardContent>
                    <CardFooter className="justify-end rounded-b-xl border-t border-slate-100 bg-slate-50 py-4">
                      <Button
                        className="w-full sm:w-auto"
                        disabled={busy}
                        onClick={() => void saveAgent()}
                      >
                        保存分析任务
                      </Button>
                    </CardFooter>
                  </Card>
                )}
                {settingsTab === "notify" && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <CustomIcons.Feishu className="h-5 w-5" />
                        飞书通知集成
                      </CardTitle>
                      <CardDescription>
                        填写机器人凭据和群会话
                        ID。仓库介绍完成后可发送即时卡片，也可按固定时间发送每日摘要。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-5 flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">
                              群通知配置
                            </h4>
                            <p className="mt-1 text-xs text-slate-500">
                              只发送到指定飞书群聊。
                            </p>
                          </div>
                          <Badge
                            variant={
                              secrets?.feishu.group_chat_configured
                                ? "success"
                                : "warning"
                            }
                          >
                            {secrets?.feishu.group_chat_configured
                              ? "已就绪"
                              : "待完善"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-900">
                              App ID
                            </label>
                            <Input
                              value={feishuForm.app_id}
                              onChange={(event) =>
                                setFeishuForm((current) => ({
                                  ...current,
                                  app_id: event.target.value,
                                }))
                              }
                              placeholder="输入飞书 App ID"
                              autoComplete="off"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-900">
                              App Secret
                            </label>
                            <Input
                              type="password"
                              value={feishuForm.app_secret}
                              onChange={(event) =>
                                setFeishuForm((current) => ({
                                  ...current,
                                  app_secret: event.target.value,
                                }))
                              }
                              placeholder="输入飞书 App Secret"
                              autoComplete="off"
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium text-slate-900">
                              群会话 ID
                            </label>
                            <Input
                              value={feishuForm.group_chat_id}
                              onChange={(event) =>
                                setFeishuForm((current) => ({
                                  ...current,
                                  group_chat_id: event.target.value,
                                }))
                              }
                              placeholder="oc_xxxxxxxxxxxxxxxxx"
                              autoComplete="off"
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>
                        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Button
                            className="w-full"
                            disabled={busy}
                            onClick={() => void saveNotify()}
                          >
                            保存配置
                          </Button>
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled={
                              busy || !secrets?.feishu.group_chat_configured
                            }
                            onClick={() =>
                              void withFeedback(async () => {
                                await api.testFeishu();
                              }, "飞书测试消息已发送")
                            }
                          >
                            发送测试消息
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-slate-900">
                              通知调度
                            </h5>
                            <p className="mt-1 text-xs text-slate-500">
                              即时通知用于单仓库介绍完成时推送；每日摘要按 Stars
                              排序发送。
                            </p>
                          </div>
                          <Badge
                            variant={
                              config.notify.daily_digest_enabled
                                ? "success"
                                : "warning"
                            }
                          >
                            {config.notify.daily_digest_enabled
                              ? "每日摘要已开启"
                              : "每日摘要已关闭"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-slate-900">
                                  即时推送
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  项目介绍完成后立即发送。
                                </p>
                              </div>
                              <Switch
                                checked={config.notify.instant_enabled}
                                onCheckedChange={(instant_enabled) =>
                                  updateConfig((current) => ({
                                    ...current,
                                    notify: {
                                      ...current.notify,
                                      instant_enabled,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-slate-900">
                                  每日摘要
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  按固定时间汇总当天已介绍项目。
                                </p>
                              </div>
                              <Switch
                                checked={config.notify.daily_digest_enabled}
                                onCheckedChange={(daily_digest_enabled) =>
                                  updateConfig((current) => ({
                                    ...current,
                                    notify: {
                                      ...current.notify,
                                      daily_digest_enabled,
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div
                            className={cn(
                              "space-y-2",
                              !config.notify.daily_digest_enabled &&
                                "opacity-60",
                            )}
                          >
                            <label className="text-sm font-medium text-slate-900">
                              每日摘要 Cron
                            </label>
                            <Input
                              value={config.notify.daily_digest_crons[0] || ""}
                              disabled={!config.notify.daily_digest_enabled}
                              onChange={(event) =>
                                updateConfig((current) => ({
                                  ...current,
                                  notify: {
                                    ...current.notify,
                                    daily_digest_crons: [event.target.value],
                                  },
                                }))
                              }
                              placeholder="0 18 * * *"
                            />
                            <p className="text-xs text-slate-500">
                              当前版本保留一个固定摘要时间。
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                    <CardFooter className="justify-end rounded-b-xl border-t border-slate-100 bg-slate-50 py-4">
                      <Button
                        className="w-full sm:w-auto"
                        disabled={busy}
                        onClick={() => void saveNotify()}
                      >
                        保存通知调度
                      </Button>
                    </CardFooter>
                  </Card>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ControlPanel({
  title,
  description,
  enabled,
  running,
  busy,
  onClick,
}: {
  title: string;
  description: string;
  enabled: boolean;
  running: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <Badge variant={enabled ? "success" : "warning"}>
          {enabled ? "已启用" : "已暂停"}
        </Badge>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        当前状态: {running ? "执行中" : enabled ? "等待调度" : "暂停中"}
      </div>
      <Button
        className="w-full"
        variant={enabled ? "outline" : "default"}
        disabled={busy}
        onClick={onClick}
      >
        {enabled ? (
          <Pause className="mr-2 h-4 w-4" />
        ) : (
          <Play className="mr-2 h-4 w-4" />
        )}
        {enabled ? "暂停任务" : "恢复并立即补跑"}
      </Button>
    </div>
  );
}
