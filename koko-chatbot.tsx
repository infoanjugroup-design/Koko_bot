'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  showGoogleLogin?: boolean;
}

export function KokoChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'bot',
      text: 'Namaste! Welcome to Koko Foods. Koi sawal ya coupon code ho toh yahan likhein.',
    },
  ]);
  const [input, setInput] = useState('');
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hasTriggeredRef = useRef(false);

  // Initialize Supabase Client
  const supabase = createClient();

  // 1. Check if user is logged in
  useEffect(() => {
    async function checkUser() {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        setUser(data.user);
      }
    }
    checkUser();
  }, [supabase]);

  // 2. Google OAuth Login Trigger
  const handleGoogleLogin = async () => {
    try {
      // Save pending scanned code to local storage before redirect
      if (scannedCode) {
        localStorage.setItem('koko_pending_code', scannedCode);
      }

      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/post-login`,
        },
      });
    } catch (error) {
      console.error('Google Login Error:', error);
    }
  };

  // 3. Message Send & Verification Handler
  const handleSend = async (customText?: string) => {
    const query = (customText !== undefined ? customText : input).trim();
    if (!query) return;

    setMessages((prev) => [...prev, { sender: 'user', text: query }]);
    setInput('');

    // Check code in Supabase
    try {
      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData?.user;

      // Agar user logged in hai -> Direct Claim
      if (currentUser) {
        const { data: res, error } = await supabase.rpc('process_qr_verification', {
          p_code: query,
          p_user_id: currentUser.id,
          p_session_id: currentUser.id,
        });

        if (error) throw error;

        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: res.message,
            showGoogleLogin: res.status === 'LOGIN_REQUIRED',
          },
        ]);
      } else {
        // Agar user Guest hai -> Save to pending session and ask for Google Login
        setScannedCode(query);

        setMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: `🍿 Aapne packet/box scan kiya hai! Code: **${query.toUpperCase()}**\n\nCoins claim karne ke liye kripya **Google** se Login ya Register karein:`,
            showGoogleLogin: true,
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: 'Ye coupon/QR code valid nahi mila ya already claim ho chuka hai.',
        },
      ]);
    }
  };

  // 4. Auto-Open, Auto-Type & Auto-Send on QR Scan
  useEffect(() => {
    const qrParam =
      searchParams.get('qr') ||
      searchParams.get('code') ||
      searchParams.get('coupon') ||
      searchParams.get('token');

    if (qrParam && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;

      // 1. Force Chatbot to OPEN
      setIsOpen(true);
      setScannedCode(qrParam);

      // 2. Automatically Type in input
      const codeMsg = qrParam.trim();
      setInput(codeMsg);

      // 3. Automatically Trigger Send
      setTimeout(() => {
        handleSend(codeMsg);

        // 4. Clean URL parameters
        const params = new URLSearchParams(searchParams.toString());
        params.delete('qr');
        params.delete('code');
        params.delete('coupon');
        params.delete('token');
        const cleanUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
        router.replace(cleanUrl, { scroll: false });
      }, 300);
    }
  }, [searchParams, pathname, router]);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white p-4 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 text-xl"
        >
          💬
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-stone-200 flex flex-col h-[500px] overflow-hidden">
          {/* Header */}
          <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center">
            <div>
              <div className="font-semibold text-sm">koko chatbot 🍿</div>
              <div className="text-[11px] text-stone-300">
                {user ? user.email : 'Guest • online'}
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-stone-300 hover:text-white text-lg leading-none"
            >
              ✕
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-stone-50 text-sm">
            {messages.map((msg, index) => (
              <div key={index} className="space-y-2">
                <div
                  className={`p-3 rounded-2xl max-w-[85%] whitespace-pre-line text-xs sm:text-sm ${
                    msg.sender === 'user'
                      ? 'ml-auto bg-blue-600 text-white rounded-br-none'
                      : 'mr-auto bg-white border border-stone-200 text-stone-800 rounded-bl-none shadow-sm'
                  }`}
                >
                  {msg.text}
                </div>

                {/* Single Google Login Button */}
                {msg.showGoogleLogin && (
                  <div className="pt-1">
                    <button
                      onClick={handleGoogleLogin}
                      className="w-full bg-white hover:bg-stone-50 text-stone-700 border border-stone-300 font-medium px-4 py-2 rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all text-xs"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                      Login / Register with Google
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input Box */}
          <div className="p-3 border-t border-stone-200 bg-white flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message or code..."
              className="flex-1 border border-stone-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600 text-stone-900"
            />
            <button
              onClick={() => handleSend()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default KokoChatbot;
