export type CallStatus = "outgoing" | "incoming" | "missed" | "failed" | "busy" | "no-answer";

export interface CallLog {
  id: string;
  name: string;
  number: string;
  status: CallStatus;
  duration: string;
  time: string;
  date: string;
  country: string;
  flag: string;
  price?: string;
  recording?: boolean;
  sid: string;
}

export interface Contact {
  id: string;
  name: string;
  number: string;
  email?: string;
  company?: string;
  tags?: string[];
  favorite?: boolean;
  initials: string;
  color: string;
}

export interface SmsThread {
  id: string;
  name: string;
  number: string;
  last: string;
  time: string;
  unread: number;
  initials: string;
}

const colors = ["#10b981", "#f43f5e", "#3b82f6", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899"];
const initialsOf = (n: string) =>
  n.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

const names = [
  ["Sarah Chen", "+1 415 555 0142", "sarah@acme.co", "Acme Inc", "USA", "🇺🇸"],
  ["Marcus Reed", "+44 20 7946 0958", "marcus@studio.uk", "Studio Ltd", "UK", "🇬🇧"],
  ["Priya Nair", "+91 98450 12345", "priya@byte.in", "Byte Labs", "India", "🇮🇳"],
  ["Elena Rossi", "+39 06 9876 5432", "elena@nova.it", "Nova SRL", "Italy", "🇮🇹"],
  ["Kenji Tanaka", "+81 3 6743 8500", "kenji@shibu.jp", "Shibu KK", "Japan", "🇯🇵"],
  ["Amara Osei", "+233 30 210 8080", "amara@sun.gh", "Sun Group", "Ghana", "🇬🇭"],
  ["Diego Silva", "+55 11 3456 7890", "diego@rio.br", "Rio Tech", "Brazil", "🇧🇷"],
  ["Ivy Zhang", "+86 21 6789 4321", "ivy@lark.cn", "Lark Co", "China", "🇨🇳"],
];

export const contacts: Contact[] = names.map(([name, number, email, company, , _flag], i) => ({
  id: `c${i}`,
  name: name as string,
  number: number as string,
  email: email as string,
  company: company as string,
  tags: i % 2 === 0 ? ["VIP"] : ["Lead"],
  favorite: i < 4,
  initials: initialsOf(name as string),
  color: colors[i % colors.length],
}));

const statuses: CallStatus[] = ["outgoing", "incoming", "missed", "outgoing", "incoming", "failed", "outgoing", "no-answer"];
export const callLogs: CallLog[] = names.map(([name, number, , , country, flag], i) => ({
  id: `l${i}`,
  name: name as string,
  number: number as string,
  status: statuses[i],
  duration: statuses[i] === "missed" || statuses[i] === "failed" ? "—" : `${Math.floor(Math.random() * 12) + 1}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
  time: `${9 + i}:${String(10 + i * 4).slice(0, 2).padStart(2, "0")} ${i % 2 ? "AM" : "PM"}`,
  date: i < 3 ? "Today" : i < 6 ? "Yesterday" : "Mon, Jul 13",
  country: country as string,
  flag: flag as string,
  price: statuses[i] === "outgoing" ? `$0.0${i + 1}` : undefined,
  recording: i % 3 === 0,
  sid: `CA${Math.random().toString(36).slice(2, 12)}`,
}));

export const smsThreads: SmsThread[] = names.slice(0, 6).map(([name, number], i) => ({
  id: `s${i}`,
  name: name as string,
  number: number as string,
  last: [
    "Sounds good, talk soon!",
    "Can you send the invoice?",
    "I'll call you at 3pm.",
    "Your OTP is 448291",
    "Thanks for the demo 🙌",
    "Rescheduling to Friday",
  ][i],
  time: ["2m", "14m", "1h", "3h", "Yday", "Yday"][i],
  unread: i < 2 ? i + 1 : 0,
  initials: initialsOf(name as string),
}));

export const callerIds = [
  { number: "+14472442773", label: "SPWebConnect Line", flag: "🇺🇸", verified: true },
  { number: "+919145050514", label: "Verified Mobile", flag: "🇮🇳", verified: true },
];

export { countries, allCountries, searchCountries, type Country } from "./countries";
