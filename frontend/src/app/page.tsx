"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth-provider";
import { API_ROOT } from "@/lib/auth";

type View = "dashboard" | "chat" | "tickets" | "analytics" | "settings";
type ThemePreference = "system" | "light" | "dark";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type Chat = {
  id: number;
  title: string;
  messages: Message[];
};

type ClassifiedTicket = {
  category: string;
  priority: string;
  severity: string;
  summary: string;
};

type SavedTicket = {
  id: number;
  ticket_number: string;
  status: string;
  created_at: string;
};

type TicketRecord = {
  id: number;
  ticket_number: string;
  user_id: string;
  issue: string;
  category: string | null;
  priority: string | null;
  severity: string | null;
  summary: string | null;
  status: string | null;
  created_at: string | null;
  requester?: { display_name: string | null; email: string };
};

type TicketStats = {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  high_priority: number;
};

type TicketListResponse = {
  tickets: TicketRecord[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

const PAGE_SIZE = 10;
const STATUS_OPTIONS = ["Open", "In Progress", "Resolved"] as const;
const THEME_EVENT = "nexora-theme-change";

function getThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem("nexora-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    return "system";
  }
}

function subscribeThemePreference(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getServerThemePreference(): ThemePreference {
  return "system";
}

const welcomeMessage: Message = {
  id: 1,
  role: "assistant",
  content:
    "Hello! I'm Nexora AI, your IT Helpdesk Assistant. Describe your technical issue and I'll help you troubleshoot it.",
};

const iconPaths: Record<string, string[]> = {
  grid: ["M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"],
  chat: ["M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"],
  ticket: ["M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6z", "M13 5v2M13 11v2M13 17v2"],
  chart: ["M3 3v18h18", "M18 17V9M13 17V5M8 17v-3"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.2-.1a1.7 1.7 0 0 0-1.8.2l-.2.1h-3.2l-.1-.2a1.7 1.7 0 0 0-1.5-1l-.2.1-2.8-1.6.1-.2a1.7 1.7 0 0 0-.2-1.8L8 15V9l.2-.1a1.7 1.7 0 0 0 .2-1.8l-.1-.2 2.8-1.6.2.1a1.7 1.7 0 0 0 1.8-.2l.1-.2h3.2l.2.2a1.7 1.7 0 0 0 1.5 1l.2-.1 2.8 1.6-.1.2a1.7 1.7 0 0 0 .2 1.8l.2.1v3.2z"],
  sun: ["M12 3v2M12 19v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"],
  moon: ["M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13z"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  refresh: ["M20 7v5h-5", "M4 17v-5h5", "M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  left: ["m15 18-6-6 6-6"],
  right: ["m9 18 6-6-6-6"],
  close: ["m18 6-12 12M6 6l12 12"],
  clock: ["M12 8v4l3 2", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z"],
  check: ["m5 12 4 4L19 6"],
  shield: ["M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z", "m9 12 2 2 4-4"],
  spark: ["m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z", "m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14z"],
  arrow: ["M7 17 17 7", "M7 7h10v10"],
  logout: ["M10 17l5-5-5-5", "M15 12H3", "M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"],
  filter: ["M4 7h16M7 12h10m-7 5h4", "M6 7a1 1 0 1 0 0 .01M18 7a1 1 0 1 0 0 .01"],
};

function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: keyof typeof iconPaths;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { ...init, credentials: "include" });
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? String(payload.detail)
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }

  return payload as T;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function StatusBadge({ status }: { status: string | null }) {
  const normalized = (status ?? "Unknown").toLowerCase();
  const color = normalized === "open"
    ? "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-300/20"
    : normalized === "in progress"
      ? "bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-300/20"
      : normalized === "resolved"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-300/20"
        : "bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-700/60 dark:text-slate-300 dark:ring-slate-500/30";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status ?? "Unknown"}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  const normalized = (priority ?? "Unassigned").toLowerCase();
  const color = normalized === "critical" || normalized === "high"
    ? "bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-300/20"
    : normalized === "medium"
      ? "bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-300/20"
      : "bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-700/60 dark:text-slate-300 dark:ring-slate-500/30";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${color}`}>
      {priority ?? "Unassigned"}
    </span>
  );
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const normalized = text.replace(/\\([\\`*_{}\[\]()#+.!>~-])/g, "$1");
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of normalized.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) output.push(normalized.slice(cursor, index));
    const token = match[0];
    const strong = token.startsWith("**") || token.startsWith("__");
    const content = token.slice(strong ? 2 : 1, strong ? -2 : -1);
    const key = `${index}-${token}`;
    if (strong) output.push(<strong key={key} className="font-semibold text-slate-900 dark:text-white">{content}</strong>);
    else if (token.startsWith("`")) output.push(<code key={key} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-slate-800">{content}</code>);
    else output.push(<em key={key}>{content}</em>);
    cursor = index + token.length;
  }
  if (cursor < normalized.length) output.push(normalized.slice(cursor));
  return output;
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, index) => <span key={index}>{index > 0 && <br />}{renderInlineMarkdown(line)}</span>)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>);
    blocks.push(list.ordered ? <ol key={`list-${blocks.length}`} className="list-decimal space-y-1 pl-6">{items}</ol> : <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-6">{items}</ul>);
    list = null;
  };
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      flushParagraph(); flushList();
      if (code) {
        blocks.push(<pre key={`code-${blocks.length}`} className="max-w-full overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{code.join("\n")}</code></pre>);
        code = null;
      } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push(<h3 key={`h-${blocks.length}`} className={heading[1].length <= 2 ? "text-base font-bold text-slate-900 dark:text-white" : "text-sm font-semibold text-slate-900 dark:text-white"}>{renderInlineMarkdown(heading[2])}</h3>);
      continue;
    }
    const item = /^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const ordered = Boolean(item[1]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(item[2]);
      continue;
    }
    flushList(); paragraph.push(line);
  }
  if (code) blocks.push(<pre key={`code-${blocks.length}`} className="max-w-full overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{code.join("\n")}</code></pre>);
  flushParagraph(); flushList();
  return <div className="space-y-3 break-words">{blocks}</div>;
}

function MetricCard({
  title,
  value,
  caption,
  icon,
  tone,
  loading,
}: {
  title: string;
  value: number | undefined;
  caption: string;
  icon: keyof typeof iconPaths;
  tone: string;
  loading: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.025] transition-colors dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          {loading && value === undefined ? (
            <div className="mt-3 h-9 w-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ) : (
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{value?.toLocaleString() ?? "—"}</p>
          )}
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
          <Icon name={icon} size={20} />
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{caption}</p>
    </article>
  );
}

function EmptyState({
  title,
  description,
  icon = "ticket",
}: {
  title: string;
  description: string;
  icon?: keyof typeof iconPaths;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <Icon name={icon} size={21} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

function TicketTable({
  tickets,
  onOpen,
  onStatusChange,
  updatingTicketId,
  compact = false,
}: {
  tickets: TicketRecord[];
  onOpen: (ticket: TicketRecord) => void;
  onStatusChange: (ticket: TicketRecord, status: string) => void;
  updatingTicketId: number | null;
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left">
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            <th className="px-5 py-3.5">Ticket</th>
            <th className="px-4 py-3.5">Category</th>
            <th className="px-4 py-3.5">Priority</th>
            {!compact && <th className="px-4 py-3.5">Severity</th>}
            <th className="px-4 py-3.5">Status</th>
            <th className="px-4 py-3.5">Created</th>
            <th className="px-5 py-3.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {tickets.map((ticket) => (
            <tr key={ticket.id} className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
              <td className="px-5 py-4">
                <button
                  type="button"
                  onClick={() => onOpen(ticket)}
                  className="text-left text-sm font-semibold text-slate-900 hover:text-blue-700 dark:text-slate-100 dark:hover:text-blue-300"
                >
                  {ticket.ticket_number}
                  <span className="mt-1 block max-w-[220px] truncate text-xs font-normal text-slate-500 dark:text-slate-400">{ticket.issue}</span>
                </button>
              </td>
              <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">{ticket.category ?? "Uncategorized"}</td>
              <td className="px-4 py-4"><PriorityBadge priority={ticket.priority} /></td>
              {!compact && <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">{ticket.severity ?? "—"}</td>}
              <td className="px-4 py-4">
                <label className="sr-only" htmlFor={`status-${ticket.id}`}>Status for {ticket.ticket_number}</label>
                <select
                  id={`status-${ticket.id}`}
                  value={ticket.status ?? "Open"}
                  disabled={updatingTicketId === ticket.id}
                  onChange={(event) => onStatusChange(ticket, event.target.value)}
                  className="max-w-[145px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                {updatingTicketId === ticket.id && <span className="ml-2 text-[11px] text-blue-600 dark:text-blue-300">Saving</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500 dark:text-slate-400">{formatDate(ticket.created_at)}</td>
              <td className="px-5 py-4 text-right">
                <button type="button" onClick={() => onOpen(ticket)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-400/10">
                  View details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const { user, logout } = useAuth();
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [logoutError, setLogoutError] = useState("");
  const themePreference = useSyncExternalStore(
    subscribeThemePreference,
    getThemePreference,
    getServerThemePreference,
  );

  const [chats, setChats] = useState<Chat[]>([
    { id: 1, title: "New conversation", messages: [welcomeMessage] },
  ]);
  const [activeChat, setActiveChat] = useState(1);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [issue, setIssue] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [classifiedTicket, setClassifiedTicket] = useState<ClassifiedTicket | null>(null);
  const [ticketError, setTicketError] = useState("");
  const [savingTicket, setSavingTicket] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedTicket, setSavedTicket] = useState<SavedTicket | null>(null);
  const [ticketComposerOpen, setTicketComposerOpen] = useState(false);

  const [stats, setStats] = useState<TicketStats | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [ticketPage, setTicketPage] = useState(1);
  const [pagination, setPagination] = useState<TicketListResponse["pagination"] | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [priorityFilter, setPriorityFilter] = useState("All priorities");
  const [updatingTicketId, setUpdatingTicketId] = useState<number | null>(null);
  const [ticketActionError, setTicketActionError] = useState("");
  const [detailTicket, setDetailTicket] = useState<TicketRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const saveInFlight = useRef(false);
  const nextMessageId = useRef(2);
  const dashboardRequestId = useRef(0);
  const currentChat = chats.find((chat) => chat.id === activeChat);
  const messages = currentChat?.messages ?? [];

  useEffect(() => {
    if (themePreference !== "system") {
      document.documentElement.classList.toggle("dark", themePreference === "dark");
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", event.matches);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [themePreference]);

  const applyTheme = useCallback((preference: ThemePreference) => {
    const mediaDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedDark = preference === "dark" || (preference === "system" && mediaDark);
    const root = document.documentElement;
    root.classList.add("theme-transition");
    root.classList.toggle("dark", resolvedDark);
    window.setTimeout(() => root.classList.remove("theme-transition"), 220);
    try {
      window.localStorage.setItem("nexora-theme", preference);
    } catch {
      // Keep the current theme active if browser storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const loadDashboard = useCallback(async () => {
    const requestId = ++dashboardRequestId.current;
    setDashboardLoading(true);
    setDashboardError("");

    try {
      const [nextStats, ticketResponse] = await Promise.all([
        apiRequest<TicketStats>("/tickets/stats"),
        apiRequest<TicketListResponse>(`/tickets?page=${ticketPage}&page_size=${PAGE_SIZE}`),
      ]);
      if (requestId !== dashboardRequestId.current) return;
      setStats(nextStats);
      setTickets(ticketResponse.tickets);
      setPagination(ticketResponse.pagination);
    } catch (error) {
      if (requestId !== dashboardRequestId.current) return;
      setDashboardError(error instanceof Error ? error.message : "Unable to load ticket data.");
    } finally {
      if (requestId === dashboardRequestId.current) setDashboardLoading(false);
    }
  }, [ticketPage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadDashboard]);

  function createNewChat() {
    if (chatLoading) return;
    const id = Date.now();
    setChats((previous) => [
      { id, title: "New conversation", messages: [{ ...welcomeMessage, id: id + 1 }] },
      ...previous,
    ]);
    setActiveChat(id);
    setActiveView("chat");
    setChatInput("");
  }

  function updateMessages(newMessages: Message[]) {
    setChats((previous) => previous.map((chat) => chat.id === activeChat
      ? {
          ...chat,
          messages: newMessages,
          title: chat.title === "New conversation" && newMessages.some((message) => message.role === "user")
            ? newMessages.find((message) => message.role === "user")?.content.slice(0, 30) || chat.title
            : chat.title,
        }
      : chat));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const updated = [...messages, { id: nextMessageId.current++, role: "user" as const, content: text }];
    updateMessages(updated);
    setChatInput("");
    setChatLoading(true);
    try {
      const data = await apiRequest<{ response: string }>("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, user_id: "demo_user" }),
      });
      updateMessages([...updated, { id: nextMessageId.current++, role: "assistant", content: data.response }]);
    } catch {
      updateMessages([...updated, {
        id: nextMessageId.current++,
        role: "assistant",
        content: "Backend connection failed. Please check whether FastAPI is running on port 8080.",
      }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function classifyIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issue.trim() || classifying) return;
    setClassifying(true);
    setClassifiedTicket(null);
    setTicketError("");
    setSavedTicket(null);
    setSaveError("");
    try {
      const data = await apiRequest<{ ticket: ClassifiedTicket }>("/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue: issue.trim(), user_id: "demo_user" }),
      });
      setClassifiedTicket(data.ticket);
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : "Unable to classify this issue.");
    } finally {
      setClassifying(false);
    }
  }

  async function saveTicket() {
    if (!classifiedTicket || !issue.trim() || saveInFlight.current || savedTicket) return;
    saveInFlight.current = true;
    setSavingTicket(true);
    setSaveError("");
    try {
      const data = await apiRequest<{ ticket: SavedTicket }>("/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue: issue.trim(), user_id: "demo_user",
          category: classifiedTicket.category, priority: classifiedTicket.priority,
          severity: classifiedTicket.severity, summary: classifiedTicket.summary,
        }),
      });
      setSavedTicket(data.ticket);
      void loadDashboard();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save support ticket. Please try again.");
    } finally {
      saveInFlight.current = false;
      setSavingTicket(false);
    }
  }

  async function changeTicketStatus(ticket: TicketRecord, status: string) {
    setUpdatingTicketId(ticket.id);
    setTicketActionError("");
    try {
      await apiRequest<TicketRecord>(`/tickets/${ticket.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await loadDashboard();
    } catch (error) {
      setTicketActionError(error instanceof Error ? error.message : "Unable to update ticket status.");
    } finally {
      setUpdatingTicketId(null);
    }
  }

  async function openTicket(ticket: TicketRecord) {
    setDetailTicket(ticket);
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await apiRequest<TicketRecord>(`/tickets/${ticket.id}`);
      setDetailTicket(detail);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load ticket details.");
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
  }

  async function handleLogout() {
    setLogoutError("");
    try {
      await logout();
    } catch {
      setLogoutError("Unable to sign out right now. Please try again.");
    }
  }

  const profileName = user?.display_name?.trim() || user?.email || "Nexora user";
  const profileInitials = profileName.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "N";

  const filteredTickets = tickets.filter((ticket) => {
    const query = ticketSearch.trim().toLowerCase();
    const matchesQuery = !query || [ticket.ticket_number, ticket.issue, ticket.category ?? ""]
      .some((value) => value.toLowerCase().includes(query));
    const matchesStatus = statusFilter === "All statuses" || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === "All priorities" || ticket.priority === priorityFilter;
    return matchesQuery && matchesStatus && matchesPriority;
  });

  const pageTitles: Record<View, { title: string; subtitle: string }> = {
    dashboard: { title: "Dashboard", subtitle: "An overview of your IT support operations." },
    chat: { title: "AI Support Assistant", subtitle: "Troubleshoot issues with Nexora AI." },
    tickets: { title: "Support Tickets", subtitle: "Review, search, and manage incoming support requests." },
    analytics: { title: "Analytics", subtitle: "Understand ticket status and priority across your workspace." },
    settings: { title: "Settings", subtitle: "Manage your workspace appearance and preferences." },
  };

  const navItems: { id: View; label: string; icon: keyof typeof iconPaths }[] = [
    { id: "dashboard", label: "Dashboard", icon: "grid" },
    { id: "chat", label: "AI Chat", icon: "chat" },
    { id: "tickets", label: "Support Tickets", icon: "ticket" },
    { id: "analytics", label: "Analytics", icon: "chart" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  const pageCount = Math.max(1, pagination?.total_pages ?? 1);
  const statusChart = [
    { label: "Open", value: stats?.open ?? 0, color: "bg-amber-500" },
    { label: "In progress", value: stats?.in_progress ?? 0, color: "bg-blue-500" },
    { label: "Resolved", value: stats?.resolved ?? 0, color: "bg-emerald-500" },
    { label: "Other", value: Math.max(0, (stats?.total ?? 0) - (stats?.open ?? 0) - (stats?.in_progress ?? 0) - (stats?.resolved ?? 0)), color: "bg-slate-400" },
  ];

  return (
    <main className="flex h-[100dvh] overflow-hidden bg-slate-50 font-sans text-slate-900 transition-colors dark:bg-[#0b1120] dark:text-slate-100">
      <aside className="z-20 flex w-[250px] shrink-0 flex-col border-r border-slate-200 bg-white transition-colors dark:border-slate-800 dark:bg-[#0e1728] max-md:w-[68px]">
        <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-slate-100 px-5 dark:border-slate-800 max-md:justify-center max-md:px-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-lg font-bold text-white shadow-lg shadow-blue-600/20">N</div>
          <div className="min-w-0 max-md:hidden">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Nexora <span className="text-blue-600 dark:text-blue-400">AI</span></h1>
            <p className="text-[9px] font-semibold tracking-[0.16em] text-slate-400">INTELLIGENT IT SUPPORT</p>
          </div>
        </div>

        <div className="p-4 max-md:px-2">
          <button type="button" onClick={createNewChat} title="Start a new conversation" className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20">
            <Icon name="spark" size={17} /><span className="max-md:hidden">New conversation</span>
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 max-md:px-2">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 max-md:hidden">Workspace</p>
          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.label}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => setActiveView(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition max-md:justify-center max-md:px-2 ${activeView === item.id ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white"}`}
              >
                <Icon name={item.icon} size={18} />
                <span className="max-md:hidden">{item.label}</span>
                {item.id === "tickets" && stats && <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400 max-md:hidden">{stats.open}</span>}
              </button>
            ))}
          </div>

          {activeView === "chat" && (
            <div className="mt-8 max-md:hidden">
              <div className="mb-2 flex items-center justify-between px-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Recent chats</p>
                <span className="text-[10px] text-slate-400">{chats.length}</span>
              </div>
              {chats.map((chat) => (
                <button key={chat.id} type="button" onClick={() => setActiveChat(chat.id)} className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition ${activeChat === chat.id ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white" : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60"}`}>
                  <Icon name="chat" size={14} /><span className="truncate">{chat.title}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="border-t border-slate-100 p-3 dark:border-slate-800 max-md:px-2">
          <button type="button" onClick={toggleTheme} title="Toggle light or dark mode" aria-label="Toggle light or dark mode" className="mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 max-md:justify-center max-md:px-2">
            <span className="dark:hidden"><Icon name="moon" size={18} /></span><span className="hidden dark:inline"><Icon name="sun" size={18} /></span>
            <span className="max-md:hidden">Toggle appearance</span>
          </button>
            <div className="flex items-center gap-3 rounded-xl px-2 py-2 max-md:justify-center max-md:px-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">{profileInitials}</div>
            <div className="min-w-0 max-md:hidden"><p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{profileName}</p><p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">{user?.email}</p></div>
          </div>
          <button type="button" onClick={() => void handleLogout()} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 dark:text-slate-300 dark:hover:bg-rose-400/10 dark:hover:text-rose-300 max-md:px-2" title="Sign out"><Icon name="logout" size={17} /><span className="max-md:hidden">Sign out</span></button>
          {logoutError && <p role="alert" className="px-2 pb-1 text-xs text-rose-700 dark:text-rose-300">{logoutError}</p>}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-7 backdrop-blur transition-colors dark:border-slate-800 dark:bg-[#0e1728]/90 max-sm:px-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold tracking-tight text-slate-900 dark:text-white">{pageTitles[activeView].title}</h2>
            <p className="mt-1 hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block">{pageTitles[activeView].subtitle}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {(activeView === "dashboard" || activeView === "tickets" || activeView === "analytics") && (
              <button type="button" onClick={() => void loadDashboard()} disabled={dashboardLoading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                <Icon name="refresh" size={16} className={dashboardLoading ? "animate-spin" : ""} /><span className="hidden sm:inline">Refresh</span>
              </button>
            )}
            <button type="button" onClick={toggleTheme} aria-label="Toggle light or dark mode" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
              <span className="dark:hidden"><Icon name="moon" size={17} /></span><span className="hidden dark:inline"><Icon name="sun" size={17} /></span>
            </button>
            <div aria-label={profileName} title={profileName} className="hidden h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300 sm:flex">{profileInitials}</div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeView === "dashboard" && (
            <div className="mx-auto max-w-[1500px] space-y-6 p-6 max-lg:p-5 max-sm:p-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Welcome back, {user?.display_name?.trim() || user?.email || "there"}</p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-[28px]">Your support overview</h1>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Here’s what’s happening across your helpdesk.</p>
                </div>
                <button type="button" onClick={() => setActiveView("tickets")} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 dark:bg-blue-600 dark:hover:bg-blue-500">
                  <Icon name="ticket" size={16} /> Manage tickets <Icon name="arrow" size={14} />
                </button>
              </div>

              {dashboardError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"><span>{dashboardError}</span><button type="button" onClick={() => void loadDashboard()} className="font-semibold underline underline-offset-2">Try again</button></div>}
              {ticketActionError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{ticketActionError}</div>}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <MetricCard title="Total Tickets" value={stats?.total} caption="All support requests" icon="ticket" tone="bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300" loading={dashboardLoading} />
                <MetricCard title="Open Tickets" value={stats?.open} caption="Waiting for support" icon="clock" tone="bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300" loading={dashboardLoading} />
                <MetricCard title="In Progress" value={stats?.in_progress} caption="Currently being handled" icon="refresh" tone="bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300" loading={dashboardLoading} />
                <MetricCard title="Resolved" value={stats?.resolved} caption="Successfully completed" icon="check" tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" loading={dashboardLoading} />
                <MetricCard title="High Priority" value={stats?.high_priority} caption="Requires close attention" icon="shield" tone="bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300" loading={dashboardLoading} />
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
                <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
                    <div><h2 className="text-base font-bold text-slate-900 dark:text-white">Recent tickets</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Latest requests from your support queue</p></div>
                    <button type="button" onClick={() => setActiveView("tickets")} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200">View all <Icon name="right" size={14} /></button>
                  </div>
                  {dashboardLoading && tickets.length === 0 ? <div className="space-y-3 px-6 pb-6"><div className="h-11 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /><div className="h-11 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /><div className="h-11 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></div>
                    : dashboardError && tickets.length === 0 ? <EmptyState title="Ticket data unavailable" description="Refresh the dashboard after confirming the backend is available." icon="refresh" />
                      : tickets.length === 0 ? <EmptyState title="No tickets yet" description="New support requests will appear here when they are created." />
                      : <TicketTable tickets={tickets.slice(0, 5)} onOpen={openTicket} onStatusChange={changeTicketStatus} updatingTicketId={updatingTicketId} compact />}
                </section>

                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 sm:p-6">
                  <div className="flex items-start justify-between"><div><h2 className="text-base font-bold text-slate-900 dark:text-white">Ticket status</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Current workload by status</p></div><span className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300"><Icon name="chart" size={17} /></span></div>
                  <div className="mt-7 space-y-5">
                    {statusChart.map((item) => {
                      const percent = stats?.total ? Math.min(100, (item.value / stats.total) * 100) : 0;
                      return <div key={item.label}><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.label}</span><span className="font-semibold text-slate-900 dark:text-white">{dashboardLoading && !stats ? "—" : item.value.toLocaleString()}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${item.color} transition-all duration-500`} style={{ width: `${percent}%` }} /></div></div>;
                    })}
                  </div>
                  <div className="mt-7 flex items-center gap-3 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"><Icon name="spark" size={17} /></span><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Ticket insights update from your live support queue.</p></div>
                </section>
              </div>
            </div>
          )}

          {activeView === "tickets" && (
            <div className="mx-auto max-w-[1500px] space-y-5 p-6 max-lg:p-5 max-sm:p-4">
              <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Support Tickets</h1><p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Search, review, and update support requests.</p></div><div className="flex items-center gap-2"><div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"><span className="font-semibold text-slate-900 dark:text-white">{pagination?.total ?? "—"}</span> total tickets</div><button type="button" onClick={() => { setTicketComposerOpen((open) => !open); setTicketError(""); setSaveError(""); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"><Icon name={ticketComposerOpen ? "close" : "spark"} size={15} />{ticketComposerOpen ? "Close form" : "New AI ticket"}</button></div></div>
              {dashboardError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"><span>{dashboardError}</span><button type="button" onClick={() => void loadDashboard()} className="font-semibold underline underline-offset-2">Try again</button></div>}
              {ticketActionError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{ticketActionError}</div>}
              {ticketComposerOpen ? (
                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 sm:p-6">
                  <div className="mb-5"><h2 className="text-base font-bold text-slate-900 dark:text-white">Create a support ticket</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Describe the issue and Nexora AI will classify it before saving.</p></div>
                  <form onSubmit={classifyIssue}>
                    <label htmlFor="ticket-issue" className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Describe the IT issue</label>
                    <textarea id="ticket-issue" value={issue} onChange={(event) => setIssue(event.target.value)} required rows={5} placeholder="Example: My office laptop is connected to Wi-Fi but internet is not working…" className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-950" />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500 dark:text-slate-400">AI-generated classification can be reviewed before saving.</p><button type="submit" disabled={!issue.trim() || classifying} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Icon name="spark" size={16} />{classifying ? "Classifying…" : "Classify issue"}</button></div>
                  </form>
                  {ticketError && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{ticketError}</div>}
                  {classifiedTicket && <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900 dark:text-white">Classification result</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review the AI assessment before saving this request.</p></div><div className="flex gap-2"><PriorityBadge priority={classifiedTicket.priority} /><StatusBadge status="Open" /></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><p className="text-xs text-slate-500 dark:text-slate-400">Category</p><p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{classifiedTicket.category}</p></div><div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><p className="text-xs text-slate-500 dark:text-slate-400">Priority</p><p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{classifiedTicket.priority}</p></div><div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><p className="text-xs text-slate-500 dark:text-slate-400">Severity</p><p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{classifiedTicket.severity}</p></div></div><div className="mt-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">AI summary</p><p className="mt-2 rounded-lg bg-white p-3 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-300">{classifiedTicket.summary}</p></div>{savedTicket ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"><span><strong>{savedTicket.ticket_number}</strong> created · {savedTicket.status}</span><button type="button" onClick={() => { setTicketComposerOpen(false); setSavedTicket(null); setIssue(""); setClassifiedTicket(null); }} className="font-semibold underline underline-offset-2">Return to ticket queue</button></div> : <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={saveTicket} disabled={savingTicket || !issue.trim()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{savingTicket ? "Saving ticket…" : "Save support ticket"}</button>{saveError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{saveError}</p>}</div>}</div>}
                </section>
              ) : (
              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
                  <div><h2 className="text-sm font-bold text-slate-900 dark:text-white">All tickets</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Filter the tickets shown on this page.</p></div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <label className="relative min-w-[190px] flex-1 sm:flex-none"><span className="sr-only">Search tickets on this page</span><Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={ticketSearch} onChange={(event) => setTicketSearch(event.target.value)} placeholder="Search this page" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500" /></label>
                    <label><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><option>All statuses</option>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
                    <label><span className="sr-only">Filter by priority</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><option>All priorities</option>{["Critical", "High", "Medium", "Low"].map((priority) => <option key={priority}>{priority}</option>)}</select></label>
                  </div>
                </div>
                {dashboardLoading && tickets.length === 0 ? <div className="space-y-3 p-6"><div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /><div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /><div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></div>
                  : dashboardError && tickets.length === 0 ? <EmptyState title="Ticket data unavailable" description="Refresh the queue after confirming the backend is available." icon="refresh" />
                    : filteredTickets.length === 0 ? <EmptyState title={tickets.length ? "No matching tickets" : "No tickets yet"} description={tickets.length ? "Try adjusting the search or filters for this page." : "Created support tickets will appear here."} icon="search" />
                    : <TicketTable tickets={filteredTickets} onOpen={openTicket} onStatusChange={changeTicketStatus} updatingTicketId={updatingTicketId} />}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Page <span className="font-semibold text-slate-700 dark:text-slate-200">{ticketPage}</span> of <span className="font-semibold text-slate-700 dark:text-slate-200">{pageCount}</span>{pagination && <span> · {pagination.total} tickets</span>}</p>
                  <div className="flex items-center gap-2"><button type="button" disabled={ticketPage <= 1 || dashboardLoading} onClick={() => setTicketPage((page) => Math.max(1, page - 1))} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><Icon name="left" size={14} /> Previous</button><button type="button" disabled={ticketPage >= pageCount || dashboardLoading} onClick={() => setTicketPage((page) => Math.min(pageCount, page + 1))} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Next <Icon name="right" size={14} /></button></div>
                </div>
              </section>
              )}
            </div>
          )}

          {activeView === "analytics" && (
            <div className="mx-auto max-w-[1300px] space-y-6 p-6 max-lg:p-5 max-sm:p-4">
              <div><h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Support analytics</h1><p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">A live snapshot based on your ticket records.</p></div>
              {dashboardError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{dashboardError}</div>}
              {ticketActionError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{ticketActionError}</div>}
              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80"><h2 className="text-base font-bold text-slate-900 dark:text-white">Tickets by status</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Distribution from live aggregate statistics</p><div className="mt-7 space-y-5">{statusChart.map((item) => { const percent = stats?.total ? Math.min(100, (item.value / stats.total) * 100) : 0; return <div key={item.label}><div className="mb-2 flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-300">{item.label}</span><span className="font-semibold text-slate-900 dark:text-white">{dashboardLoading && !stats ? "—" : item.value.toLocaleString()} <span className="font-normal text-slate-400">({Math.round(percent)}%)</span></span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${item.color}`} style={{ width: `${percent}%` }} /></div></div>; })}</div></section>
                <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80"><h2 className="text-base font-bold text-slate-900 dark:text-white">Priority overview</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">High-priority requests compared with all other priorities</p><div className="mt-8 flex items-center gap-7"><div className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#f43f5e ${(stats?.total ? (stats.high_priority / stats.total) * 100 : 0) * 3.6}deg, var(--chart-track) 0deg)` }}><div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900"><span className="text-2xl font-bold text-slate-900 dark:text-white">{stats?.high_priority.toLocaleString() ?? "—"}</span><span className="text-[10px] text-slate-500">High priority</span></div></div><div className="space-y-4 text-sm"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-500"/><span className="text-slate-600 dark:text-slate-300">High priority</span><strong className="ml-auto text-slate-900 dark:text-white">{stats?.high_priority.toLocaleString() ?? "—"}</strong></div><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600"/><span className="text-slate-600 dark:text-slate-300">Other priorities</span><strong className="ml-auto text-slate-900 dark:text-white">{stats ? Math.max(0, stats.total - stats.high_priority).toLocaleString() : "—"}</strong></div><p className="max-w-xs text-xs leading-5 text-slate-500 dark:text-slate-400">Counts are provided by the support ticket statistics API.</p></div></div></section>
              </div>
              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80"><div className="flex items-center justify-between px-5 py-5 sm:px-6"><div><h2 className="text-base font-bold text-slate-900 dark:text-white">Latest activity</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Most recent tickets from the current page</p></div><button type="button" onClick={() => setActiveView("tickets")} className="text-xs font-semibold text-blue-700 dark:text-blue-300">Open ticket queue →</button></div>{tickets.length ? <TicketTable tickets={tickets.slice(0, 5)} onOpen={openTicket} onStatusChange={changeTicketStatus} updatingTicketId={updatingTicketId} compact /> : <EmptyState title="No ticket activity" description="Ticket activity will appear here when records are available." />}</section>
            </div>
          )}

          {activeView === "chat" && (
            <div className="flex h-full min-h-[500px] flex-col">
              <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8"><div className="mx-auto max-w-3xl space-y-6">
                {messages.length === 1 && <div className="mb-10 mt-10 text-center"><div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20"><Icon name="spark" size={25} /></div><h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">How can I help you today?</h2><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Ask Nexora AI about an IT issue or describe what you need help with.</p></div>}
                {messages.map((message) => <div key={message.id} className={`flex items-start gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${message.role === "assistant" ? "bg-blue-600 text-white" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"}`}>{message.role === "assistant" ? "N" : profileInitials}</div><div className={`max-w-[82%] min-w-0 rounded-2xl px-5 py-4 text-sm leading-7 shadow-sm ${message.role === "user" ? "rounded-tr-md whitespace-pre-wrap bg-blue-600 text-white" : "rounded-tl-md border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"}`}>{message.role === "assistant" ? <MarkdownMessage content={message.content} /> : message.content}</div></div>)}
                {chatLoading && <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" /> Nexora AI is thinking…</div>}
              </div></div>
              <div className="border-t border-slate-200 bg-white/80 px-4 py-4 dark:border-slate-800 dark:bg-[#0e1728]/80 sm:px-8"><form onSubmit={sendMessage} className="mx-auto flex max-w-3xl items-end gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Describe your IT issue…" rows={1} className="max-h-32 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500" /><button type="submit" disabled={!chatInput.trim() || chatLoading} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><span className="text-lg">↑</span></button></form><p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-slate-400">Nexora AI can make mistakes. Verify important recommendations.</p></div>
            </div>
          )}

          {activeView === "settings" && (
            <div className="mx-auto max-w-4xl space-y-6 p-6 max-sm:p-4">
              <div><h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Workspace settings</h1><p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Personalize Nexora AI for your workspace.</p></div>
              <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 sm:p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon name="sun" size={20} /></span><div><h2 className="text-base font-bold text-slate-900 dark:text-white">Appearance</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a theme for this browser. System follows your device preference.</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-3">{(["system", "light", "dark"] as ThemePreference[]).map((preference) => <button key={preference} type="button" aria-pressed={themePreference === preference} onClick={() => applyTheme(preference)} className={`rounded-xl border p-4 text-left transition ${themePreference === preference ? "border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/10 dark:border-blue-400 dark:bg-blue-400/10" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/70"}`}><span className="flex items-center justify-between"><span className="text-sm font-semibold capitalize text-slate-900 dark:text-white">{preference}</span><span className={`h-4 w-4 rounded-full border-4 ${themePreference === preference ? "border-blue-600 bg-white dark:border-blue-400" : "border-slate-300 dark:border-slate-600"}`} /></span><span className="mt-2 block text-xs leading-5 text-slate-500 dark:text-slate-400">{preference === "system" ? "Use your operating system setting" : preference === "light" ? "Bright surfaces and dark text" : "Low-glare dark surfaces"}</span></button>)}</div></section>
              <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 sm:p-6"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">{profileInitials}</div><div><h2 className="text-base font-bold text-slate-900 dark:text-white">{profileName}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{user?.email}</p></div></div><p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">Your profile is loaded from your authenticated Nexora AI account.</p></section>
            </div>
          )}
        </div>
      </section>

      {detailTicket && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailTicket(null); }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title" className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-300">Ticket details</p><h2 id="ticket-detail-title" className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{detailTicket.ticket_number}</h2></div><button type="button" aria-label="Close ticket details" onClick={() => setDetailTicket(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><Icon name="close" size={18} /></button></div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-5 sm:px-6">{detailLoading ? <div className="space-y-3"><div className="h-5 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800"/><div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"/></div> : detailError ? <div role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{detailError}</div> : <><div className="flex flex-wrap gap-2"><StatusBadge status={detailTicket.status} /><PriorityBadge priority={detailTicket.priority} /></div><dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-5 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500 dark:text-slate-400">Category</dt><dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">{detailTicket.category ?? "Uncategorized"}</dd></div><div><dt className="text-xs text-slate-500 dark:text-slate-400">Severity</dt><dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">{detailTicket.severity ?? "—"}</dd></div><div><dt className="text-xs text-slate-500 dark:text-slate-400">Created</dt><dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">{formatDate(detailTicket.created_at)}</dd></div><div><dt className="text-xs text-slate-500 dark:text-slate-400">Requester</dt><dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">{detailTicket.requester?.display_name?.trim() || "Requester"}</dd><dd className="mt-0.5 break-all text-xs text-slate-500 dark:text-slate-400">{detailTicket.requester?.email || "Email unavailable"}</dd></div></dl><div className="mt-6"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Issue</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">{detailTicket.issue}</p></div>{detailTicket.summary && <div className="mt-5"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">AI summary</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-blue-50/70 p-4 text-sm leading-6 text-slate-700 dark:bg-blue-400/10 dark:text-slate-200">{detailTicket.summary}</p></div>}</>}</div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><button type="button" onClick={() => setDetailTicket(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Close</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
