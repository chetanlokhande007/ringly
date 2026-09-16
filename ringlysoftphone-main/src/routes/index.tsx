import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff,
  Delete, Clock, Star, Users, MessageSquare, Settings as SettingsIcon,
  Mic, MicOff, Pause, Volume2, UserPlus, Grid3x3, Search, Plus,
  ChevronDown, ChevronRight, ArrowLeft, MoreVertical, Wifi, Zap,
  Sun, Moon, LogOut, Shield, Mail, Bell, RefreshCw,
  Upload, Play, PauseCircle, Download, Radio, CheckCircle2, XCircle,
  Send, Paperclip, Smile, CircleDot, Menu, CreditCard, HelpCircle,
  FileText, ExternalLink, Circle, Trash2, Copy, Eye, EyeOff,
  Contact as ContactIcon, Sparkles, Check, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  callLogs as seedLogs, contacts as seedContacts, smsThreads as seedThreads,
  callerIds, countries, searchCountries, type CallStatus, type Contact, type SmsThread, type CallLog,
} from "@/lib/mock-data";
import { allCountries } from "@/lib/countries";

import {
  loadCreds, saveCreds, credsReadyForVoice, twilio,
  initDevice, destroyDevice, placeCall as twilioPlaceCall,
  hangup as twilioHangup, setMuted as twilioSetMuted, sendDtmf as twilioSendDtmf,
  acceptIncoming, rejectIncoming, setIncomingPolicy, type TwilioCreds as TwilioCredsShape,
} from "@/lib/twilio-client";
import { playDtmfTone, playErrorTone } from "@/lib/dtmf-tone";
import { loadCallSettings, saveCallSettings, defaultCallSettings, loadDialCountryIso, saveDialCountryIso, loadDialDraft, saveDialDraft, type CallSettings } from "@/lib/call-settings";

import { sendSms as sendSmsFn, testConnection as testConnectionFn, getTwilioDefaults, placeRestCall as placeRestCallFn, provisionVoice as provisionVoiceFn } from "@/lib/twilio.functions";
import { getGoogleAuthConfig, verifyGoogleCredential, type GoogleProfile } from "@/lib/auth.functions";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ringly — Twilio Softphone for Chrome" },
      { name: "description", content: "Premium Chrome extension softphone powered by SPWebConnect. Dialpad, auto dialer, SMS, contacts, call recording, and Gmail integration in one place." },
      { property: "og:title", content: "Ringly — Twilio Softphone for Chrome" },
      { property: "og:description", content: "A modern business calling experience: dialpad, auto dialer, SMS, contacts, and Gmail — right in your browser." },
    ],
  }),
  component: App,
});

type Screen =
  | "login" | "dialpad" | "incoming" | "active" | "recent" | "recent-detail"
  | "favorites" | "contacts" | "sms" | "sms-thread" | "auto-dialer"
  | "more" | "settings" | "account" | "twilio-settings" | "gmail" | "billing";


const colors = ["#10b981", "#f43f5e", "#3b82f6", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899"];
const initialsOf = (n: string) => n.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";

/**
 * Normalise a dialled number to E.164. A typed "+" or a long (>10 digit)
 * number is treated as already international; anything shorter gets the
 * selected country code. Prevents "+1 91805…" style invalid numbers.
 */
export function toE164(raw: string, countryCode: string) {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  if (trimmed.startsWith("+") || digits.length > 10) return `+${digits}`;
  return `${countryCode}${digits}`.replace(/\s+/g, "");
}


type Toast = { id: number; text: string; tone?: "emerald" | "twilio" };

function App() {
  const [authed, setAuthed] = useState(false);
  const [screen, setScreen] = useState<Screen>("login");
  const [history, setHistory] = useState<Screen[]>([]);
  const [dark, setDark] = useState(false);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [callerId, setCallerId] = useState(callerIds[0]);
  const [contacts, setContacts] = useState<Contact[]>(seedContacts);
  const [threads, setThreads] = useState<SmsThread[]>(seedThreads);
  const [logs, setLogs] = useState<CallLog[]>(seedLogs);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [twilioCreds, setTwilioCredsState] = useState<TwilioCredsShape & { region: string }>({
    // No credentials in source: they come from server configuration
    // (appsettings.json / environment / database) or from what the user saves.
    accountSid: "",
    authToken: "",
    apiKeySid: "",
    apiKeySecret: "",
    twimlAppSid: "",
    identity: "",
    callerId: "",
    region: "US1 (Ashburn)",
  });
  const [deviceReady, setDeviceReady] = useState(false);
  const setTwilioCreds: React.Dispatch<React.SetStateAction<TwilioCredsShape & { region: string }>> = (updater) => {
    setTwilioCredsState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: typeof prev) => typeof prev)(prev) : updater;
      saveCreds(next);
      return next;
    });
  };
  const [prefillNumber, setPrefillNumber] = useState<string>("");
  const [dialTarget, setDialTarget] = useState<{ name: string; number: string } | null>(null);
  const [callSettings, setCallSettingsState] = useState<CallSettings>(defaultCallSettings);
  const updateCallSettings = (patch: Partial<CallSettings>) => {
    setCallSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveCallSettings(next);
      return next;
    });
  };


  const toast = (text: string, tone?: "emerald" | "twilio") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  };

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  // Load persisted Twilio creds on mount, backfilled with server-configured
  // (per-tenant) defaults. Anything the user already saved always wins.
  useEffect(() => {
    const stored = loadCreds();
    if (stored) setTwilioCredsState((prev) => ({ ...prev, ...stored }));
    void getTwilioDefaults()
      .then((d) => {
        if (!d) return;
        setTwilioCredsState((prev) => ({
          ...prev,
          accountSid: prev.accountSid || d.accountSid || "",
          apiKeySid: prev.apiKeySid || d.apiKeySid || "",
          apiKeySecret: prev.apiKeySecret || (d.hasServerApiKeySecret ? "configured-on-server" : ""),
          authToken: prev.authToken || (d.hasServerAuthToken ? "configured-on-server" : ""),
          twimlAppSid: prev.twimlAppSid || d.twimlAppSid || "",
          identity: prev.identity || d.identity || "",
          callerId: prev.callerId || d.callerId || "",
        }));
      })
      .catch(() => undefined);
  }, []);


  // Load inbound-call preferences (accept / forward) on mount
  useEffect(() => { setCallSettingsState(loadCallSettings()); }, []);

  // Push the inbound policy into the Twilio device layer whenever it changes
  useEffect(() => {
    const forwardTo = callSettings.forwardingEnabled ? callSettings.forwardTo.trim() : "";
    setIncomingPolicy({
      enabled: callSettings.incomingEnabled,
      forwardTo,
      onBlocked: (from) => toast(`Incoming call from ${from || "unknown"} declined`, "twilio"),
      onForward: (from, to) => {
        toast(`Forwarding ${from || "caller"} → ${to}`, "emerald");
        void placeRestCallFn({
          data: {
            to,
            from: twilioCreds.callerId || undefined,
            agentPhone: from || undefined,
            accountSid: twilioCreds.accountSid || undefined,
            authToken: twilioCreds.authToken || undefined,
          },
        }).catch(() => toast("Forwarding failed", "twilio"));
      },
    });
  }, [callSettings, twilioCreds.callerId, twilioCreds.accountSid, twilioCreds.authToken]);


  // Init Twilio Device when creds become valid
  useEffect(() => {
    if (!authed) return;
    if (!credsReadyForVoice(twilioCreds)) { setDeviceReady(false); return; }
    let cancelled = false;
    (async () => {
      try {
        await initDevice(twilioCreds);
        if (!cancelled) { setDeviceReady(true); toast("Twilio device ready", "emerald"); }
      } catch (e) {
        if (!cancelled) { setDeviceReady(false); toast(e instanceof Error ? e.message : "Device init failed", "twilio"); }
      }
    })();
    return () => { cancelled = true; };
  }, [authed, twilioCreds.accountSid, twilioCreds.apiKeySid, twilioCreds.apiKeySecret, twilioCreds.twimlAppSid, twilioCreds.identity]);

  useEffect(() => () => { void destroyDevice(); }, []);

  // Auto-enable browser calling right after login (mints API Key + TwiML App once)
  const provisionedRef = useRef(false);
  useEffect(() => {
    if (!authed || provisionedRef.current) return;
    const readyNow: boolean = credsReadyForVoice(twilioCreds);
    if (readyNow) return;
    if (!twilioCreds.accountSid || !twilioCreds.authToken) return;

    provisionedRef.current = true;
    void ensureVoiceCreds();
  }, [authed, twilioCreds.accountSid, twilioCreds.authToken]);

  // Keep the UI in sync when the remote party hangs up
  useEffect(() => {
    const unsub = twilio.subscribe(() => {
      if (!twilio.getCall() && dialTarget) {
        setDialTarget(null);
        setScreen((s) => (s === "active" || s === "incoming" ? "recent" : s));
      }
    });
    return () => { unsub(); };
  }, [dialTarget]);





  const go = (s: Screen) => {
    setHistory((h) => [...h, screen]);
    setScreen(s);
  };
  const back = () => {
    setHistory((h) => {
      if (h.length === 0) { setScreen("dialpad"); return h; }
      const prev = h[h.length - 1];
      setScreen(prev);
      setSelectedLog(null);
      setSelectedThread(null);
      return h.slice(0, -1);
    });
  };
  const goTab = (s: Screen) => { setHistory([]); setScreen(s); setSelectedLog(null); setSelectedThread(null); };

  const login = (user?: GoogleProfile) => {
    if (user) {
      try { localStorage.setItem("ringly.user", JSON.stringify(user)); } catch { /* ignore */ }
    }
    setAuthed(true); setHistory([]); setScreen("dialpad");
  };
  const logout = () => {
    try { localStorage.removeItem("ringly.user"); } catch { /* ignore */ }
    setAuthed(false); setHistory([]); setScreen("login");
  };

  const addContact = (c: Omit<Contact, "id" | "initials" | "color">) => {
    const nc: Contact = {
      ...c,
      id: `c${Date.now()}`,
      initials: initialsOf(c.name),
      color: colors[contacts.length % colors.length],
    };
    setContacts((cs) => [nc, ...cs]);
    toast("Contact saved", "emerald");
    return nc;
  };
  const deleteContact = (id: string) => {
    setContacts((cs) => cs.filter((c) => c.id !== id));
    toast("Contact deleted", "twilio");
  };
  const toggleFavorite = (id: string) => {
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)));
  };
  const deleteLog = (id: string) => {
    setLogs((ls) => ls.filter((l) => l.id !== id));
    toast("Call removed", "twilio");
  };
  const deleteThread = (id: string) => {
    setThreads((ts) => ts.filter((t) => t.id !== id));
    toast("Thread deleted", "twilio");
  };

  const startSmsWithContact = (c: Contact) => {
    let thread = threads.find((t) => t.number === c.number);
    if (!thread) {
      thread = {
        id: `s${Date.now()}`,
        name: c.name,
        number: c.number,
        last: "",
        time: "now",
        unread: 0,
        initials: c.initials,
      };
      setThreads((ts) => [thread!, ...ts]);
    }
    setSelectedThread(thread.id);
    setHistory((h) => [...h, screen]);
    setScreen("sms-thread");
  };

  const startSmsWithNumber = (name: string, number: string) => {
    let thread = threads.find((t) => t.number === number);
    if (!thread) {
      thread = {
        id: `s${Date.now()}`,
        name: name || number,
        number,
        last: "",
        time: "now",
        unread: 0,
        initials: initialsOf(name || number),
      };
      setThreads((ts) => [thread!, ...ts]);
    }
    setSelectedThread(thread.id);
    setHistory((h) => [...h, screen]);
    setScreen("sms-thread");
  };

  /**
   * Make sure we have an API Key + TwiML App for browser Voice. Provisions
   * them through Twilio's REST API using the saved Account SID + Auth Token.
   */
  const ensureVoiceCreds = async (): Promise<(TwilioCredsShape & { region: string }) | null> => {
    const cur = { ...twilioCreds };
    const alreadyOk: boolean = credsReadyForVoice(cur);
    if (alreadyOk) return cur;


    const res = await provisionVoiceFn({
      data: { accountSid: cur.accountSid || undefined, authToken: cur.authToken || undefined },
    });
    if (!res.ok) {
      toast(res.message, "twilio");
      return null;
    }
    const next = {
      ...cur,
      apiKeySid: res.apiKeySid,
      apiKeySecret: res.apiKeySecret,
      twimlAppSid: res.twimlAppSid,
      identity: cur.identity || "CTMS",
    };

    setTwilioCreds(next);
    toast("Browser calling enabled", "emerald");
    return next;
  };



  const placeCall = async (name: string, number: string) => {
    const digits = number.replace(/[^\d+]/g, "");
    updateCallSettings({ lastDialed: digits });
    setDialTarget({ name, number });
    setHistory((h) => [...h, screen]);
    setScreen("active");

    try {
      let ready = credsReadyForVoice(twilioCreds) && deviceReady;
      if (!ready) {
        // Auto-provision the API Key + TwiML App so the browser can carry audio.
        const creds = await ensureVoiceCreds();
        if (creds) {
          await initDevice(creds);
          setDeviceReady(true);
          ready = true;
        }
      }
      if (ready) {
        await twilioPlaceCall(digits, twilioCreds.callerId);
        return;
      }
      // Last resort: bridge through the agent's own phone over REST
      const res = await placeRestCallFn({
        data: {
          to: digits,
          from: twilioCreds.callerId || undefined,
          agentPhone: twilioCreds.agentPhone || undefined,
          accountSid: twilioCreds.accountSid || undefined,
          authToken: twilioCreds.authToken || undefined,
        },
      });
      if (!res.ok) throw new Error(res.message);
      toast(`Calling ${digits}…`, "emerald");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Call failed", "twilio");
      setScreen("dialpad");
      setDialTarget(null);
    }
  };


  const endCall = (name: string, number: string, duration: string) => {
    twilioHangup();
    const newLog: CallLog = {
      id: `l${Date.now()}`,
      name: name || number,
      number,
      status: "outgoing",
      duration,
      time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      date: "Today",
      country: "USA",
      flag: "🇺🇸",
      price: "$0.02",
      recording: false,
      sid: `CA${Math.random().toString(36).slice(2, 12)}`,
    };
    setLogs((l) => [newLog, ...l]);
    setDialTarget(null);
    setScreen("recent");
    setHistory([]);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-emerald-soft/40 via-background to-twilio-soft/20 p-0 md:p-6">
      <div className="w-full md:w-[420px] md:h-[570px] h-screen bg-surface md:rounded-[28px] md:shadow-float overflow-hidden relative flex flex-col border border-border/60">
        {!authed ? (
          <LoginScreen onLogin={login} />
        ) : (
          <>
            <TopBar callerId={callerId} dark={dark} setDark={setDark} />
            <div className="flex-1 overflow-hidden relative">
              {screen === "dialpad" && (
                <Dialpad
                  onCall={placeCall}
                  callerId={callerId}
                  setCallerId={setCallerId}
                  onIncoming={() => {
                    if (!callSettings.incomingEnabled) return toast("Incoming calls are turned off", "twilio");
                    if (callSettings.forwardingEnabled) return toast(`Incoming calls forward to ${callSettings.forwardTo}`, "emerald");
                    go("incoming");
                  }}
                  onAddContact={addContact}
                  prefill={prefillNumber}
                  clearPrefill={() => setPrefillNumber("")}
                  lastDialed={callSettings.lastDialed}
                  onRedial={() => {
                    if (!callSettings.lastDialed) return toast("No number to redial yet", "twilio");
                    void placeCall(callSettings.lastDialed, callSettings.lastDialed);
                  }}
                />

              )}
              {screen === "incoming" && (
                <IncomingCall
                  onAccept={() => { setDialTarget({ name: "Sarah Chen", number: "+1 415 555 0142" }); setScreen("active"); }}
                  onReject={() => setScreen("dialpad")}
                />
              )}
              {screen === "active" && dialTarget && (
                <ActiveCall target={dialTarget} onEnd={(dur) => endCall(dialTarget.name, dialTarget.number, dur)} />
              )}
              {screen === "recent" && !selectedLog && (
                <Recent
                  logs={logs}
                  onOpen={(id) => { setSelectedLog(id); go("recent-detail"); }}
                  onCall={placeCall}
                />
              )}
              {screen === "recent-detail" && selectedLog && (
                <RecentDetail
                  id={selectedLog}
                  logs={logs}
                  onBack={back}
                  onCall={placeCall}
                  onSms={startSmsWithNumber}
                  onDelete={(id) => { deleteLog(id); back(); }}
                />
              )}
              {screen === "favorites" && (
                <Favorites contacts={contacts} onCall={placeCall} onSms={startSmsWithContact} onToggleFav={toggleFavorite} />
              )}
              {screen === "contacts" && (
                <Contacts
                  contacts={contacts}
                  onBack={back}
                  onCall={placeCall}
                  onSms={startSmsWithContact}
                  onAdd={addContact}
                  onDelete={deleteContact}
                  onToggleFav={toggleFavorite}
                />
              )}
              {screen === "sms" && !selectedThread && (
                <Sms
                  threads={threads}
                  contacts={contacts}
                  onOpen={(id) => { setSelectedThread(id); go("sms-thread"); }}
                  onDelete={deleteThread}
                  onNew={startSmsWithNumber}
                  onBack={back}
                />
              )}
              {screen === "sms-thread" && selectedThread && (
                <SmsThreadView
                  id={selectedThread}
                  threads={threads}
                  setThreads={setThreads}
                  onBack={back}
                  onCall={placeCall}
                  creds={twilioCreds}
                  toast={toast}
                />
              )}
              {screen === "auto-dialer" && <AutoDialer logs={logs} toast={toast} />}
              {screen === "more" && <More go={go} onLogout={logout} />}
              {screen === "settings" && (
                <Settings
                  onBack={back}
                  dark={dark}
                  setDark={setDark}
                  callSettings={callSettings}
                  updateCallSettings={updateCallSettings}
                  toast={toast}
                />
              )}
              {screen === "twilio-settings" && (
                <TwilioSettings onBack={back} creds={twilioCreds} setCreds={setTwilioCreds} toast={toast} />
              )}
              {screen === "gmail" && <GmailIntegration onBack={back} toast={toast} />}
              {screen === "account" && <Account onBack={back} onBilling={() => go("billing")} />}
              {screen === "billing" && <Billing onBack={back} onLogout={logout} toast={toast} />}

            </div>
            {["dialpad", "recent", "favorites", "auto-dialer", "more"].includes(screen) && (
              <BottomNav screen={screen} setScreen={goTab} />
            )}
          </>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-14 flex flex-col items-center gap-1.5 z-50">
          {toasts.map((t) => (
            <div key={t.id} className={cn(
              "animate-slide-up px-3 py-1.5 rounded-full text-[11px] font-semibold shadow-float",
              t.tone === "twilio" ? "bg-twilio text-twilio-foreground" : "bg-emerald text-emerald-foreground",
            )}>{t.text}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */

function TopBar({ callerId, dark, setDark }: { callerId: typeof callerIds[number]; dark: boolean; setDark: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-surface border-b border-border/60 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative shrink-0">
          <div className="w-2 h-2 rounded-full bg-emerald animate-pulse" />
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald/40 animate-ping" />
        </div>
        <div className="text-[11px] font-medium text-foreground">Connected</div>
        <div className="text-[11px] text-muted-foreground truncate">· {callerId.flag} {callerId.label}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground mr-1">Ready</span>
        <button onClick={() => setDark(!dark)} className="p-1.5 rounded-full hover:bg-muted transition ring-ripple">
          {dark ? <Sun className="w-3.5 h-3.5 text-foreground" /> : <Moon className="w-3.5 h-3.5 text-foreground" />}
        </button>
      </div>
    </div>
  );
}

function BottomNav({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const items: { key: Screen; icon: React.ReactNode; label: string }[] = [
    { key: "dialpad", icon: <Grid3x3 className="w-4 h-4" />, label: "Dialpad" },
    { key: "auto-dialer", icon: <Zap className="w-4 h-4" />, label: "Auto" },
    { key: "recent", icon: <Clock className="w-4 h-4" />, label: "Recent" },
    { key: "favorites", icon: <Star className="w-4 h-4" />, label: "Favorites" },
    { key: "more", icon: <Menu className="w-4 h-4" />, label: "More" },
  ];
  return (
    <div className="grid grid-cols-5 gap-1 px-2 py-1 bg-surface border-t border-border/60 shrink-0">
      {items.map((i) => {
        const active = screen === i.key;
        return (
          <button
            key={i.key}
            onClick={() => setScreen(i.key)}
            className={cn(
              "flex flex-col items-center justify-center py-1 rounded-xl transition-all ring-ripple",
              active ? "text-emerald bg-emerald-soft" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {i.icon}
            <span className={cn("text-[9px] mt-0.5 font-medium", active && "font-semibold")}>{i.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ScreenHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-surface shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="p-1 -ml-1 rounded-full hover:bg-muted ring-ripple shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <h1 className="text-base font-semibold tracking-tight truncate">{title}</h1>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

/* ---------- login ---------- */

function LoginScreen({ onLogin }: { onLogin: (user?: GoogleProfile) => void }) {
  const [mode, setMode] = useState<"google" | "gmail" | "twilio">("google");
  return (
    <div className="flex-1 overflow-y-auto flex flex-col p-6 bg-gradient-to-b from-surface via-surface to-emerald-soft/30">
      <div className="flex items-center justify-center gap-3 mt-4 mb-6 animate-slide-up">
        <div className="w-12 h-12 rounded-2xl bg-emerald flex items-center justify-center shadow-key">
          <PhoneCall className="w-6 h-6 text-emerald-foreground" />
        </div>
        <div>
          <div className="text-xl font-bold tracking-tight">Ringly</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            Powered by <span className="text-emerald font-semibold">SPWebConnect</span>
          </div>
        </div>
      </div>

      <div className="text-center mb-5 animate-slide-up">
        <h2 className="text-lg font-semibold">Sign in to your softphone</h2>
        <p className="text-xs text-muted-foreground mt-1">Business calling in your browser.</p>
      </div>

      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-4 text-xs animate-slide-up">
        {[{ k: "google", l: "Google" }, { k: "gmail", l: "Gmail" }, { k: "twilio", l: "Twilio" }].map((t) => (
          <button
            key={t.k}
            onClick={() => setMode(t.k as typeof mode)}
            className={cn(
              "flex-1 py-2 rounded-lg font-medium transition-all",
              mode === t.k ? "bg-surface shadow-key text-foreground" : "text-muted-foreground"
            )}
          >{t.l}</button>
        ))}
      </div>

      <div className="space-y-3 animate-slide-in-right">
        {mode === "google" && <GoogleSignIn onLogin={onLogin} />}
        {mode === "gmail" && (
          <>
            <FormField label="Gmail" placeholder="you@gmail.com" />
            <FormField label="Password" placeholder="••••••••" type="password" />
            <button onClick={() => onLogin()} className="w-full py-3 rounded-2xl bg-emerald text-emerald-foreground font-semibold text-sm shadow-key hover:brightness-110 transition ring-ripple">Sign in</button>
          </>
        )}
        {mode === "twilio" && (
          <>
            <FormField label="Account SID" placeholder="ACxxxxxxxx" />
            <FormField label="Auth Token" placeholder="••••••••" type="password" />
            <div className="grid grid-cols-2 gap-2">
              <FormField label="API Key" placeholder="SKxxxx" />
              <FormField label="Identity" placeholder="agent-01" />
            </div>
            <button onClick={() => onLogin()} className="w-full py-3 rounded-2xl bg-twilio text-twilio-foreground font-semibold text-sm shadow-key hover:brightness-110 transition ring-ripple">Connect to Twilio</button>
          </>
        )}
      </div>

      <div className="mt-auto pt-6 text-center text-[10px] text-muted-foreground">
        By continuing you agree to our Terms & Privacy Policy.
      </div>
    </div>
  );
}

function FormField({ label, placeholder, type = "text", value, onChange }: { label: string; placeholder?: string; type?: string; value?: string; onChange?: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground mb-1 block">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald/50 focus:border-emerald transition"
      />
    </label>
  );
}

/* ---------- Google Identity Services sign-in ---------- */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById("gis-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
      return;
    }
    const s = document.createElement("script");
    s.id = "gis-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("load failed"));
    document.head.appendChild(s);
  });
}

function GoogleSignIn({ onLogin }: { onLogin: (user?: GoogleProfile) => void }) {
  const btnRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unconfigured" | "error">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getGoogleAuthConfig();
        if (cancelled) return;
        if (!cfg.configured || !cfg.clientId) { setStatus("unconfigured"); return; }
        await loadGis();
        if (cancelled || !btnRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          ux_mode: "popup",
          callback: async (resp) => {
            setMsg("Verifying…");
            try {
              const res = await verifyGoogleCredential({ data: { credential: resp.credential } });
              if (res.ok) onLogin(res.user);
              else setMsg(res.error);
            } catch {
              setMsg("Could not verify your Google account");
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 340,
          logo_alignment: "center",
        });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [onLogin]);

  return (
    <div className="space-y-2">
      <div ref={btnRef} className="flex justify-center [&>div]:!w-full" />
      {status === "loading" && (
        <div className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-surface border border-border text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading Google sign-in…
        </div>
      )}
      {(status === "unconfigured" || status === "error") && (
        <>
          <button
            onClick={() => onLogin()}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-2xl bg-surface border border-border shadow-key hover:shadow-soft transition ring-ripple font-medium text-sm"
          >
            <GoogleIcon /> Continue with Google
          </button>
          <p className="text-[10px] text-center text-muted-foreground">
            {status === "unconfigured"
              ? "Google client ID not configured on the server — using demo sign-in."
              : "Google sign-in unavailable right now — using demo sign-in."}
          </p>
        </>
      )}
      {msg && <p className="text-[10px] text-center text-twilio">{msg}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
  );
}

/* ---------- modal ---------- */

function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center bg-foreground/30 backdrop-blur-sm animate-slide-up" onClick={onClose}>
      <div className="w-full bg-surface rounded-t-3xl sm:rounded-3xl shadow-float max-h-[90%] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="p-3 border-t border-border/60">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- dialpad (compact, no-scroll) ---------- */

function Dialpad({
  onCall, callerId, setCallerId, onIncoming, onAddContact, prefill, clearPrefill, lastDialed, onRedial,
}: {
  onCall: (name: string, number: string) => void;
  callerId: typeof callerIds[number];
  setCallerId: (c: typeof callerIds[number]) => void;
  onIncoming: () => void;
  onAddContact: (c: Omit<Contact, "id" | "initials" | "color">) => Contact;
  prefill: string;
  clearPrefill: () => void;
  lastDialed: string;
  onRedial: () => void;
}) {

  const [num, setNumState] = useState(prefill || "");
  /** Persist the typed number so it survives calls/screen changes. */
  const setNum: typeof setNumState = (v) =>
    setNumState((prev) => {
      const next = typeof v === "function" ? (v as (p: string) => string)(prev) : v;
      saveDialDraft(next);
      return next;
    });
  useEffect(() => {
    if (prefill) return;
    const draft = loadDialDraft();
    if (draft) setNumState(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backspace: tap deletes one digit, long press clears the whole number.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedByHold = useRef(false);
  const startBackspaceHold = () => {
    clearedByHold.current = false;
    holdTimer.current = setTimeout(() => {
      clearedByHold.current = true;
      setNum("");
    }, 450);
  };
  const endBackspaceHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const [country, setCountryState] = useState(countries[0]);
  /** Restore the last picked country (persisted across calls & sessions). */
  useEffect(() => {
    const iso = loadDialCountryIso();
    if (iso) {
      const saved = allCountries.find((c) => c.iso === iso);
      if (saved) setCountryState(saved);
    }
  }, []);
  const setCountry = (c: typeof countries[number]) => {
    setCountryState(c);
    saveDialCountryIso(c.iso);
  };
  const [showCountry, setShowCountry] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const countryResults = useMemo(() => searchCountries(countryQuery), [countryQuery]);

  const [showCaller, setShowCaller] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { if (prefill) { setNum(prefill); clearPrefill(); } /* eslint-disable-next-line */ }, [prefill]);

  // Audible key feedback so you can hear each digit as it is entered.
  const press = (k: string) => {
    playDtmfTone(k);
    setNum((n) => (n + k).slice(0, 18));
  };
  const backspace = () => setNum((n) => n.slice(0, -1));

  /**
   * Accept typed or pasted numbers. When the text already carries an
   * international prefix (+91…, 0091…), the matching country is selected and
   * the code is stripped so it never gets dialled twice.
   */
  const acceptInput = (raw: string) => {
    let s = raw.replace(/[^\d+*#]/g, "");
    if (s.startsWith("00")) s = `+${s.slice(2)}`;
    if (s.startsWith("+")) {
      const match = [...allCountries]
        .filter((c) => s.startsWith(c.code))
        .sort((a, b) => b.code.length - a.code.length)[0];
      if (match) {
        setCountry(match);
        s = s.slice(match.code.length);
      } else {
        s = s.slice(1);
      }
    }

    setNum(s.replace(/\D/g, "").slice(0, 18));
  };

  const doCall = () => {
    const digits = num.replace(/\D/g, "");
    if (digits.length < 3) {
      playErrorTone();
      return;
    }
    onCall(num, toE164(num, country.code));
  };




  return (
    <div className="h-full flex flex-col animate-slide-up">
      <div className="px-4 pt-2 pb-1.5 shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <button
            onClick={() => { setShowCountry(!showCountry); setShowCaller(false); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-xs font-medium hover:bg-accent transition ring-ripple shrink-0"
          >
            <span className="text-sm leading-none">{country.flag}</span>
            <span>{country.code}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          <input
            value={num}
            onChange={(e) => acceptInput(e.target.value)}
            onPaste={(e) => { e.preventDefault(); acceptInput(num + e.clipboardData.getData("text")); }}
            onKeyDown={(e) => { if (e.key === "Enter") doCall(); }}
            inputMode="tel"
            autoComplete="tel"
            aria-label="Phone number"
            placeholder="Enter number"
            className="flex-1 min-w-0 bg-transparent text-center text-xl font-semibold tracking-wide tabular-nums focus:outline-none placeholder:text-muted-foreground/40 placeholder:font-normal placeholder:text-base"
          />
          {num && (
            <button
              onPointerDown={startBackspaceHold}
              onPointerUp={endBackspaceHold}
              onPointerLeave={endBackspaceHold}
              onPointerCancel={endBackspaceHold}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => { if (!clearedByHold.current) backspace(); clearedByHold.current = false; }}
              aria-label="Delete digit (hold to clear)"
              title="Tap to delete • hold to clear"
              className="p-1.5 rounded-full hover:bg-muted ring-ripple shrink-0"
            >
              <Delete className="w-4 h-4" />
            </button>

          )}
        </div>


        <button
          onClick={() => { setShowCaller(!showCaller); setShowCountry(false); }}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-soft/60 text-[11px] border border-emerald/20"
        >
          <span className="flex items-center gap-1.5 text-emerald font-medium min-w-0 truncate">
            <PhoneOutgoing className="w-3 h-3 shrink-0" />
            <span className="truncate">From {callerId.flag} {callerId.number}</span>
          </span>
          <ChevronDown className={cn("w-3 h-3 transition shrink-0", showCaller && "rotate-180")} />
        </button>
      </div>

      {showCountry && (
        <div className="mx-4 animate-slide-up bg-surface border border-border rounded-2xl shadow-soft p-2 z-10">
          <div className="flex items-center gap-1.5 px-2 py-1 mb-1 rounded-lg bg-muted">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={countryQuery}
              onChange={(e) => setCountryQuery(e.target.value)}
              placeholder="Search country or code"
              className="flex-1 bg-transparent text-xs py-1 focus:outline-none"
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {countryResults.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">No match</div>
            )}
            {countryResults.map((c) => (
              <button
                key={c.iso + c.code}
                onClick={() => { setCountry(c); setShowCountry(false); setCountryQuery(""); }}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-muted text-sm transition"
              >
                <span className="flex items-center gap-2 min-w-0"><span className="text-base shrink-0">{c.flag}</span><span className="truncate">{c.name}</span></span>
                <span className="text-muted-foreground text-xs shrink-0 ml-2">{c.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCaller && (
        <div className="mx-4 animate-slide-up bg-surface border border-border rounded-2xl shadow-soft p-1.5 z-10">
          {callerIds.map((c) => (
            <button
              key={c.number}
              onClick={() => { setCallerId(c); setShowCaller(false); }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-muted text-sm"
            >
              <span className="flex items-center gap-2"><span>{c.flag}</span><span className="font-medium">{c.label}</span></span>
              <span className="text-xs text-muted-foreground">{c.number}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 px-6 py-2 flex-1 min-h-0">
        {[["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]].map(([n, l]) => (
          <button
            key={n}
            onClick={() => press(n)}
            className="rounded-xl bg-surface-2 hover:bg-accent active:scale-95 transition-all shadow-key flex flex-col items-center justify-center ring-ripple py-1.5"
          >
            <div className="text-xl font-semibold leading-none">{n}</div>
            {l && <div className="text-[8px] text-muted-foreground tracking-widest mt-0.5">{l}</div>}
          </button>
        ))}
      </div>

      <div className="px-5 pb-2.5 pt-1 flex items-center justify-between shrink-0">
        <button onClick={onIncoming} className="w-9 h-9 rounded-full bg-muted hover:bg-accent flex items-center justify-center ring-ripple" title="Simulate incoming">
          <PhoneIncoming className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={onRedial}
          disabled={!lastDialed}
          title={lastDialed ? `Redial ${lastDialed}` : "No recent number"}
          className={cn(
            "h-10 px-3 rounded-full flex items-center gap-1.5 ring-ripple transition",
            lastDialed ? "bg-emerald-soft text-emerald hover:brightness-95" : "bg-muted text-muted-foreground opacity-60",
          )}
        >
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span className="text-[10px] font-semibold">Redial</span>
        </button>
        <button
          onClick={doCall}
          className="w-14 h-14 rounded-full bg-emerald text-emerald-foreground flex items-center justify-center shadow-float hover:brightness-110 active:scale-95 transition-all ring-ripple"
        >
          <Phone className="w-6 h-6" />
        </button>
        <button onClick={() => setAddOpen(true)} className="w-9 h-9 rounded-full bg-muted hover:bg-accent flex items-center justify-center ring-ripple" title="Add contact">
          <UserPlus className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>


      <AddContactModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={(c) => { onAddContact(c); setAddOpen(false); }}
        defaultNumber={num ? toE164(num, country.code) : ""}
      />
    </div>
  );
}

function AddContactModal({ open, onClose, onSave, defaultNumber = "" }: {
  open: boolean;
  onClose: () => void;
  onSave: (c: Omit<Contact, "id" | "initials" | "color">) => void;
  defaultNumber?: string;
}) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState(defaultNumber);
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setName(""); setNumber(defaultNumber); setEmail(""); setCompany(""); setFavorite(false); setErr(null); } }, [open, defaultNumber]);

  const save = () => {
    if (!name.trim()) return setErr("Name is required");
    if (!number.trim()) return setErr("Phone number is required");
    onSave({ name: name.trim(), number: number.trim(), email: email.trim() || undefined, company: company.trim() || undefined, favorite, tags: [] });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New contact"
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-muted text-sm font-semibold">Cancel</button>
          <button onClick={save} className="flex-1 py-2.5 rounded-xl bg-emerald text-emerald-foreground text-sm font-semibold ring-ripple">Save contact</button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormField label="Full name *" placeholder="Jane Doe" value={name} onChange={setName} />
        <FormField label="Phone *" placeholder="+1 415 555 0123" value={number} onChange={setNumber} />
        <FormField label="Email" placeholder="jane@company.com" value={email} onChange={setEmail} />
        <FormField label="Company" placeholder="Acme Inc" value={company} onChange={setCompany} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="accent-emerald" />
          Mark as favorite
        </label>
        {err && <div className="text-xs text-twilio font-medium">{err}</div>}
      </div>
    </Modal>
  );
}

/* ---------- incoming call ---------- */

function IncomingCall({ onAccept, onReject }: { onAccept: () => void; onReject: () => void }) {
  return (
    <div className="h-full flex flex-col p-4 bg-gradient-to-b from-emerald-soft via-surface to-surface animate-slide-up overflow-y-auto">
      <div className="text-[10px] uppercase tracking-widest text-emerald font-semibold text-center">Incoming call</div>
      <div className="flex flex-col items-center gap-2 mt-3">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald to-emerald/70 flex items-center justify-center animate-pulse-ring">
          <div className="w-[52px] h-[52px] rounded-full bg-surface flex items-center justify-center animate-ring-shake">
            <PhoneIncoming className="w-6 h-6 text-emerald" />
          </div>
        </div>
        <div className="text-center">
          <div className="text-base font-bold tracking-tight leading-tight">Sarah Chen</div>
          <div className="text-xs text-muted-foreground">🇺🇸 +1 415 555 0142</div>
          <div className="text-[10px] text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <CircleDot className="w-2.5 h-2.5 text-twilio animate-pulse" /> Recording enabled
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={onReject} className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-twilio text-twilio-foreground font-semibold shadow-float active:scale-95 transition">
          <PhoneOff className="w-5 h-5" />
          <span className="text-xs">Decline</span>
        </button>
        <button onClick={onAccept} className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-emerald text-emerald-foreground font-semibold shadow-float active:scale-95 transition">
          <Phone className="w-5 h-5" />
          <span className="text-xs">Accept</span>
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="flex flex-col items-center gap-1 py-2 rounded-xl bg-muted text-xs"><MessageSquare className="w-4 h-4" />Reply</button>
        <button className="flex flex-col items-center gap-1 py-2 rounded-xl bg-muted text-xs"><Bell className="w-4 h-4" />Remind</button>
        <button className="flex flex-col items-center gap-1 py-2 rounded-xl bg-muted text-xs"><UserPlus className="w-4 h-4" />Save</button>
      </div>
    </div>
  );
}

/* ---------- active call ---------- */

function ActiveCall({ target, onEnd }: { target: { name: string; number: string }; onEnd: (dur: string) => void }) {
  const [seconds, setSeconds] = useState(0);
  const [mute, setMute] = useState(false);
  const [hold, setHold] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [recording, setRecording] = useState(true);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmf, setDtmf] = useState("");
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  // Mute/hold act on the live Twilio call, not just the UI.
  const toggleMute = () => {
    const next = !mute;
    setMute(next);
    twilioSetMuted(next);
  };
  const toggleHold = () => {
    const next = !hold;
    setHold(next);
    // No server-side hold: park the call by muting both directions locally.
    twilioSetMuted(next || mute);
  };

  /** Send a real DTMF digit to the far end + audible local feedback. */
  const pressDigit = (d: string) => {
    playDtmfTone(d);
    twilioSendDtmf(d);
    setDtmf((v) => (v + d).slice(-20));
  };

  return (
    <div className="h-full flex flex-col p-3 gap-2 bg-gradient-to-b from-surface via-surface to-emerald-soft/40 animate-slide-up overflow-y-auto">
      <div className="flex items-center justify-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald bg-emerald-soft px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse" /> Live
        </span>
        {recording && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-twilio bg-twilio-soft px-2 py-0.5 rounded-full">
            <CircleDot className="w-2.5 h-2.5 animate-pulse" /> Rec
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-3">
        <div className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-br from-emerald to-emerald/60 flex items-center justify-center text-base font-bold text-emerald-foreground shadow-key">
          {initialsOf(target.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold tracking-tight truncate">{target.name}</div>
          <div className="text-xs text-muted-foreground truncate">{dtmf ? `Tones: ${dtmf}` : target.number}</div>
        </div>
        <div className="text-lg font-semibold tabular-nums tracking-wider text-emerald shrink-0">{mm}:{ss}</div>
      </div>

      {showKeypad ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Keypad</span>
            <button onClick={() => setShowKeypad(false)} className="text-[10px] font-semibold text-emerald px-2 py-0.5 rounded-full bg-emerald-soft ring-ripple">
              Hide
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
              <button
                key={d}
                onClick={() => pressDigit(d)}
                className="rounded-xl bg-surface-2 hover:bg-accent active:scale-95 transition-all shadow-key py-2 text-lg font-semibold ring-ripple"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          <CallAction active={mute} onClick={toggleMute} icon={mute ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />} label="Mute" />
          <CallAction active={hold} onClick={toggleHold} icon={<Pause className="w-4 h-4" />} label="Hold" />
          <CallAction active={showKeypad} onClick={() => setShowKeypad(true)} icon={<Grid3x3 className="w-4 h-4" />} label="Keypad" />
          <CallAction active={speaker} onClick={() => setSpeaker(!speaker)} icon={<Volume2 className="w-4 h-4" />} label="Speaker" />
          <CallAction icon={<UserPlus className="w-4 h-4" />} label="Add" />
          <CallAction icon={<Users className="w-4 h-4" />} label="Merge" />
          <CallAction active={recording} onClick={() => setRecording(!recording)} icon={<Radio className="w-4 h-4" />} label="Record" />
          <CallAction icon={<FileText className="w-4 h-4" />} label="Notes" />
        </div>
      )}

      <button onClick={() => onEnd(`${mm}:${ss}`)} className="mt-auto w-full py-2.5 rounded-2xl bg-twilio text-twilio-foreground font-semibold shadow-float hover:brightness-110 transition ring-ripple flex items-center justify-center gap-2">
        <PhoneOff className="w-4 h-4" /> End call
      </button>
    </div>
  );
}


function CallAction({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cn(
      "flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition ring-ripple",
      active ? "bg-emerald text-emerald-foreground shadow-key" : "bg-muted hover:bg-accent"
    )}>
      {icon}
      <span className="text-[9px] font-medium leading-tight">{label}</span>
    </button>
  );
}

/* ---------- recent ---------- */

const STATUS_META: Record<CallStatus, { icon: React.ReactNode; color: string; label: string }> = {
  outgoing: { icon: <PhoneOutgoing className="w-3.5 h-3.5" />, color: "text-emerald", label: "Outgoing" },
  incoming: { icon: <PhoneIncoming className="w-3.5 h-3.5" />, color: "text-foreground", label: "Incoming" },
  missed: { icon: <PhoneMissed className="w-3.5 h-3.5" />, color: "text-twilio", label: "Missed" },
  failed: { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-twilio", label: "Failed" },
  busy: { icon: <Circle className="w-3.5 h-3.5" />, color: "text-amber-500", label: "Busy" },
  "no-answer": { icon: <PhoneOff className="w-3.5 h-3.5" />, color: "text-muted-foreground", label: "No answer" },
};

function Recent({ logs, onOpen, onCall }: { logs: CallLog[]; onOpen: (id: string) => void; onCall: (name: string, number: string) => void }) {
  const [filter, setFilter] = useState<"all" | "missed" | "incoming" | "outgoing">("all");
  const [q, setQ] = useState("");
  const filtered = useMemo(() =>
    logs.filter((l) => (filter === "all" || l.status === filter) && (l.name.toLowerCase().includes(q.toLowerCase()) || l.number.includes(q))),
    [filter, q, logs]);

  return (
    <div className="h-full flex flex-col animate-slide-up">
      <ScreenHeader title="Recent" right={
        <div className="flex gap-1">
          <button className="p-1.5 rounded-full hover:bg-muted ring-ripple"><RefreshCw className="w-4 h-4" /></button>
        </div>
      } />
      <div className="px-4 py-2 space-y-2 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs" className="bg-transparent outline-none text-sm flex-1" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {(["all", "missed", "incoming", "outgoing"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium capitalize whitespace-nowrap transition",
                filter === f ? "bg-emerald text-emerald-foreground shadow-key" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >{f}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && <Empty icon={<Clock className="w-6 h-6" />} title="No calls found" hint="Try a different filter." />}
        {filtered.map((l) => {
          const m = STATUS_META[l.status];
          return (
            <div key={l.id} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition text-left border-b border-border/40">
              <button onClick={() => onOpen(l.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <div className="w-10 h-10 rounded-2xl bg-emerald-soft flex items-center justify-center text-xs font-semibold text-emerald shrink-0">
                  {initialsOf(l.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("shrink-0", m.color)}>{m.icon}</span>
                    <span className={cn("font-medium text-sm truncate", l.status === "missed" && "text-twilio")}>{l.name}</span>
                    {l.recording && <Radio className="w-3 h-3 text-twilio shrink-0" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{l.flag} {l.number} · {l.duration} · {l.date} {l.time}</div>
                </div>
              </button>
              <button onClick={() => onCall(l.name, l.number)} className="w-8 h-8 rounded-full bg-emerald-soft text-emerald flex items-center justify-center hover:bg-emerald hover:text-emerald-foreground transition shrink-0">
                <Phone className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentDetail({ id, logs, onBack, onCall, onSms, onDelete }: {
  id: string; logs: CallLog[]; onBack: () => void;
  onCall: (name: string, number: string) => void;
  onSms: (name: string, number: string) => void;
  onDelete: (id: string) => void;
}) {
  const log = logs.find((l) => l.id === id);
  const [confirm, setConfirm] = useState(false);
  if (!log) return <Empty icon={<Clock className="w-6 h-6" />} title="Call not found" hint="It may have been deleted." />;
  const m = STATUS_META[log.status];
  return (
    <div className="h-full flex flex-col animate-slide-in-right">
      <ScreenHeader title="Call details" onBack={onBack} right={<button className="p-1.5 rounded-full hover:bg-muted"><MoreVertical className="w-4 h-4" /></button>} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex flex-col items-center py-3">
          <div className="w-18 h-18 rounded-full bg-gradient-to-br from-emerald to-emerald/70 flex items-center justify-center text-2xl font-bold text-emerald-foreground" style={{ width: 72, height: 72 }}>
            {initialsOf(log.name)}
          </div>
          <div className="mt-2 text-lg font-bold">{log.name}</div>
          <div className="text-xs text-muted-foreground">{log.flag} {log.number}</div>
          <div className={cn("mt-1 flex items-center gap-1.5 text-xs font-medium", m.color)}>{m.icon}{m.label} · {log.duration}</div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => onCall(log.name, log.number)} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-emerald text-emerald-foreground ring-ripple">
            <Phone className="w-4 h-4" /><span className="text-[10px] font-medium">Call</span>
          </button>
          <button onClick={() => onSms(log.name, log.number)} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-muted ring-ripple">
            <MessageSquare className="w-4 h-4" /><span className="text-[10px] font-medium">SMS</span>
          </button>
          <button className="flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-muted ring-ripple">
            <Star className="w-4 h-4" /><span className="text-[10px] font-medium">Favorite</span>
          </button>
          <button onClick={() => setConfirm(true)} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-twilio-soft text-twilio ring-ripple">
            <Trash2 className="w-4 h-4" /><span className="text-[10px] font-medium">Delete</span>
          </button>
        </div>

        {log.recording && (
          <div className="p-3 rounded-2xl bg-surface-2 border border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-twilio" /> Recording</div>
              <button className="text-[11px] text-emerald font-medium">Download</button>
            </div>
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 rounded-full bg-emerald text-emerald-foreground flex items-center justify-center"><Play className="w-3.5 h-3.5 ml-0.5" /></button>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full w-1/3 bg-emerald rounded-full" /></div>
              <span className="text-[10px] tabular-nums text-muted-foreground">01:12</span>
            </div>
          </div>
        )}

        <DetailRow k="Call SID" v={log.sid} copy />
        <DetailRow k="Direction" v={m.label} />
        <DetailRow k="Duration" v={log.duration} />
        <DetailRow k="Price" v={log.price ?? "—"} />
        <DetailRow k="Country" v={`${log.flag} ${log.country}`} />
        <DetailRow k="Twilio status" v="completed" />
      </div>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); onDelete(log.id); }}
        title="Delete call?"
        message={`This will remove the call log for ${log.name}.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmLabel: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-muted text-sm font-semibold">Cancel</button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-twilio text-twilio-foreground text-sm font-semibold ring-ripple">{confirmLabel}</button>
      </div>
    }>
      <p className="text-sm text-muted-foreground">{message}</p>
    </Modal>
  );
}

function DetailRow({ k, v, copy }: { k: string; v: string; copy?: boolean }) {
  const doCopy = () => { if (typeof navigator !== "undefined") navigator.clipboard?.writeText(v).catch(() => {}); };
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/40 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium flex items-center gap-1.5 truncate max-w-[65%]">
        <span className="truncate">{v}</span>
        {copy && <button onClick={doCopy} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-emerald" /></button>}
      </span>
    </div>
  );
}

/* ---------- favorites ---------- */

function Favorites({ contacts, onCall, onSms, onToggleFav }: {
  contacts: Contact[]; onCall: (n: string, num: string) => void; onSms: (c: Contact) => void; onToggleFav: (id: string) => void;
}) {
  const favs = contacts.filter((c) => c.favorite);
  return (
    <div className="h-full flex flex-col animate-slide-up">
      <ScreenHeader title="Favorites" />
      <div className="flex-1 overflow-y-auto p-4">
        {favs.length === 0 ? (
          <Empty icon={<Star className="w-6 h-6" />} title="No favorites yet" hint="Star contacts to see them here." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {favs.map((c) => (
              <div key={c.id} className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-surface-2 hover:shadow-soft transition">
                <button onClick={() => onToggleFav(c.id)} className="absolute -mt-1 -mr-1 self-end p-1 rounded-full hover:bg-muted"><Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" /></button>
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white shadow-key" style={{ backgroundColor: c.color }}>
                  {c.initials}
                </div>
                <div className="text-center min-w-0 w-full">
                  <div className="text-sm font-semibold truncate">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{c.number}</div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => onCall(c.name, c.number)} className="w-7 h-7 rounded-full bg-emerald text-emerald-foreground flex items-center justify-center"><Phone className="w-3 h-3" /></button>
                  <button onClick={() => onSms(c)} className="w-7 h-7 rounded-full bg-muted flex items-center justify-center"><MessageSquare className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- contacts ---------- */

function Contacts({ contacts, onBack, onCall, onSms, onAdd, onDelete, onToggleFav }: {
  contacts: Contact[]; onBack: () => void;
  onCall: (n: string, num: string) => void;
  onSms: (c: Contact) => void;
  onAdd: (c: Omit<Contact, "id" | "initials" | "color">) => Contact;
  onDelete: (id: string) => void;
  onToggleFav: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const filtered = contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.number.includes(q));
  const target = contacts.find((c) => c.id === delId);
  return (
    <div className="h-full flex flex-col animate-slide-up">
      <ScreenHeader title="Contacts" onBack={onBack} right={<button onClick={() => setAddOpen(true)} className="p-1.5 rounded-full hover:bg-muted ring-ripple"><Plus className="w-4 h-4" /></button>} />
      <div className="px-4 py-2 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="bg-transparent outline-none text-sm flex-1" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <Empty icon={<ContactIcon className="w-6 h-6" />} title="No contacts" hint="Tap + to add your first contact." />
        ) : filtered.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition border-b border-border/40">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: c.color }}>{c.initials}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate flex items-center gap-1.5">{c.name}
                <button onClick={() => onToggleFav(c.id)}>
                  <Star className={cn("w-3 h-3", c.favorite ? "text-amber-500 fill-amber-500" : "text-muted-foreground")} />
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">{c.company ? `${c.company} · ` : ""}{c.number}</div>
            </div>
            <button onClick={() => onCall(c.name, c.number)} className="w-8 h-8 rounded-full bg-emerald-soft text-emerald flex items-center justify-center hover:bg-emerald hover:text-emerald-foreground transition shrink-0"><Phone className="w-3.5 h-3.5" /></button>
            <button onClick={() => onSms(c)} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-accent shrink-0"><MessageSquare className="w-3.5 h-3.5" /></button>
            <button onClick={() => setDelId(c.id)} className="w-8 h-8 rounded-full bg-twilio-soft text-twilio flex items-center justify-center shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>

      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} onSave={(c) => { onAdd(c); setAddOpen(false); }} />
      <ConfirmModal
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => { if (delId) { onDelete(delId); setDelId(null); } }}
        title="Delete contact?"
        message={target ? `Remove ${target.name} from your contacts?` : "Remove this contact?"}
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ---------- SMS ---------- */

function Sms({ threads, contacts, onOpen, onDelete, onNew, onBack }: {
  threads: SmsThread[]; contacts: Contact[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: (name: string, number: string) => void;
  onBack: () => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  return (
    <div className="h-full flex flex-col animate-slide-up">
      <ScreenHeader title="Messages" onBack={onBack} right={<button onClick={() => setNewOpen(true)} className="p-1.5 rounded-full hover:bg-muted ring-ripple"><Plus className="w-4 h-4" /></button>} />
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <Empty icon={<MessageSquare className="w-6 h-6" />} title="No conversations" hint="Tap + to start a new message." />
        ) : threads.map((t) => (
          <div key={t.id} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition text-left border-b border-border/40">
            <button onClick={() => onOpen(t.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
              <div className="w-10 h-10 rounded-full bg-emerald-soft flex items-center justify-center text-xs font-semibold text-emerald shrink-0">{t.initials}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{t.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{t.time}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5 gap-2">
                  <span className={cn("text-xs truncate", t.unread ? "text-foreground font-medium" : "text-muted-foreground")}>{t.last || "No messages yet"}</span>
                  {t.unread > 0 && <span className="ml-2 w-4 h-4 rounded-full bg-emerald text-emerald-foreground text-[9px] font-bold flex items-center justify-center shrink-0">{t.unread}</span>}
                </div>
              </div>
            </button>
            <button onClick={() => setDelId(t.id)} className="w-8 h-8 rounded-full bg-twilio-soft text-twilio flex items-center justify-center shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <NewSmsModal open={newOpen} onClose={() => setNewOpen(false)} contacts={contacts} onStart={(n, num) => { onNew(n, num); setNewOpen(false); }} />
      <ConfirmModal
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => { if (delId) { onDelete(delId); setDelId(null); } }}
        title="Delete conversation?"
        message="This will remove the conversation history from view."
        confirmLabel="Delete"
      />
    </div>
  );
}

function NewSmsModal({ open, onClose, contacts, onStart }: {
  open: boolean; onClose: () => void; contacts: Contact[]; onStart: (name: string, number: string) => void;
}) {
  const [q, setQ] = useState("");
  const [manualNum, setManualNum] = useState("");
  useEffect(() => { if (open) { setQ(""); setManualNum(""); } }, [open]);
  const filtered = contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.number.includes(q));
  return (
    <Modal open={open} onClose={onClose} title="New message" footer={
      <button
        onClick={() => manualNum.trim() && onStart(manualNum.trim(), manualNum.trim())}
        disabled={!manualNum.trim()}
        className={cn("w-full py-2.5 rounded-xl text-sm font-semibold", manualNum.trim() ? "bg-emerald text-emerald-foreground" : "bg-muted text-muted-foreground")}
      >Start conversation</button>
    }>
      <div className="space-y-3">
        <FormField label="Send to new number" placeholder="+1 415 555 0123" value={manualNum} onChange={setManualNum} />
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pt-1">Or pick a contact</div>
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="bg-transparent outline-none text-sm flex-1" />
        </div>
        <div className="max-h-56 overflow-y-auto -mx-1">
          {filtered.map((c) => (
            <button key={c.id} onClick={() => onStart(c.name, c.number)} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-muted text-left">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: c.color }}>{c.initials}</div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{c.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{c.number}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No contacts match.</div>}
        </div>
      </div>
    </Modal>
  );
}

function SmsThreadView({ id, threads, setThreads, onBack, onCall, creds, toast }: {
  id: string; threads: SmsThread[]; setThreads: React.Dispatch<React.SetStateAction<SmsThread[]>>;
  onBack: () => void; onCall: (name: string, number: string) => void;
  creds: TwilioCredsShape & { region: string };
  toast: (text: string, tone?: "emerald" | "twilio") => void;
}) {
  const t = threads.find((s) => s.id === id);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<{ me: boolean; text: string; time: string; status?: string }[]>(() =>
    t && t.last ? [
      { me: false, text: "Hi! Are we still on for the demo today?", time: "10:32 AM" },
      { me: true, text: "Yes! Sending the link in 5 min.", time: "10:34 AM" },
      { me: false, text: t.last, time: t.time },
    ] : []
  );

  if (!t) {
    return (
      <div className="h-full flex flex-col">
        <ScreenHeader title="Conversation" onBack={onBack} />
        <Empty icon={<MessageSquare className="w-6 h-6" />} title="Thread not found" hint="It may have been deleted." />
      </div>
    );
  }

  const send = async () => {
    const body = msg.trim();
    if (!body || sending) return;
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    setMessages((m) => [...m, { me: true, text: body, time, status: "sending" }]);
    setThreads((all) => all.map((x) => x.id === t.id ? { ...x, last: body, time: "now", unread: 0 } : x));
    setMsg("");
    if (!creds.accountSid || !creds.authToken || !creds.callerId) {
      toast("Add Twilio credentials + caller ID to send real SMS", "twilio");
      setMessages((m) => m.map((x, i) => i === m.length - 1 ? { ...x, status: "unsent" } : x));
      return;
    }
    setSending(true);
    try {
      const res = await sendSmsFn({ data: {
        accountSid: creds.accountSid, authToken: creds.authToken,
        from: creds.callerId, to: t.number, body,
      }});
      setMessages((m) => m.map((x, idx) => idx === m.length - 1 ? { ...x, status: String(res.status || "sent") } : x));
      toast(`SMS ${res.status || "sent"}`, "emerald");
    } catch (e) {
      setMessages((m) => m.map((x, idx) => idx === m.length - 1 ? { ...x, status: "failed" } : x));
      toast(e instanceof Error ? e.message : "SMS failed", "twilio");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="h-full flex flex-col animate-slide-in-right">
      <ScreenHeader
        title={t.name}
        onBack={onBack}
        right={<button onClick={() => onCall(t.name, t.number)} className="p-1.5 rounded-full hover:bg-muted ring-ripple"><Phone className="w-4 h-4 text-emerald" /></button>}
      />
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-surface-2/40">
        {messages.length === 0 && <Empty icon={<MessageSquare className="w-6 h-6" />} title="Say hello" hint={`Start the conversation with ${t.name}.`} />}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.me ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[75%] px-3 py-2 rounded-2xl text-sm",
              m.me ? "bg-emerald text-emerald-foreground rounded-br-md" : "bg-surface border border-border rounded-bl-md"
            )}>
              {m.text}
              <div className={cn("text-[9px] mt-0.5", m.me ? "text-emerald-foreground/70" : "text-muted-foreground")}>{m.time}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-border/60 bg-surface flex items-center gap-2 shrink-0">
        <button className="p-2 rounded-full hover:bg-muted"><Paperclip className="w-4 h-4 text-muted-foreground" /></button>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message"
          className="flex-1 px-3 py-2 rounded-full bg-muted text-sm outline-none focus:ring-2 focus:ring-emerald/50"
        />
        <button className="p-2 rounded-full hover:bg-muted"><Smile className="w-4 h-4 text-muted-foreground" /></button>
        <button onClick={send} className="w-9 h-9 rounded-full bg-emerald text-emerald-foreground flex items-center justify-center ring-ripple"><Send className="w-4 h-4" /></button>
      </div>
      <div className="text-[9px] text-muted-foreground text-center pb-1">{msg.length}/160 · from {callerIds[0].number}</div>
    </div>
  );
}

/* ---------- auto dialer ---------- */

const SAMPLE_CSV = "name,number,notes\nJane Doe,+14155550142,Follow up on demo\nJohn Smith,+442079460958,Priority lead\nPriya N,+919845012345,Interested in Pro plan\n";

function AutoDialer({ logs, toast }: { logs: CallLog[]; toast: (t: string, tone?: "emerald" | "twilio") => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(35);
  const [queue, setQueue] = useState<{ name: string; number: string }[]>(
    logs.slice(0, 4).map((l) => ({ name: l.name, number: l.number }))
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const intv = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) intv.current = setInterval(() => setProgress((p) => Math.min(100, p + 2)), 400);
    else if (intv.current) clearInterval(intv.current);
    return () => { if (intv.current) clearInterval(intv.current); };
  }, [running]);

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ringly-sample.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Sample CSV downloaded", "emerald");
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return toast("File is empty", "twilio");
    const header = lines[0].toLowerCase();
    const hasHeader = /name|number|phone/.test(header);
    const rows = hasHeader ? lines.slice(1) : lines;
    const parsed: { name: string; number: string }[] = [];
    for (const r of rows) {
      const parts = r.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      if (parts.length === 1 && parts[0]) parsed.push({ name: parts[0], number: parts[0] });
      else if (parts.length >= 2) parsed.push({ name: parts[0] || parts[1], number: parts[1] });
    }
    if (parsed.length === 0) return toast("No valid rows found", "twilio");
    setQueue(parsed);
    setProgress(0);
    setRunning(false);
    toast(`Loaded ${parsed.length} numbers`, "emerald");
  };

  return (
    <div className="h-full flex flex-col animate-slide-up">
      <ScreenHeader title="Auto Dialer" right={
        <button onClick={downloadSample} className="p-1.5 rounded-full hover:bg-muted ring-ripple" title="Download sample CSV">
          <Download className="w-4 h-4" />
        </button>
      } />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald to-emerald/80 text-emerald-foreground shadow-float">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-80">Campaign</div>
              <div className="text-base font-semibold">Q3 Outbound Leads</div>
            </div>
            <Zap className="w-5 h-5" />
          </div>
          <div className="h-1.5 bg-emerald-foreground/20 rounded-full overflow-hidden mb-1.5">
            <div className="h-full bg-emerald-foreground rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] opacity-90">
            <span>{Math.floor(progress * queue.length / 100)}/{queue.length} calls</span>
            <span>{progress}%</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Queued" v={queue.length - Math.floor(progress * queue.length / 100)} />
          <Stat label="Answered" v={Math.floor(progress * 0.28)} tone="emerald" />
          <Stat label="Missed" v={Math.floor(progress * 0.09)} tone="twilio" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setRunning(true)} className="py-2.5 rounded-2xl bg-emerald text-emerald-foreground text-xs font-semibold flex items-center justify-center gap-1.5 shadow-key ring-ripple">
            <Play className="w-3.5 h-3.5" /> Start
          </button>
          <button onClick={() => setRunning(false)} className="py-2.5 rounded-2xl bg-muted text-xs font-semibold flex items-center justify-center gap-1.5 ring-ripple">
            <PauseCircle className="w-3.5 h-3.5" /> Pause
          </button>
          <button onClick={() => { setRunning(false); setProgress(0); }} className="py-2.5 rounded-2xl bg-twilio-soft text-twilio text-xs font-semibold flex items-center justify-center gap-1.5 ring-ripple">
            <XCircle className="w-3.5 h-3.5" /> Stop
          </button>
        </div>

        <div className="rounded-2xl border border-dashed border-border p-3 space-y-2">
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-muted transition"
          >
            <Upload className="w-5 h-5 text-muted-foreground" />
            <div className="text-xs font-semibold">Upload CSV / Excel</div>
            <div className="text-[10px] text-muted-foreground">name, number, notes</div>
          </button>
          <input ref={inputRef} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <button onClick={downloadSample} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-soft text-emerald text-xs font-semibold ring-ripple">
            <Download className="w-3.5 h-3.5" /> Download sample CSV
          </button>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Queue preview ({queue.length})</div>
          <div className="space-y-1.5">
            {queue.slice(0, 6).map((l, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-xl bg-surface-2 text-xs">
                <div className={cn("w-1.5 h-1.5 rounded-full", i === 0 && running ? "bg-emerald animate-pulse" : "bg-muted-foreground/40")} />
                <span className="flex-1 truncate">{l.name}</span>
                <span className="text-muted-foreground truncate max-w-[45%]">{l.number}</span>
                {i === 0 && running && <span className="text-emerald text-[9px] font-semibold">DIALING</span>}
              </div>
            ))}
            {queue.length === 0 && <div className="text-xs text-muted-foreground text-center py-3">Upload a CSV to build a queue.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: string | number; tone?: "emerald" | "twilio" }) {
  return (
    <div className="p-2.5 rounded-xl bg-surface-2 text-center">
      <div className={cn("text-lg font-bold tabular-nums", tone === "emerald" && "text-emerald", tone === "twilio" && "text-twilio")}>{v}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

/* ---------- more / settings ---------- */

function More({ go, onLogout }: { go: (s: Screen) => void; onLogout: () => void }) {
  return (
    <div className="h-full overflow-y-auto animate-slide-up">
      <ScreenHeader title="More" />
      <div className="p-4 space-y-3">
        <button onClick={() => go("account")} className="w-full flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-emerald-soft to-surface-2 hover:shadow-soft transition ring-ripple">
          <div className="w-12 h-12 rounded-full bg-emerald flex items-center justify-center text-emerald-foreground font-bold">JD</div>
          <div className="flex-1 text-left min-w-0">
            <div className="font-semibold text-sm truncate">John Doe</div>
            <div className="text-[11px] text-muted-foreground truncate">john@company.com</div>
            <div className="text-[10px] text-emerald mt-0.5">Pro plan · 2,340 min left</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <MoreSection title="Communication">
          <MoreItem icon={<MessageSquare className="w-4 h-4" />} label="Messages" onClick={() => go("sms")} />
          <MoreItem icon={<ContactIcon className="w-4 h-4" />} label="Contacts" onClick={() => go("contacts")} />
          <MoreItem icon={<Mail className="w-4 h-4" />} label="Gmail integration" badge="Connected" onClick={() => go("gmail")} />
        </MoreSection>

        <MoreSection title="Setup">
          <MoreItem icon={<SettingsIcon className="w-4 h-4" />} label="Settings" onClick={() => go("settings")} />
          <MoreItem icon={<Sparkles className="w-4 h-4" />} label="Twilio credentials" badge="Verified" tone="emerald" onClick={() => go("twilio-settings")} />
          <MoreItem icon={<Shield className="w-4 h-4" />} label="Security & 2FA" />
          <MoreItem icon={<Bell className="w-4 h-4" />} label="Notifications" />
        </MoreSection>

        <MoreSection title="Support">
          <MoreItem icon={<CreditCard className="w-4 h-4" />} label="Billing & credits" onClick={() => go("billing")} />
          <MoreItem icon={<HelpCircle className="w-4 h-4" />} label="Help & docs" />
          <MoreItem icon={<ExternalLink className="w-4 h-4" />} label="Release notes" />
        </MoreSection>

        <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl bg-twilio-soft text-twilio font-medium text-sm ring-ripple">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
        <div className="text-center text-[10px] text-muted-foreground pb-2">Ringly v1.2.0 · Chrome 127+</div>
      </div>
    </div>
  );
}

function MoreSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">{title}</div>
      <div className="bg-surface-2 rounded-2xl divide-y divide-border/40 overflow-hidden">{children}</div>
    </div>
  );
}
function MoreItem({ icon, label, badge, tone, onClick }: { icon: React.ReactNode; label: string; badge?: string; tone?: "emerald" | "twilio"; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition text-left">
      <span className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center text-muted-foreground shrink-0">{icon}</span>
      <span className="flex-1 text-sm font-medium truncate">{label}</span>
      {badge && <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0", tone === "emerald" ? "bg-emerald text-emerald-foreground" : "bg-emerald-soft text-emerald")}>{badge}</span>}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </button>
  );
}

function Settings({ onBack, dark, setDark, callSettings, updateCallSettings, toast }: {
  onBack: () => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  callSettings: CallSettings;
  updateCallSettings: (patch: Partial<CallSettings>) => void;
  toast: (t: string, tone?: "emerald" | "twilio") => void;
}) {
  const [fwdDraft, setFwdDraft] = useState(callSettings.forwardTo);
  useEffect(() => { setFwdDraft(callSettings.forwardTo); }, [callSettings.forwardTo]);

  const [autoRecOut, setAutoRecOut] = useState(true);
  const [autoRecIn, setAutoRecIn] = useState(false);
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [echo, setEcho] = useState(true);
  const [noise, setNoise] = useState(true);
  const [pin, setPin] = useState(false);
  const [enc, setEnc] = useState(true);
  return (
    <div className="h-full overflow-y-auto animate-slide-in-right">
      <ScreenHeader title="Settings" onBack={onBack} />
      <div className="p-4 space-y-3">
        <MoreSection title="Appearance">
          <ToggleRow label="Dark mode" v={dark} onChange={setDark} />
          <SelectRow label="Language" value="English (US)" />
        </MoreSection>

        <MoreSection title="Incoming calls">
          <ToggleRow
            label="Accept incoming calls"
            v={callSettings.incomingEnabled}
            onChange={(v) => {
              updateCallSettings({ incomingEnabled: v });
              toast(v ? "Incoming calls enabled" : "Incoming calls disabled", v ? "emerald" : "twilio");
            }}
          />
          <ToggleRow
            label="Forward incoming calls"
            v={callSettings.forwardingEnabled}
            onChange={(v) => {
              if (v && !callSettings.forwardTo.trim()) return toast("Add a forwarding number first", "twilio");
              updateCallSettings({ forwardingEnabled: v });
              toast(v ? `Forwarding to ${callSettings.forwardTo}` : "Forwarding turned off", v ? "emerald" : "twilio");
            }}
          />
          <div className="px-3 py-2.5 space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">Forward to (temporary)</div>
            <div className="flex gap-2">
              <input
                value={fwdDraft}
                onChange={(e) => setFwdDraft(e.target.value)}
                placeholder="+919145050514"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald/50"
              />
              <button
                onClick={() => {
                  const v = fwdDraft.trim();
                  if (!/^\+?\d{6,15}$/.test(v.replace(/[\s\-()]/g, ""))) return toast("Enter a valid number", "twilio");
                  updateCallSettings({ forwardTo: v });
                  toast("Forwarding number saved", "emerald");
                }}
                className="shrink-0 px-3 rounded-xl bg-emerald text-emerald-foreground text-xs font-semibold ring-ripple"
              >
                Save
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {callSettings.incomingEnabled
                ? callSettings.forwardingEnabled
                  ? `Callers are redirected to ${callSettings.forwardTo}.`
                  : "Calls ring in this softphone."
                : "All inbound calls are declined."}
            </div>
          </div>
        </MoreSection>

        <MoreSection title="Calls">
          <ToggleRow label="Auto-record outgoing" v={autoRecOut} onChange={setAutoRecOut} />
          <ToggleRow label="Auto-record incoming" v={autoRecIn} onChange={setAutoRecIn} />
          <ToggleRow label="Auto-answer" v={autoAnswer} onChange={setAutoAnswer} />
          <ToggleRow label="Call waiting" v={waiting} onChange={setWaiting} />
        </MoreSection>
        <MoreSection title="Audio">
          <SelectRow label="Input device" value="MacBook Mic" />
          <SelectRow label="Output device" value="AirPods Pro" />
          <ToggleRow label="Echo cancellation" v={echo} onChange={setEcho} />
          <ToggleRow label="Noise suppression" v={noise} onChange={setNoise} />
        </MoreSection>
        <MoreSection title="Security">
          <ToggleRow label="PIN lock" v={pin} onChange={setPin} />
          <ToggleRow label="Encrypt local storage" v={enc} onChange={setEnc} />
        </MoreSection>
      </div>
    </div>
  );
}

function ToggleRow({ label, v, onChange }: { label: string; v: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!v)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted transition">
      <span className="text-sm font-medium">{label}</span>
      <span className={cn("w-9 h-5 rounded-full relative transition shrink-0", v ? "bg-emerald" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-key transition-all", v ? "left-4" : "left-0.5")} />
      </span>
    </button>
  );
}
function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <button className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted transition">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[55%]"><span className="truncate">{value}</span><ChevronRight className="w-3 h-3 shrink-0" /></span>
    </button>
  );
}

/* ---------- Twilio settings (editable + test) ---------- */

type TwilioCreds = TwilioCredsShape & { region: string };

function TwilioSettings({ onBack, creds, setCreds, toast }: {
  onBack: () => void;
  creds: TwilioCreds;
  setCreds: React.Dispatch<React.SetStateAction<TwilioCreds>>;
  toast: (t: string, tone?: "emerald" | "twilio") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(creds);
  const [reveal, setReveal] = useState({ token: false, key: false });
  const [testing, setTesting] = useState<null | "running" | "ok" | "fail">(null);
  const [lastSync, setLastSync] = useState("2m ago");

  useEffect(() => { if (editing) setDraft(creds); }, [editing, creds]);

  const runTest = async () => {
    setTesting("running");
    try {
      const res = await testConnectionFn({ data: { accountSid: creds.accountSid, authToken: creds.authToken } });
      if (res.ok) {
        setTesting("ok");
        toast(`Connected: ${res.friendlyName || creds.accountSid}`, "emerald");
        setLastSync("just now");
      } else {
        setTesting("fail");
        toast(`Test failed (${res.status})`, "twilio");
      }
    } catch (e) {
      setTesting("fail");
      toast(e instanceof Error ? e.message : "Test failed", "twilio");
    }
    setTimeout(() => setTesting(null), 2500);
  };

  const save = () => {
    setCreds(draft);
    setEditing(false);
    toast("Credentials updated", "emerald");
    setLastSync("just now");
  };

  const copy = async (v: string) => {
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      toast("Copied to clipboard", "emerald");
    } catch {
      toast("Copy blocked by browser", "twilio");
    }
  };


  return (
    <div className="h-full overflow-y-auto animate-slide-in-right">
      <ScreenHeader title="Twilio credentials" onBack={onBack} right={
        !editing ? (
          <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-emerald px-2 py-1 rounded-full hover:bg-emerald-soft">Edit</button>
        ) : (
          <button onClick={() => setEditing(false)} className="text-[11px] font-semibold text-muted-foreground px-2 py-1 rounded-full hover:bg-muted">Cancel</button>
        )
      } />
      <div className="p-4 space-y-3">
        <div className={cn(
          "p-3 rounded-2xl border flex items-center gap-2",
          testing === "fail" ? "bg-twilio-soft border-twilio/30" : "bg-emerald-soft border-emerald/20"
        )}>
          {testing === "running" ? <RefreshCw className="w-4 h-4 text-emerald animate-spin shrink-0" /> :
           testing === "fail" ? <XCircle className="w-4 h-4 text-twilio shrink-0" /> :
           <CheckCircle2 className="w-4 h-4 text-emerald shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className={cn("text-xs font-semibold truncate", testing === "fail" ? "text-twilio" : "text-emerald")}>
              {testing === "running" ? "Testing connection…" : testing === "fail" ? "Connection failed" : "Connected to Twilio"}
            </div>
            <div className="text-[10px] opacity-80 truncate">Region: {creds.region} · Last sync {lastSync}</div>
          </div>
          <button onClick={runTest} disabled={testing === "running"} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-surface shadow-key shrink-0">
            {testing === "running" ? "…" : "Test"}
          </button>
        </div>

        <MoreSection title="Authentication">
          {editing ? (
            <div className="p-3 space-y-2.5">
              <FormField label="Account SID" value={draft.accountSid} onChange={(v) => setDraft({ ...draft, accountSid: v })} placeholder="ACxxxxxxxx" />
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Auth Token</span>
                  <button onClick={() => setReveal((r) => ({ ...r, token: !r.token }))} className="text-[10px] text-emerald flex items-center gap-1">
                    {reveal.token ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {reveal.token ? "Hide" : "Reveal"}
                  </button>
                </div>
                <input
                  type={reveal.token ? "text" : "password"}
                  value={draft.authToken}
                  onChange={(e) => setDraft({ ...draft, authToken: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald/50"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">API Key SID</span>
                </div>
                <input
                  value={draft.apiKeySid}
                  onChange={(e) => setDraft({ ...draft, apiKeySid: e.target.value })}
                  placeholder="SKxxxxxxxx"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald/50"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">API Key Secret</span>
                  <button onClick={() => setReveal((r) => ({ ...r, key: !r.key }))} className="text-[10px] text-emerald flex items-center gap-1">
                    {reveal.key ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {reveal.key ? "Hide" : "Reveal"}
                  </button>
                </div>
                <input
                  type={reveal.key ? "text" : "password"}
                  value={draft.apiKeySecret}
                  onChange={(e) => setDraft({ ...draft, apiKeySecret: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald/50"
                />
              </div>
              <FormField label="Identity" value={draft.identity} onChange={(v) => setDraft({ ...draft, identity: v })} placeholder="agent-01" />
              <FormField label="TwiML App SID" value={draft.twimlAppSid} onChange={(v) => setDraft({ ...draft, twimlAppSid: v })} placeholder="APxxxx" />
              <FormField label="Caller ID (verified Twilio number)" value={draft.callerId} onChange={(v) => setDraft({ ...draft, callerId: v })} placeholder="+14155550100" />
              <FormField label="My phone (call bridge fallback)" value={draft.agentPhone ?? ""} onChange={(v) => setDraft({ ...draft, agentPhone: v })} placeholder="+919145050514" />
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl bg-muted text-sm font-semibold">Cancel</button>
                <button onClick={save} className="flex-1 py-2 rounded-xl bg-emerald text-emerald-foreground text-sm font-semibold ring-ripple">Save</button>
              </div>
            </div>
          ) : (
            <>
              <SecretRow label="Account SID" value={creds.accountSid} secret onCopy={copy} />
              <SecretRow label="Auth Token" value={creds.authToken} secret onCopy={copy} />
              <SecretRow label="API Key SID" value={creds.apiKeySid} secret onCopy={copy} />
              <SecretRow label="API Key Secret" value={creds.apiKeySecret} secret onCopy={copy} />
              <SecretRow label="Caller ID" value={creds.callerId} onCopy={copy} />
              <SecretRow label="Identity" value={creds.identity} onCopy={copy} />
              <SecretRow label="TwiML App SID" value={creds.twimlAppSid} secret onCopy={copy} />
              <SecretRow label="My phone" value={creds.agentPhone ?? ""} onCopy={copy} />
              <div className="p-3 pt-1">
                <button onClick={() => setEditing(true)} className="w-full py-2 rounded-xl bg-emerald-soft text-emerald text-sm font-semibold ring-ripple">Edit credentials</button>
              </div>
            </>
          )}

        </MoreSection>

        <MoreSection title="Region">
          <ValueRow label="Voice region" value={creds.region} />
          <ValueRow label="Environment" value="Production" />
        </MoreSection>

        <MoreSection title="Caller IDs">
          {callerIds.map((c) => (
            <div key={c.number} className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span>{c.flag}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{c.number}</div>
                </div>
              </div>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-soft text-emerald shrink-0">Verified</span>
            </div>
          ))}
        </MoreSection>

        <button onClick={runTest} disabled={testing === "running"} className="w-full py-2.5 rounded-2xl bg-emerald text-emerald-foreground text-sm font-semibold ring-ripple flex items-center justify-center gap-2">
          {testing === "running" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {testing === "running" ? "Testing…" : "Test connection"}
        </button>
      </div>
    </div>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground truncate max-w-[55%]">{value}</span>
    </div>
  );
}

/** Credential row: masked by default, revealable and copyable. */
function SecretRow({ label, value, secret, onCopy }: {
  label: string;
  value: string;
  secret?: boolean;
  onCopy: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const masked = !value
    ? "—"
    : value.length <= 4
      ? value
      : "•".repeat(Math.min(10, Math.max(4, value.length - 4))) + value.slice(-4);
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
      <span className="text-sm font-medium shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs text-muted-foreground truncate font-mono">
          {!secret || show ? (value || "—") : masked}
        </span>
        {secret && value && (
          <button onClick={() => setShow((s) => !s)} className="p-1 rounded-md hover:bg-muted shrink-0" aria-label={show ? "Hide" : "Reveal"}>
            {show ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
        )}
        {value && (
          <button onClick={() => onCopy(value)} className="p-1 rounded-md hover:bg-muted shrink-0" aria-label="Copy">
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}


function GmailIntegration({ onBack, toast }: { onBack: () => void; toast: (t: string, tone?: "emerald" | "twilio") => void }) {
  const [connected, setConnected] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const doSync = () => {
    setSyncing(true);
    setTimeout(() => { setSyncing(false); toast("Gmail synced", "emerald"); }, 900);
  };
  return (
    <div className="h-full overflow-y-auto animate-slide-in-right">
      <ScreenHeader title="Gmail integration" onBack={onBack} />
      <div className="p-4 space-y-3">
        <div className="p-4 rounded-2xl bg-surface-2 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-surface shadow-key flex items-center justify-center shrink-0"><GoogleIcon /></div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">john@gmail.com</div>
            <div className={cn("text-[10px] flex items-center gap-1", connected ? "text-emerald" : "text-muted-foreground")}>
              {connected ? <><CheckCircle2 className="w-3 h-3" /> Connected · Last sync 3m ago</> : <>Not connected</>}
            </div>
          </div>
          <button onClick={() => { setConnected(!connected); toast(connected ? "Gmail disconnected" : "Gmail connected", connected ? "twilio" : "emerald"); }} className={cn("text-[11px] font-semibold shrink-0", connected ? "text-twilio" : "text-emerald")}>
            {connected ? "Disconnect" : "Connect"}
          </button>
        </div>
        <button onClick={doSync} disabled={syncing || !connected} className="w-full py-2.5 rounded-2xl bg-emerald text-emerald-foreground text-sm font-semibold ring-ripple flex items-center justify-center gap-2 disabled:opacity-60">
          <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} /> {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </div>
  );
}

function Account({ onBack, onBilling }: { onBack: () => void; onBilling: () => void }) {
  return (
    <div className="h-full overflow-y-auto animate-slide-in-right">
      <ScreenHeader title="Account" onBack={onBack} right={
        <button onClick={onBilling} className="text-[11px] font-semibold text-emerald px-2 py-1 rounded-full hover:bg-emerald-soft">Billing</button>
      } />

      <div className="p-4 space-y-3">
        <div className="flex flex-col items-center p-4 rounded-2xl bg-gradient-to-br from-emerald to-emerald/70 text-emerald-foreground shadow-float">
          <div className="w-14 h-14 rounded-full bg-emerald-foreground/20 flex items-center justify-center text-xl font-bold">JD</div>
          <div className="mt-2 text-lg font-bold">John Doe</div>
          <div className="text-xs opacity-90">Acme Inc</div>
          <div className="mt-2 flex gap-2 text-[10px]">
            <span className="px-2 py-0.5 rounded-full bg-emerald-foreground/20">Pro plan</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-foreground/20">Renews Aug 12</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Calls today" v={42} tone="emerald" />
          <Stat label="Answered" v={31} tone="emerald" />
          <Stat label="Missed" v={4} tone="twilio" />
        </div>
        <MoreSection title="Details">
          <ValueRow label="Email" value="john@company.com" />
          <ValueRow label="Twilio SID" value="AC••••4321" />
          <ValueRow label="Extension version" value="1.2.0" />
        </MoreSection>
      </div>
    </div>
  );
}

/* ---------- billing (mock UI only) ---------- */

function Billing({ onBack, onLogout, toast }: {
  onBack: () => void;
  onLogout: () => void;
  toast: (t: string, tone?: "emerald" | "twilio") => void;
}) {
  const used = 64;
  const total = 100;
  const pct = Math.round((used / total) * 100);
  return (
    <div className="h-full overflow-y-auto animate-slide-in-right">
      <ScreenHeader title="Account & Billing" onBack={onBack} right={
        <button onClick={onLogout} aria-label="Sign out" className="p-1.5 rounded-xl bg-emerald-soft text-emerald ring-ripple">
          <LogOut className="w-4 h-4" />
        </button>
      } />
      <div className="p-4 space-y-3">
        <div className="text-[11px] text-muted-foreground">Track call usage and purchase credits.</div>

        <div className="rounded-2xl border border-emerald/20 border-l-4 border-l-emerald bg-emerald-soft/40 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-emerald">Usage &amp; credits</div>
            <div className="text-sm font-bold text-emerald tabular-nums">{used} / {total}</div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-muted-foreground">Total calls</span>
              <span className="font-semibold text-emerald">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-emerald/15 overflow-hidden">
              <div className="h-full rounded-full bg-emerald transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-emerald/30 bg-surface/70 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Outgoing</div>
              <div className="text-lg font-bold text-emerald tabular-nums">63</div>
              <div className="text-[9px] text-muted-foreground">calls made</div>
            </div>
            <div className="rounded-xl border border-emerald/20 bg-surface/70 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Incoming</div>
              <div className="text-lg font-bold text-emerald tabular-nums">1</div>
              <div className="text-[9px] text-muted-foreground">calls received</div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground border-t border-emerald/15 pt-2">
            Usage is combined across all users and extensions sharing this Twilio account.
          </div>
        </div>

        <div className="rounded-2xl border border-emerald/25 bg-surface-2 p-3 text-center space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Credits &amp; top-up</div>
          <button
            onClick={() => toast("Billing is a preview — top-up coming soon", "emerald")}
            className="px-4 py-2 rounded-xl bg-emerald-soft text-emerald text-sm font-semibold border border-emerald/40 ring-ripple"
          >
            Enjoy 100 Calls
          </button>
        </div>

        <div className="rounded-2xl bg-surface-2 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground border-b border-border/60 pb-2">Actions</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onLogout} className="py-2.5 rounded-xl bg-twilio text-twilio-foreground text-sm font-semibold ring-ripple">Logout</button>
            <button onClick={() => toast("Help & docs coming soon", "emerald")} className="py-2.5 rounded-xl bg-foreground/80 text-background text-sm font-semibold ring-ripple">Help</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- utils ---------- */


function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-emerald-soft text-emerald flex items-center justify-center mb-3">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}
