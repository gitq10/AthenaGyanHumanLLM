import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, ConversationSession, Conversation } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  Send, Plus, MessageSquare, LogOut, User, ChevronLeft,
  Menu, X, Leaf, Brain, ExternalLink, BookOpen, Youtube,
  Sparkles, ArrowRight, MessageCircle, Lightbulb, Zap, ChevronRight,
  PanelLeftClose, PanelLeftOpen,
  ThumbsUp, Copy, RefreshCw, Download, StickyNote, Share2, Check, Paperclip, Mic, MicOff, Volume2, VolumeX, Globe
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | 'intake'       // User types first message
  | 'outcome'      // Gyan offers outcome chips + free text
  | 'context'      // Gyan asks up to 2 context questions (one at a time)
  | 'report'       // Final intelligence delivered
  | 'followup'     // Post-report: suggested questions, ask own, or companion
  | 'companion';   // Free chat mode

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  phase: Phase;
  links?: VisualLink[];
  usedMemory?: boolean;
  usedWebSearch?: boolean;
  outcomeChips?: string[];
  suggestedQuestions?: string[];
};

type VisualLink = {
  title: string;
  type: 'youtube' | 'wikipedia';
  url: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildVisualLinks(content: string): VisualLink[] {
  const keywords = extractKeywords(content);
  const links: VisualLink[] = [];
  keywords.slice(0, 2).forEach(kw => {
    const encoded = encodeURIComponent(kw);
    links.push({ title: `Watch: ${kw}`, type: 'youtube', url: `https://www.youtube.com/results?search_query=${encoded}` });
    links.push({ title: `Read: ${kw}`, type: 'wikipedia', url: `https://en.wikipedia.org/wiki/Special:Search?search=${encoded}` });
  });
  return links;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','of','in','on','at','to','for','with','by','from','up','about','into','through','during','including','until','against','among','throughout','despite','towards','upon','concerning','and','but','or','nor','not','no','so','yet','both','either','neither','if','then','else','when','while','although','though','because','since','unless','before','after','as','where','wherever','whenever','whether','which','who','whom','whose','what','whatever','whoever','whomever','each','every','all','any','few','more','most','other','some','such','only','own','same','than','too','very','just','also','between','over','below','above','here','there','how','now']);
  const words = text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 4 && !stopWords.has(w.toLowerCase())).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const unique = [...new Set(words)];
  const freq: Record<string, number> = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  return unique.sort((a, b) => (freq[b] || 0) - (freq[a] || 0)).slice(0, 2);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ChatPage() {
  const { user, profile, signOut } = useAuth();
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSession, setActiveSession] = useState<ConversationSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('intake');
  const [contextQCount, setContextQCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('gyan_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [view, setView] = useState<'chat' | 'profile'>('chat');
  const [enhancedPrompts, setEnhancedPrompts] = useState<string[] | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [pendingRawPrompt, setPendingRawPrompt] = useState('');
  // Pre-report questions flow
  const [showPreReport, setShowPreReport] = useState(false);
  const [pendingFinalPrompt, setPendingFinalPrompt] = useState('');
  const [preReportOutcome, setPreReportOutcome] = useState('');
  const [preReportStep, setPreReportStep] = useState<'outcome' | 'name'>('outcome');
  const [conversationName, setConversationName] = useState('');

  function toggleSidebarCollapse() {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('gyan_sidebar_collapsed', String(next)); } catch { /* noop */ }
      return next;
    });
  }
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string; type: string } | null>(null);
  // Voice state
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return localStorage.getItem('gyan_voice_output') !== 'false'; } catch { return true; }
  });
  const [voiceSettings, setVoiceSettings] = useState<{ gender: 'female' | 'male'; rate: number; pitch: number }>(() => {
    try {
      const s = localStorage.getItem('gyan_voice_settings');
      return s ? JSON.parse(s) : { gender: 'female', rate: 1.0, pitch: 1.1 };
    } catch { return { gender: 'female', rate: 1.0, pitch: 1.1 }; }
  });
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, loading]);
  useEffect(() => { if (user) loadSessions(); }, [user]);

  // Auto-speak last assistant message when it arrives
  useEffect(() => {
    if (!voiceEnabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.content) speakText(last.content);
  }, [messages]);

  async function loadSessions() {
    const { data } = await supabase
      .from('conversation_sessions')
      .select('*')
      .eq('user_id', user!.id)
      .order('updated_at', { ascending: false });
    setSessions(data || []);
  }

  async function loadSessionMessages(session: ConversationSession) {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });

    const msgs: Message[] = (data || []).map((c: Conversation) => ({
      id: c.id,
      role: c.role,
      content: c.content,
      phase: (c.phase as Phase) || 'intake',
      links: c.phase === 'report' && c.role === 'assistant' ? buildVisualLinks(c.content) : undefined,
    }));
    setMessages(msgs);

    // Determine current phase from last assistant message
    const lastAssistant = (data || []).filter((c: Conversation) => c.role === 'assistant');
    if (lastAssistant.length > 0) {
      const lastPhase = lastAssistant[lastAssistant.length - 1].phase as Phase;
      if (lastPhase === 'report') setPhase('followup');
      else if (lastPhase === 'companion') setPhase('companion');
      else setPhase(lastPhase);
    } else {
      setPhase('intake');
    }
  }

  async function startNewSession() {
    if (!user) return;
    const { data } = await supabase
      .from('conversation_sessions')
      .insert({ user_id: user.id, title: 'New Conversation' })
      .select()
      .single();
    if (data) {
      setSessions(prev => [data, ...prev]);
      setActiveSession(data);
      setMessages([]);
      setPhase('intake');
      setContextQCount(0);
      setSidebarOpen(false);
    }
  }

  async function selectSession(session: ConversationSession) {
    setActiveSession(session);
    await loadSessionMessages(session);
    setSidebarOpen(false);
  }

  async function callGyan(userText: string, currentPhase: Phase, isChipSelection = false, desiredOutcome = '', fileAttachment?: { name: string; content: string; type: string } | null) {
    if (!activeSession || !user) return;
    setLoading(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      phase: currentPhase,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || supabaseAnonKey;

      // Determine next phase for the AI
      let targetPhase: Phase = currentPhase;
      if (currentPhase === 'intake') targetPhase = 'outcome';
      else if (currentPhase === 'outcome') targetPhase = 'context';
      else if (currentPhase === 'context') {
        targetPhase = contextQCount >= 1 ? 'report' : 'context';
      } else if (currentPhase === 'report' || currentPhase === 'followup') {
        targetPhase = 'followup';
      } else {
        targetPhase = 'companion';
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/gyan-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          message: userText,
          phase: targetPhase,
          sessionId: activeSession.id,
          userId: user.id,
          userName: profile?.full_name || 'friend',
          conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
          isChipSelection,
          desiredOutcome: desiredOutcome || undefined,
          fileContent: fileAttachment ? `[Attached file: ${fileAttachment.name}]\n${fileAttachment.type === 'text' ? fileAttachment.content.slice(0, 8000) : '[Binary file — image or PDF attached]'}` : undefined,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        phase: targetPhase,
        usedMemory: data.usedMemory,
        usedWebSearch: data.usedWebSearch,
        outcomeChips: data.outcomeChips,
        suggestedQuestions: data.suggestedQuestions,
        links: targetPhase === 'report' ? buildVisualLinks(data.reply) : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Advance phase state
      if (targetPhase === 'outcome') setPhase('outcome');
      else if (targetPhase === 'context') {
        setContextQCount(prev => prev + 1);
        setPhase('context');
      } else if (targetPhase === 'report') {
        setPhase('followup');
        setContextQCount(0);
      } else if (targetPhase === 'companion') {
        setPhase('companion');
      } else if (targetPhase === 'followup') {
        setPhase('followup');
      }

      // Persist to DB
      await supabase.from('conversations').insert([
        { session_id: activeSession.id, user_id: user.id, role: 'user', content: userText, phase: currentPhase, step: 0 },
        { session_id: activeSession.id, user_id: user.id, role: 'assistant', content: data.reply, phase: targetPhase, step: 0 },
      ]);

      // Update session title
      if (messages.length === 0) {
        const title = userText.slice(0, 60);
        await supabase.from('conversation_sessions').update({ title, message_count: 2, updated_at: new Date().toISOString() }).eq('id', activeSession.id);
        setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, title, message_count: 2 } : s));
      } else {
        await supabase.from('conversation_sessions').update({ message_count: messages.length + 2, updated_at: new Date().toISOString() }).eq('id', activeSession.id);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Something went wrong. Please check your Anthropic API key is configured in Supabase Edge Function secrets.',
        phase: currentPhase,
      }]);
    }
    setLoading(false);
  }

  async function sendMessage() {
    if (!input.trim() || loading || !activeSession) return;
    const text = input.trim();

    // On first message (intake phase), enhance the prompt first
    if (phase === 'intake') {
      setPendingRawPrompt(text);
      setEnhancing(true);
      setInput('');
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token || supabaseAnonKey;
        const res = await fetch(`${supabaseUrl}/functions/v1/gyan-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Apikey: supabaseAnonKey },
          body: JSON.stringify({ message: text, phase: 'enhance', userName: profile?.full_name || 'friend' }),
        });
        const data = await res.json();
        if (data.enhancedPrompts && Array.isArray(data.enhancedPrompts)) {
          setEnhancedPrompts(data.enhancedPrompts);
        } else {
          // Enhancement failed gracefully — proceed with original
          setEnhancedPrompts(null);
          await callGyan(text, 'intake');
        }
      } catch {
        setEnhancedPrompts(null);
        await callGyan(text, 'intake');
      }
      setEnhancing(false);
      return;
    }

    const file = attachedFile;
    setInput('');
    setAttachedFile(null);
    await callGyan(text, phase, false, '', file);
  }

  function selectEnhancedPrompt(prompt: string) {
    setEnhancedPrompts(null);
    setPendingRawPrompt('');
    // Show pre-report questions before starting
    setPendingFinalPrompt(prompt);
    setConversationName(prompt.slice(0, 50));
    setPreReportOutcome('');
    setPreReportStep('outcome');
    setShowPreReport(true);
  }

  function dismissEnhancement() {
    const raw = pendingRawPrompt;
    setEnhancedPrompts(null);
    setPendingRawPrompt('');
    setPendingFinalPrompt(raw);
    setConversationName(raw.slice(0, 50));
    setPreReportOutcome('');
    setPreReportStep('outcome');
    setShowPreReport(true);
  }

  async function submitPreReport() {
    setShowPreReport(false);
    const prompt = pendingFinalPrompt;
    const name = conversationName.trim() || prompt.slice(0, 50);
    const outcome = preReportOutcome.trim();

    // Update session title and desired_outcome
    if (activeSession) {
      await supabase.from('conversation_sessions').update({
        title: name,
        desired_outcome: outcome || null,
        updated_at: new Date().toISOString(),
      }).eq('id', activeSession.id);
      setActiveSession(prev => prev ? { ...prev, title: name } : prev);
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, title: name } : s));
    }

    setPendingFinalPrompt('');
    setPreReportOutcome('');
    setConversationName('');
    await callGyan(prompt, 'intake', false, outcome);
  }

  async function handleOutcomeChip(chip: string) {
    if (loading || !activeSession) return;
    await callGyan(chip, 'outcome', true);
  }

  async function handleSuggestedQuestion(q: string) {
    if (loading || !activeSession) return;
    await callGyan(q, 'followup', true);
  }

  async function enterCompanionMode() {
    if (loading || !activeSession) return;
    setPhase('companion');
    await callGyan('I want to continue this conversation in companion mode — let\'s have a free flowing discussion.', 'companion', true);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const isText = file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md');
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (isText) {
        setAttachedFile({ name: file.name, content, type: 'text' });
      } else {
        // base64 for PDFs/images — strip the data URL prefix
        const base64 = content.split(',')[1] || content;
        setAttachedFile({ name: file.name, content: base64, type: file.type });
      }
    };
    if (isText) reader.readAsText(file);
    else reader.readAsDataURL(file);
    e.target.value = '';
  }

  function startVoiceInput() {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Voice input is not supported in your browser. Try Chrome or Edge.'); return; }

    if (voiceListening) {
      recognitionRef.current?.stop();
      setVoiceListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => (prev ? prev + ' ' + transcript : transcript));
    };
    recognition.onerror = () => setVoiceListening(false);
    recognition.onend = () => setVoiceListening(false);

    recognition.start();
    setVoiceListening(true);
  }

  function speakText(text: string) {
    if (!voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = voiceSettings.rate;
    utter.pitch = voiceSettings.pitch;
    const voices = window.speechSynthesis.getVoices();
    const preferredLang = voices.filter(v => v.lang.startsWith('en'));
    const genderMatch = preferredLang.filter(v =>
      voiceSettings.gender === 'female'
        ? v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman') || ['samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'allison', 'ava', 'susan', 'zira'].some(n => v.name.toLowerCase().includes(n))
        : v.name.toLowerCase().includes('male') || ['daniel', 'alex', 'fred', 'tom', 'rishi', 'david', 'mark', 'james', 'george'].some(n => v.name.toLowerCase().includes(n))
    );
    if (genderMatch.length > 0) utter.voice = genderMatch[0];
    else if (preferredLang.length > 0) utter.voice = preferredLang[0];
    window.speechSynthesis.speak(utter);
  }

  function saveVoiceSettings(settings: typeof voiceSettings) {
    setVoiceSettings(settings);
    try { localStorage.setItem('gyan_voice_settings', JSON.stringify(settings)); } catch { /* noop */ }
  }

  function toggleVoiceOutput() {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    if (!next) window.speechSynthesis?.cancel();
    try { localStorage.setItem('gyan_voice_output', String(next)); } catch { /* noop */ }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Cmd/Ctrl+Enter submits; plain Enter inserts a new line
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  }

  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  // The last assistant message (for chips/suggestions)
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');

  // Show outcome chips only after the first AI response
  const showOutcomeChips = phase === 'outcome' && lastAssistantMsg?.outcomeChips && lastAssistantMsg.outcomeChips.length > 0 && !loading;
  const showSuggestedQuestions = phase === 'followup' && lastAssistantMsg?.suggestedQuestions && lastAssistantMsg.suggestedQuestions.length > 0 && !loading;
  const showFollowupOptions = phase === 'followup' && !loading && !showSuggestedQuestions;

  // Input placeholder based on phase
  const inputPlaceholder =
    phase === 'intake' ? 'Tell Gyan what is on your mind...' :
    phase === 'outcome' ? 'Or type your own desired outcome...' :
    phase === 'context' ? 'Answer Gyan\'s question...' :
    phase === 'followup' ? 'Ask your own follow-up question...' :
    phase === 'companion' ? 'Chat freely with Gyan...' :
    'Type your message...';

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {/* Voice settings modal */}
      {showVoiceSettings && (
        <VoiceSettingsPanel
          settings={voiceSettings}
          onSave={saveVoiceSettings}
          onClose={() => setShowVoiceSettings(false)}
        />
      )}

      {/* Pre-report questions modal */}
      {showPreReport && (
        <PreReportModal
          step={preReportStep}
          outcome={preReportOutcome}
          conversationName={conversationName}
          onOutcomeChange={setPreReportOutcome}
          onNameChange={setConversationName}
          onNextStep={() => setPreReportStep('name')}
          onSubmit={submitPreReport}
          onSkipOutcome={() => { setPreReportOutcome(''); setPreReportStep('name'); }}
        />
      )}

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:relative z-30 lg:z-auto h-full bg-white border-r border-gray-100 flex flex-col transition-all duration-300 ease-in-out flex-shrink-0 ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-72'} ${sidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'}`}>

        {/* Header */}
        <div className={`p-3 border-b border-gray-100 flex-shrink-0 ${sidebarCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm flex-shrink-0">
                    <Leaf className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-sm">Athena GYAN</p>
                    <p className="text-xs text-gray-400">Hi, {firstName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={toggleSidebarCollapse} className="hidden lg:flex text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-all" title="Collapse sidebar">
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                  <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-gray-600 p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <button
                onClick={startNewSession}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-teal-700 transition-all text-sm active:scale-95 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                New Conversation
              </button>
            </>
          ) : (
            <>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
                <Leaf className="w-5 h-5 text-white" />
              </div>
              <button
                onClick={startNewSession}
                className="w-9 h-9 flex items-center justify-center bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl hover:from-emerald-600 hover:to-teal-700 transition-all active:scale-95 shadow-sm"
                title="New Conversation"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button onClick={toggleSidebarCollapse} className="hidden lg:flex w-9 h-9 items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-all" title="Expand sidebar">
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* History */}
        <div className={`flex-1 overflow-y-auto ${sidebarCollapsed ? 'p-2 flex flex-col items-center gap-1' : 'p-3 space-y-1'}`}>
          {!sidebarCollapsed && <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-2">History</p>}
          {!sidebarCollapsed && sessions.length === 0 && (
            <p className="text-xs text-gray-400 px-2 py-4 text-center">No conversations yet.<br />Start one above!</p>
          )}
          {sessions.map(s => (
            sidebarCollapsed ? (
              <button
                key={s.id}
                onClick={() => selectSession(s)}
                title={s.title}
                className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all ${activeSession?.id === s.id ? 'bg-emerald-100 text-emerald-600' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            ) : (
              <button
                key={s.id}
                onClick={() => selectSession(s)}
                className={`w-full text-left px-3 py-3 rounded-xl transition-all text-sm ${activeSession?.id === s.id ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className={`w-4 h-4 mt-0.5 flex-shrink-0 ${activeSession?.id === s.id ? 'text-emerald-600' : 'text-gray-400'}`} />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </button>
            )
          ))}
        </div>

        {/* Footer */}
        <div className={`border-t border-gray-100 ${sidebarCollapsed ? 'p-2 flex flex-col items-center gap-1' : 'p-3 space-y-1'}`}>
          {sidebarCollapsed ? (
            <>
              <button onClick={() => { setView('profile'); setSidebarOpen(false); }} title="My Profile" className="w-9 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-xl transition-all">
                <User className="w-4 h-4" />
              </button>
              <button onClick={() => setShowVoiceSettings(true)} title="Voice Settings" className="w-9 h-9 flex items-center justify-center text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-all">
                <Volume2 className="w-4 h-4" />
              </button>
              <button onClick={signOut} title="Sign Out" className="w-9 h-9 flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all">
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setView('profile'); setSidebarOpen(false); }} className="w-full flex items-center gap-3 px-3 py-3 text-sm text-gray-600 hover:bg-gray-50 rounded-xl transition-all">
                <User className="w-4 h-4" />
                <span>My Profile</span>
              </button>
              <button onClick={() => setShowVoiceSettings(true)} className="w-full flex items-center gap-3 px-3 py-3 text-sm text-gray-600 hover:bg-emerald-50 hover:text-emerald-700 rounded-xl transition-all">
                <Volume2 className="w-4 h-4" />
                <span>Voice Settings</span>
              </button>
              <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-3 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all">
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-500 hover:text-gray-700 p-1">
            <Menu className="w-6 h-6" />
          </button>
          {view === 'chat' ? (
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">{activeSession ? activeSession.title : 'Athena GYAN'}</h2>
              {activeSession && <PhaseIndicator phase={phase} />}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <button onClick={() => setView('chat')} className="text-gray-400 hover:text-gray-600">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="font-semibold text-gray-900">My Profile</h2>
            </div>
          )}
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {firstName[0]?.toUpperCase()}
          </div>
        </header>

        {view === 'profile' ? <ProfileView /> : (
          <>
            {/* Chat area */}
            <div className="flex-1 overflow-y-auto">
              {!activeSession ? (
                <WelcomeScreen name={firstName} onStart={startNewSession} />
              ) : (
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                  {messages.length === 0 && (
                    <IntakePrompt name={firstName} />
                  )}

                  {messages.map((msg, idx) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      sessionId={activeSession.id}
                      userId={user!.id}
                      onRetry={msg.role === 'assistant' ? () => {
                        const prevUser = [...messages].slice(0, idx).reverse().find(m => m.role === 'user');
                        if (prevUser) callGyan(prevUser.content, prevUser.phase);
                      } : undefined}
                      onSpeak={msg.role === 'assistant' ? speakText : undefined}
                    />
                  ))}

                  {/* Prompt Enhancement Card */}
                  {(enhancing || enhancedPrompts) && (
                    <PromptEnhancementCard
                      rawPrompt={pendingRawPrompt}
                      enhancedPrompts={enhancedPrompts}
                      loading={enhancing}
                      onSelect={selectEnhancedPrompt}
                      onUseOriginal={dismissEnhancement}
                    />
                  )}

                  {loading && <TypingIndicator />}

                  {/* Outcome chips — shown after first AI response */}
                  {showOutcomeChips && (
                    <OutcomeChips
                      chips={lastAssistantMsg!.outcomeChips!}
                      onSelect={handleOutcomeChip}
                    />
                  )}

                  {/* Suggested follow-up questions */}
                  {showSuggestedQuestions && (
                    <SuggestedQuestions
                      questions={lastAssistantMsg!.suggestedQuestions!}
                      onSelect={handleSuggestedQuestion}
                      onCompanion={enterCompanionMode}
                    />
                  )}

                  {/* Post-report options when no suggestions yet */}
                  {showFollowupOptions && (
                    <FollowupOptions
                      onSuggest={() => callGyan('Suggest relevant follow-up questions based on my report', 'followup', true)}
                      onCompanion={enterCompanionMode}
                    />
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input bar */}
            {activeSession && (
              <div className="bg-white border-t border-gray-100 px-4 py-3 flex-shrink-0">
                <div className="max-w-3xl mx-auto">
                  {/* File attachment chip */}
                  {attachedFile && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 text-xs font-medium text-emerald-700">
                        <Paperclip className="w-3.5 h-3.5" />
                        <span className="max-w-[180px] truncate">{attachedFile.name}</span>
                        <button onClick={() => setAttachedFile(null)} className="ml-1 text-emerald-400 hover:text-emerald-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-end gap-2 bg-gray-50 rounded-2xl border border-gray-200 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100 transition-all px-3 py-3">
                    {/* File attach button */}
                    <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={handleFileSelect} className="hidden" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                      title="Attach file"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={2}
                      className="flex-1 bg-transparent resize-none outline-none text-gray-900 text-base placeholder-gray-400 max-h-48"
                      placeholder={inputPlaceholder}
                      style={{ minHeight: '52px' }}
                    />
                    {/* Mic button */}
                    <button
                      onClick={startVoiceInput}
                      className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-all ${voiceListening ? 'bg-red-100 text-red-500 animate-pulse' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      title={voiceListening ? 'Stop recording' : 'Voice input'}
                    >
                      {voiceListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    {/* Voice output toggle */}
                    <button
                      onClick={toggleVoiceOutput}
                      className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-all ${voiceEnabled ? 'text-emerald-600 bg-emerald-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                      title={voiceEnabled ? 'Voice output on — click to mute' : 'Voice output off — click to enable'}
                    >
                      {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={sendMessage}
                      disabled={loading || enhancing || !!enhancedPrompts || (!input.trim() && !attachedFile)}
                      className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center text-white hover:from-emerald-600 hover:to-teal-700 disabled:opacity-40 transition-all active:scale-95"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 text-center mt-2">
                    Click Send to submit · Enter for new line · Cmd+Enter also submits
                    {voiceEnabled && <span className="ml-2 text-emerald-500">· Voice on</span>}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ─── Phase Indicator ──────────────────────────────────────────────────────────

const PHASE_META: Record<Phase, { label: string; color: string }> = {
  intake:    { label: 'Tell Gyan what is on your mind', color: 'text-gray-400' },
  outcome:   { label: 'Step 1 — Choose your desired outcome', color: 'text-amber-500' },
  context:   { label: 'Step 2 — Gyan is gathering context', color: 'text-blue-500' },
  report:    { label: 'Step 3 — Your Intelligence Report', color: 'text-emerald-600' },
  followup:  { label: 'Explore further or go deeper', color: 'text-teal-600' },
  companion: { label: 'Companion Mode — free conversation', color: 'text-slate-500' },
};

function PhaseIndicator({ phase }: { phase: Phase }) {
  const meta = PHASE_META[phase];
  return <p className={`text-xs font-medium ${meta.color}`}>{meta.label}</p>;
}

// ─── Intake Prompt ────────────────────────────────────────────────────────────

function IntakePrompt({ name }: { name: string }) {
  return (
    <div className="text-center py-10">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mx-auto mb-4">
        <Brain className="w-9 h-9 text-emerald-600" />
      </div>
      <h3 className="font-bold text-gray-900 text-xl mb-2">Ready to guide you, {name}</h3>
      <p className="text-gray-500 text-sm max-w-sm mx-auto leading-relaxed">
        Just tell me what is on your mind. Gyan will understand your goal, ask a couple of short questions, and deliver a comprehensive answer — all in 3 guided steps.
      </p>
      <div className="flex items-center justify-center gap-3 mt-6">
        {[
          { num: '1', label: 'Your Outcome', color: 'bg-amber-100 text-amber-700 border-amber-200' },
          { num: '2', label: 'Context', color: 'bg-blue-100 text-blue-700 border-blue-200' },
          { num: '3', label: 'Your Report', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        ].map(s => (
          <div key={s.num} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${s.color}`}>
            <span className="font-bold">{s.num}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Outcome Chips ────────────────────────────────────────────────────────────

function OutcomeChips({ chips, onSelect }: { chips: string[]; onSelect: (chip: string) => void }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-lg bg-amber-500 flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-white" />
        </div>
        <p className="text-sm font-semibold text-amber-800">Choose your desired outcome</p>
        <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Click one or type your own below</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip, i) => (
          <button
            key={i}
            onClick={() => onSelect(chip)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-amber-300 text-amber-800 rounded-xl text-sm font-medium hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-all active:scale-95 shadow-sm"
          >
            {chip}
            <ChevronRight className="w-3.5 h-3.5 opacity-60" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Suggested Questions ──────────────────────────────────────────────────────

function SuggestedQuestions({ questions, onSelect, onCompanion }: { questions: string[]; onSelect: (q: string) => void; onCompanion: () => void }) {
  return (
    <div className="space-y-3">
      <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-teal-500 flex items-center justify-center">
            <Lightbulb className="w-3.5 h-3.5 text-white" />
          </div>
          <p className="text-sm font-semibold text-teal-800">Suggested next questions</p>
          <span className="text-xs text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">Click to explore deeper</span>
        </div>
        <div className="space-y-2">
          {questions.map((q, i) => (
            <button
              key={i}
              onClick={() => onSelect(q)}
              className="w-full text-left flex items-center gap-3 px-4 py-3 bg-white border border-teal-200 text-teal-800 rounded-xl text-sm font-medium hover:bg-teal-500 hover:text-white hover:border-teal-500 transition-all active:scale-95 group"
            >
              <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 flex-shrink-0" />
              {q}
            </button>
          ))}
        </div>
      </div>

      <CompanionCard onCompanion={onCompanion} />
    </div>
  );
}

// ─── Followup Options ─────────────────────────────────────────────────────────

function FollowupOptions({ onSuggest, onCompanion }: { onSuggest: () => void; onCompanion: () => void }) {
  return (
    <div className="grid sm:grid-cols-3 gap-3 pt-2">
      <FollowupCard
        icon={<Lightbulb className="w-5 h-5" />}
        color="teal"
        title="Suggested Questions"
        description="Let Gyan suggest what to explore next — no thinking required"
        onClick={onSuggest}
      />
      <FollowupCard
        icon={<Send className="w-5 h-5" />}
        color="blue"
        title="Ask Your Own"
        description="Type any follow-up question to go deeper on a specific part"
        onClick={() => {}}
        isInput
      />
      <CompanionCard onCompanion={onCompanion} compact />
    </div>
  );
}

function FollowupCard({ icon, color, title, description, onClick, isInput }: {
  icon: React.ReactNode; color: string; title: string; description: string; onClick: () => void; isInput?: boolean;
}) {
  const colors: Record<string, string> = {
    teal: 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-500',
    blue: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-500',
  };
  return isInput ? (
    <div className={`rounded-2xl border p-4 ${colors[color]} cursor-default`}>
      <div className="mb-2">{icon}</div>
      <p className="font-semibold text-sm mb-1">{title}</p>
      <p className="text-xs opacity-70 leading-relaxed">{description}</p>
    </div>
  ) : (
    <button onClick={onClick} className={`rounded-2xl border p-4 text-left transition-all hover:text-white active:scale-95 ${colors[color]}`}>
      <div className="mb-2">{icon}</div>
      <p className="font-semibold text-sm mb-1">{title}</p>
      <p className="text-xs opacity-70 leading-relaxed">{description}</p>
    </button>
  );
}

function CompanionCard({ onCompanion, compact }: { onCompanion: () => void; compact?: boolean }) {
  return (
    <button
      onClick={onCompanion}
      className={`rounded-2xl border bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-700 hover:text-white transition-all active:scale-95 text-left ${compact ? 'p-4' : 'p-4 w-full'}`}
    >
      <div className="mb-2"><MessageCircle className="w-5 h-5" /></div>
      <p className="font-semibold text-sm mb-1">Companion Mode</p>
      <p className="text-xs opacity-70 leading-relaxed">Have a free-flowing conversation — like chatting with a knowledgeable friend</p>
    </button>
  );
}

// ─── Pre-Report Modal ─────────────────────────────────────────────────────────

function PreReportModal({
  step,
  outcome,
  conversationName,
  onOutcomeChange,
  onNameChange,
  onNextStep,
  onSubmit,
  onSkipOutcome,
}: {
  step: 'outcome' | 'name';
  outcome: string;
  conversationName: string;
  onOutcomeChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onNextStep: () => void;
  onSubmit: () => void;
  onSkipOutcome: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-500"
            style={{ width: step === 'outcome' ? '50%' : '100%' }}
          />
        </div>

        <div className="p-8">
          {step === 'outcome' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-5">
                <Zap className="w-6 h-6 text-amber-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">What do you want to walk away with?</h3>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Optional — but telling Gyan your desired outcome makes the report laser-focused on exactly what you need.
              </p>
              <textarea
                autoFocus
                value={outcome}
                onChange={e => onOutcomeChange(e.target.value)}
                rows={3}
                placeholder="e.g., A clear 3-step action plan I can start today..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-gray-50 text-gray-900 text-sm resize-none leading-relaxed"
              />
              <div className="flex gap-3 mt-5">
                <button
                  onClick={onSkipOutcome}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-all"
                >
                  Skip
                </button>
                <button
                  onClick={onNextStep}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold hover:from-emerald-600 hover:to-teal-700 transition-all active:scale-95"
                >
                  Continue
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-5">
                <MessageSquare className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Name this conversation</h3>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Give it a name so you can find it easily later. Gyan will also group similar conversations by topic automatically.
              </p>
              <input
                autoFocus
                type="text"
                value={conversationName}
                onChange={e => onNameChange(e.target.value)}
                placeholder="e.g., Growing my freelance business in 2026"
                maxLength={80}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-gray-50 text-gray-900 text-sm"
                onKeyDown={e => { if (e.key === 'Enter' && conversationName.trim()) onSubmit(); }}
              />
              <p className="text-xs text-gray-400 mt-2 text-right">{conversationName.length}/80</p>
              <button
                onClick={onSubmit}
                disabled={!conversationName.trim()}
                className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold hover:from-emerald-600 hover:to-teal-700 transition-all active:scale-95 disabled:opacity-40"
              >
                Start My Conversation
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Prompt Enhancement Card ─────────────────────────────────────────────────

function PromptEnhancementCard({
  rawPrompt, enhancedPrompts, loading, onSelect, onUseOriginal
}: {
  rawPrompt: string;
  enhancedPrompts: string[] | null;
  loading: boolean;
  onSelect: (p: string) => void;
  onUseOriginal: () => void;
}) {
  const ANGLE_LABELS = ['Tactical & Specific', 'Strategic & Big-Picture', 'Personal & Outcome-Focused'];

  return (
    <div className="bg-gradient-to-br from-slate-50 to-emerald-50 border border-emerald-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">Gyan Enhanced Your Prompt</p>
          <p className="text-xs text-gray-500">Better prompts produce significantly better reports. Choose one:</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-4 justify-center">
          <div className="flex gap-1">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-sm text-gray-500">Crafting 3 enhanced versions...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {enhancedPrompts?.map((prompt, i) => (
            <button
              key={i}
              onClick={() => onSelect(prompt)}
              className="w-full text-left p-4 bg-white border border-emerald-200 rounded-xl hover:border-emerald-400 hover:shadow-md transition-all group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {ANGLE_LABELS[i] || `Option ${i + 1}`}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">{prompt}</p>
            </button>
          ))}

          <button
            onClick={onUseOriginal}
            className="w-full text-left p-3 bg-transparent border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Use my original prompt instead</span>
            </div>
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{rawPrompt}</p>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}

type DownloadFormat = 'txt' | 'md' | 'html' | 'csv';

function downloadConversationAs(content: string, phase: string, format: DownloadFormat) {
  const base = `gyan-${phase}-${Date.now()}`;
  let blob: Blob;
  let filename: string;

  if (format === 'txt') {
    blob = new Blob([content], { type: 'text/plain' });
    filename = `${base}.txt`;
  } else if (format === 'md') {
    blob = new Blob([content], { type: 'text/markdown' });
    filename = `${base}.md`;
  } else if (format === 'html') {
    const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = escaped.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('\n');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Gyan ${phase} Report</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;line-height:1.7;color:#1a1a1a;padding:0 20px}h1{color:#059669}p{margin:0 0 1em}</style></head><body><h1>Gyan ${phase.charAt(0).toUpperCase() + phase.slice(1)} Report</h1>${paragraphs}</body></html>`;
    blob = new Blob([html], { type: 'text/html' });
    filename = `${base}.html`;
  } else {
    // CSV: each line as a row, timestamp + content cell
    const rows = [['timestamp', 'content'], [new Date().toISOString(), `"${content.replace(/"/g, '""')}"`]];
    blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    filename = `${base}.csv`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function MessageBubble({ message, sessionId, userId, onRetry, onSpeak }: {
  message: Message;
  sessionId: string;
  userId: string;
  onRetry?: () => void;
  onSpeak?: (text: string) => void;
}) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [liked, setLiked] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const msgHash = simpleHash(message.content.slice(0, 200));

  useEffect(() => {
    if (!userId || isUser) return;
    (async () => {
      const { data } = await supabase.from('message_likes').select('id').eq('user_id', userId).eq('message_hash', msgHash).maybeSingle();
      if (data) setLiked(true);
      const { data: note } = await supabase.from('message_notes').select('note_text').eq('user_id', userId).eq('message_hash', msgHash).maybeSingle();
      if (note) setNoteText(note.note_text);
    })();
  }, []);

  async function handleLike() {
    if (liked) {
      await supabase.from('message_likes').delete().eq('user_id', userId).eq('message_hash', msgHash);
      setLiked(false);
    } else {
      await supabase.from('message_likes').insert({ user_id: userId, session_id: sessionId, message_hash: msgHash });
      setLiked(true);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    const text = `From Athena GYAN:\n\n${message.content}`;
    await navigator.clipboard.writeText(text);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  async function saveNote() {
    const existing = await supabase.from('message_notes').select('id').eq('user_id', userId).eq('message_hash', msgHash).maybeSingle();
    if (existing.data) {
      await supabase.from('message_notes').update({ note_text: noteText, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('message_hash', msgHash);
    } else {
      await supabase.from('message_notes').insert({ user_id: userId, session_id: sessionId, message_hash: msgHash, note_text: noteText });
    }
    setNoteSaved(true);
    setTimeout(() => { setNoteSaved(false); setShowNote(false); }, 1500);
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group/bubble`}>
      <div className={`max-w-[88%] lg:max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Leaf className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-semibold text-emerald-700">Gyan</span>
            {message.usedMemory && (
              <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <Brain className="w-3 h-3" />
                Remembers past
              </span>
            )}
            {message.usedWebSearch && (
              <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                <Globe className="w-3 h-3" />
                Live search
              </span>
            )}
            {message.phase === 'report' && (
              <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">
                Intelligence Report
              </span>
            )}
          </div>
        )}
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-tr-sm'
            : message.phase === 'report'
              ? 'bg-white border-2 border-emerald-200 text-gray-800 rounded-tl-sm shadow-md'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Action bar — assistant messages only */}
        {!isUser && (
          <div className="flex items-center gap-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity duration-200 mt-1">
            <ActionBtn icon={liked ? <ThumbsUp className="w-3.5 h-3.5 fill-emerald-500 text-emerald-500" /> : <ThumbsUp className="w-3.5 h-3.5" />} label="Like" onClick={handleLike} active={liked} />
            <ActionBtn icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} label={copied ? 'Copied!' : 'Copy'} onClick={handleCopy} />
            {onRetry && <ActionBtn icon={<RefreshCw className="w-3.5 h-3.5" />} label="Retry" onClick={onRetry} />}
            {/* Download with format picker */}
            <div className="relative">
              <ActionBtn
                icon={<Download className="w-3.5 h-3.5" />}
                label="Download"
                onClick={() => setShowDownloadMenu(v => !v)}
                active={showDownloadMenu}
              />
              {showDownloadMenu && (
                <div className="absolute bottom-full left-0 mb-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden min-w-[140px]">
                  {([
                    { fmt: 'txt' as DownloadFormat, label: 'Plain Text (.txt)' },
                    { fmt: 'md'  as DownloadFormat, label: 'Markdown (.md)' },
                    { fmt: 'html' as DownloadFormat, label: 'Web Page (.html)' },
                    { fmt: 'csv' as DownloadFormat, label: 'Spreadsheet (.csv)' },
                  ]).map(({ fmt, label }) => (
                    <button
                      key={fmt}
                      onClick={() => { downloadConversationAs(message.content, message.phase, fmt); setShowDownloadMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-3 h-3 opacity-50" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ActionBtn icon={<StickyNote className="w-3.5 h-3.5" />} label="Note" onClick={() => setShowNote(v => !v)} active={showNote || !!noteText} />
            <ActionBtn icon={shared ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />} label={shared ? 'Copied!' : 'Share'} onClick={handleShare} />
            {onSpeak && <ActionBtn icon={<Volume2 className="w-3.5 h-3.5" />} label="Speak" onClick={() => onSpeak(message.content)} />}
          </div>
        )}

        {/* Inline note editor */}
        {showNote && !isUser && (
          <div className="w-full mt-1 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-amber-700 mb-2">Your note</p>
            <textarea
              autoFocus
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={2}
              placeholder="Add a personal note about this response..."
              className="w-full text-xs text-gray-800 bg-white border border-amber-200 rounded-lg p-2 resize-none outline-none focus:ring-1 focus:ring-amber-400"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={saveNote} className="text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition-all">
                {noteSaved ? 'Saved!' : 'Save Note'}
              </button>
              <button onClick={() => setShowNote(false)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg transition-all">Cancel</button>
            </div>
          </div>
        )}

        {message.links && message.links.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all hover:opacity-80 ${
                  link.type === 'youtube' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}
              >
                {link.type === 'youtube' ? <Youtube className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
                {link.title}
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${
        active ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
    </button>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <Leaf className="w-3 h-3 text-white" />
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="text-center max-w-lg">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-200">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Hello, {name}!</h2>
        <p className="text-gray-500 mb-2 leading-relaxed">
          I am <span className="font-semibold text-emerald-600">Gyan</span> — your intelligent life companion.
        </p>
        <p className="text-gray-400 mb-8 leading-relaxed text-sm">
          Tell me anything on your mind and I will guide you step by step to the best answer. No confusion, no thinking required — just follow along.
        </p>

        {/* How it works */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { num: '1', title: 'Your Outcome', desc: 'Choose what you want — click or type', color: 'amber' },
            { num: '2', title: 'Context', desc: 'Answer 2 short questions so Gyan knows your situation', color: 'blue' },
            { num: '3', title: 'Your Report', desc: 'Get a deep, structured answer like ChatGPT — plus links', color: 'emerald' },
          ].map(s => (
            <div key={s.num} className={`rounded-2xl border p-4 text-left ${
              s.color === 'amber' ? 'bg-amber-50 border-amber-200' :
              s.color === 'blue' ? 'bg-blue-50 border-blue-200' :
              'bg-emerald-50 border-emerald-200'
            }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mb-2 ${
                s.color === 'amber' ? 'bg-amber-500' :
                s.color === 'blue' ? 'bg-blue-500' : 'bg-emerald-500'
              }`}>{s.num}</div>
              <p className={`font-semibold text-xs mb-1 ${
                s.color === 'amber' ? 'text-amber-800' :
                s.color === 'blue' ? 'text-blue-800' : 'text-emerald-800'
              }`}>{s.title}</p>
              <p className={`text-xs leading-relaxed ${
                s.color === 'amber' ? 'text-amber-600' :
                s.color === 'blue' ? 'text-blue-600' : 'text-emerald-600'
              }`}>{s.desc}</p>
            </div>
          ))}
        </div>

        <button
          onClick={onStart}
          className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-2xl hover:from-emerald-600 hover:to-teal-700 transition-all shadow-lg shadow-emerald-200 active:scale-95 text-base"
        >
          Start a New Conversation
        </button>

        <p className="text-xs text-gray-400 mt-4">This is your personal Life OS — every conversation is remembered.</p>
      </div>
    </div>
  );
}

// ─── Voice Settings Panel ─────────────────────────────────────────────────────

function VoiceSettingsPanel({
  settings,
  onSave,
  onClose,
}: {
  settings: { gender: 'female' | 'male'; rate: number; pitch: number };
  onSave: (s: { gender: 'female' | 'male'; rate: number; pitch: number }) => void;
  onClose: () => void;
}) {
  const [gender, setGender] = useState(settings.gender);
  const [rate, setRate] = useState(settings.rate);
  const [pitch, setPitch] = useState(settings.pitch);

  const PRESETS = [
    { label: 'Soft & Slow', rate: 0.85, pitch: 1.1 },
    { label: 'Natural', rate: 1.0, pitch: 1.0 },
    { label: 'Energetic', rate: 1.2, pitch: 1.2 },
  ];

  function testVoice() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance('Hello! I am Gyan, your intelligent companion. How can I help you today?');
    utter.rate = rate;
    utter.pitch = pitch;
    const voices = window.speechSynthesis.getVoices();
    const englishVoices = voices.filter(v => v.lang.startsWith('en'));
    const match = englishVoices.filter(v =>
      gender === 'female'
        ? ['samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'allison', 'ava', 'susan', 'zira'].some(n => v.name.toLowerCase().includes(n))
        : ['daniel', 'alex', 'fred', 'tom', 'rishi', 'david', 'mark', 'james', 'george'].some(n => v.name.toLowerCase().includes(n))
    );
    if (match.length > 0) utter.voice = match[0];
    else if (englishVoices.length > 0) utter.voice = englishVoices[0];
    window.speechSynthesis.speak(utter);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-white" />
            <h3 className="text-white font-bold">Voice Settings</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          {/* Gender */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Voice Gender</p>
            <div className="grid grid-cols-2 gap-2">
              {(['female', 'male'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={`py-2.5 rounded-xl text-sm font-semibold border transition-all ${gender === g ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-emerald-300'}`}
                >
                  {g === 'female' ? 'Female' : 'Male'}
                </button>
              ))}
            </div>
          </div>

          {/* Presets */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Tone Presets</p>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setRate(p.rate); setPitch(p.pitch); }}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-all ${rate === p.rate && pitch === p.pitch ? 'bg-teal-500 text-white border-teal-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-teal-300'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Speed slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">Speed</p>
              <span className="text-xs text-gray-400">{rate.toFixed(1)}x</span>
            </div>
            <input type="range" min="0.5" max="1.8" step="0.1" value={rate} onChange={e => setRate(parseFloat(e.target.value))}
              className="w-full accent-emerald-500" />
          </div>

          {/* Pitch slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">Pitch</p>
              <span className="text-xs text-gray-400">{pitch.toFixed(1)}</span>
            </div>
            <input type="range" min="0.5" max="2.0" step="0.1" value={pitch} onChange={e => setPitch(parseFloat(e.target.value))}
              className="w-full accent-emerald-500" />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={testVoice} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all">
              Test Voice
            </button>
            <button
              onClick={() => { onSave({ gender, rate, pitch }); onClose(); }}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold hover:from-emerald-600 hover:to-teal-700 transition-all"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile View ─────────────────────────────────────────────────────────────

function ProfileView() {
  const { user, profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [gender, setGender] = useState(profile?.gender || '');
  const [age, setAge] = useState(String(profile?.age || ''));
  const [country, setCountry] = useState(profile?.country || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) { setFullName(profile.full_name); setGender(profile.gender); setAge(String(profile.age)); setCountry(profile.country); }
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from('profiles').update({ full_name: fullName, gender, age: parseInt(age), country }).eq('id', user!.id);
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setSaving(false);
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-8 py-10 text-center">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
              <span className="text-4xl text-white font-bold">{(profile?.full_name || user?.email || '?')[0]?.toUpperCase()}</span>
            </div>
            <h3 className="text-xl font-bold text-white">{profile?.full_name || 'Your Profile'}</h3>
            <p className="text-emerald-100 text-sm mt-1">{user?.email}</p>
          </div>
          <form onSubmit={handleSave} className="px-8 py-8 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-gray-50 text-gray-900" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Gender</label>
                <select value={gender} onChange={e => setGender(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-gray-50 text-gray-900 appearance-none">
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non-binary">Non-binary</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Age</label>
                <input type="number" min="5" max="120" value={age} onChange={e => setAge(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-gray-50 text-gray-900" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Country</label>
              <input value={country} onChange={e => setCountry(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-gray-50 text-gray-900" placeholder="Your country" />
            </div>
            {saved && <div className="bg-emerald-50 text-emerald-700 text-sm font-medium px-4 py-3 rounded-xl border border-emerald-200">Profile saved successfully!</div>}
            <button type="submit" disabled={saving} className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl hover:from-emerald-600 hover:to-teal-700 transition-all disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
